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
| 2 | **Axis alignment** — angle between the docking axis and the station→ship vector | ≤ **35°** | 26° nose + 22° cone, merged |
| 3 | **Inbound** — on the outer side of the slot plane, and closing | sign test | sign of z |
| 4 | **Roll match** — ship's up-vector against the slot's long axis, in the slot plane | ≤ **50°** | 33.6° |
| 5 | **Closing speed**, in the station's frame, at the moment of slot-plane crossing | ≤ **0.10 km/s** | *had no such check* |

All five are evaluated **at the instant the ship crosses the slot plane**. A
failure of any one is a failed entry (§2).

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

`0.10 km/s` is not arbitrary. It is `vicinityKm / approachLeadS` evaluated at
300 m — #14's own approach clamp, extended to the last three hundred metres. A
player who flies the final approach at the same law cruise used to deliver them
passes the gate without being told the number. Braking to it from the 2 km/s
assist cap costs `(2² − 0.1²) / (2 · 2)` = **1.0 km**, which at §5's 0.6 km
station radius is a station-and-a-half of runway — visible, and the reason the
number is not tighter.

The clamp itself is cruise-only, so this coherence is a mnemonic, not a
mechanism. **Confirm by flying it** (§7.2) before treating 0.10 as settled;
it is the number in this spec most likely to move.

---

## 4. Spin: the difficulty dial

**Decision D3: `spinRpm` draws uniform on [0.6, 3.0] for the two Coriolis
types, 0 for the refinery pad — wide, and uncorrelated with anything.**

#13 §8.4 required the field and handed its range here, saying the range *is* the
difficulty dial. What spin costs is that the roll match must be **tracked**
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
That is accepted, not overlooked: with D1's damage-not-death it costs a repair
and a second attempt, and the correlation cascade (#6) is already dense enough
that adding difficulty to it would make one more thing predictable from the
system record.

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

The shipyard's drydock frame (#13 §7) extends to roughly 1.5 km and is **not
dockable geometry** — it is silhouette. Docking geometry is a drawn object and
inherits the map's distance rule (#13 §6, *Layering*): near layer within
`HANDOFF_KM` of the camera, far beyond it, hysteresis band. It does not get a
fixed layer for being "close by".

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
| **granted** | slot free, station not hostile, scan passed | a 180 s window in which check 1 can pass. Expiry returns to `none`; re-request is free |
| **queued (n)** | slot occupied | promoted when a slot frees |
| **denied** | station already hostile, or #13 §5.1.1's shipyard contraband scan fails | no window; the reason is #8's to compute |

**Clearance is mandatory in effect, and that is deliberate.** Crossing the slot
plane without a live grant turns the station hostile at that instant — which
fails check 1 — so the entry is a failed dock under §2 *and* the station is now
hostile until #8's legal-status decay clears it. There is no fine, no soft path,
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
input in the headless tests** (§7.1), so they are exercised code from the day
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
   a determinism fixture; and the measured fraction above 2 rpm pinned at
   41.7% ± sampling error, because §4's "the hard end is common" is a claim
   about a distribution and claims about distributions get measured.
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

- **#8 (combat)** — owns `DAMAGE_SCALE` under §2.1's two bounds; the
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
4. **0.10 km/s is derived, not flown** (§3.1). It is the number in this spec
   most likely to move, and §9.2's probes are where it will move.
