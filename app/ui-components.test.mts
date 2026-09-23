// ui-components.test.mts — app/ui/components.mts's builders, on a fake DOM just big enough for them. The
// structural rule under test is the one-span rule (docs/ui.md): no element the builders draw as a flex or grid
// container ever holds a bare text node, and FLEX_CLASSES — the list that rule is checked against — matches
// what app/ui/components.css really draws as flex/grid. Behaviour that needs a real browser (focus traps,
// popovers, the native <dialog>) is driven in the Electron window by scripts/ui-components.test.mts.
// Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives. Tags: [fast].
import "../scripts/localstorage-shim-for-tests.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  dataset: Record<string, string> = {};
  disabled = false; checked = false; value = ""; tabIndex = 0; id = "";
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get className(): string { return this.attrs.class || ""; }
  set className(v: string) { this.attrs.class = v; }
  get classList(): { add: (c: string) => void; contains: (c: string) => boolean } {
    return { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, contains: (c) => this.className.split(/\s+/).includes(c) };
  }
  setAttribute(k: string, v: unknown): void { this.attrs[k] = String(v); if (k === "id") this.id = String(v); if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = String(v); }
  getAttribute(k: string): string | null { return k in this.attrs ? this.attrs[k]! : null; }
  addEventListener(type: string, fn: (e: unknown) => void): void { (this.listeners[type] ||= []).push(fn); }
  dispatch(type: string, e: Record<string, unknown> = {}): void { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...e }); }
  append(...kids: Array<FakeElement | FakeText | string>): void { for (const k of kids) { const n = typeof k === "string" ? new FakeText(k) : k; n.parentNode = this; this.childNodes.push(n); } }
  focus(): void { (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement = this; }
  get children(): FakeElement[] { return this.childNodes.filter((c): c is FakeElement => c.nodeType === 1); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
}
(globalThis as unknown as { document: unknown }).document = {
  activeElement: null,
  createElement: (t: string) => new FakeElement(t),
  createElementNS: (_ns: string, t: string) => new FakeElement(t),
  createTextNode: (s: string) => new FakeText(s),
};

const C = await import("./ui/components.mts");
type El = FakeElement;
const all = (n: El): El[] => [n, ...n.children.flatMap(all)];
const FLEX = new Set<string>(C.FLEX_CLASSES);

// Every element of `root` whose class makes it a flex/grid container holds element children only.
function assertOneSpan(root: El, what: string): void {
  for (const e of all(root)) {
    const classes = e.className.split(/\s+/).filter(Boolean);
    if (!classes.some((c) => FLEX.has(c))) continue;
    const bare = e.childNodes.filter((c) => c.nodeType === 3 && c.textContent.trim());
    assert.equal(bare.length, 0, `${what}: <${e.tagName.toLowerCase()} class="${e.className}"> holds bare text ${JSON.stringify(bare.map((b) => b.textContent))}`);
  }
}

test("[fast] FLEX_CLASSES lists exactly the classes components.css draws as flex or grid", () => {
  const css = readFileSync(new URL("./ui/components.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const drawn = new Set<string>();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*display:\s*(inline-)?(flex|grid)\b/.test(body!)) continue;
    for (const sel of selectors!.split(",")) {
      const subject = sel.trim().split(/[\s>]+/).pop()!;          // the element the rule styles
      for (const [, cls] of subject.matchAll(/\.([\w-]+)/g)) if (!/^(pr|open|collapsed|set|add|off|seg-md|btn-\w+|input-\w+)$/.test(cls!)) drawn.add(cls!);
    }
  }
  const missing = [...drawn].filter((c) => !FLEX.has(c));
  assert.deepEqual(missing, [], "a flex/grid class in components.css that FLEX_CLASSES does not list");
});

test("[fast] box() refuses bare text: a flex/grid container holds only elements", () => {
  assert.throws(() => C.box("div", { class: "row" }, "loose text" as unknown as Node), /wrap text in txt\(\)/);
  assert.throws(() => C.box("div", {}, 5 as unknown as Node), TypeError);
  const ok = C.box("div", { class: "toast" }, C.txt("fine"), null, false) as unknown as El;
  assert.equal(ok.childNodes.length, 1);
});

test("[fast] txt() is exactly one span holding one text node", () => {
  const s = C.txt("110 (102 + 8)", "muted") as unknown as El;
  assert.equal(s.tagName, "SPAN");
  assert.equal(s.className, "muted");
  assert.equal(s.childNodes.length, 1);
  assert.equal(s.childNodes[0]!.nodeType, 3);
});

test("[fast] every builder keeps the one-span rule", () => {
  const noop = (): void => {};
  const built: Array<[string, unknown]> = [
    ["button", C.button({ label: "Grab all 8", icon: "grab", variant: "primary", kbd: "⌘↵" })],
    ["icon button", C.button({ label: "Close", icon: "close", iconOnly: true, variant: "ghost" })],
    ["danger button", C.button({ label: "Forget Dorran", variant: "danger" })],
    ["field", C.field({ label: "Restarts", control: C.input({ type: "number", value: 300000 }) as unknown as HTMLElement, help: "Solver restarts.", error: "Enter a whole number from 1 to 10,000." })],
    ["search", C.searchInput({ label: "Search items", placeholder: "Search", hint: "/" }).root],
    ["select", C.select([{ value: "a", label: "A" }], "a")],
    ["checkbox", C.check({ label: "Allow gear worn by other characters" }).root],
    ["switch", C.switchControl({ label: "Meditation-safe only", checked: true }).root],
    ["segmented", C.segmented({ label: "View", options: [{ value: "items", label: "Items" }, { value: "containers", label: "Containers" }], value: "items" })],
    ["filter chip", C.filterChip({ label: "Rarity ≥ Greater Magic", set: true })],
    ["add chip", C.filterChip({ label: "Filter", add: true })],
    ["token", C.token({ label: "Kind: gear", removeLabel: "Remove filter: Kind", onRemove: noop })],
    ["pill", C.pill({ label: "cursed", pressed: true, off: true })],
    ["badge", C.badge("Proven optimal", "ok")],
    ["tag", C.tag("Antique", "warn")],
    ["message", C.message({ tone: "bad", title: "Couldn't load the inventory", text: "internal error. Your scans are safe on disk.", actions: [C.button({ label: "Try again" })] })],
    ["meter", C.meter(41, 70, { tone: "ok", label: "Cold" })],
    ["progress", C.progress(8024, 10000, "Restarts")],
    ["stepper", C.stepper(["Shard", "Client", "Client folder", "Install scanner"], 1)],
    ["key/value", C.keyValue([["Strength", C.txt("110")], ["Luck", "126"], ["Weight", 6]])],
    ["card", C.card({ title: "Other suits", actions: [C.button({ label: "Compare 2 suits", size: "sm" })], body: [C.txt("body")] })],
    ["table", C.table({ label: "Items", columns: [{ label: "Name", sort: "ascending" }, { label: "Phys", num: true, sort: "none" }], rows: [{ cells: ["Arcane Ring", 12] }] })],
    ["table foot", C.tableFoot("45 of 160 stacks", "45 pieces", "3 filters")],
    ["row actions", C.rowActions([{ label: "Grab", icon: "grab", onClick: noop }, { label: "Go to", icon: "goto", onClick: noop, disabled: "Bridge offline." }])],
  ];
  for (const [what, node] of built) assertOneSpan(node as El, what);
});

test("[fast] buttons: variants are compound classes, an icon-only button is named, disabled is real", () => {
  const b = C.button({ label: "Build best suit", variant: "primary", size: "lg" }) as unknown as El;
  assert.equal(b.className, "btn btn-primary btn-lg");
  assert.equal(b.getAttribute("type"), "button");
  const i = C.button({ label: "Remove requirement: Fire resist", icon: "close", iconOnly: true, disabled: true }) as unknown as El;
  assert.equal(i.getAttribute("aria-label"), "Remove requirement: Fire resist");
  assert.equal(i.textContent, "", "no visible label");
  assert.equal(i.disabled, true);
});

test("[fast] field(): label for=, help and error wired through aria-describedby and aria-invalid", () => {
  const control = C.input({ type: "number", value: 300000 }) as unknown as El;
  const f = C.field({ label: "Restarts", control: control as unknown as HTMLElement, help: "How many restarts.", error: "Enter a whole number from 1 to 10,000." }) as unknown as El;
  const label = all(f).find((e) => e.tagName === "LABEL")!;
  assert.equal(label.getAttribute("for"), control.id);
  assert.equal(control.getAttribute("aria-invalid"), "true");
  assert.equal(control.getAttribute("aria-describedby"), `${control.id}-help ${control.id}-err`);
});

test("[fast] segmented(): radios with one in the tab order, arrow keys move and report the choice", () => {
  const picked: string[] = [];
  const seg = C.segmented({ label: "Appearance", options: [{ value: "light", label: "Light" }, { value: "system", label: "System" }, { value: "dark", label: "Dark" }], value: "system", onChange: (v) => picked.push(v) }) as unknown as El;
  assert.equal(seg.getAttribute("role"), "radiogroup");
  const [light, system, dark] = seg.children;
  assert.deepEqual([light!.getAttribute("aria-checked"), system!.getAttribute("aria-checked"), dark!.getAttribute("aria-checked")], ["false", "true", "false"]);
  assert.deepEqual([light!.tabIndex, system!.tabIndex, dark!.tabIndex], [-1, 0, -1]);
  system!.dispatch("keydown", { key: "ArrowRight" });
  assert.deepEqual(picked, ["dark"]);
  assert.equal(dark!.getAttribute("aria-checked"), "true");
  dark!.dispatch("keydown", { key: "ArrowRight" });
  assert.deepEqual(picked, ["dark", "light"], "wraps round");
  light!.dispatch("click");
  assert.equal(picked.at(-1), "light");
});

test("[fast] stepper(): done steps say so to a screen reader, the current one is aria-current", () => {
  const s = C.stepper(["Shard", "Client", "Client folder"], 1) as unknown as El;
  const steps = all(s).filter((e) => e.className.split(" ").includes("step"));
  assert.deepEqual(steps.map((e) => e.className), ["step done", "step current", "step"]);
  assert.equal(steps[1]!.getAttribute("aria-current"), "step");
  assert.match(steps[0]!.textContent, /\(done\)/);
});

test("[fast] tableFoot() separates facts with a middot span, never a bare one", () => {
  const f = C.tableFoot("0 of 160 stacks", null, "2 filters") as unknown as El;
  assert.deepEqual(f.children.map((c) => c.textContent), ["0 of 160 stacks", "·", "2 filters"]);
});

test("[fast] table(): sortable headers are buttons, the sorted one carries aria-sort, numbers right-aligned", () => {
  const t = C.table({ label: "Items", columns: [{ label: "Name", sort: "ascending" }, { label: "Phys", num: true, sort: "none" }], rows: [{ cells: ["Arcane Ring", null] }] }) as unknown as El;
  const ths = all(t).filter((e) => e.tagName === "TH");
  assert.equal(ths[0]!.getAttribute("aria-sort"), "ascending");
  assert.equal(ths[1]!.getAttribute("aria-sort"), null);
  assert.ok(ths.every((th) => th.children[0]!.tagName === "BUTTON"));
  const tds = all(t).filter((e) => e.tagName === "TD");
  assert.equal(tds[1]!.className, "num");
  assert.equal(tds[1]!.textContent, "", "an empty cell is blank, not a placeholder");
});

test("[fast] popoverPlacement: below the anchor, above when only that fits, and never past the viewport", () => {
  const vp = { width: 800, height: 600 };
  // Room below: under the anchor, capped to the room there.
  assert.deepEqual(C.popoverPlacement({ top: 40, bottom: 68, left: 100 }, { width: 288, height: 200 }, vp), { top: 74, left: 100, maxHeight: 518 });
  // Near the bottom, fits above: above it.
  assert.deepEqual(C.popoverPlacement({ top: 500, bottom: 528, left: 100 }, { width: 288, height: 200 }, vp), { top: 294, left: 100, maxHeight: 486 });
  // Taller than either side (the table-settings popover at 800 × 600): the larger side, capped to it, so it
  // scrolls inside and its bottom stays on screen.
  const tall = C.popoverPlacement({ top: 90, bottom: 118, left: 600 }, { width: 288, height: 900 }, vp);
  assert.deepEqual(tall, { top: 124, left: 504, maxHeight: 468 });
  assert.ok(tall.top + tall.maxHeight <= vp.height - 8, "its bottom edge is inside the viewport");
  // Squeezed against the left edge.
  assert.equal(C.popoverPlacement({ top: 40, bottom: 68, left: -20 }, { width: 288, height: 100 }, vp).left, 8);
});
