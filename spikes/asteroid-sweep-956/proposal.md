# Node #956 proposal: swept hull box and solid cutter against a rock heightfield

Spike: `spike/asteroid-sweep-956`, `spikes/asteroid-sweep-956/`.
Status: a proposal for the principal. Nothing here is ruled.

## Inputs, pinned

- **The proxy.** #949 D1, as ruled: a 64-texel radial heightfield, the
  outermost exit along each texel-centre ray over every drawn level, bilinear
  between texel centres (`fixtures.ts` `ruledFields`).
- **Rock forms.** #953's 16 archetypes, SHA-256
  `0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c`, now
  committed at `ffa0a397` on `spike/asteroid-rocks-953`. Row K1 asserts the
  hash. The figures stay provisional until #953 is final.
- **The ship.** The miner's hull box (P1) and the deployed cutter as a second
  box: x ±5.5 m, y −8.91…+2.09 m, from the bow plane (42.2 m) to bow + feed
  travel (52.8 m). The feed travel is #803's study figure, as in #949.
- **The step.** `MAX_DT` 0.1 s; `collision.ts`'s separation, contact and
  resting gaps, scaled to each rock's R.

R is a rock's bound radius. Rocks are 25–400 m (charted), 40–600 m (rare).

## 1. The swept test — options

| | O1 convex cone pieces (built) | O2 radial gap with a slope bound | O3 Euclidean distance grid |
|---|---|---|---|
| What it is | Each bilinear cell of the field is a convex piece: the hull of the origin and the cell's four surface corners. The pieces tile space by cones, so their union is the field's solid. | Advance on `|p| − r(p̂)` divided by √(1 + slope²) per texel. | A 3D signed-distance grid built from the field. |
| Bound for #75 | `collision.ts` `advance`'s own separating-plane bound, per convex pair. No new proof. | Holds for a point. A box is not a point: its radial gap needs samples. | Holds only with an inflation of one grid cell. |
| Fails | — | **R2**: a needle between the box's samples is not seen at all. A slope bound does not change that. | At 32³ over 2R a cell is 0.0625 R, twice D2's 0.03 R. |
| Status | Built and measured. | Not built. R2 rules out any sampled-box method; a radial gap for the continuous box was not formulated. | Not built. Derived, not measured. |

**Recommended: O1.** The rock is a list of convex pieces, and the sweep is the
existing one. A bound tree only decides the order in which pieces are tested.

### How O1 sweeps

- **Pieces.** One per cell between texel centres, plus the half-texel strips
  at face edges: 6 × 65² = 25,350 pieces, 5 vertices each. The flat top of a
  piece can sag below the bilinear surface where corner radii differ. So each
  piece is scaled out by the factor a 9 × 9 sample of its patch needs, plus
  2 × 10⁻⁵. On the real rocks the largest factor is **1.0077**.
- **Bound tree.** A quadtree per cube face. A node's bound is the cone over its
  tile, capped square to the tile's own direction at the farthest vertex below
  it. It is convex and holds every piece below it, so a node is never met later
  than any of its pieces.
- **Best-first.** A heap of (time a bound is met, node, ship primitive). A child
  is advanced from its parent's time. The first leaf popped is the earliest
  contact over every piece and both primitives. Nothing met later is opened.
- **Rock frame.** Both ends of the ship's pose come from the clock, in the
  rock's frame (#949 D4, #43). The straight path between them misses the spin's
  arc by at most 1.7 × 10⁻⁶ R (0.7 mm at 400 m, 4-minute spin). That figure is
  added to the contact gap.

## 2. Rows (`rows.test.ts`, output `rows.txt`, 11 pass)

