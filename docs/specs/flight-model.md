# Flight model

Author: Ivy · 2026-10-02
Status: §3's decisions were taken with the principal on 2026-10-02. §3.9 was
flown and kept on 2026-10-02 (§6), with one rule added. Ratified on
principal-approved merge, recorded in the decision node's resolution.
§3.2, §3.4, §3.8 and §3.10 were amended by the principal on 2026-10-02 while
the substrate was built ([#619](https://github.com/jcfischer/seelite/issues/619)).
Each amendment is marked where it lands.
Decision node: [Fly the hull from its vents: six held thrusters, the couples
they make, and the assist as a controller on top](https://github.com/jcfischer/seelite/issues/398).

This spec owns **what moves a hull**: the vents a hull has, what one firing does
to it, what the pilot holds, and what the flight assist is. Before it, the flight
model lived in `src/sim.ts`'s comments and in #5, which closed with no receipt.

## 1. What this spec does not own

| Fact | Owner |
| --- | --- |
| The three regimes (assist on, assist off, cruise) and that each is permanent | Map #1 Constraints |
| Cruise itself: spool, nose-lock, exit conditions | `in-system-travel.md` |
| Swept collision at `MAX_DT` | #75, and the collision spec owed by #302 |
| HUD tones, the velocity-vector marker, the attitude reference | `hud-and-scanner.md` |
| The key-dispatch law: Shift/Ctrl are the throttle, Alt is the only chord prefix | #369, #377, `src/key-dispatch.ts` |
| What damages a vent, and what a damaged vent costs a pilot | Map #460 (§7) |
| The save envelope | #89, `persistent-world-state.md` |

## 2. The model this replaces

As of `origin/main` at `a3595ab`:

- `FlightControl` (`src/sim.ts`) is `{ nose, throttle, assist, frame? }`.
  `throttle` is 0…1 and means a speed with the assist on and a thrust with it
  off.
- `stepFlight` with the assist off adds `nose × thrustKms2 × throttle × dt`.
  Thrust acts along the nose only, so a hull cannot strafe or counter a drift.
- `assistedRelative` eases the along-nose speed toward
  `throttle × ASSIST_CAP_KMS`, decays lateral velocity with
  `assistLateralTauS`, and then **renormalises the total** to
  `ASSIST_CAP_KMS`. That last step removes momentum that no thruster removed.
- `stepAngular` eases each axis toward a commanded *rate* and clamps it at
  `angularMax`, in both regimes. With the assist off a released rate is not
  damped, but the clamp still caps angular momentum.
- `flightPerformance` derives everything from `thrustMN` and `massT` (#181):
  linear acceleration, and an angular authority that assumes thrusters at the
  extremities (`thrust × length` against `mass × length²`).

## 3. Decisions

### 3.1 The substrate is vents

Each vent has a position, a direction and a thrust. Force and torque on the hull
are sums over the vents that fire. (Taken 2026-09-19.)

### 3.2 A strafe fires a pair, and is clean

A fore/aft pair fired the same way is pure translation; fired opposite it is a
pure couple. A strafe or a yaw command fires **pairs**, so it is clean. One vent
fired alone both translates and turns the hull. That coupling stays, but it
comes only from a single vent fired on purpose (§3.5) or from a dead vent (§3.7).

**Amended on #619: a strafe and a turn fire different pairs.** One pair cannot
carry both of #5's figures. A translation pair has to remove drift at
`ASSIST_CAP_KMS / assistLateralTauS`, 1.67 km/s² on the courier. The same pair
fired opposite at the hull's extremities then turns the courier at about
97 rad/s², against #5's 3. Sized for 3 rad/s² instead, it removes drift about
30 times slower than #5. Every hull has the same problem. So a hull has
**translation pairs**, a short arm either side of the centre of mass, for the
strafe and the assist's drift removal, and **attitude pairs** at the
extremities for the couples. Each pair is still clean: fired the same way it is
pure force, fired opposite it is pure couple. The principal chose this over
three alternatives:

- shared pairs with the rotation capped on the demand side: an assist-off held
  key or a dead vent would spin the courier at about 97 rad/s², which breaks
  §3.6;
- shared pairs sized for rotation: drift removal 30 times slower than #5;
- a fitted moment of inertia: a second dial, which §5 says needs an argument
  against #181.

### 3.3 Each hull declares its vents

Every hull in `src/hull.ts` carries its own vent table. The table is plain data,
so `hull.ts` stays a leaf that imports nothing.

### 3.4 A vent's thrust is a share of `thrustMN`

A vent row gives a slot (§3.4.1), a position, a direction and a **share** of the
hull's `thrustMN`. `thrustMN` stays the one magnitude dial: a retune is still
one number. #181 is narrowed, not overturned. A hull now has one magnitude dial
and a fixed shape, rather than one dial alone.

**Obligation.** The courier's shares must reproduce #5's tuned figures, the way
`flightPerformance` does now. This spec gives no share values. They are derived
and measured by the implementation, never written here first.

**Amended on #619: no hull is retuned.** The principal ruled that every hull's
shares reproduce the figures #181's law gave it, not only the courier's.
`scripts/measure-vent-shares.ts` keeps that law runnable, solves each row
against it and a solid-box moment of inertia, and prints the solved rows beside
the ones `src/hull.ts` stores. `tests/vents.test.ts` holds the two equal. So the
inertia model decides nothing a pilot feels on a whole hull. It decides what a
lone or dead vent does, which is §7's. The rejected arm, the courier's shape on
every hull, would have turned the raider 1.4 to 1.6 times faster and the
voyager's roll 3 times faster.

#### 3.4.1 Vents are named by shared slots

There is one fixed slot vocabulary across all hulls, for example
`fore-port-lateral`; `VENT_SLOTS` in `src/hull.ts` owns it. A hull fills a slot or leaves it empty. Bindings (§3.5) and
health (§3.7) address slots, so a command means the same vent on every hull, and
a slot a hull leaves empty does nothing.

### 3.5 What the pilot holds

| Axis | Default keyboard |
| --- | --- |
| Pitch, yaw, roll | `w`/`s`, `a`/`d`, `q`/`e` (unchanged); the mouse for pitch and yaw |
| Fore / aft | `shift` / `control` (unchanged keys) |
| Strafe left/right/up/down | the arrow keys |

The arrow keys stop repeating pitch and yaw. Every letter key is already bound,
and the mouse and `w`/`s`/`a`/`d` keep pitch and yaw.

**A single vent can be fired directly.** Each slot gets a bindable command with
**no default key**. It is reachable for a pilot who binds it, and absent from the
default layout.

### 3.6 Keys mean different things in the two regimes (stated exception)

#398 asked for a demand whose meaning is the same in both regimes. The principal
ruled against that for the keys:

- **Assist on:** `shift`/`control` set a speed demand, as today. A held strafe
  sets a lateral velocity demand.
- **Assist off:** every held key is a force on its axis. `shift` fires the main
  drive and `control` fires the retro vents.

AI authors (raiders, Traffic, the docking computer, any autopilot) still emit
axis-level demands, and the sim composes them into vent demands (taken
2026-09-19). No caller fires a vent except through that composition.

### 3.7 Each vent has a health factor

The substrate carries a health factor in 0…1 per slot from the start. A vent's
force and torque scale by it. A dead lateral vent makes its axis pull sideways,
which only a vent substrate can express. What sets the factor is §7's.

### 3.8 The assist is a controller, bounded by its vents

The assist issues vent demands. It does not run a second integrator. Two things
follow:

- **Its authority is the vents' authority.** It removes drift as fast as the
  lateral vents can. `assistLateralTauS` becomes a demand-side dial, not a rate
  the integrator imposes.
- **It can saturate:** drift it cannot kill, or a turn it cannot stop. The HUD
  must show this (§3.8.1).

#### 3.8.1 What saturation looks like

- **The saturated marker pulses in its current tone.** No new colour: amber
  already means action, target and assist-off, and red means refusal
  (`hud-and-scanner.md` §4).
- **The firing vents are drawn.** A plume is particles or an emissive at the
  throat, never a cone (`src/station-mesh.ts` rejects a cone for the refinery's
  vent bank). The firing table is the sim's, and `src/ship-mesh.ts` draws from it.

#### 3.8.2 Two departures from #5 (amended on #619)

A bounded assist cannot reproduce two things #5 did. The principal accepted both.

- **The ease-out is bounded.** #5 stopped a released turn with
  `rate × e^(−dt/0.28)` at any authority. At the courier's peak roll rate that
  asks for 5 rad/s². Bounded by the couple's authority, a stop from the peak
  rate to 5% of it takes 3.9% to 5.9% longer on the courier's roll, by frame
  step from 1/120 s to 0.05 s, and no longer on pitch and yaw.
  `tests/vents.test.ts` holds it under 6% at 1/120 s.
- **The pointer is a demand.** A mouse delta used to add to the rate directly.
  Now it asks the attitude vents for that change of rate and gets at most the
  couple's authority in one step. The principal has not yet flown this on the
  assist-on arm.

#### 3.8.3 Every author turns a hull this way

The docking computer used to place the attitude: it slewed the nose and the up
at the hull's peak rate, with no acceleration, and zeroed the rates. Now it asks
for a stick (`src/attitude-hold.ts`), with the slot's own spin asked for on top,
and `stepAngular` turns the hull through its attitude vents. `docking.md` §4 and
§7 carry what that costs.

### 3.9 Assist-off rotation is Newtonian and uncapped

With the assist off, torque gives angular acceleration and that gives rate. There
is no rate cap. A spin continues until a counter-couple stops it. With the
assist on, the controller commands a rate and is bounded by the vents.

Angular momentum becomes state that persists: rates go into #89's envelope, and
a save taken while tumbling resumes tumbling.

**Turning the assist on above the rate cap brings the rate back by the vents'
authority.** The assist reduces each axis above `angularMax` at the hull's
angular authority until it is inside, and does not cut it in one frame. Today
that authority is `angularAccel`, a scalar stand-in; under the substrate it is
the rotational vents' couple (§3.8). Stick and pointer wait until the axis
is inside. This is the rotational form of §3.10's retro burn. The principal,
after flying it: *"newtonian movement works. Turning assist on should use the
normal physics to bring ship into envelope."*

Flown on 2026-10-02 behind `?rotation=newtonian` (#618, PR #624), and kept.

### 3.10 The 2 km/s cap stays; the clamp goes

`ASSIST_CAP_KMS` stays the game's one combat speed, the same on every hull.
It becomes the **limit of the assist's speed demand**. The renormalisation in
`assistedRelative` is removed: under vents a force that fires no vent is one the
display cannot show.

**Amended on #619: the speed demand along the nose is held to
`√(cap² − lateral²)`.** So a hard turn at the cap stays at the cap while the
translation pairs remove the drift. The renormalisation also removed that drift
faster than any vent could, so a hull now slides through a hard turn for longer
than it did under #5.

**Turning the assist on above the cap gives a retro burn.** The assist fires the
retro vents until the hull is at the cap, bounded by their authority. This takes
time, and the saturation cue shows while it does. With the assist off there is
no speed cap, as today.

### 3.11 The cruise exit is a stated exception

A cruise exit drops the hull from cruise speed to the cap. That stays a
**drive event**, not a vent burn: cruise is its own regime and the assist is not
in force inside it. No vent is drawn for it, and no momentum accounting applies.

## 4. What every implementation owes

- `FlightControl` becomes a per-axis demand (§3.6). `stepFlight` and
  `stepAngular` compose demands into vent firings and sum force and torque.
  Every caller goes through that path: `Game.control()`, the autopilot,
  `src/combat-enemy.ts`, `src/combat-rig.ts`, `src/duel.ts`,
  `src/interdiction.ts`.
- `flightPerformance` derives angular authority from each hull's actual vent
  arms and shares, not from `acceleration / length`.
- `thrustShares` (#544) reads from the vent firing table, so the flight sound
  hears the vents that fire.
- **Docking at spin is re-measured.** Roll authority now comes from the vents,
  so `scripts/measure-computer-approach.ts` is re-run, and the #26 roster fit at
  check 4's limit is re-checked. #619 did both: `docking.md` §4 and §7 carry the
  figures. The roster fit reads envelopes, which the vents do not move.
- **Rotation can tunnel.** Uncapped rotation at `MAX_DT` means an attitude, not
  only a position, can cross a thin structure in one step. The collision spec
  owed by #302 must cover the angular case.
- The frame law (#529) holds: every vent force acts on the velocity relative to
  the frame, and the ship shares the frame's acceleration in both regimes.

## 5. What this spec does not decide

- Share values for any hull (§3.4).
- What damages a vent (§7).
- Whether a hull's handling character needs a second dial. That would amend
  §3.4 and needs an argument against #181.
- **Whether the berth traversal flies through the vents.** A launch and an
  arrival are scripted: `main.ts` places the ship along the berth's path and
  zeroes its rates, as it did before #619. It is a placement, like the cruise
  exit (§3.11), and no vent fires for it. #619 found it and did not change it.

## 6. Flying §3.9 first

A flag-gated build put uncapped Newtonian assist-off rotation on today's model,
with no other change, for the principal to fly (`?rotation=newtonian`, #618).
It held, and §3.9 is no longer provisional. The flight added §3.9's rule for
turning the assist on above the rate cap.

The flag stayed until the vent substrate replaced the rotation law. #619
retired it, and §3.9's law is now the only one. §3.6's retro force is in the
substrate (a negative `LinearDemand.surge`); the keys that ask for it are
#620's.

## 7. Owed on map #460

What damages a vent, how often, and what a damaged vent costs a pilot. The
mechanism (§3.7) is #1's. The consequence is #460's.
