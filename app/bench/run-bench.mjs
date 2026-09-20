// run-bench.mjs — suit-builder scale benchmark. Sweeps inventory size x gear fraction x profile, measuring the
// fold, the /api/inventory payload, pool sizes, dominance pruning, and the heuristic + exact phases (the exact
// phase runs through app/optimize-worker.mjs exactly as the server would: HiGHS when it loads, the core's own
// heuristic as the honest fallback otherwise) and writes results/<stamp>.json + results/<stamp>.md. Reads real
// scans only to learn the generator model and to supply the characters; synthetic scans go to the scratch
// directory, never to the data directory's scans/.
//
//   node app/bench/run-bench.mjs [--ns 500,2000,5000,10000,25000,50000] [--fractions 0.3,1] [--profiles <Character>,<Character>-anyweapon,...]
//                                [--budget 90] [--hard-cap 150] [--probe-cap 30] [--max-minutes 36]
//                                [--scratch <dir>] [--seed 1]
//   node app/bench/run-bench.mjs --render results/<stamp>.json      (re-render the markdown tables only)
//
// Every optimizer call runs in app/optimize-worker.mjs (the server's worker) under a hard wall cap, because the
// core's timeBudgetMs only bounds the exact phase: the heuristic restarts and the O(n^2) dominance prune are
// unbounded, and at large pools they are the cost. A killed worker is recorded with its last progress snapshot.
// (The old escalation to a multi-thread branch-and-bound pool, once the single thread failed to prove a cell,
// was retired along with that search path — see CHANGELOG.md Phase 3 — so a cell that fails to prove within
// budget is simply reported unproven; a smaller, cheaper probe budget then covers larger N so the sweep doesn't
// keep burning the full budget on cells already known to fail.)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, availableParallelism } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { learnModel, generateScan, readRealSnapshots, ROOT, BENCH_SHARD } from "./gen-inventory.mjs";
import { resolveConfig, corePath } from "../config.mjs";
import { upgradeScan } from "../scan-schema.mts";
import { loadRules } from "../rules.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const LOG_PROGRESS_MS = 1000 * +arg("log-progress", 0);   // seconds between progress lines while a worker runs (0 = silent)

if (has("render")) {
  const file = arg("render");
  const results = JSON.parse(readFileSync(file, "utf8"));
  const md = renderTables(results);
  writeFileSync(file.replace(/\.json$/, ".md"), md);
  console.log(md);
  process.exit(0);
}

// Profiles come from <data>/profiles.json's own `characters`, not a hard-coded roster, so the bench
// runs for any contributor who has set one up. `--profiles` (or a bare "<Character>-anyweapon" name)
// still works to target a subset or the weapon-filter-off variant.
const BENCH_CONFIG = resolveConfig(argv);
if (!existsSync(BENCH_CONFIG.paths.profiles)) {
  console.error(`no profiles.json at ${BENCH_CONFIG.paths.profiles} — point PACKRAT_DATA (or --data) at a directory that has one, or create one first (the app writes it from app/data/profiles.default.json on first run)`);
  process.exit(1);
}
const PROFILES_FILE = JSON.parse(readFileSync(BENCH_CONFIG.paths.profiles, "utf8"));
const CHARACTER_NAMES = Object.keys(PROFILES_FILE.characters || {});
if (!has("profiles") && !CHARACTER_NAMES.length) {
  console.error(`profiles.json has no characters — pass --profiles <Character>[,<Character>...] or add characters to it first`);
  process.exit(1);
}

