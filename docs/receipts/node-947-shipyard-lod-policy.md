# Shipyard LOD policy: node #947

Follows [the authored-model integration SOP](../model-integration-sop.md) §4. Continues
[node #818](node-818-shipyard-integration.md), which shipped the three yards at full detail.
Measured 2026-10-22 on `64f807d` plus this node's instrument. Raw output is in
[node-947-runs.txt](node-947-runs.txt) (every block names its invocation); frames are in
[node-947-shipyard-lod/](node-947-shipyard-lod/).

## Current result

- **D1, the policy this receipt recommends: the Full model at every range outside the bay. No
  reduced level ships for the yards.** Past the Full band's edge (40 silhouette radii) a yard costs
  a frame 0.09–0.18 ms more than an empty station (GPU lane, high quality), and the best reduced
  level there returns 0.03–0.09 ms (`lod1`, 40–400 radii) or 0.09–0.17 ms (`lod2`, past 400 radii).
  The first is the size of the instrument's own noise (0.06 ms); the second is real and is 2–4% of
  a 4 ms frame.
- **D2, the one place a reduced level pays: inside the bay.** With the camera in the bay a yard
  costs 1.6–3.1 ms over an empty station, and `lod2` (about 2 000–6 300 triangles against 135 000–209 000) returns
  1.4–1.7 ms of it at high quality and 1.0–1.2 ms at low, with **no pixel moved** in all 108
  poses deeper than the first 15% of the bay's depth. It changes what is drawn, so it is a ruling
  (Q2) and a build node, not part of this one.
- **F1, the cold-install stall is not a LOD matter.** The first draw of a yard uploads its two
  4096² textures in one task. Every one of 12 installs of forms a and c held a frame for 334 ms or
  more (ten between 334 and 494 ms, two outliers at 925 and 3 447 ms under host load 47–59); none
  of 6 installs of form b held one past 95 ms. A level shares those textures, so no level
  removes it (Q3).
- **Built here:** the instrument (`scripts/measure-shipyard-lod.mjs`), the candidate generator
  (`scripts/lib/shipyard-levels.ts`), a sampled geometric-error check
  (`scripts/measure-shipyard-level-error.ts`), rows holding every figure below that quotes a
  triangle count (`tests/shipyard-levels.test.ts`), and a split of `shipyard-flight.ts`'s loading
  from its installing (`loadShipyardAssets`) so the instrument loads a fresh copy and times it.
  **Nothing the game draws changes.** Not a major change under the map's rule.
- **Open, for the principal:** Q1 the budgets (proposed below, not agreed), Q2 the bay level, Q3
  the install stall.

## Budgets (proposed; none existed for a station)

The nearest precedent is the asteroid field's (#950: 1.0 ms and 12 calls on high). These are this
worker's proposals, written down after the measurements and not agreed beforehand (the SOP asks
for agreement first, and this session had no one to agree them with); Q1 asks the principal to rule on
them, and a different budget can change which rows pass but not the figures.

| | Budget | Measured | |
|---|---|---|---|
| B1 | A yard in frame costs at most 0.5 ms over an empty station on the GPU lane, high, from 2 radii out | 0.02–0.55 ms (form b at 2 radii 0.535, with traffic 0.545; noise there up to ±0.27) | met, by less than the noise |
| B2 | A yard seen from outside the Full band costs at most 0.25 ms | 0.09–0.18 ms | met |
| B3 | A level never adds draw calls to the Full model | 0 of 90 comparisons (45 rows, two levels) | met |
| B4 | The camera inside the bay pays at most 0.5 ms for the exterior | 2.2–3.1 ms (high), 1.6–1.9 ms (low) | **not met** |
| B5 | A cold install holds no frame past 100 ms | 334 ms and more on every install of forms a and c | **not met** |
| B6 | Crossing a level boundary moves at most 10% of the yard's pixels past 24/255 | 0.7–8.6% at the Full and `lod1` boundary | met |

## Conditions

- **Machine and renderer.** Apple M1 Pro, 10 cores, macOS 26.7.1, Chromium 151.0.7922.34 under
  Playwright, ANGLE Metal, headed, the player's renderer asserted by `assertPlayersRenderer`.
  Viewport 1440 × 900 at device scale 2, cockpit view, the game clock held, quality `high` unless
  a row says `low`. This is one GPU lane and one machine: nothing here says what an integrated or
  D3D11 renderer pays per call.
