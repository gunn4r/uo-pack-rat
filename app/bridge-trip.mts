// bridge-trip.mts — the one writer of an Organize trip (issue #11). queueTrip appends one `trip` line
// to an adapter's bridge queue; writeBridgeStop writes the flag packrat-bridge.py checks between a
// trip's steps. Deliberately not a route: POST /api/bridge's command schema has no trip action, and
// the Organize endpoint that builds a trip from the current plan (after checking the plan's stamp and
// that the adapter declares "trip") is the only caller, so the page can never hand the bridge a trip
// of its own making. The line is checked against app/schema/bridge-trip.v1.schema.json here and again,
// field by field, by check_trip in every packrat-bridge.py: the queue file is not the server's to guard.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { APP_DIR, DATA_DIR_MODE, DATA_FILE_MODE, type ConfigPaths } from "./config.mts";
import { writeFileAtomic } from "./atomic-write.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { BridgeTripV1 } from "./schema/types.d.mts";
import { TRIP_MAX_BYTES, TRIP_NAME_MAX } from "./bridge-contract.mts";

const TRIP_SCHEMA = JSON.parse(readFileSync(join(APP_DIR, "schema", "bridge-trip.v1.schema.json"), "utf8")) as ValidatorSchema;

export type TripInput = Omit<BridgeTripV1, "id" | "action" | "queuedAt">;
export type QueueTripResult = { ok: true; id: string } | { ok: false; error: string };

// A decimal serial as a roots key: what check_trip accepts, minus leading zeros.
const SERIAL_KEY = /^[1-9]\d{0,9}$/;

const cutNames = <T extends { name: string }>(steps: T[]): T[] =>
  Array.isArray(steps) ? steps.map((s) => (s && typeof s.name === "string" ? { ...s, name: s.name.slice(0, TRIP_NAME_MAX) } : s)) : steps;
const hasDuplicates = (serials: number[]): boolean => new Set(serials).size !== serials.length;

export function queueTrip(paths: Pick<ConfigPaths, "bridgeFor" | "bridgeQueueFor">, adapter: string, trip: TripInput, now: Date = new Date()): QueueTripResult {
  const line: BridgeTripV1 = {
    id: randomUUID(), action: "trip", index: trip.index, stamp: trip.stamp, queuedAt: now.toISOString(),
    roots: trip.roots, takes: cutNames(trip.takes), puts: cutNames(trip.puts), ...(trip.putAway ? { putAway: trip.putAway } : {}),
  };
  const { ok, errors } = validate(TRIP_SCHEMA, line);
  if (!ok) return { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}` };
  const keys = Object.keys(line.roots);
  const badKey = keys.find((k) => !SERIAL_KEY.test(k) || Number(k) > 0xFFFFFFFF);
  if (badKey !== undefined) return { ok: false, error: `roots key ${JSON.stringify(badKey)} is not a container serial` };
  const used = new Set([...line.takes.map((t) => t.chain[0]), ...line.puts.map((p) => p.dest[0])].map(String));
  const unplaced = [...used].find((k) => !keys.includes(k));
  if (unplaced !== undefined) return { ok: false, error: `container ${unplaced} starts a step but roots gives it no position` };
  const unused = keys.find((k) => !used.has(k));
  if (unused !== undefined) return { ok: false, error: `roots places ${unused}, which no step uses` };
  if (!line.takes.length && !line.puts.length) return { ok: false, error: "the trip has nothing to do" };
  if (line.putAway && line.takes.length) return { ok: false, error: "a Put away trip takes nothing" };
  if (hasDuplicates(line.takes.map((t) => t.serial)) || hasDuplicates(line.puts.map((p) => p.serial))) return { ok: false, error: "a serial appears twice in the takes or the puts" };
  const text = JSON.stringify(line);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > TRIP_MAX_BYTES) return { ok: false, error: `the trip is ${bytes} bytes; the bridge reads at most ${TRIP_MAX_BYTES}` };
  mkdirSync(paths.bridgeFor(adapter), { recursive: true, mode: DATA_DIR_MODE });
  appendFileSync(paths.bridgeQueueFor(adapter), text + "\n", { mode: DATA_FILE_MODE });
  return { ok: true, id: line.id };
}

// Organize's Stop. The bridge halts after its current step and clears the flag when the next trip starts.
export function writeBridgeStop(paths: Pick<ConfigPaths, "bridgeStop">): void {
  mkdirSync(dirname(paths.bridgeStop), { recursive: true, mode: DATA_DIR_MODE });
  writeFileAtomic(paths.bridgeStop, `${new Date().toISOString()}\n`, DATA_FILE_MODE);
}
