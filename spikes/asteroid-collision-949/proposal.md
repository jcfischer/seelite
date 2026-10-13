# Node #949 proposal: asteroid collision and contact proxies

Spike: `spike/asteroid-collision-949`, `spikes/asteroid-collision-949/`.
Status: a proposal for the principal. Nothing here is ruled.

## Inputs, pinned

- **Rock forms.** #953's 16 authored archetypes, uncommitted in
  `.worktrees/seelite-953/spikes/asteroid-rocks-953/runtime/asteroids.glb`,
  SHA-256 `0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c`
  (`MEASURED_ROCKS_SHA256` in `proxy-fit.ts`; every run prints the hash it
  read). All three levels are watertight (0 open edges). The figures below
  are provisional until #953's forms are final.
- **The cutter.** The stowed rotor, measured on the installed model under
  bun (`cutter-explore.ts`): radius 5.5 m, centre 3.4 m below the axis, face
  on the hull box's bow plane. Feed travel 10.6 m is the #803 study's
  kinematics, not a production pose: production draws the cutter stowed
  (#815 D5).
- **The frame.** #948 D5: field orbit (one `FrameMotion` with the refinery,
  #918 Q2), closed-circle drift ≤ 2 m/s, spin with equator ≤ 6 m/s.

Units below: R is the rock's bound radius (#948 D5). Rocks are 25–400 m
(charted) and 40–600 m (rare). The charted power law puts the median rock at
about 40 m.

## 1. The rock's solid shape — options

One surface or two is the real question. The drill must reach the drawn
face. If the hull collides on a shape that bridges a concavity, the hull
meets that bridge before the cutter bites. Row D1 measured this at R = 200 m:
a convex hull proxy blocks **53 of 307** drillable faces (17%).

| | O1 box set | O2 convex hull | O3 heightfield 64 | O4 heightfield 32 |
|---|---|---|---|---|
| Core change to `sweepShip` | none | new convex primitive (SAT/GJK, exact sweep) | new heightfield primitive | same as O3 |
| Data, 16 archetypes | small | small (a few hundred planes each) | 768 KB raw (48 KB each) | 192 KB raw (12 KB each) |
| Colliding empty space, max | 0.24 R at 64 boxes (142 m at 600 m) | 0.04–0.18 R (24–108 m at 600 m); worst on three-lobed, contact-binary, offset-boulder, saddle | 0.030 R (18 m at 600 m), from filled overhangs | 0.030 R |
| Drawn surface outside proxy, Euclidean | 0 by construction | 0 when built from every level | max 0.046 R, p99 0.020 R (40 m rock: 1.8 m / 0.8 m; 600 m: 27 m / 12 m) | max 0.098 R, p99 0.044 R |
| Bound (#948 D5) | broken: reach 1.19 R | holds | holds (reach ≤ 0.999) | holds |
| Laser on the same surface | — | bridges craters | p50 0.10% R, p90 1.1%, p99 5.1% | not measured |
| Drill on the same surface | — | 17% of faces blocked | yes | yes, coarser |

**O1 is out by measurement** (`measure-fit.txt`). A covering box over a
curved face always overshoots at its corners.

**O3's open risk.** The radial gap `|p| − r(p̂)` is not a distance. It is
not 1-Lipschitz at steep fracture walls, and these rocks have them
everywhere. So conservative advancement on it does **not** meet #75's swept
rule as it stands. A build needs either a sub-step bound or a Euclidean
field. That cost is not measured here; this spike claims no #75 compliance
for O3.

**Cost per tick.** A box-against-heightfield test with every texel scanned is
0.4–0.7 ms per rock (`bench.txt`). That is an **unculled upper bound**. A
build culls texels to the box's angular footprint and uses a coarser level
for small rocks. Neither is measured.

**No absolute metre rule can hold on large rocks.** Every option's error
scales with R. Against the shipyard rule (≤ 10 m empty, vertices within 1.5 m), O3's
empty space holds below R ≈ 330 m, but its vertex rule holds only below
R ≈ 33 m at the maximum (75 m at p99). A rock rule must
be a fraction of R, or a metre rule that applies only below some size.

**Recommendation: O3**, one surface for hull, laser and drill, with the
sweep risk as the first build question. O2 is the cheaper and safer sweep,
but it costs the drill 17% of its faces at 200 m, and more on larger rocks.

## 2. The drill tip — fork

The cutter reaches 10.6 m past the bow when deployed. The hull box never
meets the face at drill contact (307 of 307 approaches, row D1).

- **O-A, predicate.** The cutter is not solid. `drillState` reports `clear`,
  `contact`, `misaligned`, `slipping` or `overdriven` from the tooth ring
  against the surface. Measured cost: the cutter can bite **min 2.4 m,
  p50 11.9 m, p90 18.2 m, max 32.1 m** into rock before any hull sample
  meets it (n 307). The `overdriven` state reports it; nothing stops it.
- **O-B, solid cutter.** The deployed cutter becomes a second ship primitive
  in the sweep. A bite past the tooth reach is an impact. Core change: the
  sweep holds one ship box today (`sweepShip`).

**Recommendation: O-B** if the drill must look right in contact, because
12 m of cutter inside a rock is visible. O-A is enough for #920's cockpit
prototype.

Also measured: with the ship squared to the local normal, 77 of 384
approaches (20%) are `misaligned` at a 20° limit. At the cutter's 5.5 m
radius the fractured faces are rough. The alignment limit, the slip limit
and the bite depth are #920's to set (`DRILL_WINDOW` is a placeholder).

## 3. Frame, start-inside and cruise — derived, no fork

- **Frame.** Pose(t) = field centre(t) + R_field · (drift(t) + spin(t)),
  both ends of a step read from the clock (`rock-frame.ts`). Rows F1–F7 pass
  on the real `sweepShip` with a box stand-in: no tunnelling at 2 and
  10 km/s through a 25 m rock; closing speed relative to the rock while the
  field moves at ~30 km/s; spin and drift contact closes at ≤ 6 and ≤ 2 m/s
  with no damage; end pose equals the pose at t + dt (#43); lattice-cell
  broadphase finds every rock a brute-force test finds.
- **Start inside.** A ship placed inside a rock (spawn, restore, cruise exit,
  manual drop) is a ghost under `collision.md` §4.3 and flies out (F5). No
  new rule.
- **Cruise.** A field is a contact through `selectable()`, as the relay is,
  never a mass. So nothing pins a cruise engage from inside a field, and no
  existing arrival moves. The 50 km drop radius around a field's centre
  clears the whole field (C1: charted extent 26.5 km, rare 18.9 km). Cruise
  keeps C5: it guards no field it passes through.

## What the rows prove, and what they do not

- F1–F7 prove the frame, clock and closing-speed logic, on a box stand-in.
- No row sweeps a heightfield or a convex hull: `sweepShip` cannot sweep
  either yet.
- B1 (proxy inside the bound) holds by construction for the symmetric
  heightfield.
- D1, D2 and L1 are static tests on the surface, not sweeps.
- No browser row was run. The build owes spatial rows for: drill contact
  seen at the face; a ship resting on a spinning rock; laser fragments
  leaving the drawn face; cruise arrival at a field.

## Questions for the principal

- **Q1** Which solid shape: O3 (recommended), O2, or another?
- **Q2** Drill tip: O-A predicate or O-B solid cutter (recommended)?
- **Q3** Does #949 close on this method and its provisional figures, or wait
  for #953's final archetypes?
- **Q4** The rock fit rule: a fraction of R (O3 measures 0.03 R empty and
  0.02 R p99 outside), or a metre rule below some rock size?

## Files

| File | Input | What |
|---|---|---|
| `measure-fit.txt` | L0, pinned file | O1 box sets at 4–64 boxes |
| `measure-shapes.txt` | L0 | voxel survey: hull, 26-DOP, star-shapedness, L2 vs L0 (grid floor ~0.04 R) |
| `measure-heightfield.txt` | L0 | superseded radial run of the dilated heightfield |
| `measure-euclid.txt` | L0 only | hull and dilated heightfields, Euclidean overshoot |
| `measure-euclid-sym.txt` | all levels | symmetric heightfields 32/64/96 |
| `measure-outside.txt` | all levels, pinned file | drawn-outside, Euclidean, O3/O4 |
| `rows.txt` | pinned file | the 12 rows, with D1 and L1 figures |
| `bench.txt` | L0 | unculled contact cost |

## Rulings (principal, 2026-10-13, in session)

- **Q1: O3, the 64-texel radial heightfield.** One surface for hull, laser and drill.
- **Q2: O-B, solid cutter.** The deployed cutter is a second ship primitive in the sweep.
- **Q3: close on the method.** The figures stay provisional on the pinned file; the build regenerates from #953's final archetypes and re-runs the rows.
- **Q4: the fit rule is a fraction of R.** The bar is the option's figures: colliding empty space ≤ 0.03 R, drawn surface outside the proxy p99 ≤ 0.02 R.
