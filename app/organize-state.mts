// organize-state.mts — Organize's results overlay (issue #11), <data>/organize-state.json: the trips the server
// queued and has not yet heard back about (`pending`), the bridge Grabs likewise (`grabs`, issue #148), every step
// the bridge confirmed (`moves`, which planOrganize applies so a finished trip is not planned again before the next
// scan), and when each labelled container was last in a scan (`seen`, for "not seen since"). Pure: the server reads
// the file, runs these and writes the result back. Everything read from the file or from the bridge's status.json
// is checked field by field: both are plain files any local process can write.
import { parseStamp } from "./scan-schema.mts";
import { stampMs, type OverlayMove } from "./organize.mts";
import type { Inventory } from "./vault-lib.mts";
import type { OrganizeConfig } from "./organize-config.mts";

export interface PendingStep { serial: number; name: string; from: number | null; to: number }
export interface PendingTrip { id: string; adapter: string; index: number; stamp: string; queuedAt: string; steps: PendingStep[] }
// A Grab queued through POST /api/bridge: the item and the container it lay in (the command chain's last link).
export interface PendingGrab { id: string; adapter: string; serial: number; name: string; from: number | null; queuedAt: string }
export interface OrganizeState { version: 1; pending: PendingTrip[]; grabs: PendingGrab[]; moves: OverlayMove[]; seen: Record<string, string> }
// What harvestTrips reads of one adapter's status.json: its results by command id, the id it is running now, and
// whose client it runs in (null when the file does not say).
export interface BridgeView { results: Record<string, unknown>; current: string | null; character?: string | null | undefined }

// The bridge refuses a command older than 60 s, so a trip nobody has picked up after this never will be.
export const PENDING_GRACE_MS = 90_000;
// An entry no scan has settled in a week is dropped: by then its containers are stale anyway.
export const OVERLAY_MAX_AGE_MS = 7 * 864e5;
const MAX_PENDING = 50, MAX_MOVES = 5000, MAX_SERIAL = 0xFFFFFFFF;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isSerial = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_SERIAL;
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && Number.isFinite(parseStamp(v));
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function emptyOrganizeState(): OrganizeState { return { version: 1, pending: [], grabs: [], moves: [], seen: {} }; }

function asStep(v: unknown): PendingStep | null {
  if (!isObj(v) || !isSerial(v.serial) || typeof v.name !== "string" || v.name.length > 200 || !(v.from === null || isSerial(v.from)) || !isSerial(v.to)) return null;
  return { serial: v.serial, name: v.name, from: v.from, to: v.to };
}
function asPending(v: unknown): PendingTrip | null {
  if (!isObj(v) || !isText(v.id, 64) || typeof v.adapter !== "string" || !/^[a-z0-9-]{1,64}$/.test(v.adapter) || !Number.isInteger(v.index)
    || (v.index as number) < 1 || (v.index as number) > 10000 || !isText(v.stamp, 64) || !isStamp(v.queuedAt) || !Array.isArray(v.steps) || v.steps.length > 60) return null;
  const steps = v.steps.map(asStep);
  return steps.every((s) => s) ? { id: v.id, adapter: v.adapter, index: v.index as number, stamp: v.stamp, queuedAt: v.queuedAt, steps: steps as PendingStep[] } : null;
}
function asGrab(v: unknown): PendingGrab | null {
  if (!isObj(v) || !isText(v.id, 64) || typeof v.adapter !== "string" || !/^[a-z0-9-]{1,64}$/.test(v.adapter) || !isSerial(v.serial)
    || typeof v.name !== "string" || v.name.length > 200 || !(v.from === null || isSerial(v.from)) || !isStamp(v.queuedAt)) return null;
  return { id: v.id, adapter: v.adapter, serial: v.serial, name: v.name, from: v.from, queuedAt: v.queuedAt };
}
function asMove(v: unknown): OverlayMove | null {
  if (!isObj(v) || !isSerial(v.serial) || typeof v.name !== "string" || v.name.length > 200 || !(v.from === null || isSerial(v.from))
    || !(v.to === null || isSerial(v.to)) || !isStamp(v.at) || !isText(v.trip, 64)) return null;
  return { serial: v.serial, name: v.name, from: v.from, to: v.to, at: v.at, trip: v.trip, ...(isText(v.character, 64) ? { character: v.character } : {}), ...(v.grab === true ? { grab: true as const } : {}) };
}
const present = <T,>(v: T | null): v is T => v !== null;

export function salvageOrganizeState(raw: unknown): OrganizeState {
  if (!isObj(raw) || raw.version !== 1) return emptyOrganizeState();
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).map(asPending).filter(present).slice(-MAX_PENDING);
  const grabs = (Array.isArray(raw.grabs) ? raw.grabs : []).map(asGrab).filter(present).slice(-MAX_PENDING);
  const moves = (Array.isArray(raw.moves) ? raw.moves : []).map(asMove).filter(present).slice(-MAX_MOVES);
  const seen: Record<string, string> = {};
  if (isObj(raw.seen)) for (const [k, v] of Object.entries(raw.seen)) if (/^[1-9]\d{0,9}$/.test(k) && isStamp(v)) seen[k] = v;
  return { version: 1, pending, grabs, moves, seen };
}

