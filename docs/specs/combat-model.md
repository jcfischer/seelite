# Combat model

> Resolves [#8](https://github.com/jcfischer/seelite/issues/8). The player and principal confirmed this direction through one-decision-at-a-time grilling.

## 1. Combat contract

Combat is a readable 3D pursuit duel, not a twitchy one-pass kill or a missile-only exchange. The player tracks targets with a **fixed forward weapon** while assisted-Newtonian momentum, nose direction, and velocity can disagree. The player may use flight assist on or off; combat mechanics must remain valid in either mode. NPCs normally use assist on. Cruise is a third permanent regime and is shared by player and NPCs for transit and interdiction.

Every combat ship obeys the same movement, collision, weapon, energy, shield, and damage rules. AI selects an intent—intercept, attack run, break to recharge, flee—rather than receiving concealed handling, aim, or resource advantages.

## 2. Weapons and defense

- **Lasers:** only a forward **pulse** starter laser and an expensive forward **beam** upgrade. Both consume the shared energy bank and build heat; heat causes a temporary firing lockout. The beam has higher damage and heat. The screen-clearing energy bomb is excluded.
- **Shields:** separate fore and aft pools. Incoming direction selects the pool; depleted shields pass damage to persistent hull damage. The shared energy bank recharges the lower shield first, so weapon fire and recovery compete.
- **Missiles:** a target must remain in a forward acquisition cone through a short, uninterrupted lock. Breaking line of sight or cone breaks the lock. Launch warns the target; maneuvering and a consumable ECM provide counterplay. An uncountered missile destroys a standard light combat ship and inflicts a large, but not automatically lethal, hull hit on tougher ships.
- **Pacing target:** tune a matched starter duel with a prototype: 20–30 seconds of sustained pulse fire destroys an unshielded hull; shields, breaks, and energy decisions make a typical duel 60–90 seconds.

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
own assist uses (`DuelPilot.frameVel`). It had held speed in the star's frame,
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
against a raider (106 shield, 81 hull, 6 damage/s); a real duel is longer, by the share
of time off target.

**The g loads are arcade, and stay so.** Thrust is about 204 g for the courier
and 274 g for the raider, and a turn at the 2 km/s combat speed is about 180 to
220 g. A trained pilot sustains about 9 g, and a 9 g turn at 2 km/s is 2.5°/s
over a 45 km radius, so no dogfight could happen at that speed. The fiction is
an inertial damper, as in Elite (1984). The figures are tuned for how the fight
feels, not derived from physics (`src/hull.ts`).

## 3. Interdiction and encounters

Piracy appears through cruise interdictions, not arbitrary low-speed spawns around a docking approach. The initiator holds a heading lock through a brief charge; the target breaks it by changing heading to create angular separation. It is symmetric between player and NPC by rule — the player-initiated path is not built yet (#324) — and success drops both into normal flight. Cruise re-entry retains its existing spool-up and damage-cancellation rule.

**The lock is on heading, and holding it costs turn authority (#324, principal's ruling O1, 2026-09-14).** A lock on *bearing* was built first and swept: cruise speed decided it rather than the pilot. With a raider pursuing a courier from 30 km at a 15° cone, no turn broke it at 3,000 km/s or below, a full turn broke it in a fifth of a second at 10,000 km/s, and cruise reaches 23c; `scripts/measure-interdiction-contest.ts --bearing` reprints that sweep over speed and range. A plain heading match fails the other way: a raider out-turns a courier by hull law (1.10 against 0.90 rad/s), so a courier could never escape. So the lock holds while the two headings stay within a cone, and the initiator follows at a fraction of its hull's cruise turn rate while it holds one. A nimble target turning hard at once breaks it; a sluggish hull cannot. `src/interdiction.ts` owns the cone, the factor and the charge, and `scripts/measure-interdiction-contest.ts` reprints the sweep they were chosen from. In cruise the two ships ride a pinned offset — a dogfight controller capped at 2 km/s cannot fly at cruise speed — so positions are read only when a contest begins.

**Raiders are named, enumerated carrier slots** (principal's ruling, 2026-09-14): one to four per system by government, keyed `raider-00` upward, and a system can hold more than one because several may attack together later. A cruise leg's chance of an encounter falls with law from Anarchy to Corporate State, and a Corporate State keeps a smaller chance rather than none. A raider appears behind, alongside or ahead of the player. `src/raider-slots.ts` owns the slot count, the chance and the draw.

System law supplies the baseline danger, cargo value makes a route attractive, and combat rating chooses a fair encounter composition. Rating does not secretly change enemy stats or simply increase spawn frequency. Harder encounters are small role-based groups: interceptors pressure escape, strikers attack, and higher-risk groups may add a missile carrier or tougher leader. Ships break to recharge or flee when outmatched.

## 4. Consequences, reward, and law

A resolved encounter changes a named carrier rather than deleting a generic spawn. Defeating it records player provenance, removes its route threat, and derives a visible 30-minute game-clock lifecycle from **destroyed** through **repairing** to **replaced**. This is a revisitable operational consequence, never territory control.

Rewards are weighted combat-rank credit, recoverable cargo, and lawful bounties only for sanctioned targets. There is no universal cash bounty. Combat rank retains Elite's named ladder and near-doubling thresholds, with weighted credit so weak-ship farming is inefficient.

Legal status is per galaxy, bounded, and visibly presented as **Clean**, **Wanted**, or **Fugitive**. Offences add heat; thresholds determine police response and shipyard hostility. Heat decays lazily against the authoritative game clock with a 30-minute clean-play half-life, visibly stepping back through the states.

Shipyards always scan for contraband on approach; police scan after an interception. Trade stations and refineries do not silently scan. A failed scan confiscates illegal cargo, adds heat, and can make arrival hostile. Ejecting before any scan legally abandons contraband, but irretrievably loses all cargo and consumes the escape pod; it cannot clear heat already earned. The existing 1,000 Cr escape-pod insurance model applies: respawn at the last docked station with ship and fitted equipment, while cargo and undocked gains are lost. Death without an escape pod remains owned by the future save/permadeath decision.

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
frame, plus a small spread, and expires five minutes after the kill. It kept
all of it at first. A fleeing raider dies at the 2 km/s assist cap, so its
canisters held their range against a ship at the same cap, and the third
playtest could not reach one; the fifth is the principal's ruling. The player's ship scoops one by passing within 50 m at under
0.25 km/s relative, with no module, into the hold if it has room. No raider or
Traffic actor scoops yet. Canisters are flight
state and are not saved. A reload or a jump loses them, which a five-minute
lifetime makes a small loss.

## 5. HUD and verification

The cockpit HUD must show selected-target identity and range, computed laser lead, missile-lock state, incoming-missile warning, fore/aft shields, energy, laser heat, legal status, and the existing attitude/velocity-vector instruments.

Headless tests own deterministic damage, energy, heat, missile-lock state, legal-heat decay, encounter-table bounds, AI intent transitions, and carrier recovery. Browser probes own cockpit-visible target selection, lead marker, lock and warning states, and all combat HUD gauges.

## 6. Follow-up

A prototype must tune the stated pacing, validate lock/interdiction readability with the actual flight model, and establish concrete numeric balances before implementation. Cargo recovery and the exact persistent-carrier data representation must use the world-state doctrine rather than introduce an unbounded encounter ledger.
