// ui/builder.mts — the Suit Builder screen (design spec 4.6): the character select in the top bar, the 360 px
// constraints panel (template, race, requirements, weights, candidate pool, Advanced) with its sticky Build
// footer, the optimize job (inline progress card over SSE) and the empty state (the character's current
// suit). The result, the compare view and the Solver details are ui/builder-result.mts; the saved-runs drawer
// is ui/runs.mts; they share the builder's state and call each other through ui/builder-session.mts. The panel is drawn
// from the session's profile plus its Advanced knobs, so what a build sends, what a profile saves and what a run
// snapshots are read from state, never from the DOM.
import { PROP_LABELS, NOT_BUILDER_KEYS, GEAR_SLOTS, tagUnits, WEAPON_SKILLS, MELEE_SKILLS, resistSkillBonus, getRules, RESIST_KEYS, RESIST_CAP_LIMITS, resistCapsFor, templateFrom, settingsDiff, bagLabel } from "../vault-lib.mts";
import { BUILTIN_PREFIX, characterBuffs, characterEntry, characterProfile, findTemplate, planBuild, specFromProfile, templateLabel, templateRefs, templateSettings, templateSpecFrom, type PlannedBuild } from "../build-spec.mts";
import type { ResistCap, RunBuffs, Character } from "../vault-lib.mts";
import { buffById, gearNeedsText, overrideNote, planBuffs, normalizeBuffs, runBuffs, toggleBuff, buffPlanOf, type BuffPlan } from "../buffs.mts";
import { defaultStrLimit } from "../run-settings.mts";
import { evaluateSuit } from "../evaluate.mts";
import { state, invStamp } from "./store.mts";
import type { BuilderJob, BuilderJobUi, FinishedBuild, BuildMeta } from "./store.mts";
import { $, el, label, full, fmtN, fmtSecs, slotLabel, toast } from "./dom.mts";
import { promptText } from "./dialog.mts";
import { box, txt, button, icon, kbd, badge, message, select, input, field, switchControl, check, segmented, filterChip, pill, popover, closePopover, menu, searchInput, stepper, progress, tooltip, confirmDialog, modalOpen } from "./components.mts";
import { api } from "./api.mts";
import { buffChip, createBuffPicker, keepChipFocus, type BuffPicker, type BuffView, type PickerActions } from "./builder-buffs.mts";
import { optimizeErrorMessage } from "./messages.mts";
import { parseRoute, registerScreen, routeFor } from "./nav.mts";
import { setNavBusy } from "./shell.mts";
import { putProfiles, setCharacterBuffs } from "./profiles.mts";
import { session, commands, provide, readControls } from "./builder-session.mts";
import { followJob, progressText } from "./builder-parts.mts";
import { paperdoll, propName, weightsSummary, requirementsSummary, poolSummary, advancedSummary, knobError, firstKnobError, knobFromServerError, ruleValueError, resistCapError, withResistCap, capNote, resistCapsSummary, gearCapsText, pruneResistCaps, floorCapWarning, weaponsChipText, weaponName, toggleWeapon, type KnobField } from "./builder-model.mts";
import type { OptimizeResult, SavedRunLike, OptimizeStartApiResponse, OptimizeCancelApiResponse } from "./api-types.mts";

// ---------------------------------------------------------------- panel state
// The solver knobs as typed (ui/builder-session.mts), and which sections are open.
const knobs = session.knobs;
const open: Record<string, boolean> = { buffs: true, req: true, caps: false, weights: false, pool: true, adv: false };
// A requirement or weight row's property name: up to two lines, the full name in its title.
const ruleName = (nm: string): HTMLSpanElement => { const t = txt(nm, "rule-name"); t.title = nm; return t; };
// A resist cap typed out of range, as typed (the profile keeps the last good cap): kept here rather than read back
// from the field so the section can close and reopen, and Build still refuses it with the section closed.
const capDrafts: Record<string, string> = {};
// A new set of caps (another character, a template or a saved run's settings applied) replaces anything typed.
function clearCapDrafts(): void { for (const k of Object.keys(capDrafts)) delete capDrafts[k]; }
const KNOB_IDS: Record<KnobField, string> = { strLimit: "b-str", restarts: "b-restarts", budgetS: "b-budget", altCount: "b-altcount", altTol: "b-alttol" };

// ---------------------------------------------------------------- wiring
// The builder's listeners, attached once for the page's life (app.mts's load()). Everything that depends on
// the inventory is syncBuilderCharacters()'s job, which runs on every load and refresh.
export function initBuilder(): void {
  // Manual's "No character" is the empty value; a character is selected for both modes.
  $<HTMLSelectElement>("#b-char")!.onchange = () => {
    const v = $<HTMLSelectElement>("#b-char")!.value;
    commands.setManualFor(v || null);
    if (v && v !== session.character) selectCharacter(v);   // back from "No character" to the same one keeps its panel and result
  };
  $<HTMLButtonElement>("#b-run")!.onclick = runBuild;
  $<HTMLButtonElement>("#b-save")!.onclick = saveProfile;
  $<HTMLButtonElement>("#b-runs-open")!.onclick = () => commands.openRunsDrawer();
  // ⌘↵ (Ctrl+Enter off the Mac) builds from anywhere on the screen. Listened for on the document, not the
  // screen: after a click on blank space focus is on <body>, outside #tab-builder, so a listener there never
  // heard the key. It does what pressing Build would, and nothing while the button is disabled (no character,
  // a build running), not showing (another screen, the compare view) or behind a drawer or dialog.
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key !== "Enter") return;
    const run = $<HTMLButtonElement>("#b-run")!;
    if (run.disabled || session.job || !run.getClientRects().length || run.closest("[inert]") || modalOpen()) return;
    e.preventDefault();
    runBuild();
  });
  const toggle = $<HTMLButtonElement>("#b-panel-toggle")!;
  toggle.onclick = () => {
    const folded = $<HTMLElement>("#b-panel")!.classList.toggle("folded");
    toggle.setAttribute("aria-expanded", String(!folded));
    toggle.querySelector("svg")?.replaceWith(icon(folded ? "chevron-down" : "chevron-up", { size: "sm" }));
  };
}
// The character list after the inventory or profiles changed (a first load, a scan landing, a Forget).
// A character still present stays selected and keeps its panel, unsaved edits included; the panel is redrawn
// so a newly scanned chest or gear skill is offered. Only when the selection is gone (or there was none) does
// it move: to the route's character, else the first.
document.addEventListener("inventorychange", () => syncBuilderCharacters());
// #/builder/<Name>: the route's character once the inventory is in; with no name, the route takes the selected one.
registerScreen({ name: "builder", show: (r) => {
  if (!state.inv) return;
  if (r.character && r.character !== session.character && state.inv.characters[r.character]) selectCharacter(r.character);
  else if (!r.character && session.character) history.replaceState(null, "", routeFor("builder"));
} });
export function syncBuilderCharacters(): void {
  const names = [...new Set([...Object.keys(state.inv!.characters), ...Object.keys(state.profiles!.characters || {})])];
  const keep = session.character;
  $<HTMLSelectElement>("#b-char")!.replaceChildren(...names.map((n) => el("option", { value: n }, n)));
  if (keep && names.includes(keep) && session.profile) {
    $<HTMLSelectElement>("#b-char")!.value = keep;
    renderPanel();
    if (!session.result && !session.job) commands.renderCurrentSuit(keep);
  } else if (names.length) {
    const want = parseRoute().character;
    selectCharacter(names.includes(want as string) ? want as string : names[0]!);
  } else {
    session.character = null; session.profile = null;
    $<HTMLElement>("#b-panel-body")!.replaceChildren(el("p", { class: "muted b-no-char", id: "b-no-char" }, txt(NO_CHARACTER)));
    $<HTMLElement>("#b-result")!.replaceChildren(box("div", { class: "card empty-state" }, el("h2", { class: "t-lg" }, "No characters yet"), el("p", { class: "muted" }, txt("Import a scan and its character shows up here."))));
  }
  setNoCharacter(!names.length);
  commands.paintCharSelect();
  void commands.syncManual();
}
// With no character there is nothing to build or save: both buttons are disabled, and say why — in their
// title, and in the panel's own line that they are described by.
const NO_CHARACTER = "There is no character to build for yet. Import a scan first.";
function setNoCharacter(none: boolean): void {
  for (const id of ["#b-run", "#b-save"]) {
    const b = $<HTMLButtonElement>(id)!;
    if (!session.job) b.disabled = none;
    if (none) { b.title = NO_CHARACTER; b.setAttribute("aria-describedby", "b-no-char"); }
    else { b.removeAttribute("title"); b.removeAttribute("aria-describedby"); }
  }
}
export function selectCharacter(name: string): void {
  session.character = name;
  if (parseRoute().tab === "builder") history.replaceState(null, "", routeFor("builder"));
  session.profile = characterProfile(state.profiles!, name, state.builtinTemplates);
  session.profile!.excludeRoots ??= [];
  clearCapDrafts();
  $<HTMLSelectElement>("#b-char")!.value = name;
  const c = state.inv!.characters[name];
  knobs.strLimit = String(session.profile!.strLimit ?? defaultStrLimit(c));
  renderPanel();
  session.compare = new Set(); session.openRun = null; session.result = null;
  commands.closeCompare();
  commands.resetResultView();   // a result still resolving its pieces for the previous character must not draw now
  if (!session.job) $<HTMLElement>("#b-msg")!.replaceChildren();   // a running build keeps its progress card
  // A build that finished while another character was on screen waits here for its own character.
  const parked = session.parked;
  if (parked?.name === name) { session.parked = null; showFinished(parked); }
  else commands.renderCurrentSuit(name);
  commands.loadRuns();
  commands.paintCharSelect();
  commands.renderManual();
}

