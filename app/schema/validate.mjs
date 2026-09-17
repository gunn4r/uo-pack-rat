// validate.mjs — a hand-written JSON Schema SUBSET validator. Zero dependencies, browser-safe (no
// Node imports), served to the page as well as used from Node tests/servers. Supports exactly the
// keywords Pack Rat's own contracts need: type (string or array; "integer" is distinct from
// "number"), properties, required, additionalProperties (boolean only — no schema form), items
// (a single schema applied to every array element), enum, pattern, minimum, maximum, minLength.
// "nullable" has no dedicated keyword — express it as type: ["string", "null"] etc. Every other
// keyword (e.g. patternProperties, oneOf, $ref) is silently ignored: this is a subset, not a full
// implementation, and every schema in this repo is written to stay inside it.
//
// validate(schema, doc, path = "") → { ok, errors: [{ path, msg }] }. Only the first 20 errors are
// collected (a huge invalid document should not turn validation into a second parse pass).
const MAX_ERRORS = 20;

function typeMatches(value, t) {
  switch (t) {
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    default: return true;   // an unrecognized type name is not this validator's job to enforce
  }
}

function walk(schema, value, path, errors) {
  if (errors.length >= MAX_ERRORS) return;
  const at = path || "/";

  if (schema.type != null) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push({ path: at, msg: `expected ${types.join(" or ")}` });
    }
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push({ path: at, msg: `expected one of ${JSON.stringify(schema.enum)}` });
  }
  if (schema.pattern != null && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push({ path: at, msg: `does not match pattern ${schema.pattern}` });
  }
  if (schema.minLength != null && typeof value === "string" && value.length < schema.minLength) {
    errors.push({ path: at, msg: `shorter than minLength ${schema.minLength}` });
  }
  if (schema.minimum != null && typeof value === "number" && value < schema.minimum) {
    errors.push({ path: at, msg: `less than minimum ${schema.minimum}` });
  }
  if (schema.maximum != null && typeof value === "number" && value > schema.maximum) {
    errors.push({ path: at, msg: `greater than maximum ${schema.maximum}` });
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push({ path: at, msg: `missing required: ${key}` });
        if (errors.length >= MAX_ERRORS) return;
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) {
          walk(sub, value[key], `${path}/${key}`, errors);
          if (errors.length >= MAX_ERRORS) return;
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${path}/${key}`, msg: `additional property not allowed: ${key}` });
          if (errors.length >= MAX_ERRORS) return;
        }
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(schema.items, value[i], `${path}/${i}`, errors);
      if (errors.length >= MAX_ERRORS) return;
    }
  }
}

export function validate(schema, doc, path = "") {
  const errors = [];
  walk(schema, doc, path, errors);
  return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS) };
}
