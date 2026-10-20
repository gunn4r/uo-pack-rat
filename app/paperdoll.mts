// paperdoll.mts — the paperdoll figure (issue #57), composed from the player's own client files the way ClassicUO's paperdoll draws it (references at ClassicUO ee79d7e): the body gump by body graphic (PaperDollInteractable.UpdateUI), each worn piece's gump from its tiledata anim through Equipconv.def and gump.def (GetAnimID, GumpsLoader), the layer order (PaperdollOrder.Build) and the layers a robe, legs or a hood hide (MobileView.IsCovered). Two rules of its own: a 0x0001 lining pixel is drawn only over something already drawn, and a body outside the human, elf and gargoyle set is not drawn (the caller shows the stand-in). Pure: the caller passes the gumps, tiledata and hues.
//
// map: house
// owns: `LAYER`, `CANVAS`, `readGumpDef`, `readEquipConv`, `gumpSource`, `paperdollOrder`, `isCovered`, `drawsBody`, `lookOf`, `STAND_IN`, `createPaperdoll`, `figureBox`, `greyRgba`
import { decodeGump, gumpArtName, hueFor, huePixel, opaqueBox, readUopEntry, uopIndex, type Box, type Hues, type ReadAt, type StaticArt, type UopTable } from "./art.mts";
import { FLAG, type TileData } from "./tiledata.mts";

// ClassicUO's Layer numbers.
export const LAYER = {
  OneHanded: 1, TwoHanded: 2, Shoes: 3, Pants: 4, Shirt: 5, Helmet: 6, Gloves: 7, Ring: 8, Talisman: 9, Necklace: 10, Hair: 11, Waist: 12,
  Torso: 13, Bracelet: 14, Face: 15, Beard: 16, Tunic: 17, Earrings: 18, Arms: 19, Cloak: 20, Backpack: 21, Robe: 22, Skirt: 23, Legs: 24, Mount: 25,
} as const;
const L = LAYER;
const MALE_GUMP_OFFSET = 50000, FEMALE_GUMP_OFFSET = 60000, MAX_GUMP = 0x10000;

// ---- .def files: ClassicUO's DefReader, as far as gump.def and Equipconv.def use it --------------------------------
// A line counts when, trimmed, it starts with a digit; "#" starts a comment; a `{…}` group is one token; a line with fewer than `minSize` tokens is skipped.
function defLines(text: string, minSize: number): string[][] {
  const out: string[][] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!/^\d/.test(line)) continue;
    const comment = line.indexOf("#");
    if (comment >= 0) line = line.slice(0, comment);
    const open = line.indexOf("{"), close = line.indexOf("}");
    const split = (s: string): string[] => s.split(/[\t ]+/).filter(Boolean);
    let parts: string[];
    if (open >= 0 && close >= 0) {
      if (close < open) continue;   // the C# throws on this line
      parts = [...split(line.slice(0, open)), line.slice(open, close + 1), ...split(line.slice(close + 1))];
    } else parts = split(line);
    if (parts.length >= minSize) out.push(parts);
  }
  return out;
}
// ReadInt: the token cut at its first character that is not a digit, "-" or "+", then a decimal int32; -1 when that does not parse. A missing token reads as "0".
function defInt(token = "0"): number {
  const m = /^[0-9+-]*/.exec(token)![0];
  if (!/^[+-]?\d+$/.test(m)) return -1;
  const n = Number(m);
  return n >= -0x80000000 && n <= 0x7fffffff ? n : -1;
}
// ReadGroup: a `{…}` token's numbers (split on commas and spaces; a part that is not a plain decimal is dropped); null for any other token.
function defGroup(token = "0"): number[] | null {
  if (!token.startsWith("{") || !token.endsWith("}")) return null;
  return token.split(/[, {}]+/).filter((s) => /^\d+$/.test(s)).map(Number).filter((n) => n <= 0x7fffffff);
}

// gump.def, resolved as GumpsLoader.Load applies it, line by line: `id {alt alt …} hue` gives `id` the first alt that exists, with that hue, only when the archive has no `id` (and a later line for an id already given is skipped). An alt given by an earlier line counts as existing, and `from` is where its art really is.
export type GumpDefs = Map<number, { from: number; hue: number }>;
export function readGumpDef(text: string, inArchive: (id: number) => boolean): GumpDefs {
  const defs: GumpDefs = new Map();
  const has = (id: number): boolean => defs.has(id) || inArchive(id);
  for (const p of defLines(text, 3)) {
    const id = defInt(p[0]);
    if (id < 0 || id >= MAX_GUMP || has(id)) continue;
    const group = defGroup(p[1]);
    if (!group) continue;
    for (const alt of group) {
      if (alt >= MAX_GUMP || !has(alt)) continue;
      defs.set(id, { from: defs.get(alt)?.from ?? alt, hue: defInt(p[2]) & 0xffff });
      break;
    }
  }
  return defs;
}

