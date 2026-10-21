// ui-gear-item.test.mts — `app/ui/gear-item.mts`'s `gearItem` on a fake DOM, and the tooltip title's icon.
//
// `app/ui/gear-item.mts`'s `gearItem`: the row's parts in order (the icon as an aria-hidden tile with an empty alt, the name in its rarity's color token, the quantity, only the quality tags, then `after`), no color for a tier without a token, an empty box of the same size when there is no graphic and no tile at all with `showIcon: false`, the button `onOpen` makes, what a press hands it, its name (the piece and its quantity) and the tags and badges that describe it, the card's two lines beside a 32 px icon, the item tooltip's host, the graphic, hue and rarity filled from the page's item cache, the missing ones looked up by serial in one batched request and the piece redrawn with them (a serial waiting or in flight asked once, one the server lacks not asked again until `forgetGearMisses`), and the one-span rule on every variant; `app/ui/item-art.mts`'s `artTile` keeping its box, and its badge, when there is no art or it fails to load; `app/ui/dom.mts`'s `tipNode` title carrying a 32 px icon when the item's graphic is known. Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives. Tags: [fast].
import "../scripts/localstorage-shim-for-tests.mts";
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------- a DOM small enough to assert on
class FakeText { nodeType = 3; data: string; parentNode: FakeElement | null = null; constructor(d: string) { this.data = d; } get textContent(): string { return this.data; } }
class FakeElement {
  nodeType = 1;
  tagName: string;
  attrs: Record<string, string> = {};
  childNodes: Array<FakeElement | FakeText> = [];
  parentNode: FakeElement | null = null;
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  style: Record<string, string> = {};
  tabIndex = -1;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get className(): string { return this.attrs.class || ""; }
  set className(v: string) { this.attrs.class = v; }
  get classList(): { add: (c: string) => void; contains: (c: string) => boolean } {
    return { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, contains: (c) => this.className.split(/\s+/).includes(c) };
  }
  get dataset(): Record<string, string> { return new Proxy(this.attrs, { get: (a, k) => a[`data-${String(k)}`], set: (a, k, v) => { a[`data-${String(k)}`] = String(v); return true; } }); }
  setAttribute(k: string, v: unknown): void { this.attrs[k] = String(v); }
  getAttribute(k: string): string | null { return k in this.attrs ? this.attrs[k]! : null; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  addEventListener(type: string, fn: (e: unknown) => void): void { (this.listeners[type] ||= []).push(fn); }
  dispatch(type: string): void { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {} }); }
  append(...kids: Array<FakeElement | FakeText | string>): void { for (const k of kids) { const n = typeof k === "string" ? new FakeText(k) : k; n.parentNode = this; this.childNodes.push(n); } }
  replaceChildren(...kids: Array<FakeElement | FakeText>): void { this.childNodes = []; this.append(...kids); }
  remove(): void { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this); this.parentNode = null; }
  get children(): FakeElement[] { return this.childNodes.filter((c): c is FakeElement => c.nodeType === 1); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
}
(globalThis as unknown as { document: unknown }).document = {
  createElement: (t: string) => new FakeElement(t),
  createElementNS: (_ns: string, t: string) => new FakeElement(t),
  createTextNode: (s: string) => new FakeText(s),
};
// Every lookup the component sends, answered from `known`.
const asked: string[] = [];
let known: Record<number, unknown> = {};
(globalThis as unknown as { fetch: unknown }).fetch = async (path: string) => {
  asked.push(path);
  const serials = new URL(path, "http://x").searchParams.get("serials")!.split(",").map(Number);
  return { ok: true, status: 200, json: async () => ({ ok: true, items: Object.fromEntries(serials.filter((s) => known[s]).map((s) => [s, known[s]])) }) };
};

