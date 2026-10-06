/**
 * Does an open-space frame cost what `src/occlusion.ts`'s table says — node #249.
 *
 *   npm run dev                               # in one shell
 *   node scripts/measure-open-space-repro.mjs # in another
 *
 * The table carried `empty space 3.740 ms` (pair off, 0 samples) and
 * `cockpit-arrival 3.784`. #242's instrument read the same two shots at 1.677
 * and 1.743 on the same machine, while the bay agreed to within 4%. #249 asked
 * which of three things moved: the build, the shot, or the instrument.
 *
 * **This file exists to be run unchanged against more than one build.** Copy it
 * byte for byte, with `scripts/lib/game-url.mjs`, into a checkout of an older
 * commit and run it against that checkout's own dev server. Everything else it
 * imports has a stable shape back to 33e07ba3, the commit that first wrote the
 * table into `src/`. One instrument on two builds is the only comparison that
 * can say whether a build moved. Two instruments on two builds cannot separate
 * the build from the instrument, and that is how #249 arose.
 *
 * Before #296 the guard compared constants rather than asking the server which
 * tree it serves, and that check once passed a sibling worktree. On an older build, confirm the listening process's working
 * directory by hand (`lsof -a -p <pid> -d cwd`) and give each build its own
 * port through `PROBE_ORIGIN`.
 *
 * ## The design is `measure-occlusion-cost.mjs`'s
 *
 * Headed, refusing a software rasteriser, one page and one clock. Blocks of 120
 * frames are interleaved and shuffled from a printed seed, the median block is
 * reported, and each delta carries a Mann-Whitney count. The warm-up is
 * **drained before the clock starts**: `render` only queues, so undrained warm
 * frames' GPU work lands inside the timed interval. Every arm passes the same
 * warm count.
 *
 * Three arms at two sample counts (0, 2), over the table's three framings:
 * the pair pinned off and pinned on, which are the table's four cells, and the
 * pair left to #241's gate, which is what #242's instrument measured. The gate
 * is a per-frame decision, so each framing gets an untimed pre-roll before its
 * first block and the gate's state is printed beside the live arm. That is fewer arms and blocks than the
 * table's parent instrument, so a run fits inside one foreground invocation on the
 * bay's 40 ms frame. The 2x column is the cheap test of *how* two figures
 * differ: a fixed per-frame overhead adds the same milliseconds at 0 and at 2
 * samples, while a multiplicative cause scales with the frame.
 *
 * It gates on nothing it prints. `guardedOrigin` and `assertPlayersRenderer`
 * refuse to measure, and neither is a failed measurement.
 */
import { loadavg } from "node:os";
import { execFileSync } from "node:child_process";
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import {
	installViewFraming,
	OCCLUSION_FRAMINGS,
	setView,
	settleFrames,
} from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

const FRAMES = 120;
/** Six, as the table states it was taken with: 36 pairings per delta. */
const BLOCKS = Number(process.env.BLOCKS ?? 6);
/** The same for every arm. Three rather than one because a sample-count
 *  switch reallocates the composer's targets, and the drain below keeps the
 *  warm frames out of the clock whatever their number. */
const WARM = 3;
const SAMPLES = [0, 2];

// After #296 the guard asks the server for its tree. Before it, the same
// one-argument call falls back to the fingerprint list the guard defaults to.
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
await installViewPlacement(page);
await installViewFraming(page);
const url = gameUrl(origin, { seed: SEED });
await page.goto(url);
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure");
await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
await page.evaluate(() => window.__rememberBootPosition());

const head = (() => {
	try {
		return execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
})();
const settings = await page.evaluate(() =>
	JSON.stringify(window.__seelite.settings?.value ?? null),
);

const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261005);
const shuffled = seededShuffler(ORDER_SEED);
const load = () =>
	loadavg()
		.map((x) => x.toFixed(2))
		.join(" ");

