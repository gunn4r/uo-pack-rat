// vault-lib.mts — Pack Rat's shared kernel, page and server alike: the inventory types, tooltip parsing, slot classification, snapshot folding (a scan replaces everything under each root it lists),
// optimizer pool building and requirement reports. Used by index.html (browser, via the
// server) and gear-vault.test.mts (Node). No dependencies, no DOM.
//
// Shard rules (property caps, the Resisting Spells resist minimum, race cap overrides, tag-
// penalty units, the rarity ladder, the gargoyle race-lock policy) live in app/rules/<shard>.json,
// loaded (Node-only, by app/rules.mts) and handed in here with setRules() — this module never reads
// a rules file itself, so it stays usable in the browser. getRules() throws until setRules() has run:
// a forgotten call must be loud, not a silent wrong answer.
//
// The kernel is being split by concept into app/domain/ (issue #338): what has moved there is re-exported here under the
// same names, so every importer keeps importing from this file.
//
// map: scan
// owns: `Item`, `Container`, `Character`, `Inventory`, `ScanSummary`, `foldSnapshots`, `locationOf`, `containerPath`, `capacityOf`, `TRASH_RE`, `groupByName`
import { delayText } from "./swing.mts";
import { RESIST_SKILL_KEY, RESIST_STEP_SLACK, floorMet, heldTotal, liftedMin, type ResistStep } from "./solver/scoring.mts";
import { isPseudoCharacter, NOBODY, parseStamp, V1_ADAPTER_VERSION } from "./scan-schema.mts";
export { isPseudoCharacter, NOBODY };
import type { RulesV1, ScanV2, ScanV2Adapter } from "./schema/types.d.mts";
import { getRules } from "./domain/rules.mts";
export { setRules, getRules } from "./domain/rules.mts";
import { type PropMap, type ExtrasMap, PROP_LABELS, NOT_BUILDER_KEYS, weightOfImportance, importanceText, SKILL_SET, labelOf, propName, RESIST_KEYS } from "./domain/properties.mts";
export { type ExtraValue, type PropMap, type ExtrasMap, PROPERTIES, type PropKey, PROP_PATTERNS, PROP_LABELS, NOT_BUILDER_KEYS, PROP_FULL, typicalRange, IMPORTANCE_K, importanceOf, weightOfImportance, roundImportance, withCurrentActions, SKILL_NAMES, labelOf, fullOf, propName, goalWord, type ResistMeta, RESIST_META, RESIST_KEYS } from "./domain/properties.mts";
import { stripHtml, parseTooltip, displayName } from "./domain/tooltip.mts";
export { type ParsedTooltip, tagUnits, tagInfo, stackName, parseTooltip, compareNames, shownName, gameName, displayName } from "./domain/tooltip.mts";
import { SPELLBOOK_RE, GEAR_SLOTS, REQUIRED_SLOTS, HAND_SLOTS, SLOT_LABELS, classify } from "./domain/slots.mts";
export { type ClassifyResult, LAYER_TO_SLOT, LAYER_ALIASES, GEAR_SLOTS, type SlotGroup, GEAR_SLOT_GROUPS, SLOT_GROUP, SLOTS_IN_GROUP, NECK_ARMOR_WORDS, isNeckArmor, REQUIRED_SLOTS, SLOT_LABELS, type SpellSchool, spellSchoolOf, layerOfGraphic, classify } from "./domain/slots.mts";
import { kindOf, type KindOverrides, NO_KIND_OVERRIDES, overriddenKind, slayersOf, medableOf } from "./domain/kinds.mts";
export { KINDS, INSTRUMENTS, kindOf, type KindOverrides, OVERRIDE_KINDS, NO_KIND_OVERRIDES, kindNameKey, kindGraphicKey, ownKind, overriddenKind, slayersOf, medableOf } from "./domain/kinds.mts";

// ---------------------------------------------------------------------------
// Shared shapes. Declared once here — the inventory/item types every later task (the server, the
// page's modules) imports.
// ---------------------------------------------------------------------------

// The location a folded item currently reports, computed by locationOf() once the whole fold is
// done (every item needs every container to be folded first, since a path can cross several).
export interface ItemLocation {
  kind: string | null | undefined;
  character: string;
  text: string;
  root: number | null;
  rootName?: string | undefined;
}

// The enriched item shape every fold entry becomes (enrich()'s return, plus `location`, set in a
// second pass by foldSnapshots once the whole container tree is known — see the comment there).
export interface Item {
  serial: number;
  name: string;
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  amount: number;
  props: PropMap;
  setBonus: PropMap;
  extras: ExtrasMap;
  flags: string[];
  tags: string[];
  strReq: number;
  rarity: string | null;
  weight: number | null;
  skillReq: string | null;
  lines: string[];
  gargoyle: boolean;
  slayers: string[];
  medable: boolean;
  slot: string | null;
  twoHanded: boolean;
  gear: boolean;
  kind: string;
  root: number | null;
  container: number | null;
  equippedBy: string | null;
  layer: string | null;
  seenAt: string;
  scannedBy: string;
  location?: ItemLocation | undefined;
}

// A folded container entry: a raw scan container plus the two stamps every fold adds.
export interface Container {
  serial: number;
  kind?: string | null | undefined;
  name?: string | undefined;
  parent?: number | null | undefined;
  root: number;
  tooltip?: string[] | undefined;
  pos?: Record<string, number> | null | undefined;
  // Its fill from the tooltip's Contents line (capacityOf), or null when the tooltip has none. Set by every fold.
  capacity?: ContainerCapacity | null | undefined;
  // false when the newest scan saw this bag but could not open it: what the fold keeps under it is from an
  // older scan (see foldSnapshots). Organize never moves anything out of one.
  opened?: boolean | undefined;
  // Its item graphic and hue (issue #174), for its art; absent from scans made before the adapters recorded them.
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  // The container's segment in location text: its bagLabel, plus a distinguishing suffix when another
  // container with the same label sits beside it (labelContainers). Set by every fold.
  label?: string | undefined;
  scannedBy: string;
  scannedAt: string;
}

// A container's fill as its tooltip states it. `stones` is null when the line gives no weight, `maxStones`
// when the container has no weight cap (house containers have none).
export interface ContainerCapacity { items: number; maxItems: number; stones: number | null; maxStones: number | null }

export interface Character {
  name: string;
  stats: Record<string, unknown>;
  scannedAt: string;
  position: Record<string, unknown> | null;
  maxes: Record<string, unknown> | null;
  resists: Record<string, unknown> | null;
  skills: Record<string, unknown>;
  adapter: ScanV2Adapter | null;
}

export interface ScanSummary {
  character: string;
  scannedAt: string;
  items: number;
  roots: number[];
}

export interface Inventory {
  characters: Record<string, Character>;
  containers: Record<string, Container>;
  items: Record<string, Item>;
  scans: ScanSummary[];
}
// The containers a bridge command opens to reach something inside `container`: its root first, then each bag down to
// `container` itself (at most 8, the bridge protocol's chain limit). The Highlight / Grab / Go to buttons and the MCP
// tools both send it.
export function containerChain(containers: Record<string, Container>, container: number | null): number[] {
  const chain: number[] = []; let cur = container != null ? containers[container] : null, guard = 0;
  while (cur && guard++ < 8) { chain.unshift(+cur.serial); cur = cur.parent != null ? containers[cur.parent] : null; }
  return chain;
}
// "scan" starts one of the client's scan scripts (issue #281): the MCP scan tool sends it, and no button does.
export type BridgeAction = "highlight" | "grab" | "goto" | "scan";
export const BRIDGE_ACTION_LABELS: Record<BridgeAction, string> = { highlight: "Highlight", grab: "Grab", goto: "Go to", scan: "Scan" };
export const BRIDGE_OFFLINE = "Bridge offline. Press Play on packrat-bridge.py in game.";

// What a bridge can do, as one set of feature names: the actions it runs ("highlight", "grab", "goto", "trip", "scan") and what
// it does besides ("trip-bags"). The page, Organize and the MCP tools all ask bridgeFeatures, which answers from the
// running bridge's own report first (status.json's adapter, while it is online), then the newest scan made with that
// adapter, then the manifest this app ships (docs/bridge-protocol.md, Features).
// A manifest (capabilities.json) or a scan's adapter block: its bridge actions and its features. Scripts before TazUO
// 2.16.0 listed "trip-bags" among the actions, so a name counts from either list (compat: trip-bags-action, remove in
// Pack Rat 0.3.0 (docs/architecture.md, Compatibility shims)).
export interface FeatureDeclaration { capabilities?: { bridge?: readonly string[] | undefined } | undefined; features?: readonly string[] | undefined }
export type FeatureSource = "bridge" | "scan" | "app";
const featureNames = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
// The adapter block of the newest scan made with adapter `id`, or null when no character was scanned with it. A v1
// scan's block is left out: upgradeScan made it up, so it says nothing about the installed scripts.
export function newestScanAdapter<A extends FeatureDeclaration & { id: string; version: string }>(characters: Record<string, { scannedAt: string; adapter: A | null }> | null | undefined, id: string | null | undefined): A | null {
  let best: { at: number; adapter: A } | null = null;
  for (const c of Object.values(characters ?? {})) {
    if (!c.adapter || c.adapter.id !== id || c.adapter.version === V1_ADAPTER_VERSION) continue;
    const at = parseStamp(c.scannedAt);
    if (!best || at > best.at) best = { at, adapter: c.adapter };
  }
  return best?.adapter ?? null;
}
// The feature names and where they came from (null: nothing to go on, so the bridge can do nothing). `running` is the
// online bridge's report (every action and feature in one list), or null when it is offline or too old to report itself.
export function bridgeFeatures(from: { running?: { features?: unknown } | null | undefined; scan?: FeatureDeclaration | null | undefined; manifest?: FeatureDeclaration | null | undefined }): { features: Set<string>; source: FeatureSource | null } {
  if (from.running && Array.isArray(from.running.features)) return { features: new Set(featureNames(from.running.features)), source: "bridge" };
  if (from.scan) return { features: new Set([...featureNames(from.scan.capabilities?.bridge), ...featureNames(from.scan.features)]), source: "scan" };
  if (from.manifest) return { features: new Set([...featureNames(from.manifest.capabilities?.bridge), ...featureNames(from.manifest.features)]), source: "app" };
  return { features: new Set(), source: null };
}
// What the refusal below knows of the bridge: the client it routes to (null: none set up), what it can do
// (bridgeFeatures), whether its heartbeat is fresh, and whether the target's root has a scanned position (Go to walks there).
export interface BridgeGate { adapter: { id: string; name?: string | undefined } | null; features: ReadonlySet<string>; online: boolean; hasPos: boolean }
// Why one bridge action cannot run on one target right now, in words, or null when it can: the page's disabled
// buttons (ui/bridge.mts) and the MCP tools refuse with the same sentence.
export function bridgeRefusal(action: BridgeAction, it: { equippedBy?: string | null | undefined }, gate: BridgeGate): string | null {
  if (it.equippedBy) return `${it.equippedBy} is wearing it.`;
  const a = gate.adapter;
  if (!a) return "No game client is set up. Choose one in Settings.";
  if (!gate.features.has(action)) return `${a.name || a.id} can't ${BRIDGE_ACTION_LABELS[action]} from Pack Rat.`;
  if (action === "goto" && !gate.hasPos) return "Go to needs a container on the ground whose position was scanned.";
  if (!gate.online) return BRIDGE_OFFLINE;
  return null;
}

// What propertyKeys()/gearSkills() actually read — just `.items`, either the fold's Record form or
// the plain array item-query.mts's facetsOf() passes ({items} over an already-filtered Item[]).
export interface ItemsLike {
  items: Record<string, Item> | Item[];
}

