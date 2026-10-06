// mcp-tools.mts — the MCP server's tools (issue #211; the protocol and the listener are app/mcp.mts). Each tool is a thin
// adapter over the app's own HTTP routes, called in-process over loopback (ToolContext.api): the routes keep every
// validation, the bridge's own checks, Stop and one trip at a time, and this file only maps arguments, pages and
// trims results for a model. Where the page computes something before it calls a route (a build's profile and buffs,
// a bridge command's container chain, why a bridge action is refused), the tool calls the same shared function the
// page does (buffs.mts, vault-lib.mts). One entry per tool: its name, description, JSON Schema for its arguments
// (the subset app/schema/validate.mts checks, which mcp.mts runs before the handler), annotations and handler.
// `action: true` marks a tool that acts in game: refused while Settings' "Allow in-game actions" is off.
import { BRIDGE_ACTION_LABELS, BRIDGE_OFFLINE, GEAR_SLOTS, bridgeRefusal, characterProfile, containerChain, fullOf, isPseudoCharacter, requirementReport, resistSkillBonus, setRules, templateFrom, toOptItem, totalsOf } from "./vault-lib.mts";
import type { BridgeAction, Character, CharacterEntryRaw, Container, EffectiveProfile, Item, ProfilesFile, PropMap, RunBuffs } from "./vault-lib.mts";
import { buffPlanOf, buffSkillValues, manualProfile, normalizeBuffs, ownEntry, plannedProfile, runBuffs, BUFFS } from "./buffs.mts";
import { EXTRA_COLS, parseItemQuery } from "./item-query.mts";
import type { ValidatorSchema } from "./schema/validate.mts";
import type { RulesV1 } from "./schema/types.d.mts";

// A tool's failure in words the model reads (a route's own refusal, a bad argument): a tool result with isError.
export class ToolError extends Error {}
// `memory` lives as long as the server: the in-game commands this server queued (id → when), so a status check can tell
// one still waiting for the bridge from an id it never queued, the builds a newer build_suit call replaced, and the
// builds that filled around pinned pieces (whose currentScore is left out).
export interface ToolContext {
  api<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown; clientId?: string }): Promise<T>;
  sleep(ms: number): Promise<void>;
  memory: { actions: Map<string, number>; replaced: Set<string>; filled: Set<string> };
}
type Schema = ValidatorSchema & { description?: string; properties?: Record<string, Schema>; items?: Schema };
export interface Tool {
  name: string;
  description: string;
  inputSchema: Schema & { type: "object" };
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  action?: true;
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>>;
}

// What every client gets in initialize's `instructions`: how the tools fit together.
export const INSTRUCTIONS = [
  "Pack Rat holds a player's Ultima Online inventory: every item on every character, in every bank, backpack and scanned house container, folded from scans the game client wrote. Tools read it, run its Suit Builder and, when the player allows it, act in game.",
  "Start with inventory_facets for the property keys, slots, kinds and characters a search can name, then search_items (the Inventory screen's filters; `props` takes \"lrc:20\" for at least 20, \"lrc:le:20\" for at most, \"lrc:eq:20\" for exactly). Rows are compact, with the serials of the container an item sits in and of its root (for container_contents); get_item has the full tooltip. Paged lists take `limit` (25 by default, 100 at most) and `offset` and answer with `total`.",
  "character_sheet, list_runs, get_run, compare_runs and scan_status read characters, saved Suit Builder runs and how fresh the scans are. build_suit runs the Suit Builder for a character with its saved profile (or a template), buffs and pinned pieces, waits up to waitSeconds (45 by default, 50 at most, inside a client's usual 60-second timeout) and returns the suit, or a job id: then poll get_suit_build. One build_suit runs at a time; a new call replaces one still running. score_suit totals a hand-picked suit against a profile. organize_proposal and organize_plan show what Auto organize would set up and the trips the current setup would run; neither changes anything.",
  "In-game tools (highlight_item, go_to_item, grab_item, organize_trip) need \"Allow in-game actions\" on in Pack Rat's Settings and the bridge script running in the game client. They queue one command or one trip through the same bridge the app's buttons use and report what the bridge did within waitSeconds (45 by default, 50 at most); after that, poll get_action_status with the id. stop_actions stops a trip after its current step.",
].join("\n\n");

// ---------------------------------------------------------------- shapes the routes answer with (only what is read)
interface InventoryDoc { characters: Record<string, Character>; containers: Record<string, Container>; worn: Record<string, Item[]>; scans: Array<{ character: string; scannedAt: string }>; itemCount: number; facets: Record<string, unknown> & { kinds: Array<{ name: string; count: number }>; propKeys: string[] } }
interface SetupDoc { settings: { client?: { adapter: string } | null }; bridgeAdapter: string | null; adapters: Array<{ id: string; name?: string; capabilities?: { bridge?: string[] } }> }
interface BridgeStatus { online: boolean; age?: number; character?: string; current?: { id?: string } | null; results?: Record<string, BridgeResult> }
interface BridgeResult { ok: boolean; msg: string; t?: string; partial?: boolean; stopped?: boolean; steps?: Array<{ op: string; serial: number; ok: boolean; msg: string }> }
interface RunDoc { id: string; character?: string; createdAt: string; label?: string; settings?: Record<string, unknown>; result?: Record<string, unknown> | null; ms?: number | null; inventoryStamp?: string | null }
interface PlanMove { serial: number; name: string; amount: number; from: number | null; to: number; ruleId: string; trip: number }
interface PlanDoc { stamp: string; inventoryStamp: string; moves: PlanMove[]; trips: Array<{ index: number; site: number }>; rules: unknown[]; warnings: unknown[]; seconds: number; unclaimed: number }

