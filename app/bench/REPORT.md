# Suit-builder scale benchmark — report (Sep 12–13 2026)

How the Pack Rat suit builder behaves as the inventory grows from today's 459 items (281 gear) to 50,000, where the exact search stops proving the optimum, which quantity drives the blow-up, and which lever would fix it. Two runs, both on the server's own worker (`app/optimize-worker.mts`) and its parallel path (`shared-search.mjs`, WORKERS = min(8, cores − 1) = 8 on this 10-core machine, Node v24.15.0):

- **Run 1** (`results/2026-09-12T23-18-11.{json,md}`, 24 min): N ∈ {500, 2000, 5000, 10000, 25000, 50000} × gear fraction {0.3 realistic, 1.0 all-gear} × {Dorran, Kestrel, Rowan with the weapon filter off}. Single thread with a 90 s exact budget; the 8-worker path (90 s) on every cell one thread could not prove, until it failed too.
- **Run 2** (`results/2026-09-13T00-01-31-realistic-parallel.{json,md}`, 15 min): the realistic cells at N ∈ {500, 2000, 20000, 30000} along the server's path exactly as `vault-server.mjs` runs it (1.5 s solo attempt, then 8 workers with a 120 s budget), plus the pruning-lever measurement.

Harness and generator are in `app/bench/` (`README.md` says how to run them). **Everything beyond the 459 real items is synthetic** — read "How synthetic data differs from a real hoard" before extrapolating.

## Short answers

