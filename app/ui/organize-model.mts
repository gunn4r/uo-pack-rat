// ui/organize-model.mts — the Organize screen's pure rules (issue #11): editing the setup (reordering rules,
// labelling, pinning and unlabelling containers, new rule ids, a rule saved from the Inventory's filters, bags
// picked as targets), the words the screen shows (rule summaries, target chains with their fill, the live match
// count, the plan's reports and warnings, the trip list), which trips may run and why not, and how a running
// trip is watched until it reports back. No DOM and no store.mts import, so app/ui-organize.test.mts runs it
// under plain node:test (the arrangement of ui/inv-model.mts). Every edit returns a new setup and never changes
// the one it was given.
import { bagLabel } from "../vault-lib.mts";
import type { Container } from "../vault-lib.mts";
import { parseItemQuery } from "../item-query.mts";
import type { ItemQuery, RuleQuery } from "../item-query.mts";
import { activeFilters, plural } from "./inv-model.mts";
import type { FilterContext } from "./inv-model.mts";
import type { BridgeResultEntry, Build, ContainerLabel, OrganizeConfig, OrganizeMatchApiResponse, OrganizePlan, OrganizeRule, PlanMove, PlanRuleReport, PlanWarning, PlanWarningKind, RuleMatch, AutoStrategy, OrganizeProposal, ProposalCandidate, ProposalGroup, OrganizeRunningTrip } from "./api-types.mts";

// The ruleId the plan reports the catch-all under (app/organize-config.mts's CATCH_ALL_ID; a value import from
// there would add a second server module to the page for one string, so the test pins the two together).
export const CATCH_ALL_ID = "catch-all";
const BASE: ItemQuery = parseItemQuery(new URLSearchParams());

// Label colours offered by Label…: a swatch beside the label, never text colour, so contrast is not at stake.
export const LABEL_COLOURS: ReadonlyArray<{ name: string; value: string }> = [
  { name: "Brass", value: "#b08d3c" }, { name: "Crimson", value: "#a8323a" }, { name: "Teal", value: "#2f7f7f" }, { name: "Forest", value: "#3f7a3a" },
  { name: "Royal", value: "#3b4ba8" }, { name: "Plum", value: "#7a3b7a" }, { name: "Slate", value: "#5a6470" },
];

// ---------------------------------------------------------------- editing the setup
// One element moved from `from` to `to` (clamped to the ends); the list itself when nothing moves.
export function moveIn<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const at = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || at === from) return list;
  const out = [...list];
  out.splice(at, 0, ...out.splice(from, 1));
  return out;
}
export function moveRule(cfg: OrganizeConfig, from: number, to: number): OrganizeConfig {
  const rules = moveIn(cfg.rules, from, to);
  return rules === cfg.rules ? cfg : { ...cfg, rules: [...rules] };
}
// A container off every rule's targets and off the catch-all: what unlabelling or pinning it needs, since the
// server refuses a target that is unlabelled or pinned. `dropped` names what it came off, for the confirmation.
function dropTarget(cfg: OrganizeConfig, serial: number): { config: OrganizeConfig; dropped: string[] } {
  const dropped: string[] = [];
  const rules = cfg.rules.map((r) => {
    if (!r.targets.includes(serial)) return r;
    dropped.push(r.name);
    return { ...r, targets: r.targets.filter((t) => t !== serial) };
  });
  if (cfg.catchAll === serial) dropped.push("Everything else");
  return { config: { ...cfg, rules, catchAll: cfg.catchAll === serial ? null : cfg.catchAll }, dropped };
}
export function withLabel(cfg: OrganizeConfig, label: ContainerLabel): { config: OrganizeConfig; dropped: string[] } {
  const next = { ...cfg, labels: { ...cfg.labels, [String(label.serial)]: label } };
  return label.pinned ? dropTarget(next, label.serial) : { config: next, dropped: [] };
}
// The Label… pin confirmation (issue #123): the chest is where these rules put items, so pinning takes it off them.
export function pinNote(name: string, dropped: readonly string[]): string {
  const q = dropped.map((d) => `"${d}"`);
  const list = q.length > 1 ? `${q.slice(0, -1).join(", ")} and ${q.at(-1)!}` : q[0]!;
  const one = dropped.length === 1;
  return `${name} is where the rule${one ? "" : "s"} ${list} put${one ? "s" : ""} items. Nothing is put into a pinned container, so pinning it takes it off ${one ? "that rule" : "those rules"}.`;
}
export function withoutLabel(cfg: OrganizeConfig, serial: number): { config: OrganizeConfig; dropped: string[] } {
  const labels = { ...cfg.labels };
  delete labels[String(serial)];
  return dropTarget({ ...cfg, labels }, serial);
}
export const pinnedWith = (cfg: OrganizeConfig, serial: number): OrganizeConfig => (cfg.pinnedItems.includes(serial) ? cfg : { ...cfg, pinnedItems: [...cfg.pinnedItems, serial] });
export function upsertRule(cfg: OrganizeConfig, rule: OrganizeRule): OrganizeConfig {
  const i = cfg.rules.findIndex((r) => r.id === rule.id);
  return { ...cfg, rules: i < 0 ? [...cfg.rules, rule] : cfg.rules.map((r, j) => (j === i ? rule : r)) };
}
export const withoutRule = (cfg: OrganizeConfig, id: string): OrganizeConfig => ({ ...cfg, rules: cfg.rules.filter((r) => r.id !== id) });
export function newRuleId(rules: ReadonlyArray<{ id: string }>): string {
  const used = new Set(rules.map((r) => r.id));
  let n = 1;
  while (used.has(`rule-${n}`)) n++;
  return `rule-${n}`;
}

