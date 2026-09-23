// contrast-probe.mts — measures WCAG contrast on the rendered page (design spec 2.3). probeContrast() runs
// INSIDE the page (Playwright's page.evaluate), so it must stay self-contained: no imports, no closures over
// module scope. For each visible element with its own text it takes the computed text colour and walks up the
// ancestors compositing every background (semi-transparent fills such as the scrim are blended down to an
// opaque layer), then computes the ratio. It also measures field values, placeholders, control boundaries
// (border against the surrounding fill, or fill against surrounding fill, whichever is stronger), switch
// edges and knobs, icons inside icon-only buttons, toasts and messages, and status dots. Subtrees marked
// aria-hidden="true" and hidden elements are skipped. Disabled controls need 3:1 text and no boundary.
// Used by scripts/ui-contrast.test.mts, which fails the build on any failing pair.

export interface ContrastRow {
  kind: "text" | "field-value" | "placeholder" | "boundary" | "switch-track" | "icon" | "status-dot";
  text: string;
  fg: string;
  bg: string;
  ratio: number;
  need: number;
  extra: string;
  disabled: boolean;
}

export function probeContrast(): ContrastRow[] {
  type RGBA = { r: number; g: number; b: number; a: number };
  const parse = (c: string): RGBA | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 };
  };
  const over = (top: RGBA, bot: RGBA): RGBA => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c: RGBA): number => { const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a: RGBA, b: RGBA): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c: RGBA): string => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const bgOf = (el: Element, skipSelf = false): RGBA => {
    const layers: RGBA[] = [];
    let n: Element | null = skipSelf ? el.parentElement : el;
    while (n) {
      const cs = getComputedStyle(n);
      // a tinted tile's corner wash (components.css .tint), taken at its strongest over the whole tile
      if (n.classList.contains("tint")) {
        const m = cs.getPropertyValue("--tint").trim().match(/^#([0-9a-f]{6})$/i), a = parseFloat(cs.getPropertyValue("--tint-a")) / 100;
        if (m && a > 0) { const v = parseInt(m[1]!, 16); layers.push({ r: v >> 16, g: (v >> 8) & 255, b: v & 255, a }); }
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      n = n.parentElement;
    }
    let acc: RGBA = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i]!, acc);
    return acc;
  };
  const hidden = (el: Element): boolean => {
    if (el.closest('[aria-hidden="true"]:not(svg)') || el.closest("[inert]")) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return true;
    const s = getComputedStyle(el);
    return s.visibility === "hidden" || s.display === "none" || +s.opacity === 0;
  };
  const disabledOf = (el: Element): boolean => !!el.closest("button[disabled], input[disabled], select[disabled], textarea[disabled], [aria-disabled=true]")
    || !!(el.closest("label")?.querySelector("input[disabled]")) || !!el.closest("option[disabled]");
  const label = (el: Element): string => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 60);
  const out: ContrastRow[] = [];
  const push = (kind: ContrastRow["kind"], el: Element, fg: RGBA, bg: RGBA, need: number, extra = ""): void => {
    out.push({ kind, text: label(el), fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2), need, extra, disabled: disabledOf(el) });
  };
  const CONTROLS = "button, input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea, .fchip, .token, .pill, .chip, .seg, .bridge, .slot:not(.empty), .kbd";
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "OPTION", "path", "circle", "rect"].includes(el.tagName)) continue;
    if (hidden(el)) continue;
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (ownText) {
      const fg0 = parse(s.color)!, bg = bgOf(el), fg = fg0.a < 1 ? over(fg0, bg) : fg0;
      const size = parseFloat(s.fontSize), w = +s.fontWeight;
      const large = size >= 24 || (size >= 18.66 && w >= 700);
      push("text", el, fg, bg, large ? 3 : 4.5, `${size}px/${w} .${el.className}`);
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !["checkbox", "radio", "range"].includes((el as HTMLInputElement).type)) {
      const bg = bgOf(el);
      if ((el as HTMLInputElement).value || el.tagName === "SELECT") push("field-value", el, parse(s.color)!, bg, 4.5, s.fontSize);
      if ((el as HTMLInputElement).placeholder) push("placeholder", el, parse(getComputedStyle(el, "::placeholder").color)!, bg, 4.5);
    }
    // control boundaries (UI component, 3:1): a control that draws an edge or a fill must stand out from
    // what surrounds it; a ghost control (no visible border, no fill of its own) has no edge to measure
    // (a segmented control's options sit inside the .seg frame, which is the edge that is measured)
    if (el.matches(CONTROLS) && !el.matches("input.switch") && !el.parentElement?.classList.contains("seg")) {
      const bc = parse(s.borderTopColor)!, around = bgOf(el, true), fill = bgOf(el);
      const hasBorder = parseFloat(s.borderTopWidth) > 0 && bc.a > 0;
      const ownFill = (parse(s.backgroundColor)?.a || 0) > 0;
      if (hasBorder || ownFill) {
        const edge = Math.max(hasBorder ? ratio(bc.a < 1 ? over(bc, around) : bc, around) : 1, ratio(fill, around));
        if (hasBorder || Math.abs(lum(fill) - lum(around)) > 0.001) {
          out.push({ kind: "boundary", text: label(el), fg: hex(bc), bg: hex(around), ratio: +edge.toFixed(2), need: 3, extra: String(el.className), disabled: disabledOf(el) });
        }
      }
    }
    // a switch's edge (its border, or its fill when that stands out more) against what surrounds it, and its
    // knob against the track it sits on
    if (el.matches("input.switch")) {
      const around = bgOf(el, true), fill = bgOf(el), bc = parse(s.borderTopColor)!;
      const hasBorder = parseFloat(s.borderTopWidth) > 0 && bc.a > 0;
      const edge = hasBorder && ratio(bc, around) > ratio(fill, around) ? bc : fill;
      push("switch-track", el, edge, around, 3);
      const knob = parse(getComputedStyle(el, "::after").backgroundColor);
      if (knob && knob.a > 0) push("switch-track", el, knob, fill, 3, "knob");
    }
    // icons that carry meaning: inside icon-only buttons, and status icons in toasts and messages
    if (el.matches("svg.i") && (el.closest("button[aria-label], a[aria-label]") || el.closest(".toast, .msg"))) {
      push("icon", el.closest("[aria-label]") || el.parentElement!, parse(s.color)!, bgOf(el.parentElement!), 3);
    }
    if (el.matches(".dot, .beat")) push("status-dot", el.parentElement!, parse(s.backgroundColor)!, bgOf(el, true), 3);
  }
  return out;
}

