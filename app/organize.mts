// organize.mts — Organize's planner (issue #11): which item goes from which container to which, in which trip,
// and what does not fit. Pure and deterministic: the same inventory, setup and overlay give the same plan byte
// for byte, because every walk below runs in serial order. Nothing here reads or writes a file; the server
// (GET /api/organize/plan, POST /api/organize/trip) hands everything in.
import { matchesItem } from "./item-query.mts";
import { parseStamp } from "./scan-schema.mts";
import { CATCH_ALL_ID, EMPTY_BAGS_ID, type Build, type OrganizeConfig, type RuleMatch } from "./organize-config.mts";
import { RESIST_KEYS, spellSchoolOf, TRASH_RE, locationOf, type Character, type Container, type ContainerCapacity, type Inventory, type Item } from "./vault-lib.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";
import type { TripInput } from "./bridge-trip.mts";

export type WarningKind = "stale-container" | "missing-target" | "missing-label" | "unknown-capacity" | "old-scripts" | "blacklisted" | "no-position" | "not-ground" | "nearly-full";
export interface PlanWarning { kind: WarningKind; serial: number; detail: string }

// A container last scanned longer ago than this is warned about, and still planned: the bridge rechecks live
// state before every step.
export const STALE_MS = 7 * 864e5;
const bySerial = (a: number, b: number): number => a - b;
export const stampMs = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };

// A container and every container around it, innermost first: [container, parent, …, root]. Null when a link
// is missing from the fold or the chain runs past eight (the bridge opens at most eight containers).
export function ancestry(inv: Inventory, serial: number | null): number[] | null {
  const out: number[] = [];
  for (let cur: number | null = serial; cur != null;) {
    const c = inv.containers[cur];
    if (!c || out.length >= 8) return null;
    out.push(+c.serial);
    cur = c.parent ?? null;
  }
  return out.length ? out : null;
}

type Pos = { x: number; y: number; z: number; facet?: number | undefined };
// A position the bridge can walk to: whole tiles on the map (bridge.v1.schema.json's own bounds).
export function posOk(p: Record<string, number> | null | undefined): boolean {
  return !!p && [p.x, p.y, p.z].every((v) => Number.isInteger(v)) && p.x! >= 0 && p.x! <= 7168 && p.y! >= 0 && p.y! <= 4096 && p.z! >= -128 && p.z! <= 127;
}
const posOf = (inv: Inventory, serial: number): Pos => inv.containers[serial]!.pos as unknown as Pos;

export interface ScopeOptions { now: number; blacklist?: number[] | undefined; seen?: Record<string, string> | undefined }
export interface Scope {
  roots: number[];          // labelled ground roots with a position: the only places items are taken from
  siteRoots: number[];      // those, plus the roots of labelled bags: every place a trip may go
  movable: number[];        // item serials that may move
  usable: Set<number>;      // labelled containers a put may go into
  warnings: PlanWarning[];
}

// Labels define the playing field (spec §1): items move only out of labelled ground roots, and only into
// labelled containers. Never out of or into a pinned or blacklisted container (or one inside one), never out
// of a bag the newest scan could not open (the fold keeps older contents there), never a bag or a trash container
// itself (scanners record a trash barrel as a plain item, since they never open one), and never into a container whose fill (or whose surroundings' fill) the scans do not state.
export function scopeOf(inv: Inventory, cfg: OrganizeConfig, { now, blacklist = [], seen = {} }: ScopeOptions): Scope {
  const black = new Set(blacklist);
  const pinned = new Set(Object.values(cfg.labels).filter((l) => l.pinned).map((l) => l.serial));
  const pinnedItems = new Set(cfg.pinnedItems);
  const targets = new Set([...cfg.rules.flatMap((r) => r.targets), ...(cfg.catchAll != null ? [cfg.catchAll] : [])]);
  const warnings: PlanWarning[] = [];
  const warn = (kind: WarningKind, serial: number, detail: string): void => { warnings.push({ kind, serial, detail }); };
  const roots = new Set<number>(), siteRoots = new Set<number>(), usable = new Set<number>();
  for (const serial of Object.values(cfg.labels).map((l) => l.serial).sort(bySerial)) {
    const c = inv.containers[serial];
    if (!c) { warn("missing-label", serial, seen[serial] ? `not seen since ${seen[serial]}` : "not in any scan"); continue; }
    const chain = ancestry(inv, serial);
    const root = chain ? inv.containers[chain.at(-1)!] : undefined;
    if (!chain || !root) continue;
    if (root.kind !== "ground") { warn("not-ground", serial, "only containers on the ground can be organized"); continue; }
    if (chain.some((s) => black.has(s))) { warn("blacklisted", serial, "it is blacklisted: nothing is taken out of it or put into it"); continue; }
    if (!posOk(root.pos)) { warn("no-position", +root.serial, "its scan has no position, so the bridge cannot walk to it"); continue; }
    if (now - stampMs(c.scannedAt) > STALE_MS) warn("stale-container", serial, `last scanned ${c.scannedAt}`);
    siteRoots.add(+root.serial);
    if (+root.serial === serial) roots.add(serial);
    if (chain.some((s) => pinned.has(s))) continue;
    const unknown = chain.find((s) => !inv.containers[s]!.capacity);
    if (unknown == null) { usable.add(serial); continue; }
    if (!targets.has(serial)) continue;
    const u = inv.containers[unknown]!;
    if (u.parent == null && !u.tooltip?.length) warn("old-scripts", unknown, "rescan with TazUO scripts 2.9.0, Razor Enhanced 1.9.0 or the ClassicUO web scanner 1.3.0 or later to read how full it is");
    else warn("unknown-capacity", unknown, "its tooltip has no Contents line, so nothing is put into it");
  }
  const movable = Object.values(inv.items).filter((it) => {
    if (it.root == null || !roots.has(+it.root) || it.equippedBy || it.kind === "container" || inv.containers[it.serial] || TRASH_RE.test(it.name) || pinnedItems.has(+it.serial)) return false;
    const chain = ancestry(inv, it.container);
    return !!chain && chain.at(-1) === +it.root && !chain.some((s) => pinned.has(s) || black.has(s) || inv.containers[s]!.opened === false);
  }).map((it) => +it.serial).sort(bySerial);
  return { roots: [...roots].sort(bySerial), siteRoots: [...siteRoots].sort(bySerial), movable, usable, warnings };
}

