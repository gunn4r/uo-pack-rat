// validate.test.mjs — tests for the zero-dependency JSON Schema subset validator (validate.mjs).
// Tags are name prefixes: [smoke] [fast] [slow]. Run: node --test app/schema/validate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate.mjs";

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
  assert.equal(r.errors[0].path, "/field");
  assert.equal(r.errors[0].msg, "expected integer");
});

test("[smoke] validate: integer is distinct from number — a float fails an integer schema", () => {
  const schema = { type: "object", properties: { field: { type: "integer" } } };
  const r = validate(schema, { field: 1.5 });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].msg, "expected integer");
  const ok = validate({ type: "object", properties: { field: { type: "number" } } }, { field: 1.5 });
  assert.equal(ok.ok, true);
});

test("[smoke] validate: missing required reports / \"missing required: x\"", () => {
  const schema = { type: "object", required: ["x"], properties: { x: { type: "string" } } };
  const r = validate(schema, {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, "/");
  assert.equal(r.errors[0].msg, "missing required: x");
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
  assert.equal(r.errors[0].path, "/1");
  assert.equal(r.errors[0].msg, "expected integer");
});

test("[smoke] validate: enum rejects a value outside the list", () => {
  const schema = { type: "string", enum: ["a", "b"] };
  assert.equal(validate(schema, "a").ok, true);
  const r = validate(schema, "c");
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, "/");
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
  assert.equal(r.errors[0].path, "/a/b/c");
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
