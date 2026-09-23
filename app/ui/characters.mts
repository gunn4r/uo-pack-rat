// ui/characters.mts — the Characters screen (design spec 4.4, 4.5): the roster at #/characters, one
// 48 px row per character with their resists against the cap, and a character's sheet at
// #/characters/<Name> (the sheet itself is sheet.mts's sheetNode, shared with the Suit Builder).
import { state } from "./store.mts";
import { $, el, toast, tipNode, hideItemTip, compactChildren } from "./dom.mts";
import { txt, box, button, meter, table, searchInput, message, popover, menu, confirmDialog, type Column } from "./components.mts";
import { api } from "./api.mts";
import { reload } from "./app.mts";
import { selectCharacter } from "./builder.mts";
import { showCharacterItems, showItem } from "./inventory.mts";
import { openWizard } from "./wizard.mts";
import { relativeWhen } from "./messages.mts";
import { sheetNode, wornSet, resistFigures, atCap, plural, type ResistFigure, type SheetItem } from "./sheet.mts";
import type { Item } from "../vault-lib.mts";
import type { RunsListApiResponse } from "./api-types.mts";
import { rosterView, triple, type RosterRow, type RosterSort } from "./roster.mts";


const num = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
// Every character the page knows of: scanned ones, and ones with only a saved Suit Builder profile.
function names(): string[] {
  return [...new Set([...Object.keys(state.inv!.characters), ...Object.keys(state.profiles?.characters || {})])].sort((a, b) => a.localeCompare(b));
}
function rosterRows(): RosterRow[] {
  return names().map((name) => {
    const c = state.inv!.characters[name];
    const st = (c?.stats || {}) as Record<string, unknown>, mx = (c?.maxes || {}) as Record<string, unknown>;
    return {
      name, scannedAt: c?.scannedAt || null,
      stats: [num(st.str), num(st.dex), num(st.int)],
      pools: [num(mx.hits), num(mx.stam), num(mx.mana)],
      resists: c ? resistFigures(name, wornSet(name)) : null,
      worn: (state.inv!.worn[name] || []).length,
    };
  });
}

// ---------------------------------------------------------------- screen state
let current: string | null = null;   // the character whose sheet is open; null = the roster
let query = "";
let sort: RosterSort = { key: "name", dir: 1 };
const topbar = (): HTMLElement => $<HTMLElement>("#tab-characters .topbar")!;
const body = (): HTMLElement => $<HTMLElement>("#char-body")!;
const search = searchInput({ label: "Find a character", placeholder: "Find a character", attrs: { id: "char-q", class: "input input-sm" } });   // 28px: a top-bar control
search.root.classList.add("char-search");
search.input.addEventListener("input", () => { query = search.input.value; renderRoster(); });

// The router (app.mts) calls this for #/characters and #/characters/<Name>.
export function showCharacter(name: string | null): void {
  current = name;
  if (state.inv) renderCharacters();
}
export function renderCharacters(): void {
  if (current && !names().includes(current)) { current = null; history.replaceState(null, "", "#/characters"); }
  if (current) renderSheet(current); else renderRoster();
}

