// ui/components.mts — the page's component primitives (docs/ui.md), as small DOM builders over dom.mts's el().
// Their CSS is ui/components.css. Every builder here keeps the one-span rule: an element that is a flex or
// grid container holds only element children, and every run of text is one <span>. Builders that take text
// wrap it themselves (txt()); box() is the flex/grid container builder for everything else, and it refuses a
// bare string or number among its children. Nothing here sets innerHTML: icons are built node by node.
import { el } from "./dom.mts";
import type { ElAttrs } from "./dom.mts";

// ---------------------------------------------------------------- text and containers
// Content a builder accepts where a label goes: a string (wrapped in one span) or a ready node.
export type Content = string | number | Node;
export type Kids = Array<Node | null | undefined | false>;

// The one-span helper: a run of text as exactly one <span>.
export function txt(text: string | number, cls = ""): HTMLSpanElement {
  return el("span", cls ? { class: cls } : {}, String(text));
}
const asNode = (c: Content): Node => (typeof c === "string" || typeof c === "number" ? txt(c) : c);

// A flex/grid container. Throws on a bare string or number child: that is the text node grid/flex
// auto-placement would split off into its own track item.
export function box<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: ElAttrs, ...kids: Kids): HTMLElementTagNameMap[K] {
  for (const k of kids) if (typeof k === "string" || typeof k === "number") throw new TypeError(`box(<${tag}>): wrap text in txt() — a flex/grid container holds only elements`);
  return el(tag, attrs, ...kids.filter((k): k is Node => !!k));
}

// Every class components.css draws as display: flex | grid | inline-flex. app/ui-components.test.mts checks
// this list against the stylesheet, and that no builder puts a text node directly inside one of them.
export const FLEX_CLASSES = [
  "shell", "sidebar", "brand", "nav-item", "menu-item", "sidebar-foot", "main", "topbar", "page", "bridge",
  "btn", "field", "search", "check", "seg", "fchip", "token", "pill", "badge", "tag", "rar-tier", "card-head",
  "tbl-foot", "rowact", "overlay-head", "overlay-foot", "overlay-titles", "toast", "toasts", "msg", "msg-body", "msg-actions",
  "meter", "stepper", "step", "step-dot", "kv", "kv-k", "kv-v", "resist", "slot", "drawer", "drawer-body",
  "dialog", "dialog-body", "dialog-foot", "pop-body", "tipwrap", "empty-state",
] as const;

