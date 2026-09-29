// ui/containers.mts — the Inventory screen's Containers view (design spec 4.2): every scanned root
// container in the same dense table the Items view uses, grouped by character with the ground
// containers last, a Fill column (each container's Contents line), and a row "⋯" menu with "Show these items",
// "Label…" / "Edit label…" (ground containers not blacklisted; Organize, issue #11), "Blacklist…" (ground
// containers) and "Forget…". A container labelled for Organize shows its label, colour and Pinned. The Forget and Blacklist handlers call `reload` from app.mts — a module cycle (containers
// ↔ app) that is fine here since both are function declarations only called after bootstrap. reload(),
// not load(): a Forget changes the inventory and nothing else, and must keep the filters and the builder
// as they are.
import { bagLabel } from "../vault-lib.mts";
import type { Container } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, toast, safeColor } from "./dom.mts";
import { api } from "./api.mts";
import { txt, box, button, confirmDialog, menu, tableFoot, input, select, switchControl, field, message, openDialog, meter, tag } from "./components.mts";
import { relativeWhen, errorText } from "./messages.mts";
import { loadOrganize, saveConfig } from "./organize-data.mts";
import { withLabel, withoutLabel, LABEL_COLOURS, fillTone } from "./organize-model.mts";
import { plural } from "./inv-model.mts";
import { reload } from "./app.mts";
import { showContainer, splitSerial } from "./inventory.mts";
import type { ForgetApiResponse } from "./api-types.mts";

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
// pin or a removal that takes it off rules says which, first.
async function labelContainer(r: Container): Promise<void> {
  if (!state.organize.config) { try { await loadOrganize(); } catch (e) { toast(errorText(e), "bad"); return; } }
  const cfg = state.organize.config!, had = cfg.labels[String(r.serial)];
  const shown = had?.name ?? (r.label || bagLabel(r));
  const name = input({ value: had?.name ?? bagLabel(r), attrs: { id: "lbl-name", maxlength: "64" } });
  const colour = select([{ value: "", label: "No colour" }, ...LABEL_COLOURS.map((c) => ({ value: c.value, label: c.name }))], had?.color ?? "", { attrs: { id: "lbl-colour" } });
  const pin = switchControl({ label: "Pinned: Organize never takes items out or puts items in", checked: !!had?.pinned, attrs: { id: "lbl-pin" } });
  const problem = el("div", {});
  let dlg: { close: () => void } | null = null;
  const fail = (text: string): void => { problem.replaceChildren(message({ tone: "bad", text })); };
  const save = async (): Promise<void> => {
    const n = name.value.trim();
    if (!n || n.length > 64) { fail("Give the label a name, up to 64 characters."); name.focus(); return; }
    const { config, dropped } = withLabel(cfg, { serial: +r.serial, name: n, ...(colour.value ? { color: colour.value } : {}), ...(pin.input.checked ? { pinned: true } : {}), origin: "manual" });
    if (dropped.length && !await confirmDialog({ title: `Pin ${n}?`, body: `Nothing is ever put into a pinned container, so it comes off ${dropped.join(", ")}.`, confirmLabel: `Pin ${n}`, danger: false })) return;
    const err = await saveConfig(config);
    if (err) { fail(err); return; }
    dlg?.close();
    toast(`${n} is labelled for Organize.`, "good");
  };
  const remove = async (): Promise<void> => {
    const { config, dropped } = withoutLabel(cfg, +r.serial);
    if (!await confirmDialog({ title: `Remove the label from ${shown}?`, body: dropped.length ? `Organize stops using it, and it comes off ${dropped.join(", ")}.` : "Organize stops using it: nothing is taken from it or put into it.", confirmLabel: "Remove label" })) return;
    const err = await saveConfig(config);
    if (err) { fail(err); return; }
    dlg?.close();
    toast(`${shown} is no longer labelled.`, "good");
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") void save(); });
  dlg = openDialog({
    title: had ? `Edit label: ${shown}` : `Label ${shown}`, width: "md", initialFocus: name,
    body: [el("p", { class: "muted" }, "Organize only takes items from, and puts items into, labelled containers. The label is shown wherever this container is."), field({ label: "Label", control: name }), field({ label: "Colour", control: colour }), pin.root, problem],
    actions: [...(had ? [button({ label: "Remove label", variant: "danger-outline", onClick: () => { void remove(); } })] : []), button({ label: "Cancel", onClick: () => dlg?.close() }), button({ label: "Save label", variant: "primary", attrs: { id: "lbl-save" }, onClick: () => { void save(); } })],
  });
}
// A container's fill from its Contents line, or "unknown" for a ground container whose scan had none.
function fillCell(r: Container): HTMLElement {
  const c = r.capacity;
  if (!c) return txt(r.kind === "ground" ? "unknown" : "", "t-sm muted");
  return box("span", { class: "cont-fill" }, meter(c.items, c.maxItems, { tone: fillTone({ items: c.items, max: c.maxItems }), label: `${c.items} of ${c.maxItems} items` }), txt(`${c.items}/${c.maxItems}`, "t-sm num"));
}

export function renderContainers(): void {
  const t = $<HTMLTableElement>("#cont-table")!;
  // load() always fetches the inventory before this is ever called — same non-null assumption every
  // other renderX() function in this page makes about state.inv.
  const inv = state.inv!;
  t.querySelector("colgroup")!.replaceChildren(...COLS.map(([, w]) => el("col", { style: `width:${w}px` })), el("col", { style: "width:48px" }));
  t.querySelector("thead")!.replaceChildren(el("tr", {}, ...COLS.map(([h, , num]) => el("th", { scope: "col", class: num ? "num" : "" }, txt(h))), el("th", { scope: "col" }, txt("Actions", "sr"))));
  const body = t.querySelector("tbody")!;
  const roots = Object.values(inv.containers).filter((c) => c.parent == null);
  const foot = $<HTMLElement>("#cont-foot")!;
  if (!roots.length) {
    body.replaceChildren(el("tr", {}, el("td", { colspan: COLS.length + 1 }, box("div", { class: "empty-state" }, el("h3", { class: "t-lg" }, "Nothing scanned yet"), el("p", { class: "muted" }, txt("Containers show up here once a scan has opened them."))))));
    foot.replaceWith(tableFoot("No containers"));
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
      const more = button({ label: `Actions for ${label}`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", onClick: () => menu(more, [
        { label: "Show these items", icon: "inventory", onSelect: () => showContainer(+r.serial) },
        ...(canLabel ? [{ label: lab ? "Edit label…" : "Label…", onSelect: () => { void labelContainer(r); } }] : []),
        ...(r.kind === "ground" ? [{ label: "Blacklist…", onSelect: () => { void blacklist(r, label, n); } }] : []),
        { label: "Forget…", danger: true, onSelect: () => { forget(r, label, n); } },
      ], { label: `Actions for ${label}` }) });
      rows.push(el("tr", { "data-root": r.serial },
        el("td", {}, box("span", { class: "inv-loc" }, swatch, txt(name, "ellip"), txt(serial || `0x${(+r.serial).toString(16)}`, "mono faint"), lab?.pinned ? tag("Pinned") : null, bags ? txt(plural(bags, "bag"), "t-sm muted") : null)),
        el("td", {}, txt(KIND_NAMES[String(r.kind)] || String(r.kind || "Unknown"))),
        el("td", {}, txt(r.scannedBy)),
        el("td", {}, txt(relativeWhen(r.scannedAt))),
        el("td", { class: "num" }, txt(n.toLocaleString("en-US"))),
        el("td", {}, fillCell(r)),
        el("td", { class: "cont-act" }, more)));
    }
  }
  body.replaceChildren(...rows);
  const next = tableFoot(plural(roots.length, "container"), plural(Object.values(inv.rootCounts).reduce((a, b) => a + b, 0), "item"), "Newest scan of a container wins; Forget one you emptied");
  next.id = "cont-foot";
  foot.replaceWith(next);
}
