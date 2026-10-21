// no-game-art.test.mts — a [smoke] guard that no game client file or art decoded from one is ever committed (issue #502).
//
// a `[smoke]` guard that no game client file or art decoded from one is ever committed (issue #502): every path in the git index (staged or tracked) is checked: no Ultima Online client file (`.mul`, `.uop`, `.idx`, the client's `.def` tables), no art cache, and no image outside the places the repo's own pictures live (the README's screenshots in `docs/images/`, the app's logo and icons). Pack Rat draws items and paperdolls from the player's own client files at run time, and `scripts/readme-shots.mts` reads a client folder only while it captures, so nothing decoded from the game belongs in the repo. Also the rule itself, on made-up paths. Skipped when git is unavailable.
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
