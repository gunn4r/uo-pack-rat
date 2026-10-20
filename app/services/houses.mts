// houses.mts — the house map's client files and models (issues #10, #164, #174): the UO folder, its tiledata.mul and facetNN.mul, the facet PNGs cut from them, the item art PNGs drawn from its artLegacyMUL.uop and hues.mul, the paperdoll figures drawn from its gumps and the Customize popover's choices (issue #57), and the house models built from the inventory, each kept while its inputs stay the same.
//
// map: services
// owns: `createHousesService`
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { badPathShape } from "../installer.mts";
import { uoFolderFromTazuo, loadTileData, type TileData } from "../tiledata.mts";
import { decodeFacet, type FacetBitmap } from "../facet-map.mts";
import { decodeStatic, gumpArtName, hex555, hueOf, itemArtName, readHues, readUopEntry, readUopTable, toRgba, uopIndex, type Hues, type ReadAt, type StaticArt, type UopTable } from "../art.mts";
import { createPaperdoll, figureBox, grayRgba, gumpSource, readEquipConv, readGumpDef } from "../paperdoll.mts";
import type { Look, Worn } from "../paperdoll-look.mts";
import { CREATION_LABELS, creationOptions } from "../paperdoll-creation.mts";
import { readCliloc } from "../cliloc.mts";
import type { PaperdollOptionsApiResponse } from "../api/paperdoll.mts";
import { encodePngRgba } from "../png.mts";
import { buildHouseModel, type HouseContainerInput, type HouseModel } from "../house-model.mts";
import type { HouseSource } from "../house-capture.mts";
import type { Inventory } from "../vault-lib.mts";
import type { SettingsDoc } from "../store/settings.mts";
import type { AdapterManifestV1Install } from "../schema/types.d.mts";

// How the house map finds the UO folder through a client, named by its manifest's install.uoFolder: from the client's scripts folder to the UO folder, or null.
// Its keys are the values the manifest schema allows (app/schema/adapter-manifest.v1.schema.json, install.uoFolder).
type UoFolderFinder = NonNullable<AdapterManifestV1Install["uoFolder"]>;
const UO_FOLDER_FINDERS: Record<UoFolderFinder, (scriptsDir: string) => string | null> = {
  "tazuo-profile": uoFolderFromTazuo,
};
const isFinder = (v: string | null): v is UoFolderFinder => v !== null && Object.hasOwn(UO_FOLDER_FINDERS, v);

