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
Pad proxies have a derived landing well below the plane, so the hull's nose
can reach the centre crossing without hitting the deck first.

`docking.md` §9.2.4 and its stale handoffs now name `probe-collision.mjs`.
The old hull-face entry row moved out of `probe-docking.mjs`; check 5 retains
its headless containment rows. The collision and docking probes are registered
under their current subjects.

## Headless evidence

| Obligation | Evidence |
|---|---|
| §9.1.2 row 3; §9.1.4 moving surface | `collision-stations.test.ts`: turning face strikes at the `ω × r` band; away/stopped-spin controls; resting surface bills the turn and leaves the hull outside. Static-keel misposing makes its control red. |
| §9.1.6 | Rim first, plane first and exact tie; zero-speed resting thrust cannot pass the rim. The latter failed before the resolver correction and passes afterward. Departing a resting surface remains free to cross a plane. |
| §9.1.7 | 40 spawns, 40 real hyperspace arrivals, 40 restore fallback placements: zero inside proxies. Deliberate saved-flight placements inside all four roles ghost without damage or push; return after separation makes contact. These are controlled saved-pose fixtures, not a survey of players' saves. |
| §9.1.7 launch; §9.1.8 | Every admitted hull, every role: arrival, parked interval and launch are exempt. All 34 release cases fly 90 subsequent steps with zero impacts and zero ghost steps. Pad red arm removes the exemption and meets solids. Slot red arm closes the bay and meets its bulkhead. |
| §9.1.9 | `bun scripts/measure-aperture-fit.ts` reproduces `aperture-physical-fit.md`'s table exactly. Centred zero pitch/yaw passes at both roll 0 and roll 50° for every admitted hull. |
| §9.1.12 remainder | Seeds 1–40, 81 cruise legs, 81 exits; zero exits inside a proxy. Nearest exit to any station: 46.1 km. Zero of 81 legs cross a non-target proxy. The count now sweeps actual moving primitives after broad-phase rejection. Its regression rejects empty space inside the Gantry's bounding sphere while counting a boom crossing; the reach-only version failed. |
| §9.1.15 | `hull-docking.test.ts` flies the computer with collision live across its admitted roster, roles and spin samples, asserting no impacts or ghosts in addition to docking and the six checks. Together with `docking-computer.test.ts`: 58 tests passed. |

The focused collision files pass 75 tests. The final `npm test` passes
**4,907 tests, zero failures**, across 268 files. Typecheck, format, lint,
launcher wiring and production build pass. Browser results follow below.

## Browser selection

The mandatory selector was run with the station-collision intent and the branch
base. It selected **all 86** probes because `scripts/capture-views.mjs` is shared
infrastructure. The worker contract explicitly forbids the full suite here;
the supervisor owes that final reviewed-head gate.

The worker's targeted hardware run covers `probe-collision.mjs`,
`probe-collision-surface.mjs`, `probe-docking.mjs`, `probe-dock-arrival.mjs`,
`probe-docking-traffic.mjs` and `probe-frame-acceleration.mjs`. It uses the
canonical runner and its shared machine lock, server identity and renderer
guards. This is partial evidence, regardless of its result.

## Principal judgment still required

- **P1 physical fit:** [the pitch/yaw table](aperture-physical-fit.md). At
  50° roll the miner clears only 0.5° of pitch or yaw at either slot role;
  check 2 permits 35°. The principal judges whether that is the intended skill
  tax. No tolerance or rim was widened to hide it.
- **Derived pad well:** refinery depth 56.2 m, outpost 46.5 m. The depth is
  derived from admitted hull boxes and their measured offsets. It is documented
  in `collision.md` §2.2; the proxy budget remains green over its gated plans,
  with the earlier wide sweep in `station-proxy-wide-sweep.md`.
- **Major-change copy (#573):** the station mechanic qualifies under
  `src/changelog.ts`'s definition. The proposed entry is: “Stations are now
  solid: your ship bounces off hulls, landing decks and shipyard booms, while
  cleared docking and launch keep their safe passage.” The principal approves
  the sentence before merge.
- **Known berth offset:** the miner overhangs a slot berth cell by 2.8 m and
  the explorer by 0.6 m because berth placement uses the ship origin. The
  exemption protects both; the unexempt measurements record their wall
  contacts. Carrying the box offset in berth placement is separate work.

No graph state, other branch, remote, PR or GitHub comment was changed by this
worker. The checkpoint remains the supervisor's and principal's gate.
