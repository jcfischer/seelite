# Node #1155: normal and wide cockpit fields of view

The `view.fov` command switches the cockpit between 60° and 80° vertical fields
of view. Its default key is **7**. The registry lists it under View, scopes it to
the cockpit, and permits rebinding. Key 7 was free in both `origin/main` and
`origin/prototype/920-drill` at implementation time. Keys 4 and 5 remain available
for the drill anchor and seat switch.

`cockpitFov` is a validated preference in the existing settings store, separate
from Commander saves. Missing or invalid values select normal. The Settings
panel also offers the choice. Changing a cabin does not change the preference.

`Game.applyViewFov` updates the backdrop, far, approach, near, and cabin camera
projection matrices together. It refreshes the cached CSS-pixel focal length
from the renderer's current size. It runs on a preference change and before
scene presentation, so a change of view restores that view's field immediately.
Chase retains 60° and ignores the cockpit command. Existing marker, beam, HUD,
and apparent-size projections read the live camera or its refreshed focal length.

The courier retains its model-owned eye and pitch at both settings. No cabin
transform or cabin-specific choice belongs to the toggle. The miner cabin art
and cockpit text work are outside this node.

## Visual evidence and approval

The local contact sheet is `view-set/node-1155/index.html`. These ignored
artifacts remain in the implementation worktree. Each run contains the canonical
`cockpit-arrival` and `cockpit-backlit` views on seed 47 at 1440 × 900:

| Run | Meaning |
| --- | --- |
| `before-normal` | Base `297e9c60`, unmodified 60° cameras |
| `before-wide-reference` | Base Game with only the constructor's fixed FOV temporarily changed to 80° |
| `after-normal` | Implemented setting; both frame manifests read back 60° |
| `after-wide` | Implemented setting; both frame manifests read back 80° |

The wide baseline is a framing reference, not evidence of a toggle in the base
build. Its manifest predates the FOV readback field. The temporary constructor
edit was restored before implementation verification. Vite was restarted for
the final reference and after captures because an earlier server retained a
stale module despite serving the correct tree.

All eight PNGs were opened for inspection. The renderer reported
`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`.
The principal's visual approval is **pending**. The agent does not supply that
approval or close checkpoint `cp-seelite-cockpit-fov-toggle`.

Reproduce the after captures against this worktree's dev server:

```sh
PROBE_ORIGIN=http://127.0.0.1:5185 SEELITE_PROBE_RENDERER=hardware npm run views -- --only cockpit-arrival,cockpit-backlit --cockpit-fov normal --label after-normal --out view-set/node-1155
PROBE_ORIGIN=http://127.0.0.1:5185 SEELITE_PROBE_RENDERER=hardware npm run views -- --only cockpit-arrival,cockpit-backlit --cockpit-fov wide --label after-wide --out view-set/node-1155
```

`capture-views.mjs` now accepts `--cockpit-fov normal|wide` and records the
requested preference and each frame's live camera FOV.

## Verification

The initial test run failed before implementation: 0 passed, 4 failed.
`tests/cockpit-fov.test.ts` now exercises the real Game command and projection
methods with real Three.js cameras. It covers the default, validation,
persistence, rebinding, cockpit scope, all five matrices, focal length, central
reticle, off-axis markers, view restoration, and render ordering.

`probe-hud.mjs` passed 22/22 checks on the GPU lane. Its new checks press 7 and V,
read the stored setting, compare the wide marker with Three.js projection,
verify the focal length, and confirm chase isolation and return to normal.
`probe-boot.mjs` passed 58/58 checks, including the settings panel's keyboard
ownership and scrolling.
`probe-live-cockpit.mjs` passed 64/64 checks across desktop, narrow, and prototype
views.
`probe-cabin-pass.mjs` passed 15/15 checks for cabin compositing, camera planes,
occlusion, mirrored lighting, and cockpit/chase round trips.
Formatting, script lint, comment lint, whitespace checks, and the production
build passed. The build includes TypeScript checking and bundle-size checks.

The single full host `npm test` run finished with **7,247 passed and one failed**
across 437 files. The failure was `tests/probe-key-labels.test.ts`: the new HUD
probe presses shipped keys by name and lacked the required default-layout label.
The probe now carries that label with its policy link. The failing test and the
FOV regression file passed **8/8 tests** after the correction. Formatting and
comment lint passed again. The full command was not
repeated, as the worker SOP permits one run. The supervisor reruns it on the
committed tree.

Probe selection was inspected with `probe:select`. It selected all 117 probes
because the diff touches shared rendering, settings, and capture infrastructure.
The worker contract explicitly prohibits the full browser suite. The local
browser evidence is therefore a manual affected subset, not a selected PR gate
or a full-suite pass. The supervisor owns the final browser gate and Sage review.

## Merge handoff

The proposed changelog sentence in `src/changelog.ts` needs principal approval
and a merge-date check. The supervisor pushes the worker branch and opens the
pull request. The principal owns the merge and visual approval.
