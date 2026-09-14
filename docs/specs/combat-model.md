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

## 3. Interdiction and encounters

Piracy appears through cruise interdictions, not arbitrary low-speed spawns around a docking approach. The initiator holds a heading lock through a brief charge; the target breaks it by changing heading to create angular separation. It is symmetric between player and NPC, and success drops both into normal flight. Cruise re-entry retains its existing spool-up and damage-cancellation rule.

**The lock is on heading, and holding it costs turn authority (#324, principal's ruling O1, 2026-09-14).** A lock on *bearing* was built first and swept: cruise speed decided it rather than the pilot. Below about 3,000 km/s no turn broke it, at 10,000 km/s any turn broke it in a fifth of a second, and cruise reaches 23c. A plain heading match fails the other way: a raider out-turns a courier by hull law (1.10 against 0.90 rad/s), so a courier could never escape. So the lock holds while the two headings stay within a cone, and the initiator follows at a fraction of its hull's cruise turn rate while it holds one. A nimble target turning hard at once breaks it; a sluggish hull cannot. `src/interdiction.ts` owns the cone, the factor and the charge, and `scripts/measure-interdiction-contest.ts` reprints the sweep they were chosen from. In cruise the two ships ride a pinned offset — a dogfight controller capped at 2 km/s cannot fly at cruise speed — so positions are read only when a contest begins.

**Raiders are named, enumerated carrier slots** (principal's ruling, 2026-09-14): one to four per system by government, keyed `raider-00` upward, and a system can hold more than one because several may attack together later. A cruise leg's chance of an encounter falls with law from Anarchy to Corporate State, and a Corporate State keeps a smaller chance rather than none. A raider appears behind, alongside or ahead of the player. `src/raider-slots.ts` owns the slot count, the chance and the draw.

System law supplies the baseline danger, cargo value makes a route attractive, and combat rating chooses a fair encounter composition. Rating does not secretly change enemy stats or simply increase spawn frequency. Harder encounters are small role-based groups: interceptors pressure escape, strikers attack, and higher-risk groups may add a missile carrier or tougher leader. Ships break to recharge or flee when outmatched.

## 4. Consequences, reward, and law

A resolved encounter changes a named carrier rather than deleting a generic spawn. Defeating it records player provenance, removes its route threat, and derives a visible 30-minute game-clock lifecycle from **destroyed** through **repairing** to **replaced**. This is a revisitable operational consequence, never territory control.

Rewards are weighted combat-rank credit, recoverable cargo, and lawful bounties only for sanctioned targets. There is no universal cash bounty. Combat rank retains Elite's named ladder and near-doubling thresholds, with weighted credit so weak-ship farming is inefficient.

Legal status is per galaxy, bounded, and visibly presented as **Clean**, **Wanted**, or **Fugitive**. Offences add heat; thresholds determine police response and shipyard hostility. Heat decays lazily against the authoritative game clock with a 30-minute clean-play half-life, visibly stepping back through the states.

Shipyards always scan for contraband on approach; police scan after an interception. Trade stations and refineries do not silently scan. A failed scan confiscates illegal cargo, adds heat, and can make arrival hostile. Ejecting before any scan legally abandons contraband, but irretrievably loses all cargo and consumes the escape pod; it cannot clear heat already earned. The existing 1,000 Cr escape-pod insurance model applies: respawn at the last docked station with ship and fitted equipment, while cargo and undocked gains are lost. Death without an escape pod remains owned by the future save/permadeath decision.

## 5. HUD and verification

The cockpit HUD must show selected-target identity and range, computed laser lead, missile-lock state, incoming-missile warning, fore/aft shields, energy, laser heat, legal status, and the existing attitude/velocity-vector instruments.

Headless tests own deterministic damage, energy, heat, missile-lock state, legal-heat decay, encounter-table bounds, AI intent transitions, and carrier recovery. Browser probes own cockpit-visible target selection, lead marker, lock and warning states, and all combat HUD gauges.

## 6. Follow-up

A prototype must tune the stated pacing, validate lock/interdiction readability with the actual flight model, and establish concrete numeric balances before implementation. Cargo recovery and the exact persistent-carrier data representation must use the world-state doctrine rather than introduce an unbounded encounter ledger.
