# Parallel CI station-greeble investigation

Refs #1206. The cause is not yet established and this diagnostic change is not
a correction to station geometry or CI isolation.

## Existing failures

The initial shard-3 CI runs for isolated field study PR #1203 (`d031d6a1`) and
outage PR #1205 (`5786c618`) failed the same mounting and outline assertions.
Their unchanged-head retries passed. Both failure logs name exactly 32 distinct
floating instance IDs at the first tested form: stock trade a (10 crates, 7
tanks and 15 fins). The assertion stops that loop, so the logs do not establish
that other forms would pass.

Failure evidence: `/tmp/seelite-pr1203-ci-failed.log` (run 42319438727, job
128240148239) and `/tmp/seelite-pr1205-final-shard3.log` (run 42328103867,
failed job 128268135891, passing retry job 128275827406). Main `a107a16` and
the field-study head have identical test, source and CI-workflow trees.

## Matching local experiment

Installed Bun 1.4.2 into an isolated npm cache under `/tmp/greeble1206-npm`;
the global Bun 1.4.4 installation is unchanged. At clean main `a107a16`, ran:

```sh
bun test tests/ --shard=3/4 --timeout=60000 --parallel=3 --no-isolate --timings=tests/timings.json
```

The pinned local run passes 2,531 tests and 6,721,210 assertions across 149
files in 142.21 seconds, including both target assertions. Log:
`/tmp/greeble1206-pinned-shard3.log`. That first command omitted CI's
`--update-timings` flag. A second run at diagnostic head `d13dc1bf` included
that flag as well and passed the same 2,531 tests and 6,721,210 assertions in
141.51 seconds. Its original committed timing input was restored byte-for-byte
afterward. Log: `/tmp/greeble1206-pinned-actual-flags.log`. Both runs report
Bun build `744846f84`, matching the failed CI log. The second run matches CI's
flags and timing input, but runs on Darwin arm64 rather than Linux x64.
There is no available local Linux container runtime. The green run establishes
neither a platform cause nor a global-state leak.

Separately, seven related station/ship suites ran in one reused worker with
`--parallel=1 --no-isolate --timings=tests/timings.json --timeout=60000`:
station-mesh, station-finish, ship-finish, ship-mesh, ship-muzzles, station-glow
and station-greebles. All 179 tests and 188,818 assertions pass in 23.62 seconds
(`/tmp/greeble1206-one-worker-fixtures.log`). Combining these fixtures' registry
history does not reproduce the defect locally; this is not a proof that all
state leaks are absent.

## Failure-only observation

The existing assertions and loops are unchanged. Once their failure condition
is already known, a diagnostic reads current transforms, geometry samples,
nonfinite component counts, material sides and the full current Mesh prototype
raycast function text, together with runtime/platform/CPU/finish information.
Cached bounds, normal samples and draw ranges are read without recomputing them.
Each mesh reports whether its raycast matches that prototype. The first three
missed instances also retain the actual verification ray vectors, instance
transform, dimensions, range and hit count, including the initial origin and
nudge axis needed to reconstruct the casts. It keeps the first twelve encountered
meshes and all subsequent greeble meshes. Diagnostic exceptions are caught so
the original assertion still reports the failure.

The instrumented existing suite passes 13 tests and 266 assertions with pinned
Bun, and typecheck passes. Logs: `/tmp/greeble1206-diagnostic-local.log` and
`/tmp/greeble1206-diagnostic-tsc.log`. After expanding the ray capture, the same
suite and typecheck pass again in `/tmp/greeble1206-response-{local,tsc}.log`.

A deliberately zero-length verification ray exercises the red logging path.
This is synthetic, not a reproduction of the CI defect: the healthy fixture
reports 32 floating IDs, fifteen mesh records and zero nonfinite geometry
components; the original mounting assertion still fails with exit 1. The
diagnostic itself reports no exception. Log:
`/tmp/greeble1206-diagnostic-forced-red.log`. The temporary mutation was
restored before committing.
The expanded logging path is exercised separately in
`/tmp/greeble1206-response-forced-red.log`: three complete missed-ray snapshots,
full prototype source and cached bounds are present; the diagnostic reports no
exception and the original assertion still exits 1. This is also synthetic.

Sage round 1 returned one suggestion and no blocker: a function prefix did not
justify describing the raycast implementation, and the actual missed rays were
absent. The response records the full current prototype source and missed-ray
inputs above; neither those records nor a matching source string clear the
entire ray path. Review stops under the suggestion-only rule.

## Remaining evidence

The first instrumented Linux PR CI run at `d13dc1bf` passes its four unit
shards, including the two target assertions. Run: 42334550996; shard-3 job:
128288427956. This supplies no failing state to interpret. The response head's
normal CI at `7e55ca87` subsequently reproduces both original failures. Its
assembled core has finite positions and 108 nonfinite normal components;
greeble instance transforms and missed-ray inputs are nonfinite. The material
side and object world transforms are ordinary. Raw evidence:
`/tmp/seelite-pr1207-final-shard3.log`, with complete parsed snapshots at
`/tmp/seelite-greeble-diagnostic-{mount,outline}.json`. This locates invalid data
upstream of the verification rays, but does not establish its origin.
A green run alone is not a cure. Runtime source,
configuration, browser probes, test tolerances and assertions remain unchanged. This diff is confined
to a headless test and prose, so no browser run is required by CLAUDE.md.

