# seelite

A browser-playable classic-Elite (1984) trade–fight–explore loop. TypeScript +
Vite + Three.js, static bundle, no backend, no runtime network requests.

## Read the map first

Work on this repo is planned as a **work-graph map**, and the map is the
authority on what to build and how:

```bash
soma graph node 1          # the map: destination, constraints, notes, decisions
soma graph frontier 1      # what is takeable right now
```

Its **Constraints** section binds every answer — an option that violates one is
not on the table. Its **Notes** section carries the delivery SOP (claim →
branch → worktree → TDD → PR → sage review → merge), when to stop reviewing, and
the repo's verification culture. Do not restate either here; read them there, so
there is one authoritative copy rather than two that drift. The map owns
constraints and decisions, `docs/specs/` owns ratified structural detail, and
`CONTEXT.md` owns vocabulary with pointers to those specs.

The `orienteer` skill walks the map. Every graph operation is a `soma graph`
verb — never reach past them to `gh issue` for node lifecycle, because the verbs
carry the rules.

This file exists because it is **tracked**, so it is present in every git
worktree the SOP tells you to create. Per-agent memory is not: a worktree is its
own project scope and loads none of it.

## Verification, both tiers

Anything arithmetic gets a headless test; anything rendered or spatial gets a
browser probe. A change is not done until both are green.

```bash
npm test                   # bun, headless — sim logic, generators, unit scheme
npm run probe              # starts a dev server, runs every browser probe
npm run probe:one <name>   # one probe
npx tsc --noEmit           # no errors
npm run format:check       # biome, no fixes applied
npm run build              # tsc + vite build
```

### Visual work has a third tier, and it is a person

A probe cannot fail on *this looks flat*. #35 and #36 both closed green and
produced the look #98 then set out to change; #36's receipt records that every
rendered form of its outline rule was measuring bloom. So a node that changes
what the game **looks like** closes on two things and not one: the canonical
view set, and the principal saying yes to it. The agent never stands in for
that yes.

```bash
npm run dev                          # in one shell
npm run views -- --label before      # in another, at the base commit
npm run views -- --label after       # again, with the change
open view-set/index.html             # the contact sheet, side by side
```

Fifteen views on a fixed seed, declared in `scripts/lib/view-set.mjs` — each names
the levers it is evidence for, and `tests/view-set.test.ts` goes red if a lever
in that file has no view. It cannot check that the view *shows* the surface, nor
that a lever added to the map reached the file; both are a person's job, which
is the point. A run that drops a view refuses to build a sheet at all, because a
sheet with a hole in it reads exactly like a whole one.

**Capture launches headed and then checks what it got.** It boots the page,
reads the real renderer back, and refuses to write a single frame unless that
renderer can be *shown* not to be a software rasteriser — an unreadable name
counts as unproven. So it needs a display, but the guarantee is about the
renderer rather than about headedness, and a displayless machine gets a full
boot before the refusal. Every other browser script here renders through
SwiftShader; for an image judged by eye that is the wrong picture, not merely a
slow one. `view-set/` is gitignored — before/after is two runs at two refs, not
a baseline in the repo.

`scripts/probe-guard.mjs` refuses to measure a dev server that is not serving
this working tree — the failure it prevents is a probe passing against someone
else's checkout on the same port.

