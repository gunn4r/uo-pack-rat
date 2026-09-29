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
import type { ContainerLabel, OrganizeConfig, OrganizeMatchApiResponse, OrganizeRule, RuleMatch } from "./api-types.mts";

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
export function matchSummary(match: RuleMatch, ctx: FilterContext): string {
  const parts = activeFilters({ ...BASE, ...match.query }, ctx).map((t) => t.label);
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
