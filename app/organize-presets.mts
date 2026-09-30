// organize-presets.mts — ready-made rule filters for Organize (issue #11). A preset is copied into a rule
// (ruleFromPreset), and editing the rule never changes the preset. Where two presets overlap, the rule placed
// higher wins (first match): put Shields above Weapons, Armour: neck above Necklaces, the power scroll presets
// above Spell scrolls, and a rule for spellbooks above Weapons (a spellbook sits in the one-handed slot). Pure,
// so the page can list them too.
import { emptyRuleQuery, type OrganizeRule, type RuleMatch } from "./organize-config.mts";
import type { RuleQuery } from "./item-query.mts";

export interface OrganizePreset { id: string; name: string; match: RuleMatch }

const q = (over: Partial<RuleQuery>): RuleQuery => ({ ...emptyRuleQuery(), ...over });
const kinds = (...kind: string[]): RuleMatch => ({ query: q({ kind }) });
const named = (kind: string[], names: string[]): RuleMatch => ({ query: q({ kind }), names });
const slots = (slot: string[], names?: string[]): RuleMatch => ({ query: q({ kind: ["gear"], slot }), ...(names ? { names } : {}) });
const tier = (rarity: string): RuleMatch => ({ query: q({ kind: ["gear"], rarity }) });
const ps = (level: number): OrganizePreset =>
  ({ id: `power-scrolls-${level}`, name: `Power scrolls ${level}`, match: { query: q({ kind: ["scroll"], props: [{ key: "psLevel", min: level, op: "eq" }] }) } });

export const PRESETS: readonly OrganizePreset[] = [
  { id: "magery-reagents", name: "Magery reagents", match: named(["reagent"], ["black pearl", "bloodmoss", "garlic", "ginseng", "mandrake root", "nightshade", "spiders' silk", "sulfurous ash"]) },
  { id: "necromancy-reagents", name: "Necromancy reagents", match: named(["reagent"], ["bat wing", "grave dust", "daemon blood", "nox crystal", "pig iron"]) },
  // Bone is a resource by name; limiting the kinds keeps Bone Armor (gear) out.
  { id: "mysticism-reagents", name: "Mysticism reagents", match: named(["reagent", "resource"], ["bone", "daemon bone", "dragon's blood", "fertile dirt"]) },
  ps(105), ps(110), ps(115), ps(120),
  { id: "ingots", name: "Ingots", match: named(["resource"], ["ingot"]) },
  { id: "boards", name: "Boards", match: named(["resource"], ["board"]) },
  { id: "leather", name: "Leather", match: named(["resource"], ["leather", "hide"]) },
  { id: "cloth", name: "Cloth", match: named(["resource"], ["cloth"]) },
  { id: "gems", name: "Gems", match: kinds("gem") },
  { id: "potions", name: "Potions", match: kinds("potion") },
  { id: "bandages", name: "Bandages", match: kinds("bandage") },
  { id: "spell-scrolls", name: "Spell scrolls", match: kinds("scroll") },
  { id: "runes", name: "Runes and runebooks", match: kinds("rune") },
  { id: "deeds", name: "Deeds", match: kinds("deed") },
  { id: "rings", name: "Rings", match: slots(["ring"]) },
  { id: "bracelets", name: "Bracelets", match: slots(["bracelet"]) },
  { id: "necklaces", name: "Necklaces", match: slots(["neck"]) },
  { id: "earrings", name: "Earrings", match: slots(["earrings"]) },
  { id: "talismans", name: "Talismans", match: slots(["talisman"]) },
  { id: "shields", name: "Shields", match: slots(["twoHanded"], ["shield", "buckler"]) },
  { id: "weapons", name: "Weapons", match: slots(["oneHanded", "twoHanded"]) },
  { id: "armour-head", name: "Armour: head", match: slots(["helmet"]) },
  // The neck slot holds necklaces too: armour is a gorget, a mempo, or a set piece named Armor (Armor Of Initiation).
  { id: "armour-neck", name: "Armour: neck", match: slots(["neck"], ["gorget", "mempo", "armor", "armour"]) },
  { id: "armour-chest", name: "Armour: chest", match: slots(["chest"]) },
  { id: "armour-arms", name: "Armour: arms", match: slots(["arms"]) },
  { id: "armour-hands", name: "Armour: hands", match: slots(["hands"]) },
  { id: "armour-legs", name: "Armour: legs", match: slots(["legs"]) },
  { id: "legendary-artifacts", name: "Legendary artifacts", match: tier("Legendary Artifact") },
  { id: "major-artifacts", name: "Major artifacts", match: tier("Major Artifact") },
  { id: "greater-artifacts", name: "Greater artifacts", match: tier("Greater Artifact") },
  { id: "lesser-artifacts-and-below", name: "Lesser artifacts and below", match: { query: q({ kind: ["gear"], rarityMax: "Lesser Artifact" }) } },
];

export function ruleFromPreset(preset: OrganizePreset, id: string): OrganizeRule {
  return { id, name: preset.name, match: structuredClone(preset.match), targets: [], origin: "manual" };
}
