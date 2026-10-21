// ui/builder-requirements.mts — the Suit Builder's Requirements and Goals tabs and the resist caps (issues #272, #292): the
// requirement rows with what each came to in the shown result, the forbidden skill bonuses, the resist caps, the ranked
// goals that set the weights, the weight rows with their sliders, the swing-step settings and the property picker behind
// "+ Add". Each section is drawn from the session's profile; ui/builder.mts puts them in the drawer's tabs and redraws them
// (`commands.redraw`).
//
// map: builder
// owns: `applyRequirementsPrefs`, `requirementsSection`, `capsSection`, `goalsSection`, `weightsSection`
import { NOBODY, PROP_LABELS, catalogueGroups, NOT_BUILDER_KEYS, importanceOf, weightOfImportance, getRules, RESIST_KEYS, RESIST_CAP_LIMITS, resistCapsFor, toOptItem, totalsOf, compileGoals, goalsActive, GOAL_LEFTOVERS, LEFTOVER_GROUPS, LEFTOVER_LABELS, GOAL_RANKS_MAX, GOAL_RANK_SIZE_MAX, STRATEGY_HELP, FEWEST_HELP } from "../vault-lib.mts";
import { delayText, heldWeapon, ssiShareOf, swingOf, type SwingResult } from "../swing.mts";
import { goalSsiCap, planBuild, specFromProfile } from "../build-spec.mts";
import type { Goals, ResistCap, RunBuffs, Character } from "../vault-lib.mts";
import { gearNeedsText, overrideNote, planBuffs, runBuffs } from "../buffs.mts";
import { state } from "./store.mts";
import { el, label, full } from "./dom.mts";
import { box, txt, button, badge, token, select, input, switchControl, check, segmented, filterChip, pill, popover, closePopover, searchInput, tooltip, refreshTooltips, rowActions, tipWrap } from "./components.mts";
import { session, commands, provide, onChange, type BuilderChange } from "./builder-session.mts";
import { buffsOn, group, checklist, panelFcCap, fcCapNote } from "./builder-parts.mts";
import { needStatus, shownImportance, nextSwingStep, speedText, swingLines, propName, newWeight, editedValue, ruleValueError, resistCapError, withResistCap, capNote, resistMinimumText, floorCapWarning, weightTradeoff, goalRows, moveGoal, spareKeys, andList, linkGoal, removeGoal, addGoal } from "./builder-model.mts";
import type { UiPrefs } from "./api-types.mts";
import { prefs } from "./prefs.mts";
import { gearText, type GearItemSource } from "./gear-item.mts";

// Whether the Goals tab shows the weights the goals set under them (ui-prefs `builderFineTune`, issue #292).
let fineTune = false;
// A requirement or weight row's property name: up to two lines, the full name in its title.
const ruleName = (nm: string): HTMLSpanElement => { const t = txt(nm, "rule-name"); t.title = nm; return t; };
// A resist cap typed out of range, as typed (the profile keeps the last good cap): kept here rather than read back
// from the field so the section can close and reopen, and Build still refuses it with the section closed.
const capDrafts: Record<string, string> = {};
// A new set of caps (another character, a template or a saved run's settings applied) replaces anything typed.
function clearCapDrafts(): void { for (const k of Object.keys(capDrafts)) delete capDrafts[k]; }

