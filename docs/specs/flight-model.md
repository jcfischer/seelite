# Flight model

Author: Ivy · 2026-10-02
Status: §3's decisions were taken with the principal on 2026-10-02. §3.9 was
flown and kept on 2026-10-02 (§6), with one rule added. Ratified on
principal-approved merge, recorded in the decision node's resolution.
The principal ruled four amendments on 2026-10-02 while the substrate was built
([#619](https://github.com/jcfischer/seelite/issues/619)): two vent families
(§3.2), no hull retuned (§3.4), a bounded ease-out (§3.8.2) and the speed
demand held to the cap in a turn (§3.10). Each is marked where it lands.
§3.8.2's pointer item was flown and ruled on 2026-10-03
([#641](https://github.com/jcfischer/seelite/issues/641)). §3.8.3 follows
from §3.6 and §3.8 and is not a ruling.
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

#### 3.2.1 Every line of action meets the hull's metal (#636)

The table first put every vent on its envelope's box, and the box is not the
hull. No attitude vent's line of action met metal on any hull, and the roll
pairs passed 9 to 28 m clear of the five larger ones. The principal ruled that
the vents move onto the metal (2026-10-03).

A pair may move only in a direction that keeps it pure:

- **An attitude pair** stays a couple about its own axis. It slides along the
  axis its couple does not use: roll fore and aft, yaw up and down, pitch port
  and starboard. Each end may also stand in from the box, which shortens the
  arm.
- **A translation pair** stays a force with no torque. The retro pair moves
  toward the centreline symmetrically, and the strafe pairs move toward the
  centre of mass symmetrically.

A vent's place along its own line changes nothing it does, so the table keeps
that coordinate on the box face and the display slides the throat to the metal
(§3.8.1).

**The placement is measured, not chosen.** `scripts/measure-vent-placement.ts`
searches those freedoms on the selected variant's mesh. It takes the slide that
gives the longest arm whose lines meet metal, and it moves a translation pair
only where its box line, or one of the two lines a step inward of it, misses. `src/hull.ts` stores the result as each hull's
`ventPlacement`. `tests/vent-placement.test.ts` holds the stored row to a fresh
measurement, holds every line to the metal, and holds every pair pure on every
hull. A moved arm moves the couple, so §3.4's shares are solved against
`coupleArms` and not against the envelope. Every composed demand is unchanged:
a pair fires as a pure couple or a pure force, as before. The instrument prints
each arm as a share of the box's.

**A lone vent is no longer pure, by the principal's ruling (O4, 2026-10-03).**
A roll pair slid fore or aft is still a couple. But one roll vent fired alone
now pitches as well as rolls, by up to 4.6 times its roll torque on the
voyager. One yaw or pitch vent off the centreline also rolls a little (up to
0.33 times, on the tug). Before #636 every lone vent's torque was on its own
axis. Only §3.5's per-vent commands and §3.7's vent health reach a lone vent.
The alternative kept the roll pair at the centre station and stood it in from
the box. A lone vent stayed pure, but the roll share rose by up to 413%
(interceptor). The principal chose the slide.

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

**Built by #620.** The four strafe commands are `fly.strafePort`,
`fly.strafeStarboard`, `fly.strafeDorsal` and `fly.strafeVentral`; the slot
commands are `vent.<slot>` in camel case, one per `VENT_SLOTS` entry. A slot
command ships an `unbound` placeholder row, because a rebind moves a trigger and
the store saves moves, so a command with no row could never be bound. It is
held, and binds to a key only: a held pad button has no reader yet (#496).

**Ruled by the principal on 2026-10-03, accepting what #620 built:**

- **The pad.** The left stick's vertical axis was the one free axis, so it
  carries the vertical strafe (up is up). The lateral strafe has no pad axis
  without moving a binding #283 accepted, so it is on the arrows only.
- **The speed lever with the assist off.** It does not move: `shift` and
  `control` fire the drive and the retro vents while held, and the lever keeps
  the speed the assist holds when it is switched back on.
- **The triggers with the assist off.** They are an analog force on the same
  axis as `shift` and `control`, rather than a trim of a lever that does not act.

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
  vent bank). The firing table is the sim's, and the display draws from it.

**Built by #621.** `hud-and-scanner.md` §4.1 owns the pulse: which marker
answers which family, and what counts as saturated. `src/vent-plumes.ts` draws
the plumes, beside the hull's root and not inside it, so a plume cannot move
the envelope. Two things it settled:

- **A full burn toward a commanded speed is not saturation.** `assistDemand`
  flagged every throttle change, because the demand was larger than one step's
  authority. #5's law was always a burn at the drive's authority, so inside
  the envelope the surge demand is clamped like the stick's, and only a return
  from above the cap flags. The firing is unchanged.
- **A throat is drawn on its vent's line of action.** The table puts every
  vent on its envelope's box. A vent slid along the line its push acts on keeps
  its force and its torque, so the drawn throat is placed where that line leaves
  the metal, or, where it only passes the hull, at its closest approach. The
  main drive is drawn at the hull's own bells, whose resultant it is.
  `scripts/measure-vent-throats.ts` prints how far each throat is from metal.
  When #621 shipped, the attitude vents' lines missed every hull. #636 moved
  the pairs onto the metal (§3.2.1), so every line now meets the hull's
  selected variant, which is the mesh the game draws for it. The closest
  approach is kept as a fallback for a mesh that changes before its placement
  is measured again.

#### 3.8.2 Two departures from #5 (amended on #619)

A bounded assist cannot reproduce two things #5 did.

- **The ease-out is bounded** (ruled by the principal, and re-confirmed on the
  roster's figures). #5 stopped a released turn with
  `rate × e^(−dt/0.28)` at any authority. That asks more of an agile hull than
  its couple gives, because the peak rate scales with agility and the stopping
  time inversely: the courier's roll asks 1.7 times its couple, the patrol's
  2.2 times. Bounded by the couple, a stop from the peak rate to 5% of it
  takes up to 5.9% longer on the courier's roll and up to 15.4% on the
  patrol's, the worst on the roster; the interceptor, the one agile hull a
  shipyard sells, takes 12.7%. The slow hulls are not touched.
  `scripts/measure-vent-shares.ts` prints every hull and axis, and
  `tests/vents.test.ts` holds each under 20%. The principal ruled first on the
  courier's figure; sage found that it did not hold for the agile hulls, and
  the principal accepted the roster's figures as measured.
- **The pointer is a demand** (ruled by the principal on 2026-10-03, #641: with
  the assist off by keeping this law over a carry arm in Mechan's test below,
  and with the assist on by ruling this item as written). A mouse delta used to add to the rate directly.
  Now it asks the attitude vents for that change of rate and gets at most the
  couple's authority in one step. **What the step cannot pay is lost**, not
  carried. So a pointer faster than `angularAuthority / MOUSE_RAD_PER_PX`
  pixels a second loses the rest. That limit does not change with frame rate.
  Below about 25–34 fps on the agile hulls, `MOUSE_MAX_STEP` binds first, per
  frame. `tests/pointer.test.ts` prints the limit per hull. On the courier,
  whose limit is 1364 px/s, the principal's hardest flick on this law asked
  for 7.57 rad/s over about a second, which is roughly 3,000 px/s for the whole
  flick, and 35% of it reached the rate. So a hard flick is well inside the loss. A `carry` arm banked the unpaid part,
  decaying at 0.25 s and capped at 1 rad/s an axis, and asked for it again.
  The principal flew Mechan's test (spin hard, then stop the nose on a star in
  two or three movements) on both arms and kept this law. The carry arm was
  removed. It was not Elite's virtual stick (a deflection that returns to
  centre), and that law was not flown. How hot a pixel is belongs to the
  sensitivity node ([#640](https://github.com/jcfischer/seelite/issues/640)).
  `__seelite.pointerReadout` reads a flick's peak speed over 50 ms and,
  with the assist off, the part that reached the rate after the spike guard
  and the couple.

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
  approach figures, and `tests/aperture-fit.test.ts` re-run on #619's branch
  reads the same tightest margin, 6.6 m on the miner rolled 50° through a slot,
  as `docking.md` states. It reads envelopes, which the vents do not move.
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
substrate (a negative `LinearDemand.surge`); #620 put it on `control` (§3.5).

## 7. Owed on map #460

What damages a vent, how often, and what a damaged vent costs a pilot. The
mechanism (§3.7) is #1's. The consequence is #460's.
