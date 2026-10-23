// ui-gear-item.test.mts — `app/ui/gear-item.mts`'s `gearItem` on a fake DOM, and the tooltip title's icon.
//
// `app/ui/gear-item.mts`'s `gearItem`: the row's parts in order (the icon as an aria-hidden tile with an empty alt, the name in its rarity's color token, the quantity, only the quality tags, then `after`), no color for a tier without a token, an empty box of the same size when there is no graphic and no tile at all with `showIcon: false`, the button `onOpen` makes, what a press hands it, its name (the piece and its quantity) and the tags and badges that describe it, the card's two lines beside a 32 px icon, the item tooltip's host (on hover only with `focus: false`, none with `tip: false`), no empty box with `keepBox: false`, the graphic, hue and rarity filled from the page's item cache, the missing ones looked up by serial in one batched request and the piece redrawn with them (a serial waiting or in flight asked once; one the server answered without not asked again until `forgetGearMisses`, but one whose request failed asked again; an answer arriving after `forgetGearMisses` neither drawn nor cached, its serials asked again), and the one-span rule on every variant; `app/ui/item-art.mts`'s `artTile` keeping its box, and its badge, when there is no art or it fails to load; `app/ui/dom.mts`'s `tipNode` title carrying a 32 px icon when the item's graphic is known. Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives. Tags: [fast].
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
let known: Record<number, unknown> = {}, hold: Promise<void> | null = null, failWith: number | "network" | null = null;
(globalThis as unknown as { fetch: unknown }).fetch = async (path: string) => {
  asked.push(path);
  if (hold) await hold;
  if (failWith === "network") throw new TypeError("offline");
  if (failWith) return { ok: false, status: failWith, json: async () => ({ ok: false, error: "boom" }) };
  const serials = new URL(path, "http://x").searchParams.get("serials")!.split(",").map(Number);
  return { ok: true, status: 200, json: async () => ({ ok: true, items: Object.fromEntries(serials.filter((s) => known[s]).map((s) => [s, known[s]])) }) };
};

const { gearItem, gearText, slotPieces, forgetGearMisses } = await import("./ui/gear-item.mts");
const { artTile } = await import("./ui/item-art.mts");
const { tipNode } = await import("./ui/dom.mts");
const { FLEX_CLASSES } = await import("./ui/components.mts");
const { state } = await import("./ui/store.mts");
type El = FakeElement;
const all = (n: El): El[] => [n, ...n.children.flatMap(all)];
const has = (n: El, c: string): boolean => n.classList.contains(c);
const draw = (...a: Parameters<typeof gearItem>): El => gearItem(...a) as unknown as El;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test("[fast] gearText: a sentence with each named piece as an inline gear item without an icon, whole words only, the longer name first", () => {
  const ring = { serial: 1, name: "Ring", graphic: 0x108a, hue: 0, rarity: "Greater Artifact" }, staff = { serial: 2, name: "Bladed Staff Of Haste", graphic: 0x26bd, hue: 0, rarity: null };
  const short = { serial: 3, name: "Bladed Staff", graphic: 0x26bd, hue: 0, rarity: null };
  const parts = gearText("2.75 s with Bladed Staff Of Haste; Ringmail is no Ring.", [short, null, ring, staff]) as Array<string | El>;
  const shown = parts.map((p) => (typeof p === "string" ? p : `[${p.textContent}]`)).join("");
  assert.equal(shown, "2.75 s with [Bladed Staff Of Haste]; Ringmail is no [Ring].", "the longer name wins its overlap, and Ringmail is not the Ring");
  const items = parts.filter((p): p is El => typeof p !== "string");
  assert.ok(items.every((n) => has(n, "gi-inline") && !all(n).some((x) => has(x, "art-tile"))), "inline, no icon");
  assert.equal(all(items[1]!).find((x) => has(x, "gi-name"))!.style.color, "var(--rarity-greater-artifact)");
  assert.ok(items.every((n) => has(n, "gi-in-text")), "flows as text in its sentence");
  assert.deepEqual(gearText("Nothing named here.", [ring]), ["Nothing named here."]);
  // Two pieces of one name take its matches in the order listed: the suit's Longsword, then the worn one.
  const suit = { serial: 7, name: "Longsword", graphic: 0xf61, hue: 0, rarity: "Greater Magic Item" }, worn = { serial: 8, name: "Longsword", graphic: 0xf61, hue: 0, rarity: null };
  const two = (gearText("the suit uses a Longsword; the goal was set for your Longsword", [suit, worn]) as Array<string | El>).filter((p): p is El => typeof p !== "string");
  assert.deepEqual(two.map((n) => n.dataset.serial), ["7", "8"]);
});

