// ui/builder.mts — the Suit Builder screen (design spec 4.6, issues #272, #321): the sentence bar's Build Settings and Build,
// the Build Settings drawer (its tabs: Requirements, Goals, Buffs, Pool, Advanced) with its footer, the panel as a build and
// the finished build shown. The sentence bar's pickers and What changed chip are ui/builder-header.mts; the Manage templates drawer and the template actions are ui/builder-templates.mts; the Requirements and Goals tabs and the resist caps are ui/builder-requirements.mts; the optimize job and its progress card are ui/builder-job.mts; the first-visit view is ui/builder-start.mts; the result, the compare view and the Solver details are ui/builder-result.mts; the saved-runs drawer
// is ui/runs.mts; they share the builder's state and call each other through ui/builder-session.mts. The panel is drawn
// from the session's profile plus its Advanced knobs, so what a build sends, what a profile saves and what a run
// snapshots are read from state, never from the DOM.
//
// map: builder
// owns: `initBuilder`, `applyPanelPrefs`, `selectCharacter`
import { NOBODY, GEAR_SLOTS, tagUnits, WEAPON_EXCLUDES, MELEE_SKILLS, WEAPON_MUST_HAVE, flagLabel, RESIST_KEYS, templateFrom, settingsChanges, bagLabel, CASTING_SCHOOLS } from "../vault-lib.mts";
import { BUILTIN_PREFIX, characterBuffs, characterEntry, characterProfile, findTemplate, planBuild, specFromProfile, templateSettings, type PlannedBuild } from "../build-spec.mts";
import type { RunBuffs, RunSettings, Character, SettingsChange, SettingsGroup } from "../vault-lib.mts";
import { BUFFS, BUFF_GROUPS, BUFF_INPUTS, buffAvailability, buffById, buffEffectTags, isSchool, normalizeBuffs, toggleBuff, buffPlanOf, type Buff, type BuffPlan } from "../buffs.mts";
import { defaultStrLimit } from "../run-settings.mts";
import { evaluateSuit } from "../evaluate.mts";
import { state } from "./store.mts";
import type { FinishedBuild } from "./store.mts";
import { $, el, slotLabel, toast } from "./dom.mts";
import { box, txt, button, badge, select, input, field, switchControl, check, segmented, filterChip, pill, popover, closePopover, icon, modalOpen, bindDrawer, type DrawerHandle } from "./components.mts";
import { createBuffPicker, type BuffPicker, type BuffView, type PickerActions } from "./builder-buffs.mts";
import { parseRoute, registerScreen, routeFor } from "./nav.mts";
import { editProfiles, setCharacterBuffs } from "./profiles.mts";
import { session, commands, provide, readControls, type BuilderChange, type BuildState, type SectionId, type FocusSection } from "./builder-session.mts";
import { plainName, NO_CHARACTER, buffsOn, group, checklist, panelFcCap, fcCapNote } from "./builder-parts.mts";
import { characterNames } from "./roster.mts";
import { runSettingsDiff, plural, knobError, pruneResistCaps, weaponsChipText, weaponMustHaveChipText, withStoredRoots, weaponName, toggleWeapon, fcCapText, rarityHelp, templateBuffsLine, sourceTitle, who, buildStateText, buildStateDetail, type KnobField } from "./builder-model.mts";
import type { UiPrefs } from "./api-types.mts";
import { prefs } from "./prefs.mts";

// ---------------------------------------------------------------- panel state
// The solver knobs as typed (ui/builder-session.mts), and the Build Settings drawer's tab (ui-prefs `builderTab`).
const knobs = session.knobs;
type Tab = NonNullable<UiPrefs["builderTab"]>;
const TABS: Tab[] = ["requirements", "weights", "buffs", "pool", "advanced"];
let tab: Tab = "requirements";
// The tab each group that focusIn reaches sits in.
const TAB_OF: Record<FocusSection, Tab> = { req: "requirements", goals: "weights", weights: "weights", adv: "advanced", caps: "advanced" };
const KNOB_IDS: Record<KnobField, string> = { strLimit: "b-str", restarts: "b-restarts", budgetS: "b-budget", altCount: "b-altcount", altTol: "b-alttol" };

