// ui/sheet.mts — the character sheet (design spec 4.5), shared by the Characters screen and the Suit
// Builder's result panel: a KPI row (five resists against their caps, attributes, pools), the worn gear
// as slot tiles in fixed groups, the properties as key/value lists, the skills and a footnote. The
// before/after form ("now → after") is the same sheet with both numbers on every figure that moves.
// Built as DOM nodes, never an HTML string (Phase 7 security review, Area 2, Important 1): a scan file
// is attacker-controlled text, and a pasted "here's my suit" scan once turned into persistent
// HTML/CSS injection inside the app window through this builder.
import { totalsOf, resistSkillBonus, PROP_FULL } from "../vault-lib.mts";
import type { ExtrasMap, OptItem, ResistCap } from "../vault-lib.mts";
import { state } from "./store.mts";
import { el, itemTip, label, slotLabel, toast } from "./dom.mts";
import { api } from "./api.mts";
import { rarityToken } from "./items.mts";
import { txt, box, badge, tag, meter, message, button, check, searchInput, popover } from "./components.mts";
import type { SkillEntry } from "./api-types.mts";
import { capNote } from "./builder-model.mts";
import { STAT_MAX } from "../buffs.mts";

// The slot value the sheet needs out of a worn/candidate piece — both a full scanned Item (the
// Characters screen's worn set) and an optimizer OptItem (the builder's `suit`/`current`) carry these,
// so this is what `before`/`after` accept rather than either concrete type: Item's own
// `twoHanded: boolean` (required) isn't assignable to OptItem's `twoHanded?: true | undefined`, so a type
// naming both callers' real shapes has to omit it. `rarity` and `tags` are only on a scanned Item; a
// piece without them draws a plain tile. `extras` (a scanned Item's durability) drives the low-durability badge. Assignable to totalsOf's parameter, since every field OptItem
// requires is present here.
export type SheetItem = Pick<OptItem, "serial" | "name" | "slot" | "props"> & { rarity?: string | null | undefined; tags?: string[] | undefined; extras?: ExtrasMap | undefined };
export type SheetAssignment = Partial<Record<string, SheetItem | null | undefined>>;
export interface SheetOptions {
  // A filled slot tile was clicked (or pressed from the keyboard): show that piece. Without it the tiles
  // still show the page's item tooltip (dom.mts's itemTip), on hover and on keyboard focus.
  onSlot?: ((item: SheetItem, tile: HTMLElement) => void) | undefined;
  // The Suit Builder's now → after sheet: the resist caps its build used, the player's overrides included. The
  // Characters screen passes none and shows the shard's caps.
  resistCaps?: Record<string, ResistCap> | undefined;
  // false: an `after` suit drawn with its own figures only, no "now → after" (the Suit Builder's Manual stats card,
  // where `before` is only the base the attributes are worked out from).
  compare?: boolean | undefined;
  // true: no resist tiles and no worn gear card, for a caller that draws neither (the Suit Builder's Manual stats card),
  // and the footnote says nothing about resists.
  statsOnly?: boolean | undefined;
  // The Suit Builder's Manual buffs (app/buffs.mts): what they add to the `after` suit's totals, counted in its
  // attributes (each held to STAT_MAX), pools and properties, and the caps they change.
  buffs?: Record<string, number> | undefined;
  caps?: Record<string, number> | undefined;
}