- **Fixture.** World seed 42, the form's own generated shipyard: form a system 7, b system 9, c
  system 1, no other traffic (`clearTrafficPresentation`), `models-full` so every model is
  installed. A system holds at most one shipyard (2 048 systems of seed 42 across the eight
  galaxies: 354 have one, none has two), so one yard is the most any frame draws.
- **Asset.** `shipyard-gantry.glb` sha256 `bf0378666f0f…`, `shipyard-foundry.glb` `0aed305df76a…`,
  `shipyard-slipway.glb` `71b7edefe1bb…`, unchanged from #818.
- **Arms.** Whole station meshes swapped into the game's own station slot, so its layer rule, spin
  and detail drive each as they drive the shipped one: `none` (an empty group, the control for every
  delta), `standin` (the procedural form), `full` (the shipped model, loaded afresh on the page),
  `control` (a second build of `full`: the same content, the instrument's noise floor), and the
  reduced levels. `lod1` is made to half a device pixel at 40 radii (`LEVEL_FRAME`: the 60° near
  camera at 1800 px), `lod2` to half a pixel at 400 radii, `lodc` to two pixels at 40 radii (a
  coarser step to see whether it buys more). Targets are 21.3 / 213.0 / 85.2 m on form a,
  19.2 / 192.5 / 77.0 m on b, 24.0 / 239.9 / 96.0 m on c.
- **Method.** `measure-asteroid-field-cost.mjs`'s: 10 blocks of 60 frames per arm and view (12 for
  the low-quality set), arm order shuffled from seed 20 261 022, a warm pass first, each block
  drained with a 1×1 `readPixels`, the median block reported and a Mann-Whitney count beside every
  delta ("lod1 is slower than Full in x of 100 block pairs"). Draw calls and triangles are
  `renderer.info` over one composed frame, every pass it draws. The occlusion pair (sun shadow and
  ambient occlusion) is pinned on at the views the game's gate opens it in (2, 6 and 15 radii, the
  mouth, the bay, traffic) and off beyond.
- **Views.** `close` 2 radii and `approach` 6 radii (on the aperture axis), `mid` 15, `edge` 41
  (just past the Full band), `far100`, `far420` (just past the
  outline band's held edge), `far1000`, `mouth` (0.4 km before the aperture plane), `bay` (the middle of
  the bay, looking out), `traffic` (approach range with four couriers 0.35–0.7 km ahead of the
  camera, in the near scene). Distance transitions are measured in both directions below.
- **Host load.** Other work shared the machine: the load average read 7–60 across the runs
  (printed at the start and end of each in the raw file). The `control` arm is what says how much
  that mattered.

## Results

### Bytes and phases

| | a Gantry | b Foundry | c Slipway |
|---|---:|---:|---:|
| GLB on the wire | 10 494 100 | 10 819 548 | 7 992 896 |
| lightmap (WebP) + probe grid | 1 704 168 + 590 976 | 1 448 010 + 912 384 | 1 521 516 + 1 099 800 |
| triangles, meshes | 200 924, 69 | 209 272, 80 | 135 736, 55 |
| vertex buffers, index (MiB, in memory) | 14.4, 2.3 | 14.9, 2.4 | 9.4, 1.6 |
| textures on the GPU (2 of 4096², RGBA8 with mips, estimated from their size) | 93 MiB | 93 MiB | 93 MiB |
| GLB fetch from a warm HTTP cache (ms) | 42–68 | 54–106 | 33–42 |
| fetch + decode, Meshopt and WebP (ms) | 112–207 | 109–171 | 110–142 |
| builder, then the first build (ms) | 0.3–1.3, 1.7–5.9 | 0.4–0.9, 1.6–3.1 | 0.2–0.6, 1.4–2.4 |
| program compile, `compileAsync` (ms) | 37–63 | 34–48 | 40–57 |
| upload of the two textures (`initTexture`, ms) | 346 | 314–464 | 340–423 |
| first draw once uploaded (ms) | 24–38 | 17–21 | 25–30 |

Each range is across 3–4 page loads. The GPU figure is `width × height × 4 × 4/3`, not an
allocator reading. The decode is the main-thread share of the load; the upload is one task.

The candidate levels cost, per yard, 41–112 ms to make in the page (`reducedYardSteps`; one 218 ms
under host load). **Correction after Sage round 1 (2026-10-23): the former claim of a worst
single mesh of 5 ms is withdrawn.** The old loop reset its timestamp after each subsequent
`next()` call, excluding that call's work. The corrected instrument times every call, including
completion, using the same helper as `tests/measure-generator.test.ts`. In one new `MODE=levels`
pass per form on the M1 Pro / ANGLE Metal GPU lane, high quality, at host load 5.9–7.3, it read:

