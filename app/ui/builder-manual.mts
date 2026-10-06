// ui/builder-manual.mts — the Suit Builder's Manual mode (issue #12): an Automatic | Manual switch in the top bar,
// and in Manual a suit built by hand. The totals strip (resists, the casting and combat totals and the stats, each
// against its cap), the slot cards, and beside them the picker: one item browser (item-browser.mts) fixed to
// the selected slot, with a delta column saying what each row would change. A pick fills the slot and the picker
// stays on it, so piece after piece can be tried. The mode, "No character" and the suit (a serial per slot) are
// ui-prefs fields, so they survive a reload; a scan reload resolves the serials again, and one that no longer
// resolves shows as a missing card. The numbers come from ui/manual-model.mts. Buffs, abilities and forms (app/buffs.mts,
// drawn by ui/builder-buffs.mts) can be counted in the totals: the ones that are on, the numbers the player edited and
// the switch are ui-prefs fields too, and turning one on or off is a step in the suit's undo history.
import { GEAR_SLOTS, RESIST_KEYS, effectiveProfile, profileResistCaps, requirementReport, toOptItem, totalsOf } from "../vault-lib.mts";
import type { Character, EffectiveProfile, Item, OptItem, RunBuffs } from "../vault-lib.mts";
import { buffById, buffSkillValues, isBuffSkillsByCharacter, manualPlan, manualProfile, normalizeBuffs, ownEntry, rawStats, runBuffs, toggleBuff, weaponFlags, NO_CHARACTER, signed } from "../buffs.mts";
import type { Stats } from "../buffs.mts";
import { evaluateSuit, type SuitEvaluation } from "../evaluate.mts";
import type { ItemQuery } from "../item-query.mts";
import { state, invStamp } from "./store.mts";
import { $, el, label, slotLabel, itemTip, toast } from "./dom.mts";
import { box, txt, button, icon, segmented, tag, confirmDialog, modalOpen, tooltip, tipWrap, progress } from "./components.mts";
import { api } from "./api.mts";
import { prefs } from "./prefs.mts";
import { resolveItems, rarityToken } from "./items.mts";
import { closeCompare, fetchCard, grabAllButton, keyProps, verdict, RESIST_NAMES } from "./builder-result.mts";
import { capNote, knobError, paperdoll, paperdollCaps, plural, type KnobField } from "./builder-model.mts";
import { followJob, knobs, poolSettings, readControls, searchOpts, progressText } from "./builder.mts";
import { loadRuns, settingsSnapshot } from "./runs.mts";
import { optimizeErrorMessage } from "./messages.mts";
import { itemActions } from "./item-parts.mts";
import { sheetParts, wornSet } from "./sheet.mts";
import { createItemBrowser } from "./item-browser.mts";
import type { ItemBrowser } from "./item-browser.mts";
import type { UiPrefs, OptimizeResult, OptimizeStartApiResponse, OptSuit } from "./api-types.mts";
import { MANUAL_GROUPS, emptyHistory, record, undoStep, redoStep, historyKey, historyKeyNames, type History, type Suit, TOTAL_KEYS, STAT_KEYS, STRIP_KEYS, capped, capLine, slotQuery, handConflict, handNote, suitFrom, fillableSlots, fetchPieces, fillPicks, keptSlots, listWords, applyEditStep, type FillStart, type EditStep, type Reslot, savedSlots, missingSlots, reslotted, reslotNote, deltaKeys, slotDelta } from "./manual-model.mts";
import { buffMarker, buffStrip, createBuffPicker, keepChipFocus, type BuffActions, type BuffPicker, type BuffView } from "./builder-buffs.mts";

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
let buffPicker: BuffPicker | null = null;
let replaced: { on: string; off: string } | null = null;
// The suit's undo history, its steps holding the suit and its buffs (in memory: a reload starts a new one; another
// character keeps it, the suit is shared).
// A step that also changed the Count buffs switch or some buff numbers (Open in Manual) carries them too, so undo puts
// them back: the numbers as only the ones it set, for one character (null: back to its own), and a number edited since
// is left as edited (manual-model.mts applyEditStep). Other steps leave them out.
interface Snapshot { slots: Suit; buffs: string[]; count?: boolean; edits?: EditStep }
let history: History<Snapshot> = emptyHistory();
const MAC = /Mac|iPhone|iPad/.test(navigator.platform), KEY_NAMES = historyKeyNames(MAC);

