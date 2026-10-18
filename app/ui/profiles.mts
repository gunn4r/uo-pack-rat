// ui/profiles.mts — the one writer of the player's profiles (app/build-spec.mts's v3 shape), one save at a time and in
// order, each made on the page's copy at once so the page shows it. A character's buffs and build label go up as edits
// (PATCH /api/profiles, app/profile-edits.mts), made on the file as it is on the server. The other saves still send the
// whole file with the stamp the page read it at (PUT /api/profiles): one refused as stale (another window or an AI
// assistant saved since) reloads the file, makes the edit again on it and sends that, so a stale copy never drops or
// reverts anything another window saved.
import type { BuildBuffs, ProfilesV3 } from "../build-spec.mts";
import { applyProfileEdits, type ProfileEdit, type ProfileEditContext } from "../profile-edits.mts";
import { state } from "./store.mts";
import { toast } from "./dom.mts";
import { api } from "./api.mts";
import type { ApiError, ProfilesApiResponse } from "./api-types.mts";

// One change to the profiles. It runs again on the copy as it is when its save's turn comes (where it changes nothing
// more) and on a reloaded copy after a stale refusal, so it sets what it means rather than toggling; false when what it
// changes is gone from the copy (a template deleted elsewhere), and nothing is saved.
export type ProfilesEdit = (p: ProfilesV3) => boolean | void;
// `reloaded`: the page's copy is the file as saved elsewhere now, without this edit, so a caller has nothing to undo.
export interface ProfilesSave { ok: boolean; error?: string; reloaded?: boolean }
const STALE = "Your profiles were changed in another window or by an AI assistant, so they were reloaded, and your last change was not saved. Make it again on the profiles as they are now.";

async function reloadProfiles(): Promise<void> {
  const r = await api<ProfilesApiResponse>("/api/profiles");
  state.profiles = r.profiles;
  state.profilesStamp = r.stamp;
  state.builtinTemplates = r.builtinTemplates || {};
}
async function send(edit: ProfilesEdit, again = false): Promise<ProfilesSave> {
  if (edit(state.profiles!) === false) return { ok: false, error: STALE, reloaded: again };
  try {
    const r = await api<{ stamp: string }>("/api/profiles", { method: "PUT", body: { ...state.profiles, base: state.profilesStamp } });
    state.profilesStamp = r.stamp;
    return { ok: true };
  } catch (e) {
    if ((e as ApiError).code !== "stale") return { ok: false, error: (e as Error).message };
    try { await reloadProfiles(); } catch (r) { return { ok: false, error: (r as Error).message }; }
    return again ? { ok: false, error: STALE, reloaded: true } : send(edit, true);
  }
}
let queue: Promise<unknown> = Promise.resolve();
// Saves run one at a time, so each names the stamp the one before it left.
function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => null);
  return next;
}
export function saveProfiles(edit: ProfilesEdit): Promise<ProfilesSave> {
  edit(state.profiles!);
  return inTurn(() => send(edit));
}
// Edits to the profiles (app/profile-edits.mts) sent as themselves (PATCH /api/profiles), so the server makes them on
// the file as it is and nothing else of this page's copy goes with them. They are made on the page's copy at once, and
// again when their turn comes (a reload before then drops them from the copy). Answered with the stamp the file had
// before them: this page's own, and the copy is the file; another, and the page reads the file again. A list the server
// can't make (a template deleted elsewhere) is refused whole, and the page reads the file again too.
export function editProfiles(edits: ProfileEdit[]): Promise<ProfilesSave> {
  const ctx = (): ProfileEditContext => ({ builtins: state.builtinTemplates });
  applyProfileEdits(state.profiles!, edits, ctx());
  return inTurn(async () => {
    applyProfileEdits(state.profiles!, edits, ctx());
    try {
      const r = await api<{ stamp: string; was: string }>("/api/profiles", { method: "PATCH", body: { edits } });
      if (r.was === state.profilesStamp) { state.profilesStamp = r.stamp; return { ok: true }; }
      await reloadProfiles();
      return { ok: true, reloaded: true };
    } catch (e) {
      try { await reloadProfiles(); } catch { /* the copy as it was */ }
      return { ok: false, error: (e as Error).message, reloaded: true };
    }
  });
}
// A character's buffs (Automatic's ones on, and the numbers edited for it, which Manual shares) saved at once, like a
// view choice: a character with no saved settings yet gets the ones the Suit Builder shows it, so nothing else changes.
// A failed save says so in a toast.
export function setCharacterBuffs(name: string, buffs: Partial<BuildBuffs>): void {
  void editProfiles([{ op: "setBuffs", name, buffs }]).then((r) => { if (!r.ok) toast(r.error!, "bad"); });
}
// A character's build label (issue #336), trimmed, a blank one removed: a character with no saved settings gets the ones
// the Suit Builder shows it. A refused save says why in a toast.
export async function setCharacterLabel(name: string, label: string): Promise<boolean> {
  const r = await editProfiles([{ op: "setLabel", name, label }]);
  if (!r.ok) toast(r.error!, "bad");
  return r.ok;
}
