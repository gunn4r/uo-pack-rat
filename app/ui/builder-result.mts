// ui/builder-result.mts — a Suit Builder result (design spec 4.7) in answer-first order (headline with the
// resist tiles and What changes, the Plan, the Fetch list, the other suits, "<name> after the change",
// Solver details) with the character's runs beside it (ui/runs.mts runsCard), and the compare view for 2-3 suits or
// saved runs. Before a build the first-visit view (ui/builder-start.mts) has the screen. The numbers come from
// ui/builder-model.mts; the bridge actions are gated by ui/bridge.mts's bridgeActionReason(). It shares the builder's
// state through ui/builder-session.mts and provides the result and compare commands there.
//
// map: builder
// owns: `applyResultPrefs`
import { GEAR_SLOTS, NOBODY, RESIST_KEYS, STRICT_PROMISE, TAGGED_NOTE, resistSkillOf, resistSkillCapOf, toOptItem, totalsOf, requirementReport, resistCapsFor, profileResistCaps, fcCapFor } from "../vault-lib.mts";
import type { EffectiveProfile, Goals, GoalSwingWeapon, Item, PropMap, ResistCap } from "../vault-lib.mts";
import { state } from "./store.mts";
import type { BuildMeta } from "./store.mts";
import { $, el, label, fmtN, fmtSecs, fmtRunTime, slotLabel, whereText } from "./dom.mts";
import { box, txt, button, icon, badge, message, meter, segmented, switchControl, check, table, tableFoot, rowActions, tipWrap, tooltip, keyValue, token, resistTile } from "./components.mts";
import { prefs } from "./prefs.mts";
import { sheetNode, sheetParts } from "./sheet.mts";
import { bridgeActionReason, runBridgeAction } from "./bridge.mts";
import { resolveItems } from "./items.mts";
import { session, commands, announce, provide, onChange } from "./builder-session.mts";
import { RESIST_NAMES, keyProps, tipTarget, verdict, grabAllButton, fetchCard, settingsCheck } from "./builder-parts.mts";
import { savedBuffs, plannedFromWorn, buffById, buffsDiff, runBuffs, signed } from "../buffs.mts";
import type { RunBuffs } from "../vault-lib.mts";
import { slotsOf, paperdollCaps, pastCapNotes, runSettingsDiff, withBuffs, afterChange, compareModel, hiddenRowsNote, changeRows, gaugeRows, worse, gaugeNote, gaugeTrack, changesSummary, nextSwingStep, sharePct, resistOutcome, toggleCompare, propName, capNote, capsLine, anyOverridden, effectiveFloor, resultChecks, shareRows, swingLines, who, rarityDetail, rarityTotal, strictDetail, goalOutcomes, goalTrades, goalVerdict, swingOutcome, tradeText, spareLine, pieceMark, GONE_MARK, type ChangeRow, type CompareMember } from "./builder-model.mts";
import { heldWeapon, ssiShareOf, swingOf, swingSeconds, SSI_CAP } from "../swing.mts";
import type { GearChanges, ScoreShare, SwingResult } from "../runs-types.mts";
import type { OptSuit, OptimizeResult, SavedRunLike, UiPrefs } from "./api-types.mts";
import { plural } from "./format.mts";

// One resist tile: its name in its resist colour, the value (before → after when there is a before) against
// the requirement or cap, a meter and the outcome line, and under it the cap's override when the build has one
// ("Cap raised from 70"): the tile's numbers are then against the player's cap, not the shard's.
function resultResistTile(k: string, after: number, floor: number | null, c: ResistCap, before: number | null = null): HTMLElement {
  const [name, colour] = RESIST_NAMES[k]!;
  const cap = c.cap, note = capNote(c);
  const out = resistOutcome(after, floor, cap);
  const target = floor != null && before == null ? floor : cap;
  const value = before == null
    ? box("span", { class: "b-resist-val" }, txt(after, "t-xl"), txt(`/ ${target}`, "muted"))
    : box("span", { class: "b-resist-val" }, txt(before, "muted"), icon("arrow-right", { size: "sm" }), txt(after, "t-xl"), txt(`/ ${cap}`, "muted"));
  return resistTile(name, colour, value,
    meter(Math.min(after, target), target, { tone: out.tone === "warn" ? "warn" : "ok", label: `${name} ${after} of ${target}` }), txt(out.text, `t-sm tone-${out.tone}`),
    note ? txt(`Cap ${note}`, "t-sm strong b-cap-note") : null);
}

// ---------------------------------------------------------------- result
// Two calls can overlap (Show on another suit, a saved run landing while one still resolves its pieces), so
// renderSeq is a generation counter: bumped at entry, checked after the only await, and every DOM write is one
// replaceChildren at the end, so an overtaken call never leaves a mix of two suits on screen.
let renderSeq = 0;
let last: { res: OptimizeResult; current: OptSuit; prof: EffectiveProfile; name: string; meta: BuildMeta | undefined } | null = null;
let showUnchanged = false, sheetOpen = false, detailsOpen = false;
// "Show without buffs": the result's totals drawn without the buffs it was planned with (no new search).
let withoutBuffs = false;
let picked = new Set<string>();   // the other suits ticked for comparison: "0" is the best, "n" is suit #n+1
let pickRefused: string | null = null;
// A saved run's gear changes refreshed by a scan (ui/runs.mts): the Plan redrawn with their marks.
function setResultGear(gear: GearChanges | null): Promise<void> {
  if (!last) return Promise.resolve();
  const { gearChanges: _old, ...meta } = last.meta ?? ({} as BuildMeta);
  last = { ...last, meta: { ...meta, ...(gear ? { gearChanges: gear } : {}) } as BuildMeta };
  return rerender();
}
function resetResultView(): void { renderSeq++; last = null; picked = new Set(); pickRefused = null; session.outcome = null; }
function resultLoadError(e: unknown): void {
  $<HTMLElement>("#b-result")!.replaceChildren(message({ tone: "bad", title: "Could not load the suit's items", text: (e as Error).message }));
}
const rerender = (): Promise<void> => (last ? renderResult(last.res, last.current, last.prof, last.name, last.meta).catch(resultLoadError) : Promise.resolve());
// The bridge coming online or going away changes which actions are live.
document.addEventListener("bridgechange", () => { if (last && !session.job) rerender(); });

