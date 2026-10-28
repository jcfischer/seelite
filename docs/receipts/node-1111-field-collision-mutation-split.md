# Node #1111 — field-collision mutation test split

Checkpoint: `cp-seelite-field-collision-mutation-split`.

## Result and supervisor PR text

`tests/field-collision.test.ts` contains the ten non-timing rows formerly in
`tests/field-flight-collision.test.ts`. The worker-stall and collision-cost
rows remain in the flight file. All twelve original test calls, including
their names, assertions, loops, fixtures and timeouts, compare byte-for-byte
against `8a92daf3` after parsing their boundaries with TypeScript. Imports
were trimmed; the shared local fixtures were copied without changes.
Two additional fast rows count metadata reads on a repeated query and real
rock poses on a one-cell query. They preserve detection of work regressions
that the timing rows alone killed in the historical report.

The new real-file row in `tests/mutation-changed.test.ts` reads both test
files and asserts that `testsFor("src/field-collision.ts", …)` returns only
the same-stem file. It failed before the split and passes afterward. No
source, runner, Stryker setting, timeout, worker count or CI policy changes.
This is internal test organization and does not meet `changelog.ts`'s
definition of a major player-visible change.

## Mutation comparison

The baseline is the completed PR #1110 report for `53e61b22`, with summary
head `53e61b22108acff42b974e4ea20f98f627909de5`, base/merge base `387fd32f`.
Its embedded `src/field-collision.ts` is byte-identical to this branch's
source (Git blob `26677188585d434a467099472342fc833413cc55`). It reports
145 mutants: 100 Killed, 40 Survived and 5 Timeout, in 1,380.882 seconds.
Timeouts are separate from kills. These are historical figures, not a new
measurement or a controlled speed comparison.

| Same required set of 109 replacements | Killed | Survived | Unresolved |
| --- | ---: | ---: | ---: |
| Historical report | 100 | 9 | 0 |
| Fast file, initial replay | 107 | 0 | 2 diagnostic-buffer errors |
| Fast file, combined with two retries | 109 | 0 | 0 |

All 100 historical kills are preserved. All nine named survivors are now
killed. The final test file's SHA-256 is
`2015e867c8e2d08c68ec832df2680f66b66a59ca71e33bc11a45443a9be56003`;
the initial replay and retries used identical source and test bytes.

The two retries are ids 44 (L76, `ConditionalExpression` → `false`) and 45
(L77, `CallExpression` → `;`). Their failed `RockPieces` comparisons each
printed 95,587,401 bytes, exceeding the temporary collector's 4 MiB buffer.
Writing stdout/stderr directly to files let Bun finish: both exited 1 at
the moved prebuild row, in 6.982 and 6.970 seconds. Those first collector
errors are retained as errors in the receipt, then replaced by the observed
retry outcomes. No test assertion or repository runner setting changed.

The node's hand-replay alternative was used. All 100 historical Killed
replacements and the nine Survived replacements at L71, L75, L76, L77 and
L287 were applied separately to a disposable host copy of `src/`, `tests/`,
`scripts/`, `bunfig.toml` and `package.json`, using the existing dependency
tree. The assigned worktree's source was never changed. Report locations
use one-based lines and columns; every patched file was parsed with
TypeScript before running it. An unmutated control passed first. Each
replacement ran `bun test --timeout=60000 tests/field-collision.test.ts` in
a fresh process, with a 65-second process deadline. This is a direct
replacement replay, not an instrumented Stryker or GitHub CI run. The
runner's settings are unchanged.

The machine-readable receipt records each of those 109 replacements,
locations, mutators, historical statuses, replay statuses and failed rows.
The other 31 historical survivors and five timeouts are outside this replay;
this receipt does not claim a full-file Stryker score on the final head.
The `sourceHead` field identifies the committed source; the final test
bytes were copied from the worktree and are bound by the test hash above.

