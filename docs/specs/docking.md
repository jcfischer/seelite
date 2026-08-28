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
failure model; **what a successful entry does** (§12); station spin range and
dockable geometry; the clearance protocol; and the docking computer's behaviour.

**Does not own:** which interactions exist and which type gets which — #13 §6
settled that at two, and this spec builds two. Nor the legal-status predicate
behind the shipyard scan, the absolute damage scale, or NPC traffic (all #8);
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
where the aperture is, and the run-in aims at the slot centre so the lateral
error closes in proportion to the distance rather than having to be flown out
first. Whether some intermediate cylinder also works is untested.

**The run-in aim sits a hair inside the plane, not on it** (implementation
finding, node #32). The slot centre is *at* the plane, so an aim exactly on it
degenerates exactly where the ship crosses it: target and position coincide,
the commanded nose reduces to the lateral error alone, and check 2's 35° nose
row fails a profile whose position is clean. The orbit floor's higher orbital
speeds made the approach converge a little more tightly, and the browser probe
measured a **37.4° nose at a 0.2° position**. Aiming `COMPUTER_AIM_INSIDE_KM`
(0.05 km) inside the plane keeps the commanded direction defined — "straight
in" — through the crossing. It is still the slot (a 0.12 km aperture), so the
lateral error still closes in proportion to the distance, and the ship never
reaches the aim point: `resolveCrossing` disengages the computer at the plane.

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

**Decision E1: the player sees the inside of a station, and it is a *throat*,
not a bay.** The ship visibly enters the slot and the handover to the docked
state happens inside it. A rendered bay with a landing pad was on the table and
declined: it needs interior geometry per form, a second control problem inside a
rotating drum, and collision — and it puts a second skill test *after* the one
the six checks exist to be.

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
  refused while the slot is occupied (§6.1's `queued`), so two ships are never
  cleared into one throat. Occupancy is injected and always zero today; #8's
  traffic replaces the injection and inherits the rule rather than reopening it.
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

**Decision E7: one shared throat**, built by extending the aperture recess.
`station-mesh.ts`'s `buildAperture` is already one function, called by **every**
form at a per-form face depth, and it reads `STATION_GEOMETRY` — so the throat
inherits the aperture's dimensions, a retune of the slot moves it, and **which
forms get a throat is decided by `aperture.kind`, not by a list here.** (An
earlier draft said "all eleven slot-bearing forms" and a later one replaced it
with a different count. Both were wrong, and the second was wrong *inside a
sentence correcting the first*. The rule this section is now following is the one
it stated: prose does not hold counts.) Distinct interiors per form were
declined: form-authoring effort spent on a surface
seen for a few seconds down one axis, and #56 withdrew its outline-identity gate
on the neighbouring principle that a metric should not drive a design.

**Decision E8: pads get a touchdown, not a throat.** A pad is an exterior deck —
the Warren's notch, the Derrick's top deck — with no inside. So the rule is one
and the presentation is two: crossing the aperture with every check passed hands
the ship to a scripted arrival, which flies *into* a slot and *down onto* a pad.

**This does not reopen `station-types.md` §6.** That decision fixed the number of
docking *interactions* at two, and an interaction there is an approach and its
checks — which stay exactly as ratified, the pad being the slot minus check 4
(pinned by `tests/docking.test.ts`'s `describe("§9.1.6 the pad is the slot minus check 4")`, verified against the file rather than remembered). An arrival is downstream of the checks.

### 12.5 The name shield

**Decision E9: a station carries a generated name, and the arrival shows it.**
`Station.id` is `"station-trade"` and `station.ts` is explicit that it is a lookup
key rather than a name; `localCarrierId` is the persistence key. The name is a
third thing.

**Derived, never drawn** (derived here, not decided in session). A new draw from
any existing domain tag shifts every station generated after it and moves
`tests/station-orbits.test.ts`'s committed fixture — the coupling `station.ts`
documents at length, and the reason the refinery draws a spin it discards. A name
that is a pure function of names that already exist costs no stream.

**What it is a function of, stated because the obvious answer collides.** "System
plus parent planet" is not enough: `system.ts` picks the shipyard's host from
`[primary, ...gasGiants]` at random, so **a trade station and a shipyard can orbit
the same planet** and would derive the same name. And the refinery is
`parentId: null` — star-centric in the belt — so it has no parent to derive from
at all.

So the derivation is a function of the **system name and the station's type**, and
the parent planet is at most a decoration on top of that. Type is already unique
per station within a system (`system.ts` places at most one of each), so this is
uniqueness by construction rather than by a check.

**Uniqueness here means *within a system*, and that is all this name needs.**
Two systems can share a name — `galaxy-generation.md` §9's obligation 6 asks only
to "record the duplicate rate" over the 2048 records, so duplicates are expected
rather than prevented — and two identically-named systems therefore carry
identically-named stations. That is not a defect: the name is displayed in the
throat you are flying down and in a target list for the system you are in, always
in a context that disambiguates it. **Nothing in §12 requires a globally unique
station name, and a reader should not infer one** from obligation 10, which
asserts within-system uniqueness because within-system is the scope that matters.

**Within that scope, what breaks it is a second station of one type in one
system — and nothing else.** A *new* station type does not: `station.ts` already
declares four, and a fifth still leaves each system with at most one of each. (An earlier draft
claimed a fourth type would break this and would be caught by a compile error.
Both halves were wrong — the fourth type already exists, and the compile-time
guarantee it invoked belongs to `Record<StationType, …>` tables, which a name
derivation need not be.)

The remedy, and who applies it: **append `localCarrierId` as a discriminator** —
appended, so an existing station's name never moves when a second one appears
beside it. **§12.6's obligation 10 failing is the trigger**, and the fallback
ships with the generator change that caused it rather than being deferred. A
silent break with a detecting test and an unassigned remedy is a red test with no
owner.

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
10. **Station names are unique within a system.** E9 argues uniqueness by
   construction — one station per type — and construction is exactly what a
   generator change can break without a compile error. Asserted over the same
   corpus `tests/station-orbits.test.ts` walks, so the silent case has a check.

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
4. **A generated station name ripples further than this section** — #11's galaxy
   map, #69's target list and #70's screen all acquire something to display, and
   none of them has been told.
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

7. **A form's aperture face and §3's plane are two different surfaces, and on
   some forms they are far apart** (#77). §12.2's docked position is a function
   of the **plane**, which is `coreRadiusKm`; a form cuts its aperture wherever
   its own geometry has a face. On the forms the game builds they agree closely
   enough that the ship parks inside the drawn recess, and
   `tests/station-mesh.test.ts` asserts exactly that. On three workbench
   alternates they do not — the trade **Ring** cuts its slot on a hub at about a
   third of the core radius, and two pads carry their deck at a face their
   silhouette put elsewhere — so selecting one of those would park a ship in
   solid hull. Pinned as an inventory rather than left as prose, so that
   selecting one, adding a form like them, or fixing them all make the test
   speak. `outpost a` is on that list *and* is its role's selected form, which
   is only harmless because joint 5 above records that no outpost is generated.

8. **The drawn slot's roll does not mirror `slotBasis`, and the obvious repair
   makes things worse** (#77). `main.ts` aims a station with
   `setFromUnitVectors`, the shortest turn taking local +Z onto the aperture
   axis, which leaves the roll about that axis arbitrary — so the slot a player
   *sees* is at an unknown angle to the frame check 4 is evaluated in. A ship
   parked by §12.2 therefore sits visibly askew in its own slot, and a pilot
   rolling by eye can miss check 4 by up to 90°, which is part of why §3.2 set
   that tolerance wide. Aiming the mesh on `slotBasis` instead was built and
   withdrawn inside #77: `anyPerpendicular` chooses its seed on a `< 0.9`
   branch, so the reference **jumps** as a station's axis swings round its
   orbit and the drawn hull snaps with it — `probe-station.mjs`'s repeat control
   went from 0.02 to between 0.05 and 0.21. The fix is a *continuous*
   phase-zero reference, decided where the convention is defined rather than at
   the line that reads it, and it is a node of its own.

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
