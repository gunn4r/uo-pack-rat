// ui-render.test.mts — the two places the page used to build markup as a raw string out of
// scan-supplied values (the character sheet and the hover tooltip) now build DOM nodes instead, so
// nothing a scan file carries can reach the parser as markup. Phase 7 security review, Area 2,
// Important 1/2 and Note 3. Lives in app/ rather than app/ui/ for the same reason
// app/import-children.test.mts and app/wizard-default-adapter.test.mts do: tsconfig.browser.json
// compiles app/ui/** for the browser, and a node:test file has no business in that build.
// Tags: [fast]. Run: node --test app/ui-render.test.mts
import "../scripts/localstorage-shim-for-tests.mts";   // app/ui/store.mts reads localStorage at module scope — must be in place before that import evaluates
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------- a DOM small enough to assert on
// Just the surface app/ui/dom.mts's el() and the two builders under test actually touch:
// createElement/createTextNode, className, setAttribute, append, and a textContent read. `serialize`
// escapes text and attribute values exactly the way a real serializer does, so "the output contains
// no <img" is a real statement about markup rather than about the characters in a text node.
// Plain fields assigned in the constructor body rather than parameter properties: tsconfig.json sets
// erasableSyntaxOnly, since Node runs these files through type stripping, which only erases.
class FakeText {
  nodeType = 3;
  data: string;
  constructor(data: string) { this.data = data; }
  get textContent(): string { return this.data; }
}
class FakeElement {
  nodeType = 1;
  className = "";
  attrs: Record<string, string> = {};
  childNodes: Array<FakeElement | FakeText> = [];
  tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  setAttribute(k: string, v: unknown): void { this.attrs[k] = String(v); }
  addEventListener(): void {}
  append(...kids: Array<FakeElement | FakeText>): void { for (const k of kids) this.childNodes.push(k); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
}
const escText = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const escAttr = (s: string): string => escText(s).replace(/"/g, "&quot;");
function serialize(n: FakeElement | FakeText): string {
  if (n.nodeType === 3) return escText((n as FakeText).data);
  const e = n as FakeElement;
  const attrs = [...(e.className ? [`class="${escAttr(e.className)}"`] : []), ...Object.entries(e.attrs).map(([k, v]) => `${k}="${escAttr(v)}"`)];
  return `<${e.tagName}${attrs.length ? " " + attrs.join(" ") : ""}>${e.childNodes.map(serialize).join("")}</${e.tagName}>`;
}
function elements(n: FakeElement): FakeElement[] {
  return [n, ...n.childNodes.filter((c): c is FakeElement => c.nodeType === 1).flatMap(elements)];
}
(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new FakeElement(tag),
  createElementNS: (_ns: string, tag: string) => new FakeElement(tag),   // the sheet's info message carries an icon
  createTextNode: (s: string) => new FakeText(s),
};

const { sheetNode } = await import("./ui/sheet.mts");
const { safeColor, tipNode } = await import("./ui/dom.mts");
const { state } = await import("./ui/store.mts");
const { setRules } = await import("./vault-lib.mts");
type Node = FakeElement;

const HERE = dirname(fileURLToPath(import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")));
state.rules = JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8"));

// The markup a hostile scan would carry in any of the fields below: stats/maxes/skills are the three
// objects the v2 schema used to leave completely open, and the character name reaches the sheet's title.
const PAYLOAD = '<img src=x onerror="alert(1)">';

// A folded inventory with exactly one character, whose scan-derived fields the caller chooses.
function withCharacter(name: string, c: Record<string, unknown>): void {
  state.inv = { characters: { [name]: { name, scannedAt: "2026-01-01T12:00:00Z", position: null, resists: null, adapter: null, stats: {}, maxes: null, skills: {}, ...c } }, worn: { [name]: [] } } as never;
  state.profiles = { schemaVersion: 2, characters: {}, templates: {} } as never;
}

test("[fast] sheetNode renders scan-supplied stats and maxes as text, never as markup", () => {
  withCharacter("Kestrel", { stats: { str: PAYLOAD, dex: 60, int: 20 }, maxes: { hits: PAYLOAD, stam: 80, mana: 40 } });
  const node = sheetNode("Kestrel", {}, null) as unknown as Node;
  const html = serialize(node);
  assert.ok(!html.includes("<img"), `stats/maxes reached the parser as markup: ${html.slice(0, 400)}`);
  assert.ok(!elements(node).some((e) => e.tagName.toLowerCase() === "img"), "an <img> element was built from scan data");
  // and it is still SHOWN — dropped silently would pass the check above for the wrong reason
  assert.ok(node.textContent.includes("STR"), "the attributes did not render");
});

test("[fast] sheetNode renders a scan-supplied character name as text, never as markup", () => {
  withCharacter(PAYLOAD, { stats: { str: 70 } });
  const node = sheetNode(PAYLOAD, {}, null) as unknown as Node;
  assert.ok(!serialize(node).includes("<img"), "the character name reached the parser as markup");
  assert.ok(node.textContent.includes(PAYLOAD), "the character name is not shown at all");
});

test("[fast] sheetNode survives a skills entry that is not a {value, cap} pair", () => {
  for (const skills of [{ Magery: "not-an-object" }, { Magery: {} }, { Magery: null }, { Magery: { value: "x", cap: [] } }]) {
    withCharacter("Kestrel", { skills });
    const node = sheetNode("Kestrel", {}, null) as unknown as Node;
    assert.ok(node.textContent.includes("Magery"), `a bad skill entry dropped the skill row: ${JSON.stringify(skills)}`);
  }
});

test("[fast] sheetNode renders a scan-supplied skill NAME as text, never as markup", () => {
  withCharacter("Kestrel", { skills: { [PAYLOAD]: { value: 100, cap: 120 } } });
  assert.ok(!serialize(sheetNode("Kestrel", {}, null) as unknown as Node).includes("<img"), "a skill name reached the parser as markup");
});

test("[fast] sheetNode renders a worn piece's scan-supplied name, tags and rarity as text, never as markup or style", () => {
  const piece = { serial: 1, name: PAYLOAD, slot: "helmet", props: { fireResist: 72 }, tags: [PAYLOAD], rarity: `x);background:url(${PAYLOAD})` };
  withCharacter("Kestrel", {});
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [piece];
  const node = sheetNode("Kestrel", { "1": piece as never }, null) as unknown as Node;
  const html = serialize(node);
  assert.ok(!html.includes("<img"), "a worn piece's name or tag reached the parser as markup");
  assert.ok(!elements(node).some((e) => (e.attrs.style || "").includes("url(")), "an unknown rarity reached a style attribute");
  assert.ok(node.textContent.includes(PAYLOAD), "the piece is not shown at all");
  // and the figures are the real ones: Fire 72 on a 70 cap shows 70 with the badge
  assert.ok(node.textContent.includes("cap +2"), "the Fire tile has no cap badge");
});

// The Suit Builder's now → after sheet measures resists against the build's caps (a raised Fire cap of 95 for a
// Reaper Form suit) and says so; the Characters screen's sheet, given no caps, keeps the shard's.
test("[fast] sheetNode: a build's raised resist cap is used and named; without one the shard's cap stays", () => {
  const piece = { serial: 1, name: "Fire Helm", slot: "helmet", props: { fireResist: 90 } };
  withCharacter("Kestrel", {});
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [];
  const caps = { physResist: { cap: 70, shard: 70 }, fireResist: { cap: 95, shard: 70 }, coldResist: { cap: 70, shard: 70 }, poisonResist: { cap: 70, shard: 70 }, energyResist: { cap: 70, shard: 70 } };
  const built = sheetNode("Kestrel", {}, { "1": piece as never }, { resistCaps: caps }) as unknown as Node;
  assert.ok(built.textContent.includes("90/ 95"), `the Fire tile reads 90 of 95: ${built.textContent.slice(0, 300)}`);
  assert.ok(built.textContent.includes("cap raised from 70"));
  assert.ok(built.textContent.includes("This build caps Fire at 95 (the shard's is 70)."));
  assert.ok(!built.textContent.includes("cap +"), "90 is under the raised cap: no over-cap badge");
  assert.ok(built.textContent.includes("now → after / build cap"), "the Properties header names the build's caps");
  const plain = sheetNode("Kestrel", { "1": piece as never }, null) as unknown as Node;
  assert.ok(plain.textContent.includes("70/ 70") && plain.textContent.includes("cap +20"), "the Characters screen keeps the shard's 70");
  assert.ok(!plain.textContent.includes("raised from"));
  assert.ok(plain.textContent.includes("value / shard cap"));
});

test("[fast] safeColor accepts only #rgb / #rrggbb and drops everything else", () => {
  assert.equal(safeColor("#fff"), "#fff");
  assert.equal(safeColor("#A335EE"), "#A335EE");
  assert.equal(safeColor(null), null);
  assert.equal(safeColor(undefined), null);
  assert.equal(safeColor("red"), null);
  assert.equal(safeColor("#fff;background:url(http://evil/)"), null);
  assert.equal(safeColor('#fff" onmouseover="x'), null);
  assert.equal(safeColor("#ffff"), null);
  assert.equal(safeColor("expression(alert(1))"), null);
});

test("[fast] tipNode renders tooltip lines, the item name and its location as text, never as markup", () => {
  const node = tipNode({ name: PAYLOAD, lines: [PAYLOAD, `Lesser Artifact`, `${PAYLOAD} 5%`, PAYLOAD], location: { text: PAYLOAD } }) as unknown as Node;
  const html = serialize(node);
  assert.ok(!html.includes("<img"), `a tooltip line reached the parser as markup: ${html.slice(0, 400)}`);
  assert.ok(node.textContent.includes("alert(1)"), "the tooltip rendered nothing at all");
});

test("[fast] tipNode keeps a line's own <basefont> colour but never lets one reach a style attribute raw", () => {
  const node = tipNode({ name: "Katana", lines: ["Katana", `<BASEFONT COLOR=#A335EE>Crafted by Someone`] }) as unknown as Node;
  const coloured = elements(node).filter((e) => e.attrs["style"]);
  assert.ok(coloured.length > 0, "the line's colour was dropped entirely");
  for (const e of coloured) assert.match(e.attrs["style"]!, /^color:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, `a style attribute carried something other than a colour: ${e.attrs["style"]}`);
});

// The item tooltip's layout (design spec 4.3): the name in its tier's colour with the item's tags beside
// it, the lines in the game's order with resist lines in their element's colour class and durability
// muted, and a footer with the tier and where the item is. The tier and tag lines are not repeated.
test("[fast] tipNode: name and tags on top, element-coloured resists, muted durability, tier and place below", () => {
  const node = tipNode({ name: "Invigorating Ring", rarity: "Major Magic Item", tags: ["antique"], location: { text: "Metal Chest (0x700b0000)" },
    lines: ["Invigorating Ring", "Antique", "Mana Regeneration 3", "Poison Resist 15%", "Durability 255 / 255", "Major Magic Item"] }) as unknown as FakeElement;
  const all = elements(node);
  const byClass = (c: string): FakeElement[] => all.filter((e) => e.className.split(" ").includes(c));
  assert.equal(byClass("tip-name")[0]!.textContent, "Invigorating Ring");
  assert.match(byClass("tip-name")[0]!.attrs["style"]!, /--rarity-major-magic/);
  assert.equal(byClass("tag")[0]!.textContent, "Antique");
  const lines = byClass("tip-lines")[0]!.childNodes.map((c) => c.textContent);
  assert.deepEqual(lines, ["Mana Regeneration 3", "Poison Resist 15%", "Durability 255 / 255"], "the tag and tier lines are not repeated");
  assert.equal(byClass("t-res-poison")[0]!.textContent, "Poison Resist 15%");
  assert.equal(byClass("muted")[0]!.textContent, "Durability 255 / 255");
  assert.deepEqual(byClass("tip-foot")[0]!.childNodes.map((c) => c.textContent), ["Major Magic Item", "Metal Chest (0x700b0000)"], "the tier and the location each get a line");
  assert.equal(byClass("tip-where")[0]!.textContent, "Metal Chest (0x700b0000)");
});

// The item peek's Properties section: the lines the Where and Resists sections do not already show, as
// name/value pairs; a requirement muted, and a set piece's full-set block kept whole (its resist lines are
// the set's bonus) and muted.
test("[fast] propertyLines splits the peek's remaining lines into name and value", async () => {
  const { propertyLines } = await import("./ui/peek.mts");
  const it = { name: "Leather Shorts", lines: ["Leather Shorts", "Prized", "Weight: 3 Stones", "Cold Eater 10%", "Night Sight", "Physical Resist 23%", "Strength Requirement 20", "Durability 37 / 37", "Only When Full Set Is Present:", "Physical Resist 2%", "Greater Artifact"] } as never;
  assert.deepEqual(propertyLines(it), [
    { name: "Cold Eater", value: "10%", muted: false },
    { name: "Night Sight", value: "", muted: false },
    { name: "Strength Requirement", value: "20", muted: true },
    { name: "Only When Full Set Is Present", value: "", muted: true },
    { name: "Physical Resist", value: "2%", muted: true },
  ]);
});
