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

### 2.1 Damage shape (derived), scale (#8's)

On a failed entry, damage is applied to shields first and hull after:

```
damage = DAMAGE_SCALE · (v_rel / V_GATE)²
```

`DAMAGE_SCALE` is #8's, because it is denominated in #8's shield and energy
pools. Two properties of the shape are fixed **here**, because they are what
makes D1 true rather than aspirational:

1. **At `v_rel = V_GATE`, a failed entry from full health is survivable with
   margin** — at most a quarter of the combined shield-and-hull pool. This is
   D1 as a checkable predicate, and #8 inherits it as a bound on
   `DAMAGE_SCALE`, not as advice.
2. **It is quadratic, so recklessness still kills.** Hitting the slot at the
   2 km/s assist cap is 20× the gate and therefore 400× the damage. Death
   returns as the outcome of flying at a station rather than as the default
   outcome of a missed roll — which is the distinction D1 was actually drawing.

---

## 3. The checks

**Decision D2: four checks, widened, plus a closing-speed gate.**

1984 ran five (research §4). Two of them — the ~26° nose-vector test and the
~22° approach cone — are near-duplicates: both ask *am I on the axis*, one from
the station's side and one from the player's. They merge.

| # | Check | Tolerance | 1984 |
|---|---|---|---|
| 1 | **Not hostile** | `station.hostile === false` | bit 7 of byte 32 |
| 2 | **Axis alignment** — **both** the station→ship vector **and** the ship's nose, each against the docking axis | ≤ **35°** each | 26° nose + 22° cone, merged |
| 3 | **Inbound** — the axial component of `v_rel` points into the slot | sign test | sign of z |
| 4 | **Roll match** — ship's up-vector against the slot's long axis, in the slot plane | ≤ **50°** | 33.6° |
| 5 | **Closing speed**, in the station's frame, at the moment of slot-plane crossing | ≤ **0.10 km/s** | *had no such check* |

All five are evaluated **at the instant the ship crosses the slot plane**. A
failure of any one is a failed entry (§2). Two consequences of *that instant*
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

### 3.1 Why 0.10 km/s (derived)

The gate is the one dimension 1984 never tested, and it is added because #5's
flight model made it testable: throttle commands speed, so "arrive slow" is a
thing a player can actually do rather than a thing they can only hope for.

`0.10 km/s` is not arbitrary. It is #14's own approach clamp —
`targetKm / approachLeadS` (`src/cruise.ts:382`), with `approachLeadS = 3` —
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

### 3.2 Why 35° and 50° (chosen, not derived)

Stated plainly because §2 claims the tolerances now carry the whole skill tax,
and a claim like that cannot rest on numbers with no account of themselves.
They are **1.35× and 1.5× the 1984 widths**, and neither falls out of anything:

- **35°** has to cover what *two* checks covered. 1984's 26° and 22° tested the
  same axis from opposite ends and a ship could sit near the limit of both at
  once, so one merged 26° cone would be *tighter* than the pair it replaces,
  not equal to it.
- **50°** is where the roll match stops being a reflex and stays a tracking
  problem. At §4's fastest spinner it is still only a 5.6 s non-tracking window,
  so widening it did not remove the test.

**The counter-reading is live**: that D1 made failure cheap and every tolerance
loosened in the same breath. Nothing in this section refutes it — the answer is
that these get flown, not argued, and §11 records both numbers alongside the
0.10 km/s gate as provisional for exactly that reason. If flying says the merged
check should be 28° and the roll 40°, the spec was wrong here and nowhere else.

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

