// organize-strategies.mts — Organize's Auto mode (issue #11, spec §5): the Simple, Detailed and By build (#91)
// strategies (which items form a group, each group written as ordinary rule filters, mostly the presets), assignGroups
// (which of the ticked chests each group gets) and proposeOrganize (the whole setup Accept saves). Pure and
// deterministic (node:util only for a deep compare): every walk runs in serial or table order. POST
// /api/organize/propose hands everything in; the page saves the proposal's config with the ordinary PUT /api/organize.
import { isDeepStrictEqual } from "node:util";
import { checkOrganizeConfig, emptyRuleQuery, LIMITS, type Build, type ContainerLabel, type OrganizeConfig, type OrganizeRule, type Origin, type RuleMatch } from "./organize-config.mts";
import { PRESETS } from "./organize-presets.mts";
import { ancestry, applyOverlay, claimOf, emptyBagsOf, planOrganize, posOk, ruleMatches, scopeOf, sitesOf, SPELLBOOK_NAMES, type OverlayMove, type ScopeOptions } from "./organize.mts";
import { bagLabel, TRASH_RE, type Container, type ContainerCapacity, type Inventory, type Item } from "./vault-lib.mts";
import type { RuleQuery } from "./item-query.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";

export type StrategyId = "simple" | "detailed" | "build";
export const STRATEGY_IDS: readonly StrategyId[] = ["simple", "detailed", "build"];
export type Family = "armour" | "jewelry" | "weapons" | "other-gear" | "gear" | "reagents" | "scrolls" | "maps" | "resources" | "potions" | "runes-books" | "deeds" | "gems" | "tools" | "clothing" | "other";
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
// A spell scroll is named after its spell alone, and every other scroll (vault-lib's kindOf; a blank scroll is a
// resource) has "scroll" in its name: power, stat, Transcendence and Alacrity scrolls, Scroll Binders (issue #134).
const SKILL_SCROLLS: RuleMatch = { query: q({ kind: ["scroll"] }), names: ["scroll"] };