// ---------------------------------------------------------------- formatting (pure, unit-tested)
// How far a raw value is past its cap, for the "cap +2" badge: raw Fire 72 on a 70 cap is shown as 70.
export const capOver = (raw: number, cap: number): number => Math.max(0, raw - cap);
export function capBadgeText(raw: number, cap: number): string | null { const n = capOver(raw, cap); return n > 0 ? `cap +${n}` : null; }
// A meter is full and green once the value reaches its cap.
export const atCap = (value: number, cap: number | null | undefined): boolean => cap != null && cap > 0 && value >= cap;
// An attribute's split into the character's own points, the gear bonus and the buffs' share: STR 110 with +8 from gear
// is "(102 + 8)", a −2 bonus "(62 − 2)", with 17 from buffs "(85 + 8 + 17 buffs)", and no bonus says nothing.
export function bonusBreakdown(total: number, bonus: number, buffs = 0): string {
  if (!bonus && !buffs) return "";
  const part = (n: number, word = ""): string => ` ${n > 0 ? "+" : "−"} ${Math.abs(n)}${word}`;
  return `(${total - bonus - buffs}${bonus ? part(bonus) : ""}${buffs ? part(buffs, " buffs") : ""})`;
}
// "18 → 22" when a value moves, the one number when it doesn't.
// The pools' change for a suit: Hits by STR / 2 and HP Increase, Stamina by DEX and Stamina Increase, Mana by INT and
// Mana Increase (`d`: what each moves by), plus a buff's own Hits, Stamina or Mana, which is added past the HPI cap
// (`buffs`: Animal Form's +20 Hits). `over` is what a stat passes STAT_MAX by: points past it raise no pool.
export function poolChanges(d: Record<string, number>, buffs: Record<string, number>, over: { str: number; dex: number; int: number }): { hits: number; stam: number; mana: number } {
  const v = (m: Record<string, number>, k: string): number => m[k] || 0;
  return { hits: Math.floor((v(d, "strBonus") - over.str) / 2) + v(d, "hpi") + v(buffs, "hitsPool"),
    stam: v(d, "dexBonus") - over.dex + v(d, "stamInc") + v(buffs, "stamPool"),
    mana: v(d, "intBonus") - over.int + v(d, "manaInc") + v(buffs, "manaPool") };
}
export const moveText = (b: number, a: number, suffix = ""): string => (b === a ? `${a}${suffix}` : `${b}${suffix} → ${a}${suffix}`);
// Up to two numbers a slot tile shows under the piece's name: the properties nearest their shard cap (a
// property with no cap is measured against 100), in the order the item lists them. Skill bonuses read
// "Magery +20". Bookkeeping keys the fold adds (tag penalty, pool sizes) are not properties.
const NOT_SHOWN = new Set(["tagPenalty", "stamPool", "manaPool", "hitsPool", "psLevel", "sotPoints"]);
export function keyNumbers(props: Record<string, number>, caps: Record<string, number>, n = 2): string[] {
  const entries = Object.entries(props).filter(([k, v]) => !NOT_SHOWN.has(k) && Number.isFinite(v) && v > 0);
  const top = new Set([...entries].sort((x, y) => y[1] / (caps[y[0]] || 100) - x[1] / (caps[x[0]] || 100)).slice(0, n).map(([k]) => k));
  return entries.filter(([k]) => top.has(k)).map(([k, v]) => (k.startsWith("sk:") ? `${label(k).replace(/^\+/, "")} +${v}` : `${label(k)} ${v}`));
}
// Item flags as tags: cursed in danger, brittle and antique in warning, the rest neutral.
export const tagTone = (t: string): "bad" | "warn" | undefined => (t === "cursed" ? "bad" : t === "brittle" || t === "antique" ? "warn" : undefined);
export const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;
// Durability watch (issue #98): a worn piece is low once its durability is at 20% of its max or at 10
// points, so it can be repaired before it breaks mid-fight. The scan's "Durability 12 / 255" line is
// extras.durability; no line, a max of 0, or a piece at (or past) its max, which no repair would raise, is
// never low. Returns the tile's badge text, or null.
export const LOW_DURABILITY_SHARE = 0.2, LOW_DURABILITY_POINTS = 10;
export function lowDurability(it: { extras?: ExtrasMap | undefined }): string | null {
  const d = it.extras?.durability;
  if (!Array.isArray(d)) return null;
  const [current, max] = d;
  return current < max && (current / max <= LOW_DURABILITY_SHARE || current <= LOW_DURABILITY_POINTS) ? `Low durability ${current}/${max}` : null;
}
export const lowDurabilityCount = (worn: Array<{ extras?: ExtrasMap | undefined }>): number => worn.filter((it) => lowDurability(it)).length;
export const lowDurabilitySummary = (n: number): string | null => (n ? `${plural(n, "worn piece")} ${n === 1 ? "is" : "are"} low on durability` : null);

