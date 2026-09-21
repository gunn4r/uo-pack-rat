// gear-vault.test.mjs — tests for vault-lib.mts (parser, classifier, fold, pools) and the optimizer
// core through the same loader the server uses. Tags are name prefixes: [smoke] [fast] [slow].
// Run: node --test app/gear-vault.test.mjs   or   node app/gear-vault.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parseTooltip, classify, foldSnapshots, buildPools, requirementReport, totalsOf, propertyKeys, bagLabel, kindOf, groupByName, slayersOf, medableOf, weaponAllowed, settingsDiff, PROP_LABELS, effectiveProfile, resistSkillBonus, toOptItem, labelOf, builderKeys, migrateProfiles, templateFrom, TEMPLATE_KEYS, setRules, getRules, tagUnits } from "./vault-lib.mts";
import { upgradeScan, TAZUO_V1_CAPS } from "./scan-schema.mts";
import { runKey, reusableRun, runSummary, normalizeRun } from "./runs-lib.mts";
import { corePath } from "./config.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP_SLOW = process.env.TEST_SKIP_SLOW ? "TEST_SKIP_SLOW" : false;

// Every test in this file runs against the UO Alive shard rules — the same rules file the app ships
// as the default shard (Phase 2, Task 2: shard rules moved out of vault-lib.mts into app/rules/).
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")));

// ---- parser -------------------------------------------------------------------------------
test("[smoke] parseTooltip reads modeled props, tags, STR req, rarity, extras and flags", () => {
  const p = parseTooltip(["Arcane Crescent Blade", "Weight: 1 Stone", "Hit Harm 38%", "Hit Poison Area 38%",
    "Hit Mana Leech 40%", "Mana Regeneration 6", "Damage Increase 40%", "Physical Damage 100%", "Weapon Damage 12 - 15",
    "Weapon Speed 2.5s", "Strength Requirement 55", "Two-handed Weapon", "Skill Required: Swordsmanship",
    "Durability 57 / 57", "<BASEFONT COLOR=#A335EE>Lesser Magic Item", "Antique"]);
  assert.equal(p.name, "Arcane Crescent Blade");
  assert.equal(p.props.hitHarm, 38);
  assert.equal(p.props.hitManaLeech, 40);
  assert.equal(p.props.manaRegen, 6);
  assert.equal(p.props.di, 40);
  assert.equal(p.strReq, 55);
  assert.equal(p.twoHanded, true);
  assert.equal(p.skillReq, "swordsmanship");
  assert.deepEqual(p.extras.durability, [57, 57]);
  assert.deepEqual(p.extras["weapon damage"], [12, 15]);
  assert.equal(p.extras["weapon speed"], 2.5);
  assert.equal(p.rarity, "Lesser Magic Item");
  assert.deepEqual(p.tags, ["antique"]);
  assert.equal(p.props.tagPenalty, 1.5);
});

test("[smoke] FCR is not double-counted as FC, SDI is not DI", () => {
  const p = parseTooltip(["Ring", "Faster Cast Recovery 3", "Faster Casting 1", "Spell Damage Increase 12%", "Damage Increase 5%"]);
  assert.deepEqual(p.props, { fcr: 3, fc: 1, sdi: 12, di: 5 });
});

// A minus sign counts only when it sits immediately before the digits ("-1", not "- 1") — a stray
// "\D*" used to swallow the sign and read "Faster Casting -1" as +1 (the only negative standard
// property found across the owner's 24 real scans, 212 lines).
test("[smoke] a negative property value (Faster Casting -1) is read as negative, not positive", () => {
  const neg = parseTooltip(["Ring", "Faster Casting -1"]);
  assert.equal(neg.props.fc, -1);
  const pos = parseTooltip(["Ring", "Faster Casting 1"]);
  assert.equal(pos.props.fc, 1);
  // FCR still wins its own key and is not folded into fc alongside a negative fc
  const both = parseTooltip(["Ring", "Faster Cast Recovery 3", "Faster Casting -1"]);
  assert.deepEqual(both.props, { fcr: 3, fc: -1 });
});

test("[fast] a percent property is unaffected by the negative-value fix", () => {
  const p = parseTooltip(["Ring", "Lower Mana Cost 8%"]);
  assert.equal(p.props.lmc, 8);
});

test("[fast] a weapon damage range is unaffected by the negative-value fix — the low end is not misread as negative", () => {
  const p = parseTooltip(["Sword", "Weapon Damage 13 - 16"]);
  assert.deepEqual(p.extras["weapon damage"], [13, 16]);
});

test("[fast] a dash separated from its number by a space is not read as negative", () => {
  const p = parseTooltip(["Trinket", "Spectral Resonance - 1"]);
  assert.equal(Object.values(p.props).some((v) => v < 0), false, "no modeled property reads negative");
  assert.equal(Object.values(p.extras).flat().some((v) => v < 0), false, "no extra reads negative");
  // the general extras line still captures the number itself, positively — only the sign-adjacency rule is under test
  const key = Object.keys(p.extras).find((k) => k.trim() === "spectral resonance");
  assert.equal(p.extras[key], 1);
});

test("[fast] end to end: an item whose tooltip reads Faster Casting -1 contributes -1 to totalsOf for a suit containing it", () => {
  const parsed = parseTooltip(["Cursed Ring", "Faster Casting -1"]);
  const it = toOptItem({ serial: 1, name: parsed.name, slot: "ring", props: parsed.props, extras: parsed.extras });
  const totals = totalsOf({ ring: it });
  assert.equal(totals.fc, -1);
});

test("[fast] skill bonuses and slayers land in extras/flags for searching", () => {
  const p = parseTooltip(["Bracelet of Sorcery", "Chivalry +10", "Healing +20", "Orc Slayer", "Night Sight"]);
  assert.equal(p.extras.chivalry, 10);
  assert.equal(p.extras.healing, 20);
  assert.ok(p.flags.includes("orc slayer"));
  assert.ok(p.flags.includes("night sight"));
});

// ---- classifier ---------------------------------------------------------------------------
test("[smoke] classify: names map to optimizer slots, containers/consumables are not gear", () => {
  assert.equal(classify("Leather Gorget").slot, "neck");
  assert.equal(classify("Woodland Chest").slot, "chest");
  assert.equal(classify("Arcane Leaf Tonlet Of Restoration").slot, "legs");
  assert.equal(classify("Plate Hiro Sode").slot, "arms");
  assert.equal(classify("Ninja Tabi").slot, "feet");
  assert.equal(classify("Metal Kite Shield").slot, "twoHanded");
  assert.equal(classify("Metal Kite Shield").twoHanded, false);
  assert.equal(classify("Composite Bow").twoHanded, true);
  assert.equal(classify("Arcane Crescent Blade", parseTooltip(["Arcane Crescent Blade", "Two-handed Weapon"])).slot, "twoHanded");
  assert.equal(classify("Katana", parseTooltip(["Katana", "One-handed Weapon"])).slot, "oneHanded");
  assert.equal(classify("Bandage").gear, false);
  assert.equal(classify("Bag of Sending").gear, false);
  assert.equal(classify("Greater Heal Potion").gear, false);
  assert.equal(classify("Blade Spirits").gear, false);
  assert.equal(classify("Mystic Ring").slot, "ring");
  assert.equal(classify("Mystic Heater Shield").slot, "twoHanded");
  assert.equal(classify("Book Of Chivalry").slot, "oneHanded");
});

