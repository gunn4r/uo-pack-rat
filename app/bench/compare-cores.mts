// compare-cores.mts — runs the optimizer core at a git ref and the working tree's core on identical inputs and checks their results are byte-identical, so a solver refactor can show it changes nothing.
//
// map: builder
//
// The base core (`scripts/optimizer-core.mts` plus `app/solver/`, which it imports when the ref has it) is copied out of git into a
// temp folder at the same depth, so both cores load in one process. Each run compares `JSON.stringify` of the whole result:
// the fixture with every built-in template, plain and with the two tie-breaks, plus heuristic Strict order for templates with
// goals; then generated inventories (negative values, hard and soft floors, custom floor bonus and partial credit, mins,
// Resisting Spells and SSI steps, rarity tie costs, a 1e10 hard-floor bonus) in four modes: plain, exact with or without
// alternatives, tie-break, Strict order. No run has a time limit that can cut it: the fixture runs are heuristic only (the
// core's branch-and-bound doesn't prove the fixture in reasonable time), and the generated ones are small enough to prove.
//
//   node app/bench/compare-cores.mts [--base origin/main] [--generated 1500]
//
// Prints a JSON summary and exits 1 when any run differs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as fx from "../solver-fixture.mts";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "origin/main" }, generated: { type: "string", default: "1500" } } });
const base = args.base!, generated = Number(args.generated);

const git = (...a: string[]): string => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const dir = mkdtempSync(join(tmpdir(), "compare-cores-"));
for (const path of git("ls-tree", "-r", "--name-only", base, "--", "scripts/optimizer-core.mts", "app/solver").split("\n").filter(Boolean)) {
  if (path.endsWith(".test.mts")) continue;
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), git("show", `${base}:${path}`));
}
const before = (await import(pathToFileURL(join(dir, "scripts/optimizer-core.mts")).href)) as typeof fx.core;
const after = fx.core;
rmSync(dir, { recursive: true, force: true });

type Args = Parameters<typeof after.optimizeSuit>;
let runs = 0;
const diffs: string[] = [];
const run = (label: string, pools: Args[0], current: Args[1], profile: Args[2], opts: Args[3]): void => {
  runs++;
  if (JSON.stringify(before.optimizeSuit(pools, current, profile, opts)) !== JSON.stringify(after.optimizeSuit(pools, current, profile, opts))) diffs.push(label);
};

// 1. the fixture with every built-in template
const optionSets: Array<[string, Args[3]]> = [
  ["plain", { seed: 2026, restarts: 200 }],
  ["tieFewest", { seed: 2026, restarts: 200, tieBreak: { tolerance: 0, fewestChanges: true } }],
  ["tieTolerance", { seed: 2026, restarts: 200, tieBreak: { tolerance: 2 } }],
];
const names = Object.keys(fx.defaultProfiles.templates);
for (const name of names) {
  const c = fx.cell(name);
  for (const [k, o] of optionSets) run(`${name}/${k}`, c.pools, c.current, c.profile, o);
  const ranks = (fx.defaultProfiles.templates[name] as { goals?: { ranks: string[][] } }).goals?.ranks;
  if (ranks?.length) run(`${name}/strict`, c.pools, c.current, c.profile, { seed: 2026, restarts: 100, strict: { ranks } });
}
const fixtureRuns = runs;

// 2. small generated inventories
let seed = 12345;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const keys = ["physResist", "fireResist", "hci", "dci", "di", "ssi", "stamPool", "sk:resisting spells", "luck"];
const pick = (): string => keys[Math.floor(rnd() * keys.length)]!;
for (let n = 0; n < generated; n++) {
  const slots = fx.fuzzSlots(rnd, 5);
  const pools: Record<string, Array<Record<string, unknown>>> = {}, current: Record<string, unknown> = {};
  let serial = 1;
  for (const s of slots) {
    pools[s] = [];
    const count = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const props: Record<string, number> = {};
      for (const k of keys) if (rnd() < 0.4) props[k] = Math.round((rnd() * 30 - 6) * (k === "luck" ? 10 : 1));
      const it = { serial: serial++, name: `i${serial}`, slot: s, props, ...(s === "twoHanded" && rnd() < 0.5 ? { twoHanded: true } : {}), ...(rnd() < 0.5 ? { tieCost: Math.floor(rnd() * 5) } : {}) };
      pools[s]!.push(it);
      if (i === 0 && rnd() < 0.6) current[s] = it;
    }
  }
  const weights: Record<string, number> = {};
  for (const k of keys) if (rnd() < 0.6) weights[k] = Math.round((rnd() * 10 - 3) * 100) / 100;
  const floors: Record<string, number> = { [pick()]: Math.round(rnd() * 40), [pick()]: Math.round(rnd() * 40) };
  const profile = {
    weights, caps: { physResist: 70, fireResist: 70, hci: 45, dci: 45, ssi: 60 }, floors, hardFloors: rnd() < 0.5 ? [Object.keys(floors)[0]!] : [],
    ...(rnd() < 0.3 ? { floorBonus: Math.round(rnd() * 2000) } : {}), ...(rnd() < 0.3 ? { floorPartial: rnd() * 0.5 } : {}),
    ...(rnd() < 0.3 ? { mins: { physResist: 10, fireResist: 10 } } : {}),
    ...(rnd() < 0.2 ? { resistSteps: [{ at: 5, mins: { physResist: 15, fireResist: 15 } }, { at: 15, mins: { physResist: 25, fireResist: 25 } }] } : {}),
    ...(rnd() < 0.15 ? { hardFloorBonus: 1e10 } : {}),
    ...(rnd() < 0.2 ? { ssiSteps: [{ ssi: 10, stam: 0, credit: 12 }, { ssi: 20, stam: 5, credit: 25 }] } : {}),
  } as unknown as Args[2];
  const opts = { seed: n, restarts: 20, slots, optionalSlots: slots.filter(() => rnd() < 0.7) };
  const p = pools as unknown as Args[0], c = current as unknown as Args[1];
  run(`gen${n}/plain`, p, c, profile, opts);
  run(`gen${n}/exact`, p, c, profile, { ...opts, exact: true, timeBudgetMs: 600000, ...(rnd() < 0.5 ? { alternatives: { count: 3, tolerance: rnd() < 0.5 ? 0 : 5 } } : {}) });
  run(`gen${n}/tie`, p, c, profile, { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, tieBreak: { tolerance: rnd() < 0.5 ? 0 : 3, fewestChanges: rnd() < 0.5 } });
  const ranks = [[pick()], [pick(), pick()]].map((r) => [...new Set(r)]);
  run(`gen${n}/strict`, p, c, profile, { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, strict: { ranks, fewestChanges: rnd() < 0.5 } });
}

console.log(JSON.stringify({ base, templates: names.length, fixtureRuns, generatedRuns: runs - fixtureRuns, runs, identical: runs - diffs.length, diffs: diffs.slice(0, 20) }));
process.exitCode = diffs.length ? 1 : 0;
