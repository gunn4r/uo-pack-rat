// gear-name-probe.mts — finds gear names drawn without `gearItem` (issues #504, #503).
//
// Every visible element whose own text is exactly a gear item's name must sit inside a `.gi-name`, the name `app/ui/gear-item.mts` draws in its rarity's color. probeGearNames() runs INSIDE the page (Playwright's page.evaluate), so it stays self-contained: no imports, no closures over module scope. It reports every offender, not the first.
//
// Left out: the item tooltip wherever it is drawn (.tipcard: #tip and a popover's copy draw the name themselves), a body-level tag tooltip (.tip), screen-reader text (.sr), toasts (#toasts), a grouped Inventory row (.item-group: a group of stacks, not one piece), hidden and aria-hidden subtrees, and form controls (a select's option is a choice, not a drawn piece).
// gearNames() reads the names to look for from the page's own server (GET /api/items?kind=gear, every page); checkedNames() then drops a name that is also a slot's label (a piece named "Ring" reads the same as the Ring slot, so the page cannot tell them apart).
// Used by scripts/ui-contrast.test.mts on every scene; the static scan in scripts/gear-item-guard.test.mts catches the common hand-built forms earlier.
//
// map: tooling
// owns: `probeGearNames`, `gearNames`, `checkedNames`, `GearNameHit`
import { SLOT_LABELS } from "../app/domain/slots.mts";

export interface GearNameHit { name: string; tag: string; cls: string; path: string }

export function probeGearNames(names: readonly string[]): GearNameHit[] {
  const want = new Set(names);
  const skip = ".tipcard, body > .tip, .sr, #toasts, tr.item-group, [aria-hidden='true'], option, select, textarea";
  const hidden = (el: Element): boolean => {
    const s = getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden" || el.getClientRects().length === 0;
  };
  const path = (el: Element): string => {
    const out: string[] = [];
    for (let n: Element | null = el; n && n !== document.body && out.length < 5; n = n.parentElement) out.unshift(n.id ? `#${n.id}` : `${n.tagName.toLowerCase()}${n.classList.length ? "." + [...n.classList].slice(0, 2).join(".") : ""}`);
    return out.join(" > ");
  };
  const hits: GearNameHit[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent || "").join("").replace(/\s+/g, " ").trim();
    if (!own || !want.has(own) || el.closest(".gi-name") || el.closest(skip) || hidden(el)) continue;
    hits.push({ name: own, tag: el.tagName.toLowerCase(), cls: el.className && typeof el.className === "string" ? el.className : "", path: path(el) });
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

// The names worth looking for: every gear name but those that are also a slot's label.
export function checkedNames(all: readonly string[]): string[] {
  const labels = new Set(Object.values(SLOT_LABELS));
  return all.filter((n) => !labels.has(n));
}