// ---------------------------------------------------------------- prefs and the mode
// load()'s GET /api/ui-prefs answer (null when that request failed).
export function applyBuilderPrefs(prefs: UiPrefs | null): void {
  mode = prefs?.builderMode === "manual" ? "manual" : "automatic";
  noCharacter = prefs?.manualFor === "none";
  slots = savedSlots(prefs?.manualSuit);
  // healed (normalizeBuffs): a hand-edited file's second form replaces the first, and the list is in catalog order
  buffs = normalizeBuffs(prefs?.manualBuffs) ?? [];
  buffEdits = isBuffSkillsByCharacter(prefs?.buffSkills) ? prefs.buffSkills : {};
  countBuffs = prefs?.buffsCount !== "off";
  synced = false;
  if (seg) showMode();
}
// The Suit Builder's choices into ui-prefs, for both modes.
export const savePrefs = (body: UiPrefs): void => prefs.set(body);
const isManual = (): boolean => mode === "manual";
// The character whose bonuses Manual's totals take: the builder's own, unless "No character" is picked.
const manualCharacter = (): string | null => (noCharacter ? null : state.builder.character);

// Once, from initBuilder(): the mode switch beside the title, and Manual's screen.
export function initManual(): void {
  seg = segmented({ label: "Builder mode", options: [{ value: "automatic", label: "Automatic" }, { value: "manual", label: "Manual" }], value: mode, size: "md",
    onChange: (v) => setMode(v as Mode) });
  seg.id = "b-mode";
  $<HTMLElement>("#h-builder")!.after(seg);
  const root = $<HTMLElement>("#b-manual")!;
  // Esc closes the picker (or the buff picker) from anywhere on the screen (a slot card, a row, the search, the bare
  // page after a click on text) and gives its slot card (or Add buff) the focus; a popover, a drawer, a dialog or a
  // search being cleared keeps its own Esc.
  $<HTMLButtonElement>("#mb-picker-close")!.onclick = closePicker;
  buffPicker = createBuffPicker($<HTMLElement>("#mb-buffs")!, "bf", buffActions, (v) =>
    (v.count ? "The totals, the stats and every slot's Change column count the buffs that are on." : "Count buffs in the totals is off: the totals leave the buffs out."));
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
  paintCharSelect();
  if (manual) void syncManual();
}
function setMode(m: Mode): void {
  if (mode === m) return;
  mode = m;
  savePrefs({ builderMode: mode });
  showMode();
}
// A saved run opened or compared from Manual's runs drawer is shown in Automatic's result view.
export const showAutomatic = (): void => setMode("automatic");
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
  const moved = reslotted(slots, found);   // a piece saved under a slot the classifier has since changed
  if (moved.slots !== slots) { slots = moved.slots; savePrefs({ manualSuit: slots }); sayDropped(moved); }
  draw();
  if (browser) { browser.sync(); if (pickSlot) browser.fetch(); }
}
// A piece a slot change pushed out of the suit, said once (manual-model.mts reslotted).
function sayDropped({ slots: suit, dropped }: Reslot): void {
  const lines = dropped.map(({ serial, slot }) => reslotNote(items[serial]?.name || "A piece", slotLabel(slot), items[suit[slot]!]?.name || "another piece"));
  if (lines.length) toast(lines.join(" "));
}
// Every filled slot for the hand rule: a piece no longer in the scans still fills its hand.
const held = (suit = slots): Record<string, Item | Record<string, never>> => Object.fromEntries(Object.entries(suit).map(([s, serial]) => [s, items[serial] ?? {}]));
const suitOpt = (): Record<string, OptItem> => Object.fromEntries(Object.entries(slots).flatMap(([s, serial]) => (items[serial] ? [[s, toOptItem(items[serial]!)]] : [])));
function profile(): EffectiveProfile {
  const name = manualCharacter();
  return name && state.builder.profile ? effectiveProfile(state.builder.profile, state.inv!.characters[name] as Character) : effectiveProfile({}, null);
}
// A character's buff numbers (or No character's, for null) with its edits, which inputs are planned, the raw stats
// Bless takes a share of (the scanned stats less what the character wears) and the race. Automatic reads them too:
// the edits are one set per character, shared by both modes. Manual works them out once per draw: every row's
// Change cell reads them.
export type BuffInputs = { values: Record<string, number>; planned: Set<string>; stats: Stats | null; race: string | null };
let inputsMemo: BuffInputs | null = null;
export const buffEditsOf = (name: string | null): Record<string, number> => ownEntry(buffEdits, name ?? NO_CHARACTER) || {};
const editsFor = (): Record<string, number> => buffEditsOf(manualCharacter());
export function buffInputsOf(name: string | null): BuffInputs {
  const c = name ? state.inv!.characters[name] : null;
  const { values, planned } = buffSkillValues(c ? c.skills || {} : null, buffEditsOf(name));
  if (!name || !c) return { values, planned, stats: null, race: null };
  return { values, planned, stats: rawStats(c as Character, totalsOf(wornSet(name))), race: state.profiles?.characters?.[name]?.race || "human" };
}
const buffInputs = (): BuffInputs => (inputsMemo ||= buffInputsOf(manualCharacter()));
// Buff numbers edited for a character (null: back to its own skill, or the default), saved for both modes.
export function editBuffInputs(name: string | null, values: Readonly<Record<string, number | null>>): void {
  const next = { ...buffEditsOf(name) };
  for (const [id, value] of Object.entries(values)) { if (value == null) delete next[id]; else next[id] = value; }
  buffEdits = { ...buffEdits, [name ?? NO_CHARACTER]: next };
  inputsMemo = null;
  savePrefs({ buffSkills: buffEdits });
}
// A saved run's buff numbers, where they differ from the character's now, so its buffs count as they did.
export function applyRunInputs(name: string | null, b: RunBuffs | undefined): void {
  const edits = runInputEdits(name, b);
  if (Object.keys(edits).length) editBuffInputs(name, edits);
}
function runInputEdits(name: string | null, b: RunBuffs | undefined): Record<string, number> {
  const now = buffInputsOf(name).values, used = new Set((b?.on ?? []).flatMap((id) => buffById(id)!.inputs));
  return Object.fromEntries([...used].filter((i) => b!.skills[i] != null && b!.skills[i] !== now[i]).map((i) => [i, b!.skills[i]!]));
}
// The suit's pieces by slot (a piece no longer in the scans left out), and the held weapon's flags: a two-handed
// weapon, else the one-handed slot's piece (Enchant reads its Spell Channeling).
const suitItems = (): Record<string, Item> => Object.fromEntries(Object.entries(slots).flatMap(([s, serial]) => (items[serial] ? [[s, items[serial]!]] : [])));
// The suit evaluated as the strip shows it (app/evaluate.mts): paperdoll terms, against profile()'s caps, with the buffs
// that count (all that are on, or none with the switch off), Enhance Potions and Spell Channeling read from `suit`.
function evaluated(suit: Record<string, Item> = suitItems(), all = false): SuitEvaluation {
  const name = manualCharacter(), c = name ? (state.inv!.characters[name] as Character | undefined) ?? null : null, own = !!name && !!state.builder.profile;
  const opt = Object.fromEntries(Object.entries(suit).map(([s, it]) => [s, toOptItem(it)]));
  return evaluateSuit({ profile: own ? state.builder.profile! : {}, character: own ? c : null, suit: opt,
    buffs: manualPlan(c, name ? state.inv!.worn[name] || [] : [], suit, buffInputs().race, countBuffs || all ? buffs : [], editsFor()) });
}
// Every change to the suit or its buffs is one undo step, named by `label` ("Ring → Arcane Ring", "Divine Fury on");
// undo and redo pass none, and `from`, the step's other side (the numbers it expects to find). `note` is the form a
// turned-on form replaced, said in the buff picker until the next change.
function commit(next: Partial<Snapshot>, label: string | null, note: typeof replaced = null, from: Snapshot | null = null): void {
  const e = next.edits, was: EditStep | undefined = e && { who: e.who, values: Object.fromEntries(Object.keys(e.values).map((k) => [k, ownEntry(buffEdits, e.who)?.[k] ?? null])) };
  const after: Snapshot = { slots: next.slots ?? slots, buffs: next.buffs ?? buffs, ...(next.count != null ? { count: next.count } : {}), ...(e ? { edits: e } : {}) };
  if (label) history = record(history, { slots, buffs, ...(next.count != null ? { count: countBuffs } : {}), ...(was ? { edits: was } : {}) }, after, label);
  const edits = e ? applyEditStep(buffEdits, e.who, (from?.edits ?? was)!.values, e.values) : buffEdits;
  const changed = { ...(after.slots !== slots ? { manualSuit: after.slots } : {}), ...(after.buffs !== buffs ? { manualBuffs: after.buffs } : {}),
    ...(after.count != null && after.count !== countBuffs ? { buffsCount: after.count ? "on" as const : "off" as const } : {}), ...(edits !== buffEdits ? { buffSkills: edits } : {}) };
  if (Object.keys(changed).length) savePrefs(changed);
  slots = after.slots; buffs = after.buffs; replaced = note; fillNote = null;
  if (after.count != null) countBuffs = after.count;
  buffEdits = edits;
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
  commit(next, null, null, kind === "undo" ? r.step.after : r.step.before);
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
  if (fill && fill.start.who !== manualCharacter()) cancelFill("Fill canceled: the character changed");
  if (!isManual() || !state.inv || syncing || !synced) return;
  refresh();
}
function draw(): void {
  inputsMemo = null;
  const cancelFocused = document.activeElement?.id === "mb-fill-cancel";
  const root = $<HTMLElement>("#b-manual")!;
  root.querySelector("#mb-totals")!.replaceWith(totalsCard());
  root.querySelector("#mb-suit")!.replaceWith(suitCard());
  root.querySelector("#mb-stats")!.replaceWith(statsCard());
  root.querySelector("#mb-fetch")!.replaceWith(fetchList());
  paintPicker();
  if (cancelFocused) $<HTMLElement>("#mb-fill-cancel")?.focus();   // a change made during a fill redraws the row
}
function totalsCard(): HTMLElement {
  const name = manualCharacter(), prof = profile(), resists = profileResistCaps(prof), base = paperdollCaps(resists);
  const suit = suitOpt(), ev = evaluated(), r = ev.buffs, t = ev.effectiveTotals, caps = ev.caps;
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
  const ev = evaluated(), t = ev.gearTotals, r = ev.buffs;
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
    // the search for the empty slots and Save as run, then the search's progress or its outcome
    box("div", { class: "mb-suit-acts" }, fillButton(missing), saveButton(missing), fill || fillNote ? fillLine() : null),
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
  if (buffsOpen) buffPicker!.paint(buffView());
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
  const slot = pickSlot!, prof = profile(), afterItems: Record<string, Item> = { ...suitItems(), [slot]: it };
  const cleared = handConflict(slot, it, held());
  if (cleared) delete afterItems[cleared];
  const was = evaluated(), now = evaluated(afterItems);
  const parts = slotDelta(was.effectiveTotals, now.effectiveTotals, deltaKeys(prof), now.caps);
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
  buffPicker!.focusSearch();
}
function closeBuffs(): void {
  buffsOpen = false; replaced = null;
  draw();
  $<HTMLElement>("#bf-add")?.focus();
}
function buffView(): BuffView {
  const { values, planned, stats, race } = buffInputs(), prof = profile(), t = paperdoll(totalsOf(suitOpt()), prof.resistBonus), caps = paperdollCaps(profileResistCaps(prof));
  return { name: manualCharacter(), on: buffs, values, planned, edits: editsFor(), stats, who: { race, weaponFlags: weaponFlags(suitItems()) }, totals: t, caps, all: evaluated(suitItems(), true).buffs, replaced, count: countBuffs, open: buffsOpen };
}
const buffActions: BuffActions = {
  // A buff on or off is an undo step; a form turned on says which one it replaced. A chip's × keeps the focus in the
  // row: on the next chip, else Add buff.
  toggle: (id) => keepChipFocus(".bf-strip", "bf-add", () => {
    const { next, replaced: off } = toggleBuff(buffs, id), name = buffById(id)!.name, on = next.includes(id);
    commit({ buffs: next }, `${name} ${on ? "on" : "off"}`, off ? { on: id, off } : null);
  }),
  setInput: (id, value) => { editBuffInputs(manualCharacter(), { [id]: value }); refresh(); },
  clear: () => commit({ buffs: [] }, "Clear buffs"),
  setCount: (on) => { countBuffs = on; savePrefs({ buffsCount: on ? "on" : "off" }); refresh(); },
  open: openBuffs,
  close: closeBuffs,
  // the replaced-form note's Undo: the form it replaced is back on, and its checkbox takes the focus
  undo: () => { const off = replaced?.off; stepHistory("undo"); if (off) document.getElementById(`bf-cb-${off}`)?.focus(); },
};

