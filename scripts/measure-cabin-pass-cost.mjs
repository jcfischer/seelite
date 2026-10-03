/**
 * What #651's cabin pass costs a frame, against the build before it.
 *
 * Usage, with two dev servers — this tree and a base tree:
 *
 *   PROBE_ORIGIN=http://127.0.0.1:<head> BASE_ORIGIN=http://127.0.0.1:<base> \
 *     node scripts/measure-cabin-pass-cost.mjs
 *
 * **Two builds, so two pages, and the arms interleaved across them.** The pass
 * is not a switch a page can flip: a switch that exists for one instrument is
 * production state for one caller, which this repo has already rejected once
 * (the vignette override). So each build gets its own page in one browser,
 * both loops are stopped, and the blocks of the four arms — build × sample
 * count — run in an order shuffled from a printed seed, with the page brought
 * to the front before each block. `measurement.mjs` says why the order is
 * shuffled and why the statistic is a pairing count.
 *
 * **Three things move, and in two directions.**
 * - One more `WebGLRenderer.render` a frame on a frame that draws the cabin,
 *   and with the composer multisampled each render ends in a resolve.
 * - The near layer loses its early depth rejection under the cabin: the cabin
 *   used to be drawn first and reject the world behind it, and now the world
 *   is shaded in full under it and then drawn over.
 * - A saving: the cabin's two point lights left the near layer, so hull and
 *   station fragments no longer evaluate them.
 * The framings are chosen so each shows: `cockpit-arrival` (40% cabin, open
 * space), the bay in the cockpit at 0.9 of the traversal (cabin over a full
 * frame of world, occlusion gate open), and `berth-free-look` in chase, where
 * the cabin is not drawn and the two builds should not differ — the control.
 *
 * Each figure is a median of blocks, each block a drained run of `FRAMES`
 * `render(0)` calls after a drained warm-up; `measure-occlusion-cost.mjs` has
 * why both drains. Headed, 1440x900 at device scale 2, renderer checked.
 */
import { execFileSync } from "node:child_process";
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
} from "./lib/view-placement.mjs";
import { SEED, VIEWPORT } from "./lib/view-set.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const BASE_ORIGIN = process.env.BASE_ORIGIN;
const FRAMES = Number(process.env.FRAMES ?? 60);
const BLOCKS = Number(process.env.BLOCKS ?? 8);
const WARM = 30;
const SAMPLE_ARMS = [0, 2];
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261003);

if (!BASE_ORIGIN)
	throw new Error("BASE_ORIGIN is required: the dev server of the base tree");

/**
 * The base server is another tree by design, so the guard's identity check
 * cannot be the one that admits it. What is checked instead is that it
 * *declares* a tree, that the tree is not this one, and which commit that tree
 * is at — printed, so the comparison is named rather than assumed.
 */
async function baseTree(origin) {
	const res = await fetch(`${origin}/__seelite/tree`);
	const type = res.headers.get("content-type") ?? "";
	if (!type.includes("application/json"))
		throw new Error(`${origin} declares no tree (content-type ${type})`);
	const { root } = await res.json();
	if (typeof root !== "string") throw new Error(`${origin} declared no root`);
	const head = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"])
		.toString()
		.trim();
	const dirty = execFileSync("git", [
		"-C",
		root,
		"status",
		"--porcelain",
		"src",
	])
		.toString()
		.trim();
	if (dirty) throw new Error(`base tree ${root} has uncommitted src changes`);
	return { root, head };
}

const headOrigin = await guardedOrigin(ORIGIN);
const base = await baseTree(BASE_ORIGIN);
const head = execFileSync("git", ["rev-parse", "--short", "HEAD"])
	.toString()
	.trim();
if (base.head === head)
	throw new Error(`base and head are the same commit, ${head}`);

