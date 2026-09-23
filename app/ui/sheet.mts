// ui/sheet.mts — the character sheet (design spec 4.5), shared by the Characters screen and the Suit
// Builder's result panel: a KPI row (five resists against their caps, attributes, pools), the worn gear
// as slot tiles in fixed groups, the properties as key/value lists, the skills and a footnote. The
// before/after form ("now → after") is the same sheet with both numbers on every figure that moves.
// Built as DOM nodes, never an HTML string (Phase 7 security review, Area 2, Important 1): a scan file
// is attacker-controlled text, and a pasted "here's my suit" scan once turned into persistent
// HTML/CSS injection inside the app window through this builder.
import { totalsOf, resistSkillBonus } from "../vault-lib.mts";
import type { OptItem } from "../vault-lib.mts";
import { state } from "./store.mts";
import { el, label, slotLabel } from "./dom.mts";
import { rarityToken } from "./items.mts";
import { txt, box, badge, tag, meter, message } from "./components.mts";
import type { SkillEntry } from "./api-types.mts";

// The slot value the sheet needs out of a worn/candidate piece — both a full scanned Item (the
// Characters screen's worn set) and an optimizer OptItem (the builder's `suit`/`current`) carry these,
// so this is what `before`/`after` accept rather than either concrete type: Item's own
// `twoHanded: boolean` (required) isn't assignable to OptItem's `twoHanded?: true | undefined`, so a type
// naming both callers' real shapes has to omit it. `rarity` and `tags` are only on a scanned Item; a
// piece without them draws a plain tile. Assignable to totalsOf's parameter, since every field OptItem
// requires is present here.
export type SheetItem = Pick<OptItem, "serial" | "name" | "slot" | "props"> & { rarity?: string | null | undefined; tags?: string[] | undefined };
export type SheetAssignment = Partial<Record<string, SheetItem | null | undefined>>;
export interface SheetOptions {
  // A filled slot tile was clicked (or pressed from the keyboard): show that piece. Without it the tiles
  // still carry data-serial, so the page's hover tooltip works on them.
  onSlot?: ((item: SheetItem, tile: HTMLElement) => void) | undefined;
}

// ---------------------------------------------------------------- formatting (pure, unit-tested)
// How far a raw value is past its cap, for the "cap +2" badge: raw Fire 72 on a 70 cap is shown as 70.
export const capOver = (raw: number, cap: number): number => Math.max(0, raw - cap);
export function capBadgeText(raw: number, cap: number): string | null { const n = capOver(raw, cap); return n > 0 ? `cap +${n}` : null; }
// A meter is full and green once the value reaches its cap.
export const atCap = (value: number, cap: number | null | undefined): boolean => cap != null && cap > 0 && value >= cap;
// An attribute's split into the character's own points and the gear bonus: STR 110 with +8 from gear is
// "(102 + 8)", a −2 bonus "(62 − 2)", and no bonus says nothing.
export function bonusBreakdown(total: number, bonus: number): string {
  if (!bonus) return "";
  return `(${total - bonus} ${bonus > 0 ? "+" : "−"} ${Math.abs(bonus)})`;
}
// "18 → 22" when a value moves, the one number when it doesn't.
export const moveText = (b: number, a: number, suffix = ""): string => (b === a ? `${a}${suffix}` : `${b}${suffix} → ${a}${suffix}`);
// Up to two numbers a slot tile shows under the piece's name: the properties nearest their shard cap (a
// property with no cap is measured against 100), in the order the item lists them. Skill bonuses read
// "Magery +20". Bookkeeping keys the fold adds (tag penalty, pool sizes) are not properties.
const NOT_SHOWN = new Set(["tagPenalty", "stamPool", "manaPool", "hitsPool"]);
export function keyNumbers(props: Record<string, number>, caps: Record<string, number>, n = 2): string[] {
  const entries = Object.entries(props).filter(([k, v]) => !NOT_SHOWN.has(k) && Number.isFinite(v) && v > 0);
  const top = new Set([...entries].sort((x, y) => y[1] / (caps[y[0]] || 100) - x[1] / (caps[x[0]] || 100)).slice(0, n).map(([k]) => k));
  return entries.filter(([k]) => top.has(k)).map(([k, v]) => (k.startsWith("sk:") ? `${label(k).replace(/^\+/, "")} +${v}` : `${label(k)} ${v}`));
}
// Item flags as tags: cursed in danger, brittle and antique in warning, the rest neutral.
export const tagTone = (t: string): "bad" | "warn" | undefined => (t === "cursed" ? "bad" : t === "brittle" || t === "antique" ? "warn" : undefined);
export const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- the numbers
// The scan's own numbers, read defensively. The v2 schema types stats/maxes/skills (numbers, and a
// {value, cap} pair), so a validated scan always satisfies these — but a scan written before that bound
// existed is still on disk and still folded, and the render is where a wrong-typed value used to throw
// and take the Characters screen and the Suit Builder down with it (Area 2, Important 2).
const numOr0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