test("[fast] classify: equipped layer wins over the name", () => {
  assert.equal(classify("Weird Thing", null, "Torso").slot, "chest");
  assert.equal(classify("Chainmail Leggings", null, "Pants").slot, "legs");
});

test("[fast] slayersOf reads slayer lines and the classic names", () => {
  assert.deepEqual(slayersOf(["orc slayer", "night sight"]), ["Orc"]);
  assert.deepEqual(slayersOf(["silver"]), ["Undead (Silver)"]);
  assert.deepEqual(slayersOf(["earth elemental slayer", "repond"]), ["Earth Elemental", "Repond (humanoids)"]);
  assert.deepEqual(slayersOf(["mage armor"]), []);
});

test("[smoke] medableOf: materials, Mage Armor and Spell Channeling decide meditation safety", () => {
  assert.equal(medableOf("Fortified Bone Armor Of Wizardry", "chest", true, []), false);
  assert.equal(medableOf("Fortified Bone Armor Of Wizardry", "chest", true, ["mage armor"]), true);
  assert.equal(medableOf("Leather Gorget", "neck", true, []), true);
  assert.equal(medableOf("Leaf Tonlet", "legs", true, []), true);
  assert.equal(medableOf("Woodland Chest", "chest", true, []), false);
  assert.equal(medableOf("Studded Tunic", "chest", true, []), false);
  assert.equal(medableOf("Norse Helm", "helmet", true, []), false);
  assert.equal(medableOf("Close Helmet Of Restoration", "helmet", true, []), false);
  assert.equal(medableOf("Bascinet", "helmet", true, []), false);
  assert.equal(medableOf("Leather Jingasa", "helmet", true, []), true);
  assert.equal(medableOf("Skullcap", "helmet", true, []), true);
  assert.equal(medableOf("Orcish Kin Mask", "helmet", true, []), true);
  assert.equal(medableOf("Chainmail Coif", "helmet", true, []), false);
  assert.equal(medableOf("Metal Kite Shield", "twoHanded", true, []), false);
  assert.equal(medableOf("Metal Kite Shield", "twoHanded", true, ["spell channeling"]), true);
  assert.equal(medableOf("Book Of Chivalry", "oneHanded", true, []), true);
  assert.equal(medableOf("Arcane Ring", "ring", true, []), true);
  assert.equal(medableOf("Black Pearl", null, false, []), true);
});

test("[smoke] kindOf: non-gear names get a kind, unknown names with props are gear", () => {
  assert.equal(kindOf("Black Pearl"), "reagent");
  assert.equal(kindOf("Spiders' Silk"), "reagent");
  assert.equal(kindOf("Batwing"), "reagent");
  assert.equal(kindOf("Greater Heal Potion"), "potion");
  assert.equal(kindOf("Bandage"), "bandage");
  assert.equal(kindOf("Gold Coin"), "currency");
  assert.equal(kindOf("Iron Ingot"), "resource");
  assert.equal(kindOf("Scroll Of Transcendence"), "scroll");
  assert.equal(kindOf("Treasure Map"), "map");
  assert.equal(kindOf("Recall Rune"), "rune");
  assert.equal(kindOf("Bag Of Sending"), "container");
  assert.equal(kindOf("Diamond"), "gem");
  assert.equal(kindOf("Weird Trinket", parseTooltip(["Weird Trinket", "Luck 100"])), "gear");
  assert.equal(kindOf("Weird Trinket"), "other");
  assert.equal(kindOf("Greater Heal"), "scroll");
  assert.equal(kindOf("Vengeful Spirit"), "scroll");
  assert.equal(kindOf("Varnish Of Fortification"), "refinement");
  assert.equal(parseTooltip(["2 Greater Heal"]).name, "Greater Heal");
  assert.equal(classify("Elven Glasses Of Restoration").slot, "helmet");
});

// ---- fold ---------------------------------------------------------------------------------
// The fixtures on disk are v1 (the shape the TazUO adapters actually write); foldSnapshots requires
// v2, so every fixture and every inline snapshot literal in this file is upgraded before folding.
// kestrelV1/dorranV1 are kept around for the tests below that need to build their OWN v1-shaped
// literal (e.g. to exercise a specific upgrade behaviour) rather than the already-upgraded fixture.
const kestrelV1 = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));
const dorranV1 = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Dorran.json"), "utf8"));
const kestrel = upgradeScan(kestrelV1, { shard: "test" });
const dorran = upgradeScan(dorranV1, { shard: "test" });

test("[fast] fold: every item gets a kind; groupByName totals stacks", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  assert.ok(Object.values(inv.items).every((i) => i.kind));
  const g = groupByName([{ name: "Iron Ingot", kind: "resource", amount: 100, location: { text: "A" } }, { name: "Iron Ingot", kind: "resource", amount: 50, location: { text: "B" } }]);
  assert.equal(g.length, 1); assert.equal(g[0].amount, 150); assert.equal(g[0].stacks, 2); assert.equal(g[0].locations.get("B"), 50);
});

test("[fast] fold: a root container is a place, not an item; items inside it get a location", () => {
  const inv = foldSnapshots([kestrel]);
  assert.ok(!inv.items[kestrel.roots[0].serial], "the chest itself is a place, not an item");
  const inChest = Object.values(inv.items).filter((i) => i.location.kind === "ground");
  assert.ok(inChest.length > 0);
  assert.ok(inChest.every((i) => i.location.text === "Metal Chest"));
});

test("[smoke] fold: worn gear is located on its wearer, pack items in the pack", () => {
  const inv = foldSnapshots([dorran, kestrel]);
  assert.equal(Object.keys(inv.characters).length, 2);
  const worn = Object.values(inv.items).filter((i) => i.equippedBy === "Dorran");
  assert.ok(worn.length >= 6, `Dorran wears ${worn.length}`);
  for (const i of worn) assert.equal(i.location.text, "Worn by Dorran");
  const dorranRoots = new Set(inv.scans.find((s) => s.character === "Dorran").roots);
  const packed = Object.values(inv.items).filter((i) => !i.equippedBy && dorranRoots.has(i.root));
  assert.ok(packed.length > 0, "Dorran has packed items");
  for (const i of packed) assert.equal(i.location.character, "Dorran");
});

test("[smoke] pools: another character's worn gear is skipped unless allowOthersWorn", () => {
  const inv = foldSnapshots([dorran, kestrel]);
  const dorranWorn = Object.values(inv.items).filter((i) => i.equippedBy === "Dorran" && i.gear);
  const { skipped } = buildPools(inv, "Kestrel", { strength: 30 });
  for (const it of dorranWorn) assert.ok(skipped.worn.some((s) => s.serial === it.serial), `${it.name} skipped`);
  const all = buildPools(inv, "Kestrel", { allowOthersWorn: true });
  const inAll = new Set(Object.values(all.pools).flat().map((i) => i.serial));
  assert.ok(dorranWorn.some((it) => inAll.has(it.serial)), "at least one of Dorran's pieces enters Kestrel's pools");
});

