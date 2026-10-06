// ui/rule-editor.mts — the Organize rule editor (issue #11, spec §3): a drawer with the rule's name, what it
// takes (a preset to start from, "name is any of", and the filter: search text, kinds and the rarity range, plus
// any other filter it was saved with from the Inventory, as removable tokens) and where those items go
// (labelled, unpinned containers and the bags inside them, in fill order, each with its fill). Opened from the
// Organize screen's "+ Rule" and a rule's Edit…, and from the Inventory filter strip's "Save as rule…". Saving
// writes the whole setup with PUT /api/organize (organize-data.mts's saveConfig). Also the target chip the Rules
// card shares with it.
import { state } from "./store.mts";
import { $, el, toast, safeColor, compactChildren } from "./dom.mts";
import { box, txt, button, meter, message, field, input, select, textarea, pill, check, token, createDrawer, confirmDialog, showToast, type DrawerHandle } from "./components.mts";
import { errorText } from "./messages.mts";
import { filterContext } from "./item-parts.mts";
import { loadOrganize, loadPresets, matchCount, refreshPlaces, saveConfig } from "./organize-data.mts";
import { BUILD_TEXT, SCHOOL_TEXT, fillText, fillTone, withoutRule, newRuleId, ruleQueryFrom, blankQuery, droppedNote, ruleNameFrom, checkDraft, extraFilters, targetView, targetOptions, withTargetLabels, moveIn, upsertRule, matchLine, debounced, MATCH_DEBOUNCE_MS, type TargetView } from "./organize-model.mts";
import type { ItemQuery, RuleQuery } from "../item-query.mts";
import { ruleMatchOf } from "../organize-config.mts";
import type { Build, SpellSchool, OrganizeMatchApiResponse, OrganizeRule, Origin, RuleMatch } from "./api-types.mts";

// A container in a rule's chain: its label's colour, its name, its fill as a meter and "61/125", or why not.
export function targetChip(t: TargetView): HTMLElement {
  const colour = t.color ? safeColor(t.color) : null;
  return box("span", { class: `org-target${t.gone ? " gone" : ""}` },
    colour ? el("span", { class: "org-swatch", style: `background:${colour}`, "aria-hidden": "true" }) : null,
    txt(t.name, "ellip"),
    t.fill && !t.gone ? meter(t.fill.items, t.fill.max, { tone: fillTone(t.fill), label: `${t.name}: ${fillText(t)} items` }) : null,
    txt(fillText(t), "t-sm muted num"));
}

export async function deleteRule(r: OrganizeRule): Promise<boolean> {
  if (!await confirmDialog({ title: `Delete ${r.name}?`, body: "Its items stay where they are, or go to the catch-all if one is picked. Labels are kept.", confirmLabel: `Delete ${r.name}` })) return false;
  const err = await saveConfig(withoutRule(state.organize.config!, r.id));
  if (err) { toast(err, "bad"); return false; }
  return true;
}

