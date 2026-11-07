# #832 — Compressing the model files in transit on Cloudflare Pages

Research node #832 (map #1, parent #830). Measured 2026-10-14 at `c73aa28`.

## Answer

**Ship precompressed gzip (option 2), built from the unchanged `src/models/*.glb` by a vite plugin, and unpacked with `DecompressionStream("gzip")` before `GLTFLoader.parseAsync`.** Over the 13 shipped GLBs it cuts the wire from **141.22 MB to 79.09 MB (−44.0%)**. The boot set (Coriolis, cockpit, Longwall miner) drops from **21.51 to 12.13 MB (−43.6%)**. Gunzip costs 14–91 ms per model in the page. Option 2 works the same on `seelite.pages.dev` and on `farbetween.ch`, lives in the repo where it can be reviewed, keeps the #833 progress bar truthful, and leaves every headless test that reads `src/models/*.glb` unchanged.

- **Option 1 (Cloudflare compresses the response):** not possible on `*.pages.dev`. On `farbetween.ch` it is possible in principle through a zone Compression Rule, but that path is untested. The setting lives outside the repo, and on-the-fly compression breaks the progress bar. Hold it as a fallback, not as the plan.
- **Option 3 (meshopt filters, with or without 16-bit positions):** on top of gzip it saves another 4.5% (filters alone) or 17.6% (filters plus quantised positions). Both are **lossy**, they reverse a lossless choice every prepare script states on purpose, and they change what the game looks like. If wanted, they are per-model visual nodes for later, not part of this build.

## What is shipped today (measured)

