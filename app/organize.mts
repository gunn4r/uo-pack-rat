// organize.mts — Organize's planner (issue #11): which item goes from which container to which, in which trip,
// and what does not fit. Pure and deterministic: the same inventory, setup and overlay give the same plan byte
// for byte, because every walk below runs in serial order. Nothing here reads or writes a file; the server
// (GET /api/organize/plan, POST /api/organize/trip) hands everything in.
import { matchesItem } from "./item-query.mts";
import { parseStamp } from "./scan-schema.mts";
import { CATCH_ALL_ID, type OrganizeConfig, type RuleMatch } from "./organize-config.mts";
import { TRASH_RE, type ContainerCapacity, type Inventory, type Item } from "./vault-lib.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";
import type { TripInput } from "./bridge-trip.mts";

export type WarningKind = "stale-container" | "missing-target" | "missing-label" | "unknown-capacity" | "old-scripts" | "blacklisted" | "no-position" | "not-ground";
export interface PlanWarning { kind: WarningKind; serial: number; detail: string }

// A container last scanned longer ago than this is warned about, and still planned: the bridge rechecks live
// state before every step.
export const STALE_MS = 7 * 864e5;
const bySerial = (a: number, b: number): number => a - b;
export const stampMs = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };

// A container and every container around it, innermost first: [container, parent, …, root]. Null when a link
// is missing from the fold or the chain runs past eight (the bridge opens at most eight containers).
export function ancestry(inv: Inventory, serial: number | null): number[] | null {
  const out: number[] = [];
  for (let cur: number | null = serial; cur != null;) {
    const c = inv.containers[cur];
    if (!c || out.length >= 8) return null;
    out.push(+c.serial);
    cur = c.parent ?? null;
  }
  return out.length ? out : null;
}

type Pos = { x: number; y: number; z: number; facet?: number | undefined };
// A position the bridge can walk to: whole tiles on the map (bridge.v1.schema.json's own bounds).
function posOk(p: Record<string, number> | null | undefined): boolean {
  return !!p && [p.x, p.y, p.z].every((v) => Number.isInteger(v)) && p.x! >= 0 && p.x! <= 7168 && p.y! >= 0 && p.y! <= 4096 && p.z! >= -128 && p.z! <= 127;
}
const posOf = (inv: Inventory, serial: number): Pos => inv.containers[serial]!.pos as unknown as Pos;

export interface ScopeOptions { now: number; blacklist?: number[] | undefined; seen?: Record<string, string> | undefined }
export interface Scope {
  roots: number[];          // labelled ground roots with a position: the only places items are taken from
  siteRoots: number[];      // those, plus the roots of labelled bags: every place a trip may go
  movable: number[];        // item serials that may move
  usable: Set<number>;      // labelled containers a put may go into
  warnings: PlanWarning[];
}

