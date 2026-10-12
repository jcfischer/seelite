# Refinery accounting — approved decision contract

Refs #935. Author: Codex. Base: `52e37a54`. Date: 2026-10-12.
Status: D1–D16 individually approved in conversation. The principal approved the
complete bounded state, validation and migration contract with “Q18: approve”
in reply to the final Q17 approval question. That final ruling is D17.
This is a decision instrument and contract, not production implementation.
The eventual graph resolution is the canonical decision record.

## Approved policy

- D1: Cash arrives on sale; trading credit may wait for cost recovery. Banked credit never falls.
- D2: One commander-wide pool per finished commodity, across galaxies, aboard goods, processing jobs and uncollected output. Collection changes no progression accounting.
- D3: Unrecovered costs persist after the pool empties and reduce later eligible earnings.
- D4: Raw ore joins its eventual product pool on acquisition. Purchase costs enter once; submission adds its fee once. Raw sales use the same pool.
- D5: Equivalence requires the same costs committed before the compared sales and the same sale quantities/prices/proceeds. Changing the timing of later spending is not equivalent. Job splitting and collection grouping cannot alter progression under that boundary.
- D6: Cargo loss does not erase unrecovered costs. Own-cargo recovery does not charge purchase cost again.
- D7: All commodity trading, including hull-change cargo auto-sales, uses this rule. Request pay and recovered-equipment sales retain their progression rules; thresholds stay unchanged.
- D8: Unknown-cost legacy cargo is ineligible. Its proceeds neither recover eligible costs nor earn credit. Refining/mixing cannot erase this status. Newly mined ore has a known zero acquisition cost.
- D9: Sales consume the pool's unknown-cost share first, regardless of collection location.
- D10: Preserve actual stored monetary values exactly. Physical cost transfers retain indivisible remainders with remaining material; the final transfer takes all remaining cost.
- D11: Migration initializes debt from remaining recorded basis, not reconstructed historical profits/losses. Cash and banked credit are unchanged.
- D12: Request handovers leave unrecovered costs intact. Request pay banks as before and does not also repay commodity debt.
- D13: Eligibility quantities use eventual product mass; one tonne rich Metallic ore is 0.8 tonnes Alloys-equivalent. This is separate from physical cargo/capacity.
- D14: Exact wallet settlement is a shared prerequisite. No float-wallet/exact-progression discrepancy is accepted.
- D15: Fees on unknown-cost ore still increase debt. Its ineligible sales cannot repay those fees; later eligible sales must.
- D16: Loss, jettison and request handover consume unknown shares first. Recoverable cargo records the removed shares; own recovery restores those shares without new debt. Refinery transfers retain ownership.

## State and transitions

There are 17 current commodity pools. Fifteen ore goods map into five existing
product pools; they add no pool identities. Future catalogue changes require an
explicit schema extension. A pool stores `totalMass`, `unknownMass` and
`unrecoveredCost`, with `0 <= unknownMass <= totalMass`. Eligibility is a
commander-wide accounting quantity, not a provenance tag on a particular refinery
job. Physical cargo/grades, jobs and per-refinery fractional custody remain distinct.

The exact wallet and banked trade amount are separate fields. Existing physical
basis records remain separate from pool debt: paid costs may remain attached to
unsold material even after some sales have recovered those costs. Never rebuild
debt from remaining physical basis after migration.

On a purchase, add owned product-equivalent mass and debit exact cash; add that
same cost to debt and physical basis once. Known-zero-cost acquisitions add mass
without debt. Refining preserves total/unknown mass, transfers physical basis,
and adds the actual fee to cash debit, debt and physical basis. Collection moves
physical material/basis only.

For a sale of product-equivalent mass `s`, consume `u = min(unknownMass, s)`;
eligible mass is `e = s-u`. All proceeds enter cash. Only the exact per-native-unit
quote times the eligible native quantity is recoverable proceeds `r`:

```
recovery = min(unrecoveredCost, r)
unrecoveredCost -= recovery
bankedTrade += r - recovery
totalMass -= s
unknownMass -= u
```

Fixed-price adjacent sales may be grouped without changing the result. Different
quote streams must stay distinct: market stock response can legitimately change
actual prices. No claim is made that clicking Sell All obtains the same quote as
repeated sells in a market whose prices move.

Non-sale removal subtracts total/unknown mass by the same unknown-first rule,
without changing debt, cash or banked credit. A recoverable entity carries its
removed total/unknown share and physical basis. Partial own recovery consumes
unknown share first from that entity's remaining record and returns it to the
owned pool. Consume the recovery record atomically; never treat own recovery as
fresh zero-cost salvage. Multi-good loss uses stable commodity identity order,
so object iteration order cannot choose which lost good carries unknown shares.
Recovery metadata belongs to the existing bounded entity lifecycle, not a new
unbounded history. Refinery transfer is not loss. Entrusted request cargo never
enters owned pools.

## Bounded arithmetic

The game has finite binary64 legacy quantities, including fractions smaller than
a gram. Exact preservation does not require an arbitrary rational denominator.

- Mass quantum: `2^-1074` grams. New recipes produce integer grams, so ordinary
  new material uses multiples of this scale. Native-unit collection and
  whole-tonne submission rules remain unchanged.
- Money quantum: `1/(2^2156 * 5^6)` Cr. This preserves every finite legacy Number
  exactly and exactly represents eligible sale shares at lifted binary64 prices.
- Money magnitude: at most `2^3200-1` money ticks per field. Mass magnitude:
  at most `2^2176-1` mass ticks per field. Nonnegative mass, basis, debt and banked
  credit; signed cash preserves parser-valid legacy negative balances.