// Goals (issue #292): the properties to get as high as the gear allows, up to each one's cap, most important first, a rank
// holding two or more that count the same; what spare points go to; and for a Swing speed goal, the fastest swing or a
// swing every `seconds` (the SSI that takes with the weapon worn now caps SSI, app/build-spec.mts planBuild). `ownWeights`:
// the weights were edited by hand since the goals set them, so the goals are kept only to start from again. Goals compile
// to the profile's weights through the importance conversion above (compileGoals), so the solvers, saved runs and every
// reader that knows only weights are unchanged.
export const GOAL_LEFTOVERS = ["luck", "melee", "caster", "none"] as const;
export type GoalLeftover = (typeof GOAL_LEFTOVERS)[number];
export const SWING_GOALS = ["fastest", "every"] as const;
export interface GoalSwing { mode: (typeof SWING_GOALS)[number]; seconds?: number | undefined }
// strategy: "value" (absent means it too) can trade a small loss up top for a big gain lower down, through the compiled
// weights; "strict" never gives up a higher goal for a lower one (a staged solve, opts.strict). fewestChanges: among
// suits as good, the fewest slots changed from what is worn now (the tie-break's first part).
export const GOAL_STRATEGIES = ["value", "strict"] as const;
// What each strategy means, in the Goals tab, How the goals went and build_suit's description.
export const STRICT_PROMISE = "A higher goal is never given up for a lower one.";
export const STRATEGY_HELP: Record<(typeof GOAL_STRATEGIES)[number], string> = { value: "Higher goals count more, but a small loss up top can buy a big gain lower down.", strict: `${STRICT_PROMISE} Requirements come before every goal.` };
// What Change as few pieces as possible does in each strategy: Best value breaks exact ties, Strict order solves it after the goals.
// Under How the goals went when a strict suit wears a tagged piece the worn suit doesn't.
export const TAGGED_NOTE = "Strict order takes tagged pieces (Cursed, Antique…) when they help a goal. To keep them out, use Exclude tags in the Pool tab.";
export const FEWEST_HELP: Record<(typeof GOAL_STRATEGIES)[number], string> = { value: "Finally, among equally good suits, keep the most of what you wear.", strict: "After the goals, keep the most of what you wear, before tagged pieces and spare points." };
export interface Goals { ranks: string[][]; swing?: GoalSwing | undefined; leftover: GoalLeftover; strategy?: (typeof GOAL_STRATEGIES)[number] | undefined; fewestChanges?: boolean | undefined; ownWeights?: boolean | undefined }
// What a rank counts on the importance scale: the first 100, the second 80, and so on, 15 for every rank from the ninth.
export const RANK_IMPORTANCE: readonly number[] = [100, 80, 65, 50, 40, 30, 25, 20, 15];
export const rankImportance = (rank: number): number => RANK_IMPORTANCE[Math.min(rank, RANK_IMPORTANCE.length - 1)]!;
// Spare points get a low importance, so their group only takes what the goals leave.
export const LEFTOVER_IMPORTANCE = 5;
export const LEFTOVER_GROUPS: Record<GoalLeftover, readonly string[]> = { luck: ["luck"], melee: ["strBonus", "dexBonus", "stamInc", "hpRegen"], caster: ["intBonus", "manaInc", "manaRegen", "lmc", "lrc"], none: [] };
export const LEFTOVER_LABELS: Record<GoalLeftover, string> = { luck: "Luck", melee: "Melee stats", caster: "Caster stats", none: "Nothing" };
// Whether goals set the profile's weights: there are goals, and the weights were not edited by hand since.
export const goalsActive = (g: Goals | null | undefined): g is Goals => !!g && !g.ownWeights;
// The weights goals set, and whether SSI is scored by swing step (when Swing speed is a goal): each rank's properties at
// that rank's importance, then the spare-points group's properties that are not goals at LEFTOVER_IMPORTANCE. A weight the
// builder never offers (the tag penalty) is kept from `kept`, the profile's weights. A weight is rounded to 12 significant
// digits, so DI's 65 is 2.925 per point rather than 2.9250000000000003.
export function compileGoals(g: Goals, kept: Readonly<Record<string, number>> = {}): { weights: Record<string, number>; swingSteps: boolean } {
  const weights: Record<string, number> = Object.fromEntries(Object.entries(kept).filter(([k]) => NOT_BUILDER_KEYS.has(k)));
  const per = (k: string, importance: number): number => Number(weightOfImportance(k, importance).toPrecision(12));
  g.ranks.forEach((rank, i) => { for (const k of rank) weights[k] = per(k, rankImportance(i)); });
  const goal = new Set(g.ranks.flat());
  for (const k of LEFTOVER_GROUPS[g.leftover]) if (!goal.has(k)) weights[k] = per(k, LEFTOVER_IMPORTANCE);
  return { weights, swingSteps: goal.has("ssi") };
}
// Goals in a line, for a settings diff: "Swing speed every 1.5 s › Hit chance = Defense chance › Damage, spare points to luck".
export function goalsText(g: Goals): string {
  return `${g.ranks.map((r) => r.map((k) => goalLabel(g, k)).join(" = ")).join(" › ") || "no goals"}, spare points to ${LEFTOVER_LABELS[g.leftover].toLowerCase()}${g.strategy === "strict" ? ", strict order" : ""}${g.fewestChanges ? ", fewest changes" : ""}`;
}
// The most ranks goals hold, and the most properties one rank holds (the Goals tab stops at both).
export const GOAL_RANKS_MAX = 40, GOAL_RANK_SIZE_MAX = 10;
// A property a goal can name: one the builder offers, or a skill bonus ("sk:magery").
export const isGoalProperty = (k: string): boolean => (Object.hasOwn(PROP_LABELS, k) && !NOT_BUILDER_KEYS.has(k)) || (k.startsWith("sk:") && SKILL_SET.has(k.slice(3)));
// The check goals are held to wherever they are stored or sent (a profile's spec, a run's settings, build_suit): only
// these fields; ranks a list of at most GOAL_RANKS_MAX lists of at most GOAL_RANK_SIZE_MAX known properties
// (isGoalProperty), none named twice; a swing time from 1.25 to 10 s in quarter seconds. `label` names the field in the
// reason; null when fine.
export function goalsError(v: unknown, label: string): string | null {
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (!obj(v)) return `${label} must be an object`;
  const extra = Object.keys(v).find((k) => !["ranks", "swing", "leftover", "strategy", "fewestChanges", "ownWeights"].includes(k));
  if (extra) return `${label}.${extra.slice(0, 64)} is not a goals setting`;
  if (!Array.isArray(v.ranks) || v.ranks.length > GOAL_RANKS_MAX || !v.ranks.every((r) => Array.isArray(r) && r.length > 0 && r.length <= GOAL_RANK_SIZE_MAX && r.every((k) => typeof k === "string")))
    return `${label}.ranks must be a list of at most ${GOAL_RANKS_MAX} ranks, each a list of 1 to ${GOAL_RANK_SIZE_MAX} property names`;
  const keys = (v.ranks as string[][]).flat(), unknown = keys.find((k) => !isGoalProperty(k));
  if (unknown != null) return `${label}.ranks names ${JSON.stringify(unknown.slice(0, 64))}, which is not a property the Suit Builder offers (property keys such as "ssi", "hci", "luck" or "sk:magery")`;
  if (new Set(keys).size !== keys.length) return `${label}.ranks names a property twice`;
  if (!(GOAL_LEFTOVERS as readonly unknown[]).includes(v.leftover)) return `${label}.leftover must be one of ${GOAL_LEFTOVERS.join(", ")}`;
  if (v.strategy != null && !(GOAL_STRATEGIES as readonly unknown[]).includes(v.strategy)) return `${label}.strategy must be one of ${GOAL_STRATEGIES.join(", ")}`;
  if (v.fewestChanges != null && typeof v.fewestChanges !== "boolean") return `${label}.fewestChanges must be a boolean`;
  if (v.ownWeights != null && typeof v.ownWeights !== "boolean") return `${label}.ownWeights must be a boolean`;
  if (v.swing != null) {
    const s = v.swing;
    if (!obj(s) || Object.keys(s).some((k) => k !== "mode" && k !== "seconds") || !(SWING_GOALS as readonly unknown[]).includes(s.mode)) return `${label}.swing must be { mode: ${SWING_GOALS.join(" or ")}, seconds? }`;
    if (s.seconds != null && !(typeof s.seconds === "number" && s.seconds >= 1.25 && s.seconds <= 10 && Number.isInteger(s.seconds * 4))) return `${label}.swing.seconds must be a swing time from 1.25 to 10 s, in quarter seconds`;
    if (s.mode === "every" && s.seconds == null) return `${label}.swing.seconds is needed for a swing every so many seconds`;
  }
  return null;
}

// A goal as a list names it: Swing speed with its swing time when it has one ("Swing speed every 1.5 s").
export const goalLabel = (g: Goals, k: string): string => (k === "ssi" && g.swing?.mode === "every" && g.swing.seconds != null ? `${propName(k)} every ${delayText(g.swing.seconds)}` : propName(k));

// The Resisting Spells minimum at one skill value: no resist falls below it, and it does not add to gear (ServUO
// PlayerMobile.GetMinResistance, the shard's rules `resistMinimum`). With fixed = the skill × 10: 40 + (fixed − 1000) / 50
// from 1000, (fixed − 400) / 15 from 400, integer division, so 55 → 10, 100 → 40, 120 → 44. Null below 40 skill, or on a
// shard whose rules give no minimum: nothing holds a resist up then, not even at 0.
export function minResistAt(value: number): number | null {
  if (!getRules().resistMinimum) return null;
  const fixed = Math.floor(value * 10 + 1e-6);
  if (fixed >= 1000) return 40 + Math.floor((fixed - 1000) / 50);
  return fixed >= 400 ? Math.floor((fixed - 400) / 15) : null;
}
// The property an item's Resisting Spells skill bonus is read into ("Resisting Spells +10" on a bracelet): RESIST_SKILL_KEY,
// from app/solver/scoring.mts, re-exported here with RESIST_STEP_SLACK for the modules that read them from the kernel.
export { RESIST_SKILL_KEY, RESIST_STEP_SLACK };
// A character's own Resisting Spells, without what its worn suit adds: the scan's base (its value when the scan has no
// base), null when the scan has no such skill. A suit's own bonus (RESIST_SKILL_KEY) goes on top of it, so a minimum
// is never taken from pieces the suit may not keep.
export function resistSkillOf(skills: Record<string, unknown> | null | undefined): number | null {
  // skills is Record<string, unknown> (the scan schema leaves per-skill shape loose); every skill
  // entry this repo ever reads or writes is {base, value, cap} (see the CLAUDE.md note on
  // player.getSkill), so this narrows once at the read instead of scattering `as` down the line.
  const e = skills?.["Resisting Spells"] as { base?: number; value?: number } | undefined;
  if (!e) return null;
  return typeof e.base === "number" && Number.isFinite(e.base) ? e.base : Number(e.value) || 0;
}
// A character's Resisting Spells cap as scanned, null when the scan has none (skillInSuit then takes SKILL_CAP_TOP).
export function resistSkillCapOf(skills: Record<string, unknown> | null | undefined): number | null {
  const cap = (skills?.["Resisting Spells"] as { cap?: number } | undefined)?.cap;
  return typeof cap === "number" && Number.isFinite(cap) ? cap : null;
}
// The highest cap a skill takes (a 120 power scroll): the cap of a skill whose scan has none.
export const SKILL_CAP_TOP = 120;
// A character's own skill with a suit's item bonus to it and the skill's cap (null: SKILL_CAP_TOP), as skillInSuit takes them.
export interface SuitSkill { skill: number; bonus: number; cap: number | null }
// A skill in a suit, as ServUO's Skill.Value works it out: a loss that ignores the cap (Protection's) comes off the
// skill first, then the suit's item bonus, which stops at the skill's cap and adds nothing to a skill already there.
export function skillInSuit(skill: number, bonus: number, cap: number | null, loss = 0): number {
  const v = skill + loss, top = cap ?? SKILL_CAP_TOP;
  return v >= top ? v : Math.min(v + bonus, top);
}
// A character's Resisting Spells minimum in a suit carrying `bonus` Resisting Spells (0: the character's own).
export function resistMinimum(skills: Record<string, unknown> | null | undefined, bonus = 0): number | null {
  const skill = resistSkillOf(skills);
  return skill == null ? null : minResistAt(skillInSuit(skill, bonus, resistSkillCapOf(skills)));
}
// One step of the Resisting Spells minimum a suit's own bonus lifts (EffectiveProfile.resistSteps), and the minimum a
// resist is held at given the steps: app/solver/scoring.mts, re-exported here.
export { liftedMin, type ResistStep };
// RESIST_STEP_SLACK, half a tenth of a point: a suit reaches a step when its bonus total is at least `at` less this. Bonuses
// come in tenths at the finest, so the margin changes nothing for a real total and lets the MIP tell "under" from "at" with
// room to spare.
// Every step the minimum takes as a suit's Resisting Spells bonus rises from 0, a tenth at a time, until the skill
// reaches its cap: `skill` the character's own, `cap` its cap (null: SKILL_CAP_TOP), `loss` what the planned buffs take
// off it (Protection's), `share` a resist's in-cap share from the buffs. Empty when no bonus can change the minimum.
export function resistStepsFor(skill: number, cap: number | null, loss: number, share: (k: string) => number): ResistStep[] {
  const out: ResistStep[] = [], top = cap ?? SKILL_CAP_TOP;
  let last = minResistAt(skillInSuit(skill, 0, cap, loss));
  for (let tenths = 1; skillInSuit(skill, (tenths - 1) / 10, cap, loss) < top; tenths++) {
    const at = tenths / 10, m = minResistAt(skillInSuit(skill, at, cap, loss));
    if (m == null || m === last) continue;
    out.push({ at, mins: Object.fromEntries(RESIST_KEYS.map((k) => [k, m - share(k)])) });
    last = m;
  }
  return out;
}
// What a rules file written before issue #261 must change, or null: it still carries the old additive
// `resistSkillBonus`, which nothing reads, and no `resistMinimum`, so its characters get no minimum at all.
export function rulesUpgradeNote(rules: RulesV1): string | null {
  const r = rules as RulesV1 & { resistSkillBonus?: unknown };
  return r.resistSkillBonus != null && r.resistMinimum == null
    ? `The "${rules.name}" rules file still has "resistSkillBonus", which Pack Rat no longer reads: Resisting Spells is a minimum under each resist now. Add "resistMinimum": { "kind": "servuo" } to it, or each resist goes without a minimum.`
    : null;
}
// A paperdoll resist: the total held to its cap, and never below the Resisting Spells minimum (null: none).
export const paperdollResist = (total: number, cap: number, min: number | null | undefined): number => Math.max(Math.min(total, cap), min ?? -Infinity);

