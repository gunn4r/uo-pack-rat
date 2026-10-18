// bridge.mts — <data>/bridge/<adapter>/: the one writer of an adapter's bridge queue (POST /api/bridge's commands and queueTrip's trips, one JSON line each in queue.jsonl, which packrat-bridge.py reads and checks itself), of the replies the server leaves there for the game scripts (Put away's putaway.json), and of Organize's Stop flag <data>/bridge/stop.
//
// map: server
// owns: `appendCommand`, `writeReply`, `writeStop`
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic-write.mts";
import { DATA_DIR_MODE, DATA_FILE_MODE, type ConfigPaths } from "../config.mts";
import { writeJsonFile } from "./json-file.mts";

// Appends `text`, one command already serialized as JSON with no newline, as a line of the adapter's queue, creating
// the adapter's bridge folder first. Appended, never rewritten: the bridge may be reading the file at the same time.
export function appendCommand(paths: Pick<ConfigPaths, "bridgeFor" | "bridgeQueueFor">, adapter: string, text: string): void {
  mkdirSync(paths.bridgeFor(adapter), { recursive: true, mode: DATA_DIR_MODE });
  appendFileSync(paths.bridgeQueueFor(adapter), text + "\n", { mode: DATA_FILE_MODE });
}

// Replaces <data>/bridge/<adapter>/<name> with `doc` as compact JSON and a trailing newline, creating the folder: a
// reply a game script reads whole (Put away's PUT_AWAY_REPLY), so it is written atomically, never appended.
export function writeReply(paths: Pick<ConfigPaths, "bridgeFor">, adapter: string, name: string, doc: unknown): void {
  writeJsonFile(join(paths.bridgeFor(adapter), name), doc);
}

// Organize's Stop (POST /api/bridge/stop): the flag packrat-bridge.py checks between a trip's steps, the time it was
// set. The bridge halts after its current step and clears the flag when the next trip starts.
export function writeStop(paths: Pick<ConfigPaths, "bridgeStop">): void {
  mkdirSync(dirname(paths.bridgeStop), { recursive: true, mode: DATA_DIR_MODE });
  writeFileAtomic(paths.bridgeStop, `${new Date().toISOString()}\n`, DATA_FILE_MODE);
}
