// organize-types.mts — Organize's plan (app/organize.mts) and Auto organize's proposal (app/organize-strategies.mts), and the GET /api/organize/plan and POST /api/organize/propose responses built from them. Types only, importing only organize-config.mts's types, so the page's browser build can use them: the server annotates its responses with these and ui/api-types.mts re-exports them.
import type { OrganizeConfig, Origin } from "./organize-config.mts";

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

// ---------------------------------------------------------------- responses
// `running`: the trip the server has queued and not heard back about (`picked` = its bridge is running it now).
export interface OrganizeRunningTrip { id: string; index: number; queuedAt: string; picked: boolean }
export interface OrganizePlanApiResponse { ok: boolean; plan: Plan; running: OrganizeRunningTrip | null }
export type OrganizeProposeApiResponse = Extract<ProposeResult, { ok: true }>;
