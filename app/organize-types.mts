// organize-types.mts — Organize's plan and Auto organize's proposal, and the GET /api/organize/plan and POST /api/organize/propose responses built from them; types only, importing only organize-config.mts's types, so the page's browser build can use them: app/organize.mts and app/organize-strategies.mts re-export them, the routes `satisfies` them, and ui/api-types.mts re-exports them.
//
// map: organize
// owns: `Plan`, `PlanMove`, `PlanTrip`, `PlanWarning`, `WarningKind`, `RuleReport`, `RoomReport`, `Carried`, `EmptyBag`, `Proposal`, `ProposeResult`, `StrategyId`, `Family`, `Candidate`, `GroupReport`, `Layout`, `OrganizePlanApiResponse`, `OrganizeProposeApiResponse`, `OrganizeProposeBody`, `OrganizePreset`, `OrganizeApiResponse`, `OrganizePutApiResponse`, `OrganizePresetsApiResponse`, `OrganizeTripApiResponse`, `MovePlanSummary`, `MovePlanApiResponse`, `MoveBackApiResponse`, `MoveTripApiResponse`, `OrganizeMatchApiResponse`
import type { OrganizeConfig, Origin, RuleMatch } from "./organize-config.mts";

// ---------------------------------------------------------------- the plan (organize.mts planOrganize)
export type WarningKind = "stale-container" | "missing-target" | "missing-label" | "unknown-capacity" | "old-scripts" | "blacklisted" | "no-position" | "not-ground" | "nearly-full";
export interface PlanWarning { kind: WarningKind; serial: number; detail: string }
export interface EmptyBag { serial: number; name: string; container: number }
export interface Carried { serial: number; name: string }
export interface PlanMove { serial: number; name: string; amount: number; from: number | null; to: number; ruleId: string; alsoMatched: string[]; trip: number }
export interface PlanTrip { index: number; site: number; takes: number[]; puts: number[] }
export interface RuleReport { ruleId: string; matched: number; inPlace: number; toMove: number; noRoom: number }
export interface RoomReport { ruleId: string; needSlots: number; freeSlots: number; shortfall: number }
export interface Plan {
  inventoryStamp: string;
  stamp: string;            // the plan's identity; POST /api/organize/trip refuses any other
  sites: { index: number; roots: number[] }[];
  moves: PlanMove[];        // in trip order; from null = carried in the backpack
  trips: PlanTrip[];        // index 1-based; the first trip of each site is the only one the server runs
  rules: RuleReport[];      // one per rule in rule order, then "catch-all" and "empty-bags" when set
  room: RoomReport[];
  crossSite: { ruleId: string; count: number }[];
  warnings: PlanWarning[];
  carried: Carried[];
  unclaimed: number;
  seconds: number;          // about how long the trips take (tripSeconds), whole seconds
  emptyBags: EmptyBag[];   // emptyBagsOf's, less those already in the gather container
}

