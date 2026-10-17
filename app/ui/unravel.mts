// ui/unravel.mts — the Inventory screen's Unravel view (issue #271, #/unravel): which pieces to unravel at a soul forge, and what
// they would give. A character picker (Unraveled by, the highest Imbuing first), three forecast cards (what every candidate is
// expected to give at that skill, and what is on hand), a line saying what is left out (Change opens a chip per reason), and the
// candidates grouped by ingredient: Relic Fragment, Wait for Imbuing 95, Enchanted Essence, Magical Residue, highest weight
// first. Each row has a checkbox (the Items view's selection model, ui/move-model.mts) and Keep (Unkeep on a kept piece);
// the selection bar keeps or grabs the selected pieces. The candidates are one GET /api/items query with `unravel` (the server works out each piece's weight and why it is left out), the
// ingredients on hand three more; the math is app/unravel.mts. The Keep list is settings.json's unravelKeep (PUT /api/settings).
import type { Item } from "../vault-lib.mts";
import { isBoundedInt, MAX_SERIAL } from "../guards.mts";
import { unravelYield, expectedYield, onHand, LEFT_OUT, INGREDIENTS, type Ingredient, type LeftOut, type UnravelYield } from "../unravel.mts";
import type { ItemQueryRows, UnravelRow } from "../item-query.mts";
import { state } from "./store.mts";
import { $, el, itemTip, toast, whereText } from "./dom.mts";
import { api } from "./api.mts";
import { txt, box, button, message, select, openDialog } from "./components.mts";
import { errorText } from "./messages.mts";
import { plural } from "./inv-model.mts";
import { parseRoute, registerScreen } from "./nav.mts";
import { rarityEl } from "./item-parts.mts";
import { grabAll } from "./bridge.mts";
import { emptySelection, isSelected, isWorn, toggleRows, toggleLoaded, grabItems, wornNote, selectionBody, pickedText, leftText, GRAB_TOO_MANY, WORN_LOCK, type Matches, type Selection } from "./move-model.mts";
import { openPicker, startMove, placeOf, gate } from "./move-to.mts";
import { gatherWeight, gatherButton, GATHER_LOOSE, GATHER_GROUND } from "./unravel-model.mts";
import type { ItemsApiResponse, MovePlanApiResponse, SettingsApiResponse } from "./api-types.mts";

type Group = "relic" | "held" | "essence" | "residue";
let rows: UnravelRow[] | null = null;
let stacks: Item[] = [];   // the ingredient stacks the scans hold
let loadedFor: unknown = null, loadError: string | null = null, loading: Promise<void> | null = null;
let built = false;
let character: string | null = null;   // the picked "Unraveled by"; null until the player picks one
const shownReasons = new Set<LeftOut>();   // reasons the player chose to show instead of leaving out
let chipsOpen = false;
// The Inventory's selection model (ui/move-model.mts, issue #270): a row's checkbox, shift for a range from the last one,
// worn pieces never ticked. `order` is the rows as drawn, group by group, which a range runs over.
let sel: Selection = emptySelection();
let order: UnravelRow[] = [];
const noQuery: Matches = () => false;

const root = (): HTMLElement => $<HTMLElement>("#tab-unravel")!;
const rules = () => state.rules!;
const u = () => state.rules?.unravel;
const keepList = (): number[] => state.settings?.unravelKeep ?? [];