test("[smoke] fold: a later scan of the same root replaces its contents, order-independent", () => {
  const later = JSON.parse(JSON.stringify(kestrel));
  later.scannedAt = "2026-09-11T10:00:00+00:00";
  later.items = later.items.slice(0, Math.floor(later.items.length / 2));   // half the chest emptied
  const a = foldSnapshots([kestrel, later]), b = foldSnapshots([later, kestrel]);
  assert.equal(Object.keys(a.items).length, Object.keys(b.items).length);
  assert.equal(Object.keys(a.items).length, later.items.length + kestrel.equipped.length);
});

test("[fast] fold: scans order by epoch, not string comparison of scannedAt — a 09:30+01:00 scan is later than a 10:00+02:00 one", () => {
  const root = kestrel.roots[0].serial;
  const mkScan = (scannedAt, itemSerial, itemName) => ({
    schemaVersion: 2, character: "Kestrel", scannedAt,
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: kestrel.stats, equipped: [],
    roots: [{ serial: root, kind: "ground", name: "Metal Chest", opened: true }],
    containers: { [root]: kestrel.containers[root] },
    items: [{ serial: itemSerial, name: itemName, tooltip: [itemName], amount: 1, container: root, nameSource: "opl" }],
  });
  const earlierByEpoch = mkScan("2026-09-11T10:00:00+02:00", 101, "Early Item");   // 08:00 UTC
  const laterByEpoch = mkScan("2026-09-11T09:30:00+01:00", 102, "Late Item");      // 08:30 UTC — later, despite the smaller clock time
  const inv = foldSnapshots([earlierByEpoch, laterByEpoch]);
  assert.ok(!inv.items[101], "the earlier-by-epoch scan's item should have been replaced");
  assert.ok(inv.items[102], "the later-by-epoch scan's item should have won the root");
});

test("[fast] fold: a scan that skipped a container keeps what was known about it", () => {
  const bag = { 10: { serial: 10, root: 10, parent: null, kind: "backpack", name: "Backpack" } };
  const fullRaw = { version: 1, character: "Dorran", scannedAt: "2026-09-11T00:00:00", stats: {}, equipped: [],
    roots: [{ serial: 10, kind: "backpack", name: "Backpack" }, { serial: 20, kind: "bank", name: "Bank box" }],
    containers: { ...bag, 20: { serial: 20, root: 20, parent: null, kind: "bank", name: "Bank box" } },
    items: [{ serial: 1, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: 20 }] };
  const full = upgradeScan(fullRaw, { shard: "test" });
  const later = { ...full, scannedAt: "2026-09-11T10:00:00+00:00", roots: full.roots.filter((r) => r.kind === "backpack"), items: [] };
  const inv = foldSnapshots([full, later]);
  assert.ok(Object.values(inv.items).some((i) => i.root === 20), "bank contents survived a scan that only listed the backpack");
});

test("[fast] fold: tombstone scans (pseudo character) do not create a character", () => {
  const root = kestrel.roots[0].serial;
  const tombRaw = { version: 1, character: "_vault", scannedAt: "2026-09-12T00:00:00", equipped: [], roots: [{ serial: root, kind: "ground", name: "x" }], containers: {}, items: [] };
  const tomb = upgradeScan(tombRaw, { shard: "test" });
  const inv = foldSnapshots([kestrel, tomb]);
  assert.ok(!inv.characters._vault);
  assert.ok(!Object.values(inv.items).some((i) => i.root === root));
});

