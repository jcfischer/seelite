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
rtk test npm test               # bun, headless — sim logic, generators, unit scheme
npm run probe                   # starts a dev server, runs every browser probe
npm run probe:one <name>        # one probe
npx tsc --noEmit                # no errors
rtk lint npm run format:check   # biome, no fixes applied
rtk err npm run build           # tsc + vite build
```

The `rtk` prefixes exist because a green run's output is re-read on every later
turn of the session. Measured on a passing tree: `npm test` 702 bytes raw and
112 through `rtk test`, `npm run build` 627 and 76, `format:check` 88 and 22 —
a full green pass drops from 1,988 bytes to 781. Exit codes survive the filter
in both directions.

**On a red run `rtk test` prints `N fail` without naming the test.** It tees the
full output and prints the log path — read that file. Re-running the command raw
puts the unfiltered output into context, which is the thing the prefix avoids.

Two stay unprefixed on purpose. `rtk tsc` returns exit 2 on a clean typecheck,
so anything reading that exit code would treat a passing repo as broken. And
`npm run probe` has no rtk filter; a green run is already 19 lines.

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

Fifteen views on a fixed seed — bar one that declares its own — in
`scripts/lib/view-set.mjs`, each naming
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
- **`stockResponse` reads a *hold*, not a station.** #182 made §5.2's deficit
  scale with the flown hull: the mark is divided by `holdT` and clamped at
  `DEFICIT_SATURATION_RUNS` of it, so one full run of any hull moves a price by
  the same 10%. `holdT` is required at every call — `stockResponse`,
  `addDeficit`, `recordTrade`, `stationMarketScreen` — for `FlightPerformance`'s
  reason: a caller that forgot would silently get the courier's 20 t. The
  expression it replaced divided a ±63 **tonne** clamp by a fixed 20, which is
  identical at the baseline hull and stops distinguishing hulls entirely above
  63 t. The rejected arm is kept runnable as `fixedReferenceResponse`.
- **A hull's price is a law, not a figure, and the ceiling is geometric.**
  `hullPriceCr(holdT)` in `src/hull.ts` is #182's measured curve —
  `30,000 Cr × (holdT / 20)^0.613` — and every row's `priceCr` is asserted
  against it, the way `integrity` is. The exponent is well under one: a 60 t
  hold moves 3x the cargo and earns 1.9x. `HULL_CEILING_HOLD_T` is 197 t,
  declared in the leaf and re-derived in `tests/hull.test.ts` from
  `BERTH_CELL.trade` against the cargo role's hold density — the *economy* has
  no ceiling, so the largest berth is what caps the ladder. Above it
  `hullPriceCr` returns `null`, which is what the two capitals carry.
- **`src/hull.ts` is the third leaf, and it is where a hull's numbers live.**
  Role, selected variant, measured envelope, mass, thrust, hold, hardpoints,
  integrity and fuel — one row per hull, imports nothing. `sim.ts` derives every
  handling figure from mass and thrust (`flightPerformance`), so **thrust is the
  one handling dial a hull has** — back-solved from the acceleration the role
  should feel — and nothing else about the feel is separately tunable;
  `ship-mesh.ts` keeps `HULL_REACH_KM`, which
  is display reach and is never what a berth's fit predicate reads. The envelope
  is the **selected variant's built box**, and `tests/hull.test.ts` rebuilds the
  mesh to check it — the declaration this replaced was one figure per hull for
  three meshes and matched none of them, with the built hulls running 0.49x to
  1.68x the height declared for them, and the berth catalogue had been sized
  from it.
- **`stepFlight` and `stepAngular` take a `FlightPerformance` and it is not
  optional.** A default would let a caller that forgot to name a hull silently
  fly the courier, and the two are indistinguishable in a diff. The assist cap
  is deliberately *not* per hull: 2 km/s is the game's one combat speed and two
  other nodes are written against it.
- **`src/sim.ts` must not import Three.js.** The authoritative world is float64
  kilometres outside the scene graph; the scene graph is display only, and
  nothing reads a position back out of an `Object3D`.
- **A station's interior is drawn inside the spinner, and the sim owns its
  shape.** `src/station-interior.ts` computes the volume and the berth
  catalogue with no Three.js; `src/station-interior-mesh.ts` draws that
  catalogue and authors no dimension of its own. A berth is off the transit
  axis, so the interior has to turn with the station or a parked ship is left
  behind — which is why the group goes inside `spinner` rather than beside it.
- **There are two interiors, and the aperture's `kind` picks between them.** A
  **slot** role — trade, shipyard — gets §13.1's enclosed bay running inward
  from the plane. A **pad** role — refinery, outpost — gets an open deck *at*
  the plane with its berths standing on it, no shell, and an uncut hull, which
  is the principal's ruling on #165 reversing part of a ratified §13. So
  `endAxialKm === mouthAxialKm` on a pad and the volume runs outward to
  `stagingAxialKm`; `interiorAxialSpanKm` is the one place that ordering lives,
  and a consumer that reads `[end, mouth]` directly gets a pad backwards.
- **A pad's berths are the only parts of a station drawn in front of the
  aperture plane, so the corridor row is their gate.**
  `tests/station-mesh.test.ts` forbids anything inside the aperture's
  half-diagonal cylinder extended outward, and `PAD_CORRIDOR_MARGIN_FACTOR` is
  what keeps a berth's service boom — which reaches *inboard* of its own apron —
  on the right side of it. At 0.5 the boom cleared by 11 cm, which is a
  coincidence; the margin is 0.75 and it clears by 7.6 m. Anything added to a
  pad inherits the question.
- **A bay wider than the form that holds it pokes through the hull, and only
  half of that is checkable.** `tests/station-interior.test.ts` measures the bay
  against the **slot** forms' `core` box, which is the body their slot is cut
  into. The two pad roles are excluded and the exclusion is moot rather than a
  residue since #165: they have no bay to poke through anything, and what stands
  in front of their plane is measured by the corridor row over all twelve forms.
  A ray cast from inside still cannot stand in for the slot roles — a hull mesh
  is `FrontSide` and the ray passes straight through.
- **A shipyard is a rotating drum with a static spine, and the spine goes aft.**
  The slot is on the spin axis and #28 keeps the outboard structure still, so
  the two are in relative rotation; both forms drew the spine through the drum's
  interior, and §13's bay is what made it visible. A bearing has to be on the
  spin axis, so static structure meets the drum at an axial face — and the
  forward face is the aperture. `SHIPYARD_KEEL_AFT_KM` is that move, and
  anything mounted on the keel or the slab moves with it while the two booms,
  outside the bay's swept cylinder, do not.
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
  thing in the game — stations, ship hulls and the cockpit interior (#105) —
  from a `PlatingProfile` and a tag. It takes a profile and never a type, which
  is what stopped it being a station's. `hullLoft` writes UVs in **kilometres**,
  so a consumer divides by its own panel size: `SHIP_PANEL_KM` 0.008 gives a
  1 m x 4 m plate, `STATION_PANEL_KM` 0.15 gives 19 m square. Multiply a
  normalised unwrap by a count instead and a dreadnought and a tug get the same
  number of bands. The cabin is the exception that proves the rule: three's box
  and cylinder primitives write a *normalised* unwrap, so `plateCockpitUVs`
  rewrites them in kilometres through `boxProjectUVs` (moved to `loft.ts` in
  #105) — and it returns a **new** geometry, because that projection needs a
  non-indexed one. Drop the return value and the fitting is silently unplated.
- **A cabin is a moulding, not a plated hull, and a box cannot be a moulding.**
  #105's first pass brought the hull's panel grid inside and the principal
  rejected it against the Elite reference: those interiors carry their scale on
  the **rim of every cut edge**, not on lines. A `BoxGeometry` has a hard 90°
  edge with no width for a highlight to sit on, so it reads as a slab however it
  is lit. `src/chamfer-box.ts` is the cabin's form primitive and every fitting
  goes through it — and note the vertex rule that makes it one: **each face is
  inset on *both* its in-plane axes.** Pulling each corner in on one axis at a
  time gives a box with its eight *corners* cut, where adjacent faces still meet
  at an unbroken 90°, the twelve edge quads lie strictly inside the hull, and
  24 of 68 triangles draw nothing. That shipped, and the test could not see it
  because it counted distinct normals *in the buffer* — a buried triangle has a
  perfectly good normal. What catches it is convexity: every face's plane must
  support every vertex.

  On top of that form, the plating survives only as a rare, large seam
  (`COCKPIT_PANEL_KM` 0.072, about 3.6 plates across the scanner deck). Two
  figures were flown and rejected on the way: 0.024 was the grid, and a chamfer
  clamped at *half* the smallest half-extent made every thin slab more rim than
  face — chrome piping. The clamp is a quarter.
- **The cabin's emissive is a few discrete lamps, not a lit strip**, which is
  what the reference actually shows. They are warm white rather than the
  reference's red on purpose: `hud-and-scanner.md` §4 owns red as *refusal*, and
  a red lamp on the canopy frame would be an alarm the player cannot act on.
  A lamp also needs `COCKPIT_LAMP.standoffKm` — the first ones were smaller than
  the rail's own radius and were drawn inside it, so the sheet showed nothing.
- **A material dial cannot exceed 1, and clamping one is a silent repaint.**
  `MeshStandardMaterial` multiplies `roughness` by the wear map's green channel,
  so a finish rougher than a clean plate simply cannot be asked for. The cabin's
  roughest is 0.72 against a clean plate of 0.702, and `Math.min(1, …)` — which
  is still what `ship-surface.ts` does, where no finish has yet reached it —
  renders it at 0.702 instead. `cockpit-surface.ts` calibrates the profile up by
  exactly what the strongest declared finish needs and **throws** on a dial
  above 1, which is why `COCKPIT_FINISHES` lives in that module rather than
  inline in `buildCockpit`: a finish declared at the call site is one the
  calibration cannot see.
- **`berth-launch-chase` is not a repeatable view.** Two same-build control
  runs during #105 put it at **70.9% and 72.7%** of pixels moved past 24/255,
  against ≤0.4% for every other view in the same runs. Two samples, so read the
  figure as "most of the frame" rather than as a constant — the point is the
  order of magnitude, and it is enough. It frames a moving camera at a moving
  moment of a scripted launch. Any before/after reading on that row is noise;
  judge it by eye or not at all.
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
