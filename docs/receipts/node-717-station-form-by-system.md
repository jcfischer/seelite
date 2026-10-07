# Node #717 — each system picks its stations' forms

What was built, what is still the principal's, and what a pool owes before it
grows. Measured on this branch. The view counts and the galaxy-wide shares are
reprinted by `bun scripts/measure-station-forms.ts`; the red-row counts under
"What each candidate owes" are not — they come from a temporary edit of the
pools, and repeating that edit is how to reproduce them.

**The node's title says *fly every built form*, and this branch flies none
it did not fly before.** It ships the per-system draw: every pool holds the one
form its role already flew (trade `[a]`, shipyard `[a]`, refinery `[d]`,
pinned by `tests/station-form.test.ts`), so every system still builds the
same three stations, and no other form flies until the principal grows a pool.
The title names where the node is going. Read it as a description of this
branch and it overstates it.

## Built

- **`STATION_FORM_POOL`** (`src/station.ts`) replaces `SELECTED_FORM`: the
  forms a system may build each role in, one line per role. `SELECTED_FORM`
  is deleted rather than kept beside it, so any reader that still asked "the
  role's form" is a compile error rather than a per-type answer.
- **`DOMAIN.STATION_FORM` (33)**, appended. `stationForms(systemSeed)`
  (`src/station-form.ts`) draws one form per fixed type slot, one draw per <!-- glossary-ignore: slot -->
  slot, uniform within the pool. It draws every slot whether or not the system <!-- glossary-ignore: slot -->
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
  - the proxy: `stationProxyOf` reads `station.formId`, and its cache key
    carries the form.
- **These rows iterate `FORMS_IN_PLAY`** (`tests/helpers/forms-in-play.ts`),
  so a form added to a pool is measured by them without being named:
  - the reach budget, the proxy budget and its opening, thinnest-figure and
    berth-seed rows;
  - the aperture size and plane, the bay-in-core row, the spinner;
  - the finish reach, corridor and fixture rows;
  - the glow wiring rows: a glow per fitting, hidden at outline, unpickable,
    driven at its fitting's intensity, under the ceiling, the blinking core
    and halo;
  - the pool rows: drive, unpickable, none on a mast beacon; <!-- glossary-ignore: beacon -->
  - the mouth chase: its ring and its run;
  - occlusion, teardown, and the docking plan corpus.

  The thinnest-primitive figure is declared per form, and a pooled form
  without one is red.

