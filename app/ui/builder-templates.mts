// ui/builder-templates.mts — the Suit Builder's templates (issue #336): the Manage templates drawer and what it does (Save as,
// Update, Rename, Duplicate, Delete), and a template picked as the panel's starting point (pickTemplate, from the build
// picker or a first-visit card). It reads and sets the panel's profile through ui/builder-session.mts, and redraws the panel
// and saves the character's profile through ui/builder.mts's `commands`.
//
// map: builder
// owns: `pickTemplate`, `saveTemplateAs`, `openTemplatesDrawer`
import { NOBODY } from "../vault-lib.mts";
import { BUILTIN_PREFIX, TEMPLATE_NAME_MAX, findTemplate, templateRefs, templateSettings, templateSpecFrom } from "../build-spec.mts";
import { buffById } from "../buffs.mts";
import { state } from "./store.mts";
import { el, label } from "./dom.mts";
import { promptText } from "./dialog.mts";
import { box, txt, button, icon, message, confirmDialog, createDrawer, type DrawerHandle, toast } from "./components.mts";
import { editProfiles, setCharacterBuffs, type ProfilesSave } from "./profiles.mts";
import type { ProfileEdit } from "../profile-edits.mts";
import { session, commands, announce, provide, readControls } from "./builder-session.mts";
import { buffsOn, plainName } from "./builder-parts.mts";
import { andList, needsLine, propName, topWeights, who } from "./builder-model.mts";

