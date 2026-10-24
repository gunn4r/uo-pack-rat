// domain/tooltip.mts — reading an item's tooltip lines: parseTooltip turns them into properties, set bonus, tags, rarity, extras and flags (the patterns come from domain/properties.mts, the tag units and rarity ladder from the shard rules), and the names an item is shown and sorted by.
//
// map: scan
// owns: `ParsedTooltip`, `parseTooltip`, `NAMED_ARTIFACT`, `tagUnits`, `tagInfo`, `stackName`, `shownName`, `gameName`, `displayName`, `compareNames`
import { getRules } from "./rules.mts";
import { PROP_PATTERNS, type ExtrasMap, type PropMap } from "./properties.mts";

export interface ParsedTooltip {
  name: string;
  props: PropMap;
  setBonus: PropMap;
  tags: string[];
  strReq: number;
  rarity: string | null;
  // A named artifact's "Artifact Rarity N" (issue #568), or null.
  artifactRarity: number | null;
  extras: ExtrasMap;
  flags: string[];
  twoHanded: boolean | null;
  weight: number | null;
  skillReq: string | null;
  // A Scroll of Transcendence's skill as its tooltip writes it ("Animal Lore"); its points are props.sotPoints.
  sotSkill: string | null;
  lines: string[];
}

// Cursed/Brittle/Antique/Prized (/Massive/Unwieldy on shards that use them) tag-penalty units, from
// the shard's rules file. A function, not a constant, because it must reflect whichever shard is
// currently loaded (setRules() may be called again after a shard switch). Keys are lower-cased, since
// parseTooltip matches them against lower-cased tooltip lines and a rules file may write "Cursed".
const TAG_UNITS_CACHE = new WeakMap<object, Record<string, number>>();
export function tagUnits(): Record<string, number> {
  const raw = getRules().tagUnits;
  let lower = TAG_UNITS_CACHE.get(raw);
  if (!lower) TAG_UNITS_CACHE.set(raw, lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])));
  return lower;
}
// A tag's meaning in plain words (the shard's rules `tagInfo`, optional), or null when the shard gives none.
const TAG_INFO_CACHE = new WeakMap<object, Record<string, string>>();
export function tagInfo(tag: string): string | null {
  const raw = getRules().tagInfo;
  if (!raw) return null;
  let lower = TAG_INFO_CACHE.get(raw);
  if (!lower) TAG_INFO_CACHE.set(raw, lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])));
  return lower[tag.toLowerCase()] ?? null;
}
// A rarity line: one of the shard's rarity ladder names (rules `rarity`), optionally "Reforged ...".
const RARITY_RE_CACHE = new WeakMap<object, RegExp>();
function rarityRe(): RegExp {
  const ladder = getRules().rarity;
  let re = RARITY_RE_CACHE.get(ladder);
  if (!re) {
    const names = ladder.map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    RARITY_RE_CACHE.set(ladder, re = new RegExp(`^(?:reforged\\s+)?(?:${names})$`, "i"));
  }
  return re;
}

// The tier a named artifact reads as (issue #568), above every tier on the shard's ladder: an item whose tooltip has an
// "Artifact Rarity N" line, or whose name is on the shard's list of named artifacts that carry no such line (rules
// `namedArtifacts`). It wins over a tier line on the same item, which stays among its lines.
export const NAMED_ARTIFACT = "Named Artifact";
const NAMED_CACHE = new WeakMap<object, Set<string>>();
function namedArtifact(name: string): boolean {
  const list = getRules().namedArtifacts;
  if (!list) return false;
  let names = NAMED_CACHE.get(list);
  if (!names) NAMED_CACHE.set(list, names = new Set(list.map((n) => n.toLowerCase())));
  return names.has(name.toLowerCase());
}

// The longest line any real tooltip carries is ~54 characters; the scan schema caps one at 512
// (scan.v2.schema.json's tooltip items), so a validated scan is never truncated here. The cap is
// repeated at the parser because a scan already on disk from before that bound existed still gets
// parsed on every fold — and regex cost on a line is what a hostile scan used to buy (Phase 7
// security review, Area 2, Important 3).
const MAX_TOOLTIP_LINE = 512;
export const stripHtml = (s: unknown): string => String(s || "").slice(0, MAX_TOOLTIP_LINE).replace(/<[^>]+>/g, "").trim();
// "any other numeric line" — the fallback that turns an unmodeled line into an `extras` entry. It
// matches the TAIL (a number, an optional %/s, an optional "- N" range) anchored to the end, and the
// property name is whatever precedes it; the old single expression put a lazy `(.*?)` head in front
// of a greedy `[\s:+]*` separator, and the two overlapped on the same characters, so a line ending in
// something the tail could not match forced the engine through every split of the overlap — clean
// O(n^2) (9 s on one 128k-character line). Leftmost-match picks the same number the lazy head did,
// and stripping the separator run off the end of the head reproduces what `[\s:+]*` used to eat.
const NUMERIC_TAIL_RE = /(-?\d+(?:\.\d+)?)\s*(%|s)?\s*(?:-\s*(\d+))?$/;

