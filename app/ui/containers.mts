// ui/containers.mts — the Inventory screen's Containers view (design spec 4.2): every scanned root
// container in the same dense table the Items view uses, grouped by character with the ground
// containers last, a Fill column (each container's Contents line), and a row "⋯" menu with "Show these items", "Show on map" (a container a house map holds: ui/house-links.mts, issue #10),
// "Show missing items" (a root with items missing since its last scan, which also shows a badge; issue #99),
// "Highlight in game" (ground containers; the bridge's highlight with the container as its target, issue #10),
// "Label…" / "Edit label…" (ground containers not blacklisted; Organize, issue #11), "Blacklist…" (ground
// containers) and "Forget…". A container labelled for Organize shows its label, colour and Pinned. The Forget and Blacklist handlers call `reload` from inventory-data.mts. reload(),
// not load(): a Forget changes the inventory and nothing else, and must keep the filters and the builder
// as they are.
import { bagLabel, compareNames } from "../vault-lib.mts";
import type { Container } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, itemTip, toast, safeColor } from "./dom.mts";
import { api } from "./api.mts";
import { txt, box, button, confirmDialog, menu, tableFoot, input, select, switchControl, field, message, openDialog, meter, tag } from "./components.mts";
import { relativeWhen, errorText } from "./messages.mts";
import { loadOrganize, saveConfig } from "./organize-data.mts";
import { withLabel, withoutLabel, pinNote, LABEL_COLOURS, fillTone } from "./organize-model.mts";
import { plural } from "./inv-model.mts";
import { reload } from "./inventory-data.mts";
import { houseOfContainer, showOnMap } from "./house-links.mts";
import { openedRoots } from "./roster.mts";
import { registerScreen, showContainer } from "./nav.mts";
import { splitSerial } from "./item-parts.mts";
import { bridgeActionReason, runBridgeAction } from "./bridge.mts";
import type { ForgetApiResponse, MissingApiResponse, OrganizeConfig } from "./api-types.mts";

const KIND_NAMES: Record<string, string> = { backpack: "Backpack", bank: "Bank", ground: "On the ground" };
// Same total width as before the Fill column, so the table still fits a 1000 px window without scrolling.
const COLS: Array<[string, number, boolean]> = [["Container", 270, false], ["Kind", 120, false], ["Scanned by", 120, false], ["When", 120, false], ["Items", 70, true], ["Fill", 130, false]];

async function forget(r: Container, name: string, n: number): Promise<void> {
  if (!await confirmDialog({ title: `Forget ${name}?`, body: `${name} and the ${plural(n, "item")} in it leave the inventory. It comes back the next time it is scanned.`, confirmLabel: `Forget ${name}` })) return;
  try { await api<ForgetApiResponse>("/api/forget", { method: "POST", body: { root: r.serial, name: bagLabel(r) } }); await reload(); } catch (e) { toast((e as Error).message, "bad"); }
}

// Scans skip a blacklisted container from now on (POST /api/blacklist). What was last scanned in it is
// then either forgotten the way Forget does it, or kept (Keep, Cancel and Esc all keep it).
async function blacklist(r: Container, name: string, n: number): Promise<void> {
  try {
    await api("/api/blacklist", { method: "POST", body: { serial: +r.serial, name: bagLabel(r), ...(r.pos ? { where: `${r.pos.x}, ${r.pos.y}` } : {}) } });
    if (n && await confirmDialog({ title: `Also remove ${name} and its ${plural(n, "item")} from Pack Rat?`, body: `Scans skip ${name} from now on either way. Keep leaves what was last scanned in the inventory.`, confirmLabel: "Remove", cancelLabel: "Keep" })) {
      await api<ForgetApiResponse>("/api/forget", { method: "POST", body: { root: r.serial, name: bagLabel(r) } });
    }
    await reload();
    toast(`${name} is blacklisted. Unblacklist it in Settings.`, "good");
  } catch (e) { toast((e as Error).message, "bad"); }
}

