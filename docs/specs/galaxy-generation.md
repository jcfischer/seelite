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

/** Domain-tagged sub-streams, so adding a draw in one domain moves no other. */
const DOMAIN = { POS: 1, NAME: 2, POLITY: 3, BODIES: 4, STATIONS: 5, DESC: 6 } as const;
const stream = (sysSeed: number, domain: number) =>
  seededRand(mix(sysSeed, domain));
```

`STREAMS.galaxy` and `STREAMS.system` already exist in `src/rng.ts`; the
domain tags above are the second-level split `mix` was written for. Adding a
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

- Count: 3–7 total.
- Orbit envelope: **0.3 – 6 AU**.
- Build a Titius-Bode-like ladder — successive ratios drawn from `U(1.4, 2.3)`
  — then **rescale the whole ladder in log space so one planet lands exactly on
  `a_hab`**. That planet is the **primary**. Discard any rung falling outside
  the envelope.
- Gas giants (a > 2·a_hab) carry 0–3 moons, far-layer scenery only.

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
| Transition | witchspace tunnel |
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
| Tank | 7.0 LY, spent by distance | `galaxy.ts`'s `JUMP_RANGE_LY` |
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
market out. The other half is a gain rather than a cost — an out-and-back jump
pair leaves the origin station's stock deficit where it was, so a jump is not a
way to launder a farmed pair either, which is the farm Elite's re-roll left
open. If a witchspace duration is ever ratified, `jumpWorldTo` is the one place
it goes.

**What #187 did not build.** The Galactic Hyperdrive (§2) — a foreign-galaxy
destination throws rather than jumping. Misjumps and ambushes, reserved to #8.
The witchspace tunnel as a rendered thing. And a **hyperspace tank reading on
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

Probes 1–9 need no probe-registry entry. Note that the registry currently
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
