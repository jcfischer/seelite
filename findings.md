# Node #924 — hull-luma `laneSpread` on the lifted courier (model `6967208f3169…`)

Research worker, 2026-10-14/15, build `c73aa28` (this branch's base, clean tree),
Apple M1 Pro, Playwright 1.62.1. Every reading below came from the shipped
`measureHullChase` reader, driven by `scripts/probe-light-rig.mjs` itself on the
canonical fixture (seed 47, `GAME_TIME_S` 0, 1440×900, `HULL_SAMPLES` 5), against
a guarded dev server serving this worktree (`/__seelite/tree` declared this root
at `c73aa28`, `dirty: false`). The probe had two local edits, both reverted and
never committed: a `NODE924_BOOT_MS` timeout on the `bootedGame(page)` at line
445, and a JSON dump of the `hull` object after `readHullSubject`. A third edit
put extra URL parameters through an env var, and only the control arms used it.
Both lanes read the calibrated subject: `courier (authored, model 6967208f3169)`,
row green.

## Answer

**C1: the SwiftShader lane does boot on this M1 Pro. A probe boot waits for
about 130 frames of work, and a SwiftShader frame takes seconds.** On the
canonical probe URL the boot took **3,941 s (65.7 min)**. With both frame-gated
waits removed it took **11–13.5 s**. "`frames` never rises above 0" is a
misreading: `__seelite` is not published until the frame-gated boot work has
finished, so the predicate in `bootedGame` had no handle to read `frames` from.

**C2: measured on both lanes, one build, five samples each, same-build noise
0.00 on every metric in every arm.**

| canonical (`?seed=47&boot=direct&interiors-full&shipyards-full&refineries-full`) | ANGLE Metal (M1 Pro) | SwiftShader | spread |
| --- | ---: | ---: | ---: |
| peak | 238.2086 | 238.2086 | **0** |
| lower quartile | 34.4768 | 34.4768 | **0** |
| median | 51.6986 | 52.6562 | **0.96** (0.9576) |
| mask pixels | 25,587 | 25,547 | 40 |
| boot (`bootedGame`) | 16.7 s | 3,941 s | |

The lower lane is Metal on every metric (it ties on two of them), as it was on
#831. So the "lifted paints read lower on SwiftShader" risk does not happen:
SwiftShader reads **higher** on the median and identical on the rest. The
`SHIPPED_FLOORS`/`HULL_LUMA_FLOORS` derived from the Metal reading are not too
high for the portable lane. Both lanes passed 12/12 rows.

## How the boot cost was taken apart

`gameUrl` (`scripts/lib/game-url.mjs:155`) adds `interiors-full`,
`shipyards-full` and `refineries-full` to every probe boot unless the caller sets
them to `false`. With those flags, `main.ts` awaits the sliced background
installs before it publishes the handle (`main.ts` ~22009–22014, handle at
~22222). The installs do 4 ms of work per rendered frame (`INTERIOR_SLICE_MS`,
`src/interior-install.ts`). Since `bed3612` (2026-10-14, #685's sage round 1),
`bootedGame` also waits for `!nebulaPending`, which is the nebula sky. That sky
bakes 2048×1024 in 128 eight-row strips, one strip per rAF
(`src/nebula-bake.ts`, `nebulaBakeStrips`).

Each variant was booted once per lane by a throwaway script that counts rAFs and
reads `__seelite.frames` and `nebulaBakeStats`:

| boot | GPU: frames at booted / s | SwiftShader: s |
| --- | --- | --- |
| canonical (full-set flags, nebula on) | 134 / 11.4–16.7 | **3,941** (light-rig run) |
| full-set flags, `nebula=off` | 112 / 10.5 | **> 600**: no handle in 600 s, run stopped |
| no full-set flags, nebula on | 134 / 11.7 | **163** (nebula 156 s over 128 strips, ~1.2 s/frame) |
| no full-set flags, `nebula=off` | 8 / 3.6 | **13.5** (8 frames); 11.0 in the light-rig run |

Most of the hour is the full-set installs. Frames during the installs cost far
more than the ~1.2 s of a nebula frame: they draw the newly installed authored
stations, and every new program compiles synchronously. Chromium logged
`KHR_parallel_shader_compile extension not supported` on SwiftShader, and a CPU
profile of the stalled boot spent 176 of 184 s in native `(program)` time, with
three.js's `onFirstUse` (program link check) the top JS frame. I did not
attribute the cost inside an install frame any further than that.

Machine load was 25–240 (1-min average) across these runs, from FSEvents, Jamf
Protect and a concurrent ranger worker (#905). Boot seconds depend on load and
are stated beside it. The luma readings do not appear to: same-build noise is
0.00 in every arm, and five Metal light-rig runs across the session (load 27–40) read
identically wherever their sky matched.

### Why the earlier attempts failed, read against this

- **#887, 2026-10-11, base `8b7a5871`, 300 s.** `interiors-full` reached main
  with #864 (`0748dad`, merged 2026-10-10 22:47), after #831's merge (`e1faa6f`,
  09:00 that day). So #831's SwiftShader reading was the last one taken before
  probe boots began waiting on a sliced install. `4bde5a2` is an ancestor of
  `8b7a5871` and of `bb1234b0`, and not of `e1faa6f`. Shipyards (`534cd29`) and
  refineries (`82acce7`) joined on 2026-10-13, and the nebula wait on 10-14, so
  the same boot costs more on today's base than it did then.
- **2026-10-11, `bb1234b0` + PR #916, `probe-light-rig.mjs:445`, `Timeout
  20000ms exceeded`.** Line 445 is `await bootedGame(page);` with its default
  20 s. Even the nebula-only boot needs 163 s on SwiftShader, so this row cannot
  boot on the software lane within its own wait. The lane itself is not broken.

## A second finding: the nebula moved the Metal reading, and the calibration predates it

`HULL_LUMA_CALIBRATION` records Metal 238.21 / 34.66 / 51.87 at `node-887`. On
`c73aa28` Metal reads 238.21 / **34.48** / **51.70**, so the quartile is 0.18
lower and the median 0.17. The same build with `?nebula=off` reads **238.2086 /
34.6602 / 51.8688**, exactly #887's figures. So #685's nebula sky (merged
2026-10-14, after #887) changed the environment that lights the hull. The model
did not change. The probe stays green (floors 29.392 and 44.608), but the
recorded calibration is no longer what the shipped sky reads. The subject guard
cannot see this: the hull's sha256 is unchanged, and the sky is not part of the
key. That is #294's warning again, this time about the sky rather than a finish.

Paired control on #887's sky, both lanes on `?seed=47&nebula=off&boot=direct`:

| `nebula=off`, no full-set flags | ANGLE Metal | SwiftShader | spread |
| --- | ---: | ---: | ---: |
| peak | 238.2086 | 238.2086 | 0 |
| lower quartile | 34.6602 | 34.8086 | 0.15 |
| median | 51.8688 | 52.7668 | 0.90 |
| mask pixels | 25,587 | 25,547 | 40 |

Metal is the lower lane here too. On the shipped sky the quartiles agree exactly,
and without the nebula they differ by 0.15.

The full-set flags do not change the hull reading. On Metal, with and without
them, two runs each read 238.2086 / 34.4768 / 51.6986 over 25,587 px with the
nebula on, and 238.2086 / 34.6602 / 51.8688 with it off. That fits the reader,
which hides every scene child except the ship and the lights.

## The edit C2 asks for (this branch cannot carry it)

The research SOP limits this branch to `findings.md`, so `scripts/lib/hull-luma.mjs`
is unchanged. Whoever applies it:

```js
ref: "node-924",            // measured on c73aa28, the nebula sky (#685) on
peak: 238.21,               // both lanes
lowerQuartile: 34.48,       // both lanes
median: 51.7,               // ANGLE Metal, the lower lane (SwiftShader 52.66)
laneSpread: Object.freeze({ peak: 0, lowerQuartile: 0, median: 0.96 }),
```

Derived floors at the unchanged margins: peak **131.016** (unchanged), quartile
**29.239** (was 29.392), median **44.462** (was 44.608). All three stay under
`SHIPPED_FLOORS` (140 / 35 / 70) and above `FLOOR_FRACTION_OF_READING`. Each
margin in codes (5.24 and 7.24) is far above `laneSpread`. `tests/light-rig.test.ts`
reads these only through relations; a repo-wide grep found no other literal of
34.66, 51.87 or the old `laneSpread` outside `hull-luma.mjs` and the closed
receipt `docs/receipts/node-812-courier-hull.md:315`. The docstring then needs:

- the "carried forward unverified" paragraph (lines 87–103) replaced with the
  two-lane table above, saying that both lanes were read on one build;
- the #887 table either kept as history with the nebula caveat, or superseded:
  its 34.66 / 51.87 is the pre-nebula sky, and it is reproduced exactly with
  `?nebula=off`;
- a note that the sky is a lighting input the subject key does not cover.

I have not run the headless suite against this edit, because it is not on this
branch.

## Options for the lane itself (not decided here)

- **O1.** `probe-light-rig` passes `"interiors-full": false, "shipyards-full":
  false, "refineries-full": false`. The hull rows read identically (measured
  above), and a SwiftShader boot drops to ~163 s. The cost: the probe's
  station-framing rows (`up`/`down` px, haze and own-sky deltas) would then
  measure whatever stands in before the trade station's install instead of the
  installed model. I did not read those rows without the flags, so how far they
  move is unmeasured. With the flags they read 1,822/1,990 px on Metal and
  1,861/2,103 on SwiftShader.
- **O2.** Size `bootedGame`'s and the installs' waits by lane. Whatever the
  probe, `probe:cpu` cannot finish while one canonical boot costs about an hour.
  Even the nebula alone (163 s) exceeds every 20 s default.
- **O3.** Leave the lane as it is, and record in `CLAUDE.md` or the probe-guard
  lane notice that `probe:cpu` takes about an hour per full-set boot on an
  M1 Pro, so a timeout there is the wait and not the game.

## Evidence

Raw results are in `/tmp/node-924-out/` (machine-local, not committed):
`hw-full-1.json`, `cpu-full-1.json` (+ `.log`, boot 3,941.32 s),
`hw-nofull-{1,2}.json`, `hw-full-nebulaoff.json`, `hw-nofull-nebulaoff.json`,
`cpu-nofull-nebulaoff.json`, `cpu-boot-full-nebulaoff.log` (600 s timeout) and
`cpu-boot-nofull-nebulaon.log`. The throwaway scripts are in `/tmp/node-924-scripts/`
(`diag-boot`, `profile-boot`, `raf-boot`, `boot-marks`, `frames-at-boot`).
Renderer strings: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified
Version)` and `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)
(0x0000C0DE)), SwiftShader driver)`.
