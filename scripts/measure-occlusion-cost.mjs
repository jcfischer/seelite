/**
 * What #201's two occlusion passes cost, **on the renderer the player has**.
 *
 *   npm run dev                            # in one shell
 *   node scripts/measure-occlusion-cost.mjs
 *
 * A sibling of `measure-light-cost.mjs` and built to the same design, because
 * that design was arrived at by getting it wrong several times and the argument
 * is written out there rather than repeated here: headed and refusing a
 * software rasteriser (#98 — the same scene runs 16.8 fps headless and 371
 * headed on an M1 Pro, so a probe's millisecond is nobody's); one page, one
 * camera, one clock, the term toggled **in place** between blocks; blocks
 * interleaved and **shuffled from a printed seed**, because a fixed arm order
 * confounds thermal drift with the arm perfectly and once reported a term at
 * 144/144 separation that shuffling dropped to a coin toss; the median block
 * reported, so one interrupted block does not carry a row; and a Mann-Whitney
 * pairing count beside it, because a difference of two medians the size of the
 * blocks' own spread says nothing on its own.
 *
 * **It gates on no figure it prints.** #98 settled that there is no frame-time
 * floor in this game, so what is wanted here is a number for a receipt rather
 * than a threshold that would fail on somebody else's laptop. That is not the
 * same as "always exits 0", which an earlier draft of this paragraph claimed and
 * which is false: `guardedOrigin` throws on a dev server that is not serving
 * this tree and `assertPlayersRenderer` throws on a software rasteriser, and
 * both are refusals to measure rather than measurements that failed. The
 * `measure-` prefix keeps it out of `probe-all`.
 *
 * ## Four arms, because one key moves two passes
 *
 * `quality` gates the shadow map and the ambient occlusion together, so a
 * reading of the key prices the pair and a receipt could not say which half it
 * bought. `Game.setOcclusion(shadows, ao)` takes the two explicitly — the same
 * reason `setComposerSamples` takes a count — so this measures neither, each
 * alone, and both, and the sum of the two singles against the pair is its own
 * check on whether they interact.
 *
 * ## Three framings, and the antialias row beside them — #241
 *
 * The regression the principal flew was in **empty space**, which this
 * instrument did not frame: it priced the pair at a station and in a bay, where
 * the pair is a fifth and a twelfth of the frame, and missed that in open space
 * it is the whole of it again. `deepSky` is the third framing.
 *
 * And every figure was taken at the **default** sample count, which the
 * principal does not play at. Multisampling multiplies every later fill-rate
 * term rather than adding beside it, so a term priced at 0 samples understates
 * a 2x player's cost by a factor of two — measured, +3.563 ms against +7.130 in
 * empty space. The second table below is the shipped build at both counts.
 *
 * ## Two framings, because the passes scale with different things
 *
 * The shadow map redraws every **caster**, so it is paid per object in the near
 * scene. The ambient occlusion redraws the near scene into a normal buffer and
 * then samples per **fragment**, so it is paid per pixel of near-layer
 * coverage. A cockpit frame is 40% cabin at arm's length; a bay fills the
 * canopy. Pricing one framing would attribute the pair's cost to whichever the
 * header happened to name.
 */
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

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** Frames per block and blocks per arm, both `measure-light-cost.mjs`'s: long
 *  enough that the single end-of-block sync is under a percent of the block,
 *  and enough blocks that one bad one cannot carry a median. */
const FRAMES = 120;
const BLOCKS = 12;

/**
 * Milliseconds per frame for one block at one pair of settings.
 *
 * The occlusion is set through `Game.setOcclusion` rather than through the
 * settings store, so the instrument leaves no preference behind on the machine
 * it measured — and so each pass can be moved without the other.
 */
/**
 * `warm` is a parameter and not a constant, and every arm of one comparison
 * must pass the same number — #241 paid a run to learn it.
 *
 * One warm frame is what the four-arm table needs: turning the shadow on makes
 * three allocate the 2048² depth target and compile the depth material for
 * every caster, and turning the AO on compiles its own chain, so timing the
 * first frame would price the switch rather than the term. The shipped-build
 * rows below want sixty, because the gate is a per-frame decision that has to
 * have settled before the clock starts — and the first version gave sixty to
 * that arm alone. It reported the shipped build at 2.378 ms against a pinned-off
 * 1.710 with the gate **shut**, which is two builds writing the same two flags:
 * what separated them was that one arm's hundred and twenty timed frames began
 * after sixty frames of load and the other's began cold. Same sign in both
 * framings.
 */
const block = (page, shadows, ao, warm = 1) =>
	page.evaluate(
		([sh, a, frames, warmFrames]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			g.setOcclusion(sh, a);
			for (let i = 0; i < warmFrames; i++) g.render(0);
			const sync = new Uint8Array(4);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			// Drain: `readPixels` blocks until everything queued has been drawn.
			// `gl.finish` does not reliably do so through ANGLE.
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			return (performance.now() - started) / frames;
		},
		[shadows, ao, FRAMES, warm],
	);

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/occlusion.ts",
	"src/light-rig.ts",
]);
const browser = await launchChromium({ headless: false });
// `deviceScaleFactor: 2` for `measure-light-cost.mjs`'s reason: the ambient
// occlusion is fill-rate bound and the machine this targets has a retina panel,
// so at the default the buffer is a quarter of the player's.
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure");
await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
await page.evaluate(() => window.__rememberBootPosition());