// The failing rows, by the spec's rule: text 4.5 (3 when large), boundaries/icons/dots 3, and a disabled
// control only needs its text at 3.0 (its boundary is exempt).
export const DISABLED_TEXT_MIN = 3.0;
export function failures(rows: readonly ContrastRow[]): ContrastRow[] {
  return rows.filter((r) => (r.disabled ? r.kind !== "boundary" && r.ratio < DISABLED_TEXT_MIN : r.ratio < r.need));
}
// One line per distinct failing colour pair, with a count and an example, for an assertion message.
export function describeFailures(rows: ReadonlyArray<ContrastRow & { where?: string }>): string {
  const byPair = new Map<string, { row: ContrastRow & { where?: string }; n: number }>();
  for (const r of rows) {
    const k = `${r.kind}|${r.fg}|${r.bg}|${r.need}|${r.disabled}`;
    const got = byPair.get(k);
    if (got) got.n++; else byPair.set(k, { row: r, n: 1 });
  }
  return [...byPair.values()].map(({ row: r, n }) => `${r.kind} ${r.fg} on ${r.bg} = ${r.ratio} (need ${r.disabled ? DISABLED_TEXT_MIN : r.need}) x${n}, e.g. "${r.text}" ${r.where || ""} ${r.extra}`).join("\n");
}
