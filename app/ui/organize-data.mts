// ui/organize-data.mts — the page's copy of the Organize setup (issue #11): loading it with the blacklist
// (GET /api/organize, GET /api/blacklist), saving it whole (PUT /api/organize), the presets (GET
// /api/organize/presets, fetched once) and the location texts relabelled from it. Every screen that shows or
// edits labels and rules goes through here; a save announces itself with an "organizechange" event on document,
// on which the Organize screen, the Containers view and the Items rows redraw.
import { state } from "./store.mts";
import { api } from "./api.mts";
import { errorText } from "./messages.mts";
import { labelledPlaces } from "./organize-model.mts";
import type { BlacklistApiResponse, OrganizeApiResponse, OrganizeConfig, OrganizePresetsApiResponse } from "./api-types.mts";

export function refreshPlaces(): void {
  state.organize.places = labelledPlaces(state.inv?.containers || {}, state.organize.config?.labels || {});
}
// The blacklist is best-effort: without it Label… is offered on a blacklisted chest, and PUT refuses the label.
export async function loadOrganize(): Promise<void> {
  const [o, b] = await Promise.all([api<OrganizeApiResponse>("/api/organize"), api<BlacklistApiResponse>("/api/blacklist").catch(() => null)]);
  state.organize.config = o.config;
  state.organize.problems = o.problems;
  if (b) state.organize.blacklist = b.containers.map((e) => +e.serial);
}
// The whole setup replaced; the server's refusal as a sentence, or null once saved.
export async function saveConfig(next: OrganizeConfig): Promise<string | null> {
  try { await api("/api/organize", { method: "PUT", body: next }); } catch (e) { return errorText(e); }
  state.organize.config = next;
  state.organize.problems = [];
  refreshPlaces();
  document.dispatchEvent(new Event("organizechange"));
  return null;
}
export async function loadPresets(): Promise<void> {
  state.organize.presets ??= (await api<OrganizePresetsApiResponse>("/api/organize/presets")).presets;
}
