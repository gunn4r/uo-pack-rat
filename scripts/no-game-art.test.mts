// no-game-art.test.mts — a [smoke] guard that no game client file or art decoded from one is ever committed (issue #502).
//
// a `[smoke]` guard that no game client file or art decoded from one is ever committed (issue #502): every path in the git index (staged or tracked) is checked: no Ultima Online client file (`.mul`, `.uop`, `.idx`, the client's `.def` tables), no art cache, and no image outside the places the repo's own pictures live (the README's screenshots in `docs/images/`, the app's logo and icons), and no PNG in `docs/images/` under 1280 px wide or GIF under 640 px (a screenshot is 2560 px, a GIF 960 px; a decoded sprite is far smaller), the three in-game captures named in IN_GAME aside. Pack Rat draws items and paperdolls from the player's own client files at run time, and `scripts/readme-shots.mts` reads a client folder only while it captures, so nothing decoded from the game belongs in the repo. Also the rule itself, on made-up paths. Skipped when git is unavailable.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The client's data files, and the .def tables shipped beside them.
const CLIENT_FILE = /\.(mul|uop|idx)$|(^|\/)(gump|equipconv|art|body|bodyconv|corpse|mount|paperdoll)\.def$/i;
// A folder that would hold decoded art.
const ART_CACHE = /(^|\/)[^/]*(art|gump|paperdoll|icon)[-_.]?cache(\/|$)/i;
const IMAGE = /\.(png|gif|jpe?g|webp|bmp|tiff?|ico|icns)$/i;
// Where the repo's own pictures live: the README's screenshots, and the app's logo and icons.
const IMAGE_HOMES = [/^docs\/images\/[^/]+$/, /^app\/assets\/(favicon|icon|logo-mark)\.png$/, /^build\/icon\.png$/];

// The README's in-game captures, recorded from the game window at its own size (smaller than the app's shots).
const IN_GAME = new Set(["docs/images/grab-game.gif", "docs/images/grab-app.gif", "docs/images/put-away-trip.gif"]);
const MIN_WIDTH = { png: 1280, gif: 640 } as const;

// An image's width from its header: a PNG's IHDR or a GIF's logical screen; null for anything else.
export function imageWidth(head: Buffer): { kind: "png" | "gif"; width: number } | null {
  if (head.length >= 24 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "png", width: head.readUInt32BE(16) };
  if (head.length >= 10 && /^GIF8[79]a$/.test(head.subarray(0, 6).toString("latin1"))) return { kind: "gif", width: head.readUInt16LE(6) };
  return null;
}
// What is wrong with a docs/images/ picture by its width: too narrow for a screenshot, so likely decoded art.
export function smallImageProblem(path: string, head: Buffer): string | null {
  const w = imageWidth(head);
  if (!w || IN_GAME.has(path) || w.width >= MIN_WIDTH[w.kind]) return null;
  return `${path}: a ${w.kind.toUpperCase()} ${w.width} px wide, under the ${MIN_WIDTH[w.kind]} px of a screenshot (decoded game art?)`;
}

// What is wrong with each path, one line per problem; none for a clean list.
export function gameArtProblems(paths: readonly string[]): string[] {
  return paths.flatMap((p) => CLIENT_FILE.test(p) ? [`${p}: a game client file`]
    : ART_CACHE.test(p) ? [`${p}: an art cache`]
    : IMAGE.test(p) && !IMAGE_HOMES.some((h) => h.test(p)) ? [`${p}: an image outside docs/images/ and the app's icons (decoded game art?)`]
    : []);
}

test("[smoke] no-game-art: nothing in the git index is a game client file, an art cache or an image outside the repo's own", (t) => {
  let paths: string[];
  try { paths = execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean); }
  catch { t.skip("git is unavailable"); return; }
  assert.ok(paths.length > 0, "the index lists the repo's files");
  assert.deepEqual(gameArtProblems(paths), [], "remove these from the index (git rm --cached); only the screenshots' PNGs and GIFs are committed");
  // The staged bytes (`git show :path`), not the working tree's, of each picture in docs/images/.
  const small = paths.filter((p) => /^docs\/images\/[^/]+$/.test(p))
    .map((p) => smallImageProblem(p, execFileSync("git", ["show", `:${p}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).subarray(0, 32)))
    .filter((x): x is string => x !== null);
  assert.deepEqual(small, [], "a picture in docs/images/ is too small to be a screenshot");
});

test("[fast] no-game-art: a docs/images/ PNG under 1280 px or GIF under 640 px is refused, a screenshot passes, the in-game captures aside", () => {
  const png = (width: number): Buffer => { const b = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(width, 16); b.writeUInt32BE(width, 20); return b; };
  const gif = (width: number): Buffer => { const b = Buffer.alloc(16); b.write("GIF89a", 0, "latin1"); b.writeUInt16LE(width, 6); b.writeUInt16LE(width, 8); return b; };
  assert.deepEqual(imageWidth(png(44)), { kind: "png", width: 44 });
  assert.match(smallImageProblem("docs/images/sword.png", png(44)) ?? "", /PNG 44 px wide, under the 1280 px/);
  assert.equal(smallImageProblem("docs/images/inventory.png", png(2560)), null);
  assert.match(smallImageProblem("docs/images/doll.gif", gif(200)) ?? "", /GIF 200 px wide, under the 640 px/);
  assert.equal(smallImageProblem("docs/images/organize.gif", gif(960)), null);
  assert.equal(smallImageProblem("docs/images/grab-game.gif", gif(310)), null, "an in-game capture keeps the game window's size");
  assert.equal(smallImageProblem("docs/images/ingame-panel.jpg", Buffer.from("\xff\xd8\xff")), null, "a JPEG has no width read here");
});

test("[fast] no-game-art: the rule names client files, art caches and stray images, and passes the repo's own pictures", () => {
  assert.deepEqual(gameArtProblems(["docs/images/inventory.png", "docs/images/suit-builder.gif", "app/assets/icon.png", "build/icon.png", "app/house-fixture.mts", "docs/gumps.md"]), []);
  assert.deepEqual(gameArtProblems([
    "artLegacyMUL.uop", "docs/images/tiledata.mul", "UO/hues.MUL", "art.idx", "client/Equipconv.def",
    ".art-cache/1234.png", "data/paperdoll_cache/a.bin",
    "app/ui/icons/sword.png", "docs/images/sub/doll.png", "scratch/doll.webp",
  ]).map((p) => p.split(": ")[1]), [
    "a game client file", "a game client file", "a game client file", "a game client file", "a game client file",
    "an art cache", "an art cache",
    "an image outside docs/images/ and the app's icons (decoded game art?)", "an image outside docs/images/ and the app's icons (decoded game art?)", "an image outside docs/images/ and the app's icons (decoded game art?)",
  ]);
});
