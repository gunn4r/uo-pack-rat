// build-schema-types.test.mts — tests for the JSON Schema -> TypeScript generator (build-schema-types.mts).
// Tags are name prefixes: [smoke] [fast] [slow]. Run: node --test scripts/build-schema-types.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaToTypeSource, buildSchemaTypes } from "./build-schema-types.mts";

test("[fast] required and optional properties differ", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" }, note: { type: "string" } },
  });
  assert.match(src, /id: string;/);
  assert.match(src, /note\?: string;/);
});

test("[fast] arrays, enums and unions", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["tags", "kind", "count"],
    properties: {
      tags: { type: "array", items: { type: "string" } },
      kind: { enum: ["a", "b"] },
      count: { type: ["number", "null"] },
    },
  });
  assert.match(src, /tags: string\[\];/);
  assert.match(src, /kind: "a" \| "b";/);
  assert.match(src, /count: number \| null;/);
});

test("[fast] a nested object becomes its own exported type", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["item"],
    properties: { item: { type: "object", required: ["serial"], properties: { serial: { type: "number" } } } },
  });
  assert.match(src, /export type DemoItem = \{/);
  assert.match(src, /item: DemoItem;/);
});

test("[fast] additionalProperties becomes an index signature", () => {
  const src = schemaToTypeSource("Demo", { type: "object", additionalProperties: { type: "number" } });
  assert.match(src, /\[key: string\]: number;/);
});

test("[fast] an unsupported construct fails loudly rather than emitting any", () => {
  assert.throws(() => schemaToTypeSource("Demo", { type: "object", properties: { x: { oneOf: [{ type: "string" }] } } }), /oneOf/);
});

test("[fast] validation-only keywords are accepted and ignored, not mistaken for an unsupported construct", () => {
  // These bound a VALUE, not a shape (app/schema/validate.mts enforces them at run time), so they
  // have no type-level meaning — but the generator throws on anything it doesn't recognise, and it
  // runs ahead of every unpackaged launch, so an unlisted one is a startup error dialog rather than
  // a looser type. Phase 7 security review, Area 2: the scan schema grew all of these at once.
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z]+$" },
      serial: { type: "integer", minimum: 0, maximum: 4294967295 },
      tooltip: { type: "array", maxItems: 256, items: { type: "string", maxLength: 512 } },
    },
  });
  assert.match(src, /name: string;/);
  assert.match(src, /serial\?: number;/);
  assert.match(src, /tooltip\?: string\[\];/);
  // and the loud failure is still loud for a construct that really would change the type
  assert.throws(() => schemaToTypeSource("Demo", { type: "object", properties: { x: { type: "string", patternProperties: {} } } }), /patternProperties/);
});

// ---- constructs the pinned requirements call for but the tests above don't exercise -----------

test("[fast] an integer enum emits a numeric literal union (schemaVersion-style)", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["schemaVersion"],
    properties: { schemaVersion: { type: "integer", enum: [2] } },
  });
  assert.match(src, /schemaVersion: 2;/);
});

test("[fast] a bare object (no properties, no additionalProperties) is Record<string, unknown>, not named", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["stats"],
    properties: { stats: { type: "object" } },
  });
  assert.match(src, /stats: Record<string, unknown>;/);
  assert.doesNotMatch(src, /export type DemoStats/);
});

test("[fast] a bare array (no items) is unknown[]", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["breakpoints"],
    properties: { breakpoints: { type: "array" } },
  });
  assert.match(src, /breakpoints: unknown\[\];/);
});

test("[fast] an array of objects names its item type and each is generated once", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["roots"],
    properties: {
      roots: { type: "array", items: { type: "object", required: ["serial"], properties: { serial: { type: "number" } } } },
    },
  });
  assert.match(src, /roots: DemoRootsItem\[\];/);
  assert.match(src, /export type DemoRootsItem = \{\n {2}serial: number;\n\};/);
});

test("[fast] a local $ref to #/$defs resolves, and repeated refs share one declaration", () => {
  const src = schemaToTypeSource("Demo", {
    type: "object",
    required: ["a", "b"],
    properties: { a: { $ref: "#/$defs/Point" }, b: { $ref: "#/$defs/Point" } },
    $defs: { Point: { type: "object", required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } } },
  });
  assert.match(src, /a: DemoPoint;/);
  assert.match(src, /b: DemoPoint;/);
  const decls = src.match(/export type DemoPoint = /g) ?? [];
  assert.equal(decls.length, 1, "the ref target is declared exactly once even though it's used twice");
});

