// ui/move-to.mts — the Inventory's selection and Move to (issue #270): the checkboxes' hooks for the item browser, the selection bar (#inv-selbar: the count, why worn rows were left out, Select all matching, Grab, Move to… and Clear), the Move to… picker, and the result line (#inv-move-result) that follows a Move's trips, with Stop, Pin them here and Move back. The rules and every word come from ui/move-model.mts; this file draws them and talks to the server (POST /api/move/plan, /api/move/trip, /api/bridge/stop). A Move runs as Organize trips, one at a time: each trip that reports back clean asks the server for the next. Another view can start a Move with its own selection and result line (`openPicker`, `startMove`): the Unravel view's Gather into a bag (issue #271).
//
// map: ui-screens
// owns: `selectionHooks`, `attachMoveTo`
import { applyItemQuery } from "../item-query.mts";
import { bagLabel, type Container, type Item } from "../vault-lib.mts";
import { state, bridge } from "./store.mts";
import { $, el } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, meter, searchInput, openDialog, nextId, tipWrap, toast } from "./components.mts";
import { errorText } from "./messages.mts";

import { houseIds, houseOfContainer } from "./house-links.mts";
import { bridgeFeatureSet, currentAdapter, grabAll, BRIDGE_OFFLINE } from "./bridge.mts";
import { tripGate, stepWatch, failedSteps, pinnedWith, type TripWatch } from "./organize-model.mts";
import { loadOrganize, saveConfig } from "./organize-data.mts";
import { emptySelection, isSelected, isWorn, selectedCount, toggleRows, toggleLoaded, loadedState, selectAllMatching, selectionBody, grabItems, destGroups, matchesDest, roomText, leftText, pickedText,
  selectedText, wornNote, loadedNote, allOffer, allNote, movingText, movedText, gatheredText, GATHER_NOTE, againstText, pinnedText, skippedText, noRoomText, GRAB_TOO_MANY, WORN_LOCK, OUTSIDE, type Matches, type Selection, type DestRow } from "./move-model.mts";
import type { ItemBrowser, SelectionHooks } from "./item-browser.mts";
import type { BridgeStatusApiResponse, MoveBackApiResponse, MovePlanApiResponse, MovePlanSummary, MoveTripApiResponse } from "./api-types.mts";
import { plural } from "./format.mts";

let browser: ItemBrowser | null = null;
let sel: Selection = emptySelection();
let note: string | null = null;
// The query a shift-click's anchor was set under: after a filter change the row indexes mean other rows, so a shift-click starts afresh.
let anchorQuery: unknown = null;
let matchesAll: Matches = () => false;
const matches: Matches = (it) => matchesAll(it);
const rows = (): ReadonlyArray<Item | undefined> => browser?.page.groups ? [] : browser?.page.rows ?? [];

export const selectionHooks: SelectionHooks = {
  checked: (it) => isSelected(sel, it, matches),
  locked: (it) => (isWorn(it) ? WORN_LOCK : null),
  toggle: (index, on, shift) => {
    const r = toggleRows(sel, rows(), index, on, shift && anchorQuery === browser?.query, matches);
    anchorQuery = browser?.query ?? null;
    change(r.sel, wornNote(r.worn));
  },
  header: () => loadedState(sel, rows(), matches),
  toggleLoaded: (on) => { const r = toggleLoaded(sel, rows(), on, matches); change(r.sel, wornNote(r.worn)); },
};
export function attachMoveTo(b: ItemBrowser): void {
  browser = b;
  paintBar();
}
function change(next: Selection, why: string | null): void {
  sel = next;
  note = why;
  if (!sel.all) matchesAll = () => false;
  browser?.markPicked();
  paintBar();
}
function clearSelection(): void { change({ ...emptySelection() }, null); }
// A reload (a scan, a trip that reported back) redraws the bar and asks again whether Move back can still run.
document.addEventListener("inventorychange", () => { paintBar(); if (run?.done) void checkBack(run); });

