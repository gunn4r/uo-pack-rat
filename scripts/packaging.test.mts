// packaging.test.mts — the electron-builder config is product interface: which files reach a
// player's machine, under which target, with which identifiers. It lives in package.json (JSON,
// so it needs no YAML parser to check) and these tests are what keep it honest.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Only the electron-builder + package.json fields these tests actually read — package.json's own
// full shape (dependencies, devDependencies, engines, …) isn't this file's concern.
interface BuildTarget { target: string; arch: string[] }
interface BuildConfig {
  appId?: string | undefined;
  icon?: string | undefined;
  mac?: { target?: BuildTarget[] | undefined; identity?: string | null | undefined } | undefined;
  win?: { target?: BuildTarget[] | undefined; artifactName?: string | undefined } | undefined;
  linux?: { target?: string[] | undefined } | undefined;
  nsis?: { artifactName?: string | undefined } | undefined;
  portable?: { artifactName?: string | undefined } | undefined;
  files?: string[] | undefined;
  asarUnpack?: string[] | undefined;
  electronFuses?: Record<string, boolean> | undefined;
  publish?: { provider?: string | undefined; releaseType?: string | undefined } | undefined;
  artifactName?: string | undefined;
}
interface PackageJson {
  name?: string | undefined;
  productName?: string | undefined;
  license?: string | undefined;
  repository?: { url?: string | undefined } | undefined;
  scripts?: Record<string, string> | undefined;
  build?: BuildConfig | undefined;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
const build = pkg.build ?? {};

// A PNG's width and height sit at fixed offsets in its IHDR chunk, right after the 8-byte signature
// — enough to check an icon's dimensions without an image library.
function pngSize(path: string): { width: number; height: number; bytes: number } {
  const buf = readFileSync(path);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${path} must be a PNG`);
  assert.equal(buf.toString("latin1", 12, 16), "IHDR", `${path} must start with its IHDR chunk`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

test("[fast] the installers take their icon from one committed 1024-px master, and it is not oversized", () => {
  // electron-builder 26 generates the macOS .icns, the Windows .ico and Linux's icon set from a single
  // PNG; the .icns wants 1024×1024 for its 512@2x slot. Naming it explicitly (rather than relying on
  // the build/icon.png lookup) makes a moved or renamed file a build error instead of a silent
  // fallback to Electron's default icon.
  assert.equal(build.icon, "build/icon.png");
  const { width, height, bytes } = pngSize(join(root, "build", "icon.png"));
  assert.equal(width, height, "the icon must be square");
  assert.ok(width >= 1024, `the icon must be at least 1024 px for the macOS .icns, got ${width}`);
  assert.ok(bytes < 512 * 1024, `the master icon is committed and linked from the README; keep it optimised (got ${bytes} bytes)`);
});

test("[fast] the window icon and the page's favicon ship inside the bundle, small", () => {
  // build/ does not ship (it is electron-builder's input, not the app), so the copies the running
  // app uses live under app/assets/, which app/** carries into the asar.
  const files = build.files ?? [];
  assert.ok(!files.some((p) => p.startsWith("!app/assets")), "app/assets/ must ship");
  const win = pngSize(join(root, "app", "assets", "icon.png"));
  assert.deepEqual([win.width, win.height], [256, 256]);
  assert.ok(win.bytes < 64 * 1024, `window icon too large: ${win.bytes} bytes`);
  const fav = pngSize(join(root, "app", "assets", "favicon.png"));
  assert.deepEqual([fav.width, fav.height], [64, 64]);
  assert.ok(fav.bytes < 8 * 1024, `favicon too large: ${fav.bytes} bytes`);
  // The window icon is what Linux and Windows show for the window (and the taskbar in a dev run);
  // macOS ignores it and uses the bundle's .icns.
  const main = readFileSync(join(root, "electron", "main.mts"), "utf8");
  assert.match(main, /const WINDOW_ICON = join\(HERE, "\.\.", "app", "assets", "icon\.png"\);/);
  assert.match(main, /new BrowserWindow\(\{[^]*?\bicon: WINDOW_ICON\b/);
});

test("[fast] package metadata carries the public identity", () => {
  assert.equal(pkg.name, "pack-rat");
  assert.equal(pkg.productName, "Pack Rat");
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.repository?.url ?? "", /github\.com\/gunn4r\/uo-pack-rat/);
  assert.equal(build.appId, "com.gunn4r.packrat");
});

test("[fast] every platform ships the targets the spec settled on", () => {
  assert.deepEqual(build.mac?.target?.map((t) => t.target).sort(), ["dmg", "zip"]);
  for (const t of build.mac!.target!) assert.deepEqual(t.arch, ["x64", "arm64"]);
  assert.deepEqual(build.win?.target?.map((t) => t.target).sort(), ["nsis", "portable"]);
  assert.deepEqual(build.linux?.target, ["AppImage"]);
});

test("[fast] the bundle carries the adapters and the optimizer core's source, not the tests or the user's data", () => {
  const files = build.files ?? [];
  const has = (p: string): boolean => files.includes(p);
  assert.ok(has("app/**"), "app/ must ship");
  assert.ok(has("adapters/**"), "adapters/ must ship — the installer copies the scripts out of it");
  assert.ok(has("electron/**"), "the shell itself must ship");
  assert.ok(has("scripts/optimizer-core.mts"), "the optimizer core ships as source — there is no built copy to ship instead");
  for (const excluded of ["!**/*.test.mjs", "!**/*.test.mts", "!local/**", "!test_logs/**", "!docs/**", "!app/bench/**"]) {
    assert.ok(files.includes(excluded), `${excluded} must be excluded`);
  }
});

test("[fast] the bundle never ships a developer's own local data, even though app/** ships whole", () => {
  // electron-builder doesn't read .gitignore, so app/** shipping whole would package
  // app/data/profiles.json and app/data/runs/ straight off the machine that ran `npm run dist` --
  // real character/profile data on anyone who has actually used the app before packaging it.
  const files = build.files ?? [];
  assert.ok(files.includes("!app/data/profiles.json"), "a local npm run dist must not package the packager's own saved profiles");
  assert.ok(files.includes("!app/data/runs/**"), "nor their saved optimizer runs");
});

test("[fast] the bundle excludes the page's TypeScript sources (the compiled app/dist/ui/ is what runs) but still ships its stylesheet", () => {
  // Once app/ui/**/*.mts is compiled to app/dist/ui/ (npm run build:ui, part of predist), the .mts
  // sources are redundant weight in the packaged app — the packaged server (vault-server.mts, run
  // from app/** source directly) never reads them, only the browser-served /ui/<name>.mjs route does,
  // and that's served from app/dist/. Only this ONE pattern is excluded, not a broader "!app/**/*.mts"
  // — the server itself still runs from app/*.mts source, so excluding all .mts under app/ would break it.
  const files = build.files ?? [];
  assert.ok(files.includes("!app/ui/**/*.mts"), "app/ui/**/*.mts (the page's TS sources) must be excluded — only the compiled app/dist/ui/ output is served");
  assert.ok(!files.some((p) => p === "!app/**/*.mts" || p === "!app/**"), "the exclusion must be scoped to app/ui/, not all of app/ (the server runs from app/*.mts source)");
  // app/ui/styles.css is served straight from the source tree (vault-server.mts's /ui/ route), not
  // from app/dist/ — it must still ship even though its .mts siblings don't.
  assert.ok(!files.includes("!app/ui/**"), "app/ui/**/*.mts must not be excluded via a pattern broad enough to also drop styles.css");
});

test("[fast] only the files that must be loose on disk are unpacked from the asar — the app's own code is not", () => {
  // app/** used to be unpacked wholesale on the belief that "worker threads under asar are
  // undocumented". That is the app itself — the server, the installer, the watcher and the compiled
  // page — sitting beside the archive as ordinary user-writable files that nothing signs or hashes,
  // so tampering with the code the shell then stamps its bearer token onto costs one `cp` (phase-7
  // security review, Important 3). It is now inside the asar, proven against a real
  // `electron-builder --dir` tree on macOS: the packaged app served its page, answered an
  // authenticated /api/setup, and ran a full optimize job to completion — a worker thread loaded out
  // of app.asar, HiGHS loaded from app.asar.unpacked beside it, solver "highs", proven true. That
  // last leg is what `--smoke` checks on every run now (electron/main.mts's OPTIMIZE_CHECK_JS), so
  // nobody has to take this comment's word for it.
  const unpacked = build.asarUnpack ?? [];
  assert.ok(!unpacked.includes("app/**"), "app/ must stay INSIDE the asar — it is the app's own code, and unpacking it makes on-disk tampering a supported configuration");
  assert.ok(unpacked.includes("adapters/**"), "the installer copies .py files out to the game client");
  assert.ok(unpacked.includes("node_modules/highs/**"), "the solver's wasm is loaded from disk");
});

test("[fast] the shipped binary is not left usable as a general-purpose Node interpreter", () => {
  // Every Electron fuse ships permissive by default, which leaves the installed app able to run an
  // arbitrary script as plain Node (ELECTRON_RUN_AS_NODE), honour NODE_OPTIONS, and open an
  // inspector port into its own main process — the standard "live off the land with an installed
  // Electron app" path (phase-7 security review, Important 2). Nothing in the PACKAGED app needs any
  // of them: the server child is a utilityProcess (its own mechanism, unaffected by runAsNode), and
  // the one ELECTRON_RUN_AS_NODE use in the project is scripts/build-ui.mts, which runs only when
  // !app.isPackaged and is not even shipped (see the build.files test above).
  const fuses = build.electronFuses ?? {};
  assert.equal(fuses.runAsNode, false, "the app binary must not run arbitrary scripts as Node");
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false, "NODE_OPTIONS must not be honoured");
  assert.equal(fuses.enableNodeCliInspectArguments, false, "--inspect must not open a debugger on the main process");
  assert.equal(fuses.onlyLoadAppFromAsar, true, "the app must load from app.asar only, never from a loose app/ directory beside it");
  assert.equal(fuses.resetAdHocDarwinSignature, true, "flipping fuses rewrites the binary and invalidates its ad-hoc signature — an unsigned mac build must be re-signed or it will not launch on Apple Silicon");
  // Deliberately NOT set: enableCookieEncryption (it makes Chromium take a key from the OS keychain
  // at startup — an unsigned build's identity changes every release, so every user would be prompted
  // for keychain access by an app that stores no cookies and no secrets; observed live on the
  // maintainer's machine during this change) and enableEmbeddedAsarIntegrityValidation (the expected
  // hash lives in a file exactly as writable as the asar it describes, so without code signing it
  // stops nobody — revisit it and onlyLoadAppFromAsar together if this project ever signs).
  assert.ok(!("enableCookieEncryption" in fuses), "enableCookieEncryption prompts every user of an unsigned build for keychain access and protects nothing here");
});

test("[fast] the release build never tries to sign", () => {
  assert.equal(build.mac?.identity, null, "identity null keeps an unsigned mac build from failing");
});

test("[fast] the two Windows targets cannot resolve to the same artifact filename", () => {
  // Mirrors electron-builder's own precedence for a target's artifact name pattern (app-builder-lib's
  // PlatformPackager#artifactPatternConfig: targetSpecificOptions.artifactName || win.artifactName ||
  // the top-level config.artifactName). nsis and portable are the same NsisTarget class under two
  // different target names, both reading build[targetName] as their target-specific options — so with
  // no override, both fall through to the same global pattern and collide on
  // "Pack Rat-<version>-win-x64.exe", and whichever electron-builder writes second overwrites the first.
  const effectivePattern = (targetName: "nsis" | "portable"): string | undefined => build[targetName]?.artifactName || build.win?.artifactName || build.artifactName;
  const nsisPattern = effectivePattern("nsis");
  const portablePattern = effectivePattern("portable");
  assert.notEqual(nsisPattern, portablePattern, "nsis and portable would resolve to the same artifact filename");
  assert.ok(portablePattern, "portable needs its own artifactName override to avoid the collision");
});

test("[fast] the release always publishes as a draft, explicitly, not by relying on electron-builder's default", () => {
  // builder-util-runtime's GithubOptions documents releaseType as defaulting to "draft" already,
  // but a default nobody on this project verified from the installed source is not something to
  // bet the first public tag's release on -- so the config pins it rather than relying on it.
  assert.equal(build.publish?.provider, "github");
  assert.equal(build.publish?.releaseType, "draft");
});

test("[fast] no packaging script publishes; the release workflow's publish job is the only uploader", () => {
  // A local `electron-builder --publish always` run with GH_TOKEN set creates and fills a release of
  // its own, which is exactly the path the workflow's build/publish split exists to rule out.
  const scripts = pkg.scripts ?? {};
  assert.match(scripts.dist ?? "", /--publish never/);
  for (const [name, command] of Object.entries(scripts)) {
    if (/electron-builder/.test(command)) assert.match(command, /--publish never/, `${name} must not publish`);
  }
});

test("[fast] every packaging script builds the page first", () => {
  // The packaged server never builds anything (electron/server-entry.mts), so a package made without
  // app/dist/ opens on a 404, and one made over an old app/dist/ quietly ships a stale page.
  const scripts = pkg.scripts ?? {};
  const packaging = Object.keys(scripts).filter((name) => /electron-builder/.test(scripts[name] ?? ""));
  assert.ok(packaging.includes("dist") && packaging.includes("dist:dir"), `found: ${packaging.join(", ")}`);
  for (const name of packaging) {
    assert.equal(scripts[`pre${name}`], "npm run build:types && npm run build:ui", `${name} needs a pre${name} hook that builds the page`);
  }
});

const workflow = (name: string): string => readFileSync(join(root, ".github/workflows", name), "utf8");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

test("[fast] CI runs the suite on all three desktop platforms", () => {
  const ci = workflow("ci.yml");
  for (const os of ["macos-latest", "windows-latest", "ubuntu-latest"]) assert.match(ci, new RegExp(os));
  assert.match(ci, /node-version: *["']?24/, "Node 24 matches the engines floor");
  assert.match(ci, /xvfb-run/, "Linux needs a virtual display to launch Electron");
  assert.match(ci, /py_compile/, "the Python adapters get compiled in the same run");
  assert.doesNotMatch(ci, /TEST_SKIP_ELECTRON/, "CI must not skip the shell tests");
});

test("[fast] CI compiles every adapter's Python scripts generically, not one adapter's files named by hand", () => {
  const ci = workflow("ci.yml");
  assert.match(
    ci,
    /py_compile adapters\/\*\/packrat-\*\.py/,
    "the compile step must glob every adapters/*/packrat-*.py, so a new adapter needs no edit here",
  );
  assert.doesNotMatch(ci, /adapters\/tazuo\/packrat-scanner\.py/, "must not hard-code tazuo's own script paths");
  assert.match(ci, /shell:\s*bash/, "the glob needs bash on windows-latest too (its default shell, pwsh, doesn't expand wildcard arguments to external commands)");
});

test("[fast] Linux CI relaxes the unprivileged-userns restriction Electron's sandbox needs, keeps the sandbox itself enabled, and makes a silent no-op visible", () => {
  const ci = workflow("ci.yml");
  assert.match(
    ci,
    /apparmor_restrict_unprivileged_userns/,
    "ubuntu-latest's AppArmor policy blocks the unprivileged user namespaces an npm-installed Electron's sandbox needs; relax it for the CI VM, not the shipped app",
  );
  assert.doesNotMatch(ci, /--no-sandbox/, "fix the CI host, don't weaken the app's own sandbox");
  assert.doesNotMatch(ci, /ELECTRON_DISABLE_SANDBOX/, "keep Chromium's sandbox enabled during the test — CI should exercise what a player runs");
  assert.match(
    ci,
    /::warning::/,
    "a runner image that drops or renames the sysctl key must not fail silently under `|| true` — surface it as a build warning",
  );

  // Nobody should disable the sandbox anywhere else either — finding it in a shipped file (electron/**,
  // app/**, adapters/**, matching build.files above) or a test file would mean a player's machine (or a
  // local `npm test` run) runs without it, not just this CI step. Exclude this file itself: it
  // necessarily names both strings above, in assertions.
  const self = fileURLToPath(import.meta.url);
  const shippedDirs = ["electron", "app", "adapters"];
  const testFiles = filesUnder(join(root, "scripts")).filter((p) => p.endsWith(".test.mjs") || p.endsWith(".test.mts"));
  const suspects = [...shippedDirs.flatMap((d) => filesUnder(join(root, d))), ...testFiles].filter((p) => p !== self);
  for (const file of suspects) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /ELECTRON_DISABLE_SANDBOX/, `${file} must not disable Electron's sandbox`);
    assert.doesNotMatch(text, /--no-sandbox/, `${file} must not pass --no-sandbox`);
  }
});