// A resist's paperdoll cap on this shard for a race (an Elf's Energy is 75 on uoalive), else the shard's cap.
export function shardResistCap(k: string, race: string | null | undefined): number {
  const rules = getRules();
  return (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race as string]?.[k] ?? (rules.caps as Record<string, number>)[k] ?? 70;
}
// The range a player's resist cap override may take (the Builder's Resist caps fields, a profile's or template's
// resistCaps, a saved run's settings.resistCaps): whole paperdoll numbers.
export const RESIST_CAP_LIMITS = { min: 0, max: 150 } as const;
// A resist's cap for one build, in paperdoll terms: `cap` is what the build values the resist up to, `shard` what
// the shard's rules give this race. They differ only where the player overrode the cap. For a form or spell that
// lowers a resist (Reaper Form takes 25 Fire), turn the buff on in the Buffs section rather than raising the cap: the
// plan then counts the loss itself, and ignores an override above the shard's cap while it does (app/buffs.mts).
export interface ResistCap { cap: number; shard: number }
export function resistCapsFor(race: string | null | undefined, overrides: Record<string, number> | null | undefined): Record<string, ResistCap> {
  return Object.fromEntries(RESIST_KEYS.map((k) => {
    const shard = shardResistCap(k, race), o = overrides?.[k];
    return [k, { cap: typeof o === "number" && Number.isFinite(o) ? o : shard, shard }];
  }));
}
// What a resistCaps value is wrong about, or null when it is fine: an object naming only the five resists, each a
// whole number within RESIST_CAP_LIMITS. The server checks a build's settings with this; PATCH /api/profiles checks
// profiles.json's with the same rule, written as JSON Schema in profiles.v3.schema.json.
export function resistCapsError(v: unknown, path = "resistCaps"): string | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return `${path} must be an object`;
  for (const [k, n] of Object.entries(v)) {
    if (!RESIST_KEYS.includes(k)) return `${path}.${k} is not a resist`;
    if (typeof n !== "number" || !Number.isInteger(n) || n < RESIST_CAP_LIMITS.min || n > RESIST_CAP_LIMITS.max) return `${path}.${k} must be a whole number from ${RESIST_CAP_LIMITS.min} to ${RESIST_CAP_LIMITS.max}`;
  }
  return null;
}

// Faster Casting's cap follows the casting school (issue #213): the shard's `fc` cap (2) for Magery, Necromancy and
// Mysticism, 4 for Chivalry, Spellweaving and Bushido, and a Chivalry caster drops to the shard's cap once Magery or
// Mysticism reaches 70. A profile may name its school (`castingSchool`); else it follows the character's skills: 4 when
// it has Chivalry, Spellweaving or Bushido at 30 base or more (starting points and stray gains stay under it, any build
// that casts from the school trains past it), unless that school is Chivalry and Magery or Mysticism is at 70 (ServUO
// Spell.GetCastDelay drops only Chivalry's cap), else the shard's cap. No character and no school: the shard's cap. `reason` is what the panel shows beside the cap ("Chivalry", "Chivalry (chosen)" for a named school, "Magery 70+").
export const CASTING_SCHOOLS: readonly string[] = ["Magery", "Necromancy", "Mysticism", "Chivalry", "Spellweaving", "Bushido"];
// A build's rarity preference (issue #262): among equally good suits, use the highest- or lowest-rarity pieces. Absent means any.
export type RarityPreference = "higher" | "lower";
export const RARITY_PREFERENCES: readonly RarityPreference[] = ["higher", "lower"];
const FC_FAST_SCHOOLS = ["Chivalry", "Spellweaving", "Bushido"], FC_FAST_CAP = 4, FC_SCHOOL_MIN = 30;
const FC_SLOW_SKILLS = ["Magery", "Mysticism"], FC_SLOW_AT = 70;
export interface FcCap { cap: number; reason: string }
export function fcCapFor(skills: Record<string, unknown> | null | undefined, school?: string | null | undefined): FcCap {
  const low = (getRules().caps as Record<string, number>).fc ?? 2;
  const sk = (n: string, f: "base" | "value"): number => Number((skills?.[n] as { base?: unknown; value?: unknown } | undefined)?.[f]) || 0;
  const slow = FC_SLOW_SKILLS.filter((n) => sk(n, "value") >= FC_SLOW_AT).sort((a, b) => sk(b, "value") - sk(a, "value"))[0];
  const named = school && CASTING_SCHOOLS.includes(school) ? school : null;
  if (named) {
    const chosen = `${named} (chosen)`;
    if (!FC_FAST_SCHOOLS.includes(named)) return { cap: low, reason: chosen };
    return named === "Chivalry" && slow ? { cap: low, reason: `${slow} ${FC_SLOW_AT}+` } : { cap: FC_FAST_CAP, reason: chosen };
  }
  if (!skills) return { cap: low, reason: "no character" };
  const fast = FC_FAST_SCHOOLS.filter((n) => sk(n, "base") >= FC_SCHOOL_MIN).sort((a, b) => sk(b, "base") - sk(a, "base"))[0];
  if (!fast) return { cap: low, reason: "no Chivalry, Spellweaving or Bushido" };
  return fast === "Chivalry" && slow ? { cap: low, reason: `${slow} ${FC_SLOW_AT}+` } : { cap: FC_FAST_CAP, reason: fast };
}
// The `fc` entry effectiveProfile puts over the shard's caps: none when the shard caps no Faster Casting.
const fcCaps = (character: Character | null, school: string | undefined): Record<string, number> =>
  (getRules().caps as Record<string, number>).fc == null ? {} : { fc: fcCapFor(character?.skills ?? null, school).cap };

// The optimizer's profile for one character, as given (weights/floors are what the caller chose; caps are not
// resolved yet — effectiveProfile() below is what turns this into caps a search can use).
export interface Profile {
  caps?: Record<string, number> | undefined;
  floors?: Record<string, number> | undefined;
  softFloors?: string[] | undefined;
  weights?: Record<string, number> | undefined;
  floorBonus?: number | undefined;
  race?: string | null | undefined;
  resistCaps?: Record<string, number> | undefined;
  swingSteps?: boolean | undefined;   // score SSI by swing step (app/swing.mts)
  castingSchool?: string | undefined; // the school the Faster Casting cap follows (fcCapFor); absent means from the character's skills
}
export interface EffectiveProfile {
  weights: Record<string, number>;
  caps: Record<string, number>;
  floors: Record<string, number>;
  floorBonus: number;
  hardFloors: string[];
  // The character's own Resisting Spells (resistSkillOf: no item bonus; null with no character or no such skill), and
  // its minimum before any buff, in paperdoll terms (null: none).
  resistSkill: number | null;
  resistMinimum: number | null;
  // What the solvers hold each resist up to, in item terms: the minimum the planned buffs leave (Protection lowers the
  // skill), less each resist's in-cap share. A resist scores max(min, min(total, cap)), and a floor at or under its
  // min is met by any suit. Absent with no minimum.
  mins?: Record<string, number> | undefined;
  // Only the resists whose cap the player overrode, in paperdoll terms; absent when none is, so a profile with no
  // override keeps the exact shape (and so the run key, runs-lib.mts) it had before overrides existed.
  resistCapOverrides?: Record<string, ResistCap> | undefined;
  // The buffs the search planned with (app/buffs.mts plannedProfile), absent with none: which, the numbers they took
  // (so a result can show them, and runs with other buffs key apart), and the caps and floors before them.
  buffs?: PlannedBuffs | undefined;
  // What the build knows of the character's swing (app/build-spec.mts planBuild), absent with no character: stamina before gear (raw DEX and the buffs' shares), the worn suit's stamina, and whether SSI is scored by step.
  // `goalSsi`: a Swing speed goal's SSI cap in item terms (issue #302), absent without one; the step table credits no point more.
  swing?: { stamBase: number; refStamina: number; steps: boolean; goalSsi?: number | undefined } | undefined;
  // The step table both solvers score SSI with (app/swing.mts stepTable), put on by the optimize worker.
  ssiSteps?: Array<{ ssi: number; stam: number; credit: number }> | undefined;
  // The higher minimums a suit's own Resisting Spells bonus brings (resistStepsFor), lowest first, in item terms like
  // `mins`; absent when no bonus can raise it (no minimum on this shard, no such skill, the skill at its cap). The
  // server keeps only the steps the pool's bonus reaches (app/mip.mts withReachableResistSteps), so a pool without
  // such pieces builds and keys as before them.
  resistSteps?: ResistStep[] | undefined;
}
export interface PlannedBuffs {
  on: string[];
  skills: Record<string, number>;
  stats: { str: number; dex: number; int: number } | null;
  who: { race?: string | null | undefined; weaponFlags?: readonly string[] | undefined };
  caps: Record<string, number>;
  floors: Record<string, number>;
  overridesIgnored?: Record<string, number> | undefined;   // resist overrides set aside: the buffs count that resist's loss
  minimum: number | null;   // the Resisting Spells minimum with these buffs (Protection lowers it), what the solvers held each resist at
}
// What the buffs that are on change, in paperdoll terms: the caps once they changed them, and each key's in-cap share.
// `minimum` is the Resisting Spells minimum with the buffs on (Protection lowers the skill), when the plan worked it out,
// and `resistLoss` what they take off the skill (Protection's, 0 with none).
export interface BuffShift { caps: Record<string, number>; shares: Record<string, number>; minimum?: number | null | undefined; resistLoss?: number | undefined }
// The optimizer's profile for one character. Resist floors and caps are written in paperdoll terms (what the
// character sheet shows), which are item totals: Resisting Spells adds nothing to gear, it holds each resist at its
// minimum (`mins`, resistMinimum). A race can raise a resist's cap (rules.raceCaps, e.g. an Elf's Energy cap). The
// player's own resistCaps replace the shard's per resist, and a resist floor counts up to its resist's cap. Every floor
// not marked soft is hard. `shift` is what planned buffs change (app/buffs.mts plannedProfile): their caps replace
// these, and a buff's in-cap share is a base the gear needn't supply, so it comes off the cap, the floor and the
// minimum (a negative share, Divine Fury's DCI −20, adds to them). A cap the shift sets may go below 0, which keeps it
// exact: min(gear, cap − share) + share = min(gear + share, cap) for any gear, a negative total included. A floor
// stops at 0, which the solvers read as no requirement: the buff alone meets it. The shift also carries the stat caps
// (STR, DEX, INT past raw) and the minimum the buffs leave.
export function effectiveProfile(p: Profile = {}, character: Character | null = null, shift: BuffShift | null = null): EffectiveProfile {
  const rules = getRules();
  const skill = resistSkillOf(character?.skills), own = skill == null ? null : minResistAt(skill), min = shift && shift.minimum !== undefined ? shift.minimum : own;
  const caps: Record<string, number> = { ...rules.caps as Record<string, number>, ...fcCaps(character, p.castingSchool), ...(p.caps || {}) };
  const floors: Record<string, number> = { ...(p.floors || {}) };
  const view = resistCapsFor(p.race, p.resistCaps);
  const overrides: Record<string, ResistCap> = {}, mins: Record<string, number> = {};
  const share = (k: string): number => shift?.shares[k] || 0;
  for (const k of RESIST_KEYS) {
    const { cap: own, shard } = view[k]!, cap = shift?.caps[k] ?? own;
    if (own !== shard) overrides[k] = { cap: own, shard };
    caps[k] = cap - share(k);
    if (floors[k] != null) floors[k] = Math.max(0, Math.min(floors[k], cap) - share(k));
    if (min != null) mins[k] = min - share(k);
  }
  for (const k of new Set([...Object.keys(shift?.caps || {}), ...Object.keys(shift?.shares || {})])) {
    if (RESIST_KEYS.includes(k)) continue;
    const cap = shift!.caps[k] ?? caps[k];
    if (cap != null) caps[k] = cap - share(k);
    if (floors[k] != null) floors[k] = Math.max(0, floors[k] - share(k));
  }
  const hardFloors = Object.keys(floors).filter((k) => !(p.softFloors || []).includes(k));
  const steps = skill == null ? [] : resistStepsFor(skill, resistSkillCapOf(character?.skills), shift?.resistLoss ?? 0, share);
  return { weights: { ...(p.weights || {}) }, caps, floors, floorBonus: p.floorBonus ?? 1000, hardFloors, resistSkill: skill, resistMinimum: own,
    ...(min != null ? { mins } : {}), ...(Object.keys(overrides).length ? { resistCapOverrides: overrides } : {}), ...(steps.length ? { resistSteps: steps } : {}) };
}
// The fields of a built profile its resist caps are read from (profileResistCaps).
export interface CapsView {
  caps: Record<string, number>;
  resistCapOverrides?: Record<string, ResistCap> | undefined;
  buffs?: { caps?: Record<string, number> | undefined } | undefined;
}
// A built profile's resist caps in paperdoll terms, before any planned buff, what a result is shown against: the
// override where there is one, else the profile's cap.
export function profileResistCaps(prof: CapsView): Record<string, ResistCap> {
  return Object.fromEntries(RESIST_KEYS.map((k) => {
    const o = prof.resistCapOverrides?.[k];
    if (o) return [k, o];
    const cap = (prof.buffs?.caps ?? prof.caps)[k] ?? 70;
    return [k, { cap, shard: cap }];
  }));
}