// Label… (Organize, issue #11): the container's name for Organize, an optional colour and Pinned. Labelling a
// ground container is what puts it in Organize's reach; pinning keeps it out of every rule's targets, so a
// pin or a removal that takes it off rules says which, first. Also offered by the House map's panel (ui/house-map.mts).
export async function labelContainer(r: Container): Promise<void> {
  if (!state.organize.config) { try { await loadOrganize(); } catch (e) { toast(errorText(e), "bad"); return; } }
  const cfg = state.organize.config!, had = cfg.labels[String(r.serial)];
  const shown = had?.name ?? (r.label || bagLabel(r));
  const name = input({ value: had?.name ?? bagLabel(r), attrs: { id: "lbl-name", maxlength: "64" } });
  const colour = select([{ value: "", label: "No color" }, ...LABEL_COLOURS.map((c) => ({ value: c.value, label: c.name }))], had?.color ?? "", { attrs: { id: "lbl-colour" } });
  const pin = switchControl({ label: "Pinned: Organize never takes items out or puts items in", checked: !!had?.pinned, attrs: { id: "lbl-pin" } });
  const problem = el("div", {});
  let dlg: { close: () => void } | null = null;
  const fail = (text: string): void => { problem.replaceChildren(message({ tone: "bad", text })); };
  // The setup as saved now, not as it was when the dialog opened (Auto organize or another window may have added a
  // rule that fills this chest since): what a pin or a removal takes the chest off (issue #123).
  const current = async (): Promise<OrganizeConfig> => {
    try { await loadOrganize(); } catch { /* the setup the dialog opened with */ }
    return state.organize.config ?? cfg;
  };
  const save = async (): Promise<void> => {
    const n = name.value.trim();
    if (!n || n.length > 64) { fail("Give the label a name, up to 64 characters."); name.focus(); return; }
    const { config, dropped } = withLabel(await current(), { serial: +r.serial, name: n, ...(colour.value ? { color: colour.value } : {}), ...(pin.input.checked ? { pinned: true } : {}), origin: "manual" });
    if (dropped.length && !await confirmDialog({ title: `Pin ${n}?`, body: pinNote(n, dropped), confirmLabel: `Pin ${n}`, danger: false })) return;
    const err = await saveConfig(config);
    if (err) { fail(err); return; }
    dlg?.close();
    toast(`${n} is labeled for Organize.`, "good");
  };
  const remove = async (): Promise<void> => {
    const { config, dropped } = withoutLabel(await current(), +r.serial);
    if (!await confirmDialog({ title: `Remove the label from ${shown}?`, body: dropped.length ? `Organize stops using it, and it comes off ${dropped.join(", ")}.` : "Organize stops using it: nothing is taken from it or put into it.", confirmLabel: "Remove label" })) return;
    const err = await saveConfig(config);
    if (err) { fail(err); return; }
    dlg?.close();
    toast(`${shown} is no longer labeled.`, "good");
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") void save(); });
  dlg = openDialog({
    title: had ? `Edit label: ${shown}` : `Label ${shown}`, width: "md", initialFocus: name,
    body: [el("p", { class: "muted" }, "Organize only takes items from, and puts items into, labeled containers. The label is shown wherever this container is."), field({ label: "Label", control: name }), field({ label: "Color", control: colour }), pin.root, problem],
    actions: [...(had ? [button({ label: "Remove label", variant: "danger-outline", onClick: () => { void remove(); } })] : []), button({ label: "Cancel", onClick: () => dlg?.close() }), button({ label: "Save label", variant: "primary", attrs: { id: "lbl-save" }, onClick: () => { void save(); } })],
  });
}
// Show missing items (issue #99): what the root's previous scan saw in it that its latest did not, and that no
// scan has seen anywhere else since. A stack that shrank in place is listed by how many fewer, and so is one that
// vanished but only partly fits into the same-kind stacks scanned since (app/missing.mts).
async function showMissing(r: Container, name: string): Promise<void> {
  let items: MissingApiResponse["items"];
  try { ({ items } = await api<MissingApiResponse>(`/api/missing?root=${+r.serial}`)); } catch (e) { toast(errorText(e), "bad"); return; }
  const close = button({ label: "Close", variant: "primary", onClick: () => dlg.close() });
  const rows = [...items].sort((a, b) => compareNames(a.name, b.name)).map((m) => itemTip(el("tr", {},
    el("td", {}, txt(m.name || `0x${m.serial.toString(16)}`)),
    el("td", { class: "num" }, txt(m.fewer ? `${m.fewer.toLocaleString("en-US")} fewer` : m.amount.toLocaleString("en-US"))),
    el("td", {}, txt(relativeWhen(m.lastSeen)))), m, { focus: false }));   // its tooltip: the record drawn here (the item is gone from the inventory)
  const table = el("table", { class: "tbl", "aria-label": `Missing from ${name}` },
    el("colgroup", {}, el("col"), el("col", { style: "width:110px" }), el("col", { style: "width:140px" })),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, txt("Item")), el("th", { scope: "col", class: "num" }, txt("Amount")), el("th", { scope: "col" }, txt("Last seen there")))),
    el("tbody", {}, ...rows));
  const dlg = openDialog({
    title: `Missing from ${name}`, width: "md", initialFocus: close,
    body: [el("p", { class: "muted" }, items.length ? "In this container at its previous scan, gone at its latest, and not seen in any other scanned container since. Rescan where you moved them and they leave this list. A stack could have been added to a same-kind stack seen since, so it may not show while you keep more of it elsewhere." : "Nothing is missing any more."), ...(items.length ? [table] : [])],
    actions: [close],
  });
}
// A container's fill from its Contents line, or "unknown" for a ground container whose scan had none.
function fillCell(r: Container): HTMLElement {
  const c = r.capacity;
  if (!c) return txt(r.kind === "ground" ? "unknown" : "", "t-sm muted");
  return box("span", { class: "cont-fill" }, meter(c.items, c.maxItems, { tone: fillTone({ items: c.items, max: c.maxItems }), label: `${c.items} of ${c.maxItems} items` }), txt(`${c.items}/${c.maxItems}`, "t-sm num"));
}

