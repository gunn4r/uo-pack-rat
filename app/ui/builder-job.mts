// ui/builder-job.mts — the Suit Builder's build job (design spec 4.6): Build checks the panel's fields, starts the optimize
// job (POST /api/optimize) with the panel as a build, follows it over SSE in the inline progress card (its phases, bar and
// stats, Cancel), and ends it with the result shown, parked for another character, a refusal or a cancel. The panel's
// build and the result's drawing are ui/builder.mts's, reached through ui/builder-session.mts's `commands`.
//
// map: builder
// owns: `runBuild`, `cancelJob`, `runPanel`
import { NOBODY } from "../vault-lib.mts";
import type { RunSettings } from "../vault-lib.mts";
import { invStamp, goalsMeta } from "./store.mts";
import type { BuilderJob, BuilderJobUi, FinishedBuild, BuildMeta } from "./store.mts";
import { $, el, fmtN, fmtSecs, toast } from "./dom.mts";
import { box, txt, button, kbd, message, stepper, progress } from "./components.mts";
import { api } from "./api.mts";
import { optimizeErrorMessage } from "./messages.mts";
import { setNavBusy } from "./shell.mts";
import { session, commands, provide } from "./builder-session.mts";
import { followJob, progressText, settingsCheck } from "./builder-parts.mts";
import { firstKnobError, knobFromServerError, who } from "./builder-model.mts";
import type { OptimizeResult, SavedRunLike, OptimizeStartApiResponse, OptimizeCancelApiResponse } from "./api-types.mts";

