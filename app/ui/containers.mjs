// ui/containers.mjs — the Containers tab. Moved verbatim out of index.html's inline
// <script type="module"> (Task 4, the page split). The Forget handler calls `load` from app.mjs —
// a module cycle (containers ↔ app) that is fine here since both are function declarations only
// called after bootstrap.
import { bagLabel } from "../vault-lib.mts";
import { state } from "./store.mjs";
import { $, el, fmtWhen, toast } from "./dom.mjs";
import { api } from "./api.mjs";
import { load } from "./app.mjs";

// ---------------------------------------------------------------- containers
export function renderContainers() {
  const body = $("#cont-table tbody"); body.replaceChildren();
  const roots = Object.values(state.inv.containers).filter((c) => c.parent == null).sort((a, b) => String(b.scannedAt).localeCompare(String(a.scannedAt)));
  if (!roots.length) { body.append(el("tr", {}, el("td", { colspan: 6, class: "empty" }, "Nothing scanned yet."))); return; }
  for (const r of roots) {
    const n = state.inv.rootCounts[r.serial] || 0;
    const bags = Object.values(state.inv.containers).filter((c) => c.root === r.serial && c.parent != null);
    body.append(el("tr", {}, el("td", {}, el("span", { class: "name" }, bagLabel(r)), bags.length ? el("div", { class: "small muted" }, bags.map(bagLabel).join(" · ")) : null),
      el("td", {}, r.kind), el("td", {}, r.scannedBy), el("td", { class: "num small" }, fmtWhen(r.scannedAt)), el("td", { class: "n" }, n),
      el("td", {}, el("button", { class: "small", onclick: async () => {
        try { await api("/api/forget", { method: "POST", body: { root: r.serial, name: bagLabel(r) } }); } catch (e) { toast(e.message, "bad"); return; }
        load();
      } }, "Forget"))));
  }
}