// ---------------------------------------------------------------- a rule's filter
// The Inventory's filters as a rule query: the eleven item fields only. Location, character and seen filters
// are dropped (spec §1: a rule must keep matching an item after it moves); `dropped` names them for the note.
export function ruleQueryFrom(q: ItemQuery): { query: RuleQuery; dropped: string[] } {
  const query: RuleQuery = { q: q.q, slot: [...q.slot], rarity: q.rarity, rarityMin: q.rarityMin, rarityMax: q.rarityMax, kind: [...q.kind], slayer: q.slayer, nogarg: q.nogarg, med: q.med, hideTags: [...q.hideTags], props: q.props.map((p) => ({ ...p })) };
  const dropped = [...(q.loc.length || q.roots.length ? ["Location"] : []), ...(q.chars.length ? ["Character"] : []), ...(q.seenDays ? ["Seen"] : [])];
  return { query, dropped };
}
export const blankQuery = (): RuleQuery => ruleQueryFrom(BASE).query;
export function droppedNote(dropped: string[]): string | null {
  if (!dropped.length) return null;
  const list = dropped.length === 1 ? dropped[0]! : `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`;
  return `${list} ${dropped.length === 1 ? "filter is" : "filters are"} left out: a rule matches items wherever they are, so it keeps matching after they move.`;
}
// A name for a rule saved from the Inventory: its first item filter's words.
export function ruleNameFrom(q: ItemQuery, ctx: FilterContext): string {
  const first = activeFilters({ ...q, loc: [], roots: [], chars: [], seenDays: 0 }, ctx)[0];
  return (first ? first.label : "Saved search").slice(0, 64);
}
// The rule editor's two typed fields, trimmed, with the error for each in the words the field shows.
export function checkDraft(name: string, namesText: string): { name: string; names: string[]; errors: { name?: string; names?: string } } {
  const n = name.trim();
  const names = namesText.split("\n").map((s) => s.trim()).filter(Boolean);
  const errors: { name?: string; names?: string } = {};
  if (!n || n.length > 64) errors.name = "Give the rule a name, up to 64 characters.";
  const long = names.findIndex((s) => s.length > 64);
  if (names.length > 100) errors.names = `At most 100 names; this list has ${names.length}.`;
  else if (long >= 0) errors.names = `Each name can be up to 64 characters; line ${long + 1} has ${names[long]!.length}.`;
  return { name: n, names, errors };
}
// One line for a rule row: "Name: black pearl, bloodmoss, garlic +1 more · Kind: reagent".
// A rule's build (issue #91), as the rule editor and the summary name it.
export const BUILD_TEXT: Record<Build, string> = { caster: "Caster", melee: "Melee", hybrid: "Hybrid", tank: "Tank", other: "Other" };
export function matchSummary(match: RuleMatch, ctx: FilterContext): string {
  const parts = activeFilters({ ...BASE, ...match.query }, ctx).map((t) => t.label);
  if (match.build) parts.unshift(`Build: ${BUILD_TEXT[match.build]}`);
  const names = match.names || [];
  if (names.length) parts.unshift(`Name: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`);
  return parts.length ? parts.join(" · ") : "Every item (no filter yet)";
}
// The filters the rule editor has no control of its own for (search, kind and the rarity range have one): slot,
// exact rarity, property rules, slayer, hidden tags and the two switches, as removable tokens.
const EDITED = /^(q|kind:.*|rarityMin|rarityMax)$/;
export function extraFilters(query: RuleQuery, ctx: FilterContext): Array<{ label: string; removeLabel: string; remove: (q: RuleQuery) => RuleQuery }> {
  return activeFilters({ ...BASE, ...query }, ctx).filter((t) => !EDITED.test(t.id))
    .map((t) => ({ label: t.label, removeLabel: t.removeLabel, remove: (q: RuleQuery) => ruleQueryFrom(t.remove({ ...BASE, ...q })).query }));
}
// The rule editor's live count (POST /api/organize/match): how many items the filter takes on its own, with a
// few names, and a reminder that a rule above this one takes an item first. Null while there is no answer.
export const MATCH_DEBOUNCE_MS = 300;
export function matchLine(r: Pick<OrganizeMatchApiResponse, "count" | "pieces" | "sample"> | null, rulesAbove: number): { text: string; note: string | null } | null {
  if (!r) return null;
  if (!r.count) return { text: "Matches no item in your labelled containers.", note: null };
  return { text: `Matches ${plural(r.count, "item")} (e.g. ${r.sample.join(", ")})`, note: rulesAbove > 0 ? "Rules above this one may claim some of them first." : null };
}
// `fn` once calls have paused for `ms`, with the last call's arguments (typing in the rule editor).
export function debounced<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------- containers as targets
export type ContainerLike = Pick<Container, "serial" | "parent" | "root" | "kind" | "name" | "tooltip" | "label" | "capacity" | "scannedBy" | "opened">;
export interface TargetView { serial: number; name: string; color: string | null; pinned: boolean; fill: { items: number; max: number } | null; gone: boolean }
// A container as a rule target: its label's name (else its scanned name), colour and fill. `gone` = in no scan
// (forgotten, or never rescanned); its label still names it, so the rule can say which one is missing.
export function targetView(serial: number, cfg: OrganizeConfig, containers: Readonly<Record<string, ContainerLike>>): TargetView {
  const l = cfg.labels[String(serial)], c = containers[String(serial)];
  return { serial, name: l?.name ?? (c ? c.label || bagLabel(c) : `0x${serial.toString(16)}`), color: l?.color ?? null, pinned: !!l?.pinned, fill: c?.capacity ? { items: c.capacity.items, max: c.capacity.maxItems } : null, gone: !c };
}
export const fillText = (t: TargetView): string => (t.gone ? "not in any scan" : t.fill ? `${t.fill.items}/${t.fill.max}` : "fill unknown");
export const fillTone = (fill: { items: number; max: number }): "warn" | undefined => (fill.max > 0 && fill.items / fill.max >= 0.9 ? "warn" : undefined);
// What can be picked as a target, by name, `exclude` = already chosen: each labelled chest with the scanned bags
// inside it listed under it (`depth` = how deep; picking an unlabelled bag labels it when the rule is saved,
// withTargetLabels), then any other labelled container (a labelled bag in an unlabelled chest, one in no scan).
// Never a pinned, blacklisted or unopened container, nor anything inside one. `bags: false` lists labelled
// containers only (the catch-all).
export interface TargetOption { value: string; label: string; depth: number }
export function targetOptions(cfg: OrganizeConfig, containers: Readonly<Record<string, ContainerLike>>, exclude: readonly number[] = [], { blacklist = [], bags = true }: { blacklist?: readonly number[]; bags?: boolean } = {}): TargetOption[] {
  const byName = (a: TargetView, b: TargetView): number => a.name.localeCompare(b.name) || a.serial - b.serial;
  const view = (s: number): TargetView => targetView(s, cfg, containers);
  const labelled = Object.values(cfg.labels).filter((l) => !l.pinned).map((l) => view(l.serial)).sort(byName);
  const out: TargetOption[] = [];
  const add = (t: TargetView, depth: number): void => { if (!exclude.includes(t.serial)) out.push({ value: String(t.serial), label: `${t.name} · ${fillText(t)}`, depth }); };
  if (!bags) { for (const t of labelled) add(t, 0); return out; }
  // Offerable: the container and everything around it is neither blacklisted, nor pinned, nor a bag the newest
  // scan could not open (the scanned contents under it are older).
  const offerable = (serial: number): boolean => {
    for (let c = containers[String(serial)], guard = 0; c && guard < 8; c = c.parent != null ? containers[String(c.parent)] : undefined, guard++) {
      if (blacklist.includes(+c.serial) || cfg.labels[String(c.serial)]?.pinned || c.opened === false) return false;
    }
    return true;
  };
  const kids = new Map<number, number[]>();
  for (const c of Object.values(containers)) if (c.parent != null) kids.set(+c.parent, [...(kids.get(+c.parent) || []), +c.serial]);
  const listed = new Set<number>();
  const walk = (serial: number, depth: number): void => {
    for (const t of (kids.get(serial) || []).filter(offerable).map(view).sort(byName)) {
      listed.add(t.serial);
      add(t, depth);
      walk(t.serial, depth + 1);
    }
  };
  for (const t of labelled) {
    const c = containers[String(t.serial)];
    if (!c || c.parent != null || !offerable(t.serial)) continue;
    listed.add(t.serial);
    add(t, 0);
    walk(t.serial, 1);
  }
  for (const t of labelled) if (!listed.has(t.serial) && offerable(t.serial)) add(t, 0);
  return out;
}
// The setup with a label for every chosen target that has none (a bag picked in the rule editor): named as the
// bag reads (its engraving, else its name). The same setup when every target is labelled already.
export function withTargetLabels(cfg: OrganizeConfig, targets: readonly number[], containers: Readonly<Record<string, ContainerLike>>): OrganizeConfig {
  const fresh = targets.filter((s) => !cfg.labels[String(s)] && containers[String(s)]);
  if (!fresh.length) return cfg;
  const labels = { ...cfg.labels };
  for (const s of fresh) {
    const c = containers[String(s)]!;
    labels[String(s)] = { serial: s, name: (bagLabel(c) || c.name || `0x${s.toString(16)}`).slice(0, 64), origin: "manual" };
  }
  return { ...cfg, labels };
}

