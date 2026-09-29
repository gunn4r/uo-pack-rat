// ui/organize.mts — the Organize screen (#/organize, issue #11, spec §3): the Rules card (ordered rules with a
// drag handle, a one-line filter summary, the target chain with each container's fill, the plan's counts, the
// catch-all) and the Plan card (room, cross-site and warnings first, then the trip list and Run trip / Run all /
// Stop). The words and every decision come from ui/organize-model.mts; this file draws them and talks to the
// server (GET /api/organize/plan, POST /api/organize/trip, POST /api/bridge/stop; saves go through
// ui/organize-data.mts). The rule editor drawer is ui/rule-editor.mts; Containers' Label… is ui/containers.mts.
import { state } from "./store.mts";
import { $, el, toast, compactChildren } from "./dom.mts";
import { box, txt, button, message } from "./components.mts";
import { errorText } from "./messages.mts";
import { loadOrganize, refreshPlaces, saveConfig } from "./organize-data.mts";
import { organizeStage } from "./organize-model.mts";
import type { OrganizeConfig } from "./api-types.mts";

const body = (): HTMLElement => $<HTMLElement>("#org-body")!;
const containers = () => state.inv?.containers || {};
const groundRoots = (): number => Object.values(containers()).filter((c) => c.parent == null && c.kind === "ground").length;

// The route's entry: the setup (fetched here too when reload() could not), then the screen and its plan. Before
// the inventory's first load it does nothing; reload() calls it again once the data is in.
export async function showOrganize(): Promise<void> {
  if (!state.inv) return;
  if (!state.organize.config) {
    try { await loadOrganize(); refreshPlaces(); }
    catch (e) { body().replaceChildren(message({ tone: "bad", title: "Could not load Organize", text: errorText(e) })); return; }
  }
  render();
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
// Task 6 replaces this with the full Rules card.
function rulesCard(cfg: OrganizeConfig): HTMLElement {
  return box("section", { class: "card", id: "org-rules" }, box("div", { class: "card-body card-pad" }, cfg.rules.length ? txt(`${cfg.rules.length} rules`) : box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, "No rules yet"))));
}

document.addEventListener("organizechange", () => { if (!$<HTMLElement>("#tab-organize")!.hidden) render(); });