// Labels define the playing field (spec §1): items move only out of labelled ground roots, and only into
// labelled containers. Never out of or into a pinned or blacklisted container (or one inside one), never out
// of a bag the newest scan could not open (the fold keeps older contents there), never a bag or a trash container
// itself (scanners record a trash barrel as a plain item, since they never open one), and never into a container whose fill (or whose surroundings' fill) the scans do not state.
export function scopeOf(inv: Inventory, cfg: OrganizeConfig, { now, blacklist = [], seen = {} }: ScopeOptions): Scope {
  const black = new Set(blacklist);
  const pinned = new Set(Object.values(cfg.labels).filter((l) => l.pinned).map((l) => l.serial));
  const pinnedItems = new Set(cfg.pinnedItems);
  const targets = new Set([...cfg.rules.flatMap((r) => r.targets), ...(cfg.catchAll != null ? [cfg.catchAll] : [])]);
  const warnings: PlanWarning[] = [];
  const warn = (kind: WarningKind, serial: number, detail: string): void => { warnings.push({ kind, serial, detail }); };
  const roots = new Set<number>(), siteRoots = new Set<number>(), usable = new Set<number>();
  for (const serial of Object.values(cfg.labels).map((l) => l.serial).sort(bySerial)) {
    const c = inv.containers[serial];
    if (!c) { warn("missing-label", serial, seen[serial] ? `not seen since ${seen[serial]}` : "not in any scan"); continue; }
    const chain = ancestry(inv, serial);
    const root = chain ? inv.containers[chain.at(-1)!] : undefined;
    if (!chain || !root) continue;
    if (root.kind !== "ground") { warn("not-ground", serial, "only containers on the ground can be organized"); continue; }
    if (chain.some((s) => black.has(s))) { warn("blacklisted", serial, "it is blacklisted: nothing is taken out of it or put into it"); continue; }
    if (!posOk(root.pos)) { warn("no-position", +root.serial, "its scan has no position, so the bridge cannot walk to it"); continue; }
    if (now - stampMs(c.scannedAt) > STALE_MS) warn("stale-container", serial, `last scanned ${c.scannedAt}`);
    siteRoots.add(+root.serial);
    if (+root.serial === serial) roots.add(serial);
    if (chain.some((s) => pinned.has(s))) continue;
    const unknown = chain.find((s) => !inv.containers[s]!.capacity);
    if (unknown == null) { usable.add(serial); continue; }
    if (!targets.has(serial)) continue;
    const u = inv.containers[unknown]!;
    if (u.parent == null && !u.tooltip?.length) warn("old-scripts", unknown, "rescan with TazUO scripts 2.9.0, Razor Enhanced 1.9.0 or the ClassicUO web scanner 1.3.0 or later to read how full it is");
    else warn("unknown-capacity", unknown, "its tooltip has no Contents line, so nothing is put into it");
  }
  const movable = Object.values(inv.items).filter((it) => {
    if (it.root == null || !roots.has(+it.root) || it.equippedBy || it.kind === "container" || inv.containers[it.serial] || TRASH_RE.test(it.name) || pinnedItems.has(+it.serial)) return false;
    const chain = ancestry(inv, it.container);
    return !!chain && chain.at(-1) === +it.root && !chain.some((s) => pinned.has(s) || black.has(s) || inv.containers[s]!.opened === false);
  }).map((it) => +it.serial).sort(bySerial);
  return { roots: [...roots].sort(bySerial), siteRoots: [...siteRoots].sort(bySerial), movable, usable, warnings };
}

const STACK_COUNT = /^\d[\d,]*\s+/;
// An item's name without its stack count ("75 Grave Dust" → "grave dust"), lower-cased: what rule names and
// stack merges compare.
export const baseName = (name: string): string => name.replace(STACK_COUNT, "").trim().toLowerCase();

// A rule's filter: the item query (location-free, item-query.mts's matchesItem) and, when given, any of the names.
export function ruleMatches(it: Item, m: RuleMatch, rarity: RulesV1RarityItem[] = []): boolean {
  const names = m.names ?? [];
  if (names.length) {
    const n = baseName(it.name);
    if (!names.some((w) => n.includes(w.trim().toLowerCase()))) return false;
  }
  return matchesItem(it, m.query, { rarity });
}

// What a rule filter would take if it were the only rule (the rule editor's live count, POST
// /api/organize/match): the movable items in labelled roots it matches, their pieces (stack amounts) and up to
// five of their names, stack counts stripped, distinct and in name order.
export function matchCount(inv: Inventory, cfg: OrganizeConfig, m: RuleMatch, opts: ScopeOptions & { rarity?: RulesV1RarityItem[] | undefined }): { count: number; pieces: number; sample: string[] } {
  const hits = scopeOf(inv, cfg, opts).movable.map((s) => inv.items[s]!).filter((it) => ruleMatches(it, m, opts.rarity));
  const names = [...new Set(hits.map((it) => it.name.replace(STACK_COUNT, "").trim()))].sort((a, b) => a.localeCompare(b, "en"));
  return { count: hits.length, pieces: hits.reduce((n, it) => n + (it.amount ?? 1), 0), sample: names.slice(0, 5) };
}

