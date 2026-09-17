// scan-schema.mjs — the scan v2 schema, the v1→v2 upgrade-on-read, and epoch-based scan ordering.
// Browser-safe: no Node-only imports (no "node:fs"), so it can be served to the page exactly like
// vault-lib.mjs (which imports parseStamp from here for fold ordering) — see the /scan-schema.mjs
// static route in vault-server.mjs. Because it must stay fs-free, SCAN_V2_SCHEMA is an inline JS
// object rather than a read of app/schema/scan.v2.schema.json; scan-schema.test.mjs asserts the two
// stay identical, and app/schema/scan.v2.schema.json is the copy other (non-JS) tooling can read.
import { validate } from "./schema/validate.mjs";

// The 20 layer names the v1 scanner (adapters/tazuo/packrat-scanner.py, ALL_LAYERS) walks.
export const TAZUO_V1_CAPS = {
  layers: ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
    "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
    "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
  arms: true, bank: true, ground: true, nested: true, tooltips: "opl",
  bridge: ["highlight", "grab", "goto"],
};

// Keep byte-for-byte identical to app/schema/scan.v2.schema.json (a test enforces this).
export const SCAN_V2_SCHEMA = {
  "$comment": "Pack Rat scan file schema v2. Draft-07 style, restricted to the keyword subset app/schema/validate.mjs supports. additionalProperties is true at the top level (adapters may add fields, e.g. refresh's meta) but false inside adapter and adapter.capabilities, which are a closed contract every adapter must match exactly. This JSON literal must stay identical to SCAN_V2_SCHEMA in app/scan-schema.mjs (app/scan-schema.test.mjs asserts that) because scan-schema.mjs is served to the browser and cannot load this file via fs or a JSON import attribute.",
  type: "object",
  additionalProperties: true,
  required: ["schemaVersion", "character", "scannedAt", "adapter", "stats", "roots", "containers", "items", "equipped"],
  properties: {
    schemaVersion: { type: "integer", enum: [2] },
    character: { type: "string", minLength: 1 },
    scannedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?([+-]\\d{2}:\\d{2}|Z)$" },
    shard: { type: ["string", "null"] },
    account: { type: "string", pattern: "^[a-f0-9]{16,64}$", "$comment": "an opaque hashed account id (e.g. hex SHA-256 of the account name) — never the plaintext name" },
    adapter: {
      type: "object",
      additionalProperties: false,
      required: ["id", "version", "client", "clientVersion", "capabilities"],
      properties: {
        id: { type: "string", minLength: 1 },
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
    stats: { type: "object" },
    position: { type: ["object", "null"] },
    maxes: { type: ["object", "null"] },
    resists: { type: ["object", "null"] },
    skills: { type: "object" },
    roots: {
      type: "array",
      items: {
        type: "object",
        required: ["serial", "kind", "name", "opened"],
        properties: {
          serial: { type: "integer" },
          kind: { type: "string", enum: ["backpack", "bank", "ground"] },
          name: { type: "string" },
          opened: { type: "boolean" },
        },
      },
    },
    containers: { type: "object" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["serial", "container", "nameSource"],
        properties: {
          serial: { type: "integer" },
          container: { type: "integer" },
          graphic: { type: ["number", "null"] },
          hue: { type: ["number", "null"] },
          amount: { type: "number" },
          name: { type: "string" },
          nameSource: { type: "string", enum: ["opl", "label"] },
          tooltip: { type: "array", items: { type: "string" } },
        },
      },
    },
    equipped: {
      type: "array",
      items: {
        type: "object",
        required: ["serial", "nameSource"],
        properties: {
          serial: { type: "integer" },
          graphic: { type: ["number", "null"] },
          hue: { type: ["number", "null"] },
          amount: { type: "number" },
          name: { type: "string" },
          nameSource: { type: "string", enum: ["opl", "label"] },
          tooltip: { type: "array", items: { type: "string" } },
          layer: { type: ["string", "null"] },
        },
      },
    },
  },
};

export function validateScan(doc) {
  return validate(SCAN_V2_SCHEMA, doc);
}

// Date.parse already treats a date-time string with no offset as LOCAL time (ECMA-262), and
// resolves an offset/Z form as absolute — exactly the "naive stamp = local time" rule the v1→v2
// upgrade below relies on, so no bespoke parsing is needed here.
export function parseStamp(s) {
  return Date.parse(s);
}

const NAIVE_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

// Converts a naive local "YYYY-MM-DDTHH:MM:SS" wall-clock stamp (what packrat-scanner.py /
// packrat-refresh.py / the pre-Task-1 server's localStamp() all wrote) into RFC 3339 using
// THIS machine's UTC offset at that wall-clock instant (DST-correct: the offset is read off a Date
// built from the same y/m/d/h/mi/s, not off "now").
function naiveLocalToRfc3339(stamp) {
  const m = NAIVE_LOCAL_RE.exec(stamp);
  if (!m) throw new TypeError(`upgradeScan: not a naive local scannedAt: ${stamp}`);
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  const offMin = -dt.getTimezoneOffset();   // minutes EAST of UTC
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

const num = (v) => (v == null ? v : Number(v));

function tazuoAdapter(character) {
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
export function upgradeScan(raw, { shard } = {}) {
  if (raw && typeof raw === "object" && raw.schemaVersion === 2) {
    return { ...raw, shard: raw.shard ?? shard };
  }
  if (raw && typeof raw === "object" && raw.version === 1) {
    const containers = {};
    for (const [key, c] of Object.entries(raw.containers || {})) {
      containers[String(Number(key))] = {
        ...c, serial: num(c.serial), parent: c.parent == null ? null : num(c.parent), root: num(c.root),
      };
    }
    const roots = (raw.roots || []).map((r) => ({ ...r, serial: num(r.serial), opened: true }));
    const items = (raw.items || []).map((it) => ({ ...it, serial: num(it.serial), container: num(it.container), nameSource: "opl" }));
    const equipped = (raw.equipped || []).map((it) => ({ ...it, serial: num(it.serial), nameSource: "opl" }));
    const { version, ...rest } = raw;
    return {
      ...rest,
      schemaVersion: 2,
      scannedAt: naiveLocalToRfc3339(raw.scannedAt),
      shard: raw.shard ?? shard,
      adapter: tazuoAdapter(raw.character),
      roots, containers, items, equipped,
    };
  }
  throw new TypeError("upgradeScan: document is neither v1 (version: 1) nor v2 (schemaVersion: 2)");
}