// ---------------------------------------------------------------- the numbers
// The scan's own numbers, read defensively. The v2 schema types stats/maxes/skills (numbers, and a
// {value, cap} pair), so a validated scan always satisfies these — but a scan written before that bound
// existed is still on disk and still folded, and the render is where a wrong-typed value used to throw
// and take the Characters screen and the Suit Builder down with it (Area 2, Important 2).
const numOr0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

// [key, label, the --res-* token's suffix]
export const RESISTS: Array<[string, string, string]> = [["physResist", "Physical", "phys"], ["fireResist", "Fire", "fire"], ["coldResist", "Cold", "cold"], ["poisonResist", "Poison", "poison"], ["energyResist", "Energy", "energy"]];
// The Properties card's groups (spec 4.5), every row shown until the player picks otherwise. [key, label, suffix].
type SheetRow = [string, string, string?];
export const SHEET_GROUPS: Array<[string, SheetRow[]]> = [
  ["Casting", [["fc", "Faster Casting"], ["fcr", "Faster Cast Recovery"], ["sdi", "Spell Damage", "%"], ["lmc", "Lower Mana Cost", "%"], ["lrc", "Lower Reagent Cost", "%"], ["castingFocus", "Casting Focus", "%"]]],
  ["Combat", [["hci", "Hit Chance", "%"], ["dci", "Defense Chance", "%"], ["ssi", "Swing Speed", "%"], ["di", "Damage Increase", "%"], ["reflectPhys", "Reflect Damage", "%"]]],
  ["Leech", [["hitLifeLeech", "Hit Life Leech", "%"], ["hitManaLeech", "Hit Mana Leech", "%"], ["hitStamLeech", "Hit Stamina Leech", "%"]]],
  ["Regeneration", [["hpRegen", "Hits Regen"], ["stamRegen", "Stam Regen"], ["manaRegen", "Mana Regen"]]],
  ["Pools and other", [["hpi", "HP Increase"], ["stamInc", "Stam Increase"], ["manaInc", "Mana Increase"], ["enhancePotions", "Enhance Potions", "%"], ["luck", "Luck"]]],
];
export const DEFAULT_SHEET_PROPS = SHEET_GROUPS.flatMap(([, rows]) => rows.map(([k]) => k));
// Everything the card can list: the groups above, then under "Other" each further property the tooltip
// reader knows (vault-lib's PROP_FULL), less the resists (the KPI row) and the fold's bookkeeping keys.
export const SHEET_CATALOGUE: Array<[string, SheetRow[]]> = [...SHEET_GROUPS, ["Other", Object.keys(PROP_FULL)
  .filter((k) => !DEFAULT_SHEET_PROPS.includes(k) && !NOT_SHOWN.has(k) && !RESISTS.some(([r]) => r === k))
  .map((k): SheetRow => [k, PROP_FULL[k]!, k.startsWith("hit") ? "%" : ""])]];
