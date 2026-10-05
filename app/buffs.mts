// buffs.mts — the Suit Builder's buffs, abilities and forms (issue #12): a catalog, as data, of what a spell, a form,
// a mastery or a potion adds to a suit's totals, and applyBuffs, a pure evaluator that shows a suit "with Divine Fury
// on" or "in Reaper Form". Only the effects rated high confidence ship. Each entry cites its source: a ServUO file
// (under Scripts/) or the UO Alive wiki, which wins where the two disagree. No DOM: Manual (ui/builder-manual.mts)
// and Automatic read the same model, and app/buffs.test.mts checks it.
import { RESIST_KEYS, resistSkillBonus, labelOf } from "./vault-lib.mts";
import type { PropMap } from "./vault-lib.mts";

// ---------------------------------------------------------------- the numbers a buff scales with
// A skill, by the scan's name for it (a character's own value is the highest of `skills`), or a value no scan carries
// (karma, an Arcane Focus level, a mastery level). `def` is used with no character, and for a skill the character
// lacks. Edited values are kept within min..max, and whole for an `int` input.
export interface BuffInput { label: string; skills: string[]; min: number; max: number; def: number; int?: true }
const skill = (name: string, label = name): BuffInput => ({ label, skills: [name], min: 0, max: 150, def: 120 });
export const BUFF_INPUTS: Record<string, BuffInput> = {
  Chivalry: skill("Chivalry"),
  Karma: { label: "Karma", skills: [], min: -15000, max: 15000, def: 15000, int: true },
  Necromancy: skill("Necromancy"),
  "Spirit Speak": skill("Spirit Speak"),
  Spellweaving: skill("Spellweaving"),
  "Arcane Focus": { label: "Arcane Focus", skills: [], min: 0, max: 6, def: 0, int: true },
  "Evaluating Intelligence": skill("Evaluating Intelligence", "Eval Int"),
  Inscription: skill("Inscription"),
  Mysticism: skill("Mysticism"),
  "Focus or Imbuing": { label: "Focus or Imbuing", skills: ["Focus", "Imbuing"], min: 0, max: 150, def: 120 },
  Ninjitsu: skill("Ninjitsu"),
  Bushido: skill("Bushido"),
  Musicianship: skill("Musicianship"),
  Provocation: skill("Provocation"),
  Peacemaking: skill("Peacemaking"),
  Discordance: skill("Discordance"),
  Swordsmanship: skill("Swordsmanship", "Swords"),
  "Mace Fighting": skill("Mace Fighting", "Mace"),
  Tactics: skill("Tactics"),
  "Mastery level": { label: "Mastery level", skills: [], min: 1, max: 3, def: 3, int: true },
  Alchemy: skill("Alchemy"),
};
// The picker's groups, in order, each with the numbers its entries scale with.
export const BUFF_GROUPS: Array<{ name: string; inputs: string[] }> = [
  { name: "Chivalry", inputs: ["Chivalry", "Karma"] },
  { name: "Necromancy", inputs: ["Necromancy", "Spirit Speak"] },
  { name: "Spellweaving", inputs: ["Spellweaving", "Arcane Focus"] },
  { name: "Magery", inputs: ["Evaluating Intelligence", "Inscription"] },
  { name: "Mysticism", inputs: ["Mysticism", "Focus or Imbuing"] },
  { name: "Ninjitsu", inputs: ["Ninjitsu"] },
  { name: "Bushido", inputs: ["Bushido"] },
  { name: "Bard masteries", inputs: ["Musicianship", "Provocation", "Peacemaking", "Discordance"] },
  { name: "Other masteries", inputs: ["Swordsmanship", "Mace Fighting", "Tactics", "Mastery level"] },
  { name: "Potions", inputs: ["Alchemy"] },
  { name: "Racial", inputs: [] },
];
// The exclusive sets: turning one on turns the other off, and the picker says why.
export const EXCLUSIVE: Record<string, string> = {
  form: "One form at a time across Necromancy, Spellweaving, Mysticism and Ninjitsu.",
  enchant: "One Enchant at a time: it puts one hit spell on the weapon.",
};