// ---------------------------------------------------------------- the selection bar
const bar = (): HTMLElement => $<HTMLElement>("#inv-selbar")!;
function paintBar(): void {
  const b = bar();
  if (!b || !browser) return;
  const n = selectedCount(sel);
  b.hidden = !n && !note;
  if (b.hidden) { b.replaceChildren(); return; }
  const loaded = rows().filter((it): it is Item => !!it && !isWorn(it)).length, total = browser.page.total;
  const offer = !sel.all && n && loadedState(sel, rows(), matches) === "all" && rows().filter(Boolean).length < total
    ? box("span", { class: "mv-offer" }, txt(loadedNote(loaded)), button({ label: allOffer(total), variant: "ghost", size: "sm", attrs: { id: "mv-select-all" }, onClick: () => { void selectAll(); } }))
    : sel.all ? txt(allNote(sel.all.count - sel.except.size), "mv-offer") : null;
  const grab = grabItems(sel);
  const grabBtn = button({ label: "Grab", size: "sm", disabled: !n || !grab, attrs: { id: "mv-grab" }, onClick: () => { void grabSelected(); } });
  b.replaceChildren(
    box("div", { class: "mv-what" }, txt(n ? selectedText(n) : "Nothing selected", "strong mv-count"), note ? txt(note, "t-sm muted mv-note") : null, offer),
    box("div", { class: "mv-acts" }, n && !grab ? tipWrap(grabBtn, GRAB_TOO_MANY) : grabBtn,
      button({ label: "Move to…", variant: "primary", size: "sm", disabled: !n, attrs: { id: "mv-move" }, onClick: () => { void openPicker({ selection: selectionBody(sel), host: "inv-move-result", onRun: clearSelection }); } }),
      button({ label: "Clear", size: "sm", attrs: { id: "mv-clear" }, onClick: clearSelection })));
}
// "Select all N matching": the filter as the table has it now, counted by the server (worn items left out) without loading its rows.
async function selectAll(): Promise<void> {
  if (!browser) return;
  const query = browser.query;
  let r: MovePlanApiResponse;
  try { r = await api<MovePlanApiResponse>("/api/move/plan", { method: "POST", body: { selection: selectionBody({ ...emptySelection(), all: { query, count: 0, worn: 0 } }) } }); }
  catch (e) { toast(errorText(e), "bad"); return; }
  const q = { ...query, group: false, offset: 0, limit: 1 }, rarity = state.rules?.rarity || [];
  const houseOf = houseIds();
  matchesAll = (it) => applyItemQuery([it], q, { rarity, places: state.organize.places, houseOf, containers: state.inv?.containers ?? {} }).total === 1;
  change(selectAllMatching(sel, query, r.selected - r.worn, r.worn, matches), wornNote(r.wornNames.slice(0, r.worn === 1 ? 1 : 0), r.worn));
}
async function grabSelected(): Promise<void> {
  const items = grabItems(sel);
  if (!items) return;
  if (!bridge.online) { toast(BRIDGE_OFFLINE, "bad"); return; }
  await grabAll(items, bridge.character || "");
  clearSelection();
}

