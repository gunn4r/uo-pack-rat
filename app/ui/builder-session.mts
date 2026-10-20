// ui/builder-session.mts — the Suit Builder's one session: the state its nine modules share (builder.mts's panel,
// builder-header.mts's sentence bar, builder-templates.mts's templates, builder-requirements.mts's Requirements and Goals tabs, builder-job.mts's build job, builder-start.mts's first-visit view, builder-result.mts's result, builder-manual.mts's
// Manual mode, runs.mts's saved runs) and the commands they call on each other. The nine never import each other: each reads and sets the session here, and registers the commands it
// performs for the others with provide(); what changed that they draw is announced (announce) and listened for (onChange). Today a session is one character, one result and one job.
//
// map: builder
// owns: `session`, `commands`, `provide`, `announce`, `onChange`, `readControls`, `applyKnobs`
import { RUN_DEFAULTS } from "../run-settings.mts";
import type { EffectiveProfile, PropMap, RunBuffs, RunSettings, SettingsChange } from "../vault-lib.mts";
import type { BuffPlan, Stats } from "../buffs.mts";
import type { PlannedBuild } from "../build-spec.mts";
import { knobError, type Knobs, type KnobField } from "./builder-model.mts";
import type { BuilderProfile, BuilderJob, BuildMeta, FinishedBuild } from "./store.mts";
import type { OptimizeResult, OptSuit, RunSummaryLike, SavedRunLike } from "./api-types.mts";
import type { GearChanges, SwingResult } from "../runs-types.mts";

export type BuilderMode = "automatic" | "manual";
// The shown result's best suit as the Requirements tab reads it (issue #272): its paperdoll totals with the buffs it was
// planned with, the caps they leave, its swing and held weapon, and the character it was built for.
export interface ShownOutcome { name: string; totals: PropMap; caps: Record<string, number>; swing: SwingResult | null; weapon: string | null }
export interface BuilderState {
  character: string | null;
  profile: BuilderProfile | null;
  result: OptimizeResult | null;
  job: BuilderJob | null;
  runs: RunSummaryLike[];
  compare: Set<string>;
  openRun: string | null;
  altView: number | null;
  // A build that finished while another character was selected, shown when its character is next.
  parked: FinishedBuild | null;
  mode: BuilderMode;   // Automatic or Manual (a ui-prefs field, builder-manual.mts applyBuilderPrefs)
  outcome: ShownOutcome | null;   // set by builder-result.mts as it draws a result, null with none shown
}
const data: BuilderState = { character: null, profile: null, result: null, job: null, runs: [], compare: new Set(), openRun: null, altView: null, parked: null, mode: "automatic", outcome: null };
// What changed that no field here carries, announced with announce() as a `builderchange` of that key; the module that
// draws it listens (onChange) and redraws, so the one announcing need not know who that is:
//   panel     the panel's profile was replaced or reloaded: the drawer is drawn again (builder.mts)
//   caps      a new set of resist caps came in (another character, a template, a run's settings): a cap typed out of range is
//             dropped (builder-requirements.mts)
//   picker    who the character picker shows may have changed (builder-manual.mts decides: No character in Manual)
//   selected  a character was selected and its panel set up: Manual follows it (builder-manual.mts)
//   roster    the character list changed (a load, a scan, a Forget): Manual resolves its suit again (builder-manual.mts)
//   settings  the panel's settings were edited: the first-visit view, while shown, is drawn again in place (builder-start.mts)
//   view      the result view starts over: a result still resolving its pieces must not draw (builder-result.mts)
// A listener that throws does not stop the one announcing: dispatchEvent reports the error as a page error and returns.
export type BuilderNews = "panel" | "caps" | "picker" | "selected" | "roster" | "settings" | "view";
// Every setter fires `builderchange` on the document, with the field's name as its detail; announce() fires the news.
export type BuilderChange = CustomEvent<{ key: keyof BuilderState | "knobs" | BuilderNews }>;
const changed = (key: BuilderChange["detail"]["key"]): void => { globalThis.document?.dispatchEvent(new CustomEvent("builderchange", { detail: { key } })); };
export function announce(what: BuilderNews): void { changed(what); }
// `fn` on every `builderchange` of `key`.
export function onChange(key: BuilderChange["detail"]["key"], fn: () => void): void {
  globalThis.document?.addEventListener("builderchange", (e) => { if ((e as BuilderChange).detail.key === key) fn(); });
}
function put<K extends keyof BuilderState>(key: K, value: BuilderState[K]): void { data[key] = value; changed(key); }