// The panel's buffs, as a run saves them (absent with none on).
const panelBuffs = (): RunBuffs | undefined => runBuffs(buffsOn(), commands.buffInputsOf(session.character!).values);

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
// A property's cap for this build: a resist's from the panel's resist caps, Faster Casting's from the casting school,
// anything else the shard's.
function capFor(k: string): number | null {
  if (RESIST_KEYS.includes(k)) return panelResistCaps()[k]!.cap;
  if (k === "fc") return panelFcCap().cap;
  return (getRules().caps as Record<string, number>)[k] ?? null;
}
// A number input bound to obj[k]: a value that isn't a number keeps its field marked with the reason, and the
// last good value stays in the profile. `conv` shows the stored value in another unit and stores what is typed back
// in the stored one (a weight's importance), keeping the exact value of a field merely touched (builder-model.mts editedValue).
function boundNumber(obj: Record<string, number>, k: string, aria: string, focusKey: string, conv?: { show: (v: number) => number; store: (n: number) => number }): HTMLInputElement {
  const first = obj[k]!;
  const i = input({ type: "number", size: "sm", value: conv ? conv.show(first) : first, attrs: { "aria-label": aria, "data-key": focusKey } });
  i.addEventListener("input", () => {
    const err = ruleValueError(i.value);
    setInlineError(i, err);
    if (err) return;
    obj[k] = conv ? editedValue(first, obj[k]!, Number(i.value), conv) : Number(i.value);
    commands.updateTemplateBadge();
  });
  return i;
}
// The error line under a rule row or field, kept in sync with aria-invalid and aria-describedby.
function setInlineError(control: HTMLElement, err: string | null): void {
  const holder = control.closest(".rule-row, .field")!;
  const id = `${control.id || (control.id = `b-in-${Math.random().toString(36).slice(2, 8)}`)}-err`;
  holder.querySelector(`#${CSS.escape(id)}`)?.remove();
  control.classList.toggle("invalid", !!err);
  // the error joins any description the control already has (a weight's trade-off) and leaves it when cleared
  const described = (control.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== id);
  if (err) {
    control.setAttribute("aria-invalid", "true");
    described.push(id);
    holder.append(el("span", { class: "field-error", id }, err));
  } else control.removeAttribute("aria-invalid");
  if (described.length) control.setAttribute("aria-describedby", described.join(" ")); else control.removeAttribute("aria-describedby");
}
function requirementsSection(): HTMLElement {
  const p = session.profile!, name = session.character!;
  const keys = Object.keys(p.floors!).filter((k) => !NOT_BUILDER_KEYS.has(k));
  return group("req", null, () => {
    // with buffs on, each requirement they touch says what gear still has to supply
    const { prof, r } = planBuffs(p, state.inv!.characters[name] as Character | null, commands.buffPlan(name, p.race, panelBuffs()));
    // the minimum the search holds resists at: the character's own, or what the planned buffs leave (Protection)
    const minText = resistMinimumText(name, prof.buffs ? prof.buffs.minimum : prof.resistMinimum);
    const help = el("p", { class: "help" }, txt(`The suit must reach every hard requirement. Soft ones are preferences.${minText ? ` ${minText}` : ""}`));
    const rows = keys.map((k) => {
      const nm = propName(k);
      const hard = segmented({ label: `${nm}: hard or soft`, options: [{ value: "hard", label: "Hard" }, { value: "soft", label: "Soft" }], value: p.softFloors!.includes(k) ? "soft" : "hard",
        onChange: (v) => { p.softFloors = p.softFloors!.filter((x) => x !== k); if (v === "soft") p.softFloors.push(k); commands.updateTemplateBadge(); } });
      const num = boundNumber(p.floors!, k, `${nm} minimum`, k);
      const status = el("span", { class: "t-sm b-need-status" });
      const row = box("div", { class: "rule-row", "data-key": k }, box("span", { class: "b-need" }, ruleName(nm), status), txt("≥", "muted"), num, hard,
        button({ label: `Remove requirement: ${nm}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { delete p.floors![k]; p.softFloors = p.softFloors!.filter((x) => x !== k); commands.redraw("req"); commands.focusIn("req", ".b-add"); } }));
      floorWarning(row, num, k);
      paintNeed(row);
      num.addEventListener("input", () => paintNeed(row));
      const ignored = prof.buffs?.overridesIgnored?.[k];
      // a requirement at or under the minimum the buffs leave asks nothing of gear
      const byMinimum = prof.mins?.[k] != null && prof.floors[k]! <= prof.mins[k]!;
      const said = r ? [ignored != null ? overrideNote(k, ignored, r) : null, byMinimum ? "Met by any suit: the Resisting Spells minimum" : gearNeedsText(k, prof.floors[k]!, prof.caps[k], r)].filter(Boolean).join(". ") : "";
      if (said) row.append(el("span", { class: "t-sm b-buff-note" }, said));
      if (k === "fc") row.append(fcCapNote());
      if (k === "ssi") { const next = nextStepButton(); if (next) row.append(next); }   // repainted as the shown result changes (paintNextStep)
      return row;
    });
    const add = filterChip({ label: "Add requirement", add: true, attrs: { class: "fchip add b-add", id: "b-addfloor" } });
    add.onclick = () => propertyPicker(add, "Add requirement", Object.keys(p.floors!), (k) => { p.floors![k] = capFor(k) ?? 1; commands.redraw("req"); commands.focusIn("req", `.rule-row[data-key="${CSS.escape(k)}"] input`, true); });
    return [help, rows.length ? box("div", { class: "b-rules" }, ...rows) : null, forbidSkillsRow(), add];
  });
}
// Under a requirement's name, what it came to in the result shown (builder-model.mts needStatus): "Met: 45", "2 short",
// and for SSI the next swing step; nothing with no result shown, or one for another character. A run built from other
// settings still says it: it is the last build's outcome, and the footer counts the changes since.
function paintNeed(row: HTMLElement): void {
  const k = row.dataset.key!, o = session.outcome, floor = session.profile?.floors?.[k], out = row.querySelector<HTMLElement>(".b-need-status")!;
  const s = o && o.name === session.character && floor != null ? needStatus(k, floor, o.totals[k] || 0, o.caps, k === "ssi" ? nextSwingStep(o.swing) : null, o.weapon) : null;
  out.textContent = s?.text ?? "";
  out.className = `t-sm b-need-status${s ? ` tone-${s.tone}` : ""}`;
}
document.addEventListener("builderchange", (e) => { if ((e as BuilderChange).detail.key === "outcome") document.querySelectorAll<HTMLElement>("#b-sec-req .rule-row[data-key]").forEach(paintNeed); });
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
  return group("caps", "Resist caps", () => [
    el("p", { class: "help" }, txt(`The highest paperdoll value each resist is worth, for the score and for requirements. Raise one for a suit worn in a form that lowers it: Reaper Form takes 25 Fire, so a Fire cap of 95 keeps 70 in form. Whole numbers from ${RESIST_CAP_LIMITS.min} to ${RESIST_CAP_LIMITS.max}.`)),
    box("div", { class: "b-rules" }, ...RESIST_KEYS.map((k) => capRow(p, k))),
  ]);
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
        commands.redraw("caps"); commands.redraw("req"); commands.redraw("weights");
        commands.focusIn("caps", `.rule-row[data-key="${CSS.escape(k)}"] input`, true);
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
    paint(); commands.redraw("req"); commands.redraw("weights");   // their notes name what gear supplies under each cap, and the worth of a resist weight; commands.redraw() also updates the template badge
  });
  paint();
  if (capDrafts[k] != null) setInlineError(i, resistCapError(capDrafts[k]!));
  return row;
}
// ---- goals (issue #292): the Goals tab's ranked list, which sets the weights (vault-lib.mts compileGoals)
// The goals' weights compiled again into the panel's profile, with the swing-step switch they set.
function applyGoals(p: NonNullable<typeof session.profile>): void {
  const c = compileGoals(p.goals!, p.weights);
  p.weights = c.weights;
  p.swingSteps = c.swingSteps;
}
// A goals edit: the profile's goals replaced and compiled, the tab redrawn, and the focus on `focus` in the goals group.
function setGoals(next: Goals, focus?: string): void {
  const p = session.profile!;
  p.goals = next;
  applyGoals(p);
  commands.redraw("goals"); commands.redraw("weights");
  if (focus) commands.focusIn("goals", focus);
}
// A weight (or the swing-step switch) edited by hand while goals set them: the goals stop setting the weights and fold into
// a note that can start from them again. The weights group stays as it is, so the control being edited keeps the focus.
function ownWeights(): void {
  const p = session.profile!;
  if (!goalsActive(p.goals)) return;
  p.goals = { ...p.goals, ownWeights: true };
  commands.redraw("goals");
  const help = document.getElementById("b-weights-help");
  if (help) help.textContent = WEIGHTS_HELP;
}
// What "+ Add a goal" offers: the properties the built-in templates rank, the spare-points groups' and the resists, and any
// the panel weights, less the goals already listed.
function goalChoices(taken: readonly string[]): string[] {
  const ranked = Object.values(state.builtinTemplates).flatMap((t) => t.spec.intent.goals?.ranks.flat() ?? []);
  return [...new Set([...ranked, ...Object.values(LEFTOVER_GROUPS).flat(), ...RESIST_KEYS, ...Object.keys(session.profile!.weights!)])].filter((k) => !NOT_BUILDER_KEYS.has(k) && !taken.includes(k));
}
// The Goals tab's top: with goals in force, the ranked list (each row's rank and name, what it counts and its cap, "=" to
// share the rank above, ↑ ↓ ✕; Swing Speed Increase's swing time under its row), "+ Add a goal", where spare points go, and the
// switch that shows the weights they set. With the weights edited by hand since, a note that starts from the goals again;
// with no goals at all, nothing (the weights below are the tab, as before goals).
function goalsSection(): HTMLElement {
  const p = session.profile!, stored = p.goals;
  const sec = group("goals", null, () => {
    if (!stored) return [];
    const g: Goals = stored;
    if (g.ownWeights) {
      const again = button({ label: "Start from goals again", variant: "ghost", size: "sm", cls: "b-link", attrs: { id: "b-goals-again" }, onClick: () => {
        const { ownWeights: _own, ...rest } = g;
        setGoals(rest, "#b-goals-h");
      } });
      // the strategy and fewest changes are the goals' too, so they are off with them
      const off = [g.strategy === "strict" ? "Strict order" : "", g.fewestChanges ? "Change as few pieces as possible" : ""].filter(Boolean);
      return [el("p", { class: "help b-goals-off" }, txt(off.length ? `Using your own weights, so ${andList(off)} ${off.length === 1 ? "is" : "are"} off.` : "Using your own weights."), " ", again)];
    }
    const rows = goalRows(g), last = g.ranks.length, row = (k: string): string => `.b-goal[data-key="${CSS.escape(k)}"]`, strict = g.strategy === "strict";
    const items = rows.map((r, i) => {
      const nm = propName(r.key), rank = andList(g.ranks[r.rank - 1]!.map(propName));
      // "=" links to the rank above, unless that rank is full (the most a rank holds, GOAL_RANK_SIZE_MAX)
      const full = !r.linked && i > 0 && g.ranks[r.rank - 2]!.length >= GOAL_RANK_SIZE_MAX;
      const pressed = pill({ label: "=", pressed: r.linked, onToggle: (on) => setGoals(linkGoal(g, r.key, on), `${row(r.key)} .pill`) });
      if (i) pressed.setAttribute("aria-label", `${nm}: same importance as ${propName(rows[i - 1]!.key)}`);
      if (full) pressed.disabled = true;
      const link = !i ? el("span") : full ? tipWrap(pressed, `The rank above already holds ${GOAL_RANK_SIZE_MAX} goals, the most a rank holds.`) : tooltip(pressed, "Same importance as the one above");
      // ↑ and ↓ move the whole rank, so they name every goal in it
      const move = (by: -1 | 1, word: "up" | "down"): Parameters<typeof rowActions>[0][number] => ({ label: `Move ${rank} ${word}`, icon: by < 0 ? "arrow-up" : "arrow-down",
        disabled: by < 0 && r.rank === 1 ? "Already first" : by > 0 && r.rank === last ? "Already last" : null, onClick: () => { setGoals(moveGoal(g, r.key, by)); focusGoalArrow(r.key, word); } });
      const next = rows[i + 1] ?? rows[i - 1];
      return box("li", { class: `b-goal${r.linked ? " linked" : ""}`, "data-key": r.key }, link,
        box("span", { class: "b-goal-name", tabindex: "-1" }, txt(`${r.rank}.`, "b-goal-rank"), txt(nm)),
        // what a goal counts matters only in Best value: Strict order compares the ranks one by one
        ((s) => (s ? txt(s, "t-sm muted b-goal-counts") : null))([strict ? "" : `counts ${r.counts}`, goalCapText(g, r.key)].filter(Boolean).join(" · ")),
        rowActions([move(-1, "up"), move(1, "down"), { label: `Remove goal: ${nm}`, icon: "close", onClick: () => setGoals(removeGoal(g, r.key), next ? `${row(next.key)} .rowact > :last-child` : "#b-addgoal") }]),
        r.key === "ssi" ? swingGoal(g) : null);
    });
    // "+ Add a goal" offers the short list (goalChoices) up to the most ranks goals hold; the new row's name takes the focus
    const add = filterChip({ label: "Add a goal", add: true, attrs: { class: "fchip add b-add", id: "b-addgoal", "aria-haspopup": "listbox" } });
    add.onclick = () => propertyPicker(add, "Add a goal", [], (k) => setGoals(addGoal(g, k), k === "ssi" ? "#b-swing-goal" : `${row(k)} .b-goal-name`), goalChoices(rows.map((r) => r.key)), propName);
    if (last >= GOAL_RANKS_MAX) add.disabled = true;
    const leftover = segmented({ label: "Spare points", size: "sm", options: GOAL_LEFTOVERS.map((v) => ({ value: v, label: LEFTOVER_LABELS[v] })), value: g.leftover,
      onChange: (v) => setGoals({ ...g, leftover: v as Goals["leftover"] }, `#b-leftover [data-value="${v}"]`) });
    leftover.id = "b-leftover";
    // the help names the group's properties that are not goals: those are the ones spare points go to
    const spare = spareKeys(g).map(propName), group = LEFTOVER_GROUPS[g.leftover];
    const spareHelp = spare.length ? `${spare.join(", ")}: counts a little, after the goals.` : group.length ? `${andList(group.map(propName))} ${group.length === 1 ? "is already a goal" : "are already goals"}, so spare points add nothing.` : "Nothing past the goals.";
    const fine = switchControl({ label: "Show the weights these goals set", checked: fineTune, attrs: { id: "b-finetune" }, onChange: (v) => { fineTune = v; prefs.set({ builderFineTune: v ? "on" : "off" }, { quiet: true }); commands.redraw("weights"); } });
    // Best value (stored as no strategy) or Strict order (issue #292), each with what it means as the tab's subtitle
    const strategy = segmented({ label: "Strategy", size: "sm", options: [{ value: "value", label: "Best value" }, { value: "strict", label: "Strict order" }], value: strict ? "strict" : "value",
      onChange: (v) => { const { strategy: _s, ...rest } = g; setGoals(v === "strict" ? { ...rest, strategy: "strict" } : rest, `#b-strategy [data-value="${v}"]`); } });
    strategy.id = "b-strategy";
    const fewest = check({ label: "Change as few pieces as possible", checked: !!g.fewestChanges, attrs: { id: "b-fewest" },
      onChange: (v) => { const { fewestChanges: _f, ...rest } = g; setGoals(v ? { ...rest, fewestChanges: true } : rest, "#b-fewest"); } });
    return [el("h3", { class: "t-md strong", id: "b-goals-h", tabindex: "-1" }, "What should this suit be best at?"),
      box("div", { class: "field b-strategy" }, el("span", { class: "label" }, "Strategy"), strategy),
      el("p", { class: "help", id: "b-strategy-help" }, txt(`Most important first. ${STRATEGY_HELP[strict ? "strict" : "value"]}`)),
      rows.length ? box("ol", { class: "b-goals", "aria-labelledby": "b-goals-h" }, ...items) : el("p", { class: "t-sm muted" }, txt("No goals yet.")), add.disabled ? tipWrap(add, `Goals hold at most ${GOAL_RANKS_MAX} ranks.`) : add,
      box("div", { class: "field b-leftover" }, el("span", { class: "label" }, "After that, put spare points into:"), leftover,
        el("p", { class: "help" }, txt(spareHelp))),
      box("div", { class: "field b-fewest" }, fewest.root, el("p", { class: "help" }, txt(FEWEST_HELP[strict ? "strict" : "value"]))),
      fine.root];
  });
  sec.hidden = !stored;
  return sec;
}
// After a move, the focus back on the moved row's same arrow, or its other one once that end is reached, else its ✕.
function focusGoalArrow(key: string, word: "up" | "down"): void {
  const [up, down, x] = [...document.querySelectorAll<HTMLButtonElement>(`#b-sec-goals .b-goal[data-key="${CSS.escape(key)}"] .rowact button`)];
  const b = word === "up" ? up : down, other = word === "up" ? down : up;
  (b && !b.disabled ? b : other && !other.disabled ? other : x)?.focus();
}
// What a goal row says after what it counts: its cap ("max 45"); for Swing Speed Increase what its swing needs, the goal's
// step (a swing time's cap) or the fastest step of the weapon worn now ("needs 51"), else the cap; "" with none.
function goalCapText(g: Goals, k: string): string {
  if (k === "ssi") {
    const cap = ssiGoalCap(g), fastest = g.swing?.mode !== "every" ? wornSwing()?.sw.steps.at(-1) : undefined;
    if (cap != null) return `needs ${cap}`;
    if (fastest) return `needs ${fastest.ssi}`;
  }
  const cap = capFor(k);
  return cap != null ? `max ${cap}` : "";
}
// The SSI a swing-time goal stops counting at for the weapon worn now (build-spec.mts goalSsiCap), null for the fastest swing.
function ssiGoalCap(g: Goals): number | null {
  const worn = wornSwing();
  return worn ? goalSsiCap(g, worn.sw.speed, worn.sw.stamina) : null;
}
// Under the Swing Speed Increase goal: the swing it aims for, "As fast as possible" or one of the worn weapon's steps ("Every 1.5 s"),
// and what that needs: "1.5 s with Katana at 95 stamina: needs Swing Speed Increase 45".
function swingGoal(g: Goals): HTMLElement {
  const worn = wornSwing(), steps = worn?.sw.steps ?? [], every = g.swing?.mode === "every" ? g.swing.seconds ?? null : null;
  const options = [{ value: "", label: "As fast as possible" }, ...steps.map((st) => ({ value: String(st.seconds), label: `Every ${delayText(st.seconds)}` })),
    ...(every != null && !steps.some((st) => st.seconds === every) ? [{ value: String(every), label: `Every ${delayText(every)}` }] : [])];
  const sel = select(options, every != null ? String(every) : "", { size: "sm", attrs: { id: "b-swing-goal", "aria-label": "Swing speed goal" } });
  sel.addEventListener("change", () => setGoals({ ...g, swing: sel.value ? { mode: "every", seconds: Number(sel.value) } : { mode: "fastest" } }, "#b-swing-goal"));
  const target = every != null ? steps.find((st) => st.seconds === every) : steps.at(-1);
  const line = !worn ? (session.character === NOBODY ? "Pick a character to see swing times." : "Wear a weapon to see the swing each Swing Speed Increase value gives.")
    : target ? `${delayText(target.seconds)} with ${worn.weapon} at ${worn.sw.stamina} stamina: needs Swing Speed Increase ${target.ssi}`
    : every != null ? `${worn.weapon} can't swing every ${delayText(every)} at ${worn.sw.stamina} stamina within the Swing Speed Increase cap.` : `${worn.weapon} is at its fastest swing at ${worn.sw.stamina} stamina.`;
  return box("div", { class: "b-swing-goal" }, sel, el("span", { class: "t-sm muted" }, ...gearText(line, [worn?.piece])));
}
// The weight rows at 0 that keep a negative sign, by character and property, for the page session.
const negZero = new Set<string>();
// The weights, under the goals: shown in place of them when there are no goals in force, else only with "Show the weights
// these goals set" on (fineTune), where editing one switches to own weights (ownWeights).
function weightsSection(): HTMLElement {
  const p = session.profile!, fromGoals = goalsActive(p.goals);
  const keys = Object.keys(p.weights!).filter((k) => !NOT_BUILDER_KEYS.has(k));
  const sec = group("weights", null, () => {
    // each row shows and takes the weight's importance (vault-lib.mts importanceOf) in its field and on a notched slider
    // (issue #272) on a fixed 0-100 scale, so one row never resizes another; the slider snaps to 5, the field takes any
    // number (a negative one, flipped by ±, in the warn tone; past 100 the slider is full and says the value). The
    // trade-off with the top property is on hover and focus, and under the list for the row last moved; the profile
    // keeps the weight per point.
    const paints: Array<() => void> = [];
    const readout = el("p", { class: "help b-wreadout", id: "b-wreadout", hidden: "" });
    const rows = keys.map((k) => {
      const nm = propName(k), conv = { show: (w: number) => shownImportance(importanceOf(k, w)), store: (n: number) => weightOfImportance(k, n) };
      const num = boundNumber(p.weights!, k, `${nm} weight`, k, conv);
      const hover = el("span", { class: "sr", id: `b-wtip-${k.replace(/\W/g, "_")}` });
      const slider = el("input", { type: "range", class: "b-wslider", min: "0", max: "100", step: "5", "aria-label": `${nm} weight slider`, "aria-describedby": hover.id });
      const over = el("span", { class: "b-wover", "aria-hidden": "true" });
      const track = box("span", { class: "b-wtrack" }, ...[25, 50, 75].map((x) => el("i", { style: `left:${x}%` })), slider, over, hover);
      const sign = button({ label: "±", variant: "ghost", size: "sm", cls: "b-wsign", attrs: { "aria-label": `${nm}: negative weight` } });
      // a row at 0 keeps its sign for the page session (negZero), so ± then a drag, or a negative weight dragged to 0
      // and back, stays negative; the profile stores 0 either way
      const zeroKey = `${session.character}\u0000${k}`, negative = (): boolean => { const imp = importanceOf(k, p.weights![k]!); return imp < 0 || (imp === 0 && negZero.has(zeroKey)); };
      if (negative() && !p.weights![k]) num.value = "-0";
      const paint = (): void => {
        const imp = importanceOf(k, p.weights![k]!), mag = Math.min(100, Math.abs(imp)), exact = shownImportance(imp), neg = negative();
        const said = neg && !exact ? "−0" : String(exact).replace("-", "−");
        // the handle sits at the exact value: a value off the notches (a typed 12.5) takes no step, a drag snaps again
        slider.step = mag % 5 ? "any" : "5";
        slider.value = String(mag);
        slider.style.setProperty("--fill", `${mag}%`);
        slider.setAttribute("aria-valuetext", said);
        track.classList.toggle("neg", neg);
        over.textContent = Math.abs(imp) > 100 ? `▸${said}` : "";
        sign.setAttribute("aria-pressed", String(neg));
        hover.textContent = weightTradeoff(k, p.weights!);
        refreshTooltips();   // a trade-off tooltip on screen follows the drag
      };
      paints.push(paint);
      // the field's arrows step by 1 from 10 up and by 0.1 below, as the number is shown
      const step = (): void => { num.step = Math.abs(Number(num.value)) >= 10 ? "1" : "0.1"; };
      step();
      const said = (): void => { readout.hidden = false; readout.textContent = weightTradeoff(k, p.weights!); };
      num.addEventListener("input", () => {
        const t = num.value.trim();
        if (t !== "" && Number(t) === 0) { if (t.startsWith("-")) negZero.add(zeroKey); else negZero.delete(zeroKey); }
        if (!ruleValueError(t)) ownWeights();
        step(); paints.forEach((f) => f()); said();
      });
      // the slider and ± write the field, which stores the weight as a typed one would (editedValue)
      const write = (n: number): void => { num.value = Object.is(n, -0) ? "-0" : String(n); num.dispatchEvent(new Event("input")); };
      slider.addEventListener("input", () => write((negative() ? -1 : 1) * Number(slider.value)));
      slider.addEventListener("pointerdown", () => { slider.step = "5"; });
      // the arrow keys go to the next notch of 5 that way, from a value off the notches too (12.5: → 15, ← 10); past 100
      // the bar is full, so → leaves a typed 178 alone and ← takes it to 100
      slider.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        // as shown (two decimals): a compiled Luck of 5 is 4.999999… per point times its scale, which must still step to 10
        const abs = Math.abs(shownImportance(importanceOf(k, p.weights![k]!))), mag = Math.min(100, abs);
        if (d > 0 && abs >= 100) return;
        write((negative() ? -1 : 1) * (abs > 100 ? 100 : Math.max(0, Math.min(100, d > 0 ? Math.floor(mag / 5) * 5 + 5 : Math.ceil(mag / 5) * 5 - 5))));
      });
      slider.addEventListener("focus", said);
      sign.onclick = () => {
        if (!p.weights![k]) { write(negative() ? 0 : -0); return; }
        p.weights![k] = -p.weights![k]!; write(conv.show(p.weights![k]!));
      };
      tooltip(num, () => hover.textContent!);
      tooltip(track, () => hover.textContent!);
      num.setAttribute("aria-describedby", hover.id);
      return box("div", { class: "rule-row weight", "data-key": k }, ruleName(nm), num, track, sign,
        button({ label: `Remove weight: ${nm}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { ownWeights(); delete p.weights![k]; commands.redraw("weights"); commands.focusIn("weights", ".b-add"); } }),
        k === "ssi" ? swingStepsSetting() : k === "fc" ? fcCapNote() : null);
    });
    paints.forEach((f) => f());
    // the scale's words, once under the slider column
    const scale = rows.length ? box("div", { class: "b-wscale", "aria-hidden": "true" }, el("span"), el("span"),
      box("span", { class: "b-wmarks" }, ...[["off", 0], ["low", 25], ["some", 50], ["high", 75], ["top", 100]].map(([w, x]) => el("span", { style: `left:${x}%` }, String(w)))), el("span"), el("span")) : null;
    const add = filterChip({ label: "Add weight", add: true, attrs: { class: "fchip add b-add", id: "b-addweight" } });
    add.onclick = () => propertyPicker(add, "Add weight", Object.keys(p.weights!), (k) => { ownWeights(); p.weights![k] = newWeight(k); commands.redraw("weights"); commands.focusIn("weights", `.rule-row[data-key="${CSS.escape(k)}"] input`, true); }, allPropKeys(), propName);
    return [el("p", { class: "help", id: "b-weights-help" }, txt(fromGoals ? GOAL_WEIGHTS_HELP : WEIGHTS_HELP)),
      rows.length ? box("div", { class: "b-rules" }, ...rows) : null, scale, readout, add];
  });
  sec.hidden = fromGoals && !fineTune;
  return sec;
}
const WEIGHTS_HELP = "How much a good amount of each property matters, about 0 to 100. Higher counts more. Dragging snaps to 5; type any number, a negative one to count against.";
const GOAL_WEIGHTS_HELP = "The weights your goals set, about 0 to 100. Changing one switches to your own weights.";
// ---- swing steps (app/swing.mts): the switch on the SSI weight row, and the requirement row's "Next step" The worn suit's swing with the panel's buffs, the weapon a build is known to hold before it runs (a locked hand keeps the worn piece); null when it holds no weapon of known speed.
function wornSwing(): { sw: SwingResult; weapon: string; piece: GearItemSource } | null {
  const name = session.character!, p = session.profile!, worn = state.inv!.worn[name] || [];
  const prof = planBuild(specFromProfile(p, { on: buffsOn(), skills: commands.buffEditsOf(name) }), { character: (state.inv!.characters[name] as Character | undefined) ?? null, worn, race: p.race }).profile;
  const items = worn.filter((it) => it.slot).map(toOptItem), w = heldWeapon(Object.fromEntries(items.map((it) => [it.slot!, it])));
  if (!w || !prof.swing) return null;
  return { sw: swingOf(w.speed!, prof.swing.stamBase, totalsOf(Object.fromEntries(items.map((it) => [String(it.serial), it]))), ssiShareOf(prof)), weapon: w.name, piece: w };
}
function swingStepsSetting(): HTMLElement {
  const p = session.profile!, worn = wornSwing();
  const sw = switchControl({ label: "Score swing speed by step", checked: !!p.swingSteps, attrs: { id: "b-swing-steps" }, onChange: (v) => { ownWeights(); p.swingSteps = v; commands.updateTemplateBadge(); } });
  const steps = worn ? swingLines(worn.sw, worn.weapon).steps.map((s) => s.text).join(" · ") : "";
  return box("div", { class: "b-swing-set" }, sw.root,
    el("p", { class: "help" }, ...gearText(`Counts Swing Speed Increase only where the swing gets faster.${worn && steps ? ` ${worn.weapon} ${speedText(worn.sw.speed)} at stamina ${worn.sw.stamina}: ${steps}.` : ""}`, [worn?.piece])));
}
// "Next step: 58" fills the SSI requirement with the next step faster than the last result's swing, else the worn suit's.
function nextStepButton(): HTMLElement | null {
  const p = session.profile!, next = nextSwingStep(session.result?.swing ?? wornSwing()?.sw);
  if (!next || (p.floors!.ssi ?? 0) >= next.value) return null;
  const b = button({ label: `Next step: ${next.value}`, size: "sm", variant: "ghost", cls: "b-next-step", onClick: () => { p.floors!.ssi = next.value; commands.redraw("req"); commands.focusIn("req", `.rule-row[data-key="ssi"] input`, true); } });
  return tooltip(b, next.tip);
}
// The shown result changed (a build finished, a saved run opened, the result cleared): Next step follows its swing.
function paintNextStep(): void {
  const row = document.querySelector<HTMLElement>('#b-sec-req .rule-row[data-key="ssi"]');
  if (!row || !session.profile) return;
  row.querySelector(".b-next-step")?.remove();
  const next = nextStepButton();
  if (next) row.append(next);
}
document.addEventListener("builderchange", (e) => { if ((e as BuilderChange).detail.key === "result") paintNextStep(); });
// The searchable property combobox behind "+ Add requirement" / "+ Add weight": type to filter, ↓ into the
// list, Enter picks the first match.
function propertyPicker(anchor: HTMLElement, title: string, taken: string[], pick: (k: string) => void, offered: string[] = allPropKeys(), name: (k: string) => string = propName): void {
  const keys = offered.filter((k) => !taken.includes(k));
  const s = searchInput({ label: `${title}: search properties`, placeholder: "Search properties" });
  const list = box("div", { class: "b-pick-list", role: "listbox", "aria-label": "Properties" });
  const choose = (k: string): void => { closePopover(); pick(k); };
  const paint = (): void => {
    const q = s.input.value.trim().toLowerCase();
    const hits = keys.filter((k) => !q || `${name(k)} ${propName(k)} ${label(k)} ${full(k)}`.toLowerCase().includes(q));
    // In the property catalogue's groups and order, as the Inventory's property rule lists them (#487).
    const rows = catalogueGroups(hits, name).flatMap(({ group, keys: ks }) => [el("p", { class: "t-sm muted", role: "presentation" }, group),
      ...ks.map((k) => box("button", { class: "menu-item", type: "button", role: "option", "data-key": k, onclick: () => choose(k) }, txt(name(k)), txt(label(k), "t-sm muted")))]);
    list.replaceChildren(...(rows.length ? rows : [el("p", { class: "t-sm muted" }, "No property matches.")]));
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
// The skill bonuses no piece may carry, under Requirements: a removable chip per skill and "+ Skill", the checklist of
// the skills gear carries.
function forbidSkillsRow(): HTMLElement {
  const p = session.profile!, name = (sk: string): string => sk[0]!.toUpperCase() + sk.slice(1);
  const add = filterChip({ label: "Skill", add: true, attrs: { id: "b-exskills", "aria-haspopup": "dialog" } });
  const lead = el("span", { class: "t-sm muted", id: "b-exskills-l" }, "Never wear a bonus to");
  const row = box("div", { class: "b-chips b-exskills", id: "b-exskills-row", role: "group", "aria-labelledby": "b-exskills-l" });
  const paint = (): void => row.replaceChildren(lead, ...p.excludeSkills!.map((sk) => token({ label: name(sk), removeLabel: `Allow a ${name(sk)} bonus`, onRemove: () => {
    p.excludeSkills = p.excludeSkills!.filter((x) => x !== sk); paint(); commands.updateTemplateBadge(); add.focus();
  } })), add);
  add.onclick = () => checklist(add, "Never wear a bonus to", () => p.excludeSkills!, (v) => { p.excludeSkills = v; },
    [...new Set([...(state.facets?.gearSkills || []), ...p.excludeSkills!])].sort().map((sk) => ({ value: sk, label: name(sk) })), true, paint);
  paint();
  return row;
}

// Whether the Goals tab shows its weights, at load, from ui-prefs (app.mts applies it before initBuilder runs).
export function applyRequirementsPrefs(p: UiPrefs | null): void { fineTune = p?.builderFineTune === "on"; }
// With goals setting the weights, a weight about to be opened (builder.mts tuneWeight) shows them under the goals first.
function showGoalWeights(): void {
  if (goalsActive(session.profile?.goals) && !fineTune) { fineTune = true; prefs.set({ builderFineTune: "on" }, { quiet: true }); commands.redraw("goals"); commands.redraw("weights"); }
}
// The first resist whose cap is typed out of range, which stops a build (builder-job.mts runBuild).
const badCapDraft = (): string | undefined => RESIST_KEYS.find((k) => capDrafts[k] != null);
onChange("caps", clearCapDrafts);
provide({ requirementsSection, capsSection, goalsSection, weightsSection, showGoalWeights, badCapDraft });
