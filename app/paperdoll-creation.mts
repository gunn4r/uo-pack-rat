// paperdoll-creation.mts — the game's character-creation choices (issue #57), for the doll card's Customize popover: each race's skin and hair-colour palettes, hair styles per gender and facial hair, as hue and graphic numbers with the cliloc number of each style's name. The game client keeps these in code; this is ClassicUO's copy (src/ClassicUO.Client/Game/Data/CharacterCreationValues.cs at ee79d7e), list for list. The palettes are the client's picker entries: the hue a character gets, and the scan reports, is one more (the live scan's elf has skin 0x051D and hair 0x0207 for entries 0x051C and 0x0206; the design's first human skin is hue 1002 for entry 0x03E9), so `creationOptions` offers entry + 1, with its swatch colour from hues.mul and the style names from Cliloc.enu.
//
// map: house
// owns: `CREATION`, `CREATION_LABELS`, `creationOptions`
import { hueOf, type Hues } from "./art.mts";
import type { CreationRace, HairStyle, PaperdollOptionsApiResponse, Swatch } from "./api/paperdoll.mts";
import type { Race } from "./paperdoll-look.mts";

// [cliloc number, graphic] pairs; graphic 0 is none.
type Styles = ReadonlyArray<readonly [label: number, graphic: number]>;
const zip = (labels: number[], graphics: number[]): Styles => labels.map((l, i) => [l, graphics[i]!] as const);
const HUMAN_HAIR = [0, 8251, 8252, 8253, 8260, 8261, 8266, 8263, 8264, 8265];
const HUMAN_FEMALE_HAIR = [0, 8251, 8252, 8253, 8260, 8261, 8266, 8263, 8265, 8262];
export const CREATION: Readonly<Record<Race, { skin: readonly number[]; hair: readonly number[]; male: Styles; female: Styles; facial: Styles }>> = {
  human: {
    skin: [0x03e9, 0x03f1, 0x03f9, 0x0401, 0x0409, 0x0411, 0x0419, 0x0421, 0x03ea, 0x03f2, 0x03fa, 0x0402, 0x040a, 0x0412, 0x041a, 0x0421, 0x03eb, 0x03f3, 0x03fb, 0x0403, 0x040b, 0x0413, 0x041b, 0x0421, 0x03ec, 0x03f4,
      0x03fc, 0x0404, 0x040c, 0x0414, 0x041c, 0x0421, 0x03ed, 0x03f5, 0x03fd, 0x0405, 0x040d, 0x0415, 0x041d, 0x0421, 0x03ee, 0x03f6, 0x03fe, 0x0406, 0x040e, 0x0416, 0x041e, 0x0421, 0x03ef, 0x03f7, 0x03ff, 0x0407,
      0x040f, 0x0417, 0x041f, 0x0421, 0x03f0, 0x03f8, 0x0400, 0x0408, 0x0410, 0x0418, 0x0420, 0x0421],
    hair: [0x044d, 0x0455, 0x045d, 0x0465, 0x046d, 0x0475, 0x044e, 0x0456, 0x045e, 0x0466, 0x046e, 0x0476, 0x044f, 0x0457, 0x045f, 0x0467, 0x046f, 0x0477, 0x0450, 0x0458, 0x0460, 0x0468, 0x0470, 0x0478, 0x0451, 0x0459,
      0x0461, 0x0469, 0x0471, 0x0479, 0x0452, 0x045a, 0x0462, 0x046a, 0x0472, 0x047a, 0x0453, 0x045b, 0x0463, 0x046b, 0x0473, 0x047b, 0x0454, 0x045c, 0x0464, 0x046c, 0x0474, 0x047c],
    male: zip([3000340, 3000341, 3000342, 3000343, 3000344, 3000345, 3000346, 3000347, 3000348, 3000349], HUMAN_HAIR),
    female: zip([3000340, 3000341, 3000342, 3000343, 3000344, 3000345, 3000346, 3000347, 3000349, 3000350], HUMAN_FEMALE_HAIR),
    facial: zip([3000340, 3000351, 3000352, 3000353, 3000354, 1011060, 1011061, 3000357], [0, 8256, 8254, 8255, 8257, 8267, 8268, 8269]),
  },
  elf: {
    skin: [0x04dd, 0x076b, 0x0834, 0x042f, 0x024c, 0x024d, 0x024e, 0x00be, 0x04a6, 0x0360, 0x0374, 0x0366, 0x03e7, 0x03dd, 0x0352, 0x0902, 0x076c, 0x0383, 0x0578, 0x03e8, 0x0373, 0x0388, 0x0384, 0x0375, 0x053e, 0x0380,
      0x0381, 0x0382, 0x076a, 0x03e4, 0x051c, 0x03e5],
    hair: [0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0100, 0x06b7, 0x0206, 0x0210, 0x026b, 0x02c2, 0x02c8, 0x01e3, 0x0238, 0x0368, 0x059c, 0x0852, 0x008d, 0x008e, 0x008f, 0x0090, 0x0091, 0x0158, 0x0159, 0x015a,
      0x015b, 0x015c, 0x015d, 0x01bc, 0x0724, 0x0057, 0x0127, 0x012e, 0x01f2, 0x0250, 0x031c, 0x031d, 0x031e, 0x031f, 0x0320, 0x0321, 0x0322, 0x0323, 0x0324, 0x0325, 0x0385, 0x0386, 0x0387, 0x0388, 0x0389, 0x0385,
      0x0386, 0x0387],
    male: zip([3000340, 1074385, 1074386, 1074387, 1074388, 1074390, 1074391, 1074392, 1074394], [0, 0x2fbf, 0x2fc0, 0x2fc1, 0x2fc2, 0x2fcd, 0x2fce, 0x2fcf, 0x2fd1]),
    female: zip([3000340, 1074386, 1074387, 1074388, 1074389, 1074391, 1074392, 1074393, 1074394], [0, 0x2fc0, 0x2fc1, 0x2fc2, 0x2fcc, 0x2fce, 0x2fcf, 0x2fd0, 0x2fd1]),
    facial: [],
  },
  gargoyle: {
    skin: [0x06da, 0x06db, 0x06dc, 0x06dd, 0x06de, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e3, 0x06e4, 0x06e5, 0x06e6, 0x06e7, 0x06e8, 0x06e9, 0x06ea, 0x06eb, 0x06ec, 0x06ed, 0x06ee, 0x06ef, 0x06f0, 0x06f1, 0x06f2, 0x06da,
      0x06db, 0x06dc],
    hair: [0x0708, 0x070a, 0x070c, 0x070e, 0x0710, 0x0762, 0x0764, 0x0767, 0x076a, 0x06f2, 0x06f0, 0x06ee, 0x06e3, 0x06e1, 0x06df, 0x0708, 0x070a, 0x070c],
    male: zip([3000340, 1112310, 1112311, 1112312, 1112313, 1112314, 1112315, 1112316, 1112317], [0, 0x4258, 0x4259, 0x425a, 0x425b, 0x425c, 0x425d, 0x425e, 0x425f]),
    female: zip([3000340, 1112310, 1112311, 1112312, 1112313, 1112314, 1112315, 1112316, 1112317], [0, 0x4261, 0x4262, 0x4273, 0x4274, 0x4275, 0x42aa, 0x42ab, 0x42b1]),
    facial: zip([3000340, 1112310, 1112311, 1112312, 1112313], [0, 0x42ad, 0x42ae, 0x42af, 0x42b0]),
  },
};
// Every cliloc number the table names. Two of the game's facial-hair names differ from others only by case ("Short beard" and "Short Beard"); in the game they are the beard-and-moustache styles, so they are named so here.
export const CREATION_LABELS: ReadonlySet<number> = new Set(Object.values(CREATION).flatMap((r) => [...r.male, ...r.female, ...r.facial].map(([l]) => l)));
const RENAMED = new Map([[1011060, "Short beard & moustache"], [1011061, "Long beard & moustache"]]);