const NS = String(arg("ns", "500,2000,5000,10000,25000,50000")).split(",").map(Number);
const FRACTIONS = String(arg("fractions", "0.3,1")).split(",").map(Number);
const PROFILE_NAMES = String(arg("profiles", CHARACTER_NAMES.join(","))).split(",");
const BUDGET_MS = 1000 * +arg("budget", 90);
const HARD_CAP_MS = 1000 * +arg("hard-cap", 150);
const PROBE_CAP_MS = 1000 * +arg("probe-cap", 30);
const SOLO_MS = 1500;   // the cheap probe's own exact-phase budget, once a smaller N has already failed to prove
const DEADLINE = Date.now() + 60000 * +arg("max-minutes", 36);
const SEED = +arg("seed", 1);
const SCRATCH = arg("scratch", join(process.env.TMPDIR || tmpdir(), "vault-bench"));
const PRUNE_LEVER = has("prune-lever");         // measure a harness-side dominance prune on the profile's own dimensions
const PRUNE_RUN = has("prune-run");             // ... and re-run the search on the pruned pools where the counts differ from the core's
const TAG = arg("tag", "");
mkdirSync(SCRATCH, { recursive: true });
const RESULTS_DIR = join(HERE, "results");
mkdirSync(RESULTS_DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_JSON = join(RESULTS_DIR, `${STAMP}${TAG ? "-" + TAG : ""}.json`);

// Resolve a --profiles entry against profiles.json's own characters: the name as-is, or
// "<Character>-anyweapon" for the same character with the weapon-skill filter turned off (the known
// worst case for pool size). Returns null for a name that matches neither.
function resolveProfileDef(pname) {
  if (PROFILES_FILE.characters[pname]) return { who: pname, patch: {} };
  if (pname.endsWith("-anyweapon")) {
    const base = pname.slice(0, -"-anyweapon".length);
    if (PROFILES_FILE.characters[base]) return { who: base, patch: { weaponSkill: null } };
  }
  return null;
}

const lib = await import(pathToFileURL(join(ROOT, "app", "vault-lib.mts")).href);
lib.setRules(loadRules(BENCH_SHARD));
// the core's dominance-prune internals are exported too, so the lever can be counted apples to apples
const CORE_URL = pathToFileURL(corePath()).href;
const core = await import(CORE_URL);
// what the core's own dominance prune keeps of the pools alone (no "wear nothing" entries, no worn extras)
function corePruneCount(pools, current, profile) {
  const space = core.optBuildSpace(core.optCollectKeys(pools, current, profile), profile);
  const sizes = {};
  for (const [slot, list] of Object.entries(pools)) sizes[slot] = core.optDominancePrune(list, space, true).length;
  return { sizes, total: Object.values(sizes).reduce((a, b) => a + b, 0) };
}
const real = readRealSnapshots();
const model = learnModel(real, lib);
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// pools + effective profile for a character, exactly as the page and the scratch bench build them
function buildCell(inv, who, patch) {
  const p0 = PROFILES_FILE.characters[who];
  const p = { ...p0, ...patch, floors: { ...(p0.floors || {}), ...(patch.floors || {}) }, weights: { ...(p0.weights || {}), ...(patch.weights || {}) } };
  const c = inv.characters[who];
  const { pools, current, blocked = [] } = lib.buildPools(inv, who, { allowOthersWorn: false, strength: p.strLimit ?? (c ? c.stats.str : 125), excludeTags: p.excludeTags || [],
    excludeRoots: p.excludeRoots || [], excludeGargoyle: !p.allowGargoyle, medOnly: !!p.medOnly, weaponSkill: p.weaponSkill || null, excludeSkills: p.excludeSkills || [] });
  for (const s of p.lockedSlots || []) pools[s] = [];
  const optCurrent = { ...current };
  for (const s of blocked) delete optCurrent[s];
  const optionalSlots = ["cloak", "talisman", "ring", "bracelet", "neck", "oneHanded", "twoHanded"].filter((s) => !(p.lockedSlots || []).includes(s));
  const profile = lib.effectiveProfile(p, c);
  const poolSizes = Object.fromEntries(lib.OPTIMIZER_SLOTS.map((s) => [s, (pools[s] || []).length]));
  return { pools, current: optCurrent, profile, optionalSlots, poolSizes, poolTotal: Object.values(poolSizes).reduce((a, b) => a + b, 0),
    shape: { locked: p.lockedSlots || [], hardFloors: profile.hardFloors.length, weights: Object.keys(profile.weights).length, weaponSkill: p.weaponSkill || null, medOnly: !!p.medOnly } };
}

// One optimizeSuit call in the server's worker under a hard wall cap. Phase times come from the progress stream:
// every phase change emits unconditionally, so heuristic / prune / exact durations are exact.
function runWorker(data, capMs, logThis = true) {
  return new Promise((resolve) => {
    const w = new Worker(new URL("../optimize-worker.mjs", import.meta.url), { workerData: { coreUrl: CORE_URL, ...data } });
    const t0 = Date.now(), phases = {};
    let heurScore = null, last = null, settled = false;
    const finish = (extra) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const ms = Date.now() - t0;
      const t = { heuristicMs: phases.prune ?? null, pruneMs: phases.prune != null && phases.exact != null ? phases.exact - phases.prune : null,
        exactMs: phases.exact != null && phases.done != null ? phases.done - phases.exact : null };
      resolve({ ms, phases, timings: t, heurScore, last: last && { phase: last.phase, nodes: last.nodes, explored: last.explored, candidates: last.candidates, bestScore: last.bestScore, restartsDone: last.restartsDone }, ...extra });
    };
    const timer = setTimeout(() => { w.terminate(); finish({ killed: true }); }, capMs);
    let lastLog = 0;
    w.on("message", (m) => {
      if (m.type === "progress") {
        const p = m.progress; last = p;
        if (phases[p.phase] == null) phases[p.phase] = Date.now() - t0;
        if (p.phase === "prune" && heurScore == null) heurScore = p.bestScore;
        if (LOG_PROGRESS_MS && logThis && Date.now() - lastLog >= LOG_PROGRESS_MS) {   // --log-progress N: a rate to extrapolate from
          lastLog = Date.now();
          console.log(`  ${new Date().toTimeString().slice(0, 8)} +${((Date.now() - t0) / 1000).toFixed(0)}s ${p.phase} explored=${((p.explored || 0) * 100).toFixed(4)}% nodes=${p.nodes} best=${p.bestScore != null ? p.bestScore.toFixed(2) : "-"}`);
        }
      } else if (m.type === "done") finish({ result: m.result, killed: false });
      else if (m.type === "error") finish({ error: m.error, killed: false });
    });
    w.on("error", (e) => finish({ error: String(e), killed: false }));
    w.on("exit", (code) => finish({ error: `worker exited ${code}`, killed: false }));
  });
}

