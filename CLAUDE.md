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

Views on a fixed seed — bar one that declares its own — in
`scripts/lib/view-set.mjs`, each naming
the levers it is evidence for, and `tests/view-set.test.ts` goes red if a lever
in that file has no view. **The count is deliberately not repeated here**: it
said fifteen while the set held seventeen, which is the third-copy drift this
file warns about elsewhere. `view-set.mjs` states it and
`tests/view-set.test.ts` asserts it as a literal, so a view deleted by accident
is a red run there. It cannot check that the view *shows* the surface, nor
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
  `HULL_PRICE_BASELINE_CR × (holdT / the baseline hull's hold) ^
  HULL_PRICE_EXPONENT` — and every row's `priceCr` is asserted against it, the
  way `integrity` is. **The constants are not restated here**: they moved once
  during review and this file said so for a round, which is the drift a third
  copy buys. `economy-trade.md` §7.1 owns them and
  `scripts/measure-hull-pricing.ts` reprints them beside what a fresh run
  derives. What is worth knowing without opening either: the exponent is well
  under one — a 60 t hold moves 3x the cargo and earns about 1.9x — so a linear
  assumption overprices the freighter by half again and the ceiling by better
  than two to one.
  `HULL_CEILING_HOLD_T` is the largest hold any berth admits, declared in the
  leaf and re-derived in `tests/hull.test.ts` from the berth catalogue against
  the cargo role's hold density; the *economy* has no ceiling, so the largest
  berth is what caps the ladder. Above it `hullPriceCr` returns `null`, which is
  what the two capitals carry.
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
- **A fight beside a body is flown in that body's frame, and so is its aim.**
  Every ship's assist holds speed relative to `frameVel`, which beside a
  station moves ~30 km/s (#104). Anything a combat controller *predicts* — a
  lead, an intercept — must use velocities relative to that frame; #362 found
  `combat-enemy.ts` leading on absolute velocity, invisible for every raider
  duel because cruise legs are fought in the star frame. And Traffic authority
  is ready when every *flying* carrier has a route (`flyingTraffic`): a
  destroyed one never gets one.
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
- **The corridor row is the gate on anything drawn in front of the aperture
  plane, and a pad's berths are no longer the only such thing (#300).**
  `tests/station-mesh.test.ts` forbids anything inside the aperture's
  half-diagonal cylinder extended outward, and `PAD_CORRIDOR_MARGIN_FACTOR` is
  what keeps a berth's service boom — which reaches *inboard* of its own apron —
  on the right side of it. At 0.5 the boom cleared by 11 cm, which is a
  coincidence; the margin is 0.75 and it clears by 7.6 m. Anything added to a
  pad inherits the question. Two sets of lamps joined the berths there in #300:
  the **mouth ring**, on the aperture frame's front face on both slot roles,
  and the **Gantry's strobe pair** — that form's hull face *is* its declared
  plane, so a fixture on it is either proud of the plane or invisible. Both
  stand well outside the corridor's cylinder, and their mounting is
  `every lamp is seated on the structure it is bolted to`'s to hold, because
  the islands check cannot express a lamp smaller than its own tolerance.
- **A bay wider than the form that holds it pokes through the hull, and only
  half of that is checkable.** `tests/station-interior.test.ts` measures the bay
  against the **slot** forms' `core` box, which is the body their slot is cut
  into. The two pad roles are excluded and the exclusion is moot rather than a
  residue since #165: they have no bay to poke through anything, and what stands
  in front of their plane is measured by the corridor row over every form.
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
- **`berth-arrival` cannot carry a before/after reading of a *performance*
  change, and that is a different reason from the one below.** #241 measured it
  at 12.22% of pixels moved past 24/255 against a same-build control of 0.54% —
  which reads as a real change and is not one. The frame is `at: 0.75` of a
  scripted traversal that runs on **wall-clock** time, so a build with a
  different per-frame cost takes a different real duration to reach the same
  fraction, and the world clock has advanced further when it gets there. Read
  off the two builds at that frame: the ship is 2.56 km apart and its attitude
  1.83° apart, with the gate open and both passes drawing in each. So the two
  frames differ because the camera is somewhere else, not because the picture
  changed. Any node that changes frame cost inherits this on every mid-traversal
  view; the docked ones (`berth-docked-forward`, `berth-free-look`,
  `shipyard-wall-berth`, `refinery-cradle-berth`) are stationary and read 0.03%
  to 0.33% against controls of the same size, which is how #241 knew its bays
  were untouched.
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
- **The dev server declares which tree it serves, and the guard reads that
  declaration (#296).** `probe-guard` used to compare top-level numeric
  constants between the served module and the local file, which is a similarity
  test standing in for an identity question — and #123 caught it passing a dev
  server on a sibling worktree. Every capture taken against that server was of
  the wrong build, and the tell was arithmetic in an unrelated probe rather
  than anything that checked. **The measurement is not restated here** —
  `scripts/lib/tree-declaration.mjs` owns it beside the plugin, and this file
  carried a third copy of it for a round. What is worth knowing without opening
  either: the two trees differed by thousands of lines in one module and the
  guard read them as the same tree, because two checkouts off one commit agree
  on every top-level constant unless a branch happens to change one. The vite plugin in `scripts/lib/tree-declaration.mjs` serves
  the project root at `/__seelite/tree`, `assertServingThisTree` compares it
  against its own, and **there is no file list**: identity is a property of the
  server, so a module with no top-level numeric constants is no longer a gap.
  **The set is not counted here**: it was written as five in one place and four
  in two others inside one change, and a deleted comment named a sixth — which
  is what a count of a set nobody enumerated is worth. Three things follow. The
  guard validates **shape and content type, never status** — vite answers an
  unknown path with `index.html` and a 200, so an absent endpoint looks
  successful. Both roots are `realpathSync`'d, because macOS `/tmp` is a
  symlink and a correct server reached that way would otherwise be accused.
  And a server started **without** the plugin is refused, which is the right
  direction to fail in but means removing it from `vite.config.ts` stops every
  probe. What this still does not catch is a stale module served off the right
  tree; that is #297.
- **The occlusion passes are gated on enclosure, and a frame-cost claim owes
  the antialias arm.** #241. The pair **doubles** the open-space frame. **The
  figures are not restated here** — `occlusion.ts` owns the table and
  `scripts/measure-occlusion-cost.mjs` reprints it beside a fresh run, and this
  file already carried one copy that went stale inside a round. **What it buys
  there is two answers, not one:** the *shadow* darkens 0.002–0.003% of an exterior frame and 6.06% of a
  bay's, while the *ambient occlusion* darkens 22.5% of a `cockpit-arrival`
  frame, almost all of it the cabin's own corners. So gating open space removes
  a shadow that shows nothing **and** a cabin term that shows plenty, and the
  second is a look decision on the sheet rather than a free saving. Quoting the
  shadow's figure for the pair is a mistake this file made for a round.
  `stepOcclusionGate` in `src/occlusion.ts`
  decides per frame whether either pass draws, from the apparent size of the
  nearest admitted **station**. Neither the cabin nor the hull is a subject for
  it, and that is the point rather than an omission: the cabin is visible in
  every cockpit frame, so a gate that counted it would never close. `main.ts`
  steps it before `fitShadowCamera` and `applyOcclusion` combines the player's
  row, an instrument's pin and the gate — an explicit `setOcclusion(a, b)` wins
  over the gate, a bare `setOcclusion()` gives it back. **And the figure that
  made this a regression is the second one:** multisampling multiplies every
  later fill-rate term rather than adding beside it, so the pair costs +3.563 ms
  at 0 samples and +7.130 at 2. Every one of #222's figures was taken at 0,
  which is the default and not what the principal plays at.
- **A bay's shadow figure is not a stable property of a build.** #241 measured
  the same check three ways on one machine: `main` at 5.917% and 5.881%, the
  gated build at 5.324–5.326%, and the gate forced permanently open at
  **0.272–0.274%** — every one of them repeatable to three digits. The outlier
  is not a bug in the gate; it is #233's box instability reached by a different
  route. The bay is entered by a **wall-clock** traversal, so any change to
  per-frame cost lands the ship somewhere else, and somewhere else is where
  `shadowBox` unions a second subject and spreads 2048 texels over twice the
  ground. #235's commit message records the opposite sign of the same effect —
  a shadow gate reverted there for reading 0.897% against 6.310% — and that does
  not reproduce against `applyOcclusion`, which writes `castShadow` from the
  gate every frame rather than through `shadowSunIdle`'s restore, which #235
  proved unreachable. Quote a bay shadow only beside the build it was taken on.
- **A whole-frame pixel reading cannot isolate a distant subject.** #241's
  approach ladder flown in cockpit view reported the pair darkening 4.6% of the
  frame at *twenty* station radii; that is the cabin, whose own AO is 22.5% of a
  `cockpit-arrival` frame. In chase the same reading is 0.58%, which is the
  player hull. There is always a subject at a fixed distance from the camera, so
  `probe-occlusion.mjs`'s `compare` has a `world-only` mode that hides both
  roots — #233 needed the same column for the same reason, and **hiding them is
  not setting `visible` on the two roots**, because `render` rewrites both flags
  from the view on every frame; their children are what the mode hides. Getting
  that wrong left the hull in every ladder capture and inflated the far end
  twentyfold, 0.58% against the 0.03% it actually reads. And even world-only
  there is **no cliff**: 0.03% at twenty radii rising smoothly to 5.64% at one
  and a half. The probe checks the curve's shape and the threshold is the
  principal's, off the printed ladder.
- **A place is not a cost. What is in the frustum is (#242).** A bay was read at
  38.9 ms twice and attributed neither time, and this file carried the
  attribution as a warning about bays until #235 deleted the line — #242 was
  opened quoting it after it was gone. It is not the bay. `berth-free-look` is
  the only framing in that table with a planet in frame, and **that planet is
  86.6% of it**: hiding it alone takes the frame from 40.29 ms to 5.39 (144/144),
  and hiding every body reads the same 5.36. The station's whole footprint
  measured in place is 2.91 ms and §13.1's interior 2.12. The same framing in
  **open space with no station within a thousand kilometres** costs 36.76.
  `scripts/measure-bay-frame-cost.mjs` is the instrument and prints all four
  framings.

  Three things fall out of it that outlive the number. **It is fill-rate bound**
  — a least-squares fit over the `renderScale` rungs gives a floor of 1.01 ms
  against 39.56 ms of fill, so 97.5% of the frame scales with pixels and #225's
  lever reaches a bay. **95.4% of that planet is never seen**: it is in the
  *approach* layer, its own pass with its own depth buffer, so the near-layer
  hull rejects none of its fragments — 236,024 visible pixels against 5,182,559
  drawn, which is all but 1,441 of the whole frame, against 66.0% showing in open
  space. And **an angular radius is not a frustum test**: `cockpit-arrival`
  frames the same planet at the same 41.8° half-angle for nothing, because it is
  behind the camera, which is why its draw-call count does not move when the
  planet is hidden. Any later claim that a *place* is expensive owes the arm
  that hides what is in front of the camera — and a body's layer is its distance,
  so an arm keyed on a *scene* names a different set of objects at every framing.

  **Both of those figures were published wrong first, and each was wrong in a way
  that changed no verdict.** The coverage was 92.7% from a mask that compared two
  *shaded* frames at 24/255 — which drops every planet pixel resembling what is
  behind it and counts bloom outside the disc, and understated the denominator by
  two million pixels. The floor was 0.70 ms from reading the residual `m − full·p`
  as the fixed cost, when under `T(p) = F + k·p` that residual is `F·(1 − p)` and
  understates `F` by 25% at quarter resolution. Sage caught both. A coverage mask
  must not look at what the subject *looks like* — differencing two flat colours
  with bloom off is exact and needs no threshold — and a fixed cost is a fitted
  intercept, never a residual.
- **The GPU timer refuses on ANGLE Metal, and the reason is in ANGLE (#246).**
  `EXT_disjoint_timer_query_webgl2` there does not time the work between its
  tokens; it sums whole command-buffer wall spans, which is at least the busy
  time and strictly more wherever two spans overlap. **The mechanism is not
  restated here** — `SUMMING_TIMER_BACKENDS` in `src/frame-attribution.ts`
  carries it with the two ANGLE files and the lines quoted. That is why the
  sampler read 119.05 ms at `berth-free-look` and 145.67 at an open-space
  planet against two agreeing wall clocks at 40.29/36.76 and 35.20/33.30.

  **The figures are not restated here**, and this paragraph carried five of
  them for a round with two of them disagreeing about the same ramp.
  `scripts/measure-gpu-timer-calibration.mjs` is the only owner: it measures
  the span, the gain and the floor on the machine it is run on and prints them,
  so there is no shipped copy to go stale. What is worth knowing without
  running it is the **shape** — the over-report is a gain that grows with how
  much of the frame the work spans, rather than a fixed cost per query, and a
  workload small enough to fit one command buffer reads far below the excess,
  which **bounds** a fixed cost per query from above and leaves the summing.
  That arm was written expecting a floor and did not find one — but it does
  **not** show the timer accurate, because the fenced figure it is read against
  is mostly the fence rather than the work. The magnitude is measured, not derived: how many command
  buffers a composer render spans is not known.

  `status` is now `untrusted` on that backend and `medianMs` is **`null`**, so
  there is no figure to transcribe. `implausible` is the backstop for a backend
  nobody has qualified — a GPU median above the frame cadence cannot be
  sustained on one command stream — and it is keyed on a cadence recorded for
  **every** frame, not for the frames that got a query, because the ring skips
  frames when it is full and a cadence built from those goes lenient exactly
  when the sampler is busiest. Neither state is reachable in CI:
  `probe-frame-attribution.mjs` runs on SwiftShader, which does not expose the
  extension at all and reads `unavailable`. The headed instrument is the
  evidence.

  The CPU interval columns were never implicated. And note that neither wall
  clock is the player's frame either — the tight loop removes vsync and lets the
  GPU pipeline, so a decomposition quotes **arm deltas**, and only the rAF
  period is a cadence. **Two of the three fences do not fence here**:
  `gl.finish()` does not, and `clientWaitSync` returns without blocking, so a
  1x1 `readPixels` is what this repo measures GPU completion with. The
  instrument runs all three and prints them, which is how that stays checkable
  rather than remembered.
- **Multisampling the composer is the most expensive thing in this renderer.**
  `output-stage.ts` hands `EffectComposer` its own target so `antialias: true`
  on the renderer finally means something — that flag configures the default
  framebuffer, which this game never draws into, and it is `false` now. **The
  figures are not restated here**: `setComposerSamples` owns the table and
  `scripts/measure-light-cost.mjs` reprints it. What is worth knowing without
  opening either is the shape — the *cheapest* non-zero count is already four
  times the whole unsampled frame, so there is no cheap setting of this. The
  mechanism is four `RenderPass`es into one target with
  `WEBGL_multisampled_render_to_texture` absent, so three resolves the buffer at
  the end of every `WebGLRenderer.render`; that is read off three's source
  rather than measured, and the attempt to measure the decomposition does not
  isolate it, because disabling a pass removes its drawing too. So it is the
  player's own row (`settings.ts`, `antialias`) and it defaults to off.
- **Four layer passes into one multisampled target is undefined by three's own
  contract, and it currently works anyway.** `updateMultisampleRenderTarget`
  pushes `COLOR_ATTACHMENT0` into the invalidation list for the **read**
  framebuffer — the multisampled one — after *every* `WebGLRenderer.render`. So
  with `antialias` non-zero, #15's ladder composites the far, approach and near
  layers over a backdrop whose pixels three has formally told the driver are
  discardable. Measured on both rasterisers available here and neither honours
  the hint: deep sky keeps 335k lit pixels at 4 samples against 333k at 0 on
  SwiftShader and 343k against 335k on ANGLE Metal, and the whole frame's lit
  mask disagrees on 0.35–0.47% of pixels, which is edges. Two probe checks watch
  it — `the backdrop is still there when the frame is multisampled` and the
  spatial `changes the edges without changing what is drawn` — but **those guard
  this repo's rasterisers and not a player's**: the probe runs on SwiftShader,
  so it establishes that two implementations do not discard and nothing about a
  third. What bounds the exposure is that `antialias` defaults to 0, where the
  target is not multisampled at all. Node #219 owns the structural fix, which is
  the same restructure the frame cost wants — one resolve for the whole ladder,
  which is the render ladder's to make and not the output stage's. Shipped this
  way on the principal's ruling, not by default. And note what the second check
  had to become: **a count is a scalar and cannot see a lost layer**, because a
  frame that loses one region and gains another of equal area passes it. It
  compares masks per pixel.
- **A count this context grants for RGBA8 it may not grant for RGBA16F, and a
  request can round *up*.** The composer's targets are half-float and a float
  multisampled renderbuffer is optional in WebGL2, so `MAX_SAMPLES` is the wrong
  question — `getInternalformatParameter(RENDERBUFFER, RGBA16F, SAMPLES)` is the
  right one. And `renderbufferStorageMultisample` guarantees only that the result
  is *at least* what was asked for: SwiftShader advertises `[4]` and allocates 4
  for a 2x request, so `Math.min(wanted, max)` was wrong in shape and made the
  settings row, its qualifier and the probe all report 2 while the GPU drew 4.
  `grantedSamples` takes the smallest supported count at or above the request. A
  count with no answer at all leaves the framebuffer incomplete, which is a
  **black frame and not an exception**, so the probe checks that pixels are lit —
  and it reads `gl.getParameter(SAMPLES)` off the bound framebuffer rather than
  `renderTarget.samples`, which is only the request read back.
- **A dial at zero still evaluates everything to its right.** Switching a
  full-screen term off by multiplying it by a zeroed uniform removes the effect
  and not the cost — and an on-against-off timing then subtracts the shared
  arithmetic out of both arms. Both of `output-stage.ts`'s terms branch on their
  uniform, and `tests/output-stage.test.ts` asserts the branch is in the spliced
  source.
- **A block design that always runs its arms in the same order measures the
  order.** `measure-light-cost.mjs` ran 0, 2, 4 then dither-on, dither-off twelve
  times over, so within-round thermal drift was perfectly confounded with the arm
  — and the Mann-Whitney pairing count, which assumes nothing about the
  distributions, still assumed that. It reported the dither at 0.12–0.14 ms with
  **144/144** pairings separated; shuffling the arm order dropped the same term
  to −0.002 and +0.066 ms at 61/144 and 101/144, which is a coin toss and a lean.
  The arms are shuffled from a printed seed now. **And a failure to separate is
  not a bound**: two further revisions turned those readings into "under a tenth
  of a millisecond" and then into "smaller than this instrument resolves, around
  0.07 ms", and neither had a calibration or a power analysis behind it — a
  within-arm range is not a detection threshold. It is left as a failure to
  detect. `setDither` records all four wrong answers this one term produced,
  because each was wrong for its own reason.
- **A dither belongs after the encode and a vignette before it.** The composer's
  targets are half-float and the screen is eight bits, so the quantisation
  happens in `OutputShader` — a ±0.5/255 noise added *there*, in display space,
  is one code; the same noise added in linear light is a far smaller number in
  the dark, which is the only place the banding is. `output-stage.ts` splices
  both through `shader-splice.ts`, and `tests/output-stage.test.ts` asserts the
  order from the patched source.
- **The frame loop rewrites the vignette dial every frame**, from the view and
  the settings row. A probe that assigns `uVignette` and then renders measures
  its own assignment being overwritten, and reads a working vignette as doing
  nothing — which it did, 1.000 against 1.000. The fix is not a pin on the pass:
  that was tried, and a `vignetteOverride` field is production state existing for
  one caller. Drive the settings row, which is the control the player has, so the
  two arms differ by the thing that ships.
- **A shader splice that misses its marker is silent.** `String.replace` with a
  renamed chunk returns the string unchanged, leaving a stock material that
  compiles, links, renders and carries the patched program's own name. Every
  patch here goes through `shader-splice.ts` and records what landed in
  `userData`, and a probe reads it.
- **A finish is module state, read at build time (#202, #203).**
  `HULL_FINISHES` and `STATION_FINISHES` are presets — `stock`, `plated`,
  `industrial`, `worn`, `nostromo` — selected by `setHullFinish` /
  `setStationFinish` and read by every builder as it runs. The game never
  switches; the workbench does. Three things follow. A test that sets a
  finish **restores the default** — `DEFAULT_HULL_FINISH` /
  `DEFAULT_STATION_FINISH` — in `afterEach`, because bun runs every file in
  one process and a file that left another finish set hands the next file a
  hull the game does not ship; a test that speaks about `stock` sets it by
  name. Every cache that depends on the surface — hull maps, palettes,
  station maps, hull materials — is **keyed by the finish id**; one that is
  not hands the second finish the first's textures. And a tile is the
  finish's, not the constant's: `plateUVs` divides by `finish.panelKm` and
  `shell()` by `STATION_PANEL_KM × finish.tile`, so a doubled map keeps the
  same plate. The default is `worn` since the principal's choice on the
  second sheet (`DEFAULT_HULL_FINISH`, `DEFAULT_STATION_FINISH`), and
  `stock` is the **surface** that shipped before #202 and #203 — its maps
  and its hull geometry, which `tests/ship-finish.test.ts`'s roster hash
  and the pins in `tests/surface.test.ts` hold — and not the station
  forms, which moved under every finish (the Gantry's keel, spindle and
  plating). A finish may not move a hull's **envelope** either: the
  envelope is the berth catalogue's fit predicate, and the first flanged
  collar changed the explorer's selected variant; `tests/ship-finish.test.ts`
  holds every built box equal under every finish.
- **A fixture is mounted by a flood, not by a ray, and the islands check
  works in core radii (#202).** `tests/station-finish.test.ts` supports a
  member if its box touches structure *or a supported member*, because a ray
  from a mast's top toward the centre passes over the keel it stands on and
  read every mast as floating. `tests/station-mesh.test.ts`'s islands check
  boxes the normalised root, so its 0.004 overlap is 2.4 m on a trade
  station: a dish resting exactly on its mast, or a drum 40 m short of its
  cell edge, is an island. Sink a part into what carries it. And on the
  Coriolis the headroom is the corner's, not the face's — a point at lateral
  offset `d` on a face may stand `h` proud only while `hypot(face + h, d) < r`
  — which is what caps the structure it can carry without moving its outline.
- **A solved form is a family of shapes, and seed zero is one of them (#257).**
  Trade D, refinery D and outpost D are plans collapsed from
  `Station.assemblySeed` (`DOMAIN.STATION_ASSEMBLY`, its own draw since #257
  — the Assembly solved from the berth seed for a round and could not vary
  its shape without moving its berth). Every row in `tests/station-mesh.test.ts`
  that builds at seed zero measures one plan; `SOLVED_FORMS` and
  `ASSEMBLY_SEEDS` there measure reach, connectivity and the corridor over a
  spread, and a check on a solved form that runs at one seed is a check on
  one plan. The finish sheet has the same axis: `SEEDS=0,1,2` on
  `scripts/shot-finishes.mjs` captures each station subject per plan through
  `?assembly=<n>` on the workbench, and a sheet without it cannot show the
  variety the form is for. And the sheet is where every defect in the Works was
  caught, none of them by a row: the first pass stood every unit on a plated
  deck tile, which was an opaque wall a cell wide with the plant hidden behind
  it; the second removed the tiles and left the units on 4 m pipes beside a
  160 m pebble, which the principal read as *"modules linked only by trusses,
  one little asteroid with a ton of modules around it"*; and inside the fix, a
  deep quarry cut put every unit in a pit and `buildRadiator` wings put a
  billboard behind a rock, hung outboard and again rooted on the axis. **A role's own language is the check no
  test makes**: §7.1's refinery is rock first and machine second, and the
  form is a quarried asteroid carrying its plant now. Every headless row was
  green through all three.
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