// Equipconv.def, as AnimationsLoader.ProcessEquipConvDef reads it: `body anim newAnim gump colour`, keyed by body then anim. A gump of 0 means the anim, -1 (or 65535) the new anim, and a line whose gump is past 65,535 is skipped; a later line for the same body and anim wins.
export type EquipConv = Map<number, Map<number, number>>;
export function readEquipConv(text: string): EquipConv {
  const conv: EquipConv = new Map();
  for (const p of defLines(text, 5)) {
    const body = defInt(p[0]) & 0xffff, anim = defInt(p[1]) & 0xffff, newAnim = defInt(p[2]) & 0xffff;
    let gump = defInt(p[3]);
    if (gump > 0xffff) continue;
    if (gump === 0) gump = anim;
    else if (gump === 0xffff || gump === -1) gump = newAnim;
    let byAnim = conv.get(body);
    if (!byAnim) conv.set(body, (byAnim = new Map()));
    byAnim.set(anim, gump & 0xffff);
  }
  return conv;
}

// ---- gumps --------------------------------------------------------------------------------------------------------
// One gump as the figure draws it: its pixels as decoded, and gump.def's hue for an alias (0 for none), applied in full before the piece's own hue.
export interface Gump { art: StaticArt; hue: number }
export type GumpSource = (id: number) => Gump | null;
// The decoded gumps kept, in bytes (2 a pixel): a page could otherwise sweep every wearable graphic into memory. Past it the cache starts over.
const GUMP_CACHE_BYTES = 32 * 1024 * 1024;
// The gumps of a gumpartLegacyMUL.uop with gump.def's aliases, each decoded once while it stays in the cache (`cacheBytes`). Null for a gump the archive and gump.def don't have, or that does not decode, which ClassicUO treats the same (no texture).
export function gumpSource(table: UopTable, read: ReadAt, defs: GumpDefs, cacheBytes = GUMP_CACHE_BYTES): GumpSource {
  const decoded = new Map<number, StaticArt | null>();
  let bytes = 0;
  const art = (id: number): StaticArt | null => {
    if (!decoded.has(id)) {
      const buf = readUopEntry(table, gumpArtName(id), read), a = buf ? decodeGump(buf) : null, size = a ? a.pixels.length * 2 : 0;
      if (bytes + size > cacheBytes) { decoded.clear(); bytes = 0; }
      bytes += size;
      decoded.set(id, a);
    }
    return decoded.get(id)!;
  };
  return (id) => {
    if (!Number.isInteger(id) || id < 0 || id >= MAX_GUMP) return null;
    if (uopIndex(table, gumpArtName(id)) >= 0) { const a = art(id); return a && { art: a, hue: 0 }; }
    const def = defs.get(id);
    const a = def ? art(def.from) : null;
    return a && { art: a, hue: def!.hue };
  };
}

// ---- body -----------------------------------------------------------------------------------------------------------
// The body gump of each body the figure draws (PaperDollInteractable.UpdateUI): human, elf, gargoyle (alive 666/667, dead 694/695) and the GM body 0x3DB.
const BODY_GUMP = new Map<number, number>([[400, 0x000c], [401, 0x000d], [403, 0x000d], [605, 0x000e], [606, 0x000f], [666, 0x029a], [694, 0x029a], [667, 0x0299], [695, 0x0299], [0x03db, 0x000c]]);
const FEMALE = new Set([401, 403, 606, 667, 695]);
const GARGOYLE = new Set([666, 667, 694, 695]);
// Whether the figure draws this body. Any other body is a form's (Horrific Beast, a polymorph and the like): the caller shows the stand-in instead of ClassicUO's fallback body.
export const drawsBody = (body: number): boolean => BODY_GUMP.has(body);

