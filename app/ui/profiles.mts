// ui/profiles.mts — the one writer of the player's profiles (PUT /api/profiles, app/build-spec.mts's v3 shape), and of
// a character's saved buffs and build label within them. The whole file goes up on each write, one write at a time and in order, so a
// quick run of buff toggles lands as the last one left it.
import { characterBuffs, characterEntry, characterProfile, type BuildBuffs, type CharacterEntry } from "../build-spec.mts";
import { state } from "./store.mts";
import { toast } from "./dom.mts";
import { api } from "./api.mts";

let queue: Promise<unknown> = Promise.resolve();
export function putProfiles(): Promise<{ ok: boolean; error?: string }> {
  const send = async (): Promise<{ ok: boolean; error?: string }> => {
    try { return await api<{ ok: boolean; error?: string }>("/api/profiles", { method: "PUT", body: state.profiles }); }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  };
  const next = queue.then(send);
  queue = next;
  return next;
}
// A character's buffs (Automatic's ones on, and the numbers edited for it, which Manual shares) saved at once, like a
// view choice: a character with no saved settings yet gets the ones the Suit Builder shows it, so nothing else changes.
// A failed save says so in a toast.
export function setCharacterBuffs(name: string, buffs: Partial<BuildBuffs>): void {
  const p = state.profiles!, saved = Object.hasOwn(p.characters, name) ? p.characters[name] : undefined, next = { ...characterBuffs(p, name), ...buffs };
  if (saved) saved.spec.buffs = next;
  else p.characters[name] = characterEntry(characterProfile(p, name, state.builtinTemplates), next);
  void putProfiles().then((r) => { if (!r.ok) toast(r.error!, "bad"); });
}
// A character's build label (issue #336) saved through PUT /api/profiles/label, which changes only that label in the
// file on the server, so this page's copy of the rest never goes with it. The page's copy then takes the label (or the
// entry the server made for a character with no saved settings). A refused save says why in a toast.
export async function setCharacterLabel(name: string, label: string): Promise<boolean> {
  let r: { ok: boolean; error?: string; entry?: CharacterEntry | null };
  try { r = await api<{ ok: boolean; error?: string; entry?: CharacterEntry | null }>("/api/profiles/label", { method: "PUT", body: { character: name, label } }); }
  catch (e) { r = { ok: false, error: (e as Error).message }; }
  if (!r.ok) { toast(r.error!, "bad"); return false; }
  const chars = state.profiles!.characters, mine = Object.hasOwn(chars, name) ? chars[name]! : undefined;
  if (!r.entry) return true;
  if (!mine) chars[name] = r.entry;
  else if (typeof r.entry.label === "string") mine.label = r.entry.label;
  else delete mine.label;
  return true;
}
