// watcher.test.mts — app/watcher.mts: acceptedName's naming rule, ingestFile's normalise-then-move,
// and startWatcher's debounce/retry/reject/scanOnce/close behavior against an injected fake `watch`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync, chmodSync, symlinkSync, statSync, rmSync, type WatchListener } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acceptedName, ingestFile, startWatcher, MAX_INBOX_BYTES,
  type StartWatcherOnAcceptedInfo, type StartWatcherOnRejectedInfo,
} from "./watcher.mts";
import { TAZUO_V1_CAPS } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";

const SHARD = "uoalive";
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

function validDoc(overrides: Partial<ScanV2> = {}): ScanV2 {
  return {
    schemaVersion: 2, character: "Fixture", scannedAt: "2026-01-01T12:00:00+00:00", shard: SHARD,
    adapter: { id: "tazuo", version: "2.0.0", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, skills: {}, equipped: [], roots: [], containers: {}, items: [],
    ...overrides,
  };
}

// ---- acceptedName -------------------------------------------------------------------------------

test("[fast] acceptedName: slug + stamp, offset colon stripped, Z kept as Z", () => {
  assert.equal(
    acceptedName({ character: "Fixture", scannedAt: "2026-09-15T12:00:00+02:00" }),
    "Fixture-20260915T120000+0200.json",
  );
  assert.equal(
    acceptedName({ character: "Fixture", scannedAt: "2026-01-01T00:00:00Z" }),
    "Fixture-20260101T000000Z.json",
  );
});

test("[fast] acceptedName: spaces/apostrophes in the character name are slugged", () => {
  assert.equal(
    acceptedName({ character: "O'Brien Jr.", scannedAt: "2026-01-01T00:00:00Z" }),
    "O_Brien_Jr_-20260101T000000Z.json",
  );
});

test("[fast] acceptedName: a collision against existingNames gets -2, -3, ...", () => {
  const doc = { character: "Fixture", scannedAt: "2026-01-01T00:00:00Z" };
  const first = acceptedName(doc);
  const existing = new Set([first]);
  const second = acceptedName(doc, existing);
  assert.equal(second, "Fixture-20260101T000000Z-2.json");
  existing.add(second);
  assert.equal(acceptedName(doc, existing), "Fixture-20260101T000000Z-3.json");
});

// ---- ingestFile ----------------------------------------------------------------------------------

test("[fast] ingestFile: a valid inbox file lands in scansDir under its accepted name; inbox file gone", () => {
  const inboxDir = tmp("qm-inbox-in-"), scansDir = tmp("qm-scans-in-");
  const src = join(inboxDir, "whatever.json");
  const doc = validDoc();
  writeFileSync(src, JSON.stringify(doc));
  const result = ingestFile({ path: src, scansDir, shard: SHARD, log: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.character, "Fixture");
  assert.equal(result.scannedAt, doc.scannedAt);
  assert.equal(result.file, "Fixture-20260101T120000+0000.json");
  assert.ok(existsSync(join(scansDir, result.file!)));
  assert.equal(JSON.parse(readFileSync(join(scansDir, result.file!), "utf8")).character, "Fixture");
  assert.equal(existsSync(src), false);
});

test("[fast] ingestFile: a schema-invalid doc reports the validation reason and leaves the file alone", () => {
  const inboxDir = tmp("qm-inbox-inv-"), scansDir = tmp("qm-scans-inv-");
  const src = join(inboxDir, "partial.json");
  writeFileSync(src, JSON.stringify({ schemaVersion: 2 }));
  const result = ingestFile({ path: src, scansDir, shard: SHARD, log: () => {} });
  assert.equal(result.ok, false);
  assert.ok(result.reason!.length > 0, result.reason);
  assert.ok(existsSync(src));
  assert.equal(existsSync(scansDir) && readdirSync(scansDir).length > 0, false);
});

test("[fast] ingestFile: unparsable JSON reports an 'invalid JSON' reason", () => {
  const inboxDir = tmp("qm-inbox-badjson-"), scansDir = tmp("qm-scans-badjson-");
  const src = join(inboxDir, "broken.json");
  writeFileSync(src, "not json");
  const result = ingestFile({ path: src, scansDir, shard: SHARD, log: () => {} });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /^invalid JSON: /);
  assert.ok(existsSync(src));
});

// ---- startWatcher (injected fake `watch`) --------------------------------------------------------

// The call signature matches watcher.mts's own WatchFn (dir, listener) => {close}, reusing node:fs's
// own WatchListener<string> type for the listener so this is assignable to startWatcher's `watch`
// option; `fire` itself is test-only, not part of the shape startWatcher expects.
interface FakeWatch {
  (dir: string, listener: WatchListener<string>): { close: () => void; on: (event: "error", l: (e: Error) => void) => void };
  fire: WatchListener<string>;
  // Emits an 'error' on the current watch handle, the way a real FSWatcher does when its directory is
  // deleted or moved on Windows (EPERM).
  fail: (e: Error) => void;
  calls: number;
}

function fakeWatch(): FakeWatch {
  let listener: WatchListener<string> | null = null;
  let onError: ((e: Error) => void) | null = null;
  const watch = ((_dir: string, l: WatchListener<string>) => {
    watch.calls++;
    listener = l; onError = null;
    return { close: () => { listener = null; onError = null; }, on: (_event: "error", h: (e: Error) => void) => { onError = h; } };
  }) as FakeWatch;
  watch.calls = 0;
  watch.fire = (eventType, filename) => { if (listener) listener(eventType, filename); };
  watch.fail = (e) => { if (!onError) throw e; onError(e); };   // no listener = what Node does: an uncaught throw
  return watch;
}

function waitFor(check: () => boolean, { timeoutMs = 1000, stepMs = 10 }: { timeoutMs?: number; stepMs?: number } = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor: timed out"));
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

// Simulates the adapter contract (temp-then-rename) so the watcher only ever sees the final name.
function dropFile(dir: string, name: string, content: string): void {
  const tmpPath = join(dir, `${name}.tmp`);
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, join(dir, name));
}

test("[fast] startWatcher: a dropped valid file is accepted within 1s of the debounced event firing", async () => {
  const inboxDir = tmp("qm-inbox-ok-"), scansDir = tmp("qm-scans-ok-");
  const watch = fakeWatch();
  const accepted: StartWatcherOnAcceptedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onAccepted: (a) => accepted.push(a), debounceMs: 20, retries: 3, retryDelayMs: 20,
  });
  dropFile(inboxDir, "drop.json", JSON.stringify(validDoc()));
  watch.fire("rename", "drop.json");
  await waitFor(() => accepted.length === 1);
  assert.equal(accepted[0]!.character, "Fixture");
  assert.ok(existsSync(join(scansDir, accepted[0]!.file)));
  handle.close();
});

