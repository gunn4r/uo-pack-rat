// gear-changes.test.mts — what changed in the gear since a saved run (issue #291): `runs-lib.mts`'s pool the run keeps (`poolSnapshot`, cut to the suit's places by `poolPart` and written by `runRecord`) and `gearChanges` against the inventory now: nothing changed, a new piece in the pool (and where), a piece of the suit moved to another container of the same character or to another character, one the run's character now wears (not moved), one gone from the scans, and a run saved without its pool (null, the plain banner); and `ui/builder-model.mts`'s banner lines (`gearChangeLines`, at most three then "and N more") and the slot table's marks (`pieceMark`). All `[fast]`.
import test from "node:test";
import assert from "node:assert/strict";
import { gearChanges, placeOf, poolPart, poolSerials, poolSnapshot, runRecord } from "./runs-lib.mts";
import { gearChangeLines, pieceMark, GONE_MARK } from "./ui/builder-model.mts";
import type { Container, Inventory, Item, OptItem } from "./vault-lib.mts";
import type { GearChanges, SavedRun } from "./runs-types.mts";

const PACK = 100, BAG = 101, BANK = 200, CHEST = 300, OTHER_PACK = 400;
const box = (serial: number, kind: string | null, scannedBy: string, root = serial, parent: number | null = null, name = kind || "Chest"): Container =>
  ({ serial, kind, name, root, parent, scannedBy, scannedAt: "2026-10-01T10:00:00Z" });
