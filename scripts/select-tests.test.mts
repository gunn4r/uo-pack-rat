// select-tests.test.mts — `scripts/select-tests.mts`, the changed-paths → test-files mapping behind `./scripts/test_runner.sh --changed`.
//
// `scripts/select-tests.mts`, the changed-paths-to-test-files mapping behind `--changed`, over a small fake source tree: a module selects every test that reaches it directly or through other modules, a changed test runs itself and a deleted one is dropped, a data file is reached by its quoted name and a `new URL()` by its relative path, an `app/ui` screen adds its Electron test(s) and a shared UI module all of them, every `SCREENS` entry names a real module and real Electron tests, `adapters/` runs the adapters tests, docs select nothing, and shared infrastructure or an unreached path falls back to the full suite. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectTests, SCREENS, parseShard, partOf } from "./select-tests.mts";

const SOURCES: Record<string, string> = {
  "app/lib.mts": `export const x = 1;`,
  "app/mid.mts": `import { x } from "./lib.mts"; export const y = x;`,
  "app/mid.test.mts": `import { y } from "./mid.mts";`,
  "app/theme.test.mts": `import "./ui/theme.mts"; readFileSync(new URL("./ui/tokens.css", import.meta.url));`,
  "app/ui/theme.mts": `export {};`,
  "app/ui/builder.mts": `import "./dom.mts";`,
  "app/ui/dom.mts": `export {};`,
  "app/ui/organize-model.mts": `export {};`,
  "app/ui-render.test.mts": `await import("./ui/builder.mts");`,
  "app/fixture.test.mts": `readFileSync(join(ROOT, "app", "fixtures", "demo.json"));`,
  "app/adapters.test.mts": `// walks adapters/`,
  "app/adapter-outputs.test.mts": `// spawns adapters/test_scanners.py`,
  "scripts/gen-contracts.test.mts": `// reads adapters/_shared/`,
  "scripts/ui-builder-goals.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-builder-manual.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-contrast.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-state.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-organize.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-map.test.mts": `import "./electron-window.mts";`,
  "scripts/electron-window.mts": `export {};`,
};
const tests = (changed: string[]): Record<string, string[]> => {
  const s = selectTests(changed, SOURCES);
  assert.ok("tests" in s, `fell back to the full suite: ${"full" in s ? s.full : ""}`);
  return s.tests;
};

test("[fast] select-tests: a module selects every test that reaches it, directly or through others", () => {
  assert.deepEqual(tests(["app/lib.mts"]), { "app/mid.test.mts": ["app/lib.mts"] });
});

test("[fast] select-tests: a changed test file runs itself; a deleted one is dropped", () => {
  assert.deepEqual(tests(["app/mid.test.mts", "app/gone.test.mts"]), { "app/mid.test.mts": ["app/mid.test.mts"] });
});

test("[fast] select-tests: a data file is reached by its quoted name, a new URL() by its relative path", () => {
  assert.deepEqual(tests(["app/fixtures/demo.json"]), { "app/fixture.test.mts": ["app/fixtures/demo.json"] });
  assert.deepEqual(Object.keys(tests(["app/ui/tokens.css"])).sort(),
    ["app/theme.test.mts", "scripts/ui-builder-goals.test.mts", "scripts/ui-builder-manual.test.mts", "scripts/ui-contrast.test.mts", "scripts/ui-map.test.mts", "scripts/ui-organize.test.mts", "scripts/ui-state.test.mts"]);
});

test("[fast] select-tests: an app/ui screen adds its Electron test; a shared UI module adds all of them", () => {
  assert.deepEqual(Object.keys(tests(["app/ui/builder.mts"])).sort(), ["app/ui-render.test.mts", "scripts/ui-builder-goals.test.mts", "scripts/ui-builder-manual.test.mts"]);
  assert.deepEqual(Object.keys(tests(["app/ui/dom.mts"])).sort(),
    ["app/ui-render.test.mts", "scripts/ui-builder-goals.test.mts", "scripts/ui-builder-manual.test.mts", "scripts/ui-contrast.test.mts", "scripts/ui-map.test.mts", "scripts/ui-organize.test.mts", "scripts/ui-state.test.mts"]);
  assert.deepEqual(tests(["app/ui/organize-model.mts"]), { "scripts/ui-map.test.mts": ["app/ui/organize-model.mts"], "scripts/ui-organize.test.mts": ["app/ui/organize-model.mts"] });
});

