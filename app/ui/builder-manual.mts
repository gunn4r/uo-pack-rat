// ui/builder-manual.mts — the Suit Builder's Manual mode (issue #12): an Automatic | Manual switch in the top bar,
// and in Manual a suit built by hand. The totals strip (resists, the casting and combat totals and the stats, each
// against its cap), the twelve slot cards, and beside them the picker: one item browser (item-browser.mts) fixed to
// the selected slot, with a delta column saying what each row would change. A pick fills the slot and the picker
// stays on it, so piece after piece can be tried. The mode, "No character" and the suit (a serial per slot) are
// ui-prefs fields, so they survive a reload; a scan reload resolves the serials again, and one that no longer
// resolves shows as a missing card. The numbers come from ui/manual-model.mts. Buffs, abilities and forms (app/buffs.mts,
// drawn by ui/builder-buffs.mts) can be counted in the totals: the ones that are on, the numbers the player edited and
// the switch are ui-prefs fields too, and turning one on or off is a step in the suit's undo history.
import { GEAR_SLOTS, RESIST_KEYS, effectiveProfile, profileResistCaps, toOptItem, totalsOf } from "../vault-lib.mts";
import type { Character, EffectiveProfile, Item, OptItem, PropMap } from "../vault-lib.mts";
import { applyBuffs, buffById, buffSkillValues, isBuffList, isBuffSkillsByCharacter, toggleBuff, NO_CHARACTER, signed } from "../buffs.mts";
import type { BuffResult, BuffWho, Stats } from "../buffs.mts";
import type { ItemQuery } from "../item-query.mts";
import { state } from "./store.mts";
import { $, el, label, slotLabel, itemTip, toast } from "./dom.mts";
import { box, txt, button, icon, segmented, tag, confirmDialog, modalOpen, tooltip, tipWrap } from "./components.mts";
import { api } from "./api.mts";
import { resolveItems, rarityToken } from "./items.mts";
import { closeCompare, keyProps, RESIST_NAMES } from "./builder-result.mts";
import { capNote, paperdoll, paperdollCaps } from "./builder-model.mts";
import { itemActions } from "./inventory.mts";
import { sheetParts, wornSet } from "./sheet.mts";
import { createItemBrowser } from "./item-browser.mts";
import type { ItemBrowser } from "./item-browser.mts";
import type { UiPrefs } from "./api-types.mts";
import { MANUAL_GROUPS, emptyHistory, record, undoStep, redoStep, historyKey, historyKeyNames, type History, type Suit, TOTAL_KEYS, STAT_KEYS, STRIP_KEYS, capped, capLine, slotQuery, handConflict, handNote, savedSlots, missingSlots, deltaKeys, slotDelta } from "./manual-model.mts";
import { buffMarker, buffStrip, focusBuffSearch, initBuffPicker, paintBuffPicker, type BuffActions, type BuffView } from "./builder-buffs.mts";

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
// The buffs that are on, the buff numbers the player edited, whether the totals count the buffs, whether the buff
// picker is open, and the form a just-turned-on form replaced (its note in the picker, until the next change).
let buffs: string[] = [];
let buffEdits: Record<string, Record<string, number>> = {};   // by character, NO_CHARACTER for No character
let countBuffs = true;
let buffsOpen = false;
let replaced: { on: string; off: string } | null = null;
// The suit's undo history, its steps holding the suit and its buffs (in memory: a reload starts a new one; another
// character keeps it, the suit is shared).
interface Snapshot { slots: Suit; buffs: string[] }
let history: History<Snapshot> = emptyHistory();
const MAC = /Mac|iPhone|iPad/.test(navigator.platform), KEY_NAMES = historyKeyNames(MAC);

