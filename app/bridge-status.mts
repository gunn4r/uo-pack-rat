// bridge-status.mts — the one reader of a bridge's status.json (docs/bridge-protocol.md, Status), checked against the status schema, with the one "online" definition; the status route and the Organize service read it. GET /api/bridge/status
// answers the page and the MCP tools from it, and the Organize service reads finished trips and the running bridge's
// features through it.
//
// map: bridge
// owns: `readBridgeStatus`, `ONLINE_S`, `BridgeStatus`, `BridgeResultRead`
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "./config.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { BridgeV1Result, BridgeV1ResultStepsItem, BridgeV1Status } from "./schema/types.d.mts";

const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(APP_DIR, "schema", "bridge.v1.schema.json"), "utf8")) as { status: ValidatorSchema; result: ValidatorSchema };
const STATUS_SCHEMA = BRIDGE_SCHEMA.status;
// The writer's contract opened for reading: every object takes fields it does not name, and no value is held to a list
// (an enum), a length or a pattern, so only a wrong type or a missing required field makes it fail. A newer bridge's
// added field, step key or step op is then still read; the readers skip what they do not know.
function opened(s: ValidatorSchema): ValidatorSchema {
  const { enum: _enum, pattern: _pattern, maxItems: _maxItems, maxLength: _maxLength, minLength: _minLength, ...rest } = s as ValidatorSchema & Record<string, unknown>;
  return { ...rest, ...(s.additionalProperties === false ? { additionalProperties: true } : {}),
    ...(s.properties ? { properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, opened(v)])) } : {}),
    ...(s.items && !Array.isArray(s.items) ? { items: opened(s.items as ValidatorSchema) } : {}) };
}
// Three parts are checked on their own, so one off its shape never makes the bridge read as offline: the bridge's report
// of itself (a block off its shape is dropped, as if an older bridge had written the status, so a newer bridge that
// reshapes it is judged by the scan and the manifest), the running command (kept whenever it has a string id, which is
// what Organize follows a trip by; an action or name that is not a string is dropped from it) and each result (checked
// against the result shape opened for reading: one with a wrong-typed or missing ok, msg, t or step field is dropped,
// the others kept).
const RESULT_READ = opened(BRIDGE_SCHEMA.result);
const { adapter: ADAPTER_SCHEMA, current: CURRENT_SCHEMA, ...STATUS_FIELDS } = STATUS_SCHEMA.properties!;
const CURRENT_ID: ValidatorSchema = { type: "object", required: ["id"], properties: { id: opened(CURRENT_SCHEMA!.properties!.id!) } };
const STATUS_OUTER: ValidatorSchema = { ...STATUS_SCHEMA, properties: { ...STATUS_FIELDS, current: { type: ["object", "null"] } } };

// One result as read: the writer's shape, with any field or step key a newer bridge adds, and a step op it may name.
export type BridgeResultRead = Omit<BridgeV1Result, "steps"> & { steps?: Array<Omit<BridgeV1ResultStepsItem, "op"> & { op: string; [field: string]: unknown }>; [field: string]: unknown };
// status.json as read: the running command and each result checked to their shapes.
export type BridgeStatus = Omit<BridgeV1Status, "results"> & { results: Record<string, BridgeResultRead> };
function readCurrent(c: BridgeV1Status["current"]): BridgeV1Status["current"] {
  if (c === null || !validate(CURRENT_ID, c).ok) return null;
  const { action, name, ...rest } = c;
  return { ...rest, ...(typeof action === "string" ? { action } : {}), ...(typeof name === "string" ? { name } : {}) };
}

// Online: the heartbeat is under 8 s old and not the last one a stopped bridge wrote (stopped: true), so nothing is
// queued after Stop. Both bridges rewrite status.json at least every 2 s, even during a long highlight or walk. A
// heartbeat from the future (clocks apart) reads as online, as it always has, on purpose, unlike the install guard:
// app/fixtures/contract-cases/heartbeat.json pins it and says why. The page queues
// commands only while the bridge is online, and only an online bridge's own report of its features counts.
export const ONLINE_S = 8;

export interface BridgeStatusRead {
  // The file as the bridge wrote it (less an off-shape `adapter` or result, and a `current` with no string id as null), or
  // null when there is none, it does not parse, or it breaks the status schema (a hand-edited or foreign file): every
  // reader then treats the bridge as not running.
  status: BridgeStatus | null;
  // When the bridge last wrote it, in epoch milliseconds (NaN with no status), and how many seconds ago.
  aliveMs: number;
  age: number;
  online: boolean;
}
const NONE: BridgeStatusRead = { status: null, aliveMs: NaN, age: Infinity, online: false };

export function readBridgeStatus(file: string, now: number): BridgeStatusRead {
  try {
    if (!existsSync(file)) return NONE;
    const st: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!validate(STATUS_OUTER, st).ok) return NONE;
    const { adapter, current, results, ...rest } = st as BridgeV1Status;
    const kept = Object.fromEntries(Object.entries(results).filter(([, r]) => validate(RESULT_READ, r).ok)) as Record<string, BridgeResultRead>;
    const status: BridgeStatus = { ...rest, current: readCurrent(current), results: kept,
      ...(adapter !== undefined && validate(ADAPTER_SCHEMA!, adapter).ok ? { adapter } : {}) };
    // An RFC 3339 string, or the epoch seconds an older bridge build wrote.
    const aliveMs = typeof status.alive === "number" ? status.alive * 1000 : Date.parse(status.alive);
    const age = Number.isNaN(aliveMs) ? Infinity : (now - aliveMs) / 1000;
    return { status, aliveMs, age, online: age < ONLINE_S && status.stopped !== true };
  } catch { return NONE; }
}
