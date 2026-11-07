# #1194: production capability outages

## Scope

Implements the #937 contract in production: fixed generated market, equipment and exclusive-service carriers; stationary alternating outage timing; pressure changes at real raider transitions; attributable repair suppression through the original outage end; retained-anchor operational-duration queries and an explicit dependent-settlement seam. Commerce refusals and the persistent console service notice run only with `?mining=1`. Fuel and owned fitting actions retain their existing behavior.

The shared world domain is generator 11 / world schema 4 / save envelope 18. Legacy received outer and nested hashes are checked before migration. Impossible partial version pairings and noncanonical capability identities are refused. Existing generator-10 carrier identities, positions and catalogue keys are pinned independently of the newly appended carriers.

This remains a pre-release mining feature. The public changelog's returning-player-visible definition does not apply until the mining release exposes it; no public changelog entry is added here. The shared save migration is included and verified here rather than hidden behind the runtime flag.

## Headless evidence

The affected command passes 503 tests and 145,012 assertions across 16 files:

```sh
rtk test bun test tests/capability-*.test.ts tests/world-state.test.ts tests/save-*.test.ts tests/station-commerce.test.ts tests/station-console.test.ts tests/outfitting.test.ts tests/market-state.test.ts tests/view-set.test.ts tests/holdings.test.ts tests/probe-selection.test.ts
```

The capability tests exercise the actual production world, commerce and save seams. They include rowless natural outages observed through direct and relay knowledge, attributable repair and later outages, chronological remote recovery, real two-job FIFO progress, draining and idle intervals, submission after idle, partition and save/reload equivalence, fixed absent-slot streams, safe cycle overflow refusal, old-history refusal, bounded retained state, and complete flag-off transaction comparisons. Scoped module and legacy equipment purchases cover refinery and shipyard families, including the flagged legacy shipyard Mining Laser path. Hull ladder refusals and feasible overflow autosales retain their ordering.

The initial duration oracle distinguishes the approved length-biased distribution from uniform later phases. Remaining fractions are checked jointly within low/high duration bins. A temporary mutation aliasing the remaining-fraction RNG channel to the duration channel failed that oracle; restoring the independent channel passed. TDD logs are `/tmp/outages1194-{time,world,commerce,status,observation,migration,provenance,alias,channel-alias}-*.log`.

Typecheck, format, lint, the shrinking comment guard, launcher wiring (157 scripts), and production build pass. The affected test log is `/tmp/outages1194-headless.log`; the other gate logs use `/tmp/outages1194-{tsc,format,lint,comments,wiring,build}.log`.

## Actual save-size measurement

`bun scripts/measure-save-size.ts` exercises real complete-envelope serialization and parsing across all eight galaxies. Timing rows leave other domains untouched. The existing ordinary-carrier saturation rows now explicitly exclude capability records. The exported `capabilitySaveCase` accepts a later production refinery payload hook; these figures claim no future eight-job, custody or maximum-payload footprint.

| Seed | Generated capabilities | Untouched UTF-8 envelope | 40-anchor UTF-8 envelope | All-anchor UTF-8 timing payload | All-anchor UTF-8 envelope |
|---|---:|---:|---:|---:|---:|
| 1 | 7,447 | 2,272 B | 6,894 B | 880,589 B | 882,629 B |
| 47 | 7,501 | 2,274 B | 6,910 B | 887,071 B | 889,111 B |
| 6,218,014 | 7,540 | 2,279 B | 6,924 B | 892,061 B | 894,107 B |

Untouched timing payloads are 233 UTF-8 bytes. These ASCII fixture saves occupy twice the UTF-8 figures when counted as UTF-16 bytes. Actual measurement log: `/tmp/outages1194-save-size.log`.

## Review and browser evidence

Pending Sage, final-HEAD browser selection and gate, and canonical before/after capture. The new registered `probe-capability-outage` uses the actual page, world APIs, real console clicks, repair transition and browser save/reload. It buys fuel while the natural market outage is confirmed, checks a persistent notice beside an unrelated notice, refuses a damaged purchase, checks recovery with an actually stocked buy, and checks flag-off compatibility after reload.

The canonical set adds owned `capability-market-damaged` and `capability-market-recovered` views on the mining flag. Principal visual approval remains required; an agent's probes and captures cannot provide that approval. This node remains open until its actual gates and required approval are complete.
