// ui/shard.mts — changeShard(shard): the one place a shard switch is persisted and applied. PUTs
// /api/settings then reloads the whole page — the simplest way to re-apply the new shard's rules
// everywhere (caps, rarity, tag units, pools) at once, since state.rules and everything folded under
// it (state.inv, the suit builder's pools) live server-side and are only ever (re-)fetched on load().
// Shared by the header picker (ui/app.mts) and the setup wizard's shard step (ui/wizard.mts) so both
// paths behave identically. Before this module existed the wizard duplicated the PUT and only synced
// the header <select>'s displayed value, leaving state.rules (and everything folded under it) on the
// old shard until a manual reload — Phase 4 final review, Important 3.
import { toast } from "./dom.mts";
import { api } from "./api.mts";
import type { SettingsApiResponse } from "./api-types.mts";

// Resolves to true on success (the caller can expect the page to be reloading out from under it) or
// false on failure (already toasted here; the caller should restore its control's displayed value).
export async function changeShard(shard: string): Promise<boolean> {
  try {
    const opts = { method: "PUT", body: { shard } };
    await api<SettingsApiResponse>("/api/settings", opts);
    location.reload();
    return true;
  } catch (e) {
    // Every throw on this path is a real Error (api.mts's own errors, and JSON/network failures) —
    // the instanceof check narrows `e` from strict mode's `unknown` without changing behaviour for
    // any error this call can actually produce.
    toast(e instanceof Error ? e.message : String(e), "bad");
    return false;
  }
}