| form | make ms, `lod1` / `lod2` / `lodc` | worst step ms, `lod1` / `lod2` / `lodc` |
|---|---:|---:|
| a Gantry | 60 / 58 / 58 | 18 / 18 / 17 |
| b Foundry | 59 / 58 / 59 | 16 / 15 / 15 |
| c Slipway | 36 / 37 / 37 | 13 / 13 / 13 |

These are whole-millisecond rounded wall times of synchronous generator calls, not frame
intervals or a bound across hosts and runs. A step includes one mesh operation, with setup on
the first call; completion is timed too. A background install can yield between meshes, but
cannot split one operation. These 13–18 ms steps do **not** establish a smooth sliced install;
any follow-up implementation needs its own production frame-interval measurement. The appended
corrected run in `node-947-runs.txt` supersedes the historical `worst mesh ms` columns; their
total construction times and census remain valid. Their index
buffers are 1.4 / 0.02 / 0.36 MiB (a: `lod1`, `lod2`, `lodc`), 1.3 / 0.03 / 0.12 (b) and 0.7 / 0.07 /
0.11 (c); they share the model's vertex buffers, `uv1` included.

### Cold-install stalls

`MODE=install`: the form's GLB held on a cold boot, released, and every animation-frame interval
recorded until the swapped yard is drawn and 500 ms after; every other model held meanwhile.

| | intervals past 100 ms (longest), six runs per form |
|---|---|
| a Gantry | 383, 414, 334, 335, 487 ms, and one of 3 447 ms at host load 58 |
| b Foundry | none past 95 ms: 80, 95, 43, 24, 30, 24 |
| c Slipway | 925 (at host load 47–59), 415, 494, 431, 423, 378 ms |

Aiming the camera at the yard afterwards added no stall past 47 ms on any form. The upload row in
the table above is the same size as the stall, and a fresh page that uploads the two textures first
then draws the yard in 17–38 ms, which is why the stall is read as the upload. **Form b's missing stall is not
explained**: its upload took as long on the fresh page, and none of its six installs showed it.

### Frame cost by view, high quality, M1 Pro

Every figure is ms/frame against the `none` arm unless the column says otherwise. `stand-in−none`
and `control−Full` are the procedural form and the noise floor; `lod1−Full` and `lod2−Full` are
the reduced levels against the shipped model (negative is faster). Calls and triangles are over
`none`, from `renderer.info`.

### quality high