// The solver knobs as typed (ui/builder-session.mts).
const knobs = session.knobs;
async function runBuild(): Promise<void> {
  if (session.job) return;
  if (commands.filling()) { toast("Manual is filling its empty slots. Wait for it, or cancel it there, before building."); return; }
  if (!session.character || !session.profile) { toast("No character to build for yet: scan one first.", "bad"); return; }
  // A bad field stops the build and takes focus, with its reason under it; the button itself stays enabled.
  const bad = firstKnobError(knobs);
  if (bad) { commands.focusKnob(bad.field, bad.error); return; }
  // A resist cap out of range stops the build from the panel's state, the drawer open or closed: it opens on the field.
  const badCap = commands.badCapDraft();
  if (badCap) {
    commands.focusIn("caps", `#b-cap-${badCap}`, true);
    document.getElementById(`b-cap-${badCap}`)?.closest(".rule-row")?.scrollIntoView({ block: "nearest" });
    return;
  }
  const badRule = document.querySelector<HTMLInputElement>("#b-panel-body .rule-row input[aria-invalid='true']");
  if (badRule) { commands.openSettingsTab(badRule.closest<HTMLElement>("[role=tabpanel]")!.dataset.tab as string, false); badRule.focus(); return; }
  const name = session.character, { pool: settings, opts, profile, snapshot } = commands.panelBuild();
  const exact = knobs.exact, budgetMs = 1000 * Number(knobs.budgetS);
  commands.closeCompare();
  // Pools/current/skipped are the server's job (buildPools against its own cached inventory, POST
  // /api/optimize's by-character form): the page sends the character + settings and reads poolSize/skipped/
  // current/warning back. The job keeps the character and the effective profile it was started with: the
  // player can switch characters while it runs, and the result is judged against these.
  const job: BuilderJob = { id: null, es: null, name, profile, exact, budgetMs, poolSize: null, skipped: {}, current: {}, warning: null, startedAt: Date.now(), lastProgressAt: Date.now(), lastServerAt: Date.now(), last: null, connected: true, ui: null, timer: null };
  session.job = job;
  setBuilding(true);
  job.ui = runPanel(job);
  $<HTMLElement>("#b-msg")!.replaceChildren(job.ui.root);
  // started from the drawer (its Build, or ⌘↵ in one of its fields), the focus stays there to tweak and build again
  if (!$<HTMLElement>("#b-drawer")!.contains(document.activeElement)) job.ui.root.focus();
  let r: (OptimizeStartApiResponse & { ok: true }) | { ok: false; error: string };
  try {
    r = (await api<OptimizeStartApiResponse>("/api/optimize", { method: "POST", body: { character: name, settings, profile, opts,
      meta: { character: name, settings: snapshot, inventoryStamp: invStamp() } } })) as OptimizeStartApiResponse & { ok: true };
    // optimizeErrorMessage (ui/messages.mts) explains the one refusal that isn't about this build at all: 429,
    // four jobs already running (vault-server.mts's MAX_RUNNING_JOBS) — this page only ever runs one.
  } catch (e) { r = { ok: false, error: optimizeErrorMessage(e) }; }
  if (session.job !== job) { if (r.ok) api(`/api/optimize/${r.id}/cancel`, { method: "POST" }).catch(() => {}); return; }   // cancelled while the request was in flight
  if (!r.ok) { failJob(job, r.error); return; }
  job.poolSize = r.poolSize; job.skipped = r.skipped; job.current = r.current; job.warning = r.warning || null;
  // the requirements no suit can reach, said above the progress panel while the search runs
  const checks = r.cached ? null : settingsCheck(r.diagnostics || [], name!);
  if (checks) job.ui!.root.before(checks);
  // r.run.ms is `number | null` (a saved run's on-disk shape); a genuinely null one has never been guarded here.
  if (r.cached) { finishJob(job, { result: r.run!.result, ms: r.run!.ms!, runId: r.run!.id, reused: r.run!, settings: snapshot }); return; }
  job.id = r.id!;
  job.timer = setInterval(() => job.ui!.tick(job), 200) as unknown as number;
  job.es = followJob(job.id, {
    progress: (p) => { job.last = p; job.lastProgressAt = Date.now(); job.lastServerAt = Date.now(); job.connected = true; job.ui!.update(job); },
    alive: (connected) => { if (connected) job.lastServerAt = Date.now(); job.connected = connected; },
    done: (d) => finishJob(job, { ...d, settings: snapshot }),
    failed: (error) => failJob(job, error),
    cancelled: (ms) => endJob(job, cancelledNote(ms)),
  });
}
// While a build runs: the top bar's and the drawer footer's Build buttons say so and are disabled, the sidebar's Suit
// Builder item shows a busy dot, and a result already on screen stays there dimmed and out of reach until the new one lands.
function setBuilding(on: boolean): void {
  for (const [id, key] of [["#b-run", true], ["#b-run-foot", false]] as const) {
    const b = $<HTMLButtonElement>(id)!;
    // the footer's is only marked disabled (runBuild ignores a press while one runs), so it keeps the focus it has
    if (key) b.disabled = on; else if (on) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    b.replaceChildren(...(on ? [txt("Building…")] : [txt("Build"), ...(key ? [kbd("⌘↵")] : [])]));
    b.querySelector(".kbd")?.setAttribute("aria-hidden", "true");
  }
  setNavBusy("builder", on);
  commands.paintChanges();
  const res = $<HTMLElement>("#b-result")!;
  const stale = on && !!session.result;
  res.classList.toggle("b-stale", stale);
  res.inert = stale;
  if (stale) res.setAttribute("aria-hidden", "true"); else res.removeAttribute("aria-hidden");
}
const cancelledNote = (ms: number): HTMLElement => message({ tone: "info", text: `Canceled after ${fmtSecs(ms)}.`, actions: [button({ label: "Build again", size: "sm", onClick: () => runBuild() })] });
// A refusal or failure: an inline message at the top of the results; when it names a field, that field gets
// the error and the focus.
function failJob(job: BuilderJob, text: string): void {
  const hadFocus = endJob(job, message({ tone: "bad", title: "The build did not run", text }));
  const f = knobFromServerError(text);
  if (f) commands.focusKnob(f, text);
  else if (hadFocus) $<HTMLButtonElement>("#b-run")!.focus();
}
// Ends the job and puts `node` where the progress card was. Returns whether focus was inside the card (it
// has focus from the moment a build starts), so the caller can hand it on instead of dropping it on <body>:
// endJob itself hands it to the node's first button ("Build again"), finishJob to the result's heading.
function endJob(job: BuilderJob, node?: HTMLElement | null): boolean {
  if (session.job !== job) return false;
  const msg = $<HTMLElement>("#b-msg")!;
  const hadFocus = msg.contains(document.activeElement);
  clearInterval(job.timer as number | undefined); job.es?.close(); session.job = null;
  setBuilding(false);
  msg.replaceChildren(...(node ? [node] : []));
  if (hadFocus) node?.querySelector<HTMLElement>("button")?.focus();
  return hadFocus;
}
interface JobFinishInfo { result: OptimizeResult; ms: number; runId: string | null; reused?: SavedRunLike | null | undefined; settings: RunSettings }
function finishJob(job: BuilderJob, r: JobFinishInfo): void {
  const meta: BuildMeta = { ms: r.ms, poolSize: job.poolSize, skipped: job.skipped, reused: r.reused || null, ...goalsMeta(r.settings) };
  const finished: FinishedBuild = { name: job.name, result: r.result, current: job.current, profile: job.profile, runId: r.runId || null, meta, settings: r.settings };
  // Switched to another character while it ran: never draw this suit (or its Plan and Grab all) under that
  // character. It waits until its own character is selected again.
  const away = job.name !== session.character;
  const notes = [away ? message({ tone: "info", text: `${who(job.name)}'s build finished. Switch back to ${who(job.name)} to see it.`, attrs: { class: "msg info parked-note" } }) : null,
    job.warning ? message({ tone: "warn", text: job.warning }) : null].filter((x): x is HTMLDivElement => x !== null);
  const hadFocus = endJob(job, null);
  $<HTMLElement>("#b-msg")!.replaceChildren(...notes);
  if (away) { session.parked = finished; if (hadFocus) $<HTMLButtonElement>("#b-run")!.focus(); return; }
  commands.showFinished(finished, hadFocus);
  commands.loadRuns();
}
async function cancelJob(job: BuilderJob): Promise<void> {
  if (!job.id) { endJob(job, cancelledNote(Date.now() - job.startedAt)); return; }
  job.ui!.cancelling();
  try { await api<OptimizeCancelApiResponse>(`/api/optimize/${job.id}/cancel`, { method: "POST" }); } catch { /* the server is gone; nothing to stop */ }
  endJob(job, cancelledNote(Date.now() - job.startedAt));
}

