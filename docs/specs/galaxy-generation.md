# Spec: galaxy and system generation

**Status:** resolved decision node — [#6](https://github.com/jcfischer/seelite/issues/6)
**Date:** 2026-08-18
**Inputs:** [#3](https://github.com/jcfischer/seelite/issues/3) (space-scale rendering),
[#4](https://github.com/jcfischer/seelite/issues/4) (Elite-1984 mechanics),
[#5](https://github.com/jcfischer/seelite/issues/5) (flight model)
**Binds:** [#7](https://github.com/jcfischer/seelite/issues/7) (economy),
[#9](https://github.com/jcfischer/seelite/issues/9) (docking),
[#10](https://github.com/jcfischer/seelite/issues/10) (in-system travel)

This is the buildable spec for seelite's galaxy and system generator. Everything
here is a decision, taken with the principal in a grilling session on node #6.
Where a figure is derived rather than chosen, the derivation is shown, because
the derivation is the thing a later reader needs in order to change it safely.

---

## 0. What this owns, and what it does not

**This spec owns:** how many systems exist, where they sit, what each one's
record contains, how those fields are distributed across the galaxy, what
bodies and stations a system contains, where they are, how they move, and how
a jump between systems behaves.

**This spec does not own:** what economy/tech numbers do to prices (#7), the
docking geometry of a station (#9), how the player crosses the distances
below (#10), or what the galaxy map looks like (its own node, graduated from
this one).

---

## 1. The substrate: hash-per-system

Elite derived its universe from a 48-bit seed advanced by a Fibonacci-like
`tweakseed`, called four times per system. Its elegance is real and its
coupling is fatal for us: system *N* exists only because systems 0…*N*−1 were
iterated first, which is exactly the shared-draw-count coupling `src/rng.ts`
was vendored to prevent.

**seelite generates each system by hashing its identity, not by advancing a
chain.** A system's record is a pure function of *(worldSeed, galaxyIndex,
systemIndex)* and of nothing else — nothing that happens to any other system
can move it.

```ts
import { seedFor, mix, seededRand } from "./rng";

/** The root of all galaxy-level derivation. */
const galaxyRoot = (worldSeed: number) => seedFor(worldSeed, "galaxy");

/** Positions belong to a (galaxy, attempt) pair — see §5 on connectivity. */
const layoutSeed = (worldSeed: number, g: number, attempt: number) =>
  mix(mix(galaxyRoot(worldSeed), g), attempt);

/** One system's identity within a laid-out galaxy. */
const systemSeed = (worldSeed: number, g: number, attempt: number, n: number) =>
  mix(layoutSeed(worldSeed, g, attempt), n);

/** The founding tags; src/domains.ts is the full append-only table. */
const DOMAIN = { POS: 1, NAME: 2, POLITY: 3, BODIES: 4, STATIONS: 5, DESC: 6 } as const;
const stream = (sysSeed: number, domain: number) =>
  seededRand(mix(sysSeed, domain));
```

`STREAMS.galaxy` and `STREAMS.system` already exist in `src/rng.ts`; the
domain tags above are the second-level split `mix` was written for. `FORMATION_MASS`
is tag 28 in the canonical `src/domains.ts` table, independent of `BODIES` and
`STATIONS`. Adding a
domain tag is safe (it perturbs no existing stream); renaming or renumbering
one is not, and changes every seed's output.

### 1.1 What we gave up

Dropping Bell's seed costs the single best correctness oracle available: with
the original scheme, `txtelite` output is a byte-exact golden file and Lave is
system 7 of galaxy 1. We have no such oracle. **Verification is therefore
property-based, not golden-file** — see §9. This is the known weak joint of
this spec and it was accepted deliberately.

---

## 2. Galaxy shape

| Property | Value |
|---|---|
| Galaxies | 8, all present from the start |
| Systems per galaxy | 256 |
| Total | 2048 |
| Shape | oblate spheroid — a disc, flattened on `y` by `q = 0.70` |
| Radius `R` | 24.53 LY in plane, 17.17 LY through it |
| Distance metric | true 3D Euclidean, isotropic |
| Fuel tank | 7.0 LY |
| Fuel cost | 0.2 Cr / 0.1 LY (14 Cr full tank) — §8 |

Galaxies are a **namespace, not a regeneration**: switching galaxy changes
`g` in the derivation above and nothing else. The Galactic Hyperdrive
(5,000 Cr, high-TL only) is therefore a designed-in mechanic rather than a
later bolt-on, and **the save must carry per-galaxy state** — visited flags,
market fluctuation bytes, legal status — not one global set.

**The plane is `y = 0`, and that is a fact about galaxy space only.** What a
pilot standing in one of these systems sees of that plane — which way the cluster
lies from inside a system — is §11's, and it is *not* "the same plane, drawn
lower", because a system's own reference plane is its planets' orbital plane and
has nothing to do with the cluster's.

### The disc, and why it is 0.70 and not Elite's 0.50

This section ratified a **sphere** until #107 re-opened it on 2026-08-28. The
cluster is now an oblate spheroid: `systemPosition` draws its radius and
direction exactly as before and then scales the `y` term by `q`, so the cluster
reaches `R` across and `q · R` through. The flattening is applied to `y`, which
is `galaxy-map.md` §2's reference plane, so the disc's plane *is* the plane the
chart's drop-lines already fall to.

**Elite's 2:1 y-axis compression is still not adopted, and the distinction
matters.** It existed because the BBC drew its chart wider than tall, and
importing a screen-aspect hack as a physical law is what this spec declined.
`q = 0.70` is not that number and is not adopted for that reason: it is taken
because a galaxy is expected to look like one and because it makes the chart's
reference plane real geography instead of an arbitrary convention. Adopting
0.50 now, on looks, would invite the reading that the original argument was
wrong.

**It was taken against a measured cost, not for one.** #107's hypothesis was
that a disc spreads the same 256 points over a larger projected area and so
eases finding. Measured, it is refuted: holding ~8-in-range forces `R` upward as
the volume flattens, the framing grows with `R`, and flattening then
concentrates the points toward a plane, whose nearest-neighbour distances are
shorter than a ball's at equal projected extent.

**Over the four shapes and seven pitches the grid samples, the ball is the least
crowded in every cell** — face-on included. That is the whole claim, scope first,
because earlier drafts of this paragraph kept stating it and then qualifying it.
It is measured rather than argued: `bun scripts/measure-galaxy-shape.ts grid`
asserts it cell for cell instead of printing it.

What the grid does not cover: three of the seven `q` values the sweep below
measures, which are compared to the ball at 40° only; and **yaw**, held at
`DEFAULT_YAW` throughout. Desktop crowding, framing scaled with `R`:

| `q` | 12° | 20° | 30° | 40° | 55° | 70° | 83° |
|---|---|---|---|---|---|---|---|
| 1.00 (ball) | 41.3% | 41.9% | 42.6% | 41.3% | 41.6% | 42.5% | 43.1% |
| 0.70 | 51.8% | 52.6% | 51.0% | 49.6% | 49.5% | 47.0% | 46.3% |
| 0.50 | 63.1% | 61.9% | 58.1% | 54.7% | 50.7% | 49.1% | 46.8% |
| 0.25 | 79.1% | 73.7% | 68.0% | 60.4% | 54.0% | 50.3% | 48.9% |

The ball wins in all 28 cells, and its best angle (41.3%) beats every flattened
shape's best. Face-on recovers much of what flattening costs — the rows converge
toward 83° — and never closes it. Yaw is held because the cluster is
axisymmetric about `y`, so yaw turns a disc within its own plane; that is a
reason to *expect* flatness in yaw, not a measurement of it.

At the shipped 40° pitch, framing scaled with `R` so the comparison is of shapes
and not of how much screen each fills:

| `q` | `R` | mean in range | desktop crowding | console cell |
|---|---|---|---|---|
| 1.00 (ball) | 21.9 | 8.00 | 41.4% | 72.9% |
| 0.85 | 23.1 | 8.00 | 45.1% | 76.5% |
| **0.70 (shipped)** | **24.5** | **7.99** | **49.7%** | **80.1%** |
| 0.50 (Elite's) | 27.4 | 8.00 | 54.8% | 84.5% |
| 0.35 | 30.5 | 8.01 | 57.3% | 86.5% |
| 0.25 | 33.4 | 8.00 | 60.3% | 87.5% |
| 0.15 | 37.7 | 8.00 | 61.5% | 88.3% |

So `q = 0.70` costs about **8 points** of desktop crowding against the ball,
where `q = 0.50` costs 13. (#107 recorded those as 8 and 18, measured at the
then-current 20° pitch; the gap narrows as the chart tilts toward face-on, and
the shipped pitch is 40°. The ordering and the conclusion are unchanged.)

Sweep it with `bun scripts/measure-galaxy-shape.ts sweep`. Changing `q` means
re-solving `R` — see §2.1, they are one derivation.

### 2.1 Where the radius comes from

Not chosen — derived, by holding Elite's pacing constant.

Elite's chart was roughly 100 × 50 LY holding 256 systems (density
≈ 0.05 systems/LY²), and a 7 LY tank put **≈ 8 systems in range** of a typical
world. That number is the actual design constant: enough choice to plan a
route, few enough that a distant system is a multi-hop project.

In three dimensions a 7 LY ball is (4/3)π·7³ = **1436.8 LY³**. Holding 8 in
range needs 8 / 1436.8 = 0.00557 systems/LY³, so 256 systems want
≈ 46,000 LY³, so:

```
R = (46000 · 3 / 4π)^(1/3) ≈ 22 LY
```

That closed form is where 22 LY came from while the cluster was a ball, and it
predicts a mean of 8.25 systems in range.

#### The figure is solved, not computed, and 8.25 was never the measured one

The closed form assumes a uniform ball. The generator draws a **3:1
concentrated** profile (§3) and then **rejects any fragmented layout and
re-rolls** (§5), and that filter is not neutral — it selects denser layouts. So
the shipped radius is solved against the shipped generator rather than read off
the integral:

```
bun scripts/measure-galaxy-shape.ts solve 0.70 8
```

Measured over 24 connected layouts (world seeds 1, 47, 12345 × 8 galaxies):

| Shape | `R` | core `R/√2` | mean in range | mean re-rolls |
|---|---|---|---|---|
| ball, `q = 1` (pre-#118) | 22 LY | 15.56 LY | **7.88** | 5.6 |
| disc, `q = 0.70` (shipped) | 24.53 LY | 17.35 LY | **7.97** | 5.3 |

**§2.1 quoted 8.25 as a measured result and it never was one** — it is the
uniform-ball prediction, and the ball the game actually shipped held 7.88. The
disc at `R = 24.53` holds 7.97, so the reshape *preserved* the reach it was
solved to hold, slightly improving it. `tests/galaxy.test.ts` pins the measured
mean as a band around the shipped figure rather than as a `>` threshold: a
threshold leaves a retune green and this spec silently wrong.

**These are the courier's figures, not the galaxy's (#185, #554).** "In range"
is measured at `JUMP_RANGE_LY`, which is the courier's tank and the reach at
which `layoutGalaxy` guarantees every galaxy connected. Reachability is a fact
about the flown hull: a hull's `tankLy` is its jump range, and a shorter tank
flies a fragmented graph on purpose. The per-tank table — fragmentation,
isolated systems, neighbours and the diameter inside each component, for every
purchasable hull's tank — is not transcribed here; it is reprinted by

```
bun scripts/measure-galaxy-shape.ts tanks
```

which runs #185's seeds by default and fails if any galaxy fragments at a tank
of at least `JUMP_RANGE_LY`.

`R` and the core radius are **outputs**. What is held fixed is ~8-in-range, and
the core ratio stays `R/√2` so §3's 3:1 gradient survives the reshape unchanged.

**Beware r³ when changing this.** Radius 35 LY feels like a modest increase
and drops the same tank to ~2 systems in range, which near-certainly
fragments the graph. Past about 33 LY at `q = 0.70` there is no connected
layout at all, and the solver above reports it.

#### The radial gradient did not move, and that is a property rather than luck

`t` — the 0-at-core, 1-at-rim input every radial bias in §4 reads — is taken on
the **profile radius** `√(x² + (y/q)² + z²)`, the spheroidal coordinate §3's
`ρ(r)` is written against, which is exactly the radius drawn before the squash.
Because the profile's core radius is `R/√2`, `radialCdf` is a function of `x/R`
alone, so `radiusForQuantile(u)/R` does not depend on `R` at all.

The consequence: re-deriving the radius from 22 to 24.53 moved every system
outward and changed **nothing** about what any system *is*. #107 argued the
reshape "changes what each system is" from the radial gradient; it does, but
only through the layout `attempt`, which is part of a system's seed and
re-rolled in the galaxies whose connectivity flipped. The gradient itself held.
`tests/galaxy.test.ts` asserts the scale-freeness, because the change that
breaks it — reading `t` off the plain Euclidean distance — looks harmless and
would both compress the gradient toward the core for polar systems and drop
§3's core:rim ratio below the 3.0 it quotes.

---

## 3. Density profile

Systems are **mildly centrally concentrated, 3:1 core to rim**. A uniform
cluster would make every location statistically identical — position would
carry no meaning beyond distance travelled. Concentration buys an exploration
gradient for free: a dense, well-connected core grading out to a sparse
frontier where a jump is a commitment.

**`r` here is the profile radius, not the Euclidean distance.** Since #118 the
cluster is a `q = 0.70` spheroid (§2), and the profile is written on that
shape's own coordinate `m = √(x² + (y/q)² + z²)` — which is exactly the radius
drawn below, before the squash. `src/galaxy.ts` exports it as
`profileRadiusLy`; the record's `radiusLy` is the plain Euclidean distance and
is a different quantity, used where "most central" means nearest the centre
(§5.1's start system). Everything radial in §4 reads the profile coordinate, and
that is what keeps the ratio below exactly 3.0 on every axis.

```
ρ(m) ∝ 1 / (1 + (m/r_c)²)          r_c = R/√2 = 17.35 LY
ρ(0)/ρ(R) = 1 + (R/r_c)² = 3.0     exactly, by construction
```

Sample the radius by inverse transform on the volume-weighted PDF ∝ m²ρ(m):

```
F(x) = [x − r_c·atan(x/r_c)] / [R − r_c·atan(R/r_c)]
     = [x − 17.345·atan(x/17.345)] / 7.9598
```

`F` has no closed-form inverse; **invert by bisection to a fixed 40
iterations** — deterministic, and a fixed count keeps it a pure function
rather than a convergence-dependent one. Direction is uniform on the sphere:
`cosθ = 2u₁ − 1`, `φ = 2πu₂`; the `y` term is then scaled by `q`. Both draws
come from the `POS` domain of the system's stream.

**`F` is scale-free in `x/R`**, since `r_c` is defined as `R/√2`. So
`F⁻¹(u)/R` — the `t` every radial bias in §4 reads — does not depend on `R` at
all, and re-deriving the radius in §2.1 moved no system's polity. See §2.1's
last subsection.

Resulting neighbour counts — **measured on the shipped generator**, over 8,192
systems (4 world seeds × 8 galaxies), not read off the closed form. Re-run it
with `bun scripts/measure-galaxy-shape.ts density`, which prints this table:

| Location | Systems within 7 LY | n |
|---|---|---|
| Centre (`t < 0.15`) | 15.2 | 51 |
| Mean over cluster | 8.0 | 8,192 |
| Rim (`t > 0.85`; half the neighbourhood falls outside) | 4.5 | 2,395 |

**One column, not two.** The previous version of this table carried a "local
density" beside the count, and it was the same measurement divided by
(4/3)π·7³ — 0.01056 /LY³ *is* 15.2 within 7 LY. Presenting a quantity twice in
different units reads as two pieces of evidence agreeing, which is worth
avoiding in a table headed "measured".

The exploration gradient the concentration buys is therefore **steeper in
reachable neighbours than the 3.0 density ratio**, because a rim neighbourhood
loses part of its volume off the edge of the cluster — which a point-density
ratio does not see. **No ratio is quoted as a figure here**: the core bucket is
51 systems, nothing in the suite pins it, and a number whose error bar nobody has
measured does not belong in a spec as a result. The direction is the finding; the
rows above carry their own `n` for a reader who wants the arithmetic.

The table before #118 quoted 17 / 8.3 / 3 from the analytic normalisation
`A = 256/21,708` at `R = 22`. Those were predictions of a uniform-density
integral over a ball, and this spec presented them as results. The centre bucket
is small (`n = 51`), stated because a figure over 51 samples carries a visible
standard error and the row should say so.

---

## 4. The system record

Let `t = r / R ∈ [0, 1]` — 0 at the core, 1 at the rim. All draws below come
from the `POLITY` domain.

### 4.1 Government — biased by radius

```
μ_gov(t) = 6 − 5·t
gov      = clamp(round(μ_gov(t) + U(−2, +2)), 0, 7)
```

| Location | Mean | Typical range |
|---|---|---|
| Core (t=0) | 6 | 4–7 — Communist … Corporate State |
| Mid (t=0.5) | 3.5 | 2–5 — Poor Ind … Confederacy |
| Rim (t=1) | 1 | 0–3 — Anarchy … Dictatorship |

Names, unchanged from Elite: `Anarchy, Feudal, Multi-gov, Dictatorship,
Communist, Confederacy, Democracy, Corporate State`.

This is what makes the frontier *feel* like a frontier without inventing a
mechanic: Elite's hostile-spawn rule is `rand(0–7) < government ⇒ no spawn`
(Anarchy skips the check entirely), so danger becomes a readable function of
position.

### 4.2 Economy — deliberately **not** biased by radius

```
economy = U{0..7}
if (gov <= 1) economy |= 2        // Elite's anarchy-isn't-rich clamp, retained
```

Names, unchanged: `Rich Ind, Average Ind, Poor Ind, Mainly Ind, Mainly Agri,
Rich Agri, Average Agri, Poor Agri`.

**This is the load-bearing asymmetry of the whole spec.** Elite's starter loop
was Lave ↔ Zaonce: two *adjacent* systems with opposite economies, a few LY
apart, and that short high-margin hop taught every player the game. If economy
correlated with radius, neighbouring systems would get similar economies,
local margins would collapse, and profit would require long radial hauls. So
economy stays locally scrambled everywhere, and the short trade hop survives
at every point in the cluster.

### 4.3 Tech level — biased by radius, twice

Elite's formula, with its random 0–3 term replaced by a radial one:

```
techBonus = round(3 · (1 − t))                              // 3 at core, 0 at rim
tech      = techBonus + (economy ^ 7) + (gov >> 1) + (gov & 1)
displayTL = tech + 1                                        // 1..15, as Elite displays it
```

Tech inherits the gradient twice — once directly, once through `gov` — which
is intended:

| Location | `tech` range | `displayTL` |
|---|---|---|
| Core | 5–14 | 6–15 |
| Rim | 0–9 | 1–10 |

Equipment availability is tech-gated (Elite shows ~TL+3 items), so **the
frontier is where you cannot buy the ECM you need to survive it**. That is the
risk/reward loop 1984 built from economy alone, here expressed spatially.

### 4.4 Derived fields — Elite's formulas, unchanged

```
population = 4·tech + economy + gov + 1          // displayed as (population >> 3) Billion
productivity = ((economy ^ 7) + 3) · (gov + 4) · population · 8
```

### 4.5 Name and description

Bell's 32-entry digram table, adopted **verbatim**, driven by our `NAME`
stream: four iterations, index `2·(draw & 31)` into the table, emit the pair,
strip `.` nulls; a seeded bit decides 3 or 4 pairs. The table is tuned so any
pair sequence is pronounceable — that tuning is the whole value, and is easy
to lose by rolling our own.

The goat-soup grammar is likewise ported from `txtelite.c`, seeded from the
`DESC` stream.

**Both are Bell's data, not just his technique.** Record provenance in
`docs/reuse-manifest.md` — Bell published `txtelite.c` explicitly as a
reference implementation and Oolite ships the same tables, so this is
well-trodden, but it is copied data and must not appear unattributed in a
source file.

---

## 5. Connectivity

A 3:1 concentrated cluster puts only ~3 systems in range at the rim, and 3D
neighbourhoods are lumpier than 2D ones. Across 8 galaxies some layouts will
strand a system or isolate a pocket — and a start system in a two-system
pocket is an unwinnable save. The 1984 research flagged reachability as
unverified even for the original seed data.

**Guarantee by resampling, not by repair:**

```
attempt = 0
loop:
  positions = layout(worldSeed, g, attempt)     // §1, §3
  if bfs(positions, maxJump = 7.0 LY) yields exactly one component: done
  attempt += 1
```

Still a pure function of the world seed, and it distorts the density profile
**not at all** — it keeps only the samples that were already good. Laying out
256 points costs microseconds, so a handful of attempts is free.

Repairing (pulling stragglers inward) was rejected because it bends the
distribution exactly where it is most fragile, and adds a rule every later
reader must hold. Building connectivity in by construction was rejected
because the distribution then stops being the profile §3 specifies.

**Assert the attempt counts in tests** (§9) so a generator change that
suddenly needs 40 attempts is visible in a diff rather than silent.

### 5.1 Start system

Galaxy 0. Among systems with `displayTL ≥ 8` and `gov ≥ 5`, take the one
closest to the cluster centre; ties break by lowest `systemIndex`. Deterministic,
and it puts the player in the safe, well-stocked core with the frontier
outward — the direction of increasing profit and increasing danger.

---

## 6. System contents

Systems are **multi-station**. This was the most consequential choice on
the node: it converts in-system travel (#10) from a single crossing into a
routing problem, and obliges #7 to price per *station* rather than per system.

Multiple stations only pay for themselves if they are not interchangeable —
two identical trade stations 200,000 km apart is just a longer commute for the
same transaction. So station type carves up what the system offers.

### 6.1 The star

Spectral class drawn from the `BODIES` domain, weighted to the main sequence
and capped at A (O and B are short-lived and would push the habitable band
past the orbit envelope):

| Class | Weight | L/L☉ | M/M☉ |
|---|---|---|---|
| M | 0.60 | 0.04 | 0.4 |
| K | 0.16 | 0.35 | 0.7 |
| G | 0.13 | 1.00 | 1.0 |
| F | 0.08 | 3.00 | 1.3 |
| A | 0.03 | 20.0 | 2.0 |

Radius and colour follow from the class. The habitable distance is
`a_hab = √(L/L☉)` AU, clamped into the orbit envelope below: 0.3 AU for an M
dwarf, 1.0 AU for a G star, 4.5 AU for an A star.

### 6.2 Planets

- Count: 3–7 candidate rungs; 1–7 survive the orbit envelope.
- Orbit envelope: **0.3 – 6 AU**.
- Build a Titius-Bode-like ladder — successive ratios drawn from `U(1.4, 2.3)`
  — then **rescale the whole ladder in log space so one planet lands exactly on
  `a_hab`**. That planet is the **primary**. Discard other rungs falling outside
  the envelope; keep and clamp the primary.
- Each rung draws formation mass from its own `FORMATION_MASS` stream, including
  rungs discarded by the orbit envelope. Among outer rungs (`a > 2·a_hab`),
  20% form small rocky ice worlds and the rest form gas giants. The independent
  stream leaves the old `BODIES` and `STATIONS` draws in place; the inner
  planets' seeded names, sizes and orbits stay fixed.
- Gas giants retain the existing 0–3 moon distribution. Half of all rocky
  planets, including ice worlds, gain exactly one moon: the existing moon-count
  roll selects it when it is 2 or 3. Rocky moon radius is capped at half its
  host's radius, and its orbit clears the host and moon. IDs remain
  `planet-<rung>-moon-0`; all moons remain airless scenery and use the same
  distance-based render-layer rule as other bodies.
- The primary rung is kept and clamped into the envelope, even when its
  floating-point rescale lands just outside it. Shipyards host on that primary
  or a remaining gas giant, never an outer rocky ice world. Station IDs and
  carrier keys stay fixed; a shipyard can move hosts when an old giant becomes
  rocky. A docked save still records its station key and resumes in flight at
  arrival, as the existing loader contract specifies.

`bun run scripts/measure-cold-rocky-moons.ts` repeats the 24-galaxy census
(three world seeds × eight galaxies). On this generator: 1,451 ice worlds out
of 7,534 outer planets (19.3%), and 6,581 rocky planets with moons out of
13,027 rocky planets (50.5%). The smallest single-galaxy buckets are 284 outer
planets and 520 rocky planets; the script prints every galaxy's denominator,
not just the pooled totals. `tests/cold-rocky-moons.test.ts` checks a four-galaxy
subset in the headless suite and pins unchanged inner planets separately.

### 6.3 Asteroid belt

Present with probability 0.45. Occupies a seeded gap between consecutive
orbits, at the geometric mean of the two, width ±10%.

### 6.4 Stations — 1 to 3, typed

| Type | Present when | Sits at |
|---|---|---|
| **trade station** | the system has a planet — see the note below | orbit of the primary planet |
| **refinery** | the system has a belt (§6.3) | inside the belt |
| **shipyard** | `displayTL ≥ 10` | orbit of the primary or a gas giant |

Count therefore keys off population and tech exactly as intended: a high-TL
core world plausibly supports three, a rim Anarchy one. **Shipyards generate
only in the core**, which is what gives the tech gradient teeth.

This spec places stations and names their type. **What a type *is* — market
offset, equipment exclusives, law and contraband, geometry, silhouette — is
[#13](https://github.com/jcfischer/seelite/issues/13) and lives in
`docs/specs/station-types.md`.** From there it reaches #7 (prices generate per
station as a delta on the system's price — §3.2 explicitly rejects an offset
*economy*), #8 (legal status, pirate presence) and #9 (two
docking interactions, not three).

The names above were changed by #13 to match `StationType` (see
`station-types.md` §1 for the umbrella/type distinction — the enum value is
`trade`, the thing is a "trade station"). The former synonym for the refinery
type was retired at the same time as a word carrying no distinction — §1 there
names it and holds the audit.

> **The trade station is unconditional again, since #51.** This table once said
> "always", which was false for about one system in 700: the orbit ladder could
> filter every rung and leave nothing to dock at. The ladder now keeps its
> primary rung, clamped to the envelope boundary. `station-types.md` §5.4 owns
> the measurement and the reasoning; they are not repeated here.

---

## 7. Scale, motion, and the arrival point

### 7.1 The finding that constrains #10

Combat speed is **2 km/s**: `THRUST = 2.0` km/s² (~0.2 g) under #5's assist
cap, tuned in the prototype so a 40 km station approach takes about twenty
seconds.

Crossing even the **entire near layer** — `NEAR_FAR_KM` = 20,000 km — in one
minute demands an average of **333 km/s**, already 167× combat speed. A cap
anywhere near that would make dogfights physically impossible.

**Therefore: no plausible system scale is crossable at combat speeds — not
even a near-layer-sized one.** In-system travel (#10) must deliver a cruise or
hop regime whatever it chooses. The only thing this spec changes is the ratio
it needs, and at astronomical scale that ratio is large:

| Leg | At 2 km/s | For a 60 s crossing | Ratio |
|---|---|---|---|
| 20,000 km (near layer) | 2.8 h | 333 km/s | 1.7 × 10² |
| 1 AU (1.496 × 10⁸ km) | 866 days | 2.49 × 10⁶ km/s = **8.3 c** | 1.2 × 10⁶ |
| 1.3 AU (typical leg) | 1,125 days | 3.24 × 10⁶ km/s = **10.8 c** | 1.6 × 10⁶ |

**Required compression is ~10⁶×, and the cruise speed is a single-digit
multiple of c.** That is a fiction commitment, not just a tuning number: a
sub-light cruise cannot do this. Even 0.1 c — 30,000 km/s — takes 83 minutes
to cross 1 AU. So at astronomical scale the cruise regime is necessarily
superluminal, as Elite Dangerous's supercruise is; the only alternative is to
shrink the system scale, which would undo §7.2.

*(Corrected 2026-08-18. The #6 receipt and the first version of this spec said
~1,000×, computed against a placeholder rather than the prototype's measured
2 km/s cap. The conclusion is unchanged and strengthened; the magnitude was
wrong by three orders.)*

### 7.2 Astronomical scale, because the renderer was built for it

`src/units.ts` already defines `AU_KM` and sizes `FAR_SCALE = 1e-5` so a body
at 1 AU lands at 1,495 render units. Compressing systems to something small
would leave the far layer with nothing to do and the three-layer split
unjustified. So: **real distances, float64 km, in the sim layer**, exactly as
#3 specified.

Consequence: station-to-station legs run to ~10⁸ km.

### 7.3 Orbits — circular, time-dependent

Positions are a **pure function of `(systemSeed, gameTime)`**:

```
θ_i(t) = θ_i0 + 2π·t / T_i
T_i    = 365.25 d · √(a_i³ / M★)          // Kepler III, M★ in solar masses
```

with `θ_i0` seeded, inclination `U(0°, 3°)` and a seeded ascending node.
Stations orbit their body circularly: radius =
max(`bodyRadius + U(400, 2000)` km, `1.5 × bodyRadius`), period `U(90, 240)`
min, in the body's equatorial plane. Station *spin* (for docking roll-match)
belongs to #9.

The floor is node #32's decision (`STATION_ORBIT_R_OVER_R`, `src/system.ts`)
and why the band alone could not stand: "low and fast" was absolute while
everything that has to clear the host scales with its radius — the cruise
shell (`1.05 ×` radius, `in-system-travel.md` §12.2) and the occlusion
geometry (§12.3). Measured on the 200-seed corpus with
`scripts/measure-cruise-arrival.ts` (re-runnable for any floor: edit
`STATION_ORBIT_R_OVER_R`, sweep, restore — `1.5 → 2.2 → 3 → 1.5` is the
whole comparison, and the committed value stays 1.5, so `git diff` shows
exactly what a sweep changed):
the band alone left 49 of 337 planet-orbiting stations inside their own
host's shell and 26.1% of cruise legs occluded by the host; 1.5 halves the
occlusion to 14.5% with the shell population at 0/337, 2.2 measures 7.4%,
and 3 measures 4.1% — 1.5 sits at the knee, since beyond it each multiple
buys less occlusion than the altitude it costs (a ~70,000 km giant's
shipyard: ~35,000 km up at 1.5, ~84,000 at 2.2, ~140,000 at 3). The floor
is a floor, not an orbit: a band row can only land above it while the band
still reaches past `0.5 × hostRadius`, i.e. below `2,000 / (1.5 − 1) =
4,000 km` of host radius — so small rocky hosts keep the band unchanged and
above 4,000 km every station rides at exactly 1.5 R. (The looser bound
people reach for first, where the band's top altitude stops clearing the
shell itself, is `2,000 / (1.05 − 1) = 40,000 km` — a band row there clears
the shell and loses to the floor.) `tests/station-orbits.test.ts` pins both
halves, and `scripts/measure-station-shells.ts` sweeps the placed t0
population — zero stations inside any shell, own or foreign — on demand.

Kepler ellipses were rejected: eccentricity adds a solver for an effect nobody
can perceive at these speeds.

**This establishes a game clock.** Orbital motion is invisible within a
session — Earth moves 30 km/s, so ten minutes displaces it 18,000 km, nothing
at AU scale. What it buys is that the data model is `position = f(t)` from the
start. A clock is very likely needed anyway (Oolite-style market regeneration
in #7, legal-status decay), and baking positions in as constants is the cheap
thing to write and the expensive thing to undo.

`gameTime` is seconds of sim time from epoch 0, and the save carries it.

### 7.4 The arrival point

- Distance: **1.0 AU from the star**.
- Direction: the **inbound bearing** — `normalize(p_origin − p_this)` in galaxy
  coordinates. System frames are galaxy-aligned, so the bearing maps straight
  in, and the neighbour stars in the background layer stay consistent with the
  chart.
- If the point falls within 0.25 AU of any body, push it outward along the
  bearing until it does not.
- On a new game (no origin system) the bearing is drawn from the system stream.

Arriving on the inbound bearing means the system genuinely looks different
depending on your route, and the crossing to a given station varies from ~0.2
to ~3 AU. A fixed witchpoint would throw that away for no saving.

---

## 8. Jump mechanics

| Property | Value |
|---|---|
| Range | ≤ 7.0 LY, true 3D distance |
| Cost | **0.2 Cr / 0.1 LY — 14 Cr for a full tank** (corrected; see below) |
| Wind-up | a few seconds, **player is vulnerable** |
| Interruption | taking damage cancels the charge |
| Transition | witchspace transition across the cut (#195 D1; built by #532) |
| Exit | §7.4 — 1 AU out, on the inbound bearing |

> **The Cost row above was a transcription error and is corrected in place.** It
> read `0.2 Cr / LY`, dropping the `/0.1` from Elite's PRXS table, which made a
> full 7 LY tank 1.4 Cr instead of 14 Cr. Fuel pricing belongs to
> [#7](https://github.com/jcfischer/seelite/issues/7), which adopts that table
> verbatim; `economy-trade.md` §6.1 owns the figure and the reasoning. The row
> is now right rather than merely flagged — a reader who never opens #7's spec
> should not be told the wrong number.

The wind-up is the point. Elite's jump was effectively instant, which made
hyperspace a guaranteed escape from any fight. A charge window turns "run
away" from a free action into a gamble: you commit, you are vulnerable, and
the attacker has a few seconds to stop you. That is a real mechanic handed to
#8, and it costs this spec nothing.

**Misjumps and witchspace ambushes are a reserved hook, not specified here** —
they are combat content and belong to #8.

### 8.1 What #187 built, and the one thing it decided

The table above was ratified with nothing performing it: `makeSystem` was called
once, inside `makeWorld`, and nothing ever assigned `world.system`. #187 built
the act. What it added to the table rather than merely implementing:

| Property | Value | Where it lives |
|---|---|---|
| Wind-up | **3 s**, flown in normal flight | `hyperspace.ts`'s `JUMP_CHARGE_S` |
| Tank | the flown hull's `tankLy` — its range and its capacity (#554); 7.0 LY on the courier — spent by distance | `hull.ts`'s `HULL_SPECS[hull].tankLy` |
| Refuel | any station's equipment screen, §6.1's price | `station-commerce.ts` |
| Range gate | the **squared** comparison | `hyperspace.ts`'s `planJump` |
| Cancelled by | damage — today, a failed dock (`docking.md` §2.0) | `Game.cancelJumpCharge` |
| Clock across a jump | **the wind-up, and nothing more** | `sim.ts`'s `jumpWorldTo` |

**The wind-up is one value with two fields.** §4 of `in-system-travel.md` says
cruise's spool-up deliberately borrows this one rather than inventing a second
escape mechanic; the constant is declared here now and cruise reads it, so the
borrowing runs the direction the specs state it in. The *state* is separate —
the two windows are cancelled by different things and end in different places,
and the flight floor's MODE cell prints `JUMP` for one and `SPOOL` for the
other.

**The range gate compares squared distances**, because §5's `isConnected` and
the chart's `neighbours` do, and §2's own note says the squared form is the
definition. A gate that rooted first can disagree with them for a pair sitting
within an ulp of 7.0 LY — and a jump refused to a system the chart drew inside
the shell is a map that lies.

**The clock is the decision, and it is not ratified.** A jump is a light year in
three seconds, so what the clock does across one is a real choice. What shipped
is the conservative arm: the clock advances by the wind-up — which is *flown*,
in normal flight, with the bodies moving under it — and the transition itself
costs no sim time. Two reasons, and a cost.

1. The map's constraint from #10 is that sim time is **never** compressed, and
   it says an argument against that has to be *made*. Making one is a decision
   node's act, not a build node's.
2. `market.ts` records that Elite re-rolled the fluctuation byte on every jump
   while seelite's market is `f(seed, epoch)` — so **the clock is the only thing
   that re-rolls a market**. A clock advance sized to cross #25's 30-minute
   epoch would turn every jump into a market reset that #25 measured nothing
   against, which is settling an economy question by accident.

The cost is stated so it is a decision rather than an oversight: an interstellar
run costs ~3 s of game time per jump, so #7's 291 Cr interstellar premium is a
premium on **distance** and not on time, and jumping is not a way to wait a
market out. The other half looks like a gain, and is stated only as far as it is
measured. `tests/world-jump.test.ts` asserts **two things about the key**: a
carrier key derived from `world.system.record` moves with the ship and comes
back, and the clock does not advance across the jump, so the 20-minute
half-life has nothing to decay against. Those two together mean an out-and-back
pair returns to a deficit *row* it left.

What follows from that about **laundering a farmed pair is not asserted
anywhere**, and was written here as though it were until sage round 4 read the
paragraph against its own next sentence. A deficit row is not a price: what a
market screen charges is `stockResponse` over that row, and nothing headless in
this repo joins the two across a jump. So the honest form is that a jump does
not *decay* a mark, and whether that closes the farm is a question for the
pricing instruments — `scripts/measure-greedy-trader.ts` and #191's buy-back
pump, which is the live case of a market outcome nobody has measured.

If a witchspace duration is ever ratified, `jumpWorldTo` is the one place it
goes.

**What #187 did not build.** The Galactic Hyperdrive (§2) — a foreign-galaxy
destination throws rather than jumping. Misjumps and ambushes, reserved to #8.
The witchspace tunnel as a rendered thing — #195 ruled it a transition that
straddles the cut rather than a place, and #532 builds it (`src/witchspace.ts`).
And a **hyperspace tank reading on
the shipped glass**: `hud-and-scanner.md` §5 fixes the flight floor at four
cells and gives the tank no home, so it appears on the station console's Fuel
row and on the legacy HUD only. That is a HUD gap this node surfaced and
deliberately did not settle by squeezing a fifth cell into a strip a browser
check asserts the shape of.

---

## 9. Verification

There is no golden-file oracle (§1.1), so the suite is property-based. All
headless `bun` tests unless noted.

1. **Determinism** — a fixed `worldSeed` produces a byte-identical digest over
   all 2048 system records. Pin the digest.
2. **Per-system independence** — generating system *N* alone yields a record
   identical to its entry in a full-table generation. This is the property the
   whole hash-per-system substrate exists to provide; it is the test that would
   have failed under Bell's chain.
3. **Connectivity** — all 8 galaxies resolve to exactly one component under a
   7.0 LY jump graph. **Assert the per-galaxy attempt counts** (§5).
4. **Distribution** — mean systems-in-range 8.3 ± 1.0; measured core:rim
   density ratio 3.0 ± 0.3.
5. **Start system** — exists, satisfies `displayTL ≥ 8 ∧ gov ≥ 5`, and is
   reachable from the whole component.
6. **Names** — all 2048 are 2–8 characters, A–Z only; record the duplicate rate.
7. **Stations** — every system has 1–3; shipyards appear only where
   `displayTL ≥ 10`; refineries only where a belt exists.
8. **Scale** — every body sits within 0.3–6 AU; the arrival point is ≥ 0.25 AU
   from every body in every system.
9. **Orbits** — `position(t + T) == position(t)` within tolerance, and
   `position` is continuous across the period boundary.
10. **Layer handoff** (browser probe) — a body crossing `HANDOFF_KM` does not
    pop in apparent size. Nothing has crossed it yet; this is the first content
    that will.
11. **Sky frame** — the transform of §11 round trips, is a rotation and not a
    reflection, reports the parameters it was drawn from, and covers the sphere.
    `tests/galaxy-frame.test.ts` and `tests/quat.test.ts`; no browser tier,
    because nothing draws it yet.

Probes 1–9 and 11 need no probe-registry entry, being headless. Note that the registry currently
authorises **no** `command` or `url` probes for this repo, so a `bun test`
probe on a work-graph node refuses until the adopter declares it.

---

## 10. Known weak joints

Recorded deliberately, not to reopen:

- **No correctness oracle.** Dropping Bell's seed cost the best verification
  asset available (§1.1). Property tests are weaker than a byte-exact diff.
- **Multi-station systems are the expensive choice.** They enlarge #7
  (per-station markets), #9 (per-type docking) and #10 (routing, not a single
  crossing) simultaneously. This is the decision most likely to feel costly
  later.
- **Rim connectivity depends on resampling behaving.** If a generator change
  pushes attempt counts up sharply, the profile (§3) or the radius (§2.1) is
  what needs revisiting — not the retry loop.

---

## 11. The galactic frame, and a system's world frame

Ratified by work-graph node
[#430](https://github.com/jcfischer/seelite/issues/430), on the principal's
ruling; the node's own record carries the dates, and this section is not the
place to attest one the node has not closed yet. `src/galaxy-frame.ts` is this section's arithmetic and
`tests/galaxy-frame.test.ts` holds it; where the two disagree, this section is
wrong and should say so.

### Two planes, and nothing between them

| | Galaxy space | A system's world frame |
|---|---|---|
| Reference plane | `y = 0` (§2 — the disc's flattening axis) | `z = 0` — the planets' orbital plane, which `system.ts` perturbs by each body's inclination |
| Who calls it | `galaxy-map.md` §2, the chart's drop-lines, `galaxy.ts`'s flattening | `hud.ts`'s attitude reference, rolled against `v3(0, 0, 1)` in `main.ts` |
| Whose normal | `GALACTIC_NORMAL` | `SYSTEM_PLANE_NORMAL` |

Before #430 these were two unrelated coordinate systems and **no transform
between them existed in `src/`**: `git grep -iE 'galactic|galaxyFrame|fromGalaxy'`
returned the Galactic Hyperdrive and nothing else. That made *"which way from here
is the cluster's core"* unanswerable, which is the whole of what
[#100](https://github.com/jcfischer/seelite/issues/100)'s derived sky needs — the
sky is nothing but bearings from here to the other 255 systems.

### The transform

**One seeded rotation per system, drawn from `DOMAIN.SKY_FRAME` (23)**, carrying
galaxy-space directions into that system's world frame. Three draws, in a fixed
order: the image of the galactic normal's polar cosine, its azimuth, then a roll
about that image in [−π, π). The frame reports the pole and the roll beside the
quaternion, because a rotation that cannot be interrogated is a rotation nobody
can check.

- **Isotropic.** The galactic plane's normal lands anywhere on the world sphere,
  and the frame rolls about it as well. With the pole uniform *on the sphere* (its
  polar cosine drawn directly, not its angle) and the roll uniform on the circle,
  the draw is uniform over rotations: no axis favoured, no tilt preferred.
- **Aligned frames were rejected**, twice over. #100 refused the version that
  makes every system's orbital plane the galactic plane, because it gives every
  sky the same band tilt and throws away the per-system variety the decision was
  bought for. The bounded-tilt arm — the cluster kept within N degrees of the
  flight horizon — is the same refusal one step narrower, and was ruled out here.
- **No rule keeps the band out of its own sun.** Under an isotropic draw the band
  passes close to the system's own star far more often than intuition says: the
  band is the great circle perpendicular to the pole, so the event that washes
  structure out is the star lying **near the cluster's plane**, whose probability
  is `sin 30° = 1/2` — in about **one system in two** the band runs within 30° of
  the star, and that figure does not depend on where in the system's sky the star
  sits. The clean case is the rare one: the pole within 30° of the star *or its
  antipode* — `1 − cos 30° = 0.134`, one system in seven — is what puts the
  **band** 60–90° off the glare, because the band is the great circle perpendicular
  to that pole. It constrains nothing about the **core bearing**, which is not in
  the band: a system standing near the flattening axis (§4's `systemFromPosition`
  divides `y` by `Q`) can have the core near the pole and therefore near its own
  star. No row measures core bearing against `frame.pole`, and until one does this
  sentence is about the band alone — as written before #430 it claimed both.
  Accepted on the
  principal's ruling rather than engineered away: a rejection rule makes the frame
  a loop instead of a draw, and couples which way the sky is drawn to where the
  system's own star sits — which is the coupling every domain tag in `domains.ts`
  exists to prevent. A washed-out band is what the variety costs, not a defect in
  it.
- **One *named* copy of the normal.** `GALACTIC_NORMAL` is the only place in `src/`
  that authors that direction **as a vector**, and `galaxy-map.ts` reads it rather
  than restating it. The second author is structural rather than named: `galaxy.ts`
  flattens onto `y` through `GALAXY_FLATTENING_Q`, and being the module
  `galaxy-frame.ts` imports it can never read the constant back without a cycle.
  What ties the two is `profileRadiusLy` — the exported form of the quotient
  `systemFromPosition` inlines — held in `tests/galaxy-frame.test.ts` to the
  component lying along the constant's axis. A chart and a sky that each hold their
  own idea of which way the galaxy lies will drift and nothing headless can see it;
  a spelling check sees only the named author, which is what that row is for.
- **The roll's datum is entailed, not declared.** The plane has no natural east —
  a rotation about the normal is a symmetry of an oblate spheroid, so nothing in the
  cluster's shape prefers a direction — and still the roll has to be measured
  *from* somewhere to be a number rather than a feeling. That somewhere is the
  **shortest arc's own plane**, which the construction fixes, so the frame ships no
  in-plane constant: a name sitting beside an entailed datum advertises a choice
  nobody made, and the one `#430` first exported was deleted for exactly that. It
  follows that anything reproducing a frame's roll rather than trusting its
  quaternion — #433's bake is the charted one — rebuilds the same arc and may not
  pick its own reference direction; `tests/galaxy-frame.test.ts`'s reconstruction
  row is what that looks like written a second way. That `galaxy-map.ts` draws
  galaxy `x` into mesh `x` (making `+x` screen-right with the cluster unyawed) and
  then turns the cluster by `DEFAULT_YAW` = 0.6 rad are facts about the chart's
  camera, and nothing in the frame reads either.

### The flattening is geometry, not a distortion to undo

`systemFromPosition` divides a position's `y` by `GALAXY_FLATTENING_Q`. That
quotient is the **profile coordinate** the §4 gradients are written against —
"profile" in §3's and §4's sense, the distribution's own radial argument, which is
what `profileRadiusLy` is named for. It is not the _Avoid_ alias for a **Commander**,
which `CONTEXT.md` scopes to player-facing text; this is the spec talking to itself
about a gradient. And
it belongs there and only there: the stored position *is* the fiction's shape, an
oblate cluster of 256 systems, so a bearing is taken from the stored positions
exactly as they stand. Unflattening before differencing produces a unit vector
that is subtly wrong and no test in this repo will call it out.

### The centre, and what pointing at it is worth

`GALACTIC_CORE` is the origin: §3's density profile is centred there, so "toward
the core" is "toward the origin". #100 measured over 81,920 observer systems what
that direction buys — integrated `1/d²` varies only **2.17×** from core to rim,
while the density in a 20° cone toward the core runs **×1.8 to ×6.8–8.3** (two seed
draws disagree at the rim, so the range is the honest figure), and the plane
itself measures **1.31×** against isotropic. **The bearing is the picture; the
brightness almost never is.** Anyone quoting "the band" is quoting that 1.31×
ceiling, which is not a band.

### What this section does not decide

The bake, the points layer, the rim view row and whether a pilot can read any of
it — siblings below #100 (`#431`, `#432`, `#433`, `#434`), all blocked on this.
This section answers where a **Galactic frame** direction is in a system's own sky,
and nothing about what is drawn there. **§12 is what landed in that blank**, and
re-measuring the receipt it came with found one figure whose *label* was missing
rather than wrong: #100's "median 21.1 ly" sat beside a "mean 5.45" with no quantity
named, and read as the **pooled median separation** of two systems it is right to the
printed precision (§12 measures 21.10). It took this node's own instrument a round to
agree: the figure it first printed for that row was the median *of* 81,920
per-observer medians, a different statistic 2% higher, and the discrepancy it "found"
in #100 was its own. The spread is the other case — 5.42 magnitudes rather than 4.2,
which moved once the quantity it names is fixed.

## 12. The sky behind everything, and which half of it is invented

`#431` settled what the backdrop draws now that `#11`'s section above had settled
where a direction is. The answer is two populations of points under one shader,
and the structural content of that decision is a staleness rule, a size law, and
one invariant that runs between the two layers.

**This section is the single home of the figures.** `src/backdrop.ts` and
`CONTEXT.md` cite it rather than restating them, because three copies of a number
only an instrument can re-derive is one copy that goes stale in the next edit —
which is not a hypothetical here: the first draft of this node carried a rebuild
cost in two files with two different values and a clamp distance that no longer
matched the constants beside it. The instrument is `scripts/measure-sky-density.ts`;
unless a line below says otherwise, every figure in it is that script's `sky` and
`band` modes over **81,920 observers** — 40 worlds × 8 galaxies × 256 systems.

### Two populations, because they go stale on different days

- **The derived sky** is `systemField(galaxy, observer)`: one point for every
  other system in the galaxy — 255, because a system cannot see itself — at its
  true bearing through §11's frame. It is a function of *which system the player
  is standing in*, so a witchspace arrival rebuilds it; `rebuildSystem()` is the
  call, and `probe-sky.mjs` is the row that notices when it stops being one.
- **The invented population** is `faintField(worldSeed, FAINT_COUNT)`: an area-
  preserving scatter over the sphere, from `STREAMS.backdrop`. It is a function of
  the world seed and is built once, at boot, and never again.

Two `THREE.Points` follow from that, not from two ideas — there is one sky. One
geometry holding both would re-upload 4,255 vertices on an arrival to change 255
of them; two means an arrival allocates **7,140 bytes** — positions 3,060, colours
3,060, sizes 1,020, counted off a field the shipped `systemField` returned and
printed by `cost` mode — and the texture costs nothing ever again. They share **one** `ShaderMaterial`, because everything that
distinguishes a point of one layer from a point of the other is already an
attribute, and a second material would be a second compiled program for an
identical shader. `rebuildDerivedSky()` disposes the old geometry only after the
swap, because disposing the one still mounted frees what the frame in flight is
drawing with.

Rebuilding costs **0.036 ms** per arrival — 255 bearings, 255 star-class draws,
three small typed arrays, from `cost` mode (bun, headless). This is the one copy
of that figure: `src/backdrop.ts` and `src/main.ts` both point here rather than
carrying it, because this node shipped it in two files with two different values.
What the layer *draws* is 255 more points on one more draw call, and #433 prices
that on the sheet.

### Why invent anything: the sky is thin

The real layer is **6.18 points per 1000 square degrees**. The comparison
population is **#100's own choice, not a figure this node re-derived**: its receipt
set Earth's naked-eye sky at **145** stars, 3.51 per 1000 sq deg, which makes the
real layer **1.8× denser** than the number #100 itself held up as "a recognisable
sky" — and that is the exact reach of the claim, since a different 145 would move
it. Its other comparison, the dark-sky figure of order 5,000 stars, is the one
#100's "23× sparser" actually needs, and against it the real layer is twenty times
short of what reads as *sky*. The invented population — 4,000 points, 97 per 1000
sq deg — supplies exactly that and nothing else. Two populations, two ratios, and
the receipt quoted both as if they were one: which is the same mislabelling as the
distances above, and why both comparisons are spelled out here rather than
collapsed into a "sparser than" sentence.

How thin the real layer is, in the units a size law is written in: the median
**nearest** other system is **3.06 ly** away, the median *separation* to any other
system is **21.10 ly** — pooled over 20,889,600 **ordered** observer-to-other-system
samples, which is 10,444,800 unordered pairs seen from both ends and does not move a
median, and is what "typically" asks and what `BRIGHT_SIZE_MID_LY` is anchored to — and
the median
*farthest* is **38.0 ly** with the worst in
the corpus at **48.8**. The 1st percentile nearest sits at 0.72 ly against a 99th
percentile farthest of 47.2: a **65 : 1** span for one layer to draw.

### The law on each point

- **Bearing is §11's, unchanged.** `skyBearing(frame, observer.pos, other.pos)`,
  scaled onto the backdrop sphere. `tests/backdrop.test.ts` holds all 255 against
  that call rather than against a golden array, so a replaced transform is a red
  row and not a surviving coincidence.
- **Size is flux.** The shader draws an additive soft disc, so the light a point
  contributes goes as its drawn size squared; drawing at `size ∝ 1/d` is therefore
  flux `∝ 1/d²` at constant surface brightness. That is #100's inverse square with
  no invented exponent and no dial beside it. The band's mid sits at
  `BRIGHT_SIZE_MID_LY` = 21.1 ly, the pooled median separation above,
  and the mid of a reciprocal law is the geometric mean of its two clamps — so
  that one figure places every star in the game together.
- **Colour is class, never exposure.** A point takes the hue of its system's own
  star class, normalised through `star-colour.ts` to the one photosphere exposure
  `planet-surface.ts` gives a sun's disc; #59's rule one scale down. Here it does a
  second job: a tint that carried its own exposure would put an M dwarf's point far
  under an F star's, and the size law would stop being a statement about distance
  and become a statement about two things at once.
- **No invented point is drawn larger than the smallest real star.**
  `FAINT_SIZE_MAX < BRIGHT_SIZE_MIN`, held in `tests/backdrop.test.ts`. That is a
  relationship and not two settings, and the counts are why it has to hold: the
  invented layer is 97 points per 1000 sq deg everywhere while the real one runs
  **8.4 inside ±20° of the cluster's plane and 5.0 outside it**, so the invented
  population outnumbers the real one **11.6 : 1 inside the plane and 19.2 : 1
  outside it**. Nothing a count can do carries structure at those odds; brightness
  is the only channel left.

These are laws of the point buffers. **In cruise the screen breaks the last two on
purpose** (#537): the light shift pulls each point's colour toward the starbow and
scales its drawn size by 0.7–1.6× with its Doppler factor, so a beamed faint point
can outsize an unbeamed real one. It is off at rest, where these hold on screen as
well. `in-system-travel.md` §5 and `src/light-shift.ts` own it.

**The scope of that invariant is the size, and this section claimed more than it
holds for a round.** Delivered light is `size² × tint`, and the two layers' tints are
not on one authoring scale: {@link systemField}'s comes from a star-class hex through
the sRGB→linear transfer at the one photosphere exposure, while the invented ramp is
picked by eye *in* linear light and normalised to nothing. `grain` mode prints where
that lands — `(0.0096/0.012)² = 0.64`, so an invented point outshines the dimmest real
one above linear luma **0.859**, and **35.1% of the shipped ramp's points sit above that
luma** (median 0.765, maximum 1.000). **That 35.1% is not a share of outshining**, and
the first version of this section read it as one, an eighty-five-fold overstatement of
the leak. Size and tint are drawn from independent RNG streams, so a threshold computed
*at maximum size* is a bound, not a share: taking each point's own `size²` with its own
luma against the dimmest real star's, **0.41% of invented points actually outshine it**
(132 of 32,000 sampled across eight worlds). It is a tail problem — everything above
the size law's top 2.6% of draws, `u > 0.974`, and 0.41% of the whole population once
its tint is counted — not a third of the sky, and a reader who is told "a third" will
size #433's colour decision two orders of magnitude wrong. Both rows print in `grain`
mode, the marginal one labelled as the bound it is. Two ways to close even the 0.41%
exist and both move the picture — normalise the invented ramp to the same photosphere
exposure, or push `FAINT_SIZE_MAX` far enough down that no luma reaches the
threshold — which is
#433's colour decision on its sheet, not a fact this node can settle by asserting a
size ordering. What is settled here is what is held: **geometry**.

### What the two clamps catch, and where they are written

The two distances are `BRIGHT_CEILING_LY` = **9.86 ly** and `BRIGHT_FLOOR_LY` =
**45.17 ly**, computed from the same constants as the law and printed by `sky`
mode beside the share each one catches. They are exported constants rather than
prose for a reason: the first draft of this node documented "9.07 ly" and "51.0
ly" next to a `K` that had already moved, and no check could see it. A test now
holds each distance against the law, so moving a clamp moves the documented
number or goes red.

- The **ceiling** catches **8.2% of points — 20.8 of a sky's 255**, which is what
  "one system in twelve is drawn as big as it is allowed to be" actually means:
  every sky has a couple of dozen stars at the same top brightness. What the clamp
  gives up is the ordering *within* that handful; what it buys is the corpus's
  closest pair, **0.063 ly** apart, drawing at the ceiling rather than at the
  **157× the ceiling** an unclamped `K / d` asks for there. `sky` mode prints that
  multiple in world units, deliberately short of a px figure: converting one
  would read `STAR_PIXEL_SCALE` across the Three.js boundary, and a documented px
  figure with a renderer dial in its product is one that goes stale on its own.
- The **floor** catches **0.07% of points**, and that is not zero: the corpus's
  worst farthest other system is 48.8 ly against a floor at 45.2, so the
  outermost systems of the most peripheral observers *are* drawn at the floor and
  stop shrinking there. It is a guard rail that today's corpus already leans on,
  and the honest statement of it is that the far edge of a sparse sky reads as one
  size rather than as a diminishing one.

### The plane is a ridge, and the cone is the loud one

46.3% of a sky's points sit within 20° of the cluster's plane against **34.2%**
for a uniform sphere — a **1.35×** excess, ×1.41 inside ±10°. That is #100's 1.31×
re-measured on the same question, and the question is the same one: the elevation
and cone statistics are read in the **Galactic frame**, which §11's section and the
instrument's own header both say is deliberate, because #430's per-system rotation
turns the whole picture without changing any of these angles.

**How far apart the worlds themselves get is printed, not assumed.** Across 40
worlds the ±20° excess runs **1.322 to 1.397**, median 1.353. So #100's 1.31× sits
*below* the low end of its own kind of spread, not inside it: the two instruments
agree to within 3% and no seed explains the remaining 3%, which is a difference
#100's deleted instrument may have had and this one cannot re-check. Saying
"agrees inside seed noise" would have made a spread do work it was never measured
to do.

**Which is why the agreement checks the instrument and the cluster, and not the
transform.** A statistic built to be invariant to `skyFrame` cannot test
`skyFrame`; that is `tests/backdrop.test.ts`'s element-by-element hold of every
point against `skyBearing`, which is not invariant and does not care about the
plane at all. What re-measuring #100 buys is the receipt being checkable again —
its instrument went with the file that has since been rewritten — and the finding
that the plane is a gentle ridge, not a band, which is §11's ruling arriving a
second time from a different direction.

What is loud is the cone on the centre: a system near the cluster's rim puts
**24.5%** of the other systems in its sky inside a 20° cone on the centre, eight
times uniform, while one near the core manages 6.7%, because from the middle the
core is every direction at once. So the picture this layer draws is a bright
ordering inside a mild ridge with one dense direction — not a Milky Way band, and
anyone quoting "the band" for this should quote 1.35× and 8× instead.

### What the invariant costs the invented layer

Ten times its light, and almost none of it is the grain. `grain` mode integrates
both laws in closed form — for `min + span·u⁶`, mean `min + span/7`, median
`min + span/64`, and mean `size²` `min² + 2·min·span/7 + span²/13`, which is the
light an additive disc delivers:

| band | mean size | median | top of range | E[size²] |
| --- | --- | --- | --- | --- |
| replaced `0.006 + 0.05·u⁶` | 0.01314 | 0.00678 | 0.05600 | 0.0003140 |
| shipped `0.0048 + 0.0048·u⁶` | 0.00549 | 0.00487 | 0.00960 | 0.0000314 |

**Light per invented point falls ×10.00, and the median point's light falls ÷1.93.**
The lost light is the **tail**: the old law scattered its handful of 17-px discs
over the whole sphere, at random bearings, at sizes indistinguishable from the
systems the sky is supposed to be a picture *of*. The invariant removed exactly
those. The grain is nearly as bright as it was, and whether it is enough of a
night remains the sheet's question.

Those size figures are world units, which is what the instrument owns. The px
readings — 4.1 px to 1.7 px at the mean, 2.1 to 1.5 at the median, 17.6 to 3.0 at
the top — are the same rows multiplied by a canvas height and `STAR_PIXEL_SCALE`,
and `grain` takes both as **arguments** (`grain 900 0.35`) rather than copying the
renderer's dial: `main.ts` sits behind a Three.js import this headless tier may not
cross, and a fourth copy of a display dial is a fifth way for a figure to go stale.
A px row is therefore a *stated reading* — canvas, scale and all — and the rows
above it are the ones that re-derive on their own.

### `BACKDROP_RADIUS` is where a direction is drawn, not where a star is

The constant survives from before this section and means something different now.
Every point of both layers sits at exactly `BACKDROP_RADIUS` from the camera,
which is re-centred into the sphere each frame; the number is this layer's
convention for *far enough that it cannot parallax*, and nothing more. Distance
travels in the size. A point placed at its `distanceLy` instead would leave the
backdrop camera's frustum and never draw at all. `probe-sky.mjs` measures the
mounted radius rather than trusting the name, and `probe-boot.mjs` no longer
reaches for `children.find(c => c.isPoints)`, which cannot tell the two layers
apart.

### Two of #100's figures were labelled for the wrong quantity

Its receipt is the source of this node's design, and it is worth being exact about
what re-measurement found, because "the numbers did not survive" would be the same
kind of sloppiness the receipt was guilty of — and, in one case, the sloppiness was
this section's own rather than the receipt's.

- Its "median 21.1 ly" sat beside a "mean 5.45" and **named no quantity**, which is
  the whole defect: a number without its quantity cannot be checked, only agreed or
  disagreed with. Node #431's own question supplied a quantity for the 5.45 — "mean
  nearest neighbour" — and that one is wrong rather than unlabelled: the corpus's mean
  nearest other system is **3.14 ly**, and 5.418 is the mean of the **magnitude spread**.
  The receipt under-measured the sky's tightest spacing by a third while quoting a
  brightness figure beside it as if it were a distance. Named, it is **right**. The pooled median separation — one sample
  per ordered observer-to-system sample (20,889,600 of them, 10,444,800 unordered pairs
  read from both ends) — is **21.10 ly**, and that is what `BRIGHT_SIZE_MID_LY`
  is now anchored to. What it is *not* is the median **nearest** other system, which
  is **3.06 ly**; nothing in the receipt claimed that, and the two statistics differ
  by nearly seven, which is the difference between a sky with one bright star in it
  and one with a handful. **The 2% discrepancy this section first reported against
  #100 was this instrument's own label slip**: it printed the median *of* 81,920
  per-observer medians (21.52) under the name "median separation", and `sky` mode now
  prints both rows with their quantities on them. A receipt that names nothing and an
  instrument that names the wrong thing produce the same argument, and only one of
  them can be fixed by editing prose.
- Its "4.2 magnitudes" of inverse-square spread is the case where the number itself
  moved: **5.42** median, 13.79 at the worst.

Its "23× sparser than a sky a person recognises" is the same third figure with a
sliding population under it: it holds against a ~5,000-star dark sky and not
against the 145 its own receipt compared against, where the real layer is 1.8×
*denser* — see "Why invent anything" above for what each ratio is a ratio *of*.
`scripts/measure-sky-density.ts` states which distance each of its rows is
reading, which is the discipline the mislabelling was missing — and it checks the
one arm that was itself wrong at first: a *two-sided* band of ±θ takes **sin θ** of
a uniform sphere, and the cone arm `1−cos θ` printed ×7.68 where the reading is
×1.35. `bandArm` is tested against the ±30° identity before it is used, because
the wrong arm shipped with a comment beside it saying the wrong thing.

### What this section does not decide

The rim's deep-sky sheet row is `#432`. The bake — the haze that goes *behind*
these points, at whatever exposure makes both readable — and the canonical sheet
and the principal's yes on it are `#433`, which reads this section's size law
rather than authoring its own. Whether a pilot can find a system by bearing at all
is `#434`. And the one visible thing this section changes about the shipped
picture — the invented layer's bright tail going away — is a look decision
`#433`'s sheet owns: this section rates it in pixels and leaves the verdict where
the ruling says it belongs.