// ---------------------------------------------------------------- what the screen shows first
// no-scans: no container on the ground has been scanned; no-labels: nothing labelled yet (the screen teaches
// labelling); no-rules: labels but nothing that claims items; ready: a plan can be worked out.
export type Stage = "no-scans" | "no-labels" | "no-rules" | "ready";
export function organizeStage(cfg: OrganizeConfig | null, groundRoots: number): Stage {
  if (!groundRoots) return "no-scans";
  if (!cfg || !Object.keys(cfg.labels).length) return "no-labels";
  if (!cfg.rules.length && cfg.catchAll == null) return "no-rules";
  return "ready";
}

// ---------------------------------------------------------------- locations by label
// Each location text the fold gives a container inside a labelled one (vault-lib.mts's locationOf: segments
// joined by " › ", a backpack or bank root named after its owner), mapped to the same path with every labelled
// segment read by its label. dom.mts's whereText looks location texts up here.
export function labelledPlaces(containers: Readonly<Record<string, ContainerLike>>, labels: Readonly<Record<string, ContainerLabel>>): Map<string, string> {
  const out = new Map<string, string>();
  if (!Object.keys(labels).length) return out;
  for (const c of Object.values(containers)) {
    const chain: ContainerLike[] = [];
    let cur: ContainerLike | undefined = c, guard = 0;
    while (cur && guard++ < 8) { chain.unshift(cur); cur = cur.parent != null ? containers[String(cur.parent)] : undefined; }
    if (!chain.some((x) => labels[String(x.serial)])) continue;
    const root = chain[0]!;
    const own = root.kind === "backpack" || root.kind === "bank" ? `${root.scannedBy}'s ${root.kind}` : null;
    const seg = (x: ContainerLike, i: number, byLabel: boolean): string => (i === 0 && own ? own : (byLabel ? labels[String(x.serial)]?.name : undefined) || x.label || bagLabel(x));
    out.set(chain.map((x, i) => seg(x, i, false)).join(" › "), chain.map((x, i) => seg(x, i, true)).join(" › "));
  }
  return out;
}