// ---------------------------------------------------------------- the panel
function renderPanel(): void {
  const p = session.profile;
  if (!p) return;
  p.floors ||= {}; p.softFloors ||= []; p.weights ||= {}; p.lockedSlots ||= []; p.excludeTags ||= []; p.excludeSkills ||= []; p.excludeRoots ||= [];
  $<HTMLElement>("#b-panel-body")!.replaceChildren(templateSection(), buffsSection(), requirementsSection(), capsSection(), weightsSection(), poolSection(), advancedSection());
  updateTemplateBadge();
}
// Redraw one section in place (its open state or its rows changed), keeping the rest of the panel and its
// scroll position as they are.
function redraw(id: string): void {
  const build: Record<string, () => HTMLElement> = { buffs: buffsSection, req: requirementsSection, caps: capsSection, weights: weightsSection, pool: poolSection, adv: advancedSection };
  const old = document.getElementById(`b-sec-${id}`);
  if (old && build[id]) old.replaceWith(build[id]!());
  updateTemplateBadge();
}
// A collapsible section: title, an optional count badge, the open/close button, and when closed a one-line
// summary in place of its body.
// Each section's count badge, kept so a count can change without the section being redrawn (setCount).
const counts: Record<string, HTMLSpanElement> = {};
const setCount = (id: string, n: number): void => { counts[id]?.replaceChildren(txt(String(n))); };
function section(id: string, title: string, { count, summary, body, inline = false }: { count?: number | undefined; summary: () => string; body: () => Array<Node | null>; inline?: boolean }): HTMLElement {
  const isOpen = open[id], hid = `b-sec-${id}-h`, bid = `b-sec-${id}-body`;
  const cnt = count != null ? badge(String(count)) : null;
  if (cnt) counts[id] = cnt; else delete counts[id];
  const t = button({ label: `${isOpen ? "Collapse" : "Expand"} ${title.toLowerCase()}`, icon: isOpen ? "chevron-up" : "chevron-down", iconOnly: true, variant: "ghost", size: "sm",
    attrs: { "aria-expanded": String(isOpen), "aria-controls": bid }, onClick: () => { open[id] = !open[id]; redraw(id); document.querySelector<HTMLElement>(`#b-sec-${id} .b-sec-head .btn`)?.focus(); } });
  const sum = isOpen ? null : txt(summary(), `t-sm muted${inline ? " ellip" : ""}`);
  const head = box("div", { class: "b-sec-head" }, el("h3", { id: hid, class: "t-md strong" }, title), cnt,
    inline && sum ? sum : el("span", { class: "spacer" }), t);
  return box("section", { class: "b-sec", id: `b-sec-${id}`, "aria-labelledby": hid }, head,
    !isOpen && !inline ? el("p", {}, sum) : null,
    isOpen ? box("div", { class: "b-sec-body", id: bid }, ...body()) : null);
}

