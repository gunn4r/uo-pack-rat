// guards.mts — the checks a request field or a hand-edited data file is held to: a real string of bounded length, an integer in an inclusive range, a serial. Shared by the HTTP layer and the stores, so neither imports the other.

// A request field that must be a real string of bounded length. `unknown` in, a narrowed string out,
// so a route reads the value directly after the check instead of casting it.
export function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
// Same for an integer within an inclusive range (opts.restarts, opts.timeBudgetMs, …).
export function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

// Bounds a caller-supplied value before it is interpolated into an error message or a log line.
export function short(v: unknown): string { return String(v).slice(0, 64); }

// The largest serial the scan contract accepts (app/schema/scan.v2.schema.json: a 32-bit unsigned).
export const MAX_SERIAL = 0xFFFFFFFF;
