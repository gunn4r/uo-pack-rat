// paperdoll.mts — what GET /api/paperdoll/options answers (issue #57): the game's character-creation choices for the doll card's Customize popover, labelled from the client's Cliloc.enu and coloured from its hues.mul. Types only and node-free, so the route `satisfies` it, the page re-exports it (app/ui/api-types.mts) and the route map names it (app/api/routes.mts).
//
// map: api
// owns: `PaperdollOptionsApiResponse`, `CreationRace`, `Swatch`, `HairStyle`
import type { Race } from "../paperdoll-look.mts";

// A hue to pick and the colour its swatch shows ("#rrggbb": entry 18 of a skin hue's ramp, entry 20 of a hair hue's).
export interface Swatch { hue: number; color: string }
// A hair or facial-hair style: its item graphic (0 for none) and the game's name for it.
export interface HairStyle { graphic: number; label: string }
// One race's choices, in the game's own order: its skin and hair-colour palettes, hair styles per gender, and facial hair (male only; none for elves).
export interface CreationRace { skin: Swatch[]; hair: Swatch[]; hairStyles: { male: HairStyle[]; female: HairStyle[] }; facialHair: HairStyle[] }
export interface PaperdollOptionsApiResponse { ok: true; races: Record<Race, CreationRace> }