test("[fast] fold: a Forget tombstone (v2, stamped toISOString()) one wall-clock second after a v1 scan (upgraded, naive-local stamp) still wins", () => {
  // Regression for the old UTC-vs-local scannedAt mismatch, now solved by ordering on epoch
  // (parseStamp) instead of string comparison: a v1 adapter scan carries a naive local stamp
  // (upgraded to RFC 3339 with this machine's offset), and the server's /api/forget tombstone is
  // now written as v2 with a plain toISOString() UTC stamp — the two must still compare correctly
  // by real elapsed time regardless of the local timezone offset.
  const localStamp = (d) => {
    const p2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };
  const root = kestrel.roots[0].serial;
  const scanTime = new Date();
  const scanRaw = { ...kestrelV1, scannedAt: localStamp(scanTime) };
  const scan = upgradeScan(scanRaw, { shard: "test" });
  const tombTime = new Date(scanTime.getTime() + 1000);
  const tomb = {
    schemaVersion: 2, character: "_vault", scannedAt: tombTime.toISOString(),
    adapter: { id: "app", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, equipped: [], roots: [{ serial: root, kind: "ground", name: "x", opened: true }], containers: {}, items: [],
  };
  const inv = foldSnapshots([scan, tomb]);
  assert.ok(!Object.values(inv.items).some((i) => i.root === root), "the later tombstone dropped the root's contents");
});

test("[smoke] fold: a quick refresh (backpack as the only root) replaces the worn set, keeps the bank and relocates a taken-off piece", () => {
  const bag = { 10: { serial: 10, root: 10, parent: null, kind: "backpack", name: "Backpack" } };
  const fullRaw = { version: 1, character: "Dorran", scannedAt: "2026-09-12T10:00:00", stats: { str: 100 },
    equipped: [{ serial: 1, name: "Old Gorget", tooltip: ["Old Gorget", "Physical Resist 5%"], amount: 1, layer: "neck" }],
    roots: [{ serial: 10, kind: "backpack", name: "Backpack" }, { serial: 20, kind: "bank", name: "Bank box" }],
    containers: { ...bag, 20: { serial: 20, root: 20, parent: null, kind: "bank", name: "Bank box" } },
    items: [{ serial: 2, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: 10 },
      { serial: 3, name: "Longsword", tooltip: ["Longsword", "Damage Increase 10%"], amount: 1, container: 20 }] };
  const quickRaw = { version: 1, character: "Dorran", scannedAt: "2026-09-12T11:00:00", stats: { str: 105 }, meta: { mode: "quick" },
    equipped: [{ serial: 4, name: "New Gorget", tooltip: ["New Gorget", "Physical Resist 9%"], amount: 1, layer: "neck" }],
    roots: [{ serial: 10, kind: "backpack", name: "Backpack" }], containers: bag,
    items: [{ serial: 1, name: "Old Gorget", tooltip: ["Old Gorget", "Physical Resist 5%"], amount: 1, container: 10 },
      { serial: 2, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: 10 }] };
  const full = upgradeScan(fullRaw, { shard: "test" });
  const quick = upgradeScan(quickRaw, { shard: "test" });
  const inv = foldSnapshots([full, quick]);
  assert.equal(inv.items[1].location.text, "Dorran's backpack");   // the piece just taken off is relocated, not lost
  assert.equal(inv.items[3].location.text, "Dorran's bank");       // an unlisted root keeps its last scan
  assert.ok(inv.containers[20]);
  assert.deepEqual(inv.characters.Dorran.equipped, [4]);
  assert.equal(inv.characters.Dorran.stats.str, 105);
  assert.deepEqual(inv.scans[1].roots, [10]);
  const bare = foldSnapshots([full, { ...quick, roots: [], containers: {}, items: [] }]);
  assert.equal(bare.items[1], undefined);                        // why the backpack root is mandatory
});

test("[fast] fold: a root listed with opened:false keeps its previous contents; opened:true empties it", () => {
  // All-explicit-offset v2 literals (no naive-local upgrade) so the epoch ordering is deterministic
  // regardless of the machine's own timezone.
  const root = 900001;
  const mkScan = (scannedAt, opened, items) => ({
    schemaVersion: 2, character: "Dorran", scannedAt,
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, equipped: [],
    roots: [{ serial: root, kind: "backpack", name: "Backpack", opened }],
    containers: { [root]: { serial: root, root, parent: null, kind: "backpack", name: "Backpack" } },
    items,
  });
  const full = mkScan("2026-09-13T00:00:00+00:00", true, [{ serial: 1, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: root, nameSource: "opl" }]);

  const failedOpen = mkScan("2026-09-13T01:00:00+00:00", false, []);
  const keptInv = foldSnapshots([full, failedOpen]);
  assert.ok(Object.values(keptInv.items).some((i) => i.serial === 1 && i.root === root), "opened:false keeps what was known about the root");

  const reallyEmptied = mkScan("2026-09-13T02:00:00+00:00", true, []);
  const emptiedInv = foldSnapshots([full, reallyEmptied]);
  assert.ok(!Object.values(emptiedInv.items).some((i) => i.serial === 1), "opened:true with no items empties the root");
});

test("[fast] fold: a character's adapter identity is exposed on inv.characters for the bridge buttons to read", () => {
  const inv = foldSnapshots([kestrel]);
  assert.equal(inv.characters.Kestrel.adapter.id, "tazuo");
  assert.deepEqual(inv.characters.Kestrel.adapter.capabilities.bridge, ["highlight", "grab", "goto"]);
});

test("[fast] bagLabel prefers the engraving", () => {
  assert.equal(bagLabel({ serial: 1, name: "Bag", tooltip: ["Bag", "Engraved: DEXXER armor"] }), "DEXXER armor");
  assert.equal(bagLabel({ serial: 1, name: "Metal Chest", tooltip: ["Metal Chest"] }), "Metal Chest");
});

// ---- pools --------------------------------------------------------------------------------
test("[smoke] buildPools: other characters' worn gear is excluded by default, STR-gated, tag-filtered", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  const { pools, current, skipped } = buildPools(inv, "Kestrel", { strength: 30, excludeTags: ["cursed"] });
  assert.ok(current.chest, "current chest read from equipped");
  const dorranWeapon = Object.values(inv.items).find((i) => i.equippedBy === "Dorran" && (i.slot === "oneHanded" || i.slot === "twoHanded"));
  assert.ok(skipped.worn.some((i) => i.serial === dorranWeapon.serial), "Dorran's weapon skipped");
  assert.ok(!pools[dorranWeapon.slot]?.some((i) => i.serial === dorranWeapon.serial));
  assert.ok(skipped.str.length > 0, "some weapons too heavy for STR 30");
  assert.ok(skipped.tags.every((i) => i.tags.includes("cursed")));
  const all = buildPools(inv, "Kestrel", { allowOthersWorn: true });
  assert.ok(all.pools[dorranWeapon.slot].some((i) => i.serial === dorranWeapon.serial));
});

test("[fast] gargoyle gear is flagged and excluded from pools by default", () => {
  const snap = { ...kestrel, scannedAt: "2026-09-12T00:00:00+00:00", items: [...kestrel.items, { serial: 0x7fff0099, name: "Gargish Platemail Leggings Of Vitality", tooltip: ["Gargish Platemail Leggings Of Vitality", "Physical Resist 10%"], amount: 1, container: kestrel.roots[0].serial }] };
  const inv = foldSnapshots([snap]);
  const g = inv.items[0x7fff0099];
  assert.equal(g.gargoyle, true); assert.equal(g.slot, "legs");
  assert.ok(!buildPools(inv, "Kestrel").pools.legs?.some((i) => i.serial === g.serial));
  assert.ok(buildPools(inv, "Kestrel", { excludeGargoyle: false }).pools.legs.some((i) => i.serial === g.serial));
});

test("[fast] requirementReport marks floors met/unmet and caps", () => {
  const rows = requirementReport({ lrc: 100, lmc: 25, fc: 2 }, { weights: { lrc: 1, lmc: 1, fc: 1, fcr: 1 }, floors: { lrc: 100, lmc: 40 }, caps: { lrc: 100, lmc: 40, fc: 2 } });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.lrc.met, true); assert.equal(by.lrc.capped, true);
  assert.equal(by.lmc.met, false);
  assert.equal(by.fc.met, null); assert.equal(by.fc.capped, true);
  assert.equal(by.fcr.value, 0);
});

test("[fast] propertyKeys lists the modeled properties present", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  const keys = propertyKeys(inv);
  assert.ok(keys.includes("hci") && keys.includes("lrc") && !keys.includes("tagPenalty"));
});

// ---- suit builder: weapon filter, saved runs ---------------------------------------------------
test("[fast] weapon filter: archery keeps only bows in the hands; melee keeps shields and drops spellbooks", () => {
  const mk = (serial, slot, extra = {}) => ({ serial, name: `i${serial}`, slot, gear: true, props: { hci: 1 }, tags: [], strReq: 0, root: 1, equippedBy: null, gargoyle: false, medable: true, ...extra });
  const inv = { items: {
    1: mk(1, "twoHanded", { twoHanded: true, skillReq: "archery" }),
    2: mk(2, "oneHanded", { skillReq: "swordsmanship" }),
    3: mk(3, "twoHanded", {}),                                                                   // a shield
    4: mk(4, "oneHanded", {}),                                                                   // a spellbook
    5: mk(5, "twoHanded", { twoHanded: true, skillReq: "swordsmanship", equippedBy: "Kestrel", root: null }),
    6: mk(6, "helmet", {}),
  } };
  const a = buildPools(inv, "Kestrel", { weaponSkill: "archery" });
  assert.deepEqual((a.pools.twoHanded || []).map((i) => i.serial), [1]);
  assert.equal((a.pools.oneHanded || []).length, 0);
  assert.deepEqual(a.pools.helmet.map((i) => i.serial), [6]);
  assert.deepEqual(a.blocked, ["twoHanded"], "the worn greatsword may not stay a candidate");
  assert.equal(a.skipped.weapon.length, 4);
  const sw = buildPools(inv, "Kestrel", { weaponSkill: "swordsmanship" });
  assert.deepEqual(sw.pools.oneHanded.map((i) => i.serial), [2]);
  assert.deepEqual(sw.pools.twoHanded.map((i) => i.serial).sort(), [3, 5]);
  assert.deepEqual(sw.blocked, []);
  assert.equal(buildPools(inv, "Kestrel", {}).pools.oneHanded.length, 2);
  assert.ok(weaponAllowed({ slot: "ring" }, "archery"));
});

