// gear-item-guard.test.mts — a [smoke] guard that keeps every piece of gear on the page drawn by `app/ui/gear-item.mts`'s `gearItem` (issues #504, #503), so its icon, its name's rarity color and its tooltip come from one place.
//
// It scans every `app/ui/*.mts` but gear-item.mts, comments left out, for four ways to hand-build an item's name:
// 1. `name`: an item's name as an element's text (`txt(it.name …)`, or `it.name` as a child of `el(…)` / `box(…)`; `item` and `piece` too).
// 2. `rarity`: painting by rarity (`rarityToken(` / `rarityColor(`), which is how a hand-built name gets its tier's color.
// 3. `icon`: an item's icon (`artTile(`).
// 4. `class`: gear-item.mts's own `gi-name` class, which would dress a hand-built name as a gear item.
// Today's exceptions are listed below, each with its reason. A new match fails until it becomes a `gearItem` or joins the list with its reason, and a listed one that is gone fails too, so the list stays current.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const UI = join(fileURLToPath(new URL("..", import.meta.url)), "app", "ui");
const FILES = readdirSync(UI).filter((f) => f.endsWith(".mts") && f !== "gear-item.mts").sort();

type Rule = "name" | "rarity" | "icon" | "class";
const ITEM = String.raw`(?:it|item|piece)\.name`;
const PATTERNS: Record<Rule, RegExp[]> = {
  name: [new RegExp(String.raw`\btxt\(\s*${ITEM}\b`), new RegExp(String.raw`\b(?:el|box)\([^;\n]*,\s*${ITEM}\s*[,)]`)],
  rarity: [/\b(?:rarityToken|rarityColor)\(/],
  icon: [/\bartTile\(/],
  class: [/\bgi-name\b/],
};
// The source without its comments: a comment may name these freely.
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
// The rules a module's source breaks.
function matches(src: string): Set<Rule> {
  const text = code(src), out = new Set<Rule>();
  for (const [rule, res] of Object.entries(PATTERNS) as Array<[Rule, RegExp[]]>) if (res.some((re) => re.test(text))) out.add(rule);
  return out;
}

const ALLOWED: Record<string, Array<[Rule, string]>> = {
  "items.mts": [["rarity", "defines rarityToken, the tier → --rarity-* token map gear-item.mts paints with"]],
  "dom.mts": [
    ["rarity", "defines rarityColor, and the item tooltip (tipNode) paints its own name and tier footer: the tooltip is what gearItem shows, so it cannot be a gearItem"],
    ["icon", "the item tooltip's 32 px icon, beside that name"],
  ],
  "item-parts.mts": [["rarity", "rarityEl draws a rarity tier's own name (the Rarity column and filter), not an item's"]],
  "item-art.mts": [["icon", "defines artTile"]],
  "house-map.mts": [["icon", "a container on the map (its chest's icon beside its code and name, and the area's swatch on it): a place to put things, drawn with its own badge, not a piece of gear"]],
};

test("[smoke] gear-item-guard: the patterns catch each way to hand-build an item's name, and skip comments", () => {
  assert.deepEqual([...matches(`td.append(txt(it.name, "ellip"));`)], ["name"]);
  assert.deepEqual([...matches(`box("span", { class: "x" }, item.name, qty)`)], ["name"]);
  assert.deepEqual([...matches(`head.style.color = \`var(\${rarityToken(it.rarity)})\`;`)], ["rarity"]);
  assert.deepEqual([...matches(`row.append(artTile(it.graphic, { size: 24 }));`)], ["icon"]);
  assert.deepEqual([...matches(`txt(label, "gi-name")`)], ["class"]);
  assert.deepEqual([...matches(`// txt(it.name) used to be here\n/* artTile( */ const a = "https://example.org";`)], []);
  assert.deepEqual([...matches(`toast(\`\${it.name} moved\`); const cb = el("input", { "aria-label": \`Select \${it.name}\` });`)], [], "a sentence or an accessible name is not a drawn name");
});

test("[smoke] gear-item-guard: no module but gear-item.mts hand-builds an item's name, icon or rarity color beyond the listed exceptions", () => {
  const unlisted: string[] = [], gone: string[] = [];
  for (const file of FILES) {
    const found = matches(readFileSync(join(UI, file), "utf8")), ok = new Set((ALLOWED[file] || []).map(([rule]) => rule));
    for (const rule of found) if (!ok.has(rule)) unlisted.push(`${file}: ${rule}`);
    for (const rule of ok) if (!found.has(rule)) gone.push(`${file}: ${rule}`);
  }
  for (const file of Object.keys(ALLOWED)) assert.ok(FILES.includes(file), `the list names ${file}, which is not an app/ui module`);
  assert.deepEqual(unlisted, [], "draw the piece with gearItem (app/ui/gear-item.mts), or list the exception here with its reason");
  assert.deepEqual(gone, [], "a listed exception is no longer in its module: take it off the list");
});