// ---------------------------------------------------------------- data
async function fetchAll(params: string): Promise<Item[]> {
  const out: Item[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await api<ItemsApiResponse>(`/api/items?${params}&limit=500&offset=${offset}`);
    out.push(...(r as ItemQueryRows).rows);
    if (offset + 500 >= r.total) return out;
  }
}
// One fetch at a time; a reload that lands while one runs is fetched once it is done.
function load(): void {
  const inv = state.inv;
  loading = Promise.all([fetchAll("unravel=1&unravelShow=all&sort=unravel"), ...INGREDIENTS.map((i) => fetchAll(`q=${encodeURIComponent(i.toLowerCase())}`))])
    .then(([cands, ...held]) => { rows = cands as UnravelRow[]; stacks = held.flat(); loadError = null; loadedFor = inv; })
    .catch((e: unknown) => { loadError = errorText(e); })
    .finally(() => {
      loading = null;
      render();
      if (!loadError && state.inv !== loadedFor && !root().hidden) load();
    });
}
// A reload (a scan landed, a Forget) or a saved Organize setup (its pins): fetch again while the view shows.
registerScreen({ name: "unravel", show: () => showUnravel() });
document.addEventListener("inventorychange", () => { if (parseRoute().tab === "unravel") showUnravel(); });
document.addEventListener("organizechange", () => { if (built && !root().hidden && !loading) load(); });
// A run saved or removed (here or, through the events stream, in another window) changes which pieces are in a saved
// build: fetch again now if the view shows, else when it is next shown.
document.addEventListener("builderchange", (e) => {
  if ((e as CustomEvent<{ key: string }>).detail?.key !== "runs") return;
  loadedFor = null;
  if (built && !root().hidden && !loading) load();
});
function showUnravel(): void {
  build();
  render();
  if (state.inv && loadedFor !== state.inv && !loading) load();
}

// ---------------------------------------------------------------- who unravels
interface Who { name: string; skill: number }
function characters(): Who[] {
  const list = Object.values(state.inv?.characters ?? {}).map((c) => {
    const s = c.skills?.Imbuing as { value?: number; base?: number } | undefined;
    return { name: c.name, skill: Number(s?.value ?? s?.base ?? 0) || 0 };
  });
  return list.sort((a, b) => b.skill - a.skill || a.name.localeCompare(b.name));
}
const who = (): Who | null => { const list = characters(); return list.find((c) => c.name === character) ?? list[0] ?? null; };
const fmt = (n: number): string => String(Math.round(n * 10) / 10);
const pct = (c: number): string => `${c >= 1 ? 100 : Math.min(99, Math.round(c * 100))}%`;
const amount = (a: { min: number; max: number }): string => (a.min === a.max ? `×${a.min}` : `${a.min}–${a.max}`);

// ---------------------------------------------------------------- what is shown
// Why a row is left out now: the server's reasons, with Keep as this page last saved it.
function reasonsOf(r: UnravelRow): LeftOut[] {
  const kept = keepList().includes(r.serial);
  return LEFT_OUT.filter((x) => (x === "kept" ? kept : r.unravel.leftOut?.includes(x)));
}
const isShown = (r: UnravelRow): boolean => reasonsOf(r).every((x) => shownReasons.has(x));
function groupOf(r: UnravelRow, skill: number): Group {
  if (r.unravel.ingredient === "Relic Fragment") return skill < u()!.relicSkill ? "held" : "relic";
  return r.unravel.ingredient === "Enchanted Essence" ? "essence" : "residue";
}
const ING_CLASS: Record<Ingredient, Group> = { "Relic Fragment": "relic", "Enchanted Essence": "essence", "Magical Residue": "residue" };
// The row's ingredient line and the chance line under it.
function yieldText(y: UnravelYield, skill: number): { cls: Group; ing: string; why: string } {
  const top = (ing: Ingredient): number => (ing === "Relic Fragment" ? u()!.relicRoll[1]! : ing === "Enchanted Essence" ? u()!.essenceRoll[1]! : u()!.residueRoll[1]!);
  if (skill < y.needsSkill) {
    return y.hit.ingredient === "Relic Fragment"
      ? { cls: "held", ing: `Relic Fragment at Imbuing ${fmt(y.needsSkill)}`, why: `Refused until then (now ${fmt(skill)})` }
      : { cls: "held", ing: `Needs Imbuing ${fmt(y.needsSkill)}`, why: `The forge refuses below ${fmt(y.needsSkill)}` };
  }
  const ing = `${y.hit.ingredient} ${amount(y.hit)}`;
  if (y.chance >= 1) return { cls: ING_CLASS[y.hit.ingredient], ing, why: `Always at Imbuing ${fmt(top(y.hit.ingredient))}+` };
  const miss = y.miss ? `else ${y.miss.ingredient === "Magical Residue" ? "Residue" : `Essence ${amount(y.miss)}`}` : "a miss keeps the piece";
  return { cls: ING_CLASS[y.hit.ingredient], ing, why: `${pct(y.chance)} at ${fmt(skill)}, ${miss}` };
}
function maybeTitle(weight: number): string {
  const near = Math.abs(weight - u()!.relicMin) <= u()!.maybeMargin ? "Enchanted Essence and a Relic Fragment" : "Magical Residue and Enchanted Essence";
  return `Close to the line between ${near}: it could go either way`;
}

