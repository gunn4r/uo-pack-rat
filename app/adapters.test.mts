// adapters.test.mts — the adapter-tree checks that belong in the top-level suite: it runs EVERY
// adapter's Python test file (not just the one adapters/tazuo/test_paths.py that
// scripts/test-runner.mts spawns by name), and it holds the manifest-versus-source contract for
// `capabilities.json`'s `actions` list.
//
// Why `actions` exists (Phase 7 security review, area 5, finding 10): `capabilities` describes what
// an adapter can READ — layers, arms, bank, ground, nested, tooltips — plus a `bridge` action-name
// list. Nothing in it said that installing an adapter also grants a script that WALKS the character,
// OPENS containers and MOVES items. `actions` is that declaration, and this file makes it a contract
// rather than a comment: an adapter that starts calling a world-acting primitive without declaring
// it fails the build, and one that declares an action it never takes fails too.
//
// Run: node --test app/adapters.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ADAPTERS_DIR = join(ROOT, "adapters");

const adapterDirs = existsSync(ADAPTERS_DIR)
  ? readdirSync(ADAPTERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      .filter((name) => existsSync(join(ADAPTERS_DIR, name, "capabilities.json")))
  : [];

interface CapabilitiesFile {
  adapter: string;
  version: string;
  actions?: string[];
  capabilities: { bridge: string[] };
}
const readCaps = (name: string): CapabilitiesFile =>
  JSON.parse(readFileSync(join(ADAPTERS_DIR, name, "capabilities.json"), "utf8")) as CapabilitiesFile;

// ---- the declared in-world actions -------------------------------------------------------------
// One term per kind of thing an adapter does to the world, and the client calls that mean it. Each
// pattern matches a CALL (receiver, name, immediate open paren) so a comment naming a primitive in
// prose isn't counted as taking that action.
const ACTION_PRIMITIVES: Record<string, RegExp> = {
  // double-clicking a container to open it (both scanners and both bridges)
  "open-container": /(API\.UseObject|Items\.WaitForContents)\(/,
  // moving an item into the player's OWN backpack — the destination is hard-coded in every adapter
  // and is deliberately not a protocol field (docs/bridge-protocol.md)
  "move-to-own-backpack": /(API\.MoveItem|Items\.Move)\(/,
  // walking the character, bounded by the bridge's own MAX_WALK_TILES and pathfind timeout
  "pathfind-local": /(API\.PathfindEntity|API\.Pathfind|Player\.PathFindTo)\(/,
  // client-local only: overhead text, a marked tile, a recolor. Never a speech packet.
  "client-local-highlight": /(API\.HeadMsg|API\.MarkTile|Player\.HeadMessage|Items\.SetColor)\(/,
};

function sourcesOf(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => (f.endsWith(".py") || f.endsWith(".ts")) && !f.startsWith("test_"))
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

for (const name of adapterDirs) {
  test(`[fast] adapters/${name}: capabilities.json declares the in-world actions its scripts actually take`, () => {
    const caps = readCaps(name);
    assert.ok(Array.isArray(caps.actions), `adapters/${name}/capabilities.json has no "actions" array — every adapter must declare what it does in the world, even if that is nothing ([])`);
    const declared = new Set(caps.actions);
    for (const term of declared) assert.ok(term in ACTION_PRIMITIVES, `adapters/${name} declares an unknown action "${term}"; known: ${Object.keys(ACTION_PRIMITIVES).join(", ")}`);

    const sources = sourcesOf(join(ADAPTERS_DIR, name));
    const taken = new Set(Object.entries(ACTION_PRIMITIVES).filter(([, re]) => sources.some((s) => re.test(s))).map(([term]) => term));
    for (const term of taken) assert.ok(declared.has(term), `adapters/${name} calls a "${term}" primitive but does not declare it in capabilities.json's actions`);
    for (const term of declared) assert.ok(taken.has(term), `adapters/${name} declares "${term}" but no script calls it`);
  });

  test(`[fast] adapters/${name}: an adapter with no bridge actions takes no in-world actions either`, () => {
    const caps = readCaps(name);
    if (caps.capabilities.bridge.length > 0) return;   // a bridge adapter is covered by the test above
    assert.deepEqual(caps.actions, [], `adapters/${name} declares bridge: [] (read-only) but claims in-world actions ${JSON.stringify(caps.actions)}`);
  });
}

test("[fast] the actions contract actually sees the shipped adapters", () => {
  assert.ok(adapterDirs.length >= 3, `expected the three shipped adapters, got ${JSON.stringify(adapterDirs)}`);
});

// ---- every adapter's Python tests ---------------------------------------------------------------
// scripts/test-runner.mts spawns adapters/tazuo/test_paths.py by name; this walk picks up any
// test_*.py anywhere under adapters/, so a new adapter's tests run with no runner edit (the same
// reasoning as that runner's own recursive walk for *.test.mts).
function pythonTestFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e): string[] => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__pycache__" ? [] : pythonTestFiles(p);
    return e.name.startsWith("test_") && e.name.endsWith(".py") ? [p] : [];
  });
}
const python = ["python3", "python"].find((c) => {
  const r = spawnSync(c, ["--version"], { encoding: "utf8" });
  return !r.error && /^Python 3/.test((r.stdout || "") + (r.stderr || ""));
});

for (const file of existsSync(ADAPTERS_DIR) ? pythonTestFiles(ADAPTERS_DIR) : []) {
  const rel = file.slice(ROOT.length + 1);
  test(`[fast] ${rel} passes`, { skip: python ? false : "no python3/python on PATH" }, () => {
    const r = spawnSync(python as string, ["-W", "error", file], { encoding: "utf8", cwd: ROOT });
    assert.equal(r.status, 0, (r.stderr || r.stdout || "").slice(-2000));
  });
}

test("[fast] every adapter that ships a bridge ships Python tests that cover it", () => {
  const withBridge = adapterDirs.filter((n) => existsSync(join(ADAPTERS_DIR, n, "packrat-bridge.py")));
  assert.ok(withBridge.length >= 2, `expected tazuo and razor-enhanced, got ${JSON.stringify(withBridge)}`);
  // adapters/test_adapters.py is parametrised over every adapter directory, so one file covers them
  // all — this asserts it is there and non-trivial rather than counting per-adapter files.
  const shared = join(ADAPTERS_DIR, "test_adapters.py");
  assert.ok(existsSync(shared) && statSync(shared).size > 1000, "adapters/test_adapters.py is missing or empty");
});