- **Can it realistically run with 20,000 or 30,000 items on 8 threads? No, not as a proven build — only as a heuristic answer.** All six 20k/30k cells (three profiles, realistic 30% gear) came back unproven after 1.5 s solo + 120 s on 8 workers: Dorran 115 M nodes (20k) / 162 M (30k), Kestrel 74 M / 73 M, Rowan-any-weapon 2.5 G / 1.45 G, explored fractions effectively 0 (the tree is 10⁸–10¹⁵ times larger than what 16 core-minutes visit). In every one of the six cells the score after the 8-worker search was **exactly the heuristic's score** — 120 s × 8 cores found nothing better than the 1.3–4.7 s hill climb. The machinery itself copes (fold 94–132 ms, heuristic 1.3–4.7 s, dominance prune 30–70 ms, no worker killed, 14.6–22 MB payload), so the user gets an answer after ~2.5 min; it is just the heuristic's suit with no statement about how far from optimal it is. A proven answer today needs a pool of roughly ≤ 500 candidates (Dorran at 2,000 items, 488-candidate pool: 49 s on 8 workers); at 20,000 items the pools are 4,000–7,000. **"Only with X":** only with the levers ranked below — an anytime search that reports its bound gap (so the 2.5 min buys a quality statement), per-item optimistic-bound pool cuts, and a stronger bound — or by filtering the pool ~10× harder (locked slots, tags, STR, weapon skill, meditation) before the search.
- **Where is the cliff?** One thread, 90 s: Dorran and Rowan-any-weapon prove at N = 500 only (the real inventory is 459) and fail at 2,000 (Dorran 29% explored in 90 s, Rowan 0.2%). Kestrel proves through 5,000 realistic (64 s) and 2,000 all-gear (73 s) and fails at 10,000 realistic / 5,000 all-gear. Eight workers move exactly one cell: Dorran 2,000 realistic (proven in 48.5–52.6 s, 475 M nodes). Every other unproven cell stays unproven on 8 workers.
- **What drives it?** The exact search tree = the product of per-slot candidate counts after dominance pruning, against a bound that only cuts well when the profile's hard floors are tight. Raw pool size sets the counts (pool ≈ 0.21–0.24 × N realistic, 0.61–0.77 × N all-gear; dominance keeps 73–83% at N = 500, 42–58% at 5,000, 26–38% at 50,000 — so the count after dominance still grows almost linearly in N). Profile shape moves the cliff by an order of magnitude: Kestrel (LRC 100 / LMC 40 / FC 2 / FCR 6 floors, meditation-safe only) proves at 3× the N Dorran does (nine floors, five of them resists at 70 that hundreds of combinations satisfy); Rowan with the one-handed pool open is worst.
- **Which lever?** Not dominance pruning (already restricted to the profile's dimensions — measured identical in all 12 cells), not the fold (215 ms at 50,000 items), not a database. In order: server-side pools so the browser never receives the inventory; anytime search with a reported bound gap instead of "proven or nothing"; per-item optimistic-bound pool cuts; a stronger relaxation bound. Details and expected payoff below.
- **Would a SQLite store help? No** — the fold is 46 ms today and 215–352 ms at 50,000 items, nothing measured is I/O- or storage-bound, and a store touches neither the payload (server-side pools fix that) nor the search cliff.

## Inventories: fold and payload (run 1, plus the 20k/30k rows of run 2)

Real 459 items plus synthetic; "slotted gear" = wearable pieces in the 12 optimizer slots. Fold = min of 3 folds of all 17 real scans plus the synthetic one. Payload = the `/api/inventory` body; "slotted only" / "slotted, no lines" / "pools only" = what the browser would receive if only slotted gear, slotted gear without raw tooltip lines, or the bare `toOptItem` pools were shipped.

| N | gear frac | items | slotted gear | fold | fold gear-only | payload | slotted only | slotted, no lines | pools only | scan file |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 0.3 | 500 | 277 | 26 ms | 22 ms | 0.43 MB | 0.29 MB | 0.21 MB | 0.05 MB | 0.01 MB |
| 500 | 1 | 500 | 308 | 25 ms | 22 ms | 0.44 MB | 0.32 MB | 0.24 MB | 0.05 MB | 0.02 MB |
| 2000 | 0.3 | 2000 | 709 | 30 ms | 24 ms | 1.52 MB | 0.70 MB | 0.51 MB | 0.12 MB | 0.37 MB |
| 2000 | 1 | 2000 | 1771 | 38 ms | 33 ms | 1.86 MB | 1.71 MB | 1.24 MB | 0.30 MB | 0.57 MB |
| 5000 | 0.3 | 5000 | 1597 | 46 ms | 32 ms | 3.71 MB | 1.56 MB | 1.13 MB | 0.27 MB | 1.10 MB |
| 5000 | 1 | 5000 | 4669 | 55 ms | 51 ms | 4.72 MB | 4.50 MB | 3.24 MB | 0.80 MB | 1.70 MB |
| 10000 | 0.3 | 10000 | 3119 | 61 ms | 43 ms | 7.38 MB | 3.03 MB | 2.19 MB | 0.53 MB | 2.31 MB |
| 10000 | 1 | 10000 | 9520 | 86 ms | 82 ms | 9.46 MB | 9.13 MB | 6.58 MB | 1.63 MB | 3.55 MB |
| 20000 | 0.3 | 20000 | 5995 | 94 ms | 62 ms | 14.62 MB | 5.79 MB | 4.19 MB | 1.02 MB | 4.70 MB |
| 25000 | 0.3 | 25000 | 7398 | 118 ms | 74 ms | 18.28 MB | 7.15 MB | 5.16 MB | 1.27 MB | 5.91 MB |
| 25000 | 1 | 25000 | 24069 | 186 ms | 181 ms | 23.75 MB | 23.10 MB | 16.63 MB | 4.13 MB | 9.16 MB |
| 30000 | 0.3 | 30000 | 9065 | 132 ms | 85 ms | 22.00 MB | 8.77 MB | 6.33 MB | 1.56 MB | 7.17 MB |
| 50000 | 0.3 | 50000 | 14791 | 215 ms | 130 ms | 36.50 MB | 14.27 MB | 10.30 MB | 2.54 MB | 11.94 MB |
| 50000 | 1 | 50000 | 48433 | 352 ms | 353 ms | 47.52 MB | 46.42 MB | 33.42 MB | 8.33 MB | 18.49 MB |

- **Fold:** 4–7 µs per item past the fixed cost; 50,000 items fold in 215 ms realistic / 352 ms all-gear. Never a problem.
- **Hypothesis (a), non-gear tooltip parsing:** removing the non-gear raw items from the snapshots saves 13% of fold time at N = 500, ~30% at 5,000–10,000, 40% at 50,000 realistic (215 → 130 ms). Real, but 85 ms at the largest size is not worth a code path.
- **Hypothesis (b), payload:** `/api/inventory` ships ~0.73 KB per item realistic (0.95 all-gear): 1.5 MB at 2,000 items, 7.4 MB at 10,000, 14.6 MB at 20,000, 22 MB at 30,000, 36.5 MB at 50,000. Slotted gear only cuts it to ~39%, slotted gear without raw `lines` to ~28%, the bare optimizer pools to ~7% (1.0–1.6 MB at 20–30k, 2.5 MB at 50k). The page also builds the inventory table from the whole thing; at 20,000+ rows the rendering, not the transfer, is the next wall without virtualization.

## Suit builder, run 1: single thread with 90 s, then 8 workers

Per cell: pool total after the profile's filters (STR, tags, race, weapon skill, meditation, forbidden skills; locked slots empty), the core's candidate count before → after dominance pruning (this figure includes the "wear nothing" entries of optional slots and the locked worn weapon, which is why it is a little above the pool total), phase times from the progress stream (every phase change emits unconditionally, so they are exact), branch-and-bound nodes, whether one thread proved the optimum inside 90 s, whether the heuristic's suit equalled the proven one, and the 8-worker result where one thread failed.

**How to read the modes and the "exact 1.5 s … no (0.0% explored)" rows.** `full` = a 90 s single-thread run, plus the 8-worker run when unproven. `parallel*` = a smaller N already failed on one thread, so the cell ran only the server's 1.5 s solo attempt (`SOLO_MS` in `vault-server.mjs`) and then the pool. `probe*` = both paths already failed at a smaller N, so the cell ran a 1.5 s exact budget under a 30 s hard cap purely to record pool, prune and heuristic numbers. Every 1.5 s unproven row is therefore a deliberate, budget-limited probe — not a crash, not an error, not a time-out of a real attempt; the harness stops spending 90 s cells once a smaller cell has failed because a larger tree cannot prove where a smaller one did not. The single `killed in heuristic` row (Kestrel, 50,000 all-gear, 31,899-candidate pool) hit the 30 s probe cap before its 200 heuristic restarts finished (at 0.5–1.2 ms per pool item that heuristic needs ~35 s); no other worker was killed in either run.

### Dorran (locked one-handed Longsword; 9 hard floors: resists 70 ×5, HCI 35, DCI 35, SSI 38, stamina 10; swords only)

| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact | nodes | proven (1 thread) | heur = optimum | parallel (8 workers) | mode |
|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 500 | 0.3 | 171 | bracelet 47 | 174 → 144 | 98 ms | 0 ms | 2.6 s | 14100126 | yes | NO | – | full |
| 500 | 1 | 188 | bracelet 52 | 192 → 154 | 101 ms | 1 ms | 2.7 s | 14178988 | yes | yes | – | full |
| 2000 | 0.3 | 488 | bracelet 135 | 479 → 319 | 191 ms | 2 ms | 90.0 s | 187193344 | no (29.0% explored) | – | proven 52.6 s | full |
| 2000 | 1 | 1225 | bracelet 350 | 1186 → 717 | 448 ms | 6 ms | 90.0 s | 60993536 | no (0.1% explored) | – | unproven 90.2 s | full |
| 5000 | 0.3 | 1094 | bracelet 280 | 1057 → 669 | 394 ms | 6 ms | 1.5 s | 567296 | no (0.0% explored) | – | unproven 90.1 s | parallel* |
| 5000 | 1 | 3284 | bracelet 824 | 3168 → 1608 | 1.2 s | 23 ms | 1.5 s | 496640 | no (0.0% explored) | – | – | probe* |
| 10000 | 0.3 | 2197 | bracelet 545 | 2124 → 1128 | 887 ms | 13 ms | 1.5 s | 611328 | no (0.0% explored) | – | – | probe* |
| 10000 | 1 | 6707 | bracelet 1744 | 6462 → 2726 | 2.5 s | 69 ms | 1.5 s | 780288 | no (0.0% explored) | – | – | probe* |
| 25000 | 0.3 | 5259 | bracelet 1418 | 5080 → 2226 | 1.9 s | 42 ms | 1.5 s | 372736 | no (0.0% explored) | – | – | probe* |
| 25000 | 1 | 16979 | bracelet 4363 | 16364 → 5499 | 6.5 s | 340 ms | 1.5 s | 192512 | no (0.0% explored) | – | – | probe* |
| 50000 | 0.3 | 10552 | bracelet 2760 | 10136 → 3840 | 4.0 s | 130 ms | 1.5 s | 178176 | no (0.0% explored) | – | – | probe* |
| 50000 | 1 | 34420 | bracelet 8900 | 33137 → 9427 | 12.8 s | 1.1 s | 1.5 s | 49152 | no (0.0% explored) | – | – | probe* |

### Kestrel (no locks; 9 hard floors: LRC 100, LMC 40, FC 2, FCR 6, resists 60 ×5; meditation-safe only; Necromancy / Spirit Speak forbidden)

| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact | nodes | proven (1 thread) | heur = optimum | parallel (8 workers) | mode |
|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 500 | 0.3 | 160 | bracelet 50 | 167 → 122 | 106 ms | 0 ms | 11 ms | 26107 | yes | yes | – | full |
| 500 | 1 | 174 | bracelet 55 | 181 → 127 | 102 ms | 0 ms | 13 ms | 31172 | yes | yes | – | full |
| 2000 | 0.3 | 458 | bracelet 138 | 465 → 272 | 234 ms | 2 ms | 888 ms | 1705591 | yes | NO | – | full |
| 2000 | 1 | 1150 | bracelet 370 | 1157 → 555 | 570 ms | 5 ms | 72.9 s | 24551888 | yes | yes | – | full |
| 5000 | 0.3 | 992 | bracelet 296 | 999 → 514 | 448 ms | 4 ms | 63.7 s | 27786420 | yes | yes | – | full |
| 5000 | 1 | 3051 | bracelet 879 | 3058 → 1286 | 1.6 s | 21 ms | 90.0 s | 14765056 | no (0.1% explored) | – | unproven 90.3 s | full |
| 10000 | 0.3 | 2013 | bracelet 578 | 2020 → 892 | 1.1 s | 12 ms | 90.0 s | 23905280 | no (0.2% explored) | – | unproven 90.2 s | full |
| 10000 | 1 | 6306 | bracelet 1883 | 6313 → 2070 | 4.6 s | 68 ms | 1.5 s | 75776 | no (0.0% explored) | – | – | probe* |
| 25000 | 0.3 | 4833 | bracelet 1498 | 4840 → 1696 | 3.1 s | 45 ms | 1.5 s | 292864 | no (0.0% explored) | – | – | probe* |
| 25000 | 1 | 15784 | bracelet 4664 | 15791 → 3976 | 19.6 s | 297 ms | 1.5 s | 55296 | no (0.0% explored) | – | – | probe* |
| 50000 | 0.3 | 9703 | bracelet 2915 | 9710 → 2847 | 9.5 s | 115 ms | 1.5 s | 61440 | no (0.0% explored) | – | – | probe* |
| 50000 | 1 | 31899 | bracelet 9527 | – | – | – | – | 0 | killed in heuristic | – | – | probe* |

### Rowan with the weapon filter off (locked two-handed Repeating Crossbow; 7 hard floors: resists 70 / Energy 75, HCI 45, stamina 8; any one-hander)

| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact | nodes | proven (1 thread) | heur = optimum | parallel (8 workers) | mode |
|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 500 | 0.3 | 192 | bracelet 51 | 199 → 156 | 85 ms | 1 ms | 364 ms | 1566554 | yes | yes | – | full |
| 500 | 1 | 214 | bracelet 56 | 221 → 167 | 90 ms | 0 ms | 487 ms | 2140034 | yes | yes | – | full |
| 2000 | 0.3 | 542 | bracelet 140 | 549 → 345 | 227 ms | 2 ms | 90.0 s | 399121408 | no (0.2% explored) | – | unproven 90.1 s | full |
| 2000 | 1 | 1390 | bracelet 376 | 1397 → 782 | 352 ms | 7 ms | 90.0 s | 306699264 | no (0.0% explored) | – | unproven 90.2 s | full |
| 5000 | 0.3 | 1213 | bracelet 305 | 1220 → 732 | 325 ms | 5 ms | 1.5 s | 6236160 | no (0.0% explored) | – | – | probe* |
| 5000 | 1 | 3644 | bracelet 895 | 3651 → 1701 | 1.0 s | 24 ms | 1.5 s | 1547264 | no (0.0% explored) | – | – | probe* |
| 10000 | 0.3 | 2441 | bracelet 592 | 2448 → 1207 | 715 ms | 14 ms | 1.5 s | 4412416 | no (0.0% explored) | – | – | probe* |
| 10000 | 1 | 7502 | bracelet 1908 | 7509 → 2917 | 2.0 s | 74 ms | 1.5 s | 1842176 | no (0.0% explored) | – | – | probe* |
| 25000 | 0.3 | 5830 | bracelet 1534 | 5837 → 2363 | 1.5 s | 49 ms | 1.5 s | 4845568 | no (0.0% explored) | – | – | probe* |
| 25000 | 1 | 18961 | bracelet 4749 | 18968 → 5771 | 5.8 s | 377 ms | 1.5 s | 2340864 | no (0.0% explored) | – | – | probe* |
| 50000 | 0.3 | 11691 | bracelet 2977 | 11698 → 4067 | 3.3 s | 153 ms | 1.5 s | 3533824 | no (0.0% explored) | – | – | probe* |
| 50000 | 1 | 38432 | bracelet 9719 | 38439 → 9908 | 11.0 s | 1.6 s | 1.5 s | 2877440 | no (0.0% explored) | – | – | probe* |

Note on the "known worst case": Rowan with any weapon was earlier measured at ~20 s on the real inventory (58 s with 5 alternatives). Here the same profile proves in 0.45 s at N = 500 because the current `profiles.json` locks the two-handed slot to the Repeating Crossbow, which empties the shield / two-hander pool; the quoted figures were measured with the hands free. The 2,000-item row (399 M nodes, 0.2% explored, 8 workers no better at 90 s and, in run 2, 2.6 G nodes at 120 s) shows what the open one-handed pool does at scale.

## Suit builder, run 2: realistic cells along the server's path, 8 workers × 120 s, and the pruning lever

Every cell ran the way `vault-server.mjs` runs a build: 1.5 s single-thread attempt (`SOLO_MS`), then, if unproven, 8 workers in shared mode warm-started from the solo best with a 120 s budget. So the "exact 1.5 s … no" entries in these tables are the solo attempt, and the parallel column is the real result. The lever tables count, per cell, what the core's own dominance prune keeps of the pools alone (no "wear nothing" entries — apples to apples, via the bench's private copy of the core that exports `optDominancePrune`), what a harness prune restricted to the dimensions the profile weights (non-zero) or floors keeps, and the same with item values clipped at the caps before comparing (valid on a dimension with no negative values; a capped total cannot tell 80 from 70 once one item reaches 70). The harness would have re-run the search on the clipped pools wherever that count was smaller than the core's; it never was.

