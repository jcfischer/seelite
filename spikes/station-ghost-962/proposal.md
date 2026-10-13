# Spike #962: does per-box ghosting trap a ship placed inside an authored station proxy?

Branch `spike/station-ghost-962`, from `origin/main` at `82acce70` (shipyards
#818, refineries #819 merged). Headless only, and an unmerged spike branch,
as #956's was. `npm test` runs `tests/` only, so nothing here joins it. No GLB
install: the proxies are the generated `src/shipyard-proxies.ts` and
`src/refinery-proxies.ts`. Every primitive in all seven proxies is a box
(shipyards 2,869–3,277, refineries 3,383–9,114).

## Answer

**Yes, G1 happens on stations. No measured placement path puts a ship inside
today.** The one path that can is a saved flight restored inside metal, and
on that path the trap is narrow:

- A ship that flies out **the way it came** escapes (99.8–99.9%).
- A ship on **any other outward heading** is struck from inside in 11–15%.
- A ship that **turns into the station** is struck in 70–76%. That is mostly
  the wall it is turning into, and it would be struck there from outside too.

Placed deep in packed metal, per box traps 82–89%. No game path places a ship
deep, so that figure is the worst case only.

## 1. The rows (`rows.test.ts`)

A ship (courier, freighter) is flown out at 100 m/s, `MAX_DT` per tick,
through the shipped `sweepShip`, until it overlaps no box. Shipyards are flown
still and at 3 rpm (the drum turns). Two seeds for every row. Three arms on
the same placements and paths:

- **per box**: the shipped `classifyPairs` rule.
- **per solid**: a solid (drum, yard, or a refinery's one solid) the ship was
  placed in is not swept until the ship overlaps none of its boxes.
- **per station** (#956 O-c): the same, for every solid of the station. When
  every solid is held out, nothing is swept, so this arm **cannot** be struck.
  Its figure is not "escapes". It is how far it flies through metal.

"Struck" means an impact while the ship still overlaps some box.

### 1a. The restore path: shallow inside (`shallow-962.txt`, `shallow-1962.txt`)

This is a save restored after a refit. The ship was clear of the old proxy,
so it is just inside the new one's outer surface. The ship has a random
attitude. It marches in along a random ray to its first overlap. The boundary
is bisected to 1 cm, and the ship is placed 0.1, 0.5 or 2 m past the last
clear pose. 80 rays × 3 depths × 2 hulls per form.

| Role | Heading | N (seed 1 / 2) | per box struck | per solid struck | billed (per box) | per station flies through metal |
| --- | --- | --- | --- | --- | --- | --- |
| Shipyards | reverse of the way in | 2,878 / 2,879 | 0.2% / 0.1% | 0 / 0 | ≤ 0.1% | 10 m |
| Shipyards | other outward | 2,856 / 2,753 | 14.5% / 13.4% | 0.3% / 0.7% | 7.9% / 7.6% | mean 36 / 32 m, max 520 / 930 m |
| Shipyards | inward | 2,900 / 3,005 | 72.3% / 69.7% | 22.2% / 20.3% | 53.7% / 52.5% | mean 194 / 190 m, max 1,090 / 1,110 m |
| Refineries | reverse of the way in | 1,918 / 1,920 | 0.1% / 0.1% | 0 / 0 | ≤ 0.1% | 10 m |
| Refineries | other outward | 1,823 / 1,858 | 10.9% / 12.1% | 0 / 0 | 6.2% / 7.3% | mean 31 / 32 m, max 710 / 530 m |
| Refineries | inward | 2,013 / 1,982 | 76.0% / 75.3% | 0 / 0 | 57.3% / 59.7% | mean 437 / 420 m, max 1,460 / 1,430 m |

"Outward" and "inward" are the nose and a random heading, split by the sign
of their dot product with the ray out. Depth does not change the figures.
The march steps 5 m, so a plate thinner than 5 m can be stepped over and the
ship placed under it. That only makes a placement deeper.

### 1b. Worst case: deep in packed metal (`rows-run1.txt`, `rows-run2.txt`)

The ship is placed overlapping a random box, up to one hull half-length in from
a random face. It flies out of that face, along the nose, or at random.
120 placements × 3 headings × 2 hulls per form.

| Role | N per run | per box struck | per solid struck | billed (per box) |
| --- | --- | --- | --- | --- |
| Shipyards a–c | 4,320 | 81.6% / 81.6% | 6.4% / 5.9% | 56.7% / 55.3% |
| Refineries a–d | 2,880 | 89.2% / 88.0% | 0 / 0 | 66.0% / 68.1% |

- In every sample a box that the ship did not overlap was within 10 m. The
  boxes are packed tight.
- Still, 89–96% of the strikes are against a box that overlaps or touches
  (≤ 1 m) a box the ship is inside. That is G1. At 3 rpm the figure is 63–64%:
  the rest is the drum turning a box into the ship. About 70% are on the first
  tick.
- Each row stops at the first impact. What the ship does after it (a bounce,
  then more strikes) is not measured.

## 2. How often the placement paths put a ship inside

| Path | Inside | Source |
| --- | --- | --- |
| Spawn, hyperspace arrival, restore fallback | 0 of 480 each (40 seeds × 12 hulls) | `tests/collision-stations.test.ts` §9.1.7 census. It bounds by `proxyReachKm`, the authored proxy's own reach. |
| Cruise exit | 0 | §9.1.12 row, "no cruise exit places a ship inside a proxy" |
| Launch, shipyards a–c | 0 ghost steps, one berth per admitted hull | "every pooled slot form" rows, re-run on `82acce70`: 4 pass |
| Launch, refineries a–d | 0 ghost steps and 0 impacts, 9 hulls × 4 forms, one berth per hull | `launch.txt`, from a spike copy of the suite (`launch-pad-forms.test.ts`). The suite flies one refinery form only. |
| Saved flight restored in flight | **can be inside** | The save holds any pose. §11.7 accepts this. |

A save written in legal flight is outside. The station's pose and the drum's
phase come from the saved clock, and the save stores position and attitude
as float64 with no rounding (`save-envelope.ts`). A saved pose is inside metal
only when the proxy changed after the save (a refit regenerates the boxes) or
the save was edited. Not measured: an NPC carrier materialised beside a
station (§6).

The suite's restore row ("a saved flight can restore inside a proxy on every
role") passes because it removes the neighbours. Its comment says: "Isolate
the pair so another primitive along the escape route cannot mask the ghost
being tested". With the neighbours present, that row is struck as §1 shows.

## 3. Options (for the principal)

- **O1. Keep per box.** No code. Only a ship restored after a refit is
  affected. It flies out the way it came. On another outward heading it is
  struck from inside in 11–15% (damage in 6–8%). On an inward heading it
  meets the wall it is turning into. The spec changes: §4.3's "no damage,
  flies out" holds only for the way it came, and §11.7 says so.
- **O2. Placement-gated ghost per station** (#956 D4's rule for rocks). A
  placement event sets one flag per (ship, station). All of the station's
  solids ghost until the ship overlaps none of them. Resting contact stays
  per box (G2). It uses #960's mechanism. **Cost:** a ship that turns inward
  flies through the whole station, mean 190–440 m and up to 1.5 km of metal.
  A per-solid flag (drum or yard alone) is not enough: 20–22% of inward
  headings on a shipyard are struck by the other solid.
- **O3. Restore refuses an inside pose.** A saved flight pose that overlaps a
  proxy restores through the restore fallback (0 of 480 inside). Stations
  then need no ghost rule. Cost: the ship moves from where it was saved, and
  rocks still need #960.

**Recommendation: O1, and amend the spec.** The only live path is rare. On
it, the way out is clear. A strike on an inward heading is what the pilot
would meet from outside. O2 makes the inward case worse: up to 1.5 km through
metal. O3 is the choice if a struck restore must never happen.

## 4. Owed by a build, not proved here

- Under O1: the restore row with its neighbours present, flown out the way it
  came, with no impact. The §4.3 and §11.7 text.
- Under O2: the same row through every authored form with no impact, and a
  bound on the distance a ghosted ship may fly through.
- Under O3: a row that a restore inside every authored form lands at the
  fallback placement.