test("[fast] slotPieces: each slot's label plain and its piece once as a gear item, even a piece named after its slot", () => {
  const ring = { serial: 9, name: "Ring", graphic: 0x108a, hue: 0, rarity: "Greater Artifact" }, mask = { serial: 10, name: "Orc Mask", graphic: 0x141b, hue: 0, rarity: null };
  const parts = slotPieces([["Head", mask], ["Neck", null], ["Ring", ring]]) as Array<string | El>;
  assert.equal(parts.map((p) => (typeof p === "string" ? p : `[${p.textContent}]`)).join(""), "Head ([Orc Mask]), Neck, Ring ([Ring])");
  const items = parts.filter((p): p is El => typeof p !== "string");
  assert.deepEqual(items.map((n) => n.dataset.serial), ["10", "9"], "each piece drawn once");
  assert.ok(parts.includes("Ring"), "the Ring slot's label stays plain text");
  assert.equal(all(items[1]!).find((x) => has(x, "gi-name"))!.style.color, "var(--rarity-greater-artifact)", "the piece named Ring is colored");
});

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
  assert.equal(qty!.textContent, " ×3", "a space before it, so the text reads \"Orc Mask ×3\"");
  assert.equal(tag!.textContent, "Antique", "only the quality tag, not the slayer");
  assert.equal(last, after);
  assert.equal(n.children.length, 5);
  assert.equal(n.attrs["data-serial"], "1", "the item tooltip's host");
});

test("[fast] gearItem: no color for a tier without a token, no icon and no box with no graphic (#556), no tile with showIcon false", () => {
  const odd = draw({ serial: 2, name: "Odd Ring", rarity: "Shiny", graphic: null, hue: 0 });
  assert.deepEqual(odd.children.map((c) => c.className), ["gi-name"], "no art: the name starts the row, with no box holding its place");
  assert.equal(odd.children[0]!.style.color, undefined);
  const bare = draw({ serial: 3, name: "Ring", rarity: null, graphic: 7 }, { showIcon: false });
  assert.deepEqual(bare.children.map((c) => c.className), ["gi-name"]);
});

test("[fast] gearItem tip false: no data-serial and never wired as a tooltip (not made focusable), so the host around it answers", () => {
  const n = draw({ serial: 41, name: "Cloak", rarity: null, graphic: null }, { tip: false });
  assert.equal(n.getAttribute("data-serial"), null);
  assert.equal(n.tabIndex, -1);
  assert.deepEqual(n.children.map((c) => c.className), ["gi-name"], "no empty box");
});

test("[fast] gearItem focus false: the tooltip's host on hover, but no tab stop", () => {
  const n = draw({ serial: 42, name: "Sash", rarity: null, graphic: 1 }, { focus: false });
  assert.equal(n.getAttribute("data-serial"), "42");
  assert.equal(n.tabIndex, -1);
  assert.equal(draw({ serial: 43, name: "Sash", rarity: null, graphic: 1 }).tabIndex, 0, "by default it takes focus for its keyboard tooltip");
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
  assert.equal(draw({ serial: 9, name: "Gold", amount: 15000, rarity: null, graphic: 0xeed }).children[2]!.textContent, " ×15,000", "a large quantity has its thousands separator");
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
  assert.deepEqual(c.children.map((x) => x.className), ["gi-name"], "a serial the server lacks: the waiting box goes, no icon");
  draw({ serial: 11, name: "Axe" });
  draw({ serial: 13, name: "Gone" });
  await tick();
  assert.equal(asked.length, 1, "neither a found serial nor one the server lacks is asked again");
  forgetGearMisses();
  draw({ serial: 13, name: "Gone" });
  await tick();
  assert.match(asked[1]!, /serials=13$/, "a new inventory asks for a missed serial again");
});