// ---------------------------------------------------------------- wiring
// The builder's listeners, attached once for the page's life (app.mts's load()). Everything that depends on
// the inventory is syncBuilderCharacters()'s job, which runs on every load and refresh.
export function initBuilder(): void {
  $<HTMLButtonElement>("#b-run")!.onclick = () => commands.build();
  $<HTMLButtonElement>("#b-run-foot")!.onclick = () => commands.build();
  $<HTMLButtonElement>("#b-save")!.onclick = () => saveProfile();
  $<HTMLButtonElement>("#b-save-tpl")!.onclick = () => commands.saveTemplateAs();
  $<HTMLButtonElement>("#b-runs-open")!.onclick = () => commands.openRunsDrawer();
  // ⌘↵ (Ctrl+Enter off the Mac) builds from anywhere on the screen. Listened for on the document, not the
  // screen: after a click on blank space focus is on <body>, outside #tab-builder, so a listener there never
  // heard the key. It does what pressing Build would, and nothing while the button is disabled (no character,
  // a build running), not showing (another screen, the compare view) or behind a drawer or dialog.
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key !== "Enter") return;
    const run = $<HTMLButtonElement>("#b-run")!;
    if (run.disabled || session.job || !run.getClientRects().length || (run.closest("[inert]") && !drawerOpen()) || modalOpen()) return;
    e.preventDefault();
    commands.build();
  });
  // The Build Settings drawer, the shared modal drawer (components.mts bindDrawer): its ×, the scrim and Esc close it.
  // Its button and ⌘, (Ctrl+, off the Mac) open it while the builder's top bar shows the button (not in Manual, the
  // compare view or another screen, nor behind a drawer or dialog), and ⌘, closes it again. Esc with the focus fallen
  // to <body> closes it too, an open popover closing first.
  settingsDrawer = bindDrawer($<HTMLElement>("#b-drawer-root")!);
  settingsDrawer.root.addEventListener("drawerclose", () => $<HTMLButtonElement>("#b-settings")!.setAttribute("aria-expanded", "false"));
  $<HTMLButtonElement>("#b-settings")!.onclick = () => openSettings();
  const settingsShown = (): boolean => { const b = $<HTMLButtonElement>("#b-settings")!; return !!b.getClientRects().length && !b.closest("[inert]") && !modalOpen(); };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && drawerOpen() && !modalOpen()) { e.preventDefault(); if (document.querySelector(".pop")) closePopover(); else closeSettings(); return; }
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key !== ",") return;
    if (drawerOpen() ? modalOpen() : !settingsShown()) return;
    e.preventDefault();
    if (drawerOpen()) closeSettings(); else openSettings();
  });
  // The tabs: a click, or ←/→ and Home/End with the focus following, shows one.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("#b-drawer [role=tab]")];
  for (const t of tabs) {
    t.onclick = () => showTab(t.dataset.tab as Tab);
    t.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(t), n = tabs.length;
      const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      showTab(tabs[to]!.dataset.tab as Tab, true);
    });
  }
  showTab(tab);
  // the footer's count follows the shown run; a run shown anew is no longer the build just shown (showFinished sets it after)
  document.addEventListener("builderchange", (e) => {
    const key = (e as BuilderChange).detail.key;
    if (key === "openRun" || key === "character") builtWith = null;
    if (["openRun", "runs", "result"].includes(key)) paintChanges();
  });
  // Manual has no Build Settings button: the drawer closes on the way in
  document.addEventListener("builderchange", (e) => { if ((e as BuilderChange).detail.key === "mode" && session.mode === "manual") closeSettings(); });
}
// The drawer's tab, at load, from ui-prefs (app.mts applies it before initBuilder runs).
export function applyPanelPrefs(p: UiPrefs | null): void { if (p?.builderTab && TABS.includes(p.builderTab)) tab = p.builderTab; }
let settingsDrawer: DrawerHandle | null = null;
const drawerOpen = (): boolean => !!settingsDrawer?.isOpen();
// The result's breakdown row or share that opens the drawer (tuneWeight), which takes the focus back when it closes.
let opener: HTMLElement | null = null;
// Open the drawer on `on` (else the tab it had) with the focus on that tab; `focus` false when the caller focuses a
// control in it next. Closing it gives the focus back to the Build Settings button, or to the result row that opened it.
function openSettings(on: Tab = tab, focus = true): void {
  if (on !== tab) showTab(on);
  if (!drawerOpen()) {
    const b = $<HTMLButtonElement>("#b-settings")!;
    settingsDrawer!.open(opener?.isConnected ? opener : b);
    b.setAttribute("aria-expanded", "true");
  }
  opener = null;
  if (focus) $<HTMLElement>(`#b-tab-${tab}`)!.focus();
}
// Close it (a popover opened from it closes with it).
export function closeSettings(): void { settingsDrawer?.close(); }
// Show one tab's panel; the choice is kept for the next launch.
function showTab(to: Tab, focus = false): void {
  const changed = to !== tab;
  tab = to;
  for (const t of document.querySelectorAll<HTMLButtonElement>("#b-drawer [role=tab]")) {
    const on = t.dataset.tab === to;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  }
  for (const p of document.querySelectorAll<HTMLElement>("#b-panel-body [role=tabpanel]")) p.hidden = p.dataset.tab !== to;
  if (focus) $<HTMLElement>(`#b-tab-${to}`)!.focus();
  if (changed) prefs.set({ builderTab: to }, { quiet: true });
}
// The character list after the inventory or profiles changed (a first load, a scan landing, a Forget).
// A character still present stays selected and keeps its panel, unsaved edits included; the panel is redrawn
// so a newly scanned chest or gear skill is offered. Only when the selection is gone (or there was none) does
// it move: to the route's character, else the first.
document.addEventListener("inventorychange", () => syncBuilderCharacters());
// #/builder/<Name>: the route's character once the inventory is in; with no name, the route takes the selected one.
registerScreen({ name: "builder", show: (r) => {
  if (!state.inv) return;
  if (r.character && r.character !== session.character && (state.inv.characters[r.character] || (r.character === NOBODY && Object.keys(state.inv.characters).length > 0))) selectCharacter(r.character);
  else if (!r.character && session.character) history.replaceState(null, "", routeFor("builder"));
  commands.refreshCharPicker();   // a build label edited on the Characters page shows at once
} });
export function syncBuilderCharacters(): void {
  const names = characterNames(state.inv!.characters, state.profiles!.characters);
  const keep = session.character;
  if (keep && (names.includes(keep) || (keep === NOBODY && names.length)) && session.profile) {
    renderPanel();
    if (!session.result && !session.job) commands.renderCurrentSuit(keep, true);
  } else if (names.length) {
    const want = parseRoute().character;
    selectCharacter(names.includes(want as string) || want === NOBODY ? want as string : names[0]!);
  } else {
    session.character = null; session.profile = null;
    commands.refreshBuildPicker();
    $<HTMLElement>("#b-drawer-tpl")!.textContent = ""; $<HTMLElement>("#b-changes")!.textContent = "";
    $<HTMLElement>("#b-tpl-info")!.replaceWith(templateInfo(""));
    $<HTMLElement>("#b-panel-body")!.replaceChildren(el("p", { class: "muted b-no-char", id: "b-no-char" }, txt(NO_CHARACTER)));
    $<HTMLElement>("#b-result")!.replaceChildren(box("div", { class: "card empty-state" }, el("h2", { class: "t-lg" }, "No characters yet"), el("p", { class: "muted" }, txt("Import a scan and its character shows up here."))));
  }
  setNoCharacter(!names.length);
  commands.paintCharSelect();
  void commands.syncManual();
}
// With no character there is nothing to build or save: the Build and save buttons are disabled, and say why (NO_CHARACTER) — in
// their title, and in the drawer's own line that they are described by.
function setNoCharacter(none: boolean): void {
  for (const id of ["#b-run", "#b-run-foot", "#b-save", "#b-save-tpl"]) {
    const b = $<HTMLButtonElement>(id)!;
    if (!session.job) b.disabled = none;
    if (none) { b.title = NO_CHARACTER; b.setAttribute("aria-describedby", "b-no-char"); }
    else { b.removeAttribute("title"); b.removeAttribute("aria-describedby"); }
  }
}
// `open`: the saved run to show once its list is in, else (true) the character's latest when no result is on screen by then
// (ui/runs.mts loadRuns: coming back).
export function selectCharacter(name: string, open: string | true = true): void {
  session.character = name;
  if (parseRoute().tab === "builder") history.replaceState(null, "", routeFor("builder"));
  session.profile = characterProfile(state.profiles!, name, state.builtinTemplates);
  session.profile!.excludeRoots ??= [];
  commands.clearCapDrafts();
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
  // coming back decides between a saved run and the first-visit view once the runs are in (ui/runs.mts arriveAt); a build
  // running keeps its card over the first-visit view
  else if (session.job) commands.renderCurrentSuit(name);
  else $<HTMLElement>("#b-result")!.replaceChildren();
  commands.loadRuns(open);
  commands.paintCharSelect();
  commands.renderManual();
}

