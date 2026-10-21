// ui/builder-model.mts — the Suit Builder's pure logic (design spec 4.6-4.8): the Advanced fields' validation, a resist tile's outcome line, the result's
// "What changes" gauges and table and "after the change" values, the compare table's differing rows and best values,
// and a saved run's label and badges. No DOM and no page state, so app/builder-model.test.mts can check it
// all directly; ui/builder.mts, ui/builder-result.mts and ui/runs.mts draw what it returns.
//
// map: builder
// owns: `KNOB_RANGES`, `changeRows`, `compareModel`, `runAutoLabel`, `who`
import { NOBODY, PROPERTIES, labelOf, paperdollResist, propName, importanceOf, withCurrentActions, weightOfImportance, RESIST_SKILL_KEY, GEAR_SLOTS, NOT_BUILDER_KEYS, RESIST_KEYS, RESIST_CAP_LIMITS, SLOT_LABELS, settingsDiff, shardResistCap, WEAPON_SKILLS, WEAPON_EXCLUDES, SPELLBOOKS, MELEE_SKILLS, ubwsLetsIn, flagLabel, rankImportance, LEFTOVER_GROUPS, LEFTOVER_LABELS, goalLabel, goalWord } from "../vault-lib.mts";
import type { FcCap, Goals, PlannedBuffs, PropMap, ResistCap, RunSettings } from "../vault-lib.mts";
import { applyBuffs, buffById, buffsDiff, capWord, signed, type BuffResult } from "../buffs.mts";
import { RUN_SETTING_LIMITS, type Range } from "../run-settings.mts";
import { paperdollCaps, suitResist } from "../evaluate.mts";
import type { Diagnostic, DiagnosticAction, DiagnosticCode, GearChanges, ScoreShare, SwingResult } from "../runs-types.mts";
import { listWords } from "./manual-model.mts";
import { delayText, MIN_TICKS } from "../swing.mts";
import type { StrictResult, TieBreakResult } from "./api-types.mts";
import { plural } from "./format.mts";