// Order matters only where filters overlap, and there it is first match wins, as for rules: gear is split by slot
// (every gear item has kind "gear", so no name pattern reaches it), the armour neck filter sits above Jewelry's neck
// slot, Shields and Spellbooks above Weapons (both are held), power scrolls above the other scrolls, and each school
// of reagents and each resource type above the rest of its kind. Shields and spellbooks are Weapons in Simple; in
// Detailed a spellbook is in the books' family, so when chests run short it shares theirs, not the Weapons chest.
// Simple's Resources takes refinements by a second filter (issue #129), as Detailed's Refinements does, so its first
// rule keeps the id an earlier proposal gave it; instruments are tools (vault-lib's kindOf), so Tools needs none.
const SIMPLE: readonly GroupDef[] = [
  def("armour", "Armour", "armour", gear(["helmet", "chest", "arms", "hands", "legs"]), preset("armour-neck")),
  def("jewelry", "Jewelry", "jewelry", gear(["ring", "bracelet", "neck", "earrings", "talisman"])),
  def("weapons", "Weapons", "weapons", preset("weapons")),
  def("other-gear", "Other gear", "other-gear", kinds("gear")),
  def("reagents", "Reagents", "reagents", kinds("reagent")),
  def("skill-scrolls", "Skill scrolls", "scrolls", SKILL_SCROLLS),
  def("scrolls", "Spell scrolls", "scrolls", preset("spell-scrolls")),
  def("resources", "Resources", "resources", kinds("resource"), preset("refinements")),
  def("potions", "Potions & bandages", "potions", kinds("potion", "bandage")),
  def("runes-books", "Runes & books", "runes-books", kinds("rune", "book")),
  def("deeds", "Deeds", "deeds", preset("deeds")),
  def("gems", "Gems", "gems", preset("gems")),
  def("treasure-maps", "Treasure maps & SOS", "maps", preset("treasure-maps")),
  def("tools", "Tools", "tools", kinds("tool")),
  def("clothing", "Clothing", "clothing", kinds("clothing")),
  def("other", "Other", "other", EVERYTHING),
];
// Other scrolls (stat and Alacrity scrolls, Scroll Binders) takes the skill scrolls the power scroll and Transcendence
// groups leave, by name, above the spells. Those go by school (issue #134: the rule's `school`, an exact spell name, since a name substring cannot tell them:
// Magery's "curse" is inside Remove Curse and Curse Weapon), and Spell scrolls keeps any of no known school.
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
  def("spellbooks", "Spellbooks", "runes-books", gear(["oneHanded"], [...SPELLBOOK_NAMES])),
  def("weapons", "Weapons", "weapons", preset("weapons")),
  def("ammo", "Ammo", "weapons", preset("ammo")),
  def("other-gear", "Other gear", "other-gear", kinds("gear")),
  def("magery-reagents", "Magery reagents", "reagents", preset("magery-reagents")),
  def("necromancy-reagents", "Necromancy reagents", "reagents", preset("necromancy-reagents")),
  def("mysticism-reagents", "Mysticism reagents", "reagents", preset("mysticism-reagents")),
  def("reagents", "Other reagents", "reagents", kinds("reagent")),
  ...[105, 110, 115, 120].map((n) => def(`power-scrolls-${n}`, `Power scrolls ${n}`, "scrolls", preset(`power-scrolls-${n}`))),
  def("transcendence-scrolls", "Transcendence scrolls", "scrolls", preset("transcendence-scrolls")),
  def("other-scrolls", "Other scrolls", "scrolls", SKILL_SCROLLS),
  def("magery-scrolls", "Magery scrolls", "scrolls", preset("magery-scrolls")),
  def("necromancy-scrolls", "Necromancy scrolls", "scrolls", preset("necromancy-scrolls")),
  def("mysticism-scrolls", "Mysticism scrolls", "scrolls", preset("mysticism-scrolls")),
  def("spellweaving-scrolls", "Spellweaving scrolls", "scrolls", preset("spellweaving-scrolls")),
  def("scrolls", "Spell scrolls", "scrolls", preset("spell-scrolls")),
  def("ingots", "Ingots", "resources", preset("ingots")),
  def("boards", "Boards", "resources", preset("boards")),
  def("leather", "Leather", "resources", preset("leather")),
  def("cloth", "Cloth", "resources", preset("cloth")),
  def("resources", "Other resources", "resources", kinds("resource")),
  def("refinements", "Refinements", "resources", preset("refinements")),
  def("potions", "Potions", "potions", preset("potions")),
  def("bandages", "Bandages", "potions", preset("bandages")),
  def("runes", "Runes and runebooks", "runes-books", preset("runes")),
  def("books", "Books", "runes-books", kinds("book")),
  def("deeds", "Deeds", "deeds", preset("deeds")),
  def("gems", "Gems", "gems", preset("gems")),
  def("treasure-maps", "Treasure maps & SOS", "maps", preset("treasure-maps")),
  def("instruments", "Instruments", "tools", preset("instruments")),
  def("tools", "Tools", "tools", kinds("tool")),
  def("clothing", "Clothing", "clothing", kinds("clothing")),
  def("other", "Other", "other", EVERYTHING),
];
// Issue #91: gear (jewelry and talismans too) by the build its properties serve (organize.mts's buildOf, which each
// rule's `build` asks), then everything else as Simple groups it.
const build = (b: Build): RuleMatch => ({ query: q({ kind: ["gear"] }), build: b });
const BY_BUILD: readonly GroupDef[] = [
  def("caster-gear", "Caster gear", "gear", build("caster")),
  def("melee-gear", "Melee gear", "gear", build("melee")),
  def("hybrid-gear", "Hybrid gear", "gear", build("hybrid")),
  def("tank-gear", "Tank gear", "gear", build("tank")),
  def("plain-gear", "Other gear", "gear", build("other")),
  ...SIMPLE.filter((d) => !["armour", "jewelry", "weapons", "other-gear"].includes(d.family)),
];
export const STRATEGIES: Record<StrategyId, readonly GroupDef[]> = { simple: SIMPLE, detailed: DETAILED, build: BY_BUILD };
// The id a group's i-th filter's rule gets (proposeOrganize adds _2, _3… when a manual rule already has it), and
// back from an id to its group, for either strategy (a key both have means the same things).
const ruleIdOf = (key: string, i: number): string => `auto-${key}${i ? `-${i + 1}` : ""}`;
const RULE_GROUP = new Map(Object.values(STRATEGIES).flatMap((defs) => defs.flatMap((d) => d.matches.map((_, i) => [ruleIdOf(d.key, i), d.key] as const))));

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