// `settings` is the settings this run uses, read on every call: the UO folder and the client come from it. `uoFolderFinder` is an
// adapter's install.uoFolder (setupService's adapters), null when it has none.
export function createHousesService({ settings, uoFolderFinder }: { settings: () => SettingsDoc; uoFolderFinder: (adapter: string) => string | null }) {
  // Where the house map's tiledata.mul comes from (issue #10): the UO folder set in Settings wins; else the folder the chosen client's finder names (TazUO: its launcher profile). `reason` says why there is none, for the page to put in words: the folder set here lost its tiledata.mul (or, hand-edited into settings.json, is not an absolute non-UNC path: refused on its shape before any filesystem call, as PUT /api/settings does, and not passed over for the automatic one, since the player chose a folder), no client to look through, no TazUO profile naming one, or a file that is not a 7.x tiledata.mul.
  interface TileDataFrom { td: TileData | null; folder: string | null; source: "settings" | UoFolderFinder | null; reason: null | "override-missing" | "no-client" | `no-${UoFolderFinder}` | "unreadable" }
  type UoFolder = { folder: string; source: "settings" | UoFolderFinder } | { folder: null; reason: "override-missing" | "no-client" | `no-${UoFolderFinder}` };
  function uoFolder(): UoFolder {
    const o = settings().uoFolder;
    if (o != null && o !== "") return typeof o !== "string" || badPathShape(o) ? { folder: null, reason: "override-missing" } : { folder: o, source: "settings" };
    const c = settings().client;
    const finder = c ? uoFolderFinder(c.adapter) : null;
    if (!c || !isFinder(finder)) return { folder: null, reason: "no-client" };
    const uo = UO_FOLDER_FINDERS[finder](c.scriptsDir);
    return uo ? { folder: uo, source: finder } : { folder: null, reason: `no-${finder}` };
  }
  // The UO folder for reading art: a folder set in Settings that is gone reads as override-missing.
  function artFolder(): { folder: string } | { reason: string } {
    const at = uoFolder();
    if (at.folder === null) return { reason: at.reason };
    if (at.source === "settings") { try { if (!statSync(at.folder).isDirectory()) return { reason: "override-missing" }; } catch { return { reason: "override-missing" }; } }
    return { folder: at.folder };
  }
  function houseTileData(): TileDataFrom {
    const at = uoFolder();
    if (at.folder === null) return { td: null, folder: null, source: null, reason: at.reason };
    const path = join(at.folder, "tiledata.mul"), td = loadTileData(path);
    return { td, folder: at.folder, source: at.source, reason: td ? null : at.source === "settings" && !existsSync(path) ? "override-missing" : "unreadable" };
  }
  // The facet overview (issue #164): the UO folder's facetNN.mul, checked once while the file stays the same and kept per facet as the file's own bytes and its row starts (all six together are about 30 MB), and the PNGs cut from them kept by facet file, region and size up to 32 MB in all, the oldest dropped first. Never written to disk. `reason` says why there is none, the folder never: a folder set in Settings that is gone reads as override-missing, as it does for tiledata.mul.
  const facetMemo = new Map<number, { key: string; bitmap: FacetBitmap | null }>();
  const facetPngs = new Map<string, Buffer>();
  let facetPngBytes = 0;
  const FACET_MAX_BYTES = 64 * 1024 * 1024, FACET_PNG_BYTES = 32 * 1024 * 1024;
  function facetBitmap(facet: number): { bitmap: FacetBitmap; key: string } | { reason: string } {
    const at = artFolder();
    if ("reason" in at) return at;
    const path = join(at.folder, `facet0${facet}.mul`);
    let key: string;
    try { const st = statSync(path); if (!st.isFile()) return { reason: "missing" }; if (st.size > FACET_MAX_BYTES) return { reason: "unreadable" }; key = `${path}:${st.mtimeMs}:${st.size}`; } catch { return { reason: "missing" }; }
    let memo = facetMemo.get(facet);
    if (memo?.key !== key) {
      let bitmap: FacetBitmap | null;
      try { bitmap = decodeFacet(readFileSync(path)); } catch { bitmap = null; }
      memo = { key, bitmap };
      facetMemo.set(facet, memo);
    }
    return memo.bitmap ? { bitmap: memo.bitmap, key } : { reason: "unreadable" };
  }
  function facetPng(key: string, make: () => Buffer): Buffer {
    let out = facetPngs.get(key);
    if (out) return out;
    out = make();
    for (const [k, v] of facetPngs) { if (facetPngBytes + out.length <= FACET_PNG_BYTES) break; facetPngs.delete(k); facetPngBytes -= v.length; }
    facetPngs.set(key, out);
    facetPngBytes += out.length;
    return out;
  }
  // Item art (issue #174): the UO folder's artLegacyMUL.uop table (its table blocks only, never the payload) and hues.mul, each read once while the file stays the same, and an entry read only when its graphic is asked for. A table that does not read is tried again after 30 s (a passing read error), sooner when the file changes. The PNGs are kept by file stamps, graphic and hue up to 4 MB in all (the paperdoll's figures with them), the least recently used dropped first, and never written to disk. `etag` names the files' stamps, graphic and hue (hashed, so never the path). A hue the hues.mul does not have, or with no hues.mul, draws the art unhued. `reason` as for the facet: no folder, the art file missing or not a UOP table, or no art for that graphic.
  let artMemo: { key: string; table: UopTable | null; at: number } | null = null, hueMemo: { key: string; hues: Hues | null } | null = null;
  const artPngs = new Map<string, Buffer>();
  let artPngBytes = 0;
  const ART_PNG_BYTES = 4 * 1024 * 1024, ART_RETRY_MS = 30_000;
  const stamp = (path: string): string | null => { try { const st = statSync(path); return st.isFile() ? `${path}:${st.mtimeMs}:${st.size}` : null; } catch { return null; } };
  function itemArt(graphic: number, hue: number): { png: Buffer; etag: string } | { reason: string } {
    const at = artFolder();
    if ("reason" in at) return at;
    const artPath = join(at.folder, "artLegacyMUL.uop"), artKey = stamp(artPath);
    if (!artKey) return { reason: "missing" };
    const huesPath = join(at.folder, "hues.mul"), huesKey = hue & 0x3fff ? stamp(huesPath) : null;
    const key = `${artKey}|${huesKey ?? ""}|${graphic}|${hue}`, etag = `"${createHash("sha1").update(key).digest("hex").slice(0, 20)}"`;
    const hit = kept(key);
    if (hit) return { png: hit, etag };
    let fd: number;
    try { fd = openSync(artPath, "r"); } catch { return { reason: "missing" }; }
    try {
      const read: ReadAt = (position, length) => { const b = Buffer.alloc(length); return readSync(fd, b, 0, length, position) === length ? b : null; };
      if (artMemo?.key !== artKey || (!artMemo.table && Date.now() - artMemo.at > ART_RETRY_MS)) { let table: UopTable | null; try { table = readUopTable(read, fstatSync(fd).size); } catch { table = null; } artMemo = { key: artKey, table, at: Date.now() }; }
      if (!artMemo.table) return { reason: "unreadable" };
      let art: StaticArt | null;
      try { const raw = readUopEntry(artMemo.table, itemArtName(graphic), read); art = raw && decodeStatic(raw); } catch { art = null; }
      if (!art) return { reason: "no-art" };
      const hues = huesKey ? huesAt(huesPath) : null, img = toRgba(art, hues ? hueOf(hues, hue) : null);
      if (!img) return { reason: "no-art" };
      const png = encodePngRgba(img.width, img.height, img.rgba);
      keep(key, png);
      return { png, etag };
    } finally { closeSync(fd); }
  }
  // Keeps a drawn PNG (item art or a paperdoll figure) up to ART_PNG_BYTES in all, the least recently used dropped first.
  function keep(key: string, png: Buffer): void {
    if (png.length > ART_PNG_BYTES) return;
    for (const [k, v] of artPngs) { if (artPngBytes + png.length <= ART_PNG_BYTES) break; artPngs.delete(k); artPngBytes -= v.length; }
    artPngs.set(key, png);
    artPngBytes += png.length;
  }
  // A kept PNG, marked as just used.
  function kept(key: string): Buffer | undefined {
    const png = artPngs.get(key);
    if (png) { artPngs.delete(key); artPngs.set(key, png); }
    return png;
  }
  // The paperdoll figure (issue #57): `look` wearing `worn`, drawn by app/paperdoll.mts from the UO folder's gumpartLegacyMUL.uop, tiledata.mul and hues.mul, with gump.def and Equipconv.def when the folder has them. The files are opened once while their stamps stay the same, and every gump is read only when a figure needs it. `pair` is the other figure shown beside this one: both are cut to the same box, the union of their opaque boxes plus 6 px. `gray` draws the stand-in's gray. The PNG is kept like item art; `etag` names the files' stamps and the request. `reason`: no folder, a file missing (`missing`), only an older client's gumpart.mul (`unsupported`), a file not readable (`unreadable`), a body the figure does not draw (`no-body`), or nothing drawn at all (`empty`).
  const DOLL_FILES = ["gumpartLegacyMUL.uop", "tiledata.mul", "hues.mul", "gump.def", "Equipconv.def"] as const;
  let dollMemo: { key: string; doll: ReturnType<typeof createPaperdoll> | null; at: number } | null = null;
  function paperdoll(look: Look, worn: Worn[], pair: Worn[] | null, gray: boolean): { png: Buffer; etag: string } | { reason: string } {
    const at = artFolder();
    if ("reason" in at) return at;
    const [gumps, tiles, hues, gumpDef, equipConv] = DOLL_FILES.map((f) => join(at.folder, f));
    const stamps = [gumps!, tiles!, hues!, gumpDef!, equipConv!].map(stamp);
    if (!stamps[0]) return { reason: stamp(join(at.folder, "gumpart.mul")) ? "unsupported" : "missing" };
    if (!stamps[1]) return { reason: "missing" };
    const filesKey = stamps.join("|"), key = `${filesKey}|doll|${JSON.stringify([look, worn, pair, gray])}`, etag = `"${createHash("sha1").update(key).digest("hex").slice(0, 20)}"`;
    const hit = kept(key);
    if (hit) return { png: hit, etag };
    if (dollMemo?.key !== filesKey || (!dollMemo.doll && Date.now() - dollMemo.at > ART_RETRY_MS)) dollMemo = { key: filesKey, doll: openPaperdoll(gumps!, tiles!, stamps[2] ? hues! : null, stamps[3] ? gumpDef! : null, stamps[4] ? equipConv! : null), at: Date.now() };
    if (!dollMemo.doll) return { reason: "unreadable" };
    const fig = dollMemo.doll.compose(look, worn);
    if (!fig) return { reason: "no-body" };
    const other = pair ? dollMemo.doll.compose(look, pair) : null, box = figureBox(other ? [fig, other] : [fig]), img = box && toRgba(fig, null, box);
    if (!img) return { reason: "empty" };
    const out = encodePngRgba(img.width, img.height, gray ? grayRgba(img.rgba) : img.rgba);
    keep(key, out);
    return { png: out, etag };
  }
  // A hues.mul read once while its stamp stays the same (item art, the paperdoll and its choices share it), or null when it is missing or not whole groups.
  function huesAt(path: string): Hues | null {
    const key = stamp(path);
    if (!key) return null;
    if (hueMemo?.key !== key) { let hues: Hues | null; try { hues = readHues(readFileSync(path)); } catch { hues = null; } hueMemo = { key, hues }; }
    return hueMemo.hues;
  }
  // The colour a worn piece's hue swatch shows (issue #57, the character sheet's gear list): entry 18 of each hue's ramp as "#rrggbb", keyed by the hue as asked (its partial and spectral bits ignored); a hue the file lacks is left out. `reason`: no folder, or no readable hues.mul (`missing`).
  function hueColors(list: number[]): Record<string, string> | { reason: string } {
    const at = artFolder();
    if ("reason" in at) return at;
    const hues = huesAt(join(at.folder, "hues.mul"));
    if (!hues) return { reason: "missing" };
    return Object.fromEntries(list.flatMap((h) => { const c = hueOf(hues, h & 0x3fff); return c ? [[String(h), hex555(c.colours[18]!)]] : []; }));
  }
  // The Customize popover's choices (issue #57): the game's character-creation lists with swatch colours from the UO folder's hues.mul and names from its Cliloc.enu (names fall back to "Style n" without it), kept while both files' stamps stay the same. `reason`: no folder, or no hues.mul (`missing`) or one that does not read (`unreadable`).
  let optionsMemo: { key: string; options: PaperdollOptionsApiResponse | null } | null = null;
  function paperdollOptions(): PaperdollOptionsApiResponse | { reason: string } {
    const at = artFolder();
    if ("reason" in at) return at;
    const huesPath = join(at.folder, "hues.mul"), clilocPath = join(at.folder, "Cliloc.enu"), huesKey = stamp(huesPath);
    if (!huesKey) return { reason: "missing" };
    const key = `${huesKey}|${stamp(clilocPath) ?? ""}`;
    if (optionsMemo?.key !== key) {
      const hues = huesAt(huesPath);
      let labels: Map<number, string> | null;
      try { labels = readCliloc(readFileSync(clilocPath), CREATION_LABELS); } catch { labels = null; }
      optionsMemo = { key, options: hues ? creationOptions(hues, labels ?? new Map()) : null };
    }
    return optionsMemo.options ?? { reason: "unreadable" };
  }
  // The renderer over these files, or null when the gumps or tiledata do not read. Each gump read opens the file for that read only.
  function openPaperdoll(gumps: string, tiles: string, hues: string | null, gumpDef: string | null, equipConv: string | null): ReturnType<typeof createPaperdoll> | null {
    const read: ReadAt = (position, length) => {
      let fd: number | null = null;
      try { fd = openSync(gumps, "r"); const b = Buffer.alloc(length); return readSync(fd, b, 0, length, position) === length ? b : null; } catch { return null; } finally { if (fd !== null) closeSync(fd); }
    };
    let table: UopTable | null, size: number;
    try { size = statSync(gumps).size; table = readUopTable(read, size); } catch { table = null; }
    const td = loadTileData(tiles);
    if (!table || !td) return null;
    const text = (path: string | null): string => { try { return path ? readFileSync(path, "latin1") : ""; } catch { return ""; } };
    const huesFile = hues ? huesAt(hues) : null;
    const defs = readGumpDef(text(gumpDef), (id) => uopIndex(table, gumpArtName(id)) >= 0);
    return createPaperdoll({ gump: gumpSource(table, read, defs), tiles: td, hues: huesFile, equipConv: readEquipConv(text(equipConv)) });
  }
  // Built house models, kept while the served inventory (a new object whenever the scans, the item kinds or the overlay change; the houses come from the same fold) and the tiledata (loadTileData answers the same object until the file changes) stay the same. The ground chests are the inventory's ground roots with a position, as Organize picks them.
  let houseMemo: { inv: Inventory | null; td: TileData | null; ground: HouseContainerInput[]; models: Map<string, HouseModel> } = { inv: null, td: null, ground: [], models: new Map() };
  function houseModel(inv: Inventory, house: HouseSource, td: TileData | null): HouseModel {
    if (houseMemo.inv !== inv || houseMemo.td !== td) {
      const ground = Object.values(inv.containers).flatMap((c) => (c.parent == null && c.kind === "ground" && c.pos && Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y))
        ? [{ serial: c.serial, name: c.name ?? "", facet: c.pos.facet ?? null, x: c.pos.x!, y: c.pos.y!, z: c.pos.z ?? 0, opened: true, graphic: c.graphic, hue: c.hue }] : []);
      houseMemo = { inv, td, ground, models: new Map() };
    }
    let m = houseMemo.models.get(house.id);
    if (!m) {
      // The chests this house's captures saw that no scan has opened: on the map from the first scan, named from tiledata, as not opened yet. A chest the fold knows is drawn from the fold. The fold and Organize never see these; retention keeps the captures that contribute them.
      const seen = house.containers.flatMap(([serial, graphic, x, y, z]) => inv.containers[String(serial)] ? [] : [{ serial, name: td?.info(graphic)?.name || "container", facet: house.facet, x, y, z, opened: false }]);
      m = buildHouseModel(house, td, [...houseMemo.ground, ...seen]);
      houseMemo.models.set(house.id, m);
    }
    return m;
  }
  return { tileData: houseTileData, facetBitmap, facetPng, itemArt, paperdoll, paperdollOptions, hueColors, model: houseModel };
}
export type HousesService = ReturnType<typeof createHousesService>;
