# Node #831: courier hull after boot

Author: Codex / ivy-agent (ranger implement lane), 2026-10-10.

The live Game starts with the procedural Kestrel. Only after construction does
`loadCourierHullAfterBoot` import and download the courier hull. The courier is
absent from the live boot's required loaders and from the postcard's
`prepareCoriolisPage` loaders. A postcard waits after constructing its read-only
Game, before painting its frame; the ship workbench still waits before building
its review meshes. The miner's existing boot wait remains owned by node #838.

Installation rebuilds the player's courier and every cached Traffic courier,
including detached meshes, once. Fleet-review couriers and cached courier wrecks
are refreshed too. Roots retain their name, pose, visibility and cache identity;
old contents are disposed, the player's vent plumes and occlusion record are
refreshed, and muzzles are measured on the fresh unplaced hull. A Game memoises
its background attempt: failure leaves the stand-ins, warns once and never
reaches the Retry panel. No world, flight, condition or save state is changed by
replacement.

A procedural wreck can already have a cached loft tear plan when the model
arrives. `tearHull` now returns before consulting that plan for a hull without
tearable lofts: otherwise the old plan names missing parts and replacement
throws. The regression exercises both procedural-to-authored replacement and
building a procedural wreck afterwards.

## Asset bytes for the supervisor's PR

Node #834 moved the shipped file from `public/models/` to `src/models/`; the
latter is the actual file changed here and remains content-hashed on deployment.

| Shipped GLB | Bytes |
| --- | ---: |
| Before, branch's initial HEAD | 15,940,136 |
| After, quantised normals and eligible UVs | 14,624,528 |
| Removed | 1,315,608 (8.25%) |

`spikes/courier-hull/prepare-game-asset.mjs` uses 16-bit signed normal attributes
and 16-bit unsigned UV attributes where UVs lie inside [0,1]. Tiled UVs remain
float32. Positions remain float32 and exact; no triangles are removed and no
node transforms or texture pixels change. Meshopt and lossless WebP remain in
place. The script checks the encoded attributes' exact decoded round trip and
texture pixels. Both `extensionsUsed` and `extensionsRequired` contain
`KHR_mesh_quantization`.

The explicit extension declaration works around glTF Transform 4.5.1's
`isQuantizedPrimitive`: it consults the POSITION accessor for every semantic,
so it misses quantised normals when positions remain float32. No dependency
patch is shipped.

`tests/courier-hull.test.ts` compares all 36 meshes and all 353,954 triangles
against the approved study. Corner positions and winding are exact; normal and
UV errors stay within a 16-bit interval (plus original float32 normalisation
error). `tests/hull.test.ts` still rebuilds the selected authored courier and
holds its existing envelope. This supersedes node #812's receipt for loading,
bytes and the claim that normals/UVs ship without quantisation.

## Verification and handoff

- Focused headless asset, envelope, teardown and install checks: passed.
- Focused courier/wreck transition and tear tests: 28 passed, 0 failed. The
  subsequent resource-disposal and catalog checks passed (23 tests, 0 failed).
- Refreshed lighting calibration headless checks: 45 passed, 0 failed.
- Typecheck, build, formatting, lint and launcher wiring: passed.
- Browser: `probe-model-download` passed on ANGLE Metal (Apple M1 Pro), with a
  held courier response proving boot precedes it, player and real Traffic
  replacement, and one warning/no Retry on refusal, with flight still advancing.
  `probe-boot`, `probe-chase-view`, `probe-postcard`, `probe-ship-visuals`,
  `probe-vent-display`, `probe-derelict` and `probe-light-rig` also passed on the
  hardware lane.
  Boot's settings wait timed out under the combined run's load, then passed
  alone without a source change. Ship visuals needed to await the authored
  hull before its existing authored-hull row; it passed after that correction.
- `probe:select` requested all 98 probes because this changes shared runtime.
  The worker contract reserves the full suite for the supervisor; local runs
  are explicitly partial.
- Initial full `npm test`: 5,753 passed, five failed in 875.75 s. Four were
  existing test timeouts (Traffic mutation controls, courier raycast, music
  voices, hollow drive rings); the fifth correctly rejected the new GLB hash
  against the lighting calibration. The isolated courier raycast passed in
  58.5 s with 960 lines and zero disagreements. Music and hollow-ring checks
  passed on recheck. Traffic's mutation-control test timed out once more in
  the combined recheck, then passed alone in 4.6 s. No timeout limit changed.
  Final post-calibration `npm test`: **5,758 passed, 0 failed** across 316 files,
  in 409.03 s. The second full run was required after the calibration correction;
  all original timeout limits and acceptance assertions remained in force.
- Canonical `hull-chase` before/after pair captured and inspected on ANGLE Metal
  (Apple M1 Pro), seed 47, 1440x900, at game time 0. The before asset is from
  initial HEAD `28e647196b72a6e65c7516bfec6f4918a65bf123`; both captures use
  this branch's background-loading code. The pair and provenance are at
  `/tmp/node-831-chase-codex/index.html`. This is one canonical framing, not
  a full view set. Principal visual approval remains pending with the supervisor.

The lighting calibration's asset-hash gate required a paired remeasurement.
Five samples per asset per lane reproduce the existing readings exactly:

| Metric | ANGLE Metal (M1 Pro) | SwiftShader |
| --- | ---: | ---: |
| Painted peak | 252.2126 | 252.2126 |
| Lower quartile | 10.1616 | 10.1616 |
| Median | 37.8768 | 38.8046 |
| Mask pixels | 21,543 | 21,531 |

Every sample within a lane and both assets agree on each reported value. The
old-file control is the same initial-HEAD asset used for the chase pair. Results
are `/tmp/node-831-luma-hardware.json` and `/tmp/node-831-luma-cpu.json`, from
the shipped `measureHullChase` reader, canonical fixture and guarded dev server.
`scripts/lib/hull-luma.mjs` adopts the new asset hash and measurement reference;
its readings, margins and floors stay as derived. `probe-light-rig` now awaits
the hull before measuring its authored subject.

This is performance tuning under `src/changelog.ts`'s definition of major;
no new changelog entry is owed. The supervisor owns the PR, Sage, the full
browser gate, the principal's chase-view approval, merge and graph checkpoint
`courier-hull-after-boot`. This worker commits only its checked-out branch.
