// item-query.mts — pure item-list filtering/sorting/paging/faceting, shared by the browser (ui/dom.mts
// re-exports EXTRA_COLS/colVal; ui/inventory.mts's filtered()/renderInventory() logic will move here in a
// later task) and the server (vault-server.mts's GET /api/items, GET /api/inventory's facets). No DOM, no
// node: imports — this file is served to the browser byte-for-byte, the same way vault-lib.mts is.
// matchesItem runs the same per-item checks for an Organize rule, without the location, character and seen filters.
//
// parseItemQuery/applyItemQuery reproduce, field for field, the predicate in app/ui/inventory.mts's
// filtered() (~lines 42-58) and the sort in renderInventory() (~lines 59-66) as of Task 4: state.hideTags
// (a Set) becomes query.hideTags (an array, .includes() instead of .has()), state.propFilters becomes
// query.props, and $("#f-text").value.trim().toLowerCase() becomes query.q (already normalized by
// parseItemQuery). Numeric sort columns sort HIGH-to-LOW when dir is +1 ((bv - av) * dir) while the
// string columns (name, kind, slot label, location) sort A-to-Z when dir is +1 (av.localeCompare(bv) *
// dir) — that asymmetry is the page's existing behavior (best-stat-first is the useful default for a
// property column; alphabetical is the useful default for a name column), reproduced exactly, not fixed.
//
// map: query
// owns: `parseItemQuery`, `matchesItem`, `applyItemQuery`, `facetsOf`, `propCounts`, `ItemQuery`, `RuleQuery`, `EXTRA_COLS`, `colVal`, `rarityRank`, `HIT_LIMIT`
import { itemSearchBlob, itemOwnBlob, groupByName, compareNames, KINDS, SLOT_LABELS, propertyKeys, extraKeys, flagKeys, flagKey, gearSkills, weaponSkillsOf, WEAPON_SKILLS, PROPERTIES, itemTypeOf, ITEM_TYPES } from "./vault-lib.mts";
import type { Item, ItemGroup } from "./vault-lib.mts";
import type { RulesV1, RulesV1RarityItem } from "./schema/types.d.mts";
import { unravelInfo, LEFT_OUT, type LeftOut, type UnravelInfo } from "./unravel.mts";

// Columns computed from an item but not stored under item.props: vault-lib.mts's "extra" properties, [label, full name].
export const EXTRA_COLS: Record<string, [string, string]> = Object.fromEntries(PROPERTIES.filter((p) => p.kind === "extra").map((p) => [p.key, [p.label, p.full]]));
// A key no property models reads the item's numeric extras (issue #133: "splintering weapon"); a range reads 0.
export const colVal = (it: Item, c: string): number => {
  if (c === "strReq") return it.strReq || 0;
  if (c === "weight") return it.weight || 0;
  const x = it.extras?.[c];
  return it.props[c] || (typeof x === "number" ? x : 0);
};

// 1-based position of `name` in the shard's rarity ladder (ascending, lowest tier first), or 0 if the
// name isn't on the ladder (including no rarity at all). A "Reforged" tier ranks with its base tier. `ladder` is state.rules.rarity in the browser,
// currentRules.rarity on the server — always passed in explicitly; this module has no rules of its own.
export function rarityRank(ladder: RulesV1RarityItem[] | null | undefined, name: string | null | undefined): number {
  const base = String(name || "").replace(/^reforged\s+/i, "").toLowerCase();
  const i = (ladder || []).findIndex((r) => r.name.toLowerCase() === base);
  return i >= 0 ? i + 1 : 0;
}

