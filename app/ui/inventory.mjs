// ui/inventory.mjs — the Inventory tab: filters, columns, sorting, the table itself. Task 5: the
// table is now a server-paged view over GET /api/items instead of a client-side filter/sort/slice
// pass over every scanned item — state.query is the page-side source of truth (the exact shape
// item-query.mts's parseItemQuery reads off a URLSearchParams), fetchItems() builds the query string
// from it and lands the response in state.page, and renderInventory() only ever draws state.page.
import { PROP_FULL, tagUnits } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, label, full, colVal, slotLabel, isStale, ago, EXTRA_COLS, fmtN, rarityColor, rarCell, fmtWhen } from "./dom.mts";
import { api } from "./api.mts";
import { actButtons, bridgeNoteEl } from "./bridge.mjs";

// ---------------------------------------------------------------- inventory filters
// Populated once from state.facets (the server's facetsOf() snapshot over the whole inventory, set
// in app.mjs's load()) — the same "built from the full set, not the current filter" behavior the
// original client-side buildFilters() had (it always read every scanned item, never the filtered set).
export function buildFilters() {
  const f = state.facets || { slots: [], locations: [], rarities: [], slayers: [], slayerAny: 0, kinds: [], propKeys: [] };
  $("#f-slot").replaceChildren(el("option", { value: "" }, "any"), ...f.slots.map((s) => el("option", { value: s }, slotLabel(s))), el("option", { value: "?" }, "unknown slot"));
  $("#f-loc").replaceChildren(el("option", { value: "" }, "anywhere"), ...f.locations.map((l) => el("option", { value: l }, l)));
  $("#f-rarity").replaceChildren(el("option", { value: "" }, "any"), ...f.rarities.map((r) => el("option", { value: r }, r)));
  $("#f-slayer").replaceChildren(el("option", { value: "" }, "any"), el("option", { value: "*" }, `any slayer (${f.slayerAny})`), ...f.slayers.map(({ name, count }) => el("option", { value: name }, `${name} (${count})`)));
  $("#f-tags").replaceChildren(...Object.keys(tagUnits()).map((t) => el("button", { class: "chip", "aria-pressed": state.query.hideTags.includes(t), onclick: (e) => {
    state.query.hideTags = state.query.hideTags.includes(t) ? state.query.hideTags.filter((x) => x !== t) : [...state.query.hideTags, t];
    e.target.setAttribute("aria-pressed", state.query.hideTags.includes(t)); requery();
  } }, t)));
  renderPropFilters();
  renderColChips();
  $("#f-kind").replaceChildren(el("option", { value: "" }, "everything"), ...f.kinds.map(({ name, count }) => el("option", { value: name }, `${name} (${count})`)));
  for (const id of ["#f-text", "#f-slot", "#f-loc", "#f-rarity", "#f-kind", "#f-seen", "#f-slayer", "#f-nogarg", "#f-med", "#f-group"]) $(id).addEventListener("input", onFilterChange);
  $("#f-addprop").onclick = () => { state.query.props.push({ key: state.propKeys[0] || "hci", min: 1 }); renderPropFilters(); requery(); };
  $("#f-clear").onclick = () => {
    state.query.props = []; $("#f-text").value = ""; $("#f-slot").value = ""; $("#f-loc").value = ""; $("#f-rarity").value = ""; $("#f-slayer").value = "";
    renderPropFilters(); onFilterChange();
  };
  $("#inv-prev").onclick = () => { if (state.query.offset > 0) { state.query.offset = Math.max(0, state.query.offset - state.query.limit); fetchItems(); } };
  $("#inv-next").onclick = () => { if (state.query.offset + state.query.limit < state.page.total) { state.query.offset += state.query.limit; fetchItems(); } };
  $("#inv-pagesize").value = String(state.query.limit);
  $("#inv-pagesize").onchange = () => { state.query.limit = +$("#inv-pagesize").value || 200; state.query.offset = 0; fetchItems(); };
}
export function renderPropFilters() {
  $("#f-props").replaceChildren(...state.query.props.map((f, i) => el("div", { class: "row" },
    el("select", { onchange: (e) => { f.key = e.target.value; requery(); } }, ...state.propKeys.map((k) => el("option", { value: k, selected: k === f.key ? "" : null }, `${label(k)} — ${full(k)}`))),
    "≥", el("input", { type: "number", value: f.min, oninput: (e) => { f.min = +e.target.value; requery(); } }),
    el("button", { onclick: () => { state.query.props.splice(i, 1); renderPropFilters(); requery(); } }, "×"))));
  // strip null attrs the helper set literally
  for (const o of $("#f-props").querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
}
export function renderColChips() {
  const all = [...new Set([...state.propKeys, ...Object.keys(EXTRA_COLS), ...state.cols])];
  $("#cols").replaceChildren(...all.map((k) => el("button", { class: "chip", title: full(k), "aria-pressed": state.cols.includes(k), onclick: (e) => {
    state.cols = state.cols.includes(k) ? state.cols.filter((x) => x !== k) : [...state.cols, k];
    localStorage.setItem("vault.cols", JSON.stringify(state.cols)); e.target.setAttribute("aria-pressed", state.cols.includes(k)); renderInventory();
  } }, label(k))));
}
// Every plain filter control (search text, the dropdowns, the checkboxes): read them all into
// state.query, reset to page 1 (a changed filter can only ever invalidate the current offset), fetch.
function onFilterChange() {
  const q = state.query;
  q.q = $("#f-text").value.trim().toLowerCase();
  q.slot = $("#f-slot").value;
  q.loc = $("#f-loc").value;
  q.rarity = $("#f-rarity").value;
  q.kind = $("#f-kind").value;
  q.seenDays = +$("#f-seen").value || 0;
  q.slayer = $("#f-slayer").value;
  q.nogarg = $("#f-nogarg").checked;
  q.med = $("#f-med").checked;
  q.group = $("#f-group").checked;
  requery();
}
function requery() { state.query.offset = 0; fetchItems(); }

// ---------------------------------------------------------------- fetch + render
// A request counter so a slow response to an old query can never clobber a newer one's result — the
// debounce below already keeps keystrokes from firing a request per character, but a fetch already in
// flight when the query changes again must still lose the race if it lands late.
let reqSeq = 0, debounceTimer = null;
export function fetchItems() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doFetch, 150);
}
async function doFetch() {
  const q = state.query, mine = ++reqSeq;
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.slot) params.set("slot", q.slot);
  if (q.loc) params.set("loc", q.loc);
  if (q.rarity) params.set("rarity", q.rarity);
  if (q.kind) params.set("kind", q.kind);
  if (q.seenDays) params.set("seenDays", String(q.seenDays));
  if (q.slayer) params.set("slayer", q.slayer);
  if (q.nogarg) params.set("nogarg", "1");
  if (q.med) params.set("med", "1");
  for (const t of q.hideTags) params.append("hide", t);
  for (const p of q.props) params.append("prop", `${p.key}:${p.min}`);
  if (q.group) params.set("group", "1");
  params.set("sort", q.sort);
  params.set("dir", String(q.dir));
  params.set("offset", String(q.offset));
  params.set("limit", String(q.limit));
  let res;
  try { res = await api(`/api/items?${params.toString()}`); }
  catch { return; }   // a transient fetch error leaves the last good page on screen rather than blanking it
  if (mine !== reqSeq) return;   // a newer request has since been issued — this response is stale, drop it
  state.page = "groups" in res
    ? { rows: [], groups: res.groups, total: res.total, pieces: 0 }
    : { rows: res.rows, groups: null, total: res.total, pieces: res.pieces };
  renderInventory();
}
export function renderInventory() {
  const { rows, groups, total, pieces } = state.page;
  const k = state.query.sort, d = state.query.dir;
  const th = (key, text, cls = "") => el("th", { class: (key === k ? "sorted " : "") + cls, title: PROP_FULL[key] || "", onclick: () => {
    if (state.query.sort === key) state.query.dir *= -1; else { state.query.sort = key; state.query.dir = 1; }
    fetchItems();
  } }, text + (key === k ? (d > 0 ? " ▾" : " ▴") : ""));
  const body = $("#inv-table tbody"); body.replaceChildren();
  $("#inv-count").textContent = groups ? `${fmtN(total)} distinct names` : `${fmtN(total)} stacks · ${fmtN(pieces)} pieces`;
  // One line, once, rather than repeating it on every row's missing Highlight/Grab/Go-to buttons.
  const note = bridgeNoteEl();
  $("#inv-bridge-note").replaceChildren(...(note ? [note] : []));
  renderPager(total);
  if (groups) {
    $("#inv-table thead").replaceChildren(el("tr", {}, th("name", "Name"), th("kind", "Kind"), th("amount", "Total", "n"), th("stacks", "Stacks", "n"), el("th", {}, "Where")));
    for (const g of groups) body.append(el("tr", { class: "item" }, el("td", { class: "name" }, g.name), el("td", { class: "muted" }, g.kind),
      el("td", { class: "n" }, g.amount.toLocaleString()), el("td", { class: "n" }, g.stacks),
      el("td", { class: "small" }, g.locations.map(([l, n]) => `${l} (${n.toLocaleString()})`).join(" · "))));
    if (!groups.length) body.append(el("tr", {}, el("td", { colspan: 5, class: "empty" }, "Nothing matches.")));
    return;
  }
  $("#inv-table thead").replaceChildren(el("tr", {}, th("name", "Name"), th("rarity", "Rarity"), th("kind", "Kind"), th("amount", "Qty", "n"), th("slot", "Slot"), th("location", "Location"), th("seen", "Seen"), ...state.cols.map((c) => th(c, label(c), "n"))));
  const span = 7 + state.cols.length;
  if (!rows.length) { body.append(el("tr", {}, el("td", { colspan: span, class: "empty" }, state.inv?.itemCount ? "Nothing matches." : "No items yet. Run packrat-scanner.py in game, then reload."))); return; }
  const frag = document.createDocumentFragment();
  for (const it of rows) {
    state.itemCache.set(it.serial, it);   // a rendered row already IS the full record — seed the cache so the tooltip/builder never re-fetch it
    const tr = el("tr", { class: "item", "data-serial": it.serial },
      el("td", {}, el("span", { class: "rar", style: it.rarity ? `background:${rarityColor(it.rarity) || "var(--line)"}` : "", title: it.rarity || "" }), el("span", { class: "name" }, it.name), ...(it.slayers || []).map((x) => el("span", { class: "tag slayer" }, x + " slayer")), it.gear && !it.medable ? el("span", { class: "tag", title: "blocks or halves meditation (no Mage Armor / Spell Channeling)" }, "no med") : null, ...it.tags.map((t) => el("span", { class: "tag " + t }, t))),
      el("td", {}, rarCell(it)), el("td", { class: "muted" }, it.kind), el("td", { class: "n" }, (it.amount || 1) > 1 ? (it.amount).toLocaleString() : el("span", { class: "muted" }, "·")),
      el("td", {}, it.slot ? slotLabel(it.slot) : el("span", { class: "muted" }, "·")), el("td", {}, it.location?.text || "", " ", actButtons(it)), el("td", { class: "small " + (isStale(it) ? "stale" : "muted") }, ago(it.seenAt)),
      ...state.cols.map((c) => el("td", { class: "n" }, colVal(it, c) ? String(colVal(it, c)) : el("span", { class: "muted" }, "·"))));
    tr.addEventListener("click", () => {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains("detail")) { next.remove(); return; }
      tr.after(el("tr", { class: "detail" }, el("td", { colspan: span }, it.lines.join("  ·  "), el("div", { class: "small" }, `serial 0x${it.serial.toString(16)} · seen ${fmtWhen(it.seenAt)} by ${it.scannedBy}`))));
    });
    frag.append(tr);
  }
  body.append(frag);
}
function renderPager(total) {
  const { offset, limit } = state.query;
  const hi = Math.min(offset + limit, total);
  $("#inv-pager-text").textContent = total ? `${fmtN(offset + 1)}–${fmtN(hi)} of ${fmtN(total)}` : "0 of 0";
  $("#inv-prev").disabled = offset <= 0;
  $("#inv-next").disabled = offset + limit >= total;
}