// ---------------------------------------------------------------- the frame, built once
let picker: HTMLSelectElement;
function build(): void {
  if (built) return;
  built = true;
  picker = select([], "", { attrs: { id: "unr-who", "aria-label": "Unraveled by" } });
  picker.addEventListener("change", () => { character = picker.value; render(); });
  root().replaceChildren(
    box("div", { class: "unr-who" }, box("label", { class: "unr-who-pick", for: "unr-who" }, txt("Unraveled by")), picker,
      txt("Each unravel can also raise Imbuing. The skill comes from the latest scan.", "unr-note")),
    el("div", { class: "unr-forecast", id: "unr-forecast" }),
    el("div", { class: "unr-excl", id: "unr-excl" }),
    el("div", { class: "inv-move-result", id: "unr-move-result", "aria-live": "polite", hidden: true }),
    box("section", { class: "card unr-card", "aria-label": "Unravel candidates" },
      el("div", { class: "unr-selbar", id: "unr-selbar", hidden: true }),
      el("div", { class: "unr-list", id: "unr-list" }),
      box("div", { class: "tbl-foot unr-foot" }, box("span", {}, txt("Sorted by what each piece gives, then by weight. A piece marked "), txt("maybe", "unr-maybe"), txt(" is close to the line between two ingredients and could go either way.")))));
  $<HTMLElement>("#unr-list")!.addEventListener("click", onListClick);
}

// ---------------------------------------------------------------- drawing
function render(): void {
  if (!built) return;
  const list = characters(), me = who();
  picker.replaceChildren(...(list.length ? list.map((c) => el("option", { value: c.name }, `${c.name} · Imbuing ${fmt(c.skill)}`)) : [el("option", { value: "" }, "No scanned characters")]));
  picker.value = me?.name ?? "";
  picker.disabled = !list.length;
  const skill = me?.skill ?? 0;
  const listEl = $<HTMLElement>("#unr-list")!;
  if (!u()) { listEl.replaceChildren(stateBox(txt("This shard's rules have no unravel thresholds, so there is nothing to suggest.", "muted"))); drawForecast([], skill); drawExcluded(); drawSelbar([], skill); return; }
  if (!rows) {
    listEl.replaceChildren(stateBox(loadError ? message({ tone: "bad", text: `Could not load the unravel candidates: ${loadError}` }) : txt("Loading unravel candidates…", "muted")));
    return;
  }
  const shown = rows.filter(isShown);
  const showing = new Set(shown.map((r) => r.serial));
  sel = { ...sel, items: new Map([...sel.items].filter(([s]) => showing.has(s))) };
  drawForecast(shown, skill);
  drawExcluded();
  drawGroups(shown, skill);
  drawSelbar(shown, skill);
}
const stateBox = (kid: HTMLElement): HTMLElement => box("div", { class: "unr-state" }, kid);
// A button that reads as a link: Change, Done, Select these.
const linkButton = (label: string, attrs: Record<string, string>): HTMLButtonElement => box("button", { type: "button", class: "unr-link", ...attrs }, txt(label));