interface TripResult { t: string; steps: { op: "take" | "put"; serial: number; ok: boolean }[] }
function asTripResult(v: unknown): TripResult | null {
  if (!isObj(v) || !isStamp(v.t)) return null;
  const steps = (Array.isArray(v.steps) ? v.steps : []).filter((s): s is TripResult["steps"][number] =>
    isObj(s) && (s.op === "take" || s.op === "put") && isSerial(s.serial) && typeof s.ok === "boolean");
  return { t: v.t, steps };
}

// A pending trip whose result is in its bridge's status.json is read into the overlay and forgotten: a take
// that worked puts the item in the backpack (to: null), a put that worked puts it in the step's destination. A
// step for an item the trip did not carry is ignored. Each move names the character the bridge ran in, when known.
// A Grab that worked is a take (issue #148), marked `grab` so Organize leaves the item with the player; it left
// the container a move still pending in the overlay took it from, else the one it was grabbed from. With no result
// yet, a trip or a grab is kept while the bridge is running it or while it may still be picked up.
export function harvestTrips(state: OrganizeState, bridges: Record<string, BridgeView>, now: number): OrganizeState {
  const moves = new Map(state.moves.map((m) => [m.serial, m]));
  const bridgeOf = (adapter: string): BridgeView | undefined => (Object.hasOwn(bridges, adapter) ? bridges[adapter] : undefined);
  const waiting = (bridge: BridgeView | undefined, id: string, queuedAt: string): boolean => bridge?.current === id || now - stampMs(queuedAt) <= PENDING_GRACE_MS;
  const pending: PendingTrip[] = [];
  for (const p of state.pending) {
    const bridge = bridgeOf(p.adapter);
    const result = bridge && Object.hasOwn(bridge.results, p.id) ? asTripResult(bridge.results[p.id]) : null;
    if (result) {
      for (const s of result.steps) {
        const step = p.steps.find((x) => x.serial === s.serial);
        if (!s.ok || !step) continue;
        const from = step.from ?? moves.get(s.serial)?.from ?? null;
        moves.set(s.serial, { serial: s.serial, name: step.name, from, to: s.op === "put" ? step.to : null, at: result.t, trip: p.id, ...(bridge?.character ? { character: bridge.character } : {}) });
      }
      continue;
    }
    if (waiting(bridge, p.id, p.queuedAt)) pending.push(p);
  }
  const grabs: PendingGrab[] = [];
  for (const g of state.grabs) {
    const bridge = bridgeOf(g.adapter);
    const result = bridge && Object.hasOwn(bridge.results, g.id) ? bridge.results[g.id] : undefined;
    if (result === undefined) { if (waiting(bridge, g.id, g.queuedAt)) grabs.push(g); continue; }
    if (!isObj(result) || result.ok !== true || !isStamp(result.t)) continue;
    const from = moves.get(g.serial)?.from ?? g.from;
    moves.set(g.serial, { serial: g.serial, name: g.name, from, to: null, at: result.t, trip: g.id, ...(bridge?.character ? { character: bridge.character } : {}), grab: true });
  }
  return { ...state, pending, grabs, moves: [...moves.values()].sort((a, b) => a.serial - b.serial) };
}

// Spec §4: an entry is dropped once a scan newer than the step settles it — the item seen anywhere since (and the
// container it left scanned since, or in no scan: until then the move still takes the item off that container's
// fill), or its destination opened by a scan since (which also covers an item that has since vanished from every
// scan) — or when its destination is in no scan at all, or when it is older than a week. A destination the newer
// scan saw but could not open says nothing about the item. An item in the backpack stays until a scan finds it.
export function pruneOverlay(state: OrganizeState, inv: Inventory, now: number): OrganizeState {
  const moves = state.moves.filter((m) => {
    const at = stampMs(m.at);
    if (!(now - at <= OVERLAY_MAX_AGE_MS)) return false;
    const it = inv.items[m.serial];
    const from = m.from == null ? undefined : inv.containers[m.from];
    if (it && stampMs(it.seenAt) >= at) return !!from && stampMs(from.scannedAt) < at;
    if (m.to == null) return true;
    const to = inv.containers[m.to];
    return !!to && (stampMs(to.scannedAt) < at || to.opened === false);
  });
  return moves.length === state.moves.length ? state : { ...state, moves };
}

// Remembers each labelled container's newest scan time while it is in the scans, keeps the last one known once it
// is not, and forgets containers that are no longer labelled.
export function noteSeen(state: OrganizeState, cfg: OrganizeConfig, inv: Inventory): OrganizeState {
  const seen: Record<string, string> = {};
  for (const key of Object.keys(cfg.labels)) {
    const v = inv.containers[key]?.scannedAt ?? state.seen[key];
    if (v) seen[key] = v;
  }
  return { ...state, seen };
}