// ---------------------------------------------------------------- fill the rest, save as run, the fetch list
// "Fill the rest automatically": the search for the empty slots (POST /api/optimize with `pinned`, the suit as it is).
// Every placed piece stays; the rest is planned with the Automatic panel's requirements, weights, pool settings and
// resist caps and the buffs Manual's totals count. With No character it plans on Manual's raw item totals (no
// Resisting Spells, race or stat headroom) from the pieces nobody wears. One search at a time, with Cancel;
// Automatic's Build waits for it.
interface Fill { id: string | null; es: EventSource | null; prof: EffectiveProfile; start: FillStart; text: string; frac: number }
let fill: Fill | null = null;
let fillUi: { text: HTMLElement; bar: ReturnType<typeof progress> } | null = null;
// The last search's outcome, under the suit card's head until the next change.
let fillNote: { text: string; tone: "ok" | "warn" | "bad" | "muted" } | null = null;
export const filling = (): boolean => !!fill;
// What a fill is checked against when it lands (manual-model.mts fillPicks): whose suit, the counted buffs, the suit,
// and what it plans with (the profile, buff numbers included, and the pool settings).
const fillNow = (): Omit<FillStart, "empty"> => ({ who: manualCharacter(), buffs: countBuffs ? buffs : [], suit: slots, plan: JSON.stringify([fillProfile(), poolSettings()]) });
const fillable = (): string[] => fillableSlots(slots, slots.twoHanded != null && !!items[slots.twoHanded]?.twoHanded);
function fillProfile(): EffectiveProfile {
  const name = manualCharacter();
  return manualProfile(readControls(), name ? (state.inv!.characters[name] as Character | undefined) ?? null : null, name ? state.inv!.worn[name] || [] : [], suitItems(), buffInputs().race, countBuffs ? buffs : [], editsFor());
}
async function fillRest(): Promise<void> {
  if (fill || state.builder.job) return;
  const f: Fill = { id: null, es: null, prof: fillProfile(), start: { ...fillNow(), empty: fillable() }, text: "Starting…", frac: 0 };
  fill = f; fillNote = null;
  draw();
  $<HTMLElement>("#mb-fill-cancel")?.focus();
  let r: OptimizeStartApiResponse;
  try { r = await api<OptimizeStartApiResponse>("/api/optimize", { method: "POST", body: { character: manualCharacter(), settings: poolSettings(), profile: f.prof, opts: searchOpts(), pinned: slots } }); }
  catch (e) { if (fill === f) endFill({ text: optimizeErrorMessage(e), tone: "bad" }); return; }
  if (fill !== f) { if (r.id) api(`/api/optimize/${r.id}/cancel`, { method: "POST" }).catch(() => {}); return; }   // canceled while the request was in flight
  f.id = r.id!;
  f.es = followJob(f.id, {
    progress: (p) => { ({ text: f.text, frac: f.frac } = progressText(p)); paintFill(); },
    done: (d) => { if (fill === f) void landFill(f, d.result); },
    failed: (error) => { if (fill === f) endFill({ text: error, tone: "bad" }); },
    cancelled: () => { if (fill === f) endFill({ text: "Fill canceled.", tone: "muted" }); },
  });
}
function cancelFill(text = "Fill canceled."): void {
  if (!fill) return;
  if (fill.id) api(`/api/optimize/${fill.id}/cancel`, { method: "POST" }).catch(() => {});
  endFill({ text, tone: "muted" });
}
// The search ended: its outcome under the head, said to a screen reader, and Cancel's focus to the fill button.
function endFill(note: NonNullable<typeof fillNote>): void {
  const hadFocus = document.activeElement?.id === "mb-fill-cancel";
  fill?.es?.close(); fill = null; fillUi = null;
  fillNote = note;
  draw();
  $<HTMLElement>("#mb-live")!.textContent = note.text;
  if (hadFocus) $<HTMLElement>("#mb-fill")?.focus();
}
// The suit found, into the slots still empty (a piece placed meanwhile stays, and so does a hand the rule would clear)
// as one undo step, with the verdict and the requirements the filled suit still misses.
async function landFill(f: Fill, res: OptimizeResult): Promise<void> {
  const want = fillPicks(f.start, fillNow(), res.best);
  const found = "picks" in want ? await resolveItems(Object.values(want.picks)) : {};
  if (fill !== f) return;
  const r = fillPicks(f.start, fillNow(), res.best);   // checked again: the suit may have changed while the pieces resolved
  if ("stale" in r) { f.id = null; cancelFill(r.stale); return; }
  const next = { ...slots };
  for (const [s, serial] of Object.entries(r.picks)) {
    const it = found[serial];
    if (it && !handConflict(s, it, held(next))) { next[s] = it.serial; items[it.serial] = it; }
  }
  const n = Object.keys(next).length - Object.keys(slots).length;
  const gear = Object.fromEntries(GEAR_SLOTS.flatMap((s) => (next[s] != null && items[next[s]!] ? [[s, toOptItem(items[next[s]!]!)]] : [])));
  const short = requirementReport(totalsOf(gear), f.prof).filter((r) => r.met === false).map((r) => label(r.key));
  // the requirements still missed, else how sure the search is (a proof here is about the empty slots only)
  const v = res.method === "exact" && res.proven ? "best for the empty slots" : verdict(res).text.toLowerCase();
  const text = [n ? `Filled ${plural(n, "slot")}` : "Nothing filled: no piece in the pool improves the suit", short.length ? `short of ${short.join(", ")}` : v].filter(Boolean).join(" · ");
  if (n) commit({ slots: next }, `Fill the rest: ${plural(n, "slot")}`);
  endFill({ text, tone: short.length ? "warn" : n ? "ok" : "muted" });
}
function fillButton(missing: number): HTMLElement {
  const open = fillable().length;
  const why = fill ? null : !state.builder.profile ? "Import a scan first: the search plans with a character's settings"
    : state.builder.job ? "A build is running in Automatic" : missing ? "Clear the missing pieces first" : !open ? "Every slot the search fills is taken" : null;
  const b = button({ label: fill ? "Filling…" : "Fill the rest automatically", icon: "builder", variant: "primary", size: "sm", disabled: !!fill || !!why, attrs: { id: "mb-fill" }, onClick: () => { void fillRest(); } });
  return why ? tipWrap(b, why) : fill ? b : tooltip(b, `Searches ${plural(open, "empty slot")} with Automatic's requirements and weights, keeping every piece placed here.`);
}
// While searching: a busy dot, what the search is at, a bar and Cancel; after it, its outcome.
function fillLine(): HTMLElement {
  if (!fill) return box("div", { class: "mb-fill" }, txt(fillNote!.text, `t-sm ${fillNote!.tone === "muted" ? "muted" : `tone-${fillNote!.tone}`}`));
  fillUi = { text: txt(fill.text, "t-sm"), bar: progress(fill.frac * 1000, 1000, "Fill progress") };
  return box("div", { class: "mb-fill", role: "group", "aria-label": "Filling the empty slots" }, el("span", { class: "dot busy", role: "img", "aria-label": "Searching" }),
    fillUi.text, fillUi.bar, button({ label: "Cancel", size: "sm", attrs: { id: "mb-fill-cancel" }, onClick: () => cancelFill() }));
}
function paintFill(): void {
  if (!fill || !fillUi) return;
  fillUi.text.textContent = fill.text;
  fillUi.bar.set(Math.round(fill.frac * 1000));
}

