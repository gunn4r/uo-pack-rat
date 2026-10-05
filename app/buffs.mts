// buffs.mts — the Suit Builder's buffs, abilities and forms (issue #12): a catalog, as data, of what a spell, a form,
// a mastery or a potion adds to a suit's totals, and applyBuffs, a pure evaluator that shows a suit "with Divine Fury
// on" or "in Reaper Form", and the debuffs an enemy casts on you. Each entry cites its source: a ServUO file (under
// Scripts/) or the UO Alive wiki, which wins where the two disagree (the other's number is said in the entry's note),
// and carries how sure those numbers are. No DOM: Manual (ui/builder-manual.mts) and Automatic read the same model,
// and app/buffs.test.mts checks it.
import { RESIST_KEYS, resistSkillBonus, labelOf, effectiveProfile, profileResistCaps } from "./vault-lib.mts";
import type { BuffShift, Character, EffectiveProfile, Profile, PropMap, RunBuffs } from "./vault-lib.mts";

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
  Archery: skill("Archery"),
  "Mastery level": { label: "Mastery level", skills: [], min: 1, max: 3, def: 3, int: true },
  "Rampage hits": { label: "Rampage hits", skills: [], min: 0, max: 60, def: 60, int: true },
  Alchemy: skill("Alchemy"),
  "HP lost": { label: "HP lost %", skills: [], min: 0, max: 100, def: 80, int: true },
  // the enemy's skills, for the debuffs cast on you
  "Enemy Eval Int": { label: "Enemy Eval Int", skills: [], min: 0, max: 150, def: 120 },
  "Enemy Necro + SS": { label: "Enemy Necro + Spirit Speak", skills: [], min: 0, max: 300, def: 240 },
};
// The picker's groups, in order, each with the numbers its entries scale with; a `collapsed` one starts folded.
export const BUFF_GROUPS: Array<{ name: string; inputs: string[]; collapsed?: true }> = [
  { name: "Chivalry", inputs: ["Chivalry", "Karma"] },
  { name: "Necromancy", inputs: ["Necromancy", "Spirit Speak"] },
  { name: "Spellweaving", inputs: ["Spellweaving", "Arcane Focus"] },
  { name: "Magery", inputs: ["Evaluating Intelligence", "Inscription"] },
  { name: "Mysticism", inputs: ["Mysticism", "Focus or Imbuing"] },
  { name: "Ninjitsu", inputs: ["Ninjitsu"] },
  { name: "Bushido", inputs: ["Bushido"] },
  { name: "Bard masteries", inputs: ["Musicianship", "Provocation", "Peacemaking", "Discordance"] },
  { name: "Other masteries", inputs: ["Swordsmanship", "Mace Fighting", "Archery", "Tactics", "Mastery level", "Rampage hits"] },
  { name: "Potions", inputs: ["Alchemy"] },
  { name: "Food and tinctures", inputs: [] },
  { name: "Racial", inputs: ["HP lost"] },
  { name: "Debuffs (cast on you)", inputs: ["Enemy Eval Int", "Enemy Necro + SS"], collapsed: true },
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
// `caps` are the caps a cap change reads: before any buff, or the running caps for a `capsLate` change.
export interface BuffWho { race?: string | null | undefined; weaponFlags?: readonly string[] | undefined }
export interface BuffContext { s: (input: string) => number; stats: Stats | null; totals: PropMap; resist: number | null; who: BuffWho; caps: Readonly<Record<string, number>> }
// One effect. `outside`: added after the cap (Enemy of One's damage), so it never counts toward it. `slot`: a stat
// buff that shares its stat with others, the largest counting (Bless, the potions; and the FC −2 Protection and the
// Urali potion share). `pct`: a share of the raw stat (negative for Curse), kept so the page can say "+13%" when there
// is no character to take it of.
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
  // Cap changes, applied before any effect and in ServUO's order (PlayerMobile.cs GetMaxResistance): `caps` adds to a
  // cap; `capsLate` adds after every `caps`, reading the running caps in c.caps (Curse's "above 60"); `capsSet` sets a
  // cap outright, last (Corpse Skin's 70 − malus).
  caps?: (c: BuffContext) => PropMap;
  capsLate?: (c: BuffContext) => PropMap;
  capsSet?: (c: BuffContext) => PropMap;
  extra?: (c: BuffContext) => string[];   // what it does that no total shows
  note?: string;
  confidence?: "medium" | "low";          // how sure its numbers are (absent: high); the picker marks the others unverified
  unconfirmed?: true;                     // in ServUO, but not known to exist on UO Alive
}

