// ui/scrolls.mts — the Inventory screen's Scrolls view (issue #181, #/scrolls and #/scrolls/sot): power scrolls and
// Scrolls of Transcendence per skill, against the shard's Scroll Binder recipes (the rules' scrollBinder; the math is
// ui/scrolls-model.mts). A filter box for skill names, Power scrolls | Scrolls of Transcendence with their counts, a
// line of facts, one table per tab, and a side detail (the item peek's look) listing a skill's scrolls by place, with
// Show in Inventory. Count cells and Show in Inventory open the Items view searching for exactly those scrolls. The
// scrolls come from GET /api/items (three filtered queries: power scrolls by their level property, Scrolls of
// Transcendence by their points, Scroll Binders by name), fetched again when the inventory reloads.
import type { Item } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, itemTip, whereText } from "./dom.mts";
import { api } from "./api.mts";
import { txt, box, icon, button, badge, kbd, keyValue, message, meter, searchInput, segmented, tableFoot } from "./components.mts";
import { errorText } from "./messages.mts";
import { plural, splitSerial } from "./inv-model.mts";
import { showSearch } from "./inventory.mts";
import { tagEls } from "./item-parts.mts";
import {
  powerRows, powerLevels, sotRows, emptyBinderCount, scrollFacts, filterRows, powerQuery, sotQuery, placeGroups, planText, runText, fmtTenths, toTenths, whoText, listName,
  type PowerRow, type SotRow,
} from "./scrolls-model.mts";
import type { ItemsApiResponse } from "./api-types.mts";
import type { ItemQueryRows } from "../item-query.mts";

type Tab = "power" | "sot";
type Row = PowerRow | SotRow;
let tab: Tab = "power";
let filter = "";
let selected: string | null = null;   // the skill whose detail is open
let data: { power: Item[]; sot: Item[]; binders: Item[] } | null = null;
let loadedFor: unknown = null;   // the state.inv the data was fetched for: a reload makes a new one
let loadError: string | null = null;
let loading: Promise<void> | null = null;
let built = false;

const root = (): HTMLElement => $<HTMLElement>("#tab-scrolls")!;
const binderRules = () => state.rules?.scrollBinder;
const steps = () => binderRules()?.powerScrolls ?? [];
const usableAt = (): number[] | null => binderRules()?.transcendence?.usableAt ?? null;

// ---------------------------------------------------------------- data
async function fetchAll(params: string): Promise<Item[]> {
  const rows: Item[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await api<ItemsApiResponse>(`/api/items?${params}&limit=500&offset=${offset}`);
    rows.push(...(r as ItemQueryRows).rows);
    if (offset + 500 >= r.total) return rows;
  }
}
// One fetch at a time; a reload that lands while one runs is fetched once it is done.
function load(): void {
  const inv = state.inv;
  loading = Promise.all([fetchAll("prop=psLevel:1"), fetchAll("prop=sotPoints:0.1"), fetchAll("q=scroll%20binder")])
    .then(([power, sot, binders]) => { data = { power, sot, binders }; loadError = null; loadedFor = inv; })
    .catch((e: unknown) => { loadError = errorText(e); })
    .finally(() => {
      loading = null;
      render();
      if (!loadError && state.inv !== loadedFor && !root().hidden) load();
    });
}

// ---------------------------------------------------------------- entry points (app.mts)
// The route picked the view and a tab, or the inventory reloaded (a scan landed, a Forget): draw what is loaded and
// fetch what is stale.
export function showScrolls(next: Tab): void {
  build();
  if (next !== tab) { tab = next; selected = null; }
  render();
  if (state.inv && loadedFor !== state.inv && !loading) load();
}
// The Organize labels changed: the places read differently.
export function scrollsChanged(): void {
  if (built && !root().hidden) render();
}

