// scans.mts — <data>/scans/: every accepted scan, one JSON file each (the watcher writes them, /api/forget* adds tombstones, retention removes old ones).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateScan } from "../scan-schema.mts";
import { migrate } from "../migrate.mts";
import type { ScanV2 } from "../schema/types.d.mts";
import type { ScanFile } from "../retention.mts";
import { readJsonFile } from "./json-file.mts";

// `shard` is the current shard, read on every call: a v1 scan is upgraded under it.
export function createScansStore({ dir, shard }: { dir: string; shard: () => string }) {
  // Every scan file on disk is v1 or v2; migrate() (app/migrate.mts) brings either to v2 and validateScan()
  // checks the result against the contract before it ever reaches foldSnapshots (which now requires
  // v2 and throws otherwise). A file that doesn't parse, doesn't upgrade (neither v1 nor v2 shaped)
  // or fails validation is logged and skipped — never thrown, so one bad scan can't take the whole
  // inventory down.
  function files(): ScanFile[] {
    if (!existsSync(dir)) return [];
    const out: ScanFile[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const raw: unknown = readJsonFile(join(dir, f), { onBad: "skip" });
        const m = migrate("scan", raw, { shard: shard() });
        if (m.newer) throw new Error("it was made by a newer Pack Rat");
        if (m.fromVersion === null) throw new TypeError("it is neither a v1 nor a v2 scan");
        const doc = m.doc as Record<string, unknown>;
        const { ok, errors } = validateScan(doc);
        if (!ok) { console.warn(`skipping ${f}: ${errors.map((e) => `${e.path} ${e.msg}`).join("; ")}`); continue; }
        // doc passed validateScan — this is the one place a v2-shaped document earns the ScanV2 cast
        // (the ScanV2 rule: upgradeScan alone only proves UnvalidatedScan).
        out.push({ file: f, doc: doc as ScanV2 });
      } catch (e) { console.warn(`skipping ${f}: ${(e as Error).message}`); }
    }
    return out;
  }
  const all = (): ScanV2[] => files().map((s) => s.doc);
  // Every *.json file's name, mtimeMs and size, so an add/edit/delete/rename is caught with no restart.
  function signature(): string {
    if (!existsSync(dir)) return "no-scans-dir";
    return readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
      .map((f) => { const st = statSync(join(dir, f)); return `${f}:${st.mtimeMs}:${st.size}`; }).join("|");
  }
  return { dir, files, all, signature };
}