// Issue #128: the bags trips leave behind. Organize moves items out of the bags inside a chest into their rule's
// chest, never the bag itself, and each empty bag still takes one of the chest's item slots. An empty bag is an
// unlabelled bag (so never a rule's target, the catch-all or the gather container) that is not a pinned item or
// blacklisted, holds nothing as the view stands (`inv` and `counts` after applyOverlay: nothing is filed in it and
// its Contents line, when it has one, reads 0), and sits in one of `roots` (scopeOf's labelled ground roots) with
// nothing pinned, blacklisted or unopened around it. A bag the newest scan could not open is never one: its
// contents are unknown, not nothing. `container` is the bag's place as the overlay has it. Serial order.
export interface EmptyBag { serial: number; name: string; container: number }
export function emptyBagsOf(inv: Inventory, counts: Map<number, ContainerCapacity>, cfg: OrganizeConfig, roots: readonly number[], blacklist: readonly number[] = []): EmptyBag[] {
  const inRoots = new Set(roots), black = new Set(blacklist), pinnedItems = new Set(cfg.pinnedItems);
  const pinned = new Set(Object.values(cfg.labels).filter((l) => l.pinned).map((l) => l.serial));
  const holding = new Set(Object.values(inv.items).flatMap((it) => (it.container == null ? [] : [+it.container])));
  const out: EmptyBag[] = [];
  for (const it of Object.values(inv.items)) {
    const s = +it.serial, c = inv.containers[s];
    if (!c || it.kind !== "container" || it.container == null || it.root == null || !inRoots.has(+it.root) || cfg.labels[String(s)] || pinnedItems.has(s) || black.has(s)
      || c.opened === false || holding.has(s) || (counts.get(s)?.items ?? 0) > 0) continue;
    const chain = ancestry(inv, it.container);
    if (!chain || chain.at(-1) !== +it.root || chain.some((a) => pinned.has(a) || black.has(a) || inv.containers[a]!.opened === false)) continue;
    out.push({ serial: s, name: it.name, container: +it.container });
  }
  return out.sort((a, b) => a.serial - b.serial);
}

const STACK_COUNT = /^\d[\d,]*\s+/;
// An item's name without its stack count ("75 Grave Dust" → "grave dust"), lower-cased: what rule names and
// stack merges compare.
export const baseName = (name: string): string => name.replace(STACK_COUNT, "").trim().toLowerCase();
// What a rule's names and an item's name compare as (issue #123): lower-cased with everything that is not a letter or
// a digit removed, so the shard's "Blood Moss", "Batwing" and "Spiders' Silk" meet "bloodmoss", "bat wing" and
// "spiders silk". An item's name loses its stack count first; a rule's name keeps a leading number ("120 skill").
const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const nameKey = (name: string): string => squash(baseName(name));

// By build's markers (issue #91): vault-lib's property keys, and the skills (lower-cased, as `extras` keys them)
// whose bonus marks a piece. Spell Channeling has no number, so it is read from the flags; Mage Weapon reads as a
// negative skill penalty, so any value marks it.
export const CASTER_PROPS = ["lmc", "lrc", "sdi", "fc", "fcr", "mageWeapon"];
export const CASTER_SKILLS = ["magery", "evaluating intelligence", "evaluate intelligence", "meditation", "mysticism", "spellweaving", "necromancy", "focus"];
export const MELEE_PROPS = ["hci", "di", "ssi", "hitLifeLeech", "hitManaLeech", "hitStamLeech", "hitLowerDef", "hitLowerAttack", "hitFireball", "hitLightning",
  "hitHarm", "hitMagicArrow", "hitDispel", "hitPoisonArea", "hitFireArea", "hitColdArea", "hitEnergyArea", "hitPhysArea"];
export const MELEE_SKILLS = ["swordsmanship", "tactics", "anatomy", "archery", "fencing", "mace fighting", "wrestling", "throwing", "bushido", "ninjitsu",
  "chivalry", "parrying"];
// A piece's summed resists at least this, with no caster or melee marker, is Tank gear.
const TANK_RESISTS = 20;
// What makes a one-handed piece a spellbook (Spellbook, Necromancer Spellbook, Book Of Bushido…):
// Detailed's Spellbooks group and By build (issue #129) read it the same way.
export const SPELLBOOK_NAMES: readonly string[] = ["spellbook", "book of", "tome"];
// Which build a piece of gear is: the side with more distinct markers, Hybrid on a tie. A piece with none is Caster when
// it is a spellbook (issue #129: every one, a Book Of Chivalry or Bushido too), Melee when it is a weapon (it has a
// damage range), else Tank when it is a shield (issue #123: held in the two-handed slot and not a two-handed weapon, as
// vault-lib classifies shields) or its resists add up to TANK_RESISTS, else Other.
export function buildOf(it: Item): Build {
  const n = (keys: string[], skills: string[]): number => keys.filter((k) => (k === "mageWeapon" ? !!it.props[k] : (it.props[k] ?? 0) > 0)).length
    + skills.filter((k) => { const v = it.extras[k]; return typeof v === "number" && v > 0; }).length;
  const caster = n(CASTER_PROPS, CASTER_SKILLS) + (it.flags.includes("spell channeling") ? 1 : 0), melee = n(MELEE_PROPS, MELEE_SKILLS);
  if (caster || melee) return caster > melee ? "caster" : melee > caster ? "melee" : "hybrid";
  if (it.slot === "oneHanded" && hasName(it, SPELLBOOK_NAMES)) return "caster";
  if (Array.isArray(it.extras["weapon damage"])) return "melee";
  if (it.slot === "twoHanded" && !it.twoHanded) return "tank";
  return RESIST_KEYS.reduce((sum, k) => sum + (it.props[k] ?? 0), 0) >= TANK_RESISTS ? "tank" : "other";
}

// A rule's filter: the item query (location-free, item-query.mts's matchesItem) and, when given, any of the names
// (compared as nameKeys; a name with no letter or digit matches nothing), the build (gear only) and the spell school
// (spell scrolls only). `suits` holds the serials of every saved Suit Builder run's pieces (issue #133: the server
// reads them from <data>/runs), which a rule with skipSuits leaves alone.
const NO_SUITS: ReadonlySet<number> = new Set();
export function ruleMatches(it: Item, m: RuleMatch, rarity: RulesV1RarityItem[] = [], suits: ReadonlySet<number> = NO_SUITS): boolean {
  if (m.skipSuits && suits.has(it.serial)) return false;
  if (m.build && (!it.gear || buildOf(it) !== m.build)) return false;
  if (m.school && spellSchoolOf(baseName(it.name), it.graphic) !== m.school) return false;
  if (m.names?.length && !hasName(it, m.names)) return false;
  return matchesItem(it, m.query, { rarity });
}
// Whether an item's name holds any of the names, compared as ruleMatches says.
function hasName(it: Item, names: readonly string[]): boolean {
  const n = nameKey(it.name);
  return names.some((w) => { const k = squash(w); return !!k && n.includes(k); });
}

