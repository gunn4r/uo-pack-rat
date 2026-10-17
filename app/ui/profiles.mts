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
// A character's build label (issue #336) saved: trimmed, and blank removes it. A character with no saved settings yet
// gets the ones the Suit Builder shows it, as with buffs. A refused save puts the profile back and says why in a toast.
export async function setCharacterLabel(name: string, label: string): Promise<boolean> {
  const p = state.profiles!, had = Object.hasOwn(p.characters, name), before = had ? p.characters[name]! : undefined, text = label.trim();
  if (!had && !text) return true;
  const { label: _old, ...entry }: CharacterEntry = before ?? characterEntry(characterProfile(p, name, state.builtinTemplates), characterBuffs(p, name));
  p.characters[name] = text ? { ...entry, label: text } : entry;
  const r = await putProfiles();
  if (r.ok) return true;
  if (before) p.characters[name] = before; else delete p.characters[name];
  toast(r.error!, "bad");
  return false;
}
