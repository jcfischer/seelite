# Node #1059 — changed-line mutation measurements

## PR body text for the supervisor

Adds advisory Stryker mutation testing for changed lines in tested headless
`src/` modules. The PR-only job is explicitly non-blocking and uploads HTML and
JSON reports even when survivors are found. Rendering/browser modules are
excluded by a tested runtime-dependency rule. A reasoned Stryker next-line
directive is the only new comment exception.

**Merge `ci/mutation-changed-lines` with a merge commit. Do not squash it.** The
node's close checkpoint requires branch ancestry on `main`.

### Measurements

Local runs on 2026-10-21, this host, Node 24.19.0 / Bun 1.4.2 / Stryker 10.0.0,
one mutation worker. These are wall-clock measurements under shared-host load,
not predictions for GitHub runners. Source snapshots were clean; each historical
comparison used the merged commit's first parent as merge base. The current
runner and installed dependency tree were supplied to a disposable detached
clone; neither the assigned worktree nor another working branch was mutated.

| PR / snapshot | Changed `src/` files | Mutated files | Mutants | Survivors | Confirmed real defects among survivors | Wall-clock |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| This node, implementation `ce7ec4d` vs `a664c8d` | None (CI/scripts/lint/tests only) | None | 0 | 0 | 0 | 1.26 s |
| [#1054](https://github.com/jcfischer/seelite/pull/1054), `9f12a26` vs `e950f79` | `deficits.ts`, `market.ts` | Both, against 1 and 2 test files respectively | 0 | 0 | 0 | 14.45 s |
| [#1026](https://github.com/jcfischer/seelite/pull/1026), `01ca0b9` vs `ac6a86b` | `combat-rig.ts`, `key-names.ts` | `key-names.ts`, against 7 reaching tests | 13 | 0 | 0 | 31.95 s |

#1054's selected lines are imports and call substitutions; Stryker generated no
mutants. That row establishes cost and reporting, not assertion strength.
#1026 killed all 13 mutants (no timeouts/errors); `combat-rig.ts` was excluded
for its rendering dependency. Raw summary records are stored beside this receipt.
The host's one-minute load was above 200 during the control and was 89.55 after
the #1054 replay, so comparisons should retain that qualification.

### Control that can fail

The integration test runs the actual `npm run test:mutation:changed` command in
a disposable Git fixture with one changed line in `src/positive.ts`:

```ts
export function positive(value: number) { return value > 0; }
```

| Assertion | Mutants | Survivors | Assessment | Runner wall-clock | Exit |
| --- | ---: | ---: | --- | ---: | ---: |
| Only checks `typeof positive(1) === "boolean"` | 5 | 4 | Four non-equivalent predicate defects go undetected, including `value >= 0` | 3.75 s | 1 |
| Checks positive, zero and negative results | 5 | 0 | All five killed | 14.03 s | 0 |

The four survivors were conditional replacements `true`/`false` and equality
replacements `value >= 0` / `value <= 0`. These are injected defects in the
control, not defects found in the game's historical releases. Both control
arms retained identical source bytes; only assertions changed. Every reported
mutant was on the changed line. The complete integration test took 59.88 s,
including fixture/Git/npm overhead under load; the table uses runner-reported
wall-clock consistently with the PR rows.

### Supervisor-owned evidence still needed

This worker cannot push, create/edit a PR, or start GitHub Actions. Copy the
table into the PR body and append the actual advisory job URL/result after the
supervisor pushes. Local results above must not be labelled GitHub CI results.

The committed-head probe selector expands this tooling/config diff to all 112
browser probes. The worker contract reserves the full browser suite for the
supervisor and prohibits running it here. No game source or browser launcher
changed; no browser-pass claim is made by this receipt. The supervisor must run
the required final `probe:pr` gate, and Sage review, in the prescribed order.

## Local verification

- Full `npm test`, run once: **6,775 pass, 0 fail**, 1,308.53 s. This included
  the real control before it was separated from the Node 20 unit tier.
- After moving the control into the Node 22 mutation job and supplying its
  fixture identity: `npm run test:mutation:control` passed (5 mutants / 4
  survivors with weak assertions, 5 / 0 with boundary assertions; runner times
  4.42 s and 4.19 s). The log lists all four surviving replacements.
- Final affected tests: **58 pass, 0 fail** across mutation selection, the
  comment rule, workflow parsing and script gates.
- Typecheck, `format:check`, `lint`, `lint:comments`, and build passed.
- No game source changed. The plural `*-shaders.ts` exclusion has its own
  regression test, observed red before correcting the filename rule.

The initial full-suite run preceded the control's relocation; that change
was checked through its standalone command, the affected tests and typecheck.
The later assigned-branch run is recorded separately below.

## Assigned-branch verification, 2026-10-21

The resumed worker inherited `ce7ec4d` and `77b836a`; no implementation change
was needed. Current checks on `77b836a`:

- Affected mutation, directive, workflow-reader and script-gate tests:
  **58 pass, 0 fail**, 7.22 s.
- Real control under **Node 22.23.2**, the mutation job's major version:
  **1 pass, 0 fail**, 18 assertions. Weak assertions produced 5 mutants / 4
  survivors (3.29 s); boundary assertions produced 5 / 0 (2.82 s). The control
  verified unchanged source bytes and clean Git status in both arms.
- `npm run test:mutation:changed` against `origin/main` exited 0 with no
  changed source files, no mutants and no survivors, 1.21 s.
- Typecheck, `format:check`, Biome lint and ESLint itself passed.
- Full `npm test`, run once in this verification session: **6,773 pass,
  1 fail**, 6,774 tests across 398 files, **1,132.05 s**. RTK 0.40.0's generic
  test wrapper omitted the actual failing test and retained no recoverable raw
  test log; its only purported failure detail was a passing test whose title
  contains `FAIL`. The failing test is **unidentified and unattributed**.
  It is not established to be a base failure. The supervisor must retain raw
  output in its required rerun; this receipt makes no final full-suite-pass
  claim. The worker did not repeat the full command, per its one-run contract.
- Live selection includes `market.ts` (two test files) and `sim.ts` (one).
  `main.ts`, `ship-mesh.ts` and `planet-classes.glsl.ts` are excluded; reaching
  geometry/shader tests do not override the browser-dependency exclusion.

`lint:comments` against the now-advanced `origin/main` (`4bbff7c`) exits 1:
`src/authored-hull.ts` has 33 suppressed comments on this branch versus 27 on
main. This node changes neither that file nor `eslint-suppressions.json`.
The guard produces the identical failure using the merge-base (`a664c8d`)
suppression file. `LINT_BASE_REF=a664c8d npm run lint:comments` passes. This is
an inherited baseline difference; the worker contract forbids repairing unrelated
base failures or changing/rebasing other branches.

Probe selection at `77b836a` again selected all **112** probes because CI
workflow changes trigger the infrastructure fallback. The full browser run,
live PR job run, PR-body publication and merge commit remain supervisor-owned.
