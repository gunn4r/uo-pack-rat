// gear-name-probe.mts — finds gear names drawn without `gearItem` (issues #504, #503).
//
// Every visible element whose own text is a gear item's name, alone or followed by " ×" (a hand-built quantity) or ":" (a hand-built "name: reason"), or holds one as whole words inside a sentence, must sit inside a `.gi-name`, the name `app/ui/gear-item.mts` draws in its rarity's color. probeGearNames() runs INSIDE the page (Playwright's page.evaluate), so it stays self-contained: no imports, no closures over module scope. It reports every offender, not the first.
//
// Left out: hidden elements, form controls (a select's option is a choice, not a drawn piece), and the places in GEAR_NAME_EXEMPT, each with its reason.
// gearNames() reads the names to look for from the page's own server (GET /api/items?kind=gear, every page). Inside a sentence, a name that is also a slot's label (`labels`: a piece named "Ring") is not looked for: "Ring:" or "Ring · DCI 9" names the slot, and the page cannot tell the two apart. As a whole text it still is, with the slot cells exempt by place.
// Used by scripts/ui-contrast.test.mts on every scene; the static scan in scripts/gear-item-guard.test.mts catches the common hand-built forms earlier.
//
// map: tooling
// owns: `probeGearNames`, `gearNames`, `slotLabels`, `GEAR_NAME_EXEMPT`, `GearNameHit`
import { SLOT_LABELS } from "../app/domain/slots.mts";

export interface GearNameHit { name: string; text: string; path: string }

// Where a gear name may be text of its own: [selector, reason]. A slot's label reads the same as a piece named after
// the slot ("Ring", "Bracelet"), so a slot cell is exempt by its place, never by the name.
export const GEAR_NAME_EXEMPT: Array<[string, string]> = [
  [".tipcard", "the item tooltip, wherever it is drawn (#tip, a popover's copy): it is what gearItem shows, and draws the name itself"],
  [".sr", "screen-reader text, not drawn"],
  ["#toasts", "a toast's sentence names the piece in passing"],
  ["tr.item-group", "a grouped Inventory row names a group of stacks, not one piece"],
  ["td.slot-cell", "a slot's label in a table: the Inventory's Slot column, the Suit Builder plan's and Compare's Slot cells, a character sheet's worn-gear Slot cell"],
  [".mb-slot-line > .caps", "a Manual slot card's slot label"],
  [".b-checks .check", "a Suit Builder checklist (Locked slots, weapon skills): a slot or a skill to tick"],
];

export function probeGearNames([names, exempt, labels]: [readonly string[], readonly string[], readonly string[]]): GearNameHit[] {
  const want = new Set(names), slotNames = new Set(labels);
  const skip = ["option", "select", "textarea", ...exempt].join(", ");
  const hidden = (el: Element): boolean => {
    const s = getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden" || el.getClientRects().length === 0;
  };
  // The gear name the text is, or starts with before " ×" or ":", else one it holds as whole words inside (the longest
  // first; not a slot's label there).
  const inside = [...want].filter((n) => !slotNames.has(n)).sort((a, b) => b.length - a.length);
  const word = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);
  const nameIn = (t: string): string | null => {
    if (want.has(t)) return t;
    for (const m of t.matchAll(/ ×|:/g)) if (want.has(t.slice(0, m.index))) return t.slice(0, m.index);
    for (const n of inside) for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) if (!word(t[i - 1]) && !word(t[i + n.length])) return n;
    return null;
  };
  const path = (el: Element): string => {
    const out: string[] = [];
    for (let n: Element | null = el; n && n !== document.body && out.length < 5; n = n.parentElement) out.unshift(n.id ? `#${n.id}` : `${n.tagName.toLowerCase()}${n.classList.length ? "." + [...n.classList].slice(0, 2).join(".") : ""}`);
    return out.join(" > ");
  };
  const hits: GearNameHit[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent || "").join("").replace(/\s+/g, " ").trim();
    const name = own ? nameIn(own) : null;
    if (!name || el.closest(".gi-name") || el.closest(skip) || hidden(el)) continue;
    hits.push({ name, text: own.slice(0, 80), path: path(el) });
  }
  return hits;
}

// Every gear item's name the server has, read inside the page.
export async function gearNames(): Promise<string[]> {
  const out = new Set<string>();
  for (let offset = 0, total = 1; offset < total; offset += 500) {
    const r = await (await fetch(`/api/items?kind=gear&limit=500&offset=${offset}`)).json() as { total: number; rows: Array<{ name: string }> };
    total = r.total;
    for (const row of r.rows) out.add(row.name);
    if (!r.rows.length) break;
  }
  return [...out];
}

// Every slot's label, for probeGearNames' `labels`.
export const slotLabels = (): string[] => Object.values(SLOT_LABELS);
