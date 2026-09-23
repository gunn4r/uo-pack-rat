// ui/items.mts — resolveItems(serials): the page's one place to turn a bare serial into a full item
// record (location, tags, equippedBy…), now that GET /api/inventory no longer carries the whole
// item map (Task 5). The optimizer's own item shape (serial/name/slot/props) and a paged /api/items
// row that's scrolled out of view don't carry everything the Suit Builder's result panel or the
// hover tooltip need, so this fills state.itemCache from GET /api/items/by-serial on demand.
// state.itemCache is seeded opportunistically by ui/inventory.mts's renderInventory() (a row it just
// drew already IS a full record) and cleared by ui/app.mts's load() whenever the inventory refreshes.
import { state } from "./store.mts";
import { api } from "./api.mts";
import type { Item } from "../vault-lib.mts";
import type { ItemsBySerialApiResponse } from "./api-types.mts";

const BATCH = 200;   // matches the server's per-request cap on GET /api/items/by-serial

// Returns {[serial]: item} for whichever of `serials` resolve — a serial the current inventory has
// no record for (rescanned away, or just wrong) is absent from the result, never an error; a failed
// network call leaves those serials unresolved for this call rather than throwing, so callers never
// need their own try/catch around a lookup that's inherently best-effort.
export async function resolveItems(serials: Array<number | null | undefined>): Promise<Record<number, Item>> {
  const need = [...new Set(serials.filter((s) => s != null).map(Number))].filter((s) => !state.itemCache.has(s));
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH);
    try {
      const res = await api<ItemsBySerialApiResponse>(`/api/items/by-serial?serials=${chunk.join(",")}`);
      for (const [serial, it] of Object.entries(res.items || {})) state.itemCache.set(+serial, it);
    } catch { /* leave this chunk's serials unresolved */ }
  }
  const out: Record<number, Item> = {};
  for (const s of serials) { if (s == null) continue; const it = state.itemCache.get(+s); if (it) out[s] = it; }
  return out;
}

// ---------------------------------------------------------------- rarity colours
// The shard rules carry each tier's game colour (rules.rarity), but five of the eight fail on a white
// page, so the page paints a tier through its --rarity-* token (app/ui/tokens.css), which is the game hue
// made legible per mode. A tier maps by name: "Lesser Magic Item" -> --rarity-lesser-magic. A shard that
// adds a tier with no token gets null here, and the caller falls back to the raw colour inside a dark
// subtree, where the game colours were designed to live.
export const RARITY_TOKENS = ["minor-magic", "lesser-magic", "greater-magic", "major-magic", "lesser-artifact", "greater-artifact", "major-artifact", "legendary-artifact"] as const;
export function rarityToken(name: string | null | undefined): string | null {
  const slug = String(name || "").trim().toLowerCase().replace(/\s+item$/, "").replace(/\s+/g, "-");
  return (RARITY_TOKENS as readonly string[]).includes(slug) ? `--rarity-${slug}` : null;
}