test("[fast] settingsDiff names what changed between two runs", () => {
  const a = { floors: { di: 40, hci: 35 }, softFloors: [], weights: { ssi: 10 }, lockedSlots: [], weaponSkill: "", exact: true, budgetMs: 300000, strLimit: 73 };
  const b = { floors: { di: 80 }, softFloors: ["di"], weights: { ssi: 5, dci: 8 }, lockedSlots: ["twoHanded"], weaponSkill: "archery", exact: true, budgetMs: 60000, strLimit: 73 };
  const d = settingsDiff(a, b);
  const L = (k) => PROP_LABELS[k] || k;
  for (const want of [`${L("di")} floor 40 → 80`, `${L("hci")} floor 35 removed`, `${L("ssi")} weight 10 → 5`, `${L("dci")} weight 8 added`, `${L("di")} floor made soft`, "weapons any → archery", "budget 300 s → 60 s"])
    assert.ok(d.includes(want), `missing "${want}" in ${JSON.stringify(d)}`);
  assert.ok(d.some((x) => x.startsWith("locked ")));
  assert.deepEqual(settingsDiff(a, a), []);
});

// ---- templates ----------------------------------------------------------------------------
const OLD_PROFILES = {
  _comment: "x", caps: { hci: 45 },
  characters: { Dorran: { archetype: "melee", weights: { hci: 10 }, floors: { hci: 35 }, race: "human", weaponSkill: "swordsmanship" }, Kestrel: { archetype: "caster", weights: {}, floors: {}, medOnly: true } },
  archetypes: { melee: { weights: { hci: 10, dci: 10 }, floors: { physResist: 65 } }, caster: { weights: { fc: 60 }, floors: { lrc: 100 } } },
};
test("[smoke] migrateProfiles: archetypes become templates with defaulted fields, characters gain template from their archetype", () => {
  const { profiles, changed } = migrateProfiles(OLD_PROFILES);
  assert.equal(changed, true);
  assert.ok(!("archetypes" in profiles));
  assert.deepEqual(Object.keys(profiles.templates), ["melee", "caster"]);
  assert.deepEqual(profiles.templates.melee.weights, { hci: 10, dci: 10 });
  assert.deepEqual(profiles.templates.melee.floors, { physResist: 65 });
  assert.deepEqual(Object.keys(profiles.templates.melee).sort(), [...TEMPLATE_KEYS].sort());
  assert.deepEqual(profiles.templates.caster.lockedSlots, []);
  assert.equal(profiles.templates.caster.medOnly, false);
  assert.equal(profiles.characters.Dorran.template, "melee");
  assert.equal(profiles.characters.Kestrel.template, "caster");
  assert.ok(!("archetype" in profiles.characters.Dorran));
  assert.equal(profiles.characters.Dorran.weaponSkill, "swordsmanship", "the character's own settings survive");
  assert.ok(!("caps" in profiles), "caps moved out of profiles.json into the shard's rules file (schemaVersion 2)");
  assert.equal(profiles.schemaVersion, 2);
  assert.equal(OLD_PROFILES.characters.Dorran.archetype, "melee", "pure: the input is untouched");
});

test("[fast] migrateProfiles is idempotent on the new shape", () => {
  const once = migrateProfiles(OLD_PROFILES).profiles;
  const again = migrateProfiles(once);
  assert.equal(again.changed, false);
  assert.deepEqual(again.profiles, once);
  const keep = migrateProfiles({ templates: { t: templateFrom({}) }, characters: { A: { template: "t", archetype: "melee", floors: {} } } });
  assert.equal(keep.profiles.characters.A.template, "t", "an existing template name wins over a leftover archetype");
  assert.ok(!("archetype" in keep.profiles.characters.A));
});
test("[fast] profiles: migrateProfiles stamps schemaVersion 2 and drops a v1 caps object", () => {
  assert.equal(migrateProfiles({ characters: {}, templates: {} }).profiles.schemaVersion, 2);
  const { profiles, changed } = migrateProfiles({ schemaVersion: 1, caps: { hci: 45 }, characters: {}, templates: {} });
  assert.equal(changed, true);
  assert.ok(!("caps" in profiles));
  assert.equal(profiles.schemaVersion, 2);
  const again = migrateProfiles(profiles);
  assert.equal(again.changed, false, "a v2 file with no caps is left alone");
});

test("[fast] templateFrom snapshots the builder settings without race, STR limit or skipped containers", () => {
  const t = templateFrom({ floors: { hci: 45 }, weights: { di: 6 }, softFloors: ["hci"], lockedSlots: ["twoHanded"], excludeTags: ["cursed"], excludeSkills: ["necromancy"],
    allowOthersWorn: true, allowGargoyle: false, medOnly: true, weaponSkill: "archery", race: "elf", strLimit: 95, excludeRoots: [123], template: "archer", floorBonus: 500 });
  assert.deepEqual(Object.keys(t).sort(), [...TEMPLATE_KEYS].sort());
  assert.ok(!("race" in t) && !("strLimit" in t) && !("excludeRoots" in t) && !("template" in t));
  assert.equal(t.weaponSkill, "archery");
  assert.equal(t.floorBonus, 500);
  assert.equal(t.allowOthersWorn, true);
  assert.deepEqual(templateFrom({}).excludeTags, []);
  assert.equal(templateFrom({ weaponSkill: "" }).weaponSkill, null);
});

test("[fast] template drift: settingsDiff between a template and a profile ignores race and STR, names real changes", () => {
  const tpl = templateFrom({ floors: { hci: 45 }, weights: { di: 6 }, lockedSlots: ["twoHanded"], weaponSkill: "archery" });
  const same = { ...tpl, race: "elf", strLimit: 95, excludeRoots: [1], template: "archer" };
  assert.deepEqual(settingsDiff(tpl, templateFrom(same)), []);
  const drift = settingsDiff(tpl, templateFrom({ ...same, floors: { hci: 40 }, allowOthersWorn: true, medOnly: true, lockedSlots: [] }));
  assert.ok(drift.includes(`${PROP_LABELS.hci} floor 45 → 40`), JSON.stringify(drift));
  assert.ok(drift.includes("others' worn gear allowed"));
  assert.ok(drift.includes("meditation-safe only"));
  assert.ok(drift.some((x) => x.startsWith("unlocked ")));
});

