// evaluate.test.mts — `evaluateSuit` (`app/evaluate.mts`, issue #216) against the three assemblies it replaced.
//
// `[fast]`: `evaluateSuit` (`app/evaluate.mts`) against the three assemblies it replaced, kept in the test as they were written: MCP `score_suit`'s totals, requirements and planned profile, Manual's totals strip, picker deltas and stats card, and Automatic's buff picker, on the demo characters with and without skills and No character, three templates (one with an Elf race and a resist override a form's loss sets aside), no buffs, Divine Fury and mixed sets, the worn suit and suits with a piece swapped; and Divine Fury's DCI −20 shown in the effective totals beside the gear's, with what is wasted past a cap.
//
// The replaced assemblies are Manual's totals strip, deltas and stats card (ui/builder-manual.mts), Automatic's buff picker (ui/builder.mts buffView) and the MCP tools' score_suit (mcp-tools.mts). The demo characters carry skills that open every buff below; the mixed sets hold a form, a stat slot and a potion. For each case the old numbers and evaluateSuit's must be equal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveProfile, foldSnapshots, profileResistCaps, requirementReport, setRules, toOptItem, totalsOf, RESIST_KEYS, type Character, type Item, type OptItem, type Profile } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { upgradeScan } from "./scan-schema.mts";
import { applyBuffs, buffPlanOf, buffSkillValues, manualBase, manualPlan, manualProfile, rawStats, weaponFlags } from "./buffs.mts";
import { evaluateSuit, paperdoll, paperdollCaps } from "./evaluate.mts";
import { templateSettings, type TemplateMap } from "./build-spec.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);
const scan = (n: string): ReturnType<typeof upgradeScan> => upgradeScan(JSON.parse(readFileSync(join(HERE, "fixtures", `demo-${n}.json`), "utf8")), { shard: "test" });
const inv = foldSnapshots([scan("Kestrel"), scan("Dorran")] as Parameters<typeof foldSnapshots>[0]);
const wornBy: Record<string, Item[]> = {};   // GET /api/inventory's `worn`
for (const it of Object.values(inv.items)) if (it.equippedBy) (wornBy[it.equippedBy] ||= []).push(it);
const SKILLS = { "Resisting Spells": 100, Chivalry: 120, Necromancy: 100, "Spirit Speak": 100, Magery: 100, "Evaluating Intelligence": 110, Alchemy: 100, Bushido: 100 };
const withSkills = (c: Character): Character => ({ ...c, skills: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { value: v }])) } as Character);
const CHARACTERS: Array<[string, Character | null]> = [["Kestrel", withSkills(inv.characters.Kestrel!)], ["Dorran", withSkills(inv.characters.Dorran!)], ["Dorran, no skills", inv.characters.Dorran!], ["No character", null]];
const templates: Record<string, Profile> = Object.fromEntries(Object.entries((JSON.parse(readFileSync(join(HERE, "data", "templates", "uoalive.json"), "utf8")) as { templates: TemplateMap }).templates)
  .map(([id, t]) => [id, templateSettings(t)]));
const PROFILES: Array<[string, Profile]> = [
  ["melee", { ...templates.melee!, softFloors: [] }],
  ["caster, elf, fire cap 95", { ...templates.caster!, softFloors: ["sdi"], race: "elf", resistCaps: { fireResist: 95 } }],
  ["tank", { ...templates.tank!, softFloors: [] }],
];
const BUFF_SETS = [[], ["divineFury"], ["divineFury", "reaperForm", "bless", "greaterStrengthPotion"], ["enemyOfOne", "protection", "consecrateWeapon", "curse"]];
const EDITS = [{}, { Chivalry: 90 }];

// Suits: what each character wears, and that suit with a piece nobody wears swapped into one of its slots.
const gearBySlot = new Map<string, Item[]>();
for (const it of Object.values(inv.items)) if (it.gear && it.slot && !it.equippedBy) gearBySlot.set(it.slot, [...(gearBySlot.get(it.slot) || []), it]);
function suitsFor(name: string | null): Array<Record<string, Item>> {
  const worn: Record<string, Item> = Object.fromEntries((name ? wornBy[name] || [] : []).filter((i) => i.slot).map((i) => [i.slot!, i]));
  const swaps = [...gearBySlot.entries()].slice(0, 3).map(([slot, list]) => ({ ...worn, [slot]: list[0]! }));
  return [worn, ...swaps];
}
const opt = (suit: Record<string, Item>): Record<string, OptItem> => Object.fromEntries(Object.entries(suit).map(([s, it]) => [s, toOptItem(it)]));
const nameOf = (label: string, c: Character | null): string | null => (c ? label.split(",")[0]! : null);
function* cases(): Generator<{ label: string; name: string | null; c: Character | null; p: Profile; on: string[]; edits: Record<string, number>; suit: Record<string, Item> }> {
  for (const [cl, c] of CHARACTERS) for (const [pl, p] of PROFILES) for (const on of BUFF_SETS) for (const edits of EDITS) {
    const name = nameOf(cl, c);
    for (const [i, suit] of suitsFor(name).entries()) yield { label: `${cl} / ${pl} / [${on.join(",")}] / edits ${JSON.stringify(edits)} / suit ${i}`, name, c, p, on, edits, suit };
  }
}