test("[fast] items given as a tuple (an array of schemas) is unsupported", () => {
  assert.throws(
    () => schemaToTypeSource("Demo", { type: "object", properties: { pair: { type: "array", items: [{ type: "string" }, { type: "number" }] } } }),
    /items/,
  );
});

test("[fast] a schema with neither type, enum nor $ref throws rather than emitting any", () => {
  assert.throws(() => schemaToTypeSource("Demo", { type: "object", properties: { x: {} } }), /no "type", "enum" or "\$ref"/);
});

// ---- fix round 1 (task-2-review.md findings #1, #2, #3, #5, #6, #7) ----------------------------

test("[fast] a $ref cycle throws a named error instead of overflowing the stack", () => {
  assert.throws(
    () =>
      schemaToTypeSource("Demo", {
        type: "object",
        required: ["a"],
        properties: { a: { $ref: "#/$defs/A" } },
        $defs: { A: { type: "object", required: ["self"], properties: { self: { $ref: "#/$defs/A" } } } },
      }),
    /\$ref cycle/,
  );
});

test("[fast] an enum containing an object throws rather than emitting a wrong-but-valid type", () => {
  assert.throws(() => schemaToTypeSource("Demo", { type: "object", properties: { x: { enum: [{ a: 1 }] } } }), /enum/);
});

test("[fast] an enum containing an array throws rather than emitting a wrong-but-valid type", () => {
  assert.throws(() => schemaToTypeSource("Demo", { type: "object", properties: { x: { enum: [[1, 2]] } } }), /enum/);
});

test("[fast] an enum of strings/numbers/booleans/null still works (only object/array members are rejected)", () => {
  const src = schemaToTypeSource("Demo", { type: "object", required: ["x"], properties: { x: { enum: [1, "a", true, null] } } });
  assert.match(src, /x: 1 \| "a" \| true \| null;/);
});

test("[fast] items: false throws naming items specifically, not the generic no-type message", () => {
  assert.throws(
    () => schemaToTypeSource("Demo", { type: "object", properties: { x: { type: "array", items: false } } }),
    /items/,
  );
});

test("[fast] two different schema locations that derive the same name collide even with identical shapes", () => {
  // item.x -> DemoItemX, and sibling property itemX -> DemoItemX: same generated name, same shape
  // ({ serial: number }), but two different JSON pointers — must not merge silently.
  assert.throws(
    () =>
      schemaToTypeSource("Demo", {
        type: "object",
        required: ["item", "itemX"],
        properties: {
          item: {
            type: "object",
            required: ["x"],
            properties: { x: { type: "object", required: ["serial"], properties: { serial: { type: "number" } } } },
          },
          itemX: { type: "object", required: ["serial"], properties: { serial: { type: "number" } } },
        },
      }),
    /collision/,
  );
});

test("[fast] buildSchemaTypes against the real four schema files exports the 17 expected type names", () => {
  const out = join(mkdtempSync(join(tmpdir(), "schema-types-")), "types.d.mts");
  buildSchemaTypes({ out });
  const src = readFileSync(out, "utf8");
  const expected = [
    "ScanV2", "ScanV2Adapter", "ScanV2AdapterCapabilities", "ScanV2RootsItem", "ScanV2ItemsItem", "ScanV2EquippedItem",
    "ScanV2SkillsValue", "ScanV2ContainersValue",
    "BridgeV1Command", "BridgeV1Result", "BridgeV1Status", "BridgeV1StatusCounts",
    "RulesV1", "RulesV1ResistSkillBonus", "RulesV1RarityItem", "RulesV1RaceLock",
    "ProfilesV2",
  ];
  for (const name of expected) assert.match(src, new RegExp(`export type ${name} = `), name);
});

test("[fast] buildSchemaTypes only rewrites the output when its content actually changed", () => {
  const out = join(mkdtempSync(join(tmpdir(), "schema-types-")), "types.d.mts");
  buildSchemaTypes({ out });
  const first = statSync(out).mtimeMs;
  buildSchemaTypes({ out });
  assert.equal(statSync(out).mtimeMs, first, "untouched on a no-op rebuild");
});