// ---------------------------------------------------------------- icons
// 24-unit stroke icons from the design canvas. Each entry is a list of [element, attributes].
type Shape = [string, Record<string, string>];
const P = (d: string): Shape => ["path", { d }];
const ICONS = {
  inventory: [P("M3 7l9-4 9 4v10l-9 4-9-4z"), P("M3 7l9 4 9-4M12 11v10")],
  characters: [["circle", { cx: "9", cy: "8", r: "3.5" }], P("M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"), P("M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.4 3.5 5.2")],
  builder: [P("M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z")],
  runs: [["circle", { cx: "12", cy: "12", r: "9" }], P("M12 7v5l3 2")],
  import: [P("M12 3v12M7 10l5 5 5-5"), P("M4 17v3h16v-3")],
  settings: [["circle", { cx: "12", cy: "12", r: "3" }], P("M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1")],
  close: [P("M18 6 6 18M6 6l12 12")],
  "chevron-down": [P("m6 9 6 6 6-6")],
  "chevron-up": [P("m6 15 6-6 6 6")],
  "chevron-left": [P("m15 6-6 6 6 6")],
  "chevron-right": [P("m9 6 6 6-6 6")],
  plus: [P("M12 5v14M5 12h14")],
  search: [["circle", { cx: "11", cy: "11", r: "7" }], P("m20 20-3.5-3.5")],
  check: [P("M5 12.5l4.5 4.5L19 7")],
  info: [["circle", { cx: "12", cy: "12", r: "9" }], P("M12 11v5M12 8v.01")],
  alert: [P("M12 3 2 20h20z"), P("M12 10v4M12 17.5v.01")],
  sliders: [P("M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"), ["circle", { cx: "16", cy: "6", r: "2" }], ["circle", { cx: "10", cy: "12", r: "2" }], ["circle", { cx: "18", cy: "18", r: "2" }]],
  "arrow-up": [P("M12 19V5M6 11l6-6 6 6")],
  "arrow-down": [P("M12 5v14M6 13l6 6 6-6")],
  "arrow-right": [P("M5 12h14M13 6l6 6-6 6")],
  lock: [["rect", { x: "5", y: "11", width: "14", height: "10", rx: "2" }], P("M8 11V7a4 4 0 0 1 8 0v4")],
  grab: [P("M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4.5 15a1.6 1.6 0 0 1 2.4-2l1.1 1")],
  highlight: [P("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"), ["circle", { cx: "12", cy: "12", r: "3" }]],
  goto: [P("M3 11l18-8-8 18-2-8z")],
  folder: [P("M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z")],
  refresh: [P("M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4")],
  clipboard: [["rect", { x: "6", y: "4", width: "12", height: "17", rx: "2" }], P("M9 4h6v3H9z")],
  moon: [P("M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z")],
  sun: [["circle", { cx: "12", cy: "12", r: "4" }], P("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4")],
  more: [["circle", { cx: "5", cy: "12", r: "1.3" }], ["circle", { cx: "12", cy: "12", r: "1.3" }], ["circle", { cx: "19", cy: "12", r: "1.3" }]],
  "panel-left": [["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }], P("M9 4v16")],
} satisfies Record<string, Shape[]>;
export type IconName = keyof typeof ICONS;
const SVG_NS = "http://www.w3.org/2000/svg";
export function icon(name: IconName, { size = "md", cls = "" }: { size?: "sm" | "md"; cls?: string } = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `i${size === "sm" ? " i-sm" : ""}${cls ? " " + cls : ""}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of ICONS[name] as Shape[]) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.append(shape);
  }
  return svg;
}

// ---------------------------------------------------------------- buttons
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
export type Size = "sm" | "md" | "lg";
export interface ButtonOptions {
  label: string;                 // the visible label, or the aria-label when iconOnly
  icon?: IconName | undefined;
  iconAfter?: IconName | undefined;
  variant?: ButtonVariant | undefined;
  size?: Size | undefined;
  iconOnly?: boolean | undefined;
  kbd?: string | undefined;      // a key hint drawn inside the button ("⌘↵")
  disabled?: boolean | undefined;
  block?: boolean | undefined;
  cls?: string | undefined;      // extra classes
  type?: "button" | "submit" | undefined;
  onClick?: ((e: MouseEvent) => unknown) | undefined;
  attrs?: ElAttrs | undefined;
}
export function button(o: ButtonOptions): HTMLButtonElement {
  const cls = ["btn", o.variant && o.variant !== "secondary" ? `btn-${o.variant}` : "", o.size && o.size !== "md" ? `btn-${o.size}` : "", o.iconOnly ? "btn-icon" : "", o.block ? "btn-block" : "", o.cls || ""].filter(Boolean).join(" ");
  const attrs: ElAttrs = { class: cls, type: o.type || "button", ...(o.attrs || {}) };
  if (o.iconOnly) attrs["aria-label"] = o.label;
  if (o.onClick) attrs.onclick = o.onClick;
  const b = box("button", attrs,
    o.icon ? icon(o.icon, { size: o.size === "sm" ? "sm" : "md" }) : null,
    o.iconOnly ? null : txt(o.label),
    o.kbd ? kbd(o.kbd) : null,
    o.iconAfter ? icon(o.iconAfter, { size: "sm" }) : null);
  if (o.disabled) b.disabled = true;
  return b;
}
export const kbd = (keys: string): HTMLElement => el("kbd", { class: "kbd" }, keys);

// ---------------------------------------------------------------- fields
let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

export interface InputOptions {
  type?: string | undefined;
  value?: string | number | undefined;
  placeholder?: string | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  attrs?: ElAttrs | undefined;
}
export function input(o: InputOptions = {}): HTMLInputElement {
  const cls = ["input", o.size === "sm" ? "input-sm" : o.size === "lg" ? "input-lg" : "", o.type === "number" ? "num" : "", o.invalid ? "invalid" : ""].filter(Boolean).join(" ");
  const i = el("input", { class: cls, type: o.type || "text", ...(o.placeholder ? { placeholder: o.placeholder } : {}), ...(o.attrs || {}) });
  if (o.value != null) i.value = String(o.value);
  if (o.invalid) i.setAttribute("aria-invalid", "true");
  return i;
}
export interface SelectOption { value: string; label: string; disabled?: boolean | undefined }
export function select(options: SelectOption[], value = "", { size, attrs }: { size?: Size | undefined; attrs?: ElAttrs | undefined } = {}): HTMLSelectElement {
  const s = el("select", { class: `select${size === "sm" ? " input-sm" : ""}`, ...(attrs || {}) },
    ...options.map((o) => el("option", { value: o.value, ...(o.disabled ? { disabled: "" } : {}) }, o.label)));
  s.value = value;
  return s;
}
export function textarea({ value = "", rows = 6, placeholder = "", attrs = {} }: { value?: string; rows?: number; placeholder?: string; attrs?: ElAttrs } = {}): HTMLTextAreaElement {
  const t = el("textarea", { class: "textarea", rows, ...(placeholder ? { placeholder } : {}), ...attrs });
  t.value = value;
  return t;
}
// A search input with its leading icon and an optional key hint ("/").
export function searchInput({ label, placeholder = "", value = "", hint, attrs = {} }: { label: string; placeholder?: string; value?: string; hint?: string; attrs?: ElAttrs }): { root: HTMLDivElement; input: HTMLInputElement } {
  const id = String(attrs.id || nextId("search"));
  const i = input({ type: "search", value, placeholder, attrs: { ...attrs, id } });
  const root = box("div", { class: "search" }, icon("search"), el("label", { class: "sr", for: id }, label), i, hint ? kbd(hint) : null);
  return { root, input: i };
}
// A labelled field: label, the control, an optional help line and an optional error line, wired together
// (for=, aria-describedby, aria-invalid). The error is written in plain words with the allowed range.
export function field({ label, control, help, error }: { label: string; control: HTMLElement; help?: string | undefined; error?: string | undefined }): HTMLDivElement {
  const id = control.id || nextId("f");
  control.id = id;
  const helpEl = help ? txt(help, "help") : null;
  const errEl = error ? txt(error, "field-error") : null;
  if (helpEl) helpEl.id = `${id}-help`;
  if (errEl) { errEl.id = `${id}-err`; control.setAttribute("aria-invalid", "true"); control.classList.add("invalid"); }
  const described = [helpEl?.id, errEl?.id].filter(Boolean).join(" ");
  if (described) control.setAttribute("aria-describedby", described);
  return box("div", { class: "field" }, el("label", { class: "label", for: id }, label), control, helpEl, errEl);
}
// A checkbox or switch row: [input] [span text]. A switch is a checkbox with role=switch.
export function check({ label, checked = false, sw = false, disabled = false, onChange, attrs = {} }: { label: string; checked?: boolean; sw?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void; attrs?: ElAttrs }): { root: HTMLLabelElement; input: HTMLInputElement } {
  const i = el("input", { type: "checkbox", ...(sw ? { class: "switch", role: "switch" } : {}), ...attrs });
  i.checked = checked;
  i.disabled = disabled;
  if (onChange) i.addEventListener("change", () => onChange(i.checked));
  return { root: box("label", { class: "check" }, i, txt(label)), input: i };
}
export const switchControl = (o: Omit<Parameters<typeof check>[0], "sw">): ReturnType<typeof check> => check({ ...o, sw: true });

// ---------------------------------------------------------------- segmented control
// A single choice among 2-4 short options: role=radiogroup, one radio per option, arrow keys move and select,
// only the checked one is in the tab order.
export interface SegOption { value: string; label: string; disabled?: boolean | undefined }
export function segmented({ label, options, value, onChange, size }: { label: string; options: SegOption[]; value: string; onChange?: (value: string) => void; size?: "sm" | "md" }): HTMLDivElement & { setValue: (v: string) => void } {
  const btns = options.map((o) => {
    const b = box("button", { type: "button", role: "radio", "data-value": o.value }, txt(o.label));
    if (o.disabled) b.disabled = true;
    return b;
  });
  const root = box("div", { class: `seg${size === "md" ? " seg-md" : ""}`, role: "radiogroup", "aria-label": label }, ...btns) as HTMLDivElement & { setValue: (v: string) => void };
  const paint = (v: string): void => { for (const b of btns) { const on = b.dataset.value === v; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; } };
  const pick = (b: HTMLButtonElement, focus: boolean): void => { paint(b.dataset.value!); if (focus) b.focus(); onChange?.(b.dataset.value!); };
  for (const b of btns) {
    b.addEventListener("click", () => pick(b, false));
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const live = btns.filter((x) => !x.disabled);
      const next = live[(live.indexOf(b) + step + live.length) % live.length];
      if (next) pick(next, true);
    });
  }
  root.setValue = paint;
  paint(value);
  return root;
}

// ---------------------------------------------------------------- chips, tokens, pills, badges, tags
// A filter chip: a dropdown chip (label + chevron) that opens a popover, "set" when it holds a value, or the
// dashed "+ Filter" chip.
export function filterChip({ label, set = false, add = false, onClick, attrs = {} }: { label: string; set?: boolean; add?: boolean; onClick?: (e: MouseEvent) => void; attrs?: ElAttrs }): HTMLButtonElement {
  return box("button", { class: `fchip${set ? " set" : ""}${add ? " add" : ""}`, type: "button", "aria-haspopup": add ? "menu" : "listbox", "aria-expanded": "false", ...(onClick ? { onclick: onClick } : {}), ...attrs },
    add ? icon("plus", { size: "sm" }) : null, txt(label), add ? null : icon("chevron-down", { size: "sm" }));
}
// A removable token (an active filter, a compared suit). removeLabel names what the × removes.
export function token({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }): HTMLSpanElement {
  return box("span", { class: "token" }, txt(label),
    box("button", { type: "button", "aria-label": removeLabel, onclick: onRemove }, icon("close", { size: "sm" })));
}
// A toggle pill (aria-pressed). `off` draws the pressed state as struck through: "hidden".
export function pill({ label, pressed = false, off = false, onToggle }: { label: string; pressed?: boolean; off?: boolean; onToggle?: (pressed: boolean) => void }): HTMLButtonElement {
  const b = box("button", { type: "button", class: `pill${off ? " off" : ""}`, "aria-pressed": String(pressed) }, txt(label));
  b.addEventListener("click", () => { const now = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(now)); onToggle?.(now); });
  return b;
}
export type Tone = "ok" | "warn" | "bad" | "accent" | "best" | "info";
export function badge(text: string, tone?: Exclude<Tone, "info">): HTMLSpanElement {
  return box("span", { class: `badge${tone ? " " + tone : ""}` }, txt(text));
}
export function tag(text: string, tone?: "bad" | "warn"): HTMLSpanElement {
  return box("span", { class: `tag${tone ? " " + tone : ""}` }, txt(text));
}

// ---------------------------------------------------------------- messages, meters, progress, stepper
const MSG_ICON: Record<"info" | "ok" | "warn" | "bad", IconName> = { info: "info", ok: "check", warn: "alert", bad: "alert" };
// An inline message about the thing it sits in: an icon, an optional bold title, the text, optional actions.
export function message({ tone = "info", title, text, actions = [], attrs = {} }: { tone?: "info" | "ok" | "warn" | "bad"; title?: string | undefined; text: Content; actions?: HTMLElement[]; attrs?: ElAttrs }): HTMLDivElement {
  const role = tone === "bad" ? "alert" : "status";
  return box("div", { class: `msg ${tone}`, role, ...attrs }, icon(MSG_ICON[tone]),
    box("span", { class: "msg-body" }, title ? txt(title, "strong") : null, asNode(text), actions.length ? box("span", { class: "msg-actions" }, ...actions) : null));
}
export function meter(value: number, max: number, { tone, label }: { tone?: "ok" | "warn" | undefined; label?: string | undefined } = {}): HTMLDivElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  return box("div", { class: `meter${tone ? " " + tone : ""}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": value, ...(label ? { "aria-label": label } : {}) },
    el("span", { style: `width:${pct}%` }));
}
export function progress(value: number, max: number, label: string): HTMLDivElement & { set: (v: number) => void } {
  const bar = el("span", {});
  const root = el("div", { class: "progress", role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": max }, bar) as HTMLDivElement & { set: (v: number) => void };
  root.set = (v: number): void => { root.setAttribute("aria-valuenow", String(v)); bar.style.width = `${max > 0 ? Math.max(0, Math.min(100, (100 * v) / max)) : 0}%`; };
  root.set(value);
  return root;
}
// A named-step stepper: done steps show a check, the current one is filled and aria-current="step".
export function stepper(steps: string[], current: number, label = "Progress"): HTMLOListElement {
  const kids: HTMLElement[] = [];
  steps.forEach((s, i) => {
    if (i) kids.push(el("li", { class: "step-line", "aria-hidden": "true" }));
    const state = i < current ? "done" : i === current ? "current" : "";
    kids.push(box("li", { class: `step${state ? " " + state : ""}`, ...(state === "current" ? { "aria-current": "step" } : {}) },
      box("span", { class: "step-dot", "aria-hidden": "true" }, i < current ? icon("check", { size: "sm" }) : txt(i + 1)),
      txt(s), state === "done" ? txt("(done)", "sr") : null));
  });
  return box("ol", { class: "stepper", "aria-label": label }, ...kids);
}

// ---------------------------------------------------------------- key/value, card
// A key/value list: [key, value] rows on a two-column grid. A value may be a node ("110 (102 + 8)" built as
// one span holding a muted span).
export function keyValue(pairs: Array<[string, Content]>): HTMLDivElement {
  return box("div", { class: "kv" }, ...pairs.flatMap(([k, v]) => [box("div", { class: "kv-k" }, txt(k)), box("div", { class: "kv-v" }, asNode(v))]));
}
export function card({ title, titleTag = "h2", actions = [], body = [], pad = true, attrs = {} }: { title?: string | undefined; titleTag?: "h2" | "h3"; actions?: HTMLElement[]; body?: Kids; pad?: boolean; attrs?: ElAttrs }): HTMLElement {
  const head = title ? box("div", { class: "card-head" }, el(titleTag, {}, title), actions.length ? el("span", { class: "spacer" }) : null, ...actions) : null;
  return el("section", { class: "card", ...attrs }, head, el("div", { class: pad ? "card-body card-pad" : "card-body" }, ...body.filter((k): k is Node => !!k)));
}

// ---------------------------------------------------------------- table
export interface Column {
  label: string;
  num?: boolean | undefined;
  width?: string | undefined;
  sort?: "ascending" | "descending" | "none" | undefined;   // present = sortable; the header is a button
  onSort?: (() => void) | undefined;
}
export interface Row { cells: Array<Content | null | undefined>; attrs?: ElAttrs | undefined }
export function table({ label, columns, rows, density = "dense" }: { label: string; columns: Column[]; rows: Row[]; density?: "dense" | "regular" }): HTMLTableElement {
  const head = el("tr", {}, ...columns.map((c) => {
    const sorted = c.sort === "ascending" || c.sort === "descending";
    const inner = c.sort ? box("button", { type: "button", ...(c.onSort ? { onclick: c.onSort } : {}) }, txt(c.label), sorted ? icon(c.sort === "ascending" ? "arrow-up" : "arrow-down", { size: "sm" }) : null) : txt(c.label);
    return el("th", { class: c.num ? "num" : "", scope: "col", ...(sorted ? { "aria-sort": c.sort } : {}) }, inner);
  }));
  const colgroup = columns.some((c) => c.width) ? el("colgroup", {}, ...columns.map((c) => el("col", c.width ? { style: `width:${c.width}` } : {}))) : null;
  return el("table", { class: `tbl${density === "regular" ? " tbl-regular" : ""}`, "aria-label": label }, colgroup, el("thead", {}, head),
    el("tbody", {}, ...rows.map((r) => el("tr", r.attrs || {}, ...r.cells.map((cell, i) => el("td", { class: columns[i]?.num ? "num" : "" }, cell == null ? "" : typeof cell === "object" ? cell : String(cell)))))));
}
// The table's footer strip: facts separated by middots ("45 of 160 stacks · 3 filters").
export function tableFoot(...parts: Array<Content | null | undefined>): HTMLDivElement {
  const kids: Node[] = [];
  for (const p of parts.filter((x): x is Content => x != null && x !== "")) {
    if (kids.length && !(typeof p === "object" && (p as Element).classList?.contains("spacer"))) kids.push(el("span", { class: "faint", "aria-hidden": "true" }, "·"));
    kids.push(asNode(p));
  }
  return box("div", { class: "tbl-foot" }, ...kids);
}
// Row actions: small icon buttons at the end of a row. A disabled one carries its reason as a tooltip.
export function rowActions(actions: Array<{ label: string; icon: IconName; onClick: (e: MouseEvent) => void; disabled?: string | null | undefined }>): HTMLSpanElement {
  return box("span", { class: "rowact" }, ...actions.map((a) => {
    const b = button({ label: a.label, icon: a.icon, iconOnly: true, size: "sm", variant: "ghost", disabled: !!a.disabled, onClick: (e) => { e.stopPropagation(); a.onClick(e); } });
    return a.disabled ? tipWrap(b, a.disabled) : (tooltip(b, a.label), b);
  }));
}

// ---------------------------------------------------------------- overlay plumbing
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.closest("[hidden], [inert]") && e.getClientRects().length > 0);
}
function trapTab(root: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") return;
  const f = focusables(root);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0]!, last = f[f.length - 1]!;
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
// The app shell (#app) goes inert while a modal drawer is open, so neither focus nor a screen reader can
// leave the drawer; a counter keeps it inert while more than one is open.
let modals = 0;
function setBackgroundInert(on: boolean): void {
  modals = Math.max(0, modals + (on ? 1 : -1));
  const app = document.getElementById("app");
  if (app) app.inert = modals > 0;
}

// ---------------------------------------------------------------- popover
// Where a popover goes: under its anchor, or above it when it fits there and not below; never past the
// viewport's edges (8 px margin). maxHeight is the room on the chosen side, so a popover taller than that
// scrolls inside itself (.pop has overflow: auto) and its last control — "Done" — stays reachable.
const EDGE = 8, GAP = 6;
export function popoverPlacement(a: { top: number; bottom: number; left: number }, size: { width: number; height: number }, vp: { width: number; height: number }): { top: number; left: number; maxHeight: number } {
  const below = Math.max(0, vp.height - EDGE - (a.bottom + GAP)), above = Math.max(0, a.top - GAP - EDGE);
  const up = size.height > below && above > below;
  const room = up ? above : below;
  const h = Math.min(size.height, room);
  const top = up ? a.top - GAP - h : a.bottom + GAP;
  const left = Math.max(EDGE, Math.min(a.left, vp.width - size.width - EDGE));
  return { top: Math.max(EDGE, top), left, maxHeight: Math.max(room, 0) };
}
// Anchored, non-modal: opens under its anchor (above when there's no room), closes on a click outside, on
// Esc and on a second click of the anchor, and hands focus back to the anchor when it closed with focus inside.
export interface PopoverHandle { root: HTMLElement; close: () => void; isOpen: () => boolean }
let openPopover: PopoverHandle | null = null;
export function popover(anchor: HTMLElement, content: Kids, { label, width, onClose, role = "dialog" }: { label: string; width?: number | undefined; onClose?: (() => void) | undefined; role?: "dialog" | "menu" | "listbox" } = { label: "" }): PopoverHandle {
  if (openPopover) { const was = openPopover.root.dataset.anchor === anchor.dataset.popAnchor; openPopover.close(); if (was) return openPopover; }
  anchor.dataset.popAnchor ||= nextId("pop");
  const root = box("div", { class: "pop", role, "aria-label": label, tabindex: "-1", "data-anchor": anchor.dataset.popAnchor, ...(width ? { style: `width:${width}px` } : {}) },
    box("div", { class: "pop-body" }, ...content));
  document.body.append(root);
  anchor.setAttribute("aria-expanded", "true");
  const place = (): void => {
    root.style.maxHeight = "";   // measure its natural height
    const p = popoverPlacement(anchor.getBoundingClientRect(), { width: root.offsetWidth, height: root.offsetHeight }, { width: innerWidth, height: innerHeight });
    root.style.left = `${p.left}px`; root.style.top = `${p.top}px`; root.style.maxHeight = `${p.maxHeight}px`;
  };
  place();
  const onDown = (e: Event): void => { if (!root.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); close(true); } };
  const onScroll = (e: Event): void => { if (!root.contains(e.target as Node)) place(); };
  let open = true;
  function close(returnFocus = false): void {
    if (!open) return;
    open = false;
    const hadFocus = root.contains(document.activeElement);
    document.removeEventListener("pointerdown", onDown, true);
    root.removeEventListener("keydown", onKey);
    anchor.removeEventListener("keydown", onKey);
    removeEventListener("resize", place);
    document.removeEventListener("scroll", onScroll, true);
    root.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (openPopover === handle) openPopover = null;
    if (hadFocus || returnFocus) anchor.focus();
    onClose?.();
  }
  document.addEventListener("pointerdown", onDown, true);
  root.addEventListener("keydown", onKey);
  anchor.addEventListener("keydown", onKey);
  addEventListener("resize", place);
  document.addEventListener("scroll", onScroll, true);
  const handle: PopoverHandle = { root, close: () => close(), isOpen: () => open };
  openPopover = handle;
  (focusables(root)[0] || root).focus();
  return handle;
}
export function closePopover(): void { openPopover?.close(); }

