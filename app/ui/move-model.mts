// ui/move-model.mts — Move to's pure rules (issue #270): the Inventory's selection (ticked rows, a shift-click range, the rows loaded so far, then every item matching the filter; a worn item is never in it), the containers the picker offers, and the words of the selection bar, the picker and the result line. No DOM: app/ui-move.test.mts tests it under plain node:test; ui/move-to.mts draws it.
import { bagLabel, compareNames, TRASH_RE, type Container, type Item } from "../vault-lib.mts";
import type { ItemQuery } from "../item-query.mts";
import { plural, queryParams } from "./inv-model.mts";
import type { MovePlanSummary } from "./api-types.mts";

// ---------------------------------------------------------------- the selection
// `items`: rows ticked one by one (outside `all`'s filter once it is set), by serial. `all`: every item matching that filter (its query as the table had it), `count` of them not worn; `except`: rows matching it the player unticked since. `anchor`: the row index a shift-click extends from. The selection never holds a worn item.
export interface AllMatching { query: ItemQuery; count: number; worn: number }
export interface Selection { items: ReadonlyMap<number, Item>; all: AllMatching | null; except: ReadonlySet<number>; anchor: number | null }
export const emptySelection = (): Selection => ({ items: new Map(), all: null, except: new Set(), anchor: null });
// Whether an item matches `all`'s filter (the page asks item-query.mts with the filter as it was set).
export type Matches = (it: Item) => boolean;
export const isWorn = (it: Pick<Item, "equippedBy">): boolean => !!it.equippedBy;
export const WORN_LOCK = "Worn: take it off first";

export function isSelected(sel: Selection, it: Item, matches: Matches): boolean {
  if (isWorn(it)) return false;
  return sel.all && matches(it) ? !sel.except.has(it.serial) : sel.items.has(it.serial);
}
export const selectedCount = (sel: Selection): number => sel.items.size + (sel.all ? sel.all.count - sel.except.size : 0);
function setOne(sel: Selection, it: Item, on: boolean, matches: Matches): Selection {
  if (sel.all && matches(it)) {
    const except = new Set(sel.except);
    if (on) except.delete(it.serial); else except.add(it.serial);
    return { ...sel, except };
  }
  const items = new Map(sel.items);
  if (on) items.set(it.serial, it); else items.delete(it.serial);
  return { ...sel, items };
}
// A row's checkbox clicked: that row, or with shift every loaded row from the anchor to it, ticked or unticked. Worn rows in a ticked range are left out and named.
export function toggleRows(sel: Selection, rows: ReadonlyArray<Item | undefined>, index: number, on: boolean, shift: boolean, matches: Matches): { sel: Selection; worn: string[] } {
  const a = shift && sel.anchor != null ? Math.min(sel.anchor, index) : index, b = shift && sel.anchor != null ? Math.max(sel.anchor, index) : index;
  let next = sel;
  const worn: string[] = [];
  for (let i = a; i <= b; i++) {
    const it = rows[i];
    if (!it) continue;
    if (isWorn(it)) { worn.push(it.name); continue; }
    next = setOne(next, it, on, matches);
  }
  return { sel: { ...next, anchor: index }, worn: on ? worn : [] };
}
// The header checkbox: on ticks every row loaded so far (the worn ones named), off clears the whole selection.
export function toggleLoaded(sel: Selection, rows: ReadonlyArray<Item | undefined>, on: boolean, matches: Matches): { sel: Selection; worn: string[] } {
  if (!on) return { sel: emptySelection(), worn: [] };
  let next = sel;
  const worn: string[] = [];
  for (const it of rows) {
    if (!it) continue;
    if (isWorn(it)) worn.push(it.name);
    else next = setOne(next, it, true, matches);
  }
  return { sel: next, worn };
}
// The header checkbox's look over the loaded rows that can be ticked.
export function loadedState(sel: Selection, rows: ReadonlyArray<Item | undefined>, matches: Matches): "all" | "some" | "none" {
  let on = 0, n = 0;
  for (const it of rows) {
    if (!it || isWorn(it)) continue;
    n++;
    if (isSelected(sel, it, matches)) on++;
  }
  return !on ? "none" : on === n ? "all" : "some";
}
// Every item matching `query`: the page's ticks inside it are folded in, ticks outside it kept.
export function selectAllMatching(sel: Selection, query: ItemQuery, count: number, worn: number, matches: Matches): Selection {
  const items = new Map([...sel.items].filter(([, it]) => !matches(it)));
  return { items, all: { query, count, worn }, except: new Set(), anchor: sel.anchor };
}
// What POST /api/move/plan and /api/move/trip are sent (app/move.mts's Selection).
export function selectionBody(sel: Selection): { serials?: number[]; query?: string; except?: number[] } {
  return {
    ...(sel.items.size ? { serials: [...sel.items.keys()] } : {}),
    ...(sel.all ? { query: queryParams({ ...sel.all.query, group: false }).toString(), except: [...sel.except] } : {}),
  };
}
// Grab works on records the page has: ticked rows only, at most a Grab all's worth (the bridge's rate limit).
export const GRAB_MAX = 20;
export function grabItems(sel: Selection): Item[] | null { return !sel.all && sel.items.size <= GRAB_MAX ? [...sel.items.values()] : null; }
export const GRAB_TOO_MANY = `Grab takes up to ${GRAB_MAX} items at a time. Use Move to… for more.`;