### Dorran

| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact (solo) | nodes | proven (solo 1.5 s) | heur = optimum | parallel (8 workers, 120 s) | mode |
|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 500 | 0.3 | 171 | bracelet 47 | 174 → 144 | 86 ms | 0 ms | 1.5 s | 8266752 | no (49.4% explored) | – | proven 576 ms | parallel* |
| 2000 | 0.3 | 488 | bracelet 135 | 479 → 319 | 181 ms | 2 ms | 1.5 s | 4751360 | no (0.2% explored) | – | proven 48.5 s | parallel* |
| 20000 | 0.3 | 4166 | bracelet 1143 | 4034 → 1837 | 1.5 s | 33 ms | 1.5 s | 258048 | no (0.0% explored) | – | unproven 120.3 s | parallel* |
| 30000 | 0.3 | 6436 | bracelet 1631 | 6175 → 2667 | 2.3 s | 61 ms | 1.5 s | 602112 | no (0.0% explored) | – | unproven 120.4 s | parallel* |

| N | dims | pool total | core's prune | profile dims | profile dims + cap clip | re-run on clipped pools |
|---:|---:|---:|---:|---:|---:|---|
| 500 | 29 | 171 | 139 | 139 | 139 | same count, not re-run |
| 2000 | 29 | 488 | 317 | 317 | 317 | same count, not re-run |
| 20000 | 29 | 4166 | 1856 | 1856 | 1856 | same count, not re-run |
| 30000 | 29 | 6436 | 2702 | 2702 | 2702 | same count, not re-run |

