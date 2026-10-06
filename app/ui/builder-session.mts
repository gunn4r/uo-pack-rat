// ui/builder-session.mts — the Suit Builder's one session: the state its four modules share (builder.mts's panel and
// job, builder-result.mts's result, builder-manual.mts's Manual mode, runs.mts's saved runs) and the commands they call on
// each other. The four never import each other: each reads and sets the session here, and registers the commands it
// performs for the others with provide(). Today a session is one character, one result and one job.
import { RUN_DEFAULTS } from "../run-settings.mts";
import type { EffectiveProfile, RunBuffs, RunSettings } from "../vault-lib.mts";
import type { BuffPlan, Stats } from "../buffs.mts";
import type { PlannedBuild } from "../build-spec.mts";
import { knobError, type Knobs } from "./builder-model.mts";
import type { BuilderProfile, BuilderJob, BuildMeta, FinishedBuild } from "./store.mts";
import type { OptimizeResult, OptSuit, RunSummaryLike, SavedRunLike } from "./api-types.mts";

export type BuilderMode = "automatic" | "manual";
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
}
const data: BuilderState = { character: null, profile: null, result: null, job: null, runs: [], compare: new Set(), openRun: null, altView: null, parked: null, mode: "automatic" };
// Every setter fires `builderchange` on the document, with the field's name as its detail.
export type BuilderChange = CustomEvent<{ key: keyof BuilderState | "knobs" }>;
const changed = (key: keyof BuilderState | "knobs"): void => { globalThis.document?.dispatchEvent(new CustomEvent("builderchange", { detail: { key } })); };
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
// A character's buff numbers (or No character's, for null) with its edits, which inputs are planned, the raw stats Bless
// takes a share of and the race (builder-manual.mts buffInputsOf).
export type BuffInputs = { values: Record<string, number>; planned: Set<string>; stats: Stats | null; race: string | null };
// What one module does for the others, by the module that provides it.
export interface BuilderCommands {
  // builder.mts: the panel, and the build it plans
  renderPanel(): void;
  clearCapDrafts(): void;
  panelBuild(): PlannedBuild;
  buffPlan(name: string, race: string | null | undefined, buffs: RunBuffs | undefined): BuffPlan;
  loadRunBuffs(b: RunBuffs | undefined): void;
  // builder-result.mts: the current suit, the result and the compare view
  renderResult(res: OptimizeResult, current: OptSuit, prof: EffectiveProfile, name: string, meta?: BuildMeta): Promise<void>;
  renderCurrentSuit(name: string): void;
  refreshCurrentSuit(): void;
  resetResultView(): void;
  resultLoadError(e: unknown): void;
  closeCompare(): void;
  openRunCompare(runs: SavedRunLike[], titleOf: (r: SavedRunLike) => string, open: (id: string) => void, onRemove: (id: string) => void): void;
  // builder-manual.mts: Manual, and the buff numbers both modes share
  openInManual(suit: OptSuit, covered: readonly string[], runB: RunBuffs | undefined, label: string): Promise<void>;
  showAutomatic(): void;
  paintCharSelect(): void;
  setManualFor(character: string | null): void;
  renderManual(): void;
  syncManual(): Promise<void>;
  buffEditsOf(name: string | null): Record<string, number>;
  buffInputsOf(name: string | null): BuffInputs;
  editBuffInputs(name: string | null, values: Readonly<Record<string, number | null>>): void;
  applyRunInputs(name: string | null, b: RunBuffs | undefined): void;
  filling(): boolean;
  // runs.mts: the saved runs
  loadRuns(): Promise<void>;
  openRunsDrawer(): void;
}
// Filled by each module as it loads (app.mts imports all four), so every command is there before the page calls one.
export const commands = {} as BuilderCommands;
export function provide(c: Partial<BuilderCommands>): void { Object.assign(commands, c); }
