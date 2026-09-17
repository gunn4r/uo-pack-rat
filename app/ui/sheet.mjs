// ui/sheet.mjs — the in-game style character sheet (before/after), shared by the Characters tab
// and the Suit Builder's result panel. Moved verbatim out of index.html's inline
// <script type="module"> (Task 4, the page split).
import { totalsOf, resistSkillBonus } from "../vault-lib.mjs";
import { state } from "./store.mjs";
import { full, esc } from "./dom.mjs";

// ---------------------------------------------------------------- character sheet (before / after)
export const SHEET_STATS = [
  ["hpRegen", "Hits Regen"], ["stamRegen", "Stam Regen"], ["manaRegen", "Mana Regen"], ["reflectPhys", "Reflect Dmg", "%"],
  ["fc", "FC"], ["fcr", "FCR"], ["sdi", "SDI", "%"], ["ssi", "SSI", "%"], ["hci", "HCI", "%"], ["dci", "DCI", "%"],
  ["di", "DI", "%"], ["lrc", "LRC", "%"], ["lmc", "LMC", "%"], ["hpi", "HP Increase"], ["stamInc", "Stam Increase"],
  ["manaInc", "Mana Increase"], ["castingFocus", "Casting Focus", "%"], ["enhancePotions", "Enhance Potions", "%"], ["luck", "Luck"],
];
// Resisting Spells adds resists on this shard (+40 at 100, +44 at 120) toward each resist's own cap
// (state.rules.caps, raised by state.rules.raceCaps for the character's race — e.g. an Elf's Energy
// cap of 75 on uoalive — read from state.profiles.characters[name].race, default human).
export function sheetHtml(name, before, after) {
  const single = after == null;
  if (single) after = before;
  const c = state.inv.characters[name];
  const caps = state.rules.caps || {};
  // Resist caps are race-aware (e.g. an Elf's Energy cap of 75 on uoalive) — read the character's
  // race from their profile (default human) and prefer a raceCaps override over the shard's base cap.
  const race = state.profiles?.characters?.[name]?.race || "human";
  const resistCap = (k) => state.rules.raceCaps?.[race]?.[k] ?? caps[k] ?? 70;
  // worn pieces the optimizer never touches (feet, robe, waist, earrings, a second chest-layer item) count on both sides
  const inSuit = new Set(Object.values(before).filter(Boolean).map((x) => x.serial));
  const extraWorn = (state.inv.worn[name] || []).filter((i) => !inSuit.has(i.serial));
  const withExtras = (set) => ({ ...set, ...Object.fromEntries(extraWorn.map((i) => ["_x" + i.serial, i])) });
  const b = totalsOf(withExtras(before)), a = totalsOf(withExtras(after));
  const d = (k) => (a[k] || 0) - (b[k] || 0);
  const cell = (v, suffix = "", capK = null) => `<td class="v">${v}${suffix}${capK && caps[capK] != null ? `<span class="cap"> / ${caps[capK]}</span>` : ""}</td>`;
  const delta = (n, suffix = "") => single ? "" : `<td class="v ${n > 0 ? "up" : n < 0 ? "down" : "same"}">${n > 0 ? "+" : ""}${n === 0 ? "·" : n + suffix}</td>`;
  const row = (label, bv, av, suffix = "", capK = null) => `<tr><td class="lbl">${label}</td>${cell(bv, suffix, capK)}${single ? "" : cell(av, suffix, capK)}${delta(av - bv, suffix)}</tr>`;
  const head = single ? "" : `<tr><td></td><td class="v cap">now</td><td class="v cap">after</td><td class="v cap">Δ</td></tr>`;
  // attributes: the scan's stats are totals with the current suit on; base = total − current bonus
  const st = c?.stats || {};
  const attrs = [["str", "Strength", "strBonus"], ["dex", "Dexterity", "dexBonus"], ["int", "Intelligence", "intBonus"]].map(([k, lbl, pk]) => {
    const base = (st[k] || 0) - (b[pk] || 0);
    return `<tr><td class="lbl">${lbl}</td><td class="v">${st[k] || 0} <span class="cap">(${base} + ${b[pk] || 0})</span></td>${single ? "" : `<td class="v">${base + (a[pk] || 0)} <span class="cap">(${base} + ${a[pk] || 0})</span></td>`}${delta(d(pk))}</tr>`;
  }).join("");
  const mx = c?.maxes || {};
  const pools = [["hits", "Hits", () => Math.floor(d("strBonus") / 2) + d("hpi")], ["stam", "Stamina", () => d("dexBonus") + d("stamInc")], ["mana", "Mana", () => d("intBonus") + d("manaInc")]]
    .map(([k, lbl, f]) => { const dd = f(); return `<tr><td class="lbl">${lbl}</td><td class="v">${mx[k] ?? "?"}</td>${single ? "" : `<td class="v">${mx[k] != null ? mx[k] + dd : "?"}</td>`}${delta(dd)}</tr>`; }).join("");
  const rsb = resistSkillBonus(c?.skills);
  const res = [["physResist", "Physical", "r-phys"], ["fireResist", "Fire", "r-fire"], ["coldResist", "Cold", "r-cold"], ["poisonResist", "Poison", "r-poison"], ["energyResist", "Energy", "r-energy"]]
    .map(([k, lbl, cls]) => { const cap = resistCap(k); const bv = Math.min(cap, (b[k] || 0) + rsb), av = Math.min(cap, (a[k] || 0) + rsb); const dd = av - bv;
      if (single) return `<span class="${cls}">${lbl}: <b>${bv}%</b></span>`;
      return `<span class="${cls}">${lbl}: <b>${bv}%</b> → <b>${av}%</b> <span class="${dd > 0 ? "up" : dd < 0 ? "down" : "same"}">${dd > 0 ? "+" + dd : dd < 0 ? dd : "="}</span></span>`; }).join("");
  const stats = SHEET_STATS.map(([k, lbl, suf]) => row(`<span title="${full(k)}">${lbl}</span>`, b[k] || 0, a[k] || 0, suf || "", caps[k] != null ? k : null)).join("");
  const skills = Object.entries(c?.skills || {}).sort((x, y) => y[1].value - x[1].value).map(([n, v]) => `<tr><td class="lbl">${esc(n)}</td><td class="v">${v.value.toFixed(1)}<span class="cap"> / ${v.cap.toFixed(1)}</span></td></tr>`).join("");
  return `<div class="sheet"><div class="title">${esc(name)} — Character Sheet</div>
    <h4>Attributes</h4><div class="cols"><table>${head}${attrs}</table><table>${head}${pools}</table></div>
    <h4>Resistances</h4><div class="res">${res}</div>
    <div class="cols"><div><h4>Stats</h4><table>${head}${stats}</table></div><div><h4>Skills</h4><table>${skills || `<tr><td class="cap">rescan to record skills</td></tr>`}</table></div></div>
    <div class="note">Resists include the Resisting Spells bonus (+${rsb}) and are capped at ${resistCap("physResist")}${race !== "human" ? ` (${race[0].toUpperCase()}${race.slice(1)} racial caps may raise this for some resists)` : ""}.${single ? "" : " Hits/Stam/Mana after = current max + the change in STR/2, DEX, INT and the +HP/+Stam/+Mana properties (estimate)."}</div></div>`;
}
