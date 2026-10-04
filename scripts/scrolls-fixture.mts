// scrolls-fixture.mts — the demo scans with more scrolls in Kestrel's chest, for the Scrolls view's Electron test
// (scripts/ui-scrolls.test.mts, issue #181): a skill that can bind now, one close to a roll-up, Scrolls of
// Transcendence that make an exact 2.0, some that can only bind past 5.0, and an empty Scroll Binder. Written into a data folder's scans/, so the
// committed demo fixtures, and every other test's counts, stay as they are.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const KESTREL_CHEST = 0x700b0000;
const TIER: Record<number, string> = { 105: "A Wondrous", 110: "An Exalted", 115: "A Mythical", 120: "A Legendary" };

interface ScanItem { serial: number; name: string; graphic: number; hue: number; amount: number; tooltip: string[]; container: number }
let serial = 0x700b1000;
const scroll = (name: string, lines: string[]): ScanItem => ({ serial: serial++, name, graphic: 0x14f0, hue: 0x481, amount: 1, tooltip: [name, ...lines], container: KESTREL_CHEST });
const power = (n: number, skill: string, level: number): ScanItem[] =>
  Array.from({ length: n }, () => scroll(`${TIER[level]} Scroll Of ${skill} (${level} Skill)`, ["Cursed", "Weight: 1 Stone"]));
const sot = (skill: string, points: number): ScanItem => scroll("Scroll Of Transcendence", ["Cursed", "Weight: 1 Stone", `Skill: ${skill} ${points} Skill Points`]);

// Added to the demo's own scrolls (Dorran: Spellweaving 110 × 2, Spirit Speak 110, Mysticism 110; Transcendence
// Chivalry 0.6 + 0.6, Spellweaving 0.2 + 0.2, Resisting Spells 0.5, Animal Lore 0.1, Focus 0.1).
export const EXTRA: ScanItem[] = [
  ...power(12, "Meditation", 110),   // binds now: 1 × 115
  ...power(5, "Provocation", 110), ...power(1, "Provocation", 115),   // 110 → 115: 5 of 12, 7 more
  ...power(3, "Archery", 115),   // 115 → 120: 3 of 10, 7 more
  sot("Meditation", 1.0), sot("Meditation", 0.6), sot("Meditation", 0.4), sot("Meditation", 0.3),   // Bind 1.0 + 0.6 + 0.4 → 2.0
  ...Array.from({ length: 18 }, () => sot("Tactics", 0.3)),   // 5.4, no exact 2.0 or 5.0: bind 17 for 5.1, 0.1 lost
  scroll("Scroll Binder", ["Weight: 1 Stone"]),
];

// The demo scans, Kestrel's with EXTRA in its chest, written into <dataDir>/scans/.
export function writeScrollScans(dataDir: string): void {
  mkdirSync(join(dataDir, "scans"), { recursive: true });
  for (const name of ["Dorran", "Kestrel"]) {
    const scan = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`), "utf8")) as { items: ScanItem[] };
    if (name === "Kestrel") scan.items.push(...EXTRA);
    writeFileSync(join(dataDir, "scans", `demo-${name}.json`), JSON.stringify(scan));
  }
}