| form | view | radii | band | frame none ms | stand-in−none | Full−none | control−Full | lod1−Full | lod2−Full | calls Full−none | lod1 | lod2 | triangles Full−none | lod1 | lod2 |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| a | close | 2.0 | full | 7.21 | -0.095 | +0.414 | +0.053 | -0.363 | -0.520 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | approach | 6.0 | full | 6.75 | +0.040 | +0.173 | +0.084 | -0.026 | -0.173 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | mid | 15.0 | full | 6.61 | -0.007 | +0.300 | -0.073 | -0.085 | -0.402 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | edge | 41.0 | lod1 | 3.90 | +0.034 | +0.119 | +0.025 | -0.045 | -0.096 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | far100 | 100.0 | lod1 | 3.99 | -0.115 | +0.108 | -0.045 | -0.087 | -0.239 | 118 | 96 | 57 | 201292 | 119561 | 2368 |
| a | far420 | 420.0 | lod2 | 3.82 | +0.088 | +0.146 | +0.035 | -0.053 | -0.107 | 87 | 65 | 27 | 200192 | 119325 | 2228 |
| a | far1000 | 1000.0 | lod2 | 4.00 | -0.008 | +0.115 | +0.001 | -0.052 | -0.115 | 87 | 65 | 27 | 200192 | 119325 | 2228 |
| a | mouth | 0.5 | full | 6.46 | +1.186 | +1.414 | -0.015 | -0.183 | -0.623 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | bay | 0.1 | full | 18.28 | +0.931 | +2.216 | +0.029 | -0.042 | -1.444 | 97 | 94 | 84 | 16020 | 5864 | 1052 |
| a | traffic | 6.0 | full | 7.01 | +0.234 | +0.454 | -0.083 | -0.109 | -0.253 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| b | close | 2.0 | full | 6.78 | +0.085 | +0.535 | -0.068 | -0.055 | -0.281 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| b | approach | 6.0 | full | 6.56 | -0.062 | +0.380 | -0.266 | -0.226 | -0.390 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| b | mid | 15.0 | full | 6.87 | -0.037 | +0.225 | -0.132 | -0.155 | -0.274 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| b | edge | 41.0 | lod1 | 4.12 | +0.027 | +0.147 | +0.056 | -0.039 | -0.111 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| b | far100 | 100.0 | lod1 | 4.30 | -0.022 | +0.181 | -0.022 | -0.065 | -0.085 | 129 | 107 | 59 | 209640 | 117322 | 2746 |
| b | far420 | 420.0 | lod2 | 4.09 | -0.021 | +0.143 | -0.027 | -0.057 | -0.168 | 98 | 76 | 29 | 208540 | 117086 | 2606 |
| b | far1000 | 1000.0 | lod2 | 4.12 | +0.012 | +0.141 | -0.012 | -0.039 | -0.129 | 98 | 76 | 29 | 208540 | 117086 | 2606 |
| b | mouth | 0.5 | full | 6.68 | +0.984 | +1.904 | +0.040 | -0.238 | -1.108 | 258 | 237 | 193 | 210432 | 118830 | 4354 |
| b | bay | 0.1 | full | 11.14 | +0.674 | +2.528 | +0.055 | -0.099 | -1.638 | 105 | 102 | 87 | 199088 | 115986 | 3042 |
| b | traffic | 6.0 | full | 7.08 | +0.028 | +0.545 | -0.257 | -0.379 | -0.526 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| c | close | 2.0 | full | 6.73 | +0.066 | +0.214 | +0.091 | -0.029 | -0.232 | 238 | 222 | 186 | 137712 | 63820 | 8324 |
| c | approach | 6.0 | full | 6.68 | -0.023 | +0.022 | +0.044 | -0.035 | -0.093 | 238 | 222 | 186 | 137712 | 63820 | 8324 |
| c | mid | 15.0 | full | 6.64 | +0.059 | +0.124 | +0.091 | +0.125 | -0.018 | 238 | 222 | 186 | 137712 | 63820 | 8324 |
| c | edge | 41.0 | lod1 | 3.99 | +0.032 | +0.140 | -0.013 | -0.048 | -0.131 | 238 | 222 | 186 | 137712 | 63820 | 8324 |
| c | far100 | 100.0 | lod1 | 3.94 | -0.001 | +0.099 | -0.008 | -0.047 | -0.089 | 104 | 88 | 52 | 136104 | 62212 | 6716 |
| c | far420 | 420.0 | lod2 | 3.89 | +0.020 | +0.106 | -0.001 | -0.038 | -0.089 | 73 | 57 | 22 | 135004 | 61976 | 6576 |
| c | far1000 | 1000.0 | lod2 | 3.92 | -0.011 | +0.086 | +0.019 | -0.033 | -0.085 | 73 | 57 | 22 | 135004 | 61976 | 6576 |
| c | mouth | 0.4 | full | 6.87 | +0.514 | +1.913 | -0.433 | -0.622 | -1.106 | 215 | 209 | 186 | 134112 | 63348 | 8324 |
| c | bay | 0.1 | full | 18.85 | +0.824 | +3.119 | -0.630 | -0.628 | -1.696 | 110 | 103 | 85 | 132516 | 61555 | 7112 |
| c | traffic | 6.0 | full | 7.04 | +0.113 | +0.193 | -0.006 | -0.062 | -0.150 | 238 | 222 | 186 | 137712 | 63820 | 8324 |

### quality low

