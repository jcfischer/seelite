# Node #1228: shared steel-wear images

The five named production models reference the image registry instead of
embedding their steel maps. Geometry, materials and sampler settings are
preserved. Runtime code is in `73d9f8f9`; production failure coverage is in
`81daeb1e`. The cold harness reads its own renderer and draws in a visible canvas.

## Preparation and scope

Baseline: `92e260ce`. Run `node scripts/share-model-image.mjs` after re-exporting
a model. The existing exterior `steel-wear.webp` holds SHA-256
`b8cf2375235d29d230ab478486f9fd6825492df879084896c18a91275616467f`
(2,034,702 bytes). The new `cockpit-steel-wear.webp` holds
`ddf48529978a25b3cd43fa716426797afbafad33811747ce32bd7a9fc8886293`
(1,812,674 bytes). Both are 1254×1254 WebP images.

| Model | Original bytes | Prepared bytes | Removed |
| --- | ---: | ---: | ---: |
| courier-hull | 14,624,396 | 10,776,836 | 3,847,560 |
| courier-cockpit | 3,168,308 | 1,355,500 | 1,812,808 |
| discovery-voyager | 21,767,436 | 19,732,700 | 2,034,736 |
| lance-interceptor | 13,116,788 | 11,081,992 | 2,034,796 |
| porter | 15,096,260 | 13,061,528 | 2,034,732 |

The GLBs lose 11,764,632 bytes. The exterior image already ships for Warden,
Shiv and Sluice, so adding only the cockpit image gives **9,951,958 bytes saved**
against this baseline. That explains the difference from the node's older
estimate. Every other file under `src/models/` was compared with its original
Git blob and is byte-identical. A preparation rerun changes no model bytes.
Porter's coarse steel and Voyager's two panel images remain embedded.
The production miner cockpit, added since the node was written, also embeds
the cockpit steel; it is outside the five named files and remains unchanged,
as does the miner cockpit study.

`tests/fixtures/shared-image-originals.json` records each embedded original's
production-decoded geometry and material/node/sampler digest, plus the prepared
file hash. The fixtures were recorded before extracting the images. The pinning
command now prepares every registered image in a file when deriving that hash.
The tests assert exact attributes, indices and transforms, unchanged material
JSON, the registered image references, size reductions and idempotence.

`npm run build` passes the host's 25 MiB per-file guard. Its assets include one
`steel-wear-DsGbkLh0.webp` and one `cockpit-steel-wear-D3TdgqfI.webp`, with the
sizes above, and the prepared GLBs at their recorded sizes.

## Pixels and sampler ownership

The node predates the approved courier anisotropy change in node #1230.
Current main gives its exterior anisotropy 8, so the courier now has an owner
copy too. The registry declares that owner's anisotropy; the courier's existing
rule leaving registry maps alone remains intact. Porter and cockpit loaders
also register owners. Their existing adoption functions still assign the map
as the bump map and retain anisotropy 8. The courier cockpit review viewer has
its own owner.

On ANGLE Metal / Apple M5 Pro, the production adoption probe reads:

- Default exterior steel: anisotropy 1.
- Courier and Porter exterior steel: separate texture objects, anisotropy 8,
  one GPU upload between them.
- Courier hull's internal steel: anisotropy 1; cockpit steel: anisotropy 8,
  with the same decoded Source and separate uploads.
- Porter and cockpit: `bumpMap === map` after production adoption.

Drawing default steel, courier steel, Porter steel, cockpit steel and hull
internal steel changes the isolated renderer's texture count
`1 → 2 → 2 → 3 → 4`. Voyager and Lance separately give `0 → 1 → 1`, from one
image request. Teardown retains the survivor's texture and exact rendered frame.
These counts preserve current main's settings rather than the old expectation
that the courier shares the default upload.

