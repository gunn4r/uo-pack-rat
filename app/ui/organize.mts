// ui/organize.mts — the Organize screen (#/organize, issue #11, spec §3): the Rules card (ordered rules with a
// drag handle, a one-line filter summary, the target chain with each container's fill, the plan's counts, the
// catch-all, where empty bags are gathered) and the Plan card (room, cross-site, warnings and empty bags first,
// then the trip list and Run trip / Run all / Stop). The words and every decision come from ui/organize-model.mts;
// this file draws them and talks to the server (GET /api/organize/plan, POST /api/organize/trip, POST
// /api/bridge/stop; saves go through ui/organize-data.mts). The rule editor drawer is ui/rule-editor.mts, Auto organize's ui/auto-organize.mts;
// Containers' Label… is ui/containers.mts.
import { state, bridge } from "./store.mts";
import { $, el, itemTip, toast, compactChildren } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, badge, card, message, menu, select, tipWrap, table, type Kids } from "./components.mts";
import { currentAdapter, BRIDGE_OFFLINE } from "./bridge.mts";
import { setNavBusy } from "./shell.mts";
import { errorText } from "./messages.mts";
import { parseRoute, registerScreen, showKind } from "./nav.mts";
import { filterContext } from "./item-parts.mts";
import { loadOrganize, refreshPlaces, saveConfig } from "./organize-data.mts";
import { targetChip, deleteRule, openRuleEditor } from "./rule-editor.mts";
import { openAutoOrganize } from "./auto-organize.mts";
import { CATCH_ALL_ID, EMPTY_BAGS_ID, emptyBagsNote, organizeStage, moveRule, matchSummary, targetView, targetOptions, ruleCountParts, ruleNameOf, containerNameOf, planHeadline, unclaimedNote, roomLines, crossSiteLines, warningGroups, tripRows, moveName, moveWhere, tripGate, carriedView, pinnedWith, stepWatch, failedSteps, outcomeText, runAllNext, tripRefusal, adoptWatch, resumedNote, type TripRow, type TripWatch, type FailedStep } from "./organize-model.mts";
import type { BridgeStatusApiResponse, OrganizeConfig, OrganizePlan, OrganizePlanApiResponse, OrganizeRunningTrip, OrganizeRule, OrganizeTripApiResponse, PlanRuleReport } from "./api-types.mts";

const body = (): HTMLElement => $<HTMLElement>("#org-body")!;
const containers = () => state.inv?.containers || {};
const groundRoots = (): number => Object.values(containers()).filter((c) => c.parent == null && c.kind === "ground").length;
let planError: string | null = null;
let loadingPlan = false;
let dragFrom: number | null = null;
let notice: { tone: "info" | "warn" | "bad"; text: string } | null = null;
// The trip in flight: what the page waits on (organize-model.mts's stepWatch), whether Run all goes on after it,
// the plan's move count before it (Run all stops if a clean trip does not shorten the plan), and its items'
// names for the failed-step list.
interface Run { watch: TripWatch; all: boolean; before: number; names: Map<number, string>; stopping: boolean }
let run: Run | null = null;
// Trips the page stopped following (reported back or given up on): a plan fetched before one ended can still name
// it, and a trip given up on can stay in flight on the server while its bridge answers; neither is followed again.
const ended = new Set<string>();
// True while POST /api/organize/trip is out: a second click then queues nothing.
let queueing = false;
let runTimer = 0;
let lastTrip: number | null = null;
let failed: { index: number; steps: FailedStep[] } | null = null;
let lastStatus: BridgeStatusApiResponse | null = null;
let lastStatusAt = 0;   // when it came: a status the poll has not refreshed for 10 s (the server gone) is not "online"

// The route's entry: the setup (fetched here too when reload() could not), then the screen and its plan. Before
// the inventory's first load it does nothing; it runs again on inventorychange once the data is in.
registerScreen({ name: "organize", show: () => void showOrganize() });
document.addEventListener("inventorychange", () => { if (parseRoute().tab === "organize") void showOrganize(); });
export async function showOrganize(): Promise<void> {
  if (!state.inv) return;
  if (!state.organize.config) {
    try { await loadOrganize(); refreshPlaces(); }
    catch (e) { body().replaceChildren(message({ tone: "bad", title: "Could not load Organize", text: errorText(e) })); return; }
  }
  render();
  await refreshPlan();
}

