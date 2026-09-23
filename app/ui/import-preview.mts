// ui/import-preview.mts — the Import drawer's preview card, as data: what a parsed scan holds, whether it
// replaces one already in Pack Rat, and the sentence the primary button says. Pure and DOM-free (like
// ui/messages.mts) so app/import-preview.test.mts pins the counts, plurals and wording.
import type { ScanV2 } from "../schema/types.d.mts";
import { shortName, type AdapterForCopy } from "./adapter-copy.mts";

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// "44 KB pasted": the size of the text, so a player can see at a glance that a paste came through whole.
export function sizeText(bytes: number): string {
  if (bytes < 1024) return plural(bytes, "byte");
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "A, B and C" — the list form the page uses in running text.
export function listText(parts: string[]): string {
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// What the page already holds that a scan can replace: its characters and container roots (the
// /api/inventory fold's own keys).
export interface KnownInventory { characters: Record<string, unknown>; containers: Record<string, unknown> }

export interface ScanPreview {
  character: string;
  scannedAt: string;
  worn: number;
  stacks: number;          // stacks inside containers
  containers: number;      // container roots (backpack, bank, a ground chest)
  total: number;           // everything the import adds: worn pieces + stacks
  replaces: string | null; // the info line when this character is already in Pack Rat
  warnings: string[];
}

const rootLabel = (r: { name: string; serial: number }): string => `${r.name || "Container"} 0x${(r.serial >>> 0).toString(16)}`;

export function scanPreview(doc: ScanV2, inv: KnownInventory | null, { adapter, adapters = [] }: { adapter?: string | null | undefined; adapters?: AdapterForCopy[] | undefined } = {}): ScanPreview {
  const character = doc.character;
  const worn = doc.equipped.length;
  const stacks = doc.items.length;
  let replaces: string | null = null;
  if (inv?.characters[character]) {
    // Only roots Pack Rat has seen before are replaced; a root new to it is simply added.
    const known = doc.roots.filter((r) => inv.containers[String(r.serial)]).map(rootLabel);
    replaces = known.length
      ? `${character} is already in Pack Rat. This scan replaces the older one for ${listText(known)} and the worn gear.`
      : `${character} is already in Pack Rat. This scan replaces their worn gear.`;
  }
  // The client picked in the drawer decides which inbox the scan is filed under; the document names the
  // client that wrote it. Harmless to the fold when they differ, but worth a line (the server says the
  // same in POST /api/import/paste's `warning`).
  const warnings: string[] = [];
  const declared = doc.adapter?.id;
  if (adapter && declared && declared !== adapter) {
    const name = (id: string): string => { const a = adapters.find((x) => x.id === id); return a ? shortName(a) : id; };
    warnings.push(`This scan says it came from ${name(declared)}, but ${name(adapter)} is picked above.`);
  }
  return { character, scannedAt: doc.scannedAt, worn, stacks, containers: doc.roots.length, total: worn + stacks, replaces, warnings };
}

// The primary button states what will happen: "Import 120 stacks for Kestrel", or for several files
// "Import 3 scans · 412 stacks".
export function importActionLabel(previews: Array<Pick<ScanPreview, "character" | "total">>): string {
  if (!previews.length) return "Import";
  if (previews.length === 1) return `Import ${plural(previews[0]!.total, "stack")} for ${previews[0]!.character}`;
  const total = previews.reduce((n, p) => n + p.total, 0);
  return `Import ${plural(previews.length, "scan")} · ${plural(total, "stack")}`;
}