function singleSummary(r) {
  const res = r.result;
  return { ms: r.ms, killed: !!r.killed, error: r.error || null, ...r.timings, lastPhase: r.last ? r.last.phase : null, lastNodes: r.last ? r.last.nodes : null,
    explored: r.last ? r.last.explored : null, restartsDone: r.last ? r.last.restartsDone : null,
    proven: res ? !!res.proven : false, score: res ? res.score : (r.last ? r.last.bestScore : null), heurScore: r.heurScore, nodes: res ? res.nodes : null,
    pruned: res ? res.pruned : (r.last && r.last.phase === "exact" ? { after: r.last.candidates } : null),
    heurEqualsProven: res && res.proven && r.heurScore != null ? Math.abs(res.score - r.heurScore) < 1e-6 : null };
}

// The pruning lever, harness side: drop from every slot's pool each item dominated on the dimensions the profile
// weights (non-zero) or floors, ignoring every other property. `clipCaps` also clips an item's value at the
// dimension's cap before comparing, which is valid when no item is negative on that dimension (a capped total
// cannot tell 80 from 70 once the item alone reaches 70). Same two-hander rule as the core: a two-handed weapon
// never knocks out a shield. Ties keep the lower serial.
function profilePrune(pools, profile, clipCaps) {
  const w = profile.weights || {}, fl = profile.floors || {}, caps = profile.caps || {};
  const keys = [...new Set([...Object.keys(w).filter((k) => w[k] !== 0), ...Object.keys(fl)])];
  const dims = keys.map((k) => ({ k, s: w[k] > 0 || fl[k] > 0 ? 1 : w[k] < 0 ? -1 : 0, cap: clipCaps && typeof caps[k] === "number" ? caps[k] : Infinity, clip: clipCaps }));
  if (clipCaps) for (const d of dims) for (const list of Object.values(pools)) for (const it of list) if ((it.props[d.k] || 0) < 0) d.clip = false;
  const vec = (it) => dims.map((d) => { const v = it.props[d.k] || 0; return d.clip && d.s > 0 && v > d.cap ? d.cap : v; });
  const dominates = (a, b) => dims.every((d, i) => (d.s > 0 ? a[i] >= b[i] : d.s < 0 ? a[i] <= b[i] : true));
  const out = {}, sizes = {};
  for (const [slot, list] of Object.entries(pools)) {
    const vs = list.map(vec);
    out[slot] = list.filter((a, i) => !list.some((b, j) => j !== i && !(b.twoHanded === true && a.twoHanded !== true) && dominates(vs[j], vs[i]) && !(dominates(vs[i], vs[j]) && a.serial < b.serial)));
    sizes[slot] = out[slot].length;
  }
  return { pools: out, sizes, total: Object.values(sizes).reduce((a, b) => a + b, 0), dims: keys.length };
}