function drawForecast(shown: UnravelRow[], skill: number): void {
  const f = $<HTMLElement>("#unr-forecast")!;
  if (!u()) { f.replaceChildren(); return; }
  const sum = (s: number): Record<Ingredient, number> => {
    const out: Record<Ingredient, number> = { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 0 };
    for (const r of shown) { const e = expectedYield(r.unravel.weight, s, rules()); for (const i of INGREDIENTS) out[i] += e[i]; }
    return out;
  };
  const now = sum(skill), have = onHand(stacks), n = (i: Ingredient): number => shown.filter((r) => r.unravel.ingredient === i).length;
  const about = (x: number): string => `≈ ${Math.round(x).toLocaleString("en-US")}`;
  const onHandText = (i: Ingredient): string => `On hand: ${have[i].toLocaleString("en-US")}.`;
  const gate = u()!.relicSkill, relics = n("Relic Fragment");
  const relicNote = skill < gate
    ? `${plural(relics, "piece")} held for Imbuing ${fmt(gate)}. At ${fmt(gate)} about ${Math.round(sum(gate)["Relic Fragment"])}, at ${fmt(Math.max(gate, 100))} about ${Math.round(sum(Math.max(gate, 100))["Relic Fragment"])}. ${onHandText("Relic Fragment")}`
    : `From ${plural(relics, "piece")}. ${onHandText("Relic Fragment")}`;
  const card = (cls: Group, title: string, value: string, note: string): HTMLElement =>
    box("div", { class: `unr-fc ${cls}` }, box("span", { class: "unr-fc-k" }, el("span", { class: "unr-dot", "aria-hidden": "true" }), txt(title)), txt(value, "unr-fc-v"), txt(note, "unr-fc-s"));
  // Below the Essence gate every Essence piece is refused: they are held, and give no misses.
  const essGate = u()!.essenceSkill, essHeld = skill < essGate;
  const essNote = essHeld ? `${plural(n("Enchanted Essence"), "piece")} held for Imbuing ${fmt(essGate)}.` : `From ${plural(n("Enchanted Essence"), "piece")}${skill >= gate && relics ? " and Relic misses" : ""}.`;
  f.replaceChildren(
    card("relic", "Relic Fragment", skill < gate ? "0 now" : about(now["Relic Fragment"]), relicNote),
    card("essence", "Enchanted Essence", essHeld ? "0 now" : about(now["Enchanted Essence"]), `${essNote} ${onHandText("Enchanted Essence")}`),
    card("residue", "Magical Residue", about(now["Magical Residue"]), `From ${plural(n("Magical Residue"), "piece")}${essHeld ? "" : " and Essence misses"}. ${onHandText("Magical Residue")}`));
}

const REASON_CHIP: Record<LeftOut, string> = { worn: "Worn", build: "In a saved build", insured: "Insured", pinned: "Organize pins", imbued: "Imbued", blessed: "Blessed", kept: "Kept" };
const REASON_WORD: Record<LeftOut, string> = { worn: "worn", build: "in a saved build", insured: "insured", pinned: "pinned", imbued: "imbued", blessed: "blessed", kept: "kept" };
const orList = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
function drawExcluded(): void {
  const x = $<HTMLElement>("#unr-excl")!;
  if (!rows) { x.replaceChildren(); return; }
  const hidden = LEFT_OUT.filter((r) => !shownReasons.has(r));
  const out = rows.filter((r) => !isShown(r)).length;
  const line = out ? `${plural(out, "piece")} left out: ${orList(hidden.map((r) => REASON_WORD[r]))}.` : hidden.length ? "Nothing is left out." : "Nothing is left out: every reason is shown.";
  const toggle = linkButton(chipsOpen ? "Done" : "Change", { id: "unr-change", "aria-expanded": String(chipsOpen) });
  toggle.addEventListener("click", () => { chipsOpen = !chipsOpen; drawExcluded(); $<HTMLElement>("#unr-change")?.focus(); });
  const chips = chipsOpen ? LEFT_OUT.map((r) => {
    const n = rows!.filter((row) => reasonsOf(row).includes(r)).length, left = !shownReasons.has(r);
    const b = box("button", { type: "button", class: "pill unr-chip", "aria-pressed": String(left), "data-reason": r, title: left ? "Left out. Click to show these too." : "Shown. Click to leave them out." }, txt(REASON_CHIP[r]), txt(n.toLocaleString("en-US"), "unr-chip-n"));
    b.addEventListener("click", () => { if (left) shownReasons.add(r); else shownReasons.delete(r); render(); $<HTMLElement>(`#unr-excl [data-reason="${r}"]`)?.focus(); });
    return b;
  }) : [];
  x.replaceChildren(txt(line, "muted"), toggle, ...chips);
}