export interface Worn { graphic: number; hue: number }
export interface Look { body: number; hue: number; hair: Worn | null; beard: Worn | null; face: Worn | null }
// The stand-in: a human male body with no hue, no hair and no beard.
export const STAND_IN: Look = { body: 400, hue: 0, hair: null, beard: null, face: null };
// The look to draw for a character's scanned appearance: that look, or the stand-in when there is none ("none") or its body is not one the figure draws ("form"), whose hair, beard and face are not used either.
export function lookOf(appearance: Look | null | undefined): { look: Look; standIn: "none" | "form" | null } {
  if (!appearance) return { look: STAND_IN, standIn: "none" };
  return drawsBody(appearance.body) ? { look: appearance, standIn: null } : { look: STAND_IN, standIn: "form" };
}

// ---- gump id ----------------------------------------------------------------------------------------------------------
// GetAnimID: a dead gargoyle's shroud, then Equipconv.def for this body, then the female (60000) or male (50000) offset, taking the other one when that gump is missing. Not ported: Bodyconv.def (no human, elf or gargoyle body is converted) and tileart.uop's appearance remap.
function gumpIdFor(body: number, anim: number, female: boolean, conv: EquipConv, has: (id: number) => boolean): number {
  if (anim === 0x03ca && (body === 0x02b7 || body === 0x02b6)) anim = 0x0223;
  const gump = conv.get(body)?.get(anim);
  if (gump !== undefined) anim = gump > MALE_GUMP_OFFSET ? (gump >= FEMALE_GUMP_OFFSET ? gump - FEMALE_GUMP_OFFSET : gump - MALE_GUMP_OFFSET) : gump;
  let offset = female ? FEMALE_GUMP_OFFSET : MALE_GUMP_OFFSET;
  if (anim + offset > 0xffff || !has(anim + offset)) offset = female ? MALE_GUMP_OFFSET : FEMALE_GUMP_OFFSET;
  return (anim + offset) & 0xffff;
}

// ---- draw order: PaperdollOrder.Build, line by line -------------------------------------------------------------------
// The three base tables, 25 layers each with the leading Invalid (0). T2 is the default; T1 draws the arms late; T3 the torso first.
const T1 = [0, L.Cloak, L.Shirt, L.Pants, L.Shoes, L.Legs, L.Torso, L.Tunic, L.Ring, L.Bracelet, L.Face, L.Arms, L.Gloves, L.Skirt, L.Robe, L.Waist, L.Necklace, L.Hair, L.Beard, L.Earrings, L.Helmet, L.OneHanded, L.TwoHanded, L.Backpack, L.Talisman];
const T2 = [0, L.Cloak, L.Shirt, L.Pants, L.Shoes, L.Legs, L.Arms, L.Torso, L.Tunic, L.Ring, L.Bracelet, L.Face, L.Gloves, L.Skirt, L.Robe, L.Waist, L.Necklace, L.Hair, L.Beard, L.Earrings, L.Helmet, L.OneHanded, L.TwoHanded, L.Backpack, L.Talisman];
const T3 = [0, L.Cloak, L.Torso, L.Shirt, L.Pants, L.Shoes, L.Legs, L.Tunic, L.Ring, L.Bracelet, L.Face, L.Arms, L.Gloves, L.Skirt, L.Robe, L.Waist, L.Necklace, L.Hair, L.Beard, L.Earrings, L.Helmet, L.OneHanded, L.TwoHanded, L.Backpack, L.Talisman];
const N = 0x19;
const u32 = (n: number): number => n >>> 0;
// MoveTo puts layer `a` at `b`'s index; MoveAfter right after it (the C#'s memmove loops).
function moveTo(o: number[], a: number, b: number): void {
  const i1 = o.indexOf(a); if (i1 < 0) return;
  const i2 = o.indexOf(b); if (i2 < 0 || i2 === i1) return;
  if (i2 < i1) { for (let k = i1; k > i2; k--) o[k] = o[k - 1]!; o[i2] = a; }
  else { for (let k = i1; k < i2; k++) o[k] = o[k + 1]!; o[i2] = a; }
}
function moveAfter(o: number[], a: number, b: number): void {
  const i1 = o.indexOf(a); if (i1 < 0) return;
  const i2 = o.indexOf(b); if (i2 < 0 || i2 === i1) return;
  if (i2 < i1) { for (let k = i1; k > i2 + 1; k--) o[k] = o[k - 1]!; o[i2 + 1] = a; }
  else { for (let k = i1; k < i2; k++) o[k] = o[k + 1]!; o[i2] = a; }
}
// The layers in paint order (later on top) for each layer's equip anim (`gfx[layer]`, 0 for an empty one), with Invalid, Mount and Backpack dropped (Filter). `altTorso`: a female or gargoyle body.
export function paperdollOrder(gfx: ArrayLike<number>, altTorso: boolean): number[] {
  const g = (layer: number): number => gfx[layer] ?? 0;
  let table = T2;
  const arms = g(L.Arms);
  const armsAlternate = arms < 0x3d0 ? arms === 0x3cf || arms === 0x210 || arms === 0x3b3 : arms === 0x3dd;
  if (armsAlternate) table = T1;
  else {
    const torso = g(L.Torso);
    if (torso === 0x21a) table = T1;
    else if (u32(torso - 0x399) < 5 && altTorso) table = T3;
  }
  const o = table.slice(0, N);
  const done = (): number[] => o.filter((layer) => layer !== 0 && layer !== L.Mount && layer !== L.Backpack);

  if (g(L.Shirt) !== 0 && g(L.Pants) === 0x398) moveTo(o, L.Pants, L.Shirt);
  const pants = g(L.Pants);
  let skipFinalPantsCheck = false;
  if (pants < 0x201) {
    if (pants === 0x200 || pants === 0x1eb || pants === 0x1fa) {
      const iShoes = o.indexOf(L.Shoes), iPants = o.indexOf(L.Pants);
      if (iShoes >= 0 && iPants >= 0 && iPants < iShoes) { o[iShoes] = L.Pants; o[iPants] = L.Shoes; }
    }
  } else if (u32(pants - 0x513) < 2) {
    if (g(L.Shoes) !== 0) moveTo(o, L.Pants, L.Shoes);
    skipFinalPantsCheck = true;
  }
  if (!skipFinalPantsCheck && g(L.Shoes) !== 0 && g(L.Pants) === 0x3e4) moveTo(o, L.Pants, L.Shoes);

  if (g(L.Tunic) === 0x238) {
    moveAfter(o, L.Tunic, L.Waist);
    const r = g(L.Robe);
    if (r !== 0 && [0x4e8, 0x4e9, 0x4ea, 0x4eb, 0x5e2, 0x5e3, 0x5e4, 0x5e5].includes(r)) moveTo(o, L.Robe, L.Necklace);
  }

  const cloak = g(L.Cloak);
  if (cloak === 0x380 || cloak === 0x5f3) moveAfter(o, L.Cloak, L.Robe);

  const helm = g(L.Helmet);
  if (helm < 0x202) {
    const neck = g(L.Necklace);
    if ((helm === 0x201 || helm === 0x1a9) && (neck === 0x1c8 || (neck > 0x1d6 && neck < 0x1d9))) {
      moveAfter(o, L.Necklace, L.Helmet);
      return done();
    }
  } else if (u32(helm - 0x5e9) < 2 && g(L.Robe) !== 0 && u32(g(L.Robe) - 0x5e2) < 4) moveTo(o, L.Robe, L.Helmet);
  return done();
}

