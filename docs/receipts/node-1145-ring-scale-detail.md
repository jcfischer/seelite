# Node #1145: Ring scale detail and shared station light

## Current result

Trade B carries the Ring detail from `fe4f682f`: nine rows of windows, three
lattice girders, sixteen rim masts, twenty-four front masts and eight navigation
beacons. Its approved geometry, authored material inputs and 0.75 km reach stay.
Seven separate `scale-detail` batches carry `minDetail: full`; reduced and
outline hide all seven. The original 102,164 triangles remain at those levels.
The station's gameplay strobes, lamp pools, bay and navigation fittings remain.

`src/station-light.ts` owns the directional gain 2, hemisphere gain 0.6 and
navigation gain 8 settled on [node #1142](https://github.com/jcfischer/seelite/issues/1142#issuecomment-6526047964).
The Coriolis, Ring, Drum, Assembly and Wheel exterior loaders use it. This follows
the [principal's ruling on #1145](https://github.com/jcfischer/seelite/issues/1145#issuecomment-6540509954):
all models receive the light treatment, including C and D. The global rig,
ships, cockpit and production interiors receive no new shader patch.
Missing or duplicate shader markers still throw. F22 stays accepted as on #1142.

Only materials named exactly `navigation-red` or `navigation-green` receive
the gain above the shared emissive ceiling. Ring beacons reach intensity 8;
both colours exceed the bloom threshold in linear luminance. Baseline lamps
normalise independently of those new beacons: amber stays at 1 and work floods
at 0.75, as on main. A failing-before test caught the initial implementation
dimming them by including the brighter new beacons in their divisor. The
correction changes no authored material input. Coriolis paint and exposure stay
as on main. Its beacons remain at 4.8; the equal gain of 8 on differently
authored lamp values is not an equal final intensity. The Ring's beacon
appearance remains part of the principal's pending visual acceptance.

The principal's acceptance of the visual result, frame cost, asset size and
proposed changelog sentence remains pending. Review and the final PR browser
gate belong to the supervisor. This receipt does not close the node.

## Review round 2 browser correction

The round 1 station-visuals result did not prove deferred Ring attachment.
The probe measured immediately after entering docking range, while the detail
download was still pending. An added mesh-count assertion fails on both Ring
viewports before the readiness wait: zero of seven meshes were attached, even
though all 92 older checks passed. The retained
[failing-before run](../../spikes/station-scale/evidence-ring/review2-before-wait.txt)
records that gap.

The existing station-visuals probe now waits for the production late-detail
readiness predicate after placement, refuses a load failure, and checks seven
attached meshes. It also checks all seven remain attached and only draw at
full detail. This runs through the game's `prepareTradeModel`, `GLTFLoader`
and `RING_DETAIL_GLB_URL`, without a test decoder or injected builder.
The hardware run passes
[100/100 checks](../../spikes/station-scale/evidence-ring/review2-probe-station-visuals.txt):
seven visible at full, zero visible at reduced and outline, in both viewports.
The Ring's accessory contribution is 5,265 pixels on desktop and 12,309 on
narrow. These are functional readings, not performance figures.

The [hull lighting run](../../spikes/station-scale/evidence-ring/review2-probe-light-rig.txt)
passes 12/12. Its painted-hull peak is 238.21, lower quartile 34.48 and median
51.70, within the existing bands. No threshold changed.

Trade now imports the Coriolis loader's `DETAIL_RETRY_MS`; the shipped-trade
helper names the deferred asset in `SHIPPED_TRADE_DETAIL_FILES` for both hashing
and installation. A shared loader state machine remains outside this correction:
the two loaders retain their different attachment and material rules.
Historical logs retain their original bytes. The glossary findings use
technical homonyms for navigation lamps, process APIs and execution records;
they do not name the fiction's Pirate relay, Traffic actor or Intervention.

Round 2's 115 affected headless tests pass. Typecheck, format, lint, comment
lint, wiring and build pass. The full host `npm test` ran once under Bun
1.4.2: **7,315 pass and one timeout**, across 446 files in 973.75 seconds.
It is not a green full-suite result. The
[reported failure](../../spikes/station-scale/evidence-ring/review2-full-timeout.txt)
is `station-zone legs stay slow, clear the bubble, and visibly dwell` in
`tests/station-route.test.ts`, at 5,528.35 ms against the default 5,000 ms.

That test file is byte-identical to main. With the same Bun 1.4.2 binary,
the [main file run](../../spikes/station-scale/evidence-ring/review2-base-station-route-bun142.txt)
and [branch file run](../../spikes/station-scale/evidence-ring/review2-branch-station-route-bun142.txt)
both report 31 pass and one timeout on `the actor returns physically and
requests any fitting home berth`, at 7,004.36 and 6,214.81 ms respectively.
The original station-zone case passes in those runs at 4,115.41 and 2,138.72 ms;
its exact full-suite timeout did not reproduce in isolation. The earlier
[Bun 1.4.3 main file run](../../spikes/station-scale/evidence-ring/review2-base-station-route-bun143.txt)
passes all 32, but uses a different binary from `npm test`. These results
record the timeout-sensitive file on both refs, without changing its tests,
simulation code or time limits. The supervisor retains the full-suite gate.

[Round 2 verification](../../spikes/station-scale/evidence-ring/review2-verification.json)
retains source and evidence hashes, the full-log hash, the single full-run
summary and the diagnostic results. Runtime and test sources did not change
during the full run. Principal acceptance remains pending.

## Review round 1 correction

The Ring now ships two files. The boot exterior is 5,875,120 bytes, the same
byte count as main. The 14,027,844-byte detail file carries the seven full-only
meshes and no image. It loads after boot when a Ring first leaves outline,
using the existing station late-detail request and readiness contract. A failed
download leaves the base visible, exposes the failure to capture readiness and
retries after ten seconds. Live stations receive the detail in their current
band; disposed stations receive nothing. Later stations reuse the shared asset.

The preparation step checks exact vertex attributes, triangle attributes,
material inputs and base texture pixels. An additional
[comparison with the reviewed combined asset](../../spikes/station-scale/evidence-ring/split-equivalence.json)
finds exact triangle attributes and material inputs across the two files.
The regenerated proxies have byte-identical packed hulls for B, C and E;
only B’s source fingerprint changes to cover both asset files. Ring stays at
8,985 authored hull boxes.

`station-light.ts` now owns the non-navigation exposure divisor and the
per-material ceiling and navigation gain. Trade, Assembly and Coriolis use
the same helper. A failing-before Assembly check measured a work lamp at 0.25
instead of 1 when a bright navigation material entered the divisor; it now
passes. The existing shipped Coriolis exposure and shader checks also pass.

The unapproved node #1145 entry was removed from `CHANGELOG`. Its proposed
sentence remains below for the principal to approve before the supervisor adds
an entry with the actual merge date. Both strike fixtures in the collision
instrument now require an impact. The missing historical probe logs are
included with the hashes already recorded in `verification.json`.

The spawn-and-await code remains local to the two study scripts. The glossary
findings refer to navigation lamps, shell commands and `child_process.spawn`,
not the fiction’s Pirate relay, Intervention or Traffic actor. Those technical
terms are retained. No principal acceptance is inferred from these corrections.

Round 1 headless checks pass: 84 tests in the four required trade/proxy files,
and 31 in Ring detail, Coriolis, Assembly and model URL files. Typecheck, format,
lint, comment lint, wiring and the production build pass. The build verifies
every emitted file is below 25 MiB. The complete outcomes are recorded in the round 1 verification section below.

## Asset and geometry

| Settled Ring exterior | Main | Base plus deferred detail |
| --- | ---: | ---: |
| Bytes | 5,875,120 | 5,875,120 + 14,027,844 |
| MiB | 5.60 | 5.60 + 13.38 |
| Triangles | 102,164 | 485,440 |
| Mesh primitives | 12 | 19 |
| Added triangles drawn below full | 0 | 0 |
| Authored proxy hull boxes | 3,503 | 8,985 |

The separate detail adds 383,276 triangles and seven draws at full. The base
GLB follows the existing home-exterior boot and after-boot model queue. The
detail file is outside that boot set, as on the Coriolis. Cold download and
installation latency were not measured in this node.
The production build's emitted-file guard passes the 25 MiB host limit.

The detail generator resets its own seed 1007 after building the approved Ring;
it consumes none of the approved parts' random draws. The shipping preparation
checks exact triangle, vertex-attribute and texture-pixel round trips through
Meshopt and lossless WebP. No simplification, quantisation or texture resize is
added. The Ring base GLB SHA-256 is
`829f7a30198f0a2488ea27688f901c1f95120c859fb1a09a7333f48282c780c2`;
the detail is `ab082d49de3b94ee62c9eeb76d226e160933b66640f0e6c3a0036cf351db013b`;
main's is `16e59c914e5c9e229636f839a15fff616b40b0b10fc16613cec4f530521e2a05`.

Rebuild from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python spikes/stations/build_model.py -- ring --flight
node spikes/stations/prepare-flight-asset.mjs ring
bun scripts/generate-trade-proxies.ts
```

Blender 5.2.2 crashed before running the script inside the session sandbox; the
same command completed on the host outside that sandbox. Tests run on the host.

## Frame-time receipt

The [post-split hardware run](../../spikes/station-scale/evidence-ring/review2-cost.json)
replaces the earlier combined-file timing table. It uses the current production
loading path and refuses to time the branch unless all seven added meshes are
attached and visible. Both framings record their names and triangle counts,
not just the readiness flag. The two asset hashes cover the base and deferred
files separately. Neither loading nor installation latency is timed.

The baseline is an archive of `origin/main` at `ec561ec5`.
[All 758 source, script and build-entry files match that ref](../../spikes/station-scale/evidence-ring/review2-baseline.json).
The study capture and readiness helper are then copied into the archive; no
runtime file changes. Both Vite servers declare their real roots and are
guarded independently. The branch is the working tree on `69395ee5`; its
recorded runtime hash matches the source committed by this correction.

Apple M1 Pro, macOS arm64, ten CPU cores; ANGLE Metal read back on both arms.
Seed 42, system 1, real trade B home station, 1440×900 at device scale 1,
quality high, render scale 100%, zero composer MSAA. Both framings read
`form: b`, `detail: full`, the requested range and zero off-axis angle.
The branch has seven visible added meshes, main zero.

The instrument holds the machine-wide probe lock throughout. This worker runs
no other job or Sage review alongside it. Host load starts at 9.78/7.53/8.60; one-minute
load readings during blocks range from 10.66 to 11.33. Each of twelve blocks
per arm renders 120 whole frames after ten warm-up renders, with a readPixels
drain before and after the timed block. Arm order is shuffled within each
pair, seed 1145. Automatic frame loops are cancelled and the clock is held;
simulation and loading are outside the timing.

| Framing | Main median; range (ms/frame) | Branch median; range | Median delta | Branch slower pairs |
| --- | --- | --- | ---: | ---: |
| Station approach, 2.25 km | 3.525; 3.403–3.706 | 3.499; 3.390–3.611 | −0.027 | 64/144 |
| Close chase, 1.028 km | 6.328; 6.168–7.107 | 6.980; 6.916–7.246 | +0.652 | 133/144 |

Submitted counts confirm actual rendering: approach 676 → 683 calls and
3,443,620 → 3,826,896 triangles; chase 1,634 → 1,655 calls and
10,509,690 → 11,659,518 triangles. No page, shader or WebGL errors were recorded.
The approach difference is inside run variation. The close-chase branch is
slower in 133 of 144 cross-arm comparisons; those are 12×12 comparisons,
not 144 independent matched observations. This is saturated render throughput
through Vite, not player frame latency or an FPS promise. The CPU/GPU limiter
is not isolated, so these figures establish no general performance bound.
Reduced/outline retain the geometry and draw counts, without an elapsed-time
claim for their changed lighting.

The [first post-split run](../../spikes/station-scale/evidence-ring/review2-cost-headed-unset.json)
also read ANGLE Metal on both pages, but its launch environment omitted the
hardware flag. Its approach delta is +0.402 ms/frame and chase +0.678;
the approach result changes with the run, while both show a chase cost.
It is retained separately and is not the table above.
The [combined-file run](../../spikes/station-scale/evidence-ring/cost.json)
and [pre-normalisation run](../../spikes/station-scale/evidence-ring/cost-before-lamp-normalisation.json)
remain historical evidence. Acceptance of the cost and asset size remains
the principal's decision.

```sh
SEELITE_PROBE_RENDERER=hardware node spikes/station-scale/measure-ring.mjs /path/to/main spikes/station-scale/evidence-ring/review2-cost.json
```

## Collision cost

All added detail remains solid; there is no mast or girder exemption.
[Raw collision blocks](../../spikes/station-scale/evidence-ring/collision.json)
measure the production `sweepShip` against the composed Ring proxy: 3,508 →
8,990 primitives, including the five retained bay boxes. The authored hull
portion is 3,503 → 8,985 boxes. The same courier hull, positions, 0.1 s step,
2 km/s translation and 2 rpm station rotation are offered to both arms.

Twelve interleaved blocks per arm, 100 sweeps per block, twenty warm-up sweeps
per case, shuffled pairs with seed 1145, host bun 1.4.2. Each strike case must
produce an impact; the approach must remain clear. Every timed block verifies
its impact count and every fixture checks finite output positions.

| Case | Main median; range (ms/sweep) | Branch median; range |
| --- | --- | --- |
| Clear approach | 0.00321; 0.00255–0.00947 | 0.00306; 0.00261–0.00835 |
| Outer-rim strike | 0.07805; 0.06598–0.49913 | 0.09801; 0.08237–1.18173 |
| Front-rim strike | 0.10944; 0.09769–0.20195 | 0.12640; 0.12047–0.29354 |
| Rim flyby | 0.00105; 0.00099–0.00129 | 0.00098; 0.00091–0.00128 |

The strike median differences are about 0.017–0.020 ms; the ranges overlap.
Start load is 25.13/20.89/19.80, so this is noisy evidence for four fixed
collision cases, not a worst-case bound or whole-simulation timing. The frame
receipt above measures the separate rendering share; the collision instrument
does not time world stepping, Traffic, other stations or planet collisions.

The initial collision run's raw JSON was overwritten while correcting a field
label, before the decision trail recorded the rerun. Its
[recovered console summary](../../spikes/station-scale/evidence-ring/collision-first-run-summary.txt)
retains strike medians of 0.06623 → 0.09653 and 0.09922 → 0.12995 ms. The
second run above has larger baseline medians and smaller differences. This
between-run variation is another reason not to infer a general collision bound.

```sh
bun spikes/station-scale/measure-ring-collision.mjs /path/to/main
```

## Visual and delivery evidence

The [five-row study sheet](../../spikes/station-scale/evidence-ring/ring-before-after.png)
puts main on the left and this branch on the right. It contains the requested
close, wide, hero and two sun-side views. The capture starts with the study
script from `spike/station-scale`, with the Ring selector and sun-side rows from
`spike/ring-scale`; both arms use that identical copy, full-model readiness and
the hardware lane. Both were recaptured after review round 2 and hold the
machine probe lock. The capture now waits for late detail after placement;
`EXPECT_RING_DETAIL=0` on main and `EXPECT_RING_DETAIL=7` on the branch refuse
an incomplete frame. Their JSON reports retain measured ranges, renderer and
the seven visible mesh names on every branch frame. The reproducible sheet is
built with `node spikes/station-scale/make-ring-sheet.mjs`. No generated target
or judge score is claimed. These remain study files and add no PR probe.

The [Drum and Assembly lighting controls](../../spikes/station-scale/evidence-ring/trade-light-controls/before-after.png)
add close approach and sun-side before/after pairs on their real fixtures:
seed 42, system 0 (Drum) and system 5 (Assembly). These study frames show the
additional forms covered by the principal's ruling; they do not add geometry
or stand in for principal acceptance.

The [canonical sheet](../../spikes/station-scale/evidence-ring/views/index.html)
contains eight before/after pairs. The after arm was refreshed through
`npm run views` after the split; the main before arm is retained.
`ring-approach`, `ring-flank` and `ring-range`
declare seed 42, system 1 and cover lever 1145. The existing station rows,
`hull-chase` and `cockpit-backlit` remain controls. The new fixture and view
declarations have a failing-before headless test. Both manifests retain actual
clock, dirty ref, renderer and serving-tree provenance. The images were opened
at full size; principal visual approval is still required.

Capture the canonical subset through `npm run views` on each guarded server:

```sh
node spikes/station-scale/capture-ring-views.mjs /path/to/main before
node spikes/station-scale/capture-ring-views.mjs . after
```

Initial implementation verification (before review round 1):

- The four requested trade/proxy files pass, including the unchanged reach,
  loader-backed bay clearance, 10 m empty-space and 1.5 m containment checks.
- The new Ring tests check all seven meshes at full/reduced/outline/full,
  the compiled trade B/C/D/E exterior shader and both beacon colours' bloom
  luminance. The existing Coriolis shader, exposure and late-detail tests pass.
- Assembly, canonical view and browser-impact tests pass. Typecheck, format,
  lint, comment lint, launcher wiring and production build pass.
- Hardware `probe-light-rig` passes 12/12. Its calibrated authored courier has
  peak 238.21 within 131.016–255, lower quartile 34.48 above 29.392 and median
  51.70 above 44.608. Hardware `probe-station-visuals` passes 92/92, including
  Ring/Wheel fixture visibility, strobes and detail transitions. These two
  manually filtered runs are affected coverage, not the PR browser gate.
  [Hull-lighting log](../../spikes/station-scale/evidence-ring/probe-light-rig.log)
  and [station-visuals log](../../spikes/station-scale/evidence-ring/probe-station-visuals.log).
  The light-rig fixture has no Ring navigation materials; its ceiling row is
  not evidence for the new beacon exception. That exception is checked by the
  loader-backed luminance and material-name tests and the Ring captures.

The initial implementation’s full host `npm test` invocation finishes at **7,312 pass, 1 fail across
445 files** (933.03 seconds, bun 1.4.2). The failure is the new baseline-lamp
regression: the runner had loaded the old trade module before the audit
correction, then read the added test during its run. Editing that test while
the full runner was active was a worker mistake. A fresh process running Ring
detail, trade flight, trade flight assets and trade model fixtures passes
**30/30**, including that regression on the corrected module. The full command
is not repeated under the once-only worker instruction. The full run therefore does not validate the corrected trade module. The supervisor still
owes a fresh full run on the committed tree; this receipt does not call the
mixed-source run green. [Run summary](../../spikes/station-scale/evidence-ring/unit-suite-summary.txt).

The path diagnostic selects all 118 browser probes because the canonical view
declarations are shared harness infrastructure. Under the worker contract the
supervisor runs the final selected PR gate after review; a local affected-probe
run is not that gate. The proposed public sentence is: “Trade stations catch
stronger light, and Ring stations show finer details.” It awaits the principal's
approval and the actual merge date.

Initial gate command exits, log hashes and runtime-source hashes are recorded in
[verification.json](../../spikes/station-scale/evidence-ring/verification.json).
The lint command is the repository's `biome lint scripts`; comment lint covers
the repository separately. These are the named commands, not a claim that
Biome linted all application source.

## Review round 1 verification

The one full host `npm test` run for this fix pass passes **7,316 tests,
0 failures across 446 files**, in 874.40 seconds. Source and tests stayed
unchanged during the run. [Summary](../../spikes/station-scale/evidence-ring/review1-unit-summary.txt).
The [regression record](../../spikes/station-scale/evidence-ring/review1-regressions.txt)
contains the failing-before asset-size, deferred-detail and Assembly-lamp
checks, followed by 31 passing affected tests. The four required trade/proxy
files separately pass 84 tests.

The final isolated hardware run passes
[station visuals 92/92](../../spikes/station-scale/evidence-ring/review1-probe-station-visuals.txt)
and [hull lighting 12/12](../../spikes/station-scale/evidence-ring/review1-probe-light-rig.txt).
The renderer is ANGLE Metal on the Apple M1 Pro. The calibrated hull readings
remain peak 238.21, lower quartile 34.48 and median 51.70, inside their existing
bands. No threshold changed. Two earlier host attempts timed out at different
`bootedGame` calls: [final Wheel boot](../../spikes/station-scale/evidence-ring/review1-probe-station-visuals-first-timeout.txt)
and [a viewport boot](../../spikes/station-scale/evidence-ring/review1-probe-station-visuals-second-timeout.txt).
An untouched archive of base commit `ec561ec5`, with its source hashes checked,
passes both probes. The final branch rerun ran without local tests or build
jobs and also passes both; the timeout cause is not established.

Typecheck, format, lint, comment lint, launcher wiring and production build
pass. The emitted-file size guard passes. The selector still expands this PR
to all 118 probes, so the supervisor retains the final selected PR browser
gate. These two affected probes are not that gate. Final source and evidence
hashes are in [review1-verification.json](../../spikes/station-scale/evidence-ring/review1-verification.json).
Principal visual, frame-cost, asset-size and changelog approval remain pending.