// ---------------------------------------------------------------- the panel
// The template controls go in the top bar, the rest in the drawer's tab panels, a group or three each.
function renderPanel(): void {
  const p = session.profile;
  if (!p) return;
  if (session.character === NOBODY) p.race = "human";   // No character has no race: the shard's caps (its Race control is hidden)
  p.floors ||= {}; p.softFloors ||= []; p.weights ||= {}; p.lockedSlots ||= []; p.excludeTags ||= []; p.excludeSkills ||= []; p.excludeRoots ||= [];
  $<HTMLElement>("#b-tpl-info")!.replaceWith(templateInfo(p.template || ""));
  const panel = (t: Tab, ...groups: HTMLElement[]): HTMLElement => {
    const n = box("section", { class: "b-tabp", role: "tabpanel", id: `b-tabp-${t}`, "aria-labelledby": `b-tab-${t}`, "data-tab": t }, ...groups);
    n.hidden = t !== tab;
    return n;
  };
  $<HTMLElement>("#b-panel-body")!.replaceChildren(panel("requirements", commands.requirementsSection()), panel("weights", commands.goalsSection(), commands.weightsSection()), panel("buffs", buffsSection()),
    panel("pool", poolSection()), panel("advanced", advancedSection(), charSection(), commands.capsSection()));
  updateTemplateBadge();
}
// Redraw one group in place (its rows changed), keeping the rest of the drawer and its scroll position as they are.
function redraw(id: SectionId): void {
  const build: Record<SectionId, () => HTMLElement> = { buffs: buffsSection, req: () => commands.requirementsSection(), caps: () => commands.capsSection(), goals: () => commands.goalsSection(), weights: () => commands.weightsSection(), pool: poolSection, adv: advancedSection };
  const old = document.getElementById(`b-sec-${id}`);
  if (old && build[id]) old.replaceWith(build[id]!());
  updateTemplateBadge();
}

