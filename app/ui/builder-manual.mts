// ui/builder-manual.mts — the Suit Builder's Manual mode (issue #12): an Automatic | Manual switch in the top bar,
// and in Manual a suit built by hand. The totals strip (resists, the casting and combat totals and the stats, each
// against its cap), the twelve slot cards, and beside them the picker: one item browser (item-browser.mts) fixed to
// the selected slot, with a delta column saying what each row would change. A pick fills the slot and the picker
// stays on it, so piece after piece can be tried. The mode, "No character" and the suit (a serial per slot) are
// ui-prefs fields, so they survive a reload; a scan reload resolves the serials again, and one that no longer
// resolves shows as a missing card. The numbers come from ui/manual-model.mts.
import { OPTIMIZER_SLOTS, RESIST_KEYS, effectiveProfile, profileResistCaps, toOptItem, totalsOf } from "../vault-lib.mts";
import type { Character, EffectiveProfile, Item, OptItem } from "../vault-lib.mts";
import type { ItemQuery } from "../item-query.mts";
import { state } from "./store.mts";
import { $, el, label, slotLabel, itemTip, toast } from "./dom.mts";
import { box, txt, button, icon, meter, segmented, tag, confirmDialog, modalOpen } from "./components.mts";
import { api } from "./api.mts";
import { resolveItems, rarityToken } from "./items.mts";
import { closeCompare, keyProps, RESIST_NAMES } from "./builder-result.mts";
import { capNote, paperdoll, paperdollCaps } from "./builder-model.mts";
import { itemActions } from "./inventory.mts";
import { sheetParts } from "./sheet.mts";
import { createItemBrowser } from "./item-browser.mts";
import type { ItemBrowser } from "./item-browser.mts";
import type { UiPrefs } from "./api-types.mts";
import { TOTAL_KEYS, STAT_KEYS, capped, capLine, slotQuery, handConflict, handNote, savedSlots, missingSlots, deltaKeys, slotDelta } from "./manual-model.mts";

type Mode = "automatic" | "manual";
let mode: Mode = "automatic";
let noCharacter = false;
// The suit: a serial per slot, and the records those serials resolved to (a slot whose serial is not here is missing).
let slots: Record<string, number> = {};
let items: Record<number, Item> = {};
let pickSlot: string | null = null;
let browser: ItemBrowser | null = null;
const fixed: Partial<ItemQuery> = {};
let seg: (HTMLDivElement & { setValue: (v: string) => void }) | null = null;

// ---------------------------------------------------------------- prefs and the mode
// load()'s GET /api/ui-prefs answer (null when that request failed).
export function applyBuilderPrefs(prefs: UiPrefs | null): void {
  mode = prefs?.builderMode === "manual" ? "manual" : "automatic";
  noCharacter = prefs?.manualFor === "none";
  slots = savedSlots(prefs?.manualSuit);
  synced = false;
  if (seg) showMode();
}
const savePrefs = (body: UiPrefs): void => { api("/api/ui-prefs", { method: "PUT", body }).catch((e: Error) => toast(`Could not save the Suit Builder's mode or manual suit: ${e.message}`, "bad")); };
const isManual = (): boolean => mode === "manual";
// The character whose bonuses Manual's totals take: the builder's own, unless "No character" is picked.
const manualCharacter = (): string | null => (noCharacter ? null : state.builder.character);

