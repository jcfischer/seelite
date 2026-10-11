# Model integration: node #814, Bollard O4 salvage tug

Follows [the authored-model integration SOP](../model-integration-sop.md).

## Current result

Steps 1 and 2 of the SOP: the contract and the shipping asset. No game code
loads the model yet. Steps 3 to 7 wait on the decisions below.

- **Design:** PR #802, branch `spike/bollard-hull-798`, rebased on `origin/main`
  on 2026-10-11 to `6445d75d`. The accepted design is commit `26d6958`
  (rebased: `6445d75d`), principal visual approval 2026-10-08. That approval
  covers the isolated study; in-game approval is still owed.
- **Integration branch:** `node/814-bollard-integration`, from the rebased
  design head.
- **Shipped asset:** `src/models/bollard-tug.glb`, 17,461,200 bytes
  (16.65 MiB), sha256
  `a4b07c871f31de39bfc1f7dbf043613bf6f4862c2bf1aedeba6327cbbcecedb3`.

### Contract

| Item | Value | Source |
| --- | --- | --- |
| Hull row | `tug`, role `salvage`, 120 t, purchasable at 27,600 cr | `src/hull.ts` |
| Variant | proposed `tug/b` = Bollard, selected (Longwall's `miner/b` pattern); `tug/a` loft stays as the procedural variant | decision D1 |
| Units, axes | metres, Y up, +Z forward in the study; the game's nose is −z, so the install turns the model 180° about Y | `spikes/bollard-hull/README.md`, `tests/courier-hull.test.ts` |
| Scale | 1:1, no scale | decision D2 |
| Envelope | proposed 56.6 x 48.4 x 21.2 m (L x B x H), the model's box rounded up 0.1 m; was 58.5 x 45.7 x 25.7 m | decision D2 |
| Envelope centre | box centre at x 0, y −0.29 m, z +0.16 m (study frame); to be centred on the origin on install, as Longwall's is | measured |
| Mass | 120 t unchanged; density 2.07 t per 1000 m³ at the new box, inside the 1.2–2.4 band | measured |
| Collision owner | the hull envelope, as for every hull | `src/hull.ts` |
| Moving parts | none: no animations, 15 nodes batched by material; the dorsal winch is static geometry, so it cannot be posed without a re-export | study GLB, `build_model.py` |
| Resources | one GLB under `src/models/`, content-hashed (#834); review files stay in `spikes/bollard-hull/` | SOP §2 |

### Decisions for the principal

- **D1. Variant mapping.** Bollard becomes `tug/b` and the tug row's selected
  variant, as Longwall B became `miner/b`.
- **D2. Envelope.** The tug row takes the model's own box at 1:1 (Longwall's
  pattern), not a scale to the old roster length (the courier's pattern). The
  box fits every berth either way, so no berth decision follows.
- **D3. Boot policy.** Install after boot with the `tug/a` loft as the
  stand-in (courier, #831), or wait at boot (Longwall, under the waiver on the
  open #838). The SOP forbids an accidental new blocking asset; the node
  body's "before any Game is built" rule predates #831. With D3 = after boot,
  the stand-in loft is 4.5 m taller than the new envelope (25.7 against
  21.2 m) until the model installs.
- **D4. Review export.** Sage did not run on #802: its retry would send this
  private PR's source to the reviewer and was held for explicit authorization.

## Asset and geometry preflight

- **Command:** `node spikes/bollard-hull/prepare-flight-asset.mjs`. Two runs
  wrote the same sha256.
- **Encoding:** `dedup`, `reorder`, Meshopt with the lossless NONE filter,
  lossless WebP. No simplification, quantization or resize. The script asserts
  exact vertex attributes, the approved export's triangles
  (`spikes/longwall-miner/triangle-soup.mjs`, shared) and texture pixels.
- **Size:** 16.65 MiB against the host's 25 MiB per-asset limit
  (`scripts/check-dist-sizes.mjs`, `MAX_ASSET_BYTES`). The spike export is
  33.4 MB. The automated guard sees the file only after step 3 references it
  from `src/model-urls.ts`; until then this is the explicit check.
- **Production loader:** `tests/bollard-asset.test.ts` decodes both files
  through `decodeShippedGlb` (the browser's `GLTFLoader` and Meshopt decoder).
  15 meshes, 444,600 triangles, every attribute of every corner exact, winding
  kept. Mutation check: an 8-bit normal quantization of the shipped file turned
  that row red; the regenerated file returned the same sha256.
- **Bounds:** x ±24.15 m, y −10.87 to +10.30 m, z −28.10 to +28.42 m.
- **Berth fit:** the model's box fits every berth of every role (trade 8,
  shipyard 6, refinery 4, outpost 2), as the `tug/a` envelope did.

## Runtime and performance evidence

Not started (SOP §3–4). Owed: the lifecycle rows for the chosen boot policy,
the traffic and player LOD policy from measurements against the `tug/a`
baseline, vents and muzzles on the model, and drive glows.

## Delivery evidence

Not started. Owed: Sage (D4), `probe:pr` on the final head, the view set, the
principal's in-game approval and the Field Notes decision.

## Historical measurements

- Study viewer, 2026-10-08: 56.25 FPS on M1 Pro at 1,778,434 submitted
  triangles, 83 calls (`spikes/bollard-hull/evidence/metrics.json`). Study
  viewer only; not production evidence.