// ---------------------------------------------------------------- the catalog
// A stat's maximum with every bonus: item and buff bonuses take a stat past its natural 125, up to 150
// (Server/Mobile.cs PlayerCaps.StrMaxCap, DexMaxCap, IntMaxCap, each 150; Mobiles/PlayerMobile.cs Str holds to it).
export const STAT_MAX = 150;
// Raw stats: the character's own points, without item or buff bonuses (Bless takes a share of them).
export interface Stats { str: number; dex: number; int: number }
export type Skills = Record<string, number>;
// What an entry's numbers are worked out from: an input's value, the raw stats (null with no character) and the
// suit's own totals (a potion reads the suit's Enhance Potions). `resist` is the character's Resisting Spells, or null.
// `who` is what the evaluator knows beyond the numbers: the character's race and the held weapon's flags.
export interface BuffWho { race?: string | null | undefined; weaponFlags?: readonly string[] | undefined }
export interface BuffContext { s: (input: string) => number; stats: Stats | null; totals: PropMap; resist: number | null; who: BuffWho }
// One effect. `outside`: added after the cap (Enemy of One's damage), so it never counts toward it. `slot`: a stat
// buff that shares its stat with others, the largest counting (Bless, the potions). `pct`: a share of the raw stat,
// kept so the page can say "+13%" when there is no character to take it of.
export interface BuffEffect { key: string; value: number; outside?: boolean | undefined; slot?: boolean | undefined; pct?: number | undefined }
export interface Buff {
  id: string;
  name: string;
  group: string;
  inputs: string[];                       // what its numbers scale with; the first is named on its chip
  race?: string;                          // a racial passive: only that race has it
  excl?: keyof typeof EXCLUSIVE;
  min?: [string, number];                 // the skill it takes to cast
  effects: (c: BuffContext) => BuffEffect[];
  caps?: (c: BuffContext) => PropMap;     // cap changes, applied before any effect
  extra?: (c: BuffContext) => string[];   // what it does that no total shows
  note?: string;
}

const tr = Math.trunc;
const fx = (v: number): number => tr(v * 10);   // ServUO's Skills[x].Fixed
const resists = (value: number, keys = RESIST_KEYS): BuffEffect[] => keys.map((key) => ({ key, value }));
// Bless and its kin: ceil(raw stat × (1 + EvalFixed / 100)%), in ServUO's own double math (SpellHelper.GetOffset).
function statShare(key: string, raw: number | undefined, pct: number): BuffEffect {
  return { key, slot: true, pct, value: raw == null ? 0 : Math.ceil(raw * (pct * 0.01)) };
}
const blessPct = (c: BuffContext): number => 1 + tr(fx(c.s("Evaluating Intelligence")) / 100);
// A potion's offset scaled by Enhance Potions: the suit's (at most 50) plus 10 per 33 Alchemy (BasePotion.cs EnhancePotions, AOS.Scale).
const potion = (c: BuffContext, offset: number): number => tr((offset * (100 + Math.min(c.totals.enhancePotions || 0, 50) + tr(fx(c.s("Alchemy")) / 330) * 10)) / 100);
// A bard song's numbers (BardSpells/BardSpell.cs): BaseSkillBonus from the casting skill and Musicianship, and the
// collective bonus from each other bard skill at 100 or more.
const BARD = ["Provocation", "Peacemaking", "Discordance"];
// A song's inputs: its casting skill first (named on its chip), then Musicianship and the other two.
const bardInputs = (cast: string): string[] => [cast, "Musicianship", ...BARD.filter((b) => b !== cast)];
function bard(c: BuffContext, cast: string): { base: number; coll: number } {
  const base = Math.floor(2 + (c.s(cast) - 90) / 10 + (c.s("Musicianship") - 90) / 10);
  const coll = BARD.filter((b) => b !== cast && c.s(b) >= 100).reduce((n, b) => n + 1 + (c.s(b) - 100) / 10, 0);
  return { base, coll };
}
const MYST = ["Mysticism", "Focus or Imbuing"];
const mystSum = (c: BuffContext): number => tr(c.s("Mysticism")) + tr(c.s("Focus or Imbuing"));

const ENCHANTS: Array<[string, string]> = [["hitLightning", "Lightning"], ["hitFireball", "Fireball"], ["hitHarm", "Harm"], ["hitMagicArrow", "Magic Arrow"], ["hitDispel", "Dispel"]];