test("[fast] effectiveProfile: resist floors and caps are paperdoll values, less the Resisting Spells bonus; an Elf's energy cap is 75 (uoalive rules)", () => {
  const e = effectiveProfile({ floors: { physResist: 70, energyResist: 75, hci: 40 }, softFloors: ["hci"], weights: { hci: 1 }, race: "elf" }, { skills: { "Resisting Spells": { value: 41.5 } } });
  assert.equal(e.resistBonus, 16);
  assert.equal(e.caps.physResist, 54); assert.equal(e.caps.energyResist, 59);
  assert.equal(e.floors.physResist, 54); assert.equal(e.floors.energyResist, 59); assert.equal(e.floors.hci, 40);
  assert.deepEqual(e.hardFloors.sort(), ["energyResist", "physResist"]);
  const h = effectiveProfile({ floors: { energyResist: 75 } }, null);
  assert.equal(h.caps.energyResist, 70); assert.equal(h.floors.energyResist, 70, "a human's energy floor is clamped to the 70 cap");
  assert.equal(resistSkillBonus({ "Resisting Spells": { value: 120 } }), 44);
  assert.equal(resistSkillBonus({ "Resisting Spells": { value: 100 } }), 40);
  assert.equal(resistSkillBonus({ "Resisting Spells": { value: 50 } }), 20);
  assert.ok(settingsDiff({ race: "human" }, { race: "elf", excludeSkills: ["necromancy"] }).includes("race human → elf"));
});

test("[fast] getRules()/setRules() and resistSkillBonus() are shard-swappable: generic-osi has no flat Resisting Spells bonus", () => {
  const uoalive = getRules();
  try {
    assert.throws(() => { setRules(null); getRules(); }, /rules not loaded/);
    const genericOsi = JSON.parse(readFileSync(join(HERE, "rules", "generic-osi.json"), "utf8"));
    setRules(genericOsi);
    assert.equal(resistSkillBonus({ "Resisting Spells": { value: 120 } }), 0);
    assert.ok(!("massive" in tagUnits()));
    const eGeneric = effectiveProfile({ race: "elf", floors: { energyResist: 75 } }, null);
    assert.equal(eGeneric.caps.energyResist, 75, "raceCaps.elf.energyResist is the same 75 on generic-osi");
  } finally {
    setRules(uoalive);   // restore for every test after this one in the file, even if an assertion above throws
  }
});

test("[fast] pool items carry stamina/mana/hits pools and skill bonuses; forbidden skill bonuses are left out, even when worn", () => {
  const it = { serial: 9, name: "x", slot: "ring", gear: true, props: { dexBonus: 5, stamInc: 3, intBonus: 2, strBonus: 4, hpi: 2 }, extras: { magery: 10, necromancy: 5, durability: [1, 1] },
    tags: [], strReq: 0, root: 1, equippedBy: null, gargoyle: false, medable: true };
  const o = toOptItem(it);
  assert.equal(o.props.stamPool, 8); assert.equal(o.props.manaPool, 2); assert.equal(o.props.hitsPool, 4);
  assert.equal(o.props["sk:magery"], 10); assert.equal(o.props["sk:necromancy"], 5); assert.equal(o.props["sk:durability"], undefined);
  const inv = { items: { 9: it, 10: { ...it, serial: 10, extras: { magery: 5 } } } };
  const pb = buildPools(inv, "Kestrel", { excludeSkills: ["necromancy", "spirit speak"] });
  assert.deepEqual(pb.pools.ring.map((i) => i.serial), [10]);
  assert.equal(pb.skipped.skill.length, 1);
  assert.deepEqual(buildPools({ items: { 9: { ...it, equippedBy: "Kestrel", root: null } } }, "Kestrel", { excludeSkills: ["necromancy"] }).blocked, ["ring"]);
  assert.equal(labelOf("sk:evaluate intelligence"), "+Evaluate Intelligence");
  assert.ok(builderKeys(inv).includes("sk:magery") && builderKeys(inv).includes("stamPool"));
});

test("[fast] saved runs: the key ignores budget and warm start; a run is reused only when rerunning could not do better", () => {
  const base = { pools: { ring: [{ serial: 1, name: "r", slot: "ring", props: { hci: 5 } }] }, current: {}, profile: { weights: { hci: 1 }, caps: {} }, opts: { restarts: 200, exact: true, timeBudgetMs: 300000 } };
  const k = runKey(base);
  assert.equal(runKey({ ...base, opts: { ...base.opts, timeBudgetMs: 5000, warmStart: { ring: 1 } } }), k);
  assert.notEqual(runKey({ ...base, profile: { ...base.profile, floors: { hci: 5 } } }), k);
  assert.notEqual(runKey({ ...base, opts: { ...base.opts, exact: false } }), k);
  const proven = { key: k, budgetMs: 1000, result: { method: "exact", proven: true } };
  const unproven = { key: k, budgetMs: 60000, result: { method: "exact", proven: false } };
  assert.equal(reusableRun([proven], k, { timeBudgetMs: 300000 }), proven);
  assert.equal(reusableRun([unproven], k, { timeBudgetMs: 300000 }), null, "a bigger budget could finish the proof");
  assert.equal(reusableRun([unproven], k, { timeBudgetMs: 30000 }), unproven);
  assert.equal(reusableRun([{ key: k, result: { method: "heuristic" } }], k, {}).result.method, "heuristic");
  assert.equal(reusableRun([proven], "other", {}), null);
  assert.equal(runSummary({ id: "x", result: { method: "exact", proven: true, score: 3 } }).score, 3);
});
test("[fast] runs: normalizeRun upgrades allowOthers/budgetS and stamps schemaVersion", () => {
  const r = normalizeRun({ id: "x", settings: { allowOthers: true, budgetS: 30 }, result: {} });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.settings.allowOthersWorn, true);
  assert.equal("allowOthers" in r.settings, false);
  assert.equal(r.settings.budgetMs, 30000);
  assert.equal("budgetS" in r.settings, false);
  assert.deepEqual(normalizeRun(r), r);   // idempotent
});
test("[fast] settingsDiff: budgets compare in ms and print seconds", () => {
  const d = settingsDiff({ budgetMs: 30000, exact: true }, { budgetMs: 60000, exact: true });
  assert.ok(d.some((l) => l === "budget 30 s → 60 s"), d.join("|"));
});
test("[fast] runs: normalizeRun is applied wherever runs are read, so schemaVersion and allowOthersWorn reach the list endpoint", () => {
  const old = { id: "y", character: "Dorran", result: { method: "exact", proven: true }, settings: { allowOthers: false, budgetS: 45 } };
  const s = runSummary(normalizeRun(old));
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.settings.allowOthersWorn, false);
  assert.equal(s.settings.budgetMs, 45000);
});
test("[fast] fold: a nested container folds whether the scanner said kind \"bag\" (old) or \"container\" (new)", () => {
  const mk = (kind) => upgradeScan({ version: 1, character: "Dorran", scannedAt: "2026-09-13T00:00:00",
    equipped: [], roots: [{ serial: 10, kind: "backpack", name: "Backpack" }],
    containers: { 10: { serial: 10, root: 10, parent: null, kind: "backpack", name: "Backpack" },
      11: { serial: 11, root: 10, parent: 10, kind, name: "Pouch" } },
    items: [] }, { shard: "test" });
  for (const kind of ["bag", "container"]) {
    const inv = foldSnapshots([mk(kind)]);
    assert.equal(inv.items[11].kind, "container", `kind "${kind}" should still fold to a container item`);
  }
});

