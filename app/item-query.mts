// item-query.mts — pure item-list filtering/sorting/paging/faceting, shared by the browser (ui/dom.mts
// re-exports EXTRA_COLS/colVal; ui/inventory.mts's filtered()/renderInventory() logic will move here in a
// later task) and the server (vault-server.mts's GET /api/items, GET /api/inventory's facets). No DOM, no
// node: imports — this file is served to the browser byte-for-byte, the same way vault-lib.mts is.
//
// parseItemQuery/applyItemQuery reproduce, field for field, the predicate in app/ui/inventory.mts's
// filtered() (~lines 42-58) and the sort in renderInventory() (~lines 59-66) as of Task 4: state.hideTags
// (a Set) becomes query.hideTags (an array, .includes() instead of .has()), state.propFilters becomes
// query.props, and $("#f-text").value.trim().toLowerCase() becomes query.q (already normalized by
// parseItemQuery). Numeric sort columns sort HIGH-to-LOW when dir is +1 ((bv - av) * dir) while the
// string columns (name, kind, slot label, location) sort A-to-Z when dir is +1 (av.localeCompare(bv) *
// dir) — that asymmetry is the page's existing behavior (best-stat-first is the useful default for a
// property column; alphabetical is the useful default for a name column), reproduced exactly, not fixed.
import { itemSearchBlob, groupByName, KINDS, SLOT_LABELS, propertyKeys, gearSkills } from "./vault-lib.mts";
import type { Item, ItemGroup } from "./vault-lib.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";

// Columns computed from an item but not stored under item.props — moved verbatim from ui/dom.mts (Task 4).
export const EXTRA_COLS: Record<string, [string, string]> = { strReq: ["STR req", "Strength Requirement"], weight: ["Wt", "Weight (stones)"] };
export const colVal = (it: Item, c: string): number => (c === "strReq" ? it.strReq || 0 : c === "weight" ? it.weight || 0 : it.props[c] || 0);

// 1-based position of `name` in the shard's rarity ladder (ascending, lowest tier first), or 0 if the
// name isn't on the ladder (including no rarity at all). `ladder` is state.rules.rarity in the browser,
// currentRules.rarity on the server — always passed in explicitly; this module has no rules of its own.
export function rarityRank(ladder: RulesV1RarityItem[] | null | undefined, name: string | null | undefined): number {
  const i = (ladder || []).findIndex((r) => r.name.toLowerCase() === String(name || "").toLowerCase());
  return i >= 0 ? i + 1 : 0;
}

const CLAMP_LIMIT = (n: number): number => Math.max(1, Math.min(500, n));

// A property rule: `min` is the threshold and `op` says which side of it passes — absent is "at least"
// (the rule's original and wire-default meaning, `prop=hci:10`), "le" is "at most", "eq" is "exactly".
export type PropOp = "le" | "eq";
export interface PropFilter { key: string; min: number; op?: PropOp | undefined; }
// The list filters (chars, slot, loc, roots, kind) match ANY of their values; an empty list is no filter.
// `rarity` matches one tier exactly, `rarityMin` that tier or any above it on the shard's ladder.
export interface ItemQuery {
  q: string; chars: string[]; slot: string[]; loc: string[]; roots: number[]; rarity: string; rarityMin: string; kind: string[];
  seenDays: number; slayer: string; nogarg: boolean; med: boolean; hideTags: string[]; props: PropFilter[]; group: boolean;
  sort: string; dir: 1 | -1; offset: number; limit: number;
}

// Reads every filter/sort/paging knob off a URLSearchParams (GET /api/items' query string, or the page's
// own future use of the same parser). `hide`, `prop`, `slot` and `kind` accept either a single
// comma-separated value (hide=a,b) or repeated params (hide=a&hide=b) — both are flattened the same way.
// `char` and `loc` are repeated params only: a character or container name may itself hold a comma.
// A prop rule is `key:min` (at least) or `key:op:min` with op one of ge, le, eq.
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
    if (!["ge", "le", "eq"].includes(opRaw)) continue;
    const min = +parts[parts.length - 1]!;
    if (key) props.push({ key, min: Number.isFinite(min) ? min : 0, ...(opRaw === "ge" ? {} : { op: opRaw as PropOp }) });
  }
  const listOf = (name: string): string[] => sp.getAll(name).map((s) => s.trim()).filter(Boolean);
  const limitN = parseInt(sp.get("limit") as string, 10);
  const limit = CLAMP_LIMIT(Number.isFinite(limitN) ? limitN : 200);
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
    kind: splitAll("kind"),
    seenDays: Number.isFinite(seenDaysN) ? seenDaysN : 0,
    slayer: sp.get("slayer") || "",
    nogarg: sp.get("nogarg") === "1",
    med: sp.get("med") === "1",
    hideTags,
    props,
    group: sp.get("group") === "1",
    sort: sp.get("sort") || "name",
    dir: sp.get("dir") === "-1" ? -1 : 1,
    offset,
    limit,
  };
}