const CLAMP_LIMIT = (n: number): number => Math.max(1, Math.min(500, n));
// The House map's search (issue #10): `fields=hits` answers each match with only what the map reads (its container and scan
// root, for which house and container hold it, and its place's words; an item tooltip fetches the rest by serial), so a page may
// hold HIT_LIMIT rows (the default) and one request answers nearly any query. `group` does not apply to it.
export const HIT_LIMIT = 10000;
export interface HitRow { serial: number; name: string; amount: number; root: number | null; container: number | null; location?: { text: string } | undefined }
export const wantsHits = (sp: URLSearchParams): boolean => sp.get("fields") === "hits";
export const hitRow = (it: Item): HitRow => ({ serial: it.serial, name: it.name, amount: it.amount, root: it.root, container: it.container, ...(it.location ? { location: { text: it.location.text } } : {}) });
// The property rule's counts (`fields=props`): of the matching stacks, how many carry each numeric property (a modelled
// one, a numeric tooltip line, a Strength requirement, a weight) and each yes/no property (by flagKey), page and grouping aside.
export const wantsPropCounts = (sp: URLSearchParams): boolean => sp.get("fields") === "props";
export interface PropCounts { props: Record<string, number>; flags: Record<string, number> }
export function propCounts(items: Item[]): PropCounts {
  const props: Record<string, number> = {}, flags: Record<string, number> = {};
  const add = (m: Record<string, number>, k: string): void => { m[k] = (m[k] || 0) + 1; };
  for (const it of items) {
    for (const k of Object.keys(it.props)) add(props, k);
    for (const [k, v] of Object.entries(it.extras || {})) if (typeof v === "number") add(props, k);
    if (it.strReq) add(props, "strReq");
    if (it.weight != null) add(props, "weight");
    for (const f of new Set((it.flags || []).map(flagKey))) add(flags, f);
  }
  return { props, flags };
}

// A property rule: `min` is the threshold and `op` says which side of it passes — absent is "at least"
// (the rule's original and wire-default meaning, `prop=hci:10`), "le" is "at most", "eq" is "exactly", "ne" is
// "anything but". An item without the property reads 0 for every op (colVal).
export type PropOp = "le" | "eq" | "ne";
export interface PropFilter { key: string; min: number; op?: PropOp | undefined; }
// The list filters (chars, slot, loc, roots, kind) match ANY of their values; an empty list is no filter.
// `rarity` matches one tier exactly, `rarityMin` that tier or any above it on the shard's ladder, `rarityMax` that tier or any below it (an item with no tier, or one off the ladder, counts as below every tier).
// `hideTags` drops an item with any of its tags, `tags` (issue #133) keeps only an item with any of its tags.
// `flags` (issue #182) keeps only an item with EVERY one of its yes/no properties, like the property rules it sits beside.
// `wskill` (issue #188) is a list filter too: a weapon counting under any of its skills (vault-lib.mts's weaponSkillsOf).
// `type` is one as well: what a piece is (vault-lib.mts's itemTypeOf: shield, two-handed, one-handed, spellbook, armor, …).
// `unravel` (issue #271) keeps only pieces that unravel into something, each row carrying what (`UnravelRow`), less the ones
// left out by default (unravel.mts's LEFT_OUT) unless `unravelShow` names their reasons; sort `unravel` is by weight.
export interface ItemQuery {
  q: string; chars: string[]; slot: string[]; loc: string[]; roots: number[]; rarity: string; rarityMin: string; rarityMax: string; kind: string[];
  seenDays: number; slayer: string; nogarg: boolean; med: boolean; hideTags: string[]; tags: string[]; props: PropFilter[]; flags: string[]; wskill: string[]; type: string[]; group: boolean;
  sort: string; dir: 1 | -1; offset: number; limit: number;
  unravel?: boolean | undefined; unravelShow?: LeftOut[] | undefined;
}

// An Organize rule's query (issue #11): the Inventory's filters on the item itself. Location, character and
// seen filters are left out, and so are the view and paging, because a rule must keep matching an item after
// it moves. `tags`, `flags`, `wskill` and `type` are optional: rules saved before them (issues #133, #182, #188) have none.
export type RuleQuery = Omit<ItemQuery, "loc" | "roots" | "chars" | "seenDays" | "group" | "sort" | "dir" | "offset" | "limit" | "tags" | "flags" | "wskill" | "type" | "unravel" | "unravelShow"> & { tags?: string[]; flags?: string[]; wskill?: string[]; type?: string[] };

