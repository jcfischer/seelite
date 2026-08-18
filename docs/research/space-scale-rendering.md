# Research: Space-Scale Rendering and Simulation in Three.js

*Research node for seelite — 2026-08-18.*

## Question

How should a browser Three.js game render and simulate at astronomical scale?
Specifically: floating origin / camera-relative rendering, depth-buffer
strategy (logarithmic vs multi-pass vs scaled layering), float32 precision
limits and unit schemes, and procedural star-field/skybox techniques —
ending in a concrete recommendation for seelite.

## Findings

### 1. Floating origin / camera-relative rendering in Three.js

**The core problem.** GPUs work in 32-bit floats (vertex attributes, uniform
matrices). A float32 has a 24-bit mantissa, so relative precision is ~1 part
in 10⁷: the farther a coordinate is from zero, the coarser the representable
steps. Positions far from the origin therefore quantize, and animated motion
turns into visible stepping ("jitter"). See the Godot engine's write-up with
concrete numbers ([Emulating Double Precision on the GPU](https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/))
and the general treatment in ["The Perils of World Space"](https://paroj.github.io/gltut/Positioning/Tut07%20The%20Perils%20of%20World%20Space.html).

**The fix: keep the camera at (or near) the origin and move the world.**
Two equivalent framings:

- **Floating origin / origin rebasing**: when the camera drifts beyond some
  threshold (e.g. a few thousand units), subtract the camera's position from
  every object (and the camera) so the camera snaps back near (0,0,0). High-
  precision "true" positions live outside the scene graph in float64.
  ([Wikipedia: Floating origin](https://en.wikipedia.org/wiki/Floating_origin),
  [Frozen Fractal: Floating the origin](https://frozenfractal.com/blog/2024/4/11/around-the-world-14-floating-the-origin/),
  [Babylon.js floating-origin docs](https://doc.babylonjs.com/features/featuresDeepDive/scene/floating_origin) — the
  same technique applies directly to Three.js.)
- **Camera-relative rendering**: every frame, compute each object's scene
  position as `float64WorldPos - float64CameraPos` and place the camera at
  the origin. This is what Unity HDRP does globally
  ([Camera-Relative Rendering in HDRP](https://github.com/shenzhou05/SRP-Chinese-Translation/blob/master/Pages/HDRP/Camera-Relative-Rendering-in-HDRP.md))
  and what Cesium calls Relative-To-Center/RTC
  ([CESIUM_RTC glTF extension](https://github.com/liwcv/glTF/blob/master/extensions/1.0/Vendor/CESIUM_RTC/README.md)).

**Three.js specifics.**

- JS numbers are float64, and Three.js `Vector3`/`Matrix4` element arrays are
  plain JS arrays, so *CPU-side* math (matrix composition, raycasting) runs in
  double precision. Precision is lost at the GPU boundary: geometry attribute
  buffers are `Float32Array`, and uniform matrices are uploaded as float32.
  Practical consequence: Three.js tolerates moderately large coordinates
  better than a pure-f32 engine, but forum reports consistently show visible
  shaking once positions reach the 10⁴–10⁶ range
  ([three.js forum: model shakes at large coordinates](https://discourse.threejs.org/t/moving-the-camera-model-will-shake-if-the-coordinates-are-large/7214),
  [Large coordinates thread](https://discourse.threejs.org/t/large-coordinates/50621?page=2),
  [Camera and floating point origin](https://discourse.threejs.org/t/camera-and-floating-point-origin/51486)).
  The standard forum advice is: keep the camera centered near the origin and
  translate the world instead of the camera.
- Implementation cost is low: one `Group` ("world root") whose position is set
  to `-cameraFloat64Pos` each frame, or a rebase step that subtracts an offset
  from all top-level objects when `camera.position.length() > threshold`.
  Per-frame cost is O(top-level objects); matrix updates happen anyway.
- An alternative shader-level trick discussed on the forum: zero out the view
  matrix translation in a custom vertex shader so "the camera in the shader
  always remains at its origin"
  ([forum thread](https://discourse.threejs.org/t/camera-and-floating-point-origin/51486)).
  This is more invasive (touches every material) and unnecessary if rebasing
  is done at the scene-graph level.

**What breaks / needs care with floating origin (Three.js):**

- **Raycasting**: works fine *within* the rebased scene (CPU float64), but all
  queries must be expressed in rebased coordinates. Cached world positions
  become stale the frame you rebase.
- **Shadows**: a directional-light shadow camera positioned in world space
  must be re-targeted after every rebase, or shadows swim/detach. Keep shadow
  cameras parented to (or re-centered on) the player ship. (General floating-
  origin caveat; flagged as inference, not from a Three.js-specific source.)
- **`matrixWorld` consumers**: anything caching `matrixWorld`,
  `getWorldPosition()`, or using `object.position` as a persistent identifier
  breaks across a rebase. The authoritative position must live in the sim
  layer (float64), never be read back from the scene graph.
- **Controls**: `OrbitControls`-style controls store a world-space `target`;
  it must be rebased too.
- **Physics**: f32-based physics engines (Rapier, Ammo) have the same
  precision limits, so physics must also run in a local/rebased frame.
- **Fog, log-depth, `cameraPosition` uniform**: all computed from camera-
  space distances, so they are *fixed*, not broken, by camera-at-origin
  rendering.

### 2. Depth handling: logarithmic depth vs multi-pass vs scaled layering

**Option A — `logarithmicDepthBuffer: true`.**
Redistributes depth precision logarithmically, allowing near ≈ 0.1 and
far ≈ 10¹² in one pass; effectively eliminates z-fighting for planet-scale
scenes ([three.js docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.logarithmicDepthBuffer),
[Gamedeveloper: Logarithmic Depth Buffer](https://www.gamedeveloper.com/programming/logarithmic-depth-buffer)).
Costs: the implementation writes `gl_FragDepth` per fragment, which
**disables early-Z**, so occluded fragments still shade. A forum benchmark
measured ~65 fps → ~35 fps (≈ +4.2 ms/frame) on a foliage-heavy scene, and
the penalty applies to all geometry, not just sprites
([Beware of logarithmic depth buffer](https://discourse.threejs.org/t/beware-of-logarithmic-depth-buffer-it-can-degrade-scene-performance/88495)).
It also has behaved inconsistently between desktop and mobile in the past
([three.js issue #18258](https://github.com/mrdoob/three.js/issues/18258))
and complicates depth-reading post-processing
([issue #23072](https://github.com/mrdoob/three.js/issues/23072)).

**Option A′ — reversed depth buffer (`reverseDepthBuffer: true`).**
Reverse-Z gives near-logarithmic precision distribution *without* writing
`gl_FragDepth`, so early-Z stays enabled. Landed in Three.js WebGLRenderer
via EXT_clip_control ([PR #29579](https://github.com/mrdoob/three.js/pull/29579),
[fix PR #30809](https://github.com/mrdoob/three.js/pull/30809),
[official example](https://threejs.org/examples/webgl_reversed_depth_buffer.html)).
Caveats as of research date: shadows have been partly broken with it
([issue #31413](https://github.com/mrdoob/three.js/issues/31413)) and
WebGPURenderer does not support it yet
([forum answer](https://discourse.threejs.org/t/does-three-js-webgpu-support-reverse-z-buffer/87687/2)).
Custom shaders sensitive to NDC range need the `USE_REVERSEDEPTHBUF` define.

**Option B — multi-pass depth slices.**
Draw the scene in several depth ranges back-to-front, refitting near/far and
clearing depth between slices. This is the classic full-scale solar-system
approach: distant objects are drawn (optionally scaled toward the camera) in
a far slice, then the near slice is drawn on a cleared depth buffer
([GameDev.net: Rendering huge (space) distance technique](https://gamedev.net/forums/topic/660567-rendering-huge-space-distance-technique/)).
In Three.js this maps to multiple `render()` calls with
`renderer.autoClear = false` + `clearDepth()` between them. Cost: one extra
scene traversal per layer, and materials/lights are per-scene; for two or
three layers this is cheap and completely portable.

**Option C — scaled-scene layering.**
Keep distant bodies in a separate small-scale scene: e.g. render planets at
1/1,000,000 scale a few thousand units away with proportionally scaled
positions (angular size is preserved because scale and distance shrink
together), draw that scene first, clear depth, then draw the local scene.
KSP does exactly this ("Scaled Space" subscene, itself with a floating
origin — [KSP wiki, Kraken/Krakensbane history](https://wiki.kerbalspaceprogram.com/wiki/Kraken_Drive)).

**How existing open-source space games handle it:**

- **Oolite** (the direct Elite descendant): sidesteps the problem by bending
  scale for playability — ships are oversized, planets and inter-body
  distances are drastically undersized, and objects whose projected size
  would be under a pixel simply aren't drawn
  ([Elite Wiki: Realism](https://wiki.alioth.net/index.php/Realism),
  [Rescaling experiment](https://wiki.alioth.net/index.php/Rescaling_experiment),
  [Distance (Oolite)](https://wiki.alioth.net/index.php/Distance_(Oolite))).
  A whole Oolite system fits within float precision; witchspace jumps between
  systems mean no continuous galaxy-scale coordinates are ever needed.
- **Pioneer Space Sim** (open-source Frontier: Elite II successor): full-size
  systems with a hierarchy of coordinate **frames** per body; the `Space`
  class manages the frame-of-reference system for physics at astronomical
  scale ([DeepWiki: pioneerspacesim/pioneer](https://deepwiki.com/pioneerspacesim/pioneer)).
  Simulation math is double precision (e.g. `Graphics::Frustum` operates
  entirely on doubles — [Pioneer dev forum: Doubles vs floats](https://forum.pioneerspacesim.net/viewtopic.php?t=137)),
  and rendering is camera-relative: terrain patches are translated by the
  difference between camera position and patch centroid before drawing to
  suppress f32 jitter (per GameDev/forum discussion of Pioneer's terrain;
  could not verify the exact source file, flagged below).
- **Celestia**: renders solar-system-to-galaxy range; its renderer
  (see [render.cpp](https://github.com/CelestiaProject/Celestia/blob/master/src/celengine/render.cpp))
  uses depth partitioning — multiple depth intervals fitted to object groups,
  drawn back to front — combined with camera-relative object positioning.
  (Level of detail of my description is from secondary sources plus the
  source file's structure; exact slice policy not independently verified.)
- **KSP** (closed-source but well documented): floating origin for the local
  scene + velocity rebasing ("Krakensbane") + a separate scaled-space scene
  for planets ([KSP wiki](https://wiki.kerbalspaceprogram.com/wiki/Kraken_Drive)).

### 3. float32 precision limits in practice

Precision of float32 near magnitude *x* is about *x* / 2²³ (≈ *x* · 1.2·10⁻⁷):

| Coordinate magnitude | float32 step | Practical effect |
|---|---|---|
| 10³ (1 km @ 1 m units) | ~0.06–0.12 mm | invisible |
| 10⁵ | ~0.8–1.5 cm | fine detail/animation starts stepping |
| 10⁶ (1,000 km @ 1 m) | ~6–12 cm | visible jitter on close objects ([Godot article](https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/): ~6.25 cm at 1,000 km) |
| 10⁷ (10,000 km @ 1 m) | ~1 m | severe — object positions quantize by ~1 m ([Godot article](https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/)) |
| 1 AU = 1.5·10¹¹ m | ~16 km | hopeless |

Community rules of thumb agree: below ~1,000–5,000 units from origin is safe,
slight jitter may appear in the 10³–10⁴ band for high-precision motion
(skeletal animation, slow camera moves), and by 10⁵–10⁶ shaking is obvious
([Studio Innovation R&D analysis](https://furr-tec.ch/index.php/2025/03/13/exploring-high-precision-computation-in-game-engines-a-comprehensive-rd-analysis/),
[Overcoming Floating Point Precision Errors](https://www.gamedeveloper.com/design/overcoming-floating-point-precision-errors-),
three.js forum threads above). The exact visible threshold depends on scene
scale and camera speed; treat "keep everything the GPU sees under ~10⁴–10⁵
units" as the engineering budget.

**Unit-scheme consequence.** No single float coordinate space spans a solar
system. The standard split:

- **Sim layer (float64, outside Three.js)**: system-scale positions. Float64
  has a 53-bit mantissa → ~0.15 mm precision at 1 AU stored in meters —
  ample. Plain JS numbers suffice; no double-double emulation needed (that
  technique — splitting a double into two floats on the GPU — exists if ever
  required: [Godot article](https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/)).
- **Render layer (float32, Three.js scene)**: camera-relative positions in a
  unit where all *rendered* geometry sits within ~10⁴ units of origin.

Elite-likes have an extra option Oolite proves out: make the *gameplay*
scale small (compressed distances) so even the sim fits comfortably — but
that trades away realistic system layouts.

### 4. Procedural star field and skybox (seeded, no assets)

Constraints: fully procedural, deterministic from a seed, static bundle.
Both mainstream techniques satisfy this:

**(a) Point-cloud star field** — one `THREE.Points` with a few thousand to
~100k vertices, positions generated at load from the seeded RNG (uniform on
a sphere at "infinite" radius), colors from a blackbody-ish ramp, sizes from
a magnitude distribution; a small custom `PointsMaterial`/ShaderMaterial
adds soft falloff and optional twinkle
([Andreas Rohner: Random starfield generator for THREE.js](https://andreasrohner.at/posts/Web%20Development/JavaScript/Random-starfield-generator-for-THREE-js/),
[procedural-stars-threejs](https://github.com/CK42BB/procedural-stars-threejs)).
Render it in a **background scene with `depthWrite/depthTest` off (or drawn
first, then depth cleared)** and keep it centered on the camera each frame so
it never parallaxes. Pros: trivially deterministic; individual stars can be
*real* galaxy stars (the actual seeded systems, projected), enabling
Elite-style "that dot is a place you can go". Cons: per-frame vertex cost
(negligible up to ~10⁵ points) and no nebula background.

**(b) Generated cubemap skybox** — at load (or per-system entry), render a
seeded procedural shader (layered simplex/FBM for nebulae + hash-based star
splats) into a cubemap via `THREE.CubeCamera`/`WebGLCubeRenderTarget`, then
set it as `scene.background`. Milky-Way-style band and nebulae come from
noise octaves ([Starry Shader for Sky Sphere](https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578),
[Sangil Lee: Create the Milky Way Skybox](https://sangillee.com/2025-02-14-create-skybox/),
[procedural space skyboxes demo](https://parallel-cascades.itch.io/procedural-space-skyboxes-demo)).
Pros: zero per-frame cost after bake, rich backgrounds. Cons: baked stars
are texels, not addressable objects; bake cost (~ms, once) on system entry.

Determinism: use a small seeded PRNG — sfc32 or mulberry32 — never
`Math.random()`. Both are tiny, fast, and PractRand-clean enough for procgen;
derive per-domain streams (galaxy layout, per-system, skybox) by hashing the
master seed with a domain tag so adding a feature never perturbs existing
systems ([Red Blob Games: Upgrading my PRNG](https://simblob.blogspot.com/2022/05/upgrading-prng.html),
[Mulberry32 write-up](https://www.4rknova.com/blog/2026/03/01/mulberry32-rng)).
Seelite already vendors seeded RNG streams + simplex noise from seekolous
(README), which is exactly the needed kit. GPU-side star/nebula shaders must
use an explicit integer hash (e.g. PCG/Wang hash) rather than the classic
`fract(sin(x)*43758.5453)` hash, which is driver-dependent — this keeps the
skybox identical across GPUs. *(Cross-GPU sin-hash instability is widely
reported in shader-art communities; flagged as practice-verified rather than
paper-cited.)*

The hybrid used by most space games: cubemap (or big-triangle full-screen
shader) for galaxy haze/nebulae + a Points layer on top for the bright,
nameable stars.

## Recommendation for seelite

**Unit scheme — two layers, km-based:**

- **Sim space (authoritative)**: per-system float64 coordinates in
  **kilometers**, plain JS numbers, living entirely outside Three.js.
  1 AU ≈ 1.5·10⁸ km is exactly representable with sub-millimeter precision in
  float64. Galaxy level needs no continuous coordinates at all — Elite-style:
  systems are discrete nodes (seed → position on the galaxy map), and
  hyperspace jumps swap the whole system context. Velocities also live here
  (rebase velocity too if you add frame-dragging mechanics later).
- **Render space**: Three.js units = kilometers, camera-relative. Everything
  actually rendered as geometry sits within ~10⁴ units (10,000 km) of the
  origin — comfortably inside the f32 budget from §3.

**Origin strategy: camera-relative every frame (not threshold rebasing).**
Each frame, for every visible entity set
`mesh.position = f64Pos.sub(f64CameraPos)` (double math in the sim layer,
assign the small result to the f32-bound scene graph) and keep the Three.js
camera at the origin (rotation only). With an Elite-scale count of nearby
objects (tens, not tens of thousands) the per-frame cost is negligible, and
it avoids rebase-event bugs (stale caches, shadow pops) entirely. Rules:

- The scene graph is *display only*; nothing reads authoritative positions
  back from `Object3D.position`/`matrixWorld`.
- Raycasting (targeting, laser hits) happens in render space — valid since
  it is just sim space translated, same scale.
- If a physics engine is added (Rapier), it runs in a local combat bubble in
  the same camera-relative km frame.
- Shadow-casting lights (if any) get positioned camera-relatively too.

**Scene layering — three layers, one renderer, depth cleared between:**

1. **Background layer**: seeded procedural skybox (nebula/galaxy haze via
   FBM shader baked to a cubemap per system entry with `CubeCamera`) plus a
   `THREE.Points` star layer where bright points are the actual neighboring
   seeded systems. No depth write.
2. **Far layer ("scaled space")**: planets, moons, stars of the current
   system, rendered KSP-style at 1/100,000 scale — position and radius both
   divided by 1e5, preserving angular size — so a 1.5·10⁸ km star distance
   becomes 1,500 units. Drawn with its own near/far; then `clearDepth()`.
3. **Near layer**: ships, stations, asteroids, particles within ~10,000 km,
   at 1:1 km scale, camera-relative, near ≈ 0.01 (10 m), far ≈ 2·10⁴.

Implementation: three `Scene` objects, `renderer.autoClear = false`, render
1 → 2 → `clearDepth()` → 3. An object crossing the ~10⁴ km boundary
(approaching planet) migrates between layers — hidden by matching the scale
factor at the handoff distance.

**Depth handling: don't use `logarithmicDepthBuffer`.** With the layered
scheme, each layer's near:far ratio is ≤ ~10⁶, which a plain 24-bit depth
buffer with sensible near planes handles without z-fighting — so seelite
avoids both the early-Z performance penalty (§2) and log-depth's
mobile/post-processing quirks, and stays WebGPU-ready. Optionally enable
`reverseDepthBuffer: true` later as a free precision upgrade once its shadow
issues are resolved and if WebGPURenderer support lands — it's a one-flag
change, not an architecture change.

**Determinism**: all generation (galaxy graph, system bodies, skybox bake
inputs, star points) drawn from the vendored seeded RNG streams with
domain-tagged sub-seeds; GPU hashes use integer PCG-style hashing so the
baked skybox is bit-stable across devices.

## Open questions

- **Layer-handoff polish**: exact handoff distance and whether planets need
  an intermediate "approach" layer for landing-distance rendering (seelite
  may never allow closer than orbit — Elite 1984 docks at stations only —
  which would let the far layer alone carry all planetary rendering).
- **Reversed-Z timing**: track [three.js #31413](https://github.com/mrdoob/three.js/issues/31413)
  (shadows with reverse-Z) and WebGPURenderer support before flipping it on.
- **Pioneer/Celestia internals**: my descriptions of Pioneer's clip-centroid
  translation and Celestia's exact depth-partition policy come from forum
  posts/secondary sources; I did not trace the current source files. Worth a
  source read only if we hit a wall the layered design doesn't solve.
- **Twinkle/point-size portability**: `gl_PointSize` clamping varies by GPU
  (commonly 64–1024 max, and 1.0 min on some mobile GPUs); bright-star
  rendering may need quad sprites instead of points if size fidelity matters.
- **In-system supercruise**: if seelite adds Frontier-style continuous
  in-system travel (vs. Elite-1984 instant/witchspace hops), the sim-layer
  float64 km scheme already covers it, but time-step handling (large dt ×
  large velocity) needs its own look.
