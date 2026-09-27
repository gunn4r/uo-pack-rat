// select-tests.test.mts — scripts/select-tests.mts, the changed-paths → test-files mapping behind
// `./scripts/test_runner.sh --changed`, over a small fake source tree. All `[fast]`: pure function calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTests } from "./select-tests.mts";

const SOURCES: Record<string, string> = {
  "app/lib.mts": `export const x = 1;`,
  "app/mid.mts": `import { x } from "./lib.mts"; export const y = x;`,
  "app/mid.test.mts": `import { y } from "./mid.mts";`,
  "app/theme.test.mts": `import "./ui/theme.mts"; readFileSync(new URL("./ui/tokens.css", import.meta.url));`,
  "app/ui/theme.mts": `export {};`,
  "app/ui/builder.mts": `import "./dom.mts";`,
  "app/ui/dom.mts": `export {};`,
  "app/ui-render.test.mts": `await import("./ui/builder.mts");`,
  "app/fixture.test.mts": `readFileSync(join(ROOT, "app", "fixtures", "demo.json"));`,
  "app/adapters.test.mts": `// walks adapters/`,
  "scripts/ui-builder.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-contrast.test.mts": `import "./electron-window.mts";`,
  "scripts/ui-state.test.mts": `import "./electron-window.mts";`,
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
    ["app/theme.test.mts", "scripts/ui-builder.test.mts", "scripts/ui-contrast.test.mts", "scripts/ui-state.test.mts"]);
});

test("[fast] select-tests: an app/ui screen adds its Electron test; a shared UI module adds all of them", () => {
  assert.deepEqual(Object.keys(tests(["app/ui/builder.mts"])).sort(), ["app/ui-render.test.mts", "scripts/ui-builder.test.mts"]);
  assert.deepEqual(Object.keys(tests(["app/ui/dom.mts"])).sort(),
    ["app/ui-render.test.mts", "scripts/ui-builder.test.mts", "scripts/ui-contrast.test.mts", "scripts/ui-state.test.mts"]);
});

test("[fast] select-tests: anything under adapters/ runs the adapters test", () => {
  assert.deepEqual(tests(["adapters/tazuo/packrat-scanner.py"]), { "app/adapters.test.mts": ["adapters/tazuo/packrat-scanner.py"] });
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