const CATALOGUE_KEYS = SHEET_CATALOGUE.flatMap(([, rows]) => rows.map(([k]) => k));
// The rows shown: the saved choice (ui-prefs `sheetProps`, set by app.mts's load) or the default set.
const shownProps = (): Set<string> => new Set(state.sheetProps ?? DEFAULT_SHEET_PROPS);
// The "Properties shown" popover: the catalogue as grouped checkboxes with a search box. A change is
// saved to ui-prefs (only catalogue keys, so an unknown saved key is dropped) and redraws the card.
function openPropsPicker(anchor: HTMLElement, redraw: () => void): void {
  const count = txt("", "t-sm muted");
  const paintCount = (): void => { count.textContent = `${CATALOGUE_KEYS.filter((k) => shownProps().has(k)).length} of ${CATALOGUE_KEYS.length}`; };
  const choose = (keys: string[]): void => {
    state.sheetProps = keys;
    api("/api/ui-prefs", { method: "PUT", body: { sheetProps: keys } }).catch((e: Error) => toast(`Could not save the properties shown: ${e.message}`, "bad"));
    redraw(); paintCount();
  };
  const find = searchInput({ label: "Find a property", placeholder: "Find a property" });
  find.input.classList.add("input-sm");
  const list = box("div", { class: "inv-opts", id: "sheet-prop-opts" });
  const draw = (): void => {
    const shown = shownProps(), q = find.input.value.trim().toLowerCase();
    const kids = SHEET_CATALOGUE.flatMap(([title, rows]) => {
      const hits = rows.filter(([, lbl]) => lbl.toLowerCase().includes(q));
      return hits.length ? [txt(title, "inv-opt-group t-sm muted"), ...hits.map(([k, lbl]) => {
        const c = check({ label: lbl, checked: shown.has(k), attrs: { value: k }, onChange: (on) => {
          const next = shownProps();
          if (on) next.add(k); else next.delete(k);
          choose(CATALOGUE_KEYS.filter((x) => next.has(x)));
        } });
        c.root.classList.add("inv-opt");
        return c.root;
      })] : [];
    });
    list.replaceChildren(...(kids.length ? kids : [txt("No property matches.", "t-sm muted")]));
  };
  find.input.addEventListener("input", draw);
  paintCount(); draw();
  const h = popover(anchor, [
    box("div", { class: "inv-pop-sec" }, box("div", { class: "inv-pop-head" }, txt("Properties shown", "caps"), el("span", { class: "spacer" }), count), find.root),
    list,
    box("div", { class: "overlay-foot inv-pop-foot" },
      button({ label: "Reset to default", variant: "ghost", size: "sm", onClick: () => { choose([...DEFAULT_SHEET_PROPS]); draw(); } }),
      el("span", { class: "spacer" }),
      button({ label: "Done", size: "sm", onClick: () => h.close() })),
  ], { label: "Properties shown", width: 288 });
  h.root.classList.add("inv-pop", "inv-settings-pop");
}
// The worn-gear tiles, in fixed groups so every row has equal height and nothing is orphaned.
export const SLOT_GROUPS: Array<[string, string[]]> = [
  ["Armor", ["helmet", "neck", "chest", "arms", "hands", "legs"]],
  ["Weapons and jewelry", ["oneHanded", "twoHanded", "ring", "bracelet", "earrings", "talisman"]],
  ["Clothing", ["cloak", "robe", "tunic", "shirt", "waist", "feet"]],
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
  const { resists, lists, gear, props } = sheetParts(name, before, after, opts);
  return box("div", { class: `sheet${after != null && opts.compare !== false ? " sheet-diff" : ""}`, "data-character": name },
    box("div", { class: "sheet-kpis" }, ...resists, ...lists), box("div", { class: "sheet-cols" }, gear, props));
}
// The sheet's parts: the KPI row's five resist tiles and its Attributes and Pools lists, the worn gear card and the
// properties card (with the skills). The Suit Builder's Manual mode draws the lists and the properties for its suit;
// with no character (`name` null) they are the items' own totals, the attributes and pools "—" and no skills.
export function sheetParts(name: string | null, before: SheetAssignment, after: SheetAssignment | null, opts: SheetOptions = {}): { resists: HTMLElement[]; lists: HTMLElement[]; gear: HTMLElement | null; props: HTMLElement } {
  const single = after == null, diff = !single && opts.compare !== false;
  const then = after ?? before;
  const c = name ? state.inv!.characters[name] : undefined;
  const { capOf: shardCap, race } = capsFor(name ?? "");
  const capOf = (k: string): number | undefined => opts.caps?.[k] ?? shardCap(k);
  const resistCap = (k: string): number => opts.resistCaps?.[k]?.cap ?? capsFor(name ?? "").resistCap(k);
  // a build's override, said on its tile and in the footnote: "cap raised from 70"
  const override = (k: string): ResistCap | null => { const c = opts.resistCaps?.[k]; return c && c.cap !== c.shard ? c : null; };
  const extras = withExtras(name ?? "", before);
  const b = totalsOf(extras(before)), gear = totalsOf(extras(then)), bf = opts.buffs || {};
  const a: Record<string, number> = { ...gear };
  for (const [k, v] of Object.entries(bf)) a[k] = (a[k] || 0) + v;
  const d = (k: string): number => (a[k] || 0) - (b[k] || 0);
  const rsb = resistSkillBonus(c?.skills);
  // the after number's colour is never the only signal: the arrow and both numbers say it too
  const dirCls = (n: number): string => (!diff || n === 0 ? "" : n > 0 ? "up" : "down");
  const mv = (bv: number | string, av: number | string, suffix = ""): string => (diff ? moveText(bv as number, av as number, suffix) : `${av}${suffix}`);

  // KPI row: five resists, then attributes and pools
  const resistTiles = opts.statsOnly ? [] : RESISTS.map(([k, lbl, cls]) => {
    const cap = resistCap(k), rawB = (b[k] || 0) + rsb, rawA = (a[k] || 0) + rsb;
    const vb = Math.min(cap, rawB), va = Math.min(cap, rawA), full = atCap(va, cap), over = capBadgeText(rawA, cap);
    return box("div", { class: `resist kpi tint tint-${cls}${full ? " at-cap" : ""}` },
      txt(lbl, `t-sm resist-name res-${cls}`),
      box("span", { class: "kpi-value" }, vb === va || !diff ? null : txt(`${vb} →`, "muted"), txt(va, `t-2xl ${dirCls(va - vb)}`.trim()), txt(`/ ${cap}`, "muted"), over ? badge(over, "ok") : null),
      meter(va, cap, { tone: full ? "ok" : undefined, label: `${lbl} resist ${va} of ${cap}` }),
      override(k) ? txt(`cap ${capNote(override(k)!)}`, "t-sm muted") : null);
  });
  // attributes: the scan's stats are totals with the current suit on; own points = total − current bonus
  const st = (c?.stats || {}) as Record<string, unknown>;
  const STATS: Array<["str" | "dex" | "int", string, string]> = [["str", "STR", "strBonus"], ["dex", "DEX", "dexBonus"], ["int", "INT", "intBonus"]];
  const statAfter = (k: string, pk: string): number => numOr0(st[k]) - (b[pk] || 0) + (a[pk] || 0);
  // with the buffs, a stat is held to the per-stat maximum, and what passes it is said (and raises no pool)
  const over = Object.fromEntries(STATS.map(([k, , pk]) => [k, opts.buffs ? Math.max(0, statAfter(k, pk) - STAT_MAX) : 0])) as Record<"str" | "dex" | "int", number>;
  const attrs = kvList(STATS.map(([k, lbl, pk]): [string, Node] => {
    const total = numOr0(st[k]), next = statAfter(k, pk), split = bonusBreakdown(next, gear[pk] || 0, bf[pk] || 0), shown = next - over[k];
    if (!name) return [lbl, txt("—", "muted")];
    return [lbl, el("span", { class: dirCls(shown - total) }, mv(total, shown), split ? " " : "", split ? txt(split, "muted") : null, over[k] ? txt(` ${over[k]} over the ${STAT_MAX} cap`, "tone-warn") : null)];
  }), "kv-tight");
  const mx = (c?.maxes || {}) as Record<string, unknown>;
  const poolMove = poolChanges(Object.fromEntries(["strBonus", "dexBonus", "intBonus", "hpi", "stamInc", "manaInc"].map((k) => [k, d(k)])), bf, over);
  const pools = kvList(([["hits", "Hits"], ["stam", "Stamina"], ["mana", "Mana"]] as Array<["hits" | "stam" | "mana", string]>).map(([k, lbl]): [string, Node] => {
    const dd = poolMove[k], cur = numOrNull(mx[k]);
    return [lbl, txt(!name ? "—" : cur == null ? "?" : mv(cur, cur + dd), dirCls(dd))];
  }), "kv-tight");
  const lists = [box("div", { class: "resist kpi kpi-list" }, txt("Attributes", "t-sm muted"), attrs),
    box("div", { class: "resist kpi kpi-list" }, txt("Pools", "t-sm muted"), pools)];

  // worn gear: the shown suit plus the extras, one tile per fixed slot, anything else under "Other"
  const gearCard = (): HTMLElement => {
    const bySlot = new Map<string, SheetItem>(), other: SheetItem[] = [];
    const nowSerials = new Set(Object.values(extras(before)).filter(Boolean).map((x) => (x as SheetItem).serial));
    for (const it of Object.values(extras(then))) {
      if (!it) continue;
      if (it.slot && FIXED_SLOTS.has(it.slot) && !bySlot.has(it.slot)) bySlot.set(it.slot, it); else other.push(it);
    }
    const caps = (state.rules?.caps || {}) as Record<string, number>;
    const tile = (slot: string | null, it: SheetItem | undefined): HTMLElement => {
      const head = txt(slot ? slotLabel(slot) : "Other", "t-sm muted");
      if (!it) return box("div", { class: "slot empty" }, head, txt("Empty", "faint"));
      const token = rarityToken(it.rarity);
      const nums = keyNumbers(it.props || {}, caps), tags = (it.tags || []).slice(0, 2);
      const isNew = diff && !nowSerials.has(it.serial);
      // only the one-suit sheet: an optimizer piece carries no durability, so a before/after sheet would badge some pieces and not others
      const low = single ? lowDurability(it) : null;
      const t = box("button", { type: "button", class: "slot", ...(token ? { style: `border-color:var(${token})` } : {}) },
        isNew ? box("span", { class: "slot-head" }, head, badge("New", "accent")) : head,
        txt(it.name, "nm"),
        tags.length || nums.length ? box("span", { class: "slot-meta t-sm" }, ...tags.map((x) => tag(x, tagTone(x))), nums.length ? txt(nums.join(" · "), "muted") : null) : null,
        low ? badge(low, "warn") : null);
      if (opts.onSlot) t.addEventListener("click", () => opts.onSlot!(it, t));
      return itemTip(t, it);
    };
    const groups = SLOT_GROUPS.map(([title, slots]) => box("div", { class: "slot-group" }, txt(title, "caps"),
      box("div", { class: "slot-grid" }, ...slots.map((s) => tile(s, bySlot.get(s))))));
    if (other.length) groups.push(box("div", { class: "slot-group" }, txt("Other", "caps"), box("div", { class: "slot-grid" }, ...other.map((it) => tile(it.slot, it)))));
    const gear = el("section", { class: "card", "aria-label": "Worn gear" },
      box("div", { class: "card-head" }, el("h2", {}, "Worn gear"), txt(`${bySlot.size} of ${FIXED_SLOTS.size} slots`, "t-sm muted"), el("span", { class: "spacer" }), opts.onSlot ? txt("Click a slot for the item detail", "t-sm muted") : null),
      box("div", { class: "sheet-slots" }, ...groups));
    return gear;
  };

  // properties: value / shard cap, the caps muted
  const propGroups = (): HTMLElement[] => {
    const shown = shownProps();
    const groups = SHEET_CATALOGUE.map(([title, rows]) => [title, rows.filter(([k]) => shown.has(k))] as const).filter(([, rows]) => rows.length);
    return groups.length ? groups.map(([title, rows]) => box("div", { class: "prop-group" }, txt(title, "caps"),
      kvList(rows.map(([k, lbl, suf = ""]): [string, Node] => {
        const bv = b[k] || 0, av = a[k] || 0, cap = capOf(k);
        return [lbl, el("span", { class: dirCls(av - bv) }, mv(bv, av, suf), cap != null ? " " : "", cap != null ? txt(`/ ${cap}`, "muted") : null)];
      })))) : [txt("No properties shown.", "t-sm muted")];
  };
  const propBody = box("div", { class: "sheet-props" }, ...propGroups());
  const drawProps = (): void => propBody.replaceChildren(...propGroups());
  const picker = button({ label: "Properties shown", icon: "sliders", iconOnly: true, size: "sm", variant: "ghost", attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" }, onClick: () => openPropsPicker(picker, drawProps) });
  // skills: c.skills is Record<string, unknown> (a scan written before the {value, cap} bound is still
  // folded), sorted and rendered through numOr0, so a wrong-typed entry costs that one number. The
  // shard's free skills (outside the skill cap, rules.freeSkills) this character has are named below.
  const skills = Object.entries((c?.skills || {}) as Record<string, Partial<SkillEntry> | undefined>).sort((x, y) => numOr0(y[1]?.value) - numOr0(x[1]?.value));
  const skillRows = skills.map(([n, v]): [string, Node] => [n, el("span", {}, numOr0(v?.value).toFixed(1), " ", txt(`/ ${numOr0(v?.cap).toFixed(1)}`, "muted"))]);
  const half = Math.ceil(skillRows.length / 2);
  const free = (state.rules?.freeSkills || []).filter((n) => skills.some(([s, v]) => s === n && numOr0(v?.value) > 0));
  const skillBlock = !name ? null : skills.length
    ? box("div", { class: "prop-group" }, txt("Skills", "caps"),
      box("div", { class: "sheet-props-2" }, kvList(skillRows.slice(0, half)), skillRows.length > 1 ? kvList(skillRows.slice(half)) : null),
      free.length ? txt(`Free skills (outside the skill cap): ${free.join(", ")}`, "t-sm muted") : null)
    : message({ tone: "info", text: `Skills weren't in this scan. Rescan ${name} in game to record them.` });
  const raceNote = race !== "human" ? ` (${race[0]!.toUpperCase()}${race.slice(1)} racial caps may raise this for some resists)` : "";
  const moved = RESISTS.filter(([k]) => override(k)).map(([k, lbl]) => `${lbl} at ${override(k)!.cap} (the shard's is ${override(k)!.shard})`);
  const note = (opts.statsOnly && name ? "" : name ? `Resists include the Resisting Spells bonus (+${rsb}) and are capped at ${capsFor(name).resistCap("physResist")}${raceNote}.` : "Item totals only: with no character there are no attributes, pools, skills or Resisting Spells bonus.") +
    (moved.length ? ` This build caps ${moved.join(", ")}.` : "") +
    (!diff ? "" : " Hits, Stamina and Mana after = the current max plus the change in STR/2, DEX, INT and the HP, Stamina and Mana Increase properties (an estimate).");
  const props = el("section", { class: "card", "aria-label": "Properties" },
    box("div", { class: "card-head" }, el("h2", {}, "Properties"), el("span", { class: "spacer" }), txt(`${diff ? "now → after" : "value"} / ${RESISTS.some(([k]) => override(k)) ? "build cap" : "shard cap"}`, "t-sm muted"), picker),
    propBody,
    box("div", { class: "sheet-foot" }, skillBlock, note ? el("p", { class: "t-sm muted" }, txt(note)) : null));

  return { resists: resistTiles, lists, gear: opts.statsOnly ? null : gearCard(), props };
}