// A What changed row's setting (builder-header.mts's popover, closed first): a weight through tuneWeight (Add weight when it
// was removed), a requirement's field (Add requirement when it was removed), a resist cap's field; anything else opens its tab
// with its group scrolled into view. Closing the drawer gives the focus back to `from`, the chip.
const CHANGE_TAB: Record<SettingsGroup, Tab> = { requirements: "requirements", weights: "weights", pool: "pool", buffs: "buffs", character: "advanced", search: "advanced" };
const CHANGE_SEC: Record<SettingsGroup, string> = { requirements: "req", weights: "weights", pool: "pool", buffs: "buffs", character: "char", search: "adv" };
function openChange(c: SettingsChange, from: HTMLElement): void {
  if (c.group === "weights" && c.key) { tuneWeight(c.key, from); return; }
  opener = from;
  const req = c.key ? `.rule-row[data-key="${CSS.escape(c.key)}"] input[type=number]` : "";
  if (c.group === "requirements" && c.key) focusIn("req", document.querySelector(`#b-sec-req ${req}`) ? req : "#b-addfloor", true);
  else if (c.group === "character" && c.key && (RESIST_KEYS as readonly string[]).includes(c.key)) { focusIn("caps", `#b-cap-${c.key}`, true); document.getElementById(`b-cap-${c.key}`)?.closest(".rule-row")?.scrollIntoView({ block: "nearest" }); }
  else { openSettings(CHANGE_TAB[c.group]); document.getElementById(`b-sec-${CHANGE_SEC[c.group]}`)?.scrollIntoView({ block: "start" }); }
}
// Race, STR limit and the casting school: the character's, saved with the profile; race and STR limit decide which pieces
// are candidates at all, the school the Faster Casting cap.
function charSection(): HTMLElement {
  const p = session.profile!;
  const race = segmented({ label: "Race", options: [{ value: "human", label: "Human" }, { value: "elf", label: "Elf" }, { value: "gargoyle", label: "Gargoyle" }], value: p.race || "human",
    onChange: (v) => { p.race = v; p.resistCaps = pruneResistCaps(p.resistCaps, v); redraw("req"); redraw("caps"); } });
  race.id = "b-race";
  const str = knobField("strLimit", "STR limit");
  str.classList.add("b-str");
  return group("char", "Character", () => [box("div", { class: "b-race-row" }, session.character === NOBODY ? null : box("div", { class: "field" }, el("span", { class: "label", id: "b-race-l" }, "Race"), race), str), castingSchoolField()]);
}
// Under the picker, for a template with a description: a built-in's badge, the description, the buffs it loads and its
// source pages (a built-in with none is the shard's defaults).
function templateInfo(ref: string): HTMLElement {
  const t = findTemplate(state.profiles!, state.builtinTemplates, ref), builtin = ref.startsWith(BUILTIN_PREFIX), on = t?.spec.buffs?.on ?? [];
  if (!t?.description) return el("div", { id: "b-tpl-info", hidden: "" });
  const sources = t.sources ?? [];
  return box("div", { id: "b-tpl-info", class: "help b-tpl-info" },
    el("p", {}, builtin ? badge("Built-in") : null, builtin ? " " : null, t.description),
    on.length ? el("p", {}, `Loads: ${on.map((id) => buffById(id)?.name ?? id).join(" · ")}`) : null,
    builtin ? el("p", {}, "Source: ", ...(sources.length ? sources.flatMap((u, i) => [i ? " · " : "", el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, sourceTitle(u))]) : ["UO Alive defaults"])) : null);
}
// A template is a saved set of builder settings with no character in it. What the panel's settings changed from the
// template they came from (what the old "modified" badge compared: the template, not the saved profile), its buffs included.
function templateChanges(tpl: NonNullable<ReturnType<typeof findTemplate>>): SettingsChange[] {
  const buffs = tpl.spec.buffs && templateBuffsLine(tpl.spec.buffs.on, buffsOn());
  return [...settingsChanges(templateSettings(tpl), templateFrom(readControls())), ...(buffs ? [{ group: "buffs" as const, text: buffs }] : [])];
}
// What differs from the character's saved profile: what Save profile would keep, and a template pick would lose. A STR limit
// the profile never saved is the character's default, as the panel shows it, and No character is always human.
function unsavedChanges(): SettingsChange[] {
  const name = session.character!, saved = characterProfile(state.profiles!, name, state.builtinTemplates);
  saved.strLimit ??= defaultStrLimit(state.inv!.characters[name]);
  if (name === NOBODY) saved.race = "human";
  const cmp = (x: typeof saved): RunSettings => ({ ...templateFrom(x), race: x.race ?? undefined, strLimit: x.strLimit, onlyRoots: x.onlyRoots, excludeRoots: x.excludeRoots });
  return settingsChanges(cmp(saved), cmp(readControls()));
}
// The build picker's state line and its full text (builder-model.mts buildStateText, buildStateDetail).
function buildState(): BuildState {
  const p = session.profile!, ref = p.template, tpl = ref ? findTemplate(state.profiles!, state.builtinTemplates, ref) : undefined;
  const st = { template: ref ? plainName(ref) : null, missing: !!ref && !tpl }, changed = tpl ? templateChanges(tpl) : [], unsavedList = unsavedChanges();
  const changedLines = changed.map((c) => c.text), unsavedLines = unsavedList.map((c) => c.text);
  return { text: buildStateText({ ...st, changed: changedLines.length, unsaved: unsavedLines.length }), detail: buildStateDetail({ ...st, name: session.character!, changedLines, unsavedLines }),
    drift: !tpl || changedLines.length > 0, unsaved: unsavedLines.length > 0, template: tpl ? st.template : null, changed, unsavedList };
}
// Redrawn after every edit: the build picker's face, its full text for a screen reader (#b-tpl-state, the button's
// description), the What changed chip, the drawer's head, and the footer's count of the changes since the last build.
function updateTemplateBadge(): void {
  if (!session.profile) return;
  const st = buildState();
  commands.refreshBuildPicker();
  commands.paintChangesChip(st);
  $<HTMLElement>("#b-tpl-state")!.textContent = `${st.text}. ${st.detail}`;
  $<HTMLElement>("#b-drawer-tpl")!.textContent = st.text;
  paintChanges();
  commands.refreshCurrentSuit();
}
// The footer's "N changes since the last build": what the runs drawer's diff (runSettingsDiff) names between the shown
// run and the panel, hidden with no run shown. While the run on screen is the one a build just showed, it counts from
// the settings that build was asked with: one answered from an earlier run carries that run's own search knobs. Any
// other run shown (one opened from the drawer, that same run reopened, another character) clears it, so the count
// then agrees with the drawer's banner. Repainted a moment after the last edit, so typing does not plan the whole
// build on every key.
let builtWith: { runId: string; settings: RunSettings } | null = null;
let changesTimer: ReturnType<typeof setTimeout> | undefined;
function paintChanges(): void {
  clearTimeout(changesTimer);
  changesTimer = setTimeout(() => {
    const out = $<HTMLElement>("#b-changes")!, run = session.openRun ? session.runs.find((r) => r.id === session.openRun) : null;
    // the progress card and its Cancel are behind the drawer's scrim: say how to reach them
    if (session.job) { out.textContent = "Building… Close Build Settings (Esc) to see its progress or cancel it."; return; }
    if (!run || !session.profile) { out.textContent = ""; return; }
    const n = runSettingsDiff(builtWith?.runId === run.id ? builtWith.settings : run.settings, panelBuild().snapshot).length;
    out.textContent = n ? `${plural(n, "change")} since the last build` : "No changes since the last build";
  }, 150);
}

