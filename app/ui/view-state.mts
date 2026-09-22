// ui/view-state.mts — the page's pure state rules: what a refresh keeps, where the pager lands and
// what "Clear all" resets. No DOM and no store.mts import, so app/ui-state.test.mts imports it under
// plain node:test, the same arrangement as ui/adapters.mts.
import type { ItemQuery } from "../item-query.mts";

// The offset to show once a fetch reports `total` rows. A Forget or a rescan can shrink the list under
// a page the player is on; the server slices whatever offset it is given, so without this the pager
// reads "141–48 of 48" over an empty table. Lands on the last page that still has rows.
export function clampOffset(offset: number, limit: number, total: number): number {
  if (total <= 0) return 0;
  if (offset < total) return offset;
  return Math.floor((total - 1) / limit) * limit;
}

export interface SelectOption { value: string; label: string; }
// A filter dropdown's options after a refresh rebuilt them from the new facets, keeping the value the
// query still applies. When that value has left the facets (the last matching item was forgotten),
// it stays as an option so the select keeps showing the filter the table is still using, rather than
// falling back to "any" while the rows stay filtered.
export function optionsKeeping(options: SelectOption[], current: string, gone: (value: string) => string): SelectOption[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: gone(current) }];
}

// Every filter back to its default: text, the dropdowns, the checkboxes, the hidden tags and the
// property minimums. The view (grouping, sort, page size) is not a filter and stays as it was.
export function clearedQuery(q: ItemQuery): ItemQuery {
  return { ...q, q: "", slot: "", loc: "", rarity: "", kind: "", seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], props: [], offset: 0 };
}
