// ui/runs.mts — the Saved runs drawer (design spec 4.8): one card per run with its name or automatic label,
// meta line and summary badges, a ⋯ menu (Open, Rename inline, Delete with a confirm dialog), a filter, and a
// footer that ticks up to three runs for the compare view (ui/builder-result.mts's openRunCompare). Also the
// settings snapshot a run is saved with, putting a saved run's settings back into the panel, and arriving (issue #272):
// a character's latest run opened when it is first shown, the "<name>'s runs" card beside a result, the other characters'
// latest runs for the first-visit view, and New build back to it.
import { NOBODY, RESIST_KEYS, RESIST_SKILL_KEY, resistMinimum, resistSkillOf, resistSkillCapOf, totalsOf, resistCapsFor, fcCapFor } from "../vault-lib.mts";
import { buffById, plannedProfile, savedBuffs } from "../buffs.mts";
import type { RunSettings, OptItem, PropMap, Character, EffectiveProfile } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, fmtSecs, fmtRunTime, fmtRunDay, toast } from "./dom.mts";
import { api } from "./api.mts";
import { bindDrawer, box, txt, button, badge, message, input, confirmDialog, menu, type DrawerHandle } from "./components.mts";
import { renderNavCounts } from "./shell.mts";
import { resolveItems } from "./items.mts";
import { session, commands, provide, applyKnobs } from "./builder-session.mts";
import { paperdollCaps, slotsOf, runAutoLabel, runBadges, runSettingsDiff, toggleCompare, plural, who, withBuffs, latestShownRun, otherCharactersRuns, gearChangedSince } from "./builder-model.mts";
import type { RunsListApiResponse, RunApiResponse, RunPutApiResponse, RunSummaryLike, SavedRunLike } from "./api-types.mts";

// ---------------------------------------------------------------- settings snapshot / apply
// Everything a run can differ by, read from the panel's state (the profile, the buffs and the Advanced fields):
// app/build-spec.mts planBuild's snapshot of the panel.
const settingsSnapshot = (): RunSettings => commands.panelBuild().snapshot;
export function applySettings(st: RunSettings): void {
  const p = session.profile!;
  Object.assign(p, { floors: { ...(st.floors || {}) }, softFloors: [...(st.softFloors || [])], weights: { ...(st.weights || {}) }, lockedSlots: [...(st.lockedSlots || [])],
    excludeTags: [...(st.excludeTags || [])], excludeRoots: [...(st.excludeRoots || [])], strLimit: st.strLimit, allowGargoyle: !!st.allowGargoyle, medOnly: !!st.medOnly, excludeWeapons: [...(st.excludeWeapons || [])], ubwsAnyWeapon: st.ubwsAnyWeapon !== false, weaponMustHave: [...(st.weaponMustHave || [])],
    race: st.race || p.race || "human", excludeSkills: [...(st.excludeSkills || [])], allowOthersWorn: !!st.allowOthersWorn, resistCaps: { ...(st.resistCaps || {}) }, swingSteps: !!st.swingSteps, castingSchool: st.castingSchool || undefined, rarity: st.rarity || undefined });
  if (st.onlyRoots?.length) p.onlyRoots = [...st.onlyRoots]; else delete p.onlyRoots;
  applyKnobs(st);
  commands.loadRunBuffs(savedBuffs(st));
  commands.clearCapDrafts();
  commands.renderPanel();
  toast("Settings loaded into the panel. Save profile to keep them.", "good");
}
// The profile a run was built with, its buffs planned as they were (effectiveProfile's own default parameter already
// treats an omitted character the same as null).
export function profileFromSettings(st: RunSettings): EffectiveProfile {
  const name = session.character!;
  return plannedProfile(st, state.inv!.characters[name] as Character | null, commands.buffPlan(name, st.race, savedBuffs(st)));
}

