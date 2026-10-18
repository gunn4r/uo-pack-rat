// layering.test.mts — a [smoke] guard for the import layering of app/, scripts/ and electron/.
//
// Read from the static `import … from`, `export … from` and `import()` specifiers of every non-test .mts in the tree, untracked ones included (comment lines skipped):
//   1. nothing outside app/ui/ imports from app/ui/ (tests excluded);
//   2. the browser-shared modules (tsconfig.browser.json's include, minus app/ui/**) reach no node: module;
//   3. the modules outside app/ui/ have no import cycles, and the app/ui/ modules no cycles beyond the known groups below;
//   4. every module app/ui/ reaches outside app/ui/ has its own "/<path>.mjs" route in app/http/routes/static.mts (the page gets a 404 at load otherwise; build:ui compiles it whether or not the include lists it) and reaches no node: module;
//   5. app/store/ and app/services/ import nothing from app/http/ (type imports included);
//   6. nothing imports app/vault-server.mts except electron/, scripts/, the test fixtures (*-fixture.mts) and tests;
//   7. no app/ui/ module imports app/ui/app.mts, the page's bootstrap (routes are nav.mts, the inventory reload is inventory-data.mts);
//   8. every app/ui/ module that registers a screen with nav.mts's registerScreen() is reached from app/ui/app.mts by runtime imports (a side-effect `import "./x.mts"` counts): a screen module nothing loads never registers its route;
//   9. the Suit Builder's nine modules (builder, builder-header, builder-templates, builder-requirements, builder-job, builder-start, builder-manual, builder-result, runs) never import each other: they share state and call each other through builder-session.mts.
//  10. every command in builder-session.mts's BuilderCommands is provided by exactly one app/ui/ module's provide() call, and no provide() names anything else: a missing one would only fail at run time, as `undefined is not a function`.
//      Likewise every BuilderNews key has exactly one onChange() listener in app/ui/ (an announce() nobody hears redraws nothing), and onChange() names only a news key or a BuilderState field.
//  11. no route module in app/http/routes/ imports another (type imports included): what two route families share lives in a module both import.
//  12. a feature's screen modules (FEATURES: the module that registers the screen and the parts only that feature uses) import no other feature's, beyond SCREEN_EDGES_ALLOWED, the edges 20-ui.md 3.5 leaves for now, each with its reason; every module that registers a screen is in FEATURES, and an allowed edge that is gone fails until it is taken off the list.
// Rules 2-4 and 12 follow runtime imports only: `import type` and `export type` are erased, so they load nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "app", "scripts", "electron"], { cwd: root, encoding: "utf8" }).split("\n");
const modules = tracked.filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts") && !f.endsWith(".d.mts") && existsSync(posix.join(root, f)));
const isUi = (f: string): boolean => f.startsWith("app/ui/");

type Edge = { spec: string; to: string | null; typeOnly: boolean };
const STATIC = /^\s*(import|export)(\s+type\b)?(?:[^;'"`]*?\bfrom)?\s*["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
function edgesOf(file: string): Edge[] {
  const text = readFileSync(posix.join(root, file), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\/\*[\s\S]*?\*\//gm, "");
  const resolve = (spec: string): string | null => spec.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), spec)) : null;
  return [
    ...[...text.matchAll(STATIC)].map((m) => ({ spec: m[3]!, to: resolve(m[3]!), typeOnly: !!m[2] })),
    ...[...text.matchAll(DYNAMIC)].map((m) => ({ spec: m[1]!, to: resolve(m[1]!), typeOnly: false })),
  ];
}
const edges = new Map(modules.map((f) => [f, edgesOf(f)]));
const runtime = (f: string): Edge[] => (edges.get(f) ?? []).filter((e) => !e.typeOnly);

// tsconfig.browser.json's include, as tracked modules ("app/vault-lib.*" style globs).
const browserTsconfig = JSON.parse(readFileSync(posix.join(root, "tsconfig.browser.json"), "utf8")) as { include: string[] };
const globRe = (g: string): RegExp => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
const includeRes = browserTsconfig.include.map(globRe);
const browserIncluded = (f: string): boolean => includeRes.some((re) => re.test(f));
const browserShared = modules.filter((f) => browserIncluded(f) && !isUi(f));

