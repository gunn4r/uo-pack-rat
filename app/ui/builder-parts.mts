// ui/builder-parts.mts — what more than one Suit Builder module draws or reads, holding no state of its own: a piece's
// key properties and item tooltip, a result's verdict, the Fetch list and its Grab all (the result's and Manual's), and
// an optimize job's event stream and progress words (the Automatic build's and Manual's fill).
import { RESIST_META } from "../vault-lib.mts";
import type { Item, PropMap } from "../vault-lib.mts";
import { state } from "./store.mts";
import { el, label, fmtN, itemTip, toast, whereText } from "./dom.mts";
import { box, txt, button, tipWrap, tooltip, copyText } from "./components.mts";
import { CLIENT_ID } from "./api.mts";
import { bridgeActionReason, runBridgeAction, grabAll, grabbable } from "./bridge.mts";
import { splitSerial } from "./item-parts.mts";
import { locationCrumbs, plural } from "./builder-model.mts";
import type { OptimizeResult, OptimizeProgress, JobSnapshotEvent, JobDoneEvent, JobFailedEvent, JobCancelledEvent } from "./api-types.mts";

export const RESIST_NAMES: Record<string, [string, string]> = Object.fromEntries(RESIST_META.map((r) => [r.key, [r.long, r.token]]));
const serialHex = (s: number): string => `0x${s.toString(16)}`;

// A piece's key properties, strongest first: "SSI 35 · DCI 11 · Hit Fireball 36".
export function keyProps(props: PropMap | undefined, n = 3): string {
  return Object.entries(props || {}).filter(([k, v]) => k !== "tagPenalty" && !k.endsWith("Pool") && v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n).map(([k, v]) => `${label(k)} ${v}`).join(" · ");
}
// A piece the item tooltip answers for (dom.mts's itemTip): on hover, and after 400 ms of keyboard focus.
export function tipTarget<T extends HTMLElement>(node: T, item: { serial: number; name: string }): T {
  node.classList.add("b-tip");
  return itemTip(node, item);
}

export function verdict(res: OptimizeResult): { text: string; tone?: "ok" | "warn" | "bad" | undefined; detail?: string | undefined } {
  if (res.method === "manual") return { text: "Manual" };
  if (res.floorsConflict) return { text: "Requirements can't all be met", tone: "bad", detail: "No suit in the pool meets every hard requirement; this is the best partial suit." };
  if (res.solver === "fallback") return { text: "Heuristic fallback", tone: "warn", detail: res.fallbackReason || "The exact solver was unavailable, so this is the heuristic's answer." };
  if (res.method === "exact" && res.proven) return { text: "Proven optimal", tone: "ok" };
  // A saved run whose proof the server withdrew (normalizeRun): no verdict, rather than a different one.
  if (res.method === "exact" && res.proven == null) return { text: "" };
  if (res.method === "exact") return { text: "Best within budget", tone: "warn", detail: res.gapPoints == null ? "No bound was established: raise the time budget to finish the proof." : `At most ${fmtN(res.gapPoints)} points from the bound: raise the time budget to finish the proof.` };
  return { text: "Heuristic" };
}

