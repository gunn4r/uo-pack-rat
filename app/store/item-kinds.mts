// item-kinds.mts — <data>/item-kinds.json: the player's own item kinds (issue #150, app/item-kinds.mts; the /api/item-kinds routes).
import { basename } from "node:path";
import type { KindOverrides } from "../vault-lib.mts";
import { emptyKindOverrides, kindsText, salvageKindOverrides, KIND_LIMITS, MAX_KINDS_BYTES } from "../item-kinds.mts";
import { writeFileAtomic } from "../atomic-write.mts";
import { DATA_FILE_MODE } from "../config.mts";
import { jsonErrorReason } from "../paste-scan.mts";
import { migrate } from "../migrate.mts";
import { newerOnDisk, readJsonFile } from "./json-file.mts";

// Missing reads as none; a file too big or that does not parse is moved aside (the next write would otherwise
// overwrite it) and one with entries that make no sense loses those entries, each with a logged warning, never an
// error. A file made by a newer Pack Rat is read as far as this build understands it and never written over
// (readOnly says why). Written only by the /api/item-kinds routes, whole. `file` is also what the inventory's signature stats.
export function createItemKindsStore(file: string) {
  function read(): KindOverrides {
    const got = readJsonFile(file, { maxBytes: MAX_KINDS_BYTES, onBad: "aside" });
    if ("missing" in got) return emptyKindOverrides();
    if ("bad" in got) {
      const kept = "aside" in got ? `; it was moved to ${basename(got.aside)}` : "";   // else left where it is
      const why = got.bad.why === "too-big" ? `it is over ${MAX_KINDS_BYTES / 1e6} MB` : got.bad.why === "syntax" ? jsonErrorReason(got.bad.error) : got.bad.why === "io" ? got.bad.error.message : got.bad.reason;
      console.warn(`item-kinds.json was ignored (${why})${kept}`);
      return emptyKindOverrides();
    }
    const m = migrate("item-kinds", got.doc);
    const { overrides, problems } = salvageKindOverrides(m.newer ? { ...(m.doc as object), version: 1 } : m.doc);
    if (problems.length) console.warn(`item-kinds.json: left out ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` and ${problems.length - 5} more` : ""}`);
    return overrides;
  }
  // Why item-kinds.json may not be written (a newer Pack Rat made it), or null.
  const readOnly = (): string | null => newerOnDisk(file, "item-kinds");
  // Writes the next document, or says why not: a file made by a newer Pack Rat, past the entry cap (withKinds' null),
  // or a file larger than the read above accepts, which would set every kind aside at the next read.
  function save(next: KindOverrides | null): string | null {
    const newer = readOnly();
    if (newer) return newer;
    const text = next && kindsText(next);
    if (!text) return `that would make more than ${KIND_LIMITS.entries} item kinds; reset some first`;
    if (Buffer.byteLength(text) > MAX_KINDS_BYTES) return `that would make item-kinds.json larger than ${MAX_KINDS_BYTES / 1e6} MB; reset some first`;
    writeFileAtomic(file, text, DATA_FILE_MODE);
    return null;
  }
  return { file, read, save, readOnly };
}