Parallel detail: 20k — 176 tasks, 114.8 M nodes, final score 90,003,984.00 = heuristic score; 30k — 286 tasks, 162.2 M nodes, 90,003,940.45 = heuristic score. (The 30k score is below the 20k one because the inventories are different random draws, not because the search got worse.)

### Kestrel

| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact (solo) | nodes | proven (solo 1.5 s) | heur = optimum | parallel (8 workers, 120 s) | mode |
|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 500 | 0.3 | 160 | bracelet 50 | 167 → 122 | 90 ms | 1 ms | 10 ms | 26107 | yes | yes | – | parallel* |
| 2000 | 0.3 | 458 | bracelet 138 | 465 → 272 | 204 ms | 2 ms | 879 ms | 1705591 | yes | NO | – | parallel* |
| 20000 | 0.3 | 3981 | bracelet 1221 | 3988 → 1467 | 2.2 s | 29 ms | 1.5 s | 123904 | no (0.0% explored) | – | unproven 120.3 s | parallel* |
| 30000 | 0.3 | 5943 | bracelet 1759 | 5950 → 2043 | 4.7 s | 54 ms | 1.5 s | 238592 | no (0.0% explored) | – | unproven 120.4 s | parallel* |

| N | dims | pool total | core's prune | profile dims | profile dims + cap clip | re-run on clipped pools |
|---:|---:|---:|---:|---:|---:|---|
| 500 | 26 | 160 | 115 | 115 | 115 | same count, not re-run |
| 2000 | 26 | 458 | 265 | 265 | 265 | same count, not re-run |
| 20000 | 26 | 3981 | 1460 | 1460 | 1460 | same count, not re-run |
| 30000 | 26 | 5943 | 2036 | 2036 | 2036 | same count, not re-run |

