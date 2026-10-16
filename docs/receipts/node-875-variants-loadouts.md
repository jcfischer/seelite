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
- C4: Typecheck/build, formatting, lint and all eight affected hardware browser
  probes pass. The single full `npm test` run returned 6,379 pass and one
  failure: `a schema 9 save with a partially stripped derelict loads its world
  remainder` in `tests/derelict-cockpit.test.ts`. That fixture generated current
  typed fittings and relabelled the envelope as schema 9, which correctly
  refuses those later fields. The fixture now freezes schema 9's untyped
  contents; the strict parser is unchanged. The corrected test and its related
  suites pass (67 tests). The full suite is not repeated, per the worker SOP;
  the supervisor's full run remains authoritative.

Browser selection expands to all probes because this change reaches shared
Game/runtime code. The ranger worker contract reserves that full run for the
supervisor. Local browser runs cover `variants-loadouts`, `missiles`,
`outfitting`, `derelict`, `death-wreck`, `death`, `traffic-engagement` and
`duel-hud`, using ANGLE Metal on Apple M1 Pro. These are manually scoped checks,
not a repository-selected PR gate or a full-suite pass.

The paid shipyard trait-refit service is outside this implementation.
