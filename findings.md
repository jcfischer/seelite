# Node #988 — does `sweepShip` hold a ship that is not closing, and should it?

Base: `4205a76`. Every figure below came from `.scratch/measure-zero-hold.ts`, run
at that base. It is a scratch instrument, so it is not committed; its source is
in Appendix B. `src/` was edited only for the prototype in §5, and that edit was
reverted (`git status` was clean afterwards).

## Ruling

**It is a defect. The contact law does not intend the hold.** `collision.md`
never names `CONTACT_KM`: it is the conservative advance's stopping tolerance
(`src/collision.ts:118`, "The sweep declares an impact at or under this gap").
§3's law has nothing to do for a pair with `v_n = 0`: no damage, and the bounce
leaves `u` unchanged. §3.1 lets a pair touching at the start of a step go free
when it is not closing. The same geometry reached *during* a step is treated as
an impact, and an impact owns the tick (§4.2). So a non-closing pass inside 5 cm
gets the rest of its step taken away, while a non-closing ship resting at 15 cm
does not. Nothing in the spec says why the two should differ.

The fix and its rows are in §6 as a proposed build node. I am a research worker
and do not file nodes. The proposed spec sentence: *a pair the sweep brings
within the contact distance that is not closing on the swept motion is touching,
not met. It owns no tick, bills nothing and holds nothing, and §3.1's
end-of-step settle keeps it apart.*

## F1 — the mechanism (code, plus #963's reproduction rebuilt)

- In `advance` (`src/collision.ts:1328`), `if (gap.overlap || gap.distanceKm <= CONTACT_KM) return s;`
  returns a contact time whatever the direction of motion. Each advance aims at
  `ADVANCE_TARGET_KM` (2.5 cm) using the closing component along the closest-point
  normal of the *previous* pose. When the ship passes a box's edge or corner, that
  normal turns, so the advance can land just past the gap's minimum, inside 5 cm
  and already separating.
- `resolveEarliest` then reads `closingSpeed`, which is clamped to `max(0, …)`
  (`:136`), as 0. It bills nothing. It still places the ship at the impact pose
  plus `lift = SEPARATION_KM − gap` (`:1198`), carries the ship with the solid
  for the rest of the step, and counts the event for `impactFirst` (`:898`).
- **#963's ray, rebuilt from its `.ranger-blocked.md` patch:** refinery/d,
  freighter, seed `963 + 101·6 + 7`, ray 22, still frame, 100 m/s outward. All
  three depths behave the same way:

  | depth | impact at s | closing | n·dir | gap at impact | path's min gap before it this step | after it (rest of step + 1 s) | travelled |
  |---|---|---|---|---|---|---|---|
  | 0.1 m | 0.0555 | 0 | +0.287 | 3.08 cm | 2.99 cm | 3.08 cm | 0.58 of 10 m |
  | 0.5 m | 0.0955 | 0 | +0.287 | 3.08 cm | 2.95 cm | 3.08 cm | 0.98 of 10 m |
  | 2 m   | 0.2455 | 0 | +0.287 | 3.08 cm | 2.96 cm | 3.08 cm | 2.48 of 10 m |

  The pair is **separating** at u·n = +28.7 m/s at the declared instant, which is
  0.287 × 100 m/s. The gap's minimum (≈2.95–2.99 cm) came *before* it, and the
  ship never touches box #4829. #963 quoted "3.6 cm"; that figure came from its
  0.5 m inward march, and the swept path's own minimum is ≈3.0 cm.
- **The smallest case is two hulls.** A courier flies parallel past a still
  courier box at `MAX_DT` (`.scratch/r1.ts`, Appendix B):

  | lateral clearance | 0.02 km/s | 0.1 km/s |
  |---|---|---|
  | 4.9 cm | impact, closing 0, held 0.955 m short | impact, closing 0, held 8.954 m short |
  | 5.1 cm | nothing | nothing |
  | 3 cm | impact, closing 0.0125, damage 0 | impact, closing 0.0626, **damage 5.70** (F5) |

## F2 — how often, on ordinary flight past station proxies

**The corpus.** It covers all 9 forms with a proxy (`trade/a`, `outpost/e`,
`shipyard/a–c`, `refinery/a–d`) and 2 hulls (courier, freighter). There are 3
speeds (0.02, 0.1 and 0.5 km/s) and 2 frames: still, and spinning at a seeded
0.6–3 rpm. Each cell has 150 flights on 2 seeds (988 and 1988), which makes
**32,400 flights and 11.67 M ticks**.

Each flight is a straight line through the proxy's reach sphere: a uniform
random direction, and an aim point uniform over the disc of reach radius. Its
attitude is random. Half the flights turn at up to 0.5 rad/s. Each tick of
`MAX_DT` goes through the shipped `sweepShip`, and the ship carries on with the
position and velocity `sweepShip` returns, bounces included.

