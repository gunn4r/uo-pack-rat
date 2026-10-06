// ui/nav.mts — the hash routes, the screen registry they dispatch to, and the cross-screen ways into the
// Inventory's Items view. Screens import these from here, not from app.mts or from another screen: each screen
// registers what it does when its route is shown, and the Inventory hands over its Items view at startup.
import type { ItemQuery } from "../item-query.mts";
import { state } from "./store.mts";

// ---------------------------------------------------------------- hash routes
// Six screens (Inventory, House map, Characters, Suit Builder, Organize, Settings), each a <main> in index.html, and routes on
// top of them: #/inventory, #/containers (Inventory's Containers view), #/containers/<Character> (only the containers that character's scans opened), #/scrolls and #/scrolls/sot (Inventory's Scrolls view on its Power scrolls or Scrolls of Transcendence tab, issue #181), #/map (the House map, the house with the most chests), #/map/<house id> (that house, or #/map/plain for chests outside any drawn house; ?q=<query> searches it, ?select=<container serial> opens on that container's stack: ui/house-map-model.mts parseMapHash), #/characters,
// #/characters/<Character> (that character's sheet), #/builder/<Character>, #/runs (the Suit Builder with the saved-runs drawer open), #/organize (Organize: labels, rules, the plan and its trips), #/import (the Import
// drawer over whichever screen was showing) and #/settings. A reload lands where you were; nav clicks add a
// history entry (back/forward walk them, and close a drawer); switching the builder's character replaces the
// entry instead.
const ROUTES = ["inventory", "containers", "scrolls", "map", "characters", "builder", "runs", "organize", "import", "settings"];
export interface Route { tab: string; character: string | null; sheet: string | null; house: string | null; scanner: string | null; scrolls: "power" | "sot" }
export function parseRoute(): Route {
  const parts = location.hash.replace(/^#\/?/, "").split("?")[0]!.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const tab = ROUTES.includes(parts[0] as string) ? parts[0]! : "inventory";
  return { tab, character: tab === "builder" ? parts[1] || null : null, sheet: tab === "characters" ? parts[1] || null : null, house: tab === "map" ? parts[1] || null : null, scanner: tab === "containers" ? parts[1] || null : null, scrolls: tab === "scrolls" && parts[1] === "sot" ? "sot" : "power" };
}
export function routeFor(tab: string): string { return tab === "builder" && state.builder.character ? `#/builder/${encodeURIComponent(state.builder.character)}` : `#/${tab}`; }

// ---------------------------------------------------------------- the screen registry
// A screen's part of showing its route, after app.mts has switched the visible screen. One per route name.
export interface Screen { name: string; show: (route: Route) => void }
const screens = new Map<string, Screen>();
export function registerScreen(screen: Screen): void { screens.set(screen.name, screen); }
export function showRoute(route: Route): void { screens.get(route.tab)?.show(route); }

// ---------------------------------------------------------------- ways into the Items view
// The Inventory (inventory.mts) fills these in at startup; each one sets the Items view's query and then goes to #/inventory.
export interface ItemsView { showItem: (it: { serial: number; name: string }) => void; showCharacterItems: (name: string) => void; showOnly: (filter: Partial<ItemQuery>) => void }
let items: ItemsView = { showItem: () => {}, showCharacterItems: () => {}, showOnly: () => {} };
export function setItemsView(view: ItemsView): void { items = view; }
// The character sheet's "Open in Inventory": the Items view searching for the piece's name, with that
// piece open in the peek as soon as its row arrives.
export function showItem(it: { serial: number; name: string }): void { items.showItem(it); }
// Characters' "Show Dorran's items": the Items view filtered to one character (worn, backpack, bank, and
// the ground containers that character scanned), every other filter cleared.
export function showCharacterItems(name: string): void { items.showCharacterItems(name); }
// Containers' "Show these items" and a row's "Show everything in this container": the Items view
// filtered to one root container.
export function showContainer(root: number): void { items.showOnly({ roots: [root] }); }
// The House map's "See all in Inventory": the Items view searching for the same text, every other filter cleared.
export function showSearch(q: string): void { items.showOnly({ q: q.trim().toLowerCase() }); }
// Every item of one kind: Organize's way to the items Pack Rat could not classify (issue #150).
export function showKind(kind: string): void { items.showOnly({ kind: [kind] }); }
