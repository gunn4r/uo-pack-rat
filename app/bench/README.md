# Suit-builder scale benchmark

Measures how the Pack Rat suit builder behaves as the inventory grows from today's ~460 items to tens of thousands: fold time, the `/api/inventory` payload, per-slot pool sizes, dominance pruning, and the heuristic and exact phases. The exact phase runs through `app/optimize-worker.mjs` exactly as the server would — HiGHS (`app/mip.mjs` + `app/exact-solver.mjs`) when it loads, the core's own branch-and-bound as the reference proof in tests and as the honest fallback when HiGHS is unavailable. The core's exact search is single-threaded; the multi-thread branch-and-bound pool this bench used to escalate to (once one thread failed to prove a cell) was retired along with `app/shared-search.mjs` (Phase 3) — a cell that fails to prove within budget is now simply reported unproven, and larger N runs a cheap probe instead of repeating the full budget. Raw numbers are in `results/<stamp>.json` with rendered tables in `results/<stamp>.md`; the write-up of the Sep 12 2026 runs (cliff, drivers, ranked levers) is `REPORT.md`. `mip-spike.mjs` is the spike that led to the real HiGHS integration — superseded by `app/mip.mjs` + `app/exact-solver.mjs`, kept as evidence.

Nothing here writes to the data directory's `scans/`. Synthetic scans go to a scratch directory (`--scratch`, default `$TMPDIR/vault-bench`), and the real scans are read only to learn the generator's distributions and to supply the characters.

## Files

- `gen-inventory.mjs` — synthetic scan generator. Learns the empirical shape of the real gear per slot (which tooltip lines co-occur, value ranges per line, tag frequency, rarity, STR requirements, two-handedness, weapon skill lines) and emits N items in the scanner's raw schema (`{version, character, scannedAt, stats, skills, maxes, resists, position, equipped, roots, containers, items}` with raw `tooltip` lines). Each gear piece is a bootstrap copy of a real piece with resampled values (±25% jitter), an occasional added or dropped stat line and re-drawn tags; non-gear items are verbatim copies of real reagents, potions, scrolls and resources. The scan is written by pseudo-character `_bench` into fresh ground chests of 120, so the fold adds it to the real inventory without replacing anything.
- `run-bench.mjs` — the sweep. Every optimizer call runs in `app/optimize-worker.mjs` (the server's worker) under a hard wall cap, because the core's `timeBudgetMs` only bounds the exact phase.
- `results/` — one JSON + one markdown per run.

## Run

```
PACKRAT_DATA=./local node app/bench/gen-inventory.mjs --n 5000 --gear 0.3 --seed 1 --out /path/to/scratch     # one scan file
PACKRAT_DATA=./local node app/bench/run-bench.mjs                                                            # the full sweep (~35 min)
PACKRAT_DATA=./local node app/bench/run-bench.mjs --ns 500,2000 --fractions 0.3 --profiles <Character> --budget 20   # a quick cell
node app/bench/run-bench.mjs --render app/bench/results/<stamp>.json                                        # re-render the tables
```

Options (defaults): `--ns 500,2000,5000,10000,25000,50000` total items (real + synthetic), `--fractions 0.3,1` gear fraction of the synthetic part (0.3 ≈ realistic, 1.0 adversarial), `--profiles` (default: every character in `profiles.json`; `<Character>-anyweapon` runs that character with the weapon-skill filter off, the known worst case for pool size), `--budget 90` exact-phase seconds on one thread, `--hard-cap 150` wall seconds before a worker is killed, `--probe-cap 30`, `--max-minutes 36` global deadline, `--seed 1`, `--scratch <dir>`, `--tag <name>` suffix for the results files. `--prune-lever` measures a harness-side dominance prune restricted to the dimensions the profile weights or floors (plain, and with values clipped at the caps) against the core's own prune, counted on the pools alone; `--prune-run` re-runs the search on the clipped pools wherever that count is smaller than the core's and reports whether the score matches.

Skip rules, so the sweep stays bounded: per (profile, gear fraction), once one thread fails to prove a cell, larger cells run only a cheap 1.5 s-budget probe under a 30 s cap for pool / prune / heuristic numbers; once a probe is killed, larger cells are not run at all. Fold and payload are measured for every (N, fraction) regardless.

## Reading a results file

`inventories[]`: per (N, fraction) — item counts, fold ms (min of 3), fold with the non-gear items removed, payload MB of the full `/api/inventory` body, of only slotted gear, of slotted gear without raw tooltip lines, and of the bare optimizer pools. `cells[]`: per (N, fraction, profile) — `poolSizes`, `single` (phase timings from the progress stream, nodes, `proven`, `pruned` before → after, heuristic score vs proven score) and `mode` (`full` / `probe` / `not run`) with a `note`.
