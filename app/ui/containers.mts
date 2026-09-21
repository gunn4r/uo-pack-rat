// ui/containers.mts — the Containers tab. Moved verbatim out of index.html's inline
// <script type="module"> (Task 4, the page split). The Forget handler calls `load` from app.mts —
// a module cycle (containers ↔ app) that is fine here since both are function declarations only
// called after bootstrap.
import { bagLabel } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, fmtWhen, toast } from "./dom.mts";
import { api } from "./api.mts";
import { load } from "./app.mts";
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
    body.append(el("tr", {}, el("td", {}, el("span", { class: "name" }, bagLabel(r)), bags.length ? el("div", { class: "small muted" }, bags.map(bagLabel).join(" · ")) : null),
      el("td", {}, r.kind), el("td", {}, r.scannedBy), el("td", { class: "num small" }, fmtWhen(r.scannedAt)), el("td", { class: "n" }, n),
      el("td", {}, el("button", { class: "small", onclick: async () => {
        try { await api<ForgetApiResponse>("/api/forget", { method: "POST", body: { root: r.serial, name: bagLabel(r) } }); } catch (e) { toast((e as Error).message, "bad"); return; }
        load();
      } }, "Forget"))));
  }
}