**The probes do not run in CI** (#14). GitHub installs a browser per run, which
cost minutes per push and once hung for twenty-five; the runner has no GPU, so
everything it renders is software-rasterised anyway. `.github/workflows/deploy.yml`
gates a pull request on format, typecheck, unit tests and build — and nothing on
GitHub proves the browser tier was run. That check is yours, before you merge.

## Things that will bite you

- **`src/units.ts` and `src/vec3.ts` are leaves.** They import nothing, and
  `tests/headless.test.ts` asserts it. A value import into either can close an
  import cycle or drag a renderer into the headless tier.
- **`src/sim.ts` must not import Three.js.** The authoritative world is float64
  kilometres outside the scene graph; the scene graph is display only, and
  nothing reads a position back out of an `Object3D`.
- **A station's bay is drawn inside the spinner, and the sim owns its shape.**
  `src/station-interior.ts` computes the volume and the berth catalogue with no
  Three.js; `src/station-interior-mesh.ts` draws that catalogue and authors no
  dimension of its own. A berth is off the transit axis, so the bay has to turn
  with the station or a parked ship is left behind — which is why the group goes
  inside `spinner` rather than beside it.
- **A bay wider than the form that holds it pokes through the hull, and no
  headless check can see it.** A hull mesh is `FrontSide`, so a ray cast from
  inside passes straight through and reports nothing.
  `BAY_HALF_LIMIT_KM` is the per-form cap, authored beside the catalogue, and
  the evidence for each figure is a frame in the canonical view set.
- **A body's render layer is its distance, not its kind** — near within
  `HANDOFF_KM` of the camera, far beyond it, with a hysteresis band. Anything
  that adds a drawn object inherits this rather than picking a layer.
- **A station mesh is one core radius across, not kilometres.** Every body is
  drawn by `mesh.scale = radiusKm × layerFactor`, so `station-mesh.ts` authors
  in kilometres from `STATION_GEOMETRY` and then divides by the core radius on
  an inner group. Hand back kilometres instead and the station is drawn
  `radiusKm` times too large — and `probe-handoff.mjs`, which measures the
  handoff as `drawnRadius / radiusKm`, reads it as a scale error.
- **The lighting environment reaches `MeshStandardMaterial` and nothing else.**
  `scene.environment` is a baked star (`light-rig.ts`), assigned to all three
  layers and rotated onto the star each frame rather than rebaked. Hulls,
  station plating and the cockpit are standard materials and take it; every
  planet surface, shell and ring is a `ShaderMaterial` (`planet-surface.ts`) and
  is lit only by its own per-body star term from #59. A change that expects the
  environment to reach a planet is expecting it through a shader that never
  samples it.
- **One surface generator, and a plate is a size rather than a count.**
  `src/surface.ts` makes the plate, wear and seam-normal texels for every plated
  thing in the game — stations, ship hulls, and the cockpit when #105 lands —
  from a `PlatingProfile` and a tag. It takes a profile and never a type, which
  is what stopped it being a station's. `hullLoft` writes UVs in **kilometres**,
  so a consumer divides by its own panel size: `SHIP_PANEL_KM` 0.008 gives a
  1 m x 4 m plate, `STATION_PANEL_KM` 0.15 gives 19 m square. Multiply a
  normalised unwrap by a count instead and a dreadnought and a tug get the same
  number of bands.
- **A square grid of plates reads as scales, not as metal.** The profile carries
  the layout — `aspect`, `stagger`, `seamHalfWidthPx` — because all three were
  once hardcoded to the tiling case and the surface was flown and rejected for
  it. Plates are strips in a brick bond, and the groove is a scribed line: at a
  quarter of the plate it bevels every edge and each one domes into a pillow.
- **A hull's edge wear comes from the geometry, not from the map.** No texture
  knows where two plates meet; `hullLoft` writes a per-vertex `crease` attribute
  and `ship-surface.ts` patches it into `roughnessFactor`. A map term and a
  crease term answer different questions and neither substitutes.
- **`src/station-visuals.ts` can no longer be fingerprinted by probe-guard.**
  Its only top-level numeric constant moved to `src/surface.ts` in #101, and the
  guard reads nothing else there — profile figures are nested and the light
  colours are hex. It joins `cockpit.ts`, `live-cockpit.ts`, `planet-shaders.ts`
  and `planet-classes.glsl.ts` in that set. Naming it in a guard list does not
  guard it; it makes the probe throw before it starts.
- **A shader splice that misses its marker is silent.** `String.replace` with a
  renamed chunk returns the string unchanged, leaving a stock material that
  compiles, links, renders and carries the patched program's own name. Every
  patch here goes through `shader-splice.ts` and records what landed in
  `userData`, and a probe reads it.
- **Per-system RNG streams.** One shared generator couples every system to every
  other system's draw count. Add a domain tag rather than reusing one; reusing a
  tag silently correlates the two draws.
- **Probes read constants off the page** (`window.__seelite.units`) instead of
  restating them. A probe with its own copy of a constant goes falsely red when
  the module changes it.
- **The probe registry authorises no `command` or `url` probes for this repo.** A
  work-graph node declaring one will refuse to close until the adopter declares
  it.

## Stack

TypeScript, bun for tests, npm-compatible lockfile, biome for formatting,
Playwright for probes. No Python. Procedural everything — no downloaded assets;
audio synthesised via WebAudio, textures generated at load.
