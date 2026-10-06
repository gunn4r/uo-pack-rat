// ui-render.test.mts — the page's DOM builders for scan-supplied values (the character sheet, the tooltip, the peek's properties), which once built markup as a raw string.
//
// the page's two builders that used to assemble markup as a string out of scan-supplied values, now DOM builders: `app/ui/sheet.mts`'s `sheetNode` (a character's `stats`/`maxes`, their name and their skill names all render as text, never markup; a skill entry that isn't a `{value, cap}` pair renders instead of throwing and taking the Characters tab and the Suit Builder down with it) and `app/ui/dom.mts`'s `tipNode`/`safeColor` (tooltip lines, item name and location as text; a line's own `<BASEFONT COLOR>` only ever reaches a `style` through the strict `#rgb`/`#rrggbb` check; the tooltip's layout: the name in its tier's colour with the item's tags, resist lines in their element's colour class, durability muted, the tier and place in the footer, the tag and tier lines not repeated), `sheet.mts`'s `sheetParts` for the Suit Builder's Manual stats card (the suit's own figures with a character's base, no "now → after", and with no character no attributes, pools or skills; issue #12), the result sheet counting worn boots once when the result replaces them and on both sides of an old twelve-slot run, and a worn piece a filter kept out of the search replaced, not added to, by the result's piece in its slot (issue #202), `app/ui/peek.mts`'s `propertyLines` (the item peek's Properties: name/value pairs, requirements muted, a set piece's full-set block kept whole and muted), and `app/ui/dom.mts`'s `tipHostOf` (a row's cells ask for its item tooltip, its `data-no-tip` actions cell does not, issue #69). It lives in `app/` rather than `app/ui/`, the same as `app/import-children.test.mts` and `app/wizard-default-adapter.test.mts`, because `tsconfig.browser.json` compiles `app/ui/**` for the browser. It carries its own small DOM stub (`createElement`/`createTextNode`/`append`/`setAttribute` plus an escaping serializer) rather than adding a jsdom dependency — enough surface for `el()` and the two builders, and the serializer is what makes "the output contains no `<img`" a statement about markup rather than about the characters in a text node. All `[fast]`.
//
// Nothing a scan file carries can reach the parser as markup: Phase 7 security review, Area 2, Important 1/2 and Note 3. A node:test file has no business in the browser build, hence app/.
import "../scripts/localstorage-shim-for-tests.mts";   // a localStorage stub for the page modules below; none reads it at module scope today (app/ui/store.mts no longer does), so it is a safety net, kept first so it would be in place before any import evaluates
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
  parentElement: FakeElement | null = null;
  tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  setAttribute(k: string, v: unknown): void { this.attrs[k] = String(v); }
  hasAttribute(k: string): boolean { return k in this.attrs; }
  // dom.mts's itemTip sets data-serial through dataset and makes the item focusable
  tabIndex = -1;
  get dataset(): Record<string, string> { return new Proxy(this.attrs, { set: (a, k, v) => { a[`data-${String(k)}`] = String(v); return true; } }); }
  // attribute selectors only ("[a], [b]"), the form tipHostOf asks with
  closest(sel: string): FakeElement | null {
    const names = sel.split(",").map((s) => s.trim().slice(1, -1));
    return names.some((k) => this.hasAttribute(k)) ? this : this.parentElement?.closest(sel) ?? null;
  }
  addEventListener(): void {}
  append(...kids: Array<FakeElement | FakeText>): void { for (const k of kids) { this.childNodes.push(k); if (k instanceof FakeElement) k.parentElement = this; } }
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

const { sheetNode, sheetParts } = await import("./ui/sheet.mts");
const { safeColor, tipNode, tipHostOf, el } = await import("./ui/dom.mts");
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