### 4.1 The slot spins in place

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
| trade station | 0.6 km | slot, 0.20 × 0.07 km, on the spin axis | toward the parent body (1984's "face nearest the planet") |
| shipyard | 0.6 km (Coriolis core) | identical slot | toward the parent body |
| refinery | 0.4 km (drum) | pad, 0.15 × 0.15 km | radially outward from the star |

**Aperture dimensions are provisional**, on the same footing as §3's tolerances:
#26 has not fixed a hull, and §10 requires the slot to admit the largest one it
introduces. Probe fixtures read the aperture from the geometry constant rather
than restating it, so a later widening moves one table and no tests.

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

Requestable when a station is the selected target and range is inside the
vicinity (10,000 km = `HANDOFF_KM`).

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
the entry condition is `grantLive && !hostile`, in that order, and #8's
legal-status decay is what later clears the hostility. There is no fine, no soft path,
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

It engages inside the vicinity with a grant in hand, flies the approach, and
docks — roughly the profile a competent pilot flies, no ceremony and no penalty.
Any control input cancels it.

**It never bypasses a check.** It satisfies §3's five conditions like anything
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

1. **The five checks as pure functions**, table-driven over relative pose and
   velocity, including the boundary rows at exactly 35°, exactly 50° and exactly
   0.10 km/s. Tolerances are data, not literals repeated per test.
2. **The frame regression.** A station at 1 AU moving at 30 km/s star-centric:
   a ship co-moving with it at 0.05 km/s relative **passes** the gate; a ship
   stationary in star-centred coordinates **fails** it. This is #10 §11.1's
   warning turned into a test rather than left as prose.
3. **The pad is the slot minus check 4** — the same fixture run against both
   interactions, asserting the only differing outcome is the roll row.
4. **Spin generation**: range `[0.6, 3.0]` for the two Coriolis types, exactly
   0 for the refinery, drawn from `DOMAIN.STATION_SPIN` and from no other tag;
   a determinism fixture; and the measured fraction above 2 rpm asserted over
   **10,000 stations drawn from a fixed seed set, `|p̂ − 0.417| < 0.015`**.
   §4's "the hard end is common" is a claim about a distribution, and a
   distribution claim with no N and no bound is an assertion that cannot fail —
   the defect §9.1.5's "byte-identical" exists to avoid.
5. **`radiusKm` shifts no stream** — the existing `tests/station-orbits.test.ts`
   fixture is byte-identical before and after the field is added.
6. **The clearance state machine**, including `queued` and `denied`, driven by
   an injected occupancy input (§6.1). Barging without a grant asserts both
   outcomes: failed entry *and* station hostile.
7. **The damage predicate**: monotonic in closing speed, and a failed entry at
   exactly `V_GATE` from full health leaves at least three quarters of the pool.
   The test is written against #8's scale as a parameter, so it constrains #8
   rather than waiting for it.
8. **The docking computer satisfies §3** — a headless run from the vicinity to
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
4. **A scripted mis-rolled approach fails and survives** — the same profile with
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
  is only true once it exists. It also owns `DAMAGE_SCALE` under §2.1's two
  bounds; the
  legal-status predicate behind §6's shipyard scan and the decay that clears
  station hostility; and the NPC traffic that replaces §6.1's injected
  occupancy. It inherits §9.1.7 as a test it must satisfy, not author.
- **The HUD node** — inherits §8's two cues.
- **#26 (ship roster)** — the slot at 0.20 × 0.07 km must admit the largest hull
  it introduces; if it does not, the aperture moves, not the tolerance.
- **#7 (economy)** — unamended. The docking computer stays 1,000 Cr, universal.

---

## 11. Weak joints, recorded not reopened

1. **The skill tax is early-game only** (§7.1). Named at decision time; the
   remedy if playtesting wants one is the price, not the tolerances.
2. **The queue is specified against traffic that does not exist** (§6.1),
   mitigated by injected-occupancy tests rather than by a promise.
3. **A 3 rpm station can be anyone's second dock** (§4). Accepted as the cost of
   an uncorrelated dial.
4. **Three numbers are derived or chosen, not flown** — the 0.10 km/s gate
   (§3.1), and check 2's 35° and check 4's 50° (§3.2). They are where this spec
   is most likely to be wrong, and §9.2's probes are where that shows up.
5. **Nothing owns repairing the damage D1 inflicts.** Handed to #8 (§10) rather
   than invented here, because it is denominated in #8's pools and #7's table is
   deliberately unamended. Until it lands, D1's failure model is *survivable*
   but not yet *costly* — the punishment is real and the bill is unwritten.
