// select-tests.mts — the mapping behind `./scripts/test_runner.sh --changed`: from the files a branch
// changed to the test files worth running for them. Pure, so scripts/select-tests.test.mts can prove
// every rule; scripts/test-runner.mts asks git for the changed paths and reads the sources.
//
// Rules, per changed path (repo-relative, forward slashes), first match wins:
//   1. docs and the like (*.md, docs/, .github/, LICENSE, a node_modules symlink) select nothing;
//   2. shared test infrastructure, the build, the Electron shell and the schema run the full suite;
//   3. a test file runs itself (a deleted one is dropped);
//   4. anything under adapters/ runs app/adapters.test.mts, which runs every adapters/**/test_*.py;
//   5. otherwise the test files that reach the path: through a chain of relative string literals
//      ("./x.mts", "../y.css" — imports, dynamic imports and new URL() alike), or, for a file that
//      is not a module (JSON, CSS, HTML), by naming it in quotes ("demo-Kestrel.json"). Under app/ui
//      (and app/index.html) the Electron screen tests for it are added too, from SCREENS; a
//      stylesheet adds the contrast test. A path nothing reaches runs the full suite.
import { posix } from "node:path";

export type Selection = { full: string } | { tests: Record<string, string[]> };

const IGNORED = /(^|\/)[^/]+\.md$|^docs\/|^\.github\/|^LICENSE$|^node_modules(\/|$)/;
const FULL = /^(scripts\/(test-runner|run-suite|test-file-watchdog|electron-window|build-ui|build-schema-types)\.mts|scripts\/test_runner\.sh|package(-lock)?\.json|tsconfig[^/]*\.json|app\/schema\/.*|electron\/.*)$/;

// app/ui file stem → the Electron test that drives that screen. A stem not listed here (tokens, dom,
// store, app, theme...) is shared by every screen, so it selects all of them.
const SCREENS: Record<string, string> = {
  builder: "ui-builder", "builder-model": "ui-builder", "builder-result": "ui-builder",
  components: "ui-components",
  import: "ui-forms", "import-preview": "ui-forms", wizard: "ui-forms", settings: "ui-forms", shard: "ui-forms",
  shell: "ui-shell",
  inventory: "ui-state", "inv-model": "ui-state", characters: "ui-state", roster: "ui-state", sheet: "ui-state",
  runs: "ui-state", peek: "ui-state", containers: "ui-state", "view-state": "ui-state",
};

const LITERAL = /["'`](\.\.?\/[^"'`\s]+)["'`]/g;
const refsOf = (file: string, text: string): string[] =>
  [...text.matchAll(LITERAL)].map((m) => posix.normalize(posix.join(posix.dirname(file), m[1]!)));

// `sources` maps every .mts file under app/, scripts/ and electron/ (tests included) to its text.
export function selectTests(changed: string[], sources: Record<string, string>): Selection {
  const tests = Object.keys(sources).filter((f) => f.endsWith(".test.mts")).sort();
  const electronUi = tests.filter((f) => /^scripts\/ui-[^/]+\.test\.mts$/.test(f));
  const refs = new Map(Object.entries(sources).map(([f, text]) => [f, refsOf(f, text)]));
  // Every module a test reaches, itself included.
  const reach = new Map(tests.map((t) => {
    const seen = new Set<string>();
    const visit = (f: string): void => {
      if (seen.has(f) || !(f in sources)) return;
      seen.add(f);
      for (const r of refs.get(f)!) visit(r);
    };
    visit(t);
    return [t, seen];
  }));
  const picked: Record<string, string[]> = {};
  const pick = (test: string, path: string): void => {
    if (test in sources && !(picked[test] ??= []).includes(path)) picked[test]!.push(path);
  };

  for (const path of changed) {
    if (IGNORED.test(path)) continue;
    if (FULL.test(path)) return { full: `${path} is shared test infrastructure` };
    if (path.endsWith(".test.mts")) { if (path in sources) pick(path, path); continue; }
    if (path.startsWith("adapters/")) { pick("app/adapters.test.mts", path); continue; }
    const quoted = path.endsWith(".mts") ? null : `"${posix.basename(path)}"`;
    const names = (f: string): boolean => refs.get(f)!.includes(path) || (quoted !== null && sources[f]!.includes(quoted));
    for (const t of tests) if ([...reach.get(t)!].some(names)) pick(t, path);
    if (path.startsWith("app/ui/") || path === "app/index.html") {
      const screen = SCREENS[posix.basename(path).replace(/\.(mts|css)$/, "")];
      for (const t of screen ? [`scripts/${screen}.test.mts`] : electronUi) pick(t, path);
      if (path.endsWith(".css")) pick("scripts/ui-contrast.test.mts", path);
    }
    if (!Object.values(picked).some((p) => p.includes(path))) return { full: `no test reaches ${path}` };
  }
  return { tests: picked };
}
