/**
 * What #532's witchspace pass costs a frame while it is drawing, on each side
 * of #99's `quality` key — and that it costs nothing when it is not.
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
 * the tunnel opening out of the point, `1.5` the tunnel at full cover.
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
import { installChargeToNearest } from "./lib/witchspace-page.mjs";
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

await page.evaluate(installChargeToNearest);
const setup = await page.evaluate(() => {
	window.__seelite.clockHeld = true;
	return window.__chargeToNearest();
});
if (!setup.charged)
	throw new Error(`measure: the charge was refused (${setup.notice})`);

/** The phases each side of the key is priced at; see the docstring. */
const PHASES = [-0.6, 0.3, 1.5];

const block = (arm) =>
	page.evaluate(
		([arm, frames]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			if (arm === "off") g.holdWitchspace(null);
			else {
				const [quality, phase] = arm.split("@");
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

const arms = { off: [] };
for (const phase of PHASES)
	for (const quality of ["high", "low"]) arms[`${quality}@${phase}`] = [];
const shuffle = seededShuffler(SHUFFLE_SEED);
for (let b = 0; b < BLOCKS; b++)
	for (const arm of shuffle(Object.keys(arms))) {
		const r = await block(arm);
		if ((arm === "off") === r.enabled)
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
		`${arm.padEnd(9)} median ${fmt(median(xs))} ms  range ${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}`,
	);
for (const arm of Object.keys(arms).filter((a) => a !== "off"))
	console.log(
		`${arm} − off: ${fmt(median(arms[arm]) - median(arms.off))} ms, ${arm} slower in ${separation(arms[arm], arms.off)} pairings`,
	);
exit();
