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
 * It asserts nothing and always exits 0. #98 settled that there is no frame-time
 * floor in this game, so what is wanted is a figure for a receipt rather than a
 * threshold that would fail on somebody else's laptop. The `measure-` prefix
 * keeps it out of `probe-all`.
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
import { installViewFraming } from "./lib/view-placement.mjs";
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
const block = (page, shadows, ao) =>
	page.evaluate(
		([sh, a, frames]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			g.setOcclusion(sh, a);
			// One warm frame after the switch. Turning the shadow on makes three
			// allocate the 2048² depth target and compile the depth material for
			// every caster; turning the AO on compiles its own chain. Timing the
			// first frame would price the switch rather than the term.
			g.render(0);
			const sync = new Uint8Array(4);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			// Drain: `readPixels` blocks until everything queued has been drawn.
			// `gl.finish` does not reliably do so through ANGLE.
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			return (performance.now() - started) / frames;
		},
		[shadows, ao, FRAMES],
	);

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** The Mann-Whitney pairing count: of every (a, b) pairing, how often a is
 *  slower. Assumes nothing about either distribution's shape, and one outlier
 *  can move it by at most a block's worth. */
const separation = (a, b) => {
	let slower = 0;
	for (const x of a) for (const y of b) if (x > y) slower++;
	return `${slower}/${a.length * b.length} (${((100 * slower) / (a.length * b.length)).toFixed(0)}%)`;
};

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

const setView = async (want) => {
	for (let i = 0; i < 8; i++) {
		if ((await page.evaluate(() => window.__seelite.view)) === want) return;
		await page.keyboard.press("v");
	}
	throw new Error(`could not reach the ${want} view`);
};

const FRAMINGS = [
	{
		name: "cockpit-arrival",
		view: "cockpit",
		place: () =>
			page.evaluate(
				([id, radii]) =>
					window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
						comoving: true,
					}),
				["station-trade", 5],
			),
	},
	{
		name: "berth-free-look",
		view: "chase",
		place: () =>
			page.evaluate(
				([id, berth, opts]) => window.__parkInBerth(id, berth, opts),
				[
					"station-trade",
					"overhead-near",
					{
						stopAtArrivalFraction: 1,
						headLook: { yaw: -0.75, pitch: -0.2 },
					},
				],
			),
	},
];

const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20260903);
let orderState = ORDER_SEED >>> 0;
const nextRandom = () => {
	orderState = (orderState * 1664525 + 1013904223) >>> 0;
	return orderState / 4294967296;
};
const shuffled = (xs) => {
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(nextRandom() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
};

console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}`,
);
console.log(
	`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`,
);

for (const framing of FRAMINGS) {
	await setView(framing.view);
	await framing.place();
	await setView(framing.view);
	await page.evaluate(
		() =>
			new Promise((done) => {
				let n = 3;
				const tick = () => (n-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
	);
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
}

await browser.close();