// ---------------------------------------------------------------- the frame, built once
let tabs: HTMLDivElement & { setValue: (v: string) => void };
let search: HTMLInputElement;
function build(): void {
  if (built) return;
  built = true;
  const s = searchInput({ label: "Filter skills", placeholder: "Filter skills", hint: "/", attrs: { id: "scr-q" } });
  s.root.classList.add("scr-search");
  search = s.input;
  search.addEventListener("input", () => { filter = search.value; render(); });
  tabs = segmented({ label: "Scroll type", size: "md", value: tab, options: [{ value: "power", label: "Power scrolls" }, { value: "sot", label: "Scrolls of Transcendence" }], onChange: (v) => { location.hash = v === "sot" ? "#/scrolls/sot" : "#/scrolls"; } });
  tabs.id = "scr-tabs";
  for (const b of tabs.querySelectorAll("button")) b.append(txt("", "seg-count"));
  root().replaceChildren(
    box("div", { class: "inv-toolbar", role: "toolbar", "aria-label": "Scrolls" }, s.root, tabs),
    box("div", { class: "scr-facts", id: "scr-facts", role: "status" }),
    el("div", { id: "scr-stale", hidden: true }),
    el("div", { id: "scr-warn", hidden: true }),
    box("div", { class: "inv-body" },
      box("section", { class: "card inv-card", "aria-label": "Scrolls" },
        box("div", { class: "inv-scroll" }, el("table", { class: "tbl inv-tbl scr-tbl", id: "scr-table" }, el("colgroup"), el("thead"), el("tbody"))),
        el("div", { class: "tbl-foot", id: "scr-foot" })),
      el("aside", { class: "card peek scr-peek", id: "scr-peek", "aria-label": "Scroll detail", hidden: true })));
  wireKeys();
}

// ---------------------------------------------------------------- drawing
function rowsOf(t: Tab): Row[] {
  if (!data) return [];
  return t === "power" ? powerRows(data.power, steps()) : sotRows(data.sot, usableAt());
}
function render(): void {
  if (!built) return;
  tabs.setValue(tab);
  const power = rowsOf("power") as PowerRow[], sot = rowsOf("sot") as SotRow[];
  const [pc, sc] = [...tabs.querySelectorAll<HTMLElement>(".seg-count")];
  pc!.textContent = data ? power.reduce((a, r) => a + r.total, 0).toLocaleString("en-US") : "";
  sc!.textContent = data ? sot.reduce((a, r) => a + r.tenths.length, 0).toLocaleString("en-US") : "";
  // A live region: redrawn only when its words change, so typing in the filter does not announce it again.
  const facts = $<HTMLElement>("#scr-facts")!;
  const factList = data && (data.power.length || data.sot.length) ? scrollFacts({ power, sot, binders: emptyBinderCount(data.binders), binder: !!binderRules() }) : [];
  if (facts.dataset.text !== factList.join(" · ")) { facts.dataset.text = factList.join(" · "); facts.replaceChildren(...dotted(factList)); }
  // A failed refetch over scrolls already shown: say they may be out of date.
  const stale = $<HTMLElement>("#scr-stale")!;
  const staleText = data && loadError ? `Could not refresh the scrolls, so these are from an earlier load: ${loadError}` : "";
  stale.hidden = !staleText;
  if (stale.dataset.text !== staleText) { stale.dataset.text = staleText; stale.replaceChildren(...(staleText ? [message({ tone: "bad", text: staleText })] : [])); }
  const warn = $<HTMLElement>("#scr-warn")!;
  const at = usableAt();
  warn.hidden = !(tab === "sot" && at && at.length > 1 && sot.length);
  if (!warn.hidden) warn.replaceChildren(transcendenceWarning(at!));
  const all = tab === "power" ? power : sot;
  const shown = filterRows<Row>(all, filter);
  if (selected && !shown.some((r) => r.skill === selected)) selected = null;
  drawTable(all, shown);
  drawDetail(shown);
}
// Facts side by side with a faint "·" between them (the facts line, the footer's right-hand side).
const dotted = (parts: string[]): HTMLSpanElement[] => parts.flatMap((t, i) => (i ? [txt("·", "faint"), txt(t)] : [txt(t)]));
function transcendenceWarning(at: number[]): HTMLElement {
  const [first, ...rest] = at.map((p) => fmtTenths(toTenths(p)));
  const last = rest[rest.length - 1]!;
  return message({ tone: "warn", attrs: { role: "note", class: "msg warn scr-warn" }, text: box("span", {},
    txt(`Going past ${first} locks the binder until ${rest[0]}. `, "strong"),
    txt(`A binder turns into a usable scroll at exactly ${first} points; add more and it stays a binder until it reaches ${rest.join(", then ")}, and points above ${last} are lost. The plans below bind to exactly ${[first, ...rest].join(" or ")} when your scrolls can, and otherwise go past ${last} by as little as they can.`)) });
}