// ---- the fetch list: one row per container, walk to each once
// The row's place in full, as a path that wraps between and inside crumbs, never cut short: "Dorran's bank ›
// Metal Chest 0x… › A Bag", selectable so any part of it can be copied. A crumb's serial (a same-named sibling's
// tell) is drawn in faint mono; the last crumb's is left out when the row's meta line already shows it.
function crumbsEl(where: string, contHex: string): HTMLOListElement {
  const crumbs = locationCrumbs(where);
  return el("ol", { class: "b-place", "aria-label": `Location: ${where}` }, ...crumbs.map((c, i) => {
    const { name: nm, serial } = splitSerial(c);
    const showSerial = serial && !(i === crumbs.length - 1 && serial.toLowerCase() === contHex);
    return el("li", {}, i ? el("span", { class: "b-place-sep", "aria-hidden": "true" }, "›") : null, i ? " " : null,
      txt(nm, "b-place-name"), showSerial ? " " : null, showSerial ? txt(serial, "mono faint t-sm") : null, " ");
  }));
}
// A small icon button that copies `text` (a serial) and says so in a toast; it ends its line, so its tooltip
// sits in the free space to its right.
function copyButton(text: string, what: string): HTMLButtonElement {
  const b = button({ label: `Copy ${what} ${text}`, icon: "clipboard", iconOnly: true, size: "sm", variant: "ghost",
    onClick: async () => { if (await copyText(text)) toast(`Copied ${text}`, "good"); else toast(`Could not copy the ${what}.`, "bad"); } });
  tooltip(b, `Copy ${what}`, { side: "right" });   // beside it, never over the place's path above
  return b;
}
// Grab all the pieces to fetch into `name`'s backpack (the result's headline, Manual's fetch list), disabled with its
// reason; with no character (`name` null, Manual) a plain "Grab", disabled: there is no backpack to grab into.
export function grabAllButton(items: Item[], name: string | null, { id, size }: { id: string; size?: "sm" | undefined }): HTMLElement {
  const todo = name ? grabbable(items, name) : [];
  const gate = !name ? "Choose a character to grab for" : todo.length ? bridgeActionReason("grab", todo[0]!) : `Nothing to grab: every piece is already with ${name} or worn.`;
  const grab = button({ label: !name ? "Grab" : todo.length ? `Grab all ${todo.length}` : "Grab all", icon: "grab", variant: "primary", size, disabled: !!gate, onClick: () => grabAll(items, name!), attrs: { id } });
  return gate ? tipWrap(grab, gate) : grab;
}
// The result's, and Manual's (issue #12), for the manual suit's pieces the character doesn't wear, with `head` (its Grab
// all) in the card's head; with no character (`name` null) there is no backpack to grab into, and Go to still works.
export function fetchCard(items: Item[], name: string | null, head: HTMLElement | null = null): HTMLElement | null {
  if (!items.length) return null;
  const groups = new Map<string, Item[]>();
  for (const it of items) { const k = `${it.container ?? it.location?.text}`; groups.set(k, [...(groups.get(k) || []), it]); }
  const rows = [...groups.values()].map((list) => {
    const first = list[0]!, cont = first.container != null ? state.inv!.containers[first.container] : null;
    const where = first.equippedBy ? `Worn by ${first.equippedBy}` : whereText(first.location?.text) || "Unknown place";
    const mine = name ? grabbable(list, name) : [];
    const goGate = bridgeActionReason("goto", first);
    const grabGate = !name ? "Choose a character to grab for" : mine.length ? bridgeActionReason("grab", mine[0]!) : `Nothing to grab here: it is already with ${name} or worn.`;
    const go = button({ label: "Go to", size: "sm", icon: "goto", disabled: !!goGate, onClick: () => runBridgeAction("goto", first) });
    const grab = button({ label: `Grab ${mine.length || list.length}`, size: "sm", icon: "grab", disabled: !!grabGate, onClick: () => grabAll(list, name!) });
    const pieces = el("ul", { class: "b-fetch-pieces", "aria-label": `${plural(list.length, "piece")} to fetch` },
      ...list.map((it) => el("li", {}, tipTarget(txt(it.name, "b-fetch-piece"), it))));
    const contHex = cont ? serialHex(+cont.serial) : "";
    return box("div", { class: "b-fetch" },
      box("div", { class: "b-fetch-where" }, crumbsEl(where, contHex),
        box("div", { class: "b-fetch-meta t-sm" }, txt(`${plural(list.length, "piece")}${contHex ? " ·" : ""}`, "faint"),
          contHex ? txt(contHex, "mono") : null, contHex ? copyButton(contHex, "container serial") : null)),
      pieces,
      box("span", { class: "b-fetch-acts" }, goGate ? tipWrap(go, goGate) : go, grabGate ? tipWrap(grab, grabGate) : grab));
  });
  return el("section", { class: "card", "aria-label": "Fetch list" },
    box("div", { class: "card-head" }, el("h2", {}, "Fetch list"), txt("Walk to each container once", "t-sm muted"), head ? el("span", { class: "spacer" }) : null, head),
    box("div", { class: "b-fetch-list" }, ...rows));
}

