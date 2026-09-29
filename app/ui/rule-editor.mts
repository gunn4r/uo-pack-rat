// ui/rule-editor.mts — the Organize rule editor (issue #11, spec §3): a drawer with the rule's name, what it
// takes (a preset to start from, "name is any of", and the filter: search text, kinds and the rarity range, plus
// any other filter it was saved with from the Inventory, as removable tokens) and where those items go
// (labelled, unpinned containers and the bags inside them, in fill order, each with its fill). Opened from the
// Organize screen's "+ Rule" and a rule's Edit…, and from the Inventory filter strip's "Save as rule…". Saving
// writes the whole setup with PUT /api/organize (organize-data.mts's saveConfig). Also the target chip the Rules
// card shares with it.
import { state } from "./store.mts";
import { el, toast, safeColor } from "./dom.mts";
import { box, txt, meter, confirmDialog } from "./components.mts";
import { saveConfig } from "./organize-data.mts";
import { fillText, fillTone, withoutRule, type TargetView } from "./organize-model.mts";
import type { OrganizeRule } from "./api-types.mts";

// A container in a rule's chain: its label's colour, its name, its fill as a meter and "61/125", or why not.
export function targetChip(t: TargetView): HTMLElement {
  const colour = t.color ? safeColor(t.color) : null;
  return box("span", { class: `org-target${t.gone ? " gone" : ""}` },
    colour ? el("span", { class: "org-swatch", style: `background:${colour}`, "aria-hidden": "true" }) : null,
    txt(t.name, "ellip"),
    t.fill && !t.gone ? meter(t.fill.items, t.fill.max, { tone: fillTone(t.fill), label: `${t.name}: ${fillText(t)} items` }) : null,
    txt(fillText(t), "t-sm muted num"));
}

export async function deleteRule(r: OrganizeRule): Promise<boolean> {
  if (!await confirmDialog({ title: `Delete ${r.name}?`, body: "Its items stay where they are, or go to the catch-all if one is picked. Labels are kept.", confirmLabel: `Delete ${r.name}` })) return false;
  const err = await saveConfig(withoutRule(state.organize.config!, r.id));
  if (err) { toast(err, "bad"); return false; }
  return true;
}

// Task 7 replaces this with the drawer.
export async function openRuleEditor(_o: { rule?: OrganizeRule; preset?: boolean } = {}): Promise<void> { toast("The rule editor comes in the next commit.", "bad"); }
