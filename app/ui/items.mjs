// ui/items.mjs — resolveItems(serials): the page's one place to turn a bare serial into a full item
// record (location, tags, equippedBy…), now that GET /api/inventory no longer carries the whole
// item map (Task 5). The optimizer's own item shape (serial/name/slot/props) and a paged /api/items
// row that's scrolled out of view don't carry everything the Suit Builder's result panel or the
// hover tooltip need, so this fills state.itemCache from GET /api/items/by-serial on demand.
// state.itemCache is seeded opportunistically by ui/inventory.mjs's renderInventory() (a row it just
// drew already IS a full record) and cleared by ui/app.mjs's load() whenever the inventory refreshes.
import { state } from "./store.mjs";
import { api } from "./api.mjs";

const BATCH = 200;   // matches the server's per-request cap on GET /api/items/by-serial

// Returns {[serial]: item} for whichever of `serials` resolve — a serial the current inventory has
// no record for (rescanned away, or just wrong) is absent from the result, never an error; a failed
// network call leaves those serials unresolved for this call rather than throwing, so callers never
// need their own try/catch around a lookup that's inherently best-effort.
export async function resolveItems(serials) {
  const need = [...new Set(serials.filter((s) => s != null).map(Number))].filter((s) => !state.itemCache.has(s));
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH);
    try {
      const res = await api(`/api/items/by-serial?serials=${chunk.join(",")}`);
      for (const [serial, it] of Object.entries(res.items || {})) state.itemCache.set(+serial, it);
    } catch { /* leave this chunk's serials unresolved */ }
  }
  const out = {};
  for (const s of serials) { if (s == null) continue; const it = state.itemCache.get(+s); if (it) out[s] = it; }
  return out;
}