// ---------------------------------------------------------------- helpers
const PAGE: Record<string, Schema> = {
  limit: { type: "integer", minimum: 1, maximum: 100, description: "Rows per page, 25 by default." },
  offset: { type: "integer", minimum: 0, maximum: 1_000_000, description: "Rows to skip, 0 by default." },
};
const pageOf = (a: Record<string, unknown>): { limit: number; offset: number } => ({ limit: (a.limit as number | undefined) ?? 25, offset: (a.offset as number | undefined) ?? 0 });
const SERIAL: Schema = { type: "integer", minimum: 1, maximum: 0xFFFFFFFF, description: "An item or container serial (the decimal number in Pack Rat's rows)." };
const ID: Schema = { type: "string", pattern: "^[\\w-]{1,64}$" };
const CHARACTER: Schema = { type: "string", minLength: 1, maxLength: 64, description: "A character's name as Pack Rat lists it (list_characters)." };
const BUFF_LIST: Schema = { type: "array", maxItems: 40, items: { type: "string", enum: BUFFS.map((b) => b.id) }, description: "Buffs, forms and abilities counted as always on, by id (the enum lists them; divineFury is Divine Fury)." };
// Every tool that waits for the game or a build stops inside a client's usual 60-second request timeout.
const WAIT_DEFAULT = 45, WAIT_MAX = 50;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ACTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const enc = encodeURIComponent;
const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;
// One compact inventory row: get_item has the rest (tooltip lines, flags, extras, set bonus).
function row(it: Item): Record<string, unknown> {
  return {
    serial: it.serial, name: it.name, ...(it.amount > 1 ? { amount: it.amount } : {}), kind: it.kind, ...(it.slot ? { slot: it.slot } : {}),
    ...(it.rarity ? { rarity: it.rarity } : {}), where: it.location?.text ?? null, ...(it.container != null ? { container: it.container } : {}), ...(it.root != null ? { root: it.root } : {}),
    ...(it.equippedBy ? { wornBy: it.equippedBy } : {}),
    ...(Object.keys(it.props).length ? { props: it.props } : {}), ...(it.slayers?.length ? { slayers: it.slayers } : {}), ...(it.tags.length ? { tags: it.tags } : {}),
  };
}
const nonZero = (m: PropMap | Record<string, number> | undefined): Record<string, number> => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v));
const inventory = async (ctx: ToolContext): Promise<InventoryDoc> => (await ctx.api<{ inventory: InventoryDoc }>("/api/inventory")).inventory;
const scannedCharacter = (inv: InventoryDoc, name: string): Character => {
  if (!Object.hasOwn(inv.characters, name) || isPseudoCharacter(name)) throw new ToolError(`no scans for character ${JSON.stringify(name)}; list_characters names them`);
  return inv.characters[name]!;
};
async function itemsBySerial(ctx: ToolContext, serials: number[]): Promise<Record<string, Item>> {
  return (await ctx.api<{ items: Record<string, Item> }>(`/api/items/by-serial?serials=${serials.join(",")}`)).items;
}
// vault-lib's caps, the Resisting Spells bonus and the profile planning read the shard's rules; the page loads them
// from GET /api/rules before anything else, and so does a tool that needs them (the server's own copy of the module
// is a separate, hot-reloaded instance).
async function loadRules(ctx: ToolContext): Promise<void> { setRules((await ctx.api<{ rules: RulesV1 }>("/api/rules")).rules); }
const newestStamp = (scans: InventoryDoc["scans"]): string => {
  let best = "", ms = -Infinity;
  for (const s of scans) { const t = Date.parse(s.scannedAt); if (t > ms) { ms = t; best = s.scannedAt; } }
  return best;
};

// ---------------------------------------------------------------- the Suit Builder's profile, as the page plans it
// The character's saved profile (vault-lib's characterProfile), a template applied over it like the builder's Apply,
// and the numbers edited for it (ui-prefs). With no hand-picked `suit` it is planned as the Automatic panel's build is
// (buffs.mts's buffPlanOf; the character's Automatic buffs when none are named). With one (score_suit, build_suit with
// pinned pieces or no character) it is planned as Manual plans its suit (buffs.mts's manualProfile: Enhance Potions
// and Spell Channeling read from that suit; Manual's own buffs, while its totals count them, when none are named).
interface Planned { profile: EffectiveProfile; settings: Record<string, unknown>; snapshot: Record<string, unknown>; buffs: string[] }
interface Prefs { autoBuffs?: Record<string, string[]>; manualBuffs?: string[]; buffsCount?: string; buffSkills?: Record<string, Record<string, number>> }
async function planProfile(ctx: ToolContext, inv: InventoryDoc, name: string | null, args: Record<string, unknown>, suit: Record<string, Item> | null): Promise<Planned> {
  await loadRules(ctx);
  const [{ profiles }, { prefs }] = await Promise.all([ctx.api<{ profiles: ProfilesFile }>("/api/profiles"), ctx.api<{ prefs: Prefs }>("/api/ui-prefs")]);
  const c = name ? scannedCharacter(inv, name) : null;
  // profiles.json's caps moved to the shard's rules file (migrateProfiles drops them); the page's working profile has none either.
  const { caps: _caps, ...p }: CharacterEntryRaw & { excludeRoots?: Array<number | string> } = characterProfile(profiles, name ?? "");
  if (typeof args.template === "string") {
    const t = profiles.templates && Object.hasOwn(profiles.templates, args.template) ? profiles.templates[args.template] : undefined;
    if (!t) throw new ToolError(`no template named ${JSON.stringify(args.template)}; the templates are ${Object.keys(profiles.templates || {}).join(", ") || "none"}`);
    Object.assign(p, templateFrom(t), { template: args.template });
  }
  const preset = suit ? (prefs.buffsCount !== "off" ? prefs.manualBuffs : []) : name ? ownEntry(prefs.autoBuffs || {}, name) : null;
  const on = args.buffs !== undefined ? normalizeBuffs(args.buffs) : normalizeBuffs(preset ?? []) ?? [];
  if (!on) throw new ToolError("buffs must be known buff ids");
  const edits = ownEntry(prefs.buffSkills || {}, name ?? "") || {};
  const worn = name ? inv.worn[name] || [] : [];
  const rb: RunBuffs | undefined = runBuffs(on, buffSkillValues(c ? c.skills || {} : null, edits).values);
  const profile = suit ? manualProfile(p, c, worn, suit, c ? p.race || "human" : null, on, edits) : plannedProfile(p, c, buffPlanOf(c, worn, p.race, rb, edits));
  const strLimit = p.strLimit ?? (Number((c?.stats as Record<string, unknown> | undefined)?.str) || 125);
  const settings = { allowOthersWorn: !!p.allowOthersWorn, strLimit, excludeTags: p.excludeTags || [], excludeRoots: p.excludeRoots || [], allowGargoyle: !!p.allowGargoyle, medOnly: !!p.medOnly,
    excludeWeapons: p.excludeWeapons || [], ubwsAnyWeapon: p.ubwsAnyWeapon !== false, excludeSkills: p.excludeSkills || [], lockedSlots: p.lockedSlots || [] };
  // The saved run's settings, as the page's settingsSnapshot writes them (the runs drawer labels and compares from it).
  const snapshot = { ...settings, floors: p.floors || {}, softFloors: p.softFloors || [], weights: p.weights || {}, race: p.race || "human", resistCaps: p.resistCaps || {}, ...(rb ? { buffs: rb } : {}) };
  return { profile, settings, snapshot, buffs: on };
}