const GROUP_ORDER: Group[] = ["relic", "held", "essence", "residue"];
function groupHead(g: Group, count: number): { title: string; note: string } {
  const gate = fmt(u()!.relicSkill);
  if (g === "relic") return { title: "Relic Fragment", note: `${plural(count, "piece")}. A miss still gives Essence.` };
  if (g === "held") return { title: `Wait for Imbuing ${gate}`, note: `${plural(count, "Relic-tier piece")}. Below ${gate} the forge refuses them, so keep them for now.` };
  return { title: g === "essence" ? "Enchanted Essence" : "Magical Residue", note: `${plural(count, "piece")}.` };
}
function drawGroups(shown: UnravelRow[], skill: number): void {
  const listEl = $<HTMLElement>("#unr-list")!;
  if (!shown.length) {
    listEl.replaceChildren(stateBox(txt(rows!.length ? "Every piece that could be unraveled is left out. Change what is left out above to see them." : "No piece in your scans has magic to unravel.", "muted")));
    return;
  }
  const by = new Map<Group, UnravelRow[]>(GROUP_ORDER.map((g) => [g, []]));
  for (const r of shown) by.get(groupOf(r, skill))!.push(r);
  // A redrawn list can put other rows at the anchor's index: a shift-click starts afresh.
  order = GROUP_ORDER.flatMap((g) => by.get(g)!);
  sel = { ...sel, anchor: null };
  const out: HTMLElement[] = [];
  let index = 0;
  for (const g of GROUP_ORDER) {
    const list = by.get(g)!;
    if (!list.length) continue;
    const h = groupHead(g, list.length);
    out.push(box("div", { class: `unr-group ${g}`, role: "group", "aria-label": h.title },
      box("div", { class: "unr-group-head" },
        el("h3", {}, el("span", { class: "unr-dot", "aria-hidden": "true" }), h.title),
        txt(h.note, "unr-gs"),
        linkButton("Select these", { "data-select": g })),
      ...list.map((r) => rowEl(r, skill, index++))));
  }
  listEl.replaceChildren(...out);
}
function rowEl(r: UnravelRow, skill: number, index: number): HTMLElement {
  const y = unravelYield(r.unravel.weight, skill, rules())!;
  const t = yieldText(y, skill), on = isSelected(sel, r, noQuery), reasons = reasonsOf(r), kept = reasons.includes("kept");
  const cb = el("input", { type: "checkbox", class: "unr-cb", "aria-label": `Select ${r.name}`, "data-serial": String(r.serial), ...(isWorn(r) ? { disabled: "", title: WORN_LOCK } : {}) });
  cb.checked = on;
  const name = itemTip(txt(r.name, "unr-name"), r, { focus: false });
  return box("div", { class: `unr-row${on ? " sel" : ""}`, "data-serial": String(r.serial), "data-index": String(index) },
    cb,
    box("span", { class: "unr-nm" }, name, box("span", { class: "unr-sub" }, rarityEl(r.rarity), ...reasons.map((x) => txt(REASON_CHIP[x], "unr-tag")))),
    txt(whereText(r.location?.text) || "Unknown place", "unr-where"),
    box("span", { class: "unr-yield" },
      box("span", { class: "unr-ing-line" }, txt(t.ing, `unr-ing ${t.cls}`), r.unravel.maybe ? el("span", { class: "unr-maybe", title: maybeTitle(r.unravel.weight) }, "maybe") : null),
      txt(t.why, "unr-why")),
    button({ label: kept ? "Unkeep" : "Keep", size: "sm", variant: "ghost", cls: "unr-keep", attrs: { "data-keep": String(r.serial), title: kept ? "Suggest this piece again" : "Never suggest this piece again" } }));
}
function drawSelbar(shown: UnravelRow[], skill: number): void {
  const bar = $<HTMLElement>("#unr-selbar")!;
  const picked = shown.filter((r) => isSelected(sel, r, noQuery)), grab = grabItems(sel);
  bar.hidden = !picked.length;
  if (!picked.length) { bar.replaceChildren(); return; }
  const count = (g: Group): number => picked.filter((r) => groupOf(r, skill) === g).length;
  const words: Record<Group, string> = { relic: "Relic-tier", held: `held for ${fmt(u()!.relicSkill)}`, essence: "Essence", residue: "Residue" };
  const summary = GROUP_ORDER.filter((g) => count(g)).map((g) => `${count(g)} ${words[g]}`).join(" · ");
  const me = who()?.name ?? null;
  bar.replaceChildren(
    txt(`${picked.length.toLocaleString("en-US")} selected`, "unr-sel-n"), txt(summary, "unr-sel-sum"),
    box("span", { class: "unr-sel-acts" },
      button({ label: "Keep", size: "sm", attrs: { id: "unr-keep-sel" }, onClick: () => { void setKept(picked.map((r) => r.serial), true); } }),
      button({ label: "Grab", icon: "grab", size: "sm", disabled: !me || !grab, attrs: { id: "unr-grab-sel", ...(grab ? {} : { title: GRAB_TOO_MANY }) }, onClick: () => { if (me && grab) void grabAll(grab, me); } }),
      button({ label: "Gather into a bag…", variant: "primary", size: "sm", attrs: { id: "unr-gather" }, onClick: () => { void openGather(picked); } }),
      button({ label: "Clear", size: "sm", variant: "ghost", onClick: () => { sel = emptySelection(); render(); } })));
}

