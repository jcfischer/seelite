# Spec: in-system travel

**Status:** resolved decision node — [#10](https://github.com/jcfischer/seelite/issues/10)
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

Speed scales with distance to the **nearest star or planet** — not to the
destination, and not counting moons, stations or belts.

```
v(d) = clamp(v_max · (d / d_ref)^0.75, v_min, v_max)

  d      = distance to the nearest star or planet, km
  v_max  = 6.0 × 10⁶ km/s   (20 c)
  d_ref  = 0.5 AU = 7.4799 × 10⁷ km
  v_min  = 100 km/s          (safety floor; the drop-out fires well above it)
```

### 2.1 Why nearest-mass and not destination

At 20 c the ship covers **600,000 km per 0.1 s tick** (`MAX_DT` in `main.ts`).
A planet is ~6,000 km across. Under a destination-only law the ship would
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

Destination-locked cruise was rejected: it would make the system a menu with
scenery, and it forecloses three things already committed — chasing an NPC to
interdict it, running somewhere arbitrary to evade one, and choosing to go look
at a scenery body.

**An in-system map panel** provides selection and route preview. #6 made systems
multi-destination (up to three stations plus 3–7 planets and a belt), which is
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

Hyperspace fuel keeps its 1984 meaning untouched: 7 LY tank, 0.2 Cr/LY, a
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