// What a rule filter would take if it were the only rule (the rule editor's live count, POST
// /api/organize/match): the movable items in labelled roots it matches, their pieces (stack amounts) and up to
// five of their names, stack counts stripped, distinct and in name order.
export function matchCount(inv: Inventory, cfg: OrganizeConfig, m: RuleMatch, opts: ScopeOptions & { rarity?: RulesV1RarityItem[] | undefined; suitPieces?: ReadonlySet<number> | undefined }): { count: number; pieces: number; sample: string[] } {
  const hits = scopeOf(inv, cfg, opts).movable.map((s) => inv.items[s]!).filter((it) => ruleMatches(it, m, opts.rarity, opts.suitPieces));
  const names = [...new Set(hits.map((it) => it.name.replace(STACK_COUNT, "").trim()))].sort((a, b) => a.localeCompare(b, "en"));
  return { count: hits.length, pieces: hits.reduce((n, it) => n + (it.amount ?? 1), 0), sample: names.slice(0, 5) };
}

export interface Claim { ruleId: string; alsoMatched: string[] }
// First match wins (spec §1): the first rule whose filter passes claims the item and the others that pass are
// only recorded. An item no rule claims goes to the catch-all, or stays put (null) when there is none.
export function claimOf(it: Item, cfg: OrganizeConfig, rarity: RulesV1RarityItem[] = [], suits: ReadonlySet<number> = NO_SUITS): Claim | null {
  const hits = cfg.rules.filter((r) => ruleMatches(it, r.match, rarity, suits)).map((r) => r.id);
  if (hits.length) return { ruleId: hits[0]!, alsoMatched: hits.slice(1) };
  return cfg.catchAll != null ? { ruleId: CATCH_ALL_ID, alsoMatched: [] } : null;
}

// One confirmed step of a trip, from the results overlay (organize-state.json, app/organize-state.mts): the item
// left `from` and is now in `to`, or in the backpack of the character that ran the trip when `to` is null (taken,
// not yet put). `at` is the bridge's clock when the trip reported back; `character` is whose client the bridge ran
// the trip in, when its status file said (issue #127: where a carried item reads as being).
export interface OverlayMove { serial: number; name: string; from: number | null; to: number | null; at: string; trip: string; character?: string | undefined }
export interface Carried { serial: number; name: string }
// The inventory as the overlay says it stands: moved items re-homed, and every container's fill (a copy of its
// Contents line) adjusted for the steps it does not yet include.
export interface Placed { inv: Inventory; counts: Map<number, ContainerCapacity>; carried: Carried[] }

// Spec §2.2: confirmed moves are applied before planning, so a finished trip is not planned again before the next
// scan. A step the item's own scan has seen since is over; a container's line read after the step already counts it.
export function applyOverlay(inv: Inventory, overlay: OverlayMove[]): Placed {
  const items: Record<string, Item> = Object.assign(Object.create(null) as Record<string, Item>, inv.items);
  const counts = new Map<number, ContainerCapacity>();
  for (const c of Object.values(inv.containers)) if (c.capacity) counts.set(+c.serial, { ...c.capacity });
  const carried: Carried[] = [];
  const bump = (serial: number | null, at: number, d: number, w: number): void => {
    for (const s of ancestry(inv, serial) ?? []) {
      const cap = counts.get(s);
      if (!cap || stampMs(inv.containers[s]!.scannedAt) >= at) continue;
      cap.items += d;
      if (cap.stones != null) cap.stones += d * w;
    }
  };
  for (const m of [...overlay].sort((a, b) => a.serial - b.serial)) {
    const at = stampMs(m.at);
    const it = items[m.serial];
    if (it && stampMs(it.seenAt) >= at) continue;
    const w = it?.weight ?? 1;
    if (it) bump(it.container, at, -1, w);
    if (m.to != null) bump(m.to, at, 1, w);
    else carried.push({ serial: m.serial, name: m.name });
    if (!it) continue;
    const chain = m.to == null ? null : ancestry(inv, m.to);
    items[m.serial] = { ...it, container: chain ? m.to : null, root: chain ? chain.at(-1)! : null };
  }
  return { inv: { ...inv, items }, counts, carried };
}

// Issue #127: the inventory every view and bridge command reads (the server's getInventory): the fold with the
// overlay applied exactly as the planner applies it, so after a trip the app points at the chest an item went into,
// not the one it came out of, until a scan catches up. A moved item's location is read again from its new container
// (so its text, root, container and the chain Highlight walks agree), and a container's fill is the overlay's count.
// A carried item sits at the top of the backpack of the character whose bridge took it (whose fill, when it states
// one, counts it); with no such backpack in the scans (or a move recorded before moves named their character) it is
// in no container and says it is carried. The planner takes the fold itself and applies the overlay on its own:
// handed this, it would apply every move twice. Work beyond applyOverlay's is per move, not per item.
export function overlaidInventory(inv: Inventory, overlay: OverlayMove[]): Inventory {
  const placed = applyOverlay(inv, overlay);
  const items = placed.inv.items;
  const containers: Record<string, Container> = Object.assign(Object.create(null) as Record<string, Container>, inv.containers);
  for (const [serial, cap] of placed.counts) {
    const c = inv.containers[serial]!;
    if (cap.items !== c.capacity!.items || cap.stones !== c.capacity!.stones) containers[serial] = { ...c, capacity: cap };
  }
  const packs = new Map<string, Container>();
  for (const c of Object.values(inv.containers)) if (c.parent == null && c.kind === "backpack") packs.set(c.scannedBy, c);
  const who = new Map(overlay.map((m) => [m.serial, m.character]));
  const carried = new Set<number>();
  for (const { serial } of placed.carried) {
    const it = items[serial], character = who.get(serial);
    const pack = character == null ? undefined : packs.get(character);
    if (!it) continue;
    if (!pack) { carried.add(serial); continue; }
    items[serial] = { ...it, container: +pack.serial, root: +pack.root };
    const cur = containers[pack.serial]!, cap = cur.capacity;
    if (cap) containers[pack.serial] = { ...cur, capacity: { ...cap, items: cap.items + 1, stones: cap.stones == null ? null : cap.stones + weightOf(it) } };
  }
  const view = { ...inv, containers, items };
  for (const [serial, character] of who) {
    const it = items[serial];
    if (!it || it === inv.items[serial]) continue;
    it.location = carried.has(serial) ? { kind: "unknown", character: character ?? "?", text: `Carried by Organize${character ? ` (${character})` : ""}`, root: null, rootName: "?" } : locationOf(it, view);
  }
  return view;
}

