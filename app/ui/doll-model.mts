// ui/doll-model.mts — what a doll card (issue #57) shows, as data: the figure's GET /api/paperdoll.png address, whether it is a stand-in and why, and the message under or in place of the figure. Pure, so a node test covers it.
//
// map: house
// owns: `dollUrl`, `dollPlan`, `failureNote`, `DOLL_REASONS`, `DollNote`, `DollPlan`
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

// A message the card shows. Its buttons all open Settings › Game client, where the UO folder is chosen and the scripts reinstalled; the first is the primary one.
export interface DollNote { tone: "info" | "warn"; title: string; text?: string; actions?: string[] }
// What a card draws for a character (`name` null for no character): the look to draw, whether it is the stand-in (drawn gray), and the note under it.
export interface DollPlan { look: Look; gray: boolean; note: DollNote | null }
export function dollPlan({ name, appearance, readsLook, client }: { name: string | null; appearance: Look | null | undefined; readsLook: boolean; client: string }): DollPlan {
  if (name === null) return { look: lookOf(null).look, gray: true, note: { tone: "info", title: "No character is chosen, so the suit is shown on a stand-in body." } };
  const { look, standIn } = lookOf(appearance);
  if (standIn === "form") return { look, gray: true, note: { tone: "info", title: `${name} was in another form when scanned.`, text: "Scan again in their own form to show their look." } };
  if (standIn === "none") {
    return readsLook
      ? { look, gray: true, note: { tone: "info", title: `Rescan to show ${name}'s look`, text: "The figure is a stand-in: this scan has no body, skin or hair yet.", actions: ["How to rescan"] } }
      : { look, gray: true, note: { tone: "info", title: `${client}'s scripts can't read your character's look, so the figure is a stand-in.` } };
  }
  return { look, gray: false, note: null };
}

// GET /api/paperdoll.png's 404 reasons, and "error" for a request that failed.
export const DOLL_REASONS = ["no-client", "no-tazuo-profile", "override-missing", "missing", "unsupported", "unreadable", "no-body", "empty", "error"] as const;
export type DollReason = (typeof DOLL_REASONS)[number];
// Why there is no figure, shown in its place.
export function failureNote(reason: DollReason): DollNote {
  switch (reason) {
    case "unsupported": case "unreadable": case "empty":
      return { tone: "warn", title: "This client's files aren't supported yet", text: "Pack Rat reads the 7.x client files (gumpartLegacyMUL.uop and a 7.x tiledata.mul). The folder you chose holds an older layout.", actions: ["Choose another folder"] };
    case "error": case "no-body":
      return { tone: "warn", title: "The figure couldn't be drawn", text: "Pack Rat couldn't read the figure from your client files. Try again, or check the UO folder in Settings › Game client.", actions: ["Open Settings"] };
    default:
      return { tone: "warn", title: "Pack Rat couldn't find your Ultima Online client files", text: "Choose your UO folder in Settings › Game client. Playing in the web client? Download UO Alive's free client package and point Pack Rat at it; you don't have to play on it.", actions: ["Choose UO folder", "Why?"] };
  }
}