- 13 GLBs under `src/models/`, emitted by vite as `/assets/<name>-<hash>.glb` (#834). The node body names three files because three existed when it was filed.
- Every file already uses `EXT_meshopt_compression` in mode `ATTRIBUTES`/`TRIANGLES` with **filter `NONE`**. Only `courier-hull` and `station-interiors` also use `KHR_mesh_quantization`. Textures are embedded lossless WebP: **≈42.5 MB of the 141.2 MB**, which neither gzip nor meshopt shrinks.
- Live headers, `curl -D -` with `Accept-Encoding: gzip, br, zstd`, 2026-10-14:

| URL | content-type | content-encoding | cache-control |
|---|---|---|---|
| `farbetween.ch/assets/coriolis-qhdOCFco.glb` | `model/gltf-binary` | none (6,702,852 B) | `public, max-age=31536000, immutable` |
| `seelite.pages.dev/assets/coriolis-qhdOCFco.glb` | `model/gltf-binary` | none | (same) |
| `…/shipyard-gantry-probes-*.bin` (both hosts) | `application/octet-stream` | none | |
| `…/shipyard-gantry-lightmap-*.webp` (both hosts) | `image/webp` | none | |
| `farbetween.ch/assets/main-*.js` | `application/javascript` | **`br`** | |

So the edge compresses what is on Cloudflare's default list and nothing else. The response carries `server: cloudflare` and a `cf-ray`, so `farbetween.ch` is a proxied Cloudflare zone.

## Bytes on the wire (MB, 10⁶ B)

`gzip -9 -n` is what option 2 would ship. The filter columns are option 3, encoded with glTF Transform 4.5.1 and meshoptimizer 1.3.0, the repo's own toolchain.

| model | shipped | gzip-9 | brotli-11 | filter | filter+gz | q16+filter | q16+filter+gz | q16+filter+br |
|---|---|---|---|---|---|---|---|---|
| **coriolis** | 6.70 | **3.80** | 3.48 | 6.04 | 3.71 | 5.41 | 3.53 | 3.33 |
| **courier-cockpit** | 3.14 | **2.55** | 2.47 | 2.88 | 2.44 | 2.63 | 2.26 | 2.22 |
| **courier-hull** | 14.62 | **9.06** | 8.09 | 13.52 | 8.59 | 11.09 | 7.26 | 6.66 |
| bollard-tug | 17.46 | 8.38 | 6.55 | 14.03 | 7.51 | 11.08 | 5.51 | 4.92 |
| longwall-miner | 11.67 | 5.78 | 5.12 | 9.92 | 5.27 | 7.77 | 4.40 | 4.05 |
| refinery-collar | 8.06 | 6.45 | 6.27 | 7.54 | 6.25 | 6.97 | 5.90 | 5.81 |
| refinery-spar | 9.87 | 6.46 | 6.06 | 9.14 | 6.29 | 8.32 | 5.97 | 5.71 |
| refinery-warren | 8.50 | 6.70 | 6.50 | 7.87 | 6.47 | 7.23 | 6.05 | 5.94 |
| refinery-works | 9.60 | 6.96 | 6.65 | 8.79 | 6.74 | 7.98 | 6.26 | 6.09 |
| shipyard-foundry | 10.82 | 5.21 | 4.69 | 9.88 | 5.10 | 7.90 | 4.17 | 3.86 |
| shipyard-gantry | 10.49 | 4.94 | 4.50 | 9.60 | 4.84 | 7.72 | 3.99 | 3.74 |
| shipyard-slipway | 7.99 | 4.82 | 4.49 | 7.34 | 4.69 | 6.04 | 3.95 | 3.76 |
| station-interiors | 22.30 | 8.00 | 5.82 | 20.64 | 7.67 | 14.74 | 5.94 | 4.92 |
| **total** | **141.22** | **79.09** | 70.71 | 127.20 | 75.57 | 104.89 | 65.19 | 61.01 |

The node's figures reproduce: Coriolis 6.7 → 3.8 MB at gzip. The hull is now 14.6 → 9.1, because #831 re-encoded it after the node was filed.

**At the levels an edge would use** (option 1 compresses on the fly, so not at max level), the totals are gzip-6 79.31, brotli-4 76.88, zstd-3 77.52 and zstd-19 71.62 MB. Option 1 therefore saves about what option 2 saves.

**A control.** Re-writing each file through the same toolchain with the shipped method (`QUANTIZE`, filter `NONE`) reproduces 11 of 13 files byte for byte. `longwall-miner` comes out 17,020 B smaller and `station-interiors` 36,604 B larger, both under 0.2%. So the filter columns measure the filters, not the toolchain.

**Option 3's losses, measured.**
- `FILTER` in glTF Transform 4.5.1 writes normals as 8-bit octahedral (`getMeshoptFilter`). The worst normal error is 1.07–1.18° on every model, with a mean of 0.10–0.32°.
- `q16` quantises positions to 16 bits per mesh. The worst step is 0.015–0.030 model units on the stations and 0.0001–0.0013 on the ships.
- For `courier-hull` and `station-interiors`, whose positions or normals are already quantised, the step figure is in stored units and does not measure their loss. Their q16 error is **not measured**.

**Where the bytes are.** The refineries are 50–61% WebP, so no geometry encoding moves them much. Textures, as lossy WebP or KTX2, are the larger lever after this one. That is out of scope here.

## Extra decode time in the page

Method:
- Headless Chromium 151.0.7922.34 (Playwright 1.62.1), three r170, Apple M1 Pro.
- Each model's variants ran interleaved in a rotated order. Eleven rounds, the first discarded as warm-up, so **N = 10**. Medians.
- The longest main-thread gap is the largest interval between `setTimeout(0)` heartbeats while the operation ran.
- This is CPU work, so the renderer lane does not apply. GPU upload is not included.
- **The machine was loaded: load average 40–45 on 10 cores**, because other workers were running. The absolute figures are inflated, with a min/max spread of about 2×. Read them relative to each other.

| model (shipped) | gunzip in page (ms) | longest main-thread gap during it (ms) | `parseAsync` (ms) |
|---|---|---|---|
| courier-cockpit | 14.1 | 14 | 76.6 |
| coriolis | 21.7 | 17 | 134.3 |
| courier-hull | 85.2 | 71 | 151.9 |
| bollard-tug | 90.6 | 79 | 138.2 |
| longwall-miner | 41.5 | 37 | 118.3 |
| station-interiors | 81.3 | 72 | 172.6 |
| refineries (4) | 26.5–35.2 | 20–29 | 106–124 |
| shipyards (3) | 29.6–34.9 | 26–33 | 113–135 |

- **Gunzip** costs 77 ms for the boot set and about 0.55 s for all 13 models. At 50 Mbit/s the boot set saves 1.5 s on the wire (3.44 → 1.94 s) and the full set saves 9.9 s (22.6 → 12.7 s).
- **`DecompressionStream` on the main thread holds the thread for most of its run**: a 71–79 ms gap on the hull and the tug.
- **In a Worker** (input copied in, output transferred back), the gap halves under the same load: hull 71 → 36 ms, interiors 67 → 36 ms, Coriolis 16 → 12 ms. The wall time is unchanged.
- **Filter decode cost is not measurable.** `parseAsync` medians for filter and q16+filter move both ways against shipped (Coriolis 134 → 81/118, interiors 173 → 189/215, slipway 134 → 96/150). That is noise, not a cost.
- **Option 1's decode runs in the network process.** Served from localhost with `Content-Encoding: gzip`, the fetch showed a 6–17 ms main-thread gap against 7–24 ms for identity. The wall time on localhost was up to 56 ms longer, because transfer there costs nothing. On a real network the saved bytes hide it.

## Option 1 — Cloudflare compresses the response

- **`*.pages.dev`: no.** `model/gltf-binary` is not on Cloudflare's default list ([compression docs](https://developers.cloudflare.com/speed/optimization/content/compression/)). Compression Rules need a zone you control with proxied DNS ([Compression Rules](https://developers.cloudflare.com/rules/compression-rules/)), and `pages.dev` is Cloudflare's own zone. `_headers` sets response headers but has no compression setting.
- **Relabelling the type** in `_headers` as a type on the list (e.g. `application/wasm`) is a hack that misstates the type. It is untested: testing it needs a deploy, which this node does not make. Not recommended.
- **`farbetween.ch`: possible, unverified.** Compression Rules are on every plan, with 10 rules on Free. The docs' "Gzip for CSV" example targets a type that is also off the default list ([example](https://developers.cloudflare.com/rules/compression-rules/examples/gzip-for-csv/)), which suggests a rule can switch compression on for `model/gltf-binary`. **No page I found says whether a zone's compression rule fires on Pages-origin traffic.** The build's first probe would be a `curl -H 'Accept-Encoding: gzip'` after the rule is added.

Costs:
- **The configuration is outside git.** It is dashboard or API state the principal owns, nothing in the repo reviews it, and `pages.dev` previews stay uncompressed.
- **Progress bar (#833).** three's `FileLoader` takes the total from `Content-Length` and counts decoded bytes. An encoded response therefore reads high and stalls at `ModelProgress`'s 0.99 clamp, which `src/model-progress.ts` already anticipates. If the edge compresses on the fly and drops `Content-Length`, the bar is indeterminate for the whole download. Either way #833's bar degrades.
- **Caching.** Hashed names and `immutable` are unchanged, and the edge adds `Vary: Accept-Encoding`. Whether the edge caches the compressed variant or recompresses each time is Cloudflare's business. It costs the page nothing.
- **Pages' 25 MiB per-file limit** (`scripts/check-dist-sizes.mjs`) still applies to the stored file, so it gets no relief.
- **Probes and tests:** nothing changes. The dev server stays identity, so no probe ever sees an encoded model.

## Option 2 — precompressed `.glb.gz`, unpacked in the page

- **Format: gzip only.** Chromium 151 accepts `gzip`, `deflate` and `deflate-raw` and throws on `br`/`brotli` and `zstd` (tested). MDN now lists `brotli` and `zstd` as format values, but they are not portable yet. Brotli would save another 10.6% (79.09 → 70.71 MB) only by shipping a JS/WASM decoder. Not now.
- **Bytes:** 79.09 MB total, 12.13 MB boot (tables above). This ties option 1, and the plugin can use level 9 where the edge cannot.
- **Content-hashed names and immutable caching.** A vite asset's hash is taken from the `.gz` bytes, so the scheme of #834 carries over unchanged under `/assets/*`. The encoder must be **deterministic**, or URLs change from build to build:
  - Node's zlib writes the gzip OS byte as `0x13` on macOS (measured); `gzip -n` wrote `0x03`.
  - A local macOS build and the CI Linux build therefore name the same model differently.
  - The plugin should fix header byte 9 (or use a pure-JS encoder such as fflate) and write `mtime = 0`.
  - A zlib upgrade that changes the deflate stream gives each model one new URL, which costs one cold download. That is acceptable.
  - The browser cache then holds the gzip bytes, so a warm boot gunzips again: 77 ms for the boot set.
- **Progress bar:** stays exact. The response is the `.gz` file with its true `Content-Length` and no `Content-Encoding`. Count the compressed bytes before the `DecompressionStream`, and the bar reads true.
- **Guard against a double decode.** If a host ever adds `Content-Encoding: gzip` to a `.gz` file, the browser hands over raw glTF. The helper should sniff the first bytes (`1f 8b` → gunzip, `glTF` → parse as is). Pages served `.glb`/`.bin` untouched today. The build must `curl` the live `.gz` header to confirm the same for `.gz`.
- **25 MiB limit relieved.** `station-interiors` drops from 22.3 to 8.0 MB stored. #843 had to quantise the kit to fit.
- **Main thread:** see the decode table. For the after-boot installs (courier hull, interiors, tug, stations), where #877 measured install intervals of 9.3–33.2 ms, do the fetch and gunzip in a Worker. The interior kit already runs meshopt in two workers. On the boot path a gap of 14–37 ms behind the loading panel is harmless.

**What the probes and tests need, if the build keeps `src/models/*.glb` as the source and the plugin makes the `.gz`:**
- **Headless tests and scripts:** none. That covers every reader of `src/models/*.glb`: `scripts/lib/shipped-glb.ts`, `tests/*-flight-asset.test.ts`, `tests/station-interior-kit.test.ts`, the proxy generators, and the `sha256` pin on `courier-hull.glb` in `tests/light-rig.test.ts`.
- **`tests/model-urls.test.ts`:** its literal regex `new URL("./models/<x>.glb", import.meta.url)` and its "no `.glb` under `public/`" rule must follow whatever form the plugin import takes (e.g. `?gzip`).
- **`scripts/probe-model-download.mjs`:** its route predicate is `pathname.endsWith(".glb")`. Unchanged, it would hold **no** model, and its rows would test nothing. It must also match `.glb.gz`.
- **Route patterns that already match `.glb.gz`:** `probe-postcard.mjs` (`/courier-hull[^/]*\.glb/`) and `probe-station-interior-kit.mjs` (`**/*station-interiors*.glb*`).
- **The dev server should serve the `.gz` too** (plugin middleware), so that the probes exercise the decompress path. If dev serves raw `.glb`, the probes stay green, but nothing in the browser tier ever runs the code the player runs.
- **`src/model-progress.ts`:** the comment about encoded responses becomes a statement about the shipped format.
- **`scripts/check-dist-sizes.mjs`:** unchanged; it simply sees smaller files.

## Option 3 — a different encoding of the asset

- **meshopt `FILTER` alone:** total 127.20 MB raw and 75.57 MB with gzip. That is 4.5% under gzip of what ships, bought with up to 1.18° of normal error. Not worth it.
- **16-bit positions plus `FILTER`:** 104.89 MB raw, which would help a little without any transport compression. With gzip it is 65.19 MB, 17.6% under option 2, and with brotli 61.01 MB.
- **Decode time:** no measurable cost at this noise floor.
- **Against it:**
  - It is lossy in normals and, with q16, in positions on the 12 models that ship float positions.
  - `spikes/*/prepare-*.mjs` say outright that they use `QUANTIZE` because *"FILTER would introduce lossy normal/rotation filters. Verify the decoded arrays."* Their exact-array checks and the hull's sha pin would have to be re-founded.
  - It changes what the game looks like, so under the third verification tier each model needs a before/after view set and the principal's yes.
- **With option 1 or 2:** it stacks with either. The gains in the table already assume gzip.
- **Without option 1 or 2:** it saves 25.7% (141.22 → 104.89 MB) and needs no transport change. That is still worse than gzip alone, which is lossless.
- **Recommendation:** not in this build. If wire bytes matter after option 2, file q16+filter as a visual node per model family, starting with the ships, where the measured position step is ≤ 0.0013 model units, and judge it on the sheet.

## Recommendation for the build node

1. A vite plugin emits a deterministic `gzip -9` copy of each model as a hashed `/assets/<name>-<hash>.glb.gz`, from the unchanged `src/models/*.glb`. Dev serves the same bytes.
2. One loader helper, used by every `prepare*Model`, replaces `GLTFLoader.loadAsync(url, onProgress)`. It does `fetch` → count compressed bytes for `onProgress` → `DecompressionStream("gzip")` (sniffing the magic bytes) → `parseAsync(buffer, "")`. For the after-boot models the fetch and decompress run in a Worker.
3. Fix `probe-model-download`'s `.glb` predicate and `model-urls.test.ts`'s literal. After deploy, `curl` the live `.gz` headers: no `Content-Encoding`, `immutable` present.
4. Leave Cloudflare's zone settings alone. Option 1 is a fallback only if option 2 is refused, and its first act is the curl probe above.

## Reproduction

The scripts are kept out of the branch, because only `findings.md` may be pushed. To rerun:
- **Sizes:** `node:zlib` `gzipSync` levels 6 and 9, and `brotliCompressSync` at quality 11, lgwin 24. Edge levels: `gzip -6`, `brotli -q 4`, `zstd -3`, `zstd -19`.
- **Re-encode:** glTF Transform `NodeIO` with `ALL_EXTENSIONS` and the meshoptimizer encoder and decoder, then `EXTMeshoptCompression` with `EncoderMethod.FILTER`. For q16, run `quantize({quantizePosition:16, quantizeNormal:16, quantizeTexcoord:16})` and `KHRMeshQuantization` first. The normal error is the per-vertex angle between `getElement` normals, before against after.
- **Decode:** a static page with three r170 `GLTFLoader` and `meshopt_decoder.module.js`. Bytes are preloaded. `new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()` is timed against `parseAsync(copy, "")`, interleaved, with a `setTimeout(0)` heartbeat. The HTTP arms come from a local server that sends the `.gz` with `Content-Encoding: gzip`.
