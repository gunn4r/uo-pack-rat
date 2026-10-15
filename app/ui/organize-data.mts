// ui/organize-data.mts — the page's copy of the Organize setup (issue #11): loading it with the blacklist
// (GET /api/organize, GET /api/blacklist), saving it whole (PUT /api/organize), the presets (GET
// /api/organize/presets, fetched once), the rule editor's live count (POST /api/organize/match) and the location
// texts relabelled from it. Every screen that shows or edits labels and rules goes through here; a save announces
// itself with an "organizechange" event on document, on which the Organize screen, the Containers view and the
// Items rows redraw. A save names the setup it was made from (its stamp, issue #280): one saved elsewhere since (another
// window, an AI assistant) is refused, and the page reloads that one instead of writing over it.
import { state } from "./store.mts";
import { api } from "./api.mts";
import { errorText } from "./messages.mts";
import { labelledPlaces } from "./organize-model.mts";
import type { ApiError, BlacklistApiResponse, OrganizeApiResponse, OrganizeConfig, OrganizeMatchApiResponse, OrganizePresetsApiResponse, OrganizePutApiResponse, RuleMatch } from "./api-types.mts";

export function refreshPlaces(): void {
  state.organize.places = labelledPlaces(state.inv?.containers || {}, state.organize.config?.labels || {});
}
// The blacklist is best-effort: without it Label… is offered on a blacklisted chest, and PUT refuses the label.
export async function loadOrganize(): Promise<void> {
  const [o, b] = await Promise.all([api<OrganizeApiResponse>("/api/organize"), api<BlacklistApiResponse>("/api/blacklist").catch(() => null)]);
  state.organize.config = o.config;
  state.organize.problems = o.problems;
  state.organize.stamp = o.stamp;
  if (b) state.organize.blacklist = b.containers.map((e) => +e.serial);
}
// The whole setup replaced by what `update` makes of the page's copy; the server's refusal as a sentence, or null once
// saved (or when `update` changes nothing). Saves run one at a time, and `update` runs when its turn comes, on the
// setup the save before it left, so quick edits (two selects, a held ↓ on a rule) each build on the last and none is
// lost or read as a change made elsewhere. A setup changed elsewhere since the page read it is reloaded and shown, and
// the change asked for is not saved. `base` names the setup the change was made from when it is not the page's copy
// (Auto organize's proposal).
let saving: Promise<unknown> = Promise.resolve();
export function saveConfig(update: (cfg: OrganizeConfig) => OrganizeConfig, base?: string | null): Promise<string | null> {
  const run = saving.then(() => putConfig(update, base));
  saving = run.catch(() => null);
  return run;
}
async function putConfig(update: (cfg: OrganizeConfig) => OrganizeConfig, base?: string | null): Promise<string | null> {
  const cfg = state.organize.config!, next = update(cfg);
  if (next === cfg) return null;
  let saved: OrganizePutApiResponse;
  try { saved = await api<OrganizePutApiResponse>("/api/organize", { method: "PUT", body: { ...next, base: (base ?? state.organize.stamp) ?? undefined } }); } catch (e) {
    if ((e as ApiError).code !== "stale") return errorText(e);
    try { await loadOrganize(); } catch { /* the setup as the page had it */ }
    refreshPlaces();
    document.dispatchEvent(new Event("organizechange"));
    return "The Organize setup was changed in another window or by an AI assistant, so it was reloaded and your last change was not saved. Make it again on the setup as it is now.";
  }
  state.organize.config = next;
  state.organize.stamp = saved.stamp;
  state.organize.problems = [];
  refreshPlaces();
  document.dispatchEvent(new Event("organizechange"));
  return null;
}
export async function loadPresets(): Promise<void> {
  state.organize.presets ??= (await api<OrganizePresetsApiResponse>("/api/organize/presets")).presets;
}
// What one rule filter takes of the movable items in labelled roots, ignoring the other rules.
export const matchCount = (match: RuleMatch): Promise<OrganizeMatchApiResponse> => api<OrganizeMatchApiResponse>("/api/organize/match", { method: "POST", body: { match } });
