// build-schema-types.test.mts — tests for the JSON Schema -> TypeScript generator (build-schema-types.mts).
// Tags are name prefixes: [smoke] [fast] [slow]. Run: node --test scripts/build-schema-types.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaToTypeSource } from "./build-schema-types.mts";

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
