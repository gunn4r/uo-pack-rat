// adapter-outputs.test.mts — what the Python adapters really write, checked against the schemas they claim to meet.
//
// what the Python adapters really write, checked against the schemas: spawns `adapters/test_scanners.py`, `adapters/test_bridges.py` and `adapters/test_panel.py` with `PACKRAT_TEST_OUTPUTS` pointing at a temp folder, then checks every data file a script wrote: each TazUO and Razor Enhanced scan (house-only files included) with `validateScan`, each bridge status with the `bridge.v1` status schema, the panel's heartbeat, its Put away request (the schema and `checkPutAwayRequest`), and `scan-blacklist.json`, `house-claims.json` and `tazuo-panel.json` with their schemas and with the app's own reader keeping every entry and field as written. It fails if an adapter wrote none of a kind its scripts write. Every scan's adapter block must also fit the closed shape an older Pack Rat accepts (no field beyond the known ones, in the block or its capabilities), so going back to an older app never rejects the current scripts' scans. `[fast]`, skipped with no `python3`/`python` on PATH.
//
// adapters/test_scanners.py, adapters/test_bridges.py and adapters/test_panel.py drive every TazUO and Razor Enhanced script through adapters/fake_clients.py; with PACKRAT_TEST_OUTPUTS set, fake_clients.py copies each data file those runs write (its OUTPUT_KINDS) into that folder. This file spawns the test files the way app/adapters.test.mts does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { SCAN_V2_SCHEMA, parseStamp, validateScan } from "./scan-schema.mts";
import { checkPutAwayRequest } from "./put-away.mts";
import { panelPrefsOf } from "./tazuo-panel-prefs.mts";
import { createBlacklistStore } from "./store/blacklist.mts";
import { createHouseClaimsStore } from "./store/house-claims.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const schema = (name: string): ValidatorSchema & { status?: ValidatorSchema; $defs?: Record<string, ValidatorSchema> } =>
  JSON.parse(readFileSync(join(HERE, "schema", name), "utf8")) as ValidatorSchema;
