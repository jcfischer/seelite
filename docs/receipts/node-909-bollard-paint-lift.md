# Node #909 — Bollard paint lift

Checkpoint: `bollard-paint-lift`. Implementation and review evidence only;
the principal's look decision is pending. No graph gate is claimed here.

## Preparation and classification

`spikes/bollard-hull/prepare-flight-asset.mjs` uses the same
`liftAndVerifyAuthoredHull` path as the courier and miner, before taking its
triangle reference. `textureMeanLuma` measures the approved study's `paint-wear`
at **0.4755434471582678 linear Rec. 709 luma** (every 97th decoded pixel).
The registry keeps full precision because the three steel tones reach the
diffuse ceiling and the shipped metallic factors are checked exactly.

Six paints use the shared lift: `dark-structure`, `machined-alloy`, `blue-grey-1`
and `pale-steel-0/1/2`. The third steel takes the same scale/cap as the first two;
its tint already exceeds the tint ceiling and stays unchanged. Leaving its
metalness unchanged would put its diffuse below the two lifted steels.

`hose-rubber`, `recess-black`, `service-ochre`, `amber-lamp`, `cyan-display`
and `canopy-glass` remain unchanged under the existing classification. The
classification descriptions no longer quote one hull's opacity or red channel
as if those values applied to all hulls.

Measured by `node scripts/measure-authored-hull-paint.mjs`, rounded diffuse luma
of full white:

| Paint | Study | Lifted |
| --- | ---: | ---: |
| dark-structure | 0.008 | 0.053 |
| machined-alloy | 0.037 | 0.095 |
| blue-grey-1 | 0.040 | 0.128 |
| pale-steel-0 | 0.121 | 0.153 |
| pale-steel-1 | 0.129 | 0.153 |
| pale-steel-2 | 0.137 | 0.153 |

The preparation verifies all **444,600 triangles**, exact vertex attributes and
decoded texture pixels. The asset test independently compares the triangles
through the browser's loader and permits only the shared lift's colour and
metallic-factor changes, resolving texture identities across dedup/WebP.
The shipped GLB is **17,461,196 bytes**, SHA-256
`a6d83c41492be66e6ec1d0eaa0a0180285182a02b960bc580692d7322f38f1a7`.

## Look review

The canonical set places `hull-chase-miner` and `hull-chase-bollard` immediately
after `hull-chase`: seed 47, 1440×900, the largest planet at six radii and a
150° sun angle, in chase view. Capture restores the requested hull as part of
the fixture and checks both the Commander's hull and the drawn authored hull.

The full capture stopped at `derelict-tear` with
`no derelict slot whose wreck the tear can cut`, before reaching these rows.
That fixture is unchanged. The capture now supports an explicit selection:

```sh
npm run views -- --label node-909-lifted --out view-set/node-909 \
  --only hull-chase,hull-chase-miner,hull-chase-bollard
```

Unknown, empty or repeated names refuse before boot. A selected sheet labels its
scope and still requires every selected frame. It carries no full-set tone
report. The default full capture and its completeness checks remain in force.

Local evidence lives in the gitignored `view-set/node-909/index.html`, with
`node-909-lifted` and `node-909-before-base-glb` runs. Both use this branch's
capture code; the before arm substitutes only the base commit's Bollard GLB
(`26a6d20072df35ec87712b9f44b7da44e6c7c5ac`, SHA-256
`a4b07c871f31de39bfc1f7dbf043613bf6f4862c2bf1aedeba6327cbbcecedb3`).
The lifted GLB was restored and its hash rechecked afterward. This is a
controlled asset comparison, rather than two whole-tree reference captures.
The frames were captured on **ANGLE Metal / Apple M1 Pro** and opened to check
framing. This is a scoped view set, not a full canonical pass or the
principal's approval.

## Delivery scope

This is a correction to the existing paint treatment, so no major-feature
changelog entry is proposed. Probe selection expands to all probes because
the capture harness changed. The ranger contract leaves that final full gate
to the supervisor; worker verification runs affected probes only.

Worker checks: affected paint/asset/view declaration tests **79 pass**;
view/levels tests **60 pass**; typecheck, formatting, lint, launcher wiring and
production build passed. The GPU `probe-chase-view`, explicitly flying
`hull=tug` with no save, passed **13/13 checks**, one probe of 108. The asset
measurement and preparation commands above both passed. The browser commands
closed their temporary server and browser before returning.

`npm test` ran once on the host: **6,430 pass, 1 fail**, 372 files, 762.36 s.
The only failure was `tests/vent-plumes.test.ts`:
`a line that meets the hull puts its throat on the metal, on the exhaust side`.
It exceeded its existing 5,000 ms timeout at 5,350.81 ms; no geometry assertion
failed. The file and its runtime code are unchanged.

Rerunning that file alone with the default timeout passed **10/10** on both
the base Bollard GLB (row 3,669.03 ms) and the restored lifted GLB
(3,634.69 ms). This does not establish a passing full suite or reproduce a
base full-suite failure. The supervisor's merge-base comparison remains the
authority for that timeout; no threshold or unrelated code was changed.