// Spec §2.4: the container an item already counts as filed in — the nearest one above it that is any rule's
// target (or the catch-all). An item in a bag that is itself a target belongs to that bag, not to its chest.
export function homeOf(inv: Inventory, it: Item, homes: Set<number>): number | null {
  for (const s of ancestry(inv, it.container) ?? []) if (homes.has(s)) return s;
  return null;
}

// Spec §2.6, capacity by simulation: every container's fill as the trips will find it, changed take by take and
// put by put, with an undo log so a trip that does not work out can be taken back. A take frees one slot in its
// container and every container around it; a put uses one in the target and every container around it, unless it
// merges into a stack: a same name + hue + graphic item already in that exact container, where either side is a
// stack (amount > 1) and the sum stays within MAX_STACK. Weight is checked only where a container has a stone cap.
export const MAX_STACK = 60000;
interface Stack { key: string; amount: number }
export interface Sim { inv: Inventory; counts: Map<number, ContainerCapacity>; stacks: Map<number, Map<number, Stack>>; undo: (() => void)[] }
export interface PutResult { to: number; merged: boolean }

const stackKey = (it: Item): string => `${baseName(it.name)}\u0000${it.hue ?? 0}\u0000${it.graphic ?? 0}`;
// Scans record no weight for some items; one stone is the planner's guess, for the trip budget and stone caps alike.
export const weightOf = (it: Item): number => it.weight ?? 1;

export function newSim(inv: Inventory, counts: Map<number, ContainerCapacity>): Sim {
  const stacks = new Map<number, Map<number, Stack>>();
  for (const it of Object.values(inv.items).sort((a, b) => a.serial - b.serial)) {
    if (it.container == null || inv.containers[it.serial]) continue;
    const here = stacks.get(+it.container) ?? new Map<number, Stack>();
    here.set(+it.serial, { key: stackKey(it), amount: it.amount || 1 });
    stacks.set(+it.container, here);
  }
  return { inv, counts, stacks, undo: [] };
}
export const mark = (sim: Sim): number => sim.undo.length;
export function rollback(sim: Sim, to: number): void { while (sim.undo.length > to) sim.undo.pop()!(); }

function adjust(sim: Sim, container: number, items: number, stones: number): void {
  for (const s of ancestry(sim.inv, container) ?? []) {
    const cap = sim.counts.get(s);
    if (!cap) continue;
    cap.items += items;
    if (cap.stones != null) cap.stones += stones;
    sim.undo.push(() => { cap.items -= items; if (cap.stones != null) cap.stones -= stones; });
  }
}

// An item carried in the backpack (container null) is taken already: nothing to free.
export function simTake(sim: Sim, it: Item): void {
  if (it.container == null) return;
  const from = +it.container;
  adjust(sim, from, -1, -weightOf(it));
  const here = sim.stacks.get(from), mine = here?.get(+it.serial);
  if (here && mine) { here.delete(+it.serial); sim.undo.push(() => { here.set(+it.serial, mine); }); }
}

function fits(sim: Sim, target: number, items: number, stones: number): boolean {
  const chain = ancestry(sim.inv, target);
  return !!chain && chain.every((s) => {
    const cap = sim.counts.get(s);
    return !!cap && cap.items + items <= cap.maxItems && (cap.maxStones == null || (cap.stones ?? 0) + stones <= cap.maxStones);
  });
}

// `movers` are items still waiting for their own move: merging into one would count on a stack that may be gone
// by the time the put runs.
function mergeInto(sim: Sim, target: number, it: Item, movers: Set<number>): number | null {
  const here = sim.stacks.get(target);
  if (!here) return null;
  const key = stackKey(it), amount = it.amount || 1;
  for (const serial of [...here.keys()].sort(bySerial)) {
    const s = here.get(serial)!;
    if (!movers.has(serial) && s.key === key && (amount > 1 || s.amount > 1) && s.amount + amount <= MAX_STACK) return serial;
  }
  return null;
}

// Tries the chain's targets in fill order and puts the item in the first with room. Null when none has any.
export function simPut(sim: Sim, it: Item, chain: number[], movers: Set<number>): PutResult | null {
  const w = weightOf(it), amount = it.amount || 1;
  for (const target of chain) {
    const into = mergeInto(sim, target, it, movers);
    if (!fits(sim, target, into == null ? 1 : 0, w)) continue;
    adjust(sim, target, into == null ? 1 : 0, w);
    const here = sim.stacks.get(target) ?? new Map<number, Stack>();
    sim.stacks.set(target, here);
    if (into != null) {
      const s = here.get(into)!;
      s.amount += amount;
      sim.undo.push(() => { s.amount -= amount; });
    } else {
      here.set(+it.serial, { key: stackKey(it), amount });
      sim.undo.push(() => { here.delete(+it.serial); });
    }
    return { to: target, merged: into != null };
  }
  return null;
}

// Spec §2.5: labelled roots are grouped into sites — same facet (a root whose facet is unknown groups only with
// others whose facet is unknown) and single-link within SITE_TILES, the bridge's walk limit. A move never crosses
// sites. Each site's roots ascending, sites ordered by their lowest serial.
export const SITE_TILES = 24;
type Spot = Pick<Pos, "x" | "y" | "facet">;
const tiles = (a: Spot, b: Spot): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export function sitesOf(inv: Inventory, roots: number[]): number[][] {
  const list = [...new Set(roots)].sort(bySerial);
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = posOf(inv, list[i]!), b = posOf(inv, list[j]!);
      if ((a.facet ?? -1) === (b.facet ?? -1) && tiles(a, b) <= SITE_TILES) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  list.forEach((s, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), s]); });
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

