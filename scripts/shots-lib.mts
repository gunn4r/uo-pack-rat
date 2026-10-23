// shots-lib.mts — what the README's and the website's screenshot scripts share: the seeded demo data folder (the demo characters, Kestrel at Imbuing 70, the showcase house of app/house-fixture.mts), a server started on it with a game-client search home of its own, the headless browser, and the capture helpers.
//
// On import it only checks PACKRAT_SHOTS_UO and sets a Ctrl+C handler that stops the servers and removes their folders. Item icons and the paperdoll are drawn from a real 7.x client's files, which never enter the repo: PACKRAT_SHOTS_UO=<UO folder> points the seeded client at that folder, read at capture time (the server keeps what it decodes in memory only). The House map's shots keep the house's synthetic tiledata.mul, with the folder's art files linked beside it. Without the variable the shots still run: the icon boxes stay empty and each paperdoll card shows the app's "couldn't find your Ultima Online client files" note.
//
// map: tooling
// owns: `seed`, `serve`, `cleanup`, `launchBrowser`, `go`, `pause`, `typeSlowly`, `withPage`, `recordGif`, `SIZE`
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { houseScan, type ThingSpec } from "../app/organize-fixture.mts";
import { claimHouses, showcaseHouse, FIXTURE_TILES } from "../app/house-fixture.mts";
import { syntheticTileData } from "../app/tiledata-fixture.mts";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SIZE = { width: 1280, height: 800 };
// The real client folder (PACKRAT_SHOTS_UO), and the files the House map's folder links from it: the art and the
// paperdoll's files and the facet overviews, everything the server reads but tiledata.mul (app/services/houses.mts).
export const REAL_UO = process.env.PACKRAT_SHOTS_UO || null;
const ART_FILES = ["artLegacyMUL.uop", "gumpartLegacyMUL.uop", "hues.mul", "gump.def", "Equipconv.def", ...[0, 1, 2, 3, 4, 5].map((f) => `facet0${f}.mul`)];
if (REAL_UO && !["tiledata.mul", "artLegacyMUL.uop", "gumpartLegacyMUL.uop"].every((f) => existsSync(join(REAL_UO, f)))) {
  throw new Error(`PACKRAT_SHOTS_UO=${REAL_UO} is not a 7.x UO folder: it needs tiledata.mul, artLegacyMUL.uop and gumpartLegacyMUL.uop`);
}