Parallel detail: 20k — 138 tasks, 74.2 M nodes, 90,003,394.50 = heuristic; 30k — 224 tasks, 73.3 M nodes, 90,003,424.22 = heuristic.

### Rowan with the weapon filter off

| N | gear frac | pool total | largest slot | cands before → after prune | heuristic | prune | exact (solo) | nodes | proven (solo 1.5 s) | heur = optimum | parallel (8 workers, 120 s) | mode |
|---:|---:|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 500 | 0.3 | 192 | bracelet 51 | 199 → 156 | 74 ms | 1 ms | 362 ms | 1566554 | yes | yes | – | parallel* |
| 2000 | 0.3 | 542 | bracelet 140 | 549 → 345 | 161 ms | 3 ms | 1.5 s | 6503424 | no (0.0% explored) | – | unproven 120.1 s | parallel* |
| 20000 | 0.3 | 4717 | bracelet 1243 | 4724 → 1955 | 1.3 s | 39 ms | 1.5 s | 7077888 | no (0.0% explored) | – | unproven 120.3 s | parallel* |
| 30000 | 0.3 | 7121 | bracelet 1785 | 7128 → 2845 | 1.9 s | 70 ms | 1.5 s | 1687552 | no (0.0% explored) | – | unproven 120.4 s | parallel* |

| N | dims | pool total | core's prune | profile dims | profile dims + cap clip | re-run on clipped pools |
|---:|---:|---:|---:|---:|---:|---|
| 500 | 28 | 192 | 149 | 149 | 149 | same count, not re-run |
| 2000 | 28 | 542 | 338 | 338 | 338 | same count, not re-run |
| 20000 | 28 | 4717 | 1948 | 1948 | 1948 | same count, not re-run |
| 30000 | 28 | 7121 | 2838 | 2838 | 2838 | same count, not re-run |

Parallel detail: 2k — 510 tasks, 2.60 G nodes, 70,003,393.50 = heuristic; 20k — 196 tasks, 2.51 G nodes, 70,003,728.00 = heuristic; 30k — 336 tasks, 1.45 G nodes, 70,003,697.20 = heuristic.

## What the numbers say