// ---------------------------------------------------------------- the plan
export const ruleNameOf = (cfg: OrganizeConfig) => (id: string): string => (id === CATCH_ALL_ID ? "Everything else" : cfg.rules.find((r) => r.id === id)?.name ?? id);
export const containerNameOf = (cfg: OrganizeConfig, containers: Readonly<Record<string, ContainerLike>>) => (serial: number): string => targetView(serial, cfg, containers).name;
const n = (x: number): string => x.toLocaleString("en-US");
export function ruleCountParts(rep: PlanRuleReport): Array<{ text: string; warn: boolean }> {
  return [{ text: `${n(rep.toMove)} to move`, warn: false }, { text: `${n(rep.inPlace)} in place`, warn: false }, ...(rep.noRoom ? [{ text: `${n(rep.noRoom)} no room`, warn: true }] : [])];
}
export function planHeadline(plan: OrganizePlan): string {
  return plan.moves.length ? `${plural(plan.moves.length, "item")} to move in ${plural(plan.trips.length, "trip")}` : "Everything is where it belongs.";
}
export function unclaimedNote(plan: Pick<OrganizePlan, "unclaimed">): string | null {
  const k = plan.unclaimed;
  return k ? `${plural(k, "item")} no rule takes ${k === 1 ? "stays where it is" : "stay where they are"}.` : null;
}
export function roomLines(plan: OrganizePlan, ruleName: (id: string) => string): string[] {
  return plan.room.filter((r) => r.shortfall > 0).map((r) => `${ruleName(r.ruleId)}: ${plural(r.shortfall, "item")} ${r.shortfall === 1 ? "has" : "have"} no room (${plural(r.needSlots, "slot")} needed, ${n(r.freeSlots)} free). Add a container to its targets, or make room.`);
}
export function crossSiteLines(plan: OrganizePlan, ruleName: (id: string) => string): string[] {
  return plan.crossSite.filter((c) => c.count > 0).map((c) => `${ruleName(c.ruleId)}: ${plural(c.count, "item")} ${c.count === 1 ? "belongs" : "belong"} in a container at another house. Carry ${c.count === 1 ? "it" : "them"} over by hand.`);
}
const WARNING_TITLES: Record<PlanWarningKind, string> = {
  "stale-container": "Not scanned for over a week",
  "missing-target": "A rule's container is in no scan",
  "missing-label": "A labelled container is in no scan",
  "unknown-capacity": "Fill unknown: reinstall the scripts and rescan",
  "old-scripts": "Scanned with older scripts: reinstall the scripts and rescan",
  "blacklisted": "Blacklisted: nothing is taken from it or put into it",
  "no-position": "No position scanned, so the bridge cannot walk to it",
  "not-ground": "Not a container on the ground",
};
// The plan's warnings (sorted by kind, then serial, by the planner) as one message per kind; the scan times the
// planner writes into a detail ("last scanned 2026-01-01T12:00:00-07:00") read as dates.
const STAMP = /\b(\d{4}-\d{2}-\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?/g;
export function warningGroups(warnings: readonly PlanWarning[], nameOf: (serial: number) => string): Array<{ kind: PlanWarningKind; title: string; text: string }> {
  const by = new Map<PlanWarningKind, PlanWarning[]>();
  for (const w of warnings) by.set(w.kind, [...(by.get(w.kind) || []), w]);
  return [...by].map(([kind, ws]) => ({ kind, title: ws.length > 1 ? `${WARNING_TITLES[kind]} (${ws.length})` : WARNING_TITLES[kind], text: ws.map((w) => `${nameOf(w.serial)}: ${w.detail.replace(STAMP, "$1")}`).join(" · ") }));
}
// One row per trip for the collapsed trip list; its moves go into a table only when the row is opened.
export interface TripRow { index: number; site: number; moves: PlanMove[]; text: string }
export function tripRows(plan: OrganizePlan, nameOf: (serial: number) => string): TripRow[] {
  const by = new Map<number, PlanMove[]>();
  for (const m of plan.moves) { const l = by.get(m.trip); if (l) l.push(m); else by.set(m.trip, [m]); }
  const multi = plan.sites.length > 1;
  return plan.trips.map((t) => {
    const moves = by.get(t.index) || [];
    const dests = [...new Set(moves.map((m) => nameOf(m.to)))];
    const into = dests.length ? `into ${dests.slice(0, 3).join(", ")}${dests.length > 3 ? ` +${dests.length - 3} more` : ""}` : null;
    return { index: t.index, site: t.site, moves, text: [`Trip ${t.index}`, plural(moves.length, "item"), multi ? `site ${t.site + 1}` : null, into].filter(Boolean).join(" · ") };
  });
}
export const moveName = (m: PlanMove): string => (m.amount > 1 ? `${n(m.amount)} ${m.name}` : m.name);
export const moveWhere = (m: PlanMove, nameOf: (serial: number) => string): string => `${m.from == null ? "your backpack" : nameOf(m.from)} → ${nameOf(m.to)}`;
// Items a trip took and has not put away (the bridge's carried set). Their puts are planned as from-null moves in
// the first trips, so Put them away runs that trip; with none planned there is nowhere with room for them here.
export function carriedView(plan: OrganizePlan, lastTrip: number | null): { text: string; names: string; putAway: number | null; reason: string | null } | null {
  const k = plan.carried.length;
  if (!k) return null;
  const putAway = plan.moves.find((m) => m.from == null)?.trip ?? null;
  const names = plan.carried.slice(0, 5).map((c) => c.name).join(", ") + (k > 5 ? ` and ${k - 5} more` : "");
  return { text: `${plural(k, "item")} from ${lastTrip ? `trip ${lastTrip}` : "an earlier trip"} ${k === 1 ? "is" : "are"} in your backpack.`, names, putAway, reason: putAway == null ? "None of them has a place with room at this house. Put them away by hand." : null };
}

// ---------------------------------------------------------------- running trips
// Why no trip can be started right now, or null. `offline` is bridge.mts's BRIDGE_OFFLINE sentence.
export function tripGate(g: { client: string | null; canTrip: boolean; online: boolean; running: boolean }, offline: string): string | null {
  if (!g.client) return "No game client is set up. Choose one in Settings.";
  if (!g.canTrip) return `${g.client} can't carry out Organize trips. Move the items by hand, then rescan.`;
  if (g.running) return "A trip is running. Wait for it to report back, or stop it.";
  if (!g.online) return offline;
  return null;
}
// The bridge refuses a command older than 60 s, so one it has not started by GRACE_MS never will be (it is not
// running), and a started trip whose bridge has not answered for GRACE_MS died with it. The server lets go of
// either after 90 s (organize-state.mts's PENDING_GRACE_MS), so the page gives up a little later: a trip run again
// from its message is never refused as "not reported back yet". Any trip gets 15 minutes (a stuck client).
export const GRACE_MS = 95_000;
export const TRIP_MS = 15 * 60_000;
// `heard` = when the bridge last answered as online.
export interface TripWatch { id: string; index: number; queuedAt: number; picked: boolean; heard: number }
// A trip the server says is in flight that this page is not watching (it was reloaded, or the trip came from
// another window), watched from when it was queued, like one this page started. Null when there is none, when the
// page is already watching or queueing one, or when the page already stopped following this one: a plan fetched
// before the trip reported back still names it, and the server holds a started trip for as long as its bridge
// answers, so one let go after 15 minutes must not be taken back.
export function adoptWatch(t: OrganizeRunningTrip | null, busy: boolean, ended: ReadonlySet<string>, now: number): TripWatch | null {
  const queuedAt = t ? Date.parse(t.queuedAt) : NaN;
  if (!t || busy || ended.has(t.id) || !Number.isFinite(queuedAt)) return null;
  return { id: t.id, index: t.index, queuedAt, picked: t.picked, heard: now };
}
export const resumedNote = (index: number): string => `Trip ${index} was already running when this page opened (after a reload, or from another window), so it is followed here. Run all does not go on after it: once it reports back, press Run all again to continue.`;
export type TripOutcome = "done" | "partial" | "stopped" | "failed";
export type WatchStep = { kind: "wait"; watch: TripWatch } | { kind: "reported"; outcome: TripOutcome; result: BridgeResultEntry } | { kind: "lost"; message: string };
export function stepWatch(w: TripWatch, s: { currentId: string | null; result: BridgeResultEntry | null; online: boolean }, now: number): WatchStep {
  if (s.result) return { kind: "reported", outcome: outcomeOf(s.result), result: s.result };
  const picked = w.picked || s.currentId === w.id;
  const heard = s.online ? now : w.heard;
  if (!picked && now - w.queuedAt > GRACE_MS) return { kind: "lost", message: `The bridge did not pick up trip ${w.index}. Nothing was moved. Check that packrat-bridge.py is running in game, then run the trip again.` };
  if (picked && now - heard > GRACE_MS) return { kind: "lost", message: `The bridge stopped answering during trip ${w.index}. Items it took may still be in your backpack: check the game, rescan, then press Reload plan.` };
  if (now - w.queuedAt > TRIP_MS) return { kind: "lost", message: `Trip ${w.index} has not reported back after 15 minutes. Check the game, then press Reload plan.` };
  return { kind: "wait", watch: picked === w.picked && heard === w.heard ? w : { ...w, picked, heard } };
}
export function outcomeOf(r: BridgeResultEntry): TripOutcome {
  if (r.stopped) return "stopped";
  if (r.partial) return "partial";
  return !r.ok || (r.steps || []).some((s) => !s.ok) ? "failed" : "done";
}
export function outcomeText(outcome: TripOutcome, index: number, r: BridgeResultEntry): string | null {
  if (outcome === "stopped") return `Trip ${index} was stopped. Anything it took and had not put away is listed above.`;
  if (outcome === "partial") return `Trip ${index} ended early: the backpack could not carry more, so it only put away what it took. The plan was worked out again.`;
  if (outcome === "failed") {
    const k = (r.steps || []).filter((s) => !s.ok).length;
    return k ? `Trip ${index}: ${plural(k, "step")} failed.` : `Trip ${index} failed: ${r.msg}`;
  }
  return null;
}
export interface FailedStep { serial: number; name: string; msg: string }
export function failedSteps(r: BridgeResultEntry, names: ReadonlyMap<number, string>): FailedStep[] {
  const out: FailedStep[] = [];
  for (const s of r.steps || []) if (!s.ok && !out.some((f) => f.serial === s.serial)) out.push({ serial: s.serial, name: names.get(s.serial) ?? `0x${s.serial.toString(16)}`, msg: s.msg });
  return out;
}
// After a trip reported back cleanly and the plan was fetched again: the next trip to run, a reason to stop (a
// plan that did not shrink would otherwise run the same trip for ever), or {stop: null} when all is done.
export function runAllNext(movesBefore: number, plan: OrganizePlan): { index: number } | { stop: string | null } {
  const next = plan.trips[0];
  if (!next) return { stop: null };
  if (plan.moves.length >= movesBefore) return { stop: "The plan did not get shorter after the last trip, so Run all stopped. Check the trip's results, then press Reload plan." };
  return { index: next.index };
}
// POST /api/organize/trip's refusals, as what to do next: a stale plan (fetched again), and a hand-edited
// organize.json the server salvaged, which runs no trip until the player has saved the setup as it now reads.
export function tripRefusal(msg: string): string {
  if (/plan has changed/i.test(msg)) return "The plan changed since it was shown: a scan arrived, a rule changed or a trip reported back. Here is the new plan; check it and press Run again.";
  if (/save the setup first/i.test(msg)) return "Part of organize.json could not be read and was left out, so no trip runs until you have checked the setup and pressed Save setup (above).";
  const busy = /^trip (\d+) has not reported back yet$/.exec(msg);
  if (busy) return `Trip ${busy[1]} has not reported back yet: it is still running in game. Let it finish, then press Reload plan.`;
  return msg;
}

// ---------------------------------------------------------------- Auto organize
export const STRATEGY_TEXT: Record<AutoStrategy, { label: string; text: string }> = {
  simple: { label: "Simple", text: "One container for each kind of thing: armour, weapons, jewelry, reagents, scrolls, resources and so on." },
  detailed: { label: "Detailed", text: "Splits each kind further: armour by slot, jewelry by type, reagents by school, scrolls by kind, resources by type. Short of containers, a kind's small groups share one." },
  build: { label: "By build", text: "Sorts gear by what it is for: caster, melee, hybrid (both equally), tank (shields and resist pieces with neither) and other gear. Everything else is grouped as in Simple." },
};
// Under the chests (issue #123): an unticked chest leaves the scope, so its items are neither moved nor short of room.
export const TICK_SCOPE_TEXT = "Only items in the chests you tick are organized; the rest are left where they are.";
// The chests Auto organize may use, by house (a heading only when there is more than one).
export function candidateGroups(cands: readonly ProposalCandidate[]): Array<{ site: number; title: string | null; rows: ProposalCandidate[] }> {
  const sites = [...new Set(cands.map((c) => c.site))].sort((a, b) => a - b);
  return sites.map((site) => ({ site, title: sites.length > 1 ? `House ${site + 1}` : null, rows: cands.filter((c) => c.site === site) }));
}
// Why a chest starts unticked: the player's own setup uses it.
export function candidateNote(c: ProposalCandidate): string | null {
  if (!c.mine || c.ticked) return null;
  return c.label?.origin === "manual" ? "Your own label: tick it to let Auto organize fill it (its name stays)." : "One of your rules fills it: tick it to let Auto organize use it too.";
}
export function proposalHeadline(p: OrganizeProposal): string {
  if (!p.containers.length) return "Tick at least one container for Auto organize to use.";
  if (!p.changed) return "This is already your setup: nothing to change.";
  const rules = p.groups.reduce((k, g) => k + g.ruleIds.length, 0);
  const moves = p.plan.moves ? `${plural(p.plan.moves, "item")} to move in ${plural(p.plan.trips, "trip")}.` : "Nothing needs to move.";
  return `Labels ${plural(p.containers.length, "container")} and writes ${plural(rules, "rule")}. ${moves}`;
}
export function groupStatus(g: ProposalGroup): { badge: string; tone: "warn" | undefined; text: string | null } {
  if (!g.targets.length) return { badge: "No container", tone: "warn", text: `Add ${plural(g.addContainers, "container")}. Its items stay where they are.` };
  if (g.shortfall) return { badge: "Short", tone: "warn", text: `${plural(g.shortfall, "slot")} short: add ${plural(g.addContainers, "container")}.` };
  return { badge: "Fits", tone: undefined, text: null };
}
export const groupAway = (g: ProposalGroup): string | null => (g.crossSite ? `${plural(g.crossSite, "item")} at another house ${g.crossSite === 1 ? "stays" : "stay"} there.` : null);
// The chests a group gets, in fill order, by the names the player knows them by.
export function intoText(g: ProposalGroup, cands: readonly ProposalCandidate[]): string {
  if (!g.targets.length) return "—";
  return g.targets.map((s) => cands.find((c) => c.serial === s)?.name ?? `0x${s.toString(16)}`).join(", then ");
}
export function proposalNotes(p: OrganizeProposal): string[] {
  return [
    ...(p.manualRules ? [p.manualRules === 1 ? "Your 1 rule stays above these and takes its items first." : `Your ${plural(p.manualRules, "rule")} stay above these and take their items first.`] : []),
    ...p.refused.map((r) => `Container 0x${r.serial.toString(16)} could not be used: ${r.reason}.`),
    ...(p.addContainers ? [`Place ${plural(p.addContainers, "more container")}, scan them, and run Auto organize again to fit everything.`] : []),
    ...(p.plan.crossSite ? [`${plural(p.plan.crossSite, "item")} ${p.plan.crossSite === 1 ? "belongs" : "belong"} at another house: carry ${p.plan.crossSite === 1 ? "it" : "them"} over by hand.`] : []),
  ];
}
// What the proposal leaves where it is, under its headline in the Plan card's words (unclaimedNote); nothing
// while no container is ticked, when the headline asks for one.
export function proposalStays(p: OrganizeProposal): string[] {
  const { noRoom } = p.plan, unclaimed = unclaimedNote(p.plan);
  if (!p.containers.length) return [];
  return [
    ...(noRoom ? [`${plural(noRoom, "item")} ${noRoom === 1 ? "has no room and stays where it is" : "have no room and stay where they are"}.`] : []),
    ...(unclaimed ? [unclaimed] : []),
  ];
}
// Detailed left groups without a chest: Simple needs fewer (no automatic merging, spec §5).
export const canTrySimple = (p: OrganizeProposal): boolean => p.strategy === "detailed" && p.unassigned > 0;
// Why Accept is disabled, or null.
export function acceptGate(p: OrganizeProposal | null, busy: boolean): string | null {
  if (busy || !p) return "Working out the proposal…";
  if (!p.containers.length) return "Tick at least one container first.";
  if (!p.changed) return "Nothing to change: this is already your setup.";
  return null;
}
