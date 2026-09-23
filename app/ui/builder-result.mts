// ui/builder-result.mts — what the Suit Builder shows right of its panel (design spec 4.6 empty state, 4.7):
// the character's current suit before any build, then a result in answer-first order (headline with the
// resist tiles and the other changes, the Plan, the Fetch list, the other suits, "<name> after the change",
// Solver details), and the compare view for 2-3 suits or saved runs. The numbers come from
// ui/builder-model.mts; the bridge actions are gated by ui/bridge.mts's bridgeGate().
import { OPTIMIZER_SLOTS, RESIST_KEYS, getRules, resistSkillBonus, totalsOf, requirementReport, settingsDiff } from "../vault-lib.mts";
import type { EffectiveProfile, Item, OptItem, PropMap } from "../vault-lib.mts";
import { state } from "./store.mts";
import type { BuildMeta } from "./store.mts";
import { $, el, label, fmtN, fmtSecs, fmtRunTime, slotLabel, rarCell } from "./dom.mts";
import { box, txt, button, icon, badge, message, meter, switchControl, check, table, tableFoot, rowActions, tipWrap, keyValue, token } from "./components.mts";
import { sheetNode } from "./sheet.mts";
import { bridgeGate, grabAll, grabbable, sendBridge, rootPos } from "./bridge.mts";
import { toast } from "./dom.mts";
import { resolveItems } from "./items.mts";
import { renderPanel } from "./builder.mts";
import { afterChange, compareModel, hiddenRowsNote, otherChanges, plural, resistOutcome, toggleCompare, propName, type CompareMember } from "./builder-model.mts";
import type { OptSuit, OptimizeResult, SavedRunLike } from "./api-types.mts";

const RESIST_NAMES: Record<string, [string, string]> = { physResist: ["Physical", "--res-phys"], fireResist: ["Fire", "--res-fire"], coldResist: ["Cold", "--res-cold"], poisonResist: ["Poison", "--res-poison"], energyResist: ["Energy", "--res-energy"] };
const serialHex = (s: number): string => `0x${s.toString(16)}`;
// A piece's key properties, strongest first: "SSI 35 · DCI 11 · Hit Fireball 36".
function keyProps(props: PropMap | undefined, n = 3): string {
  return Object.entries(props || {}).filter(([k, v]) => k !== "tagPenalty" && !k.endsWith("Pool") && v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n).map(([k, v]) => `${label(k)} ${v}`).join(" · ");
}
// A resist's cap for this character's race, in paperdoll terms.
function raceCap(k: string, race: string | null | undefined): number {
  const rules = getRules();
  return (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race as string]?.[k] ?? (rules.caps as Record<string, number>)[k] ?? 70;
}
// One resist tile: its name in its resist colour, the value (before → after when there is a before) against
// the requirement or cap, a meter and the outcome line.
function resistTile(k: string, after: number, floor: number | null, cap: number, before: number | null = null): HTMLElement {
  const [name, colour] = RESIST_NAMES[k]!;
  const out = resistOutcome(after, floor, cap);
  const target = floor != null && before == null ? floor : cap;
  const value = before == null
    ? box("span", { class: "b-resist-val" }, txt(after, "t-xl"), txt(`/ ${target}`, "muted"))
    : box("span", { class: "b-resist-val" }, txt(before, "muted"), icon("arrow-right", { size: "sm" }), txt(after, "t-xl"), txt(`/ ${cap}`, "muted"));
  return box("div", { class: "resist" }, el("span", { class: "t-sm", style: `color:var(${colour})` }, name), value,
    meter(Math.min(after, target), target, { tone: out.tone === "warn" ? "warn" : "ok", label: `${name} ${after} of ${target}` }), txt(out.text, `t-sm tone-${out.tone}`));
}

// ---------------------------------------------------------------- empty state: the current suit
// Before any build: the five resists of what the character wears now against the panel's requirements, and
// the worn pieces. It is also what a result is compared against.
let currentShown: string | null = null;
export function renderCurrentSuit(name: string): void {
  currentShown = name;
  $<HTMLElement>("#b-result")!.replaceChildren(currentSuitCard(name));
}
export function refreshCurrentSuit(): void {
  if (currentShown && currentShown === state.builder.character && !state.builder.result && document.getElementById("b-current")) renderCurrentSuit(currentShown);
}
function currentSuitCard(name: string): HTMLElement {
  const worn = state.inv!.worn[name] || [];
  const p = state.builder.profile;
  const rsb = resistSkillBonus(state.inv!.characters[name]?.skills);
  const totals = totalsOf(Object.fromEntries(worn.map((i) => [String(i.serial), i as unknown as OptItem])));
  const tiles = RESIST_KEYS.map((k) => resistTile(k, (totals[k] || 0) + rsb, p?.floors?.[k] ?? null, raceCap(k, p?.race)));
  const order = (it: Item): number => { const i = OPTIMIZER_SLOTS.indexOf(it.slot || ""); return i < 0 ? 99 : i; };
  const rows = [...worn].sort((a, b) => order(a) - order(b)).map((it) => ({ cells: [slotLabel(it.slot), txt(it.name), rarCell(it), txt(keyProps(it.props) || "no properties", keyProps(it.props) ? "muted" : "faint")] }));
  return el("section", { class: "card b-flush", id: "b-current", "aria-label": `${name}'s current suit` },
    box("div", { class: "card-head" }, el("h2", {}, "Current suit"), txt(`What ${name} wears now, against the requirements`, "t-sm muted")),
    box("div", { class: "b-resists card-pad" }, ...tiles),
    rows.length ? table({ label: "Worn now", columns: [{ label: "Slot", width: "18%" }, { label: "Wearing", width: "30%" }, { label: "Rarity", width: "18%" }, { label: "Key properties" }], rows })
      : box("div", { class: "card-pad" }, el("p", { class: "muted" }, txt(`${name} wore nothing the last scan could read.`))));
}

