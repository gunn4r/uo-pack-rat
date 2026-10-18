// bridge.mts — <data>/bridge/<adapter>/queue.jsonl: the one writer of an adapter's bridge queue (POST /api/bridge's commands and queueTrip's trips), one JSON line each, which packrat-bridge.py reads and checks itself.
//
// map: server
// owns: `appendCommand`
import { appendFileSync, mkdirSync } from "node:fs";
import { DATA_DIR_MODE, DATA_FILE_MODE, type ConfigPaths } from "../config.mts";

// Appends `text`, one command already serialized as JSON with no newline, as a line of the adapter's queue, creating
// the adapter's bridge folder first. Appended, never rewritten: the bridge may be reading the file at the same time.
export function appendCommand(paths: Pick<ConfigPaths, "bridgeFor" | "bridgeQueueFor">, adapter: string, text: string): void {
  mkdirSync(paths.bridgeFor(adapter), { recursive: true, mode: DATA_DIR_MODE });
  appendFileSync(paths.bridgeQueueFor(adapter), text + "\n", { mode: DATA_FILE_MODE });
}