// The kinds each adapter's scripts write (fake_clients.py's OUTPUT_KINDS): only TazUO has the panel.
const KINDS: Record<string, string[]> = {
  "tazuo": ["scan", "status", "heartbeat", "putaway-request", "blacklist", "house-claims", "tazuo-panel"],
  "razor-enhanced": ["scan", "status", "blacklist"],
};
// What the app's own reader makes of `doc`, read back from a file as it would be from the data folder.
function readBack<T>(create: (file: string) => { read(): T }, doc: unknown): T {
  const dir = mkdtempSync(join(tmpdir(), "packrat-adapter-output-"));
  try {
    writeFileSync(join(dir, "f.json"), JSON.stringify(doc));
    return create(join(dir, "f.json")).read();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
// Each kind's schema, and the app's check beside it: null when the app takes the file as written.
const CHECKS: Record<string, { schema: ValidatorSchema; app?: (doc: unknown) => string | null }> = {
  "scan": { schema: SCAN_V2_SCHEMA as unknown as ValidatorSchema },
  "status": { schema: schema("bridge.v1.schema.json").status! },
  "heartbeat": { schema: schema("heartbeat.v1.schema.json") },
  "putaway-request": {
    schema: schema("put-away.v1.schema.json").$defs!.request!,
    // read the moment it was written: how old a request may be is the app's to judge, not the file's
    app: (doc) => { const r = checkPutAwayRequest(doc, parseStamp((doc as { requestedAt: string }).requestedAt)); return r.ok ? null : r.error; },
  },
  "blacklist": { schema: schema("blacklist.v1.schema.json"), app: (doc) => (same(readBack(createBlacklistStore, doc), doc) ? null : "the app's reader drops or changes an entry") },
  "house-claims": { schema: schema("house-claims.v1.schema.json"), app: (doc) => (same(readBack(createHouseClaimsStore, doc), doc) ? null : "the app's reader drops or changes a claim") },
  "tazuo-panel": { schema: schema("tazuo-panel.v1.schema.json"), app: (doc) => (same(panelPrefsOf(doc), doc) ? null : "not what the app's own write would write") },
};
// A scan's adapter block as Pack Rat before TazUO 2.16.0 accepted it: closed, and its capabilities closed. A player who
// goes back to an older app keeps the scans the current scripts write only while they still fit this shape, so the
// scripts add nothing to the block until an app that accepts the addition has been out for a release.
const { features: _, ...KNOWN_ADAPTER_FIELDS } = SCAN_V2_SCHEMA.properties.adapter.properties;
const OLDER_APP_ADAPTER: ValidatorSchema = { ...SCAN_V2_SCHEMA.properties.adapter, additionalProperties: false,
  properties: { ...KNOWN_ADAPTER_FIELDS, capabilities: { ...KNOWN_ADAPTER_FIELDS.capabilities, additionalProperties: false } } } as ValidatorSchema;

const python = ["python3", "python"].find((c) => {
  const r = spawnSync(c, ["--version"], { encoding: "utf8" });
  return !r.error && /^Python 3/.test((r.stdout || "") + (r.stderr || ""));
});

// Files are named <kind>--<adapter>--<hash>.json by fake_clients.py's keep_output.
function collect(): { kind: string; adapter: string; file: string; doc: unknown }[] {
  const out = mkdtempSync(join(tmpdir(), "packrat-adapter-outputs-"));
  try {
    for (const file of ["test_scanners.py", "test_bridges.py", "test_panel.py"]) {
      const r = spawnSync(python as string, ["-W", "error", join(ROOT, "adapters", file)], { encoding: "utf8", cwd: ROOT, env: { ...process.env, PACKRAT_TEST_OUTPUTS: out } });
      assert.equal(r.status, 0, (r.stderr || r.stdout || "").slice(-2000));
    }
    return readdirSync(out).sort().map((file) => {
      const [kind = "", adapter = ""] = file.split("--");
      return { kind, adapter, file, doc: JSON.parse(readFileSync(join(out, file), "utf8")) as unknown };
    });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// Both tests read one run of the Python suites.
let outputs: ReturnType<typeof collect> | undefined;
const outputsOnce = (): ReturnType<typeof collect> => (outputs ??= collect());

test("[fast] every data file the Python adapters write validates against its schema, and the app's reader takes it as written", { skip: python ? false : "no python3/python on PATH" }, () => {
  const all = outputsOnce();
  for (const [adapter, kinds] of Object.entries(KINDS)) {
    for (const kind of kinds) {
      assert.ok(all.some((o) => o.adapter === adapter && o.kind === kind), `no ${kind} from ${adapter}: the fake-client runs wrote nothing to check`);
    }
  }
  const failures = all.flatMap(({ kind, file, doc }) => {
    const check = CHECKS[kind];
    if (!check) return [`${file}: no check for the kind ${kind}`];
    const { ok, errors } = kind === "scan" ? validateScan(doc) : validate(check.schema, doc);
    if (!ok) return [`${file}: ${JSON.stringify(errors.slice(0, 3))}`];
    const app = check.app?.(doc) ?? null;
    return app ? [`${file}: ${app}`] : [];
  });
  assert.deepEqual(failures, []);
});

test("[fast] every scan the Python adapters write still fits the adapter block an older Pack Rat accepts", { skip: python ? false : "no python3/python on PATH" }, () => {
  const scans = outputsOnce().filter((o) => o.kind === "scan");
  assert.ok(scans.length);
  const failures = scans.flatMap(({ file, doc }) => {
    const { ok, errors } = validate(OLDER_APP_ADAPTER, (doc as { adapter: unknown }).adapter);
    return ok ? [] : [`${file}: ${JSON.stringify(errors.slice(0, 3))}`];
  });
  assert.deepEqual(failures, []);
});
