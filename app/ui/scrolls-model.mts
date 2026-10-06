// ui/scrolls-model.mts — the Inventory's Scrolls view as data (issue #181): power scrolls per skill and level, how close
// each skill is to a roll-up in the shard's Scroll Binder, what binding everything would leave, Scrolls of
// Transcendence per skill with an exact plan for the binder, the empty binders, and the header's facts. The recipes are
// the shard rules' `scrollBinder` (docs/shard-rules.md); a shard without them gets the plain holdings. No DOM and no
// store.mts import, so app/scrolls-model.test.mts runs it under plain node:test. Points are whole tenths throughout
// (0.3 is 3), never floats, so 0.1 + 0.2 adds up to exactly 0.3.
import type { Item } from "../vault-lib.mts";
import type { RulesV1ScrollBinderPowerScrollsItem } from "../schema/types.d.mts";
import { plural } from "./inv-model.mts";

export type Step = RulesV1ScrollBinderPowerScrollsItem;
export type Counts = Record<number, number>;
// The levels the table always has a column for; a shard's recipes or the scans can add more.
const LEVELS = [105, 110, 115, 120];

// ---------------------------------------------------------------- power scrolls
// "An Exalted Scroll Of Meditation (110 Skill)" → "Meditation" (UO Alive's names, from real scans).
const PS_NAME_RE = /\bscroll of (.+?) \(\d+ skill\)$/i;
export const powerSkill = (name: string): string | null => PS_NAME_RE.exec(name)?.[1] ?? null;

export interface NextStep { from: number; to: number; count: number; have: number; more: number }
export interface PowerRow { skill: string; counts: Counts; total: number; items: Item[]; next: NextStep | null; ready: boolean; bindAll: string | null }

// The step closest to a roll-up: of the steps the skill holds any scrolls for, the one needing the fewest more, the
// higher tier on a tie. Null with nothing to roll up.
export function nextStep(counts: Counts, steps: Step[]): NextStep | null {
  let best: NextStep | null = null;
  for (const s of steps) {
    const have = counts[s.from] ?? 0;
    if (!have) continue;
    const c = { from: s.from, to: s.to, count: s.count, have, more: Math.max(0, s.count - have) };
    if (!best || c.more < best.more || (c.more === best.more && c.from > best.from)) best = c;
  }
  return best;
}
// What the skill's scrolls come to once every full set is bound, each binding's result joining the level above it
// before that level is bound: 8 × 105 make a 110 that counts toward the 110s' 12. Null when nothing binds.
export function bindEverything(counts: Counts, steps: Step[]): Counts | null {
  const out: Counts = {};
  for (const l of LEVELS) out[l] = 0;
  for (const [l, n] of Object.entries(counts)) out[+l] = n;
  let bound = false;
  for (const s of [...steps].sort((a, b) => a.from - b.from)) {
    const made = Math.floor((out[s.from] ?? 0) / s.count);
    if (!made) continue;
    bound = true;
    out[s.from] = (out[s.from] ?? 0) - made * s.count;
    out[s.to] = (out[s.to] ?? 0) + made;
  }
  return bound ? out : null;
}
// "3 × 120, 1 × 110": the holdings, top tier first, leaving out the levels with none.
export const holdingsText = (h: Counts): string => Object.entries(h).filter(([, n]) => n > 0).sort((a, b) => +b[0] - +a[0]).map(([l, n]) => `${n} × ${l}`).join(", ");

