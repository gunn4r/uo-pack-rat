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
  assert.equal(resolveTheme("britannia"), "default", "stored for round 2, not built yet");
  assert.equal(resolveTheme(undefined), "default");
  assert.equal(resolveTheme(""), "default");
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
