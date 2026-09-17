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
// Which bridge actions to offer: the selected builder character's own adapter.capabilities.bridge
// list when one is selected (e.g. the Suit Builder tab), else the union of every known character's
// adapter capabilities (the Inventory tab, where no single character is in context and a button
// should show if ANY adapter on file could serve it — the server/script still refuses per-character).
function allowedBridgeActions() {
  const char = state.builder.character;
  const own = char && state.inv?.characters?.[char]?.adapter?.capabilities?.bridge;
  if (own) return own;
  const all = new Set();
  for (const c of Object.values(state.inv?.characters || {})) for (const a of c?.adapter?.capabilities?.bridge || []) all.add(a);
  return [...all];
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
export function grabAllRow(items) {
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
