# Node #746 — every shipyard form in the system draw

Author: Claude ranger implement worker, 2026-10-08.

<!-- glossary-ignore: Hangar — throughout, the name of shipyard form B, not a docking bay -->

## Built

`STATION_FORM_POOL.shipyard` is `[a, b, c]`: Gantry, Hangar and Slipway, in
id order. `stationForms` and its uniform draw are unchanged. Trade stays
`[a]`, the refinery `[a, b, c, d]`, and the outpost `e`. No `STATION_GEOMETRY`
value, aperture, berth catalogue, carrier identity or generator version
changes.

The forms were pooled one at a time, Hangar first, as node #717's receipt
recommends: several rows loop over forms inside one `test()` and stop at the
first red.

### Mesh repairs, each where a named row failed on the form itself

| Form | Row | Repair |
|---|---|---|
| Hangar b | M1, M4 (bay at 0.360 against 0.372) | The hub's forward ring moves from `r * 0.6` to `r * 0.62`, the Gantry's face and the declared plane; the aperture and the strobe pair go with it. |
| Hangar b | V1 (floods, arc, windows hidden down the axis) | The floods sat 84 m inside the dark mouth-recess box and are now on the two lips' forward faces, turned 35° inboard. The arc is on the slab's face below the lower lip. The windows were on the slab's back face, 24 m inside it, and are now on its forward face. Both the arc and the windows are seated by a raycast onto the slab, whose octagonal section makes that face two chords rather than a plane. |
| Hangar b | F1, F2 (no macro fixtures) | A `shipyard/b` declaration on the static slab: two truss bridges, radiator banks, tank racks, pipe runs down the back, and two masts with beacons. |
| Slipway c | M1, M2, M4 | `core` named the static arc, so these rows measured a ring 252 m behind the plane while the hub carried the cut. The cut hub is now `core`, takes the hull colour (it was plain grey) and has its face at `r * 0.62` (it was at `r * 0.64`, 12 m proud). The arc is now named `arc`. |
| Slipway c | V1 (floods hidden) | The floods stood at the struts' own angles, so each strut ran over its flood. They now sit between the struts. |
| Slipway c | F1, F2 | A `shipyard/c` declaration on the arc's two crowns: a truss bridge, a pipe main, radiator banks and tank racks each set on a facet ring, and three masts with beacons. |
| Slipway c | proxy vertex row | The ports hung 110 m inside the ring at `major * 0.82`. They are now on the arc's inner face. The welding arc hung in the slip with nothing under it, so a proxy could hold it only with a 1 m primitive or an invisible wall. It now sits on the first slip-head's top face, at the slip's edge. |

The hub faces are written at `r * 0.62` in each form's own radius and not
read off `aperturePlaneKm`. That keeps §128's hull-reaches-the-plane row two
paths to one number (its own comment says why). With every shipyard form's
arc now on structure, `weld-arc` is no longer skipped by the lamp-seating row
in `tests/station-mesh.test.ts`, and that row passes on all three.

### Proxies

Both are hand-written in `src/station-proxy.ts`. Neither is derived from the
mesh.

- **Hangar**, spinning: the hub cut round the bay and prism, standing 28 m
  proud of the plane as the Gantry's drum does, plus the spindle. Static: the
  slab's octagonal parallel section as two boxes (at most 40 m over its
  top-front edge, against 88 m for one box), its tapered ends as stepped boxes,
  a band for the mouth's lips and recess, the bearing, and the two masts.
- **Slipway**, spinning: the hub cut round the bay and prism. Static: one
  capsule per facet ring along the arc's centreline, so the slip stays open;
  four capsules per slip-head; one capsule per strut from outside the bay's
  swept cylinder out to the arc; one capsule per mast.

| Form | Thinnest primitive (km) | Proxy reach (km) / budget |
|---|---:|---|
| Gantry a | 0.028 | unchanged |
| Hangar b | 0.028 | 1.491 / 1.5 |
| Slipway c | 0.028 | 1.460 / 1.5 |

`stationProxyOf` keeps its refusal. A new row in `tests/station-form.test.ts`
gives a generated shipyard the form `d`, which the role does not build, and
asserts the exact `shipyard form d has no proxy`.

### Rows and probes added

- `tests/collision-stations.test.ts`: arrival, parked and launch, flown in
  every pooled form of a slot role, with the closed-bay red build beside each
  one. A Hangar proxy with its bay holes removed turns its row red.
- `scripts/probe-docking.mjs`: the docking computer docks at and launches from
  a generated shipyard of each form. Seeds 3, 2 and 8 give systems 24, 101 and
  67, all with the berth `overhead-deep`, no impacts, and 1.01 km gained in
  10 s.
- `scripts/probe-collision.mjs`: §9.2.2 stops a ship at each form's static
  frame, from a seed-42 system that builds that form (7, 8, 1), and checks the
  form it met. The drawn-face gap reads 10 m on the Gantry's boom, 0.3 m on the
  Hangar's face and 3 m on the Slipway's arc.

## Which canonical views move

`bun scripts/measure-station-forms.ts shipyard=a,b,c`, run against the pool as
it was on `main` (`[a]`):

```
    station-shipyard-axis        seed 47  shipyard  a Gantry → b Hangar
    station-outline              seed 47  shipyard  a Gantry → b Hangar
    station-shipyard-flank       seed 47  shipyard  a Gantry → b Hangar
    shipyard-wall-berth          seed 47  shipyard  a Gantry → b Hangar
  4 of 16 move (*)

  shipyard  N=362: a Gantry 138 (38.1%), b Hangar 122 (33.7%), c Slipway 102 (28.2%)
```

Seed 47's shipyard is now a Hangar, so those four views frame a different
form. `scripts/lib/view-set.mjs` still captions `station-shipyard-axis` with
the Gantry's booms. The ruling waives the before/after sheet and the
principal's sign-off, so neither the captions nor the frames were touched
here.

## Verified

- `npm test`: 5615 pass, 0 fail, before the Hangar slab's second box. After
  it, the proxy, collision, avoidance, traffic, handoff and form files: 191
  pass, 0 fail.
- `npx tsc --noEmit`, biome format and lint, the wiring check and
  `npm run build` are all clean.
- Browser, GPU lane (ANGLE Metal, Apple M1 Pro), `PROBE_SELECTION` partial
  run: probe-arrival, -collision, -dock-arrival, -docking, -shipyard,
  -station-mouth, -station-visuals and -station, 8/8. After the last proxy
  change, probe-collision (28/28) and probe-docking (63/63) were run again
  directly. The selector picked 40 probes. The full suite is the
  supervisor's.

## Not done here

- **The Slipway's struts reach into the turning hub.** They are static and
  start at `r * 0.32`, while the hub's section reaches `r * 0.4` and sweeps its
  corners further. That is #165's static-spine-through-a-turning-drum fault on
  a third form. No row measures it, so it is left as it was built and noted
  here. The strut proxies start outside the bay's swept cylinder.
- No principal viewing of the repaired Hangar and Slipway is recorded. The
  node's ruling waives it. The checks verify budgets, corridors, fixtures and
  docking, not appearance.
- The changelog entry in `src/changelog.ts` is proposed copy and needs the
  principal's approval before the merge.