function passes(v: number, f: PropFilter): boolean {
  return f.op === "le" ? v <= f.min : f.op === "eq" ? v === f.min : v >= f.min;
}
function matches(it: Item, q: ItemQuery, seenCut: number, minRank: number, ladder: RulesV1RarityItem[]): boolean {
  if (q.kind.length && !q.kind.includes(it.kind)) return false;
  if (q.chars.length && !q.chars.includes(it.location?.character as string)) return false;
  if (q.nogarg && it.gargoyle) return false;
  if (q.med && !it.medable) return false;
  if (seenCut && Date.parse(it.seenAt) < seenCut) return false;
  // "?" is the unknown slot: an item with none.
  if (q.slot.length && !q.slot.includes(it.slot || "?")) return false;
  // A location matches by its exact text or by the root container it sits in (every bag inside it).
  if ((q.loc.length || q.roots.length) && !(q.loc.includes(it.location?.text as string) || (it.root != null && q.roots.includes(+it.root)))) return false;
  if (q.rarity && it.rarity !== q.rarity) return false;
  if (minRank && rarityRank(ladder, it.rarity) < minRank) return false;
  if (q.slayer === "*" ? !it.slayers?.length : q.slayer && !it.slayers?.includes(q.slayer)) return false;
  if (it.tags.some((t) => q.hideTags.includes(t))) return false;
  for (const f of q.props) if (!passes(colVal(it, f.key), f)) return false;
  if (q.q && !itemSearchBlob(it).includes(q.q)) return false;
  return true;
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
  return colVal(it, key);
}

interface ItemGroupJson { name: string; kind: string; slot: string | null; amount: number; stacks: number; locations: Array<[string, number]>; }
const groupJson = (g: ItemGroup): ItemGroupJson => ({ name: g.name, kind: g.kind, slot: g.slot, amount: g.amount, stacks: g.stacks, locations: [...g.locations.entries()] });

export interface ItemQueryRows { rows: Item[]; total: number; pieces: number; }
// In group mode `total` counts names; `stacks` and `pieces` are the matching stacks and pieces behind them.
export interface ItemQueryGroups { groups: ItemGroupJson[]; total: number; stacks: number; pieces: number; }

// applyItemQuery(items, query, {rarity, now}) → {rows, total, pieces} normally, or {groups, total} when
// query.group is set — see the module header for the exact page behavior this reproduces.
export function applyItemQuery(items: Item[], query: ItemQuery, { rarity = [], now = Date.now() }: { rarity?: RulesV1RarityItem[]; now?: number } = {}): ItemQueryRows | ItemQueryGroups {
  const seenCut = query.seenDays ? now - query.seenDays * 864e5 : 0;
  const minRank = query.rarityMin ? rarityRank(rarity, query.rarityMin) : 0;
  const found = items.filter((it) => matches(it, query, seenCut, minRank, rarity));
  const pieces = found.reduce((a, i) => a + (i.amount || 1), 0);
  const k = query.sort, d = query.dir;
  const sorted = [...found].sort((a, b) => {
    const av = sortValue(a, k, rarity), bv = sortValue(b, k, rarity);
    return typeof av === "number" ? ((bv as number) - av) * d : String(av).localeCompare(String(bv)) * d;
  });
  if (query.group) {
    // Group mode's sortable headers are Name, Kind, Total (amount) and Stacks; the numeric ones sort
    // high-to-low at dir +1, like the row view's numeric columns.
    const groups = groupByName(sorted).sort((a, b) => (k === "amount" ? (b.amount - a.amount) * d : k === "stacks" ? (b.stacks - a.stacks) * d : k === "kind" ? a.kind.localeCompare(b.kind) * d : a.name.localeCompare(b.name) * d));
    return { groups: groups.slice(query.offset, query.offset + query.limit).map(groupJson), total: groups.length, stacks: found.length, pieces };
  }
  return { rows: sorted.slice(query.offset, query.offset + query.limit), total: sorted.length, pieces };
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
  propKeys: string[];
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
  return { slots, locations, places, rarities, slayers, slayerAny, kinds, propKeys: propertyKeys({ items }), gearSkills: gearSkills({ items }), itemCount: items.length };
}
