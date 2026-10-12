# Refinery services — contract and console study

Refs #921. Author: Codex. Base: `c1b5bd00`. Prototype branch: `prototype/refinery-921`.

Status: D1–D10 individually ratified in the principal's conversation on 2026-10-12. The principal approved the console with one copy correction: remove “You review the full quote before committing.” Final technical-contract ratification remains open. This is a throwaway prototype, not production integration, a shipped save migration, or economic calibration. The eventual graph receipt owns the ratified decision; this document records the prototype and its engineering proposal.

Open `src/refinery-console.prototype.html` directly in a browser. One file, no server, no dependencies, no game storage access. The console uses the existing station palette and tab structure; it is not mounted in the actual cockpit. The blue demonstration controls are outside the proposed game UI. Its seven guided walkthroughs cover ordinary processing, an outage, partial collection, cross-job fractions, changed quotes, interrupted saving, and eight occupied slots.

## Approved policies

- D1: No cancellation or refund after submission.
- D2: Eight outstanding jobs per refinery, including finished-but-uncollected jobs. Partial collection retains the slot, subject to D5.
- D3: Submissions remain separate, with their own quote, queue position and collection balance. Splitting material cannot reduce aggregate fees or processing work.
- D4: Changed input, output, fee or queue position requires a refreshed quote and another confirmation. Countdown passage alone does not. Insufficient ore, credits or slots takes nothing.
- D5: A completed job with no whole product units left transfers its remaining fraction and cost basis to the per-refinery product balance and frees its slot. Fractions combine across grades and jobs without expiry. A pooled balance may become a whole collectable unit; it is not always less than one unit.
- D6: Processing outages refuse submissions and pause work, preserving order. Finished output remains collectable while docked.
- D7: A Refinery tab at docked refineries, with Submit and Jobs & collection views.
- D8: Processing shares the planned refinery `exclusive` capability's outage. Specialist equipment availability shares that failure; market availability and collection are separate.
- D9: One ore family/grade per job, positive whole tonnes up to owned material aboard, no additional gameplay batch cap. No topping up an accepted job.
- D10: Submission and collection report success only after the complete transaction is saved. Saving suppresses repeated actions and departure. Failure leaves the action uncommitted and offers retry. Production needs a shared commit mechanism.

The parent mining decision supplies custody across ship loss, game-clock progression, independent per-refinery FIFO processing, same-refinery collection, no expiry and no general storage. The ore decision supplies fifteen input goods, five products, fixed yields, whole-tonne input, whole-native-unit collection, retained fractions and carried cost basis. The prototype does not revise those decisions.

## Transaction proposal

Submission and collection are Holdings events, sharing the existing commander/world adoption boundary (`src/holdings.ts`, `Game.adoptHoldings`). They compute a candidate envelope without mutating live state. The shared save coordinator owns exclusive transaction/departure handling, commits the envelope, then adopts that exact candidate and announces success. If completion is interrupted, reload observes either the entire old envelope or the entire committed envelope. A rejected or failed write cannot leave half a debit or duplicate output. Recovery from an uncertain write outcome must read the committed revision before retrying.

A quote identifies the galaxy, refinery carrier key, recipe version, input good and quantity, exact output, exact fee and queue position. The displayed estimate includes work ahead and states that outages may delay it. Recompute the material terms and eligibility at commitment; never charge a revised quote silently. While offline show paused work rather than a fabricated completion time. No remote live-status UI is introduced.

At commitment validate dock/refinery identity, current recipe, owned whole-tonne input, credits, eight-job cap, service availability, bounds and quote equivalence. Allocate the stable job identity only on success. Debit ore and its purchase basis, debit the fee, create a FIFO job and transfer ore basis plus fee into custody in one candidate. Double confirmation uses a bounded operation identity/revision; do not append an unbounded receipt history to the save.

Collection revalidates location, completion, balance, revision and available capacity. `Collect what fits` takes the available whole native units limited by the current hold, preserving the existing precious-product no-slot rule. Zero fit rejects without mutation. Move material and proportional basis together, clear an empty job, and move a fractional remainder to the pooled product balance as D5 prescribes. Collection during an outage is allowed. Collected cargo is ordinary aboard cargo and follows existing ship-loss rules.

The prototype uses exact integer grams and rational cost basis; display rounding never changes the ledger. Its demonstration input costs 100 Cr/t and fee costs 10 Cr/t. Those values are fixtures. **Production monetary representation and bounded allocation/rounding remain to be settled before an executable build brief.** The rational demonstration is not a bounded-save implementation: repeated combining can grow rational denominators. Production must conserve aggregate basis, including existing cargo basis, without earning progression on submission/collection or creating profit through split collection. Do not silently choose a lossy migration or use display-rounded costs as ledger values.

## Processing proposal

Each refinery retains an accounted-through game-time cursor and each job its remaining processing work. Apply operational duration to the first unfinished job, carrying excess to the next. Finished but uncollected jobs occupy slots but do not block processing behind them. Work must be independent of frame cadence, visiting the system or opening this console.

Settle through an availability-changing boundary before that transition or compaction discards its previous condition. Availability must supply an authoritative operational-duration function or bounded interval iterator over game time, including scheduled recovery and baseline changes. Do not infer history from present status, subtract wall-clock timestamps, or keep an ever-growing outage ledger. The current world model's bounded causal summaries cannot reconstruct arbitrary past outages.

