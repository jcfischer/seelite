# Hardpoint weapon fittings

The principal selected all nine forms on the [design sheet](target.png) for modeling. The gallery shows the five catalog families and four review concepts. It uses the same Three.js mesh builder as the station Equipment tab and the flown ship.

## Inspect a fitting

Start Vite and open `/spikes/hardpoint-weapons/`. Rotate the fitting to compare its side and front profiles. Open the Interceptor image at its original resolution to judge the mount at flight distance. Expand **Inspect fitted hardpoint** for a crop from that same frame. Each card can export its source geometry as a binary glTF file. The [models directory](models/) contains all nine exports.

## Edit or integrate a fitting

Edit the cross sections, fixtures and finish in [hardpoint-model.ts](../../src/hardpoint-model.ts). Each family has a housing mesh, a separate lens mesh where the fitting has optics, a bottom-centred attachment named `attachment` and a forward exit named `muzzle` or `launch-exit`. Local positive Y points up and negative Z points forward. The GLB contains the unscaled model in metres.

All three catalog sizes use the same geometry. The exterior scales it by 1.2, 1.7 or 2.25 for sizes 1, 2 and 3, then converts metres to kilometres. Grades E, D and A and salvaged variants retain their family silhouette. Slot compatibility, price, ammo and weapon behaviour come from the existing catalog.

[Exterior placement](../../src/hardpoint-exterior.ts) follows hardpoint slot order and seats deck fittings low in the skin just aft of each muzzle. On the Courier, H1 aligns the fitting’s named exit with the centreline of the bow at the authored nose marker. The nose insert is 78% of the equivalent deck fitting to meet the tapered end plate. Replacing a fitting, changing hull or installing an authored hull refreshes the exterior. A hull-specific fairing meets the underside of the shoe. The Courier nose fairing and its chase firing-origin check belong to [the Courier nose integration](https://github.com/jcfischer/seelite/issues/1331).

## Review the concepts

| Fitting | Proposed size | Pilot choice and firing cue | Closest catalog role |
| --- | --- | --- | --- |
| Autocannon | 2 | Keep the target in the sights through a series of amber drum flashes. | The beam laser also rewards tracking. |
| Railgun | 2 | Time one shot as the light runs down the parallel rails. Recovery makes a miss costly. | The military laser offers repeat fire. |
| Scattergun | 1 | Commit to a close pass for a wider firing window. The whole scalloped mouth flashes. | The pulse laser can engage earlier. |
| Plasma projector | 2 | Lead a slow bolt as a bright orb leaves the cradle. | A missile rack offers a lock. |

The four concept cards are review fixtures. Their cues and trade-offs are proposals for the pilot's keep, revise or drop decision.

### Equipment estimates

Each proposal uses grade E at the size shown. The proposed price uses the catalog row for the listed peer at that size and grade, including its price weight, the catalog's size and grade multipliers and rounding to 25 Cr. Sustained DPS assumes every projectile hits, including every scatter pellet. The cycle runs from the start of one burst or charge to the start of the next. Value divides sustained DPS by the displayed price in thousands of credits.

| Concept | Size | Proposed cycle | DPS | Price peer (weight) |
| --- | --- | --- | ---: | --- |
| Autocannon | 2 | Six 5-damage rounds at 0.1 s intervals, then 1 s reload after the last round | 30 / 1.5 = 20 | Beam laser (2.5) |
| Railgun | 2 | Charge 2 s, deal 80 damage, cool for 2 s | 80 / 4 = 20 | Military laser (6) |
| Scattergun | 1 | Eight 3-damage pellets together, then 1.5 s reload | 24 / 1.5 = 16 | Pulse laser (1) |
| Plasma projector | 2 | Charge 1 s, release one 54-damage bolt, recover for 2 s | 54 / 3 = 18 | Missile rack (1.5) |
