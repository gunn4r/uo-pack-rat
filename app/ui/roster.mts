// ui/roster.mts — the Characters roster's rows, filter and sort, kept free of the DOM and of app.mts so
// app/ui-characters.test.mts can import them.
import type { ResistFigure } from "./sheet.mts";

export interface RosterRow {
  name: string;
  scannedAt: string | null;   // null: a saved Suit Builder profile for a character never scanned
  stats: [number | null, number | null, number | null];
  pools: [number | null, number | null, number | null];
  resists: ResistFigure[] | null;
  worn: number;
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

