# Node #717 — each system picks its stations' forms

What was built, what is still the principal's, and what a pool owes before it
grows. Measured on this branch; every figure below is reprinted by
`bun scripts/measure-station-forms.ts`.

## Built

- **`STATION_FORM_POOL`** (`src/station.ts`) replaces `SELECTED_FORM`: the
  forms a system may build each role in, one line per role. `SELECTED_FORM`
  is deleted rather than kept beside it, so any reader that still asked "the
  role's form" is a compile error rather than a per-type answer.
- **`DOMAIN.STATION_FORM` (33)**, appended. `stationForms(systemSeed)`
  (`src/station-form.ts`) draws one form per fixed type slot, one draw per
  slot, uniform within the pool. It draws every slot whether or not the system
  places that station, so a beltless system's shipyard draws exactly what the
  same seed's shipyard draws beside a refinery (#109's hazard).
- **`Station.formId`**, generated like `type`. The outpost's is `OUTPOST_FORM`
  (`e`), not drawn: `DrawnStationType` excludes it, because which outpost a
  system shows is the fiction's (#490), not a free pick.
- **The three consumers read the station's own form:**
  - the mesh: `buildStationMesh(station, color)` takes the station record;
  - the reach: `StationMesh.silhouetteKm`, set at build from
    `stationSilhouetteKm(type, formId)`. This replaces the per-type memo
    `STATION_SILHOUETTE_KM`. The detail band and the visual snapshot read the
    handle;
  - the proxy: `selectedStationProxy` reads `station.formId`, and its cache key
    carries the form.
- **Every per-form row iterates `FORMS_IN_PLAY`** (`tests/helpers/forms-in-play.ts`),
  so a form added to a pool is measured by all of them without being named:
  - the reach budget, the proxy budget and its opening, thinnest-figure and
    berth-seed rows;
  - the aperture size and plane, the bay-in-core row, the spinner;
  - the finish reach, corridor and fixture rows;
  - the glow, pool and fixture-reach rows;
  - occlusion, teardown, and the docking plan corpus.

  The thinnest-primitive figure is declared per form, and a pooled form
  without one is red.

## Existing streams did not move

The form draw is on its own tag and reads nothing else. These baselines pass
unchanged:

- the station-field fixture (`tests/station.test.ts`, 788 stations);
- the draw-hash rows (`tests/cold-rocky-moons.test.ts`);
- `tests/station-orbits.test.ts`.

`enumerateCarriers` does not carry the form, so no carrier fingerprint moves
and no generator version is owed.

## The node's three questions

**Q1 — which forms are in each pool: open, the principal's.** Each pool holds
the one form its role already flew: trade `[a]`, shipyard `[a]`, refinery
`[d]`. The earlier records are yeses to *rank* a form, not to fly it:

- the Assembly entered the pool for a ranking round (2026-09-06);
- the Wheel entered unselected (#332);
- refinery A–C have never been looked at.

`tests/station-form.test.ts` pins the shipped pools, so growing one is a
deliberate edit with a red row beside it.

**Q2 — weights: open.** The draw is uniform within a pool and takes no side.

**Q3 — which views move: none, while every pool holds one form.** Run with no
arguments, the instrument prints all 16 views that frame a generated station
at their current form, 0 moving. Once pools grow, any view can move, and which
ones depends on the pools chosen. Run it with the proposed pools to see. As an
illustration only — not a proposal — pooling every built form moves all 16:

- seed 47's trade becomes the Wheel and its shipyard the Hangar;
- seed 2's refinery becomes the Spar.

The galaxy-wide shares under that illustration come out within 18.5–22.6% for
the five trade forms (N = 2,048 trade stations, world seed 47, eight
galaxies).

## What each candidate owes before it joins a pool

| Form | Proxy | Macro fixtures | Other |
|---|---|---|---|
| trade b Ring | none | declared | — |
| trade c Drum | none | declared | — |
| trade d Assembly | none | none | solved form: proxy must read the plan, like the Works |
| trade e Wheel | none | none | the bay-in-`core` row: its slot is cut into `hub` (#334) |
| shipyard b Hangar | none | none | — |
| shipyard c Slipway | none | none | — |
| refinery a Warren | none | declared | never reviewed by the principal |
| refinery b Collar | none | none | never reviewed by the principal |
| refinery c Spar | none | none | never reviewed by the principal |

Each "none" is a red row once the form is pooled:

- the proxy rows (`tests/station-proxy.test.ts`);
- the industrial-finish fixture row (`tests/station-finish.test.ts`);
- for the Wheel, the bay row (`tests/station-interior.test.ts`).

A pooled form then still owes the canonical view set before and after, and
the principal's yes on it.

The net was measured rather than assumed. On a temporary, uncommitted edit of
the pools, against `tests/station-proxy.test.ts`, `tests/station-finish.test.ts`
and `tests/station-interior.test.ts`:

- **trade `[a, b]`**: 5 rows red, all of them proxy rows. The Ring's fixtures
  are declared, and the fixture rows pass.
- **trade `[a, e]`**: 8 rows red — the 5 proxy rows, `the bay fits inside the
  hull of the form that holds it`, and the two industrial-fixture rows (`the
  fixtures are there under an industrial finish and not under stock`, `the
  fixtures are mounted`).
- **shipyard `[a, b]`**: 7 rows red — the 5 proxy rows and the same two
  fixture rows.

## Not done here

- the sheet of candidates per pool, and the principal's yes;
- a finish-sheet row per pool;
- the before/after view set.

The finish sheet already takes a pool's candidates side by side, so it needs no
change here. For example:
`FAMILY=station SUBJECTS=trade VARIANTS=a,b,c,d,e SEEDS=0,1,2 node scripts/shot-finishes.mjs`.

None of these can move until a pool holds two forms. The browser probes that
cover the change were run alone on the GPU lane (ANGLE Metal, M1 Pro) at
`c550ca0` and pass:

- the five probes named `probe-station*`, among them `probe-station-visuals`,
  which reads the reach through `visualOfStation(id).silhouetteKm`, now the
  station's own handle;
- `probe-traffic-engagement`, which calls `selectedStationProxy` on the page's
  stations;
- the two `probe-collision*` probes.

Also run alone and passing at `bb5cdb4`: `probe-handoff`, `probe-dock-arrival`,
`probe-occlusion` and `probe-boot`, the probes most exposed to `main.ts`'s
changed station build. **The repository's probe selector was not run.** This
session's runtime policy refused it, because it sends a credential to an
outside service, so these probes were chosen by reading the change. This is a
partial run, not the suite.

## For the principal: map prose this node made stale

The worker may not edit the map. Two citations in #1's Constraints now name
symbols this node retired:

- #28's display-reach line cites `STATION_SILHOUETTE_KM` (`station-mesh.ts`).
  The table is now `stationSilhouetteKm(type, formId)`, carried per station
  on `StationMesh.silhouetteKm`. The rule it states, separate tables in
  separate modules, still holds.
- #274's fixture line says `SELECTED_FORM.shipyard` has been the Gantry. The
  selection is now `STATION_FORM_POOL` and `Station.formId`, and the
  shipyard's pool is `[a]`, the Gantry.
