// profile-edits.mts — the changes a page or a tool makes to the player's profiles, as data (quality pass 1, W1a): a closed `ProfileEdit` union and `applyProfileEdit`, pure and browser-safe. PATCH /api/profiles applies a list of them to the file on the server in one write, and the page applies the same ones to its own copy, so a save sends what it means rather than the page's whole copy, and two windows' saves land side by side.
//
// map: builder
// owns: `ProfileEdit`, `applyProfileEdit`, `applyProfileEdits`, `profileEditError`
import { characterBuffs, characterEntry, characterProfile, labelError, type BuildBuffs, type CharacterEntry, type ProfilesV3, type TemplateEntry, type TemplateMap, type TemplateSpec } from "./build-spec.mts";
import { isBoundedString } from "./guards.mts";

export type ProfileEdit =
  // a character's buffs (Automatic's ones on, the numbers edited for it): a character with no saved settings gets the
  // ones the Suit Builder shows it (characterProfile), so nothing else changes
  | { op: "setBuffs"; name: string; buffs: Partial<BuildBuffs> }
  // a character's build label (issue #336), trimmed; a blank one removed
  | { op: "setLabel"; name: string; label: string }
  // a character's settings from the panel (Save profile): its race, template and spec, keeping its saved buffs and label
  // and any other field, and the spec's parts the panel doesn't edit (goal, search)
  | { op: "saveCharacter"; name: string; entry: CharacterEntry }
  | { op: "deleteCharacter"; name: string }
  // a template saved under a name (Save as template, Duplicate), over one already there; with `create`, refused when
  // another template has that name (one made elsewhere since the name was checked is never overwritten unasked)
  | { op: "putTemplate"; id: string; entry: TemplateEntry; create?: boolean }
  // a template's settings replaced (Update), its other fields kept; refused when it is gone
  | { op: "updateTemplate"; id: string; spec: TemplateSpec; savedAt: string }
  | { op: "deleteTemplate"; id: string }
  // a template renamed, with every character made from it following; refused when it is gone or the name is taken
  | { op: "renameTemplate"; from: string; to: string };
export type ProfileEditOp = ProfileEdit["op"];

// What an edit needs besides the file: the shard's built-in templates (a new character entry starts from the first one),
// and whether a character is one a label can go on (the server's check: a scanned or saved character, never a pseudo one).
export interface ProfileEditContext { builtins: TemplateMap; canLabel?: (name: string) => boolean }

const NAME_MAX = 64, ID_MAX = 4096;
// Names an object key can't safely be: assigning one changes the map's prototype instead of adding an entry.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
// Why a value is not a ProfileEdit, or null. The values inside (specs, buffs) are held to the profiles schema and
// buildSpecError once applied, with the rest of the file.
export function profileEditError(v: unknown): string | null {
  if (!isObject(v)) return "an edit must be an object";
  const name = (): string | null => (isBoundedString(v.name, NAME_MAX) && v.name && !UNSAFE_KEYS.has(v.name) ? null : `${String(v.op)}: name must be a character's name`);
  const id = (k: string): string | null => (isBoundedString(v[k], ID_MAX) && v[k] && !UNSAFE_KEYS.has(v[k] as string) ? null : `${String(v.op)}: ${k} must be a template's name`);
  switch (v.op) {
    case "setBuffs": return name() ?? (isObject(v.buffs) ? null : "setBuffs: buffs must be an object");
    case "setLabel": return name() ?? labelError(v.label);
    case "saveCharacter": return name() ?? (isObject(v.entry) && isObject(v.entry.spec) ? null : "saveCharacter: entry must be a character entry");
    case "deleteCharacter": return name();
    case "putTemplate": return id("id") ?? (isObject(v.entry) && isObject(v.entry.spec) ? null : "putTemplate: entry must be a template entry") ?? (v.create === undefined || typeof v.create === "boolean" ? null : "putTemplate: create must be true or false");
    case "updateTemplate": return id("id") ?? (isObject(v.spec) && typeof v.savedAt === "string" ? null : "updateTemplate: spec must be a template spec, savedAt a date");
    case "deleteTemplate": return id("id");
    case "renameTemplate": return id("from") ?? id("to");
    default: return `unknown edit ${JSON.stringify(v.op)}`;
  }
}

// One edit made on `doc` (changed in place). The reason it can't be made, or null. Made again on a file it is already
// in, it changes nothing more.
export function applyProfileEdit(doc: ProfilesV3, edit: ProfileEdit, ctx: ProfileEditContext): string | null {
  const chars = doc.characters, tpls = doc.templates;
  const own = (name: string): CharacterEntry | undefined => (Object.hasOwn(chars, name) ? chars[name] : undefined);
  const fresh = (name: string, buffs: BuildBuffs): CharacterEntry => characterEntry(characterProfile(doc, name, ctx.builtins), buffs);
  switch (edit.op) {
    case "setBuffs": {
      const next = { ...characterBuffs(doc, edit.name), ...edit.buffs }, saved = own(edit.name);
      if (saved) saved.spec.buffs = next;
      else chars[edit.name] = fresh(edit.name, next);
      return null;
    }
    case "setLabel": {
      const saved = own(edit.name), text = edit.label.trim();
      if (ctx.canLabel && !ctx.canLabel(edit.name)) return `no character named ${edit.name}`;
      if (!saved && !text) return null;
      const { label: _old, ...entry } = saved ?? fresh(edit.name, characterBuffs(doc, edit.name));
      chars[edit.name] = text ? { ...entry, label: text } : entry;
      return null;
    }
    case "saveCharacter": {
      const saved = own(edit.name), buffs = characterBuffs(doc, edit.name);
      const { race: _race, template: _template, spec: was, ...rest } = saved ?? { spec: undefined };
      const { label: _label, ...entry } = edit.entry;
      chars[edit.name] = { ...rest, ...entry, spec: { ...was, ...entry.spec, buffs } };
      return null;
    }
    case "deleteCharacter":
      delete chars[edit.name];
      return null;
    case "putTemplate":
      // the same entry already there is this edit made before
      if (edit.create && Object.hasOwn(tpls, edit.id) && JSON.stringify(tpls[edit.id]) !== JSON.stringify(edit.entry)) return `there is already a template named ${edit.id}`;
      tpls[edit.id] = edit.entry;
      return null;
    case "updateTemplate":
      if (!Object.hasOwn(tpls, edit.id)) return `the ${edit.id} template was deleted elsewhere, so it was not updated`;
      tpls[edit.id] = { ...tpls[edit.id], spec: edit.spec, savedAt: edit.savedAt };
      return null;
    case "deleteTemplate":
      delete tpls[edit.id];
      return null;
    case "renameTemplate": {
      if (!Object.hasOwn(tpls, edit.from)) return Object.hasOwn(tpls, edit.to) ? null : `the ${edit.from} template was deleted elsewhere, so it was not renamed`;
      if (Object.hasOwn(tpls, edit.to)) return `there is already a template named ${edit.to}`;
      tpls[edit.to] = tpls[edit.from]!;
      delete tpls[edit.from];
      for (const c of Object.values(chars)) if (c.template === edit.from) c.template = edit.to;
      return null;
    }
  }
}
// A list of edits made in order; the first that can't be made stops it, and its reason is answered.
export function applyProfileEdits(doc: ProfilesV3, edits: readonly ProfileEdit[], ctx: ProfileEditContext): string | null {
  for (const e of edits) { const bad = applyProfileEdit(doc, e, ctx); if (bad) return bad; }
  return null;
}
