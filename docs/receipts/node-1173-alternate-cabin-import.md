# Alternate-cabin import (node #1173)

## Diagnosis before the repair

Measured on 2026-11-05 at main `beffb67fa582de1cb22dc6f64bdf801632c71063`,
with the locked Vite 6.4.3 and Three 0.170.0, on an Apple M5 Pro. The hardware
guard reported `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`.

The unchanged `npm run probe:one -- probe-live-cockpit --show-output` passed
35/35 checks, including the alternate cabin. The reported crash is therefore
not unconditional on the hardware lane. This is a different host from the
reported Apple M1 Pro failure.

The probe's `page.evaluate` function is sent directly to Chromium; Vite never
transforms its import expressions. Its absolute loader URL is valid, but the
loader itself imports the bare package name `three`, as does its relative
`BufferGeometryUtils.js` dependency. A browser without an import map cannot
resolve those names. The response graph must contain browser-resolvable URLs.

Importantly, requesting a physical `node_modules` URL does **not** invariably
bypass Vite's transforms. Before editing, an isolated `createServer` using the
repository config produced this matrix for the original loader URL:

| Server dependency state | Application-module warmup | Hardware import | SwiftShader import |
| --- | --- | --- | --- |
| Fresh temporary cache | None | Pass | Pass |
| Same server/cache | Transform `/src/cockpit-model.ts` | Pass | Pass |
| Restart, persisted temporary cache | None | Pass | Pass |
| Restarted server/cache | Transform `/src/cockpit-model.ts` | Pass | Pass |

Each HTTP response was JavaScript with `three` rewritten to the cache's
`/@fs/.../deps/three.js?v=...` URL. Each browser used a fresh page/context and
imported the original URL on a blank same-origin document. The temporary cache
was outside `node_modules/.vite`, so the first row did not inherit that cache.

Serving the loader's **untransformed file bytes** at that URL instead, with a
Playwright route, reproduced the exact reported error on **both** lanes:

```text
TypeError: Failed to resolve module specifier "three". Relative references must start with either "/", "./", or "../".
```

That controlled replay identifies the failing boundary: an unresolved package
import in the served module graph, rather than rendering or the cabin GLB.
It does not establish which server/cache state produced the November 2 response.
Those response bytes were not preserved, and none of the normal Vite states
tested here reproduced it. In particular, the evidence does not justify calling
this a cold-cache failure or changing Vite's configuration.

## Repair and regression surface

`scripts/fixtures/cockpit-text-cabin.ts` is a source entry that re-exports
`GLTFLoader` through the same `three/addons/loaders/GLTFLoader.js` package path
as the game, and `Vector3` through `three`. The alternate-cabin block imports
that entry. Vite now resolves these package imports from source instead of the
probe naming Three's physical installation paths. No application module,
server configuration, assertion, fixture GLB or tolerance changed.

Under the same raw-response replay, importing the new entry passed on hardware
and SwiftShader. The existing alternate-cabin browser row remains the behavioral
regression check: scanner containment, painted and visible ore/survey screens,
clear glass, absent flight screen, visible status and flight fallback, matching
flight pixels, and unpowered systems. A headless loader mock would not exercise
Chromium's import resolution, so no substitute unit assertion was added.

The replay can be repeated from a blank same-origin Playwright page by routing
`**/node_modules/three/examples/jsm/loaders/GLTFLoader.js` to
`readFileSync("node_modules/three/examples/jsm/loaders/GLTFLoader.js", "utf8")`
with content type `text/javascript`. Compare native `import()` of the original
URL with `/scripts/fixtures/cockpit-text-cabin.ts`; do not transform the replayed
body. Use the repository's `launchChromium` guard for each lane. This is a
controlled response replay, not a claim about normal Vite middleware behavior.

The new source entry has explicit live-cockpit ownership. Its routing test was
red before the ownership declaration (31 pass, 1 fail), then green (32 pass).
This change is probe work, outside the public changelog's definition of major.

