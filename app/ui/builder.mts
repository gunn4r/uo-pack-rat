// ui/builder.mts — the Suit Builder screen (design spec 4.6): the character select in the top bar, the 360 px
// constraints panel (template, race, requirements, weights, candidate pool, Advanced) with its sticky Build
// footer, the optimize job (inline progress card over SSE) and the empty state (the character's current
// suit). The result, the compare view and the Solver details are ui/builder-result.mts; the saved-runs drawer
// is ui/runs.mts. The panel is drawn from state.builder.profile plus the Advanced knobs below, so what a
// build sends, what a profile saves and what a run snapshots are read from state, never from the DOM.
import { PROP_LABELS, OPTIMIZER_SLOTS, tagUnits, WEAPON_SKILLS, resistSkillBonus, effectiveProfile, getRules, RESIST_KEYS, templateFrom, settingsDiff, bagLabel } from "../vault-lib.mts";
import type { EffectiveProfile, RunSettings, Character } from "../vault-lib.mts";
import { state, invStamp } from "./store.mts";
import type { BuilderProfile, BuilderJob, BuilderJobUi, FinishedBuild, BuildMeta } from "./store.mts";
import { $, el, label, full, fmtN, fmtSecs, slotLabel, toast } from "./dom.mts";
import { promptText } from "./dialog.mts";
import { box, txt, button, icon, kbd, badge, message, select, input, field, switchControl, check, segmented, filterChip, pill, popover, closePopover, searchInput, stepper, progress, tooltip, confirmDialog } from "./components.mts";
import { api, CLIENT_ID } from "./api.mts";
import { optimizeErrorMessage } from "./messages.mts";
import { parseRoute, routeFor } from "./app.mts";
import { setNavBusy } from "./shell.mts";
import { loadRuns, settingsSnapshot, openRunsDrawer } from "./runs.mts";
import { renderResult, renderCurrentSuit, refreshCurrentSuit, resultLoadError, closeCompare, resetResultView } from "./builder-result.mts";
import { propName, weightsSummary, requirementsSummary, poolSummary, advancedSummary, knobError, firstKnobError, knobFromServerError, ruleValueError, type Knobs, type KnobField } from "./builder-model.mts";
import type { OptimizeResult, OptimizeProgress, SavedRunLike, OptimizeStartApiResponse, OptimizeCancelApiResponse, JobSnapshotEvent, JobDoneEvent, JobFailedEvent, JobCancelledEvent } from "./api-types.mts";

// ---------------------------------------------------------------- panel state
// The Advanced fields as typed (strings, so a bad value can sit in its field with its error until fixed) and
// which sections are open. STR limit lives on the profile too (it is saved with it); the others are search
// options a profile never carried.
export const knobs: Knobs = { strLimit: "", restarts: "200", exact: true, budgetS: "300", altCount: "5", altTol: "0" };
const open: Record<string, boolean> = { req: true, weights: false, pool: true, adv: false };
const KNOB_IDS: Record<KnobField, string> = { strLimit: "b-str", restarts: "b-restarts", budgetS: "b-budget", altCount: "b-altcount", altTol: "b-alttol" };

