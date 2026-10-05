// ui/dom.mts — DOM helpers, formatting/label helpers, rarity, and the in-game style hover tooltip.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
import { SLOT_LABELS, labelOf, fullOf, tagInfo, gameName } from "../vault-lib.mts";
import type { Item } from "../vault-lib.mts";
import { EXTRA_COLS, rarityRank as rarityRankOf } from "../item-query.mts";
import { state } from "./store.mts";
import { rarityToken } from "./items.mts";
import { api } from "./api.mts";
import type { ItemsBySerialApiResponse } from "./api-types.mts";
import { showToast, tag, tooltip } from "./components.mts";
import { createTipResolver, type TooltipItem } from "./item-tip.mts";

export { EXTRA_COLS, colVal } from "../item-query.mts";
export type { TooltipItem } from "./item-tip.mts";

// $(selector[, root]) — every id/class this page looks up is one app/index.html itself defines, so
// callers use `$(...)!` at the call site (this page's own house style, per the migration plan's DOM-
// types guidance) rather than this function silently widening its own return type. The generic lets
// a caller ask for the specific element subtype it's about to read (`$<HTMLInputElement>("#f-text")`)
// instead of casting after the fact.
export const $ = <E extends Element = Element>(s: string, el: ParentNode = document): E | null => el.querySelector<E>(s);