// ---------------------------------------------------------------------------
// Snapshot folding. Snapshots are immutable facts written by packrat-scanner.py; the
// inventory is the fold of all of them in time order: a later scan of a root container replaces
// everything previously known under that root, and a character's equipped set is replaced whole.
// ---------------------------------------------------------------------------

// scan.containers is Record<string, unknown> in the generated schema (deliberately loose — see
// scan.v2.schema.json's own $comment on why `containers`/`stats`/etc. aren't walked field by
// field). Every scan actually writes container entries shaped like this; narrowed once here, at
// the fold's read boundary, rather than scattered as `as` down every line that reads `c.foo`.
interface ScanContainerRaw {
  serial: number;
  kind?: string | null | undefined;
  name?: string | undefined;
  parent?: number | null | undefined;
  root: number;
  tooltip?: string[] | undefined;
  opened?: boolean | undefined;
}

// The minimal shape enrich()'s `raw` argument needs — satisfied by a ScanV2ItemsItem, a
// ScanV2EquippedItem, or the bag literal foldSnapshots builds for a container-turned-item.
interface EnrichRaw {
  serial: number;
  name?: string | undefined;
  tooltip?: string[] | undefined;
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  amount?: number | undefined;
}
interface EnrichLoc {
  root: number | null;
  container: number | null;
  equippedBy: string | null;
  layer: string | null;
  seenAt: string;
  scannedBy: string;
}

// A container the player blacklisted: one entry of <data>/scan-blacklist.json, which the app (POST
// /api/blacklist) and the TazUO script packrat-blacklist.py both write. Scanners never open one.
export interface BlacklistEntry { serial: number; name: string; addedAt: string; where?: string | undefined }

// `overrides`: the player's kinds from <data>/item-kinds.json (issue #150, app/item-kinds.mts), applied as each item is
// enriched, so a fresh scan honours them the same as a refold does.
export function foldSnapshots(snapshots: ScanV2[], overrides: KindOverrides = NO_KIND_OVERRIDES): Inventory {
  // Null-prototype dictionaries, not `{}`: every key below comes from the scan (a container's own
  // serial, the character's name), and `obj["__proto__"] = value` on an ordinary object invokes the
  // inherited setter and REPLACES that object's prototype — the entry silently disappears and an
  // attacker-controlled inherited key becomes readable off the map. JSON.stringify and every
  // Object.keys/values/entries read below behave identically on a null-prototype object (Phase 7
  // security review, Area 2, Minor 1).
  const inv: Inventory = { characters: Object.create(null), containers: Object.create(null), items: Object.create(null), scans: [] };
  // validateScan refuses a scannedAt that is not a real instant, but a scan folded from before that
  // check could still carry one: it sorts first, because a NaN comparator result reads as "equal" and
  // would let an older scan of a root fold after a newer one.
  const stampOf = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };
  const sorted = [...snapshots].sort((a, b) => stampOf(a.scannedAt) - stampOf(b.scannedAt));
  for (const snap of sorted) {
    if (snap.schemaVersion !== 2) throw new Error("foldSnapshots needs v2 scans — call upgradeScan first");
    if (snap.kind !== undefined) continue;   // a house-only file (TazUO's packrat-house-map-refresh.py) is for the house map alone: it must not replace a card or a worn set; any other kind is from a newer adapter
    const char = snap.character;
    if (isPseudoCharacter(char)) forgetCharacter(inv, (snap as ScanV2 & { forgetCharacter?: unknown }).forgetCharacter);
    // A root with opened:false (open failed — too far, locked) is still listed in snap.roots, but
    // carries no items; it must be treated exactly like a root the snapshot didn't mention at all —
    // i.e. excluded from the replace-per-root set below — so the fold keeps whatever it last knew
    // about that root instead of wiping it. Only opened:true roots (the historical v1→v2 upgrade
    // stamps every root opened:true, so old scans are unaffected) participate in replace-per-root.
    const roots = new Set((snap.roots || []).filter((r) => r.opened !== false).map((r) => +r.serial));
    // A container INSIDE a root that the scan saw but could not open (`opened: false` on its
    // containers entry: a bag that did not open, or one nested deeper than the adapter reads) is not
    // evidence it is empty. Everything the fold knew inside it — items and bags, however deep — is
    // kept, with its old seenAt; the rest of the root is replaced as usual. The bag may have moved
    // (another chest, another character's), so what is kept moves with it: its root becomes the
    // bag's new root and scannedBy this scanner, or the next scan of the old root would delete it.
    const unopened = new Map(Object.values((snap.containers || {}) as Record<string, { serial: number; root: number; opened?: unknown }>)
      .filter((c) => c.opened === false && roots.has(+c.root)).map((c) => [+c.serial, +c.root]));
    const unopenedRootAbove = (serial: number | null | undefined): number | null => {
      for (let cur = serial, guard = 0; cur != null && guard < 64; guard++) {
        if (unopened.has(+cur)) return unopened.get(+cur)!;
        cur = inv.containers[cur]?.parent;
      }
      return null;
    };
    const keptItems = new Set<string>(), keptContainers = new Set<string>();
    if (unopened.size) {
      const moves: [{ root: number | null; scannedBy: string }, number][] = [];
      for (const [serial, it] of Object.entries(inv.items)) {
        const root = unopenedRootAbove(it.container);
        if (root != null) { keptItems.add(serial); moves.push([it, root]); }
      }
      for (const [serial, c] of Object.entries(inv.containers)) {
        const root = unopenedRootAbove(c.parent);
        if (root != null) { keptContainers.add(serial); moves.push([c, root]); }
      }
      for (const [kept, root] of moves) { kept.root = root; kept.scannedBy = char; }
    }
    // An item this scan records with no name and no tooltip (its tooltip never arrived, issue #298): it keeps the last known name and properties, and takes what the client did report (graphic, hue, amount) and its new place.
    const replaced = new Map<string, Item>();
    for (const [serial, it] of Object.entries(inv.items)) {
      if ((it.equippedBy === char) || (it.root != null && roots.has(+it.root) && !keptItems.has(serial))) { replaced.set(serial, it); delete inv.items[serial]; }
    }
    const foldItem = (raw: EnrichRaw, loc: EnrichLoc): Item => {
      const known = !raw.name && !raw.tooltip?.length ? inv.items[raw.serial] ?? replaced.get(String(raw.serial)) : undefined;
      if (!known) return enrich(raw, loc, overrides);
      return { ...known, ...(raw.graphic != null ? { graphic: raw.graphic } : {}), ...(raw.hue != null ? { hue: raw.hue } : {}), ...(raw.amount ? { amount: raw.amount } : {}), ...loc };
    };
    for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root) && !keptContainers.has(serial)) delete inv.containers[serial];
    const snapContainers = (snap.containers || {}) as Record<string, ScanContainerRaw>;
    // Indexed once per snapshot, by the entry's own serial — nothing requires snap.containers' KEYS
    // to be serials at all, and the old per-item `Object.values(...).find(...)` fallback for a key
    // that didn't match cost items x containers (2.3 s for 20,000 items across 2,000 containers,
    // every fold and every restart). Strictly faster for an honest scan too.
    const bySerial = new Map<number, ScanContainerRaw>(Object.values(snapContainers).map((c) => [+c.serial, c]));
    // A root the scan lists but left out of `containers` is built from its roots entry when anything
    // sits in it (an item filed directly in it, or a bag under it), or those items would have no
    // container to resolve their root through and be dropped, and the bags' location would read
    // "unknown". One holding nothing stays absent: that is how a Forget tombstone clears a root.
    const occupied = new Set([...(snap.items || []).map((it) => +it.container), ...Object.values(snapContainers).map((c) => +c.root)]);
    for (const r of snap.roots || []) {
      if (roots.has(+r.serial) && !bySerial.has(+r.serial) && occupied.has(+r.serial)) bySerial.set(+r.serial, { serial: +r.serial, root: +r.serial, parent: null, kind: r.kind, name: r.name });
    }
    for (const c of bySerial.values()) {
      if (!roots.has(+c.root)) continue;
      inv.containers[c.serial] = { ...c, capacity: capacityOf(c.tooltip), scannedBy: char, scannedAt: snap.scannedAt };
    }
    for (const c of Object.values(snapContainers)) {
      if (c.parent == null || !roots.has(+c.root)) continue;   // roots (chests, backpack, bank) are places, not things
      if (c.kind != null && c.kind !== "container" && c.kind !== "bag") continue;   // old scans said "bag"; a later scanner says "container"
      const bag = enrich({ serial: c.serial, name: bagLabel(c), tooltip: [bagLabel(c), ...(c.tooltip || [c.name]).slice(1)] as string[], amount: 1 },
        { root: +c.root, container: +c.parent, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char }, overrides);
      if (!SPELLBOOK_RE.test(c.name || "") && !/runebook|runic atlas/i.test(c.name || "")) {   // a bag engraved "DEXXER armor" is still a bag
        bag.gear = false; bag.slot = null; bag.kind = "container";
      }
      inv.items[c.serial] = bag;
    }
    for (const raw of snap.items || []) {
      const c = bySerial.get(+raw.container);
      const root = c ? +c.root : null;
      if (root == null || !roots.has(root)) continue;
      inv.items[raw.serial] = foldItem(raw, { root, container: +raw.container, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char });
    }
    for (const raw of snap.equipped || []) {
      inv.items[raw.serial] = foldItem(raw, { root: null, container: null, equippedBy: char, layer: raw.layer || null, seenAt: snap.scannedAt, scannedBy: char });
    }
    if (!isPseudoCharacter(char)) {
      inv.characters[char] = { name: char, stats: snap.stats || {}, scannedAt: snap.scannedAt, position: snap.position || null,
        maxes: snap.maxes || null, resists: snap.resists || null, skills: snap.skills || {}, adapter: snap.adapter || null };
    }
    inv.scans.push({ character: char, scannedAt: snap.scannedAt, items: (snap.items || []).length, roots: [...roots] });
  }
  dropTrash(inv);
  labelContainers(inv);
  for (const it of Object.values(inv.items)) it.location = locationOf(it, inv);
  return inv;
}