// ---------------------------------------------------------------- result
// Two calls can overlap (Show on another suit, a saved run landing while one still resolves its pieces), so
// renderSeq is a generation counter: bumped at entry, checked after the only await, and every DOM write is one
// replaceChildren at the end, so an overtaken call never leaves a mix of two suits on screen.
let renderSeq = 0;
let last: { res: OptimizeResult; current: OptSuit; prof: EffectiveProfile; name: string; meta: BuildMeta | undefined } | null = null;
let showUnchanged = false, sheetOpen = false, detailsOpen = false;
let picked = new Set<string>();   // the other suits ticked for comparison: "0" is the best, "n" is suit #n+1
let pickRefused: string | null = null;
export function resetResultView(): void { renderSeq++; last = null; picked = new Set(); pickRefused = null; }
export function resultLoadError(e: unknown): void {
  $<HTMLElement>("#b-result")!.replaceChildren(message({ tone: "bad", title: "Could not load the suit's items", text: (e as Error).message }));
}
const rerender = (): void => { if (last) renderResult(last.res, last.current, last.prof, last.name, last.meta).catch(resultLoadError); };
// The bridge coming online or going away changes which actions are live.
document.addEventListener("bridgechange", () => { if (last && !state.builder.job) rerender(); });

// `name` is the character the result was built for, never read from the selection: a caller that awaited
// anything before this call may find another character selected by now.
export async function renderResult(res: OptimizeResult, current: OptSuit, prof: EffectiveProfile, name: string, meta?: BuildMeta): Promise<void> {
  const mySeq = ++renderSeq;
  if (last?.res !== res) { picked = new Set(); pickRefused = null; }
  last = { res, current, prof, name, meta };
  currentShown = null;
  const alts = res.alternatives || [];
  const view = state.builder.altView != null && alts[state.builder.altView] ? state.builder.altView : null;
  const suit = view == null ? res.best : alts[view]!.best;
  const changes = OPTIMIZER_SLOTS.filter((sl) => (current[sl]?.serial || 0) !== (suit[sl]?.serial || 0));
  // The optimizer's own item shape has no location or equippedBy: resolve full records for the pieces the
  // Plan and Fetch list are about to show. A piece that no longer resolves (rescanned away) keeps its name.
  const resolved = await resolveItems(changes.map((sl) => suit[sl]?.serial).filter(Boolean));
  if (mySeq !== renderSeq) return;
  const fetchItems = changes.map((sl) => (suit[sl] ? resolved[suit[sl]!.serial] : undefined)).filter((it): it is Item => !!it && it.equippedBy !== name);
  const nodes = [
    headlineCard(res, current, suit, prof, name, view, changes.length, fetchItems, meta),
    planCard(current, suit, name, changes, resolved),
    fetchCard(fetchItems, name),
    res.altTolerance != null ? otherSuitsCard(res, view) : null,
    afterCard(name, current, suit),
    detailsCard(res, meta, view),
  ].filter((x): x is HTMLElement => !!x);
  const out = $<HTMLElement>("#b-result")!;
  out.classList.remove("b-stale"); out.inert = false; out.removeAttribute("aria-hidden");
  out.replaceChildren(...nodes);
}