// ---------------------------------------------------------------- tooltip
// A small text tooltip on hover (after --delay-tooltip) and on keyboard focus, described-by the anchor.
export function tooltip(anchor: HTMLElement, text: string): HTMLElement {
  const tip = el("div", { class: "tip", role: "tooltip", id: nextId("tip") }, text);
  let timer = 0;
  anchor.setAttribute("aria-describedby", [anchor.getAttribute("aria-describedby"), tip.id].filter(Boolean).join(" "));
  const show = (delay: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!anchor.isConnected) return;
      document.body.append(tip);
      const a = anchor.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const top = a.top - h - 6 > 8 ? a.top - h - 6 : a.bottom + 6;
      tip.style.left = `${Math.max(8, Math.min(a.left + a.width / 2 - w / 2, innerWidth - w - 8))}px`;
      tip.style.top = `${top}px`;
    }, delay) as unknown as number;
  };
  const hide = (): void => { clearTimeout(timer); tip.remove(); };
  anchor.addEventListener("mouseenter", () => show(400));
  anchor.addEventListener("focusin", () => show(0));
  anchor.addEventListener("mouseleave", hide);
  anchor.addEventListener("focusout", hide);
  anchor.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  return anchor;
}
// A disabled control fires no pointer events, so its reason hangs off a wrapper span instead.
export function tipWrap(control: HTMLElement, text: string): HTMLSpanElement {
  const w = box("span", { class: "tipwrap", tabindex: "0" }, control);
  tooltip(w, text);
  return w;
}