// Reads every filter/sort/paging knob off a URLSearchParams (GET /api/items' query string, or the page's
// own future use of the same parser). `hide`, `tag`, `prop`, `slot`, `kind`, `wskill` and `type` accept either a single
// comma-separated value (hide=a,b) or repeated params (hide=a&hide=b) — both are flattened the same way.
// `char` and `loc` are repeated params only: a character or container name may itself hold a comma.
// `flag` (issue #182) is repeated only too, one yes/no property each (`flag=spell channeling`), lower-cased as
// parseTooltip keeps them: a separate param rather than a `prop` op, because a prop rule is a number on a key.
// A prop rule is `key:min` (at least) or `key:op:min` with op one of ge, le, eq, ne. `unravel=1` lists unravel candidates and
// `unravelShow` (comma-separated or repeated) the reasons not to leave out, or `all`.
export function parseItemQuery(searchParams: URLSearchParams): ItemQuery {
  const sp = searchParams;
  const splitAll = (name: string) => sp.getAll(name).flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean);
  const hideTags = splitAll("hide");
  const props: PropFilter[] = [];
  for (const raw of splitAll("prop")) {
    const parts = raw.split(":").map((x) => x.trim());
    if (parts.length < 2) continue;
    const key = parts[0]!;
    const opRaw = parts.length > 2 ? parts[1]! : "ge";
    if (!["ge", "le", "eq", "ne"].includes(opRaw)) continue;
    const min = +parts[parts.length - 1]!;
    if (key) props.push({ key, min: Number.isFinite(min) ? min : 0, ...(opRaw === "ge" ? {} : { op: opRaw as PropOp }) });
  }
  const listOf = (name: string): string[] => sp.getAll(name).map((s) => s.trim()).filter(Boolean);
  const limitN = parseInt(sp.get("limit") as string, 10);
  const limit = wantsHits(sp) ? Math.max(1, Math.min(HIT_LIMIT, Number.isFinite(limitN) ? limitN : HIT_LIMIT)) : CLAMP_LIMIT(Number.isFinite(limitN) ? limitN : 200);
  const offsetN = parseInt(sp.get("offset") as string, 10);
  const offset = Number.isFinite(offsetN) && offsetN > 0 ? offsetN : 0;
  const seenDaysN = +(sp.get("seenDays") as string);
  return {
    q: (sp.get("q") || "").trim().toLowerCase(),
    chars: listOf("char"),
    slot: splitAll("slot"),
    loc: listOf("loc"),
    roots: listOf("root").map(Number).filter(Number.isFinite),
    rarity: sp.get("rarity") || "",
    rarityMin: sp.get("rarityMin") || "",
    rarityMax: sp.get("rarityMax") || "",
    kind: splitAll("kind"),
    seenDays: Number.isFinite(seenDaysN) ? seenDaysN : 0,
    slayer: sp.get("slayer") || "",
    nogarg: sp.get("nogarg") === "1",
    med: sp.get("med") === "1",
    hideTags,
    tags: splitAll("tag"),
    props,
    flags: listOf("flag").map((s) => s.toLowerCase()),
    wskill: splitAll("wskill").map((s) => s.toLowerCase()),
    type: splitAll("type").map((s) => s.toLowerCase()),
    group: sp.get("group") === "1" && !wantsHits(sp),
    sort: sp.get("sort") || "name",
    dir: sp.get("dir") === "-1" ? -1 : 1,
    offset,
    limit,
    ...(sp.get("unravel") === "1" ? { unravel: true, unravelShow: splitAll("unravelShow").includes("all") ? [...LEFT_OUT] : LEFT_OUT.filter((r) => splitAll("unravelShow").includes(r)) } : {}),
  };
}

