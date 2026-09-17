// ui/dom.mjs — DOM helpers, formatting/label helpers, rarity, and the in-game style hover tooltip.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
import { SLOT_LABELS, labelOf, fullOf } from "../vault-lib.mjs";
import { EXTRA_COLS, rarityRank as rarityRankOf } from "../item-query.mjs";
import { state } from "./store.mjs";
import { resolveItems } from "./items.mjs";

export { EXTRA_COLS, colVal } from "../item-query.mjs";

export const $ = (s, el = document) => el.querySelector(s);
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (k === "html") e.innerHTML = v; else e.setAttribute(k, v); }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};
export const fmtWhen = (s) => s ? String(s).replace("T", " ").slice(0, 16) : "";
export const ago = (s) => { const d = (Date.now() - Date.parse(s)) / 864e5; return !isFinite(d) ? "" : d < 1 / 24 ? "just now" : d < 1 ? `${Math.round(d * 24)}h ago` : d < 30 ? `${Math.round(d)}d ago` : fmtWhen(s).slice(0, 10); };
// stale = last seen more than 7 days before the newest scan we have at all
export const isStale = (it) => state.newestScan && Date.parse(state.newestScan) - Date.parse(it.seenAt) > 7 * 864e5;
export const label = (k) => EXTRA_COLS[k]?.[0] || labelOf(k);
export const full = (k) => EXTRA_COLS[k]?.[1] || fullOf(k);
export const slotLabel = (s) => SLOT_LABELS[s] || s || "?";
// The rarity ladder (name, ascending, + the client's own tier colour read from the <BASEFONT COLOR>
// tags in scanned tooltips) is shard data now (state.rules.rarity, from GET /api/rules) rather than
// a hardcoded table — a shard with a different tier scheme ships its own app/rules/<shard>.json.
export const rarityRank = (name) => rarityRankOf(state.rules?.rarity || [], name);
export const rarityColor = (name) => { const r = (state.rules?.rarity || []).find((r) => r.name.toLowerCase() === String(name || "").toLowerCase()); return r ? r.colour : null; };
export const rarRank = (it) => rarityRank(it.rarity);
export const rarCell = (it) => it.rarity ? el("span", { style: `color:${rarityColor(it.rarity) || "inherit"};font-weight:500` }, it.rarity) : el("span", { class: "muted" }, "·");
// esc(t) — HTML-escape a value before interpolating it into an HTML STRING (sheetHtml and friends,
// which build markup with template literals rather than el()'s text nodes). Scan files are
// third-party adapter data (character names, skill names): a scan-supplied name landing in an HTML
// string unescaped is defacement (Phase 1's CSP already blocks script execution and exfiltration),
// but Phase 2 is precisely what makes scan files untrusted input, so anything built as a raw string
// must escape what it interpolates.
export const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

export const fmtN = (x) => (+x || 0).toLocaleString();
export const fmtSecs = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
export function fmtRunTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "?";
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

let toastTimer = null;
export function toast(text, cls = "") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = el("div", { class: "toast " + cls }, text); document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 6000);
}