- **Other rows build one named form, and a newly pooled form gets none of
  them.** They were found with these three searches over `tests/`, and every
  hit of them is listed below:

  ```sh
  # a form-taking call with both literals
  grep -rnE '(buildStationForm|stationProxy|stationProxyOf|stationInForm|stationSilhouetteKm)\(\s*"(trade|shipyard|refinery)",\s*"[a-e]"|formId: "[a-e]"|HISTORICAL_FORM' tests
  # a role and a form literal on one line: tuples and plans
  grep -rnE '"(trade|shipyard|refinery)"[^;]{0,40}"[a-e]"' tests
  # a form literal bound to a name, then passed
  grep -rnE '(const|let)\s+\w+\s*(:\s*\w+\s*)?=\s*"[a-e]"' tests
  ```

  The first alone missed the plant-cell row below, which binds its form to a
  name before passing it; the third is what finds it. The searches read
  lines, so a form that reaches its call any other way — computed, or
  carried across lines — is not found by them.

  Each hit is one of five kinds:

  - **A control that breaks a known form on purpose.** It asks whether the
    check can go red, not whether a form passes:
    - `the pool row goes red for a lamp lifted off its face` (`station-glow`); <!-- glossary-ignore: beacon -->
    - `the row goes red for a beacon a hundred metres off its mount` and `and
      for a strobe six metres off its face` (`station-mesh`);
    - `the axis row goes red when a strobe is put back on the equator`
      (`station-visuals`);
    - `the proxy cache is keyed on the form` (`station-form`);
    - `the fit can go red: a hull flown in off the axis meets the rim`
      (`collision-stations`).
  - **A wiring or shader check that does not depend on the form.** A new form
    shares the code these test:
    - `the core gain is in the shader` and `the pixel ratio reaches the
      shader` (`station-glow`);
    - `a fixture's intensity is its base times its own waveform`
      (`station-visuals`);
    - `two colours give two different stations`, `this module supplies no
      pixels` and `each plate has its own material` (`station-mesh`);
    - `the shared marks are on the resources every system reuses`
      (`gpu-teardown`);
    - `the quality gate is not the detail band wearing another name`
      (`station-greebles`).
  - **A row about one form's own parts, by name.** These do not check another
    form in the same pool, and a form pooled beside them owes its own rows
    for whatever it carries:
    - the Works, refinery `d`:
      - `an obstruction beacon on a tip lays no pool` (`station-glow`); <!-- glossary-ignore: beacon -->
      - `the refinery's flare keeps tracking the clock at outline range` and <!-- glossary-ignore: beacon -->
        `every refinery plan carries a beacon on its headframe and one on its
        flare stack` (`station-visuals`);
      - `the refinery's proxy reads the assembly seed, cell by cell` and
        `the refinery's cells carry its plant: without them the plant is
        outside` (`station-proxy`).
    - the Coriolis, trade `a`, in `collision-stations`:
      - the rows on `turnInto`;
      - `a ship touching a station face while it turns in takes §3's damage at
        ω × r, and ends outside`;
      - the wing over its coaming.
    - the Gantry, shipyard `a`, in `collision-stations`:
      - `the shipyard's keel does not turn with its drum`;
      - `the crossing count excludes empty space inside a sparse station's
        reach`.
    - the Wheel, trade `e`: `tests/station-wheel.test.ts`, which holds the
      hub its slot is cut into. The Wheel is in no pool. <!-- glossary-ignore: slot -->
  - **Historical docking fixtures, pinned on purpose.** `flyTheComputer` flies
    `HISTORICAL_FORM` (`tests/helpers/fly-the-computer.ts`) when a row gives
    no plan. That is the form each role flew when the docking-handling ceilings
    were measured. A newly pooled form gets no handling ceiling from these
    fixtures. A row about every form passes `stationPlansFor` instead.
  - **Named forms built beside the pools, not instead of them.** These reach
    a newly pooled form through `FORMS_IN_PLAY` or a property of the form,
    and the named ones are extras:
    - `no pooled member on any form exceeds its material's cap`
      (`station-finish`) builds `FORMS_IN_PLAY` plus trade `d`, refinery `d`
      and outpost `d`;
    - `SOLVED_FORMS` (`tests/helpers/solved-forms.ts`) names the forms whose
      shape is solved from the assembly seed, and three `station-mesh` rows
      read it: `a solved form stays inside its declared reach at every seed
      in the spread`, `every plan of a solved form is a single connected
      assembly, over the seed spread` and `the approach corridor is clear on
      every plan of a solved form, over the seed spread`. A pooled form that
      is not solved owes none of them; a new solved form joins the list by
      hand.

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

- seed 47's trade becomes the Wheel and its shipyard the Hangar; <!-- glossary-ignore: Hangar -->
- seed 2's refinery becomes the Spar.

The galaxy-wide shares under that illustration come out within 18.5–22.6% for
the five trade forms (N = 2,048 trade stations, world seed 47, eight
galaxies).

## What each candidate owes before it joins a pool

