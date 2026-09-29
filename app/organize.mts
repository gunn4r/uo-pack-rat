// organize.mts — Organize's planner (issue #11): which item goes from which container to which, in which trip,
// and what does not fit. Pure and deterministic: the same inventory, setup and overlay give the same plan byte
// for byte, because every walk below runs in serial order. Nothing here reads or writes a file; the server
// (GET /api/organize/plan, POST /api/organize/trip) hands everything in.
import { matchesItem } from "./item-query.mts";
import { parseStamp } from "./scan-schema.mts";
import { CATCH_ALL_ID, type OrganizeConfig, type RuleMatch } from "./organize-config.mts";
import type { Inventory, Item } from "./vault-lib.mts";
import type { RulesV1RarityItem } from "./schema/types.d.mts";

export type WarningKind = "stale-container" | "missing-target" | "missing-label" | "unknown-capacity" | "old-scripts" | "blacklisted" | "no-position" | "not-ground";
export interface PlanWarning { kind: WarningKind; serial: number; detail: string }

// A container last scanned longer ago than this is warned about, and still planned: the bridge rechecks live
// state before every step.
export const STALE_MS = 7 * 864e5;
const bySerial = (a: number, b: number): number => a - b;
export const stampMs = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };

// A container and every container around it, innermost first: [container, parent, …, root]. Null when a link
// is missing from the fold or the chain runs past eight (the bridge opens at most eight containers).
export function ancestry(inv: Inventory, serial: number | null): number[] | null {
  const out: number[] = [];
  for (let cur: number | null = serial; cur != null;) {
    const c = inv.containers[cur];
    if (!c || out.length >= 8) return null;
    out.push(+c.serial);
    cur = c.parent ?? null;
  }
  return out.length ? out : null;
}

type Pos = { x: number; y: number; z: number; facet?: number | undefined };
// A position the bridge can walk to: whole tiles on the map (bridge.v1.schema.json's own bounds).
function posOk(p: Record<string, number> | null | undefined): boolean {
  return !!p && [p.x, p.y, p.z].every((v) => Number.isInteger(v)) && p.x! >= 0 && p.x! <= 7168 && p.y! >= 0 && p.y! <= 4096 && p.z! >= -128 && p.z! <= 127;
}
const posOf = (inv: Inventory, serial: number): Pos => inv.containers[serial]!.pos as unknown as Pos;

export interface ScopeOptions { now: number; blacklist?: number[] | undefined; seen?: Record<string, string> | undefined }
export interface Scope {
  roots: number[];          // labelled ground roots with a position: the only places items are taken from
  siteRoots: number[];      // those, plus the roots of labelled bags: every place a trip may go
  movable: number[];        // item serials that may move
  usable: Set<number>;      // labelled containers a put may go into
  warnings: PlanWarning[];
}

// Labels define the playing field (spec §1): items move only out of labelled ground roots, and only into
// labelled containers. Never out of or into a pinned or blacklisted container (or one inside one), never out
// of a bag the newest scan could not open (the fold keeps older contents there), never a bag itself, and
// never into a container whose fill (or whose surroundings' fill) the scans do not state.
export function scopeOf(inv: Inventory, cfg: OrganizeConfig, { now, blacklist = [], seen = {} }: ScopeOptions): Scope {
  const black = new Set(blacklist);
  const pinned = new Set(Object.values(cfg.labels).filter((l) => l.pinned).map((l) => l.serial));
  const pinnedItems = new Set(cfg.pinnedItems);
  const targets = new Set([...cfg.rules.flatMap((r) => r.targets), ...(cfg.catchAll != null ? [cfg.catchAll] : [])]);
  const warnings: PlanWarning[] = [];
  const warn = (kind: WarningKind, serial: number, detail: string): void => { warnings.push({ kind, serial, detail }); };
  const roots = new Set<number>(), siteRoots = new Set<number>(), usable = new Set<number>();
  for (const serial of Object.values(cfg.labels).map((l) => l.serial).sort(bySerial)) {
    const c = inv.containers[serial];
    if (!c) { warn("missing-label", serial, seen[serial] ? `not seen since ${seen[serial]}` : "not in any scan"); continue; }
    const chain = ancestry(inv, serial);
    const root = chain ? inv.containers[chain.at(-1)!] : undefined;
    if (!chain || !root) continue;
    if (root.kind !== "ground") { warn("not-ground", serial, "only containers on the ground can be organized"); continue; }
    if (chain.some((s) => black.has(s))) { warn("blacklisted", serial, "it is blacklisted: nothing is taken out of it or put into it"); continue; }
    if (!posOk(root.pos)) { warn("no-position", +root.serial, "its scan has no position, so the bridge cannot walk to it"); continue; }
    if (now - stampMs(c.scannedAt) > STALE_MS) warn("stale-container", serial, `last scanned ${c.scannedAt}`);
    siteRoots.add(+root.serial);
    if (+root.serial === serial) roots.add(serial);
    if (chain.some((s) => pinned.has(s))) continue;
    const unknown = chain.find((s) => !inv.containers[s]!.capacity);
    if (unknown == null) { usable.add(serial); continue; }
    if (!targets.has(serial)) continue;
    const u = inv.containers[unknown]!;
    if (u.parent == null && !u.tooltip?.length) warn("old-scripts", unknown, "rescan with TazUO scripts 2.9.0, Razor Enhanced 1.9.0 or the ClassicUO web scanner 1.3.0 or later to read how full it is");
    else warn("unknown-capacity", unknown, "its tooltip has no Contents line, so nothing is put into it");
  }
  const movable = Object.values(inv.items).filter((it) => {
    if (it.root == null || !roots.has(+it.root) || it.equippedBy || it.kind === "container" || inv.containers[it.serial] || pinnedItems.has(+it.serial)) return false;
    const chain = ancestry(inv, it.container);
    return !!chain && chain.at(-1) === +it.root && !chain.some((s) => pinned.has(s) || black.has(s) || inv.containers[s]!.opened === false);
  }).map((it) => +it.serial).sort(bySerial);
  return { roots: [...roots].sort(bySerial), siteRoots: [...siteRoots].sort(bySerial), movable, usable, warnings };
}

const STACK_COUNT = /^\d[\d,]*\s+/;
// An item's name without its stack count ("75 Grave Dust" → "grave dust"), lower-cased: what rule names and
// stack merges compare.
export const baseName = (name: string): string => name.replace(STACK_COUNT, "").trim().toLowerCase();

// A rule's filter: the item query (location-free, item-query.mts's matchesItem) and, when given, any of the names.
export function ruleMatches(it: Item, m: RuleMatch, rarity: RulesV1RarityItem[] = []): boolean {
  const names = m.names ?? [];
  if (names.length) {
    const n = baseName(it.name);
    if (!names.some((w) => n.includes(w.trim().toLowerCase()))) return false;
  }
  return matchesItem(it, m.query, { rarity });
}

export interface Claim { ruleId: string; alsoMatched: string[] }
// First match wins (spec §1): the first rule whose filter passes claims the item and the others that pass are
// only recorded. An item no rule claims goes to the catch-all, or stays put (null) when there is none.
export function claimOf(it: Item, cfg: OrganizeConfig, rarity: RulesV1RarityItem[] = []): Claim | null {
  const hits = cfg.rules.filter((r) => ruleMatches(it, r.match, rarity)).map((r) => r.id);
  if (hits.length) return { ruleId: hits[0]!, alsoMatched: hits.slice(1) };
  return cfg.catchAll != null ? { ruleId: CATCH_ALL_ID, alsoMatched: [] } : null;
}
