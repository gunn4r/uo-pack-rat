// ui/kinds.mts — the player's own item kinds (issue #150), <data>/item-kinds.json through /api/item-kinds.
// Classify this… (an Inventory row's ⋯ menu, on an item that is not gear or a scanned container) gives an item one
// of the fixed kinds for every item with its name (the default) or its graphic, or puts back the automatic kind; the
// server folds the same scans again and reload() redraws the Inventory, the Kind filter and the Organize plan from
// that. Export saves the file through the browser's download (Electron's own Save dialog in the desktop app) and
// Import reads one with a file input and merges it in, its entries winning (Settings › Data). reload() (inventory-data.mts) is
// imported when it is needed.
import { OVERRIDE_KINDS, gameName, kindNameKey, kindGraphicKey, ownKind, type Item } from "../vault-lib.mts";
import { el, toast } from "./dom.mts";
import { api } from "./api.mts";
import { box, button, field, openDialog, select, txt } from "./components.mts";
import { errorText } from "./messages.mts";
import { plural } from "./inv-model.mts";
import type { ItemKindsApiResponse } from "./api-types.mts";


export async function openClassify(it: Item): Promise<void> {
  let doc: ItemKindsApiResponse;
  try { doc = await api<ItemKindsApiResponse>("/api/item-kinds"); } catch (e) { toast(errorText(e), "bad"); return; }
  // The name scope is the in-game name, which every item named so in game shares (a Scroll of Transcendence's shown
  // name carries its skill, issue #181); the title keeps the shown name.
  const named = gameName(it);
  const byName = ownKind(doc.names, kindNameKey(named)), byGraphic = it.graphic != null ? ownKind(doc.graphics, kindGraphicKey(it.graphic)) : null;
  const now = byName ?? byGraphic ?? it.kind;
  const kind = select(OVERRIDE_KINDS.map((k) => ({ value: k, label: k })), OVERRIDE_KINDS.includes(now) ? now : "other", { attrs: { id: "kind-pick" } });
  const scope = (value: "name" | "graphic", label: string, on: boolean, disabled = false): HTMLLabelElement => {
    const r = el("input", { type: "radio", name: "kind-scope", value });
    r.checked = on; r.disabled = disabled;
    return box("label", { class: "check" }, r, txt(label));
  };
  const scopes = box("div", { class: "field", role: "radiogroup", "aria-label": "Applies to" }, txt("Applies to", "label"),
    scope("name", `Every item named "${named}"`, !byGraphic || !!byName),
    scope("graphic", it.graphic != null ? `Every item that looks like this (graphic ${kindGraphicKey(it.graphic)})` : "Every item that looks like this (its graphic is not known)", !!byGraphic && !byName, it.graphic == null));
  const set = byName ? `You set this for every item named "${named}".` : byGraphic ? `You set this for every item with graphic ${kindGraphicKey(it.graphic!)}.` : null;
  let d: { close: () => void } | null = null;
  // One change, then the inventory again; a refusal keeps the dialog open with the server's reason.
  const send = async (bodies: object[], done: string): Promise<void> => {
    try { for (const body of bodies) await api<ItemKindsApiResponse>("/api/item-kinds", { method: "POST", body }); }
    catch (e) { toast(errorText(e), "bad"); return; }
    d?.close();
    toast(done, "good");
    await (await import("./inventory-data.mts")).reload();
  };
  const save = (): Promise<void> => {
    const byGraphicNow = scopes.querySelector<HTMLInputElement>("input:checked")?.value === "graphic";
    // A name beats a graphic, so this item's own name entry would hide the graphic's new kind: it goes.
    return send(byGraphicNow ? [...(byName ? [{ name: named, kind: null }] : []), { graphic: it.graphic, kind: kind.value }] : [{ name: named, kind: kind.value }],
      byGraphicNow ? `Every item with graphic ${kindGraphicKey(it.graphic!)} is now ${kind.value}.` : `Every item named "${named}" is now ${kind.value}.`);
  };
  d = openDialog({
    title: `Classify ${it.name}`, width: "md", initialFocus: kind,
    body: [field({ label: "Kind", control: kind, help: set ?? `Now ${it.kind}, from Pack Rat's own list.` }), scopes],
    actions: [
      ...(set ? [button({ label: "Reset to automatic", variant: "danger-outline", attrs: { id: "kind-reset" }, onClick: () => { void send([byName ? { name: named, kind: null } : { graphic: it.graphic, kind: null }], byName ? `Every item named "${named}" is classified automatically again.` : `Every item with graphic ${kindGraphicKey(it.graphic!)} is classified automatically again.`); } })] : []),
      button({ label: "Cancel", onClick: () => d?.close() }),
      button({ label: "Save", variant: "primary", attrs: { id: "kind-save" }, onClick: () => { void save(); } }),
    ],
  });
}

// Export: the file as it is now, saved as item-kinds.json.
export async function exportKinds(): Promise<void> {
  let doc: ItemKindsApiResponse;
  try { doc = await api<ItemKindsApiResponse>("/api/item-kinds"); } catch (e) { toast(errorText(e), "bad"); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: doc.version, names: doc.names, graphics: doc.graphics }, null, 2) + "\n"], { type: "application/json" }));
  el("a", { href: url, download: "item-kinds.json" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60e3);
}
// Import: a file the player picked, merged over the kinds they have; what the server left out is said, not hidden.
export async function importKinds(file: File): Promise<void> {
  let body: unknown;
  try { body = JSON.parse(await file.text()); } catch { toast(`${file.name} is not a JSON file.`, "bad"); return; }
  let r: ItemKindsApiResponse;
  try { r = await api<ItemKindsApiResponse>("/api/item-kinds/import", { method: "POST", body }); } catch (e) { toast(errorText(e), "bad"); return; }
  const n = Object.keys(r.names).length + Object.keys(r.graphics).length;
  toast(`Imported ${file.name}: you now have ${plural(n, "item kind")}.${r.skipped ? ` ${plural(r.skipped, "entry", "entries")} left out: ${r.problems?.[0]}.` : ""}`, r.skipped ? "" : "good");
  await (await import("./inventory-data.mts")).reload();
}