// A set piece describes its set in one of two places (ServUO BaseArmor.AddNameProperties and
// GetSetProperties, SetHelper.GetSetProperties). While the set is incomplete, the header "<br>Only
// when full set is present:" (cliloc 1072378) comes LAST, and every line after it is the set's bonus.
// While the whole set is worn, "Full Armor Set Present" (1072377) or "Full Weapon/Armor Set Present"
// (1073492) comes near the TOP, followed by the set's "(total)" lines, which sum every piece, and
// then the piece's own lines. So after that header only "(total)" lines (and the bard set's cooldown
// line) belong to the set, and the first other line ends the block.
const SET_INCOMPLETE_RE = /^only when full set is present\b/;
const SET_WORN_RE = /^full (weapon\/)?armor set present\b/;
const SET_TOTAL_LINE_RE = /\(total\)$|^mastery bonus cooldown\b/;
// A power scroll names its level: "An Exalted Scroll Of Mysticism (110 Skill)" (UO Alive, from real scans).
// Only a scroll's name counts, so no other item with a number in brackets gains a property.
const PS_LEVEL_RE = /\bscroll\b.*\((\d{3}) skill\)/i;
// A Scroll of Transcendence names its skill and points on a tooltip line (issue #181): "Skill: Animal Lore 0.1 Skill
// Points" (UO Alive, from real scans) or the older "Spirit Speak 0.5 Skill".
const SOT_NAME_RE = /\bscroll of transcendence\b/i;
const SOT_LINE_RE = /^(?:skill:\s*)?(.+?)\s+(\d+(?:\.\d+)?)\s+skill(?: points?)?\.?$/i;

