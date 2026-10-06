// css-guard.test.mts — a [smoke] guard that keeps screen stylesheets from restyling the shared components, and the window breakpoints in one list.
//
// 1. A rule in a screen stylesheet (every `app/ui/*.css` but `components.css`, `tokens.css` and `britannia.css`) whose subject, the last compound of a selector, carries a component class is an override: it changes a component in one place only, so a component change has to be checked in every such file. The component classes are the ones `app/ui/components.css` styles on their own (`.btn`, `.badge.best`, `dialog.dialog`), less the text and icon utilities. Today's overrides are listed below, each under the reason it is there; a new one fails until it becomes a component option or joins the list with its reason, and a listed one that is gone fails too, so the list stays current.
// 2. Every width in an `@media` rule of `app/ui/*.css` is one of `app/ui/breakpoints.mts`'s (a `min-width` one pixel above one), and no `app/ui/*.mts` but that module writes a `max-width`/`min-width` query of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { BREAKPOINTS } from "../app/ui/breakpoints.mts";

const UI = join(fileURLToPath(new URL("..", import.meta.url)), "app", "ui");
const read = (f: string): string => readFileSync(join(UI, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SHARED = new Set(["components.css", "tokens.css", "britannia.css"]);
const SCREENS = readdirSync(UI).filter((f) => f.endsWith(".css") && !SHARED.has(f)).sort();

// Each rule's selector list with the at-rules around it.
function rules(css: string): { selector: string; at: string[] }[] {
  const out: { selector: string; at: string[] }[] = [], open: string[] = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") { open.push(buf.trim()); buf = ""; }
    else if (ch === "}") { const p = open.pop(); if (p && !p.startsWith("@")) out.push({ selector: p, at: open.filter((o) => o.startsWith("@")) }); buf = ""; }
    else if (ch === ";" && !open.some((o) => !o.startsWith("@"))) buf = "";
    else buf += ch;
  }
  return out;
}
// Split at `sep` outside parentheses and brackets.
function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && sep.test(ch)) { out.push(cur); cur = ""; } else cur += ch;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}
const selectorsOf = (list: string): string[] => splitTop(list, /,/).map((s) => s.replace(/\s+/g, " ").replace(/\s*([>+~])\s*/g, " $1 ").replace(/\( /g, "("));
// The classes on the selector's subject: its last compound, without what :not() and :has() name.
function subjectClasses(sel: string): string[] {
  const last = splitTop(sel, /[\s>+~]/).at(-1) ?? "";
  return [...last.replace(/:(not|has)\((?:[^()]|\([^()]*\))*\)/g, "").matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
}

// The text and icon utilities a screen narrows in place (a flex share, a color in context): not components.
const UTILITIES = new Set(["pr", "muted", "faint", "strong", "mono", "num", "ellip", "caps", "i", "i-sm", "sr", "spacer", "t-sm", "t-md", "t-lg", "t-xl", "t-2xl"]);
const COMPONENTS = new Set<string>();
for (const r of rules(read("components.css"))) for (const sel of selectorsOf(r.selector)) {
  const own = sel.replace(/^(\.pr|:where\(\.pr\)) /, "");
  const m = /^[a-z]*\.([\w-]+)(?:\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?)*$/.exec(own);
  if (m && !UTILITIES.has(m[1]!)) COMPONENTS.add(m[1]!);
}

// Today's overrides, per stylesheet, under the reason each is there. "Placement" sets only how the component sits in
// the screen's own layout (its flex share, width, alignment or margin); "smaller" and "look" are variants a component
// option could carry instead.
const PLACEMENT = "placement: the component's share, width, alignment or margin in the screen's layout";
const FRAME = "the screen's page frame: its own direction, scrolling or width";
const ALLOWED: Record<string, [reason: string, selectors: string[]][]> = {
  "builder.css": [
    [FRAME, ["#tab-builder .page.b-page", "#tab-builder.manual > .page"]],
    [PLACEMENT, [".b-tpl-row .select", ".pr .b-race-row .b-str .input", ".pr .rule-row .input.num", ".rule-row .field-error", ".rule-row.cap .badge", ".b-switches .check", ".pr .b-adv .input", ".b-checks .check", ".b-act .rowact", ".b-details .kv", ".b-cmp-bar .check", ".b-cmp-col .b-row > .badge", ".mb-suit .card-head", ".mb-fill .progress", ".mb-browser .tbl-foot", ".mb-delta .tag", ".bf-hint .msg-body", ".bf-hint .msg-actions", ".pr .bf-skill .input.num.bf-wide"]],
    ["smaller: the Manual suit's card head, the buff list's skill fields, check strip and picker popover are denser than the defaults", [".mb-suit > .card-head", ".pr .bf-skill .input.num", ".bf-strip > .check", ".pop-body:has(> .bf-pick)"]],
    ["look: a set cap or planned skill field is outlined in the accent, a pressed row button is filled, a planned buff token is dashed, the buff tags are tinted, the pick list is regular weight", [".pr .rule-row .input.cap-set:not([aria-invalid=\"true\"])", ".pr .bf-skill .input.num.bf-plan", ".pr .rowact .btn.on", ".token.bf-planned", ".tag.bf-tag-accent", ".tag.bf-tag-ok", ".pr .b-pick-list .menu-item"]],
  ],
  "characters.css": [
    [PLACEMENT, ["#char-table .char-name .badge", ".res-cell .meter", ".kpi-value .badge", ".sheet .slot > .badge", ".pop.item-pop .pop-body > .btn"]],
    ["smaller: the sheet's tight key-value lists and the item popover", [".kv.kv-tight .kv-k", ".kv.kv-tight .kv-v", ".pop.item-pop .pop-body"]],
    ["look: a resist at its cap is outlined in success; the sheet's slots are buttons, with the slot's own look kept on hover and focus", [".resist.at-cap", ".pr .sheet button.slot", ".sheet .slot.empty", ".pr .sheet button.slot:hover", ".pr .sheet button.slot:focus-visible"]],
  ],
  "house-map.css": [
    [PLACEMENT, [".map-levels > .pill", "#tab-map .map-page > :is(.msg, .map-empty, .panel)", ".map-area-row > .btn", ".map-area-new-field > .input", ".map-stage > .msg", ".map-house-title > .btn", ".map-where-coords > .btn", ".map-drawer-fill > .meter", ".map-drawer-tabs > .seg", ".map-drawer-pick > .select", ".map-drawer-tools > .input", ".map-drawer-body > .msg", ".map-item-l1 > .tag", ".map-item-l2 > .rar-tier", ".sp-l2 > .meter"]],
    ["the world map dialog fills the window", [".pr dialog.dialog.world-map-dialog", ".world-map-dialog .dialog-body", ".world-map-dialog .dialog-foot"]],
    ["smaller: the top bar's search field (room for its count, no native clear button) and the Stack plan's area badges", [".map-search .input", ".map-search .input::-webkit-search-cancel-button", ".sp-area-name .badge"]],
    ["look: an area's color dot, and the search field highlighted while a search is shown", [".map-pill.dot", ".map-search.active .input"]],
  ],
  "inventory.css": [
    [FRAME, ["#tab-inventory .page"]],
    [PLACEMENT, [".inv-search .input", ".scr-search .input", ".inv-toolbar .fchip", ".inv-active .token", ".inv-tags .tag", ".inv-tbl .rowact .tipwrap", ".inv-state .empty-state", ".peek-sec .kv-v", ".peek-dur .meter", ".peek-acts .tipwrap", ".peek-acts .tipwrap .btn", ".inv-pop-sec > .search", ".inv-rule .input.num", ".cont-fill .meter", ".scr-tbl td.scr-state > .msg", ".scr-list > li > .badge", ".scr-list > li > .tag"]],
    ["narrow window: the toolbar sheds the filter chips that are not set", [".inv-toolbar .fchip[data-facet]:not(.set)"]],
    ["the row actions float over the row's last cell, shown on hover, focus or selection", [".inv-tbl td.act-cell .rowact", ".inv-tbl tr.item:hover td.act-cell .rowact", ".inv-tbl tr.item:focus-within td.act-cell .rowact", ".inv-tbl tr.sel td.act-cell .rowact"]],
    ["smaller: the peek's resist tiles, the filter popovers, the property menu's More row and the Scrolls view's badges and meters", [".peek-resists .resist", ".inv-pop .pop-body", ".inv-settings-pop .pop-body", ".pr .menu-item.inv-more", ".scr-skill > .badge", ".scr-next > .meter", ".scr-peek .peek-meta .badge", ".scr-chips > .badge"]],
    ["look: the peek's property keys in body text (muted where the item lacks it), and a picked property in the property menu", [".peek-props .kv-k", ".peek-props .kv-k.muted", ".peek-props .kv-v.muted", ".pr .menu-item.inv-prop", ".pr .menu-item.inv-prop[aria-selected=\"true\"]"]],
  ],
  "organize.css": [
    [PLACEMENT, [".org-target .meter", ".org-trip > .tbl", ".auto-section > .seg"]],
    ["spacing: the empty Organize screen and the Auto organize drawer's sections", [".org-empty .empty-state", "#auto-drawer .drawer-body"]],
  ],
  "runs.css": [
    [PLACEMENT, [".run-rename .input"]],
    ["the runs drawer is wide and tightly padded, and its popovers open above it", [".drawer.runs-drawer", ".drawer-body.runs-body", ".pop.pop-over-drawer"]],
  ],
  "shell.css": [
    ["the shell's own frame: the page column, and the sidebar collapsed to icons (these parts are drawn only by the shell)", [".shell", ".sidebar", ".shell.collapsed .sidebar", ".shell.collapsed .brand", ".shell.collapsed .nav-item", ".shell.collapsed :is(.nav-label, .brand-name, .bridge-label)", ".shell.collapsed :is(.nav-item .count, .nav-item .kbd, .sidebar-meta, .bridge > .i)", ".shell.collapsed .sidebar-foot", ".shell.collapsed .bridge", ".shell.collapsed .topbar", ".shell.collapsed .page", ".screen > .page"]],
    [PLACEMENT, [":is(#notice, #update-notice) > .btn"]],
  ],
  "styles.css": [
    ["the legacy shared sheet (docs/ui.md, Stylesheets): the older field and tag looks, until their screens move onto components", [".field", ".tag", ".tag.cursed", ".tag.brittle", ".tag.antique", ".tag.slayer", ".tipcard-host .tip-head .tag"]],
  ],
  "wizard.css": [
    ["the wizard dialog's own width", [".pr dialog.dialog.wizard"]],
    [PLACEMENT, [".wiz-path-row > .input"]],
  ],
};

const allowed = (file: string): Set<string> => new Set((ALLOWED[file] ?? []).flatMap(([, s]) => s));
function overrides(file: string): Set<string> {
  const out = new Set<string>();
  for (const r of rules(read(file))) for (const sel of selectorsOf(r.selector)) if (subjectClasses(sel).some((c) => COMPONENTS.has(c))) out.add(sel);
  return out;
}

test("[smoke] css-guard: the component classes are read from components.css", () => {
  for (const c of ["btn", "badge", "input", "meter", "pill", "resist", "kv-k", "dialog"]) assert.ok(COMPONENTS.has(c), c);
  assert.ok(!COMPONENTS.has("muted"));
});

test("[smoke] css-guard: no screen stylesheet restyles a component beyond the listed overrides", () => {
  const unlisted: string[] = [], gone: string[] = [];
  for (const file of SCREENS) {
    const found = overrides(file), ok = allowed(file);
    for (const s of found) if (!ok.has(s)) unlisted.push(`${file}: ${s}`);
    for (const s of ok) if (!found.has(s)) gone.push(`${file}: ${s}`);
  }
  for (const file of Object.keys(ALLOWED)) assert.ok(SCREENS.includes(file), `the list names ${file}, which is not a screen stylesheet`);
  assert.deepEqual(unlisted, [], "a screen stylesheet restyles a component class: make it a component option, or list it here with its reason");
  assert.deepEqual(gone, [], "a listed override is no longer in its stylesheet: take it off the list");
});

test("[smoke] css-guard: every @media width is a breakpoint", () => {
  const widths = new Set<number>(Object.values(BREAKPOINTS)), bad: string[] = [];
  for (const file of readdirSync(UI).filter((f) => f.endsWith(".css"))) {
    for (const m of read(file).matchAll(/@media[^{]*/g)) for (const [, side, px] of m[0].matchAll(/(min|max)-width:\s*(\d+)px/g)) {
      if (!widths.has(side === "min" ? Number(px) - 1 : Number(px))) bad.push(`${file}: ${m[0].trim()}`);
    }
  }
  for (const file of readdirSync(UI).filter((f) => f.endsWith(".mts") && f !== "breakpoints.mts")) {
    if (/\((?:min|max)-width:/.test(readFileSync(join(UI, file), "utf8"))) bad.push(`${file} writes its own width query: use breakpoints.mts`);
  }
  assert.deepEqual(bad, []);
});
