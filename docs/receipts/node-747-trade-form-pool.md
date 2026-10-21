# Node #747 — trade stations draw Coriolis, Ring, Drum and Assembly

The trade pool is `[a, b, c, d]`, uniformly drawn in form-id order by the
unchanged `stationForms` mechanism. The Wheel remains outside this pool.
The outpost and the other roles' pools are unchanged. No docking geometry,
aperture, berth catalogue, carrier identity or generator version changes.

## Implementation

- Ring: a bay-sized, painted hub carries its mouth on the existing trade
  plane. Its rim, brace, spokes, hub and face masts have a written proxy.
- Drum: the forward cap and mouth move 100 m onto the existing plane, with
  approach-facing windows. Its sliced proxy stays inside the existing reach.
- Assembly: the proxy reads `modularPlacements(assemblySeed)` cell by cell.
  The hub spins; static cells clear the swept bay. Its hub clutter now turns
  with the hub. Industrial service rails and tip masts sit on the planted
  static spine.
- The missing-proxy guard still refuses trade `e`, including a generated
  station carrying that form. Proxy thinnest figures are pinned per form.

The historical avoidance control stays on Coriolis rather than moving its
threshold when pooling changes the solid and the reach-derived placement.
Every trade form also flies the original four systems and three bearings
under assist-on, assist-off and cruise, with blind impact controls and no
avoided contacts. No production avoidance law changes.

## View impact for the PR body

Measured with `bun scripts/measure-station-forms.ts trade=a,b,c,d` before
growing the pool; repeat on this branch with `trade=a` to print the reverse
comparison. **11 of 17 station-framing views change**, all on seed 47 from
Coriolis to Assembly:

`cockpit-arrival`, `cockpit-backlit`, `station-approach`, `station-flank`,
`station-range`, `station-horizon`, `berth-arrival`, `berth-arrival-cabin`,
`berth-docked-forward`, `berth-free-look`, `berth-launch-chase`.

World seed 47, all eight galaxies, 2,048 trade stations: Coriolis 477
(23.3%), Ring 524 (25.6%), Drum 519 (25.3%), Assembly 528 (25.8%). The
instrument names 56 other views whose incidental station content or
workbench framing it cannot assess.

The candidate sheet, canonical before/after capture and principal visual
sign-off are waived by node #744's ruling. No new visual approval is claimed.
This is a major player-visible change: `src/changelog.ts` contains a proposed
sentence for the principal to approve before merge.

## Verification

The pool, deterministic draw, reachability, uniformity, refusal and cache rows
pass. Existing per-form mesh, interior, proxy, finish, light and glow rows
cover the new members without wider tolerances. The new Assembly regression
rejects a mutant proxy forced to read seed zero.

Browser selection was inspected before running probes. A diagnostic path
selection with intent selected 44 of 105 contracts. The worker contract
restricts this lane to affected probes; the supervisor owns the final full
browser acceptance run. Local coverage uses `probe-collision`,
`probe-dock-arrival`, `probe-docking`, `probe-station-mouth`,
`probe-station-visuals` and `probe-station`, serially on the GPU lane.
The docking probe adds generated trade a/b/c/d at world seeds 3/5/21/1
(start systems 24/95/147/90), docking, launching and flying away with no
impacts through Game's protocol. This exceeds the two-system requirement.

The sandbox aborted Chromium before a probe ran; the scoped run was retried
outside the sandbox. This selected coverage is not a full-suite claim.

GPU renderer: ANGLE Metal, Apple M1 Pro. Five probes passed:
collision 28/28, dock-arrival 32/32, docking 71/71 (including all four trade
forms), station-mouth 7/7, station-visuals 44/44. `probe-station` is 32/33:
its unchanged seed-54 Coriolis at 60 km draws 15 silhouette pixels against
the existing `>20` floor. It failed on the same row in the scoped run and alone,
then **also failed 32/33 on an archived copy of base commit
`099e9af3ee19927029743932ad0efe3f364fad9a`**, on the same host and GPU lane.
The base drew 16 pixels against the same `>20` floor. The archive used that
commit's source and unchanged local bundle assets.
This inherited failure is reported, with no threshold change or quarantine.

The required single full `npm test` run completed with **6,366 pass, 1 fail**
across 363 files. Its sole failure was a Coriolis-install fixture that assumed
seed 42/system 0 still drew trade `a`; pooling changes that draw. The test
now uses generated system 4 at the same world seed and explicitly asserts
form `a` before exercising the installed builder. The affected file was rerun
after that fixture correction: **6 pass, 0 fail**. The full suite was not repeated, per the worker
contract. The supervisor owns the fresh full-suite result on the committed head.

Typecheck, production build, format and lint gates passed. No production code
changed afterward; subsequent changes are prose and the test fixture above.

## Probe repair pass (2026-10-18)

At `e2248588`, the two reported blockers reproduce alone on the GPU lane
(ANGLE Metal, Apple M1 Pro): light-rig 11/12, model-download 23/24.
Pooling changed both probes' subjects, rather than the lighting or boot law:

- Seed 47 now draws Assembly. At eight silhouette radii its sparse structure
  contributes only 354–366 mask pixels, below light-rig's existing `>500`
  sampling floor. Four radii gives 1,290–1,434 pixels and 12/12 checks. The
  captured frame was opened to check the framing. Every assertion and threshold
  is unchanged. Deliberately reflecting the bake or uploading its rows upside
  down still fails the orientation check (11/12 for each); both temporary
  production edits were restored, then the original probe rerun.
- Seed 42 now draws Assembly too, so its procedural exterior needs no GLB and
  only the cockpit blocks boot. The download race's `heldFirst >= 2` therefore
  fails with one held model. Boot/download arms now use generated Coriolis
  seed 3, restoring two actual held boot models and 24/24 checks. Background
  hull/Traffic arms keep seed 42. A headless fixture row reads the probe's boot
  seed and checks `bootModelIds(makeWorld(seed).system, null)`; it fails at
  seed 42 and passes at seed 3.

The additional `probe-station` 60 km failure is inherited. It was reproduced
on this branch (15 pixels, 32/33) and on an archived copy of merge base
`d95332acb5a20d3704a91823e95d20a91422023f` (16 pixels, 32/33), on the same
host/GPU lane. Its `>20` floor is unchanged. The other five station probes
selected by the runner's `probe-station` substring filter passed. These are
scoped runs, not a full browser-suite pass. No production code changes ship
in this repair.

Repair validation: 99 affected headless tests pass; typecheck, format and lint
pass. The required single full `npm test` run passes **6,488 tests, 0 failures**
across 375 files (697.84 s).
