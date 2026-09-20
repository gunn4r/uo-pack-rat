// rules.mts — loads a shard's rules file (app/rules/<id>.json, or userRulesDir/<id>.json first when
// given) and validates it against app/schema/rules.v1.schema.json before anything downstream sees
// it. Node-only (reads files) — never imported by vault-lib.mts, which only exposes setRules/
// getRules. The server calls loadRules() once at startup and again on a PUT /api/settings shard
// change; the page instead fetches the already-loaded rules object from GET /api/rules.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { RulesV1 } from "./schema/types.d.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, "rules");

// A parsed JSON file is unknown provenance until something downstream narrows it — readJson never
// claims a shape of its own (mirrors scripts/build-schema-types.mts's readJson).
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// The rules v1 JSON Schema itself is checked into this repo, not user- or shard-file-controlled, so
// this one cast is trusted rather than re-validated — it's the schema validate() checks every rules
// file AGAINST, not a rules file itself.
const SCHEMA = readJson(join(HERE, "schema", "rules.v1.schema.json")) as ValidatorSchema;

export const DEFAULT_SHARD = "uoalive";

interface RulesEntry {
  id: string;
  name: string;
  source: "builtin" | "user";
  path: string;
}

function loadFile(path: string): RulesV1 {
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (e) {
    throw new Error(`could not read rules file ${path}: ${(e as Error).message}`);
  }
  const { ok, errors } = validate(SCHEMA, raw);
  if (!ok) throw new Error(`invalid rules file ${path}: ${errors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
  // validate() only proves raw matches the ValidatorSchema keyword subset above, at runtime — it has
  // no way to hand back a narrowed RulesV1 (it's shared by every schema in this repo, not specific to
  // this one), so this cast is the trust boundary, taken only after the check just above passed.
  return raw as RulesV1;
}

// parseId(path) → {id, name} read straight off the raw JSON — no schema validation. This is
// deliberately weaker than loadFile: listRules() must be able to discover (and offer in the picker)
// a file that has a valid id but is otherwise broken, so that loadRules() can later fail on THAT
// file and name its path, rather than the file silently vanishing from the map and loadRules()
// reporting a misleading "unknown shard". Only `id` is required; a missing/non-string `name` falls
// back to `id` (loadFile's real schema validation is what ultimately rejects a file missing `name`).
function parseId(path: string): { id: string; name: string } {
  const raw = readJson(path) as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`rules file ${path} has no string "id"`);
  return { id: raw.id, name: typeof raw.name === "string" ? raw.name : raw.id };
}

// listRules({userRulesDir}) → [{id, name, source, path}], every builtin plus every file in
// userRulesDir, keyed by each file's OWN `id` field (not its filename) so a user file can override a
// builtin of the same id under any filename. Builtins are listed first, then user files — both
// directories read in sorted filename order for determinism — so a user file always overrides a
// builtin of the same id, and if two files in the same directory somehow share an id, the
// alphabetically-last filename wins. A file that fails to parse or has no id is skipped, not thrown —
// this is a best-effort enumeration for the shard picker, not a hard load; a file that parses (has an
// id) but is otherwise invalid IS listed here, so loadRules() can fail loudly on it by path instead of
// it just vanishing.
export function listRules({ userRulesDir }: { userRulesDir?: string | undefined } = {}): RulesEntry[] {
  const out = new Map<string, RulesEntry>();
  for (const f of readdirSync(BUILTIN_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const path = join(BUILTIN_DIR, f);
    try {
      const { id, name } = parseId(path);
      out.set(id, { id, name, source: "builtin", path });
    } catch { /* a broken builtin file just doesn't appear */ }
  }
  if (userRulesDir && existsSync(userRulesDir)) {
    for (const f of readdirSync(userRulesDir).filter((f) => f.endsWith(".json")).sort()) {
      const path = join(userRulesDir, f);
      try {
        const { id, name } = parseId(path);
        out.set(id, { id, name, source: "user", path });   // overrides a builtin of the same id
      } catch { /* a broken user file just doesn't appear */ }
    }
  }
  return [...out.values()];
}

// loadRules(id, {userRulesDir}) → the rules object for that shard id, resolved THROUGH listRules()'s
// {id → path} map — never by filename — so listing and loading can never disagree about which file
// answers for a given id. Throws naming the shard id when nothing in the map has it; throws naming
// the file path (via loadFile) when the file that map points at fails to parse or fails schema
// validation.
export function loadRules(id: string, { userRulesDir }: { userRulesDir?: string | undefined } = {}): RulesV1 {
  const entry = listRules({ userRulesDir }).find((r) => r.id === id);
  if (!entry) throw new Error(`no rules file for shard "${id}"`);
  return loadFile(entry.path);
}