// [key, label, the --res-* token's suffix]
export const RESISTS: Array<[string, string, string]> = [["physResist", "Physical", "phys"], ["fireResist", "Fire", "fire"], ["coldResist", "Cold", "cold"], ["poisonResist", "Poison", "poison"], ["energyResist", "Energy", "energy"]];
// The Properties card: shard-capped figures in four groups (spec 4.5). [key, label, suffix].
export const SHEET_GROUPS: Array<[string, Array<[string, string, string?]>]> = [
  ["Casting", [["fc", "Faster Casting"], ["fcr", "Faster Cast Recovery"], ["sdi", "Spell Damage", "%"], ["lmc", "Lower Mana Cost", "%"], ["lrc", "Lower Reagent Cost", "%"], ["castingFocus", "Casting Focus", "%"]]],
  ["Combat", [["hci", "Hit Chance", "%"], ["dci", "Defense Chance", "%"], ["ssi", "Swing Speed", "%"], ["di", "Damage Increase", "%"], ["reflectPhys", "Reflect Damage", "%"]]],
  ["Regeneration", [["hpRegen", "Hits Regen"], ["stamRegen", "Stam Regen"], ["manaRegen", "Mana Regen"]]],
  ["Pools and other", [["hpi", "HP Increase"], ["stamInc", "Stam Increase"], ["manaInc", "Mana Increase"], ["enhancePotions", "Enhance Potions", "%"], ["luck", "Luck"]]],
];
// The worn-gear tiles, in fixed groups so every row has equal height and nothing is orphaned.
export const SLOT_GROUPS: Array<[string, string[]]> = [
  ["Armour", ["helmet", "neck", "chest", "arms", "hands", "legs"]],
  ["Weapons and jewellery", ["oneHanded", "twoHanded", "ring", "bracelet", "earrings", "talisman"]],
  ["Clothing", ["cloak", "robe", "shirt", "waist", "feet"]],
];
const FIXED_SLOTS = new Set(SLOT_GROUPS.flatMap(([, s]) => s));

// Resist caps are race-aware (an Elf's Energy cap of 75 on uoalive), read from the character's profile
// race (default human). rules.caps/raceCaps are loose records in the rules schema — cast at this one
// read, the same cast vault-lib.mts's effectiveProfile() uses.
function capsFor(name: string): { capOf: (k: string) => number | undefined; resistCap: (k: string) => number; race: string } {
  const rules = state.rules!;
  const caps = (rules.caps || {}) as Record<string, number>;
  const race = state.profiles?.characters?.[name]?.race || "human";
  return {
    capOf: (k) => caps[k],
    resistCap: (k) => (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race]?.[k] ?? caps[k] ?? 70,
    race,
  };
}
// Worn pieces the optimizer never touches (feet, robe, waist, earrings, a second chest-layer item) count
// on both sides of a before/after sheet.
function withExtras(name: string, before: SheetAssignment): (set: SheetAssignment) => SheetAssignment {
  const inSuit = new Set(Object.values(before).filter(Boolean).map((x) => (x as SheetItem).serial));
  const extra = (state.inv!.worn[name] || []).filter((i) => !inSuit.has(i.serial));
  return (set) => ({ ...set, ...Object.fromEntries(extra.map((i) => ["_x" + i.serial, i])) });
}
export interface ResistFigure { key: string; label: string; cls: string; cap: number; raw: number; value: number }
// A character's paperdoll resists in one suit: gear totals plus the Resisting Spells bonus, capped per
// resist (raw keeps the uncapped sum for the "cap +N" badge). The roster and the sheet both read these.
export function resistFigures(name: string, set: SheetAssignment): ResistFigure[] {
  const { resistCap } = capsFor(name);
  const t = totalsOf(withExtras(name, set)(set));
  const rsb = resistSkillBonus(state.inv!.characters[name]?.skills);
  return RESISTS.map(([key, lbl, cls]) => { const cap = resistCap(key), raw = (t[key] || 0) + rsb; return { key, label: lbl, cls, cap, raw, value: Math.min(cap, raw) }; });
}
// The character's worn set keyed by serial — the one-suit sheet's `before`.
export function wornSet(name: string): SheetAssignment {
  return Object.fromEntries((state.inv!.worn[name] || []).map((i) => [String(i.serial), i]));
}

function kvList(pairs: Array<[string, Node]>, cls = ""): HTMLDivElement {
  return box("div", { class: `kv${cls ? " " + cls : ""}` }, ...pairs.flatMap(([k, v]) => [box("div", { class: "kv-k" }, txt(k)), box("div", { class: "kv-v" }, v)]));
}