// ---------------------------------------------------------------- the list
// A generation counter: a slow list for the previously selected character must not land after the
// selection moved on.
let runsSeq = 0;
let compareNote: string | null = null;
// `arrive` (issue #272), when the builder first shows the character (selectCharacter: a page load or a character switch):
// a run's id opens that run, true opens the character's latest (arriveAt). A refresh of the list never opens one, and
// drops the every-character list the first-visit view keeps (the runs changed: a build, a rename, a delete).
export async function loadRuns(arrive: boolean | string = false): Promise<void> {
  const name = session.character, mine = ++runsSeq;
  if (!name) return;
  if (arrive) { waiting = null; arriving = { name, arrive }; } else allRuns = null;
  let runs: RunSummaryLike[];
  try { runs = (await api<RunsListApiResponse>(`/api/runs?character=${encodeURIComponent(name)}`)).runs || []; }
  catch { runs = []; }
  if (mine !== runsSeq) return;
  session.runs = runs;
  renderRuns();
  // the coming back asked for runs from whichever list lands for its character, a refresh started meanwhile included
  if (arriving?.name !== name) return;
  const a = arriving.arrive;
  arriving = null;
  await arriveAt(name, a);
}
// The coming back a selectCharacter asked for, until a list for that character lands.
let arriving: { name: string; arrive: true | string } | null = null;
const BUILD_RUNNING = "A build is running. Cancel it or wait before opening a saved run.";
// A character shown while a build ran: its coming back waits for the build to end.
let waiting: string | null = null;
// Coming back to `name`: the run asked for, else its newest run with a suit (latestShownRun), unless a result is on screen
// by now; while a build runs, a run asked for is refused as the drawer refuses one, and the latest waits for the build to
// end. With nothing opened, the first-visit view (selectCharacter leaves the result blank until this decides, so it never
// flashes up under a run about to open).
async function arriveAt(name: string, arrive: true | string): Promise<void> {
  if (session.result) return;
  let shown = false;
  if (session.job) { if (typeof arrive === "string") toast(BUILD_RUNNING); else waiting = name; }
  else {
    const id = typeof arrive === "string" ? arrive : latestShownRun(session.runs)?.id;
    if (id) shown = await openRun(id, arrive === true);
  }
  if (!shown && session.character === name && !session.result && !document.getElementById("b-start")) commands.renderCurrentSuit(name);
}
document.addEventListener("builderchange", (e) => {
  if ((e as CustomEvent<{ key: string }>).detail.key !== "job" || session.job || !waiting) return;
  const name = waiting;
  waiting = null;
  if (session.character === name && !session.result) void arriveAt(name, true);
});
// The drawer's behaviour (focus trap, Esc, scrim, inert when closed, focus back to the opener) is
// components.mts's bindDrawer over the markup in index.html.
let drawer: DrawerHandle | null = null;
let wired = false;
const runsDrawer = (): DrawerHandle => {
  if (!wired) {
    wired = true;
    $<HTMLInputElement>("#b-runs-filter")!.addEventListener("input", () => renderRuns());
    $<HTMLButtonElement>("#b-runs-clear")!.onclick = () => { session.compare = new Set(); compareNote = null; renderRuns(); };
    $<HTMLButtonElement>("#b-runs-compare")!.onclick = compareSelected;
    $<HTMLButtonElement>("#b-runs-new")!.onclick = () => { closeRunsDrawer(); startOver(); };
  }
  return (drawer ||= bindDrawer($<HTMLElement>("#runs-drawer")!));
};
export function openRunsDrawer(): void {
  renderRuns();
  runsDrawer().open($<HTMLElement>("#b-runs-open"));
}
export function closeRunsDrawer(): void { runsDrawer().close(); }
// The footer: how many are ticked, Clear, and Compare. A fourth tick is refused and said here.
function paintFooter(): void {
  const n = session.compare.size;
  $<HTMLElement>("#b-runs-sel")!.replaceChildren(compareNote ? txt(compareNote, "tone-warn") : txt(`${n} of 3 selected`));
  const btn = $<HTMLButtonElement>("#b-runs-compare")!;
  btn.disabled = n < 2;
  btn.replaceChildren(txt(n >= 2 ? `Compare ${plural(n, "run")}` : "Compare runs"));
  $<HTMLButtonElement>("#b-runs-clear")!.disabled = n === 0;
}
export function renderRuns(): void {
  runsDrawer();
  const box_ = $<HTMLElement>("#b-runs")!, runs = session.runs || [];
  const ticked = [...session.compare].filter((id) => runs.some((r) => r.id === id));
  if (ticked.length !== session.compare.size) session.compare = new Set(ticked);
  const name = session.character || "";
  $<HTMLElement>("#b-runs-count")!.textContent = String(runs.length);
  $<HTMLElement>("#b-runs-who")!.textContent = name ? `${who(name)} · ${plural(runs.length, "run")} · newest first` : "";
  renderNavCounts();
  paintFooter();
  $<HTMLButtonElement>("#b-runs-new")!.disabled = !!session.job || !session.openRun;
  if (!runs.length) { box_.replaceChildren(el("li", { class: "runs-empty" }, message({ tone: "info", text: "No saved runs yet. Every build is saved here." }))); return; }
  const q = ($<HTMLInputElement>("#b-runs-filter")!.value || "").trim().toLowerCase();
  const skills = state.inv?.characters[name]?.skills, skill = resistSkillOf(skills);
  const kept = runs.map((run, i) => {
    const auto = autoLabel(run, runs[i + 1]);
    const title = run.label || auto.text;
    if (q && !`${run.label || ""} ${auto.text} ${auto.diff.join(" ")} ${fmtRunTime(run.createdAt)}`.toLowerCase().includes(q)) return null;
    // the resist caps the run was built with (its race, its overrides), against the shard's for that race
    // with the buffs it was planned with: their shares in its totals, the caps they leave, and their names
    const view = resistCapsFor(run.settings.race, run.settings.resistCaps), buffs = savedBuffs(run.settings);
    const pick = (f: "cap" | "shard"): Record<string, number> => Object.fromEntries(RESIST_KEYS.map((k) => [k, view[k]![f]]));
    const b = run.totalsAfter && buffs ? withBuffs(run.totalsAfter, skill, paperdollCaps(view, fcCapFor(state.inv!.characters[name]?.skills, run.settings.castingSchool).cap), commands.buffPlan(name, run.settings.race, buffs), resistSkillCapOf(skills)) : null;
    const badges = b ? runBadges(run.changes, b.totals, run.settings.floors || {}, null, b.caps, pick("shard")) : runBadges(run.changes, run.totalsAfter, run.settings.floors || {}, resistMinimum(skills, run.totalsAfter?.[RESIST_SKILL_KEY]), pick("cap"), pick("shard"));
    if (buffs) badges.push({ text: buffs.on.length === 1 ? `with ${buffById(buffs.on[0]!)!.name}` : `with ${plural(buffs.on.length, "buff")}` });
    return runCard(run, title, auto.diff, badges, gearChangedSince(state.inv?.scans || [], run));
  }).filter((x): x is HTMLLIElement => !!x);
  box_.replaceChildren(...(kept.length ? kept : [el("li", { class: "runs-empty" }, el("p", { class: "muted" }, txt("No saved run matches the filter.")))]));
}
// A run's automatic label: what changed from the run before it; a suit built by hand is named for that, never by its
// settings (they are the panel's when it was saved).
function autoLabel(run: { result?: { method?: string | undefined }; method?: string | null; settings: RunSettings }, before: { settings: RunSettings } | undefined): { text: string; diff: string[] } {
  return (run.method ?? run.result?.method) === "manual" ? { text: "Suit built by hand", diff: [] } : runAutoLabel(before?.settings ?? null, run.settings);
}
// null: an exact run whose proof the server withdrew (saved before the soft-floor fix, app/migrate.mts) shows no verdict.
function verdictOf(run: RunSummaryLike): { text: string; cls: string } | null {
  if (run.method === "manual") return null;   // its Manual badge says it
  if (run.method !== "exact") return { text: "heuristic", cls: "muted" };
  if (run.proven == null) return null;
  return run.proven ? { text: "proven optimal", cls: "tone-ok" } : { text: "best within budget", cls: "tone-warn" };
}
function runCard(run: RunSummaryLike, title: string, diff: string[], badges: Array<{ text: string; tone?: "ok" | "warn" | undefined }>, stale: boolean): HTMLLIElement {
  const sel = session.compare, showing = session.openRun === run.id, when = fmtRunTime(run.createdAt);
  const tick = el("input", { type: "checkbox", "aria-label": `Select run from ${when}${run.label ? "" : `, ${title},`} for comparison` });
  tick.checked = sel.has(run.id);
  tick.addEventListener("change", () => {
    const r = toggleCompare(sel, run.id, tick.checked);
    session.compare = r.next; compareNote = r.refused;
    if (r.refused) tick.checked = false;
    renderRuns();
    if (r.refused) $<HTMLElement>(`#b-runs [data-run="${CSS.escape(run.id)}"] input[type=checkbox]`)?.focus();
  });
  const v = verdictOf(run);
  const manual = run.method === "manual";
  const titleRow = box("div", { class: "run-title" }, manual ? badge("Manual", "accent") : null, txt(title, "strong ellip"), showing ? badge("Showing", "accent") : null, stale ? badge("Inventory changed", "warn") : null);
  const main = box("div", { class: "run-main" }, titleRow, el("span", { class: "t-sm muted" }, txt(`${when}${manual ? "" : ` · ${fmtSecs(run.ms || 0)}`}${v ? " · " : ""}`), v ? txt(v.text, v.cls) : null),
    diff.length && run.label ? el("span", { class: "t-sm muted run-diff" }, txt(`vs the run before: ${diff.join(" · ")}`)) : null);
  const more = button({ label: `Run actions: open, open in Manual, rename, delete`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", attrs: { "aria-haspopup": "menu", "aria-expanded": "false" } });
  const li = box("li", { class: `card run-card${showing ? " showing" : ""}`, "data-run": run.id }, tick, main, more,
    badges.length ? box("div", { class: "run-badges" }, ...badges.map((b) => badge(b.text, b.tone))) : null);
  more.onclick = () => {
    const m = menu(more, [{ label: "Open", onSelect: () => openRun(run.id) }, { label: "Open in Manual", onSelect: () => { void runToManual(run.id); } }, { label: "Rename", onSelect: () => renameRun(run, main) }, { label: "Delete…", onSelect: () => deleteRun(run, title), danger: true }], { label: "Run actions", width: 180 });
    m.root.classList.add("pop-over-drawer");   // the popover lives on <body>: it must sit above the drawer
  };
  return li;
}
// Rename in place: an input with Save and Cancel; Enter saves, Esc cancels (without closing the drawer).
export function renameRun(run: RunSummaryLike, main: HTMLElement): void {
  const id = `run-name-${run.id}`;
  const field = input({ size: "sm", value: run.label || "", placeholder: "Name this run", attrs: { id } });
  const save = async (): Promise<void> => {
    try { await api<RunPutApiResponse>(`/api/runs/${run.id}`, { method: "PUT", body: { label: field.value.trim() } }); } catch (e) { toast((e as Error).message, "bad"); }
    await loadRuns();
    $<HTMLElement>(`#b-runs [data-run="${CSS.escape(run.id)}"] .btn-icon`)?.focus();
  };
  const cancel = (): void => { renderRuns(); $<HTMLElement>(`#b-runs [data-run="${CSS.escape(run.id)}"] .btn-icon`)?.focus(); };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.stopPropagation(); cancel(); } });
  main.firstElementChild!.replaceWith(box("div", { class: "run-rename" }, el("label", { class: "sr", for: id }, "Run name"), field,
    button({ label: "Save", variant: "primary", size: "sm", onClick: save }), button({ label: "Cancel", variant: "ghost", size: "sm", onClick: cancel })));
  field.focus(); field.select();
}
async function deleteRun(run: RunSummaryLike, title: string): Promise<void> {
  if (!await confirmDialog({ title: `Delete the run from ${fmtRunTime(run.createdAt)}?`, body: `"${title}" and its suit are removed from the saved runs. Building again with the same settings makes a new one.`, confirmLabel: "Delete run" })) return;
  try { await api(`/api/runs/${run.id}`, { method: "DELETE" }); } catch (err) { toast((err as Error).message, "bad"); return; }
  session.compare = toggleCompare(session.compare, run.id, false).next;
  // the run on screen is gone: its result (with Start from this result, Grab all) goes too, back to the first-visit view
  if (session.openRun === run.id) clearShown();
  await loadRuns();
  toast("Run deleted.", "good");
}
// The result on screen cleared, back to the first-visit view (ui/builder-start.mts), while no build runs.
function clearShown(): void {
  session.openRun = null;
  if (!session.job && session.character) { session.result = null; $<HTMLElement>("#b-msg")!.replaceChildren(); commands.resetResultView(); commands.renderCurrentSuit(session.character); }
}
// New build (the "<name>'s runs" card): the first-visit view for the character, the runs kept.
function startOver(): void {
  if (session.job) return;
  clearShown();
  renderRuns();
  $<HTMLElement>("#b-start h2")?.focus();
}

