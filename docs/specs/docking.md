# Spec: docking

**Status:** resolved decision node — [#9](https://github.com/jcfischer/seelite/issues/9)
**Date:** 2026-08-19
**Inputs:** [#4](https://github.com/jcfischer/seelite/issues/4) (Elite-1984 mechanics),
[#5](https://github.com/jcfischer/seelite/issues/5) (flight model),
[#10](https://github.com/jcfischer/seelite/issues/10) / [#14](https://github.com/jcfischer/seelite/issues/14) (in-system travel, flown),
[#13](https://github.com/jcfischer/seelite/issues/13) (station types),
[#7](https://github.com/jcfischer/seelite/issues/7) (economy)
**Binds:** [#8](https://github.com/jcfischer/seelite/issues/8) (combat, legal status, NPC traffic),
the unowned HUD node

Decided with the principal in a grilling session on node #9; six decisions, one
at a time. The numbers below that were not decided in that session are derived
here and marked as such, so a later reader can tell a choice from a consequence.

---

## 0. What this owns, and what it does not

**Owns:** the docking checks and their tolerances; the closing-speed gate; the
failure model; station spin range and dockable geometry; the clearance
protocol; and the docking computer's behaviour.

**Does not own:** which interactions exist and which type gets which — #13 §6
settled that at two, and this spec builds two. Nor the legal-status predicate
behind the shipyard scan, the absolute damage scale, or NPC traffic (all #8);
nor the equipment price table (#7 §equipment, unamended by this spec); nor the
HUD (fog — §8 records what it owes docking without designing it).

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
   margin** — at most a quarter of the combined shield-and-hull pool. This is
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
| 4 | **Roll match** — ship's up-vector against the slot's long **axis-line**, in the slot plane, acute angle mod 180° | ≤ **50°** | 33.6° |
| 5 | **Containment** — the crossing point lies inside the aperture rectangle, in the slot's rolled frame | inside | implicit in the hull |
| 6 | **Closing speed** `|v_rel|`, in the station's frame, at the moment of slot-plane crossing | ≤ **0.10 km/s** | *had no such check* |

All six are evaluated **at the instant the ship crosses the slot plane**. A
failure of any one is a failed entry (§2).

**Check 5 is not redundant with check 2, and its absence was a hole.** An angular
cone is not a containment test: at §5's 0.6 km core radius, check 2's 35° admits
about 0.42 km of lateral offset — four times the slot's half-length — so without
check 5 a ship flying squarely into the *hull face* satisfies every angle, every
sign and the gate, and docks through solid structure.

**Check 4 compares against the axis-*line*, not an oriented vector.** The slot is
a 0.12 × 0.07 km rectangle, so a ship rolled 180° is a geometrically identical
entry; an oriented-vector comparison would reject it for no physical reason. Two consequences of *that instant*
being the evaluation point, both of which decide implementations:

- **Check 2 is two angles, not one.** A purely positional cone constrains where
  the ship *is* and says nothing about where it points, so a ship translating up
  the axis while facing 90° off would pass everything — check 4 only measures
  roll. Under #5's assist, lateral drift decays and velocity tends to follow the
  nose, which is exactly why the attitude term must be written down rather than
  assumed: it is a property of one flight mode, not of the geometry.
- **Check 3 is a velocity sign, not a position sign.** At the crossing instant
  the axial *position* is zero by construction, so a side-of-plane test has no
  defined answer there — and §9.1.1 requires boundary rows.

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

Braking to it from the 2 km/s assist cap costs `(2² − 0.1²) / (2 · THRUST_KMS2)`
with `THRUST_KMS2 = 2.0` km/s² (`src/sim.ts`, tuned in #5's prototype) =
**1.0 km** — most of a trade station's 1.2 km width of runway. That is visible
at approach range, and it is the reason the number is not tighter.

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
no window at all — ship roll peaks at 1.4 rad/s (80°/s, `ANGULAR_MAX.roll`),
four times the fastest spinner, and #21 gave rotation momentum, so holding a
matched rate is a control problem rather than a reflex one.

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

| Type | Dockable core radius | Aperture | Axis |
|---|---|---|---|
| trade station | 0.6 km | slot, 0.12 × 0.07 km, on the spin axis | toward the parent body (1984's "face nearest the planet") |
| shipyard | 0.6 km (Coriolis core) | identical slot | toward the parent body |
| refinery | 0.4 km (drum) | pad, 0.15 × 0.15 km | radially outward from the star |

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

**Neither capital class fits, and is not meant to** (see the map's
Constraints). Stated in the same terms as the rest of this section, which is
what the slot has to admit rather than what the hull measures square: **rolled
to 50° the carrier needs 256 × 257 m and the dreadnought 229 × 228 m.** Their
axis-aligned envelopes are 212 × 181 and 186 × 165, and quoting those here was
the mistake this section is otherwise about — whoever retunes an aperture would
read 212 as the bar to stay under when the admit threshold is 256. #26 owes them
an outfitting route that is not a station.

Probe fixtures and every form's drawn dock frame read the aperture from the
geometry constant rather than restating it, so a retune moves one table and no
*code*. It does not move one **prose** site: this retune also touched §4, §10,
the table above, `station.test.ts`'s expectation and `aperture-fit.test.ts`'s
header. Figures written into prose are the thing that goes stale, which is why
the test prints its margins rather than asserting a remembered pair.

The shipyard's drydock frame (#13 §7) extends to roughly 1.5 km and is **not
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

**Decision D5: Oolite's full protocol — granted, queued, or denied — and
barging in turns the station hostile.**

Requestable when a station is the selected target and range is inside
**`VICINITY_KM`**, a gameplay constant set to 10,000 km — numerically
`HANDOFF_KM` today, and deliberately a separate name. `HANDOFF_KM` is the
*render* handoff distance (§5); binding clearance range and §7's docking-computer
engagement to it directly would mean retuning the layer split for a visual reason
silently retunes both. Same value, two reasons, two constants.

| Reply | When | Effect |
|---|---|---|
| **granted** | slot free, station not hostile, scan passed | a **600 s** window. Expiry returns to `none`; re-request is free |
| **queued (n)** | slot occupied | promoted when a slot frees |
| **denied** | station already hostile, or #13 §5.1.1's shipyard contraband scan fails | no window; the reason is #8's to compute |

**600 s, because a shorter window expires before the approach can be flown.**
§1 hands the player control at a pass inside ~600 km, and normal flight is
capped at 2 km/s, so closing that gap is **300 s at best**, before any braking
or missed pass. A 180 s window — the first figure written here — would have
expired on every grant taken where the player is actually flying, which is the
failure mode of a timer sized against nothing.

**Clearance is a precondition, evaluated before §3's checks — not check 1.**
Crossing the slot plane without a live grant is a failed entry *and* turns the
station hostile, and the ordering has to be written down because the flip and
check 1 would otherwise resolve at the same instant: an implementation that read
`station.hostile` before applying the flip would let barging dock cleanly, and
clearance would stop being mandatory through a read ordering nobody chose. So
the entry condition is `grantLive && !hostile`, in that order.

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

The protocol is where #13 §5.1.1's **shipyard contraband scan** lands. #13
required the scan and gave it no moment; requesting clearance is that moment, so
a hostile arrival is something the player *asked for an answer about* rather
than something that happens to them silently.

### 6.1 The queue has no traffic yet

**Decision D6: build the queue path; grant immediately until #8 supplies
traffic.**

NPC traffic is #8's and unbuilt, so slot occupancy is always zero in the live
game and every request is granted at once. The objection to this is that an
unexercised branch rots, and the answer is a build obligation rather than a
promise: **the queued and denied branches are driven by an injected occupancy
input in the headless tests** (§9.1), so they are exercised code from the day
they are written. #8 replaces the injection with real ships; it does not
implement the branch.

---

## 7. The docking computer

**Decision D4: 1,000 Cr, universal availability, fast and clean. #7's
equipment table is unamended.**

It engages inside `VICINITY_KM` with a grant in hand, flies the approach, and
docks — roughly the profile a competent pilot flies, no ceremony and no penalty.
Any control input cancels it.

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
where the aperture is, and the run-in aims at the slot centre so the lateral
error closes in proportion to the distance rather than having to be flown out
first. Whether some intermediate cylinder also works is untested.

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
  owner on neither side. #8 also owns replacing §6's interim hostility cooldown;
  the
  legal-status predicate behind §6's shipyard scan and the decay that clears
  station hostility; and the NPC traffic that replaces §6.1's injected
  occupancy. It inherits §9.1.10 as a test it must satisfy, not author.
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
5. **Station hostility exits on an interim timer this node invented** (§6). The
   flip ships now and its real exit — legal-status decay — is #8's. A 600 s
   cooldown stands in, because without one a lapsed grant plus one barge would
   lock a player out of a system's only station permanently.
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