// Rows closest to a roll-up first: fewest more needed, then the higher tier, then the skill's name; a skill with
// nothing to roll up last.
function byNext(a: PowerRow, b: PowerRow): number {
  if (!a.next || !b.next) return (a.next ? -1 : b.next ? 1 : 0) || a.skill.localeCompare(b.skill);
  return a.next.more - b.next.more || b.next.from - a.next.from || a.skill.localeCompare(b.skill);
}
// One row per skill, a stack counted by its amount. With recipes the rows sort by byNext, without by name.
export function powerRows(items: Item[], steps: Step[]): PowerRow[] {
  const by = new Map<string, { counts: Counts; items: Item[] }>();
  for (const it of items) {
    const level = it.props.psLevel, skill = powerSkill(it.name);
    if (!level || !skill) continue;
    const s = by.get(skill) ?? { counts: {}, items: [] };
    s.counts[level] = (s.counts[level] ?? 0) + (it.amount || 1);
    s.items.push(it);
    by.set(skill, s);
  }
  const rows = [...by].map(([skill, s]): PowerRow => {
    const next = nextStep(s.counts, steps), bound = bindEverything(s.counts, steps);
    return { skill, counts: s.counts, total: Object.values(s.counts).reduce((a, n) => a + n, 0), items: s.items, next, ready: !!bound, bindAll: bound ? holdingsText(bound) : null };
  });
  return rows.sort(steps.length ? byNext : (a, b) => a.skill.localeCompare(b.skill));
}
// The level columns: 105 to 120, and any other level a recipe names or a scroll is at.
export function powerLevels(rows: PowerRow[], steps: Step[]): number[] {
  const all = new Set([...LEVELS, ...steps.flatMap((s) => [s.from, s.to]), ...rows.flatMap((r) => Object.keys(r.counts).map(Number))]);
  return [...all].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- Scrolls of Transcendence
export const toTenths = (points: number): number => Math.round(points * 10);
export const fmtTenths = (t: number): string => (t / 10).toFixed(1);

// The fewest values (each used once) adding up to exactly `target`, largest first, or null when none do. A 0/1
// knapsack over the totals 0..target: best[i][s] is the fewest of the first i values (largest first) reaching s, and
// the walk back from the last row takes value i whenever leaving it out would not reach s as cheaply.
export function fewestSubset(vals: number[], target: number): number[] | null {
  const sorted = [...vals].sort((a, b) => b - a);
  const best: number[][] = [Array.from({ length: target + 1 }, (_, s) => (s ? Infinity : 0))];
  sorted.forEach((v, i) => {
    const prev = best[i]!;
    best.push(prev.map((n, s) => (s >= v ? Math.min(n, prev[s - v]! + 1) : n)));
  });
  if (best[sorted.length]![target] === Infinity) return null;
  const pick: number[] = [];
  for (let i = sorted.length, s = target; s > 0; i--) {
    if (best[i - 1]![s] !== best[i]![s]) { pick.push(sorted[i - 1]!); s -= sorted[i - 1]!; }
  }
  return pick.sort((a, b) => b - a);
}

// `lost` is what a bind past the last usable total throws away (0 for an exact one).
export type SotPlan = { kind: "bind"; target: number; pick: number[]; lost: number } | { kind: "short"; target: number; short: number };
// The binder's plan for one skill's scrolls (tenths). The binder is usable at exactly the first usable total, once past
// it only at exactly the next, and loses anything above the last; so bind the highest usable total the scrolls can make
// exactly, with the fewest scrolls. With no exact set and the lot at or past the last total, bind the set that goes
// past it least (then the fewest scrolls): no scroll on the way can land on a usable total exactly, since no set makes
// one, and the overshoot is lost. Otherwise say how far the lot is from the next usable total above it.
export function sotPlan(tenths: number[], usableAt: number[]): SotPlan {
  const total = tenths.reduce((a, t) => a + t, 0), targets = usableAt.map(toTenths), last = targets[targets.length - 1]!;
  for (const target of [...targets].reverse()) {
    if (target > total) continue;
    const pick = fewestSubset(tenths, target);
    if (pick) return { kind: "bind", target, pick, lost: 0 };
  }
  // The least sum past the last total is below last + the largest scroll: drop that set's smallest and it is under last.
  if (total >= last) {
    for (let sum = last + 1; sum <= total; sum++) {
      const pick = fewestSubset(tenths, sum);
      if (pick) return { kind: "bind", target: last, pick, lost: sum - last };
    }
  }
  const above = targets.find((t) => t > total)!;
  return { kind: "short", target: above, short: above - total };
}
// Runs of equal values in a sorted list, as [value, count]: [8, 4, 4] → [[8, 1], [4, 2]].
export function runsOf(sorted: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const t of sorted) { const last = runs[runs.length - 1]; if (last && last[0] === t) last[1]++; else runs.push([t, 1]); }
  return runs;
}
// Points (tenths, sorted) as words, a run of equal ones as "17 × 0.3": the plan's picks and the Scrolls column's chips.
export const runText = (sorted: number[]): string[] => runsOf(sorted).map(([t, n]) => (n > 1 ? `${n} × ${fmtTenths(t)}` : fmtTenths(t)));
export function planText(plan: SotPlan): string {
  if (plan.kind === "bind") return `Bind ${runText(plan.pick).join(" + ")} → ${fmtTenths(plan.target)}${plan.lost ? ` (${fmtTenths(plan.lost)} lost)` : ""}`;
  return `${fmtTenths(plan.short)} short of ${fmtTenths(plan.target)}`;
}

