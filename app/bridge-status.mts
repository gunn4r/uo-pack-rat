// bridge-status.mts — the one reader of a bridge's status.json (docs/bridge-protocol.md, Status). GET /api/bridge/status
// answers the page and the MCP tools from it, and the Organize service reads finished trips and the running bridge's
// features through it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "./config.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { BridgeV1Status } from "./schema/types.d.mts";

const STATUS_SCHEMA = (JSON.parse(readFileSync(join(APP_DIR, "schema", "bridge.v1.schema.json"), "utf8")) as { status: ValidatorSchema }).status;
// The bridge's report of itself is checked on its own: a block off its shape is dropped, as if an older bridge had
// written the status, so a newer bridge that reshapes it is judged by the scan and the manifest, never read as offline.
const { adapter: ADAPTER_SCHEMA, ...STATUS_FIELDS } = STATUS_SCHEMA.properties!;
const STATUS_WITHOUT_ADAPTER: ValidatorSchema = { ...STATUS_SCHEMA, properties: STATUS_FIELDS };

// Online: the heartbeat is under 8 s old. Both bridges rewrite status.json at least every 2 s, even during a long
// highlight or walk. A heartbeat from the future (clocks apart) reads as online, as it always has. The page queues
// commands only while the bridge is online, and only an online bridge's own report of its features counts.
export const ONLINE_S = 8;

export interface BridgeStatusRead {
  // The file as the bridge wrote it (less an off-shape `adapter`), or null when there is none, it does not parse, or it
  // breaks the status schema (a hand-edited or foreign file): every reader then treats the bridge as not running.
  status: BridgeV1Status | null;
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
    if (!validate(STATUS_WITHOUT_ADAPTER, st).ok) return NONE;
    const { adapter, ...rest } = st as BridgeV1Status;
    const status: BridgeV1Status = adapter !== undefined && validate(ADAPTER_SCHEMA!, adapter).ok ? { ...rest, adapter } : rest;
    // An RFC 3339 string, or the epoch seconds an older bridge build wrote.
    const aliveMs = typeof status.alive === "number" ? status.alive * 1000 : Date.parse(status.alive);
    const age = Number.isNaN(aliveMs) ? Infinity : (now - aliveMs) / 1000;
    return { status, aliveMs, age, online: age < ONLINE_S };
  } catch { return NONE; }
}