// Every module reachable from `start` through runtime imports, with the path that first reached it.
function reach(start: string, through: (f: string) => boolean = () => true): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
    for (const e of runtime(f)) {
      const to = e.to ?? e.spec;
      if (seen.has(to)) continue;
      seen.set(to, [...seen.get(f)!, to]);
      if (e.to && edges.has(e.to) && through(e.to)) queue.push(e.to);
    }
  }
  return seen;
}

test("[smoke] layering: the parser finds the imports the modules are known to have", () => {
  assert.ok(modules.length > 50 && browserShared.length > 3, `${modules.length} modules, ${browserShared.length} browser-shared`);
  assert.ok(runtime("app/vault-server.mts").some((e) => e.spec === "node:http"), "vault-server imports node:http");
  assert.ok((edges.get("app/ui/api-types.mts") ?? []).some((e) => e.typeOnly && e.to === "app/vault-lib.mts"), "ui/api-types imports types from vault-lib");
  assert.ok(runtime("app/ui/import.mts").some((e) => e.to === "app/paste-scan.mts"), "ui/import imports paste-scan");
});

test("[smoke] layering: nothing outside app/ui/ imports from app/ui/", () => {
  const found = modules.filter((f) => !isUi(f)).flatMap((f) => edges.get(f)!.filter((e) => e.to && isUi(e.to)).map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

test("[smoke] layering: the browser-shared modules reach no node: module", () => {
  const found = browserShared.flatMap((f) => [...reach(f)].filter(([to]) => to.startsWith("node:")).map(([, path]) => path.join(" → ")));
  assert.deepEqual(found, []);
});

test("[smoke] layering: no import cycles outside app/ui/", () => {
  const found = new Set<string>();
  for (const f of modules.filter((m) => !isUi(m))) {
    for (const e of runtime(f)) {
      if (!e.to || isUi(e.to)) continue;
      const back = reach(e.to, (m) => !isUi(m)).get(f);
      if (back) found.add([f, ...back].join(" → "));
    }
  }
  assert.deepEqual([...found], []);
});

// The import cycles app/ui/ still has, each a group whose members may import each other. dom ↔ components is documented
// as safe (dom.mts's import of tag and tooltip); the second is the Settings screen, the first-run wizard and the Characters screen, which open
// each other. A new cycle, or one that joins two groups, fails; a group that shrinks is fine, and is shrunk here.
const UI_CYCLES = [
  ["dom", "components"],
  ["characters", "settings", "wizard"],
].map((g) => new Set(g.map((m) => `app/ui/${m}.mts`)));

test("[smoke] layering: no import cycles in app/ui/ beyond the known groups", () => {
  const found = new Set<string>();
  for (const f of modules.filter(isUi)) {
    for (const e of runtime(f)) {
      if (!e.to || !isUi(e.to)) continue;
      const back = reach(e.to, isUi).get(f);
      if (back && !UI_CYCLES.some((g) => [f, ...back].every((m) => g.has(m)))) found.add([f, ...back].join(" → "));
    }
  }
  assert.deepEqual([...found], []);
});

const BUILDER = ["builder", "builder-header", "builder-templates", "builder-requirements", "builder-job", "builder-start", "builder-manual", "builder-result", "runs"].map((m) => `app/ui/${m}.mts`);
test("[smoke] layering: the Suit Builder's modules never import each other (builder-session.mts is their interface)", () => {
  const found = BUILDER.flatMap((f) => edges.get(f)!.filter((e) => !e.typeOnly && e.to && BUILDER.includes(e.to)).map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

// Each feature's screen modules: the one that registers the screen, then the parts only that feature uses. Modules in
// no feature (item-browser, move-to, kinds, roster, the data and model modules…) are shared parts any screen may use.
const FEATURES: Record<string, string[]> = {
  inventory: ["inventory", "peek"],
  containers: ["containers"],
  map: ["house-map"],
  characters: ["characters"],
  builder: BUILDER.map((f) => posix.basename(f, ".mts")),
  organize: ["organize", "rule-editor", "auto-organize"],
  scrolls: ["scrolls"],
  unravel: ["unravel"],
  settings: ["settings"],
  setup: ["wizard"],
};
const featureOf = new Map<string, string>(Object.entries(FEATURES).flatMap(([name, ms]) => ms.map((m) => [`app/ui/${m}.mts`, name] as const)));
// The screen-to-screen imports that stay for now (20-ui.md 3.5), each with where it is meant to go. One that is gone
// must leave this list, so the list only shrinks.
const SCREEN_EDGES_ALLOWED: Record<string, string> = {
  "house-map → containers": "labelContainer, which moves to organize-data.mts beside the label save it performs",
  "house-map → peek": "propertyLines and RESISTS, which move to item-parts.mts",
  "characters → builder": "selectCharacter, which becomes commands.selectCharacter or a #/builder/<name> route",
  "characters → wizard": "openWizard, which becomes a #/setup route or a nav.mts command",
  "settings → wizard": "openWizard, likewise",
  "wizard → settings": "renderSettings after the wizard, which becomes a setupchange event",
  "settings → characters": "forgetCharacter, which moves into the profiles data module",
};
test("[smoke] layering: a feature's screen modules import no other feature's screen modules, beyond the listed edges", () => {
  const screens = modules.filter((f) => isUi(f) && /^registerScreen\(/m.test(readFileSync(posix.join(root, f), "utf8")));
  assert.ok(screens.length >= 8, `screens read: ${screens.join(", ")}`);
  assert.deepEqual(screens.filter((f) => !featureOf.has(f)), [], "every module that registers a screen is in FEATURES");
  const short = (f: string): string => posix.basename(f, ".mts");
  const found = [...new Set([...featureOf].flatMap(([f, feature]) => runtime(f).filter((e) => e.to && featureOf.has(e.to) && featureOf.get(e.to) !== feature).map((e) => `${short(f)} → ${short(e.to!)}`)))];
  assert.deepEqual(found.filter((edge) => !(edge in SCREEN_EDGES_ALLOWED)), [], "a new screen-to-screen import: move what it needs into a shared module");
  assert.deepEqual(Object.keys(SCREEN_EDGES_ALLOWED).filter((edge) => !found.includes(edge)), [], "an allowed edge is gone: take it off SCREEN_EDGES_ALLOWED");
});

// The top-level keys of each object literal passed to provide({...}), by module: `name` or `name: value`, at depth 1.
function providedKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(/^provide\(\{/gm)) {
    let depth = 0, start = m.index! + "provide(".length, part = "";
    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if ("{([".includes(c)) { depth++; if (depth === 1) continue; }
      if ("})]".includes(c)) { depth--; if (depth === 0) { keys.push(part); break; } }
      if (depth === 1 && c === ",") { keys.push(part); part = ""; continue; }
      if (depth >= 1) part += c;
    }
  }
  return keys.map((k) => k.trim().match(/^(\w+)/)?.[1] ?? "").filter(Boolean);
}
test("[smoke] layering: every BuilderCommands command is provided by exactly one module, and nothing else is", () => {
  const session = readFileSync(posix.join(root, "app/ui/builder-session.mts"), "utf8");
  const block = session.slice(session.indexOf("export interface BuilderCommands {"), session.indexOf("\n}\n", session.indexOf("export interface BuilderCommands {")));
  const declared = [...block.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]!);
  assert.ok(declared.length > 20, `commands read: ${declared.join(", ")}`);
  const by = new Map<string, string[]>();
  for (const f of modules.filter(isUi)) for (const k of providedKeys(readFileSync(posix.join(root, f), "utf8"))) by.set(k, [...(by.get(k) ?? []), f]);
  const problems = [...declared.filter((k) => (by.get(k) ?? []).length !== 1).map((k) => `${k}: provided by ${(by.get(k) ?? []).join(", ") || "no module"}`),
    ...[...by.keys()].filter((k) => !declared.includes(k)).map((k) => `${k}: provided by ${by.get(k)!.join(", ")} but not a BuilderCommands command`)];
  assert.deepEqual(problems, []);
});

test("[smoke] layering: every BuilderNews key has exactly one onChange listener, and onChange names only declared keys", () => {
  const session = readFileSync(posix.join(root, "app/ui/builder-session.mts"), "utf8");
  const news = [...(session.match(/export type BuilderNews = ([^;]+);/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]!);
  const stateBlock = session.slice(session.indexOf("export interface BuilderState {"), session.indexOf("\n}\n", session.indexOf("export interface BuilderState {")));
  const fields = [...stateBlock.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!);
  assert.ok(news.length >= 5 && fields.length >= 5, `news read: ${news.join(", ")}; fields read: ${fields.join(", ")}`);
  const by = new Map<string, string[]>();
  for (const f of modules.filter(isUi)) {
    const text = readFileSync(posix.join(root, f), "utf8");
    if (!/import \{[^}]*\bonChange\b[^}]*\} from "\.\/builder-session\.mts"/.test(text)) continue;
    for (const m of text.matchAll(/(?<![\w.])onChange\(\s*"(\w+)"/g)) by.set(m[1]!, [...(by.get(m[1]!) ?? []), f]);
  }
  const problems = [...news.filter((k) => (by.get(k) ?? []).length !== 1).map((k) => `${k}: heard by ${(by.get(k) ?? []).join(", ") || "no module"}`),
    ...[...by.keys()].filter((k) => !news.includes(k) && !fields.includes(k) && k !== "knobs").map((k) => `${k}: onChange in ${by.get(k)!.join(", ")} but not a BuilderNews key or BuilderState field`)];
  assert.deepEqual(problems, []);
});

test("[smoke] layering: no app/ui/ module imports app/ui/app.mts", () => {
  const found = modules.filter(isUi).flatMap((f) => edges.get(f)!.filter((e) => e.to === "app/ui/app.mts").map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

// The static routes the server serves a shared module on, read from app/http/routes/static.mts's `path: "/x.mjs"` entries.
const routes = new Set([...readFileSync(posix.join(root, "app/http/routes/static.mts"), "utf8").matchAll(/path: "(\/[^"]+\.mjs)"/g)].map((m) => m[1]!));
const routeOf = (f: string): string => `/${f.slice("app/".length).replace(/\.mts$/, ".mjs")}`;

test("[smoke] layering: every module app/ui/ reaches outside app/ui/ has its static route and reaches no node: module", () => {
  assert.ok(routes.has("/vault-lib.mjs") && routes.has("/schema/validate.mjs"), `routes read: ${[...routes].join(", ")}`);
  const found = new Map<string, string>();
  for (const f of modules.filter(isUi)) {
    for (const [to, path] of reach(f)) {
      if (isUi(to) || found.has(to)) continue;
      if (!to.startsWith("app/")) found.set(to, `${path.join(" → ")}: not a module the page can load`);
      else if (!routes.has(routeOf(to))) found.set(to, `${path.join(" → ")}: no ${routeOf(to)} route in app/http/routes/static.mts`);
    }
  }
  assert.deepEqual([...found.values()], []);
});

test("[smoke] layering: app/store/ and app/services/ import nothing from app/http/", () => {
  const found = modules.filter((f) => f.startsWith("app/store/") || f.startsWith("app/services/"))
    .flatMap((f) => edges.get(f)!.filter((e) => e.to?.startsWith("app/http/")).map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

test("[smoke] layering: no app/http/routes/ module imports another", () => {
  const isRoute = (f: string): boolean => f.startsWith("app/http/routes/");
  const found = modules.filter(isRoute).flatMap((f) => edges.get(f)!.filter((e) => e.to && isRoute(e.to)).map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

test("[smoke] layering: only electron/, scripts/ and the test fixtures import app/vault-server.mts", () => {
  const allowed = (f: string): boolean => f.startsWith("electron/") || f.startsWith("scripts/") || f.endsWith("-fixture.mts");
  const found = modules.filter((f) => !allowed(f)).flatMap((f) => edges.get(f)!.filter((e) => e.to === "app/vault-server.mts").map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

test("[smoke] layering: every module that registers a screen is loaded from app.mts", () => {
  const screens = modules.filter((f) => isUi(f) && f !== "app/ui/nav.mts" && /^\s*registerScreen\(/m.test(readFileSync(posix.join(root, f), "utf8")));
  assert.ok(screens.length >= 5 && screens.includes("app/ui/scrolls.mts"), `found ${screens.join(", ")}`);
  const loaded = reach("app/ui/app.mts");
  assert.deepEqual(screens.filter((f) => !loaded.has(f)), [], "a screen module app.mts does not reach never registers its route: import it from app.mts");
});
