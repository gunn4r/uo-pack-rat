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
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: ElAttrs = {}, ...kids: Array<ElChild | ElChild[]>): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v as string; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v as ElEventHandler); else if (k === "html") e.innerHTML = v as string; else e.setAttribute(k, v as string); }
  // (kid as Node).nodeType: the same duck-typing the pre-migration code did with no type at all — a
  // string/number/boolean kid has no `.nodeType` property and reads undefined (falsy) here exactly as
  // it always has; the cast only satisfies the checker, it changes nothing this line actually does.
  for (const kid of kids.flat()) if (kid != null) e.append((kid as Node).nodeType ? (kid as Node) : document.createTextNode(String(kid)));
  return e;
};
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
// esc(t) — HTML-escape a value before interpolating it into an HTML STRING (sheetHtml and friends,
// which build markup with template literals rather than el()'s text nodes). Scan files are
// third-party adapter data (character names, skill names): a scan-supplied name landing in an HTML
// string unescaped is defacement (Phase 1's CSP already blocks script execution and exfiltration),
// but Phase 2 is precisely what makes scan files untrusted input, so anything built as a raw string
// must escape what it interpolates.
export const esc = (t: unknown): string => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] as string));

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
// name, amount, rarity, location?} — declared locally because tipHtml() reads exactly these fields
// and nothing else, and a candidate that isn't a full Item still renders a tooltip today.
interface TooltipItem {
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
export function installTooltip(): void {
  const tip = $<HTMLElement>("#tip")!;
  const HOT_PROPS = /swing speed increase|defense chance increase|hit chance increase|faster casting|faster cast recovery|lower reagent cost|lower mana cost|spell damage increase/i;
  function tipLine(raw: string): TooltipLine {
    let color: string | null = null, bold = false, italic = false;
    let text = String(raw).replace(/<basefont[^>]*color=["']?(#[0-9a-f]{6})["']?[^>]*>/gi, (_, c: string) => { color = c; return ""; }).replace(/<\/?b>/gi, () => { bold = true; return ""; }).replace(/<[^>]+>/g, "").trim();
    if (/^\(?(imbued|exceptional|insured|blessed)\)?$/i.test(text)) { italic = true; text = text.replace(/[()]/g, ""); }
    return { text, color, bold, italic };
  }
  function tipHtml(it: TooltipItem): string {
    const lines = (it.lines || []).slice(1).map(tipLine);
    const esc = (t: string): string => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const head: TooltipLine[] = [], info: string[] = [], body: string[] = [];
    let rarity: TooltipLine | null = null;
    for (const l of lines) {
      const t = l.text;
      let m;
      if (/^(minor|lesser|greater|major|legendary) (magic item|artifact)$/i.test(t)) { rarity = l; continue; }
      if (/^crafted by /i.test(t) || l.italic) { head.push(l); continue; }
      if ((m = t.match(/^weapon damage\s+(.+)$/i))) { info.push(`<div><span class="t-key">Damage:</span> ${esc(m[1]!)}</div>`); continue; }
      if ((m = t.match(/^weapon speed\s+(.+)$/i))) { info.push(`<div><span class="t-key">Speed:</span> ${esc(m[1]!)}</div>`); continue; }
      if ((m = t.match(/^weight:?\s+(\d+)/i))) { info.push(`<div><span class="t-key">Weight:</span> ${m[1]}</div>`); continue; }
      if ((m = t.match(/^durability\s+(\d+)\s*\/\s*(\d+)/i))) { const pct = Math.max(0, Math.min(100, 100 * +m[1]! / (+m[2]! || 1))); info.push(`<div><span class="t-key">Durability:</span> ${m[1]} / ${m[2]}</div><div class="t-dur"><div style="width:${pct}%"></div></div>`); continue; }
      if ((m = t.match(/^contents:?\s+(\d+)\/(\d+) items,?\s*(\d+) stones/i))) { info.push(`<div><span class="t-key">Items:</span> ${m[1]}/${m[2]}</div><div><span class="t-key">Items Weight:</span> ${m[3]}</div>`); continue; }
      if ((m = t.match(/^strength requirement\s+(\d+)/i))) { body.unshift(`<div>Required Strength: ${m[1]}</div>`); continue; }
      if ((m = t.match(/^(durability)\s+\+(\d+)%$/i))) { body.push(`<div><span class="t-val">+${m[2]}%</span> Durability</div>`); continue; }
      if ((m = t.match(/^(.*?)[\s:]+\+?(-?\d+(?:\.\d+)?)\s*(%?)$/)) && m[1] && !/^(weight|default)/i.test(m[1])) {
        const name = m[1].replace(/:$/, ""), cls = /leech/i.test(name) ? "t-leech" : HOT_PROPS.test(name) ? "t-hot" : "";
        body.push(`<div><span class="t-val">${+m[2]! >= 0 ? "+" : ""}${m[2]}${m[3]}</span> <span class="${cls}">${esc(name)}</span></div>`);
        continue;
      }
      const style = l.color ? ` style="color:${l.color}"` : "";
      body.push(`<div class="${l.bold ? "t-b" : ""}"${style}>${esc(t)}</div>`);
    }
    const headHtml = head.map((l) => `<div class="t-center ${l.italic ? "t-i" : ""} ${l.bold ? "t-b" : ""}"${l.color ? ` style="color:${l.color}"` : ""}>${esc(l.text)}</div>`).join("");
    const rarHtml = rarity ? `<div class="t-center" style="color:${rarity.color || "#e6c85a"}">${esc(rarity.text)}</div>` : "";
    const qty = (it.amount || 1) > 1 ? `${it.amount} ` : "";
    const loc = it.location ? `<div class="t-hr"></div><div class="t-muted">${esc(it.location.text)}</div>` : "";
    return `<div class="t-name">${qty}${esc(it.name)}</div>${rarHtml}${headHtml}${info.join("")}${body.length ? `<div class="t-hr"></div>${body.join("")}` : ""}${loc}`;
  }
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
    if (cached) { tip.innerHTML = tipHtml(cached); tip.style.display = "block"; placeTip(e); return; }
    tip.style.display = "none";
    resolveItems([serial]).then((found) => {
      if (hoverSerial !== serial) return;   // the pointer moved on before this resolved
      const it = found[serial];
      if (!it) return;
      tip.innerHTML = tipHtml(it); tip.style.display = "block"; placeTip(e);
    });
  });
  document.addEventListener("mousemove", (e) => { if (tip.style.display === "block") placeTip(e); });
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget || !(e.relatedTarget as Element).closest?.("[data-serial]")) { hoverSerial = null; tip.style.display = "none"; } });
}