export interface Claim { ruleId: string; alsoMatched: string[] }
// First match wins (spec §1): the first rule whose filter passes claims the item and the others that pass are
// only recorded. An item no rule claims goes to the catch-all, or stays put (null) when there is none.
export function claimOf(it: Item, cfg: OrganizeConfig, rarity: RulesV1RarityItem[] = []): Claim | null {
  const hits = cfg.rules.filter((r) => ruleMatches(it, r.match, rarity)).map((r) => r.id);
  if (hits.length) return { ruleId: hits[0]!, alsoMatched: hits.slice(1) };
  return cfg.catchAll != null ? { ruleId: CATCH_ALL_ID, alsoMatched: [] } : null;
}

// One confirmed step of a trip, from the results overlay (organize-state.json, app/organize-state.mts): the item
// left `from` and is now in `to`, or in the backpack of the character that ran the trip when `to` is null (taken,
// not yet put). `at` is the bridge's clock when the trip reported back.
export interface OverlayMove { serial: number; name: string; from: number | null; to: number | null; at: string; trip: string }
export interface Carried { serial: number; name: string }
// The inventory as the overlay says it stands: moved items re-homed, and every container's fill (a copy of its
// Contents line) adjusted for the steps it does not yet include.
export interface Placed { inv: Inventory; counts: Map<number, ContainerCapacity>; carried: Carried[] }

// Spec §2.2: confirmed moves are applied before planning, so a finished trip is not planned again before the next
// scan. A step the item's own scan has seen since is over; a container's line read after the step already counts it.
export function applyOverlay(inv: Inventory, overlay: OverlayMove[]): Placed {
  const items: Record<string, Item> = Object.assign(Object.create(null) as Record<string, Item>, inv.items);
  const counts = new Map<number, ContainerCapacity>();
  for (const c of Object.values(inv.containers)) if (c.capacity) counts.set(+c.serial, { ...c.capacity });
  const carried: Carried[] = [];
  const bump = (serial: number | null, at: number, d: number, w: number): void => {
    for (const s of ancestry(inv, serial) ?? []) {
      const cap = counts.get(s);
      if (!cap || stampMs(inv.containers[s]!.scannedAt) >= at) continue;
      cap.items += d;
      if (cap.stones != null) cap.stones += d * w;
    }
  };
  for (const m of [...overlay].sort((a, b) => a.serial - b.serial)) {
    const at = stampMs(m.at);
    const it = items[m.serial];
    if (it && stampMs(it.seenAt) >= at) continue;
    const w = it?.weight ?? 1;
    if (it) bump(it.container, at, -1, w);
    if (m.to != null) bump(m.to, at, 1, w);
    else carried.push({ serial: m.serial, name: m.name });
    if (!it) continue;
    const chain = m.to == null ? null : ancestry(inv, m.to);
    items[m.serial] = { ...it, container: chain ? m.to : null, root: chain ? chain.at(-1)! : null };
  }
  return { inv: { ...inv, items }, counts, carried };
}

// Spec §2.4: the container an item already counts as filed in — the nearest one above it that is any rule's
// target (or the catch-all). An item in a bag that is itself a target belongs to that bag, not to its chest.
export function homeOf(inv: Inventory, it: Item, homes: Set<number>): number | null {
  for (const s of ancestry(inv, it.container) ?? []) if (homes.has(s)) return s;
  return null;
}

// Spec §2.6, capacity by simulation: every container's fill as the trips will find it, changed take by take and
// put by put, with an undo log so a trip that does not work out can be taken back. A take frees one slot in its
// container and every container around it; a put uses one in the target and every container around it, unless it
// merges into a stack: a same name + hue + graphic item already in that exact container, where either side is a
// stack (amount > 1) and the sum stays within MAX_STACK. Weight is checked only where a container has a stone cap.
export const MAX_STACK = 60000;
interface Stack { key: string; amount: number }
export interface Sim { inv: Inventory; counts: Map<number, ContainerCapacity>; stacks: Map<number, Map<number, Stack>>; undo: (() => void)[] }
export interface PutResult { to: number; merged: boolean }