// ---------------------------------------------------------------- the picker
const nameOf = (c: Container): string => state.organize.config?.labels[String(c.serial)]?.name ?? c.label ?? bagLabel(c);
export const placeOf = (serial: number): string => {
  const c = state.inv?.containers[serial];
  if (!c) return `0x${serial.toString(16)}`;
  const house = houseOfContainer(+c.root)?.name;
  return house && house !== OUTSIDE ? `${nameOf(c)} · ${house}` : nameOf(c);
};
// Why no trip can run now (no client that runs trips, the bridge offline, a Move running), or null.
export const gate = (): string | null => {
  const a = currentAdapter();
  return tripGate({ client: a ? a.name || a.id : null, canTrip: bridgeFeatureSet().has("trip"), online: bridge.online, running: !!run && !run.done }, BRIDGE_OFFLINE);
};
// Where a Move is started and its result line drawn: the Inventory's Items view, or another view handing over its own selection
// (the Unravel view's Gather into a bag, issue #271). `gather` words the result line for a bag to unravel; `onRun` is told the
// container the Move goes to, once it starts.
export interface MoveFrom { selection: ReturnType<typeof selectionBody>; host: string; gather?: boolean | undefined; onRun?: ((to: number) => void) | undefined }
export function openPicker(from: MoveFrom): Promise<void> { return pickAndMove(from); }
async function pickAndMove({ selection, host, gather, onRun }: MoveFrom): Promise<void> {
  let counted: MovePlanApiResponse;
  try { counted = await api<MovePlanApiResponse>("/api/move/plan", { method: "POST", body: { selection } }); }
  catch (e) { toast(errorText(e), "bad"); return; }
  // The room lines count only what a trip can take (never worn, packed or a bag); the picked container's sentence is the exact plan.
  const need = counted.movable;
  const groups = destGroups(state.inv?.containers || {}, (root) => houseOfContainer(root)?.name ?? null, nameOf, state.organize.blacklist);
  const find = searchInput({ label: "Search containers and houses", placeholder: "Search containers and houses", attrs: { id: "mv-q" } });
  const list = box("div", { class: "mv-list", id: "mv-list", role: "radiogroup", "aria-label": "Containers" });
  const msg = txt("", "t-sm mv-msg");
  msg.id = nextId("mv-msg");
  const go = button({ label: "Move", variant: "primary", disabled: true, attrs: { id: "mv-go" } });
  let picked: DestRow | null = null, plan: MovePlanSummary | null = null, asked = 0;
  const radioName = nextId("mv-dest");
  const draw = (): void => {
    const q = find.input.value;
    const kids: HTMLElement[] = [];
    for (const g of groups) {
      const shown = g.rows.filter((r) => matchesDest(r, g.title, q));
      if (!shown.length) continue;
      kids.push(txt(g.title, "caps mv-group"));
      for (const r of shown) {
        const here = counted.here[r.serial] ?? 0, room = roomText(r.fill, need, here), full = room.text === "Full";
        const radio = el("input", { type: "radio", name: radioName, value: r.serial, ...(full ? { disabled: "" } : {}) });
        radio.checked = picked?.serial === r.serial;
        radio.addEventListener("change", () => { void pick(r); });
        kids.push(box("label", { class: `mv-dest${picked?.serial === r.serial ? " on" : ""}${full ? " off" : ""}`, "data-serial": r.serial }, radio,
          box("span", { class: "mv-dest-name" }, txt(r.name, "ellip"), txt(r.sub, "t-sm muted ellip")),
          box("span", { class: "mv-fill" }, txt(`${r.fill.items.toLocaleString("en-US")}/${r.fill.max.toLocaleString("en-US")} items`, "t-sm"), box("span", { class: "mv-meter" }, meter(r.fill.items, r.fill.max, { tone: r.fill.items / r.fill.max >= 0.9 ? "warn" : undefined, label: `${r.name} fill` })),
            txt(room.text, `t-sm ${room.short ? "mv-short" : "muted"}`))));
      }
    }
    list.replaceChildren(...(kids.length ? kids : [txt(groups.length ? `No container matches “${q}”.` : "No container on the ground has a known fill. Scan your house first.", "t-sm muted")]));
  };
  const foot = (): void => {
    const why = gate();
    if (!picked) { msg.textContent = "Pick a container. Full ones can't be picked."; msg.className = "t-sm muted mv-msg"; go.disabled = true; go.textContent = "Move"; return; }
    if (!plan) { msg.textContent = "Checking…"; msg.className = "t-sm muted mv-msg"; go.disabled = true; return; }
    const p = pickedText(picked.name, plan, picked.fill), left = leftText(plan.left, counted.worn);
    msg.textContent = [p.text, left, why].filter(Boolean).join(" ");
    msg.className = `t-sm mv-msg${p.short || why ? " mv-short" : ""}`;
    go.textContent = p.button ?? "Move";
    go.disabled = !p.button || !!why;
  };
  const pick = async (r: DestRow): Promise<void> => {
    picked = r; plan = null;
    draw(); foot();
    const n = ++asked;
    let res: MovePlanApiResponse;
    try { res = await api<MovePlanApiResponse>("/api/move/plan", { method: "POST", body: { selection, to: r.serial } }); }
    catch (e) { if (n === asked) { msg.textContent = errorText(e); msg.className = "t-sm mv-msg mv-short"; } return; }
    if (n !== asked) return;
    if (res.problem || !res.plan) { msg.textContent = `${r.name}: ${res.problem ?? "it cannot be filled"}.`; msg.className = "t-sm mv-msg mv-short"; return; }
    plan = res.plan;
    foot();
  };
  find.input.addEventListener("input", draw);
  draw(); foot();
  const cancel = button({ label: "Cancel", attrs: { id: "mv-cancel" }, onClick: () => d.close() });
  const d = openDialog({ title: `Move ${plural(need, "item")} to…`, width: "md", cls: "mv-picker", describedBy: msg.id, body: [box("div", { class: "mv-pick" }, find.root, list, msg)], actions: [cancel, go], initialFocus: find.input });
  go.addEventListener("click", () => {
    if (!picked || !plan || go.disabled) return;
    d.close();
    startMove({ selection, host, gather, onRun }, picked.serial, plan);
  });
}
// A Move into `to` as `plan` showed it: the run moves exactly the items that plan listed, so a scan landing mid-run adds
// nothing the player did not confirm. The Unravel view calls it for the bag it remembers, the picker for the one picked.
export function startMove({ host, gather, onRun }: MoveFrom, to: number, plan: MovePlanSummary): void {
  onRun?.(to);
  void startRun({ kind: "to", dest: placeOf(to), body: { selection: { serials: plan.serials }, to }, total: plan.moving, noRoom: plan.noRoom, against: plan.against, host, gather: !!gather });
}

