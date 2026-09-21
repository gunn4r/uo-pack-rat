// ui/dom.mts — DOM helpers, formatting/label helpers, rarity, and the in-game style hover tooltip.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
import { SLOT_LABELS, labelOf, fullOf } from "../vault-lib.mts";
import type { Item } from "../vault-lib.mts";
import { EXTRA_COLS, rarityRank as rarityRankOf } from "../item-query.mts";
import { state } from "./store.mts";
import { resolveItems } from "./items.mts";

export { EXTRA_COLS, colVal } from "../item-query.mts";

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
// `boolean` covers aria-* attributes (e.g. "aria-pressed": state.cols.includes(k)) — setAttribute's
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
export const fmtWhen = (s: string | null | undefined): string => s ? String(s).replace("T", " ").slice(0, 16) : "";
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
export const rarityColor = (name: string | null | undefined): string | null => { const r = (state.rules?.rarity || []).find((r) => r.name.toLowerCase() === String(name || "").toLowerCase()); return r ? r.colour : null; };
export const rarRank = (it: Item): number => rarityRank(it.rarity);
export const rarCell = (it: Item): HTMLElement => it.rarity ? el("span", { style: `color:${rarityColor(it.rarity) || "inherit"};font-weight:500` }, it.rarity) : el("span", { class: "muted" }, "·");
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

// `number`, not `ReturnType<typeof setTimeout>`: this file only ever runs in the browser, where
// setTimeout returns a number, but `ReturnType<typeof setTimeout>` is ambiguous once a program also
// has Node's ambient globals in scope (tsconfig.json's root config, which type-checks this file too,
// alongside tsconfig.browser.json's browser-only one) — the two configs disagree on which overload
// `typeof setTimeout` even means, so naming the type directly is what stays correct under both.
let toastTimer: number | null = null;
export function toast(text: string, cls = ""): void {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = el("div", { class: "toast " + cls }, text); document.body.append(t);
  // clearTimeout accepts (and no-ops on) null at runtime exactly like undefined — lib.dom.d.ts's own
  // signature just doesn't say so; setTimeout's own return value goes through `unknown` for the same
  // cross-config reason as the type annotation above (a direct `as number` fails under whichever
  // config resolves it to Node's Timeout, since neither type "sufficiently overlaps" the other) —
  // both casts are compiler-only, this file's actual runtime is always the browser's setTimeout.
  clearTimeout(toastTimer as number | undefined); toastTimer = setTimeout(() => t.remove(), 6000) as unknown as number;
}

// ---------------------------------------------------------------- in-game style tooltip

