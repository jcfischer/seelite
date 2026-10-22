# Node #875 — variants and NPC loadouts

Implementation for checkpoint `cp-seelite-variants-loadouts`. Graph review and
the principal's merge remain with the supervisor.

- C1: Per-kind single benefit/cost identities project from base catalogue rows.
  Derelict fittings roll independently at probability 1/3. A 12,000-seed test
  checks the frequency, determinism and unchanged cargo draws.
- C2: Raiders and armed traffic use valid, instance-seeded catalogue fits.
  Combat reads fitted weapon rates, defence, bank and module mass; kills price
  the actual target fit. Scans and manifest drops read the fitted hold. The
  eject warning retains its reaction window against stronger active guns.
- C3: An independent 15% draw drops at most one actual fitted module, preserving
  its grade, trait and remaining ammunition. Existing canister flight and scoop
  rules recover it whole as a zero-cost fitting. Death-wreck and save tests
  preserve the exact trait. Equipment names carried and installed variants.
- C4: Verification refreshed on 2026-10-22: typecheck, build, formatting,
  Biome lint and ESLint pass. The six focused headless files passed 109 tests.
  All nine affected hardware browser probes pass. The variants/loadouts probe
  passes 12 checks, including a live launch, kill, scoop and save that retain
  a precise rack's trait and seven remaining missiles after one launch.

The single full host `npm test` run returned **6,765 pass, 5 fail** across
397 files (1,755.23 s). RTK discarded the failure details and created no
recovery log; the complete failure list and baseline equivalence of all five
failures remain unproven. This is not a full-suite pass.

Follow-up checks captured raw output before filtering:

- The remaining 16 affected combat, salvage, save, commerce and ladder test
  files pass all 302 tests, in addition to the first six files' 109 passes.
- A 12-file feature/selection/lint recheck returned 181 pass and one timeout.
- A six-file infrastructure recheck returned 158 pass and the same timeout:
  `production contract ownership > a measurement script no probe loads selects
  smoke, not the suite` in `tests/probe-impact.test.ts`, exceeding 5,000 ms.
- An isolated archive of untouched merge base `2dd890e` reproduces that timeout:
  16 pass, one fail across the 17 tests in `tests/probe-impact.test.ts`, with
  the failing test taking 8,181.21 ms. Its limit and implementation are unchanged.

The supervisor's full host comparison remains required. Capture its raw output
to a writable temporary file before any RTK filtering so all failures remain
identifiable. Do not attribute the other full-suite failures to the baseline
without that comparison.

The comment-baseline guard in `npm run lint:comments` reports inherited drift
against `origin/main` at `64f807d`: `scripts/probe-planet-footprint.mjs` has
15 suppressions against 14, and `src/authored-hull.ts` has 33 against 27.
Neither file nor `eslint-suppressions.json` differs from this branch's merge
base, `2dd890e`. Direct `npx eslint .` passes. No suppression was added.

Browser selection expands to all probes because this change reaches shared
Game/runtime code. The ranger worker contract reserves that full run for the
supervisor. Local browser runs cover `variants-loadouts`, `missiles`,
`outfitting`, `derelict`, `death-wreck`, `death`, `traffic-engagement`,
`duel-hud` and `public-site`, using ANGLE Metal on Apple M1 Pro. These are
manually scoped checks, not a repository-selected PR gate or a full-suite pass.

The paid shipyard trait-refit service is outside this implementation.

The public changelog sentence is proposed copy. The supervisor retains the
principal's copy approval and the final main-branch date before merge.
