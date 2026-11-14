# #975: probe-output-stage's lit-pixel disagreement red

## Verdict

**The fixture measurement is invalid. Multisample coverage has not regressed.**

The red check is *"and it changes the edges without changing what is drawn"*,
which requires `disagreement(4x, 0x) < 1%`. Its statistic is the share of pixels
whose `luma > 8` classification differs between the two arms. That share
measures the length of luma-8 contours in the frame, not coverage. Two
merges changed the subject, and the figure moved from 0.47% to 1.20%:

1. **#791** (`294b5c6`): the weathered Coriolis replaced trade-A.
2. **#887 / PR #898** (`166cef4`): the perimeter frame lamps and the lighter
   cabin.

Neither merge touched the output stage. `src/output-stage.ts` changed only in
comments between `9d268cb` and HEAD (`git diff 9d268cb HEAD -- src/output-stage.ts`
leaves no code lines once comments are filtered).

Fault injection shows the statistic is unsound in both directions:
- **It is red on a correct pair at HEAD.**
- **On older builds it was green with a whole layer missing.** At `9d268cb` a
  4x frame with the backdrop removed read 0.955%, under the 1% bound. At
  `53be4f7` a 4x frame with the near layer (the station) removed read 0.478%,
  against 0.463% for the correct pair.

So moving the 1% would not repair it. The repair is to replace the statistic;
it is proposed below and measured on six builds. I have not applied it: this is
a research branch, and the push may touch only this file. **The assertion and
the quarantine entry are unchanged.**

## Condition (every figure below)

- **Hardware:** Apple M1 Pro, `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`.
- **Lane:** GPU (`SEELITE_PROBE_RENDERER=hardware`), launched through HEAD's
  `launchChromium`.
- **Fixture:** the probe's own. 1440x900, seed 47, `__startClockAt(0)`,
  `__viewAlongAxis("station-trade", 5 radii, { comoving: true })`, cockpit view.
- **Arms:** the probe's. `setComposerSamples(4)`, then `render(0)`, then a read;
  then `setComposerSamples(0)`, then `render(0)`, then a read. All in one
  `evaluate` task, with 1:1 readback through a 2D canvas, and
  `luma = 0.2126R + 0.7152G + 0.0722B`.
- **Harness:** `/tmp/diag975/diag.mjs`, not committed because the branch admits
  only this file. It boots each tree's own vite config in-process, and checks
  the tree through `/__seelite/tree` (every run printed the expected root and
  head). It uses each tree's own `installViewPlacement` and `bootedGame`.
- **Runs:** each build was measured in a single run. Arms repeat bit for bit
  (see "Coverage itself"), so a second run reproduces the figure.
- **Load:** node-979's `probe-all` held `/tmp/seelite-probe.lock` for part of
  the session. Nothing here is a timing, and pixel counts do not depend on load.
- **Images:** for each build, under `/tmp/diag975/out/<sha>/`:
  - `on.png` and `off.png`: the two arms.
  - `disagree.png`: yellow marks a disagreeing pixel within 2 px of a ≥40-level
    step, magenta marks one farther from such a step.
  - `absdiff.png`: |Δluma| × 8.

**The harness reproduces the probe:**

| Build | Probe log | Harness |
|---|---|---|
| `82acce7` | 1.21% (`/tmp/seelite-685-output-baseline.log`) | 1.211% |
| HEAD `c73aa28` (nebula on main) | 1.22% (`/tmp/seelite-685-output-rerun.log`, nebula branch) | 1.197–1.203% across five runs |

## Bisect (first-parent, `9d268cb`..`82acce7`, 209 commits)

`9d268cb` is #435, where the GPU lane became the default. Before it, the probe
ran on SwiftShader, and its prose still says so.

| Commit | What | disagree@8 (4x vs 0x) |
|---|---|---|
| `9d268cb` | #435 GPU lane | 0.541% |
| `53be4f7` | parent of #791 | 0.463–0.473% |
| `294b5c6` | **#791 weathered Coriolis** | **0.840%** |
| `91976cc` | (line 25 of 50) | 0.813% |
| `8aa6ec0` | parent of #898 | 0.812–0.821% |
| `166cef4` | **#898 / #887 lamps + lighter cabin** | **1.204–1.208%** |
| `1b76a0f`, `3150d31` | later | 1.200–1.207% |
| `82acce7` | node's "pre-nebula main" | 1.211% |
| `c73aa28` | HEAD | 1.197–1.203% |

**The two steps:**
- **#791: +0.37 points**, all of it in rows 2–3 of six (the station's rows).
  - Disagreeing pixels in those rows went from 327 to 5,085.
  - In `294b5c6/disagree.png` the authored Coriolis is a lattice of yellow,
    edge-adjacent disagreement: its dense panel detail is luma-8 contour.
  - The procedural trade-A at `53be4f7` is nearly clean.
