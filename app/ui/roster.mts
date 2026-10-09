// ui/roster.mts — the Characters roster's rows, filter and sort, and the sheet's scan summary, kept free of the
// DOM and of app.mts so app/ui-characters.test.mts can import them.
import type { ResistFigure } from "./sheet.mts";
import { isPseudoCharacter, type Container } from "../vault-lib.mts";
import { plural } from "./inv-model.mts";

// Every character the page knows of, scanned ones first, then ones with only a saved Suit Builder profile; a pseudo
// name (the Suit Builder's No character's profile, issue #12) is none of them.
export const characterNames = (scanned: Record<string, unknown>, profiled: Record<string, unknown> | undefined): string[] =>
  [...new Set([...Object.keys(scanned), ...Object.keys(profiled || {})])].filter((n) => !isPseudoCharacter(n));

export interface RosterRow {
  name: string;
  scannedAt: string | null;   // null: a saved Suit Builder profile for a character never scanned
  stats: [number | null, number | null, number | null];
  pools: [number | null, number | null, number | null];
  resists: ResistFigure[] | null;
  worn: number;
  lowDurability: number;   // worn pieces low on durability (sheet.mts's lowDurability)
}
export type RosterSort = { key: "name" | "scan" | "physResist" | "fireResist" | "coldResist" | "poisonResist" | "energyResist"; dir: 1 | -1 };
// Filter by the top-bar search (case-insensitive, anywhere in the name), then sort. Names break ties;
// an unscanned character sorts after every scanned one whichever way the column runs.
export function rosterView(rows: RosterRow[], q: string, sort: RosterSort): RosterRow[] {
  const needle = q.trim().toLowerCase();
  const val = (r: RosterRow): number | null => sort.key === "scan" ? (r.scannedAt ? Date.parse(r.scannedAt) : null) : sort.key === "name" ? null : r.resists?.find((f) => f.key === sort.key)?.value ?? null;
  return rows.filter((r) => !needle || r.name.toLowerCase().includes(needle)).sort((a, b) => {
    if (sort.key !== "name") {
      const va = val(a), vb = val(b);
      if (va == null || vb == null) { if (va !== vb) return va == null ? 1 : -1; }
      else if (va !== vb) return (va - vb) * sort.dir;
    }
    return a.name.localeCompare(b.name) * (sort.key === "name" ? sort.dir : 1);
  });
}
// "110 · 60 · 20", with a dash for a number the scan didn't carry.
export const triple = (xs: Array<number | null>): string => xs.map((x) => (x == null ? "–" : String(x))).join(" · ");

// The containers a character's scans opened (issue #10): every root container they scanned, their backpack and
// bank aside. The sheet counts them and links to the Containers view at #/containers/<Name>, which lists these.
type Root = Pick<Container, "parent" | "kind" | "scannedBy">;
export const openedRoots = <C extends Root>(containers: Readonly<Record<string, C>>, name: string): C[] =>
  Object.values(containers).filter((r) => r.parent == null && r.scannedBy === name && r.kind !== "backpack" && r.kind !== "bank");
export const openedHref = (name: string): string => `#/containers/${encodeURIComponent(name)}`;
// The sheet's one summary line, "Scanned 7 h ago · 11 pieces worn · opened 37 containers", without the last part
// when the scans opened none.
export interface SheetMeta { scanned: string; worn: string; opened: { text: string; href: string } | null }
export function sheetMeta(name: string, when: string, worn: number, containers: Readonly<Record<string, Root>>): SheetMeta {
  const n = openedRoots(containers, name).length;
  return { scanned: `Scanned ${when}`, worn: `${plural(worn, "piece")} worn`, opened: n ? { text: `opened ${plural(n, "container")}`, href: openedHref(name) } : null };
}

