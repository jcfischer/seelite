# Node #745 — every refinery form in the system draw

Author: Codex ranger implement worker, 2026-10-07.

## Built

`STATION_FORM_POOL.refinery` is `[a, b, c, d]`: Warren, Collar, Spar and
Works, in id order. `stationForms` and its uniform draw are unchanged. Trade
and shipyard remain `[a]`; the outpost remains `e`. No carrier identity,
generator version, `STATION_GEOMETRY` value or berth catalogue changes.

Each new refinery form has an independent Three-free proxy. The Warren
covers its carved rock, terraces, loading arm, cranes, masts and vent banks;
the Collar covers its rock, waist band, boss and banks; the Spar covers its
rock, processing shaft, tanks and banks. Each bounds its radiator panels
separately, leaving gaps between wings. Every box crossing the approach is
cut round the role's existing landing well and corridor. The Works' solved
plant proxy is unchanged. The measured thinnest primitives are pinned:

| Form | Thinnest primitive (km) |
|---|---:|
| Warren a | 0.040000 |
| Collar b | 0.046471 |
| Spar c | 0.016800 |
| Works d | 0.026066 |

The pool pin was written first and failed on `[d]`. Forms were added in
sequence a, b, c, with each candidate's remaining reds read separately.
The existing proxy budget, interior, corridor, finish, glow and fixture rows
iterate every pooled member. `stationProxyOf` retains its refusal, and a new
row passes a generated refinery with unsupported form `e` through that guard
and checks the exact `refinery form e has no proxy` error.

The named mesh failures were repaired at their source: Collar and Spar now
build their decks against the sim's plane; Spar's cap supports the berth
catalogue. All three carry dock-face ports and obstruction lamps, with vent
nozzles open and facing the approach. Spar's vents move from behind the rock
to its forward shoulder, and its heat ring leaves the ports visible. Collar
and Spar gain their own mounted macro pipe/tank declarations. These repairs
are bounded to the newly pooled forms; existing vent-bank consumers retain
their prior behavior.

`probe-docking.mjs` adds fresh-page generated refinery runs at world seeds
1/a, 28/b, 2/c and 4/d. Each goes through the live clearance, computer,
arrival and launch protocols, then flies away. It asserts the drawn form,
berth, entry, return to flight, outward motion and zero collision impacts.

The first implementation extended the avoidance seeds to restore a majority
blind control. Review round 1 rejected that repair: it changed the denominator
without explaining the new forms' hit rates. The seed extension is removed.
The original seeds `[1, 2, 3, 9, 47]`, bearings and 39-run historical control
remain, explicitly using the Works refinery as in node #665. Its majority
threshold and gun-rate bands are unchanged, so the original measurements in
the test comments describe that fixture again.

Every pooled refinery form is also flown on **the same four original systems
with refineries**, at the same three bearings: 12 runs per form and regime.
Only the refinery's form is overridden; the generated station geometry,
orbit, seeds, other roles and clock stay fixed. The pilot's stand-off still
derives from each form's proxy reach, as in the original harness, so both the
solid and the engagement trajectory can differ between forms. A majority
blind-hit rate is not a property those fixtures share: under assist-off,
Warren hits 6/12, Collar 5/12, Spar 2/12 and Works 12/12; under assist-on and
cruise every form hits 12/12. The per-form row requires an actual refinery
impact blind and zero impacts avoiding, with no seed search or rate retuning.
Its gun-rate and mouth hold-off rows also run for every form, with the same
bands as the historical fixture. Reprint the blind/avoiding counts with:

```sh
SEELITE_MEASURE_AVOIDANCE=1 bun test tests/combat-enemy-avoidance.test.ts \
  --test-name-pattern 'the fixed per-form corpus'
```

## Canonical views for the PR body

Measured with `bun scripts/measure-station-forms.ts refinery=d` against this
branch's final pool. The argument reverses the comparison to the old pool,
so read its `c Spar → d Works` rows as **Works → Spar** for this change:

- `station-refinery-axis`, seed 2: Works → Spar.
- `refinery-cradle-berth`, seed 2: Works → Spar.

**2 of the instrument's 16 generated-station views change form.** Its other
52 views are explicitly outside that instrument's coverage (unnamed or
workbench subjects); this is not a claim that their pixels cannot change.
With the final pool, world seed 47 across all eight galaxies generates 773
refineries: Warren 210 (27.2%), Collar 166 (21.5%), Spar 180 (23.3%), Works
217 (28.1%). These are finite-corpus shares, not draw weights.

[Node #744's principal ruling](https://github.com/jcfischer/seelite/issues/744)
(2026-10-07) admits every built form uniformly and waives the candidate sheet
and visual sign-off after the principal saw every form in the station viewer.
This is a player-visible change under `src/changelog.ts`'s definition; its
entry is proposed copy pending the principal's approval before merge.

## Verification

`npm test` (initial implementation): **5,384 pass, 0 fail**, 292 files
(311.32 s). After consolidating the Spar's duplicate obstruction lamp into
the shared vent-bank builder, the final glow
and station-visual rows also pass: **69 pass, 0 fail**. `npm run build`,
`npm run format:check`, `npm run lint` and `npm run check:wiring` pass.

The repository selector evaluated all 91 browser contracts and selected 42
affected scripts, with no fallback. Its exact selection was passed through
`probeRunnerEnvironment` into the canonical `probe:gpu` runner:
**42/42 gating probes passed in 790 s**, sequentially. Chromium's guard
verified `ANGLE Metal Renderer: Apple M1 Pro`. The new four refinery dock,
launch and fly-away cases passed in `probe-docking.mjs`; the existing station,
station-visual, docking-traffic, dock-arrival and collision probes also passed.
This is partial evidence: the other 49 scripts were not run.

The worker ran `npm test` and the affected GPU probes. The supervisor owns
the complete browser suite on the reviewed head, the PR, review, merge and
checkpoint `cp-seelite-pool-refinery-forms`; this worker does none of them.

## Sage review round 1

The avoidance repair above addresses the important oracle finding. All six
glossary findings are corrected: the lamps on vent tips are called obstruction
lamps (they are not Pirate relays), the shared surface is called a landing deck
(it is not one Berth), and the station role is named Raider outpost. The stale
Warren outline measurement is removed. The proxy dispatch uses a nested switch,
and the unsupported-form row stops at its first generated refinery.

The shared dimension table and ring-main extraction suggestions are deferred:
they restructure mesh, fixture and proxy declarations beyond this correction;
the existing vertex-containment and fixture-mount rows continue to check their
agreement. The shell-options suggestion is also deferred: changing the shared
builder API is unnecessary for this pass. The thinnest-primitive pins are kept:
`collision.md` §4.1 calls for the measured figure, not a minimum safe size;
`src/collision.ts` uses conservative advancement on each primitive's separation,
independently of those pins. The containment, opening and no-tunnelling rows
are the independent checks of safety.

Disabling avoidance in the new Spar assist-off row produced the expected red:
2 impacts against its zero-impact assertion. Restoring avoidance passes it.

The review pass's full `npm test` is **5,416 pass, 0 fail**, 292 files
(401.44 s). `npm run build`, `npm run format:check`, `npm run lint` and
`npm run check:wiring` pass.

Before running probes, the repository selector inspected this review pass's
eight changed paths and independently evaluated all 91 contracts: **27 selected,
semantic mode, no fallback**. Its exact set ran sequentially through
`probeRunnerEnvironment` and `probe:gpu`: **27/27 gating probes passed in 418 s**,
with the guard verifying `ANGLE Metal Renderer: Apple M1 Pro`. The four generated
refinery dock/launch/fly-away cases passed again. This is partial evidence;
64 scripts were not run, and the supervisor still owns the full reviewed-head run.
