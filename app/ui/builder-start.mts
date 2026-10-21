// ui/builder-start.mts — the Suit Builder's first-visit view (issue #272), shown while no result is on screen for the
// selected character or No character: the template cards (the panel's own template, suggested built-ins and the player's
// own), a read-only summary of what Build will build for and the weights that matter most, each opening the Auto Build Settings
// drawer on its tab, and a big Build; beside it what the character wears now and the other characters' latest runs. It is
// drawn from the panel's state (the session's profile and knobs), so an edit in the drawer redraws it. The numbers and
// words come from ui/builder-model.mts; it shares the builder's state through ui/builder-session.mts.
//
// map: builder
import { NOBODY, RESIST_KEYS, RESIST_SKILL_KEY, GEAR_SLOTS, resistMinimum, resistCapsFor, fcCapFor, totalsOf, roundImportance, goalsActive } from "../vault-lib.mts";
import type { Goals, OptItem } from "../vault-lib.mts";
import { BUILTIN_PREFIX, characterBuffs, findTemplate, templateName, templateRefs, templateSettings, type TemplateEntry } from "../build-spec.mts";
import { buffById } from "../buffs.mts";
import { state, invStamp } from "./store.mts";
import { $, el, label, ago } from "./dom.mts";
import { box, txt, button, badge } from "./components.mts";
import { api } from "./api.mts";
import { session, commands, provide, onChange } from "./builder-session.mts";
import { RESIST_NAMES } from "./builder-parts.mts";
import { paperdollCaps, needsLine, topWeights, goalSummary, poolLine, searchLine, suggestTemplates, propName, who } from "./builder-model.mts";
import type { ItemsApiResponse } from "./api-types.mts";

