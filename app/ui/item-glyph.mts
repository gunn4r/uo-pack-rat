// ui/item-glyph.mts — the generic icon an item shows when its in-game art can't be drawn (issue #556): one of a small set of line glyphs by category, picked from what the item record already says (its type and slot for gear, its kind for the rest), drawn like the app's own icons and never from game art.
//
// map: ui-components
// owns: `GLYPHS`, `GlyphName`, `glyphOf`, `glyphSvg`
import { itemTypeOf, isNeckArmor, type Item } from "../vault-lib.mts";

// 24-unit stroke shapes, as the app's ICONS (ui/components.mts): [element, attributes].
type Shape = [string, Record<string, string>];
const P = (d: string): Shape => ["path", { d }];
const C = (cx: number, cy: number, r: number): Shape => ["circle", { cx: String(cx), cy: String(cy), r: String(r) }];
export const GLYPHS = {
  ring: [C(12, 14.5, 6), P("M9.5 8.7 12 4.5l2.5 4.2"), P("M10.2 4.5h3.6")],
  jewelry: [P("M6 3.5c0 5.5 2.6 8.6 6 9.6 3.4-1 6-4.1 6-9.6"), C(12, 17, 3.6)],
  sword: [P("M20 4l-.6 3.7-8.9 8.9-3.1-3.1 8.9-8.9z"), P("M6 12.5l5.5 5.5"), P("M8.2 15.8 4.5 19.5")],
  axe: [P("M5 20.5 15.5 7"), P("M13 4.5c2.6-1.6 6-1 7.5 1.5 1.6 2.6 1 6-1.5 7.5l-3.3-2.8-2.4 1.9-1.1-1.4 1.9-2.4z")],
  bow: [P("M7 3c5.5 2.5 8 5.7 8 9s-2.5 6.5-8 9"), P("M7 3v18"), P("M3.5 12H19M16.5 9.5 19 12l-2.5 2.5")],
  spellbook: [P("M5 18.5V5a2 2 0 0 1 2-2h12v15.5H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12"), P("M12 7.5v6M9 10.5h6")],
  shield: [C(12, 12, 8.5), C(12, 12, 2.5), P("M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6")],
  helm: [P("M5 19.5v-7.5a7 7 0 0 1 14 0v7.5h-4.5v-5h-5v5z"), P("M5 12h14")],
  chest: [P("M8.5 3.5 4 6.5v5.5l2.5 1V20.5h11V13l2.5-1V6.5l-4.5-3c-.6 1.6-1.9 2.6-3.5 2.6s-2.9-1-3.5-2.6z"), P("M12 9.5v11")],
  gloves: [P("M7.5 20.5V17h9v3.5"), P("M7.5 17V9.5a1.4 1.4 0 0 1 2.8 0V6a1.4 1.4 0 0 1 2.8 0v-.5a1.4 1.4 0 0 1 2.8 0V12l1.4-2a1.4 1.4 0 0 1 2.3 1.6L16.5 17")],
  legs: [P("M6.5 3.5h11l1 17h-4.5L12 10.5l-2 10H5.5z"), P("M6.4 6.5h11.2")],
  boots: [P("M8 3.5h5.5V13l5.4 3a2.2 2.2 0 0 1 1.1 1.9v2.6H8z"), P("M8 17.5h12")],
  robe: [P("M9 3.5 5.5 6 3.5 20.5h17L18.5 6 15 3.5c0 1.6-1.3 2.8-3 2.8S9 5.1 9 3.5z"), P("M6.4 11.5h11.2M12 11.5l-1.5 4")],
  scroll: [P("M15.5 20.5H7.5a2.5 2.5 0 0 1 0-5h1V6a2.5 2.5 0 0 1 2.5-2.5h7.5a2.5 2.5 0 0 1 0 5h-1v9.5a2.5 2.5 0 0 1-2.5 2.5z"), P("M11.5 9.5h3M11.5 12.5h3"), P("M8.5 15.5h4")],
  bag: [P("M8.5 7.5h7l3.5 4.5-1.6 8.5H6.6L5 12z"), P("M9.5 7.5 8.5 3.5h7l-1 4"), P("M8 11.5h8")],
  potion: [P("M9.5 3.5h5M10.5 3.5V8.5L5.6 16.8a2.8 2.8 0 0 0 2.4 4.2h8a2.8 2.8 0 0 0 2.4-4.2L13.5 8.5V3.5"), P("M7.4 14h9.2")],
  gem: [P("M7.5 4h9l4 5L12 20.5 3.5 9z"), P("M3.5 9h17M9.8 4 8.5 9 12 20.5 15.5 9l-1.3-5")],
  item: [["rect", { x: "4.5", y: "4.5", width: "15", height: "15", rx: "3" }], P("M12 8.5l3.5 3.5-3.5 3.5L8.5 12z")],
} satisfies Record<string, Shape[]>;
export type GlyphName = keyof typeof GLYPHS;

// The slot or kind each glyph stands for, where it is not the type alone.
const SLOT_GLYPH: Readonly<Record<string, GlyphName>> = { helmet: "helm", neck: "helm", chest: "chest", arms: "chest", hands: "gloves", legs: "legs", feet: "boots", ring: "ring" };
const KIND_GLYPH: Readonly<Record<string, GlyphName>> = { scroll: "scroll", book: "scroll", map: "scroll", deed: "scroll", rune: "scroll", container: "bag", potion: "potion", reagent: "gem", resource: "gem", gem: "gem", refinement: "gem", crafting: "gem", clothing: "robe" };
const BOW_RE = /\b(bow|crossbow)\b/i, AXE_RE = /\b(axe|hatchet)\b/i;

// The glyph for an item: gear by its type (itemTypeOf) and slot, anything else by its kind; "item" when the record says too little.
export function glyphOf(it: Partial<Pick<Item, "gear" | "slot" | "twoHanded" | "skillReq" | "extras" | "name" | "graphic" | "kind">>): GlyphName {
  if (!it.gear || !it.slot) return KIND_GLYPH[it.kind ?? ""] ?? "item";
  const name = it.name ?? "";
  switch (itemTypeOf({ gear: true, slot: it.slot, twoHanded: !!it.twoHanded, skillReq: it.skillReq ?? null, extras: it.extras ?? {}, name, graphic: it.graphic })) {
    case "shield": return "shield";
    case "spellbook": return "spellbook";
    // a weapon by its skill (or its name, with no skill line): a bow for Archery, the axe for Mace Fighting and axes, the sword for the rest
    case "one-handed": case "two-handed": {
      const skill = it.skillReq ?? "";
      return /archery/i.test(skill) || BOW_RE.test(name) ? "bow" : /mace/i.test(skill) || AXE_RE.test(name) ? "axe" : "sword";
    }
    case "jewelry": return it.slot === "ring" ? "ring" : "jewelry";
    case "armor": return it.slot === "neck" && !isNeckArmor(name) ? "jewelry" : SLOT_GLYPH[it.slot] ?? "chest";
    case "clothing": return SLOT_GLYPH[it.slot] ?? "robe";
    default: return "item";
  }
}

// The glyph as an aria-hidden <svg class="art-fb">, built with createElementNS alone (ui/item-art.mts draws it, and dom.mts draws that art).
const SVG_NS = "http://www.w3.org/2000/svg";
export function glyphSvg(name: GlyphName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "art-fb");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of GLYPHS[name] as Shape[]) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.append(shape);
  }
  return svg;
}