// ---------------------------------------------------------------- selection and Keep
function onListClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const keep = t.closest<HTMLElement>("[data-keep]");
  if (keep) { const s = +keep.dataset.keep!; void setKept([s], !keepList().includes(s)); return; }
  const grp = t.closest<HTMLElement>("[data-select]");
  if (grp) {
    const skill = who()?.skill ?? 0;
    const r = toggleLoaded(sel, order.filter((x) => groupOf(x, skill) === grp.dataset.select), true, noQuery);
    sel = r.sel;
    const worn = wornNote(r.worn);
    if (worn) toast(worn);
    render();
    return;
  }
  // A row toggled (shift: every row from the last one to it): those rows and the selection bar, not the whole list.
  const row = t.closest<HTMLElement>(".unr-row");
  if (!row || t.closest("button")) return;
  const index = +row.dataset.index!, it = order[index];
  if (!it || isWorn(it)) { if (t.closest(".unr-cb")) e.preventDefault(); return; }
  const shift = e.shiftKey && sel.anchor != null, next = toggleRows(sel, order, index, !isSelected(sel, it, noQuery), shift, noQuery);
  sel = next.sel;
  const worn = wornNote(next.worn);
  if (worn) toast(worn);
  for (const el of $<HTMLElement>("#unr-list")!.querySelectorAll<HTMLElement>(".unr-row")) {
    const r = order[+el.dataset.index!], on = !!r && isSelected(sel, r, noQuery);
    el.classList.toggle("sel", on);
    el.querySelector<HTMLInputElement>(".unr-cb")!.checked = on;
  }
  drawSelbar(rows!.filter(isShown), who()?.skill ?? 0);
}
// Keep or Unkeep: the whole list goes to settings.json, and the rows follow.
async function setKept(serials: number[], keep: boolean): Promise<void> {
  const now = new Set(keepList());
  for (const s of serials) if (keep) now.add(s); else now.delete(s);
  try {
    state.settings = (await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { unravelKeep: [...now] } })).settings;
  } catch (e) { toast(`Could not save the Keep list: ${errorText(e)}`, "bad"); return; }
  const gone = new Set(serials);
  sel = { ...sel, items: new Map([...sel.items].filter(([s]) => !gone.has(s))) };
  render();
}

