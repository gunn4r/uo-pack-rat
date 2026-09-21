// validate.test.mts — tests for the zero-dependency JSON Schema subset validator (validate.mts).
// Tags are name prefixes: [smoke] [fast] [slow]. Run: node --test app/schema/validate.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate.mts";

test("[smoke] validate: a valid doc passes with no errors", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "integer" } } };
  const r = validate(schema, { a: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("[smoke] validate: wrong type reports /field + \"expected integer\"", () => {
  const schema = { type: "object", properties: { field: { type: "integer" } } };
  const r = validate(schema, { field: "1" });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0]!.path, "/field");
  assert.equal(r.errors[0]!.msg, "expected integer");
});

test("[smoke] validate: integer is distinct from number — a float fails an integer schema", () => {
  const schema = { type: "object", properties: { field: { type: "integer" } } };
  const r = validate(schema, { field: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.msg, "expected integer");
  const ok = validate({ type: "object", properties: { field: { type: "number" } } }, { field: 1.5 });
  assert.equal(ok.ok, true);
});

test("[smoke] validate: missing required reports / \"missing required: x\"", () => {
  const schema = { type: "object", required: ["x"], properties: { x: { type: "string" } } };
  const r = validate(schema, {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.path, "/");
  assert.equal(r.errors[0]!.msg, "missing required: x");
});

test("[smoke] validate: additionalProperties: false rejects extras", () => {
  const schema = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false };
  const r = validate(schema, { a: "ok", b: "nope" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === "/b" && /additional property/.test(e.msg)));
  assert.equal(validate(schema, { a: "ok" }).ok, true);
});

test("[smoke] validate: items errors carry the index path", () => {
  const schema = { type: "array", items: { type: "integer" } };
  const r = validate(schema, [1, "two", 3]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0]!.path, "/1");
  assert.equal(r.errors[0]!.msg, "expected integer");
});

test("[smoke] validate: enum rejects a value outside the list", () => {
  const schema = { type: "string", enum: ["a", "b"] };
  assert.equal(validate(schema, "a").ok, true);
  const r = validate(schema, "c");
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.path, "/");
});

test("[smoke] validate: pattern rejects a non-matching string", () => {
  const schema = { type: "string", pattern: "^\\d+$" };
  assert.equal(validate(schema, "123").ok, true);
  assert.equal(validate(schema, "12a").ok, false);
});

test("[smoke] validate: minimum rejects a too-small number", () => {
  const schema = { type: "number", minimum: 10 };
  assert.equal(validate(schema, 10).ok, true);
  assert.equal(validate(schema, 9).ok, false);
});

test("[smoke] validate: nested object errors carry the full path /a/b/c", () => {
  const schema = { type: "object", properties: { a: { type: "object", properties: { b: { type: "object", properties: { c: { type: "integer" } } } } } } };
  const r = validate(schema, { a: { b: { c: "nope" } } });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.path, "/a/b/c");
});

test("[smoke] validate: type: [\"string\",\"null\"] accepts null", () => {
  const schema = { type: ["string", "null"] };
  assert.equal(validate(schema, null).ok, true);
  assert.equal(validate(schema, "x").ok, true);
  assert.equal(validate(schema, 3).ok, false);
});

// ---- keywords not in the list above -------------------------------------------------------
test("[fast] validate: maximum and minLength are enforced", () => {
  assert.equal(validate({ type: "number", maximum: 5 }, 6).ok, false);
  assert.equal(validate({ type: "number", maximum: 5 }, 5).ok, true);
  assert.equal(validate({ type: "string", minLength: 3 }, "ab").ok, false);
  assert.equal(validate({ type: "string", minLength: 3 }, "abc").ok, true);
});

test("[fast] validate: unknown keywords are ignored", () => {
  const schema = { type: "string", someMadeUpKeyword: 42 };
  assert.equal(validate(schema, "anything").ok, true);
});

test("[fast] validate: only the first 20 errors are reported", () => {
  const schema = { type: "array", items: { type: "integer" } };
  const doc = new Array(30).fill("not a number");
  const r = validate(schema, doc);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 20);
});

test("[fast] validate: array type is checked with Array.isArray, not typeof", () => {
  assert.equal(validate({ type: "array" }, [1, 2]).ok, true);
  assert.equal(validate({ type: "array" }, { 0: 1, 1: 2 }).ok, false);
});

test("[fast] validate: object type excludes null and arrays", () => {
  assert.equal(validate({ type: "object" }, {}).ok, true);
  assert.equal(validate({ type: "object" }, null).ok, false);
  assert.equal(validate({ type: "object" }, []).ok, false);
});

test("[fast] validate: required and properties are own-property checks, not `in` (which walks the prototype chain)", () => {
  // `"toString" in {}` is true, so an `in`-based check reported a document as carrying a field it has
  // nothing of its own for — and then validated Object.prototype.toString (a function) against the
  // subschema. Every trust boundary in the app funnels through this file (Phase 7, Area 2, Minor 2).
  const r = validate({ type: "object", required: ["toString", "constructor", "valueOf"] }, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.msg), ["missing required: toString", "missing required: constructor", "missing required: valueOf"]);
  assert.equal(validate({ type: "object", properties: { toString: { type: "string" } } }, {}).ok, true);
  // a JSON-supplied OWN property of the same name is still checked
  assert.equal(validate({ type: "object", properties: { toString: { type: "string" } } }, JSON.parse('{"toString": 1}')).ok, false);
});

test("[fast] validate: maxLength bounds a string and maxItems bounds an array", () => {
  assert.equal(validate({ type: "string", maxLength: 4 }, "abcd").ok, true);
  const r = validate({ type: "string", maxLength: 4 }, "abcde");
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.msg, "longer than maxLength 4");
  assert.equal(validate({ type: "array", maxItems: 2 }, [1, 2]).ok, true);
  assert.equal(validate({ type: "array", maxItems: 2 }, [1, 2, 3]).errors[0]!.msg, "more than maxItems 2");
});

test("[fast] validate: additionalProperties given a schema applies it to every key `properties` does not name", () => {
  const schema = { type: "object", properties: { id: { type: "string" } }, additionalProperties: { type: "number" } };
  assert.equal(validate(schema, { id: "x", a: 1, b: 2 }).ok, true);
  const r = validate(schema, { id: "x", a: "no" });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.path, "/a");
  assert.equal(r.errors[0]!.msg, "expected number");
  // the boolean form keeps its old meaning
  assert.equal(validate({ type: "object", properties: { id: { type: "string" } }, additionalProperties: false }, { id: "x", a: 1 }).ok, false);
  assert.equal(validate({ type: "object", properties: { id: { type: "string" } }, additionalProperties: true }, { id: "x", a: 1 }).ok, true);
  // a hostile own "__proto__" key from JSON.parse is walked like any other own key
  assert.equal(validate(schema, JSON.parse('{"id": "x", "__proto__": "no"}')).ok, false);
});
