// ui/bridge.mjs — Highlight / Grab / Go-to buttons and the packrat-bridge.py connection
// status. Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page
// split).
import { state, bridge } from "./store.mjs";
import { $, el, toast } from "./dom.mjs";
import { api } from "./api.mjs";

// ---------------------------------------------------------------- bridge (Highlight / Grab / Go to)
export function chainOf(it) {
  const chain = []; let cur = it.container != null ? state.inv.containers[it.container] : null, guard = 0;
  while (cur && guard++ < 8) { chain.unshift(+cur.serial); cur = cur.parent != null ? state.inv.containers[cur.parent] : null; }
  return chain;
}
export const BRIDGE_OFFLINE = "Bridge is offline — press Play on packrat-bridge.py in game first.";
export const rootPos = (it) => (it.root != null ? state.inv.containers[it.root] : null)?.pos || null;
// Queue one command for an item; the status poll toasts its result once packrat-bridge.py reports it.
export async function sendBridge(action, it) {
  try {
    // name is required by BRIDGE_SCHEMA.command — it.name should always be set, but a falsy/missing
    // one used to serialize away entirely (JSON.stringify drops an undefined property), which the
    // server now rejects with a 400 instead of silently queuing a contract-violating line.
    const r = await api("/api/bridge", { method: "POST", body: { action, serial: it.serial, name: it.name || "?", chain: chainOf(it), pos: rootPos(it), location: it.location?.text } });
    if (r.ok) bridge.pending.set(r.id, it.name);
    return r;
  } catch (e) { return { ok: false, error: e.message }; }
}
// Which bridge actions the page may offer, full stop: the currently configured client's own
// capabilities.bridge list, read from GET /api/setup's {settings.client, adapters} (cached in
// state.setup by app.mjs's load(), refreshed whenever the Settings tab or the wizard changes it).
// Not per-character: only one client is ever physically running the bridge at a time (a player logs
// into one game client and runs one adapter's packrat-bridge.py, or none), so "what can the bridge do
// right now" is a single global fact, not something that varies row to row. Earlier this read each
// item's own scanning character's adapter (falling back to a union across every scanned character on
// the Inventory tab) — that let a bridge-less character's rows still show buttons whenever ANY OTHER
// scanned character's adapter had one, which is exactly the "page assumes every client is TazUO"
// (or, worse, "assumes the union of every client ever used") bug this task exists to fix.
// settings.client being unset is NOT a reliable "no working bridge" signal — this comment used to
// claim POST /api/setup/install is the only thing that ever writes settings.client, so an unset
// client implied nothing was installed. That's false on two counts (Phase 6 final review, Important
// 2): every adapter's README documents copying the scripts in BY HAND as a normal install path (no
// call through the wizard's install step at all, so settings.client never gets written even though
// the scripts are in place and running), and the wizard's own Skip button leaves settings.client
// unset on purpose (skipping means "I didn't finish setup," not "no client exists"). A player who
// installed by hand, or skipped the wizard after installing another way, has a real, working
// packrat-bridge.py running — but currentAdapter() below still returns null for them, so every
// Highlight/Grab/Go-to button disappears with no way to get them back short of running the wizard's
// install step for real. That's a genuine gap, not a documented tradeoff, and it isn't fixed here.
//
// A later fix (Phase 6 final review follow-up) made GET/POST /api/bridge themselves adapter-aware —
// app/config.mjs's `paths.bridgeFor(adapter)` replaced the single hard-coded `<dataDir>/bridge/tazuo/`
// path (docs/bridge-protocol.md updated to match), and the server now reads/writes whichever
// adapter's directory `settings.client.adapter` names, falling back to "tazuo" only when no client is
// configured at all. That fixes the SERVER side for anyone whose configured client's bridge is
// actually running, including the common hand-installed-TazUO case (their bridge really does write to
// bridge/tazuo/, which is exactly what the unconfigured fallback now points at). It does NOT fix the
// gap this comment describes: currentAdapter() below still can't show buttons for a client with no
// settings.client at all, because it has no way to know WHICH adapter's capabilities.bridge list to
// render buttons from — the server routing and the button-visibility gate are two different problems,
// and only the first one has a general fix today.
export function currentAdapter() {
  const client = state.setup?.settings?.client;
  if (!client) return null;
  return state.setup?.adapters?.find((a) => a.id === client.adapter) || null;
}
function allowedBridgeActions() {
  return currentAdapter()?.capabilities?.bridge || [];
}
const ALL_BRIDGE_ACTIONS = ["highlight", "grab", "goto"];
// The button labels actButtons() itself uses (see below) — the note names actions the same way the
// missing buttons would have read, not the raw capability strings ("goto" reads as "Go to" in here,
// same as the button that isn't there).
const ACTION_LABELS = { highlight: "Highlight", grab: "Grab", goto: "Go to" };
// One short line explaining why the bridge controls are missing or limited — null once every KNOWN
// action is present (today, that's exactly TazUO's set, so a TazUO player sees nothing new here).
// Post-review fix: this used to compare allowed.length against ALL_BRIDGE_ACTIONS.length, so an
// adapter declaring three actions that aren't exactly highlight/grab/goto (a typo, or some future
// action name this build doesn't know) satisfied the count and silently suppressed the note while
// actButtons()'s own .includes() checks still correctly filtered every button out — exactly the
// silently-missing-button bug this task exists to remove, reappearing on malformed adapter data.
// A set-membership check can't be fooled that way; an unrecognized action name is simply never
// "present" for this purpose (the app has no button for it either, so nothing about it belongs in
// the "supports" half of the message — see `known` below). Callers place this once per panel, never
// per row: repeating it on every item would be far noisier than the silently-missing button it
// replaces.
export function bridgeNote() {
  const client = state.setup?.settings?.client;
  if (!client) return "No client set up yet — visit Settings to install one that supports in-game actions like Highlight/Grab/Go to.";
  const adapter = currentAdapter();
  const allowedSet = new Set(adapter?.capabilities?.bridge || []);
  if (ALL_BRIDGE_ACTIONS.every((a) => allowedSet.has(a))) return null;
  const name = adapter?.name || client.adapter;
  const known = ALL_BRIDGE_ACTIONS.filter((a) => allowedSet.has(a));
  const missing = ALL_BRIDGE_ACTIONS.filter((a) => !allowedSet.has(a));
  if (!known.length) return `${name} can't run in-game actions — Highlight, Grab and Go to aren't available for this client.`;
  return `${name} only supports ${known.map((a) => ACTION_LABELS[a]).join(", ")} here — ${missing.map((a) => ACTION_LABELS[a]).join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} available for this client.`;
}
// The note as a ready-to-insert element, or null when there's nothing to say (keeps callers from
// repeating the `bridgeNote() ? el(...) : null` conditional at every call site).
export function bridgeNoteEl() {
  const msg = bridgeNote();
  return msg ? el("div", { class: "msg warn bridge-note" }, msg) : null;
}
export function actButtons(it) {
  if (!it || it.equippedBy) return null;
  const allowed = allowedBridgeActions();
  const send = (action) => async (e) => {
    e.stopPropagation();
    if (!bridge.online) { toast(BRIDGE_OFFLINE, "bad"); return; }
    const r = await sendBridge(action, it);
    toast(r.ok ? `${action}: ${it.name} queued for ${bridge.character}` : r.error, r.ok ? "" : "bad");
  };
  const btns = [
    allowed.includes("highlight") ? el("button", { onclick: send("highlight"), title: "flash the item in game and mark its chest" }, "Highlight") : null,
    allowed.includes("grab") ? el("button", { onclick: send("grab"), title: "move it to the backpack" }, "Grab") : null,
    allowed.includes("goto") && rootPos(it) ? el("button", { onclick: send("goto"), title: "walk to the chest" }, "Go to") : null,
  ].filter(Boolean);
  return btns.length ? el("span", { class: "act" }, ...btns) : null;
}
// Grab all: one Grab per fetch-list piece, sent one after another (300 ms apart, stopping at the first refusal).
// Pieces already in this character's backpack, or worn by anyone, are left out; each result toasts like a single Grab.
// Returns null (nothing to render at all — the panel that calls this shows bridgeNoteEl() instead)
// when the current client's adapter has no "grab" action.
export function grabAllRow(items) {
  if (!allowedBridgeActions().includes("grab")) return null;
  const me = state.builder.character;
  const todo = items.filter((i) => !i.equippedBy && !(i.location.kind === "backpack" && i.location.character === me));
  const status = el("span", { class: "small muted" }, todo.length < items.length ? `${items.length - todo.length} already with ${me} or worn` : "");
  const btn = el("button", { id: "b-grab-all", "data-count": todo.length, onclick: async () => {
    if (!bridge.online) { toast(BRIDGE_OFFLINE, "bad"); return; }
    if (bridge.character !== me && !confirm(`The bridge is running on ${bridge.character}, not ${me}: the pieces would land in ${bridge.character}'s backpack. Grab them anyway?`)) return;
    btn.dataset.busy = "1"; btn.disabled = true;
    let sent = 0, stopped = null;
    for (const it of todo) {
      status.textContent = `Grabbing ${sent + 1}/${todo.length}: ${it.name}…`;
      const r = await sendBridge("grab", it);
      if (!r.ok) { stopped = `${it.name}: ${r.error}`; break; }
      sent++;
      if (sent < todo.length) await new Promise((res) => setTimeout(res, 300));
    }
    status.textContent = stopped ? `${sent}/${todo.length} queued, stopped at ${stopped}` : `${sent} grab${sent === 1 ? "" : "s"} queued for ${bridge.character}`;
    toast(status.textContent, stopped ? "bad" : "");
    delete btn.dataset.busy; grabAllState();
  } }, `Grab all (${todo.length})`);
  grabAllState(btn);
  return el("span", { class: "row" }, btn, status);
}
// Enabled only while the bridge is online and something is left to grab; the title says why otherwise.
export function grabAllState(btn = $("#b-grab-all")) {
  if (!btn || btn.dataset.busy) return;
  const count = +btn.dataset.count;
  btn.disabled = !bridge.online || !count;
  btn.title = !bridge.online ? BRIDGE_OFFLINE : !count ? `nothing to grab: every piece is already with ${state.builder.character} or worn` : "queue a Grab for every piece on the fetch list, one after another";
}
export async function pollBridge() {
  try {
    const st = await api("/api/bridge/status");
    bridge.online = !!st.online; bridge.character = st.character || null;
    const b = $("#bridge");
    if (!st.online) { b.className = "status"; b.textContent = "bridge: offline"; }
    else if (st.current) { b.className = "status busy"; b.textContent = `bridge: ${st.character} · ${st.current.action} ${st.current.name || ""}`; }
    else { b.className = "status on"; b.textContent = `bridge: ${st.character} ready`; }
    grabAllState();
    for (const [id, r] of Object.entries(st.results || {})) {
      if (bridge.pending.has(id) && !bridge.seen.has(id)) { bridge.seen.add(id); bridge.pending.delete(id); toast(r.msg, r.ok ? "good" : "bad"); }
    }
  } catch { /* server down; leave the pill as is */ }
}
