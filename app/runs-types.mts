// runs-types.mts — a saved suit-builder run and its list summary (app/runs-lib.mts), and the GET /api/runs and /api/runs/<id> responses built from them. Types only, with no imports, so the page's browser build can use them: the server annotates its responses with these and ui/api-types.mts narrows them to what the page reads.

// A setting that works against the build (app/diagnostics.mts): a requirement out of reach, a weight that swamps the rest, swing speed. Each names the change that would fix it; the first action is the suggestion.
export type DiagnosticCode = "floor_unreachable" | "floors_conflict" | "weight_dominates" | "swing_linear" | "swing_next_step" | "weapon_missing_flag" | "no_weapon_with_flag";
export type DiagnosticAction =
  | { kind: "setFloor"; property: string; value: number }   // value in the player's terms, as intent.floors stores it
  | { kind: "makeSoft"; property: string }
  | { kind: "setWeight"; property: string; value: number }
  | { kind: "swingSteps"; on: boolean }
  | { kind: "lockSlot"; slot: string };
export interface Diagnostic {
  code: DiagnosticCode;
  level: "warn" | "info";
  property?: string | undefined;
  message: string;                                  // the sentence, in the page's words
  values?: Record<string, number> | undefined;      // the numbers in the sentence (floor, best, value, ...), for MCP and tests
  actions: DiagnosticAction[];
}

// A suit's swing (app/swing.mts swingOf): its weapon's base speed, its full stamina, its effective SSI (gear and buffs, capped at 60) and the buffs' share of it, the delay between swings, and every step SSI can reach at that stamina, slowest first.
export interface SwingStep { seconds: number; ssi: number }
export interface SwingResult { speed: number; stamina: number; ssi: number; share: number; seconds: number; steps: SwingStep[] }

export interface RunResult {
  proven?: boolean | undefined;
  method?: string | undefined;
  score?: number | undefined;
  currentScore?: number | undefined;
  delta?: number | undefined;
  nodes?: number | undefined;
  diagnostics?: Diagnostic[] | undefined;      // absent on runs saved before SOLVER_VERSION 6: unreachableFloors says what they knew
  swing?: SwingResult | undefined;             // the suit's swing, when it holds a weapon with a known speed and the build has a character
  [key: string]: unknown;
}
// A run's settings snapshot as saved to disk, possibly still in its pre-2026-09-13 shape (see
// app/migrate.mts, the runs steps).
export interface RunSettingsRaw {
  allowOthers?: boolean | undefined;
  allowOthersWorn?: boolean | undefined;
  budgetS?: number | undefined;
  budgetMs?: number | undefined;
  [key: string]: unknown;
}
export interface SavedRun {
  id?: string | undefined;
  key?: string | undefined;
  character?: string | undefined;
  createdAt?: string | undefined;
  label?: string | undefined;
  settings?: RunSettingsRaw | undefined;
  schemaVersion?: number | undefined;
  solverVersion?: number | undefined;           // SOLVER_VERSION when saved; missing on runs saved before it was stamped
  inventoryStamp?: unknown;
  poolSize?: number | null | undefined;
  skipped?: unknown;
  ms?: number | null | undefined;
  budgetMs?: number | null | undefined;
  explored?: unknown;
  result?: RunResult | undefined;
}
export interface RunSummary {
  id: string | undefined;
  character: string | undefined;
  createdAt: string | undefined;
  label: string;
  settings: RunSettingsRaw | Record<string, never>;
  schemaVersion: number;
  inventoryStamp: unknown;
  poolSize: number | null;
  skipped: unknown;
  ms: number | null;
  method: string | null;
  proven: boolean | null;
  score: number | null;
  currentScore: number | null;
  delta: number | null;
  nodes: number | null;
  explored: unknown;
  changes: number | null;                        // how many slots the run's suit changes
  totalsAfter: Record<string, number> | null;    // the suit's item totals, for the drawer's resist and requirement badges
}

// GET /api/runs (the list, newest first).
export interface RunsListBody<S = RunSummary> { ok: boolean; runs: S[] }
// GET /api/runs/<id> answers the whole run; PUT /api/runs/<id> and POST /api/runs answer its summary (R = RunSummary).
export interface RunBody<R = SavedRun> { ok: boolean; run: R }