// ---- optimizer through the same loader the server uses -------------------------------------
// No build step — corePath() resolves straight to scripts/optimizer-core.mts, so this file also runs
// standalone (`node --test app/gear-vault.test.mjs`) with no npm `pretest` hook needed first.
const core = await import(pathToFileURL(corePath()).href);
const demoInv = foldSnapshots([kestrel, dorran]);
const demoProfiles = JSON.parse(readFileSync(join(HERE, "data", "profiles.default.json"), "utf8"));
// Any real profile shape will do here (weights/floors/caps to score item sets) — use the archer
// template so it roughly matches Kestrel's build. caps come from the shard's rules file now that
// profiles.json (schemaVersion 2) no longer carries its own caps object.
const archerProfile = { ...demoProfiles.templates.archer, caps: getRules().caps };
const { pools: demoPools, current: demoCurrent } = buildPools(demoInv, "Kestrel", { strength: 66 });
const res = core.optimizeSuit(demoPools, demoCurrent, archerProfile, { seed: 1, restarts: 20 });

// A self-contained deterministic PRNG factory so each [slow] test below generates its own
// independent random-suit sequence, whatever order or concurrency node:test runs them in.
function createRandomSuit() {
  let sd = 12345;
  const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  const pickInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const PROPS = ["physResist", "fireResist", "hci", "dci", "ssi", "di", "lmc"];
  const SL = ["helmet", "chest", "ring", "neck", "oneHanded", "twoHanded"];
  return function randomSuit() {
    let serial = 1;
    const rp = {};
    for (const slot of SL) {
      rp[slot] = [];
      for (let j = 0, m = pickInt(1, 4); j < m; j++) {
        const props = {};
        for (const k of PROPS) if (rnd() < 0.45) props[k] = pickInt(1, 30);
        if (rnd() < 0.2) props.tagPenalty = pickInt(1, 2);
        const it = { serial: serial++, name: `${slot}-${j}`, slot, props };
        if (slot === "twoHanded" && rnd() < 0.4) it.twoHanded = true;
        rp[slot].push(it);
      }
    }
    const weights = {}, caps = {}, floors = {};
    for (const k of PROPS) { weights[k] = rnd() < 0.15 ? 0 : pickInt(1, 12); if (rnd() < 0.6) caps[k] = pickInt(10, 60); }
    weights.tagPenalty = -pickInt(5, 40);
    for (const k of PROPS) if (rnd() < 0.3) floors[k] = pickInt(5, 50);
    const pr = { weights, caps, floors, floorBonus: pickInt(50, 2000), hardFloors: Object.keys(floors).filter(() => rnd() < 0.5) };
    const optional = SL.filter(() => rnd() < 0.6);
    const lists = SL.map((sl) => [null, ...rp[sl]]);
    let brute = -Infinity;
    const scores = [];
    const walk = (k, a) => {
      if (k === SL.length) { if (a.twoHanded && a.twoHanded.twoHanded && a.oneHanded) return; const sc = core.scoreSet(a, pr); scores.push(sc); if (sc > brute) brute = sc; return; }
      for (const it of lists[k]) walk(k + 1, { ...a, [SL[k]]: it });
    };
    walk(0, {});
    return { rp, pr, optional, brute, scores, SL };
  };
}

test("[fast] optimizer core loads and improves a demo suit", () => {
  assert.ok(res.score >= res.currentScore, "best is at least current");
  assert.ok(Object.keys(res.best).length >= 10);
  const t = totalsOf(res.best);
  assert.ok(t.physResist > 0);
});