// ---- coverage: MobileView.IsCovered, line by line --------------------------------------------------------------------
// What is worn on a layer: the item graphic and its tiledata anim; null for nothing.
export type WornAt = (layer: number) => { graphic: number; anim: number } | null;
const PANTS_ANIM_SKIRTABLE = (a: number): boolean => a === 0x1eb || a === 0x1fa || a === 0x200;
// Whether `layer` is hidden by something else this body wears.
export function isCovered(at: WornAt, body: number, layer: number): boolean {
  const robe = at(L.Robe), robeGfx = robe?.graphic ?? 0, robeAnim = robe?.anim ?? 0;
  const robeLeavesChestVisible = [0x9985, 0x9986, 0xa2ca, 0xa2cb, 0xa412, 0xb1de].includes(robeGfx);
  switch (layer) {
    case L.Shoes: {
      const pants = at(L.Pants), pantsAnim = pants?.anim ?? 0;
      if (robeAnim !== 0x504 && pantsAnim !== 0x513 && pantsAnim !== 0x514) {
        const pantsGfx = pants?.graphic ?? 0;
        if (pantsGfx < 0xaeb2) {
          if (pantsGfx === 0xaeb1 || pantsGfx === 0x1411) return true;
          if (pantsGfx !== 0xaea2) return at(L.Legs) !== null;
        } else {
          if (pantsGfx === 0xaec0) return true;
          if (pantsGfx !== 0xaecf) return at(L.Legs) !== null;
        }
      }
      return true;
    }
    case L.Pants: {
      if (at(L.Legs) !== null || robeAnim === 0x504) return true;
      const pantsAnim = at(L.Pants)?.anim ?? 0;
      if (!PANTS_ANIM_SKIRTABLE(pantsAnim)) return false;
      const skirt = at(L.Skirt);
      if (skirt !== null && skirt.anim !== 0x1c7 && skirt.anim !== 0x1e4) return true;
      if (robe === null) return false;
      if (robeAnim < 0x4ec) return robeAnim > 0x4e7 ? false : robeAnim !== 0x229;
      return u32(robeAnim - 0x5e2) > 3;
    }
    case L.Tunic: {
      const tunic = at(L.Tunic);
      if (tunic !== null && tunic.anim === 0x0238) return robe !== null && !robeLeavesChestVisible;
      return false;
    }
    case L.Torso: {
      if (robeGfx !== 0 && !robeLeavesChestVisible) return true;
      const tunic = at(L.Tunic);
      if (tunic !== null && tunic.graphic !== 0x1541 && tunic.graphic !== 0x1542) {
        const torso = at(L.Torso);
        if (torso !== null && (torso.graphic === 0x782a || torso.graphic === 0x782b)) return true;
      }
      return false;
    }
    case L.Arms:
      return robeGfx !== 0 && !robeLeavesChestVisible;
    case L.Necklace: {
      if (robe === null) return false;
      if (robeAnim === 0x5f2 || robeAnim === 0x5f5 || (robeAnim >= 0x4e8 && robeAnim <= 0x4eb) || (robeAnim >= 0x5e2 && robeAnim <= 0x5e5)) return false;
      return at(L.Necklace)?.anim === 0x5ec;
    }
    case L.Bracelet:
      return at(L.Bracelet)?.graphic === 0xb1c0 && at(L.Arms) !== null;
    case L.Hair: {
      const helmet = at(L.Helmet);
      if (helmet !== null && u32(helmet.graphic - 0xa42b) < 2) return true;
      return hooded(robeGfx, body);
    }
    case L.Helmet:
      return hooded(robeGfx, body);
    case L.Skirt: {
      const skirtAnim = at(L.Skirt)?.anim ?? 0;
      if (skirtAnim !== 0x1c7 && skirtAnim !== 0x1e4) return false;
      return PANTS_ANIM_SKIRTABLE(at(L.Pants)?.anim ?? 0);
    }
  }
  return false;
}
// The Helmet case: a hood-style robe hides hair and helmet; some of them not on a gargoyle.
function hooded(robeGfx: number, body: number): boolean {
  if (robeGfx < 0x4b9e) {
    if (robeGfx !== 0x4b9d) {
      if (robeGfx < 0x2fba) {
        if (robeGfx !== 0x2fb9) {
          if (robeGfx > 0x2687) return false;
          if (robeGfx < 0x2683 && (robeGfx < 0x204e || robeGfx > 0x204f)) return false;
        }
      } else if (robeGfx !== 0x3173) return false;
      return true;
    }
  } else if (robeGfx < 0xa0b0) {
    if (robeGfx < 0xa0ab && robeGfx !== 0x7816) return false;
  } else if (robeGfx !== 0xb2b7) return false;
  return !GARGOYLE.has(body);
}