test("[fast] startWatcher: a file that never becomes valid is rejected after `retries` attempts, with a .reason.txt, onRejected once", async () => {
  const inboxDir = tmp("qm-inbox-rej-"), scansDir = tmp("qm-scans-rej-");
  const watch = fakeWatch();
  const rejected: StartWatcherOnRejectedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onRejected: (r) => rejected.push(r), debounceMs: 20, retries: 3, retryDelayMs: 20,
  });
  dropFile(inboxDir, "bad.json", "not json");
  watch.fire("rename", "bad.json");
  await waitFor(() => rejected.length >= 1, { timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));   // let anything further settle
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.file, "bad.json");
  assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")));
  assert.ok(existsSync(join(inboxDir, "rejected", "bad.json.reason.txt")));
  assert.match(readFileSync(join(inboxDir, "rejected", "bad.json.reason.txt"), "utf8"), /invalid JSON/);
  handle.close();
});

test("[fast] startWatcher: scanOnce() ingests a file that was already present, with no event", async () => {
  const inboxDir = tmp("qm-inbox-scan-"), scansDir = tmp("qm-scans-scan-");
  writeFileSync(join(inboxDir, "preexisting.json"), JSON.stringify(validDoc({ character: "Preexisting" })));
  const watch = fakeWatch();
  const accepted: StartWatcherOnAcceptedInfo[] = [];
  // startWatcher itself runs scanOnce() once at start — no fire() call anywhere in this test.
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onAccepted: (a) => accepted.push(a), debounceMs: 20, retries: 3, retryDelayMs: 20,
  });
  await waitFor(() => accepted.length === 1);
  assert.equal(accepted[0]!.character, "Preexisting");
  handle.close();
});

