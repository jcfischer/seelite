# Sustained mining income across several fields

Refs #1216 and #923. No balance is approved. These are model predictions, not flown or production results. Runtime balance and every v3 candidate value are unchanged.

## Reproduce

```sh
bun scripts/measure-mining-economy.ts --compare docs/candidates/mining-economy-v3-sustained.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-sustained-return-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-sustained-reach-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-sustained-recovery-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-sustained-find-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-sustained-wide-corpus-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-sustained-wide-reach-grid.json
```

All figures come from clean `081a754f9050d7cdd1354384c5534c35510c9bde`: Longwall 3/A, seeds 1/47/1234, galaxies 0/1, 24 refinery systems, 24 charted and 5 rare starting fields, 58 samples. The report's `routeSummaries` and `routeComparison` carry the tables below. The percentiles were recounted from the raw rows and agree.

Rows are unchanged for candidates that do not name a route. SHA-256 prefixes of the `rows` array, before and after this change: v1 `fd61e348b0542bd8`, v2 `4baacf6feb98a104`, v3 `344d19a88ed12977` (v3 measured on both `dd331e73` and `081a754f9050d7cdd1354384c5534c35510c9bde`).

## What changed in the instrument

The optional candidate fields are `routeFields`, `routeRevisitLoadT`, `routeChartedFindS` and `routeReferenceHours`. A route row carries `route`, with its fields, every visit, and the separated time. `docs/candidates/mining-economy-v3-sustained.json` changes only the identity, the 24-hour clock, the fit list and these fields; a test holds that against v3.

Each rock's depletion and survey are kept per field for the whole clock. A pilot who returns reads the same whole-tonne recovery law from the same debit, so a return finds what recovery restored and no more.

## Route assumptions

Each of these is an assumption of the model, not a game rule and not a ruling.

| Assumption | Value |
| --- | --- |
| Fields in reach | The 6 nearest of the starting field's profile, by shortest refuelled jump path |
| Order | Always the nearest field left, from the start; not an optimal route |
| Jump | Through market systems within one 6 ly tank; every hop pays fuel, the jump, the cruise and a dock |
| Finding a charted field | 0 s, because it is public and the cruise is charged separately |
| Finding a rare field | The candidate's 600 s, on first arrival only |
| Selling | At the refinery in the field's own system, settling every job before moving on |
| Moving on | Stay while the field holds 100 t of known good ore; then the next unvisited field; then the next field restored to 100 t; otherwise wait passively |
| Returning | A live survey lets the pilot skip empty and below-grade rocks without flying to them |

The 100 t threshold is the assumption that moves the headline most, so the return-load table below varies it. "Exhausted" means that the pilot has reached every route field and worked the one it is on below 100 t of known good ore. Fields left earlier may have restored more by then, and that restored ore is what the "After" column mines. Only the largest quarter of rocks counts; the other three quarters are outside the ruled pilot.

## Results

Income per active minute against matched good trade, 24-hour clock (trade median 316 Cr/min, 266–385; the 8-hour median is 336):

| Scenario | N | One pass p10 / p50 / p90 | Sustained p10 / p50 / p90 | Until exhausted, p50 | After, p50 | Elapsed against trade, p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Charted, raw | 24 | 0.55 / 0.72 / 1.20 | 0.28 / 0.44 / 0.61 | 0.74 | 0.14 | 0.26 |
| Charted, refined | 24 | 0.73 / 1.09 / 1.89 | 0.47 / 0.75 / 1.08 | 1.10 | 0.26 | 0.42 |
| Rare, raw | 5 | 1.93 / 2.75 / 3.06 | 1.08 / 1.48 / 1.59 | 3.29 | 0.42 | 0.83 |
| Rare, refined | 5 | 2.86 / 3.59 / 3.67 | 1.74 / 2.66 / 2.96 | 5.36 | 0.71 | 1.46 |

