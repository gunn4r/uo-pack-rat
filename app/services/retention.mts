// retention.mts — the retention service (issue #28): which old scans and saved runs settings.json's `retention` lets go, and removing them, one prune at a time. The rules themselves are app/retention.mts.
import { lstatSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { retentionOf, runsToPrune, scansToPrune, type ScanFile } from "../retention.mts";
import { foldSnapshots } from "../vault-lib.mts";
import type { SavedRun } from "../runs-lib.mts";

// `retention` is settings.json's saved `retention` field, read on every prune; `log` appends one line to the server log.
export function createRetentionService({ demo, retention, scanStore, runStore, events, log }: {
  demo: boolean;
  retention: () => unknown;
  scanStore: { dir: string; files(): ScanFile[] };
  runStore: { dir: string; files(): { file: string; run: SavedRun }[] };
  events: { broadcast(event: string, data: unknown): void };
  log: (line: string) => void;
}) {
  // Only files the scans and runs stores read are ever candidates (a scan that fails validation or
  // a run that does not parse stays), only by their bare name inside scans/ or runs/, and only a
  // regular file: lstat, so a symlink is left alone rather than followed. Nothing is pruned under
  // --demo: its scans are the committed fixtures and its runs folder is still the player's own.
  // `refused`: old scans were due to go, but the fold without them differed (or, `reason: "houses"`, a listed house would have changed), so every scan was kept.
  interface PrunePlan { scans: string[]; runs: string[]; refused: boolean; reason?: "houses" }
  async function planPrune(): Promise<PrunePlan> {
    if (demo) return { scans: [], runs: [], refused: false };
    const r = retentionOf(retention());
    const scans = scansToPrune(scanStore.files(), foldSnapshots, r, Date.now());
    const runs = runsToPrune(runStore.files().map(({ file, run }) => ({ file, character: String(run.character), createdAt: String(run.createdAt), label: String(run.label || "") })), r);
    return { scans: scans.files, runs, refused: scans.refused, ...(scans.reason ? { reason: scans.reason } : {}) };
  }
  function removeFiles(dir: string, files: string[]): string[] {
    const removed: string[] = [];
    for (const f of files) {
      const p = join(dir, f);
      try {
        if (basename(f) !== f || !f.endsWith(".json") || !lstatSync(p).isFile()) continue;
        unlinkSync(p);
        removed.push(f);
      } catch (e) { log(`${new Date().toISOString()} retention could not remove ${JSON.stringify(f)}: ${(e as Error).message}\n`); }
    }
    return removed;
  }
  // One prune at a time: each call waits for the one before it to finish.
  let pruning: Promise<unknown> = Promise.resolve();
  function pruneData(why: string): Promise<{ scans: number; runs: number; refused: boolean }> {
    const next = pruning.catch(() => {}).then(async () => {
      const plan = await planPrune();
      const scans = removeFiles(scanStore.dir, plan.scans), runs = removeFiles(runStore.dir, plan.runs);
      const at = new Date().toISOString();
      if (plan.refused) log(`${at} retention (${why}) kept every scan: ${plan.reason === "houses" ? "a house's newest capture or furniture would have changed without the old ones" : "the inventory folded without the old ones differed"}\n`);
      if (scans.length || runs.length) log(`${at} retention (${why}) removed ${scans.length} scans ${JSON.stringify(scans)} and ${runs.length} runs ${JSON.stringify(runs)}\n`);
      if (scans.length) events.broadcast("changed", { what: "inventory", at: Date.now() });
      if (runs.length) events.broadcast("changed", { what: "runs", at: Date.now() });
      return { scans: scans.length, runs: runs.length, refused: plan.refused };
    });
    pruning = next;
    return next;
  }
  return { plan: planPrune, prune: pruneData };
}