function passes(v: number, f: PropFilter): boolean {
  return f.op === "le" ? v <= f.min : f.op === "eq" ? v === f.min : f.op === "ne" ? v !== f.min : v >= f.min;
}
// The checks on the item itself, shared by the Inventory's query (matches) and an Organize rule (matchesItem).
// `needle` is the free text, trimmed and lower-cased; `blob` gives the text it is looked for in, built only
// when there is a needle.
function itemPasses(it: Item, q: RuleQuery, needle: string, blob: (it: Item) => string, minRank: number, maxRank: number, ladder: RulesV1RarityItem[]): boolean {
  if (q.kind.length && !q.kind.includes(it.kind)) return false;
  if (q.nogarg && it.gargoyle) return false;
  if (q.med && !it.medable) return false;
  // "?" is the unknown slot: an item with none.
  if (q.slot.length && !q.slot.includes(it.slot || "?")) return false;
  if (q.rarity && it.rarity !== q.rarity) return false;
  if (minRank && rarityRank(ladder, it.rarity) < minRank) return false;
  if (maxRank && rarityRank(ladder, it.rarity) > maxRank) return false;
  if (q.slayer === "*" ? !it.slayers?.length : q.slayer && !it.slayers?.includes(q.slayer)) return false;
  if (it.tags.some((t) => q.hideTags.includes(t))) return false;
  if (q.tags?.length && !it.tags.some((t) => q.tags!.includes(t))) return false;
  for (const f of q.props) if (!passes(colVal(it, f.key), f)) return false;
  if (q.flags?.some((f) => !it.flags?.some((x) => flagKey(x) === flagKey(f)))) return false;
  if (q.wskill?.length && !weaponSkillsOf(it).some((w) => q.wskill!.some((s) => s.toLowerCase() === w))) return false;
  if (q.type?.length && !q.type.some((t) => t.toLowerCase() === itemTypeOf(it))) return false;
  if (needle && !blob(it).includes(needle)) return false;
  return true;
}
function matches(it: Item, q: ItemQuery, seenCut: number, minRank: number, maxRank: number, ladder: RulesV1RarityItem[], blob: (it: Item) => string): boolean {
  if (q.chars.length && !q.chars.includes(it.location?.character as string)) return false;
  if (seenCut && Date.parse(it.seenAt) < seenCut) return false;
  // A location matches by its exact text or by the root container it sits in (every bag inside it).
  if ((q.loc.length || q.roots.length) && !(q.loc.includes(it.location?.text as string) || (it.root != null && q.roots.includes(+it.root)))) return false;
  return itemPasses(it, q, q.q, blob, minRank, maxRank, ladder);
}

// Whether an item passes an Organize rule's query (issue #11): the Inventory's per-item checks, with the free
// text matched against the item only (itemOwnBlob: name, tooltip lines, kind, rarity), never its location, so a
// "reag" rule never claims a sword in a chest labelled Reagents. `rarity` is the shard's ladder, as for
// applyItemQuery; without it rarityMin and rarityMax filter nothing.
export function matchesItem(it: Item, rq: RuleQuery, { rarity = [] }: { rarity?: RulesV1RarityItem[] } = {}): boolean {
  const minRank = rq.rarityMin ? rarityRank(rarity, rq.rarityMin) : 0;
  const maxRank = rq.rarityMax ? rarityRank(rarity, rq.rarityMax) : 0;
  return itemPasses(it, rq, rq.q.trim().toLowerCase(), itemOwnBlob, minRank, maxRank, rarity);
}

function sortValue(it: Item, key: string, ladder: RulesV1RarityItem[] | undefined): string | number {
  if (key === "name") return it.name;
  if (key === "seen") return String(it.seenAt);
  if (key === "rarity") return rarityRank(ladder, it.rarity);
  if (key === "kind") return it.kind;
  if (key === "amount") return it.amount || 1;
  if (key === "slot") return SLOT_LABELS[it.slot as string] || it.slot || "?";
  if (key === "location") return it.location?.text || "";
  if (key === "med") return it.gear ? (it.medable ? 2 : 1) : 0;
  if (key === "unravel") return (it as UnravelRow).unravel?.weight ?? 0;
  return colVal(it, key);
}

