// scan-schema.mts — the scan v2 schema, the v1→v2 upgrade-on-read, and epoch-based scan ordering.
// Browser-safe: no Node-only imports (no "node:fs"), so it can be served to the page exactly like
// vault-lib.mts (which imports parseStamp from here for fold ordering) — see the /scan-schema.mjs
// static route in vault-server.mts. Because it must stay fs-free, SCAN_V2_SCHEMA is an inline JS
// object rather than a read of app/schema/scan.v2.schema.json; scan-schema.test.mts asserts the two
// stay identical, and app/schema/scan.v2.schema.json is the copy other (non-JS) tooling can read.
import { validate, type ValidationResult } from "./schema/validate.mts";
import type { ScanV2Adapter, ScanV2AdapterCapabilities } from "./schema/types.d.mts";

// The 20 layer names the v1 scanner (adapters/tazuo/packrat-scanner.py, ALL_LAYERS) walks.
export const TAZUO_V1_CAPS: ScanV2AdapterCapabilities = {
  layers: ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
    "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
    "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
  arms: true, bank: true, ground: true, nested: true, tooltips: "opl",
  bridge: ["highlight", "grab", "goto"],
};

// A UO serial is a 32-bit unsigned integer, and a graphic/hue is a 16-bit one. Without these bounds
// `serial: 1e308` satisfied `{type: "integer"}` (Number.isInteger says so), and two serials above
// 2^53 that round to the same double collapsed into ONE fold entry — silent data loss, and a cheap
// way to make a specific item unreachable to the bridge. Same story for the length bounds below: a
// tooltip line fed parseTooltip, a character name became a filename, and neither had a ceiling.
// (Phase 7 security review, Area 2, Important 3 and Minor 4.)
const SERIAL = { type: "integer", minimum: 0, maximum: 4294967295 };
const SERIAL_OR_NULL = { type: ["integer", "null"], minimum: 0, maximum: 4294967295 };
const GRAPHIC = { type: ["number", "null"], minimum: 0, maximum: 65535 };
const AMOUNT = { type: "number", minimum: 0, maximum: 4294967295 };
const NAME = { type: "string", maxLength: 256 };
const TOOLTIP = { type: "array", maxItems: 256, items: { type: "string", maxLength: 512 } };
// stats/maxes/resists/position are keyed by the adapter (str/dex/int, hits/stam/mana, phys/fire/...)
// and hold plain numbers — every adapter writes ints. They used to be `{type: "object"}` with no
// properties at all, so their values reached the character sheet unchecked.
const NUMBER_MAP = { type: "object", additionalProperties: { type: "number" } };
const NUMBER_MAP_OR_NULL = { type: ["object", "null"], additionalProperties: { type: "number" } };

