# `probe-traffic-mouth` across #284: the measurement node #287 asked for

Node #669, measured 2026-10-03. This file records data only. Choosing between
#287's two answers, and any change to the probe, its threshold or the aperture
edge, is for #287.

The same probe was measured on `main` at `24cdf27` by node #672, on both lanes
and with the erosion at 1px and 2px. That record is
[`traffic-mouth-main.md`](traffic-mouth-main.md).

## What was run

Two arms, each a `git archive` of one commit extracted outside the repo with its
own `npm ci`:

| arm | commit | what it is |
| --- | --- | --- |
| **parent** | `f163ac9` | `7208996^`, the tree just before #284 |
| **#284** | `7208996` | "Give the aperture edge one owner" (node #269) |

`scripts/probe-traffic-mouth.mjs` and `scripts/probe-guard.mjs` are the same in
both arms (`git diff 7208996^ 7208996` touches neither), so the instrument is
the same. What differs is #284's change to `src/station-interior-mesh.ts` and
`src/station-mesh.ts`. #284 also adds `scripts/probe-station-mouth.mjs`,
`scripts/measure-mouth-flicker.mjs` and `scripts/lib/flicker-detector.mjs`, and
edits `scripts/check-launcher-wiring.mjs`, but this probe loads none of them.
Both arms lock Playwright 1.62.1, and #284 does not
touch `package.json` or the lockfile.

