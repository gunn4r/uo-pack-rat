// shim.mjs — the website's live demo: the real Pack Rat page (built by `npm run site:demo`, scripts/site-demo.mts) running on a static site with no server behind it.
//
// It loads before the app and answers the page's /api/* calls from demo-data.json, the demo characters' responses recorded off a real server when the site was built. A request recorded as it is gets its recording; item searches run the app's own search (item-query.mjs) over every recorded item; a write succeeds and changes nothing; anything else answers 404. The live-update stream stays quiet, except a Suit Builder job's, which replays the one recorded build. Item art and the paperdoll come from the player's own game client, which the website doesn't have: their requests fail as they would with no client set up, and the paperdoll card says so plainly. The host page picks the look, and `embed` keeps the app from scrolling it: index.html?theme=britannia&appearance=dark&embed#/inventory.
import { parseItemQuery, applyItemQuery, hitRow } from "./item-query.mjs";
import { holdScroll } from "./hold-scroll.mjs";

const look = new URLSearchParams(location.search);

// Framed in the website (?embed): the app may not scroll the page around it until the visitor uses it.
if (look.has("embed")) holdScroll(window);

const realFetch = window.fetch.bind(window);
// The override goes in synchronously: the app's module doesn't wait for this one, so every answer waits for the recording.
let rec = {};
const ready = realFetch("demo-data.json").then((r) => r.json()).then((data) => {
  rec = data;
  rec["GET /api/ui-prefs"] = { ok: true, prefs: { theme: look.get("theme") || "default", appearance: look.get("appearance") || "light" } };
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const where = () => ({ rarity: rec["GET /api/rules"]?.rarity || [], containers: rec["GET /api/inventory"]?.containers || {} });

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  await ready;
  const method = (init.method || input.method || "GET").toUpperCase();
  const key = `${method} ${url.pathname}${url.search}`;
  if (rec[key]) return json(rec[key]);
  if (method !== "GET") return json({ ok: true });
  const items = rec.items || [];
  if (url.pathname === "/api/items" && url.searchParams.get("fields") === "hits") {
    const out = applyItemQuery(items, { ...parseItemQuery(url.searchParams), offset: 0, limit: 10000 }, where());
    return json({ ok: true, total: out.total, rows: (out.rows || []).map(hitRow) });
  }
  if (url.pathname === "/api/items" && !url.searchParams.has("fields") && !url.searchParams.has("within")) {
    const q = parseItemQuery(url.searchParams);
    return json({ ok: true, offset: q.offset || 0, limit: q.limit || 500, ...applyItemQuery(items, q, where()) });
  }
  if (url.pathname === "/api/items/by-serial") {
    const want = new Set((url.searchParams.get("serials") || "").split(",").map(Number));
    return json({ ok: true, items: Object.fromEntries(items.filter((it) => want.has(it.serial)).map((it) => [it.serial, it])) });
  }
  return json({ ok: false, error: "Not available in the website demo" }, 404);
};

// Nothing leaves the page: a beacon reports sent and goes nowhere.
navigator.sendBeacon = () => true;
// Item art comes from the player's own client: an empty source fails at once, with no request, and the app drops the
// icon and asks no more.
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) { setAttribute.call(this, name, name === "src" && String(value).startsWith("/api/item-art/") ? "data:," : value); };

// The live-update stream: open and quiet. A Suit Builder job's replays the recorded build: a progress packet, then the
// finished job ("hello" in its done state), so Build always ends on the same proven suit.
window.EventSource = class {
  constructor(url) {
    this.readyState = 1;
    this.listeners = {};
    if (String(url).includes("/api/optimize/")) ready.then(() => {
      const done = rec.build;
      if (!done) return;
      setTimeout(() => this.emit("progress", done.progress), 400);
      setTimeout(() => this.emit("hello", done), 1600);
    });
  }
  emit(type, data) { if (this.readyState !== 2 && data) for (const fn of this.listeners[type] || []) fn(new MessageEvent(type, { data: JSON.stringify(data) })); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  close() { this.readyState = 2; }
};
window.EventSource.CLOSED = 2;

// In place of the paperdoll card's "couldn't be drawn" warning, a quiet line says where the figure comes from.
const style = document.createElement("style");
style.textContent = `.doll-empty > * { display: none !important; }
.doll-empty::after { content: "Your character's paperdoll is drawn here from your own Ultima Online client."; display: block; margin: 3rem 2rem; text-align: center; font-size: 13px; line-height: 1.5; opacity: .7; }`;
document.head.append(style);