## Verification

`npm run probe:one -- probe-live-cockpit --show-output` completed alone on
ANGLE Metal / Apple M5 Pro: **35/35 checks passed**, 76.7 s, peak host load 11.0
on 18 cores. Every alternate-cabin boolean was true. This is one probe's
coverage, not a full browser-suite pass; the worker contract reserves that run
for the supervisor.

`bun test tests/probe-impact.test.ts`: **32 pass, 0 fail** after the ownership
declaration. `npm run build` (including typecheck and distribution size checks),
`npm run format:check`, `npm run lint`, `npm run lint:comments`, wiring and
`git diff --check` passed.

The single required `npm test` run returned **7,452 pass, 1 fail** across 461
files. Its only failure was the unrelated
`tests/longwall-mesh.test.ts` row
`before install the selected miner measures stand-in muzzles; install remeasures the authored hull once`:

```text
(fail) miner/b is the shipped model, and only the shipped model > before install the selected miner measures stand-in muzzles; install remeasures the authored hull once [6184.84ms]
  ^ this test timed out after 5000ms.
```

An untouched `git archive origin/main` snapshot, using the same installed
dependencies, passed that entire file alone: **23 pass, 0 fail**, with that row
at 3,167.63 ms. The repaired tree also passed the file alone; its row took
2,437.09 ms. The row and its game dependencies are unchanged from the base.
This demonstrates a full-run timing failure, not a reproduced deterministic
base failure; the supervisor's full base comparison remains authoritative.
No miner code, test timeout or suite setting was changed to accommodate it.

## Resumed delivery on current main

On 2026-11-07, the principal requested completion of mining in this run.
`ranger journal --repo jcfischer/seelite --node 1173` showed generation 2 failed
since 2026-11-05T23:01:24Z, with null process/group IDs and no PR. Its clean
worktree held `9569261d`. The stale assignment was released through
`soma graph release 1173 --identity ivy-agent --repo jcfischer/seelite`, then
claimed as jcfischer. That repair was preserved and cherry-picked onto current
main `a107a16` in `.worktrees/seelite-1173`; no active worker was interrupted.

The untouched current base reproduces the exact bare-`three` crash alone on
ANGLE Metal / Apple M5 Pro in 19.9 seconds, at peak load 8.1 on 18 cores.
Log: `/tmp/seelite-1173-before-live.log`. An initial sandbox launch failed before
the renderer guard; the measured run used the normal external browser lane.

An actual Vite server for this worktree at port 5183 supplies the physical
loader URL with its bare `from 'three'` import intact. The new source entry
instead re-exports both names through optimized `/node_modules/.vite/deps/`
URLs. Saved response bodies are
`/tmp/seelite-1173-served-{physical-loader,source-entry}.js`. Native dynamic
imports on fresh hardware-browser pages fail with the exact error for the old
URL and return the two functions for the new entry. No request interception or
response rewriting was used in this experiment. Its script and output are
`/tmp/seelite-1173-import-check.mjs` and
`/tmp/seelite-1173-native-import-check.log`.

This server uses the existing shared dependency directory through the normal
worktree symlink. That is an observed state, not a proved cause of Vite's
different response from the earlier matrix. The repair needs no cache or
server configuration assumption: its source entry uses Vite's module graph.

The ownership regression was rerun without its declaration: 40 passes and one
failure, specifically the alternate-cockpit selection case. Restoring ownership
gives 41 passes and 2,092 assertions. Logs:
`/tmp/seelite-1173-routing{,-red}.log`. Typecheck, format, script lint, comment
guard, launcher wiring and build pass; their logs are
`/tmp/seelite-1173-{tsc,format,lint,comments,wiring,build}.log`.

The original full-run failures above remain historical; no full-suite pass is
inferred from affected checks. Final Sage, exact-head selected browser evidence
and CI results will be recorded on the PR before merge.