// `name` is the character the result was built for, never read from the selection: a caller that awaited
// anything before this call may find another character selected by now.
async function renderResult(res: OptimizeResult, current: OptSuit, prof: EffectiveProfile, name: string, meta?: BuildMeta): Promise<void> {
  const mySeq = ++renderSeq;
  const again = last?.res === res;
  if (!again) { picked = new Set(); pickRefused = null; withoutBuffs = false; }
  last = { res, current, prof, name, meta };
  // what the Requirements tab says each need came to: the best suit with the buffs it was planned with
  const planned = withBuffs(totalsOf(res.best), prof.resistSkill, paperdollCaps(profileResistCaps(prof), fcCapOf(prof)), prof.buffs, resistSkillCapOf(state.inv!.characters[name]?.skills));
  session.outcome = { name, totals: planned.totals, caps: planned.caps, swing: res.swing ?? null, weapon: heldWeapon(res.best)?.name ?? null };
  const alts = res.alternatives || [];
  const view = session.altView != null && alts[session.altView] ? session.altView : null;
  const suit = view == null ? res.best : alts[view]!.best;
  const slots = slotsOf(res.best), changes = slots.filter((sl) => (current[sl]?.serial || 0) !== (suit[sl]?.serial || 0));
  // The optimizer's own item shape has no location or equippedBy: resolve full records for the pieces the
  // Plan and Fetch list are about to show. A piece that no longer resolves (rescanned away) keeps its name.
  const resolved = await resolveItems(changes.map((sl) => suit[sl]?.serial).filter(Boolean));
  if (mySeq !== renderSeq) return;
  const fetchItems = changes.map((sl) => (suit[sl] ? resolved[suit[sl]!.serial] : undefined)).filter((it): it is Item => !!it && it.equippedBy !== name);
  const nodes = [
    headlineCard(res, current, suit, prof, name, view, changes.length, fetchItems, meta),
    planCard(current, suit, name, slots, changes, resolved, meta?.gearChanges),
    fetchCard(fetchItems, name === NOBODY ? null : name),
    res.altTolerance != null ? otherSuitsCard(res, view) : null,
    afterCard(name, current, suit, prof),
    detailsCard(res, meta, view, prof),
  ].filter((x): x is HTMLElement => !!x);
  const out = $<HTMLElement>("#b-result")!;
  out.classList.remove("b-stale"); out.inert = false; out.removeAttribute("aria-hidden");
  // the saved run's banner (ui/runs.mts paintRunBanner) heads the main column; a redraw of the same result keeps it
  const banner = (again && document.getElementById("b-run-banner")) || el("div", { id: "b-run-banner" });
  const goals = meta?.goals && res.method !== "manual" ? goalsCard(meta.goals, meta.goalSwing ?? null, current, suit, prof, name, view == null && !!res.diagnostics?.some((d) => d.code === "swing_linear")) : null;
  out.replaceChildren(box("div", { class: "b-arrive" }, box("div", { class: "b-arrive-main" }, banner, ...nodes), box("aside", { class: "b-arrive-side", "aria-label": goals ? "Goals and runs" : "Runs" }, goals, commands.runsCard())));
}

// A built profile's Faster Casting cap before any planned buff (vault-lib.mts fcCapFor), for paperdollCaps.
const fcCapOf = (prof: EffectiveProfile): number | undefined => (prof.buffs?.caps ?? prof.caps).fc;