// Once, from initBuilder(): the mode switch beside the title, and Manual's screen.
export function initManual(): void {
  seg = segmented({ label: "Builder mode", options: [{ value: "automatic", label: "Automatic" }, { value: "manual", label: "Manual" }], value: mode, size: "md",
    onChange: (v) => { mode = v as Mode; savePrefs({ builderMode: mode }); showMode(); } });
  seg.id = "b-mode";
  $<HTMLElement>("#h-builder")!.after(seg);
  const root = $<HTMLElement>("#b-manual")!;
  // Esc closes the picker from anywhere on the screen (a slot card, a row, the search, the bare page after a click on
  // text) and gives its slot card the focus; a popover, a drawer, a dialog or a search being cleared keeps its own Esc.
  $<HTMLButtonElement>("#mb-picker-close")!.onclick = closePicker;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !pickSlot || e.defaultPrevented || root.offsetParent === null || root.closest("[inert]") || modalOpen()) return;
    e.preventDefault();
    closePicker();
  });
  showMode();
}
function showMode(): void {
  const manual = isManual();
  if (manual) closeCompare();
  seg!.setValue(mode);
  $<HTMLElement>("#tab-builder")!.classList.toggle("manual", manual);
  $<HTMLElement>("#b-manual")!.hidden = !manual;
  $<HTMLElement>("#b-runs-open")!.hidden = manual;   // saved runs are Automatic results
  paintCharSelect();
  if (manual) void syncManual();
}
// The character select: Manual adds "No character" (raw item totals) at its top.
export function paintCharSelect(): void {
  const sel = $<HTMLSelectElement>("#b-char")!, none = sel.querySelector('option[value=""]');
  if (isManual() && !none) sel.prepend(el("option", { value: "" }, "No character"));
  if (!isManual()) none?.remove();
  sel.value = isManual() && !manualCharacter() ? "" : state.builder.character || "";
}
// The select changed in Manual: "No character", or a character (which the caller selects when it is another one).
export function setManualFor(character: string | null): void {
  if (!isManual()) return;
  noCharacter = !character;
  savePrefs({ manualFor: noCharacter ? "none" : "character" });
  renderManual();
}

// ---------------------------------------------------------------- the suit
// After a load, a scan reload or a switch to Manual: the saved serials resolved to their records again.
// Until it lands the screen is not drawn, so a piece still resolving never flashes up as missing.
let syncSeq = 0, syncing = false, synced = false;
export async function syncManual(): Promise<void> {
  if (!isManual() || !state.inv) return;
  const mine = ++syncSeq, asked = slots;
  syncing = true;
  const found = await resolveItems(Object.values(asked));
  if (mine !== syncSeq) return;
  if (asked !== slots) { void syncManual(); return; }   // a pick or a clear landed meanwhile: resolve the suit as it is now
  syncing = false; synced = true;
  items = found;
  draw();
  if (browser) { browser.sync(); if (pickSlot) browser.fetch(); }
}
// Every filled slot for the hand rule: a piece no longer in the scans still fills its hand.
const held = (): Record<string, Item | Record<string, never>> => Object.fromEntries(Object.entries(slots).map(([s, serial]) => [s, items[serial] ?? {}]));
const suitOpt = (): Record<string, OptItem> => Object.fromEntries(Object.entries(slots).flatMap(([s, serial]) => (items[serial] ? [[s, toOptItem(items[serial]!)]] : [])));
function profile(): EffectiveProfile {
  const name = manualCharacter();
  return name && state.builder.profile ? effectiveProfile(state.builder.profile, state.inv!.characters[name] as Character) : effectiveProfile({}, null);
}
function setSlots(next: Record<string, number>): void {
  slots = next;
  savePrefs({ manualSuit: slots });
  draw();
  if (pickSlot) browser?.fetch();   // the rows' deltas and the current row follow the new suit
}
function clearSlot(slot: string): void {
  const { [slot]: _gone, ...rest } = slots;
  setSlots(rest);
  $<HTMLElement>(`#b-manual .mb-slot-pick[data-slot="${slot}"]`)?.focus();
}
// A row activated in the picker: into the slot, clearing what the hand rule rules out, and the picker stays.
function pick(it: Item): void {
  const slot = pickSlot;
  if (!slot || slots[slot] === it.serial) return;
  const cleared = handConflict(slot, it, held());
  const next = { ...slots, [slot]: it.serial };
  if (cleared) delete next[cleared];
  items[it.serial] = it;
  setStatus(cleared ? `${it.name} is in ${slotLabel(slot)}. ${handNote(items[slots[cleared]!]?.name || "The piece", slotLabel(cleared))}` : `${it.name} is in ${slotLabel(slot)}.`);
  setSlots(next);
}
async function clearAll(): Promise<void> {
  if (!await confirmDialog({ title: "Clear every slot?", body: "The manual suit is emptied.", confirmLabel: "Clear all" })) return;
  setSlots({});
}
// Every slot takes the piece the character wears there.
async function startFromWorn(name: string): Promise<void> {
  if (Object.keys(slots).length && !await confirmDialog({ title: `Replace the suit with what ${name} wears?`, body: `Each slot takes the piece ${name} wears there, and a slot ${name} leaves empty is cleared.`, confirmLabel: "Replace the suit", danger: false })) return;
  const next: Record<string, number> = {};
  for (const it of state.inv!.worn[name] || []) if (it.slot && OPTIMIZER_SLOTS.includes(it.slot)) { next[it.slot] = it.serial; items[it.serial] = it; }
  setSlots(next);
}

