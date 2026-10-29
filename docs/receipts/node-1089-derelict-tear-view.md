# Node #1089: the canonical torn wreck fixture

Refs #1089. The checkpoint is `cp-derelict-tear-view`. The principal's visual
approval and merge remain pending; this receipt does not supply that approval.

## Cause

`0627b8140888c70cca6222670c407f2181f1e5f4` (node #813, Porter integration)
made the view fail. Its parent can select the procedural freighter in seed 47's
start system, 248. That commit makes the freighter authored and adds the
`slots.find(tearable)` fallback, but the other slot holds a courier that is
already authored. Neither candidate passes `isAuthoredHullModel`'s inverse.
The commit's claim that the courier fallback was tearable was incorrect.

Headless checks executed each revision's own modules from isolated source
snapshots made with `git archive`, without checking out another branch. Each
check built `makeWorld(SEED)`, enumerated `derelictSlots`, evaluated
`derelictNextLossAt(system.record.seed, key) + 1`, read the ordinal from
`derelictTimeline`, and passed it to `derelictPose`. Tearability was read from
that revision's `isAuthoredHullModel`, the predicate the placer uses.

| Revision | Slot 00 | Slot 01 | Tearable candidates |
| --- | --- | --- | --- |
| `0627b814^` | freighter, procedural | courier, authored | 1 |
| `0627b814` | freighter, authored | courier, authored | 0 |
| `c3a9bd19^` | freighter, authored | courier, authored | 0 |
| `c3a9bd19` (node #875) | freighter, authored | courier, authored | 0 |
| `db046132` (implementation base) | freighter, authored | courier, authored | 0 |

All five checks read ordinal 0 for both slots, at 386297.2543988052 s for
`248:derelict-00` and 301414.009878471 s for `248:derelict-01`. Node #875
changes neither choice nor its loss time; it did not introduce this failure.

## Repair and regression guard

Only `derelict-tear` declares `seed: 4`; the ordinary `derelict` view keeps
seed 47. Seed 4 starts in system 206, whose next-loss slot
`206:derelict-00` holds a procedural explorer. The existing placer still
selects and frames a natural next-loss wreck. Simulation, hull selection and
the placer are unchanged. The caption names the exceptional seed.

`tests/derelict-view-fixture.test.ts` reads the actual view declaration,
constructs its world and applies the placer's reset, then follows the next-loss
slot choice. It requires a procedural candidate and builds that candidate's
production derelict mesh, asserting nonempty tear sites and exposed frame
members. A future authored replacement or loss of procedural tear geometry
therefore fails the test. It does not claim to judge the frame's appearance.

The test was committed red before the fixture change:

```text
error: expect(received).toBeDefined()
Received: undefined
0 pass
1 fail
```

After the initial seed-1 fixture change, the focused run covering the fixture, view-set
contracts and tear geometry passes: 72 tests, 0 failures. Typecheck,
format check and script lint pass.

## Visual evidence

Both captures use the guarded dev server for this worktree at
`http://127.0.0.1:5189`. The renderer reads
`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`.
An initial sandboxed Chromium launch was refused by macOS; native access
allowed the same capture command to launch. Runs respected the machine-wide
probe lock and ran serially.

With `scripts/lib/view-set.mjs` temporarily restored byte-for-byte from
`db046132`, the hardware reproduction was:

```sh
PROBE_ORIGIN=http://127.0.0.1:5189 SEELITE_PROBE_RENDERER=hardware \
  npm run views -- --only derelict,derelict-tear --label before \
  --out /tmp/seelite-node-1089-before
```

```text
derelict             cockpit  freighter · 248:derelict-00
page.evaluate: Error: no derelict slot whose wreck the tear can cut
```

The run exited 1 and built no sheet. Its ordinary derelict PNG is under
`/tmp/seelite-node-1089-before/before/derelict.png`. A before tear frame does
not exist, because its placement throws. The repaired declaration was then
restored for the full run:

```sh
PROBE_ORIGIN=http://127.0.0.1:5189 SEELITE_PROBE_RENDERER=hardware \
  npm run views -- --label after --out /tmp/seelite-node-1089-after
```

The first full repaired run captured 47 views, including `derelict-tear`
(`interceptor`, `90:derelict-00`, `interceptor-fuselage`), then timed out in
`bootedGame` on the opening placer's navigation. An isolated rerun timed out
at its initial boot. A diagnostic screenshot showed "Loading game… 99%" and
no game handle. The host load average read 92.03; this is context, not an
attribution. No boot timeout or other threshold was changed.

With the original view declaration restored, the same boot diagnostic and
`npm run views -- --only opening-forming` then passed; the latter built
`/tmp/seelite-node-1089-base-opening/index.html`. The boot timeout is
intermittent. The repaired declaration was restored for a second full run,
labelled `after-retry`, under `/tmp/seelite-node-1089-after-retry`.

The second full run, with the initial seed-1 repair, exited 0: all 80 canonical views captured and the full
sheet built at `/tmp/seelite-node-1089-after-retry/index.html`. The manifest
and sheet label the source `e0fc4519-dirty`, the tested implementation before
its final commit. Only comments and this receipt changed after capture began.
The tear row reports `interceptor`, `90:derelict-00`,
`interceptor-fuselage`. The full-size PNG was opened and shows missing skin
and exposed frame members:
`/tmp/seelite-node-1089-after-retry/after-retry/derelict-tear.png`.
The principal's visual yes is still pending.

## Delivery

This is an internal capture-fixture repair, outside the major-change definition
in `src/changelog.ts`; no public changelog entry is needed. The worker commits
on its assigned branch. The supervisor owns push, PR, Sage and final browser
gates; the principal owns the visual yes and merge.

Browser selection was inspected before captures. The diagnostic selector
classifies `scripts/lib/view-set.mjs` as shared harness infrastructure and
selects all 114 probes. The worker's explicit scope forbids a full probe suite;
only the canonical captures are run here. This receipt does not claim a
`probe:pr` pass. The final selected browser gate belongs to the supervisor.

## Resumed validation, 2026-10-29

The five historical slot checks were rerun and reproduced the cause table
above. The saved hardware manifest still names this worktree and all 80 PNGs
exist. The current `contactSheet` accepts that manifest as complete. The tear
PNG was opened again and shows missing skin with exposed framing.

Before the final commit, a comparison with newer `origin/main` showed that
its model catalog also makes the interceptor authored. Seed 1 has only that
one slot, so the initial repair would fail again when brought forward. The
final fixture uses seed 4's explorer, which remains procedural in both catalogs.
Its focused fixture and view-set checks pass (50 tests). The interrupted full
unit run was stopped before restarting validation of this final fixture.

The final hardware capture exited 0 with all 80 views and built
`/tmp/seelite-node-1089-final/index.html`. Its manifest identifies this
worktree, ref `e0fc4519-dirty`, and the M1 Pro ANGLE Metal renderer. The tear
row reads `explorer`, `206:derelict-00`, `explorer-port-nacelle` at
146182.16035260938 s. The PNG was opened and shows the nacelle's missing skin
and exposed frame. The final manifest has no missing images and the current
`contactSheet` accepts it. Principal approval remains pending.

The capture ran `node scripts/capture-views.mjs --label after-final --out
/tmp/seelite-node-1089-final`, the command behind `npm run views`, with
`PROBE_ORIGIN=http://127.0.0.1:5189` and
`SEELITE_PROBE_RENDERER=hardware`. Its wrapper started Vite for this worktree
and stopped that server after capture.

The regression test now uses type narrowing instead of casts and non-null
assertions. Typecheck, formatting, script lint, launcher wiring and the
production build pass on this host.

The default `npm run lint:comments` fails against the newer `origin/main`.
The supplied base `db046132` produces the same five increased counts:
`scripts/lib/rock-mesh-distance.ts`, `scripts/probe-model-queue.mjs`,
`src/music-voices.ts`, `src/station-proxy.ts` and
`tests/music-director.test.ts`. These paths are unchanged by this repair.
`grownSuppressions` reports no increase from `db046132` to this worktree,
and `LINT_BASE_REF=db046132 npm run lint:comments` passes.

### Final host unit result

The final `npm test` exited 1: **6,960 pass, 20 fail**, across 413 files.
Every failure is an elapsed-time limit. The new tear-fixture test and the
view-set tests pass within this run. The log is
`/tmp/seelite-1089-final-test.log`. No timeout or assertion was changed.

All eleven failed test files are byte-identical to `db046132`, verified with
`git diff db046132 -- <failed paths>`. The run's timeout cases are:

| Test file | Timed-out test |
| --- | --- |
| `probe-impact.test.ts` | a measurement script no probe loads selects smoke, not the suite |
| `exact-amount.test.ts` | bit-pattern corpus spans every finite exponent and both signs |
| `collision-stations.test.ts` | refinery/d: reverse escapes unbilled in at most five ticks; inward can strike from inside |
| `collision-traffic.test.ts` | the boundaries are §12.3's: the launch ends with the centre outside the plane, the arrival starts at the lane's grant |
| `collision-traffic.test.ts` | RED, pinned: system 0's launches touch at the release point, under V_SCRAPE |
| `authored-hull-install.test.ts` | shipped hulls publish ray-free builds with the measured throats under every finish |
| `hull-docking.test.ts` | interceptor at a refinery |
| `hull-docking.test.ts` | the spread is D5's and nothing else's |
| `station-traffic.test.ts` | parked duty stays in-band and full occupancy exposes a departure within 60 s |
| `course-cue.test.ts` | the longest route over the sampled seeds fits the two digits the row prints |
| `ship-finish.test.ts` | a ray along every ring's axis passes through it, under every finish |
| `asteroid-field.test.ts` | the field fingerprint is pinned per galaxy |
| `station-route.test.ts` | every visible moving phase carries a continuous complete attitude |
| `station-route.test.ts` | station-zone legs stay slow, clear the bubble, and visibly dwell |
| `station-route.test.ts` | a completed player clearance still delays a direct historical replay |
| `station-route.test.ts` | an older incompatible player request does not block a fitting Carrier |
| `station-route.test.ts` | shared lane arbitration honors ready time instead of privileging the player |
| `station-route.test.ts` | a committed lane traversal cannot retroactively block its own Carrier |
| `station-route.test.ts` | a physical visit keeps its granted berth when current occupancy is replayed |
| `station-route.test.ts` | the actor returns physically and requests any fitting home berth |

A source snapshot of `db046132`, with the same host dependencies, ran
`bun test tests/probe-impact.test.ts tests/exact-amount.test.ts` after the full
run finished. It reported **38 pass, 1 fail**. The same measurement-script
ownership test timed out at 11,743.46 ms against 5,000 ms; the exact-amount
corpus passed in isolation. Its log is `/tmp/seelite-1089-base-tests.log`.
The remaining full-run timeouts were not replayed at the base by this worker;
the supervisor owns the full base comparison under the worker SOP.

During the full run, a host snapshot reported load averages
71.59 / 83.56 / 67.32. That reading is context rather than proof of a cause.
The probe-impact timeout also has a separate repair on newer main:
`2d9380d8` (node #1128). No unrelated repair is included here.
