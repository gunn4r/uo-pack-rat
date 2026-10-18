// electron-app.mts — the one way an Electron UI test launches Pack Rat (issue #338, the quality pass's shared fixture): the
// skip when Electron can't run here, a temp data folder, the launch itself (update check off, the test's own client home,
// the page's errors collected, the page loaded before a test sets a hash, the window sized), the teardown, a stand-in
// bridge and a poll for file-backed facts. Window sizing and layout reads stay in electron-window.mts.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import type { ElectronApplication, Page } from "playwright";
import { completeLines, fitWindow, noUpdateCheck, removeTempDir, testEnv, type RealSize } from "./electron-window.mts";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);

// Why the Electron tests can't run here (TEST_SKIP_ELECTRON, or electron or playwright not installed), or null.
export function electronUnavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
// Skips the test, saying why, when Electron can't run here: `if (skipWithoutElectron(t)) return;` opens every Electron test.
export function skipWithoutElectron(t: TestContext): boolean {
  const why = electronUnavailable();
  if (why) t.skip(why);
  return !!why;
}

// A fresh data folder in the OS temp folder. `settings` is merged over a set-up uoalive settings.json (so the first-run wizard
// stays closed); null writes none (a first run). `demoScans` copies the two demo scans into scans/.
export function tempDataDir(prefix = "packrat-ui-", { settings = {}, demoScans = false }: { settings?: Record<string, unknown> | null; demoScans?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (settings) writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, ...settings }));
  if (demoScans) {
    mkdirSync(join(dir, "scans"), { recursive: true });
    for (const f of ["demo-Dorran.json", "demo-Kestrel.json"]) copyFileSync(join(ROOT, "app", "fixtures", f), join(dir, "scans", f));
  }
  return dir;
}

export interface AppOptions {
  demo?: boolean | undefined;                       // --demo: the committed demo fixtures, read-only
  size?: RealSize | undefined;                      // the window size to ask for (fitWindow); left as the app opens it when absent
  colorScheme?: "light" | "dark" | undefined;
  env?: Record<string, string> | undefined;         // extra environment variables (testEnv's `extra`)
  home?: string | undefined;                        // the game-client search home (testEnv's `home`)
  ready?: string | undefined;                       // a selector to wait for (30 s) before the test starts, such as the first inventory row
}
export interface App {
  app: ElectronApplication;
  page: Page;
  errors: string[];                                 // every pageerror, for `assert.deepEqual(errors, [])`
  dataDir: string;
  size: RealSize;                                   // the window's real size (what fitWindow got, when a size was asked for)
  // Closes the app and removes the data folder (`keepData` for a test that launches again on the same folder).
  close: (o?: { keepData?: boolean }) => Promise<void>;
}
// Launches the app on `dataDir` and waits for its page to load, so a hash a test sets is never dropped by the document that
// replaces a loading page (issue #330). A launch that fails after Electron started closes it, so no window outlives the file.
export async function launchApp(dataDir: string, o: AppOptions = {}): Promise<App> {
  const { _electron } = await import("playwright");
  // The absolute ROOT as args[0] is what electron/main.mts expects in dev, and cwd: ROOT keeps it independent of where
  // `node --test` runs from.
  const app = await _electron.launch({ args: [ROOT, ...(o.demo ? ["--demo"] : []), "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv(o.env, o.home) });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.waitForLoadState("load");
    if (o.colorScheme) await page.emulateMedia({ colorScheme: o.colorScheme });
    const size = o.size ? await fitWindow(app, page, o.size) : await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (o.ready) await page.locator(o.ready).first().waitFor({ timeout: 30_000 });
    const close = async ({ keepData = false } = {}): Promise<void> => {
      await app.close();
      if (!keepData) removeTempDir(dataDir);
    };
    return { app, page, errors, dataDir, size, close };
  } catch (e) {
    await app.close();
    throw e;
  }
}

// Polls a fact (a file another process writes, a page read) until `ok` holds; past `ms` it fails naming `what` and the last value.
export async function until<T>(read: () => T | Promise<T>, ok: (v: T) => boolean, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await read();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
    v = await read();
  }
  return v;
}

// A command the page queued for the bridge (queue.jsonl), as the stand-in reads it.
export interface QueuedCommand { id: string; action: string; [key: string]: unknown }
export interface TripCommand extends QueuedCommand { index: number; takes: Array<{ serial: number }>; puts: Array<{ serial: number; dest: number[] }> }
export interface FakeBridge {
  bridgeDir: string;
  status: { current: unknown; results: Record<string, unknown> };   // what the next status.json says; write() sends a change at once
  write: () => void;
  queue: <T extends QueuedCommand = QueuedCommand>() => T[];          // the complete lines of queue.jsonl
  trips: () => TripCommand[];
  stop: () => void;
}
// The TazUO bridge, as far as the page can tell: <data>/bridge/tazuo/status.json rewritten every `every` ms, so the bridge reads as
// online. With `answerTrips` each queued trip is answered that many ms after it is first seen, every step done. Timers are
// unref'd, so a test that fails before stop() does not keep the file running.
export function fakeBridge(dataDir: string, { every = 1000, answerTrips = null }: { every?: number; answerTrips?: number | null } = {}): FakeBridge {
  const bridgeDir = join(dataDir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const status: FakeBridge["status"] = { current: null, results: {} }, seen = new Set<string>();
  const queue = <T extends QueuedCommand = QueuedCommand>(): T[] => completeLines(join(bridgeDir, "queue.jsonl")).map((l) => JSON.parse(l) as T);
  const trips = (): TripCommand[] => queue().filter((c): c is TripCommand => c.action === "trip");
  const write = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: status.current, counts: { done: 0, failed: 0 }, results: status.results }));
  const tick = (): void => {
    if (answerTrips != null) for (const c of trips()) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      setTimeout(() => { status.results[c.id] = { ok: true, msg: "trip done", t: new Date().toISOString(), partial: false, stopped: false, steps: [...c.takes.map((x) => ({ op: "take", serial: x.serial, ok: true, msg: "took" })), ...c.puts.map((x) => ({ op: "put", serial: x.serial, ok: true, msg: "put" }))] }; }, answerTrips).unref();
    }
    write();
  };
  tick();
  const timer = setInterval(tick, every).unref();
  return { bridgeDir, status, write, queue, trips, stop: () => clearInterval(timer) };
}