// Keep byte-for-byte identical to app/schema/scan.v2.schema.json (a test enforces this).
export const SCAN_V2_SCHEMA = {
  "$comment": "Pack Rat scan file schema v2. Draft-07 style, restricted to the keyword subset app/schema/validate.mjs supports. additionalProperties is true at the top level (adapters may add fields, e.g. refresh's meta) but false inside adapter and adapter.capabilities, which are a closed contract every adapter must match exactly, and a SUBSCHEMA on the arbitrarily-keyed maps (stats, maxes, resists, position, skills, containers), which is how their values get checked at all. This JSON literal must stay identical to SCAN_V2_SCHEMA in app/scan-schema.mjs (app/scan-schema.test.mjs asserts that) because scan-schema.mjs is served to the browser and cannot load this file via fs or a JSON import attribute.",
  type: "object",
  additionalProperties: true,
  required: ["schemaVersion", "character", "scannedAt", "adapter", "stats", "roots", "containers", "items", "equipped"],
  properties: {
    schemaVersion: { type: "integer", enum: [2] },
    character: { type: "string", minLength: 1, maxLength: 64 },
    scannedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?([+-]\\d{2}:\\d{2}|Z)$" },
    shard: { type: ["string", "null"] },
    account: { type: "string", pattern: "^[a-f0-9]{16,64}$", "$comment": "an opaque hashed account id (e.g. hex SHA-256 of the account name) — never the plaintext name" },
    adapter: {
      type: "object",
      additionalProperties: false,
      required: ["id", "version", "client", "clientVersion", "capabilities"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$", "$comment": "the same shape app/installer.mts's ADAPTER_ID_RE admits and every adapter-taking route checks — this id names an inbox, a bridge directory and a capabilities folder, so a scan must not be able to carry one that could not be an adapter directory name; 64 matches the bound PUT /api/settings puts on client.adapter" },
        version: { type: "string" },
        client: { type: "string" },
        clientVersion: { type: ["string", "null"] },
        capabilities: {
          type: "object",
          additionalProperties: false,
          required: ["layers", "arms", "bank", "ground", "nested", "tooltips", "bridge"],
          properties: {
            layers: { type: "array", items: { type: "string" } },
            arms: { type: "boolean" },
            bank: { type: "boolean" },
            ground: { type: "boolean" },
            nested: { type: "boolean" },
            tooltips: { type: "string", enum: ["opl", "label"] },
            bridge: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    stats: NUMBER_MAP,
    position: NUMBER_MAP_OR_NULL,
    maxes: NUMBER_MAP_OR_NULL,
    resists: NUMBER_MAP_OR_NULL,
    // Keyed by skill name; every adapter writes {value, cap} and TazUO/Razor Enhanced add `base`.
    // A wrong-shaped entry used to pass validation and then throw inside the character sheet's
    // render, taking the Characters tab and the Suit Builder down on every launch until the file was
    // deleted by hand (Phase 7 security review, Area 2, Important 2).
    skills: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["value", "cap"],
        properties: {
          value: { type: "number", minimum: 0, maximum: 1000 },
          base: { type: "number", minimum: 0, maximum: 1000 },
          cap: { type: "number", minimum: 0, maximum: 1000 },
        },
      },
    },
    roots: {
      type: "array",
      items: {
        type: "object",
        required: ["serial", "kind", "name", "opened"],
        properties: {
          serial: SERIAL,
          kind: { type: "string", enum: ["backpack", "bank", "ground"] },
          name: NAME,
          opened: { type: "boolean" },
        },
      },
    },
    // Keyed by serial, but nothing requires the KEY to match the entry's own serial — the fold
    // indexes by the entry's `serial`, which is why that field (not the key) is what has to be a
    // real serial: a container calling itself "__proto__" replaced the prototype of the fold's own
    // map (Phase 7 security review, Area 2, Minor 1).
    containers: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["serial", "root"],
        properties: {
          serial: SERIAL,
          root: SERIAL,
          parent: SERIAL_OR_NULL,
          kind: { type: "string", maxLength: 64 },
          name: NAME,
          pos: NUMBER_MAP_OR_NULL,
          tooltip: TOOLTIP,
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["serial", "container", "nameSource"],
        properties: {
          serial: SERIAL,
          container: SERIAL,
          graphic: GRAPHIC,
          hue: GRAPHIC,
          amount: AMOUNT,
          name: NAME,
          nameSource: { type: "string", enum: ["opl", "label"] },
          tooltip: TOOLTIP,
        },
      },
    },
    equipped: {
      type: "array",
      items: {
        type: "object",
        required: ["serial", "nameSource"],
        properties: {
          serial: SERIAL,
          graphic: GRAPHIC,
          hue: GRAPHIC,
          amount: AMOUNT,
          name: NAME,
          nameSource: { type: "string", enum: ["opl", "label"] },
          tooltip: TOOLTIP,
          layer: { type: ["string", "null"], maxLength: 64 },
        },
      },
    },
  },
};

export function validateScan(doc: unknown): ValidationResult {
  return validate(SCAN_V2_SCHEMA, doc);
}

// Date.parse already treats a date-time string with no offset as LOCAL time (ECMA-262), and
// resolves an offset/Z form as absolute — exactly the "naive stamp = local time" rule the v1→v2
// upgrade below relies on, so no bespoke parsing is needed here.
export function parseStamp(s: string): number {
  return Date.parse(s);
}

const NAIVE_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

// Converts a naive local "YYYY-MM-DDTHH:MM:SS" wall-clock stamp (what packrat-scanner.py /
// packrat-refresh.py / the pre-Task-1 server's localStamp() all wrote) into RFC 3339 using
// THIS machine's UTC offset at that wall-clock instant (DST-correct: the offset is read off a Date
// built from the same y/m/d/h/mi/s, not off "now").
function naiveLocalToRfc3339(stamp: string): string {
  const m = NAIVE_LOCAL_RE.exec(stamp);
  if (!m) throw new TypeError(`upgradeScan: not a naive local scannedAt: ${stamp}`);
  const [, y, mo, d, h, mi, s] = m as unknown as [string, string, string, string, string, string, string];
  const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  const offMin = -dt.getTimezoneOffset();   // minutes EAST of UTC
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

const num = (v: unknown): number | null | undefined => (v == null ? v : Number(v));

function tazuoAdapter(character: unknown): ScanV2Adapter {
  return {
    id: String(character ?? "").startsWith("_") ? "app" : "tazuo",
    version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS,
  };
}

// upgradeScan(raw, {shard}) → a v2-shaped doc. Never mutates raw.
//   v2 in  → same shape, shard stamped only if the doc doesn't already carry one.
//   v1 in  → schemaVersion 2, scannedAt converted to RFC 3339, adapter stamped (tombstones —
//            character starting with "_" — get adapter.id "app" instead of "tazuo"), every
//            roots[] entry opened:true, every serial (roots[].serial, containers keys/.serial/
//            .parent/.root, items[].serial/.container, equipped[].serial) coerced to a number,
//            and every item/equipped entry gets nameSource:"opl".
//   neither → throws TypeError.
//
// `raw` is unknown provenance (a file on disk, or a paste from another player) — this function's own
// `typeof`/property checks are the only thing standing between it and the return, so every read off
// `raw` past those checks is a cast, not a claim the shape is actually proven. This function's job is
// only to normalize a v1 OR v2 shaped document into the v2 LAYOUT, matching its pre-TypeScript
// behavior exactly; it checks nothing but the version field, so it returns UnvalidatedScan, not
// ScanV2. The real gate is validateScan(): a caller earns a ScanV2 by running it and casting
// (`doc as ScanV2`) only on the ok branch — see app/watcher, app/import and app/vault-server. A
// caller that skips validateScan() has to write that cast with nothing above it to justify it, which
// is the point: {schemaVersion: 2, shard: {}} comes back from here looking perfectly well-formed.
export type UnvalidatedScan = Record<string, unknown>;
export function upgradeScan(raw: unknown, { shard }: { shard?: string | null | undefined } = {}): UnvalidatedScan {
  if (raw && typeof raw === "object" && (raw as Record<string, unknown>).schemaVersion === 2) {
    const doc = raw as Record<string, unknown>;
    return { ...doc, shard: doc.shard ?? shard } as UnvalidatedScan;
  }
  if (raw && typeof raw === "object" && (raw as Record<string, unknown>).version === 1) {
    const doc = raw as Record<string, unknown>;
    const containers: Record<string, unknown> = {};
    for (const [key, c] of Object.entries((doc.containers as Record<string, Record<string, unknown>>) || {})) {
      containers[String(Number(key))] = {
        ...c, serial: num(c.serial), parent: c.parent == null ? null : num(c.parent), root: num(c.root),
      };
    }
    const roots = ((doc.roots as Record<string, unknown>[]) || []).map((r) => ({ ...r, serial: num(r.serial), opened: true }));
    const items = ((doc.items as Record<string, unknown>[]) || []).map((it) => ({ ...it, serial: num(it.serial), container: num(it.container), nameSource: "opl" }));
    const equipped = ((doc.equipped as Record<string, unknown>[]) || []).map((it) => ({ ...it, serial: num(it.serial), nameSource: "opl" }));
    const { version, ...rest } = doc;
    return {
      ...rest,
      schemaVersion: 2,
      scannedAt: naiveLocalToRfc3339(doc.scannedAt as string),
      shard: doc.shard ?? shard,
      adapter: tazuoAdapter(doc.character),
      roots, containers, items, equipped,
    } as UnvalidatedScan;
  }
  throw new TypeError("upgradeScan: document is neither v1 (version: 1) nor v2 (schemaVersion: 2)");
}
