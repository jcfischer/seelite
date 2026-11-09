# Model integration: the Longwall bridge (node #1198)

**The node stays open.** It changes what the game looks like, so it closes only
on the canonical view set and the principal's in-game yes.

## Current result

- Design PR #1159 at `f281bb67`, approved 2026-11-07 (#1143). Study cabin
  `spikes/miner-cockpit/miner-cockpit-2seat.glb`, 21,292,668 bytes, SHA-256
  `47aaee78…1488366`, verified against the handoff.
- Shipped asset `src/models/miner-cockpit.glb`, 13,003,192 bytes (12.40 MiB),
  SHA-256 `69cea910…d6e861`, emitted as `dist/assets/miner-cockpit-<hash>.glb`.
- `cabinForHull` selects by flown hull: the miner's row is `miner`, every other
  hull flies `courier`. #911 adds the tug's row.
- The courier cabin stays in the boot set. The bridge is `cockpit/miner` in the
  model queue, on demand: the session sweep leaves it out (`ON_DEMAND_MODELS`), so
  it is requested only while the miner is the flown hull, and installs after boot. Until then, and for good if the load fails, the courier cabin and
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

`src/cockpit-occlusion-table.json` holds one row per eye, written by the test. The
courier row is unchanged, because the courier cabin still stands in on a miner.
Parts the production hull leaves in view through its glazing, by drill extension:

| Extension | Pilot seat, (-0.6, 6.803, -25.0) m | Miner seat, (+0.6, 6.803, -25.0) m |
| ---: | --- | --- |
| 0 | anchor-1 body; port mount | starboard mount |
| 0.25 | anchor-1 body, elbow, sleeve; port mount | anchor-0 body, elbow, lower, sleeve; starboard mount |
| 0.5 | anchor-0 body, elbow, lower, sleeve; anchor-1 body, elbow; port mount | anchor-0 body, elbow, lower; anchor-1 body, elbow, sleeve; starboard mount |
| 0.75 | anchor-0 body, elbow, sleeve; anchor-1 body, elbow, lower, sleeve; port mount | anchor-0 body, elbow, lower, sleeve; anchor-1 body, elbow, lower, sleeve; starboard mount |
| 1 | anchor-0 body, sleeve; anchor-1 body, elbow, lower, sleeve; port mount | anchor-0 body, elbow, foot, lower, sleeve; anchor-1 body, elbow, sleeve; starboard mount |

The drill feed is hidden in every row. The drawn set is behind `?mining=1`.

## Lifecycle

| SOP path | Evidence |
| --- | --- |
| Boot and cold download | `bootModelIds` unchanged; `probe-miner-cockpit` holds the bytes and sees the courier cabin fly |
| Background installation | Figures below |
| Interrupted or failed load | Probe aborts the GLB: whole courier cabin and eye, no page error |
| Postcard/export | `openPostcardWithModels` waits on `currentModelIds`, which names the bridge for a flown miner; no separate probe row |
| Flight and traffic | Player only: NPC hulls draw no cabin |
| Jump during install | The template is session-wide and `syncCabin` reads the flown hull when it lands |
| Rebuild and teardown | Probe cycles miner, courier, miner, courier: geometries and textures return to the same counts |
| Render layers | Each cabin swap changes the cabin scene's light count (9 against 3), so its programs compile on the first frame after it |

## Cost

There is no numeric budget for a cabin on the map. The comparison is the courier
cabin on the same hull. Clean head `240323de`, Apple M5 Pro through ANGLE Metal,
1440x900 at device scale 2, 8 blocks of 120 frames per arm, order seed 20261109,
one run, load 2.17 to 2.36 per row. `scripts/measure-miner-cabin-cost.mjs`.
Later commits change the instrument, the table's file format, the queue and tests,
and no drawn figure.

| Framing, quality, AA | Courier ms | Bridge, pilot | Separation | Calls | Triangles |
| --- | ---: | ---: | ---: | --- | --- |
| Open, high, 0 | 1.543 | -0.290 | 0/64 | 188 to 179 | 284,320 to 318,224 |
| Open, high, 2 | 2.122 | -0.129 | 0/64 | 188 to 179 | same |
| Open, low, 0 | 0.695 | +0.020 | 63/64 | 174 to 165 | 284,295 to 318,199 |
| Open, low, 2 | 1.245 | +0.072 | 64/64 | 174 to 165 | same |
| Rock, high, 0 | 1.960 | -0.300 | 0/64 | 98 to 114 | 240,352 to 367,524 |
| Rock, high, 2 | 2.688 | -0.105 | 0/64 | 108 to 114 | 240,472 to 367,524 |
| Rock, low, 0 | 0.909 | +0.017 | 60/64 | 75 to 66 | 193,890 to 227,794 |
| Rock, low, 2 | 1.486 | +0.053 | 64/64 | 85 to 66 | 194,010 to 227,794 |

The miner seat reads within 0.02 ms of the pilot seat in every row. The bridge has
three point lights where the courier cabin has nine on high, which is the likely
reason it is cheaper there; that cause is not separately measured. Full level only:
the eye never leaves the cabin, so no LOD policy applies.

**Cold install**, two runs with the bytes held 5 s, load about 2.3: the frame that
adopts the template 60.7 and 60.2 ms, the first frame after it 95.7 and 96.3 ms,
the worst frame after the swap 158.8 and 155.3 ms (median before 16.7 ms). A 505 ms
frame occurs before the bytes are released, so it is not the cabin's. The field
budgets of #1209 are not re-run on this hull.

## Asset and geometry preflight

`node spikes/miner-cockpit/prepare-game-asset.mjs`: meshopt without quantisation and
lossless WebP. The script verifies exact vertex attributes and texture pixels after
a decode. 47 meshes, 130,826 triangles, six images. The host-limit test and the
loader-backed checks are in `tests/miner-cabin.test.ts`; `npm run build` runs
`check-dist-sizes`.

## Open for the principal

- **Parts outside the side glass.** With `?mining=1` the cockpit view draws the seen
  parts but not the hull, so the near mount and struts appear outside the side
  window with nothing around them. The mount and strut are not hidden by the hull
  from this eye, so the acceptance row holds by its rule, and this is the look the
  2026-10-29 note objected to from another eye. Behind the flag only.
- **Drill camera.** Dark: there is no producer, and a live feed would be a new
  render pass.
- **Notices.** `screen-notices` is 10 x 4 cm, so a long notice fits by shrinking.
- **Emergency console.** The study has no `screen-fallback`, so sources with no
  screen share the spec's emergency console.
- **Field of view.** The bridge opens at normal 60°, per the #1155 ruling. There
  the pilot's console is partly below the frame; at wide 80° it is whole.

## Delivery evidence

Non-miner rows: the before/after diff is below 1.0% moved in every row but the
mid-traversal and approach rows named in the PR; a same-build control at the base
moves those approach rows more (1.51 to 3.20%) than the change does (0.59 to 1.26%).
Review, gate and principal approval are recorded on the PR.