function th(label: string | HTMLElement, { num = false, sort, title }: { num?: boolean; sort?: "ascending" | "descending"; title?: string } = {}): HTMLTableCellElement {
  // The order is fixed (byNext, or by total): a sorted column says so with aria-sort and an arrow, and is no button.
  const head = typeof label === "string" ? txt(label) : label;
  return el("th", { scope: "col", class: num ? "num" : "", ...(sort ? { "aria-sort": sort } : {}), ...(title ? { title } : {}) },
    sort ? box("span", { class: "scr-sorted" }, head, icon(sort === "ascending" ? "arrow-up" : "arrow-down", { size: "sm" })) : head);
}
function stateRow(cols: number, kid: HTMLElement): HTMLTableRowElement {
  return el("tr", {}, el("td", { colspan: cols, class: "scr-state" }, kid));
}
function drawTable(all: Row[], shown: Row[]): void {
  const t = $<HTMLTableElement>("#scr-table")!;
  const plain = tab === "power" ? !steps().length : !usableAt();
  const cols = tab === "power" ? powerColumns(all as PowerRow[], plain) : sotColumns(plain);
  t.setAttribute("aria-label", tab === "power" ? "Power scrolls by skill" : "Scrolls of Transcendence by skill");
  t.classList.toggle("scr-plain", plain);
  t.querySelector("colgroup")!.replaceChildren(...cols.map((c) => el("col", c.width ? { class: `scr-w-${c.width}` } : {})));
  t.querySelector("thead")!.replaceChildren(el("tr", {}, ...cols.map((c) => c.head)));
  const body = t.querySelector("tbody")!;
  const foot = $<HTMLElement>("#scr-foot")!;
  const setFoot = (next: HTMLDivElement): void => { next.id = "scr-foot"; foot.replaceWith(next); };
  if (!data) {
    body.replaceChildren(stateRow(cols.length, loadError ? message({ tone: "bad", text: `Could not load the scrolls: ${loadError}` }) : txt("Loading scrolls…", "muted")));
    setFoot(tableFoot(""));
    return;
  }
  if (!data.power.length && !data.sot.length) {
    body.replaceChildren(stateRow(cols.length, box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, "No power scrolls or Scrolls of Transcendence in your scans."))));
    setFoot(tableFoot("No scrolls"));
    return;
  }
  if (!shown.length) {
    const what = tab === "power" ? "power scrolls" : "Scrolls of Transcendence";
    body.replaceChildren(stateRow(cols.length, box("div", { class: "empty-state" }, el("p", { class: "muted" }, all.length ? `No skill with ${what} matches “${filter.trim()}”.` : `No ${what} in your scans.`))));
  } else {
    body.replaceChildren(...shown.map((r, i) => {
      const tr = el("tr", { class: `item${r.ready ? " ready" : ""}${r.skill === selected ? " sel" : ""}`, tabindex: i === 0 || r.skill === selected ? 0 : -1, "data-skill": r.skill },
        ...cols.map((c) => c.cell(r)));
      return tr;
    }));
    if (selected) for (const tr of body.querySelectorAll<HTMLElement>("tr.item")) tr.tabIndex = tr.dataset.skill === selected ? 0 : -1;
  }
  setFoot(footer(all, shown, plain));
}