test("[fast] startWatcher: close() stops processing — a fire() afterward does nothing", async () => {
  const inboxDir = tmp("qm-inbox-close-"), scansDir = tmp("qm-scans-close-");
  const watch = fakeWatch();
  const accepted: StartWatcherOnAcceptedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onAccepted: (a) => accepted.push(a), debounceMs: 20, retries: 3, retryDelayMs: 20,
  });
  handle.close();
  dropFile(inboxDir, "toolate.json", JSON.stringify(validDoc()));
  watch.fire("rename", "toolate.json");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(accepted.length, 0);
  assert.ok(existsSync(join(inboxDir, "toolate.json")));   // never picked up
});

test("[fast] startWatcher: getShard is read fresh per ingest, not captured once at startup", async () => {
  // A doc with no shard of its own takes upgradeScan's fallback (getShard()) — see app/scan-schema.mts
  // upgradeScan: "shard: raw.shard ?? shard". Dropping two such files around a getShard() value change
  // (simulating a PUT /api/settings shard switch mid-run) must stamp each with the shard in effect at
  // ITS ingest, not whatever startWatcher saw when it was first called.
  const inboxDir = tmp("qm-inbox-shard-"), scansDir = tmp("qm-scans-shard-");
  const watch = fakeWatch();
  const accepted: StartWatcherOnAcceptedInfo[] = [];
  let shard = "uoalive";
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => shard, watch,
    onAccepted: (a) => accepted.push(a), debounceMs: 20, retries: 3, retryDelayMs: 20,
  });
  const noShardDoc = (character: string) => { const d = validDoc({ character }); delete d.shard; return d; };

  dropFile(inboxDir, "first.json", JSON.stringify(noShardDoc("First")));
  watch.fire("rename", "first.json");
  await waitFor(() => accepted.length === 1);

  shard = "siege";   // the equivalent of a shard switch landing between the two ingests

  dropFile(inboxDir, "second.json", JSON.stringify(noShardDoc("Second")));
  watch.fire("rename", "second.json");
  await waitFor(() => accepted.length === 2);

  const firstDoc = JSON.parse(readFileSync(join(scansDir, accepted[0]!.file), "utf8"));
  const secondDoc = JSON.parse(readFileSync(join(scansDir, accepted[1]!.file), "utf8"));
  assert.equal(firstDoc.shard, "uoalive");
  assert.equal(secondDoc.shard, "siege");
  handle.close();
});

test("[fast] startWatcher: a write failure during accept quarantines the file, onRejected fires once", async () => {
  // scansDir is made to point at a path that already exists as a plain file, so ingestFile's
  // mkdirSync(scansDir, {recursive:true}) throws instead of the file ever landing in scans/ — the
  // exact class of I/O failure the accept-write step must catch instead of letting escape uncaught.
  const inboxDir = tmp("qm-inbox-iofail-");
  const scansParent = tmp("qm-scans-iofail-parent-");
  const scansDir = join(scansParent, "occupied");
  writeFileSync(scansDir, "not a directory");
  const watch = fakeWatch();
  const rejected: StartWatcherOnRejectedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onRejected: (r) => rejected.push(r), debounceMs: 20, retries: 2, retryDelayMs: 20,
  });
  dropFile(inboxDir, "good.json", JSON.stringify(validDoc()));
  watch.fire("rename", "good.json");
  await waitFor(() => rejected.length >= 1, { timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));   // let anything further settle
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.file, "good.json");
  assert.match(rejected[0]!.reason, /write failed/);
  assert.ok(existsSync(join(inboxDir, "rejected", "good.json")));
  assert.match(readFileSync(join(inboxDir, "rejected", "good.json.reason.txt"), "utf8"), /write failed/);
  handle.close();
});

