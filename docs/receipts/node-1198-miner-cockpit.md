# Model integration: the Longwall bridge (node #1198)

**The node stays open.** It changes what the game looks like, so it closes only
on the canonical view set and the principal's in-game yes. Figures marked
`pending` are filled from one final matrix on the final code.

## Current result

- Design PR #1159 at `f281bb67`, approved 2026-11-07 (#1143). Study cabin
  `spikes/miner-cockpit/miner-cockpit-2seat.glb`, 21,292,668 bytes, SHA-256
  `47aaee78…1488366`, verified against the handoff.
- Shipped asset `src/models/miner-cockpit.glb`, 13,003,192 bytes (12.40 MiB),
  SHA-256 `69cea910…d6e861`, emitted as `dist/assets/miner-cockpit-<hash>.glb`.
- `cabinForHull` selects by flown hull: the miner's row is `miner`, every other
  hull flies `courier`. #911 adds the tug's row.
- The courier cabin stays in the boot set. The bridge is `cockpit/miner` in the
  model queue, requested only while the miner is the flown hull, and installs
  after boot. Until then, and for good if the load fails, the courier cabin and
  its eye stand in.
- No hull change: the production Longwall is unchanged, and `longwall-miner-v3`
  stays a reference. The study's eye falls inside the production
  `bridge-glazing` box, which is why no reconciliation of the exterior was
  needed.

## Contract

- **Eye.** The study's `EYE_STUDY` (0.6, 5.21, 20.2) m in the Longwall export,
  carried through the installed model's transform: (-0.6, 6.803, -25.0) m in the
  ship mesh, with the miner's seat at +0.6. `tests/miner-cabin.test.ts` carries
  the study figure through the loaded model's matrix and checks both seats lie in
  the glazing.
- **Screens.** Pilot console: `radar`, `flight`, `target`, `status`, `notices`.
  Miner console: `survey`, `ore`, `drill`, `anchor`, `stance`, `lasers`, painted
  from `minerFaceRows`. `drillcam` has no producer and stays unpowered, as the
  spec requires of any screen without one.
- **Resources.** A swap disposes the cabin's own faces and labels, and the GPU
  copies of the shared template, which three uploads again if the cabin returns.
  The decoded template stays in memory (#835).
- **Eye moves the beams.** The mining muzzles are aft of the bridge eye, so each
  beam's first segment is behind the camera. `probe-mining-mounts` now counts the
  strokes ahead of the eye rather than a fixed 64; from the courier eye it is 64.

## Occlusion

`src/cockpit-occlusion-table.ts` holds one row per eye, written by the test. The
courier row is unchanged, because the courier cabin still stands in on a miner.
Parts the bridge eye sees through the glazing, by drill extension, are in that
file. The hull is still not drawn in the cockpit view, so a seen part appears
without the hull around it: see "Open for the principal".

## Open for the principal

Pending the final matrix and views.
