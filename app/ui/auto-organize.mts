// ui/auto-organize.mts — Auto organize (issue #11, spec §5): a wide drawer opened from the Organize screen. The
// player picks a strategy, ticks the ground chests it may use and reads the proposal (the groups, the chests each
// gets, what does not fit, how much will move); Accept saves the proposal's setup whole through
// ui/organize-data.mts's saveConfig, whose organizechange event redraws the screen and works the plan out. The
// server works the proposal out (POST /api/organize/propose); every sentence comes from ui/organize-model.mts.
import { state } from "./store.mts";
import { $, el, toast, compactChildren } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, badge, message, segmented, check, table, tipWrap, createDrawer, type DrawerHandle } from "./components.mts";
import { errorText } from "./messages.mts";
import { plural } from "./inv-model.mts";
import { saveConfig } from "./organize-data.mts";
import { STRATEGY_TEXT, candidateGroups, candidateNote, proposalHeadline, groupStatus, groupAway, intoText, proposalNotes, canTrySimple, acceptGate, debounced, MATCH_DEBOUNCE_MS } from "./organize-model.mts";
import type { AutoStrategy, OrganizeProposal, OrganizeProposeApiResponse } from "./api-types.mts";

// The drawer's state: the strategy, the ticked chests (null until the first proposal says which it ticks by
// default), the last proposal and the setup it was worked out from (Accept works it out again when the setup has
// changed since), and `seq`, so an answer a newer request (or a tick) overtook is dropped.
interface Draft { strategy: AutoStrategy; containers: number[] | null; proposal: OrganizeProposal | null; base: string; busy: boolean; error: string | null; notice: string | null; seq: number }
let draft: Draft | null = null;
let handle: DrawerHandle | null = null;
function drawer(): DrawerHandle {
  handle ??= createDrawer({ id: "auto-drawer", title: "Auto organize", wide: true, footer: [
    el("span", { class: "spacer" }),
    button({ label: "Cancel", attrs: { "data-drawer-close": "" } }),
    box("span", { id: "auto-accept-slot" }),
  ] });
  return handle;
}
const part = (id: string): HTMLElement => $<HTMLElement>(`#${id}`, drawer().root)!;

export async function openAutoOrganize(opener: HTMLElement | null = null): Promise<void> {
  const strategy = draft?.strategy ?? "simple";
  draft = { strategy, containers: null, proposal: null, base: "", busy: true, error: null, notice: null, seq: 0 };
  const seg = segmented({ label: "Strategy", value: strategy, options: (["simple", "detailed"] as const).map((v) => ({ value: v, label: STRATEGY_TEXT[v].label })), onChange: (v) => { setStrategy(v as AutoStrategy); } });
  drawer().body.replaceChildren(
    box("section", { class: "auto-section", id: "auto-strategy" }, el("h3", { class: "t-md" }, "1. Strategy"), seg, txt(STRATEGY_TEXT[strategy].text, "t-sm muted auto-strategy-text")),
    box("section", { class: "auto-section", id: "auto-containers" }),
    box("section", { class: "auto-section", id: "auto-proposal", "aria-live": "polite" }));
  paint();
  drawer().open(opener);
  await propose();
}

function setStrategy(v: AutoStrategy): void {
  const d = draft;
  if (!d || d.strategy === v) return;
  d.strategy = v;
  $<HTMLElement>(".auto-strategy-text", drawer().root)!.textContent = STRATEGY_TEXT[v].text;
  ($<HTMLElement>("#auto-strategy [role=radiogroup]", drawer().root) as (HTMLElement & { setValue?: (s: string) => void }) | null)?.setValue?.(v);
  void propose();
}
function toggle(serial: number, on: boolean): void {
  const d = draft;
  if (!d) return;
  const set = new Set(d.containers ?? []);
  if (on) set.add(serial); else set.delete(serial);
  d.containers = [...set].sort((a, b) => a - b);
  d.seq++;   // an answer still on its way is for the old ticks
  d.busy = true;
  paintProposal();
  paintAccept();
  proposeSoon();
}
async function propose(): Promise<void> {
  const d = draft;
  if (!d) return;
  const seq = ++d.seq;
  d.busy = true;
  paintProposal();
  paintAccept();
  let r: OrganizeProposeApiResponse | null = null, err: string | null = null;
  try { r = await api<OrganizeProposeApiResponse>("/api/organize/propose", { method: "POST", body: { strategy: d.strategy, ...(d.containers ? { containers: d.containers } : {}) } }); }
  catch (e) { err = errorText(e); }
  if (draft !== d || seq !== d.seq) return;
  d.busy = false;
  d.error = err;
  d.proposal = r ? r.proposal : null;
  if (r) { d.containers = r.proposal.containers; d.base = JSON.stringify(state.organize.config); }
  paint();
}
const proposeSoon = debounced(() => { void propose(); }, MATCH_DEBOUNCE_MS);

