// validate.mts — a hand-written JSON Schema SUBSET validator. Zero dependencies, browser-safe (no
// Node imports), served to the page as well as used from Node tests/servers. Supports exactly the
// keywords Pack Rat's own contracts need: type (string or array; "integer" is distinct from
// "number"), properties, required, additionalProperties (false to close a shape, or a schema applied
// to every key `properties` does not name — which is how an arbitrarily-keyed map such as a scan's
// stats/skills/containers gets its values checked), items (a single schema applied to every array
// element), enum, pattern, minimum, maximum, minLength, maxLength, maxItems.
// "nullable" has no dedicated keyword — express it as type: ["string", "null"] etc. Every other
// keyword (e.g. patternProperties, oneOf, $ref) is silently ignored: this is a subset, not a full
// implementation, and every schema in this repo is written to stay inside it.
//
// validate(schema, doc, path = "") → { ok, errors: [{ path, msg }] }. Only the first 20 errors are
// collected (a huge invalid document should not turn validation into a second parse pass).
const MAX_ERRORS = 20;

// The runtime keyword subset above, as a type — deliberately its own small shape rather than a
// reach into scripts/build-schema-types.mts's JsonSchema (that one understands $ref/$defs and
// additionalProperties-as-schema for TYPE GENERATION; this one is what this file's own `walk`
// actually interprets at runtime). Every field is optional: a schema specifying none of them
// matches anything, exactly like the untyped original.
export interface ValidatorSchema {
  type?: string | string[];
  properties?: Record<string, ValidatorSchema>;
  required?: string[];
  additionalProperties?: boolean | ValidatorSchema;
  items?: ValidatorSchema;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
}

// additionalProperties is `false` (close the shape), `true`/absent (anything goes), or a subschema to
// apply to every unnamed key — the three forms this validator distinguishes.
const isSubschema = (v: boolean | ValidatorSchema | undefined): v is ValidatorSchema => v !== null && typeof v === "object";

export interface ValidationError {
  path: string;
  msg: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

function typeMatches(value: unknown, t: string): boolean {
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

function walk(schema: ValidatorSchema, value: unknown, path: string, errors: ValidationError[]): void {
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
  if (schema.maxLength != null && typeof value === "string" && value.length > schema.maxLength) {
    errors.push({ path: at, msg: `longer than maxLength ${schema.maxLength}` });
  }
  if (schema.maxItems != null && Array.isArray(value) && value.length > schema.maxItems) {
    errors.push({ path: at, msg: `more than maxItems ${schema.maxItems}` });
  }
  if (schema.minimum != null && typeof value === "number" && value < schema.minimum) {
    errors.push({ path: at, msg: `less than minimum ${schema.minimum}` });
  }
  if (schema.maximum != null && typeof value === "number" && value > schema.maximum) {
    errors.push({ path: at, msg: `greater than maximum ${schema.maximum}` });
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    // Narrowed to "a plain object", but `value` stays `unknown`-shaped past this point — an
    // untrusted document's own keys are not known to the type system, so indexing needs a cast.
    // Membership is an OWN-property test (hasOwnProperty, the idiom vault-lib.mts's parseTooltip
    // already uses), never `key in obj`: `in` walks the prototype chain, so a schema requiring or
    // describing "toString"/"constructor"/"valueOf" read Object.prototype's own members off a
    // document that has nothing of the sort (Phase 7 security review, Area 2, Minor 2).
    const obj = value as Record<string, unknown>;
    const owns = (key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);
    if (schema.required) {
      for (const key of schema.required) {
        if (!owns(key)) errors.push({ path: at, msg: `missing required: ${key}` });
        if (errors.length >= MAX_ERRORS) return;
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (owns(key)) {
          walk(sub, obj[key], `${path}/${key}`, errors);
          if (errors.length >= MAX_ERRORS) return;
        }
      }
    }
    if (schema.additionalProperties === false || isSubschema(schema.additionalProperties)) {
      const named = new Set(Object.keys(schema.properties || {}));
      const sub = isSubschema(schema.additionalProperties) ? schema.additionalProperties : null;
      for (const key of Object.keys(obj)) {
        if (named.has(key)) continue;
        if (sub) walk(sub, obj[key], `${path}/${key}`, errors);
        else errors.push({ path: `${path}/${key}`, msg: `additional property not allowed: ${key}` });
        if (errors.length >= MAX_ERRORS) return;
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    // Array.isArray narrows `value` for the condition above but the element type is still whatever
    // the untrusted document actually holds — read it as unknown[], same reasoning as `obj` above.
    const arr = value as unknown[];
    for (let i = 0; i < arr.length; i++) {
      walk(schema.items, arr[i], `${path}/${i}`, errors);
      if (errors.length >= MAX_ERRORS) return;
    }
  }
}

export function validate(schema: ValidatorSchema, doc: unknown, path = ""): ValidationResult {
  const errors: ValidationError[] = [];
  walk(schema, doc, path, errors);
  return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS) };
}