// width: a column width class in inventory.css (narrower below 1280 px), none for the column taking the rest.
interface Col { head: HTMLTableCellElement; width?: "skill" | "level" | "total" | "chips" | "prog" | "bind" | undefined; cell: (r: Row) => HTMLTableCellElement }
function skillCell(r: Row): HTMLTableCellElement {
  return el("td", {}, box("span", { class: "scr-skill" }, txt(r.skill, "ellip"), r.ready ? badge("Ready", "ok") : null));
}
function powerColumns(all: PowerRow[], plain: boolean): Col[] {
  const levels = powerLevels(all, steps());
  const sorted: "ascending" | "descending" = plain ? "ascending" : "descending";
  const cols: Col[] = [{ head: th("Skill", plain ? { sort: sorted } : {}), width: "skill", cell: skillCell }];
  for (const l of levels) cols.push({ head: th(String(l), { num: true }), width: "level", cell: (r) => countCell(r as PowerRow, l) });
  if (plain) {
    cols.push({ head: th("Total", { num: true }), width: "total", cell: (r) => el("td", { class: "num" }, txt((r as PowerRow).total.toLocaleString("en-US"))) });
    cols.push(whereCol());
    return cols;
  }
  cols.push({ head: th("Next roll-up", { sort: sorted, title: "Closest to a roll-up first" }), cell: (r) => el("td", {}, nextCell(r as PowerRow)) });
  // Only with something that binds now, and not while the detail is open (it says the same).
  if (all.some((r) => r.bindAll) && !selected) cols.push({ head: th("Bind everything", { title: "What you would hold after binding every full set, top tier first" }), width: "bind", cell: (r) => el("td", {}, (r as PowerRow).bindAll ? txt((r as PowerRow).bindAll!, "ellip") : "") });
  return cols;
}
// Without binder recipes: the places a skill's scrolls are in, by name.
const whereCol = (): Col => ({ head: th("Where"), cell: (r) => el("td", {}, txt([...new Set(r.items.map((it) => splitSerial(whereText(it.location?.text)).name))].join(", "), "ellip")) });
function countCell(r: PowerRow, level: number): HTMLTableCellElement {
  const n = r.counts[level] ?? 0;
  if (!n) return el("td", { class: "num" });
  const a = el("a", { href: "#/inventory", class: "scr-count", "aria-label": `Show the ${plural(n, `${level} ${r.skill} scroll`)} in Inventory` }, String(n));
  a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); showSearch(powerQuery(r.skill, level)); });
  return el("td", { class: "num" }, a);
}
function nextCell(r: PowerRow): HTMLElement {
  const nx = r.next;
  if (!nx) return txt("Nothing to roll up", "faint");
  return box("span", { class: "scr-next" },
    box("span", { class: "ellip" }, txt(`${nx.from} → ${nx.to}: `), txt(`${nx.have} of ${nx.count}`, "strong")),
    meter(Math.min(nx.have, nx.count), nx.count, { tone: nx.more ? undefined : "ok", label: `${nx.have} of ${nx.count} ${nx.from} scrolls toward a ${nx.to}` }),
    txt(nx.more ? `${nx.more} more` : "Ready", "t-sm muted"));
}
function sotColumns(plain: boolean): Col[] {
  const cols: Col[] = [
    { head: th("Skill"), width: "skill", cell: skillCell },
    { head: th("Scrolls"), width: "chips", cell: (r) => el("td", { class: "scr-chips-cell" }, box("span", { class: "scr-chips" }, ...runText((r as SotRow).tenths).map((t) => badge(t)))) },
    { head: th("Total", { num: true, sort: "descending" }), width: "total", cell: (r) => el("td", { class: "num" }, txt(fmtTenths((r as SotRow).total), "strong")) },
  ];
  // The detail lists the scrolls, so the chips make way for the plan while it is open.
  if (selected && !plain) cols.splice(1, 1);
  if (plain) return [...cols, whereCol()];
  const at = usableAt()!, max = toTenths(at[at.length - 1]!);
  const scale = box("span", { class: "sot-prog-head" }, txt("Progress"),
    box("span", { class: "sot-scale", "aria-hidden": "true" }, txt("0"), ...at.map((p) => el("span", { style: `left:${(100 * toTenths(p)) / max}%` }, fmtTenths(toTenths(p))))));
  cols.push({ head: th(scale), width: "prog", cell: (r) => el("td", {}, sotBar(r as SotRow, at, max)) });
  cols.push({ head: th("Binder plan"), cell: (r) => { const p = (r as SotRow).plan!; return el("td", {}, txt(planText(p), p.kind === "bind" ? "ellip" : "ellip muted")); } });
  return cols;
}
// The total against the usable marks; a total past the last one fills the bar, and its value stays at the last mark
// while its text gives the real total.
function sotBar(r: SotRow, at: number[], max: number): HTMLElement {
  return box("div", { class: "sot-bar", role: "meter", "aria-valuemin": 0, "aria-valuemax": max / 10, "aria-valuenow": Math.min(r.total, max) / 10, "aria-valuetext": `${fmtTenths(r.total)} points`, "aria-label": `${r.skill} points` },
    el("span", { class: "fill", style: `width:${Math.min(100, (100 * r.total) / max)}%` }),
    ...at.slice(0, -1).map((p) => el("span", { class: "mark", style: `left:${(100 * toTenths(p)) / max}%` })));
}
function footer(all: Row[], shown: Row[], plain: boolean): HTMLDivElement {
  const scrolls = shown.reduce((a, r) => a + ("tenths" in r ? r.tenths.length : r.total), 0);
  const skills = shown.length === all.length ? plural(all.length, "skill") : `${shown.length.toLocaleString("en-US")} of ${plural(all.length, "skill")}`;
  // The count on the left, then the recipe and the order on the right.
  const strip = (...right: string[]): HTMLDivElement => box("div", { class: "tbl-foot" }, txt(`${skills} · ${plural(scrolls, "scroll")}`), el("span", { class: "spacer" }), ...dotted(right));
  if (tab === "power") {
    if (plain) return strip("Sorted by skill");
    return strip(`Binder: ${steps().map((s) => `${s.count} × ${s.from} → ${s.to}`).join(" · ")}`, "Sorted by closest to a roll-up");
  }
  if (plain) return strip("Sorted by total");
  const [first, ...rest] = usableAt()!.map((p) => fmtTenths(toTenths(p)));
  return strip(`Binder: points add up; usable at exactly ${first}${rest.map((p) => `, or at ${p} once past ${first}`).join("")}`, "Sorted by total");
}

