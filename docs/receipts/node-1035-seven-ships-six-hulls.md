# Model integration: node #1035, five hulls from the seven-ship studies

## Current result

- Design: PR #829, accepted checkpoint `e96d393`; its studies are present through
  the squashed Lance integration (#1034), rather than as an ancestor commit.
  All five Full-source LFS hashes match the binaries at `e96d393`. Warden
  (patrol), Shiv (raider), Sluice (prospector), Bastion (carrier) and Rampart (dreadnought) keep their authored dimensions and appearance.
- The delegated ruling of 2026-11-14 excludes Pilgrim. Explorer retains its
  current procedural model, complete `HULL_SPECS` row, vents, display reach,
  purchase eligibility and internal berths. Its authored GLB and queue entry do
  not ship. Its later integration belongs to the oversized-visits chain.
- Full GLBs only; `src/authored-levels.ts` makes the game's distance levels,
  selected with `ShipLevels` hysteresis. Study LODs remain reference assets.
- `src/seven-ships-hulls.ts` installs through the shared background queue. A
  procedural hull stands in until its model installs; shared failure handling
  retains it and warns once. This runtime policy is distinct from the retired
  generated-plating probe and tear-view fixtures, which have been removed.
- Truthful geometric/collision envelopes and measured vent placements replace
  the five hulls' previous rows. Mass, thrust, hold, fuel, slots and prices stay
  unchanged. Bastion and Rampart remain non-purchasable capitals without internal
  berths. No external-visit, shuttle or player purchase policy is added here.
- Traffic carrier identities and saved baselines stay unchanged on top of #1250;
  no Traffic golden is re-pinned and no save/generator version is bumped.

| Shipping Full file | Bytes | sha256 |
| --- | ---: | --- |
| `src/models/warden-patrol.glb` | 15139996 | 19a88c432afba5f672cae5d03866bed503dae973630af062befdc3c86b41ed2d |
| `src/models/shiv-raider.glb` | 15721260 | 7787a3ce045d0e67f4311db9cfd86b430c2b211bb9ecdd0642691dd46b65b70c |
| `src/models/sluice-prospector.glb` | 8252584 | b28283533018020548974f4975bcc75918dbc359060d10b13b7746d16a522fdb |
| `src/models/bastion-carrier.glb` | 21950512 | ca747b400f84bf0e3f040c6d136ffd20373d13e41931faae7407ccd573056a0a |
| `src/models/rampart-dreadnought.glb` | 20167256 | 8dc04e9da656e17d1d3e8c406764fead88453bd3d8c387dcf42591285fcced57 |

## Asset and geometry preflight

- Preparation: `node spikes/seven-ships/prepare-game-asset.mjs <role> [source.glb]`.
  Warden, Shiv and Sluice keep exact positions, triangle surfaces and texture
  pixels; normals use 16-bit quantisation, Meshopt uses its lossless NONE filter,
  and WebP is lossless. Their wear map is shared in `src/models/steel-wear.webp`.
- Bastion uses the principal-approved lossy recipe of 2026-11-13: normalised
  16-bit UVs under `KHR_texture_transform`, embedded WebP quality 80, exact
  positions and triangles. Preparation measures and asserts UV/pixel errors:
  worst UV error 1.112e-4 against a 2.217e-4 quantisation step (limit one step),
  mean pixel error 2.017/255 (limit 3).
- Rampart retains the approved 2026-11-05 export: 16-bit positions, 8-bit normals,
  16-bit UVs under a texture transform and lossy WebP. The preparation script
  does not regenerate that historical export.
- Every shipped hull is under 25,000,000 bytes. The build and
  `node scripts/check-dist-sizes.mjs dist` pass; Bastion is largest at 21,950,512.
- `tests/seven-ships-hulls.test.ts` decodes the shipping GLBs through the
  production loader, measures their study boxes, checks centred envelopes and
  berth answers, pins bytes/hashes and checks the capitals' 189.492 m outer rings.
- Metres, Y up, +Z forward become kilometres and -Z forward once in the shared
  authored builder. Full geometry owns mounts, muzzles, vents and bounds.

## Runtime and visual evidence

- Bastion and Rampart retain 180 m walking-floor diameters at 2.5 RPM. One phase
  from `world.gameTime` is applied to all three levels; switching levels retains
  the phase. Headless rows cover both hysteresis directions and the phase;
  `scripts/lib/seven-ships-probe.mjs`, called by `probe-model-queue`, exercises
  the live fleet render loop at two clock values.
- Five canonical chase views cover lever #1035, one per shipped hull, using the
  Lance's camera, lighting and planet framing; capitals use 4x chase zoom
  so the camera is outside their hulls. The inspection fixture uses the game's existing hull setter without
  changing purchase eligibility, then checks the requested mesh and catalog
  model state; the same views can capture main before integration. The derelict-tear view, its close-placement fixture and
  lever #735 are retired by the 2026-11-13 ruling; the plain wreck view remains.
- Renderer for this session: ANGLE Metal, Apple M5 Pro, hardware lane. No
  steady-state frame-cost or cold-install stall measurement is claimed.

## Delivery evidence

- Split regression observed red with six production hulls, then green after
  removing Pilgrim. Affected geometry/docking/vent/save checks: 391 passed.
  Traffic baseline/fingerprint checks pass without changing goldens.
- The single required full `npm test` run completed with 8,013 passes and two
  failures (8,015 tests, 495 files, 756.18 s): a carrier collision fixture began
  0.8 m overlapped because it omitted both hull centres; the Shiv crossing
  radius was 4 cm below the display reach rounded up to 0.1 m. The fixture now
  asserts a measured 20 m starting gap. The production crossing radius rounds
  up to the same 0.1 m precision; the existing reach-agreement assertion stays
  unchanged. This changes only the visual crossing lead, not carrier identity,
  its schedule or saved history. No Traffic golden is re-pinned.
- After those corrections, all 139 tests in the collision, crossing, station
  route, inter-system Traffic and oversized-baseline files pass. The added cube
  precision test was observed red first. Logs: `/tmp/node-1035-npm-test.log`,
  `/tmp/node-1035-final-corrections.log`. Per the worker's one-full-run limit,
  the supervisor still owes the complete final-tree rerun; no clean full-suite
  run is claimed here.
- Build, standalone typecheck, formatting, script lint and comment lint pass.
- Hardware `probe-model-queue`: 42/42 checks passed (224.2 s), including the
  ten new live fleet/phase checks and the existing failure, jump, swap and
  full-model boot checks. Log: `/tmp/node-1035-model-queue.log`.
- Five before and five after canonical frames captured and opened, with both
  capital cameras outside their hulls. Sheet: `/tmp/node-1035-views/index.html`;
  comparison image: `/tmp/node-1035-views/comparison.png`. Baseline production
  sources are an archive of `origin/main` (`6398a3ab`) with only the current
  capture fixtures overlaid; its manifest correctly reports `no-git`. After
  captures identify this branch at `05c38d72-dirty`. These are selected hull
  views, not a capture of every canonical view, and are not principal approval.
- Inter-system Traffic: 19/19 hardware checks passed again after the crossing
  precision correction, with the unchanged carrier fixture (34.6 s,
  `/tmp/node-1035-traffic-final.log`). Its first run
  exceeded the 20 s boot deadline even alone; main passed the same probe in
  11.6 s. Forced `models-full` fixtures now use the existing 120 s install
  deadline. The readiness predicate, 20 s player-boot default and explicit
  budgets stay unchanged; the distinguishing guard test was red before the
  repair and passes afterward (23 affected guard/timing tests).
- Shipyard: 24/24 hardware checks passed (148.8 s), including the unchanged
  explorer purchase, delivery, save and reload paths. Log:
  `/tmp/node-1035-shipyard.log`. Together these are three focused probes with
  85 passing checks; 121 other probes were not run on the integration tree.
- The selector requests all probes because of shared `Game` rendering and
  probe-readiness changes. The worker
  contract reserves the full suite and PR/review actions for the supervisor;
  focused checks here are not a `probe:pr` or full-suite pass.
- Pending merge gates: supervisor's full unit rerun, browser gate and Sage review; principal's
  view-set/fly-through yes, and approval of the new changelog sentence.

## Historical measurements

- Before the 2026-11-13 ruling, Bastion's lossless export was 25,205,076 bytes;
  the approved lossy export above supersedes it.
- The six-hull implementation at `05c38d72` recorded 19 full-unit failures while
  Pilgrim's enlarged envelope was active. The 2026-11-14 five-hull split restores
  its previous geometry rather than accepting those failures or re-pinning
  Traffic identities. Pilgrim's former 16,798,472-byte production file is removed.