// ---------------------------------------------------------------- the sheet
// sheetNode(name, before, after, opts) — `after` null draws the one-suit sheet (the Characters screen);
// with an `after` every figure that moves reads "now → after" and the tiles show the `after` suit, its
// new pieces badged. Only called once load() has populated state.inv/state.rules.
export function sheetNode(name: string, before: SheetAssignment, after: SheetAssignment | null, opts: SheetOptions = {}): HTMLElement {
  const single = after == null;
  const then = after ?? before;
  const c = state.inv!.characters[name];
  const { capOf, resistCap, race } = capsFor(name);
  const extras = withExtras(name, before);
  const b = totalsOf(extras(before)), a = totalsOf(extras(then));
  const d = (k: string): number => (a[k] || 0) - (b[k] || 0);
  const rsb = resistSkillBonus(c?.skills);
  // the after number's colour is never the only signal: the arrow and both numbers say it too
  const dirCls = (n: number): string => (single || n === 0 ? "" : n > 0 ? "up" : "down");

  // KPI row: five resists, then attributes and pools
  const resistTiles = RESISTS.map(([k, lbl, cls]) => {
    const cap = resistCap(k), rawB = (b[k] || 0) + rsb, rawA = (a[k] || 0) + rsb;
    const vb = Math.min(cap, rawB), va = Math.min(cap, rawA), full = atCap(va, cap), over = capBadgeText(rawA, cap);
    return box("div", { class: `resist kpi tint tint-${cls}${full ? " at-cap" : ""}` },
      txt(lbl, `t-sm resist-name res-${cls}`),
      box("span", { class: "kpi-value" }, vb === va ? null : txt(`${vb} →`, "muted"), txt(va, `t-2xl ${dirCls(va - vb)}`.trim()), txt(`/ ${cap}`, "muted"), over ? badge(over, "ok") : null),
      meter(va, cap, { tone: full ? "ok" : undefined, label: `${lbl} resist ${va} of ${cap}` }));
  });
  // attributes: the scan's stats are totals with the current suit on; own points = total − current bonus
  const st = (c?.stats || {}) as Record<string, unknown>;
  const attrs = kvList(([["str", "STR", "strBonus"], ["dex", "DEX", "dexBonus"], ["int", "INT", "intBonus"]] as Array<[string, string, string]>).map(([k, lbl, pk]): [string, Node] => {
    const total = numOr0(st[k]), own = total - (b[pk] || 0), next = own + (a[pk] || 0), split = bonusBreakdown(next, a[pk] || 0);
    return [lbl, el("span", { class: dirCls(next - total) }, moveText(total, next), split ? " " : "", split ? txt(split, "muted") : null)];
  }), "kv-tight");
  const mx = (c?.maxes || {}) as Record<string, unknown>;
  const pools = kvList(([["hits", "Hits", () => Math.floor(d("strBonus") / 2) + d("hpi")], ["stam", "Stamina", () => d("dexBonus") + d("stamInc")], ["mana", "Mana", () => d("intBonus") + d("manaInc")]] as Array<[string, string, () => number]>).map(([k, lbl, f]): [string, Node] => {
    const dd = f(), cur = numOrNull(mx[k]);
    return [lbl, txt(cur == null ? "?" : moveText(cur, cur + dd), dirCls(dd))];
  }), "kv-tight");
  const kpis = box("div", { class: "sheet-kpis" }, ...resistTiles,
    box("div", { class: "resist kpi kpi-list" }, txt("Attributes", "t-sm muted"), attrs),
    box("div", { class: "resist kpi kpi-list" }, txt("Pools", "t-sm muted"), pools));

  // worn gear: the shown suit plus the extras, one tile per fixed slot, anything else under "Other"
  const bySlot = new Map<string, SheetItem>(), other: SheetItem[] = [];
  const nowSerials = new Set(Object.values(extras(before)).filter(Boolean).map((x) => (x as SheetItem).serial));
  for (const it of Object.values(extras(then))) {
    if (!it) continue;
    if (it.slot && FIXED_SLOTS.has(it.slot) && !bySlot.has(it.slot)) bySlot.set(it.slot, it); else other.push(it);
  }
  const caps = (state.rules?.caps || {}) as Record<string, number>;
  const tile = (slot: string | null, it: SheetItem | undefined, small: boolean): HTMLElement => {
    const head = txt(slot ? slotLabel(slot) : "Other", "t-sm muted");
    if (!it) return box("div", { class: `slot empty${small ? " slot-sm" : ""}` }, head, txt("Empty", "faint"));
    const token = rarityToken(it.rarity);
    const nums = keyNumbers(it.props || {}, caps), tags = (it.tags || []).slice(0, 2);
    const isNew = !single && !nowSerials.has(it.serial);
    const t = box("button", { type: "button", class: `slot${small ? " slot-sm" : ""}`, "data-serial": it.serial, ...(token ? { style: `border-color:var(${token})` } : {}) },
      isNew ? box("span", { class: "slot-head" }, head, badge("New", "accent")) : head,
      txt(it.name, "nm"),
      tags.length || nums.length ? box("span", { class: "slot-meta t-sm" }, ...tags.map((x) => tag(x, tagTone(x))), nums.length ? txt(nums.join(" · "), "muted") : null) : null);
    if (opts.onSlot) t.addEventListener("click", () => opts.onSlot!(it, t));
    return t;
  };
  const groups = SLOT_GROUPS.map(([title, slots]) => box("div", { class: "slot-group" }, txt(title, "caps"),
    box("div", { class: `slot-grid${slots.length === 5 ? " slot-grid-5" : ""}` }, ...slots.map((s) => tile(s, bySlot.get(s), slots.length === 5)))));
  if (other.length) groups.push(box("div", { class: "slot-group" }, txt("Other", "caps"), box("div", { class: "slot-grid" }, ...other.map((it) => tile(it.slot, it, false)))));
  const gear = el("section", { class: "card", "aria-label": "Worn gear" },
    box("div", { class: "card-head" }, el("h2", {}, "Worn gear"), txt(`${bySlot.size} of ${FIXED_SLOTS.size} slots`, "t-sm muted"), el("span", { class: "spacer" }), opts.onSlot ? txt("Click a slot for the item detail", "t-sm muted") : null),
    box("div", { class: "sheet-slots" }, ...groups));

  // properties: value / shard cap, the caps muted
  const propGroups = SHEET_GROUPS.map(([title, keys]) => box("div", { class: "prop-group" }, txt(title, "caps"),
    kvList(keys.map(([k, lbl, suf = ""]): [string, Node] => {
      const bv = b[k] || 0, av = a[k] || 0, cap = capOf(k);
      return [lbl, el("span", { class: dirCls(av - bv) }, moveText(bv, av, suf), cap != null ? " " : "", cap != null ? txt(`/ ${cap}`, "muted") : null)];
    }))));
  // skills: c.skills is Record<string, unknown> (a scan written before the {value, cap} bound is still
  // folded), sorted and rendered through numOr0, so a wrong-typed entry costs that one number. The
  // shard's free skills (outside the skill cap, rules.freeSkills) this character has are named below.
  const skills = Object.entries((c?.skills || {}) as Record<string, Partial<SkillEntry> | undefined>).sort((x, y) => numOr0(y[1]?.value) - numOr0(x[1]?.value));
  const skillRows = skills.map(([n, v]): [string, Node] => [n, el("span", {}, numOr0(v?.value).toFixed(1), " ", txt(`/ ${numOr0(v?.cap).toFixed(1)}`, "muted"))]);
  const half = Math.ceil(skillRows.length / 2);
  const free = (state.rules?.freeSkills || []).filter((n) => skills.some(([s, v]) => s === n && numOr0(v?.value) > 0));
  const skillBlock = skills.length
    ? box("div", { class: "prop-group" }, txt("Skills", "caps"),
      box("div", { class: "sheet-props-2" }, kvList(skillRows.slice(0, half)), skillRows.length > 1 ? kvList(skillRows.slice(half)) : null),
      free.length ? txt(`Free skills (outside the skill cap): ${free.join(", ")}`, "t-sm muted") : null)
    : message({ tone: "info", text: `Skills weren't in this scan. Rescan ${name} in game to record them.` });
  const raceNote = race !== "human" ? ` (${race[0]!.toUpperCase()}${race.slice(1)} racial caps may raise this for some resists)` : "";
  const note = `Resists include the Resisting Spells bonus (+${rsb}) and are capped at ${resistCap("physResist")}${raceNote}.` +
    (single ? "" : " Hits, Stamina and Mana after = the current max plus the change in STR/2, DEX, INT and the HP, Stamina and Mana Increase properties (an estimate).");
  const props = el("section", { class: "card", "aria-label": "Properties" },
    box("div", { class: "card-head" }, el("h2", {}, "Properties"), el("span", { class: "spacer" }), txt(single ? "value / shard cap" : "now → after / shard cap", "t-sm muted")),
    box("div", { class: "sheet-props" }, ...propGroups),
    box("div", { class: "sheet-foot" }, skillBlock, el("p", { class: "t-sm muted" }, txt(note))));

  return box("div", { class: `sheet${single ? "" : " sheet-diff"}`, "data-character": name }, kpis, box("div", { class: "sheet-cols" }, gear, props));
}