// ---- an optimize job
export interface JobEvents { progress(p: OptimizeProgress): void; alive?(connected: boolean): void; done(d: JobDoneEvent): void; failed(error: string): void; cancelled(ms: number): void }
// An optimize job's events (the Automatic build, and Manual's "Fill the rest automatically"): its progress, then done,
// failed or cancelled. EventSource can't carry the X-Client-Id header (or the token): the server checks this ?client=
// param against the job's own owner instead (vault-server.mts's events route).
export function followJob(id: string, on: JobEvents): EventSource {
  const es = new EventSource(`/api/optimize/${id}/events?client=${encodeURIComponent(CLIENT_ID)}`);
  es.addEventListener("hello", (e: MessageEvent<string>) => {
    const snap = JSON.parse(e.data) as JobSnapshotEvent;
    if (snap.progress) on.progress(snap.progress);
    if (snap.state === "done") on.done({ result: snap.result!, ms: snap.ms!, runId: snap.runId });
    else if (snap.state === "error") on.failed(snap.error || "The build failed.");
    // job.ms is always set immediately before cancelJob()'s finish() call that produces this event.
    else if (snap.state === "cancelled") on.cancelled(snap.ms!);
  });
  es.addEventListener("progress", (e: MessageEvent<string>) => on.progress(JSON.parse(e.data) as OptimizeProgress));
  es.addEventListener("ping", () => on.alive?.(true));
  es.addEventListener("done", (e: MessageEvent<string>) => on.done(JSON.parse(e.data) as JobDoneEvent));
  es.addEventListener("failed", (e: MessageEvent<string>) => on.failed((JSON.parse(e.data) as JobFailedEvent).error));
  es.addEventListener("cancelled", (e: MessageEvent<string>) => on.cancelled((JSON.parse(e.data) as JobCancelledEvent).ms));
  // EventSource reconnects by itself and "hello" then catches us up — unless the server refused the stream (a
  // restart forgot the job: 404), after which it stays closed for good.
  es.onerror = () => {
    on.alive?.(false);
    if (es.readyState === EventSource.CLOSED) on.failed("Lost the build: the server no longer knows this job (it may have restarted). Build again.");
  };
  return es;
}
// A progress packet in words, with how far along it is (0 to 1): the build's progress card and Manual's fill read it.
// Every field read bare below is one the server's progress packet always sets for that phase (see api-types.mts's
// OptimizeProgress): the `!` documents that rather than inventing a fallback value.
export function progressText(p: OptimizeProgress): { frac: number; text: string; detail: string } {
  const clamp = (f: number): number => Math.max(0, Math.min(1, f));
  if (p.phase === "heuristic") return { frac: clamp(p.restarts ? p.restartsDone! / p.restarts : 0), text: `Restart ${fmtN(p.restartsDone)} of ${fmtN(p.restarts)}`, detail: `${fmtN(p.candidates)} candidate items` };
  if (p.phase === "exact") return { frac: clamp(p.budgetMs ? p.elapsedMs! / p.budgetMs : 0), text: p.gapPoints == null ? "Proving: no bound yet" : `Proving: at most ${fmtN(p.gapPoints)} points from the bound`, detail: `${fmtN(p.nodes)} search nodes · ${fmtN(p.candidates)} candidates` };
  if (p.phase === "alternatives") return { frac: clamp(p.wanted ? p.found! / p.wanted : 1), text: `${fmtN(p.found)} of ${fmtN(p.wanted)} other suits found`, detail: "" };
  return { frac: 1, text: "Finishing…", detail: "" };
}
