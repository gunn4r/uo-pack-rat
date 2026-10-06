// adapter-outputs.test.mts — what the Python adapters actually write, checked against the schemas they
// claim to meet. adapters/test_scanners.py and adapters/test_bridges.py drive every TazUO and Razor
// Enhanced script through adapters/fake_clients.py; with PACKRAT_TEST_OUTPUTS set, fake_clients.py
// copies each scan and each bridge status.json those runs write into that folder. This file spawns the
// two test files the way app/adapters.test.mts does, then runs validateScan on every scan and the
// bridge.v1 status schema on every status.
//
// Run: node --test app/adapter-outputs.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { validateScan } from "./scan-schema.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const STATUS_SCHEMA = (JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8")) as { status: ValidatorSchema }).status;
const ADAPTERS = ["tazuo", "razor-enhanced"];

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

test("[fast] every scan and bridge status the Python adapters write validates against its schema", { skip: python ? false : "no python3/python on PATH" }, () => {
  const outputs = collect();
  for (const adapter of ADAPTERS) {
    for (const kind of ["scan", "status"]) {
      assert.ok(outputs.some((o) => o.adapter === adapter && o.kind === kind), `no ${kind} from ${adapter}: the fake-client runs wrote nothing to check`);
    }
  }
  const failures = outputs.flatMap(({ kind, file, doc }) => {
    const { ok, errors } = kind === "scan" ? validateScan(doc) : validate(STATUS_SCHEMA, doc);
    return ok ? [] : [`${file}: ${JSON.stringify(errors.slice(0, 3))}`];
  });
  assert.deepEqual(failures, []);
});
