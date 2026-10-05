// ui/builder-buffs.mts — Manual mode's buffs (issue #12): the Buffs row in the totals card (each buff that is on as a
// removable chip, Add buff, and the "Count buffs in the totals" switch), a total's marker line saying what the buffs
// did to it, and the buff picker in the side column: a search, the catalog by group with each entry's numbers worked
// out from the character's skills, a field per number a group scales with, and the note when a form replaced another.
// The model is app/buffs.mts; ui/builder-manual.mts holds the state and calls these with it.
import { BUFFS, BUFF_GROUPS, BUFF_INPUTS, EXCLUSIVE, buffById, buffContext, buffNeeds, buffText, signed, signedPct } from "../buffs.mts";
import type { Buff, BuffResult, BuffWho, Skills, Stats } from "../buffs.mts";
import type { PropMap } from "../vault-lib.mts";
import { el, label } from "./dom.mts";
import { box, txt, button, icon, filterChip, token, badge, tag, message, searchInput, switchControl } from "./components.mts";

export interface BuffView {
  name: string | null;                   // the character whose skills the numbers take, or null for No character
  on: string[];                          // the buffs that are on
  values: Skills;                        // every input's value (an edit, the character's skill, or the default)
  planned: Set<string>;                  // the inputs edited, or a skill the character lacks
  edits: Record<string, number>;
  stats: Stats | null;
  who: BuffWho;                          // the character's race and the held weapon's flags
  totals: PropMap;                       // the suit's totals (a potion reads its Enhance Potions)
  caps: Record<string, number>;          // the caps before any buff, which a cap change is described against
  all: BuffResult;                       // every buff that is on applied, counted or not: which are beaten or blocked
  replaced: { on: string; off: string } | null;
  count: boolean;
  open: boolean;
}
export interface BuffActions {
  toggle: (id: string) => void;
  setInput: (id: string, value: number | null) => void;   // null: back to the character's skill (or the default)
  clear: () => void;
  setCount: (on: boolean) => void;
  open: () => void;
  close: () => void;
  undo: () => void;
}
const fieldId = (input: string): string => `bf-in-${input.replace(/\W+/g, "-")}`;
const nameOf = (id: string): string => buffById(id)?.name ?? id;

// ---------------------------------------------------------------- the totals card
// What a chip says after the name: the skill it needs, "planned" while its numbers are not all the character's own,
// or with no character the number its first input took ("Eval Int 120").
function chipNote(b: Buff, v: BuffView): string | null {
  const needs = buffNeeds(b, v.values, v.who), i = b.inputs[0];
  if (needs) return needs.replace("Needs", "needs");
  if (v.name) return b.inputs.some((x) => v.planned.has(x)) ? "planned" : null;
  return i ? `${BUFF_INPUTS[i]!.label} ${v.values[i]}` : null;
}
// The Buffs row: a chip per buff that is on (dashed while its numbers are planned), Add buff, and the switch.
export function buffStrip(v: BuffView, a: BuffActions): HTMLElement {
  const chips = v.on.map((id) => {
    const b = buffById(id)!, note = chipNote(b, v);
    const t = token({ label: b.name, removeLabel: `Remove ${b.name}`, onRemove: () => a.toggle(id) });
    t.title = `${b.name}: ${buffText(id, v.values, v.stats, v.totals, v.who, v.caps)}${b.inputs.length ? ` (${b.inputs.map((x) => `${BUFF_INPUTS[x]!.label} ${v.values[x]}`).join(", ")})` : ""}`;
    t.firstElementChild!.replaceWith(el("span", {}, b.name, note ? el("span", { class: "muted" }, ` · ${note}`) : null));
    if (v.name && b.inputs.some((i) => v.planned.has(i))) t.classList.add("bf-planned");
    t.dataset.buff = id;
    return t;
  });
  const add = filterChip({ label: "Add buff", add: true, onClick: () => (v.open ? a.close() : a.open()), attrs: { id: "bf-add", "aria-controls": "mb-buffs", "aria-expanded": String(v.open) } });
  add.removeAttribute("aria-haspopup");   // it opens the side column, not a menu
  const sw = switchControl({ label: "Count buffs in the totals", checked: v.count, onChange: a.setCount, attrs: { id: "bf-count" } });
  return box("div", { class: "bf-strip", role: "group", "aria-label": "Buffs" },
    box("span", { class: "bf-lead" }, icon("spark", { size: "sm" }), txt("Buffs", "caps")), ...chips, add, el("span", { class: "spacer" }), sw.root);
}
// A total's marker line: what the buffs add inside the cap ("+10", "+13%" of a stat with no character), the cap they
// raise ("cap +5") and what they add past it ("+68 past cap"), each buff's share on hover and for a screen reader.
export function buffMarker(k: string, r: BuffResult, baseCap: number | undefined): HTMLElement | null {
  const shares = r.shares[k] || [], capShares = r.capShares[k] || [];
  const sum = (outside: boolean): number => shares.filter((s) => !!s.outside === outside).reduce((n, s) => n + s.value, 0);
  const inCap = sum(false), past = sum(true), raise = baseCap == null ? 0 : (r.caps[k] ?? baseCap) - baseCap;
  const pct = shares.reduce((n, s) => n + (s.pct ?? 0), 0);   // with no character, Bless's +13% and Curse's −20% are of the same base
  const parts = [inCap ? signed(inCap) : pct ? signedPct(pct) : null, raise ? `cap ${signed(raise)}` : null, past ? `${signed(past)} past cap` : null].filter(Boolean);
  if (!parts.length) return null;
  const who = [...shares.map((s) => `${nameOf(s.id)} ${s.pct != null ? signedPct(s.pct) : signed(s.value)}${s.outside ? " past the cap" : ""}`),
    ...capShares.map((s) => `${nameOf(s.id)} cap ${signed(s.value)}`)].join(", ");
  return box("span", { class: "t-sm bf-sub", title: `From the buffs: ${who}` }, icon("spark", { size: "sm" }), txt(parts.join(" · ")), el("span", { class: "sr" }, `, from the buffs: ${who}`));
}

