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

## Asset and geometry

| Ring flight asset | Main | Branch |
| --- | ---: | ---: |
| Bytes | 5,875,120 | 19,901,304 |
| MiB | 5.60 | 18.98 |
| Triangles | 102,164 | 485,440 |
| Mesh primitives | 12 | 19 |
| Added triangles drawn below full | 0 | 0 |
| Authored proxy hull boxes | 3,503 | 8,985 |

The separate detail adds 383,276 triangles and seven draws at full. The single
GLB still follows the existing home-exterior boot and after-boot model queue;
it adds no loader or asset kind. A Ring home therefore waits for the larger
file. Cold download and installation latency were not measured in this node.
The production build's emitted-file guard passes the 25 MiB host limit.

The detail generator resets its own seed 1007 after building the approved Ring;
it consumes none of the approved parts' random draws. The shipping preparation
checks exact triangle, vertex-attribute and texture-pixel round trips through
Meshopt and lossless WebP. No simplification, quantisation or texture resize is
added. The Ring's GLB SHA-256 is
`ee2e7b79313df2d797c0a61c4c3c0a5db4e6c564cd3c8a9320dcb327c29188b1`;
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

[Raw blocks and provenance](../../spikes/station-scale/evidence-ring/cost.json).
The main arm is detached `origin/main` at `ec561ec5`; the branch arm is the
working tree on that base. Asset and runtime-source hashes identify the changed
arm. Both Vite servers declare their real roots and are guarded independently.
The main tree has capture declarations overlaid, with no runtime changes.

Apple M1 Pro, macOS arm64, ten CPU cores; ANGLE Metal renderer read back on both
arms. Seed 42, system 1, real trade B home station, 1440×900 at device scale 1,
quality high, render scale 100%, zero composer MSAA. Both framings read back
`form: b`, `detail: full` and the requested range with zero off-axis angle.
The branch reports seven visible added detail meshes, main zero.

The instrument acquires the machine-wide probe lock before opening Chromium
and releases it after closing both servers. The worker runs neither another
browser job nor Sage alongside this measurement. The host is busy: start load averages are
12.71/11.87/14.25; the one-minute reading across timed blocks ranges from 19.05 to 23.90. Each of twelve blocks per arm renders 120 whole frames, after
ten warm-up renders, with a readPixels drain before and after each timed block.
Arm order is shuffled within each pair, seed 1145. Automatic frame loops are
cancelled and the clock is held; simulation and loading are outside the timing.

| Framing | Main median; range (ms/frame) | Branch median; range | Median delta | Branch slower pairs |
| --- | --- | --- | ---: | ---: |
| Station approach, 2.25 km | 3.698; 3.381–4.081 | 3.783; 3.595–4.963 | +0.084 | 99/144 |
| Close chase, 1.028 km | 6.712; 6.242–7.482 | 7.517; 7.214–8.588 | +0.805 | 140/144 |

Submitted whole-frame counts confirm the work ran: approach 676 → 683 calls
and 3,443,620 → 3,826,896 triangles; chase 1,634 → 1,655 calls and
10,509,690 → 11,659,518 triangles. No page or shader errors were recorded. The runtime hash matches the final
`src/trade-flight.ts`; per-block timestamps and load readings are retained.
The initial post-correction attempt refused an invalid timing block and wrote
no new receipt; the successful rerun is the one above. The
[earlier pre-correction run](../../spikes/station-scale/evidence-ring/cost-before-lamp-normalisation.json)
is historical evidence, not the final measurement. This is saturated render throughput through Vite, not player frame latency or
an FPS promise. Both framing ranges overlap; 99/144 cross-arm approach pairs and 140/144
chase comparisons put the branch slower. These are all 12×12 cross-arm
comparisons, not 144 independent matched observations. The CPU/GPU limiter is not isolated, so the benchmark does not
establish a general performance bound. Reduced/outline keep the geometry and
draw counts, not a measured guarantee of equal elapsed time under new lighting.

```sh
SEELITE_PROBE_RENDERER=hardware node spikes/station-scale/measure-ring.mjs /path/to/main
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
the hardware lane. Both runs hold the machine probe lock. Their JSON reports
retain the measured ranges and renderer. No generated target or judge score is
claimed. These remain study files and add no PR probe.

The [Drum and Assembly lighting controls](../../spikes/station-scale/evidence-ring/trade-light-controls/before-after.png)
add close approach and sun-side before/after pairs on their real fixtures:
seed 42, system 0 (Drum) and system 5 (Assembly). These study frames show the
additional forms covered by the principal's ruling; they do not add geometry
or stand in for principal acceptance.

The [canonical sheet](../../spikes/station-scale/evidence-ring/views/index.html)
contains eight before/after pairs. `ring-approach`, `ring-flank` and `ring-range`
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

Worker verification:

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

The one full host `npm test` invocation finishes at **7,312 pass, 1 fail across
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

Final gate command exits, log hashes and runtime-source hashes are recorded in
[verification.json](../../spikes/station-scale/evidence-ring/verification.json).
The lint command is the repository's `biome lint scripts`; comment lint covers
the repository separately. These are the named commands, not a claim that
Biome linted all application source.