| Historical timing-only kill | Replacement | Fast row verification |
| --- | --- | --- |
| L35, `CallExpression`, id 2 | Omit `piecesByArchetype.clear()` | The moved prebuild row checks cache contents after a source swap |
| L66, `BlockStatement`, id 21 | Empty prebuild body | The moved prebuild row checks requested archetypes and installed pieces |
| L69, `BooleanLiteral`, id 22 | `!source` → `source` | The moved prebuild row must finish with a registered source |
| L69, `ConditionalExpression`, id 23 | Source guard → `true` | The moved prebuild row must finish with a registered source |
| L70, `ConditionalExpression`, id 27 | Loop condition → `false` | The moved prebuild row checks every requested archetype |
| L70, `EqualityOperator`, ids 28, 29 | Loop bound → `<=` / `>=` | The moved prebuild row checks the exact requested archetypes |
| L70, `UpdateOperator`, id 30 | `archetype++` → `archetype--` | The moved prebuild row must finish with valid archetypes |
| L70, `BlockStatement`, id 31 | Empty loop body | The moved prebuild row checks installed pieces |
| L71, `ConditionalExpression`, id 32 | Cached-archetype guard → `true` | The moved prebuild row checks uncached archetypes are built |
| L73, `BooleanLiteral`, id 34 | `!field` → `field` | The moved prebuild row must finish with valid fields |
| L73, `ConditionalExpression`, id 35 | Field guard → `true` | The moved prebuild row must finish with valid fields |
| L146, `ConditionalExpression`, id 81 | `!row` → `true` | Rebuilding system plans rereads the record on the second query |
| L257, `ConditionalExpression`, id 121 | `!lattice` → `true` | Rebuilding the rock lattice rereads the record on the second query |
| L124, `ArithmeticOperator`, id 65 | `lattice.cellKm / 2` → `lattice.cellKm * 2` | A one-cell query poses extra rocks |
| L126, `MethodExpression`, id 68 | Lower clamp `Math.max` → `Math.min` | A one-cell query poses extra rocks |
| L130, `MethodExpression`, id 74 | Upper clamp `Math.min` → `Math.max` | A one-cell query poses extra rocks |
| L250, `ArithmeticOperator`, id 110 | `2 * RESTING_KM` → `2 / RESTING_KM` | A one-cell query poses extra rocks |
| L151, `CallExpression`, id 85 | Omit `systems.set()` | The repeated query rereads system metadata |
| L259, `CallExpression`, id 124 | Omit `lattices.set()` | The repeated query rereads system metadata |

The cache and range mutants' historical failure logs name only the
collision-cost row. The new cache row passes without mutation and fails
independently for ids 81 and 121 (one failing row, ten filtered out in each
control, before adding the pose row).
The first query must also produce the requested rock and make at least one
record read, so the zero-additional-read assertion has a positive control.
The repeated query must return the same owners and motions. Detection of
these cache regressions now uses work counts instead of a clock threshold.

The pose row calls the real function through a pass-through Bun spy, restored
in `finally`. It queries the centre of the nearest occupied interior cell,
co-moving with the field, and requires exactly two calls for that cell's rock
at the two step endpoints. Its nonzero call assertion proves the observer
intercepts the live import. It passes without mutation and fails independently
for each of the four range/growth replacements. The original reach corpus
continues to check contact completeness over its forty steps.

Other historical worker-only kills are covered by the unchanged prebuild row.
The final replay also includes the removed-cache-write mutants at L151 and
L259; they must remain kills, just like all other historical kills.

Before finding the completed baseline artifact, a duplicate full-file
Stryker baseline was started and interrupted without a result. An initial
replay control refused a missing preload helper. An early replay used
incorrect zero-based columns; those results were discarded after an
equivalent guard unexpectedly failed. Only the restarted replay with
one-based columns and parse validation supplies the results below.
Exploratory replays were stopped as timing-only cache and range kills were
identified, before adding their fast rows. They supply no final counts.

## Timing on the hardware host

The timing command runs the complete fast file, including Bun startup and
the repository's authored-model preloads. All twelve rows must pass in each
sample. The cell-reach corpus builds the rock archetype pieces on first
use; it remains intact. These measurements describe this host and are not
a GitHub runner prediction.

On 2026-10-28 at 01:16 UTC, one accepted quiet run of
`bun test --timeout=60000 tests/field-collision.test.ts` took **5.894 seconds**
wall time: 12 passed, zero failed. Hardware: Apple M1 Pro, ten CPU cores;
Bun 1.4.2 and Node 24.19.0. Load averages (1/5/15 minutes) were
**7.87 / 10.87 / 12.18** before and **8.20 / 10.89 / 12.18** afterward.
CPU idle was 67.1–69.2% in the two preflight observations, 55.7–62.7%
during the run, and 64.4% afterward.

Here, quiet means isolated from competing validation work, with normal
managed-Mac services still running. Two one-second preflight observations,
one-second observations during the test and a postflight observation each
required other Bun processes at no more than 1% CPU, other Node processes
at no more than 10%, and no live Seelite probe-lock holder. The observed
peaks across those observations were 0.9% and 4.7%, respectively. The old
probe-lock record named a dead process; the canonical `readHolder` and
`pidAlive` helpers confirmed that it held no live lock. The shared record
was left untouched. Earlier samples overlapping other validation work
were excluded. The accepted run uses the same final source and test hashes
as the mutation replay. This is one sample, without a CI speedup claim.

## Local verification

The change is confined to headless tests and this receipt. The path-only
probe-selection diagnostic reports no probes, with reason “Only
documentation or headless tests changed.” `CLAUDE.md` exempts this scope
from browser execution. The supervisor retains Sage review, push, PR,
committed-head selection and merge.

The affected files pass together: 23 tests, zero failures. TypeScript,
formatting, Biome lint, ESLint and the production build passed. The full
`npm test` command ran once on this host after the final test edit:
7,106 passed, zero failed across 426 files, in 1,526.77 seconds.
An independent Codex agent audited the split, mutation identities, replay
locations and spy restoration without finding a code blocker. Its exact
model slug was unavailable; this was a same-family check. The supervisor
owns the subsequent Sage review.

[Machine-readable evidence](node-1111-field-collision-mutation-split.json)
contains the complete required mutant set, outcome history, content hashes,
verification counts and host timing observations.