test("[fast] startWatcher: an unlink failure after a successful write is still accepted (no duplicate, no reject), and a second scanOnce() doesn't re-ingest it", {
  // chmod-denying-unlink doesn't hold as root (permission checks are bypassed) or on Windows
  // (directory write permission doesn't gate deleting a file inside it the same way) — the induced
  // failure this test depends on just wouldn't happen there, so the test would pass for the wrong
  // reason (or fail outright) rather than exercising anything.
  skip: process.platform === "win32" || process.getuid?.() === 0 ? "chmod cannot deny unlink here" : false,
}, async () => {
  // The inbox file's containing directory is made unwritable AFTER the file is created, so
  // ingestFile's rename into scansDir succeeds but its final unlinkSync(path) throws EACCES — the
  // exact "accepted, but couldn't clean up the inbox copy" case that must not be retried as a whole.
  const inboxDir = tmp("qm-inbox-unlink-"), scansDir = tmp("qm-scans-unlink-");
  const name = "leftover.json";
  writeFileSync(join(inboxDir, name), JSON.stringify(validDoc()));
  chmodSync(inboxDir, 0o500);   // r-x, no write — unlink of a file inside it now fails
  try {
    const watch = fakeWatch();
    const accepted: StartWatcherOnAcceptedInfo[] = [];
    const rejected: StartWatcherOnRejectedInfo[] = [];
    const handle = startWatcher({
      inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
      onAccepted: (a) => accepted.push(a), onRejected: (r) => rejected.push(r),
      debounceMs: 20, retries: 2, retryDelayMs: 20,
    });
    // startWatcher's own startup scanOnce() picks the pre-existing file up — no fire() needed.
    await waitFor(() => accepted.length === 1);
    await new Promise((r) => setTimeout(r, 100));   // let any retry the bug would have caused settle
    assert.equal(accepted.length, 1, "accepted exactly once, despite the stuck inbox file");
    assert.equal(rejected.length, 0, "never quarantined — the write itself succeeded");
    assert.equal(readdirSync(scansDir).filter((f) => f.endsWith(".json")).length, 1, "exactly one scan, no duplicate");
    assert.ok(existsSync(join(inboxDir, name)), "the leftover inbox file is still there (unlink is still failing)");

    handle.scanOnce();   // simulate a restart's startup sweep re-finding the same stuck leftover
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(accepted.length, 1, "no second onAccepted for the same leftover");
    assert.equal(rejected.length, 0);
    assert.equal(readdirSync(scansDir).filter((f) => f.endsWith(".json")).length, 1, "still exactly one scan");

    handle.close();
  } finally {
    chmodSync(inboxDir, 0o700);   // restore write perms so the tmp dir can be cleaned up afterward
  }
});

test("[fast] startWatcher: a real restart re-finding a stuck duplicate inbox file doesn't create a second scan", async () => {
  // Nothing in-memory (like the leftover-tracking a prior version of this fix relied on) survives an
  // actual process restart — a brand-new startWatcher, sharing only the filesystem with the one that
  // ingested the first copy. Idempotency has to be re-derivable from scansDir's own contents alone.
  const inboxDir = tmp("qm-inbox-restart-"), scansDir = tmp("qm-scans-restart-");
  const content = JSON.stringify(validDoc({ character: "Restarted" }));
  writeFileSync(join(inboxDir, "first.json"), content);

  const watch1 = fakeWatch();
  const accepted1: StartWatcherOnAcceptedInfo[] = [];
  const handle1 = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch: watch1,
    onAccepted: (a) => accepted1.push(a), debounceMs: 20, retries: 2, retryDelayMs: 20,
  });
  await waitFor(() => accepted1.length === 1);
  handle1.close();
  assert.equal(readdirSync(scansDir).filter((f) => f.endsWith(".json")).length, 1);
  assert.equal(existsSync(join(inboxDir, "first.json")), false);

  // Simulate the file getting stuck in the inbox again under a new name but IDENTICAL content (e.g.
  // the process crashed after writing it but before the previous run's unlink went through), then a
  // real restart: a brand-new startWatcher with no memory of handle1 at all.
  writeFileSync(join(inboxDir, "second.json"), content);
  const watch2 = fakeWatch();
  const accepted2: StartWatcherOnAcceptedInfo[] = [];
  const handle2 = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch: watch2,
    onAccepted: (a) => accepted2.push(a), debounceMs: 20, retries: 2, retryDelayMs: 20,
  });
  // startWatcher's own startup scanOnce() picks the leftover up automatically — no fire() needed.
  await waitFor(() => !existsSync(join(inboxDir, "second.json")));
  await new Promise((r) => setTimeout(r, 50));   // let anything further settle
  assert.equal(accepted2.length, 0, "the new watcher's own scanOnce() must not report this as newly accepted");
  assert.equal(readdirSync(scansDir).filter((f) => f.endsWith(".json")).length, 1, "still exactly one scan file");
  handle2.close();
});

