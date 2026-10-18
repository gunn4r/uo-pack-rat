// ui/profiles.mts — the one writer of the player's profiles (PUT /api/profiles with the stamp it read, app/build-spec.mts's
// v3 shape; a stale refusal reloads them and makes the edit again), and of a character's saved buffs and build label within
// them. A save is an edit to the page's copy, made at once so the page
// shows it, then sent as the whole file with the stamp the page read it at, one save at a time and in order. A file
// saved elsewhere since (another window, an AI assistant) is refused as stale: the page reloads it, makes the edit again
// on what it got, and sends that, so a stale copy never drops or reverts anything another window saved.
//
// map: ui-infra
// owns: `saveProfiles`, `loadProfiles`, `setCharacterBuffs`, `setCharacterLabel`
import { characterBuffs, characterEntry, characterProfile, type BuildBuffs, type CharacterEntry, type ProfilesV3 } from "../build-spec.mts";
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
// Runs one at a time with the label saves and loadProfiles, so each names the stamp the one before it left.
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
// A character's buffs (Automatic's ones on, and the numbers edited for it, which Manual shares) saved at once, like a
// view choice: a character with no saved settings yet gets the ones the Suit Builder shows it, so nothing else changes.
// A failed save says so in a toast.
export function setCharacterBuffs(name: string, buffs: Partial<BuildBuffs>): void {
  void saveProfiles((p) => {
    const saved = Object.hasOwn(p.characters, name) ? p.characters[name] : undefined, next = { ...characterBuffs(p, name), ...buffs };
    if (saved) saved.spec.buffs = next;
    else p.characters[name] = characterEntry(characterProfile(p, name, state.builtinTemplates), next);
  }).then((r) => { if (!r.ok) toast(r.error!, "bad"); });
}
// A character's build label (issue #336) saved through PUT /api/profiles/label, which changes only that label in the
// file on the server, so this page's copy of the rest never goes with it. The page's copy then takes the label (or the
// entry the server made for a character with no saved settings), and the stamp it answers with. A refused save says why
// in a toast.
export function setCharacterLabel(name: string, label: string): Promise<boolean> {
  return inTurn(async () => {
    type LabelSave = { ok: boolean; error?: string; entry?: CharacterEntry | null; stamp?: string; was?: string };
    let r: LabelSave;
    try { r = await api<LabelSave>("/api/profiles/label", { method: "PUT", body: { character: name, label } }); }
    catch (e) { r = { ok: false, error: (e as Error).message }; }
    if (!r.ok) { toast(r.error!, "bad"); return false; }
    // saved over the file this page read: the copy plus the label is the file. Saved over another one: the rest is read again.
    if (r.was !== state.profilesStamp) {
      try { await reloadProfiles(); } catch (e) { toast((e as Error).message, "bad"); }
      return true;
    }
    state.profilesStamp = r.stamp!;
    const chars = state.profiles!.characters, mine = Object.hasOwn(chars, name) ? chars[name]! : undefined;
    if (!r.entry) return true;
    if (!mine) chars[name] = r.entry;
    else if (typeof r.entry.label === "string") mine.label = r.entry.label;
    else delete mine.label;
    return true;
  });
}