test("[slow] exact search matches brute force and proves optimality", { skip: SKIP_SLOW }, (t) => {
  const mk = (slot, i, props, two) => ({ serial: slot.length * 100 + i, name: `${slot}-${i}`, slot, props, ...(two ? { twoHanded: true } : {}) });
  const small = {
    helmet: [mk("helmet", 1, { physResist: 10, hci: 5 }), mk("helmet", 2, { physResist: 4, dci: 12 }), mk("helmet", 3, { hci: 15, tagPenalty: 4 })],
    chest: [mk("chest", 1, { physResist: 20 }), mk("chest", 2, { physResist: 12, dci: 10, hci: 3 }), mk("chest", 3, { dci: 20 })],
    ring: [mk("ring", 1, { hci: 12, dci: 12 }), mk("ring", 2, { physResist: 8, hci: 20 }), mk("ring", 3, { dci: 25 })],
    oneHanded: [mk("oneHanded", 1, { hci: 10 }), mk("oneHanded", 2, { dci: 8, physResist: 5 })],
    twoHanded: [mk("twoHanded", 1, { physResist: 10, dci: 5 }), mk("twoHanded", 2, { hci: 25, dci: 15 }, true)],
  };
  const slots = ["helmet", "chest", "ring", "oneHanded", "twoHanded"];
  const prof = { weights: { physResist: 3, hci: 4, dci: 4, tagPenalty: -25 }, caps: { physResist: 30, hci: 45, dci: 45 }, floors: { physResist: 25 }, floorBonus: 100 };
  // brute force over every combination (nulls allowed everywhere)
  let bruteBest = -Infinity;
  const lists = slots.map((s) => [null, ...small[s]]);
  const walk = (k, a) => {
    if (k === slots.length) {
      if (a.twoHanded && a.twoHanded.twoHanded && a.oneHanded) return;
      const sc = core.scoreSet(a, prof); if (sc > bruteBest) bruteBest = sc; return;
    }
    for (const it of lists[k]) walk(k + 1, { ...a, [slots[k]]: it });
  };
  walk(0, {});
  const ex = core.optimizeSuit(small, {}, prof, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  assert.equal(ex.method, "exact"); assert.equal(ex.proven, true);
  // hard floors: with physResist hard, the optimum must meet 25 phys whenever any suit can
  const hard = core.optimizeSuit(small, {}, { ...prof, hardFloors: ["physResist"] }, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  assert.ok(totalsOf(hard.best).physResist >= 25, "hard floor met");
  // and a soft floor can be traded: make the weights dwarf the floor bonus and check the floor loses
  const softP = { weights: { hci: 400, dci: 400, physResist: 0.1 }, caps: { hci: 100, dci: 100 }, floors: { physResist: 25 }, floorBonus: 100 };
  const soft = core.optimizeSuit(small, {}, softP, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  const hard2 = core.optimizeSuit(small, {}, { ...softP, hardFloors: ["physResist"] }, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  assert.ok(totalsOf(hard2.best).physResist >= 25, "hard floor met even against huge weights");
  assert.ok(soft.score + 1e-6 >= core.scoreSet(hard2.best, softP), "under the soft profile the soft optimum is at least as good as the hard one");
  assert.ok(Math.abs(ex.score - bruteBest) < 1e-6, `exact ${ex.score} vs brute ${bruteBest}`);
  assert.ok(ex.pruned.after <= ex.pruned.before);
  // progress reporting: phases in order, explored fraction monotone and 1 once proven, result unchanged
  const seen = [];
  const exP = core.optimizeSuit(small, {}, prof, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000, progressEveryMs: 0.001, onProgress: (p) => seen.push({ ...p }) });
  assert.equal(exP.score, ex.score, "progress callback does not change the result");
  assert.deepEqual([...new Set(seen.map((p) => p.phase))], ["heuristic", "prune", "exact", "done"]);
  const lastRestarts = seen.filter((p) => p.phase === "heuristic").at(-1);
  assert.equal(lastRestarts.restartsDone, 3); assert.equal(lastRestarts.restarts, 3);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].explored >= seen[i - 1].explored - 1e-12, "explored never goes backwards");
  assert.equal(seen.at(-1).explored, 1, "the whole tree is behind a proven search");
  assert.equal(seen.at(-1).floorsTotal, 1); assert.equal(seen.at(-1).floorsMet, 1);
  assert.ok(seen.at(-1).candidates === ex.pruned.after);
  // and on the demo inventory the exact phase never scores below the heuristic
  const t1 = Date.now();
  const ex2 = core.optimizeSuit(demoPools, demoCurrent, archerProfile, { seed: 1, restarts: 20, exact: true, timeBudgetMs: 8000 });
  assert.ok(ex2.score >= res.score - 1e-6, "exact >= heuristic");
  t.diagnostic(`demo: ${ex2.proven ? "proven" : "budget"}, ${ex2.nodes} nodes, ${Date.now() - t1} ms`);
});

test("[slow] exact search proves the brute-force optimum on 150 random suits", { skip: SKIP_SLOW }, () => {
  const randomSuit = createRandomSuit();
  for (let c = 0; c < 150; c++) {
    const { rp, pr, optional, brute, SL } = randomSuit();
    const r = core.optimizeSuit(rp, {}, pr, { seed: 1, restarts: 0, slots: SL, optionalSlots: optional, exact: true, timeBudgetMs: 10000 });
    assert.ok(r.proven && Math.abs(r.score - brute) < 1e-6, `case ${c}: exact ${r.score} (proven ${r.proven}) vs brute ${brute}`);
  }
});

test("[slow] other suits: exact search lists the next-best scores within the tolerance (brute force)", { skip: SKIP_SLOW }, () => {
  const randomSuit = createRandomSuit();
  for (let c = 0; c < 80; c++) {
    const { rp, pr, optional, brute, scores, SL } = randomSuit();
    const tol = [0, 0, 5, 40][c % 4], count = 3;
    const want = scores.slice().sort((x, y) => y - x);
    const expect = want.slice(1).filter((x) => x >= want[0] - tol - 1e-9).slice(0, count);
    const base = { seed: 1, restarts: 0, slots: SL, optionalSlots: optional };
    const alternatives = { count, tolerance: tol };
    const r = core.optimizeSuit(rp, {}, pr, { ...base, exact: true, timeBudgetMs: 10000, alternatives });
    assert.ok(Math.abs(r.score - brute) < 1e-6, `case ${c}: best ${r.score} vs brute ${brute}`);
    const got = r.alternatives.map((a) => a.score);
    assert.equal(got.length, expect.length, `case ${c}: ${JSON.stringify(got)} vs ${JSON.stringify(expect)}`);
    got.forEach((g, i) => assert.ok(Math.abs(g - expect[i]) < 1e-6, `case ${c} alt ${i}: ${g} vs ${expect[i]}`));
    for (const a of r.alternatives) assert.ok(Math.abs(core.scoreSet(a.best, pr) - a.score) < 1e-6, "reported score matches the suit");
  }
});

test("[fast] a locked one-handed weapon keeps two-handed weapons out of the suit (heuristic and exact)", () => {
  const sword = { serial: 1, name: "Longsword", slot: "oneHanded", props: { di: 5 } };
  const staff = { serial: 2, name: "Bladed Staff", slot: "twoHanded", twoHanded: true, props: { di: 90, ssi: 40 } };
  const shield = { serial: 3, name: "Buckler", slot: "twoHanded", props: { dci: 2 } };
  const pr = { weights: { di: 1, ssi: 1, dci: 1 }, caps: {} };
  const hands = ["oneHanded", "twoHanded"];
  for (const exact of [false, true]) {
    const r = core.optimizeSuit({ oneHanded: [], twoHanded: [staff, shield] }, { oneHanded: sword }, pr, { seed: 1, restarts: 10, slots: hands, optionalSlots: ["twoHanded"], exact });
    assert.equal(r.best.oneHanded && r.best.oneHanded.serial, 1, `exact=${exact}: the locked sword stays`);
    assert.equal(r.best.twoHanded && r.best.twoHanded.serial, 3, `exact=${exact}: the shield, not the two-handed staff`);
  }
  const free = core.optimizeSuit({ oneHanded: [sword], twoHanded: [staff, shield] }, {}, pr, { seed: 1, restarts: 10, slots: hands, optionalSlots: hands, exact: true });
  assert.equal(free.best.twoHanded.serial, 2, "with the hand free the staff wins");
});

// Under the old "\D*" reading, "Faster Casting -1" parsed as +1 and the cursed ring would have won
// this search (fc weighted positively). With the sign read correctly it must lose to the plain ring.
test("[fast] the solver scores a Faster Casting -1 item as a loss, not a gain", () => {
  const plain = { serial: 1, name: "Plain Ring", slot: "ring", props: {} };
  // props come from the real parser, not a hand-written literal, so this test is sensitive to the
  // PROP_PATTERNS fix itself, not just to the (already-correct) solver scoring of a negative.
  const cursed = { serial: 2, name: "Cursed Ring", slot: "ring", props: parseTooltip(["Cursed Ring", "Faster Casting -1"]).props };
  const prof = { weights: { fc: 10 }, caps: {} };
  // Start already wearing the plain ring (a required slot, currently filled, so "equip nothing" is not on
  // the table) with only the cursed ring as a swap candidate. Under the old "\D*" reading FC -1 parsed as
  // +1, which times weight 10 is +10, so the hill climber would have swapped to the cursed ring; read
  // correctly as -1 it scores -10 and must lose to keeping the plain ring.
  const r = core.optimizeSuit({ ring: [cursed] }, { ring: plain }, prof, { seed: 1, restarts: 3, slots: ["ring"], optionalSlots: [], exact: true, timeBudgetMs: 2000 });
  assert.equal(r.best.ring && r.best.ring.serial, plain.serial, "the un-cursed ring must win once FC -1 is read as a loss");
});

test("[slow] warm start never lowers the result and keeps a proven optimum", { skip: SKIP_SLOW }, () => {
  const cold = core.optimizeSuit(demoPools, demoCurrent, archerProfile, { seed: 1, restarts: 20, exact: true, timeBudgetMs: 8000 });
  const warmMap = Object.fromEntries(Object.entries(cold.best).map(([sl, it]) => [sl, it ? it.serial : null]));
  const warm = core.optimizeSuit(demoPools, demoCurrent, archerProfile, { seed: 1, restarts: 0, warmStart: warmMap });
  assert.ok(warm.score >= cold.score - 1e-6, "a warm start at the optimum stays there with no restarts at all");
  const bogus = core.optimizeSuit(demoPools, demoCurrent, archerProfile, { seed: 1, restarts: 20, warmStart: { helmet: 999999999 } });
  assert.ok(bogus.score >= res.score - 1e-6, "an unknown serial is simply ignored");
});