// ---------------------------------------------------------------- the detail
function drawDetail(shown: Row[]): void {
  const p = $<HTMLElement>("#scr-peek")!;
  const r = shown.find((x) => x.skill === selected);
  if (!r) { p.hidden = true; p.replaceChildren(); return; }
  const power = tab === "power";
  const groups = placeGroups(power ? [...r.items].sort((a, b) => (b.props.psLevel ?? 0) - (a.props.psLevel ?? 0)) : [...r.items].sort((a, b) => (b.props.sotPoints ?? 0) - (a.props.sotPoints ?? 0)));
  const count = power ? plural((r as PowerRow).total, "power scroll") : plural((r as SotRow).tenths.length, "Scroll of Transcendence", "Scrolls of Transcendence");
  const nx = power ? (r as PowerRow).next : null;
  const summary = power ? powerSummary(r as PowerRow) : sotSummary(r as SotRow);
  const titleId = "scr-peek-title";
  p.setAttribute("aria-labelledby", titleId);
  p.replaceChildren(
    box("div", { class: "peek-head" },
      box("div", { class: "peek-title" }, el("h2", { class: "t-lg", id: titleId }, r.skill),
        button({ label: "Previous skill", icon: "chevron-up", iconOnly: true, variant: "ghost", size: "sm", onClick: () => step(-1) }),
        button({ label: "Next skill", icon: "chevron-down", iconOnly: true, variant: "ghost", size: "sm", onClick: () => step(1) }),
        button({ label: "Close detail", icon: "close", iconOnly: true, variant: "ghost", size: "sm", attrs: { "data-peek-close": "" }, onClick: () => closeDetail(true) })),
      box("div", { class: "peek-meta" }, badge(count), badge(plural(groups.length, "container")))),
    box("div", { class: "peek-body" },
      summary ? box("section", { class: "peek-sec", "aria-label": power ? "Roll-up" : "Binder plan" }, txt(power ? "Roll-up" : "Binder plan", "caps"), summary) : null,
      box("section", { class: "peek-sec", "aria-label": "Where they are" }, txt("Where they are", "caps"),
        ...groups.map((g) => {
          const { name, serial } = splitSerial(whereText(g.text));
          return box("div", { class: "scr-place" },
            box("div", { class: "scr-place-head" }, txt(name, "ellip"), serial ? txt(serial, "mono faint") : null, txt(String(g.items.reduce((a, it) => a + (it.amount || 1), 0)), "scr-place-n")),
            txt(whoText(g.location), "t-sm muted scr-place-who"),
            el("ul", { class: "scr-list" }, ...g.items.map((it) => {
              const level = power ? String(it.props.psLevel) : fmtTenths(toTenths(it.props.sotPoints ?? 0));
              return itemTip(box("li", {}, badge(level, power && nx && it.props.psLevel === nx.from ? "accent" : undefined), txt((it.amount || 1) > 1 ? `${listName(it.name)} ×${it.amount}` : listName(it.name), "ellip"), ...tagEls(it)), it);
            })));
        }))),
    box("div", { class: "overlay-foot peek-foot" },
      box("div", { class: "peek-acts scr-acts" }, button({ label: "Show in Inventory", icon: "inventory", block: true, attrs: { id: "scr-show" }, onClick: () => showSearch(power ? powerQuery(r.skill) : sotQuery(r.skill)) })),
      box("p", { class: "t-sm muted peek-keys" }, kbd("↑"), kbd("↓"), txt("step through skills"), kbd("Esc"), txt("close"))));
  p.hidden = false;
}
function powerSummary(r: PowerRow): HTMLElement | null {
  const nx = r.next;
  if (!nx) return null;
  const pairs: Array<[string, string]> = [["Next roll-up", `${nx.from} → ${nx.to}: ${nx.have} of ${nx.count}`], ["Still needed", nx.more ? `${nx.more} more × ${nx.from}` : "None: it can bind now"]];
  if (r.bindAll) pairs.push(["Bind everything", r.bindAll]);
  return box("div", { class: "scr-rollup" }, keyValue(pairs), meter(Math.min(nx.have, nx.count), nx.count, { tone: nx.more ? undefined : "ok", label: `${nx.have} of ${nx.count} toward ${nx.to}` }));
}
function sotSummary(r: SotRow): HTMLElement | null {
  const at = usableAt();
  if (!at || !r.plan) return null;
  const max = toTenths(at[at.length - 1]!);
  return box("div", { class: "scr-rollup" }, keyValue([["Total", fmtTenths(r.total)], ["Plan", planText(r.plan)]]), sotBar(r, at, max));
}

