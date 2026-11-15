# Node #1195 CI repair

Principal ruling `f79f3271-7375-46e4-b73c-00bb111dfe86` requires legacy
world migration and valid historical browser fixtures. The existing parser
already lifts world schema 4 to 5. Tests now prove that saves 18–21 load with
empty refinery queues, preserve their source bytes and round-trip. The accounting
fixture and both market-shelf fixtures now pair save schema 19 with world schema
4 before computing their checksums.

The failed CI artifact reported 201 surviving mutants. Added assertions cover
refusal messages, exact balances, malformed saved jobs, FIFO boundaries, queue
adoption, operational progress, retained anchors and unchanged queues. Redundant
settlement branches and an unreachable custody guard were removed.

## Verification

Runtime and test changes were checked at `cde42c726bd568cc8c69411bf81aaf4ea57db012`.
The final receipt commit changes documentation only.

| Check | Result |
| --- | --- |
| `npm run test:mutation:control` | 2 tests, 30 assertions, zero failures |
| `MUTATION_CONCURRENCY=4 npm run test:mutation:changed` | 467 mutants: 464 killed, 3 verified equivalents, zero survivors or errors; 294.15 s |
| `npx tsc --noEmit` and `npm run build` | Passed |
| `npm run format:check`, `npm run lint`, `npm run lint:comments` | Passed |
| `npm test` | 8,237 tests across 502 files, 17,236,975 assertions, zero failures; 697.26 s; run once on the host before the final commit |

The three equivalent arithmetic mutants replace multiplication by division
where the ratified `REFINERY_SECONDS_PER_TONNE` is exactly 1. Each has a local,
named directive as allowed by `docs/mutation-testing.md`.

The hardware browser lane reported ANGLE Metal on Apple M5 Pro:

| Probe | Result |
| --- | --- |
| `probe-accounting.mjs` | Passed, 16.4 s |
| `probe-market-shelf.mjs` | Passed, 58.4 s |
| `probe-refinery-jobs.mjs` | Passed, 98.6 s |

The ruled pair used `PROBE_SELECTION=1` with `PROBE_FILES`; the exact-selection
flag is required on this checkout. The refinery probe used `npm run probe:one`.
This is focused coverage of three probes, not a full browser-suite pass. The
selector still expands the complete branch to all probes; the worker SOP leaves
that full run and the principal's visual judgment to the supervisor and principal.

Raw evidence remains outside git in `/tmp/node1195-ci-mutation.log`,
`/tmp/node1195-mutation-final.log`, `/tmp/node1195-probes-final.log`,
`/tmp/node1195-refinery-probe-final.log` and `/tmp/node1195-npm-test.log`.