// The solver knobs as typed (strings, so a bad value can sit in its field with its error until fixed): STR limit, beside
// Race, and the Advanced fields. STR limit lives on the profile too (it is saved with it); the others are search options
// a profile never carried. The panel's fields write them in place as they are typed.
const knobs: Knobs = { strLimit: "", restarts: String(RUN_DEFAULTS.restarts), exact: RUN_DEFAULTS.exact, budgetS: String(RUN_DEFAULTS.budgetMs / 1000), altCount: String(RUN_DEFAULTS.altCount), altTol: String(RUN_DEFAULTS.altTol) };

export const session = {
  get character(): string | null { return data.character; }, set character(v: string | null) { put("character", v); },
  get profile(): BuilderProfile | null { return data.profile; }, set profile(v: BuilderProfile | null) { put("profile", v); },
  get result(): OptimizeResult | null { return data.result; }, set result(v: OptimizeResult | null) { put("result", v); },
  get job(): BuilderJob | null { return data.job; }, set job(v: BuilderJob | null) { put("job", v); },
  get runs(): RunSummaryLike[] { return data.runs; }, set runs(v: RunSummaryLike[]) { put("runs", v); },
  // the saved runs ticked for comparison (at most three)
  get compare(): ReadonlySet<string> { return data.compare; }, set compare(v: ReadonlySet<string>) { put("compare", new Set(v)); },
  get openRun(): string | null { return data.openRun; }, set openRun(v: string | null) { put("openRun", v); },
  get altView(): number | null { return data.altView; }, set altView(v: number | null) { put("altView", v); },
  get parked(): FinishedBuild | null { return data.parked; }, set parked(v: FinishedBuild | null) { put("parked", v); },
  get mode(): BuilderMode { return data.mode; }, set mode(v: BuilderMode) { put("mode", v); },
  get outcome(): ShownOutcome | null { return data.outcome; }, set outcome(v: ShownOutcome | null) { put("outcome", v); },
  get knobs(): Knobs { return knobs; },
};

// The profile with the panel's STR limit folded in: what a build sends and a profile saves.
export function readControls(): BuilderProfile {
  const p = data.profile!;
  if (!knobError("strLimit", knobs.strLimit)) p.strLimit = Number(knobs.strLimit);
  return p;
}
// Settings a saved run carried, back into the knobs ("Load these settings").
export function applyKnobs(st: RunSettings): void {
  if (st.strLimit != null) knobs.strLimit = String(st.strLimit);
  if (st.restarts != null) knobs.restarts = String(st.restarts);
  if (st.exact != null) knobs.exact = !!st.exact;
  if (st.budgetMs != null) knobs.budgetS = String(st.budgetMs / 1000);
  if (st.altCount != null) knobs.altCount = String(st.altCount);
  if (st.altTol != null) knobs.altTol = String(st.altTol);
  changed("knobs");
}

