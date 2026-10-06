// theme.test.mts — `app/ui/theme.mts`'s pure look resolution and `app/ui/items.mts`'s `rarityToken`.
//
// `app/ui/theme.mts`'s pure look resolution (`resolveMode`: light and dark are fixed, System follows the OS, a missing or unknown choice reads as System; `resolveTheme`: only a theme family whose tokens ship is applied) and `app/ui/items.mts`'s `rarityToken` (every tier in `app/rules/uoalive.json` maps to a `--rarity-*` token defined in both mode blocks of `app/ui/tokens.css`; an unknown tier maps to nothing).
//
// The live prefers-color-scheme follow and the attributes on <html> are checked in the real window by scripts/ui-contrast.test.mts, which renders both modes.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveMode, resolveTheme, resolveAppearance } from "./ui/theme.mts";

test("[fast] resolveMode: light and dark are fixed, system follows the OS", () => {
  assert.equal(resolveMode("light", true), "light");
  assert.equal(resolveMode("dark", false), "dark");
  assert.equal(resolveMode("system", true), "dark");
  assert.equal(resolveMode("system", false), "light");
});

test("[fast] resolveMode: a missing or unknown appearance reads as system", () => {
  assert.equal(resolveAppearance(undefined), "system");
  assert.equal(resolveAppearance("sepia"), "system");
  assert.equal(resolveMode(undefined, true), "dark");
  assert.equal(resolveMode("sepia", false), "light");
});

test("[fast] resolveTheme: only a theme family whose tokens ship is applied", () => {
  assert.equal(resolveTheme("default"), "default");
  assert.equal(resolveTheme("britannia"), "britannia");
  assert.equal(resolveTheme("sepia"), "default", "a family the page does not ship draws the default look");
  assert.equal(resolveTheme(undefined), "default");
  assert.equal(resolveTheme(""), "default");
});

