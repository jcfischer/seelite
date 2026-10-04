# Solid stations: node #663 verification and principal handoff

Worker: Codex, ivy-agent. Date: 2026-10-04. Implementation is on
`node/663-stations-are-solid-wire-the-proxies-under-c3-s-p`, based on
`f04460b`. The worker commits locally; the supervisor owns pushing, the PR,
Sage review and the principal's merge. This file is evidence, not a checkpoint
receipt or an approval.

## Changes

The player meets every selected station proxy in normal flight, through
`stepWorld`. `stationMotions` poses the spinning member and static Gantry keel
at both ends of the tick. The collision resolver compares the earliest contact
with the aperture crossing; a tie belongs to contact. A resting rim that stops
this tick's thrust also owns the tick, even when the start speed is zero and
the contact costs nothing. `Game` resolves only the crossing the step returns.

Arrival, parking and launch remain exempt under `collisionExempt`. Released
ships are collidable; an initially overlapping pair ghosts until separation.
Pad proxies have a derived landing well below the plane, so the hull's nose <!-- glossary-ignore: pad -->
can reach the centre crossing without hitting the deck first.

`docking.md` §9.2.4 and its stale handoffs now name `probe-collision.mjs`.
The gap ray reads the actual hull box's fore-face centre, including its measured
origin offset, rather than approximating it from half the envelope length.
The old hull-face entry row moved out of `probe-docking.mjs`; check 5 retains
its headless containment rows. The collision and docking probes are registered
under their current subjects.

## Headless evidence

| Obligation | Evidence |
|---|---|
| §9.1.2 row 3; §9.1.4 moving surface | `collision-stations.test.ts`: turning face strikes at the `ω × r` band; away/stopped-spin controls; resting surface bills the turn and leaves the hull outside. Static-keel misposing makes its control red. |
| §9.1.6 | Rim first, plane first and exact tie; zero-speed resting thrust cannot pass the rim. The latter failed before the resolver correction and passes afterward. Departing a resting surface remains free to cross a plane. |
| §9.1.7 | 40 world seeds × all 12 hull boxes for each of spawn, real hyperspace arrival and restore fallback: 480 hull placements per path, zero inside proxies. Attitude reconstructs Game's star-facing placement (World carries no attitude); an additional reach-sphere bound proves clearance for any attitude. Deliberate saved-flight placements inside all four roles ghost without damage or push; return after separation makes contact. These are controlled saved-pose fixtures, not a survey of players' saves. |
| §9.1.7 launch; §9.1.8 | Every admitted hull, every role: arrival, parked interval and launch are exempt. All 34 release cases fly 90 subsequent steps with zero impacts and zero ghost steps. Pad red arm removes the exemption and meets solids. Slot red arm closes the bay and meets its bulkhead. | <!-- glossary-ignore: pad, slot -->
| §9.1.9 | `bun scripts/measure-aperture-fit.ts` prints the worst angle across 18 refinery plans (12 budget seeds + 6 generated station seed pairs), 12 outpost plans, and one fixture per non-seeded role. Centred zero pitch/yaw passes at roll 0 and 50° for every admitted hull. Seeded pad rows additionally check ±35° pitch and yaw at both rolls; the full 0.5° scan is the principal's updated table. |
| §9.1.12 remainder | Seeds 1–200, the travel instrument's full default corpus: 416 cruise legs, 416 exits; zero exits inside a proxy. Nearest exit to any station: 41.3 km. Zero of 416 legs cross a non-target proxy. The count now sweeps actual moving primitives after broad-phase rejection. Its regression rejects empty space inside the Gantry's bounding sphere while counting a boom crossing; the reach-only version failed. The measured 416-leg and 416-exit totals and the empty non-target crossing list are asserted. The former literal seed-length assertion did not prove the measured coverage. |
| §9.1.15 | `hull-docking.test.ts` flies the computer with collision live across its admitted roster, roles and spin samples, asserting no impacts or ghosts in addition to docking and the six checks. Those historical handling rows retain the fixed plan; the new seeded pad rows fly 18 refinery plans × 9 hulls and 12 outpost plans × 7 hulls (246 runs), asserting docking, no violations or refusal, no impacts or ghosts, and a nontrivial flight. |

Before the review repair, the focused collision files passed 75 tests. That
`npm test` passed
**4,907 tests, zero failures**, across 268 files. Typecheck, format, lint,
launcher wiring and production build pass. Browser results follow below.

## Browser selection

The mandatory selector was run with the station-collision intent and the branch
base. It selected **all 86** probes because `scripts/capture-views.mjs` is shared
infrastructure. The worker contract explicitly forbids the full suite here;
the supervisor owes that final reviewed-head gate.

