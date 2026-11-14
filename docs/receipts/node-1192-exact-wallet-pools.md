# Node #1192 — exact wallet and commodity pools

This ships for every pilot, without `?mining=1`. Trading thresholds are unchanged.
The approved public sentence is the newest entry in `src/changelog.ts`, dated
2026-11-13. The supervisor owns publishing the PR and its final main-date check.

The commander account owns signed exact cash, exact banked trading credit,
17 commodity pools, and separate physical basis. Pool identities are a closed
schema catalogue; adding market goods cannot silently add progression pools. Purchases and processing costs
add debt once; eligible sale proceeds recover it before earning credit. Sales,
handovers and losses consume unknown eligibility first. Recovery carries bounded
shares and physical cost on the existing death-wreck container. Cost-only legacy
basis remains separate from subsequently acquired material. Numeric credits,
cargo and ladder figures are projections; affordability and trade rungs read
exact amounts.

Schema 20 is the one envelope bump. Boot takes the slot lock and validates both
stored records before migration. `SaveStore.commit` writes distinct replacement
live/lastDocked envelopes in one IndexedDB transaction, and only then does boot
return a migrated commander. A lost acknowledgement is reconciled against both
records. A bad checkpoint refuses the entire migration. The original pair remains
available through the overlay's Export action. Existing cost-only records,
fractional cargo, subnormal amounts and negative cash are preserved. Legacy own
wrecks acquire unknown-cost recovery metadata, rather than becoming eligible
salvage after migration.

## Verification

The focused production tests cover the instrument's worked cash/debt/bank cases,
all three current native units, fixed-price partitions across unknown dust,
collection order, fee and loss carry, cost-only basis, request handover, exact
rung boundaries, hull auto-sales funding the purchase, overflow refusal,
partial own recovery across reload, and fractional death cargo. Migration tests
exercise both records at binary64 endpoints, aggregate cost preservation,
invalid checkpoint refusal, malformed codecs, untouched exports, quota failure
and uncertain checkpoint reads. The existing exact-amount tests also pass.

The independent Claude audit initially raised an export claim and a conditional
hull-sale claim from missing caller context. Both were refuted with caller
source and regression tests. The positive-delta exception was changed to the
normal accounting refusal type. The follow-up verdict was **PASS**. Audit inputs
and responses are `/tmp/node1192-audit-final-input.txt`,
`/tmp/node1192-claude-audit-final.txt`, `/tmp/node1192-audit-followup.txt` and
`/tmp/node1192-claude-audit-followup.txt`.

Browser evidence uses Chromium's hardware lane on an Apple M5 Pro. It is affected
coverage, not a full-suite result. The worker SOP reserves the full browser suite
for the supervisor. Selection was inspected; shared runtime/boot changes expand
its gate to all probes. The worker ran only the affected contracts as instructed.

- `probe-accounting`: 8/8; complete-envelope serialization, validation and atomic
  distinct-pair writes, plus quota refusal without adoption for all four cases.
- `probe-market-shelf`: 20/20; distinct schema-19 migration before play, a real
  credited sale, named negative-cargo refusal and a real unchanged Export download.
- `probe-save`: 38/38; save/load, reload, checkpoints, storage failure and recovery.

Final headless/build/lint results and the remaining affected probes are recorded
below when the worker finishes. Browser logs are `/tmp/node1192-probe-<name>.log`;
`/tmp/node1192-probe-results.txt` lists the complete affected run.

## Complete versioned envelope measurements

`bun scripts/measure-accounting-save.ts` and `npm run probe:one -- probe-accounting
--show-output` are the reproducible instruments. The latter writes through the
production IndexedDB backend and `SaveStore.commit`. Its launch record has a
balance one credit below live, so the measured pair is genuinely distinct.
All sizes below are UTF-8 bytes, including both outer and nested hashes.

| Case | One envelope | Stored live + launch pair | Serialize + hash (ms) | JSON stringify (ms) | Hash alone (ms) | JSON parse + validation (ms) | IndexedDB pair transaction (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Migrated schema 19 | 38,418 | 76,835 | 0.6 | 0.0 | 0.1 | 1.0 | 25.9 |
| Typical, 50 systems | 38,423 | 76,845 | 0.5 | 0.0 | 0.2 | 0.6 | 36.1 |
| Actual-generator saturation | 67,280,858 | 134,561,716 | 430.7 | 88.8 | 154.8 | 567.5 | 260.7 |
| Saturation + widest accounting/recovery | 67,405,244 | 134,810,488 | 416.1 | 82.2 | 147.0 | 580.1 | 258.5 |

These are single browser observations, not latency percentiles. Hash-alone time
includes constructing its canonical JSON input and is already part of the first
column's serialization work; it must not be added twice. IndexedDB time measures
the backend write separately from candidate serialization and validation.

The typical case uses seed 1, 50 visited systems, station knowledge and four-good
deficits, plus a complete commander. Saturation uses every generated ordinary
carrier across eight galaxies, objective/episode/knowledge/deficit rows, legal
witness and assault lists, capability anchors, discoveries, sweep readings and
visited station/system sets. The widest case adds maximum-width legal exact
fields, maximum-width transaction counters, and 17 bounded own-wreck recovery
records with maximum-width mass and cost fields and finite native-quantity projections. It round-trips through the actual
parser before its storage test. This is a synthetic high-water case for the
current shape, not proof that every field is simultaneously reachable or a
universal bound on unrelated journal/text data. No future refinery queue or
custody payload is included; this node does not build those services.

Raw measurements: `/tmp/node1192-sizes.log` (Bun) and
`/tmp/node1192-final-probe-accounting.log` (Chromium/IndexedDB). Peak reported host load
for the storage probe was 6.6 on 18 cores. All four quota injections returned
`failed`, did not call adoption, and preserved both prior records.

## Final checks

The assigned branch fast-forwarded to `48d5fd4f` using the authorized
`git merge --no-edit origin/main`; the ancestor check passes. The required
`probe-save` (38/38) and migrated `probe-market-shelf` (20/20) passed again
after that merge. `probe-death-wreck` passed 6/6 alone after correcting its
legacy cargo fixture. The other affected probes passed: Hold, console sound,
dock arrival, ladders, Requests, shipyard, outfitting, mining mounts, capability
outages and scoop migration. The already-quarantined death probe also passed
40/40; its quarantine was not changed.

Build, typecheck, formatting, script lint, comment lint and launcher wiring pass.
The single full `npm test` run completed in 613 s: **7,919 pass, 16 fail**,
7,935 tests across 493 files, 17,231,893 assertions. Two failures were old
fixture assumptions about the new exact ladder field and the hull-sale fixture's
missing account. Those were corrected; the focused deposit/hull-sale run passes
**36/36** (`/tmp/node1192-full-fixtures-fixed.log`).

The other **14 failures are unchanged on base** `48d5fd4f` in
`tests/shared-image.test.ts`, the per-model “resolves every texture … with the
embedded settings” cases. They assert anisotropy 1, while the shared industrial
surface explicitly declares `EXTERIOR_MAP_ANISOTROPY = 8`. Both the final tree
and base return **115 pass, 14 fail**, with identical failing test names and
expected/received values (1/8). This node changes none of that image code.
The base proof uses sources/tests extracted directly from `git archive
origin/main`, on this host with the same installed dependencies and unchanged
model assets; it creates no branch or container. Per the worker SOP these base
failures were not repaired, and the full suite was not run a second time.

Evidence: `/tmp/node1192-full-tests.log`,
`/tmp/node1192-shared-image-head.log`, `/tmp/node1192-shared-image-base.log`,
and `/tmp/node1192-base-proof.txt`.