// ---------------------------------------------------------------- wiring
// The builder's listeners, attached once for the page's life (app.mts's load()). Everything that depends on
// the inventory is syncBuilderCharacters()'s job, which runs on every load and refresh.
export function initBuilder(): void {
  $<HTMLSelectElement>("#b-char")!.onchange = () => selectCharacter($<HTMLSelectElement>("#b-char")!.value);
  $<HTMLButtonElement>("#b-run")!.onclick = runBuild;
  $<HTMLButtonElement>("#b-save")!.onclick = saveProfile;
  $<HTMLButtonElement>("#b-runs-open")!.onclick = openRunsDrawer;
  // ⌘↵ (Ctrl+Enter off the Mac) builds from anywhere on the screen.
  $<HTMLElement>("#tab-builder")!.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !state.builder.job) { e.preventDefault(); runBuild(); }
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
export function syncBuilderCharacters(): void {
  const names = [...new Set([...Object.keys(state.inv!.characters), ...Object.keys(state.profiles!.characters || {})])];
  const keep = state.builder.character;
  $<HTMLSelectElement>("#b-char")!.replaceChildren(...names.map((n) => el("option", { value: n }, n)));
  if (keep && names.includes(keep) && state.builder.profile) {
    $<HTMLSelectElement>("#b-char")!.value = keep;
    renderPanel();
    if (!state.builder.result && !state.builder.job) renderCurrentSuit(keep);
  } else if (names.length) {
    const want = parseRoute().character;
    selectCharacter(names.includes(want as string) ? want as string : names[0]!);
  } else {
    state.builder.character = null; state.builder.profile = null;
    $<HTMLElement>("#b-panel-body")!.replaceChildren();
    $<HTMLElement>("#b-result")!.replaceChildren(box("div", { class: "card empty-state" }, el("h2", { class: "t-lg" }, "No characters yet"), el("p", { class: "muted" }, txt("Import a scan and its character shows up here."))));
  }
}
export function selectCharacter(name: string): void {
  state.builder.character = name;
  if (parseRoute().tab === "builder") history.replaceState(null, "", routeFor("builder"));
  const profiles = state.profiles!;
  const saved = profiles.characters?.[name];
  const [firstTpl] = Object.keys(profiles.templates || {});
  state.builder.profile = saved ? JSON.parse(JSON.stringify(saved)) : { ...templateFrom(profiles.templates?.[firstTpl as string]), template: firstTpl, race: "human" };
  state.builder.profile!.excludeRoots ??= [];
  $<HTMLSelectElement>("#b-char")!.value = name;
  const c = state.inv!.characters[name];
  knobs.strLimit = String(state.builder.profile!.strLimit ?? (c ? (c.stats as Record<string, number>).str ?? 125 : 125));
  renderPanel();
  state.builder.compare = new Set(); state.builder.openRun = null; state.builder.result = null;
  closeCompare();
  resetResultView();   // a result still resolving its pieces for the previous character must not draw now
  if (!state.builder.job) $<HTMLElement>("#b-msg")!.replaceChildren();   // a running build keeps its progress card
  // A build that finished while another character was on screen waits here for its own character.
  const parked = state.builder.parked;
  if (parked?.name === name) { state.builder.parked = null; showFinished(parked); }
  else renderCurrentSuit(name);
  loadRuns();
}
// The profile with the panel's STR limit folded in: what a build sends and a profile saves.
export function readControls(): BuilderProfile {
  const p = state.builder.profile!;
  if (!knobError("strLimit", knobs.strLimit)) p.strLimit = Number(knobs.strLimit);
  return p;
}
// Settings a saved run carried, back into the panel ("Load these settings").
export function applyKnobs(st: RunSettings): void {
  if (st.strLimit != null) knobs.strLimit = String(st.strLimit);
  if (st.restarts != null) knobs.restarts = String(st.restarts);
  if (st.exact != null) knobs.exact = !!st.exact;
  if (st.budgetMs != null) knobs.budgetS = String(st.budgetMs / 1000);
  if (st.altCount != null) knobs.altCount = String(st.altCount);
  if (st.altTol != null) knobs.altTol = String(st.altTol);
}

// ---------------------------------------------------------------- the panel
export function renderPanel(): void {
  const p = state.builder.profile;
  if (!p) return;
  p.floors ||= {}; p.softFloors ||= []; p.weights ||= {}; p.lockedSlots ||= []; p.excludeTags ||= []; p.excludeSkills ||= []; p.excludeRoots ||= [];
  $<HTMLElement>("#b-panel-body")!.replaceChildren(templateSection(), requirementsSection(), weightsSection(), poolSection(), advancedSection());
  updateTemplateBadge();
}
// Redraw one section in place (its open state or its rows changed), keeping the rest of the panel and its
// scroll position as they are.
function redraw(id: string): void {
  const build: Record<string, () => HTMLElement> = { req: requirementsSection, weights: weightsSection, pool: poolSection, adv: advancedSection };
  const old = document.getElementById(`b-sec-${id}`);
  if (old && build[id]) old.replaceWith(build[id]!());
  updateTemplateBadge();
}
// A collapsible section: title, an optional count badge, the open/close button, and when closed a one-line
// summary in place of its body.
function section(id: string, title: string, { count, summary, body, inline = false }: { count?: number | undefined; summary: () => string; body: () => Array<Node | null>; inline?: boolean }): HTMLElement {
  const isOpen = open[id], hid = `b-sec-${id}-h`, bid = `b-sec-${id}-body`;
  const t = button({ label: `${isOpen ? "Collapse" : "Expand"} ${title.toLowerCase()}`, icon: isOpen ? "chevron-up" : "chevron-down", iconOnly: true, variant: "ghost", size: "sm",
    attrs: { "aria-expanded": String(isOpen), "aria-controls": bid }, onClick: () => { open[id] = !open[id]; redraw(id); document.querySelector<HTMLElement>(`#b-sec-${id} .b-sec-head .btn`)?.focus(); } });
  const sum = isOpen ? null : txt(summary(), `t-sm muted${inline ? " ellip" : ""}`);
  const head = box("div", { class: "b-sec-head" }, el("h3", { id: hid, class: "t-md strong" }, title), count != null ? badge(String(count)) : null,
    inline && sum ? sum : el("span", { class: "spacer" }), t);
  return box("section", { class: "b-sec", id: `b-sec-${id}`, "aria-labelledby": hid }, head,
    !isOpen && !inline ? el("p", {}, sum) : null,
    isOpen ? box("div", { class: "b-sec-body", id: bid }, ...body()) : null);
}

