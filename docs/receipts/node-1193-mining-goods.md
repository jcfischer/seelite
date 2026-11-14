# Node #1193: durable mining cargo and raw trade

Base: `6398a3aba07cb7d36a9a3f969e17e6d12b6e97a0`.

The 15 family/grade goods use the Hold page's existing names, including `STD`.
Fragment scoops and completed drill transfers now acquire ordinary commander
cargo through Holdings. `Game.minedOre` and commerce's separate `rawOreT` input
are removed. Physical flight mass counts the cargo once. The Longwall keeps its
3,000 t ore compartment and its separate general hold; other hulls share their
general hold with ore. Recovery and market purchases use the same compartment
admission rule. Hull auto-sales can sell ore while mining is enabled; otherwise
they refuse a swap that cannot keep it aboard.

`CARGO_COMMODITIES` is the complete durable cargo catalogue. The existing
`COMMODITIES` registry retains the 17 legacy rows, order and generation pool;
existing seeded consumers continue using it. Raider weights additionally
exclude raw ore explicitly. This avoids expanding random loot, carrier
manifests, ordinary requests or the historical trading instrument by accident.

The price/stock authority is the table ratified on node #923 at
`67edda123571a8d0e4ecbab44046cb7dceed7ae2`, recorded in
`docs/receipts/node-923-ratified-table.md` and its candidate JSON. Production
uses the instrument's product-equivalent mid × 0.35, elasticity × 0.5 and
seeded per-family/grade/epoch 8–63 t stock. Existing spread, shelf cap, stock
memory, decay and native-unit rules remain in force. A parity test compares
production with the ratified instrument for all 15 goods at generated station
markets, three epochs and four stock marks.

Ore acquisition enters the eventual product's existing commodity pool in
product-equivalent mass, while physical cargo and its basis remain in tonnes.
Newly mined ore is known zero-cost material. Raw sales recover shared product
debt and award only eligible remaining proceeds. Loss and partial own recovery
preserve their shares. Death-wreck creation allocates pooled unknown eligibility
once across all lost goods and grades, including cargo that does not survive.

Save schema 21 admits raw ore and retains schema 20 as a supported source.
Ore cargo, physical basis and wreck quantities require whole tonnes; invalid
rows fail without rounding. Product-pool keys remain unchanged. Saves holding
ore load without `?mining=1`; flagless markets still have exactly 17 rows.
Ordinary save quantities retain their previous validation. Older builds cannot
read schema 21. Refinery processing and collection are outside this change.

## Verification

- `tests/mining-goods.test.ts` covers names, stacking, both compartments,
  purchase/sale, quoted prices, stock memory and caps, schema compatibility,
  shared costs and unknown eligibility, split sales, death and partial recovery.
- The base fingerprint is
  `1eba4db853d94252c2857af49edfab6a4108a14a00e925c9ca94e872563922fb`:
  all legacy rows, all economy/fluctuation/station-type market combinations,
  raider weights and 1,024 seeded raider drops. It was captured before edits.
- `probe-mining-goods` is registered with its contract roots. On the hardware
  lane it drilled 12 t Silicate ore STD, persisted through mining and flagless
  reloads, docked through clearance and the docking computer, and sold one
  tonne at the displayed 1.1 Cr bid. The page balance moved 100.0 → 101.1 Cr;
  all eight checks passed. Captures: `/tmp/seelite-1193-mining-goods/`.
- All eight affected GPU probes pass: mining goods, drill, mounts, survey,
  accounting, market shelf, death wreck and Hold. Logs are under
  `/tmp/seelite-1193-*.log`. The survey's full-hold fixture now fills the ore
  compartment, and the market migration check reads the current schema from
  the page instead of assuming version 20.
- Typecheck, production build, formatting, script lint and comment lint pass.
- The single required `npm test` run completed 7,976 tests across 495 files:
  7,975 passed and one failed because the new probe lacked its default-layout
  key label. The label was added and `tests/probe-key-labels.test.ts` then
  passed all three checks. The full suite was not repeated, as the worker contract
  requires. Full log: `/tmp/seelite-1193-full-test.log`; corrected-label log:
  `/tmp/seelite-1193-key-labels.log`.

Probe selection reported all 126 probes because shared Game declarations changed.
The worker contract forbids the full probe suite and assigns it to the supervisor;
the local runs are affected-contract coverage, not a full browser-suite pass.
The public changelog is unchanged because this remains behind `?mining=1`.