const stackKey = (it: Item): string => `${baseName(it.name)}\u0000${it.hue ?? 0}\u0000${it.graphic ?? 0}`;
// Scans record no weight for some items; one stone is the planner's guess, for the trip budget and stone caps alike.
export const weightOf = (it: Item): number => it.weight ?? 1;

export function newSim(inv: Inventory, counts: Map<number, ContainerCapacity>): Sim {
  const stacks = new Map<number, Map<number, Stack>>();
  for (const it of Object.values(inv.items).sort((a, b) => a.serial - b.serial)) {
    if (it.container == null || inv.containers[it.serial]) continue;
    const here = stacks.get(+it.container) ?? new Map<number, Stack>();
    here.set(+it.serial, { key: stackKey(it), amount: it.amount || 1 });
    stacks.set(+it.container, here);
  }
  return { inv, counts, stacks, undo: [] };
}
export const mark = (sim: Sim): number => sim.undo.length;
export function rollback(sim: Sim, to: number): void { while (sim.undo.length > to) sim.undo.pop()!(); }

function adjust(sim: Sim, container: number, items: number, stones: number): void {
  for (const s of ancestry(sim.inv, container) ?? []) {
    const cap = sim.counts.get(s);
    if (!cap) continue;
    cap.items += items;
    if (cap.stones != null) cap.stones += stones;
    sim.undo.push(() => { cap.items -= items; if (cap.stones != null) cap.stones -= stones; });
  }
}

// An item carried in the backpack (container null) is taken already: nothing to free.
export function simTake(sim: Sim, it: Item): void {
  if (it.container == null) return;
  const from = +it.container;
  adjust(sim, from, -1, -weightOf(it));
  const here = sim.stacks.get(from), mine = here?.get(+it.serial);
  if (here && mine) { here.delete(+it.serial); sim.undo.push(() => { here.set(+it.serial, mine); }); }
}

function fits(sim: Sim, target: number, items: number, stones: number): boolean {
  const chain = ancestry(sim.inv, target);
  return !!chain && chain.every((s) => {
    const cap = sim.counts.get(s);
    return !!cap && cap.items + items <= cap.maxItems && (cap.maxStones == null || (cap.stones ?? 0) + stones <= cap.maxStones);
  });
}

// `movers` are items still waiting for their own move: merging into one would count on a stack that may be gone
// by the time the put runs.
function mergeInto(sim: Sim, target: number, it: Item, movers: Set<number>): number | null {
  const here = sim.stacks.get(target);
  if (!here) return null;
  const key = stackKey(it), amount = it.amount || 1;
  for (const serial of [...here.keys()].sort(bySerial)) {
    const s = here.get(serial)!;
    if (!movers.has(serial) && s.key === key && (amount > 1 || s.amount > 1) && s.amount + amount <= MAX_STACK) return serial;
  }
  return null;
}

// Tries the chain's targets in fill order and puts the item in the first with room. Null when none has any.
export function simPut(sim: Sim, it: Item, chain: number[], movers: Set<number>): PutResult | null {
  const w = weightOf(it), amount = it.amount || 1;
  for (const target of chain) {
    const into = mergeInto(sim, target, it, movers);
    if (!fits(sim, target, into == null ? 1 : 0, w)) continue;
    adjust(sim, target, into == null ? 1 : 0, w);
    const here = sim.stacks.get(target) ?? new Map<number, Stack>();
    sim.stacks.set(target, here);
    if (into != null) {
      const s = here.get(into)!;
      s.amount += amount;
      sim.undo.push(() => { s.amount -= amount; });
    } else {
      here.set(+it.serial, { key: stackKey(it), amount });
      sim.undo.push(() => { here.delete(+it.serial); });
    }
    return { to: target, merged: into != null };
  }
  return null;
}

