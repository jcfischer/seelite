## Resolution: asteroid field LOD and instancing budget

Prototype on branch `spike/asteroid-lod-950`, in `spikes/asteroid-lod-950/`. It is not production code.
- `field-render.ts` is the drawn form.
- `measure.mjs` is the instrument.
- `bounds.ts` is the bounding-radius check.
- `worst-case.ts` finds the test field.
- `measure-run1.txt` and `measure-run2.txt` are the two runs (order seeds 20261013 and 7).

**Conditions.** M1 Pro, ANGLE Metal (GPU lane, renderer asserted). 1440x900 at device scale 2, chase view, clock held. 12 shuffled blocks × 120 frames per arm. Medians with a Mann-Whitney count. `renderer.info` over one composed frame. The method is `measure-authored-hull-cost.mjs`'s, unforked.

The test field is the p99 field on `0x5ee11e`: galaxy 0, system 173, `field-00`, 210 rocks, 25–387 m. The p50 over 1,164 fields is 178, and the max over 10 worlds is 234. Every rock moves every frame: each timed frame advances field time by 1/60 s and recomputes every rock's matrix and level, so that CPU cost is inside the figures.

### D1 — Budget (principal, 2026-10-13, before tuning)

Cost above the no-field control at the worst-case view:
- quality high: ≤ 1.0 ms/frame and ≤ +12 draw calls, shadow pass included;
- quality low: ≤ 0.4 ms and ≤ +6 calls.

### D2 — Shadows (principal, 2026-10-13)

Only level-0 rocks cast into the shadow map, and only on quality high. Low casts none.

### D3 — Scheme

- **Two `BatchedMesh`es per field.** One holds level 0 and may cast shadows. The other holds levels 1–2 and does not cast. Both use per-instance frustum culling. Each rock's geometry id, matrix and visibility are set every frame.
- **One `Points` draw** for every rock below level 2, at 1.5 px.
- **Levels** are icosahedron detail 6/3/1, which gives 980/320/80 triangles. All levels of a shape are scaled by one factor, so `radiusKm` is the bound for every level (#948 D5).
- **A level is chosen by projected radius in physical pixels.**
  - High: level 0 above 40 px, level 1 above 10, level 2 above 1.5, a point below.
  - Low: every threshold doubled (80 / 20 / 3).
  - A rock steps up only past the edge × 1.15 (15 % hysteresis).

### D4 — What is live at near detail (the field is not)

Level counts L0/L1/L2/point for 210 rocks:

| View | High | Low |
|---|---|---|
| inside (cell corner near the centre) | 5 / 42 / 163 / 0 | 2 / 8 / 166 / 34 |
| edge (2 km off the long axis, all ahead) | 1 / 18 / 152 / 39 | 1 / 5 / 84 / 120 |
| far (200 km, the refinery's range) | 0 / 0 / 6 / 204 | 0 / 0 / 0 / 210 |

At most 5 of 210 rocks are at level 0.

### D5 — Far field

From the refinery (D3 of #948: 150–300 km), the field is about 200 points of 1.5 px. On high, about 6 of the largest rocks are at level 2. It costs one draw call, and +0.00 to +0.09 ms.

### D6 — Measured cost

The table gives Δ ms/frame above the control, as run 1 / run 2, at the worst view for each arm.

| Arm | High Δ ms | High +calls | Low Δ ms | Low +calls | Cold build |
|---|---|---|---|---|---|
| **batch-k** (D3, K=8 archetypes) | +0.53 / +0.25 (edge, occl on) | ≤ 5 | +0.23 / +0.17 (edge) | ≤ 3 | 19 ms |
| batch-unique (D3, one shape per rock) | +0.50 / +0.32 (edge, occl on) | ≤ 5 | +0.28 / +0.19 (edge) | ≤ 3 | **433 ms** |
| inst-k (`InstancedMesh` per shape × level) | +0.31 / +0.19 | **16–31** | +0.13 / +0.14 | 14–17 | 26 ms |
| naive (`buildAsteroid` per rock, no LOD) | +0.72 / +0.85 | **195–420** | +0.44 / +0.79 | 195–420 | 233 ms |

- The two `BatchedMesh` arms meet both budgets at every view, on both runs.
- `inst-k` is as cheap in time but goes past the call budget on high (24 meshes, no per-instance cull).
- `naive` goes past the call budget by 30× and comes near the low ms budget. It is out.
- A multi-draw counts as one call in `renderer.info`. ANGLE expands it in the backend, so the timing is the evidence and the call count is the API count.

### D7 — Open: archetypes or one shape per rock (for the principal; touches #952)

The frame cost is the same. The difference is build and memory.
- **O1 — K=8 archetypes.** Varied by scale, spin axis and rotation. Build 19 ms, 5.6k vertices. Shapes repeat: on average 26 rocks share each shape.
- **O2 — one shape per rock** from #948 D5's `shapeSeed`. Build 433 ms and 146k vertices for 210 rocks. A one-shot build is a visible stall, so the build must be time-sliced (for example ≤ 2 ms per frame, about 4 s), starting when the field comes into range. The field shows as points until then.

Whether O1 reads as a field or as repeats is #952's question, judged by eye.

### D8 — Findings production owes

- **`ROCK_SURFACE`'s normal does not turn with an instance.** It writes `normalMatrix * objN`, and `normalMatrix` is the object's. Under instancing or batching, a spinning rock's shading stays fixed while its silhouette turns. `fieldRockMaterial` patches in the instance or batching rotation (`vRockM`). The production material owes the same patch.
- **`buildAsteroid` exceeds its nominal radius.** `buildAsteroid(1, …)` reaches |v| = 1.224 over 64 tags. A field rock must be normalised to its bound, as `shapeLevels` does (max 1.00000003, float32). This binds #949's proxies.
- **A stale comment in `src/station-surface.ts`.** The comment says *"5,120 triangles"* for subdivision 4. three r170's detail 4 gives 500, which is the naive arm's 24,500 / 49. The comment is not fixed here.
