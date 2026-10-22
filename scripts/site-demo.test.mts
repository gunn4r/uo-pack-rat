// site-demo.test.mts — the website's live demo (scripts/site-demo.mts): a recording is scrubbed of the machine's folders, a machine path, the recording machine's user name or a character other than the demo's is caught before it can be published, the app's index.html still takes the shim the way the demo loads it, and the framed app can't scroll the page around it until the visitor uses it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CHARACTERS, demoIndex, demoLeaks, scrubDemo } from "./site-demo.mts";
import { holdScroll } from "../site/demo/hold-scroll.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("[fast] site-demo: the throwaway folder, the repo and the home folder become placeholders, Windows paths included", () => {
  const rec = JSON.stringify({ dataDir: "/var/folders/ab/T/packrat-shots-x", rules: "/home/example/work/repo/app/rules/uoalive.json", win: "C:\\Users\\example\\AppData\\Local\\Temp\\packrat-shots-y" });
  const out = scrubDemo(rec, { "/var/folders/ab/T": "demo", "/home/example/work/repo": "pack-rat", "C:\\Users\\example\\AppData\\Local\\Temp": "demo" });
  assert.deepEqual(JSON.parse(out), { dataDir: "demo/packrat-shots-x", rules: "pack-rat/app/rules/uoalive.json", win: "demo\\packrat-shots-y" });
  assert.deepEqual(demoLeaks(out), []);
});

test("[fast] site-demo: a machine path, the machine's user name or a character not in the demo fails the recording", () => {
  assert.equal(demoLeaks(JSON.stringify({ path: "/Users/example/x" })).length, 1);
  assert.equal(demoLeaks(JSON.stringify({ path: "/home/example/x" })).length, 1);
  assert.equal(demoLeaks(JSON.stringify({ path: "C:\\Users\\example\\x" })).length, 1);
  assert.equal(demoLeaks(JSON.stringify({ path: "/var/folders/ab/T/x" })).length, 1);
  assert.equal(demoLeaks(JSON.stringify({ path: "/tmp/packrat-shots-x" })).length, 1);
  assert.deepEqual(demoLeaks(JSON.stringify({ note: "made by someuser" }), { user: "someuser" }), ["the user name of the machine that recorded it"]);
  assert.deepEqual(demoLeaks(JSON.stringify({ items: [{ character: "Dorran" }, { scannedBy: "Kestrel" }, { equippedBy: "Bob" }] })), ["a character not in the demo: Bob"]);
  assert.deepEqual(DEMO_CHARACTERS, ["Dorran", "Kestrel"]);
});

test("[fast] site-demo: the app's index.html loads the shim first, with every URL relative to the demo's folder", () => {
  const html = demoIndex(readFileSync(join(ROOT, "app", "index.html"), "utf8"));
  assert.ok(html.indexOf('src="shim.mjs"') < html.indexOf('src="ui/app.mjs"'), "the shim before the app");
  assert.doesNotMatch(html, /(href|src)="\/(?!\/)/, "no root-relative URL left");
  assert.throws(() => demoIndex("<html></html>"), /no longer loads ui\/app\.mjs/);
});

test("[fast] site-demo: framed, the app's focus() keeps the page still and scrollIntoView() does nothing until the visitor's own click or key press", () => {
  const calls: string[] = [];
  class Element { scrollIntoView(): void { calls.push("scroll"); } }
  class HTMLElement extends Element { focus(options?: { preventScroll?: boolean }): void { calls.push(`focus preventScroll=${options?.preventScroll ?? false}`); } }
  const listeners = new Map<string, (e: { isTrusted: boolean }) => void>();
  const win = {
    HTMLElement, Element,
    addEventListener: (type: string, fn: (e: { isTrusted: boolean }) => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  holdScroll(win);
  const el = new HTMLElement();
  el.focus(); el.scrollIntoView();
  assert.deepEqual(calls.splice(0), ["focus preventScroll=true"], "held: no scroll of any kind");
  listeners.get("pointerdown")!({ isTrusted: false });
  el.focus(); el.scrollIntoView();
  assert.deepEqual(calls.splice(0), ["focus preventScroll=true"], "a scripted click is not the visitor");
  listeners.get("keydown")!({ isTrusted: true });
  el.focus(); el.scrollIntoView();
  assert.deepEqual(calls.splice(0), ["focus preventScroll=false", "scroll"], "the visitor's key press hands both back");
  assert.equal(listeners.size, 0, "and stops listening");
});