const { gearItem, forgetGearMisses } = await import("./ui/gear-item.mts");
const { artTile } = await import("./ui/item-art.mts");
const { tipNode } = await import("./ui/dom.mts");
const { FLEX_CLASSES } = await import("./ui/components.mts");
const { state } = await import("./ui/store.mts");
type El = FakeElement;
const all = (n: El): El[] => [n, ...n.children.flatMap(all)];
const has = (n: El, c: string): boolean => n.classList.contains(c);
const draw = (...a: Parameters<typeof gearItem>): El => gearItem(...a) as unknown as El;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test("[fast] gearItem row: icon, name in its rarity's token, quantity, quality tags, then `after`", () => {
  const after = (globalThis as unknown as { document: { createElement: (t: string) => El } }).document.createElement("span");
  after.className = "tag";
  const n = draw({ serial: 1, name: "Orc Mask", graphic: 0x141b, hue: 1153, rarity: "Major Artifact", amount: 3, tags: ["antique", "slayer"] }, { showTags: true, after: [after as unknown as HTMLElement] });
  assert.equal(n.tagName, "SPAN");
  assert.deepEqual(n.className.split(" "), ["gi", "gi-row"]);
  const [tile, name, qty, tag, last] = n.children;
  assert.ok(has(tile!, "art-tile") && has(tile!, "art-24") && tile!.getAttribute("aria-hidden") === "true");
  const img = tile!.children[0]!;
  assert.deepEqual([img.tagName, img.getAttribute("alt"), img.getAttribute("src")], ["IMG", "", "/api/item-art/5147.png?hue=1153"]);
  assert.deepEqual([name!.className, name!.textContent, name!.style.color], ["gi-name", "Orc Mask", "var(--rarity-major-artifact)"]);
  assert.equal(qty!.textContent, "×3");
  assert.equal(tag!.textContent, "Antique", "only the quality tag, not the slayer");
  assert.equal(last, after);
  assert.equal(n.children.length, 5);
  assert.equal(n.attrs["data-serial"], "1", "the item tooltip's host");
});

test("[fast] gearItem: no color for a tier without a token, an empty box with no graphic, no tile with showIcon false", () => {
  const odd = draw({ serial: 2, name: "Odd Ring", rarity: "Shiny", graphic: null, hue: 0 });
  const [box, name] = odd.children;
  assert.ok(has(box!, "art-tile") && has(box!, "art-none") && has(box!, "art-24") && box!.children.length === 0, "an empty box of the same size");
  assert.equal(name!.style.color, undefined);
  const bare = draw({ serial: 3, name: "Ring", rarity: null, graphic: 7 }, { showIcon: false });
  assert.deepEqual(bare.children.map((c) => c.className), ["gi-name"]);
});

test("[fast] gearItem onOpen: a button that hands the item and itself to onOpen when pressed", () => {
  const seen: unknown[] = [];
  const it = { serial: 4, name: "Bracelet", rarity: null, graphic: 0x1086 };
  const n = draw(it, { onOpen: (got, node) => seen.push([got.serial, node]) });
  assert.deepEqual([n.tagName, n.getAttribute("type")], ["BUTTON", "button"]);
  assert.ok(has(n, "gi-link"));
  n.dispatch("click");
  assert.deepEqual(seen, [[4, n]]);
});

test("[fast] gearItem button: named by the piece and its quantity, described by its tags and badges", () => {
  const badge = (globalThis as unknown as { document: { createElement: (t: string) => El } }).document.createElement("span");
  const n = draw({ serial: 7, name: "Arrow", amount: 40, rarity: null, graphic: 0xf3f, tags: ["cursed"] }, { onOpen: () => {}, showTags: true, after: [badge as unknown as HTMLElement] });
  assert.equal(n.getAttribute("aria-label"), "Arrow ×40");
  const idOf = (e: El): string => (e as unknown as { id: string }).id;
  const tag = n.children.find((c) => c.textContent === "Cursed")!;
  assert.ok(idOf(tag) && idOf(badge));
  assert.equal(n.getAttribute("aria-describedby"), `${idOf(tag)} ${idOf(badge)}`);
  assert.equal(draw({ serial: 8, name: "Ring", rarity: null, graphic: 1 }, { onOpen: () => {} }).getAttribute("aria-describedby"), null, "nothing to describe it");
});

test("[fast] gearItem card: a 32 px icon beside two lines, the label and name, then `sub`", () => {
  const n = draw({ serial: 5, name: "Leather Gorget", rarity: "Greater Magic Item", graphic: 0x13c7 }, { variant: "card", label: "Neck", sub: "LRC 9 · LMC 8" });
  assert.ok(has(n, "gi-card"));
  const [tile, text] = n.children;
  assert.ok(has(tile!, "art-32"));
  const [line, sub] = text!.children;
  assert.deepEqual(line!.children.map((c) => c.textContent), ["Neck", "Leather Gorget"]);
  assert.equal(sub!.textContent, "LRC 9 · LMC 8");
});

