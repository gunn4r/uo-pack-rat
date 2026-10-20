// ui/format.mts — pure text formatting the whole page shares: a count and its noun, and the one rule a typed search
// matches a list's words by. No DOM and no store.mts import, so any screen model and its plain node:test file can use it.
//
// map: ui-models
// owns: `plural`, `textHit`

// "1 stack", "2 stacks", "1,204 pieces": a count and its noun, always agreeing.
export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// Whether a typed search finds a row (#487): the text, trimmed, in any case, anywhere in the row's words taken together;
// an empty search finds every row. Every option list, the Runs search, the roster and the Move to picker read it.
export function textHit(needle: string, ...fields: Array<string | null | undefined>): boolean {
  const q = needle.trim().toLowerCase();
  return !q || fields.filter(Boolean).join(" ").toLowerCase().includes(q);
}
