// ui/builder.mjs — the Suit Builder tab: character/template sidebar, requirements & weights,
// the optimize job (progress panel, SSE), and the result panel. The saved-runs drawer
// (history/open/compare) moved out to ui/runs.mjs (Task 5, the page split, part B).
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
import { PROP_LABELS, OPTIMIZER_SLOTS, tagUnits, WEAPON_SKILLS, resistSkillBonus, effectiveProfile, getRules, RESIST_KEYS, templateFrom, requirementReport, totalsOf, settingsDiff, bagLabel } from "../vault-lib.mjs";
import { state, invStamp } from "./store.mjs";
import { $, el, label, full, fmtN, fmtSecs, fmtRunTime, slotLabel, toast } from "./dom.mjs";
import { api, CLIENT_ID } from "./api.mjs";
import { sheetHtml } from "./sheet.mjs";
import { actButtons, grabAllRow } from "./bridge.mjs";
import { resolveItems } from "./items.mjs";
import { parseRoute, routeFor } from "./app.mjs";
import { loadRuns, settingsSnapshot, openRunsDrawer, closeRunsDrawer, renderRuns, compareSelected } from "./runs.mjs";

// ---------------------------------------------------------------- suit builder
export function buildBuilder() {
  const names = [...new Set([...Object.keys(state.inv.characters), ...Object.keys(state.profiles.characters || {})])];
  $("#b-char").replaceChildren(...names.map((n) => el("option", { value: n }, n)));
  $("#b-char").onchange = () => selectCharacter($("#b-char").value);
  $("#b-tpl-apply").onclick = applyTemplate; $("#b-tpl-saveas").onclick = saveTemplateAs; $("#b-tpl-update").onclick = updateTemplate; $("#b-tpl-delete").onclick = deleteTemplate;
  for (const ev of ["input", "change", "click"]) $("#tab-builder aside").addEventListener(ev, updateTemplatePill);   // any edit to the sidebar re-checks the drift
  $("#b-run").onclick = runBuild;
  $("#b-save").onclick = saveProfile;
  $("#b-weapon").append(...WEAPON_SKILLS.map((w) => el("option", { value: w }, w[0].toUpperCase() + w.slice(1) + " only")));
  $("#b-compare").onclick = compareSelected;
  $("#b-race").onchange = () => { state.builder.profile.race = $("#b-race").value; renderProfile(); };
  $("#b-runs-open").onclick = openRunsDrawer;
  $("#b-runs-close").onclick = closeRunsDrawer;
  $("#runs-drawer .drawer-backdrop").onclick = closeRunsDrawer;
  $("#b-runs-filter").oninput = () => renderRuns();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#runs-drawer").classList.contains("open")) closeRunsDrawer(); });
  $("#b-addfloor-btn").onclick = () => { state.builder.profile.floors[$("#b-addfloor").value] ??= 0; renderProfile(); };
  $("#b-addweight-btn").onclick = () => { state.builder.profile.weights[$("#b-addweight").value] ??= 1; renderProfile(); };
  if (names.length) { const want = parseRoute().character; selectCharacter(names.includes(want) ? want : names[0]); }
}
export function selectCharacter(name) {
  state.builder.character = name;
  if (parseRoute().tab === "builder") history.replaceState(null, "", routeFor("builder"));
  const saved = state.profiles.characters?.[name], [firstTpl] = Object.keys(state.profiles.templates || {});
  state.builder.profile = saved ? JSON.parse(JSON.stringify(saved)) : { ...templateFrom(state.profiles.templates?.[firstTpl]), template: firstTpl, race: "human" };
  state.builder.profile.excludeRoots ??= [];
  $("#b-char").value = name;
  const c = state.inv.characters[name];
  $("#b-str").value = state.builder.profile.strLimit ?? (c ? c.stats.str : 125);
  $("#b-race").value = state.builder.profile.race || "human";
  poolControls(state.builder.profile);
  renderTemplateOptions(state.builder.profile.template);
  renderProfile();
  $("#b-result").replaceChildren(el("div", { class: "panel empty" }, `Press Build best suit for ${name}.`));
  state.builder.compare = new Set(); state.builder.openRun = null;
  loadRuns();
}
// The pool checkboxes and the weapon select are read into the profile on demand (readControls) and set from it (poolControls).
export function poolControls(p) {
  $("#b-garg").checked = !!p.allowGargoyle; $("#b-med").checked = !!p.medOnly; $("#b-weapon").value = p.weaponSkill || ""; $("#b-others").checked = !!p.allowOthersWorn;
}
export function readControls() {
  const p = state.builder.profile;
  p.strLimit = +$("#b-str").value; p.allowGargoyle = $("#b-garg").checked; p.medOnly = $("#b-med").checked; p.weaponSkill = $("#b-weapon").value || null; p.race = $("#b-race").value; p.allowOthersWorn = $("#b-others").checked;
  return p;
}
// ---- templates: settings snapshots with no character in them; a profile remembers which one it was applied from
function renderTemplateOptions(selected) {
  const names = Object.keys(state.profiles.templates ||= {});
  $("#b-tpl").replaceChildren(...names.map((n) => el("option", { value: n }, n)));
  if (names.includes(selected)) $("#b-tpl").value = selected;
  updateTemplatePill();
}
function templateDrift() {
  const name = state.builder.profile.template, tpl = state.profiles.templates?.[name];
  if (!name) return { cls: "", text: "no template", title: "Save as… stores the sidebar's settings as a template" };
  if (!tpl) return { cls: "bad", text: `template ${name} missing`, title: `these settings came from a template named ${name} that no longer exists` };
  const lines = settingsDiff(templateFrom(tpl), templateFrom(readControls()));
  return lines.length ? { cls: "warn", text: `modified from ${name}`, title: lines.join("\n") } : { cls: "good", text: `matches ${name}`, title: `the sidebar's settings equal the ${name} template` };
}
function updateTemplatePill() {
  if (!state.builder.profile) return;
  const d = templateDrift(), s = $("#b-tpl-state");
  s.className = "pill " + d.cls; s.textContent = d.text; s.title = d.title;
}
async function putProfiles() {
  try { return await api("/api/profiles", { method: "PUT", body: state.profiles }); }
  catch (e) { return { ok: false, error: e.message }; }
}
async function saveTemplates(done) {
  const r = await putProfiles();
  toast(r.ok ? done : r.error, r.ok ? "good" : "bad");
}
function applyTemplate() {
  const name = $("#b-tpl").value, t = state.profiles.templates[name];
  if (!t) return;
  const p = state.builder.profile;
  Object.assign(p, templateFrom(t), { template: name });
  poolControls(p);
  renderProfile();
  toast(`${name} applied to the sidebar. Save profile to keep it.`, "good");
}
async function saveTemplateAs() {
  const name = (prompt("Template name", state.builder.profile.template || "") || "").trim();
  if (!name || (state.profiles.templates[name] && !confirm(`Overwrite the ${name} template?`))) return;
  state.profiles.templates[name] = templateFrom(readControls());
  state.builder.profile.template = name;
  renderTemplateOptions(name);
  await saveTemplates(`Template ${name} saved.`);
}
async function updateTemplate() {
  const name = $("#b-tpl").value;
  if (!state.profiles.templates[name] || !confirm(`Overwrite the ${name} template with the sidebar's settings?`)) return;
  state.profiles.templates[name] = templateFrom(readControls());
  state.builder.profile.template = name;
  updateTemplatePill();
  await saveTemplates(`Template ${name} updated.`);
}
async function deleteTemplate() {
  const name = $("#b-tpl").value;
  if (!state.profiles.templates[name] || !confirm(`Delete the ${name} template? Characters made from it keep their settings.`)) return;
  delete state.profiles.templates[name];
  renderTemplateOptions();
  await saveTemplates(`Template ${name} deleted.`);
}
// numGrid mutates the `obj` (floors/weights) it's handed directly, by reference — no return value.
function numGrid(container, obj, keysAll, step, softSet = null) {
  container.replaceChildren(...Object.keys(obj).filter((k) => k !== "tagPenalty").map((k) => el("label", { title: full(k) }, el("span", {}, label(k)),
    el("span", { class: "row" },
      softSet ? el("label", { class: "small muted", title: "soft: a preference the optimizer may trade away. Unticked = hard requirement." }, el("input", { type: "checkbox", checked: softSet.includes(k) ? "" : null, onchange: (e) => { const i = softSet.indexOf(k); if (e.target.checked && i < 0) softSet.push(k); if (!e.target.checked && i >= 0) softSet.splice(i, 1); } }), " soft") : null,
      el("input", { type: "number", step, value: obj[k], oninput: (e) => { obj[k] = +e.target.value; } }), el("button", { class: "small", title: "remove", onclick: () => { delete obj[k]; renderProfile(); } }, "×")))));
  for (const o of container.querySelectorAll("input[checked='null']")) o.removeAttribute("checked");
}
export function renderProfile() {
  const p = state.builder.profile;
  p.softFloors ||= [];
  numGrid($("#b-floors"), p.floors ||= {}, state.propKeys, 1, p.softFloors);
  numGrid($("#b-weights"), p.weights ||= {}, state.propKeys, 0.5);
  const allKeys = [...new Set([...Object.keys(PROP_LABELS), ...state.propKeys, "stamPool", "manaPool", "hitsPool", ...(state.facets?.gearSkills || []).map((k) => `sk:${k}`)])].filter((k) => k !== "tagPenalty").sort((a, b) => label(a).localeCompare(label(b)));
  $("#b-addfloor").replaceChildren(...allKeys.map((k) => el("option", { value: k }, `${label(k)} — ${full(k)}`)));
  $("#b-addweight").replaceChildren(...allKeys.map((k) => el("option", { value: k }, `${label(k)} — ${full(k)}`)));
  p.lockedSlots ||= [];
  $("#b-locked").replaceChildren(...OPTIMIZER_SLOTS.map((s) => el("button", { class: "chip", "aria-pressed": p.lockedSlots.includes(s), onclick: (e) => { p.lockedSlots = p.lockedSlots.includes(s) ? p.lockedSlots.filter((x) => x !== s) : [...p.lockedSlots, s]; e.target.setAttribute("aria-pressed", p.lockedSlots.includes(s)); } }, slotLabel(s))));
  const rsb = resistSkillBonus(state.inv.characters[state.builder.character]?.skills);
  const rules = getRules(), baseCap = rules.caps.physResist, raceCap = rules.raceCaps?.[p.race]?.energyResist ?? baseCap;
  $("#b-resist-note").textContent = `Resist floors are paperdoll values. Resisting Spells gives ${state.builder.character} +${rsb} to every resist, so gear only has to supply up to ${baseCap - rsb}${raceCap !== baseCap ? ` (Energy ${raceCap - rsb}: a ${p.race}'s cap is ${raceCap})` : ""}.`;
  p.excludeSkills ||= [];
  $("#b-exskills").replaceChildren(...[...new Set([...(state.facets?.gearSkills || []), ...p.excludeSkills])].sort().map((sk) => el("button", { class: "chip", "aria-pressed": p.excludeSkills.includes(sk), onclick: (e) => { p.excludeSkills = p.excludeSkills.includes(sk) ? p.excludeSkills.filter((x) => x !== sk) : [...p.excludeSkills, sk]; e.target.setAttribute("aria-pressed", p.excludeSkills.includes(sk)); } }, sk)));
  p.excludeTags ||= [];
  $("#b-extags").replaceChildren(...Object.keys(tagUnits()).map((t) => el("button", { class: "chip", "aria-pressed": p.excludeTags.includes(t), onclick: (e) => { p.excludeTags = p.excludeTags.includes(t) ? p.excludeTags.filter((x) => x !== t) : [...p.excludeTags, t]; e.target.setAttribute("aria-pressed", p.excludeTags.includes(t)); } }, t)));
  const roots = Object.values(state.inv.containers).filter((c) => c.parent == null);
  $("#b-exroots").replaceChildren(...roots.map((r) => el("button", { class: "chip", "aria-pressed": p.excludeRoots.includes(r.serial), onclick: (e) => { p.excludeRoots = p.excludeRoots.includes(r.serial) ? p.excludeRoots.filter((x) => x !== r.serial) : [...p.excludeRoots, r.serial]; e.target.setAttribute("aria-pressed", p.excludeRoots.includes(r.serial)); } }, `${r.kind === "ground" ? "" : r.scannedBy + "'s "}${bagLabel(r)}`)));
  updateTemplatePill();
}
function optimizerProfile() {
  return effectiveProfile(state.builder.profile, state.inv.characters[state.builder.character]);
}
async function runBuild() {
  const name = state.builder.character, p = readControls();
  const settings = { allowOthersWorn: p.allowOthersWorn, strLimit: p.strLimit, excludeTags: p.excludeTags, excludeRoots: p.excludeRoots, allowGargoyle: p.allowGargoyle, medOnly: p.medOnly, weaponSkill: p.weaponSkill, excludeSkills: p.excludeSkills || [], lockedSlots: p.lockedSlots };
  const exact = $("#b-exact").checked, budgetMs = 1000 * (+$("#b-budget").value || 300);
  const altCount = Math.max(0, Math.min(20, +$("#b-altcount").value || 0)), altTol = Math.max(0, +$("#b-alttol").value || 0);
  const opts = { restarts: +$("#b-restarts").value || 200, exact, timeBudgetMs: budgetMs, ...(exact && altCount > 0 ? { alternatives: { count: altCount, tolerance: altTol } } : {}) };
  // Pools/current/skipped are the server's job now (buildPools against its own cached inventory,
  // POST /api/optimize's by-character form) — the client only ever sends the character + settings
  // and reads poolSize/skipped/current/warning back off the response.
  const job = { id: null, es: null, name, exact, budgetMs, poolSize: null, skipped: {}, current: {}, warning: null, startedAt: Date.now(), lastProgressAt: Date.now(), lastServerAt: Date.now(), last: null, connected: true, ui: null, timer: null };
  state.builder.job = job;
  $("#b-run").disabled = true;
  job.ui = runPanel(job);
  $("#b-msg").replaceChildren(job.ui.root);
  let r;
  try {
    r = await api("/api/optimize", { method: "POST", body: { character: name, settings, profile: optimizerProfile(), opts,
      meta: { character: name, settings: settingsSnapshot(), inventoryStamp: invStamp() } } });
  } catch (e) { r = { ok: false, error: e.message }; }
  if (state.builder.job !== job) { if (r.ok) api(`/api/optimize/${r.id}/cancel`, { method: "POST" }).catch(() => {}); return; }   // cancelled while the request was in flight
  if (!r.ok) { endJob(job, el("div", { class: "msg bad" }, r.error)); return; }
  job.poolSize = r.poolSize; job.skipped = r.skipped; job.current = r.current; job.warning = r.warning || null;
  if (r.cached) { finishJob(job, { result: r.run.result, ms: r.run.ms, runId: r.run.id, reused: r.run }); return; }
  job.id = r.id;
  job.timer = setInterval(() => job.ui.tick(job), 200);
  // EventSource can't carry the X-Client-Id header (or the token) — the server instead checks this
  // ?client= query param against the job's own owner (see vault-server.mjs's events route).
  const es = new EventSource(`/api/optimize/${job.id}/events?client=${encodeURIComponent(CLIENT_ID)}`);
  job.es = es;
  const onProgress = (p) => { job.last = p; job.lastProgressAt = Date.now(); job.lastServerAt = Date.now(); job.connected = true; job.ui.update(job); };
  es.addEventListener("hello", (e) => {
    const snap = JSON.parse(e.data);
    if (snap.progress) onProgress(snap.progress);
    if (snap.state === "done") finishJob(job, { result: snap.result, ms: snap.ms, runId: snap.runId });
    else if (snap.state === "error") endJob(job, el("div", { class: "msg bad" }, snap.error));
    else if (snap.state === "cancelled") endJob(job, el("div", { class: "msg" }, `Cancelled after ${fmtSecs(snap.ms)}.`));
  });
  es.addEventListener("progress", (e) => onProgress(JSON.parse(e.data)));
  es.addEventListener("ping", () => { job.lastServerAt = Date.now(); job.connected = true; });
  es.addEventListener("done", (e) => finishJob(job, JSON.parse(e.data)));
  es.addEventListener("failed", (e) => endJob(job, el("div", { class: "msg bad" }, JSON.parse(e.data).error)));
  es.addEventListener("cancelled", (e) => endJob(job, el("div", { class: "msg" }, `Cancelled after ${fmtSecs(JSON.parse(e.data).ms)}.`)));
  es.onerror = () => { job.connected = false; };   // EventSource reconnects by itself; "hello" then catches us up
}
function endJob(job, node) {
  if (state.builder.job !== job) return;
  clearInterval(job.timer); job.es?.close(); state.builder.job = null;
  $("#b-run").disabled = false;
  if (node) $("#b-msg").replaceChildren(node);
}
function finishJob(job, r) {
  const stats = runStats({ ok: true, result: r.result, ms: r.ms }, job.poolSize, job.skipped, null, r.reused || null);
  endJob(job, job.warning ? el("div", { class: "stack" }, el("div", { class: "msg warn" }, job.warning), stats) : stats);
  state.builder.result = r.result;
  state.builder.openRun = r.runId || null;
  state.builder.altView = null;
  renderResult(r.result, job.current).catch(resultLoadError);
  loadRuns();
}
export async function cancelJob(job) {
  if (!job.id) { endJob(job, el("div", { class: "msg" }, "Cancelled.")); return; }
  job.ui.cancelling();
  try { await api(`/api/optimize/${job.id}/cancel`, { method: "POST" }); } catch { /* the server is gone; nothing to stop */ }
  endJob(job, el("div", { class: "msg" }, `Cancelled after ${fmtSecs(Date.now() - job.startedAt)}.`));
}

// The live progress panel: phases, a real progress bar (restarts, then the fraction of the search
// tree behind the exact search), the time budget, and a heartbeat that turns warn/bad when the
// solver stops reporting.
const PHASES = [["heuristic", "hill climbing"], ["exact", "proving with HiGHS"], ["alternatives", "other suits"]];
function runPanel(job) {
  const beat = el("span", { class: "beat", title: "solver heartbeat" });
  const title = el("strong", {}, `Building ${job.name}'s suit`);
  const sub = el("span", { class: "muted" }, job.exact ? `exact search · budget ${job.budgetMs / 1000} s` : "heuristic search");
  const cancel = el("button", { onclick: () => cancelJob(job) }, "Cancel");
  const steps = el("div", { class: "steps" });
  const fill = el("div", { class: "fill" });
  const bar = el("div", { class: "bar" }, fill);
  const tfill = el("div", { class: "fill" });
  const tbar = el("div", { class: "bar time", title: "time budget of the exact phase" }, tfill);
  const line = el("div", { class: "small muted" }, "starting…");
  const stat = (label) => { const v = el("div", { class: "stat-v num" }, "—"); return [el("div", { class: "stat" }, el("div", { class: "stat-k" }, label), v), v]; };
  const [sBest, vBest] = stat("best so far"), [sFloors, vFloors] = stat("floors met"), [sCand, vCand] = stat("candidates"), [sTime, vTime] = stat("elapsed"), [sBeat, vBeat] = stat("solver");
  const root = el("div", { class: "panel run" },
    el("div", { class: "run-head" }, beat, title, sub, el("span", { class: "grow" }), cancel),
    steps, bar, job.exact ? tbar : null, line,
    el("div", { class: "stats" }, sBest, sFloors, sCand, sTime, sBeat));
  const phaseIdx = (p) => p === "done" ? PHASES.length : Math.max(0, PHASES.findIndex(([k]) => k === p));
  const ui = {
    root,
    update(j) {
      const p = j.last; if (!p) return;
      const cur = phaseIdx(p.phase);
      steps.replaceChildren(...PHASES.filter(([k]) => j.exact || k === "heuristic").map(([k, lbl], i) =>
        el("span", { class: "step " + (i < cur ? "done" : i === cur ? "active" : "todo") }, i < cur ? "✓ " : "", lbl)));
      let frac = 0;
      if (p.phase === "heuristic") { frac = p.restarts ? p.restartsDone / p.restarts : 0; line.textContent = `restart ${fmtN(p.restartsDone)} of ${fmtN(p.restarts)} · ${fmtN(p.candidates)} candidate items`; }
      else if (p.phase === "exact") {
        frac = p.budgetMs ? Math.min(1, p.elapsedMs / p.budgetMs) : 0;
        const bestPart = p.bestScore == null ? "no suit found yet" : `best so far ${fmtN(p.bestScore - p.currentScore)} over the worn suit`;
        const boundPart = p.gapPoints == null ? "no bound yet" : `at most ${fmtN(p.gapPoints)} points from the bound`;
        line.textContent = `${bestPart} · ${boundPart} · ${fmtN(p.nodes)} nodes · ${fmtN(p.candidates)} candidates`;
      }
      else if (p.phase === "alternatives") { frac = p.wanted ? p.found / p.wanted : 1; line.textContent = `${fmtN(p.found)} of ${fmtN(p.wanted)} other suits found`; }
      else { frac = 1; line.textContent = "finishing…"; }
      fill.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
      if (j.exact) tfill.style.width = p.phase === "exact" || p.phase === "done" ? `${Math.min(100, ((p.elapsedMs - (j.exactStartMs ??= p.elapsedMs)) / p.budgetMs) * 100)}%` : "0%";
      vBest.textContent = p.improvements ? `improved ${fmtN(p.improvements)}× · last at ${fmtSecs(p.lastImprovementMs)}` : "current suit";
      vFloors.textContent = p.floorsTotal ? `${p.floorsMet} / ${p.floorsTotal}` : "none set";
      vCand.textContent = fmtN(p.candidates);
    },
    tick(j) {
      const now = Date.now();
      vTime.textContent = j.exact && j.last?.phase === "exact" ? `${fmtSecs(now - j.startedAt)} · budget ${j.budgetMs / 1000} s` : fmtSecs(now - j.startedAt);
      const silent = (now - j.lastProgressAt) / 1000;
      let cls = "", txt = `alive · ${silent < 1 ? "just now" : silent.toFixed(0) + " s ago"}`;
      if (!j.connected) { cls = "warn"; txt = "connection lost · reconnecting"; }
      else if (silent > 12) { cls = "bad"; txt = `silent for ${silent.toFixed(0)} s — probably hung, cancel and retry`; }
      else if (silent > 4) { cls = "warn"; txt = `no update for ${silent.toFixed(0)} s`; }
      beat.className = "beat " + cls; vBeat.className = "stat-v num " + cls; vBeat.textContent = txt;
    },
    cancelling() { cancel.disabled = true; cancel.textContent = "Cancelling…"; },
  };
  return ui;
}
export function runStats(r, poolSize, skipped, explored = null, reused = null) {
  void explored;   // pre-HiGHS saved runs still pass this positionally (ui/runs.mjs openRun); no longer used
  const res = r.result, n = fmtN;
  const verdict = res.floorsConflict ? [`no suit meets every required floor — best partial suit`, "warn"]
    : res.solver === "fallback" ? [`exact solver unavailable — heuristic result; check the floors below`, "warn", res.fallbackReason]
    : res.method === "exact" && res.proven ? [`proven optimal for this inventory`, "good"]
    : res.method === "exact" ? [res.gapPoints == null ? "best found within the time budget — no bound established; raise the budget to finish" : `best found within the time budget — at most ${n(res.gapPoints)} points from the bound; raise the budget to finish`, "warn"]
    : ["heuristic", ""];
  const stat = (label, value) => el("div", { class: "stat" }, el("div", { class: "stat-k" }, label), el("div", { class: "stat-v num" }, value));
  const cnt = (k) => Array.isArray(skipped?.[k]) ? skipped[k].length : +(skipped?.[k] || 0);   // live arrays, or a saved run's counts
  const skips = [["worn by others", cnt("worn")], ["too heavy", cnt("str")], ["tagged", cnt("tags")], ["gargoyle-only", cnt("gargoyle")], ["not meditation-safe", cnt("nonMed")], ["other weapon types", cnt("weapon")], ["in skipped containers", cnt("roots")]].filter(([, c]) => c);
  const unreachable = (res.unreachableFloors || []).length
    ? el("div", { class: "small muted" }, "these required floors cannot be reached by any suit in the pool: " + res.unreachableFloors.map((k) => label(k)).join(", "))
    : null;
  return el("div", { class: "stack" },
    el("div", { class: "panel stats" },
      el("span", { class: "pill " + verdict[1], title: verdict[2] || "" }, verdict[0]),
      reused ? el("span", { class: "pill good", title: "same inventory, settings and options as that run, so its answer is reused" }, `reused the run from ${fmtRunTime(reused.createdAt)}`) : null,
      poolSize != null ? stat("candidates", n(poolSize)) : null,
      res.nodes != null ? stat("search nodes", n(res.nodes)) : null,
      stat("solver", res.floorsConflict ? "HiGHS (floors infeasible)" : res.solver === "highs" ? "HiGHS" : res.solver === "fallback" ? "heuristic (exact solver unavailable)" : res.solver === "none" ? "none needed" : res.method === "exact" ? "branch-and-bound" : "heuristic"),
      res.altTolerance != null ? stat("other suits", `${n((res.alternatives || []).length)} within ${n(res.altTolerance)} points`) : null,
      stat("time", reused ? `instant · first run took ${fmtSecs(r.ms)}`
        : res.heuristicMs != null && res.mipMs != null ? `${fmtSecs(r.ms)} (heuristic ${fmtSecs(res.heuristicMs)} · HiGHS ${fmtSecs(res.mipMs)})` : fmtSecs(r.ms)),
      skips.length ? stat("left out", skips.map(([l, c]) => `${n(c)} ${l}`).join(" · ")) : null),
    unreachable);
}

// renderResult's two fire-and-forget callers (finishJob, the alt-suit "Show" button below) don't
// await it, so a rejection would otherwise be an unhandled promise rejection rather than a visible,
// debuggable error — this is that .catch() target.
function resultLoadError(e) {
  $("#b-result").replaceChildren(el("div", { class: "panel" }, el("div", { class: "msg bad" }, "Could not load the suit's items: " + e.message)));
}
// Two calls can overlap — the alt-suit "Show" button re-invokes this on every row, and a saved-run
// open isn't guarded against a second one landing while the first is still awaiting resolveItems()
// — so renderSeq is the same kind of generation counter fetchItems() uses against a stale response:
// bumped at entry, checked after the only await, and every DOM write is deferred to ONE
// out.replaceChildren(...) at the very end, so an overtaken call can never leave the panel showing
// a mix of two different suits (it either builds its nodes and installs them, or bails and touches
// nothing — never a partial append).
let renderSeq = 0;
export async function renderResult(res, current, prof = optimizerProfile()) {
  const mySeq = ++renderSeq;
  const alts = res.alternatives || [];
  const view = state.builder.altView != null && alts[state.builder.altView] ? state.builder.altView : null;
  const suit = view == null ? res.best : alts[view].best, suitScore = view == null ? res.score : alts[view].score;
  const after = totalsOf(suit), before = totalsOf(current);
  const report = requirementReport(after, prof);
  const rsb = prof.resistBonus || 0, pd = (k, v) => (v != null && RESIST_KEYS.includes(k) ? v + rsb : v);   // resists shown as the paperdoll shows them
  const unmet = report.filter((x) => x.met === false);
  const topPanel = el("div", { class: "panel stack" },
    el("div", { class: "row", style: "justify-content:space-between" }, el("h2", {}, view == null ? `Best suit for ${state.builder.character}` : `Suit #${view + 2} for ${state.builder.character}`),
      el("span", { class: "num small muted" }, `score ${Math.round(res.currentScore)} → ${Math.round(suitScore)} (${suitScore - res.currentScore >= 0 ? "+" : ""}${Math.round(suitScore - res.currentScore)})`)),
    unmet.length ? el("div", { class: "msg bad" }, "Requirements NOT met with this inventory: " + unmet.map((x) => `${x.label} ${pd(x.key, x.value)}/${pd(x.key, x.floor)}`).join(", ")) : el("div", { class: "msg" }, "Every requirement is met."),
    el("div", { class: "chips" }, ...report.filter((x) => x.value || x.floor != null).map((x) => el("span", { class: "pill " + (x.met === false ? "bad" : x.capped ? "good" : ""), title: full(x.key) + (x.floor != null ? ` · floor ${pd(x.key, x.floor)}` : "") + (x.cap != null ? ` · cap ${pd(x.key, x.cap)}` : "") + (rsb && RESIST_KEYS.includes(x.key) ? ` · includes +${rsb} from Resisting Spells` : "") },
      `${x.label} ${pd(x.key, before[x.key] || 0)} → ${pd(x.key, x.value)}${x.cap != null ? "/" + pd(x.key, x.cap) : ""}${x.over ? ` (${x.over} wasted)` : ""}`))));
  const altNode = res.altTolerance != null ? altPanel(res, current, prof, view) : null;
  const sheetNode = el("div", { class: "panel", html: sheetHtml(state.builder.character, current, suit) });
  const changes = OPTIMIZER_SLOTS.filter((sl) => (current[sl]?.serial || 0) !== (suit[sl]?.serial || 0)).map((sl) => ({ slot: sl, toSerial: suit[sl]?.serial || 0 }));
  const rowsAll = OPTIMIZER_SLOTS.map((slot) => ({ slot, now: current[slot], next: suit[slot] }));
  // The optimizer's own item shape (serial/name/slot/props) has no location/equippedBy — resolve
  // full records for whichever candidate pieces the Plan/Fetch list are about to show (only the
  // CHANGED slots' target pieces; "now"/unchanged pieces show no location or buttons, same as
  // before). A piece that doesn't resolve (rescanned away since) still shows its name — from the
  // opt item itself — with a muted "not in the current inventory" in place of a location/buttons.
  const resolved = await resolveItems(changes.map((c) => c.toSerial).filter(Boolean));
  if (mySeq !== renderSeq) return;   // a newer renderResult call has since started — its own nodes own the panel now
  const planNode = el("div", { class: "panel" }, el("h2", { style: "margin-bottom:8px" }, `Plan · ${changes.length} change${changes.length === 1 ? "" : "s"}`),
    el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Slot"), el("th", {}, "Wearing now"), el("th", {}, "Wear instead"), el("th", {}, "Where it is"), el("th", {}, "Props"))),
      el("tbody", {}, ...rowsAll.map(({ slot, now, next }) => {
        const changed = (now?.serial || 0) !== (next?.serial || 0);
        const item = changed && next ? resolved[next.serial] || null : null;
        return el("tr", { class: changed ? "item" : "", style: changed ? "background:var(--sel)" : "" },
          el("td", { class: "muted" }, slotLabel(slot)), el("td", { class: changed ? "muted" : "name", "data-serial": now ? now.serial : "" }, now ? now.name : "—"),
          el("td", { class: "name", "data-serial": next ? next.serial : "" }, changed ? (next ? next.name : "(nothing)") : el("span", { class: "muted" }, "keep")),
          el("td", { class: "small" }, changed && next ? (item ? item.location.text : el("span", { class: "muted" }, "not in the current inventory")) : "", " ", item ? actButtons(item) : null),
          el("td", { class: "small muted" }, next ? Object.entries(next.props).filter(([k]) => k !== "tagPenalty").map(([k, v]) => `${label(k)} ${v}`).join(" · ") : ""));
      })))));
  const fetchList = {};
  for (const c of changes) { const it = c.toSerial ? resolved[c.toSerial] || null : null; if (it && it.equippedBy !== state.builder.character) (fetchList[it.location.text] ||= []).push(it); }
  const fetchNode = Object.keys(fetchList).length
    ? el("div", { class: "panel stack" }, el("div", { class: "row", style: "justify-content:space-between" }, el("h2", {}, "Fetch list"), grabAllRow(Object.values(fetchList).flat())), ...Object.entries(fetchList).map(([loc, items]) => el("div", {}, el("div", { class: "small muted" }, loc), el("ul", { style: "margin:4px 0 0 18px" }, ...items.map((i) => el("li", { "data-serial": i.serial }, i.name, " ", i.equippedBy ? el("span", { class: "tag" }, "worn by " + i.equippedBy) : actButtons(i)))))))
    : null;
  // Every node is built — install them all in one replaceChildren() call, the only DOM write this
  // function makes, so an overtaken (bailed-out) call never leaves a partial/mixed panel behind.
  $("#b-result").replaceChildren(...[topPanel, altNode, sheetNode, planNode, fetchNode].filter(Boolean));
}
// The best suit and the other suits within the tolerance, each described by how it differs from the best: which
// pieces change and which property totals move (weighted or not). Show puts that suit into the plan and sheet below.
function altPanel(res, current, prof, view) {
  const all = [{ best: res.best, score: res.score }, ...(res.alternatives || [])];
  const tb = totalsOf(res.best);
  const shownIdx = view == null ? 0 : view + 1;
  if (all.length === 1) return el("div", { class: "panel small muted" }, `No other suit scores within ${fmtN(res.altTolerance)} points of the best.`);
  const rows = all.map((s, i) => {
    const ta = totalsOf(s.best), d = s.score - res.score;
    const slotsDiff = OPTIMIZER_SLOTS.filter((sl) => (s.best[sl]?.serial || 0) !== (res.best[sl]?.serial || 0));
    const propDiff = [...new Set([...Object.keys(ta), ...Object.keys(tb)])].filter((k) => k !== "tagPenalty" && (ta[k] || 0) !== (tb[k] || 0))
      .sort((x, y) => label(x).localeCompare(label(y))).map((k) => { const v = (ta[k] || 0) - (tb[k] || 0); return `${label(k)} ${v > 0 ? "+" : ""}${v}`; });
    return el("tr", { class: i === shownIdx ? "shown" : "" },
      el("td", { class: "num" }, i === 0 ? "best" : `#${i + 1}`),
      el("td", { class: "num" }, i === 0 ? "" : Math.abs(d) < 1e-6 ? "ties" : fmtN(Math.round(d))),
      el("td", {}, i === 0 ? el("span", { class: "muted" }, "the proven best") : slotsDiff.map((sl) => `${slotLabel(sl)}: ${s.best[sl] ? s.best[sl].name : "(nothing)"}`).join(" · ")),
      el("td", { class: "small muted" }, i === 0 ? "" : propDiff.join(" · ") || "same totals"),
      el("td", {}, i === shownIdx ? el("span", { class: "pill good" }, "showing") : el("button", { class: "small", onclick: () => { state.builder.altView = i === 0 ? null : i - 1; renderResult(res, current, prof).catch(resultLoadError); } }, "Show")));
  });
  return el("div", { class: "panel stack" },
    el("h2", {}, `Other suits within ${fmtN(res.altTolerance)} points of the best`),
    el("div", { class: "small muted" }, "Each row lists the pieces and property totals that differ from the best suit, including properties you give no weight. Show puts that suit into the character sheet, plan and fetch list below."),
    el("div", { class: "tablewrap" }, el("table", { class: "alt-table" }, el("thead", {}, el("tr", {}, el("th", {}, "Suit"), el("th", {}, "Points vs best"), el("th", {}, "Different pieces"), el("th", {}, "Totals vs best"), el("th", {}, ""))), el("tbody", {}, ...rows))));
}
async function saveProfile() {
  state.profiles.characters ||= {};
  state.profiles.characters[state.builder.character] = JSON.parse(JSON.stringify(readControls()));   // a copy: later sidebar edits must not ride along with a template save
  const r = await putProfiles();
  $("#b-msg").replaceChildren(el("div", { class: "msg " + (r.ok ? "" : "bad") }, r.ok ? `Profile for ${state.builder.character} saved.` : r.error));
}