// ---------------------------------------------------------------- the selection bar
export const selectedText = (n: number): string => `${plural(n, "item")} selected`;
export function wornNote(names: readonly string[], count = names.length): string | null {
  if (!count) return null;
  return count === 1 && names[0] ? `Left out ${names[0]}: it's worn. Take it off in game to move it.` : `Left out ${plural(count, "worn item")}. Take them off in game to move them.`;
}
export const loadedNote = (n: number): string => `The ${plural(n, "item")} shown ${n === 1 ? "is" : "are"} selected.`;
export const allOffer = (n: number): string => `Select all ${n.toLocaleString("en-US")} matching the filter`;
export const allNote = (n: number): string => `All ${plural(n, "item")} matching the filter ${n === 1 ? "is" : "are"} selected, here and further down.`;

// ---------------------------------------------------------------- the picker
export interface DestRow { serial: number; name: string; sub: string; fill: { items: number; max: number } }
export interface DestGroup { title: string; rows: DestRow[] }
// The group of containers in no house (the House map's own words for them).
export const OUTSIDE = "Containers on the ground";
// The containers a Move can fill, as the scans have them: on the ground or in a container there, with a known fill, never trash, a blacklisted one or one in a blacklisted container, or a bag the newest scan could not open. Grouped by house (`houseOf` names the house a root stands in, else OUTSIDE), houses A to Z with OUTSIDE last; a root and then the bags in it.
export function destGroups(containers: Readonly<Record<string, Container>>, houseOf: (root: number) => string | null, nameOf: (c: Container) => string, blacklist: readonly number[] = []): DestGroup[] {
  const black = new Set(blacklist);
  const groups = new Map<string, DestRow[]>();
  const chainOf = (c: Container): Container[] => {
    const out: Container[] = [];
    for (let cur: Container | undefined = c; cur && out.length < 9; cur = cur.parent == null ? undefined : containers[cur.parent]) out.push(cur);
    return out;
  };
  for (const c of Object.values(containers)) {
    const chain = chainOf(c), root = chain.at(-1)!;
    if (root.parent != null || root.kind !== "ground" || !root.pos || !c.capacity || chain.some((x) => !x.capacity || x.opened === false || black.has(+x.serial) || TRASH_RE.test(bagLabel(x)))) continue;
    const house = houseOf(+root.serial) ?? OUTSIDE;
    const sub = chain.slice(1).map(nameOf).map((n, i) => (i ? n : `in ${n}`)).join(" · ");
    groups.set(house, [...(groups.get(house) ?? []), { serial: +c.serial, name: nameOf(c), sub: sub || (house === OUTSIDE ? "" : house), fill: { items: c.capacity.items, max: c.capacity.maxItems } }]);
  }
  return [...groups].sort(([a], [b]) => (a === OUTSIDE ? 1 : b === OUTSIDE ? -1 : compareNames(a, b)))
    .map(([title, rows]) => ({ title, rows: rows.sort((x, y) => compareNames(x.sub === title ? x.name : `${x.sub} ${x.name}`, y.sub === title ? y.name : `${y.sub} ${y.name}`) || x.serial - y.serial) }));
}
export const matchesDest = (r: DestRow, group: string, q: string): boolean => !q || `${r.name} ${r.sub} ${group}`.toLowerCase().includes(q.trim().toLowerCase());
// A row's room line before a container is picked: `need` = the selected items not worn, `here` = those already in it.
export function roomText(fill: { items: number; max: number }, need: number, here: number): { text: string; short: boolean } {
  const room = Math.max(0, fill.max - fill.items), want = need - here;
  if (!room) return { text: "Full", short: true };
  if (want > room) return { text: `Room for ${room.toLocaleString("en-US")}`, short: true };
  return { text: here ? `${here.toLocaleString("en-US")} already here` : "Room for all", short: false };
}
// Why some of the selection stays put, from the plan's counts (app/move.mts's LeftReason), worn first.
const LEFT_WORDS: Array<[string, string]> = [["worn", "worn"], ["pack", "in a backpack, a bank box or carried (Move to takes only from containers on the ground)"], ["bag", "containers themselves"],
  ["site", "in another house"], ["unreachable", "in a container Pack Rat cannot reach"], ["gone", "no longer in your scans"]];
