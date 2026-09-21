// ui/sheet.mts — the in-game style character sheet (before/after), shared by the Characters tab
// and the Suit Builder's result panel. Moved verbatim out of index.html's inline
// <script type="module"> (Task 4, the page split), then rebuilt as DOM nodes rather than an HTML
// string (Phase 7 security review, Area 2, Important 1): a scan file is attacker-controlled text,
// and this builder interpolated the scan's own stats/maxes straight into markup, which a pasted
// "here's my suit" scan turned into persistent HTML/CSS injection inside the app window.
import { totalsOf, resistSkillBonus } from "../vault-lib.mts";
import type { OptItem } from "../vault-lib.mts";
import { state } from "./store.mts";
import { el, full } from "./dom.mts";
import type { SkillEntry } from "./api-types.mts";

// The slot value sheetNode actually needs out of a worn/candidate piece — both a full scanned Item
// (characters.mts's `current`, built from state.inv.worn) and an optimizer OptItem (builder.mts's
// `suit`/`current`) carry every one of these fields, so this is what `before`/`after` accept rather
// than either concrete type: Item's own `twoHanded: boolean` (required) isn't assignable to
// OptItem's `twoHanded?: true | undefined` (optional, narrower), so a type that names both callers'
// real shapes has to omit it — nothing here reads it anyway. Assignable in turn to vault-lib.mts's
// own `Partial<Record<string, OptItem | null | undefined>>` (totalsOf's parameter), since every
// field OptItem requires is present here.
type SheetItem = Pick<OptItem, "serial" | "name" | "slot" | "props">;
type SheetAssignment = Partial<Record<string, SheetItem | null | undefined>>;

// ---------------------------------------------------------------- character sheet (before / after)
export const SHEET_STATS: Array<[string, string, string?]> = [
  ["hpRegen", "Hits Regen"], ["stamRegen", "Stam Regen"], ["manaRegen", "Mana Regen"], ["reflectPhys", "Reflect Dmg", "%"],
  ["fc", "FC"], ["fcr", "FCR"], ["sdi", "SDI", "%"], ["ssi", "SSI", "%"], ["hci", "HCI", "%"], ["dci", "DCI", "%"],
  ["di", "DI", "%"], ["lrc", "LRC", "%"], ["lmc", "LMC", "%"], ["hpi", "HP Increase"], ["stamInc", "Stam Increase"],
  ["manaInc", "Mana Increase"], ["castingFocus", "Casting Focus", "%"], ["enhancePotions", "Enhance Potions", "%"], ["luck", "Luck"],
];

// The scan's own numbers, read defensively. The v2 schema types stats/maxes/skills now (numbers, and
// a {value, cap} pair), so a validated scan always satisfies these — but a scan written before that
// bound existed is still on disk and still folded, and the render is where a wrong-typed value used
// to throw and take the Characters tab and the Suit Builder down with it (Area 2, Important 2).
const numOr0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