**Phase costs scale as expected; only the exact phase explodes.** Heuristic (greedy + gradient seed + 200 restarts of hill climbing): 0.26–0.66 ms per pool item, linear — 1.3–2.3 s at a 4,000–7,000 pool (20k–30k realistic), 4 s at 10,500 (50k realistic), 13 s at 34,000 (50k all-gear). Kestrel's is 2–3× slower per item (0.5–1.2 ms; 4.7 s at 30k, 19.6 s at 15,800, killed at the 30 s cap for 31,900) because her weights cover more dimensions and every slot is optional. Dominance pruning is O(n²) per slot but stays cheap: 30–70 ms at 20k–30k, 130 ms at a 10,500 pool, 1.6 s at 38,000. Branch-and-bound runs at 2–5 M nodes/s on one thread for Dorran and Rowan and 0.2–2 M for Kestrel (her bound is evaluated more often per node); 8 workers reach 9–21 M nodes/s (4.3–4.5× a single thread on a 10-core laptop with the main thread and the OS taking their share). None of that is the problem: the tree is.

**The tree.** With 10 free slots of c candidates each the search has up to c¹⁰ leaves; the bound prunes most of it, but explored fractions of 10⁻⁸ … 10⁻¹⁵ after 1.5 s mean the remaining 120 s × 8 workers (16 core-minutes, up to 2.6 G nodes) cannot matter. Dorran 2,000 realistic is the one cell where the pool changes the outcome (29% explored in 90 s on one thread → proven in 48.5–52.6 s on eight, 475 M nodes). Everything one step larger is beyond both paths, and — the telling detail — in every unproven cell of run 2 the 8-worker search returned exactly the heuristic's score: at these sizes the exact phase is pure proof effort that never completes, not a search that finds better suits. Post-dominance candidates per slot are what the tree is built from; at 25,000 realistic Dorran has bracelet 1,418, ring 827, helmet 793, chest 683, shield/two-hander 598 raw, and dominance keeps 44% of Dorran's, 35% of Kestrel's, 40% of Rowan's pool. Both raw pool size (which sets the per-slot counts) and profile shape (which sets how much the bound cuts) drive it; the count after dominance is the honest measure and it still grows almost linearly in N.

**Profile shape.** Kestrel proves 3× larger inventories than Dorran and Rowan-any-weapon on one thread because her floors are tight: LRC 100 with LMC 40 and FC/FCR are met by few combinations, so the hard-floor bonus (10⁷ per floor) turns the bound into a feasibility cut early in the tree. Dorran's nine floors are five resists at 70 (with the Resisting Spells bonus subtracted, hundreds of combinations reach them), HCI/DCI/SSI and stamina — reachable in many ways, so the bound rarely rules a subtree out until deep. Rowan-any-weapon has seven floors and an open one-handed pool (73 candidates at 2,000, 782 at 25,000): the slot enumerated last multiplies every partial suit. Locked slots help exactly as much as they remove a factor from the product (Dorran's locked Longsword removes the whole one-handed pool; Rowan's locked crossbow removes the two-handed one; a weights-only profile with no floors and no locks would fall off the cliff earlier than any of the three — not measured).

**The heuristic is not a safe fallback for hard-floor profiles.** In the 10 proven cells of run 1 the heuristic's suit was the optimum 8 times. The two misses matter: Dorran at N = 500 realistic (the cell closest to the real inventory) scored 84,923,122 against the proven 90,002,815 — the hill climber stopped one hard floor short, i.e. it would have shown a suit that fails a requirement while a suit meeting all nine existed (run 2 reproduced it: the 1.5 s solo attempt returned the same 84.9 M and the 8 workers fixed it in 0.6 s). Kestrel at 2,000 realistic missed by 2.5 points (a genuinely near-optimal suit). Above the cliff the heuristic's answer is what the user gets after the parallel search also fails, with no statement about how far off it is.

**Pruning lever (measured in the harness, no app code changed).** Dropping every candidate dominated on the dimensions the profile weights or floors, ignoring all other properties, keeps exactly the number of items the core's own prune keeps — identical in all 12 cells of run 2 (Dorran 139 / 317 / 1,856 / 2,702; Kestrel 115 / 265 / 1,460 / 2,036; Rowan 149 / 338 / 1,948 / 2,838). That is because `optDimSign` in `scripts/optimizer-core.ts` already returns 0 for a dimension with neither weight nor floor, so the core's dominance test is already restricted to the profile's dimensions. Clipping values at the caps before comparing removed 0 further items in every cell. The lever the task asked to measure is already in place; there is nothing left in dominance pruning, and the measured keep ratios (26–44% at 20k+) are what it delivers.

## Ranked recommendations