const piece = (serial: number, name: string, slot: string, where: { container?: number; root?: number; worn?: string }): Item => ({
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
// Kestrel's build: a ring in her backpack, gloves in her bank, a helmet in a house container and the necklace she wears.
const RING = piece(1, "Ring of Luck", "ring", { container: PACK }), GLOVES = piece(2, "Lucky Gloves", "gloves", { container: BANK });
const HELM = piece(3, "Lucky Helm", "helmet", { container: CHEST }), NECK = piece(4, "Lucky Gorget", "neck", { worn: "Kestrel" });
const SPARE = piece(5, "Spare Ring", "ring", { container: CHEST });
const pieces = [RING, GLOVES, HELM, NECK];
function savedRun(): SavedRun {
  const inv = inventory([...pieces, SPARE]);
  const pools = { ring: [opt(RING), opt(SPARE)], gloves: [opt(GLOVES)], helmet: [opt(HELM)], neck: [opt(NECK)] };
  const best = Object.fromEntries(pieces.map((it) => [it.slot!, opt(it)]));
  const snap = poolSnapshot(inv, pools, { neck: opt(NECK) });
  return runRecord({ id: "r1", key: "k", character: "Kestrel", createdAt: "2026-10-01T10:00:00Z", settings: {}, inventoryStamp: "2026-10-01T10:00:00Z", poolSize: 5, skipped: {}, ms: 1,
    result: { best }, search: { opts: {}, budgetMs: null, explored: null }, pool: poolPart(snap, best) }) as SavedRun;
}
const moved = (it: Item, where: Parameters<typeof piece>[3]): Item => piece(it.serial, it.name, it.slot!, where);
const now = (items: Item[]): { inv: Inventory; serials: number[] } => ({ inv: inventory(items), serials: poolSerials({ any: items.map(opt) }) });

test("[fast] gear changes: a saved run keeps its pool's serials and only the suit's places", () => {
  const run = savedRun();
  assert.deepEqual(run.poolSerials, [1, 2, 3, 4, 5]);
  assert.deepEqual(Object.keys(run.picked!).sort(), ["1", "2", "3", "4"], "the spare ring is in the pool, not the suit");
  assert.deepEqual(run.picked![1], { character: "Kestrel", container: PACK });
  assert.deepEqual(run.picked![3], { character: null, container: CHEST }, "a house container is no character's");
  assert.deepEqual(run.picked![4], { character: "Kestrel", container: null });
  assert.deepEqual(placeOf(GLOVES, inventory([GLOVES])), { character: "Kestrel", container: BANK });
});

test("[fast] gear changes: nothing changed", () => {
  const { inv, serials } = now([...pieces, SPARE]);
  assert.deepEqual(gearChanges(savedRun(), inv, serials), { added: 0, addedPlaces: [], moved: [], gone: [] });
});

test("[fast] gear changes: a new piece in the pool, with where it is", () => {
  const { inv, serials } = now([...pieces, SPARE, piece(6, "New Ring", "ring", { container: BANK })]);
  assert.deepEqual(gearChanges(savedRun(), inv, serials), { added: 1, addedPlaces: ["Kestrel's bank"], moved: [], gone: [] });
  // three places are too many to name
  const many = now([...pieces, SPARE, piece(6, "A", "ring", { container: BANK }), piece(7, "B", "ring", { container: CHEST }), piece(8, "C", "ring", { container: BAG, root: PACK })]);
  assert.deepEqual(gearChanges(savedRun(), many.inv, many.serials)!.addedPlaces, []);
  assert.equal(gearChanges(savedRun(), many.inv, many.serials)!.added, 3);
});

test("[fast] gear changes: a piece of the suit moved, within a character or to another one", () => {
  // the ring into a pouch in the same backpack, the helmet from the house container to Dorran's backpack, the gloves worn by Dorran
  const { inv, serials } = now([moved(RING, { container: BAG, root: PACK }), moved(HELM, { container: OTHER_PACK }), moved(GLOVES, { worn: "Dorran" }), NECK, SPARE]);
  assert.deepEqual(gearChanges(savedRun(), inv, serials)!.moved, [
    { slot: "ring", serial: 1, name: "Ring of Luck", character: null, place: "Kestrel's backpack › Pouch" },
    { slot: "gloves", serial: 2, name: "Lucky Gloves", character: "Dorran", place: "Worn by Dorran" },
    { slot: "helmet", serial: 3, name: "Lucky Helm", character: "Dorran", place: "Dorran's backpack" },
  ]);
  // a piece the run's character now wears is where the suit puts it; the necklace taken off into the bank has moved
  const worn = now([moved(RING, { worn: "Kestrel" }), GLOVES, HELM, moved(NECK, { container: BANK }), SPARE]);
  assert.deepEqual(gearChanges(savedRun(), worn.inv, worn.serials)!.moved.map((m) => [m.slot, m.character, m.place]), [["neck", null, "Kestrel's bank"]]);
});

test("[fast] gear changes: a piece of the suit gone from the scans", () => {
  const { inv, serials } = now([RING, GLOVES, NECK, SPARE]);
  assert.deepEqual(gearChanges(savedRun(), inv, serials), { added: 0, addedPlaces: [], moved: [], gone: [{ slot: "helmet", serial: 3, name: "Lucky Helm" }] });
});

test("[fast] gear changes: a run saved without its pool falls back (null)", () => {
  const old = savedRun();
  delete old.poolSerials; delete old.picked;
  const { inv, serials } = now([RING]);
  assert.equal(gearChanges(old, inv, serials), null);
  const record = runRecord({ id: "m", key: "manual:x", character: "Kestrel", createdAt: "", settings: {}, inventoryStamp: null, poolSize: null, skipped: {}, ms: 0, result: {} });
  assert.equal("poolSerials" in record, false, "a run with no pool writes neither field");
});

test("[fast] gear changes: the banner's lines and the slot table's marks", () => {
  const where = (t: string): string => t.replace("Armor box", "Armor box (labelled)");
  const g: GearChanges = { added: 2, addedPlaces: ["Kestrel's bank", "Armor box"], moved: [
    { slot: "ring", serial: 1, name: "Ring of Luck", character: null, place: "Armor box" },
    { slot: "gloves", serial: 2, name: "Lucky Gloves", character: "Dorran", place: "Worn by Dorran" }], gone: [{ slot: "helmet", serial: 3, name: "Lucky Helm" }] };
  assert.deepEqual(gearChangeLines(g, where), ["2 new pieces scanned in Kestrel's bank and Armor box (labelled)", "Ring of Luck is now in Armor box (labelled)", "Lucky Gloves is now on Dorran", "Lucky Helm is no longer in the scans"],
    "four lines are shown whole rather than three and \"and 1 more\"");
  const five = { ...g, gone: [...g.gone, { slot: "neck", serial: 4, name: "Lucky Gorget" }] };
  assert.deepEqual(gearChangeLines(five, where).slice(3), ["and 2 more"]);
  assert.deepEqual(gearChangeLines({ ...g, added: 1, addedPlaces: [], moved: [], gone: [] }, where), ["1 new piece scanned"]);
  assert.deepEqual(gearChangeLines({ added: 0, addedPlaces: [], moved: [], gone: [] }, where), []);
  assert.equal(pieceMark(g, 1, where), "Now in Armor box (labelled)");
  assert.equal(pieceMark(g, 2, where), "Now on Dorran");
  assert.equal(pieceMark(g, 3, where), GONE_MARK);
  assert.equal(GONE_MARK, "No longer in the scans");
  assert.equal(pieceMark(g, 4, where), null, "an unchanged piece has no mark");
  assert.equal(pieceMark(undefined, 1, where), null);
});