const browser = await launchChromium({ headless: false });
const open = async (origin) => {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
	await bootedGame(page);
	return page;
};
/** A fresh pair per framing: a page that has measured is never re-placed. */
const openPair = async () => ({
	base: await open(BASE_ORIGIN),
	head: await open(headOrigin),
});
let pages = await openPair();
const renderer = await assertPlayersRenderer(pages.head, "measure");
await assertPlayersRenderer(pages.base, "measure");

const shuffled = seededShuffler(ORDER_SEED);
console.log(`  renderer: ${renderer}`);
console.log(`  base ${base.head} (${base.root}) against head ${head}`);
console.log(
	`  ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}; ` +
		`${BLOCKS} blocks per arm, ${FRAMES} frames per block, order seed ${ORDER_SEED}`,
);

const stopLoop = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		g.animationFrame = 0;
	});
const startLoop = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		if (!g.animationFrame) g.animate();
	});

const block = async (page, samples) => {
	await page.bringToFront();
	return page.evaluate(
		([n, frames, warm]) => {
			const g = window.__seelite;
			g.setComposerSamples(n);
			const gl = g.renderer.getContext();
			const sync = new Uint8Array(4);
			for (let i = 0; i < warm; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const ms = (performance.now() - started) / frames;
			g.renderer.setRenderTarget(g.composer.renderTarget1);
			const granted = gl.getParameter(gl.SAMPLES);
			g.renderer.setRenderTarget(null);
			return {
				ms,
				granted,
				gate: g.occlusionState.open,
				cabin: g.cockpit.mesh.visible,
			};
		},
		[samples, FRAMES, WARM],
	);
};

/**
 * **Each framing from a fresh boot.** Placed one after another in one page,
 * `__parkInBerth` left the ship flying 36.5 km out after `cockpit-arrival`,
 * and docked rather than arriving after the bay; from boot it parks, as
 * `probe-cabin-pass` does. This repo's rule is the same: a page that has
 * measured something is not placed again (#121).
 */
const FRAMINGS = [
	{
		name: "bay, cockpit, 0.9",
		view: "cockpit",
		place: (page) =>
			page.evaluate(() =>
				window.__parkInBerth("station-trade", "overhead-deep", {
					stopAtArrivalFraction: 0.9,
				}),
			),
	},
	{ name: "berth-free-look (chase, control)", ...OCCLUSION_FRAMINGS.berth },
	{ name: "cockpit-arrival", ...OCCLUSION_FRAMINGS.cockpit },
];

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
	for (const build of ["base", "head"])
		for (const samples of SAMPLE_ARMS) {
			const key = `${build}@${samples}`;
			arms.set(key, []);
			thunks.push(() =>
				block(pages[build], samples).then((r) => arms.get(key).push(r)),
			);
		}
	for (let i = 0; i < BLOCKS; i++)
		for (const arm of shuffled(thunks)) await arm();

	console.log(`\n  ${framing.name}`);
	for (const samples of SAMPLE_ARMS) {
		const b = arms.get(`base@${samples}`);
		const h = arms.get(`head@${samples}`);
		const bm = median(b.map((r) => r.ms));
		const hm = median(h.map((r) => r.ms));
		for (const r of [...b, ...h])
			if (!Number.isFinite(r.ms)) throw new Error("non-finite block");
		const last = h[h.length - 1];
		console.log(
			`  ${last.granted} samples, gate ${last.gate ? "open" : "shut"}, ` +
				`cabin ${last.cabin ? "drawn" : "not drawn"}: ` +
				`base ${bm.toFixed(3)} ms, head ${hm.toFixed(3)} ms, ` +
				`${hm >= bm ? "+" : ""}${(hm - bm).toFixed(3)} ms ` +
				`(${(((hm - bm) / bm) * 100).toFixed(1)}%), head slower in ${separation(
					h.map((r) => r.ms),
					b.map((r) => r.ms),
				)}`,
		);
		console.log(
			`    spread base ${b.map((r) => r.ms.toFixed(2)).join(" ")}\n` +
				`    spread head ${h.map((r) => r.ms.toFixed(2)).join(" ")}`,
		);
	}
}

await browser.close();