// #/containers/<Name> (issue #10): only the containers that character's scans opened, the ones the character
// sheet counts; null lists every container.
let scanner: string | null = null;
export function showContainers(name: string | null): void {
  scanner = name;
  if (state.inv) renderContainers();
}
registerScreen({ name: "containers", show: (r) => showContainers(r.scanner) });
document.addEventListener("inventorychange", () => renderContainers());
// A saved Organize setup changes how the containers read.
document.addEventListener("organizechange", () => { if (state.inv) renderContainers(); });
const showAll = (): HTMLElement => el("a", { href: "#/containers", id: "cont-show-all" }, "Show all");

export function renderContainers(): void {
  const t = $<HTMLTableElement>("#cont-table")!;
  // load() always fetches the inventory before this is ever called — same non-null assumption every
  // other renderX() function in this page makes about state.inv.
  const inv = state.inv!;
  t.querySelector("colgroup")!.replaceChildren(...COLS.map(([, w]) => el("col", { style: `width:${w}px` })), el("col", { style: "width:48px" }));
  t.querySelector("thead")!.replaceChildren(el("tr", {}, ...COLS.map(([h, , num]) => el("th", { scope: "col", class: num ? "num" : "" }, txt(h))), el("th", { scope: "col" }, txt("Actions", "sr"))));
  const body = t.querySelector("tbody")!;
  const roots = scanner ? openedRoots(inv.containers, scanner) : Object.values(inv.containers).filter((c) => c.parent == null);
  // Each render swaps the footer for a new one, which keeps the id so the next render finds it.
  const foot = $<HTMLElement>("#cont-foot")!;
  const setFoot = (next: HTMLDivElement): void => { next.id = "cont-foot"; foot.replaceWith(next); };
  if (!roots.length && scanner) {
    body.replaceChildren(el("tr", {}, el("td", { colspan: COLS.length + 1 }, box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, `${scanner}'s scans opened no containers`), showAll()))));
    setFoot(tableFoot("No containers"));
    return;
  }
  if (!roots.length) {
    body.replaceChildren(el("tr", {}, el("td", { colspan: COLS.length + 1 }, box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, "Nothing scanned yet"), el("p", { class: "muted" }, txt("Containers show up here once a scan has opened them."))))));
    setFoot(tableFoot("No containers"));
    return;
  }
  // Grouped by character, the ground last: a backpack or bank under its owner, a ground container under
  // "On the ground" (whoever scanned it is its own column).
  const groups = new Map<string, Container[]>();
  for (const r of roots) {
    const g = r.kind === "backpack" || r.kind === "bank" ? r.scannedBy : "On the ground";
    groups.set(g, [...(groups.get(g) || []), r]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === "On the ground" ? 1 : b === "On the ground" ? -1 : a.localeCompare(b)));
  const rows: HTMLTableRowElement[] = [];
  for (const g of order) {
    rows.push(el("tr", { class: "group" }, el("td", { colspan: COLS.length + 1 }, txt(g))));
    for (const r of groups.get(g)!.sort((a, b) => String(b.scannedAt).localeCompare(String(a.scannedAt)))) {
      const n = inv.rootCounts[r.serial] || 0;
      // label, not bagLabel: several ground chests share a name, and the fold's label tells them apart. An Organize
      // label replaces both, with its colour and Pinned beside it.
      const lab = state.organize.config?.labels[String(r.serial)];
      const label = lab?.name ?? (r.label || bagLabel(r));
      const { name, serial } = lab ? { name: lab.name, serial: "" } : splitSerial(label);
      const swatch = lab?.color ? el("span", { class: "org-swatch", style: `background:${safeColor(lab.color)}`, "aria-hidden": "true" }) : null;
      const bags = Object.values(inv.containers).filter((c) => c.root === r.serial && c.parent != null).length;
      const canLabel = r.kind === "ground" && !state.organize.blacklist.includes(+r.serial);
      const missing = inv.missingCounts[r.serial] || 0;
      // The container is the target, named in game as this row names it (no chain: a root has no parent).
      const target = { serial: +r.serial, name, container: null, root: r.root };
      const more = button({ label: `Actions for ${label}`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { const home = houseOfContainer(+r.serial); menu(more, [
        { label: "Show these items", icon: "inventory", onSelect: () => showContainer(+r.serial) },
        ...(home ? [{ label: "Show on map", icon: "house" as const, count: home.name, onSelect: () => showOnMap(home.id, +r.serial) }] : []),
        ...(r.kind === "ground" ? [{ label: "Highlight in game", icon: "highlight" as const, disabled: bridgeActionReason("highlight", target), onSelect: () => { void runBridgeAction("highlight", target); } }] : []),
        ...(missing ? [{ label: "Show missing items", onSelect: () => { void showMissing(r, label); } }] : []),
        ...(canLabel ? [{ label: lab ? "Edit label…" : "Label…", onSelect: () => { void labelContainer(r); } }] : []),
        ...(r.kind === "ground" ? [{ label: "Blacklist…", onSelect: () => { void blacklist(r, label, n); } }] : []),
        { label: "Forget…", danger: true, onSelect: () => { forget(r, label, n); } },
      ], { label: `Actions for ${label}` }); } });
      rows.push(el("tr", { "data-root": r.serial },
        el("td", {}, box("span", { class: "inv-loc" }, swatch, txt(name, "ellip"), txt(serial || `0x${(+r.serial).toString(16)}`, "mono faint"), lab?.pinned ? tag("Pinned") : null, bags ? txt(plural(bags, "container"), "t-sm muted") : null, missing ? tag(`${missing} missing`, "warn") : null)),
        el("td", {}, txt(KIND_NAMES[String(r.kind)] || String(r.kind || "Unknown"))),
        el("td", {}, txt(r.scannedBy)),
        el("td", {}, txt(relativeWhen(r.scannedAt))),
        el("td", { class: "num" }, txt(n.toLocaleString("en-US"))),
        el("td", {}, fillCell(r)),
        el("td", { class: "cont-act" }, more)));
    }
  }
  body.replaceChildren(...rows);
  const counted = plural(roots.length, "container") + (scanner ? ` ${scanner}'s scans opened` : "");
  const next = tableFoot(counted, plural((scanner ? roots.map((r) => inv.rootCounts[r.serial] || 0) : Object.values(inv.rootCounts)).reduce((a, b) => a + b, 0), "item"), scanner ? showAll() : null, "Newest scan of a container wins; Forget one you emptied");
  setFoot(next);
}