// ---- 1. headline: the answer, its verdict (ui/builder-parts.mts), the resists and every other change
function headlineCard(res: OptimizeResult, current: OptSuit, suit: OptSuit, prof: EffectiveProfile, name: string, view: number | null, nChanges: number, fetchItems: Item[], meta: BuildMeta | undefined): HTMLElement {
  const before = totalsOf(current), after = totalsOf(suit);
  const skill = prof.resistSkill;
  // in paperdoll terms, with the buffs it was planned with unless "Show without buffs" is on, against the caps they leave
  const caps = profileResistCaps(prof), base = paperdollCaps(caps, fcCapOf(prof)), shown = withoutBuffs ? null : prof.buffs;
  const rsCap = resistSkillCapOf(state.inv!.characters[name]?.skills);
  const was = withBuffs(before, skill, base, shown, rsCap), now = withBuffs(after, skill, base, shown, rsCap), pdFloors = prof.buffs?.floors ?? prof.floors;
  // with buffs planned, a requirement is met or not by the totals shown, with or without them
  const floorKeys = Object.keys(pdFloors).filter((k) => k !== "tagPenalty");
  const report = requirementReport(after, prof), floors = prof.buffs ? floorKeys.length : report.filter((r) => r.met != null).length;
  const unmet = prof.buffs ? floorKeys.filter((k) => (now.totals[k] || 0) < effectiveFloor(k, pdFloors[k]!, now.caps)).length : report.filter((r) => r.met === false).length;
  const v = verdict(res);
  const vb = v.text && res.method !== "manual" ? box("span", { class: `badge${v.tone ? " " + v.tone : ""}` }, v.tone === "ok" ? icon("check", { size: "sm" }) : null, txt(v.text)) : null;
  const line = [plural(nChanges, "change"), floors ? (unmet ? `${plural(unmet, "requirement")} not met` : "every requirement met") : "",
    res.method === "manual" ? "built by hand" : meta ? (meta.reused ? `reused the run from ${fmtRunTime(meta.reused.createdAt)}` : `found in ${fmtSecs(meta.ms)}`) : ""].filter(Boolean).join(" · ");
  // Manual takes the suit as it is shown, with the buffs it was planned with (one undo step there)
  const manual = res.method === "manual", buffsUsed: RunBuffs | undefined = prof.buffs ? runBuffs(prof.buffs.on, prof.buffs.skills) : undefined;
  const start = button({ label: manual ? "Open in Manual" : "Start from this result", icon: "pencil", attrs: { id: "b-to-manual" },
    onClick: () => { void commands.openInManual(suit, slotsOf(res.best), buffsUsed, manual ? "Open the manual run" : "Start from the result"); } });
  const tiles = RESIST_KEYS.map((k) => resultResistTile(k, now.totals[k]!, pdFloors[k] ?? null, { cap: now.caps[k]!, shard: caps[k]!.shard }, was.totals[k]!));
  const shareList = view == null ? res.shares : res.alternatives![view]!.shares;
  // the gauges are for what this build asks for: a non-zero weight or a requirement; a buff's past-cap amount always has a row
  const matter = [...Object.entries(prof.weights).filter(([, w]) => w).map(([k]) => k), ...Object.keys(pdFloors)], past = pastCapNotes(now);
  const rows = changeRows(was.totals, now.totals, now.caps, { floors: pdFloors, weights: prof.weights, shares: shareList, extra: [...Object.keys(prof.floors), ...Object.keys(past)] });
  // the next swing step is the result's, so only while the SSI shown is the one it swings at (not with "Show without buffs" taking a buff's share off)
  const nextSsi = view == null && res.swing && res.swing.ssi === (now.totals.ssi || 0) ? nextSwingStep(res.swing)?.value ?? null : null;
  // built from goals, SSI counted per point is said under the Swing speed goal in How the goals went, not as a warning here
  const checks = settingsCheck(resultChecks(res, !!prof.buffs, view != null).filter((d) => !(meta?.goals && d.code === "swing_linear")), name);
  // the best suit's swing (an alternative's would need its own stamina), with the buffs that gave its share named
  const ssiBuffs = res.swing?.share ? (withBuffs(after, skill, base, prof.buffs, rsCap).shares.ssi || []).filter((x) => !x.outside).map((x) => buffById(x.id)?.name || x.id) : [];
  const swing = view == null && res.swing ? swingLine(res.swing, heldWeapon(suit)?.name ?? null, ssiBuffs) : null;
  return box("section", { class: "card b-head-card", "aria-label": view == null ? "Best suit" : `Suit ${view + 2}` },
    box("div", { class: "b-headline" },
      box("div", { class: "b-headline-text" }, box("div", { class: "b-row" }, el("h2", { class: "t-xl" }, `${manual ? "Manual suit" : view == null ? "Best suit" : `Suit #${view + 2}`}${name === NOBODY ? " · No character" : ` for ${name}`}`), vb), el("p", { class: "muted" }, txt(line)), plannedWith(prof, name)),
      box("div", { class: "b-head-acts" }, session.openRun && name === session.character ? button({ label: "New build", attrs: { id: "b-new-build" }, disabled: !!session.job, onClick: () => commands.startOver() }) : null,
        start, grabAllButton(fetchItems, name === NOBODY ? null : name, { id: "b-grab-all" }))),
    v.detail ? message({ tone: v.tone === "bad" ? "bad" : "warn", text: v.detail }) : null,
    checks,
    box("div", { class: "b-resists" }, ...tiles),
    swing,
    whatChanges(rows, matter, nextSsi, past, !!shareList),
    changesView === "table" ? null : scoreBreakdown(shareList));
}

// What changes (issue #272): its summary line (of the gauges) and the Gauges | Table switch (ui-prefs `builderChanges`, kept for the next launch), then a gauge per property other than the resists that the build asks for and whose total moves (builder-model.mts gaugeRows), a line per buff's past-cap amount on a property with no gauge, and "+N more changes in Table"; or every property of the result in a table with its share of the score, which then stands in for the score breakdown.
let changesView: "gauges" | "table" = "gauges";
export function applyResultPrefs(p: UiPrefs | null): void { if (p?.builderChanges === "table") changesView = "table"; }
const numText = (v: number): string => fmtN(v).replace("-", "−");
type PastNotes = Record<string, { text: string; short: string }>;
function whatChanges(rows: ChangeRow[], matter: string[], nextSsi: number | null, past: PastNotes, hasShares: boolean): HTMLElement {
  const { gauges, more } = gaugeRows(rows, matter);
  const show = (v: string): void => {
    changesView = v === "table" ? "table" : "gauges";
    prefs.set({ builderChanges: changesView }, { quiet: true });
    void rerender().then(() => document.querySelector<HTMLElement>("#b-chg-view [aria-checked=true]")?.focus());
  };
  const seg = segmented({ label: "Show the changes as", options: [{ value: "gauges", label: "Gauges" }, { value: "table", label: "Table" }], value: changesView, onChange: show });
  seg.id = "b-chg-view";
  const loose = Object.keys(past).filter((k) => !gauges.some((r) => r.key === k));
  return box("div", { class: "b-chg" },
    box("div", { class: "b-chg-head" }, el("h3", { class: "t-md", id: "b-chg-h" }, "What changes"), txt(changesSummary(gauges), "t-sm muted"), el("span", { class: "spacer" }), seg),
    ...(changesView === "table" ? changesTable(rows, past, hasShares) : [
      gauges.length ? box("ul", { class: "b-gauges", "aria-labelledby": "b-chg-h" }, ...gauges.map((r) => gauge(r, nextSsi, past[r.key]?.text))) : null,
      loose.length ? box("div", { class: "b-past" }, ...loose.map((k) => txt(`${label(k)} ${past[k]!.text}`, "t-sm muted"))) : null,
      more ? button({ label: `+${plural(more, "more change")} in Table`, variant: "ghost", size: "sm", cls: "b-chg-more", onClick: () => show("table") }) : null]));
}
// One gauge: the short name (the full one for a screen reader), the suit's total against its cap and the change in what counts, a track filled to the suit's total with a tick at what is worn now, and its note. A change against the build (builder-model.mts worse) is in the bad tone, a gain in the ok tone.
function gauge(r: ChangeRow, nextSsi: number | null, past: string | undefined): HTMLElement {
  const note = gaugeNote(r, nextSsi), t = gaugeTrack(r), loss = worse(r);
  return box("li", { class: `b-gauge${loss ? " loss" : ""}` },
    box("span", { class: "b-gauge-top" }, el("span", { class: "b-gauge-name muted", title: propName(r.key), "aria-hidden": "true" }, label(r.key)), txt(propName(r.key), "sr"), txt(numText(r.suit), "b-gauge-val"), r.cap != null ? txt(`/ ${numText(r.cap)}`, "muted") : null,
      el("span", { class: "spacer" }), txt(r.delta ? signed(r.delta) : "0", `b-gauge-delta ${!r.delta ? "muted" : loss ? "tone-bad" : "tone-ok"}`), txt(`, was ${numText(r.now)}`, "sr")),
    box("span", { class: "b-gauge-track", "aria-hidden": "true" }, el("i", { style: `width:${t.fill}%` }), el("s", { style: `left:${t.tick}%` })),
    txt(note.text, `t-sm ${note.warn ? "tone-warn" : "muted"}`), past ? txt(past, "t-sm muted") : null);
}
// The Table view: Property · Now · Suit · Cap · Change · Share of score, resists first, the columns as wide as their content. When narrow it scrolls in its own box (a labelled region the keyboard can scroll, with a shadow on the side that has more) and the Property column stays put. A run saved without shares says so under it.
function changesTable(rows: ChangeRow[], past: PastNotes, hasShares: boolean): Array<HTMLElement | null> {
  // a buff's past-cap amount sits after the cap, its whole sentence on hover and for a screen reader
  const cap = (r: ChangeRow): HTMLElement => { const p = past[r.key], c = txt(r.cap != null ? numText(r.cap) : "—", "muted");
    return p ? box("span", { class: "b-cap-past", title: p.text }, c, el("span", { class: "t-sm muted", "aria-hidden": "true" }, ` · ${p.short}`), txt(`, ${p.text}`, "sr")) : c; };
  // a total past its cap says by how much, as a gauge does
  const suit = (r: ChangeRow): HTMLElement => (r.cap != null && r.suit > r.cap ? box("span", {}, txt(numText(r.suit), "strong"), txt(` (${numText(r.suit - r.cap)} over)`, "t-sm muted")) : txt(numText(r.suit), "strong"));
  const cells = rows.map((r) => ({ cells: [txt(propName(r.key)), txt(numText(r.now), "muted"), suit(r), cap(r),
    txt(r.delta ? signed(r.delta) : "0", !r.delta ? "muted" : worse(r) ? "tone-bad" : "tone-ok"),
    !hasShares ? txt("—", "muted") : r.share == null ? txt("") : tuneButton({ key: r.key, name: `${propName(r.key)} ${sharePct(r.share)}`, cls: "b-tune" }, meter(Math.round(Math.abs(r.share) * 1000), 1000, { tone: r.share < 0 ? "warn" : undefined }), txt(sharePct(r.share), `b-share-pct${r.share < 0 ? " tone-warn" : ""}`))] }));
  const t = table({ label: "What changes", columns: [{ label: "Property" }, { label: "Now", num: true }, { label: "Suit", num: true }, { label: "Cap", num: true }, { label: "Change", num: true }, { label: "Share of score" }], rows: cells });
  t.classList.add("b-chg-tbl");
  const scroller = box("div", { class: "b-chg-scroll", role: "region", "aria-label": "What changes, table", tabindex: 0 }, t);
  const edges = (): void => {
    scroller.classList.toggle("more-left", scroller.scrollLeft > 0);
    scroller.classList.toggle("more-right", scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1);
  };
  scroller.addEventListener("scroll", edges, { passive: true });
  new ResizeObserver(edges).observe(scroller);
  return [scroller, hasShares ? null : el("p", { class: "t-sm muted b-chg-note" }, "Share of score: not recorded in this run.")];
}
// A share of the score as a button that opens the Build Settings drawer on its weight (builder.mts tuneWeight, which hands the focus back to it when the drawer closes); Other (null) on the Weights tab.
function tuneButton({ key, name, cls, title }: { key: string | null; name: string; cls: string; title?: string | null }, ...kids: Array<HTMLElement | null>): HTMLButtonElement {
  return box("button", { type: "button", class: cls, "aria-label": name, ...(title ? { title } : {}), onclick: (e: MouseEvent) => commands.tuneWeight(key, e.currentTarget as HTMLElement) }, ...kids);
}

// What made up the score (issue #273): each weighted property's share as a bar (ui/builder-model.mts shareRows). Collapsed: the top three positive rows, small shares folded into Other (its names in its accessible name and tooltip), and every negative row. "Show all" lists every property on its own row and stays open for the page session. A resist held at its minimum carries a short "incl. min" mark whose sentence a screen reader and a tooltip give. None for a run saved before it.
let sharesAll = false;
function scoreBreakdown(shares: ScoreShare[] | undefined): HTMLElement | null {
  if (!shares?.length) return null;
  const all = shareRows(shares, 0), folded = shareRows(shares), positive = folded.filter((r) => !r.negative);
  const shown = sharesAll ? all : [...positive.slice(0, 3), ...folded.filter((r) => r.negative)];
  // each row opens its weight in the Build Settings drawer
  const items = shown.map((r, i) => box("li", { class: r.negative && !shown[i - 1]?.negative && i ? "b-share-neg" : "" },
    tuneButton({ key: r.key, name: `${r.label} ${r.pct}${r.holds ? `: ${r.holds}` : ""}${r.note ? ` (${r.note})` : ""}`, cls: "b-share", title: r.holds },
      box("span", { class: "b-share-name" }, txt(r.label), r.note ? el("span", { class: "t-sm muted", title: r.note }, " · incl. min") : null),
      meter(Math.round(Math.abs(r.share) * 1000), 1000, { tone: r.negative ? "warn" : undefined }),
      txt(r.pct, `b-share-pct${r.negative ? " tone-warn" : ""}`))));
  const more = positive.length > 3 || positive.some((r) => r.holds) ? button({ label: sharesAll ? "Show fewer" : `Show all (${all.length})`, variant: "ghost", size: "sm", attrs: { id: "b-shares-more" },
    onClick: () => { sharesAll = !sharesAll; void rerender().then(() => document.getElementById("b-shares-more")?.focus()); } }) : null;
  return box("div", { class: "b-shares" }, box("div", { class: "b-chg-head" }, el("h3", { class: "t-sm muted", id: "b-shares-h" }, "What made up the score"), txt("select a row to tune its weight", "t-sm muted")), box("ul", { class: "b-share-list", "aria-labelledby": "b-shares-h" }, ...items), more);
}

// How the goals went (issue #292), beside a result built from goals: each goal's total in the suit shown against its cap
// (a swing-time goal's SSI, else the build's) and its verdict (builder-model.mts goalVerdict: maxed, given up in a trade, or
// what came first); Swing speed in seconds from the suit's own swing (swingOutcome), with a note when its swing could only be
// counted per point; the trades the build made from what is worn now (a higher goal down while a lower one went up); and
// where the spare points went or what they gave up. In paperdoll terms, with the buffs it was planned with.
function goalsCard(g: Goals, gs: GoalSwingWeapon | null, current: OptSuit, suit: OptSuit, prof: EffectiveProfile, name: string, perPoint: boolean): HTMLElement {
  const base = paperdollCaps(profileResistCaps(prof), fcCapOf(prof)), rsCap = resistSkillCapOf(state.inv!.characters[name]?.skills);
  const was = withBuffs(totalsOf(current), prof.resistSkill, base, prof.buffs, rsCap), now = withBuffs(totalsOf(suit), prof.resistSkill, base, prof.buffs, rsCap);
  const ssiCap = (prof.buffs?.caps ?? prof.caps).ssi, caps = { ...now.caps, ...(ssiCap != null ? { ssi: Math.min(ssiCap, now.caps.ssi ?? ssiCap) } : {}) };
  // each suit's swing with its own weapon, at the build's stamina before gear
  const swingIn = (s: OptSuit): ReturnType<typeof swingOf> | null => { const w = heldWeapon(s); return w && prof.swing ? swingOf(w.speed!, prof.swing.stamBase, totalsOf(s), ssiShareOf(prof)) : null; };
  // the weapon the goal was set for and its fastest swing at that stamina: the run's (`gs`, issue #302), else, in a run saved
  // before it, the weapon worn now at the worn stamina
  const from = swingIn(current), to = swingIn(suit), worn = heldWeapon(current);
  const set = gs ?? (worn && prof.swing ? { weapon: worn.name, speed: worn.speed!, stamina: prof.swing.refStamina } : null);
  const goalWeapon = set ? { seconds: swingSeconds(set.speed, set.stamina, SSI_CAP), weapon: set.weapon || null, speed: set.speed } : null;
  const swing = to ? swingOutcome(g, to, heldWeapon(suit)?.name ?? null, !nextSwingStep(to), goalWeapon) : null;
  // Strict order makes no trades by construction (a higher goal is never given up for a lower one)
  const strict = g.strategy === "strict", trades = strict ? [] : goalTrades(g, was.totals, now.totals, caps), rows = goalOutcomes(g, now.totals, caps, swing?.maxed ?? null);
  return box("section", { class: "card b-side-card", id: "b-goals-went", "aria-labelledby": "b-goals-went-h" }, el("h3", { class: "t-md", id: "b-goals-went-h" }, "How the goals went"),
    box("ol", { class: "b-went" }, ...rows.map((r) => box("li", {}, box("span", { class: "b-went-name" }, txt(`${r.rank}.`, "muted"), txt(propName(r.key))),
      r.key === "ssi" && swing ? box("span", { class: "b-went-swing" }, txt(swing.text, "b-went-val"), txt(` · ${swing.ssi}`, "t-sm muted"), swing.after ? txt(` (${swing.after})`, "t-sm muted") : null)
        : txt(r.cap != null ? `${numText(r.value)} / ${numText(r.cap)}` : numText(r.value), "b-went-val"),
      txt((r.key === "ssi" && swing?.verdict) || goalVerdict(r, trades), `t-sm ${r.maxed ? "tone-ok" : "muted"}`),
      r.key === "ssi" && perPoint ? txt("Swing time isn't counted in steps here, because the suit isn't tied to one weapon.", "t-sm muted") : null))),
    trades.length ? box("ul", { class: "b-trades" }, ...trades.map((t) => el("li", { class: "t-sm" }, txt(`Trade made: ${tradeText(t, from && to ? { from: from.seconds, to: to.seconds } : null)}`))))
      : strict ? el("p", { class: "t-sm muted b-no-trades" }, txt(`Strict order: no trades. ${STRICT_PROMISE}`)) : null,
    // strict order wears a tagged piece whenever it helps a goal (the tag penalty is a stage after the goals)
    strict && Object.values(suit).some((it) => it && (it.props.tagPenalty || 0) > 0 && !Object.values(current).some((c) => c?.serial === it.serial))
      ? el("p", { class: "t-sm muted b-tagged" }, txt(TAGGED_NOTE)) : null,
    ((line) => (line ? el("p", { class: "t-sm" }, txt(line)) : null))(spareLine(g, was.totals, now.totals)));
}

// The swing line under the resists: the weapon, stamina and SSI and the delay they give, then the steps at that stamina with the reached ones in the ok tone.
function swingLine(sw: SwingResult, weapon: string | null, buffs: string[]): HTMLElement {
  const m = swingLines(sw, weapon, buffs);
  const steps = m.steps.flatMap((st, i) => [i ? txt(" · ", "faint") : null, st.reached ? txt(`${st.text} ✓`, "tone-ok") : txt(st.text)]).filter((x): x is HTMLElement => !!x);
  return box("div", { class: "b-swing", "aria-label": "Swing speed" }, el("p", {}, txt(m.head)),
    m.steps.length || m.out ? el("p", { class: "t-sm muted" }, txt(`Steps at stamina ${sw.stamina}: `), ...steps, m.out ? txt(`${m.steps.length ? " · " : ""}${m.out}`) : null) : null);
}

// "Planned with [Divine Fury] [Bless] · Show without buffs", and which numbers were taken from the suit worn now. The
// switch redraws the totals; the suit stays the one the search found with the buffs.
function plannedWith(prof: EffectiveProfile, name: string): HTMLElement | null {
  if (!prof.buffs) return null;
  const flip = button({ label: "Show without buffs", variant: "ghost", size: "sm", attrs: { id: "b-buffs-shown", "aria-pressed": String(withoutBuffs) }, onClick: () => {
    withoutBuffs = !withoutBuffs; void rerender().then(() => document.getElementById("b-buffs-shown")?.focus());
  } });
  // each buff whose numbers came from the suit worn now, with what they came from
  // (No character wears nothing, so it has none of either)
  const worn = plannedFromWorn(prof.buffs.on).map((id) => {
    const b = buffById(id)!, enchant = b.excl === "enchant";
    return name === NOBODY ? `${b.name} is worked out with no worn suit, so with no ${enchant ? "Spell Channeling" : "Enhance Potions"}`
      : `${b.name} is worked out from the suit ${name} wears now (${enchant ? "its weapon's Spell Channeling" : "its Enhance Potions"})`;
  });
  return box("div", { class: "b-planned" }, txt("Planned with", "t-sm muted"), ...prof.buffs.on.map((id) => badge(buffById(id)!.name, "accent")), txt("·", "faint"),
    tooltip(flip, "Redraws the totals without the buffs. The suit stays the one found with them: nothing is searched again."),
    worn.length ? el("p", { class: "t-sm muted b-planned-note" }, txt(`${worn.join(". ")}.`)) : null);
}

// ---- 2. plan: the slots that change, with lock / highlight / grab
// A saved run's piece that moved since or is gone is marked in Where (issue #291, `gear`); a gone one has nothing to grab.
function planCard(current: OptSuit, suit: OptSuit, name: string, all: string[], changes: string[], resolved: Record<number, Item>, gear: GearChanges | undefined): HTMLElement {
  const p = session.profile;
  const unchanged = all.filter((sl) => !changes.includes(sl));
  const slots = showUnchanged ? all : changes;
  const rows = slots.map((slot) => {
    const now = current[slot], next = suit[slot], changed = changes.includes(slot);
    const item = changed && next ? resolved[next.serial] || null : null;
    const locked = !!p?.lockedSlots?.includes(slot);
    const acts: Parameters<typeof rowActions>[0] = [];
    if (p && session.character === name) acts.push({ label: locked ? `Unlock ${slotLabel(slot)}` : `Lock ${slotLabel(slot)} in the next build`, icon: "lock", onClick: () => {
      p.lockedSlots = locked ? p.lockedSlots!.filter((x) => x !== slot) : [...(p.lockedSlots || []), slot];
      announce("panel"); rerender();
    } });
    if (item && !item.equippedBy) {
      acts.push({ label: `Highlight ${item.name}`, icon: "highlight", disabled: bridgeActionReason("highlight", item), onClick: () => runBridgeAction("highlight", item) });
      acts.push({ label: `Grab ${item.name}`, icon: "grab", disabled: bridgeActionReason("grab", item), onClick: () => runBridgeAction("grab", item) });
    }
    const ra = rowActions(acts);
    if (locked) ra.querySelector(".btn")?.classList.add("on");
    // a saved run's piece that moved or is gone: its mark in Where, and under the piece's name while Where is hidden (narrow)
    const mark = pieceMark(gear, (changed ? next : now)?.serial, whereText), markCls = `t-sm b-mark ${mark === GONE_MARK ? "faint" : "tone-warn"}`;
    const where = mark ? txt(mark, markCls) : !changed ? txt("") : item ? txt(item.equippedBy ? `worn by ${item.equippedBy}` : whereText(item.location?.text), "t-sm muted") : next ? txt(GONE_MARK, "t-sm faint") : txt("");
    const instead = !changed ? txt("keep", "muted") : next ? tipTarget(txt(next.name, "strong"), next) : txt("nothing", "faint");
    // each piece's name answers for its own tooltip, the worn one and its replacement
    return { cells: [slotLabel(slot), now ? tipTarget(txt(now.name, changed ? "muted" : ""), now) : txt("Empty", "faint"),
      mark ? box("span", {}, instead, txt(mark, `${markCls} b-mark-narrow`)) : instead,
      where, next && changed ? txt(keyProps(next.props) || "no properties", keyProps(next.props) ? "muted" : "faint") : txt(""), ra] };
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
    tbl || box("div", { class: "card-pad" }, el("p", { class: "muted" }, txt(`Nothing to change: what ${who(name)} wears is already this suit.`))),
    !showUnchanged && unchanged.length && changes.length ? tableFoot(txt(`Unchanged: ${unchangedNames.join(", ")}`, "ellip")) : null);
}
// ---- 3. fetch list: ui/builder-parts.mts fetchCard
// ---- 4. other suits within the tolerance, tick 2 or 3 to compare
function otherSuitsCard(res: OptimizeResult, view: number | null): HTMLElement {
  const all = [{ best: res.best, score: res.score }, ...(res.alternatives || [])];
  const tb = totalsOf(res.best), shownIdx = view == null ? 0 : view + 1;
  const title = `Other suits within ${fmtN(res.altTolerance)} points`;
  // strict order: fewer than asked because no more suits match on every goal
  const n0 = all.length - 1, unequal = res.altShortfall === "unequal" ? (n0 ? `Only ${plural(n0, "other suit")} ${n0 === 1 ? "matches" : "match"} on every goal.` : "No other suit matches on every goal.") : null;
  if (all.length === 1 && unequal) return el("section", { class: "card", "aria-label": "Other suits" }, box("div", { class: "card-head" }, el("h2", {}, title)), box("div", { class: "card-pad" }, el("p", { class: "muted" }, txt(unequal))));
  if (all.length === 1) return el("section", { class: "card", "aria-label": "Other suits" }, box("div", { class: "card-head" }, el("h2", {}, title)),
    box("div", { class: "card-pad" }, el("p", { class: "muted" }, txt(res.altShortfall === "budget" ? `The time budget ran out before another suit within ${fmtN(res.altTolerance)} points was found.` : `No other suit scores within ${fmtN(res.altTolerance)} points of the best.`))));
  const rows = all.map((s, i) => {
    const ta = totalsOf(s.best), d = s.score - res.score;
    const slotsDiff = GEAR_SLOTS.filter((sl) => (s.best[sl]?.serial || 0) !== (res.best[sl]?.serial || 0));
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
      i === shownIdx ? txt("Showing", "t-sm muted") : button({ label: "Show", size: "sm", onClick: () => { session.altView = i === 0 ? null : i - 1; rerender(); } })],
      attrs: picked.has(String(i)) ? { class: "sel" } : {} };
  });
  const n = picked.size;
  const cmp = button({ label: n >= 2 ? `Compare ${n} suits` : "Compare suits", size: "sm", disabled: n < 2, onClick: () => openSuitCompare([...picked].map(Number).sort((a, b) => a - b)) });
  return el("section", { class: "card b-flush", "aria-label": "Other suits" },
    box("div", { class: "card-head" }, el("h2", {}, title), txt(pickRefused ? `${pickRefused} can be compared` : "Check 2 or 3 to compare", `t-sm ${pickRefused ? "tone-warn" : "muted"}`), el("span", { class: "spacer" }),
      n < 2 ? tipWrap(cmp, "Check 2 or 3 suits to compare them.") : cmp),
    (() => { const t = table({ label: "Other suits", columns: [{ label: "Select", width: "44px" }, { label: "Suit", width: "80px" }, { label: "vs best", num: true, width: "90px" }, { label: "Different pieces", width: "32%" }, { label: "Totals vs best" }, { label: "", width: "88px" }], rows });
      t.querySelector("thead th")!.replaceChildren(el("span", { class: "sr" }, "Select")); return t; })(),
    unequal ? box("div", { class: "card-pad" }, el("p", { class: "muted b-unequal" }, txt(unequal))) : null);
}

// ---- 5. <name> after the change: only the values that move
function afterCard(name: string, current: OptSuit, suit: OptSuit, prof: EffectiveProfile): HTMLElement {
  // No character wears nothing: the suit's item totals, as Manual's stats card draws them
  if (name === NOBODY) return el("section", { class: "card b-flush", "aria-label": "Suit totals" },
    box("div", { class: "card-head" }, el("h2", {}, "Suit totals"), txt("Item totals: no character", "t-sm muted")),
    box("div", { class: "sheet card-pad" }, sheetParts(null, {}, suit, { compare: false, statsOnly: true }).props));
  const c = state.inv!.characters[name];
  const rows = afterChange((c?.stats || {}) as Record<string, unknown>, (c?.maxes || {}) as Record<string, unknown>, totalsOf(current), totalsOf(suit));
  const tiles = rows.map((r) => box("div", { class: "b-stat" }, txt(r.label, "t-sm muted"),
    r.delta ? el("span", {}, txt(`${r.before ?? "?"} → `, "muted"), txt(r.after ?? "?", "strong")) : txt(r.before ?? "?", "strong"),
    txt(r.delta ? `${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}` : "no change", `t-sm ${r.delta > 0 ? "tone-ok" : r.delta < 0 ? "tone-bad" : "muted"}`)));
  const full = button({ label: sheetOpen ? "Hide full sheet" : "Full sheet", variant: "ghost", size: "sm", attrs: { "aria-expanded": String(sheetOpen) }, onClick: () => { sheetOpen = !sheetOpen; rerender(); } });
  // The full before/after sheet is sheet.mts's in-game style sheet for now (see docs/ui/characters.md: the Characters
  // screen's shared "now → after" sheet replaces it).
  return el("section", { class: "card b-flush", "aria-label": "Character after the change" },
    box("div", { class: "card-head" }, el("h2", {}, `${name} after the change`), txt("Only values that move", "t-sm muted"), el("span", { class: "spacer" }), full),
    box("div", { class: "b-after" }, ...tiles),
    el("p", { class: "t-sm muted b-after-note" }, txt("Hits, Stamina and Mana after are estimates: current max plus the change in STR/2, DEX, INT and the +HP/+Stam/+Mana properties.")),
    sheetOpen ? el("div", { class: "b-sheet-wrap" }, sheetNode(name, current, suit, { resistCaps: profileResistCaps(prof) })) : null);
}

// ---- 6. solver details: collapsed; the score lives here, not in the headline
function detailsCard(res: OptimizeResult, meta: BuildMeta | undefined, view: number | null, prof: EffectiveProfile): HTMLElement {
  const skipped = meta?.skipped;
  const cnt = (k: string): number => (Array.isArray(skipped?.[k]) ? (skipped![k] as unknown[]).length : +((skipped?.[k] as number) || 0));   // live arrays, or a saved run's counts
  const skips = ([["worn by others", cnt("worn")], ["too heavy", cnt("str")], ["tagged", cnt("tags")], ["gargoyle-only", cnt("gargoyle")], ["not meditation-safe", cnt("nonMed")], ["by the Weapons filter", cnt("weapon")], ["in skipped containers", cnt("roots")]] as Array<[string, number]>)
    .filter(([, c]) => c).map(([l, c]) => `${fmtN(c)} ${l}`).join(", ");
  const solver = res.method === "manual" ? "none: built by hand in Manual" : res.floorsConflict ? "HiGHS (requirements infeasible)" : res.solver === "highs" ? "HiGHS" : res.solver === "fallback" ? "heuristic (exact solver unavailable)" : res.solver === "none" ? "none needed" : res.method === "exact" ? "branch-and-bound" : "heuristic";
  const time = !meta || res.method === "manual" ? "" : meta.reused ? `instant · first run took ${fmtSecs(meta.ms)}` : res.heuristicMs != null && res.mipMs != null ? `${fmtSecs(meta.ms)} (heuristic ${fmtSecs(res.heuristicMs)}, HiGHS ${fmtSecs(res.mipMs)})` : fmtSecs(meta.ms);
  const summary = [solver, meta?.poolSize != null ? `${fmtN(meta.poolSize)} candidates` : "", time, skips ? `left out ${skips}` : ""].filter(Boolean).join(" · ");
  const score = view == null ? res.score : res.alternatives![view]!.score;
  const t = box("button", { class: "b-disclose", type: "button", "aria-expanded": String(detailsOpen), "aria-controls": "b-details", onclick: () => { detailsOpen = !detailsOpen; rerender(); } },
    txt("Solver details", "t-md strong"), txt(summary, "t-sm muted"), icon(detailsOpen ? "chevron-up" : "chevron-down", { size: "sm" }));
  const pairs: Array<[string, string]> = [["Solver", solver]];
  if (verdict(res).text) pairs.unshift(["Verdict", verdict(res).text]);
  if (meta?.poolSize != null) pairs.push(["Candidates", fmtN(meta.poolSize)]);
  if (res.nodes != null) pairs.push(["Search nodes", fmtN(res.nodes)]);
  if (time) pairs.push(["Time", time]);
  if (skips) pairs.push(["Left out", skips]);
  // a strict build's plain score is in Best value's terms, which it did not optimize (it compares goal by goal)
  if (res.method !== "manual") pairs.push([res.strict ? "Score (Best value)" : "Score", `${fmtN(Math.round(res.currentScore))} → ${fmtN(Math.round(score))}`]);
  if (res.strict && res.method !== "manual") pairs.push(["Strategy", strictDetail(res.strict, res.method)]);
  // fewest changes: Best value's tie-break, or strict order's stage after the goals
  const changes = res.strict ? res.strict.changes : res.tieBreak?.fewestChanges ? res.tieBreak.changes : undefined;
  if (changes != null && res.method !== "manual") pairs.push(["Fewest changes", `${plural(changes, "piece")} changed, ${res.strict ? "the fewest that keeps every goal" : "the fewest among equal suits"}${!res.strict && res.tieBreak?.costProven === false ? " found (not proven)" : ""}`]);
  if (res.tieBreak?.rarity && res.method !== "manual") pairs.push(["Rarity", rarityDetail(res.tieBreak, rarityTotal(res.best, res.tieBreak.rarity, state.rules?.rarity?.length ?? 0))]);
  if (res.gapPoints != null) pairs.push(["Gap to the bound", `${fmtN(res.gapPoints)} points`]);
  const short = res.altShortfall === "budget" ? " · the time budget ran out before more were found" : "";
  if (res.altTolerance != null) pairs.push(["Other suits", `${fmtN((res.alternatives || []).length)} ${res.strict ? "equal on every goal" : `within ${fmtN(res.altTolerance)} points`}${short}`]);
  // A run is reused when the solvers' input is the same (runs-lib.mts's runKey): its buffs may differ where they plan alike.
  if (meta?.reused) {
    const other = buffsDiff(savedBuffs(meta.reused.settings), prof.buffs ? runBuffs(prof.buffs.on, prof.buffs.skills) : undefined).length > 0;
    pairs.push(["Reused", `the run from ${fmtRunTime(meta.reused.createdAt)} (same inventory and plan)${other ? ", saved with different buffs that plan the same" : ""}`]);
  }
  return el("section", { class: "card", "aria-label": "Solver details" }, t, detailsOpen ? el("div", { class: "b-details", id: "b-details" }, keyValue(pairs)) : null);
}

// ---------------------------------------------------------------- compare (2-3 suits or saved runs)
interface CompareColumn extends CompareMember { head: HTMLElement; token: string; removeLabel: string; outcome: string[]; action: HTMLElement }
interface CompareSpec { title: string; noun: string; columns: CompareColumn[]; outcomeRows: string[]; settingsRow?: string[] | undefined; keys: string[]; caps: Record<string, number>; onRemove: (i: number) => void }
let diffOnly = true;
let openSpec: (() => CompareSpec) | null = null;
function closeCompare(): void {
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
  const name = session.character || "";
  const back = button({ label: "Back to result", icon: "chevron-left", size: "sm", onClick: () => closeCompare() });
  const crumb = el("a", { href: `#/builder/${encodeURIComponent(name)}` }, `Suit Builder · ${who(name)}`);
  crumb.addEventListener("click", (e) => { e.preventDefault(); closeCompare(); });
  $<HTMLElement>("#b-cmp-topbar")!.replaceChildren(box("nav", { class: "b-crumb", "aria-label": "Breadcrumb" }, crumb, el("span", { class: "faint", "aria-hidden": "true" }, "/"), el("h1", { id: "h-builder-cmp" }, s.title)), el("span", { class: "spacer" }), back);
  $<HTMLElement>("#tab-builder")!.classList.add("comparing");
  $<HTMLElement>("#tab-builder")!.setAttribute("aria-labelledby", "h-builder-cmp");
  $<HTMLElement>("#b-topbar")!.hidden = true;
  $<HTMLElement>("#b-cmp-topbar")!.hidden = false;
  const view = $<HTMLElement>("#b-compare-view")!;
  view.hidden = false;
  const m = compareModel(s.columns, GEAR_SLOTS, s.keys, s.caps, diffOnly);
  const cols = s.columns;
  const tr = (cls: string, ...cells: HTMLElement[]): HTMLTableRowElement => el("tr", cls ? { class: cls } : {}, ...cells);
  const group = (text: string): HTMLTableRowElement => tr("group", el("td", { colspan: cols.length + 1 }, txt(text, "caps")));
  const body: HTMLTableRowElement[] = [];
  if (s.settingsRow) body.push(group("Settings"), tr("", el("td", {}, "Changed from the first"), ...s.settingsRow.map((t) => el("td", { class: "muted" }, t))));
  if (m.pieces.length) body.push(group(diffOnly ? "Pieces that differ" : "Pieces"), ...m.pieces.map((r) => tr("", el("td", {}, r.label), ...r.cells.map((c) => el("td", c.diff ? { class: "diff" } : {}, c.serial ? tipTarget(txt(c.text), { serial: c.serial, name: c.text }) : c.text)))));
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
    const shownIdx = session.altView == null ? 0 : session.altView + 1;
    const columns: CompareColumn[] = idx.map((i) => {
      const s = all[i]!, d = s.score - res.score;
      const sub = i === 0 ? (res.proven ? "the proven best" : "the best found") : Math.abs(d) < 1e-6 ? "ties the best" : `${fmtN(Math.abs(Math.round(d)))} points ${d < 0 ? "below" : "above"}`;
      const head = box("span", { class: "b-cmp-col" }, i === 0 ? box("span", { class: "b-row" }, badge("Best", "best"), res.proven ? badge("Proven optimal", "ok") : null) : txt(`#${i + 1}`, "strong"), txt(sub, "t-sm"));
      const action = i === shownIdx ? txt("Showing in the result", "t-sm muted") : button({ label: "Show this suit", size: "sm", onClick: () => { session.altView = i === 0 ? null : i - 1; closeCompare(); rerender(); } });
      return { assignment: s.best, totals: withBuffs(totalsOf(s.best), prof.resistSkill, paperdollCaps(profileResistCaps(prof), fcCapOf(prof)), withoutBuffs ? null : prof.buffs, resistSkillCapOf(state.inv!.characters[name]?.skills)).totals, head, token: i === 0 ? "Best" : `#${i + 1} · ${Math.abs(d) < 1e-6 ? "ties" : `${d < 0 ? "−" : "+"}${fmtN(Math.abs(Math.round(d)))}`}`,
        removeLabel: i === 0 ? "Remove Best from comparison" : `Remove suit ${i + 1} from comparison`, outcome: [i === 0 ? "—" : Math.abs(d) < 1e-6 ? "0" : `${d < 0 ? "−" : "+"}${fmtN(Math.abs(Math.round(d)))}`], action };
    });
    // Every suit of one result was built with the same caps; an override is named on each column's outcome.
    const resists = profileResistCaps(prof), capped = anyOverridden(resists);
    if (capped) for (const c of columns) c.outcome.push(capsLine(resists));
    return { title: "Compare suits", noun: "suits", columns, outcomeRows: [res.strict ? "Points vs best (Best value)" : "Points vs best", ...(capped ? ["Resist caps"] : [])], keys: compareKeys(columns, prof), caps: paperdollCaps(resists, fcCapOf(prof)),
      onRemove: (i) => { idx = idx.filter((_, j) => j !== i); picked = new Set(idx.map(String)); if (idx.length < 2) { closeCompare(); rerender(); } else showCompare(openSpec!); } };
  });
  void name;
}
// Saved runs from the drawer, oldest first. `open` shows one of them in the result.
function openRunCompare(runs: SavedRunLike[], titleOf: (r: SavedRunLike) => string, open: (id: string) => void, onRemove: (id: string) => void): void {
  let list = [...runs];
  const name = session.character || "";
  const skill = resistSkillOf(state.inv!.characters[name]?.skills), rsCap = resistSkillCapOf(state.inv!.characters[name]?.skills), worn = state.inv!.worn[name] || [];
  showCompare(() => {
    // Each run is judged by the resist caps it was built with (its best values, and a "Resist caps" outcome row
    // when any of them overrode one).
    const views = list.map((r) => resistCapsFor(r.settings.race, r.settings.resistCaps));
    // and by the Faster Casting cap of its casting school, for the character as scanned now
    const runFc = (r: SavedRunLike): number => fcCapFor(state.inv!.characters[name]?.skills, r.settings.castingSchool).cap;
    const capped = views.some(anyOverridden);
    const columns: CompareColumn[] = list.map((r, i) => {
      const floors = r.settings.floors || {};
      // a run saved with twelve slots, with what the character wears in the others: like for like with a run of every slot
      const planned = slotsOf(r.result.best), rest = worn.filter((it) => it.slot && !planned.includes(it.slot));
      const { totals, caps } = withBuffs(totalsOf({ ...r.result.best, ...Object.fromEntries(rest.map((it) => [`_w${it.serial}`, toOptItem(it)])) }), skill, paperdollCaps(views[i]!, runFc(r)), commands.buffPlan(name, r.settings.race, savedBuffs(r.settings)), rsCap);
      const met = Object.keys(floors).filter((k) => (totals[k] || 0) >= effectiveFloor(k, floors[k]!, caps)).length;
      const v = verdict(r.result);
      const head = box("span", { class: "b-cmp-col" }, box("span", { class: "b-row" }, el("span", { class: "strong ellip", title: titleOf(r) }, titleOf(r)), v.text ? badge(v.text, v.tone === "bad" ? "bad" : v.tone) : null), txt(`${fmtRunTime(r.createdAt)} · ${r.result.method === "manual" ? "built by hand" : fmtSecs(r.ms || 0)}`, "t-sm"));
      const action = r.id === session.openRun ? txt("Showing in the result", "t-sm muted") : button({ label: "Open this run", size: "sm", onClick: () => { closeCompare(); open(r.id); } });
      return { assignment: r.result.best, totals, caps, head, token: r.label || fmtRunTime(r.createdAt), removeLabel: `Remove the run from ${fmtRunTime(r.createdAt)} from comparison`,
        outcome: [plural((r.result.perSlotChanges || []).length, "change"), Object.keys(floors).length ? `${met} of ${Object.keys(floors).length}` : "none set", v.text, ...(capped ? [capsLine(views[i]!)] : [])], action };
    });
    const first = list[0]!;
    const settingsRow = list.map((r, i) => (i === 0 ? "—" : runSettingsDiff(first.settings, r.settings).join(" · ") || "same settings"));
    const keys = compareKeys(columns, { floors: Object.assign({}, ...list.map((r) => r.settings.floors || {})), weights: Object.assign({}, ...list.map((r) => r.settings.weights || {})) });
    return { title: "Compare runs", noun: "runs", columns, outcomeRows: ["Changes", "Requirements met", "Verdict", ...(capped ? ["Resist caps"] : [])], settingsRow, keys, caps: paperdollCaps(views[0]!, runFc(list[0]!)),
      onRemove: (i) => { const gone = list[i]!; list = list.filter((_, j) => j !== i); onRemove(gone.id); if (list.length < 2) closeCompare(); else showCompare(openSpec!); } };
  });
}
onChange("view", resetResultView);
provide({ renderResult, setResultGear, resultLoadError, closeCompare, openRunCompare });