// The Suit Builder's Manual stats card (issue #12): the sheet's figures for the suit being built, drawn as plain
// values (no "now → after"), with the character's own attributes under that suit; with no character, item totals only.
test("[fast] sheetParts: Manual's figures are the suit's own, with a character's base or with none", () => {
  const worn = { serial: 1, name: "Old Helm", slot: "helmet", props: { strBonus: 5, fireResist: 10 } };
  const picked = { serial: 2, name: "New Helm", slot: "helmet", props: { strBonus: 8, lrc: 20 } };
  withCharacter("Kestrel", { stats: { str: 105 }, skills: { Magery: { value: 100, cap: 100 } } });
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [worn];
  const text = (name: string | null): string => { const p = sheetParts(name, name ? { helmet: worn as never } : {}, { helmet: picked as never }, { compare: false }); return `${p.resists.map((r) => r.textContent).join(" ")} ${p.lists.map((l) => l.textContent).join(" ")} ${p.props.textContent}`; };
  const mine = text("Kestrel");
  assert.ok(mine.includes("108"), `STR is the character's own 100 plus the picked helm's 8: ${mine.slice(0, 300)}`);
  assert.ok(!mine.includes("→"), "no now → after in the Manual card");
  assert.ok(mine.includes("Magery") && mine.includes("value / shard cap"));
  const none = text(null);
  assert.ok(none.includes("—") && !none.includes("Magery") && !none.includes("Rescan"), "no character: no attributes, pools or skills");
  assert.ok(none.includes("Item totals only"));
  // the sheet page itself is unchanged by the split
  assert.ok((sheetNode("Kestrel", { helmet: worn as never }, null) as unknown as Node).textContent.includes("105"));
});

// Manual's card takes every worn piece as its base, keyed by serial, so nothing worn rides along on the suit's side:
// a worn spellbook's LMC is not the suit's, and of two worn legs pieces the one put in the suit counts once.
test("[fast] sheetParts: Manual's stats count the manual suit alone, whatever else the character wears", () => {
  const book = { serial: 3, name: "Spellbook", slot: null, props: { lmc: 8 } };
  const leggings = { serial: 4, name: "Leggings", slot: "legs", props: { strBonus: 2 } };
  const kilt = { serial: 5, name: "Kilt", slot: "legs", props: { strBonus: 3 } };
  withCharacter("Kestrel", { stats: { str: 105 } });
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [book, leggings, kilt];
  const base = Object.fromEntries([book, leggings, kilt].map((i) => [`w${i.serial}`, i as never]));
  const card = (suit: Record<string, unknown>): string => { const p = sheetParts("Kestrel", base, suit as never, { compare: false, statsOnly: true }); return `${p.lists.map((l) => l.textContent).join(" ")} ${p.props.textContent}`; };
  const empty = card({});
  assert.ok(empty.includes("Lower Mana Cost0% / 40"), `the worn spellbook's LMC is not the empty suit's: ${empty.slice(0, 400)}`);
  assert.ok(empty.includes("STR100"), "own STR is the total less everything worn");
  assert.ok(card({ legs: leggings }).includes("STR102"), "the leggings put in the suit count once, the kilt not at all");
  const parts = sheetParts("Kestrel", base, {}, { compare: false, statsOnly: true });
  assert.equal(parts.resists.length, 0); assert.equal(parts.gear, null, "nothing built that Manual throws away");
  assert.ok(!parts.props.textContent.includes("Resists include"), "no resist footnote where no resist is drawn");
});

// Issue #202: a result plans the feet too, so worn boots are in its `before` and count once, on the side that keeps
// them; a run saved with twelve slots never planned them, and they count on both sides.
test("[fast] sheetParts: worn boots count once in a result that replaces them, and on both sides of an old twelve-slot run", () => {
  const helm = { serial: 1, name: "Helm", slot: "helmet", props: { physResist: 10 } }, boots = { serial: 2, name: "Boots", slot: "feet", props: { physResist: 5 } };
  withCharacter("Kestrel", {});
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [helm, boots];
  const phys = (before: Record<string, unknown>, after: Record<string, unknown>): string => sheetParts("Kestrel", before as never, after as never).resists[0]!.textContent;
  assert.match(phys({ helmet: helm, feet: boots }, { helmet: helm, feet: { serial: 3, name: "Better Boots", slot: "feet", props: { physResist: 9 } } }), /15.*19/, "the new boots replace the worn ones");
  assert.match(phys({ helmet: helm }, { helmet: { serial: 4, name: "Better Helm", slot: "helmet", props: { physResist: 12 } } }), /15.*17/, "an old run: the worn boots on both sides");
});

