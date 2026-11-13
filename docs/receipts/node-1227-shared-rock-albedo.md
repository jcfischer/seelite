# Node #1227: one shared rock-albedo image

The four refinery models use `src/models/rock-albedo.webp` through the existing
`SEELITE_shared_image` plugin, so the asteroid albedo is fetched, decoded and
uploaded once instead of four times. The image is 2,719,920 bytes, 1254×1254,
SHA-256 `7e3dc547c074ca91cf500ce8075b935be53fd84d5f0bf733fb5b0594cceb9014`.
No material, geometry or sampler setting changes. `asteroids.glb` and the field
rock tile are untouched: this image is the refinery asteroid's own albedo, used
by the `mineral-bedrock`, `mineral-dark` and `mineral-pale` materials.

## Preparation and exactness

Baseline: `58a5c2a2`, this branch's starting main, which already shares
`paint-wear` (#1226) with the same four files. Preparation is
`node scripts/share-model-image.mjs`; the image table gained a third entry
(`ROCK_ALBEDO`) and the script itself needed no change, because #1226
generalized it. Re-running it leaves every other prepared model byte for byte:
the run reprinted the 20 already-prepared files and rewrote only the four named
here.

| Model | Original bytes | Prepared bytes | Removed by this node |
| --- | ---: | ---: | ---: |
| refinery-collar | 8,058,512 | 3,170,960 | 2,720,196 |
| refinery-spar | 9,865,112 | 4,977,516 | 2,720,244 |
| refinery-warren | 8,495,924 | 3,608,380 | 2,720,192 |
| refinery-works | 9,597,240 | 4,709,692 | 2,720,196 |

The four files held 10,880,828 bytes of rock-albedo (its 2,719,920 bytes plus
the buffer-view padding the removal compacts), and one copy of the image now
ships: **8,160,908 bytes saved**. That is the node's ~8.2 MB.

- `tests/shared-image.test.ts` pins each original's decoded attributes, indices
  and material/node/scene/sampler JSON in `tests/fixtures/shared-image-originals.json`
  (recorded before preparing the assets, so `bytes` is the fully embedded
  original). All four still match, and the removal is now asserted against the
  images each model uses rather than against a single image's size, so a model
  that shares two images is checked by the same rule as one that shares one.
- The same test asserts, per prepared model, that each texture names its
  registered hash, that the file embeds no image, that the file is left
  byte-identical when the preparation is re-applied for every image it uses,
  and that a load through the production plugin yields those maps with the
  embedded settings (`flipY` false, sRGB, repeat wraps, linear-mipmap, mipmaps,
  anisotropy 1). That is criterion 1's headless half.
- `scripts/verify-shared-image-decode.mjs 357676d9 rock-albedo` on ANGLE Metal /
  Apple M5 Pro decoded each prepared file and its embedded original (at
  `357676d9`, where all four still embed both images) through the production
  loader and compared every texture: 1254×1254, **0 of 6,290,064 RGBA bytes differ** on
  every map, with flip, colour space, wraps, filters, anisotropy, mipmaps,
  format, type and premultiplication equal. Each model reports two maps, so the
  already-shared `paint-wear` is re-checked beside the new one.
- Regenerated `src/refinery-proxies.ts`: only the four source hashes change; all
  fitted boxes are byte-identical (1,183/5,236; 1,632/1,745; 945/3,151;
  4,196/4,912 rock/plant boxes).
- `readSharedModel` resolves the same table for glTF-Transform, so the
  instruments that read prepared files follow the new image by path.
- `npm run build` passes the host's 25 MiB per-file guard and emits exactly one
  `rock-albedo-Brz8sJ48.webp` (2,719,920 bytes) in `dist/assets`, beside the four
  prepared GLBs (3,170,960 / 4,977,516 / 3,608,380 / 4,709,692 bytes). That is
  criterion 3.

## Runtime

`probe-shared-image` passes 31/31 on ANGLE Metal / Apple M5 Pro, having gained a
`rock-albedo` case beside `industrial-surface` and `paint-wear`. Each case runs
the same five checks over its own pair of models:

- A refinery-warren and a refinery-spar hand the renderer one texture object and
  one GPU texture, from one request. Drawing their maps changes an isolated
  renderer's texture count 0 → 1 → 1. That is criterion 4, on two of the four
  forms.
- A named owner (a third form) adds one GPU texture over the same decoded image,
  and writing anisotropy there leaves the exteriors at 1. Criterion 5's other
  half: the probe then disposes the first model and reads the survivor's frame
  back pixel for pixel, unchanged, with the renderer still counting its texture.
- A boot that needs the image and cannot fetch it offers Retry and builds no
  Game; the retry fetches it again and boots with nothing unhandled. No fresh
  pilot's home is a refinery, so the arm boots the full model set, which is the
  only way a refinery reaches a boot. That is criterion 6's first half.
- A background load through the real `prepareRefineryModel` fails in
  `ModelQueue`, warns once, and a later call fetches again rather than reusing
  the failed promise.
- A live `Game` at seed 42, system 0 (whose refinery is form `a`) keeps the
  procedural refinery drawn when the image will not fetch, with no unhandled
  rejection, and a later load refetches and installs the authored exterior. That
  is criterion 6's second half.

## Canonical views

Three full sheets per build, 118 views each, on ANGLE Metal / Apple M5 Pro,
seed 47 or each recipe's declared override, 1440×900 and default High quality.
The baseline is an isolated copy at `/tmp/node-1227-base`: its 3,171 tracked
files were checked against their Git blobs at `58a5c2a2` and all match, with
only the instrument copied in. Its dependency tree is a hardlink copy and its
Vite cache its own, so no transform was shared between the two servers. The
manifests record both serving roots; the baseline's say `no-git` because the
copy has no Git metadata.

At the repository's unchanged 24/255 summed-RGB threshold, with six same-build
and nine cross-build pairings per view: **78 of 118 views have every cross-build
pairing at or below the same-build maximum**. The 40 that do not are noise the
same build also produces, and the two effects that produce it are visible in the
pairing tables:

- **The clock.** The sheet pins `GAME_TIME_S` at boot and then lets the clock
  run, so a view's station phase depends on how long the earlier views took, and
  the build that fetches 8 MB less reaches a given view earlier. `ring-approach`
  shows it directly: cross pairings read 5.30% at ΔgameTime 0.115 s and 2.04% at
  0.021 s, while that build's own pairings read 1.39% at 0.002 s and 5.62% at
  0.136 s. The difference tracks the phase, not the build.
- **Within-session state.** Runs of one build on consecutive sessions separate
  as far as the cross pairing does. An interleaved set (`--only
  cruise-light-chase,coriolis-flank,station-refinery-axis,refinery-cradle-berth`,
  two runs per build, base and head alternating) reads: `cruise-light-chase`
  same-base 0.098%, same-head 0.653%, cross 0.010% in one session and 0.660% in
  the other; `coriolis-flank` same-base 0.372%, same-head 0.844%, cross
  0.89–1.39%. The view that cost the largest apparent separation in the full
  sheets was a state both builds enter.

The tone instrument over the same sheets agrees and is the cleaner reading: over
118 views and the sheet average, six views' mean or p99 ranges are disjoint
between builds, the largest mean gap is **0.16 luma codes** (`ring-approach`,
whose p99 moves by one code), and every other view's ranges overlap.

The two views this change actually draws read: `station-refinery-axis`
same-build 0–0.086% against cross-build 0.077–0.102% (and 0.087% in the
interleaved set), `refinery-cradle-berth` same-build 0.108–0.133% against
cross-build 0.104–0.158% (0.117–0.120% interleaved). Both are inside their
same-build envelopes once the runs are interleaved, and their means differ by
0.02 codes. No view separates from its same-build noise, and no appearance
approval was spent. These ranges do not prove mathematical equality; the
stronger evidence is the exact decoded image and settings above. The
`refinery-cradle-berth` and `station-refinery-axis` frames were opened for
inspection and are indistinguishable.

Artifacts, outside the repository: `/tmp/node-1227-base/view-set/{base1,base2,base3}`,
`view-set/{head1,head2,head3}`, `view-set/focus-{base,head}-{1,2,3}` (ring views)
and `view-set/f2-{base,head}-{1,2}` (interleaved set). The comparators are
`/tmp/node1227-view-compare.json`, `/tmp/node1227-view-summary.json` and the
`levels.txt` each run writes. The full sheets and their contact sheets are in
`view-set/`, which is gitignored.

## Cold session drawing two refinery forms

`scripts/measure-refinery-bollard-cold.mjs --refinery-forms` (new mode, #1227;
its default arm is #1226's and is unchanged). Three new-browser loads per build,
alternating base and head against the two Vite dev servers, seed 2, High,
1440×900 at device scale 2 (buffer 2880×1800), ANGLE Metal / Apple M5 Pro. The
generator puts at most one refinery in a system, so the fixture draws the
system's own refinery and then a second form built by the same production
`buildStationForm` and drawn at the same body; the second phase is timed
separately so the cold-install stall still belongs to the model install.

| Measurement | Base 58a5c2a2 | Head |
| --- | ---: | ---: |
| Asset bytes fetched, identical in every run | 226,919,941 | 218,759,033 |
| Asset requests | 35 | 36 |
| `rock-albedo` requests | 0 | 1 |
| The four refinery GLBs' bytes | 27,347,376 | 16,466,548 |
| rock-albedo textures across the two drawn forms | 2 | 1 |
| Longest frame gap (cold install) | 250, 250, 250 ms | 267, 233, 250 ms |
| Frames over 100 ms | 1, 2, 2 | 2, 2, 2 |
| Second form's build (instrument, not install) | 1,097 ms ×3 | 1,097 ms ×3 |

Bytes fall by exactly 8,160,908, matching the four prepared models plus the
shared image. The two drawn forms keep one albedo texture instead of two. Frame
gaps are vsync-quantised and the ranges overlap; these three runs do not
establish a stall saving, and the whole-page `renderer.info.memory.textures`
delta for the second form (7 on both builds) is not attributed to the image —
the per-image GPU count is the isolated-renderer probe's evidence, not this
one's.

Logs: `/tmp/node1227-{base,head}-forms-{1,2,3}.json` and the single
`/tmp/node1227-head-default.json`, which re-ran #1226's own arm on the prepared
assets and reported its `paint-wear` map counts unchanged.

## Live probe and gates

`npm run probe:pr -- --base origin/main --head HEAD` selects and runs the probes
this diff can affect; the supervisor runs it on the final head. Headless:
`npx tsc --noEmit`, `npm test`, `npm run build`, `npm run lint:comments`,
`npm run format:check`, `npm run lint` and the wiring check.

## Review and delivery

Ranger implemented the node on `node/1227-share-one-rock-albedo-image-across-the-4-refiner`;
the supervisor pushes, the gates and the principal's merge remain theirs. No
graph node was claimed, closed or edited here.
