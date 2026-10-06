// ui/item-parts.mts — the item widgets every screen shares: an item's rarity, tags and location as elements, the
// row actions (Highlight, Grab, Go to) and the ⋯ menu, and the filter context the filter wording needs. The
// Inventory (inventory.mts) hands the ⋯ menu its two ways into the Items view at startup, so no screen imports
// these from another screen.
import { tagUnits } from "../vault-lib.mts";
import type { Item } from "../vault-lib.mts";
import { state } from "./store.mts";
import { label, slotLabel, rarityColor, safeColor, toast, whereText, tagChip } from "./dom.mts";
import { rarityToken } from "./items.mts";
import { bridgeActionReason, runBridgeAction } from "./bridge.mts";
import { txt, box, rowActions, menu, copyText } from "./components.mts";
import type { MenuItem } from "./components.mts";
import { splitSerial } from "./inv-model.mts";
import { openClassify } from "./kinds.mts";
import { houseOfItem, showOnMap } from "./house-links.mts";
export { splitSerial } from "./inv-model.mts";

// ---------------------------------------------------------------- the filter context
export function filterContext() {
  return {
    slotLabel: (s: string) => slotLabel(s),
    propLabel: (k: string) => label(k),
    places: state.facets?.places || [],
    ladder: (state.rules?.rarity || []).map((r) => r.name),
  };
}

// ---------------------------------------------------------------- rarity, tags, location
// The shard's tag words ("cursed", "prized", …), lower-cased: a tooltip line that is one of them is a tag.
export const tagWords = (): string[] => Object.keys(tagUnits());
export function tagEls(it: Item, opts: { describe?: boolean } = {}): HTMLElement[] {
  return it.tags.map((t) => tagChip(t, opts));
}
// A tier as its dot and name in its --rarity-* colour; a tier with no token keeps its game colour inside a
// dark subtree, where the game colours were designed to live.
export function rarityEl(rarity: string | null | undefined, cls = ""): HTMLElement | null {
  if (!rarity) return null;
  if (rarityToken(rarity)) return box("span", { class: `rar-tier${cls ? " " + cls : ""}`, style: `color:${rarityColor(rarity)}` }, txt(rarity));
  const raw = rarityColor(rarity);
  return box("span", { class: `rar-tier${cls ? " " + cls : ""}`, "data-theme": "default", "data-mode": "dark", style: raw ? `color:${safeColor(raw) || raw}` : "" }, txt(rarity));
}
export function locationEl(it: Item): HTMLElement {
  const { name, serial } = splitSerial(whereText(it.location?.text));
  return serial ? box("span", { class: "inv-loc" }, txt(name, "ellip"), txt(serial, "mono faint")) : txt(name, "ellip");
}

// ---------------------------------------------------------------- row actions
// The Inventory's ways into its Items view, set by inventory.mts at startup: the item open in the peek, and
// everything in one root container.
export interface ItemNav { openDetails: (it: Item) => void; showContainer: (root: number) => void }
let nav: ItemNav = { openDetails: () => {}, showContainer: () => {} };
export function setItemNav(n: ItemNav): void { nav = n; }

const ACTIONS: Array<["highlight" | "grab" | "goto", string]> = [["highlight", "Highlight in game"], ["grab", "Grab to backpack"], ["goto", "Go to container"]];
// A row's ⋯ menu, also opened from the House map's contents drawer: there (or for an item that is no row of the table) Open details goes to the Inventory with the item in the peek.
export function itemMenu(anchor: HTMLElement, it: Item): void {
  const entries: MenuItem[] = [{ label: "Open details", icon: "panel-left", onSelect: () => nav.openDetails(it) }];
  if (it.root != null && !it.equippedBy) entries.push({ label: "Show everything in this container", icon: "folder", onSelect: () => nav.showContainer(+it.root!) });
  const home = houseOfItem(it);
  if (home) entries.push({ label: "Show on map", icon: "house", count: home.name, onSelect: () => showOnMap(home.id, home.serial) });
  entries.push({ label: "Copy serial", icon: "clipboard", onSelect: () => {
    const s = `0x${it.serial.toString(16)}`;
    void copyText(s).then((ok) => ok ? toast(`Copied ${s}`, "good") : toast("Could not copy the serial.", "bad"));
  } });
  // Gear keeps its slot-based kind, and a scanned bag is always a container (issue #150).
  if (!it.gear && !state.inv?.containers[it.serial]) entries.push({ label: "Classify this…", icon: "sliders", onSelect: () => { void openClassify(it); } });
  menu(anchor, entries, { label: `More actions for ${it.name}` });
}
// An item row's actions: Highlight, Grab and Go to (gated by the bridge, a disabled one saying why) and the ⋯ menu. The
// House map's contents drawer shows the same on its rows.
export function itemActions(it: Item): HTMLSpanElement {
  return rowActions([
    ...ACTIONS.map(([action, text]) => ({ label: text, icon: action, disabled: bridgeActionReason(action, it), onClick: () => { runBridgeAction(action, it); } })),
    { label: "More actions", icon: "more" as const, onClick: (e: MouseEvent) => itemMenu(e.currentTarget as HTMLElement, it) },
  ]);
}