function paint(): void { paintContainers(); paintProposal(); paintAccept(); }
// The chests, by house, each a checkbox with its fill; the ones the player's setup uses say why they start
// unticked; the unusable ones in a closed list with the reason. Focus stays on the checkbox the player was on.
function paintContainers(): void {
  const d = draft!, host = part("auto-containers"), p = d.proposal;
  const head = [el("h3", { class: "t-md" }, "2. Containers it may use"), txt("Ticked containers are labelled for their group. Items are only ever taken from, and put into, labelled containers.", "t-sm muted")];
  if (!p) { if (!host.childElementCount) host.replaceChildren(...head); return; }
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.serial;
  const chosen = new Set(d.containers ?? []);
  const sites = candidateGroups(p.candidates).map((g) => box("div", { class: "auto-site" },
    g.title ? el("h4", { class: "t-sm strong" }, g.title) : null,
    box("ul", { class: "auto-cands" }, ...g.rows.map((c) => {
      const note = candidateNote(c);
      const cb = check({ label: `${c.name} · ${c.fill.items}/${c.fill.max}`, checked: chosen.has(c.serial), attrs: { "data-serial": String(c.serial) }, onChange: (on) => { toggle(c.serial, on); } });
      return box("li", { class: "auto-cand" }, cb.root, note ? txt(note, "t-sm muted") : null);
    }))));
  const out = p.unusable.length
    ? el("details", { class: "auto-unusable" }, el("summary", {}, txt(`${plural(p.unusable.length, "container")} can't be used`, "t-sm")),
      box("ul", { class: "auto-unusable-list" }, ...p.unusable.map((u) => box("li", {}, txt(`${u.name}: ${u.reason}`, "t-sm muted")))))
    : null;
  host.replaceChildren(...head, ...(p.candidates.length ? sites : [txt("No container on the ground can be used yet. Scan your house in game first.", "muted")]), ...compactChildren([out]));
  if (focused) host.querySelector<HTMLElement>(`input[data-serial="${CSS.escape(focused)}"]`)?.focus();
}
function paintProposal(): void {
  const d = draft!, host = part("auto-proposal"), p = d.proposal;
  host.setAttribute("aria-busy", String(d.busy));
  const kids: Array<HTMLElement | null> = [el("h3", { class: "t-md" }, "3. Proposal")];
  if (d.notice) kids.push(message({ tone: "info", text: d.notice }));
  if (d.error) kids.push(message({ tone: "bad", title: "Could not work out a proposal", text: d.error }));
  if (!p) kids.push(txt(d.busy ? "Working out the proposal…" : "", "muted"));
  else {
    kids.push(box("p", { class: "strong", id: "auto-headline" }, txt(proposalHeadline(p))), d.busy ? txt("Working it out again…", "t-sm muted") : null);
    for (const text of proposalNotes(p)) kids.push(message({ tone: "info", text }));
    if (canTrySimple(p)) kids.push(message({ tone: "warn", text: `${plural(p.unassigned, "group")} got no container. Simple needs fewer.`, actions: [button({ label: "Try Simple instead", size: "sm", attrs: { id: "auto-try-simple" }, onClick: () => { setStrategy("simple"); } })] }));
    if (p.groups.length) {
      kids.push(table({ label: "Proposed groups", columns: [{ label: "Group", width: "22%" }, { label: "Into", width: "28%" }, { label: "Items", width: "18%" }, { label: "Status", width: "32%" }], rows: p.groups.map((g) => {
        const s = groupStatus(g), away = groupAway(g);
        return { attrs: { "data-group": g.key }, cells: [g.name, intoText(g, p.candidates),
          away ? box("span", { class: "auto-stack" }, txt(plural(g.needSlots, "item")), txt(away, "t-sm muted")) : plural(g.needSlots, "item"),
          box("span", { class: "auto-status" }, badge(s.badge, s.tone), s.text ? txt(s.text, "t-sm muted") : null)] };
      }) }));
    }
  }
  host.replaceChildren(...compactChildren(kids));
}
function paintAccept(): void {
  const d = draft!, why = acceptGate(d.proposal, d.busy);
  const b = button({ label: "Accept", variant: "primary", attrs: { id: "auto-accept" }, onClick: () => { void accept(); } });
  b.disabled = !!why;
  part("auto-accept-slot").replaceChildren(why ? tipWrap(b, why) : b);
}
// Saves the proposal's setup whole, unless the setup changed since it was worked out (another window, a save that
// landed late): then it is worked out again for the player to look at first.
async function accept(): Promise<void> {
  const d = draft, p = d?.proposal;
  if (!d || !p || acceptGate(p, d.busy)) return;
  if (JSON.stringify(state.organize.config) !== d.base) {
    d.notice = "Your setup changed since this proposal was worked out, so here it is again. Check it, then press Accept.";
    await propose();
    return;
  }
  d.busy = true;
  paintAccept();
  const err = await saveConfig(p.config);
  d.busy = false;
  if (err) { d.error = err; paint(); return; }
  drawer().close();
  toast(`Auto organize saved ${plural(p.groups.reduce((k, g) => k + g.ruleIds.length, 0), "rule")} for ${plural(p.containers.length, "container")}. Check the plan, then run the trips.`, "good");
}
