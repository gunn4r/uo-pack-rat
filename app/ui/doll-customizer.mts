// ui/doll-customizer.mts — the doll card's Customize popover (issue #57): race, gender, skin, hair, and facial hair with its color, from the game's own character-creation choices (GET /api/paperdoll/options), so only valid combinations are offered (customize-model.mts). Every change redraws the figure. It never changes data: the look lives in memory for this session and Reset gives the scan back. Keyboard: Tab between the groups, the arrow keys within a segmented control or a swatch grid (one tab stop each), Enter or Space to pick, Esc or Close to close with focus back on the button.
//
// map: house
// owns: `openCustomizer`
import { api } from "./api.mts";
import { box, button, check, message, popover, segmented, select, txt } from "./components.mts";
import { el } from "./dom.mts";
import { showSettings } from "./nav.mts";
import { choiceOf, hasFacialHair, lookOfChoice, repick, sameLook, type Choice } from "./customize-model.mts";
import type { HueColorsApiResponse, PaperdollOptionsApiResponse, Swatch } from "./api-types.mts";
import type { Look, Race } from "../paperdoll-look.mts";

// The choices, asked once a session (again after a failure).
let options: Promise<PaperdollOptionsApiResponse | null> | null = null;
const loadOptions = (): Promise<PaperdollOptionsApiResponse | null> => (options ??= api<PaperdollOptionsApiResponse>("/api/paperdoll/options").catch(() => { options = null; return null; }));

const COLUMNS = 18;
// A palette as a radiogroup of swatches, 18 to a row: one tab stop (the picked swatch); the arrow keys move and pick (Up and Down by a row), Home and End go to the ends.
// `current`: the scanned value when the palette lacks it (a dyed color), offered first as "Current" so it can be picked again.
function swatchGrid(id: string, label: string, noun: string, list: Swatch[], value: number, onPick: (hue: number) => void, current: Swatch | null = null): HTMLElement {
  const all = current && !list.some((s) => s.hue === current.hue) ? [current, ...list] : list;
  const cells = all.map((s) => { const name = s === current ? `Current ${noun.toLowerCase()} color, hue ${s.hue}` : `${noun} hue ${s.hue}`;
    return el("button", { type: "button", class: `doll-swatch${s === current ? " doll-swatch-current" : ""}`, role: "radio", "aria-checked": String(s.hue === value), "aria-label": name, title: name, style: `background:${s.color}`, tabindex: s.hue === value ? "0" : "-1", "data-hue": String(s.hue) }); });
  if (!cells.some((c) => c.tabIndex === 0) && cells[0]) cells[0].tabIndex = 0;
  const grid = box("div", { class: "doll-swatches", role: "radiogroup", "aria-label": label, id }, ...cells);
  grid.addEventListener("click", (e) => { const c = (e.target as HTMLElement).closest<HTMLElement>(".doll-swatch"); if (c) onPick(Number(c.dataset.hue)); });
  grid.addEventListener("keydown", (e) => {
    const i = cells.indexOf(e.target as HTMLButtonElement);
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + COLUMNS, ArrowUp: i - COLUMNS, Home: 0, End: cells.length - 1 } as Record<string, number>)[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    onPick(Number(cells[Math.max(0, Math.min(cells.length - 1, to))]!.dataset.hue));
  });
  return grid;
}
// A labelled group of controls (a radiogroup has no <label for>).
const group = (id: string, label: string, ...kids: Array<HTMLElement | null>): HTMLElement =>
  box("div", { class: "doll-group", role: "group", id, "aria-labelledby": `${id}-label` }, el("span", { class: "label", id: `${id}-label` }, label), ...kids);
const RACES: Array<{ value: Race; label: string }> = [{ value: "human", label: "Human" }, { value: "elf", label: "Elf" }, { value: "gargoyle", label: "Gargoyle" }];

