// runs.mts — <data>/runs/: one JSON file per saved run (finished builds and Manual suits; /api/runs).
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DIAGNOSTICS_SOUND_SINCE, type SavedRun } from "../runs-lib.mts";
import { migrate } from "../migrate.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// `id` is a route's [\w-]+ match or a run's own uuid, so it never leaves the folder. Every run is read through
// migrate() (app/migrate.mts), so each one the server hands out has the current shape; it is not written back. A run
// saved before DIAGNOSTICS_SOUND_SINCE comes without its diagnostics, whose numbers no longer match what the page shows.
class NotARun extends Error {}
function runOf(raw: unknown): SavedRun {
  const m = migrate("runs", raw);
  if (m.fromVersion === null) throw new NotARun("it is not a saved run");
  const run = m.doc as SavedRun;
  if ((run.solverVersion ?? 0) < DIAGNOSTICS_SOUND_SINCE && run.result?.diagnostics) {
    const { diagnostics: _old, ...result } = run.result;
    return { ...run, result };
  }
  return run;
}
export function createRunsStore(dir: string) {
  const fileOf = (id: string): string => join(dir, `${id}.json`);
  // Every run that reads, newest first. A file that does not parse is skipped with a console line.
  function files(): { file: string; run: SavedRun }[] {
    if (!existsSync(dir)) return [];
    const out: { file: string; run: SavedRun }[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      // A run file is this app's own prior output, not third-party input, but it still gets the same
      // "trusted, cast at the read boundary" treatment as every other on-disk JSON file in this app.
      try { out.push({ file: f, run: runOf(readJsonFile(join(dir, f), { onBad: "skip" })) }); } catch (e) { console.error(`skipping run ${f}: ${(e as Error).message}`); }
    }
    return out.sort((a, b) => String(b.run.createdAt).localeCompare(String(a.run.createdAt)));
  }
  const all = (): SavedRun[] => files().map((r) => r.run);
  const has = (id: string): boolean => existsSync(fileOf(id));
  // One run, or null when its file does not parse or holds no run (a damaged run is reported, not a 500); any other failure throws.
  function read(id: string): SavedRun | null {
    try { return runOf(readJsonFile(fileOf(id), { onBad: "skip" })); }
    catch (e) { if (e instanceof SyntaxError || e instanceof NotARun) return null; throw e; }
  }
  // Written compact with no trailing newline, under `id` (the run's own by default).
  function write(run: { id?: unknown }, id = `${run.id}`): void { writeJsonFile(fileOf(id), run, { newline: false }); }
  const remove = (id: string): void => unlinkSync(fileOf(id));
  return { dir, files, all, has, read, write, remove };
}
