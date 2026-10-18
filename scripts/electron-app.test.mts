// electron-app.test.mts — a [smoke] guard that keeps the Electron UI tests on their shared fixture (scripts/electron-app.mts, issue #338).
//
// No `scripts/ui-*.test.mts` (nor `scripts/builder-ui.mts`, their shared Suit Builder steps) launches Electron itself, decides on its own whether Electron can run, stands in for the bridge by writing its status file, or keeps a polling loop of its own: each of those lives once in `scripts/electron-app.mts` (`launchApp`, `skipWithoutElectron`, `fakeBridge`, `until`), so a safety rule for every launch (the client home, the update check, the load wait, the teardown) is kept in one place. And none sleeps for a fixed time (`waitForTimeout`, or a `setTimeout` of 100 ms or more) unless the line says why with `// sleep: <reason>`: a wait is for a condition (`until`, `settle`, `steady`, `animationsDone`, a selector or a response), and a fixed one is only for proving that something does not happen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const RULES: Array<[RegExp, string]> = [
  [/_electron\s*\.\s*launch\(/, "launch through launchApp (scripts/electron-app.mts)"],
  [/\bTEST_SKIP_ELECTRON\b|function unavailable\(/, "skip with skipWithoutElectron(t)"],
  [/["']status\.json["']/, "stand in for the bridge with fakeBridge"],
  [/function until\b|\bconst until\s*=/, "poll with until"],
  [/waitForTimeout\(|setTimeout\([^,]+,\s*\d{3,}/, "wait for a condition, or say why the fixed sleep is needed with // sleep: <reason>"],
];

test("[smoke] electron-app: the Electron UI tests launch, skip, fake the bridge and poll only through scripts/electron-app.mts, and sleep only with a reason", () => {
  const files = readdirSync(SCRIPTS).filter((f) => /^ui-.*\.test\.mts$/.test(f) || f === "builder-ui.mts").sort();
  assert.ok(files.length > 0, "found the Electron UI tests");
  const found: string[] = [];
  for (const f of files) {
    // comments may name what a test does without doing it
    const code = readFileSync(join(SCRIPTS, f), "utf8").split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, ""));
    code.forEach((line, i) => { for (const [re, use] of RULES) if (re.test(line) && !line.includes("// sleep: ")) found.push(`${f}:${i + 1}: ${use}`); });
  }
  assert.deepEqual(found, []);
});
