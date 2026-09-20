// build-schema-types.mts — derive app/schema/types.d.mts from the four JSON Schema files that are
// the runtime authority for Pack Rat's scan, bridge, rules and profile shapes (app/schema/*.schema.json,
// enforced at runtime by app/schema/validate.mjs). Hand-written types would be a second authority
// free to drift from what the validator actually checks; this generates one from the other instead.
//
// schemaToTypeSource(name, schema) turns one JSON Schema object into TypeScript source: an
// `export type <name> = ...` for the schema itself, plus one more `export type` per named
// sub-object it defines — every `type: "object"` that carries a `properties` key, wherever it's
// nested (a property value, an array's `items`, a `$ref` target). It understands exactly the
// keyword subset below; anything else THROWS, naming the construct and the JSON pointer where it
// appeared, because silently emitting `any` for a construct it doesn't understand would reintroduce
// exactly the drift this generator exists to prevent.
//
// Understood keywords: type (a string, or an array of strings unioned), enum (a union of literal
// types), properties, required, additionalProperties (schema form only — becomes an index
// signature; the boolean form has no type-level meaning under TypeScript's structural typing, so
// it's consumed but otherwise a no-op), items (single-schema form — tuple form is unsupported),
// and $ref (local-document only: "#/$defs/<name>" or "#/definitions/<name>", resolved against the
// document passed to schemaToTypeSource; repeated refs to the same target share one declaration).
// pattern, minLength, minimum and maximum constrain values, not shapes, so they're consumed and
// ignored for the same reason the metadata keyword $comment is.
//
// buildSchemaTypes() reads the four schema files and writes app/schema/types.d.mts, only rewriting
// it when the generated content actually changed. bridge.v1.schema.json is not itself one schema —
// per its own header comment it holds three independent schemas (command, result, status),
// validated separately — so it produces three root types (BridgeV1Command, BridgeV1Result,
// BridgeV1Status) rather than a single combined BridgeV1.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SCHEMA_DIR = join(ROOT, "app", "schema");
export const TYPES_OUT = join(SCHEMA_DIR, "types.d.mts");

