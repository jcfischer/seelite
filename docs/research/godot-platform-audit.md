# Godot 4 platform audit (node #855)

What Godot 4 can do for seelite on each target, and what it refuses. Each area
follows the question list on #855. Map: #854.

**Current stable release at writing (2026-10-10): Godot 4.7.2-stable**, released
2026-08-18 (<https://github.com/godotengine/godot/releases/tag/4.7.2-stable>).
4.8 is in development; its latest snapshot is 4.8-dev7 (2026-10-01, in the
`godotengine/godot-builds` releases). A row marked **4.8** is merged on `master`
but is not in any stable release.

**Sources.**

- Manual pages are cited at `docs.godotengine.org/en/4.7/`. I read them from
  the `4.7` branch of `godotengine/godot-docs`, and spot-checked the live pages
  against the branch.
- The class reference and engine source are cited at the tag `4.7.2-stable`.
  Where the manual says nothing, a row cites the source. That is what 4.7.2
  ships, not something the docs promise.
- Issues and PRs were read with `gh` on 2026-10-10. "Since 4.0" means that the
  class or member is in the class reference at the `4.0-stable` tag:
  <https://github.com/godotengine/godot/tree/4.0-stable/doc/classes>, or a
  module's `doc_classes` for `GLTFDocument`.
- Facts that are not about Godot cite the vendor's own source: Apple, ONNX
  Runtime, NuGet. GUT and gdUnit4 are **third-party** projects. Their rows cite
  their own repositories and are marked as third-party.
- Every URL here returned HTTP 200 on 2026-10-10. **CONFLICT** marks two
  sources that disagree. **Unknown** means I found no source. It is not a
  guess that the answer is no.

**Status words.**

- **Supported:** shipped and usable as seelite would use it.
- **Partial:** shipped, with a restriction that matters here.
- **Absent:** not in 4.7.2.

**The WebKit audit.** "WebKit §N" means section N of
`docs/research/mobile-webkit-audit.md` on branch
`research/mobile-webkit-audit` (node #846). Its browser rows apply only to a
Godot **web export** that runs in iOS Safari. Its hardware rows (the iPad
keyboard, Bluetooth pads) carry over to a native build.

---

## 1. Precision

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| Official export templates built with `precision=double` | **Absent**. The official builds are single precision. A double build means compiling the editor **and** "all export template binaries you intend to use" yourself | **Absent** (custom build) | **Absent** (custom build) | **Absent** (custom build). Whether a `precision=double` web template builds and runs: **unknown**, no source either way | The option exists in 4.x; no official double builds up to 4.7.2 | Use SCons `precision=double` and set the `.double` binaries as custom export templates | <https://docs.godotengine.org/en/4.7/tutorials/physics/large_world_coordinates.html> ("Enabling large world coordinates"); <https://docs.godotengine.org/en/4.7/tutorials/scripting/cpp/build_system/scons.html> ("different options than the official builds (e.g. … `precision=double`)") |
| Cost of a double build | "a performance and memory usage penalty, especially on 32-bit CPUs". "Tailored towards mid-range/high-end desktop platforms" | "may not perform well on low-end mobile devices" | Same as iOS | No figure | — | The page names *origin shifting* as the alternative and does not describe it | large_world_coordinates.html (note under "How large world coordinates work") |
| Shaders in a double build | Shaders stay single precision, and rendering emulates double (PR #66178). It does **not** apply to triplanar mapping, GPUParticles3D without local coords, `skip_vertex_transform` / `world_vertex_coords`, or world position rebuilt from `INV_VIEW_MATRIX` in `fragment()` | Same | Same | Same | — | Compute the world position in `vertex()` and pass it in a varying | large_world_coordinates.html ("Limitations"); open bug <https://github.com/godotengine/godot/issues/123213> (the Mobile renderer's scene shader fails to compile in double builds on D3D12) |
| GDExtension and C# in a double build | GDExtensions **must** be rebuilt (`REAL_T_IS_DOUBLE`). C# assemblies must be rebuilt with `--precision=double`, which defines `GODOT_REAL_T_IS_DOUBLE` | Same | Same | C# does not apply (no C# on web, §8) | — | — | large_world_coordinates.html ("Known incompatibilities"); <https://docs.godotengine.org/en/4.7/engine_details/development/compiling/compiling_with_dotnet.html>; <https://docs.godotengine.org/en/4.7/tutorials/scripting/c_sharp/c_sharp_features.html> |
| GDScript `float` and `int` in a **single** build | **Supported.** `float` "is a 64-bit double-precision floating-point number". `int` is "a 64-bit value, equivalent to `int64_t`" | Same | Same | Same | 4.0 | — | <https://docs.godotengine.org/en/4.7/classes/class_float.html>; <https://docs.godotengine.org/en/4.7/tutorials/scripting/gdscript/gdscript_basics.html> |
| `Vector2/3/4`, transforms, `Node3D` positions | **32-bit** in a single build ("unlike float which is always 64-bit") | Same | Same | Same | 4.0 | Keep sim positions in `float` scalars or `PackedFloat64Array`, and hand the scene graph small, camera-relative vectors | <https://docs.godotengine.org/en/4.7/classes/class_vector3.html> |
| `PackedFloat64Array` | **Supported.** "A packed array of 64-bit floating-point values" | Same | Same | Same | 4.0 | — | <https://docs.godotengine.org/en/4.7/classes/class_packedfloat64array.html> |
| C# `double` and Godot's C# math types | C# `double` is 64-bit in any build. Godot's C# vector types use `real_t`, which is double only when `GodotFloat64` is set | Same (C# is experimental there, §8) | Same (experimental, §8) | **Absent** (no C# on web) | — | Keep the sim in `double` and build `Godot.Vector3` values only at the scene-graph boundary | c_sharp_features.html ("Full list of defines") |

**For seelite.** The sim is "float64 kilometres, no Three.js, no DOM"
(`src/sim.ts:2`, `:148`, `:172`). The renderer already never moves the camera:
"each visible entity is placed at `simPos - simCameraPos`, computed in float64
in `sim.ts` and handed to the scene graph as a small number"
(`src/main.ts:11-16`). That scheme needs neither a double build nor its custom
templates. It needs only what a single build already gives on all four
targets: 64-bit GDScript `float`, `PackedFloat64Array`, or C# `double`, with
nothing reading a position back out of a `Node3D`. A double build is the only
option that needs custom templates for every target. The docs warn about it
on mobile. The seed generator (`src/rng.ts:41-46`) is a 32-bit LCG that wraps
with `>>> 0`, and `avalanche` (`src/rng.ts:102-109`) uses `Math.imul`. In a
64-bit GDScript `int`, both wraps must be written as an explicit
`& 0xFFFFFFFF`. Godot's own `RandomNumberGenerator` is PCG32, and "The
underlying algorithm is an implementation detail and should not be depended
upon"
(<https://docs.godotengine.org/en/4.7/classes/class_randomnumbergenerator.html>).

## 2. Renderers

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| Which renderers run | Forward+, Mobile, Compatibility | Mobile (Metal). Compatibility runs on Apple's OpenGL ES framework, built with `GLES_SILENCE_DEPRECATION`. Forward+ is "Supported, but poorly optimized" on mobile | Mobile (Vulkan). Compatibility (OpenGL ES). Since 4.4, if no RenderingDevice driver is available, the engine falls back to Compatibility | **Compatibility only.** "Godot currently does not support WebGPU" | Metal driver: 4.4 ("limited to Apple Silicon (ARM) devices"). Fallback: 4.4 | — | <https://docs.godotengine.org/en/4.7/tutorials/rendering/renderers.html> (Overall comparison; "Switching between renderers"); <https://github.com/godotengine/godot/blob/4.7.2-stable/platform/ios/detect.py#L178-L184>; <https://godotengine.org/releases/4.4/>; <https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html> |
| Colour buffer (HDR) | Forward+: RGBA16F, "High dynamic range". Mobile: RGB10A2, "Medium dynamic range, low precision" (RGBA16F with HDR 2D). Compatibility: RGBA8, "Low dynamic range" | Mobile: RGB10A2. Compatibility: RGBA8 | Same as iOS | RGBA8 (Compatibility) | Unknown | — | renderers.html ("Other features") |
| Depth buffer | Forward+: 32-bit, reverse Z. Mobile: 24-bit, reverse Z. Compatibility: 24-bit, no reverse Z | Mobile or Compatibility, as on desktop | Same | 24-bit, no reverse Z | Unknown | — | renderers.html ("Other features") |
| Glow (bloom) | Supported in all three renderers. In Compatibility it is a different implementation without Levels, Normalized, Strength, Blend Mode, Mix or Map | Mobile: supported. Compatibility: reduced | Same | **Partial** (Compatibility's reduced glow) | Unknown | — | renderers.html ("Environment and post-processing"); <https://docs.godotengine.org/en/4.7/tutorials/3d/environment_and_post_processing.html> (Glow note) |
| MSAA 3D | Supported in all three | Supported | Supported | Supported | 4.0 (`Viewport.msaa_3d`) | — | renderers.html ("Antialiasing"); <https://docs.godotengine.org/en/4.7/classes/class_viewport.html> (`msaa_3d`) |
| Shadow maps | All three. Compatibility uses "a multi-pass approach and less accurate blending" for lights with shadows. DirectionalLight PCSS: Forward+ only | Mobile: supported (no directional PCSS) | Same | Compatibility's multi-pass shadows | Unknown | — | renderers.html ("Lights and shadows") |
| Custom post-processing, full-screen quad | Supported in all three: a `CanvasLayer` with a `ColorRect` running a `canvas_item` shader, applied "to a frame after Godot has rendered it" | Supported | Supported | Supported | 4.0 (`CanvasLayer`, `ColorRect`) | — | renderers.html; <https://docs.godotengine.org/en/4.7/tutorials/shaders/custom_postprocessing.html> |
| `CompositorEffect` (hooks inside the pipeline) | Forward+ and Mobile only | Mobile: supported. Compatibility: **absent** | Same | **Absent** | 4.3 | Full-screen quad | <https://docs.godotengine.org/en/4.7/tutorials/rendering/compositor.html> ("only supported by the Mobile and Forward+ renderers"); <https://godotengine.org/releases/4.3/> |
| Built-in debanding | Forward+ and Mobile. `use_debanding` "has no effect when using the Compatibility rendering method" | Mobile: supported. Compatibility: **absent** | Same | **Absent** | 4.0 (`Viewport.use_debanding`) | A dither in a full-screen quad | class_viewport.html (`use_debanding`) |
| Several cameras in **one** viewport (camera stacking) | **Absent.** Proposal open since 2020 | Absent | Absent | Absent | — | One `SubViewport` per layer, each with its own camera and `transparent_bg`, composited. `transparent_bg` disables SSR, subsurface scattering and depth of field. Whether one glow pass can then run over the composite: **unknown**, no source | <https://github.com/godotengine/godot-proposals/issues/956>; class_viewport.html (`transparent_bg`, `own_world_3d`) |
| Shader compile stutter | Ubershaders and pipeline precompilation on Forward+/Mobile. Compatibility "lack[s] the functionality" and needs the legacy approach | Mobile: as desktop | Same | Compatibility: legacy approach | 4.4 | Pre-warm materials (Compatibility) | <https://docs.godotengine.org/en/4.7/tutorials/performance/pipeline_compilations.html> |

**For seelite.** The TS renderer draws three depth layers, background, far and
near, as "three `RenderPass`es in one `EffectComposer`". It does that because
"the bloom has to see the composite: a star's glow spilling over a planet's
limb" (`src/main.ts:20-30`). The handoff distance is `HANDOFF_KM = 1e4`
(`src/units.ts:117`). Godot has no camera stacking (proposal #956). The
`SubViewport`-per-layer workaround is the only sourced route. The bloom
requirement of `main.ts:27-30` is open against it, because no source says
whether glow can run once over a composite of viewports.

The output stage multisamples, dithers and vignettes "the moment the linear
HDR frame becomes eight bits" (`src/output-stage.ts:1-7`). It does this by
splicing into three's `OutputShader` (`:93-94`). Godot has no hook into its own
tonemap or encode pass. The dither and vignette become a full-screen quad,
which works in every renderer, or a `CompositorEffect`, which works on
Forward+ and Mobile only. Mobile and Forward+ also have built-in debanding.
Compatibility, and therefore web, has neither debanding nor more than RGBA8,
so web gets the least of the look on every row above.

## 3. Shaders

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| Program structure | One shader with `vertex()` and `fragment()`. Rename GLSL's `main` | Same | Same | Same | — | — | <https://docs.godotengine.org/en/4.7/tutorials/shaders/converting_glsl_to_godot_shaders.html> ("Shader programs", "Main") |
| `gl_FragColor`, `gl_FragCoord`, `gl_Position` | Mapped to built-ins `COLOR`, `FRAGCOORD`, `VERTEX`. In `canvas_item`, UV y is flipped | Same | Same | Same | — | — | converting_glsl_to_godot_shaders.html ("Variables", "Coordinates") |
| `precision highp float;` at the top of a file | **Absent.** Precision is set per variable (`lowp`/`mediump`/`highp`) | Same | Same | Same | — | Qualify variables | converting_glsl_to_godot_shaders.html ("Precision") |
| Preprocessor | `#define`, `#if`/`#ifdef`, and `#include` of `.gdshaderinc` files only, at most 25 deep | Same | Same | Same | — | — | converting_glsl_to_godot_shaders.html ("Macros"); <https://docs.godotengine.org/en/4.7/tutorials/shaders/shader_reference/shader_preprocessor.html> |
| Shader source built as a string at run time | **Supported.** `Shader.code` has a setter | Same | Same | Same | 4.0 | — | <https://docs.godotengine.org/en/4.7/classes/class_shader.html> |
| `dFdx`, `dFdy`, `fwidth` | Supported in every renderer. The `Coarse`/`Fine` variants are "Not available when using the Compatibility renderer" | Same | Same | Base functions only | Unknown | — | <https://docs.godotengine.org/en/4.7/tutorials/shaders/shader_reference/shader_functions.html> |
| Custom vertex attributes | **Partial.** A fixed set (`VERTEX`, `NORMAL`, `UV`, `UV2`, `COLOR` …) plus `CUSTOM0`–`CUSTOM3` | Same | Same | Same | — | Pack extra data into `CUSTOM0-3` | <https://docs.godotengine.org/en/4.7/tutorials/shaders/shader_reference/spatial_shader.html> |
| Patching a built-in material's shader (three's `onBeforeCompile`) | **Absent** as a hook. A `StandardMaterial3D` can be converted to a `ShaderMaterial`, "and their existing properties will be converted to an accompanying text shader" | Same | Same | Same | — | Convert, then edit the generated shader | <https://docs.godotengine.org/en/4.7/tutorials/shaders/your_first_shader/your_first_3d_shader.html> |
| Rendering into a texture (baking) | `SubViewport` plus `ViewportTexture` (the docs' worked example is a planet texture) | Same | Same | Same | 4.0 (`SubViewport`) | — | <https://docs.godotengine.org/en/4.7/tutorials/shaders/using_viewport_as_texture.html> |

**For seelite.** The planet code is about 2,000 lines of GLSL
(`src/planet-shaders.ts`, 1,100 lines; `src/planet-classes.glsl.ts`, 891
lines). It is built from template strings: the per-class bodies start at
`src/planet-classes.glsl.ts:140`. Its features all have equivalents above:
`precision highp float;` (`src/planet-shaders.ts:426`) becomes per-variable
qualifiers; `gl_FragColor` (`:481`) becomes a built-in; `dFdx`/`dFdy`
(`src/planet-classes.glsl.ts:86-88`) are in every renderer; strings assemble
into `Shader.code`.

Three's material patching has **no** equivalent. Hull and station plating
patch `MeshStandardMaterial` through `onBeforeCompile`
(`src/ship-surface.ts:629`, `src/station-surface.ts:225`). In Godot that
becomes a converted `ShaderMaterial` that owns its whole source. The baked
planet path (`src/planet-bake.ts:326`) maps to a `SubViewport` render target.

## 4. Procedural geometry and textures

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| `ArrayMesh` | Supported. "Slightly faster than using a SurfaceTool, but the API is a little more challenging" | Same | Same | Same | 4.0 | — | <https://docs.godotengine.org/en/4.7/tutorials/3d/procedural_geometry/index.html> |
| `SurfaceTool` | Supported | Same | Same | Same | 4.0 | — | procedural_geometry/index.html |
| A texture from a byte buffer | `Image.create_from_data`, then `ImageTexture`. `update()` reuses the texture and is "faster than allocating additional memory for a new texture each time" | Same | Same | Same | 4.0 | — | <https://docs.godotengine.org/en/4.7/classes/class_imagetexture.html> |
| Cost of both on mobile | **Unknown.** No source gives a figure | Unknown | Unknown | Unknown | — | Measure on device | — |
| Script speed for the generators | GDScript and C# are "within the same order of magnitude", and C++ (GDExtension) "will almost always be faster". C# garbage collection can cause stutter | Same | Same | GDScript or GDExtension only (no C# on web) | — | GDExtension for hot loops | <https://docs.godotengine.org/en/4.7/about/faq.html> |

**For seelite.** `src/surface.ts` writes plate, wear and seam texels into
buffers of "exactly `4 × w × h`" for `THREE.DataTexture`
(`src/surface.ts:362-366`). That shape is what `Image.create_from_data` takes in
RGBA8. `hullLoft` (`src/loft.ts:357`) builds flat position, UV and index
arrays and hands them to a `BufferGeometry` (`src/loft.ts:587-593`). Those
are the arrays `ArrayMesh` takes. No source gives the per-texel cost of running those loops in
GDScript on a phone.

## 5. GLB import

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| glTF 2.0 / GLB, editor import and runtime `GLTFDocument` | Supported | Same | Same | Same | 4.0 (`GLTFDocument`) | — | <https://docs.godotengine.org/en/4.7/classes/class_gltfdocument.html> |
| `EXT_meshopt_compression` | **Absent.** Not in `get_supported_gltf_extensions_hashset()`. A file that lists it in `extensionsRequired` fails: "glTF: Can't import file '…', required extension '…' is not supported" | Absent | Absent | Absent | Open PR "Add import support for Draco and meshopt mesh compression" (4.x milestone) | Re-export the GLBs without meshopt compression | <https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L6968-L6981>, <https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L7376-L7380>; <https://github.com/godotengine/godot/pull/120205> |
| `EXT_texture_webp` | Supported (`GLTFDocumentExtensionTextureWebP`) | Same | Same | Same | 4.1 (<https://github.com/godotengine/godot/pull/76895>) | — | `modules/gltf/extensions/gltf_document_extension_texture_webp.cpp` at <https://github.com/godotengine/godot/tree/4.7.2-stable/modules/gltf/extensions> |
| `KHR_materials_emissive_strength` | Supported | Same | Same | Same | 4.2 (<https://github.com/godotengine/godot/pull/78621>) | — | gltf_document.cpp#L6968-L6981 (above) |
| `KHR_materials_specular` | **Absent**, not in the supported list. It is optional in our files, so import goes on without it | Same | Same | Same | — | — | Same lines |

**For seelite.** I read the JSON chunk of each GLB on 2026-10-10. All four
authored models put `EXT_meshopt_compression` and `EXT_texture_webp` in
`extensionsRequired`: `src/models/coriolis.glb` (6.4 MB),
`courier-cockpit.glb` (3.0 MB), `courier-hull.glb` (15.2 MB) and
`longwall-miner.glb` (11.1 MB). `courier-hull.glb` also uses
`KHR_materials_specular`. The TS loaders install a meshopt decoder for them
(`src/courier-hull.ts:301-302`, `src/longwall-model.ts:27`). **Godot 4.7.2
refuses all four files as they stand.** They import only once they are
re-exported without meshopt, or once PR #120205 lands.

## 6. Audio

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| Synthesis at run time (`AudioStreamGenerator`) | **Partial.** "Due to performance constraints, this class is best used from C# or from a compiled language via GDExtension." From GDScript, "consider using a lower mix_rate such as 11,025 Hz or 22,050 Hz" | Same | Same | **Partial.** In the default *Sample* playback mode, "Procedural audio generation is not supported". *Stream* mode supports it, with "increased latency (especially when thread support is disabled)" | 4.0. Web Sample mode: 4.3 | Generate from C# or GDExtension. On web, set Default Playback Type.web to Stream | <https://docs.godotengine.org/en/4.7/classes/class_audiostreamgenerator.html>; exporting_for_web.html ("Audio playback") |
| A custom DSP effect on a bus | **Partial.** `AudioEffectInstance._process`: "It is not useful to override this method in GDScript or C#. Only GDExtension can take advantage of it" | Same | Same | Sample mode: "AudioEffects are not supported" | 4.0 | GDExtension | <https://docs.godotengine.org/en/4.7/classes/class_audioeffectinstance.html>; exporting_for_web.html |
| Built-in bus effects | Compressor, Limiter, HardLimiter, low/high/band-pass, notch and shelf filters, EQ, Reverb, Delay, Chorus, Distortion, Phaser, PitchShift and others | Same | Same | Not in Sample mode (above) | 4.0 (Compressor) | — | `doc/classes/AudioEffect*.xml` at <https://github.com/godotengine/godot/tree/4.7.2-stable/doc/classes> |
| Output latency | `audio/driver/output_latency`, default 15 ms. The host may not provide it; read `AudioServer.get_output_latency()` | Mix rate is "determined by audio driver" | The setting "is ignored on Android". The driver is OpenSL ES. Replacing it with Oboe is an open PR | Default 50 ms (`output_latency.web`) | — | Measure on device. Real latency on iOS and Android: **unknown** | <https://docs.godotengine.org/en/4.7/classes/class_projectsettings.html> (`audio/driver/*`); <https://github.com/godotengine/godot/tree/4.7.2-stable/platform/android> (`audio_driver_opensl.cpp`); <https://github.com/godotengine/godot/pull/109120> |
| iOS silent switch and audio session | — | `audio/general/ios/session_category`, default `0` (Ambient): "Use the Playback category to get sound output, even if the phone is in silent mode". `mix_with_others` is also there | — | Godot's web layer sets no `navigator.audioSession` (no match in `platform/web` at the tag). WebKit §9: Web Audio defaults to ambient, and the silent switch mutes it | 4.2 | Set the category to Playback | class_projectsettings.html; <https://github.com/godotengine/godot/pull/81196> |
| Autoplay unlock | — | — | — | A click, tap or key is needed before audio | — | A start screen | exporting_for_web.html ("Audio") |

**For seelite.** `src/audio.ts` builds a WebAudio graph:

- one `AudioContext` (`:305-307`);
- a `DynamicsCompressorNode` limiter on master (`:327`);
- per-cue oscillators, biquads and buffer sources (`:779-808`, `:1020-1040`).

The master limiter maps to a bus `AudioEffectCompressor` or `Limiter`. The
per-cue node graphs have no node-graph equivalent in Godot. They become
synthesis in a generator.

The music engine is already the shape a generator wants. It is "Pure — no
WebAudio and no globals", it renders one block per call, and "`command` may
allocate and `render` may not" (`src/music-engine.ts:1-19`). The worklet that
drives it today is a shell (`src/music-worklet.ts:1-8`, `src/music.ts:96-98`).
The docs steer `AudioStreamGenerator` to C# or GDExtension. The no-allocation
rule in `render` meets C#'s garbage-collection stutter (FAQ, §4). On web, a
generator needs Stream mode.

On iOS the default session category is Ambient, so the native build must set
Playback, or the silent switch mutes the game. That is the same finding as
WebKit §9, now with a project setting that fixes it.

## 7. Input

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| Multi-touch | `InputEventScreenTouch`/`ScreenDrag` with a finger `index` (touchscreens) | **Supported.** The iOS view sets `multipleTouchEnabled = YES` | Supported | Supported | 4.0 | — | <https://docs.godotengine.org/en/4.7/classes/class_inputeventscreentouch.html>; <https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/godot_view_apple_embedded.mm#L136> |
| Touch sent as mouse events | `input_devices/pointing/emulate_mouse_from_touch` defaults to **true** | Same | Same | Same | — | Turn it off for flight | class_projectsettings.html |
| `VirtualJoystick` control; multi-touch `BaseButton` | Supported | Supported | Supported | Supported | 4.7 (both) | — | <https://docs.godotengine.org/en/4.7/classes/class_virtualjoystick.html>; <https://github.com/godotengine/godot/pull/110933>; <https://github.com/godotengine/godot/pull/110893> |
| Gyroscope, accelerometer, gravity, magnetometer (`Input.get_*`) | **Absent.** "This method only works on Android and iOS" | **Supported.** CoreMotion device motion at `1.0 / 70.0` s | **Supported** once `input_devices/sensors/enable_gyroscope` (and `enable_gravity`, `enable_magnetometer`) is on | **Absent** (same note) | 4.0 | Values are zero in the editor: test on an exported build | <https://docs.godotengine.org/en/4.7/classes/class_input.html>; <https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/godot_view_apple_embedded.mm#L139-L143> |
| Fused device orientation (`Input.get_device_orientation()`, a quaternion) | **4.8** | 4.8 | 4.8 | — | 4.8 (not stable) | Integrate the gyroscope yourself in 4.7 | <https://github.com/godotengine/godot/pull/119142> |
| Bluetooth pads | SDL3 on Windows, macOS and Linux | **Supported**, through SDL3. **CONFLICT:** the manual still names only Windows, macOS and Linux for SDL. The 4.7 release notes ("switched to … SDL3 … for controller support on iOS"), PR #114316 and the source (`os_apple_embedded.mm` starts `JoypadSDL`) say iOS uses SDL3 in 4.7 | Godot's own code, which "may result in issues appearing only on those platforms" | Godot's own code | Desktop 4.5; iOS 4.7 | `Input.is_joy_known()` tells mapped pads from unmapped ones | <https://docs.godotengine.org/en/4.7/tutorials/inputs/controllers_gamepads_joysticks.html>; <https://godotengine.org/releases/4.7/>; <https://github.com/godotengine/godot/pull/114316>; <https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/os_apple_embedded.mm#L176-L184> |
| Which retail pads pair with iOS | — | Xbox, PlayStation and "other Bluetooth game controller[s]" (Apple; hardware fact carried from WebKit §3) | — | — | — | — | WebKit §3 → <https://support.apple.com/en-us/111099> |
| iPad hardware keyboard | — | **Supported.** `pressesBegan` maps `UIPress.key` to Godot keys (iOS 13.4+). Which keys iPadOS keeps for itself: **unknown**. Many iPad keyboards have no Escape key (hardware fact, WebKit §5) | — | — | 4.0 (`pressesBegan` in `platform/ios/view_controller.mm` at `4.0-stable`) | Bind a second key to every Escape action | <https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/godot_view_controller.mm#L61-L70> |
| Mouse capture (`MOUSE_MODE_CAPTURED`) | **Supported** | **Absent.** `FEATURE_MOUSE` is commented out in the iOS display server, and no pointer-lock code is in `drivers/apple_embedded` | **Supported.** Android pointer capture is wired (`requestPointerCapture`) | **Partial.** Uses the browser's Pointer Lock API and checks first that it exists. iOS Safari lacks it (WebKit §1) | 4.0: the desktop mode, the iOS `FEATURE_MOUSE` comment, Android `requestPointerCapture` and the web `requestPointerLock` call are all in `4.0-stable` | Touch or pad steering on iOS | <https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/display_server_apple_embedded.mm#L369>; <https://github.com/godotengine/godot/blob/4.7.2-stable/platform/android/java/lib/src/main/java/org/godotengine/godot/GodotVulkanRenderView.java#L160-L163>; <https://github.com/godotengine/godot/blob/4.7.2-stable/platform/web/js/libs/library_godot_display.js#L216-L217> |
| Unscaled mouse delta (`InputEventMouseMotion.screen_relative`) | Supported. `relative` "is automatically scaled according to the content scale factor". **CONFLICT:** the `MOUSE_MODE_CAPTURED` note in `Input` says to use `relative`, and the `InputEventMouseMotion` page says `screen_relative` "should be preferred … for mouse aiming when using MOUSE_MODE_CAPTURED" | — | Same as desktop | Same as desktop | 4.3 | Use `screen_relative` | class_input.html; <https://docs.godotengine.org/en/4.7/classes/class_inputeventmousemotion.html>; <https://github.com/godotengine/godot/pull/82800> |
| Lock to landscape | — | `FEATURE_ORIENTATION` is supported by the iOS display server | **Unknown**, no source read | No lock in iOS Safari (WebKit §2) | iOS: 4.0 (`FEATURE_ORIENTATION` in `platform/ios/display_server_ios.mm` at `4.0-stable`) | — | display_server_apple_embedded.mm#L378-L386 |

**For seelite.**

- `src/gamepad.ts` polls once a frame (`:11`) and refuses any pad off the W3C
  standard mapping (`:436`). In Godot, that refusal is `Input.is_joy_known()`.
- The pointer law is radians per **pixel** (`MOUSE_RAD_PER_PX`,
  `src/pointer.ts:19`), so it needs `screen_relative`. With `relative`, the
  sensitivity would change with the stretch mode.
- The desktop pointer lock (`src/main.ts:5146`) becomes
  `Input.mouse_mode = MOUSE_MODE_CAPTURED`. That mode exists on desktop and
  Android, not on iOS.
- A native build has tilt that the web build cannot have, on iOS and Android
  only. On iOS it arrives at 70 Hz.

## 8. C# on each target

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| C# export | **Supported** (Windows, Linux, macOS) | **Partial: "experimental and has a few limitations"**. Export "can only be done from a macOS device". The official simulator templates are `x64` only. Publishing uses **NativeAOT** (`PublishAot` = true in the SDK's `iOS.props`) | **Partial: "experimental"**. "Exporting to Android requires .NET 9 or later". The Mono runtime is the default (`UseMonoRuntime` in `Android.props`). The `dotnet/android_use_linux_bionic` export option chooses linux-bionic. All ABIs since 4.4 | **Absent.** "Projects written in C# using Godot 4 currently cannot be exported to the web." The export plugin's platform list has no web entry | Desktop 4.0. iOS/Android 4.2. Android all ABIs 4.4 | For web: Godot 3, per the docs. Draft PR [.NET] "Add web export support" is open (milestone 4.x). Issue "Readd support for web platform exports" is open | <https://docs.godotengine.org/en/4.7/tutorials/scripting/c_sharp/index.html> ("C# platform support"); <https://docs.godotengine.org/en/4.7/tutorials/scripting/c_sharp/c_sharp_basics.html>; <https://github.com/godotengine/godot/blob/4.7.2-stable/modules/mono/editor/Godot.NET.Sdk/Godot.NET.Sdk/Sdk/iOS.props#L3-L4>; <https://github.com/godotengine/godot/blob/4.7.2-stable/modules/mono/editor/Godot.NET.Sdk/Godot.NET.Sdk/Sdk/Android.props#L3>; <https://github.com/godotengine/godot/blob/4.7.2-stable/modules/mono/editor/GodotTools/GodotTools/Export/ExportPlugin.cs#L182-L186>; <https://godotengine.org/releases/4.4/>; <https://github.com/godotengine/godot/pull/106125>; <https://github.com/godotengine/godot/issues/70796> |
| Speed against GDScript | "within the same order of magnitude". Slower with many engine calls ("marshalling"). GC "can result in stuttering" | Same | Same | — | — | — | about/faq.html |

**For seelite.** Two TS facts meet these rows:

- The sim's positions are float64 (`src/sim.ts:148`), and C# `double` holds
  them directly.
- The music engine's rule that "`render` may not" allocate
  (`src/music-engine.ts:17-19`) is the rule that C#'s garbage collection
  tests. The docs send the generator to C# or GDExtension (§6).

A C# sim leaves out the web export. On iOS and Android it runs under
"experimental".

## 9. Testing

| Item | Desktop (CI host) | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| GUT (**third-party**) | GUT 9.7.1 targets Godot 4.7.x. It has a command-line runner | Running the tests on a device: **unknown** | Same | — | GUT 9.x for 4.x | — | <https://github.com/bitwes/Gut> (README version table; "Command Line Interface (CLI)") |
| gdUnit4 (**third-party**) | v6.2.x lists Godot 4.7 and 4.7.1. Tests "Gd scripts, C# scripts, and scenes" | Unknown | Unknown | — | — | — | <https://github.com/godot-gdunit-labs/gdUnit4> (README) |
| gdUnit4Net (**third-party**, C#) | The README badges list Godot up to 4.4.1. **Status on 4.7: unknown** | — | — | — | — | — | <https://github.com/godot-gdunit-labs/gdUnit4Net> |
| Engine `--test` | Runs the **engine's** unit tests and "requires compiling the engine with `tests=yes`". It does not run game tests | — | — | — | — | — | <https://docs.godotengine.org/en/4.7/tutorials/editor/command_line_tutorial.html> |
| Headless run | `--headless` = "`--display-driver headless --audio-driver Dummy`", on "any platform" | — | — | — | 4.0 | — | command_line_tutorial.html; <https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_dedicated_servers.html> |
| Headless export in CI | `godot --headless --export-release <preset> <path>`, e.g. for Android | iOS export needs "a computer running macOS with Xcode installed" | Headless export: the docs' own example is `--export-release Android` | Supported | — | macOS runner for iOS | command_line_tutorial.html; exporting_for_ios.html |
| A rendered frame with no window | **Absent.** Movie Maker and screenshots need a window: "a window *must* be spawned by Godot" (proposal, open). A draft PR adds `--offscreen`, Vulkan only | — | — | — | — | Run on a machine with a display and record with `--write-movie` (PNG or AVI; it forces `--fixed-fps`) | <https://github.com/godotengine/godot-proposals/issues/5790>; <https://github.com/godotengine/godot/pull/94530>; command_line_tutorial.html; <https://docs.godotengine.org/en/4.7/tutorials/animation/creating_movies.html> |

**For seelite.** The headless tier is about 4.1 MB of bun tests. It ports
where the module under test is pure. The music engine is "Pure … so
`tests/music-engine.test.ts` holds the whole transport headless"
(`src/music-engine.ts:9-11`). That kind of module runs under `--headless`
with GUT or gdUnit4. The browser-probe tier has no headless analogue in 4.7.2.
Any rendered check needs a display, today or until PR #94530 lands.

## 10. Memory and storage

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| App memory limit | — | **No fixed published figure.** `os_proc_available_memory()` returns "the number of bytes the app may allocate before it hits its memory limit", and "Memory limits can change during the app life cycle". Godot's `OS.get_memory_info()` reports `physical`/`free`/`available`/`stack`, which is not that limit. Whether Godot exposes the call: no source found | Unknown | WebKit §8: no published ceiling, and Safari kills the page in a reload loop | — | Measure on device | <https://developer.apple.com/documentation/os/os_proc_available_memory>; <https://docs.godotengine.org/en/4.7/classes/class_os.html> (`get_memory_info`) |
| Increased memory limit | — | Godot's iOS export option `entitlements/increased_memory_limit` adds `com.apple.developer.kernel.increased-memory-limit`. Apple: "only available on some device models" | — | — | 4.4 | — | <https://docs.godotengine.org/en/4.7/classes/class_editorexportplatformios.html>; <https://github.com/godotengine/godot/pull/99051>; <https://github.com/godotengine/godot/blob/4.7.2-stable/editor/export/editor_export_platform_apple_embedded.cpp#L503-L505>; <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit> |
| Where saves live (`user://`) | `%APPDATA%`, `~/Library/Application Support`, `~/.local/share` (table in docs) | The app's **Documents** directory (`NSDocumentDirectory`). `OS.get_cache_path()` is **Caches** | "a sandboxed directory in either internal or external storage" | "a virtual filesystem stored on the device via IndexedDB". In iOS Safari, WebKit §10's eviction rules apply | 4.0 | — | <https://docs.godotengine.org/en/4.7/tutorials/io/data_paths.html>; class_os.html (`get_user_data_dir`); <https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/os_apple_embedded.mm#L396-L416> |
| Where a large model file lives | Inside the exported PCK (`res://`), or fetched later as an extra pack and loaded with `ProjectSettings.load_resource_pack()` | Same | Same | Same | — | — | <https://docs.godotengine.org/en/4.7/tutorials/export/exporting_pcks.html> |

**For seelite.** Saves live in IndexedDB `seelite-saves`
(`src/save-store.ts:1235`). The voice model lives in Cache Storage
(`src/voice-store.ts:61`). Natively, both become files under `user://`.

The voice model is not one size. The WASM backend's `model_quantized.onnx` is
88 MiB and the WebGPU backend's `model_fp16.onnx` is 156 MiB
(`scripts/lib/voice-model.mjs:7`, `:50-58`). The "~160 MB" in #855 is the fp16
file. No source puts either size against the iOS app memory limit.

## 11. Neural voice

| Item | Desktop | iOS / iPadOS | Android | Web export | Since | Workaround | Source |
|---|---|---|---|---|---|---|---|
| ONNX or ML inference built into Godot | **Absent.** The 4.7.2 class reference has no ONNX or ML inference class | Absent | Absent | Absent | — | Link a runtime (rows below) | <https://github.com/godotengine/godot/tree/4.7.2-stable/doc/classes> |
| ONNX Runtime through a GDExtension (C API) | GDExtension: supported. ORT ships CPU packages for desktop | GDExtension: `ios` is a supported platform key. ORT: "pod 'onnxruntime-c'" | GDExtension: supported. ORT: the `onnxruntime-android` AAR provides the headers and `libonnxruntime.so` | GDExtension needs **Extensions Support** and cross-origin isolation headers, and must be "specifically compiled for the web platform". ORT's web package is `onnxruntime-web` (JavaScript). An ORT C build linked into a Godot web GDExtension: **unknown** | — | — | <https://docs.godotengine.org/en/4.7/engine_details/engine_api/gdextension/gdextension_file.html> (platform keys); <https://onnxruntime.ai/docs/install/>; exporting_for_web.html ("Thread and extension support") |
| … and Godot plus ORT together on a device | **Unknown.** No source shows the two linked and running | Unknown | Unknown | Unknown | — | A prototype on each target | — |
| ONNX Runtime through C# (`Microsoft.ML.OnnxRuntime` NuGet, 1.31.0) | ORT's C# page lists "Windows, Linux, Mac" | NuGet lists `net9.0-ios18.0` as compatible. Godot's iOS C# is experimental NativeAOT (§8). Whether the package links into a Godot iOS export: **unknown** | NuGet lists `net9.0-android35.0`. Godot's Android C# is experimental (§8). Whether it works there: **unknown** | **Absent** (no C# web) | — | — | <https://onnxruntime.ai/docs/get-started/with-csharp.html>; <https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime> |
| JavaScript from the web export (`JavaScriptBridge`) | — | — | — | "implemented only in the Web export … calling third-party JavaScript APIs". Running `onnxruntime-web` from a Godot page: **unknown**, no source shows it | 4.0 | — | <https://docs.godotengine.org/en/4.7/classes/class_javascriptbridge.html> |

**For seelite.** The voice runs Kokoro-82M on `onnxruntime-web` 1.22.0
(`package.json:30`) in a worker, with the WASM or WebGPU execution provider
(`src/neural-voice.worker.ts:131-155`). The text side, words to IPA to token
ids, is TypeScript with no eSpeak (`src/neural-voice.ts:7-9`). It ports like
any pure module. Only the inference session needs a runtime.

No path runs it inside Godot on all four targets from shipped, documented
parts. Desktop is the best-sourced combination. iOS and Android each have an
ORT package (C or NuGet), but no source shows it running inside a Godot export.
Web needs either JavaScript glue or a web GDExtension, and neither has a
source.

---

## Consequences for the map's open nodes

These are findings only. Each line says which options a finding keeps open or
closes. None of it decides a node.

**#856, determinism between the two games**
- GDScript `float` is IEEE double and `int` is 64-bit (§1). JavaScript's
  float64 arithmetic is reproducible in GDScript, and the bit-exact option is
  **not ruled out** by the language. Its cost is visible in the code: every
  32-bit wrap in `src/rng.ts` (`>>> 0` at `:44`, `Math.imul` at `:105-107`)
  needs an explicit mask in GDScript.
- `RandomNumberGenerator`'s algorithm "should not be depended upon" (§1). Any
  same-world option has to port `rng.ts` and `xorshift.ts`, not use the engine
  generator.
- `Vector3` and transforms are 32-bit in official builds (§1). A bit-exact
  option has to keep generation in scalars or doubles, not in Godot vectors.
- No Godot source says whether `sin`, `pow` and the other transcendental
  functions give bit-identical results across the four targets. A bit-exact
  option has this as an open risk.

**#858, the web build**
- Web export is Compatibility only: RGBA8, reduced glow, no debanding, no
  `CompositorEffect`, 24-bit depth without reverse Z (§2). The "Godot web
  export replaces the TS game" option gets the least of the look on every
  renderer row.
- C# cannot be exported to web in 4.7.2. The fix is a draft PR (§8). A web
  build in scope **rules out C# for any code that the web build ships**, until
  PR #106125 lands.
- On web, procedural audio needs Stream mode, which has higher latency, and
  bus effects are absent in the default mode (§6). The tilt sensors are absent
  on web (§7).
- In iOS Safari, a Godot web export hits the WebKit audit's limits (§6, §7,
  §10). It has no pointer lock. Godot sets no `audioSession`, so the silent
  switch mutes it. `user://` is IndexedDB under WebKit's eviction rules. The
  "Native only" and "Later" options avoid these limits. The replacement option
  does not.

**#860, GDScript or C#**
- C#: experimental on iOS (NativeAOT, export from macOS only) and Android
  (.NET 9), and absent on web (§8). GDScript is on all four targets.
- `AudioStreamGenerator` is steered to C# or GDExtension. Custom bus DSP is
  GDExtension only (§6). A GDScript-only option puts the music engine's
  per-sample loop in GDScript at a reduced mix rate. A mix (C# or GDExtension
  for audio) keeps the full rate.
- Float64: GDScript `float` and C# `double` both carry the sim without a
  double build (§1). On precision, neither option is ruled out.
- Test frameworks: GUT and gdUnit4 support 4.7 for GDScript. gdUnit4 also
  covers C#. gdUnit4Net's README stops at 4.4.1 (§9). All three are
  third-party.
- A double build, if chosen anyway, needs rebuilt C# assemblies and rebuilt
  GDExtensions (§1). That cost lands on the C# and GDExtension options.

**#861, evidence**
- Headless tier: `--headless` with GUT or gdUnit4 runs pure modules on any CI
  runner (§9).
- Rendered and look tiers: 4.7.2 cannot render a frame without a window (§9).
  Options that capture frames on a display-less CI runner are **ruled out**
  until PR #94530 or proposal #5790 lands. Options built on a machine with a
  display and `--write-movie` or in-game screenshots stay open.
- Look tier: mobile defaults to the Mobile renderer (RGB10A2) and desktop to
  Forward+ (RGBA16F) (§2). A Godot view captured on desktop is not
  pixel-for-pixel what the iPhone draws, so each view would need to name its
  renderer.
- Device tier: an iOS build needs macOS with Xcode for both languages (§9).

**#849, the input model**
- On-screen controls can be built from `VirtualJoystick` and multi-touch
  `BaseButton`, both 4.7 (§7). `emulate_mouse_from_touch` is on by default and
  sends touches as mouse events too.
- Tilt: on iOS and Android only. On iOS it is CoreMotion at 70 Hz. On Android
  it must be enabled in project settings. Godot fuses no orientation until 4.8
  (§7). In 4.7, a tilt option has to integrate the gyroscope or use gravity
  itself.
- Mouse capture is absent on iOS (`FEATURE_MOUSE` is off), supported on
  Android and desktop (§7). Any keyboard-and-mouse route on iPad that needs a
  captured pointer is **ruled out**. The pointer rate law needs
  `screen_relative` (4.3).
- Pads: SDL3 on desktop (4.5) and iOS (4.7). Android uses Godot's own code,
  which the docs warn about (§7). `Input.is_joy_known()` replaces the TS
  standard-mapping check.
- iPad keyboard: hardware keys arrive (iOS 13.4+). Escape is missing on many
  iPad keyboards (WebKit §5), so an option that binds back or close to Escape
  alone stays ruled out. Which keys iPadOS reserves: unknown.
- Landscape lock is a display-server feature on iOS (§7). A native build can
  lock orientation, which the web build could not.

**#850, the touch flight prototype**
- Every touch variant in the node has sourced building blocks in 4.7: drag
  (`ScreenDrag` with an index), `VirtualJoystick`, and tilt on iOS and Android
  (§7).
- The sensors return zero in the editor (§7). Tilt variants can only be judged
  on an exported device build.
- GDScript exports to iOS and Android without C#'s experimental status (§8).
  A GDScript prototype avoids that variable.

**#857, code home and CI**
- iOS export needs a macOS runner with Xcode. Command-line export with
  `--headless` is documented "for continuous integration setups", and its
  examples export Linux and Android (§9). The docs name no other host-OS
  restriction.
- A double-precision option would add custom editor and template builds for
  every target to CI (§1). The single-precision, sim-outside-the-scene-graph
  option needs only the official templates.
- Rendered checks need a runner with a display (§9). Headless tests run
  anywhere.
- The authored GLBs do not import into 4.7.2 as they stand (§5). Wherever the
  Godot code lives, the asset pipeline must re-export them without
  `EXT_meshopt_compression`, or wait for PR #120205.
