# Node #1094: miner drive and attitude plumes

## Cause and reproduction

The failure reproduces on the player's miner when the Longwall installs after
boot. Hold the Longwall GLB response, boot a fresh miner, apply throttle and a
yaw/roll demand, then release the response. The procedural stand-in shows its
plumes; the installed Longwall loses them.

`refreshAuthoredHulls` preserves the live root's position and orientation, then
calls `mountVentPlumes`. `measureThroatSteps` previously treated that posed root
as an unplaced hull. Its raycasts and drive-bell centres returned scene
coordinates, which the plume renderer treated as local coordinates and
transformed again. In the captured reproduction, an installed main throat had
x = 0.120 km instead of its local nozzle's x = -0.0125 km.

The model already has two aft-facing objects named `longwall-port-exhaust` and
`longwall-starboard-exhaust`. Their discs and materials were present; neither
their names nor their placement needed changing. Traffic's plume builder already
isolated the pose. This repair moves that isolation into the shared measurement
boundary and removes the NPC-only duplicate, preserving Traffic behavior.

## Regression and verification

- The new placed-miner rows in `tests/longwall-mesh.test.ts` failed before the
  source repair for both the procedural stand-in and installed Longwall:
  `Expected: < 1e-9`, `Received: 5.480866984146265` and
  `Received: 5.514552234610166`. They check every local throat, drive-bell count,
  firing main/attitude slots, NPC plume parity, and preservation of the live pose
  under a transformed parent.
- The affected Longwall, vent-plumes and NPC-plumes files pass: 42 tests.
- The required full host `npm test` run passes: 7,022 tests across 419 files,
  zero failures. It was run once before the final commit.
- View-set and probe-selection tests pass: 74 tests. Typecheck, formatting,
  script lint, comment lint and production build pass. The comment suppression
  baseline shrinks by one after the duplicate helper is removed.
- `npm run probe:one -- probe-model-queue --show-output` passes 32/32 checks on
  `ANGLE Metal Renderer: Apple M1 Pro`. The added checks hold the Longwall response
  until the stand-in has been measured, then read rendered pixels on both sides
  of the install. All three stand-in drive nozzles and both Longwall nozzles
  paint drive glow and main plumes; firing attitude vents paint plume pixels.
  Installed main-plume luma rises are 194.87 and 195.30 codes; the strongest
  sampled attitude throat rises by 218.99 codes. These are pixel differences,
  not performance figures.
- The shared player display probe passes 16/16 checks, and the NPC plume probe
  passes 5/5 checks on the same GPU lane. One player-probe run timed out at its
  unchanged 20-second boot wait; an isolated retry passed without a code change.
- A final miner-only rerun also samples rendered particles beyond the throat
  glow. All nine checks pass across the held-download swap; the installed
  attitude particles raise sampled luma by 198.80 codes. A long-lived server
  initially served the pre-repair module despite declaring this worktree;
  fetching `/src/vent-plumes.ts` proved the new helper was absent. Restarting
  that server exposed the current source and the same reproduction passed.

## Visual review and delivery boundary

`miner-vent-plumes` is a canonical view-set entry covering lever 1094. Capture:

```sh
SEELITE_PROBE_RENDERER=hardware PROBE_ORIGIN=http://127.0.0.1:5194 npm run views -- --only miner-vent-plumes --label node-1094-final
```

The captured sheet is `view-set/selected/index.html`; its full-size image is
`view-set/selected/node-1094-final/miner-vent-plumes.png`. The recorded renderer
is the M1 Pro Metal GPU. The image was opened and inspected: the two drives and
attitude puffs are visible. This is a scoped capture, not a complete view-set run.

The principal's visual yes remains pending. The supervisor owns the PR, review,
push and merge, and `cp-seelite-miner-vents` remains the close gate. This internal
repair does not meet `src/changelog.ts`'s definition of a major change.