// `serial` is the group's first stack in the list's order: a group of one stack shows that item's tooltip.
interface ItemGroupJson { name: string; kind: string; slot: string | null; amount: number; stacks: number; locations: Array<[string, number]>; serial: number; }
const groupJson = (g: ItemGroup): ItemGroupJson => ({ name: g.name, kind: g.kind, slot: g.slot, amount: g.amount, stacks: g.stacks, locations: [...g.locations.entries()], serial: g.items[0]!.serial });

export interface ItemQueryRows { rows: Item[]; total: number; pieces: number; }
// An unravel candidate's row (query.unravel): the item and what unraveling it gives.
export type UnravelRow = Item & { unravel: UnravelInfo };
// What applyItemQuery needs for query.unravel: the rules' unravel block, and why each piece is left out.
export interface UnravelContext { rules: Pick<RulesV1, "unravel">; leftOut: (it: Item) => LeftOut[] }
// In group mode `total` counts names; `stacks` and `pieces` are the matching stacks and pieces behind them.
export interface ItemQueryGroups { groups: ItemGroupJson[]; total: number; stacks: number; pieces: number; }

// applyItemQuery(items, query, {rarity, now}) → {rows, total, pieces} normally, or {groups, total} when
// query.group is set — see the module header for the exact page behavior this reproduces. `places` is
// vault-lib.mts's labelledPlaces, so the free text also finds an item by its container's Organize label.
export function applyItemQuery(items: Item[], query: ItemQuery, { rarity = [], now = Date.now(), unravel, places }: { rarity?: RulesV1RarityItem[]; now?: number; unravel?: UnravelContext; places?: ReadonlyMap<string, string> } = {}): ItemQueryRows | ItemQueryGroups {
  const seenCut = query.seenDays ? now - query.seenDays * 864e5 : 0;
  const minRank = query.rarityMin ? rarityRank(rarity, query.rarityMin) : 0;
  const maxRank = query.rarityMax ? rarityRank(rarity, query.rarityMax) : 0;
  const blob = places?.size ? (it: Item): string => `${itemSearchBlob(it)} \n ${(places.get(it.location?.text as string) || "").toLowerCase()}` : itemSearchBlob;
  let found = items.filter((it) => matches(it, query, seenCut, minRank, maxRank, rarity, blob));
  if (query.unravel) found = unravelRows(found, query.unravelShow ?? [], unravel);
  const pieces = found.reduce((a, i) => a + (i.amount || 1), 0);
  const k = query.sort, d = query.dir;
  const sorted = [...found].sort((a, b) => {
    const av = sortValue(a, k, rarity), bv = sortValue(b, k, rarity);
    return typeof av === "number" ? ((bv as number) - av) * d : (k === "name" ? compareNames(String(av), String(bv)) : String(av).localeCompare(String(bv))) * d;
  });
  if (query.group) {
    // Group mode's sortable headers are Name, Kind, Total (amount) and Stacks; the numeric ones sort
    // high-to-low at dir +1, like the row view's numeric columns.
    const groups = groupByName(sorted).sort((a, b) => (k === "amount" ? (b.amount - a.amount) * d : k === "stacks" ? (b.stacks - a.stacks) * d : k === "kind" ? a.kind.localeCompare(b.kind) * d : compareNames(a.name, b.name) * d));
    return { groups: groups.slice(query.offset, query.offset + query.limit).map(groupJson), total: groups.length, stacks: found.length, pieces };
  }
  return { rows: sorted.slice(query.offset, query.offset + query.limit), total: sorted.length, pieces };
}

// The pieces that unravel into something, each with what it gives; a piece left out for a reason `show` does not name is dropped.
function unravelRows(items: Item[], show: LeftOut[], ctx: UnravelContext | undefined): UnravelRow[] {
  if (!ctx) return [];
  const out: UnravelRow[] = [];
  for (const it of items) {
    const leftOut = ctx.leftOut(it);
    if (leftOut.some((r) => !show.includes(r))) continue;
    const info = unravelInfo(it, ctx.rules, leftOut);
    if (info) out.push({ ...it, unravel: info });
  }
  return out;
}

