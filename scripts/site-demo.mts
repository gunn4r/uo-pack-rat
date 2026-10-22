#!/usr/bin/env node
// site-demo.mts — the website's live demo: the real Pack Rat page, built as the server serves it, with the demo characters' API responses recorded off a real server, so it runs on a static site (site/demo/shim.mjs answers its calls).
//   npm run site:demo -- --out <folder>
//
// It builds the page (`buildUi`), starts a server on the README's demo data (scripts/shots-lib.mts), opens each screen in headless Chromium and records every /api answer the page reads: the Inventory searched and an item opened, the Containers, Scrolls and Unravel views, both characters, the House map, the Suit Builder with one build (its finished job, replayed by the shim), Organize after Auto organize's Accept, Settings and Import. The Pages workflow runs it on every deploy, so the demo is always the app as it is on main and can't drift from it. The recording is scrubbed (scrubDemo: the throwaway folders and the client paths become placeholders) and then checked (demoLeaks): a machine path or a character other than the demo's fails the build. No item art or paperdoll is recorded: those are drawn from the player's own client.
//
// map: tooling
// owns: `recordDemo`, `scrubDemo`, `demoLeaks`, `demoIndex`, `DEMO_CHARACTERS`
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUi } from "./build-ui.mts";
import { ROOT, cleanup, go, launchBrowser, pause, serve } from "./shots-lib.mts";

export const DEMO_CHARACTERS = ["Dorran", "Kestrel"];
// Where the page's files come from, as app/http/routes/static.mts serves them: the page, its stylesheets and fonts from
// the source tree, its modules from the build.
const APP = join(ROOT, "app");

// The recording with every machine-specific path replaced: `paths` (the throwaway data folder, the repo, the home folder,
// the temp folder) longest first, in plain and JSON-escaped (Windows backslash) form.
export function scrubDemo(text: string, paths: Record<string, string>): string {
  const pairs = Object.entries(paths).filter(([from]) => from.length > 1).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of pairs) for (const form of [from, JSON.stringify(from).slice(1, -1)]) text = text.split(form).join(to);
  return text;
}

// What in a recording could identify the machine or a real player: a home or temp folder path, and any character
// named in it other than the demo's.
export function demoLeaks(text: string, { user = "" }: { user?: string } = {}): string[] {
  const leaks: string[] = [];
  const paths = /\/Users\/|\/home\/|[A-Za-z]:\\\\Users\\\\|\/var\/folders\/|\/private\/(?:var|tmp)\/|\/tmp\/|AppData/g;
  for (const m of text.matchAll(paths)) leaks.push(`a machine path near "${text.slice(Math.max(0, m.index - 20), m.index + 20).replace(/[^\x20-\x7e]/g, "?")}"`);
  if (user.length >= 4 && text.toLowerCase().includes(user.toLowerCase())) leaks.push("the user name of the machine that recorded it");
  const names = new Set<string>();
  for (const m of text.matchAll(/"(?:character|scannedBy|equippedBy)":"([^"]+)"/g)) names.add(m[1]!);
  for (const name of names) if (!DEMO_CHARACTERS.includes(name)) leaks.push(`a character not in the demo: ${name}`);
  return leaks;
}