// "Save as run": the suit as a run in the character's Saved runs (POST /api/runs, method "manual"), with the panel's
// settings and the buffs the totals count.
function saveButton(missing: number): HTMLElement {
  const name = manualCharacter();
  const why = !name ? "Choose a character to save a run for" : missing ? "Clear the missing pieces first" : !Object.keys(slots).length ? "Place a piece first" : null;
  const b = button({ label: "Save as run", size: "sm", disabled: !!why, attrs: { id: "mb-save-run" }, onClick: () => { void saveAsRun(name!); } });
  return why ? tipWrap(b, why) : b;
}
// The search knobs a run's settings carry (the STR limit is the profile's last good one), by the Advanced field's name.
const RUN_KNOBS: Array<[KnobField, string]> = [["restarts", "Restarts"], ["budgetS", "Time budget"], ["altCount", "Other suits"], ["altTol", "Within points"]];
async function saveAsRun(name: string): Promise<void> {
  // a knob typed out of range in Automatic would be saved with the run, so it is said here rather than refused there
  const bad = RUN_KNOBS.find(([f]) => knobError(f, knobs[f]));
  if (bad) { toast(`Automatic's ${bad[1]} field reads "${knobs[bad[0]]}": ${knobError(bad[0], knobs[bad[0]])} Fix it under Advanced to save a run.`, "bad"); return; }
  const settings = { ...settingsSnapshot(), buffs: runBuffs(countBuffs ? buffs : [], buffInputs().values) };
  try { await api("/api/runs", { method: "POST", body: { character: name, suit: slots, settings, inventoryStamp: invStamp() } }); }
  catch (e) { toast(`Could not save the run: ${(e as Error).message}`, "bad"); return; }
  toast(`Saved to ${name}'s runs as a manual suit.`, "good");
  void loadRuns();
}