// ---- 1. headline: the answer, its verdict, the resists and every other change
function verdict(res: OptimizeResult): { text: string; tone?: "ok" | "warn" | "bad" | undefined; detail?: string | undefined } {
  if (res.floorsConflict) return { text: "Requirements can't all be met", tone: "bad", detail: "No suit in the pool meets every hard requirement; this is the best partial suit." };
  if (res.solver === "fallback") return { text: "Heuristic fallback", tone: "warn", detail: res.fallbackReason || "The exact solver was unavailable, so this is the heuristic's answer." };
  if (res.method === "exact" && res.proven) return { text: "Proven optimal", tone: "ok" };
  if (res.method === "exact") return { text: "Best within budget", tone: "warn", detail: res.gapPoints == null ? "No bound was established: raise the time budget to finish the proof." : `At most ${fmtN(res.gapPoints)} points from the bound: raise the time budget to finish the proof.` };
  return { text: "Heuristic" };
}
function headlineCard(res: OptimizeResult, current: OptSuit, suit: OptSuit, prof: EffectiveProfile, name: string, view: number | null, nChanges: number, fetchItems: Item[], meta: BuildMeta | undefined): HTMLElement {
  const before = totalsOf(current), after = totalsOf(suit);
  const rsb = prof.resistBonus || 0;
  const report = requirementReport(after, prof);
  const unmet = report.filter((r) => r.met === false).length, floors = report.filter((r) => r.met != null).length;
  const v = verdict(res);
  const vb = box("span", { class: `badge${v.tone ? " " + v.tone : ""}` }, v.tone === "ok" ? icon("check", { size: "sm" }) : null, txt(v.text));
  const line = [plural(nChanges, "change"), floors ? (unmet ? `${plural(unmet, "requirement")} not met` : "every requirement met") : "",
    meta ? (meta.reused ? `reused the run from ${fmtRunTime(meta.reused.createdAt)}` : `found in ${fmtSecs(meta.ms)}`) : ""].filter(Boolean).join(" · ");
  const todo = grabbable(fetchItems, name);
  const gate = bridgeGate("grab");
  const grab = button({ label: todo.length ? `Grab all ${todo.length}` : "Grab all", icon: "grab", variant: "primary", disabled: !!gate || !todo.length, onClick: () => grabAll(fetchItems, name), attrs: { id: "b-grab-all" } });
  const grabCtl = gate || !todo.length ? tipWrap(grab, gate || `Nothing to grab: every piece is already with ${name} or worn.`) : grab;
  const tiles = RESIST_KEYS.map((k) => resistTile(k, (after[k] || 0) + rsb, prof.floors[k] != null ? prof.floors[k]! + rsb : null, (prof.caps[k] ?? 70) + rsb, (before[k] || 0) + rsb));
  const other = otherChanges([...Object.keys(prof.floors), ...Object.keys(prof.weights)], before, after, prof.caps, prof.floors);
  const unreachable = (res.unreachableFloors || []).length ? message({ tone: "warn", text: `No suit in the pool can reach these requirements: ${res.unreachableFloors!.map((k) => propName(k)).join(", ")}.` }) : null;
  return box("section", { class: "card b-head-card", "aria-label": view == null ? "Best suit" : `Suit ${view + 2}` },
    box("div", { class: "b-headline" },
      box("div", { class: "b-headline-text" }, box("div", { class: "b-row" }, el("h2", { class: "t-xl" }, view == null ? `Best suit for ${name}` : `Suit #${view + 2} for ${name}`), vb), el("p", { class: "muted" }, txt(line))),
      grabCtl),
    v.detail ? message({ tone: v.tone === "bad" ? "bad" : "warn", text: v.detail }) : null,
    unreachable,
    box("div", { class: "b-resists" }, ...tiles),
    other.length ? box("div", { class: "b-badges", role: "list", "aria-label": "Other changes" }, ...other.map((o) => box("span", { class: `badge ${o.tone}`, role: "listitem" }, txt(o.text)))) : null);
}