const results = { stamp: STAMP, host: { cpus: availableParallelism(), node: process.version }, params: { NS, FRACTIONS, PROFILE_NAMES, BUDGET_MS, HARD_CAP_MS, PROBE_CAP_MS, SEED, PRUNE_LEVER, PRUNE_RUN },
  model: { realItems: model.realItems, realGear: model.realGear, slotCounts: model.slotCounts }, inventories: [], cells: [] };
const save = () => writeFileSync(OUT_JSON, JSON.stringify(results, null, 1));
const state = {};   // `${profile}|${fraction}` -> { singleFailed, probeKilled }

const timeMin = (fn, reps = 3) => { let best = Infinity, out; for (let i = 0; i < reps; i++) { const t = performance.now(); out = fn(); best = Math.min(best, performance.now() - t); } return { ms: Math.round(best * 10) / 10, out }; };

for (const N of NS) {
  for (const fraction of FRACTIONS) {
    const n = Math.max(0, N - model.realItems);
    const scan = generateScan(model, { n, gearFraction: fraction, seed: SEED * 1000 + N, lib });
    writeFileSync(join(SCRATCH, `bench-${N}-${fraction}.json`), JSON.stringify(scan));
    const snaps = [...real, scan].map((s) => upgradeScan(s, { shard: BENCH_SHARD }));
    const { ms: foldMs, out: inv } = timeMin(() => lib.foldSnapshots(snaps));
    const items = Object.values(inv.items);
    const gear = items.filter((i) => i.gear), slotted = gear.filter((i) => lib.OPTIMIZER_SLOTS.includes(i.slot));
    // hypothesis (a): fold cost of the non-gear items (same snapshots with every non-gear raw item removed)
    const nonGear = new Set(items.filter((i) => !i.gear).map((i) => i.serial));
    const gearOnlySnaps = snaps.map((s) => ({ ...s, items: (s.items || []).filter((it) => !nonGear.has(+it.serial)) }));
    const { ms: foldGearOnlyMs } = timeMin(() => lib.foldSnapshots(gearOnlySnaps));
    // hypothesis (b): what the browser would receive if only slotted gear were shipped
    const MB = (o) => Math.round(JSON.stringify(o).length / 1e4) / 100;
    const payloadMB = MB({ ok: true, inventory: inv });
    const slottedOnly = { ...inv, items: Object.fromEntries(slotted.map((i) => [i.serial, i])) };
    const slottedNoLines = { ...inv, items: Object.fromEntries(slotted.map((i) => [i.serial, { ...i, lines: undefined }])) };
    const poolsOnly = slotted.map((i) => lib.toOptItem(i));
    const invRow = { N, fraction, synthetic: n, items: items.length, gear: gear.length, slotted: slotted.length, foldMs, foldGearOnlyMs,
      payloadMB, payloadSlottedMB: MB(slottedOnly), payloadSlottedNoLinesMB: MB(slottedNoLines), payloadPoolsOnlyMB: MB(poolsOnly), scanFileMB: MB(scan) };
    results.inventories.push(invRow);
    log(`N=${N} f=${fraction}: items ${items.length} slotted ${slotted.length} fold ${foldMs} ms (gear-only ${foldGearOnlyMs} ms) payload ${payloadMB} MB`);

    for (const pname of PROFILE_NAMES) {
      const def = resolveProfileDef(pname);
      if (!def) { log(`  ${pname}: no such character in profiles.json (have: ${CHARACTER_NAMES.join(", ") || "none"}) — skipping`); continue; }
      const cell = buildCell(inv, def.who, def.patch);
      const key = `${pname}|${fraction}`;
      const st = (state[key] ||= { singleFailed: false, probeKilled: false });
      const row = { N, fraction, profile: pname, items: items.length, slotted: slotted.length, poolSizes: cell.poolSizes, poolTotal: cell.poolTotal, shape: cell.shape, mode: null, single: null, note: null, lever: null };
      results.cells.push(row);
      const opts = { seed: 2026, restarts: 200, optionalSlots: cell.optionalSlots, exact: true, timeBudgetMs: BUDGET_MS, progressEveryMs: 250 };
      if (Date.now() > DEADLINE) { row.mode = "not run"; row.note = "global time cap reached"; save(); continue; }
      if (st.probeKilled) { row.mode = "not run"; row.note = "the probe at a smaller N was killed by the hard cap"; save(); continue; }
      await runCell(row, cell, opts, st, pname);
      if (PRUNE_LEVER) {
        // candidate counts of the harness prune, plain and cap-clipped, against what the core's own prune reached
        const plain = profilePrune(cell.pools, cell.profile, false), clipped = profilePrune(cell.pools, cell.profile, true);
        const coreAfter = corePruneCount(cell.pools, cell.current, cell.profile).total;
        row.lever = { dims: plain.dims, poolTotal: cell.poolTotal, plain: plain.total, clipped: clipped.total, coreAfter, coreReported: row.single && row.single.pruned ? row.single.pruned.after : null, plainSizes: plain.sizes, clippedSizes: clipped.sizes, run: null };
        log(`  ${pname}: lever dims ${plain.dims} pool ${cell.poolTotal} → plain ${plain.total} / clipped ${clipped.total} (core prune ${coreAfter})`);
        // the core re-prunes whatever it is given, so re-running on pools pruned to the same count is the same
        // search; only a smaller count is worth the time
        if (PRUNE_RUN && coreAfter != null && clipped.total < coreAfter && Date.now() < DEADLINE) {
          const sub = { N, fraction, profile: pname, poolSizes: clipped.sizes, poolTotal: clipped.total, mode: null, single: null, note: null };
          const pcell = { ...cell, pools: clipped.pools, poolSizes: clipped.sizes, poolTotal: clipped.total };
          await runCell(sub, pcell, opts, { singleFailed: st.singleFailed, probeKilled: false }, pname + " (clipped pools)");
          const ref = row.single && row.single.proven ? row.single.score : null;
          const got = sub.single ? sub.single.score : null;
          row.lever.run = { mode: sub.mode, single: sub.single, scoreMatchesUnpruned: ref != null && got != null ? Math.abs(ref - got) < 1e-6 : null };
        }
      }
      save();
    }
  }
}