// A suit from Automatic (a result, a saved run) into Manual as one undo step: each slot it plans takes its piece or is
// emptied, the others keep theirs, and the buffs it was planned with are turned on with their numbers, so the totals
// match it. Manual opens on the same character.
export async function openInManual(suit: OptSuit, covered: readonly string[], runB: RunBuffs | undefined, label: string): Promise<void> {
  cancelFill("Fill canceled: another suit was opened");
  const planned = suitFrom(slots, suit, covered);
  Object.assign(items, await resolveItems(Object.values(planned)));   // drawn whole at once: no piece flashes up as missing
  // a run saved before the classifier moved one of its pieces: the piece in its slot now
  const moved = reslotted(planned, items), next = moved.slots, kept = keptSlots(next, covered);
  sayDropped(moved);
  if (noCharacter) { noCharacter = false; savePrefs({ manualFor: "character" }); }
  // the run's buffs (none for a run without), counted, with the numbers they took: all in the same undo step
  const name = manualCharacter(), runEdits = runInputEdits(name, runB);
  const edits: EditStep | undefined = Object.keys(runEdits).length ? { who: name ?? NO_CHARACTER, values: runEdits } : undefined;
  synced = true;
  commit({ slots: next, buffs: runB?.on ?? [], ...(runB ? { count: true } : {}), ...(edits ? { edits } : {}) }, label);
  setMode("manual");
  paintCharSelect();
  $<HTMLElement>("#mb-suit h2")?.focus();
  // a run saved while the optimizer searched only twelve slots: say which of Manual's other pieces stayed
  const keptText = kept.length ? ` Kept your ${listWords(kept.map(slotLabel))} ${kept.length === 1 ? "piece" : "pieces"}.` : "";
  toast(`Opened in Manual.${keptText} ${KEY_NAMES.undo} puts back the suit you had.`);
}

// The fetch list for the suit's pieces the character doesn't wear (the result's, builder-result.mts fetchCard).
function fetchList(): HTMLElement {
  const name = manualCharacter(), pieces = fetchPieces(Object.values(suitItems()), name), card = fetchCard(pieces, name, grabAllButton(pieces, name, { id: "mb-grab-all", size: "sm" }));
  if (!card) return el("div", { id: "mb-fetch", hidden: "" });
  card.id = "mb-fetch";
  return card;
}