// The app's index.html as the demo serves it: its root-relative URLs made relative (the demo lives in a folder of the
// site) and the shim loaded before the app.
export function demoIndex(html: string): string {
  const out = html.replace(/(href|src)="\/(?!\/)/g, '$1="')
    .replace('<script type="module" src="ui/app.mjs"></script>', '<script type="module" src="shim.mjs"></script>\n<script type="module" src="ui/app.mjs"></script>');
  if (!out.includes('src="shim.mjs"')) throw new Error("app/index.html no longer loads ui/app.mjs the way site-demo.mts expects");
  return out;
}

// The page's files, as the server serves them.
function copyPage(out: string): void {
  writeFileSync(join(out, "index.html"), demoIndex(readFileSync(join(APP, "index.html"), "utf8")));
  cpSync(join(APP, "dist"), out, { recursive: true });
  for (const f of readdirSync(join(APP, "ui"))) if (f.endsWith(".css")) cpSync(join(APP, "ui", f), join(out, "ui", f));
  cpSync(join(APP, "ui", "fonts"), join(out, "ui", "fonts"), { recursive: true });
  for (const f of ["favicon.png", "logo-mark.png"]) cpSync(join(APP, "assets", f), join(out, f));
}

// Records the demo into `out` (new or empty): the page, demo-data.json, nothing else. The shim comes from site/demo/.
export async function recordDemo(out: string): Promise<void> {
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  buildUi();
  copyPage(out);
  const browser = await launchBrowser();
  const rec: Record<string, unknown> = {};
  try {
    const url = await serve(true);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    // Each /api answer the page reads, by method, path and query. `overwrite` off keeps what an earlier screen saw (a
    // build adds a saved run, which the demo's first look shouldn't have).
    let overwrite = true;
    page.on("response", async (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/") || !(r.headers()["content-type"] || "").includes("json")) return;
      const key = `${r.request().method()} ${u.pathname}${u.search}`;
      if (!overwrite && key in rec) return;
      try { rec[key] = await r.json(); } catch { /* a stream or an empty body */ }
    });
    const visit = async (hash: string, ready: string): Promise<void> => { await go(page, url, hash, ready); await pause(page, 600); };
    await visit("inventory", "#inv-table tbody tr.item");
    await page.fill("#f-text", "ring");
    await pause(page, 800);
    await page.locator("#inv-table tbody tr.item").nth(2).click();
    await pause(page, 600);
    await visit("containers", "#tab-inventory:not([hidden])");
    await visit("scrolls", "#tab-inventory:not([hidden])");
    await visit("unravel", ".unr-row");
    for (const name of DEMO_CHARACTERS) await visit(`characters/${name}`, "#tab-characters:not([hidden])");
    await visit("map", "#tab-map:not([hidden]) svg");
    await visit("settings", "#set-run-setup");
    await visit("import", "#import-body");
    // Every item, for the shim's own searches.
    rec.items = (await page.evaluate(async () => (await (await fetch("/api/items?limit=100000")).json()).rows)) as unknown[];
    delete rec["GET /api/items?limit=100000"];
    // One build, its finished job read back from its event stream once done.
    overwrite = false;
    let clientId = "";
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize") clientId = r.headers()["x-client-id"] || ""; });
    await visit("builder", "#b-run");
    await page.click("#b-run");
    await page.waitForSelector("#b-result .b-head-card", { timeout: 120_000 });
    const job = (rec["POST /api/optimize"] as { id?: string } | undefined)?.id;
    if (!job) throw new Error("the build was not recorded");
    const stream = await fetch(`${url}/api/optimize/${job}/events?client=${encodeURIComponent(clientId)}`);
    const reader = stream.body!.getReader();
    let text = "";
    for (let chunk = await reader.read(); !chunk.done && !/event: hello\ndata: .*\n\n/.test(text); chunk = await reader.read()) text += new TextDecoder().decode(chunk.value);
    await reader.cancel();
    rec.build = JSON.parse(/event: hello\ndata: (.*)\n\n/.exec(text)![1]!);
    // Organize after Auto organize's Accept, so the demo shows rules and labels rather than the empty start.
    overwrite = true;
    await visit("organize", "#tab-organize:not([hidden]) #org-auto");
    await page.click("#org-auto");
    await page.waitForSelector('#auto-drawer:not([hidden]) #auto-proposal[aria-busy="false"] #auto-headline');
    await page.click("#auto-accept");
    await page.waitForSelector("#org-plan #org-headline", { timeout: 30_000 });
    await pause(page, 800);
    await context.close();
  } finally {
    await browser.close();
    await cleanup();
  }
  const scrubbed = scrubDemo(JSON.stringify(rec), { [ROOT]: "pack-rat", [tmpdir()]: "demo", [realpathSync(tmpdir())]: "demo", [homedir()]: "home" });
  const leaks = demoLeaks(scrubbed, { user: process.env.CI ? "" : userInfo().username });
  if (leaks.length) throw new Error(`the demo recording isn't safe to publish:\n  ${[...new Set(leaks)].slice(0, 20).join("\n  ")}`);
  writeFileSync(join(out, "demo-data.json"), scrubbed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--out");
  const out = at >= 0 ? process.argv[at + 1] : null;
  if (!out) { console.error("usage: npm run site:demo -- --out <folder>"); process.exit(2); }
  try { await recordDemo(resolve(out)); console.log(`demo recorded in ${resolve(out)}`); } catch (e) { console.error((e as Error).message); process.exit(1); }
}