// ---- template and race
function templateSection(): HTMLElement {
  const p = state.builder.profile!;
  const names = Object.keys(state.profiles!.templates ||= {});
  const tpl = select(names.map((n) => ({ value: n, label: n })), names.includes(p.template as string) ? p.template as string : names[0] || "", { attrs: { id: "b-tpl" } });
  tpl.addEventListener("change", updateTemplateBadge);
  const menuBtn = button({ label: "Template actions: apply, save as, update, delete", icon: "more", iconOnly: true, variant: "ghost", attrs: { id: "b-tpl-menu", "aria-haspopup": "menu", "aria-expanded": "false" } });
  menuBtn.onclick = () => templateMenu(menuBtn);
  const race = segmented({ label: "Race", options: [{ value: "human", label: "Human" }, { value: "elf", label: "Elf" }, { value: "gargoyle", label: "Gargoyle" }], value: p.race || "human",
    onChange: (v) => { p.race = v; redraw("req"); } });
  race.id = "b-race";
  return box("section", { class: "b-sec b-sec-top", "aria-label": "Template" },
    box("div", { class: "field" }, el("label", { class: "label", for: "b-tpl" }, "Template"), box("div", { class: "b-tpl-row" }, tpl, el("span", { id: "b-tpl-state", class: "badge" }), menuBtn)),
    box("div", { class: "field" }, el("span", { class: "label", id: "b-race-l" }, "Race"), race));
}
// A template is a saved set of builder settings with no character in it; the badge says whether the panel
// still matches the one it was applied from.
function templateDrift(): { tone: "ok" | "warn" | "bad" | ""; text: string; detail: string } {
  const name = state.builder.profile!.template, tpl = state.profiles!.templates?.[name as string];
  if (!name) return { tone: "", text: "none", detail: "Save as… stores these settings as a template." };
  if (!tpl) return { tone: "bad", text: "missing", detail: `These settings came from a template named ${name}, which no longer exists.` };
  const lines = settingsDiff(templateFrom(tpl), templateFrom(readControls()));
  return lines.length ? { tone: "warn", text: "modified", detail: `Changed from ${name}: ${lines.join(" · ")}` } : { tone: "ok", text: "matches", detail: `These settings equal the ${name} template.` };
}
// Redrawn after every edit; the reason ("Changed from melee: DI floor 20 → 30") is its tooltip and, for a
// screen reader, part of its text.
export function updateTemplateBadge(): void {
  const s = $<HTMLElement>("#b-tpl-state");
  if (!s || !state.builder.profile) return;
  const d = templateDrift();
  const next = box("span", { id: "b-tpl-state", class: `badge${d.tone ? " " + d.tone : ""}`, tabindex: "0" }, txt(d.text), el("span", { class: "sr" }, `. ${d.detail}`));
  s.replaceWith(tooltip(next, d.detail));
  refreshCurrentSuit();
}
// A "⋯" menu: menu items in a popover, ↑/↓ between them, Esc back to the button (the popover's own).
export interface MenuItem { text: string; run: () => unknown; id?: string | undefined; danger?: boolean | undefined }
export function openMenu(anchor: HTMLElement, label: string, items: MenuItem[], width = 220): void {
  const buttons = items.map((it) => box("button", { class: `menu-item${it.danger ? " danger" : ""}`, type: "button", role: "menuitem", ...(it.id ? { id: it.id } : {}), onclick: () => { closePopover(); it.run(); } }, txt(it.text)));
  const pop = popover(anchor, buttons, { label, role: "menu", width });
  if (anchor.closest(".drawer-root")) pop.root.classList.add("pop-over-drawer");   // a menu opened in a drawer sits above it
  pop.root.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement), step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step) { e.preventDefault(); buttons[(i + step + buttons.length) % buttons.length]!.focus(); }
  });
}
function templateMenu(anchor: HTMLButtonElement): void {
  openMenu(anchor, "Template actions", [{ id: "b-tpl-apply", text: "Apply to these settings", run: applyTemplate }, { id: "b-tpl-saveas", text: "Save as…", run: saveTemplateAs },
    { id: "b-tpl-update", text: "Update this template", run: updateTemplate }, { id: "b-tpl-delete", text: "Delete…", run: deleteTemplate, danger: true }]);
}
const selectedTemplate = (): string => $<HTMLSelectElement>("#b-tpl")!.value;
async function putProfiles(): Promise<{ ok: boolean; error?: string }> {
  try { return await api<{ ok: boolean; error?: string }>("/api/profiles", { method: "PUT", body: state.profiles }); }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}