// ---- 2. plan: the slots that change, with lock / highlight / grab
function planCard(current: OptSuit, suit: OptSuit, name: string, changes: string[], resolved: Record<number, Item>): HTMLElement {
  const p = state.builder.profile;
  const unchanged = OPTIMIZER_SLOTS.filter((sl) => !changes.includes(sl));
  const slots = showUnchanged ? OPTIMIZER_SLOTS : changes;
  const rows = slots.map((slot) => {
    const now = current[slot], next = suit[slot], changed = changes.includes(slot);
    const item = changed && next ? resolved[next.serial] || null : null;
    const locked = !!p?.lockedSlots?.includes(slot);
    const acts: Parameters<typeof rowActions>[0] = [];
    if (p && state.builder.character === name) acts.push({ label: locked ? `Unlock ${slotLabel(slot)}` : `Lock ${slotLabel(slot)} in the next build`, icon: "lock", onClick: () => {
      p.lockedSlots = locked ? p.lockedSlots!.filter((x) => x !== slot) : [...(p.lockedSlots || []), slot];
      renderPanel(); rerender();
    } });
    if (item && !item.equippedBy) {
      acts.push({ label: `Highlight ${item.name}`, icon: "highlight", disabled: bridgeGate("highlight"), onClick: () => bridgeSend("highlight", item) });
      acts.push({ label: `Grab ${item.name}`, icon: "grab", disabled: bridgeGate("grab"), onClick: () => bridgeSend("grab", item) });
    }
    const ra = rowActions(acts);
    if (locked) ra.querySelector(".btn")?.classList.add("on");
    const where = !changed ? txt("") : item ? txt(item.equippedBy ? `worn by ${item.equippedBy}` : item.location?.text || "", "t-sm muted") : next ? txt("not in the current inventory", "t-sm faint") : txt("");
    return { cells: [slotLabel(slot), now ? txt(now.name, changed ? "muted" : "") : txt("Empty", "faint"),
      !changed ? txt("keep", "muted") : next ? txt(next.name, "strong") : txt("nothing", "faint"),
      where, next && changed ? txt(keyProps(next.props) || "no properties", keyProps(next.props) ? "muted" : "faint") : txt(""), ra],
      attrs: next ? { "data-serial": next.serial } : {} };
  });
  const sw = switchControl({ label: "Show unchanged slots", checked: showUnchanged, onChange: (v) => { showUnchanged = v; rerender(); } });
  sw.root.classList.add("t-sm");
  const tbl = rows.length ? table({ label: "Plan", density: "dense", columns: [{ label: "Slot", width: "118px" }, { label: "Wearing now", width: "16%" }, { label: "Wear instead", width: "22%" }, { label: "Where", width: "15%" }, { label: "Gains" }, { label: "Actions", width: "100px" }], rows }) : null;
  if (tbl) {
    tbl.classList.add("b-plan");
    tbl.querySelector("thead th:last-child")!.replaceChildren(el("span", { class: "sr" }, "Actions"));
    for (const td of tbl.querySelectorAll("tbody td:last-child")) td.classList.add("b-act");
  }
  const unchangedNames = unchanged.map((sl) => (current[sl] ? `${slotLabel(sl)} (${current[sl]!.name})` : slotLabel(sl)));
  return el("section", { class: "card b-flush", "aria-label": "Plan" },
    box("div", { class: "card-head" }, el("h2", {}, "Plan"), txt(`${plural(changes.length, "slot")} ${changes.length === 1 ? "changes" : "change"} · ${unchanged.length} stay`, "t-sm muted"), el("span", { class: "spacer" }), sw.root),
    tbl || box("div", { class: "card-pad" }, el("p", { class: "muted" }, txt(`Nothing to change: what ${name} wears is already this suit.`))),
    !showUnchanged && unchanged.length && changes.length ? tableFoot(txt(`Unchanged: ${unchangedNames.join(", ")}`, "ellip")) : null);
}
async function bridgeSend(action: "highlight" | "grab" | "goto", it: Item): Promise<void> {
  const r = await sendBridge(action, it);
  toast(r.ok ? `${action === "goto" ? "Go to" : action[0]!.toUpperCase() + action.slice(1)}: ${it.name} queued` : r.error, r.ok ? "" : "bad");
}

// ---- 3. fetch list: one row per container, walk to each once
function fetchCard(items: Item[], name: string): HTMLElement | null {
  if (!items.length) return null;
  const groups = new Map<string, Item[]>();
  for (const it of items) { const k = `${it.container ?? it.location?.text}`; groups.set(k, [...(groups.get(k) || []), it]); }
  const rows = [...groups.values()].map((list) => {
    const first = list[0]!, cont = first.container != null ? state.inv!.containers[first.container] : null;
    const where = first.equippedBy ? `Worn by ${first.equippedBy}` : first.location?.text || "Unknown place";
    const mine = grabbable(list, name);
    const goGate = bridgeGate("goto") || (rootPos(first) ? null : "This container's position was not recorded, so the bridge can't walk to it.");
    const grabGate = bridgeGate("grab") || (mine.length ? null : `Nothing to grab here: it is already with ${name} or worn.`);
    const go = button({ label: "Go to", size: "sm", icon: "goto", disabled: !!goGate, onClick: () => bridgeSend("goto", first) });
    const grab = button({ label: `Grab ${mine.length || list.length}`, size: "sm", icon: "grab", disabled: !!grabGate, onClick: () => grabAll(list, name) });
    return box("div", { class: "b-fetch" },
      box("span", { class: "b-fetch-where" }, txt(where, "strong ellip"), txt(`${cont && !where.includes(serialHex(+cont.serial)) ? serialHex(+cont.serial) + " · " : ""}${plural(list.length, "piece")}`, "t-sm faint")),
      el("p", { class: "muted" }, txt(list.map((i) => i.name).join(", "))),
      box("span", { class: "b-fetch-acts" }, goGate ? tipWrap(go, goGate) : go, grabGate ? tipWrap(grab, grabGate) : grab));
  });
  return el("section", { class: "card", "aria-label": "Fetch list" },
    box("div", { class: "card-head" }, el("h2", {}, "Fetch list"), txt("Walk to each chest once", "t-sm muted")),
    box("div", { class: "b-fetch-list" }, ...rows));
}

