// ui/events.mts — the one shared EventSource("/api/events") for the page's life (Task 3, Phase 4).
// A non-demo server watches each adapter's inbox (app/watcher.mts) and broadcasts every scan it
// accepts or rejects to every connected browser tab; this module is the page's one listener for
// that stream, so a scan dropped in game shows up here without the user ever touching the reload
// button. EventSource reconnects on its own (the browser's default behaviour) — no retry logic needed.
import { toast } from "./dom.mts";
import { reload } from "./app.mts";
import { loadRuns } from "./runs.mts";
import type { InventoryEvent, RejectedEvent, ChangedEvent } from "./api-types.mts";

let source: EventSource | null = null;

// A burst of scans (the scanner writing several characters in one session, or a folder import
// landing several files at once) fires one "inventory" event per file — each toasts immediately,
// but the underlying reload() is coalesced: a 400ms debounce so a burst settles into one reload
// rather than one per event, plus an in-flight guard so an event that arrives WHILE a reload is
// already running never starts a second overlapping one (whose response could resolve before the
// first's and leave state.inv/state.profiles a scan stale) — it just remembers to run exactly one
// more reload once the current one finishes.
const RELOAD_DEBOUNCE_MS = 400;
// `number`, not `ReturnType<typeof setTimeout>` — see dom.mts's identical toastTimer for why: this
// file only runs in the browser, but tsconfig.json's root config also type-checks it alongside
// Node's ambient globals, which makes `typeof setTimeout` ambiguous between the two configs.
let reloadTimer: number | null = null;
let reloadInFlight = false;
let reloadPending = false;

function scheduleReload(): void {
  // Both casts are compiler-only, same reasoning as dom.mts's toastTimer: clearTimeout accepts (and
  // no-ops on) null exactly like undefined, and setTimeout's return goes through `unknown` because a
  // direct `as number` fails under whichever config resolves it to Node's Timeout.
  clearTimeout(reloadTimer as number | undefined);
  reloadTimer = setTimeout(runReload, RELOAD_DEBOUNCE_MS) as unknown as number;
}
async function runReload(): Promise<void> {
  if (reloadInFlight) { reloadPending = true; return; }
  reloadInFlight = true;
  try { await reload(); }
  catch (err) { toast((err as Error).message, "bad"); }
  finally {
    reloadInFlight = false;
    if (reloadPending) { reloadPending = false; runReload(); }   // one more, not one per event queued while busy
  }
}

// Idempotent: a second call (e.g. a stray re-invocation from a future code path) must not open a
// second connection and double-fire every toast/reload.
export function connectEvents(): EventSource {
  if (source) return source;
  source = new EventSource("/api/events");
  // "inventory"/"rejected" are custom SSE event names (vault-server.mts's broadcastEvent), not one of
  // EventSource's own known listener types — the browser still delivers them as MessageEvent (SSE's
  // own wire format), just not something addEventListener's overloads can infer from the name alone.
  source.addEventListener("inventory", (e: MessageEvent<string>) => {
    const data = parse(e.data) as Partial<InventoryEvent>;
    toast(`Scan from ${data.character || "?"} landed`);   // toasts fire per event, unlike the reload itself
    scheduleReload();
  });
  source.addEventListener("rejected", (e: MessageEvent<string>) => {
    const data = parse(e.data) as Partial<RejectedEvent>;
    toast(`${data.file || "a scan"} was rejected: ${data.reason || "unknown reason"}`, "bad");
  });
  source.addEventListener("changed", (e: MessageEvent<string>) => {
    const data = parse(e.data) as Partial<ChangedEvent>;
    if (data.what === "inventory") scheduleReload();
    else if (data.what === "runs") void loadRuns();
  });
  return source;
}

// The SSE payload is untrusted the same way any network response is — parse() itself returns
// `unknown`, exactly like api.mts's own `api()`; each listener above casts to the event shape it
// expects (api-types.mts), the one place that shape is named.
function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return {}; }
}
