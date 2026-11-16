# Mining and refining candidate comparison

Refs #922. No numeric balance is approved. This is an offline prediction instrument,
not production mining integration or a measurement of human flying efficiency.
It supersedes the incomplete preparation receipt as the instrument's current entry point.

## Reproduce

```sh
bun scripts/measure-mining-economy.ts --compare docs/candidates/mining-economy-v1.json > /tmp/mining-comparison.json
bun scripts/measure-mining-economy.ts --sweep docs/candidates/mining-economy-sensitivity.json > /tmp/mining-sensitivity.json
bun test tests/mining-comparison.test.ts tests/mining-economy.test.ts tests/exact-amount.test.ts tests/greedy-trader-observer.test.ts
```

Reports identify the instrument Git revision, whether its source is modified,
the complete candidate input, provenance, every sample, refusals, distribution
sample sizes and explicit target/arbitrage failures. `--candidate` prints the
initial proposal. `--batch` retains the exact single-batch diagnostic. Every
cash amount has canonical bounded-money encoding; presentation rates project to
millionths of a credit before division and never own settlement.

## Model contract

The fifteen recipes remain fixed. The proposed raw mid is generated product
mid times recipe native units per tonne times `rawValueShare`; raw stock is a
seeded per-ore, per-station epoch integer in the declared range. Shipped market
spread, shelf projection, stock memory and decay supply the remaining quotes.
All fifteen family/grade buy/refine/sell cycles are exercised for the first
fitted loadout, with their identities printed. This is a candidate market law,
not an approved or shipped ore catalogue.

Loadouts are parsed against real slots and read catalogue capacities, prices,
energy and heat. Mining lasers keep catalogue output. The drill rate alone is
an explicit provisional input; its energy and heat use the shipped drill. A
quarter-second duty simulation uses `stepCondition`, including idle-only bank
regeneration and heat hysteresis. Surface cuts use shipped `stepCut`, ore share
and whole fragments. Fragment collection seconds and retention share are
explicit scenario assumptions; they do not claim a simulated flight or observed
success rate. Drill contact is assumed ideal after charged deployment,
positioning and survey time. Positioning includes actual sequential rock-anchor
displacement, hull performance and the candidate handling floor.

"Good" mining means deep ore meeting the declared minimum grade, with every
prior sequential survey and handling cost paid. It does not mean picking the
richest generated rock without searching. Rare-field results are conditional on
presence and a successful search charged at the candidate cost. Discovery is
checked through the shipped discovery API. Their success probability and human
search time have not been measured.

The trading baseline is the existing greedy basket engine, including precious
native-unit goods, stock deficits, generated prices at departure/arrival, fuel,
and a developed start. Its optional fitted tank now enforces the actual fit's
jump reach; historical defaults are regression checked. Both arms start with
the same cash, geometric cruise estimator and docking assumption. Mining uses
each trader's realised clock, including its terminal-hop overshoot. Trading
market waits and refinery waits are passive time; active and elapsed returns
are separate. Finite-charge path planning, traffic and combat are not modeled.

Refinery rules follow the preserved approved prototype at commit
`d75e301eee666981c5aa7ca268280572a0bd11a0`,
`docs/prototypes/refinery-921-codex.md`: eight outstanding slots include finished
whole output; fractional-only remnants free slots and pool by refinery/product;
submissions refuse during service outage; completed output can be collected.
The full-trip model implements independent FIFO service at actual generated
refineries, same-location collection, capacity-limited partial collection,
retained mass/basis, explicit fee payment and ordinary cash sales. A parallel
scenario alternates two reachable refineries and pays travel and fuel both
ways. An unreachable second refinery is an explicit refused scenario with no
return assigned. No optimal route or queue scheduler is claimed.

Undamaged-world calendars compose production `projectCapabilityTime` with the
generated baseline raider pressure. Every transition's cumulative duration is
checked against production `operationalDuration`; disagreement refuses the run.
There are no player-raider mutations in these scenarios. Queue wait and total
turnaround are reported separately. Pending output and fractional custody never
become proceeds. Physical basis is conserved separately from product-pool debt
and banked trade; cash arrives on sale, costs enter each pool once and collection
does not grant credit. Tied basis is integrated over the full elapsed clock.

