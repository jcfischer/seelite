# Combat model

> Resolves [#8](https://github.com/jcfischer/seelite/issues/8). The player and principal confirmed this direction through one-decision-at-a-time grilling.

## 1. Combat contract

Combat is a readable 3D pursuit duel, not a twitchy one-pass kill or a missile-only exchange. The player tracks targets with a **fixed forward weapon** while assisted-Newtonian momentum, nose direction, and velocity can disagree. The player may use flight assist on or off; combat mechanics must remain valid in either mode. NPCs normally use assist on. Cruise is a third permanent regime and is shared by player and NPCs for transit and interdiction.

Every combat ship obeys the same movement, collision, weapon, energy, shield, and damage rules. AI selects an intent—intercept, attack run, break to recharge, flee—rather than receiving concealed handling, aim, or resource advantages.

## 2. Weapons and defense

- **Lasers (#870):** forward Pulse, Beam, Military and Mining hardpoint modules read their size and grade from the approved catalogue (`src/module-catalog.ts`). Every laser in the armed fire group fires together; damage, energy draw and heat sum on the shared bank and heat gauge. Shield recovery spends first. A volley the remaining bank cannot afford does not fire; the existing heat lock and release apply to the whole group. Mining does 10% of the equivalent Pulse laser’s hull damage (principal, 2026-10-11), and contributes no fitted combat DPS. Asteroids and actual ore extraction are owned by #872. The screen-clearing energy bomb is excluded.
- **Shields:** separate fore and aft pools. Incoming direction selects the pool; depleted shields pass damage to persistent hull damage. The shared energy bank recharges the lower shield first, so weapon fire and recovery compete.
- **Missiles:** a target must remain in a forward acquisition cone through a short, uninterrupted lock. Breaking line of sight or cone breaks the lock. Launch warns the target; maneuvering and a consumable ECM provide counterplay. An uncountered missile destroys a standard light combat ship and inflicts a large, but not automatically lethal, hull hit on tougher ships.
- **Pacing target:** tune a matched starter duel with a prototype: 20–30 seconds of sustained pulse fire destroys an unshielded hull; shields, breaks, and energy decisions make a typical duel 60–90 seconds.

### Missiles and E.C.M. (node #874)

A fitted hardpoint rack carries its catalogue capacity as whole rounds. F7
(rebindable) launches one round at the selected live ship after 1.5 uninterrupted
seconds inside the 12° forward sightline cone, within 12 km and with no solid
blocking the sightline. A changed target or broken cone/visibility resets the
lock. Missiles stay outside the laser/scanner fire-group cycle. Equipment's
REARM buys as many missing rounds as the wallet affords, at 30 Cr each. The
rack's remaining ammunition is saved; missiles in flight and acquisition are
transient, like laser tracers and the encounter itself.

Initial seeker tuning is 6 km/s in the fight's translating frame, 0.8 rad/s
turn authority, an 80° seeker cone and 12 seconds of life. A swept hit spends
240 damage through the ordinary facing shield and hull path: lethal to a
whole courier or raider, survivable by a freighter. A hard jink can lose the
seeker; cruise leaves the exchange behind. A hit on ordinary traffic retains
its hail, diversion, offence, destruction and cargo consequences.

F8 (rebindable) pulses the fitted E.C.M. It defeats incoming missiles inside
the fitted `radiusKm` **at the press**, including the radius boundary: 1E is
2 km, 3A is 6.75 km. A pulse reserves one second of the catalogue's active
draw upfront (8 E for 1E); an insufficient bank refuses the entire pulse.
Cooldown is 8 seconds divided by the grade's output scale: E 8 s, D 10 s,
A 5.33 s. Multiple modules use the greatest radius, without multiplying it or
bypassing cooldown. The Equipment preview prints signed radius, cooldown and
active draw changes. No E.C.M. ammunition item is consumed; the earlier
"consumable ECM" wording above is superseded by #867 D5's energy-bank module.

The cockpit names ammunition, lock progress, incoming range, E.C.M. readiness
and refusals on a dark plate. A raider's carrier-instance seed draws a rack
on its own domain tag (35% initial frequency), preserving its stock laser.
It uses the same acquisition and ammunition rules, waits eight seconds before
the first launch and between launches, and holds at most one incoming missile
in flight. This implements the missile-bearing slice of D16; broader NPC
catalogue grades and fitting drops remain separate work.

### 2.1 The gimbal and the g loads (#324, the principal's rulings)

**The pulse laser is gimballed.** The beam turns toward the **selected target**
while that target is within **±6°** of the boresight. It slews at **1.5 rad/s**
and never leaves the cone; with no target, or outside the cone, it returns to
the boresight (`src/gimbal.ts`). A hit is still tested against the target's
**true hull** (a sphere of 32 m radius for the raider), by ruling. The gimbal is what
makes a nimbler ship hittable, not a larger target. The finite slew keeps a
hard jink able to break the aim for a moment.

**The raider may out-handle the courier, by the same rules.** Its hull row
accelerates at 2.69 km/s² against 2.00 and turns at 1.10 rad/s against 0.90. Its
controller turns through the player's own `stepAngular`: the hull's rate limits
(1.10 rad/s pitch and yaw, 1.71 rad/s roll) and its angular acceleration
(3.65 rad/s²), so a turn builds rather than starting at full rate. The
controller asks for the fastest rate that can still stop on its heading. It had
slewed at 1.2 rad/s and rolled at 2.6 rad/s, past what its hull allows, and the
first playtest found it unhittable; the rate cap that followed still reached
full rate in one frame.

**Its assist holds speed in the player's local frame**, the frame the player's
own assist uses (`DuelPilot.frame`, across the step since #529, so it shares
the frame's acceleration too). It had held speed in the star's frame,
so beside a body moving 30 km/s the two 2 km/s caps were different speeds. One
frame for the fight, not a lookup per ship: the player's frame keeps its body
through a hysteresis band, and two lookups could pick two frames. **Not yet in
the `?combat=1` rig**, which passes no frame and still flies its striker in the
star's frame; part d2 moves the rig onto production rules.

**Shields recharge at 2 points/s**, after the 3 s delay, by the principal's
ruling after the second playtest. #48's 6/s equalled the pulse's damage rate:
every break in hits longer than the delay refilled a shield as fast as a pilot
could take it down, and duels ran extremely long. The rule is every ship's,
the player's included. A kill with every shot landing on one side is about 31 s
against a raider (107 shield since #866, 81 hull, 6 damage/s); a real duel is longer, by the share
of time off target.

**The g loads are arcade, and stay so.** Thrust is about 204 g for the courier
and 274 g for the raider, and a turn at the 2 km/s combat speed is about 180 to
220 g. A trained pilot sustains about 9 g, and a 9 g turn at 2 km/s is 2.5°/s
over a 45 km radius, so no dogfight could happen at that speed. The fiction is
an inertial damper, as in Elite (1984). The figures are tuned for how the fight
feels, not derived from physics (`src/hull.ts`).

### 2.2 What a hull has to be to be gone, and the quarter of it below which a bank buys no shield (#367)

**`HULL 0` on the glass is always a kill.** A strike that leaves a hull under
**half the print step** — half a point, since both readouts print a whole number
— finishes the ship, and it is decided in `applyDamage`, the one place hull is
spent. No consumer re-derives a threshold.

It was not, and the sixth playtest of #324 read it: the kill was `hull > 0` and
the glass was `Math.round(hull)`, so a hull of 0.4 was alive and printed
**`SHD F 22 A 22  HULL 0`**. The band was five frames wide at the pulse's rate,
and the same rounding lied about the player's own hull. The law and the glass
disagreeing is the report; the report was not a rendering bug.

**Half the print step rather than one tick, deliberately.** A tick is
`damagePerS × dt`, so a tick-shaped tolerance is frame-dependent, and #352 made
the frame time adaptive. Half the print step reads no `dt`, and it is what makes
the reading right rather than usually right: *a hull too small to print a digit
is gone.* `tests/duel-hud.test.ts` holds it as a presentation row keyed on the
print, the way the refusal tone is.

**Below a quarter of its hull, a ship's bank buys no shields.** What stops is the
bank's purchase of *shield* only: hull never recovers in a fight and the heat lock
and the bank itself keep cooling and recharging on their own rules. The gate was the
3 s delay and nothing else — time, not damage — so a raider at a third of a point
of hull, unhit for the delay, was rebuilding shields at all, on both pools, in
front of the fraction of hull left under it. The reported reading had **22 of 106**
coming back on each pool while its hull was 0.33. **A quarter** is the principal's figure
(20.25 of a raider's 81, 25 of a courier's 100). It is every ship's law, so the
player's shields stop coming back at the same share.

**It is not `FLEE_HULL_FRACTION` and does not share it.** That is the
controller's nerve for when to run; this is the shield-recharge law, which says what a
running ship can still recover. The two numbers happen to sit near each other, and one
constant for both is a coupling neither of them asked for.

**Out of the beam is out of the fight (#367).** A rout ends at the beam's own
reach — `RAIDER_OUT_OF_BEAM_KM`, the hypotenuse of `PLAYER_LASER_RANGE_KM` and the
raider's hit radius, so it cannot drift from the thing it is derived from. It
used to end at a separate `FLED_KM` of 25 km while the beam stopped at 12, and
because both ships are capped at the 2 km/s assist speed, the band between the
two was a place a fight could live forever: the playtest raider held 12.34 km for
two minutes, unhittable and unwilling to leave, its shields climbing two points a
second. **The kill is not given away, and this node claims no arithmetic for it.** The
ruling is the principal's: letting go of the throttle should not be what finishes a
fight one is winning. One row measures the near case — a raider crippled six
kilometres out, tracked at the cap and fired on, dies before it opens the gap. **No
row measures a raider crippled near the beam's edge, and nothing here promises a
pilot catches one.** What the ruling changes is the punishment rather than the
reward: throttling back to hold a target in the sights no longer walks into a hang.

## 3. Interdiction and encounters

Piracy appears through cruise interdictions, not arbitrary low-speed spawns around a docking approach. The initiator holds a heading lock through a brief charge; the target breaks it by changing heading to create angular separation. It is symmetric between player and NPC by rule — the player-initiated path is not built yet (#324) — and success drops both into normal flight. Cruise re-entry retains its existing spool-up and damage-cancellation rule.

**The lock is on heading, and holding it costs turn authority (#324, principal's ruling O1, 2026-09-14).** A lock on *bearing* was built first and swept: cruise speed decided it rather than the pilot. With a raider pursuing a courier from 30 km at a 15° cone, no turn broke it at 3,000 km/s or below, a full turn broke it in a fifth of a second at 10,000 km/s, and cruise reaches 23c; `scripts/measure-interdiction-contest.ts --bearing` reprints that sweep over speed and range. A plain heading match fails the other way: a raider out-turns a courier by hull law (1.10 against 0.90 rad/s), so a courier could never escape. So the lock holds while the two headings stay within a cone, and the initiator follows at a fraction of its hull's cruise turn rate while it holds one. A nimble target turning hard at once breaks it; a sluggish hull cannot. `src/interdiction.ts` owns the cone, the factor and the charge, and `scripts/measure-interdiction-contest.ts` reprints the sweep they were chosen from. In cruise the two ships ride a pinned offset — a dogfight controller capped at 2 km/s cannot fly at cruise speed — so positions are read only when a contest begins.

**Raiders are named, enumerated carrier slots** (principal's ruling, 2026-09-14): one to four per system by government, keyed `raider-00` upward, and a system can hold more than one because several may attack together later. A cruise leg's chance of an encounter falls with law from Anarchy to Corporate State, and a Corporate State keeps a smaller chance rather than none: **60% of legs in an Anarchy, 20% in a Corporate State**, linear between (the principal's ruling, 2026-09-15, raised from 50% and 5%). A new game starts in an orderly system — `startSystem` admits government 5 to 7 — where 5–18% meant a raider on one leg in six to twenty; at 20–31% it is about one leg in three to five. **The ruling flattens the law gradient**: an Anarchy was ten times as dangerous per leg as a Corporate State and is now three times, so lawful space carries a real share of the danger rather than a token one. These are the chances of the **draw**. A leg meets a raider only if the drawn slot is operational, and a government 6 or 7 system has one slot, so after a kill there it meets none for the thirty minutes the slot is destroyed or repairing (§4.1). Raiders are part of normal play and need no flag. `?raider` forces one onto every leg for a playtest, and `?raider=off` draws none, for the probes and captures that cruise to measure something else (arrival, detours, traversals); neither stops `forceRaider`. A raider appears behind, alongside or ahead of the player. `src/raider-slots.ts` owns the slot count, the chance and the draw.

**The pirate relay is a dial on the leg law (#43, production since #351).**
A system's relay is active by a seeded roll that falls with government, 80% in
an Anarchy to 10% in a Corporate State, and watches one station's route
(`src/pirate-relay.ts`): a leg whose target is that station meets a raider on
**90%** of legs while the relay is operational and on **no** leg while it is
destroyed or repairing, and every other leg keeps the chance above. The dial
moves the chance's threshold and not the draw.
Destroying it is the first #41 loop on infrastructure in the game (the raider kill above was the first on a ship) — found by its signal,
identified inside 150 km, spent by ten seconds of pulse fire, replaced an hour
later on the clock. `docs/prototypes/relay-codex.md` carries the prototype's
decisions and `scripts/measure-relay-route.ts` what the dial measures.

**The relay calls a defender, and it is the one encounter outside cruise
(#511, built in #515).** The first hit on the relay or its repair tender calls
a raider that drops in beside the pilot a few seconds later, inside beam range
and at rest in the frame the fight is flown in. It is not the arbitrary
low-speed appearance the paragraph above rules out: it is called by the
pilot's attack, and a pilot who only passes calls nothing. Who answers is the leg law's
rule — a seeded draw over the system's slots, and nobody if the drawn slot is
destroyed or repairing. A hit calls only while no encounter is live and the
target has not been answered; a defender's end re-arms the next hit, and a call
that sent nobody answers that target instance for the visit. `?raider=off`
calls none. `src/relay-defender.ts` owns the delay, the range and the call rule.

System law supplies the baseline danger, cargo value makes a route attractive, and the pilot's combat rung chooses a fair encounter composition ([#563](https://github.com/jcfischer/seelite/issues/563) owns how). The rung does not secretly change enemy stats or simply increase spawn frequency. Harder encounters are small role-based groups: interceptors pressure escape, strikers attack, and higher-risk groups may add a missile carrier or tougher leader. Ships break to recharge or flee when outmatched.

**Out of the beam is out of the fight** is §2.2's routing rule, not a duel rule: the
encounter, not `stepDuel`, decides it.

## 4. Consequences, reward, and law

A resolved encounter changes a named carrier rather than deleting a generic spawn. Defeating it records player provenance, removes its route threat, and derives a visible 30-minute game-clock lifecycle from **destroyed** through **repairing** to **replaced**. This is a revisitable operational consequence, never territory control.

Rewards are weighted combat-rank credit, recoverable cargo, and lawful bounties only for sanctioned targets. There is no universal cash bounty. Combat rank is one of three ladders ([#183](https://github.com/jcfischer/seelite/issues/183)), and it does **not** retain Elite's named ladder: the map's Constraints forbid Elite's names, so its nine rungs carry original ones. Each rung costs exactly twice the one below (#562 D1). A kill pays Elo-like credit, 2·S_target / (S_own + S_target), from the fitted ship’s strength: the sum of all fitted combat lasers, regardless of the armed group (#870). Mining lasers and carried fittings add nothing. NPC targets still use their actual single Pulse rate until seeded NPC loadouts ship. A much weaker target pays close to nothing and an unarmed target pays nothing (#562 D3, D4). Credit earned in flight is banked on the next dock and lost with the ship before it (#183 D7). `src/ladder.ts` owns the thresholds, names and gates; `src/kill-credit.ts` owns the price of a kill.

Legal status is per galaxy, bounded, and visibly presented as **Clean**, **Wanted**, or **Fugitive**. Offences add heat; thresholds determine police response and shipyard hostility. Heat decays lazily against the authoritative game clock with a 30-minute clean-play half-life, visibly stepping back through the states.

Shipyards always scan for contraband on approach; police scan after an interception. Trade stations and refineries do not silently scan. A failed scan confiscates illegal cargo, adds heat, and can make arrival hostile. Ejecting before any scan legally abandons contraband, but loses all cargo from the hold (a seeded share may later be recovered from the wreck, `economy-trade.md` §9) and consumes the escape pod; it cannot clear heat already earned. The existing 1,000 Cr escape-pod insurance model applies: respawn at the last docked station with ship and fitted equipment, while cargo and undocked gains are lost. The pod is manual only, as in Elite. A death without one, or without ejecting, loses the hull, its fittings and the hold, for a stock courier at the launch station with the launch credits kept. `economy-trade.md` §9 carries #660's full ruling, including the wreck a death leaves.

### 4.1 As built (#324 part d)

**The lifecycle is ten minutes destroyed and twenty repairing**, the
principal's split of the thirty above. A kill is a world-state `destroy` with
the player's provenance (`raider-wreck.ts`). It schedules its own replacement,
which starts and completes lazily on the game clock (`persistent-world-state.md`
§4), so a raider killed before the player leaves its system is repairing on
time wherever the player is. A slot that is destroyed or repairing fields no
raider. A leg that draws it meets nothing, and the draw does not move to another
slot. The **Communications** console shows the lifecycle, derived from world
state, as three lines: destroyed, under repair, and back in service.

**The recoverable cargo is one to three one-tonne canisters.** They are drawn
from the kill's own stream (`DOMAIN.CARGO_DROP`). Illegal goods weigh
`(7 − government) / 7` of a legal good, so a Corporate State's raiders carry
none. A canister keeps a fifth of the wreck's velocity relative to the local
frame, leaves the wreck at 0.15 km/s in its own direction (two canisters go
opposite ways, three go 120° apart), **slows linearly to rest 10 s after the
kill**, and expires five minutes after it. **It comes to rest in the frame of
the body the kill happened beside, as that frame stands each step** — its own
frame, carried as `frameBodyId`, and not a snapshot taken at the kill nor the
observer's. The fade finishes on time either way; what a snapshot cannot follow
is a frame that keeps turning, so beside a body a canister holding the kill's
velocity peels away from the curve the pilot's assist parks them on. On a
synthesized drop beside a station moving 29.3 km/s,
`scripts/measure-canister-drift.mjs` reads **55.0 km and still opening at
0.94 km/s** two minutes after resting, against **2.3 km and 0.0008 km/s** —
both in one run, because every row carries a frozen twin advanced by the
shipped fade against the kill's frame.

**This is not shown to be what the sixth playtest hit, and the spec said so
for a round.** A raider interdicts on a cruise leg, which lands on the order of
1e8 km from any body — far outside `NEAR_FAR_KM`, where the frozen frame and
the live one are both the star's and identical. The instrument's deep-space arm
measures a flown kill coming to rest on time and staying there, before and
after. So the drift above is a real defect found while investigating a report,
not a diagnosis of it; what the principal saw on that playtest is still open.

The frame is resolved **per canister** rather than from the player's
`localFrame()`: that follows the ship, so a pilot who kills beside a station
and flies past `NEAR_FAR_KM` would drop every canister left there to star rest
and lose them well inside their five minutes. Two playtests shaped
this. A canister kept all the wreck's velocity at first; a fleeing raider dies
at the 2 km/s assist cap, so its canisters held their range against a ship at
the same cap, and the third playtest could not reach one. Keeping a fifth
closed the range but left the canister drifting, and the fourth playtest could
not match its velocity: "they fly / whizz past on a merge". Scooping a
canister that never stops means matching a velocity no readout shows, which a
pilot can do only by reading how the marker drifts. The fade and the spread
are the principal's ruling after
that playtest; `tests/canister-scoop.test.ts` flies a pilot with only a pilot's
information to every canister of a kill (`scripts/lib/scoop-pilot.ts`). The
player's ship scoops one by passing within 50 m at under 0.25 km/s relative,
with no module, into the hold if it has room. No raider or
Traffic actor scoops yet.

**A canister is a Display contact** of its own kind, `cargo`: one per live
canister, registered while it exists and taken back when it is scooped or
expires, which also drops a lock on it. So it carries a scanner blip, a target
lock, and the cockpit Target instrument's range and **relative speed** (`REL`) —
the speed this section's gate checks, `length(sub(canister.vel, ship.vel))`
against 0.25 km/s. `hud-and-scanner.md` §3 owns that readout, where it sits and
the two forms rejected on the way to it.
The fifth playtest reported the cargo disappearing before it could be
salvaged; the principal's ruling left the five minutes alone and made the
canister targetable, because the scoop gate is a *relative speed* and a marker
with a range label shows neither the speed nor whether it is falling. An
unselected canister keeps the clustered green diamond — a kill drops them at one
point, and brackets on each are the smear the clustering exists to stop.

Canisters are flight
state and are not saved. A reload or a jump loses them, which a five-minute
lifetime makes a small loss.

### 4.2 Ordinary traffic, and the figures §4 left open (#362)

§4 names offences, thresholds and heat without figures; `civilian-combat.md`
owns them — what an offence against a Clean carrier costs, where Wanted and
Fugitive begin, and the cap (H4). An ordinary carrier is a combat ship under
§1's rules on its own hull (H2), a destroyed one goes destroyed → repairing →
replaced on the raider's figures (`RAIDER_WRECK_S`, `RAIDER_REPAIR_S`, reused
by `trafficDestruction`; no H decision sets them) and returns as a new instance
(H1), and its drop is the manifest
`carrier-identity.md` §3 derives, one canister per line holding that line's
tonnes (H11) — so a canister's tonnage is a field, and a scoop takes what fits.
The left console's readout shows the player's standing (H7), and §4's
"thresholds determine … shipyard hostility" is discharged by the same decision's
second half: every shipyard denies docking with the reason `hostile` while heat
is Wanted or above. A trade station or refinery turns hostile only over an
offence it saw (H5).

## 5. HUD and verification

The cockpit HUD must show selected-target identity and range, computed laser lead, missile-lock state, incoming-missile warning, fore/aft shields, energy, laser heat, legal status, and the existing attitude/velocity-vector instruments.

Headless tests own deterministic damage, energy, heat, missile-lock state, legal-heat decay, encounter-table bounds, AI intent transitions, and carrier recovery. Browser probes own cockpit-visible target selection, lead marker, lock and warning states, and all combat HUD gauges.

## 6. Follow-up

A prototype must tune the stated pacing, validate lock/interdiction readability with the actual flight model, and establish concrete numeric balances before implementation. Cargo recovery and the exact persistent-carrier data representation must use the world-state doctrine rather than introduce an unbounded encounter ledger.