- **#887: +0.38 points**, in the cabin.
  - The share of the frame whose value changes at all between the arms went
    from 6.25% to 23.5%.
  - In `166cef4/disagree.png` the new magenta bands sit on the console glass
    and the cabin's dark faces, where luma sits near 8 and the lamps' bloom halo
    moves them across it.

The nebula (#685) does not move the figure: 1.211% at `82acce7` against 1.203%
at HEAD.

## What the 1.2% is made of, at HEAD

| Pair (HEAD) | disagree@8 | share within 2 px of an edge | frame changed at all |
|---|---|---|---|
| 4x vs 0x | 1.203% | 50.4% | 23.8% |
| 4x vs 4x, repeated | 0.000% | n/a | 0.00% |
| 0x vs 0x, repeated | 0.000% | n/a | 0.00% |
| 4x vs 0x, dither off | 1.202% | 49.1% | 23.4% |
| 4x vs 0x, bloom off in both arms | 0.981% | 70.3% | 4.75% |
| 4x vs 0x, #887 perimeter lamps hidden in both arms | 0.968% | 62.7% | 6.05% |
| 4x vs 0x, cabin hemisphere back at the rig's 1.0 | 1.189% | 51.0% | 23.8% |

- **Every disagreeing pixel is a threshold straddler.** In both arms its lower
  value is under 12 levels (histogram in bins of 4: 3,869 / 11,407 / 237 / 0…).
- **The dither plays no part.** It is spatially fixed and identical in both
  arms.
- **#887's increment is mostly its six perimeter lamps** (−0.23 points with
  them hidden). The lamps feed bloom, and bloom spreads the antialiased
  highlight edges into low-luma halos across the cabin.
- **The cabin hemisphere gain is −0.02 points.**
- **Neither variant is a fix.** Bloom off reads 0.98% and lamps off 0.97%, both
  a hair under the bound. Both would also change what ships, and this node
  authorizes no change to appearance.

## Coverage itself is intact

- **The arms are deterministic.** 4x against 4x and 0x against 0x repeat bit for
  bit, so the red is not noise.
- **The allocation is right.** The probe's own rows pass: predicted 4,
  allocated [4,4], RGBA16F supports [2,4]. Intermediates rise from 9,124 to
  15,643 between 0x and 4x.
- **Nothing drawn went missing.**
  - Lit share: 80.57% against 80.50% (Δ0.06%).
  - Disagreeing pixels whose whole 3x3 neighbourhood also disagrees: 0.0095% of
    the frame. These are contours, not regions.
  - No 16x16 tile moves its lit share by more than half (largest 0.40).
- **The direction rules out a regression.** A coverage regression would *lower*
  the disagreement. The rise comes from more edge contour and more bloom on the
  subject, not from the multisample path.

## Fault injection: can the statistic tell correct AA from a lost layer?

Each fault is applied to the 4x arm only. The 0x arm stays clean. The faults:
- **lost backdrop:** `backdropScene.background = null` and the scene hidden.
- **lost near layer:** `nearScene.visible = false`, which removes the station.
- **lost cabin:** `cabinScene.visible = false`.
- **lost far layer:** `farScene.visible = false`.

"solidΔ>16" is the share of pixels whose |Δluma| exceeds 16 across their whole
3x3 neighbourhood.

| Build | Pair | disagree@8 (shipped) | solidΔ>16 (proposed) |
|---|---|---|---|
| `9d268cb` | correct | 0.541% | 0.0000% |
| `9d268cb` | lost backdrop | **0.955% (green: missed)** | 0.1953% |
| `9d268cb` | lost near layer (cabin was in it then) | 22.47% | 16.72% |
| `53be4f7` | correct | 0.463% | 0.0000% |
| `53be4f7` | lost near layer | **0.478% (green: missed)** | 3.4505% |
| `53be4f7` | lost backdrop / lost cabin | 62.66% / 15.20% | 31.73% / 9.17% |
| `294b5c6` | correct / lost near / lost backdrop | 0.840% / 2.419% / 62.78% | 0.0001% / 0.6189% / 31.67% |
| `8aa6ec0` | correct / lost near / lost backdrop | 0.812% / 2.475% / 49.63% | 0.0001% / 0.6318% / 22.67% |
| `166cef4` | correct / lost near / lost backdrop | 1.208% / 2.393% / 49.27% | 0.0306% / 0.6559% / 31.47% |
| `82acce7` | correct / lost near / lost backdrop | 1.208% / 2.395% / 49.27% | 0.0306% / 0.6592% / 31.47% |
| HEAD | correct | **1.203% (red)** | 0.0306% |
| HEAD | lost near / lost backdrop / lost cabin | 2.402% / 49.27% / 18.67% | 0.6539% / 1.2650% / 12.81% |