// Spec §2.5: labelled roots are grouped into sites — same facet (a root whose facet is unknown groups only with
// others whose facet is unknown) and single-link within SITE_TILES, the bridge's walk limit. A move never crosses
// sites. Each site's roots ascending, sites ordered by their lowest serial.
export const SITE_TILES = 24;
const tiles = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export function sitesOf(inv: Inventory, roots: number[]): number[][] {
  const list = [...new Set(roots)].sort(bySerial);
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = posOf(inv, list[i]!), b = posOf(inv, list[j]!);
      if ((a.facet ?? -1) === (b.facet ?? -1) && tiles(a, b) <= SITE_TILES) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  list.forEach((s, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), s]); });
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

// Stops in nearest-neighbour order from `from` (the lowest serial first when there is no starting point).
function nearestOrder(inv: Inventory, roots: number[], from: Pos | null): number[] {
  const left = [...new Set(roots)].sort(bySerial);
  const out: number[] = [];
  let here = from;
  while (left.length) {
    let best = 0;
    if (here) for (let i = 1; i < left.length; i++) if (tiles(here, posOf(inv, left[i]!)) < tiles(here, posOf(inv, left[best]!))) best = i;
    const [next] = left.splice(best, 1);
    out.push(next!);
    here = posOf(inv, next!);
  }
  return out;
}

export interface TripStep { serial: number; name: string; from: number | null; to: number }
// The trip command for app/bridge-trip.mts's queueTrip: takes first, ordered by nearest stop from the lowest-serial
// root; then puts, by nearest stop from the last take. Chains and destinations run root first. Null when a
// container on the way is missing from the fold or nested past eight.
export function tripInputFrom(inv: Inventory, index: number, stamp: string, steps: TripStep[]): TripInput | null {
  const takes = new Map<number, number[]>(), puts = new Map<number, number[]>();
  for (const s of steps) {
    if (s.from != null) {
      const chain = ancestry(inv, s.from);
      if (!chain) return null;
      takes.set(s.serial, chain.reverse());
    }
    const dest = ancestry(inv, s.to);
    if (!dest) return null;
    puts.set(s.serial, dest.reverse());
  }
  const takeStops = nearestOrder(inv, [...takes.values()].map((c) => c[0]!), null);
  const last = takeStops.at(-1);
  const putStops = nearestOrder(inv, [...puts.values()].map((c) => c[0]!), last == null ? null : posOf(inv, last));
  const ordered = (stops: number[], paths: Map<number, number[]>): number[] =>
    [...paths.keys()].sort((a, b) => stops.indexOf(paths.get(a)![0]!) - stops.indexOf(paths.get(b)![0]!) || a - b);
  const name = new Map(steps.map((s) => [s.serial, s.name.slice(0, 40)]));
  const roots: TripInput["roots"] = {};
  for (const r of [...takeStops, ...putStops]) {
    const p = posOf(inv, r);
    roots[String(r)] = { x: p.x, y: p.y, z: p.z, ...(p.facet != null ? { facet: p.facet } : {}) } as TripInput["roots"][string];
  }
  return {
    index, stamp, roots,
    takes: ordered(takeStops, takes).map((serial) => ({ serial, name: name.get(serial)!, chain: takes.get(serial)! })),
    puts: ordered(putStops, puts).map((serial) => ({ serial, name: name.get(serial)!, dest: puts.get(serial)! })),
  };
}

// The bytes the queued line will take (queueTrip adds an id, the action and queuedAt; the stamp is counted at its
// longest), so a planned trip is never refused as over the bridge's line limit.
const ENCODER = new TextEncoder();
export function lineBytes(input: TripInput): number {
  const line = { id: "00000000-0000-0000-0000-000000000000", action: "trip", index: input.index, stamp: "x".repeat(64), queuedAt: "2026-01-01T00:00:00.000Z", roots: input.roots, takes: input.takes, puts: input.puts };
  return ENCODER.encode(JSON.stringify(line)).length;
}

