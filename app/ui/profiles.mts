// ui/profiles.mts — the one writer of the player's profiles (app/build-spec.mts's v3 shape), one save at a time and in
// order, each made on the page's copy at once so the page shows it. A character's buffs and build label go up as edits
// (PATCH /api/profiles, app/profile-edits.mts), made on the file as it is on the server. The other saves still send the
// whole file with the stamp the page read it at (PUT /api/profiles): one refused as stale (another window or an AI
// assistant saved since) reloads the file, makes the edit again on it and sends that, so a stale copy never drops or
// reverts anything another window saved.
//
// map: ui-infra
// owns: `saveProfiles`, `editProfiles`, `loadProfiles`, `setCharacterBuffs`, `setCharacterLabel`
import type { BuildBuffs, ProfilesV3 } from "../build-spec.mts";
import { applyProfileEdits, type ProfileEdit, type ProfileEditContext } from "../profile-edits.mts";
import { state } from "./store.mts";
import { toast } from "./dom.mts";
import { api } from "./api.mts";
import type { ApiError, ProfilesApiResponse } from "./api-types.mts";

// One change to the profiles. It runs again on the copy as it is when its save's turn comes (where it changes nothing
// more) and on a reloaded copy after a stale refusal, so it sets what it means rather than toggling; false when what it
// changes is gone from the copy (a template deleted elsewhere, or by a change queued just before it), and nothing is saved.
export type ProfilesEdit = (p: ProfilesV3) => boolean | void;
// `reloaded`: the page's copy was read again from the file during this save (with the edit made again on it when ok, and
// without it when not), so a caller has nothing to undo, and redraws what it shows from the copy.
export interface ProfilesSave { ok: boolean; error?: string; reloaded?: boolean }
const STALE = "Your profiles were changed in another window or by an AI assistant, so they were reloaded, and your last change was not saved. Make it again on the profiles as they are now.";
const GONE = "Your last change was not saved: what it changes was removed by the change you made just before it.";

async function reloadProfiles(): Promise<void> {
  const r = await api<ProfilesApiResponse>("/api/profiles");
  state.profiles = r.profiles;
  state.profilesStamp = r.stamp;
  state.builtinTemplates = r.builtinTemplates || {};
}
async function send(edit: ProfilesEdit, again = false): Promise<ProfilesSave> {
  if (edit(state.profiles!) === false) return { ok: false, error: again ? STALE : GONE, reloaded: again };
  // The answer's stamp is this copy's: taken only while the page still holds it, never over a copy read meanwhile.
  const sent = state.profiles;
  try {
    const r = await api<{ stamp: string }>("/api/profiles", { method: "PUT", body: { ...sent, base: state.profilesStamp } });
    if (state.profiles === sent) state.profilesStamp = r.stamp;
    return { ok: true, reloaded: again };
  } catch (e) {
    if ((e as ApiError).code !== "stale") return { ok: false, error: (e as Error).message, reloaded: again };
    try { await reloadProfiles(); } catch (r) { return { ok: false, error: (r as Error).message, reloaded: again }; }
    return again ? { ok: false, error: STALE, reloaded: true } : send(edit, true);
  }
}
let queue: Promise<unknown> = Promise.resolve();
// Saves and loadProfiles run one at a time, so each save names the stamp the one before it left.
function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => null);
  return next;
}
// The profiles read again (a scan landed, a Forget): in turn with the saves, so a save in flight is never answered over
// a copy read before it landed.
export function loadProfiles(): Promise<void> { return inTurn(reloadProfiles); }
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
    const sent = state.profiles;
    try {
      const r = await api<{ stamp: string; was: string }>("/api/profiles", { method: "PATCH", body: { edits } });
      // the copy plus the edits is the file only while the page still holds the copy they were made on
      if (r.was === state.profilesStamp && state.profiles === sent) { state.profilesStamp = r.stamp; return { ok: true }; }
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
