# Node #1160: field-of-view probe ownership review

PR description material for the supervisor. This worker commits locally; the
supervisor opens the PR and carries this review into its description.

## Decision

Both `Game.applyViewFov` and the `Game.layerCameras` getter own
`probe-hud.mjs`, `probe-chase-view.mjs` and `probe-cruise-light.mjs`, through
their script paths in `MAIN_METHOD_ROOTS`. These are contract-specific roots:
using `src/settings.ts` would select every live probe through `LIVE_ROOTS`.
Smoke adds `probe-production-boot.mjs`, `probe-boot.mjs` and
`probe-live-cockpit.mjs`, for six probes altogether.

The reviewed callers are `constructor` (the settings subscription) and `render`
for `applyViewFov`, and `applyViewFov` for `layerCameras`. Probe-side reads of the
getter are evidence, not additional Game callers. `render` itself remains
unowned.

`layerCameras` is an accessor, not a method declaration in TypeScript's AST.
The routing test exposed that its registry entry alone was inert. The parser
now extracts existing getter bodies using the same unchanged-skeleton boundary
as methods. A new getter or method, a deleted getter, a changed signature, a
field, an import or a top-level declaration still expands coverage. Unowned
getters and new callers/collaborators still expand coverage too.

## Which probes observe projection and focal scale?

The review inspected `src/main.ts`, all `scripts/probe-*.mjs` camera/FOV,
`projectionMatrix`, `.project`, `markerNdc` and `focalPx` references, and matching
references in `scripts/lib/`. Reading a projection does not by itself make a
probe a useful FOV contract.

| Probe | Observation and ownership decision |
| --- | --- |
| `probe-hud` | Selected. Presses 7, reads all five camera FOVs and persisted `cockpitFov`, compares off-axis markers with Three.js projection, and checks `g.focalPx` against the renderer height and current FOV. Also checks chase stays at 60 degrees and cockpit wide/normal restoration. It is the only probe that reads Game's cached `focalPx` or drives the FOV setting. |
| `probe-chase-view` | Selected. Compares body projections through near/far cameras with `markerNdc` while orbiting in chase; reads the current FOV for its control. Complements HUD's cockpit toggle with chase marker and muzzle/camera integration. |
| `probe-cruise-light` | Selected. Reads projection matrix focal entries from near, backdrop, far and approach cameras and asserts equal focal scales during live cruise. Also projects sky directions through those matrices. |
| `probe-asteroid-field` | Reads near FOV to choose distances for rock LOD thresholds. Tests the field's pixel-size/LOD law, not FOV switching or camera synchronization. HUD directly checks the cached focal scale the renderer uses. |
| `probe-planet-surfaces` | Projects samples through near/approach/far cameras and derives a planet limb's pixel radius from approach FOV. Tests surfaces and half-resolution edges using the current projection; it does not test FOV propagation. |
| `probe-station-visuals` | Derives fixture pixel spans from near FOV for its lighting measurements; does not test the camera update path. |
| `probe-station-interior-kit` | Records the near projection matrix with its held comparison pose; tests interior appearance, not an expected FOV or a relationship between camera projections. |
| `probe-station` | Projects the slot's long axis to measure its screen angle. Its assertion concerns station roll, not focal scale. |
| `probe-traffic-mouth` | Projects coaming bars to choose the overlap fixture nearest the screen center. Tests depth ordering. |
| `probe-vent-display`, `probe-npc-vents` | Project throats to locate pixel samples; vent-display also uses `markerNdc` for the assist cue. Their contracts concern firing/visibility, not a FOV change. |
| `probe-docking` | Uses `markerNdc` to bound a pixel sample around the aperture. Tests the corridor and entry, not camera propagation. |
| `probe-live-cockpit` | Already smoke. Projects incoming bolts to test visible fire and uses the cockpit-text helper below. |
| `probe-boot`, `probe-cabin-pass`, `probe-chase-orbit` | Read camera position, near/far clipping planes or quaternion, respectively. Those reads are not projection/FOV assertions. Boot is already smoke. |

