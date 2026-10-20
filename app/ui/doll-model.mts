// ui/doll-model.mts — what a doll card (issue #57) shows, as data: the figure's GET /api/paperdoll.png address, whether it is a stand-in and why, and the message under or in place of the figure. Pure, so a node test covers it.
//
// map: house
// owns: `dollUrl`, `dollPlan`, `failureNote`, `dollRequests`, `wornPieces`, `DOLL_REASONS`, `DollNote`, `DollPlan`
import { lookOf, type Look, type Worn } from "../paperdoll-look.mts";

const piece = (w: Worn): string => `${w.graphic}:${w.hue}`;
// The figure's address: the look, the worn pieces, the other figure of a side-by-side pair (`pair`, null when shown alone) and the stand-in's gray.
export function dollUrl(look: Look, worn: readonly Worn[], pair: readonly Worn[] | null, gray: boolean): string {
  const q = new URLSearchParams({ body: String(look.body), hue: String(look.hue) });
  for (const k of ["hair", "beard", "face"] as const) { const w = look[k]; if (w) q.set(k, piece(w)); }
  q.set("worn", worn.map(piece).join(","));
  if (pair) q.set("pair", pair.map(piece).join(","));
  if (gray) q.set("gray", "1");
  return `/api/paperdoll.png?${q.toString().replace(/%3A/g, ":").replace(/%2C/g, ",")}`;
}

// The pieces a figure wears: each one's graphic and hue (a piece with no graphic, from a scan that did not record one, is left out). The server takes each one's layer from tiledata.
export function wornPieces(pieces: ReadonlyArray<{ graphic?: number | null | undefined; hue?: number | null | undefined }>): Worn[] {
  return pieces.flatMap((it) => (it.graphic != null ? [{ graphic: it.graphic, hue: it.hue ?? 0 }] : []));
}

// A message the card shows. Each button opens Settings at the part it names: the UO folder card (`uofolder`) or the Game client's scanner row (`scanner`, where the scanner is reinstalled or copied; the app has no separate scan guide). The first is the primary one.
export interface DollNote { tone: "info" | "warn"; title: string; text?: string; actions?: Array<{ label: string; to: "uofolder" | "scanner" }> }
// What a card draws for a character (`name` null for no character): the look to draw, whether it is the stand-in (drawn gray), and the note under it. A look the player customized (`custom`) is drawn in color in its place; a stand-in keeps its note.
export interface DollPlan { look: Look; gray: boolean; note: DollNote | null }
// `inForm`: the newest scan was taken in a form, so `appearance` is an earlier scan's look (or the form's, when no scan has another).
export function dollPlan(o: { name: string | null; appearance: Look | null | undefined; inForm?: boolean | undefined; readsLook: boolean; client: string; custom?: Look | null | undefined }): DollPlan {
  const plan = basePlan(o);
  return o.custom ? { ...plan, look: o.custom, gray: false } : plan;
}
function basePlan({ name, appearance, inForm, readsLook, client }: { name: string | null; appearance: Look | null | undefined; inForm?: boolean | undefined; readsLook: boolean; client: string }): DollPlan {
  if (name === null) return { look: lookOf(null).look, gray: true, note: { tone: "info", title: "No character is chosen, so the suit is shown on a stand-in body." } };
  const { look, standIn } = lookOf(appearance);
  if (standIn === "form") return { look, gray: true, note: { tone: "info", title: `${name} was in another form when scanned.`, text: "Scan again in their own form to show their look." } };
  if (standIn === "none") {
    return readsLook
      ? { look, gray: true, note: { tone: "info", title: `Rescan to show ${name}'s look`, text: "The figure is a stand-in: this scan has no body, skin or hair yet. Update the scanner scripts if Settings offers a newer one, then scan again in game.", actions: [{ label: "How to rescan", to: "scanner" }] } }
      : { look, gray: true, note: { tone: "info", title: `${client}'s scripts can't read your character's look, so the figure is a stand-in.` } };
  }
  return { look, gray: false, note: inForm ? { tone: "info", title: "In another form when last scanned." } : null };
}

// GET /api/paperdoll.png's 404 reasons, and "error" for a request that failed.
export const DOLL_REASONS = ["no-client", "no-tazuo-profile", "override-missing", "missing", "unsupported", "unreadable", "no-body", "empty", "error"] as const;
export type DollReason = (typeof DOLL_REASONS)[number];
// Why there is no figure, shown in its place.
export function failureNote(reason: DollReason): DollNote {
  switch (reason) {
    case "unsupported":
      return { tone: "warn", title: "This client's files aren't supported yet", text: "Pack Rat reads the 7.x client files (gumpartLegacyMUL.uop and a 7.x tiledata.mul). The folder you chose holds an older layout.", actions: [{ label: "Choose another folder", to: "uofolder" }] };
    case "unreadable":
      return { tone: "warn", title: "Your client files couldn't be read", text: "They may be damaged, or another program has them open. Try again, or choose another UO folder.", actions: [{ label: "Choose another folder", to: "uofolder" }] };
    case "empty":
      return { tone: "warn", title: "Nothing could be drawn", text: "Your client files have none of this figure's pieces.", actions: [{ label: "Check the UO folder", to: "uofolder" }] };
    case "error": case "no-body":
      return { tone: "warn", title: "The figure couldn't be drawn", text: "Pack Rat couldn't read the figure from your client files. Try again, or check the UO folder in Settings › Game client.", actions: [{ label: "Open Settings", to: "uofolder" }] };
    default:
      return { tone: "warn", title: "Pack Rat couldn't find your Ultima Online client files", text: "Choose your UO folder in Settings › Game client. Playing in the web client? Download UO Alive's free client package and point Pack Rat at it; you don't have to play on it.", actions: [{ label: "Choose UO folder", to: "uofolder" }, { label: "Why?", to: "uofolder" }] };
  }
}

// The card's requests, newest wins: `start(key)` gives a new request's number, or null when `key` is the one last asked for (painted or on its way), so asking again for what is coming changes nothing while asking for anything else, the figure on screen included, starts over. `settle(n, ok)` says whether answer `n` is still the newest; a failed one is forgotten, so the same key asks again next time (after the UO folder is set, say).
export function dollRequests(): { start: (key: string) => number | null; settle: (n: number, ok: boolean) => boolean } {
  let requested: string | null = null, seq = 0;
  return {
    start(key) { if (key === requested) return null; requested = key; return ++seq; },
    settle(n, ok) { if (n !== seq) return false; if (!ok) requested = null; return true; },
  };
}
