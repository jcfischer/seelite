# Model integration: node #814, Bollard O4 salvage tug

Follows [the authored-model integration SOP](../model-integration-sop.md).

## Current result

SOP steps 1 to 3 are done and step 4 is measured. The tug is drawn as
Bollard O4, installed after boot on the courier's path, which this node
shares between the two hulls. Two decisions are open (D5, D6) before the
review loop.

- **Design:** PR #802, branch `spike/bollard-hull-798`, rebased on `origin/main`
  on 2026-10-11 to `6445d75d`. The accepted design is commit `26d6958`
  (rebased: `6445d75d`), principal visual approval 2026-10-08. That approval
  covers the isolated study; in-game approval is still owed.
- **Integration branch:** `node/814-bollard-integration`, from the rebased
  design head.
- **Shipped asset:** `src/models/bollard-tug.glb`, 17,461,200 bytes
  (16.65 MiB), sha256
  `a4b07c871f31de39bfc1f7dbf043613bf6f4862c2bf1aedeba6327cbbcecedb3`.
- **Shared path:** `src/authored-hull.ts` builds both authored hulls;
  `src/courier-hull.ts` and `src/tug-hull.ts` supply only their scale, nozzles
  and mesh rules. `ship-mesh.ts` keeps one builder per after-boot hull
  (`installAuthoredHull`, `rebuildAuthoredStandIn`), and the Game loads the
  courier and then the tug (`loadAuthoredHullsAfterBoot`), each failing alone.
- **LOD and loading:** the courier's policy, unchanged: the full model inside
  `DETAIL_RADII.full`, two simplified levels beyond it. Pending D5.

### Contract

