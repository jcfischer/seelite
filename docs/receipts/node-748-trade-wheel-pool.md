# Node #748 — the Wheel joins the trade pool

Trade now draws `[a, b, c, d, e]`, uniformly and in form-id order through the
unchanged `stationForms` mechanism. The other pools and the outpost are
unchanged. No `STATION_GEOMETRY`, aperture, berth catalogue, carrier identity
or generator version changes.

The Wheel's hub front extends from 260 m to the existing 428 m trade plane.
Its slot and bay belong to `hub`; `core` names the finished rim. The shared
bay-box and hull-at-plane rows now measure that hub, and the Wheel's own
ray row still measures its actual section through the whole bay.

Its independently written proxy has rectangular-section rim segments, eight
spokes, the cut hub and radiator envelopes, the aft mast and the rim's lamp
masts, all spinning. The proxy leaves both the docking opening and the gaps
between the spokes and rims open. The thinnest primitive is pinned at
16 m (0.016 km). Industrial finishes add a service main and
two obstruction lamps on the finished rim's forward face. The role's strobe pair
mounts on the hub's forward cap so the narrow cockpit approach can see both.
The hub and its lamps share a member group; the named `hub` mesh still owns
only its hull geometry, so bay bounds exclude fixtures. Existing budgets and
tolerances are unchanged.

Every built trade form now has a proxy, so the refusal test injects an
unsupported runtime form into the trade pool, generates a station drawing
it, and checks the exact `trade form unsupported has no proxy` error. It
restores the pool in `finally`. The cache row also distinguishes the Wheel
from the Coriolis at identical seeds before checking the unsupported form.

## View impact for the PR body

Before editing the pool, `bun scripts/measure-station-forms.ts trade=a,b,c,d,e`
reported **11 of 17 station-framing views move**, all on seed 47 from Assembly
to Wheel:

`cockpit-arrival`, `cockpit-backlit`, `station-approach`, `station-flank`,
`station-range`, `station-horizon`, `berth-arrival`, `berth-arrival-cabin`,
`berth-docked-forward`, `berth-free-look`, `berth-launch-chase`.

Repeat on this branch with `trade=a,b,c,d` for the reverse comparison. At
world seed 47 over all eight galaxies and 2,048 trade stations, the five-form
draw gives Coriolis 378 (18.5%), Ring 395 (19.3%), Drum 425 (20.8%), Assembly
462 (22.6%) and Wheel 388 (18.9%). The instrument also names 58 views whose
incidental station content or workbench framing it cannot assess.

Node #744 waives another candidate sheet, canonical capture and principal
visual sign-off. No visual approval of these repairs is claimed. This is a
major player-visible addition; the changelog sentence is proposed for the
principal's approval before merge.

## Coverage and limits

The pool pin failed first against the old pool. Pooling e then exposed its
missing proxy and existing bay/mesh/finish failures. The first proxy's spoke
capsule roots crossed the bay; the unchanged opening row caught 420 sample
points. Their roots now clear it. The Wheel's vertex, reach, opening,
thickness and gap rows pass.

Review round 1 restored generated trade forms in the all-civilian cruise
handling row. A dedicated regression keeps the exact seed-2 courier flight
beside its generated Wheel (bearing 0, first placed station), with the same
production collision sweep and a blind control that hits it. Before repair,
`expect(run(true).met).toBeNull()` received `"station-trade"`.

The controller changed its heading but requested only forward speed. While
turning, its assist braked toward the pilot's star frame and dragged the
initially co-moving courier into the rim after about 1.8 seconds. In the
existing fallback where no heading clears the moving solid, it now requests
lateral assist toward the least-closing heading as well. These are velocity
demands inside the unchanged speed cap, using the hull's bounded vents and
the same fight frame. Ordinary avoidance turns and mouth holds retain their
forward-speed control. No proxy, geometry, collision tolerance or assertion
threshold changed in this repair.

The same regression passes after repair, with its blind impact retained.
All 65 avoidance tests pass, including the restored generated-form civilian
row, all pooled-form regimes, gun-run floors, body avoidance and open-space
identity. This does not claim all hull × form combinations are contact-free.

Browser selection was inspected before execution. Git selection against the
unchanged HEAD had no diff and failed closed to all 109 probes; diagnostic
path selection with intent selected 73/109. The worker contract limits local
execution to affected probes and leaves the final full browser gate to the
supervisor. Local probe results and final headless gates are recorded below.

GPU lane: ANGLE Metal, Apple M1 Pro. `probe-docking` passed 73/73 and
`probe-docking-traffic` 4/4. The former docks, launches and flies
away from generated trade a/b/c/d/e at seeds 3/5/21/12/1, in start systems
24/95/147/54/90, with zero impacts. The Wheel gained 1.00969 km axially
after launching. Each case checks the generated form; none mutates it.
The host sandbox initially aborted Chromium before any checks ran; the same
affected command passed outside the sandbox. These are partial browser runs.

`probe-collision` passed 35/35, including generated Wheel at world seed 42,
system 3. Its hub is hit 170 m off-axis at 0.1 km/s: the ship bounces, survives,
spends only fore shield, and crosses no aperture plane. The drawn face is
15.1 m from the fore-face ray after the bounce (reported, not a changed gate).

`probe-station-visuals` passed 46/46 with an explicit generated Wheel assertion
at seed 2, beside a refinery and shipyard, on desktop and narrow viewports.
The Wheel's original rim-mounted strobes read on desktop but both contributed
zero pixels on the narrow fixture; moving the pair to the hub cap made the
same unchanged per-fixture floors green. The 48 related headless visual and
Wheel tests also pass.

The old seed-54 visual fixture now draws Ring rather than Coriolis and was
42/44, with strobe-a reading zero at both viewports. It is not a Wheel result.
This node scopes that probe to Wheel and does not repair Ring's mounting or
claim its browser fixture is green. This observation is retained for the
supervisor's review.

## Initial implementation headless gates

The required single full `npm test` run passed **6,495 tests, 0 failures**
across 375 files, in 696.85 seconds on this host. Production build (including
typecheck), format and lint gates passed. No production code changed after
that run. The supervisor owns the full browser acceptance run and Sage review;
the local GPU evidence above covers four affected contracts, not the full suite.

## Review round 1 verification

The restored generated-form civilian row and the explicit courier/Wheel
regression pass within all 65 avoidance tests. The related engagement, duel,
station-form and Wheel files pass 83 tests. Typecheck, production build,
format and lint pass.

Selection was inspected before the review-pass probes: the branch's existing
Git diff selects 109 contracts; the uncommitted controller path's diagnostic
selection names 23. The worker contract leaves the full browser gate to the
supervisor. Locally, `probe-traffic-engagement` passes 22/22 on the GPU lane
(ANGLE Metal, Apple M1 Pro), including the armed return-fire row with zero
impacts. `probe-raider-frame` also passes on that lane. Chromium aborted in
the sandbox before any checks; the same affected commands ran outside it.
This is affected coverage, not a full browser gate.

The review pass's single full `npm test` run passed **6,496 tests, 0 failures**
across 375 files in 695.58 seconds on this host. No implementation changes
followed that run. The supervisor owns the final full browser gate.