export interface PlanMove { serial: number; name: string; amount: number; from: number | null; to: number; ruleId: string; alsoMatched: string[]; trip: number }
export interface PlanTrip { index: number; site: number; takes: number[]; puts: number[] }
export interface RuleReport { ruleId: string; matched: number; inPlace: number; toMove: number; noRoom: number }
export interface RoomReport { ruleId: string; needSlots: number; freeSlots: number; shortfall: number }
export interface Plan {
  inventoryStamp: string;
  stamp: string;
  sites: { index: number; roots: number[] }[];
  moves: PlanMove[];
  trips: PlanTrip[];
  rules: RuleReport[];
  room: RoomReport[];
  crossSite: { ruleId: string; count: number }[];
  warnings: PlanWarning[];
  carried: Carried[];
  unclaimed: number;
}
export interface PlanOptions extends ScopeOptions {
  rarity?: RulesV1RarityItem[] | undefined;
  tripItems?: number | undefined;
  tripStones?: number | undefined;
  tripBytes?: number | undefined;
}
// tripStones is conservative: scans record no carry weight. tripBytes stays under the bridge's 16 KB line limit.
export const TRIP_DEFAULTS = { items: 20, stones: 150, bytes: 12 * 1024 } as const;

interface Want { it: Item; ruleId: string; alsoMatched: string[]; chain: number[]; from: number | null }
interface Limits { items: number; stones: number; bytes: number }
type Attempt = { ok: true; placed: Map<number, PutResult> } | { ok: false; failed: Set<number> };

// Every take, then every put, as the bridge runs a trip: a chest that is both source and target frees its room
// before anything is put in. Leaves the simulation changed on success and as it found it on failure.
function attempt(sim: Sim, set: Want[], movers: Set<number>): Attempt {
  const start = mark(sim);
  for (const w of set) simTake(sim, w.it);
  const placed = new Map<number, PutResult>(), failed = new Set<number>();
  for (const w of set) {
    const r = simPut(sim, w.it, w.chain, movers);
    if (r) placed.set(+w.it.serial, r); else failed.add(+w.it.serial);
  }
  if (!failed.size) return { ok: true, placed };
  rollback(sim, start);
  return { ok: false, failed };
}
const stepsOf = (set: Want[], placed: Map<number, PutResult>): TripStep[] =>
  set.map((w) => ({ serial: +w.it.serial, name: w.it.name, from: w.from, to: placed.get(+w.it.serial)!.to }));

// Spec §2.7: one site's trips, in order. Each trip takes the next items that fit the item and stone budget,
// drops any whose put has no room (and, one at a time from the end, any past the byte budget) until the rest work
// together, and commits them; an item that fits nowhere is retried after the next trip frees room, and is no
// room once nothing more can move.
function packSite(inv: Inventory, sim: Sim, site: number, wants: Want[], lim: Limits, firstIndex: number): { trips: PlanTrip[]; moves: PlanMove[]; merged: Set<number>; noRoom: Want[] } {
  let pending = wants;
  const movers = new Set(wants.map((w) => +w.it.serial));
  const blocked = new Set<number>();
  const trips: PlanTrip[] = [], moves: PlanMove[] = [], merged = new Set<number>();
  for (;;) {
    const window: Want[] = [];
    let stones = 0;
    for (const w of pending) {
      if (window.length >= lim.items) break;
      if (blocked.has(+w.it.serial) || (window.length && stones + weightOf(w.it) > lim.stones)) continue;
      window.push(w);
      stones += weightOf(w.it);
    }
    if (!window.length) break;
    const index = firstIndex + trips.length;
    let set = window;
    let done: { placed: Map<number, PutResult>; input: TripInput } | null = null;
    while (set.length) {
      const start = mark(sim);
      const r = attempt(sim, set, movers);
      if (!r.ok) { set = set.filter((w) => !r.failed.has(+w.it.serial)); continue; }
      const input = tripInputFrom(inv, index, "", stepsOf(set, r.placed));
      if (input && lineBytes(input) <= lim.bytes) { done = { placed: r.placed, input }; break; }
      rollback(sim, start);
      set = set.slice(0, -1);
    }
    if (!done) { for (const w of window) blocked.add(+w.it.serial); continue; }
    const { placed, input } = done;
    sim.undo.length = 0;
    trips.push({ index, site, takes: input.takes.map((t) => t.serial), puts: input.puts.map((p) => p.serial) });
    for (const w of set) {
      const p = placed.get(+w.it.serial)!;
      movers.delete(+w.it.serial);
      if (p.merged) merged.add(+w.it.serial);
      moves.push({ serial: +w.it.serial, name: w.it.name, amount: w.it.amount || 1, from: w.from, to: p.to, ruleId: w.ruleId, alsoMatched: w.alsoMatched, trip: index });
    }
    blocked.clear();
    pending = pending.filter((w) => !placed.has(+w.it.serial));
  }
  return { trips, moves, merged, noRoom: pending };
}