export interface CustomizerOptions {
  // The look the popover starts from and Reset gives back: the scan's, or the stand-in.
  scanned: Look;
  // The look made this session, if any.
  custom: Look | null;
  // The scanned look is the stand-in (no character, no look, a form's body).
  standIn: boolean;
  nobody: boolean;
  // A new look, or null for Reset.
  onChange: (look: Look | null) => void;
}
// The colors of a look's hues outside the palettes (GET /api/hue-colors), for its "Current" swatches; none when the request fails.
async function colorsOf(hues: number[]): Promise<Map<number, string>> {
  if (!hues.length) return new Map();
  try { return new Map(Object.entries((await api<HueColorsApiResponse>(`/api/hue-colors?hues=${hues.join(",")}`)).colors).map(([h, c]) => [Number(h), c])); } catch { return new Map(); }
}
// Opens the popover from the card's Customize button, beside the card so the figure stays in view while it redraws.
export function openCustomizer(anchor: HTMLElement, beside: HTMLElement, o: CustomizerOptions): void {
  const start = choiceOf(o.custom ?? o.scanned), scanned = choiceOf(o.scanned);
  void loadOptions().then(async (got) => {
    // The scanned look's own values the game's lists lack, kept as "Current" choices while the race and gender are the scan's.
    const r0 = got?.races[scanned.race], offPalette = (hue: number, list: Swatch[] | undefined): boolean => hue !== 0 && !!list && !list.some((s) => s.hue === hue);
    const colors = await colorsOf([...new Set([offPalette(scanned.skin, r0?.skin) ? scanned.skin : 0, ...[scanned.hairHue, scanned.facialHue].filter((h) => offPalette(h, r0?.hair))].filter(Boolean))]);
    const currentSwatch = (hue: number): Swatch | null => (offPalette(hue, hue === scanned.skin ? r0?.skin : r0?.hair) ? { hue, color: colors.get(hue) ?? "transparent" } : null);
    const body = box("div", { class: "doll-custom", id: "doll-custom" });
    const close = button({ label: "Close", size: "sm", variant: "ghost", attrs: { id: "doll-c-close" }, onClick: () => handle.close() });
    const handle = popover(anchor, [body], { label: "Customize the figure", width: 312, beside });
    if (!got) {
      body.replaceChildren(message({ tone: "warn", title: "Customizing needs your client files", text: "Choose your UO folder in Settings › Game client.", actions: [button({ label: "Open Settings", size: "sm", onClick: () => { handle.close(); showSettings("set-uofolder"); } })] }), box("div", { class: "doll-custom-foot" }, close));
      handle.place();
      close.focus();
      return;
    }
    const races = got.races;
    let custom = o.custom, choice = start;
    const change = (next: Choice): void => {
      choice = repick(choice, next, races);
      const look = lookOfChoice(choice, o.scanned);
      custom = sameLook(look, o.scanned) ? null : look;
      o.onChange(custom);
      draw();
    };
    const reset = (): void => { custom = null; choice = scanned; o.onChange(null); draw(); };
    function draw(): void {
      // The redraw keeps keyboard focus on the same control (in a swatch grid, on the swatch now picked).
      const focused = document.activeElement as HTMLElement | null, inside = focused && body.contains(focused) ? (focused.closest("[id]") as HTMLElement | null)?.id : null;
      const r = races[choice.race], styles = choice.female ? r.hairStyles.female : r.hairStyles.male;
      // the scan's own values are offered while the race and gender are still the scan's
      const asScanned = choice.race === scanned.race && choice.female === scanned.female;
      const current = (hue: number): Swatch | null => (asScanned ? currentSwatch(hue) : null);
      const styleSelect = (id: string, list: Array<{ graphic: number; label: string }>, value: number, pick: (g: number) => void, scannedStyle: number): HTMLSelectElement => {
        const own = asScanned && scannedStyle && !list.some((x) => x.graphic === scannedStyle) ? [{ graphic: scannedStyle, label: "Current style" }] : [];
        const s = select([...own, ...list].map((x) => ({ value: String(x.graphic), label: x.label })), String(value), { size: "sm", attrs: { id, "aria-label": id === "doll-c-hair" ? "Hair style" : "Facial hair style" } });
        s.addEventListener("change", () => pick(Number(s.value)));
        return s;
      };
      const facial = hasFacialHair(choice)
        ? [styleSelect("doll-c-facial", r.facialHair, choice.facialStyle, (g) => change({ ...choice, facialStyle: g }), scanned.facialStyle),
          check({ label: "Facial hair color same as hair", checked: choice.facialSameAsHair, attrs: { id: "doll-c-same" }, onChange: (on) => change({ ...choice, facialSameAsHair: on }) }).root,
          choice.facialSameAsHair ? null : swatchGrid("doll-c-facial-hue", "Facial hair color", "Facial hair", r.hair, choice.facialHue, (hue) => change({ ...choice, facialHue: hue }), current(scanned.facialHue))]
        : [txt(choice.race === "elf" ? "Elves have none in the game." : "Male characters only.", "t-sm muted")];
      body.replaceChildren(...[
        group("doll-c-race", "Race", segmented({ label: "Race", options: RACES, value: choice.race, size: "sm", onChange: (v) => change({ ...choice, race: v as Race }) })),
        group("doll-c-gender", "Gender", segmented({ label: "Gender", options: [{ value: "m", label: "Male" }, { value: "f", label: "Female" }], value: choice.female ? "f" : "m", size: "sm", onChange: (v) => change({ ...choice, female: v === "f" }) })),
        group("doll-c-skin-group", "Skin", swatchGrid("doll-c-skin", "Skin", "Skin", r.skin, choice.skin, (hue) => change({ ...choice, skin: hue }), current(scanned.skin))),
        group("doll-c-hair-group", "Hair", styleSelect("doll-c-hair", styles, choice.hairStyle, (g) => change({ ...choice, hairStyle: g }), scanned.hairStyle), swatchGrid("doll-c-hair-hue", "Hair color", "Hair", r.hair, choice.hairHue, (hue) => change({ ...choice, hairHue: hue }), current(scanned.hairHue))),
        group("doll-c-facial-group", "Facial hair", ...facial),
        choice.race === "gargoyle" ? message({ tone: "warn", text: "Gargoyles can only wear gargoyle gear in the game; this preview shows the pieces anyway." }) : null,
        box("div", { class: "doll-custom-foot" },
          button({ label: o.standIn ? "Reset to default" : "Reset to scan", size: "sm", disabled: !custom, attrs: { id: "doll-c-reset" }, onClick: reset }), close,
          txt(o.nobody ? "No character: kept for this session only." : "Just for this session: the scan wins after a reload.", "t-sm muted doll-custom-note")),
      ].filter((k): k is HTMLElement => k !== null));
      // segmented() and the swatch grids put their one tab stop on the picked option: focus it again after the redraw.
      if (inside) { const g = body.querySelector<HTMLElement>(`#${inside}`); (g?.querySelector<HTMLElement>("[tabindex='0']") ?? g)?.focus(); }
      // A control that cannot take focus back (Reset, disabled once nothing differs) hands it to Close, so Esc still closes the popover.
      if (inside && !body.contains(document.activeElement)) close.focus();
      // its height changes with the race and the facial-hair choices: keep it on screen
      handle.place();
    }
    draw();
    body.querySelector<HTMLElement>("#doll-c-race [tabindex='0']")?.focus();
  });
}