// The demo scans with a few skills each (the Suit Builder's header names them), Kestrel at Imbuing 70 (for Unravel). With `house`, also the showcase house of app/house-fixture.mts:
// four rooms and an upper floor, 41 chests in rows, labeled by what they hold, a few holding things to find on the map, and
// the real gear of app/fixtures/demo-gear.json in the Armor, Weapons, Jewelry and Clothing chests. `map`: the client's UO folder is the house's synthetic tiledata.mul (the House map's shots), with the real folder's art linked beside it;
// otherwise it is the real folder itself when there is one, whose tiledata the paperdoll's worn pieces need.
const SKILLS: Record<string, Record<string, number>> = {
  Dorran: { Swordsmanship: 100, Fencing: 100, Tactics: 100, Anatomy: 90, Healing: 85, Parry: 80 },
  Kestrel: { Magery: 100, "Evaluating Intelligence": 95, Meditation: 90, "Mace Fighting": 80, Imbuing: 70 },
};
export function seed(dir: string, house: boolean, map: boolean): { home: string } {
  mkdirSync(join(dir, "scans"), { recursive: true });
  for (const name of ["Dorran", "Kestrel"]) {
    const scan = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`), "utf8")) as { skills: Record<string, unknown> };
    scan.skills = { ...scan.skills, ...Object.fromEntries(Object.entries(SKILLS[name]!).map(([k, v]) => [k, { base: v, value: v, cap: 100 }])) };
    writeFileSync(join(dir, "scans", `demo-${name}.json`), JSON.stringify(scan));
  }
  const home = join(dir, "home"), client = join(dir, "client"), scripts = join(client, "TazUO", "LegionScripts"), uo = join(client, "UO");
  for (const d of [home, scripts, join(client, "Profiles", "Settings"), uo]) mkdirSync(d, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, autoUpdateCheck: false, client: { adapter: "tazuo", scriptsDir: scripts } }));
  const useUo = (folder: string): void => writeFileSync(join(client, "Profiles", "Settings", "p.json"), JSON.stringify({ ultimaonlinedirectory: folder }));
  if (REAL_UO && !map) useUo(REAL_UO);
  if (!house) return { home };
  const { house: showcase, chests, groups } = showcaseHouse();
  // Things to find, spread over the rooms: [name, the label group of the chest it is in (or null: an unlabeled one), which chest of it].
  const unlabeled = chests.filter((c) => !Object.values(groups).some((g) => g.includes(c.serial))).map((c) => c.serial);
  const finds: Array<[string, string | null, number]> = [["Katana", "Weapons", 1], ["Ruby", "Jewelry", 2], ["Katana", null, 4], ["Black Pearl", "Reagents", 3], ["Ruby", null, 1], ["Katana", "Jewelry", 6], ["Sapphire", "Jewelry", 5], ["Ruby", "Armor", 2]];
  const things: ThingSpec[] = finds.map(([name, group, k], i) => ({ serial: 0x40600000 + i, name, in: (group ? groups[group]! : unlabeled)[k]! }));
  // The real gear of app/fixtures/demo-gear.json (app/bench/make-demo-gear.mts), dealt round the chests of its group.
  const gear = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", "demo-gear.json"), "utf8")) as Array<{ name: string; graphic: number; hue: number; weight: number; lines: string[]; group: string }>;
  const dealt: Record<string, number> = {};
  gear.forEach((g, i) => { const box = groups[g.group]!, n = dealt[g.group] = (dealt[g.group] ?? 0) + 1; things.push({ serial: 0x40700000 + i, name: g.name, in: box[n % box.length]!, graphic: g.graphic, hue: g.hue, weight: g.weight, lines: g.lines }); });
  // A chest holding gear shows what it holds; the others a made-up fill, so the map shows a spread.
  const holds = new Set(things.filter((t) => t.serial >= 0x40700000).map((t) => t.in));
  const v = houseScan({ character: "Dorran", scannedAt: "2025-12-31T12:00:00Z", things, boxes: chests.map((c, i) => ({ serial: c.serial, name: c.name, pos: { x: c.x, y: c.y, z: c.z, facet: 1 }, ...(holds.has(c.serial) ? {} : { count: (i * 37) % 126 }) })) });
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify({ ...v, house: { facet: 1, capturedAt: showcase.capturedAt, at: { x: chests[0]!.x, y: chests[0]!.y + 10 }, tiles: showcase.tiles, items: showcase.items } }));
  claimHouses(dir, [showcase]);
  // A label on the chests of each group, so the map shows the label colors.
  const colors: Record<string, string> = { Reagents: "#2f7f7f", Armor: "#8a5a2b", Weapons: "#a33b3b", Jewelry: "#6b4fa0", Scrolls: "#3d6fb0", Clothing: "#4f7a3a" };
  const labels: Record<string, unknown> = {};
  for (const [name, serials] of Object.entries(groups)) for (const serial of serials) labels[serial] = { serial, name, color: colors[name], origin: "manual" };
  writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 1, catchAll: null, pinnedItems: [], rules: [], labels }));
  if (REAL_UO && !map) return { home };
  writeFileSync(join(uo, "tiledata.mul"), syntheticTileData(FIXTURE_TILES));
  // A link, not a copy, so the art stays in the client folder; a copy only where links are not allowed (Windows without
  // the right), into this throwaway folder, which is deleted at the end.
  for (const f of REAL_UO ? ART_FILES : []) {
    const from = join(REAL_UO!, f);
    if (!existsSync(from)) continue;
    try { symlinkSync(from, join(uo, f)); } catch { copyFileSync(from, join(uo, f)); }
  }
  useUo(uo);
  return { home };
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => { const s = createServer(); s.once("error", fail); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); }); });
}

async function startServer(dir: string, home: string): Promise<{ url: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, "app", "vault-server.mts"), "--data", dir, "--port", String(port)], { stdio: "ignore", env: { ...process.env, PACKRAT_CLIENT_HOME: home } });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${url}/api/settings`)).ok) return { url, child }; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));   // sleep: polling for the server to listen
  }
  child.kill();
  throw new Error("the server did not start within 30 s");
}