function render(): void {
  const cfg = state.organize.config;
  if (!cfg || !state.inv) return;
  const stage = organizeStage(cfg, groundRoots());
  if (stage === "no-scans") { body().replaceChildren(emptyState("Nothing to organize yet", "Organize moves items between containers on the ground, such as the chests in your house. Scan them in game first.", null)); return; }
  if (stage === "no-labels") {
    const auto = button({ label: "Auto organize…", attrs: { id: "org-auto" }, onClick: () => { void openAutoOrganize(auto); } });
    body().replaceChildren(emptyState("Label your storage first", "Organize only takes items from, and puts items into, containers you have labeled, so a friend's chest or a vendor is never touched. In Inventory › Containers, choose Label… from a container's ⋯ menu, or let Auto organize label your containers and write the rules for you.",
      box("div", { class: "org-empty-actions" },
        button({ label: "Open Containers", variant: "primary", attrs: { id: "org-open-containers" }, onClick: () => { location.hash = "#/containers"; } }), auto)));
    return;
  }
  body().replaceChildren(...compactChildren([problemsEl(cfg), rulesCard(cfg), stage === "ready" ? planCard(cfg) : null]));
}
function emptyState(title: string, text: string, action: HTMLElement | null): HTMLElement {
  return box("section", { class: "card org-empty" }, box("div", { class: "empty-state" }, el("h2", { class: "t-lg" }, title), el("p", { class: "muted" }, text), action));
}
// A hand-edited organize.json the server salvaged: what it dropped, and Save setup, since the server runs no trip
// until the setup has been saved as it now reads (POST /api/organize/trip's 409).
function problemsEl(cfg: OrganizeConfig): HTMLElement | null {
  const p = state.organize.problems;
  if (!p.length) return null;
  const save = button({ label: "Save setup", size: "sm", attrs: { id: "org-save-setup" }, onClick: () => { void saveConfig(cfg).then((err) => { if (err) toast(err, "bad"); else toast("Setup saved.", "good"); }); } });
  return message({ tone: "warn", title: "Part of organize.json could not be read and was left out", text: `${p.join(" · ")}. Check the rules below, then save the setup: no trip runs until you do.`, actions: [save] });
}