The worker's targeted hardware run covers `probe-collision.mjs`,
`probe-collision-surface.mjs`, `probe-docking.mjs`, `probe-dock-arrival.mjs`,
`probe-docking-traffic.mjs`, `probe-frame-acceleration.mjs` and
`probe-public-site.mjs` (the changelog entry). It uses the
canonical runner and its shared machine lock, server identity and renderer
guards. This is partial evidence, regardless of its result.

**All seven selected probes passed**, sequentially in 44 seconds, on
`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`.
The runner verified the serving tree and hardware renderer. Peak machine load
was 31.1 on 10 cores. The approved retry took the shared lock after 1,514 seconds.
The first attempt had waited 1,021 seconds, then Chromium aborted before any
checks and sandbox process control returned `EPERM`; that attempt is not
browser evidence. The retry ran outside that process sandbox.

This remains a **partial run**: 79 of 86 probes were not run. The supervisor
still owes the full suite on the final reviewed head. The final headless run,
after expanding the cruise corpus, passed 4,907 tests in 277.33 seconds.

The collision probe was also run separately with its stdout retained, under
the same shared lock and hardware guard: **15/15 checks passed**. Seed 42,
system 8; assist off, coasting inward at `V_GATE` (0.1 km/s). All three cases
bounced, took about 30 points from the fore shield, spent no hull and evaluated
no docking entry.

| Subject | Closing speed (km/s) | Outward speed after impact (km/s) | Ray to drawn face |
|---|---:|---:|---:|
| Trade hull, 225 m off axis | 0.100136 | 0.050204 | 57.1 m |
| Refinery, over berth `deck-near` | 0.100000 | 0.050000 | 23.3 m |
| Shipyard, over dorsal boom | 0.100030 | 0.050044 | 10.2 m |

The ray starts at the measured hull box's fore-face centre after the impact
tick. These are point readings of the rendered station, including any remaining
tick's bounce, not a maximum deviation between the proxy and mesh. The gap
figures are printed rather than approved by a threshold; §11's joint 5 sends
the berth and boom readings to the principal to judge the invisible wall.

## Principal judgment still required

- **P1 physical fit:** [the pitch/yaw table](aperture-physical-fit.md). At
  50° roll the miner clears only 0.5° of pitch or yaw at either slot role; <!-- glossary-ignore: slot -->
  check 2 permits 35°. The principal judges whether that is the intended skill
  tax. No tolerance or rim was widened to hide it.
- **Derived pad well:** refinery depth 56.2 m, outpost 46.5 m. The depth is <!-- glossary-ignore: pad -->
  derived from admitted hull boxes and their measured offsets. It is documented
  in `collision.md` §2.2; the proxy budget remains green over its gated plans,
  with the earlier wide sweep in `station-proxy-wide-sweep.md`.
- **Drawn-surface gaps:** the point readings above, particularly the berth and
  boom, are the principal's judgment under §11 joint 5. Passing the stop and
  bounce checks is not approval of an invisible wall.
