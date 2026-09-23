// ui/shell.mts — the app shell (design spec 3.1): the left sidebar (nav, the shard and last-scan line, the
// bridge status control and its popover), collapsing to icons below 1180 px or when pinned collapsed, the
// nav's counts and current item, and ⌘I for Import. The routes themselves live in app.mts; each screen is
// its own <main> in index.html with its h1 in the top bar.
import { state } from "./store.mts";
import { $, el } from "./dom.mts";
import { api } from "./api.mts";
import { box, button, keyValue, popover, txt, type PopoverHandle } from "./components.mts";
import { currentBridgeView, bridgeLastAnswered, currentAdapter, pollBridge } from "./bridge.mts";
import { relativeWhen } from "./messages.mts";
import type { UiPrefs } from "./api-types.mts";

// ---------------------------------------------------------------- collapse
// Collapsed = pinned collapsed (ui-prefs "sidebar", kept server-side like every view choice, because the
// desktop app's page origin changes each launch) or a window under 1180 px. The pin button is hidden while
// the width alone decides.
const NARROW = "(max-width: 1179px)";
let pinned = false;
let narrow: MediaQueryList | null = null;
function paintCollapse(): void {
  const collapsed = pinned || !!narrow?.matches;
  $<HTMLElement>("#app")!.classList.toggle("collapsed", collapsed);
  const pin = $<HTMLButtonElement>("#sidebar-pin")!;
  pin.setAttribute("aria-pressed", String(pinned));
  pin.querySelector(".nav-label")!.textContent = pinned ? "Expand sidebar" : "Collapse sidebar";
}
export function applyShellPrefs(prefs: UiPrefs | null): void {
  pinned = prefs?.sidebar === "collapsed";
  paintCollapse();
}
function togglePin(): void {
  pinned = !pinned;
  paintCollapse();
  api("/api/ui-prefs", { method: "PUT", body: { sidebar: pinned ? "collapsed" : "auto" } }).catch(() => { /* a view choice; the next launch just starts expanded */ });
}

// ---------------------------------------------------------------- nav
export function setCurrentNav(screen: string): void {
  for (const a of document.querySelectorAll<HTMLElement>("#sidebar [data-nav]")) {
    if (a.dataset.nav === screen) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}
// The nav counts and the sidebar's shard/last-scan line, after every inventory load (app.mts's reload) and
// whenever the saved-runs list changes (runs.mts).
export function renderNavCounts(): void {
  const inv = state.inv;
  const set = (id: string, n: number | null): void => { const e = $<HTMLElement>(id); if (e) e.textContent = n == null ? "" : n.toLocaleString(); };
  set("#nav-count-inventory", inv ? inv.itemCount : null);
  set("#nav-count-characters", inv ? Object.keys(inv.characters).length : null);
  set("#nav-count-runs", state.builder.character ? state.builder.runs.length : null);
  const shard = state.availableShards.find((r) => r.id === state.settings?.shard)?.name || state.settings?.shard || "";
  const when = relativeWhen(state.newestScan);
  $<HTMLElement>("#status")!.textContent = [shard, inv ? (when ? `last scan ${when}` : "no scans yet") : "loading…"].filter(Boolean).join(" · ");
}
// Up/Down walk the nav like a list; Home/End jump to its ends.
function navKeys(e: KeyboardEvent): void {
  const items = [...document.querySelectorAll<HTMLElement>("#sidebar .nav-item")].filter((x) => x.offsetParent);
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const next = e.key === "ArrowDown" ? items[i + 1] : e.key === "ArrowUp" ? items[i - 1] : e.key === "Home" ? items[0] : e.key === "End" ? items[items.length - 1] : null;
  if (next) { e.preventDefault(); next.focus(); }
}

// ---------------------------------------------------------------- bridge popover
// The state in words, which client it talks to, when it last answered, "Check again" and a way to Settings.
let bridgePop: PopoverHandle | null = null;
function bridgePopoverContent(): HTMLElement[] {
  const v = currentBridgeView();
  const answered = bridgeLastAnswered();
  const adapter = currentAdapter();
  const check = button({ label: "Check again", size: "sm", onClick: async () => { await pollBridge(); openBridgePopover(true); } });
  const settings = el("a", { class: "btn btn-ghost btn-sm", href: "#/settings" }, txt("Client settings"));
  settings.addEventListener("click", () => bridgePop?.close());
  return [
    box("div", { class: "bridge-pop-head" }, el("span", { class: `dot ${v.dot}`.trim() }), el("h3", { class: "t-md strong" }, v.title)),
    el("p", { class: "muted" }, txt(v.detail)),
    keyValue([["Client", adapter?.name || "none set up"], ["Last answered", answered ? relativeWhen(new Date(answered).toISOString()) : "never this session"]]),
    box("div", { class: "bridge-pop-actions" }, check, settings),
  ];
}
function openBridgePopover(refresh = false): void {
  const anchor = $<HTMLElement>("#bridge")!;
  if (refresh && bridgePop?.isOpen()) bridgePop.close();
  bridgePop = popover(anchor, bridgePopoverContent(), { label: "Bridge status" });
}

// ---------------------------------------------------------------- wiring
export function initShell(): void {
  if (typeof matchMedia === "function") { narrow = matchMedia(NARROW); narrow.addEventListener("change", paintCollapse); }
  paintCollapse();
  $<HTMLButtonElement>("#sidebar-pin")!.addEventListener("click", togglePin);
  $<HTMLElement>("#sidebar")!.addEventListener("keydown", navKeys);
  $<HTMLButtonElement>("#bridge")!.addEventListener("click", () => openBridgePopover());
  // ⌘I (Ctrl+I off the Mac) opens Import over whatever page is showing.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); location.hash = "#/import"; }
  });
}

// ---- builder
// A busy dot on a nav item (the Suit Builder's, while a build runs), so work going on in a screen you left
// stays visible from the others.
export function setNavBusy(nav: string, busy: boolean, label = "Build running"): void {
  const item = document.querySelector<HTMLElement>(`#sidebar [data-nav="${nav}"]`);
  if (!item) return;
  const dot = item.querySelector(".nav-busy");
  if (busy && !dot) item.append(el("span", { class: "dot busy nav-busy", role: "img", "aria-label": label }));
  if (!busy) dot?.remove();
}
