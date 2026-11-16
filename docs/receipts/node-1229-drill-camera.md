# The Longwall bridge's drill camera (node #1229)

**The node stays open.** It changes what the game looks like, so it closes only
on the principal's in-game yes; the feed is judged by eye.

## Current result

- `screen-drillcam` carries a live picture of the drill: a second camera renders
  the near scene into a 640 x 307 half-float target and the screen shows it under
  a canvas overlay. The overlay reads `DRILL CAM` and the pass's frame clock
  (`TCR hh:mm:ss:ff`), or `FEED OFF` when the pass is not drawn.
- `src/drill-camera.ts` owns the mount, the lens, the gate and the overlay text;
  `src/drill-camera-pass.ts` owns the render pass and the scene's restoration.
- `docs/specs/cockpit-text-surfaces.md` carries the rule; #1198's receipt still
  says the screen is dark because that is what #1198 shipped.

## The study's drill-camera position

The study authored the drill camera as a **picture**, not as coordinates: the
fixture `spikes/miner-cockpit/screens/drillcam.png` is a contact close-up with
the rotor entering the rock from the upper right and the face filling the frame.
So the mount is derived from the production cutter box (#949, #959) to frame
that subject:

| Figure | Value | Why |
| --- | ---: | --- |
| Fore, from the cutter's bow plane | -1.5 m | just aft of the bow, on the cutter's arm |
| Up, from the keel line | -4.8 m | below the rotor's top (+2.09 m) and above its bottom (−8.91 m) |
| Starboard | -7.0 m | outside the rotor's ±5.5 m square, so the camera is clear of the swept disc |
| Aim, past the rotor's face | 4 m | the face is `bowKm + feedTravelKm x extension`; the aim follows the feed out |
| Aim, up | the rotor's face centre (`-downKm`) | it looks down the feed at its own face |
| Field of view | 42° vertical | the rotor spans about 35° at the 17.6 m eye-to-face distance |
| Near / far | 1 m / 5 km | the near scene's own world, bounded so a distant body cannot fill a 640-texel picture |

The mount is in the ship's frame, so it turns and moves with the hull and with
the ship's attitude. `drillCameraPose` is exercised from two attitudes in
`tests/drill-camera.test.ts`.

## When the pass runs

`drillCameraActive` requires all of: cabin `miner`, view `cockpit`, drill
extension at 1, the screen's centre inside the cabin camera's frame, quality
`high`, and the caller's own request (`Game.drillCameraEnabled`, which the cost
instrument uses for the "without it" arm). A veto in any slot is enough.

The visibility test is the **screen's centre projected through the cabin
camera**, not a frustum test on its bounding sphere. The sphere version was
first and ran the pass at the normal field of view with the whole quad projected
below the canvas — `docs/pitfalls.md` records it.

The pass shows the rotor's `feed` part for its own render only: the cockpit's
hull occlusion hides it from both seats, and the feed is an external camera
looking at the drill. It restores visibility and the shadow map in a `finally`.
The shadow map is pinned (`autoUpdate` off for the pass) because this is a
second full `WebGLRenderer.render` of the near scene, the same argument #241
records for the GTAO override.

## The normal field of view

At the **normal 60°** field of view the mining console's lower row is below the
frame; the probe's own projection puts the drill camera's quad at NDC y
−1.442…−0.968, so its centre is off screen and the pass correctly does not run.
At the **wide 80°** side (key 7) its centre is at NDC y about −0.83 and the
screen shows the feed. The screen's position is #1198's design; this node did
not move it.

## Cost

The instrument is `scripts/measure-drill-camera-cost.mjs`, run on the GPU lane
on the same host and in the same method as #1198's cabin cost: its own dev
server, headed Chromium, the player's renderer asserted (ANGLE Metal on an Apple
M5 Pro), 1440x900 at device scale 2, the miner seat at a rock face with the drill
out and the cockpit at 80°, the clock held, 8 blocks of 120 frames per arm,
order seed 20261109, a warm pass and a 1x1 `readPixels` drain per block, medians
and a Mann-Whitney count. One run, host load 2.72–2.85 on 18 cores.

**The budget: the feed may add at most 1.0 ms per frame on high** — the same
absolute figure #950's asteroid-field draw is judged against. On low the quality
gate excludes the pass, so its added cost is zero by construction, under #950's
0.4 ms low figure; the measurement's job there is to show the two arms are the
same frame.

| Quality | Bridge ms | With feed ms | Added | Separation | Calls | Triangles |
| --- | ---: | ---: | ---: | --- | --- | --- |
| high | 1.797 | 1.962 | **+0.165** | 64/64 (100%) | 149 → 161 | 379,908 → 408,034 |
| low | 0.975 | 0.973 | −0.002 | 17/64 (27%) | 101 → 101 | 235,733 → 235,733 |

The high row is 0.165 ms against the 1.0 ms budget, with every one of the 64
pairings slower on the feed arm; the pass drew on the feed arm and drew 0
frames on the bridge arm. The low row's arms are identical in calls and
triangles because the feed is excluded, and its 27% separation is the
instrument's noise. The added 12 calls and 28,126 triangles are the drill and
the rock the pass draws through its 5 km far plane; the rest of the near scene
is culled.

## Live probe

`probe-miner-cockpit.mjs` gained seven rows, run green on the GPU lane (22/22
checks, 45.6 s, ANGLE Metal):

| Row | Evidence |
| --- | --- |
| At the normal field of view the console is below the frame, so the pass does not run | `active: false`, `frames: 0`, `FEED OFF`, the quad's centre at NDC y about −1.2 |
| From the miner's seat with the console in frame, the screen carries a live picture | `active: true`, `frames` 2, overlay `TCR …`, the read rectangle 181 x 99 at 92.7% lit pixels, mean luma 64 |
| The picture is of the drill: turning its rotor changes the feed | the pixel hash changes (875,793,662 → −132,032,629) while the lit share (92.7%) and mean luma stay put |
| Looking away from the console stops the pass | `active: false`, `frames` frozen at 4, `FEED OFF` |
| On low quality the feed is excluded and the screen reads off | both reads `active: false`, `frames` frozen at 5, `FEED OFF` |
| The measurement's switch turns the pass off and the screen says so | `before.active` true → `off.active` false, frames frozen at 6 |
| A hull change removes the feed | in the existing cabin-cycle row: `courierCamera === null`, `minerCamera.active === false` |

The read is the rendered page's own pixels over the screen's projected
rectangle, drained with `readPixels` after `Game.render(0)`; it is what the
pilot sees, not a second render of the target. The rotor-turn arm is the "it is
the drill" control: only the rotor's part moves, so a picture of the rock alone
could not change.

Screenshots: `probe-shots/miner-cockpit/drill-cam.png` (wide field of view, feed
live) and `drill-out-miner.png` (normal field of view, feed off). `probe-shots/`
is gitignored.

## Open for the principal

- **The eye judgment.** The feed composition is the study's contact close-up as
  the cutter box allows it: the rock on the left and the rotor's drum and blades
  on the right. It is not a pixel copy of the study's fixture and was never
  claimed to be.
- **The normal field of view.** The drill camera is on the console's lower row,
  which is below the frame at 60°; the feed is watched at 80° (key 7). Moving
  the screen is #1198's design and out of this node's scope.
- **The changelog sentence.** "The Longwall's drill camera shows a live view of
  the drill." is proposed in `src/changelog.ts` and awaits the principal's
  approval before merge.
