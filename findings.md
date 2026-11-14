# #905: why is the gate-shut docked cockpit slower after PR #898?

**Short answer.** It isn't, at low quality. The +23% was never measured at low
quality. `measure-cabin-pass-cost.mjs` does not set quality, so both pages ran
at the default, `high`. The table's "gate shut" is the **occlusion gate**
(`occlusionState.open`, #241), not the quality gate. At high the six perimeter
casts are **on**: 9 point lights in the head's cabin against 3 in the base's.
Re-measured with the arms interleaved and the control flat, the build delta does
not reproduce at either quality. With the arm that removes only the six casts,
their cost at high is bounded at ≤ ~0.25 ms GPU, and the measured lean is at
most about +0.2 ms, which does not separate from noise. At low the casts are not
gathered at all, so they cost nothing there.

Caveat up front: C1 asks for a *stable* machine. This one was not stable. Other
ranger agents kept the 1-minute load at 28–64 during the usable runs, against
200–290 earlier. §4 says what that limits and how the bound in §3.3 gets around
it.

## 1. Findings

- **F1. The original reading was taken at `quality: high`.**
  `scripts/measure-cabin-pass-cost.mjs` contains no quality call. Each page is a
  fresh Playwright context with empty `localStorage`, so `SettingsStore` falls
  back to `quality: "high"` (`src/settings.ts:204`, the same at `8b7a5871`). The
  `gate` the script prints is `g.occlusionState.open`
  (`measure-cabin-pass-cost.mjs`, `block()`): the AO/shadow enclosure gate. It is
  shut at `cockpit-arrival` because the camera is in open space. It is not
  `COCKPIT_QUALITY`. So the node's question ("low quality shuts the six casts,
  yet it is slower") rests on a reading in which the six casts were lit.
- **F2. Arm-state readback confirms what each arm drew.** Every block counts the
  `PointLight`s under `g.cockpit.mesh` that are effectively visible. three r170
  drops an invisible light before gathering (`WebGLRenderer.projectObject`:
  `if (object.visible === false) return;`), and `NUM_POINT_LIGHTS` is a program
  define:

  | build | quality | visible / total cabin point lights |
  | --- | --- | --- |
  | base `8b7a5871` | high | 3 / 3 |
  | base | low | 1 / 3 |
  | head `1af6b7c` | high | **9 / 9** |
  | head | high, six casts hidden | 3 / 9 |
  | head | low | **1 / 9** |

  At low the head's cabin compiles and shades exactly what the base's does.
- **F3. Identical draw work across builds.** Full frame at cockpit-arrival:
  597 calls / 2,648,784 triangles at high and 583 / 2,648,759 at low, the same
  on both builds. Cabin pass alone: 65 calls / 37,314 triangles on a 2880×1800
  target in every arm.
- **F4. Nothing else in #898 changes per-frame work.** `git diff 8b7a5871
  1af6b7c -- src/main.ts` is an import re-sort plus five hunks:
  `carriedConsoleLamp`, the `buildPerimeterLamps` loop, `hemisphereIntensityFor`
  at scene build, and their imports. `interior-kit.ts` changes one constant,
  `light-rig.ts` adds a constant and a pure function, and the two GLBs change
  paint and metalness values. Each of these sets a **uniform or texture value**.
  None changes a program key, a draw count or a light count. So at low quality,
  by mechanism, head and base submit the same work.
- **F5. The head I measured is render-equivalent to the original head.**
  `484560f0` is not in local history. The GitHub compare against `1af6b7c`
  touches only comments, the `carriedConsoleLamp`/`hemisphereIntensityFor`
  extractions (same values) and scripts. `buildPerimeterLamps`, the six
  positions, `PERIMETER_LAMP_CAST_INTENSITY` and `_RANGE_KM` are byte-identical,
  and no GLB differs. `8b7a5871..1af6b7c` is linear and holds #898's own commits
  only (`2258df6` … `1af6b7c`).
- **F6. C1, refuted on this machine state.** The build delta does not reproduce
  at either quality (§3.1). The control is flat. An A/A run (the head build on
  both origins) shows no page-order bias. The instrument does resolve an effect
  of the claimed size: the high→low quality step (~1 ms) separates at 66–84%.
- **F7. C2, the one-change arm.** On the same page, hiding only the six casts
  at high moves the median by −0.09 to +0.21 ms and the p10 by +0.14 to +0.39 ms
  across runs 2, 4, 5 and the A/A, at 49–60% separation, inside the A/A noise floor. Rendered alone, the cabin pass
  costs ≤ ~0.25 ms wall per pass in every arm (§3.3). That is an upper bound on
  its GPU time, so six casts cannot add 0.9 ms.
- **F8. The original 64/64 is unexplained, and no longer tied to the code.**
  Nothing in #898 can add 0.9 ms to a low-quality frame (F2–F4), and at high
  the six casts are bounded far below it (F7). The original author recorded the
  likeliest reading at the time: blocks drifting and a bimodal bay arm, "this
  machine's clock is moving during runs." I could not reproduce the conditions
  that gave 64/64.

## 2. Instrument

A scratch extension of `measure-cabin-pass-cost.mjs`, not committed (the
appendix has the full script). Base `8b7a5871` and head `1af6b7c` came from
`git archive` into `/tmp`, each with its own `npm ci` and its own vite server.
One headed Chromium on the GPU lane (`ANGLE Metal, Apple M1 Pro`, asserted),
1440×900 at device scale 2, seed 47, composer samples 0.
`OCCLUSION_FRAMINGS.cockpit` (cockpit-arrival) and `OCCLUSION_FRAMINGS.berth`
(chase, the control) are placed exactly as the original does. Each block sets
quality live through `settings.set` (cheap at these refs: `applyQuality` is
uniform and flag assignments), then sets the six casts' visibility, warms,
drains with `readPixels`, times N `render(0)` and drains again. Arms are
shuffled per round from a printed seed. Each block also records CPU submit time
and the 1-minute load.

Arms at cockpit-arrival: `base/high`, `base/low`, `head/high`,
`head/high/perimOff` (six casts hidden, nothing else changed), `head/low`.
Control arms: base and head at high and low.

The statistic is the median and p10 of blocks, plus the pairwise separation from
`lib/measurement.mjs`. Under CPU contention, extra load only ever adds time, so
p10 tracks the uncontended cost better than the median does.

## 3. Results

### 3.1 Full frame, cockpit-arrival (gate shut, cabin drawn), 0 samples

Runs 4 and 5: 80 blocks per arm, 60 frames per block, 1-minute load 28–64,
probe lock free throughout.

| comparison | run 4 median Δ | run 4 p10 Δ | run 4 sep. | run 5 median Δ | run 5 p10 Δ | run 5 sep. |
| --- | --- | --- | --- | --- | --- | --- |
| head/low vs base/low (**the node's question**) | −0.174 ms | −0.172 | 46% | −0.177 ms | −0.127 | 48% |
| head/high vs base/high (what was actually measured) | −0.084 ms | +0.228 | 53% | −0.286 ms | +0.118 | 46% |
| head/high vs head/high/perimOff (**six casts alone**) | +0.207 ms | +0.392 | 60% | −0.086 ms | +0.143 | 49% |
| head/high/perimOff vs base/high (everything else in #898) | −0.291 ms | −0.163 | 44% | −0.200 ms | −0.025 | 47% |
| base/high vs base/low (sensitivity check) | +1.020 ms | +0.818 | 77% | +1.056 ms | +0.867 | 68% |
| head/high vs head/low (sensitivity check) | +1.110 ms | +1.218 | 84% | +0.948 ms | +1.112 | 66% |

Medians: run 4 base/high 5.714, head/high 5.630, base/low 4.694, head/low
4.520 ms. Run 5 base/high 7.931, head/high 7.645, base/low 6.875, head/low
6.697 ms.

Run 2 (16 blocks, load 38–41) agrees: head/low vs base/low +0.652 ms at 54%,
head/high vs base/high +0.156 ms at 52%. Its blocks scatter 4.5–14 ms, which is
why runs 4 and 5 use 80 blocks.

### 3.2 Controls

- **Chase control** (berth-free-look, cabin not drawn; run 2, 16 blocks, blocks
  19.7–21.1 ms at high): head vs base **+0.2%** at high (56%) and **+0.7%** at low
  (71%). Flat, as in the original.
- **A/A** (run 7, head build served on both origins, the same 5 arms, 80
  blocks): "head" vs "base" −0.250 ms / p10 −0.045 at high (49%) and
  −0.028 ms / p10 +0.333 at low (55%). That is the noise floor between two pages
  of one build: about ±0.3 ms. The cast arm there reads +0.180 / p10 +0.342
  (56%), the same lean as runs 4 and 5.

### 3.3 Cabin pass alone: a GPU bound that load cannot hide

Run 6, 60 blocks: each step is `clear` + `render(cabinScene, cabinCamera)` into
the composer's 2880×1800 target, 65 calls per pass.

| arm | median ms/pass | p10 | min |
| --- | --- | --- | --- |
| base/high (3 lights) | 0.291 | 0.147 | 0.130 |
| base/low (1) | 0.269 | 0.147 | 0.130 |
| head/high (9) | 0.259 | 0.148 | 0.120 |
| head/high/perimOff (3) | 0.248 | 0.150 | 0.127 |
| head/low (1) | 0.238 | 0.142 | 0.117 |

Casts on vs off: +0.012 ms (53%). Head vs base at low: −0.031 ms (44%).

The wall time of 60 passes includes draining all of their GPU work, so the
cabin pass's GPU time is **≤ ~0.25 ms** whatever its lights. That caps what the
six casts can cost a frame at high quality. At low they are not in the pass at
all (F2).

### 3.4 Discarded runs, and why

- Run 1: load 250–290, cockpit blocks 3–16 ms. Not used.
- Run 3: 240-frame blocks, load 50–96, blocks 8–26 ms, then a boot timeout.
  Not used.

## 4. What this can and cannot say

- **The frames were CPU-bound.** Submit time was 91–96% of block time (run 5:
  7.45 of 7.93 ms on base/high). A GPU-only cost smaller than the CPU time would
  be hidden in the full-frame rows. That is why §3.3 exists: it bounds the GPU
  side directly. The original's 3.9 ms frames on a quiet machine were likely
  closer to GPU-bound, and that state was not available tonight.
- **No stable machine.** Other ranger workers' browsers and headless SwiftShader
  probes ran throughout. The run-4/5 conclusions rest on 80 interleaved blocks
  per arm, an A/A null and a sensitivity row that separates. They do not rest on
  a quiet machine. A quiet-machine rerun of the appendix script would close C1
  as the node words it.
- **Head is `1af6b7c`, not today's `main`.** #912 later raised low quality's
  cabin hemisphere 9×. That is a uniform value too, so F4's reasoning extends to
  it, but it was not measured here.

## 5. For the principal (C3)

- **O1, accept (recommended).** At low there is no cost to fix: same lights,
  programs and draws (F2–F4), and none measured (F6). At high the six casts are
  bounded at ≤ ~0.25 ms GPU, with a measured lean of at most ~0.2 ms, which is the
  trade #898 meant to make for the lit frame.
- **O2, fix the instrument rather than the game.** Have
  `measure-cabin-pass-cost.mjs` print the quality it measured, and label its
  `gate` column "occlusion gate". The misreading that opened this node came from
  that column. This would be a separate node; nothing was changed here.
- **O3, re-run on a quiet machine** with the appendix script (5 minutes) if C1
  must be closed on a quiet machine rather than on the A/A-calibrated reading.

## 6. Reproduce

```bash
git archive 8b7a5871 | tar -x -C /tmp/s905-base   # npm ci; npx vite --port 5391 --strictPort
git archive 1af6b7c  | tar -x -C /tmp/s905-head   # npm ci; npx vite --port 5392 --strictPort
# script below saved as /tmp/s905-head/scripts/measure-905.mjs
cd /tmp/s905-head && PROBE_ORIGIN=http://127.0.0.1:5392 BASE_ORIGIN=http://127.0.0.1:5391 \
  SEELITE_PROBE_RENDERER=hardware FRAMING=cockpit BLOCKS=80 FRAMES=60 WARM=30 \
  ORDER_SEED=20261017 node scripts/measure-905.mjs          # MODE=cabin for §3.3; FRAMING=control for §3.2
```

## Appendix: `measure-905.mjs` (scratch, as run)

```js
/**
 * Node #905 scratch instrument (not shipped). Base and head pages in one
 * browser, arms interleaved in a shuffled order; quality set live per block,
 * and on the head page an arm that hides only the six perimeter-lamp casts.
 *
 * PROBE_ORIGIN=<head> BASE_ORIGIN=<base> SEELITE_PROBE_RENDERER=hardware \
 *   node scripts/measure-905.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import {
	OCCLUSION_FRAMINGS,
	installViewFraming,
	setView,
	settleFrames,
	startLoop,
	stopLoop,
} from "./lib/view-placement.mjs";
import { SEED, VIEWPORT } from "./lib/view-set.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN;
const BASE_ORIGIN = process.env.BASE_ORIGIN;
const FRAMES = Number(process.env.FRAMES ?? 60);
const BLOCKS = Number(process.env.BLOCKS ?? 16);
const WARM = Number(process.env.WARM ?? 30);
const CTRL_FRAMES = 60;
const CTRL_WARM = 30;
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261014);
const LOCK = "/tmp/seelite-probe.lock";

const headOrigin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
const open = async (origin) => {
	const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
	await bootedGame(page, 120000);
	return page;
};
const openPair = async () => ({ base: await open(BASE_ORIGIN), head: await open(headOrigin) });
let pages = await openPair();
const renderer = await assertPlayersRenderer(pages.head, "measure");
await assertPlayersRenderer(pages.base, "measure");
console.log(`  renderer: ${renderer}`);
console.log(`  ${VIEWPORT.width}x${VIEWPORT.height} @2, seed ${SEED}, ${BLOCKS} blocks/arm, ${FRAMES} frames/block, order seed ${ORDER_SEED}`);

const block = async (page, quality, perimOff, frames = FRAMES, warm = WARM) => {
	await page.bringToFront();
	const load0 = loadavg()[0];
	const lockHeld = existsSync(LOCK) ? readFileSync(LOCK, "utf8").slice(0, 80) : null;
	const r = await page.evaluate(
		([quality, perimOff, frames, warm, mode]) => {
			const g = window.__seelite;
			g.setComposerSamples(0);
			if (g.settings.value.quality !== quality) g.settings.set("quality", quality);
			const perim = [];
			const points = [];
			g.cockpit.mesh.traverse((o) => {
				if (o.isPointLight) points.push(o);
				if (o.isPointLight && o.name.startsWith("perimeter-lamp")) perim.push(o);
			});
			for (const l of perim) l.visible = quality === "high" && !perimOff;
			const gl = g.renderer.getContext();
			const sync = new Uint8Array(4);
			for (let i = 0; i < 3; i++) g.render(0);
			const r = g.renderer;
			const rt = g.composer.renderTarget1;
			const autoClear = r.autoClear;
			const step = mode === "cabin" ? () => { r.setRenderTarget(rt); r.clear(); r.render(g.cabinScene, g.cabinCamera); } : () => g.render(0);
			if (mode === "cabin") r.autoClear = false;
			for (let i = 0; i < warm; i++) step();
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const started = performance.now();
			for (let i = 0; i < frames; i++) step();
			const submitMs = (performance.now() - started) / frames;
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const ms = (performance.now() - started) / frames;
			const infoAuto = r.info.autoReset; r.info.autoReset = false; r.info.reset(); step(); const calls = r.info.render.calls, triangles = r.info.render.triangles; r.info.autoReset = infoAuto;
			const rtSize = [rt.width, rt.height];
			r.autoClear = autoClear;
			r.setRenderTarget(null);
			let visiblePoints = 0;
			for (const l of points) {
				let o = l;
				let vis = true;
				while (o) {
					if (!o.visible) vis = false;
					o = o.parent;
				}
				if (vis) visiblePoints++;
			}
			return {
				ms,
				calls,
				triangles,
				rtSize,
				submitMs,
				gate: g.occlusionState.open,
				cabin: g.cockpit.mesh.visible,
				quality: g.settings.value.quality,
				perim: perim.length,
				points: points.length,
				visiblePoints,
			};
		},
		[quality, perimOff, frames, warm, process.env.MODE ?? "frame"],
	);
	return { ...r, load0, load1: loadavg()[0], lockHeld };
};

const ARMS = {
	cockpit: [
		["base", "high", false],
		["base", "low", false],
		["head", "high", false],
		["head", "high", true],
		["head", "low", false],
	],
	control: [
		["base", "high", false],
		["base", "low", false],
		["head", "high", false],
		["head", "low", false],
	],
};
const ONLY = process.env.FRAMING;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const FRAMINGS_ALL = [
	{ key: "cockpit", name: "cockpit-arrival", ...OCCLUSION_FRAMINGS.cockpit },
	{ key: "control", name: "berth-free-look (chase, control)", ...OCCLUSION_FRAMINGS.berth },
];
const FRAMINGS = FRAMINGS_ALL.filter((f) => !ONLY || f.key === ONLY);
const shuffled = seededShuffler(ORDER_SEED);
const out = {};
for (const [index, framing] of FRAMINGS.entries()) {
	if (index > 0) {
		for (const page of Object.values(pages)) await page.close();
		pages = await openPair();
	}
	for (const page of Object.values(pages)) {
		await page.bringToFront();
		await startLoop(page);
		await setView(page, framing.view);
		await framing.place(page);
		await setView(page, framing.view);
		await settleFrames(page);
		await stopLoop(page);
	}
	const arms = new Map();
	const thunks = [];
	for (const [build, quality, perimOff] of ARMS[framing.key]) {
		const key = `${build}/${quality}${perimOff ? "/perimOff" : ""}`;
		arms.set(key, []);
		thunks.push(() => block(pages[build], quality, perimOff, ...(framing.key === "control" ? [CTRL_FRAMES, CTRL_WARM] : [])).then((r) => arms.get(key).push(r)));
	}
	for (let i = 0; i < BLOCKS; i++) for (const arm of shuffled(thunks)) await arm();
	console.log(`\n  ${framing.name}`);
	out[framing.key] = Object.fromEntries(arms);
	for (const [key, rs] of arms) {
		for (const r of rs) if (!Number.isFinite(r.ms)) throw new Error("non-finite block");
		const last = rs[rs.length - 1];
		const loads = rs.map((r) => r.load0);
		console.log(
			`  ${key.padEnd(20)} median ${median(rs.map((r) => r.ms)).toFixed(3)} submit ${median(rs.map((r) => r.submitMs)).toFixed(3)} p10 ${q(rs.map((r) => r.ms), 0.1).toFixed(3)} min ${Math.min(...rs.map((r) => r.ms)).toFixed(3)} ms | gate ${last.gate ? "open" : "shut"}, cabin ${last.cabin ? "drawn" : "not drawn"}, quality ${last.quality}, perim ${last.perim}, calls ${last.calls}, tris ${last.triangles}, rt ${last.rtSize}, points ${last.visiblePoints}/${last.points} | load ${Math.min(...loads).toFixed(1)}-${Math.max(...loads).toFixed(1)}, lock ${rs.some((r) => r.lockHeld) ? "HELD" : "free"}`,
		);
		console.log(`    ${rs.map((r) => r.ms.toFixed(2)).join(" ")}`.slice(0, 400));
	}
	const cmp = (a, b) => {
		const A = arms.get(a).map((r) => r.ms);
		const B = arms.get(b).map((r) => r.ms);
		if (!A || !B) return;
		const am = median(A);
		const bm = median(B);
		console.log(
			`  ${a} vs ${b}: ${am >= bm ? "+" : ""}${(am - bm).toFixed(3)} ms (${(((am - bm) / bm) * 100).toFixed(1)}%), p10 ${(q(A, 0.1) - q(B, 0.1)) >= 0 ? "+" : ""}${(q(A, 0.1) - q(B, 0.1)).toFixed(3)} ms (${(((q(A, 0.1) - q(B, 0.1)) / q(B, 0.1)) * 100).toFixed(1)}%), ${a} slower in ${separation(A, B)}`,
		);
	};
	cmp("head/high", "base/high");
	cmp("head/low", "base/low");
	if (framing.key === "cockpit") {
		cmp("head/high", "head/high/perimOff");
		cmp("head/high/perimOff", "base/high");
		cmp("base/high", "base/low");
		cmp("head/high", "head/low");
	}
}
await browser.close();
console.log(`\nJSON ${JSON.stringify(out)}`);
```