// A hover tooltip's item shape is looser than vault-lib.mts's Item: it also renders the itemCache's
// full records AND suit-builder candidates resolveItems() returns, which only ever carry {lines,
// name, amount, rarity, location?} — declared locally because tipNode() reads exactly these fields
// and nothing else, and a candidate that isn't a full Item still renders a tooltip today.
export interface TooltipItem {
  lines?: string[] | undefined;
  name: string;
  amount?: number | undefined;
  rarity?: string | null | undefined;
  location?: { text: string } | undefined;
}
interface TooltipLine {
  text: string;
  color: string | null;
  bold: boolean;
  italic: boolean;
}
const HOT_PROPS = /swing speed increase|defense chance increase|hit chance increase|faster casting|faster cast recovery|lower reagent cost|lower mana cost|spell damage increase/i;
function tipLine(raw: string): TooltipLine {
  let color: string | null = null, bold = false, italic = false;
  let text = String(raw).replace(/<basefont[^>]*color=["']?(#[0-9a-f]{6})["']?[^>]*>/gi, (_, c: string) => { color = c; return ""; }).replace(/<\/?b>/gi, () => { bold = true; return ""; }).replace(/<[^>]+>/g, "").trim();
  if (/^\(?(imbued|exceptional|insured|blessed)\)?$/i.test(text)) { italic = true; text = text.replace(/[()]/g, ""); }
  return { text, color, bold, italic };
}
// tipNode(it) — the hover tooltip, built as DOM nodes. Every value in here comes off a scan file's
// own tooltip lines, and this used to be the page's other raw-string builder: its local escaper
// covered only & < >, which is correct for a text position and one careless edit away from not being
// correct for an attribute. Module-scope (not a closure inside installTooltip) so it is importable
// on its own — see app/ui-render.test.mts. Phase 7 security review, Area 2, Note 3.
export function tipNode(it: TooltipItem): HTMLDivElement {
  const lines = (it.lines || []).slice(1).map(tipLine);
  const keyed = (key: string, value: string): HTMLDivElement => el("div", {}, el("span", { class: "t-key" }, key), " " + value);
  const head: TooltipLine[] = [], info: HTMLDivElement[] = [], body: HTMLDivElement[] = [];
  let rarity: TooltipLine | null = null;
  for (const l of lines) {
    const t = l.text;
    let m;
    if (/^(minor|lesser|greater|major|legendary) (magic item|artifact)$/i.test(t)) { rarity = l; continue; }
    if (/^crafted by /i.test(t) || l.italic) { head.push(l); continue; }
    if ((m = t.match(/^weapon damage\s+(.+)$/i))) { info.push(keyed("Damage:", m[1]!)); continue; }
    if ((m = t.match(/^weapon speed\s+(.+)$/i))) { info.push(keyed("Speed:", m[1]!)); continue; }
    if ((m = t.match(/^weight:?\s+(\d+)/i))) { info.push(keyed("Weight:", m[1]!)); continue; }
    if ((m = t.match(/^durability\s+(\d+)\s*\/\s*(\d+)/i))) {
      const pct = Math.max(0, Math.min(100, 100 * +m[1]! / (+m[2]! || 1)));
      info.push(keyed("Durability:", `${m[1]} / ${m[2]}`), el("div", { class: "t-dur" }, el("div", { style: `width:${pct}%` })));
      continue;
    }
    if ((m = t.match(/^contents:?\s+(\d+)\/(\d+) items,?\s*(\d+) stones/i))) { info.push(keyed("Items:", `${m[1]}/${m[2]}`), keyed("Items Weight:", m[3]!)); continue; }
    if ((m = t.match(/^strength requirement\s+(\d+)/i))) { body.unshift(el("div", {}, `Required Strength: ${m[1]}`)); continue; }
    if ((m = t.match(/^(durability)\s+\+(\d+)%$/i))) { body.push(el("div", {}, el("span", { class: "t-val" }, `+${m[2]}%`), " Durability")); continue; }
    if ((m = t.match(/^(.*?)[\s:]+\+?(-?\d+(?:\.\d+)?)\s*(%?)$/)) && m[1] && !/^(weight|default)/i.test(m[1])) {
      const name = m[1].replace(/:$/, ""), cls = /leech/i.test(name) ? "t-leech" : HOT_PROPS.test(name) ? "t-hot" : "";
      body.push(el("div", {}, el("span", { class: "t-val" }, `${+m[2]! >= 0 ? "+" : ""}${m[2]}${m[3]}`), " ", el("span", { class: cls }, name)));
      continue;
    }
    const color = safeColor(l.color);
    body.push(el("div", { class: l.bold ? "t-b" : "", ...(color ? { style: `color:${color}` } : {}) }, t));
  }
  const headNodes = head.map((l) => {
    const color = safeColor(l.color);
    return el("div", { class: `t-center ${l.italic ? "t-i" : ""} ${l.bold ? "t-b" : ""}`, ...(color ? { style: `color:${color}` } : {}) }, l.text);
  });
  const rarNode = rarity ? el("div", { class: "t-center", style: `color:${safeColor(rarity.color) || "#e6c85a"}` }, rarity.text) : null;
  const qty = (it.amount || 1) > 1 ? `${it.amount} ` : "";
  return el("div", {},
    el("div", { class: "t-name" }, qty + it.name),
    rarNode, ...headNodes, ...info,
    body.length ? el("div", { class: "t-hr" }) : null, ...body,
    ...(it.location ? [el("div", { class: "t-hr" }), el("div", { class: "t-muted" }, it.location.text)] : []));
}
export function installTooltip(): void {
  const tip = $<HTMLElement>("#tip")!;
  function placeTip(e: MouseEvent): void {
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  // hoverSerial tracks which [data-serial] element the pointer is currently over — an async
  // resolveItems() lookup (state.itemCache misses a serial not seeded by a rendered inventory row,
  // e.g. a suit-builder candidate) must not paint a tooltip after the pointer has already moved on.
  let hoverSerial: number | null = null;
  document.addEventListener("mouseover", (e) => {
    const host = (e.target as Element).closest("[data-serial]") as HTMLElement | null;
    if (!host) { hoverSerial = null; tip.style.display = "none"; return; }
    const serial = +host.dataset.serial!;
    hoverSerial = serial;
    const cached = state.itemCache.get(serial);
    if (cached) { tip.replaceChildren(tipNode(cached)); tip.style.display = "block"; placeTip(e); return; }
    tip.style.display = "none";
    resolveItems([serial]).then((found) => {
      if (hoverSerial !== serial) return;   // the pointer moved on before this resolved
      const it = found[serial];
      if (!it) return;
      tip.replaceChildren(tipNode(it)); tip.style.display = "block"; placeTip(e);
    });
  });
  document.addEventListener("mousemove", (e) => { if (tip.style.display === "block") placeTip(e); });
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget || !(e.relatedTarget as Element).closest?.("[data-serial]")) { hoverSerial = null; tip.style.display = "none"; } });
}
