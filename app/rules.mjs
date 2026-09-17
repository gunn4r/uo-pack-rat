// rules.mjs — loads a shard's rules file (app/rules/<id>.json, or userRulesDir/<id>.json first when
// given) and validates it against app/schema/rules.v1.schema.json before anything downstream sees
// it. Node-only (reads files) — never imported by vault-lib.mjs, which only exposes setRules/
// getRules. The server calls loadRules() once at startup and again on a PUT /api/settings shard
// change; the page instead fetches the already-loaded rules object from GET /api/rules.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./schema/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, "rules");
const SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "rules.v1.schema.json"), "utf8"));

export const DEFAULT_SHARD = "uoalive";

function loadFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`could not read rules file ${path}: ${e.message}`);
  }
  const { ok, errors } = validate(SCHEMA, raw);
  if (!ok) throw new Error(`invalid rules file ${path}: ${errors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
  return raw;
}

// parseId(path) → {id, name} read straight off the raw JSON — no schema validation. This is
// deliberately weaker than loadFile: listRules() must be able to discover (and offer in the picker)
// a file that has a valid id but is otherwise broken, so that loadRules() can later fail on THAT
// file and name its path, rather than the file silently vanishing from the map and loadRules()
// reporting a misleading "unknown shard". Only `id` is required; a missing/non-string `name` falls
// back to `id` (loadFile's real schema validation is what ultimately rejects a file missing `name`).
function parseId(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
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
export function listRules({ userRulesDir } = {}) {
  const out = new Map();
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
export function loadRules(id, { userRulesDir } = {}) {
  const entry = listRules({ userRulesDir }).find((r) => r.id === id);
  if (!entry) throw new Error(`no rules file for shard "${id}"`);
  return loadFile(entry.path);
}