// ---------------------------------------------------------------- drawing
// Another character picked (its bonuses and its profile's floors and weights): the screen and the rows' deltas.
export function renderManual(): void {
  if (!isManual() || !state.inv || syncing || !synced) return;
  draw();
  if (pickSlot) browser?.fetch();
}
function draw(): void {
  const root = $<HTMLElement>("#b-manual")!;
  root.querySelector("#mb-totals")!.replaceWith(totalsCard());
  root.querySelector("#mb-suit")!.replaceWith(suitCard());
  root.querySelector("#mb-stats")!.replaceWith(statsCard());
  paintPicker();
}
function totalsCard(): HTMLElement {
  const name = manualCharacter(), prof = profile(), resists = profileResistCaps(prof), caps = paperdollCaps(resists);
  const suit = suitOpt(), t = paperdoll(totalsOf(suit), prof.resistBonus);
  const tiles = RESIST_KEYS.map((k) => {
    const [nm, color] = RESIST_NAMES[k]!, c = resists[k]!, v = t[k] || 0, { shown, wasted } = capped(v, c.cap), line = capLine(v, c.cap), note = capNote(c);
    return box("div", { class: `resist tint tint-${color.slice(6)}`, "data-key": k }, el("span", { class: "t-sm resist-name", style: `color:var(${color})` }, nm),
      box("span", { class: "b-resist-val" }, txt(shown, "t-xl"), txt(`/ ${c.cap}`, "muted")),
      meter(shown, c.cap, { tone: wasted ? "warn" : "ok", label: `${nm} ${shown} of ${c.cap}` }), txt(line.text, `t-sm tone-${line.tone}`),
      note ? txt(`Cap ${note}`, "t-sm strong b-cap-note") : null);
  });
  const stat = (k: string): HTMLElement => {
    const v = t[k] || 0, cap = caps[k], line = capLine(v, cap);
    return box("div", { class: `b-stat${k === STAT_KEYS[0] ? " mb-stat-sep" : ""}`, "data-key": k }, txt(label(k), "t-sm muted"),
      box("span", { class: "v" }, txt(cap == null ? v : capped(v, cap).shown, "strong"), cap == null ? null : txt(` / ${cap}`, "muted")),
      txt(line.text, `t-sm tone-${line.tone}`));
  };
  const rsb = prof.resistBonus || 0;
  const note = name ? `${name}'s paperdoll values: +${rsb} to each resist from Resisting Spells, against ${name}'s resist caps` : "Raw item totals: with no character there is no Resisting Spells or race bonus";
  const filled = Object.keys(suit).length;   // a missing piece counts for nothing
  return el("section", { class: "card mb-totals", id: "mb-totals", "aria-label": "Suit totals" },
    box("div", { class: "mb-totals-head" }, el("h2", { class: "t-md" }, "Suit totals"), txt(note, "t-sm muted"), el("span", { class: "spacer" }), txt(`${filled} of ${OPTIMIZER_SLOTS.length} slots`, "t-sm muted")),
    box("div", { class: "b-resists" }, ...tiles),
    box("div", { class: "mb-props" }, ...[...TOTAL_KEYS, ...STAT_KEYS].map(stat)));
}
// The character sheet's figures (sheet.mts's KPI row and Properties card, with the skills) for the manual suit: the
// character's own attributes with the suit's bonuses in place of what it wears in those slots (the sheet's
// now → after sum, drawn with the after figures only), or the items' totals alone with no character.
function statsCard(): HTMLElement {
  const name = manualCharacter();
  const worn = name ? Object.fromEntries((state.inv!.worn[name] || []).filter((i) => i.slot && OPTIMIZER_SLOTS.includes(i.slot)).map((i) => [i.slot!, i])) : {};
  const suit = Object.fromEntries(Object.entries(slots).flatMap(([s, serial]) => (items[serial] ? [[s, items[serial]!]] : [])));
  const { kpis, props } = sheetParts(name, worn, suit, { resistCaps: profileResistCaps(profile()), compare: false });
  return box("div", { class: "sheet mb-stats", id: "mb-stats", role: "group", "aria-label": name ? `${name} in this suit` : "This suit's item totals" }, kpis, props);
}
// Armor first, then jewelry, the cloak and the hands, as on the paperdoll.
const GROUPS: Array<[string, string[]]> = [["Armor", ["helmet", "neck", "chest", "arms", "hands", "legs"]], ["Jewelry, cloak and weapons", ["ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"]]];
function suitCard(): HTMLElement {
  const name = manualCharacter(), filled = Object.keys(slots).length, missing = missingSlots(slots, items).length;
  const worn = name ? button({ label: `Start from what ${name} wears`, size: "sm", attrs: { id: "mb-worn" }, onClick: () => { void startFromWorn(name); } }) : null;
  const clear = filled ? button({ label: "Clear all", variant: "ghost", size: "sm", attrs: { id: "mb-clear" }, onClick: () => { void clearAll(); } }) : null;
  return el("section", { class: "card mb-suit", id: "mb-suit", "aria-label": "Suit" },
    box("div", { class: "card-head" }, el("h2", {}, "Suit"), txt(filled ? `${filled} of ${OPTIMIZER_SLOTS.length} slots filled${missing ? `, ${missing} missing from your scans` : ""}` : "Every slot is empty", `t-sm ${missing ? "tone-warn" : "muted"}`), el("span", { class: "spacer" }), worn, clear),
    box("div", { class: "mb-suit-body" }, ...GROUPS.map(([title, group]) => box("div", { class: "mb-group", role: "group", "aria-label": title }, txt(title, "caps muted"), box("div", { class: "mb-grid" }, ...group.map(slotCard))))));
}
// A slot card, two lines: a button that opens the picker on the slot (the slot and the piece's name in its rarity's
// color, then its key properties, with where it lives in its item tooltip; "Empty"; or "Missing" for a serial the
// scans no longer have), and Clear.
function slotCard(slot: string): HTMLElement {
  const serial = slots[slot], it = serial != null ? items[serial] : undefined, sel = pickSlot === slot, nm = slotLabel(slot);
  let head: HTMLElement, line: HTMLElement;
  if (it) {
    const token = rarityToken(it.rarity), props = keyProps(it.props);
    head = txt(it.name, "mb-name ellip");
    if (token) head.style.color = `var(${token})`;
    line = txt(props || "No properties", "t-sm muted ellip");
  } else if (serial != null) {
    head = txt("Missing", "mb-name tone-warn");
    line = txt(`No longer in your scans · 0x${serial.toString(16)}`, "t-sm muted ellip");
  } else {
    head = box("span", { class: "mb-choose" }, icon("plus", { size: "sm" }), txt(sel ? "Choosing…" : "Empty"));
    line = txt(sel ? "Pick a piece in the list" : "Click to choose a piece", "t-sm faint ellip");
  }
  const open = box("button", { type: "button", class: "mb-slot-pick", "data-slot": slot, "aria-expanded": String(sel), "aria-controls": "mb-picker", onclick: () => openPicker(slot) },
    box("span", { class: "mb-slot-line" }, txt(nm, "caps muted"), head), line);
  if (it) itemTip(open, it);
  const clear = serial != null ? button({ label: `Clear ${nm}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", cls: "mb-clear", onClick: () => clearSlot(slot) }) : null;
  return box("div", { class: `mb-slot${serial == null ? " mb-empty" : ""}${serial != null && !it ? " mb-missing" : ""}${sel ? " mb-sel" : ""}` }, open, clear);
}

// ---------------------------------------------------------------- the picker
function openPicker(slot: string): void {
  pickSlot = slot;
  setStatus("");
  Object.assign(fixed, slotQuery(slot));
  const host = $<HTMLElement>("#mb-browser")!;
  if (!browser) {
    browser = createItemBrowser(host, { fixed, columns: ["tags"], extraColumn: { label: "Change", title: "What the suit's totals do with this piece in the slot", width: 240, cell: deltaCell },
      onActivate: (it) => pick(it), rowActions: itemActions, persist: false,
      // Marks the row whose piece is in the slot now; there is no detail panel to open.
      detail: { open: () => false, serial: () => (pickSlot ? slots[pickSlot] ?? null : null), close: () => {}, refresh: () => {} } });
    browser.sync();
  }
  browser.setQuery({ ...browser.query });   // the new slot's pieces, from the top
  draw();
  $<HTMLElement>("#mb-picker")!.scrollIntoView({ block: "nearest" });   // on a short window the screen scrolls to show it whole
  host.querySelector<HTMLInputElement>(".inv-search input")?.focus();
}
function closePicker(): void {
  const slot = pickSlot;
  pickSlot = null;
  draw();
  $<HTMLElement>(`#b-manual .mb-slot-pick[data-slot="${slot}"]`)?.focus();
}
function setStatus(text: string): void { $<HTMLElement>("#mb-status")!.textContent = text; }
function paintPicker(): void {
  const picker = $<HTMLElement>("#mb-picker")!;
  $<HTMLElement>("#mb-hint")!.hidden = !!pickSlot;
  $<HTMLElement>("#b-manual")!.classList.toggle("picking", !!pickSlot);
  picker.hidden = !pickSlot;
  if (!pickSlot) return;
  $<HTMLElement>("#mb-picker-h")!.textContent = `${slotLabel(pickSlot)}: choose a piece`;
  picker.querySelector("table")!.setAttribute("aria-label", `Pieces for ${slotLabel(pickSlot)}`);
}
// A row's delta against the suit as it is: "In this slot" for the piece already there, else what changes in the strip
// and in the profile's floors and weights. A piece someone wears and a gargoyle-only one are tagged first, since the
// Location column that says so is often scrolled out of the narrow picker.
function deltaCell(it: Item): HTMLElement {
  if (pickSlot && slots[pickSlot] === it.serial) return txt("In this slot", "t-sm muted mb-delta");
  const slot = pickSlot!, prof = profile(), rsb = prof.resistBonus || 0, cur = suitOpt();
  const after = { ...cur, [slot]: toOptItem(it) };
  const cleared = handConflict(slot, it, held());
  if (cleared) delete after[cleared];
  const parts = slotDelta(paperdoll(totalsOf(cur), rsb), paperdoll(totalsOf(after), rsb), deltaKeys(prof), paperdollCaps(profileResistCaps(prof)));
  const kids = parts.flatMap((p, i) => [i ? txt(" · ", "faint") : null, txt(p.text, `tone-${p.tone}`)]);
  const worn = it.equippedBy ? tag(`Worn by ${it.equippedBy}`, it.equippedBy === manualCharacter() ? undefined : "warn") : null;
  return el("span", { class: "mb-delta" }, worn, it.gargoyle ? tag("Gargoyle") : null, ...(kids.length ? kids : [txt("No change", "muted")]));
}