// The site (index into sitesOf's groups) a character standing at `at` is in: the one with a root nearest it, on the
// same facet and within SITE_TILES, as sitesOf links roots. Undefined when none is.
export function siteAt(inv: Inventory, groups: number[][], at: Spot): number | undefined {
  let best: number | undefined, near = SITE_TILES + 1;
  groups.forEach((g, i) => {
    for (const r of g) {
      const p = posOf(inv, r), d = tiles(at, p);
      if ((p.facet ?? -1) === (at.facet ?? -1) && d < near) { best = i; near = d; }
    }
  });
  return best;
}

// Put away (issue #131): the items directly in the picked container, since the bridge puts only those. Never a bag
// in it or anything in one (the player picks that bag next if they want it: what they keep on them, potions and
// reagents, stays in its own), never a blessed or insured item (the character's own things: loot is neither), a
// pinned item or one named like trash.
const OWN_LINE = /^(blessed|insured)$/i;
const isOwn = (it: Item): boolean => it.lines.some((l) => OWN_LINE.test(l.replace(/<[^>]*>/g, "").trim()));
// A non-bag item lying directly in the container.
const onTop = (inv: Inventory, it: Item, container: number): boolean =>
  it.container != null && +it.container === container && !it.equippedBy && it.kind !== "container" && !inv.containers[it.serial];
export function packItems(inv: Inventory, container: number, pinned: Set<number>): number[] {
  return Object.values(inv.items).filter((it) => onTop(inv, it, container) && !TRASH_RE.test(it.name) && !pinned.has(+it.serial) && !isOwn(it))
    .map((it) => +it.serial);
}
// What packItems leaves directly in the container, and why, for Put away's answer: bags, blessed or insured items,
// pinned items.
export interface PackKept { bags: number; own: number; pinned: number }
export function packKept(inv: Inventory, container: number, pinned: Set<number>): PackKept {
  const top = Object.values(inv.items).filter((it) => onTop(inv, it, container));
  return {
    bags: Object.values(inv.containers).filter((c) => c.parent != null && +c.parent === container).length,
    own: top.filter(isOwn).length,
    pinned: top.filter((it) => !isOwn(it) && pinned.has(+it.serial)).length,
  };
}

// Stops in nearest-neighbour order from `from` (the lowest serial first when there is no starting point).
function nearestOrder(inv: Inventory, roots: number[], from: Pos | null): number[] {
  const left = [...new Set(roots)].sort(bySerial);
  const out: number[] = [];
  let here = from;
  while (left.length) {
    let best = 0;
    if (here) for (let i = 1; i < left.length; i++) if (tiles(here, posOf(inv, left[i]!)) < tiles(here, posOf(inv, left[best]!))) best = i;
    const [next] = left.splice(best, 1);
    out.push(next!);
    here = posOf(inv, next!);
  }
  return out;
}

export interface TripStep { serial: number; name: string; from: number | null; to: number }
// The trip command for app/bridge-trip.mts's queueTrip: takes first, ordered by nearest stop from the lowest-serial
// root and, at one stop, by where they go (so the bridge's direct moves, issue #130, step between tiles as seldom
// as it can); then puts, by nearest stop from the last take. Chains and destinations run root first. Null when a
// container on the way is missing from the fold or nested past eight.
export function tripInputFrom(inv: Inventory, index: number, stamp: string, steps: TripStep[]): TripInput | null {
  const takes = new Map<number, number[]>(), puts = new Map<number, number[]>();
  for (const s of steps) {
    if (s.from != null) {
      const chain = ancestry(inv, s.from);
      if (!chain) return null;
      takes.set(s.serial, chain.reverse());
    }
    const dest = ancestry(inv, s.to);
    if (!dest) return null;
    puts.set(s.serial, dest.reverse());
  }
  const takeStops = nearestOrder(inv, [...takes.values()].map((c) => c[0]!), null);
  const last = takeStops.at(-1);
  const putStops = nearestOrder(inv, [...puts.values()].map((c) => c[0]!), last == null ? null : posOf(inv, last));
  const ordered = (stops: number[], paths: Map<number, number[]>, then: (s: number) => number = () => 0): number[] =>
    [...paths.keys()].sort((a, b) => stops.indexOf(paths.get(a)![0]!) - stops.indexOf(paths.get(b)![0]!) || then(a) - then(b) || a - b);
  const putStop = (s: number): number => putStops.indexOf(puts.get(s)![0]!);
  const name = new Map(steps.map((s) => [s.serial, s.name.slice(0, 40)]));
  const roots: TripInput["roots"] = {};
  for (const r of [...takeStops, ...putStops]) {
    const p = posOf(inv, r);
    roots[String(r)] = { x: p.x, y: p.y, z: p.z, ...(p.facet != null ? { facet: p.facet } : {}) } as TripInput["roots"][string];
  }
  return {
    index, stamp, roots,
    takes: ordered(takeStops, takes, putStop).map((serial) => ({ serial, name: name.get(serial)!, chain: takes.get(serial)! })),
    puts: ordered(putStops, puts).map((serial) => ({ serial, name: name.get(serial)!, dest: puts.get(serial)! })),
  };
}

// The bytes the queued line will take (queueTrip adds an id, the action and queuedAt; the stamp is counted at its
// longest), so a planned trip is never refused as over the bridge's line limit.
const ENCODER = new TextEncoder();
export function lineBytes(input: TripInput): number {
  const line = { id: "00000000-0000-0000-0000-000000000000", action: "trip", index: input.index, stamp: "x".repeat(64), queuedAt: "2026-01-01T00:00:00.000Z", roots: input.roots, takes: input.takes, puts: input.puts };
  return ENCODER.encode(JSON.stringify(line)).length;
}

// How long trips take (issue #130), from 1,058 bridge steps measured live on a real house (ServUO shard, TazUO 2.9.0
// before direct moves): a take (chest to backpack) median 0.47 s, a put (backpack to chest) median 0.55 s, walking
// close to nothing. Each is a server round trip held to the shard's action delay (about 0.5 s between moves). A direct
// move is one lift and one drop, like a put, and costs one. Each container a trip uses is opened once (packrat-bridge.py
// waits at least 0.6 s after a double-click), and a trip spends a couple of seconds between being queued and being
// heard back (the bridge reads its queue every 0.5 s, the page its status every 2.5 s).
export const STEP_S = { take: 0.47, put: 0.55, direct: 0.55, open: 0.6, trip: 2 } as const;
// packrat-bridge.py's REACH: containers at most twice this apart have a tile in reach of both.
const REACH = 2;