test("[fast] evaluateSuit: MCP score_suit's totals, requirements and planned profile, as it assembled them", () => {
  let n = 0;
  for (const { label, name, c, p, on, edits, suit } of cases()) {
    const worn = name ? wornBy[name] || [] : [], race = c ? p.race || "human" : null;
    // the old assembly (mcp-tools.mts planProfile + score_suit)
    const profile = manualProfile(p, c, worn, suit, race, on, edits);
    const totals = totalsOf(opt(suit));
    const old = requirementReport(totals, profile);
    const ev = evaluateSuit({ profile: manualBase(p, c), character: c, suit: opt(suit), buffs: manualPlan(c, worn, suit, race, on, edits) });
    assert.deepEqual(ev.gearTotals, totals, label);
    assert.deepEqual(ev.requirements, old, label);
    assert.deepEqual(ev.planned, profile, label);
    n++;
  }
  assert.ok(n > 300, `${n} cases`);
});

test("[fast] evaluateSuit: Manual's totals strip, picker deltas and stats card, as it assembled them", () => {
  for (const { label, name, c, p, on, edits, suit } of cases()) {
    // the old assembly (ui/builder-manual.mts profile, buffInputsOf, buffed, totalsCard, deltaCell, statsCard)
    const mp: Profile = name ? p : {}, prof = effectiveProfile(mp, c), base = paperdollCaps(profileResistCaps(prof));
    const { values } = buffSkillValues(c ? c.skills || {} : null, edits);
    const stats = name && c ? rawStats(c, totalsOf(Object.fromEntries((wornBy[name] || []).map((i) => [String(i.serial), i as unknown as OptItem])))) : null;
    const race = name && c ? p.race || "human" : null;
    const buffed = (t: Record<string, number>, s: Record<string, Item>): ReturnType<typeof applyBuffs> => applyBuffs(t, base, on, values, stats, { race, weaponFlags: weaponFlags(s) });
    const strip = buffed(paperdoll(totalsOf(opt(suit)), prof.resistBonus), suit);
    const card = buffed(totalsOf(opt(suit)), suit);
    const ev = evaluateSuit({ profile: mp, character: c, suit: opt(suit), buffs: manualPlan(c, name ? wornBy[name] || [] : [], suit, race, on, edits) });
    assert.deepEqual(ev.buffs, strip, label);
    assert.deepEqual([ev.effectiveTotals, ev.caps, ev.baseCaps], [strip.totals, strip.caps, base], label);
    // the stats card read item totals (no Resisting Spells bonus) and only its non-resist keys
    const added = (r: typeof card, t: Record<string, number>): Record<string, number> => Object.fromEntries(Object.keys(r.shares).filter((k) => !RESIST_KEYS.includes(k)).map((k) => [k, (r.totals[k] || 0) - (t[k] || 0)]));
    assert.deepEqual(added(ev.buffs, paperdoll(ev.gearTotals, ev.planned.resistBonus)), added(card, totalsOf(opt(suit))), label);
    const nonResist = (m: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(m).filter(([k]) => !RESIST_KEYS.includes(k)));
    assert.deepEqual([nonResist(ev.buffs.outside), nonResist(ev.buffs.shares), ev.caps], [nonResist(card.outside), nonResist(card.shares), card.caps], label);
  }
});

test("[fast] evaluateSuit: Automatic's buff picker on the worn suit, as it assembled it", () => {
  for (const [cl, c] of CHARACTERS) {
    const name = nameOf(cl, c);
    if (!name) continue;
    for (const [pl, p] of PROFILES) for (const on of BUFF_SETS) for (const edits of EDITS) {
      const label = `${cl} / ${pl} / [${on.join(",")}] / ${JSON.stringify(edits)}`, worn = wornBy[name] || [];
      // the old assembly (ui/builder.mts buffPlan + buffView)
      const plan = buffPlanOf(c, worn, p.race, { on, skills: {} }, edits);
      const prof = effectiveProfile(p, c), totals = paperdoll(plan.worn, prof.resistBonus), caps = paperdollCaps(profileResistCaps(prof));
      const all = applyBuffs(totals, caps, plan.on, plan.skills, plan.stats, plan.who);
      const ev = evaluateSuit({ profile: p, character: c, suit: Object.fromEntries(worn.map((i) => [String(i.serial), i])), buffs: plan });
      assert.deepEqual([paperdoll(ev.gearTotals, ev.planned.resistBonus), ev.baseCaps, ev.buffs], [totals, caps, all], label);
    }
  }
});

test("[fast] evaluateSuit: Divine Fury's DCI −20 shows in the effective totals beside the gear's, and wasted is what is past a cap", () => {
  const c = withSkills(inv.characters.Kestrel!), p: Profile = { floors: { dci: 45 }, weights: { dci: 1 } };
  const suit = { ring: { props: { dci: 40 } }, bracelet: { props: { dci: 26, hci: 30 } } };
  const ev = evaluateSuit({ profile: p, character: c, suit, buffs: manualPlan(c, [], {}, "human", ["divineFury"], { Chivalry: 100 }) });
  assert.equal(ev.gearTotals.dci, 66);
  assert.equal(ev.effectiveTotals.dci, 46);
  assert.equal(ev.requirements.find((r) => r.key === "dci")!.floor, 65, "the floor the gear has to reach");
  assert.equal(ev.wasted.hci, undefined, "HCI 30 is under its cap");
  assert.equal(ev.wasted.dci, 46 - ev.caps.dci!);
  const none = evaluateSuit({ profile: p, character: c, suit, buffs: null });
  assert.deepEqual([none.effectiveTotals.dci, none.requirements.find((r) => r.key === "dci")!.floor], [66, 45]);
});