| Item | Value | Source |
| --- | --- | --- |
| Hull row | `tug`, role `salvage`, 120 t, purchasable at 27,600 cr | `src/hull.ts` |
| Variant | Bollard is `tug/a`; the procedural loft is no longer a variant, only the stand-in until the model installs (the courier's pattern) | D1, ruled |
| Units, axes | metres, Y up, +Z forward in the study; the game's nose is −z, so the install turns the model 180° about Y | `spikes/bollard-hull/README.md`, `tests/tug-hull.test.ts` |
| Scale | 1:1, no scale | D2, ruled |
| Envelope | 56.6 x 48.4 x 21.2 m (L x B x H), the model's box rounded up 0.1 m; was 58.5 x 45.7 x 25.7 m | D2, ruled |
| Envelope centre | the origin (was fore −0.5 m); the install centres the model's box on it | `src/hull.ts`, `tests/tug-hull.test.ts` |
| Display reach | 36.1 m, the farthest vertex (36.03 m) rounded up; was 31 m | `HULL_REACH_KM.tug` |
| Mass | 120 t unchanged; density 2.07 t per 1000 m³ at the new box, inside the 1.2–2.4 band | `tests/hull.test.ts` |
| Vents | placement and shares re-solved by `measure-vent-placement.ts` and `measure-vent-shares.ts` on the model | `src/hull.ts` |
| Collision owner | the hull envelope, as for every hull | `src/hull.ts` |
| Moving parts | none: no animations, 15 nodes batched by material; the dorsal winch is static geometry, so it cannot be posed without a re-export | study GLB, `build_model.py` |
| Resources | one GLB under `src/models/`, content-hashed (#834); review files stay in `spikes/bollard-hull/` | SOP §2 |

### Principal rulings, 2026-10-11

- **D1. Variant:** Bollard replaces `tug/a`. With D3 the procedural loft
  stays only as the stand-in, as the Kestrel does for the courier (#831).
- **D2. Envelope:** the model's own box at 1:1 (Longwall's pattern), not a
  scale to the old roster length. It fits every berth.
- **D3. Boot:** install after boot, the courier's path (#831). No new
  blocking asset. Until the model installs, the stand-in loft is 4.5 m taller
  than the new envelope (25.7 against 21.2 m).
- **D4. Review:** Sage is authorized to review this node's PR.
- **Step 3 design:** generalise the courier's after-boot path per hull rather
  than fork it (option O1).

### Open decisions

- **D5. LOD policy.** Keep the courier's levels for the tug. Measured cost is
  within 0.25 ms of the courier's in every arm (below).
- **D6. Install stall.** Each after-boot install blocks the main thread in one
  piece after its download: 1.18 s for the courier (on `main` today) and
  1.50 s for the tug (median of 5). Accept it as the courier's is accepted, and
  chart the fix as its own node; or fix it in this node.
- **Hull handling.** The tug's roll stop is 1.4% slower than #5's law with the
  re-solved shares (pitch and yaw unchanged), inside #619's 20% bound. It is a
  new figure for that ruling to re-confirm.

## Asset and geometry preflight

- **Command:** `node spikes/bollard-hull/prepare-flight-asset.mjs`. Two runs
  wrote the same sha256.
- **Encoding:** `dedup`, `reorder`, Meshopt with the lossless NONE filter,
  lossless WebP. No simplification, quantization or resize. The script asserts
  exact vertex attributes, the approved export's triangles
  (`spikes/longwall-miner/triangle-soup.mjs`, shared) and texture pixels.
- **Size:** 16.65 MiB against the host's 25 MiB per-asset limit. The build
  emits it as `dist/assets/bollard-tug-<hash>.glb`, 16.7 MB, and
  `scripts/check-dist-sizes.mjs` passes; `tug-hull` is a lazy chunk, and no
  spike file reaches `dist/`. The spike export is 33.4 MB.
- **Production loader:** `tests/bollard-asset.test.ts` decodes both files
  through `decodeShippedGlb` (the browser's `GLTFLoader` and Meshopt decoder).
  15 meshes, 444,600 triangles, every attribute of every corner exact, winding
  kept. Mutation check: an 8-bit normal quantization of the shipped file turned
  that row red; the regenerated file returned the same sha256.
- **Bounds:** x ±24.15 m, y −10.87 to +10.30 m, z −28.10 to +28.42 m.
- **Berth fit:** the model's box fits every berth of every role (trade 8,
  shipyard 6, refinery 4, outpost 2), as the `tug/a` envelope did.
- **Drive glows:** placed by measurement. The barrel's end cap at z −26.0
  closes each mouth, so the plate and ochre ring `build_model.py` places at
  −25.6 are hidden, and sixteen alloy rods line the wall. The mouth's clear
  radius 3 cm off the nearest triangle is 3.22–3.37 m from z −26.2 to −27.2,
  3.10 m at −27.4 and 2.97 m at the lip. `tests/tug-hull.test.ts` holds every
  glow 3 cm clear of the model's triangles; the first guess (3.35 m from
  −25.62) turned it red.

## Runtime and performance evidence

### Lifecycle rows (SOP §3)

| Path | Result | Evidence |
| --- | --- | --- |
| Boot and cold download | The tug is not in the boot set: a live Game is built on the loft, and the tug's download starts when the courier's has settled | `probe-model-download` §5 and §6, GPU lane, green |
| Background installation | Release replaces every existing tug once and removes the loft. The swap blocks the main thread 1.50 s (D6) | `probe-model-download` §6; `scripts/measure-hull-install-stall.mjs` |
| Interrupted or failed load | A refused tug keeps every stand-in, warns once, shows no Retry, and play goes on | `probe-model-download` §6 |
| Postcard/export | Waits for the courier and the tug behind the Retry panel, then refreshes its stand-ins | `src/main.ts`; probed by the selected gate (owed) |
| Flight and traffic | Vents, muzzle, nav lights and throats are measured on the model; the envelope fits every berth; the gun is forward on metal | `tests/tug-hull.test.ts`, `tests/vent-placement.test.ts`, `tests/hull.test.ts` |
| Jump during install | The refresh walks the Game's current meshes when the install resolves; the builder is not owned by a system | `Game.refreshAuthoredHulls` (the courier's #831 design) |
| Repeated rebuild and teardown | A second rebuild is refused; a wreck is rebuilt dark through its own builder and its old materials freed | `tests/tug-hull.test.ts` |
| Rotation and render layers | Not applicable to the model: no moving parts | contract |

### Cost (SOP §4)

`HULL=tug node scripts/measure-courier-hull-cost.mjs` and the same with
`HULL=courier`, 2026-10-11, on the same page and fixture: M1 Pro, ANGLE Metal,
1440 x 900 at device scale 2, chase, clock held, 12 blocks of 120 frames per
arm, order shuffled from seed 20261009. Load average 11–17 from other sessions,
so the milliseconds are indicative; draw calls and triangles are not
load-dependent. Every authored delta separates 144/144.

| Delta against the loft, occlusion off / on | Tug | Courier |
| --- | --- | --- |
| One hull, close | +0.51 / +0.48 ms | +0.47 / +0.51 ms |
| Four more, close (full model) | +1.34 / +2.08 ms | +1.13 / +1.85 ms |
| Four more, far (reduced level) | +0.38 / +0.83 ms | +0.41 / +0.84 ms |

The tug's model has 445,368 triangles in 17 meshes (the glows included),
against the loft's 9,064 in 31. With occlusion off the frame draws 299 calls
with the tug, 312 with the loft and 280 with neither: the study is batched by
material, so it costs fewer calls than the loft.

### Install stall

`RUNS=5 node scripts/measure-hull-install-stall.mjs`, same machine, load
average about 16. Each install repeated from fetched bytes in a running game;
median of 5.

| Phase, ms | Courier | Tug |
| --- | ---: | ---: |
| Parse and Meshopt decode | 64 | 68 |
| Builder (two simplified levels) | 491 | 634 |
| First build (nav-light raycast) | 138 | 177 |
| Throat measurement | 574 | 687 |
| Longest frame gap | 1,183 | 1,501 |

The builder, first build and throat measurement run in one task, so the
longest gap is close to their sum.

## Delivery evidence

Owed: Sage (D4), `probe:pr` on the final head, the view set, the principal's
in-game approval, and the Field Notes sentence (the node is a major change by
`src/changelog.ts`'s rule; the sentence is proposed in the PR).

Headless at `f3e360df`: `npm test` 5959 pass, 0 fail.

## Historical measurements

- Study viewer, 2026-10-08: 56.25 FPS on M1 Pro at 1,778,434 submitted
  triangles, 83 calls (`spikes/bollard-hull/evidence/metrics.json`). Study
  viewer only; not production evidence.