The one-pass column is the candidate's own 8-hour one pass, which reproduces #1213's figures. Charted refined moves from 1.09× to 0.75× trade, and rare refined from 3.59× to 2.66×.

Medians per sample, in minutes, with passive time outside the active rate:

| Scenario | Active | Moving between fields | Finding | Refinery waiting | Recovery waiting | Exhausted after | Earned | Trade earned |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Charted, raw | 744 | 121 | 0 | 0 | 678 | 4.9 h | 91,687 Cr | 406,465 Cr |
| Charted, refined | 726 | 103 | 0 | 173 | 501 | 7.0 h | 137,462 Cr | 406,465 Cr |
| Rare, raw | 718 | 208 | 60 | 0 | 723 | 4.7 h | 329,863 Cr | 429,416 Cr |
| Rare, refined | 700 | 183 | 60 | 189 | 553 | 6.9 h | 532,642 Cr | 429,416 Cr |

The clock reaches that point in 56 of 58 samples. The other two are charted refined rows in the world whose clock is 7.1 hours, described under Limits. A route holds about 12,000 t of good ore on charted fields and 14,000 t on rare ones.

## What explains the difference

- **Recovery, not travel.** Until the reach is exhausted, charted refined is 1.10×, the same as one pass. The fall to 0.75× comes from return passes, which take 393 of the median 726 active minutes. A return yields 111 t for 15.7 active minutes and about 1,200 Cr, or 0.26× trade. The cause is the recovery rate: 1 t/h on about 29 good rocks per field.
- **Travel is cheap.** Moving and finding take about 6% of charted and 31% of rare active time up to exhaustion (at the 1,000 t return load, where almost no return flights count). A pilot who always has a fresh field keeps the one-pass rate: with 24 fields, which no charted refined sample exhausts inside the clock, charted refined is 1.14×.
- **Rare rises before it falls.** Rare refined is 5.36× until exhausted against 3.59× for one pass, because rare field value has a long tail. Across all 30 first visits the per-field ratio is 1.79 / 3.92 / 9.54 with a mean of 4.82, and a pooled rate is a time-weighted mean. #1213's five fields reach only 4.17×, so they sampled none of the top of that tail. The lower trade median also lifts every 24-hour ratio by about 6%.
- **The active rate can be raised by not flying.** A return load of 1,000 t lifts the whole-clock charted refined rate to 1.11×, but the elapsed rate falls from 0.42× to 0.34×. Total earnings are bounded by the reserve, not by the rate.

### Return load

| Return at | Charted refined | Elapsed | Rare refined | Elapsed |
| ---: | ---: | ---: | ---: | ---: |
| 100 t | 0.75 | 0.42 | 2.66 | 1.46 |
| 250 t | 0.95 | 0.40 | 3.85 | 1.46 |
| 500 t | 1.05 | 0.39 | 4.62 | 1.37 |
| 1,000 t | 1.11 | 0.34 | 4.79 | 1.12 |

A 1,000 t pilot leaves up to 999 t behind on each field, so its reach is not exhausted in the sense used above.

### Fields in reach

| Fields | Charted refined | Until exhausted | Elapsed | Rare refined | Until exhausted | Elapsed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.77 | 1.22 | 0.07 | 2.60 | 3.86 | 0.18 |
| 3 | 0.58 | 0.96 | 0.19 | 1.92 | 3.36 | 0.51 |
| 6 | 0.75 | 1.10 | 0.42 | 2.66 | 5.36 | 1.46 |
| 12 | 0.89 | 1.14 | 0.70 | 3.12 | 4.53 | 2.50 |
| 24 | 1.14 | 1.14 | 0.95 | 3.81 | 3.96 | 2.99 |

The rare column is noisy at N=5. Its "until exhausted" rate reads between about 3.4× and 5.4×, and 3.96× is the widest pool.

### Recovery

