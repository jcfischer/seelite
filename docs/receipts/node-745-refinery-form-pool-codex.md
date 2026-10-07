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
catalogue. All three carry dock-face ports and obstruction beacons, with vent
nozzles open and facing the approach. Spar's vents move from behind the rock
to its forward shoulder, and its heat ring leaves the ports visible. Collar
and Spar gain their own mounted macro pipe/tank declarations. These repairs
are bounded to the newly pooled forms; existing vent-bank consumers retain
their prior behavior.

`probe-docking.mjs` adds fresh-page generated refinery runs at world seeds
1/a, 28/b, 2/c and 4/d. Each goes through the live clearance, computer,
arrival and launch protocols, then flies away. It asserts the drawn form,
berth, entry, return to flight, outward motion and zero collision impacts.

The first complete headless run found that the avoidance corpus now drew
only Warren and Spar. Its blind assist-off control struck 18 of 39 runs,
below the existing majority threshold. Seeds 4 and 28 add Works and Collar
while retaining every original seed; a new row holds coverage of every
pooled refinery form. All avoidance thresholds remain unchanged.

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

Node #744's principal ruling waives the candidate sheet and visual sign-off.
This is a player-visible change under `src/changelog.ts`'s definition; its
entry is proposed copy pending the principal's approval before merge.

## Verification

`npm test`: **5,384 pass, 0 fail**, 292 files (311.32 s). After consolidating
the Spar's duplicate beacon into the shared vent-bank builder, the final glow
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