// The plan's identity: FNV-1a over the latest scan time and every move. Anything that changes a trip changes it.
function planStamp(inventoryStamp: string, moves: PlanMove[]): string {
  const s = JSON.stringify([inventoryStamp, moves.map((m) => [m.serial, m.from, m.to, m.trip])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function planOrganize(inv: Inventory, cfg: OrganizeConfig, overlay: OverlayMove[], opts: PlanOptions): Plan {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));
  const lim: Limits = {
    items: clamp(opts.tripItems ?? TRIP_DEFAULTS.items, 1, 20),
    stones: Math.max(1, opts.tripStones ?? TRIP_DEFAULTS.stones),
    bytes: clamp(opts.tripBytes ?? TRIP_DEFAULTS.bytes, 1024, 16384),
  };
  const placed = applyOverlay(inv, overlay);
  const view = placed.inv;
  const scope = scopeOf(view, cfg, opts);
  const warnings = [...scope.warnings];
  const rarity = opts.rarity ?? [];
  const chains = new Map<string, number[]>(cfg.rules.map((r) => [r.id, r.targets]));
  if (cfg.catchAll != null) chains.set(CATCH_ALL_ID, [cfg.catchAll]);
  const ids = [...chains.keys()];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const nameOf = (id: string): string => (id === CATCH_ALL_ID ? "The catch-all" : `Rule "${cfg.rules.find((r) => r.id === id)!.name}"`);
  const blocked = new Set<string>();
  for (const [id, targets] of chains) {
    for (const t of targets) {
      if (view.containers[t]) continue;
      blocked.add(id);
      warnings.push({ kind: "missing-target", serial: t, detail: `${nameOf(id)} names a container no scan has seen, so it moves nothing` });
    }
  }
  const homes = new Set([...chains.values()].flat());
  const report = new Map(ids.map((id) => [id, { ruleId: id, matched: 0, inPlace: 0, toMove: 0, noRoom: 0 }]));
  const cross = new Map<string, number>();
  const groups = sitesOf(view, scope.siteRoots);
  const siteOfRoot = new Map<number, number>();
  groups.forEach((g, i) => { for (const r of g) siteOfRoot.set(r, i); });
  const siteOf = (serial: number): number | undefined => { const ch = ancestry(view, serial); return ch ? siteOfRoot.get(ch.at(-1)!) : undefined; };
  const carried = new Set(placed.carried.map((c) => c.serial));
  const wants = new Map<number, Want[]>();
  let unclaimed = 0;
  // A carried item is put away unless it has been pinned since (the page's answer to a put the server refuses).
  const pinnedItems = new Set(cfg.pinnedItems);
  const candidates = [...new Set([...scope.movable, ...[...carried].filter((s) => view.items[s] && !pinnedItems.has(s))])].sort(bySerial);
  for (const serial of candidates) {
    const it = view.items[serial]!;
    const claim = claimOf(it, cfg, rarity);
    if (!claim) { unclaimed++; continue; }
    const rep = report.get(claim.ruleId)!;
    rep.matched++;
    const targets = chains.get(claim.ruleId)!;
    const inPack = carried.has(serial);
    if (!inPack) {
      const home = homeOf(view, it, homes);
      if (home != null && targets.includes(home)) { rep.inPlace++; continue; }
    }
    if (blocked.has(claim.ruleId)) continue;
    const usable = targets.filter((t) => scope.usable.has(t));
    if (!usable.length) continue;
    const site = inPack ? siteOf(usable[0]!) : siteOfRoot.get(+it.root!);
    const chain = site === undefined ? [] : usable.filter((t) => siteOf(t) === site);
    if (!chain.length) { cross.set(claim.ruleId, (cross.get(claim.ruleId) ?? 0) + 1); continue; }
    wants.set(site!, [...(wants.get(site!) ?? []), { it, ...claim, chain, from: inPack ? null : +it.container! }]);
  }
  const freeAtStart = new Map([...placed.counts].map(([s, c]) => [s, c.maxItems - c.items]));
  // How many more items a chain takes before any move: each target in turn takes what it and every container
  // around it still have room for, so a bag and the chest it sits in are not counted twice.
  const freeIn = (chain: number[]): number => {
    const left = new Map(freeAtStart);
    let n = 0;
    for (const t of chain) {
      const around = ancestry(view, t) ?? [];
      const room = around.length ? Math.max(0, Math.min(...around.map((s) => left.get(s) ?? 0))) : 0;
      for (const s of around) left.set(s, (left.get(s) ?? 0) - room);
      n += room;
    }
    return n;
  };
  const sim = newSim(view, placed.counts);
  const moves: PlanMove[] = [], trips: PlanTrip[] = [], merged = new Set<number>();
  for (const site of [...wants.keys()].sort(bySerial)) {
    // Carried items first (they are already in the pack), then the rules take turns, each in serial order: a trip
    // that takes for several rules at once frees room in each other's chests (two full chests trading contents),
    // where a trip of one rule's items alone could not start.
    const sorted = wants.get(site)!.sort((a, b) => rank.get(a.ruleId)! - rank.get(b.ruleId)! || a.it.serial - b.it.serial);
    const turns = new Map<string, Want[]>();
    for (const w of sorted) if (w.from != null) turns.set(w.ruleId, [...(turns.get(w.ruleId) ?? []), w]);
    const list = sorted.filter((w) => w.from == null);
    for (let i = 0; list.length < sorted.length; i++) for (const g of turns.values()) if (g[i]) list.push(g[i]!);
    const packed = packSite(view, sim, site, list, lim, trips.length + 1);
    trips.push(...packed.trips);
    moves.push(...packed.moves);
    for (const s of packed.merged) merged.add(s);
    for (const w of packed.noRoom) report.get(w.ruleId)!.noRoom++;
  }
  for (const m of moves) report.get(m.ruleId)!.toMove++;
  const room = ids.map((id) => {
    const r = report.get(id)!;
    const needSlots = moves.filter((m) => m.ruleId === id && !merged.has(m.serial)).length + r.noRoom;
    const freeSlots = freeIn(chains.get(id)!.filter((t) => scope.usable.has(t)));
    return { ruleId: id, needSlots, freeSlots, shortfall: r.noRoom };
  });
  const inventoryStamp = inv.scans.reduce((best, s) => (stampMs(s.scannedAt) > stampMs(best) ? s.scannedAt : best), "");
  const seenWarning = new Set<string>();
  return {
    inventoryStamp,
    stamp: planStamp(inventoryStamp, moves),
    sites: groups.map((roots, index) => ({ index, roots })),
    moves,
    trips,
    rules: ids.map((id) => report.get(id)!),
    room,
    crossSite: ids.filter((id) => cross.has(id)).map((id) => ({ ruleId: id, count: cross.get(id)! })),
    warnings: warnings.filter((w) => { const k = `${w.kind}:${w.serial}`; if (seenWarning.has(k)) return false; seenWarning.add(k); return true; })
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.serial - b.serial)),
    carried: [...placed.carried].sort((a, b) => a.serial - b.serial),
    unclaimed,
  };
}

// The queue-ready trip for POST /api/organize/trip, built from the current plan's moves exactly as the plan built
// it. Null when the plan has no such trip.
export function tripCommand(inv: Inventory, plan: Plan, index: number): TripInput | null {
  const steps = plan.moves.filter((m) => m.trip === index);
  return steps.length ? tripInputFrom(inv, index, plan.stamp, steps) : null;
}