async function saveTemplates(done: string): Promise<void> {
  const r = await putProfiles();
  // putProfiles()'s only `ok: false` path is its own catch, which always sets `error`.
  toast(r.ok ? done : r.error!, r.ok ? "good" : "bad");
}
function applyTemplate(): void {
  const name = selectedTemplate(), t = state.profiles!.templates![name];
  if (!t) return;
  Object.assign(state.builder.profile!, templateFrom(t), { template: name });
  renderPanel();
  toast(`${name} applied. Save profile to keep it.`, "good");
}
async function saveTemplateAs(): Promise<void> {
  const name = await promptText({ title: "Template name", value: state.builder.profile!.template || "" });
  if (!name || (state.profiles!.templates![name] && !await confirmDialog({ title: `Overwrite the ${name} template?`, body: `The ${name} template is replaced with these settings.`, confirmLabel: `Overwrite ${name}` }))) return;
  state.profiles!.templates![name] = templateFrom(readControls());
  state.builder.profile!.template = name;
  renderPanel();
  await saveTemplates(`Template ${name} saved.`);
}
async function updateTemplate(): Promise<void> {
  const name = selectedTemplate();
  if (!state.profiles!.templates![name] || !await confirmDialog({ title: `Update the ${name} template?`, body: `The ${name} template is overwritten with these settings.`, confirmLabel: `Update ${name}` })) return;
  state.profiles!.templates![name] = templateFrom(readControls());
  state.builder.profile!.template = name;
  updateTemplateBadge();
  await saveTemplates(`Template ${name} updated.`);
}
async function deleteTemplate(): Promise<void> {
  const name = selectedTemplate();
  if (!state.profiles!.templates![name] || !await confirmDialog({ title: `Delete the ${name} template?`, body: "Characters made from it keep their settings.", confirmLabel: `Delete ${name}` })) return;
  delete state.profiles!.templates![name];
  renderPanel();
  await saveTemplates(`Template ${name} deleted.`);
}