// ---- hostile / hostile-adjacent inbox files (Phase 7 security review, Area 2) --------------------

test("[fast] ingestFile: a file over the size cap is rejected without being read", () => {
  const inboxDir = tmp("qm-inbox-big-"), scansDir = tmp("qm-scans-big-");
  const path = join(inboxDir, "big.json");
  // Valid JSON, so nothing but the size check can be what rejects it. A real scan is well under
  // 10 MB; the measured cost of reading one is ~9x its size in RSS, so an unbounded read is an
  // OOM abort that repeats on every restart (the startup sweep re-reads the same file).
  writeFileSync(path, JSON.stringify(validDoc()) + " ".repeat(MAX_INBOX_BYTES));
  const r = ingestFile({ path, scansDir, shard: SHARD });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /too large/);
  assert.equal(readdirSync(scansDir).filter((f) => f.endsWith(".json")).length, 0);
});

test("[fast] ingestFile: an inbox entry that is not a regular file is rejected without being read", { skip: process.platform === "win32" ? "symlinks need elevation on Windows" : false }, () => {
  const inboxDir = tmp("qm-inbox-link-"), scansDir = tmp("qm-scans-link-"), elsewhere = tmp("qm-elsewhere-");
  const target = join(elsewhere, "target.json");
  writeFileSync(target, JSON.stringify(validDoc()));
  const path = join(inboxDir, "link.json");
  symlinkSync(target, path);
  const r = ingestFile({ path, scansDir, shard: SHARD });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /not a regular file/);
  assert.equal(existsSync(target), true, "the symlink's target must never be touched");
  assert.equal(readdirSync(scansDir).filter((f) => f.endsWith(".json")).length, 0);
});

test("[fast] ingestFile: the reason for unparsable JSON never carries the file's own bytes", () => {
  const inboxDir = tmp("qm-inbox-leak-"), scansDir = tmp("qm-scans-leak-");
  const path = join(inboxDir, "secret.json");
  const secret = "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG";
  writeFileSync(path, secret);   // V8's own parse error quotes an excerpt of what it was given
  const r = ingestFile({ path, scansDir, shard: SHARD });
  assert.equal(r.ok, false);
  assert.ok(!r.reason!.includes("wJalrXUtnFEMI"), `the reject reason leaked file content: ${r.reason}`);
  assert.match(r.reason!, /invalid JSON/);
});

test("[fast] startWatcher: a throwing log still quarantines the file AND reports it to the page", async () => {
  const inboxDir = tmp("qm-inbox-badlog-"), scansDir = tmp("qm-scans-badlog-");
  writeFileSync(join(inboxDir, "bad.json"), "not json at all");
  const watch = fakeWatch();
  const rejected: StartWatcherOnRejectedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    log: () => { throw null; },   // a non-Error throw, from the one callback the watcher does not own
    onRejected: (r) => rejected.push(r), debounceMs: 10, retries: 1, retryDelayMs: 10,
  });
  await waitFor(() => rejected.length === 1);
  assert.equal(existsSync(join(inboxDir, "rejected", "bad.json")), true);
  assert.equal(rejected[0]!.file, "bad.json");
  handle.close();
});

test("[fast] startWatcher: a throwing onAccepted does not take down the watcher's queue", async () => {
  const inboxDir = tmp("qm-inbox-badcb-"), scansDir = tmp("qm-scans-badcb-");
  writeFileSync(join(inboxDir, "good.json"), JSON.stringify(validDoc()));
  const watch = fakeWatch();
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onAccepted: () => { throw new Error("subscriber blew up"); }, debounceMs: 10, retries: 1, retryDelayMs: 10,
  });
  await waitFor(() => readdirSync(scansDir).filter((f) => f.endsWith(".json")).length === 1);
  // the queue still runs afterwards
  writeFileSync(join(inboxDir, "good2.json"), JSON.stringify(validDoc({ scannedAt: "2026-01-02T12:00:00+00:00" })));
  watch.fire("rename", "good2.json");
  await waitFor(() => readdirSync(scansDir).filter((f) => f.endsWith(".json")).length === 2);
  handle.close();
});