Shared helpers also read projections. `cockpit-text-probe.mjs` projects cabin
face samples for visibility/occlusion checks in live-cockpit, chase-view,
duel-hud, fire-groups and missiles. `miner-vent-probe.mjs` projects plume samples
for model-queue. `sky-clearance.mjs` reads FOV to measure the sky fixture's frame
extent; `view-placement.mjs` reads it for horizon placement and measurement in
horizon-views. These check their subjects at the current projection; they do
not exercise the FOV setting or assert cross-layer synchronization. Cabin
visibility is also covered by smoke and chase-view.

The other probes have no FOV-specific assertion. Many see rendered pixels, but
that does not make each one an owner of the camera update mechanism. Normal
cockpit and chase start at 60 degrees, and the existing early return leaves
that projection unchanged. Wide-view propagation and stale projection/focal
state have explicit checks in the selected contracts. This ownership review
does not authorize narrowing a future edit to `render`, camera declarations,
`CHASE_FOV_DEG`, or other unowned wiring.

## Verification scope

This is selection policy only: no game source, probe assertion, browser launcher
or renderer behavior changes. Per `CLAUDE.md`, browser evidence is the reviewed
contracts above plus smoke, alongside routing tests. The automatic selector's
infrastructure fallback is recorded separately; this focused scope is a reviewed
policy exception, not an automatic selection or a full-suite pass.

The production-snapshot routing tests require exactly the six-probe set for a
body-only edit to each member. They require all probes when a new
`applyViewFov` caller appears, including caller drift already in the base, and
pin the getter body's declaration/signature boundary.

## Local evidence, 2026-11-05

Implementation commit: `248170f081907ffeef6f8e9e00a3382c54d64f66`.
Base: `0ac662f10629ab0066cda17654f90f366d0a7d30` (`origin/main`).

`bun test tests/probe-impact.test.ts tests/probe-selection.test.ts`: 59 pass,
0 fail. The new routing tests were first run without the ownership entries:
four failed. The getter routing test also failed with entries alone, before
getter-body extraction was implemented.

Typecheck, format check, script lint, comment lint, launcher wiring and
`npm run build` passed. This is internal probe work under the definition in
`src/changelog.ts`, so it adds no public changelog entry.

`npm run probe:select -- --base origin/main --head HEAD` at the implementation
commit selected all 120 probes because `probe-contract-roots.mjs` is harness
infrastructure. The reviewed policy exception used this exact scope:

```sh
SEELITE_PROBE_RENDERER=hardware PROBE_SELECTION=1 \
PROBE_FILES=probe-hud.mjs,probe-chase-view.mjs,probe-cruise-light.mjs,probe-production-boot.mjs,probe-boot.mjs,probe-live-cockpit.mjs \
node scripts/probe-all.mjs
```

The renderer was ANGLE Metal / Apple M5 Pro. This is focused browser evidence,
not a full-suite pass or the automatic selection. An earlier invocation omitted
`PROBE_SELECTION=1`; it was stopped after its full-inventory banner and provides
no evidence.

The six-probe run passed production-boot and live-cockpit. HUD, cruise-light
and chase-view timed out at the initial 20-second readiness wait, then each
passed alone with `npm run probe:one -- <name>.mjs` (33.4, 18.6 and 17.7 seconds,
respectively). Boot first completed 57/58 checks, missing the first readiness
deadline; isolated runs then timed out on later pages, one at peak load 62.0 on
18 cores. An unmodified `origin/main` source archive passed boot twice (125.1
and 123.5 seconds); the final isolated branch run passed all 58 checks in
121.6 seconds at peak load 8.5. The failures do not establish a cause, and the
passes do not establish repeatability. No waits or assertions were changed.

All six focused probes have passing results across these runs; the initial
combined run itself remains 2/6. This does not claim a green combined run or
full regression run. Only the receipt changed after the implementation commit.

The required single full host run, `npm test`, passed immediately before the
final evidence commit: 7,454 tests across 460 files, 0 failures (1,010.37 seconds).
`git merge-base --is-ancestor origin/main HEAD` and `git diff --check` also passed.