// ---- 4. other suits within the tolerance, tick 2 or 3 to compare
function otherSuitsCard(res: OptimizeResult, view: number | null): HTMLElement {
  const all = [{ best: res.best, score: res.score }, ...(res.alternatives || [])];
  const tb = totalsOf(res.best), shownIdx = view == null ? 0 : view + 1;
  const title = `Other suits within ${fmtN(res.altTolerance)} points`;
  if (all.length === 1) return el("section", { class: "card", "aria-label": "Other suits" }, box("div", { class: "card-head" }, el("h2", {}, title)),
    box("div", { class: "card-pad" }, el("p", { class: "muted" }, txt(`No other suit scores within ${fmtN(res.altTolerance)} points of the best.`))));
  const rows = all.map((s, i) => {
    const ta = totalsOf(s.best), d = s.score - res.score;
    const slotsDiff = OPTIMIZER_SLOTS.filter((sl) => (s.best[sl]?.serial || 0) !== (res.best[sl]?.serial || 0));
    const propDiff = [...new Set([...Object.keys(ta), ...Object.keys(tb)])].filter((k) => k !== "tagPenalty" && (ta[k] || 0) !== (tb[k] || 0))
      .sort((x, y) => label(x).localeCompare(label(y))).map((k) => { const v = (ta[k] || 0) - (tb[k] || 0); return `${label(k)} ${v > 0 ? "+" : "−"}${Math.abs(v)}`; });
    const tick = check({ label: "", checked: picked.has(String(i)), attrs: { "aria-label": i === 0 ? "Select the best suit" : `Select suit ${i + 1}` }, onChange: (on) => {
      const r = toggleCompare(picked, String(i), on, 3, "suits");
      picked = r.next; pickRefused = r.refused;
      rerender();
    } });
    return { cells: [tick.input, i === 0 ? badge("Best", "best") : txt(`#${i + 1}`), i === 0 ? txt("—", "muted") : txt(Math.abs(d) < 1e-6 ? "ties" : `${d > 0 ? "+" : "−"}${fmtN(Math.abs(Math.round(d)))}`),
      i === 0 ? txt(res.proven ? "the proven best" : "the best found", "muted") : txt(slotsDiff.map((sl) => `${slotLabel(sl)}: ${s.best[sl] ? s.best[sl]!.name : "nothing"}`).join(" · ")),
      i === 0 ? txt("") : txt(propDiff.join(" · ") || "same totals", "muted"),
      i === shownIdx ? txt("Showing", "t-sm muted") : button({ label: "Show", size: "sm", onClick: () => { state.builder.altView = i === 0 ? null : i - 1; rerender(); } })],
      attrs: picked.has(String(i)) ? { class: "sel" } : {} };
  });
  const n = picked.size;
  const cmp = button({ label: n >= 2 ? `Compare ${n} suits` : "Compare suits", size: "sm", disabled: n < 2, onClick: () => openSuitCompare([...picked].map(Number).sort((a, b) => a - b)) });
  return el("section", { class: "card b-flush", "aria-label": "Other suits" },
    box("div", { class: "card-head" }, el("h2", {}, title), txt(pickRefused ? `${pickRefused} can be compared` : "Tick 2 or 3 to compare", `t-sm ${pickRefused ? "tone-warn" : "muted"}`), el("span", { class: "spacer" }),
      n < 2 ? tipWrap(cmp, "Tick 2 or 3 suits to compare them.") : cmp),
    (() => { const t = table({ label: "Other suits", columns: [{ label: "Select", width: "44px" }, { label: "Suit", width: "80px" }, { label: "vs best", num: true, width: "90px" }, { label: "Different pieces", width: "32%" }, { label: "Totals vs best" }, { label: "", width: "88px" }], rows });
      t.querySelector("thead th")!.replaceChildren(el("span", { class: "sr" }, "Select")); return t; })());
}

// ---- 5. <name> after the change: only the values that move
function afterCard(name: string, current: OptSuit, suit: OptSuit): HTMLElement {
  const c = state.inv!.characters[name];
  const rows = afterChange((c?.stats || {}) as Record<string, unknown>, (c?.maxes || {}) as Record<string, unknown>, totalsOf(current), totalsOf(suit));
  const tiles = rows.map((r) => box("div", { class: "b-stat" }, txt(r.label, "t-sm muted"),
    r.delta ? el("span", {}, txt(`${r.before ?? "?"} → `, "muted"), txt(r.after ?? "?", "strong")) : txt(r.before ?? "?", "strong"),
    txt(r.delta ? `${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}` : "no change", `t-sm ${r.delta > 0 ? "tone-ok" : r.delta < 0 ? "tone-bad" : "muted"}`)));
  const full = button({ label: sheetOpen ? "Hide full sheet" : "Full sheet", variant: "ghost", size: "sm", attrs: { "aria-expanded": String(sheetOpen) }, onClick: () => { sheetOpen = !sheetOpen; rerender(); } });
  // The full before/after sheet is sheet.mts's in-game style sheet for now (see docs/ui.md: the Characters
  // screen's shared "now → after" sheet replaces it).
  return el("section", { class: "card b-flush", "aria-label": "Character after the change" },
    box("div", { class: "card-head" }, el("h2", {}, `${name} after the change`), txt("Only values that move", "t-sm muted"), el("span", { class: "spacer" }), full),
    box("div", { class: "b-after" }, ...tiles),
    el("p", { class: "t-sm muted b-after-note" }, txt("Hits, Stamina and Mana after are estimates: current max plus the change in STR/2, DEX, INT and the +HP/+Stam/+Mana properties.")),
    sheetOpen ? el("div", { class: "b-sheet-wrap" }, sheetNode(name, current, suit)) : null);
}