// ---- composing ----------------------------------------------------------------------------------------------------------
// The figure canvas; every layer, the body included, is drawn at its (0, 0).
export const CANVAS = { width: 260, height: 237 } as const;
const LINING = 0x8001;   // raw colour 0x0001, as decodeGump stores it
// `hues` is null without a hues.mul: the figure is then drawn unhued.
export interface PaperdollFiles { gump: GumpSource; tiles: TileData; hues: Hues | null; equipConv: EquipConv }
interface HuedLayer { pixels: Uint16Array; width: number; height: number; lining: Uint8Array }
// The hued layers kept, in bytes (3 a pixel): about 180 full-size 260 x 237 layers. Past it the cache starts over.
const HUED_CACHE_BYTES = 32 * 1024 * 1024;

// A renderer over one set of client files, keeping each hued layer (gump, hue, partial) in memory, up to `cacheBytes`.
export function createPaperdoll(files: PaperdollFiles, cacheBytes = HUED_CACHE_BYTES) {
  const hued = new Map<string, HuedLayer | null>();
  let bytes = 0;
  const has = (id: number): boolean => files.gump(id) !== null;
  function layer(id: number, hue: number, partial: boolean): HuedLayer | null {
    const key = `${id}:${hue}:${partial ? 1 : 0}`;
    if (!hued.has(key)) {
      const g = files.gump(id), size = g ? g.art.pixels.length * 3 : 0;
      if (bytes + size > cacheBytes) { hued.clear(); bytes = 0; }
      bytes += size;
      if (!g) hued.set(key, null);
      else {
        const hues = files.hues, def = hues && g.hue ? hueFor(hues, g.hue, false) : null, own = hues && hueFor(hues, hue, partial), src = g.art.pixels;
        const pixels = new Uint16Array(src.length), lining = new Uint8Array(src.length);
        for (let i = 0; i < src.length; i++) {
          const p = src[i]!;
          if (p === 0) continue;
          if (p === LINING) lining[i] = 1;
          pixels[i] = huePixel(huePixel(p, def), own);
        }
        hued.set(key, { pixels, lining, width: g.art.width, height: g.art.height });
      }
    }
    return hued.get(key)!;
  }
  // Paints a layer over the canvas: a lining pixel only where something is already drawn under it. This also drops the body's own 0x0001 outline pixels at its edge (a gargoyle body has about 15 such pinholes); intended.
  function paint(canvas: Uint16Array, l: HuedLayer | null): void {
    if (!l) return;
    const w = Math.min(l.width, CANVAS.width), h = Math.min(l.height, CANVAS.height);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * l.width + x, p = l.pixels[i]!;
      if (p === 0) continue;
      const c = y * CANVAS.width + x;
      if (l.lining[i] && canvas[c] === 0) continue;
      canvas[c] = p;
    }
  }
  // The figure for a look the figure draws (drawsBody; pass lookOf's look) wearing `worn`: each piece goes on its tiledata layer, a later piece replacing an earlier one on the same layer, and a piece on a layer the look owns (hair, beard, face) or the backpack or mount is left out. Null for a body the figure does not draw.
  function compose(look: Look, worn: Worn[]): StaticArt | null {
    const bodyGump = BODY_GUMP.get(look.body);
    if (bodyGump === undefined) return null;
    const female = FEMALE.has(look.body);
    const canvas = new Uint16Array(CANVAS.width * CANVAS.height);
    paint(canvas, layer(bodyGump, look.body === 0x03db ? 0x03ea : look.hue, true));
    if (look.body === 0x03db) paint(canvas, layer(0xc72b, look.hue, true));
    const on = new Map<number, { graphic: number; hue: number; anim: number; partial: boolean }>();
    const put = (w: Worn, fixed?: number): void => {
      const info = files.tiles.info(w.graphic);
      if (!info) return;
      const at = fixed ?? info.layer;
      if (at < L.OneHanded || at > L.Legs || at === L.Backpack || (fixed === undefined && (at === L.Hair || at === L.Beard || at === L.Face))) return;
      on.set(at, { graphic: w.graphic, hue: w.hue, anim: info.anim, partial: (info.flags & FLAG.partialHue) !== 0n });
    };
    for (const w of worn) put(w);
    if (look.hair) put(look.hair, L.Hair);
    if (look.beard) put(look.beard, L.Beard);
    if (look.face) put(look.face, L.Face);
    const gfx = new Array<number>(N).fill(0);
    for (const [at, item] of on) gfx[at] = item.anim;
    const at: WornAt = (l) => on.get(l) ?? null;
    for (const l of paperdollOrder(gfx, female || GARGOYLE.has(look.body))) {
      const item = on.get(l);
      if (!item || isCovered(at, look.body, l)) continue;
      paint(canvas, layer(gumpIdFor(look.body, item.anim, female, files.equipConv, has), item.hue & 0x3fff, item.partial));
    }
    return { width: CANVAS.width, height: CANVAS.height, pixels: canvas };
  }
  return { compose };
}

// The box to crop one figure, or a pair shown side by side, to: the union of their opaque boxes plus `pad` pixels, kept on the canvas. Null when none has an opaque pixel.
export function figureBox(figures: StaticArt[], pad = 6): Box | null {
  let box: Box | null = null;
  for (const f of figures) {
    const b = opaqueBox(f);
    if (!b) continue;
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  }
  return box && { x0: Math.max(0, box.x0 - pad), y0: Math.max(0, box.y0 - pad), x1: Math.min(CANVAS.width - 1, box.x1 + pad), y1: Math.min(CANVAS.height - 1, box.y1 + pad) };
}

// The stand-in's grey: each RGBA pixel set to its luminance (0.30 R + 0.59 G + 0.11 B), in place.
export function greyRgba(rgba: Buffer): Buffer {
  for (let o = 0; o < rgba.length; o += 4) {
    const v = Math.round(0.3 * rgba[o]! + 0.59 * rgba[o + 1]! + 0.11 * rgba[o + 2]!);
    rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
  }
  return rgba;
}