Every swept impact is classified two ways:
- **Mechanism.** Was the impact declared at a gap of at most `CONTACT_KM`
  ("thr"), or above it ("cap", F3)? The box met is identified from
  `impact.point`. The ship's path in the step is rebuilt with `stopResting`'s
  correction, because without it 4 events were misread.
- **Phantom.** Does the path that went unresolved ever overlap that box,
  continuing from the impact through the rest of the step plus 1 s? An event
  that never overlaps is a phantom.

| | seed 988 | seed 1988 | total |
|---|---|---|---|
| flights / flights that met anything | 16,200 / 6,328 | 16,200 / 6,419 | 32,400 / 12,747 |
| swept impacts, all classes | 8,365 | 8,616 | 16,981 |
| **zero-closing swept holds, at the threshold (the node's case)** | 5 | 2 | **7** |
| zero-closing swept holds, advance cap (F3) | 49 | 16 | 65 |
| flights with any zero-closing swept hold | 11 | 5 | 16 |
| closing > 0, phantom, billed | 4 | 1 | 5 (of ≈9,800 billed) |
| closing > 0, phantom, unbilled | 3 | 10 | 13 |

- **The node's case is rare:** 7 in 32,400 flights. That is about 1 in 4,600
  flights, 1 in 1,800 flights that met anything, and 0.041% of swept impacts.
  - Where it happened: refinery/d courier 0.02 still ×2, shipyard/b freighter
    0.1 still, shipyard/b courier 0.5 spin, refinery/c courier 0.1 still,
    refinery/b freighter 0.5 spin, and refinery/c freighter 0.1 spin.
  - Gap at the declared instant: 3.05–4.98 cm.
  - Each is unbilled and holds the ship for the step it happens in. The step travels
    between 6% and 79% of its distance; examples are 0.63 of 10 m, 24.98 of
    50 m, 1.51 of 2 m and 7.87 of 10 m.
  - 5 of the 7 are phantoms. The other 2 come from a ship sliding on a resting
    contact, whose rebuilt path does reach the box later.
- **Most zero-closing swept holds are not the node's mechanism.** 65 of 72 come
  from the advance cap (F3), and only on spinning proxies.

## F3 — a second source of zero-closing holds: the advance cap snaps the ship toward a box

- `advance` reads running out of `MAX_ADVANCES` (64, `:129`) as an impact
  (`:1334`). Its turning bound is `ω × pair.reach` (`:1322`), where `pair.reach`
  is the **whole solid's** reach and not the primitive's distance from the axis.
  On a spinning station, a ship within a few decimetres of a primitive it is not
  touching therefore creeps forward in steps of `(gap − 2.5 cm)/(ω·R)`. It uses
  up all 64 advances and is "met".
- `resolveEarliest` then lifts it by `SEPARATION_KM − gap`. That is **negative**
  whenever the gap exceeds 10 cm, so the ship is moved *toward* the box until it
  stands at 10 cm.
- In the corpus there were 113 cap events, all on spinning frames: 65 at zero
  closing and 48 closing below `V_SCRAPE`. 73 of them were declared more than
  10 cm from the box, the largest at 44.6 cm. The largest snap toward a box was
  **34.6 cm**.
- They cluster. One trade/a flight at 0.02 km/s and 2.86 rpm was held every
  other tick for 37 ticks, each time 40.0 cm from a box and snapped to 10 cm.
- Setting `MAX_ADVANCES` to 4096 (temporarily) removed every cap event from the
  trade/a spinning rows. That confirms the cap is the source.
- This is the same symptom as the node's, with a different cause and a worse
  effect (a positional snap). It is outside this node's question, so it is
  proposed as its own node (§6, D2).

## F4 — what one zero-closing hold costs today

- **Player against a station:** zero damage, so `takeDamage` returns at once
  (`src/main.ts:13564`). The ship loses `(1−s)` of the step's travel and is set
  ~5–7 cm off the box. `collisionImpacts` and `lastCollisionImpact` record it.
- **It pre-empts a plane crossing** in that tick: `impactFirst` (`:898`) counts
  any met pair. Read from code, not measured on a docking run.
- **Ship against ship it is a meeting, with consequences.** `sweepShipPair`
  treats `impacts.length > 0` as billed (`:1438`). The pair is then split by mass
  even when B is a projected carrier, and the step's impacts land on the
  carrier's step (`src/sim.ts:2538`). `main.ts:16300` hands a projected carrier
  with any impact to flight, and an armed carrier that the pilot met becomes an
  `attacker` (`src/traffic-engagement.ts:224`).
  - Measured headlessly with two courier boxes passing parallel at 4.9 cm and
    the carrier projected (`bProjected`): an impact at closing 0, with the
    **projected carrier shoved 0.48 m at 0.02 km/s and 4.48 m at 0.1 km/s**.
  - The rest of the chain is read from the code and not run in the game. How
    often players pass a carrier within 5 cm is not measured.

## F5 — the 5 cm skin also bills passes that never touch (not this node's question)

A pass that is closing at the declared instant is billed by the same tolerance,
using the rounded-edge normal at 2.5–5 cm. In the two-hull case, 3 cm of
clearance at 0.1 km/s billed 5.70 damage. In the corpus this is 5 billed and 13
unbilled phantoms out of ≈16,980 swept impacts. That is consistent with reading
the proxy as inflated by `CONTACT_KM`. Hull boxes are themselves envelopes
rounded **up** to 0.1 m (#181), so I recommend leaving it alone (Q1).

## §5 — a prototype of the fix (reverted; diff in Appendix A)

The prototype changes `resolveEarliest` only. For a pair met without overlap, it
reads the swept geometry's own rate along the normal at the two points: relative
translation over the step, plus both turns. The declared velocities are not
used, because a fixture may leave them at rest; the first version of the
prototype, which read `closingSpeed`, went red on §9.1.12's cruise chord for
exactly that reason. If that rate is ≥ 0, the pair is made **touching** (§3.1's
`settleTouching` keeps it apart at the end of the step). It is dropped from the
sweep, and the earliest of the remaining pairs is resolved instead.

Measured with `PROTO_988=1`:
- `bun test tests/collision*`: **173 pass, 0 fail**.
- #963's ray 22 flies out unheld at all three depths: the end is the flown end.
  Re-running #963's whole reverse arm (1,680 placements), the met count goes
  **4 → 1**. The one left is the refinery/b *resting* placement, which closes at
  7.6 m/s inside `RESTING_KM`; that is a different class and is still unbilled.
- Two-hull pass at 4.9 cm: no impact. A ends 5.1 cm off its flown end (pushed
  out to `SEPARATION_KM`), and the projected carrier is unmoved. At 3 cm it is
  still an impact, so F5 is unchanged.
- Corpus, seed 988: zero-closing swept holds go **54 → 3**. Billed and unbilled
  closing counts are unchanged (4,865 → 4,865 and 3,428 → 3,429).
  - Of the 3 left, 2 are threshold events on a resting-stopped path. There the
    path does close on the box, but the velocity `stopResting` leaves untouched
    reads 0.
  - The third is a cap event that is closing.

What the prototype does not settle:
- **Turning.** With a turn, "not closing now" does not prove the rest of the
  step is clear. The prototype relies on §3.1's push-out at the end of the step,
  just as a pair touching at the start already does. That is sound for a box
  meeting a box under pure translation (the separating-plane argument). For a
  turn it is exactly as sound as §3.1 is today, and no stronger.

## Options and recommendation

- **O1, recommended:** a non-closing pair met at the contact distance becomes
  touching (the prototype). This fixes the node's case and the pair-path
  consequences, and leaves the billed behaviour alone.
- O2: translation-only. `advance` returns `null` when `turning === 0` and
  `dot(translation, n) ≥ 0`. This is provably sound but leaves the turning cases
  (half of the corpus's flights turn).
- O3: keep the hold and write it into the spec as "the contact distance owns the
  tick". **Not recommended.** It contradicts §3.1's treatment of the same
  geometry, and in the pair path it makes a pass that never touched into a
  meeting that moves a projected carrier and can arm it against the pilot.

## §6 — proposed nodes for the supervisor or principal to file

**D1, build, under this node: "A pass within the contact distance that is not closing is touching, not met".**
- Failing rows, red today, all headless:
  1. `sweepShip`, a courier past a still courier box at 4.9 cm of lateral
     clearance, at 0.02 and 0.1 km/s and `MAX_DT`. Expect no impact, and the
     end within `SEPARATION_KM` of the flown end. Today: 1 impact at closing 0,
     held 0.955 m and 8.954 m short.
  2. #963's refinery/d freighter ray 22 at 0.1, 0.5 and 2 m, flown out at
     100 m/s. Expect no impact and no hold. Today: held at s = 0.0555, 0.0955
     and 0.2455.
  3. `sweepShipPair` with `bProjected`, the same 4.9 cm geometry. Expect no
     impact and B unmoved. Today: B shoved 0.48 m and 4.48 m.
- Guards: the 3 cm case stays an impact, a head-on contact stays billed, and the
  173 existing collision tests stay green.
- Spec: add the sentence from the ruling to `collision.md` §4.1 (or §3.1). Also
  amend §4.3/§11.7's hold wording, which #963 is writing: the one-step
  zero-closing hold goes away, and #963's own row can drop the "held" allowance
  for refinery/d. The refinery/b resting case is the one left (4 → 1).
- Touches: `src/collision.ts` (`resolveEarliest` / `advance`),
  `tests/collision*.test.ts`, `docs/specs/collision.md`.

**D2, decision or build: "The sweep's advance cap snaps a ship up to 35 cm onto a box it is not closing on (spinning proxies)" (F3).**
- Options:
  - Clamp `lift` at ≥ 0, so a given-up sweep never moves a ship toward a
    surface.
  - Take the turning bound from the primitive's own distance from the axis
    (`primitiveBound`), not the whole solid's reach.
  - Raise `MAX_ADVANCES`, which costs time.
- Measured: 113 cap events in 32,400 flights, all on spinning frames.

## Questions

- Q1: F5. Should the 5 cm skin keep billing a closing pass that would have
  cleared by 1–5 cm? 5 billed in 32,400 flights; one example was 0.307
  km/s on a path whose minimum gap is 1.65 cm. I recommend keeping it.
- Q2: file D2 under #988, or under the collision build that owns `advance`?

---

## Appendix A — prototype diff (reverted, `PROTO_988=1` gate)

```diff
@@ function sweepMotion(
-	const met = resolveEarliest(sweep, swept, end);
+	const glancing: Touching[] = [];
+	const met = resolveEarliest(sweep, swept, end, glancing);
@@
 		result.impacts.push(met.impact);
 	}
+	touching.push(...glancing);
 	end = settleTouching(sweep, touching, end, met !== null);
@@ function resolveEarliest(
 	end: End,
+	glancing: Touching[] = [],
 ): { end: End; touching: Touching; impact: Impact } | null {
@@
 	const closing = closingSpeed(u, normal);
+	// The swept geometry's own rate along the normal at the met points —
+	// relative translation plus both turns — not the declared velocities,
+	// which a fixture may leave at rest.
+	const rate = dot(
+		add(
+			scale(
+				sub(
+					sub(motion.end.origin, ship.start.origin),
+					sub(solid.end.origin, solid.start.origin),
+				),
+				1 / dt,
+			),
+			sub(
+				turnVelocity(shipSpin, dt, shipAt, onShip),
+				turnVelocity(solidSpin, dt, solidAt, onSurface),
+			),
+		),
+		normal,
+	);
+	if (process.env.PROTO_988 && !gap.overlap && rate >= 0) {
+		glancing.push({ pair, normal, closingKms: 0 });
+		return resolveEarliest(
+			sweep,
+			swept.filter((p) => p !== pair),
+			end,
+			glancing,
+		);
+	}
```

## Appendix B — how to re-run

The instrument lives at `.scratch/measure-zero-hold.ts`, which is gitignored and
not committed. It needs `node_modules`; I symlinked node-963's for the test runs
and removed the link afterwards.

- `bun .scratch/measure-zero-hold.ts repro` rebuilds #963's 7 forms × 2 hulls ×
  40 rays × 3 depths, reverse flight. Set `ONLY=refinery/d` for one form. It
  takes about 2 minutes.
- `bun .scratch/measure-zero-hold.ts corpus 150 <seed>` runs the F2 corpus. It
  takes about 6 minutes per seed. `ONLY="<type>/<form> <hull> <speed> <spin|still>"`
  runs one cell, and `EXAMPLES=n` prints up to n events.
- `bun .scratch/measure-zero-hold.ts pair` runs the two-hull `sweepShipPair` case
  from F4.
- `.scratch/r1.ts` runs the two-hull `sweepShip` case from F1.

What the instrument does:
- **Flights.** Each flight starts outside the proxy's reach sphere, aimed at a
  uniform point on the disc of reach radius, with a random fixed attitude. Half
  turn about a random axis at 0–0.5 rad/s. The station's start and end frames
  come from `apertureFrame(type, FIXTURE_AXIS, slotPhaseRad(rpm, t), FIXTURE_REFERENCE)`,
  centred and at rest. Every tick is one `sweepShip(…, MAX_DT)` call, and the
  flight continues from the position and velocity it returns.
- **Which box was met.** The box whose surface holds `impact.point`. The gap is
  measured to it at the impact time, on the ship path rebuilt with
  `stopResting`'s correction.
- **Phantom.** The pair counts as a phantom when a conservative march (step
  0.5·gap/bound) of that path, continued for the rest of the step plus 1 s,
  never overlaps the met box.
- **Mechanism.** "thr" when the gap at impact is at most 5 cm + 1e-6 km, and
  "cap" otherwise.
- **Closing classes.** zero ≤ `RESTING_CLOSING_FLOOR_KMS`, low ≤ `V_SCRAPE_KMS`,
  and billed above it.