// ---------------------------------------------------------------- open / compare
// GET /api/runs/<id> only resolves here as a real 200 (api.mts throws for anything else, caught into the
// synthetic `{ok:false}` branch).
type RunFetch = (RunApiResponse & { ok: true }) | { ok: false; error?: string | undefined };
async function fetchRun(id: string): Promise<SavedRunLike | null> {
  let r: RunFetch;
  try { r = (await api<RunApiResponse>(`/api/runs/${id}`)) as RunApiResponse & { ok: true }; } catch (e) { r = { ok: false, error: (e as Error).message }; }
  if (!r.ok) { toast(r.error!, "bad"); return null; }
  return r.run;
}
// A saved run's suit into Manual (one undo step there), with the buffs it was planned with.
async function runToManual(id: string): Promise<void> {
  const name = session.character, run = await fetchRun(id);
  if (!run || session.character !== name) return;
  closeRunsDrawer();
  await commands.openInManual(run.result.best, slotsOf(run.result.best), savedBuffs(run.settings), `Open the run from ${fmtRunTime(run.createdAt)}`);
}
// `auto`: opened on its own as the builder first shows the character (arriveAt): Manual, the drawer and the compare view
// are left as they are, a build started or a run shown meanwhile wins, and the run's search knobs (the Advanced fields,
// which a profile does not keep) come back into the panel. Whether the run was drawn.
export async function openRun(id: string, auto = false): Promise<boolean> {
  if (session.job) { if (!auto) toast(BUILD_RUNNING); return false; }
  // The run belongs to the character selected now; if the player picks another one while it loads, it is
  // dropped rather than drawn (with its Fetch list and Grab all) under that one.
  const name = session.character;
  if (!name) return false;
  const run = await fetchRun(id);
  if (!run || session.character !== name || (auto && (session.result || session.job || session.openRun))) return false;
  // a run file that kept no result (a hand-written or damaged one) has no suit to show
  if (!run.result) { if (!auto) toast("That saved run has no suit to show.", "bad"); return false; }
  session.openRun = id; renderRuns();
  $<HTMLElement>("#b-msg")!.replaceChildren();   // a note left from before (a canceled build) goes; the run's banner heads the result
  if (!auto) { closeRunsDrawer(); commands.showAutomatic(); commands.closeCompare(); }
  else {
    const { restarts, exact, budgetMs, altCount, altTol } = run.settings;
    applyKnobs({ restarts, exact, budgetMs, altCount, altTol } as RunSettings);
    commands.renderPanel();
  }
  const diff = runSettingsDiff(settingsSnapshot(), run.settings);
  // A saved run never persisted the assignment it started from, only its result (best, perSlotChanges,
  // totals). Reconstruct a per-slot "current" from that: an unchanged slot is whatever `best` has; a changed
  // slot's original piece is resolved through the inventory so its real props come back. A piece the
  // inventory no longer has gets its true contribution from the run's own `result.totals.before` minus
  // everything the other slots account for, parked on one of the unresolved pieces (totalsOf() sums across
  // the whole assignment, so which slot carries it doesn't matter).
  const best = run.result.best || {};
  const current: Record<string, OptItem | null> = Object.fromEntries(slotsOf(run.result.best).map((slot): [string, OptItem | null] => [slot, best[slot] || null]));
  const changes = run.result.perSlotChanges || [];
  const resolved = await resolveItems(changes.map((c) => c.fromSerial).filter(Boolean));
  if (session.character !== name || session.openRun !== id || (auto && session.job)) return false;
  const unresolvedSlots: string[] = [];
  for (const c of changes) {
    if (!c.fromSerial) { current[c.slot] = null; continue; }
    const item = resolved[c.fromSerial];
    current[c.slot] = { serial: c.fromSerial, name: c.from!, slot: c.slot, props: item ? item.props : {} };
    if (!item) unresolvedSlots.push(c.slot);
  }
  if (unresolvedSlots.length && run.result.totals?.before) {
    const known = totalsOf(current), stored = run.result.totals.before;
    const leftover: PropMap = {};
    for (const k of new Set([...Object.keys(known), ...Object.keys(stored)])) leftover[k] = (stored[k] || 0) - (known[k] || 0);
    current[unresolvedSlots[0]!] = { ...current[unresolvedSlots[0]!], props: leftover } as OptItem;
  }
  session.altView = null;
  session.result = run.result;
  // run.ms is `number | null` (a saved run's on-disk shape); run.skipped is whatever that run stored (live
  // arrays or plain counts), which the Solver details' counter reads either way.
  await commands.renderResult(run.result, current, profileFromSettings(run.settings), name, { ms: run.ms ?? 0, poolSize: run.poolSize, skipped: run.skipped as Record<string, unknown> | undefined, reused: null });
  if (session.openRun !== id) return false;
  paintRunBanner(run, diff);
  return true;
}
// The saved run's one banner over the result: its time and name and how the panel's settings differ, with Load these
// settings; when the inventory changed since the run (gearChangedSince, the drawer's "Inventory changed"), it leads with
// that instead, the settings changed counted as the drawer's footer counts them, and Build again, which loads the run's
// settings into the panel and builds them (issue #272). The item-level gear changes are #291's.
let bannerRun: SavedRunLike | null = null;
function paintRunBanner(run: SavedRunLike, diff: string[]): void {
  bannerRun = run;
  const load = button({ label: "Load these settings", size: "sm", onClick: () => applySettings(run.settings) });
  const since = diff.length ? `Your settings → this run: ${diff.join(" · ")}` : "Same settings as the panel.";
  const banner = !gearChangedSince(state.inv?.scans || [], run)
    ? message({ tone: "info", title: `Saved run · ${fmtRunDay(run.createdAt)}${run.label ? " · " + run.label : ""}`, text: since, actions: [load], attrs: { class: "msg info saved-run" } })
    : message({ tone: "warn", title: `This is your build from ${fmtRunDay(run.createdAt)}${run.label ? ` (${run.label})` : ""}.`,
      text: box("span", { class: "b-gear-changed" }, txt(`Your gear changed since: newer scans came in${diff.length ? `, and ${plural(diff.length, "setting")} changed` : ""}.`), diff.length ? el("span", { class: "t-sm muted" }, since) : null),
      actions: [button({ label: "Build again", kbd: "⌘↵", variant: "primary", size: "sm", attrs: { "aria-keyshortcuts": "Meta+Enter Control+Enter" }, onClick: () => { applySettings(run.settings); commands.build(); } }), ...(diff.length ? [load] : [])], attrs: { class: "msg warn saved-run" } });
  banner.querySelector(".kbd")?.setAttribute("aria-hidden", "true");
  document.getElementById("b-run-banner")?.replaceChildren(banner);
}
// A scan landing while a saved run's banner is up: the banner says so.
document.addEventListener("inventorychange", () => {
  const run = bannerRun;
  if (run && session.openRun === run.id && !session.job && document.querySelector("#b-run-banner .saved-run")) paintRunBanner(run, runSettingsDiff(settingsSnapshot(), run.settings));
});

