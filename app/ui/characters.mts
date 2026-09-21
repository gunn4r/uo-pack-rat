// ui/characters.mts — the Characters tab: schematic paperdoll + character sheet per character.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
// `pillFor` and `CAP_KEYS` were dead code in the original (defined, never called) and are dropped.
import { state } from "./store.mts";
import { $, el, slotLabel, rarityColor, fmtWhen } from "./dom.mts";
import { sheetHtml } from "./sheet.mts";
import type { Item, Character } from "../vault-lib.mts";
import type { SkillEntry } from "./api-types.mts";

// ---------------------------------------------------------------- characters
export const DOLL_LAYOUT: Array<Array<string | null>> = [   // 4 columns, roughly the in-game paperdoll arrangement
  ["earrings", "helmet", "neck", "cloak"],
  ["twoHanded", "arms", "chest", "talisman"],
  ["oneHanded", "hands", "robe", "waist"],
  ["shirt", "bracelet", "legs", "ring"],
  [null, null, "feet", null],
];
export function dollHtml(name: string): HTMLDivElement {
  const worn = state.inv!.worn[name] || [];
  const bySlot: Record<string, Item[]> = {};
  for (const i of worn) (bySlot[i.slot || "?"] ||= []).push(i);
  const cells: HTMLDivElement[] = [];
  for (const rowSlots of DOLL_LAYOUT) for (const slot of rowSlots) {
    if (!slot) { cells.push(el("div", { class: "slot body" })); continue; }
    const items = bySlot[slot] || [];
    if (!items.length) { cells.push(el("div", { class: "slot empty" }, el("div", { class: "k" }, slotLabel(slot)), el("div", { class: "n" }, "—"))); continue; }
    for (const it of items) cells.push(el("div", { class: "slot", "data-serial": it.serial, style: it.rarity ? `border-color:${rarityColor(it.rarity) || "var(--line)"}` : "" },
      el("div", { class: "k" }, slotLabel(slot)), el("div", { class: "n" }, it.name, ...it.tags.map((t) => el("span", { class: "tag " + t }, t)))));
  }
  const odd = worn.filter((i) => !i.slot || !DOLL_LAYOUT.flat().includes(i.slot));
  for (const it of odd) cells.push(el("div", { class: "slot", "data-serial": it.serial }, el("div", { class: "k" }, it.layer || "?"), el("div", { class: "n" }, it.name)));
  return el("div", { class: "doll" }, ...cells);
}
// The shard's free-skill list (secondary skills — Lumberjacking, Cartography, Lockpicking… — that
// don't count toward the 720 skill cap, from rules.freeSkills) shown as a footer line: just the ones
// this character actually has above 0.
function freeSkillsLine(c: Character | undefined): HTMLDivElement | null {
  // c.skills is Record<string, unknown> (the scan schema leaves per-skill shape open); a real entry
  // is a {value, cap} pair (SkillEntry, api-types.mts) — same cast sheet.mts's identical read uses.
  const skills = c?.skills as Record<string, SkillEntry> | undefined;
  const free = (state.rules?.freeSkills || []).filter((name) => (skills?.[name]?.value || 0) > 0);
  return free.length ? el("div", { class: "small muted" }, `Free skills: ${free.join(", ")}`) : null;
}
export function renderCharacters(): void {
  const cards = $<HTMLElement>("#char-cards")!; cards.replaceChildren();
  const inv = state.inv!, profiles = state.profiles!;
  const names = [...new Set([...Object.keys(inv.characters), ...Object.keys(profiles.characters || {})])];
  if (!names.length) { cards.append(el("div", { class: "panel empty" }, "No characters scanned yet.")); return; }
  for (const name of names) {
    const c = inv.characters[name];
    const worn = inv.worn[name] || [];
    const current = Object.fromEntries(worn.map((i): [number, Item] => [i.serial, i]));
    cards.append(el("div", { class: "panel stack" },
      el("div", { class: "row", style: "justify-content:space-between" }, el("h2", {}, name), el("span", { class: "small muted" }, c ? `scanned ${fmtWhen(c.scannedAt)}` : "not scanned yet")),
      c ? el("div", { class: "charcard" }, dollHtml(name), el("div", { html: sheetHtml(name, current, null) })) : null,
      c ? freeSkillsLine(c) : null));
  }
}