// ---------------------------------------------------------------- selection and keys
function openDetail(skill: string, focusRow = true): void {
  selected = skill;
  render();
  if (focusRow) $<HTMLElement>(`#scr-table tr[data-skill="${CSS.escape(skill)}"]`)?.focus();
}
function closeDetail(focusRow: boolean): void {
  const was = selected;
  if (!was) return;
  selected = null;
  render();
  if (focusRow) $<HTMLElement>(`#scr-table tr[data-skill="${CSS.escape(was)}"]`)?.focus();
}
const rowEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("#scr-table tbody tr.item")];
// ↑/↓ from the table or the detail: the next row gets focus, and the detail follows it while open.
function step(delta: number, from?: HTMLElement): void {
  const rows = rowEls();
  if (!rows.length) return;
  const at = from ? rows.indexOf(from) : rows.findIndex((tr) => tr.dataset.skill === selected);
  const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))]!;
  if (selected) { openDetail(next.dataset.skill!); return; }
  for (const tr of rows) tr.tabIndex = tr === next ? 0 : -1;
  next.focus();
}
function wireKeys(): void {
  const body = $<HTMLElement>("#scr-table tbody")!;
  body.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr.item");
    if (tr) openDetail(tr.dataset.skill!);
  });
  body.addEventListener("keydown", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr.item");
    if (!tr || e.target !== tr || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(tr.dataset.skill!); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); step(e.key === "ArrowUp" ? -1 : 1, tr); }
    else if (e.key === "Escape" && selected) { e.preventDefault(); closeDetail(true); }
  });
  $<HTMLElement>("#scr-peek")!.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { e.preventDefault(); closeDetail(true); }
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !(e.target as HTMLElement).closest(".peek-body")) { e.preventDefault(); step(e.key === "ArrowUp" ? -1 : 1); }
  });
  // "/" focuses the filter from anywhere on the view, as it does the Items view's search.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || root().offsetParent === null) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], dialog, .drawer-root")) return;
    e.preventDefault();
    search.focus(); search.select();
  });
}
