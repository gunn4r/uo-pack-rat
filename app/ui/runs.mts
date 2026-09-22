// ui/runs.mts — the saved-runs drawer: settings snapshot/apply, load/open/rename/compare a saved run.
// Moved verbatim out of ui/builder.mts (Task 5, the page split, part B).
import { OPTIMIZER_SLOTS, RESIST_KEYS, resistSkillBonus, effectiveProfile, totalsOf, settingsDiff } from "../vault-lib.mts";
import type { RunSettings, OptItem, PropMap, Character } from "../vault-lib.mts";
import { state, invStamp } from "./store.mts";
import { $, el, label, full, fmtSecs, fmtRunTime, slotLabel, toast } from "./dom.mts";
import { api } from "./api.mts";
import { resolveItems } from "./items.mts";
import { renderResult, poolControls, renderProfile, runStats } from "./builder.mts";
import type { RunsListApiResponse, RunApiResponse, RunPutApiResponse, RunSummaryLike, SavedRunLike } from "./api-types.mts";

// ---------------------------------------------------------------- saved runs (history, open, compare)
export function settingsSnapshot(): RunSettings {
  const p = state.builder.profile!;
  return { floors: { ...(p.floors || {}) }, softFloors: [...(p.softFloors || [])], weights: { ...(p.weights || {}) }, lockedSlots: [...(p.lockedSlots || [])],
    excludeTags: [...(p.excludeTags || [])], excludeRoots: [...(p.excludeRoots || [])], strLimit: +$<HTMLInputElement>("#b-str")!.value, allowGargoyle: $<HTMLInputElement>("#b-garg")!.checked,
    medOnly: $<HTMLInputElement>("#b-med")!.checked, weaponSkill: $<HTMLSelectElement>("#b-weapon")!.value || "", allowOthersWorn: $<HTMLInputElement>("#b-others")!.checked,
    restarts: +$<HTMLInputElement>("#b-restarts")!.value || 200, exact: $<HTMLInputElement>("#b-exact")!.checked, budgetMs: 1000 * (+$<HTMLInputElement>("#b-budget")!.value || 300),
    altCount: +$<HTMLInputElement>("#b-altcount")!.value || 0, altTol: +$<HTMLInputElement>("#b-alttol")!.value || 0, race: $<HTMLSelectElement>("#b-race")!.value, excludeSkills: [...(p.excludeSkills || [])] };
}
export function applySettings(st: RunSettings): void {
  const p = state.builder.profile!;
  Object.assign(p, { floors: { ...(st.floors || {}) }, softFloors: [...(st.softFloors || [])], weights: { ...(st.weights || {}) }, lockedSlots: [...(st.lockedSlots || [])],
    excludeTags: [...(st.excludeTags || [])], excludeRoots: [...(st.excludeRoots || [])], strLimit: st.strLimit, allowGargoyle: !!st.allowGargoyle, medOnly: !!st.medOnly, weaponSkill: st.weaponSkill || null,
    race: st.race || p.race || "human", excludeSkills: [...(st.excludeSkills || [])], allowOthersWorn: !!st.allowOthersWorn });
  $<HTMLSelectElement>("#b-race")!.value = p.race || "human";
  // HTMLInputElement.value's own setter coerces via ToString regardless of what's declared here —
  // same reasoning as dom.mts's el()/setAttribute — these casts are compiler-only, not new String() calls.
  if (st.strLimit != null) $<HTMLInputElement>("#b-str")!.value = st.strLimit as unknown as string;
  poolControls(p);
  if (st.restarts != null) $<HTMLInputElement>("#b-restarts")!.value = st.restarts as unknown as string;
  if (st.exact != null) $<HTMLInputElement>("#b-exact")!.checked = !!st.exact;
  if (st.budgetMs != null) $<HTMLInputElement>("#b-budget")!.value = (st.budgetMs / 1000) as unknown as string;
  if (st.altCount != null) $<HTMLInputElement>("#b-altcount")!.value = st.altCount as unknown as string;
  if (st.altTol != null) $<HTMLInputElement>("#b-alttol")!.value = st.altTol as unknown as string;
  renderProfile();
  toast("Settings loaded into the sidebar. Save profile to keep them.", "good");
}
// effectiveProfile's own default parameter (`character = null`) already treats an omitted/undefined
// argument the same as an explicit null, so a missing character here behaves identically either way
// at runtime — this cast documents that rather than adding a new `?? null` that can't change the
// value actually bound inside the function.
export const profileFromSettings = (st: RunSettings) => effectiveProfile(st, state.inv!.characters[state.builder.character!] as Character | null);
export async function loadRuns(): Promise<void> {
  const name = state.builder.character;
  if (!name) return;
  try { state.builder.runs = (await api<RunsListApiResponse>(`/api/runs?character=${encodeURIComponent(name)}`)).runs || []; }
  catch { state.builder.runs = []; }
  renderRuns();
}
export function openRunsDrawer(): void {
  const d = $<HTMLElement>("#runs-drawer")!;
  $<HTMLElement>("#b-runs-who")!.textContent = state.builder.character || "";
  d.inert = false; d.classList.add("open");
  setTimeout(() => $<HTMLElement>("#b-runs-filter")!.focus(), 60);
}
export function closeRunsDrawer(): void {
  const d = $<HTMLElement>("#runs-drawer")!;
  // hand focus back before the drawer turns inert, so focus never sits inside a hidden element
  if (d.contains(document.activeElement)) $<HTMLElement>("#b-runs-open")!.focus();
  d.classList.remove("open"); d.inert = true;
}
export function updateCompareBtn(): void { $<HTMLButtonElement>("#b-compare")!.disabled = state.builder.compare.size !== 2; }
export function renderRuns(): void {
  const box = $<HTMLElement>("#b-runs")!, runs = state.builder.runs || [], sel = state.builder.compare, stamp = invStamp();
  for (const id of [...sel]) if (!runs.some((r) => r.id === id)) sel.delete(id);
  $<HTMLElement>("#b-runs-count")!.textContent = String(runs.length);
  if (!runs.length) { box.replaceChildren(el("div", { class: "small muted" }, "No runs yet for this character.")); updateCompareBtn(); return; }
  const q = ($<HTMLInputElement>("#b-runs-filter")!.value || "").trim().toLowerCase();
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
        el("button", { class: "small", title: "delete this run", onclick: async (e) => { e.stopPropagation(); try { await api(`/api/runs/${run.id}`, { method: "DELETE" }); } catch (err) { toast((err as Error).message, "bad"); } sel.delete(run.id); if (state.builder.openRun === run.id) state.builder.openRun = null; loadRuns(); } }, "×")));
  });
  // `.filter(Boolean)` doesn't narrow away the `null` a skipped (filter-mismatched) row above
  // returns — the cast documents what's actually true at runtime (every remaining element passed a
  // truthiness check), not a new behaviour.
  const kept = rows.filter(Boolean) as HTMLDivElement[];
  box.replaceChildren(...(kept.length ? kept : [el("div", { class: "small muted" }, "No saved run matches the filter.")]));
  for (const o of box.querySelectorAll("input[checked='null']")) o.removeAttribute("checked");
  updateCompareBtn();
}
export function renameRun(run: RunSummaryLike, labelEl: HTMLDivElement): void {
  const input = el("input", { type: "text", value: run.label || "", placeholder: "name this run", class: "run-name" });
  let done = false;
  const save = async (): Promise<void> => {
    if (done) return; done = true;
    try { await api<RunPutApiResponse>(`/api/runs/${run.id}`, { method: "PUT", body: { label: input.value.trim() } }); } catch (e) { toast((e as Error).message, "bad"); }
    loadRuns();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); done = true; renderRuns(); } });
  input.addEventListener("blur", save);
  input.addEventListener("click", (e) => e.stopPropagation());
  labelEl.replaceChildren(input);
  input.focus();
}
// GET /api/runs/<id> only ever resolves here as a real 200 (api.mts throws for a 404/other non-2xx,
// caught below into the synthetic `{ok:false}` branch) — `ok: true` narrows the success branch the
// same way bridge.mts's sendBridge() does, for the identical reason (api-types.mts's RunApiResponse
// itself declares `ok: boolean`, matching every route's response shape generally).
type RunFetch = (RunApiResponse & { ok: true }) | { ok: false; error?: string | undefined };
export async function openRun(id: string): Promise<void> {
  if (state.builder.job) { toast("A build is running. Cancel it or wait before opening a saved run."); return; }
  let r: RunFetch;
  try { r = (await api<RunApiResponse>(`/api/runs/${id}`)) as RunApiResponse & { ok: true }; } catch (e) { r = { ok: false, error: (e as Error).message }; }
  // The only way `r.ok` is false is the catch above, which always sets `error` to a real string —
  // RunFetch's `error?` is looser than that actual guarantee, so this `!` documents it rather than
  // adding a new `|| ""` fallback a genuinely-missing error has never needed.
  if (!r.ok) { toast(r.error!, "bad"); return; }
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
  const current: Record<string, OptItem | null> = Object.fromEntries(OPTIMIZER_SLOTS.map((slot): [string, OptItem | null] => [slot, best[slot] || null]));
  const changes = run.result.perSlotChanges || [];
  const resolved = await resolveItems(changes.map((c) => c.fromSerial).filter(Boolean));
  const unresolvedSlots: string[] = [];
  for (const c of changes) {
    if (!c.fromSerial) { current[c.slot] = null; continue; }
    const item = resolved[c.fromSerial];
    // c.from is only null for a slot with nothing "from" — this branch only runs when fromSerial is
    // truthy, which this app never produces without a real `from` name alongside it.
    current[c.slot] = { serial: c.fromSerial, name: c.from!, slot: c.slot, props: item ? item.props : {} };
    if (!item) unresolvedSlots.push(c.slot);
  }
  if (unresolvedSlots.length && run.result.totals?.before) {
    const known = totalsOf(current), stored = run.result.totals.before;
    const leftover: PropMap = {};
    for (const k of new Set([...Object.keys(known), ...Object.keys(stored)])) leftover[k] = (stored[k] || 0) - (known[k] || 0);
    current[unresolvedSlots[0]!] = { ...current[unresolvedSlots[0]!], props: leftover } as OptItem;
  }
  $<HTMLElement>("#b-msg")!.replaceChildren(el("div", { class: "panel stack saved-run" },
    el("div", { class: "row", style: "justify-content:space-between" }, el("strong", {}, `Saved run · ${fmtRunTime(run.createdAt)}${run.label ? " · " + run.label : ""}`),
      el("button", { onclick: () => applySettings(run.settings) }, "Load these settings")),
    el("div", { class: "small muted" }, diff.length ? "Sidebar → this run: " + diff.join(" · ") : "Same settings as the sidebar."),
    run.inventoryStamp && run.inventoryStamp !== invStamp() ? el("div", { class: "small stale" }, "The inventory has been rescanned since this run, so some pieces may have moved or changed.") : null,
    // run.ms is `number | null` (SavedRunLike, matching a saved run's real on-disk shape) but a
    // genuinely null one has never been guarded against here — same blind pass-through as
    // builder.mts's identical runStats() call in its cached-run branch. run.skipped is `unknown`
    // (a saved run's skip-list shape was never validated on the way in either) — runStats' own `cnt()`
    // helper already handles whatever shape actually arrives (an array or a plain count).
    runStats({ ok: true, result: run.result, ms: run.ms! }, run.poolSize, run.skipped as Record<string, unknown> | undefined, run.explored)));
  state.builder.altView = null;
  await renderResult(run.result, current, profileFromSettings(run.settings));
}
export async function compareSelected(): Promise<void> {
  // Same rule as openRun: a build finishing would draw over the comparison.
  if (state.builder.job) { toast("A build is running. Cancel it or wait before comparing runs."); return; }
  const ids = [...state.builder.compare];
  if (ids.length !== 2) return;
  const got = await Promise.all(ids.map((id) => api<RunApiResponse>(`/api/runs/${id}`).catch(() => ({ ok: false }))));
  if (!got.every((g) => g.ok)) { toast("Could not load both runs.", "bad"); return; }
  // Every element passed the `.ok` check above — same narrowing gap `.filter(Boolean)` has elsewhere
  // in this file (`.every()` doesn't propagate a type predicate back onto the source array).
  const [A, B] = (got as Array<RunApiResponse & { ok: true }>).map((g) => g.run).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt))) as [SavedRunLike, SavedRunLike];
  const title = (r: SavedRunLike): string => `${fmtRunTime(r.createdAt)}${r.label ? " · " + r.label : ""}`;
  const diff = settingsDiff(A.settings, B.settings);
  const ta = totalsOf(A.result.best), tb = totalsOf(B.result.best), caps = state.rules!.caps || {};
  const crsb = resistSkillBonus(state.inv!.characters[state.builder.character!]?.skills);
  for (const k of RESIST_KEYS) { if (ta[k] != null) ta[k] += crsb; if (tb[k] != null) tb[k] += crsb; }
  const fa = A.settings.floors || {}, fb = B.settings.floors || {};
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb), ...Object.keys(A.settings.weights || {}), ...Object.keys(B.settings.weights || {}), ...Object.keys(ta), ...Object.keys(tb)])]
    .filter((k) => k !== "tagPenalty" && ((ta[k] || 0) || (tb[k] || 0) || fa[k] != null || fb[k] != null)).sort((x, y) => label(x).localeCompare(label(y)));
  const cell = (v: number, k: string, floor: number | undefined): HTMLTableCellElement => el("td", { class: "num" + (floor != null && v < floor ? " delta-down" : ""), title: floor != null ? `floor ${floor}` : "" }, `${v}${(caps as Record<string, number>)[k] != null ? " / " + (caps as Record<string, number>)[k] : ""}`);
  const slotRows = OPTIMIZER_SLOTS.map((slot) => {
    const a = A.result.best[slot], b = B.result.best[slot], same = (a?.serial || 0) === (b?.serial || 0);
    return el("tr", { style: same ? "" : "background:var(--sel)" }, el("td", { class: "muted" }, slotLabel(slot)),
      el("td", { class: "name", ...(a ? { "data-serial": a.serial } : {}) }, a ? a.name : "—"),
      el("td", { class: "name", ...(b ? { "data-serial": b.serial } : {}) }, same ? el("span", { class: "muted" }, "same") : b ? b.name : "—"));
  });
  const statRows = keys.map((k) => {
    const va = ta[k] || 0, vb = tb[k] || 0, d = vb - va;
    return el("tr", {}, el("td", { title: full(k) }, label(k)), cell(va, k, fa[k]), cell(vb, k, fb[k]),
      el("td", { class: "num " + (d > 0 ? "delta-up" : d < 0 ? "delta-down" : "muted") }, d > 0 ? "+" + d : d < 0 ? String(d) : "·"));
  });
  state.builder.openRun = null; renderRuns(); closeRunsDrawer();
  $<HTMLElement>("#b-msg")!.replaceChildren();
  $<HTMLElement>("#b-result")!.replaceChildren(el("div", { class: "panel stack" },
    el("h2", {}, "Compare runs"),
    el("div", { class: "cmp-head" }, el("div", {}, el("div", { class: "stat-k" }, "A · older"), el("strong", {}, title(A))), el("div", {}, el("div", { class: "stat-k" }, "B · newer"), el("strong", {}, title(B)))),
    el("div", { class: "small" }, diff.length ? "Settings A → B: " + diff.join(" · ") : "Same settings."),
    el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Slot"), el("th", {}, "A"), el("th", {}, "B"))), el("tbody", {}, ...slotRows))),
    el("div", { class: "small muted" }, `Totals of the pieces each run chose; resists include the +${crsb} Resisting Spells bonus. Red = below that run's floor. Pieces outside the builder's slots are not included.`),
    el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Property"), el("th", {}, "A"), el("th", {}, "B"), el("th", {}, "B − A"))), el("tbody", {}, ...statRows)))));
}
