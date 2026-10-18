// ui/format.mts — pure text formatting the whole page shares: a count and its noun. No DOM and no
// store.mts import, so any screen model and its plain node:test file can use it.
//
// map: ui-models
// owns: `plural`

// "1 stack", "2 stacks", "1,204 pieces": a count and its noun, always agreeing.
export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
