# Model integration: node #1222, one shared `industrial-surface`

## Current result

- The 14 models named below embed no image. They name `10d4d0776274…` in their
  texture's `SEELITE_shared_image` extension, and `src/shared-image.ts` resolves it to
  `src/models/industrial-surface.webp`, one file of 2,576,194 bytes, fetched and
  decoded once a session.
- The exterior models share one texture object and one GPU texture. The interiors
  hold a second texture over the same decoded image, because `interior-kit.ts`
  writes anisotropy 8 on the map it is handed and three keys its upload on that.
  No anisotropy, bump or material setting changed.
- A loader without the plugin rejects a prepared file. That is deliberate: its
  texture has no `source`, so the failure is an error and not an untextured model.
- No visual approval was spent: the view set did not move (below).
- **A fresh pilot always needs this image at boot.** Every trade station form uses
  it, and `tests/shared-image.test.ts` holds that over all 256 systems of seed 42. So a failed fetch
  normally reaches the Retry panel, and the background path is reached only by a
  save docked at a station that does not use the image.
- **Known limitation: the boot bar.** It counts GLB bytes, so on a cold boot it
  holds at its 99% clamp while the image downloads. Nothing was changed there.
- Re-exporting a model embeds the image again. Prepare it again; the test names it.

## Asset and geometry preflight

Measured against `625e2227`, the commit that holds the embedded originals.

- **Preparation:** `node scripts/share-model-image.mjs`. A second run leaves every
  file as it is. The bytes of every other buffer view are moved, not re-encoded.
- **Models:** `coriolis`, `outpost-buoy`, `outpost-cluster`, `outpost-derrick`,
  `outpost-rig`, `outpost-salvage`, `shipyard-foundry`, `shipyard-gantry`,
  `shipyard-slipway`, `station-interiors`, `trade-assembly`, `trade-drum`,
  `trade-ring`, `trade-wheel`.
- **Sizes:** 108,641,924 bytes before and 72,572,112 after, plus the one image: 33,493,618
  bytes smaller on disk. Each model is smaller by 2,576,304 to 2,576,560 bytes.
- **Host limit:** `npm run build` runs `scripts/check-dist-sizes.mjs`, which passed.
  `dist/assets` lists `industrial-surface-C-EtNNC-.webp` once.
- **Attributes:** `tests/shared-image.test.ts` decodes every prepared model through
  `GLTFLoader` and meshopt and compares the digest of every node transform, attribute
  and index, and of the materials, meshes, nodes, scenes and samplers, against
  `tests/fixtures/shared-image-originals.json`, generated from the originals.
- **Texture:** `node scripts/verify-shared-image-decode.mjs 625e2227` decodes each
  prepared model and its original in Chromium on ANGLE Metal: 1254x1254, 0 of 6,290,064
  bytes differ for all 14, and `flipY`, `colorSpace`, wrap, filters, anisotropy,
  mipmap flag, format, type and premultiplication match.
- **Collision proxies:** regenerated, because they pin each file's hash. Only the pinned
  hashes changed; every fitted box is byte-identical, which is a second check on the
  geometry.
- **Assumptions:** nothing reads the embedded image directly. `coriolis-detail` and the
  ring and drum details find their map by texture name, so the shared texture keeps the name
  `industrial-surface`. The shipyards' image was named `coriolis-industrial-surface`, and
  nothing reads that name. The shipyard lightmap is a separate file and unaffected.

## Runtime and performance evidence

| Path | Result |
| --- | --- |
| Boot and cold download | Boot set unchanged. The image adds one request after the home GLB. Bar: see the limitation above. |
| Background installation | Unchanged path; one fewer decode for each model after the first. |
| Interrupted or failed load | `probe-shared-image`: boot failure offers Retry, builds no Game, retry refetches and boots, nothing unhandled. Background failure is checked on `ModelQueue` with the real outpost loader, not on a live `Game`, for the reason above; `probe-model-queue` holds what a `Game` does with a failed model. |
| Postcard/export | Reaches the same loaders through `requireModels`; `probe-postcard` is in the gate. |
| Flight and traffic | No geometry changed; covered by the selected probes. |
| Jump during install | Not touched; the registry holds no per-system state. |
| Repeated rebuild and teardown | `probe-shared-image`: one model torn down, the other's frame reads the same bytes and the GPU texture count holds. |
| Rotation and render layers | Not touched. |

`probe-shared-image` also measures, on a renderer of its own: 1 GPU texture for two exterior
models, 2 with the interiors, and 1 image request for all three.

**Docked Coriolis, cold**, `scripts/measure-docked-coriolis-cold.mjs`, seed 42 system 4:
5 runs of each arm alternating in the order base, head, head, base, base, head, head, base,
head, base, each in a new browser against that checkout's dev server. Renderer ANGLE Metal, Apple
M5 Pro, 1440x900 at scale 2. Load average about 4.3 to 5 with no suite running.

| | Base `625e2227` | Head |
| --- | --- | --- |
| Model, image and binary bytes fetched | 169,659,581 | 154,201,339 |
| Requests for those files | 16 | 17 |
| Renderer textures, whole page | 62 | 61 |
| Station maps holding the image | 3 (anisotropy 1, 1, 8) | 2 (1, 8) |
| Longest frame gap, median of 5 (range) | 217 ms (217 to 250) | 201 ms (200 to 217) |
| Frames over 100 ms, median | 2 | 2 |

- Bytes fall by 15,458,242, which is six copies of the image: this system loads seven models
  that use it. These figures were identical in every run.
- The texture count falls by one because this framing draws two exteriors and one interior.
  The saving grows with the exteriors a session has drawn; this fixture does not measure more.
- **The stall is one 60 Hz frame apart at most, and I do not claim it as a saving.** An
  earlier pair of 5 runs, with another session's unit tests loading the machine to about 6.5 to
  7.3, read 233 ms against 233 ms. What sets this figure was not identified. Within the window
  the instrument saw one texture rise per run, with 15 to 33 ms gaps on both sides of it, so that
  upload is not the longest gap; uploads before the window, at boot, are outside it.

## Delivery evidence

Filled in on the pull request: tests and the browser gate at the final head, and the Sage
rounds with their dispositions.

**View set, 101 views on ANGLE Metal.** `before` and `before2` at `625e2227`, `after` and `after2`
at `6dc7a6af`, diffed with `npm run views:diff` at its 24/255 threshold. 97 views have a
cross-build reading inside their same-build range, and 48 read 0.00% any-change before to after.
Four had every cross-build reading above the same-build ones: `drum-approach`, `drum-flank`,
`duel-console` and `planet-terminator`. Each was captured four more times on each build and
every pairing diffed, which separates them:

| View | Same build, 12 pairings | Across builds, 16 pairings |
| --- | --- | --- |
| `drum-approach` | 0.02 to 0.43% | 0.05 to 0.56% |
| `drum-flank` | 0.04 to 0.62% | 0.04 to 0.68% |
| `duel-console` | 0.00 to 0.01% | 0.00 to 0.01% |
| `planet-terminator` | 0.00 to 0.07% | 0.01 to 0.07% |

The ranges overlap, so none of the four moved. This tool is no gate, and this node asks only
whether the frames match; no appearance changed for the principal to judge.

No changelog entry: `src/changelog.ts` excludes performance tuning and internal changes.

Captures and logs are outside the repository, as the 2026-11-06 ruling asks: `views/` holding
`before`, `before2`, `after`, `after2`; `views-x/` holding `b1` to `b4` and `a1` to `a4`; and
`cold.log`.