Measured over the whole suite (`bun test tests/`), one candidate at a time, at
`a24c71e`. Each run was a temporary, uncommitted edit that adds the one form to
its role's pool and leaves the other pools as shipped — for example `trade:
["a", "b"]` in `src/station.ts` — then restored the file and checked the tree
was clean. The shipped suite at that head is 5,375 pass, 0 fail.

One candidate per run, because several rows loop over the forms inside a
single `test()` and stop at the first form that fails, so a run with two new
forms would hide the second's reds.

| Form | Red | Pool pin | Proxy budget | Throws on the missing proxy | Fails on its own |
|---|---|---|---|---|---|
| trade b Ring | 76 | 1 | 5 | 66 | 4 |
| trade c Drum | 76 | 1 | 5 | 66 | 4 |
| trade d Assembly | 74 | 1 | 5 | 66 | 2 |
| trade e Wheel | 79 | 1 | 5 | 66 | 7 |
| shipyard b Hangar <!-- glossary-ignore: Hangar --> | 29 | 1 | 5 | 18 | 5 |
| shipyard c Slipway | 30 | 1 | 5 | 18 | 6 |
| refinery a Warren | 29 | 1 | 5 | 21 | 2 |
| refinery b Collar | 33 | 1 | 5 | 21 | 6 |
| refinery c Spar | 34 | 1 | 5 | 21 | 7 |

The columns:

- **Pool pin** is red by design: `the shipped pools are the forms each role
  already flew` (`station-form`). Growing a pool updates it.
- **Proxy budget** is the five rows of `station proxy budget`
  (`station-proxy`). No candidate has a proxy.
- **Throws on the missing proxy** are rows that build a generated system
  whose station draws the candidate, then ask for its proxy, and throw
  `<role> form <id> has no proxy`. Every trade candidate gave the same files:
  `collision-traffic` 26, `combat-enemy-avoidance` 16, `collision-stations`
  15, `collision-handoff` 8 and `station-form` 1. Shipyard gave
  `combat-enemy-avoidance` 15 and `collision-stations` 3. Refinery gave
  `combat-enemy-avoidance` 15 and `collision-stations` 6. These rows say
  nothing about the form yet: what each would read once a proxy exists is
  not measured.
- **Fails on its own** are rows that name the candidate and fail on it:

| Form | Rows |
|---|---|
| trade b Ring | `station-mesh`: M1, M2, M3, M4 |
| trade c Drum | `station-mesh`: M1, M2, M4; `station-visuals`: V1 |
| trade d Assembly | `station-finish`: F1, F2 |
| trade e Wheel | `station-interior`: I1; `station-mesh`: M1, M2, M3, M4; `station-finish`: F1, F2 |
| shipyard b Hangar <!-- glossary-ignore: Hangar --> | `station-mesh`: M1, M4; `station-finish`: F1, F2; `station-visuals`: V1 |
| shipyard c Slipway | `station-mesh`: M1, M2, M4; `station-finish`: F1, F2; `station-visuals`: V1 |
| refinery a Warren | `station-glow`: G1; `station-visuals`: V1 |
| refinery b Collar | `station-mesh`: M1, M4; `station-finish`: F1, F2; `station-glow`: G1; `station-visuals`: V1 |
| refinery c Spar | `station-mesh`: M1, M3, M4; `station-finish`: F1, F2; `station-glow`: G1; `station-visuals`: V1 |

- M1: `the drawn interior spans exactly the volume the sim declares`;
- M2: `a slot form's hull reaches its declared aperture plane`; <!-- glossary-ignore: slot -->
- M3: `the form the game ships parks every ship inside its own interior`;
- M4: `a selected form's drawn bay is the sim's catalogue, berth for berth`;
- I1: `the bay fits inside the hull of the form that holds it`;
- F1: `the fixtures are there under an industrial finish and not under stock`;
- F2: `the fixtures are mounted: every member is supported, through others, by
  structure`;
- G1: `the <role> <id>'s fittings each have a glow child of the same name`;
- V1: `the <role> <id>'s fixtures are all reachable down its own axis, on every
  plan`.

So no candidate owes only a proxy. The Assembly and the Warren fail the
fewest rows of their own, two each, and the Wheel and the Spar the most,
seven each. What the rows that throw on the missing proxy would read once a
proxy exists is not measured, so this does not rank the candidates. Every
candidate but the Assembly and the Warren fails at least one of the bay and
interior rows (M1–M4, I1), two of which name what they hold to: `a selected
form's…` and `the form the game ships…`.

The Assembly is a solved form, so its proxy has to read the plan, as the
Works' does (`the refinery's proxy reads the assembly seed, cell by cell`).

A pooled form then still owes the canonical view set before and after, and
the principal's yes on it.

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
- `probe-traffic-engagement`, which calls the station's proxy on the page's
  stations (`selectedStationProxy` at `c550ca0`, renamed `stationProxyOf` in
  sage round 2). Re-run alone after the rename and passing (GPU lane, 1/1);
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
