// gear-changes.test.mts — what changed in the gear since a saved run (issue #291): `runs-lib.mts`'s pool the run keeps (`poolSnapshot`, cut to the suit's places by `poolPart` and written by `runRecord`, with the STR limit it was built with) and `gearChanges` against the inventory now: nothing changed, a new piece in the pool (the containers it is in named, never a wearer), a piece of the suit moved to another container of the same character, to another character's backpack, or worn by another character (also from a backpack of the character who now wears it), one the run's character now wears (not moved), one gone from the scans, a No character run, and the fallbacks to null (the plain banner): a run saved without its pool, one with no character or a character no longer scanned, and a rebuild that throws; and `ui/builder-model.mts`'s banner lines (`gearChangeLines`: "you could use", "now worn by", "now in Kestrel's bank", at most three then "and N more") and the Plan's marks (`pieceMark`). All `[fast]`.
import test from "node:test";
import assert from "node:assert/strict";
import { gearChanges, placeOf, poolPart, poolSerials, poolSnapshot, runRecord } from "./runs-lib.mts";
import { gearChangeLines, pieceMark, GONE_MARK } from "./ui/builder-model.mts";
import { NOBODY, type Container, type Inventory, type Item, type OptItem } from "./vault-lib.mts";
import type { GearChanges, SavedRun } from "./runs-types.mts";

const PACK = 100, BAG = 101, BANK = 200, CHEST = 300, OTHER_PACK = 400;
const box = (serial: number, kind: string | null, scannedBy: string, root = serial, parent: number | null = null, name = kind || "Chest"): Container =>
  ({ serial, kind, name, root, parent, scannedBy, scannedAt: "2026-10-01T10:00:00Z" });
type Where = { container?: number; root?: number; worn?: string };
const piece = (serial: number, name: string, slot: string, where: Where): Item => ({
  serial, name, amount: 1, props: { luck: 10 }, setBonus: {}, extras: {}, flags: [], tags: [], strReq: 0, rarity: null, weight: null, skillReq: null, lines: [],
  gargoyle: false, slayers: [], medable: true, slot, twoHanded: false, gear: true, kind: "gear", root: where.worn ? null : where.root ?? where.container ?? null,
  container: where.worn ? null : where.container ?? null, equippedBy: where.worn ?? null, layer: null, seenAt: "2026-10-01T10:00:00Z", scannedBy: "Kestrel" });
const opt = (it: Item): OptItem => ({ serial: it.serial, name: it.name, slot: it.slot, props: it.props });
function inventory(items: Item[]): Inventory {
  return {
    characters: { Kestrel: { name: "Kestrel" }, Dorran: { name: "Dorran" } } as unknown as Inventory["characters"],
    containers: { [PACK]: box(PACK, "backpack", "Kestrel"), [BAG]: box(BAG, null, "Kestrel", PACK, PACK, "Pouch"), [BANK]: box(BANK, "bank", "Kestrel"), [CHEST]: box(CHEST, "ground", "Kestrel", CHEST, null, "Armor box"), [OTHER_PACK]: box(OTHER_PACK, "backpack", "Dorran") },
    items: Object.fromEntries(items.map((it) => [it.serial, it])), scans: [],
  };
}
// Kestrel's build: a ring in her backpack, gloves in her bank, a helmet in a house container, the necklace she wears and a
// belt from Dorran's backpack; a spare ring in the pool.
const RING = piece(1, "Ring of Luck", "ring", { container: PACK }), GLOVES = piece(2, "Lucky Gloves", "gloves", { container: BANK });
const HELM = piece(3, "Lucky Helm", "helmet", { container: CHEST }), NECK = piece(4, "Lucky Gorget", "neck", { worn: "Kestrel" });
const BELT = piece(6, "Lucky Belt", "waist", { container: OTHER_PACK }), SPARE = piece(5, "Spare Ring", "ring", { container: CHEST });
const pieces = [RING, GLOVES, HELM, NECK, BELT];
function savedRun(character = "Kestrel"): SavedRun {
  const inv = inventory([...pieces, SPARE]);
  const pools = { ring: [opt(RING), opt(SPARE)], gloves: [opt(GLOVES)], helmet: [opt(HELM)], neck: [opt(NECK)], waist: [opt(BELT)] };
  const best = Object.fromEntries(pieces.map((it) => [it.slot!, opt(it)]));
  const snap = poolSnapshot(inv, pools, { neck: opt(NECK) }, 90);
  return runRecord({ id: "r1", key: "k", character, createdAt: "2026-10-01T10:00:00Z", settings: {}, inventoryStamp: "2026-10-01T10:00:00Z", poolSize: 6, skipped: {}, ms: 1,
    result: { best }, search: { opts: {}, budgetMs: null, explored: null }, pool: poolPart(snap, best) }) as SavedRun;
}
const moved = (it: Item, where: Where): Item => piece(it.serial, it.name, it.slot!, where);
// the run's changes against `items`, its pool rebuilt as every piece there
const changes = (items: Item[], run = savedRun()): GearChanges | null => gearChanges(run, inventory(items), () => poolSerials({ any: items.map(opt) }));
const same = [...pieces, SPARE];