## Construction-stage experiment

Test-only checkpoints wrap the existing `computeVertexNormals` and
`normalizeNormals` methods and restore both after the file. They report only
invalid Polyhedron normal arrays, before and after each stage. Numeric values
are encoded as strings so NaN and infinities remain distinguishable. Counts,
item size, normalization flag and array type accompany the values. Reports
are bounded and diagnostic exceptions retain the original failure path.

A separate bounded case constructs 2,048 raw polyhedra using the actual
production core's `parameters`, without copying its geometry literals. During
that loop both methods are restored to their original unwrapped versions;
invalid arrays are observed only after construction. A `finally` restores the
checkpoints for the original target tests and disposes the source mesh. The
pinned local target suite passes 14 tests and 2,314 assertions in 3.65 seconds;
typecheck and the standard static/build gates pass. Logs use
`/tmp/greeble1206-cause-{local,tsc,format,lint,comments,wiring,build}.log`.
No production source, normal calculation, tolerance or CI setting changes.
The next Linux observation will distinguish computation/normalization from
later assembly; wrapping methods can change optimization, so another green
result alone would not exonerate those stages.

The `c8394ff5` Linux observation (run 42338582287, shard-3 job
128301070274) passes all gates: shard 3 has 2,532 passes and no failures, and
no invalid-stage report appears. This establishes a negative control only.
The next arm leaves `computeVertexNormals` unwrapped and observes only the
normalization boundary. Its raw-constructor control runs after the original
tests, so its warmup cannot change the original cases preceding it. A failing
pre-normalization record would locate corruption before normalization; a
newly invalid post-normalization record would locate it inside that stage.
A green result still cannot rule out optimization effects from the observer.

The native-compute arm at `7862288d` also passes Linux shard 3 (run
42339247549, job 128303053159): 2,532 passes, zero failures, no invalid-stage
report. Its local full log verifies all thirteen original cases precede the
constructor control: `/tmp/greeble1206-native-compute-order.log`. Linux raw
log: `/tmp/greeble1206-native-compute-linux.log`. This is another negative
observation, not an explanation.

The next arm leaves both computation and normalization methods untouched. A
test-only `setAttribute` observer checks the existing normals before position
replacement and the new normals after normal replacement. The aperture ring
first copies old normals into a new array, then replaces position and normal
attributes; these observations distinguish invalid old data from an invalid
copy. Failure records include position metadata and raw-versus-getter samples.
The constructor control restores native attribute dispatch in a `try/finally`.

The attribute-boundary arm at `3c9e6694` passes all required Linux CI gates in
run 42339799878. Shard-3 job 128304765051 has 2,532 passes, zero failures and
no invalid-stage report; raw log `/tmp/greeble1206-attribute-linux.log`.
The native control takes 42.55 ms. No cause is established by these three
negative observer experiments.

A further temporary diagnostic arm removes every prototype observer. Private
checkpoints immediately after the unchanged production polyhedron constructor
and after the aperture ring report invalid normals with constructor parameters,
raw position/normal values, attribute metadata and getter samples. They do not
recompute or mutate geometry. Constructor internals retain native computation,
normalization and attribute dispatch. These source diagnostics are experimental
and will be removed after the observation; they are not a candidate correction
or a final source change. The original assertion path remains intact. Local
pinned target validation passes 14 cases and 2,314 assertions; typecheck passes.
Logs: `/tmp/greeble1206-source-stage-{local,tsc}.log`.

## Final diagnostic scope and limits

The final temporary source arm was `189c44859744c4cb4fee06155fa9bbff00c16ce6`
(run 42340543467, shard-3 job 128307061154). It observed the native constructor,
the exact pre-append boundary and the post-append boundary without patching any
Three method. Shard 3 passes 2,532 tests in 412.11 seconds, with zero failures
and no invalid-normal report; the native control takes 75.13 ms. Raw log:
`/tmp/greeble1206-source-stage-linux.log`. Exact experimental source is retained
at `/tmp/greeble1206-source-stage-189c4485-station-mesh.ts` and in that commit.
The extra reads and allocations can still affect execution; this fourth green
arm is negative evidence, not a cure.

All experimental source checkpoints and prototype observers are removed.
`src/station-mesh.ts` is byte-identical to its pre-experiment baseline and has
no diff against `a107a16`. No production source or CI/runtime configuration
remains changed. The final headless test retains the original oracles and
failure-only state capture, plus the trailing native constructor control.
The captured normal sample now uses strings to distinguish NaN and positive or
negative infinity on a future failure. The old `7e55ca87` JSON-null samples
remain ambiguous and are not retroactively classified.

The final local pinned target suite, format, lint, comment guard, launcher
wiring and build pass. Logs: `/tmp/greeble1206-final-{local,format,lint,comments,wiring,build}.log`.
Four distinct observational arms failed to reproduce the origin. The actual
invalid assembled state at `7e55ca87` remains the positive evidence. There is
no demonstrated cause, correction or version-specific claim; node #1206 remains
open and PR #1207 remains a diagnostic draft. Darwin arm64 cannot stand in for
Linux x64, and local x64 execution is also unavailable (`arch -x86_64` reports
`Bad CPU type in executable`). No system runtime installation was attempted.