// ---------------------------------------------------------------- running a Move
interface Run {
  kind: "to" | "back";
  host: string;            // the result line's element id
  gather: boolean;         // a bag to unravel (issue #271): the result line says what to do with it
  dest: string;
  body: Record<string, unknown>;
  total: number;
  noRoom: number;
  noRoomNames: string[];
  against: MovePlanSummary["against"];
  moved: number[];
  failed: Array<{ name: string; msg: string }>;
  trips: string[];
  names: Map<number, string>;
  watch: TripWatch | null;
  stopping: boolean;
  stopped: boolean;
  done: boolean;
  lost: string | null;
  skipped: string[];
  pinned: boolean;
  canBack: boolean;
}
let run: Run | null = null;
let lastStatus: BridgeStatusApiResponse | null = null, lastStatusAt = 0;
async function startRun(r: Pick<Run, "kind" | "dest" | "body" | "total" | "noRoom" | "against" | "host" | "gather">): Promise<void> {
  if (run && run.host !== r.host) { const old = $<HTMLElement>(`#${run.host}`); if (old) { old.hidden = true; old.replaceChildren(); } }
  run = { ...r, moved: [], failed: [], trips: [], names: new Map(), watch: null, stopping: false, stopped: false, done: false, lost: null, skipped: [], noRoomNames: [], pinned: false, canBack: false };
  paintResult();
  await queueNext(run);
}
async function queueNext(r: Run): Promise<void> {
  if (r.stopping || (r.trips.length && r.moved.length >= r.total)) { r.stopped = r.stopping; return finish(r); }
  let res: MoveTripApiResponse;
  try { res = await api<MoveTripApiResponse>("/api/move/trip", { method: "POST", body: r.body }); }
  catch (e) { r.lost = errorText(e); return finish(r); }
  if (r !== run) return;
  if (!r.trips.length) {
    r.skipped = res.skipped.map((s) => s.name);
    if (r.kind === "back") { r.total = res.remaining; r.noRoom = res.noRoom.length; r.noRoomNames = res.noRoom.map((s) => s.name); }
  }
  if (!res.id) return finish(r);
  // Stop pressed while this trip was being queued: the flag written then is older than the trip, which the bridge would clear, so write it again.
  if (r.stopping) void api("/api/bridge/stop", { method: "POST", body: {} }).catch(() => undefined);
  for (const [s, name] of Object.entries(res.names ?? {})) r.names.set(+s, name);
  r.trips.push(res.id);
  const now = Date.now();
  r.watch = { id: res.id, index: res.index ?? 1, queuedAt: now, picked: false, heard: now };
  bridge.pending.set(res.id, r.kind === "back" ? "Move back" : "Move");   // bridge.mts's poll toasts the bridge's own summary
  paintResult();
}
// On every bridge status: still waiting, reported (then the next trip, unless it did not go cleanly or Stop was pressed), or lost.
function check(): void {
  const r = run, w = r?.watch;
  if (!r || !w) return;
  const st = lastStatus;
  const step = stepWatch(w, { currentId: st?.current?.id ?? null, result: st?.results?.[w.id] ?? null, online: !!st?.online && Date.now() - lastStatusAt < 10_000 }, Date.now());
  if (step.kind === "wait") { r.watch = step.watch; return; }
  r.watch = null;
  if (step.kind === "lost") { r.lost = step.message; finish(r); return; }
  for (const s of step.result.steps || []) if (s.op === "put" && s.ok && !r.moved.includes(s.serial)) r.moved.push(s.serial);
  r.failed.push(...failedSteps(step.result, r.names).map((f) => ({ name: f.name, msg: f.msg })));
  if (step.outcome === "stopped" || r.stopping) { r.stopped = true; finish(r); return; }
  if (step.outcome !== "done") { finish(r); return; }
  paintResult();
  void queueNext(r);
}
setInterval(check, 5000);
document.addEventListener("bridgestatus", (e) => { lastStatus = (e as CustomEvent<BridgeStatusApiResponse>).detail; lastStatusAt = Date.now(); check(); });
function finish(r: Run): void {
  r.done = true;
  r.watch = null;
  paintResult();
  void checkBack(r);
}
// Move back is offered while the overlay still knows where the moved items came from (a scan that caught up forgets it).
async function checkBack(r: Run): Promise<void> {
  if (r.kind !== "to" || !r.moved.length) return;
  try {
    const res = await api<MoveBackApiResponse>("/api/move/plan", { method: "POST", body: { back: { serials: r.moved, trips: r.trips } } });
    r.canBack = res.back.movable > 0;
  } catch { r.canBack = false; }
  if (r === run) paintResult();
}
async function stopRun(): Promise<void> {
  const r = run;
  if (!r || r.done) return;
  r.stopping = true;
  paintResult();
  try { await api("/api/bridge/stop", { method: "POST", body: {} }); }
  catch (e) { r.stopping = false; toast(errorText(e), "bad"); paintResult(); }
}
async function pinMoved(r: Run, serials: number[]): Promise<void> {
  if (!state.organize.config) { try { await loadOrganize(); } catch (e) { toast(errorText(e), "bad"); return; } }
  const err = await saveConfig((cfg) => serials.reduce(pinnedWith, cfg));
  if (err) { toast(err, "bad"); return; }
  r.pinned = true;
  paintResult();
}
function moveBack(r: Run): void {
  void startRun({ kind: "back", dest: r.dest, body: { back: { serials: r.moved, trips: r.trips } }, total: r.moved.length, noRoom: 0, against: [], host: r.host, gather: false });
}