// ---- 6. solver details: collapsed; the score lives here, not in the headline
function detailsCard(res: OptimizeResult, meta: BuildMeta | undefined, view: number | null): HTMLElement {
  const skipped = meta?.skipped;
  const cnt = (k: string): number => (Array.isArray(skipped?.[k]) ? (skipped![k] as unknown[]).length : +((skipped?.[k] as number) || 0));   // live arrays, or a saved run's counts
  const skips = ([["worn by others", cnt("worn")], ["too heavy", cnt("str")], ["tagged", cnt("tags")], ["gargoyle-only", cnt("gargoyle")], ["not meditation-safe", cnt("nonMed")], ["other weapon types", cnt("weapon")], ["in skipped containers", cnt("roots")]] as Array<[string, number]>)
    .filter(([, c]) => c).map(([l, c]) => `${fmtN(c)} ${l}`).join(", ");
  const solver = res.floorsConflict ? "HiGHS (requirements infeasible)" : res.solver === "highs" ? "HiGHS" : res.solver === "fallback" ? "heuristic (exact solver unavailable)" : res.solver === "none" ? "none needed" : res.method === "exact" ? "branch-and-bound" : "heuristic";
  const time = !meta ? "" : meta.reused ? `instant · first run took ${fmtSecs(meta.ms)}` : res.heuristicMs != null && res.mipMs != null ? `${fmtSecs(meta.ms)} (heuristic ${fmtSecs(res.heuristicMs)}, HiGHS ${fmtSecs(res.mipMs)})` : fmtSecs(meta.ms);
  const summary = [solver, meta?.poolSize != null ? `${fmtN(meta.poolSize)} candidates` : "", time, skips ? `left out ${skips}` : ""].filter(Boolean).join(" · ");
  const score = view == null ? res.score : res.alternatives![view]!.score;
  const t = box("button", { class: "b-disclose", type: "button", "aria-expanded": String(detailsOpen), "aria-controls": "b-details", onclick: () => { detailsOpen = !detailsOpen; rerender(); } },
    txt("Solver details", "t-md strong"), txt(summary, "t-sm muted"), icon(detailsOpen ? "chevron-up" : "chevron-down", { size: "sm" }));
  const pairs: Array<[string, string]> = [["Verdict", verdict(res).text], ["Solver", solver]];
  if (meta?.poolSize != null) pairs.push(["Candidates", fmtN(meta.poolSize)]);
  if (res.nodes != null) pairs.push(["Search nodes", fmtN(res.nodes)]);
  if (time) pairs.push(["Time", time]);
  if (skips) pairs.push(["Left out", skips]);
  pairs.push(["Score", `${fmtN(Math.round(res.currentScore))} → ${fmtN(Math.round(score))}`]);
  if (res.gapPoints != null) pairs.push(["Gap to the bound", `${fmtN(res.gapPoints)} points`]);
  if (res.altTolerance != null) pairs.push(["Other suits", `${fmtN((res.alternatives || []).length)} within ${fmtN(res.altTolerance)} points`]);
  if (meta?.reused) pairs.push(["Reused", `the run from ${fmtRunTime(meta.reused.createdAt)} (same inventory, settings and options)`]);
  return el("section", { class: "card", "aria-label": "Solver details" }, t, detailsOpen ? el("div", { class: "b-details", id: "b-details" }, keyValue(pairs)) : null);
}

