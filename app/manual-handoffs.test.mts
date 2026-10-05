// manual-handoffs.test.mts — the Suit Builder's Manual ↔ Automatic hand-offs (issue #12): buildPools' pinned pieces
// (each the only candidate for its slot and the slot's current piece, the hand rule kept, a piece another character
// wears allowed, No character's pool of the pieces nobody wears), a manual run's saved shape and key (runs-lib.mts
// manualRun, never reused for a search), an old run still read with the optimizer's slots, and the pure hand-off rules
// in ui/manual-model.mts (a run into Manual's suit, the fillable slots, the fetch list's pieces). Then a seeded fuzz:
// random pinned subsets over small inventories, where both solvers must find the brute-force best over the unpinned
// slots, every pinned piece kept.
// Tags: [fast]. Run: node --test app/manual-handoffs.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPools, OPTIMIZER_SLOTS, GEAR_SLOTS, toOptItem, type Inventory, type Item, type OptItem } from "./vault-lib.mts";
import { manualRun, normalizeRun, reusableRun, runSummary, type SavedRun } from "./runs-lib.mts";
import { DEFAULT_OPTIONAL_SLOTS } from "./mip.mts";
import { solveExact, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { core } from "./solver-fixture.mts";   // also loads the uoalive rules
import { slotsOf } from "./ui/builder-model.mts";
import { suitFrom, fillableSlots, fetchPieces, fillPicks, keptSlots, listWords, applyEditStep } from "./ui/manual-model.mts";
import { savedBuffs } from "./buffs.mts";

let next = 1000;
const mk = (slot: string, props: Record<string, number>, more: Partial<Item> = {}): Item => ({
  serial: ++next, name: `${slot} ${next}`, amount: 1, props, setBonus: {}, extras: {}, flags: [], tags: [], strReq: 0, rarity: null, weight: null, skillReq: null,
  lines: [], gargoyle: false, slayers: [], medable: true, slot, twoHanded: false, gear: true, kind: "gear", root: 1, container: 1, equippedBy: null, layer: null,
  seenAt: "", scannedBy: "A", ...more,
});
const invOf = (items: Item[]): Inventory => ({ characters: { A: {} as Inventory["characters"][string], B: {} as Inventory["characters"][string] }, containers: {}, items: Object.fromEntries(items.map((i) => [i.serial, i])), scans: [] });
const serials = (list: OptItem[] | undefined): number[] => (list || []).map((i) => i.serial);

test("[fast] buildPools: a pinned piece is its slot's only candidate and current piece, worn by another or filtered out", () => {
  const ring = mk("ring", { luck: 10 }), ring2 = mk("ring", { luck: 50 }), helm = mk("helmet", { hci: 5 }, { equippedBy: "B" }), helm2 = mk("helmet", { hci: 9 });
  const wornChest = mk("chest", { dci: 4 }, { equippedBy: "A" }), chest2 = mk("chest", { dci: 9 }), cursed = mk("neck", { lrc: 20 }, { tags: ["cursed"] });
  const inv = invOf([ring, ring2, helm, helm2, wornChest, chest2, cursed]);
  const r = buildPools(inv, "A", { pinned: { ring: ring.serial, helmet: helm.serial, neck: cursed.serial, feet: 77 }, excludeTags: ["cursed"] });
  assert.deepEqual(serials(r.pools.ring), [ring.serial]);
  assert.deepEqual(serials(r.pools.helmet), [helm.serial], "worn by B, and Manual placed it: allowed");
  assert.deepEqual(serials(r.pools.neck), [cursed.serial], "a tag filter never drops a placed piece");
  assert.deepEqual(Object.keys(r.current).sort(), ["helmet", "neck", "ring"], "only the placed pieces are current: A's chest is a candidate, not a kept piece");
  assert.deepEqual(serials(r.pools.chest).sort(), [wornChest.serial, chest2.serial].sort());
  assert.deepEqual(r.blocked, []);
  // without pinned, the worn suit is current as before
  assert.deepEqual(Object.keys(buildPools(inv, "A").current), ["chest"]);
});

test("[fast] buildPools: the hand rule holds with a pinned two-hander, one-hander or shield", () => {
  const bow = mk("twoHanded", { di: 30 }, { twoHanded: true }), shield = mk("twoHanded", { physResist: 8 }), sword = mk("oneHanded", { di: 20 }), sword2 = mk("oneHanded", { di: 25 });
  const inv = invOf([bow, shield, sword, sword2]);
  const two = buildPools(inv, "A", { pinned: { twoHanded: bow.serial } });
  assert.deepEqual(serials(two.pools.oneHanded), [], "a pinned two-hander leaves the one-hand slot empty");
  const one = buildPools(inv, "A", { pinned: { oneHanded: sword.serial } });
  assert.deepEqual(serials(one.pools.twoHanded), [shield.serial], "a pinned one-hander keeps two-handers out of the other hand");
  const sh = buildPools(inv, "A", { pinned: { twoHanded: shield.serial } });
  assert.deepEqual(serials(sh.pools.oneHanded).sort(), [sword.serial, sword2.serial].sort(), "a shield leaves the one-hand slot open");
});

test("[fast] buildPools with no character: the pieces nobody wears, plus what is pinned", () => {
  const a = mk("ring", { luck: 1 }, { equippedBy: "A" }), b = mk("ring", { luck: 2 }), c = mk("helmet", { hci: 1 }, { equippedBy: "B" });
  const r = buildPools(invOf([a, b, c]), null, { pinned: { helmet: c.serial } });
  assert.deepEqual(serials(r.pools.ring), [b.serial]);
  assert.deepEqual(serials(r.pools.helmet), [c.serial]);
  assert.deepEqual(Object.keys(r.current), ["helmet"]);
});

test("[fast] a manual run: every gear slot, the changes from what the character wears, no score, a key no search can match", () => {
  const worn = { ring: toOptItem(mk("ring", { luck: 10 })), feet: toOptItem(mk("feet", { physResist: 2 })) };
  const suit = { ring: toOptItem(mk("ring", { luck: 40 })), feet: worn.feet, waist: toOptItem(mk("waist", { lrc: 20 })) };
  const run = manualRun({ id: "m1", character: "A", createdAt: "2026-10-05T00:00:00Z", settings: { floors: { lrc: 100 } }, inventoryStamp: "x", suit, worn, slots: GEAR_SLOTS });
  assert.deepEqual(Object.keys(run.result!.best as object).sort(), [...GEAR_SLOTS].sort());
  assert.equal(run.result!.method, "manual");
  assert.equal(run.result!.score, undefined);
  assert.deepEqual((run.result!.perSlotChanges as Array<{ slot: string; gainedProps: object }>).map((c) => [c.slot, c.gainedProps]), [["ring", { luck: 30 }], ["waist", { lrc: 20 }]]);
  assert.deepEqual(run.result!.totals, { before: { luck: 10, physResist: 2 }, after: { luck: 40 }, outside: { physResist: 2, lrc: 20 } }, "after: the optimizer's slots, like a search; outside: the six others");
  assert.match(run.key!, /^manual:/);
  assert.equal(reusableRun([run], run.key!), null, "a manual run never answers a search, even by its own key");
  const sum = runSummary(normalizeRun(run));
  assert.deepEqual([sum.method, sum.changes, sum.score], ["manual", 2, null]);
  assert.deepEqual(sum.totalsAfter, { luck: 40, physResist: 2, lrc: 20 }, "the drawer's badges count the six other slots, as Manual shows the suit");
  assert.deepEqual(slotsOf(sum), GEAR_SLOTS);
  // the same suit and settings key alike; another suit does not
  assert.equal(manualRun({ ...{ id: "m2", character: "A", createdAt: "", settings: { floors: { lrc: 100 } }, inventoryStamp: null, worn, slots: GEAR_SLOTS }, suit }).key, run.key);
  assert.notEqual(manualRun({ id: "m3", character: "A", createdAt: "", settings: {}, inventoryStamp: null, worn, slots: GEAR_SLOTS, suit: { ring: worn.ring } }).key, run.key);
});

test("[fast] an old run (no method, saved before Manual) still loads with the optimizer's slots", () => {
  const old: SavedRun = { id: "o1", character: "A", createdAt: "2026-09-01T00:00:00Z", settings: { allowOthers: true }, result: { method: "exact", proven: true, score: 5, best: { ring: null } } };
  const n = normalizeRun(old);
  assert.equal(n.settings!.allowOthersWorn, true);
  assert.deepEqual(slotsOf(n.result!), OPTIMIZER_SLOTS);
  assert.deepEqual(slotsOf(runSummary(n)), OPTIMIZER_SLOTS);
  assert.equal(savedBuffs(n.settings as { buffs?: unknown }), undefined, "no buffs: Open in Manual leaves Manual's as they are");
});

test("[fast] Open in Manual: the slots a run plans take its pieces or are emptied, every other slot keeps its own; its buffs come with it", () => {
  const manual = { ring: 1, feet: 2, helmet: 3, waist: 4 };
  const best = { ring: { serial: 10 }, helmet: null, chest: { serial: 11 } };
  assert.deepEqual(suitFrom(manual, best, OPTIMIZER_SLOTS), { ring: 10, feet: 2, waist: 4, chest: 11 }, "a search's result: the six other slots keep Manual's pieces");
  assert.deepEqual(suitFrom(manual, { ring: { serial: 10 }, feet: null }, GEAR_SLOTS), { ring: 10 }, "a manual run covers every slot");
  const settings = { buffs: { on: ["divineFury"], skills: { Chivalry: 110 } } };
  assert.deepEqual(savedBuffs(settings), { on: ["divineFury"], skills: { Chivalry: 110 } });
});

test("[fast] Fill the rest: the fillable slots, and the fetch list's pieces", () => {
  assert.deepEqual(fillableSlots({ ring: 1, feet: 2 }, false), OPTIMIZER_SLOTS.filter((s) => s !== "ring"));
  assert.ok(!fillableSlots({ twoHanded: 5 }, true).includes("oneHanded"), "the one-hand slot beside a two-handed weapon");
  assert.ok(fillableSlots({ twoHanded: 5 }, false).includes("oneHanded"), "beside a shield it is open");
  const pieces = [{ n: 1, equippedBy: "A" }, { n: 2, equippedBy: null }, { n: 3, equippedBy: "B" }];
  assert.deepEqual(fetchPieces(pieces, "A").map((p) => p.n), [2, 3]);
  assert.deepEqual(fetchPieces(pieces, null).map((p) => p.n), [1, 2, 3], "No character: every piece, the unworn ones included");
});

// The probe that found it: an earlier run's helmet (luck 30) as the warm start, where the helmet is pinned to one with
// luck −20. The core used to start from no helmet at all, a suit no search may return, and kept it (10 for the ring
// alone); the pinned slot keeps its piece, and the answer is −20 + 10.
test("[fast] a warm start never empties a pinned slot", async () => {
  const pinnedHelm = mk("helmet", { luck: -20 }), oldHelm = mk("helmet", { luck: 30 }), ring = mk("ring", { luck: 10 });
  const { pools, current } = buildPools(invOf([pinnedHelm, oldHelm, ring]), "A", { pinned: { helmet: pinnedHelm.serial } });
  const profile: OptProfile = { weights: { luck: 1 }, caps: {}, floors: {}, hardFloors: [], floorBonus: 1000 };
  const opts = { seed: 1, restarts: 3, optionalSlots: DEFAULT_OPTIONAL_SLOTS, warmStart: { helmet: oldHelm.serial, ring: ring.serial } };
  const exact = core.optimizeSuit(pools as never, current as never, profile, { ...opts, exact: true, timeBudgetMs: 5000 });
  assert.deepEqual([exact.score, exact.best.helmet?.serial], [-10, pinnedHelm.serial]);
  const h = await solveExact({ core, pools: pools as never, current: current as never, profile, opts: { ...opts, exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: () => {} });
  assert.deepEqual([h.score, h.best.helmet?.serial, h.proven], [-10, pinnedHelm.serial, true]);
});

test("[fast] a fill lands only where it started: the same character, counted buffs and suit, the slots that were empty", () => {
  const start = { who: "A", buffs: ["divineFury"], suit: { ring: 1, feet: 2 }, plan: "p1", empty: ["helmet", "neck"] };
  const best = { ring: { serial: 1 }, helmet: { serial: 7 }, neck: { serial: 8 }, cloak: { serial: 9 } };
  const now = { who: "A", buffs: ["divineFury"], suit: { ring: 1, feet: 2 }, plan: "p1" };
  assert.deepEqual(fillPicks(start, now, best), { picks: { helmet: 7, neck: 8 } }, "only the slots empty at the start; the pinned ring is not placed again");
  assert.deepEqual(fillPicks(start, { ...now, who: "B" }, best), { stale: "Fill canceled: the character changed" });
  assert.deepEqual(fillPicks(start, { ...now, who: null }, best), { stale: "Fill canceled: the character changed" }, "No character picked meanwhile");
  assert.deepEqual(fillPicks(start, { ...now, buffs: [] }, best), { stale: "Fill canceled: the buffs changed" }, "a buff off, or Count buffs off");
  assert.deepEqual(fillPicks(start, { ...now, suit: { feet: 2 } }, best), { stale: "Fill canceled: the suit changed" }, "the placed ring cleared meanwhile never comes back");
  assert.deepEqual(fillPicks(start, { ...now, suit: { ring: 1, feet: 2, helmet: 5 } }, best), { stale: "Fill canceled: the suit changed" });
  assert.deepEqual(fillPicks(start, { ...now, plan: "p2" }, best), { stale: "Fill canceled: the settings changed" }, "a requirement, weight or buff number edited");
  // a pinned serial the search returns in another slot is never placed twice
  assert.deepEqual(fillPicks(start, now, { helmet: { serial: 2 } }), { picks: {} });
});

test("[fast] undoing Open in Manual puts back only the buff numbers it set, and never one edited since", () => {
  const before = { A: { Chivalry: 100, Bushido: 80 }, B: { Magery: 90 } };
  // Open in Manual sets A's Chivalry to 120 and its Necromancy (A's own until now) to 50
  const was = { Chivalry: 100, Necromancy: null }, set = { Chivalry: 120, Necromancy: 50 };
  const opened = applyEditStep(before, "A", was, set);
  assert.deepEqual(opened, { A: { Chivalry: 120, Bushido: 80, Necromancy: 50 }, B: { Magery: 90 } });
  // then the player edits Chivalry to 105, and B's Magery
  const edited = { A: { ...opened.A!, Chivalry: 105 }, B: { Magery: 95 } };
  // undo past the Open: Necromancy goes back to A's own, Chivalry keeps the edit, B and Bushido are untouched
  assert.deepEqual(applyEditStep(edited, "A", set, was), { A: { Chivalry: 105, Bushido: 80 }, B: { Magery: 95 } });
  // nothing to change: the same map back
  assert.equal(applyEditStep(before, "A", was, was), before);
});

test("[fast] Start from this result names the pieces it kept", () => {
  assert.deepEqual(keptSlots({ ring: 1, waist: 2, earrings: 3 }, OPTIMIZER_SLOTS), ["waist", "earrings"]);
  assert.deepEqual(keptSlots({ ring: 1 }, GEAR_SLOTS), []);
  assert.deepEqual(["Waist", "Waist and Earrings", "Feet, Waist and Earrings"], [listWords(["Waist"]), listWords(["Waist", "Earrings"]), listWords(["Feet", "Waist", "Earrings"])]);
});

// ---- the fuzz: random pinned subsets, both solvers against brute force over the unpinned slots
const SLOTS = ["helmet", "neck", "ring", "cloak", "oneHanded", "twoHanded"];
const DIMS = ["hci", "dci", "luck", "lrc"];
const EPS = 1e-6;
for (const seed of [4, 19, 2026]) {
  test(`[fast] fill fuzz: with random pieces pinned, both solvers find the brute-force best over the rest (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed);
    const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
    let withPins = 0;
    for (let i = 0; i < 120; i++) {
      const items: Item[] = [];
      for (const s of SLOTS) for (let k = int(0, 3); k > 0; k--) {
        items.push(mk(s, Object.fromEntries(DIMS.filter(() => rnd() < 0.5).map((d) => [d, int(-6, 20)])), { twoHanded: s === "twoHanded" && rnd() < 0.5, equippedBy: rnd() < 0.2 ? (rnd() < 0.5 ? "A" : "B") : null }));
      }
      const character = rnd() < 0.3 ? null : "A";
      const pinned: Record<string, number> = {};
      for (const s of SLOTS) { const c = items.filter((it) => it.slot === s); if (c.length && rnd() < 0.4) pinned[s] = c[int(0, c.length - 1)]!.serial; }
      if (pinned.twoHanded && pinned.oneHanded && items.find((it) => it.serial === pinned.twoHanded)!.twoHanded) delete pinned.oneHanded;
      const profile: OptProfile = { weights: Object.fromEntries(DIMS.map((d) => [d, int(-1, 3)])), caps: rnd() < 0.5 ? { hci: int(5, 30) } : {}, floors: rnd() < 0.4 ? { dci: int(3, 25) } : {}, hardFloors: [], floorBonus: 1000 };
      if (Object.keys(pinned).length) withPins++;
      const { pools, current } = buildPools(invOf(items), character, { pinned });
      const optionalSlots = DEFAULT_OPTIONAL_SLOTS.filter((s) => !(s in pinned));
      const label = `seed ${seed} #${i} (pinned ${Object.keys(pinned).join(",") || "none"}, ${character ?? "no character"})`;
      // brute force, independent of the pools: a pinned slot holds its piece; any other slot is empty or any piece of
      // its slot this character may wear (its own or nobody's); a two-handed weapon and a one-hander never together
      const cands = SLOTS.map((s) => (pinned[s] ? [items.find((it) => it.serial === pinned[s])!] : [null, ...items.filter((it) => it.slot === s && (!it.equippedBy || it.equippedBy === character))]));
      let oracle = -Infinity;
      const rec = (k: number, pick: OptAssignment): void => {
        if (k === SLOTS.length) {
          if (pick.twoHanded?.twoHanded && pick.oneHanded) return;
          oracle = Math.max(oracle, core.scoreSet(pick, profile));
          return;
        }
        for (const it of cands[k]!) rec(k + 1, { ...pick, [SLOTS[k]!]: it ? (toOptItem(it) as OptAssignment[string]) : null });
      };
      rec(0, {});
      // a warm start from an earlier run: any piece of the instance per slot, pinned slots included, or nothing
      const warmStart = Object.fromEntries(SLOTS.map((s) => { const c = items.filter((it) => it.slot === s); return [s, c.length && rnd() < 0.6 ? c[int(0, c.length - 1)]!.serial : null]; }));
      const opts = { seed: 1, restarts: 3, optionalSlots, warmStart };
      const exact = core.optimizeSuit(pools as never, current as never, profile, { ...opts, exact: true, timeBudgetMs: 5000 });
      assert.ok(Math.abs(exact.score - oracle) < EPS, `${label}: core ${exact.score} != brute force ${oracle}`);
      const h = await solveExact({ core, pools: pools as never, current: current as never, profile, opts: { ...opts, exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: () => {} });
      assert.ok(Math.abs(h.score - oracle) < 1e-3, `${label}: HiGHS ${h.score} != brute force ${oracle}`);
      for (const [s, serial] of Object.entries(pinned)) {
        assert.equal(exact.best[s]?.serial, serial, `${label}: the core dropped the pinned ${s}`);
        assert.equal(h.best[s]?.serial, serial, `${label}: HiGHS dropped the pinned ${s}`);
      }
    }
    assert.ok(withPins > 60, `pieces were pinned in ${withPins} of 120 instances`);
  });
}