// ---------------------------------------------------------------- Gather into a bag
// The selected pieces moved loose into one bag through Move to (ui/move-to.mts): the bag this character gathered into last
// time (settings.json's unravelBag), or another container from Move to's picker, which is then remembered.
async function openGather(picked: UnravelRow[]): Promise<void> {
  const me = who()?.name ?? null, selection = selectionBody(sel), bag = me ? bags()[me] ?? null : null;
  const plan = (to?: number): Promise<MovePlanApiResponse> => api<MovePlanApiResponse>("/api/move/plan", { method: "POST", body: { selection, ...(to ? { to } : {}) } });
  let counted: MovePlanApiResponse, mine: MovePlanApiResponse | null;
  try { [counted, mine] = await Promise.all([plan(), bag ? plan(bag) : Promise.resolve(null)]); }
  catch (e) { toast(errorText(e), "bad"); return; }
  const c = bag ? state.inv?.containers[bag] : undefined, bagName = bag ? placeOf(bag) : "";
  const fill = c?.capacity ? { items: c.capacity.items, max: c.capacity.maxItems } : { items: 0, max: 0 };
  const sum = mine?.plan && !mine.problem ? pickedText(bagName, mine.plan, fill) : null;
  const usable = !!(mine?.plan && !mine.problem && mine.plan.moving);
  const radio = (value: string, on: boolean, disabled = false): HTMLInputElement => {
    const r = el("input", { type: "radio", name: "unr-bag", value, ...(disabled ? { disabled: "" } : {}) });
    r.checked = on;
    return r;
  };
  const opts: HTMLElement[] = [];
  if (bag) {
    const why = mine?.problem ? `${bagName}: ${mine.problem}.` : sum?.text ?? "";
    opts.push(box("label", { class: "unr-opt" }, radio("bag", usable, !usable), box("span", { class: "unr-opt-t" }, txt(bagName)), txt(`${why} Pack Rat remembers this bag for ${me}.`, "unr-opt-d")));
  }
  opts.push(box("label", { class: "unr-opt" }, radio("other", !usable), box("span", { class: "unr-opt-t" }, txt("Another container…")),
    txt(`Opens the Move to picker.${me ? ` Pack Rat remembers the one you pick for ${me}.` : ""}`, "unr-opt-d")));
  const left = leftText(mine?.plan ? mine.plan.left : counted.left, counted.worn);
  const tripWhy = gate();
  const go = button({ label: "", variant: "primary", attrs: { id: "unr-gather-go" } });
  const paintGo = (): void => {
    const other = d.dialog.querySelector<HTMLInputElement>('input[name="unr-bag"]:checked')?.value !== "bag";
    go.textContent = other ? "Pick a container…" : gatherButton(mine!.plan!);
    go.disabled = !other && !!tripWhy;
  };
  const d = openDialog({ title: `Gather ${plural(picked.length, "piece")} into a bag`, width: "md", cls: "unr-gather",
    body: [box("div", { class: "unr-gather-body" }, ...opts,
      box("div", { class: "unr-callout" }, txt(`${GATHER_LOOSE} ${gatherWeight(picked)}`), txt(GATHER_GROUND), left ? txt(left) : null, tripWhy ? txt(tripWhy, "mv-short") : null))],
    actions: [button({ label: "Cancel", attrs: { id: "unr-gather-cancel" }, onClick: () => d.close() }), go] });
  for (const r of d.dialog.querySelectorAll<HTMLInputElement>('input[name="unr-bag"]')) r.addEventListener("change", paintGo);
  paintGo();
  const from = { selection, host: "unr-move-result", gather: true, onRun: (to: number) => { sel = emptySelection(); render(); if (me) void rememberBag(me, to); } };
  go.addEventListener("click", () => {
    if (go.disabled) return;
    const other = d.dialog.querySelector<HTMLInputElement>('input[name="unr-bag"]:checked')?.value !== "bag";
    d.close();
    if (other) void openPicker(from);
    else startMove(from, bag!, mine!.plan!);
  });
}
// The remembered bags, less any entry a hand edit left that is not a serial: a bad one would fail its plan, and the whole map
// written back would be refused.
function bags(): Record<string, number> {
  return Object.fromEntries(Object.entries(state.settings?.unravelBag ?? {}).filter(([k, s]) => k && isBoundedInt(s, 1, MAX_SERIAL)));
}
// The bag a character gathers into, remembered in settings.json (written whole, like the Keep list).
async function rememberBag(me: string, to: number): Promise<void> {
  try { state.settings = (await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { unravelBag: { ...bags(), [me]: to } } })).settings; }
  catch (e) { toast(`Could not remember the bag: ${errorText(e)}`, "bad"); }
}
