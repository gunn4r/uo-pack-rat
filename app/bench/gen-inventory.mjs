// gen-inventory.mjs — synthetic scan generator for the suit-builder scale benchmark.
//
// Learns the empirical shape of the REAL gear in the data directory's scans/*.json (per slot: which tooltip lines co-occur,
// the value range of every stat line, tag frequency, rarity, STR requirements, two-handedness, weapon skill lines)
// and emits N items in the same raw scan schema packrat-scanner.py writes, so the normal fold parses them.
//
// Method: bootstrap with jitter. Every synthetic gear piece starts as a copy of a random real piece of the same
// distribution (so names, slots, rarity lines, "Two-handed Weapon" / "Skill Required" lines and property
// co-occurrence are all real), then each stat line's number is resampled from the values seen on that slot for
// that line (with ±25% jitter), a stat line is sometimes added from the slot's line-frequency table and sometimes
// dropped, and tags are kept or replaced by frequency. Non-gear items are verbatim copies of real non-gear items
// (reagents, potions, scrolls, resources ...) with fresh serials. Nothing here touches the data directory's scans/.
//
//   node app/bench/gen-inventory.mjs --n 5000 --gear 0.3 --seed 1 --out <dir>
//
// Library use: learnModel(snapshots, lib) -> model; generateScan(model, {n, gearFraction, seed}) -> scan object.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveConfig } from "../config.mjs";
import { upgradeScan } from "../scan-schema.mts";
import { loadRules } from "../rules.mts";

// Real scans on disk and the synthetic scans this file generates are both raw v1 (packrat-scanner.py's own
// shape) — every fold below upgrades to v2 first, since foldSnapshots (Task 1) now requires it and throws otherwise.
// The bench always learns from / generates against the UO Alive shard: the real scans it reads were all recorded
// on that shard, and the profiles.json it benches against ships with UO Alive as the default shard.
export const BENCH_SHARD = "uoalive";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(dirname(HERE));
export const SCANS_DIR = resolveConfig().paths.scans;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