// el(tag, attrs, ...kids) — the page's one DOM-node builder. `attrs` is one bag for both plain
// attributes and event listeners; which a given entry is comes from its KEY (an "on"-prefixed key is
// always a listener), never its declared type, so every branch below casts `v` to the type its
// target actually wants — compiler-only casts, not new runtime coercions (setAttribute's own DOM
// binding already stringifies whatever's passed via ToString, exactly as before: passing a number or
// null through it already produced "6"/"null", per this file's own rarity/tag-chip callers elsewhere
// in this page, which rely on exactly that coercion).
// `boolean` covers aria-* attributes (e.g. "aria-pressed": cols.includes(k)) — setAttribute's
// ToString coercion turns `true`/`false` into the literal strings "true"/"false", which is exactly
// the value an aria attribute wants.
export type ElAttrValue = string | number | boolean | null | undefined;
export type ElEventHandler = (e: any) => unknown;   // any: this bag hands the value straight to addEventListener; every caller in this codebase reads event-target-specific fields (e.target.value, .checked, .dataset) with no narrowing anywhere, and the target is always the element the same call just created, so a real Event type would force a cast at every one of this page's ~60 listener call sites for no safety actually gained
export type ElAttrs = Record<string, ElAttrValue | ElEventHandler>;
export type ElChild = Node | string | number | boolean | null | undefined;
// There is deliberately no `html:` key any more: it set innerHTML, and its only two call sites (the
// Characters tab and the Suit Builder's result panel, both passing the character sheet) were what
// carried scan-supplied markup into the page. Both build nodes now, and nothing in this codebase
// assigns innerHTML at all (Phase 7 security review, Area 2, Important 1).
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: ElAttrs = {}, ...kids: Array<ElChild | ElChild[]>): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v as string; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v as ElEventHandler); else e.setAttribute(k, v as string); }
  // (kid as Node).nodeType: the same duck-typing the pre-migration code did with no type at all — a
  // string/number/boolean kid has no `.nodeType` property and reads undefined (falsy) here exactly as
  // it always has; the cast only satisfies the checker, it changes nothing this line actually does.
  for (const kid of kids.flat()) if (kid != null) e.append((kid as Node).nodeType ? (kid as Node) : document.createTextNode(String(kid)));
  return e;
};
// compactChildren(kids) — drop null/undefined entries from a children array before it reaches
// replaceChildren()/append()/etc: those methods' real (Node | string) signature has no null member, so
// a literal null argument WebIDL-coerces to the text node "null" rather than being skipped (unlike a
// null nested inside an el() call's own kids, which el() above explicitly filters via its `kid != null`
// check). Generic and DOM-free (no `document` touch) so it's importable and testable under plain
// node:test without a browser DOM — see app/import-children.test.mts. Callers build a plain array of
// "always-present panel, maybe-null panel" and filter once, matching builder.mts's renderResult
// (`.filter(Boolean) as HTMLElement[]`) and runs.mts's renderRuns (filters a mapped array); import.mts's
// renderImport is the one call site that used to skip the filter and pass a bare null straight through.
export function compactChildren<T>(kids: readonly (T | null | undefined)[]): T[] {
  return kids.filter((k): k is T => k != null);
}
// noteEl(text) — one quiet line, or nothing at all for a null. The sentences in ui/messages.mts are
// deliberately optional (pathsFileNote says nothing about the ordinary outcomes), and every panel
// that shows one would otherwise repeat the same call-it-twice ternary to avoid rendering a blank
// row. Returns null, which is what compactChildren/el()'s own kid filter already handle.
export const noteEl = (text: string | null): HTMLDivElement | null => text ? el("div", { class: "small muted" }, text) : null;
export const fmtWhen = (s: string | null | undefined): string => s ? String(s).replace("T", " ").slice(0, 16) : "";
// A location as the page shows it: inside a container labelled for Organize (issue #11) the path reads by the
// label (store.mts's organize.places, built by organize-model.mts's labelledPlaces); any other text as it is.
export const whereText = (text: string | null | undefined): string => (text ? state.organize.places.get(text) ?? text : "");
export const ago = (s: string): string => { const d = (Date.now() - Date.parse(s)) / 864e5; return !isFinite(d) ? "" : d < 1 / 24 ? "just now" : d < 1 ? `${Math.round(d * 24)}h ago` : d < 30 ? `${Math.round(d)}d ago` : fmtWhen(s).slice(0, 10); };
// stale = last seen more than 7 days before the newest scan we have at all
// The return type is whatever `state.newestScan && …` naturally produces (its own left-hand type
// falls through when falsy, same as before this had a signature) — every caller only ever uses this
// in a truthy check, so its exact non-boolean falsy value has never mattered.
export const isStale = (it: Item): string | null | undefined | boolean => state.newestScan && Date.parse(state.newestScan) - Date.parse(it.seenAt) > 7 * 864e5;
export const label = (k: string): string => EXTRA_COLS[k]?.[0] || labelOf(k);
export const full = (k: string): string => EXTRA_COLS[k]?.[1] || fullOf(k);
export const slotLabel = (s: string | null | undefined): string => SLOT_LABELS[s as string] || s || "?";
// The rarity ladder (name, ascending, + the client's own tier colour read from the <BASEFONT COLOR>
// tags in scanned tooltips) is shard data now (state.rules.rarity, from GET /api/rules) rather than
// a hardcoded table — a shard with a different tier scheme ships its own app/rules/<shard>.json.
export const rarityRank = (name: string | null | undefined): number => rarityRankOf(state.rules?.rarity || [], name);
// A tier's colour for the page: its --rarity-* token (items.mts's rarityToken) when the tier has one,
// else the shard's raw game colour, which only reads well inside a dark subtree (see rarCell).
export const rarityColor = (name: string | null | undefined): string | null => {
  const token = rarityToken(name);
  if (token) return `var(${token})`;
  const r = (state.rules?.rarity || []).find((r) => r.name.toLowerCase() === String(name || "").toLowerCase());
  return r ? safeColor(r.colour) : null;
};
export const rarRank = (it: Item): number => rarityRank(it.rarity);
export const rarCell = (it: Item): HTMLElement => {
  if (!it.rarity) return el("span", { class: "muted" }, "·");
  if (rarityToken(it.rarity)) return el("span", { class: "rar-name", style: `color:${rarityColor(it.rarity)}` }, it.rarity);
  const raw = rarityColor(it.rarity);
  return el("span", { class: "rar-name rar-raw", "data-theme": "default", "data-mode": "dark", style: raw ? `color:${raw}` : "" }, it.rarity);
};
// safeColor(c) — a colour that is safe to put in a style property, or null. The one dynamic colour
// the page takes from a scan is the <BASEFONT COLOR=#rrggbb> tag the client writes into a tooltip
// line's own text; it reaches a `style` through tipNode below. That capture is already regex-bound,
// so this is belt and braces — but a sink that can only ever be handed a validated colour is a sink
// that stays safe when the next caller isn't so careful (Phase 7 security review, Area 2, Note 3).
// There is no HTML-escaping helper here any more: nothing in the page builds markup as a string.
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const safeColor = (c: string | null | undefined): string | null => (typeof c === "string" && COLOR_RE.test(c) ? c : null);