const hex = (c: number): string => `#${[(c >> 10) & 31, (c >> 5) & 31, c & 31].map((v) => ((v << 3) | (v >> 2)).toString(16).padStart(2, "0")).join("")}`;
// The choices: each palette entry as the hue it gives (entry + 1) with its swatch colour (entry `entry` of that hue's ramp; a hue the file lacks is left out) and names (`labels`, from Cliloc.enu; "Style n" where the file has none). A palette's repeats are listed once.
export function creationOptions(hues: Hues, labels: ReadonlyMap<number, string>): PaperdollOptionsApiResponse {
  const swatches = (list: readonly number[], entry: number): Swatch[] => [...new Set(list)].flatMap((p) => { const hue = p + 1, h = hueOf(hues, hue); return h ? [{ hue, color: hex(h.colours[entry]!) }] : []; });
  const styles = (list: Styles): HairStyle[] => list.map(([l, graphic], i) => ({ graphic, label: RENAMED.get(l) ?? labels.get(l) ?? (graphic ? `Style ${i}` : "None") }));
  const race = (r: (typeof CREATION)[Race]): CreationRace => ({ skin: swatches(r.skin, 18), hair: swatches(r.hair, 20), hairStyles: { male: styles(r.male), female: styles(r.female) }, facialHair: styles(r.facial) });
  return { ok: true, races: { human: race(CREATION.human), elf: race(CREATION.elf), gargoyle: race(CREATION.gargoyle) } };
}