test("[fast] gear changes: a saved run keeps its pool's serials, only the suit's places and the STR limit", () => {
  const run = savedRun();
  assert.deepEqual(run.poolSerials, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Object.keys(run.picked!).sort(), ["1", "2", "3", "4", "6"], "the spare ring is in the pool, not the suit");
  assert.deepEqual(run.picked![1], { character: "Kestrel", container: PACK });
  assert.deepEqual(run.picked![3], { character: null, container: CHEST }, "a house container is no character's");
  assert.deepEqual(run.picked![4], { character: "Kestrel", container: null });
  assert.equal(run.poolStrength, 90);
  assert.deepEqual(placeOf(GLOVES, inventory([GLOVES])), { character: "Kestrel", container: BANK });
});

test("[fast] gear changes: nothing changed", () => {
  assert.deepEqual(changes(same), { added: 0, addedPlaces: [], moved: [], gone: [] });
});

test("[fast] gear changes: a new piece in the pool, with the containers it is in but never a wearer", () => {
  assert.deepEqual(changes([...same, piece(7, "New Ring", "ring", { container: BANK })]), { added: 1, addedPlaces: ["Kestrel's bank"], moved: [], gone: [] });
  const many = changes([...same, piece(7, "A", "ring", { container: BANK }), piece(8, "B", "ring", { container: CHEST }), piece(9, "C", "ring", { container: BAG, root: PACK })])!;
  assert.deepEqual([many.added, many.addedPlaces], [3, []], "three places are too many to name");
  const worn = changes([...same, piece(7, "Worn Ring", "ring", { worn: "Dorran" }), piece(8, "B", "ring", { container: BANK })])!;
  assert.deepEqual([worn.added, worn.addedPlaces], [2, []], "a new piece someone wears names no place");
});

test("[fast] gear changes: a piece of the suit moved, within a character, to another one's backpack, or worn by another", () => {
  // the ring into a pouch in the same backpack, the helmet from the house container to Dorran's backpack, the gloves worn by
  // Dorran, and Dorran's belt now worn by him: worn by the one who held it is a move too, as he is not the run's character
  const c = changes([moved(RING, { container: BAG, root: PACK }), moved(HELM, { container: OTHER_PACK }), moved(GLOVES, { worn: "Dorran" }), NECK, moved(BELT, { worn: "Dorran" }), SPARE])!;
  assert.deepEqual(c.moved, [
    { slot: "ring", serial: 1, name: "Ring of Luck", wornBy: null, place: "Kestrel's backpack › Pouch" },
    { slot: "gloves", serial: 2, name: "Lucky Gloves", wornBy: "Dorran", place: "Worn by Dorran" },
    { slot: "helmet", serial: 3, name: "Lucky Helm", wornBy: null, place: "Dorran's backpack" },
    { slot: "waist", serial: 6, name: "Lucky Belt", wornBy: "Dorran", place: "Worn by Dorran" },
  ]);
  // a piece the run's character now wears, from her backpack, is where the suit puts it; the necklace taken off into the bank has moved
  const off = changes([moved(RING, { worn: "Kestrel" }), GLOVES, HELM, moved(NECK, { container: BANK }), BELT, SPARE])!;
  assert.deepEqual(off.moved.map((m) => [m.slot, m.wornBy, m.place]), [["neck", null, "Kestrel's bank"]]);
});