// A trash barrel or chest: the server deletes what is put in one on a timer, so whatever an older scan
// recorded inside one is long gone. Scanners never open one (TRASH_RE in each adapter); what they
// recorded before that is dropped here, the container itself and everything under it included.
export const TRASH_RE = /\btrash\b/i;
function dropTrash(inv: Inventory): void {
  const trash = new Set(Object.values(inv.containers).filter((c) => TRASH_RE.test(c.name || "")).map((c) => +c.serial));
  if (!trash.size) return;
  const inTrash = (serial: number | null | undefined): boolean => {
    for (let cur = serial, guard = 0; cur != null && guard < 64; guard++) {
      if (trash.has(+cur)) return true;
      cur = inv.containers[cur]?.parent;
    }
    return false;
  };
  for (const [serial, it] of Object.entries(inv.items)) if (inTrash(+serial) || inTrash(it.container)) delete inv.items[serial];
  for (const serial of Object.keys(inv.containers).filter((s) => inTrash(+s))) delete inv.containers[serial];
}

// A character tombstone (POST /api/forget-character: a `_vault` scan carrying `forgetCharacter`)
// removes what only that character's scans ever put there: its card, its worn set, and its backpack
// and bank roots with everything under them. Ground containers it scanned stay: they belong to a
// house, and another character's scan may be the one keeping them current. A later scan of the
// character brings it back, by the fold's usual newest-wins order.
function forgetCharacter(inv: Inventory, name: unknown): void {
  if (typeof name !== "string" || !name) return;
  const roots = new Set(Object.values(inv.containers).filter((c) => c.parent == null && c.scannedBy === name && (c.kind === "backpack" || c.kind === "bank")).map((c) => +c.root));
  for (const [serial, it] of Object.entries(inv.items)) {
    if (it.equippedBy === name || (it.root != null && roots.has(+it.root))) delete inv.items[serial];
  }
  for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root)) delete inv.containers[serial];
  delete inv.characters[name];
}

// Each container's segment in location text. Location text is what the Location filter, the group
// view's per-place counts and the builder's Fetch list key on, and a house full of chests called
// "Metal Chest" (or three "A Bag"s in one backpack) would otherwise merge into one place. Containers
// that share a label and sit side by side (the same parent; for ground roots, every ground root) get
// their serial as a suffix: unlike a position, it never changes when another same-named container is
// added or moved, so a saved filter or a remembered location keeps meaning the same chest. A backpack or bank root
// is never shown by its own name (locationOf names it after its owner), so those roots are left out.
function labelContainers(inv: Inventory): void {
  const groups = new Map<string, Container[]>();
  for (const c of Object.values(inv.containers)) {
    const scope = c.parent != null ? `in ${c.parent}` : c.kind === "backpack" || c.kind === "bank" ? `own ${c.serial}` : "ground";
    const key = `${scope}\u0000${bagLabel(c)}`;
    const list = groups.get(key);
    if (list) list.push(c); else groups.set(key, [c]);
  }
  for (const list of groups.values()) {
    for (const c of list) c.label = list.length === 1 ? bagLabel(c) : `${bagLabel(c)} (0x${(+c.serial).toString(16)})`;
  }
}

function enrich(raw: EnrichRaw, loc: EnrichLoc, overrides: KindOverrides): Item {
  const parsed = parseTooltip(raw.tooltip && raw.tooltip.length ? raw.tooltip : [raw.name], raw.amount);
  const cls = classify(parsed.name || raw.name, parsed, loc.layer, raw.graphic);
  const shipped = cls.gear ? "gear" : kindOf(parsed.name || raw.name, parsed, raw.graphic);
  const name = displayName(parsed) || raw.name || "";
  return {
    serial: +raw.serial, name, graphic: raw.graphic, hue: raw.hue, amount: raw.amount || 1,
    props: parsed.props, setBonus: parsed.setBonus, extras: parsed.extras, flags: parsed.flags, tags: parsed.tags, strReq: parsed.strReq,
    rarity: parsed.rarity, weight: parsed.weight, skillReq: parsed.skillReq, lines: parsed.lines,
    gargoyle: /\bgargish\b/i.test(parsed.name || raw.name || "") || parsed.flags.includes("gargoyles only"),
    slayers: slayersOf(parsed.flags),
    medable: medableOf(parsed.name || raw.name || "", cls.slot, cls.gear, parsed.flags),
    slot: cls.slot, twoHanded: cls.twoHanded, gear: cls.gear, kind: shipped === "gear" ? shipped : (overriddenKind(overrides, name, null) ?? overriddenKind(overrides, parsed.name || raw.name, raw.graphic)) ?? shipped, ...loc,
  };
}

export function containerPath(serial: number | null, inv: Inventory): string[] {
  const names = [];
  // A null serial (an item whose location was never resolved to a real container) looks up
  // inv.containers["null"] the same way the pre-TypeScript code did by indexing with `null`
  // directly — never matches, `cur` comes back undefined, and the loop below simply doesn't run.
  let cur: Container | null | undefined = inv.containers[serial as number], guard = 0;
  while (cur && guard++ < 8) {
    names.unshift(cur.label || bagLabel(cur));
    cur = cur.parent != null ? inv.containers[cur.parent] : null;
  }
  return names;
}

interface BagLabelSource {
  tooltip?: string[] | undefined;
  name?: string | undefined;
  serial: number;
}
export function bagLabel(c: BagLabelSource): string {
  const eng = (c.tooltip || []).map(stripHtml).find((l) => /engraved|^\[.*\]$/i.test(l));
  if (eng) return eng.replace(/^engraved:?\s*/i, "").trim();
  return c.name || `0x${(+c.serial).toString(16)}`;
}

// A container's fill from its tooltip's Contents line (ServUO's clilocs): "Contents: 13/125 Items, 95 Stones" on
// a house container, "Contents: 1/1 Items, 49/50 Stones" on one with a weight cap. Null when no line reads that
// way: a backpack or bank root, a ground root from a scan older than root tooltips (TazUO 2.9.0, Razor Enhanced
// 1.9.0), or a line with no maximum. Organize (issue #11) never plans a put into a container whose capacity is null.
const CONTENTS_RE = /^contents:\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*items?\b(?:\s*,\s*(\d[\d,]*)(?:\s*\/\s*(\d[\d,]*))?\s*stones?\b)?/i;
export function capacityOf(tooltip: string[] | null | undefined): ContainerCapacity | null {
  for (const line of (tooltip || []).map(stripHtml)) {
    const m = line.match(CONTENTS_RE);
    if (!m) continue;
    const n = (s: string | undefined): number | null => (s == null ? null : +s.replace(/,/g, ""));
    return { items: n(m[1])!, maxItems: n(m[2])!, stones: n(m[3]), maxStones: n(m[4]) };
  }
  return null;
}

export function locationOf(it: Item, inv: Inventory): ItemLocation {
  if (it.equippedBy) return { kind: "equipped", character: it.equippedBy, text: `Worn by ${it.equippedBy}`, root: null };
  // Same null-as-string-key quirk as containerPath above: it.root can be null, and the lookup just
  // misses (root comes back undefined), which the ternaries below already treat as "unknown/?".
  const root = inv.containers[it.root as number];
  const path = containerPath(it.container, inv);
  const kind = root ? root.kind : "unknown";
  const owner = root ? root.scannedBy : "?";
  let text;
  if (kind === "backpack") text = `${owner}'s backpack` + (path.length > 1 ? " › " + path.slice(1).join(" › ") : "");
  else if (kind === "bank") text = `${owner}'s bank` + (path.length > 1 ? " › " + path.slice(1).join(" › ") : "");
  else text = path.join(" › ") || "unknown";
  return { kind, character: owner, text, root: it.root, rootName: root ? root.label || bagLabel(root) : "?" };
}