- **The shipped statistic has no margin either way.**
  - At HEAD a lost station reads only 2× the correct pair.
  - On two older builds it read *below* the bound with a layer gone.
- **solidΔ>16 separates every case.**
  - Correct pairs: 0.0000–0.0306% on all six builds. The 0.0306% from #887 on
    is bloom; it is 0.0001% with bloom off.
  - Visible-layer faults: 0.195–31.7%. The smallest is the historical
    `9d268cb` backdrop; the smallest at HEAD is the lost station at 0.654%.
  - The dither does not move it (0.0305% with dither off). By contrast, the
    thresholded "solid disagreement" variant rose from 0.0095% to 0.1255%,
    because a flat region sitting at luma 8 flips whole without the dither.
- **I swept Δ only at 16 and 32.** Δ>32 fails, missing HEAD's lost backdrop
  (0.0109%), so 16 is the choice.
- **A lost far layer is invisible to every statistic at this framing.** Nothing
  in the far layer is on screen at 5 radii from the trade station.

  The prose's worry, "a way to lose the far layer that only bites with
  antialiasing on", is therefore not evidenced by this check under any
  statistic. The planet-framed row ("the backdrop is still there when the frame
  is multisampled") is the one that could carry it. Its subject is the
  backdrop, not the far layer. I did not measure that row.

## Repair proposal (not applied)

Options considered:

- **O1, recommended: replace the statistic and keep the intent.**
  1. Assert `solidΔ>16(4x, 0x) < 0.1%` of the frame (1,296 px at 1440x900),
     where solidΔ>16 is the share of pixels whose |Δluma| exceeds 16 across
     the full 3x3 neighbourhood.

     Margins at HEAD: 3.3× above the worst correct pair (0.0306%) and 6.5×
     below the smallest visible-layer fault (0.654%). On the historical
     `9d268cb` backdrop fault (0.195%) the margin below is 2×.
  2. Add the defect as a row, so the check proves it can fail. Render the 4x
     arm once with `nearScene.visible = false`, assert the same statistic
     exceeds the bound, and print both figures.

     That follows the map's rule: build the defect a check names and watch it
     go red (#11, #30).
  3. Keep `disagreement@8` printed as a diagnostic beside it, not gated.
  4. Rewrite the prose that the measurement falsified:
     - "Antialiasing itself moves only edge pixels, so a correct pair disagrees
       on a fraction of a percent". With bloom on, 49.6% of HEAD's disagreeing
       pixels are more than 2 px from any step of 40 levels or more.
     - The "SwiftShader, said plainly" section. The probe has run on the GPU
       lane since #435.
  5. Lift the `probe-output-stage.mjs` entry from
     `scripts/lib/probe-quarantine.mjs`. That is the last step, after the new
     row is green.

  Headless, a test can hold the statistic's arithmetic on synthetic buffers:
  - a 1-px contour of large Δ gives 0;
  - a 3x3 block of large Δ counts;
  - a wide Δ≤16 shift gives 0.
- **O2, rejected: widen the 1% bound.** A bound that crosses HEAD's 1.20% with
  any margin (≥1.5%) sits within 0.9 points of HEAD's lost-station 2.40%. It
  still never saw the faults it missed on `9d268cb` and `53be4f7`. That is a
  weakened gate wherever it lands (the #435/#294 rule).
- **O3, rejected: measure with bloom off, or lamps off.** That changes what is
  measured away from what ships. It is also still marginal (0.97–0.98%), and
  appearance changes are out of scope.
- **O4, rejected: re-frame onto a sparser subject.** It moves the fixture to
  dodge the subject, and the next authored model would re-open the problem. The
  statistic is what is wrong, not the framing.

Ownership: O1 is a probe-only change. It touches `scripts/probe-output-stage.mjs`,
`scripts/lib/probe-quarantine.mjs` and, optionally, a headless test.
`probe:select` should pick those probes plus smoke. Its gate is that probe green
on the GPU lane with the injected-fault row red-as-required, plus the headless
test.

## Not settled here

- **The real probe file at HEAD, run directly on the GPU lane with the lock
  free:** 13/14 checks passed. The one red is the same check:
  `1.19% of pixels disagree about being lit between 4 samples and 0 (80.49% lit
  against 80.44%)`. Intermediates went from 9,108 to 15,650.

  Before that, three direct runs timed out in `bootedGame`'s 20 s wait
  (`scripts/probe-output-stage.mjs:158`):
  - one on a cold vite server;
  - at least one beside node-979's `probe-all`, which held the lock.

  The boot now also waits for `nebulaPending`. This is unattributed and not
  this node's subject, but whoever lands O1 should run the probe with the
  lock free.
- The attribution of #887's increment beyond the lamps (about 0.13 points) to
  the hull-paint and interior-kit changes in the same merge is not measured.
