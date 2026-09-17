// ui/runs.mjs — the saved-runs drawer: settings snapshot/apply, load/open/rename/compare a saved run.
// Moved verbatim out of ui/builder.mjs (Task 5, the page split, part B).
import { OPTIMIZER_SLOTS, RESIST_KEYS, resistSkillBonus, effectiveProfile, totalsOf, settingsDiff } from "../vault-lib.mjs";
import { state, invStamp } from "./store.mjs";
import { $, el, label, full, fmtSecs, fmtRunTime, slotLabel, toast } from "./dom.mjs";
import { api } from "./api.mjs";
import { resolveItems } from "./items.mjs";
import { renderResult, poolControls, renderProfile, runStats } from "./builder.mjs";

// ---------------------------------------------------------------- saved runs (history, open, compare)
export function settingsSnapshot() {
  const p = state.builder.profile;
  return { floors: { ...(p.floors || {}) }, softFloors: [...(p.softFloors || [])], weights: { ...(p.weights || {}) }, lockedSlots: [...(p.lockedSlots || [])],
    excludeTags: [...(p.excludeTags || [])], excludeRoots: [...(p.excludeRoots || [])], strLimit: +$("#b-str").value, allowGargoyle: $("#b-garg").checked,
    medOnly: $("#b-med").checked, weaponSkill: $("#b-weapon").value || "", allowOthersWorn: $("#b-others").checked,
    restarts: +$("#b-restarts").value || 200, exact: $("#b-exact").checked, budgetMs: 1000 * (+$("#b-budget").value || 300),
    altCount: +$("#b-altcount").value || 0, altTol: +$("#b-alttol").value || 0, race: $("#b-race").value, excludeSkills: [...(p.excludeSkills || [])] };
}
export function applySettings(st) {
  const p = state.builder.profile;
  Object.assign(p, { floors: { ...(st.floors || {}) }, softFloors: [...(st.softFloors || [])], weights: { ...(st.weights || {}) }, lockedSlots: [...(st.lockedSlots || [])],
    excludeTags: [...(st.excludeTags || [])], excludeRoots: [...(st.excludeRoots || [])], strLimit: st.strLimit, allowGargoyle: !!st.allowGargoyle, medOnly: !!st.medOnly, weaponSkill: st.weaponSkill || null,
    race: st.race || p.race || "human", excludeSkills: [...(st.excludeSkills || [])], allowOthersWorn: !!st.allowOthersWorn });
  $("#b-race").value = p.race || "human";
  if (st.strLimit != null) $("#b-str").value = st.strLimit;
  poolControls(p);
  if (st.restarts != null) $("#b-restarts").value = st.restarts;
  if (st.exact != null) $("#b-exact").checked = !!st.exact;
  if (st.budgetMs != null) $("#b-budget").value = st.budgetMs / 1000;
  if (st.altCount != null) $("#b-altcount").value = st.altCount;
  if (st.altTol != null) $("#b-alttol").value = st.altTol;
  renderProfile();
  toast("Settings loaded into the sidebar. Save profile to keep them.", "good");
}
export const profileFromSettings = (st) => effectiveProfile(st, state.inv.characters[state.builder.character]);
export async function loadRuns() {
  const name = state.builder.character;
  if (!name) return;
  try { state.builder.runs = (await api(`/api/runs?character=${encodeURIComponent(name)}`)).runs || []; }
  catch { state.builder.runs = []; }
  renderRuns();
}
export function openRunsDrawer() {
  const d = $("#runs-drawer");
  $("#b-runs-who").textContent = state.builder.character || "";
  d.inert = false; d.classList.add("open");
  setTimeout(() => $("#b-runs-filter").focus(), 60);
}
export function closeRunsDrawer() {
  const d = $("#runs-drawer");
  // hand focus back before the drawer turns inert, so focus never sits inside a hidden element
  if (d.contains(document.activeElement)) $("#b-runs-open").focus();
  d.classList.remove("open"); d.inert = true;
}
export function updateCompareBtn() { $("#b-compare").disabled = state.builder.compare.size !== 2; }
export function renderRuns() {
  const box = $("#b-runs"), runs = state.builder.runs || [], sel = state.builder.compare, stamp = invStamp();
  for (const id of [...sel]) if (!runs.some((r) => r.id === id)) sel.delete(id);
  $("#b-runs-count").textContent = String(runs.length);
  if (!runs.length) { box.replaceChildren(el("div", { class: "small muted" }, "No runs yet for this character.")); updateCompareBtn(); return; }
  const q = ($("#b-runs-filter").value || "").trim().toLowerCase();
  const rows = runs.map((run, i) => {
    const prev = runs[i + 1];
    const diff = prev ? settingsDiff(prev.settings, run.settings) : [];
    const auto = !prev ? "first saved run" : diff.length ? diff.slice(0, 3).join(" · ") + (diff.length > 3 ? ` · +${diff.length - 3} more` : "") : "same settings as the run before";
    if (q && !`${run.label || ""} ${auto} ${diff.join(" ")} ${fmtRunTime(run.createdAt)}`.toLowerCase().includes(q)) return null;
    const verdict = run.method !== "exact" ? ["heuristic", ""] : run.proven ? ["proven", "good"] : ["budget", "warn"];
    const labelEl = el("div", { class: "run-label", title: diff.length ? "vs the run before: " + diff.join(" · ") : "" }, run.label || auto);
    return el("div", { class: "runrow" + (state.builder.openRun === run.id ? " open" : "") },
      el("input", { type: "checkbox", title: "tick two runs to compare them", checked: sel.has(run.id) ? "" : null, onchange: (e) => { if (e.target.checked) sel.add(run.id); else sel.delete(run.id); updateCompareBtn(); } }),
      el("div", { class: "run-main", title: "open this run", onclick: () => openRun(run.id) },
        el("div", { class: "run-top" }, el("span", { class: "num" }, fmtRunTime(run.createdAt)), el("span", { class: "pill " + verdict[1] }, verdict[0]), el("span", { class: "small muted num" }, fmtSecs(run.ms || 0)),
          run.inventoryStamp && run.inventoryStamp !== stamp ? el("span", { class: "pill warn", title: "the inventory has been rescanned since this run" }, "inventory changed") : null),
        labelEl),
      el("span", { class: "run-acts" },
        el("button", { class: "small", title: "name this run", onclick: (e) => { e.stopPropagation(); renameRun(run, labelEl); } }, "Name"),
        el("button", { class: "small", title: "delete this run", onclick: async (e) => { e.stopPropagation(); try { await api(`/api/runs/${run.id}`, { method: "DELETE" }); } catch (err) { toast(err.message, "bad"); } sel.delete(run.id); if (state.builder.openRun === run.id) state.builder.openRun = null; loadRuns(); } }, "×")));
  }).filter(Boolean);
  box.replaceChildren(...(rows.length ? rows : [el("div", { class: "small muted" }, "No saved run matches the filter.")]));
  for (const o of box.querySelectorAll("input[checked='null']")) o.removeAttribute("checked");
  updateCompareBtn();
}
export function renameRun(run, labelEl) {
  const input = el("input", { type: "text", value: run.label || "", placeholder: "name this run", class: "run-name" });
  let done = false;
  const save = async () => {
    if (done) return; done = true;
    try { await api(`/api/runs/${run.id}`, { method: "PUT", body: { label: input.value.trim() } }); } catch (e) { toast(e.message, "bad"); }
    loadRuns();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); done = true; renderRuns(); } });
  input.addEventListener("blur", save);
  input.addEventListener("click", (e) => e.stopPropagation());
  labelEl.replaceChildren(input);
  input.focus();
}
export async function openRun(id) {
  if (state.builder.job) { toast("A build is running. Cancel it or wait before opening a saved run."); return; }
  let r;
  try { r = await api(`/api/runs/${id}`); } catch (e) { r = { ok: false, error: e.message }; }
  if (!r.ok) { toast(r.error, "bad"); return; }
  const run = r.run;
  state.builder.openRun = id; renderRuns(); closeRunsDrawer();
  const diff = settingsDiff(settingsSnapshot(), run.settings);
  // A saved run never persisted the assignment it started from — only its result (best,
  // perSlotChanges, totals). Reconstruct a per-slot "current" from that: an unchanged slot is
  // whatever `best` has (perSlotChanges only lists slots that actually differ, and those items are
  // real pool records with real props). A changed slot's original piece is named/serialed by its
  // perSlotChanges entry but the run never stored its props — resolve it through resolveItems (the
  // same cache/route renderResult already uses for the "wear instead" pieces) so a piece still in
  // the inventory gets its real props back rather than an empty {}, which used to understate the
  // "before" totals every chip and the sheet compare against. A piece the inventory no longer has
  // (rescanned away since) can't be resolved that way; rather than silently show it as contributing
  // nothing, recover its true contribution from the run's own `result.totals.before` (computed at
  // run time from the real worn suit) minus everything the other slots already account for, and
  // park that leftover on one of the unresolved pieces — totalsOf() only ever sums across the whole
  // assignment, so it doesn't matter which slot carries it, and the chips/sheet baseline come out
  // exactly right either way.
  const best = run.result.best || {};
  const current = Object.fromEntries(OPTIMIZER_SLOTS.map((slot) => [slot, best[slot] || null]));
  const changes = run.result.perSlotChanges || [];
  const resolved = await resolveItems(changes.map((c) => c.fromSerial).filter(Boolean));
  const unresolvedSlots = [];
  for (const c of changes) {
    if (!c.fromSerial) { current[c.slot] = null; continue; }
    const item = resolved[c.fromSerial];
    current[c.slot] = { serial: c.fromSerial, name: c.from, slot: c.slot, props: item ? item.props : {} };
    if (!item) unresolvedSlots.push(c.slot);
  }
  if (unresolvedSlots.length && run.result.totals?.before) {
    const known = totalsOf(current), stored = run.result.totals.before;
    const leftover = {};
    for (const k of new Set([...Object.keys(known), ...Object.keys(stored)])) leftover[k] = (stored[k] || 0) - (known[k] || 0);
    current[unresolvedSlots[0]] = { ...current[unresolvedSlots[0]], props: leftover };
  }
  $("#b-msg").replaceChildren(el("div", { class: "panel stack saved-run" },
    el("div", { class: "row", style: "justify-content:space-between" }, el("strong", {}, `Saved run · ${fmtRunTime(run.createdAt)}${run.label ? " · " + run.label : ""}`),
      el("button", { onclick: () => applySettings(run.settings) }, "Load these settings")),
    el("div", { class: "small muted" }, diff.length ? "Sidebar → this run: " + diff.join(" · ") : "Same settings as the sidebar."),
    run.inventoryStamp && run.inventoryStamp !== invStamp() ? el("div", { class: "small stale" }, "The inventory has been rescanned since this run, so some pieces may have moved or changed.") : null,
    runStats({ ok: true, result: run.result, ms: run.ms }, run.poolSize, run.skipped, run.explored)));
  state.builder.altView = null;
  await renderResult(run.result, current, profileFromSettings(run.settings));
}
export async function compareSelected() {
  const ids = [...state.builder.compare];
  if (ids.length !== 2) return;
  const got = await Promise.all(ids.map((id) => api(`/api/runs/${id}`).catch(() => ({ ok: false }))));
  if (!got.every((g) => g.ok)) { toast("Could not load both runs.", "bad"); return; }
  const [A, B] = got.map((g) => g.run).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
  const title = (r) => `${fmtRunTime(r.createdAt)}${r.label ? " · " + r.label : ""}`;
  const diff = settingsDiff(A.settings, B.settings);
  const ta = totalsOf(A.result.best), tb = totalsOf(B.result.best), caps = state.rules.caps || {};
  const crsb = resistSkillBonus(state.inv.characters[state.builder.character]?.skills);
  for (const k of RESIST_KEYS) { if (ta[k] != null) ta[k] += crsb; if (tb[k] != null) tb[k] += crsb; }
  const fa = A.settings.floors || {}, fb = B.settings.floors || {};
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb), ...Object.keys(A.settings.weights || {}), ...Object.keys(B.settings.weights || {}), ...Object.keys(ta), ...Object.keys(tb)])]
    .filter((k) => k !== "tagPenalty" && ((ta[k] || 0) || (tb[k] || 0) || fa[k] != null || fb[k] != null)).sort((x, y) => label(x).localeCompare(label(y)));
  const cell = (v, k, floor) => el("td", { class: "num" + (floor != null && v < floor ? " delta-down" : ""), title: floor != null ? `floor ${floor}` : "" }, `${v}${caps[k] != null ? " / " + caps[k] : ""}`);
  const slotRows = OPTIMIZER_SLOTS.map((slot) => {
    const a = A.result.best[slot], b = B.result.best[slot], same = (a?.serial || 0) === (b?.serial || 0);
    return el("tr", { style: same ? "" : "background:var(--sel)" }, el("td", { class: "muted" }, slotLabel(slot)),
      el("td", { class: "name", "data-serial": a ? a.serial : "" }, a ? a.name : "—"),
      el("td", { class: "name", "data-serial": b ? b.serial : "" }, same ? el("span", { class: "muted" }, "same") : b ? b.name : "—"));
  });
  const statRows = keys.map((k) => {
    const va = ta[k] || 0, vb = tb[k] || 0, d = vb - va;
    return el("tr", {}, el("td", { title: full(k) }, label(k)), cell(va, k, fa[k]), cell(vb, k, fb[k]),
      el("td", { class: "num " + (d > 0 ? "delta-up" : d < 0 ? "delta-down" : "muted") }, d > 0 ? "+" + d : d < 0 ? String(d) : "·"));
  });
  state.builder.openRun = null; renderRuns(); closeRunsDrawer();
  $("#b-msg").replaceChildren();
  $("#b-result").replaceChildren(el("div", { class: "panel stack" },
    el("h2", {}, "Compare runs"),
    el("div", { class: "cmp-head" }, el("div", {}, el("div", { class: "stat-k" }, "A · older"), el("strong", {}, title(A))), el("div", {}, el("div", { class: "stat-k" }, "B · newer"), el("strong", {}, title(B)))),
    el("div", { class: "small" }, diff.length ? "Settings A → B: " + diff.join(" · ") : "Same settings."),
    el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Slot"), el("th", {}, "A"), el("th", {}, "B"))), el("tbody", {}, ...slotRows))),
    el("div", { class: "small muted" }, `Totals of the pieces each run chose; resists include the +${crsb} Resisting Spells bonus. Red = below that run's floor. Pieces outside the builder's slots are not included.`),
    el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Property"), el("th", {}, "A"), el("th", {}, "B"), el("th", {}, "B − A"))), el("tbody", {}, ...statRows)))));
}