// ---------------------------------------------------------------------------
// Optimizer pools. `current` = the character's worn set by optimizer slot; pools = every wearable
// candidate (this character's own worn items included), excluding other characters' worn gear
// unless allowed, STR-gated, tag-filtered.
// ---------------------------------------------------------------------------
export interface OptItem {
  serial: number;
  name: string;
  slot: string | null;
  props: PropMap;
  twoHanded?: true | undefined;
  speed?: number | undefined;   // a weapon's base speed in seconds (its tooltip's Weapon Speed), for swing steps (app/swing.mts)
  tieCost?: number | undefined; // a rarity preference's per-piece cost (POST /api/optimize stamps it): among equally good suits the solvers take the lowest sum
}
// buildPools() only ever stores an item after `!it.slot` has already sent it to `continue` — every
// item it hands the solver has passed that filter, so its slot is honestly a string, not the plain
// OptItem's `string | null`. scripts/optimizer-core.mts declares its own (unexported) OptItem with a
// required, non-null `slot` — the two are independently declared (at run time the core imports only
// app/solver/scoring.mts; see its own header comment) describing the same runtime objects, and they already
// drifted once with nothing to catch it (app/solver.test.mts's compile-time assignability guard, next
// to its own note on the cast this boundary needs, is what catches it now).
export type PooledOptItem = OptItem & { slot: string };
export interface BuildPoolsOptions {
  allowOthersWorn?: boolean | undefined;
  strength?: number | undefined;
  excludeTags?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  onlyRoots?: number[] | undefined;        // issue #12: when it lists any, an unworn piece is a candidate only under one of these roots (worn pieces follow their own rule)
  excludeGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  excludeWeapons?: string[] | undefined;   // weapon skills left out (weaponAllowed)
  ubwsAnyWeapon?: boolean | undefined;     // a Use Best Weapon Skill weapon passes while a melee skill is allowed (default on)
  excludeSkills?: string[] | undefined;
  weaponMustHave?: string[] | undefined;   // yes/no properties every weapon must carry (weaponHasFlags, issue #214)
  lockedSlots?: string[] | undefined;      // a locked slot keeps its worn weapon whatever weaponMustHave says (`weaponFlags.kept`)
  // Manual's placed pieces by slot (issue #12, "Fill the rest automatically"): each is its slot's only candidate and
  // the suit's current piece there, and nothing else is current.
  pinned?: Partial<Record<string, number>> | undefined;
}
export interface SkippedLists {
  str: Item[]; tags: Item[]; worn: Item[]; roots: Item[]; gargoyle: Item[]; nonMed: Item[]; weapon: Item[]; skill: Item[];
}
export interface BuildPoolsResult {
  pools: Partial<Record<string, PooledOptItem[]>>;
  current: Partial<Record<string, PooledOptItem>>;
  skipped: SkippedLists;
  blocked: string[];
  // With weaponMustHave: the locked slots whose worn weapon lacks a required property (kept, the lock wins), and whether
  // the requirement itself emptied both hands' pools of weapons (the suit is then built without one). A pool the other
  // settings left weaponless is not `none`: the requirement is not why.
  weaponFlags?: { kept: string[]; none: boolean } | undefined;
}
// `character` null: nobody's suit (Manual's No character), so every worn piece is another character's.
export function buildPools(inv: Inventory, character: string | null, opts: BuildPoolsOptions = {}): BuildPoolsResult {
  const { allowOthersWorn = false, strength = Infinity, excludeTags = [], excludeRoots = [], onlyRoots = [], excludeGargoyle = getRules().raceLock.gargoyleOnly, medOnly = false, excludeWeapons = [], ubwsAnyWeapon = true, excludeSkills = [], weaponMustHave = [], lockedSlots = [], pinned } = opts;
  const pools: Partial<Record<string, PooledOptItem[]>> = {}, current: Partial<Record<string, PooledOptItem>> = {}, skipped: SkippedLists = { str: [], tags: [], worn: [], roots: [], gargoyle: [], nonMed: [], weapon: [], skill: [] };
  const exRoots = new Set(excludeRoots.map(Number)), only = new Set(onlyRoots.map(Number));
  let flagless = 0;   // weapons the required properties left out (weaponMustHave)
  for (const it of Object.values(inv.items)) {
    if (!it.gear || !it.slot || !GEAR_SLOTS.includes(it.slot)) continue;
    // toOptItem's own return type is the plain OptItem (slot: string | null) — this cast is the one
    // place that fact narrows to PooledOptItem, backed by the `!it.slot` check just above (no runtime
    // change: opt.slot is it.slot, already known non-null here).
    const opt = toOptItem(it) as PooledOptItem;
    if (character != null && it.equippedBy === character) { if (!current[it.slot] && !pinned) current[it.slot] = opt; }
    if (it.equippedBy && it.equippedBy !== character && !allowOthersWorn) { skipped.worn.push(it); continue; }
    if (excludeGargoyle && it.gargoyle) { skipped.gargoyle.push(it); continue; }
    if (medOnly && !it.medable) { skipped.nonMed.push(it); continue; }
    if (!weaponAllowed(it, excludeWeapons, ubwsAnyWeapon)) { skipped.weapon.push(it); continue; }
    if (hasSkillBonus(it, excludeSkills)) { skipped.skill.push(it); continue; }
    if (it.strReq > strength) { skipped.str.push(it); continue; }
    if (it.tags.some((t) => excludeTags.includes(t))) { skipped.tags.push(it); continue; }
    // with an Only containers list, an unworn piece in no container (carried by a trip with no backpack to put it in) is outside it
    const outside = it.root == null ? only.size > 0 && !it.equippedBy : (only.size > 0 && !only.has(+it.root)) || exRoots.has(+it.root);
    if (outside) { skipped.roots.push(it); continue; }
    // last, so `flagless` counts only weapons every other filter let through
    if (!weaponHasFlags(it, weaponMustHave)) { skipped.weapon.push(it); flagless++; continue; }
    // a piece with no properties (a tag penalty aside, as classify reads it) never beats an empty slot, so where a slot
    // may stay empty it is no candidate: the search would otherwise send the player for a plain robe or shirt that
    // changes nothing. A plain weapon or shield stays one: what a weapon is for is not in its properties.
    if (!REQUIRED_SLOTS.includes(it.slot) && !HAND_SLOTS.includes(it.slot) && !Object.entries(opt.props).some(([k, v]) => v && k !== "tagPenalty")) continue;
    (pools[it.slot] ||= []).push(opt);
  }
  // A pinned piece is kept whoever wears it and whatever the filters say. The hand rule holds in the pools: a pinned
  // two-handed weapon empties the one-hand slot, and a pinned one-hander keeps two-handed weapons out of the other hand.
  for (const [slot, serial] of Object.entries(pinned || {})) {
    const it = serial != null ? inv.items[serial] : undefined;
    if (it?.gear && it.slot === slot && GEAR_SLOTS.includes(slot)) pools[slot] = [current[slot] = toOptItem(it) as PooledOptItem];
  }
  if (current.twoHanded?.twoHanded && pinned?.twoHanded != null) pools.oneHanded = [];
  if (current.oneHanded && pinned?.oneHanded != null) pools.twoHanded = (pools.twoHanded || []).filter((it) => !it.twoHanded);
  // A worn piece the filters rule out (wrong weapon type, a forbidden skill bonus, a missing weapon property) must not
  // stay a candidate through the "keep what you wear" rule. A pinned piece is never blocked, and a locked slot keeps a
  // weapon that lacks a required property: the player chose it.
  // The game never wears a two-handed weapon beside a one-hander (a demo fixture does): the one hand reads as empty, as
  // the core's optSanitize would leave it, so the exact search never starts from a suit nobody can wear.
  if (current.twoHanded?.twoHanded && current.oneHanded) delete current.oneHanded;
  const wornAt = (sl: string): Item | null => (current[sl] && pinned?.[sl] == null ? inv.items[current[sl]!.serial] || ({} as Item) : null);
  const kept = weaponMustHave.length ? HAND_SLOTS.filter((sl) => lockedSlots.includes(sl) && wornAt(sl) && !weaponHasFlags(wornAt(sl)!, weaponMustHave)) : [];
  const blocked = GEAR_SLOTS.filter((sl) => {
    const it = wornAt(sl);
    return it && (!weaponAllowed(it, excludeWeapons, ubwsAnyWeapon) || hasSkillBonus(it, excludeSkills) || (!weaponHasFlags(it, weaponMustHave) && !kept.includes(sl)));
  });
  if (!weaponMustHave.length) return { pools, current, skipped, blocked };
  const none = flagless > 0 && !kept.length && !HAND_SLOTS.some((sl) => (pools[sl] || []).some((o) => isWeapon(inv.items[o.serial] || ({} as Item))));
  return { pools, current, skipped, blocked, weaponFlags: { kept, none } };
}
// True when the item carries a bonus to any of the listed skills (e.g. the Summoner's forbidden Necromancy).
export function hasSkillBonus(it: Item, skills: string[] = []): boolean {
  return skills.length > 0 && Object.entries(it.extras || {}).some(([k, v]) => skills.includes(k) && typeof v === "number" && v > 0);
}
// Keys the suit builder can weight or floor besides the plain item properties: the stamina/mana/hits pools and every
// skill bonus found on gear. gearSkills lists the skills that appear as bonuses (for the forbid chips).
export function gearSkills(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) if (it.gear) for (const [k, v] of Object.entries(it.extras || {})) if (SKILL_SET.has(k) && typeof v === "number" && v) set.add(k);
  return [...set].sort();
}
export function builderKeys(inv: ItemsLike): string[] {
  return ["stamPool", "manaPool", "hitsPool", ...gearSkills(inv).map((k) => `sk:${k}`)];
}

// Weapon-type filter for the suit builder: the weapon skills the player excluded (profile `excludeWeapons`). A weapon
// whose Skill Required line names an excluded skill never enters the pool; nothing else in the hands is touched.
// A weapon with Use Best Weapon Skill swings with the wielder's best of the three melee skills, never Archery or
// Throwing (ServUO BaseWeapon.GetUsedSkill), so with `ubws` on it passes while any of those three is allowed.
export const WEAPON_SKILLS: string[] = ["archery", "swordsmanship", "fencing", "mace fighting", "throwing"];
export const MELEE_SKILLS: string[] = ["swordsmanship", "fencing", "mace fighting"];
// Issue #259: the list may also hold SPELLBOOKS ("spellbook"), which keeps every spellbook (a one-handed piece whose name
// SPELLBOOK_RE matches) out of the pool. WEAPON_EXCLUDES is everything the list accepts, in the order the page shows it.
export const SPELLBOOKS = "spellbook";
export const WEAPON_EXCLUDES: string[] = [...WEAPON_SKILLS, SPELLBOOKS];
export const ubwsLetsIn = (excluded: string[], ubws = true): boolean => ubws && MELEE_SKILLS.some((w) => !excluded.includes(w));
export function weaponAllowed(it: Item, excluded: string[] = [], ubws = true): boolean {
  if (it.slot === "oneHanded" && excluded.includes(SPELLBOOKS) && SPELLBOOK_RE.test(it.name || "")) return false;
  if (!excluded.some((w) => w !== SPELLBOOKS) || (it.slot !== "oneHanded" && it.slot !== "twoHanded")) return true;
  const own = String(it.skillReq || "").toLowerCase();
  if ((it.flags || []).includes("use best weapon skill")) {
    if (ubwsLetsIn(excluded, ubws)) return true;
    // No Skill Required line (#193): it swings with a melee skill, and nothing vouches for one.
    if (!own) return false;
  }
  return !excluded.includes(own);
}
// Issue #188: the weapon skills a weapon counts under in the Inventory's Weapon skill filter, in WEAPON_SKILLS order: its
// Skill Required line, and with Use Best Weapon Skill also the three melee skills it may swing with (ServUO
// BaseWeapon.GetUsedSkill), the same MELEE_SKILLS the Suit Builder's weaponAllowed uses (#187).
export function weaponSkillsOf(it: Pick<Item, "slot" | "skillReq" | "flags">): string[] {
  if (it.slot !== "oneHanded" && it.slot !== "twoHanded") return [];
  const own = String(it.skillReq || "").toLowerCase(), best = (it.flags || []).includes("use best weapon skill");
  return WEAPON_SKILLS.filter((w) => w === own || (best && MELEE_SKILLS.includes(w)));
}
// Issue #214: the yes/no properties a build may require on its weapon (profile `weaponMustHave`): any of BOOLEAN_FLAGS
// is accepted, and the page offers WEAPON_MUST_HAVE. A weapon is a held piece with a Skill Required or Weapon Speed
// line, so shields and spellbooks are never held to it.
export const WEAPON_MUST_HAVE: string[] = ["spell channeling", "balanced"];
export const isWeapon = (it: Pick<Item, "slot" | "skillReq" | "extras">): boolean =>
  (it.slot === "oneHanded" || it.slot === "twoHanded") && (!!it.skillReq || typeof it.extras?.["weapon speed"] === "number");
// The required properties a piece lacks, its flags read through flagKey; none for a piece that is no weapon.
export function missingFlags(it: Item, required: string[] = []): string[] {
  if (!required.length || !isWeapon(it)) return [];
  const own = (it.flags || []).map(flagKey);
  return required.filter((f) => !own.includes(f));
}
export const weaponHasFlags = (it: Item, required: string[] = []): boolean => !missingFlags(it, required).length;
// The rule weaponMustHave is held to (profiles.v3.schema.json says the same): known yes/no properties, each once.
export function weaponMustHaveError(v: unknown, path = "weaponMustHave"): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${path} must be an array`;
  const i = v.findIndex((f, j) => typeof f !== "string" || !BOOLEAN_FLAGS.has(f) || v.indexOf(f) !== j);
  return i < 0 ? null : `${path}[${i}] is not a yes/no property, or is listed twice (${[...BOOLEAN_FLAGS].join(", ")})`;
}
// Profiles, templates and runs saved before the exclusion list held one choice, `weaponSkill` ("archery", or null/""
// for any weapon), which means "exclude every other weapon skill". Returns `s` itself when there is nothing to convert.
export function migrateWeaponSetting<T extends object>(s: T): T {
  if (!("weaponSkill" in s)) return s;
  const { weaponSkill, ...rest } = s as T & { weaponSkill?: unknown; excludeWeapons?: string[] };
  const skill = typeof weaponSkill === "string" ? weaponSkill.toLowerCase() : "";
  return { ...rest, excludeWeapons: rest.excludeWeapons || (skill ? WEAPON_SKILLS.filter((w) => w !== skill) : []) } as T;
}
// The rule excludeWeapons is held to at POST /api/optimize (profiles.v3.schema.json says the same): known weapon skills,
// or "spellbook".
export function excludeWeaponsError(v: unknown, path = "excludeWeapons"): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${path} must be an array`;
  const i = v.findIndex((w) => typeof w !== "string" || !WEAPON_EXCLUDES.includes(w));
  return i < 0 ? null : `${path}[${i}] must be a weapon skill or spellbook (${WEAPON_EXCLUDES.join(", ")})`;
}

// Templates: a full set of builder settings with no character in them (no race, STR limit or skipped containers).
// A character's profile keeps its own working copy plus `template`, the name it was applied from; drift between the
// two is settingsDiff(templateFrom(template), templateFrom(profile)).
export const TEMPLATE_KEYS: string[] = ["floors", "softFloors", "weights", "floorBonus", "lockedSlots", "excludeTags", "excludeSkills", "allowOthersWorn", "allowGargoyle", "medOnly", "excludeWeapons", "ubwsAnyWeapon", "weaponMustHave", "resistCaps", "swingSteps", "castingSchool", "rarity", "goals"];
export interface TemplateSource {
  floors?: Record<string, number> | undefined;
  softFloors?: string[] | undefined;
  weights?: Record<string, number> | undefined;
  floorBonus?: number | undefined;
  lockedSlots?: string[] | undefined;
  excludeTags?: string[] | undefined;
  excludeSkills?: string[] | undefined;
  allowOthersWorn?: boolean | undefined;
  allowGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  excludeWeapons?: string[] | undefined;   // weapon skills left out of the pool
  ubwsAnyWeapon?: boolean | undefined;     // absent means true (weaponAllowed)
  weaponMustHave?: string[] | undefined;   // yes/no properties every weapon must carry (weaponHasFlags)
  resistCaps?: Record<string, number> | undefined;   // the player's per-resist cap overrides, paperdoll terms
  swingSteps?: boolean | undefined;        // score SSI by swing step (app/swing.mts); absent means off
  castingSchool?: string | undefined;      // the school the Faster Casting cap follows (fcCapFor); absent means from the character's skills
  rarity?: RarityPreference | undefined;   // among equally good suits, prefer higher- or lower-rarity pieces; absent means any
  goals?: Goals | undefined;               // the goals the weights come from (issue #292); absent for weights set by hand
}
export interface Template {
  floors: Record<string, number>;
  softFloors: string[];
  weights: Record<string, number>;
  floorBonus: number;
  lockedSlots: string[];
  excludeTags: string[];
  excludeSkills: string[];
  allowOthersWorn: boolean;
  allowGargoyle: boolean;
  medOnly: boolean;
  excludeWeapons: string[];
  ubwsAnyWeapon: boolean;
  weaponMustHave: string[];
  resistCaps: Record<string, number>;
  swingSteps: boolean;
  castingSchool: string;   // "" means from the character's skills
  rarity: RarityPreference | undefined;   // undefined means any (a key either way, so applying a template clears a preference it lacks)
  goals: Goals | undefined;               // undefined means none (a key either way, so applying a template without goals clears them)
}
export function templateFrom(s: TemplateSource = {}): Template {
  return { floors: { ...(s.floors || {}) }, softFloors: [...(s.softFloors || [])], weights: { ...(s.weights || {}) }, floorBonus: s.floorBonus ?? 1000,
    lockedSlots: [...(s.lockedSlots || [])], excludeTags: [...(s.excludeTags || [])], excludeSkills: [...(s.excludeSkills || [])],
    allowOthersWorn: !!s.allowOthersWorn, allowGargoyle: !!s.allowGargoyle, medOnly: !!s.medOnly, excludeWeapons: [...(s.excludeWeapons || [])], ubwsAnyWeapon: s.ubwsAnyWeapon !== false, weaponMustHave: [...(s.weaponMustHave || [])], resistCaps: { ...(s.resistCaps || {}) }, swingSteps: !!s.swingSteps,
    castingSchool: s.castingSchool || "", rarity: s.rarity || undefined, goals: s.goals ? copyGoals(s.goals) : undefined };
}
// A copy of goals that shares no list with them.
export const copyGoals = (g: Goals): Goals => ({ ...g, ranks: g.ranks.map((r) => [...r]), ...(g.swing ? { swing: { ...g.swing } } : {}) });