// ---------------------------------------------------------------- in-game style tooltip
export function installTooltip() {
  const tip = $("#tip");
  const HOT_PROPS = /swing speed increase|defense chance increase|hit chance increase|faster casting|faster cast recovery|lower reagent cost|lower mana cost|spell damage increase/i;
  function tipLine(raw) {
    let color = null, bold = false, italic = false;
    let text = String(raw).replace(/<basefont[^>]*color=["']?(#[0-9a-f]{6})["']?[^>]*>/gi, (_, c) => { color = c; return ""; }).replace(/<\/?b>/gi, () => { bold = true; return ""; }).replace(/<[^>]+>/g, "").trim();
    if (/^\(?(imbued|exceptional|insured|blessed)\)?$/i.test(text)) { italic = true; text = text.replace(/[()]/g, ""); }
    return { text, color, bold, italic };
  }
  function tipHtml(it) {
    const lines = (it.lines || []).slice(1).map(tipLine);
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const head = [], info = [], body = [];
    let rarity = null;
    for (const l of lines) {
      const t = l.text;
      let m;
      if (/^(minor|lesser|greater|major|legendary) (magic item|artifact)$/i.test(t)) { rarity = l; continue; }
      if (/^crafted by /i.test(t) || l.italic) { head.push(l); continue; }
      if ((m = t.match(/^weapon damage\s+(.+)$/i))) { info.push(`<div><span class="t-key">Damage:</span> ${esc(m[1])}</div>`); continue; }
      if ((m = t.match(/^weapon speed\s+(.+)$/i))) { info.push(`<div><span class="t-key">Speed:</span> ${esc(m[1])}</div>`); continue; }
      if ((m = t.match(/^weight:?\s+(\d+)/i))) { info.push(`<div><span class="t-key">Weight:</span> ${m[1]}</div>`); continue; }
      if ((m = t.match(/^durability\s+(\d+)\s*\/\s*(\d+)/i))) { const pct = Math.max(0, Math.min(100, 100 * +m[1] / (+m[2] || 1))); info.push(`<div><span class="t-key">Durability:</span> ${m[1]} / ${m[2]}</div><div class="t-dur"><div style="width:${pct}%"></div></div>`); continue; }
      if ((m = t.match(/^contents:?\s+(\d+)\/(\d+) items,?\s*(\d+) stones/i))) { info.push(`<div><span class="t-key">Items:</span> ${m[1]}/${m[2]}</div><div><span class="t-key">Items Weight:</span> ${m[3]}</div>`); continue; }
      if ((m = t.match(/^strength requirement\s+(\d+)/i))) { body.unshift(`<div>Required Strength: ${m[1]}</div>`); continue; }
      if ((m = t.match(/^(durability)\s+\+(\d+)%$/i))) { body.push(`<div><span class="t-val">+${m[2]}%</span> Durability</div>`); continue; }
      if ((m = t.match(/^(.*?)[\s:]+\+?(-?\d+(?:\.\d+)?)\s*(%?)$/)) && m[1] && !/^(weight|default)/i.test(m[1])) {
        const name = m[1].replace(/:$/, ""), cls = /leech/i.test(name) ? "t-leech" : HOT_PROPS.test(name) ? "t-hot" : "";
        body.push(`<div><span class="t-val">${+m[2] >= 0 ? "+" : ""}${m[2]}${m[3]}</span> <span class="${cls}">${esc(name)}</span></div>`);
        continue;
      }
      const style = l.color ? ` style="color:${l.color}"` : "";
      body.push(`<div class="${l.bold ? "t-b" : ""}"${style}>${esc(t)}</div>`);
    }
    const headHtml = head.map((l) => `<div class="t-center ${l.italic ? "t-i" : ""} ${l.bold ? "t-b" : ""}"${l.color ? ` style="color:${l.color}"` : ""}>${esc(l.text)}</div>`).join("");
    const rarHtml = rarity ? `<div class="t-center" style="color:${rarity.color || "#e6c85a"}">${esc(rarity.text)}</div>` : "";
    const qty = (it.amount || 1) > 1 ? `${it.amount} ` : "";
    const loc = it.location ? `<div class="t-hr"></div><div class="t-muted">${esc(it.location.text)}</div>` : "";
    return `<div class="t-name">${qty}${esc(it.name)}</div>${rarHtml}${headHtml}${info.join("")}${body.length ? `<div class="t-hr"></div>${body.join("")}` : ""}${loc}`;
  }
  function placeTip(e) {
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  // hoverSerial tracks which [data-serial] element the pointer is currently over — an async
  // resolveItems() lookup (state.itemCache misses a serial not seeded by a rendered inventory row,
  // e.g. a suit-builder candidate) must not paint a tooltip after the pointer has already moved on.
  let hoverSerial = null;
  document.addEventListener("mouseover", (e) => {
    const host = e.target.closest("[data-serial]");
    if (!host) { hoverSerial = null; tip.style.display = "none"; return; }
    const serial = +host.dataset.serial;
    hoverSerial = serial;
    const cached = state.itemCache.get(serial);
    if (cached) { tip.innerHTML = tipHtml(cached); tip.style.display = "block"; placeTip(e); return; }
    tip.style.display = "none";
    resolveItems([serial]).then((found) => {
      if (hoverSerial !== serial) return;   // the pointer moved on before this resolved
      const it = found[serial];
      if (!it) return;
      tip.innerHTML = tipHtml(it); tip.style.display = "block"; placeTip(e);
    });
  });
  document.addEventListener("mousemove", (e) => { if (tip.style.display === "block") placeTip(e); });
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.("[data-serial]")) { hoverSerial = null; tip.style.display = "none"; } });
}
