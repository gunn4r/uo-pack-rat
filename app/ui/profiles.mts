// ui/profiles.mts — the one writer of the player's profiles (app/build-spec.mts's v3 shape). Every save is a list of edits (app/profile-edits.mts) sent as themselves (PATCH /api/profiles), so the server makes them on the file as it is and nothing else of this page's copy goes with them: two windows' saves land side by side. They are made on the page's copy at once so the page shows them, one save at a time and in order.
//
// map: ui-infra
// owns: `editProfiles`, `loadProfiles`, `setCharacterBuffs`, `setCharacterLabel`
import type { BuildBuffs } from "../build-spec.mts";
import { applyProfileEdits, type ProfileEdit, type ProfileEditContext } from "../profile-edits.mts";
import { state } from "./store.mts";
import { api } from "./api.mts";
import type { ApiError, ProfilesApiResponse } from "./api-types.mts";
import { toast } from "./components.mts";

// `reloaded`: the page's copy was read again (the file had another window's saves, or the edits were refused), so a
// caller showing the profiles redraws.
export interface ProfilesSave { ok: boolean; error?: string; reloaded?: boolean }
// A stamp no file has: the page's copy is not known to be the file, so the next save lands on the file as it is and the page then reloads it (no answer's `was` matches this stamp).
const UNREAD = "unread";

async function reloadProfiles(): Promise<void> {
  const r = await api<ProfilesApiResponse>("/api/profiles");
  state.profiles = r.profiles;
  state.profilesStamp = r.stamp;
  state.builtinTemplates = r.builtinTemplates || {};
}
let queue: Promise<unknown> = Promise.resolve();
// Saves and loadProfiles run one at a time, so each answer's `was` is compared with the stamp the one before it left.
function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => null);
  return next;
}
// The profiles read again (a scan landed, a Forget): in turn with the saves, so a save in flight is never answered over
// a copy read before it landed.
export function loadProfiles(): Promise<void> { return inTurn(reloadProfiles); }
// The edits are made on the page's copy at once, and again when their turn comes (a reload before then drops them from
// the copy). The answer names the stamp the file had before them: this page's own, and the copy is the file; another,
// and the page reads the file again. A list the server can't make (a template deleted elsewhere) is refused whole, says
// why, and the page reads the file again too.
//
// When the file can't be read again either (the server is down), the copy goes back to how it was before the edits (when
// nothing has replaced it since), and its stamp to one no file has, so the next save reads the file first rather than
// carrying a copy that is not the file. `reloaded` says whether the file was read again.
export function editProfiles(edits: ProfileEdit[]): Promise<ProfilesSave> {
  const ctx = (): ProfileEditContext => ({ builtins: state.builtinTemplates });
  const made = state.profiles!, before = structuredClone(made);
  applyProfileEdits(made, edits, ctx());
  const unread = (): void => { state.profilesStamp = UNREAD; };
  return inTurn(async () => {
    applyProfileEdits(state.profiles!, edits, ctx());
    const sent = state.profiles;
    let r: { stamp: string; was: string };
    try { r = await api<{ stamp: string; was: string }>("/api/profiles", { method: "PATCH", body: { edits } }); }
    catch (e) {
      // no answer at all (the connection dropped): the server may have saved them before it went
      const lost = (e as ApiError).status === undefined, error = lost ? `${(e as Error).message}. The server did not answer, so the change may have been saved: the profiles were read again and show it if it was.` : (e as Error).message;
      try { await reloadProfiles(); return { ok: false, error, reloaded: true }; }
      catch {
        if (state.profiles === made) state.profiles = before;
        unread();
        return { ok: false, error: (e as Error).message, reloaded: false };
      }
    }
    // the copy plus the edits is the file only while the page still holds the copy they were made on
    if (r.was === state.profilesStamp && state.profiles === sent) { state.profilesStamp = r.stamp; return { ok: true }; }
    try { await reloadProfiles(); return { ok: true, reloaded: true }; }
    catch { unread(); return { ok: true, reloaded: false }; }
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