Recovery uses the shipped whole-tonne floor law, with an explicit candidate-rate
adapter checked against the default `debitAt`. Survey lifetime is passed to the
shipped reading predicate. Sensitivity retains each full report and changes one
input at a time, except the named one-rock-loop stress case, which jointly
changes accessible-rock selection, recovery and expiry. No target ceiling clamps
returns. A profitable buy/refine cycle is a visible finding for principal review,
not an automatic assertion that ordinary paid processing must lose money.

## Measured findings and verification

Final measurement and review evidence is appended after the reviewed instrument
revision is established. The initial candidate is not a recommendation: its
failures must remain visible when the principal judges the exact table on #923.

### Candidate v1 at instrument revision cc27e3d9

The clean instrument at `cc27e3d9d3b5eed6c1608e19d58e74f1add8227b`
produced 1,341 full-route samples on seeds 1/47/1234, galaxies 0/1,
24 refinery systems and twelve compatible fits. Five systems had rare fields.
Another 63 two-refinery scenarios were refused because no second refinery was
reachable with the fitted tank. Those are absent from return distributions.

| Scenario | N | Active Cr/min, median | Range | Median active return / matched good trade |
| --- | ---: | ---: | ---: | ---: |
| Courier 1/E, charted, raw | 24 | 9.54 | 5.50–19.31 | 0.022 |
| Courier 1/E, charted, refine | 24 | 8.28 | 1.96–26.63 | 0.019 |
| Miner 3/A, charted, raw | 24 | 18.90 | 8.97–68.96 | 0.049 |
| Miner 3/A, charted, refine | 24 | 5.87 | -0.42–96.62 | 0.015 |
| Miner 3/A, rare, raw | 5 | 56.52 | 16.13–205.19 | 0.163 |
| Miner 3/A, rare, refine | 5 | 30.37 | -1.32–217.13 | 0.088 |

The initial proposal **fails the mining target** under this sequential-survey
policy. Its charted miner samples are all outside the instrument's explicit
0.8–1.2 trade band. Refining does not reliably improve cash within one hour;
that statement prices actual sold output, fees and pending custody rather than
valuing custody as cash. The 360 fifteen-recipe purchase/refine scenarios expose
75 profitable cash cycles. They are printed with exact identity and settlement,
not hidden by a target clamp. There were 147 capacity-limited partial collection
events; the outstanding-job count reached eight and never exceeded it.

The sensitivity corpus uses seeds 1/47/1234, galaxy 0, the first two refinery
systems per world and Courier 1/E / Miner 3/A: six systems, one rare field,
132 samples per variant. Twelve variants retain their full input and output.
The base scenario never returns to a previous rock within its one-hour window,
so low recovery and ordinary lifetime changes have no effect there. The
one-rock-loop stress does exercise the omitted boundary: 998 expired readings
are re-surveyed and 152 visits re-mine a recovering rock. No swept mining sample
beats its matched good-trade active return; raising recovery does not magically
meet the target. Fast processing exposes more profitable purchase/refine cycles;
slow processing ties up capital and leaves more pending output. These are
model consequences, not approvals or observed human behavior.

Machine-local full reports: `/tmp/mining922-reviewed-comparison.json` and
`/tmp/mining922-reviewed-sensitivity.json`. The two committed candidate files and
commands above reproduce them; their embedded revision and dirty-state marker
are part of the evidence. The reports intentionally stay outside Git.

### Capacity question raised during measurement

The current base miner hold is **40 t** (`src/hull.ts`); the principal asked
whether the hull's scale warrants much more. Re-running
`node spikes/longwall-miner/measure-capacity.mjs` measured three closed skip
shells at 1,047.22 m³ each, 3,141.66 m³ total. The study's stated 60–70% usable
volume and assumed 1.5–2 t/m³ broken-ore density imply 2,827–4,398 t. This is a
volume estimate, not structural or propulsion certification. A proposed 3,000 t
study is physically motivated, but no new capacity, mass, thrust, price or module
parameter was approved in that exchange. The comparison above uses current
production capacities; it cannot settle the economics of that larger miner.

That hull-scale decision and a more selective definition of a good deposit
should precede any recommendation that the principal ratify a final balance
on #923. Candidate v1 is evidence of failure and a reusable instrument, not a
recommended final table.