// ---- requirements and weights: rule rows
// Every property a requirement or weight can name: the labelled ones, every property in the inventory, the
// pools, and the skill bonuses gear carries.
function allPropKeys(): string[] {
  return [...new Set([...Object.keys(PROP_LABELS), ...state.propKeys, "stamPool", "manaPool", "hitsPool", ...(state.facets?.gearSkills || []).map((k) => `sk:${k}`)])]
    .filter((k) => k !== "tagPenalty").sort((a, b) => propName(a).localeCompare(propName(b)));
}
// A resist's cap for this character's race (an Elf's Energy is 75 on uoalive), else the shard's cap.
function capFor(k: string): number | null {
  const rules = getRules(), caps = rules.caps as Record<string, number>;
  if (RESIST_KEYS.includes(k)) return (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[state.builder.profile!.race as string]?.[k] ?? caps[k] ?? 70;
  return caps[k] ?? null;
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
  const p = state.builder.profile!, name = state.builder.character!;
  const keys = Object.keys(p.floors!).filter((k) => k !== "tagPenalty");
  return section("req", "Requirements", { count: keys.length, summary: () => requirementsSummary(p.floors, p.softFloors), body: () => {
    const rsb = resistSkillBonus(state.inv!.characters[name]?.skills);
    const base = capFor("physResist")!, energy = capFor("energyResist")!;
    const help = el("p", { class: "help" }, txt(`The suit must reach every hard requirement. Soft ones are preferences. Resisting Spells gives ${name} +${rsb}, so gear supplies up to ${base - rsb}${energy !== base ? ` (Energy ${energy - rsb}: a ${p.race}'s cap is ${energy})` : ""}.`));
    const rows = keys.map((k) => {
      const nm = propName(k);
      const hard = segmented({ label: `${nm}: hard or soft`, options: [{ value: "hard", label: "Hard" }, { value: "soft", label: "Soft" }], value: p.softFloors!.includes(k) ? "soft" : "hard",
        onChange: (v) => { p.softFloors = p.softFloors!.filter((x) => x !== k); if (v === "soft") p.softFloors.push(k); updateTemplateBadge(); } });
      return box("div", { class: "rule-row", "data-key": k }, txt(nm, "ellip"), txt("≥", "muted"), boundNumber(p.floors!, k, `${nm} minimum`, k), hard,
        button({ label: `Remove requirement: ${nm}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { delete p.floors![k]; p.softFloors = p.softFloors!.filter((x) => x !== k); redraw("req"); focusIn("req", ".b-add"); } }));
    });
    const add = filterChip({ label: "Add requirement", add: true, attrs: { class: "fchip add b-add", id: "b-addfloor" } });
    add.onclick = () => propertyPicker(add, "Add requirement", Object.keys(p.floors!), (k) => { p.floors![k] = capFor(k) ?? 1; redraw("req"); focusIn("req", `.rule-row[data-key="${CSS.escape(k)}"] input`, true); });
    return [help, rows.length ? box("div", { class: "b-rules" }, ...rows) : null, add];
  } });
}
function weightsSection(): HTMLElement {
  const p = state.builder.profile!;
  const keys = Object.keys(p.weights!).filter((k) => k !== "tagPenalty");
  return section("weights", "Weights", { count: keys.length, summary: () => weightsSummary(p.weights), body: () => {
    const rows = keys.map((k) => {
      const nm = propName(k);
      return box("div", { class: "rule-row weight", "data-key": k }, txt(nm, "ellip"), boundNumber(p.weights!, k, `${nm} weight`, k),
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
  const p = state.builder.profile!;
  return section("pool", "Candidate pool", { summary: () => poolSummary(p), body: () => {
    const sw = (id: string, text: string, key: "allowOthersWorn" | "allowGargoyle" | "medOnly"): HTMLLabelElement =>
      switchControl({ label: text, checked: !!p[key], attrs: { id }, onChange: (v) => { p[key] = v; updateTemplateBadge(); } }).root;
    return [
      box("div", { class: "b-switches" }, sw("b-others", "Allow gear worn by other characters", "allowOthersWorn"), sw("b-garg", "Allow gargoyle-only gear", "allowGargoyle"), sw("b-med", "Meditation-safe gear only", "medOnly")),
      box("div", { class: "b-chips" }, weaponChip(), listChip("b-locked", "Locked slots", () => p.lockedSlots!, (v) => { p.lockedSlots = v; }, () => OPTIMIZER_SLOTS.map((s) => ({ value: s, label: slotLabel(s) })), false),
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
function weaponChip(): HTMLButtonElement {
  const p = state.builder.profile!;
  const text = (): string => `Weapons: ${p.weaponSkill || "any"}`;
  const chip = filterChip({ label: text(), set: !!p.weaponSkill, attrs: { id: "b-weapon" } });
  chip.onclick = () => {
    const name = `b-weapon-${Date.now()}`;
    const opts = [{ value: "", label: "Any weapon" }, ...WEAPON_SKILLS.map((w) => ({ value: w, label: `${w[0]!.toUpperCase()}${w.slice(1)} only` }))];
    const rows = opts.map((o) => {
      const r = el("input", { type: "radio", name, value: o.value });
      r.checked = (p.weaponSkill || "") === o.value;
      r.addEventListener("change", () => { p.weaponSkill = o.value || null; paintChip(chip, text(), !!p.weaponSkill); updateTemplateBadge(); });
      return box("label", { class: "check" }, r, txt(o.label));
    });
    popover(chip, [el("p", { class: "help" }, txt("Only weapons of this skill in the hands, plus a shield except for archery.")), box("div", { class: "b-checks", role: "radiogroup", "aria-label": "Weapons" }, ...rows)], { label: "Weapons" });
  };
  return chip;
}
function tagsChip(): HTMLButtonElement {
  const p = state.builder.profile!;
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
function advancedSection(): HTMLElement {
  return section("adv", "Advanced", { inline: true, summary: () => advancedSummary(knobs), body: () => {
    const num = (f: KnobField, text: string): HTMLDivElement => {
      const i = input({ type: "number", value: knobs[f], attrs: { id: KNOB_IDS[f] } });
      if (!knobs.exact && (f === "budgetS" || f === "altCount" || f === "altTol")) i.disabled = true;
      const err = knobError(f, knobs[f]);
      const fl = field({ label: text, control: i, error: err && !i.disabled ? err : undefined });
      i.addEventListener("input", () => { knobs[f] = i.value; setFieldError(i, knobError(f, i.value)); if (f === "strLimit") updateTemplateBadge(); });
      return fl;
    };
    const exact = switchControl({ label: "Exact search (prove the best)", checked: knobs.exact, attrs: { id: "b-exact" }, onChange: (v) => { knobs.exact = v; redraw("adv"); document.getElementById("b-exact")?.focus(); } });
    return [box("div", { class: "b-adv" }, box("div", { class: "b-adv-wide" }, exact.root),
      num("strLimit", "STR limit"), num("restarts", "Restarts"), num("budgetS", "Time budget (s)"), num("altCount", "Other suits"), num("altTol", "Within points"),
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
  if (!open.adv) { open.adv = true; redraw("adv"); }
  const i = document.getElementById(KNOB_IDS[f]) as HTMLInputElement | null;
  if (!i) return;
  setFieldError(i, err);
  i.focus(); i.select();
  i.closest(".field")?.scrollIntoView({ block: "nearest" });   // the error line under it too
}

// ---------------------------------------------------------------- the build
function optimizerProfile(): EffectiveProfile {
  return effectiveProfile(state.builder.profile!, state.inv!.characters[state.builder.character!] as Character | null);
}
async function runBuild(): Promise<void> {
  if (state.builder.job) return;
  if (!state.builder.character || !state.builder.profile) { toast("No character to build for yet: scan one first.", "bad"); return; }
  // A bad field stops the build and takes focus, with its reason under it; the button itself stays enabled.
  const bad = firstKnobError(knobs);
  if (bad) { focusKnob(bad.field, bad.error); return; }
  const badRule = document.querySelector<HTMLInputElement>("#b-panel-body .rule-row input[aria-invalid='true']");
  if (badRule) { badRule.focus(); return; }
  const name = state.builder.character, p = readControls();
  const settings: RunSettings = { allowOthersWorn: p.allowOthersWorn, strLimit: p.strLimit, excludeTags: p.excludeTags, excludeRoots: p.excludeRoots, allowGargoyle: p.allowGargoyle, medOnly: p.medOnly, weaponSkill: p.weaponSkill, excludeSkills: p.excludeSkills || [], lockedSlots: p.lockedSlots };
  const exact = knobs.exact, budgetMs = 1000 * Number(knobs.budgetS);
  const altCount = Number(knobs.altCount), altTol = Number(knobs.altTol);
  const opts = { restarts: Number(knobs.restarts), exact, timeBudgetMs: budgetMs, ...(exact && altCount > 0 ? { alternatives: { count: altCount, tolerance: altTol } } : {}) };
  closeCompare();
  // Pools/current/skipped are the server's job (buildPools against its own cached inventory, POST
  // /api/optimize's by-character form): the page sends the character + settings and reads poolSize/skipped/
  // current/warning back. The job keeps the character and the effective profile it was started with: the
  // player can switch characters while it runs, and the result is judged against these.
  const profile = optimizerProfile();
  const job: BuilderJob = { id: null, es: null, name, profile, exact, budgetMs, poolSize: null, skipped: {}, current: {}, warning: null, startedAt: Date.now(), lastProgressAt: Date.now(), lastServerAt: Date.now(), last: null, connected: true, ui: null, timer: null };
  state.builder.job = job;
  setBuilding(true);
  job.ui = runPanel(job);
  $<HTMLElement>("#b-msg")!.replaceChildren(job.ui.root);
  job.ui.root.focus();
  let r: (OptimizeStartApiResponse & { ok: true }) | { ok: false; error: string };
  try {
    r = (await api<OptimizeStartApiResponse>("/api/optimize", { method: "POST", body: { character: name, settings, profile, opts,
      meta: { character: name, settings: settingsSnapshot(), inventoryStamp: invStamp() } } })) as OptimizeStartApiResponse & { ok: true };
    // optimizeErrorMessage (ui/messages.mts) explains the one refusal that isn't about this build at all: 429,
    // four jobs already running (vault-server.mts's MAX_RUNNING_JOBS) — this page only ever runs one.
  } catch (e) { r = { ok: false, error: optimizeErrorMessage(e) }; }
  if (state.builder.job !== job) { if (r.ok) api(`/api/optimize/${r.id}/cancel`, { method: "POST" }).catch(() => {}); return; }   // cancelled while the request was in flight
  if (!r.ok) { failJob(job, r.error); return; }
  job.poolSize = r.poolSize; job.skipped = r.skipped; job.current = r.current; job.warning = r.warning || null;
  // r.run.ms is `number | null` (a saved run's on-disk shape); a genuinely null one has never been guarded here.
  if (r.cached) { finishJob(job, { result: r.run!.result, ms: r.run!.ms!, runId: r.run!.id, reused: r.run! }); return; }
  job.id = r.id!;
  job.timer = setInterval(() => job.ui!.tick(job), 200) as unknown as number;
  // EventSource can't carry the X-Client-Id header (or the token): the server checks this ?client= param
  // against the job's own owner instead (vault-server.mts's events route).
  const es = new EventSource(`/api/optimize/${job.id}/events?client=${encodeURIComponent(CLIENT_ID)}`);
  job.es = es;
  const onProgress = (p: OptimizeProgress): void => { job.last = p; job.lastProgressAt = Date.now(); job.lastServerAt = Date.now(); job.connected = true; job.ui!.update(job); };
  es.addEventListener("hello", (e: MessageEvent<string>) => {
    const snap = JSON.parse(e.data) as JobSnapshotEvent;
    if (snap.progress) onProgress(snap.progress);
    if (snap.state === "done") finishJob(job, { result: snap.result!, ms: snap.ms!, runId: snap.runId });
    else if (snap.state === "error") failJob(job, snap.error || "The build failed.");
    // job.ms is always set immediately before cancelJob()'s finish() call that produces this event.
    else if (snap.state === "cancelled") endJob(job, cancelledNote(snap.ms!));
  });
  es.addEventListener("progress", (e: MessageEvent<string>) => onProgress(JSON.parse(e.data) as OptimizeProgress));
  es.addEventListener("ping", () => { job.lastServerAt = Date.now(); job.connected = true; });
  es.addEventListener("done", (e: MessageEvent<string>) => finishJob(job, JSON.parse(e.data) as JobDoneEvent));
  es.addEventListener("failed", (e: MessageEvent<string>) => failJob(job, (JSON.parse(e.data) as JobFailedEvent).error));
  es.addEventListener("cancelled", (e: MessageEvent<string>) => endJob(job, cancelledNote((JSON.parse(e.data) as JobCancelledEvent).ms)));
  // EventSource reconnects by itself and "hello" then catches us up — unless the server refused the stream (a
  // restart forgot the job: 404), after which it stays closed for good.
  es.onerror = () => {
    job.connected = false;
    if (es.readyState === EventSource.CLOSED) failJob(job, "Lost the build: the server no longer knows this job (it may have restarted). Build again.");
  };
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
  const stale = on && !!state.builder.result;
  res.classList.toggle("b-stale", stale);
  res.inert = stale;
  if (stale) res.setAttribute("aria-hidden", "true"); else res.removeAttribute("aria-hidden");
}
const cancelledNote = (ms: number): HTMLElement => message({ tone: "info", text: `Cancelled after ${fmtSecs(ms)}.`, actions: [button({ label: "Build again", size: "sm", onClick: () => runBuild() })] });
// A refusal or failure: an inline message at the top of the results; when it names a field, that field gets
// the error and the focus.
function failJob(job: BuilderJob, text: string): void {
  endJob(job, message({ tone: "bad", title: "The build did not run", text }));
  const f = knobFromServerError(text);
  if (f) focusKnob(f, text);
}
function endJob(job: BuilderJob, node?: HTMLElement | null): void {
  if (state.builder.job !== job) return;
  clearInterval(job.timer as number | undefined); job.es?.close(); state.builder.job = null;
  setBuilding(false);
  $<HTMLElement>("#b-msg")!.replaceChildren(...(node ? [node] : []));
}
interface JobFinishInfo { result: OptimizeResult; ms: number; runId: string | null; reused?: SavedRunLike | null | undefined }
function finishJob(job: BuilderJob, r: JobFinishInfo): void {
  const meta: BuildMeta = { ms: r.ms, poolSize: job.poolSize, skipped: job.skipped, reused: r.reused || null };
  const finished: FinishedBuild = { name: job.name, result: r.result, current: job.current, profile: job.profile, runId: r.runId || null, meta };
  // Switched to another character while it ran: never draw this suit (or its Plan and Grab all) under that
  // character. It waits until its own character is selected again.
  const away = job.name !== state.builder.character;
  const notes = [away ? message({ tone: "info", text: `${job.name}'s build finished. Switch back to ${job.name} to see it.`, attrs: { class: "msg info parked-note" } }) : null,
    job.warning ? message({ tone: "warn", text: job.warning }) : null].filter((x): x is HTMLDivElement => x !== null);
  endJob(job, null);
  $<HTMLElement>("#b-msg")!.replaceChildren(...notes);
  if (away) { state.builder.parked = finished; return; }
  showFinished(finished);
  loadRuns();
}
function showFinished(f: FinishedBuild): void {
  state.builder.result = f.result;
  state.builder.openRun = f.runId;
  state.builder.altView = null;
  renderResult(f.result, f.current, f.profile, f.name, f.meta).catch(resultLoadError);
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
      // Every field read bare below is one the server's progress packet always sets for that phase (see
      // api-types.mts's OptimizeProgress): the `!` documents that rather than inventing a fallback value.
      let frac = 0;
      if (p.phase === "heuristic") { frac = p.restarts ? p.restartsDone! / p.restarts : 0; main.textContent = `Restart ${fmtN(p.restartsDone)} of ${fmtN(p.restarts)}`; cand.textContent = `${fmtN(p.candidates)} candidate items`; }
      else if (p.phase === "exact") {
        frac = p.budgetMs ? Math.min(1, p.elapsedMs! / p.budgetMs) : 0;
        main.textContent = p.gapPoints == null ? "Proving: no bound yet" : `Proving: at most ${fmtN(p.gapPoints)} points from the bound`;
        cand.textContent = `${fmtN(p.nodes)} search nodes · ${fmtN(p.candidates)} candidates`;
      }
      else if (p.phase === "alternatives") { frac = p.wanted ? p.found! / p.wanted : 1; main.textContent = `${fmtN(p.found)} of ${fmtN(p.wanted)} other suits found`; cand.textContent = ""; }
      else { frac = 1; main.textContent = "Finishing…"; }
      bar.set(Math.round(Math.max(0, Math.min(1, frac)) * 1000));
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
    cancelling() { cancel.disabled = true; cancel.replaceChildren(txt("Cancelling…")); },
  };
  return ui;
}

// ---------------------------------------------------------------- save
async function saveProfile(): Promise<void> {
  if (!state.builder.character || !state.builder.profile) { toast("No character to save a profile for yet: scan one first.", "bad"); return; }
  state.profiles!.characters ||= {};
  state.profiles!.characters[state.builder.character!] = JSON.parse(JSON.stringify(readControls()));   // a copy: later panel edits must not ride along with a template save
  const r = await putProfiles();
  toast(r.ok ? `Profile for ${state.builder.character} saved.` : r.error!, r.ok ? "good" : "bad");
}
