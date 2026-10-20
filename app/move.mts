// move.mts — Move to (issue #270): items the player selected in the Inventory put into one container they picked, or each put back where a Move took it from, planned as Organize trips (organize.mts's packSite) so the bridge runs them as it runs Organize's. Pure and deterministic, like the Organize planner: the server hands everything in.
//
// map: organize
// owns: `resolveSelection`, `destProblem`, `planMoves`, `backSteps`, `againstRules`, `Selection`
import { applyItemQuery, parseItemQuery } from "./item-query.mts";
import { ancestry, applyOverlay, claimOf, inventoryStampOf, newSim, packSite, planStamp, posOk, scopeOf, sitesOf, TRIP_DEFAULTS, type OverlayMove, type ScopeOptions, type Want } from "./organize.mts";
import { CATCH_ALL_ID, type OrganizeConfig } from "./organize-config.mts";
import { bagLabel, labelledPlaces, TRASH_RE, type Inventory, type Item } from "./vault-lib.mts";
import type { PlanMove, PlanTrip } from "./organize-types.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";

// What the page selected: these serials, and every item matching an Inventory query (its query string) but the ones it unticked.
export interface Selection { serials?: number[] | undefined; query?: string | undefined; except?: number[] | undefined }
export const MAX_SELECTION = 10000;

// The selected items the scans still have, in serial order. `labels` are Organize's, which the query's free text also matches;
// `houseOf` names the house each ground container stands in, for a query's house filter.
export function resolveSelection(inv: Inventory, sel: Selection, rarity: RulesV1RarityItem[] = [], labels: OrganizeConfig["labels"] = {}, houseOf: ReadonlyMap<number, string> = new Map()): Item[] {
  const out = new Map<number, Item>();
  for (const s of sel.serials ?? []) { const it = inv.items[s]; if (it) out.set(+it.serial, it); }
  if (sel.query != null) {
    const except = new Set(sel.except ?? []);
    const q = { ...parseItemQuery(new URLSearchParams(sel.query)), group: false, offset: 0, limit: Number.MAX_SAFE_INTEGER };
    for (const it of (applyItemQuery(Object.values(inv.items), q, { rarity, places: labelledPlaces(inv.containers, labels), houseOf, containers: inv.containers }) as { rows: Item[] }).rows) if (!except.has(+it.serial)) out.set(+it.serial, it);
  }
  return [...out.values()].sort((a, b) => a.serial - b.serial);
}

// Why a container cannot be filled by a trip, or null when it can: the bridge puts only into a container on the ground with a known place, never into a blacklisted or trash one, and the planner only into one whose fill (and its surroundings') it knows.
export function destProblem(inv: Inventory, to: number, blacklist: readonly number[] = []): string | null {
  const c = inv.containers[to];
  if (!c) return "that container is in no scan";
  const chain = ancestry(inv, to), root = chain ? inv.containers[chain.at(-1)!] : undefined;
  if (!chain || !root) return "that container's place is not known";
  if (root.kind !== "ground") return "only a container on the ground can be filled";
  if (!posOk(root.pos)) return "its scan has no position, so the bridge cannot walk to it";
  const black = new Set(blacklist);
  if (chain.some((s) => black.has(s))) return "it is blacklisted";
  if (chain.some((s) => TRASH_RE.test(bagLabel(inv.containers[s]!)))) return "it is a trash container";
  if (chain.some((s) => !inv.containers[s]!.capacity || inv.containers[s]!.opened === false)) return "its fill is not known: rescan it";
  return null;
}

// One item's move: where it goes.
export interface MoveStep { serial: number; to: number }
// Why a selected item is left where it is: no longer scanned, worn, not in a container on the ground (a backpack, a bank, carried), itself a container, in a container the bridge cannot reach (blacklisted, unopened, no position) or whose destination it cannot fill, or in another house than its destination.
export type LeftReason = "gone" | "worn" | "pack" | "bag" | "unreachable" | "site";
export interface MovePlan {
  stamp: string;
  moves: PlanMove[];
  trips: PlanTrip[];
  already: number[];     // in their destination already
  noRoom: number[];      // no room left for them
  left: Array<{ serial: number; name: string; why: LeftReason }>;
}

// Why a trip cannot take this item (`inv` with the overlay applied), or null when it can. Whether it is in its destination's house is planMoves' to say.
export function leftReason(inv: Inventory, it: Item | undefined, black: ReadonlySet<number>): Exclude<LeftReason, "site"> | null {
  if (!it) return "gone";
  if (it.equippedBy) return "worn";
  if (inv.containers[it.serial] || it.kind === "container" || TRASH_RE.test(it.name)) return "bag";
  const root = it.root == null ? undefined : inv.containers[it.root];
  if (!root || root.kind !== "ground" || it.container == null) return "pack";
  const chain = ancestry(inv, it.container);
  if (!chain || chain.at(-1) !== +it.root! || !posOk(root.pos) || chain.some((s) => black.has(s) || inv.containers[s]!.opened === false)) return "unreachable";
  return null;
}