// ---------------------------------------------------------------- the drawer
// The rule being edited, as typed: nothing is read back from the DOM, so a redraw (adding a target, removing a
// filter) keeps everything the player typed. `match` is the last live count (POST /api/organize/match).
interface Draft { id: string; isNew: boolean; name: string; query: RuleQuery; namesText: string; build: Build | undefined; school: SpellSchool | undefined; skipSuits: boolean; targets: number[]; origin: Origin; note: string | null; errors: { name?: string; names?: string }; serverError: string | null; match: OrganizeMatchApiResponse | null }
let draft: Draft | null = null;
let handle: DrawerHandle | null = null;
function drawer(): DrawerHandle {
  handle ??= createDrawer({ id: "rule-drawer", title: "Rule", footer: [
    button({ label: "Delete rule", variant: "danger-outline", attrs: { id: "rule-delete" }, onClick: () => {
      const r = state.organize.config?.rules.find((x) => x.id === draft?.id);
      if (r) void deleteRule(r).then((gone) => { if (gone) drawer().close(); });
    } }),
    el("span", { class: "spacer" }),
    button({ label: "Cancel", attrs: { "data-drawer-close": "" } }),
    button({ label: "Save rule", variant: "primary", attrs: { id: "rule-save" }, onClick: () => { void save(); } }),
  ] });
  return handle;
}
export async function openRuleEditor(o: { rule?: OrganizeRule; preset?: boolean; fromQuery?: ItemQuery } = {}): Promise<void> {
  try {
    if (!state.organize.config) { await loadOrganize(); refreshPlaces(); }
    await loadPresets();
  } catch (e) { toast(errorText(e), "bad"); return; }
  const cfg = state.organize.config!;
  const from = o.fromQuery ? ruleQueryFrom(o.fromQuery) : null;
  draft = o.rule
    ? { id: o.rule.id, isNew: false, name: o.rule.name, query: structuredClone(ruleMatchOf(o.rule, cfg.rules).query), namesText: (o.rule.match.names || []).join("\n"), build: o.rule.match.build, school: o.rule.match.school, skipSuits: !!o.rule.match.skipSuits, targets: [...o.rule.targets], origin: o.rule.origin,
        note: o.rule.origin !== "manual" ? "Auto organize made this rule. Saving your changes makes it yours: Auto organize leaves it alone from then on." : null, errors: {}, serverError: null, match: null }
    : { id: newRuleId(cfg.rules), isNew: true, name: o.fromQuery ? ruleNameFrom(o.fromQuery, filterContext()) : "", query: from ? from.query : blankQuery(), namesText: "", build: undefined, school: undefined, skipSuits: false, targets: [], origin: "manual",
        note: from ? droppedNote(from.dropped) : null, errors: {}, serverError: null, match: null };
  $<HTMLElement>("#rule-drawer-title", drawer().root)!.textContent = draft.isNew ? "New rule" : "Edit rule";
  $<HTMLElement>("#rule-delete", drawer().root)!.hidden = draft.isNew;
  draw(o.preset ? "#rule-preset" : "#rule-name");
  drawer().open();
}
// The drawer's body from the draft. `focus` names the control to focus (on open, or after a redraw it caused).
function draw(focus?: string): void {
  const d = draft!, cfg = state.organize.config!, ctx = filterContext(), where = state.inv?.containers || {};
  const nameIn = input({ value: d.name, attrs: { id: "rule-name", maxlength: "64" } });
  nameIn.addEventListener("input", () => { d.name = nameIn.value; });
  const presetSel = select([{ value: "", label: "Choose a preset…" }, ...state.organize.presets!.map((p) => ({ value: p.id, label: p.name }))], "", { attrs: { id: "rule-preset" } });
  presetSel.addEventListener("change", () => {
    const p = state.organize.presets!.find((x) => x.id === presetSel.value);
    if (!p) return;
    d.query = structuredClone(p.match.query);
    d.namesText = (p.match.names || []).join("\n");
    d.build = p.match.build;
    d.school = p.match.school;
    d.skipSuits = !!p.match.skipSuits;
    if (!d.name.trim()) d.name = p.name;
    d.note = `Filled in from the preset ${p.name}. Editing the rule never changes the preset.`;
    draw("#rule-preset");
  });
  const namesIn = textarea({ value: d.namesText, rows: 4, placeholder: "black pearl\nbloodmoss", attrs: { id: "rule-names" } });
  namesIn.addEventListener("input", () => { d.namesText = namesIn.value; countSoon(); });
  const qIn = input({ value: d.query.q, placeholder: "Words in the name or tooltip", attrs: { id: "rule-q" } });
  qIn.addEventListener("input", () => { d.query = { ...d.query, q: qIn.value }; countSoon(); });
  // Bags never move (they are places), so "container" is not offered as a kind a rule could take.
  const kinds = [...new Set([...(state.facets?.kinds || []).map((k) => k.name).filter((k) => k !== "container"), ...d.query.kind])].sort();
  const kindPills = box("div", { class: "rule-kinds", role: "group", "aria-label": "Kind" }, ...kinds.map((k) => pill({ label: k, pressed: d.query.kind.includes(k), onToggle: (on) => { d.query = { ...d.query, kind: on ? [...d.query.kind, k] : d.query.kind.filter((x) => x !== k) }; countSoon(); } })));
  const ladder = [{ value: "", label: "Any" }, ...(state.rules?.rarity || []).map((r) => ({ value: r.name, label: r.name }))];
  const rMin = select(ladder, d.query.rarityMin, { attrs: { id: "rule-rmin" } });
  rMin.addEventListener("change", () => { d.query = { ...d.query, rarityMin: rMin.value }; countSoon(); });
  const rMax = select(ladder, d.query.rarityMax, { attrs: { id: "rule-rmax" } });
  rMax.addEventListener("change", () => { d.query = { ...d.query, rarityMax: rMax.value }; countSoon(); });
  // A build (Auto organize's By build) or a spell school (a school's scroll preset) has no control of its own: it
  // shows as a token, and removing it drops it.
  const extras = [...(d.build ? [{ label: `Build: ${BUILD_TEXT[d.build]}`, removeLabel: "Remove the build filter", remove: (q: RuleQuery) => { d.build = undefined; return q; } }] : []),
    ...(d.school ? [{ label: `School: ${SCHOOL_TEXT[d.school]}`, removeLabel: "Remove the school filter", remove: (q: RuleQuery) => { d.school = undefined; return q; } }] : []), ...extraFilters(d.query, ctx)];
  // Issue #133: an Undesirables rule never takes a piece a saved Suit Builder run counts on.
  const suits = check({ label: "Skip pieces of saved suits", checked: d.skipSuits, attrs: { id: "rule-skip-suits" }, onChange: (on) => { d.skipSuits = on; countSoon(); } });
  const chosen = d.targets.map((s) => targetView(s, cfg, where));
  const list = box("ol", { class: "rule-targets", id: "rule-targets", "aria-label": "Containers, in fill order" }, ...chosen.map((t, i) => box("li", { class: "rule-target" },
    txt(`${i + 1}.`, "t-sm muted num"), targetChip(t),
    box("span", { class: "rule-target-act" },
      button({ label: `Fill ${t.name} earlier`, icon: "arrow-up", iconOnly: true, variant: "ghost", size: "sm", disabled: i === 0, onClick: () => { d.targets = [...moveIn(d.targets, i, i - 1)]; draw(); } }),
      button({ label: `Fill ${t.name} later`, icon: "arrow-down", iconOnly: true, variant: "ghost", size: "sm", disabled: i === chosen.length - 1, onClick: () => { d.targets = [...moveIn(d.targets, i, i + 1)]; draw(); } }),
      button({ label: `Remove ${t.name}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { d.targets = d.targets.filter((x) => x !== t.serial); draw(); } })))));
  // Labelled chests with the bags inside them indented under them (a picked bag is labelled when the rule is saved).
  const addable = targetOptions(cfg, where, d.targets, { blacklist: state.organize.blacklist }).map((o) => ({ value: o.value, label: `${" ".repeat(4 * o.depth)}${o.label}` }));
  const addSel = select([{ value: "", label: addable.length ? "Add a container…" : "No other labeled container" }, ...addable], "", { attrs: { id: "rule-add-target" } });
  addSel.disabled = !addable.length;
  addSel.addEventListener("change", () => { if (addSel.value) { d.targets = [...d.targets, +addSel.value]; draw("#rule-add-target"); } });
  drawer().body.replaceChildren(...compactChildren([
    d.note ? message({ tone: "info", text: d.note }) : null,
    d.serverError ? message({ tone: "bad", text: d.serverError }) : null,
    field({ label: "Name", control: nameIn, error: d.errors.name }),
    el("h3", { class: "t-md" }, "Items it takes"),
    field({ label: "Start from a preset", control: presetSel, help: "Replaces the names and the filter below." }),
    field({ label: "Name is any of", control: namesIn, help: "One per line. Part of the name is enough, and case does not matter. Leave it empty to take every item the filter lets through.", error: d.errors.names }),
    field({ label: "Search", control: qIn }),
    box("div", { class: "field" }, el("span", { class: "label" }, "Kind"), kindPills),
    box("div", { class: "rule-rarity" }, field({ label: "Rarity at least", control: rMin }), field({ label: "Rarity at most", control: rMax })),
    extras.length ? box("div", { class: "field" }, el("span", { class: "label" }, "Also filtered by"), box("span", { class: "rule-extras" }, ...extras.map((x) => token({ label: x.label, removeLabel: x.removeLabel, onRemove: () => { d.query = x.remove(d.query); draw(); } })))) : null,
    box("div", { class: "field" }, suits.root, txt("A piece of any suit the Suit Builder saved is left to the rules below, however well it fits this one.", "t-sm muted")),
    matchEl(),
    el("h3", { class: "t-md" }, "Where they go"),
    el("p", { class: "t-sm muted" }, "The first container fills up, then the next. Pick labeled containers or the containers inside them: label more in Inventory › Containers."),
    list,
    field({ label: "Add a container", control: addSel }),
  ]));
  const f = focus ? drawer().body.querySelector<HTMLElement>(focus) : null;
  if (f) { f.setAttribute("autofocus", ""); if (drawer().isOpen()) f.focus(); }
  countSoon();
}
// ---------------------------------------------------------------- the live count
// "Matches 12 items (e.g. …)" under the filter, asked for once typing pauses; an answer to an older draft or an
// older request is dropped.
const rulesAbove = (d: Draft): number => (d.isNew ? state.organize.config!.rules.length : Math.max(0, state.organize.config!.rules.findIndex((r) => r.id === d.id)));
function matchEl(): HTMLElement {
  const d = draft!, line = matchLine(d.match, rulesAbove(d));
  return box("div", { class: "rule-match", id: "rule-match", role: "status", "aria-live": "polite" }, line ? txt(line.text, "t-sm") : null, line?.note ? txt(line.note, "t-sm muted") : null);
}
let countSeq = 0;
async function countNow(): Promise<void> {
  const d = draft;
  if (!d) return;
  const c = checkDraft(d.name, d.namesText);
  if (c.errors.names) return;
  const seq = ++countSeq;
  let r: OrganizeMatchApiResponse | null = null;
  try { r = await matchCount(draftMatch(d, c.names)); } catch { /* no count: the line stays empty */ }
  if (seq !== countSeq || draft !== d) return;
  d.match = r;
  drawer().body.querySelector("#rule-match")?.replaceWith(matchEl());
}
const draftMatch = (d: Draft, names: string[]): RuleMatch => ({ query: d.query, ...(names.length ? { names } : {}), ...(d.build ? { build: d.build } : {}), ...(d.school ? { school: d.school } : {}), ...(d.skipSuits ? { skipSuits: true } : {}) });
const countSoon = debounced(() => { void countNow(); }, MATCH_DEBOUNCE_MS);
async function save(): Promise<void> {
  const d = draft!;
  const c = checkDraft(d.name, d.namesText);
  d.errors = c.errors;
  d.serverError = null;
  if (c.errors.name || c.errors.names) { draw(c.errors.name ? "#rule-name" : "#rule-names"); return; }
  const rule: OrganizeRule = { id: d.id, name: c.name, match: draftMatch(d, c.names), targets: d.targets, origin: "manual" };
  const err = await saveConfig(upsertRule(withTargetLabels(state.organize.config!, d.targets, state.inv?.containers || {}), rule));
  if (err) { d.serverError = err; draw(); return; }
  drawer().close();
  const text = d.isNew ? `Rule ${rule.name} added.` : `Rule ${rule.name} saved.`;
  if (location.hash === "#/organize") toast(text, "good");
  else showToast(text, "ok", { action: { label: "Open Organize", onClick: () => { location.hash = "#/organize"; } } });
}
