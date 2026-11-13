# Node #1226: one shared paint-wear image

The six shipping models use `src/models/paint-wear.webp` through the existing
`SEELITE_shared_image` plugin. The image is 2,167,324 bytes, SHA-256
`54aabd254dce4e6a9c78e5beb6320c14e7c4506dc39f2329a6c34f11bbfafc1d`.
No material, geometry or sampler setting changes. Rock-albedo remains embedded.

## Preparation and exactness

Baseline: `357676d9`, the worker's starting main. Preparation is
`node scripts/share-model-image.mjs`; its table now supports several shared
images and files containing other images. Only the selected image's uses must
satisfy the registry's base-colour/UV/sampler contract. Unsafe fallback sources
and non-BIN images are refused. Another registered image can be prepared before
or after the first; tests cover both orders and an already-prepared partial file.

| Model | Original bytes | Prepared bytes | Removed bytes |
| --- | ---: | ---: | ---: |
| bollard-tug | 17,461,196 | 15,293,768 | 2,167,428 |
| longwall-miner | 11,680,724 | 9,513,116 | 2,167,608 |
| refinery-collar | 8,058,512 | 5,891,156 | 2,167,356 |
| refinery-spar | 9,865,112 | 7,697,760 | 2,167,352 |
| refinery-warren | 8,495,924 | 6,328,572 | 2,167,352 |
| refinery-works | 9,597,240 | 7,429,888 | 2,167,352 |

Total: 65,158,708 → 52,154,260 bytes of GLBs, plus one 2,167,324-byte image:
**10,837,124 bytes saved**.

- `tests/shared-image.test.ts` pins the originals' decoded transforms, every
  attribute and index, and material/node/scene/sampler JSON. All six match.
  The fixture was recorded before preparing the assets.
- All 14 industrial-surface prepared hashes are unchanged. Additionally,
  running the generalized extractor against their embedded originals at
  `625e2227` reproduces every shipping file byte-for-byte.
- `scripts/verify-shared-image-decode.mjs 357676d9 paint-wear` on ANGLE Metal /
  Apple M5 Pro compares all six files and all ten maps (including each refinery's
  rock-albedo): 1254×1254, zero of 6,290,064 RGBA bytes differ per map. Flip,
  colour space, wraps, filters, anisotropy, mipmaps, format, type and
  premultiplication match.
- Regenerated `src/refinery-proxies.ts`: only the four source hashes change;
  all fitted boxes remain byte-identical.
- The authored-hull, Longwall and refinery loaders register the production plugin.
  None of these consumers writes sampler settings on paint-wear; they share the
  default owner. The registry and teardown mechanism are unchanged.
- `readSharedModel` resolves the same preparation table for glTF-Transform.
  The authored-paint instrument runs on prepared files and tests assert the image
  hashes it reads. The install-stall instrument registers the plugin too.
  Bollard's asset test follows the shared hash to the image identity.
  `hull-luma.mjs` pins the untouched courier, so its hash remains valid.
- `npm run build` passes the host's 25 MiB per-file guard and emits exactly one
  `paint-wear-6g2z3g5l.webp` in `dist/assets`.

## Runtime

`probe-shared-image` passes 20/20 on ANGLE Metal / Apple M5 Pro:

- A Bollard and refinery hand the renderer one paint-wear texture, fetched once.
  Drawing their maps changes the isolated renderer's texture count 0 → 1 → 1.
- Tearing down the first model preserves the survivor's rendered pixels and GPU
  texture. A separate named-owner test also holds, without assigning a separate
  owner to any production paint-wear consumer.
- A failed full-set boot reaches Retry, builds no Game and refetches successfully.
  Several sequential loaders may retry an already-failed image within that boot;
  the successful Retry adds one request. No rejection is unhandled.
- The real Bollard loader fails safely in ModelQueue. A live Game also keeps the
  procedural Bollard when the image fails; a later load refetches and installs
  the authored hull. No rejection is unhandled in either case.

A fresh pilot's ordinary boot needs the home trade exterior and cockpit, neither
of which uses paint-wear. The full-model boot flag deliberately exercises the
Retry path for this image. Background models otherwise use the existing queue;
postcards reach the same loaders. No queue, system-lifetime or swap policy changes.

## Canonical views

