// domain/kinds.mts — which kind every item is (reagent, potion, scroll, gem, container… everything that is not wearable gear: first rule that matches wins), the player's own kind overrides, the slayers an item's flags name, and the meditation rule a piece of gear follows.
//
// map: kinds
// owns: `KINDS`, `kindOf`, `INSTRUMENTS`, `KindOverrides`, `OVERRIDE_KINDS`, `NO_KIND_OVERRIDES`, `overriddenKind`, `kindNameKey`, `kindGraphicKey`, `slayersOf`, `medableOf`
import type { ParsedTooltip } from "./tooltip.mts";
import { isNeckArmor, isSpellScroll, PRIMER_RE, SLOTS_IN_GROUP } from "./slots.mts";

// ---------------------------------------------------------------------------
// Item kinds for everything that is not wearable gear. First match wins; names are UO base names.
// ---------------------------------------------------------------------------
export const KINDS: string[] = ["gear", "reagent", "potion", "scroll", "refinement", "resource", "gem", "ammo", "food", "crafting", "tool", "bandage", "currency", "map", "book", "rune", "deed", "container", "key", "clothing", "decor", "quest", "other"];
const CONTAINER_RE = /\b(bag|pouch|box|chest|crate|backpack|basket|trunk|armoire|cabinet|quiver)\b/i;
const notContainer = (rx: RegExp): RegExp => new RegExp(`^(?!.*${CONTAINER_RE.source}).*${rx.source}`, "i");
const KIND_RULES: Array<[string, RegExp]> = [
  ["reagent", /\b(black pearl|bloodmoss|blood moss|garlic|ginseng|mandrake|nightshade|spiders?'? ?silk|sulfurous ash|bat ?wing|grave dust|daemon blood|nox crystal|pig iron|dragon'?s blood|fertile dirt|reagent)\b/i],
  ["potion", /\b(potion|keg|elixir|balm|salve|lotion)\b/i],
  ["bandage", /\bbandage/i],
  ["currency", /\b(gold coin|gold|doubloon|silver|token|coin|check|bank check)\b/i],
  ["resource", /\bblank scrolls?\b/i],   // Inscription's and Cartography's material, not a scroll to file
  ["scroll", /\b(scroll|powerscroll|scroll of)\b/i],
  // A message in a bottle and the SOS inside it go with the treasure maps (ahead of "bottle", a resource).
  ["map", /\b(map|message in a bottle|sos)\b/i],
  ["rune", /\b(rune|runebook|runic atlas|moonstone)\b/i],
  ["book", /\b(book|tome|journal|primer|compendium|guide)\b/i],
  ["deed", /\b(deed|commodity|certificate|voucher|ticket)\b/i],
  ["key", /\b(key|keyring|key ring)\b/i],
  // Issue #150: ahead of the resources ("fragment"), food (Easter egg, flour sifter), gems (crystal vase) and tools;
  // a container stays one (Trick Or Treat Bag, Trophy Chest), and an ethereal mount's statuette is decor.
  ["quest", notContainer(/\b(mysterious fragment|quest|keepsakes?|memento|souvenir|halloween|christmas|easter|valentine'?s?|thanksgiving|holiday|trick or treat|anniversary|commemorative)\b/)],
  ["decor", notContainer(/\b(statuettes?|statues?|figurines?|sculptures?|bust|paintings?|portraits?|picture|tapestry|banners?|flags?|trophy|mounted|rugs?|carpets?|potted plant|flower ?pot|bonsai|vases?|urns?|lamps?(?! oil)|lanterns?|candles?|candelabrum|candelabra|chandelier|sconce|brazier|decorative|ornaments?|wreath|garland|globe|fountain|mirror|wall hanging)\b/)],
  // The tools a crafting menu opens from, and the stations; gathering tools, scissors and instruments stay tools.
  ["crafting", /\b(hammer|tongs|sewing kit|tinker'?s tools|tool kit|mortar|pestle|fletcher'?s tools|saw|jointing plane|moulding planes?|smoothing plane|draw knife|froe|inshave|scorp|pen|rolling pin|flour sifter|skillet|blowpipe|mallet and chisel|loom|spinning wheel|anvil|forge)\b/i],
  ["gem", /\b(diamond|ruby|sapphire|star sapphire|emerald|amethyst|citrine|tourmaline|amber|gem|gems|jewel)\b/i],
  ["ammo", /\b(arrow|arrows|bolts?(?!\s+of\b)|crossbow bolt|shuriken|fukiya dart|throwing)\b/i],
  ["resource", /\b(ingot|ingots|ore|log|logs|board|boards|leather|hides|hide|cloth|bolt of cloth|yarn|thread|feather|feathers|shaft|shafts|cotton|wool|flax|kindling|granite|sand|bone|bones|scale|scales|blank map|fabric|silk|pelt|fur|resin|sap|bark|wood|essence|powder|dust|crystal|shard|fragment|ectoplasm|glass|bottle|bottles|empty bottle|jar|nails|hinge|gear|axle|springs?|clock parts|clock frames?|sextant parts|barrel|pile of|stack of|bundle)\b/i],
  ["food", /\b(fish|steak|steaks|bread|cheese|apple|apples|meat|ham|egg|eggs|cake|pie|ribs|sausage|bacon|wine|ale|beer|liquor|milk|water|pitcher|cookie|cookies|grapes|pear|peach|banana|carrot|onion|cabbage|lettuce|pumpkin|squash|watermelon|honey|cooked|raw|muffin|chicken|lamb|bird|turkey|fruit|vegetable|dough|flour|jerky|stew|soup|candy|pretzel)\b/i],
  // A conjured Healing Stone (Mysticism) is used up like a tool; on a scroll graphic it is the spell (isSpellScroll).
  ["tool", /\b(pickaxe|shovel|scissors|skinning knife|lockpick|lockpicks|ink|fishing pole|tool|tools|axe|pick|healing stone)\b/i],
  ["container", CONTAINER_RE],
  ["clothing", /\b(shirt|doublet|surcoat|tunic|dress|gown|kilt|skirt|sash|apron|robe|cloak|hat|cap|bandana|bonnet|boots|sandals|shoes|thigh boots|gloves|half apron|body sash|obi|kimono|hakama|jin-?baori)\b/i],
];
const REFINEMENT_RE = /\b(wash|varnish|polish|cure|gloss|scour|lacquer|resin) of (defense|protection|hardening|fortification|invulnerability)\b/i;
// The bard's instruments are tools (issue #129), told by whole words so Harpy Wing, Absolute… or Hard Rum never are one;
// Organize's Instruments preset names the same words.
export const INSTRUMENTS: readonly string[] = ["drum", "tambourine", "harp", "lute", "flute", "fire horn", "cello", "trumpet", "cowbell"];
const INSTRUMENT_RE = new RegExp(`\\b(${INSTRUMENTS.join("|")})s?\\b`, "i");
export function kindOf(name: string | null | undefined, parsed?: ParsedTooltip | null | undefined, graphic?: number | null | undefined): string {
  const n = name || "";
  if (isSpellScroll(n, graphic)) return "scroll";
  if (PRIMER_RE.test(n)) return "book";
  if (REFINEMENT_RE.test(n)) return "refinement";
  if (INSTRUMENT_RE.test(n)) return "tool";
  for (const [kind, rx] of KIND_RULES) if (rx.test(n)) return kind;
  const hasProps = parsed && Object.keys(parsed.props || {}).some((k) => k !== "tagPenalty");
  return hasProps ? "gear" : "other";
}

// The player's own kinds (issue #150): <data>/item-kinds.json maps an exact item name (compared trimmed and lower-cased)
// or a graphic ("0x" and lower-case hex) to one of KINDS, and app/item-kinds.mts reads and checks it. They sit over the
// table above rather than copy it, so a better shipped table still reaches a player who has some. A name beats a graphic,
// and neither ever applies to gear (enrich asks only for a non-gear kind, and "gear" is never an override's kind).
export interface KindOverrides { names: Record<string, string>; graphics: Record<string, string> }
// The kinds a player may pick: never gear, and never container, which Organize leaves out of every move (organize.mts),
// so an item made one would leave Organize for good.
export const OVERRIDE_KINDS: readonly string[] = KINDS.filter((k) => k !== "gear" && k !== "container");
export const NO_KIND_OVERRIDES: KindOverrides = { names: {}, graphics: {} };
export const kindNameKey = (name: string): string => name.trim().toLowerCase();
export const kindGraphicKey = (graphic: number): string => `0x${graphic.toString(16)}`;
// One map's entry, own properties only: the maps come from a file, and "constructor" must not read Object's.
export const ownKind = (map: Record<string, string>, key: string): string | null => (Object.hasOwn(map, key) ? map[key]! : null);
export function overriddenKind(o: KindOverrides, name: string | null | undefined, graphic: number | null | undefined): string | null {
  return ownKind(o.names, kindNameKey(name || "")) ?? (graphic != null ? ownKind(o.graphics, kindGraphicKey(graphic)) : null);
}

// Slayer lines are plain flags: "Orc Slayer", "Silver" (= undead), the super slayers "Repond" (humanoid),
// "Exorcism" (demon/gargoyle), "Elemental Ban", plus the odd classic names. Returns display names.
const SLAYER_ALIASES: Record<string, string> = { silver: "Undead (Silver)", repond: "Repond (humanoids)", exorcism: "Exorcism (demons)", "elemental ban": "Elemental Ban", "elemental health": "Elemental Health",
  "dragon slaying": "Dragon", "orc slaying": "Orc", "troll slaughter": "Troll", "lizardman slaughter": "Lizardman", "flame dousing": "Fire Elemental", "water dissipation": "Water Elemental",
  "vacuum": "Air Elemental", "earth shatter": "Earth Elemental", "blood drinking": "Blood Elemental", "summer wind": "Snow Elemental", "snake's bane": "Snake", "scorpion's bane": "Scorpion",
  "spider's death": "Spider", "terathan": "Terathan", "ophidian": "Ophidian", "balron damnation": "Balron", "gargoyle's foe": "Gargoyle", "fey slayer": "Fey" };
export function slayersOf(flags: string[] | null | undefined): string[] {
  const out = [];
  for (const f of flags || []) {
    const m = f.match(/^(.+?) slayer$/);
    if (m) { out.push(m[1]!.replace(/\b\w/g, (c) => c.toUpperCase())); continue; }
    if (SLAYER_ALIASES[f]) out.push(SLAYER_ALIASES[f]!);
  }
  return out;
}

// Meditation rule (ServUO): armour materials with MeditationAllowance None/Half block or halve mana regen unless the
// piece has Mage Armor; a held weapon or shield blocks it unless Spell Channeling (spellbooks are fine). Jewellery,
// cloaks, talismans and cloth never interfere: in the neck slot only a piece isNeckArmor names is armor, so a
// Gold Necklace or Gold Beads is never read as gold armor. The slots a material can block are the Armor group and the
// clothing worn on the body (a robe, tunic, shirt, belt, boots or kilt can be leather or metal): every one but the cloak.
const ARMOR_SLOT_SET = new Set([...SLOTS_IN_GROUP.Armor, ...SLOTS_IN_GROUP.Clothing.filter((s) => s !== "cloak")]);
// material words that always block meditation (platemail, chain, bone, studded …)
const NONMED_RE = /\b(platemail|plate|chainmail|chain|ringmail|bone|dragon|woodland|studded|metal|stone|verite|valorite|agapite|bronze|copper|shadow iron|dull copper|gold|scale)\b/i;
// material words that mean leather/cloth (meditation allowed) — checked before the helm list
const MED_MATERIAL_RE = /\b(leather|hide|leaf|cloth|straw|silk|fur|skullcap|bandana|bonnet|hood|mask|hat|cap|robe|sash|apron|doublet|shirt|tunic|skirt|kilt|sandals|boots|shoes|circlet|glasses|goggles|shroud|tabi|bustier)\b/i;
// metal helms whose names carry no material word
const METAL_HELM_RE = /\b(norse helm|close helm|close helmet|helmet|helm|bascinet|kabuto|hatsuburi|jingasa|coif)\b/i;
export function medableOf(name: string, slot: string | null | undefined, gear: boolean, flags: string[] | null | undefined): boolean {
  if (!gear) return true;
  const f = flags || [];
  if (slot === "oneHanded" || slot === "twoHanded") {
    if (/\b(spellbook|book of|tome)\b/i.test(name)) return true;
    return f.includes("spell channeling");
  }
  if (!ARMOR_SLOT_SET.has(slot as string)) return true;
  if (slot === "neck" && !isNeckArmor(name)) return true;
  if (f.includes("mage armor")) return true;
  if (NONMED_RE.test(name)) return false;
  if (MED_MATERIAL_RE.test(name)) return true;
  if (METAL_HELM_RE.test(name)) return false;
  return true;
}