test("[fast] select-tests: every SCREENS entry names a real app/ui module and real Electron tests", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const [stem, screens] of Object.entries(SCREENS)) {
    assert.ok(existsSync(`${root}app/ui/${stem}.mts`), `app/ui/${stem}.mts`);
    for (const n of [screens].flat()) {
      if (n.endsWith("*")) assert.ok(readdirSync(`${root}scripts`).some((f) => f.startsWith(n.slice(0, -1)) && f.endsWith(".test.mts")), `${stem} → scripts/${n}.test.mts`);
      else assert.ok(existsSync(`${root}scripts/${n}.test.mts`), `${stem} → scripts/${n}.test.mts`);
    }
  }
});

test("[fast] select-tests: anything under adapters/ runs the adapters tests", () => {
  const path = "adapters/tazuo/packrat-scanner.py";
  assert.deepEqual(tests([path]), { "app/adapters.test.mts": [path], "app/adapter-outputs.test.mts": [path], "scripts/gen-contracts.test.mts": [path] });
});

test("[fast] select-tests: docs select nothing", () => {
  assert.deepEqual(tests(["README.md", "docs/ui.md", ".github/workflows/ci.yml", "node_modules"]), {});
});

test("[fast] select-tests: shared infrastructure and unreached paths fall back to the full suite", () => {
  for (const p of ["scripts/test-runner.mts", "scripts/electron-window.mts", "package.json", "tsconfig.browser.json", "app/schema/scan.json", "electron/main.mts"]) {
    assert.deepEqual(selectTests(["app/lib.mts", p], SOURCES), { full: `${p} is shared test infrastructure` }, p);
  }
  assert.deepEqual(selectTests(["app/orphan.mts"], SOURCES), { full: "no test reaches app/orphan.mts" });
});

// Issue #338: CI runs the Node files and the Electron files as separate jobs, the Electron files in shards.
test("[fast] select-tests: partOf keeps the Node or the Electron files, and deals a part into shards that cover it once, by test count", () => {
  const files = [
    { path: "app/a.test.mts", tests: 9 }, { path: "scripts/ui-big.test.mts", tests: 20 }, { path: "scripts/ui-mid.test.mts", tests: 12 },
    { path: "scripts/ui-small.test.mts", tests: 7 }, { path: "scripts/shell-smoke.test.mts", tests: 1 }, { path: "scripts/ui-zero.test.mts", tests: 0 },
  ];
  assert.deepEqual(partOf(files, { only: "node" }), ["app/a.test.mts"]);
  const ui = ["scripts/shell-smoke.test.mts", "scripts/ui-big.test.mts", "scripts/ui-mid.test.mts", "scripts/ui-small.test.mts", "scripts/ui-zero.test.mts"];
  assert.deepEqual(partOf(files, { only: "electron" }), ui);
  assert.deepEqual(partOf(files, {}), [...ui, "app/a.test.mts"].sort());
  const shards = [1, 2].map((k) => partOf(files, { only: "electron", shard: { k, n: 2 } }));
  assert.deepEqual([...shards[0]!, ...shards[1]!].sort(), ui, "every file in exactly one shard");
  assert.deepEqual(shards, [["scripts/ui-big.test.mts", "scripts/ui-zero.test.mts"], ["scripts/shell-smoke.test.mts", "scripts/ui-mid.test.mts", "scripts/ui-small.test.mts"]], "the largest first, each to the lighter shard (the first on a tie)");
  assert.deepEqual(partOf(files, { only: "electron", shard: { k: 1, n: 2 } }), shards[0], "the same shards every run");
  assert.deepEqual(partOf(files, { only: "node", shard: { k: 3, n: 3 } }), [], "a shard can be empty");
});

test("[fast] select-tests: parseShard reads k/n with 1 <= k <= n", () => {
  assert.deepEqual(parseShard("2/3"), { k: 2, n: 3 });
  for (const bad of ["0/2", "3/2", "2", "a/b", "1/0", "-1/2"]) assert.equal(parseShard(bad), null, bad);
});