1. **Build pools on the server and ship pools, not the inventory.** Payoff: the browser payload drops from ~0.73 KB/item to ~0.05 KB/item (14.6 MB → 1.0 MB at 20,000, 22 MB → 1.6 MB at 30,000, 36.5 MB → 2.5 MB at 50,000 realistic), the page stops folding and filtering 20,000+ items on every load, and pool building becomes a cacheable server call keyed like `runKey`. Needed before any 20,000-item inventory is usable at all, independent of the search. The inventory tab then needs server-side search/paging or a virtualized table — 20,000 DOM rows is the next wall.
2. **Above ~1,000 gear pieces, make the exact run an anytime search that reports its bound gap, instead of "proven or nothing".** The search already holds the best suit and the root bound; report `best`, the root bound, `explored` and the gap, let the user stop when the gap is small, and choose the default budget by pool size (below ~500 candidates prove, above it search for a fixed time). Payoff: at 20,000–30,000 items the user currently waits ~2.5 min for a suit that is provably the heuristic's and cannot tell whether it is 0.1% or 10% off; a gap number turns that into a usable answer and stops the pool from burning 8 cores for 120 s on a tree it will never finish.
3. **Cut pools by an optimistic per-item bound against the incumbent, before the search and again whenever the incumbent improves.** For each slot and candidate, evaluate the existing tight bound with that item fixed and the other slots free; drop it when the bound cannot beat the incumbent. Branch-and-bound does this at depth 1 for the first slot only; doing it for every slot is O(pool × dims) per pass and removes every item that can never be part of a better suit — for tight-floor profiles (Kestrel) that should be most of a large pool. Expected payoff: large for hard-floor profiles, modest for weight-only ones; it also makes the heuristic's floor misses (Dorran 500) unlikely because the pool it climbs in is already floor-feasible. Measure on this harness before committing.
4. **A stronger relaxation bound for the remaining slots** (a per-dimension knapsack over the best few items per slot, or a small LP) instead of the per-slot best-single-item coupled bound. Uncertain payoff; the coupled bound gave 200× on the real inventory (see the Optimizer notes in `CONTRIBUTING.md`), so this is where a second 10–100× would have to come from if proving at 5,000+ gear pieces is a goal at all.
5. **Skip tooltip parsing for non-gear items:** saves ≤ 40% of a 215 ms fold at 50,000 items (85 ms); 32 ms at 20,000. Not worth a code path; only as a side effect of splitting the fold into a gear pass and an inventory pass under recommendation 1.
6. **Persistent store (SQLite): no measurable benefit.** The fold is 46 ms today and 215–352 ms at 50,000 items, scan files are 5–18 MB at that size, nothing in the pipeline is I/O-bound; a store would help incremental folds and history queries, neither of which is a bottleneck, and it touches neither the payload (1) nor the search (2–4).

Fold-side nothing needs doing: 4–7 µs per item.

## How synthetic data differs from a real hoard

- The generator bootstraps from 274 real gear pieces: every synthetic piece is a real piece's name, slot, rarity line, weapon skill line and property set with resampled values (±25% jitter), plus an occasional added or dropped stat line and re-drawn tags. Property co-occurrence and value ranges are therefore realistic, but diversity is bounded by the templates (3.5% of 4,855 synthetic slotted pieces were exact duplicates at 5,000 all-gear). A real hoard has more distinct property combinations, which makes dominance pruning **less** effective than measured (fewer exact dominators): the candidate counts above are optimistic.
- Values are resampled independently per line, so synthetic pieces combine strong values more freely than loot tables do (a real Greater Magic bracelet does not carry every line near its maximum). That inflates the number of near-tied strong candidates and makes the tree **harder** to prune by score than a real inventory of the same size; on the other hand real hoards hold many junk pieces that dominance removes at once. The net direction is unknown; trust the orders of magnitude, not the exact cliff row.
- The realistic non-gear share (70%) is copied verbatim from today's 178 non-gear items (reagents, potions, scrolls, maps, refinements); a real 30,000-item hoard would be dominated by resources and stacks, which cost the same to fold and nothing to search.
- The three profiles are today's tuned ones (Dorran with Longsword locked and swords only; Kestrel meditation-safe with hands free; Rowan with the crossbow locked and any one-hander). Profiles with fewer floors or no locked slots hit the cliff earlier; a weights-only profile was not measured.
- Shield / two-hander pools inherit the real mix (45 among 268 real slotted pieces); a hoard with hundreds of shields would multiply the tree by that slot too.
- Each N is one random draw (seed 1000 + N); no repeats, so a row's exact seconds carry draw noise (e.g. the Dorran 2,000 parallel cell: 52.6 s in run 1, 48.5 s in run 2 on the same draw).

## Reproduce

See `README.md`. Run 1: `node app/bench/run-bench.mjs` (24 min). Run 2: `node app/bench/run-bench.mjs --ns 500,2000,20000,30000 --fractions 0.3 --force-parallel --parallel-budget 120 --prune-lever --prune-run --tag realistic-parallel` (15 min). Re-render tables from a results file with `--render <file>`. A single cell without any cap, printing progress every 30 s: `node app/bench/run-bench.mjs --ns 20000 --fractions 0.3 --profiles Dorran --force-parallel --budget 86400 --parallel-budget 86400 --hard-cap 90000 --probe-cap 90000 --max-minutes 1500 --log-progress 30 --tag uncapped` (the Sep 13 2026 uncapped run, reported below). **Uncapped run (Sep 13 2026):** Dorran, realistic 20,000 items, 8 workers, no budget, progress logged every 30 s — after 21 min: 193 M nodes, 0 of 188 tasks finished, explored 0.0015 % at a steady 1.2 × 10⁻⁶ %/s, i.e. a full proof would take on the order of 10⁸ s (years). Stopped. "How long does it actually take" at this size is: it does not finish; the anytime-search-with-bound-gap lever is the answer, not a longer wait.

## Addendum (Sep 13 2026): the suit problem as a mixed-integer program — HiGHS proves 30,000-item inventories in ~2.5 s