// ---------------------------------------------------------------- actions shared by the roster and the sheet
const go = (hash: string): void => { location.hash = hash; };
const sheetHash = (name: string): string => `#/characters/${encodeURIComponent(name)}`;
function buildSuit(name: string): void { go(`#/builder/${encodeURIComponent(name)}`); }
function savedRuns(name: string): void {
  if (state.builder.character !== name) selectCharacter(name);
  go("#/runs");
}
// The Inventory narrowed to one character's things, through its Character filter.
const showItems = (name: string): void => showCharacterItems(name);
function moreMenu(anchor: HTMLElement, name: string, onSheet: boolean): void {
  const scanned = !!state.inv!.characters[name];
  const m = menu(anchor, [
    ...(onSheet ? [] : [{ label: "Open character sheet", onSelect: () => go(sheetHash(name)) }]),
    ...(scanned ? [{ label: `Show ${name}'s items`, onSelect: () => showItems(name) }, { label: "Saved runs", onSelect: () => savedRuns(name) }] : []),
    "divider" as const,
    { label: `Forget ${name}…`, danger: true, onSelect: () => { void forgetCharacter(name); } },
  ], { label: `Actions for ${name}` });
  const count = m.counts.get("Saved runs");
  if (count) api<RunsListApiResponse>(`/api/runs?character=${encodeURIComponent(name)}`).then((r) => { count.textContent = String((r.runs || []).length); }).catch(() => {});
}
const moreButton = (name: string, onSheet: boolean): HTMLButtonElement => {
  const b: HTMLButtonElement = button({ label: `More actions for ${name}`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", attrs: { "aria-haspopup": "menu", "aria-expanded": "false" }, onClick: () => moreMenu(b, name, onSheet) });
  return b;
};

// ---------------------------------------------------------------- the roster
const ROSTER_COLS: Array<[RosterSort["key"] | null, string, boolean, string]> = [
  ["name", "Character", false, ""], ["scan", "Last scan", false, "112px"], [null, "STR · DEX · INT", false, "112px"], [null, "Hits · Stam · Mana", false, "124px"],
  ["physResist", "Phys", true, "64px"], ["fireResist", "Fire", true, "64px"], ["coldResist", "Cold", true, "64px"], ["poisonResist", "Poison", true, "64px"], ["energyResist", "Energy", true, "64px"],
  [null, "Worn", true, "56px"], [null, "Actions", false, "124px"],
];
function resistCell(f: ResistFigure): HTMLElement {
  const full = atCap(f.value, f.cap);
  return box("span", { class: "res-cell" }, txt(f.value, full ? "strong at-cap" : ""), meter(f.value, f.cap, { tone: full ? "ok" : undefined, label: `${f.label} resist ${f.value} of ${f.cap}` }));
}
function renderRoster(): void {
  const all = rosterRows();
  topbar().replaceChildren(el("h1", { id: "h-characters" }, "Characters"), txt(`${Object.keys(state.inv!.characters).length} scanned`, "t-sm muted"), el("span", { class: "spacer" }), search.root);
  if (!all.length) {
    const noClient = !state.settings?.client;
    body().replaceChildren(box("div", { class: "empty-state" }, el("h2", {}, "No scans yet"),
      txt(noClient ? "Set up your game client, then scan a character in game to see them here." : "Scan a character in game, or import a scan file, to see them here.", "muted"),
      noClient ? button({ label: "Run setup", variant: "primary", onClick: () => { void openWizard(); } }) : button({ label: "Import scans", variant: "primary", onClick: () => go("#/import") })));
    return;
  }
  const rows = rosterView(all, query, sort);
  const columns: Column[] = ROSTER_COLS.map(([key, label, isNum, width]) => ({
    label, num: isNum, width: width || undefined,
    ...(key ? { sort: sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none", onSort: () => { sort = { key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === "name" ? 1 : -1 }; renderRoster(); } } : {}),
  } as Column));
  const t = table({ label: "Characters", columns, rows: rows.map((r) => ({
    attrs: { "data-name": r.name },
    cells: [
      el("a", { class: "char-link strong", href: sheetHash(r.name) }, r.name),
      r.scannedAt ? txt(relativeWhen(r.scannedAt)) : txt("Not scanned", "muted"),
      txt(triple(r.stats)), txt(triple(r.pools)),
      ...(r.resists ? r.resists.map(resistCell) : [null, null, null, null, null]),
      txt(r.worn),
      box("span", { class: "row-btns" }, r.scannedAt ? button({ label: "Build suit", size: "sm", onClick: () => buildSuit(r.name) }) : null, moreButton(r.name, false)),
    ],
  })) });
  t.id = "char-table";
  // the Actions header is for screen readers only
  t.querySelector("thead th:last-child span")?.classList.add("sr");
  const tbody = t.querySelector("tbody")!;
  if (!rows.length) tbody.append(el("tr", {}, el("td", { colspan: ROSTER_COLS.length, class: "no-match" },
    box("div", { class: "empty-state" }, el("h2", {}, "No characters match"), txt(`None of the ${plural(all.length, "character")} has “${query.trim()}” in their name.`, "muted"),
      button({ label: "Clear search", onClick: () => { search.input.value = ""; query = ""; renderRoster(); search.input.focus(); } })))));
  const cap = rows[0]?.resists?.[0]?.cap ?? all.find((r) => r.resists)?.resists?.[0]?.cap ?? 70;
  const foot = box("div", { class: "tbl-foot" }, txt(rows.length === all.length ? plural(all.length, "character") : `${rows.length} of ${plural(all.length, "character")}`),
    el("span", { class: "spacer" }), txt(`Resists are paperdoll values, capped at ${cap}`));
  body().replaceChildren(el("div", { class: "card roster" }, el("div", { class: "roster-scroll" }, t), foot));
}

// ---------------------------------------------------------------- the character sheet
// A worn piece's tooltip, drawn by the same builder as the inventory's item tooltip, in a popover that
// stays until dismissed, with a way to the piece's full detail: the Inventory with it open in the item
// peek. The hover tooltip hides while it is open.
function slotDetail(it: SheetItem, tile: HTMLElement): void {
  hideItemTip();
  const item = it as Item;
  const p = popover(tile, [tipNode(item), button({ label: "Open in Inventory", size: "sm", icon: "inventory", onClick: () => showItem(item) })], { label: item.name, width: 280 });
  p.root.classList.add("item-pop", "tipcard-host");
  p.root.setAttribute("data-theme", "default");
  p.root.setAttribute("data-mode", "dark");
}
function metaLine(name: string): HTMLElement {
  const inv = state.inv!, c = inv.characters[name]!;
  const worn = (inv.worn[name] || []).length;
  // the containers this character's scans opened: "33 items in Metal Chest 0x700c0000"
  const roots = Object.values(inv.containers).filter((r) => r.parent == null && r.scannedBy === name && r.kind !== "backpack" && r.kind !== "bank");
  const parts: HTMLElement[] = [txt(`Scanned ${relativeWhen(c.scannedAt)}`), txt(`${plural(worn, "piece")} worn`)];
  for (const r of roots) {
    // the fold's label already carries the serial when two containers share a name
    const where = r.label || r.name || "a container", hex = `0x${Number(r.serial).toString(16)}`;
    parts.push(el("span", {}, `${plural(inv.rootCounts[r.serial] || 0, "item")} in ${where}`, where.includes(hex) ? null : [" ", txt(hex, "mono faint")]));
  }
  return box("p", { class: "sheet-meta t-sm muted" }, ...parts.flatMap((p, i) => (i ? [el("span", { class: "faint", "aria-hidden": "true" }, "·"), p] : [p])));
}
function renderSheet(name: string): void {
  const list = names(), i = list.indexOf(name);
  const prev = list[(i - 1 + list.length) % list.length]!, next = list[(i + 1) % list.length]!;
  const scanned = !!state.inv!.characters[name];
  const crumbs = box("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, el("a", { href: "#/characters", class: "t-md" }, "Characters"), el("span", { class: "faint", "aria-hidden": "true" }, "/"), el("h1", { id: "h-characters" }, name));
  topbar().replaceChildren(...compactChildren([crumbs,
    button({ label: `Previous character: ${prev}`, icon: "chevron-left", iconOnly: true, variant: "ghost", size: "sm", disabled: list.length < 2, onClick: () => go(sheetHash(prev)) }),
    button({ label: `Next character: ${next}`, icon: "chevron-right", iconOnly: true, variant: "ghost", size: "sm", disabled: list.length < 2, onClick: () => go(sheetHash(next)) }),
    el("span", { class: "spacer" }),
    scanned ? button({ label: `Show ${name}'s items`, size: "sm", onClick: () => showItems(name) }) : null,
    scanned ? button({ label: "Build a suit", icon: "builder", variant: "primary", size: "sm", onClick: () => buildSuit(name) }) : null,
    moreButton(name, true)]));
  if (!scanned) {
    body().replaceChildren(message({ tone: "info", text: `${name} has a saved Suit Builder profile but hasn't been scanned. Scan ${name} in game to fill in the sheet.` }));
    return;
  }
  body().replaceChildren(metaLine(name), sheetNode(name, wornSet(name), null, { onSlot: slotDetail }));
}

// A character deleted, renamed or moved off the account would otherwise keep its row and its worn set
// in the inventory for good: nothing else ever removes them. POST /api/forget-character writes a
// tombstone the fold drops the character's worn gear, backpack and bank for; a saved Suit Builder
// profile would keep the row on this screen, so it goes too. A later scan of the character brings the
// scanned parts back.
export async function forgetCharacter(name: string): Promise<void> {
  if (!await confirmDialog({ title: `Forget ${name}?`, body: `Their card, worn gear, backpack and bank leave the inventory, and their saved Suit Builder profile is deleted. Their saved runs stay. Scanning ${name} again brings the scanned parts back.`, confirmLabel: `Forget ${name}` })) return;
  try {
    if (state.inv!.characters[name]) await api("/api/forget-character", { method: "POST", body: { character: name } });
    const profiles = state.profiles!;
    if (profiles.characters?.[name]) {
      delete profiles.characters[name];
      await api("/api/profiles", { method: "PUT", body: profiles });
    }
    if (current === name) { current = null; history.replaceState(null, "", "#/characters"); }
    await reload();
  } catch (e) { toast((e as Error).message, "bad"); }
}