export const BUFFS: Buff[] = [
  // Chivalry. Divine Fury: Spells/Chivalry/DivineFury.cs (the top tier at 120 Chivalry and 10,000 karma; wiki Divine_Fury).
  { id: "divineFury", name: "Divine Fury", group: "Chivalry", inputs: ["Chivalry", "Karma"],
    effects: (c) => {
      const top = c.s("Chivalry") >= 120 && c.s("Karma") >= 10000;
      return [{ key: "hci", value: top ? 15 : 10 }, { key: "di", value: top ? 20 : 10 }, { key: "ssi", value: top ? 15 : 10 }, { key: "dci", value: top ? -10 : -20 }];
    },
    note: "Below Chivalry 120 and 10,000 karma it is the flat tier: HCI +10 · DI +10 · SSI +10 · DCI −20" },
  // Consecrate Weapon: ConsecrateWeapon.cs ConsecrateDamageBonus, added to BaseWeapon's percentageBonus, past the DI cap.
  { id: "consecrateWeapon", name: "Consecrate Weapon", group: "Chivalry", inputs: ["Chivalry"],
    effects: (c) => [{ key: "di", value: c.s("Chivalry") >= 90 ? tr((c.s("Chivalry") - 90) / 2) : 0, outside: true }],
    extra: () => ["hits the lowest resist"] },
  // Enemy of One: EnemyOfOne.cs UpdateDamage (10 + (Chivalry − 40) × 9 / 10), past the DI cap; wiki Enemy_of_One.
  { id: "enemyOfOne", name: "Enemy of One", group: "Chivalry", inputs: ["Chivalry"],
    effects: (c) => [{ key: "di", value: 10 + tr(((tr(c.s("Chivalry")) - 40) * 9) / 10), outside: true }],
    extra: () => ["against one creature type"], note: "You take double damage from everything else" },

  // Necromancy forms: the resist offsets in Spells/Necromancy/<Form>.cs, the regeneration in Misc/RegenRates.cs.
  { id: "wraithForm", name: "Wraith Form", group: "Necromancy", inputs: ["Necromancy", "Spirit Speak"], excl: "form", min: ["Necromancy", 20],
    effects: () => [{ key: "physResist", value: 15 }, { key: "fireResist", value: -5 }, { key: "energyResist", value: -5 }],
    extra: (c) => [`${tr(c.s("Spirit Speak") / 5)}% mana leech`] },   // Misc/AOS.cs DoLeech: Spirit Speak / 5
  // Lich Form: LichForm.cs; MR +13 in RegenRates.cs; its HP drain (LichForm.cs OnTick) is no HPR, so it is said only.
  { id: "lichForm", name: "Lich Form", group: "Necromancy", inputs: ["Necromancy"], excl: "form", min: ["Necromancy", 70],
    effects: () => [{ key: "fireResist", value: -10 }, { key: "coldResist", value: 10 }, { key: "poisonResist", value: 10 }, { key: "manaRegen", value: 13 }],
    extra: () => ["drains 1 HP every 2 s"] },
  // Vampiric Embrace: VampiricEmbrace.cs; SR +15 and MR +3 in RegenRates.cs; 20% life leech in AOS.cs DoLeech.
  { id: "vampiricEmbrace", name: "Vampiric Embrace", group: "Necromancy", inputs: ["Necromancy"], excl: "form", min: ["Necromancy", 99],
    effects: () => [{ key: "fireResist", value: -25 }, { key: "stamRegen", value: 15 }, { key: "manaRegen", value: 3 }],
    extra: () => ["20% life leech"], note: "No cure potions while in it" },
  // Horrific Beast: HPR +20 after the 18 cap (RegenRates.cs HitPointRegen), DI +25 (AOS.cs WeaponDamage).
  { id: "horrificBeast", name: "Horrific Beast", group: "Necromancy", inputs: ["Necromancy"], excl: "form", min: ["Necromancy", 40],
    effects: () => [{ key: "di", value: 25 }, { key: "hpRegen", value: 20, outside: true }], note: "Blocks every spell that is not a form" },

  // Reaper Form: Spells/Spellweaving/ReaperForm.cs. SSI is the wiki's 5 + focus (Reaper_Form); the code says 10 + focus.
  { id: "reaperForm", name: "Reaper Form", group: "Spellweaving", inputs: ["Spellweaving", "Arcane Focus"], excl: "form", min: ["Spellweaving", 24],
    effects: (c) => {
      const f = c.s("Arcane Focus");
      return [{ key: "ssi", value: 5 + f }, { key: "sdi", value: 10 + f }, ...resists(5 + f, RESIST_KEYS.filter((k) => k !== "fireResist")), { key: "fireResist", value: -25 }];
    },
    note: "Can't ride. SSI: the shard wiki says 5, ServUO's code 10; this counts 5. Each Arcane Focus level adds 1" },

  // Magery. Bless, Strength, Agility, Cunning: SpellHelper.GetOffset, one "[Magic] <stat> Buff" per stat, the largest kept (AddStatBonus).
  { id: "bless", name: "Bless", group: "Magery", inputs: ["Evaluating Intelligence"],
    effects: (c) => [statShare("strBonus", c.stats?.str, blessPct(c)), statShare("dexBonus", c.stats?.dex, blessPct(c)), statShare("intBonus", c.stats?.int, blessPct(c))] },
  { id: "strength", name: "Strength", group: "Magery", inputs: ["Evaluating Intelligence"], effects: (c) => [statShare("strBonus", c.stats?.str, blessPct(c))] },
  { id: "agility", name: "Agility", group: "Magery", inputs: ["Evaluating Intelligence"], effects: (c) => [statShare("dexBonus", c.stats?.dex, blessPct(c))] },
  { id: "cunning", name: "Cunning", group: "Magery", inputs: ["Evaluating Intelligence"], effects: (c) => [statShare("intBonus", c.stats?.int, blessPct(c))] },
  // Protection: Spells/Second/Protection.cs (Phys and Resisting Spells by Inscription / 20); FC −2 after the cap
  // (Spell.cs GetCastDelay). Resisting Spells lower means a smaller resist bonus on UO Alive (rules resistSkillBonus).
  { id: "protection", name: "Protection", group: "Magery", inputs: ["Inscription"],
    effects: (c) => {
      const i = tr(c.s("Inscription") / 20), rs = c.resist, loss = -35 + Math.min(i, 35);
      const bonus = (v: number): number => resistSkillBonus({ "Resisting Spells": { value: v } });
      const drop = rs == null ? 0 : bonus(Math.max(0, rs + loss)) - bonus(rs);
      const all = drop ? resists(drop) : [];
      return [{ key: "physResist", value: -15 + Math.min(i, 15) }, ...all, { key: "fc", value: -2, outside: true }];
    },
    extra: (c) => [`Resisting Spells ${signed(-35 + Math.min(tr(c.s("Inscription") / 20), 35))}`] },
  // Reactive Armor: Spells/First/ReactiveArmor.cs.
  { id: "reactiveArmor", name: "Reactive Armor", group: "Magery", inputs: ["Inscription"],
    effects: (c) => [{ key: "physResist", value: 15 + tr(c.s("Inscription") / 20) }, ...resists(-5, RESIST_KEYS.filter((k) => k !== "physResist"))] },

  // Stone Form: Spells/Mysticism/SpellDefinitions/StoneForm.cs (GetResBonus, GetMaxResistance); FC −2 and SSI −10 in
  // AOS.cs. Its melee damage bonus is left out: the code and the buff text disagree.
  { id: "stoneForm", name: "Stone Form", group: "Mysticism", inputs: MYST, excl: "form", min: ["Mysticism", 33],
    effects: (c) => [...resists(Math.max(2, tr(mystSum(c) / 24))), { key: "ssi", value: -10 }, { key: "fc", value: -2 }],
    caps: (c) => Object.fromEntries(RESIST_KEYS.map((k) => [k, Math.max(2, tr(mystSum(c) / 48))])),
    note: "No cap raise while wearing refined armor" },
  // Enchant: EnchantSpell.cs, 60 × (Mysticism + Focus or Imbuing) / 240, and Spell Channeling with FC −1 at 80 and 80
  // when the weapon lacks it (a weapon that has it keeps its own, and its own FC −1 is in the suit already).
  ...ENCHANTS.map(([key, spell]): Buff => ({ id: `enchant.${key}`, name: `Enchant: Hit ${spell}`, group: "Mysticism", inputs: MYST, excl: "enchant",
    effects: (c) => [{ key, value: tr((60 * mystSum(c)) / 240) }, ...(c.s("Mysticism") >= 80 && c.s("Focus or Imbuing") >= 80 && !c.who.weaponFlags?.includes("spell channeling") ? [{ key: "fc", value: -1 }] : [])],
    note: "On a weapon with no hit spell. At 80 in both skills it also gains Spell Channeling (FC −1)" })),

  // Ninjitsu. Animal Form: HCI +20 (AOS.cs) and Hits +20 after the HPI cap (PlayerMobile.cs HitsMax); wiki Animal_Form (85).
  { id: "wolfKitsune", name: "Animal Form: Wolf or Bake Kitsune", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form", min: ["Ninjitsu", 85],
    effects: () => [{ key: "hci", value: 20 }, { key: "hitsPool", value: 20 }] },
  // Ki-Rin: SR +20 (RegenRates.cs).
  { id: "kirin", name: "Animal Form: Ki-Rin", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form", min: ["Ninjitsu", 100],
    effects: () => [{ key: "stamRegen", value: 20 }] },
  // White Tiger Form: DCI +20 (Core/SkillMasterySpell.cs), DCI cap +5 (WhiteTigerForm.cs; wiki The_Ninja).
  { id: "whiteTiger", name: "White Tiger Form", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form",
    effects: () => [{ key: "dci", value: 20 }], caps: () => ({ dci: 5 }), note: "Ninjitsu mastery. Spells and weapon specials still work in it on UO Alive" },

  // Honorable Execution: Spells/Bushido/HonorableExecution.cs, max(1, Bushido² / 720) after a kill.
  { id: "honorableExecution", name: "Honorable Execution", group: "Bushido", inputs: ["Bushido"],
    effects: (c) => [{ key: "ssi", value: Math.max(1, tr((c.s("Bushido") * c.s("Bushido")) / 720)) }], note: "For 20 s after a kill" },

  // Bard masteries: Spells/Skill Masteries/BardSpells/<Song>.cs. Each is a party song, so another bard's skills count.
  // Every song scales with all four bard skills (the other two give the collective bonus), so a song whose bard lacks
  // one of them is planned, the lacking skill's field showing the 120 it is counted at.
  { id: "inspire", name: "Inspire", group: "Bard masteries", inputs: bardInputs("Provocation"), min: ["Provocation", 90],
    effects: (c) => { const { base, coll } = bard(c, "Provocation"); return [{ key: "hci", value: tr(base * 2 + coll) }, { key: "sdi", value: tr(base * 2 + coll) }, { key: "di", value: tr(base * 5 + coll * 3) }]; },
    note: "Provocation mastery" },
  { id: "invigorate", name: "Invigorate", group: "Bard masteries", inputs: bardInputs("Provocation"), min: ["Provocation", 90],
    effects: (c) => { const { base, coll } = bard(c, "Provocation"), st = tr(base + coll); return [{ key: "strBonus", value: st }, { key: "dexBonus", value: st }, { key: "intBonus", value: st }, { key: "hitsPool", value: tr(2.5 * base + coll) }]; },
    note: "Its own stat slot, so it adds on top of Bless and potions. Provocation mastery" },
  { id: "resilience", name: "Resilience", group: "Bard masteries", inputs: bardInputs("Peacemaking"), min: ["Peacemaking", 90],
    effects: (c) => { const { base, coll } = bard(c, "Peacemaking"), v = tr(base * 2 + coll); return [{ key: "hpRegen", value: v }, { key: "stamRegen", value: v }, { key: "manaRegen", value: v }]; },
    note: "Peacemaking mastery" },
  { id: "perseverance", name: "Perseverance", group: "Bard masteries", inputs: bardInputs("Peacemaking"), min: ["Peacemaking", 90],
    effects: (c) => { const { base, coll } = bard(c, "Peacemaking"); return [{ key: "dci", value: tr(base * 3 + coll) }, { key: "castingFocus", value: tr(base / 2 + coll / 3) }]; },
    note: "Peacemaking mastery" },

  // Other masteries: Spells/Skill Masteries/FocusedEye.cs, Toughness.cs, Core/MasteryInfo.cs (Intuition, Saving Throw).
  { id: "focusedEye", name: "Focused Eye", group: "Other masteries", inputs: ["Swordsmanship", "Tactics", "Mastery level"],
    effects: (c) => [{ key: "hci", value: tr((c.s("Swordsmanship") + c.s("Tactics") + 40 * c.s("Mastery level")) / 12) }], note: "Swordsmanship mastery" },
  { id: "toughness", name: "Toughness", group: "Other masteries", inputs: ["Mace Fighting", "Tactics", "Mastery level"],
    effects: (c) => [{ key: "hitsPool", value: tr((c.s("Mace Fighting") + c.s("Tactics") + 40 * c.s("Mastery level")) / 3 / 4) }], note: "Mace Fighting mastery" },
  { id: "intuition", name: "Intuition (passive)", group: "Other masteries", inputs: ["Mastery level"],
    effects: (c) => [{ key: "manaPool", value: 5 * c.s("Mastery level") }], note: "Bushido, Ninjitsu or Chivalry mastery" },
  { id: "savingThrow", name: "Saving Throw (passive)", group: "Other masteries", inputs: ["Mastery level"],
    // STR +5 at every level: MasteryInfo.cs:311 adds the "SavingThrow_Str" stat mod whatever the level
    effects: (c) => { const l = c.s("Mastery level"); return [{ key: "hci", value: 5 }, { key: "dci", value: l >= 2 ? 5 : 0 }, { key: "strBonus", value: 5 }, { key: "di", value: l >= 3 ? 5 : 0 }]; },
    note: "A weapon-skill mastery" },

  // Potions: Items/Consumables/Base{Strength,Agility}Potion.cs, the same "[Magic] <stat> Buff" as Bless.
  { id: "strengthPotion", name: "Strength potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "strBonus", value: potion(c, 10), slot: true }] },
  { id: "greaterStrengthPotion", name: "Greater Strength potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "strBonus", value: potion(c, 20), slot: true }] },
  { id: "agilityPotion", name: "Agility potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "dexBonus", value: potion(c, 10), slot: true }] },
  { id: "greaterAgilityPotion", name: "Greater Agility potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "dexBonus", value: potion(c, 20), slot: true }] },

  // Racial: the Human's +2 HPR, inside the 18 cap (RegenRates.cs; wiki Humans). The Elf's Energy cap is the rules
  // file's raceCaps and its +20 mana is in the scanned maximum already, so the Elf has no entry.
  { id: "human", name: "Human: Tough", group: "Racial", inputs: [], race: "human", effects: () => [{ key: "hpRegen", value: 2 }] },
];
export const BUFF_IDS: string[] = BUFFS.map((b) => b.id);
const BY_ID = new Map(BUFFS.map((b) => [b.id, b]));
export const buffById = (id: string): Buff | undefined => BY_ID.get(id);

// ---------------------------------------------------------------- the inputs' values
// Each input's value for a character's skills (the scan's {value} entries, or null for No character) and the
// player's edits: an edit, else the character's own skill, else the default. An input is planned when it is
// edited, or when the character lacks the skill (absent or 0). `Resisting Spells` is the character's own (Protection
// lowers it), never an input.
export function buffSkillValues(charSkills: Record<string, unknown> | null, edits: Readonly<Record<string, number>>): { values: Skills; planned: Set<string> } {
  const values: Skills = {}, planned = new Set<string>();
  const own = (name: string): number => Number((charSkills?.[name] as { value?: unknown } | undefined)?.value) || 0;
  for (const [id, input] of Object.entries(BUFF_INPUTS)) {
    const mine = input.skills.length ? Math.max(...input.skills.map(own)) : 0;
    if (Object.hasOwn(edits, id)) { values[id] = edits[id]!; planned.add(id); continue; }
    if (charSkills && input.skills.length && !mine) planned.add(id);
    values[id] = charSkills && mine ? mine : input.def;
  }
  if (charSkills?.["Resisting Spells"] != null) values["Resisting Spells"] = own("Resisting Spells");
  return { values, planned };
}
export const buffContext = (skills: Skills, stats: Stats | null, totals: PropMap, who: BuffWho = {}): BuffContext =>
  ({ s: (id) => skills[id] ?? BUFF_INPUTS[id]?.def ?? 0, stats, totals, resist: skills["Resisting Spells"] ?? null, who });
// Why an entry can't count, or null: below the skill it takes ("Needs Necromancy 70"), or another race's passive
// ("Humans only"; with no character every race's is open).
export function buffNeeds(b: Buff, skills: Skills, who: BuffWho = {}): string | null {
  if (b.race && who.race && who.race !== b.race) return `${b.race[0]!.toUpperCase()}${b.race.slice(1)}s only`;
  if (!b.min) return null;
  const [id, at] = b.min;
  return (skills[id] ?? BUFF_INPUTS[id]!.def) < at ? `Needs ${BUFF_INPUTS[id]!.label} ${at}` : null;
}

// ---------------------------------------------------------------- toggling
// Turns `id` on or off. On, it replaces any entry of its exclusive set (one form at a time), named in `replaced`.
// The list stays in catalog order, so two lists with the same entries are equal.
export function toggleBuff(active: readonly string[], id: string): { next: string[]; replaced: string | null } {
  const b = BY_ID.get(id);
  if (!b) return { next: [...active], replaced: null };
  if (active.includes(id)) return { next: active.filter((x) => x !== id), replaced: null };
  const replaced = b.excl ? active.find((x) => BY_ID.get(x)?.excl === b.excl) ?? null : null;
  const on = new Set([...active.filter((x) => x !== replaced), id]);
  return { next: BUFF_IDS.filter((x) => on.has(x)), replaced };
}

// ---------------------------------------------------------------- the evaluator
export interface BuffShare { id: string; value: number; outside?: boolean | undefined; pct?: number | undefined }
export interface BuffResult {
  totals: PropMap;                         // the in-cap sums, the buffs' in-cap shares added: not clamped, so what is wasted shows
  caps: Record<string, number>;            // the caps, the buffs' changes applied
  outside: PropMap;                        // what the buffs add past the cap
  effective: PropMap;                      // min(total, cap) + outside: what the character has, for every key a buff touches
  shares: Record<string, BuffShare[]>;     // per key, each buff's share (the page's markers)
  capShares: Record<string, BuffShare[]>;  // per key, each buff's cap change
  beaten: Array<{ id: string; key: string; by: string }>;   // a stat share a larger one in its slot replaced
  // with no character, a share of the raw stat (Bless's 13%) beside a flat one in its slot (a potion's +26): which is
  // larger depends on the stat, so the flat one is counted and neither is said to be beaten
  unsure: Array<{ id: string; key: string; with: string }>;
  blocked: string[];                       // on, but it can't count (below the skill it needs, another race's): nothing
}
// The suit's totals with the `buffs` that are on. `totals` and `caps` are in the page's terms (resists as on the
// paperdoll, Resisting Spells' bonus included). The order is the game's: the caps change first, the in-cap shares are
// added (a stat slot takes its largest share only) and clamped, and the outside shares come after the cap.
export function applyBuffs(totals: PropMap, caps: Readonly<Record<string, number>>, buffs: readonly string[], skills: Skills, stats: Stats | null, who: BuffWho = {}): BuffResult {
  const c = buffContext(skills, stats, totals, who);
  const r: BuffResult = { totals: { ...totals }, caps: { ...caps }, outside: {}, effective: {}, shares: {}, capShares: {}, beaten: [], unsure: [], blocked: [] };
  const live = BUFFS.filter((b) => buffs.includes(b.id) && (buffNeeds(b, skills, who) ? (r.blocked.push(b.id), false) : true));
  const add = (map: Record<string, BuffShare[]>, key: string, s: BuffShare): void => { (map[key] ||= []).push(s); };
  for (const b of live) for (const [k, d] of Object.entries(b.caps?.(c) || {})) { r.caps[k] = (r.caps[k] ?? 0) + d; add(r.capShares, k, { id: b.id, value: d }); }
  const effects = live.map((b) => [b, b.effects(c)] as const);
  // A slot's largest share: flat shares compared by value; with no character, percent shares only among themselves.
  const pctOnly = (e: BuffEffect): boolean => e.pct != null && !stats;
  const best: Record<string, { id: string; value: number }> = {}, bestPct: Record<string, { id: string; value: number }> = {};
  for (const [b, list] of effects) for (const e of list) {
    if (!e.slot) continue;
    const [map, v] = pctOnly(e) ? [bestPct, e.pct!] : [best, e.value];
    if (!map[e.key] || v > map[e.key]!.value) map[e.key] = { id: b.id, value: v };
  }
  for (const [b, list] of effects) for (const e of list) {
    if (!e.value && e.pct == null) continue;
    if (e.slot) {
      const win = (pctOnly(e) ? bestPct : best)[e.key]!;
      if (win.id !== b.id) { r.beaten.push({ id: b.id, key: e.key, by: win.id }); continue; }
      if (pctOnly(e) && best[e.key]) r.unsure.push({ id: b.id, key: e.key, with: best[e.key]!.id });
    }
    const map = e.outside ? r.outside : r.totals;
    map[e.key] = (map[e.key] || 0) + e.value;
    add(r.shares, e.key, { id: b.id, value: e.value, ...(e.outside ? { outside: true } : {}), ...(e.pct != null && !stats ? { pct: e.pct } : {}) });
  }
  for (const k of new Set([...Object.keys(r.shares), ...Object.keys(r.capShares)])) {
    const v = r.totals[k] || 0;
    r.effective[k] = (r.caps[k] != null ? Math.min(v, r.caps[k]) : v) + (r.outside[k] || 0);
  }
  return r;
}

// ---------------------------------------------------------------- the words
const POOL_NAMES: Record<string, string> = { hitsPool: "Hits", stamPool: "Stamina", manaPool: "Mana" };
const nameOf = (k: string): string => POOL_NAMES[k] ?? labelOf(k);
export const signed = (n: number): string => `${n < 0 ? "−" : "+"}${Math.abs(n)}`;
// "Phys, Cold, Poison, Energy +5", "All resists +5", "STR, DEX, INT +14": resists, and stats, with the same text are
// named together; any other key on its own.
const STATS = ["strBonus", "dexBonus", "intBonus"];
const family = (k: string): string => (RESIST_KEYS.includes(k) ? "resist" : STATS.includes(k) ? "stat" : k);
function joined(items: Array<[string, string]>): string[] {
  const groups = new Map<string, { t: string; keys: string[] }>();
  for (const [k, t] of items) { const g = `${family(k)} ${t}`; if (!groups.has(g)) groups.set(g, { t, keys: [] }); groups.get(g)!.keys.push(k); }
  return [...groups.values()].map(({ t, keys }) => `${keys.length === RESIST_KEYS.length && family(keys[0]!) === "resist" ? "All resists" : keys.map(nameOf).join(", ")} ${t}`);
}
// An entry's line in the picker for these skills and stats: "HCI +10 · DI +10 · SSI +10 · DCI −20",
// "DI +7 past the cap · hits the lowest resist", "STR, DEX, INT +13% of base" with no character.
export function buffText(id: string, skills: Skills, stats: Stats | null, totals: PropMap, who: BuffWho = {}): string {
  const b = BY_ID.get(id)!, c = buffContext(skills, stats, totals, who);
  const eff = b.effects(c).filter((e) => e.value || e.pct != null).map((e): [string, string] =>
    [e.key, e.pct != null && !stats ? `+${e.pct}% of base` : `${signed(e.value)}${e.outside ? " past the cap" : ""}`]);
  const caps = Object.entries(b.caps?.(c) || {}).map(([k, d]): [string, string] => [k, `cap ${signed(d)}`]);
  const parts = [...joined(eff), ...joined(caps).map((t) => t.replace("All resists cap", "Resist caps")), ...(b.extra?.(c) || [])];
  return parts.length ? parts.join(" · ") : "No change at this level";
}

// ---------------------------------------------------------------- saved choices (ui-prefs)
// The buffs that are on: known ids, each once.
export const isBuffList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= BUFF_IDS.length && new Set(v).size === v.length && v.every((x) => typeof x === "string" && BY_ID.has(x));
// One character's edited inputs: known inputs, each a number within its bounds, whole for an `int` input.
export function isBuffSkills(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, n]) => {
    const i = Object.hasOwn(BUFF_INPUTS, k) ? BUFF_INPUTS[k]! : null;
    return !!i && typeof n === "number" && Number.isFinite(n) && n >= i.min && n <= i.max && (!i.int || Number.isInteger(n));
  });
}
// The edits by character (ui-prefs `buffSkills`): a character's name, or NO_CHARACTER (""), to its edited inputs, so one
// character's plan never marks another's. At most 200 names of at most 64 characters.
export const NO_CHARACTER = "";
export function isBuffSkillsByCharacter(v: unknown): v is Record<string, Record<string, number>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= 200 && entries.every(([name, edits]) => name.length <= 64 && name !== "__proto__" && isBuffSkills(edits));
}
