// ui/builder-header.mts — the Suit Builder's sentence bar (issue #321): the character picker, the build picker with the
// templates to start over from and the saved settings to go back to, and the What changed chip beside it with its popover
// (issue #336). It reads the panel's state through ui/builder-session.mts and asks ui/builder.mts for it (buildState,
// unsavedChanges) through `commands`.
//
// map: builder
// owns: `initPickers`
import { NOBODY, changesList } from "../vault-lib.mts";
import type { SettingsChange, SettingsGroup, UnsavedChange } from "../vault-lib.mts";
import { BUILTIN_PREFIX, characterLabel, characterProfile, findTemplate, templateRefs } from "../build-spec.mts";
import { defaultStrLimit } from "../run-settings.mts";
import { state } from "./store.mts";
import { $, el } from "./dom.mts";
import { box, txt, button, icon, popover, closePopover, confirmDialog, tag, combobox, type ComboboxHandle, type ComboGroup, type ComboOption, type ComboFace, type ComboAction } from "./components.mts";
import { session, commands, announce, provide, type BuildState } from "./builder-session.mts";
import { NO_CHARACTER, plainName } from "./builder-parts.mts";
import { characterNames } from "./roster.mts";
import { topSkills, who, templateLine } from "./builder-model.mts";
import { plural } from "./format.mts";

// ---- the sentence bar's pickers (issue #321): the character, and the build with the templates to start over from
let charPicker: ComboboxHandle | null = null, buildPicker: ComboboxHandle | null = null;
// The character the picker shows (builder-manual.mts's paintCharSelect decides: No character when it is Manual's choice).
let shownCharacter = "";
// When each character last ran ("today, 10:40 PM"), fetched as the picker opens; it redraws when they are in. Null until known.
let lastRuns: Record<string, string> | null = null;
const NOBODY_LINE = "Raw item totals, no character's bonuses";
// A character's initial on a tint of one of eight colors, the same for a name every time; a box icon for No character.
const hueOf = (name: string): number => ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8) + 1;
const avatar = (name: string): HTMLElement => (name === NOBODY ? box("span", { class: "b-av b-av-none", "aria-hidden": "true" }, icon("inventory", { size: "sm" }))
  : box("span", { class: "b-av", "data-hue": String(hueOf(name)), "aria-hidden": "true" }, txt(name.slice(0, 1).toUpperCase())));
