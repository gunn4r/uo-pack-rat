// ui/customize-model.mts — the doll card's Customize popover (issue #57) as data: a look turned into the game's character-creation choices and back, only valid combinations (changing race or gender re-picks the nearest valid choice), and the session-only looks the player made, one per character and one for no character, dropped by a reload or a newer scan of that character. Pure apart from that in-memory map, so a node test covers it.
//
// map: house
// owns: `Choice`, `choiceOf`, `lookOfChoice`, `repick`, `hasFacialHair`, `sameLook`, `customLook`, `setCustomLook`
import { FEMALE_BODIES, RACE_BODIES, raceOf, type Look, type Race, type Worn } from "../paperdoll-look.mts";
import type { PaperdollOptionsApiResponse } from "./api-types.mts";

type Options = PaperdollOptionsApiResponse["races"];
// The popover's fields. Hues are plain numbers: the skin goes back into a look with the 0x8000 (partial) bit, as the server sends it. A style of 0 is none.
export interface Choice { race: Race; female: boolean; skin: number; hairStyle: number; hairHue: number; facialStyle: number; facialHue: number; facialSameAsHair: boolean }

// The stand-in's skin when it is customized first: the game's default human skin.
const DEFAULT_SKIN = 0x03ea;
// Male humans and male gargoyles have facial hair, as in the game; elves and female characters none.
export const hasFacialHair = (c: Pick<Choice, "race" | "female">): boolean => !c.female && c.race !== "elf";

// A look as choices, then made valid (repick). A look with no skin (the stand-in) takes the default human skin.
export function choiceOf(look: Look, options: Options): Choice {
  const hairHue = look.hair?.hue ?? 0;
  return repick({
    race: raceOf(look.body), female: FEMALE_BODIES.has(look.body), skin: look.hue & 0x3fff || DEFAULT_SKIN,
    hairStyle: look.hair?.graphic ?? 0, hairHue, facialStyle: look.beard?.graphic ?? 0, facialHue: look.beard?.hue ?? hairHue, facialSameAsHair: !look.beard || look.beard.hue === hairHue,
  }, options);
}
// The look the choices make. `face` (the scan's) is kept only while the race is the scan's own.
export function lookOfChoice(c: Choice, scanned: Look): Look {
  const [male, female] = RACE_BODIES[c.race];
  return {
    body: c.female ? female : male, hue: 0x8000 | c.skin,
    hair: c.hairStyle ? { graphic: c.hairStyle, hue: c.hairHue } : null,
    beard: hasFacialHair(c) && c.facialStyle ? { graphic: c.facialStyle, hue: c.facialSameAsHair ? c.hairHue : c.facialHue } : null,
    face: raceOf(scanned.body) === c.race ? scanned.face : null,
  };
}
// The nearest valid choices for their race and gender: a hair or facial-hair style not offered becomes none, a hue not in the race's palette its first entry, and facial hair goes for a female or an elf.
export function repick(c: Choice, options: Options): Choice {
  const r = options[c.race], styles = c.female ? r.hairStyles.female : r.hairStyles.male;
  const inPalette = (hue: number, list: Array<{ hue: number }>): number => (list.some((s) => s.hue === hue) ? hue : list[0]?.hue ?? 0);
  const facial = hasFacialHair(c) && r.facialHair.some((s) => s.graphic === c.facialStyle) ? c.facialStyle : 0;
  return {
    ...c,
    skin: inPalette(c.skin, r.skin),
    hairStyle: styles.some((s) => s.graphic === c.hairStyle) ? c.hairStyle : 0,
    hairHue: inPalette(c.hairHue, r.hair),
    facialStyle: facial,
    facialHue: inPalette(c.facialHue, r.hair),
  };
}
const piece = (w: Worn | null): string => (w ? `${w.graphic}:${w.hue}` : "");
export const sameLook = (a: Look, b: Look): boolean => a.body === b.body && a.hue === b.hue && piece(a.hair) === piece(b.hair) && piece(a.beard) === piece(b.beard) && piece(a.face) === piece(b.face);

// The looks made this session, by character name ("" for no character), each with the scan it was made over: a newer scan of that character drops it, and nothing keeps them past a reload.
const custom = new Map<string, { look: Look; scannedAt: string | null }>();
export function customLook(name: string | null, scannedAt: string | null): Look | null {
  const got = custom.get(name ?? "");
  if (!got) return null;
  if (got.scannedAt !== scannedAt) { custom.delete(name ?? ""); return null; }
  return got.look;
}
// Keeps `look` for this character, or forgets it (null: Reset).
export function setCustomLook(name: string | null, scannedAt: string | null, look: Look | null): void {
  if (look) custom.set(name ?? "", { look, scannedAt }); else custom.delete(name ?? "");
}