export function leftText(left: Readonly<Record<string, number | undefined>>, worn: number): string | null {
  const parts = LEFT_WORDS.map(([k, words]) => [k === "worn" ? worn : left[k] ?? 0, words] as const).filter(([n]) => n > 0).map(([n, words]) => `${n.toLocaleString("en-US")} ${words}`);
  return parts.length ? `Staying where they are: ${parts.join(", ")}.` : null;
}
// The picker's foot once a container is picked: what will happen, and the Move button's words (null: nothing can move).
export function pickedText(name: string, plan: MovePlanSummary, fill: { items: number; max: number }): { text: string; short: boolean; button: string | null } {
  const { moving, noRoom, already } = plan;
  const skip = already ? ` ${plural(already, "item")} already there ${already === 1 ? "is" : "are"} skipped.` : "";
  if (!moving) return { text: noRoom ? `${name} has no room left.` : `Nothing to move into ${name}.${skip}`, short: !!noRoom, button: null };
  if (noRoom) return { text: `${name} has room for ${moving.toLocaleString("en-US")} of ${(moving + noRoom).toLocaleString("en-US")}. The other ${noRoom.toLocaleString("en-US")} stay where they are.`, short: true, button: `Move the ${moving.toLocaleString("en-US")} that fit` };
  return { text: `${name} will hold ${(fill.items + moving).toLocaleString("en-US")}/${fill.max.toLocaleString("en-US")} items after this.${skip}`, short: false, button: `Move ${plural(moving, "item")}` };
}

// ---------------------------------------------------------------- the result line
export const movingText = (n: number, dest: string, back: boolean): string => (back ? `Moving ${plural(n, "item")} back to where ${n === 1 ? "it" : "each one"} came from…` : `Moving ${plural(n, "item")} to ${dest}…`);
export function movedText(moved: number, dest: string, back: boolean, { noRoom = 0, failed = 0, stopped = false }: { noRoom?: number; failed?: number; stopped?: boolean } = {}): string {
  const head = stopped ? `Stopped. ${plural(moved, "item")} moved${back ? " back" : ` to ${dest}`}; the rest stay where they are.`
    : back ? `Moved ${plural(moved, "item")} back to where ${moved === 1 ? "it" : "each one"} came from.` : `Moved ${plural(moved, "item")} to ${dest}.`;
  return head + (noRoom && !stopped ? ` ${noRoom.toLocaleString("en-US")} didn't fit and stayed put.` : "") + (failed ? ` ${plural(failed, "item")} could not be moved.` : "");
}
// The moved items the next Organize run takes out again (POST /api/move/plan's `against`), as one sentence.
export function againstText(against: ReadonlyArray<{ target: number }>, nameOf: (serial: number) => string): string | null {
  const n = against.length;
  if (!n) return null;
  const targets = [...new Set(against.map((a) => a.target))];
  const where = targets.length === 1 ? `in ${nameOf(targets[0]!)}` : "in other containers";
  return `${n === 1 ? "1 of these goes" : `${n.toLocaleString("en-US")} of these go`} back on the next Organize run, because ${targets.length === 1 ? "a rule files" : "rules file"} ${n === 1 ? "it" : "them"} ${where}.`;
}
export const pinnedText = (n: number, dest: string): string => `Pinned in ${dest}. Organize will leave ${n === 1 ? "it" : "them"} there.`;
export function skippedText(names: readonly string[]): string | null {
  if (!names.length) return null;
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return `Skipped ${shown}: moved since, or a scan has caught up and Pack Rat no longer knows where ${names.length === 1 ? "it" : "they"} came from.`;
}
