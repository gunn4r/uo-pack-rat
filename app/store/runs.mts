// runs.mts — <data>/runs/: one JSON file per saved run (finished builds and Manual suits; /api/runs).
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { normalizeRun, type SavedRun } from "../runs-lib.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// `id` is a route's [\w-]+ match or a run's own uuid, so it never leaves the folder.
export function createRunsStore(dir: string) {
  const fileOf = (id: string): string => join(dir, `${id}.json`);
  // Every run that reads, newest first. A file that does not parse is skipped with a console line.
  function files(): { file: string; run: SavedRun }[] {
    if (!existsSync(dir)) return [];
    const out: { file: string; run: SavedRun }[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      // A run file is this app's own prior output, not third-party input, but it still gets the same
      // "trusted, cast at the read boundary" treatment as every other on-disk JSON file in this app.
      try { out.push({ file: f, run: normalizeRun(readJsonFile(join(dir, f), { onBad: "skip" }) as SavedRun) }); } catch (e) { console.error(`skipping run ${f}: ${(e as Error).message}`); }
    }
    return out.sort((a, b) => String(b.run.createdAt).localeCompare(String(a.run.createdAt)));
  }
  const all = (): SavedRun[] => files().map((r) => r.run);
  const has = (id: string): boolean => existsSync(fileOf(id));
  // One run, or null when its file does not parse (a damaged run is reported, not a 500); any other failure throws.
  function read(id: string): SavedRun | null {
    try { return normalizeRun(readJsonFile(fileOf(id), { onBad: "skip" }) as SavedRun); }
    catch (e) { if (e instanceof SyntaxError) return null; throw e; }
  }
  // Written compact with no trailing newline, under `id` (the run's own by default).
  function write(run: { id?: unknown }, id = `${run.id}`): void { writeJsonFile(fileOf(id), run, { newline: false }); }
  const remove = (id: string): void => unlinkSync(fileOf(id));
  return { dir, files, all, has, read, write, remove };
}
