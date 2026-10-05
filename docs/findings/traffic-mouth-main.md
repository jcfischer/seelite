# `probe-traffic-mouth` on today's `main`: is #284's residual still there?

Node #672, measured 2026-10-05. This file records data only. It changes nothing
in the probe, its threshold, its erosion or the aperture edge, and it does not
chart the follow-up. #669's record of the same probe across #284 is
[`traffic-mouth-flake.md`](traffic-mouth-flake.md), and it stays as written.

## What was run

All arms are `main` at **`24cdf276af44270089d9d6b5d39dc0ba133a658e`**
(`24cdf27`, "Armed hulls fire back again…", node #697). That was `origin/main`
when the runs began, and the branch was clean. Each arm is a `git archive` of
that commit extracted outside the repo, with its own `npm ci`:

| arm | tree | lane | erosion | what it is |
| --- | --- | --- | --- | --- |
| **gpu-2px** | `24cdf27` as is | GPU (`SEELITE_PROBE_RENDERER=hardware`) | 2px | what `npm run probe:one probe-traffic-mouth` runs |
| **cpu-2px** | `24cdf27` as is | SwiftShader (variable unset) | 2px | what `npm run probe:cpu -- --only probe-traffic-mouth` runs |
| **cpu-1px** | `24cdf27` plus the scratch edit below | SwiftShader | 1px | the node's arm 2 |

The scratch edit is the exact inverse of 9d268cb's hunk to this probe and
nothing else. It was made in the extracted copy and never committed:

```diff
-					for (let y = 2; y < H - 2; y++) {
-						for (let x = 2; x < W - 2; x++) {
+					for (let y = 1; y < H - 1; y++) {
+						for (let x = 1; x < W - 1; x++) {
 							let solid = 1;
-							for (let oy = -2; oy <= 2 && solid; oy++)
-								for (let ox = -2; ox <= 2; ox++)
+							for (let oy = -1; oy <= 1 && solid; oy++)
+								for (let ox = -1; ox <= 1; ox++)
```

**The gate is `main`'s.** A pixel leaks when its residual exceeds
`LEAK_LUMA + LUMA_TOLERANCE` = **5**, where #669's commits used 4. So `exit`,
`leaked` and the failure rates below are **not comparable with #669's 12/20**.
`maxLeak` is the raw residual, and it is comparable. It is what this node's
question reads.

### Renderer per lane

Each lane's own `launchChromium()` from the extracted tree was asked for its
WebGL renderer on a fresh `webgl2` canvas, with the lane's environment:

```
GPU lane         Chromium 151.0.7922.34 (Playwright, channel "chromium", new headless)
                 vendor    Google Inc. (Apple)
                 renderer  ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)
SwiftShader lane Chromium 151.0.7922.34 (chrome-headless-shell)
                 vendor    Google Inc. (Google)
                 renderer  ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)
machine          Apple M1 Pro, macOS (Darwin 25.6.0), node v24.19.0
```

The 1px tree's SwiftShader lane read the same string. On the GPU lane the
probe's own `launchChromium()` prints `[probe] hardware renderer: …` on every
launch. All 20 counted GPU runs printed the Metal string above, and the driver
recorded it per run. The SwiftShader lane prints nothing, which is why it was
read separately. The SwiftShader renderer matches #669's exactly.

### How each run was taken

The runs used #669's driver, extended (appendix). For every run it:

- starts a fresh vite dev server from the tree's own `node_modules`, on an
  OS-assigned port;
- launches `node scripts/probe-traffic-mouth.mjs <base>` with `PROBE_ORIGIN`
  set and `PROBE_URL` dropped, and sets or unsets `SEELITE_PROBE_RENDERER` for
  the lane, as `probe-all.mjs` would;
- reads the check lines whether the probe passes or fails.

`probe-all.mjs` prints a probe's output only on failure, and `maxLeak` lives in
that output, so the runner itself was not used. Each run started its own server
and its own browser. Before each run the driver refused to start if
`/tmp/seelite-probe.lock` existed, and it never did. So no probe suite ran
during any counted run.

**Order.** The 20 GPU runs came first, as one block. Then the two SwiftShader
arms ran as 20 interleaved pairs: odd pairs ran cpu-2px first, even pairs ran
cpu-1px first. That keeps machine drift from tracking the erosion arm. One smoke
run per arm came before any of this, to check the parsing. They are not counted:
gpu-2px read 4.000 and passed, cpu-2px read 9.587 and failed, cpu-1px read 8.815
and failed.

**Load.** The machine was not idle. The 1-minute load average read 11–25 across
the counted runs. The load came from Spotlight indexing, an endpoint security
agent, mail, a browser and another session's `bun test`, not from a probe suite.
`load` in the tables is the 1-minute average just before each run.

## Failure rate

| arm | N | failed | rate | direct check red | bloom check red | overlap |
| --- | --- | --- | --- | --- | --- | --- |
| gpu-2px | 20 | 0 | 0/20 | 0 | 0 | 31–34 |
| cpu-2px | 20 | 16 | 16/20 | 15 | 16 | 33–38 |
| cpu-1px | 20 | 15 | 15/20 | 14 | 15 | 96–97 |

Every red was the leak check (direct, bloom or both). No run failed the overlap
check, and every run found its four bars.

**The SwiftShader lane is red on `main`**: 16 of 20 runs fail at the current
gate of 5. The GPU lane, which `npm run probe` runs, did not fail in 20 runs.

## Per-run readings

Columns are as in #669: `leaked` and `maxLeak` for both of the probe's passes,
`overlap` as the number of pixels compared, and `bar x/y` as the chosen bar's
projected position in NDC. `s` is the wall time of the whole run in seconds,
server start included.

### gpu-2px

| run | exit | overlap | direct leaked | direct maxLeak | bloom leaked | bloom maxLeak | bar x | bar y | load | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 32 | 0 | 4.000 | 0 | 4.299 | -0.02458 | -0.00271 | 16.0 | 3.2 |
| 2 | 0 | 33 | 0 | 3.000 | 0 | 3.000 | -0.02491 | -0.00310 | 15.3 | 3.3 |
| 3 | 0 | 32 | 0 | 3.114 | 0 | 4.000 | -0.02452 | -0.00264 | 15.3 | 2.7 |
| 4 | 0 | 31 | 0 | 4.000 | 0 | 3.701 | -0.02476 | -0.00292 | 16.8 | 3.6 |
| 5 | 0 | 32 | 0 | 3.114 | 0 | 3.114 | -0.02478 | -0.00294 | 17.0 | 3.1 |
| 6 | 0 | 32 | 0 | 4.000 | 0 | 4.886 | -0.02456 | -0.00269 | 17.0 | 2.8 |
| 7 | 0 | 32 | 0 | 3.114 | 0 | 3.886 | -0.02458 | -0.00271 | 17.7 | 2.8 |
| 8 | 0 | 32 | 0 | 4.413 | 0 | 5.000 | -0.02451 | -0.00263 | 17.5 | 2.8 |
| 9 | 0 | 32 | 0 | 4.299 | 0 | 4.701 | -0.02464 | -0.00278 | 17.5 | 3.1 |
| 10 | 0 | 32 | 0 | 4.000 | 0 | 4.000 | -0.02453 | -0.00266 | 17.0 | 2.7 |
| 11 | 0 | 34 | 0 | 3.701 | 0 | 3.587 | -0.02497 | -0.00316 | 17.0 | 3.3 |
| 12 | 0 | 32 | 0 | 3.587 | 0 | 3.587 | -0.02448 | -0.00259 | 16.2 | 3.0 |
| 13 | 0 | 32 | 0 | 3.701 | 0 | 4.000 | -0.02451 | -0.00263 | 21.7 | 2.7 |
| 14 | 0 | 32 | 0 | 3.114 | 0 | 3.413 | -0.02448 | -0.00260 | 21.7 | 2.7 |
| 15 | 0 | 32 | 0 | 4.000 | 0 | 4.114 | -0.02451 | -0.00263 | 22.0 | 2.7 |
| 16 | 0 | 32 | 0 | 3.000 | 0 | 3.000 | -0.02446 | -0.00257 | 22.0 | 2.8 |
| 17 | 0 | 32 | 0 | 3.114 | 0 | 4.114 | -0.02455 | -0.00267 | 21.0 | 2.8 |
| 18 | 0 | 32 | 0 | 4.000 | 0 | 4.000 | -0.02450 | -0.00262 | 20.6 | 2.7 |
| 19 | 0 | 32 | 0 | 4.000 | 0 | 4.000 | -0.02445 | -0.00256 | 20.6 | 2.6 |
| 20 | 0 | 32 | 0 | 4.114 | 0 | 4.701 | -0.02455 | -0.00267 | 20.6 | 2.8 |

### cpu-2px

| run | exit | overlap | direct leaked | direct maxLeak | bloom leaked | bloom maxLeak | bar x | bar y | load | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 38 | 0 | 3.701 | 0 | 4.299 | -0.02673 | -0.00534 | 20.0 | 24.1 |
| 2 | **1** | 33 | 2 | 9.815 | 2 | 10.000 | -0.02712 | -0.00585 | 21.3 | 25.2 |
| 3 | **1** | 33 | 1 | 9.000 | 1 | 9.701 | -0.02712 | -0.00585 | 19.4 | 32.5 |
| 4 | **1** | 33 | 1 | 8.587 | 1 | 8.701 | -0.02712 | -0.00585 | 19.3 | 24.3 |
| 5 | **1** | 33 | 1 | 9.000 | 1 | 9.000 | -0.02712 | -0.00585 | 19.7 | 24.2 |
| 6 | **1** | 33 | 1 | 10.000 | 1 | 9.815 | -0.02712 | -0.00585 | 13.7 | 25.9 |
| 7 | **1** | 33 | 1 | 8.114 | 1 | 8.114 | -0.02712 | -0.00585 | 14.8 | 25.7 |
| 8 | **1** | 33 | 1 | 8.402 | 1 | 8.587 | -0.02712 | -0.00585 | 14.8 | 24.9 |
| 9 | 0 | 33 | 0 | 4.413 | 0 | 4.587 | -0.02712 | -0.00585 | 16.6 | 24.6 |
| 10 | **1** | 33 | 1 | 8.701 | 1 | 9.701 | -0.02712 | -0.00585 | 19.4 | 23.1 |
| 11 | **1** | 33 | 1 | 8.701 | 1 | 9.587 | -0.02712 | -0.00585 | 20.1 | 23.4 |
| 12 | **1** | 33 | 1 | 8.402 | 1 | 8.114 | -0.02712 | -0.00585 | 19.2 | 24.9 |
| 13 | **1** | 33 | 0 | 4.701 | 1 | 5.000 | -0.02712 | -0.00585 | 19.8 | 22.6 |
| 14 | **1** | 33 | 1 | 8.114 | 1 | 8.587 | -0.02712 | -0.00585 | 16.8 | 23.4 |
| 15 | **1** | 33 | 1 | 8.000 | 1 | 8.587 | -0.02712 | -0.00585 | 20.9 | 22.6 |
| 16 | **1** | 33 | 1 | 10.815 | 1 | 10.701 | -0.02711 | -0.00584 | 24.8 | 22.9 |
| 17 | **1** | 33 | 1 | 9.000 | 1 | 9.587 | -0.02712 | -0.00585 | 21.7 | 23.0 |
| 18 | **1** | 33 | 1 | 7.701 | 1 | 8.587 | -0.02712 | -0.00585 | 15.4 | 22.7 |
| 19 | 0 | 33 | 0 | 4.114 | 0 | 4.886 | -0.02712 | -0.00585 | 14.1 | 22.5 |
| 20 | 0 | 33 | 0 | 2.000 | 0 | 2.114 | -0.02709 | -0.00582 | 11.2 | 22.6 |

Run 13 failed on the bloom check alone, which read 5.000 at three decimals and
`5.000000000000007` raw. That is a residual of exactly five 8-bit steps,
evaluated as just over 5. It is the same rounding shape the
`LUMA_TOLERANCE` comment describes at 4.

### cpu-1px

| run | exit | overlap | direct leaked | direct maxLeak | bloom leaked | bloom maxLeak | bar x | bar y | load | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 96 | 0 | 4.114 | 0 | 4.587 | -0.02712 | -0.00585 | 20.3 | 24.7 |
| 2 | **1** | 96 | 1 | 9.701 | 1 | 9.114 | -0.02712 | -0.00585 | 19.7 | 25.7 |
| 3 | **1** | 96 | 1 | 9.000 | 2 | 9.701 | -0.02712 | -0.00585 | 24.3 | 25.0 |
| 4 | **1** | 96 | 1 | 8.114 | 1 | 8.000 | -0.02712 | -0.00585 | 24.7 | 27.1 |
| 5 | **1** | 96 | 1 | 7.701 | 1 | 8.587 | -0.02712 | -0.00585 | 17.1 | 24.2 |
| 6 | 0 | 96 | 0 | 4.587 | 0 | 4.886 | -0.02712 | -0.00585 | 15.6 | 25.8 |
| 7 | **1** | 96 | 1 | 8.701 | 1 | 8.587 | -0.02712 | -0.00585 | 14.5 | 25.0 |
| 8 | 0 | 96 | 0 | 4.701 | 0 | 4.886 | -0.02712 | -0.00585 | 16.3 | 24.0 |
| 9 | **1** | 96 | 1 | 8.402 | 1 | 8.587 | -0.02712 | -0.00585 | 15.7 | 25.7 |
| 10 | **1** | 96 | 1 | 10.114 | 1 | 9.701 | -0.02712 | -0.00585 | 19.4 | 23.9 |
| 11 | **1** | 96 | 0 | 4.114 | 1 | 5.114 | -0.02712 | -0.00585 | 19.5 | 24.5 |
| 12 | 0 | 97 | 0 | 3.701 | 0 | 4.114 | -0.02594 | -0.00434 | 20.3 | 24.5 |
| 13 | **1** | 96 | 1 | 8.000 | 1 | 8.413 | -0.02712 | -0.00585 | 17.4 | 23.5 |
| 14 | **1** | 96 | 1 | 9.000 | 1 | 9.701 | -0.02712 | -0.00585 | 18.4 | 24.2 |
| 15 | **1** | 96 | 1 | 8.815 | 1 | 9.587 | -0.02712 | -0.00585 | 24.8 | 24.1 |
| 16 | **1** | 96 | 1 | 9.000 | 1 | 9.402 | -0.02712 | -0.00585 | 24.9 | 24.2 |
| 17 | **1** | 96 | 1 | 7.815 | 1 | 8.587 | -0.02712 | -0.00585 | 17.6 | 22.9 |
| 18 | **1** | 96 | 1 | 8.701 | 1 | 9.000 | -0.02712 | -0.00585 | 18.7 | 22.7 |
| 19 | **1** | 96 | 1 | 8.701 | 1 | 8.114 | -0.02712 | -0.00585 | 12.7 | 22.6 |
| 20 | 0 | 96 | 0 | 4.701 | 0 | 4.114 | -0.02712 | -0.00585 | 11.8 | 23.0 |

## Raw `maxLeak` values

In run order, at the precision the probe printed.

```
gpu-2px  direct  4 3 3.113999999999997 4 3.113999999999997 3.999999999999993
                 3.1140000000000043 4.412999999999997 4.298999999999992
                 4.000000000000007 3.7010000000000005 3.586999999999996
                 3.7010000000000005 3.113999999999997 4 2.999999999999993
                 3.1140000000000043 4 4.000000000000007 4.114000000000004
gpu-2px  bloom   4.299000000000007 3 4 3.7010000000000005 3.113999999999997
                 4.886000000000003 3.8859999999999886 5 4.701000000000008
                 4.000000000000007 3.5870000000000033 3.586999999999996 4
                 3.4129999999999967 4.113999999999997 3 4.11399999999999 4
                 4.000000000000007 4.7010000000000005
cpu-2px  direct  3.7009999999999934 9.814999999999998 9 8.587000000000003 9 10
                 8.113999999999997 8.402000000000008 4.412999999999997 8.701
                 8.701 8.402000000000008 4.701000000000008 8.114000000000004 8
                 10.814999999999998 9 7.7010000000000005 4.114000000000004
                 2.000000000000007
cpu-2px  bloom   4.299000000000007 10 9.701 8.701 9 9.814999999999998
                 8.114000000000004 8.587000000000003 4.586999999999996 9.701
                 9.587000000000003 8.113999999999997 5.000000000000007
                 8.587000000000003 8.587000000000003 10.701 9.587000000000003
                 8.587000000000003 4.885999999999996 2.1140000000000114
cpu-1px  direct  4.114000000000004 9.701 9 8.113999999999997 7.7010000000000005
                 4.587000000000003 8.701 4.7010000000000005 8.402000000000008
                 10.113999999999997 4.114000000000004 3.7009999999999934 8 9
                 8.814999999999998 9 7.815000000000005 8.701 8.701000000000008
                 4.7010000000000005
cpu-1px  bloom   4.586999999999996 9.113999999999997 9.701 8 8.587000000000003
                 4.885999999999996 8.586999999999996 4.886000000000003
                 8.587000000000003 9.701 5.114000000000004 4.114000000000004
                 8.412999999999997 9.701 9.587000000000003 9.402000000000008
                 8.587000000000003 9 8.114000000000004 4.114000000000004
```

**`maxLeak` floors at 0**, as #669 notes. The probe starts it at
`let maxLeak = 0`, so 0 means *no positive residual anywhere in the overlap*. No
run in any arm read 0 here.

## Spreads

| arm | N | direct min | median | max | bloom min | median | max | runs at 0 | runs above 0.886 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpu-2px | 20 | 3.000 | 3.850 | 4.413 | 3.000 | 4.000 | 5.000 | 0 | 20 |
| cpu-2px | 20 | 2.000 | 8.402 | 10.815 | 2.114 | 8.587 | 10.701 | 0 | 20 |
| cpu-1px | 20 | 3.701 | 8.258 | 10.114 | 4.114 | 8.587 | 9.701 | 0 | 20 |
| *#669 parent `f163ac9`* | 20 | 0 (floor) | 0 (floor) | 0.886 | | | | 18 | 0 |
| *#669 #284 `7208996`* | 20 | 2.000 | 5.109 | 8.815 | | | | 0 | 20 |

The last two rows are #669's direct-pass figures, quoted for comparison. They
were measured on SwiftShader, at the 1px erosion and the gate of 4.

**Every run in every arm reads a positive residual above 0.886.** The lowest
reading anywhere is 2.000 (cpu-2px run 20). On both SwiftShader arms the median
is about 8.3–8.4, well above #669's 5.109 for the post-#284 build.

**The SwiftShader readings fall into two groups.** In the 40 SwiftShader runs, no
direct reading lies between 4.701 and 7.701. Eleven runs read 2.000–4.701 and
29 read 7.701–10.815. #669 saw a continuous spread at `7208996`, with its widest
gap at 5.402 → 7.402. The groups do not follow the chosen bar: cpu-2px runs
9, 13 and 19 read low at the same bar position as the high runs. This instrument
does not show what picks the group.

**Re-read at #669's gate.** `leaked > 0` exactly when `maxLeak` exceeds the
threshold, so the raw values can be re-read at #669's gate of 4. On direct,
**cpu-1px exceeds 4 in 19 of 20 runs**. Its lane and erosion are the ones #669
measured `7208996` on, where the same reading was 12 of 20. cpu-2px exceeds 4 in
18 of 20 runs. Five GPU runs exceed 4 on direct, but two of those are
`4.000000000000007`, a residual of exactly four steps.

**The GPU lane is green but has no margin on bloom.** Its direct residual stays
at 3.000–4.413. Its bloom residual reached **5.000 exactly** in run 8, which is
the gate. That run passed only because `5 > 5` is false. On SwiftShader,
cpu-2px run 13 read five steps as `5.000000000000007` and failed.

**The chosen bar sits elsewhere than in #669, and differs by lane.** On
SwiftShader it lies within 3 × 10⁻⁵ NDC of (-0.02712, -0.00585) in 38 of 40
runs. The other two were cpu-2px run 1 (overlap 38) and cpu-1px run 12
(overlap 97). In #669 it was at
about (-0.0285, -0.0077). On the GPU lane the bar is at about
(-0.0245, -0.0027), and its overlap of 31–34 is close to SwiftShader's 33 at the
same erosion. Whether the lanes frame the station at different moments, or
differ for another reason, this instrument does not say.

### Arm 2: does the 2px erosion hide the residual?

**No difference.** Same lane, same build, interleaved:

| | cpu-2px | cpu-1px |
| --- | --- | --- |
| failed | 16/20 | 15/20 |
| direct `maxLeak` median | 8.402 | 8.258 |
| direct `maxLeak` range | 2.000–10.815 | 3.701–10.114 |
| overlap | 33–38 | 96–97 |

Fisher's exact test on the failure counts gives a two-sided p of 1.00. Across
the 400 cross-arm pairings of direct `maxLeak`, cpu-1px reads higher in 180,
cpu-2px reads higher in 199, and 21 are ties. That is a coin toss. The 1px
erosion compares about three times as many pixels (96–97 against 33–38), and
the residual's size does not move with it. On any one frame the 2px set is a
subset of the 1px set, because a pixel solid over a 5×5 neighbourhood is also
solid over 3×3, so the 1px `maxLeak` of that frame can never be lower. The runs
are separate frames, so this bounds each run and not the comparison. Even so,
two indistinguishable distributions say the extra edge pixels add nothing
larger. So the residual is not confined to
the pixels the 2px erosion strips, and the 2px erosion does not hide it.

## Limits of this measurement

- **Ambient load.** No probe suite ran during any run, but the machine carried a
  1-minute load of 11–25 from other work. #669 records that nothing else was
  probing, but gives no load figure, so the two cannot be compared on load.
  Whether load moves this residual is not measured here. Within these runs, low
  readings occur at loads from 11 to 20.
- **No GPU baseline before #284.** 0.886 is #669's parent maximum on
  **SwiftShader**. No pre-#284 build has been measured on the GPU lane, so a GPU
  reading of 3–4 above 0.886 meets the node's rule as written. Whether a GPU
  build without #284 would read 0 there is not known.
- **One machine** (M1 Pro), one Chromium (151.0.7922.34).
- **The GPU block was not interleaved** with the SwiftShader arms. It ran first,
  as its own block. Only the two SwiftShader arms are compared against each
  other.
- `maxLeak` is the single worst pixel. It says that a positive residual exists
  and how large it is, not how many pixels carry one. `leaked` counts pixels
  over the gate, and never exceeded 2 in any run.

## What the data says

**A positive residual above #669's parent floor of 0.886 is still present on
`main` at `24cdf27`, on both lanes, in every run.** On SwiftShader it reads
2.000–10.815, median 8.40, with the 2px erosion. Re-read at #669's gate, 19 of
20 runs exceed it at #669's 1px erosion, against 12 of 20 at `7208996`. But the
commit, the framing (the bar has moved, and the 1px overlap is 96–97 against
99–102) and the machine load all differ, so that comparison does not show the
residual has grown. On the GPU lane it reads 3.000–4.413 on
direct and up to 5.000 on bloom. The GPU figure is above 0.886, but 0.886 is a
SwiftShader floor, and no pre-#284 GPU baseline exists to compare it against.

**The erosion arm does not differ from the 2px arm.** At 1px the probe fails
15/20 against 16/20, and the `maxLeak` distributions are indistinguishable. The
2px erosion from 9d268cb does not hide the residual on SwiftShader.

**State of the gate on `main`.** On the GPU lane, which `npm run probe` runs,
the probe was green in 20 of 20 runs. That bounds its failure rate rather than
showing it is zero: 0 failures in 20 is consistent with a rate up to about 14%
at 95% confidence. Its bloom residual touched the gate of 5 exactly once and
passed on equality. On the SwiftShader lane
(`npm run probe:cpu`) it is red in 16 of 20 runs.

Under #287's ruling, a residual present on any lane above 0.886 selects the
**attribution** branch (D3) as well as the instrument node (D4). This file does
not chart either, and does not choose whether to quarantine the probe. Both are
the principal's call.

## Appendix: the driver

The scripts that took the counted runs are kept outside the repo, so the branch
commits only this file. `run-once.mjs` is #669's driver with four changes:

- a `lane` argument that sets or unsets `SEELITE_PROBE_RENDERER`;
- a refusal when `/tmp/seelite-probe.lock` exists;
- the 1-minute load average before the run;
- the `[probe] hardware renderer:` line captured from the probe's output.

It is abridged: the console echo and the final `process.exit(0)` are omitted.
`spawn` in it is Node's `child_process` API, quoted as it ran, not the game's
vocabulary. Because the script `chdir`s into the tree, a relative `<out.jsonl>`
lands in that tree. The two trees' files were concatenated afterwards.

```js
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
const [tree, lane, label, outFile, runIndex] = process.argv.slice(2);
if (lane !== "gpu" && lane !== "cpu") throw new Error(`lane ${lane}`);
if (existsSync("/tmp/seelite-probe.lock"))
	throw new Error("/tmp/seelite-probe.lock exists: another suite is running");
process.chdir(tree);
const { createServer } = await import(`${tree}/node_modules/vite/dist/node/index.js`);
const port = await new Promise((res, rej) => {
	const p = net.createServer(); p.on("error", rej);
	p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
});
const server = await createServer({ server: { port, strictPort: true, host: "127.0.0.1", open: false }, logLevel: "warn" });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const env = { ...process.env, PROBE_ORIGIN: base }; delete env.PROBE_URL;
if (lane === "gpu") env.SEELITE_PROBE_RENDERER = "hardware";
else delete env.SEELITE_PROBE_RENDERER;
const loadBefore = os.loadavg()[0];
const started = Date.now();
const { code, out } = await new Promise((res) => {
	const child = spawn(process.execPath, [`${tree}/scripts/probe-traffic-mouth.mjs`, base], { env, stdio: ["ignore", "pipe", "pipe"] });
	let out = ""; child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
	child.on("close", (code) => res({ code, out }));
});
await server.close();
const grab = (needle) => {
	const line = out.split("\n").find((l) => l.includes(needle));
	const m = line?.match(/ — (\{.*\})\s*$/);
	return m ? JSON.parse(m[1]) : null;
};
const direct = grab("station-mouth geometry writes no pixels");
const bloom = grab("bloom does not restore");
const full = grab("a foreground Traffic hull overlaps");
const renderer = out.split("\n").find((l) => l.startsWith("[probe] hardware renderer:"))
	?.slice("[probe] hardware renderer: ".length) ?? null;
const failed = out.split("\n").filter((l) => l.startsWith(" FAIL ")).map((l) => l.slice(6, 80));
const rec = { label, lane, run: Number(runIndex), exit: code, ms: Date.now() - started,
	load1: Number(loadBefore.toFixed(2)), renderer, direct, bloom, barScreen: full?.barScreen ?? null, failed };
if (!direct || !bloom) rec.raw = out;
appendFileSync(outFile, `${JSON.stringify(rec)}\n`);
```

The pairs were run by a shell loop over `i` = 1–20. Odd `i` ran
`run-once.mjs <main-tree> cpu cpu-2px runs.jsonl $i` then the 1px tree, and even
`i` ran them the other way round. The GPU block was
`run-once.mjs <main-tree> gpu gpu-2px runs.jsonl $i` for `i` = 1–20. No run's
output failed to parse, so no record carries `raw`.

Each renderer string was read by importing the tree's own
`scripts/probe-guard.mjs`, setting or unsetting `SEELITE_PROBE_RENDERER`,
calling `launchChromium()`, and reading `WEBGL_debug_renderer_info` on a fresh
`webgl2` canvas.