| t/h per rock | Charted refined | Elapsed | Rare refined | Elapsed |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1.11 | 0.35 | 5.37 | 1.29 |
| 1 | 0.75 | 0.42 | 2.66 | 1.46 |
| 5 | 0.89 | 0.64 | 2.74 | 2.04 |
| 10 | 1.13 | 0.77 | 3.77 | 2.53 |
| 25 | 0.74 | 0.49 | 2.30 | 1.65 |

The 25 t/h row is not comparable. A field then never falls below 100 t, so the pilot never leaves its first field (0 of 24 charted refined samples exhaust). It stays on one refinery's market, whose mark stays saturated, and waits on its queue.

### Finding time

Rare refined, whole clock and until exhausted: 2.66 and 5.36 at 600 s, 2.35 and 3.50 at 1,800 s, 1.95 and 2.53 at 3,600 s. A charted finding time of 300 s moves charted refined from 0.75 to 0.67, and its rate until exhausted from 1.10 to 0.90.

### A wider corpus

The first four refinery systems per world are a favourable sample. Taking the first 24 per world (144 charted and 21 rare fields):

| Scenario | One pass p10 / p50 / p90 | Sustained p10 / p50 / p90 | Until exhausted, p50 | After, p50 |
| --- | ---: | ---: | ---: | ---: |
| Charted, raw | 0.32 / 0.63 / 1.17 | 0.29 / 0.41 / 0.59 | 0.71 | 0.13 |
| Charted, refined | 0.42 / 0.84 / 1.72 | 0.47 / 0.65 / 0.92 | 1.02 | 0.24 |
| Rare, raw | 1.04 / 2.60 / 3.68 | 0.98 / 1.49 / 2.39 | 3.19 | 0.33 |
| Rare, refined | 1.32 / 3.45 / 4.17 | 1.75 / 2.83 / 3.96 | 5.32 | 0.62 |

The charted refined one-pass median there is 0.84×, below the 0.8–1.2 band's middle and below #1213's 1.09×. Its sustained shape is the same.

## Limits

- **A refinery's market lists what it sells.** This limit from #1213 is closed. A market lists every legal good, `marketRow` throws on an unlisted one, and all five products are legal. A test checks each product at every refinery in one galaxy.
- **One world's clock is short.** The greedy trader stalls at 7.1 hours in seed 1, galaxy 1, and the mining arm keeps the trader's clock. That covers 4 of the 24 charted samples and none of the 5 rare ones, and it applies to #1213's "8-hour" figures too. Without those rows charted refined is 0.73× whole-clock and 1.31× until exhausted.
- A sale of any tonnage still uses one quote; only later sales see the mark. Sale depth is otherwise unlimited.
- Rare results rest on N=5 in the main corpus and N=21 in the wide one. Routes from nearby starts overlap: the 144 charted route slots cover 128 distinct fields. The 30 rare slots are all distinct.
- The nearest-first route, the 100 t return and the survey skip are assumptions. The pilot does not choose rich fields, and does not stop returning when a return pays less than trade.
- The largest-rock pilot and loaded handling remain assumptions, not flown evidence. Results use the study layout at `spikes/field-shape-1043/organic.ts`, not production fields (#1209).
- Waiting is passive and not charged to the active rate, so the elapsed ratio is reported beside it. The 0.8–1.2 band remains the instrument's reading of D12.
- Courier surface mining is left for #1214.

## For #923

These are findings, not proposals to change a value.

- **F1.** Charted refined holds about 1.0–1.1× only while fresh fields last, about 7 hours for six fields. After that it is about 0.25× at 1 t/h recovery. The recovery rate is the figure this measurement most directly questions.
- **F2.** #1213's charted refined 1.09× comes from a favourable sample. The wider one-pass median is 0.84×.
- **F3.** The accepted rare refined figure now has its comparison: 2.66× over the whole clock (2.83× in the wide corpus), and about 5.3× until exhausted. Per-field first visits reach 9.54× at p90. Rare fields also out-earn trade over elapsed time, 1.46×, where charted fields do not, and that result depends on the 600 s search.