Three full captures per build, 118 views each, on ANGLE Metal / Apple M5 Pro,
seed 47 or each recipe's declared override, 1440×900 and default High quality.
The baseline is an isolated copy: 822 tracked source, asset, harness and config
files were checked against Git blob hashes at `357676d9`. Its dependency copy and
Vite cache are independent of the worktree. The manifests record both serving
roots; baseline manifests say `no-git` because the copy has no Git metadata.

At the repository's unchanged 24/255 summed-RGB threshold, 112 views have
cross-build ranges overlapping their same-build controls (six same-build and
nine cross-build pairings per view). Fifty-six views have no pixels above that threshold in
any cross-build pairing. Six recipes initially separated; four additional
focused captures per build were taken with the same canonical placers and
settings. The table pools all seven captures per build, including every initial
and follow-up pairing, without changing a threshold.

| Recipe | Same build, 42 pairings | Across builds, 49 pairings |
| --- | ---: | ---: |
| drum-approach | 0.004–1.560% | 0.014–1.608% |
| station-flank | 0.020–0.174% | 0.021–0.169% |
| station-outline | 0.002–0.047% | 0.005–0.045% |
| docking-notice-let-go | 0.005–2.641% | 0.017–2.639% |
| cruise-light-chase | 0.000–0.570% | 0.000–0.314% |
| asteroid-field-charted-close-cockpit | 0–1 pixels | 0–1 pixels |

The last recipe's initial separation was one pixel; it is stated in pixels to
avoid rounding a nonzero reading to zero. All six pooled ranges overlap. No
view separates from its controls, and no appearance approval was spent. These
ranges do not prove mathematical equality; the stronger evidence is the exact
decoded image/settings/attribute comparison. The Bollard chase and Coriolis
flank before/after frames were also opened for inspection.

Artifacts: `/tmp/node-1226-views/` holds the six complete runs and full sheet;
`/tmp/node-1226-views-x/` holds the eight focused runs and their sheet.
`/tmp/node-1226-view-comparison.json` and
`/tmp/node-1226-focused-comparison.json` hold the initial and focused pairings;
`/tmp/node-1226-pooled-comparison.json` holds every pooled pairing. The comparators
are `/tmp/node-1226-compare.mjs` and `/tmp/node-1226-compare-pooled.mjs`, using
the same arithmetic as `views:diff`.
The first focused run captured its frames successfully but its sheet refused a
mixed full/scoped output folder; separating the folders and rebuilding with the
repository's `contactSheet` resolved that artifact-layout error.

## Cold session: refinery and Bollard

`scripts/measure-refinery-bollard-cold.mjs`, five new-browser loads per build,
ordered base, head, head, base, base, head, head, base, head, base, against Vite dev
servers (not production previews). Seed 2,
Bollard in chase view beside the refinery, High, 1440×900 at device scale 2
(actual buffer 2880×1800), ANGLE Metal / Apple M5 Pro. One-minute host load
ranged 1.33–2.31. No other suite, capture or reviewer ran alongside it.

The window starts after the driver's boot/sky-readiness observation and runs
through 120 settled frames. Work before that window is excluded. The watcher starts before
waiting for model settlement. The instrument refuses
load/refresh failures, duplicate Three.js instances and missing paint maps on
either subject. Asset bytes are the completed GLB/WebP/bin responses, excluding
application-module bytes.

| Measurement | Base 357676d9 | Head |
| --- | ---: | ---: |
| Asset bytes fetched, identical in every run | 237,757,065 | 226,919,941 |
| Asset requests | 34 | 35 |
| External paint-wear requests | 0 | 1 |
| Paint maps on refinery and pilot roots | 2 | 1 |
| Longest frame gap, median of 5 | 283.3 ms | 250.1 ms |
| Longest-gap range | 266.2–284.5 ms | 250.0–266.7 ms |
| Frames over 100 ms, median | 1 | 1 |

Bytes fall by exactly 10,837,124, matching the six prepared models plus the shared
image. The isolated renderer test above establishes the per-image GPU count.
Whole-page counts in the raw logs include every drawn actor and render target;
their drop is not attributed here and is not used as per-image evidence.
Frame gaps are vsync-quantised, with the longest gaps close to 15–17 refresh
intervals at 60 Hz. The stall ranges overlap; these five runs do not establish
a general stall saving.

