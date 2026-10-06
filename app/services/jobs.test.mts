// jobs.test.mts — `app/services/jobs.mts` on its own, with stand-in workers: supersede, the ceiling, cancel, saved runs and failure logging.
//
// `app/services/jobs.mts` with stand-in workers: a newer build from the same client superseding the running one, the ceiling refusing a fifth build without cancelling anything (a supersede freeing its own slot), a cancel ending the job and its streams, a finished build saved as a run (a fill not) and dropped after the retention time, and a failed worker logged with a ref while one that exits after `stop()` is not. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type http from "node:http";
import { createJobsService, type JobInput, type JobWorker } from "./jobs.mts";

class FakeWorker extends EventEmitter {
  terminated = false;
  terminate(): Promise<number> { this.terminated = true; setImmediate(() => this.emit("exit", 1)); return Promise.resolve(1); }
}
const input = (): JobInput => ({ pools: {}, current: {}, profile: {}, opts: { timeBudgetMs: 1000 } });
const tick = (): Promise<void> => new Promise((ok) => setImmediate(ok));

function setup(retentionMs = 60_000) {
  const workers: FakeWorker[] = [], saved: Array<{ id: string }> = [], logged: string[] = [];
  const service = createJobsService({ coreUrl: "file:///core.mts", timings: { retentionMs }, runStore: { write: (run) => { saved.push(run); } }, log: (line) => logged.push(line),
    createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as unknown as JobWorker; } });
  return { service, workers, saved, logged };
}

test("[fast] jobs: a newer build from the same client supersedes the running one", () => {
  const { service, workers } = setup();
  const a = service.submit(input(), "k1", {}, "client-1", true)!;
  assert.equal(a.superseded, null);
  assert.equal(a.job.clientId, "client-1");
  const b = service.submit(input(), "k2", {}, "client-1", true)!;
  assert.equal(b.superseded, a.job.id);
  assert.equal(a.job.state, "cancelled");
  assert.ok(workers[0]!.terminated);
  assert.equal(b.job.state, "running");
  const other = service.submit(input(), "k3", {}, "client-2", true)!;
  assert.equal(other.superseded, null, "another client's build is left alone");
  assert.equal(b.job.state, "running");
  service.stop();
});

test("[fast] jobs: the ceiling refuses a fifth running build and cancels nothing, and a job with no client id gets one", () => {
  const { service } = setup();
  const running = [1, 2, 3, 4].map(() => service.submit(input(), "k", {}, null, true)!.job);
  assert.ok(running.every((j) => typeof j.clientId === "string" && j.clientId.length > 0));
  assert.equal(service.submit(input(), "k", {}, null, true), null);
  assert.equal(service.submit(input(), "k", {}, running[0]!.clientId, true)?.superseded, running[0]!.id, "a supersede frees its own slot");
  assert.ok(running.slice(1).every((j) => j.state === "running"));
  service.stop();
});

test("[fast] jobs: a cancel ends the job and its streams, and a cancelled or unknown job is left as it is", () => {
  const { service } = setup();
  const { job } = service.submit(input(), "k", {}, "c", true)!;
  let ended = 0;
  const res = { write: () => true, end: () => { ended++; } } as unknown as http.ServerResponse;
  job.clients.add(res);
  service.cancel(job);
  assert.equal(job.state, "cancelled");
  assert.equal(typeof job.ms, "number");
  assert.equal(ended, 1);
  assert.equal(job.clients.size, 0);
  service.cancel(job);
  assert.equal(service.snapshot(job).state, "cancelled");
  assert.equal(service.get("no-such-job"), undefined);
  service.stop();
});

test("[fast] jobs: a finished build is saved as a run, a fill is not, and both are dropped after the retention time", async () => {
  const { service, workers, saved } = setup(20);
  const { job } = service.submit(input(), "k", { character: "Kestrel" }, "c", true)!;
  const fill = service.submit(input(), "k", {}, "d", false)!.job;
  await tick();
  workers[0]!.emit("message", { type: "progress", progress: { explored: 7 } });
  workers[0]!.emit("message", { type: "done", result: { best: {} } });
  workers[1]!.emit("message", { type: "done", result: { best: {} } });
  await tick();
  assert.equal(job.state, "done");
  assert.equal(job.runId, job.id);
  assert.deepEqual(saved.map((r) => r.id), [job.id], "only the build that saves");
  assert.equal((saved[0] as Record<string, unknown>).character, "Kestrel");
  assert.equal((saved[0] as Record<string, unknown>).explored, 7);
  assert.equal(fill.state, "done");
  assert.equal(fill.runId, null);
  await new Promise((ok) => setTimeout(ok, 60));
  assert.equal(service.get(job.id), undefined);
  assert.equal(service.get(fill.id), undefined);
  service.stop();
});

test("[fast] jobs: a worker that fails is logged with a ref, and one that exits after stop() is not", async () => {
  const { service, workers, logged } = setup();
  const failed = service.submit(input(), "k", {}, "a", true)!.job;
  await tick();
  workers[0]!.emit("exit", 3);
  await tick();
  assert.equal(failed.state, "error");
  assert.match(failed.error!, /^internal error \(ref [0-9a-f]{8}\)$/);
  assert.match(logged[0]!, /job .* worker exited with code 3/s);
  const quitting = service.submit(input(), "k", {}, "b", true)!.job;
  await tick();
  service.stop();
  await tick(); await tick();
  assert.equal(quitting.state, "running", "a quit is not a failed build");
  assert.equal(logged.length, 1);
});
