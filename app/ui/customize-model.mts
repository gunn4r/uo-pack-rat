// ui/customize-model.mts — the doll card's Customize popover (issue #57) as data: a look turned into the game's character-creation choices and back (a scanned value outside the game's lists, such as a dyed hair color, kept as it is), a race or gender change re-picking only what it makes invalid, and the session-only looks the player made, one per character and one for no character, dropped by a reload or a newer scan of that character. Pure apart from that in-memory map, so a node test covers it.
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

// A look as choices, as it is: a hue outside its race's palette or a style outside the game's lists stays (the popover shows it as "Current"). A look with no skin (the stand-in) takes the default human skin.
export function choiceOf(look: Look): Choice {
  const hairHue = look.hair?.hue ?? 0;
  return {
    race: raceOf(look.body), female: FEMALE_BODIES.has(look.body), skin: look.hue & 0x3fff || DEFAULT_SKIN,
    hairStyle: look.hair?.graphic ?? 0, hairHue, facialStyle: look.beard?.graphic ?? 0, facialHue: look.beard?.hue ?? hairHue, facialSameAsHair: !look.beard || look.beard.hue === hairHue,
  };
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
// The choices after a change from `prev` to `next`, with only what a race or gender change makes invalid re-picked: a new race takes its palettes' first entry for a hue not in them, a hair style the new race and gender don't offer becomes none, and facial hair goes for a female or an elf. Any other change is kept as it is, so a scanned value outside the lists survives a skin or hair change.
export function repick(prev: Choice, next: Choice, options: Options): Choice {
  const raceChanged = next.race !== prev.race;
  if (!raceChanged && next.female === prev.female) return next;
  const r = options[next.race], styles = next.female ? r.hairStyles.female : r.hairStyles.male;
  const inPalette = (hue: number, list: Array<{ hue: number }>): number => (!raceChanged || list.some((s) => s.hue === hue) ? hue : list[0]?.hue ?? 0);
  return {
    ...next,
    skin: inPalette(next.skin, r.skin),
    hairStyle: styles.some((s) => s.graphic === next.hairStyle) ? next.hairStyle : 0,
    hairHue: inPalette(next.hairHue, r.hair),
    facialStyle: hasFacialHair(next) && r.facialHair.some((s) => s.graphic === next.facialStyle) ? next.facialStyle : 0,
    facialHue: inPalette(next.facialHue, r.hair),
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