// ---------------------------------------------------------------- rules
function rulesCard(cfg: OrganizeConfig): HTMLElement {
  const add = button({ label: "Rule", icon: "plus", size: "sm", variant: "primary", attrs: { id: "org-add", "aria-haspopup": "menu" }, onClick: () => {
    menu(add, [
      { label: "From a preset…", onSelect: () => { void openRuleEditor({ preset: true }); } },
      { label: "Blank rule", onSelect: () => { void openRuleEditor({}); } },
    ], { label: "New rule" });
  } });
  const auto = button({ label: "Auto organize…", size: "sm", attrs: { id: "org-auto" }, onClick: () => { void openAutoOrganize(auto); } });
  const report = new Map((state.organize.plan?.rules || []).map((r) => [r.ruleId, r] as const));
  const list = cfg.rules.length
    ? box("ol", { class: "org-rules", "aria-label": "Rules, first match wins" }, ...cfg.rules.map((r, i) => ruleRow(cfg, r, i, report.get(r.id))))
    : box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, "No rules yet"), el("p", { class: "muted" }, "A rule says which items go where: reagents into the reagent chest, rings into the jewelry box. Start from a preset."));
  return card({ title: "Rules", actions: [auto, add], attrs: { id: "org-rules" }, body: [
    txt("Each item goes to the first rule it matches. Put narrow rules above broad ones.", "t-sm muted"),
    list,
    pickRow(cfg, "catchAll", CATCH_ALL_ID, "Everything no rule takes", "Stays where it is", report.get(CATCH_ALL_ID), reviewOther()),
    pickRow(cfg, "emptyBagsTo", EMPTY_BAGS_ID, "Empty bags", "Stay where they are", report.get(EMPTY_BAGS_ID)),
    el("div", { class: "sr", id: "org-live", "aria-live": "polite" }),
  ] });
}
function ruleRow(cfg: OrganizeConfig, r: OrganizeRule, i: number, rep: PlanRuleReport | undefined): HTMLElement {
  const handle = button({ label: `Move ${r.name}`, icon: "grip", iconOnly: true, variant: "ghost", size: "sm", cls: "org-grip", attrs: { title: "Drag, or press ↑ or ↓", "aria-keyshortcuts": "ArrowUp ArrowDown" } });
  handle.addEventListener("keydown", (e) => {
    const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
    if (to < 0 || to >= cfg.rules.length) return;
    e.preventDefault();
    void reorder(i, to, true);
  });
  const targets = r.targets.map((s) => targetView(s, cfg, containers()));
  const chain = targets.length
    ? box("span", { class: "org-chain" }, ...targets.map((t, k) => box("span", { class: "org-link" }, k ? txt("then", "t-sm faint") : null, targetChip(t))))
    : box("span", { class: "org-chain" }, txt("No container yet: its items stay where they are.", "t-sm muted"));
  const more = button({ label: `Actions for ${r.name}`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", cls: "org-more", onClick: () => {
    menu(more, [
      { label: "Edit…", onSelect: () => { void openRuleEditor({ rule: r }); } },
      { label: "Move up", disabled: i === 0 ? "Already first" : null, onSelect: () => { void reorder(i, i - 1, false); } },
      { label: "Move down", disabled: i === cfg.rules.length - 1 ? "Already last" : null, onSelect: () => { void reorder(i, i + 1, false); } },
      ...(r.id === "auto-other" ? [{ label: REVIEW_OTHER, onSelect: () => showKind("other") }] : []),
      "divider",
      { label: "Delete…", danger: true, onSelect: () => { void deleteRule(r); } },
    ], { label: `Actions for ${r.name}` });
  } });
  const row = box("li", { class: "org-rule", "data-rule": r.id },
    handle,
    box("span", { class: "org-rule-main" },
      box("span", { class: "org-rule-name" }, txt(r.name, "strong ellip"), r.origin !== "manual" ? badge("Auto", "accent") : null),
      txt(matchSummary(r.match, filterContext()), "t-sm muted")),
    chain, countsEl(rep), more);
  wireDrag(row, handle, i);
  return row;
}
// The plan's numbers for one rule (or the catch-all); "…" until the plan has been worked out.
function countsEl(rep: PlanRuleReport | undefined): HTMLElement {
  if (!rep) return box("span", { class: "org-counts" }, txt(state.organize.plan ? "" : "…", "t-sm muted"));
  return box("span", { class: "org-counts" }, ...ruleCountParts(rep).map((p) => (p.warn ? badge(p.text, "warn") : txt(p.text, "t-sm muted"))));
}
// Auto organize's Other group and the catch-all take what Pack Rat could not classify, among the rest: the Inventory
// filtered to kind Other lists those items, each with Classify this… (issue #150).
const REVIEW_OTHER = "Review unclassified items";
const reviewOther = (): HTMLElement => button({ label: REVIEW_OTHER, variant: "ghost", size: "sm", attrs: { id: "org-review-other" }, onClick: () => showKind("other") });
// The catch-all, and the container empty bags are gathered into (issue #128): each one labelled container or none.
function pickRow(cfg: OrganizeConfig, key: "catchAll" | "emptyBagsTo", id: string, label: string, none: string, rep: PlanRuleReport | undefined, extra: HTMLElement | null = null): HTMLElement {
  const now = cfg[key] ?? null, domId = `org-${id.replace("-", "")}`;
  const s = select([{ value: "", label: none }, ...targetOptions(cfg, containers(), [], { bags: false })], now == null ? "" : String(now), { size: "sm", attrs: { id: domId } });
  s.addEventListener("change", () => { void saveConfig({ ...cfg, [key]: s.value ? +s.value : null }).then((err) => { if (err) { s.value = now == null ? "" : String(now); toastBad(err); } }); });
  return box("div", { class: "org-catchall", "data-rule": id }, el("label", { for: domId, class: "t-sm strong" }, label), s, countsEl(rep), extra);
}
// Drag by the handle: the row is draggable only while its handle is held, so text in a row stays selectable.
function wireDrag(row: HTMLElement, handle: HTMLElement, i: number): void {
  handle.addEventListener("pointerdown", () => { row.draggable = true; });
  row.addEventListener("dragstart", (e) => { dragFrom = i; row.classList.add("dragging"); e.dataTransfer?.setData("text/plain", String(i)); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
  row.addEventListener("dragend", () => { row.draggable = false; row.classList.remove("dragging"); dragFrom = null; });
  row.addEventListener("dragover", (e) => { if (dragFrom == null) return; e.preventDefault(); row.classList.add("drop"); });
  row.addEventListener("dragleave", () => row.classList.remove("drop"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    row.classList.remove("drop");
    if (dragFrom != null && dragFrom !== i) void reorder(dragFrom, i, false);
  });
}
async function reorder(from: number, to: number, keyboard: boolean): Promise<void> {
  const cfg = state.organize.config!;
  const next = moveRule(cfg, from, to);
  if (next === cfg) return;
  const moved = cfg.rules[from]!;
  const err = await saveConfig(next);
  if (err) { toastBad(err); return; }
  const at = next.rules.findIndex((r) => r.id === moved.id);
  $<HTMLElement>("#org-live")!.textContent = `${moved.name} moved to position ${at + 1} of ${next.rules.length}.`;
  if (keyboard) $<HTMLElement>(`.org-rule[data-rule="${CSS.escape(moved.id)}"] .org-grip`)?.focus();
}
const toastBad = (text: string): void => toast(text, "bad");

// ---------------------------------------------------------------- the plan
// Fetched after every render of a ready setup and after every trip. Only the Plan card and the rule counts are
// repainted, so a focused rule handle keeps its focus. A trip in flight the page is not following (it was
// reloaded, or the trip came from another window) is followed from here on, Stop included; Run all is not resumed.
async function refreshPlan(): Promise<void> {
  const cfg = state.organize.config;
  if (!cfg || !state.inv || organizeStage(cfg, groundRoots()) !== "ready") return;
  loadingPlan = true;
  paintPlan();
  let running: OrganizeRunningTrip | null = null;
  try { ({ plan: state.organize.plan, running } = await api<OrganizePlanApiResponse>("/api/organize/plan")); planError = null; }
  catch (e) { planError = errorText(e); }
  loadingPlan = false;
  const adopted = adoptWatch(running, !!run || queueing, ended, Date.now());
  if (adopted) {
    notice = { tone: "info", text: resumedNote(adopted.index) };
    follow(adopted, false, 0, new Map((state.organize.plan?.moves || []).map((m) => [m.serial, m.name] as const)));
  }
  paintPlan();
  paintCounts();
}
function paintCounts(): void {
  const report = new Map((state.organize.plan?.rules || []).map((r) => [r.ruleId, r] as const));
  for (const row of document.querySelectorAll<HTMLElement>("#org-rules [data-rule]")) row.querySelector(".org-counts")?.replaceWith(countsEl(report.get(row.dataset.rule!)));
}
function paintPlan(): void {
  const cfg = state.organize.config, old = $<HTMLElement>("#org-plan");
  if (cfg && old) old.replaceWith(planCard(cfg));
}
const canTrip = (): boolean => (currentAdapter()?.capabilities?.bridge || []).includes("trip");
// Why no trip can start now (organize-model.mts's tripGate), or null.
function gate(): string | null {
  const a = currentAdapter();
  return tripGate({ client: a ? a.name || a.id : null, canTrip: canTrip(), online: bridge.online, running: !!run || queueing }, BRIDGE_OFFLINE);
}
// A disabled control carries its reason on a wrapper (components.mts's tipWrap), never a dead button alone.
function gated(b: HTMLButtonElement, reason: string | null): HTMLElement {
  if (!reason) return b;
  b.disabled = true;
  return tipWrap(b, reason);
}
function planCard(cfg: OrganizeConfig): HTMLElement {
  const reload = button({ label: "Reload plan", icon: "refresh", size: "sm", attrs: { id: "org-reload" }, onClick: () => { notice = null; void refreshPlan(); } });
  const plan = state.organize.plan;
  const kids: Kids = planError ? [message({ tone: "bad", title: "Could not work out the plan", text: planError })]
    : plan ? planBody(cfg, plan) : [txt(loadingPlan ? "Working out the plan…" : "", "muted")];
  return card({ title: "Plan", actions: [reload], attrs: { id: "org-plan", "aria-busy": String(loadingPlan) }, body: kids });
}
// Reports first (spec §3): what does not fit, what belongs at another house, what the scans could not say; then
// the headline, the Run controls and the trip list.
function planBody(cfg: OrganizeConfig, plan: OrganizePlan): HTMLElement[] {
  const nameOf = containerNameOf(cfg, containers()), ruleName = ruleNameOf(cfg);
  const note = unclaimedNote(plan);
  return compactChildren([
    notice ? message({ tone: notice.tone, text: notice.text }) : null,
    canTrip() ? null : message({ tone: "info", text: gate()! }),
    ...roomLines(plan, ruleName).map((text) => message({ tone: "warn", text })),
    ...crossSiteLines(plan, ruleName).map((text) => message({ tone: "info", text })),
    ...warningGroups(plan.warnings, nameOf).map((g) => message({ tone: "warn", title: g.title, text: g.text })),
    emptyBagsEl(plan, cfg, nameOf),
    carriedEl(plan),
    failed ? failedEl(failed) : null,
    box("div", { class: "org-summary" }, el("h3", { class: "t-md", id: "org-headline" }, planHeadline(plan)), note ? txt(note, "t-sm muted") : null),
    canTrip() && (plan.trips.length || run) ? controls(plan) : null,
    plan.trips.length ? tripList(plan, nameOf, ruleName) : null,
  ]);
}
function emptyBagsEl(plan: OrganizePlan, cfg: OrganizeConfig, nameOf: (s: number) => string): HTMLElement | null {
  const note = emptyBagsNote(plan, cfg.emptyBagsTo != null, nameOf);
  return note ? message({ tone: "info", title: note.title, text: note.text }) : null;
}
function controls(plan: OrganizePlan): HTMLElement {
  const first = plan.trips[0], why = gate();
  const one = first ? gated(button({ label: `Run trip ${first.index}`, variant: "primary", attrs: { id: "org-run" }, onClick: () => { void startTrip(first.index, false); } }), why) : null;
  const all = first ? gated(button({ label: "Run all", attrs: { id: "org-run-all" }, onClick: () => { void startTrip(first.index, true); } }), why) : null;
  const stop = run ? button({ label: run.stopping ? "Stopping…" : "Stop", variant: "danger-outline", disabled: run.stopping, attrs: { id: "org-stop" }, onClick: () => { void stopTrips(); } }) : null;
  const status = run ? `Trip ${run.watch.index} running${run.all ? ", then the rest" : ""}…` : "";
  return box("div", { class: "org-controls", id: "org-controls" }, one, all, stop, box("span", { class: "t-sm muted", id: "org-status", role: "status" }, txt(status)));
}
function paintControls(): void { const plan = state.organize.plan, c = $<HTMLElement>("#org-controls"); if (plan && c) c.replaceWith(controls(plan)); }
// One collapsed row per trip; the move table is built the first time a row is opened, so a plan of hundreds of
// moves draws thirty rows, not six hundred.
function tripList(plan: OrganizePlan, nameOf: (s: number) => string, ruleName: (id: string) => string): HTMLElement {
  return box("div", { class: "org-trips", id: "org-trips" }, ...tripRows(plan, nameOf).map((r) => tripEl(r, nameOf, ruleName)));
}
function tripEl(r: TripRow, nameOf: (s: number) => string, ruleName: (id: string) => string): HTMLElement {
  const d = el("details", { class: "org-trip", "data-trip": r.index }, el("summary", {}, txt(r.text)));
  d.addEventListener("toggle", () => {
    if (!d.open || d.querySelector("table")) return;
    const moves = table({ label: `Trip ${r.index}`, columns: [{ label: "Item" }, { label: "From → to" }, { label: "Rule" }],
      rows: r.moves.map((m) => ({ attrs: { class: "org-move" }, cells: [moveName(m), moveWhere(m, nameOf), ruleName(m.ruleId)] })) });
    moves.querySelectorAll<HTMLElement>("tr.org-move").forEach((tr, i) => itemTip(tr, r.moves[i]!, { focus: false }));   // the item's tooltip on hover
    d.append(moves);
  });
  return d;
}

// ---------------------------------------------------------------- running trips
// What a stopped or failed trip left in the backpack (the bridge's carried set), with Put them away: the trip
// that holds their puts (organize-model.mts's carriedView).
function carriedEl(plan: OrganizePlan): HTMLElement | null {
  const c = carriedView(plan, lastTrip);
  if (!c) return null;
  const put = c.putAway == null ? null : button({ label: "Put them away", size: "sm", attrs: { id: "org-put-away" }, onClick: () => { void startTrip(c.putAway!, false); } });
  return message({ tone: "warn", title: c.text, text: c.reason ? `${c.names}. ${c.reason}` : c.names, actions: put && canTrip() ? [gated(put, gate())] : [] });
}
// A trip's failed steps, each with Pin this item: for things the server refuses to move (a locked-down item), so
// the plan stops asking for them.
function failedEl(f: { index: number; steps: FailedStep[] }): HTMLElement {
  return message({ tone: "bad", title: `Trip ${f.index}: ${f.steps.length === 1 ? "1 item" : `${f.steps.length} items`} could not be moved`,
    text: box("span", { class: "org-failed" }, ...f.steps.map((s) => itemTip(box("span", { class: "org-failed-row" },
      txt(`${s.name}: ${s.msg}`), button({ label: "Pin this item", size: "sm", variant: "ghost", attrs: { "data-no-tip": "" }, onClick: () => { void pinItem(s); } })), s, { focus: false }))) });
}
async function pinItem(s: FailedStep): Promise<void> {
  const err = await saveConfig(pinnedWith(state.organize.config!, s.serial));
  if (err) { toastBad(err); return; }
  if (failed) failed = failed.steps.length > 1 ? { ...failed, steps: failed.steps.filter((x) => x.serial !== s.serial) } : null;
  toast(`${s.name} is pinned: Organize leaves it where it is.`, "good");
}
// One trip of the plan the player is looking at (its stamp): the server rebuilds it from its own current plan
// and refuses a stale one, which is then fetched again with a sentence saying why.
async function startTrip(index: number, all: boolean): Promise<void> {
  const plan = state.organize.plan;
  if (!plan || run || queueing) return;
  notice = null;
  failed = null;
  const names = new Map(plan.moves.filter((m) => m.trip === index).map((m) => [m.serial, m.name] as const));
  let r: OrganizeTripApiResponse;
  queueing = true;
  paintControls();
  try { r = await api<OrganizeTripApiResponse>("/api/organize/trip", { method: "POST", body: { index, stamp: plan.stamp } }); }
  catch (e) { queueing = false; notice = { tone: "bad", text: tripRefusal(errorText(e)) }; await refreshPlan(); return; }
  queueing = false;
  const now = Date.now();
  follow({ id: r.id, index, queuedAt: now, picked: false, heard: now }, all, plan.moves.length, names);
  paintControls();
}
function follow(watch: TripWatch, all: boolean, before: number, names: Map<number, string>): void {
  bridge.pending.set(watch.id, `Trip ${watch.index}`);   // bridge.mts's poll toasts the bridge's own summary of it
  lastTrip = watch.index;
  run = { watch, all, before, names, stopping: false };
  setNavBusy("organize", true, "Organize trip running");
  runTimer = setInterval(() => { void check(); }, 5000) as unknown as number;   // also when the status poll goes quiet
}
// On every bridge status and every 5 s: still waiting, reported (then the plan again, and Run all's next trip),
// or given up on (organize-model.mts's stepWatch).
async function check(): Promise<void> {
  const r = run;
  if (!r) return;
  const st = lastStatus;
  const step = stepWatch(r.watch, { currentId: st?.current?.id ?? null, result: st?.results?.[r.watch.id] ?? null, online: !!st?.online && Date.now() - lastStatusAt < 10_000 }, Date.now());
  if (step.kind === "wait") { r.watch = step.watch; return; }
  finishRun();
  notice = null;
  if (step.kind === "lost") { notice = { tone: "bad", text: step.message }; await refreshPlan(); return; }
  const fails = failedSteps(step.result, r.names);
  if (fails.length) failed = { index: r.watch.index, steps: fails };
  const text = outcomeText(step.outcome, r.watch.index, step.result);
  if (text) notice = { tone: step.outcome === "stopped" ? "info" : "warn", text };
  await refreshPlan();
  const plan = state.organize.plan;
  if (step.outcome !== "done" || !r.all || !plan) return;
  const next = runAllNext(r.before, plan);
  if ("index" in next) await startTrip(next.index, true);
  else if (next.stop) { notice = { tone: "warn", text: next.stop }; paintPlan(); }
}
function finishRun(): void {
  clearInterval(runTimer);
  if (run) ended.add(run.watch.id);
  run = null;
  setNavBusy("organize", false);
}
// Stop: the bridge halts after its current step (the stop flag); Run all does not go on.
async function stopTrips(): Promise<void> {
  const r = run;
  if (!r) return;
  r.all = false;
  r.stopping = true;
  paintControls();
  try { await api("/api/bridge/stop", { method: "POST", body: {} }); }
  catch (e) { r.stopping = false; toastBad(errorText(e)); paintControls(); }
}
document.addEventListener("bridgestatus", (e) => { lastStatus = (e as CustomEvent<BridgeStatusApiResponse>).detail; lastStatusAt = Date.now(); void check(); });

// A saved setup: redraw (focus is put back by whoever saved) and work the plan out again.
document.addEventListener("organizechange", () => { if ($<HTMLElement>("#tab-organize")!.hidden) { state.organize.plan = null; return; } render(); void refreshPlan(); });
// The bridge came or went: the Run controls gate on it.
document.addEventListener("bridgechange", paintControls);