// Spec §5 assignment. `need` = the group's items at its home site (one slot each), `family` = the groups that may
// share a chest (its own key when left out), `room` = how many group items a chest takes, `held` = how many of each
// group's items it holds now, `prev` = the chests an earlier strategy rule of this group fills, in fill order.
export interface GroupNeed { key: string; family?: string | undefined; site: number; need: number; prev?: readonly number[] | undefined }
export interface Offer { serial: number; site: number; room: number; held: Record<string, number> }
// Each group's chain of chests, and the room it is given there (all of a chest of its own, its own items' worth of a
// shared one).
export interface Assignment { chains: Map<string, number[]>; room: Map<string, number> }
const byNeed = (a: GroupNeed, b: GroupNeed): number => b.need - a.need || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
// Two passes, largest group first (ties by key), each site on its own.
// Whole chests: a group takes whole chests only while every family still to come keeps one free chest (the families
// of the groups after it, and of the groups already sent to share). It keeps, first, the chests its earlier rule
// filled that are still offered and nobody has taken: counts alone would not hold a sorted house still, since after
// its trips two chests can hold a group equally and the tie would go the other way. Then, until it fits, the chest
// already holding most of it (ties: more room, then the lower serial), then the next best, at most LIMITS.targets.
// Then every other chest there holding this group's items and no other group's joins the chain: a chain whose first
// chest is full could otherwise read [second] alone next time and move the first's items. A group that cannot take a
// whole chest shares.
// Shared chests (issue #123), first fit decreasing within a family: a sharer goes into the first chest its family
// opened that still has room for all of it, else opens the next free chest (its earlier rule's chests first, then the
// one holding most of its family's items, then more room, then the lower serial), more until it fits, leaving one
// free chest for each family still to open one (it always gets one while any is free). A sharer that finds no free
// chest then takes what room its family's chests have left (the most first), and one whose family has none left gets
// an empty chain. Nothing here depends on the order the groups or chests come in.
export function assignGroups(groups: readonly GroupNeed[], offers: readonly Offer[]): Assignment {
  const taken = new Set<number>();
  const chains = new Map<string, number[]>();
  const room = new Map<string, number>();
  const familyOf = (g: GroupNeed): string => g.family ?? g.key;
  const free = (site: number): Offer[] => offers.filter((o) => o.site === site && o.room > 0 && !taken.has(o.serial));
  const order = [...groups].sort(byNeed);
  const sharers: GroupNeed[] = [];
  order.forEach((g, i) => {
    const reserve = new Set([...sharers, ...order.slice(i + 1)].filter((h) => h.site === g.site).map(familyOf)).size;
    const held = (o: Offer): number => o.held[g.key] ?? 0;
    const ranked = free(g.site).sort((a, b) => held(b) - held(a) || b.room - a.room || a.serial - b.serial);
    const most = Math.min(LIMITS.targets, ranked.length - reserve);
    if (most < 1) { sharers.push(g); return; }
    const chain: number[] = [];
    let cover = 0;
    const kept = (g.prev ?? []).flatMap((s) => ranked.filter((o) => o.serial === s));
    for (const o of [...kept, ...ranked.filter((o) => !kept.includes(o))]) {
      if (chain.length >= most || (cover >= g.need && !kept.includes(o))) break;
      chain.push(o.serial);
      cover += o.room;
    }
    for (const o of ranked) {
      if (chain.length >= most) break;
      if (chain.includes(o.serial) || !held(o) || Object.entries(o.held).some(([k, n]) => k !== g.key && n > 0)) continue;
      chain.push(o.serial);
      cover += o.room;
    }
    for (const s of chain) taken.add(s);
    chains.set(g.key, chain);
    room.set(g.key, cover);
  });
  const open = new Map<string, { serial: number; left: number }[]>();   // by site and family, in opening order
  sharers.forEach((g, i) => {
    const fam = familyOf(g), at = `${g.site}\u0000${fam}`;
    const mine = open.get(at) ?? [];
    const fit = mine.find((c) => c.left >= g.need);
    if (fit) {
      fit.left -= g.need;
      chains.set(g.key, [fit.serial]);
      room.set(g.key, g.need);
      return;
    }
    const keys = new Set(groups.filter((h) => familyOf(h) === fam).map((h) => h.key));
    const famHeld = (o: Offer): number => Object.entries(o.held).reduce((n, [k, v]) => n + (keys.has(k) ? v : 0), 0);
    const prev = g.prev ?? [];
    const rank = (o: Offer): number => { const p = prev.indexOf(o.serial); return p < 0 ? prev.length : p; };
    const ranked = free(g.site).sort((a, b) => rank(a) - rank(b) || famHeld(b) - famHeld(a) || b.room - a.room || a.serial - b.serial);
    const waiting = new Set(sharers.slice(i + 1).filter((h) => h.site === g.site && familyOf(h) !== fam && !open.has(`${h.site}\u0000${familyOf(h)}`)).map(familyOf)).size;
    const most = Math.min(LIMITS.targets, Math.max(1, ranked.length - waiting));
    const chain: number[] = [];
    let cover = 0;
    for (const o of ranked) {
      if (chain.length >= most || cover >= g.need) break;
      chain.push(o.serial);
      taken.add(o.serial);
      cover += o.room;
      mine.push({ serial: o.serial, left: 0 });
    }
    if (chain.length) {
      mine[mine.length - 1]!.left = Math.max(0, cover - g.need);
      open.set(at, mine);
    }
    chains.set(g.key, chain);
    room.set(g.key, Math.min(g.need, cover));
  });
  for (const g of sharers) {
    if (chains.get(g.key)!.length) continue;
    const c = (open.get(`${g.site}\u0000${familyOf(g)}`) ?? []).filter((c) => c.left > 0).sort((a, b) => b.left - a.left)[0];
    if (!c) continue;
    const n = Math.min(g.need, c.left);
    c.left -= n;
    chains.set(g.key, [c.serial]);
    room.set(g.key, n);
  }
  return { chains, room };
}