// ---------------------------------------------------------------- commands
// The build picker's state line and its full text (builder-model.mts buildStateText, buildStateDetail), whether the panel
// drifted from its template or from the saved profile, and the changes behind each (builder.mts buildState).
export interface BuildState { text: string; detail: string; drift: boolean; unsaved: boolean; template: string | null; changed: SettingsChange[]; unsavedList: SettingsChange[] }
// The drawer's groups that redraw() draws again (`b-sec-<id>`), and the ones focusIn() reaches (each on a known tab).
export type SectionId = "buffs" | "req" | "caps" | "goals" | "weights" | "pool" | "adv";
export type FocusSection = "req" | "caps" | "goals" | "weights" | "adv";
// A character's buff numbers (or No character's, for null) with its edits, which inputs are planned, the raw stats Bless
// takes a share of and the race (builder-manual.mts buffInputsOf).
export type BuffInputs = { values: Record<string, number>; planned: Set<string>; stats: Stats | null; race: string | null };
// What one module does for the others, by the module that provides it.
export interface BuilderCommands {
  // builder.mts: the panel, and the build it plans
  panelBuild(): PlannedBuild;
  buffPlan(name: string, race: string | null | undefined, buffs: RunBuffs | undefined): BuffPlan;
  loadRunBuffs(b: RunBuffs | undefined): void;
  tuneWeight(key: string | null, from: HTMLElement): void;
  selectCharacter(name: string, open?: string | true): void;
  openSettingsTab(tab: string, focus?: boolean): void;   // `focus` false when the caller focuses a control in it next
  buildState(): BuildState;
  unsavedChanges(): SettingsChange[];
  openChange(c: SettingsChange, from: HTMLElement): void;   // a What changed row's setting, in the drawer
  updateTemplateBadge(): void;   // the build picker, the chip and the footer after an edit
  saveProfile(said?: string): void;   // the panel's settings as the character's profile; `said` replaces the toast
  redraw(id: SectionId): void;   // one group of the drawer (`b-sec-<id>`) drawn again in place
  focusIn(sec: FocusSection, sel: string, selectText?: boolean): void;   // a control in a group, the drawer opened on its tab
  focusKnob(f: KnobField, err: string): void;   // a bad search knob's field, its error under it, on the Advanced tab
  paintChanges(): void;   // the drawer footer's "N changes since the last build" (from Manual, what Fill the rest plans)
  showFinished(f: FinishedBuild, focus?: boolean): void;   // a finished build as the result on screen
  // builder-requirements.mts: the Requirements and Goals tabs and the resist caps
  requirementsSection(): HTMLElement;
  capsSection(): HTMLElement;
  goalsSection(): HTMLElement;
  weightsSection(): HTMLElement;
  showGoalWeights(): void;   // with goals in force, their weights shown under them (before a weight is opened)
  badCapDraft(): string | undefined;   // a resist whose cap is typed out of range
  // builder-job.mts: the build job
  build(): void;
  // builder-templates.mts: the Manage templates drawer, and a template picked as the starting point
  pickTemplate(ref: string, again?: boolean): void;
  saveTemplateAs(): void;
  openTemplatesDrawer(from: HTMLElement): void;
  // builder-header.mts: the sentence bar
  showCharacter(name: string): void;   // the character picker's face (builder-manual.mts decides who is shown)
  refreshCharPicker(): void;
  refreshBuildPicker(): void;
  paintChangesChip(st: BuildState): void;
  // builder-start.mts: the first-visit view
  renderCurrentSuit(name: string, keepCards?: boolean): void;
  // builder-result.mts: the result and the compare view
  renderResult(res: OptimizeResult, current: OptSuit, prof: EffectiveProfile, name: string, meta?: BuildMeta): Promise<void>;
  setResultGear(gear: GearChanges | null): Promise<void>;
  resultLoadError(e: unknown): void;
  closeCompare(): void;
  openRunCompare(runs: SavedRunLike[], titleOf: (r: SavedRunLike) => string, open: (id: string) => void, onRemove: (id: string) => void): void;
  // builder-manual.mts: Manual, and the buff numbers both modes share
  openInManual(suit: OptSuit, covered: readonly string[], runB: RunBuffs | undefined, label: string): Promise<void>;
  templateBuffs(on: readonly string[], label: string): void;
  showAutomatic(): void;
  setManualFor(character: string | null): void;
  buffEditsOf(name: string | null): Record<string, number>;
  buffInputsOf(name: string | null): BuffInputs;
  editBuffInputs(name: string | null, values: Readonly<Record<string, number | null>>): void;
  applyRunInputs(name: string | null, b: RunBuffs | undefined): void;
  filling(): boolean;
  fillFoot(): { note: string; ready: boolean };   // the Auto Build Settings footer opened from Manual: its line, and whether Fill the rest can start
  fillRest(): void;   // Fill the rest automatically
  // runs.mts: the saved runs, the character's runs beside a result and the other characters' latest runs
  loadRuns(arrive?: boolean | string): Promise<void>;
  openRunsDrawer(): void;
  runsCard(): HTMLElement;
  otherRunsCard(name: string): Promise<HTMLElement | null>;
  startOver(): void;
  lastRunDays(): Promise<Record<string, string> | null>;   // each character's latest run, as "today, 10:40 PM"; null when unknown
}
// Filled by each module as it loads (app.mts imports all nine), so every command is there before the page calls one.
export const commands = {} as BuilderCommands;
export function provide(c: Partial<BuilderCommands>): void { Object.assign(commands, c); }