test("[fast] gear changes: a piece of the suit gone from the scans", () => {
  assert.deepEqual(changes([RING, GLOVES, NECK, BELT, SPARE]), { added: 0, addedPlaces: [], moved: [], gone: [{ slot: "helmet", serial: 3, name: "Lucky Helm" }] });
});

test("[fast] gear changes: a No character run compares like a character's; anything it cannot compare falls back to null", () => {
  // No character wears nothing, so a piece now worn by anyone has moved
  assert.deepEqual(changes([moved(RING, { worn: "Kestrel" }), GLOVES, HELM, NECK, BELT, SPARE], savedRun(NOBODY))!.moved.map((m) => [m.slot, m.wornBy]), [["ring", "Kestrel"]]);
  const old = savedRun();
  delete old.poolSerials; delete old.picked;
  assert.equal(changes(same, old), null, "a run saved without its pool");
  const unnamed = savedRun();
  delete unnamed.character;
  assert.equal(changes(same, unnamed), null, "a run with no character");
  assert.equal(changes(same, savedRun("Corwin")), null, "a character no longer scanned");
  const errors: unknown[] = [];
  assert.equal(gearChanges(savedRun(), inventory(same), () => { throw new Error("bad settings"); }, (e) => errors.push(e)), null, "a rebuild that throws");
  assert.match(String(errors[0]), /bad settings/);
  const record = runRecord({ id: "m", key: "manual:x", character: "Kestrel", createdAt: "", settings: {}, inventoryStamp: null, poolSize: null, skipped: {}, ms: 0, result: {} });
  assert.equal("poolSerials" in record, false, "a run with no pool writes none of its fields");
});

test("[fast] gear changes: the banner's lines and the Plan's marks", () => {
  const where = (t: string): string => t.replace("Armor box", "Armor box (labelled)");
  const g: GearChanges = { added: 2, addedPlaces: ["Kestrel's bank", "Armor box"], moved: [
    { slot: "ring", serial: 1, name: "Ring of Luck", wornBy: null, place: "Armor box" },
    { slot: "gloves", serial: 2, name: "Lucky Gloves", wornBy: "Dorran", place: "Worn by Dorran" }], gone: [{ slot: "helmet", serial: 3, name: "Lucky Helm" }] };
  assert.deepEqual(gearChangeLines(g, where), ["2 new pieces you could use in Kestrel's bank and Armor box (labelled)", "Ring of Luck is now in Armor box (labelled)", "Lucky Gloves is now worn by Dorran", "Lucky Helm is no longer in the scans"],
    "four lines are shown whole rather than three and \"and 1 more\"");
  const five = { ...g, gone: [...g.gone, { slot: "neck", serial: 4, name: "Lucky Gorget" }] };
  assert.deepEqual(gearChangeLines(five, where).slice(3), ["and 2 more"]);
  assert.deepEqual(gearChangeLines({ ...g, added: 1, addedPlaces: [], moved: [], gone: [] }, where), ["1 new piece you could use"]);
  assert.deepEqual(gearChangeLines({ added: 0, addedPlaces: [], moved: [], gone: [] }, where), []);
  // a banked piece and a backpacked one say whose
  const kept: GearChanges = { added: 0, addedPlaces: [], gone: [], moved: [{ slot: "ring", serial: 1, name: "Ring of Luck", wornBy: null, place: "Dorran's bank" }, { slot: "waist", serial: 6, name: "Lucky Belt", wornBy: null, place: "Dorran's backpack" }] };
  assert.deepEqual(gearChangeLines(kept, where), ["Ring of Luck is now in Dorran's bank", "Lucky Belt is now in Dorran's backpack"]);
  assert.equal(pieceMark(g, 1, where), "Now in Armor box (labelled)");
  assert.equal(pieceMark(g, 2, where), "Now worn by Dorran");
  assert.equal(pieceMark(kept, 1, where), "Now in Dorran's bank");
  assert.equal(pieceMark(g, 3, where), GONE_MARK);
  assert.equal(GONE_MARK, "No longer in the scans");
  assert.equal(pieceMark(g, 4, where), null, "an unchanged piece has no mark");
  assert.equal(pieceMark(undefined, 1, where), null);
});
