// put-away.mts — Put away (issue #131): the TazUO panel's one-click filing of the backpack, or of the Inbox chest,
// by the current Organize rules. The panel drops a request file (PUT_AWAY_REQUEST) into its adapter's inbox, the
// inbox watcher hands it to the server after any scan dropped before it, and the server answers in
// <data>/bridge/<adapter>/putaway.json. This module is the pure half: the request's strict check and the answer's
// words. The file is untrusted like every file in the data folder: it carries only an id, the source, the
// character and where the character stands; the server builds the trip itself from the setup with the ordinary
// planner (organize.mts, PlanOptions.putAway) and queues it with queueTrip.
import { parseStamp } from "./scan-schema.mts";
import type { PackKept, Plan } from "./organize.mts";

export const PUT_AWAY_REQUEST = "putaway-request.json";
export const PUT_AWAY_REPLY = "putaway.json";
// A request is a few hundred bytes; anything bigger is not one and is never read.
export const MAX_REQUEST_BYTES = 4096;
// A request is a click: like a bridge command (packrat-bridge.py's MAX_AGE_S, CLOCK_SKEW_S), an older one is a
// leftover (a request dropped while the app was closed and swept at startup) and is refused.
const MAX_AGE_MS = 60_000, SKEW_MS = 5_000;
// clickedAt is when the run's click was made: every request of one run carries it (a run is at most 10 trips).
const MAX_RUN_MS = 3_600_000;
// The source's scan must be at least this fresh against clickedAt. The panel runs the refresh (or the scanner) after
// the click and asks only once a newer scan file exists; the scan stamps its own start, on the same client's clock,
// in whole seconds like the click, so a scan made for this run is never older than clickedAt. Two seconds is room
// for that rounding and nothing more: an older scan is from before the click.
export const FRESH_MARGIN_MS = 2_000;
const KEYS = ["id", "source", "character", "requestedAt", "clickedAt", "at"];

export type PutAwaySource = "backpack" | "inbox";
export interface PutAwayRequest { id: string; source: PutAwaySource; character: string; requestedAt: string; clickedAt: string; at: { x: number; y: number; facet?: number } }
// The answer in putaway.json: `trip` is the queued trip's command id, whose result the panel reads from the
// bridge's status.json; with none, nothing was queued and `msg`/`detail` say why.
export interface PutAwayReply { id: string | null; ok: boolean; msg: string; detail?: string | undefined; trip?: string | undefined; t: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

// The id, when the file names a usable one: the panel matches the answer to its request by it.
export const requestId = (raw: unknown): string | null => (isObj(raw) && typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : null);

export function checkPutAwayRequest(raw: unknown, now: number): { ok: true; request: PutAwayRequest } | { ok: false; error: string } {
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
  if (!isObj(raw)) return fail("the request is not a Put away request");
  const bad = Object.keys(raw).find((k) => !KEYS.includes(k));
  if (bad !== undefined) return fail("the request has a field Put away does not take");
  const id = requestId(raw);
  if (!id) return fail("the request has no id");
  if (raw.source !== "backpack" && raw.source !== "inbox") return fail("the request names no source (backpack or inbox)");
  const { character, requestedAt, clickedAt, at } = raw;
  if (typeof character !== "string" || !character || character.length > 64 || /\p{Cc}/u.test(character)) return fail("the request names no character");
  const t = typeof requestedAt === "string" && requestedAt.length <= 40 ? parseStamp(requestedAt) : NaN;
  if (!Number.isFinite(t) || now - t > MAX_AGE_MS || t - now > SKEW_MS) return fail("the request is too old: click Put away again");
  const c = typeof clickedAt === "string" && clickedAt.length <= 40 ? parseStamp(clickedAt) : NaN;
  if (!Number.isFinite(c) || c > t + SKEW_MS || t - c > MAX_RUN_MS) return fail("the request does not say when Put away was clicked");
  if (!isObj(at) || Object.keys(at).some((k) => k !== "x" && k !== "y" && k !== "facet") || !isInt(at.x, 0, 7168) || !isInt(at.y, 0, 4096)
    || (at.facet !== undefined && !isInt(at.facet, 0, 5))) return fail("the request does not say where you stand");
  return { ok: true, request: { id, source: raw.source, character, requestedAt: requestedAt as string, clickedAt: clickedAt as string, at: { x: at.x, y: at.y, ...(at.facet !== undefined ? { facet: at.facet as number } : {}) } } };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

// What a Put away plan leaves and why, in a line short enough for the panel, never empty: what stays in the pack (bags,
// blessed or insured and pinned items, `kept`; what no rule claims, the catch-all claiming nothing from the backpack)
// or the Inbox, what belongs at another house than the one you stand in, what has no room, and (the Inbox) what is
// already home there.
export function nothingDetail(plan: Pick<Plan, "unclaimed" | "crossSite" | "rules">, source: PutAwaySource, kept: PackKept = { bags: 0, own: 0, pinned: 0 }): string {
  const cross = plan.crossSite.reduce((n, c) => n + c.count, 0);
  const noRoom = plan.rules.reduce((n, r) => n + r.noRoom, 0), home = plan.rules.reduce((n, r) => n + r.inPlace, 0);
  const stay = [[kept.own, `${kept.own} blessed/insured`], [kept.bags, plural(kept.bags, "bag")], [kept.pinned, `${kept.pinned} pinned`],
    [plan.unclaimed, `${plan.unclaimed} with no rule`]].filter(([n]) => n) as [number, string][];
  const one = stay.length === 1 && stay[0]![0] === 1;
  const where = source === "inbox" ? "Inbox" : "pack";
  const line = [
    stay.length ? `${stay.map(([, t]) => t).join(", ")} ${one ? "stays" : "stay"} in your ${where}` : "",
    cross ? `${cross} for another house` : "",
    noRoom ? `${noRoom} with no room` : "",
    home ? `${home} already filed` : "",
  ].filter(Boolean).join(", ");
  return line || (source === "inbox" ? "The Inbox is empty." : "Nothing lies loose in your backpack.");
}

export const tripMsg = (items: number, left: number): string => `Putting away ${plural(items, "item")}${left ? `, ${left} more after` : ""}...`;