// ---------------------------------------------------------------- the header (issue #321)
// The build picker's state line: which template the panel's settings came from and how they stand. `unsaved` counts the
// settings that differ from the character's saved profile; `changed` those that differ from the template they came from
// (all the old "modified" badge counted). Unsaved changes are named first, being what a template pick or a character
// switch would lose. It never says a bare "modified".
export interface BuildState { template: string | null; missing?: boolean | undefined; changed?: number | undefined; unsaved?: number | undefined }
export function buildStateText({ template, missing = false, changed = 0, unsaved = 0 }: BuildState): string {
  const from = !template ? "not from a template" : missing ? `from template “${template}”, which no longer exists` : `from template “${template}”`;
  if (unsaved) return `${from} · ${plural(unsaved, "unsaved change")}`;
  if (changed && template && !missing) return `${from}, with ${plural(changed, "setting")} changed`;
  return from;
}
// The same in full, for the tooltip and a screen reader: what differs from the template, and what is not saved yet.
export function buildStateDetail({ name, template, missing = false, changedLines = [], unsavedLines = [] }: { name: string; template: string | null; missing?: boolean; changedLines?: string[]; unsavedLines?: string[] }): string {
  const tpl = !template ? "These settings are not from a template; Save as template stores them as one."
    : missing ? `These settings came from a template named ${template}, which no longer exists.`
    : changedLines.length ? `Changed from ${template}: ${changedLines.join(" · ")}.` : `These settings equal the ${template} template.`;
  return `${tpl} ${unsavedLines.length ? `Not saved to ${who(name)}'s profile yet: ${unsavedLines.join(" · ")}.` : "No unsaved changes."}`;
}
// A character's top skills by value, for the character picker: "Swordsmanship 120 · Tactics 110.5 · Parry 110"; "" with none.
export function topSkills(skills: Record<string, unknown> | null | undefined, n = 3): string {
  const val = (v: unknown): number => { const x = (v as { value?: unknown } | null)?.value; return typeof x === "number" && Number.isFinite(x) ? x : 0; };
  return Object.entries(skills || {}).map(([k, v]) => [k, val(v)] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
    .map(([k, v]) => `${k} ${Number(v.toFixed(1))}`).join(" · ");
}
// A player's template's line in the build picker: its description, else the characters whose settings came from it
// ("Used by Dorran and Kestrel"), else when it was saved, else "Your template".
export function templateLine(t: { description?: string | undefined; savedAt?: string | undefined }, users: string[]): string {
  if (t.description) return t.description;
  if (users.length) return `Used by ${listWords(users.map(who))}`;
  return t.savedAt ? `Saved ${new Date(t.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Your template";
}

// A Suit Builder character key as the page prints it: No character's pseudo name in words, a character's name as it is.
export const who = (name: string): string => (name === NOBODY ? "No character" : name);
const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------- property names
// A rule row's name for its property (vault-lib.mts propName), re-exported for the builder's modules.
export { propName };

// ---------------------------------------------------------------- paperdoll terms
// paperdollCaps lives with the suit evaluation (app/evaluate.mts).
export { paperdollCaps };
// A suit's item totals in paperdoll terms with the buffs a build planned with (none: `b` null), against `caps`, each
// resist held at the Resisting Spells minimum of `skill` (the character's own, EffectiveProfile.resistSkill; null for
// none) with the suit's own Resisting Spells bonus, up to the skill's `cap` (vault-lib resistSkillCapOf).
export function withBuffs(t: PropMap, skill: number | null, caps: Record<string, number>, b: Pick<PlannedBuffs, "on" | "skills" | "stats" | "who"> | null | undefined, cap: number | null = null): BuffResult {
  return applyBuffs(t, caps, b?.on || [], b?.skills || {}, b?.stats ?? null, b?.who, suitResist(skill, t, cap));
}
// What the buffs add past the cap, by property, for What changes: DI "+68 past the cap (Enemy of One)", short "+68 past"; a
// penalty applied after it, such as Protection's casting delay, FC "−2 after the cap (Protection)", short "−2 after".
export const pastCapNotes = (r: BuffResult): Record<string, { text: string; short: string }> =>
  Object.fromEntries(Object.entries(r.outside).filter(([, v]) => v).map(([k, v]) => [k, { text: `${signed(v)} ${capWord(v)} the cap (${(r.shares[k] || []).filter((x) => x.outside).map((x) => buffById(x.id)!.name).join(", ")})`, short: `${signed(v)} ${capWord(v)}` }]));

// The Rarity setting's help line: none for "any".
export function rarityHelp(rarity: string | undefined): string {
  return rarity ? `Among equally good suits, use the ${rarity === "higher" ? "highest" : "lowest"}-rarity pieces. Requirements come first.` : "";
}
// A suit's rarity total, the summed rank of its pieces on the shard's ladder (Minor Magic Item 1 … Legendary Artifact 8,
// no tier 0), from the tie costs the server stamped on them: a piece's rank for "lower", the ranks above it for "higher".
export function rarityTotal(best: Record<string, { tieCost?: number | undefined } | null | undefined>, rarity: string | undefined, ladderLength: number): number {
  return Object.values(best).reduce((n, it) => (it && it.tieCost != null ? n + (rarity === "higher" ? ladderLength - it.tieCost : it.tieCost) : n), 0);
}
// A strict-order stage in words (issue #292), named by what it scores: "your requirements", its goals ("Hit Chance
// Increase and Defense Chance Increase"), "getting closer to soft requirements", "fewest changes", "tagged pieces" or "spare points".
export function stageName(st: { kind: string; keys: string[] | null }): string {
  return st.kind === "requirements" ? "your requirements" : st.kind === "softPartial" ? "getting closer to soft requirements" : st.kind === "changes" ? "fewest changes"
    : st.kind === "tags" ? "tagged pieces" : st.kind === "spare" ? "spare points" : andList((st.keys || []).map(propName));
}
// What a strict-order build is solving now, for the progress card: "Strict order: getting Hit Chance Increase and Defense
// Chance Increase as high as they go", "Strict order: meeting your requirements", "Strict order: spare points".
export function stageProgress(st: { kind: string; keys: string[] | null }): string {
  if (st.kind === "goal") { const n = (st.keys || []).length; return `Strict order: getting ${stageName(st)} as high as ${n === 1 ? "it goes" : "they go"}`; }
  return `Strict order: ${st.kind === "requirements" ? "meeting your requirements" : st.kind === "changes" ? "changing as few pieces as possible" : st.kind === "tags" ? "avoiding tagged pieces" : stageName(st)}`;
}
// A strict-order build's proof in words (issue #292): every stage proven best in turn, or the last one proven and where
// the best found takes over; a build without Exact search proves nothing, and says how to.
export function strictDetail(s: StrictResult, method?: string): string {
  const n = s.stages.length;
  if (s.proven >= n) return "Strict order: each goal proven best in turn, most important first";
  if (s.proven <= 0) return `Strict order: the best found, not proven; ${method === "exact" ? "raise the time budget" : "turn on Exact search"} to prove it`;
  const first = s.stages[s.proven - 1]!;
  return `Strict order: proven ${first.kind === "requirements" ? "for your requirements only" : `best up to ${stageName(first)}`}; from ${stageName(s.stages[s.proven]!)} on, the best found (not proven)`;
}
// Solver details' Rarity row: "Lowest-rarity pieces among equal suits · rarity total 16", and when the second stage ran
// out of time, that the rarity choice is not proven.
export function rarityDetail(tb: TieBreakResult, total: number): string {
  const most = tb.rarity === "higher" ? "highest" : "lowest";
  return `${most[0]!.toUpperCase()}${most.slice(1)}-rarity pieces among equal suits · rarity total ${total.toLocaleString("en-US")}${tb.costProven ? "" : ` (the ${most} found, not proven)`}`;
}
// The Skip / Only containers chips' options (issue #12, #487): the root containers grouped as the Inventory's Location filter
// groups them, each character's backpack and bank under the character, then the containers on the ground by the house they
// stand in (`houseOf`, the House map's) and last those in no house. A container labelled for Organize reads by its label
// with its scanned name after it (`labelled`: its place text, as locationOf gives it, to the same by label), so a search
// finds either.
export interface RootOption { value: string; label: string; group?: string | undefined }
export interface RootSource { serial: number; kind: string | null | undefined; scannedBy: string; name: string }
export function rootOptions(roots: readonly RootSource[], labelled: (text: string) => string, houseOf: (serial: number) => string | null): RootOption[] {
  const ON_GROUND = "On the ground";
  const rows = roots.map((r): RootOption & { order: number } => {
    if (r.kind === "backpack" || r.kind === "bank") return { value: String(r.serial), label: r.kind === "bank" ? "Bank" : "Backpack", group: r.scannedBy, order: 0 };
    const shown = labelled(r.name), house = houseOf(r.serial);
    return { value: String(r.serial), label: shown === r.name ? r.name : `${shown} · ${r.name}`, group: house ?? ON_GROUND, order: house ? 1 : 2 };
  });
  return rows.sort((a, b) => a.order - b.order || a.group!.localeCompare(b.group!) || a.label.localeCompare(b.label)).map(({ order, ...o }) => o);
}
// Then any listed serial that is no longer a root (gone from the scans, or set by hand), so it can still be unchecked.
export function withStoredRoots(options: RootOption[], stored: readonly number[] = []): RootOption[] {
  const gone = stored.filter((v) => !options.some((o) => o.value === String(v)));
  return [...options, ...gone.map((v) => ({ value: String(v), label: `Unknown container 0x${v.toString(16).toUpperCase()} (not in the scans)`, group: "Not in the scans" }))];
}

// ---------------------------------------------------------------- weapons
// The Weapons control holds the weapon skills left out of the pool. The chip counts them ("Weapons: 2 excluded"), and
// adds ", plus Use Best Weapon Skill" when that switch is on, some melee skill is excluded and some is not: only then does
// it matter in practice. Spellbooks (issue #259) add ", no spellbooks" ("Weapons: Fencing only, no spellbooks").
export const weaponName = (w: string): string => (w === SPELLBOOKS ? "Spellbooks" : w[0]!.toUpperCase() + w.slice(1));
interface WeaponWords { any: string; none: string; only: (w: string) => string; some: (excluded: string[]) => string; noBooks: string }
function weaponsText(excluded: string[], ubws: boolean, t: WeaponWords): string {
  const skills = excluded.filter((w) => w !== SPELLBOOKS), allowed = WEAPON_SKILLS.filter((w) => !skills.includes(w));
  const text = !skills.length ? t.any : !allowed.length ? t.none : allowed.length === 1 ? t.only(allowed[0]!) : t.some(WEAPON_SKILLS.filter((w) => skills.includes(w)));
  const named = ubwsLetsIn(excluded, ubws) && MELEE_SKILLS.some((w) => excluded.includes(w));
  const out = named ? `${text}, plus Use Best Weapon Skill` : text;
  return skills.length === excluded.length ? out : skills.length ? `${out}, no spellbooks` : t.noBooks;
}
export const weaponsChipText = (excluded: string[] = [], ubws = false): string =>
  weaponsText(excluded, ubws, { any: "Weapons: any", none: "Weapons: none", only: (w) => `Weapons: ${weaponName(w)} only`, some: (ex) => `Weapons: ${ex.length} excluded`, noBooks: "Weapons: any, no spellbooks" });
// The Weapon must have chip (issue #214): "Weapon must have: Spell Channeling" when it holds any.
export const weaponMustHaveChipText = (flags: string[] = []): string => (flags.length ? `Weapon must have: ${flags.map(flagLabel).join(", ")}` : "Weapon must have");
// Ticking or unticking a skill; the list stays in WEAPON_EXCLUDES order, so the same exclusions always read the same.
export const toggleWeapon = (excluded: string[], w: string, on: boolean): string[] => WEAPON_EXCLUDES.filter((x) => (x === w ? on : excluded.includes(x)));

// ---------------------------------------------------------------- resist caps
// A resist's cap for a build is the shard's (race-aware) unless the player overrode it. The field takes a whole
// paperdoll number in RESIST_CAP_LIMITS; setting it back to the shard's value removes the override, so a
// profile only ever stores the caps that really differ.
export const resistCapError = (raw: string): string | null => rangeError(raw, { ...RESIST_CAP_LIMITS, whole: true });
export function withResistCap(overrides: Record<string, number> = {}, k: string, value: number, shard: number): Record<string, number> {
  const next = { ...overrides };
  if (value === shard) delete next[k]; else next[k] = value;
  return next;
}
// After a race change: an override that now equals the new race's shard cap is no override (a human's Energy 75
// becomes an Elf's own cap), so it is dropped rather than saved and reported as template drift.
export function pruneResistCaps(overrides: Record<string, number> = {}, race: string | null | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(overrides).filter(([k, v]) => v !== shardResistCap(k, race)));
}
// A resist requirement counts only up to that resist's cap (effectiveProfile clamps it for the solver), so every
// view that says whether one is met compares against min(floor, cap). Anything else is its floor as set.
export function effectiveFloor(k: string, floor: number, caps: Record<string, number>): number {
  return RESIST_KEYS.includes(k) && caps[k] != null ? Math.min(floor, caps[k]!) : floor;
}
// The requirement row's warning when its floor is past its resist's cap: "Counts only up to the Fire cap, 70".
export function floorCapWarning(k: string, floor: number, cap: number | null): string | null {
  return RESIST_KEYS.includes(k) && cap != null && floor > cap ? `Counts only up to the ${propName(k)} cap, ${cap}` : null;
}
// The Faster Casting cap and where it comes from (vault-lib.mts fcCapFor): "cap 4: Chivalry", "cap 2: Magery 70+".
export const fcCapText = (fc: FcCap): string => `cap ${fcCapSource(fc)}`;
export const fcCapSource = (fc: FcCap): string => `${fc.cap}: ${fc.reason}`;
// "raised from 70" / "lowered from 70", or null when the cap is the shard's.
export function capNote(c: ResistCap): string | null {
  if (c.cap === c.shard) return null;
  return `${c.cap > c.shard ? "raised" : "lowered"} from ${c.shard}`;
}
const overridden = (view: Record<string, ResistCap>): string[] => RESIST_KEYS.filter((k) => view[k] && view[k]!.cap !== view[k]!.shard);
// The Requirements section's note on Resisting Spells, null with no minimum (or one of 0, which meets nothing): "Resisting Spells keeps each of Ana's
// resists at 40 or more: a resist requirement of 40 or less is met by any suit."
export function resistMinimumText(name: string, min: number | null): string | null {
  return min == null || min <= 0 ? null : `Resisting Spells keeps each of ${name}'s resists at ${min} or more: a resist requirement of ${min} or less is met by any suit.`;
}
// A result's line about its caps, for the compare view: "Fire Resist 95 (raised from 70)", or "Shard caps".
export function capsLine(view: Record<string, ResistCap>): string {
  const set = overridden(view);
  return set.length ? set.map((k) => `${propName(k)} ${view[k]!.cap} (${capNote(view[k]!)})`).join(" · ") : "Shard caps";
}
export const anyOverridden = (view: Record<string, ResistCap>): boolean => overridden(view).length > 0;

// ---------------------------------------------------------------- Advanced: the solver knobs
// The ranges the server accepts (app/run-settings.mts RUN_SETTING_LIMITS, one table for both). The page asks for the
// time budget in seconds, and a budget of 0 would leave the exact search no time at all, so its field starts at 1.
export interface Knobs { strLimit: string; restarts: string; exact: boolean; budgetS: string; altCount: string; altTol: string }
export type KnobField = Exclude<keyof Knobs, "exact">;
export const KNOB_RANGES: Record<KnobField, Range> = {
  strLimit: RUN_SETTING_LIMITS.strLimit,
  restarts: RUN_SETTING_LIMITS.restarts,
  budgetS: { min: 1, max: RUN_SETTING_LIMITS.budgetMs.max / 1000, whole: true },
  altCount: RUN_SETTING_LIMITS.altCount,
  altTol: RUN_SETTING_LIMITS.altTol,
};
// The field's error in plain words with the allowed range, or null when the value is fine.
export function rangeError(raw: string, r: Range): string | null {
  const t = raw.trim(), v = Number(t);
  const ok = t !== "" && Number.isFinite(v) && (!r.whole || Number.isInteger(v)) && v >= r.min && (r.max == null || v <= r.max);
  if (ok) return null;
  if (r.max != null) return `Enter a ${r.whole ? "whole " : ""}number from ${num(r.min)} to ${num(r.max)}.`;
  return `Enter a ${r.whole ? "whole " : ""}number of ${num(r.min)} or more.`;
}
export const knobError = (field: KnobField, raw: string): string | null => rangeError(raw, KNOB_RANGES[field]);
// A requirement or weight value: any number.
export const ruleValueError = (raw: string): string | null => (raw.trim() !== "" && Number.isFinite(Number(raw)) ? null : "Enter a number.");
// The first knob that is wrong, in the order the fields are drawn.
export function firstKnobError(k: Knobs): { field: KnobField; error: string } | null {
  for (const field of ["strLimit", "restarts", "budgetS", "altCount", "altTol"] as KnobField[]) {
    if (!k.exact && (field === "budgetS" || field === "altCount" || field === "altTol")) continue;   // not sent without exact search
    const error = knobError(field, k[field]);
    if (error) return { field, error };
  }
  return null;
}
// Which field a server refusal is about ("opts.restarts must be an integer between 1 and 10000").
export function knobFromServerError(text: string): KnobField | null {
  if (/opts\.restarts/.test(text)) return "restarts";
  if (/opts\.timeBudgetMs/.test(text)) return "budgetS";
  if (/opts\.alternatives\.count/.test(text)) return "altCount";
  if (/opts\.alternatives\.tolerance/.test(text)) return "altTol";
  if (/strLimit/.test(text)) return "strLimit";
  return null;
}

// ---------------------------------------------------------------- result
export type Tone = "ok" | "warn" | "bad" | "muted";
// A resist tile's outcome line, in paperdoll values: short of the requirement, over or at the cap, or met.
export function resistOutcome(after: number, floor: number | null | undefined, cap: number): { text: string; tone: Tone } {
  if (floor != null && after < floor) return { text: `${floor - after} short`, tone: "warn" };
  if (after > cap) return { text: `${after - cap} over cap`, tone: "muted" };
  if (after === cap) return { text: "At cap", tone: "ok" };
  if (floor != null) return { text: `Meets ${floor}`, tone: "ok" };
  return { text: `${cap - after} below cap`, tone: "muted" };
}
// A Fetch list row's place as its path of containers ("Dorran's bank › Metal Chest (0x…) › A Bag", vault-lib's
// locationOf text), one crumb each, so the row can wrap it whole instead of cutting it short.
export function locationCrumbs(text: string | null | undefined): string[] {
  const parts = (text || "").split(" › ").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : ["Unknown place"];
}
// ---------------------------------------------------------------- what changes (issue #272)
// One property of the result's "What changes": its total worn now and in the suit (as summed, so what is wasted past the
// cap shows), its cap (null when it has none), the change in what counts (each total held at the cap), its share of the
// score (null when it adds nothing), its requirement (null for none) and the direction the build wants it (-1 for a
// negative weight, where less is better).
export interface ChangeRow { key: string; now: number; suit: number; cap: number | null; delta: number; share: number | null; floor: number | null; sign: 1 | -1 }
const ORDER = new Map<string, number>(PROPERTIES.map((p, i) => [p.key, i]));
const byRegistry = (a: string, b: string): number => (ORDER.get(a) ?? ORDER.size) - (ORDER.get(b) ?? ORDER.size) || propName(a).localeCompare(propName(b));
export const andList = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// Every property of the result, the Table view's rows: those either suit carries, every requirement and weight, and the `extra` keys (a buff's past-cap amount), in the registry's order (resists first, skill bonuses last), none the builder never offers (the tag penalty among them).
export function changeRows(before: PropMap, after: PropMap, caps: Record<string, number>, { floors = {}, weights = {}, shares = [], extra = [] }: { floors?: Record<string, number> | undefined; weights?: Record<string, number> | undefined; shares?: ScoreShare[] | undefined; extra?: string[] | undefined } = {}): ChangeRow[] {
  const share = new Map(shares.filter((s) => s.share !== 0).map((s) => [s.property, s.share]));
  const all = new Set([...Object.keys(floors), ...Object.keys(weights), ...extra, ...Object.keys(before).filter((k) => before[k]), ...Object.keys(after).filter((k) => after[k])]);
  return [...all].filter((k) => !NOT_BUILDER_KEYS.has(k)).sort(byRegistry).map((k) => {
    const now = before[k] || 0, suit = after[k] || 0, cap = caps[k] ?? null, held = (v: number): number => (cap == null ? v : Math.min(v, cap));
    return { key: k, now, suit, cap, delta: held(suit) - held(now), share: share.get(k) ?? null, floor: floors[k] ?? null, sign: (weights[k] ?? 0) < 0 ? -1 : 1 };
  });
}
// A change against what the build wants: a loss, or a rise in a property with a negative weight.
export const worse = (r: ChangeRow): boolean => r.delta * r.sign < 0;
const missed = (r: ChangeRow): boolean => r.floor != null && r.suit < r.floor;
// The gauges: the properties other than the resists (they have their tiles) whose counted total moves and that matter to the build (`matter`: a non-zero weight or a requirement, hard or soft), and every requirement the suit misses, moved or not; the better ones first. A pool (Stam/Mana/Hits pool) is never beside its bonus's gauge (Stam+, Mana+, HP+). `more` counts the other non-resist properties that move, shown only in the Table.
const POOL_OF: Record<string, string> = { stamPool: "stamInc", manaPool: "manaInc", hitsPool: "hpi" };
export function gaugeRows(rows: ChangeRow[], matter: readonly string[]): { gauges: ChangeRow[]; more: number } {
  const own = rows.filter((r) => !RESIST_KEYS.includes(r.key)), moved = own.filter((r) => r.delta !== 0);
  const picked = own.filter((r) => (r.delta !== 0 && matter.includes(r.key)) || missed(r));
  const gauges = picked.filter((r) => !(POOL_OF[r.key] && picked.some((x) => x.key === POOL_OF[r.key])));
  return { gauges: [...gauges.filter((r) => !worse(r)), ...gauges.filter(worse)], more: moved.filter((r) => !gauges.includes(r)).length };
}
// A gauge's short note: a requirement the suit misses ("needs 35", the warn tone); a change against the build ("given up", or "counts against" for a rise in a negative weight); a drop the build wants ("down from 5"); else against the cap: "at cap", "3 over cap", the next swing step under the cap for SSI (`nextSsi`, the result's nextSwingStep), "11 under cap"; with no cap, where it came from.
export function gaugeNote(r: ChangeRow, nextSsi: number | null = null): { text: string; warn: boolean } {
  const note = (text: string, warn = false): { text: string; warn: boolean } => ({ text, warn });
  if (missed(r)) return note(`needs ${num(r.floor!)}`, true);
  if (worse(r)) return note(r.sign < 0 ? "counts against" : "given up");
  if (r.sign < 0) return note(`down from ${num(r.now)}`);
  if (r.cap == null) return note(`up from ${num(r.now)}`);
  if (r.suit === r.cap) return note("at cap");
  if (r.suit > r.cap) return note(`${num(r.suit - r.cap)} over cap`);
  if (r.key === "ssi" && nextSsi != null && nextSsi > r.suit && nextSsi <= r.cap) return note(`next step ${num(nextSsi)}`);
  return note(`${num(r.cap - r.suit)} under cap`);
}
// A gauge's track in percent: the fill is the suit's total, the tick the total worn now, each by size as a share of the cap, or of the larger of the two with no cap (so a negative total draws too).
export function gaugeTrack(r: ChangeRow): { fill: number; tick: number } {
  const scale = r.cap ?? Math.max(Math.abs(r.now), Math.abs(r.suit)), pct = (v: number): number => (scale > 0 ? Math.min(100, (100 * Math.abs(v)) / scale) : 0);
  return { fill: pct(r.suit), tick: pct(r.now) };
}
// The "What changes" summary from its gauges: "5 up · 3 down · Defense Chance Increase and Damage Increase reach their caps · 1 requirement not met", counting what the gauges show by the direction of the counted change (a cap counts when the suit reaches it and the suit worn now does not).
export function changesSummary(gauges: ChangeRow[]): string {
  const up = gauges.filter((r) => r.delta > 0).length, down = gauges.filter((r) => r.delta < 0).length;
  const capped = gauges.filter((r) => r.cap != null && r.suit >= r.cap && r.now < r.cap).map((r) => propName(r.key));
  const short = gauges.filter(missed).length;
  return [up ? `${up} up` : "", down ? `${down} down` : "", capped.length ? `${andList(capped)} ${capped.length === 1 ? "reaches its cap" : "reach their caps"}` : "", short ? `${plural(short, "requirement")} not met` : ""].filter(Boolean).join(" · ") || "No other property changes";
}
// "<name> after the change": the attributes and pools, the ones that move first. The scan's attributes are
// totals with the current suit on, so after = total + the change in the bonus; the pools follow the sheet's
// estimate (STR/2 + HP Increase, DEX + Stamina Increase, INT + Mana Increase).
export interface AfterRow { key: string; label: string; before: number | null; after: number | null; delta: number }
export function afterChange(stats: Record<string, unknown>, maxes: Record<string, unknown>, before: PropMap, after: PropMap): AfterRow[] {
  const d = (k: string): number => (after[k] || 0) - (before[k] || 0);
  const val = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const rows: AfterRow[] = ([
    ["str", "Strength", stats, d("strBonus")], ["hits", "Hits", maxes, Math.floor(d("strBonus") / 2) + d("hpi")],
    ["stam", "Stamina", maxes, d("dexBonus") + d("stamInc")], ["mana", "Mana", maxes, d("intBonus") + d("manaInc")],
    ["dex", "Dexterity", stats, d("dexBonus")], ["int", "Intelligence", stats, d("intBonus")],
  ] as Array<[string, string, Record<string, unknown>, number]>).map(([key, label, src, delta]) => {
    const now = val(src[key]);
    return { key, label, before: now, after: now == null ? null : now + delta, delta };
  });
  return [...rows.filter((r) => r.delta !== 0), ...rows.filter((r) => r.delta === 0)];
}

// ---------------------------------------------------------------- compare
// 2-3 suits (or saved runs) side by side. A piece row differs when not every suit wears the same piece in
// that slot, and a cell is marked when it differs from the first suit's. A total row differs when the values
// are not all equal; its best cells are the highest value, where anything past the property's cap counts as
// the cap (70 fire and 86 fire are equally good). Differences only hides the rows that agree and lists them.
// A member's own caps (a saved run built with other resist caps than the others) decide its best values; else the
// shared caps do.
export interface CompareMember { assignment: Partial<Record<string, { serial: number; name: string } | null | undefined>>; totals: PropMap; caps?: Record<string, number> | undefined }
export interface ComparePieceRow { slot: string; label: string; cells: Array<{ text: string; diff: boolean; serial: number | null }> }
export interface CompareTotalRow { key: string; label: string; values: number[]; best: boolean[] }
export interface CompareModel { pieces: ComparePieceRow[]; totals: CompareTotalRow[]; hiddenTotals: string[]; hiddenPieces: number }
export function compareModel(members: CompareMember[], slots: string[], keys: string[], caps: Record<string, number>, differencesOnly = true): CompareModel {
  const pieces: ComparePieceRow[] = [];
  let hiddenPieces = 0;
  for (const slot of slots) {
    const serials = members.map((m) => m.assignment[slot]?.serial || 0);
    const differs = serials.some((s) => s !== serials[0]);
    if (!differs && differencesOnly) { hiddenPieces++; continue; }
    pieces.push({ slot, label: SLOT_LABELS[slot] || slot, cells: members.map((m, i) => ({ text: m.assignment[slot]?.name || "nothing", diff: i > 0 && serials[i] !== serials[0], serial: serials[i] || null })) });
  }
  const totals: CompareTotalRow[] = [], hiddenTotals: string[] = [];
  for (const key of [...new Set(keys)].filter((k) => k !== "tagPenalty")) {
    const values = members.map((m) => m.totals[key] || 0);
    const same = values.every((v) => v === values[0]);
    if (same && differencesOnly) { hiddenTotals.push(propName(key)); continue; }
    const eff = values.map((v, i) => { const cap = (members[i]!.caps || caps)[key]; return cap != null ? Math.min(v, cap) : v; });
    const top = Math.max(...eff), tie = eff.every((v) => v === eff[0]);
    totals.push({ key, label: propName(key), values, best: eff.map((v) => !tie && v === top) });
  }
  return { pieces, totals, hiddenTotals, hiddenPieces };
}
// The compare footer: "Rows where all three agree are hidden: Fire resist, Cold resist, …".
export function hiddenRowsNote(count: number, hidden: string[], hiddenPieces: number, shown = 8): string {
  const who = count === 2 ? "both" : count === 3 ? "all three" : `all ${count}`;
  const names = [...(hiddenPieces ? [plural(hiddenPieces, "slot")] : []), ...hidden];
  if (!names.length) return "";
  const list = names.length > shown ? `${names.slice(0, shown).join(", ")} and ${names.length - shown} more` : names.join(", ");
  return `Rows where ${who} agree are hidden: ${list}`;
}
// Ticking a suit or run for comparison: at most `max`, and a tick past that is refused with a reason
// instead of silently disabling Compare.
export function toggleCompare(selected: ReadonlySet<string>, id: string, on: boolean, max = 3, noun = "runs"): { next: Set<string>; refused: string | null } {
  const next = new Set(selected);
  if (!on) { next.delete(id); return { next, refused: null }; }
  if (!next.has(id) && next.size >= max) return { next, refused: `Up to ${max} ${noun}` };
  next.add(id);
  return { next, refused: null };
}

// ---------------------------------------------------------------- templates
// The template badge's buffs line, for a template that carries buffs: how the character's list differs from it as a set
// ("Buffs: +Enemy of One, −Consecrate Weapon"); null when they match.
export function templateBuffsLine(template: readonly string[], now: readonly string[]): string | null {
  const d = buffsDiff({ on: [...template], skills: {} }, { on: [...now], skills: {} });
  return d.length ? `Buffs: ${d.join(", ")}` : null;
}
// A source page's title from its URL: a wiki page's name ("PlayerGuide:Lazy_Pally" → "Lazy Pally", a slash in it kept),
// else the last path part (a forum thread's "archer-chiv-build.267" → "archer chiv build").
export function sourceTitle(url: string): string {
  let last = "";
  try {
    const path = decodeURIComponent(new URL(url).pathname), wiki = path.indexOf("/wiki/");
    last = wiki >= 0 ? path.slice(wiki + 6).replace(/\/$/, "") : path.split("/").filter(Boolean).pop() ?? "";
  } catch { /* an unparsable URL shows as itself */ }
  const words = last.replace(/^PlayerGuide:/, "").replace(/\.\d+$/, "");
  return (words.includes("_") ? words.replace(/_/g, " ") : words.replace(/-/g, " ")).trim() || url;
}

// ---------------------------------------------------------------- saved runs
// What changed between two runs' settings, their buffs included ("+Divine Fury").
export const runSettingsDiff = (a: RunSettings, b: RunSettings): string[] => [...settingsDiff(a, b), ...buffsDiff(a.buffs, b.buffs)];
// The slots a result plans, in GEAR_SLOTS order: those its suit (`best`) names, empty ones included. That is every gear
// slot, but for a run saved while the optimizer searched only twelve (SOLVER_VERSION 4), which still plans just those.
export const slotsOf = (best: unknown): string[] => GEAR_SLOTS.filter((s) => Object.hasOwn((best ?? {}) as object, s));
// A run's name when the player gave it none: how its settings differ from the run saved before it.
export function runAutoLabel(prev: RunSettings | null, settings: RunSettings): { text: string; diff: string[] } {
  if (!prev) return { text: "First saved run", diff: [] };
  const diff = runSettingsDiff(prev, settings);
  if (!diff.length) return { text: "Same settings as the run before", diff };
  const head = diff.slice(0, 3).join(" · ") + (diff.length > 3 ? ` · ${diff.length - 3} more` : "");
  return { text: head[0]!.toUpperCase() + head.slice(1), diff };
}
// A run's badges: its change count, how many requirements its suit meets, and the five resists in
// paperdoll values (item totals clipped at each cap, held at the character's Resisting Spells minimum `min`); a resist
// requirement is met at its cap when set above it, as the solver scored it. A resist whose cap
// the run overrode says so: "Fire 90 · cap 95".
export function runBadges(changes: number | null | undefined, totals: PropMap | null | undefined, floors: Record<string, number>, min: number | null, caps: Record<string, number>, shardCaps: Record<string, number> = caps): Array<{ text: string; tone?: "ok" | "warn" | undefined }> {
  const out: Array<{ text: string; tone?: "ok" | "warn" | undefined }> = [];
  if (changes != null) out.push({ text: plural(changes, "change") });
  if (!totals) return out;
  const pd = (k: string, v: number): number => (RESIST_KEYS.includes(k) && min != null && v < min ? min : v);
  const floorKeys = Object.keys(floors);
  if (floorKeys.length) {
    const met = floorKeys.filter((k) => pd(k, totals[k] || 0) >= effectiveFloor(k, floors[k]!, caps)).length;
    out.push({ text: `${met} of ${floorKeys.length} met`, tone: met === floorKeys.length ? "ok" : "warn" });
  }
  for (const k of RESIST_KEYS) {
    const cap = caps[k] ?? 70;
    out.push({ text: `${labelOf(k)} ${paperdollResist(totals[k] || 0, cap, min)}${cap !== (shardCaps[k] ?? cap) ? ` · cap ${cap}` : ""}` });
  }
  return out;
}

// ---------------------------------------------------------------- "Check your settings" (app/diagnostics.mts)
// The actions the page carries out on the panel's profile: the button's words, its done state, the toast once applied, its words when it no longer fits, and the edit itself. An action of another kind gets no button. `code` is the diagnostic's: a swing_next_step's setFloor sets the SSI requirement at a step, where every other setFloor lowers one.
type PanelAction = Extract<DiagnosticAction, { kind: "setFloor" | "makeSoft" | "setWeight" | "swingSteps" | "lockSlot" }>;
type PanelProfile = { floors?: Record<string, number> | undefined; softFloors?: string[] | undefined; weights?: Record<string, number> | undefined; swingSteps?: boolean | undefined; lockedSlots?: string[] | undefined; goals?: Goals | undefined };
export const handledAction = (a: DiagnosticAction): a is PanelAction => a.kind === "setFloor" || a.kind === "makeSoft" || a.kind === "setWeight" || a.kind === "swingSteps" || a.kind === "lockSlot";
const raises = (code: DiagnosticCode | undefined): boolean => code === "swing_next_step";
export function actionWords(a: PanelAction, code?: DiagnosticCode): { label: string; done: string; toast: string; stale: string } {
  if (a.kind === "setWeight") {
    const nm = propName(a.property);
    return { label: `Set ${nm} to ${a.value}`, done: "Set ✓", toast: `${nm} weight set to ${a.value}. Build again to use it.`, stale: "The weight changed since this build, so this no longer applies." };
  }
  if (a.kind === "swingSteps") {
    const stale = "The swing step switch changed since this build, so this no longer applies.";
    return a.on ? { label: "Score swing speed by step", done: "Scoring by step ✓", toast: "Swing Speed Increase is scored by swing step now. Build again to use it.", stale }
      : { label: "Score Swing Speed Increase per point", done: "Per point ✓", toast: "Swing Speed Increase is scored per point now. Build again to use it.", stale };
  }
  if (a.kind === "lockSlot") { const sl = SLOT_LABELS[a.slot] || a.slot; return { label: `Lock ${sl}`, done: "Locked ✓", toast: `${sl} is locked to what is worn now. Build again to use it.`, stale: `${sl} was locked since this build, so this no longer applies.` }; }
  const req = `${propName(a.property)} requirement`, stale = "The requirement changed since this build, so this no longer applies.";
  if (a.kind === "setFloor" && raises(code)) return { label: `${propName(a.property)} floor ${a.value} (soft)`, done: "Set ✓", toast: `${req} set to ${a.value}, soft. Build again to use it.`, stale };
  return a.kind === "setFloor"
    ? { label: `Lower to ${a.value}`, done: "Lowered ✓", toast: `${req} lowered to ${a.value}. Build again to use it.`, stale }
    : { label: "Make soft", done: "Made soft ✓", toast: `${req} is soft now. Build again to use it.`, stale };
}
// Whether the action still fits the panel as it is now: the requirement is still there, Lower would lower it, and Make soft finds it hard; Set weight finds the weight the build ran with (`from`, the diagnostic's values.weight); a step's requirement finds the panel asking for less, the switch the other way, a lock the slot unlocked. A build's numbers never put back a requirement or weight the player removed, or undo one they changed since.
export function actionApplies(p: PanelProfile, a: PanelAction, from?: number, code?: DiagnosticCode): boolean {
  if (a.kind === "setWeight") return from != null && p.weights?.[a.property] === from;
  if (a.kind === "swingSteps") return !!p.swingSteps !== a.on;
  if (a.kind === "lockSlot") return !(p.lockedSlots || []).includes(a.slot);
  const f = p.floors?.[a.property];
  if (a.kind === "setFloor" && raises(code)) return f == null || f < a.value;
  if (f == null) return false;
  return a.kind === "setFloor" ? f > a.value : !(p.softFloors || []).includes(a.property);
}
export function applyAction(p: PanelProfile, a: PanelAction, from?: number, code?: DiagnosticCode): void {
  if (!actionApplies(p, a, from, code)) return;
  // a weight or the swing-step switch set by hand: the goals no longer set them (issue #292)
  if ((a.kind === "setWeight" || a.kind === "swingSteps") && p.goals) p.goals = { ...p.goals, ownWeights: true };
  if (a.kind === "setWeight") p.weights![a.property] = weightOfImportance(a.property, a.value);   // the action names an importance; the profile is per point
  else if (a.kind === "swingSteps") p.swingSteps = a.on;
  else if (a.kind === "lockSlot") (p.lockedSlots ||= []).push(a.slot);
  else if (a.kind === "setFloor") {
    (p.floors ||= {})[a.property] = a.value;
    // a swing step's requirement goes in soft: a hard one could conflict with the other hard requirements
    if (raises(code) && !(p.softFloors ||= []).includes(a.property)) p.softFloors.push(a.property);
  } else (p.softFloors ||= []).push(a.property);
}
// A weight's importance as its editable box shows it (issue #272): the stored value to at most two decimals, trailing zeros
// trimmed, so a typed 12.5 reads 12.5 after any redraw (a tooltip or summary may round further, roundImportance).
export const shownImportance = (n: number): number => Math.round(n * 100) / 100;
// A weight the player adds starts at importance 25, the same for every property (issue #274).
export const NEW_WEIGHT_IMPORTANCE = 25;
export const newWeight = (key: string): number => weightOfImportance(key, NEW_WEIGHT_IMPORTANCE);
// What a field that shows a stored value in another unit (a weight's importance) stores when `typed` is entered: the first stored value when `typed` is what it showed, the current one when `typed` is what that shows, else `typed` converted. So a field merely touched (retyped, or ↑ then ↓) keeps its exact value.
export function editedValue(first: number, current: number, typed: number, conv: { show: (v: number) => number; store: (n: number) => number }): number {
  if (typed === conv.show(first)) return first;
  return typed === conv.show(current) ? current : conv.store(typed);
}
// A weight row's hover (issue #274): the trade-off with the top property, the one with the highest importance, from the per-point weights' ratio in units of the smaller one (whole from 1.5 up) ("At these settings, 1 Damage is worth about 16 Luck."). The top row says the others are compared with it. A Resisting Spells skill bonus also lifts every resist's minimum, which its weight leaves out, so its hover says so.
export function weightTradeoff(key: string, weights: Record<string, number>): string {
  const w = weights[key]!, L = propName;   // the row's own name (issue #302)
  const top = Object.entries(weights).filter(([k, v]) => !NOT_BUILDER_KEYS.has(k) && Number.isFinite(v) && v > 0).sort((a, b) => importanceOf(b[0], b[1]) - importanceOf(a[0], a[1]))[0];
  // one decimal under 1.5 ("about 1.4"), whole above, and no number past 1,000
  const about = (x: number): string => (x > 1000 ? "far more than 1,000" : `about ${num(x < 1.5 ? Math.round(x * 10) / 10 : Math.round(x))}`);
  const line = !Number.isFinite(w) || w === 0 ? `At weight 0, ${propName(key)} doesn't count.`
    : !top ? `${propName(key)} counts against the score.`
    : top[0] === key ? `${propName(key)} has the highest weight: the other weights are compared with it.`
    : w > 0 ? (w >= top[1] ? `At these settings, 1 ${L(key)} is worth ${about(w / top[1])} ${L(top[0])}.` : `At these settings, 1 ${L(top[0])} is worth ${about(top[1] / w)} ${L(key)}.`)
    : -w >= top[1] ? `At these settings, 1 ${L(key)} takes away what ${about(-w / top[1])} ${L(top[0])} adds.` : `At these settings, 1 ${L(top[0])} makes up for ${about(top[1] / -w)} ${L(key)}.`;
  return key === RESIST_SKILL_KEY ? `${line} It also raises your resist minimums.` : line;
}
// What a result's "Check your settings" lists: its diagnostics, warnings first; a run saved before them (no `diagnostics`) says what it knew, its unreachable hard floors, as one warning with no actions. On another suit's card (`alternative`) the floors_conflict rows are left out: their values are the best suit's.
export function resultChecks(res: { diagnostics?: Diagnostic[] | undefined; unreachableFloors?: string[] | undefined }, withBuffs: boolean, alternative = false): Diagnostic[] {
  if (res.diagnostics) {
    const list = res.diagnostics.filter((d) => !alternative || d.code !== "floors_conflict").map(withCurrentActions);
    return [...list.filter((d) => d.level === "warn"), ...list.filter((d) => d.level !== "warn")];
  }
  const keys = res.unreachableFloors || [];
  return keys.length ? [{ code: "floor_unreachable", level: "warn", message: `No suit in the pool can reach these requirements${withBuffs ? ", even with the buffs" : ""}: ${keys.map((k) => propName(k)).join(", ")}.`, actions: [] }] : [];
}

// ---------------------------------------------------------------- what made up the score (app/diagnostics.mts scoreShares)
// The breakdown's rows: the positive shares largest first, those under `fold` as one "Other" row naming what it holds (a lone one keeps its own name), then the negative ones, largest first, set apart. A resist held at a Resisting Spells minimum above its gear total says so.
export const SHARE_FOLD = 0.02;
// `key` is the row's property, null for Other.
export interface ShareRow { key: string | null; label: string; pct: string; share: number; negative: boolean; note: string | null; holds: string | null }
export const sharePct = (share: number): string => { const p = Math.round(Math.abs(share) * 100); return `${share < 0 ? "−" : ""}${p === 0 && share !== 0 ? "<1" : p}%`; };
export function shareRows(shares: ScoreShare[], fold = SHARE_FOLD): ShareRow[] {
  const row = (key: string | null, label: string, share: number, note: string | null = null, holds: string | null = null): ShareRow => ({ key, label, pct: sharePct(share), share, negative: share < 0, note, holds });
  const own = (s: ScoreShare): ShareRow => row(s.property, propName(s.property), s.share, s.fromMin ? "includes the Resisting Spells minimum" : null);
  const positive = shares.filter((s) => s.share >= 0).sort((a, b) => b.share - a.share), small = positive.filter((s) => s.share < fold);
  const rows = positive.filter((s) => s.share >= fold).map(own);
  if (small.length === 1) rows.push(own(small[0]!));
  else if (small.length) rows.push(row(null, `Other (${small.length})`, small.reduce((n, s) => n + s.share, 0), null, small.map((s) => propName(s.property)).join(", ")));
  return [...rows, ...shares.filter((s) => s.share < 0).sort((a, b) => a.share - b.share).map(own)];
}

// ---------------------------------------------------------------- swing (app/swing.mts)
// A result's swing line and its steps: "Longsword 3.5 s · stamina 95 · Swing Speed Increase 45 (+10 Divine Fury) → swings every 1.75 s", then the last few steps at that stamina with the reached ones marked, and the next faster delay when the cap keeps it out of reach. `buffs` names what gave the share.
export function swingLines(sw: SwingResult, weapon: string | null, buffs: string[] = [], shown = 4): { head: string; steps: Array<{ text: string; reached: boolean }>; out: string | null } {
  const share = sw.share ? ` (${signed(sw.share)} ${buffs.length ? buffs.join(", ") : "buffs"})` : "";
  const head = `${weapon ?? "Weapon"} ${speedText(sw.speed)} · stamina ${sw.stamina} · ${propName("ssi")} ${sw.ssi}${share} → swings every ${delayText(sw.seconds)}`;
  const steps = sw.steps.slice(-shown).map((st) => ({ text: `${delayText(st.seconds)} ≥ ${st.ssi}`, reached: sw.ssi >= st.ssi }));
  const fastest = sw.steps.length ? sw.steps[sw.steps.length - 1]!.seconds : sw.seconds;
  return { head, steps, out: fastest > MIN_TICKS * 0.25 ? `${delayText(fastest - 0.25)} out of reach` : null };
}
// A weapon's base speed as the page writes it: "3.5 s", "2.25 s".
export const speedText = (speedS: number): string => `${num(speedS)} s`;
// The SSI requirement a "Next step" button fills in: the effective SSI of the first step faster than `sw` reaches, or null when there is none within the cap. Its tooltip names the stamina it assumed.
export function nextSwingStep(sw: SwingResult | null | undefined): { value: number; seconds: number; tip: string } | null {
  const next = sw?.steps.find((st) => st.ssi > sw.ssi);
  return sw && next ? { value: next.ssi, seconds: next.seconds, tip: `${delayText(next.seconds)} at stamina ${sw.stamina}; another suit's stamina can move the step.` } : null;
}
// A requirement row's line from the result shown (issue #272), met or short exactly as the solver decides it, the raw total against the requirement it counts (effectiveFloor): "Met: 45", else "2 short" in the warn tone. The cap is only for what it shows: a met total past its cap reads the cap, as the paperdoll does, and what the cap wastes, "Met: 70 (+8 past cap)". The SSI row gives the next swing step instead of "Met" (`next`, nextSwingStep of the result's swing, and the weapon it holds): "Next swing step at 58 (1.25 s with Katana)", after "2 short" when it misses.
export function needStatus(k: string, floor: number, total: number, caps: Record<string, number>, next: { value: number; seconds: number } | null = null, weapon: string | null = null): { text: string; tone: Tone } {
  const held = caps[k] != null ? Math.min(total, caps[k]!) : total, short = effectiveFloor(k, floor, caps) - total;
  const step = next ? `Next swing step at ${num(next.value)} (${delayText(next.seconds)} with ${weapon ?? "the weapon"})` : null;
  if (short > 0) return { text: [`${num(short)} short`, step].filter(Boolean).join(" · "), tone: "warn" };
  return { text: step ?? `Met: ${num(held)}${total > held ? ` (+${num(total - held)} past cap)` : ""}`, tone: "ok" };
}

// ---------------------------------------------------------------- arriving (issue #272): the first-visit view and coming back
const stampMs = (s: string | null | undefined): number => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : -Infinity; };
type RunStamp = { id: string; createdAt: string; character?: string | undefined };
// The newest run of a list, by when it was built (whatever the list's order); null for none.
export function latestRun<R extends RunStamp>(runs: readonly R[]): R | null {
  return runs.reduce<R | null>((best, r) => (!best || stampMs(r.createdAt) > stampMs(best.createdAt) ? r : best), null);
}
// The latest run of each character other than `except`, newest first, at most `n`.
export function otherCharactersRuns<R extends RunStamp>(runs: readonly R[], except: string | null, n = 3): R[] {
  const by = new Map<string, R[]>();
  for (const r of runs) if (r.character != null && r.character !== except) by.set(r.character, [...(by.get(r.character) ?? []), r]);
  return [...by.values()].map((list) => latestRun(list)!).sort((a, b) => stampMs(b.createdAt) - stampMs(a.createdAt)).slice(0, n);
}
// Whether the inventory changed since a run was built (the drawer's "Inventory changed" and the result's banner): the newest
// scan is not the one the run was built from (its `inventoryStamp`), so a scan stamped before the build that landed after it
// counts too. A run saved without a stamp falls back to its build time: a scan newer than it. No scan, or neither a stamp
// nor a time, is no change.
export function gearChangedSince(scans: ReadonlyArray<{ scannedAt: string }>, run: { inventoryStamp?: unknown; createdAt?: string | null | undefined }): boolean {
  if (typeof run.inventoryStamp === "string" && run.inventoryStamp) {
    const newest = scans.reduce<{ scannedAt: string } | null>((best, s) => (!best || stampMs(s.scannedAt) > stampMs(best.scannedAt) ? s : best), null);
    return !!newest && newest.scannedAt !== run.inventoryStamp;
  }
  const at = stampMs(run.createdAt);
  return at > -Infinity && scans.some((s) => stampMs(s.scannedAt) > at);
}
// Where a moved piece of a run's suit is now, as the banner and the Plan word it: "worn by Kestrel", "in Kestrel's bank",
// "in Kestrel's backpack › Pouch", "in Armor box". `where` words a location text as the page does (dom.mts whereText).
const nowAt = (m: GearChanges["moved"][number], where: (text: string) => string): string => (m.wornBy ? `worn by ${m.wornBy}` : `in ${where(m.place)}`);
// What changed in the gear since a run, as its banner lists it (issue #291): the new pieces its pool takes (with the
// containers they are in, when one or two), the suit's pieces that moved, then those gone; past `max` lines the rest as
// "and N more".
export function gearChangeLines(g: GearChanges, where: (text: string) => string, max = 3): string[] {
  const lines = [
    ...(g.added ? [`${plural(g.added, "new piece")} you could use${g.addedPlaces.length ? ` in ${listWords(g.addedPlaces.map(where))}` : ""}`] : []),
    ...g.moved.map((m) => `${m.name} is now ${nowAt(m, where)}`),
    ...g.gone.map((p) => `${p.name} is no longer in the scans`),
  ];
  return lines.length > max + 1 ? [...lines.slice(0, max), `and ${lines.length - max} more`] : lines;
}
export const GONE_MARK = "No longer in the scans";
// A piece of the run's suit as the Plan marks it: "Now worn by <character>" or "Now in <place>" when it moved, "No longer
// in the scans" when it is gone, else null.
export function pieceMark(g: GearChanges | null | undefined, serial: number | undefined, where: (text: string) => string): string | null {
  if (!g || !serial) return null;
  if (g.gone.some((p) => p.serial === serial)) return GONE_MARK;
  const m = g.moved.find((p) => p.serial === serial);
  return m ? `Now ${nowAt(m, where)}` : null;
}
// The run to come back to: the newest that kept a suit (a run file whose result is gone lists with no method).
export const latestShownRun = <R extends RunStamp & { method?: string | null | undefined }>(runs: readonly R[]): R | null => latestRun(runs.filter((r) => r.method != null));
// A skill counts toward a template's suggestion from this value up.
export const SUGGEST_MIN_SKILL = 30;
// The templates the first-visit view offers beside the suggested one, at most `n`: each scored by the skill points of
// the character's trained skills its text names (its name, description, its buffs' casting skills and its casting school,
// `text`), the highest first, ties and the rest in catalog order.
export function suggestTemplates(cands: ReadonlyArray<{ ref: string; text: string }>, skills: Readonly<Record<string, number>>, n = 3): string[] {
  const trained = Object.entries(skills).filter(([, v]) => v >= SUGGEST_MIN_SKILL).map(([k, v]) => [k.toLowerCase(), v] as const);
  const score = (text: string): number => { const t = text.toLowerCase(); return trained.reduce((s, [k, v]) => (t.includes(k) ? s + v : s), 0); };
  return cands.map((c, i) => ({ ref: c.ref, s: score(c.text), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((c) => c.ref);
}
// The summary's Needs line: each requirement ("Defense Chance Increase 45"), a soft one marked "(soft)", the five resists
// as one "Resists 70" when they are alike; "None" with none. `name` is a property's name (propName).
export function needsLine(floors: Readonly<Record<string, number>>, soft: readonly string[], name: (k: string) => string): string {
  const tag = (k: string): string => (soft.includes(k) ? " (soft)" : "");
  const first = RESIST_KEYS[0]!, alike = RESIST_KEYS.every((k) => floors[k] != null && floors[k] === floors[first] && tag(k) === tag(first));
  const rest = Object.keys(floors).filter((k) => !NOT_BUILDER_KEYS.has(k) && !(alike && RESIST_KEYS.includes(k)));
  return [...(alike ? [`Resists ${num(floors[first]!)}${tag(first)}`] : []), ...rest.map((k) => `${name(k)} ${num(floors[k]!)}${tag(k)}`)].join(" · ") || "None";
}
// "What matters most": the weights that add, by importance, largest first, the five resists as one row ("resists") when
// they weigh alike; the first `n` and how many more there are.
export function topWeights(weights: Readonly<Record<string, number>>, n = 4): { rows: Array<{ key: string; importance: number }>; more: number } {
  const first = RESIST_KEYS[0]!, alike = RESIST_KEYS.every((k) => weights[k] === weights[first] && weights[k]! > 0);
  const keys = Object.keys(weights).filter((k) => !NOT_BUILDER_KEYS.has(k) && weights[k]! > 0 && !(alike && RESIST_KEYS.includes(k)));
  const rows = [...(alike ? [{ key: "resists", importance: importanceOf(first, weights[first]!) }] : []), ...keys.map((k) => ({ key: k, importance: importanceOf(k, weights[k]!) }))]
    .sort((a, b) => b.importance - a.importance);
  return { rows: rows.slice(0, n), more: Math.max(0, rows.length - n) };
}
// The summary's Pool line: the weapons allowed, the gear pieces scanned (when known) and the rarity preference.
export function poolLine(excluded: string[] = [], ubws = false, pieces: number | null = null, rarity: string | undefined = undefined): string {
  const weapons = weaponsText(excluded, ubws, { any: "Any weapon", none: "No weapons", only: (w) => `${weaponName(w)} only`, some: (ex) => `${plural(ex.length, "weapon skill")} left out`, noBooks: "Any weapon, no spellbooks" });
  return [weapons, pieces != null ? plural(pieces, "piece") : null, rarity ? `prefer ${rarity} rarity` : "any rarity"].filter(Boolean).join(" · ");
}
// The summary's Search line, from the Advanced fields as typed: "Exact, up to 30 s" or "Heuristic, 20 restarts".
export const searchLine = (k: Pick<Knobs, "exact" | "budgetS" | "restarts">): string => (k.exact ? `Exact, up to ${k.budgetS} s` : `Heuristic, ${k.restarts} restarts`);

// ---------------------------------------------------------------- goals (issue #292, vault-lib.mts compileGoals)
// A goal's property in a sentence ("Swing Speed Increase"; a pool as plain words, "stamina from gear and buffs"), from vault-lib.mts's propName, the one name per property.
export { goalWord };
// The goals as rows, most important first: each property with its rank (from 1), whether it shares that rank with the row above, and what it counts.
export interface GoalRow { key: string; rank: number; linked: boolean; counts: number }
export const goalRows = (g: Goals): GoalRow[] => g.ranks.flatMap((r, i) => r.map((key, j) => ({ key, rank: i + 1, linked: j > 0, counts: rankImportance(i) })));
// The first-visit view's "What matters most" with goals in force (issue #302): one row per rank, its goals' names joined
// ("Hit Chance Increase = Defense Chance Increase", Swing Speed Increase with its swing time) and what it counts, the first `n`, how many goals the
// ranks past them hold, and where spare points go ("Spare points: Luck", "Spare points: not used").
export function goalSummary(g: Goals, n = 4): { rows: Array<{ rank: number; names: string; counts: number }>; more: number; spare: string } {
  const rows = g.ranks.map((r, i) => ({ rank: i + 1, names: r.map((k) => goalLabel(g, k)).join(" = "), counts: rankImportance(i) }));
  return { rows: rows.slice(0, n), more: g.ranks.slice(n).flat().length, spare: `Spare points: ${g.leftover === "none" ? "not used" : LEFTOVER_LABELS[g.leftover]}` };
}
// The edits the Goals tab makes, each a new set of goals. ↑ and ↓ move the row's whole rank past the next one; "=" links a row
// to the one above (sharing its rank) or unlinks it (its own rank, and the rows under it with it); ✕ removes a row; a new goal
// goes last.
const fromRows = (g: Goals, rows: Array<{ key: string; linked: boolean }>): Goals => {
  const ranks: string[][] = [];
  for (const r of rows) if (r.linked && ranks.length) ranks.at(-1)!.push(r.key); else ranks.push([r.key]);
  return { ...g, ranks };
};
export function moveGoal(g: Goals, key: string, by: -1 | 1): Goals {
  const i = g.ranks.findIndex((r) => r.includes(key)), j = i + by;
  if (i < 0 || j < 0 || j >= g.ranks.length) return g;
  const ranks = g.ranks.map((r) => [...r]);
  [ranks[i], ranks[j]] = [ranks[j]!, ranks[i]!];
  return { ...g, ranks };
}
export const linkGoal = (g: Goals, key: string, on: boolean): Goals => fromRows(g, goalRows(g).map((r, i) => (r.key === key && i > 0 ? { ...r, linked: on } : r)));
export const removeGoal = (g: Goals, key: string): Goals => ({ ...g, ranks: g.ranks.map((r) => r.filter((k) => k !== key)).filter((r) => r.length) });
export const addGoal = (g: Goals, key: string): Goals => (g.ranks.some((r) => r.includes(key)) ? g : { ...g, ranks: [...g.ranks.map((r) => [...r]), [key]] });

// "How the goals went" on a result: each goal's suit total against its cap (held there), maxed when it reaches it. Swing
// Speed Increase with a known swing is maxed when that swing reaches its goal (`ssiMaxed`, swingOutcome), not by its SSI. Totals
// and caps are paperdoll terms.
export interface GoalOutcome { key: string; rank: number; value: number; cap: number | null; maxed: boolean }
export function goalOutcomes(g: Goals, suit: PropMap, caps: Readonly<Record<string, number>>, ssiMaxed: boolean | null = null): GoalOutcome[] {
  return goalRows(g).map(({ key, rank }) => {
    const cap = caps[key] ?? null, value = cap == null ? suit[key] || 0 : Math.min(suit[key] || 0, cap);
    return { key, rank, value, cap, maxed: key === "ssi" && ssiMaxed != null ? ssiMaxed : cap != null && value >= cap };
  });
}
// A goal's verdict in words, never claiming more than is known: "maxed"; "went down to make room for Hit Chance Increase" when a
// trade gave it up; else that something came first: for the top goal the requirements or the pieces there are, for any
// other higher goals or the requirements.
export function goalVerdict(o: GoalOutcome, trades: readonly GoalTrade[]): string {
  if (o.maxed) return "maxed";
  const t = trades.find((x) => x.key === o.key);
  if (t) return `went down to make room for ${andList(t.ups.map((u) => goalWord(u.key)))}`;
  return o.rank === 1 ? "not maxed: your requirements, or the pieces you have, came first" : "not maxed: higher goals or your requirements came first";
}
// Swing Speed Increase's line in seconds, from the suit's own swing (its weapon and stamina), with its SSI as secondary text:
// "As fast as possible" reads "1.75 s with Broadsword (fastest it can reach)", or "2.75 s with Broadsword" with what the
// goal's weapon could reach (`worn`: "1.25 s possible with Double Bladed Staff"); a swing time reads "1.5 s with War Axe ·
// goal met", or "1.75 s with War Axe · goal was every 1.5 s". When the swing time is missed with another weapon than the
// one the goal was set for (`worn`, by its speed when both are known, else by name), the verdict says which weapon
// the goal was set for (`verdict`: "the suit uses a Longsword; the 1.5 s goal was set for your Katana"). Maxed only when the
// suit's swing reaches the goal's delay, or its weapon's fastest step (`fastest`).
export interface SwingOutcome { text: string; ssi: string; after: string | null; maxed: boolean; verdict: string | null }
const aWeapon = (w: string): string => (/^the\b/i.test(w) ? w : `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`);
export function swingOutcome(g: Goals, sw: { seconds: number; ssi: number; speed?: number | undefined }, weapon: string | null, fastest: boolean, worn: { seconds: number; weapon: string | null; speed?: number | undefined } | null = null): SwingOutcome {
  const goal = g.swing?.mode === "every" ? g.swing.seconds ?? null : null, w = weapon ?? "the weapon", at = `${delayText(sw.seconds)} with ${w}`, ssi = `${propName("ssi")} ${num(sw.ssi)}`;
  if (goal != null) {
    const met = sw.seconds <= goal, other = !!worn?.weapon && (sw.speed != null && worn.speed != null ? sw.speed !== worn.speed : worn.weapon !== weapon);
    if (!met && other && weapon) return { text: at, ssi, after: null, maxed: false, verdict: `the suit uses ${aWeapon(weapon)}; the ${delayText(goal)} goal was set for your ${worn!.weapon}` };
    return { text: met ? `${at} · goal met` : `${at} · goal was every ${delayText(goal)}`, ssi, after: null, maxed: met, verdict: null };
  }
  const possible = !fastest && worn && worn.seconds < sw.seconds ? `${delayText(worn.seconds)} possible with ${worn.weapon ?? "the weapon worn now"}` : null;
  return { text: fastest ? `${at} (fastest it can reach)` : at, ssi, after: possible, maxed: fastest, verdict: null };
}
// The trades the build made, from what is worn now to the suit: a goal that went down while a lower-ranked one went up,
// each held at its cap, in rank order, at most `n`, each with every lower goal that rose.
export interface GoalTrade { key: string; from: number; to: number; ups: Array<{ key: string; by: number }> }
export function goalTrades(g: Goals, now: PropMap, suit: PropMap, caps: Readonly<Record<string, number>>, n = 3): GoalTrade[] {
  const held = (k: string, t: PropMap): number => (caps[k] != null ? Math.min(t[k] || 0, caps[k]!) : t[k] || 0);
  const rows = goalRows(g).map((r) => ({ ...r, from: held(r.key, now), to: held(r.key, suit) }));
  return rows.filter((d) => d.to < d.from).flatMap((d) => {
    const ups = rows.filter((u) => u.rank > d.rank && u.to > u.from).map((u) => ({ key: u.key, by: u.to - u.from }));
    return ups.length ? [{ key: d.key, from: d.from, to: d.to, ups }] : [];
  }).slice(0, n);
}
// A trade in words: "−1 Swing Speed Increase (56 → 55, still a 1.5 s swing) for +15 Hit Chance Increase and +10 Damage
// Increase". `swing`, the delays worn now and in the suit, when the goal given up is Swing Speed Increase.
export function tradeText(t: GoalTrade, swing: { from: number; to: number } | null = null): string {
  const s = t.key === "ssi" && swing ? `, ${swing.from === swing.to ? `still a ${delayText(swing.to)}` : `${delayText(swing.from)} → ${delayText(swing.to)}`} swing` : "";
  const ups = t.ups.map((u) => `+${num(u.by)} ${goalWord(u.key)}`);
  return `−${num(t.from - t.to)} ${goalWord(t.key)} (${num(t.from)} → ${num(t.to)}${s}) for ${andList(ups)}`;
}
// The spare-points group's properties that are not goals (none for Nothing, or when every one is a goal).
export const spareKeys = (g: Goals): string[] => { const goals = new Set(g.ranks.flat()); return LEFTOVER_GROUPS[g.leftover].filter((k) => !goals.has(k)); };
// Where the spare points went, one line or none: the group's members that rose, "Spare points went to: Luck +120 (60 → 180)"
// (the totals only for one); with none risen, "Spare points: none left over (Luck stays 96)", or when the goals cost some,
// "Spare points: none left over. The goals cost some Luck (126 → 96)". None for Nothing, or a group whose every member is a goal.
export function spareLine(g: Goals, now: PropMap, suit: PropMap): string | null {
  const keys = spareKeys(g), v = (t: PropMap, k: string): number => t[k] || 0, d = (k: string): number => v(suit, k) - v(now, k);
  if (!keys.length) return null;
  const up = keys.filter((k) => d(k) > 0), down = keys.filter((k) => d(k) < 0), span = (k: string): string => `${num(v(now, k))} → ${num(v(suit, k))}`;
  if (up.length) return `Spare points went to: ${up.map((k) => `${propName(k)} ${signed(d(k))}${up.length === 1 ? ` (${span(k)})` : ""}`).join(", ")}`;
  if (down.length) return `Spare points: none left over. The goals cost some ${andList(down.map((k) => `${propName(k)} (${span(k)})`))}`;
  return `Spare points: none left over (${keys.length === 1 ? `${propName(keys[0]!)} stays ${num(v(suit, keys[0]!))}` : `${andList(keys.map(propName))} unchanged`})`;
}
