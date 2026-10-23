// make-demo-gear.mts — regenerate app/fixtures/demo-gear.json, the gear in the showcase house's chests for the website demo and
// the README shots (scripts/shots-lib.mts). It is real gear: picked from the maintainer's own scans, plus the real artifacts in
// app/bench/demo-artifacts.json (each with the page its properties come from) for the slots those scans hardly cover.
//   PACKRAT_DATA=<data folder with real scans> node app/bench/make-demo-gear.mts
// Nothing personal survives: each item keeps only its name, graphic, hue, weight and property lines; "Crafted By" lines name
// the demo's Kestrel, "Insured" and engraving lines go, and it refuses to write if a scanned character's name is left anywhere.
// Each item says which labeled chest group holds it (Armor, Weapons, Jewelry or Clothing).
//
// map: builder
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setRules } from "../domain/rules.mts";
import { UOALIVE, foldFixtures } from "../server-routes-fixture.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const data = process.env.PACKRAT_DATA;
if (!data) { console.error("usage: PACKRAT_DATA=<data folder with real scans> node app/bench/make-demo-gear.mts"); process.exit(1); }
setRules(UOALIVE);

type DemoGear = { name: string; graphic: number; hue: number; weight: number; lines: string[]; group: string };
type Folded = { name: string; graphic: number; hue: number; weight: number | null; lines: string[]; slot: string | null; props: Record<string, number>; rarity: string | null; scannedBy: string; equippedBy: string | null };

const GROUP: Record<string, string> = {
  helmet: "Armor", neck: "Armor", chest: "Armor", arms: "Armor", hands: "Armor", legs: "Armor", outerLegs: "Armor",
  oneHanded: "Weapons", twoHanded: "Weapons",
  ring: "Jewelry", bracelet: "Jewelry", earrings: "Jewelry", talisman: "Jewelry",
  feet: "Clothing", shirt: "Clothing", tunic: "Clothing", robe: "Clothing", waist: "Clothing", cloak: "Clothing",
};
// At most this many of each slot, artifacts first, then the items with the most properties.
const CAP: Record<string, number> = { helmet: 50, neck: 30, chest: 50, arms: 45, hands: 40, legs: 50, oneHanded: 70, twoHanded: 70, ring: 55, bracelet: 55 };

const items = Object.values(foldFixtures(join(data, "scans")).items) as unknown as Folded[];
const characters = [...new Set(items.flatMap((i) => [i.scannedBy, i.equippedBy]).filter((c): c is string => !!c))];
const named = new RegExp(characters.map((c) => c.replace(/[^A-Za-z]/g, "")).join("|"), "i");

const clean = (lines: string[]): string[] => lines.slice(1)
  .filter((l) => !/^Weight: /.test(l) && l !== "Insured" && !/^Engraved/i.test(l))
  .map((l) => (/^Crafted By /.test(l) ? "Crafted By Kestrel" : l));
const isArtifact = (i: Folded): boolean => /artifact/i.test(i.rarity ?? "");

const seen = new Set<string>(), bySlot: Record<string, Folded[]> = {};
for (const i of items) {
  if (!i.slot || !GROUP[i.slot] || (!Object.keys(i.props).length && !isArtifact(i))) continue;
  const key = [i.name, ...clean(i.lines).filter((l) => !/^Durability/.test(l))].join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  (bySlot[i.slot] ??= []).push(i);
}
const out: DemoGear[] = [];
for (const [slot, list] of Object.entries(bySlot).sort()) {
  list.sort((a, b) => +isArtifact(b) - +isArtifact(a) || Object.keys(b.props).length - Object.keys(a.props).length || a.name.localeCompare(b.name));
  for (const i of list.slice(0, CAP[slot] ?? list.length)) out.push({ name: i.name, graphic: i.graphic, hue: i.hue, weight: i.weight ?? 1, lines: clean(i.lines), group: GROUP[slot]! });
}
const artifacts = JSON.parse(readFileSync(join(HERE, "demo-artifacts.json"), "utf8")) as Array<{ name: string; slot: string; graphic: number; hue?: number; weight?: number; lines: string[] }>;
for (const a of artifacts) out.push({ name: a.name, graphic: a.graphic, hue: a.hue ?? 0, weight: a.weight ?? 1, lines: a.lines, group: GROUP[a.slot]! });

const text = JSON.stringify(out, null, 0).replace(/\},\{/g, "},\n{");
const leak = text.match(named);
if (leak) { console.error(`refusing to write: a scanned character's name is still in the gear ("${leak[0]}")`); process.exit(1); }
writeFileSync(join(HERE, "..", "fixtures", "demo-gear.json"), text + "\n");
const count: Record<string, number> = {};
for (const g of out) count[g.group] = (count[g.group] ?? 0) + 1;
console.log(out.length, "items", count);