// The trips that carry out `steps`, Organize's way: takes then puts, at most a trip's items, stones and bytes each, never across houses, with the destination's room simulated take by take and put by put. `inv` is the fold; the overlay is applied here.
export function planMoves(inv: Inventory, overlay: OverlayMove[], steps: MoveStep[], { blacklist = [] }: { blacklist?: readonly number[] } = {}): MovePlan {
  const placed = applyOverlay(inv, overlay), view = placed.inv;
  const black = new Set(blacklist);
  const left: MovePlan["left"] = [], already: number[] = [];
  const roots = new Map<number, number | null>();
  const rootOf = (to: number): number | null => {
    if (!roots.has(to)) roots.set(to, destProblem(view, to, blacklist) ? null : ancestry(view, to)!.at(-1)!);
    return roots.get(to)!;
  };
  const ok: Array<{ it: Item; to: number; root: number; dest: number }> = [];
  const seen = new Set<number>();
  for (const { serial, to } of [...steps].sort((a, b) => a.serial - b.serial)) {
    if (seen.has(serial)) continue;
    seen.add(serial);
    const it = view.items[serial];
    const why = leftReason(view, it, black);
    if (why) { left.push({ serial, name: it?.name ?? `0x${serial.toString(16)}`, why }); continue; }
    if (+it!.container! === to) { already.push(serial); continue; }
    const dest = rootOf(to);
    if (dest == null) { left.push({ serial, name: it!.name, why: "unreachable" }); continue; }
    ok.push({ it: it!, to, root: +it!.root!, dest });
  }
  const groups = sitesOf(view, ok.flatMap((o) => [o.root, o.dest]));
  const siteOf = new Map<number, number>();
  groups.forEach((g, i) => { for (const r of g) siteOf.set(r, i); });
  const wants = new Map<number, Want[]>();
  for (const o of ok) {
    const site = siteOf.get(o.root)!;
    if (site !== siteOf.get(o.dest)) { left.push({ serial: +o.it.serial, name: o.it.name, why: "site" }); continue; }
    wants.set(site, [...(wants.get(site) ?? []), { it: o.it, ruleId: "move", alsoMatched: [], chain: [o.to], from: +o.it.container! }]);
  }
  const sim = newSim(view, placed.counts);
  const moves: PlanMove[] = [], trips: PlanTrip[] = [], noRoom: number[] = [];
  for (const site of [...wants.keys()].sort((a, b) => a - b)) {
    const packed = packSite(view, sim, site, wants.get(site)!, TRIP_DEFAULTS, trips.length + 1);
    trips.push(...packed.trips);
    moves.push(...packed.moves);
    noRoom.push(...packed.noRoom.map((w) => +w.it.serial));
  }
  return { stamp: planStamp(inventoryStampOf(inv), moves), moves, trips, already, noRoom: noRoom.sort((a, b) => a - b), left: left.sort((a, b) => a.serial - b.serial) };
}

// Move back: each item to the container the overlay says a Move took it from (`from` of its last confirmed step), while that step is one of the Move's trips and the item is still where it put it. Anything else has moved since, or a scan has caught up and the overlay no longer knows its source: it is skipped.
export function backSteps(inv: Inventory, overlay: OverlayMove[], serials: readonly number[], trips: readonly string[]): { steps: MoveStep[]; skipped: Array<{ serial: number; name: string }> } {
  const view = applyOverlay(inv, overlay).inv;
  const last = new Map(overlay.map((m) => [m.serial, m]));
  const ids = new Set(trips);
  const steps: MoveStep[] = [], skipped: Array<{ serial: number; name: string }> = [];
  for (const serial of [...new Set(serials)].sort((a, b) => a - b)) {
    const m = last.get(serial), it = view.items[serial];
    if (m && it && ids.has(m.trip) && m.from != null && m.to != null && it.container != null && +it.container === m.to) steps.push({ serial, to: m.from });
    else skipped.push({ serial, name: it?.name ?? m?.name ?? `0x${serial.toString(16)}` });
  }
  return { steps, skipped };
}

// The moved items the next Organize run would take out of `to` again: `to` is in a labeled container on the ground that is not pinned, and a rule (or the catch-all) claims the item for another container. `target` is the first container that rule files into. Items Organize leaves alone (pinned items) are not listed.
export function againstRules(inv: Inventory, cfg: OrganizeConfig, serials: readonly number[], to: number, opts: ScopeOptions & { rarity?: RulesV1RarityItem[] | undefined; suitPieces?: ReadonlySet<number> | undefined }): Array<{ serial: number; name: string; target: number }> {
  const chain = ancestry(inv, to);
  const pinned = new Set(Object.values(cfg.labels).filter((l) => l.pinned).map((l) => l.serial));
  if (!chain || !scopeOf(inv, cfg, opts).roots.includes(chain.at(-1)!) || chain.some((s) => pinned.has(s))) return [];
  const homes = new Set([...cfg.rules.flatMap((r) => r.targets), ...(cfg.catchAll != null ? [cfg.catchAll] : [])]);
  const home = chain.find((s) => homes.has(s));
  const pinnedItems = new Set(cfg.pinnedItems);
  const out: Array<{ serial: number; name: string; target: number }> = [];
  for (const serial of serials) {
    const it = inv.items[serial];
    const claim = it && !pinnedItems.has(serial) ? claimOf(it, cfg, opts.rarity, opts.suitPieces) : null;
    if (!claim) continue;
    const targets = claim.ruleId === CATCH_ALL_ID ? [cfg.catchAll!] : cfg.rules.find((r) => r.id === claim.ruleId)!.targets;
    if (!targets.length || (home != null && targets.includes(home))) continue;
    out.push({ serial, name: it!.name, target: targets[0]! });
  }
  return out;
}