// ---- template and race
function templateSection(): HTMLElement {
  const p = session.profile!;
  const names = templateRefs(state.profiles!, state.builtinTemplates);
  const tpl = select(names.map((n) => ({ value: n, label: templateLabel(state.builtinTemplates, n) })), names.includes(p.template as string) ? p.template as string : names[0] || "", { attrs: { id: "b-tpl" } });
  tpl.addEventListener("change", updateTemplateBadge);
  const menuBtn = button({ label: "Template actions: apply, save as, update, delete", icon: "more", iconOnly: true, variant: "ghost", attrs: { id: "b-tpl-menu", "aria-haspopup": "menu", "aria-expanded": "false" } });
  menuBtn.onclick = () => templateMenu(menuBtn);
  const race = segmented({ label: "Race", options: [{ value: "human", label: "Human" }, { value: "elf", label: "Elf" }, { value: "gargoyle", label: "Gargoyle" }], value: p.race || "human",
    onChange: (v) => { p.race = v; p.resistCaps = pruneResistCaps(p.resistCaps, v); redraw("req"); redraw("caps"); } });
  race.id = "b-race";
  // STR limit sits beside Race, always in view: like race it is the character's, saved with the profile,
  // and it decides which pieces are candidates at all (the rest of Advanced only tunes the search).
  const str = knobField("strLimit", "STR limit");
  str.classList.add("b-str");
  return box("section", { class: "b-sec b-sec-top", "aria-label": "Template" },
    box("div", { class: "field" }, el("label", { class: "label", for: "b-tpl" }, "Template"), box("div", { class: "b-tpl-row" }, tpl, el("span", { id: "b-tpl-state", class: "badge" }), menuBtn)),
    box("div", { class: "b-race-row" }, box("div", { class: "field" }, el("span", { class: "label", id: "b-race-l" }, "Race"), race), str));
}
// A template is a saved set of builder settings with no character in it; the badge says whether the panel
// still matches the one it was applied from.
function templateDrift(): { tone: "ok" | "warn" | "bad" | ""; text: string; detail: string } {
  const ref = session.profile!.template, tpl = findTemplate(state.profiles!, state.builtinTemplates, ref), name = ref && templateLabel(state.builtinTemplates, ref);
  if (!name) return { tone: "", text: "none", detail: "Save as… stores these settings as a template." };
  if (!tpl) return { tone: "bad", text: "missing", detail: `These settings came from a template named ${name}, which no longer exists.` };
  const lines = settingsDiff(templateSettings(tpl), templateFrom(readControls()));
  return lines.length ? { tone: "warn", text: "modified", detail: `Changed from ${name}: ${lines.join(" · ")}` } : { tone: "ok", text: "matches", detail: `These settings equal the ${name} template.` };
}
// Redrawn after every edit; the reason ("Changed from melee: DI floor 20 → 30") is its tooltip and, for a
// screen reader, part of its text.
export function updateTemplateBadge(): void {
  const s = $<HTMLElement>("#b-tpl-state");
  if (!s || !session.profile) return;
  const d = templateDrift();
  const next = box("span", { id: "b-tpl-state", class: `badge${d.tone ? " " + d.tone : ""}`, tabindex: "0" }, txt(d.text), el("span", { class: "sr" }, `. ${d.detail}`));
  s.replaceWith(tooltip(next, d.detail));
  commands.refreshCurrentSuit();
}
// A built-in template (app/data/templates/<shard>.json) is read-only: Save as… makes the player's own copy.
const BUILTIN_READ_ONLY = "Built-in templates can't be changed. Save as… makes your own copy.";
function templateMenu(anchor: HTMLButtonElement): void {
  const builtin = selectedTemplate().startsWith(BUILTIN_PREFIX) ? BUILTIN_READ_ONLY : undefined;
  menu(anchor, [{ label: "Apply to these settings", onSelect: applyTemplate }, { label: "Save as…", onSelect: saveTemplateAs },
    { label: "Update this template", onSelect: updateTemplate, disabled: builtin }, { label: "Delete…", onSelect: deleteTemplate, danger: true, disabled: builtin }], { label: "Template actions" });
}
const selectedTemplate = (): string => $<HTMLSelectElement>("#b-tpl")!.value;
async function saveTemplates(done: string): Promise<void> {
  const r = await putProfiles();
  // putProfiles()'s only `ok: false` path is its own catch, which always sets `error`.
  toast(r.ok ? done : r.error!, r.ok ? "good" : "bad");
}
// A template with buffs (a built-in one may carry them) also sets the character's buffs, which are saved at once.
function applyTemplate(): void {
  const ref = selectedTemplate(), t = findTemplate(state.profiles!, state.builtinTemplates, ref), name = templateLabel(state.builtinTemplates, ref);
  if (!t) return;
  Object.assign(session.profile!, templateSettings(t), { template: ref });
  if (t.spec.buffs) setCharacterBuffs(session.character!, { on: t.spec.buffs.on, skills: { ...commands.buffEditsOf(session.character!), ...t.spec.buffs.skills } });
  clearCapDrafts();
  renderPanel();
  toast(`${name} applied. Save profile to keep it.`, "good");
}
async function saveTemplateAs(): Promise<void> {
  const was = session.profile!.template || "";
  const name = await promptText({ title: "Template name", value: was.startsWith(BUILTIN_PREFIX) ? "" : was });
  if (name?.startsWith(BUILTIN_PREFIX)) { toast(`A template's name can't start with "${BUILTIN_PREFIX}".`, "bad"); return; }
  if (!name || (state.profiles!.templates[name] && !await confirmDialog({ title: `Overwrite the ${name} template?`, body: `The ${name} template is replaced with these settings.`, confirmLabel: `Overwrite ${name}` }))) return;
  state.profiles!.templates[name] = { spec: templateSpecFrom(readControls()) };
  session.profile!.template = name;
  renderPanel();
  await saveTemplates(`Template ${name} saved.`);
}
async function updateTemplate(): Promise<void> {
  const name = selectedTemplate();
  if (!Object.hasOwn(state.profiles!.templates, name) || !await confirmDialog({ title: `Update the ${name} template?`, body: `The ${name} template is overwritten with these settings.`, confirmLabel: `Update ${name}` })) return;
  state.profiles!.templates[name] = { ...state.profiles!.templates[name], spec: templateSpecFrom(readControls()) };
  session.profile!.template = name;
  updateTemplateBadge();
  await saveTemplates(`Template ${name} updated.`);
}
async function deleteTemplate(): Promise<void> {
  const name = selectedTemplate();
  if (!Object.hasOwn(state.profiles!.templates, name) || !await confirmDialog({ title: `Delete the ${name} template?`, body: "Characters made from it keep their settings.", confirmLabel: `Delete ${name}` })) return;
  delete state.profiles!.templates[name];
  renderPanel();
  await saveTemplates(`Template ${name} deleted.`);
}

// ---- buffs (issue #12): the ones on count as always on, so the search doesn't spend gear on what they give
// Kept in the character's profile (its spec's buffs, saved at once). The numbers they scale with are the character's, and
// an edited one is shared with Manual. `note` is what the picker says until the next change: the form a just-turned-on
// form replaced, or the buffs Clear all took off, each with Undo.
let note: { replaced: { on: string; off: string } } | { cleared: string[] } | null = null;
let picker: BuffPicker | null = null;
// The list healed as a saved one is read back (normalizeBuffs): a hand edit's second form replaces the first.
const buffsOn = (): string[] => normalizeBuffs(characterBuffs(state.profiles!, session.character!).on) ?? [];
// The panel's buffs, as a run saves them (absent with none on).
export const panelBuffs = (): RunBuffs | undefined => runBuffs(buffsOn(), commands.buffInputsOf(session.character!).values);
// What a build for `name` plans with: `buffs` (the panel's, or a saved run's; none is a plan too, for the stat caps)
// and the numbers they took, over the character's own; its raw stats and `race`; and what it wears now, which a
// potion's Enhance Potions and Enchant's Spell Channeling are read from (app/buffs.mts plannedProfile).
function buffPlan(name: string, race: string | null | undefined, buffs: RunBuffs | undefined): BuffPlan {
  return buffPlanOf((state.inv!.characters[name] as Character | undefined) ?? null, state.inv!.worn[name] || [], race, buffs, commands.buffEditsOf(name));
}
// The panel's buffs set (healed, as a saved list is), and saved.
function setPanelBuffs(on: string[]): void { setCharacterBuffs(session.character!, { on: normalizeBuffs(on) ?? [] }); }
// A saved run's buffs back ("Load these settings"): the ones on, and the numbers they scale with where the run's differ
// from the character's now, so building again plans as the run did. The panel is redrawn by the caller.
function loadRunBuffs(b: RunBuffs | undefined): void {
  setPanelBuffs(b?.on ?? []);
  commands.applyRunInputs(session.character!, b);
}
function buffsSection(): HTMLElement {
  const on = buffsOn();
  return section("buffs", "Buffs", { count: on.length, summary: () => (on.length ? on.map((id) => buffById(id)!.name).join(", ") : "None on"), body: () => {
    const v = buffView();
    const add = filterChip({ label: "Add buff", add: true, attrs: { id: "b-buff-add", "aria-haspopup": "dialog" } });
    add.onclick = () => openBuffPicker(add);
    return [el("p", { class: "help" }, txt("Counted as always on. The search doesn't spend gear on what they already give.")),
      box("div", { class: "b-chips", id: "b-buff-chips" }, ...on.map((id) => buffChip(id, v, buffActions)), add)];
  } });
}
// The picker's state: the buffs on, their numbers, and what each would add, against the caps before any buff.
function buffView(): BuffView {
  const name = session.character!, p = session.profile!, inputs = commands.buffInputsOf(name), plan = buffPlan(name, p.race, { on: buffsOn(), skills: {} });
  // what the character wears now, evaluated with the panel's buffs (app/evaluate.mts)
  const ev = evaluateSuit({ profile: p, character: state.inv!.characters[name] as Character | null, suit: Object.fromEntries((state.inv!.worn[name] || []).map((i) => [String(i.serial), i])), buffs: plan });
  return { name, on: plan.on, values: plan.skills, planned: inputs.planned, edits: commands.buffEditsOf(name), stats: plan.stats, who: plan.who,
    totals: paperdoll(ev.gearTotals, ev.planned.resistBonus), caps: ev.baseCaps, all: ev.buffs, replaced: note && "replaced" in note ? note.replaced : null,
    cleared: note && "cleared" in note ? note.cleared : null, count: true, open: !!picker };
}
// A buff on or off (or all off), with the picker's note: saved, and the chips, the count, the requirements' notes and
// the picker follow.
function setBuffs(next: string[], n: typeof note): void {
  setPanelBuffs(next);
  note = n;
  const row = document.getElementById("b-buff-chips"), add = document.getElementById("b-buff-add"), v = buffView();
  if (row && add) row.replaceChildren(...v.on.map((id) => buffChip(id, v, buffActions)), add);
  setCount("buffs", v.on.length);
  redraw("req");
  picker?.paint(v);
}
const buffActions: PickerActions = {
  toggle: (id) => keepChipFocus("#b-buff-chips", "b-buff-add", () => {
    const { next, replaced: off } = toggleBuff(buffsOn(), id);
    setBuffs(next, off ? { replaced: { on: id, off } } : null);
  }),
  setInput: (id, value) => { commands.editBuffInputs(session.character, { [id]: value }); setBuffs(buffsOn(), note); },
  clear: () => setBuffs([], buffsOn().length ? { cleared: buffsOn() } : null),
  close: closePopover,
  // the note's Undo: the form it replaced, or the buffs it cleared, back on; the replaced form's checkbox takes the focus
  undo: () => {
    if (note && "cleared" in note) { setBuffs(note.cleared, null); return; }
    const off = note?.replaced.off;
    if (off) { setBuffs(toggleBuff(buffsOn(), off).next, null); document.getElementById(`abf-cb-${off}`)?.focus(); }
  },
};
// Add buff opens the picker in a popover beside the panel; a second press, Esc or a click outside closes it.
function openBuffPicker(anchor: HTMLElement): void {
  if (picker) { closePopover(); return; }
  const host = box("div", { class: "bf-pick" });
  picker = createBuffPicker(host, "abf", buffActions, () => "Counted as always on: the search plans around them. A bonus past the cap, like Enemy of One's damage, never changes the plan.");
  popover(anchor, [host], { label: `Buffs for ${session.character}`, width: 480, beside: $<HTMLElement>("#b-panel")!, onClose: () => { picker = null; note = null; } });
  picker.paint(buffView());
  picker.focusSearch();
}