// ---------------------------------------------------------------- prefs and the mode
// load()'s GET /api/ui-prefs answer (null when that request failed).
export function applyBuilderPrefs(prefs: UiPrefs | null): void {
  mode = prefs?.builderMode === "manual" ? "manual" : "automatic";
  noCharacter = prefs?.manualFor === "none";
  slots = savedSlots(prefs?.manualSuit);
  // through toggleBuff, so a hand-edited file's second form is dropped and the list is in catalog order
  buffs = isBuffList(prefs?.manualBuffs) ? prefs.manualBuffs.reduce<string[]>((on, id) => (on.includes(id) ? on : toggleBuff(on, id).next), []) : [];
  buffEdits = isBuffSkillsByCharacter(prefs?.buffSkills) ? prefs.buffSkills : {};
  countBuffs = prefs?.buffsCount !== "off";
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
  // Esc closes the picker (or the buff picker) from anywhere on the screen (a slot card, a row, the search, the bare
  // page after a click on text) and gives its slot card (or Add buff) the focus; a popover, a drawer, a dialog or a
  // search being cleared keeps its own Esc.
  $<HTMLButtonElement>("#mb-picker-close")!.onclick = closePicker;
  initBuffPicker(buffActions, () => paintBuffPicker(buffView(), buffActions));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !(pickSlot || buffsOpen) || e.defaultPrevented || root.offsetParent === null || root.closest("[inert]") || modalOpen()) return;
    e.preventDefault();
    if (pickSlot) closePicker(); else closeBuffs();
  });
  // ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z elsewhere) undo and redo a change to the suit while Manual is on screen.
  // Never from a text field, a select or anything editable (the search keeps its own undo), and not behind a dialog,
  // a popover or a drawer. Taking the key (preventDefault) also keeps the desktop app's Edit › Undo from acting on it:
  // Chromium hands a key to the page first and to the menu only when the page leaves it.
  document.addEventListener("keydown", (e) => {
    const kind = historyKey(e, MAC), t = e.target as HTMLElement;
    if (!kind || e.defaultPrevented || root.offsetParent === null || root.closest("[inert]") || modalOpen() || document.querySelector(".pop")) return;
    if (t.closest?.("input, textarea, select, [contenteditable]") || t.isContentEditable) return;
    e.preventDefault();
    stepHistory(kind);
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
// The buff numbers for Manual's character (or for No character) with that character's edits, which inputs are
// planned, the raw stats Bless takes a share of (the scanned stats less what the character wears) and the race. Worked
// out once per draw: every row's Change cell reads it.
type BuffInputs = { values: Record<string, number>; planned: Set<string>; stats: Stats | null; race: string | null };
let inputsMemo: BuffInputs | null = null;
const editsFor = (): Record<string, number> => buffEdits[manualCharacter() ?? NO_CHARACTER] || {};
function buffInputs(): BuffInputs {
  if (inputsMemo) return inputsMemo;
  const name = manualCharacter(), c = name ? state.inv!.characters[name] : null;
  const { values, planned } = buffSkillValues(c ? c.skills || {} : null, editsFor());
  if (!name || !c) return (inputsMemo = { values, planned, stats: null, race: null });
  const worn = totalsOf(wornSet(name)), st = c.stats || {};
  const raw = (k: string, pk: string): number => (Number(st[k]) || 0) - (worn[pk] || 0);
  return (inputsMemo = { values, planned, stats: { str: raw("str", "strBonus"), dex: raw("dex", "dexBonus"), int: raw("int", "intBonus") }, race: state.profiles?.characters?.[name]?.race || "human" });
}
// The suit's pieces by slot (a piece no longer in the scans left out), and the held weapon's flags: a two-handed
// weapon, else the one-handed slot's piece (Enchant reads its Spell Channeling).
const suitItems = (): Record<string, Item> => Object.fromEntries(Object.entries(slots).flatMap(([s, serial]) => (items[serial] ? [[s, items[serial]!]] : [])));
const weaponFlags = (suit: Record<string, Item | undefined>): string[] => ((suit.twoHanded?.twoHanded ? suit.twoHanded : suit.oneHanded)?.flags) || [];
// The strip's totals (paperdoll terms) and caps with the buffs that count: all that are on, or none with the switch off.
function buffed(t: PropMap, caps: Record<string, number>, all = false, suit: Record<string, Item | undefined> = suitItems()): BuffResult {
  const { values, stats, race } = buffInputs(), who: BuffWho = { race, weaponFlags: weaponFlags(suit) };
  return applyBuffs(t, caps, countBuffs || all ? buffs : [], values, stats, who);
}
// Every change to the suit or its buffs is one undo step, named by `label` ("Ring → Arcane Ring", "Divine Fury on");
// undo and redo pass none. `note` is the form a turned-on form replaced, said in the buff picker until the next change.
function commit(next: Partial<Snapshot>, label: string | null, note: typeof replaced = null): void {
  const after = { slots: next.slots ?? slots, buffs: next.buffs ?? buffs };
  if (label) history = record(history, { slots, buffs }, after, label);
  const changed = { ...(after.slots !== slots ? { manualSuit: after.slots } : {}), ...(after.buffs !== buffs ? { manualBuffs: after.buffs } : {}) };
  if (Object.keys(changed).length) savePrefs(changed);
  slots = after.slots; buffs = after.buffs; replaced = note;
  refresh();
}
// The screen, and the rows' deltas and the current row, follow the suit, its buffs and their numbers.
function refresh(): void {
  draw();
  if (pickSlot) browser?.fetch();
}
function clearSlot(slot: string): void {
  const { [slot]: _gone, ...rest } = slots;
  commit({ slots: rest }, `Clear ${slotLabel(slot)}`);
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
  commit({ slots: next }, `${slotLabel(slot)} → ${it.name}`);
}
async function clearAll(): Promise<void> {
  if (!await confirmDialog({ title: "Clear every slot?", body: "The manual suit is emptied.", confirmLabel: "Clear all" })) return;
  commit({ slots: {} }, "Clear all");
}
// Every slot takes the piece the character wears there.
async function startFromWorn(name: string): Promise<void> {
  if (Object.keys(slots).length && !await confirmDialog({ title: `Replace the suit with what ${name} wears?`, body: `Each slot takes the piece ${name} wears there, and a slot ${name} leaves empty is cleared.`, confirmLabel: "Replace the suit", danger: false })) return;
  const next: Record<string, number> = {};
  for (const it of state.inv!.worn[name] || []) if (it.slot && GEAR_SLOTS.includes(it.slot)) { next[it.slot] = it.serial; items[it.serial] = it; }
  commit({ slots: next }, `Start from what ${name} wears`);
}
// Undo or redo one step: the suit and its buffs as they were, the totals, the stats and the rows' deltas with it, and
// a line saying so.
function stepHistory(kind: "undo" | "redo"): void {
  const r = kind === "undo" ? undoStep(history) : redoStep(history);
  if (!r) return;
  history = r.history;
  const next = kind === "undo" ? r.step.before : r.step.after;
  const text = `${kind === "undo" ? "Undid" : "Redid"}: ${r.step.label}`, focused = document.activeElement?.id;
  commit(next, null);
  // The redrawn button keeps the focus; when it is now disabled (nothing more that way), the other one, else the card.
  if (focused === "mb-undo" || focused === "mb-redo") {
    const same = $<HTMLButtonElement>(`#${focused}`), other = $<HTMLButtonElement>(focused === "mb-undo" ? "#mb-redo" : "#mb-undo");
    (same && !same.disabled ? same : other && !other.disabled ? other : $<HTMLElement>("#mb-suit h2"))?.focus();
  }
  if (pickSlot) setStatus(text); else toast(text);
  if (Object.values(next.slots).some((s) => !items[s])) void syncManual();   // a piece from before a scan reload: resolve it
}
// The suit card's Undo and Redo: what each would do, with its key, or disabled when there is nothing to undo or redo.
function historyButton(kind: "undo" | "redo"): HTMLElement {
  const step = kind === "undo" ? history.past[history.past.length - 1] : history.future[0], name = kind === "undo" ? "Undo" : "Redo";
  const text = step ? `${name}: ${step.label} (${KEY_NAMES[kind]})` : `${name} (${KEY_NAMES[kind]})`;
  const b = button({ label: text, icon: kind, iconOnly: true, variant: "ghost", size: "sm", disabled: !step, attrs: { id: `mb-${kind}` }, onClick: () => stepHistory(kind) });
  return step ? tooltip(b, text) : tipWrap(b, `Nothing to ${kind}`);
}

// ---------------------------------------------------------------- drawing
// Another character picked (its bonuses and its profile's floors and weights): the screen and the rows' deltas.
export function renderManual(): void {
  if (!isManual() || !state.inv || syncing || !synced) return;
  refresh();
}
function draw(): void {
  inputsMemo = null;
  const root = $<HTMLElement>("#b-manual")!;
  root.querySelector("#mb-totals")!.replaceWith(totalsCard());
  root.querySelector("#mb-suit")!.replaceWith(suitCard());
  root.querySelector("#mb-stats")!.replaceWith(statsCard());
  paintPicker();
}
function totalsCard(): HTMLElement {
  const name = manualCharacter(), prof = profile(), resists = profileResistCaps(prof), base = paperdollCaps(resists);
  const suit = suitOpt(), r = buffed(paperdoll(totalsOf(suit), prof.resistBonus), base), t = r.totals, caps = r.caps;
  // One compact row: each total as "value / cap", in the ok tone at its cap, with "+N" (warn) for what is wasted past
  // it; the line a fuller tile would show ("23 to cap") is its tooltip and, for a screen reader, part of its text.
  // Under a total the buffs touch, their marker line; a cap they raised is underlined.
  const cell = (k: string, cap: number | undefined, head: HTMLElement, note: string | null, sep: boolean): HTMLElement => {
    const v = t[k] || 0, { shown, wasted } = capped(v, cap), line = `${capLine(v, cap).text}${note ? `, cap ${note}` : ""}`;
    const raised = cap != null && cap !== base[k];
    return box("div", { class: `mb-total${sep ? " mb-sep" : ""}`, "data-key": k, title: line }, head,
      box("span", { class: "mb-total-v" }, txt(shown, `strong${cap != null && v >= cap ? " tone-ok" : ""}`),
        cap == null ? null : raised ? el("span", { class: "muted" }, "/ ", el("span", { class: "bf-capup" }, String(cap))) : txt(`/ ${cap}`, note ? "strong b-cap-note" : "muted"),
        wasted ? txt(`+${wasted}`, "t-sm tone-warn") : null, el("span", { class: "sr" }, `: ${line}`)),
      buffMarker(k, r, base[k]));
  };
  const row = [
    ...RESIST_KEYS.map((k) => { const [nm, color] = RESIST_NAMES[k]!; return cell(k, caps[k], el("span", { class: "t-sm resist-name", style: `color:var(${color})` }, nm), capNote(resists[k]!), false); }),
    ...[...TOTAL_KEYS, ...STAT_KEYS].map((k) => cell(k, caps[k], txt(label(k), "t-sm muted"), null, k === TOTAL_KEYS[0] || k === STAT_KEYS[0])),
  ];
  const rsb = prof.resistBonus || 0, counted = countBuffs ? buffs.length : 0, withBuffs = counted ? ` with ${counted} ${counted === 1 ? "buff" : "buffs"}` : "";
  const note = name ? `${name}'s paperdoll values${withBuffs}: +${rsb} to each resist from Resisting Spells, against ${name}'s resist caps` : `Raw item totals${withBuffs}: with no character there is no Resisting Spells or race bonus`;
  const filled = Object.keys(suit).length;   // a missing piece counts for nothing
  return el("section", { class: "card mb-totals", id: "mb-totals", "aria-label": "Suit totals" },
    box("div", { class: "mb-totals-head" }, el("h2", { class: "t-md" }, "Suit totals"), txt(note, "t-sm muted"), el("span", { class: "spacer" }), txt(`${filled} of ${GEAR_SLOTS.length} slots`, "t-sm muted")),
    box("div", { class: "mb-totals-row" }, ...row),
    buffStrip(buffView(), buffActions));
}
// The character sheet's figures (sheet.mts's Attributes and Pools and its Properties card with the skills) for the manual suit: the
// character's own attributes with the suit's bonuses in place of what it wears in those slots (the sheet's
// now → after sum, drawn with the after figures only), or the items' totals alone with no character.
function statsCard(): HTMLElement {
  const name = manualCharacter();
  // Every worn piece is the base, so the character's own points are its totals less all it wears (a spellbook, a
  // second legs piece included) and the after side is exactly the manual suit: no worn piece rides along as an extra.
  const worn = name ? Object.fromEntries((state.inv!.worn[name] || []).map((i) => [`w${i.serial}`, i])) : {};
  const suit = suitItems();
  // With buffs counted, their in-cap shares count in the attributes, pools and properties, against the caps they
  // change; with none, the card is exactly the suit's. What they add past the cap to a property the strip doesn't
  // show (Horrific Beast's HPR) is said under the card.
  const t = totalsOf(suitOpt()), r = buffed(t, paperdollCaps(profileResistCaps(profile())));
  const added = Object.fromEntries(Object.keys(r.shares).filter((k) => !RESIST_KEYS.includes(k)).map((k) => [k, (r.totals[k] || 0) - (t[k] || 0)]));
  const counted = countBuffs && buffs.length;
  const { lists, props } = sheetParts(name, worn, suit, { compare: false, statsOnly: true, ...(counted ? { buffs: added, caps: r.caps } : {}) });
  const past = Object.keys(r.outside).filter((k) => !STRIP_KEYS.includes(k)).flatMap((k) => (r.shares[k] || []).filter((x) => x.outside).map((x) => `${label(k)} ${signed(x.value)} (${buffById(x.id)!.name})`));
  // The resists are the totals strip's; the attributes and pools (the character's own, so none with no character) are not.
  return box("div", { class: "sheet mb-stats", id: "mb-stats", role: "group", "aria-label": name ? `${name} in this suit` : "This suit's item totals" },
    name ? box("div", { class: "mb-kpis" }, ...lists) : null,
    past.length ? el("p", { class: "t-sm bf-past" }, `Past the cap from the buffs: ${past.join(", ")}`) : null, props);
}
function suitCard(): HTMLElement {
  const name = manualCharacter(), filled = Object.keys(slots).length, missing = missingSlots(slots, items).length;
  const worn = name ? button({ label: `Start from what ${name} wears`, size: "sm", attrs: { id: "mb-worn" }, onClick: () => { void startFromWorn(name); } }) : null;
  // "4 / 18", said in full to a screen reader and on hover
  const said = filled ? `${filled} of ${GEAR_SLOTS.length} slots filled${missing ? `, ${missing} missing from your scans` : ""}` : "Every slot is empty";
  const count = box("span", { class: `t-sm ellip ${missing ? "tone-warn" : "muted"}`, title: said }, txt(filled ? `${filled} / ${GEAR_SLOTS.length}${missing ? `, ${missing} missing` : ""}` : "Empty"), el("span", { class: "sr" }, ` (${said})`));
  const clear = filled ? button({ label: "Clear all", variant: "ghost", size: "sm", attrs: { id: "mb-clear" }, onClick: () => { void clearAll(); } }) : null;
  return el("section", { class: "card mb-suit", id: "mb-suit", "aria-label": "Suit" },
    box("div", { class: "card-head" }, el("h2", { tabindex: "-1" }, "Suit"), count, historyButton("undo"), historyButton("redo"), worn, clear),
    box("div", { class: "mb-suit-body" }, ...MANUAL_GROUPS.map((column) => box("div", { class: "mb-suit-col" },
      ...column.map(([title, group]) => box("div", { class: "mb-group", role: "group", "aria-label": title }, txt(title, "caps muted"), box("div", { class: "mb-grid" }, ...group.map(slotCard))))))));
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
  buffsOpen = false; replaced = null;
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
  $<HTMLElement>("#mb-hint")!.hidden = !!pickSlot || buffsOpen;
  $<HTMLElement>("#mb-buffs")!.hidden = !buffsOpen;
  if (buffsOpen) paintBuffPicker(buffView(), buffActions);
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
  const after = { ...cur, [slot]: toOptItem(it) }, afterItems: Record<string, Item> = { ...suitItems(), [slot]: it };
  const cleared = handConflict(slot, it, held());
  if (cleared) { delete after[cleared]; delete afterItems[cleared]; }
  const caps = paperdollCaps(profileResistCaps(prof)), was = buffed(paperdoll(totalsOf(cur), rsb), caps), now = buffed(paperdoll(totalsOf(after), rsb), caps, false, afterItems);
  const parts = slotDelta(was.totals, now.totals, deltaKeys(prof), now.caps);
  const kids = parts.flatMap((p, i) => [i ? txt(" · ", "faint") : null, txt(p.text, `tone-${p.tone}`)]);
  const worn = it.equippedBy ? tag(`Worn by ${it.equippedBy}`, it.equippedBy === manualCharacter() ? undefined : "warn") : null;
  return el("span", { class: "mb-delta" }, worn, it.gargoyle ? tag("Gargoyle") : null, ...(kids.length ? kids : [txt("No change", "muted")]));
}

// ---------------------------------------------------------------- the buffs
// Add buff opens the buff picker in the side column, in place of the slot picker; closing it gives Add buff the focus.
function openBuffs(): void {
  pickSlot = null;
  buffsOpen = true;
  draw();
  $<HTMLElement>("#mb-buffs")!.scrollIntoView({ block: "nearest" });
  focusBuffSearch();
}
function closeBuffs(): void {
  buffsOpen = false; replaced = null;
  draw();
  $<HTMLElement>("#bf-add")?.focus();
}
function buffView(): BuffView {
  const { values, planned, stats, race } = buffInputs(), t = paperdoll(totalsOf(suitOpt()), profile().resistBonus);
  return { name: manualCharacter(), on: buffs, values, planned, edits: editsFor(), stats, who: { race, weaponFlags: weaponFlags(suitItems()) }, totals: t, all: buffed(t, {}, true), replaced, count: countBuffs, open: buffsOpen };
}
const buffActions: BuffActions = {
  // A buff on or off is an undo step; a form turned on says which one it replaced. A chip's × keeps the focus in the
  // row: on the next chip, else Add buff.
  toggle: (id) => {
    const { next, replaced: off } = toggleBuff(buffs, id), name = buffById(id)!.name, on = next.includes(id);
    const chip = document.activeElement?.closest<HTMLElement>(".bf-strip .token");
    const after = chip ? (chip.nextElementSibling as HTMLElement | null)?.dataset.buff : undefined;
    commit({ buffs: next }, `${name} ${on ? "on" : "off"}`, off ? { on: id, off } : null);
    if (chip) ($<HTMLElement>(`.bf-strip .token[data-buff="${after}"] button`) ?? $<HTMLElement>("#bf-add"))?.focus();
  },
  setInput: (id, value) => {
    const key = manualCharacter() ?? NO_CHARACTER, { [id]: _was, ...rest } = editsFor();
    buffEdits = { ...buffEdits, [key]: value == null ? rest : { ...rest, [id]: value } };
    savePrefs({ buffSkills: buffEdits });
    refresh();
  },
  clear: () => commit({ buffs: [] }, "Clear buffs"),
  setCount: (on) => { countBuffs = on; savePrefs({ buffsCount: on ? "on" : "off" }); refresh(); },
  open: openBuffs,
  close: closeBuffs,
  // the replaced-form note's Undo: the form it replaced is back on, and its checkbox takes the focus
  undo: () => { const off = replaced?.off; stepHistory("undo"); if (off) document.getElementById(`bf-cb-${off}`)?.focus(); },
};
