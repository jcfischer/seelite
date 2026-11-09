# The ratified mining and refining table

Refs #923. The principal ratified this table on 2026-11-09 (Q27) at instrument revision `67edda123571a8d0e4ecbab44046cb7dceed7ae2`. The figures below are model predictions, not flown or production results. The runtime is unchanged here: #1197 carries the values into the game.

## Reproduce

```sh
bun scripts/measure-mining-economy.ts --compare docs/candidates/mining-economy-v3-ratification.json
bun scripts/measure-mining-economy.ts --compare docs/candidates/mining-economy-v3-ratification-sustained.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-ratification-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-ratification-sustained-grid.json
bun scripts/measure-mining-economy.ts --grid docs/candidates/mining-economy-v3-ratification-funded-grid.json
```

Base corpus: seeds 1/47/1234, galaxies 0/1, 24 charted and 5 rare fields. Wide corpus: 24 refinery systems per world, 144 charted and 21 rare fields. Pilot: Longwall 3/A with 10,000 Cr unless stated.

## The table

| Input | Value |
| --- | --- |
| Recovery | 10 t/h per rock (the live constant is still 1, `src/deposit-state.ts`) |
| Survey lifetime | 24 h |
| Refinery fee | 35% of the product's market value, no per-tonne fee |
| Refinery throughput | 1 s/t |
| Raw ore value | 0.35 of the refined value, elasticity scale 0.5, stock 8–63 t |
| Drill | 37.5 t/s, energy 6/s, heat 2.5/s |
| Mining Laser | 0.1 t/s at grade E; ore share E 0.5, D 0.4, A 0.75; catalogue unchanged |
| Ore skips | 3,000 t |
| Field population | Charted p50 635 rocks, about 11,000 t; rare p50 313 rocks, about 7,750 t |

Recipes are those ratified on #917. Raw prices are median refinery mids before spread:

| Ore | Product | Yield, poor / standard / rich | Product price | Raw Cr/t, poor / standard / rich |
| --- | --- | ---: | ---: | ---: |
| Silicate | Minerals | 200 / 400 / 800 kg | 10.8 Cr/t | 0.8 / 1.5 / 3.0 |
| Metallic | Alloys | 200 / 400 / 800 kg | 40 Cr/t | 2.8 / 5.6 / 11.2 |
| Gold | Gold | 500 / 1,000 / 2,000 g | 37.6 Cr/kg | 6.6 / 13.2 / 26.3 |
| Platinum | Platinum | 250 / 500 / 1,000 g | 69.6 Cr/kg | 6.1 / 12.2 / 24.4 |
| Gem | Gem-Stones | 5 / 10 / 20 g | 18.4 Cr/g | 32.2 / 64.4 / 128.8 |

## Measured results

Ratio to good trade per active minute, p10 / p50 / p90. The principal reads D12 on the 24-hour wide column.

| Longwall 3/A | One pass, 8 h, wide | 24 h, six fields, base | 24 h, six fields, wide | Elapsed, wide p50 |
| --- | ---: | ---: | ---: | ---: |
| Charted raw | 0.36 / 0.68 / 1.22 | 0.57 / 0.64 / 0.78 | 0.50 / 0.63 / 0.76 | 0.66 |
| Charted refined | 0.53 / 0.92 / 1.76 | 0.93 / 1.14 / 1.56 | 0.87 / 1.12 / 1.41 | 0.76 |
| Rare raw | 1.35 / 2.75 / 4.30 | 1.55 / 1.85 / 1.95 | 1.55 / 1.83 / 2.59 | 1.93 |
| Rare refined | 1.49 / 3.10 / 4.28 | 2.89 / 3.84 / 3.85 | 2.73 / 3.25 / 4.12 | 2.46 |

Other readings, base corpus unless stated:

- **Earnings:** the 24-hour wide median earns 318,247 Cr charted refined, 271,062 Cr charted raw and 928,320 Cr rare refined, against 406,465 Cr and 429,416 Cr for trade.
- **Refining against raw, one pass, cash:** wins 24 of 24 charted (min ×1.06, p50 ×1.54, max ×1.79) and 4 of 5 rare (min ×0.67, p50 ×1.46, max ×1.80).
- **Payback, charted refined, active minutes:** 1/E 149 (1.08×, 51,450 Cr), 3/E 155 (1.08×, 53,275 Cr), 3/D 173 (1.03×, 59,875 Cr), 3/A 256 (1.16×, 99,225 Cr). Laser size has no effect on a Longwall, because the pilot uses the built-in drill.
- **Surface:** Courier 1/E, charted, 0.02× raw and 0.03× refined; rare 0.06× and 0.09×. #1214 ruled this a first taste.
- **Buying ore to refine:** on the Longwall, 358 of 360 cycles profit, at most 0.11× trade. The principal accepted up to 0.62×.
- **Two refineries:** charted p50 1.06× (N=20), rare 3.10× (N=3). 63 scenarios were refused for lack of a reachable second refinery.
- **Queue:** no Longwall job is pending at the end of a pass. Refinery waiting over 24 hours is about 524 minutes in the wide corpus.
- **Recovery sweep, charted refined, 24 h, wide:** 1 t/h 0.66×, 5 t/h 0.92×, 10 t/h 1.12×. Rare refined 2.14×, 2.61×, 3.25×.
- **Starting cash, 24 h:** 100,000 Cr still reads 1.14× and 3.84× at the median. The cash limit bites early: on one-pass figures at 1 t/h, the rare field where refining lost moves from ×0.67 to ×0.98 with more cash.

## Rulings at ratification

- D12 is read on the 24-hour wide-corpus active rate: 1.12× charted refined and 3.25× rare refined.
- The module catalogue stays as it is (Q28), although on a Longwall grade D earns less than E and A costs about 46,000 Cr more for about 8% more income.

## Accepted limits

- **Scarcity.** At about 29 good rocks per field, a study-layout count from #1216, a field gives back roughly 290 t/h. Fields still run dry in 121 of 144 charted refined runs, but they no longer limit income; the refinery queue does.
- **Not flown.** The largest-rock pilot, nearest-first route, 100 t return threshold and loaded handling are assumptions.
- **Market depth.** One quote covers a sale of any tonnage.
- **Rare sample.** The wide corpus has 21 rare fields, and the base corpus 5.
- **Passive waiting** is not charged to the active rate; the elapsed column shows it.
- **Exhaustion split.** Refined income after exhaustion (1.26×) reads above before it (1.00×) at least partly because fees are paid before the product sells. Use the whole-clock figure.
- **A known stall.** The trader's clock stalls at 7.1 hours in seed 1, galaxy 1.
- **Not diagnosed.** The small gap left on the one rare field, and the mechanism behind grade D's extra positioning time.