- Every transaction preflights all resulting fields before any mutation. Overflow
  refuses the entire action with a named reason. It never clamps or wraps, changes
  material, spends cash, or creates a job. Checked bounded BigInt intermediates
  have fixed expression-size ceilings; no iterative growing denominator exists.
- Canonical wire form is an odd hexadecimal coefficient and bounded binary shift
  (`coefficient@shift`), with `0` alone for zero and a cash-only minus sign.
  Bound input string length, coefficient bits and shift before allocating/shifting;
  reject aliases, trailing tokens, unexpected signs and noncanonical encodings.
  Encoding maxima are 802 characters for nonnegative money, 803 for signed cash,
  and 546 for mass. Existing ordinary amounts encode much shorter.

The precision is a representation choice, not a gameplay tuning parameter. The
limits exceed all finite legacy Numbers, including their gram conversion and
the finite migrated catalogue sums; future accumulation can still reach a limit
and must refuse. Display rounding never changes affordability or settlement.
No unsupported Number projection may become the authoritative wallet.

Why the money quantum suffices: let `Q=2^1074` and `M=2^2156*5^6`. A legacy
per-unit price is an integer divided by Q; mapped eligible mass is also an integer
divided by Q. Dividing their product by grams per native unit requires only the
approved recipe/unit factors. `M/Q^2 = 4,000,000`, divisible by every such factor.
Thus exact eligible proceeds use one fixed denominator. Prices/fee rates are
finite binary64 per-native-unit quotes lifted once; exact quantity multiplication
and wallet settlement happen afterwards. Do not multiply in Number first or divide
a rounded cash delta by an arbitrary transaction quantity.

Physical basis allocation is a different operation: transferring `k` from source
quantity `q` with cost `c` transfers `floor(c*k/q)` money ticks, leaving the exact
remainder at source. Last transfer takes all. Each individual allocation differs
from its ideal proportional share by less than one money quantum. Repeated
allocations may distribute that dust differently, but preserve aggregate basis
exactly; progression never reads these allocations. There is no claim that
physical basis distribution is identical across collection orders.

## Migration and refusal policy

Version the envelope once; migrate live and launch/death checkpoints under the
durable transaction contract before adopting or announcing success. Preserve
cash, banked credit, valid cargo quantities and aggregate recorded cost exactly.
Initialize jobs/custody empty for old saves. Derive unknown mass from cargo lacking
basis, map known basis costs to the correct debt pool, and lift every stored Number
by its actual binary value. No inference of prior prices or prior recovered costs.
Fractional legacy cargo remains fractional; do not round to grams/native units.

Reject nonfinite values, negative cargo, unknown good identities, basis exceeding
held quantity, and malformed new encodings. A zero-quantity legacy basis row with
positive cost is retained as a cost-only legacy row and initializes debt; it is
not discarded or invented into material. Negative cash is preserved, not repaired.
An unsupported/malformed save is left byte-for-byte intact with a named refusal
and an export/recovery path; no silent partial migration. Negative cargo was
parser-accepted previously, so refusing it is an explicit validation tightening
requiring approval here.

## Evidence and limits

Run `bun docs/prototypes/refinery-accounting-935-codex.mjs`.

At the approved revision **761,709 assertions passed**: original 10/30-cost
counterexample, fixed-price split/group sales for every recipe/unit factor,
unknown boundary dust, persistent loss carry, fee on unknown stock, non-sale
removal/partial recovery, legacy numeric endpoints, cost conservation and
proportional error bound, canonical encoding refusals and atomic overflow refusal.
This is a decision model, not a test of production Holdings or IndexedDB.

Algebra supplies the general claim: with all compared costs already committed,
recoverable proceeds R reduce debt by `min(D,R)` and add `max(0,R-D)` credit.
Unknown-first consumption and exact equal-price valuation are additive under
partitioning. Collection never changes these quantities. The physical transfer
identity is `moved + retained = original`; it proves conservation, not equal
per-location allocations.

The candidate accounting payload at the structural ceiling (2,048 refinery rows,
16,384 jobs, 10,240 custody product entries, 17 commander pools) serializes to
**37,796,659 UTF-8 bytes** with maximally wide numeric fields. The same row count
with ordinary 100 Cr/one-tonne amounts measures **2,380,057 bytes**. This synthetic
shape includes placeholder job metadata; it excludes the rest of the world,
complete job timing, recovery metadata and multiple save checkpoints. It is a
conservative numeric-payload exercise, not a measured complete-save upper bound
or a claim that every simultaneously saturated field is reachable.

Production must measure the full versioned envelope: legacy migration, typical
play, actual-generator saturation and structural saturation, with maximum legal
identities/counters/numeric strings and bounded recovery records. Report UTF-8
bytes, serialization/parse/hash time and actual IndexedDB commit time separately,
including live and launch/death checkpoint storage. Test quota failure without
adoption. No browser or storage performance has been verified by this instrument.

## Shared prerequisites and delivery boundary

Before refinery production: implement bounded amount codec/validation, exact
wallet settlement across every money writer (commodity trade, fuel, equipment,
hulls, fines, rewards and recovery), pool accounting across every owned-cargo
writer, and versioned migration. Numeric projections are presentation only.
Preserve the unchanged request/equipment progression policy using exact amounts.
Tests must include the production Holdings boundaries and malformed old saves,
not merely this model copied into another test.

[Durable gameplay transactions](https://github.com/jcfischer/seelite/issues/936)
must supply save-before-success, uncertain-write recovery and death/checkpoint
reconciliation so loss cannot refund a surviving job or reset pool debt.
[Operational time](https://github.com/jcfischer/seelite/issues/937) and economic
calibration remain refinery prerequisites. No wallet or refinery integration briefs are
ready until their applicable contracts settle; do not assign unresolved save
semantics to a build worker. This decision does not implement the refinery UI,
retune prices, alter thresholds or claim production readiness.