const buildIcon = (): HTMLElement => box("span", { class: "b-ic", "aria-hidden": "true" }, icon("settings", { size: "sm" }));
// The build picker's own rows: the panel as it is, and (with unsaved changes) the character's saved settings to go back to.
const OWN = "\u0000own", SAVED = "\u0000saved";
// Attached once for the page's life (app.mts's load(), just before initBuilder).
export function initPickers(): void {
  // the subline: the character's build label, else their top skills; the search looks in both
  const skills = (n: string): string => (n === NOBODY ? NOBODY_LINE : topSkills(state.inv?.characters[n]?.skills));
  const subline = (n: string): string => (n === NOBODY ? NOBODY_LINE : characterLabel(state.profiles, n) ?? skills(n));
  charPicker = combobox({ label: "Character", placeholder: "Find a character, label or skill…", width: 400, empty: "No character matches.", attrs: { id: "b-char", class: "b-pick" },
    face: () => (shownCharacter ? { value: shownCharacter, title: who(shownCharacter), subtitle: subline(shownCharacter) || "No skills in the scan", icon: avatar(shownCharacter) }
      : { value: "", title: "No characters yet", subtitle: "Import a scan first" }),
    groups: () => {
      const names = state.inv && state.profiles ? characterNames(state.inv.characters, state.profiles.characters) : [];
      const row = (n: string): ComboOption => ({ value: n, title: who(n), subtitle: subline(n), match: `${who(n)} ${characterLabel(state.profiles, n) ?? ""} ${skills(n)}`, meta: lastRuns ? lastRuns[n] ?? "no runs" : undefined, icon: () => avatar(n), current: n === shownCharacter });
      return names.length ? [{ label: "Characters", options: names.map(row) }, { label: "Without a character", options: [row(NOBODY)] }] : [];
    },
    onPick: pickCharacter });
  $<HTMLElement>("#b-char-slot")!.replaceWith(charPicker.button);
  charPicker.button.addEventListener("click", () => { void commands.lastRunDays().then((d) => { if (d) { lastRuns = d; charPicker!.refresh(); } }); });
  buildPicker = combobox({ label: "Build", placeholder: "Find a template…", width: 420, empty: "No template matches.", attrs: { id: "b-tpl", class: "b-pick", "aria-describedby": "b-tpl-state" },
    face: buildFace, groups: buildGroups, actions: buildActions, onPick: pickBuild });
  // the full state shows as a tooltip; a screen reader gets it once, from #b-tpl-state (the tooltip's describer is taken back off)
  changesChip = box("button", { type: "button", class: "b-chg-chip", id: "b-chg", "aria-haspopup": "dialog", "aria-expanded": "false", hidden: "" });
  changesChip.addEventListener("click", () => openChangesPopover(changesChip!));
  $<HTMLElement>("#b-tpl-top")!.replaceChildren(txt("using", "b-w"), buildPicker.button, changesChip, el("span", { class: "sr", id: "b-tpl-state" }));
}
// The What changed chip beside the build picker (issue #336): "16 changes from **melee** template", a dot and "3 unsaved"
// when the panel differs from the saved profile; hidden when neither. A click opens the changes as a table.
let changesChip: HTMLButtonElement | null = null;
function paintChangesChip(st: BuildState): void {
  const chip = changesChip;
  if (!chip) return;
  // the popover's count (changesList), so the chip and the popover's header say the same number
  const n = st.template && st.changed.length ? changesList(st.changed, st.unsavedList).count : 0, u = st.unsavedList.length;
  chip.hidden = !n && !u;
  chip.replaceChildren(...[icon("list", { size: "sm" }),
    n && st.template ? el("span", {}, `${plural(n, "change")} from `, el("strong", {}, st.template), " template") : null,
    n && st.template && u ? txt("·", "faint") : null,
    u ? el("span", { class: "b-chg-dot", "aria-hidden": "true" }) : null, u ? txt(`${u} unsaved`) : null].filter((x): x is HTMLSpanElement | SVGSVGElement => !!x));
}
// The group's heading in the popover.
const CHANGE_HEAD: Record<SettingsGroup, string> = { requirements: "Requirements", weights: "Weights per point", pool: "Pool", buffs: "Buffs", character: "Character", search: "Search" };
// The popover: a header with the count and whether any are unsaved; the unsaved edits first (template → saved → now), then the changes
// from the template by group (template → this build), an added requirement marked and a soft one tagged; each row's name
// opens Auto Build Settings on that setting; Reset to the template (asks first) and Save as template at the foot.
function openChangesPopover(anchor: HTMLButtonElement): void {
  if (!session.profile || !session.character) return;
  const st = commands.buildState(), name = who(session.character), tplName = st.template ?? "";
  // a row opens its setting (builder.mts openChange)
  const open = (c: SettingsChange): void => {
    closePopover();
    commands.openChange(c, anchor);
  };
  // a table of changes, its value columns headed `cols` (template → saved → now for an unsaved edit with a template)
  const table = (rows: UnsavedChange[], cols: string[]): HTMLElement => el("table", { class: "b-diff" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, txt("Setting", "sr")), ...cols.flatMap((h, i) => [...(i ? [el("th", { scope: "col" }, txt("to", "sr"))] : []), el("th", { scope: "col" }, h)]))),
    el("tbody", {}, ...rows.map((c) => {
      const vals = c.from == null ? null : cols.length === 3 ? [c.template ?? "", c.from, c.to ?? ""] : [c.from, c.to ?? ""];
      return el("tr", {},
        el("td", {}, button({ label: c.label ?? c.text, variant: "ghost", size: "sm", cls: "b-diff-open", onClick: () => open(c) }), c.soft ? tag("soft") : null),
        ...(vals ? vals.flatMap((v, i) => [...(i ? [el("td", { class: "b-diff-arrow", "aria-hidden": "true" }, "→")] : []), el("td", { class: i === vals.length - 1 ? (c.added ? "b-diff-add" : "") : "b-diff-from" }, v)])
          : [el("td", { colspan: String(cols.length * 2 - 1), class: "muted" }, c.label ? c.text : "")]));
    })));
  const section = (head: string, rows: UnsavedChange[], cols: string[]): HTMLElement[] => [el("h3", { class: "b-diff-h" }, `${head} · ${rows.length}`), table(rows, cols)];
  // an unsaved edit is listed and counted once, in its own section, with the template's value beside it (changesList)
  const list = changesList(st.template ? st.changed : null, st.unsavedList);
  const groups = (Object.keys(CHANGE_HEAD) as SettingsGroup[]).flatMap((g) => { const rows = list.others.filter((c) => c.group === g); return rows.length ? section(CHANGE_HEAD[g], rows, [tplName, name]) : []; });
  const n = list.count, u = list.unsaved.length, fromTpl = !!tplName && st.changed.length > 0;
  const head = box("header", { class: "b-diff-head" },
    el("strong", {}, ...(fromTpl ? [`${plural(n, "change")} from `, el("b", {}, tplName), " template"] : [`${plural(u, "unsaved change")}`])),
    txt(u ? `${plural(u, "change")} not saved to ${name}'s profile yet, listed first.` : `Saved in ${name}'s build. No unsaved changes.`, "t-sm muted"));
  const body = box("div", { class: "b-diff-body" }, ...(u ? section("Not saved yet", list.unsaved, tplName ? [tplName, "Saved", "Now"] : ["Saved", "Now"]) : []), ...groups);
  const foot = box("footer", { class: "b-diff-foot" }, txt("Click a setting to open it.", "t-sm muted"),
    box("span", { class: "b-diff-acts" },
      tplName ? button({ label: `Reset to “${tplName}”…`, size: "sm", onClick: () => { closePopover(); commands.pickTemplate(session.profile!.template!, true); } }) : null,
      button({ label: "Save as template…", size: "sm", onClick: () => { closePopover(); commands.saveTemplateAs(); } })));
  const h = popover(anchor, [head, body, foot], { label: fromTpl ? `Changes from the ${tplName} template` : "Unsaved changes", width: 480 });
  if (h.isOpen()) h.root.classList.add("pop-diff");
}
// A character picked. "No character" (NOBODY) is Manual's in both modes, and Automatic's own when picked there; picked in
// Manual it leaves Automatic's character as it is (back from it to the same one keeps its panel and result).
function pickCharacter(v: string): void {
  const none = v === NOBODY;
  commands.setManualFor(none ? null : v);
  if (v !== session.character && (!none || session.mode !== "manual")) commands.selectCharacter(v);
  announce("picker");
}
function showCharacter(name: string): void { shownCharacter = name; charPicker?.refresh(); }
// The build picker's face: "<name>'s build" over where its settings came from and how they stand.
function buildFace(): ComboFace {
  const name = session.character;
  if (!session.profile || !name) return { value: "", title: "No build yet", subtitle: "Import a scan first", icon: buildIcon() };
  return { value: session.profile.template || "", title: `${who(name)}'s build`, subtitle: commands.buildState().text, icon: buildIcon() };
}
// Its list: the character's own build (and its saved settings, when they differ), then the player's templates and the
// built-ins to start over from, each with a line saying what it is.
function buildGroups(): ComboGroup[] {
  const name = session.character;
  if (!session.profile || !name) return [];
  const refs = templateRefs(state.profiles!, state.builtinTemplates), builtin = (r: string): boolean => r.startsWith(BUILTIN_PREFIX);
  const face = buildFace(), unsaved = commands.unsavedChanges().length;
  const users = (ref: string): string[] => Object.keys(state.profiles!.characters).filter((c) => state.profiles!.characters[c]!.template === ref);
  const tpl = (ref: string): ComboOption => {
    const t = findTemplate(state.profiles!, state.builtinTemplates, ref);
    return { value: ref, title: plainName(ref), subtitle: builtin(ref) ? t?.description || "Ships with Pack Rat" : templateLine(t ?? {}, users(ref)) };
  };
  return [
    { label: `${who(name)}'s own`, options: [{ value: OWN, title: face.title, subtitle: face.subtitle, match: face.title, icon: buildIcon, current: true },
      ...(unsaved ? [{ value: SAVED, title: `${who(name)}'s saved build`, subtitle: `Go back to it, dropping ${plural(unsaved, "unsaved change")}`, match: `${who(name)}'s saved build`, icon: buildIcon }] : [])] },
    { label: "Start over from a saved template", options: refs.filter((r) => !builtin(r)).map(tpl) },
    { label: "Start over from a built-in template", options: refs.filter(builtin).map(tpl) },
  ];
}
// The template management that was the ⋯ menu's: Save as, and Manage templates, a menu with Update and Delete for each of
// the player's templates and the built-ins, in the Manage templates drawer (issue #336).
function buildActions(): ComboAction[] {
  return [{ label: "Save as template…", icon: "plus", onSelect: () => { commands.saveTemplateAs(); }, disabled: session.profile ? null : NO_CHARACTER },
    { label: "Manage templates…", onSelect: () => commands.openTemplatesDrawer(buildPicker!.button), disabled: session.profile ? null : NO_CHARACTER }];
}
function pickBuild(v: string): void {
  if (v === OWN) return;
  if (v === SAVED) void revertToSaved();
  else commands.pickTemplate(v, true);
}
// Back to the settings saved in the character's profile, after a yes: the unsaved changes go.
async function revertToSaved(): Promise<void> {
  const name = session.character!, n = commands.unsavedChanges().length;
  if (n && !await confirmDialog({ title: `Drop ${plural(n, "unsaved change")}?`, body: `${who(name)}'s build goes back to the settings saved in the profile.`, confirmLabel: "Drop changes" })) return;
  if (session.character !== name) return;
  session.profile = characterProfile(state.profiles!, name, state.builtinTemplates);
  session.profile!.excludeRoots ??= [];
  announce("caps");
  session.knobs.strLimit = String(session.profile!.strLimit ?? defaultStrLimit(state.inv!.characters[name]));
  announce("panel");
}
provide({ showCharacter, refreshCharPicker: () => charPicker?.refresh(), refreshBuildPicker: () => buildPicker?.refresh(), paintChangesChip });