// A house chest holds 125 items (ServUO's default): how the proposal turns missing slots into chests to add.
export const CONTAINER_SLOTS = 125;
// Issue #132, the layout a strategy wants: every chest filled to at most FILL of its item cap, so loot has room, and
// every group that shares a chest in a bag of its own there (one of the chest's slots). A chest still to add is
// counted as an empty house chest's FILL.
const FILL = 0.8;
const NEW_CHEST_ROOM = Math.floor(FILL * CONTAINER_SLOTS);
// Stand-ins for the chests still to add, above every real serial (a serial is 31 bits), so a tie goes to a real one.
const NEW_CHEST = 2 ** 31;
// What a chest shared by a family's groups is labelled.
const FAMILY_NAMES: Record<Family, string> = { armour: "Armour", jewelry: "Jewelry", weapons: "Weapons", "other-gear": "Other gear", gear: "Gear", reagents: "Reagents",
  scrolls: "Scrolls", maps: "Treasure maps & SOS", resources: "Resources", potions: "Potions & bandages", "runes-books": "Runes & books", deeds: "Deeds", gems: "Gems",
  tools: "Tools", clothing: "Clothing", other: "Other" };
// The chests two or more groups share, each with their keys in the order the groups come (table order).
function sharedChests(groups: readonly { key: string }[], chains: ReadonlyMap<string, number[]>): Map<number, string[]> {
  const by = new Map<number, string[]>();
  for (const g of groups) for (const s of chains.get(g.key) ?? []) by.set(s, [...by.get(s) ?? [], g.key]);
  return new Map([...by].filter(([, keys]) => keys.length > 1));
}

// A ground chest Auto organize may use: its name as the player knows it (its label, else its engraving or name),
// its house (site), its fill, its label, and whether the player's own setup uses it (a manual label, or a target
// of a manual rule or of the catch-all), which leaves it unticked by default unless an earlier strategy rule fills
// it (the player ticked it last time, and unticking it now would move its items out on a re-run).
export interface Candidate { serial: number; name: string; site: number; fill: { items: number; max: number }; label: { name: string; origin: Origin } | null; mine: boolean; ticked: boolean }
export interface Unusable { serial: number; name: string; reason: string }
// One group of the proposal. needSlots = its items at its home site (one slot each: merges are the plan's to find),
// roomSlots = what its chests take, crossSite = its items at other houses (never moved). A group sharing a chest
// fills its own bag there (targets = [the bag], bagIn = the chest), or, with no bag left for it, the chest itself
// among the other groups' bags (needsBag).
export interface GroupReport { key: string; name: string; family: Family; ruleIds: string[]; items: number; needSlots: number; targets: number[]; bagIn: number | null; needsBag: boolean; roomSlots: number; shortfall: number; addContainers: number; crossSite: number }
// What the full layout (FILL, a bag for each group sharing a chest) needs beyond what the player has: `chests` more
// house chests, and bags: for each shared chest (null: one of the chests to add, by its family's name) how many more
// bags it needs. `spareBags`: empty bags already in the ticked chests that no group was given, to move in first.
// `roomy`: the proposal fills to FILL where filling to the top would have given other chests.
export interface BagGap { chest: number | null; family: string; bags: number }
export interface Layout { chests: number; bags: BagGap[]; spareBags: number; roomy: boolean }
export interface Proposal {
  strategy: StrategyId;
  candidates: Candidate[];
  unusable: Unusable[];
  containers: number[];                         // the ticked chests it used, ascending
  refused: { serial: number; reason: string }[];   // asked for, but not usable
  groups: GroupReport[];                        // in rule order
  unassigned: number;                           // groups that got no chest
  layout: Layout;
  manualRules: number;
  config: OrganizeConfig;                       // the whole setup Accept saves (PUT /api/organize)
  changed: boolean;                             // false when config is the current setup
  plan: { moves: number; trips: number; noRoom: number; crossSite: number; unclaimed: number };   // planOrganize on config
}
export interface ProposeOptions extends ScopeOptions { strategy: StrategyId; containers?: readonly number[] | undefined; rarity?: RulesV1RarityItem[] | undefined }
export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; error: string };