// The items of a trip the bridge will move straight into their put's container (packrat-bridge.py's direct_put and
// stand_by_both): their two roots have tiles in reach of both (whether one can be stood on is only the client's to
// know, so here it is assumed), and no later take frees room in a container on the put's way.
export function directSerials(input: TripInput): Set<number> {
  const dests = new Map(input.puts.map((p) => [p.serial, p.dest]));
  const out = new Set<number>();
  input.takes.forEach((t, k) => {
    const dest = dests.get(t.serial);
    if (!dest || input.takes.slice(k + 1).some((l) => l.chain.some((c) => dest.includes(c)))) return;
    const a = input.roots[String(t.chain[0])]!, b = input.roots[String(dest[0])]!;
    if ((a.facet ?? -1) === (b.facet ?? -1) && tiles(a, b) <= 2 * REACH) out.add(t.serial);
  });
  return out;
}
export function tripSeconds(input: TripInput): number {
  const direct = directSerials(input).size;
  const opened = new Set([...input.takes.flatMap((t) => t.chain), ...input.puts.flatMap((p) => p.dest)]).size;
  return STEP_S.trip + opened * STEP_S.open + direct * STEP_S.direct + (input.takes.length - direct) * STEP_S.take + (input.puts.length - direct) * STEP_S.put;
}

export interface PlanMove { serial: number; name: string; amount: number; from: number | null; to: number; ruleId: string; alsoMatched: string[]; trip: number }
export interface PlanTrip { index: number; site: number; takes: number[]; puts: number[] }
export interface RuleReport { ruleId: string; matched: number; inPlace: number; toMove: number; noRoom: number }
export interface RoomReport { ruleId: string; needSlots: number; freeSlots: number; shortfall: number }
export interface Plan {
  inventoryStamp: string;
  stamp: string;
  sites: { index: number; roots: number[] }[];
  moves: PlanMove[];
  trips: PlanTrip[];
  rules: RuleReport[];
  room: RoomReport[];
  crossSite: { ruleId: string; count: number }[];
  warnings: PlanWarning[];
  carried: Carried[];
  unclaimed: number;
  seconds: number;          // about how long the trips take (tripSeconds), whole seconds
  emptyBags: EmptyBag[];   // emptyBagsOf's, less those already in the gather container
}
// Put away (issue #131, the TazUO panel's button): the one source a run takes from, instead of every labelled
// root, always a container the player picked in game, and only what lies directly in it (packItems: never a bag in it
// or what the bag holds). `pack`: the backpack or a bag inside it, claimed by a rule (never the catch-all), put only
// into the site the character stands in (`at`, where the panel was clicked); `ground`: a container in a labelled
// ground chest (or the chest), taken from and put away as the house plan does.
export type PutAway = { from: "pack"; container: number; at: Spot } | { from: "ground"; container: number };
export interface PlanOptions extends ScopeOptions {
  putAway?: PutAway | undefined;
  rarity?: RulesV1RarityItem[] | undefined;
  suitPieces?: ReadonlySet<number> | undefined;
  tripItems?: number | undefined;
  tripStones?: number | undefined;
  tripBytes?: number | undefined;
}
// tripStones is conservative: scans record no carry weight. tripBytes stays under the bridge's 16 KB line limit.
export const TRIP_DEFAULTS = { items: 20, stones: 150, bytes: 12 * 1024 } as const;
// A target past this share of its item or stone cap after the plan is warned about (issue #128).
export const NEARLY_FULL = 0.9;
// The bridge capability that says its trips take a container only once it has read it empty (issue #128).
export const BAG_TAKES = "trip-bags";

interface Want { it: Item; ruleId: string; alsoMatched: string[]; chain: number[]; from: number | null }
interface Limits { items: number; stones: number; bytes: number }
type Attempt = { ok: true; placed: Map<number, PutResult> } | { ok: false; failed: Set<number> };

// Every take, then every put, as the bridge runs a trip: a chest that is both source and target frees its room
// before anything is put in. Leaves the simulation changed on success and as it found it on failure.
function attempt(sim: Sim, set: Want[], movers: Set<number>): Attempt {
  const start = mark(sim);
  for (const w of set) simTake(sim, w.it);
  const placed = new Map<number, PutResult>(), failed = new Set<number>();
  for (const w of set) {
    const r = simPut(sim, w.it, w.chain, movers);
    if (r) placed.set(+w.it.serial, r); else failed.add(+w.it.serial);
  }
  if (!failed.size) return { ok: true, placed };
  rollback(sim, start);
  return { ok: false, failed };
}
const stepsOf = (set: Want[], placed: Map<number, PutResult>): TripStep[] =>
  set.map((w) => ({ serial: +w.it.serial, name: w.it.name, from: w.from, to: placed.get(+w.it.serial)!.to }));

// Spec §2.7: one site's trips, in order. Each trip takes the next items that fit the item and stone budget,
// drops any whose put has no room (and, one at a time from the end, any past the byte budget) until the rest work
// together, and commits them; an item that fits nowhere is retried after the next trip frees room, and is no
// room once nothing more can move.
function packSite(inv: Inventory, sim: Sim, site: number, wants: Want[], lim: Limits, firstIndex: number): { trips: PlanTrip[]; moves: PlanMove[]; merged: Set<number>; noRoom: Want[]; seconds: number } {
  let pending = wants;
  const movers = new Set(wants.map((w) => +w.it.serial));
  const blocked = new Set<number>();
  const trips: PlanTrip[] = [], moves: PlanMove[] = [], merged = new Set<number>();
  let seconds = 0;
  for (;;) {
    const window: Want[] = [];
    let stones = 0;
    for (const w of pending) {
      if (window.length >= lim.items) break;
      if (blocked.has(+w.it.serial) || (window.length && stones + weightOf(w.it) > lim.stones)) continue;
      window.push(w);
      stones += weightOf(w.it);
    }
    if (!window.length) break;
    const index = firstIndex + trips.length;
    let set = window;
    let done: { placed: Map<number, PutResult>; input: TripInput } | null = null;
    while (set.length) {
      const start = mark(sim);
      const r = attempt(sim, set, movers);
      if (!r.ok) { set = set.filter((w) => !r.failed.has(+w.it.serial)); continue; }
      const input = tripInputFrom(inv, index, "", stepsOf(set, r.placed));
      if (input && lineBytes(input) <= lim.bytes) { done = { placed: r.placed, input }; break; }
      rollback(sim, start);
      set = set.slice(0, -1);
    }
    if (!done) { for (const w of window) blocked.add(+w.it.serial); continue; }
    const { placed, input } = done;
    sim.undo.length = 0;
    trips.push({ index, site, takes: input.takes.map((t) => t.serial), puts: input.puts.map((p) => p.serial) });
    seconds += tripSeconds(input);
    for (const w of set) {
      const p = placed.get(+w.it.serial)!;
      movers.delete(+w.it.serial);
      if (p.merged) merged.add(+w.it.serial);
      moves.push({ serial: +w.it.serial, name: w.it.name, amount: w.it.amount || 1, from: w.from, to: p.to, ruleId: w.ruleId, alsoMatched: w.alsoMatched, trip: index });
    }
    blocked.clear();
    pending = pending.filter((w) => !placed.has(+w.it.serial));
  }
  return { trips, moves, merged, noRoom: pending, seconds };
}