// ---------------------------------------------------------------- drawer
// A right-side modal drawer over a scrim: focus trapped inside, Esc and the scrim close it, focus returns to
// whatever opened it. Closed, the whole thing is hidden and inert, so nothing of it (not its shadow either)
// reaches the page. createDrawer() builds the markup; bindDrawer() adds the behaviour to markup that is
// already in index.html (same structure).
export interface DrawerHandle { root: HTMLElement; panel: HTMLElement; body: HTMLElement; open: (opener?: HTMLElement | null) => void; close: () => void; isOpen: () => boolean }
export function createDrawer({ id, title, subtitle, wide = false, body = [], footer = [] }: { id: string; title: string; subtitle?: string; wide?: boolean; body?: Kids; footer?: HTMLElement[] }): DrawerHandle {
  const titleId = `${id}-title`;
  const panel = box("aside", { class: `drawer${wide ? " drawer-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    box("header", { class: "overlay-head" },
      box("span", { class: "overlay-titles" }, el("h2", { id: titleId }, title), subtitle != null ? txt(subtitle, "t-sm muted overlay-sub") : null),
      el("span", { class: "spacer" }),
      button({ label: `Close ${title}`, icon: "close", iconOnly: true, variant: "ghost", attrs: { "data-drawer-close": "" } })),
    box("div", { class: "drawer-body" }, ...body),
    footer.length ? box("footer", { class: "overlay-foot" }, ...footer) : null);
  const root = box("div", { class: "drawer-root", id, hidden: "", inert: "" }, el("div", { class: "scrim", "data-drawer-close": "" }), panel);
  document.body.append(root);
  return bindDrawer(root);
}
export function bindDrawer(root: HTMLElement): DrawerHandle {
  const panel = root.querySelector<HTMLElement>(".drawer")!;
  const body = root.querySelector<HTMLElement>(".drawer-body") || panel;
  let opener: HTMLElement | null = null;
  const isOpen = (): boolean => !root.hidden;
  function open(from: HTMLElement | null = document.activeElement as HTMLElement | null): void {
    if (isOpen()) return;
    closePopover();
    opener = from;
    root.hidden = false; root.inert = false;
    setBackgroundInert(true);
    requestAnimationFrame(() => root.classList.add("open"));
    const first = panel.querySelector<HTMLElement>("[autofocus]") || focusables(body)[0] || focusables(panel)[0];
    first?.focus();
  }
  function close(): void {
    if (!isOpen()) return;
    root.classList.remove("open");
    root.hidden = true; root.inert = true;
    setBackgroundInert(false);
    if (opener?.isConnected) opener.focus();
    opener = null;
    root.dispatchEvent(new CustomEvent("drawerclose"));
  }
  root.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-drawer-close]")) close(); });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } else trapTab(panel, e); });
  return { root, panel, body, open, close, isOpen };
}

// ---------------------------------------------------------------- dialog, confirmDialog
// A modal dialog is up (the wizard, a confirmation): page-wide shortcuts and drops must leave it alone, or
// they open a drawer underneath it and break its Esc and focus.
export const modalOpen = (): boolean => !!document.querySelector("dialog[open]");
// A centred modal on the native <dialog> (showModal makes everything behind it inert and keeps focus in).
// Built fresh per call and removed once closed.
export interface DialogOptions { title: string; body?: Kids; actions?: HTMLElement[]; role?: "dialog" | "alertdialog"; width?: "sm" | "md"; cls?: string; describedBy?: string | undefined; initialFocus?: HTMLElement | null; onCancel?: () => void }
export function openDialog(o: DialogOptions): { dialog: HTMLDialogElement; close: () => void } {
  const titleId = nextId("dlg");
  const dialog = el("dialog", { class: `dialog dialog-${o.width || "sm"}${o.cls ? " " + o.cls : ""}`, role: o.role || "dialog", "aria-labelledby": titleId, ...(o.describedBy ? { "aria-describedby": o.describedBy } : {}) },
    box("div", { class: "dialog-body" }, el("h2", { id: titleId, class: "t-lg" }, o.title), ...(o.body || [])),
    o.actions?.length ? box("div", { class: "dialog-foot" }, ...o.actions) : null);
  const opener = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    dialog.close(); dialog.remove();
    if (opener?.isConnected) opener.focus();
  };
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); o.onCancel?.(); close(); });   // Esc
  document.body.append(dialog);
  dialog.showModal();
  (o.initialFocus || focusables(dialog)[0])?.focus();
  return { dialog, close };
}
// The page's one confirmation: title names the object, body states the consequence, Cancel is focused, the
// confirming button says what happens ("Forget Dorran") and is drawn in danger for a destructive action.
// Resolves true only for the confirming button; Cancel, Esc and closing resolve false.
export function confirmDialog({ title, body, confirmLabel, cancelLabel = "Cancel", danger = true }: { title: string; body: string; confirmLabel: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const bodyId = nextId("dlg-d");
    let d: { close: () => void } | null = null;
    const done = (v: boolean): void => { d?.close(); resolve(v); };
    const cancel = button({ label: cancelLabel, onClick: () => done(false), attrs: { "data-cancel": "" } });
    const ok = button({ label: confirmLabel, variant: danger ? "danger" : "primary", onClick: () => done(true), attrs: { "data-confirm": "" } });
    d = openDialog({ title, role: danger ? "alertdialog" : "dialog", describedBy: bodyId, body: [el("p", { id: bodyId, class: "muted" }, txt(body))], actions: [cancel, ok], initialFocus: cancel, onCancel: () => resolve(false) });
  });
}

// ---------------------------------------------------------------- toasts
// The outcome of something the user just did. Bottom-right, newest at the bottom, at most three; success and
// info leave after 6 s, errors stay until dismissed. Cleared on page change (clearToasts).
export type ToastTone = "ok" | "info" | "bad";
const TOAST_ICON: Record<ToastTone, IconName> = { ok: "check", info: "info", bad: "alert" };
const MAX_TOASTS = 3;
function toastStack(): HTMLElement {
  let s = document.getElementById("toasts");
  if (!s) { s = box("div", { id: "toasts", class: "toasts", "aria-live": "polite" }); document.body.append(s); }
  return s;
}
export function showToast(text: string, tone: ToastTone = "info", { action }: { action?: { label: string; onClick: () => void } } = {}): HTMLElement {
  const stack = toastStack();
  const t: HTMLDivElement = box("div", { class: `toast ${tone}`, role: tone === "bad" ? "alert" : "status" },
    icon(TOAST_ICON[tone], { cls: `ic-${tone}` }), txt(text, "toast-text"),
    action ? button({ label: action.label, variant: "ghost", size: "sm", cls: "act", onClick: action.onClick }) : null,
    button({ label: "Dismiss", icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: (): void => t.remove() }));
  stack.append(t);
  while (stack.children.length > MAX_TOASTS) stack.firstElementChild!.remove();
  if (tone !== "bad") {
    const timer = setTimeout(() => t.remove(), 6000);
    (timer as unknown as { unref?: () => void }).unref?.();   // Node (the unit tests) only: don't hold the process open
  }
  return t;
}
export function clearToasts(): void { document.getElementById("toasts")?.replaceChildren(); }

// ---- characters
// An action menu ("⋯") on the popover: role=menu, menuitem buttons, ↑/↓/Home/End move between the items
// (roving tabindex), Enter or a click runs one and closes the menu, Esc closes it and focus goes back to the
// anchor. A danger item is drawn in danger colour; "divider" draws a rule between groups. Each item's
// `count` span is returned so a number that arrives later (saved runs) can be filled in. An item may lead
// with an icon; a disabled item stays in the list (aria-disabled) and carries its reason as a title.
export interface MenuItem { label: string; onSelect: () => void; danger?: boolean | undefined; kbd?: string | undefined; count?: string | number | undefined; icon?: IconName | undefined; disabled?: string | null | undefined }
export function menu(anchor: HTMLElement, items: Array<MenuItem | "divider">, { label, width = 220 }: { label: string; width?: number }): PopoverHandle & { counts: Map<string, HTMLSpanElement> } {
  const counts = new Map<string, HTMLSpanElement>();
  const buttons: HTMLButtonElement[] = [];
  let handle: PopoverHandle | null = null;
  const kids = items.map((it) => {
    if (it === "divider") return el("div", { class: "divider", role: "separator" });
    const count = txt(it.count ?? "", "count");
    counts.set(it.label, count);
    const b = box("button", { type: "button", class: `menu-item${it.danger ? " danger" : ""}`, role: "menuitem", tabindex: buttons.length ? "-1" : "0",
      ...(it.disabled ? { "aria-disabled": "true", title: it.disabled } : {}),
      onclick: () => { if (it.disabled) return; handle?.close(); it.onSelect(); } }, it.icon ? icon(it.icon, { size: "sm" }) : null, txt(it.label), it.kbd ? kbd(it.kbd) : count);
    buttons.push(b);
    return b;
  });
  handle = popover(anchor, kids, { label, width, role: "menu" });
  handle.root.classList.add("pop-menu");
  handle.root.addEventListener("keydown", (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowDown" ? (i + 1) % buttons.length : e.key === "ArrowUp" ? (i - 1 + buttons.length) % buttons.length : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    buttons.forEach((b, j) => { b.tabIndex = j === to ? 0 : -1; });
    buttons[to]!.focus();
  });
  return Object.assign(handle, { counts });
}

// ---- builder
// Copy text (a serial) to the clipboard; resolves whether it worked. The Clipboard API first. The desktop
// app's session denies every permission (electron/main.mts), clipboard writes included, so there the copy
// goes through a selected off-screen textarea and execCommand("copy"), which the click's user activation
// allows without a permission. Focus goes back where it was.
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* denied or absent: the fallback below */ }
  const back = document.activeElement as HTMLElement | null;
  const ta = el("textarea", { class: "sr", readonly: "", "aria-hidden": "true", tabindex: "-1" });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  back?.focus?.();
  return ok;
}