// One cell: a full single-thread run under the sweep's own budget, or — once a smaller N has already failed to
// prove — a cheap probe (a short exact-phase budget under a smaller hard cap) that still reports pool / prune /
// heuristic numbers without spending the sweep's full budget on a cell already known to fail.
async function runCell(row, cell, opts, st, label) {
  if (!st.singleFailed) {
    row.mode = "full";
    log(`  ${label}: pools ${cell.poolTotal} single-thread exact, budget ${BUDGET_MS / 1000} s`);
    const r = await runWorker({ pools: cell.pools, current: cell.current, profile: cell.profile, opts }, HARD_CAP_MS);
    row.single = singleSummary(r);
    log(`  ${label}: ${row.single.proven ? "PROVEN" : row.single.killed ? "KILLED in " + row.single.lastPhase : "unproven"} ${r.ms} ms nodes ${row.single.nodes ?? row.single.lastNodes} pruned ${JSON.stringify(row.single.pruned)}`);
    if (!row.single.proven) st.singleFailed = true;
  } else {
    row.mode = "probe";
    row.note = `a smaller N already failed to prove; ${SOLO_MS} ms exact budget under a ${PROBE_CAP_MS / 1000} s cap, for pool / prune / heuristic numbers only`;
    log(`  ${label}: pools ${cell.poolTotal} probe`);
    const r = await runWorker({ pools: cell.pools, current: cell.current, profile: cell.profile, opts: { ...opts, timeBudgetMs: SOLO_MS } }, PROBE_CAP_MS);
    row.single = singleSummary(r);
    if (r.killed) st.probeKilled = true;
    log(`  ${label}: probe ${r.killed ? "KILLED in " + row.single.lastPhase : "done"} ${r.ms} ms heuristic ${row.single.heuristicMs} ms prune ${row.single.pruneMs} ms`);
  }
}
results.finishedAt = new Date().toISOString();
save();
const md = renderTables(results);
writeFileSync(OUT_JSON.replace(/\.json$/, ".md"), md);
log(`wrote ${OUT_JSON}`);
console.log(md);