export async function launchBrowser(): Promise<Browser> {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: "chrome" }); }
}

export async function go(page: Page, url: string, hash: string, ready: string): Promise<void> {
  await page.goto(`${url}/#/${hash}`);
  await page.waitForSelector(ready, { timeout: 30_000 });
  // The sidebar's footer the same in every picture: a client set up, its bridge not running.
  await page.waitForSelector('#bridge[data-state="offline"]', { timeout: 30_000 });
  await page.waitForTimeout(600);   // sleep: fonts and transitions settle before the picture
}

// Types `text` a key at a time, as a person would, for the GIFs.
export const typeSlowly = (page: Page, selector: string, text: string): Promise<void> => page.locator(selector).pressSequentially(text, { delay: 120 });
export const pause = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms);   // sleep: a beat for the viewer of the GIF

// A page at `size` and 2x (`scale`), set up by `shoot`, then handed to `take` (a screenshot, a clip). `keep`: leave the
// pointer and focus where `shoot` put them, for a shot of a hover preview or an open popover.
export async function withPage<T>(browser: Browser, shoot: (page: Page) => Promise<void>, take: (page: Page) => Promise<T>, { size = SIZE, scale = 2, keep = false }: { size?: { width: number; height: number }; scale?: number; keep?: boolean } = {}): Promise<T> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale, colorScheme: "light" });
  const page = await context.newPage();
  try {
    await shoot(page);
    if (!keep) {
      await page.mouse.move(size.width - 2, size.height - 2);   // no hover tooltip or row actions in the picture
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
    await pause(page, 400);
    return await take(page);
  } finally { await context.close(); }
}

// A GIF at `out`: screenshots taken back to back while `act` runs, each shown for as long as it was on screen, turned by
// ffmpeg into a 15 fps palette GIF 960 px wide. The recording starts once `hash` has loaded and `ready` shows. False when
// ffmpeg is not on the PATH (skipped, saying so).
export async function recordGif(browser: Browser, url: string, out: string, hash: string, ready: string, act: (page: Page) => Promise<void>): Promise<boolean> {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) { console.log(`skipped ${out}: ffmpeg is not on the PATH`); return false; }
  const frameDir = mkdtempSync(join(tmpdir(), "packrat-frames-"));
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  await go(page, url, hash, ready);
  const frames: Array<{ file: string; at: number }> = [];
  let recording = true;
  const start = Date.now();
  const recorder = (async () => {
    while (recording) {
      const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
      await page.screenshot({ path: file });
      frames.push({ file, at: (Date.now() - start) / 1000 });
    }
  })();
  try { await act(page); } finally { recording = false; await recorder; await context.close(); }
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + 0.1) - f.at).toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
  writeFileSync(join(frameDir, "frames.txt"), list);
  const filters = "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frameDir, "frames.txt"), "-vf", filters, "-loop", "0", out], { stdio: "inherit" });
  rmSync(frameDir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${out}`);
  return true;
}

// Each server's throwaway data folder, listed before anything is written to it, so a failed start or a Ctrl+C still
// removes it; `child` once the server runs.
const servers: Array<{ dir: string; child: ChildProcess | null }> = [];
// A server on a fresh data folder: the demo characters, with `house` the showcase house too, with `map` its synthetic
// tiles for the House map. Its URL.
export async function serve(house: boolean, map = false): Promise<string> {
  const entry: { dir: string; child: ChildProcess | null } = { dir: mkdtempSync(join(tmpdir(), "packrat-shots-")), child: null };
  servers.push(entry);
  const { home } = seed(entry.dir, house, map);
  const { url, child } = await startServer(entry.dir, home);
  entry.child = child;
  return url;
}
// Stops each server, waits for it to exit (Windows keeps its files open until then), then removes its folder; a folder
// that won't go (EBUSY) is named, not fatal.
export async function cleanup(): Promise<void> {
  for (const { dir, child } of servers.splice(0)) {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((ok) => child.once("exit", ok));
      child.kill();
      await Promise.race([exited, new Promise((ok) => setTimeout(ok, 5000))]);   // sleep: at most 5 s for the server to exit
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { console.warn(`could not remove ${dir}: ${(e as Error).message}`); }
  }
}
process.once("SIGINT", () => { void cleanup().finally(() => process.exit(130)); });
