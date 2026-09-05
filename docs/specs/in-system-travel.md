# Spec: in-system travel

**Status:** resolved decision node — [#10](https://github.com/jcfischer/seelite/issues/10)
**Amended:** 2026-08-19 by [#14](https://github.com/jcfischer/seelite/issues/14) — flown, and six
things changed. See [§11](#11-amendments-from-14-flown); each affected section
below carries a pointer.
**Date:** 2026-08-18
**Inputs:** [#3](https://github.com/jcfischer/seelite/issues/3) (space-scale rendering),
[#4](https://github.com/jcfischer/seelite/issues/4) (Elite-1984 mechanics),
[#5](https://github.com/jcfischer/seelite/issues/5) (flight model),
[#6](https://github.com/jcfischer/seelite/issues/6) (galaxy & system generation)
**Binds:** [#8](https://github.com/jcfischer/seelite/issues/8) (combat),
[#9](https://github.com/jcfischer/seelite/issues/9) (docking),
[#11](https://github.com/jcfischer/seelite/issues/11) (galaxy map)

How the player crosses a system. Decided with the principal in a grilling
session on node #10; ten decisions, one at a time.

---

## 0. The problem, in numbers

Combat speed is **2 km/s** — `THRUST = 2.0` km/s² under #5's assist cap, tuned
in the prototype so a 40 km station approach takes about twenty seconds.

#6 put systems at astronomical scale: planets on 0.3–6 AU orbits, arrival 1 AU
from the star, station-to-station legs of order 10⁸ km.

| Leg | At 2 km/s | For a 60 s crossing | Ratio |
|---|---|---|---|
| 20,000 km (`NEAR_FAR_KM`, the whole near layer) | 2.8 h | 333 km/s | 1.7 × 10² |
| 1 AU | 866 days | 2.49 × 10⁶ km/s = **8.3 c** | 1.2 × 10⁶ |
| 1.3 AU (typical) | 1,125 days | 3.24 × 10⁶ km/s = **10.8 c** | 1.6 × 10⁶ |

**Required compression is ~10⁶×, and the resulting speed is a single-digit
multiple of c.** That is a fiction commitment, not a tuning number: even 0.1 c
takes 83 minutes to cross 1 AU, so a sub-light cruise cannot do this at any
acceptable pacing.

### 0.1 This is FTL, not time compression

The fog that graduated into #10 called this option "time-compressed cruise".
What is specified here is **fictional faster-than-light travel with sim time
running at real time throughout**. Orbits, markets, NPCs and the #6 game clock
all tick normally; only the ship is absurd.

The distinction is load-bearing. Genuine time compression would accelerate the
game clock, which #6 made authoritative for body positions and which #7 will use
for market regeneration — a system-wide consequence for what looks like a
travel-pacing choice.

---

## 1. The regime

> **Amended by #14 (§11.1).** The exit clamp is on velocity **relative to the
> target**, not absolute.

**Cruise is a third flight regime**, alongside #5's assist-on and assist-off.
It is not a mode of either.

| Property | Value |
|---|---|
| Velocity direction | **nose-locked** — the ship travels exactly where it points |
| Throttle | sets magnitude only |
| Lateral drift | none |
| Flight assist | **not in force**; the toggle's state is remembered, not applied |
| Exit velocity | clamped to the assist cap (2 km/s) along the nose |
| Exit regime | whichever assist state was held on entry |

The reason it is a separate regime is arithmetic, not aesthetics. Honouring the
assist toggle would mean Newtonian cruise at ~10⁶×, where a lateral velocity of
one part in a thousand — imperceptible while steering — puts the ship millions
of km off course by arrival, and cancelling it means turning and burning at the
same absurd scale. That is not a demanding expert mode; it is unflyable, and it
would exist only to satisfy a symmetry.

This **amends the #5 constraint** that two flight regimes exist permanently.
Three do. Combat, docking, AI ships and autopilot still owe an answer under
assist-on and assist-off; cruise is a distinct dynamic that owes its own.

---

## 2. The speed law

> **Amended by #14 (§11.2, §11.4, §11.6).** The law is keyed to the *nearer* of
> the mass and the target; a body's surface ends cruise; `v_max` and the
> exponent are now 23 c and 0.60.

Speed scales with distance to the **nearest star or planet** — not to the
target, and not counting moons, stations or belts.

```
v(d) = clamp(v_max · (d / d_ref)^0.75, v_min, v_max)

  d      = distance to the nearest star or planet, km
  v_max  = 6.0 × 10⁶ km/s   (20 c)
  d_ref  = 0.5 AU = 7.4799 × 10⁷ km
  v_min  = 100 km/s          (safety floor; the drop-out fires well above it)
```

### 2.1 Why nearest-mass and not target

At 20 c the ship covers **600,000 km per 0.1 s tick** (`MAX_DT` in `main.ts`).
A planet is ~6,000 km across. Under a target-only law the ship would
routinely pass clean through worlds between simulation steps, and preserving
that requires swept collision tests to defend behaviour nobody wants.

Keying off the nearest mass dissolves it: approaching anything slows you, so
arriving at a planet's surface at 20 c is not possible. It also promotes #6's
scenery bodies into navigation features — a line that grazes a gas giant costs
time — which is texture already paid for in the renderer.

Moons and stations are **excluded** so that a station's own planet does not
permanently throttle the final approach.

### 2.2 Why the 0.75 exponent

The exponent is the dial between tedium and overshoot, and both ends are real:

- `v ∝ d` (linear) gives a logarithmic approach with time constant
  `d_ref/v_max` ≈ 12.5 s; 0.5 AU down to a 50 km drop costs
  `12.5 · ln(1.5 × 10⁶)` ≈ **3.0 minutes** of decelerating crawl.
- `v ∝ √d` covers the same stretch in ~35 s but leaves the ship at thousands of
  km/s at drop range — the last kilometres pass in a fraction of a second.

`d^0.75` sits between them. **It is a derivation, not a playtested value** —
see §8.

### 2.3 Resulting pacing

Ramp time inside `d_ref`, integrating the law:

```
t = (4 · d_ref^0.75 / v_max) · (d_start^0.25 − d_end^0.25)
  = 0.537 · (d_start^0.25 − d_end^0.25)      seconds, d in km
```

| Leg | Deep-space run | Ramp | **Total** |
|---|---|---|---|
| 0.2 AU (short hop) | — | 38 s | **38 s** |
| 1.3 AU (typical) | 20 s | 48 s | **68 s** |
| 6 AU (outer planet) | 137 s | 48 s | **3.1 min** |

Key speeds along the approach:

| Distance to body | Speed | Note |
|---|---|---|
| ≥ 0.5 AU | 6.0 × 10⁶ km/s (20 c) | capped |
| 10,000 km (`HANDOFF_KM`) | 7,450 km/s | the far→near layer handoff |
| 1,000 km | 1,327 km/s | |
| 50 km | 140 km/s | drop-out fires; clamped to 2 km/s |

The final 10,000 km takes **~3.9 s** under deceleration.

Exactly 60 s on the typical leg would want `v_max` ≈ 23 c. Rounding to 20 c and
accepting ~68 s is deliberate: the number is going to be tuned by flying it, and
a round figure is a better starting point than a false precision.

---

## 3. Arrival

> **Amended by #14 (§11.5).** An approach clamp flies the last 10,000 km, so
> "failure to slow means overshooting" no longer describes a straight-in run.
>
> **Amended by #30 (§12).** The surface rule below scaled its clearance to the
> planet rather than to what orbits it, so a station in clear space was
> unreachable — cruise ended thousands of km short at thousands of km/s. The
> body a selected target orbits now guards at an absolute standoff of
> `HOST_CLEARANCE_KM` above its true surface rather than at a proportional
> shell, and the guard fires on crossing *inward* rather than on being inside,
> so a station that sits inside its host's shell can be cruised out of.

**Player-managed deceleration with an automatic drop-out.**

- The HUD shows time-to-target; the player manages the throttle.
- Cruise ends automatically once the ship is **inside ~50 km** of the selected
  target **and** below the speed threshold.
- Failure to slow means **overshooting and looping back**. It never causes
  damage.

The drop radius is bounded from below by normal flight, not chosen freely:
at 2 km/s, dropping the player 1,000 km out means an eight-minute crawl — worse
than the problem being solved. #10's own figure (40 km in ~20 s) puts the
handover in the tens of km.

No-damage-on-overshoot is a deliberate interaction with #9. Docking is already a
failable skill gate on every iteration of the trade loop; stacking a second
punishing gate immediately before it is one too many. The skill is preserved,
the punishment is not.

---

## 4. Interdiction

**Symmetric**, per the fairness doctrine adopted from #4 — which the Oolite wiki
itself invokes to criticise the Torus drive, a cruise NPCs cannot use and which
therefore lets players cheese any pursuit.

| Property | Value |
|---|---|
| Who can initiate | player **and** NPCs, identically |
| Mechanism | a short skill contest |
| On success | **both** parties drop out of cruise, into normal flight |
| Re-entering cruise | a spool-up of a few seconds, **cancelled by damage** |

The spool-up deliberately reuses #6's hyperspace wind-up rule rather than
inventing a second escape mechanic: one rule the player learns once, applied in
two places. Without it, every losing fight ends in a free escape.

**Since #187 the borrowing runs the direction this sentence states it in.** The
seconds were a `SPOOL_S = 3` inside the renderer, because the hyperspace
wind-up it says it reuses was not built; `hyperspace.ts` declares
`JUMP_CHARGE_S` now and cruise reads it, so a retune of one is a retune of both
and the two cannot drift into the second mechanic this paragraph refuses. What
is **not** shared is the state: the two windows are cancelled by different
things and end in different places, so each has its own countdown and the
flight floor's MODE cell prints `JUMP` for one and `SPOOL` for the other
(`galaxy-generation.md` §8.1).

Consequences handed to #8: interdiction is where hostiles reach a player in
transit, and without it they could only exist in the small volumes around the
arrival point and the station — which would make #6's radial danger gradient
nearly unreachable. The symmetric case is also what makes **piracy a player
activity**: you cannot rob a trader you cannot stop.

The contest's own design (what the player does, what skill it tests) is left to
#8, which owns combat mechanics.

---

## 5. Presentation

**Cockpit view retained** (#5's default), with a **restrained warp treatment** —
streaking and a colour shift, enough that the regime is unmistakable, not enough
to occlude the view.

The restraint is the point: the background layer is re-centred on the camera
every frame and has no parallax, so it does not move at 20 c. **All the sense of
speed comes from far-layer bodies sweeping past** — real motion from real
geometry, and the reason #6 generates scenery planets at all. A full-screen warp
tunnel would hide the one thing selling the speed.

### 5.1 The cruise HUD panel

The map's HUD constraint (velocity-vector marker plus attitude reference) is
satisfied **degenerately** in cruise, because §1 nose-locks velocity: prograde
sits permanently on the nose. The cruise panel therefore answers a different
question — *when do I cut the throttle* — and needs:

- selected target
- distance remaining
- **time-to-target**
- speed, in multiples of c
- drop-out indicator

### 5.2 Scanner

**The scanner must show other ships in cruise.** Without cruise contacts,
symmetric interdiction (§4) has no targets in either direction.

---

## 6. Navigation

**Free cruise**: the ship can point anywhere and go. Target selection is a
convenience that drives the readouts and the auto-drop, never a rail.

Target-locked cruise was rejected: it would make the system a menu with
scenery, and it forecloses three things already committed — chasing an NPC to
interdict it, running somewhere arbitrary to evade one, and choosing to go look
at a scenery body.

**An in-system map panel** provides selection and route preview. #6 made systems
multi-station (up to three stations plus 3–7 planets and a belt), which is
more than a target-cycling key handles well.

> **Scope note for #11.** The in-system map and the galaxy map are the same
> family of screens and share a vocabulary — selection, range, route preview, a
> 3D volume rendered legibly. One node should own that vocabulary rather than
> two inventing it separately. #11 is the natural owner; this spec asserts the
> requirement, not the design.

---

## 7. The drive charge

Cruise draws on **its own reserve**, not the hyperspace fuel tank.

| Property | Value |
|---|---|
| Capacity | **12 AU** of cruise range |
| Consumption | 1 unit per AU **travelled in cruise** (distance, not time) |
| Refill on docking | instant, free, any station |
| Passive regeneration | **~1 AU/min** while in normal flight |
| Fast recharge | sun-skimming, with fuel scoops (525 Cr) |

Distance rather than time is the honest unit: crawling slowly through a gravity
well already costs time, and metering by the second would charge twice for the
same detour. It also gives the gauge an obvious reading alongside the 7 LY jump
tank.

12 AU is roughly **nine typical legs** — enough that routine trading never
thinks about it, tight enough that a long tour of the outer system is a choice.

**Passive regeneration is the anti-stranding rule and is not optional.** Refill
at stations alone would strand a player who ran dry between them: 2 km/s with a
station an AU away is an unwinnable save. At 1 AU/min, running dry costs about
**eighty seconds** of waiting to buy enough range to reach a station, and twelve
minutes for a full charge. A penalty that is felt and never fatal.

Hyperspace fuel keeps its 1984 meaning untouched: 7 LY tank, 0.2 Cr / 0.1 LY
(14 Cr a full tank — `economy-trade.md` §6.1), a
jump resource only. Sun-skimming gains the second purpose it wanted.

---

## 8. Implementation notes

### 8.1 Sub-stepping is mandatory near the target

Per-tick displacement as a fraction of remaining distance is
`v·dt/d = v_max·dt·d^(−0.25) / d_ref^0.75`, which **grows as `d` shrinks**:

| Distance | Speed | Displacement per 0.1 s tick | Fraction of `d` |
|---|---|---|---|
| 1 AU | 20 c | 600,000 km | 0.4 % |
| 10,000 km | 7,450 km/s | 745 km | 7 % |
| 1,000 km | 1,327 km/s | 133 km | 13 % |
| 50 km | 140 km/s | 14 km | 28 % |

The integration itself is stable because the law is position-dependent, but the
**drop-out threshold and proximity tests must be swept, not point-sampled**, or
the ship steps straight past them. Rule: sub-step whenever `v·dt > 0.1·d`.

### 8.2 Cruise is the first thing to exercise the layer handoff

`HANDOFF_KM` has never been crossed by anything — `units.ts` says so explicitly,
and #3 left the exact distance an open question. Under this spec a body crosses
it at ~7,450 km/s and the last 10,000 km takes ~3.9 s: fast, but visible enough
that a scale pop would be seen. **This needs a browser probe** (apparent size
continuous across the handoff), and it is the evidence that would justify
revisiting `HANDOFF_KM` itself.

---

## 9. Verification

1. **Speed law** — `v(d)` matches the table in §2.3 at each sampled distance;
   clamped at both ends.
2. **Pacing** — simulated 0.2 / 1.3 / 6 AU legs complete within 10 % of 38 s /
   68 s / 186 s.
3. **No tunnelling** — a cruise line passing within one radius of a planet never
   places the ship inside it on any tick, at any `dt` up to `MAX_DT`.
4. **Sub-stepping** — the drop-out fires within 50 km ± 5 km for every approach
   in a swept parameter sweep; never skipped.
5. **Exit state** — velocity on exit is ≤ the assist cap and along the nose; the
   pre-entry assist state is restored.
6. **Drive charge** — consumption equals AU travelled to within rounding;
   regeneration restores 1 AU/min; a ship at zero charge in deep space can always
   reach a station (the anti-stranding property, asserted directly).
7. **Interdiction symmetry** — an NPC-initiated and a player-initiated
   interdiction resolve through the identical code path with roles swapped.
8. **Spool-up** — damage during cruise re-entry cancels it, in both the
   post-interdiction and voluntary cases.
9. **Layer handoff** (browser probe) — apparent size of a body is continuous
   across `HANDOFF_KM` during a cruise approach. §8.2.

---

## 10. Known weak joints

- **Every number here is derived, not felt.** The 68 s typical leg and the 0.75
  exponent are the two most likely to be wrong in play. That is what the
  prototype node is for, and the values above are its starting point, not its
  conclusion.
- **This is the largest build left on the map** — a third regime with its own
  dynamics, HUD, presentation, interdiction contest and resource. It was chosen
  over jump-only knowing that.
- **The in-system map is a second UI surface** committed before #11 has
  established what that screen family looks like. See the scope note in §6.


---

## 11. Amendments from #14 (flown)

#10 §10 said every number here was derived rather than felt, and named the
exponent and the 68-second leg as the two most likely to be wrong. Five flying
sessions with the principal produced six changes. They are recorded here rather
than by editing the arguments above, because what the spec *argued* is still the
reasoning the code answers to — and a spec quietly rewritten to match its
implementation records nothing.

### 11.1 Arrival is relative, and so is being stopped

A station on a 1 AU orbit is carried around its star at **~30 km/s** — fifteen
times #5's 2 km/s assist cap. Two consequences, both load-bearing:

- The drop-out threshold and §1's exit clamp are measured **in the
  target's frame**. Clamping absolute velocity leaves the target
  receding at 28 km/s, which normal flight can never close: the arrival
  succeeds and docking becomes impossible.
- The **flight assist** damps toward the nearest body within `NEAR_FAR_KM`
  rather than toward the star. Sim space is star-centred, so otherwise
  "throttle to zero" beside a station means stopping relative to the star while
  the station leaves.

**Binds [#9](https://github.com/jcfischer/seelite/issues/9):** docking happens
in that frame, and a docking spec written in star-centred velocities would be
describing a different problem.

### 11.2 The law reads the target too

§2.1's argument against a target-keyed law stands — it flies through worlds
between ticks — but the law is now `min` of the two distances. The mass distance
still bounds the curve, so nothing tunnels; the target distance only ever makes
the ship slower.

Without it, a station's approach speed is set by its *planet* tens of thousands
of km away, so the ship reaches the 50 km drop radius still doing thousands of
km/s. §2.3's arrival table is stated against a planet and does not describe an
arrival at a station.

### 11.3 The drop-out is swept, not sub-stepped

§8.1 already says "swept, not point-sampled"; this records what that costs.
Sizing the sub-step off the target as well as the mass does *not* work: closing
on a 50 km radius at 20 c needs more sub-steps every frame than the last, and
the run stalls a few thousand km short. The sub-step is sized for the speed
law's accuracy; the drop-out is a ray–sphere entry test.

### 11.4 A body's surface ends cruise

Not in #10 at all. The law slows an approach asymptotically and there is no
collision, so a ship pointed at a planet crawls inside it and out the far side —
which made flying through a planet the most effective brake in the game. Cruise
now drops out at `SURFACE_MARGIN × radius` (1.05), swept like the drop-out. A
grazing pass still passes, which is the other half of the rule.

> **Amended by #30 (§12.1).** The margin is right for scenery and wrong for the
> body a station orbits: 1.05 × radius is a shell the station itself is inside.

### 11.5 The approach clamp — the last 10,000 km

The largest mechanic #14 added, and the principal's own diagnosis: *"the drop out
doesn't happen automatically. I guess I never hit within 50 km."* A 50 km sphere
seen from 60,000 km subtends 0.05°, and a nose-locked ship cannot be hand-aimed
at it.

Widening the **drop radius** to 10,000 km was the obvious fix and is wrong for
§3's own reason — that radius is bounded from *below* by normal flight, and being
dropped 10,000 km out at 2 km/s is an eighty-minute crawl. So:

| Property | Value |
|---|---|
| Vicinity | 10,000 km (`vicinityKm`) — and it is `HANDOFF_KM`, where a body starts being drawn at 1:1 |
| Inside it | speed held to `distance / approachLeadS` **over the target's own motion** |
| Lead time | 3 s (`approachLeadS`) |
| Capture | a range that stops falling ends cruise there, **while closing speed is under the drop threshold** — at the defaults that is a pass inside ~600 km, not the whole vicinity. A wider miss is a course that did not go there, and the ship carries on |
| Cost | `lead · ln(vicinity / drop radius)` ≈ **15.9 s of every arrival** |

Steering stays the player's: this is a speed governor, not an autopilot, and #9's
docking is still the skill gate the trade loop is built around.

§3's "failure to slow means overshooting and looping back" therefore no longer
describes a straight-in approach. It still describes a pass that misses, which is
what the capture rule catches.

### 11.6 The tuned numbers

| Number | #10 derived | #14 flew | Why |
|---|---|---|---|
| `v_max` | 6.0 × 10⁶ km/s (20 c) | **23 c** | "nudge it so that time is slightly less than 60 s" |
| exponent | 0.75 | **0.60** | "0.6 or 0.75, but definitely not higher" |

Measured against §2.3's own 1.3 AU typical leg, with the clamp in force:
**59.0 s**. #10 predicted 23 c for a 60-second leg and rounded to 20 c on the
grounds that the figure would be tuned by flying; it was, and it landed on 23 c.
That is a coincidence worth naming rather than a vindication: the prediction was
made at exponent 0.75 with no approach clamp, and the 59.0 s was flown at 0.60
with a clamp that costs ~15.9 s — two different models agreeing on one number,
which is agreement, not confirmation. The exponent matters less than §2.2 assumed, because the clamp now governs
everything inside the vicinity — it shapes the mid-flight stretch, not the
arrival.

Which leg to benchmark was the principal's call: the leg he had been flying is
0.84 AU (49 s at these numbers), the spec's typical is 1.3 AU, and they are 55%
apart. `scripts/measure-cruise-pacing.ts` is the sweep both figures came from.

§2.3's table is still checked as *this document's* claim — `tests/cruise.test.ts`
keeps #10's parameters as a fixture — so retuning the defaults cannot quietly
restate what was argued here.

### 11.7 What #14 did not answer

- Whether the drop radius wants to be tighter or looser than 50 km now that the
  clamp flies the approach. It is a dial; nobody has preferred a value.
- Whether nearest-mass throttling reads as texture or nuisance. It never became
  a nuisance in five sessions, but it was also never the thing being judged.
- §5.2's scanner requirement, untouched: interdiction is
  [#8](https://github.com/jcfischer/seelite/issues/8)'s and stayed out of scope.


---

## 12. Amendments from #30 (flown)

Reported from play: *"I always get dropped at 10k km distance from the stations
— that's not ok to fly to."* Replaying full legs headlessly through the real
`advanceCruise` — the start system of 200 seeds, 417 legs — turned that into
three separate facts, of which §11.4's rule is only the first.

The instrument is `scripts/measure-cruise-arrival.ts`. The four-candidate
comparison #30 chose from is §12.1 below; re-running it needs the switch that
was not kept in the flight loop, and the **`node-30-candidates`** tag is where
that tree lives — commit
`a6359bec9c4d2f4634e8ec96f410971823b941b8`. The SHA names it; the tag is what
*keeps* it, since the branch was deleted on merge — delete the tag and the
commit is collectable and the SHA resolves to nothing.

### 12.1 A shell is scaled to the obstacle; a station is not

`SURFACE_MARGIN` clears the ship of a *planet* by 5% of that planet's radius,
while §7.3 of `galaxy-generation.md` puts a station 400–2,000 km above one. What
decides whether a distant ship can reach a station in a straight line is not its
orbital radius but its offset **across** the line of sight — an inbound leg at
1 AU is effectively parallel — and between `radius` and `1.05 × radius` that
offset is clear space the planet's shell nonetheless claims.

Measured: 36 of the 249 legs whose station was clear of its host ended against
the host anyway — 14% of those, 11% of every planet-orbiting leg — thousands of
km short and still doing thousands of km/s.

**The body a selected target orbits guards at `radius + HOST_CLEARANCE_KM` instead**
— 5 km, absolute, where every other body keeps `1.05 × radius`. It is
still an obstacle — a station genuinely behind its planet is still stopped — but
it no longer projects a shell its own station is inside. The exemption is scoped
to that one body: every other mass keeps `SURFACE_MARGIN`, or selecting a
station would make the whole system permeable.

The clearance is not zero, and §11.4's reason is why: the margin is 1.05 rather
than 1.0 so the ship is not left standing on a sphere it is being drawn the
inside of, and that does not stop being true for the body a station orbits. What
changes is that it is **absolute**, so it cannot scale into the altitude a
station is placed at. 5 km is 500× the near camera's 10 m near plane
(`NEAR_NEAR_KM`); swept against the corpus, 5 and 20 km cost nothing and 50 km
costs two of 249 clear legs, so it sits at the small end of the range that does
the job.

Two of the 88 occluded legs (2.3%) do now arrive, and it is worth saying why
rather than filing them as slop. The classification is a **snapshot at leg
start**, and both are marginal: the straight line clips its host by 7 km and by
61 km, against hosts of 5,866 and 7,300 km. Over a ~70 s crossing the station
moves out from behind, and by the end of the leg the same line passes 132 km and
81 km *clear*. Nothing tunnels to reach them — the instrument reports the
deepest penetration over every leg, ungated, and it is **0.000 km across all
417**.

| Leg class | Arrived before | Arrived after | n |
|---|---|---|---|
| Station clear of its host | 85.5% | **98.4%** | 249 |
| Station occluded by its host | 0% | 2.3% | 88 |
| Star-centric (no host) | 100% | 100% | 80 |

Three candidates were flown and rejected, with the figures in #30:

- **`radius + 300 km`**, an absolute clearance. Reaches 96.0% of clear legs
  against 98.4%, and is a second constant to size against a minimum altitude
  that `system.ts` owns.
- **Exempting the host entirely.** 100% arrival, by flying up to 6,900 km inside
  the planet on 22% of legs — §11.4's brake, handed back for exactly the world
  the player most wants to shed speed at.
- **Letting the drop sphere win where it lies nearer along the ray.** Measured a
  **no-op**: byte-identical in every column, because an unreachable station is
  never nearer along the ray. It is *behind*.

### 12.2 A station inside its own host's shell could not cruise out of it

`sphereEntry` returns 0 for a step that *starts* inside the sphere, so a ship
already inside a shell was dropped on the first sub-step of every engagement,
**whatever heading it took**.

That is not a corner case. A station orbits 400–2,000 km up and the shell is 5%
of the planet's radius, so a station is inside its own host's shell whenever its
altitude is under `0.05 · R` — which is a draw, not a threshold: it depends on
where in 400–2,000 km the altitude landed as well as on `R`. Measured rather
than derived: **49 of 337 planet-orbiting stations in the corpus**, hosts from
25,611 to 70,305 km, all of them gas giants — though not *every* gas-giant
station, which is 49 of 55. Every one is a place cruise could not be engaged
from. Leaving the worst — a shipyard 2,784 km inside a 65,977 km giant's shell —
meant crawling that gap in normal flight first: **23 minutes at the 2 km/s
assist cap**.

So the guard fires on **crossing inward**, not on being inside — and "inward"
is *does this heading go deeper into the body*, not *is the centre ahead of me*.
From inside a shell the surface subtends less than a hemisphere, so a
centre-ahead test releases the radial heading and pins every heading around the
limb, which are the ones a ship beside a world wants.

It is measured against the **true surface**. A stop leaves the ship *on* the
guard volume's boundary, so testing the release against that same boundary is a
tangent test at the start point: every heading with the centre ahead reads as
entering, and the outward hemisphere is all that is left. `tests/cruise.test.ts`
covers that case, which is the durable form of it — the variant that showed it
across most of the corpus was measured and discarded, so no figure from it is
quoted here.

**The cost is new, and it is not §11.4's grazing pass.** That one is a pass
*outside* the 1.05 shell, which the shell was never going to stop. This is a
ship already inside a shell, released onto a chord that dips toward the true
surface — `tests/cruise.test.ts` pins one at 1.01 radii, well inside the shell
§11.4 stops at. #30 admits that where §11.4 did not; the trade is that the
alternative pins a stopped ship where it stands.

A heading that *does* go deeper is stopped **where the ship already is**, not
where the ray meets the surface. Stopping at the surface was #30's own blocker,
caught in review: it walked a ship inside a shell down to zero altitude.

So the promise is narrow, and worth stating as such: **the guard never aims a
ship inside the body, and never takes away clearance the ship still has when it
stops.** Not "never lets it near one", and not "a ship inside a volume never
gets deeper into it" — a chord that dips and misses is released and does lose
altitude, which `tests/cruise.test.ts` flies.

*Aims*, not *lets*, and §12.4 is why: the test is a snapshot, so a released
chord can still end up inside a body that moved into it. One leg in 90 does,
measured. A rule about rays cannot promise an outcome about a moving world.

The corpus flies six headings from 0° to 110° off the outward radial and counts
what happens rather than predicting what should: **0 of 90 stopped legs have no
way out**, a median of 3 headings fly, and the best of them covers a
median 1.4 million km in five seconds. Aimed back at the occluded station a re-engagement is still
stopped, and should be — that is also the one leg that exercises the in-place
stop.

What that leg shows, and it is the figure this amendment rests on: **43 of 90
re-engagements used to end on a surface; 1 does now**, and that 1 is §12.4's.
Measured at 200 seeds, on clearance **at the point the leg ended** — not the
minimum over its path, which is a different question. The before-figure came
from running this column against `main`'s `cruise.ts` by hand, since the column
is new here; the sweep prints only the live one and points here for the rest.

The *minimum* clearance cannot show any of this: §12.4's leg pins it at
−1.041 km on both builds. Primary legs are a separate population and bottom out
at 5.000 km.

**What this is not.** From the radial heading alone it looked like "being
stopped is terminal" — a second cruise there covers 1 km, in 124 legs out of 124. It is
not: a ship dropped *at* a shell sits on its boundary, and the 2.5 s spool-up
carries it clear before cruise takes. `probe-arrival.mjs` found that check green
against the old rule too, which is how the overclaim was caught. The drop-point
figure measures the sweep, not the game.

### 12.3 A quarter of all legs are occluded, and no straight-line rule reaches them

**26.1%** of legs to a planet-orbiting station have the host between the ship
and the station at leg start. That is not a tuning failure; it is where the
station is.

The rate is a function of `r/R` alone: for an effectively parallel bearing the
station is hidden when it is behind and its offset across the line of sight is
under `R`, which is `½·(1 − √(r²−R²)/r)`.

**That closed form assumes the line of sight is isotropic to the orbit, and it
is not.** The instrument prints the prediction beside the sampled rate rather
than instead of it, and they part by 2–4 points, consistently and in one
direction. The mechanism is not asserted — it is isolated:

| | Occluded |
|---|---|
| Isotropic form, `½·(1 − √(r²−R²)/r)` | 23.80% |
| Same form with each station's own sight line | **25.85%** |
| Sampled over every orbit phase | **25.84%** |

The informative comparison is **row 1 against row 3**: 2.04 points, and that is
what the assumption costs. Row 2 is the same closed form with the assumption
removed, evaluated per station, and its agreement with row 3 to 0.01 of a point
is *self-consistency* — an exact integral against a 64-phase sample of the same
geometry, which could only diverge through a convention bug. It is worth
printing for that reason and not as independent confirmation: it says the 2.04
is attributable to the assumption rather than to an error in either.

For one circular orbit the fraction is `arccos(k)/π` with
`k = √(r²−R²)/(r·√(1−c²))` and `c = |cos|` between the sight line and the orbit
normal — zero once `k ≥ 1`, because a sight line near the pole never passes
behind. Averaged over an isotropic `c` it collapses back to the row above it.

Why the sight line is not isotropic: `aroundBody` copies the planet's own
inclination, so every station in a system orbits in nearly one plane, and the
host sits near that plane while the ship arrives only ~1 AU out — so
`host → ship` lies near it too. Edge-on, which is where occlusion is highest.
Mean `|cos|` is **0.429** against 0.500.

(The first answer written here was finite-distance geometry — "the shadow is a
cone rather than a cylinder". That is wrong and worth recording as wrong: the
sampled test is itself a parallel-ray one, so cone geometry cannot enter it, and
at station scale against 1 AU the correction would be ~0.05 points rather than
2–4.)

The projection table below uses the **isotropic** form, so read it as a lower
bound. *How much* of a lower bound varies by radius and is not the corpus-wide
2.04: the by-host-size table above prints the sampled rate and the prediction
side by side, so the correction for a given host is the difference on
its row — 2.0 points on rocky worlds, 3.6 on the 10,000–30,000 km band, 1.9 on
giants. Those rows are **host-radius** bands, not `r/R` bands, and `r/R` varies
inside each one because the altitude is absolute; they bound the correction
rather than key it.
Re-measure before committing to a number from it.

`system.ts`'s 400–2,000 km altitude lands very differently by host size:

| Host | Median r/R | Occluded, sampled | The form predicts |
|---|---|---|---|
| Rocky, R < 10,000 km | 1.239 | 22.9% | 20.9% |
| 10,000–30,000 km | 1.050 | 39.1% | 35.5% |
| Gas giant, R > 30,000 km | 1.026 | 41.2% | 39.3% |

| If every station orbited at r/R | 1.05 | 1.25 | 1.5 | 2.0 | 3.0 |
|---|---|---|---|---|---|
| Occluded, at least | 34.8% | 20.0% | 12.7% | 6.7% | 2.9% |

Every worst-case leg in the corpus is a gas-giant shipyard, up to 141,000 km
short. **The lever is the orbital altitude, which belongs to the generator, not
to cruise** — carried as its own node under #30 rather than resolved here.

### 12.4 The moving-body guard

**The guard is relative motion, over one explicit frame timeline.** At frame
start the game snapshots each mass and the selected target: position, analytic
velocity and a conservative acceleration magnitude. `advanceCruise` evaluates
the ship and those linearised bodies at the same sub-step time. Only after that
pure step returns does the game advance the world clock once to the frame end.
There is no clock read inside the sweep and no second clock advance.

The collision ray uses ship velocity minus body velocity. A body's guard radius
is expanded by `0.5 · a · dt²`, the tangent-deviation bound for the current
circular-orbit model, plus a coordinate-scale float64 tolerance. The station
arrival sphere contracts by the same uncertainty, because a surface is an
exclusion promise while arrival is an inclusion promise. Existing host and
non-host radii, the speed law, the drop radius and the arrival-speed threshold
remain the inputs. The earliest physical event wins across every mass and the
station; a surface wins an exact tie, so arrival cannot license tunnelling
through its host.

Starting inside a guard shell is not itself a stop. The relative heading must
go deeper than the true surface (with the same error allowance), so outward and
safe grazing headings remain releasable. Zero relative speed is released while
the ship is only inside the wider shell; a co-moving ship already at or below
the true-surface exclusion stops. The moving-body sweep still runs at zero
throttle and with exhausted charge, which
closes the old early-return hole where a body could cross a stationary ship
between two endpoint samples.

A proximity event ends powered travel at its event time, then carries the ship
with the blocking body's velocity through the unconsumed part of the frame.
Only the powered segment counts against drive charge. Normal flight receives
that same blocking-body velocity and holds that one body's frame while the ship
is within `NEAR_FAR_KM` of its surface. This scoped handoff matters for a giant
whose centre is farther than `NEAR_FAR_KM`; ordinary nearest-centre frame
selection is unchanged everywhere else, and a new cruise engagement clears the
handoff.

Here **drive charge** means §7's distinct 12 AU in-system cruise reserve. The
term is intentional: it is not the separate 7 LY **Hyperspace tank** used for
inter-system jumps.

`measure-guard-motion.ts` flies the production integrator over seeds 1–200 with
one frame-start convention. It measures the full linear relative sweep of every
integrator segment and the exact orbital endpoints; curved motion inside a
frame is protected by the bound above rather than directly sampled. At
`MAX_DT = 0.1 s` it reports **370/416 arrivals**, **299/302 initially
clear-of-host arrivals**, **46 stopped legs**, zero timeouts, zero stops without
an escape heading that finishes outside the blocker's guard without another
proximity stop, and at least **5.000000 km** across those linear-sweep and exact
endpoint samples over primary, retry and sampled escape paths. The median stop
has three of six such escape headings and
a best five-second escape of 1.366 million km. The eight decision
fixtures and production tests additionally bind moving interception, outward
release, a receding tangent, shared-frame invariance, mid-step crossing,
post-stop carry, multiple blockers, and 30/60/120 Hz plus `MAX_DT` behaviour.


- The occluded quarter. Raising station orbits is measured above but not
  decided, and it moves the `station-orbits.json` baseline.
- What the player should be *told* when a planet stops them. The drop is honest
  and unexplained; the HUD says nothing about why.
- Whether the 2 km/s assist cap is the right speed to be left with beside a
  planet. §3 bounds the drop radius by that cap, and every argument about the
  crawl is really an argument about it.
