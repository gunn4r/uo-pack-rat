// ui/unravel-model.mts — the words of the Unravel view's Gather into a bag dialog (issue #271), with no DOM, so app/unravel-model.test.mts
// tests them under plain node:test. The move itself is Move to's (ui/move-to.mts, ui/move-model.mts).
//
// map: unravel
// owns: `gatherWeight`, `gatherButton`
import type { Item } from "../vault-lib.mts";
import type { MovePlanSummary } from "./api-types.mts";
import { plural } from "./inv-model.mts";

// Unravel Container works through the bag's top level only (ServUO's ImbuingGump walks the container's own items).
export const GATHER_LOOSE = "Pieces go in loose, not in sub-bags: Unravel Container only reaches the bag's top level.";
// Move to fills only a container on the ground or a bag inside one, so the bag is carried to the forge afterwards.
export const GATHER_GROUND = "Move to fills only a container on the ground or a bag in one, not a bag in a backpack or bank: take the bag into your backpack at a soul forge.";

// The pieces' total weight, as their tooltips state it; pieces with no weight line are said apart.
export function gatherWeight(items: ReadonlyArray<Pick<Item, "weight">>): string {
  const known = items.filter((it) => typeof it.weight === "number");
  const stones = known.reduce((a, it) => a + (it.weight as number), 0);
  const total = `Total weight ${plural(stones, "stone")}.`;
  const unknown = items.length - known.length;
  return unknown ? `${total} ${plural(unknown, "piece has", "pieces have")} no weight line.` : total;
}

// The dialog's button for the remembered bag: every piece, or only those that fit.
export function gatherButton(plan: Pick<MovePlanSummary, "moving" | "noRoom">): string {
  return plan.noRoom ? `Gather the ${plan.moving.toLocaleString("en-US")} that fit` : `Gather ${plural(plan.moving, "piece")}`;
}