// ---- requirements and weights: rule rows
// Every property a requirement or weight can name: the labelled ones, every property in the inventory, the
// pools, and the skill bonuses gear carries.
function allPropKeys(): string[] {
  return [...new Set([...Object.keys(PROP_LABELS), ...state.propKeys, "stamPool", "manaPool", "hitsPool", ...(state.facets?.gearSkills || []).map((k) => `sk:${k}`)])]
    .filter((k) => !NOT_BUILDER_KEYS.has(k)).sort((a, b) => propName(a).localeCompare(propName(b)));
}
// The panel's resist caps: the player's override, else the shard's cap for this character's race (an Elf's
// Energy is 75 on uoalive).
const panelResistCaps = (): Record<string, ResistCap> => resistCapsFor(session.profile!.race, session.profile!.resistCaps);
// A property's cap for this build: a resist's from the panel's resist caps, anything else the shard's.
function capFor(k: string): number | null {
  if (RESIST_KEYS.includes(k)) return panelResistCaps()[k]!.cap;
  return (getRules().caps as Record<string, number>)[k] ?? null;
}
// A number input bound to obj[k]: a value that isn't a number keeps its field marked with the reason, and the
// last good value stays in the profile.
function boundNumber(obj: Record<string, number>, k: string, aria: string, focusKey: string): HTMLInputElement {
  const i = input({ type: "number", size: "sm", value: obj[k], attrs: { "aria-label": aria, "data-key": focusKey } });
  i.addEventListener("input", () => {
    const err = ruleValueError(i.value);
    setInlineError(i, err);
    if (!err) { obj[k] = Number(i.value); updateTemplateBadge(); }
  });
  return i;
}
// The error line under a rule row or field, kept in sync with aria-invalid and aria-describedby.
function setInlineError(control: HTMLElement, err: string | null): void {
  const holder = control.closest(".rule-row, .field")!;
  const id = `${control.id || (control.id = `b-in-${Math.random().toString(36).slice(2, 8)}`)}-err`;
  holder.querySelector(`#${CSS.escape(id)}`)?.remove();
  control.classList.toggle("invalid", !!err);
  if (err) {
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", id);
    holder.append(el("span", { class: "field-error", id }, err));
  } else { control.removeAttribute("aria-invalid"); control.removeAttribute("aria-describedby"); }
}
function requirementsSection(): HTMLElement {
  const p = session.profile!, name = session.character!;
  const keys = Object.keys(p.floors!).filter((k) => !NOT_BUILDER_KEYS.has(k));
  return section("req", "Requirements", { count: keys.length, summary: () => requirementsSummary(p.floors, p.softFloors), body: () => {
    const rsb = resistSkillBonus(state.inv!.characters[name]?.skills);
    // with buffs on, each requirement they touch says what gear still has to supply
    const { prof, r } = planBuffs(p, state.inv!.characters[name] as Character | null, buffPlan(name, p.race, panelBuffs()));
    const help = el("p", { class: "help" }, txt(`The suit must reach every hard requirement. Soft ones are preferences. Resisting Spells gives ${name} +${rsb}, ${gearCapsText(panelResistCaps(), rsb)}.`));
    const rows = keys.map((k) => {
      const nm = propName(k);
      const hard = segmented({ label: `${nm}: hard or soft`, options: [{ value: "hard", label: "Hard" }, { value: "soft", label: "Soft" }], value: p.softFloors!.includes(k) ? "soft" : "hard",
        onChange: (v) => { p.softFloors = p.softFloors!.filter((x) => x !== k); if (v === "soft") p.softFloors.push(k); updateTemplateBadge(); } });
      const num = boundNumber(p.floors!, k, `${nm} minimum`, k);
      const row = box("div", { class: "rule-row", "data-key": k }, ruleName(nm), txt("≥", "muted"), num, hard,
        button({ label: `Remove requirement: ${nm}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { delete p.floors![k]; p.softFloors = p.softFloors!.filter((x) => x !== k); redraw("req"); focusIn("req", ".b-add"); } }));
      floorWarning(row, num, k);
      const ignored = prof.buffs?.overridesIgnored?.[k];
      const said = r ? [ignored != null ? overrideNote(k, ignored, r) : null, gearNeedsText(k, prof.floors[k]!, prof.caps[k], r)].filter(Boolean).join(". ") : "";
      if (said) row.append(el("span", { class: "t-sm b-buff-note" }, said));
      return row;
    });
    const add = filterChip({ label: "Add requirement", add: true, attrs: { class: "fchip add b-add", id: "b-addfloor" } });
    add.onclick = () => propertyPicker(add, "Add requirement", Object.keys(p.floors!), (k) => { p.floors![k] = capFor(k) ?? 1; redraw("req"); focusIn("req", `.rule-row[data-key="${CSS.escape(k)}"] input`, true); });
    return [help, rows.length ? box("div", { class: "b-rules" }, ...rows) : null, add];
  } });
}
// A resist requirement above its resist's cap is kept (a saved profile may carry one) but counts only up to the
// cap, as the solver scores it: the row says so, and keeps saying so as the floor is typed.
function floorWarning(row: HTMLElement, num: HTMLInputElement, k: string): void {
  const p = session.profile!, id = `${num.id || (num.id = `b-in-${Math.random().toString(36).slice(2, 8)}`)}-warn`;
  const paint = (): void => {
    row.querySelector(`#${CSS.escape(id)}`)?.remove();
    const w = floorCapWarning(k, p.floors![k]!, capFor(k));
    if (w) row.append(el("span", { class: "field-warn t-sm tone-warn", id }, w));
    if (w && !num.hasAttribute("aria-invalid")) num.setAttribute("aria-describedby", id);
    else if (num.getAttribute("aria-describedby") === id) num.removeAttribute("aria-describedby");
  };
  num.addEventListener("input", paint);
  paint();
}
// ---- resist caps: the highest paperdoll value each resist counts for in this build
// Each row is the resist, its cap (the shard's for the race until the player types another) and, once overridden,
// what it was raised or lowered from with a reset. A cap back at the shard's value is no override at all.
function capsSection(): HTMLElement {
  const p = session.profile!;
  return section("caps", "Resist caps", { summary: () => resistCapsSummary(panelResistCaps()), body: () => [
    el("p", { class: "help" }, txt(`The highest paperdoll value each resist is worth, for the score and for requirements. Raise one for a suit worn in a form that lowers it: Reaper Form takes 25 Fire, so a Fire cap of 95 keeps 70 in form. Whole numbers from ${RESIST_CAP_LIMITS.min} to ${RESIST_CAP_LIMITS.max}.`)),
    box("div", { class: "b-rules" }, ...RESIST_KEYS.map((k) => capRow(p, k))),
  ] });
}
function capRow(p: NonNullable<typeof session.profile>, k: string): HTMLElement {
  const nm = propName(k), c = panelResistCaps()[k]!;
  const i = input({ type: "number", size: "sm", value: capDrafts[k] ?? c.cap, attrs: { id: `b-cap-${k}`, "aria-label": `${nm} cap`, "data-key": k } });
  const row = box("div", { class: "rule-row cap", "data-key": k }, ruleName(nm), i);
  // The row's end: "shard cap", or the override's note and its reset. Repainted in place as the value changes, so
  // typing keeps its focus and caret.
  let tail: HTMLElement[] = [];
  const paint = (): void => {
    const now = panelResistCaps()[k]!, note = capNote(now);
    i.classList.toggle("cap-set", !!note);
    const next = note
      ? [badge(note, "accent"), button({ label: `Reset ${nm} cap to the shard's ${now.shard}`, icon: "undo", iconOnly: true, variant: "ghost", size: "sm", onClick: () => {
        p.resistCaps = withResistCap(p.resistCaps, k, now.shard, now.shard);
        delete capDrafts[k];
        redraw("caps"); redraw("req");
        focusIn("caps", `.rule-row[data-key="${CSS.escape(k)}"] input`, true);
      } })]
      : [txt("shard cap", "t-sm muted cap-shard"), el("span")];
    if (tail.length) tail.forEach((n, j) => n.replaceWith(next[j]!)); else row.append(...next);
    tail = next;
  };
  i.addEventListener("input", () => {
    const err = resistCapError(i.value);
    setInlineError(i, err);
    if (err) { capDrafts[k] = i.value; return; }
    delete capDrafts[k];
    p.resistCaps = withResistCap(p.resistCaps, k, Number(i.value), c.shard);
    paint(); redraw("req");   // its note names what gear supplies under each cap; redraw() also updates the template badge
  });
  paint();
  if (capDrafts[k] != null) setInlineError(i, resistCapError(capDrafts[k]!));
  return row;
}
function weightsSection(): HTMLElement {
  const p = session.profile!;
  const keys = Object.keys(p.weights!).filter((k) => !NOT_BUILDER_KEYS.has(k));
  return section("weights", "Weights", { count: keys.length, summary: () => weightsSummary(p.weights), body: () => {
    const rows = keys.map((k) => {
      const nm = propName(k);
      return box("div", { class: "rule-row weight", "data-key": k }, ruleName(nm), boundNumber(p.weights!, k, `${nm} weight`, k),
        button({ label: `Remove weight: ${nm}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { delete p.weights![k]; redraw("weights"); focusIn("weights", ".b-add"); } }));
    });
    const add = filterChip({ label: "Add weight", add: true, attrs: { class: "fchip add b-add", id: "b-addweight" } });
    add.onclick = () => propertyPicker(add, "Add weight", Object.keys(p.weights!), (k) => { p.weights![k] = 1; redraw("weights"); focusIn("weights", `.rule-row[data-key="${CSS.escape(k)}"] input`, true); });
    return [el("p", { class: "help" }, txt("How much each point of a property is worth to the score. Higher counts more.")), rows.length ? box("div", { class: "b-rules" }, ...rows) : null, add];
  } });
}
function focusIn(sec: string, sel: string, selectText = false): void {
  const e = document.querySelector<HTMLInputElement>(`#b-sec-${sec} ${sel}`);
  e?.focus();
  if (selectText) e?.select();
}
// The searchable property combobox behind "+ Add requirement" / "+ Add weight": type to filter, ↓ into the
// list, Enter picks the first match.
function propertyPicker(anchor: HTMLElement, title: string, taken: string[], pick: (k: string) => void): void {
  const keys = allPropKeys().filter((k) => !taken.includes(k));
  const s = searchInput({ label: `${title}: search properties`, placeholder: "Search properties" });
  const list = box("div", { class: "b-pick-list", role: "listbox", "aria-label": "Properties" });
  const choose = (k: string): void => { closePopover(); pick(k); };
  const paint = (): void => {
    const q = s.input.value.trim().toLowerCase();
    const hits = keys.filter((k) => !q || `${propName(k)} ${label(k)} ${full(k)}`.toLowerCase().includes(q));
    list.replaceChildren(...(hits.length ? hits.map((k) => box("button", { class: "menu-item", type: "button", role: "option", "data-key": k, onclick: () => choose(k) }, txt(propName(k)), txt(label(k), "t-sm muted")))
      : [el("p", { class: "t-sm muted" }, "No property matches.")]));
  };
  s.input.addEventListener("input", paint);
  s.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); list.querySelector<HTMLElement>("button")?.focus(); }
    if (e.key === "Enter") { e.preventDefault(); const first = list.querySelector<HTMLElement>("button"); if (first) choose(first.dataset.key!); }
  });
  list.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll<HTMLElement>("button")], i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" && i < items.length - 1) { e.preventDefault(); items[i + 1]!.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? items[i - 1]! : s.input).focus(); }
  });
  paint();
  popover(anchor, [s.root, list], { label: title, width: 320 });
  s.input.focus();
}

// ---- candidate pool
function poolSection(): HTMLElement {
  const p = session.profile!;
  return section("pool", "Candidate pool", { summary: () => poolSummary(p), body: () => {
    const sw = (id: string, text: string, key: "allowOthersWorn" | "allowGargoyle" | "medOnly"): HTMLLabelElement =>
      switchControl({ label: text, checked: !!p[key], attrs: { id }, onChange: (v) => { p[key] = v; updateTemplateBadge(); } }).root;
    return [
      box("div", { class: "b-switches" }, sw("b-others", "Allow gear worn by other characters", "allowOthersWorn"), sw("b-garg", "Allow gargoyle-only gear", "allowGargoyle"), sw("b-med", "Meditation-safe gear only", "medOnly")),
      box("div", { class: "b-chips" }, weaponChip(), listChip("b-locked", "Locked slots", () => p.lockedSlots!, (v) => { p.lockedSlots = v; }, () => GEAR_SLOTS.map((s) => ({ value: s, label: slotLabel(s) })), false),
        tagsChip(), listChip("b-exskills", "Forbid skill bonuses", () => p.excludeSkills!, (v) => { p.excludeSkills = v; },
          () => [...new Set([...(state.facets?.gearSkills || []), ...p.excludeSkills!])].sort().map((sk) => ({ value: sk, label: sk[0]!.toUpperCase() + sk.slice(1) })), true),
        listChip("b-exroots", "Skip containers", () => p.excludeRoots!.map(String), (v) => { p.excludeRoots = v.map((x) => (Number.isFinite(Number(x)) ? Number(x) : x)); }, rootOptions, true)),
    ];
  } });
}
function rootOptions(): Array<{ value: string; label: string }> {
  return Object.values(state.inv!.containers).filter((c) => c.parent == null)
    .map((r) => ({ value: String(r.serial), label: `${r.kind === "ground" ? "" : r.scannedBy + "'s "}${(r as { label?: string }).label || bagLabel(r)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
// A dropdown chip's label says what it holds ("Locked slots: 2") and is drawn set when it holds anything.
function paintChip(chip: HTMLButtonElement, text: string, set: boolean): void {
  chip.classList.toggle("set", set);
  chip.querySelector("span")!.textContent = text;
}
// The Weapons chip: a checklist of the weapon skills, where a tick EXCLUDES that skill's weapons from the pool, and
// under it the Use Best Weapon Skill switch (profile `ubwsAnyWeapon`, absent means on).
function weaponChip(): HTMLButtonElement {
  const p = session.profile!;
  const text = (): string => weaponsChipText(p.excludeWeapons, p.ubwsAnyWeapon !== false);
  const chip = filterChip({ label: text(), set: !!p.excludeWeapons?.length, attrs: { id: "b-weapon" } });
  chip.onclick = () => {
    const checks = WEAPON_SKILLS.map((w) => check({ label: weaponName(w), checked: !!p.excludeWeapons?.includes(w), attrs: { value: w }, onChange: (on) => {
      p.excludeWeapons = toggleWeapon(p.excludeWeapons || [], w, on);
      paintChip(chip, text(), !!p.excludeWeapons.length); updateTemplateBadge(); paintUbws();
    } }).root);
    const ubws = check({ label: "Allow any weapon with Use Best Weapon Skill", checked: p.ubwsAnyWeapon !== false, attrs: { id: "b-ubws" }, onChange: (on) => {
      p.ubwsAnyWeapon = on;
      paintChip(chip, text(), !!p.excludeWeapons?.length); updateTemplateBadge();
    } });
    // With every melee skill excluded the check has nothing to swing with, so it is disabled and says why.
    const paintUbws = (): void => {
      const off = MELEE_SKILLS.every((w) => p.excludeWeapons?.includes(w));
      ubws.input.disabled = off;
      for (const n of [ubws.input, ubws.root]) {
        if (off) n.title = "Use Best Weapon Skill swings with Swordsmanship, Fencing or Mace Fighting, all excluded";
        else n.removeAttribute("title");
      }
    };
    paintUbws();
    popover(chip, [el("p", { class: "help" }, txt("Exclude weapon skills: a checked skill's weapons never enter the pool.")),
      box("div", { class: "b-checks", role: "group", "aria-label": "Exclude weapon skills" }, ...checks),
      ubws.root, el("p", { class: "help" }, txt("It swings with your best of Swordsmanship, Fencing or Mace Fighting."))], { label: "Exclude weapon skills" });
  };
  return chip;
}
function tagsChip(): HTMLButtonElement {
  const p = session.profile!;
  const text = (): string => (p.excludeTags!.length ? `Exclude tags: ${p.excludeTags!.length}` : "Exclude tags");
  const chip = filterChip({ label: text(), set: !!p.excludeTags!.length, attrs: { id: "b-extags" } });
  chip.onclick = () => popover(chip, [el("p", { class: "help" }, txt("Leave out every piece carrying a pressed tag.")),
    box("div", { class: "b-pills" }, ...Object.keys(tagUnits()).map((t) => pill({ label: t[0]!.toUpperCase() + t.slice(1), pressed: p.excludeTags!.includes(t), onToggle: (on) => {
      p.excludeTags = on ? [...p.excludeTags!, t] : p.excludeTags!.filter((x) => x !== t);
      paintChip(chip, text(), !!p.excludeTags!.length); updateTemplateBadge();
    } })))], { label: "Exclude tags" });
  return chip;
}
// A checklist chip: tick any number of options; searchable once the list is long.
function listChip(id: string, title: string, get: () => string[], set: (v: string[]) => void, options: () => Array<{ value: string; label: string }>, searchable: boolean): HTMLButtonElement {
  const text = (): string => (get().length ? `${title}: ${get().length}` : title);
  const chip = filterChip({ label: text(), set: !!get().length, attrs: { id } });
  chip.onclick = () => {
    const all = options();
    const list = box("div", { class: "b-checks" });
    const paint = (q: string): void => {
      const hits = all.filter((o) => !q || o.label.toLowerCase().includes(q));
      list.replaceChildren(...(hits.length ? hits.map((o) => check({ label: o.label, checked: get().includes(o.value), onChange: (on) => {
        set(on ? [...get(), o.value] : get().filter((x) => x !== o.value));
        paintChip(chip, text(), !!get().length); updateTemplateBadge();
      } }).root) : [el("p", { class: "t-sm muted" }, all.length ? "Nothing matches." : "Nothing to choose from yet.")]));
    };
    const s = searchable && all.length > 7 ? searchInput({ label: `Search ${title.toLowerCase()}`, placeholder: "Search" }) : null;
    s?.input.addEventListener("input", () => paint(s.input.value.trim().toLowerCase()));
    paint("");
    popover(chip, [s?.root, list], { label: title, width: 300 });
  };
  return chip;
}

// ---- Advanced: the solver knobs
// A knob's number field, typed into knobs[f] with its error shown in place (STR limit's beside Race, the
// others under Advanced).
function knobField(f: KnobField, text: string): HTMLDivElement {
  const i = input({ type: "number", value: knobs[f], size: f === "strLimit" ? "sm" : undefined, attrs: { id: KNOB_IDS[f] } });   // STR limit's matches Race's height
  if (!knobs.exact && (f === "budgetS" || f === "altCount" || f === "altTol")) i.disabled = true;
  const err = knobError(f, knobs[f]);
  const fl = field({ label: text, control: i, error: err && !i.disabled ? err : undefined });
  i.addEventListener("input", () => { knobs[f] = i.value; setFieldError(i, knobError(f, i.value)); if (f === "strLimit") updateTemplateBadge(); });
  return fl;
}
function advancedSection(): HTMLElement {
  return section("adv", "Advanced", { inline: true, summary: () => advancedSummary(knobs), body: () => {
    const exact = switchControl({ label: "Exact search (prove the best)", checked: knobs.exact, attrs: { id: "b-exact" }, onChange: (v) => { knobs.exact = v; redraw("adv"); document.getElementById("b-exact")?.focus(); } });
    return [box("div", { class: "b-adv" }, box("div", { class: "b-adv-wide" }, exact.root),
      knobField("restarts", "Restarts"), knobField("budgetS", "Time budget (s)"), knobField("altCount", "Other suits"), knobField("altTol", "Within points"),
      el("p", { class: "help b-adv-wide" }, txt(knobs.exact ? "Other suits lists the next best suits scoring within that many points of the best." : "Time budget and other suits need exact search.")))];
  } });
}
// field()'s error line, updated in place as the value changes.
function setFieldError(control: HTMLInputElement, err: string | null): void {
  const f = control.closest(".field")!, id = `${control.id}-err`;
  f.querySelector(`#${CSS.escape(id)}`)?.remove();
  const described = (control.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== id);
  control.classList.toggle("invalid", !!err);
  if (err) { control.setAttribute("aria-invalid", "true"); described.push(id); f.append(el("span", { class: "field-error", id }, err)); }
  else control.removeAttribute("aria-invalid");
  if (described.length) control.setAttribute("aria-describedby", described.join(" ")); else control.removeAttribute("aria-describedby");
}
// Build with a bad field: open Advanced if the field is in it, show the error and put focus there.
function focusKnob(f: KnobField, err: string): void {
  if (f !== "strLimit" && !open.adv) { open.adv = true; redraw("adv"); }
  const i = document.getElementById(KNOB_IDS[f]) as HTMLInputElement | null;
  if (!i) return;
  setFieldError(i, err);
  i.focus(); i.select();
  i.closest(".field")?.scrollIntoView({ block: "nearest" });   // the error line under it too
}

// ---------------------------------------------------------------- the build
// The panel as a build (app/build-spec.mts planBuild): its settings, the character's buffs and the Advanced fields'
// search knobs, planned for the character as scanned. What a build sends and a saved run keeps both come from it.
function panelBuild(): PlannedBuild {
  const name = session.character!, p = readControls();
  const spec = { ...specFromProfile(p, { on: buffsOn(), skills: commands.buffEditsOf(name) }),
    search: { restarts: Number(knobs.restarts), exact: knobs.exact, budgetMs: 1000 * Number(knobs.budgetS), altCount: Number(knobs.altCount), altTol: Number(knobs.altTol) } };
  return planBuild(spec, { character: (state.inv!.characters[name] as Character | undefined) ?? null, worn: state.inv!.worn[name] || [], race: p.race });
}
async function runBuild(): Promise<void> {
  if (session.job) return;
  if (commands.filling()) { toast("Manual is filling its empty slots. Wait for it, or cancel it there, before building."); return; }
  if (!session.character || !session.profile) { toast("No character to build for yet: scan one first.", "bad"); return; }
  // A bad field stops the build and takes focus, with its reason under it; the button itself stays enabled.
  const bad = firstKnobError(knobs);
  if (bad) { focusKnob(bad.field, bad.error); return; }
  // A resist cap out of range stops the build from the panel's state, open or closed: the section opens on it.
  const badCap = RESIST_KEYS.find((k) => capDrafts[k] != null);
  if (badCap) {
    if (!open.caps) { open.caps = true; redraw("caps"); }
    focusIn("caps", `#b-cap-${badCap}`, true);
    document.getElementById(`b-cap-${badCap}`)?.closest(".rule-row")?.scrollIntoView({ block: "nearest" });
    return;
  }
  const badRule = document.querySelector<HTMLInputElement>("#b-panel-body .rule-row input[aria-invalid='true']");
  if (badRule) { badRule.focus(); return; }
  const name = session.character, { pool: settings, opts, profile, snapshot } = panelBuild();
  const exact = knobs.exact, budgetMs = 1000 * Number(knobs.budgetS);
  commands.closeCompare();
  // Pools/current/skipped are the server's job (buildPools against its own cached inventory, POST
  // /api/optimize's by-character form): the page sends the character + settings and reads poolSize/skipped/
  // current/warning back. The job keeps the character and the effective profile it was started with: the
  // player can switch characters while it runs, and the result is judged against these.
  const job: BuilderJob = { id: null, es: null, name, profile, exact, budgetMs, poolSize: null, skipped: {}, current: {}, warning: null, startedAt: Date.now(), lastProgressAt: Date.now(), lastServerAt: Date.now(), last: null, connected: true, ui: null, timer: null };
  session.job = job;
  setBuilding(true);
  job.ui = runPanel(job);
  $<HTMLElement>("#b-msg")!.replaceChildren(job.ui.root);
  job.ui.root.focus();
  let r: (OptimizeStartApiResponse & { ok: true }) | { ok: false; error: string };
  try {
    r = (await api<OptimizeStartApiResponse>("/api/optimize", { method: "POST", body: { character: name, settings, profile, opts,
      meta: { character: name, settings: snapshot, inventoryStamp: invStamp() } } })) as OptimizeStartApiResponse & { ok: true };
    // optimizeErrorMessage (ui/messages.mts) explains the one refusal that isn't about this build at all: 429,
    // four jobs already running (vault-server.mts's MAX_RUNNING_JOBS) — this page only ever runs one.
  } catch (e) { r = { ok: false, error: optimizeErrorMessage(e) }; }
  if (session.job !== job) { if (r.ok) api(`/api/optimize/${r.id}/cancel`, { method: "POST" }).catch(() => {}); return; }   // cancelled while the request was in flight
  if (!r.ok) { failJob(job, r.error); return; }
  job.poolSize = r.poolSize; job.skipped = r.skipped; job.current = r.current; job.warning = r.warning || null;
  // r.run.ms is `number | null` (a saved run's on-disk shape); a genuinely null one has never been guarded here.
  if (r.cached) { finishJob(job, { result: r.run!.result, ms: r.run!.ms!, runId: r.run!.id, reused: r.run! }); return; }
  job.id = r.id!;
  job.timer = setInterval(() => job.ui!.tick(job), 200) as unknown as number;
  job.es = followJob(job.id, {
    progress: (p) => { job.last = p; job.lastProgressAt = Date.now(); job.lastServerAt = Date.now(); job.connected = true; job.ui!.update(job); },
    alive: (connected) => { if (connected) job.lastServerAt = Date.now(); job.connected = connected; },
    done: (d) => finishJob(job, d),
    failed: (error) => failJob(job, error),
    cancelled: (ms) => endJob(job, cancelledNote(ms)),
  });
}
// While a build runs: the footer button says so and is disabled, the sidebar's Suit Builder item shows a busy
// dot, and a result already on screen stays there dimmed and out of reach until the new one lands.
function setBuilding(on: boolean): void {
  const b = $<HTMLButtonElement>("#b-run")!;
  b.disabled = on;
  b.replaceChildren(...(on ? [txt("Building…")] : [txt("Build best suit"), kbd("⌘↵")]));
  b.querySelector(".kbd")?.setAttribute("aria-hidden", "true");
  setNavBusy("builder", on);
  const res = $<HTMLElement>("#b-result")!;
  const stale = on && !!session.result;
  res.classList.toggle("b-stale", stale);
  res.inert = stale;
  if (stale) res.setAttribute("aria-hidden", "true"); else res.removeAttribute("aria-hidden");
}
const cancelledNote = (ms: number): HTMLElement => message({ tone: "info", text: `Canceled after ${fmtSecs(ms)}.`, actions: [button({ label: "Build again", size: "sm", onClick: () => runBuild() })] });
// A refusal or failure: an inline message at the top of the results; when it names a field, that field gets
// the error and the focus.
function failJob(job: BuilderJob, text: string): void {
  const hadFocus = endJob(job, message({ tone: "bad", title: "The build did not run", text }));
  const f = knobFromServerError(text);
  if (f) focusKnob(f, text);
  else if (hadFocus) $<HTMLButtonElement>("#b-run")!.focus();
}
// Ends the job and puts `node` where the progress card was. Returns whether focus was inside the card (it
// has focus from the moment a build starts), so the caller can hand it on instead of dropping it on <body>:
// endJob itself hands it to the node's first button ("Build again"), finishJob to the result's heading.
function endJob(job: BuilderJob, node?: HTMLElement | null): boolean {
  if (session.job !== job) return false;
  const msg = $<HTMLElement>("#b-msg")!;
  const hadFocus = msg.contains(document.activeElement);
  clearInterval(job.timer as number | undefined); job.es?.close(); session.job = null;
  setBuilding(false);
  msg.replaceChildren(...(node ? [node] : []));
  if (hadFocus) node?.querySelector<HTMLElement>("button")?.focus();
  return hadFocus;
}
interface JobFinishInfo { result: OptimizeResult; ms: number; runId: string | null; reused?: SavedRunLike | null | undefined }
function finishJob(job: BuilderJob, r: JobFinishInfo): void {
  const meta: BuildMeta = { ms: r.ms, poolSize: job.poolSize, skipped: job.skipped, reused: r.reused || null };
  const finished: FinishedBuild = { name: job.name, result: r.result, current: job.current, profile: job.profile, runId: r.runId || null, meta };
  // Switched to another character while it ran: never draw this suit (or its Plan and Grab all) under that
  // character. It waits until its own character is selected again.
  const away = job.name !== session.character;
  const notes = [away ? message({ tone: "info", text: `${job.name}'s build finished. Switch back to ${job.name} to see it.`, attrs: { class: "msg info parked-note" } }) : null,
    job.warning ? message({ tone: "warn", text: job.warning }) : null].filter((x): x is HTMLDivElement => x !== null);
  const hadFocus = endJob(job, null);
  $<HTMLElement>("#b-msg")!.replaceChildren(...notes);
  if (away) { session.parked = finished; if (hadFocus) $<HTMLButtonElement>("#b-run")!.focus(); return; }
  showFinished(finished, hadFocus);
  commands.loadRuns();
}
// `focus`: the finished build's heading takes the focus the progress card had (tabindex -1: a target, not a stop).
function showFinished(f: FinishedBuild, focus = false): void {
  session.result = f.result;
  session.openRun = f.runId;
  session.altView = null;
  commands.renderResult(f.result, f.current, f.profile, f.name, f.meta).then(() => {
    const h = focus ? $<HTMLElement>("#b-result h2") : null;
    if (h) { h.tabIndex = -1; h.focus(); }
  }).catch(commands.resultLoadError);
}
export async function cancelJob(job: BuilderJob): Promise<void> {
  if (!job.id) { endJob(job, cancelledNote(Date.now() - job.startedAt)); return; }
  job.ui!.cancelling();
  try { await api<OptimizeCancelApiResponse>(`/api/optimize/${job.id}/cancel`, { method: "POST" }); } catch { /* the server is gone; nothing to stop */ }
  endJob(job, cancelledNote(Date.now() - job.startedAt));
}

// The inline progress card: busy dot, what is being built, Cancel (Esc while the card has focus), the three
// phases, a determinate bar (restarts, then the time budget of the exact phase, then the other suits found),
// and the stat row. The phase changes are announced; the numbers that tick every 200 ms are not.
const PHASES: Array<[string, string]> = [["heuristic", "Hill climbing"], ["exact", "Proving with HiGHS"], ["alternatives", "Other suits"]];
function runPanel(job: BuilderJob): BuilderJobUi {
  const dot = el("span", { class: "dot busy", role: "img", "aria-label": "Solver running" });
  const cancel = button({ label: "Cancel", kbd: "Esc", onClick: () => cancelJob(job) });
  const phases = PHASES.filter(([k]) => job.exact || k === "heuristic");
  let step = stepper(phases.map(([, l]) => l), 0, "Build phases");
  const bar = progress(0, 1000, "Build progress");
  const main = txt("Starting…"), cand = txt("", "muted");
  const live = el("span", { class: "sr", "aria-live": "polite" }, "Hill climbing");
  const stat = (lbl: string): [HTMLElement, HTMLSpanElement] => { const v = txt("—", "v"); return [box("div", { class: "b-stat" }, txt(lbl, "t-sm muted"), v), v]; };
  const [sBest, vBest] = stat("Best so far"), [sReq, vReq] = stat("Requirements met"), [sCand, vCand] = stat("Candidates"), [sTime, vTime] = stat("Elapsed"), [sBeat, vBeat] = stat("Solver");
  const root = box("section", { class: "card b-progress", "aria-label": "Build progress", tabindex: "-1" },
    box("div", { class: "b-row" }, dot, el("h2", { class: "t-lg" }, `Building ${job.name}'s suit`), txt(job.exact ? `exact search · budget ${job.budgetMs / 1000} s` : "heuristic search", "muted"), el("span", { class: "spacer" }), cancel),
    step,
    box("div", { class: "b-prog" }, bar, box("div", { class: "b-prog-line" }, main, txt("·", "faint"), cand, el("span", { class: "spacer" }), txt("You can keep using Pack Rat while this runs", "muted"))),
    box("div", { class: "b-stats" }, sBest, sReq, sCand, sTime, sBeat), live);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelJob(job); } });
  let shownPhase = 0;
  const phaseIdx = (p: string): number => (p === "done" ? phases.length : Math.max(0, phases.findIndex(([k]) => k === p)));
  const ui: BuilderJobUi = {
    root,
    update(j: BuilderJob) {
      const p = j.last; if (!p) return;
      const cur = phaseIdx(p.phase);
      if (cur !== shownPhase) {
        shownPhase = cur;
        const next = stepper(phases.map(([, l]) => l), cur, "Build phases");
        step.replaceWith(next); step = next;
        live.textContent = cur < phases.length ? phases[cur]![1] : "Finishing";
      }
      const { frac, text, detail } = progressText(p);
      main.textContent = text; cand.textContent = detail;
      bar.set(Math.round(frac * 1000));
      vBest.textContent = p.improvements ? `improved ${fmtN(p.improvements)}× · at ${fmtSecs(p.lastImprovementMs!)}` : "the current suit";
      vReq.className = "v";
      if (p.floorsTotal) { vReq.textContent = `${p.floorsMet} of ${p.floorsTotal}`; vReq.classList.add("strong", p.floorsMet === p.floorsTotal ? "tone-ok" : "tone-warn"); }
      else vReq.textContent = "none set";
      vCand.textContent = fmtN(p.candidates);
    },
    tick(j: BuilderJob) {
      const now = Date.now();
      vTime.textContent = fmtSecs(now - j.startedAt);
      const silent = (now - j.lastProgressAt) / 1000;
      let tone = "", text = `alive · ${silent < 1 ? "just now" : silent.toFixed(0) + " s ago"}`;
      if (!j.connected) { tone = "warn"; text = "connection lost · reconnecting"; }
      else if (silent > 12) { tone = "bad"; text = `silent for ${silent.toFixed(0)} s: probably hung, cancel and build again`; }
      else if (silent > 4) { tone = "warn"; text = `no update for ${silent.toFixed(0)} s`; }
      dot.className = `dot ${tone || "busy"}`;
      vBeat.className = `v${tone ? ` tone-${tone}` : ""}`; vBeat.textContent = text;
    },
    cancelling() { cancel.disabled = true; cancel.replaceChildren(txt("Canceling…")); },
  };
  return ui;
}

// ---------------------------------------------------------------- save
async function saveProfile(): Promise<void> {
  if (!session.character || !session.profile) { toast("No character to save a profile for yet: scan one first.", "bad"); return; }
  // A copy (later panel edits must not ride along with a template save), keeping what the panel doesn't edit: any
  // other field of the entry, and the spec's goal and search.
  const name = session.character!, chars = state.profiles!.characters, entry = characterEntry(readControls(), characterBuffs(state.profiles!, name));
  const { race: _race, template: _template, spec: was, ...rest } = Object.hasOwn(chars, name) ? chars[name]! : { spec: undefined };
  chars[name] = { ...rest, ...entry, spec: { ...was, ...entry.spec } };
  const r = await putProfiles();
  toast(r.ok ? `Profile for ${session.character} saved.` : r.error!, r.ok ? "good" : "bad");
}
provide({ renderPanel, clearCapDrafts, panelBuild, buffPlan, loadRunBuffs });