| form | view | radii | band | frame none ms | stand-in−none | Full−none | control−Full | lod1−Full | lod2−Full | calls Full−none | lod1 | lod2 | triangles Full−none | lod1 | lod2 |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| a | close | 2.0 | full | 4.49 | +0.030 | +0.143 | +0.029 | +0.015 | -0.170 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | edge | 41.0 | lod1 | 1.65 | +0.100 | +0.160 | +0.006 | -0.032 | -0.115 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| a | far420 | 420.0 | lod2 | 1.75 | +0.060 | +0.105 | -0.007 | -0.015 | -0.094 | 87 | 65 | 27 | 200192 | 119325 | 2228 |
| a | bay | 0.1 | full | 13.11 | +0.837 | +1.619 | +0.052 | +0.002 | -0.980 | 97 | 94 | 84 | 16020 | 5864 | 1052 |
| a | traffic | 6.0 | full | 4.55 | +0.150 | +0.240 | +0.015 | -0.042 | -0.184 | 252 | 230 | 191 | 202900 | 121169 | 3976 |
| b | close | 2.0 | full | 4.55 | +0.003 | +0.341 | -0.021 | -0.039 | -0.368 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| b | edge | 41.0 | lod1 | 1.91 | +0.138 | +0.215 | -0.056 | +0.051 | -0.117 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| b | far420 | 420.0 | lod2 | 1.97 | +0.040 | +0.180 | +0.032 | +0.084 | -0.177 | 98 | 76 | 29 | 208540 | 117086 | 2606 |
| b | bay | 0.1 | full | 8.39 | +0.670 | +1.872 | -0.052 | -0.085 | -1.170 | 105 | 102 | 87 | 199088 | 115986 | 3042 |
| b | traffic | 6.0 | full | 5.45 | +0.175 | +0.759 | -0.174 | -0.568 | -0.203 | 263 | 241 | 193 | 211248 | 118930 | 4354 |
| c | close | 2.0 | full | 5.25 | +0.258 | +0.272 | +0.155 | +0.081 | -0.225 | 238 | 222 | 186 | 137712 | 63820 | 8324 |
| c | edge | 41.0 | lod1 | 1.78 | +0.080 | +0.095 | +0.048 | +0.001 | -0.059 | 238 | 222 | 186 | 137712 | 63820 | 8324 |
| c | far420 | 420.0 | lod2 | 1.87 | -0.042 | +0.031 | -0.045 | -0.046 | -0.032 | 73 | 57 | 22 | 135004 | 61976 | 6576 |
| c | bay | 0.1 | full | 13.20 | +0.650 | +1.703 | -0.064 | +0.026 | -1.059 | 110 | 103 | 85 | 132516 | 61555 | 7112 |
| c | traffic | 6.0 | full | 4.83 | +0.100 | +0.249 | -0.105 | -0.043 | -0.283 | 238 | 222 | 186 | 137712 | 63820 | 8324 |

**The noise floor** is the `control−Full` column. Beyond 40 radii it reads at most 0.056 ms (12 of
12 rows), at 2–15 radii at most 0.27, and inside views up to 0.63. A difference is not claimed
below that.

**What the columns say.**

- Beyond the Full band a yard (Full) costs 0.086–0.181 ms over none, high; 0.03–0.22 low.
  `lod1` is 0.033–0.087 ms cheaper than Full in all 12 rows there, the same sign every time and the
  size of the noise. `lod2` past 400 radii is 0.085–0.168 ms cheaper (6 of 6 rows high; 0.032–0.177
  low), which brings the yard to within 0.04 ms of an empty station.
- At 2–15 radii and in traffic the yard costs 0.02–0.55 ms and a level is not drawn there.
- At the mouth, 0.4 radii from the plane on the axis, it costs 1.4–1.9 ms; `lod1` returns 0.18–0.62
  of it and moves 1.2–1.6% of the frame (below).
- The stand-in costs about what `lod1` does at 41 radii and less everywhere else (the first column).

### Draw calls, triangles, and the Interior Auto LOD question

A level **never added a call**: `lod1` and `lod2` read below Full in every one of the 90 rows (the
yard's meshes are not instanced, and a level only drops what it prunes: 69 → 47 → 8 meshes on a,
80 → 58 → 10 on b, 55 → 39 → 3 on c). At the near views Full is 252 / 263 / 238 calls (a / b / c)
over an empty station, `lod1` 230 / 241 / 222, `lod2` 191 / 193 / 186. The triangle figure is larger
than the model's because the station draws it in more than one pass: at 2 radii with the occlusion
pair on, form a's frame holds 202 900 triangles in the near scene's colour pass and 73 950 and 36 912 in
two further scene passes (313 792 together, `passes` line of the raw file); with it off, one pass.
Calls fall with range (a: 118 at 100 radii, 87 from 420), for reasons the instrument did not attribute.

Fewer triangles did not make a proportional saving: `lod1` has 41–54% fewer triangles and buys 0.03–0.09
ms beyond 40 radii, while `lod2` has 95–99% fewer and buys 0.09–0.17. The cost follows the calls and
the passes at least as much as the triangles: `lod2` cuts 52–70 calls and `lod1` 16–22.

### Frame-time distribution

