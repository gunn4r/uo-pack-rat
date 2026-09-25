// retention.mts — which saved scans and runs the data folder can let go of (issue #28). Pure: it
// decides which files to delete and never touches the disk; app/vault-server.mts reads the files,
// asks here, and removes what comes back.
//
// Scans are pruned so the inventory never changes: every scan newer than the cutoff stays, and so,
// whatever its age, does the newest scan that opened each root container (it decides that root's
// contents, even when it found the root empty), the newest scan of each character (their card and
// worn set), every `_vault` tombstone (a Forget or Forget character still in force; they are one file
// per root or character, so they never pile up) and every scan something in the fold still carries
// the timestamp of (a bag a later scan could not open keeps what an older one saw in it). Then the
// fold of what is left is compared with the fold of everything, and when they differ nothing is
// pruned at all.
import { parseStamp } from "./scan-schema.mts";
import type { Inventory } from "./vault-lib.mts";
import type { ScanV2 } from "./schema/types.d.mts";

// settings.json's `retention`. keepAll turns pruning off.
export interface Retention { keepAll: boolean; scanDays: number; runsPerCharacter: number }
export const RETENTION_DEFAULTS: Retention = { keepAll: false, scanDays: 30, runsPerCharacter: 50 };
export const RETENTION_LIMITS = { scanDays: { min: 1, max: 3650 }, runsPerCharacter: { min: 1, max: 1000 } } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const isWhole = (v: unknown, { min, max }: { min: number; max: number }): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

// PUT /api/settings' check of a `retention` object: any subset of the three fields, each in bounds.
export function retentionError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "settings.retention must be an object";
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!(k in RETENTION_DEFAULTS)) return `settings.retention.${k} is not a setting`;
  if ("keepAll" in r && typeof r.keepAll !== "boolean") return "settings.retention.keepAll must be a boolean";
  for (const k of ["scanDays", "runsPerCharacter"] as const) {
    const { min, max } = RETENTION_LIMITS[k];
    if (k in r && !isWhole(r[k], RETENTION_LIMITS[k])) return `settings.retention.${k} must be a whole number from ${min} to ${max}`;
  }
  return null;
}

// What settings.json's `retention` means, field by field: a missing or hand-edited bad value reads as
// its default, so a broken file can only make pruning more cautious or leave it at the defaults.
export function retentionOf(v: unknown): Retention {
  const r = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  return {
    keepAll: typeof r.keepAll === "boolean" ? r.keepAll : RETENTION_DEFAULTS.keepAll,
    scanDays: isWhole(r.scanDays, RETENTION_LIMITS.scanDays) ? r.scanDays : RETENTION_DEFAULTS.scanDays,
    runsPerCharacter: isWhole(r.runsPerCharacter, RETENTION_LIMITS.runsPerCharacter) ? r.runsPerCharacter : RETENTION_DEFAULTS.runsPerCharacter,
  };
}

export interface ScanFile { file: string; doc: ScanV2 }

// The scan files to delete, oldest first. `scans` are the files the server reads (valid, upgraded),
// in the order it folds ties; `fold` is vault-lib.mts's foldSnapshots.
export function scansToPrune(scans: ScanFile[], fold: (s: ScanV2[]) => Inventory, r: Retention, now: number): string[] {
  if (r.keepAll) return [];
  const cutoff = now - r.scanDays * DAY_MS;
  const stamp = (s: ScanFile): number => { const t = parseStamp(s.doc.scannedAt); return Number.isFinite(t) ? t : -Infinity; };
  const keep = new Set<string>();
  const newest = new Map<string, ScanFile>();
  const claim = (key: string, s: ScanFile): void => { const cur = newest.get(key); if (!cur || stamp(s) >= stamp(cur)) newest.set(key, s); };
  for (const s of scans) {
    if (stamp(s) >= cutoff || s.doc.character === "_vault") keep.add(s.file);
    claim(`c:${s.doc.character}`, s);
    for (const root of s.doc.roots || []) if (root.opened !== false) claim(`r:${+root.serial}`, s);
  }
  for (const s of newest.values()) keep.add(s.file);
  if (keep.size === scans.length) return [];
  const all = fold(scans.map((s) => s.doc));
  const live = new Set<string>([
    ...Object.values(all.items).map((it) => it.seenAt),
    ...Object.values(all.containers).map((c) => c.scannedAt),
    ...Object.values(all.characters).map((c) => c.scannedAt),
  ]);
  for (const s of scans) if (live.has(s.doc.scannedAt)) keep.add(s.file);
  const kept = scans.filter((s) => keep.has(s.file));
  if (kept.length === scans.length || !sameFold(all, fold(kept.map((s) => s.doc)))) return [];
  return scans.filter((s) => !keep.has(s.file)).sort((a, b) => stamp(a) - stamp(b)).map((s) => s.file);
}

// Two folds describe the same inventory: the same characters, containers and items, each equal. The
// scan list itself is left out, since it is what pruning shortens.
export function sameFold(a: Inventory, b: Inventory): boolean {
  const same = (x: Record<string, unknown>, y: Record<string, unknown>): boolean => {
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every((k) => k in y && JSON.stringify(x[k]) === JSON.stringify(y[k]));
  };
  return same(a.characters, b.characters) && same(a.containers, b.containers) && same(a.items, b.items);
}

export interface RunFile { file: string; character: string; createdAt: string }

// The saved-run files to delete: each character keeps its newest runsPerCharacter.
export function runsToPrune(runs: RunFile[], r: Retention): string[] {
  if (r.keepAll) return [];
  const byChar = new Map<string, RunFile[]>();
  for (const run of runs) {
    const list = byChar.get(run.character);
    if (list) list.push(run); else byChar.set(run.character, [run]);
  }
  const out: string[] = [];
  for (const list of byChar.values()) {
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    out.push(...list.slice(r.runsPerCharacter).map((run) => run.file));
  }
  return out;
}