const bySerial = (a: number, b: number): number => a - b;
const plainName = (c: Container): string => ((c.label || bagLabel(c)) || `0x${(+c.serial).toString(16)}`).slice(0, 64);

// Every ground root a character of the player's scanned (never a `_vault` tombstone's, never a trash container),
// usable or with the reason it is not. Usable = what a rule target needs (scopeOf): not blacklisted or pinned,
// opened by its newest scan, with a position and a Contents line.
function candidatesOf(inv: Inventory, cfg: OrganizeConfig, counts: Map<number, ContainerCapacity>, black: Set<number>, mine: Set<number>, filled: Set<number>): { candidates: Candidate[]; unusable: Unusable[] } {
  const roots = Object.values(inv.containers).filter((c) => c.parent == null && c.kind === "ground" && !String(c.scannedBy).startsWith("_") && !TRASH_RE.test(c.name ?? ""))
    .sort((a, b) => a.serial - b.serial);
  const usable: { serial: number; name: string; cap: ContainerCapacity; l: ContainerLabel | undefined }[] = [];
  const unusable: Unusable[] = [];
  for (const c of roots) {
    const serial = +c.serial, l = cfg.labels[String(serial)], cap = counts.get(serial);
    const name = l?.name ?? plainName(c);
    const reason = black.has(serial) ? "blacklisted" : l?.pinned ? "pinned" : c.opened === false ? "the last scan could not open it"
      : !posOk(c.pos) ? "its scan has no position" : !cap ? "its fill is unknown: reinstall the scripts and rescan" : null;
    if (reason) unusable.push({ serial, name, reason }); else usable.push({ serial, name, cap: cap!, l });
  }
  const siteOf = new Map(sitesOf(inv, usable.map((u) => u.serial)).flatMap((g, i) => g.map((s) => [s, i] as const)));
  const candidates = usable.map(({ serial, name, cap, l }) => {
    const own = l?.origin === "manual" || mine.has(serial);
    return { serial, name, site: siteOf.get(serial)!, fill: { items: cap.items, max: cap.maxItems }, label: l ? { name: l.name, origin: l.origin } : null, mine: own, ticked: !own || filled.has(serial) };
  });
  return { candidates, unusable };
}