Fixture parameters are exported by the HTML: 10 Cr/input tonne and 60 operational seconds/input tonne, equal across recipes solely for demonstration. No per-job overhead or volume discount; exact linear work/fee prevents splitting advantage. Economic measurement must replace this fixture table and ratify rates before production. Numeric validation must reject unrepresentable products, fees, accumulated work, balances and counters before consuming anything.

## Persistence and runtime boundaries

Use the existing one-envelope `{world, commander}` save, not another storage system. Jobs, pools and their costs must survive ordinary death as live custody; acquired cargo must not. Stable refinery identity is the galaxy envelope plus `carrierKey(systemIndex, localCarrierId)`, not a display name or local station ID alone. Persist bounded job counters and recipe identifiers. Legacy saves initialize empty jobs/pools, preserving all previous cargo and cost basis. Validate the new schema and reject malformed/non-finite/overflowing quantities without silent rounding.

Current seams inspected:

- `src/save-envelope.ts`: world and commander already share an envelope and integrity boundary.
- `src/save-store.ts`: IndexedDB `writeMany` is atomic, but ordinary writes are asynchronous/debounced; successful in-memory adoption does not prove persistence.
- `src/holdings.ts`: `commanderAfterDeath` restores the launch commander while retaining the current world. A stale `lastDocked` credit balance must not refund an already-paid surviving refinery job. Nor may collecting resurrect goods after their aboard copy was lost.
- `src/main.ts`: `saveFlush` does not await successful commit; `lastDocked` is normally refreshed at dock/undock.
- `src/world-state.ts`: lazy recovery exists, but the generated carrier union has no station capability kind. Baseline absence currently reads operational.
- `docs/specs/station-damage.md`: capability carriers are designed but unbuilt; its old generator-version-7 instruction is stale against this checkout's version 10.

Required shared machine work: awaited commit with explicit outcomes, repeat suppression, uncertain-commit recovery and launch/death checkpoint reconciliation. This belongs on the machine map with refinery provenance, not hidden in console implementation.

Required station work: implement the existing station-damage decision's capability projection and operational-time contract. Station damage #358 is a closed decision, not evidence that its implementation exists. Its baseline time/raider-pressure function still needs resolution. Do not silently add a fake always-operational reader.

Permanent station destruction/relocation remains #494's decision. This prototype keeps the current generated station identities. Do not invent loss, transfer or replacement rules for refinery custody. Production crossing that boundary must depend on the destruction decision.

## Save-size measurement plan

Current generator ceiling: at most one refinery per system, 256 systems per galaxy and eight galaxies. Thus at most 2,048 refinery rows, 16,384 outstanding jobs and 10,240 pooled product entries. Those are structural ceilings, not measured bytes. Sparse actual-generator state will usually be smaller.

Extend `scripts/measure-save-size.ts` after the production representation is specified:

1. Measure a legacy migration with no refinery records, representative mining/trading play, actual-generator saturation, and the structural ceiling.
2. Fill each refinery with eight mixed queued/processing/ready jobs and all five non-empty pools, maximum encoded IDs/counters/quantities/costs, and deliberately maximal legal decimal lengths. Preserve the rest of the world's existing worst-case state in the combined-envelope measurement.
3. Verify per-galaxy identity and row counts before measuring; colliding keys must not make the save appear smaller.
4. Report JSON UTF-8 bytes, serialization and parse times, hash time, and browser IndexedDB transaction time separately. Quote the browser/runtime/hardware and exact commit.
5. Bound every string, numeric field and accounting representation; no historical per-job receipts, outage log or arbitrary-length rational ledger. Counter saturation refuses new submission without losing custody.

## Production acceptance cases

Interrupted save before/after durable commit; uncertain outcome followed by retry; repeat submission and collection; stale quote; insufficient ore/credits; eight occupied slots; full/reduced hold; all fifteen recipes; unlike grades; cross-job fractions producing whole units; exact cost conservation; split fees/work; paused intervals while elsewhere; recovery and interruption boundaries; old-save defaults; same local IDs across galaxies/systems; death before and after collection; failed launch-checkpoint write; bounded save saturation.

These are the future production failure cases, not passing tests. The standalone demo uses in-memory snapshots and manual fixture clock/outages; it does not prove IndexedDB durability, actual-cockpit clickability, save migration or production recovery integration.

## Review status

The principal approved the console on 2026-10-12: “drop \"You review the full quote before committing.\" that's so AI like otherwise: Very nice”. The requested sentence is removed. This approves the console layout and interactions; final technical-contract ratification remains open. No production build briefs filed yet. Separate submission/processing and collection slices follow only after their required persistence, capability and economic decisions are resolved. Keep this prototype branch as the reproducible primary source; do not merge its HTML shell into the game.

### Prototype walkthrough observation — 2026-10-12

Chromium headless rendered both console views and clicked through all seven guided walkthroughs, with no page-script errors. Ordinary processing ended with 2 t Minerals aboard; partial collection ended with 3 t Alloys aboard and 0.2 t pooled; four fractional jobs yielded one collected kilogram of Platinum. Stale confirmation refused until requoted; interrupted saving restored the old envelope and a repeated committed action was refused; collecting one of eight ready jobs freed a slot. These observations cover the standalone HTML only, not a repository browser-gate or runtime-save pass. The browser required execution outside the filesystem sandbox because macOS denied its Mach port registration inside it.