// The subset of JSON Schema this generator understands — see the keyword list in the header comment.
// A parsed schema file is `unknown` until narrowed into this by asJsonSchema/isSchemaObject below.
type JsonSchema = {
  $comment?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  pattern?: string;
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

// Keywords with no type-level meaning — collected (so they don't trip the "unsupported construct"
// check) and then ignored. $defs/definitions are metadata for $ref to find, not a shape of their own.
const IGNORED_KEYWORDS = new Set(["$comment", "pattern", "minLength", "minimum", "maximum", "$defs", "definitions"]);
const STRUCTURAL_KEYWORDS = ["type", "properties", "required", "additionalProperties", "items"] as const;

type Ctx = {
  readonly namePrefix: string;
  readonly root: JsonSchema;
  readonly decls: Map<string, string>; // name -> body text, in first-seen order
  readonly refCache: Map<string, string>; // $ref string -> already-resolved type expression
};

function isSchemaObject(v: unknown): v is JsonSchema {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asJsonSchema(v: unknown, pointer: string): JsonSchema {
  if (!isSchemaObject(v)) throw new Error(`schema at ${pointer} is not a JSON object`);
  return v;
}

function unsupported(keyword: string, pointer: string): Error {
  return new Error(`unsupported schema construct "${keyword}" at ${pointer}`);
}

function pascalCase(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function propertyKey(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function registerDecl(ctx: Ctx, name: string, body: string, pointer: string): void {
  const existing = ctx.decls.get(name);
  if (existing !== undefined && existing !== body) {
    throw new Error(`type name collision: "${name}" would be generated with two different shapes (last seen at ${pointer})`);
  }
  ctx.decls.set(name, body);
}

function resolveRefTarget(root: JsonSchema, ref: string, pointer: string): { target: JsonSchema; localName: string } {
  const m = /^#\/(\$defs|definitions)\/([A-Za-z0-9_]+)$/.exec(ref);
  if (m === null) throw new Error(`unsupported "$ref" value "${ref}" at ${pointer} — only local #/$defs/<name> or #/definitions/<name> refs are supported`);
  const bucketName = m[1];
  const localName = m[2];
  if (bucketName === undefined || localName === undefined) throw new Error(`unsupported "$ref" value "${ref}" at ${pointer}`);
  const bucket = bucketName === "$defs" ? root.$defs : root.definitions;
  const target = bucket?.[localName];
  if (target === undefined) throw new Error(`"$ref": "${ref}" at ${pointer} does not resolve within the document (no ${bucketName}/${localName})`);
  return { target, localName };
}

// A union type is only ambiguous when it's embedded directly inside `T[]` ("A | B[]" parses as
// "A | (B[])"); a plain property value never needs the parens ("count: number | null;", not
// "count: (number | null);" — the given test pins this exact, unparenthesized form).
function arrayItemType(ctx: Ctx, itemSchema: JsonSchema, pointer: string, suggestedName: string): string {
  const itemType = typeRef(ctx, itemSchema, pointer, suggestedName);
  const isUnion = (Array.isArray(itemSchema.type) && itemSchema.type.length > 1) || (Array.isArray(itemSchema.enum) && itemSchema.enum.length > 1);
  return isUnion ? `(${itemType})[]` : `${itemType}[]`;
}

// Builds the `{ ... }` literal for an object schema — properties (required plain, optional `?:`)
// plus an index signature when additionalProperties is given as a schema. Used both for a nested
// named object type and, at the root, as the body of `export type <name> = { ... };` directly.
function objectLiteralBody(ctx: Ctx, schema: JsonSchema, pointer: string, suggestedName: string): string {
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const propPointer = `${pointer}/properties/${key}`;
    const t = typeRef(ctx, sub, propPointer, `${suggestedName}${pascalCase(key)}`);
    lines.push(`  ${propertyKey(key)}${required.has(key) ? "" : "?"}: ${t};`);
  }
  if (isSchemaObject(schema.additionalProperties)) {
    const vt = typeRef(ctx, schema.additionalProperties, `${pointer}/additionalProperties`, `${suggestedName}Value`);
    lines.push(`  [key: string]: ${vt};`);
  }
  return lines.length > 0 ? `{\n${lines.join("\n")}\n}` : "{}";
}

function resolveOnePrimitive(ctx: Ctx, schema: JsonSchema, t: string, pointer: string, suggestedName: string, inlineTopLevelObject: boolean): string {
  switch (t) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      if (schema.items === undefined) return "unknown[]";
      if (Array.isArray(schema.items)) throw unsupported("items (tuple form)", `${pointer}/items`);
      return arrayItemType(ctx, schema.items, `${pointer}/items`, `${suggestedName}Item`);
    }
    case "object": {
      const hasProps = schema.properties !== undefined;
      const hasAdditional = isSchemaObject(schema.additionalProperties);
      if (!hasProps && !hasAdditional) return "Record<string, unknown>";
      const body = objectLiteralBody(ctx, schema, pointer, suggestedName);
      // Only a nested object that carries its own `properties` earns a named export (the pinned
      // rule); the root is always inlined by its caller, and a nested additionalProperties-only
      // object (no `properties` of its own) is inlined too, since the naming rule doesn't cover it.
      if (inlineTopLevelObject || !hasProps) return body;
      registerDecl(ctx, suggestedName, body, pointer);
      return suggestedName;
    }
    default:
      throw new Error(`unsupported "type": ${JSON.stringify(t)} at ${pointer}`);
  }
}

// The shared resolver for both a root schema (inlineTopLevelObject: true — return the literal body
// text so schemaToTypeSource can wrap it in `export type <name> = ...`) and every nested reference
// (inlineTopLevelObject: false — an object-with-properties gets named instead of inlined).
function resolveTypeParts(ctx: Ctx, schema: JsonSchema, pointer: string, suggestedName: string, inlineTopLevelObject: boolean): string {
  const keys = Object.keys(schema);

  if (schema.$ref !== undefined) {
    const stray = keys.filter((k) => k !== "$ref" && k !== "$comment");
    if (stray.length > 0) throw unsupported(`$ref combined with "${stray[0]}"`, pointer);
    const cacheKey = schema.$ref;
    const cached = ctx.refCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const { target, localName } = resolveRefTarget(ctx.root, schema.$ref, pointer);
    const defsName = `${ctx.namePrefix}${pascalCase(localName)}`;
    const result = resolveTypeParts(ctx, target, schema.$ref, defsName, false);
    ctx.refCache.set(cacheKey, result);
    return result;
  }

  // Everything this generator understands, named up front, so any other keyword — oneOf, anyOf,
  // patternProperties, const, not, … — is caught here and throws, rather than being silently
  // skipped the way app/schema/validate.mjs's runtime subset intentionally does.
  const KNOWN = new Set<string>(["type", "enum", ...STRUCTURAL_KEYWORDS, ...IGNORED_KEYWORDS]);
  const stray = keys.filter((k) => !KNOWN.has(k));
  if (stray.length > 0) throw unsupported(stray[0]!, pointer);

  if (schema.enum !== undefined) {
    if (schema.enum.length === 0) throw new Error(`empty "enum" at ${pointer}`);
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }

  if (schema.type === undefined) {
    throw new Error(`schema at ${pointer} has no "type", "enum" or "$ref" to generate a type from`);
  }

  const typeList = Array.isArray(schema.type) ? schema.type : [schema.type];
  const parts = typeList.map((t) => resolveOnePrimitive(ctx, schema, t, pointer, suggestedName, inlineTopLevelObject));
  return parts.length === 1 ? parts[0]! : parts.join(" | ");
}

function typeRef(ctx: Ctx, schema: JsonSchema, pointer: string, suggestedName: string): string {
  return resolveTypeParts(ctx, schema, pointer, suggestedName, false);
}

export function schemaToTypeSource(name: string, schema: unknown): string {
  const root = asJsonSchema(schema, "#");
  const ctx: Ctx = { namePrefix: name, root, decls: new Map(), refCache: new Map() };
  const body = resolveTypeParts(ctx, root, "#", name, true);
  const blocks = [`export type ${name} = ${body};`];
  for (const [declName, declBody] of ctx.decls) blocks.push(`export type ${declName} = ${declBody};`);
  return blocks.join("\n\n") + "\n";
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function asPlainObject(v: unknown, path: string): Record<string, unknown> {
  if (!isSchemaObject(v)) throw new Error(`${path} is not a JSON object`);
  return v;
}

export function buildSchemaTypes(): string {
  const files = {
    scan: join(SCHEMA_DIR, "scan.v2.schema.json"),
    bridge: join(SCHEMA_DIR, "bridge.v1.schema.json"),
    rules: join(SCHEMA_DIR, "rules.v1.schema.json"),
    profiles: join(SCHEMA_DIR, "profiles.v2.schema.json"),
  };

  const bridgeDoc = asPlainObject(readJson(files.bridge), files.bridge);

  const sections = [
    schemaToTypeSource("ScanV2", readJson(files.scan)),
    schemaToTypeSource("BridgeV1Command", bridgeDoc.command),
    schemaToTypeSource("BridgeV1Result", bridgeDoc.result),
    schemaToTypeSource("BridgeV1Status", bridgeDoc.status),
    schemaToTypeSource("RulesV1", readJson(files.rules)),
    schemaToTypeSource("ProfilesV2", readJson(files.profiles)),
  ];

  const sourceList = Object.values(files).map((f) => relative(ROOT, f)).join(", ");
  const content = `// generated from ${sourceList} by scripts/build-schema-types.mts — do not edit\n\n${sections.join("\n")}`;

  mkdirSync(dirname(TYPES_OUT), { recursive: true });
  if (existsSync(TYPES_OUT) && readFileSync(TYPES_OUT, "utf8") === content) return TYPES_OUT;
  writeFileSync(TYPES_OUT, content);
  return TYPES_OUT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(buildSchemaTypes());
