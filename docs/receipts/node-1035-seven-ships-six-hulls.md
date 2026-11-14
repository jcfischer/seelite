# Model integration: node #1035, the other six hulls of the seven ships

## Current result
- Design: PR #829 (`origin/design/seven-ships-codex`, checkpoint `e96d393`). The
  hulls are the Warden (patrol), Pilgrim (explorer), Shiv (raider), Bastion
  (carrier), Sluice (prospector) and Rampart (dreadnought). No visual redesign.
- Shipped files, Full level only (the game makes its own distance levels from
  `src/authored-levels.ts`, as for the Lance):

| File | Bytes | sha256 |
| --- | --- | --- |
| `src/models/warden-patrol.glb` | 15139996 | 19a88c432afba5f672cae5d03866bed503dae973630af062befdc3c86b41ed2d |
| `src/models/pilgrim-explorer.glb` | 16798472 | 491678a096ad32b1e8ddb2ffda5f100c04a39a12001823da71be50250aab016e |
| `src/models/shiv-raider.glb` | 15721260 | 7787a3ce045d0e67f4311db9cfd86b430c2b211bb9ecdd0642691dd46b65b70c |
| `src/models/bastion-carrier.glb` | 21950512 | ca747b400f84bf0e3f040c6d136ffd20373d13e41931faae7407ccd573056a0a |
| `src/models/sluice-prospector.glb` | 8252584 | b28283533018020548974f4975bcc75918dbc359060d10b13b7746d16a522fdb |
| `src/models/rampart-dreadnought.glb` | 20167256 | 8dc04e9da656e17d1d3e8c406764fead88453bd3d8c387dcf42591285fcced57 |

- Mapping and install: `src/seven-ships-hulls.ts` (loaders, level names,
  habitat rotors); URLs in `src/model-urls.ts`; install through the background
  queue, the procedural hull standing in until the swap.
- Rulings applied: authored dimensions kept; envelopes and collision updated
  (2026-11-01); the Rampart lossy (2026-11-05); the Bastion takes the Rampart's
  lossy recipe (2026-11-13).
- Open gates: browser tier (`npm run probe:pr`), Sage, the before/after view set
  and the principal's fly-through (`ranger:needs-eye`).

## Asset and geometry preflight
- Command: `node spikes/seven-ships/prepare-game-asset.mjs <role> [source.glb]`.
  Lossless for the Warden, Pilgrim, Shiv and Sluice (16-bit normals, Meshopt
  `NONE` filter, lossless WebP; the wear map then shared as
  `src/models/steel-wear.webp` by `scripts/share-model-image.mjs`).
- Bastion (the 60.1 MB source previously came out at 25,205,076 bytes, 205,076
  over): UVs are stored as normalised 16-bit under one `KHR_texture_transform`
  per base-colour texture, the wear map is lossy WebP quality 80 and embedded
  (the sharing script refuses a texture transform), positions and triangles stay
  exact. Result 21,950,512 bytes. Measured by the script and asserted: worst UV
  error 1.112e-4 against a 2.217e-4 quantisation step (limit one step), mean
  pixel error 2.017/255 (limit 3).
- The Rampart's file is as approved on 2026-11-05 (16-bit positions, 8-bit
  normals, 16-bit UVs under a texture transform, lossy WebP); the prepare script
  does not regenerate it.
- Every file is under 25,000,000 bytes (largest 21,950,512);
  `node scripts/check-dist-sizes.mjs dist` passes after `npm run build`.
- `tests/seven-ships-hulls.test.ts` decodes each GLB through the production
  loader and checks the study's box in metres, the declared envelope and centre,
  berth rows and the habitat turn rates.

## Runtime and performance evidence
- Level switching with hysteresis and the habitat turn rates are held by rows in
  `tests/seven-ships-hulls.test.ts` through `ShipLevels`, as for the Lance. The
  failed-download behaviour is the shared background queue's and was not
  re-measured here.
- No frame-cost measurement was taken in this session.

## Delivery evidence
- Headless: `bun test` on the shared-image, model-url and seven-ships files
  passed (196) after merging `origin/main` (including node #1250).
- Full `npm test` after merging main: 19 failures, all in consumers that assume
  every purchasable or Traffic hull fits an internal berth (the swept Pilgrim,
  Bastion and Rampart no longer do). Unresolved; see the blocked note.
- Pending: `npm run probe:pr`, Sage review, view set before/after, principal yes.

## Historical measurements
- Before the 2026-11-13 ruling the Bastion shipped lossless at 25,205,076 bytes
  with the shared wear map; superseded by the lossy-UV file above.
