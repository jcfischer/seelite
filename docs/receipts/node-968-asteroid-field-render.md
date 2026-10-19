# Model integration: node #968, asteroid fields drawn in the game

## Current result

**Status: built, within the budget as the principal ruled it, and approved in
game.** The GPU-lane budget (#950 D1) is met at the `inside`, `edge` and `far`
views on both quality sides. It was missed at `close`, and the worker stopped
and escalated as the node says. The principal ruled on 2026-10-19 (#968 comment
"Principal ruling … on the `close` budget miss"):

- **D1:** the high arm with shadow + AO belongs to #970, which opens the
  occlusion gate for level-0 rocks. In this node the gate opens for stations
  only, so high at `close` is judged with it shut: +0.56 to +0.60 ms, inside 1.0.
- **D2:** the low `close` arm was re-measured twice (below, "D2 re-measure").
- **D3:** low at `close` above +0.4 ms is accepted as the fill-bound worst case,
  up to about +0.6 ms, at that view only. D2 measured +0.55 / +0.58 ms.

The principal said yes in game on s173, s221 and s84, on high and low, in both
LOD directions (#968 comment, 2026-10-19). No threshold, shape, material or
shadow rule was changed.

- Settled by #950 D1–D5 and its correction, #953 (K = 16, Lambert), the look
  approved on #952, and #918 Q1 (points, then plain fill).
- Asset: `src/models/asteroids.glb`, unchanged from node #966 (19,567,976 bytes,
  SHA-256 `0622d06b…cd1c`), still a hashed same-origin bundle file. No new asset.
- Production mapping:
  - `src/field-lod.ts` — Three-free: levels, hysteresis, field-frame placement,
    spin quaternion, archetype (`shapeSeed % 16`). The test seam.
  - `src/field-draw.ts` — one `FieldDraw` per `FieldPlan`: two `BatchedMesh`es
    (level 0; levels 1–2) and one `Points` draw, under a root placed against the
    camera's sim position each frame.
  - `src/asteroid-model.ts` — the `asteroids` loader (fetch, SHA-256 check
    against the collision data's recorded source, decode, flatten to Lambert)
    and the failed-load stand-in (K = 16 plain-fill icospheres, detail 6/3/1).
  - `src/model-catalog.ts` (`asteroids` loader), `src/system-models.ts` (queued
    for any system with a field, never at boot), `src/model-queue.ts` (a
    failed-load hook, so the stand-in is built before the model counts as
    settled), `src/main.ts` (build with the system, dispose on jump, update in
    `render`, install after the queue, postcard and `models-full` waits).
- Fallbacks, as the node requires: GLB not installed → points only; failed load
  (or an authored batch that will not build) → plain-fill procedural rocks, never
  points alone, no `ROCK_SURFACE`.

## Asset and geometry preflight

- Deployment limit: `npm run build` ends `ok every file in dist/ is within 25.0
  MiB` (largest model unchanged). The build output was not otherwise inspected.
- The loader hashes the received bytes before parsing and compares them with the
  heightfield header (`assertRockSource`), so a GLB that no longer matches the
  collision data is a load failure (stand-in), not rocks that look right and
  collide wrong. It skips the check only where `crypto.subtle` is absent (an
  insecure origin).
- `tests/asteroid-model.test.ts` binds the shipped GLB's node names to the
  loader's pattern (16 archetypes × 3 levels), the flattening, the refusal of an
  incomplete asset, and the stand-in's bound and triangle counts.
- Normals: stock three batching turns the normal with each instance
  (`defaultnormal_vertex`); `tests/field-draw.test.ts` binds that chunk. The
  station rock's `ROCK_SURFACE` is not used on a field rock.

## Runtime and performance evidence

### Operational conditions (SOP §3)

| Path | Result |
| --- | --- |
| Boot and cold download | Not a boot model (`bootModelIds` unchanged, asserted in `tests/system-models.test.ts`). Requested once after boot, probe row "requested once". |
| Background installation | Points while pending; batches built in 4 ms slices, each compiled (`compileAsync` on the composer target) and its maps uploaded while hidden; then swapped in. Cold install, GPU lane, two runs: longest frame interval across the whole install 43.2 / 38.5 ms (36 ms in an earlier run), median 16.6–16.7 ms, the swap frame itself 18.4 / 19.3 ms. #953 measured a 70 ms first frame. The `INSTALL=1` runs' raw output was not kept; rerun `INSTALL=1 SEELITE_PROBE_RENDERER=hardware node scripts/measure-asteroid-field-cost.mjs` to check. |
| Interrupted or failed load | Plain-fill K = 16 rocks, warned once, no Retry panel, settles (`probe-asteroid-field.mjs`). The queue's failed hook keeps `modelsSettled` false until the stand-in is built. |
| Postcard/export | `systemModelIds` includes `asteroids` for a system with a field, so the postcard waits on it like any model, then `game.modelInstalled("asteroids")` finishes the batches before the card is drawn. **Not exercised by a probe run**; read from code only. |
| Flight and traffic | Field is a near-layer object, hidden beyond `NEAR_FAR_KM` less a margin. No contacts, collision or cruise (out of scope, #971/#949). |
| Jump during install | `fieldEpoch` ends the old system's slices and frees half-built batches; the install loop goes round again for the system arrived in. Probe row "a jump disposes the field left behind". A jump with the install mid-slice was not forced; the epoch path is asserted headlessly (`field-draw.test.ts`, "a system left mid-install"). |
| Repeated rebuild and teardown | `FieldDraw.dispose` frees the batches and points; shared shapes/material are marked `shared()`. Not measured against GPU counters. |
| Rotation and render layer | Positions come from the game clock (`world.gameTime`) and the plan's quaternion; no layer change. |

### Frame cost, GPU lane (the budget row)

Instrument: `scripts/measure-asteroid-field-cost.mjs`, #950's method on the
**shipped** path (field-00 of world 0x5ee11e, system 173, 193 rocks, authored
shapes, installed through the queue, updated inside `Game.render`). M1 Pro, ANGLE
Metal, renderer asserted, 1440×900 at device scale 2, chase, clock held, 12
shuffled blocks × 120 frames per arm, Mann–Whitney count beside every Δ. Two
runs (order seeds 20261019 and 7), raw output in
`node-968-field-cost-run1.txt` and `-run2.txt`. **Host load average was 8–21 on
10 cores during both runs** (other agents were working); the control arm ran in
the same blocks, and the two runs agree to 0.03 ms.

Worst Δ ms above the no-field control, run 1 / run 2 (calls above control):

| View | High, occlusion off | High, shadow + AO on | Low, off | Low, on |
| --- | --- | --- | --- | --- |
| close | +0.531 / +0.530 (2) | **+1.892 / +1.868** (4) | **+0.541 / +0.564** (3) | **+0.495 / +0.522** (3) |
| inside | +0.050 / +0.062 | +0.039 / +0.027 | +0.066 / +0.070 | −0.083 / −0.077 |
| edge | +0.071 / +0.084 | +0.042 / +0.069 | +0.085 / +0.083 | −0.064 / −0.079 |
| far | +0.036 / +0.033 | +0.019 / +0.012 | +0.100 / +0.100 | +0.068 / +0.021 |

Budget (#950 D1): high ≤ 1.0 ms and ≤ +12 calls, low ≤ 0.4 ms and ≤ +6 calls.
Calls are within budget everywhere (≤ 4 high, ≤ 3 low). **The `close` view fails
twice:** high with the shadow pass (+1.87–1.89 ms) and low (+0.50–0.56 ms).

#### Why `close` is over, measured

Decomposition at `close` (one run each, same instrument, arms toggled in page):

- High, occlusion off: near batch alone +0.526 ms, far batch alone +0.041 ms.
  The near batch is 6 rocks and 15.7k triangles, so this is fill, not vertex or
  call cost.
- High, shadow + AO on: castShadow forced off gives +0.433 ms; the level-0 shadow
  pass is the other ≈ +1.4 ms. `fitShadowCamera` fits the shadow camera to the
  ship and near-layer stations, not to the field, so a 400 m rock plausibly covers
  its whole map; that reading is from the code and was not measured.
- Low (no shadows): near batch (3 rocks) +0.572 ms; without the normal map
  +0.405, with neither map +0.333, anisotropy 1 +0.530. Shading a lit,
  normal-mapped rock across a large part of a 2880×1800 frame is the cost.

The earlier spike's `close` figure (+0.29 high, +0.40 low, #953) was taken on the
prototype generator's field, which has 210 rocks and put 2 rocks at level 0 at
this stand; the shipped generator's field has 193 and puts 6 (high) / 3 (low) at
level 0. The spike's script could not be re-run to compare (its loader reports
`Incomplete rock asset`), so that comparison rests on its recorded output.

No change was made to thresholds, shapes, material, texture settings or shadow
rules in answer to this.

#### D2 re-measure, after the ruling

Same instrument, `VIEWS=close`, on the branch rebased onto `origin/main`
(`32371d6`), two runs (order seeds 20261019 and 7), raw output in
`node-968-field-cost-d2-run1.txt` and `-d2-run2.txt`. Host load 12–15 on 10
cores: lower than the first runs (8–21), not idle.

| `close` arm | Run 1 | Run 2 |
| --- | --- | --- |
| High, occlusion off | +0.600 (2 calls) | +0.557 (2 calls) |
| High, shadow + AO on (#970's state) | +1.837 (4) | +1.894 (4) |
| Low, occlusion off | **+0.551** (3) | **+0.575** (3) |
| Low, occlusion on | +0.493 (3) | +0.498 (3) |

The figures match the loaded runs to within 0.04 ms, so host load did not drive
the low miss. Low stays above 0.4 and under the ruled +0.6 ms (D3).

## Verification and what is not done

- `bun test` over the new/changed files: `field-lod`, `field-draw`,
  `asteroid-model`, `system-models`, `model-queue`, `probe-selection`.
- `scripts/probe-asteroid-field.mjs` (new, in the catalog and contract roots):
  20/20 on the GPU lane and 18/19 earlier on the software lane before its level
  rows were corrected; `probe-model-queue` and `probe-production-boot` pass.
- **Not done:** the selector-chosen `probe:pr` run; a postcard probe row. s221
  and s84 were not run through the cost instrument.
- Found in the in-game check and filed apart: the field reads too small and too
  regular (#1043). Rock collision is not in this node (#957 → #969).
- Changelog: a major change by the docblock's definition (a pilot sees fields).
  Sentence in `src/changelog.ts`, approved by the principal on 2026-10-19.

## Historical measurements

None yet; #950's and #953's recorded runs are under `spikes/`.
