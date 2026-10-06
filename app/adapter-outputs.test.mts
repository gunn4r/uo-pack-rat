// adapter-outputs.test.mts — what the Python adapters really write, checked against the schemas they claim to meet.
//
// what the Python adapters really write, checked against the schemas: spawns `adapters/test_scanners.py` and `adapters/test_bridges.py` with `PACKRAT_TEST_OUTPUTS` pointing at a temp folder, then runs `validateScan` on every TazUO and Razor Enhanced scan (house-only files included) and the `bridge.v1` status schema on every bridge status, and fails if either adapter wrote no scan or no status. Every scan's adapter block must also fit the closed shape an older Pack Rat accepts (no field beyond the known ones, in the block or its capabilities), so going back to an older app never rejects the current scripts' scans. `[fast]`, skipped with no `python3`/`python` on PATH.
//
// adapters/test_scanners.py and adapters/test_bridges.py drive every TazUO and Razor Enhanced script through adapters/fake_clients.py; with PACKRAT_TEST_OUTPUTS set, fake_clients.py copies each scan and each bridge status.json those runs write into that folder. This file spawns the two test files the way app/adapters.test.mts does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { SCAN_V2_SCHEMA, validateScan } from "./scan-schema.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const STATUS_SCHEMA = (JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8")) as { status: ValidatorSchema }).status;
const ADAPTERS = ["tazuo", "razor-enhanced"];
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
    for (const file of ["test_scanners.py", "test_bridges.py"]) {
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

test("[fast] every scan and bridge status the Python adapters write validates against its schema", { skip: python ? false : "no python3/python on PATH" }, () => {
  const all = outputsOnce();
  for (const adapter of ADAPTERS) {
    for (const kind of ["scan", "status"]) {
      assert.ok(all.some((o) => o.adapter === adapter && o.kind === kind), `no ${kind} from ${adapter}: the fake-client runs wrote nothing to check`);
    }
  }
  const failures = all.flatMap(({ kind, file, doc }) => {
    const { ok, errors } = kind === "scan" ? validateScan(doc) : validate(STATUS_SCHEMA, doc);
    return ok ? [] : [`${file}: ${JSON.stringify(errors.slice(0, 3))}`];
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
