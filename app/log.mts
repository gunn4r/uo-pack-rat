// log.mts — the one way the server appends a line to its log file.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DATA_DIR_MODE, DATA_FILE_MODE } from "./config.mts";

// Every log append in the server goes through here rather than a bare appendFileSync (post-review
// fix, Important 1): a deleted logs/ dir (the Settings tab's own "Open" button shows the user right
// where to find it) or a full disk must never throw out of a log call — ingestFile's and enqueue's
// "never throws" contracts (app/watcher.mts) depend on it, and an uncaught throw from inside a
// route's own catch block (the 500-handler's log line) would otherwise escape as an unhandled
// rejection and take the whole process down. Best-effort: on failure, fall back to console.error
// once for that line and move on; mkdirSync(recursive) re-creates the logs dir lazily if it vanished
// under a running server, since recreating an already-existing dir is a no-op.
export function safeAppendLog(file: string, line: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: DATA_DIR_MODE });
    appendFileSync(file, line, { mode: DATA_FILE_MODE });
  } catch (e) {
    console.error(`log write failed (${file}): ${e && (e as Error).message}`);
  }
}
