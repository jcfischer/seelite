# Node #966: authored rocks and bundled collision data

## Shipping contract

`src/models/asteroids.glb` is an unchanged copy of the approved study's runtime
GLB: 19,567,976 bytes, SHA-256
`0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c`.
The editable study stays under `spikes/asteroid-rocks-953/`.

`src/models/rock-heightfields.bin` is generated, 786,480 bytes: a 48-byte
versioned header including the source SHA-256, followed by sixteen archetypes
× six faces × 64² little-endian uint16 fractions of the rock's bound radius.
The header layout and face orientation live in `src/rock-heightfields.ts`.
The decoder accepts bytes from disk in Bun and imports no renderer or filesystem.

```sh
bun scripts/generate-rock-heightfields.ts
bun test tests/rock-heightfields.test.ts tests/rock-assets-bundle.test.ts tests/model-urls.test.ts
```

The generator uses the browser's GLTFLoader through `decodeShippedGlb`, including
world transforms. It refuses missing/duplicate archetypes or LODs, unexpected
mesh names, invalid positions and radii, and positions beyond the unit bound.
The source check hashes GLB bytes before parsing; a changed source fails with
both the recorded and actual hashes. A mutation row exercises that failure.

## Fit

The selected symmetric method from node #949's spike commit `31f9c00c` is
retained: each texel stores its centre ray's outermost triangle hit across
all three drawn levels; sampling is bilinear, clamped at each face's edge.
The dilated prototype was not selected. A controlled three-LOD fixture makes
each LOD independently supply the outermost surface. Regeneration is byte-exact.

Quantization rounds inward with one additional uint16 quantum of clearance
(`floor(r × 65535) - 1`), changing an exact exit by less than 2/65535 R.
Nearest rounding measured 0.03010485 R empty space on stepped-strata, outside
the node's 0.0301 R bar; this policy meets the unchanged bar after decoding.

The test repeats #949's measurement on decoded shipping bytes:

- Empty space: six 80² centre-ray samples against the drawn L0 solid, exact
  point-to-triangle distance where the proxy exceeds the L0 exit.
- Drawn outside: every vertex of all three levels, including triangle
  duplicates, against a 128²-per-face triangulation of the bilinear proxy.
  The p99 population is outside vertices only, as in the spike.

Worst measured empty space is **0.03008762761 R**; worst outside p99 is
**0.01951147416 R**. Both occur on stepped-strata and pass 0.0301 R / 0.02 R.
The maximum outside distance is 0.04549753468 R on cleaved-keel; the ruled
outside criterion is p99. These are the spike's sampled Euclidean measurements,
not a global bound on unsampled points. The test prints every archetype's row
and fails loudly on non-finite results.

## Bundle and scope

`src/rock-assets.ts` uses Vite's existing `?url&inline` support: the binary is
base64 in JS and is decoded synchronously, without a fetch. `Game.rockAssets`
holds the decoded fields and the separately emitted, hashed GLB URL before any
rock model installer exists. Headless code imports the pure decoder instead.
No dependency or Vite configuration change is needed.

The production build contains the current binary in `main-B68sj_so.js`, emits
`asteroids-DxMe7_ZN.glb`, and emits no separate rock-heightfield binary.
The bundle test also checks the inline bytes and absence of a fetch. Other
shipyard probe binaries still ship under their existing contract.

This node adds no rock drawing, model loading, cone pieces or collision sweep.
Those remain field-integration work. It changes no appearance and is not a
major changelog entry under `src/changelog.ts`.

## Delivery checks

Typecheck, production build/asset-size guard, format, lint and wiring passed.
The one required `npm test` run finished **6,379 pass, 1 fail** across 370 files
(962.27 s). All new tests passed, including the decoded fit measurement and
the actual Vite bundle check. The failure was the existing
`tests/vent-plumes.test.ts` row "a line that meets the hull puts its throat on
the metal, on the exhaust side": it completed its assertions but exceeded
the unchanged 5 s test timeout at 6.73 s.

That file then passed **10/10** unchanged in isolation on both the untouched
base snapshot and this branch. The affected row took 2.685 s on base and
2.736 s here. The vent implementation, its hull/mesh inputs and its test are
unchanged by this node. The full-run timeout was not reproduced in isolation;
its cause is not established. No vent code or timeout was changed, and the
full suite was not rerun under the worker's once-only rule. The supervisor's
full headless gate remains pending.

The diagnostic selector reports all 108 probes because the generator path is
unmapped infrastructure. The full browser gate is left to the supervisor under
the ranger worker contract; the worker runs only the boot probe affected by
the new synchronous module. This is not a repository-selected browser-gate pass.
The first sandboxed Chromium launch aborted; the authorized unsandboxed GPU
run confirmed ANGLE Metal / Apple M1 Pro, then timed out opening the second
page (peak load 47.9). No performance conclusion is drawn from that run.
An alone rerun timed out on the different-seed page at peak load 87.5.
A temporary snapshot of base `c1eacb4ca84f7d5010f9860e634dd2f864df8493`
then passed 58/58, as did the final implementation rerun: **58/58**, 84.9 s,
ANGLE Metal / Apple M1 Pro, peak load 82.4. The earlier timeouts remain
unattributed; no timing or probe tolerance was changed.
