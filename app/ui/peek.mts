// ui/peek.mts — the Inventory's item peek (design spec 4.3, artboard 3): the selected row's item in a
// panel docked beside the table (400 px, 360 below 1280, laid over the table below 1180), while the
// table stays live. Header: the name, ↑ / ↓ / close, rarity, tags and a Meditation-safe badge. Then where
// it is, its resists and its other properties, and a footer with Highlight, Grab and Go to (disabled with
// the reason when they cannot run). ↑/↓ step through the table's rows and Esc closes, from the panel, the table or
// the bare page. inventory.mts owns the rows; this module is handed how to step and where focus goes back.
import type { Item } from "../vault-lib.mts";
import { $, el, slotLabel } from "./dom.mts";
import { bridgeActionReason, runBridgeAction } from "./bridge.mts";
import { relativeWhen } from "./messages.mts";
import { txt, box, button, badge, meter, tipWrap, kbd } from "./components.mts";
import type { IconName } from "./components.mts";
import { plural } from "./inv-model.mts";
import { rarityEl, locationEl, tagEls, tagWords } from "./inventory.mts";

let current: Item | null = null;
let hooks: { step: (delta: number) => void; closed: (focusRow: boolean) => void } = { step: () => {}, closed: () => {} };
const panel = (): HTMLElement => $<HTMLElement>("#inv-peek")!;

