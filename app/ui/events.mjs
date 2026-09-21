// ui/events.mjs — the one shared EventSource("/api/events") for the page's life (Task 3, Phase 4).
// A non-demo server watches each adapter's inbox (app/watcher.mts) and broadcasts every scan it
// accepts or rejects to every connected browser tab; this module is the page's one listener for
// that stream, so a scan dropped in game shows up here without the user ever touching the reload
// button. EventSource reconnects on its own (the browser's default behaviour) — no retry logic needed.
import { toast } from "./dom.mjs";
import { reload } from "./app.mjs";

let source = null;

// A burst of scans (the scanner writing several characters in one session, or a folder import
// landing several files at once) fires one "inventory" event per file — each toasts immediately,
// but the underlying reload() is coalesced: a 400ms debounce so a burst settles into one reload
// rather than one per event, plus an in-flight guard so an event that arrives WHILE a reload is
// already running never starts a second overlapping one (whose response could resolve before the
// first's and leave state.inv/state.profiles a scan stale) — it just remembers to run exactly one
// more reload once the current one finishes.
const RELOAD_DEBOUNCE_MS = 400;
let reloadTimer = null;
let reloadInFlight = false;
let reloadPending = false;

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(runReload, RELOAD_DEBOUNCE_MS);
}
async function runReload() {
  if (reloadInFlight) { reloadPending = true; return; }
  reloadInFlight = true;
  try { await reload(); }
  catch (err) { toast(err.message, "bad"); }
  finally {
    reloadInFlight = false;
    if (reloadPending) { reloadPending = false; runReload(); }   // one more, not one per event queued while busy
  }
}

// Idempotent: a second call (e.g. a stray re-invocation from a future code path) must not open a
// second connection and double-fire every toast/reload.
export function connectEvents() {
  if (source) return source;
  source = new EventSource("/api/events");
  source.addEventListener("inventory", (e) => {
    const data = parse(e.data);
    toast(`Scan from ${data.character || "?"} landed`);   // toasts fire per event, unlike the reload itself
    scheduleReload();
  });
  source.addEventListener("rejected", (e) => {
    const data = parse(e.data);
    toast(`${data.file || "a scan"} was rejected: ${data.reason || "unknown reason"}`, "bad");
  });
  return source;
}

function parse(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}