// ---- data-directory modes and a self-healing watch (issue #18) ---------------------------------------

const POSIX_MODES = process.platform === "win32" ? "mode bits are a no-op on Windows" : false;

test("[fast] ingestFile: an accepted scan is written 0600 and leaves no temp file behind", { skip: POSIX_MODES }, () => {
  const inboxDir = tmp("qm-inbox-mode-"), scansDir = tmp("qm-scans-mode-");
  const path = join(inboxDir, "drop.json");
  writeFileSync(path, JSON.stringify(validDoc()));
  const r = ingestFile({ path, scansDir, shard: SHARD });
  assert.equal(r.ok, true, r.reason);
  assert.equal(statSync(join(scansDir, r.file!)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(scansDir), [r.file], "only the accepted file, no temp");
});

test("[fast] startWatcher: an inbox it has to create is created 0700", { skip: POSIX_MODES }, () => {
  const inboxDir = join(tmp("qm-inbox-parent-"), "inbox", "tazuo"), scansDir = tmp("qm-scans-dirmode-");
  const handle = startWatcher({ inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch: fakeWatch() });
  assert.equal(statSync(inboxDir).mode & 0o777, 0o700);
  handle.close();
});

test("[fast] startWatcher: an 'error' from the watch is logged and the watch is re-armed, not left dead", async () => {
  const inboxDir = tmp("qm-inbox-err-"), scansDir = tmp("qm-scans-err-");
  const watch = fakeWatch();
  const logs: string[] = [];
  const accepted: StartWatcherOnAcceptedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch, log: (m) => logs.push(m),
    onAccepted: (a) => accepted.push(a), debounceMs: 10, retries: 1, retryDelayMs: 10,
  });
  assert.equal(watch.calls, 1);
  watch.fail(Object.assign(new Error("EPERM: operation not permitted, watch"), { code: "EPERM" }));
  await waitFor(() => watch.calls === 2);
  assert.ok(logs.some((l) => /EPERM/.test(l)), logs.join("\n"));
  dropFile(inboxDir, "after.json", JSON.stringify(validDoc()));
  watch.fire("rename", "after.json");   // reaches the re-armed watch's listener
  await waitFor(() => accepted.length === 1);
  handle.close();
});

test("[fast] startWatcher: scanOnce() recreates a deleted inbox, re-arms the watch and reports success", async () => {
  const inboxDir = join(tmp("qm-inbox-gone-"), "tazuo"), scansDir = tmp("qm-scans-gone-");
  const watch = fakeWatch();
  const accepted: StartWatcherOnAcceptedInfo[] = [];
  const handle = startWatcher({
    inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch,
    onAccepted: (a) => accepted.push(a), debounceMs: 10, retries: 1, retryDelayMs: 10,
  });
  rmSync(inboxDir, { recursive: true });
  assert.equal(handle.scanOnce(), true);
  assert.equal(existsSync(inboxDir), true, "the inbox is back");
  assert.equal(watch.calls, 2, "a watch on a deleted directory is dead, so it is armed again");
  dropFile(inboxDir, "later.json", JSON.stringify(validDoc()));
  watch.fire("rename", "later.json");
  await waitFor(() => accepted.length === 1);
  handle.close();
});

test("[fast] startWatcher: scanOnce() reports failure when the inbox cannot be recreated", () => {
  const parent = tmp("qm-inbox-blocked-");
  const inboxDir = join(parent, "inbox", "tazuo"), scansDir = tmp("qm-scans-blocked-");
  const logs: string[] = [];
  const handle = startWatcher({ inboxDir, adapter: "tazuo", scansDir, getShard: () => SHARD, watch: fakeWatch(), log: (m) => logs.push(m) });
  rmSync(join(parent, "inbox"), { recursive: true });
  writeFileSync(join(parent, "inbox"), "a file where the inbox folder should be");
  assert.equal(handle.scanOnce(), false);
  assert.ok(logs.some((l) => /scanOnce/.test(l)), logs.join("\n"));
  handle.close();
});