// Spec §5: the setup a strategy proposes over the ticked chests (`containers`, else every candidate ticked by
// default), as the whole next organize.json. Manual rules come first and keep what they claim; manual labels are
// never renamed; every earlier strategy label and rule is replaced, except a strategy label a manual rule or the
// catch-all still fills (dropping it would make the setup unsaveable). The groups are the movable items (scopeOf,
// over the labels the proposal writes, after the overlay) that no manual rule claims; each group's home site is the
// one holding most of it, and its items elsewhere are reported, never assigned. A group with no chest still gets its
// rules, with no targets, so its items are claimed and stay put rather than fall through to Other.
export function proposeOrganize(inv: Inventory, cfg: OrganizeConfig, overlay: OverlayMove[], opts: ProposeOptions): ProposeResult {
  const placed = applyOverlay(inv, overlay);
  const view = placed.inv;
  const rarity = opts.rarity ?? [];
  const black = new Set(opts.blacklist ?? []);
  const origin: Origin = `strategy:${opts.strategy}`;
  const manualRules = cfg.rules.filter((r) => r.origin === "manual");
  const mine = new Set([...manualRules.flatMap((r) => r.targets), ...[cfg.catchAll, cfg.emptyBagsTo].filter((s): s is number => s != null)]);
  const filled = new Set(cfg.rules.filter((r) => r.origin !== "manual").flatMap((r) => r.targets));
  const { candidates, unusable } = candidatesOf(view, cfg, placed.counts, black, mine, filled);
  const offered = new Set(candidates.map((c) => c.serial));
  const refused: { serial: number; reason: string }[] = [];
  const containers: number[] = [];
  if (opts.containers) {
    for (const s of [...new Set(opts.containers)].sort(bySerial)) {
      if (offered.has(s)) containers.push(s);
      else refused.push({ serial: s, reason: unusable.find((u) => u.serial === s)?.reason ?? "it is not a container on the ground in your scans" });
    }
  } else containers.push(...candidates.filter((c) => c.ticked).map((c) => c.serial));

  const labels: Record<string, ContainerLabel> = {};
  for (const l of Object.values(cfg.labels).sort((a, b) => a.serial - b.serial)) {
    if (l.origin === "manual" || mine.has(l.serial)) labels[String(l.serial)] = l;
  }
  for (const s of containers) if (labels[String(s)]?.origin !== "manual") labels[String(s)] = { serial: s, name: plainName(view.containers[s]!), origin };
  const catchAll = cfg.catchAll != null && labels[String(cfg.catchAll)] ? cfg.catchAll : null;
  const draft: OrganizeConfig = { version: 1, labels, rules: manualRules, catchAll: null, pinnedItems: cfg.pinnedItems };
  const scope = scopeOf(view, draft, opts);
  const items = scope.movable.map((s) => view.items[s]!).filter((it) => !claimOf(it, draft, rarity));
  const groups = groupItems(STRATEGIES[opts.strategy], items, rarity, new Set(catchAll != null ? ["other"] : []));

  const siteOfRoot = new Map(sitesOf(view, scope.siteRoots).flatMap((g, i) => g.map((r) => [r, i] as const)));
  const home = new Map(groups.map((g) => {
    const per = new Map<number, number>();
    for (const it of g.items) { const s = siteOfRoot.get(+it.root!)!; per.set(s, (per.get(s) ?? 0) + 1); }
    const [site, need] = [...per].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
    return [g.key, { site, need }] as const;
  }));
  const inGroups = new Map<number, number>();
  const held = new Map<number, Record<string, number>>();
  for (const g of groups) {
    for (const it of g.items) {
      const r = +it.root!;
      inGroups.set(r, (inGroups.get(r) ?? 0) + 1);
      const h = held.get(r) ?? {};
      h[g.key] = (h[g.key] ?? 0) + 1;
      held.set(r, h);
    }
  }
  // A chest's room for its group, filled to `fill` of its cap: that less what stays in it whatever happens (bags,
  // pinned items, items a manual rule claims); every group item in it either leaves or is the group's own.
  const offersAt = (fill: number): Offer[] => containers.filter((s) => scope.usable.has(s) && siteOfRoot.has(s)).map((s) => {
    const cap = placed.counts.get(s)!;
    return { serial: s, site: siteOfRoot.get(s)!, room: Math.max(0, Math.floor(fill * cap.maxItems) - (cap.items - (inGroups.get(s) ?? 0))), held: held.get(s) ?? {} };
  });
  // The containers each group's earlier strategy rule fills, found by the rule ids the strategies write; a bag
  // (issue #132) stands for the chest it sits in.
  const prev = new Map<string, number[]>();
  for (const r of cfg.rules) {
    const key = r.origin !== "manual" ? RULE_GROUP.get(r.id.replace(/_\d+$/, "")) : undefined;
    if (key && !prev.has(key)) prev.set(key, r.targets);
  }
  const needs: GroupNeed[] = groups.map((g) => ({ key: g.key, family: g.family, ...home.get(g.key)!, prev: [...new Set((prev.get(g.key) ?? []).map((t) => ancestry(view, t)?.at(-1) ?? t))] }));
  // Issue #132: at each house, the fewest chests to add for the full layout (each group a slot more for its bag, the
  // chests at FILL; `most` gives every group chests of its own, the most it could want). Where it adds none, that
  // layout is the proposal; elsewhere the chests there are filled to the top, as before.
  const fillAt = offersAt(FILL);
  const ideal = new Map<number, { add: number; a: Assignment }>();
  for (const site of [...new Set(needs.map((n) => n.site))].sort(bySerial)) {
    const ns = needs.filter((n) => n.site === site).map((n) => ({ ...n, need: n.need + 1 }));
    const most = ns.reduce((k, n) => k + Math.ceil(n.need / NEW_CHEST_ROOM), 0);
    for (let add = 0; ; add++) {
      const fresh = Array.from({ length: add }, (_, i): Offer => ({ serial: NEW_CHEST + i, site, room: NEW_CHEST_ROOM, held: {} }));
      const a = assignGroups(ns, [...fillAt.filter((o) => o.site === site), ...fresh]);
      if (add >= most || ns.every((n) => a.room.get(n.key)! >= n.need)) { ideal.set(site, { add, a }); break; }
    }
  }
  // A house its earlier rules already sort, into the same chests, with room at the top of them, stays as it is
  // (no rebalancing moves on a re-run); `roomy` tells the drawer when the FILL layout moves anything elsewhere.
  const toTop = assignGroups(needs, offersAt(1));
  const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((s, i) => s === b[i]);
  const stable = (site: number): boolean => needs.filter((n) => n.site === site).every((n) => n.prev!.length > 0 && same(toTop.chains.get(n.key)!, n.prev!) && toTop.room.get(n.key)! >= n.need);
  const useFill = new Map([...ideal].map(([site, i]) => [site, !i.add && !stable(site)]));
  const layoutOf = (key: string): { a: Assignment; bagSlot: number } => { const site = home.get(key)!.site; return useFill.get(site) ? { a: ideal.get(site)!.a, bagSlot: 1 } : { a: toTop, bagSlot: 0 }; };
  const chains = new Map(groups.map((g) => [g.key, layoutOf(g.key).a.chains.get(g.key)!]));
  const roomy = groups.some((g) => !same(chains.get(g.key)!, toTop.chains.get(g.key)!));
  // Issue #132: each group sharing a chest (and only that one: a group chaining several keeps its chain) gets a bag
  // of its own lying in that chest: the bag its earlier rule fills, else an earlier strategy's bag holding only this
  // group's items, else the next by serial of its empty bags (emptyBagsOf, over the labels this proposal keeps, so an
  // earlier strategy's empty bag is one). An earlier strategy's bag with other items in it goes to no other group,
  // which would move them out. Groups left without one share the chest itself, loose.
  const emptyBags = emptyBagsOf(view, placed.counts, draft, scope.roots, opts.blacklist).filter((b) => placed.counts.has(b.serial));
  const ticked = new Set(containers);
  const byGroup = new Map(groups.flatMap((g) => g.items.map((it) => [+it.serial, g.key] as const)));
  const oldBags = Object.values(cfg.labels).filter((l) => l.origin !== "manual" && !labels[String(l.serial)] && !l.pinned).flatMap((l) => {
    const it = view.items[l.serial];
    return it?.container != null && view.containers[l.serial]?.opened !== false && placed.counts.has(l.serial) && !cfg.pinnedItems.includes(l.serial) && !black.has(l.serial) ? [{ serial: l.serial, container: +it.container }] : [];
  });
  const inBag = (bag: number): number[] => Object.values(view.items).filter((it) => it.container != null && +it.container === bag).map((it) => +it.serial);
  const onlyOf = (bag: number, key: string): boolean => { const kids = inBag(bag); return kids.length > 0 && kids.every((s) => byGroup.get(s) === key); };
  const bagsIn = new Map<number, number[]>();
  for (const b of [...emptyBags, ...oldBags]) bagsIn.set(b.container, [...new Set([...bagsIn.get(b.container) ?? [], b.serial])].sort(bySerial));
  const empty = new Set(emptyBags.map((b) => b.serial));
  const bagOf = new Map<string, number>();
  const needsBag = new Set<string>();
  for (const [chest, all] of sharedChests(groups, chains)) {
    const keys = all.filter((k) => chains.get(k)!.length === 1);
    const free = [...bagsIn.get(chest) ?? []];
    const give = (key: string, bag: number): void => { bagOf.set(key, bag); free.splice(free.indexOf(bag), 1); };
    for (const k of keys) { const b = (prev.get(k) ?? []).find((s) => free.includes(s)); if (b != null) give(k, b); }
    for (const k of keys) { const b = bagOf.has(k) ? undefined : free.find((s) => !empty.has(s) && onlyOf(s, k)); if (b != null) give(k, b); }
    for (const k of keys) if (!bagOf.has(k)) { const b = free.find((s) => empty.has(s)); if (b != null) give(k, b); else needsBag.add(k); }
  }
  // A chest two groups share is labelled with their family's name, any other with its group's, and a group's bag
  // with the group's.
  const sharing = new Map<number, Group[]>();
  for (const g of groups) for (const s of chains.get(g.key)!) sharing.set(s, [...sharing.get(s) ?? [], g]);
  for (const [s, gs] of sharing) if (labels[String(s)]!.origin !== "manual") labels[String(s)] = { serial: s, name: gs.length > 1 ? FAMILY_NAMES[gs[0]!.family] : gs[0]!.name, origin };
  for (const g of groups) { const b = bagOf.get(g.key); if (b != null) labels[String(b)] = { serial: b, name: g.name, origin }; }
  // What the full layout still needs: its chests to add, and the bags its shared chests lack (counting the empty
  // bags there). Spare bags: the empty ones in the ticked chests no group was given.
  const given = new Set(bagOf.values());
  const familyOf = new Map(groups.map((g) => [g.key, FAMILY_NAMES[g.family]]));
  const layout: Layout = { chests: 0, bags: [], spareBags: emptyBags.filter((b) => !given.has(b.serial) && ticked.has(ancestry(view, b.container)?.at(-1) ?? -1)).length, roomy };
  // A house that needs no chest added counts the bags of the layout proposed there (a stable house keeps its own).
  for (const [site, { add, a }] of ideal) {
    layout.chests += add;
    const at = add ? a.chains : chains;
    for (const [chest, all] of sharedChests(groups.filter((g) => home.get(g.key)!.site === site), at)) {
      const keys = all.filter((k) => at.get(k)!.length === 1);
      const real = chest < NEW_CHEST, bags = keys.length - (real ? (bagsIn.get(chest) ?? []).filter((b) => empty.has(b) || given.has(b)).length : 0);
      if (bags > 0) layout.bags.push({ chest: real ? chest : null, family: familyOf.get(keys[0]!)!, bags });
    }
  }

  const used = new Set(manualRules.map((r) => r.id));
  const ruleId = (base: string): string => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return id;
  };
  const autoRules: OrganizeRule[] = [];
  const reports: GroupReport[] = groups.map((g) => {
    const bag = bagOf.get(g.key);
    const targets = bag != null ? [bag] : chains.get(g.key)!;
    const ruleIds = g.matches.map((m, i) => {
      const id = ruleId(ruleIdOf(g.key, i));
      autoRules.push({ id, name: g.name, match: structuredClone(m), targets: [...targets], origin });
      return id;
    });
    const { need } = home.get(g.key)!;
    const { a, bagSlot } = layoutOf(g.key);
    const roomSlots = a.room.get(g.key)! - bagSlot;
    const shortfall = Math.max(0, need - roomSlots);
    return { key: g.key, name: g.name, family: g.family, ruleIds, items: g.items.length, needSlots: need, targets, bagIn: bag != null ? +view.items[bag]!.container! : null, needsBag: needsBag.has(g.key),
      roomSlots, shortfall, addContainers: Math.ceil(shortfall / CONTAINER_SLOTS), crossSite: g.items.length - need };
  });

  // The gather container (issue #128) is the player's own, like the catch-all: its label is kept above, so it stays.
  const config: OrganizeConfig = { version: 1, labels, rules: [...manualRules, ...autoRules], catchAll, ...(cfg.emptyBagsTo !== undefined ? { emptyBagsTo: cfg.emptyBagsTo } : {}), pinnedItems: [...cfg.pinnedItems] };
  const checked = checkOrganizeConfig(config);
  if (!checked.ok) return { ok: false, error: `Auto organize cannot save this setup: ${checked.error}` };
  const plan = planOrganize(inv, config, overlay, opts);
  return { ok: true, proposal: {
    strategy: opts.strategy, candidates, unusable, containers, refused, groups: reports,
    unassigned: reports.filter((r) => !r.targets.length).length,
    layout,
    manualRules: manualRules.length, config, changed: !isDeepStrictEqual(config, cfg),
    plan: { moves: plan.moves.length, trips: plan.trips.length, noRoom: plan.rules.reduce((n, r) => n + r.noRoom, 0), crossSite: plan.crossSite.reduce((n, c) => n + c.count, 0), unclaimed: plan.unclaimed },
  } };
}