The browser checks
`verify-shared-image-decode.mjs 92e260ce steel-wear` and
`verify-shared-image-decode.mjs 92e260ce cockpit-steel-wear` compare the prepared
models with their embedded originals. Every texture, including the retained
coarse/panel images, has **zero differing RGBA bytes**; each 1254² texture has
6,290,064 bytes. Flip, colour space, wraps, filters, anisotropy, mipmaps, format,
type and premultiplication match. The verifier also accepts originals that
already use the registry, as current main's three newer hulls do.

The glTF-Transform reader resolves both images. The authored-paint measurement
prints byte-identical output before and after; the cockpit-normal instrument
also completes. No luma constants were retuned. The calibration's source-file
hash follows the prepared courier file.

## Runtime checks

`probe-shared-image` passes **52/52**, including both steel images. Boot failures
show Retry and refetch successfully; background failures are caught by the
queue. A live courier keeps its procedural stand-in when exterior steel fails,
then refetches and installs on a later successful load. Nothing is unhandled.
The existing image-sharing cases remain covered.

The manually scoped GPU run passes six of seven probes: shared-image,
model-queue (42/42), boot, model-download, postcard and cockpit-laser.
`probe-live-cockpit` passes its production-cabin assertions, then times out at
the prototype combat readiness wait (`scripts/probe-live-cockpit.mjs:970`).
Isolated reruns on both head and unmodified base hit its initial 30-second
readiness gate (`:418`), with no exposed Game yet. This baseline failure is left
unchanged under the worker SOP. Logs are `/tmp/node1228-probe-run.log`,
`/tmp/node1228-live-alone-run.log` and `/tmp/node1228-live-base-run.log`.

The selector reports all 126 probes because asset paths have no dependency
owner. The worker's explicit scope rule leaves that full browser run to the
supervisor; this is manual affected coverage, not a passing PR browser gate.

## Cold three-model session

`SEELITE_PROBE_RENDERER=hardware node scripts/measure-steel-wear-cold.mjs` loads
and builds the courier hull, courier cockpit and Voyager through their real
production preparation functions. A visible 1440×900 renderer draws the three
built models together, with a fixed camera and hemisphere. Each added model
must upload textures, and the harness asserts the production steel sampler
settings. Frame intervals cover load/build/upload work and 120 settled frames;
module import and any full Game construction are outside this isolated fixture.

One fresh-browser sample per build, sequentially, ANGLE Metal / Apple M5 Pro:

| Measurement | Base | Head |
| --- | ---: | ---: |
| GLB/WebP body bytes fetched | 39,560,140 | 35,712,412 |
| Asset requests | 3 | 5 |
| Load/install duration | 2,751.3 ms | 2,466.3 ms |
| Texture counts after each model | 3, 26, 29 | 3, 26, 29 |
| Longest frame interval | 166.6 ms | 133.2 ms |
| p95 interval | 51.1 ms | 50.1 ms |
| Intervals above 100 ms | 3 | 3 |
| Initial 1-minute host load | 7.98 | 7.35 |

Bytes fall by 3,847,728. The matching texture counts are expected with the
courier's current anisotropy 8 versus Voyager's default. The full fixture's
screenshots differ in **0 of 5,184,000 RGBA channels**. One sample supports no
claim of a stall improvement. Logs and PNGs are
`/tmp/node1228-cold-{base,head}.{json,png}`.

## Canonical captures and remaining gate

A full 122-view capture on unmodified main ran every recipe, but the capture
guard removed its run and sheet after Shipyard raised
`auto-sale of Food refused: cargo-missing`. Log: `/tmp/node1228-base1.log`.
An eight-view scoped baseline then reached a 60-second bake-queue timeout at
the berth recipe (`capture-views.mjs:1700`); its log is
`/tmp/node1228-base-focus.log`. Neither baseline defect is changed here.