The blow-up above is the bound's, not the problem's. Picking one item per slot to maximize a sum of capped weighted totals under hard floors is a multiple-choice knapsack: binaries x_{slot,item}, one "at most / exactly one per slot" row per slot, one linear row per hard floor, each cap as a continuous c_d ≤ total_d, c_d ≤ cap_d with the weight on c_d (min is concave, so this is exact), uncapped weights linear (aggregated per variable — an LP-format reader keeps one coefficient per name), the two-hander rule as one row over the two-handed weapons plus every one-hand candidate, locked slots as constants, and the keep-what-you-wear rule by adding each slot's worn piece to its candidate list (the core does this; a filtered-out worn piece is still a candidate — building the cell without it is why two earlier bench "proven" figures sat below the MIP's, not a core bug). Hard-floor bonuses become a constant (9 × 10⁷). `mip-spike.mjs` builds that LP text and solves it with HiGHS compiled to WebAssembly (`highs` npm package, MIT, ~2 MB), single-threaded, `mip_rel_gap` 0. Validation: on the real inventory and on every synthetic cell where the core proves, the MIP's suit scored by the core's own `scoreSet` equals the core's proven optimum to the decimal (real Dorran 90,002,815.25 / Kestrel 90,002,129.5 / Rowan-any-weapon 70,003,147.5; Dorran 500 and Kestrel 2,000 likewise), while taking 69–384 ms against the core's 84–2,329 ms.

| N (realistic) | pool | Dorran | Kestrel | Rowan-any-weapon | vs the core |
|---:|---:|---:|---:|---:|---|
| real (459) | 175–196 | 205 ms | 69 ms | 73 ms | equal to the core's proven optimum, 8–25× faster |
| 500 | 171–204 | 280 ms | 81 ms | 87 ms | equal |
| 2,000 | 469–554 | 320 ms | 376 ms | 280 ms | equal where the core proves; Dorran: core heuristic = MIP optimum after 150 s unproven |
| 20,000 | 3,915–4,726 | 2.1 s | 1.1 s | 1.1 s | proven; the core's heuristic equals it for Dorran and Kestrel and is 4 points short for Rowan |
| 30,000 | 5,954–7,133 | 2.5 s | 1.6 s | 2.2 s | proven; heuristic 29 points short for Rowan |

All twelve synthetic cells report Optimal; the whole sweep ran in 14 s of wall time. Pushed further the same morning, still single-threaded WASM with `mip_rel_gap` 0:

| N | gear frac | pool (candidates) | Dorran | Kestrel | Rowan-any-weapon |
|---:|---:|---:|---:|---:|---:|
| 10,000 | 1.0 | 6,317–7,514 | 3.1 s | 2.0 s | 1.6 s |
| 25,000 | 1.0 | 15,795–18,973 | 5.3 s | 6.1 s | 4.4 s |
| 50,000 | 0.3 | 9,714–11,703 | 4.8 s | 3.0 s | 2.9 s |
| 50,000 | 1.0 | 31,910–38,444 | 8.2 s | 7.6 s | 8.6 s |

Every cell Optimal. No cliff up to 38,000 candidates; time grows roughly linearly in pool size (~0.2 ms per candidate), which is the LP size, not a search explosion. So the honest answer to "can it realistically run with 20,000 or 30,000 items" becomes **yes, with a proof, in about two seconds** — by replacing the hand-written branch-and-bound with a MIP solver, not by pruning harder. The three features the core has that a plain MIP lacks were then modelled and validated against the core (all in `mip-spike.mjs`, env flags `SOFT`, `KBEST`/`TOL`, `CORE_CHECK`): **soft floors with partial credit** — the core pays the full bonus at the floor and `floorPartial × bonus × t/f` below it, a jump, so one binary "met" indicator per soft floor plus a continuous partial-credit variable (`t ≥ f·y`, `s ≤ k·t`, `s ≤ partial·bonus·(1 − y)`, objective `bonus·y + s`); Dorran with SSI and stamina soft and Kestrel with LRC and FC soft both match the core's proven optimum to the decimal. **Near-ties / alternatives** — k-best by re-solving with a no-good cut per found suit; the cut must be the proper form Σ_picked x − Σ_unpicked x ≤ |picked| − 1 (the naive Σ_picked x ≤ |picked| − 1 also forbids supersets, i.e. exactly the tie that adds a zero-value piece in an empty optional slot, which is how the first attempt missed the core's tie); with that, the MIP's five alternatives for Rowan on the real inventory equal the core's list score for score (the tie at 70,003,147.5, then four at 70,003,009.5); each alternative costs one more solve (~2.4 s at 30,000 items). **Worker thread** — the WASM loads and solves inside `worker_threads`, where the app runs its optimizer. Progress is the one feature not exercised: HiGHS exposes incumbent and gap through a callback, which gives the "best found, within X% of the bound" story for free. Levers 1–4 above are superseded for the search itself; lever 1 (server-side pools) still stands for the payload, and the heuristic remains useful only as a warm start (HiGHS accepts a MIP start).