The probe is the one from those commits, not `main`'s. It counts a pixel as
leaked when `residual > 4`. `LUMA_TOLERANCE` (3ed0cd8) and the GPU lane
(9d268cb, #435) both came later, so this measures the gate #287 asked about and
not the one on `main` today.

**Lane and renderer.** At both commits `npm run probe:one` runs
`probe-all.mjs --only`, which launches Chromium headless through
`launchChromium()` with no options. Those commits have no GPU lane. Each arm's
own `launchChromium()` was asked for its WebGL renderer, and both returned the
same answer:

```
browser   Chromium 151.0.7922.34 (Playwright 1.62.1, headless)
vendor    Google Inc. (Google)
renderer  ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)
machine   Apple M1 Pro, macOS (Darwin 25.6.0), node v24.19.0
```

So every run below is **SwiftShader**. As #1's Constraints say, an absolute luma
figure from this lane is a relative signal and never a player's.

**How each run was taken.** `probe-all.mjs` prints a probe's output only when
the probe fails, and `maxLeak` is in that output, so the runs went through a
small driver (appendix) that does what the arm's `probe-all.mjs --only` does:

- start a fresh vite dev server from the arm's own `node_modules`, on an
  OS-assigned port with `strictPort`;
- launch `node scripts/probe-traffic-mouth.mjs <base>` with `PROBE_ORIGIN` set
  and `PROBE_URL` dropped;
- read the check lines whether the probe passes or fails.

Every run started its own server and its own browser. Runs were serial and
isolated: nothing else was probing, and the full suite was not running.

**Order.** There were 20 pairs. Even-numbered pairs ran parent first and
odd-numbered pairs ran #284 first, so neither arm always held the same place in
the order as the machine warmed. Before these 40 runs, one smoke run per arm checked the
driver: parent read `maxLeak` 0 and #284 read 3.000, both passing. The smoke
runs are not counted below.

## Failure rate

| arm | N | failed | rate | every failure was |
| --- | --- | --- | --- | --- |
| parent `f163ac9` | 20 | 0 | 0/20 | — |
| #284 `7208996` | 20 | 12 | 12/20 | `leaked: 1` on **both** the direct and the bloom check |

**The failure rate moved across #284, from 0/20 to 12/20.** Fisher's exact test
on that 2×2 table gives a one-sided p of 2.3 × 10⁻⁵ and a two-sided p of
4.5 × 10⁻⁵. No run in either arm failed the overlap check, and no run was
missing its bars. Every red was the leak check.

## Per-run readings

`leaked` and `maxLeak` come from the probe's own output, for both of its passes.
`overlap` is the number of pixels compared. `bar x/y` is the chosen bar's
projected position in NDC, as the probe reports it. `s` is the wall time of the
whole run in seconds, server start included.

### parent `f163ac9`

| run | exit | overlap | direct leaked | direct maxLeak | bloom leaked | bloom maxLeak | bar x | bar y | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02851 | -0.00767 | 21.3 |
| 2 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02850 | -0.00766 | 21.3 |
| 3 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02851 | -0.00767 | 21.2 |
| 4 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02854 | -0.00772 | 21.3 |
| 5 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02850 | -0.00766 | 21.3 |
| 6 | 0 | 102 | 0 | 0.886 | 0 | 0.886 | -0.02858 | -0.00777 | 21.2 |
| 7 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02852 | -0.00769 | 21.2 |
| 8 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02849 | -0.00764 | 21.3 |
| 9 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02851 | -0.00768 | 21.3 |
| 10 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02851 | -0.00768 | 21.3 |
| 11 | 0 | 99 | 0 | 0.000 | 0 | 0.000 | -0.02844 | -0.00758 | 21.0 |
| 12 | 0 | 99 | 0 | 0.000 | 0 | 0.000 | -0.02844 | -0.00758 | 21.4 |
| 13 | 0 | 99 | 0 | 0.000 | 0 | 0.000 | -0.02847 | -0.00761 | 20.7 |
| 14 | 0 | 99 | 0 | 0.000 | 0 | 0.000 | -0.02845 | -0.00759 | 20.6 |
| 15 | 0 | 99 | 0 | 0.000 | 0 | 0.000 | -0.02850 | -0.00765 | 21.4 |
| 16 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02853 | -0.00771 | 21.3 |
| 17 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02851 | -0.00767 | 21.7 |
| 18 | 0 | 102 | 0 | 0.413 | 0 | 0.114 | -0.02857 | -0.00776 | 21.7 |
| 19 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02855 | -0.00774 | 21.5 |
| 20 | 0 | 102 | 0 | 0.000 | 0 | 0.000 | -0.02855 | -0.00772 | 21.4 |

### #284 `7208996`

| run | exit | overlap | direct leaked | direct maxLeak | bloom leaked | bloom maxLeak | bar x | bar y | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **1** | 100 | 1 | 7.815 | 1 | 7.815 | -0.02853 | -0.00769 | 21.3 |
| 2 | 0 | 102 | 0 | 2.000 | 0 | 2.000 | -0.02851 | -0.00767 | 21.4 |
| 3 | 0 | 100 | 0 | 2.413 | 0 | 2.413 | -0.02850 | -0.00766 | 21.2 |
| 4 | **1** | 100 | 1 | 8.516 | 1 | 8.815 | -0.02853 | -0.00769 | 21.3 |
| 5 | 0 | 101 | 0 | 2.587 | 0 | 2.587 | -0.02851 | -0.00766 | 21.3 |
| 6 | **1** | 102 | 1 | 4.815 | 1 | 4.815 | -0.02852 | -0.00768 | 21.3 |
| 7 | **1** | 102 | 1 | 7.815 | 1 | 7.516 | -0.02852 | -0.00768 | 21.4 |
| 8 | **1** | 100 | 1 | 8.516 | 1 | 8.516 | -0.02855 | -0.00772 | 21.6 |
| 9 | 0 | 100 | 0 | 3.000 | 0 | 3.000 | -0.02851 | -0.00767 | 21.4 |
| 10 | **1** | 102 | 1 | 8.402 | 1 | 8.402 | -0.02852 | -0.00768 | 21.3 |
| 11 | 0 | 100 | 0 | 4.000 | 0 | 4.000 | -0.02850 | -0.00766 | 20.9 |
| 12 | **1** | 100 | 1 | 7.402 | 1 | 7.402 | -0.02848 | -0.00764 | 21.0 |
| 13 | **1** | 101 | 1 | 4.114 | 1 | 4.114 | -0.02858 | -0.00776 | 20.9 |
| 14 | **1** | 100 | 1 | 7.402 | 1 | 7.402 | -0.02848 | -0.00762 | 21.5 |
| 15 | **1** | 100 | 1 | 8.815 | 1 | 8.815 | -0.02854 | -0.00771 | 21.5 |
| 16 | **1** | 102 | 1 | 5.402 | 1 | 5.402 | -0.02851 | -0.00768 | 21.5 |
| 17 | **1** | 101 | 1 | 7.516 | 1 | 7.516 | -0.02854 | -0.00771 | 22.2 |
| 18 | 0 | 100 | 0 | 2.701 | 0 | 2.701 | -0.02850 | -0.00766 | 21.5 |
| 19 | 0 | 101 | 0 | 3.000 | 0 | 3.000 | -0.02858 | -0.00777 | 22.1 |
| 20 | 0 | 101 | 0 | 3.000 | 0 | 3.114 | -0.02858 | -0.00777 | 21.5 |

## Raw `maxLeak` values

The direct pass, in run order, at the precision the probe printed:

```
parent  0 0 0 0 0 0.8859999999999957 0 0 0 0 0 0 0 0 0 0 0 0.4130000000000038 0 0
#284    7.814999999999998 2.0000000000000036 2.413000000000004 8.515999999999998
        2.5870000000000033 4.814999999999998 7.815000000000005 8.515999999999998
        3.000000000000007 8.402000000000001 4 7.401999999999994 4.113999999999997
        7.401999999999994 8.815000000000005 5.402000000000001 7.515999999999991
        2.7010000000000005 3 3
```

The bloom pass, where it differs from direct: parent run 18 reads
0.11399999999999721. #284 run 4 reads 8.815000000000005, run 7 reads
7.516000000000005, and run 20 reads 3.113999999999997.

**`maxLeak` floors at 0.** The probe starts it at `let maxLeak = 0` and takes
`Math.max` over the residuals, so a reading of 0 means *no positive residual
anywhere in the overlap*. It does not mean the residual was zero. Negative
residuals are never seen.

## Spreads

| arm | N | direct `maxLeak` min | median | max | runs at 0 |
| --- | --- | --- | --- | --- | --- |
| parent | 20 | 0 (floor) | 0 (floor) | 0.886 | 18 |
| #284 | 20 | 2.000 | 5.109 | 8.815 | 0 |

The two distributions **do not overlap**. The lowest #284 reading (2.000) is
above the highest parent reading (0.886), so 400 of 400 cross-arm pairings put
#284 higher. At #284 the passing runs read 2.000–4.000 and the failing runs read
4.114–8.815, and each failure is a single pixel over the threshold. The
readings do not form two clusters. The spread runs continuously through the
threshold (4.000 passes, 4.114 fails), and its widest gap is 5.402 → 7.402,
not at 4.

#287 quotes four failing magnitudes from 2026-09-10: 4.114, 4.815, 8.516 and
8.815. All four occur exactly in the #284 arm above: 4.114 in run 13, 4.815 in run 6,
8.516 in runs 4 and 8, and 8.815 in run 15. The values are quantised: each `maxLeak` is a luma difference of 8-bit
channel steps, so the same few figures recur. None of those four values occurs
in the parent arm.

**The chosen bar's screen position does not explain the spread.** Across all
40 runs the bar's projected position stayed within 1.4 × 10⁻⁴ NDC in x and
1.9 × 10⁻⁴ in y. At the probe's 720 × 450 readback that is about 0.05 px across
and 0.04 px down. Within the #284 arm
the failing and passing runs share the same bar positions. The frames are still
not identical from run to run: `overlap` varies between 99 and 102, and parent
runs 11–15 read 99 as one contiguous block. So something in the rendered frame
changes between runs that this instrument does not identify. The probe reports
nothing else about the frame, such as the station's spin phase or the boot
clock, so this measurement does not show what drives the run-to-run variation
inside the #284 arm.

### Step 2 of the node: not owed

The node asks for a `maxLeak` spread on a build with no leak only if the failure
rate did not move. It moved, so that step was not run as a separate
measurement. The parent arm above is itself a build that never leaked in 20
runs, on this lane and this instrument. Its spread is in the table: 18 runs at
the floor, plus 0.413 and 0.886, with N = 20. No tolerance is proposed here.

## Limits of this measurement

- **Isolated runs only.** Every run here was serial and alone on the machine.
  #287's own observations include a full-suite run, where SwiftShader runs
  under different load (#99's lesson). This measurement says nothing about how
  load changes the rate. It did not need to, because the isolated data already
  separates the arms.
- **One lane.** These runs used SwiftShader, through headless Chromium
  151.0.7922.34. The GPU lane did not exist at either commit. `main`'s probe now
  runs on the GPU lane and with `LUMA_TOLERANCE = 1`, and neither was measured
  here.
- **One machine** (M1 Pro).
- The threshold is evaluated in this file, but not changed: the probe ran
  exactly as it was at those commits.

## Which answer the data supports

**B.** Before #284 the probe never failed in 20 isolated runs, and it found no
positive residual through the hull in 18 of them. The two that did read 0.413
and 0.886, well under the threshold. At `7208996` it failed 12 of 20 runs on the
same lane, the same instrument and the same dependency lock, and it read a
residual of at least 2.000 in **every** run. So #284 introduced a residual, and
it is there whether a run passes or fails: the two `maxLeak` distributions are
fully separated. The failure rate moved from 0/20 to 12/20, with two-sided
p = 4.5 × 10⁻⁵. Answer A, a 4/255 threshold sitting in the measurement's own
noise, does not fit the parent arm, where the noise stays under 0.9 on this
lane. A does describe one feature of the post-#284 build: its residual varies
from run to run between 2.0 and 8.8 while the chosen bar's screen position stays fixed, and the
threshold of 4 falls inside that range. That is why the leak shows up as a
flake rather than as a red on every run. But the residual that varies is the
one #284 created. The data does not say whether that residual is a defect in
the edge or acceptable rasterisation at the new geometry. That is #287's
question, and so is any tolerance.

## Appendix: the driver

This is the script that took the 40 counted runs, kept outside the repo so the
branch commits only this file. It is abridged: the header comment, the console
echo of each record and the final `process.exit(0)` are omitted. The two smoke
runs used an earlier version that had no `barScreen` or `failed` fields. It is
invoked as
`node run-once.mjs <arm-dir> <label> <out.jsonl> <run>`, and the arms
alternated as described above. `spawn` in it is Node's `child_process` API, quoted
as it ran, not the game's vocabulary.

```js
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import net from "node:net";
const [arm, label, outFile, runIndex] = process.argv.slice(2);
process.chdir(arm);
const { createServer } = await import(`${arm}/node_modules/vite/dist/node/index.js`);
const port = await new Promise((res, rej) => {
  const p = net.createServer(); p.on("error", rej);
  p.listen(0, "127.0.0.1", () => { const { port } = p.address(); p.close(() => res(port)); });
});
const server = await createServer({ server: { port, strictPort: true, host: "127.0.0.1", open: false }, logLevel: "warn" });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const env = { ...process.env, PROBE_ORIGIN: base }; delete env.PROBE_URL;
const started = Date.now();
const { code, out } = await new Promise((res) => {
  const child = spawn(process.execPath, [`${arm}/scripts/probe-traffic-mouth.mjs`, base], { env, stdio: ["ignore", "pipe", "pipe"] });
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
const failed = out.split("\n").filter((l) => l.startsWith(" FAIL ")).map((l) => l.slice(6, 80));
const rec = { label, run: Number(runIndex), exit: code, ms: Date.now() - started, direct, bloom, barScreen: full?.barScreen ?? null, failed };
if (!direct || !bloom) rec.raw = out;
appendFileSync(outFile, JSON.stringify(rec) + "\n");
```

The renderer was read with each arm's own `launchChromium()`, using
`WEBGL_debug_renderer_info` on a fresh `webgl2` canvas.