console.log(`  build: ${head}  (${process.cwd()})`);
console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}`,
);
console.log(`  stored settings: ${settings}`);
console.log(
	`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, ${WARM} warm frames drained, arm order shuffled from seed ${ORDER_SEED}`,
);
console.log(`  load at start: ${load()}`);

/** Untimed frames after a placement, so the gate has stepped to where the
 *  camera is before any arm reads it. The gate steps on every frame, pinned or
 *  not, so this is needed once per framing and not per block. */
const PRE_ROLL = 60;

/**
 * One block: the samples and the pair set in place, warmed, drained, timed.
 * `pair` is `true`/`false` to pin both passes, `null` to give them back to
 * the gate — the same bare call `measure-occlusion-cost.mjs` makes.
 */
const block = (page, samples, pair) =>
	page.evaluate(
		([n, on, frames, warm]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			g.setComposerSamples(n);
			if (on === null) g.setOcclusion();
			else g.setOcclusion(on, on);
			const sync = new Uint8Array(4);
			for (let i = 0; i < warm; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const ms = (performance.now() - started) / frames;
			// Off the bound framebuffer, not the request: a count can round up.
			g.renderer.setRenderTarget(g.composer.renderTarget1);
			const granted = gl.getParameter(gl.SAMPLES);
			g.renderer.setRenderTarget(null);
			return { ms, granted, open: g.occlusionState?.open ?? null };
		},
		[samples, pair, FRAMES, WARM],
	);

// `deepSky` first: it returns the ship to where it booted, which is only
// knowable before another framing has moved it (`measure-occlusion-cost.mjs`).
const FRAMINGS = [
	{ name: "sky-only", ...OCCLUSION_FRAMINGS.deepSky },
	{ name: "cockpit-arrival", ...OCCLUSION_FRAMINGS.cockpit },
	{ name: "berth-free-look", ...OCCLUSION_FRAMINGS.berth },
];

const ARMS = SAMPLES.flatMap((samples) => [
	{ key: `off@${samples}`, samples, pair: false },
	{ key: `on@${samples}`, samples, pair: true },
	{ key: `live@${samples}`, samples, pair: null },
]);

for (const framing of FRAMINGS) {
	await setView(page, framing.view);
	await framing.place(page);
	await setView(page, framing.view);
	await settleFrames(page);
	await page.evaluate((frames) => {
		const g = window.__seelite;
		const gl = g.renderer.getContext();
		g.setOcclusion();
		for (let i = 0; i < frames; i++) g.render(0);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
	}, PRE_ROLL);
	const xs = Object.fromEntries(ARMS.map((a) => [a.key, []]));
	const granted = {};
	const gate = new Set();
	const thunks = ARMS.map(
		(a) => () =>
			block(page, a.samples, a.pair).then((r) => {
				xs[a.key].push(r.ms);
				granted[a.key] = r.granted;
				if (a.pair === null) gate.add(r.open);
			}),
	);
	for (let i = 0; i < BLOCKS; i++)
		for (const run of shuffled(thunks)) await run();
	await page.evaluate(() => {
		const g = window.__seelite;
		g.setComposerSamples();
		g.setOcclusion();
	});

	console.log(
		`\n  ${framing.name} (${framing.view})  load ${load()}  gate ${[...gate].map((o) => (o === null ? "unreadable" : o ? "open" : "shut")).join("/")}`,
	);
	for (const samples of SAMPLES) {
		const off = xs[`off@${samples}`];
		const on = xs[`on@${samples}`];
		const live = xs[`live@${samples}`];
		const d = median(on) - median(off);
		console.log(
			`  ${samples} samples (granted ${granted[`off@${samples}`]}): pair off ${median(off).toFixed(3)} ms, pair on ${median(on).toFixed(3)} ms, +${d.toFixed(3)} (x${(median(on) / median(off)).toFixed(2)}) separation ${separation(on, off)}; gate live ${median(live).toFixed(3)} ms`,
		);
	}
	for (const a of ARMS)
		console.log(
			`  spread — ${a.key.padEnd(6)} ${xs[a.key].map((x) => x.toFixed(2)).join(" ")}`,
		);
}

await browser.close();
