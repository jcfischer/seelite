# Mining candidate v3: the ruled pilot and refinery throughput

Refs #1213 and #923. No balance is approved. These are model predictions, not flown or production results. Runtime balance is unchanged.

## Reproduce

```sh
bun scripts/measure-mining-economy.ts --compare docs/candidates/mining-economy-v3.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-throughput-grid.json
```

All three reports come from clean `3de152b6083a34fdba633e067c7283350df3ca12`: seeds 1/47/1234, galaxies 0/1, 24 refinery systems, 5 rare fields, 1,341 samples and 63 refused parallel scenarios.

The flat-fee figures quoted below come from an earlier exploratory grid that ran before the branch was rebased, so its commit is no longer on this branch. It is not reproducible from the committed grid files, and it serves only as the comparison for the fee shape.

## What changed in the instrument

The optional candidate fields are `returnLoadT`, `visitLargestShare`, `fieldLayout`, `onePass`, `rawElasticityScale`, `collectS` and `feeShareOfProduct`. `--grid` adds a full-factorial sweep. Candidates v1 and v2 produce byte-identical rows before and after the change (SHA-256 prefixes `fd61e348b0542bd8` and `4baacf6feb98a104`).

A one-pass pilot visits the chosen rocks once, sells or submits at the return load, then stays docked for refinery settlement. Waiting is passive. Each collect-and-sell cycle costs `collectS` active seconds, and the 40 t general hold limits a cycle rather than the route.

A proportional fee is charged on submission, at the share of the product's current market bid. When the fee exceeds the pilot's cash, the pilot submits what cash affords and keeps the rest for later. A two-refinery pilot keeps the fuel for a round trip out of the fee budget.

## Candidate

| Input | Value | Status |
| --- | ---: | --- |
| Rocks visited | largest 25% | principal ruling |
| Field layout | #1043 organic | principal ruling; production owed by #1209 |
| Return load | 1,000 t or end of pass | principal ruling |
| Skips | 3,000 t | principal ruling |
| Fee shape | proportional to product value | principal ruling |
| Fee share | 0.35 | proposed |
| Drill | 37.5 t/s | provisional |
| Raw value share | 0.35 | proposed |
| Ore elasticity scale | 0.5 | proposed |
| Refinery throughput | 1 s/t | proposed |
| Collection cycle | 5 s | proposed |
| Recovery; survey lifetime | 1 t/h; 24 h | unchanged |

## Results

Active return against matched good trade (median 336 Cr/min, 290–395), Longwall 3/A, 8-hour clock:

| Scenario | N | p10 / p50 / p90 | In 0.8–1.2 | Earned, median |
| --- | ---: | ---: | ---: | ---: |
| Charted, raw | 24 | 0.55 / 0.72 / 1.20 | 7 | 11,116 Cr |
| Charted, refined | 24 | 0.73 / 1.09 / 1.89 | 8 | 18,480 Cr |
| Charted, two refineries | 20 | 0.41 / 0.91 / 1.67 | 6 | 18,825 Cr |
| Rare, raw | 5 | 1.93 / 2.75 / 3.06 | 0 | 36,587 Cr |
| Rare, refined | 5 | 2.86 / 3.59 / 3.67 | 0 | 52,233 Cr |
| Courier 1/E, charted, raw | 24 | 0.01 / 0.02 / 0.02 | 0 | 3,691 Cr |

Refining beats raw sale on all 24 charted fields (median cash ×1.53, range ×1.05–×2.01) and all 5 rare fields (median ×1.48). No Longwall job is pending at the horizon. 16 of the 24 charted refined samples still carry a target failure, which is the 0.8–1.2 band.

## Fee shape

At raw share 0.35, 1 s/t and elasticity 0.5, charted refined and buy-and-refine on the Longwall:

| Fee | Refined p10 / p50 / p90 | Rare refined p50 | Buy-and-refine profitable, maximum |
| --- | ---: | ---: | ---: |
| Flat 5 Cr/t, before the lot fix | 0.58 / 1.14 / 2.23 | 5.96 | 264 of 360, 0.62× trade |
| Share 0.30 | 0.81 / 1.26 / 2.05 | 3.90 | 360 of 360, 0.18× trade |
| Share 0.35 | 0.73 / 1.09 / 1.89 | 3.59 | 358 of 360, 0.11× trade |
| Share 0.40 | 0.66 / 0.93 / 1.66 | 3.24 | 339 of 360, 0.06× trade |

Compared with the flat fee, the proportional fee lifts the weakest fields, narrows the spread and shrinks the buy-and-refine margin. Nearly every buy-and-refine cycle remains slightly profitable; the principal accepted such cycles on #923 at up to 0.62× trade.

## Consequences

- Throughput stops limiting charted returns at about 3 s/t under the candidate fee: the refined median is 1.11 at 3 s/t, 1.09 at 1 s/t, 1.09 at 0.3 s/t and 1.08 at 0.1 s/t. At 30 s/t it is −0.18, with eight jobs pending and their fees paid. Rare refined is 2.91 at 3 s/t and 3.59 at 1 s/t.
- Elasticity moved the charted raw median only from 0.73 at scale 0 to 0.71 at scale 1 in the flat-fee grid. That is weak evidence, because each sale uses one quote and a one-pass pilot makes few later sales. Stated as a ruling to honour, not a measured need.
- Raw share does not change a refined run that mines its own ore; it sets the raw return and the buy-and-refine margin.
- The fee takes a large sum up front on valuable ore. Pilots with little cash stage a lot through several submissions.

## Limits

- One pass over one field. Sustained income across several fields is not measured, so these figures do not establish a long-run rate.
- A sale of any tonnage uses one quote; only later sales see the mark.
- The model does not check that a refinery's market lists the product it sells.
- The largest-rock pilot and the loaded handling are assumptions, not flown evidence.
- Organic results use the study layout at `spikes/field-shape-1043/organic.ts`, not production fields.
- The 0.8–1.2 band remains the instrument's reading of D12. Passive refinery waiting is not charged to the active rate.
- Courier surface mining is left for #1214.
