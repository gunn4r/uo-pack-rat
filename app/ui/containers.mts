// ui/containers.mts — the Inventory screen's Containers view (design spec 4.2): every scanned root
// container in the same dense table the Items view uses, grouped by character with the ground
// containers last, and a row "⋯" menu with "Show these items" and "Forget…". The Forget handler calls
// `reload` from app.mts — a module cycle (containers ↔ app) that is fine here since both are function
// declarations only called after bootstrap. reload(), not load(): a Forget changes the inventory and
// nothing else, and must keep the filters and the builder as they are.
import { bagLabel } from "../vault-lib.mts";
import type { Container } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, toast } from "./dom.mts";
import { api } from "./api.mts";
import { txt, box, button, confirmDialog, menu, tableFoot } from "./components.mts";
import { relativeWhen } from "./messages.mts";
import { plural } from "./inv-model.mts";
import { reload } from "./app.mts";
import { showContainer, splitSerial } from "./inventory.mts";
import type { ForgetApiResponse } from "./api-types.mts";

const KIND_NAMES: Record<string, string> = { backpack: "Backpack", bank: "Bank", ground: "On the ground" };
const COLS: Array<[string, number, boolean]> = [["Container", 320, false], ["Kind", 140, false], ["Scanned by", 140, false], ["When", 150, false], ["Items", 80, true]];

async function forget(r: Container, name: string, n: number): Promise<void> {
  if (!await confirmDialog({ title: `Forget ${name}?`, body: `${name} and the ${plural(n, "item")} in it leave the inventory. It comes back the next time it is scanned.`, confirmLabel: `Forget ${name}` })) return;
  try { await api<ForgetApiResponse>("/api/forget", { method: "POST", body: { root: r.serial, name: bagLabel(r) } }); await reload(); } catch (e) { toast((e as Error).message, "bad"); }
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
      // label, not bagLabel: several ground chests share a name, and the fold's label tells them apart.
      const label = r.label || bagLabel(r);
      const { name, serial } = splitSerial(label);
      const bags = Object.values(inv.containers).filter((c) => c.root === r.serial && c.parent != null).length;
      const more = button({ label: `Actions for ${label}`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", onClick: () => menu(more, [
        { label: "Show these items", icon: "inventory", onSelect: () => showContainer(+r.serial) },
        { label: "Forget…", danger: true, onSelect: () => { forget(r, label, n); } },
      ], { label: `Actions for ${label}` }) });
      rows.push(el("tr", { "data-root": r.serial },
        el("td", {}, box("span", { class: "inv-loc" }, txt(name, "ellip"), txt(serial || `0x${(+r.serial).toString(16)}`, "mono faint"), bags ? txt(plural(bags, "bag"), "t-sm muted") : null)),
        el("td", {}, txt(KIND_NAMES[String(r.kind)] || String(r.kind || "Unknown"))),
        el("td", {}, txt(r.scannedBy)),
        el("td", {}, txt(relativeWhen(r.scannedAt))),
        el("td", { class: "num" }, txt(n.toLocaleString("en-US"))),
        el("td", { class: "cont-act" }, more)));
    }
  }
  body.replaceChildren(...rows);
  const next = tableFoot(plural(roots.length, "container"), plural(Object.values(inv.rootCounts).reduce((a, b) => a + b, 0), "item"), "Newest scan of a container wins; Forget one you emptied");
  next.id = "cont-foot";
  foot.replaceWith(next);
}