// The character the view is drawn for; the other characters' runs card (fetched once per character shown) and the gear
// pieces in the inventory (once per inventory, the newest scan's stamp).
let shownFor: string | null = null;
let others: { name: string; card: HTMLElement | null } | null = null;
let pieces: { stamp: string; n: number | null } | null = null;
// `keepCards`: a redraw for the same character after the scans changed keeps the template cards where they are, while the
// templates are the same.
function renderCurrentSuit(name: string, keepCards = false): void {
  shownFor = name;
  session.outcome = null;
  others = null;
  if (!keepCards) cardSet = null;
  draw(name);
  void commands.otherRunsCard(name).then((card) => { if (shownFor === name) { others = { name, card }; refreshCurrentSuit(); } });
  const stamp = invStamp();
  if (pieces?.stamp !== stamp) {
    pieces = { stamp, n: null };
    void api<ItemsApiResponse>(`/api/items?slot=${GEAR_SLOTS.join(",")}&limit=1`).then((r) => { if (pieces?.stamp === stamp) { pieces.n = r.total; refreshCurrentSuit(); } }, () => {});
  }
}
// Redrawn after every edit of the panel (builder.mts updateTemplateBadge), while it is on screen.
function refreshCurrentSuit(): void {
  if (shownFor && shownFor === session.character && !session.result && document.getElementById("b-start")) draw(shownFor);
}
// One replaceChildren; the focus a redraw took (a template card, a summary line) goes back to the same control.
function draw(name: string): void {
  const out = $<HTMLElement>("#b-result")!, key = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("#b-start [data-k]")?.dataset.k;
  out.replaceChildren(box("div", { class: "b-arrive", id: "b-start" }, mainColumn(name),
    box("aside", { class: "b-arrive-side", "aria-label": "Before you build" }, name === NOBODY ? null : wearingCard(name), others?.name === name ? others.card : null)));
  if (key) out.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`)?.focus();
}

// ---- the main column: the question, the template cards, the summary and Build
function mainColumn(name: string): HTMLElement {
  const nobody = name === NOBODY, builtins = Object.keys(state.builtinTemplates).length;
  const all = button({ label: `All ${builtins} built-in templates`, variant: "ghost", size: "sm", cls: "b-link", onClick: () => $<HTMLButtonElement>("#b-tpl")?.click() });
  const build = button({ label: nobody ? "Build the suit" : `Build ${name}'s suit`, variant: "primary", size: "lg", attrs: { id: "b-start-build", "data-k": "build", "aria-keyshortcuts": "Meta+Enter Control+Enter" }, onClick: () => commands.build() });
  return box("div", { class: "b-arrive-main" },
    box("div", {}, el("h2", { class: "t-xl", tabindex: "-1", "data-k": "head" }, nobody ? "What should the suit be for?" : `What should ${name}'s suit be for?`),
      el("p", { class: "muted" }, `Pick a starting point: it becomes ${nobody ? "the" : `${name}'s`} saved settings. Every setting can be changed in Auto Build Settings before or after you build.`)),
    templateCards(name), builtins ? all : null,
    summaryCard(name),
    box("div", { class: "b-start-build" }, build, txt("Usually a few seconds · ⌘↵", "muted")));
}

// Four cards, one row on a wide window and two by two at phone width: the panel's template when the view is first shown
// ("Suggested"), then the other templates that best fit the character's skills, the player's own (newest first) ahead of the
// built-ins on a tie (suggestTemplates). The set and its order are fixed while the view is up for the character, so a card
// never moves or changes its badge when picked; picking only moves the selected state, which is the panel's template. A
// card applies its template and saves it as the character's settings (builder-templates.mts pickTemplate).
const CARDS = 4;
let cardSet: { name: string; templates: string; suggested: string | null; refs: string[] } | null = null;
const shortDate = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function cardRefs(name: string): NonNullable<typeof cardSet> {
  const profiles = state.profiles!, templates = templateRefs(profiles, state.builtinTemplates).join("\n");
  if (cardSet?.name === name && cardSet.templates === templates) return cardSet;
  const current = session.profile?.template;
  const suggested = current && findTemplate(profiles, state.builtinTemplates, current) ? current : null;
  const skills = Object.fromEntries(Object.entries(state.inv!.characters[name]?.skills || {}).map(([k, e]) => [k, Number((e as { value?: number })?.value) || 0]));
  // a template's text names its skills: its name, description, the skills its buffs are cast with and its casting school
  const text = (t: TemplateEntry): string => [t.name, t.description, t.spec.intent.castingSchool, ...(t.spec.buffs?.on ?? []).map((id) => buffById(id)?.min?.[0])].filter(Boolean).join(" ");
  const own = Object.keys(profiles.templates || {}).sort((a, b) => (profiles.templates[b]!.savedAt ?? "").localeCompare(profiles.templates[a]!.savedAt ?? "")).map((ref) => ({ ref, text: `${ref} ${text(profiles.templates[ref]!)}` }));
  const builtins = Object.entries(state.builtinTemplates).map(([id, t]) => ({ ref: BUILTIN_PREFIX + id, text: text(t) }));
  const others = suggestTemplates([...own, ...builtins].filter((c) => c.ref !== suggested), skills, CARDS - (suggested ? 1 : 0));
  return (cardSet = { name, templates, suggested, refs: [...(suggested ? [suggested] : []), ...others] });
}
function templateCards(name: string): HTMLElement {
  const current = session.profile?.template, profiles = state.profiles!, { suggested, refs } = cardRefs(name);
  const card = (ref: string): HTMLElement | null => {
    const t = findTemplate(profiles, state.builtinTemplates, ref);
    if (!t) return null;   // deleted since the view was shown
    const builtin = ref.startsWith(BUILTIN_PREFIX), on = ref === current, st = templateSettings(t);
    const tag = ref === suggested ? "Suggested" : builtin ? "Built-in" : "Yours";
    const line = builtin ? t.description || needsLine(st.floors || {}, st.softFloors || [], propName) : t.savedAt ? `Saved ${shortDate(t.savedAt)}` : "Your template";
    return box("button", { type: "button", class: `b-tpl-card${on ? " on" : ""}`, "aria-pressed": String(on), "data-k": `tpl:${ref}`, title: line, onclick: () => commands.pickTemplate(ref) },
      badge(tag, tag === "Yours" ? undefined : "accent"), txt(templateName(state.builtinTemplates, ref), "strong"), txt(line, "t-sm muted b-tpl-line"));
  };
  return box("div", { class: "b-tpl-cards", role: "group", "aria-label": "Templates" }, ...refs.map(card));
}

// What Build will build for (Needs, Buffs, Pool, Search) and what matters most, each line opening the drawer on its tab:
// with goals in force, the goals by rank and where spare points go (builder-model.mts goalSummary), else the weights that
// matter most; read-only, the drawer is where they change.
function summaryCard(name: string): HTMLElement {
  const p = session.profile!, k = session.knobs, ref = p.template;
  const buffs = characterBuffs(state.profiles!, name).on.map((id) => buffById(id)?.name ?? id);
  const open = (tab: string, text: string): HTMLElement => button({ label: text, variant: "ghost", size: "sm", cls: "b-sum-key", attrs: { "data-k": `tab:${tab}` }, onClick: () => commands.openSettingsTab(tab) });
  const line = (tab: string, term: string, value: string): HTMLElement[] => [el("dt", {}, open(tab, term)), el("dd", {}, value)];
  const top = topWeights(p.weights || {});
  const weightRow = (r: { key: string; importance: number }): HTMLElement => {
    const nm = r.key === "resists" ? "Resists" : propName(r.key), shown = roundImportance(r.importance);
    return box("li", {}, box("button", { type: "button", class: "b-imp", "data-k": `w:${r.key}`, "aria-label": `${nm} importance ${shown}`, onclick: (e: MouseEvent) => commands.tuneWeight(r.key === "resists" ? RESIST_KEYS[0]! : r.key, e.currentTarget as HTMLElement) },
      txt(nm, "ellip"), el("span", { class: "b-wbar", style: `--fill:${Math.min(100, r.importance)}%`, "aria-hidden": "true" }), txt(String(shown), "b-imp-n")));
  };
  return box("section", { class: "card b-start-sum", "aria-label": "Summary" },
    box("div", { class: "b-sum-half" }, el("h3", { class: "t-md strong" }, `${ref ? templateName(state.builtinTemplates, ref) : "These settings"} will build for`),
      box("dl", { class: "b-sum" }, ...line("requirements", "Needs", needsLine(p.floors || {}, p.softFloors || [], propName)), ...line("buffs", "Buffs", buffs.join(", ") || "None"),
        ...line("pool", "Pool", poolLine(p.excludeWeapons, p.ubwsAnyWeapon !== false, pieces?.n ?? null, p.rarity)), ...line("advanced", "Search", searchLine(k)))),
    box("div", { class: "b-sum-half" }, el("h3", { class: "t-md strong" }, "What matters most"), ...(goalsActive(p.goals) ? goalsMost(p.goals, open) : [
      top.rows.length ? box("ul", { class: "b-imps" }, ...top.rows.map(weightRow)) : el("p", { class: "muted" }, "No weights yet."),
      open("weights", top.more ? `+ ${top.more} more in Auto Build Settings` : "Weights in Auto Build Settings")])));
}
// The goals by rank, each a row that opens the Goals tab with what it counts as a bar, then the spare-points line.
function goalsMost(g: Goals, open: (tab: string, text: string) => HTMLElement): HTMLElement[] {
  const s = goalSummary(g);
  const row = (r: (typeof s.rows)[number]): HTMLElement => box("li", {}, box("button", { type: "button", class: "b-imp b-imp-goal", "data-k": `g:${r.rank}`, "aria-label": `${r.rank}. ${r.names}, counts ${r.counts}`, onclick: () => commands.openSettingsTab("weights") },
    el("span", { class: "b-imp-gname" }, txt(`${r.rank}.`, "muted"), ` ${r.names}`), el("span", { class: "b-wbar", style: `--fill:${r.counts}%`, "aria-hidden": "true" }), txt(String(r.counts), "b-imp-n")));
  return [s.rows.length ? box("ol", { class: "b-imps" }, ...s.rows.map(row)) : el("p", { class: "muted" }, "No goals yet."),
    el("p", { class: "t-sm b-imp-spare" }, s.spare), open("weights", s.more ? `+ ${s.more} more ${s.more === 1 ? "goal" : "goals"} in Auto Build Settings` : "Goals in Auto Build Settings")];
}

// ---- the side column: what the character wears now, its five resists and the top weighted other properties
const WEAR_GAUGES = 4;
function wearingCard(name: string): HTMLElement {
  const p = session.profile!, c = state.inv!.characters[name], worn = state.inv!.worn[name] || [];
  const totals = totalsOf(Object.fromEntries(worn.map((i) => [String(i.serial), i as unknown as OptItem])));
  const min = resistMinimum(c?.skills, totals[RESIST_SKILL_KEY]);
  const caps = paperdollCaps(resistCapsFor(p.race, p.resistCaps), fcCapFor(c?.skills, p.castingSchool).cap);
  const tiles = RESIST_KEYS.map((k) => { const [long, colour] = RESIST_NAMES[k]!, v = Math.max(totals[k] || 0, min ?? -Infinity);
    return box("div", { class: "b-wear-tile", title: `${long} ${v}` }, txt(v, "b-wear-val"), el("span", { class: "t-sm", style: `color:var(${colour})` }, label(k))); });
  const keys = topWeights(p.weights || {}, Infinity).rows.map((r) => r.key).filter((k) => k !== "resists" && !RESIST_KEYS.includes(k)).slice(0, WEAR_GAUGES);
  const gauges = keys.map((k) => { const v = totals[k] || 0, cap = caps[k];
    return box("li", { class: "b-gauge" }, box("span", { class: "b-gauge-top" }, el("span", { class: "b-gauge-name muted", title: propName(k), "aria-hidden": "true" }, label(k)), txt(propName(k), "sr"), txt(v, "b-gauge-val"), cap != null ? txt(`/ ${cap}`, "muted") : null),
      box("span", { class: "b-gauge-track", "aria-hidden": "true" }, el("i", { style: `width:${cap ? Math.max(0, Math.min(100, (100 * v) / cap)) : v > 0 ? 100 : 0}%` }))); });
  return box("section", { class: "card b-side-card", id: "b-wearing", "aria-labelledby": "b-wearing-h" },
    box("div", { class: "b-side-head" }, el("h3", { class: "t-md strong", id: "b-wearing-h" }, `${who(name)} is wearing now`), el("span", { class: "spacer" }), c?.scannedAt ? txt(`scanned ${ago(c.scannedAt)}`, "t-sm muted") : null),
    box("div", { class: "b-wear-tiles" }, ...tiles),
    gauges.length ? box("ul", { class: "b-gauges" }, ...gauges) : null,
    el("p", { class: "t-sm muted" }, "The build starts from this. A result shows what would change."));
}
onChange("settings", refreshCurrentSuit);
provide({ renderCurrentSuit });
