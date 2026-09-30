// organize-fixture.mts — hand-built house scans for the Organize tests (app/organize*.test.mts): chests on the
// ground at chosen tiles, bags inside them and items inside those. Each container's Contents line is counted
// from what the scan puts under it (every item and bag, however deep, as ServUO counts) unless a test sets
// `count`. Not a test file: it registers no tests.
import assert from "node:assert/strict";
import { validateScan } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";
import { LIMITS, type OrganizeConfig } from "./organize-config.mts";

export const AT = "2026-09-28T10:00:00Z";
export interface BoxSpec {
  serial: number;
  name?: string | undefined;
  parent?: number | undefined;
  kind?: "ground" | "backpack" | undefined;   // a root's kind; a bag is always "container"
  pos?: { x: number; y: number; z: number; facet?: number | undefined } | null | undefined;   // a ground root's tile; default 100,100,0 on facet 1
  max?: number | undefined;
  maxStones?: number | undefined;
  count?: number | undefined;
  tooltip?: string[] | null | undefined;      // replaces the built tooltip; null leaves it out (a scan older than root tooltips)
  opened?: false | undefined;
}
export interface ThingSpec { serial: number; name: string; in: number; amount?: number | undefined; hue?: number | undefined; graphic?: number | undefined; weight?: number | undefined; lines?: string[] | undefined }

// `bridge`: the scripts' declared bridge capabilities (TazUO's today by default; a shorter list stands for older scripts).
export function houseScan({ character = "Tester", scannedAt = AT, boxes, things = [], bridge = ["highlight", "grab", "goto", "trip", "trip-bags"] }: { character?: string; scannedAt?: string; boxes: BoxSpec[]; things?: ThingSpec[]; bridge?: string[] }): ScanV2 {
  const byId = new Map(boxes.map((b) => [b.serial, b]));
  const chainOf = (serial: number): number[] => {
    const out: number[] = [];
    for (let b = byId.get(serial); b && out.length < 16; b = b.parent == null ? undefined : byId.get(b.parent)) out.push(b.serial);
    return out;
  };
  const under = (serial: number): { count: number; stones: number } => {
    let count = 0, stones = 0;
    for (const b of boxes) if (b.serial !== serial && chainOf(b.serial).includes(serial)) count++;
    for (const t of things) if (chainOf(t.in).includes(serial)) { count++; stones += t.weight ?? 1; }
    return { count, stones };
  };
  const shown = (t: ThingSpec): string => ((t.amount ?? 1) > 1 ? `${t.amount} ${t.name}` : t.name);
  const containers: Record<string, unknown> = {};
  for (const b of boxes) {
    const name = b.name ?? `Box ${b.serial}`;
    const { count, stones } = under(b.serial);
    const contents = `Contents: ${b.count ?? count}/${b.max ?? 125} Items, ${stones}${b.maxStones != null ? `/${b.maxStones}` : ""} Stones`;
    const ground = b.parent == null && (b.kind ?? "ground") === "ground";
    containers[String(b.serial)] = {
      serial: b.serial, kind: b.parent == null ? (b.kind ?? "ground") : "container", name, parent: b.parent ?? null, root: chainOf(b.serial).at(-1)!,
      ...(ground ? { pos: b.pos === undefined ? { x: 100, y: 100, z: 0, facet: 1 } : b.pos } : {}),
      ...(b.tooltip === null ? {} : { tooltip: b.tooltip ?? [name, contents] }),
      ...(b.opened === false ? { opened: false } : {}),
    };
  }
  const doc = {
    schemaVersion: 2, character, scannedAt, stats: {},
    adapter: { id: "tazuo", version: "2.9.0", client: "TazUO", clientVersion: null,
      capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge } },
    roots: boxes.filter((b) => b.parent == null).map((b) => ({ serial: b.serial, kind: b.kind ?? "ground", name: b.name ?? `Box ${b.serial}`, opened: true })),
    containers,
    items: things.map((t) => ({
      serial: t.serial, container: t.in, name: shown(t), nameSource: "opl",
      tooltip: [shown(t), `Weight: ${t.weight ?? 1} ${(t.weight ?? 1) === 1 ? "Stone" : "Stones"}`, ...(t.lines ?? [])],
      amount: t.amount ?? 1, hue: t.hue ?? 0, graphic: t.graphic ?? 0x0F7A,
    })),
    equipped: [],
  };
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return doc as unknown as ScanV2;
}

// The largest setup checkOrganizeConfig accepts: every list at its cap and every text at its longest. The body
// limit of PUT /api/organize and the size a saved organize.json may have must both take it.
export function maxOrganizeConfig(): OrganizeConfig {
  const t = (n: number): string => "x".repeat(n);
  const serials = Array.from({ length: LIMITS.labels }, (_, i) => 0xFFFFFFFF - i);
  const labels = Object.fromEntries(serials.map((s) => [String(s), { serial: s, name: t(LIMITS.text), color: "#aabbcc", pinned: false, origin: `strategy:${t(32)}` as const }]));
  const list = (): string[] => Array(LIMITS.list).fill(t(LIMITS.text));
  const rules = Array.from({ length: LIMITS.rules }, (_, i) => ({
    id: String(i).padEnd(64, "r"), name: t(LIMITS.text), origin: `strategy:${t(32)}` as const, targets: serials.slice(i, i + LIMITS.targets),
    match: {
      query: { q: t(LIMITS.q), slot: list(), rarity: t(LIMITS.text), rarityMin: t(LIMITS.text), rarityMax: t(LIMITS.text), kind: list(), slayer: t(LIMITS.text),
        nogarg: false, med: false, hideTags: list(), props: Array(LIMITS.props).fill({ key: t(LIMITS.text), min: -1.2345678901234567e-300, op: "le" }) },
      names: Array(LIMITS.names).fill(t(LIMITS.text)),
      build: "hybrid" as const,
    },
  }));
  return { version: 1, labels, rules, catchAll: serials[0]!, emptyBagsTo: serials[1]!, pinnedItems: serials.slice(0, LIMITS.pinnedItems).concat(Array.from({ length: LIMITS.pinnedItems - LIMITS.labels }, (_, i) => 1 + i)) };
}