// A suit (slot → piece) as names and serials.
const suitRows = (best: Record<string, { serial: number; name: string } | null> | undefined): Record<string, { serial: number; name: string } | null> =>
  Object.fromEntries(Object.entries(best || {}).map(([slot, it]) => [slot, it ? { serial: it.serial, name: it.name } : null]));
// A finished build or saved run, trimmed: the suit, what changes from what is worn, the totals after, and how sure.
function resultSummary(result: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!result) return {};
  const changes = (result.perSlotChanges as Array<{ slot: string; from: string | null; fromSerial: number; to: string | null; toSerial: number }> | undefined) || [];
  return {
    score: result.score ?? null, currentScore: result.currentScore ?? null, method: result.method ?? null, proven: result.proven ?? null,
    suit: suitRows(result.best as Record<string, { serial: number; name: string } | null>),
    changes: changes.map((c) => ({ slot: c.slot, from: c.from, fromSerial: c.fromSerial || null, to: c.to, toSerial: c.toSerial || null })),
    totals: nonZero((result.totals as { after?: Record<string, number> } | undefined)?.after),
    ...(Array.isArray(result.unreachableFloors) && result.unreachableFloors.length ? { unreachableFloors: result.unreachableFloors } : {}),
    ...(Array.isArray(result.alternatives) && result.alternatives.length ? { otherSuits: (result.alternatives as Array<{ best: Record<string, { serial: number; name: string } | null>; score: number }>).map((a) => ({ score: a.score, suit: suitRows(a.best) })) } : {}),
  };
}
interface JobStatus { id: string; state: string; progress: Record<string, unknown> | null; result: Record<string, unknown> | null; ms: number | null; error: string | null; runId: string | null }
// A build that filled empty slots around pinned pieces (memory.filled) leaves out currentScore: it is the pins' own and
// reads as a huge gain beside the score.
function jobSummary(j: JobStatus, memory: ToolContext["memory"]): Record<string, unknown> {
  const filled = memory.filled.has(j.id);
  if (j.state === "done") { const { currentScore, ...rest } = resultSummary(j.result); return { id: j.id, state: "done", runId: j.runId, ms: j.ms, ...rest, ...(filled ? {} : { currentScore }) }; }
  if (j.state === "running") return { id: j.id, state: "running", progress: j.progress ? { phase: j.progress.phase, elapsedMs: j.progress.elapsedMs, bestScore: j.progress.bestScore, explored: j.progress.explored } : null, hint: "poll get_suit_build with this id" };
  if (j.state === "cancelled" && memory.replaced.has(j.id)) return { id: j.id, state: "cancelled", error: "replaced by a newer build_suit call (one build_suit runs at a time)" };
  return { id: j.id, state: j.state, error: j.error };
}

// ---------------------------------------------------------------- in-game actions
// The client the bridge routes to and its heartbeat, as the page's buttons see them.
async function bridgeGate(ctx: ToolContext): Promise<{ adapter: SetupDoc["adapters"][number] | null; status: BridgeStatus }> {
  const [setup, status] = await Promise.all([ctx.api<SetupDoc>("/api/setup"), ctx.api<BridgeStatus>("/api/bridge/status")]);
  const id = setup.settings.client?.adapter ?? setup.bridgeAdapter;
  return { adapter: (id && setup.adapters.find((a) => a.id === id)) || null, status };
}
// Waits up to `seconds` for the bridge to report command `id`: done (its result), running, or still queued. An id
// neither the bridge nor the Organize plan knows, and this server did not queue in the last 5 minutes, is an error,
// so a mistyped or long-expired id is never "queued" for ever.
const QUEUED_FOR_MS = 5 * 60 * 1000;
async function follow(ctx: ToolContext, id: string, seconds: number): Promise<Record<string, unknown>> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const st = await ctx.api<BridgeStatus>("/api/bridge/status");
    const r = st.results?.[id];
    if (r) return { id, state: r.stopped ? "stopped" : r.ok && !(r.steps || []).some((s) => !s.ok) ? "done" : "failed", result: r };
    let state = st.current?.id === id ? "running" : null;
    if (!state) {
      // This server's own record first; the Organize plan (a whole plan computed) only for an id it does not know.
      const at = ctx.memory.actions.get(id);
      if ((at != null && Date.now() - at < QUEUED_FOR_MS) || (await ctx.api<{ running: { id: string } | null }>("/api/organize/plan")).running?.id === id) state = "queued";
      else throw new ToolError("No such action (unknown or expired)");
    }
    if (Date.now() >= until) return { id, state, bridgeOnline: !!st.online, hint: "poll get_action_status with this id" };
    await ctx.sleep(1000);
  }
}
const WAIT: Schema = { type: "integer", minimum: 0, maximum: WAIT_MAX, description: `Seconds to wait for the bridge to report back, ${WAIT_DEFAULT} by default, ${WAIT_MAX} at most; past that the answer carries an id to poll with get_action_status.` };
const waitOf = (a: Record<string, unknown>): number => (a.waitSeconds as number | undefined) ?? WAIT_DEFAULT;
function bridgeTool(action: BridgeAction, name: string, what: string): Tool {
  return {
    name, action: true,
    description: `${what} Needs "Allow in-game actions" on in Pack Rat's Settings and the bridge running in the game client. Same command and checks as the ${BRIDGE_ACTION_LABELS[action]} button.`,
    inputSchema: { type: "object", additionalProperties: false, required: ["serial"], properties: { serial: SERIAL, waitSeconds: WAIT } },
    annotations: { title: BRIDGE_ACTION_LABELS[action], ...ACTS },
    async handler(a, ctx) {
      const serial = a.serial as number;
      const [inv, items, gate] = await Promise.all([inventory(ctx), itemsBySerial(ctx, [serial]), bridgeGate(ctx)]);
      // An item, or a container no item record holds (a ground chest, the root of a scan): Highlight and Go to take one.
      const it = items[serial];
      const box = inv.containers[serial];
      if (!it && !box) throw new ToolError(`nothing with serial ${serial} (${hex(serial)}) in the scans`);
      if (!it && action === "grab") throw new ToolError("Grab takes items, not a container a scan opened at its root");
      const target = it ? { serial, name: it.name, container: it.container, root: it.root, equippedBy: it.equippedBy } : { serial, name: box!.label || box!.name || "container", container: box!.parent ?? null, root: box!.root, equippedBy: null };
      const pos = (target.root != null ? inv.containers[target.root] : null)?.pos || null;
      const refused = bridgeRefusal(action, target, { adapter: gate.adapter, online: !!gate.status.online, hasPos: !!pos });
      if (refused) throw new ToolError(refused);
      const r = await ctx.api<{ id: string }>("/api/bridge", { method: "POST", body: { action, serial, name: target.name || "?", chain: containerChain(inv.containers, target.container), pos } });
      ctx.memory.actions.set(r.id, Date.now());
      return { queuedFor: gate.status.character ?? null, item: target.name, ...await follow(ctx, r.id, waitOf(a)) };
    },
  };
}

