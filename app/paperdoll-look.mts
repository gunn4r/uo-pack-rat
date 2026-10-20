// paperdoll-look.mts — a character's look for the paperdoll (issue #57) and which bodies the figure draws, shared by the renderer (app/paperdoll.mts) and the page. Browser-safe: no imports.
//
// map: house
// owns: `Look`, `Worn`, `BODY_GUMP`, `drawsBody`, `FEMALE_BODIES`, `GARGOYLE_BODIES`, `Race`, `RACE_BODIES`, `raceOf`, `STAND_IN`, `lookOf`

// A piece the figure draws: its item graphic and hue.
export interface Worn { graphic: number; hue: number }
// The scan's appearance: the body graphic, its skin hue, and what is on the hair, beard and face layers.
export interface Look { body: number; hue: number; hair: Worn | null; beard: Worn | null; face: Worn | null }

// The body gump of each body the figure draws (ClassicUO's PaperDollInteractable.UpdateUI): human, elf, gargoyle (alive 666/667, dead 694/695) and the GM body 0x3DB.
export const BODY_GUMP: ReadonlyMap<number, number> = new Map([[400, 0x000c], [401, 0x000d], [403, 0x000d], [605, 0x000e], [606, 0x000f], [666, 0x029a], [694, 0x029a], [667, 0x0299], [695, 0x0299], [0x03db, 0x000c]]);
// The female bodies and the gargoyle bodies among them.
export const FEMALE_BODIES: ReadonlySet<number> = new Set([401, 403, 606, 667, 695]);
export const GARGOYLE_BODIES: ReadonlySet<number> = new Set([666, 667, 694, 695]);
// The races a character is made as, and each one's male and female body.
export type Race = "human" | "elf" | "gargoyle";
export const RACE_BODIES: Readonly<Record<Race, readonly [male: number, female: number]>> = { human: [400, 401], elf: [605, 606], gargoyle: [666, 667] };
// The race of a body the figure draws (the GM body counts as human).
export const raceOf = (body: number): Race => (GARGOYLE_BODIES.has(body) ? "gargoyle" : body === 605 || body === 606 ? "elf" : "human");
// Whether the figure draws this body. Any other body is a form's (Horrific Beast, a polymorph and the like): the stand-in takes its place, instead of ClassicUO's fallback body.
export const drawsBody = (body: number): boolean => BODY_GUMP.has(body);

// The stand-in: a human male body with no hue, no hair and no beard.
export const STAND_IN: Look = { body: 400, hue: 0, hair: null, beard: null, face: null };
// The look to draw for a character's scanned appearance: that look, or the stand-in when there is none ("none") or its body is not one the figure draws ("form"), whose hair, beard and face are not used either.
export function lookOf(appearance: Look | null | undefined): { look: Look; standIn: "none" | "form" | null } {
  if (!appearance) return { look: STAND_IN, standIn: "none" };
  return drawsBody(appearance.body) ? { look: appearance, standIn: null } : { look: STAND_IN, standIn: "form" };
}