// The same two shots `probe-occlusion.mjs` checks, from the one definition —
// a receipt that quotes a pixel reading beside a millisecond is only coherent
// if the camera was in the same place for both.
// **`deepSky` first, and that ordering is load-bearing.** Its placement returns
// the ship to where it booted, which is only knowable before anything has moved
// it — `__rememberBootPosition` is called once above, and a framing that flew
// somewhere else first would have nothing to return to.
const FRAMINGS = [
	{ name: "sky-only", ...OCCLUSION_FRAMINGS.deepSky },
	{ name: "cockpit-arrival", ...OCCLUSION_FRAMINGS.cockpit },
	{ name: "berth-free-look", ...OCCLUSION_FRAMINGS.berth },
];

const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20260903);
const shuffled = seededShuffler(ORDER_SEED);

console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}`,
);
console.log(
	`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`,
);

/**
 * ## What the build actually ships, at both sample counts — #241
 *
 * The four arms above price the two passes with each pinned, which is what a
 * receipt about *the passes* needs. This prices **the game**: the gate live,
 * against the two builds it sits between, at the default count and at the
 * principal's 2x.
 *
 * **Run inside the framing loop and not after it**, which cost a run to learn:
 * a second pass over `FRAMINGS` re-places from wherever the last one left the
 * ship, and the berth framing leaves it docked — `sky-only` then reported the
 * bay's 38 ms, and the page navigated out from under the next `evaluate`.
 *
 * Fewer blocks than the table above on purpose. This one is answering whether
 * the shipped frame is back where it was, which is a difference of tens of
 * milliseconds at 2x, rather than separating a sub-millisecond term.
 */
const SAMPLE_ARMS = [0, 2];
const SHIPPED_BLOCKS = 5;
const SHIPPED_WARM = 60;
const shipped = (page) =>
	page.evaluate(
		([frames, warm]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			// Bare, so the gate decides — an explicit pair would measure the pin.
			g.setOcclusion();
			// Enough frames for the gate to have settled either way before the clock
			// starts: `openFrames` is small and `closeFrames` is thirty. The two rows
			// this is compared against are given the same count.
			for (let i = 0; i < warm; i++) g.render(0);
			const sync = new Uint8Array(4);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			return {
				ms: (performance.now() - started) / frames,
				open: g.occlusionState.open,
			};
		},
		[FRAMES, SHIPPED_WARM],
	);

const grantedSampleCount = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		const gl = g.renderer.getContext();
		// Off the bound framebuffer rather than off the request: a count can be
		// rounded *up*, and `renderTarget.samples` is only the request read back.
		g.renderer.setRenderTarget(g.composer.renderTarget1);
		const n = gl.getParameter(gl.SAMPLES);
		g.renderer.setRenderTarget(null);
		return n;
	});

for (const framing of FRAMINGS) {
	await setView(page, framing.view);
	await framing.place(page);
	await setView(page, framing.view);
	await settleFrames(page);
	const arms = {
		neither: [],
		"shadow only": [],
		"ao only": [],
		both: [],
	};
	const thunks = [
		() => block(page, false, false).then((r) => arms.neither.push(r)),
		() => block(page, true, false).then((r) => arms["shadow only"].push(r)),
		() => block(page, false, true).then((r) => arms["ao only"].push(r)),
		() => block(page, true, true).then((r) => arms.both.push(r)),
	];
	for (let i = 0; i < BLOCKS; i++)
		for (const arm of shuffled(thunks)) await arm();

	const base = median(arms.neither);
	console.log(`\n  ${framing.name} (${framing.view})`);
	for (const [name, xs] of Object.entries(arms)) {
		const m = median(xs);
		const delta =
			name === "neither"
				? ""
				: `  +${(m - base).toFixed(3)} ms  (+${(((m - base) / base) * 100).toFixed(1)}%)  separation ${separation(xs, arms.neither)}`;
		console.log(
			`  ${name.padEnd(12)} ${m.toFixed(3)} ms/frame  ${String(Math.round(1000 / m)).padStart(4)} fps${delta}`,
		);
	}
	// The two singles against the pair. If the passes were independent these
	// would agree; where they do not, the difference is what one pass makes the
	// other cost — the shadow's caster redraw warms the same geometry the AO's
	// normal buffer then redraws.
	const sum =
		median(arms["shadow only"]) - base + (median(arms["ao only"]) - base);
	console.log(
		`  the two singles sum to +${sum.toFixed(3)} ms against +${(median(arms.both) - base).toFixed(3)} ms for the pair`,
	);
	for (const [name, xs] of Object.entries(arms))
		console.log(
			`  spread — ${name.padEnd(12)} ${xs.map((x) => x.toFixed(2)).join(" ")}`,
		);

	for (const samples of SAMPLE_ARMS) {
		await page.evaluate((n) => window.__seelite.setComposerSamples(n), samples);
		const granted = await grantedSampleCount(page);
		const off = [];
		const on = [];
		const live = [];
		const rows = [
			() => block(page, false, false, SHIPPED_WARM).then((r) => off.push(r)),
			() => block(page, true, true, SHIPPED_WARM).then((r) => on.push(r)),
			() => shipped(page).then((r) => live.push(r)),
		];
		for (let i = 0; i < SHIPPED_BLOCKS; i++)
			for (const arm of shuffled(rows)) await arm();
		const liveMs = median(live.map((r) => r.ms));
		console.log(
			`  as it ships — ${granted} samples, gate ${live[live.length - 1].open ? "open" : "shut"}: off ${median(off).toFixed(3)} ms, shipped ${liveMs.toFixed(3)} ms, on ${median(on).toFixed(3)} ms — ${String(Math.round(1000 / liveMs)).padStart(4)} fps`,
		);
	}
	await page.evaluate(() => window.__seelite.setComposerSamples());
}

await browser.close();
