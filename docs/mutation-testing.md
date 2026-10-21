# Changed-line mutation testing

Node #1059 ports crisis-simulator's `scripts/mutation-changed.ts`, not its
whole-module authorization-policy run. Use Node 22 or later and Bun:

```sh
git fetch origin main
npm ci
npm run test:mutation:changed
```

Commit first: the runner requires a clean checkout at the selected head. It
compares `origin/main...HEAD`, passing only added/modified head line ranges to
Stryker. Deleted lines have nothing to mutate. Removing only a trailing comment
does not select the unchanged code. Renames are treated as delete/add, so moved
modules receive the added lines' scrutiny.

`MUTATION_BASE_REF` overrides `origin/main`; `MUTATION_HEAD_REF` overrides `HEAD`
but must identify the checked-out commit. For a historical run, use an isolated
detached snapshot at that PR's merge/head commit and its first parent as base.
No source file is edited or restored by the runner. Stryker instruments its
temporary sandbox and removes it even on failure.

`MUTATION_CONCURRENCY` sets a positive integer worker count (default `1`). CI
uses `2`; each worker runs tests in its own Stryker sandbox. The real CLI
control exercises both surviving and killed mutants with two workers. Tests
that reach resources outside their sandbox may still need a serial local run.

## Eligibility and test selection

`mutableReason` in `scripts/mutation-changed.ts` owns the include/exclude rule:
tracked `src/**/*.ts`, excluding declarations/tests, reached by a runtime import
from a Bun test within three edges. The runtime dependency closure must contain
no shader module, browser/DOM/canvas/audio API reference, external runtime
package (including Three.js), unresolved import, or nonliteral dynamic import.
The rule deliberately excludes renderer geometry even when Bun tests import it.
Type-only package imports are allowed. This is a conservative static boundary,
not runtime coverage; skipped files and reasons are printed and recorded.

The graph reads imports, re-exports, literal dynamic imports and `require`, not
comments or arbitrary strings. Same-stem reaching tests are preferred; otherwise
the nearest tests are chosen, up to eight files. Tests with matching names that
do not import the source are not selected. `tests/mutation-changed.test.ts`
exercises the boundary and selection.

The command runner uses `coverageAnalysis: "off"`: each mutant runs that file's
selected tests once, with no per-test coverage claim. A survivor can reveal a
gap in the selected tests even if an unselected test would kill it. Inspect it
before calling it a defect. A verified equivalent may be annotated:

```ts
// Stryker disable next-line EqualityOperator: explain why both forms are equivalent here
```

The comment rule permits only a reasoned `disable next-line` line directive
with named mutators. It does not permit an unrestricted `disable all`, an empty
reason, a block directive, or surrounding narration.

## Reports and CI

`reports/mutation/changed/index.html` links per-file HTML reports; JSON reports
and `summary.json` carry locations, replacements, counts, statuses, selected tests,
revisions and wall-clock seconds. Exit 1 means a survivor or a failed/incomplete
Stryker run; exit 2 means setup failed. Zero mutants is reported explicitly and
is not evidence of strong assertions. No score threshold suppresses a survivor.

The `mutation-changed` CI job runs only on pull requests, checks out the actual
PR head with full history, uses Node 22, and has `continue-on-error: true`.
The build/deploy jobs do not depend on it. Reports upload even when mutation
testing fails. A 30-minute job limit bounds cost; cancellation or timeout is an
incomplete measurement, not a clean mutation result. Making this job blocking
requires the principal's later decision.

The real CLI control in `scripts/mutation-control.test.ts` creates an
isolated Git fixture. A deliberately weak assertion lets changed predicate
mutants survive and returns 1. Boundary assertions kill them and return 0. It
also checks that unmodified lines were not mutated and that source bytes and Git
status remain unchanged.

Run it with `npm run test:mutation:control`. The Node 22 mutation job runs this
control before testing the PR's changed lines. It is separate from `npm test`
because the ordinary unit shards use Node 20, while Stryker 10 requires Node 22.
The fixture supplies its own Git author/committer identity through its child
environment; it writes no Git configuration.
