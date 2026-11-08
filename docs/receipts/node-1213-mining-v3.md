# Mining candidate v3: the ruled pilot and refinery throughput

Refs #1213 and #923. No balance is approved. These are model predictions, not flown or production results. Runtime balance is unchanged.

## Reproduce

```sh
bun scripts/measure-mining-economy.ts --compare docs/candidates/mining-economy-v3.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-grid.json
```

Candidate figures come from the clean revision `a93e44c29e6e195c9250673f2d2da7a0b9d75cb6`: seeds 1/47/1234, galaxies 0/1, 24 refinery systems, 5 rare fields, 1,341 samples and 63 refused parallel scenarios. The 96-variant grid ran at clean `c3c8087e7df21f0a02e85bbb78f48bd06974cd53`; the instrument source is the same at both. A fee sweep used the same revision with a scratch grid file: throughput 1 s/t, elasticity 0.5, raw share 0.30–0.45 and fee 5–15 Cr/t.

## What changed in the instrument

The optional candidate fields are `returnLoadT`, `visitLargestShare`, `fieldLayout`, `onePass`, `rawElasticityScale` and `collectS`. `--grid` adds a full-factorial sweep. Candidates v1 and v2 produce byte-identical rows before and after the change (SHA-256 prefixes `fd61e348b0542bd8` and `4baacf6feb98a104`).

A one-pass pilot visits the chosen rocks once, sells or submits at the return load, then stays docked for refinery settlement. Waiting is passive. Each collect-and-sell cycle costs `collectS` active seconds, and the 40 t general hold limits a cycle rather than the route.

## Candidate

| Input | Value | Status |
| --- | ---: | --- |
| Rocks visited | largest 25% | principal ruling |
| Field layout | #1043 organic | principal ruling; production owed by #1209 |
| Return load | 1,000 t or end of pass | principal ruling |
| Skips | 3,000 t | principal ruling |
| Drill | 37.5 t/s | provisional |
| Raw value share | 0.35 | proposed |
| Ore elasticity scale | 0.5 | proposed |
| Refinery throughput | 1 s/t | proposed |
| Refinery fee | 5 Cr/t | proposed |
| Collection cycle | 5 s | proposed |
| Recovery; survey lifetime | 1 t/h; 24 h | unchanged |

## Results

Active return against matched good trade (median 336 Cr/min, 290–395), Longwall 3/A, 8-hour clock:

| Scenario | N | p10 / p50 / p90 | In 0.8–1.2 | Earned, median |
| --- | ---: | ---: | ---: | ---: |
| Charted, raw | 24 | 0.55 / 0.72 / 1.20 | 7 | 11,116 Cr |
| Charted, refined | 24 | 0.58 / 1.14 / 2.23 | 6 | 18,748 Cr |
| Charted, two refineries | 20 | 0.28 / 1.01 / 1.87 | 6 | 21,062 Cr |
| Rare, raw | 5 | 1.93 / 2.75 / 3.06 | 0 | 36,587 Cr |
| Rare, refined | 5 | 4.96 / 5.96 / 6.06 | 0 | 92,043 Cr |
| Courier 1/E, charted, raw | 24 | 0.01 / 0.02 / 0.02 | 0 | 3,691 Cr |

Refining beats raw sale on 23 of 24 charted fields (median cash ×1.65, range ×0.77–×2.48) and on all 5 rare fields. No charted Longwall job is pending at the horizon.

## Consequences

- Throughput stops limiting returns at about 3 s/t: the refined median is 1.69 at 3 s/t, 1.67 at 1 s/t and 1.67 at 0.3 s/t with a 1 Cr/t fee. At 30 s/t it is 0.34, with eight jobs pending.
- Ore elasticity barely matters: at share 0.35, the charted raw median is 0.73 at scale 0 and 0.71 at scale 1.
- A flat fee has the wrong shape for cheap ore. The refined median falls from 1.14 at 5 Cr/t to 0.72 at 8, 0.44 at 10 and 0.01 at 15, because silicate's refined value is about 12.8 Cr/t at base price.
- Raw share does not change a refined run that mines its own ore; it sets the raw return and the buy-and-refine margin. Below about 0.25, the grid shows buy-and-refine beating matched trade at 1 s/t and 1 Cr/t on some samples (max 1.22× at share 0.15).
- At this candidate on the Longwall (fee sweep), 264 of 360 buy-and-refine cycles are profitable, with a maximum of 0.62× trade. They remain visible for the principal to judge.

## Limits

- One pass over one field. Sustained income across several fields is not measured, so these figures do not establish a long-run rate.
- A sale of any tonnage uses one quote; only later sales see the mark.
- The model does not check that a refinery's market lists the product it sells.
- The largest-rock pilot and the loaded handling are assumptions, not flown evidence.
- Organic results use the study layout at `spikes/field-shape-1043/organic.ts`, not production fields.
- The 0.8–1.2 band remains the instrument's reading of D12. Passive refinery waiting is not charged to the active rate.
