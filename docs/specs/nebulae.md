# Seeded galactic nebulae

The principal selected O3 rose clouds and dark rifts, with O2 blue filaments
and lesser O1 amber accents, and approved both distant landmarks and local gas
inside those same clouds. The round 9 outside/inside captures were explicitly
accepted on 2026-10-14, followed by authorization to implement.

`src/nebula.ts` derives four volumes per galaxy from the world seed, galaxy
index and independent `DOMAIN.NEBULA` streams. Each has a 4–6 LY radius. These
are the prototype distribution carried into the first implementation, not a
new galaxy-generation or save-format version. Positions use the existing
galactic flattening; observer bearings use the existing sky frame. No system
generation stream is consumed. Moving between systems changes bearing, size
and whether the observer lies inside the volume.

`src/nebula-bake.ts` integrates procedural emission and absorption into a
2048×1024 half-float equirectangular texture once on system entry. The approved
gain is 1.275 and color saturation is 0.78. There are 96 samples per cloud ray;
empty central samples and effectively opaque rays skip further work. The
runtime loads no generated image and uses no Blender asset.

The star-free base sky retains the existing floor and core-cone haze. The
old per-system gas is replaced by the galactic volumes. Replacing the cone
with unresolved stellar population light is separate work. Stars remain in
their existing point layer.

The same texture supplies the world-fixed backdrop and the PMREM reflection
map. No nebula noise or rotation runs per frame. Low quality hides the
background and environment and cancels unfinished work. It skips new bakes until
high quality is selected; completed textures are reused. Replaced
render targets own and dispose their textures. Explicit diagnostic calls to
`bakeSky` omit nebulae unless its recipe carries `nebula: true`, so existing
lighting probes can still construct a controlled sky and restore the real one.

Development comparison knobs: `nebula=off`, `nebula-resolution=512|1024|2048|4096`,
`nebula-gain=0..10`, and `nebula-look=<cloud id>`. Production always uses the
default bake and ignores those appearance overrides.

The bake fills 128 strips across successive animation frames, each limited to
16,384 pixels. The base sky stays visible until the entire image is ready, then
the backdrop and reflections switch together. System changes cancel stale work;
postcards wait for the current bake. Unsupported half-float render targets retain
the base sky.

Hardware development measurements on Apple M1 Pro / ANGLE Metal, forcing GPU
completion after each strip: outside maximum 12 ms (p95 9 ms), inside maximum
11.6 ms (p95 11.3 ms). Total elapsed time including frame yields and readback was
1.15 seconds outside and 1.57 seconds inside. Pixel work is bounded, not elapsed
time on every device. These are two seed-47 fixtures, not a worst-case galaxy
bound. The final texture hash matches the synchronous implementation exactly.
The 2048 resolution softens fine filaments compared with the approved 4096
captures; colors and volume structure are unchanged.
