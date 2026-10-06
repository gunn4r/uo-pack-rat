// inventory.mts — the inventory every view and bridge command reads: the scans folded (cached), with Organize's results overlay applied (cached on its own).
import { statSync } from "node:fs";
import { foldSnapshots, type Inventory, type KindOverrides } from "../vault-lib.mts";
import { missingSinceLastScan, type MissingItem } from "../missing.mts";
import { latestHouses, type HouseSource } from "../house-capture.mts";
import { overlaidInventory } from "../organize.mts";
import { pruneOverlay, type OrganizeState } from "../organize-state.mts";
import type { ScanV2 } from "../schema/types.d.mts";

export type FoldValue = { fold: Inventory; missing: Record<string, MissingItem[]>; snapshotCount: number; houses: HouseSource[] };
export type InvValue = FoldValue & { inv: Inventory };

// `shard` is the current shard; `harvest` reads finished trips into the overlay before every read (the Organize
// service's harvestNow); `now` is the clock (a test passes its own).
export function createInventoryService({ scanStore, itemKindsStore, organizeStateStore, shard, harvest, now = Date.now }: {
  scanStore: { signature(): string; all(): ScanV2[] };
  itemKindsStore: { file: string; read(): KindOverrides };
  organizeStateStore: { file: string; read(): OrganizeState };
  shard: () => string;
  harvest: (now: number) => void;
  now?: () => number;
}) {
  // getInventory() caches the fold (the scans store's scans + foldSnapshots) — the expensive part of every route that
  // needs the inventory — keyed by a signature of the scans directory (every *.json file's name, mtimeMs
  // and size, so an add/edit/delete/rename is caught with no restart), the current shard id (a shard
  // switch changes parseTooltip/classify via rules). /api/forget's tombstone is just another file landing in the scans
  // directory, so it invalidates the cache the same way — no separate invalidation path needed. item-kinds.json's
  // inode, mtime and size are in it too (issue #150): a changed override re-kinds the inventory by folding the same
  // scans again, and the Organize plan, worked out from the fold on every request, follows.
  // What it serves is that fold with Organize's results overlay applied (issue #127, overlaidInventory): every
  // view and bridge command sees where a trip put an item, not where the last scan saw it. The overlay is cached
  // on its own, keyed by the fold's signature, organize-state.json's inode, mtime and size (every write replaces
  // the file) and the hour, so a finished trip re-applies the overlay without folding the scans again. `fold` is
  // the scans alone: only organizeNow reads it, since the planner applies the overlay itself (with the counts it
  // needs for capacity), and it hands it on as `fold` too, so no Organize route has an `inv` to pass by habit.
  let foldCache: { sig: string | null; value: FoldValue | null } = { sig: null, value: null };
  let invCache: { sig: string | null; value: InvValue | null } = { sig: null, value: null };
  async function getInventory(): Promise<InvValue> {
    harvest(now());   // a trip that finished since is part of what every view shows
    let kindsSig = "no-kinds";
    try { const st = statSync(itemKindsStore.file); kindsSig = `${st.ino}:${st.mtimeMs}:${st.size}`; } catch { /* no overrides */ }
    const sig = `${scanStore.signature()}::${shard()}::${kindsSig}`;
    if (foldCache.sig !== sig) {   // sig and value are only ever set together
      const snaps = scanStore.all();
      const fold = foldSnapshots(snaps, itemKindsStore.read());
      foldCache = { sig, value: { fold, missing: missingSinceLastScan(snaps, fold), snapshotCount: snaps.length, houses: latestHouses(snaps) } };
    }
    const folded = foldCache.value!;
    let stateSig = "no-state";
    try { const st = statSync(organizeStateStore.file); stateSig = `${st.ino}:${st.mtimeMs}:${st.size}`; } catch { /* no overlay yet */ }
    // The hour, so a move the week-old cut in pruneOverlay has retired leaves the view of a long-running server.
    const invSig = `${sig}::${stateSig}::${Math.floor(now() / 3600e3)}`;
    if (invCache.sig === invSig) return invCache.value!;
    const { moves } = pruneOverlay(organizeStateStore.read(), folded.fold, now());
    invCache = { sig: invSig, value: { ...folded, inv: overlaidInventory(folded.fold, moves) } };
    return invCache.value!;
  }
  return { getInventory };
}
export type InventoryService = ReturnType<typeof createInventoryService>;