The first exploratory pair used a baseline with symlinked dependencies. Duplicate
Three.js instances caused the Assembly to fall back, invalidating that pair; it
was excluded and preserved as `/tmp/node-1226-cold-invalid-{base,head}.log`.
All figures above come from the corrected independent-dependency runs:
`/tmp/node-1226-cold-{base,head}{1..5}.log` and
`/tmp/node-1226-cold-summary.json`.

The final instrument awaits completed request-size reads, fails on size-read
errors, and checks the fixture refinery by id. A hardware rerun after those
changes reports the same 226,919,941 bytes, 35 asset requests, one paint-wear
request and one paint map across refinery and pilot. Its log is
`/tmp/node-1226-cold-final-instrument.log`; it is a compatibility check and is
not added to the five-per-build comparison above.

The original install-stall instrument also completed on the prepared assets with
`RUNS=1`; this was a parser/install compatibility check, not a performance sample.
Its log is `/tmp/node-1226-install-compat.log`.

## Review and delivery

The worker's Claude source audit passed for the shipping six. Its initial diff
review identified conflicting fallback sources and non-BIN images; both now
have observed red-to-green rejection tests. Remaining observations concern GLB
shapes outside this pipeline, not a finding on the six exports.

This is an internal asset/performance change, excluded from the major-change
definition in `src/changelog.ts`; no changelog entry is added.

Captures and raw logs remain outside Git under `/tmp/node-1226-*`.

Local gates: final `npm run build` (including TypeScript and the 25 MiB host-size
check), `format:check`, `lint`, `lint:comments`, `check:wiring` and
`git diff --check` pass. The affected headless preflight passed 163 tests in
`shared-image`, `bollard-asset`, `authored-hull-paint` and `refinery-flight`.
The single full `npm test` run passed immediately before the final commit:
7,857 tests across 489 files, zero failures, 553.29 seconds on this host.
Its log is `/tmp/node-1226-full-test.log`.

Manual GPU contracts passed: `probe-shared-image` (20/20), `probe-model-viewer`,
`probe-model-download`, `probe-model-queue`, `probe-ship-visuals`,
`probe-station-visuals`, `probe-postcard`, `probe-production-boot` and
`probe-miner-cockpit`. The latter eight ran through the filtered repository
runner. These are affected-contract passes, not a PR-gate or full-suite pass.

`probe:select -- --base origin/main --head HEAD` requests all 124 probes because
preparation/instrument paths lack a dependency owner. The explicit worker SOP
reserves the full browser suite for the supervisor, so `probe:pr` was not run;
its repository-selected gate remains pending with the supervisor. No selection
policy or threshold was changed to narrow it. Sage review and merge also remain
with the supervisor and principal.

## Sage round 1: Ready to report

The shared-image probe now keeps per-image URLs, preparation arguments, boot
flags and request-count predicates in a case table. Boot, queued-background and
live-Bollard failures use one `blockedPage` harness for request counting,
unblocking and unhandled-rejection collection. All 20 existing checks pass both
before and after the refactor on ANGLE Metal / Apple M5 Pro. Logs:
`/tmp/node-1226-review1-probe-{before,after}.log`.

The cold instrument retains the framed refinery's id and uses one `paintMaps`
traversal for both subjects. Its hardware compatibility run still records
226,919,941 asset bytes, 35 requests, one paint-wear fetch and one paint map
across the refinery and Bollard. The run is recorded in
`/tmp/node-1226-review1-cold.log`; it adds no performance claim to the comparison.

The decode diagnostic prints only the failing texture. The six-model browser
comparison still reports exact pixels and matching settings for all ten maps,
in `/tmp/node-1226-review1-decode.log`.

The glossary alias cited by the review is absent from the receipt at reviewed
commit `e084b959` and from the current text; no alias replacement is needed.

The focused headless run passes 163 tests across four files. Build, TypeScript,
the 25 MiB host-size check, format, lint, comment lint and launcher wiring pass.
Their logs use `/tmp/node-1226-review1-*.log`. The full browser gate remains with
the supervisor, as above; this pass reran only the changed browser contract and
instruments.

The single full host `npm test` run for this review pass reports 7,857 passing
tests across 489 files, zero failures, in 556.83 seconds. Its log is
`/tmp/node-1226-review1-full-test.log`.