// The plan's identity: FNV-1a over the latest scan time and every move. Anything that changes a trip changes it.
function planStamp(inventoryStamp: string, moves: PlanMove[]): string {
  const s = JSON.stringify([inventoryStamp, moves.map((m) => [m.serial, m.from, m.to, m.trip])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function planOrganize(inv: Inventory, cfg: OrganizeConfig, overlay: OverlayMove[], opts: PlanOptions): Plan {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));
  const lim: Limits = {
    items: clamp(opts.tripItems ?? TRIP_DEFAULTS.items, 1, 20),
    stones: Math.max(1, opts.tripStones ?? TRIP_DEFAULTS.stones),
    bytes: clamp(opts.tripBytes ?? TRIP_DEFAULTS.bytes, 1024, 16384),
  };
  const placed = applyOverlay(inv, overlay);
  const view = placed.inv;
  const scope = scopeOf(view, cfg, opts);
  const warnings = [...scope.warnings];
  const rarity = opts.rarity ?? [];
  const chains = new Map<string, number[]>(cfg.rules.map((r) => [r.id, r.targets]));
  if (cfg.catchAll != null) chains.set(CATCH_ALL_ID, [cfg.catchAll]);
  const gather = cfg.emptyBagsTo ?? null;
  if (gather != null) chains.set(EMPTY_BAGS_ID, [gather]);
  const ids = [...chains.keys()];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const nameOf = (id: string): string => (id === CATCH_ALL_ID ? "The catch-all" : id === EMPTY_BAGS_ID ? "Gathering empty bags" : `Rule "${cfg.rules.find((r) => r.id === id)!.name}"`);
  const blocked = new Set<string>();
  for (const [id, targets] of chains) {
    for (const t of targets) {
      if (view.containers[t]) continue;
      blocked.add(id);
      warnings.push({ kind: "missing-target", serial: t, detail: `${nameOf(id)} names a container no scan has seen, so it moves nothing` });
    }
  }
  const homes = new Set([...chains.values()].flat());
  const report = new Map(ids.map((id) => [id, { ruleId: id, matched: 0, inPlace: 0, toMove: 0, noRoom: 0 }]));
  const cross = new Map<string, number>();
  const groups = sitesOf(view, scope.siteRoots);
  const siteOfRoot = new Map<number, number>();
  groups.forEach((g, i) => { for (const r of g) siteOfRoot.set(r, i); });
  const siteOf = (serial: number): number | undefined => { const ch = ancestry(view, serial); return ch ? siteOfRoot.get(ch.at(-1)!) : undefined; };
  const carried = new Set(placed.carried.map((c) => c.serial));
  const wants = new Map<number, Want[]>();
  let unclaimed = 0;
  // A carried item is put away unless it has been pinned since (the page's answer to a put the server refuses).
  const pinnedItems = new Set(cfg.pinnedItems);
  const put = opts.putAway;
  // Put away from the pack: what lies directly in the picked container, which is in the pack already, like a carried
  // item: put without a take. From a labelled ground container: what lies directly in it, taken as usual.
  if (put?.from === "pack") for (const s of packItems(view, put.container, pinnedItems)) carried.add(s);
  const here = put?.from === "pack" ? siteAt(view, groups, put.at) : undefined;
  const loose = [...carried].filter((s) => view.items[s] && !pinnedItems.has(s));
  const candidates = (put?.from === "pack" ? packItems(view, put.container, pinnedItems)
    : put?.from === "ground" ? scope.movable.filter((s) => view.items[s]!.container != null && +view.items[s]!.container! === put.container)
    : [...new Set([...scope.movable, ...loose])]).sort(bySerial);
  // Empty bags go to the gather container like one rule's items (issue #128); so does a bag a trip took and did
  // not put away. Without a gather container they stay where they are.
  // Only a bridge that checks live that a bag is empty before lifting it is sent one: the newest scan's scripts
  // (installed with the bridge) must declare "trip-bags", else the bags stay put with a warning to reinstall.
  // Put away (issue #131) moves only what its source holds, and a backpack Put away trip takes nothing, so it
  // gathers no bags.
  const bags = put ? [] : emptyBagsOf(view, placed.counts, cfg, scope.roots, opts.blacklist);
  const newest = Object.values(view.characters).reduce<Character | null>((b, c) => (!b || stampMs(c.scannedAt) > stampMs(b.scannedAt) ? c : b), null);
  const bagTakes = !!newest?.adapter?.capabilities.bridge.includes(BAG_TAKES);
  if (gather != null && !bagTakes && bags.length) warnings.push({ kind: "old-scripts", serial: gather, detail: "empty bags are not gathered here until you reinstall the TazUO scripts from Settings and rescan: the installed bridge does not check that a bag is empty before taking it" });
  const bagClaim: Claim | null = gather != null && bagTakes && !put ? { ruleId: EMPTY_BAGS_ID, alsoMatched: [] } : null;
  const claims: [number, Claim | null][] = candidates.map((s) => [s, view.containers[s] && bagClaim ? bagClaim : claimOf(view.items[s]!, cfg, rarity, opts.suitPieces)]);
  if (bagClaim) claims.push(...bags.map((b): [number, Claim] => [b.serial, bagClaim]));
  for (const [serial, claim] of claims) {
    const it = view.items[serial]!;
    // Put away from the backpack moves only what a rule names: the catch-all would sweep up everything a player
    // carries on purpose (bandages, reagents, keys, runes), so there it counts as no claim.
    if (!claim || (put?.from === "pack" && claim.ruleId === CATCH_ALL_ID)) { unclaimed++; continue; }
    const rep = report.get(claim.ruleId)!;
    rep.matched++;
    const targets = chains.get(claim.ruleId)!;
    const inPack = carried.has(serial);
    if (!inPack) {
      const home = homeOf(view, it, homes);
      if (home != null && targets.includes(home)) { rep.inPlace++; continue; }
    }
    if (blocked.has(claim.ruleId)) continue;
    const usable = targets.filter((t) => scope.usable.has(t));
    if (!usable.length) continue;
    const site = !inPack ? siteOfRoot.get(+it.root!) : put?.from === "pack" ? here : siteOf(usable[0]!);
    const chain = site === undefined ? [] : usable.filter((t) => siteOf(t) === site);
    if (!chain.length) { cross.set(claim.ruleId, (cross.get(claim.ruleId) ?? 0) + 1); continue; }
    wants.set(site!, [...(wants.get(site!) ?? []), { it, ...claim, chain, from: inPack ? null : +it.container! }]);
  }
  const freeAtStart = new Map([...placed.counts].map(([s, c]) => [s, c.maxItems - c.items]));
  // How many more items a chain takes before any move: each target in turn takes what it and every container
  // around it still have room for, so a bag and the chest it sits in are not counted twice.
  const freeIn = (chain: number[]): number => {
    const left = new Map(freeAtStart);
    let n = 0;
    for (const t of chain) {
      const around = ancestry(view, t) ?? [];
      const room = around.length ? Math.max(0, Math.min(...around.map((s) => left.get(s) ?? 0))) : 0;
      for (const s of around) left.set(s, (left.get(s) ?? 0) - room);
      n += room;
    }
    return n;
  };
  const sim = newSim(view, placed.counts);
  const moves: PlanMove[] = [], trips: PlanTrip[] = [], merged = new Set<number>();
  let seconds = 0;
  for (const site of [...wants.keys()].sort(bySerial)) {
    // Carried items first (they are already in the pack), then the rules take turns, each in serial order: a trip
    // that takes for several rules at once frees room in each other's chests (two full chests trading contents),
    // where a trip of one rule's items alone could not start.
    const sorted = wants.get(site)!.sort((a, b) => rank.get(a.ruleId)! - rank.get(b.ruleId)! || a.it.serial - b.it.serial);
    const turns = new Map<string, Want[]>();
    for (const w of sorted) if (w.from != null) turns.set(w.ruleId, [...(turns.get(w.ruleId) ?? []), w]);
    const list = sorted.filter((w) => w.from == null);
    for (let i = 0; list.length < sorted.length; i++) for (const g of turns.values()) if (g[i]) list.push(g[i]!);
    const packed = packSite(view, sim, site, list, lim, trips.length + 1);
    trips.push(...packed.trips);
    moves.push(...packed.moves);
    for (const s of packed.merged) merged.add(s);
    seconds += packed.seconds;
    for (const w of packed.noRoom) report.get(w.ruleId)!.noRoom++;
  }
  for (const m of moves) report.get(m.ruleId)!.toMove++;
  // Issue #128: a target that is, or sits in, a container over NEARLY_FULL of its item or stone cap once the plan
  // has run, with no later target of the same rule under it to take the overflow, is warned about before the next
  // loot fills it, on that container (a bag target in a 95% chest names the chest); the empty bags left in it are
  // counted, since gathering them frees their slots.
  const moved = new Set(moves.map((m) => m.serial));
  const full = (s: number): boolean => { const c = sim.counts.get(s); return !!c && (c.items > NEARLY_FULL * c.maxItems || (c.maxStones != null && (c.stones ?? 0) > NEARLY_FULL * c.maxStones)); };
  const hot = (t: number): number | undefined => ancestry(view, t)?.find(full);
  const fillers = new Map<number, string[]>();
  for (const [id, targets] of chains) {
    const usable = targets.filter((t) => scope.usable.has(t));
    for (let i = usable.length - 1, h; i >= 0 && (h = hot(usable[i]!)) != null; i--) fillers.set(h, [...new Set([...(fillers.get(h) ?? []), id])]);
  }
  for (const [t, by] of fillers) {
    const c = sim.counts.get(t)!, who = [...new Set(by.map(nameOf))];
    const idle = bags.filter((b) => !moved.has(b.serial) && ancestry(view, b.container)?.includes(t)).length;
    const stones = c.maxStones != null && (c.stones ?? 0) > NEARLY_FULL * c.maxStones ? ` and ${Math.round(c.stones!)}/${c.maxStones} stones` : "";
    const note = idle ? ` (${idle === 1 ? "1 of them is an empty bag" : `${idle} of them are empty bags`})` : "";
    warnings.push({ kind: "nearly-full", serial: t, detail: `${who.join(" and ")} ${who.length === 1 ? "fills" : "fill"} it to ${c.items}/${c.maxItems} items${stones} after this plan${note}. Add another container to ${who.length === 1 ? "its" : "their"} targets, or make room.` });
  }
  const room = ids.map((id) => {
    const r = report.get(id)!;
    const needSlots = moves.filter((m) => m.ruleId === id && !merged.has(m.serial)).length + r.noRoom;
    const freeSlots = freeIn(chains.get(id)!.filter((t) => scope.usable.has(t)));
    return { ruleId: id, needSlots, freeSlots, shortfall: r.noRoom };
  });
  const inventoryStamp = inv.scans.reduce((best, s) => (stampMs(s.scannedAt) > stampMs(best) ? s.scannedAt : best), "");
  const seenWarning = new Set<string>();
  return {
    inventoryStamp,
    stamp: planStamp(inventoryStamp, moves),
    sites: groups.map((roots, index) => ({ index, roots })),
    moves,
    trips,
    rules: ids.map((id) => report.get(id)!),
    room,
    crossSite: ids.filter((id) => cross.has(id)).map((id) => ({ ruleId: id, count: cross.get(id)! })),
    warnings: warnings.filter((w) => { const k = `${w.kind}:${w.serial}`; if (seenWarning.has(k)) return false; seenWarning.add(k); return true; })
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.serial - b.serial)),
    carried: [...placed.carried].sort((a, b) => a.serial - b.serial),
    unclaimed,
    seconds: Math.round(seconds),
    emptyBags: bags.filter((b) => gather == null || homeOf(view, view.items[b.serial]!, homes) !== gather),
  };
}

// The queue-ready trip for POST /api/organize/trip, built from the current plan's moves exactly as the plan built
// it. Null when the plan has no such trip.
export function tripCommand(inv: Inventory, plan: Plan, index: number): TripInput | null {
  const steps = plan.moves.filter((m) => m.trip === index);
  return steps.length ? tripInputFrom(inv, index, plan.stamp, steps) : null;
}