export interface SotRow { skill: string; tenths: number[]; total: number; items: Item[]; plan: SotPlan | null; ready: boolean }
// The skill a Scroll of Transcendence's shown name gives it (vault-lib.mts's displayName: "Scroll of Transcendence
// (Animal Lore - 0.1 Pts)"), or null.
const SOT_SHOWN_RE = /^Scroll of Transcendence \((.+) - \d+(?:\.\d+)? Pts\)$/;
export const sotSkillOf = (name: string): string | null => SOT_SHOWN_RE.exec(name)?.[1] ?? null;
// One row per skill, its scrolls' points largest
// first, a stack counted once per scroll; sorted by total, then name. `usableAt` null (no binder recipe) means no plan.
export function sotRows(items: Item[], usableAt: number[] | null): SotRow[] {
  const by = new Map<string, { tenths: number[]; items: Item[] }>();
  for (const it of items) {
    const points = it.props.sotPoints, skill = sotSkillOf(it.name);
    if (!points || !skill) continue;
    const s = by.get(skill) ?? { tenths: [], items: [] };
    for (let i = 0; i < (it.amount || 1); i++) s.tenths.push(toTenths(points));
    s.items.push(it);
    by.set(skill, s);
  }
  return [...by].map(([skill, s]): SotRow => {
    const tenths = s.tenths.sort((a, b) => b - a), plan = usableAt ? sotPlan(tenths, usableAt) : null;
    return { skill, tenths, total: tenths.reduce((a, t) => a + t, 0), items: s.items, plan, ready: plan?.kind === "bind" };
  }).sort((a, b) => b.total - a.total || a.skill.localeCompare(b.skill));
}

// ---------------------------------------------------------------- Scroll Binders
// A Scroll Binder counts as empty when its tooltip has nothing past its name but its weight and the item's own state
// (blessed, insured, a tag). A partly filled binder names what it holds on a line of its own, in a format no scan has
// shown yet, so any other line means "not empty", and such a binder is left out of every count (docs/ui/inventory.md, the Scrolls view).
const BINDER_RE = /^scroll binder$/i;
const PLAIN_LINE_RE = /^(weight: .*|blessed|insured|cursed|antique|brittle|prized)$/i;
export const isEmptyBinder = (it: Item): boolean => BINDER_RE.test(it.name) && (it.lines || []).slice(1).every((l) => PLAIN_LINE_RE.test(l.trim()));
export const emptyBinderCount = (items: Item[]): number => items.filter(isEmptyBinder).reduce((a, it) => a + (it.amount || 1), 0);

// ---------------------------------------------------------------- the header, the filter, the links
// "95 power scrolls across 31 skills", "28 Scrolls of Transcendence across 15 skills" and, with binder recipes, the
// empty binders and how many skills could bind now.
export function scrollFacts({ power, sot, binders, binder }: { power: PowerRow[]; sot: SotRow[]; binders: number; binder: boolean }): string[] {
  const psN = power.reduce((a, r) => a + r.total, 0), sotN = sot.reduce((a, r) => a + r.tenths.length, 0);
  const facts = [`${plural(psN, "power scroll")} across ${plural(power.length, "skill")}`, `${plural(sotN, "Scroll of Transcendence", "Scrolls of Transcendence")} across ${plural(sot.length, "skill")}`];
  if (!binder) return facts;
  // A skill ready in both tabs is one skill.
  const ready = new Set([...power, ...sot].filter((r) => r.ready).map((r) => r.skill)).size;
  return [...facts, plural(binders, "empty Scroll Binder"), ready ? `${plural(ready, "skill")} ready to bind` : "Nothing is ready to bind yet"];
}
export function filterRows<T extends { skill: string }>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  return needle ? rows.filter((r) => r.skill.toLowerCase().includes(needle)) : rows;
}
// The Inventory search that finds exactly a skill's scrolls (at one level): the name's "scroll of <skill> (" pins the
// whole skill, so "Lore" never finds Animal Lore. The search reads names lower-cased.
export const powerQuery = (skill: string, level?: number): string => `scroll of ${skill} (${level ? `${level} skill)` : ""}`.toLowerCase();
export const sotQuery = (skill: string): string => `scroll of transcendence (${skill} -`.toLowerCase();

// The detail's "Where they are": the scrolls grouped by their place (scan root and location text), in the order given.
export interface PlaceGroup { key: string; text: string; location: Item["location"]; items: Item[] }
export function placeGroups(items: Item[]): PlaceGroup[] {
  const by = new Map<string, PlaceGroup>();
  for (const it of items) {
    const text = it.location?.text ?? "", key = `${it.root ?? ""}|${text}`;
    const g = by.get(key) ?? { key, text, location: it.location, items: [] };
    g.items.push(it);
    by.set(key, g);
  }
  return [...by.values()];
}
// Who saw a place, under its name in the detail: "On the ground · scanned by Kestrel", "Kestrel's backpack".
export function whoText(loc: Item["location"]): string {
  if (!loc) return "";
  if (loc.kind === "ground") return `On the ground · scanned by ${loc.character}`;
  if (loc.kind === "backpack" || loc.kind === "bank") return `${loc.character}'s ${loc.kind}`;
  return loc.character;
}
// A scroll's name in the detail's list, where its level or points are on a badge beside it: "Mythical Scroll Of
// Provocation", "Scroll of Transcendence".
export const listName = (name: string): string => name.replace(/^an? /i, "").replace(/ \([^()]*\)$/, "");