// ---------------------------------------------------------------- compare (2-3 suits or saved runs)
interface CompareColumn extends CompareMember { head: HTMLElement; token: string; removeLabel: string; outcome: string[]; action: HTMLElement }
interface CompareSpec { title: string; noun: string; columns: CompareColumn[]; outcomeRows: string[]; settingsRow?: string[] | undefined; keys: string[]; caps: Record<string, number>; onRemove: (i: number) => void }
let diffOnly = true;
let openSpec: (() => CompareSpec) | null = null;
export function closeCompare(): void {
  if (!openSpec) return;
  openSpec = null;
  $<HTMLElement>("#tab-builder")!.classList.remove("comparing");
  $<HTMLElement>("#b-topbar")!.hidden = false;
  $<HTMLElement>("#b-cmp-topbar")!.hidden = true;
  $<HTMLElement>("#b-compare-view")!.hidden = true;
  $<HTMLElement>("#tab-builder")!.setAttribute("aria-labelledby", "h-builder");
}
function showCompare(spec: () => CompareSpec): void {
  openSpec = spec;
  const s = spec();
  if (s.columns.length < 2) { closeCompare(); return; }
  const name = state.builder.character || "";
  const back = button({ label: "Back to result", icon: "chevron-left", size: "sm", onClick: () => closeCompare() });
  const crumb = el("a", { href: `#/builder/${encodeURIComponent(name)}` }, `Suit Builder · ${name}`);
  crumb.addEventListener("click", (e) => { e.preventDefault(); closeCompare(); });
  $<HTMLElement>("#b-cmp-topbar")!.replaceChildren(box("nav", { class: "b-crumb", "aria-label": "Breadcrumb" }, crumb, el("span", { class: "faint", "aria-hidden": "true" }, "/"), el("h1", { id: "h-builder-cmp" }, s.title)), el("span", { class: "spacer" }), back);
  $<HTMLElement>("#tab-builder")!.classList.add("comparing");
  $<HTMLElement>("#tab-builder")!.setAttribute("aria-labelledby", "h-builder-cmp");
  $<HTMLElement>("#b-topbar")!.hidden = true;
  $<HTMLElement>("#b-cmp-topbar")!.hidden = false;
  const view = $<HTMLElement>("#b-compare-view")!;
  view.hidden = false;
  const m = compareModel(s.columns, OPTIMIZER_SLOTS, s.keys, s.caps, diffOnly);
  const cols = s.columns;
  const tr = (cls: string, ...cells: HTMLElement[]): HTMLTableRowElement => el("tr", cls ? { class: cls } : {}, ...cells);
  const group = (text: string): HTMLTableRowElement => tr("group", el("td", { colspan: cols.length + 1 }, txt(text, "caps")));
  const body: HTMLTableRowElement[] = [];
  if (s.settingsRow) body.push(group("Settings"), tr("", el("td", {}, "Changed from the first"), ...s.settingsRow.map((t) => el("td", { class: "muted" }, t))));
  if (m.pieces.length) body.push(group(diffOnly ? "Pieces that differ" : "Pieces"), ...m.pieces.map((r) => tr("", el("td", {}, r.label), ...r.cells.map((c) => el("td", c.diff ? { class: "diff" } : {}, c.text)))));
  if (m.totals.length) body.push(group(diffOnly ? "Totals that differ" : "Totals"), ...m.totals.map((r) => tr("", el("td", {}, r.label), ...r.values.map((v, i) => el("td", r.best[i] ? { class: "best" } : {}, fmtN(v).replace("-", "−"))))));
  body.push(group("Outcome"), ...s.outcomeRows.map((rowLabel, ri) => tr("", el("td", {}, rowLabel), ...cols.map((c) => el("td", {}, c.outcome[ri] || "")))));
  body.push(tr("", el("td", { class: "b-cmp-act" }, el("span", { class: "sr" }, "Actions")), ...cols.map((c) => el("td", { class: "b-cmp-act" }, c.action))));
  const tbl = el("table", { class: "tbl b-cmp", "aria-label": s.title }, el("colgroup", {}, el("col", { style: "width:220px" }), ...cols.map(() => el("col"))),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, txt("Property")), ...cols.map((c) => el("th", { scope: "col" }, c.head)))), el("tbody", {}, ...body));
  const note = diffOnly ? hiddenRowsNote(cols.length, m.hiddenTotals, m.hiddenPieces) : "";
  const sw = switchControl({ label: "Differences only", checked: diffOnly, onChange: (v) => { diffOnly = v; if (openSpec) showCompare(openSpec); } });
  view.replaceChildren(
    box("div", { class: "b-cmp-bar" }, txt("Comparing", "t-sm muted"), ...cols.map((c, i) => token({ label: c.token, removeLabel: c.removeLabel, onRemove: () => { s.onRemove(i); } })), txt("up to 3", "t-sm muted"), el("span", { class: "spacer" }), sw.root),
    el("div", { class: "card b-flush" }, el("div", { class: "b-tbl-scroll" }, tbl), note ? tableFoot(txt(note)) : null));
}
// Resists in paperdoll values (item totals + the Resisting Spells bonus) against paperdoll caps.
function paperdoll(totals: PropMap, rsb: number): PropMap {
  const t = { ...totals };
  for (const k of RESIST_KEYS) t[k] = (t[k] || 0) + rsb;
  return t;
}
function paperdollCaps(race: string | null | undefined): Record<string, number> {
  const caps = { ...(getRules().caps as Record<string, number>) };
  for (const k of RESIST_KEYS) caps[k] = raceCap(k, race);
  return caps;
}
function compareKeys(cols: Array<{ totals: PropMap }>, prof: { floors?: Record<string, number>; weights?: Record<string, number> }): string[] {
  const keys = new Set<string>([...Object.keys(prof.floors || {}), ...Object.keys(prof.weights || {})]);
  for (const c of cols) for (const [k, v] of Object.entries(c.totals)) if (v) keys.add(k);
  return [...keys].sort((a, b) => {
    const ra = RESIST_KEYS.indexOf(a), rb = RESIST_KEYS.indexOf(b);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || propName(a).localeCompare(propName(b));
  });
}
// The result's suits: the best and the ticked other suits.
function openSuitCompare(indices: number[]): void {
  if (!last) return;
  const { res, prof, name } = last;
  let idx = [...indices];
  showCompare(() => {
    const all = [{ best: res.best, score: res.score }, ...(res.alternatives || [])];
    const shownIdx = state.builder.altView == null ? 0 : state.builder.altView + 1;
    const columns: CompareColumn[] = idx.map((i) => {
      const s = all[i]!, d = s.score - res.score;
      const sub = i === 0 ? (res.proven ? "the proven best" : "the best found") : Math.abs(d) < 1e-6 ? "ties the best" : `${fmtN(Math.abs(Math.round(d)))} points ${d < 0 ? "below" : "above"}`;
      const head = box("span", { class: "b-cmp-col" }, i === 0 ? box("span", { class: "b-row" }, badge("Best", "best"), res.proven ? badge("Proven optimal", "ok") : null) : txt(`#${i + 1}`, "strong"), txt(sub, "t-sm"));
      const action = i === shownIdx ? txt("Showing in the result", "t-sm muted") : button({ label: "Show this suit", size: "sm", onClick: () => { state.builder.altView = i === 0 ? null : i - 1; closeCompare(); rerender(); } });
      return { assignment: s.best, totals: paperdoll(totalsOf(s.best), prof.resistBonus || 0), head, token: i === 0 ? "Best" : `#${i + 1} · ${Math.abs(d) < 1e-6 ? "ties" : `${d < 0 ? "−" : "+"}${fmtN(Math.abs(Math.round(d)))}`}`,
        removeLabel: i === 0 ? "Remove Best from comparison" : `Remove suit ${i + 1} from comparison`, outcome: [i === 0 ? "—" : Math.abs(d) < 1e-6 ? "0" : `${d < 0 ? "−" : "+"}${fmtN(Math.abs(Math.round(d)))}`], action };
    });
    return { title: "Compare suits", noun: "suits", columns, outcomeRows: ["Points vs best"], keys: compareKeys(columns, prof), caps: paperdollCaps(state.builder.profile?.race),
      onRemove: (i) => { idx = idx.filter((_, j) => j !== i); picked = new Set(idx.map(String)); if (idx.length < 2) { closeCompare(); rerender(); } else showCompare(openSpec!); } };
  });
  void name;
}
// Saved runs from the drawer, oldest first. `open` shows one of them in the result.
export function openRunCompare(runs: SavedRunLike[], titleOf: (r: SavedRunLike) => string, open: (id: string) => void, onRemove: (id: string) => void): void {
  let list = [...runs];
  const name = state.builder.character || "";
  const rsb = resistSkillBonus(state.inv!.characters[name]?.skills);
  showCompare(() => {
    const columns: CompareColumn[] = list.map((r) => {
      const floors = r.settings.floors || {};
      const totals = paperdoll(totalsOf(r.result.best), rsb);
      const met = Object.keys(floors).filter((k) => (totals[k] || 0) >= floors[k]!).length;
      const v = verdict(r.result);
      const head = box("span", { class: "b-cmp-col" }, box("span", { class: "b-row" }, txt(titleOf(r), "strong"), badge(v.text, v.tone === "bad" ? "bad" : v.tone)), txt(`${fmtRunTime(r.createdAt)} · ${fmtSecs(r.ms || 0)}`, "t-sm"));
      const action = r.id === state.builder.openRun ? txt("Showing in the result", "t-sm muted") : button({ label: "Open this run", size: "sm", onClick: () => { closeCompare(); open(r.id); } });
      return { assignment: r.result.best, totals, head, token: r.label || fmtRunTime(r.createdAt), removeLabel: `Remove the run from ${fmtRunTime(r.createdAt)} from comparison`,
        outcome: [plural((r.result.perSlotChanges || []).length, "change"), Object.keys(floors).length ? `${met} of ${Object.keys(floors).length}` : "none set", v.text], action };
    });
    const first = list[0]!;
    const settingsRow = list.map((r, i) => (i === 0 ? "—" : settingsDiff(first.settings, r.settings).join(" · ") || "same settings"));
    const keys = compareKeys(columns, { floors: Object.assign({}, ...list.map((r) => r.settings.floors || {})), weights: Object.assign({}, ...list.map((r) => r.settings.weights || {})) });
    return { title: "Compare runs", noun: "runs", columns, outcomeRows: ["Changes", "Requirements met", "Verdict"], settingsRow, keys, caps: paperdollCaps(state.builder.profile?.race),
      onRemove: (i) => { const gone = list[i]!; list = list.filter((_, j) => j !== i); onRemove(gone.id); if (list.length < 2) closeCompare(); else showCompare(openSpec!); } };
  });
}