// ---------------------------------------------------------------- the result line
const result = (): HTMLElement | null => (run ? $<HTMLElement>(`#${run.host}`) : null);
// One line in the mockup's look: the head and its notes on the left, the actions on the right.
function line(tone: "info" | "ok" | "warn" | "bad", head: string, notes: Array<string | null>, actions: Array<HTMLElement | null>): HTMLElement {
  return box("div", { class: `mv-result ${tone}`, role: tone === "bad" ? "alert" : "status" },
    box("span", { class: "mv-lines" }, txt(head, "strong"), ...notes.filter((n): n is string => !!n).map((n) => txt(n, "t-sm"))),
    box("span", { class: "mv-acts" }, ...actions.filter((a): a is HTMLElement => !!a)));
}
function paintResult(): void {
  const host = result(), r = run;
  if (!host || !r) { for (const id of ["inv-move-result", "unr-move-result"]) { const h = $<HTMLElement>(`#${id}`); if (h) { h.hidden = true; h.replaceChildren(); } } return; }
  host.hidden = false;
  const back = r.kind === "back", dismiss = button({ label: "Dismiss", icon: "close", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: "mv-dismiss" }, onClick: () => { run = null; paintResult(); } });
  if (!r.done) {
    const stop = button({ label: r.stopping ? "Stopping…" : "Stop", size: "sm", variant: "danger-outline", disabled: r.stopping, attrs: { id: "mv-stop" }, onClick: () => { void stopRun(); } });
    host.replaceChildren(line("info", movingText(r.total, r.dest, back), [`${r.moved.length.toLocaleString("en-US")} of ${r.total.toLocaleString("en-US")} moved`], [stop]));
    return;
  }
  if (r.lost && !r.moved.length) { host.replaceChildren(line("bad", back ? "Move back did not run." : "The move did not run.", [r.lost], [dismiss])); return; }
  if (!r.moved.length && !r.failed.length) {
    host.replaceChildren(line("warn", back ? "Nothing to move back." : "Nothing was moved.", [skippedText(r.skipped), r.stopped ? "It was stopped before any item moved." : null], [dismiss]));
    return;
  }
  const moved = new Set(r.moved);
  const against = r.against.filter((a) => moved.has(a.serial));
  const why = gate(), backBtn = r.canBack ? button({ label: "Move back", size: "sm", attrs: { id: "mv-back" }, disabled: !!why, onClick: () => moveBack(r) }) : null;
  const counts = { noRoom: r.noRoom, failed: r.failed.length, stopped: r.stopped };
  host.replaceChildren(line(r.failed.length || r.lost ? "warn" : "ok", r.gather && !back ? gatheredText(r.moved.length, r.dest, counts) : movedText(r.moved.length, r.dest, back, counts),
    [r.gather && !back && !r.stopped ? GATHER_NOTE : null, r.pinned ? pinnedText(against.length, r.dest) : againstText(against, placeOf), back ? skippedText(r.skipped) : null, back ? noRoomText(r.noRoomNames) : null, r.failed.length ? r.failed.slice(0, 3).map((f) => `${f.name}: ${f.msg}`).join(" · ") : null, r.lost],
    [against.length && !r.pinned ? button({ label: `Pin ${against.length === 1 ? "it" : "them"} here`, size: "sm", attrs: { id: "mv-pin" }, onClick: () => { void pinMoved(r, against.map((a) => a.serial)); } }) : null,
      backBtn && why ? tipWrap(backBtn, why) : backBtn, dismiss]));
}