// ---------------------------------------------------------------- arriving (issue #272)
// A run's name in a short list: the player's own, else the drawer's automatic label (`before`: the character's run before it).
const runTitle = (run: RunSummaryLike, before: RunSummaryLike | undefined): string => run.label || autoLabel(run, before).text;
// One row of a short list of runs: its name and when it was built, a button that opens it.
function runRow(text: string, when: string, onClick: () => void, current = false): HTMLElement {
  return box("li", {}, box("button", { type: "button", class: `b-run-row${current ? " current" : ""}`, ...(current ? { "aria-current": "true" } : {}), onclick: onClick }, txt(text, "ellip"), txt(when, "t-sm muted")));
}
// "<name>'s runs" beside a result: the character's latest three runs, the shown one marked, New build back to the first-visit
// view and All saved runs (the drawer). Hidden with no runs; redrawn in place when the runs or the shown run change.
function runsCard(): HTMLElement {
  const name = session.character, runs = session.runs || [];
  if (!name || !runs.length) return el("section", { id: "b-myruns", hidden: "" });
  return box("section", { class: "card b-side-card", id: "b-myruns", "aria-labelledby": "b-myruns-h" },
    el("h3", { class: "t-md strong", id: "b-myruns-h" }, `${who(name)}'s runs`),
    box("ul", { class: "b-run-rows" }, ...runs.slice(0, 3).map((r, i) => runRow(runTitle(r, runs[i + 1]), fmtRunDay(r.createdAt), () => { if (session.openRun !== r.id) void openRun(r.id); }, session.openRun === r.id))),
    button({ label: "All saved runs", variant: "ghost", size: "sm", cls: "b-link", onClick: openRunsDrawer }));
}
document.addEventListener("builderchange", (e) => {
  const key = (e as CustomEvent<{ key: string }>).detail.key;
  if (["runs", "openRun", "job"].includes(key)) document.getElementById("b-myruns")?.replaceWith(runsCard());
});
// The first-visit view's "Other characters' recent runs": the latest run of up to three other characters still scanned,
// each opening its character with that run, as the drawer opens one; null with none.
// Every character's runs, fetched once and kept until the runs change (loadRuns, a refresh).
let allRuns: Promise<RunSummaryLike[]> | null = null;
async function otherRunsCard(name: string): Promise<HTMLElement | null> {
  let all: RunSummaryLike[];
  try { all = await (allRuns ||= api<RunsListApiResponse>("/api/runs").then((r) => r.runs || [])); } catch { allRuns = null; return null; }
  const known = (c: string | undefined): boolean => !!c && (Object.hasOwn(state.inv?.characters || {}, c) || c === NOBODY);
  const others = otherCharactersRuns(all.filter((r) => known(r.character)), name);
  if (!others.length) return null;
  const before = (r: RunSummaryLike): RunSummaryLike | undefined => { const mine = all.filter((x) => x.character === r.character); return mine[mine.indexOf(r) + 1]; };
  return box("section", { class: "card b-side-card", id: "b-other-runs", "aria-labelledby": "b-other-runs-h" },
    el("h3", { class: "t-md strong", id: "b-other-runs-h" }, "Other characters' recent runs"),
    box("ul", { class: "b-run-rows" }, ...others.map((r) => runRow(`${who(r.character!)} · ${runTitle(r, before(r))}`, fmtRunDay(r.createdAt), () => {
      if (session.job) { toast(BUILD_RUNNING); return; }
      commands.setManualFor(r.character === NOBODY ? null : r.character!);
      commands.selectCharacter(r.character!, r.id);
    }))));
}