// Returns { name, props, setBonus, tags, strReq, rarity, artifactRarity, extras, flags, lines }.
//   props    : modeled numeric properties (optimizer keys) of the piece itself
//   setBonus : modeled properties in an incomplete set's bonus block, which apply only while every
//              piece of the set is worn; kept apart so a piece is never credited with them on its own
//   extras   : every other numeric line as { "swordsmanship": 10, "durability": [57, 57] ... }
//   flags    : non-numeric lines (lowercased), e.g. "spell channeling", "mage armor", "orc slayer";
//              a set-block line no pattern models, and every "(total)" line of a worn full set,
//              is kept as "set: <line>"
// A stack's name line starts with its amount ("2 Greater Heal"); that number is stripped only when it
// equals `amount`, so a name that really starts with a number ("10 Potions" on one item) keeps it.
// A word of seven or more digits is dropped first: it is a cliloc number the client could not turn into text (issue
// #129: a hat's name line read "21025908 Of Wizardry", 1025908 being the item-name cliloc of its graphic 0x1714), and
// never a stack's amount, which is at most 65,535.
const UNRESOLVED_CLILOC = /(^|\s)\d{7,}(?=\s|$)/g;
export function stackName(line: string | undefined, amount?: number | undefined): string {
  return stripHtml(line).replace(UNRESOLVED_CLILOC, "").trim().replace(/^(\d+)\s+(?=\S)/, (all, n: string) => (+n === amount ? "" : all));
}
export function parseTooltip(rawLines?: Array<string | undefined> | undefined, amount?: number | undefined): ParsedTooltip {
  const TU = tagUnits(), rarityLine = rarityRe();
  const lines = (rawLines || []).map(stripHtml).filter(Boolean);
  const name = stackName(lines[0], amount);
  const props: PropMap = {}, setBonus: PropMap = {}, extras: ExtrasMap = {}, flags: string[] = [], tags: string[] = [];
  let strReq = 0, rarity: string | null = null, twoHanded: boolean | null = null, weight: number | null = null, skillReq: string | null = null, sotSkill: string | null = null;
  let inSet = false, inSetTotals = false;
  for (const raw of lines.slice(1)) {
    const line = raw.toLowerCase();
    if (SET_INCOMPLETE_RE.test(line)) { inSet = true; continue; }
    if (SET_WORN_RE.test(line)) { inSetTotals = true; continue; }
    if (inSetTotals) {
      if (SET_TOTAL_LINE_RE.test(line)) { flags.push("set: " + line); continue; }
      inSetTotals = false;
    }
    if (inSet) {
      const hit = PROP_PATTERNS.find(([, pat]) => pat.test(line));
      if (hit) setBonus[hit[0]] = (setBonus[hit[0]] || 0) + +line.match(hit[1])![1]!;
      else flags.push("set: " + line);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TU, line)) { tags.push(line); continue; }
    if (rarityLine.test(raw)) { rarity = raw; continue; }
    let m;
    if ((m = line.match(/strength requirement\D*(\d+)/))) { strReq = +m[1]!; continue; }
    if ((m = line.match(/^weight\D*(\d+)/))) { weight = +m[1]!; continue; }
    if (/^two-handed weapon/.test(line)) { twoHanded = true; continue; }
    if (/^one-handed weapon/.test(line)) { twoHanded = false; continue; }
    if ((m = line.match(/^skill required\W*(.+)$/))) { skillReq = m[1]!.trim(); continue; }
    if ((m = line.match(/^durability\D*(\d+)\D+(\d+)/))) { extras.durability = [+m[1]!, +m[2]!]; continue; }
    if (/^(crafted by|engraved)\b/.test(line)) { flags.push(line); continue; }   // free text: "Engraved: Bag 2" is not a number
    let matched = false;
    for (const [key, pat] of PROP_PATTERNS) {
      const mm = line.match(pat);
      if (mm) { props[key] = (props[key] || 0) + +mm[1]!; matched = true; break; }
    }
    if (matched) continue;
    const num = line.match(NUMERIC_TAIL_RE);
    const head = num ? line.slice(0, num.index).replace(/[\s:+]*$/, "") : "";
    if (num && head.trim()) {
      const key = head.trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
      extras[key] = num[3] ? [+num[1]!, +num[3]] : +num[1]!;
    } else {
      flags.push(line);
    }
  }
  const ps = name.match(PS_LEVEL_RE);
  if (ps) props.psLevel = +ps[1]!;
  const sot = sotOf(name, lines);
  if (sot) { sotSkill = sot.skill; props.sotPoints = sot.points; }
  if (tags.length) props.tagPenalty = tags.reduce((a, t) => a + TU[t]!, 0);
  // "Artifact Rarity 11" is read like any other numeric line (extras["artifact rarity"], the Property filter's Artifact Rarity).
  const ar = extras["artifact rarity"], artifactRarity = typeof ar === "number" ? ar : null;
  if (artifactRarity != null || namedArtifact(name)) rarity = NAMED_ARTIFACT;
  return { name, props, setBonus, tags, strReq, rarity, artifactRarity, extras, flags, twoHanded, weight, skillReq, sotSkill, lines };
}

// The app's name order: A to Z, numbers by value, so "(Animal Lore - 2.0 Pts)" comes before "(Animal Lore - 10.0 Pts)" (issue #181).
export const compareNames = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
// A Scroll of Transcendence's skill and points from its name and (stripped) tooltip lines; null for anything else.
function sotOf(name: string, lines: string[]): { skill: string; points: number } | null {
  const m = SOT_NAME_RE.test(name) ? lines.slice(1).map((l) => l.match(SOT_LINE_RE)).find(Boolean) : null;
  return m ? { skill: m[1]!, points: +m[2]! } : null;
}
// displayName straight from a tooltip, without parseTooltip's property parse and so without the shard's rules
// (app/missing.mts names every item that left a container this way).
export function shownName(rawLines: Array<string | undefined>, amount?: number | undefined): string {
  const lines = rawLines.map(stripHtml).filter(Boolean);
  const name = stackName(lines[0], amount), sot = sotOf(name, lines);
  return displayName({ name, sotSkill: sot?.skill ?? null, props: sot ? { sotPoints: sot.points } : {} });
}
// An item's name in game: its tooltip's first line, a stack's count stripped; the shown name when it has no tooltip.
export function gameName(it: { name: string; lines?: string[] | undefined; amount?: number | undefined }): string {
  return stackName(it.lines?.[0], it.amount) || it.name;
}
// The name the app shows for an item: its in-game name, except a Scroll of Transcendence, which says its skill and
// points (issue #181: dozens of rows read "Scroll Of Transcendence" otherwise). The in-game name stays lines[0].
export function displayName(parsed: Pick<ParsedTooltip, "name" | "props" | "sotSkill">): string {
  return parsed.sotSkill ? `Scroll of Transcendence (${parsed.sotSkill} - ${parsed.props.sotPoints!.toFixed(1)} Pts)` : parsed.name;
}
