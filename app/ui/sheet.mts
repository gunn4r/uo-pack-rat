// ui/sheet.mts — the in-game style character sheet (before/after), shared by the Characters tab
// and the Suit Builder's result panel. Moved verbatim out of index.html's inline
// <script type="module"> (Task 4, the page split).
import { totalsOf, resistSkillBonus } from "../vault-lib.mts";
import type { OptItem } from "../vault-lib.mts";
import { state } from "./store.mts";
import { full, esc } from "./dom.mts";
import type { SkillEntry } from "./api-types.mts";

// The slot value sheetHtml actually needs out of a worn/candidate piece — both a full scanned Item
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
// Resisting Spells adds resists on this shard (+40 at 100, +44 at 120) toward each resist's own cap
// (state.rules.caps, raised by state.rules.raceCaps for the character's race — e.g. an Elf's Energy
// cap of 75 on uoalive — read from state.profiles.characters[name].race, default human).
export function sheetHtml(name: string, before: SheetAssignment, after: SheetAssignment | null): string {
  const single = after == null;
  if (single) after = before;
  // sheetHtml is only ever called once load() has populated state.inv/state.rules — same assumption
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
  const resistCap = (k: string): number => (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race]?.[k] ?? (caps as Record<string, number>)[k] ?? 70;
  // worn pieces the optimizer never touches (feet, robe, waist, earrings, a second chest-layer item) count on both sides
  const inSuit = new Set(Object.values(before).filter(Boolean).map((x) => (x as SheetItem).serial));
  const extraWorn = (state.inv!.worn[name] || []).filter((i) => !inSuit.has(i.serial));
  const withExtras = (set: SheetAssignment): SheetAssignment => ({ ...set, ...Object.fromEntries(extraWorn.map((i) => ["_x" + i.serial, i])) });
  // `after` is only ever null on entry (the single-suit call) — the `if (single) after = before;`
  // above already replaces that case, but TS's flow analysis can't correlate `single`'s value back to
  // `after`'s nullness across the reassignment, so this narrows what's already true at runtime.
  const b = totalsOf(withExtras(before)), a = totalsOf(withExtras(after!));
  const d = (k: string): number => (a[k] || 0) - (b[k] || 0);
  const cell = (v: number, suffix = "", capK: string | null = null): string => `<td class="v">${v}${suffix}${capK && caps[capK] != null ? `<span class="cap"> / ${caps[capK]}</span>` : ""}</td>`;
  const delta = (n: number, suffix = ""): string => single ? "" : `<td class="v ${n > 0 ? "up" : n < 0 ? "down" : "same"}">${n > 0 ? "+" : ""}${n === 0 ? "·" : n + suffix}</td>`;
  const row = (label: string, bv: number, av: number, suffix = "", capK: string | null = null): string => `<tr><td class="lbl">${label}</td>${cell(bv, suffix, capK)}${single ? "" : cell(av, suffix, capK)}${delta(av - bv, suffix)}</tr>`;
  const head = single ? "" : `<tr><td></td><td class="v cap">now</td><td class="v cap">after</td><td class="v cap">Δ</td></tr>`;
  // attributes: the scan's stats are totals with the current suit on; base = total − current bonus.
  // c.stats is Record<string, unknown> (the scan schema leaves per-field shape open) — cast at the
  // read site, same trust boundary as resistCap's caps/raceCaps reads above.
  const st = (c?.stats || {}) as Record<string, number>;
  const attrs = ([["str", "Strength", "strBonus"], ["dex", "Dexterity", "dexBonus"], ["int", "Intelligence", "intBonus"]] as Array<[string, string, string]>).map(([k, lbl, pk]) => {
    const base = (st[k] || 0) - (b[pk] || 0);
    return `<tr><td class="lbl">${lbl}</td><td class="v">${st[k] || 0} <span class="cap">(${base} + ${b[pk] || 0})</span></td>${single ? "" : `<td class="v">${base + (a[pk] || 0)} <span class="cap">(${base} + ${a[pk] || 0})</span></td>`}${delta(d(pk))}</tr>`;
  }).join("");
  const mx = (c?.maxes || {}) as Record<string, number>;
  const pools = ([["hits", "Hits", () => Math.floor(d("strBonus") / 2) + d("hpi")], ["stam", "Stamina", () => d("dexBonus") + d("stamInc")], ["mana", "Mana", () => d("intBonus") + d("manaInc")]] as Array<[string, string, () => number]>)
    .map(([k, lbl, f]) => { const dd = f(); return `<tr><td class="lbl">${lbl}</td><td class="v">${mx[k] ?? "?"}</td>${single ? "" : `<td class="v">${mx[k] != null ? mx[k] + dd : "?"}</td>`}${delta(dd)}</tr>`; }).join("");
  const rsb = resistSkillBonus(c?.skills);
  const res = ([["physResist", "Physical", "r-phys"], ["fireResist", "Fire", "r-fire"], ["coldResist", "Cold", "r-cold"], ["poisonResist", "Poison", "r-poison"], ["energyResist", "Energy", "r-energy"]] as Array<[string, string, string]>)
    .map(([k, lbl, cls]) => { const cap = resistCap(k); const bv = Math.min(cap, (b[k] || 0) + rsb), av = Math.min(cap, (a[k] || 0) + rsb); const dd = av - bv;
      if (single) return `<span class="${cls}">${lbl}: <b>${bv}%</b></span>`;
      return `<span class="${cls}">${lbl}: <b>${bv}%</b> → <b>${av}%</b> <span class="${dd > 0 ? "up" : dd < 0 ? "down" : "same"}">${dd > 0 ? "+" + dd : dd < 0 ? dd : "="}</span></span>`; }).join("");
  const stats = SHEET_STATS.map(([k, lbl, suf]) => row(`<span title="${full(k!)}">${lbl}</span>`, b[k!] || 0, a[k!] || 0, suf || "", caps[k!] != null ? k! : null)).join("");
  // c.skills is Record<string, unknown> (same open scan shape) but every entry a real scan writes is
  // a {value, cap} pair (SkillEntry, api-types.mts) — cast at this read site, the shape resistSkillBonus's
  // own comment in vault-lib.mts already documents for the identical field.
  const skillEntries = Object.entries((c?.skills || {}) as Record<string, SkillEntry>);
  const skills = skillEntries.sort((x, y) => y[1].value - x[1].value).map(([n, v]) => `<tr><td class="lbl">${esc(n)}</td><td class="v">${v.value.toFixed(1)}<span class="cap"> / ${v.cap.toFixed(1)}</span></td></tr>`).join("");
  return `<div class="sheet"><div class="title">${esc(name)} — Character Sheet</div>
    <h4>Attributes</h4><div class="cols"><table>${head}${attrs}</table><table>${head}${pools}</table></div>
    <h4>Resistances</h4><div class="res">${res}</div>
    <div class="cols"><div><h4>Stats</h4><table>${head}${stats}</table></div><div><h4>Skills</h4><table>${skills || `<tr><td class="cap">rescan to record skills</td></tr>`}</table></div></div>
    <div class="note">Resists include the Resisting Spells bonus (+${rsb}) and are capped at ${resistCap("physResist")}${race !== "human" ? ` (${race[0]!.toUpperCase()}${race.slice(1)} racial caps may raise this for some resists)` : ""}.${single ? "" : " Hits/Stam/Mana after = current max + the change in STR/2, DEX, INT and the +HP/+Stam/+Mana properties (estimate)."}</div></div>`;
}