// ---------------------------------------------------------------- the proposal (organize-strategies.mts proposeOrganize)
export type StrategyId = "simple" | "detailed" | "build";
export type Family = "armour" | "jewelry" | "weapons" | "other-gear" | "gear" | "reagents" | "scrolls" | "maps" | "resources" | "potions" | "runes-books" | "deeds" | "gems" | "tools" | "clothing" | "other";
// A ground chest Auto organize may use: its name as the player knows it (its label, else its engraving or name),
// its house (site), its fill, its label, and whether the player's own setup uses it (a manual label, or a target
// of a manual rule or of the catch-all), which leaves it unticked by default unless an earlier strategy rule fills
// it (the player ticked it last time, and unticking it now would move its items out on a re-run).
export interface Candidate { serial: number; name: string; site: number; fill: { items: number; max: number }; label: { name: string; origin: Origin } | null; mine: boolean; ticked: boolean }
export interface Unusable { serial: number; name: string; reason: string }
// One group of the proposal. needSlots = its items at its home site (one slot each: merges are the plan's to find),
// roomSlots = what its chests take, crossSite = its items at other houses (never moved). A group sharing a chest
// fills its own bag there (targets = [the bag], bagIn = the chest), or, with no bag left for it, the chest itself
// among the other groups' bags (needsBag).
export interface GroupReport { key: string; name: string; family: Family; ruleIds: string[]; items: number; needSlots: number; targets: number[]; bagIn: number | null; needsBag: boolean; roomSlots: number; shortfall: number; addContainers: number; crossSite: number }
// What the full layout (FILL, a bag for each group sharing a chest) needs beyond what the player has: `chests` more
// house chests, and bags: for each shared chest (null: one of the chests to add, by its family's name) how many more
// bags it needs. `spareBags`: empty bags already in the ticked chests that no group was given, to move in first.
// `roomy`: the proposal fills to FILL where filling to the top would have given other chests.
export interface BagGap { chest: number | null; family: string; bags: number }
export interface Layout { chests: number; bags: BagGap[]; spareBags: number; roomy: boolean }
export interface Proposal {
  strategy: StrategyId;
  candidates: Candidate[];
  unusable: Unusable[];
  containers: number[];                         // the ticked chests it used, ascending
  refused: { serial: number; reason: string }[];   // asked for, but not usable
  groups: GroupReport[];                        // in rule order
  unassigned: number;                           // groups that got no chest
  layout: Layout;
  manualRules: number;
  config: OrganizeConfig;                       // the whole setup Accept saves (PUT /api/organize)
  changed: boolean;                             // false when config is the current setup
  plan: { moves: number; trips: number; noRoom: number; crossSite: number; unclaimed: number; seconds: number };   // planOrganize on config
}
// POST /api/organize/propose answers the whole result: 200 with the proposal, or 409 with why there is none.
export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; error: string };

// ---------------------------------------------------------------- requests and responses
// What POST /api/organize/propose reads: the strategy, and the chests it may use (every one it ticks by default when left out).
export interface OrganizeProposeBody { strategy: StrategyId; containers?: number[] | undefined }
// `running`: the trip the server has queued and not heard back about (`picked` = its bridge is running it now).
export interface OrganizeRunningTrip { id: string; index: number; queuedAt: string; picked: boolean }
export interface OrganizePlanApiResponse { ok: boolean; plan: Plan; running: OrganizeRunningTrip | null }
// `stamp`: the saved setup's when the proposal was worked out, which Accept's PUT names as its base (issue #280).
export type OrganizeProposeApiResponse = Extract<ProposeResult, { ok: true }> & { stamp: string };

// ---------------------------------------------------------------- the rest of the Organize and Move to routes
// GET /api/organize/presets: the rule filters the page offers to start from.
export interface OrganizePreset { id: string; name: string; match: RuleMatch }
// stamp: the saved setup's, which PUT takes back as `base`; a setup saved elsewhere since is refused (409, code "stale").
export interface OrganizeApiResponse { ok: boolean; config: OrganizeConfig; problems: string[]; readOnly?: string; stamp: string }
export interface OrganizePutApiResponse { ok: boolean; stamp: string }
export interface OrganizePresetsApiResponse { ok: boolean; presets: readonly OrganizePreset[] }
export interface OrganizeTripApiResponse { ok: boolean; id: string; index: number }
// Move to (issue #270, app/move.mts). POST /api/move/plan: the selection's count, its worn items, how many of it sit directly in
// each container, and with `to` the plan into that container (or why it cannot be filled); with `back`, Move back's count.
export interface MovePlanSummary { moving: number; serials: number[]; trips: number; already: number; noRoom: number; left: Partial<Record<"gone" | "worn" | "pack" | "bag" | "unreachable" | "site", number>>; against: Array<{ serial: number; name: string; target: number }> }
export interface MovePlanApiResponse { ok: boolean; selected: number; worn: number; wornNames: string[]; movable: number; here: Record<string, number>; left: MovePlanSummary["left"]; problem?: string | null; plan?: MovePlanSummary | null }
export interface MoveBackApiResponse { ok: boolean; back: { movable: number; skipped: string[] } }
// POST /api/move/trip: the trip queued (`id` null when nothing is left to move), its items' names, the moves left counting it.
export interface MoveTripApiResponse { ok: boolean; id: string | null; index?: number; names?: Record<string, string>; remaining: number; skipped: Array<{ serial: number; name: string }>; noRoom: Array<{ serial: number; name: string }> }
// POST /api/organize/match: what one rule filter takes of the movable items in labelled roots (app/organize.mts's matchCount).
export interface OrganizeMatchApiResponse { ok: boolean; count: number; pieces: number; sample: string[] }