test("[fast] gearItem: a request that failed (offline, a 500) records no miss, so the serial is asked again", async () => {
  known = {};
  for (const [serial, fail] of [[30, "network"], [32, 500]] as const) {
    asked.length = 0;
    failWith = fail;
    draw({ serial, name: "Sash" });
    await tick();
    failWith = null;
    draw({ serial, name: "Sash" });
    await tick();
    assert.equal(asked.length, 2, `${fail}: asked again`);
  }
});

test("[fast] gearItem: a new inventory drops the answer on its way, caches none of it, and asks again so the piece is still drawn", async () => {
  known = { 31: { serial: 31, name: "Robe", graphic: 0x1f03, hue: 0, rarity: null, tags: [] } };
  asked.length = 0;
  let release = (): void => {};
  hold = new Promise((r) => { release = r; });
  const n = draw({ serial: 31, name: "Robe" });
  await new Promise((r) => setTimeout(r, 0));
  forgetGearMisses();
  hold = null;
  release();
  await tick();
  assert.equal(asked.length, 2, "asked again of the new inventory");
  assert.equal(n.children[0]!.children[0]!.getAttribute("src"), "/api/item-art/7939.png", "drawn from the new answer");
  state.itemCache.delete(31);
});

test("[fast] resolveItems caches nothing from an answer that is no longer current", async () => {
  known = { 33: { serial: 33, name: "Cape", graphic: 0x1515, hue: 0, rarity: null, tags: [] } };
  const { resolveItems } = await import("./ui/items.mts");
  const found = await resolveItems([33], { current: () => false });
  assert.deepEqual(found, {});
  assert.equal(state.itemCache.has(33), false);
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

test("[fast] artTile: art that fails to load takes its tile with it, leaving no box (#556); a graphic that loads keeps its tile", () => {
  const doc = (globalThis as unknown as { document: { createElement: (t: string) => El } }).document;
  const host = doc.createElement("span"), tile = artTile(0x9999, { size: 24 }) as unknown as El;
  host.append(tile);
  assert.ok(has(tile, "art-tile") && !has(tile, "art-none") && tile.children[0]!.tagName === "IMG", "while it loads, the tile keeps its place (no shift on a slow load)");
  tile.children[0]!.dispatch("error");
  assert.equal(host.children.length, 0, "a failed load removes the tile");
  assert.equal(artTile(0x9999, { size: 24 }), null, "a URL that failed is not asked again, and gives no tile");
  assert.equal(artTile(null, { size: 24 }), null, "no graphic, no tile");
  const ok = artTile(0x1544, { size: 24 }) as unknown as El, okHost = doc.createElement("span");
  okHost.append(ok);
  ok.children[0]!.dispatch("load");
  assert.equal(okHost.children[0], ok, "art that loads stays");
  const badge = doc.createElement("span");
  for (const g of [null, 0x9999]) assert.equal(artTile(g, { size: 24, badge: badge as unknown as HTMLElement }) as unknown as El, badge, "with a badge, the badge alone takes the art's place");
});

test("[fast] tipNode: the title carries the item's 32 px icon when its graphic is known", () => {
  const head = (n: unknown): El => (n as El).children.find((c) => has(c, "tip-head"))!;
  const withArt = head(tipNode({ name: "Cap", lines: ["Cap"], graphic: 0x1544, hue: 1230 }));
  assert.ok(has(withArt.children[0]!, "art-32"));
  const without = head(tipNode({ name: "Cap", lines: ["Cap"] }));
  assert.ok(!without.children.some((c) => has(c, "art-tile")));
});
