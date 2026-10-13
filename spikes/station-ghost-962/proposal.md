# Spike #962: does per-box ghosting trap a ship placed inside an authored station proxy?

Branch `spike/station-ghost-962`, from `origin/main` at `82acce70` (shipyards
#818, refineries #819 merged). Headless only. No GLB install: the proxies are
the generated `src/shipyard-proxies.ts` and `src/refinery-proxies.ts`.

## Answer

**Yes. A ship placed inside an authored proxy is trapped in 82–89% of
placements, and is billed damage in 55–68%.** The cause is G1's: the ship
ghosts only the boxes it overlaps, so the next box of the same metal is swept,
and the ship meets it from inside. **No measured placement path puts a ship
inside today.** The one path that can is a saved flight restored inside metal.

## 1. Placed inside, flown out (`rows.test.ts`, `rows-run1.txt`, `rows-run2.txt`)

A ship (courier, freighter) is placed overlapping a random box of the form, up
to one hull half-length in from a random face, at a random attitude. It flies
out at 100 m/s, `MAX_DT` per tick, through the shipped `sweepShip`, until it
overlaps nothing. Three directions per placement: out of the placed box's face,
along the nose, random. 120 placements × 3 directions × 2 hulls per form;
shipyards also at 3 rpm (the drum turns). Two runs, two seeds.

Three arms, on the same placements and paths:

- **per box**: the shipped `classifyPairs` rule.
- **per solid**: a solid (drum, yard, refinery) the ship was placed in is left
  out of the sweep until the ship overlaps none of its boxes.
- **per station**: the same for every solid of the station (#956 O-c).

Trapped means an impact while the ship still overlaps some box.

| Role | N per run | per box | per solid | per station | billed (per box) |
| --- | --- | --- | --- | --- | --- |
| Shipyards a–c | 4,320 | 81.6% / 81.6% | 6.4% / 5.9% | 0 / 0 | 56.7% / 55.3% |
| Refineries a–d | 2,880 | 89.2% / 88.0% | 0 / 0 | 0 / 0 | 66.0% / 68.1% |

(run 1 / run 2.) Per form, per box is 74–93%, with no outlier form.

- **Every placement had a neighbour.** In every sample, a box that the ship
  did not overlap was within one tick (10 m). The boxes are packed tight, so
  "a box beside the placed one" is the normal case, not a rare one.
- **Mostly joined metal.** Still: 89–96% of traps meet a box that overlaps or
  touches (≤ 1 m) a box the ship is inside. At 3 rpm: 63–64%. The rest is the
  drum turning a box into the ship, or metal reached across a gap while the
  ship is still partly inside. About 70% of traps happen at the first tick.
- **Per solid is not enough on a shipyard.** 6% of placements meet the other
  solid (drum against yard). Only per station escapes in every case.
- **The direction does not save it.** Out of the placed box's own face traps
  90%. Along the nose traps 76%.

## 2. How often the placement paths put a ship inside

| Path | Inside | Source |
| --- | --- | --- |
| Spawn, hyperspace arrival, restore fallback | 0 of 480 each (40 seeds × 12 hulls) | `tests/collision-stations.test.ts` §9.1.7 census. It bounds by `proxyReachKm` (the authored proxy's reach), so it is form-independent. |
| Cruise exit | 0 | §9.1.12 row, "no cruise exit places a ship inside a proxy" |
| Launch, shipyards a–c | 0 ghost steps, every admitted hull | "every pooled slot form" rows, re-run on `82acce70`: 4 pass |
| Launch, refineries a–d | 0 ghost steps, 0 impacts, 9 hulls × 4 forms | `launch.txt`: new spike row (pad roles had one form per role only) |
| Saved flight restored in flight | **can be inside** | The save holds any pose. §11.7 accepts this. |

A save written in legal flight is outside, because the station pose and the
drum's phase come from the saved clock. A saved pose is inside metal when the
proxy changed after the save (a refit regenerates the boxes with a new model
hash), or when the save is hand-edited. Not measured: an NPC carrier
materialised beside a station (§6).

The existing restore row (`collision-stations.test.ts`, "a saved flight can
restore inside a proxy on every role") passes because it **isolates the
primitive**: "Isolate the pair so another primitive along the escape route
cannot mask the ghost being tested". With its neighbours present, this spike
says it would be trapped.

## 3. Options (for the principal)

- **O1. Keep per-box.** No code. Only a restored save can be trapped. That
  ship takes an impact (damage in about 60%) and bounces inside the
  structure, against §4.3's "no damage, flies out the way it came". Fix the
  spec and §11.7 so they state the trap.
- **O2. Placement-gated ghost per station** (#956 D4's rule, O-c). A
  placement event sets a flag per (ship, station). All of the station's solids
  ghost until the ship overlaps none of them. Any other overlap stays per box,
  so resting contact (G2) does not change. Escapes in 100% of samples. It uses
  #960's mechanism, so one flag type serves rocks and stations. Per solid
  (drum or yard alone) is not enough: 6% are trapped.
- **O3. Restore refuses an inside pose.** A saved flight pose that overlaps a
  proxy restores through the restore fallback placement (0/480 inside). No
  ghost is needed for stations. Cost: the ship moves away from where it was
  saved, and rocks still need #960.

**Recommendation: O2.** It keeps §4.3's promise, uses the same flag as #960,
and it covers a placement path added later (for example NPC materialisation)
without a new census. O3 is a valid fallback if a flag per station costs too
much.

## 4. Owed by a build, not proved here

- O2's census row: restore inside every authored form *with its neighbours*,
  flown out with no impact (the row above, not isolated).
- The flag's lifetime when the ship is inside two stations' reach (never seen:
  stations do not overlap).