export const fmtN = (x: number | string | null | undefined): string => (+(x as string) || 0).toLocaleString();
export const fmtSecs = (ms: number): string => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
export function fmtRunTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d as unknown as number)) return "?";
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

// toast(text, cls) — the page's long-standing call, now the toast stack in components.mts (bottom-right, up to
// three, errors stay until dismissed). cls keeps its old meaning: "" is information, "good" a success, "bad"
// an error. (components.mts imports el() from here; the cycle is safe because neither module calls into the
// other while it is still loading.)
export function toast(text: string, cls = ""): void {
  showToast(text, cls === "bad" ? "bad" : cls === "good" ? "ok" : "info");
}

// ---------------------------------------------------------------- in-game style tooltip

interface TooltipLine {
  text: string;
  color: string | null;
}
function tipLine(raw: string): TooltipLine {
  let color: string | null = null;
  const text = String(raw).replace(/<basefont[^>]*color=["']?(#[0-9a-f]{6})["']?[^>]*>/gi, (_, c: string) => { color = c; return ""; }).replace(/<[^>]+>/g, "").trim();
  return { text, color };
}
const RARITY_LINE = /^(minor|lesser|greater|major|legendary) (magic item|artifact)$/i;
const RESIST_LINE = /^(physical|fire|cold|poison|energy) resist\b/i;
const RES_CLASS: Record<string, string> = { physical: "phys", fire: "fire", cold: "cold", poison: "poison", energy: "energy" };
const TAG_TONE: Record<string, "bad" | "warn" | undefined> = { cursed: "bad", brittle: "warn", antique: "warn", massive: "warn", unwieldy: "warn" };
// An item tag ("cursed") as its chip, in its tone. `describe` gives it the shard's plain-words meaning
// (the rules' tagInfo) as a tooltip on hover and focus; a shard with no meaning for it gets a plain chip.
export function tagChip(t: string, { describe = false }: { describe?: boolean } = {}): HTMLSpanElement {
  const chip = tag(t.charAt(0).toUpperCase() + t.slice(1), TAG_TONE[t.toLowerCase()]);
  const info = describe ? tagInfo(t) : null;
  if (info) { chip.tabIndex = 0; chip.classList.add("tag-info"); tooltip(chip, info); }
  return chip;
}
// tipNode(it) — the item tooltip (design spec 4.3), built as DOM nodes: the name in its rarity colour and
// the item's tags; its tooltip lines in the game's order, resist lines in their element's colour and
// durability and requirements muted; a footer with the rarity tier and where the item is. Every value
// in here comes off a scan file's own tooltip lines, so nothing is ever markup, and the one colour a
// line may carry (its <BASEFONT COLOR>) reaches a style only through safeColor. Module-scope so it is
// importable on its own — see app/ui-render.test.mts.
export function tipNode(it: TooltipItem): HTMLDivElement {
  const lines = (it.lines || []).slice(1).map(tipLine).filter((l) => l.text);
  const tags = new Set((it.tags || []).map((t) => t.toLowerCase()));
  let tier = it.rarity || null;
  const body: HTMLElement[] = [];
  for (const l of lines) {
    if (RARITY_LINE.test(l.text)) { tier ||= l.text; continue; }
    if (tags.has(l.text.toLowerCase())) continue;
    const res = l.text.match(RESIST_LINE);
    const muted = /^durability\s+\d|requirement|required/i.test(l.text);
    const color = res ? null : safeColor(l.color);
    body.push(el("span", { class: res ? `t-res t-res-${RES_CLASS[res[1]!.toLowerCase()]}` : muted ? "muted" : "", ...(color ? { style: `color:${color}` } : {}) }, l.text));
  }
  const tierColor = tier ? rarityColor(tier) : null;
  const qty = (it.amount || 1) > 1 ? `${it.amount} ` : "";
  const tagEls = [...tags].map((t) => tagChip(t));
  // The tier and where the item is, each on a line of its own: a location is often long, and sharing a line
  // with the tier cut it off.
  const foot = [tier ? el("span", tierColor ? { style: `color:${tierColor}` } : {}, tier) : null, it.location ? el("span", { class: "muted tip-where" }, whereText(it.location.text)) : null].filter((x): x is HTMLSpanElement => !!x);
  return el("div", { class: "tipcard" },
    el("div", { class: "tip-head" }, el("span", { class: "strong tip-name", ...(tierColor ? { style: `color:${tierColor}` } : {}) }, qty + it.name), ...tagEls),
    // The name the game uses, when the shown one differs (a Scroll of Transcendence's names its skill, issue #181).
    gameName(it) !== it.name ? el("div", { class: "muted tip-game" }, `In game: ${gameName(it)}`) : null,
    body.length ? el("div", { class: "divider" }) : null,
    body.length ? el("div", { class: "tip-lines" }, ...body) : null,
    foot.length ? el("div", { class: "divider" }) : null,
    foot.length ? el("div", { class: "tip-foot t-sm" }, ...foot) : null);
}

// The one item tooltip (#tip, always a dark subtree): shown 400 ms after the pointer settles on anything carrying
// data-serial, or after an item has had keyboard focus for 400 ms (showItemTip). It hides on leave, on Esc, when the
// item leaves the page, and on a scroll that moves it from under the pointer (a keyboard tooltip follows its item
// instead: focusing a row scrolls it into view). pointer-events: none, so it never takes the pointer. A region inside a host marked data-no-tip (a row's
// action buttons) counts as off the item, and an item whose own pop or menu is open (aria-expanded) shows none.
// Inside an open modal dialog (the top layer) it moves into the dialog, so it is drawn above it.
const TIP_DELAY = 400;
// The lookup calls the API itself rather than resolveItems, which swallows a failed request: a network error must
// reach the resolver, so it is not taken for an unknown serial.
const tips = createTipResolver(state.itemCache, async (serial) => {
  const it = (await api<ItemsBySerialApiResponse>(`/api/items/by-serial?serials=${serial}`)).items?.[serial];
  if (it) state.itemCache.set(serial, it);
  return it;
});
// itemTip(node, item): `node` shows the item's tooltip on hover and, unless `focus` is false, after 400 ms of keyboard
// focus (it is made focusable if it is not). Every screen that draws an item wires it through here: the record it
// drew is shown as it is when it carries its tooltip lines, else the item is looked up by serial once (item-tip.mts).
export function itemTip<T extends HTMLElement>(node: T, item: TooltipItem & { serial: number }, { focus = true }: { focus?: boolean } = {}): T {
  node.dataset.serial = String(item.serial);
  tips.register(node, item);
  if (focus) {
    if (node.tabIndex < 0) node.tabIndex = 0;
    node.addEventListener("focus", () => { if (node.matches(":focus-visible")) showItemTip(item.serial, node); });
    node.addEventListener("blur", () => hideItemTip());
  }
  return node;
}
// A new inventory: a serial no lookup found before may be found now.
export const forgetTipMisses = (): void => tips.forget();
// tipAnchor is the focused item a keyboard tooltip belongs to (set as soon as focus asks for one, so a stray pointer
// event while it waits cannot cancel it); null for a pointer tooltip. tipHost is the item either one is for.
let tipTimer = 0, tipSerial: number | null = null, tipAnchor: HTMLElement | null = null, tipHost: HTMLElement | null = null;
let tipGone: MutationObserver | null = null;
// Held here, not looked up: while it is drawn inside a dialog, removing the dialog would otherwise take it along.
let tipBox: HTMLElement | null = null;
function tipEl(): HTMLElement { return (tipBox ??= $<HTMLElement>("#tip")!); }
function placeAt(x: number, y: number): void {
  const tip = tipEl(), pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + pad, top = y + pad;
  if (left + w > innerWidth - 8) left = x - w - pad;
  if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
  tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${top}px`;
}
const placeBy = (anchor: HTMLElement): void => { const r = anchor.getBoundingClientRect(); placeAt(r.left + 240, r.top - 6); };
// The tooltip is for `host` now: watch for it leaving the page.
function arm(host: HTMLElement, serial: number): void {
  tipSerial = serial;
  tipHost = host;
  tipGone ??= new MutationObserver(() => { if (tipHost && !tipHost.isConnected) hideItemTip(); });
  tipGone.observe(document.body, { childList: true, subtree: true });
}
// Resolve the host's record and show it, unless the pointer or focus has moved on by the time it resolves.
function showSerial(host: HTMLElement, serial: number, place: () => void): void {
  const paint = (it: TooltipItem | null): void => {
    if (!it || tipSerial !== serial || tipHost !== host || !host.isConnected) return;
    const tip = tipEl(), layer = host.closest("dialog[open]") ?? document.body;
    if (tip.parentElement !== layer) layer.append(tip);
    tip.replaceChildren(tipNode(it));
    tip.style.display = "block";
    place();
  };
  const now = tips.resolve(host, serial);
  if (now instanceof Promise) void now.then(paint); else paint(now);
}
export function hideItemTip(): void {
  clearTimeout(tipTimer);
  tipSerial = null;
  tipHost = null;
  tipGone?.disconnect();
  const tip = tipEl();
  tip.style.display = "none";
  if (tip.parentElement !== document.body) document.body.append(tip);   // back from a dialog
  if (tipAnchor) { tipAnchor.removeAttribute("aria-describedby"); tipAnchor = null; }
}
const popOpen = (host: HTMLElement): boolean => host.getAttribute("aria-expanded") === "true";
// The tooltip for a keyboard-focused item: after 400 ms, beside it.
export function showItemTip(serial: number, anchor: HTMLElement): void {
  hideItemTip();
  if (popOpen(anchor)) return;
  arm(anchor, serial);
  tipAnchor = anchor;
  tipTimer = setTimeout(() => {
    if (!anchor.isConnected || document.activeElement !== anchor) return;
    anchor.setAttribute("aria-describedby", "tip");
    showSerial(anchor, serial, () => placeBy(anchor));
  }, TIP_DELAY) as unknown as number;
}
// The data-serial host whose tooltip the pointer over `target` asks for, or null.
export function tipHostOf(target: Element | null): HTMLElement | null {
  const t = target?.closest?.("[data-no-tip], [data-serial]") as HTMLElement | null | undefined;
  return t?.hasAttribute("data-serial") ? t : null;
}
export function installTooltip(): void {
  let lastX = 0, lastY = 0, pointerSeen = false;
  // The item under the pointer now (a scroll can move another one under a still pointer), or `fallback` before any
  // pointer move has told us where the pointer is.
  const underPointer = (fallback: HTMLElement | null): HTMLElement | null => (pointerSeen ? tipHostOf(document.elementFromPoint(lastX, lastY)) : fallback);
  // Wait 400 ms on `host`, then show whatever item is under the pointer by then: the tooltip always describes it.
  const pointTo = (host: HTMLElement): void => {
    hideItemTip();
    arm(host, +host.dataset.serial!);
    tipTimer = setTimeout(() => {
      const now = underPointer(host);
      if (!now || popOpen(now)) { hideItemTip(); return; }
      if (now !== tipHost) arm(now, +now.dataset.serial!);
      showSerial(now, tipSerial!, () => placeAt(lastX, lastY));
    }, TIP_DELAY) as unknown as number;
  };
  document.addEventListener("mouseover", (e) => {
    const host = tipHostOf(e.target as Element);
    if (!host || popOpen(host)) { if (tipSerial != null && !tipAnchor) hideItemTip(); return; }
    if (+host.dataset.serial! === tipSerial && (host === tipHost || tipAnchor)) return;
    pointTo(host);
  });
  document.addEventListener("mousemove", (e) => { lastX = e.clientX; lastY = e.clientY; pointerSeen = true; if (tipEl().style.display === "block" && !tipAnchor) placeAt(lastX, lastY); });
  document.addEventListener("mouseout", (e) => { if (!tipAnchor && !tipHostOf(e.relatedTarget as Element | null)) hideItemTip(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideItemTip(); }, true);
  // A scroll changes a pointer tooltip only when it moved another item (or none) under the pointer: then it hides, and
  // the item now there gets its own 400 ms. A hover that first scrolls its row into view fires that scroll after the
  // pointer is already on the row, and it must not cancel it. A keyboard tooltip follows its item.
  document.addEventListener("scroll", () => {
    if (tipSerial == null) return;
    if (tipAnchor) { if (tipEl().style.display === "block") placeBy(tipAnchor); return; }
    const now = underPointer(tipHost);
    if (now === tipHost) return;
    if (now && !popOpen(now)) pointTo(now); else hideItemTip();
  }, { capture: true, passive: true });
}