// ---- the Manage templates drawer (issue #336): the shared drawer, like Saved runs. At its top, Save the current build settings
// as a template; then the player's templates as cards (name, description, when it was changed, the characters that use it,
// this build marked), each opening to a one-line summary and Update with the current build settings, Rename, Duplicate and
// Delete, confirmed in the card with who uses it; then the built-ins, read-only, with Duplicate only. Redrawn after every change.
let templatesDrawer: DrawerHandle | null = null;
let openCard: string | null = null, askDelete: string | null = null;
function openTemplatesDrawer(from: HTMLElement): void {
  templatesDrawer ??= createDrawer({ id: "tpl-drawer", title: "Manage templates", wide: true });
  openCard = session.profile?.template && Object.hasOwn(state.profiles!.templates, session.profile.template) ? session.profile.template : null;
  askDelete = null;
  paintTemplatesDrawer();
  templatesDrawer!.open(from);
}
// The characters whose saved settings came from a template; the card adds this build when its settings did.
const savedUsers = (ref: string): string[] => Object.keys(state.profiles!.characters).filter((c) => state.profiles!.characters[c]!.template === ref);
// A template's settings in one line: what it needs, its top weights, its buffs.
function templateSummary(t: NonNullable<ReturnType<typeof findTemplate>>): string {
  const st = templateSettings(t), top = topWeights(st.weights || {}).rows.map((r) => propName(r.key)), buffs = (t.spec.buffs?.on ?? []).map((id) => buffById(id)?.name ?? id);
  return [`Needs: ${needsLine(st.floors || {}, st.softFloors || [], label) || "nothing"}`, `Weights: ${top.join(", ") || "none"}`, `Buffs: ${buffs.join(", ") || "none"}`].join(" · ");
}
function paintTemplatesDrawer(): void {
  if (!templatesDrawer) return;
  const own = Object.keys(state.profiles!.templates).sort((a, b) => a.localeCompare(b)), builtins = templateRefs(state.profiles!, state.builtinTemplates).filter((r) => r.startsWith(BUILTIN_PREFIX));
  const changed = (iso?: string): string => (iso ? `changed ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "");
  const card = (ref: string): HTMLElement => {
    const t = state.profiles!.templates[ref]!, saved = savedUsers(ref), open = openCard === ref, bodyId = `tm-${ref.replace(/[^\w-]/g, "_")}`;
    const me = session.character && session.profile?.template === ref ? session.character : null, users = me ? [me, ...saved.filter((u) => u !== me)] : saved;
    const chips = box("span", { class: "tm-users" }, ...(users.length ? users.map((u) => txt(u === me ? `${who(u)} (this build)` : who(u), `tm-chip${u === me ? " tm-cur" : ""}`)) : [txt("no one uses it", "tm-chip")]));
    const head = box("button", { type: "button", class: "tm-head", "aria-expanded": String(open), ...(open ? { "aria-controls": bodyId } : {}), "data-tm": `${ref}\u0000head`, onclick: () => { openCard = open ? null : ref; askDelete = null; paintTemplatesDrawer(); } },
      box("span", { class: "tm-titles" }, txt(ref, "strong"), txt([t.description, changed(t.savedAt)].filter(Boolean).join(" · ") || "Your template", "t-sm muted"), chips), icon(open ? "chevron-up" : "chevron-down", { size: "sm" }));
    const more = !open ? null : box("div", { class: "tm-more", id: bodyId }, txt(templateSummary(t), "t-sm muted"),
      askDelete === ref
        ? message({ tone: "warn", text: `Delete “${ref}”? ${saved.length ? `Characters made from it (${andList(saved.map(who))}) keep their settings; they just stop showing “from ${ref}”.` : "No one uses it."}`,
          actions: [button({ label: "Cancel", size: "sm", attrs: { "data-tm": `${ref}\u0000delete` }, onClick: () => { askDelete = null; paintTemplatesDrawer(); } }), button({ label: `Delete ${ref}`, size: "sm", variant: "danger", attrs: { "data-tm": `${ref}\u0000confirm` }, onClick: () => { void deleteTemplate(ref, true); } })] })
        : box("div", { class: "tm-acts" },
          button({ label: `Update ${ref} with the current build settings`, size: "sm", variant: "primary", disabled: !session.profile, attrs: { "data-tm": `${ref}\u0000update` }, onClick: () => { void updateTemplate(ref); } }),
          button({ label: "Rename", size: "sm", attrs: { "aria-label": `Rename ${ref}`, "data-tm": `${ref}\u0000rename` }, onClick: () => { void renameTemplate(ref); } }),
          button({ label: "Duplicate", size: "sm", attrs: { "aria-label": `Duplicate ${ref}`, "data-tm": `${ref}\u0000duplicate` }, onClick: () => { void duplicateTemplate(ref); } }),
          button({ label: "Delete…", size: "sm", variant: "danger-outline", attrs: { "aria-label": `Delete ${ref}…`, "data-tm": `${ref}\u0000delete` }, onClick: () => { askDelete = ref; paintTemplatesDrawer(); } })));
    return box("section", { class: `tm-card${open ? " tm-open" : ""}`, "data-template": ref }, head, more);
  };
  const builtin = (ref: string): HTMLElement => box("section", { class: "tm-card", "data-template": ref },
    box("div", { class: "tm-head tm-static" }, box("span", { class: "tm-titles" }, txt(plainName(ref), "strong"), txt("Ships with Pack Rat · read-only", "t-sm muted")),
      button({ label: "Duplicate", size: "sm", attrs: { "aria-label": `Duplicate ${plainName(ref)}`, "data-tm": `${ref}\u0000duplicate` }, onClick: () => { void duplicateTemplate(ref); } })));
  // the focus stays on the same control across the redraw (a dialog closing hands it back to one this replaces), else goes to
  // the card shown open (Delete's Cancel or confirm, a new copy), else to Save as template
  const body = templatesDrawer.body, was = (document.activeElement as HTMLElement | null)?.dataset?.tm ?? (body.contains(document.activeElement) || document.activeElement === document.body ? "" : null);
  body.replaceChildren(
    button({ label: "Save the current build settings as a template…", icon: "plus", disabled: !session.profile, attrs: { id: "tm-save", "data-tm": "\u0000save" }, onClick: () => { void saveTemplateAs(); } }),
    el("h3", { class: "tm-h" }, `Your templates · ${own.length}`), ...(own.length ? own.map(card) : [txt("No templates of your own yet.", "muted")]),
    el("h3", { class: "tm-h" }, `Built in · ${builtins.length}`), ...builtins.map(builtin));
  if (was == null || !templatesDrawer.isOpen()) return;
  const at = (k: string): HTMLElement | null => [...body.querySelectorAll<HTMLElement>("[data-tm]")].find((n) => n.dataset.tm === k) ?? null;
  const ref = was.split("\u0000")[0]!;
  (at(was) ?? (askDelete ? at(`${askDelete}\u0000delete`) : null) ?? (openCard ? at(`${openCard}\u0000head`) : null) ?? at(`${ref}\u0000head`) ?? body.querySelector<HTMLElement>("#tm-save"))?.focus();
}
// A free name for a copy: "<name> copy", then "<name> copy 2"…
function copyName(base: string): string {
  for (let i = 1; ; i++) { const n = i === 1 ? `${base} copy` : `${base} copy ${i}`; if (!Object.hasOwn(state.profiles!.templates, n)) return n; }
}
// The player's names: not empty, not built-in, not taken (unless it is the same one).
async function askTemplateName(title: string, value: string, was = ""): Promise<string | null> {
  const name = (await promptText({ title, value }))?.trim();
  if (!name || name === was) return null;
  if (name.startsWith(BUILTIN_PREFIX)) { toast(`A template's name can't start with "${BUILTIN_PREFIX}".`, "bad"); return null; }
  if (name.length > TEMPLATE_NAME_MAX) { toast(`A template's name is at most ${TEMPLATE_NAME_MAX} characters.`, "bad"); return null; }
  if (Object.hasOwn(state.profiles!.templates, name)) { toast(`There is already a template named ${name}.`, "bad"); return null; }
  return name;
}
async function renameTemplate(ref: string): Promise<void> {
  const name = await askTemplateName(`Rename ${ref}`, ref, ref);
  if (!name) return;
  // the characters made from it, and this build, now say "from <new name>"
  const saving = saveTemplates(`Template ${ref} renamed to ${name}.`, [{ op: "renameTemplate", from: ref, to: name }]);
  const pointed = session.profile?.template === ref, opened = openCard === ref;
  if (pointed) session.profile!.template = name;
  if (opened) openCard = name;
  announce("panel");
  paintTemplatesDrawer();
  if (!(await saving).ok && (pointed || opened)) unpoint(name, ref);
}
async function duplicateTemplate(ref: string): Promise<void> {
  const from = findTemplate(state.profiles!, state.builtinTemplates, ref);
  if (!from) return;
  const name = await askTemplateName(`Duplicate ${plainName(ref)}`, copyName(plainName(ref)));
  if (!name) return;
  const copy = { spec: structuredClone(from.spec), ...(from.description ? { description: from.description } : {}), savedAt: new Date().toISOString() };
  // never over a template by that name made elsewhere since the name was checked
  const saving = saveTemplates(`Template ${name} saved.`, [{ op: "putTemplate", id: name, entry: copy, create: true }]);
  const back = openCard ?? undefined;
  openCard = name;
  announce("panel");
  paintTemplatesDrawer();
  if (!(await saving).ok) unpoint(name, back);
}
// The copy changes when it is read again, and when a failed save puts it back, so either redraws.
async function saveTemplates(done: string, edits: ProfileEdit[]): Promise<ProfilesSave> {
  const r = await editProfiles(edits);
  // a refused save always says why
  toast(r.ok ? done : r.error!, r.ok ? "good" : "bad");
  if (r.reloaded || !r.ok) { announce("panel"); paintTemplatesDrawer(); }
  return r;
}
// After a refused save, the build and the open card go back to the template they showed before it (the name may be
// another window's template), unless something else was picked meanwhile.
function unpoint(name: string, back: string | undefined): void {
  if (session.profile?.template === name) { if (back === undefined) delete session.profile.template; else session.profile.template = back; }
  if (openCard === name) openCard = back ?? null;
  announce("panel");
  paintTemplatesDrawer();
}
// A template's settings into the panel. A template with buffs also sets the character's buffs, which are saved at once, and
// Manual's when Manual is for the same character (one undo step there).
function applyTemplate(ref: string): void {
  const t = findTemplate(state.profiles!, state.builtinTemplates, ref), name = plainName(ref);
  if (!t) return;
  Object.assign(session.profile!, templateSettings(t), { template: ref });
  if (t.spec.buffs) {
    // No character's numbers are Manual's (ui-prefs), not its entry's
    if (session.character === NOBODY) { setCharacterBuffs(NOBODY, { on: t.spec.buffs.on }); commands.editBuffInputs(NOBODY, t.spec.buffs.skills); }
    else setCharacterBuffs(session.character!, { on: t.spec.buffs.on, skills: { ...commands.buffEditsOf(session.character!), ...t.spec.buffs.skills } });
    commands.templateBuffs(t.spec.buffs.on, `${name} buffs`);
  }
  announce("caps");
  announce("panel");
}
// A template picked as the starting point: a card in the first-visit view (ui/builder-start.mts), or a template in the build
// picker ("Start over from"). It applies the template and saves it as the character's settings, so a build from it comes back
// with nothing changed. When there is something to lose (the panel differs from its template, or from the character's saved
// settings) it asks first. A card of the panel's own template applies nothing again; picked in the build picker (`again`),
// the panel's own template starts it over when it changed.
async function pickTemplate(ref: string, again = false): Promise<void> {
  const name = session.character!, p = session.profile!, st = commands.buildState();
  if (ref === p.template && (!again || (!st.drift && !st.unsaved))) return;
  if ((st.drift || st.unsaved) && !await confirmDialog({ title: `Replace ${who(name)}'s saved settings with ${plainName(ref)}?`,
    body: "Your current settings are only kept in runs built with them.", confirmLabel: "Replace" })) return;
  if (session.character !== name || session.profile !== p) return;   // another character picked while it asked
  applyTemplate(ref);
  commands.saveProfile(`${plainName(ref)} saved as ${who(session.character!)}'s settings.`);
}
async function saveTemplateAs(): Promise<void> {
  if (!session.profile) return;
  const was = session.profile!.template || "";
  const name = await promptText({ title: "Template name", value: was.startsWith(BUILTIN_PREFIX) ? "" : was });
  if (name?.startsWith(BUILTIN_PREFIX)) { toast(`A template's name can't start with "${BUILTIN_PREFIX}".`, "bad"); return; }
  if (name && name.length > TEMPLATE_NAME_MAX) { toast(`A template's name is at most ${TEMPLATE_NAME_MAX} characters.`, "bad"); return; }
  const existed = !!name && Object.hasOwn(state.profiles!.templates, name);
  if (!name || (existed && !await confirmDialog({ title: `Overwrite the ${name} template?`, body: `The ${name} template is replaced with these settings.`, confirmLabel: `Overwrite ${name}` }))) return;
  const entry = { spec: templateSpecFrom(readControls(), buffsOn()), savedAt: new Date().toISOString() };
  // over the template by that name only when that was confirmed: never over one made elsewhere since the prompt
  const saving = saveTemplates(`Template ${name} saved.`, [{ op: "putTemplate", id: name, entry, ...(existed ? {} : { create: true }) }]);
  const back = session.profile!.template;
  session.profile!.template = name;
  announce("panel");
  paintTemplatesDrawer();
  if (!(await saving).ok) unpoint(name, back);
}
async function updateTemplate(name: string): Promise<void> {
  if (!Object.hasOwn(state.profiles!.templates, name) || !await confirmDialog({ title: `Update the ${name} template?`, body: `The ${name} template is overwritten with these settings.`, confirmLabel: `Update ${name}` })) return;
  // deleted elsewhere meanwhile: refused, not made again
  const saving = saveTemplates(`Template ${name} updated.`, [{ op: "updateTemplate", id: name, spec: templateSpecFrom(readControls(), buffsOn()), savedAt: new Date().toISOString() }]);
  session.profile!.template = name;
  commands.updateTemplateBadge();
  paintTemplatesDrawer();
  await saving;
}
// `confirmed`: asked already, in the Manage templates drawer's card.
async function deleteTemplate(name: string, confirmed = false): Promise<void> {
  if (!Object.hasOwn(state.profiles!.templates, name) || (!confirmed && !await confirmDialog({ title: `Delete the ${name} template?`, body: "Characters made from it keep their settings.", confirmLabel: `Delete ${name}` }))) return;
  const saving = saveTemplates(`Template ${name} deleted.`, [{ op: "deleteTemplate", id: name }]);
  askDelete = null;
  if (openCard === name) openCard = null;
  announce("panel");
  paintTemplatesDrawer();
  await saving;
}
provide({ pickTemplate: (ref, again) => { void pickTemplate(ref, again); }, saveTemplateAs: () => { void saveTemplateAs(); }, openTemplatesDrawer });