test("[fast] the release workflow builds unsigned, on a tag, into a draft release", () => {
  const rel = workflow("release.yml");
  assert.match(rel, /tags:\s*\n\s*- *['"]?v\*/, "triggered by a v* tag");
  assert.match(rel, /CSC_IDENTITY_AUTO_DISCOVERY: *["']?false/, "no signing this phase");
  // The build job builds and publishes NOTHING (`npm run dist` is --publish never); a separate job
  // with its own token uploads the artifacts to the draft. So the matrix that runs the whole
  // dependency tree never holds a release token — see the token/npm test below.
  assert.match(rel, /run: npm run dist\b/, "the build matrix runs the non-publishing dist script");
  assert.doesNotMatch(rel, /APPLE_ID|CSC_LINK|notarize/i, "no signing or notarization secrets");
});

test("[fast] no step that runs npm in the release workflow carries a write-scoped token", () => {
  // The publish job holds `contents: write`; the build job runs 300-odd development packages as
  // ordinary code. A step that did both would hand the dependency tree a token that can write to
  // releases — which is the one concentrated risk the phase-7 supply-chain review named.
  const steps = workflow("release.yml").split(/\n {6}- /).slice(1);
  for (const step of steps) {
    if (/\bnpm\b/.test(step)) assert.doesNotMatch(step, /GH_TOKEN|GITHUB_TOKEN/, `a step that runs npm must not carry a release token:\n${step.slice(0, 160)}`);
  }
});

test("[fast] every action both workflows use is pinned to a full commit sha, and says which tag that was", () => {
  // A mutable tag (`@v4`) is whatever that tag points at on the day CI runs, in a job that can build
  // the installers players download. The trailing `# vX.Y.Z` comment is what makes a pin reviewable
  // and renewable — a bare sha with no note of its version is a pin nobody dares update.
  for (const name of ["ci.yml", "release.yml"]) {
    for (const line of workflow(name).split("\n").filter((l) => /^\s*-?\s*uses:/.test(l))) {
      assert.match(line, /uses: \S+@[0-9a-f]{40} +# +v\d/, `${name}: pin to a sha and name the tag — ${line.trim()}`);
    }
  }
});

test("[fast] the release workflow can be run by hand to rehearse a build, without publishing anything", () => {
  const rel = workflow("release.yml");
  assert.match(rel, /workflow_dispatch/, "must be dispatchable by hand before the first tag exists");
  // The build command must branch on how the workflow was triggered -- an unconditional
  // `run: npm run dist:publish` would create a release and upload to it on a dispatched rehearsal run too.
  assert.doesNotMatch(rel, /^\s*run: npm run dist:publish\s*$/m, "the publish script must be conditional on a real tag push");
  assert.match(rel, /github\.event_name == 'push'/, "the publish step must branch on how the workflow was triggered");
});

test("[fast] exactly one job creates the draft release, ahead of the platform matrix", () => {
  const rel = workflow("release.yml");
  // Three runners each calling electron-builder's own getOrCreateRelease at nearly the same moment can
  // each find no release yet and each create their own draft -- a single job the matrix depends on
  // guarantees one draft exists before any platform uploads to it.
  assert.match(rel, /gh release create/, "one job creates the draft, rather than every matrix job racing electron-builder's own release lookup");
  assert.match(rel, /needs:\s*create-release/, "the build matrix must wait on that job");
});

test("[fast] the release workflow refuses to create a release when the tag doesn't match package.json's version", () => {
  const rel = workflow("release.yml");
  // electron-builder's own publish step matches a release by VERSION, not by tag -- a tag pushed
  // without bumping package.json first would otherwise get its own draft from create-release, then a
  // SECOND draft from electron-builder once the matrix builds, splitting artifacts across both.
  assert.match(rel, /require\(['"]\.\/package\.json['"]\)\.version/, "reads the version with node, not a shell JSON parse");
  assert.match(rel, /\$TAG.*!=.*pkg_version/, "compares the tag against package.json's version");
  assert.match(rel, /exit 1/, "fails the job outright rather than only warning");
});