| Row | What it shows |
|---|---|
| **R1** thin ridge, one texel wide, crossed at 2 and 10 km/s (R = 400 m) | The sweep meets it within 0.0002 of a step of a 20,000-sub-step reference, with no advance cap hit. The naive radial-gap advance meets it **4.5–56.5 m past first contact**. |
| **R2** needle under the box's broad face, between its surface samples, 10 m step | The box's end pose overlaps the needle. #949's sampled point test sees **nothing**. The sweep meets it at 0.4975 (reference 0.5000). |
| **C1** cutter against hull | Nose-on, the cutter is met first and named (`prim 1`). Belly-on, the hull is met. With the cutter stowed, the hull's nose is met later (0.41 against 0.20). |
| **G1** ship placed half inside a rock | Ghosting the whole rock lets it fly out. Ghosting only the overlapped pieces (what `classifyPairs` does per primitive) traps it: it meets the next piece's wall at 0.07 of the step. |
| **G2** resting ship left 1 mm inside one face (a failed settle), pressing in at 1 m/s, tick after tick | Ghosting the whole rock: never met, **30 m deep after 300 ticks** and still sinking. Ghosting per piece: held after 2 ticks, 0.2 m deep, by the resting pairs around it. (Held means a resting pair with the ship pressing in; `stopResting` is not prototyped.) |
| **P1, P2** pieces hold the field | Envelope − field ≥ 0 on a dense sample, synthetic and real. The excess is at most 0.0218 R (real). |
| **A1** 192 random steps at the surface, 0.2–10 km/s, R 25 and 400 m, all 16 archetypes | The reference met 109; the sweep met the same 109, none later than one sub-step. 49 started inside (ghosts). No advance cap hit. |
| **A2** tree against flat | Same piece, time and primitive on 16 steps. The tree skips nothing. |
| **A3** 64 grazes 2 m clear at 2 and 10 km/s, R 40 and 400 m | **No false impact.** 2 m lower, each is met no later than the reference, or starts inside. Most advances in one step: 532. |
| **K1** | Rows keyed by the GLB hash. |

## 3. Fit (D2), re-measured (`measure-fit.txt`)

#949's method: 38,400 directions per rock; empty space is a proxy point
outside the drawn L0 solid, by its distance to the L0 mesh.

| | Ruled field | Pieces |
|---|---|---|
| Colliding empty space, max over 16 | 0.0301 R (the figure D2 was ruled on) | 0.0301 R |
| p99, max over 16 | 0.0186 R | 0.0187 R |
| Largest change on one archetype | — | +0.0021 R (angular-shard, 0.0110 → 0.0131) |