export function readRealSnapshots(dir = SCANS_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

// Lines that are NOT stats: kept verbatim on a copy (weight, durability, damage spread, speed, range, uses ...).
const FIXED_LINE_RE = /^(weight|durability|weapon damage|weapon speed|range|uses remaining|contents|strength requirement|physical damage|fire damage|cold damage|poison damage|energy damage|chaos damage|direct damage)\b/i;
const NUM_LINE_RE = /^(.*?)(-?\d+)(%?)$/;

// A stat line = a line the parser turns into an optimizer property or a skill bonus ("Anatomy +15").
function statTemplate(line, lib) {
  if (FIXED_LINE_RE.test(line)) return null;
  const m = line.match(NUM_LINE_RE);
  if (!m) return null;
  const parsed = lib.parseTooltip(["x", line]);
  const isProp = Object.keys(parsed.props).some((k) => k !== "tagPenalty");
  const isSkill = Object.keys(parsed.extras).some((k) => lib.SKILL_NAMES.includes(k));
  if (!isProp && !isSkill) return null;
  return { template: `${m[1]}#${m[3]}`, value: +m[2] };
}
const TAG_LINES = ["Cursed", "Brittle", "Antique", "Prized", "Massive", "Unwieldy"];

export function learnModel(snapshots, lib) {
  const inv = lib.foldSnapshots(snapshots.map((s) => upgradeScan(s, { shard: BENCH_SHARD })));
  const items = Object.values(inv.items);
  const gear = [], nonGear = [];
  const slotStats = {};   // slot -> { values: {template -> [numbers]}, freq: {template -> count}, str: [numbers], tags: {tag -> count}, n }
  for (const it of items) {
    if (!it.lines || !it.lines.length) continue;
    if (it.kind === "container") continue;
    if (it.gear && it.slot) {
      const lines = it.lines.slice();
      const stats = [], fixed = [], tags = [];
      for (let i = 1; i < lines.length; i++) {
        const l = lines[i];
        if (TAG_LINES.includes(l)) { tags.push(l); continue; }
        const st = statTemplate(l, lib);
        if (st) stats.push({ idx: i, ...st }); else fixed.push(l);
      }
      gear.push({ slot: it.slot, name: lines[0], lines, statIdx: stats.map((s) => s.idx), strReq: it.strReq, graphic: it.graphic, hue: it.hue, tags });
      const ss = (slotStats[it.slot] ||= { values: {}, freq: {}, str: [], tags: {}, n: 0 });
      ss.n++;
      ss.str.push(it.strReq || 0);
      for (const s of stats) { (ss.values[s.template] ||= []).push(s.value); ss.freq[s.template] = (ss.freq[s.template] || 0) + 1; }
      for (const t of tags) ss.tags[t] = (ss.tags[t] || 0) + 1;
    } else {
      nonGear.push({ lines: it.lines.slice(), amount: it.amount || 1, graphic: it.graphic, hue: it.hue, name: it.name });
    }
  }
  for (const ss of Object.values(slotStats)) {
    ss.freqList = Object.entries(ss.freq).map(([template, count]) => ({ template, count }));
    ss.tagList = Object.entries(ss.tags).map(([tag, count]) => ({ tag, count }));
    ss.tagRate = ss.tagList.reduce((a, t) => a + t.count, 0) / ss.n;
  }
  return { gear, nonGear, slotStats, realItems: items.length, realGear: gear.length, realNonGear: nonGear.length,
    slotCounts: Object.fromEntries(Object.entries(slotStats).map(([s, v]) => [s, v.n])) };
}

const weighted = (rnd, list, key) => {
  let total = 0; for (const e of list) total += e[key];
  let r = rnd() * total;
  for (const e of list) { r -= e[key]; if (r <= 0) return e; }
  return list[list.length - 1];
};

function synthGear(model, rnd, serial, lib) {
  const t = pick(rnd, model.gear);
  const ss = model.slotStats[t.slot];
  const lines = t.lines.slice();
  const present = new Set();
  // resample stat values (bootstrap from the slot's observed values for that line, then jitter)
  for (const i of t.statIdx) {
    const st = statTemplate(lines[i], lib);
    if (!st) continue;
    present.add(st.template);
    if (rnd() < 0.75) {
      const vals = ss.values[st.template] || [st.value];
      let v = pick(rnd, vals) * (0.75 + rnd() * 0.5);
      v = Math.max(1, Math.round(v));
      if (st.value < 0) v = -v;   // e.g. "Faster Casting -1" stays negative
      lines[i] = st.template.replace("#", String(v));
    }
  }
  // sometimes drop one stat line, sometimes add one the slot carries
  if (t.statIdx.length >= 2 && rnd() < 0.15) { const i = pick(rnd, t.statIdx); lines.splice(i, 1); }
  if (rnd() < 0.25 && ss.freqList.length) {
    const e = weighted(rnd, ss.freqList, "count");
    if (!present.has(e.template)) {
      const v = Math.max(1, Math.round(pick(rnd, ss.values[e.template]) * (0.75 + rnd() * 0.5)));
      const at = Math.max(1, lines.findIndex((l) => /^durability/i.test(l)));
      lines.splice(at, 0, e.template.replace("#", String(v)));
    }
  }
  // tags: keep the template's with p=0.7, else re-draw by the slot's tag rate
  const kept = lines.filter((l) => !TAG_LINES.includes(l));
  const tags = t.tags.filter(() => rnd() < 0.7);
  if (!tags.length && ss.tagList.length && rnd() < ss.tagRate * 0.5) tags.push(weighted(rnd, ss.tagList, "count").tag);
  const out = [kept[0], ...tags, ...kept.slice(1)];
  // STR requirement: half the time re-drawn from the slot's list
  if (rnd() < 0.5) {
    const i = out.findIndex((l) => /^strength requirement/i.test(l));
    const v = pick(rnd, ss.str);
    if (i >= 0) out[i] = `Strength Requirement ${v}`;
  }
  return { serial, name: t.name, graphic: t.graphic, hue: t.hue, amount: 1, tooltip: out, slot: t.slot };
}

function synthNonGear(model, rnd, serial) {
  const t = pick(rnd, model.nonGear);
  const amount = t.amount > 1 ? Math.max(1, Math.round(t.amount * (0.5 + rnd()))) : 1;
  const tooltip = t.tooltip ? t.tooltip.slice() : t.lines.slice();
  if (amount > 1) tooltip[0] = `${amount} ${tooltip[0].replace(/^\d+\s+/, "")}`;
  return { serial, name: t.name, graphic: t.graphic, hue: t.hue, amount, tooltip };
}

// One scan of n synthetic items spread over ground chests of 120, written by pseudo-character "_bench" (the fold
// does not list "_" characters, so no fake character appears; its roots are fresh serials so nothing real is replaced).
export function generateScan(model, { n, gearFraction = 0.3, seed = 1, serialBase = 0x70000000, scannedAt = "2026-09-12T23:59:00", lib }) {
  const rnd = mulberry32(seed);
  const CHEST = 120;
  const nChests = Math.max(1, Math.ceil(n / CHEST));
  const roots = [], containers = {};
  for (let c = 0; c < nChests; c++) {
    const serial = serialBase + c;
    roots.push({ serial, kind: "ground", name: "Metal Chest" });
    containers[String(serial)] = { serial, name: "Metal Chest", kind: "ground", root: serial, parent: null, pos: { x: 1000 + (c % 20), y: 1000 + Math.floor(c / 20), z: 0 },
      tooltip: ["Metal Chest", "Weight: 10 Stones", `Contents: ${Math.min(CHEST, n - c * CHEST)}/125 Items, 100 Stones`] };
  }
  const items = [];
  let serial = serialBase + nChests, gearCount = 0;
  for (let i = 0; i < n; i++) {
    const container = serialBase + Math.floor(i / CHEST);
    const isGear = rnd() < gearFraction;
    const it = isGear ? synthGear(model, rnd, serial++, lib) : synthNonGear(model, rnd, serial++);
    if (isGear) gearCount++;
    delete it.slot;
    items.push({ ...it, container });
  }
  return { version: 1, character: "_bench", scannedAt, stats: { str: 100, dex: 100, int: 100 }, skills: {}, maxes: { hits: 100, stam: 100, mana: 100 },
    resists: { phys: 0, fire: 0, cold: 0, poison: 0, energy: 0 }, position: { x: 1000, y: 1000 }, equipped: [], roots, containers, items,
    _bench: { n, gearFraction, seed, gearCount } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const n = +arg("n", 1000), gearFraction = +arg("gear", 0.3), seed = +arg("seed", 1);
  const out = arg("out", process.env.TMPDIR || "/tmp");
  const lib = await import(pathToFileURL(join(ROOT, "app", "vault-lib.mjs")).href);
  lib.setRules(loadRules(BENCH_SHARD));
  const model = learnModel(readRealSnapshots(), lib);
  const scan = generateScan(model, { n, gearFraction, seed, lib });
  mkdirSync(out, { recursive: true });
  const file = join(out, `bench-${n}-${gearFraction}-${seed}.json`);
  writeFileSync(file, JSON.stringify(scan));
  console.log(JSON.stringify({ file, n, gearFraction, seed, gear: scan._bench.gearCount, learned: { realItems: model.realItems, realGear: model.realGear, slotCounts: model.slotCounts } }));
}