// A profiles.json character entry, loosely — every field optional, TemplateSource's builder settings
// plus the bits a character carries that a template doesn't (which template it came from, race, a STR
// limit, and a v1 file's inline caps, dropped by the migration below).
export interface CharacterEntryRaw extends TemplateSource {
  archetype?: string | undefined;
  template?: string | undefined;
  race?: string | null | undefined;
  strLimit?: number | undefined;
  caps?: unknown;
}
// The profiles.json shape this module reads/writes across its schemaVersion 1 → 2 migration (app/build-spec.mts's
// migrateProfilesV3 takes it on to 3) — deliberately loose (as the v2 schema was: additionalProperties is true
// throughout, so an unrecognized field must round-trip unharmed). `[key: string]: unknown` lets a
// caller's extra top-level field (the file's own `_comment`, say) pass through `{...file}` untouched.
export interface ProfilesFile {
  schemaVersion?: number | undefined;
  templates?: Record<string, Template> | undefined;
  archetypes?: Record<string, TemplateSource> | undefined;
  characters?: Record<string, CharacterEntryRaw> | undefined;
  caps?: unknown;
  [key: string]: unknown;
}
// Profiles-file migration: `archetypes` (weights + floors, bound to a character by its `archetype`) became `templates`,
// and the binding is the character's `template` (schemaVersion 1). `caps` (the global property-cap object) moved out
// of profiles.json into the shard's rules file (schemaVersion 2) — a v1 file's `caps` is simply dropped; nothing reads
// it once the file is at v2 (effectiveProfile takes caps from getRules() now). A character's or template's single
// `weaponSkill` becomes `excludeWeapons` (migrateWeaponSetting), still at schemaVersion 2. Pure: a file already at
// schemaVersion 2 in the new shape comes back equal, changed false.
export function migrateProfiles(file: ProfilesFile = {}): { profiles: ProfilesFile; changed: boolean } {
  let changed = false;
  const out: ProfilesFile = { ...file };
  if (!out.templates) { out.templates = Object.fromEntries(Object.entries(out.archetypes || {}).map(([n, a]) => [n, templateFrom(a)])); changed = true; }
  if ("archetypes" in out) { delete out.archetypes; changed = true; }
  out.characters = { ...(out.characters || {}) };
  for (const [name, c] of Object.entries(out.characters)) {
    if (!("archetype" in c)) continue;
    const { archetype, ...rest } = c;
    out.characters[name] = { ...rest, template: c.template || archetype };
    changed = true;
  }
  // The single weapon choice became an exclusion list: "archery only" is "exclude every other weapon skill".
  const weapons = <T extends object>(m: Record<string, T>): Record<string, T> => {
    if (!Object.values(m).some((e) => e && typeof e === "object" && "weaponSkill" in e)) return m;
    changed = true;
    return Object.fromEntries(Object.entries(m).map(([n, e]) => [n, e && typeof e === "object" ? migrateWeaponSetting(e) : e]));
  };
  out.characters = weapons(out.characters);
  out.templates = weapons(out.templates);
  if (out.schemaVersion == null) { out.schemaVersion = 1; changed = true; }
  if (out.schemaVersion! < 2) {
    if ("caps" in out) { delete out.caps; changed = true; }
    out.schemaVersion = 2; changed = true;
  }
  return { profiles: out, changed };
}

// A saved run's builder settings — the "everything a run can differ by" shape settingsDiff compares.
// Looser than Template: a run also carries excludeRoots/race/strLimit/search knobs a template never does.
export interface RunSettings {
  floors?: Record<string, number> | undefined;
  weights?: Record<string, number> | undefined;
  softFloors?: string[] | undefined;
  lockedSlots?: string[] | undefined;
  excludeTags?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  onlyRoots?: number[] | undefined;
  race?: string | undefined;
  excludeSkills?: string[] | undefined;
  allowGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  allowOthersWorn?: boolean | undefined;
  exact?: boolean | undefined;
  excludeWeapons?: string[] | undefined;
  ubwsAnyWeapon?: boolean | undefined;
  weaponMustHave?: string[] | undefined;
  strLimit?: number | undefined;
  restarts?: number | undefined;
  budgetMs?: number | undefined;
  altCount?: number | undefined;
  altTol?: number | undefined;
  resistCaps?: Record<string, number> | undefined;
  buffs?: RunBuffs | undefined;   // the buffs planned with (app/buffs.mts); absent with none, and in a run saved before them
  swingSteps?: boolean | undefined;
  castingSchool?: string | undefined;
  rarity?: RarityPreference | undefined;
  goals?: Goals | undefined;   // the goals its weights came from (issue #292); absent for a run built from weights set by hand
  goalSwing?: GoalSwingWeapon | undefined;   // the weapon and stamina a Swing speed goal was set for (issue #302); absent in a run saved before it
}
// What a Swing speed goal was set for: the weapon worn when it was built (its name and base speed in seconds), the stamina
// it was worked out at (with the worn suit), and the stamina before gear (raw DEX and the buffs' shares), which the suit's own swing reads.
export interface GoalSwingWeapon { weapon: string; speed: number; stamina: number; stamBase: number }
// A run's buffs: which were on, and the numbers they scale with (app/buffs.mts's inputs, Resisting Spells aside).
export interface RunBuffs { on: string[]; skills: Record<string, number> }
// What changed between two sets of builder settings (b relative to a), one entry per change: its short readable line
// (`text`, what settingsDiff returns), the group it belongs to, and for a requirement, weight or resist cap its property
// (`key`), name and both values ("none" when absent), so a table can show them side by side (issue #336).
export type SettingsGroup = "requirements" | "weights" | "pool" | "buffs" | "character" | "search";
export interface SettingsChange { group: SettingsGroup; text: string; key?: string; label?: string; from?: string; to?: string; added?: boolean; soft?: boolean }
export function settingsChanges(a: RunSettings = {}, b: RunSettings = {}): SettingsChange[] {
  const out: SettingsChange[] = [];
  const add = (group: SettingsGroup, text: string, more: Omit<SettingsChange, "group" | "text"> = {}): void => { out.push({ group, text, ...more }); };
  const L = labelOf;
  // with goals setting the weights on both sides (issue #292), changed goals are one line, and the weights and swing-step
  // switch they set are not compared
  const fromGoals = goalsActive(a.goals) && goalsActive(b.goals);
  if (fromGoals && goalsText(a.goals!) !== goalsText(b.goals!)) add("weights", `goals: ${goalsText(b.goals!)}`, { label: "Goals", from: goalsText(a.goals!), to: goalsText(b.goals!) });
  for (const [group, noun] of [["floors", "floor"], ["weights", "weight"]] as const) {
    if (group === "weights" && fromGoals) continue;
    const A: Record<string, number> = a[group] || {}, B: Record<string, number> = b[group] || {};
    // a weight reads as its importance (importanceText), a floor as it is
    const v = (k: string, x: number): string | number => (group === "weights" ? importanceText(k, x) : x);
    for (const k of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
      if (group === "weights" && k in A && k in B && v(k, A[k]!) === v(k, B[k]!)) continue;   // a change too small to show is not named as "X → X"
      const g = group === "floors" ? "requirements" : "weights", soft = group === "floors" && k in B && (b.softFloors || []).includes(k);
      const row = { key: k, label: L(k), from: k in A ? String(v(k, A[k]!)) : "none", to: k in B ? String(v(k, B[k]!)) : "none", ...(soft ? { soft } : {}) };
      if (!(k in A)) add(g, `${L(k)} ${noun} ${v(k, B[k]!)} added`, { ...row, added: true });
      else if (!(k in B)) add(g, `${L(k)} ${noun} ${v(k, A[k]!)} removed`, row);
      else if (A[k] !== B[k]) add(g, `${L(k)} ${noun} ${v(k, A[k]!)} → ${v(k, B[k]!)}`, row);
    }
  }
  // A resist cap override: set, changed, or taken off (back to the shard's cap for the character's race).
  const RA: Record<string, number> = a.resistCaps || {}, RB: Record<string, number> = b.resistCaps || {};
  for (const k of RESIST_KEYS.filter((x) => x in RA || x in RB)) {
    const row = { key: k, label: `${L(k)} cap`, from: k in RA ? String(RA[k]) : "shard's", to: k in RB ? String(RB[k]) : "shard's" };
    if (!(k in RA)) add("character", `${L(k)} cap set to ${RB[k]}`, row);
    else if (!(k in RB)) add("character", `${L(k)} cap back to the shard's`, row);
    else if (RA[k] !== RB[k]) add("character", `${L(k)} cap ${RA[k]} → ${RB[k]}`, row);
  }
  const setDiff = <T,>(x: T[] = [], y: T[] = []): [T[], T[]] => [y.filter((v) => !x.includes(v)), x.filter((v) => !y.includes(v))];
  const [softOn, softOff] = setDiff(a.softFloors, b.softFloors);
  for (const k of softOn) if ((b.floors || {})[k] != null) add("requirements", `${L(k)} floor made soft`, { key: k, label: L(k), from: "hard", to: "soft", soft: true });
  for (const k of softOff) if ((b.floors || {})[k] != null) add("requirements", `${L(k)} floor made hard`, { key: k, label: L(k), from: "soft", to: "hard" });
  const [lockOn, lockOff] = setDiff(a.lockedSlots, b.lockedSlots);
  if (lockOn.length) add("pool", `locked ${lockOn.map((x) => SLOT_LABELS[x] || x).join(", ")}`);
  if (lockOff.length) add("pool", `unlocked ${lockOff.map((x) => SLOT_LABELS[x] || x).join(", ")}`);
  const [tagOn, tagOff] = setDiff(a.excludeTags, b.excludeTags);
  if (tagOn.length) add("pool", `excluding ${tagOn.join(", ")}`);
  if (tagOff.length) add("pool", `allowing ${tagOff.join(", ")}`);
  const [rootOn, rootOff] = setDiff(a.excludeRoots, b.excludeRoots);
  if (rootOn.length || rootOff.length) add("pool", "skipped containers changed");
  const [onlyOn, onlyOff] = setDiff(a.onlyRoots, b.onlyRoots);
  if (onlyOn.length || onlyOff.length) add("pool", b.onlyRoots?.length ? (a.onlyRoots?.length ? "only containers changed" : `only ${b.onlyRoots.length} container${b.onlyRoots.length === 1 ? "" : "s"}`) : "any container");
  if ((a.race || "human") !== (b.race || "human")) add("character", `race ${a.race || "human"} → ${b.race || "human"}`);
  const [skOn, skOff] = setDiff(a.excludeSkills, b.excludeSkills);
  if (skOn.length) add("pool", `forbidding ${skOn.join(", ")} bonuses`);
  if (skOff.length) add("pool", `allowing ${skOff.join(", ")} bonuses`);
  const flag = (k: "allowGargoyle" | "medOnly" | "exact" | "swingSteps", on: string, off: string, g: SettingsGroup = "pool") => { if (!!a[k] !== !!b[k]) add(g, b[k] ? on : off); };
  flag("allowGargoyle", "gargoyle gear allowed", "gargoyle gear excluded");
  flag("medOnly", "meditation-safe only", "meditation-safe off");
  const others = (s: RunSettings) => !!s.allowOthersWorn;   // a saved run is normalized to allowOthersWorn before it ever reaches here
  if (others(a) !== others(b)) add("pool", others(b) ? "others' worn gear allowed" : "others' worn gear excluded");
  flag("exact", "exact search on", "exact search off", "search");
  if (!fromGoals) flag("swingSteps", "+SSI by step", "SSI by point", "weights");
  if ((a.castingSchool || "") !== (b.castingSchool || "")) add("character", b.castingSchool ? `casting school ${b.castingSchool}` : "casting school from skills");
  if ((a.rarity || "") !== (b.rarity || "")) add("pool", b.rarity ? `prefer ${b.rarity} rarity` : "any rarity");
  const [wOn, wOff] = setDiff(a.excludeWeapons, b.excludeWeapons);
  const weaponWords = (ws: string[]): string => [ws.some((w) => w !== SPELLBOOKS) ? `${ws.filter((w) => w !== SPELLBOOKS).join(", ")} weapons` : "", ws.includes(SPELLBOOKS) ? "spellbooks" : ""].filter(Boolean).join(" and ");
  if (wOn.length) add("pool", `excluding ${weaponWords(wOn)}`);
  if (wOff.length) add("pool", `allowing ${weaponWords(wOff)}`);
  const ubws = (s: RunSettings) => s.ubwsAnyWeapon !== false;   // absent means on
  if (ubws(a) !== ubws(b)) add("pool", ubws(b) ? "Use Best Weapon Skill weapons allowed" : "Use Best Weapon Skill weapons held to their own skill");
  const [fOn, fOff] = setDiff(a.weaponMustHave, b.weaponMustHave);
  if (fOn.length) add("pool", `weapon must have ${fOn.join(", ")}`);
  if (fOff.length) add("pool", `weapon need not have ${fOff.join(", ")}`);
  if (a.strLimit !== b.strLimit && b.strLimit != null) add("character", `STR limit ${a.strLimit ?? "?"} → ${b.strLimit}`);
  if (a.restarts !== b.restarts && b.restarts != null) add("search", `restarts ${a.restarts ?? "?"} → ${b.restarts}`);
  if (a.budgetMs !== b.budgetMs && b.budgetMs != null && b.exact) add("search", `budget ${(a.budgetMs ?? 0) / 1000} s → ${b.budgetMs / 1000} s`);
  if (a.altCount !== b.altCount && b.altCount != null) add("search", `other suits ${a.altCount ?? 0} → ${b.altCount}`);
  if (a.altTol !== b.altTol && b.altTol != null) add("search", `other suits within ${a.altTol ?? 0} → ${b.altTol} points`);
  return out;
}
// The same, as short readable lines.
export const settingsDiff = (a: RunSettings = {}, b: RunSettings = {}): string[] => settingsChanges(a, b).map((c) => c.text);
// The What changed popover's rows (issue #336): each unsaved edit (saved → now) once, with the template's value beside it
// when there is a template (from its own change of that setting, else the value now, which the edit brought back to the
// template's); then the template's changes no unsaved edit covers. `count` is the rows listed, so the header and the
// sections agree. A setting is one requirement, weight or cap (a floor's soft/hard switch apart from its value), or a line.
export interface UnsavedChange extends SettingsChange { template?: string }
export function changesList(changed: SettingsChange[] | null, unsaved: SettingsChange[]): { unsaved: UnsavedChange[]; others: SettingsChange[]; count: number } {
  const id = (c: SettingsChange): string => (c.key ? `${c.group}|${c.key}|${c.from === "hard" || c.from === "soft" ? "soft" : "value"}` : `${c.group}|${c.text}`);
  const tpl = new Map((changed ?? []).map((c) => [id(c), c]));
  const rows: UnsavedChange[] = unsaved.map((c) => {
    const value = tpl.get(id(c))?.from ?? c.to;
    return changed && c.from != null && value != null ? { ...c, template: value } : c;
  });
  const mine = new Set(unsaved.map(id)), others = (changed ?? []).filter((c) => !mine.has(id(c)));
  return { unsaved: rows, others, count: rows.length + others.length };
}

