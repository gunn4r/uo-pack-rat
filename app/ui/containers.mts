// ui/containers.mts — the Containers tab. Moved verbatim out of index.html's inline
// <script type="module"> (Task 4, the page split). The Forget handler calls `reload` from app.mts —
// a module cycle (containers ↔ app) that is fine here since both are function declarations only
// called after bootstrap. reload(), not load(): a Forget changes the inventory and nothing else, and
// must keep the filters, the page and the builder as they are.
import { bagLabel } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, fmtWhen, toast } from "./dom.mts";
import { api } from "./api.mts";
import { confirmDialog } from "./components.mts";
import { reload } from "./app.mts";
import type { ForgetApiResponse } from "./api-types.mts";

// ---------------------------------------------------------------- containers
export function renderContainers(): void {
  const body = $<HTMLTableSectionElement>("#cont-table tbody")!; body.replaceChildren();
  // load() always fetches the inventory before this is ever called — same non-null assumption every
  // other renderX() function in this page makes about state.inv.
  const inv = state.inv!;
  const roots = Object.values(inv.containers).filter((c) => c.parent == null).sort((a, b) => String(b.scannedAt).localeCompare(String(a.scannedAt)));
  if (!roots.length) { body.append(el("tr", {}, el("td", { colspan: 6, class: "empty" }, "Nothing scanned yet."))); return; }
  for (const r of roots) {
    const n = inv.rootCounts[r.serial] || 0;
    const bags = Object.values(inv.containers).filter((c) => c.root === r.serial && c.parent != null);
    // label, not bagLabel: several ground chests share a name, and the fold's label tells them apart.
    const name = r.label || bagLabel(r);
    body.append(el("tr", {}, el("td", {}, el("span", { class: "name" }, name), bags.length ? el("div", { class: "small muted" }, bags.map((b) => b.label || bagLabel(b)).join(" · ")) : null),
      el("td", {}, r.kind), el("td", {}, r.scannedBy), el("td", { class: "num small" }, fmtWhen(r.scannedAt)), el("td", { class: "n" }, n),
      el("td", {}, el("button", { class: "small", onclick: async () => {
        if (!await confirmDialog({ title: `Forget ${name}?`, body: `${name} and the ${n} items in it leave the inventory. It comes back the next time it is scanned.`, confirmLabel: `Forget ${name}` })) return;
        try { await api<ForgetApiResponse>("/api/forget", { method: "POST", body: { root: r.serial, name: bagLabel(r) } }); await reload(); } catch (e) { toast((e as Error).message, "bad"); }
      } }, "Forget"))));
  }
}