// ---------------------------------------------------------------- the picker
// Once, from initManual(): the picker's head, search, tools and list, in #mb-buffs.
let search: HTMLInputElement | null = null;
export function initBuffPicker(a: BuffActions, repaint: () => void): void {
  const find = searchInput({ label: "Search buffs", placeholder: "Search buffs, forms, properties", attrs: { id: "bf-search" } });
  find.input.classList.add("input-sm");
  find.input.addEventListener("input", () => { document.getElementById("bf-list")!.scrollTop = 0; repaint(); });
  search = find.input;
  document.getElementById("mb-buffs")!.append(
    box("div", { class: "mb-pick-head" }, el("h2", { class: "t-lg", id: "bf-h" }), el("span", { class: "spacer" }),
      button({ label: "Close the buffs (Esc)", icon: "close", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: "bf-close" }, onClick: a.close })),
    box("div", { class: "bf-tools" }, find.root,
      box("div", { class: "bf-toolrow" }, el("span", { class: "t-sm muted ellip", id: "bf-status" }), button({ label: "Clear all", variant: "ghost", size: "sm", attrs: { id: "bf-clear" }, onClick: a.clear }))),
    el("div", { class: "bf-list", id: "bf-list", role: "group", "aria-labelledby": "bf-h" }),
    el("p", { class: "t-sm muted bf-foot", id: "bf-foot" }));
}
export const focusBuffSearch = (): void => search?.focus();

