// organize-strategies.mts — Organize's Auto mode (issue #11, spec §5): the Simple and Detailed strategies (which
// items form a group, each group written as ordinary rule filters, mostly the presets), assignGroups (which of the
// ticked chests each group gets) and proposeOrganize (the whole setup Accept saves). Pure and deterministic: every
// walk runs in serial or table order. POST /api/organize/propose hands everything in; the page saves the
// proposal's config with the ordinary PUT /api/organize.
import { emptyRuleQuery, LIMITS, type RuleMatch } from "./organize-config.mts";
import { PRESETS } from "./organize-presets.mts";
import { ruleMatches } from "./organize.mts";
import type { RuleQuery } from "./item-query.mts";
import type { Item } from "./vault-lib.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";

export type StrategyId = "simple" | "detailed";
export const STRATEGY_IDS: readonly StrategyId[] = ["simple", "detailed"];
export type Family = "armour" | "jewelry" | "weapons" | "other-gear" | "reagents" | "scrolls" | "resources" | "potions" | "runes-books" | "deeds" | "gems" | "tools" | "clothing" | "other";
// One group of a strategy: the name its chests are labelled with and its rules carry, and the filters that make it
// (an item is in the group when any passes). Each filter becomes one rule, in this order, all filling the group's
// chests: Armour needs two, since one filter cannot say "these slots, or the neck slot named gorget".
export interface GroupDef { key: string; name: string; family: Family; matches: RuleMatch[] }
export interface Group extends GroupDef { items: Item[] }

const q = (over: Partial<RuleQuery>): RuleQuery => ({ ...emptyRuleQuery(), ...over });
const kinds = (...kind: string[]): RuleMatch => ({ query: q({ kind }) });
const gear = (slot: string[], names?: string[]): RuleMatch => ({ query: q({ kind: ["gear"], slot }), ...(names ? { names } : {}) });
const preset = (id: string): RuleMatch => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`organize-strategies: no preset "${id}"`);
  return structuredClone(p.match);
};
const def = (key: string, name: string, family: Family, ...matches: RuleMatch[]): GroupDef => ({ key, name, family, matches });
// Every item: the last group, so a group table claims everything its rules will.
const EVERYTHING: RuleMatch = { query: q({}) };

// Order matters only where filters overlap, and there it is first match wins, as for rules: gear is split by slot
// (every gear item has kind "gear", so no name pattern reaches it), the armour neck filter sits above Jewelry's neck
// slot, Shields and Spellbooks above Weapons (both are held), power scrolls above the other scrolls, and each school
// of reagents and each resource type above the rest of its kind. Shields and spellbooks are Weapons in Simple.
const SIMPLE: readonly GroupDef[] = [
  def("armour", "Armour", "armour", gear(["helmet", "chest", "arms", "hands", "legs"]), preset("armour-neck")),
  def("jewelry", "Jewelry", "jewelry", gear(["ring", "bracelet", "neck", "earrings", "talisman"])),
  def("weapons", "Weapons", "weapons", preset("weapons")),
  def("other-gear", "Other gear", "other-gear", kinds("gear")),
  def("reagents", "Reagents", "reagents", kinds("reagent")),
  def("scrolls", "Scrolls", "scrolls", kinds("scroll")),
  def("resources", "Resources", "resources", kinds("resource")),
  def("potions", "Potions & bandages", "potions", kinds("potion", "bandage")),
  def("runes-books", "Runes & books", "runes-books", kinds("rune", "book")),
  def("deeds", "Deeds", "deeds", preset("deeds")),
  def("gems", "Gems", "gems", preset("gems")),
  def("tools", "Tools", "tools", kinds("tool")),
  def("clothing", "Clothing", "clothing", kinds("clothing")),
  def("other", "Other", "other", EVERYTHING),
];
// Spell scrolls stay one group: a scroll's school cannot be told by a name substring (Magery's "curse" is inside
// Remove Curse and Curse Weapon, "heal" inside Healing Stone and a Scroll of Alacrity: Healing).
const DETAILED: readonly GroupDef[] = [
  def("armour-head", "Armour: head", "armour", preset("armour-head")),
  def("armour-neck", "Armour: neck", "armour", preset("armour-neck")),
  def("armour-chest", "Armour: chest", "armour", preset("armour-chest")),
  def("armour-arms", "Armour: arms", "armour", preset("armour-arms")),
  def("armour-hands", "Armour: hands", "armour", preset("armour-hands")),
  def("armour-legs", "Armour: legs", "armour", preset("armour-legs")),
  def("rings", "Rings", "jewelry", preset("rings")),
  def("bracelets", "Bracelets", "jewelry", preset("bracelets")),
  def("necklaces", "Necklaces", "jewelry", preset("necklaces")),
  def("earrings", "Earrings", "jewelry", preset("earrings")),
  def("talismans", "Talismans", "jewelry", preset("talismans")),
  def("shields", "Shields", "weapons", preset("shields")),
  def("spellbooks", "Spellbooks", "weapons", gear(["oneHanded"], ["spellbook", "book of", "tome"])),
  def("weapons", "Weapons", "weapons", preset("weapons")),
  def("other-gear", "Other gear", "other-gear", kinds("gear")),
  def("magery-reagents", "Magery reagents", "reagents", preset("magery-reagents")),
  def("necromancy-reagents", "Necromancy reagents", "reagents", preset("necromancy-reagents")),
  def("mysticism-reagents", "Mysticism reagents", "reagents", preset("mysticism-reagents")),
  def("reagents", "Other reagents", "reagents", kinds("reagent")),
  ...[105, 110, 115, 120].map((n) => def(`power-scrolls-${n}`, `Power scrolls ${n}`, "scrolls", preset(`power-scrolls-${n}`))),
  def("scrolls", "Other scrolls", "scrolls", preset("spell-scrolls")),
  def("ingots", "Ingots", "resources", preset("ingots")),
  def("boards", "Boards", "resources", preset("boards")),
  def("leather", "Leather", "resources", preset("leather")),
  def("cloth", "Cloth", "resources", preset("cloth")),
  def("resources", "Other resources", "resources", kinds("resource")),
  def("potions", "Potions", "potions", preset("potions")),
  def("bandages", "Bandages", "potions", preset("bandages")),
  def("runes", "Runes and runebooks", "runes-books", preset("runes")),
  def("books", "Books", "runes-books", kinds("book")),
  def("deeds", "Deeds", "deeds", preset("deeds")),
  def("gems", "Gems", "gems", preset("gems")),
  def("tools", "Tools", "tools", kinds("tool")),
  def("clothing", "Clothing", "clothing", kinds("clothing")),
  def("other", "Other", "other", EVERYTHING),
];
export const STRATEGIES: Record<StrategyId, readonly GroupDef[]> = { simple: SIMPLE, detailed: DETAILED };

