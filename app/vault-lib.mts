// vault-lib.mts — Pack Rat's shared kernel as one import, page and server alike: a barrel re-exporting the app/domain/ modules under the names they had here (issue #338), so no importer changed when the kernel split.
//
// Where each concept lives: domain/properties.mts (the property registry), domain/rules.mts (the shard rules, set once
// by app/rules.mts), domain/tooltip.mts, domain/slots.mts, domain/kinds.mts, domain/fold.mts (the inventory and its fold),
// domain/pools.mts (what the optimizer picks from), domain/goals.mts, domain/bridge-features.mts and domain/profile.mts.
// New code may import the domain file directly; moving the existing importers off this barrel is a later pass. Every
// domain file is browser-safe (no dependencies beyond each other and the shared modules, no DOM) and listed in
// tsconfig.browser.json's include.
//
// map: scan
// owns: the re-exports of app/domain/
import { RESIST_SKILL_KEY, RESIST_STEP_SLACK, liftedMin, type ResistStep } from "./solver/scoring.mts";
import { isPseudoCharacter, NOBODY } from "./scan-schema.mts";
export { isPseudoCharacter, NOBODY };
export { setRules, getRules } from "./domain/rules.mts";
export { type ExtraValue, type PropMap, type ExtrasMap, PROPERTIES, type PropKey, PROP_PATTERNS, PROP_LABELS, NOT_BUILDER_KEYS, PROP_FULL, typicalRange, IMPORTANCE_K, importanceOf, weightOfImportance, roundImportance, withCurrentActions, SKILL_NAMES, labelOf, fullOf, propName, goalWord, type ResistMeta, RESIST_META, RESIST_KEYS } from "./domain/properties.mts";
export { type ParsedTooltip, tagUnits, tagInfo, stackName, parseTooltip, compareNames, shownName, gameName, displayName } from "./domain/tooltip.mts";
export { type ClassifyResult, LAYER_TO_SLOT, LAYER_ALIASES, GEAR_SLOTS, type SlotGroup, GEAR_SLOT_GROUPS, SLOT_GROUP, SLOTS_IN_GROUP, NECK_ARMOR_WORDS, isNeckArmor, REQUIRED_SLOTS, SLOT_LABELS, type SpellSchool, spellSchoolOf, layerOfGraphic, classify } from "./domain/slots.mts";
export { KINDS, INSTRUMENTS, kindOf, type KindOverrides, OVERRIDE_KINDS, NO_KIND_OVERRIDES, kindNameKey, kindGraphicKey, ownKind, overriddenKind, slayersOf, medableOf } from "./domain/kinds.mts";
export { type ItemLocation, type Item, type Container, type ContainerCapacity, type Character, type ScanSummary, type Inventory, containerChain, type BlacklistEntry, foldSnapshots, TRASH_RE, containerPath, bagLabel, labelledPlaces, capacityOf, locationOf, type ItemGroup, groupByName } from "./domain/fold.mts";
export { type ItemsLike, type OptItem, type PooledOptItem, type BuildPoolsOptions, type SkippedLists, type BuildPoolsResult, buildPools, hasSkillBonus, gearSkills, builderKeys, WEAPON_SKILLS, MELEE_SKILLS, SPELLBOOKS, WEAPON_EXCLUDES, ubwsLetsIn, weaponAllowed, weaponSkillsOf, WEAPON_MUST_HAVE, isWeapon, ITEM_TYPES, type ItemType, ITEM_TYPE_LABELS, itemTypeOf, typesOfSlot, missingFlags, weaponHasFlags, weaponMustHaveError, migrateWeaponSetting, excludeWeaponsError, toOptItem, totalsOf, type RequirementProfileInput, type RequirementRow, requirementReport, propertyKeys, extraKeys, BOOLEAN_FLAGS, flagKey, flagKeys, flagLabel, itemOwnBlob, itemSearchBlob } from "./domain/pools.mts";
export { GOAL_LEFTOVERS, type GoalLeftover, SWING_GOALS, type GoalSwing, GOAL_STRATEGIES, STRICT_PROMISE, STRATEGY_HELP, TAGGED_NOTE, FEWEST_HELP, type Goals, RANK_IMPORTANCE, rankImportance, LEFTOVER_IMPORTANCE, LEFTOVER_GROUPS, LEFTOVER_LABELS, goalsActive, compileGoals, goalsText, GOAL_RANKS_MAX, GOAL_RANK_SIZE_MAX, isGoalProperty, goalsError, goalLabel, copyGoals } from "./domain/goals.mts";
export { type BridgeAction, BRIDGE_ACTION_LABELS, BRIDGE_OFFLINE, type FeatureDeclaration, type FeatureSource, newestScanAdapter, bridgeFeatures, type BridgeGate, bridgeRefusal } from "./domain/bridge-features.mts";
export { minResistAt, resistSkillOf, resistSkillCapOf, SKILL_CAP_TOP, type SuitSkill, skillInSuit, resistMinimum, resistStepsFor, rulesUpgradeNote, paperdollResist, shardResistCap, RESIST_CAP_LIMITS, type ResistCap, resistCapsFor, resistCapsError, CASTING_SCHOOLS, type RarityPreference, RARITY_PREFERENCES, type FcCap, fcCapFor, type Profile, type EffectiveProfile, type PlannedBuffs, type BuffShift, effectiveProfile, type CapsView, profileResistCaps, TEMPLATE_KEYS, type TemplateSource, type Template, templateFrom, type CharacterEntryRaw, type ProfilesFile, migrateProfiles, type RunSettings, type GoalSwingWeapon, type RunBuffs, type SettingsGroup, type SettingsChange, settingsChanges, settingsDiff, type UnsavedChange, changesList } from "./domain/profile.mts";

// The property an item's Resisting Spells skill bonus is read into ("Resisting Spells +10" on a bracelet): RESIST_SKILL_KEY,
// from app/solver/scoring.mts, re-exported here with RESIST_STEP_SLACK for the modules that read them from the kernel.
export { RESIST_SKILL_KEY, RESIST_STEP_SLACK };
// One step of the Resisting Spells minimum a suit's own bonus lifts (EffectiveProfile.resistSteps), and the minimum a
// resist is held at given the steps: app/solver/scoring.mts, re-exported here.
export { liftedMin, type ResistStep };