test("[fast] gearItem keeps the one-span rule in every variant", () => {
  const FLEX = new Set<string>(FLEX_CLASSES);
  for (const variant of ["row", "inline", "chip", "card"] as const) {
    const n = draw({ serial: 6, name: "Spellbook", amount: 2, rarity: "Minor Magic Item", graphic: 0xefa, tags: ["cursed"] }, { variant, showTags: true, label: "Weapon", sub: "FC 1" });
    for (const e of all(n)) {
      if (!e.className.split(/\s+/).some((c) => FLEX.has(c))) continue;
      assert.equal(e.childNodes.filter((c) => c.nodeType === 3 && c.textContent.trim()).length, 0, `${variant}: <${e.tagName} class="${e.className}"> holds bare text`);
    }
  }
});

test("[fast] gearItem fills graphic, hue and rarity from the item cache, and looks up the rest by serial in one request", async () => {
  state.itemCache.set(10, { serial: 10, name: "Cleaver", graphic: 0xec3, hue: 1256, rarity: "Lesser Artifact", tags: [] } as never);
  const cached = draw({ serial: 10, name: "Cleaver" });
  assert.equal(cached.children[0]!.children[0]!.getAttribute("src"), "/api/item-art/3779.png?hue=1256");
  assert.equal(cached.children[1]!.style.color, "var(--rarity-lesser-artifact)");

  known = { 11: { serial: 11, name: "Axe", graphic: 0xf49, hue: 2413, rarity: "Major Magic Item", tags: [] }, 12: { serial: 12, name: "Shield", graphic: 0x1b74, hue: 0, rarity: null, tags: [] } };
  asked.length = 0;
  const a = draw({ serial: 11, name: "Axe" }), b = draw({ serial: 12, name: "Shield" }), c = draw({ serial: 13, name: "Gone" });
  assert.ok(has(a.children[0]!, "art-none"), "an empty box while it is looked up");
  await tick();
  assert.equal(asked.length, 1, "one request for the three");
  assert.match(asked[0]!, /serials=11,12,13$/);
  assert.equal(a.children[0]!.children[0]!.getAttribute("src"), "/api/item-art/3913.png?hue=2413");
  assert.equal(a.children[1]!.style.color, "var(--rarity-major-magic)");
  assert.equal(b.children[0]!.children[0]!.getAttribute("src"), "/api/item-art/7028.png");
  assert.ok(has(c.children[0]!, "art-none"), "a serial the server lacks keeps its box");
  draw({ serial: 11, name: "Axe" });
  draw({ serial: 13, name: "Gone" });
  await tick();
  assert.equal(asked.length, 1, "neither a found serial nor one the server lacks is asked again");
  forgetGearMisses();
  draw({ serial: 13, name: "Gone" });
  await tick();
  assert.match(asked[1]!, /serials=13$/, "a new inventory asks for a missed serial again");
});

test("[fast] gearItem: a serial waiting or in flight is asked once, however often it is drawn", async () => {
  known = { 20: { serial: 20, name: "Kilt", graphic: 0x1537, hue: 0, rarity: null, tags: [] } };
  asked.length = 0;
  const first = draw({ serial: 20, name: "Kilt" });
  await new Promise((r) => setTimeout(r, 0));
  const second = draw({ serial: 20, name: "Kilt" });
  await tick();
  assert.equal(asked.length, 1);
  for (const n of [first, second]) assert.equal(n.children[0]!.children[0]!.getAttribute("src"), "/api/item-art/5431.png", "both drawings get the icon");
});

test("[fast] artTile keepBox: a failed load leaves an empty box, not a gap", () => {
  const tile = artTile(0x9999, { size: 24, keepBox: true }) as unknown as El;
  const img = tile.children[0]!;
  img.dispatch("error");
  assert.ok(has(tile, "art-none") && tile.children.length === 0);
  assert.ok(has(artTile(0x9999, { size: 24, keepBox: true }) as unknown as El, "art-none"), "a URL that failed is not asked again");
  assert.equal(artTile(null, { size: 24 }), null, "without keepBox, no art is no tile");
  const badge = (globalThis as unknown as { document: { createElement: (t: string) => El } }).document.createElement("span");
  for (const g of [null, 0x9999]) assert.equal((artTile(g, { size: 24, keepBox: true, badge: badge as unknown as HTMLElement }) as unknown as El).children[0], badge, "the badge stays in the empty box");
});

test("[fast] tipNode: the title carries the item's 32 px icon when its graphic is known", () => {
  const head = (n: unknown): El => (n as El).children.find((c) => has(c, "tip-head"))!;
  const withArt = head(tipNode({ name: "Cap", lines: ["Cap"], graphic: 0x1544, hue: 1230 }));
  assert.ok(has(withArt.children[0]!, "art-32"));
  const without = head(tipNode({ name: "Cap", lines: ["Cap"] }));
  assert.ok(!without.children.some((c) => has(c, "art-tile")));
});