- **Major-change copy (#573):** the station mechanic qualifies under
  `src/changelog.ts`'s definition. The proposed entry is: “Stations are now
  solid: your ship bounces off hulls, landing decks and shipyard booms, so a
  docking approach must keep the whole ship clear of the rim.” The principal
  approves the sentence before merge. Its presence on this worker branch is a
  proposal, not a record of approval.
- **Known berth offset:** the miner overhangs a slot berth cell by 2.8 m and <!-- glossary-ignore: slot -->
  the explorer by 0.6 m because berth placement uses the ship origin. The
  exemption protects both; the unexempt measurements record their wall
  contacts. Carrying the box offset in berth placement is separate work.

No graph state, other branch, remote, PR or GitHub comment was changed by this
worker. The checkpoint remains the supervisor's and principal's gate.

## Sage round 1 repair

The station-start collector now filters to placed stations before reading their
poses. Its regression preserves every placed pose and the real station's impact;
removing the filter fails with `no placed body station-trade-unplaced`.
`advanceSystem` independently requires a complete placed-body set, so this is
a defensive collector rule, not a claim that arbitrary incomplete worlds can
advance normally.

The cruise census now asserts its measured 416 legs, 416 exits and zero
non-target crossings. Red builds confirmed both assertions discriminate:
reducing the sample to 40 seeds reports 81 legs and fails the 416-leg pin;
injecting a nonzero crossing report fails the empty-list assertion. Both
mutations were restored. The earlier claim about a literal 200-seed assertion
proving measured coverage has been corrected above.

Hull admission is shared by the proxy, the fit instrument and the collision
rows through `admittedHulls`. Exit overlap checks reuse `overlapsStation` and
`uprightFor`. The round 1 fit instrument's output remained byte-identical to the
then-current principal table; round 2 below expands its measured seed scope. The collision-enabled roster sweep still measures the miner
at 5 rpm against the generator's 3 rpm maximum, a 1.67× margin. The comment now
points to the printed measurement instead of retaining a copied number.

The changelog proposal no longer promises a cleared approach safe passage;
clearance does not exempt the approach. The ray's header, local variable and
printed label all describe the hull box's fore-face centre along the nose.
The outpost comment now describes the unplaced harness fixture rather than
claiming an outpost had shipped.

Glossary annotations preserve aperture-kind terminology under `CONTEXT.md`'s
explicit Berth scope note. The player-placement uses of `spawn` and the
interior route's `staging point` likewise do not name anonymous Traffic or a
Traffic hold. <!-- glossary-ignore: Spawn, Staging point -->

Round 1 headless verification: **4,908 tests passed, zero failures**, across
268 files in 266.85 seconds. Typecheck, formatting, lint, launcher wiring and
production build passed. This run also reprinted the 416-leg census and the
spin margin above.

The mandatory selector again returned all 86 probes because the branch changes
shared capture infrastructure. Under the worker's targeted-only contract, the
same seven affected probes listed above passed in 43 seconds on
`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`.
Peak load was 29.8 on 10 cores. The canonical runner held the shared lock and
checked the serving tree and renderer. This remains **partial evidence, 7/86**;
the supervisor owes the full suite on the final reviewed head. The initial
sandboxed attempt aborted Chromium before any checks and returned `EPERM`
during cleanup; only the approved retry outside that process sandbox supplies
browser evidence.

Optional restructuring remains separate: extracting shared plane arbitration
from the world step and the synthetic computer harness would change their
interfaces; deferring station frame construction needs measured cost evidence;
lifting the whole cruise leg is unnecessary after removing the duplicate overlap
arithmetic. This repair leaves those three suggestions out.

## Sage round 2 repair

The physical-fit helper now requires a station seed pair. The computer harness
accepts the pair and uses its berth seed for the interior and both seeds for
the proxy. The bounded corpus is shared by the seeded gate and the updated
principal table, which prints every plan and each column's first worst sample.
Both pad roles still clear 35° across the measured plans; this statement is
bounded to that corpus. No generated outpost is claimed: its twelve plans are
fixtures for the currently unplaced form. <!-- glossary-ignore: pad -->

A red build closes only refinery assembly seed 745705128's landing well, leaving
seed zero intact. The seeded row fails with 90 rejected fit poses and 9 actual computer impacts;
restoring the proxy returns it to green. The first attempted injection was
malformed and crashed; it is excluded from this evidence. The test-first typecheck also rejected
the missing seed input interfaces before the helpers were changed.

The placement census now checks all 12 hulls and reconstructs the star-facing
pose used by Game for each placement path. It also requires the hull's full
reach sphere to clear every proxy reach sphere, conservatively proving every
attitude clear at those positions. Arbitrary saved-flight positions remain the
separate deliberately-inside fixtures; this is not a census of player saves.

Well depth now reads the dockable admitted roster; its comment states axial
reach only and points to measured lateral fit. A shared test hull-solid helper
replaces three box constructions. `stationEndAt` owns the end snapshot in the
world step and tests. The collision probe imports the existing vector leaf
in-page rather than spelling those primitives again. The admitted-hull alias
is removed. The optional eager-frame optimization is left out: changing start
snapshots or prefiltering can alter the moving-frame boundary and needs its own
performance measurement and verification.

Round 2 verification: `npm test` passed **4,910 tests, zero failures**, across
268 files in 269.60 seconds. Typecheck, formatting, script lint, launcher wiring
and production build passed. The seeded red build was restored byte-for-byte
and the two seeded rows passed again. The updated table was measured with the
current corpus; its angle values remain unchanged across that corpus.

The mandatory selector returned all 86 probes due to shared infrastructure.
Under this worker's targeted-only contract, the seven affected probes listed
above passed through the canonical runner in **43 seconds**, on
`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`,
peak load 10.3 on 10 cores. The sandboxed launch aborted before any checks with
SIGABRT and EPERM; the automatically approved retry outside that process
sandbox supplies the evidence. This is **partial evidence, 7/86**. The supervisor
still owes the full browser suite on the final reviewed head.

The #573 major-change check remains yes for solid stations; this review repair
adds no separate changelog entry. The existing node #663 sentence remains a
proposal awaiting the principal's approval, as do the updated physical-fit table
and drawn-surface gap judgments.