// The inline progress card: busy dot, what is being built, Cancel (Esc while the card has focus), the three
// phases, a determinate bar (restarts, then the time budget of the exact phase, then the other suits found),
// and the stat row. The phase changes are announced; the numbers that tick every 200 ms are not.
const PHASES: Array<[string, string]> = [["heuristic", "Hill climbing"], ["exact", "Proving with HiGHS"], ["alternatives", "Other suits"]];
function runPanel(job: BuilderJob): BuilderJobUi {
  const dot = el("span", { class: "dot busy", role: "img", "aria-label": "Solver running" });
  const cancel = button({ label: "Cancel", kbd: "Esc", onClick: () => cancelJob(job) });
  const phases = PHASES.filter(([k]) => job.exact || k === "heuristic");
  let step = stepper(phases.map(([, l]) => l), 0, "Build phases");
  const bar = progress(0, 1000, "Build progress");
  const main = txt("Starting…"), cand = txt("", "muted");
  const live = el("span", { class: "sr", "aria-live": "polite" }, "Hill climbing");
  const stat = (lbl: string): [HTMLElement, HTMLSpanElement] => { const v = txt("—", "v"); return [box("div", { class: "b-stat" }, txt(lbl, "t-sm muted"), v), v]; };
  const [sBest, vBest] = stat("Best so far"), [sReq, vReq] = stat("Requirements met"), [sCand, vCand] = stat("Candidates"), [sTime, vTime] = stat("Elapsed"), [sBeat, vBeat] = stat("Solver");
  const root = box("section", { class: "card b-progress", "aria-label": "Build progress", tabindex: "-1" },
    box("div", { class: "b-row" }, dot, el("h2", { class: "t-lg" }, job.name === NOBODY ? "Building a suit for No character" : `Building ${job.name}'s suit`), txt(job.exact ? `exact search · budget ${job.budgetMs / 1000} s` : "heuristic search", "muted"), el("span", { class: "spacer" }), cancel),
    step,
    box("div", { class: "b-prog" }, bar, box("div", { class: "b-prog-line" }, main, txt("·", "faint"), cand, el("span", { class: "spacer" }), txt("You can keep using Pack Rat while this runs", "muted"))),
    box("div", { class: "b-stats" }, sBest, sReq, sCand, sTime, sBeat), live);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelJob(job); } });
  let shownPhase = 0;
  // a rarity preference's second stage (tie-break) is part of the exact phase's step
  const phaseIdx = (p: string): number => (p === "done" ? phases.length : Math.max(0, phases.findIndex(([k]) => k === (p === "tie-break" ? "exact" : p))));
  const ui: BuilderJobUi = {
    root,
    update(j: BuilderJob) {
      const p = j.last; if (!p) return;
      const cur = phaseIdx(p.phase);
      if (cur !== shownPhase) {
        shownPhase = cur;
        const next = stepper(phases.map(([, l]) => l), cur, "Build phases");
        step.replaceWith(next); step = next;
        live.textContent = cur < phases.length ? phases[cur]![1] : "Finishing";
      }
      const { frac, text, detail } = progressText(p);
      main.textContent = text; cand.textContent = detail;
      bar.set(Math.round(frac * 1000));
      vBest.textContent = p.improvements ? `improved ${fmtN(p.improvements)}× · at ${fmtSecs(p.lastImprovementMs!)}` : "the current suit";
      vReq.className = "v";
      if (p.floorsTotal) { vReq.textContent = `${p.floorsMet} of ${p.floorsTotal}`; vReq.classList.add("strong", p.floorsMet === p.floorsTotal ? "tone-ok" : "tone-warn"); }
      else vReq.textContent = "none set";
      vCand.textContent = fmtN(p.candidates);
    },
    tick(j: BuilderJob) {
      const now = Date.now();
      vTime.textContent = fmtSecs(now - j.startedAt);
      const silent = (now - j.lastProgressAt) / 1000;
      let tone = "", text = `alive · ${silent < 1 ? "just now" : silent.toFixed(0) + " s ago"}`;
      if (!j.connected) { tone = "warn"; text = "connection lost · reconnecting"; }
      else if (silent > 12) { tone = "bad"; text = `silent for ${silent.toFixed(0)} s: probably hung, cancel and build again`; }
      else if (silent > 4) { tone = "warn"; text = `no update for ${silent.toFixed(0)} s`; }
      dot.className = `dot ${tone || "busy"}`;
      vBeat.className = `v${tone ? ` tone-${tone}` : ""}`; vBeat.textContent = text;
    },
    cancelling() { cancel.disabled = true; cancel.replaceChildren(txt("Canceling…")); },
  };
  return ui;
}

provide({ build: () => { void runBuild(); } });