// ---- buffs (issue #12): the ones on count as always on, so the search doesn't spend gear on what they give
// Kept in the character's profile (its spec's buffs, saved at once). The numbers they scale with are the character's, and
// an edited one is shared with Manual. `note` is what the picker says until the next change: the form a just-turned-on
// form replaced, or the buffs Clear all took off, each with Undo.
let note: { replaced: { on: string; off: string } } | { cleared: string[] } | null = null;
let picker: BuffPicker | null = null;
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
// The tab lists the buffs by school (issue #272), each with its switch and what it changes in the suit maths, a school's
// heading the character's skill in it. Whether a buff counts is the plan's own answer (buffAvailability, at the numbers a
// build plans with, typed ones included): one the plan blocks is greyed with what it needs, and one that leans on a skill
// the scan lacks says it is counted at the default. Until Show all (kept for the page session) the list holds what the
// character can use and any that are on; the lead line names what waits. With No character, or a scan that carries no
// skills, every buff is listed, and no skill. The picker (Search and edit numbers) holds the rest: the search, the numbers
// they scale with, Clear all. A toggle redraws the list only, so the picker's anchor stays.
let allBuffs = false;
function buffsSection(): HTMLElement {
  const v = buffView(), own = scannedSkills(v);
  const add = button({ label: "Search and edit numbers", icon: "search", variant: "ghost", size: "sm", attrs: { id: "b-buff-add", "aria-haspopup": "dialog" } });
  add.onclick = () => openBuffPicker(add);
  const all = button({ label: allBuffs ? "Show usable only" : "Show all", variant: "ghost", size: "sm", attrs: { id: "b-bf-all" },
    onClick: () => { allBuffs = !allBuffs; all.querySelector("span")!.textContent = allBuffs ? "Show usable only" : "Show all"; document.getElementById("b-bf-list")?.replaceWith(buffList()); } });
  const lead = own ? `Listed: the buffs ${v.name} can use and any that are on. Show all adds the ones that need more skill or a skill not in ${v.name}'s scan.`
    : v.name ? `Every buff is listed: ${v.name}'s scan carries no skills, so each counts at 120.` : "Every buff is listed: with no character every skill counts at 120.";
  return group("buffs", null, () => [box("div", { class: "b-bf-lead" }, el("p", { class: "help" }, txt(lead)), own ? all : null), buffList(),
    el("p", { class: "help" }, txt("Counted as always on. The search doesn't spend gear on what they already give.")), add]);
}
// The character's scanned skills, or null with No character or a scan that carries none.
function scannedSkills(v: BuffView): Record<string, unknown> | null {
  const sk = v.name ? state.inv!.characters[v.name]?.skills ?? {} : {};
  return Object.keys(sk).length ? sk : null;
}
function buffList(): HTMLElement {
  const v = buffView(), own = scannedSkills(v);
  // a school's heading: a typed number, else the scan's skill, else that the scan lacks it
  const level = (g: string): string | null => {
    if (!own || !isSchool(g)) return null;
    if (Object.hasOwn(v.edits, g)) return `skill ${v.edits[g]} (typed)`;
    const n = Number((own[g] as { value?: unknown } | undefined)?.value) || 0;
    return n ? `skill ${n}` : Object.hasOwn(own, g) ? "not trained" : "not in the scan";
  };
  const groups = BUFF_GROUPS.flatMap((g) => {
    const rows = BUFFS.filter((b) => b.group === g.name).map((b) => ({ b, ...buffAvailability(b, v.values, v.planned, v.edits, v.who) }))
      .filter(({ b, needs, unscanned }) => allBuffs || !own || v.on.includes(b.id) || (!needs && !unscanned.length));
    if (!rows.length) return [];
    const lv = level(g.name), head = box("div", { class: "b-bf-head" }, txt(g.name, "caps"), lv ? txt(lv, "t-sm muted") : null);
    return [box("section", { class: "b-bf-group", "aria-label": g.name }, head, ...rows.map(({ b, needs, unscanned }) => buffRow(b, needs, own ? unscanned : [], v)))];
  });
  return box("div", { class: "b-bf-list", id: "b-bf-list" }, ...groups);
}
// One buff: its switch and name, what it changes (buffEffectTags), and under them what it needs, else the skills the scan
// lacks that it is counted at the default for, else its note.
function buffRow(b: Buff, needs: string | null, unscanned: string[], v: BuffView): HTMLElement {
  const on = v.on.includes(b.id), lid = `b-bf-${b.id.replace(/\W/g, "-")}-d`;
  const missing = unscanned.length ? `${unscanned.map((i) => BUFF_INPUTS[i]!.label).join(", ")} not in the scan: counted at ${BUFF_INPUTS[unscanned[0]!]!.def}` : null;
  const line = needs ? box("span", { class: "t-sm tone-warn b-bf-line b-bf-need" }, icon("alert", { size: "sm" }), txt(needs)) : missing ?? b.note ? txt((missing ?? b.note)!, "t-sm muted b-bf-line") : null;
  const sw = switchControl({ label: b.name, checked: on, disabled: !!b.race && !!needs && !on, onChange: () => buffActions.toggle(b.id),
    attrs: { id: `b-bf-${b.id.replace(/\W/g, "-")}`, "aria-label": b.name, "aria-describedby": lid } });
  sw.root.lastElementChild!.replaceWith(box("span", { class: "b-bf-text" }, txt(b.name, "strong"),
    box("span", { class: "b-bf-fx", id: lid }, ...buffEffectTags(b.id, v.values, v.stats, v.totals, v.who, v.caps).map((t) => txt(t.text, t.down ? "b-bf-down" : undefined)), line)));
  sw.root.classList.add("b-bf");
  if (needs) sw.root.classList.add("b-bf-cant");
  sw.root.dataset.buff = b.id;
  return sw.root;
}
// The picker's state: the buffs on, their numbers, and what each would add, against the caps before any buff.
function buffView(): BuffView {
  const name = session.character!, p = session.profile!, inputs = commands.buffInputsOf(name), plan = buffPlan(name, p.race, { on: buffsOn(), skills: {} });
  // what the character wears now, evaluated with the panel's buffs (app/evaluate.mts)
  const ev = evaluateSuit({ profile: p, character: state.inv!.characters[name] as Character | null, suit: Object.fromEntries((state.inv!.worn[name] || []).map((i) => [String(i.serial), i])), buffs: plan });
  return { name: name === NOBODY ? null : name, on: plan.on, values: plan.skills, planned: inputs.planned, edits: commands.buffEditsOf(name), stats: plan.stats, who: plan.who,
    totals: ev.gearTotals, caps: ev.baseCaps, all: ev.buffs, replaced: note && "replaced" in note ? note.replaced : null,
    cleared: note && "cleared" in note ? note.cleared : null, count: true, open: !!picker };
}
// A buff on or off (or all off), with the picker's note: saved, and the chips, the requirements' notes and the picker
// follow.
function setBuffs(next: string[], n: typeof note): void {
  setPanelBuffs(next);
  note = n;
  // the tab's list is redrawn whole: a switch that had the focus keeps it, or Search and edit numbers takes it when its row went
  const f = document.activeElement?.closest("#b-bf-list") ? document.activeElement.id : null;
  document.getElementById("b-bf-list")?.replaceWith(buffList());   // the list only: Search and edit numbers anchors the picker
  redraw("req"); redraw("weights");   // the switch's step line counts the buffs' stamina and SSI
  if (f) (document.getElementById(f) ?? document.getElementById("b-buff-add"))?.focus();
  picker?.paint(buffView());
}
const buffActions: PickerActions = {
  toggle: (id) => {
    const { next, replaced: off } = toggleBuff(buffsOn(), id);
    setBuffs(next, off ? { replaced: { on: id, off } } : null);
  },
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
// Add buff opens the picker in a popover beside the drawer, on its left; a second press, Esc or a click outside closes it.
function openBuffPicker(anchor: HTMLElement): void {
  if (picker) { closePopover(); return; }
  const host = box("div", { class: "bf-pick" });
  picker = createBuffPicker(host, "abf", buffActions, () => "Counted as always on: the search plans around them. A bonus past the cap, like Enemy of One's damage, never changes the plan.");
  popover(anchor, [host], { label: `Buffs for ${who(session.character!)}`, width: 480, beside: $<HTMLElement>("#b-drawer")!, onClose: () => { picker = null; note = null; } });
  picker.paint(buffView());
  picker.focusSearch();
}

// Focus a control in a group, the drawer opened on the group's tab first.
function focusIn(sec: FocusSection, sel: string, selectText = false): void {
  openSettings(TAB_OF[sec], false);
  const e = document.querySelector<HTMLInputElement>(`#b-sec-${sec} ${sel}`);
  e?.focus();
  if (selectText) e?.select();
}
// A score breakdown row's property in the Build Settings drawer: its weight's field, else Add weight; Other (null) opens the Weights tab. Closing the drawer then puts the focus back on the row (`from`). With goals setting the weights, the weights are shown under them first (fineTune).
function tuneWeight(key: string | null, from: HTMLElement): void {
  opener = from;
  commands.showGoalWeights();
  if (key == null) openSettings("weights");
  else if (session.profile?.weights?.[key] != null) focusIn("weights", `.rule-row[data-key="${CSS.escape(key)}"] input`, true);
  else focusIn("weights", "#b-addweight");
}

// ---- candidate pool
function poolSection(): HTMLElement {
  const p = session.profile!;
  return group("pool", null, () => {
    const sw = (id: string, text: string, key: "allowOthersWorn" | "allowGargoyle" | "medOnly"): HTMLLabelElement =>
      switchControl({ label: text, checked: !!p[key], attrs: { id }, onChange: (v) => { p[key] = v; updateTemplateBadge(); } }).root;
    return [
      box("div", { class: "b-switches" }, sw("b-others", "Allow gear worn by other characters", "allowOthersWorn"), sw("b-garg", "Allow gargoyle-only gear", "allowGargoyle"), sw("b-med", "Meditation-safe gear only", "medOnly")),
      rarityField(),
      box("div", { class: "b-chips" }, weaponChip(), mustHaveChip(), listChip("b-locked", "Locked slots", () => p.lockedSlots!, (v) => { p.lockedSlots = v; }, () => GEAR_SLOTS.map((s) => ({ value: s, label: slotLabel(s) })), false),
        tagsChip(), listChip("b-exroots", "Skip containers", () => p.excludeRoots!.map(String), (v) => { p.excludeRoots = v.map((x) => (Number.isFinite(Number(x)) ? Number(x) : x)); }, rootOptions, true),
        // issue #12: only pieces under these root containers (kept only when it lists any); Skip containers still applies
        listChip("b-onlyroots", "Only containers", () => (p.onlyRoots || []).map(String), (v) => { if (v.length) p.onlyRoots = v.map(Number); else delete p.onlyRoots; }, () => withStoredRoots(rootOptions(), p.onlyRoots), true)),
    ];
  });
}
// The casting school the Faster Casting cap follows: "From skills" (the default, stored as no choice) or a school.
function castingSchoolField(): HTMLElement {
  const p = session.profile!;
  const sel = select([{ value: "", label: "From skills" }, ...CASTING_SCHOOLS.map((s) => ({ value: s, label: s }))], p.castingSchool || "", { size: "sm", attrs: { id: "b-school" } });
  const note = fcCapNote();
  sel.addEventListener("change", () => {
    if (sel.value) p.castingSchool = sel.value; else delete p.castingSchool;
    note.textContent = fcCapText(panelFcCap());
    updateTemplateBadge(); redraw("req"); redraw("weights");
  });
  return box("div", { class: "b-school" }, field({ label: "Casting school (Faster Casting cap)", control: sel }), note);
}
// The rarity preference (issue #262): Higher, Any (the default, stored as no choice) or Lower, with a help line when one is set.
function rarityField(): HTMLElement {
  const p = session.profile!;
  const help = el("p", { class: "help", id: "b-rarity-help" }, rarityHelpText());
  const seg = segmented({ label: "Rarity", size: "sm", options: [{ value: "higher", label: "Higher" }, { value: "", label: "Any" }, { value: "lower", label: "Lower" }], value: p.rarity || "",
    onChange: (v) => { if (v === "higher" || v === "lower") p.rarity = v; else delete p.rarity; help.textContent = rarityHelpText(); help.hidden = !p.rarity; updateTemplateBadge(); } });
  seg.id = "b-rarity";
  help.hidden = !p.rarity;
  return box("div", { class: "b-rarity" }, box("div", { class: "field" }, el("span", { class: "label" }, "Rarity"), seg), help);
}
const rarityHelpText = (): string => rarityHelp(session.profile!.rarity);
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
// The Weapons chip: a checklist of the weapon skills and Spellbooks, where a tick EXCLUDES that skill's weapons (or every
// spellbook) from the pool, and under it the Use Best Weapon Skill switch (profile `ubwsAnyWeapon`, absent means on).
function weaponChip(): HTMLButtonElement {
  const p = session.profile!;
  const text = (): string => weaponsChipText(p.excludeWeapons, p.ubwsAnyWeapon !== false);
  const chip = filterChip({ label: text(), set: !!p.excludeWeapons?.length, attrs: { id: "b-weapon" } });
  chip.onclick = () => {
    const checks = WEAPON_EXCLUDES.map((w) => check({ label: weaponName(w), checked: !!p.excludeWeapons?.includes(w), attrs: { value: w }, onChange: (on) => {
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
// The Weapon must have chip (issue #214): a checklist of yes/no properties every weapon in the pool must carry (profile
// `weaponMustHave`, kept only when it lists any). Shields and spellbooks are never held to it.
function mustHaveChip(): HTMLButtonElement {
  const p = session.profile!;
  const chip = filterChip({ label: weaponMustHaveChipText(p.weaponMustHave), set: !!p.weaponMustHave?.length, attrs: { id: "b-wflags" } });
  chip.onclick = () => {
    const checks = WEAPON_MUST_HAVE.map((f) => check({ label: flagLabel(f), checked: !!p.weaponMustHave?.includes(f), attrs: { value: f }, onChange: (on) => {
      const next = WEAPON_MUST_HAVE.filter((x) => (x === f ? on : p.weaponMustHave?.includes(x)));
      if (next.length) p.weaponMustHave = next; else delete p.weaponMustHave;
      paintChip(chip, weaponMustHaveChipText(p.weaponMustHave), !!next.length); updateTemplateBadge();
    } }).root);
    popover(chip, [el("p", { class: "help" }, txt("Only weapons with every checked property enter the pool. A locked weapon stays either way.")),
      box("div", { class: "b-checks", role: "group", "aria-label": "Weapon must have" }, ...checks)], { label: "Weapon must have" });
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
  chip.onclick = () => checklist(chip, title, get, set, options(), searchable, () => paintChip(chip, text(), !!get().length));
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
  i.addEventListener("input", () => { knobs[f] = i.value; setFieldError(i, knobError(f, i.value)); if (f === "strLimit") updateTemplateBadge(); else paintChanges(); });
  return fl;
}
function advancedSection(): HTMLElement {
  return group("adv", "Search", () => {
    const exact = switchControl({ label: "Exact search (prove the best)", checked: knobs.exact, attrs: { id: "b-exact" }, onChange: (v) => { knobs.exact = v; redraw("adv"); document.getElementById("b-exact")?.focus(); } });
    return [box("div", { class: "b-adv" }, box("div", { class: "b-adv-wide" }, exact.root),
      knobField("restarts", "Restarts"), knobField("budgetS", "Time budget (s)"), knobField("altCount", "Other suits"), knobField("altTol", "Within points"),
      el("p", { class: "help b-adv-wide" }, txt(knobs.exact ? "Other suits lists the next best suits scoring within that many points of the best." : "Time budget and other suits need exact search.")))];
  });
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
// Build with a bad field: the drawer opens on Advanced, which holds every knob, with the error under the field and the
// focus in it.
function focusKnob(f: KnobField, err: string): void {
  openSettings("advanced", false);
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
  // No character builds on the shard's caps: human, whatever race a saved entry says
  return planBuild(spec, { character: (state.inv!.characters[name] as Character | undefined) ?? null, worn: state.inv!.worn[name] || [], race: name === NOBODY ? "human" : p.race });
}
// `focus`: the finished build's heading takes the focus the progress card had (tabindex -1: a target, not a stop).
function showFinished(f: FinishedBuild, focus = false): void {
  session.result = f.result;
  session.openRun = f.runId;   // clears builtWith (below), then it is this build's
  builtWith = f.runId ? { runId: f.runId, settings: f.settings } : null;
  session.altView = null;
  commands.renderResult(f.result, f.current, f.profile, f.name, f.meta).then(() => {
    const h = focus ? $<HTMLElement>("#b-result h2") : null;
    if (h) { h.tabIndex = -1; h.focus(); }
  }).catch(commands.resultLoadError);
}

// ---------------------------------------------------------------- save
async function saveProfile(said?: string): Promise<void> {
  if (!session.character || !session.profile) { toast("No character to save a profile for yet: scan one first.", "bad"); return; }
  // The panel's settings as a saveCharacter edit (app/profile-edits.mts), which keeps what the panel doesn't edit: the
  // saved buffs and label, any other field of the entry, and the spec's goal and search. A refused save reloads the
  // profiles, so the build's line still counts the panel's changes as unsaved.
  const name = session.character!, entry = characterEntry(readControls(), characterBuffs(state.profiles!, name));
  const r = await editProfiles([{ op: "saveCharacter", name, entry }]);
  toast(r.ok ? said ?? `Profile for ${who(name)} saved.` : r.error!, r.ok ? "good" : "bad");
  updateTemplateBadge();
}
provide({ renderPanel, panelBuild, buffPlan, loadRunBuffs, tuneWeight, selectCharacter, openSettingsTab: (t, focus) => openSettings(t as Tab, focus),
  buildState, unsavedChanges, openChange, updateTemplateBadge, redraw, focusIn, saveProfile: (said) => { void saveProfile(said); }, focusKnob, paintChanges, showFinished });