export const peekOpen = (): boolean => current != null;
export const peekSerial = (): number | null => current?.serial ?? null;
export function initPeek(h: typeof hooks): void {
  hooks = h;
  // On the document, not the panel: a click on the panel's text, or on the page around the table, leaves
  // focus on <body>, and a reload that redraws the table can detach the focused row, so a handler on the
  // panel or the rows alone never hears the keys. A focused row's own keys are handled (and prevented)
  // by the table first; anything being typed into, or a popover, menu, dialog or drawer, keeps its keys.
  document.addEventListener("keydown", (e) => {
    if (!current || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !["Escape", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const p = panel(), t = e.target as HTMLElement;
    if (p.offsetParent === null || document.querySelector(".pop")) return;
    const inPanel = p.contains(t);
    if (!inPanel && t !== document.body && t !== document.documentElement && !t.closest("#inv-scroll tbody")) return;
    if (t.closest("input, textarea, select, [contenteditable], dialog, .drawer-root")) return;
    if (e.key === "Escape") { e.preventDefault(); closePeek(true); return; }
    if (t.closest(".peek-body")) return;   // a focused part of the body keeps the arrows for scrolling
    e.preventDefault();
    hooks.step(e.key === "ArrowUp" ? -1 : 1);
  });
  document.addEventListener("bridgechange", () => { if (current) draw(current, false); });
}

// Show `it`; `focus` moves focus into the panel (a click or Enter on a row keeps it on the row so the
// arrows go on stepping through the table).
export function openPeek(it: Item, { focus = false }: { focus?: boolean } = {}): void {
  current = it;
  draw(it, focus);
}
export function closePeek(focusRow = false): void {
  if (!current) return;
  current = null;
  const p = panel();
  p.hidden = true;
  p.replaceChildren();
  hooks.closed(focusRow);
}
// The table reloaded (a scan landed, a Forget): show the item's new record, or close if it is gone.
export function peekRefresh(find: (serial: number) => Item | undefined, stillThere: boolean): void {
  if (!current) return;
  const fresh = find(current.serial);
  if (fresh) { current = fresh; draw(fresh, false); } else if (!stillThere) closePeek();
}

// ---------------------------------------------------------------- the panel
const RESISTS: Array<[string, string, string]> = [["physResist", "Phys", "--res-phys"], ["fireResist", "Fire", "--res-fire"], ["coldResist", "Cold", "--res-cold"], ["poisonResist", "Poison", "--res-poison"], ["energyResist", "Energy", "--res-energy"]];
// A tooltip line the Where and Resists sections already show; the tier line, which the header shows.
const SHOWN_ELSEWHERE = /^(weight\b|durability\s+\d|(physical|fire|cold|poison|energy) resist\b)/i;
const RARITY_LINE = /^(minor|lesser|greater|major|legendary) (magic item|artifact)$/i;
// The item's other tooltip lines as [name, value] pairs, in the game's order; requirements are muted.
// A set piece's full-set block (the lines after "Only when full set is present") is kept whole and
// muted: its resist lines are the set's bonus, not this piece's own.
export function propertyLines(it: Item): Array<{ name: string; value: string; muted: boolean }> {
  const tags = new Set(tagWords());
  const out: Array<{ name: string; value: string; muted: boolean }> = [];
  let inSet = false;
  for (const raw of (it.lines || []).slice(1)) {
    const l = String(raw).replace(/<[^>]+>/g, "").trim();
    if (/full set is present/i.test(l)) inSet = true;
    if (!l || RARITY_LINE.test(l) || (!inSet && (SHOWN_ELSEWHERE.test(l) || tags.has(l.toLowerCase())))) continue;
    const m = l.match(/^(.*?)[\s:]+([+-]?\d[\d.,]*\s*(?:%|s)?(?:\s*-\s*\d+)?)$/);
    const name = (m ? m[1]! : l).replace(/:$/, "");
    out.push({ name, value: m ? m[2]!.trim() : "", muted: inSet || /requirement|required/i.test(name) });
  }
  return out;
}
function kvRows(rows: Array<[string, HTMLElement | string, boolean?]>, cls = ""): HTMLElement {
  return box("div", { class: `kv${cls ? " " + cls : ""}` }, ...rows.flatMap(([k, v, muted]) => [
    box("div", { class: `kv-k${muted ? " muted" : ""}` }, txt(k)),
    box("div", { class: `kv-v${muted ? " muted" : ""}` }, typeof v === "string" ? txt(v) : v),
  ]));
}
const section = (title: string, ...kids: Array<HTMLElement | null>): HTMLElement => box("section", { class: "peek-sec", "aria-label": title }, txt(title, "caps"), ...kids);
// A resist tile: the element's name in its colour (information is in the word too, not colour alone), the value.
function resistTile(name: string, value: number, token: string): HTMLElement {
  return box("div", { class: "resist" }, el("span", { class: "t-sm", style: `color:var(${token})` }, name), txt(String(value), "t-lg"));
}
const ACTIONS: Array<["highlight" | "grab" | "goto", string, IconName]> = [["highlight", "Highlight", "highlight"], ["grab", "Grab", "grab"], ["goto", "Go to", "goto"]];

function draw(it: Item, focus: boolean): void {
  const p = panel();
  const nameId = "peek-title";
  const dur = Array.isArray(it.extras?.durability) ? it.extras.durability as number[] : null;
  const where: Array<[string, HTMLElement | string]> = [
    [it.equippedBy ? "Worn by" : "Container", it.equippedBy ? it.equippedBy : locationEl(it)],
    ["Scanned by", `${it.scannedBy} · ${relativeWhen(it.seenAt)}`],
  ];
  if (it.slot) where.push(["Slot", slotLabel(it.slot)]);
  if (it.weight != null) where.push(["Weight", plural(it.weight, "stone")]);
  if ((it.amount || 1) > 1) where.push(["Quantity", it.amount.toLocaleString("en-US")]);
  if (dur && dur.length === 2) {
    const [now, max] = dur as [number, number];
    where.push(["Durability", box("span", { class: "peek-dur" }, meter(now, max, { tone: max && now / max < 0.5 ? "warn" : "ok", label: "Durability" }), txt(`${now} / ${max}`))]);
  }
  const hasResists = RESISTS.some(([k]) => it.props[k]);
  const props = propertyLines(it);
  const acts = ACTIONS.map(([action, text, ic]) => {
    const why = bridgeActionReason(action, it);
    const b = button({ label: text, icon: ic, size: "md", block: true, variant: action === "grab" ? "primary" : "secondary", disabled: !!why, onClick: () => { runBridgeAction(action, it); } });
    return why ? tipWrap(b, why) : b;
  });
  p.setAttribute("aria-labelledby", nameId);
  p.replaceChildren(
    box("div", { class: "peek-head" },
      box("div", { class: "peek-title" }, el("h2", { class: "t-lg", id: nameId }, it.name),
        button({ label: "Previous item", icon: "chevron-up", iconOnly: true, variant: "ghost", size: "sm", onClick: () => hooks.step(-1) }),
        button({ label: "Next item", icon: "chevron-down", iconOnly: true, variant: "ghost", size: "sm", onClick: () => hooks.step(1) }),
        button({ label: "Close detail", icon: "close", iconOnly: true, variant: "ghost", size: "sm", attrs: { "data-peek-close": "" }, onClick: () => closePeek(true) })),
      box("div", { class: "peek-meta" }, rarityEl(it.rarity, "strong"), ...tagEls(it), it.gear && it.medable ? badge("Meditation-safe", "ok") : null)),
    box("div", { class: "peek-body" },
      section("Where it is", kvRows(where)),
      hasResists ? section("Resists", box("div", { class: "peek-resists" }, ...RESISTS.map(([k, short, token]) => resistTile(short, it.props[k] || 0, token)))) : null,
      props.length ? section("Properties", kvRows(props.map((l) => [l.name, l.value, l.muted]), "peek-props")) : null),
    box("div", { class: "overlay-foot peek-foot" },
      box("div", { class: "peek-acts" }, ...acts),
      box("p", { class: "t-sm muted peek-keys" }, kbd("↑"), kbd("↓"), txt("step through rows"), kbd("Esc"), txt("close"))));
  p.hidden = false;
  if (focus) p.querySelector<HTMLElement>("[data-peek-close]")?.focus();
}