const tr = Math.trunc;
const fx = (v: number): number => tr(v * 10);   // ServUO's Skills[x].Fixed
const resists = (value: number, keys = RESIST_KEYS): BuffEffect[] => keys.map((key) => ({ key, value }));
// Bless and its kin: ceil(raw stat × (1 + EvalFixed / 100)%), in ServUO's own double math (SpellHelper.GetOffset).
function statShare(key: string, raw: number | undefined, pct: number): BuffEffect {
  return { key, slot: true, pct, value: raw == null ? 0 : Math.ceil(raw * (pct * 0.01)) };
}
const blessPct = (c: BuffContext): number => 1 + tr(fx(c.s("Evaluating Intelligence")) / 100);
// A potion's offset scaled by Enhance Potions, the shard wiki's (Enhance_Potions, Publish 73): the larger of the suit's
// (at most 50) plus Alchemy / 3.3, and Alchemy / 2. ServUO's BasePotion.cs EnhancePotions adds 10 per 33 Alchemy.
const potionEP = (c: BuffContext): number => Math.max(Math.min(c.totals.enhancePotions || 0, 50) + c.s("Alchemy") / 3.3, c.s("Alchemy") / 2);
const potion = (c: BuffContext, offset: number): number => tr((offset * (100 + potionEP(c))) / 100);
const EP_NOTE = "Enhance Potions by the shard wiki: the larger of the suit's (at most 50) + Alchemy / 3.3, and Alchemy / 2. ServUO: + 10 per 33 Alchemy";
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
      return [{ key: "physResist", value: -15 + Math.min(i, 15) }, ...all, { key: "fc", value: -2, outside: true, slot: true }];
    },
    extra: (c) => [`Resisting Spells ${signed(-35 + Math.min(tr(c.s("Inscription") / 20), 35))}`] },
  // Reactive Armor: Spells/First/ReactiveArmor.cs.
  { id: "reactiveArmor", name: "Reactive Armor", group: "Magery", inputs: ["Inscription"],
    effects: (c) => [{ key: "physResist", value: 15 + tr(c.s("Inscription") / 20) }, ...resists(-5, RESIST_KEYS.filter((k) => k !== "physResist"))] },
  // Magic Reflection: the shard wiki's numbers (uoalive.com/wiki/Magic_Reflection): Phys −(20 − Inscription / 20) and a
  // Phys cap 5 lower, the others +10. ServUO's Spells/Fifth/MagicReflect.cs has Phys −25 + Inscription / 20 and no cap
  // change. Like Protection and Reactive Armor it is its own toggle, so the three stack.
  { id: "magicReflection", name: "Magic Reflection", group: "Magery", inputs: ["Inscription"],
    effects: (c) => [{ key: "physResist", value: -(20 - tr(c.s("Inscription") / 20)) }, ...resists(10, RESIST_KEYS.filter((k) => k !== "physResist"))],
    caps: () => ({ physResist: -5 }), confidence: "medium",
    note: "This uses the shard wiki. ServUO: −25 + Inscription/20, no cap change; the in-game buff tooltip shows the real value" },

  // Stone Form: Spells/Mysticism/SpellDefinitions/StoneForm.cs (GetResBonus, GetMaxResistance); FC −2 and SSI −10 in
  // AOS.cs. Its melee damage (GetDamBonus, BaseWeapon.cs:2573 percentageBonus, past the DI cap) is the code's: the buff
  // text says (Mysticism + secondary) / 12, and the shard wiki gives no number.
  { id: "stoneForm", name: "Stone Form", group: "Mysticism", inputs: MYST, excl: "form", min: ["Mysticism", 33],
    effects: (c) => [...resists(Math.max(2, tr(mystSum(c) / 24))), { key: "ssi", value: -10 }, { key: "fc", value: -2 }, { key: "di", value: Math.max(2, tr(mystSum(c) / 48)), outside: true }],
    caps: (c) => Object.fromEntries(RESIST_KEYS.map((k) => [k, Math.max(2, tr(mystSum(c) / 48))])),
    confidence: "medium",
    note: "No cap raise while wearing refined armor. Its melee damage past the cap is ServUO's code, (Mysticism + Focus or Imbuing) / 48; the buff's own text says / 12" },
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
  { id: "strengthPotion", name: "Strength potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "strBonus", value: potion(c, 10), slot: true }], confidence: "medium", note: EP_NOTE },
  { id: "greaterStrengthPotion", name: "Greater Strength potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "strBonus", value: potion(c, 20), slot: true }], confidence: "medium", note: EP_NOTE },
  { id: "agilityPotion", name: "Agility potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "dexBonus", value: potion(c, 10), slot: true }], confidence: "medium", note: EP_NOTE },
  { id: "greaterAgilityPotion", name: "Greater Agility potion", group: "Potions", inputs: ["Alchemy"], effects: (c) => [{ key: "dexBonus", value: potion(c, 20), slot: true }], confidence: "medium", note: EP_NOTE },

  // Racial: the Human's +2 HPR, inside the 18 cap (RegenRates.cs; wiki Humans). The Elf's Energy cap is the rules
  // file's raceCaps and its +20 mana is in the scanned maximum already, so the Elf has no entry.
  { id: "human", name: "Human: Tough", group: "Racial", inputs: [], race: "human", effects: () => [{ key: "hpRegen", value: 2 }] },
  // Gargoyle: HCI +5 (AOS.cs:805), MR +2 (RegenRates.cs:286) and an HCI cap of 50 (BaseWeapon.cs:1451), the cap unverified here.
  { id: "gargoyle", name: "Gargoyle", group: "Racial", inputs: [], race: "gargoyle", confidence: "medium",
    effects: () => [{ key: "hci", value: 5 }, { key: "manaRegen", value: 2 }], caps: () => ({ hci: 5 }), note: "The HCI cap of 50 is ServUO's; unverified on UO Alive" },
  // Gargoyle Berserk: the shard wiki's tiers (Gargoyle_Race), +15 DI and +3 SDI per 20% of HP lost, at most 60 and 12.
  // ServUO's PlayerMobile.cs GetRacialBerserkBuff starts only at half HP: 30 / 6, 45 / 9, 60 / 12.
  { id: "berserk", name: "Gargoyle Berserk", group: "Racial", inputs: ["HP lost"], race: "gargoyle", confidence: "medium",
    effects: (c) => { const t = tr(c.s("HP lost") / 20); return [{ key: "di", value: Math.min(60, 15 * t) }, { key: "sdi", value: Math.min(12, 3 * t) }]; },
    note: "Shard wiki tiers. ServUO starts at half your HP lost: DI 30 / 45 / 60, SDI 6 / 9 / 12" },

  // The rest of the self buffs, each less sure or less common.
  // Curse Weapon: weapon hits heal 50% of the damage (BaseWeapon.cs:2755), on top of Vampiric Embrace's 20%.
  { id: "curseWeapon", name: "Curse Weapon", group: "Necromancy", inputs: ["Spirit Speak"],
    effects: () => [], extra: (c) => ["50% life leech on weapon hits", `lasts ${tr(c.s("Spirit Speak") / 3.4 + 1)} s`] },
  // Arcane Empowerment: ArcaneEmpowerment.cs:94-95, SDI Spellweaving / 12 + 5 per focus level; healing 10% more. AOS.cs:680
  // adds one more per focus level on a PvP branch it always takes; the wiki's row is garbled. Minimum 24 on the shard.
  { id: "arcaneEmpowerment", name: "Arcane Empowerment", group: "Spellweaving", inputs: ["Spellweaving", "Arcane Focus"], min: ["Spellweaving", 24], confidence: "medium",
    effects: (c) => [{ key: "sdi", value: Math.floor(c.s("Spellweaving") / 12) + 5 * c.s("Arcane Focus") }],
    extra: (c) => [`healing +${10 + Math.floor(c.s("Spellweaving") / 12) + 5 * c.s("Arcane Focus")}%`],
    note: "Lasts about 20 s. ServUO's code adds 1 more SDI per Arcane Focus level" },
  // Attunement: AttuneWeapon.cs:109-112, a pool of melee damage absorbed, not a resist.
  { id: "attunement", name: "Attunement", group: "Spellweaving", inputs: ["Spellweaving", "Arcane Focus"],
    effects: () => [], extra: (c) => [`absorbs the next ${tr(18 + ((c.s("Spellweaving") - 10) / 10) * 3 + c.s("Arcane Focus") * 6)} melee damage`] },
  // Ethereal Form: the shard's own (wiki The_Summoner, "Ethereal Form Effects"); no source code.
  { id: "etherealForm", name: "Ethereal Form", group: "Spellweaving", inputs: ["Spellweaving"], excl: "form", min: ["Spellweaving", 120], confidence: "medium",
    effects: () => [{ key: "physResist", value: -10 }, ...resists(-5, RESIST_KEYS.filter((k) => k !== "physResist"))], extra: () => ["8% mana leech"],
    note: "Only for the full Summoner (Necromancy and Spirit Speak at 0). Whether it counts as a form is unverified" },
  // Animal Form, the smaller ones: Spells/Ninjitsu/AnimalForm.cs. Rat / Rabbit Stealth +20; Ferret Stealing +25 on UO Alive
  // (Patch Notes Mar 20 2026; ServUO 10); Cat / Dog HPR Ninjitsu Fixed / 30 after the cap (RegenRates.cs:230).
  { id: "ratRabbit", name: "Animal Form: Rat or Rabbit", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form", min: ["Ninjitsu", 20],
    effects: () => [{ key: "sk:stealth", value: 20 }] },
  { id: "ferret", name: "Animal Form: Ferret", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form", min: ["Ninjitsu", 40],
    effects: () => [{ key: "sk:stealing", value: 25 }], note: "Past the skill cap. ServUO: +10" },
  { id: "catDog", name: "Animal Form: Cat or Dog", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form", min: ["Ninjitsu", 40], confidence: "low",
    effects: (c) => [{ key: "hpRegen", value: tr(fx(c.s("Ninjitsu")) / 30), outside: true }],
    note: "ServUO's code reads Ninjitsu × 10 / 30 (40 at 120); older docs say far less" },
  // Mysterious Wisp: the shard's own (wiki The_Ninja "Wisp Form", Patch Notes Jun 26 2026).
  { id: "mysteriousWisp", name: "Mysterious Wisp", group: "Ninjitsu", inputs: ["Ninjitsu"], excl: "form", min: ["Ninjitsu", 120], confidence: "medium",
    effects: () => [{ key: "physResist", value: -10 }, ...resists(-5, RESIST_KEYS.filter((k) => k !== "physResist"))], extra: () => ["8% mana leech"],
    note: "Needs 120 Ninjitsu and 120 Stealth. Whether it counts as a form is unverified" },
  // Rampage, fully stacked: Spells/Skill Masteries/Rampage.cs:199-216, per hit HPR 1 + level (to 18) and SR and SSI by
  // the level (to 24, 60); the HPR and SR after their caps (RegenRates.cs). Lost on a miss. Its Casting Focus (to 12)
  // is stored but read nowhere (BonusType.Focus has no consumer), so it is said, not counted.
  { id: "rampage", name: "Rampage", group: "Other masteries", inputs: ["Rampage hits", "Mastery level"],
    effects: (c) => {
      const n = c.s("Rampage hits"), l = c.s("Mastery level");
      return [{ key: "ssi", value: Math.min(60, l * n) }, { key: "hpRegen", value: Math.min(18, (1 + l) * n), outside: true }, { key: "stamRegen", value: Math.min(24, l * n), outside: true }];
    },
    note: "Wrestling mastery. Its stacks build per hit and are lost on a miss. ServUO stores a Casting Focus bonus that nothing reads" },
  // Playing the Odds: PlayingTheOdds.cs:72-73, as written: Math.Max, which looks like a ServUO bug for Math.Min.
  { id: "playingTheOdds", name: "Playing the Odds", group: "Other masteries", inputs: ["Archery", "Tactics"], confidence: "low",
    effects: (c) => { const avg = (c.s("Archery") + c.s("Tactics")) / 2; return [{ key: "hci", value: Math.max(45, tr(avg / 2.667)) }, { key: "ssi", value: Math.max(30, tr(avg / 4)) }]; },
    note: "Archery mastery, a party buff for a minute. ServUO's code takes the larger of 45 and its formula, likely a bug for the smaller" },

  // Eodon potions: Items/Consumables/EodonPotions.cs. Not known to exist on UO Alive.
  { id: "barrab", name: "Barrab Hemolymph Concentrate", group: "Potions", inputs: [], confidence: "low", unconfirmed: true,
    effects: () => [{ key: "hpRegen", value: 100, outside: true }], note: "10 minutes. Not with Confidence, poison or mortal wound. Its +10 Hits (GetHitBuff) is never applied in ServUO" },
  { id: "jukari", name: "Jukari Burn Poultice", group: "Potions", inputs: [], confidence: "low", unconfirmed: true,
    effects: () => [{ key: "fireResist", value: 10 }, { key: "stamPool", value: 10 }], note: "Fire for 10 minutes, Stamina for 5" },
  { id: "barako", name: "Barako Draft of Might", group: "Potions", inputs: [], confidence: "low", unconfirmed: true,
    effects: () => [{ key: "physResist", value: 10 }, { key: "coldResist", value: 5 }], note: "ServUO adds the Physical mod twice and never the Cold one" },
  { id: "sakkhra", name: "Sakkhra Prophylaxis", group: "Potions", inputs: [], confidence: "low", unconfirmed: true,
    effects: () => [{ key: "poisonResist", value: 10 }, { key: "energyResist", value: 5 }] },
  // Urali: Mana +10, and the same FC −2 after the cap as Protection (Spell.cs:1062), which it shares.
  { id: "urali", name: "Urali Trance Tonic", group: "Potions", inputs: [], confidence: "low", unconfirmed: true,
    effects: () => [{ key: "manaPool", value: 10 }, { key: "fc", value: -2, outside: true, slot: true }], note: "Its FC −2 and Protection's are one penalty" },
  // Food and tinctures. Grapes of Wrath and the High Seas fish pies: Misc/AOS.cs (630, 669, FishPieEffect).
  { id: "grapesOfWrath", name: "Grapes of Wrath", group: "Food and tinctures", inputs: [], confidence: "medium", unconfirmed: true,
    effects: () => [{ key: "di", value: 35 }, { key: "sdi", value: 15 }] },
  ...([["di", 5], ["sdi", 5], ["hci", 8], ["dci", 8], ["hpRegen", 3], ["stamRegen", 3], ["manaRegen", 3]] as Array<[string, number]>).map(([key, value]): Buff => ({
    id: `fishPie.${key}`, name: `Fish pie: ${labelOf(key)} +${value}`, group: "Food and tinctures", inputs: [], confidence: "medium", unconfirmed: true,
    effects: () => [{ key, value }], note: "Each kind of fish pie gives one of these" })),
  // Skill tinctures: UO Alive's own (Patch Notes Mar 20 2026), an hour's boost of a size the shard hasn't published.
  ...([["minstrel", "Tincture of the Minstrel", "Musicianship"], ["shadows", "Tincture of Shadows", "Stealth"]] as const).map(([id, name, sk]): Buff => ({
    id: `tincture.${id}`, name, group: "Food and tinctures", inputs: [], confidence: "low", unconfirmed: true,
    effects: () => [], extra: () => [`raises ${sk} for an hour`], note: "How much it raises the skill isn't published" })),

  // Debuffs cast on you. Curse: SpellHelper.cs GetOffsetScalar, 8 + the enemy's Eval Fixed / 100 − your Resisting
  // Spells Fixed / 100 percent of each raw stat (its own "[Magic] <stat> Curse", so it stacks with Bless); every
  // resist cap but Physical 10 lower when above 60 (PlayerMobile.cs:1000-1009).
  { id: "curse", name: "Curse", group: "Debuffs (cast on you)", inputs: ["Enemy Eval Int"], confidence: "medium",
    effects: (c) => {
      const pct = Math.max(0, 8 + tr(fx(c.s("Enemy Eval Int")) / 100) - fx(c.resist ?? 0) / 100);
      const share = (key: string, raw: number | undefined): BuffEffect => ({ key, pct: -pct, value: raw == null ? 0 : -Math.ceil(raw * (pct * 0.01)) });
      return pct ? [share("strBonus", c.stats?.str), share("dexBonus", c.stats?.dex), share("intBonus", c.stats?.int)] : [];
    },
    capsLate: (c) => Object.fromEntries(RESIST_KEYS.filter((k) => k !== "physResist" && (c.caps[k] ?? 70) > 60).map((k) => [k, -10])),
    note: "Your Resisting Spells lowers the stat loss. With no character it is counted at 0" },
  // Corpse Skin: CorpseSkin.cs:122-129, malus min(15, (enemy Necromancy + Spirit Speak) × 0.075); Fire and Poison caps
  // become 70 − malus (GetResistMalus, PlayerMobile.cs:1011).
  { id: "corpseSkin", name: "Corpse Skin", group: "Debuffs (cast on you)", inputs: ["Enemy Necro + SS"], confidence: "medium",
    effects: (c) => { const m = tr(Math.min(15, c.s("Enemy Necro + SS") * 0.075)); return [{ key: "fireResist", value: -m }, { key: "poisonResist", value: -m }, { key: "coldResist", value: 10 }, { key: "physResist", value: 10 }]; },
    capsSet: (c) => { const m = tr(Math.min(15, c.s("Enemy Necro + SS") * 0.075)); return { fireResist: 70 - m, poisonResist: 70 - m }; } },
  // Mind Rot: MindRot.cs:125, spells cost 25% more mana on a player, after Lower Mana Cost.
  { id: "mindRot", name: "Mind Rot", group: "Debuffs (cast on you)", inputs: [], confidence: "medium",
    effects: () => [], extra: () => ["spells cost 25% more mana, after LMC"] },
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
export const buffContext = (skills: Skills, stats: Stats | null, totals: PropMap, who: BuffWho = {}, caps: Readonly<Record<string, number>> = {}): BuffContext =>
  ({ s: (id) => skills[id] ?? BUFF_INPUTS[id]?.def ?? 0, stats, totals, resist: skills["Resisting Spells"] ?? null, who, caps });
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
  const c = buffContext(skills, stats, totals, who, caps);
  const r: BuffResult = { totals: { ...totals }, caps: { ...caps }, outside: {}, effective: {}, shares: {}, capShares: {}, beaten: [], unsure: [], blocked: [] };
  const live = BUFFS.filter((b) => buffs.includes(b.id) && (buffNeeds(b, skills, who) ? (r.blocked.push(b.id), false) : true));
  const add = (map: Record<string, BuffShare[]>, key: string, s: BuffShare): void => { (map[key] ||= []).push(s); };
  // the caps in ServUO's order: every addition, then the late ones on the running caps, then the absolute ones
  const capTo = (b: Buff, k: string, to: number): void => { const d = to - (r.caps[k] ?? 0); r.caps[k] = to; if (d) add(r.capShares, k, { id: b.id, value: d }); };
  for (const b of live) for (const [k, d] of Object.entries(b.caps?.(c) || {})) capTo(b, k, (r.caps[k] ?? 0) + d);
  for (const b of live) for (const [k, d] of Object.entries(b.capsLate?.({ ...c, caps: r.caps }) || {})) capTo(b, k, (r.caps[k] ?? 0) + d);
  for (const b of live) for (const [k, v] of Object.entries(b.capsSet?.(c) || {})) capTo(b, k, v);
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

// ---------------------------------------------------------------- planning (Automatic)
// What Automatic plans with: the buffs that are on, their numbers (with the character's own Resisting Spells, which
// Protection lowers), the raw stats, the race and the held weapon's flags, and `worn`, the item totals of what the
// character wears now.
export interface BuffPlan { on: string[]; skills: Skills; stats: Stats | null; who: BuffWho; worn: PropMap }
// The optimizer's profile with the buffs that are on counted as always on. applyBuffs works the caps out in the
// game's order; each key's in-cap share is then a constant base the gear needn't supply, so it comes off the cap and
// the floor (effectiveProfile's `shift`), and both solvers search the same profile unchanged. What a buff adds past the
// cap (Enemy of One's damage) never counts toward a cap, so it plays no part. Two numbers depend on the suit, and are
// taken from what the character wears now rather than the suit being searched: a potion's Enhance Potions and Enchant's
// Spell Channeling (plannedFromWorn says which buffs those are). Exact handling would make those MIP variables.
export function plannedProfile(p: Profile, character: Character | null, plan: BuffPlan | null): EffectiveProfile {
  const base = effectiveProfile(p, character);
  if (!plan?.on.length) return base;
  return { ...effectiveProfile(p, character, buffShift(base, plan).shift), buffs: { on: plan.on, skills: plan.skills, stats: plan.stats, who: plan.who, caps: base.caps, floors: base.floors } };
}
// The buffs applied to a profile's caps (in paperdoll terms) and the worn suit, and what that shifts: the caps, and
// each key's in-cap share. `r` says which buff gave what (a requirement's note).
export function buffShift(base: EffectiveProfile, plan: BuffPlan): { shift: BuffShift; r: BuffResult } {
  const view = profileResistCaps(base), caps = { ...base.caps };
  for (const k of RESIST_KEYS) caps[k] = view[k]!.cap;
  const r = applyBuffs(plan.worn, caps, plan.on, plan.skills, plan.stats, plan.who);
  const shares = Object.fromEntries(Object.entries(r.shares).map(([k, list]) => [k, list.filter((x) => !x.outside).reduce((n, x) => n + x.value, 0)]));
  return { shift: { caps: r.caps, shares }, r };
}
// The buffs among `on` whose numbers Automatic takes from the suit worn now: the potions (its Enhance Potions) and an
// Enchant (the held weapon's Spell Channeling).
export const plannedFromWorn = (on: readonly string[]): string[] => on.filter((id) => { const b = BY_ID.get(id); return !!b && (b.inputs.includes("Alchemy") || b.excl === "enchant"); });
// A run's buffs as saved: the ids and the inputs' values (never Resisting Spells, which is the character's own).
export function runBuffs(on: readonly string[], skills: Skills): RunBuffs | undefined {
  return on.length ? { on: [...on], skills: Object.fromEntries(Object.keys(BUFF_INPUTS).map((k) => [k, skills[k] ?? BUFF_INPUTS[k]!.def])) } : undefined;
}
export const isRunBuffs = (v: unknown): v is RunBuffs => !!v && typeof v === "object" && isBuffList((v as RunBuffs).on) && isBuffSkills((v as RunBuffs).skills);
// A saved run's buffs, or none for a run saved before them (or a damaged entry).
export const savedBuffs = (settings: { buffs?: unknown }): RunBuffs | undefined => (isRunBuffs(settings.buffs) ? settings.buffs : undefined);
// What changed in the buffs between two runs' settings: "+Divine Fury", "−Bless", "Chivalry 105 → 120" (an input one
// of the buffs on in both scales with). A run saved before buffs, or with a damaged entry, has none.
export function buffsDiff(a: unknown, b: unknown): string[] {
  const A = isRunBuffs(a) ? a : { on: [], skills: {} }, B = isRunBuffs(b) ? b : { on: [], skills: {} };
  const out = [...B.on.filter((id) => !A.on.includes(id)).map((id) => `+${BY_ID.get(id)!.name}`), ...A.on.filter((id) => !B.on.includes(id)).map((id) => `−${BY_ID.get(id)!.name}`)];
  const inputs = new Set(B.on.filter((id) => A.on.includes(id)).flatMap((id) => BY_ID.get(id)!.inputs));
  for (const i of inputs) if (A.skills[i] !== B.skills[i]) out.push(`${BUFF_INPUTS[i]!.label} ${A.skills[i] ?? "?"} → ${B.skills[i] ?? "?"}`);
  return out;
}

// ---------------------------------------------------------------- the words
const POOL_NAMES: Record<string, string> = { hitsPool: "Hits", stamPool: "Stamina", manaPool: "Mana" };
const nameOf = (k: string): string => POOL_NAMES[k] ?? (k.startsWith("sk:") ? labelOf(k).slice(1) : labelOf(k));   // "Stealth +20", not "+Stealth +20"
export const signed = (n: number): string => `${n < 0 ? "−" : "+"}${Math.abs(n)}`;
export const signedPct = (n: number): string => `${signed(Math.round(n * 100) / 100)}%`;
// A requirement's note with buffs planned: what gear still has to supply (`need`, against its cap `gearCap`), and which
// buff gave what. "Gear needs 35: Divine Fury gives 10", "Gear needs 45 of a 50 cap: Divine Fury −20, White Tiger Form
// +20, White Tiger Form cap +5". Null when no buff counts toward `k` (a bonus past the cap never does).
export function gearNeedsText(k: string, need: number, gearCap: number | undefined, r: BuffResult): string | null {
  const shares = (r.shares[k] || []).filter((x) => !x.outside), caps = r.capShares[k] || [];
  if (!shares.length && !caps.length) return null;
  const one = shares.length === 1 && !caps.length ? shares[0]! : null;
  const parts = one ? [`${BY_ID.get(one.id)!.name} ${one.value < 0 ? "takes" : "gives"} ${Math.abs(one.value)}`]
    : [...shares.map((x) => `${BY_ID.get(x.id)!.name} ${signed(x.value)}`), ...caps.map((x) => `${BY_ID.get(x.id)!.name} cap ${signed(x.value)}`)];
  return `Gear needs ${need}${caps.length && gearCap != null ? ` of a ${gearCap} cap` : ""}: ${parts.join(", ")}`;
}
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
// `caps` are the caps before any buff, so a cap change reads as it would on its own.
export function buffText(id: string, skills: Skills, stats: Stats | null, totals: PropMap, who: BuffWho = {}, caps: Readonly<Record<string, number>> = {}): string {
  const b = BY_ID.get(id)!, c = buffContext(skills, stats, totals, who, caps);
  const eff = b.effects(c).filter((e) => e.value || e.pct != null).map((e): [string, string] =>
    [e.key, e.pct != null && !stats ? `${signedPct(e.pct)} of base` : `${signed(e.value)}${e.outside ? " past the cap" : ""}`]);
  const capText = [...Object.entries({ ...b.caps?.(c), ...b.capsLate?.(c) }).map(([k, d]): [string, string] => [k, `cap ${signed(d)}`]),
    ...Object.entries(b.capsSet?.(c) || {}).map(([k, v]): [string, string] => [k, `cap ${v}`])];
  const parts = [...joined(eff), ...joined(capText).map((t) => t.replace("All resists cap", "Resist caps")), ...(b.extra?.(c) || [])];
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
// Automatic's buffs by character (ui-prefs `autoBuffs`): a character's name to the buffs that are on, by the same
// bounds as the edits.
export function isBuffListsByCharacter(v: unknown): v is Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= 200 && entries.every(([name, on]) => name.length <= 64 && name !== "__proto__" && isBuffList(on));
}
export function isBuffSkillsByCharacter(v: unknown): v is Record<string, Record<string, number>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= 200 && entries.every(([name, edits]) => name.length <= 64 && name !== "__proto__" && isBuffSkills(edits));
}
