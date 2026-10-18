// scans.mts — <data>/scans/: every accepted scan, one JSON file each (the watcher writes them, writeTombstone adds the tombstones /api/forget* asks for, retention removes old ones).
//
// map: server
// owns: `createScansStore`, `TombstoneRoot`
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isKnownKind, validateScan } from "../scan-schema.mts";
import { migrate } from "../migrate.mts";
import type { ScanV2 } from "../schema/types.d.mts";
import type { ScanFile } from "../retention.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

export type TombstoneRoot = { serial: number; kind: string; name: string; opened: boolean };

// A `_vault` tombstone scan, which the fold reads as "forget": the roots it lists (POST /api/forget) or, with
// forgetCharacter, that character (POST /api/forget-character). The key order is the bytes written.
function tombstone(scannedAt: string, shard: string, roots: TombstoneRoot[], forgetCharacter?: string) {
  return {
    schemaVersion: 2, character: "_vault", scannedAt, ...(forgetCharacter === undefined ? {} : { forgetCharacter }),
    adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
      capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
    shard, stats: {}, equipped: [], roots, containers: {}, items: [],
  };
}

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
  // Every scan the readers use (the fold, Missing, the house map): a file of a kind from a newer adapter is kept on
  // disk and left out here, with a line in the log.
  const all = (): ScanV2[] => files().filter((s) => {
    if (isKnownKind(s.doc)) return true;
    console.warn(`skipping ${s.file}: kind ${JSON.stringify(s.doc.kind)} is from a newer Pack Rat`);
    return false;
  }).map((s) => s.doc);
  // Every *.json file's name, mtimeMs and size, so an add/edit/delete/rename is caught with no restart.
  function signature(): string {
    if (!existsSync(dir)) return "no-scans-dir";
    return readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
      .map((f) => { const st = statSync(join(dir, f)); return `${f}:${st.mtimeMs}:${st.size}`; }).join("|");
  }
  // A tombstone dated now under the current shard, written compact as <dir>/<name> (created if missing), replacing an
  // earlier one of that name. It is checked against the same contract files() checks every scan against first, so
  // nothing written here is a file the fold then skips; a failure is this app's own bug and throws, with no file written.
  function writeTombstone(name: string, forget: { roots: TombstoneRoot[] } | { character: string }): void {
    const snap = "character" in forget ? tombstone(new Date().toISOString(), shard(), [], forget.character) : tombstone(new Date().toISOString(), shard(), forget.roots);
    const { ok, errors } = validateScan(snap);
    if (!ok) throw new Error(`refusing to write an invalid tombstone: ${errors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
    writeJsonFile(join(dir, name), snap, { newline: false });
  }
  return { dir, files, all, signature, writeTombstone };
}