// Each item to the first group whose filters take it, in the table's order (the order its rules get, so the group
// an item lands in is the rule that will claim it). Groups nobody lands in are left out, and so are the `skip`
// keys (Other, when the player's own catch-all takes what no rule does).
export function groupItems(defs: readonly GroupDef[], items: readonly Item[], rarity: RulesV1RarityItem[] = [], skip: ReadonlySet<string> = new Set()): Group[] {
  const live = defs.filter((d) => !skip.has(d.key));
  const by = new Map<string, Item[]>(live.map((d) => [d.key, []]));
  for (const it of [...items].sort((a, b) => a.serial - b.serial)) {
    const d = live.find((g) => g.matches.some((m) => ruleMatches(it, m, rarity)));
    if (d) by.get(d.key)!.push(it);
  }
  return live.filter((d) => by.get(d.key)!.length).map((d) => ({ ...d, items: by.get(d.key)! }));
}

// Spec §5 assignment. `need` = the group's items at its home site (one slot each), `room` = how many group items a
// chest takes, `held` = how many of each group's items it holds now.
export interface GroupNeed { key: string; site: number; need: number }
export interface Offer { serial: number; site: number; room: number; held: Record<string, number> }
// Largest group first (ties by key). Each takes, from the chests at its site nobody has taken, the one already
// holding most of it (ties: more room, then the lower serial), then the next best until it fits, at most LIMITS.targets.
// Then every other chest there holding this group's items and no other group's joins the chain: once a house is
// sorted, a chain whose first chest is full could otherwise read [second] alone next time and move the first's
// items, so re-running on its own result would not move nothing. A group that finds no chest gets an empty chain.
export function assignGroups(groups: readonly GroupNeed[], offers: readonly Offer[]): Map<string, number[]> {
  const taken = new Set<number>();
  const out = new Map<string, number[]>();
  const order = [...groups].sort((a, b) => b.need - a.need || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const g of order) {
    const held = (o: Offer): number => o.held[g.key] ?? 0;
    const ranked = offers.filter((o) => o.site === g.site && o.room > 0 && !taken.has(o.serial))
      .sort((a, b) => held(b) - held(a) || b.room - a.room || a.serial - b.serial);
    const chain: number[] = [];
    let cover = 0;
    for (const o of ranked) {
      if (cover >= g.need || chain.length >= LIMITS.targets) break;
      chain.push(o.serial);
      cover += o.room;
    }
    for (const o of ranked) {
      if (chain.length >= LIMITS.targets) break;
      if (chain.includes(o.serial) || !held(o) || Object.entries(o.held).some(([k, n]) => k !== g.key && n > 0)) continue;
      chain.push(o.serial);
    }
    for (const s of chain) taken.add(s);
    out.set(g.key, chain);
  }
  return out;
}
