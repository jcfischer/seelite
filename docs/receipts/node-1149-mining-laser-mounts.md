# Node #1149: Mining Lasers fire from their mounts

This ports the approved beam behavior from `prototype/920-drill` at
`3af26015` onto the production miner mounts. The base is `2bb0d465`;
node #1147 is closed and its mount integration is present at `c2bb7350`.
Extraction figures remain provisional until node #922.

## Behavior

With `?mining=1`, each fired Mining Laser casts from its slot's physical
muzzle along the ship's nose. The first ray that hits, in fired-slot order,
chooses the cut rock, regardless of target selection or another ray's distance.
Only rays meeting that rock contribute to its cut. Two 3E lasers provide
0.45 t/s together; misses and rays meeting another rock do not add to that
rock's rate. The existing best-ore-share
rule still chooses the grade of the combined cut.

The cockpit projects each mining beam from its muzzle into the beam pass
behind the cabin. Each beam contains 16 segments, with a glow and a core per
segment. Mining Lasers leave the glass tracer list while the Pulse Laser's
tracer remains. Chase uses the same projected mount segments on its overlay
and retains the Pulse tracer beside them.

The Equipment preview prints the fitted extraction total in t/s, with four
decimal places and a signed change. Size and grade changes, removal, and the
flagless absence of this row have headless coverage. A-grade's existing
ore share produces fewer waste fragments per tonne of ore than E-grade.

## Shared changes and flagless behavior

- `BEAM_CAPACITY` moves from `beam-layer.ts` to `beam-glass.ts` and grows
  from 16 to 128 strokes. Every cockpit uses the larger buffer. The beam
  material, pass order and empty-pass behavior stay the same.
- `laser-modules.ts` exports mount-ray and glass-tracer projections. The
  tracer filter returns the original fired indices without the mining flag,
  for both cockpit and chase.
- `fitReadout` accepts a mining flag, defaulting to false. Its new extraction
  field stays zero without the flag, so `fitDeltas` emits no new row.
  `main.ts` reads `MINING_ON` from URL `mining=1`; `consoleInput` passes it
  as `ConsoleInput.mining` to `outfittingScreen`. An absent flag or `mining=0`
  keeps the extraction row hidden.
- The new browser probe is registered in the catalog and contract roots.
  Its roots cover laser groups, physical muzzles, extraction, beam strokes
  and the GPU layer. The comment-suppression count for `beam-layer.ts`
  decreases by one after removal of the old capacity declaration.

No hull, model, save schema, module catalogue figure or economy tuning changes.
This completes a staged mining implementation rather than adding a public
feature, so it adds no public changelog entry.

## Verification

The adapted prototype tests cover each slot's muzzle, same-rock rate sums,
every laser group with h2 and h2+h3, projected stroke origins, an anchored
beam longer than 200 px with at least 12 segments over 3 px, and capacity for
both mining beams plus every hardpoint tracer and the raider.

Two temporary regressions were rejected, then restored:

- Capacity 16: the capacity test receives 96 vertices instead of 408.
- Mining Lasers on the glass: six group tests fail.

The final affected headless run passes 162 tests across 11 files. The new
Equipment HTML test also passes.

Five affected browser probes pass on the hardware lane, each through
`npm run probe:one -- <name>`:

- `mining-mounts`: 9/9 checks. ALL LASERS draws 390 vertices: 64 mining
  strokes plus one Pulse tracer. Both rays hit the same rock, and 0.05 s
  contributes 0.01125 t of ore at the E-grade share. Chase draws 32 mining
  segments plus one Pulse tracer. Without the flag, three glass tracers
  draw 18 vertices and there is no mining beam or cut.
- `mining-survey`: 24/24 checks, including surface cuts, deposit debits,
  impact placement, chase, fitted-scoop collection and fragment expiry.
- `cockpit-laser`, `fire-groups` and `outfitting`: existing regression probes.

The measured renderer is ANGLE Metal on Apple M1 Pro. The first sandboxed
Chromium launch aborted before opening a page; the successful probe runs
used the same host outside the filesystem sandbox.

Generated review frames are `probe-shots/mining-mounts/cockpit.png`,
`chase.png` and `flagless.png`. The cockpit frame was inspected: two amber
mount beams begin high in the glass beside one cyan Pulse tracer. These
frames are local ignored evidence; the principal retains visual approval.

Probe selection reports broad impact because Game wiring changes. These are
five manually filtered affected-probe runs, not a repository-selected PR
gate or a full browser-suite pass. The worker SOP reserves that final gate,
review, push and PR creation for the supervisor.


## Initial full host run and base comparison

`npm test` ran once on this host: **7,297 pass, 16 fail**, across 445 files.
Every failure exceeded Bun's default 5,000 ms test limit; none reported an
assertion mismatch. The timed-out tests are:

| File | Test |
| --- | --- |
| tests/derelict-tear.test.ts | the live ship is untouched > building a derelict leaves every live hull's geometry as it was |
| tests/station-mesh.test.ts | a station is one object, not a scatter of parts > every plan of a solved form is a single connected assembly, over the seed spread |
| tests/ship-mesh.test.ts | procedural ship visual language > hulls carry visible mass before their compact exhaust cues |
| tests/ship-mesh.test.ts | procedural ship visual language > no solid module sits in the pilot's forward view |
| tests/ship-mesh.test.ts | procedural ship visual language > every nacelle intersects a named structural mount |
| tests/ship-mesh.test.ts | procedural ship visual language > every hull carries nav lights on its own metal, in the port/starboard convention |
| tests/market-state.test.ts | §5.1 the market is independent of draw order elsewhere > nothing in the generator draws from DOMAIN.MARKET |
| tests/miner-install.test.ts | a miner can draw before its template arrives and replaces its stand-in once |
| tests/miner-install.test.ts | the loader installs the miner in slices, publishing the synchronous template only at the end (node #907) |
| tests/station-commerce.test.ts | §5.6 the bid cut, charged by the till > no round trip in tonnage goods nets a credit, at any hull |
| tests/station-commerce.test.ts | §5.6 the bid cut, charged by the till > a market already sold into: 6,327 of 188,325 cycles clear over every dockable hull, by ≤90.00 Cr |
| tests/system-reachability.test.ts | every system is reachable > the corpus is a real one, not an empty pass |
| tests/system-reachability.test.ts | every system is reachable > no system generates without a planet, a primary, or a trade station |
| tests/system-reachability.test.ts | every system is reachable > the retained primary still sits inside the orbit envelope |
| tests/system-reachability.test.ts | every system is reachable > arrival lands somewhere there is something to arrive at |
| tests/exact-amount.test.ts | exact legacy lifting > bit-pattern corpus spans every finite exponent and both signs |

These eight test files are unchanged from base `2bb0d465`. An untouched
`git archive` snapshot of that base, with its own `bunfig.toml` and shipped
models, ran the affected files in isolation on this host. The same comparison
ran on this branch. Both passed **147 tests, 0 failures, 208,664 assertions**
across nine files (the eight files above plus the unchanged Borodin score test).
No timeout was raised and no production workaround was added.

This does **not** prove the full suite passes, or reproduce the timeouts in a
full base run. Their full-suite cause remains unproven. The worker invoked the
full test suite once as required; the supervisor's full merge-base replay remains
the deciding comparison for the base-red exception.

`npm run build` (including typecheck and distribution size checks),
`npm run format:check`, `npm run lint` and `npm run lint:comments` pass.

Local logs: `/tmp/node1149-full-test.log`, `/tmp/node1149-base-test.log`,
`/tmp/node1149-head-isolated.log`; hardware logs use
`/tmp/node1149-{mounts-hardware,survey,cockpit-laser,fire-groups,outfitting}.log`.

## Review round 1

All six findings are addressed. `hardpointKeys` owns the slot-to-muzzle mapping
for laser groups, glass filtering, mining rays and the cockpit tests.
`glassFiredIndices` computes the fired glass indices once per cockpit or chase
projection. Mount strokes carry an explicit `glow` or `core` layer; chase
chooses its colour and counts segments by that field.

`firstHitExtraction` preserves the existing cut policy. The new headless case
puts a nearer rock under the second mount and verifies that the first hitting
mount still chooses the cut rock. It also covers reversed order, a leading
miss, no hits and a shared-rock rate sum. Target selection does not choose the
cut rock.

The Equipment browser check boots separate pages with `mining=1`, no mining
flag and `mining=0`. It reads the rendered preview through the live console,
without injecting `ConsoleInput.mining`. Contract roots now include outfitting
and its view. The receipt names the URL-to-console wiring and uses “test run”
for the verification invocation.

The review's affected headless run passes 140 tests across ten files.
Typecheck, build, distribution size checks, formatting and both linters pass.

Four affected hardware probes pass: `mining-mounts` (14/14 checks),
`mining-survey`, `cockpit-laser` and `fire-groups`. The renderer is ANGLE Metal
on Apple M1 Pro. These are manual affected-probe runs; the supervisor owns the
final PR gate. Logs are `/tmp/node1149-review1-mounts.log`,
`/tmp/node1149-review1-mining-survey.log`,
`/tmp/node1149-review1-cockpit-laser.log` and
`/tmp/node1149-review1-fire-groups.log`.

The final review-round `npm test` ran once on this host and passed:
**7,314 tests, 0 failures**, across 445 files, with 17,073,178 assertions.
The full log is `/tmp/node1149-review1-full-test.log`. This successful run
supersedes the initial run's unresolved timeout result above.