export async function compareSelected(): Promise<void> {
  // Same rule as openRun: a build finishing would draw over the comparison.
  if (session.job) { toast("A build is running. Cancel it or wait before comparing runs."); return; }
  const ids = [...session.compare];
  if (ids.length < 2) return;
  const got = await Promise.all(ids.map((id) => api<RunApiResponse>(`/api/runs/${id}`).catch(() => ({ ok: false }))));
  if (!got.every((g) => g.ok)) { toast("Could not load the runs.", "bad"); return; }
  // Every element passed the `.ok` check above; `.every()` doesn't narrow the source array.
  const runs = (got as Array<RunApiResponse & { ok: true }>).map((g) => g.run).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt))) as SavedRunLike[];
  closeRunsDrawer();
  commands.showAutomatic();
  // Each run under the name the drawer shows it by: its own, else its automatic label.
  const list = session.runs;
  const titleOf = (r: SavedRunLike): string => { const i = list.findIndex((x) => x.id === r.id); return r.label || autoLabel(r, i >= 0 ? list[i + 1] : undefined).text; };
  commands.openRunCompare(runs, titleOf, (id) => { openRun(id); }, (id) => { session.compare = toggleCompare(session.compare, id, false).next; renderRuns(); });
}
provide({ loadRuns, openRunsDrawer, runsCard, otherRunsCard, startOver });