// A worn piece a filter kept out of the search (a bracelet with a forbidden skill) is not in the result's `before`: it
// counts now, and the result's own bracelet replaces it rather than adding to it.
test("[fast] sheetParts: a worn piece the search left out counts before, and the result's piece in its slot replaces it", () => {
  const helm = { serial: 1, name: "Helm", slot: "helmet", props: { physResist: 10 } }, bracelet = { serial: 2, name: "Ninjitsu Bracelet", slot: "bracelet", props: { physResist: 5 } };
  withCharacter("Kestrel", {});
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [helm, bracelet];
  const text = sheetParts("Kestrel", { helmet: helm } as never, { helmet: helm, bracelet: { serial: 3, name: "Bracelet", slot: "bracelet", props: { physResist: 9 } } } as never).resists[0]!.textContent;
  assert.match(text, /15.*19/, `not 24: ${text}`);
  // a blocked worn sword, and a result with a two-handed weapon: the sword leaves the after side
  const sword = { serial: 4, name: "Sword", slot: "oneHanded", props: { physResist: 3 } };
  (state.inv as unknown as { worn: Record<string, unknown[]> }).worn.Kestrel = [helm, sword];
  const bow = { serial: 5, name: "Bow", slot: "twoHanded", twoHanded: true, props: { physResist: 1 } };
  const hands = sheetParts("Kestrel", { helmet: helm } as never, { helmet: helm, twoHanded: bow } as never).resists[0]!.textContent;
  assert.match(hands, /13.*11/, `not 14: ${hands}`);
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

test("[fast] tipNode: a Scroll of Transcendence shows its in-game name, muted, under its shown name; other items do not (issue #181)", () => {
  const byClass = (n: FakeElement, c: string): FakeElement[] => elements(n).filter((e) => e.className.split(" ").includes(c));
  const sot = tipNode({ name: "Scroll of Transcendence (Chivalry - 0.6 Pts)", lines: ["Scroll Of Transcendence", "Skill: Chivalry 0.6 Skill Points"] }) as unknown as FakeElement;
  assert.equal(byClass(sot, "tip-name")[0]!.textContent, "Scroll of Transcendence (Chivalry - 0.6 Pts)");
  const game = byClass(sot, "tip-game")[0]!;
  assert.equal(game.textContent, "In game: Scroll Of Transcendence");
  assert.ok(game.className.split(" ").includes("muted"));
  const pearls = tipNode({ name: "Black Pearl", amount: 20, lines: ["20 Black Pearl"] }) as unknown as FakeElement;
  assert.equal(byClass(pearls, "tip-game").length, 0, "a stack's count is not a different name");
});

// Issue #69: a row's action buttons sit inside the row's data-serial host but are not the item, so
// hovering them asks for no item tooltip; the rest of the row still does.
test("[fast] tipHostOf: a row's cells ask for its item tooltip, its data-no-tip actions cell does not", () => {
  const name = el("span", {}, "Radiant Scimitar"), action = el("button", {}, "Grab");
  const acts = el("td", { "data-no-tip": "" }, action);
  const row = el("tr", { "data-serial": 42 }, el("td", {}, name), acts);
  const t = (n: unknown): HTMLElement | null => tipHostOf(n as Element);
  assert.equal(t(name), row);
  assert.equal(t(row), row);
  assert.equal(t(action), null);
  assert.equal(t(acts), null);
  assert.equal(t(el("div", {}, "elsewhere")), null);
  assert.equal(t(null), null);
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