// ---- markdown tables ---------------------------------------------------------------------------------------
function renderTables(res) {
  const f = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : typeof v === "number" ? v.toFixed(d) : String(v));
  const s = (ms) => (ms == null ? "–" : ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms");
  const out = [];
  out.push(`### Inventories (real ${res.model.realItems} items + synthetic)`, "");
  out.push("| N | gear frac | items | slotted gear | fold | fold gear-only | payload | slotted only | slotted, no lines | pools only | scan file |");
  out.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of res.inventories) out.push(`| ${r.N} | ${r.fraction} | ${r.items} | ${r.slotted} | ${s(r.foldMs)} | ${s(r.foldGearOnlyMs)} | ${f(r.payloadMB, 2)} MB | ${f(r.payloadSlottedMB, 2)} MB | ${f(r.payloadSlottedNoLinesMB, 2)} MB | ${f(r.payloadPoolsOnlyMB, 2)} MB | ${f(r.scanFileMB, 2)} MB |`);
  out.push("");
  for (const pname of res.params.PROFILE_NAMES) {
    const rows = res.cells.filter((c) => c.profile === pname);
    if (!rows.length) continue;
    const shape = rows[0].shape;
    out.push(`### ${pname} (locked ${shape.locked.join(", ") || "none"}; ${shape.hardFloors} hard floors; weapons ${shape.weaponSkill || "any"}${shape.medOnly ? "; meditation-safe only" : ""})`, "");
    out.push("| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact | nodes | proven | heur = optimum | mode |");
    out.push("|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|");
    for (const c of rows) {
      const sg = c.single || {};
      const largest = Object.entries(c.poolSizes).sort((a, b) => b[1] - a[1])[0];
      const pr = sg.pruned ? `${sg.pruned.before ?? "?"} → ${sg.pruned.after ?? "?"}` : "–";
      const proven = c.mode === "not run" ? "not run" : sg.killed ? `killed in ${sg.lastPhase}` : sg.error ? "error" : sg.proven ? "yes" : `no (${f((sg.explored || 0) * 100, 1)}% explored)`;
      const heq = sg.heurEqualsProven == null ? "–" : sg.heurEqualsProven ? "yes" : "NO";
      out.push(`| ${c.N} | ${c.fraction} | ${c.poolTotal} | ${largest ? largest[0] + " " + largest[1] : "–"} | ${pr} | ${s(sg.heuristicMs)} | ${s(sg.pruneMs)} | ${s(sg.exactMs)} | ${f(sg.nodes ?? sg.lastNodes)} | ${proven} | ${heq} | ${c.mode}${c.note ? "*" : ""} |`);
    }
    out.push("");
    const notes = [...new Set(rows.filter((c) => c.note).map((c) => c.note))];
    for (const n of notes) out.push(`\\* ${n}`);
    if (notes.length) out.push("");
    const lever = rows.filter((c) => c.lever);
    if (lever.length) {
      out.push(`Pruning lever for ${pname} (dominance on the profile's own dimensions only, harness side):`, "");
      out.push("| N | gear frac | dims | pool total | core's prune | profile dims | profile dims + cap clip | re-run on clipped pools | score = unpruned |");
      out.push("|---:|---:|---:|---:|---:|---:|---:|---|---|");
      for (const c of lever) {
        const L = c.lever, run = L.run;
        const rr = run ? (run.single ? (run.single.proven ? `1 thread proven ${s(run.single.ms)}` : `unproven ${s(run.single.ms)}`) : "–") : (L.coreAfter != null && L.clipped >= L.coreAfter ? "same count, not re-run" : "not run");
        out.push(`| ${c.N} | ${c.fraction} | ${L.dims} | ${L.poolTotal} | ${f(L.coreAfter)} | ${L.plain} | ${L.clipped} | ${rr} | ${run ? (run.scoreMatchesUnpruned == null ? "no proven reference" : run.scoreMatchesUnpruned ? "yes" : "NO") : "–"} |`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}