export interface Place { text: string; character: string; kind: string; root: number | null; rootName: string; count: number; }
export interface Facets {
  slots: string[];
  locations: string[];
  // Every location text with where it sits (its owner, its root container's kind, serial and name) and how
  // many stacks it holds: the Inventory's Location filter builds its character → root → bag tree from this.
  places: Place[];
  rarities: string[];
  slayers: Array<{ name: string; count: number }>;
  slayerAny: number;
  kinds: Array<{ name: string; count: number }>;
  // The weapon skills weapons count under (issue #188, vault-lib.mts's weaponSkillsOf), in WEAPON_SKILLS order.
  weaponSkills: Array<{ name: string; count: number }>;
  // The Type chip's choices (vault-lib.mts's ITEM_TYPES, in that order) with how many stacks each, the empty ones left out.
  types: Array<{ name: string; count: number }>;
  propKeys: string[];
  // Numeric extras a property filter can threshold (issue #133): offered by the Inventory's property rule only,
  // never by the Suit Builder, whose keys propKeys feeds.
  extraKeys: string[];
  // Yes/no properties a filter can require (issue #182; vault-lib.mts's flagKeys says which flags count), lower-cased.
  flagKeys: string[];
  gearSkills: string[];
  itemCount: number;
}
// The filter UI's option lists + counts, over a set of items (usually the whole inventory). Reproduces
// buildFilters() (app/ui/inventory.mts ~lines 9-22) as data instead of DOM.
//
// gearSkills is here for the same reason propKeys is: the Suit Builder's "Forbid skill bonuses"
// chips and its floor/weight key list (ui/builder.mts's renderProfile) need every skill that
// appears as a gear bonus ANYWHERE in the inventory, which — like propKeys — is only computable
// from the full item set. Since GET /api/inventory stopped shipping that (Task 5), this facet is
// the one place left for the page to get it, instead of calling vault-lib.mts's gearSkills()
// client-side against a state.inv that no longer has .items (the bug this comment is here to keep
// from recurring — it did, once, in the very Task 5 that removed inv.items).
export function facetsOf(items: Item[], { rarity = [] }: { rarity?: RulesV1RarityItem[] } = {}): Facets {
  const slots = [...new Set(items.map((i) => i.slot).filter(Boolean) as string[])].sort();
  const locations = [...new Set(items.map((i) => i.location?.text).filter(Boolean) as string[])].sort();
  const byText = new Map<string, Place>();
  for (const i of items) {
    const l = i.location;
    if (!l?.text) continue;
    const p = byText.get(l.text);
    if (p) { p.count++; continue; }
    byText.set(l.text, { text: l.text, character: l.character, kind: String(l.kind || "unknown"), root: l.root ?? null, rootName: l.rootName || l.text, count: 1 });
  }
  const places = [...byText.values()].sort((a, b) => a.text.localeCompare(b.text));
  const rarities = [...new Set(items.map((i) => i.rarity).filter(Boolean) as string[])].sort((a, b) => rarityRank(rarity, a) - rarityRank(rarity, b));
  const slayerNames = [...new Set(items.flatMap((i) => i.slayers || []))].sort();
  const slayers = slayerNames.map((name) => ({ name, count: items.filter((i) => i.slayers?.includes(name)).length }));
  const slayerAny = items.filter((i) => i.slayers?.length).length;
  const kinds = KINDS.filter((k) => items.some((i) => i.kind === k)).map((name) => ({ name, count: items.filter((i) => i.kind === name).length }));
  const skillsOf = items.map(weaponSkillsOf);
  const weaponSkills = WEAPON_SKILLS.map((name) => ({ name, count: skillsOf.filter((s) => s.includes(name)).length })).filter((w) => w.count);
  const typeOf = items.map(itemTypeOf);
  const types = ITEM_TYPES.map((name) => ({ name, count: typeOf.filter((t) => t === name).length })).filter((t) => t.count);
  return { slots, locations, places, rarities, slayers, slayerAny, kinds, weaponSkills, types, propKeys: propertyKeys({ items }), extraKeys: extraKeys({ items }), flagKeys: flagKeys({ items }), gearSkills: gearSkills({ items }), itemCount: items.length };
}
