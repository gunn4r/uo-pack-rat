// ui/organize.mts — the Organize screen (#/organize, issue #11, spec §3): the Rules card (ordered rules with a
// drag handle, a one-line filter summary, the target chain with each container's fill, the plan's counts, the
// catch-all) and the Plan card (room, cross-site and warnings first, then the trip list and Run trip / Run all /
// Stop). The words and every decision come from ui/organize-model.mts; this file draws them and talks to the
// server (GET /api/organize/plan, POST /api/organize/trip, POST /api/bridge/stop; saves go through
// ui/organize-data.mts). The rule editor drawer is ui/rule-editor.mts; Containers' Label… is ui/containers.mts.
import { state } from "./store.mts";
import { $, el, toast, compactChildren } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, badge, card, message, menu, select } from "./components.mts";
import { errorText } from "./messages.mts";
import { filterContext } from "./inventory.mts";
import { loadOrganize, refreshPlaces, saveConfig } from "./organize-data.mts";
import { targetChip, deleteRule, openRuleEditor } from "./rule-editor.mts";
import { CATCH_ALL_ID, organizeStage, moveRule, matchSummary, targetView, targetOptions, ruleCountParts } from "./organize-model.mts";
import type { OrganizeConfig, OrganizePlanApiResponse, OrganizeRule, PlanRuleReport } from "./api-types.mts";

const body = (): HTMLElement => $<HTMLElement>("#org-body")!;
const containers = () => state.inv?.containers || {};
const groundRoots = (): number => Object.values(containers()).filter((c) => c.parent == null && c.kind === "ground").length;
let planError: string | null = null;
let loadingPlan = false;
let dragFrom: number | null = null;

// The route's entry: the setup (fetched here too when reload() could not), then the screen and its plan. Before
// the inventory's first load it does nothing; reload() calls it again once the data is in.
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
  if (stage === "no-scans") { body().replaceChildren(emptyState("Nothing to organise yet", "Organize moves items between containers on the ground, such as the chests in your house. Scan them in game first.", null)); return; }
  if (stage === "no-labels") {
    body().replaceChildren(emptyState("Label your storage first", "Organize only takes items from, and puts items into, containers you have labelled, so a friend's chest or a vendor is never touched. In Inventory › Containers, choose Label… from a chest's ⋯ menu.",
      button({ label: "Open Containers", variant: "primary", attrs: { id: "org-open-containers" }, onClick: () => { location.hash = "#/containers"; } })));
    return;
  }
  body().replaceChildren(...compactChildren([problemsEl(cfg), rulesCard(cfg)]));
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
  const report = new Map((state.organize.plan?.rules || []).map((r) => [r.ruleId, r] as const));
  const list = cfg.rules.length
    ? box("ol", { class: "org-rules", "aria-label": "Rules, first match wins" }, ...cfg.rules.map((r, i) => ruleRow(cfg, r, i, report.get(r.id))))
    : box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, "No rules yet"), el("p", { class: "muted" }, "A rule says which items go where: reagents into the reagent chest, rings into the jewellery box. Start from a preset."));
  return card({ title: "Rules", actions: [add], attrs: { id: "org-rules" }, body: [
    txt("Each item goes to the first rule it matches. Put narrow rules above broad ones.", "t-sm muted"),
    list, catchAllRow(cfg, report.get(CATCH_ALL_ID)),
    el("div", { class: "sr", id: "org-live", "aria-live": "polite" }),
  ] });
}
function ruleRow(cfg: OrganizeConfig, r: OrganizeRule, i: number, rep: PlanRuleReport | undefined): HTMLElement {
  const handle = button({ label: `Move ${r.name}`, icon: "grip", iconOnly: true, variant: "ghost", size: "sm", cls: "org-grip", attrs: { title: "Drag, or press ↑ or ↓" } });
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
function catchAllRow(cfg: OrganizeConfig, rep: PlanRuleReport | undefined): HTMLElement {
  const s = select([{ value: "", label: "Stays where it is" }, ...targetOptions(cfg, containers(), [], { bags: false })], cfg.catchAll == null ? "" : String(cfg.catchAll), { size: "sm", attrs: { id: "org-catchall" } });
  s.addEventListener("change", () => { void saveConfig({ ...cfg, catchAll: s.value ? +s.value : null }).then((err) => { if (err) { s.value = cfg.catchAll == null ? "" : String(cfg.catchAll); toastBad(err); } }); });
  return box("div", { class: "org-catchall", "data-rule": CATCH_ALL_ID }, el("label", { for: "org-catchall", class: "t-sm strong" }, "Everything no rule takes"), s, countsEl(rep));
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
// repainted, so a focused rule handle keeps its focus.
async function refreshPlan(): Promise<void> {
  const cfg = state.organize.config;
  if (!cfg || !state.inv || organizeStage(cfg, groundRoots()) !== "ready") return;
  loadingPlan = true;
  paintPlan();
  try { state.organize.plan = (await api<OrganizePlanApiResponse>("/api/organize/plan")).plan; planError = null; }
  catch (e) { planError = errorText(e); }
  loadingPlan = false;
  paintPlan();
  paintCounts();
}
function paintCounts(): void {
  const report = new Map((state.organize.plan?.rules || []).map((r) => [r.ruleId, r] as const));
  for (const row of document.querySelectorAll<HTMLElement>("#org-rules [data-rule]")) row.querySelector(".org-counts")?.replaceWith(countsEl(report.get(row.dataset.rule!)));
}
// Task 8 draws the Plan card.
function paintPlan(): void { /* the Plan card arrives in Task 8 */ }

// A saved setup: redraw (focus is put back by whoever saved) and work the plan out again.
document.addEventListener("organizechange", () => { if ($<HTMLElement>("#tab-organize")!.hidden) { state.organize.plan = null; return; } render(); void refreshPlan(); });