// The tags beside an entry's name: a form, a stat share where the largest counts or one that stacks, a bonus past the
// cap, a cap change, numbers not yet checked in game, and a ServUO item not known on UO Alive.
function tagsOf(b: Buff, v: BuffView): HTMLElement[] {
  const c = buffContext(v.values, v.stats, v.totals, v.who, v.caps);
  const fx = b.effects(c), caps = Object.values({ ...b.caps?.(c), ...b.capsLate?.(c) }), sets = Object.values(b.capsSet?.(c) || {});
  const stat = fx.filter((e) => /^(str|dex|int)Bonus$/.test(e.key) && e.value > 0);
  const out: Array<[string, string]> = [];
  if (b.excl === "form") out.push(["Form", ""]);
  if (stat.some((e) => e.slot)) out.push(["Largest wins", ""]);
  else if (stat.length) out.push(["Stacks", "bf-tag-ok"]);
  if (fx.some((e) => e.outside && e.value)) out.push(["Outside cap", "bf-tag-accent"]);
  if (caps.length) out.push([`Cap ${signed(Math.max(...caps))}`, "bf-tag-accent"]);
  else if (sets.length) out.push([`Cap ${Math.min(...sets)}`, "bf-tag-accent"]);
  if (b.unconfirmed) out.push(["May not exist on UO Alive", ""]);
  const tags = out.map(([t, cls]) => { const x = tag(t); if (cls) x.classList.add(cls); return x; });
  if (b.confidence) tags.push(el("span", { class: "t-sm bf-unverified", title: `${b.confidence === "low" ? "Low" : "Medium"} confidence: check these numbers in game` }, "unverified"));
  return tags;
}
// One entry: its checkbox, its name and tags, its numbers, and a line on what overrides it or what to know.
function row(b: Buff, v: BuffView, a: BuffActions): HTMLElement {
  const on = v.on.includes(b.id), off = v.replaced?.off === b.id;
  const cb = el("input", { type: "checkbox", id: `bf-cb-${b.id}`, onchange: () => a.toggle(b.id) });
  cb.checked = on;
  const needs = buffNeeds(b, v.values, v.who);
  if (needs && b.race && !on) cb.disabled = true;   // another race's passive: nothing to turn on (one already on can go off)
  const unsure = v.all.unsure.filter((x) => x.id === b.id).map((x) =>
    `${label(x.key)}: the larger of this and ${nameOf(x.with)}'s ${signed(v.all.shares[x.key]?.find((s) => s.id === x.with)?.value ?? 0)} counts, depending on base ${label(x.key)}`);
  const beaten = v.all.beaten.filter((x) => x.id === b.id).map((x) => {
    const won = v.all.shares[x.key]?.find((s) => s.id === x.by);
    return `${label(x.key)}: ${nameOf(x.by)}'s ${won?.pct != null ? signedPct(won.pct) : signed(won?.value ?? 0)} counts instead`;
  });
  const note = off ? `Turned off: ${nameOf(v.replaced!.on)} is your form now` : b.note;
  return el("label", { class: `bf-item${off ? " bf-off" : ""}` }, cb, box("span", { class: "bf-item-text" },
    box("span", { class: "bf-name" }, txt(b.name, "strong"), ...tagsOf(b, v)),
    txt(buffText(b.id, v.values, v.stats, v.totals, v.who, v.caps), "bf-eff"),
    needs ? txt(`${needs}, so it counts for nothing`, "bf-warn") : null,
    beaten.length ? txt(beaten.join(". "), "bf-warn") : null,
    unsure.length ? txt(unsure.join(". "), "bf-note") : null,
    note ? txt(note, "bf-note") : null));
}
// A group's head: its name, whose numbers they are, and a field per number, each marked while planned. A collapsed
// group (the debuffs) has a show / hide button and, folded, no fields.
const unfolded = new Set<string>();
const isOpen = (g: (typeof BUFF_GROUPS)[number]): boolean => !g.collapsed || unfolded.has(g.name);
// A search shows a folded group's matching rows, so its button says so and waits until the search is cleared.
const groupId = (g: (typeof BUFF_GROUPS)[number]): string => `bf-group-${g.name.replace(/\W+/g, "-")}`;
function groupHead(g: (typeof BUFF_GROUPS)[number], v: BuffView, a: BuffActions, repaint: () => void, searching: boolean): HTMLElement {
  const edited = g.inputs.some((i) => Object.hasOwn(v.edits, i)), lacking = g.inputs.some((i) => v.planned.has(i) && !Object.hasOwn(v.edits, i));
  const who = !v.name || !g.inputs.length ? null
    : edited ? badge("Planned", "accent") : lacking ? badge(`Planned: ${v.name} doesn't have it`, "accent")
    : g.inputs.some((i) => BUFF_INPUTS[i]!.skills.length) ? badge(`${v.name}'s skills`) : null;
  const fields = g.inputs.map((i) => {
    const def = BUFF_INPUTS[i]!, id = fieldId(i);
    const f = el("input", { class: `input input-sm num${def.max > 999 ? " bf-wide" : ""}${v.planned.has(i) ? " bf-plan" : ""}`, type: "number", id, min: String(def.min), max: String(def.max), step: def.int ? "1" : "any" });
    f.value = String(v.values[i]);
    f.addEventListener("change", () => {
      const n = Number(f.value);
      a.setInput(i, f.value.trim() === "" || !Number.isFinite(n) ? null : Math.min(def.max, Math.max(def.min, def.int ? Math.round(n) : n)));
    });
    return box("span", { class: "bf-skill" }, el("label", { class: "t-sm muted", for: id }, def.label), f);
  });
  const reset = edited ? button({ label: `Reset ${g.name}'s numbers to ${v.name ? `${v.name}'s skills` : "the defaults"}`, icon: "undo", iconOnly: true, variant: "ghost", size: "sm",
    onClick: () => g.inputs.forEach((i) => a.setInput(i, null)) }) : null;
  const open = isOpen(g) || searching;
  const fold = g.collapsed ? button({ label: `${open ? "Hide" : "Show"} ${g.name}`, icon: open ? "chevron-down" : "chevron-right", iconOnly: true, variant: "ghost", size: "sm", disabled: searching,
    attrs: { id: `bf-fold-${g.name.replace(/\W+/g, "-")}`, "aria-expanded": String(open), "aria-controls": groupId(g) },
    onClick: () => { if (isOpen(g)) unfolded.delete(g.name); else unfolded.add(g.name); repaint(); } }) : null;
  return box("div", { class: "bf-group-head" }, fold, txt(g.name, "caps"), ...(open ? [who, ...fields, reset] : []));
}
// The picker for the current state: its title, status, the replaced-form note and the matching entries by group.
// The list is redrawn whole; the focused control and the scroll position are kept.
export function paintBuffPicker(v: BuffView, a: BuffActions): void {
  const list = document.getElementById("bf-list")!, focused = document.activeElement?.closest("#bf-list") ? document.activeElement.id : null, top = list.scrollTop;
  const q = (search?.value || "").trim().toLowerCase();
  const hits = BUFFS.filter((b) => !q || [b.name, b.group, buffText(b.id, v.values, v.stats, v.totals, v.who, v.caps)].some((s) => s.toLowerCase().includes(q)));
  document.getElementById("bf-h")!.textContent = v.name ? `Buffs for ${v.name}` : "Buffs";
  const forms = v.on.filter((id) => buffById(id)?.excl === "form").length;
  document.getElementById("bf-status")!.textContent = [q ? `${hits.length} of ${BUFFS.length} match “${search!.value.trim()}”` : null, `${v.on.length} on`,
    forms ? "1 form" : null, v.name ? `numbers from ${v.name}'s skills` : "no character: every skill at 120"].filter(Boolean).join(" · ");
  (document.getElementById("bf-clear") as HTMLButtonElement).disabled = !v.on.length;
  const r = v.replaced, excl = r ? buffById(r.on)?.excl : undefined;
  const hint = r && excl ? message({ tone: "info", attrs: { class: "msg info bf-hint" },
    text: el("span", {}, el("span", { class: "strong" }, `${nameOf(r.on)} replaced ${nameOf(r.off)}. `), EXCLUSIVE[excl]!),
    actions: [button({ label: "Undo", variant: "ghost", size: "sm", attrs: { id: "bf-undo" }, onClick: a.undo })] }) : null;
  // a folded group lists its rows only when a search matches them. Each group is its own box, so its sticky head
  // scrolls away with it rather than staying under the next group's.
  const groups = BUFF_GROUPS.flatMap((g) => {
    const rows = hits.filter((b) => b.group === g.name);
    return rows.length ? [box("section", { class: "bf-group", id: groupId(g), "aria-label": g.name }, groupHead(g, v, a, () => paintBuffPicker(v, a), !!q), ...(isOpen(g) || q ? rows.map((b) => row(b, v, a)) : []))] : [];
  });
  list.replaceChildren(...[hint, ...groups].filter((x): x is HTMLElement => !!x), ...(groups.length ? [] : [el("p", { class: "t-sm muted bf-none" }, "No buff matches.")]));
  list.scrollTop = top;
  if (focused) document.getElementById(focused)?.focus();
  document.getElementById("bf-foot")!.textContent = v.count ? "The totals, the stats and every slot's Change column count the buffs that are on." : "Count buffs in the totals is off: the totals leave the buffs out.";
}