Single drained frames, 180 per arm in interleaved chunks, form a, high, at host load 12–16 (the
`single frames` lines of the raw file), at 2 radii: none p50 8.9, p95 10.7; Full 9.9, 12.0; `lod1`
10.1, 12.1; `lod2` 9.2, 11.0 ms; at 41 radii: none 5.4, 5.8; Full 6.6, 7.0; `lod1` 6.5, 7.3; `lod2`
6.0, 6.7. The tails (p99, max) vary by 5–20 ms between arms in a way the `control` arm shows is
host load (control p99 18.5 against Full's 7.2 at 41 radii), so they are not used. A drained single
frame costs 1–2.5 ms more than a block's mean, because each is waited for.

### Inside the bay

| | Full−none | `lod2`−Full | `lod1`−Full |
|---|---:|---:|---:|
| high, a / b / c | +2.2 / +2.5 / +3.1 | −1.44 / −1.64 / −1.70 | −0.04 / −0.10 / −0.63 (control −0.63) |
| low, a / b / c | +1.6 / +1.9 / +1.7 | −0.98 / −1.17 / −1.06 | +0.00 / −0.09 / +0.03 |

`lod2` is faster than Full in 100, 100 and 90 of 100 block pairs (a, b, c, high). The pixels do not move
(`MODE=frames`, whole frame, 5 184 000 px): `lod1`, `lod2` and `lodc` read **0 px past 24/255** at the
bay's middle on all three forms, against 39–42% of the frame for `none` (which also drops the bay's own
shell, so it is a size reference and not an exterior-only control). `MODE=bayposes` sweeps 54
poses a form (three depths: 15%, 50% and 85% of the way from the mouth to the bay's end; polar angles 0, 25, 60,
90, 135, 180° from the aperture axis, four azimuths where an angle has one): at 50% and 85% **all
108 poses of the three forms read 0 px for `lod1` and `lod2`**. At 15%, near the mouth, `lod2` moves up to
7 434 (a), 125 990 (b) and 12 622 (c) px of 5.2 M, and `lod1` up to 362 / 1 117 / 395 (an earlier run of form a read 3 221 and 335: the
count moves with the clock's phase a little, the zero at depth does not). So the swap belongs a
little inside the mouth, not at the plane. The bay here is the sim's shell and lit frame; the authored
interior kit is not in the arms (it would hide more, not less).

### Distance transitions, both directions

`MODE=pop`: two arms at one range and sun angle (35°, 100°, 170°, nine rows a pair), both forced to
the stated band state and checked after the render, on a 110 px box round the yard read at the real
FOV and resolution; "footprint" is every pixel either arm moves past 24/255 from the empty frame
(`measure-courier-level-pop.mjs`'s measure). The control, one arm drawn twice, moved 0 px in
every row.

| pair | range, state | footprint px | moved A→B px (share) | mean \|Δ\| code | luma shift |
|---|---|---:|---|---:|---:|
| p1 Full→`lod1` | 40.2 radii, `lod1`'s nearest (inbound hold) | 96–465 | 3–29 (1.0–7.8%) | 0.5–5.7 | −1.6…+5.1% |
| p2 Full→`lod1` | 41.9, Full's farthest (outbound hold) | 105–431 | 2–26 (0.7–8.6%) | 0.5–5.7 | −3.2…+3.1% |
| p3 Full→`lod1` | 42.0, the outbound switch itself (accessories change too) | 98–430 | 4–27 (1.8–7.9%) | 1.0–4.9 | −2.1…+1.9% |
| p4 Full→`lod2` | 401, `lod2`'s nearest (inbound) | 1–5 | 1–5 of 1–5 | | |
| p5 `lod1`→`lod2` | 419.5, `lod1`'s farthest | 33–41 | 1–4 (2.7–9.8%) | 2.3–13.1 | +1.6…+16.5% |
| p6 `lod1`→`lod2` | 419.9, the outbound switch (accessories change) | 33–41 | 32–40 (97–100%) | 52–84 | −85…−43% |

p6 is the existing band, not the level: past 420 radii the accessory band hides the capsule's lit
windows on any model, so the yard loses its brightest pixels whichever level is drawn (p5 holds the
accessories fixed and moves 1–4 px). The yard at 400 radii is a 12 px box and at 40 radii 110 px of the 2 880 px
frame. The crops are in `node-947-shipyard-lod/` (`<yard>-p1-sun35-a.png` is arm A at 1:1,
`-a4` the same ×4, `-diff4` the difference ×4 ×4): p1, p3, p4 and p6, sun 35°, all three yards.
`<yard>-approach.jpg` and `<yard>-edge41.jpg` are the game's frames at 6 and 41 radii; at 41 radii
the Gantry is about 20 CSS px wide above the reticle. `<yard>-bay-full.jpg` and `-bay-lod2.jpg` are the
bay frames, identical pixel for pixel.

### Geometric error, and what it supports

`bun scripts/measure-shipyard-level-error.ts`: 40 000 area-weighted samples from one surface to
the nearest triangle of the other, a 25 m grid searched to 400 m (nothing fell outside), seed 947.

| level (a / b / c) | target m | reached m (the simplifier's) | model→level p99 / max m | samples past target | level→model max m |
|---|---|---|---|---|---|
| `lod1` | 21.3 / 19.2 / 24.0 | 21.3 / 19.1 / 23.9 | 5.3 / 4.6 / 4.9 and 38.7 / 53.8 / 46.7 | 22 / 93 / 19 of 40 000 | 12.8 / 3.8 / 18.6 |
| `lod2` | 213 / 192 / 240 | 206 / 187 / 223 | 154 / 116 / 195 and 170 / 189 / 225 | 0 | 0 |
| `lodc` | 85 / 77 / 96 | 83 / 77 / 96 | 124 / 57 / 145 and 165 / 116 / 221 | 1 270 / 131 / 1 731 | 0 / 0.5 / 0 |

**The simplifier's "reached" equals the target and is not a bound.** `lod1`'s sampled model-to-level
distance reaches 1.8–2.8 times its target (38.7 m on a 21.3 m target), on 0.05–0.23% of the
samples. The figures are samples in two directions and say nothing of the unsampled maximum; the
level's vertices are the model's, so level→model is mostly 0, but 12.8 / 3.8 / 18.6 m on `lod1`
shows a triangle can bridge a concavity.

### `uv1` and the work-light grid

Every mesh a level draws carries the model's own `uv1` buffer (the same object; 47, 58 and 39
meshes on `lod1`, 8, 10 and 3 on `lod2`) and the model's materials, lightmap included; the simplifier weighs `uv1` (and the normal and `uv`) as attributes on
the unwelded index, so a collapse across a lightmap chart costs error instead of dragging a chart's
corner across it. The probe grid that lights ships (`ship-work-light.ts`) is read in the yard's
frame and is not a function of its meshes, and the figures the lightmap and the grid are read
through (`lightmap_scale`, `work_light_probes`) and the three marks the game aligns a yard by are
the model's, unmoved (`tests/shipyard-levels.test.ts`).

## Policy

| | Where it applies | What is drawn | Evidence |
|---|---|---|---|
| D1 | outside the bay, every range (2 radii to 1 000, and the layers beyond) | the Full model | the Conditions and Results above: 0.09–0.18 ms at most past the edge, of which a level could return 0.03–0.17 |
| D2 | inside the bay, past the first 15% of its depth (a proposal) | `lod2` of the same yard | −1.0…−1.7 ms a bay frame; 0 px in 108 of 108 poses |

**Options for the principal** (O1 is D1; O4 is D2):

- **O1** Full at every range, nothing built. *Recommended outside the bay.*
- **O2** `lod2` past 400 radii. Returns 0.085–0.168 ms (high) from one level, for a build of the
  generator into `src/`, a sliced install (41–112 ms a yard) and a band edge; the visible change is
  1–5 px at 400 radii. Decline unless the same is wanted for the other station families, where it
  would pay on every authored station.
- **O3** `lod1` and `lod2` both. `lod1` buys 0.03–0.09 ms at the price of 1–8% of a 100–470 px
  footprint at its nearest edge. Decline.
- **O4** `lod2` inside the bay (D2). Returns the most of any option, 1.0–1.7 ms a frame, for the
  frames the player flies into a berth. It needs the camera-in-bay predicate (with hysteresis, the
  mouth region excluded), levels made at install, and an in-game probe that repeats the pose
  sweep. *Recommended as a follow-up build node, after Q2.*

**Questions for the principal** (each needs a ruling, and none is settled here):

- **Q1** Are B1–B6 the budgets? In particular B4: is 0.5 ms the most the exterior may cost from inside?
- **Q2** Build O4? It changes what is drawn in the bay (pixel-identical at the poses sampled), so it
  wants the principal's yes on a frame, which this worker cannot give.
- **Q3** The 334–494 ms first-draw stall: accept it, or open a node? Nothing here tests a remedy;
  candidates are decoding the lightmap off the main thread (`createImageBitmap`), initialising the
  textures at a quiet moment during the background install, or a smaller or compressed lightmap.

**Reopen** this policy if a weaker GPU or an integrated one is measured (the calls are the cost
that does not scale with this machine), if a yard is drawn more than once in a frame, or if the
budgets in Q1 change.

## Not measured

- Any machine but this one; any renderer but ANGLE Metal.
- The authored interior kit (`authored-interior`) in the arms; the game's own Traffic (the
  `traffic` view parks four couriers); the docked state (#425 suppresses the 3D pass there).
- A yard as a player flies a berth, frame by frame: the bay views are fixed poses on a held clock.
- A GPU memory reading (the 93 MiB per yard is an estimate from the textures' size).
- Form b's missing install stall.
- Low quality at 2–15 radii except `close`; the six-yard amplification is in the raw file and is
  not used (its far420 block is rejected for a control that read −0.096 ms against a +0.311 ms
  per-yard Full).

## Reproduce

```bash
SEELITE_PROBE_RENDERER=hardware MODE=cost FORMS=a VIEWS=close,approach,mid,edge,far100 \
  node scripts/measure-shipyard-lod.mjs        # one form, five views, about 8 minutes
MODE=pop|shots|frames|bayposes|install|levels   # the other modes; knobs are in the header
bun scripts/measure-shipyard-level-error.ts
bun test tests/shipyard-levels.test.ts
```

The instrument takes the probe lock, starts its own dev server (`PORT`, default 5207) and refuses a
software rasteriser. Run it with nothing else on the GPU; the load figures it prints say whether
that held.

## Delivery evidence

- **Code changed in the game:** `src/shipyard-flight.ts` only, behaviour-preserving: the load
  (lightmap, probe grid, GLB, grid decode) moved out of `prepareShipyardModel` into the exported
  `loadShipyardAssets`, and the install steps (grid registered, lightmap applied, builder installed,
  failure clears the promise) stayed in `prepareShipyardModel` in their order. Every other file is an
  instrument, a test, `scripts/check-launcher-wiring.mjs`'s exemption for the new instrument, or a document.
- **Headless**, four `bun test tests/ --shard=n/4` runs with the default timeouts (not one `npm test`:
  a single run exceeds the 10-minute execution limit at this host's load of 27–85):
  shard 1 1 743 pass, 1 fail; shard 2 1 721 pass; shard 3 1 511 pass; shard 4 1 854 pass, 4 fail.
  The two fails that were this node's are fixed and their files re-run green: the script-to-`src`
  contract read a variable of the instrument named like a module (`tests/script-src-contract.test.ts`,
  5 pass), and the launcher-wiring gate wanted the new instrument exempted (`tests/script-gates.test.ts`,
  15 pass; `node scripts/check-launcher-wiring.mjs` exit 0). The other three were timeouts under load
  and pass alone: `tests/rock-heightfields.test.ts` (7 pass, 124 s), `tests/music-voices.test.ts` and
  `tests/station-mesh.test.ts` (60 pass together). Typecheck, `format:check`, `lint`, `lint:comments`
  and `npm run build` (including the size guard) pass at the final tree.
- **Browser:** no probe was run. The supervisor's `probe:pr` is the gate; the instrument's
  own modes are measurements and gate nothing. `shipyard-flight.ts` is a probe-contract root, so
  the selector will name probes for it (the model-queue, quality-bloom and station probes among them).
- **Principal's in-game approval:** not asked for: D1 changes nothing that is drawn. Q2 would.
  Changelog: not a major change.
- **Review round 1:** corrected the two important timing findings with a shared step-timing helper,
  five deterministic regressions, a GPU `MODE=levels` rerun of all three yards, and the correction
  above. Corrected the glossary wording. Deferred the optional framebuffer capture/difference
  refactor: those paths are unchanged and it is independent of this timing repair.
  Targeted checks: 25 pass, 0 fail across timing and script-contract/gate tests. Typecheck,
  formatting, lint, comment lint and production build pass. Browser selection inspected against
  `origin/main`: all 112 selected because of the existing launcher-wiring change; the supervisor
  owns that full browser gate. The measurement rerun passes and is not a browser-suite pass.
  The required single host `npm test` run for this fix pass completed: **6 839 pass, 0 fail**,
  400 files, 959 s (2026-10-23).