// The custom properties one rule block of a stylesheet declares, found by the block's selector text.
function declared(css: string, selector: string): Set<string> {
  const at = css.indexOf(selector + " {");
  assert.ok(at >= 0, `a block for ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
}

test("[fast] every theme family sets each colour role, and everything Default sets per mode, in both of its modes", async () => {
  const { readFileSync } = await import("node:fs");
  const { BUILT_THEMES } = await import("./ui/theme.mts");
  const tokens = readFileSync(new URL("./ui/tokens.css", import.meta.url), "utf8");
  const light = declared(tokens, ':root, [data-theme="default"][data-mode="light"], [data-theme="default"] [data-mode="light"]');
  const dark = declared(tokens, '[data-theme="default"][data-mode="dark"], [data-theme="default"] [data-mode="dark"]');
  // Every colour role, and everything Default itself restates for dark mode (the game colours, shadows, the
  // focus ring): a family block that missed one would fall back to Default's light value on :root, even
  // in its dark mode.
  const required = new Set([...light].filter((p) => p.startsWith("--color-")).concat([...dark]));
  assert.ok(required.size > 60, `the Default blocks were read (${required.size} properties)`);
  for (const family of BUILT_THEMES.filter((f) => f !== "default")) {
    const css = readFileSync(new URL(`./ui/${family}.css`, import.meta.url), "utf8");
    for (const mode of ["light", "dark"]) {
      const got = declared(css, `[data-theme="${family}"][data-mode="${mode}"], [data-theme="${family}"] [data-mode="${mode}"]`);
      const missing = [...required].filter((p) => !got.has(p));
      assert.deepEqual(missing, [], `${family} ${mode} sets every role Default sets`);
      const stray = [...got].filter((p) => !light.has(p) && !dark.has(p));
      assert.deepEqual(stray, [], `${family} ${mode} overrides only tokens Default defines`);
    }
  }
});

test("[fast] index.html links each theme family's stylesheet after tokens.css, and its fonts ship", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { BUILT_THEMES } = await import("./ui/theme.mts");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const tokensAt = html.indexOf('href="/ui/tokens.css"');
  assert.ok(tokensAt > 0);
  for (const family of BUILT_THEMES.filter((f) => f !== "default")) {
    const at = html.indexOf(`href="/ui/${family}.css"`);
    // later in the cascade: a dark-mode subtree (the item tooltip) takes the family of <html>, not Default
    assert.ok(at > tokensAt, `${family}.css is linked after tokens.css`);
    const css = readFileSync(new URL(`./ui/${family}.css`, import.meta.url), "utf8");
    for (const m of css.matchAll(/url\("fonts\/([a-z0-9-]+\.woff2)"\)/g)) {
      assert.ok(existsSync(new URL(`./ui/fonts/${m[1]}`, import.meta.url)), `${m[1]} is bundled`);
    }
    // every image the theme paints is inline (no request, nothing copied from a game client)
    for (const m of css.matchAll(/url\("(?!data:|fonts\/)([^"]*)"\)/g)) assert.fail(`${family}.css loads ${m[1]}`);
  }
});

test("[fast] rarityToken maps every shipped tier name to its --rarity-* token, and nothing else", async () => {
  await import("../scripts/localstorage-shim-for-tests.mts");
  const { rarityToken } = await import("./ui/items.mts");
  const { readFileSync } = await import("node:fs");
  const rules = JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as { rarity: Array<{ name: string }> };
  const tokens = readFileSync(new URL("./ui/tokens.css", import.meta.url), "utf8");
  for (const { name } of rules.rarity) {
    const t = rarityToken(name);
    assert.ok(t, `${name} has a token`);
    assert.equal((tokens.match(new RegExp(`${t}:`, "g")) || []).length, 2, `${t} is defined in the light and the dark block`);
  }
  assert.equal(rarityToken("Lesser Magic Item"), "--rarity-lesser-magic");
  assert.equal(rarityToken("legendary artifact"), "--rarity-legendary-artifact");
  assert.equal(rarityToken("Mythic Relic"), null);
  assert.equal(rarityToken(null), null);
});

// The values one rule block of a stylesheet sets, by custom property (hex colours only).
function hexes(css: string, selector: string): Map<string, [number, number, number]> {
  const at = css.indexOf(selector + " {");
  assert.ok(at >= 0, `a block for ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*#([0-9a-f]{6})\b/gi)].map((m) => [m[1]!, [0, 2, 4].map((i) => parseInt(m[2]!.slice(i, i + 2), 16)) as [number, number, number]]));
}
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

test("[fast] the House map's eight area colours (issue #10) are set in both modes of every theme family, distinct from each other and from every floor colour", async () => {
  const { readFileSync } = await import("node:fs");
  const { BUILT_THEMES } = await import("./ui/theme.mts");
  const FLOORS = ["stone", "brick", "plaster", "wood", "marble", "sandstone", "dirt", "grass", "water", "tile", "neutral", "yard", "stair"].map((f) => `--color-map-${f}`);
  for (const family of BUILT_THEMES) {
    const css = readFileSync(new URL(family === "default" ? "./ui/tokens.css" : `./ui/${family}.css`, import.meta.url), "utf8");
    const blocks = family === "default"
      ? { light: ':root, [data-theme="default"][data-mode="light"], [data-theme="default"] [data-mode="light"]', dark: '[data-theme="default"][data-mode="dark"], [data-theme="default"] [data-mode="dark"]' }
      : { light: `[data-theme="${family}"][data-mode="light"], [data-theme="${family}"] [data-mode="light"]`, dark: `[data-theme="${family}"][data-mode="dark"], [data-theme="${family}"] [data-mode="dark"]` };
    for (const [mode, selector] of Object.entries(blocks)) {
      const v = hexes(css, selector), areas = Array.from({ length: 8 }, (_, i) => v.get(`--color-area-${i + 1}`));
      assert.ok(areas.every(Boolean), `${family} ${mode} sets --color-area-1 … 8`);
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) assert.ok(dist(areas[i]!, areas[j]!) >= 80, `${family} ${mode}: area ${i + 1} and ${j + 1} are told apart`);
      for (const f of FLOORS) {
        const floor = v.get(f);
        assert.ok(floor, `${family} ${mode} sets ${f}`);
        areas.forEach((a, i) => assert.ok(dist(a!, floor) >= 60, `${family} ${mode}: area ${i + 1} stands off ${f}`));
      }
    }
  }
});
