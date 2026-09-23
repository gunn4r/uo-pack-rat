// theme.test.mts — app/ui/theme.mts's pure resolution: which theme family and light/dark mode the page
// draws for a stored ui-prefs choice. The live prefers-color-scheme follow and the attributes on <html>
// are checked in the real window by scripts/ui-contrast.test.mts, which renders both modes.
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
