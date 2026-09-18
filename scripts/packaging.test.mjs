// packaging.test.mjs — the electron-builder config is product interface: which files reach a
// player's machine, under which target, with which identifiers. It lives in package.json (JSON,
// so it needs no YAML parser to check) and these tests are what keep it honest.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const build = pkg.build ?? {};

test("[fast] package metadata carries the public identity", () => {
  assert.equal(pkg.name, "pack-rat");
  assert.equal(pkg.productName, "Pack Rat");
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.repository?.url ?? "", /github\.com\/gunn4r\/uo-pack-rat/);
  assert.equal(build.appId, "com.gunn4r.packrat");
});

test("[fast] every platform ships the targets the spec settled on", () => {
  assert.deepEqual(build.mac?.target?.map((t) => t.target).sort(), ["dmg", "zip"]);
  for (const t of build.mac.target) assert.deepEqual(t.arch, ["x64", "arm64"]);
  assert.deepEqual(build.win?.target?.map((t) => t.target).sort(), ["nsis", "portable"]);
  assert.deepEqual(build.linux?.target, ["AppImage"]);
});

test("[fast] the bundle carries the adapters and the built core, not the tests or the user's data", () => {
  const files = build.files ?? [];
  const has = (p) => files.includes(p);
  assert.ok(has("app/**"), "app/ must ship");
  assert.ok(has("adapters/**"), "adapters/ must ship — the installer copies the scripts out of it");
  assert.ok(has("electron/**"), "the shell itself must ship");
  for (const excluded of ["!**/*.test.mjs", "!local/**", "!test_logs/**", "!docs/**", "!app/bench/**"]) {
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

test("[fast] worker-thread and adapter files are unpacked from the asar", () => {
  const unpacked = build.asarUnpack ?? [];
  assert.ok(unpacked.includes("app/**"), "worker threads under asar are undocumented — unpack app/");
  assert.ok(unpacked.includes("adapters/**"), "the installer copies .py files out to the game client");
  assert.ok(unpacked.includes("node_modules/highs/**"), "the solver's wasm is loaded from disk");
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
  const effectivePattern = (targetName) => build[targetName]?.artifactName || build.win?.artifactName || build.artifactName;
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

test("[fast] a publish-always script exists for the release workflow, separate from dist", () => {
  const scripts = pkg.scripts ?? {};
  assert.match(scripts["dist:publish"] ?? "", /--publish always/);
  assert.match(scripts.dist ?? "", /--publish never/);
});

const workflow = (name) => readFileSync(join(root, ".github/workflows", name), "utf8");

function filesUnder(dir) {
  const out = [];
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
  assert.match(ci, /node-version: *["']?22/, "Node 22 matches the engines floor");
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
  const testFiles = filesUnder(join(root, "scripts")).filter((p) => p.endsWith(".test.mjs"));
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
  assert.match(rel, /dist:publish/, "calls the publish-always script, not dist -- --publish always");
  assert.doesNotMatch(rel, /APPLE_ID|CSC_LINK|notarize/i, "no signing or notarization secrets");
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
