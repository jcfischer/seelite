# Mining economy instrument preparation — node #922

Historical checkpoint at a19b4e36, before the principal authorized candidate design.
Current instrument and reproduction: [Mining and refining candidate comparison](node-922-mining-economy.md).

This was an incomplete, offline instrument checkpoint. It changes no production
source, balance, save format or mining flag behavior. It does not compare full
mining routes with trading and cannot justify balance ratification in #923.

## Available contracts and the missing input

The approved #917 resolution supplies all fifteen recipes, native units,
whole-tonne ore, retained product fractions and permission to buy raw ore.
It explicitly leaves prices, fees, processing rates and stock distributions to
calibration. The #920 resolution supplies provisional extraction/survey figures
now exported by production modules. The #935 contract and #940 primitives supply
bounded exact money/mass operations. The closed #937 supplies operational-time
semantics and a decision model; production world integration remains #1194.

The #921 prototype record at d75e301eee666981c5aa7ca268280572a0bd11a0 was recovered
through GitHub's contents API. It labels 100 Cr/t input cost, 10 Cr/t fee and 60
operational seconds/t as demonstration fixtures. Those are not a generated
raw-ore market or an approved candidate stock distribution. No corresponding
price/stock candidate contract was found among the named blockers. The brief's
Assumptions require stopping rather than silently choosing missing policy.

The implementation therefore exposes explicit-input financial arithmetic and a
readiness inventory. It chooses no raw price or stock law. At that revision, the default CLI
reported `status: incomplete` with missing inputs and remaining comparisons.

## What is implemented

`analyzeBatch` compares a supplied raw-sale bid with one refined collection. It
requires every price, quantity and free-hold input, reads the ratified recipe,
uses shipped `quoteMass`, money/mass bounds and `transferCost`, and returns exact
cash differences, collected mass, retained custody and basis. Unsold output is
never counted as cash. Tonne products consume free hold; kg/g products preserve
the existing no-slot rule. Fractions cannot round up into collectable units.
These are cash and physical basis results, not commodity-pool trading credit.

`productBidAt` generates the requested system and station, enforces the shipped
market/commodity venue rules, and reads the product quote through `marketRow`,
`stockResponse` and `marketQuote` at the supplied game clock and current deficit.
It does not simulate a trade history or predict remote discovered knowledge.
Unavailable outposts refuse; the helper supplies no new market scope.

`advanceCandidateQueue` consumes service seconds from #937's decision-model
query, oldest work first, with at most eight supplied jobs. Idle service is
discarded; later submission starts at its own supplied cursor. This is not
production recovery enumeration, saved queue integration or world-state proof.

## Commands and evidence

```sh
bun scripts/measure-mining-economy.ts --inventory
bun test tests/mining-economy.test.ts tests/exact-amount.test.ts
```

Create and run the explicitly labelled regression fixture:

```sh
cat > /tmp/explicit-batch.json <<'JSON'
{
  "kind": "fixture",
  "provenance": "node 922 regression numbers only; no candidate approval",
  "batch": {
    "family": "platinum", "grade": "poor", "inputT": 4,
    "purchaseCrPerT": 10, "rawBidCrPerT": 15, "feeCrPerT": 2,
    "productBidCrPerNativeUnit": 100, "freeHoldT": 0, "collectUnits": 1
  }
}
JSON
bun scripts/measure-mining-economy.ts --batch /tmp/explicit-batch.json
```

A batch JSON object requires `kind` (`fixture` or `candidate`), explicit
`provenance` text, and a `batch` object containing family, grade, inputT,
purchaseCrPerT, rawBidCrPerT, feeCrPerT, productBidCrPerNativeUnit, freeHoldT and
collectUnits. An optional `productMarket` supplies seed, galaxy, system,
stationId, gameTimeS, holdT and deficit instead of a supplied product bid; giving
both refuses. All cash output uses the canonical #940 signed-money encoding,
without display rounding. Every report remains explicitly incomplete.
Market-derived reports preserve the full productMarket input alongside the
resolved bid. Tests compare nonzero game-clock bids against the actual console
projection and exercise both the generated-price CLI path and ambiguous inputs.

The CLI regression uses test numbers only: four tonnes poor platinum ore,
10 Cr/t purchase, 15 Cr/t raw bid, 2 Cr/t fee and 100 Cr/kg product bid. Raw
cash difference is 20 Cr; refined collection of one kg gives 52 Cr. This proves
input plumbing and units, not any proposed economic table.

The first test run failed because the instrument module did not exist. The
headless suite pins all fifteen absolute yields from #917; mass conservation;
partial custody and basis; split committed costs; disabled-time exclusion; FIFO
partition equivalence; idle-time disposal; malformed/overflow refusal; real
venue gating and deficit sensitivity; and CLI provenance/output behavior.
Logs: /tmp/mining922-{red,headless,tsc,format,lint,comments,wiring,build}.log.
Readiness JSON: /tmp/mining922-inventory.json. Sage and final git-based browser
selection evidence are recorded on the draft PR.
These logs are machine-local evidence pointers; the source, tests and full
fixture above make the checks portable without relying on those files.

## Still owed

Supply a reproducible raw-ore price/stock candidate contract and a compatible
loadout/scenario corpus. Complete equal-clock shipped-trader comparisons,
travel/search/positioning, energy/heat duty cycles, fragments and collection,
recovery/survey-lifetime sensitivity, exhaustion/re-mining, buy/refine/sell and
market-memory cycles, parallel refineries, partial jobs and progression pools,
active/elapsed time, investment/payback and measured distributions. Use real
runtime arithmetic wherever it exists and approved candidate contracts otherwise.
Neither this checkpoint nor its fixture examples satisfy those acceptance
criteria. Node #922 remains open; no balance or release approval is implied.
