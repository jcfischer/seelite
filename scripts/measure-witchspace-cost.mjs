/**
 * What #532's witchspace pass costs a frame while it is drawing, on each side
 * of #99's `quality` key.
 *
 * **What it does not price is the idle frame.** `off` is this build with the
 * transition held past its end: the pass disabled, the rift drawing nothing and
 * the sky cameras unzoomed. Whether that frame costs anything against a build
 * without #532 is not measured here (sage round 2 on #533): the pass is
 * disabled, so the composer skips it, and `presentWitchspace` returns early on
 * an idle frame, but neither is timed.
 *
 *   npm run dev                                     # in one shell
 *   node scripts/measure-witchspace-cost.mjs        # in another
 *
 * The pass is enabled only for the few seconds around a jump, so this prices a
 * transient: the frame the player sees during the entry and the exit. Each arm
 * is a block of `FRAMES` renders fenced by a 1x1 `readPixels` (the one fence
 * that fences on ANGLE Metal, `CLAUDE.md`): `off`, nothing held and the pass
 * disabled — the frame outside a jump — and each side of the key at each phase
 * in `PHASES`.
 *
 * **Three phases, because no one phase runs every loop.** Sage round 1 on #533
 * caught the first version pricing only the full tunnel and calling it the
 * dearest: under a full cover the sky's smear is skipped, so the phases where
 * both run — the tunnel opening over a still-visible sky — were never measured.
 * `-0.6` is the dark closing over the starbow (the sky loop, no tunnel), `0.3`
 * the tunnel opening out of the point, `1.5` the tunnel at full cover, and
 * `4.3` in **chase** view the rift's lens bending the sky behind it — the one
 * phase the lens is priced at, since from the cockpit the rift is behind the
 * camera and lenses nothing. The setup is `playArrival()`, so a rift exists
 * to be lensed; the phases before the cut are drawn by the hold alone.
 *
 * The arms are shuffled from a printed seed and reported as medians with the
 * Mann-Whitney pairing count (`lib/measurement.mjs` says why each). The
 * renderer is asserted and printed, because a frame cost that does not name its
 * lane is not a figure (map constraint, #435). The quality arm is pinned on the
 * pass directly rather than through the settings row, which would write
 * `localStorage` and move the lighting's half of the key as well.
 */
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { SEED, VIEWPORT } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const FRAMES = 60;
const BLOCKS = 12;
const SHUFFLE_SEED = Number(process.env.SHUFFLE_SEED ?? 532);

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
// Retina, as `measure-light-cost.mjs` does: a full-screen term is paid per
// fragment, and at the default the buffer is a quarter of the player's.
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
// Watched, so a page error or a shader failure mid-run fails the run rather than
// printing a table measured on a page that had stopped drawing.
const { watch, exit } = tally();
watch(page);
await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure");

const setup = await page.evaluate(() => {
	const g = window.__seelite;
	g.clockHeld = true;
	g.playArrival();
	return { rift: g.arrivalRift !== null };
});
if (!setup.rift) throw new Error("measure: playArrival built no rift");

/** The phases each side of the key is priced at; see the docstring. */
const PHASES = ["-0.6", "0.3", "1.5", "4.3@chase"];

const block = (arm) =>
	page.evaluate(
		([arm, frames]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			// Past the end of the transition: nothing drawn, see the docstring.
			if (arm.startsWith("off")) {
				g.view = arm === "off@chase" ? "chase" : "cockpit";
				g.holdWitchspace(100);
			} else {
				const [quality, phase, view = "cockpit"] = arm.split("@");
				g.view = view;
				g.witchspacePass.setQuality(quality);
				g.holdWitchspace(Number(phase));
			}
			// A warm frame: a changed sample count recompiles the program once,
			// and timing that would price the switch rather than the term.
			g.render(0);
			const enabled = g.witchspacePass.enabled;
			const sync = new Uint8Array(4);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			return { ms: (performance.now() - started) / frames, enabled };
		},
		[arm, FRAMES],
	);

// Each view is priced against itself: a chase frame draws the hull where a
// cockpit frame draws the cabin, and that is not the pass's cost.
const arms = { off: [], "off@chase": [] };
for (const phase of PHASES)
	for (const quality of ["high", "low"]) arms[`${quality}@${phase}`] = [];
const shuffle = seededShuffler(SHUFFLE_SEED);
for (let b = 0; b < BLOCKS; b++)
	for (const arm of shuffle(Object.keys(arms))) {
		const r = await block(arm);
		if (arm.startsWith("off") === r.enabled)
			throw new Error(
				`measure: arm ${arm} ran with the pass enabled=${r.enabled}`,
			);
		arms[arm].push(r.ms);
	}
await browser.close();

const fmt = (x) => x.toFixed(3);
console.log(`renderer: ${renderer}`);
console.log(
	`${BLOCKS} blocks of ${FRAMES} frames per arm, shuffle seed ${SHUFFLE_SEED}, ${VIEWPORT.width}x${VIEWPORT.height} @2x`,
);
for (const [arm, xs] of Object.entries(arms))
	console.log(
		`${arm.padEnd(15)} median ${fmt(median(xs))} ms  range ${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}`,
	);
for (const arm of Object.keys(arms).filter((a) => !a.startsWith("off"))) {
	const base = arm.endsWith("@chase") ? "off@chase" : "off";
	console.log(
		`${arm} − ${base}: ${fmt(median(arms[arm]) - median(arms[base]))} ms, ${arm} slower in ${separation(arms[arm], arms[base])} pairings`,
	);
}
exit();
