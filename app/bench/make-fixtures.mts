// make-fixtures.mts — regenerate app/fixtures/demo-*.json from the empirical model. Needs real scans in
// the data directory (PACKRAT_DATA=./local). Output is deterministic for a given seed.
//
// generateScan() (see gen-inventory.mts) hands back a flat scan: items live in scan.items (each with a
// .container pointing at a root ground-chest serial), and scan.equipped is always []. Real character
// scans do carry worn gear, so this script also PROMOTES a handful of the generated gear items — one
// per optimizer slot — from scan.items into scan.equipped, so the fixtures exercise the fold's worn/
// packed distinction the way a real scan does.
//
// map: builder
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { learnModel, generateScan, readRealSnapshots, SCANS_DIR, type SynthItem } from "./gen-inventory.mts";
import type * as VaultLib from "../vault-lib.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = (await import(pathToFileURL(join(HERE, "..", "vault-lib.mts")).href)) as typeof VaultLib;
const model = learnModel(readRealSnapshots(SCANS_DIR), lib);

// Each character's look for the paperdoll (a scan's \`appearance\`): fictional characters drawn with the game's own ids,
// human female (401) and male (400) bodies, skin hues from the human range (1002-1058), hair and beard graphics
// (0x203D ponytail, 0x203B short hair, 0x203F short beard) and hues from the hair range (1102-1149), no face item.
const SPECS = [
  { character: "Kestrel", n: 120, seed: 11, stats: { str: 70, dex: 100, int: 40 }, appearance: { body: 401, hue: 1040, hair: { graphic: 8253, hue: 1131 }, beard: null, face: null } },
  { character: "Dorran", n: 40, seed: 12, stats: { str: 110, dex: 60, int: 20 }, appearance: { body: 400, hue: 1023, hair: { graphic: 8251, hue: 1109 }, beard: { graphic: 8255, hue: 1109 }, face: null } },
];

// Pick up to `max` generated gear items, one per optimizer slot, to promote to "worn".
function pickEquippable(items: (SynthItem & { container: number })[], max: number): (SynthItem & { container: number })[] {
  const bySlot = new Map<string, SynthItem & { container: number }>();
  for (const it of items) {
    const parsed = lib.parseTooltip(it.tooltip);
    const cls = lib.classify(parsed.name, parsed, null, it.graphic);
    if (!cls.gear || !cls.slot || !lib.GEAR_SLOTS.includes(cls.slot)) continue;
    if (!bySlot.has(cls.slot)) bySlot.set(cls.slot, it);
    if (bySlot.size >= max) break;
  }
  return [...bySlot.values()];
}

const scrub = (it: SynthItem): void => { if (it.tooltip) it.tooltip = it.tooltip.map((l) => l.replace(/^Crafted By .*/i, "Crafted By Nobody")); };

for (const s of SPECS) {
  const scan = generateScan(model, { n: s.n, gearFraction: 0.5, seed: s.seed, serialBase: 0x70000000 + s.seed * 0x10000, scannedAt: "2026-01-01T12:00:00", lib });
  scan.character = s.character;
  scan.stats = s.stats;
  scan.position = { x: 1, y: 1 };
  Object.assign(scan, { appearance: s.appearance });

  const worn = pickEquippable(scan.items, 8);
  const wornSerials = new Set(worn.map((it) => it.serial));
  scan.items = scan.items.filter((it) => !wornSerials.has(it.serial));
  scan.equipped = worn.map(({ container, ...rest }) => rest);

  for (const it of scan.items) scrub(it);
  for (const it of scan.equipped) scrub(it);

  writeFileSync(join(HERE, "..", "fixtures", `demo-${s.character}.json`), JSON.stringify(scan, null, 1) + "\n");
  console.log(`${s.character}: ${s.n} items, ${scan.equipped.length} equipped`);
}