// ---------------------------------------------------------------- the tools
export const TOOLS: Tool[] = [
  {
    name: "inventory_facets",
    description: "What a search can name: the characters, gear slots, item kinds, rarities, slayers, weapon skills and yes/no flags in the inventory, and every numeric property key with its full name (lrc = Lower Reagent Cost). Call this first.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { title: "Inventory facets", ...READ },
    async handler(_a, ctx) {
      const inv = await inventory(ctx);
      const f = inv.facets;
      return { characters: Object.keys(inv.characters).filter((n) => !isPseudoCharacter(n)).sort(), itemCount: inv.itemCount, slots: f.slots, kinds: f.kinds, rarities: f.rarities, slayers: f.slayers,
        weaponSkills: f.weaponSkills, flags: f.flagKeys, properties: f.propKeys.map((key) => ({ key, name: fullOf(key) })), extraKeys: [...(f.extraKeys as string[]), ...Object.keys(EXTRA_COLS)] };
    },
  },
  {
    name: "search_items",
    description: "Search the inventory with the Inventory screen's filters. Every filter is optional and they combine; list filters match any of their values, and slots, kinds, slayers and tags match whatever their case. Returns compact rows (serial, name, kind, slot, rarity, where, the container and root serials, wornBy, props); get_item has the full tooltip.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 200, description: "Free text in the name, tooltip lines, kind, rarity or location." },
      character: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 }, description: "Only items these characters hold or wear." },
      slot: { type: "array", maxItems: 30, items: { type: "string", maxLength: 32 }, description: "Gear slots (inventory_facets lists them), \"?\" for none." },
      kind: { type: "array", maxItems: 30, items: { type: "string", maxLength: 32 }, description: "Item kinds: gear, reagent, scroll, …" },
      location: { type: "array", maxItems: 50, items: { type: "string", maxLength: 300 }, description: "Exact location texts, as the rows' `where` shows them." },
      container: { type: "array", maxItems: 50, items: SERIAL, description: "Root container serials: everything anywhere inside them." },
      rarity: { type: "string", maxLength: 64, description: "Exactly this rarity tier." },
      rarityMin: { type: "string", maxLength: 64, description: "This tier or any above it." },
      rarityMax: { type: "string", maxLength: 64, description: "This tier or any below it." },
      slayer: { type: "string", maxLength: 64, description: "A slayer name, or \"*\" for any slayer." },
      props: { type: "array", maxItems: 20, items: { type: "string", pattern: "^[A-Za-z0-9:_ .-]+$", maxLength: 80 }, description: "Property rules, one per entry: \"key:min\" (at least), \"key:le:max\" (at most), \"key:eq:value\" (exactly), keys from inventory_facets." },
      flags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 64 }, description: "Yes/no properties every match must have (\"spell channeling\")." },
      weaponSkills: { type: "array", maxItems: 10, items: { type: "string", maxLength: 64 }, description: "Weapons counting under any of these skills." },
      tags: { type: "array", maxItems: 10, items: { type: "string", maxLength: 32 }, description: "Only items with any of these tags (cursed, antique, brittle, prized, …)." },
      hideTags: { type: "array", maxItems: 10, items: { type: "string", maxLength: 32 }, description: "Leave out items with any of these tags." },
      noGargoyle: { type: "boolean", description: "Leave out gargoyle-only gear." },
      medable: { type: "boolean", description: "Only armor you can meditate in." },
      seenDays: { type: "integer", minimum: 0, maximum: 100000, description: "Only items a scan saw in the last N days." },
      sort: { type: "string", maxLength: 64, description: "name (default), kind, slot, location, rarity, seen, amount, or a property key." },
      reverse: { type: "boolean", description: "Numeric sorts are highest first and text sorts A to Z; this flips them." },
      group: { type: "boolean", description: "One row per item name, with the total amount and where the stacks are." },
      ...PAGE,
    } },
    annotations: { title: "Search items", ...READ },
    async handler(a, ctx) {
      const { limit, offset } = pageOf(a);
      const f = (await inventory(ctx)).facets as InventoryDoc["facets"] & { slots: string[]; slayers: Array<{ name: string }>; extraKeys: string[] };
      // The route matches slots, kinds and slayers exactly and tags in lower case (as scans store them): a model's
      // "Ring" or "Orc Slayer" is mapped onto the inventory's own spelling here.
      const spelled = (known: string[]) => (v: string): string => known.find((k) => k.toLowerCase() === v.toLowerCase()) ?? v;
      const slot = spelled(f.slots), kind = spelled(f.kinds.map((k) => k.name)), slayer = spelled(f.slayers.map((x) => x.name)), lower = (v: string): string => v.toLowerCase();
      // Each property rule must parse the way the route parses it (item-query.mts's parseItemQuery), with a number and a
      // key the inventory has; a rule the route would drop would otherwise search the whole inventory without a word.
      // The Inventory's property filter also takes the extras no property models (strReq, weight: item-query.mts's EXTRA_COLS).
      const known = [...f.propKeys, ...f.extraKeys, ...Object.keys(EXTRA_COLS)], keyOf = spelled(known);
      const props = ((a.props as string[] | undefined) || []).map((rule) => {
        const parsed = parseItemQuery(new URLSearchParams([["prop", rule]])).props;
        const value = rule.split(":").at(-1)!.trim();
        if (parsed.length !== 1 || value === "" || !Number.isFinite(Number(value))) throw new ToolError(`property rule ${JSON.stringify(rule)} is not one of key:min, key:le:max, key:eq:value (a number, a key from inventory_facets)`);
        const key = keyOf(parsed[0]!.key);
        if (!known.includes(key)) throw new ToolError(`property rule ${JSON.stringify(rule)}: no item has the property ${JSON.stringify(parsed[0]!.key)}; inventory_facets lists the keys`);
        return [key, ...rule.split(":").slice(1).map((x) => x.trim())].join(":");
      });
      const sp = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      for (const name of ["q", "rarity", "rarityMin", "rarityMax", "sort", "seenDays"] as const) if (a[name] !== undefined) sp.set(name, String(a[name]));
      if (typeof a.slayer === "string") sp.set("slayer", a.slayer === "*" ? "*" : slayer(a.slayer));
      const lists: Array<[string, string, (v: string) => string]> = [["character", "char", String], ["slot", "slot", slot], ["kind", "kind", kind], ["location", "loc", String], ["container", "root", String],
        ["flags", "flag", String], ["weaponSkills", "wskill", String], ["tags", "tag", lower], ["hideTags", "hide", lower]];
      for (const [arg, param, norm] of lists) for (const v of (a[arg] as unknown[] | undefined) || []) sp.append(param, norm(String(v)));
      for (const rule of props) sp.append("prop", rule);
      if (a.noGargoyle) sp.set("nogarg", "1");
      if (a.medable) sp.set("med", "1");
      if (a.reverse) sp.set("dir", "-1");
      if (a.group) sp.set("group", "1");
      const r = await ctx.api<{ total: number; pieces: number; rows?: Item[]; groups?: Array<Record<string, unknown>> }>(`/api/items?${sp}`);
      if (a.group) return { total: r.total, pieces: r.pieces, offset, groups: (r.groups || []).map((g) => ({ name: g.name, kind: g.kind, slot: g.slot, amount: g.amount, stacks: g.stacks, where: g.locations, serial: g.serial })) };
      return { total: r.total, pieces: r.pieces, offset, items: (r.rows || []).map(row) };
    },
  },
  {
    name: "get_item",
    description: "Everything Pack Rat knows about up to 20 items: name, every tooltip line, properties, flags, tags, rarity, slot, who wears it, where it lives (location and the containers it sits in, root first) and when a scan last saw it.",
    inputSchema: { type: "object", additionalProperties: false, required: ["serials"], properties: { serials: { type: "array", minItems: 1, maxItems: 20, items: SERIAL } } },
    annotations: { title: "Get items", ...READ },
    async handler(a, ctx) {
      const serials = a.serials as number[];
      const [items, inv] = await Promise.all([itemsBySerial(ctx, serials), inventory(ctx)]);
      const name = (s: number): string => { const c = inv.containers[s]; return c?.label || c?.name || hex(s); };
      return { items: serials.filter((s) => items[s]).map((s) => { const it = items[s]!; return { ...it, inside: containerChain(inv.containers, it.container).map((c) => ({ serial: c, name: name(c) })) }; }),
        missing: serials.filter((s) => !items[s]) };
    },
  },
  {
    name: "container_contents",
    description: "What is inside one container (a bank, backpack, house chest or a bag in one), everything nested included, as compact rows. The serial comes from a row's `container` or `root`, get_item's `inside`, or list_characters (backpack, bank).",
    inputSchema: { type: "object", additionalProperties: false, required: ["serial"], properties: { serial: SERIAL, ...PAGE } },
    annotations: { title: "Container contents", ...READ },
    async handler(a, ctx) {
      const serial = a.serial as number, { limit, offset } = pageOf(a);
      const inv = await inventory(ctx);
      const c = inv.containers[serial];
      if (!c) throw new ToolError(`no container with serial ${serial} (${hex(serial)}) in the scans`);
      const head = { serial, name: c.label || c.name || hex(serial), kind: c.kind ?? null, root: c.root, ...(c.capacity ? { capacity: c.capacity } : {}), ...(c.opened === false ? { note: "the newest scan could not open it; its contents are from an older scan" } : {}), scannedAt: c.scannedAt };
      if (c.parent == null) {
        const r = await ctx.api<{ total: number; rows: Item[] }>(`/api/items?root=${serial}&limit=${limit}&offset=${offset}`);
        return { container: head, total: r.total, offset, items: r.rows.map(row) };
      }
      // A bag inside a root: the root's items, kept when the bag is among the containers they sit in.
      const inside = (it: Item): boolean => containerChain(inv.containers, it.container).includes(serial);
      const all: Item[] = [];
      for (let at = 0; ; at += 500) {
        const r = await ctx.api<{ total: number; rows: Item[] }>(`/api/items?root=${c.root}&limit=500&offset=${at}`);
        all.push(...r.rows.filter(inside));
        if (at + 500 >= r.total) break;
      }
      return { container: head, total: all.length, offset, items: all.slice(offset, offset + limit).map(row) };
    },
  },
  {
    name: "list_characters",
    description: "Every scanned character: when they were last scanned, their stats, how many pieces they wear, and their backpack and bank serials (for container_contents).",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { title: "Characters", ...READ },
    async handler(_a, ctx) {
      const inv = await inventory(ctx);
      const roots = (name: string): Record<string, number> => Object.fromEntries(Object.values(inv.containers)
        .filter((c) => c.parent == null && (c.kind === "backpack" || c.kind === "bank") && c.scannedBy === name).map((c) => [c.kind!, c.serial]));
      return { characters: Object.values(inv.characters).filter((c) => !isPseudoCharacter(c.name)).sort((x, y) => x.name.localeCompare(y.name)).map((c) => ({
        name: c.name, scannedAt: c.scannedAt, stats: c.stats, wearing: (inv.worn[c.name] || []).length, ...roots(c.name) })) };
    },
  },
  {
    name: "character_sheet",
    description: "One character's sheet: stats, maximum pools, resists as scanned, skills (non-zero, highest first), the Resisting Spells resist bonus, every worn piece with its properties, and the worn suit's property totals.",
    inputSchema: { type: "object", additionalProperties: false, required: ["character"], properties: { character: CHARACTER } },
    annotations: { title: "Character sheet", ...READ },
    async handler(a, ctx) {
      const inv = await inventory(ctx);
      const c = scannedCharacter(inv, a.character as string);
      await loadRules(ctx);
      const worn = inv.worn[c.name] || [];
      const skills = Object.entries(c.skills || {}).map(([k, v]) => [k, Number((v as { value?: unknown })?.value) || 0] as const).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
      return { name: c.name, scannedAt: c.scannedAt, stats: c.stats, maxes: c.maxes, resists: c.resists, resistBonus: resistSkillBonus(c.skills), skills: Object.fromEntries(skills),
        worn: worn.map((i) => ({ slot: i.slot, serial: i.serial, name: i.name, props: i.props })), wornTotals: nonZero(totalsOf(Object.fromEntries(worn.map((i) => [String(i.serial), toOptItem(i)])))) };
    },
  },
  {
    name: "list_item_kinds",
    description: "How many items of each kind the inventory holds, and the kinds the player set by hand (Classify this… in the Inventory), by item name and by graphic.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { title: "Item kinds", ...READ },
    async handler(_a, ctx) {
      const [inv, own] = await Promise.all([inventory(ctx), ctx.api<{ names: Record<string, string>; graphics: Record<string, string> }>("/api/item-kinds")]);
      return { kinds: inv.facets.kinds, playerSet: { names: own.names, graphics: own.graphics } };
    },
  },
  {
    name: "list_scrolls",
    description: "Power scrolls (type power, by their level) or Scrolls of Transcendence (type transcendence, by their points), one row per scroll name with the total and where the stacks are, as the Scrolls screen counts them.",
    inputSchema: { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["power", "transcendence"], description: "power by default." }, ...PAGE } },
    annotations: { title: "Scrolls", ...READ },
    async handler(a, ctx) {
      const { limit, offset } = pageOf(a);
      const prop = a.type === "transcendence" ? "sotPoints:0.1" : "psLevel:1";
      const r = await ctx.api<{ total: number; pieces: number; groups: Array<Record<string, unknown>> }>(`/api/items?prop=${prop}&group=1&limit=${limit}&offset=${offset}`);
      return { type: a.type ?? "power", total: r.total, scrolls: r.pieces, offset, groups: r.groups.map((g) => ({ name: g.name, amount: g.amount, where: g.locations })) };
    },
  },
  {
    name: "list_runs",
    description: "Saved Suit Builder runs, newest first: id, character, when, name, method, whether the suit is proven best, score and how many slots change. get_run opens one.",
    inputSchema: { type: "object", additionalProperties: false, properties: { character: CHARACTER, ...PAGE } },
    annotations: { title: "Saved runs", ...READ },
    async handler(a, ctx) {
      const { limit, offset } = pageOf(a);
      const { runs } = await ctx.api<{ runs: Array<Record<string, unknown>> }>(`/api/runs${a.character ? `?character=${enc(a.character as string)}` : ""}`);
      return { total: runs.length, offset, runs: runs.slice(offset, offset + limit).map((r) => ({ id: r.id, character: r.character, createdAt: r.createdAt, label: r.label || null,
        method: r.method, proven: r.proven, score: r.score, delta: r.delta, changes: r.changes })) };
    },
  },
  {
    name: "get_run",
    description: "One saved run: the suit it found, what changes from what was worn, its property totals, and the settings it ran with (floors, weights, buffs).",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID } },
    annotations: { title: "Saved run", ...READ },
    async handler(a, ctx) {
      const { run } = await ctx.api<{ run: RunDoc }>(`/api/runs/${enc(a.id as string)}`);
      const s = run.settings || {};
      return { id: run.id, character: run.character, createdAt: run.createdAt, label: run.label || null, ms: run.ms ?? null, inventoryStamp: run.inventoryStamp ?? null,
        settings: { floors: s.floors, weights: s.weights, race: s.race, buffs: s.buffs, lockedSlots: s.lockedSlots }, ...resultSummary(run.result) };
    },
  },
  {
    name: "compare_runs",
    description: "Two or three saved runs side by side: each run's score and method, the piece each puts in every slot, each property total, and each run's floors.",
    inputSchema: { type: "object", additionalProperties: false, required: ["ids"], properties: { ids: { type: "array", minItems: 2, maxItems: 3, items: ID } } },
    annotations: { title: "Compare runs", ...READ },
    async handler(a, ctx) {
      const runs = await Promise.all((a.ids as string[]).map(async (id) => (await ctx.api<{ run: RunDoc }>(`/api/runs/${enc(id)}`)).run));
      const sums = runs.map((r) => resultSummary(r.result));
      const suits = sums.map((s) => (s.suit || {}) as Record<string, { name: string } | null>);
      const totals = sums.map((s) => (s.totals || {}) as Record<string, number>);
      const slots = [...new Set(suits.flatMap((s) => Object.keys(s)))].filter((k) => GEAR_SLOTS.includes(k));
      const keys = [...new Set(totals.flatMap((t) => Object.keys(t)))].sort();
      return {
        runs: runs.map((r, i) => ({ id: r.id, character: r.character, label: r.label || null, createdAt: r.createdAt, score: sums[i]!.score, method: sums[i]!.method, proven: sums[i]!.proven, floors: (r.settings || {}).floors || {} })),
        slots: Object.fromEntries(slots.map((k) => [k, suits.map((s) => s[k]?.name ?? null)])),
        totals: Object.fromEntries(keys.map((k) => [k, totals.map((t) => t[k] ?? 0)])),
      };
    },
  },
  {
    name: "scan_status",
    description: "How fresh the data is: each character's last scan, the number of scans folded, and whether the in-game bridge is running (and on which character).",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { title: "Scan status", ...READ },
    async handler(_a, ctx) {
      const [inv, st, { settings }] = await Promise.all([inventory(ctx), ctx.api<BridgeStatus>("/api/bridge/status"), ctx.api<{ settings: { client?: { adapter: string } | null } }>("/api/settings")]);
      return { scans: inv.scans.length, newestScan: newestStamp(inv.scans) || null, client: settings.client?.adapter ?? null,
        characters: Object.values(inv.characters).filter((c) => !isPseudoCharacter(c.name)).map((c) => ({ name: c.name, scannedAt: c.scannedAt })),
        bridge: { online: !!st.online, character: st.character ?? null, secondsSinceHeartbeat: Number.isFinite(st.age) ? st.age : null } };
    },
  },
  {
    name: "build_suit",
    description: "Run the Suit Builder (its exact search) for a character with their saved Suit Builder profile, optionally a template applied over it, buffs counted as on, and pinned pieces kept in their slots. Waits up to waitSeconds and returns the suit, the changes from what they wear and the totals; a longer build answers with an id: poll get_suit_build. A finished build is saved as a run (list_runs), except one with pinned pieces or no character, which fills only the empty slots like Manual's \"Fill the rest automatically\" and is planned as Manual plans. One build_suit runs at a time: a new call replaces one still running from this tool (never the app's own), and the replaced one says so.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      character: CHARACTER,
      noCharacter: { type: "boolean", description: "Build from pieces nobody wears, on raw item totals (no Resisting Spells bonus, race or stats), as Manual's No character does. Leave character out." },
      template: { type: "string", minLength: 1, maxLength: 120, description: "A template's name, applied over the character's profile (the Suit Builder's templates)." },
      buffs: { ...BUFF_LIST, description: "Buffs, forms and abilities counted as always on, by id. With none named: the character's Automatic buffs, or with pinned pieces or no character, Manual's buffs (while its totals count them)." },
      pinned: { type: "object", additionalProperties: SERIAL, description: `Pieces kept in place, slot → serial (slots: ${GEAR_SLOTS.join(", ")}); only the other slots are searched.` },
      timeBudgetSeconds: { type: "integer", minimum: 1, maximum: 3600, description: "How long the exact search may take, 60 by default." },
      otherSuits: { type: "integer", minimum: 0, maximum: 20, description: "Also list this many next-best suits (0 by default)." },
      waitSeconds: { type: "integer", minimum: 0, maximum: WAIT_MAX, description: `How long to wait for the result, ${WAIT_DEFAULT} seconds by default, ${WAIT_MAX} at most; then poll get_suit_build.` },
    } },
    annotations: { title: "Build a suit", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(a, ctx) {
      const name = typeof a.character === "string" ? a.character : null;
      if (!name === !a.noCharacter) throw new ToolError("name a character, or set noCharacter (not both)");
      // No pins at all (an empty map included) is an ordinary build; No character always fills, around no pins.
      const given = a.pinned as Record<string, number> | undefined;
      const pinned = given && Object.keys(given).length ? given : name ? undefined : {};
      const inv = await inventory(ctx);
      let suit: Record<string, Item> | null = null;
      if (pinned) {
        const found = Object.keys(pinned).length ? await itemsBySerial(ctx, Object.values(pinned)) : {};
        suit = Object.fromEntries(Object.entries(pinned).flatMap(([slot, serial]) => (found[serial] ? [[slot, found[serial]!]] : [])));
      }
      const plan = await planProfile(ctx, inv, name, a, suit);
      const budget = ((a.timeBudgetSeconds as number | undefined) ?? 60) * 1000, alt = (a.otherSuits as number | undefined) ?? 0;
      const opts = { restarts: 200, exact: true, timeBudgetMs: budget, ...(alt ? { alternatives: { count: alt, tolerance: 0 } } : {}) };
      const body = { character: name, settings: plan.settings, profile: plan.profile, opts, ...(pinned ? { pinned } : {}),
        ...(name ? { meta: { character: name, settings: { ...plan.snapshot, restarts: 200, exact: true, budgetMs: budget, altCount: alt, altTol: 0 }, inventoryStamp: newestStamp(inv.scans) } } : {}) };
      const r = await ctx.api<{ id?: string; cached?: boolean; run?: RunDoc; superseded?: string | null; warning?: string; poolSize: number }>("/api/optimize", { method: "POST", body, clientId: "mcp" });
      if (r.superseded) ctx.memory.replaced.add(r.superseded);
      if (pinned && r.id) ctx.memory.filled.add(r.id);
      const head = { character: name, buffs: plan.buffs, poolSize: r.poolSize, ...(r.warning ? { warning: r.warning } : {}), ...(r.superseded ? { superseded: r.superseded } : {}) };
      if (r.cached && r.run) return { ...head, state: "done", reused: true, runId: r.run.id, ms: r.run.ms ?? null, ...resultSummary(r.run.result) };
      const until = Date.now() + waitOf(a) * 1000;
      for (;;) {
        const j = await ctx.api<JobStatus>(`/api/optimize/${r.id}/status`);
        if (j.state !== "running" || Date.now() >= until) return { ...head, ...jobSummary(j, ctx.memory) };
        await ctx.sleep(500);
      }
    },
  },
  {
    name: "get_suit_build",
    description: "A build's progress, or its result once done (the suit, changes and totals), by the id build_suit answered with. Results are kept 10 minutes after a build ends.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID } },
    annotations: { title: "Build status", ...READ },
    async handler(a, ctx) { return jobSummary(await ctx.api<JobStatus>(`/api/optimize/${enc(a.id as string)}/status`), ctx.memory); },
  },
  {
    name: "score_suit",
    description: "Total a hand-picked suit the way Manual does: its property totals and every floor and weighted property of the character's profile (or a template) against them, planned with the buffs Manual counts (or those named), Enhance Potions and Spell Channeling read from this suit. Unnamed slots keep what the character wears unless keepWorn is false. Resist values are item totals; add resistBonus for the paperdoll.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      character: CHARACTER,
      noCharacter: { type: "boolean", description: "Score on raw item totals with no character (leave character out)." },
      pieces: { type: "array", maxItems: 20, items: SERIAL, description: "The serials of the pieces, one per slot; none scores what the character wears." },
      keepWorn: { type: "boolean", description: "Fill the slots not named with what the character wears (true by default)." },
      template: { type: "string", minLength: 1, maxLength: 120, description: "A template's name, applied over the character's profile." },
      buffs: BUFF_LIST,
    } },
    annotations: { title: "Score a suit", ...READ },
    async handler(a, ctx) {
      const name = typeof a.character === "string" ? a.character : null;
      if (!name === !a.noCharacter) throw new ToolError("name a character, or set noCharacter (not both)");
      const serials = (a.pieces as number[] | undefined) ?? [];
      const [inv, items] = await Promise.all([inventory(ctx), serials.length ? itemsBySerial(ctx, serials) : Promise.resolve({} as Record<string, Item>)]);
      const suit: Record<string, Item> = {};
      for (const s of serials) {
        const it = items[s];
        if (!it?.gear || !it.slot || !GEAR_SLOTS.includes(it.slot)) throw new ToolError(`${hex(s)} is not a gear piece in your scans`);
        if (suit[it.slot]) throw new ToolError(`two pieces for the ${it.slot} slot: ${suit[it.slot]!.name} and ${it.name}`);
        suit[it.slot] = it;
      }
      if (suit.twoHanded?.twoHanded && suit.oneHanded) throw new ToolError("a two-handed weapon leaves the one-hand slot empty");
      if (name && a.keepWorn !== false) {
        // A worn piece fills an unnamed slot unless it would put a one-hander beside a named two-hander, or the reverse.
        for (const w of inv.worn[name] || []) {
          if (!w.slot || !GEAR_SLOTS.includes(w.slot) || suit[w.slot]) continue;
          if ((w.slot === "oneHanded" && suit.twoHanded?.twoHanded) || (w.slot === "twoHanded" && w.twoHanded && suit.oneHanded)) continue;
          suit[w.slot] = w;
        }
      }
      const plan = await planProfile(ctx, inv, name, a, suit);
      const totals = totalsOf(Object.fromEntries(Object.entries(suit).map(([slot, it]) => [slot, toOptItem(it)])));
      return { character: name, buffs: plan.buffs, resistBonus: plan.profile.resistBonus, suit: Object.fromEntries(Object.entries(suit).map(([slot, it]) => [slot, { serial: it.serial, name: it.name }])),
        totals: nonZero(totals), requirements: requirementReport(totals, plan.profile).map(({ key, label, value, floor, cap, met }) => ({ key, label, value, floor, cap, met })) };
    },
  },
  {
    name: "organize_proposal",
    description: "What Auto organize would set up over the player's house chests (strategy simple, detailed or build; every usable chest unless `containers` names some): the groups, which chests they get, what is short, and the trips it would plan. Read-only: nothing is saved; the player accepts a proposal in the Organize screen.",
    inputSchema: { type: "object", additionalProperties: false, required: ["strategy"], properties: {
      strategy: { type: "string", enum: ["simple", "detailed", "build"] },
      containers: { type: "array", maxItems: 200, items: SERIAL, description: "Ground chest serials to use." },
    } },
    annotations: { title: "Organize proposal", ...READ },
    async handler(a, ctx) {
      const { proposal } = await ctx.api<{ proposal: Record<string, unknown> }>("/api/organize/propose", { method: "POST", body: { strategy: a.strategy, ...(a.containers ? { containers: a.containers } : {}) } });
      // The whole setup it would save (config) and every chest it looked at (candidates) stay out: the groups say what goes where.
      const { config: _config, candidates: _candidates, ...rest } = proposal;
      return rest;
    },
  },
  {
    name: "organize_plan",
    description: "The trips the saved Organize setup would run now: each trip's moves (item, from, to, rule), warnings, and the plan's stamp, which organize_trip needs. Also the trip still running, if any. Read-only.",
    inputSchema: { type: "object", additionalProperties: false, properties: { ...PAGE } },
    annotations: { title: "Organize plan", ...READ },
    async handler(a, ctx) {
      const { limit, offset } = pageOf(a);
      const [{ plan, running }, inv] = await Promise.all([ctx.api<{ plan: PlanDoc; running: unknown }>("/api/organize/plan"), inventory(ctx)]);
      const name = (s: number | null): string | null => s == null ? "backpack" : inv.containers[s]?.label || inv.containers[s]?.name || hex(s);
      const trips = plan.trips.slice(offset, offset + limit).map((t) => ({ index: t.index, site: t.site,
        moves: plan.moves.filter((m) => m.trip === t.index).map((m) => ({ serial: m.serial, name: m.name, amount: m.amount, from: name(m.from), to: name(m.to), rule: m.ruleId })) }));
      return { stamp: plan.stamp, inventoryStamp: plan.inventoryStamp, seconds: plan.seconds, moves: plan.moves.length, unclaimed: plan.unclaimed, total: plan.trips.length, offset, trips, warnings: plan.warnings, running };
    },
  },
  bridgeTool("highlight", "highlight_item", "Highlight an item (or a container) in game for a few seconds, opening the containers down to it."),
  bridgeTool("goto", "go_to_item", "Walk the character to the ground container an item is in (its scanned position)."),
  bridgeTool("grab", "grab_item", "Move an item into the backpack of the character the bridge runs on, walking to it and opening the containers down to it."),
  {
    name: "organize_trip",
    description: "Run one trip of the current Organize plan (organize_plan lists them, with the stamp to pass), through the bridge: the character walks to the chests, takes the trip's items and puts each where its rule says. One trip at a time, and trips at the same site run in order: a later one is refused until the site's first has run. Answers with what the bridge did (steps done, failed steps and why, and which moves were made) once it reports back within waitSeconds, else an id: poll get_action_status. Needs \"Allow in-game actions\" on.",
    action: true,
    inputSchema: { type: "object", additionalProperties: false, required: ["index", "stamp"], properties: {
      index: { type: "integer", minimum: 1, maximum: 10000, description: "The trip's number." },
      stamp: { type: "string", minLength: 1, maxLength: 64, description: "The plan's stamp from organize_plan; a plan that changed since is refused." },
      waitSeconds: WAIT,
    } },
    annotations: { title: "Run an Organize trip", ...ACTS },
    async handler(a, ctx) {
      const st = await ctx.api<BridgeStatus>("/api/bridge/status");
      if (!st.online) throw new ToolError(BRIDGE_OFFLINE);
      const [{ plan }, inv] = await Promise.all([ctx.api<{ plan: PlanDoc }>("/api/organize/plan"), inventory(ctx)]);
      const where = (s: number | null): string => s == null ? "backpack" : inv.containers[s]?.label || inv.containers[s]?.name || hex(s);
      const moves = plan.moves.filter((m) => m.trip === a.index).map((m) => ({ serial: m.serial, name: m.name, from: where(m.from), to: where(m.to) }));
      const r = await ctx.api<{ id: string; index: number }>("/api/organize/trip", { method: "POST", body: { index: a.index, stamp: a.stamp } });
      ctx.memory.actions.set(r.id, Date.now());
      const out = await follow(ctx, r.id, waitOf(a));
      // A move counts as made only when a put step for its item succeeded: a trip the bridge refused, or one that
      // stopped partway, reports no step for the moves it never reached.
      const steps = (out.result as BridgeResult | undefined)?.steps || [];
      const reported = out.state !== "queued" && out.state !== "running";
      return { index: r.index, ...out, moves: moves.map((m) => ({ ...m, ...(reported ? { moved: steps.some((s) => s.op === "put" && s.serial === m.serial && s.ok) } : {}) })) };
    },
  },
  {
    name: "get_action_status",
    description: "Where an in-game command or Organize trip stands, by the id highlight_item, go_to_item, grab_item or organize_trip answered with: queued, running, done, failed or stopped, with the bridge's own report (and each step's for a trip).",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: ID } },
    annotations: { title: "Action status", ...READ },
    async handler(a, ctx) { return follow(ctx, a.id as string, 0); },
  },
  {
    name: "stop_actions",
    description: "Stop a running Organize trip after its current step (the Organize screen's Stop). Works even with \"Allow in-game actions\" off.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { title: "Stop", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(_a, ctx) { await ctx.api("/api/bridge/stop", { method: "POST", body: {} }); return { stopped: true }; },
  },
];
