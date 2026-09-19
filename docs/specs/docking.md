# Spec: docking

**Status:** resolved decision node — [#9](https://github.com/jcfischer/seelite/issues/9)
**Date:** 2026-08-19
**Inputs:** [#4](https://github.com/jcfischer/seelite/issues/4) (Elite-1984 mechanics),
[#5](https://github.com/jcfischer/seelite/issues/5) (flight model),
[#10](https://github.com/jcfischer/seelite/issues/10) / [#14](https://github.com/jcfischer/seelite/issues/14) (in-system travel, flown),
[#13](https://github.com/jcfischer/seelite/issues/13) (station types),
[#7](https://github.com/jcfischer/seelite/issues/7) (economy)
**Binds:** [#8](https://github.com/jcfischer/seelite/issues/8) (combat and legal status),
[#148](https://github.com/jcfischer/seelite/issues/148) (station traffic),
the unowned HUD node

Decided with the principal in a grilling session on node #9; six decisions, one
at a time. The numbers below that were not decided in that session are derived
here and marked as such, so a later reader can tell a choice from a consequence.

---

## 0. What this owns, and what it does not

**Owns:** the docking checks and their tolerances; the closing-speed gate; the
failure model; **what a successful entry does** (§12); station spin range and
dockable geometry; the clearance protocol; and the docking computer's behaviour.

**Does not own:** which interactions exist and which type gets which — #13 §6
settled that at two, and this spec builds two. Nor the legal-status predicate
behind the shipyard scan or the absolute damage scale (both #8), nor station
traffic (#148);
nor the equipment price table (#7 §equipment, unamended by this spec); nor the
HUD (fog — §8 records what it owes docking without designing it); nor the
**collision system** (§12.3 states the boundary and hands it on); nor what the
player *sees* once docked, which is the market-screen question (#70).

**§12 was added after this spec was built and flown** (#73, 2026-08-27). The
first version owned the failure completely — §2.0 specifies a repel down to the
sign of a velocity component — and gave the success case a boolean. Flying it
found the ship stopping dead at the aperture plane and hanging there, which was
not a defect against this spec but the shape of its silence.

---

## 1. The problem this is not

The 1984 docking test was a *hand-aiming* problem: five checks at the end of a
long unassisted approach, with death on failure. seelite's arrival is already
solved before docking starts, and by something else:

| Stage | Owner | What the player has when it ends |
|---|---|---|
| Cruise leg | #10 §2 | speed law scaled by the nearest mass |
| Vicinity, inside 10,000 km | #14 §11.5 | speed held to `distance / 3 s` **over the target's own motion** |
| Capture | #14 §11.5 | a pass inside ~600 km at low closing speed ends cruise there |

So the player is handed to docking **near and slow, in the station's frame** —
not aiming at a 0.05° dot from 60,000 km. #14 said it plainly: the approach
clamp *"is a speed governor, not an autopilot, and #9's docking is still the
skill gate the trade loop is built around."* This spec designs that gate on the
assumption that arrival is not part of it.

**Everything below is measured in the station's velocity frame** (#10 §11.1). A
station on a 1 AU orbit is carried at ~30 km/s, fifteen times #5's 2 km/s assist
cap; a tolerance written in star-centred velocity describes a different game,
and #10 recorded that as binding on this node before it was written.

---

## 2. The failure model

**The success case is §12.** This section is the failure half and nothing else;
the two were written eight days apart and the asymmetry misled a reader once
already, so the pointer is here rather than only in §0.

**Decision D1: a failed entry damages the ship. It does not destroy it.**

Oolite's fix, and what research §5.1 recommended adopting: *the skill is worth
keeping, the punishment level isn't.* 1984's death-on-failure is rejected —
against a browser game's session length, and against permadeath being an
open question on the map, an instantly-fatal minigame at the end of every trade
run is a punishment the rest of the design cannot pay for.

This has a consequence the tolerances then have to carry: **with failure
survivable, the tolerances are the only thing left holding the skill tax.** They
are not free to be generous merely because failure is now cheap.

### 2.0 What a failed entry *does*

Damage is not the whole outcome, and leaving the rest unstated would let two
implementations disagree about where the ship ends up while both satisfying this
spec. A failed entry:

- **repels**: the ship is placed just outside the slot plane with `v_axial`
  reversed and halved, in the station's frame — it bounces off, it does not pass
  through and it is never left inside the station;
- **keeps the clearance grant**, if one was live and unexpired. Failing the
  geometry is a piloting error, not a protocol violation, and making the player
  re-request after every bounce would turn §6 into paperwork;
- **does not turn the station hostile** — only the missing-grant case does (§6).

### 2.1 Damage shape (derived), scale (#8's)

On a failed entry, damage is applied to shields first and hull after:

```
damage = DAMAGE_SCALE · max(FLOOR, (|v_rel| / V_GATE)²)      FLOOR = 0.25
```

`DAMAGE_SCALE` is #8's, because it is denominated in #8's shield and energy
pools. Two properties of the shape are fixed **here**, because they are what
makes D1 true rather than aspirational:

1. **At `v_rel = V_GATE`, a failed entry from full health is survivable with
   margin** — at most a quarter of the head-on pool, the fore shield and the
   hull (#324; an entry meets the fore shield, see §10). This is
   D1 as a checkable predicate, and #8 inherits it as a bound on
   `DAMAGE_SCALE`, not as advice.
2. **There is a floor, because pure quadratic scaling makes failure free.** A
   90°-mis-rolled entry at 0.01 km/s would otherwise cost 1% of the gate-speed
   damage — under a quarter of a percent of the pool — so a patient pilot could
   fail checks 2, 4 and 5 indefinitely at no cost, and §2's claim that the
   tolerances carry the skill tax would be false for anyone who crawled. The
   floor puts a failed entry at a minimum of a quarter of the gate-speed damage
   whatever the speed, so **the alignment checks cost something on their own**
   rather than only in combination with speed.
3. **It is quadratic above the floor, so recklessness still kills.** Hitting the slot at the
   2 km/s assist cap is 20× the gate and therefore 400× the damage. Death
   returns as the outcome of flying at a station rather than as the default
   outcome of a missed roll — which is the distinction D1 was actually drawing.

---

## 3. The checks

**Decision D2: four checks, widened, plus a closing-speed gate.**

1984 ran five (research §4). Two of them — the ~26° nose-vector test and the
~22° approach cone — ask the same question, *am I on the axis*, one from the
station's side and one from the player's, so D2 folded them into a single
alignment concern. **They fold, they do not collapse**: §3's check 2 still
evaluates attitude and position separately, at one shared tolerance, because a
cone that constrains only position says nothing about where the ship points.
Two further rows below were not in D2 and are not decisions — check 5 closes a
hole in the checks as decided, and §3.1's gate is D2's own.

Throughout, **`v_rel` is the relative velocity *vector* in the station's frame**,
`v_axial` its component along the docking axis, and `|v_rel|` its magnitude. The
gate and the damage formula both read `|v_rel|`; check 3 reads the sign of
`v_axial`. Naming them apart matters: an entry at 0.05 km/s axial and 1 km/s
lateral passes one reading and fails the other, and takes 0.25× or 100× the
damage depending on which an implementer picks.

| # | Check | Tolerance | 1984 |
|---|---|---|---|
| 1 | **Not hostile** | `station.hostile === false` | bit 7 of byte 32 |
| 2 | **Axis alignment** — **both** the station→ship vector **and** the ship's nose, each against the docking axis | ≤ **35°** each | 26° nose + 22° cone, merged |
| 3 | **Inbound** — the axial component of `v_rel` points into the slot | sign test | sign of z |
| 4 | **Roll match** — ship's up-vector against the slot's short **axis-line**, in the slot plane, acute angle mod 180°, so the ship's *beam* lies along the long one | ≤ **50°** | 33.6° |
| 5 | **Containment** — the crossing point lies inside the aperture rectangle, in the slot's rolled frame | inside | implicit in the hull |
| 6 | **Closing speed** `|v_rel|`, in the station's frame, at the moment of slot-plane crossing | ≤ **0.10 km/s** | *had no such check* |

All six are evaluated **at the instant the ship crosses the slot plane**. A
failure of any one is a failed entry (§2).

**Check 5 is not redundant with check 2, and its absence was a hole.** An angular
cone is not a containment test: at §5's 0.6 km core radius, check 2's 35° admits
about 0.42 km of lateral offset — four times the slot's half-length — so without
check 5 a ship flying squarely into the *hull face* satisfies every angle, every
sign and the gate, and docks through solid structure.

**That justification does not survive collision, and the check does** (#73,
§12.3). Once the hull is solid, the ship in the paragraph above stops at the
hull and never reaches the plane, so check 5 stops being the thing that prevents
the failure and becomes defence in depth behind a system that prevents it
earlier. Keep it: the plane is a mathematical construct and a collision mesh is
an approximation of a drawn shape, and the two agreeing everywhere is an
assumption rather than a guarantee. But when collision lands, the browser probe
for this row (§9.2.4) is measuring a collision, not a failed entry, and it must
be re-pointed rather than left to pass for a reason that has moved.

**Check 4 compares against the axis-*line*, not an oriented vector.** The slot is
a 0.12 × 0.07 km rectangle, so a ship rolled 180° is a geometrically identical
entry; an oriented-vector comparison would reject it for no physical reason.

Two consequences of *that instant* being the evaluation point, both of which
decide implementations:

- **Check 2 is two angles, not one.** A purely positional cone constrains where
  the ship *is* and says nothing about where it points, so a ship translating up
  the axis while facing 90° off would pass everything — check 4 only measures
  roll. Under #5's assist, lateral drift decays and velocity tends to follow the
  nose, which is exactly why the attitude term must be written down rather than
  assumed: it is a property of one flight mode, not of the geometry.
- **Check 3 is a velocity sign, not a position sign.** At the crossing instant
  the axial *position* is zero by construction, so a side-of-plane test has no
  defined answer there — and §9.1.1 requires boundary rows.

**And it is the *short* axis-line, corrected in #157.** This row said "long"
from #9 until #158, and the implementation matched it — so a ship at a perfect
roll put its 11.7 m height across the 120 m side and its 51.2 m beam across the
70 m one, and flew the slot on its side.

It survived because the aperture's *size* cannot discriminate. At the 50° limit,
over #35's roster, both readings admit every non-capital hull: beam along the
long side needs 62.8 m across and 63.4 m up, for margins of 57.2 and 6.6 m
against a 120 × 70 m slot; transposed it needs 63.4 and 62.8, for margins of
56.6 and 7.2. The tightest margin moves by 0.6 m on a 70 m dimension, and no
check in the repo reads it.

**One frame appeared to argue the other way, and did not.** `arrival.ts` recorded
a docked ship "lying crossways in its own slot with the name shield running
vertically up the canopy", and took it as evidence for `across`. A shield's
orientation is not evidence about a ship's roll, whichever shield it was: both
are mounted on station geometry and neither turns with the ship — the mouth
plate rides the station mesh's own local X (`station-mesh.ts`), and the bulkhead
plaque a parked ship reads sits square to the bay's end wall
(`station-interior-mesh.ts`). Which one that frame showed is not recoverable and
does not need to be. An observation of a station fitting was read as an
observation of an attitude.

What settled it is that `tests/aperture-fit.test.ts` sizes this opening with the
hull's beam along the long side, and §5's 0.12 × 0.07 km was ratified from that
measurement — so the row was disagreeing with the reading its own dimensions
came from.

**Neither the 50° of §3.2 nor §5's 0.12 × 0.07 km moves with the correction.**
The tolerance is an angle magnitude against an axis-line and only the line it is
measured from changed; the dimensions were ratified from the surviving
convention. `tests/roll-reference.test.ts` holds the pose check 4 scores as a
perfect roll against the extents `tests/aperture-fit.test.ts` sizes this opening
from — at zero roll and again at the 50° limit, where the `w·cos θ + h·sin θ`
arithmetic is what the fit test actually reads. That comparison did not exist:
`probe-dock-arrival.mjs` compares the drawn slot with `slotBasis`, which is the
axis question, and nothing compared a ship pose with a slot at all. Both files
read the beam off `tests/helpers/rolled-envelope.ts`, so the two halves cannot
be re-transposed one at a time.

**Check 4 does not apply to the refinery pad** — that is the whole of #13 §6's
"the second is *genuinely easier* rather than merely different". Dropping the
roll match removes the hardest axis and nothing else changes, so the pad
interaction is this table minus one row. Removing the roll match from the *slot*
would collapse the two interactions into one and reopen #13 §6; it is not
available as a later simplification.

### 3.1 Why 0.10 km/s (a mnemonic, not a mechanism)

The gate is the one dimension 1984 never tested, and it is added because #5's
flight model made it testable: throttle commands speed, so "arrive slow" is a
thing a player can actually do rather than a thing they can only hope for.

`0.10 km/s` is chosen, not derived — but it is chosen to *rhyme* with #14's
approach clamp rather than picked off a shelf. The clamp is

`targetKm / approachLeadS` (`approachLeadS`, `src/cruise.ts`, = 3) —
evaluated at a target range of 300 m, extended past the vicinity into the last
three hundred metres. A player who flies the final approach under the same law
cruise used to deliver them passes the gate without being told the number.

Braking to it from the 2 km/s assist cap costs `(2² − 0.1²) / (2 · a)` with `a`
the **hull's** acceleration, `thrustMN / massT` (`src/hull.ts`, derived in
`sim.ts`). For the baseline courier `a` is 2.0 km/s² — #5's tuned figure — and
the run-out is **1.0 km**, most of a trade station's 1.2 km width of runway.
That is visible at approach range, and it is the reason the number is not
tighter.

**It is a per-hull figure since #181**, and the sluggish end of the roster is
where it bites: the miner accelerates at 1.0 km/s² and needs **2.0 km** to shed
the same speed — 1.7 times the station's own width. Nothing is
broken by that (the gate is a speed at the plane, not a stopping distance, and
§7's autopilot never runs the approach at the cap), but a pilot who flies a
freighter the way they flew a courier arrives fast. The gate stays one number
for the whole roster; what varies is how early you start slowing down.

The clamp itself is cruise-only, so this coherence is a mnemonic, not a
mechanism. **Confirm by flying it** (§9.2) before treating 0.10 as settled;
it is the number in this spec most likely to move.

**Flown, by a script, on 2026-08-27** — and that is a weaker result than the
paragraph above asks for, so it is recorded as what it is. `probe-docking.mjs`
crosses the plane under §5's real geometry three times and **asserts the
measured `|v_rel|` at the crossing**, not the setpoint it asked for: 0.0905 km/s
with the roll 90° out, 0.0505 km/s on the hull-face run, and under the gate on
the docking computer's own dock. Check 6 passes in all three.

What that establishes is that the gate is *reachable* by an approach flown under
#5's assist rather than only on paper — and it took two attempts to establish
even that, because the first version of the probe wrote `ship.vel` directly and
the assist cancelled the whole commanded closing speed inside one step.

What it does not establish is that 0.10 is the right number. A scripted approach
has no difficulty, and the question §11.4 records is whether a **person** can
hold it. Nothing here has asked one, and the game ships with the docking
computer fitted, so the first approach anyone flies is not a person's either.
The figure stays provisional.

### 3.2 Why 35° and 50° (chosen, not derived)

Stated plainly because §2 claims the tolerances now carry the whole skill tax,
and a claim like that cannot rest on numbers with no account of themselves.
**This is a loosening, and an earlier draft of this section obscured it.** That
draft argued 35° was the price of *merging* two checks into one — but §3 does not
merge them: check 2 tests position and nose separately, at 35° each. So the real
change is **26° → 35° on attitude (+35%) and 22° → 35° on position (+59%)**, and
50° is 33.6° + 49%. Nothing derives those.

What can honestly be said for them:

- The 1984 widths were tuned for a keyboard-flown ship in an exterior-ish view
  with a dedicated docking display. seelite defaults to the cockpit with the hull
  hidden (#5), flies on mouse (#21), and — until the HUD node lands (§8) — offers
  **no visual referent for either angle at all**. Tolerances set against
  instruments that do not exist yet should be set wide and tightened later, not
  the reverse.
- 50° survives §4's arithmetic as a test: at the fastest spinner it is still a
  5.6 s non-tracking window, so widening it did not remove the skill.
- Check 5's containment row (new in §3) takes some load off check 2 that the
  angular cone was carrying alone — which is an argument for the wider cone
  rather than a coincidence.

**The counter-reading stays live**: that D1 made failure cheap and every
tolerance loosened in the same breath. This section does not refute it. §11
records all three numbers as provisional, and if flying says 28° and 40°, the
spec was wrong here and nowhere else.

---

## 4. Spin: the difficulty dial

**Decision D3: `spinRpm` draws uniform on [0.6, 3.0] for the two Coriolis
types, 0 for the refinery pad — wide, and uncorrelated with anything.**

#13 §6 required the field and handed its range here, saying the range *is* the
difficulty dial (#13 §8.4 restates the obligation). What spin costs is that the roll match must be **tracked**
through the final approach rather than set once:

| spin | °/s | Non-tracking roll window (100° of arc) |
|---|---|---|
| 0.6 rpm | 3.6 | 27.8 s |
| 2.0 rpm | 12.0 | 8.3 s |
| 3.0 rpm | 18.0 | 5.6 s |

The window figures are the penalty for flying in flat. A player who tracks has
no window at all — the baseline courier's roll peaks at 1.4 rad/s (80°/s,
`REFERENCE_ANGULAR_MAX.roll`), four times the fastest spinner, and #21 gave
rotation momentum, so holding a matched rate is a control problem rather than a
reflex one.

**Roll rate is a hull property since #181**, so "four times the fastest spinner"
is the baseline hull's margin and not the roster's. The miner peaks at 29.5°/s,
1.6× a 3 rpm spinner; the interceptor at 103°/s, 5.8×. `tests/hull-docking.test.ts`
flies every hull at every role across the whole 0.6–3.0 rpm range, and then — at
**both** turning roles, because a trade station and a shipyard cut their
apertures at different planes into different interiors — finds the spin at which each hull
**first** fails. The worst is the freighter, which first fails at 6.5 rpm at a
trade station and so holds 6.0 — two times the fastest station the generator
builds.

*First* failure, because the curve is not monotone: flown out to 24 rpm the
courier fails at 13.5 and then docks again at thirteen scattered rungs above it.
Those are coincidences rather than capability — check 4 admits ±50° of roll
error, so once a hull cannot track the phase at all, whether the crossing lands
inside a 100°-wide window depends on where the aperture happened to be. Below the
first failure every rung docks, which is the property the margin rests on. So §3's tolerances stay one
table rather than becoming a per-hull one — which was the open question #26's D5
left, and it is settled by measurement rather than by assumption.

**The spread is the point, and it is not softened.** A 5× range means docking
difficulty is a felt property of the station you chose, and a 3 rpm spinner is a
place you notice. `uniform(0.6, 3.0)` puts **41.7%** of Coriolis stations above
2 rpm, so the hard end is common, not a rarity.

**It is uncorrelated with tech level or government** — a correlation was on the
table and was rejected. So a 3 rpm station can be the player's second-ever dock.
That is accepted, not overlooked: under D1 it costs damage and a second attempt
rather than the run, and the correlation cascade (#6) is already dense enough
that adding difficulty to it would make one more thing predictable from the
system record. **What that damage then costs to undo is unowned** — see §11.5.

### 4.1 Slot phase is a sim quantity

Check 4 needs the slot's current roll, and the repo's rule is that *the scene
graph is display only, and nothing reads a position back out of an `Object3D`*.
So: **slot phase is `f(spinRpm, gameTime)`, computed in sim, and the renderer
mirrors it.** Without this sentence the obvious implementation is to read the
phase off the rendered station, which is the same class of error the rule exists
to prevent — and here it would make the docking checks depend on frame timing.

### 4.2 The slot spins in place

Worth stating because it decides whether the roll match is a match or a chase:
the Coriolis rotates **about the axis through the slot face**, so the slot's
centre sits on the spin axis and rotates in place. Rim speed — 0.19 km/s at
3 rpm and §5's radius, nearly twice the closing-speed gate — never enters the
entry problem. A slot placed off-axis would turn check 4 into a lateral
intercept at above-gate speed, which is a different and much harder game.

---

## 5. Dockable geometry

`Station` has no physical size today; `sim.ts` records that *"#9 owns their
actual geometry"*. Fixed here, per type, as a `Record<StationType, …>` table
for #13 §8.5's reason — a fourth station type stops the build until the table
answers for it.

| Type | Dockable core radius | Aperture plane | Aperture | Axis |
|---|---|---|---|---|
| trade station | 0.6 km | 0.428 km | slot, 0.12 × 0.07 km, on the spin axis | toward the parent body (1984's "face nearest the planet") |
| shipyard | 0.6 km (Coriolis core) | 0.372 km | identical slot | toward the parent body |
| refinery | 0.4 km (drum) | 0.396 km | pad, 0.15 × 0.15 km | radially outward from the star |
| outpost | 0.15 km | 0.165 km | pad, 0.12 × 0.12 km | radially outward from the star |

**The plane is not the core radius, and the two are a column apart because they
answer different questions** (#128, 2026-08-29). The core radius is the body's
`radiusKm` — what it is drawn one of across, what the scanner and the layer rule
read. The **aperture plane** is where §3's six checks are evaluated, and it has
to be the surface the slot is actually cut into.

They were the same number until a ship was watched crossing the plane **173 m
before it reached the slot it could see**: a cuboctahedron's circumradius is its
*vertex* radius and its square faces sit at `r/√2`, and cutting the slot into a
real flat square face is the trade form's thesis. Everything §12 measures from
the plane — the throat, the docked position — therefore landed behind everything
the player was looking at, and the throat had to be 280 m deep to reach back past
it. Reported flying it as *"the tunnel is skewed in relation to the docking
port"*.

**"The surface the slot is cut into" is not exactly where the plane sits, and the
gap is the frame's** (#162, 2026-08-31). The declared plane is where the
aperture's four bars stand, and on **ten** of the twelve forms that is flush with
the surface behind them. Two are not: the trade Coriolis's frame stands **25 m
proud** of its hull face — #128's own 6%, bridged by that form's coaming — and
the refinery Warren's stands **20 m** proud of its outermost terrace. So a cut
placed at the declared plane would leave both of those a hole hanging in front of
their own hull, and the cut is keyed on the surface rather than on the plane.
`scripts/measure-aperture-cut.ts` prints the frame plane, the surface, the
stand-off and the surface's name per form — the figures above are its output, not
a derivation beside it.

`STATION_GEOMETRY.aperturePlaneKm` is one number that both tiers read: the frame
the checks run in is built from it, and the selected form of each role cuts its
aperture at it. A form is free to have no surface there — the workbench
alternates do not — and `tests/station-mesh.test.ts` holds both the agreement
and the inventory of forms that break it.

**Aperture dimensions are measured against the hulls that exist**, and are no
longer a guess (ratified 2026-08-26). Read the two halves separately, because
they are not the same claim:

- What §10 gates on is the roster **#26** introduces, and #26 has not fixed one.
  In that sense the figure stays provisional and this section stays open.
- What #35 built is a *pool* — eleven roles, thirty-three hulls — and
  `tests/aperture-fit.test.ts` measures the slot against every one of them at
  check 4's roll limit. So the number is no longer unmeasured, which is what it
  was.

A roster drawn from that pool cannot invalidate the figure; a roster that
introduces a hull outside it can, and the test is what will say so.

The slot was 0.20 × 0.07 km. That is 3.7× the widest ordinary hull's beam and
16% of a 1.24 km station's whole width, against about 10% on the reference
Coriolis: on screen it read as a hangar door rather than as a slot.

**Only the width moved.** §10 requires the slot to admit the largest hull at
check 4's 50° roll limit rather than axis-aligned, and a rolled rectangle needs
`w·cos θ + h·sin θ` across and `w·sin θ + h·cos θ` up. Measured over #35's
roster at 50°, the binding figures are **62.8 m** across and **63.4 m** up —
so the height has almost nothing in it, and a first attempt at 0.12 × 0.06
was 3.4 m short of a slot the checks would have cleared a ship through. §10 is
explicit about the remedy and it was followed: the aperture moves, not the
tolerance.

At 0.12 × 0.07 km the margins are 57.2 m across and 6.6 m up. The height is not
a dial.

**Neither the carrier nor the dreadnought fits, and neither is meant to** (see
the map's Constraints). Stated in the same terms as the rest of this section, which is
what the slot has to admit rather than what the hull measures square: **rolled
to 50° the carrier needs 256 × 257 m and the dreadnought 229 × 228 m.** Their
axis-aligned envelopes are 212 × 181 and 186 × 165, and quoting those here was
the mistake this section is otherwise about — whoever retunes an aperture would
read 212 as the bar to stay under when the admit threshold is 256. #26 owes them
an outfitting route that is not a station.

**The third capital, `voyager` (#331), is refused by length, not by section.**
At the film's proportions its rolled section passes a slot; what no station
admits is a 191 m hull in a 90 m berth cell (§13.2), and `berthFits` refuses it
there. The principal ruled on 2026-09-15 that this is the intended refusal, so
the capital rule is *no berth admits it* for all three and *no aperture admits
it* only for the carrier and the dreadnought. `tests/aperture-fit.test.ts`
states both halves.

Probe fixtures and every form's drawn dock frame read the aperture from the
geometry constant rather than restating it, so a retune moves one table and no
*code*. It does not move one **prose** site: this retune also touched §4, §10,
the table above, `station.test.ts`'s expectation and `aperture-fit.test.ts`'s
header. Figures written into prose are the thing that goes stale, which is why
the test prints its margins rather than asserting a remembered pair.

The shipyard's drydock frame (#13 §7) extends to roughly 1.66 km and is **not
dockable geometry** — it is silhouette. Docking geometry is a drawn object and
inherits the map's distance rule (#13 §6, *Layering*): near layer within
`HANDOFF_KM` of the camera, far beyond it, hysteresis band. It does not get a
fixed layer for being "close by".

**Every station draws once from `DOMAIN.STATION_SPIN`; the refinery discards the
value and stores 0.** Skipping the draw for refineries would make the draw count
depend on station type, so inserting a refinery would shift the spin of every
station generated after it — the stream coupling the per-domain tags exist to
prevent, reintroduced inside a single tag.

**`radiusKm` is a per-type constant, not a draw.** It reads from the table with
no call into `DOMAIN.STATION_SPIN` or any other stream, so adding it shifts no
RNG stream and the `tests/station-orbits.test.ts` fixture is unaffected. Only
`spinRpm` draws (#13 §8.2).

---

## 6. Clearance

**Decision D5, amended by #148: Oolite's protocol — granted, berth queued,
lane queued, or denied — and true barging turns the station hostile.**

Requestable when a station is the selected target and range is inside
**`VICINITY_KM`**, a gameplay constant set to 10,000 km — numerically
`HANDOFF_KM` today, and deliberately a separate name. `HANDOFF_KM` is the
*render* handoff distance (§5); binding clearance range and §7's docking-computer
engagement to it directly would mean retuning the layer split for a visual reason
silently retunes both. Same value, two reasons, two constants.

| Reply | When | Effect |
|---|---|---|
| **granted** | a fitting berth is reserved and the Transit lane is awarded | a **600 s** window. Expiry returns to `none`; re-request is free |
| **queued (n)** | no fitting berth is free | promoted when compatible capacity frees; `n` is the live one-based queue position |
| **lane queued (n)** | a fitting berth is reserved but the Transit lane is unavailable | promoted by station-traffic arbitration; the 600 s window has not started |
| **denied** | station already hostile, or #13 §5.1.1's shipyard contraband scan fails | no window; the reason is #8's to compute |

**600 s, because a shorter window expires before the approach can be flown.**
§1 hands the player control at a pass inside ~600 km, and normal flight is
capped at 2 km/s, so closing that gap is **300 s at best**, before any braking
or missed pass. A 180 s window — the first figure written here — would have
expired on every grant taken where the player is actually flying, which is the
failure mode of a timer sized against nothing.

**Clearance is a precondition, evaluated before §3's checks — not check 1.**
Crossing the slot plane with neither a berth reservation nor a live grant is a
failed entry *and* turns the station hostile. Crossing with a reserved berth
while still lane queued is repelled without hostility: #148 distinguishes
disobeying a hold from barging without clearance. The ordering still matters:
an implementation that read `station.hostile` before applying a true barge flip
would let it dock cleanly. The entry condition remains `grantLive && !hostile`,
in that order.

**Hostility must expire, and #8 is not here yet.** The flip ships in this node;
the decay that clears it is #8's, and #8 is unbuilt — so as written a player who
lets a 600 s window lapse and crosses the plane anyway would be locked out of
that station *permanently*, on a map where a system may have only one. That is
an unwinnable-save shape, and #10's drive-charge regeneration is the precedent
for refusing one. So this spec fixes an **interim cooldown of 600 s** on station
hostility, matching the grant window. #8 replaces it with legal-status decay and
may make it longer, conditional, or bounty-bearing; what #8 may not do is remove
it without supplying another exit. There is no fine, no soft path,
and no new economic object: one rule, Elite's own (shoot near the station and
you cannot dock there), reached by a different route.

**#366 arrived at that sentence, and kept it.** There are now two reasons a
station will not admit this pilot, and they are two rules with two exits, not one
rule with two names:

| | Why | Where it lives | Its exit |
| --- | --- | --- | --- |
| **the flip** | barged without a grant, or failed #13 §5.1.1's scan | `DockingState.hostile`, session state | `HOSTILE_COOLDOWN_S`, unchanged, still 600 s |
| **the law** | it saw an offence (H5), or it is a shipyard and the pilot is Wanted (H7) | derived from the saved `LegalStatus` on read (`legal.ts`) | heat decaying below Wanted |

The interim cooldown is the flip's exit and nothing else. **It is not the law's,
and that is a correctness point rather than a tidy one**: the two arrive at the
same denial (`reason: "hostile"`) through different fields, and a law refusal
written into `hostile` would inherit a 600 s countdown — which both punishes a
pilot who never barged and keeps the station hostile for ten minutes after the
reason for it has gone. `ClearanceRequest.refusedByLaw` and its twin on
`attemptEntry` are the law's door; they are checked *before* the scan branch,
because a station that will not admit this pilot conducts no scan of their hold.

The barge-without-clearance flip keeps its own 600 s cooldown for the reason
above: it is a different offence from the one H5 witnesses.

The protocol is where #13 §5.1.1's **shipyard contraband scan** lands. #13
required the scan and gave it no moment; requesting clearance is that moment, so
a hostile arrival is something the player *asked for an answer about* rather
than something that happens to them silently.

### 6.1 Traffic's share of a catalogue, and the queue it leaves

**Decision D6: build the queue path; grant immediately until station traffic
is built.** Traffic was built by #266, and D6 was amended by **#277: a station
keeps one berth for visitors, and Traffic's roster is the catalogue minus one.**

D6 as first written assumed occupancy was always zero in the live game, because
station traffic was #148's and unbuilt: the queued and denied branches were kept
from rotting by **an injected occupancy input in the headless tests** (§9.1),
exercised code from the day they were written.

#266 became the caller that writes occupancy, and wrote every berth: one
home-owned carrier per generated berth — **by construction**, the roster being
sized from `interior.berths.length` — and all of them parked before their first
departure. Occupancy therefore covered the whole catalogue wherever that
construction held, so the player was queued at the station's capacity and — a
grant being a berth reservation (§13.2) — could never dock. #277 is that
regression and its ruling, and its receipt carries the readings: no figure is
quoted here, because the build they were taken on no longer exists and no
shipped instrument can reprint them.

**The share is the catalogue minus one, and the reserved berth is not
special-cased anywhere else.** Traffic's roster length, a carrier's home berth
and Traffic's own promotion allocator all read one rule (`trafficBerths`), so a
visiting carrier cannot take the visitor berth either; the player's own
promotion goes through the full catalogue and may take any free berth including
that one. Which berth is reserved does not matter while every berth of a station
shares one clear envelope, and a test holds that as a tripwire rather than as a
fact.

**The queue is still not reachable in the live game, and D6's bargain stands
unchanged.** There is one player, Traffic may not take the visitor berth, and no
other visitor exists — so nothing can present a station with every berth taken.
The queued and denied branches are exercised the way D6 said they would be: by
injected occupancy, now from a browser probe as well as the headless tests.
What would make the queue live is a second visitor — a rule that lets Traffic
into the visitor berth, or an NPC that docks as a guest — and neither is
specified here. #8 retains combat AI and interdiction.

What is **not** decided here is whether a departed carrier's home berth is held
while it is away. Today it is not, so a station's free capacity grows with the
clock — recorded in #277 and left open.

---

## 7. The docking computer

**Decision D4: 1,000 Cr, universal availability, fast and clean. #7's
equipment table is unamended.**

It engages inside `VICINITY_KM` with a grant in hand, flies the approach, and
docks — roughly the profile a competent pilot flies, no ceremony and no penalty.
Any control input cancels it.

**"No ceremony" is a comparison, not an absolute** (#73). §12's arrival takes
four to six seconds and it is the *same* arrival a hand-flown entry gets, because
§12.1 hands the ship over at the plane whoever was flying. So the computer is
exactly as fast as a pilot and exactly as slow, which is what this decision
actually protects: §7.1 records that "a slow scripted arc that made the computer
safer but never faster" was on the table and declined, and a shared arc is not
that arc. What D4 forbids is ceremony the computer pays *and a pilot does not*.

**The plain reading says otherwise and is not dismissed.** The ratified sentence
carries no comparator — "no ceremony and no penalty" — and on its face a four-to-
six-second arrival is ceremony the computer now pays. Two things weigh against
reading it that way and neither is decisive on its own. §7.1 is the only place
the phrase is explained, and it explains it comparatively. And a literal reading
would forbid the arrival for a *pilot* too, since §12.1 gives them the same one —
which makes D4, a decision about an item of equipment, the thing that governs
what happens after a hand-flown entry. That is a wider claim than a section
titled "The docking computer" should be making.

So this is recorded as an **amendment on a contested reading**, not as a
settled one. The author's own first judgement was that E3 reopened D4; #74's
review is where that reversed. If the reading is wrong, the remedy is §7's
price or E3's duration — not the tolerances, per §7.1.

**Two legs, and the corridor between them is a cone** (implementation finding,
2026-08-27). The computer lines up on a fixed point out along the axis and then
runs in at the slot; what is not obvious until it is flown is what decides the
switch between the two.

§5's axis points at the parent body, so it **swings as the station orbits**, the
corridor entry point swings with it, and a ship chasing that point lags it. A
7 m cylinder was tried first and was never met: measured in the browser the
autopilot held **12–33 m** off-axis and dithered at the standoff until the 600 s
grant expired under it.

A wider cylinder was **not** flown, so "a cylinder cannot work" is not what was
shown, and an earlier draft of this paragraph argued it was — by bounding a
cylinder above at §5's 35 m half-height, which does not follow: the corridor is
a *phase gate at range*, not a containment test at the plane, and the cone that
shipped admits about 164 m at the same switch point. What the measurement shows
is narrower and it is all that is claimed here: at a 3 km standoff the lag is
tens of metres, so a corridor met there is a loose one, while the thing the
approach has to end inside is 35 m. A cone is loose where the lag is and tight
where the aperture is. Whether some intermediate cylinder also works is
untested.

**The run-in aims at the axis ahead of the ship, not at the slot** (#315). A
ship flying at a point stays on the line to that point, so its angle off the
axis never closes, and the orbit swings the axis past it for the whole run-in.
At a 90 min orbit that angle passed the cone's 3° inside a minute, the ship
left the corridor near 0.8 km, and the line-up turned it back toward an entry
point kilometres behind it. Before #315 that line-up lasted one frame and the
approach survived it; once the line-up held its phase and waited for the nose
to come round before thrusting, the ship stopped, turned outward and never
docked. `COMPUTER_RUN_IN_LOOKAHEAD` aims a quarter of the remaining distance
ahead. An offset the ship already has then decays as the fourth power of the
distance rather than in proportion to it.

**That does not prove the cone is never reached.** The orbit keeps adding a lag,
about ω × axial × lookahead / speed, and at the run-in's speed floor that lag
shrinks linearly, as the cone does. So the margin is a measurement over the
orbits flown, not a law. `scripts/measure-computer-approach.ts` flies every hull
with a berth at a trade station, at three steps (1/60, 0.05, 0.1 s), four spins
and orbits from fixed to 45 min (the generator's fastest is 90), and reprints
the last row below. The first two rows were measured on the builds named, with
the same sweep:

| run-in aim | approaches that failed to dock | worst dock | most corridor exits in one run |
|---|---|---|---|
| the slot, before #315 | 4 of 432 (45 min orbit, 0.1 s) | 73 s | 198 |
| the slot, #315's first build | 36 of 432 | 469 s | 31 |
| a quarter of the distance ahead | 0 of 432 | 77 s | 0 |

In that last row the widest run-in came to 0.75 of the corridor's half-width,
at the 45 min orbit. A faster orbit, or a lower speed floor, spends that margin.

**The run-in aim sits a hair inside the plane, not on it** (implementation
finding, node #32). The slot centre is *at* the plane, so an aim exactly on it
degenerates exactly where the ship crosses it: target and position coincide,
the commanded nose reduces to the lateral error alone, and check 2's 35° nose
row fails a profile whose position is clean. The orbit floor's higher orbital
speeds made the approach converge a little more tightly, and the browser probe
measured a **37.4° nose at a 0.2° position**. Aiming `COMPUTER_AIM_INSIDE_KM`
(0.05 km) inside the plane keeps the commanded direction defined — "straight
in" — through the crossing. It is still the slot (a 0.12 km aperture), and the
ship never reaches the aim point: `resolveCrossing` disengages the computer at
the plane. The lookahead above is never shorter than this distance, so the
last few hundred metres fly the geometry this paragraph measured.

**It never bypasses a check.** It satisfies §3's six conditions like anything
else, so it cannot dock at a hostile station, cannot skip §6's clearance, and
cannot enter above the gate speed. A computer that could dock where a pilot
could not would make the checks decoration.

### 7.1 What this costs, named rather than discovered

At 100 Cr starting capital and hold-limited from run seven (#7 §6), 1,000 Cr
arrives fast. **Docking is a mandatory skill test for roughly the first handful
of docks and opt-in forever after.** That is a real narrowing of what research
§4 identified as the mechanic's whole point — *a skill tax on every trade-loop
iteration* — and it was chosen with that named. Alternatives were on the table
and declined: a slow scripted arc that made the computer safer but never faster,
a tech-level gate, and a price rise to ~2,500 Cr.

The honest reading is that seelite ships docking as an **early-game skill gate
and a late-game option**, not as a permanent tax. If playtesting finds the trade
loop went flat once the computer was bought, the dial to reach for first is
§7's price, not §3's tolerances.

---

## 8. What the HUD owes docking

Recorded here, designed nowhere — the HUD is fog and this spec does not chart
it. But the map's constraint is that the HUD is load-bearing, not decoration:
cockpit is the default view and the hull is hidden, so checks 2 and 4 have **no
visual referent at all** without an instrument.

The HUD node inherits two requirements:

- an **axis-alignment cue** — where the docking axis is, against check 2's 35°;
- a **roll-match cue** — the slot's current roll against the ship's, against
  check 4's 50°.

This is the same argument #5 made when it required a velocity-vector marker: a
model whose nose and velocity disagree is unflyable in a view that shows
neither. A docking model whose tolerances are invisible is the same defect.

---

## 9. Verification obligations

Two tiers, per the repo's culture: anything arithmetic gets a headless test,
anything rendered or spatial gets a browser probe.

### 9.1 Headless (`bun`)

1. **The six checks as pure functions**, table-driven over relative pose and
   velocity, including the boundary rows at exactly 35°, exactly 50°, exactly
   0.10 km/s, and a crossing point exactly on the aperture edge. Tolerances are
   data, not literals repeated per test. Two rows exist because the checks were
   wrong without them: a crossing at 0.42 km lateral offset — inside check 2's
   cone, outside the aperture — **fails**, and a ship rolled exactly 180°
   **passes**.
2. **The frame regression.** A station at 1 AU moving at 30 km/s star-centric:
   a ship co-moving with it at 0.05 km/s relative **passes** the gate; a ship
   stationary in star-centred coordinates **fails** it. This is #10 §11.1's
   warning turned into a test rather than left as prose.
3. **`v_rel` is read consistently** — an entry at 0.05 km/s axial and 1 km/s
   lateral is a single fixture asserting the gate reads `|v_rel|` and fails it,
   and that the damage formula reads the same scalar. The two readings differ by
   400× in damage, which is why this is a test and not a comment.
4. **A failed entry repels and keeps its grant** (§2.0): the ship ends outside
   the slot plane with `v_axial` reversed and halved, never inside the station,
   and a live grant survives the bounce.
5. **The damage floor bites** — a 90°-mis-rolled entry at 0.01 km/s costs at
   least a quarter of the gate-speed damage, not 1% of it. Without this the
   alignment checks are free to anyone who crawls.
6. **The pad is the slot minus check 4** — the same fixture run against both
   interactions, asserting the only differing outcome is the roll row.
7. **Spin generation**: range `[0.6, 3.0]` for the two Coriolis types, exactly
   0 for the refinery, drawn from `DOMAIN.STATION_SPIN` and from no other tag;
   a determinism fixture; and the measured fraction above 2 rpm asserted over
   **10,000 stations drawn from a fixed seed set, `|p̂ − 0.417| < 0.015`**.
   §4's "the hard end is common" is a claim about a distribution, and a
   distribution claim with no N and no bound is an assertion that cannot fail —
   the defect §9.1.8's "byte-identical" exists to avoid.
8. **`radiusKm` shifts no stream** — the existing `tests/station-orbits.test.ts`
   fixture is byte-identical before and after the field is added.
9. **The clearance state machine**, including `queued` and `denied`, driven by
   an injected occupancy input (§6.1). Barging without a grant asserts both
   outcomes: failed entry *and* station hostile.
10. **The damage predicate**: monotonic in closing speed, and a failed entry at
   exactly `V_GATE` from full health leaves at least three quarters of the pool.
   The test is written against #8's scale as a parameter, so it constrains #8
   rather than waiting for it.
11. **The docking computer satisfies §3** — a headless run from the vicinity to
   docked that asserts no check was ever violated, plus a run at a hostile
   station that asserts it refuses.

### 9.2 Browser probe (Playwright)

1. **Layering** — the station's docking geometry is drawn near within
   `HANDOFF_KM` and far beyond it, with the hysteresis band. Reads the constants
   off `window.__seelite.units`; a probe with its own copy goes falsely red when
   the module changes them.
2. **The slot tracks the spin** — its screen-space orientation advances at
   `spinRpm` over a measured interval, at both ends of the range.
3. **A scripted approach docks** — driven from the vicinity through a correct
   profile, asserting `docked`.
4. **A hull-face approach is refused** — a scripted run aimed squarely at the
   station's face, inside check 2's cone but outside the aperture, asserts a
   failed entry rather than a dock. This is round 2's blocker as a probe: it is
   a spatial claim, so it gets the spatial tier.
5. **A scripted mis-rolled approach fails and survives** — the same profile with
   the roll deliberately 90° out asserts a failed entry, non-zero damage, and a
   living ship. D1 is a rendered, spatial claim and gets a probe, not a unit
   test.

Per the map's note, the probes do not run in CI; that check is the author's
before merge.

---

## 10. Hand-offs

- **#8 (combat)** — owns **how damage is undone** (§11.5): D1 says a failed dock
  costs damage rather than the run, and no repair, refit or hull-restore mechanic
  exists anywhere in this repo. Whatever #8 chooses — restoration on docking, a
  priced repair, or nothing at all — D1's "costs you something, not everything"
  is only true once it exists. It also owns `DAMAGE_SCALE` under §2.1's bounds
  — and owes a test that asserts the **exported constant** satisfies the
  quarter-pool bound at `V_GATE`, not a parameter substituted for it. §9.1.10's
  parameterised test can never fail on the value #8 actually ships, so without
  that obligation D1's survivability guarantee crosses a node boundary with an
  owner on neither side. **#324 (a) discharged the test**: `DOCKING_DAMAGE_SCALE`
  is asserted in `tests/ship-condition.test.ts` against a quarter of the
  head-on pool (fore shield and hull) on every hull. **And the principal ruled
  on the pools (2026-09-14):** shields recharge, hull does not, so a failed
  entry that stays inside the fore shield costs seconds of lowered shields and
  nothing lasting; repair of hull damage is still open. #8 also owns replacing
  §6's interim **flip** cooldown;
  the
  legal-status predicate behind §6's shipyard scan. What is *not* #8's to build
  any more: the decay that clears a station's hostility arrived with #362's third
  change (`civilian-combat.md` H5, H6, H7 — witnesses on the saved
  `LegalStatus`, and the shipyard's refusal of a Wanted pilot), and it is a
  second, derived hostility rather than a replacement of the flip. It inherits §9.1.10 as a test it must satisfy, not author.
- **#148 (station traffic)** — owns the Traffic actors and replaces §6.1's
  injected occupancy with real berth and Transit-lane queues.
- **The HUD node** — inherits §8's two cues.
- **#26 (ship roster)** — the slot at 0.12 × 0.07 km must admit the largest hull
  it introduces **at check 4's 50° roll limit**, not merely axis-aligned: a hull
  that fits the 70 m short dimension square does not fit it rolled 50°. If it
  does not, the aperture moves, not the tolerance.
- **#7 (economy)** — unamended. The docking computer stays 1,000 Cr, universal.

---

## 11. Weak joints, recorded not reopened

1. **The skill tax is early-game only** (§7.1). Named at decision time; the
   remedy if playtesting wants one is the price, not the tolerances.
2. **The queue is specified against traffic that does not exist** (§6.1),
   mitigated by injected-occupancy tests rather than by a promise.
3. **A 3 rpm station can be anyone's second dock** (§4). Accepted as the cost of
   an uncorrelated dial.
4. **Three numbers are chosen, not flown** — the 0.10 km/s gate
   (§3.1), and check 2's 35° and check 4's 50° (§3.2). They are where this spec
   is most likely to be wrong, and §9.2's probes are where that shows up.
5. **The flip's hostility exits on an interim timer this node invented** (§6).
   The flip ships now and its real exit — legal-status decay — is #8's. A 600 s
   cooldown stands in, because without one a lapsed grant plus one barge would
   lock a player out of a system's only station permanently. **The second
   hostility, the law's, is no longer in that position**: #366 built it with its
   real exit from the start (heat decaying below Wanted, `civilian-combat.md` H5
   and H7), and it is a separate field for exactly that reason. What is still
   interim is the flip alone.
6. **A grant can be taken from further away than it can be flown from**
   (implementation finding, 2026-08-27). §6 grants anywhere inside
   `VICINITY_KM` = 10,000 km, and defends the 600 s window with an arrival
   distance of ~600 km — but normal flight is capped at 2 km/s, so 600 s buys
   1,200 km. A grant taken at the far edge expires mid-approach, and §7's "it
   engages inside `VICINITY_KM` … and docks" is false above about 1,200 km: the
   computer refuses on the expiry and stops flying. Neither number is changed
   here, because both were decided and the interaction is what was missed. What
   *is* fixed is the silent half — the computer now zeroes the throttle and
   records why it stopped, so it does not hand back a ship still closing at a
   speed nobody chose. The real remedy is one of three and none of them is this
   node's: shorten the request range, lengthen the window, or let the approach
   re-request. The HUD node inherits the cue either way.

7. **Nothing owns repairing the damage D1 inflicts.** Handed to #8 (§10) rather
   than invented here, because it is denominated in #8's pools and #7's table is
   deliberately unamended. Until it lands, D1's failure model is *survivable*
   but not yet *costly* — the punishment is real and the bill is unwritten.

---

## 12. The successful entry

**Decided with the principal on 2026-08-27, on node
[#73](https://github.com/jcfischer/seelite/issues/73), after flying #68.** Eleven
decisions, one at a time. Anything below that was not decided in that session is
derived here and marked as such.

The trigger was a bug report that was not a bug: *"ship does not fly into
Coriolis station but hovers just over rotating dock"*. That is exactly what this
spec asked for, because it asked for nothing.

### 12.1 The arrival: the game takes the ship at the plane

**Decision E1, revised with the principal on 2026-08-29: the player sees a
compact enclosed hangar, not an open throat.** The ship visibly enters the slot
and the handover still happens inside it, but a parked free-look must read as a
destination rather than exterior space glimpsed through a recess. The bay is
shared by aperture kind, has no landing control or collision, and closes an
inner gate only after the scripted arrival parks. That keeps the six checks as
the only skill test while making the docked payoff legible.

> **Superseded by §13.1 (node #136, ratified 2026-08-30).** Every station now
> has a role-scaled enclosed interior with several berths, shared by *role*
> rather than by aperture kind, and the inner gate is gone: the interior is
> unpressurized, with no opaque door, and the aperture frame stays visible from
> every berth. What survives is E1's reason — a parked free-look must read as a
> destination — and the boundaries it kept.

**Decision E2: crossing the plane hands the ship over.** The arrival is
scripted and nothing can fail during it, for both halves of one reason: the
skill test ended at the crossing, and a player who flew a clean entry and then
clipped a wall would be failing a test added after they passed.

Two consequences that decide implementations:

- **The arrival moves the ship in *sim*, not in the renderer.** This is the
  repo's standing rule rather than a choice made here: the authoritative world is
  float64 kilometres outside the scene graph and nothing reads a position back
  out of an `Object3D`. So it is a position law of the shape `cruise.ts` already
  uses — pure, no memory, sub-stepped, session state on the game — and therefore
  headless-testable rather than a thing only a probe can see.
- **One path, not two.** The docking computer and a hand-flown entry produce the
  same arrival, because this fires on the crossing and neither is flying by then.

**Decision E3: the arrival is long enough to be the payoff — four to six
seconds, a range to tune inside rather than a point value.** Chosen against a two-second handover. The approach is the game's
central skill loop and what it ends in should be worth having flown. §7's
amendment is what keeps this from reopening D4.

> **Re-fixed by §13.3 (node #136): about six seconds to a near berth and about
> nine to a deep one.** The old band priced one straight run down a throat; the
> route is three legs to a berth off the axis now, and the duration is
> interpolated on the route's own length rather than looked up by band. E3's
> reason is unchanged and is what fixed the *lower* end at six.

> **Retired by §13.3 (node #136): both traversals are unconditionally
> skippable.** The per-type novelty gate below has nothing left to gate — an
> arrival's skip completes at the reserved berth, a launch's outside the
> aperture — so the four per-galaxy booleans are not stored, and the typed
> domain this section asked `persistent-world-state.md` to bound does not need
> bounding. The reasoning is kept because it is what the retirement answers.

**Decision E4: it is skippable once the player has arrived at that *type* of
station before.** Not per station: E7's throat is shared, so a per-station gate
would make the player re-watch the *same* arrival at each of hundreds of stations
— novelty rewarded for something that is not novel. Four first-times — trade,
shipyard, refinery, outpost.

**Four gates cover two presentations, and that is deliberate.** Type →
presentation is a total function, and it is a **type-level** guarantee rather
than a convention that could drift: `STATION_GEOMETRY` is a
`Record<StationType, StationGeometry>`, `StationGeometry.aperture` is one
`StationAperture`, and `StationAperture.kind` is one of `"slot" | "pad"`. A type
therefore cannot span both — not "does not today", *cannot*. Trade and shipyard
are slots, refinery and outpost are pads.

**Three of the four gates fire today and the pad side rests on one type.** No
outpost is generated (§12.7's joint 5), so in a running game the slot
presentation is covered twice — trade and shipyard — and the pad presentation
once, by the refinery. The over-count argument therefore holds on the slot side
and is exactly break-even on the pad side; it never under-counts, which is the
property that matters, but "four gates over two presentations" overstates the
margin until an outpost exists. Gating on type therefore **over**-counts — the player
watches the throat once at their first trade station and again at their first
shipyard. It cannot under-count, so no first sight of a presentation is ever
suppressed. The over-count is what E9's shield buys back: a second first-time at
a different *kind* of station, with its own name on the wall, is not the same
arrival twice.

The flag is **per-galaxy player state, not a per-carrier-slot row.** It is four
booleans, not one row per station, which is the whole reason to gate on type —
**three of them reachable today**, because no outpost is generated (§12.7's
joint 5).

**Per galaxy means the four reset on entering a new one**, and that is a choice
rather than a consequence of where the bits live. Eight galaxies is eight sets of
four first-times, which sounds like the tax E4 exists to avoid — but a galactic
hyperdrive jump is the game's largest discontinuity, the stations on the far side
are a different set, and `persistent-world-state.md` §7 makes the envelope
per-galaxy anyway, so a global flag would be the special case needing an
argument. A new game resets them with everything else.

**What `persistent-world-state.md` licenses, stated precisely, because an earlier
draft of this paragraph claimed more.** §1 names "visited flags" among the facts
the overlay stores and §7 puts "player knowledge and visited state" in the
per-galaxy envelope — so the *category* exists and the *scope* is right. What
neither fixes is the **shape**: nothing there contemplates a per-station-*type*
arrival flag specifically. §1's own escape clause is the honest route — "and
other typed domains approved later" — so this is a typed domain **#46 must
approve and bound**, not one already sitting there waiting. §6 of that spec bounds several
domains and **explicitly does not bound this class** — it says "the save/load
decision owes fixed bounds for the map's per-galaxy visited and legal-status
state", which is a deferral rather than a bound. So the ask is smaller and more
awkward than an earlier draft of this paragraph made it: these flags join a class
already waiting on a decision nobody has taken, and four booleans per galaxy is a
bound being *offered* rather than one being inherited.

### 12.2 The docked state, and leaving

**Decision E5: docked means flight is suspended.** The arrival parks the ship at
the docked position and the throttle, the stick and the docking computer all go
inert.

**The docked position is an offset from the aperture origin, in the station's
rotating frame** (derived here). "Inside the throat" and "on the deck" are
descriptions, not coordinates, and §12.6's obligation 9 cannot be written against
a description. So it is fixed the way §4.1 fixes slot phase — a quantity computed
in sim, in the station's own frame, that the renderer mirrors: **on the aperture
axis, one throat-depth inside the plane for a slot; on the axis a hair inside the
deck for a pad**, rather than exactly on it. Both are therefore functions of
`STATION_GEOMETRY` and E7's throat depth, and neither is a new constant.

**The pad's offset is not fussiness.** The plane is §3's evaluation surface, and
a ship parked exactly on it rests on the boundary of the surface its own checks
are evaluated at. It is harmless today — `planeCrossing` returns `null` for an
outward crossing, so a parked ship cannot re-trigger the checks by drifting — but
that is a property of one function rather than a stated rule, and a docked
position defined *on* the check surface is an invitation to find out otherwise.

**The world keeps running.** #10's constraint is binding and unchanged: sim time
is never compressed, so the clock advances and the bodies stay on their orbits
while the player is docked. Pausing was on the table and declined for that reason.

**What the player sees while docked is #70's**, not this spec's. This section owns
the ship; the market screen and the panel hierarchy own the screen. Stated
explicitly because the last time that boundary was left implicit —
`economy-trade.md` §11 handing the market screen to the HUD node,
`hud-and-scanner.md` §0 declining it — the screen ended up owned by nobody.

**Launch is the mirror of the arrival** and is built with it rather than being its
own decision: the ship leaves the way it came in, and flight resumes when it does.

**Launch gets the arrival's treatment, not a sentence saying it is like it.**
"The mirror of the arrival" is how this paragraph read for four review rounds,
and each round found another place where the mirror had not actually been
applied — the collision exemption named the arriving and parked ship and not the
launching one, and §12.6 checked the arrival's frame and the parked ship's and
not the departure's. So, explicitly and in the same terms §12.1 and §12.3 use:

- The launch traversal is a **scripted position law in the station's rotating
  frame**, like the arrival and for the same reason: the throat turns, and a law
  written in the translating frame alone walks the ship into a wall that moved.
- The ship is **not collidable during it** (§12.3's third row).
- **It stops being exempt when it clears the aperture plane outward** — the
  mirror of "the exemption begins on the tick after a pass". From that instant it
  is an ordinary flying ship and #75's system owns it. The plane is the boundary
  in both directions, which is what makes it one rule rather than two.
- Flight controls become live at that same instant, not before: a player steering
  inside the throat is the control problem E2 declined.

**Launch is unconditionally skippable, and does not read E4's flag at all.** The
tempting argument is that it need not: the flag is set by arriving, and a player
cannot launch from a station they did not arrive at. That argument has a hole —
E5 depends on a save that may restore a *docked* ship, and E4 resets the flags on
entering a galaxy, so a restored session can reach a launch with the flag clear.
Rather than patch the argument, the rule drops the dependency: **a launch is
always skippable.** §12.6's obligation 5 can then be the unconditional assertion
it is written as, instead of one with an unreachable false branch and one
reachable-only-after-a-load true branch.

**`UNDOCK_CLEAR_KM` retires the day that lands.** #68 shipped it as an anti-latch
measure and said so in its own docstring — it exists because `dockedAt` was set
and never cleared, not because leaving was designed.

**What the player presses to launch is #70's, and the motion is this spec's.**
*(#70 has since answered: `hud-and-scanner.md` §8's **M9** puts the launch
control on the **Flight console**, reached by turning the head right, not on the
station console. The sentence below was written expecting a single full-screen
station mode; §8's **M1** kept the cockpit instead, so "that screen" is the
cockpit and the command sits on the console that owns flight. The seam this
paragraph exists to protect is unchanged.)*
The seam has to be stated because E5 makes the stick and the throttle inert, so
the one control the player would reach for is gone: a docked player is in a
screen, and the launch command is a control *in* that screen. This spec owns what
happens after it is pressed. Without this sentence the launch trigger falls in
the gap between two sections that each disclaim the other's half — which is
exactly how the market screen ended up owned by nobody.

### 12.3 Collision: a second system, and the boundary between them

**Decision E6: collision is real, it is a separate system, and it is not this
spec's.** Flying into a station is a collision. Today nothing collides with
anything — `SURFACE_MARGIN` is cruise-only (#10's) and normal flight passes
through every body in the game.

The boundary, stated so neither system has to guess:

| Surface or state | Owner |
|---|---|
| The aperture rectangle, at the plane | **§2 and §3 of this spec** — the six checks and the failed-entry model |
| Hull, rim, drydock frame, and every other body | **The collision system** |
| **The ship during §12.1's arrival, while docked, and during the launch traversal** | **Neither.** It is not a collidable body. |

**The ordering at the crossing instant, because the first two rows overlap
there.** A ship on the plane is simultaneously in §2's row and entering the
exempt one, and an implementer cannot be left to pick. So: **§3's six checks
evaluate at the crossing, and the exemption begins on the tick after a pass.** A
failure is §2's in full — repel, damage, grant kept — because a failed entry
never enters the exempt state at all.

**The launch half of that row is not an afterthought.** E5 makes launch the
mirror of the arrival, so a launching ship is neither arriving nor docked and an
earlier draft of this table left it collidable — traversing the same throat, on
the same rails, with the exemption switched off. A table introduced as "stated so
neither system has to guess" that omits one of the three states §12 creates is
worse than no table.

**That third row is not a detail.** §12.1 invents a traversal — the ship flies
down a throat it was placed in on rails — and E2 says nothing can fail during it.
Without the row, a collision implementer reading the table as authoritative gives
the throat walls to collision, the default is collision-on, and **the arrival
clips the tunnel it was just handed**. The same holds for the parked ship: it sits
inside a structure that is otherwise solid.

The exemption is safe on the arrival's own side because it is scripted: a
position law with a known start and end, so there is no state in which the ship
is somewhere the law did not put it. That is only half an argument, and the other
half is what keeps something *else* out of the throat:

- **Another ship.** §6's clearance protocol is exactly that mechanism. A grant is
  refused while the Transit lane is reserved, so two ships are never cleared
  into one throat. Occupancy is injected and always zero today; #148's traffic
  replaces the injection and inherits the rule rather than reopening it.
- **The station's own rotation.** The throat turns with the station, so the
  arrival law carries the ship in the **rotating** frame — the same frame §4.1
  computes the slot phase in. A law written in the station's translating frame
  but not its rotating one would walk the ship into a wall that moved, which is
  the one way a scripted path can still end somewhere it was not put.

§2.0's semantics are why this is a boundary rather than a merge: a failed entry
repels with `v_axial` reversed and halved, damages on §2.1's quadratic above a
floor, **keeps its clearance grant**, and is guaranteed never to leave the ship
inside the station. A generic collision reproduces none of that, and all of it was
decided in #9's grilling.

§3 records what collision does to check 5's *justification*, and §9.2.4 is the
probe that has to be re-pointed when it lands.

### 12.4 What the arrival is made of

**Decision E7: one shared slot hangar**, built by extending the aperture recess.
`station-mesh.ts`'s `buildAperture` is already one function, called by **every**
form at a per-form face depth, and it reads `STATION_GEOMETRY` — so the bay
inherits the aperture's dimensions, a retune of the slot moves it, and **which
forms get a hangar is decided by `aperture.kind`, not by a list here.** It adds
an inset deck, ribs, guide strips and end bulkhead inside the existing volume;
the docked-only inner gate seals the mouth after parking. Distinct interiors per
form remain declined: the shared bay gives the arrival a clear payoff without
turning silhouette identity into an interior-authoring burden.

**Decision E8: pads get a touchdown, not a throat.** A pad is an exterior deck —
the Warren's notch, the Derrick's top deck — with no inside. So the rule is one
and the presentation is two: crossing the aperture with every check passed hands
the ship to a scripted arrival, which flies *into* a slot and *down onto* a pad.

**This does not reopen `station-types.md` §6.** That decision fixed the number of
docking *interactions* at two, and an interaction there is an approach and its
checks — which stay exactly as ratified, the pad being the slot minus check 4
(pinned by `tests/docking.test.ts`'s `describe("§9.1.6 the pad is the slot minus check 4")`, verified against the file rather than remembered). An arrival is downstream of the checks.

### 12.5 The name shield

**Decision E9, amended by work-graph #109: a station carries a generated name,
and the arrival shows it.**
`Station.id` is `"station-trade"` and `station.ts` is explicit that it is a lookup
key rather than a name; `localCarrierId` is the persistence key. The name is a
third thing.

**Drawn, but never from an existing stream.** `DOMAIN.STATION_NAME = 11` is
append-only. Each fixed station-type slot derives its own sub-stream, rather
than consuming one shared stream in push order. A beltless system therefore
does not give its shipyard the refinery slot's name, and a collision redraw in
one slot cannot advance a sibling. All fixed slots are reserved whether or not
that station exists in this system, so presence is not part of a name's seed.

The local collision guard redraws when a name equals the system name or another
fixed station slot. It is local by design: a galaxy-wide guard would have to
generate all 256 systems before placing one station. The body and station
placement streams remain untouched, which `tests/station-orbits.test.ts` pins.

**Uniqueness here means *within a system*, and that is all this name needs.**
Two systems can share names — `galaxy-generation.md` §9's obligation 6 asks only
to "record the duplicate rate" over the 2048 records, so duplicates are expected
rather than prevented. That is not a defect: the name is displayed in the
throat you are flying down and in a target list for the system you are in, always
in a context that disambiguates it. **Nothing in §12 requires a globally unique
station name, and a reader should not infer one** from obligation 10, which
asserts within-system uniqueness because within-system is the scope that matters.

**Decision E10: the shield is a quad built in `station-mesh.ts`, with its texture
supplied by the renderer.** That module is headless-tested and contains no
`document` reference at all; a `CanvasTexture` in it would force the
`typeof document !== "undefined"` branch `station-visuals.ts`'s docstring names as
the failure mode — *"the branch that ships to players would be the one no test ever
takes"*. So the geometry is arithmetic and stays in the tested module, and the
pixels are display and are filled by `main.ts`, which already draws text to
canvases for the cockpit. `buildStationMesh` already returns a handle the render
loop writes into every frame; the nameplate's `map` joins it.

**Decision E11: the shield appears at the mouth *and* inside the throat.** The one
at the mouth does a second job: §3.2 records that the tolerances were set wide
partly because the player has "no visual referent at all" for checks 2 and 4, and
a lit rectangle on the docking face says which face docks and roughly how the slot
is rolled.

**It is not a HUD cue and #69 may not treat it as one.** A sign is legible at a few
kilometres at best; check 2's cone opens 0.42 km of lateral offset at the plane. It
orients, it does not measure. §8's two cues are still owed.

### 12.6 Verification obligations

Two tiers, as everywhere else in this spec.

**Headless.** The arrival is a sim position law, so it is arithmetic:

1. It **terminates**, and ends at the docked position for both a slot and a pad.
2. Nothing **re-evaluates §3's checks** during it — it begins after them.
3. **Flight inputs do nothing while docked**, and launch returns the ship to a
   state from which §3's checks can be evaluated again.
4. **The world keeps running while docked** — the clock advances and the bodies
   move along their orbits across a docked interval, with no compression. E5
   makes that a claim and #10 makes it binding, and without this row a docked
   state that froze the tick would satisfy every other obligation here.
5. The **skip gate** is four booleans and gets a table: each type's first arrival
   plays, each subsequent one is skippable, and the four are independent.
   **Every launch is skippable** — asserted unconditionally rather than as
   "skippable whenever its type's flag is set", which §12.2 has already argued is
   always true and which therefore has no reachable false branch. Stated
   unconditionally, a regression that made a first launch play fails this row.
6. **The duration falls inside E3's ratified bounds.** Without this the range is
   prose: "it terminates" is satisfied by an arrival of any length, so a retune
   to twelve seconds would pass every other row here. The bound is what §12.7
   says is safe to move; a value outside it is not a tuning change.
7. **The arrival *and the launch traversal* are evaluated in the station's
   rotating frame.** §12.3 names
   this as the one way a scripted path can still end somewhere it was not put,
   and a hazard a spec names and does not check is prose. Run the law against a
   spinning station at both ends of §4's range and assert the ship stays inside
   the throat's cross-section at **every sub-step**, not merely at the ends — a
   law that is right at the endpoints and wrong between them is exactly what a
   translating-frame implementation looks like. Both directions, because E5 makes
   launch the mirror and a mirror asserted only on one side is the gap four
   review rounds kept finding.
8. **The arriving, parked and launching ship are in a state a collision system
   can see.** The tempting form — "assert the ship is not collidable" — is
   **vacuous**, because §12.3 records that nothing collides with anything today,
   so it passes for the same reason everything else does. What is checkable now
   is the thing #75 will actually read: that the three exempt states are
   *distinguishable* from ordinary flight and are exposed as such. #75 inherits
   the other half — that its system honours them — and until it lands, the
   physical claim in §12.3's third row has no check. §12.7 records that.
9. **A parked ship holds station over a long interval.** Obligation 4 has the
   world running while docked, so the station translates at orbital speed and
   spins the whole time — and §12.3 names being left where the law did not put
   you as the way a scripted path fails. This is the *longest* such interval in
   the section and it was the last one unchecked: park a ship, advance the clock
   by minutes, and assert it is still at the docked position in the station's
   own rotating frame, not merely somewhere near where it started.
10. **Station names are unique within a system.** E9's local redraw guard is
    exercised directly against forced system-name and sibling collisions, then
    asserted over the same corpus `tests/station-orbits.test.ts` walks.

**Browser probe.**

1. The **throat is drawn** behind every slot-bearing form and the deck under
   every pad.
2. The shield is legible **at the mouth on approach** — and **the interior shield
   is drawn and visible during the arrival**. The inside one is the half only a
   probe can catch: it exists for a few seconds, from one angle, and nothing
   headless can see it at all.
3. A scripted approach ends **inside** the station rather than hanging at the
   plane — the regression this whole section exists for, and a spatial claim, so
   it gets the spatial tier.
4. A docked free-look back toward a slot mouth sees the closed hangar gate and
   **no starfield pixels**. The approach and traversal remain open; the seal is
   a docked-state payoff, not a second entry gate.

**Inherited by [#75](https://github.com/jcfischer/seelite/issues/75), not by this
node.** When collision lands, §9.2.4's hull-face probe is measuring a collision
rather than a failed entry (§3), and #75 owes a re-pointing of it — it is written
into that node's body as an inherited obligation, so it has a holder rather than
being an obligation addressed to nobody. It is recorded here as well because a
probe that stays green for a reason its own spec has declared dead is the shape
of check that stops being evidence, and §12.7 records that it fails open until
#75 is taken.

### 12.7 Weak joints in this section

1. **The arrival's duration is chosen and unflown** (E3). Four to six seconds is a
   judgement about a loop nobody has run forty times. §7's shared-arc argument is
   what makes it safe to retune later without reopening D4.
2. **The skip gate rewards a novelty the throat does not have** (E4, E7). Four
   first-times against one shared interior is a compromise, not a resolution: the
   honest alternatives were distinct interiors per form, or no gate at all. E9's
   shield is what carries per-station identity instead.
3. **Collision is decided and unbuilt** (E6). This section states that it exists
   and where its boundary is, and nothing here builds it;
   [#75](https://github.com/jcfischer/seelite/issues/75) owns it. Until that node
   lands, flying at a station's hull still passes through it — **and §9.2.4 stays
   green for a justification §3 has already declared dead.** That probe currently
   proves a hull-face approach is refused by check 5; once the hull is solid it
   will be proving that collision works, under a name that says otherwise. The
   obligation to re-point it is #75's and is written into that node — so it has
   an addressee — but **an obligation on an open node is not a check**, and this
   one stays green until #75 is taken.
4. **Resolved by work-graph #109/#110:** generated names now ride every body
   record, Navigation, target HUD, docking director, and station shield; ids
   remain selection and persistence handles and are display-invisible.
5. **The fourth gate is unreachable, and the third row of §12.3 is unchecked.**
   Two things §12.6 counts as coverage that currently prove nothing. `system.ts`
   places **no outpost** — `station.ts` says so outright, because #56 shipped the
   outpost as a form and a geometry and #13 has not decided what one *is* — so
   the fourth skip flag is dead until something places one, and E4 is in practice
   three first-times. And obligation 8's physical claim cannot fail while nothing
   collides; only its state-visibility half is live until #75 lands.
6. **E4's flag is an unmet precondition on #46.** §12.1 says the skip gate is a
   typed domain that node "must approve and bound", and then this section is
   where a reader would look for the dependency and would not have found it. So:
   **E4 cannot ship until `persistent-world-state.md` gains a bounded per-galaxy
   arrival-flag domain**, which is #46's to amend and not this spec's to assume.
   Disclosing a dependency once, in the section that creates it, is how it gets
   lost.

   **As built (#77): the arrival ships unskippable.** That node checked
   `persistent-world-state.md` after #46 closed and the domain is still not
   there — the word "arrival" does not appear in that spec at all — so
   `canSkipTraversal` refuses on an arrival and says why, and every *launch* is
   skippable exactly as §12.6's obligation 5 asks. E4 is a follow-up node, and
   the row that fails the day someone wires a skip without the store is in
   `tests/dock-session.test.ts`.

   **E4 and nothing else.** An earlier version of this joint said "E4 and E5",
   and that was wrong: E5 is flight being suspended while docked, which stores
   nothing and needs no domain. The rest of §12 — the arrival, the throat, the
   docked state, the shield, launch — is buildable today, and only the *skip*
   behaviour waits. Getting this wrong in the direction it was wrong in is the
   expensive direction: it reads as a blanket block on the whole section, and
   §12 exists to fix a bug a player is looking at now.

7. **A form's aperture face and §3's plane were two different surfaces, and the
   claim that the shipped forms agreed was false** (#77, corrected by #128).
   This joint used to read: "On the forms the game builds they agree closely
   enough that the ship parks inside the drawn recess, and
   `tests/station-mesh.test.ts` asserts exactly that." Measured, they were
   **173 m** apart on the trade station and **228 m** on the shipyard, and the
   containment test was green for the wrong reason — the throat was 280 m deep,
   which is far enough to reach back past the offset. Shorten the throat and the
   shipped trade station fails the same row.

   §5's table now carries an **aperture plane** column and `apertureFrame` reads
   it, so the surface the checks are evaluated at is the surface the slot is cut
   into. What survives of the joint is the part that was always true: a form is
   free to cut its aperture somewhere else, and **five** workbench alternates do:
   the trade **Ring** on a hub at about a third of the core radius, the trade
   **Drum** — a slot form, not a pad, which is the one a reader skimming for
   "pads" would miss — the refinery **Spar**, and both alternate outposts.
   Selecting any of them parks a ship in solid hull.
   The inventory in `tests/station-mesh.test.ts` names them, and `outpost a` —
   which was on that list *and* was its role's selected form — is no longer on
   it.

8. **The drawn slot's roll did not mirror `slotBasis`, and the fix needed a
   continuous reference** (#77, closed by #126). `main.ts` aimed a station with
   `setFromUnitVectors` — the shortest turn taking local +Z onto the aperture
   axis, which fixes the axis and leaves the roll about it wherever the
   arithmetic lands. Measured on the start system: the axis was exact to 0° and
   the roll was **64.6°** out on the trade station and **78.2°** on the refinery.
   A ship parked by §12.2 therefore sat two thirds of a right angle out of the
   slot it was in, and a pilot rolling to the slot they could *see* could miss
   check 4 by up to 90° — part of why §3.2 set that tolerance wide. Reported
   flying it as *"leaves the ship in a felt skewed position"*.

   **Aiming the mesh on `slotBasis` was built and withdrawn once before it
   worked**, and the reason is the interesting half. `anyPerpendicular` chooses
   its seed on a `< 0.9` branch, so the reference it derives **jumps** as a
   station's axis swings round its orbit; a renderer sharing it snapped the
   drawn hull round, and `probe-station.mjs`'s repeat control went from 0.02 to
   between 0.05 and 0.21. A reference two tiers share has to be *continuous*.

   So the phase-zero reference is no longer derived from the axis at all.
   `sim.ts`'s `stationPose` supplies the station's **own along-track
   direction** — its velocity about whatever it orbits, with the parent's motion
   removed — which is perpendicular to the axis by construction on a circular
   orbit and turns smoothly. `tests/dock-session.test.ts` bounds how far it may
   turn per second across a whole orbit, for every station in the system: the
   along-track reference turns at **0.066°/s** worst on the trade station,
   against the withdrawn one's **23.68°/s** — 360× worse, and 24× over the row's
   own 1°/s bound. Both roll figures are 0° now.

   **What it cost, and what was done about it.** A station's drawn orientation
   changed, so `probe-station.mjs`'s repeatability control — one station measured
   twice, resampled to a 24 × 24 grid — moved from about 0.04 to 0.051–0.059
   against a 0.05 ceiling. That control was already
   [#120](https://github.com/jcfischer/seelite/issues/120)'s subject for
   exceeding its ceiling half the time; this made it consistent.

   The ceiling was **raised to 0.12, on the principal's call**, and measured
   rather than picked — with the two sides honestly unequal. Seven runs put the
   control at 0.046–0.064, so the lower bracket is 1.9× on seven samples. The
   upper is 2.1× below `MIN_DIFFERENCE`, this file's own declared floor for how
   far two *different* stations read apart; observed pairs read higher, but one
   unreplicated reading is not a number to divide by. 0.05 was not a fine
   discrimination, it was a number inside the metric's own noise.

   Said plainly, because a spec that reads as principle while a branch does the
   opposite is worse than no spec: this **is** the branch that made the control
   red raising the ceiling it went red against, which is the shape of an
   anti-pattern. What makes it not one is that the bracket was measured on both
   sides and the decision was the principal's, not that the number now passes.
   The alternative — a finer grid, which would remove the quantisation rather
   than tolerate it — stays with #120.

9. **The interior name shield draws no pixels since the throat was shortened**
   (#128, open as [#131](https://github.com/jcfischer/seelite/issues/131)). E11
   puts a shield inside the throat and #77 measured it at 14,430 pixels with a
   280 m one. At 105 m it measures **zero**, with the recess in front of it and
   with the recess hidden, while the recess itself measures 185,000 in the same
   frame — and the plate is visible, textured, 48 m wide and 23 m ahead of the
   camera. `probe-dock-arrival.mjs` prints the figure and asserts nothing about
   it, because a check whose failure nobody understands is not a check.


## 13. The station interior

**Ratified with the principal on 2026-08-30, on node
[#136](https://github.com/jcfischer/seelite/issues/136)**, and built by
[#147](https://github.com/jcfischer/seelite/issues/147). It supersedes §12's
E1/E7/E8 presentation of a shared throat and an exterior touchdown deck, and
re-fixes E3 and E4. Everything else §12 decided stands: the post-check handover,
suspended flight while docked, station-local motion, the collision exemption,
the running world clock, and the station console's ownership.

The trigger was playtest feedback against the docked view #138 shipped: a flat
closure at the end of the aperture does not read as a hangar.

**Partly reversed on 2026-08-31 by the principal, on node
[#165](https://github.com/jcfischer/seelite/issues/165)**: *"shrink the bays.
Outposts don't have bays, just landing pads. also refinerie can change to
landing pads if too small."* A **slot** role — trade, shipyard — keeps
everything below. A **pad** role — refinery, outpost — loses the enclosed
volume and gets an open deck at its aperture plane with its berths standing on
it, which is where E1/E8 stood before this section replaced them. Each
subsection says which half it belongs to. The measurement behind the ruling is
in §13.1.

### 13.1 Shared topology

Every station has a procedural **station interior** beyond its exterior
aperture: a role-scaled enclosed volume expressed in the aperture frame, with a
permanently clear central transit lane running from the open mouth to a staging
point and berths arranged around it. The exterior form continues to own
silhouette, aperture transform and physical scale; the interior alters neither
the exterior geometry nor the docking-entry checks.

**The lane is the aperture carried inward.** Its cross-section is the aperture's
own rectangle, which is what makes §12.6's obligation 7 hold through the first
leg: a ship that crossed the plane is inside the lane and cannot leave it before
the staging point.

**A pad role has no enclosed volume, and its lane runs the other way** (#165).
The interior is a **deck at the aperture plane** with berths standing on it
around a central landing lane; the volume the traversal uses runs *outward*
from that deck to a hover point one clear height above it, and `endAxialKm`
equals `mouthAxialKm`, which is what "no bay" is as a number. The exterior
form's own surface is the deck's floor, so **a pad's aperture is not cut**
(reversing #162 for those six forms): there is nothing behind a landing pad but
the station's own plant, and a hole in it opens onto that. The four faces still
name the same four directions — a bay's are the walls a berth is bolted to, a
pad's are the sides of the lane a berth stands on.

**A pad's berths stand clear of the approach corridor**, which is the aperture's
own half-diagonal cylinder extended outward from the plane. Nothing of a station
may stand in it — the rule `tests/station-mesh.test.ts`'s corridor row has
enforced since the refinery's rock rose 131 m past its own pad mouth, and which
`corridorIntrusions` in `tests/helpers/aperture-opening.ts` measures. A pad's
berths are the first parts of a station ever drawn on that side of the plane, so
that row is now a pad's whole lane gate, and it is what sets how wide a pad's
deck is:
`PAD_CORRIDOR_MARGIN_FACTOR` in `src/station-interior.ts` carries the margin and
the measurement behind it.

**The opening is a cut in the hull, not a frame drawn on it** (#162,
2026-08-31). The hull's own docking face was never opened: `buildCuboctahedron`
wrote the trade Coriolis's +Z square as two triangles and `hullLoft` caps both
ends, so every form drew a lit frame on a solid surface and a docking ship
crossed the station's own face. It read as an opening only while the dark
`BackSide` recess this section replaced stood in front of it, and it stayed
invisible afterwards because a hull is `FrontSide`: from inside the bay the face
is culled, so every frame taken from a berth was correct. The **six slot forms** are
cut — a ring of quads round the aperture rectangle, exactly, since the four bars
lie strictly outside it — and a plate the ship passes through is cut on both
faces. #162 cut all twelve; #165 took the cut back off the six pad forms with
the bay it opened onto, which the paragraph below states as the contract.

**"Permanently clear" was an obligation the drawn forms did not meet, and the
figure was the bay's depth against the form's** (#162). Measured with
`scripts/measure-aperture-cut.ts`: the bay was 405 m deep on trade, shipyard and
refinery and 234 m on an outpost, while the lane ran clear for 405 m on all
three trade forms, 60–95 m on two of the shipyard's, 58–215 m on the refinery's
and 7–30 m on the outposts'. An outpost's core radius is 150 m, so its bay was
1.56 times that radius deep and its own tower legs and collars stood in the lane.
The obstructions were *inside* the bay box rather than behind it, so the shell
did not occlude them, and none of them yielded to #162's cut — a keel and a
drill are rotated a right angle out of the aperture frame, the Rig's body is
pitched 0.34 rad, an asteroid has no cap to re-triangulate, and greebles and
window panes are instanced, where the fix is placement. **The trade station was
the only role whose forms had room for their bay**, which is why §13.6's
accepted frames — all trade — read correctly.

**It is an assertion now, and it took two different fixes** (#165). Six of the
eight blocked forms are the pad roles and have no bay to be inside anything.
The other two are the shipyard's, and their defect was a **topology error rather
than a placement one**: the slot is on the spin axis (§4.2) and #28 keeps the
outboard structure still, so a shipyard is a rotating drum with a static spine —
and both forms drew the spine passing straight through the drum's interior. A
bearing has to be on the spin axis, so static structure can meet the drum only
at an axial face; the forward face is the aperture, so **aft is the only one
left**. `SHIPYARD_KEEL_AFT_KM` moves the Gantry's keel and the Hangar's slab
360 m aft, taking the arches, rails and the fittings mounted on them and leaving
the two booms where #28 put them, outside the bay's 181 m swept cylinder. It
costs 30 m of the Gantry's declared reach and nothing in the outline #28 ranked,
which is taken down the aperture axis.

**What "clear" means here is what the two instruments sample, and neither is a
proof.** A bay's lane is measured by `crossings()`, a 9×9 grid of rays over the
aperture rectangle, so an obstruction narrower than the cell pitch passes
between them. A pad's corridor is measured by `corridorIntrusions()`, which
tests **vertices**, so a triangle spanning the cylinder with all three vertices
outside it passes too. Both are the samplings that found every defect this node
and #155 fixed, and both would miss a thin enough one; the claim they support is
that no form has an obstruction either sampling can see, which is the claim
§13.5's human row exists to sit above.

**The interior is unpressurized. There is no opaque door and no energy
curtain.** The aperture frame and the station-name shield are visible from every
berth, so the route back to space is always recognisable. #138's docked gate is
removed by this, and E11's interior shield moves from the throat's end wall — a
surface that no longer exists — to the **mouth bulkhead**, facing the berths,
which is where a ship parked nose-outward can read it. That also retires the
symptom §12.7's joint 9 records as #131.

**On a pad the shield is painted on the deck** (#165), on a corner of it where
no berth stands. There is no wall to hang it on and no throat to read it down,
and the one view every approach to a pad shares is the one looking straight
down at it. The half of this paragraph that is a *rule* — the route back to
space is always recognisable — holds trivially on an open deck, where it is the
whole sky.

### 13.2 Berths, fit, and allocation

Three berth families: **open deck pad**, **wall-side berth**, and **recessed
service cradle**. They change presentation and parked pose, never the docking
interaction.

| Role | Allowed families | V1 capacity |
| --- | --- | ---: |
| trade | deck or wall | 8 |
| shipyard | wall or cradle | 6 |
| refinery | deck or cradle | 4 |
| outpost | deck | 2 |

A berth address is **interior face × depth band**: deck, port wall, starboard
wall or overhead; near or deep. Trade fills all eight addresses. Shipyards use
four side berths and two deep cradles. The central transit axis is never a
berth.

**A pad role has one band and one surface** (#165). There is no depth on a
landing deck, so every pad berth is in the `near` band and the address is
effectively its face — the side of the landing lane it stands on. Refineries use
two deck pads and two service cradles, one to a side; outposts use one deck pad
and one station-seeded side pad, and the seed still chooses the side. The
outpost's wall family goes with the wall: a pad has one surface, so a wall berth
has nothing to be a wall berth on.

**Fit is geometric, not a parallel S/M/L taxonomy.** Each berth declares a clear
length, beam and height after safety margin, and accepts a ship exactly when
that envelope contains the hull's geometric envelope. Capital hulls retain their
established non-docking rule, and they are refused by this predicate rather than
by a rule about capitals — **as a denial, not a queue**: a hull no berth in the
catalogue fits can never be promoted by a departure, so clearance answers
`denied` with reason `no berth that fits`.

**The cell is role-scaled, and the outpost is why.** The receipt scales the
volume by role and fixes the capacities; it fixes no cell size, and one cell for
every role does not survive the outpost, whose core is 150 m and whose aperture
is 120 m across — a bay sized for a miner would be larger than the station it is
cut into. So an outpost's berths are smaller, and the two largest ordinary hulls
are turned away by the ordinary fit predicate. `src/station-interior.ts`'s
`BERTH_CELL` is the table; `tests/station-interior.test.ts` measures it against
the hull roster rather than against a typed list of names.

**Promotion atomically reserves a currently free, fitting berth.** With the
Transit lane free, reservation and grant remain one operation as before. When
the lane is busy, #148 inserts a lane-queued state between them: the berth is
reserved, but the 600-second entry window starts only when lane arbitration
awards the grant. A capacity-queued reply's `position` is the live one-based
place in the real station-local queue, replacing the injected occupancy count.
Among candidates the allocator chooses the least spare envelope, preserving
larger capacity; equal fits use a deterministic station-local order rotated by
clearance-request time. If no fitting berth is free, the request remains in the
Clearance queue.

The reservation survives lane waiting and a failed entry while its grant
remains live, is held through arrival, docking and launch, and releases when the
ship crosses the aperture outward — **and the grant is spent with it**. An
unused reservation releases when its lane wait or grant is cancelled, or when a
live grant expires — **unless the ship is in it**: a lapsed grant does not evict
a ship that arrived on it, which is what "held through docking" means when a
dock outlasts the 600 s window. Berth reservation is separate from external
approach-corridor occupancy and Transit-lane occupancy; #148 consumes all three
contracts.

### 13.3 Arrival, parked state, and launch

The successful crossing begins one scripted traversal of three legs:

1. axial travel through the mouth to the central staging point;
2. translation and roll toward the reserved face and depth band;
3. a normal settle onto the assigned deck, wall, overhead berth or cradle.

Parked, the ship's local up points away from the berth surface and its nose
along the berth's own **parked nose**, which in a bay is the aperture axis on
every berth. Wall and overhead addresses therefore create distinct roll
attitudes while the exit remains straight ahead — which is why a launch no
longer turns the ship round inside the bay, and settles the roll instead. Launch
reverses the same route, keeps the reservation until the outward aperture
crossing, and restores flight controls only after that crossing.

**A pad's ship lies in the deck** (#165). Its up-vector is the aperture axis,
because that is the berth's normal, so a nose along the axis too would not be an
orientation at all — two parallel directions leave the attitude with no roll
reference and an arbitrary basis. A pad berth's nose is therefore broadside to
the lane, a quarter turn from its own radius, and the four berths read as a
flight line round the pad. A launch there rises off the deck, crosses to the
axis at the hover height and pitches the nose up to the exit; the release point
is outside the plane **and** outside the staging point, so the run stays
monotone outward rather than dipping back toward the deck.

**A pad's traversal is the same three legs.** The axial run is a climb from the
touchdown to the hover point, the transfer is a pure translation over the
reserved berth at that height, and the settle comes straight down onto it.

**Traversal duration scales with route length**: about six seconds for a near
berth to nine seconds for a deep one, interpolated on the route's own length
between the shortest and longest the station's catalogue can produce. A station
with one depth band has no spread and every route takes the near figure.

**Both traversals are unconditionally skippable.** An arrival's skip completes
at the reserved berth; a launch's completes outside the aperture and releases
the reservation. This retires E4's per-type novelty gate and its persisted seen
flags, and supersedes the open follow-up that was to bound their storage
([#125](https://github.com/jcfischer/seelite/issues/125)).

Cockpit remains the default traversal camera, with head-look available and
flight controls inert. The ordinary player-controlled `V` toggle may switch to
the chase camera, whose existing orbit controls remain available. No cinematic
camera is forced. The station console appears only after the ship settles, and
launch remains owned by the right Flight console.

### 13.4 Interior identity

Interiors extend the exterior role grammar rather than introducing a second
palette:

| Role | Interior treatment |
| --- | --- |
| trade | clean tight plating, warm windows, cargo markings |
| shipyard | coarse structure, cold work lights, gantries |
| refinery | sooted plating, pipes, vent machinery, heat glow |
| outpost | sparse coarse panels, exposed utilities, minimal neutral lighting |

**Light identifies role only.** It never encodes clearance, occupancy,
hostility, or danger state — the same rule §5 states for the exterior.

**The two pad roles' rows are the half of this that is a rule** (#165). Pipes,
vent machinery, conduits and panels are things hung on a wall, and a pad has
none; what a pad carries is a kerb, corner lamps and its deck plating, all three
coloured from the role's own `STATION_VISUALS` row. So a refinery pad and an
outpost pad differ by exactly the thing this section says they should — light
and plating — and by the exterior form standing behind them.

### 13.5 Verification obligations

**Headless** (`tests/station-interior.test.ts`, `tests/arrival.test.ts`,
`tests/dock-session.test.ts`, `tests/docking.test.ts`):

1. Each role's catalogue has exactly its ratified capacity, distinct addresses,
   and only families its palette allows.
2. The central transit lane is clear of every berth, and no two berths overlap.
3. Every berth lies inside the volume its interior declares, and the volume lies
   inside the drawn station. A bay's span runs inward from the mouth; a pad's
   runs outward from the deck to the hover point.
4. The fit predicate admits every ordinary hull at a full-size berth and neither
   capital, measured against the hull roster.
5. Allocation picks the least spare envelope, never an occupied berth, rotates
   equal fits with the request time, and returns nothing at a full station.
6. The reservation survives a failed entry under a live grant, is released by a
   lapsed grant, and is not released by one that lapses while the ship is parked
   on it. **The outward crossing's release is the browser tier's**, because the
   wiring lives in `main.ts` and the headless tier does not construct a `Game`.
7. The traversal ends at the reserved berth's centre with the parked pose, and
   its duration lies in the ratified band.
8. A skip lands an arrival at the berth and a launch outside the plane.

**Headless, added by #165** (`tests/station-mesh.test.ts`):

9. The transit lane is clear from the mouth to the back wall on every form that
   draws a bay — the row #162 could not assert, red on eight of twelve before
   this node.
10. No pad form cuts its deck, and the approach corridor is clear on all twelve.
    The corridor row carries a control that moves a berth onto the axis, because
    it became a pad role's whole lane gate and a rule nothing has been seen to
    break is a rule nobody knows is running.

**Browser** (`scripts/probe-dock-arrival.mjs`), and stated as the rows the file
actually asserts rather than as the rows one would want:

1. every station draws an interior, and every berth in its catalogue has a pad;
2. the interior reaches the screen from inside it;
3. the interior name shield draws pixels, measured on the axis just inside the
   mouth — the arriving ship's view of the end bulkhead, and the one viewpoint
   available while the ship is still flying;
4. a scripted approach ends **off the transit axis**, in the berth its grant
   reserved, within a metre of where §13.3 puts it;
5. the bay is drawn around the berth a parked ship sits in.

**Two things it does not assert, named here rather than implied.** The lit rim
of the mouth reads *zero* pixels from a deck berth and is printed: it sits about
11° above the aim, behind the cockpit's own canopy roof, which is a fact about
where a deck berth puts the pilot's eye. And §13.1's "no door" half is asserted
**headlessly** instead — over every form and every detail level in
`tests/station-mesh.test.ts` — because a name scan is exactly the kind of check
a probe is the wrong tier for.

**Human** (§13.6): the seven canonical frames. Automated checks may prove
geometry, fit, deterministic assignment, reservation lifetime, traversal
endpoints and the clear lane; whether the result *reads* as a hollow station is
a judgement the principal makes in front of a frame.

### 13.6 The human acceptance set

Seven frames:

1. trade arrival in cockpit, mid-transfer to a deep overhead berth;
2. the same station docked forward, with console and open mouth legible;
3. the same berth under free-look, showing bay depth and other berths;
4. the same station launching in chase view;
5. shipyard free-look from a wall berth;
6. refinery free-look from a service cradle;
7. an outpost interior workbench view, because outposts are not generated live.

The first four prove the full transition. The final three prove that role,
family and location produce distinct interiors.

**Frames 6 and 7 are landing pads now** (#165), and they are the frames the
reversal closes on: a refinery cradle is on a deck rather than in a room, and
the outpost workbench frame looks at a pad rather than into a bay. Frames 1–5
are the trade station and the shipyard and are unchanged in kind, but frame 4's
station is a shipyard whose keel has moved 360 m aft, so the flank is a
different picture from the same viewpoint.

**Two of the seven are not captured the way this list reads, and the fixture is
why.** `SEED` 47 — the canonical view set's pinned seed — generates a trade
station and a shipyard and nothing else. So **frame 6 names its own seed** (2,
the lowest whose start system carries all three generated types) and is an
in-game chase view from the cradle; **frame 7 is a workbench frame**, captured
from `?model-viewer=station` looking in through the aperture, because no system
generates an outpost at all and the workbench's stage always looks at the
origin. Re-pinning `SEED` was the alternative and was declined: the eight views
that predate this node are framed against it and #129's before/after figures
were measured on it. The `SEED` docstring's claim of "one station of each kind"
was written for `probe-arrival.mjs`'s purposes and is false of the station
roster.

**Frames 3 and 5 are chase views rather than cockpit free looks**, for a reason
that belongs to #143 rather than to this contract: a docked cockpit carries a
console on every wall, so a head turn shows the Navigation or Flight console and
no bay at all. The chase camera is the only view in the game from which a parked
ship's surroundings are visible.

### 13.7 Boundaries

No on-foot mode, manual interior flight, second docking test, downloaded asset,
general interior collision system, or market and equipment ownership change.

**The exterior-silhouette boundary is spent, twice, and #165 spent it
deliberately.** A pad's deck is drawn *in front of* the aperture plane and is
wider than the surface it stands on — 157 m of half-extent on an outpost whose
own deck reaches 142 m — so the interior is part of the silhouette on those six
forms rather than hidden behind it. And the shipyard's keel moved aft — 360 m
to clear the bay, then 680 m so the hub's spindle shows (#202) — which
changes the flank and raises the Gantry's declared reach from 1.5 to
1.66 km. Both were paid to clear the lane, and neither is a licence for
the next change: the boundary stands for anything that has not been ruled on.
**Neither is verified here.** §13.5's human row is the gate for both, and #165
closes on the principal in front of a frame rather than on this paragraph.

Station traffic is #148 and is specified in `station-traffic.md`. It must reuse
berth fit, reservation, clearance and Transit-lane occupancy rather than
inventing a parallel docking model. Combat AI and interdiction remain #8's.