Six direct material views are captured separately through the unchanged
canonical harness, seed 47, 1440×900, default High quality and 60° FOV:
`cockpit-arrival`, `cockpit-backlit`, `hull-chase`, `hull-chase-lance`,
`vent-plumes-chase`, `cruise-light-chase`. The baseline is at
`/tmp/node1228-base/view-set/node1228-focus6/base-focus6`; the three head controls
are `head-focus6-1`, `head-focus6-2` and `head-focus6-3` under
`view-set/node1228-focus6/`. The baseline server is an isolated Git
archive at `92e260ce`, with its own dependency/cache tree; only the shared-image
fixture and cold instrument were copied in for measurement.

At the unchanged summed-RGB difference threshold of 24/255, three same-build
pairings and three cross-build pairings per view give these percentages of
pixels moved:

| View | Same-build range (%) | Cross-build range (%) |
| --- | ---: | ---: |
| cockpit-arrival | 0.013040–0.064738 | 0.020833–0.050309 |
| cockpit-backlit | 0.014969–0.041435 | 0.009799–0.037654 |
| hull-chase | 0.000231–0.000617 | 0.000540–0.001080 |
| hull-chase-lance | 0.000309–0.001312 | 0.000463–0.000849 |
| vent-plumes-chase | 0–0 | 0–0 |
| cruise-light-chase | 0.013194–0.551003 | 0.086728–0.469985 |

Every cross-build range overlaps or lies below its same-build range; no view
separates. This does not claim every individual pairing is below the same-build
maximum: the courier chase has a cross pairing of 14 moved pixels against a
same-build maximum of 8. Its mean-luma difference is below 0.001 codes. The
before/after cockpit frames were opened and show the same cabin. Comparison
artifacts are `/tmp/node1228-view-comparison.json` and
`/tmp/node1228-view-summary.json`.

The full-set appearance gate remains unverified because its baseline is red;
no new appearance approval is claimed.

## Host verification

The final build, including typecheck and host-size guard, format, lint,
comment-ratchet and launcher-wiring checks pass. The one required full host run
of `npm test` passes **8,168 tests, zero failures**, across 498 files, in 809.78 s.
Its complete output is `/tmp/node1228-full-test.log`. The branch contains
`origin/main`; no base merge was needed.

## Delivery

This is an internal asset refactor, outside `src/changelog.ts`'s major-change
definition. The supervisor owns push, PR, Sage review and the principal's merge.
No graph node or map was edited.

## Sage review round 1

All four findings were taken. Prepared-model checks again require no embedded
images except Voyager's two panel images and Porter's coarse steel image; the
courier hull explicitly expects zero. A negative control adding an extra image
entry to each parsed model fails all 28 cases. Steel registry checks use every
registered image's full hash, including both courier-hull images, and the
anisotropy table uses the cockpit image's registered name.

The generic hull loader passes each hull's id as its texture owner. Registry
settings still decide anisotropy, and owner copies retain the shared decoded
Source. Fixture re-exports are grouped by module at the top of the file.

Merged `origin/main` at `3f4e9e49` before final verification. Build, typecheck,
25 MiB host-size guard, formatting, lint and comment-ratchet checks pass. The
hardware `probe-shared-image` passes 52/52 on ANGLE Metal / Apple M5 Pro,
including sampler isolation, bump maps and live failure/retry behavior. This
is one manually scoped probe, not a passing full PR browser gate. Logs are
`/tmp/node1228-review1-{build-final,probe-run,negative-control}.log`.

The merged courier-normal integration added a CLI that read embedded image 0.
The full host test run exposed its incompatibility with the prepared courier.
The CLI now uses the existing shared-model reader and checks that every
exterior material samples the named steel image. Its five targeted tests pass,
including byte-identical reproduction of the shipped normal and unchanged
height dimensions. Log: `/tmp/node1228-review1-derived.log`.

The single full run finishes at 8,266 passed and that one CLI failure across
503 files in 713.39 seconds (`/tmp/node1228-review1-full-test.log`). After the
repair, all four affected files pass together: 202 tests, zero failures
(`/tmp/node1228-review1-affected-final.log`). The full suite was not repeated,
under the worker's once-only rule; the supervisor reruns it on the committed
tree. Build and lint checks were rerun after the CLI repair and pass.
