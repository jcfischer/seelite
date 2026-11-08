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