export function toOptItem(it: Item): OptItem {
  const props: PropMap = { ...it.props };
  const sum = (a: string, b: string) => (props[a] || 0) + (props[b] || 0);
  if (sum("dexBonus", "stamInc")) props.stamPool = sum("dexBonus", "stamInc");
  if (sum("intBonus", "manaInc")) props.manaPool = sum("intBonus", "manaInc");
  const hits = (props.strBonus || 0) / 2 + (props.hpi || 0);
  if (hits) props.hitsPool = hits;
  for (const [k, v] of Object.entries(it.extras || {})) if (SKILL_SET.has(k) && typeof v === "number" && v) props[`sk:${k}`] = v;
  const o: OptItem = { serial: it.serial, name: it.name, slot: it.slot, props };
  if (it.twoHanded) o.twoHanded = true;
  const speed = it.extras?.["weapon speed"];
  if (typeof speed === "number" && speed > 0) o.speed = speed;
  return o;
}

export function totalsOf(assignment: Partial<Record<string, OptItem | null | undefined>> | null | undefined): PropMap {
  const t: PropMap = {};
  for (const it of Object.values(assignment || {})) if (it) for (const [k, v] of Object.entries(it.props || {})) t[k] = (t[k] || 0) + v;
  return t;
}

export interface RequirementProfileInput {
  floors?: Record<string, number> | undefined;
  caps?: Record<string, number> | undefined;
  weights?: Record<string, number> | undefined;
  mins?: Record<string, number> | undefined;   // EffectiveProfile.mins: a resist under its minimum counts as the minimum
  resistSteps?: ResistStep[] | undefined;      // EffectiveProfile.resistSteps: the minimum the suit's own Resisting Spells bonus lifts it to
}
export interface RequirementRow {
  key: string;
  label: string;
  value: number;
  floor: number | null;
  cap: number | null;
  met: boolean | null;
  capped: boolean;
  over: number;
}
// Requirement report: for every floor and every cap, what the suit reaches (a resist held at its minimum, `mins`).
export function requirementReport(totals: PropMap, profile: RequirementProfileInput): RequirementRow[] {
  const rows: RequirementRow[] = [];
  const floors = profile.floors || {}, caps = profile.caps || {};
  const keys = new Set([...Object.keys(floors), ...Object.keys(profile.weights || {})]);
  keys.delete("tagPenalty");
  for (const k of [...keys].sort((a, b) => (floors[b] ? 1 : 0) - (floors[a] ? 1 : 0) || a.localeCompare(b))) {
    // a resist under its minimum reaches the minimum, so its value says that, and `met` agrees with it
    const v = totals[k] || 0, floor = floors[k], cap = caps[k], min = liftedMin(profile, k, totals[RESIST_SKILL_KEY] || 0), held = heldTotal(v, min);
    rows.push({ key: k, label: labelOf(k), value: held, floor: floor ?? null, cap: cap ?? null,
      met: floor == null ? null : floorMet(v, floor, min), capped: cap != null && v >= cap, over: cap != null ? Math.max(0, v - cap) : 0 });
  }
  return rows;
}

// Property universe across the inventory (for the filter UI).
export function propertyKeys(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) {
    for (const k of Object.keys(it.props || {})) set.add(k);
  }
  set.delete("tagPenalty");
  return [...set].sort((a, b) => (PROP_LABELS[a] || a).localeCompare(PROP_LABELS[b] || b));
}
// Issue #133: the numeric tooltip lines no property models (parseTooltip's extras: "splintering weapon", "hit fatigue",
// "weapon speed"), skill bonuses and ranges left out, so a property filter can put a threshold on them
// (item-query.mts's colVal reads them). Apart from propertyKeys, which the Suit Builder's weights and floors list too.
export function extraKeys(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) for (const [k, v] of Object.entries(it.extras || {})) if (typeof v === "number" && !SKILL_SET.has(k)) set.add(k);
  return [...set].sort();
}
// Issue #182: the yes/no properties a filter can require (parseTooltip's flags), the ones present in the inventory.
// A flag is offered when it is a known yes/no property (ServUO's boolean item attributes, "(imbued)", "part of an armor
// set", plus the shard's item states) on any item, or when, on a piece of gear, it reads like one: one to four plain
// words, with no digits or punctuation (which rules out "set: …", "engraved: …" and "1st year veteran reward"), no
// linking word ("crafted by …", "blessed for …", "a recall rune for …") and no race lock ("gargoyles only", which the
// gargoyle switch covers). Gear only, because a resource's lines are its material ("valorite", "barbed leather"), never
// a property. Slayers have the Slayer filter, and tags (cursed, antique …) never reach the flags: parseTooltip files
// them under tags.
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["spell channeling", "mage armor", "night sight", "balanced", "use best weapon skill", "blessed", "insured", "exceptional", "reactive paralyze", "battle lust", "(imbued)", "part of an armor set"]);
const FLAG_LIKE_RE = /^[a-z]+(?: [a-z]+){0,3}$/;
const FREE_TEXT_RE = /\b(by|for|of|from|to|in|on|only)\b/;
const ARMOR_SET_RE = /^part of an armor set\b/;
// The key a flag is offered and matched under, lower-cased: every set piece's "part of an armor set (6 pieces)" is one
// "part of an armor set", whatever its piece count. A filter's own flags go through it too, so a hand-edited rule's
// "Spell Channeling" still matches.
export const flagKey = (f: string): string => {
  const k = f.toLowerCase();
  return ARMOR_SET_RE.test(k) ? "part of an armor set" : k;
};
const isPropertyFlag = (f: string, gear: boolean): boolean => !slayersOf([f]).length && (BOOLEAN_FLAGS.has(f) || (gear && FLAG_LIKE_RE.test(f) && !FREE_TEXT_RE.test(f)));
export function flagKeys(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) for (const raw of it.flags || []) { const f = flagKey(raw); if (isPropertyFlag(f, !!it.gear)) set.add(f); }
  return [...set].sort((a, b) => flagLabel(a).localeCompare(flagLabel(b)));
}
// A flag's display name, in title case with its brackets dropped: "spell channeling" reads "Spell Channeling",
// "(imbued)" "Imbued", "part of an armor set" "Part of an Armor Set".
const SMALL_WORDS = new Set(["a", "an", "the", "of", "by", "for", "in", "on", "to"]);
export const flagLabel = (f: string): string => f.replace(/[()]/g, "").trim().split(" ").map((w, i) => (i && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

// The item's own words (name, tooltip lines, rarity, kind), never where it sits: what an Organize rule's free
// text is matched against (item-query.mts's matchesItem, issue #11).
// The name once more with its punctuation as spaces, so "transcendence animal lore" finds "Scroll of Transcendence
// (Animal Lore - 0.1 Pts)" (issue #181).
const plainName = (it: Item): string => it.name.replace(/[^\p{L}\p{N}.]+/gu, " ");
export function itemOwnBlob(it: Item): string {
  return [it.name, plainName(it), ...(it.lines || []), it.rarity || "", it.kind || ""].join(" \n ").toLowerCase();
}

export function itemSearchBlob(it: Item): string {
  return [it.name, plainName(it), ...(it.lines || []), it.location?.text || "", it.rarity || "", it.kind || ""].join(" \n ").toLowerCase();
}

// Group rows by name (+kind): total pieces, stack count, and where they are.
export interface ItemGroup {
  name: string;
  kind: string;
  slot: string | null;
  amount: number;
  stacks: number;
  locations: Map<string, number>;
  items: Item[];
}
export function groupByName(items: Item[]): ItemGroup[] {
  const g = new Map<string, ItemGroup>();
  for (const it of items) {
    const key = `${it.name}|${it.kind}`;
    const row: ItemGroup = g.get(key) || { name: it.name, kind: it.kind, slot: it.slot, amount: 0, stacks: 0, locations: new Map(), items: [] };
    row.amount += it.amount || 1; row.stacks++; row.items.push(it);
    const loc = it.location?.text || "?";
    row.locations.set(loc, (row.locations.get(loc) || 0) + (it.amount || 1));
    g.set(key, row);
  }
  return [...g.values()];
}