// Resisting Spells adds resists on this shard (+40 at 100, +44 at 120) toward each resist's own cap
// (state.rules.caps, raised by state.rules.raceCaps for the character's race — e.g. an Elf's Energy
// cap of 75 on uoalive — read from state.profiles.characters[name].race, default human).
export function sheetNode(name: string, before: SheetAssignment, after: SheetAssignment | null): HTMLDivElement {
  const single = after == null;
  if (single) after = before;
  // sheetNode is only ever called once load() has populated state.inv/state.rules — same assumption
  // every other renderX() function in this page makes about them.
  const c = state.inv!.characters[name];
  const rules = state.rules!;
  const caps = rules.caps || {};
  // Resist caps are race-aware (e.g. an Elf's Energy cap of 75 on uoalive) — read the character's
  // race from their profile (default human) and prefer a raceCaps override over the shard's base cap.
  const race = state.profiles?.characters?.[name]?.race || "human";
  // rules.caps/raceCaps are Record<string, unknown> (the shard rules file's own numeric fields are
  // left loose there — see schema/types.d.mts) — cast at the one place this reads them
  // arithmetically, the same cast vault-lib.mts's own effectiveProfile() uses for the identical field.
  const capOf = (k: string): number | undefined => (caps as Record<string, number>)[k];
  const resistCap = (k: string): number => (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race]?.[k] ?? capOf(k) ?? 70;
  // worn pieces the optimizer never touches (feet, robe, waist, earrings, a second chest-layer item) count on both sides
  const inSuit = new Set(Object.values(before).filter(Boolean).map((x) => (x as SheetItem).serial));
  const extraWorn = (state.inv!.worn[name] || []).filter((i) => !inSuit.has(i.serial));
  const withExtras = (set: SheetAssignment): SheetAssignment => ({ ...set, ...Object.fromEntries(extraWorn.map((i) => ["_x" + i.serial, i])) });
  // `after` is only ever null on entry (the single-suit call) — the `if (single) after = before;`
  // above already replaces that case, but TS's flow analysis can't correlate `single`'s value back to
  // `after`'s nullness across the reassignment, so this narrows what's already true at runtime.
  const b = totalsOf(withExtras(before)), a = totalsOf(withExtras(after!));
  const d = (k: string): number => (a[k] || 0) - (b[k] || 0);
  const capText = (text: string): HTMLSpanElement => el("span", { class: "cap" }, text);
  const capCell = (text: string): HTMLTableCellElement => el("td", { class: "v cap" }, text);
  const cell = (v: number | string, suffix = "", capK: string | null = null): HTMLTableCellElement =>
    el("td", { class: "v" }, String(v) + suffix, capK && capOf(capK) != null ? capText(` / ${capOf(capK)}`) : null);
  const delta = (n: number, suffix = ""): HTMLTableCellElement | null =>
    single ? null : el("td", { class: "v " + (n > 0 ? "up" : n < 0 ? "down" : "same") }, n === 0 ? "·" : `${n > 0 ? "+" : ""}${n}${suffix}`);
  const tr = (...kids: Array<Node | string | null>): HTMLTableRowElement => el("tr", {}, ...kids);
  const row = (label: Node | string, bv: number, av: number, suffix = "", capK: string | null = null): HTMLTableRowElement =>
    tr(el("td", { class: "lbl" }, label), cell(bv, suffix, capK), single ? null : cell(av, suffix, capK), delta(av - bv, suffix));
  const head = (): HTMLTableRowElement | null => single ? null : tr(el("td"), capCell("now"), capCell("after"), capCell("Δ"));
  // A <tbody>, so the tree matches what the browser's own parser used to build out of this markup.
  const table = (...rows: Array<HTMLTableRowElement | null>): HTMLTableElement =>
    el("table", {}, el("tbody", {}, ...rows.filter((r): r is HTMLTableRowElement => r != null)));

  // attributes: the scan's stats are totals with the current suit on; base = total − current bonus.
  const st = (c?.stats || {}) as Record<string, unknown>;
  const attrs = ([["str", "Strength", "strBonus"], ["dex", "Dexterity", "dexBonus"], ["int", "Intelligence", "intBonus"]] as Array<[string, string, string]>).map(([k, lbl, pk]) => {
    const total = numOr0(st[k]);
    const base = total - (b[pk] || 0);
    return tr(el("td", { class: "lbl" }, lbl),
      el("td", { class: "v" }, `${total} `, capText(`(${base} + ${b[pk] || 0})`)),
      single ? null : el("td", { class: "v" }, `${base + (a[pk] || 0)} `, capText(`(${base} + ${a[pk] || 0})`)),
      delta(d(pk)));
  });
  const mx = (c?.maxes || {}) as Record<string, unknown>;
  const pools = ([["hits", "Hits", () => Math.floor(d("strBonus") / 2) + d("hpi")], ["stam", "Stamina", () => d("dexBonus") + d("stamInc")], ["mana", "Mana", () => d("intBonus") + d("manaInc")]] as Array<[string, string, () => number]>)
    .map(([k, lbl, f]) => {
      const dd = f(), now = numOrNull(mx[k]);
      return tr(el("td", { class: "lbl" }, lbl),
        el("td", { class: "v" }, now == null ? "?" : String(now)),
        single ? null : el("td", { class: "v" }, now == null ? "?" : String(now + dd)),
        delta(dd));
    });
  const rsb = resistSkillBonus(c?.skills);
  const res = ([["physResist", "Physical", "r-phys"], ["fireResist", "Fire", "r-fire"], ["coldResist", "Cold", "r-cold"], ["poisonResist", "Poison", "r-poison"], ["energyResist", "Energy", "r-energy"]] as Array<[string, string, string]>)
    .map(([k, lbl, cls]) => {
      const rcap = resistCap(k), bv = Math.min(rcap, (b[k] || 0) + rsb), av = Math.min(rcap, (a[k] || 0) + rsb), dd = av - bv;
      if (single) return el("span", { class: cls }, `${lbl}: `, el("b", {}, `${bv}%`));
      return el("span", { class: cls }, `${lbl}: `, el("b", {}, `${bv}%`), " → ", el("b", {}, `${av}%`), " ",
        el("span", { class: dd > 0 ? "up" : dd < 0 ? "down" : "same" }, dd > 0 ? "+" + dd : dd < 0 ? String(dd) : "="));
    });
  const stats = SHEET_STATS.map(([k, lbl, suf]) => row(el("span", { title: full(k!) }, lbl), b[k!] || 0, a[k!] || 0, suf || "", capOf(k!) != null ? k! : null));
  // c.skills is Record<string, unknown> (the scan schema types a real entry as {value, cap}, but a
  // scan written before that bound is still folded) — sorted and rendered through numOr0, so a
  // wrong-typed entry costs that one number instead of the whole tab.
  const skillEntries = Object.entries((c?.skills || {}) as Record<string, Partial<SkillEntry> | undefined>);
  const skills = skillEntries
    .sort((x, y) => numOr0(y[1]?.value) - numOr0(x[1]?.value))
    .map(([n, v]) => tr(el("td", { class: "lbl" }, n), el("td", { class: "v" }, numOr0(v?.value).toFixed(1), capText(` / ${numOr0(v?.cap).toFixed(1)}`))));

  return el("div", { class: "sheet" },
    el("div", { class: "title" }, `${name} — Character Sheet`),
    el("h4", {}, "Attributes"),
    el("div", { class: "cols" }, table(head(), ...attrs), table(head(), ...pools)),
    el("h4", {}, "Resistances"),
    el("div", { class: "res" }, ...res),
    el("div", { class: "cols" },
      el("div", {}, el("h4", {}, "Stats"), table(head(), ...stats)),
      el("div", {}, el("h4", {}, "Skills"), table(...(skills.length ? skills : [tr(el("td", { class: "cap" }, "rescan to record skills"))])))),
    el("div", { class: "note" },
      `Resists include the Resisting Spells bonus (+${rsb}) and are capped at ${resistCap("physResist")}${race !== "human" ? ` (${race[0]!.toUpperCase()}${race.slice(1)} racial caps may raise this for some resists)` : ""}.`,
      single ? "" : " Hits/Stam/Mana after = current max + the change in STR/2, DEX, INT and the +HP/+Stam/+Mana properties (estimate)."));
}
