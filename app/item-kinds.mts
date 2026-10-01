// item-kinds.mts — the player's own item kinds (issue #150), <data>/item-kinds.json:
// {"version": 1, "names": {"<item name, lower-case>": kind}, "graphics": {"0x<hex>": kind}}. vault-lib.mts's
// overriddenKind layers them over the shipped table as the fold enriches each item; this module reads, checks and
// changes the file's document. Pure (no node: imports). salvageKindOverrides keeps every entry that still makes sense
// and names what it left out: every read of the file and every imported file go through it, so a hand edit, or a
// shared file with a kind this version does not know, loses that entry and not the rest.
import { OVERRIDE_KINDS, kindNameKey, kindGraphicKey, type KindOverrides } from "./vault-lib.mts";
export { OVERRIDE_KINDS };

// Entries across both maps, and an item name's length (a scan's own limit on a name); the largest file a read
// accepts and the body limit of an import. 5000 entries of the longest names in plain letters come to about 1.4 MB,
// but not in every script (three bytes a character for Chinese, six for an escaped lone surrogate), so the routes
// also refuse a change whose file would come out larger than a read accepts (kindsText).
export const KIND_LIMITS = { entries: 5000, name: 256 } as const;
export const MAX_KINDS_BYTES = 2e6;
const GRAPHIC_KEY = /^0x[0-9a-f]{1,4}$/i;
// No item name holds a control character; refusing them keeps a name to what it reads as.
const CONTROL = /[\u0000-\u001f\u007f]/;
export const isKindName = (s: string): boolean => { const key = kindNameKey(s); return !!key && key.length <= KIND_LIMITS.name && !CONTROL.test(key); };

export const emptyKindOverrides = (): KindOverrides => ({ names: {}, graphics: {} });
export const kindCount = (o: KindOverrides): number => Object.keys(o.names).length + Object.keys(o.graphics).length;
// The map key an item name or a graphic key from a file is kept under, or null when it is not one.
const nameKeyOf = (k: string): string | null => (isKindName(k) ? kindNameKey(k) : null);
const graphicKeyOf = (k: string): string | null => (GRAPHIC_KEY.test(k) ? kindGraphicKey(parseInt(k, 16)) : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function salvageKindOverrides(raw: unknown): { overrides: KindOverrides; problems: string[] } {
  if (!isObj(raw)) return { overrides: emptyKindOverrides(), problems: ["it is not a JSON object"] };
  if (raw.version !== undefined && raw.version !== 1) return { overrides: emptyKindOverrides(), problems: ["it is not a version 1 file"] };
  const problems: string[] = [];
  let room: number = KIND_LIMITS.entries;
  // Object.fromEntries defines each key as its own property, so a "__proto__" key is kept as a name, never a prototype.
  const read = (field: "names" | "graphics", keyOf: (k: string) => string | null, what: string): Record<string, string> => {
    const map = raw[field];
    if (map === undefined) return {};
    if (!isObj(map)) { problems.push(`${field} is not an object`); return {}; }
    const kept: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(map)) {
      const key = keyOf(k), at = `${field} ${JSON.stringify(k.slice(0, 40))}`;
      if (key == null) problems.push(`${at} is not ${what}`);
      else if (typeof v !== "string" || !OVERRIDE_KINDS.includes(v)) problems.push(`${at}: ${JSON.stringify(String(v).slice(0, 20))} is not a kind`);
      else if (room-- <= 0) { problems.push(`more than ${KIND_LIMITS.entries} entries; the rest were left out`); break; }
      else kept.push([key, v]);
    }
    return Object.fromEntries(kept);
  };
  const names = read("names", nameKeyOf, "an item name");
  const graphics = read("graphics", graphicKeyOf, "a graphic such as 0x1f14");
  return { overrides: { names, graphics }, problems };
}

// `base` with `add`'s entries over it (an import, or the one kind Classify this… sets), or null when the result
// would hold more than KIND_LIMITS.entries.
export function withKinds(base: KindOverrides, add: KindOverrides): KindOverrides | null {
  const next = { names: Object.fromEntries([...Object.entries(base.names), ...Object.entries(add.names)]), graphics: Object.fromEntries([...Object.entries(base.graphics), ...Object.entries(add.graphics)]) };
  return kindCount(next) > KIND_LIMITS.entries ? null : next;
}
// What Classify this… names: an item's name, its graphic, or both.
export interface KindTarget { name?: string | undefined; graphic?: number | undefined }
// The entries that give `at` the kind `kind` (a computed key is the object's own property, "__proto__" included).
export const kindsFor = ({ name, graphic }: KindTarget, kind: string): KindOverrides =>
  ({ names: name != null ? { [kindNameKey(name)]: kind } : {}, graphics: graphic != null ? { [kindGraphicKey(graphic)]: kind } : {} });
// `base` without the entries for `at` (Reset to automatic).
export function withoutKinds(base: KindOverrides, { name, graphic }: KindTarget): KindOverrides {
  const nameKey = name != null ? kindNameKey(name) : null, graphicKey = graphic != null ? kindGraphicKey(graphic) : null;
  return { names: Object.fromEntries(Object.entries(base.names).filter(([k]) => k !== nameKey)), graphics: Object.fromEntries(Object.entries(base.graphics).filter(([k]) => k !== graphicKey)) };
}
// The file's document, as read back and exported, and as the text the server writes.
export const kindsDocument = (o: KindOverrides): { version: 1 } & KindOverrides => ({ version: 1, names: o.names, graphics: o.graphics });
export const kindsText = (o: KindOverrides): string => JSON.stringify(kindsDocument(o), null, 2) + "\n";