The pieces do not move the binding archetype (stepped-strata, 0.0301 both).
The 38,400 directions can miss where the pieces stand farthest above the
field, so the 50 directions of largest excess per rock (from P2's grid) were
measured too: empty space there is at most **0.0221 R**.
Drawn surface outside the proxy cannot grow, because the envelope is never
below the field (P2). **A steeper field needs more inflation:** a synthetic
needle of 0.5 → 0.9 R needed 1.089, which is 0.08 R of empty space at its tip.
A build that meets such a field splits the cell rather than inflating it. A
row should assert the largest factor (≤ 1.01) on the final archetype set.

## 4. Cost per rock per tick (`bench-run1.txt`, `bench-run2.txt`)

Arms interleaved call by call; 16 archetypes × 5 repeats per cell. Load
average 13–23 on 10 cores during both runs (other sessions), so absolute
figures are high. The ratios hold. O1, run 1 / run 2 medians, µs. #949's
point test, re-run in the same runs: 487–639 µs median in every cell. That
is inside #949's own 0.4–0.7 ms, so the load did not inflate the absolute
figures much.

| Scenario | R 25 m | R 40 m | R 100 m | R 400 m |
|---|---|---|---|---|
| Approach, met mid-step, 2 km/s | 472 / 535 | 402 / 480 | 384 / 446 | 321 / 261 |
| Assist off, 10 km/s | 485 / 645 | 461 / 448 | 447 / 379 | 375 / 468 |
| Graze 2 m clear, 2 km/s | 289 / 251 | 306 / 266 | 291 / 329 | 359 / 305 |
| Resting 0.12 m off, sliding (sweep only: a lower bound) | 706 / 583 | 607 / 513 | 403 / 443 | 283 / 283 |
| Pass 20 m clear | 70 / 68 | 88 / 74 | 114 / 124 | 175 / 204 |

- **p90 worst:** 1.3 ms (approach and assist-off on a 25 m rock). The single
  worst call: 4.4 ms (R 400 m approach, run 1).
- **Against #949's 0.4–0.7 ms:** at or below it in every median except resting
  on 25–40 m rocks: level, and up to 12% above on a 25 m rock. The #949 figure is a point test, not a
  sweep. It misses R2.
- **The quadtree's saving.** Every piece advanced on its own (flat64): 0.1–0.2 s
  a call. The first design (depth-first, caps cut by the face plane, df64):
  up to 3.6 ms median on impact ticks. Best-first with tilted caps: 0.26–0.65 ms.
- **Per tick.** On #949's F7 field layout (charted), a ship within 100 m of a
  rock can reach **one** rock in a 2 km/s step (20,000 of 20,000 samples). At
  10 km/s it reaches two in 2.8%. A tick costs one rock's figure, rarely two.
- **A coarser level for small rocks is not on the table.** At 32 texels the
  sweep costs 3–38% less (tree32 column in the runs), but #949 measured drawn
  surface outside p99 0.044 R at 32, against D2's 0.02 R. No coarse level is
  proposed.
- **Building the pieces:** 0.3 s per archetype, 5–6 s for all 16
  (`measure-build.txt`), mostly the inflation check. A build either ships the
  inflation factors as data or derives a rock's pieces when its field first
  enters reach.

## 5. Questions for the principal

- **Q1 The swept test is O1:** the field as convex cone pieces, swept with
  `collision.ts`'s own bound on a best-first quadtree. O2 and O3 are out.
- **Q2 How a rock ghosts (§4.3).** Each choice fails one row:
  - **O-a per rock:** any overlapping piece ghosts the whole rock. A placed
    ship flies out (G1). A ship left a hair inside during contact sinks
    through (G2: 30 m and still going).
  - **O-b per piece,** as `classifyPairs` does a station's primitives. Contact
    holds (G2: 0.2 m). A placed ship is trapped by the next piece's wall (G1).
  - **O-c per rock only after a placement event** (spawn, restore, cruise
    exit, launch), until the ship has separated from that rock; per piece
    otherwise. §4.3 says a flying ship starts inside only by being placed
    there, so this keeps both rows. It costs a flag per (ship, rock) pair.
    Not built.
- **Q3 The deployed cutter collides with everything.** D3 made it a ship
  primitive, so by default it also meets stations, ships and canisters. The
  alternative is rocks only.
- **Q4 An impact names the ship primitive** (`hull` or `cutter`). What a
  cutter strike costs a pilot, and which side `sideStruck` bills, is
  #920's (drill interaction) or the fiction map's, not this node's.
- **Q5 No coarse level for small rocks.** D2 binds at every size.
- **Q6 Shipyards may trap a placed ship too.** An authored station proxy
  (#818) ghosts each box alone, so a ship placed across two touching boxes
  may meet the one it does not overlap, as in G1. Not tested here. File a
  check below this node?

## 6. Owed by the build, not proved here

- **Resting across pieces.** Only the time of impact is prototyped.
  `stopResting` and `settleTouching` over many touched pieces were not run.
  The resting bench case only classifies them and sweeps the rest.
- **The bounce normal** is a piece's facet normal, from GJK. The drill reads
  `normalAt` on the field. The two differ at a cell's facets and seams; #920
  should know which one the drill window reads.
- **Integration.** A rock is a solid with its own bound tree, not a list in
  `sweepShip`'s sphere grid. `Impact` gets a ship-primitive field.
- **Browser rows** #949 listed are still owed.
- **A quiet-machine cost run.** Both runs here ran beside other sessions.
