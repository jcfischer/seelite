/**
 * What each rung delivers over a planet fill, and where Auto settles — **on the
 * renderer the player has**.
 *
 *   npm run dev                                  # in one shell
 *   node scripts/measure-adaptive-resolution.mjs # in another
 *
 * This is #352's headed evidence, and it exists because the node's verification
 * asks for a run that "reproduces #225's table under Auto" rather than a
 * screenshot of one. #225's table was read off `?fps` by hand on two displays;
 * a figure taken that way cannot be re-taken after a change, which is the whole
 * argument for an instrument.
 *
 * ## Not a probe, and not a gate
 *
 * It asserts nothing about the numbers and always exits 0 on them. There is no
 * frame-time floor in this game (#98) and the figures are a property of the
 * machine it is run on, so what is wanted is a table for a receipt rather than
 * a threshold that fails on somebody else's laptop. The `measure-` prefix keeps
 * it out of `probe-all`.
 *
 * It does refuse two things, and both are refusals rather than warnings: a
 * software rasteriser, through `lib/players-renderer.mjs`, because a frame cost
 * read off SwiftShader is not the player's; and a run where the sampler never
 * filled, because a table of nulls reads like a table.
 *
 * ## The vsync floor is the subject here, not a defect
 *
 * `lib/planet-cost.mjs` carries a `vsyncRefusal` for instruments that must not
 * be floored by the display's refresh — under vsync a frame cheaper than the
 * refresh interval reads as the refresh interval, so a *cost* measured that way
 * is a measurement of the panel. **This instrument deliberately does not use
 * it.** What #352 steers on is the delivered frame period, floor and all,
 * because that is what the player experiences and what the controller is given.
 * A rung reading exactly the panel's period is the signal `minPeriodMs` exists
 * to identify, and it is printed beside every row for that reason.
 *
 * ## Why it reads the sampler rather than `?fps`
 *
 * The same numbers, from the module the controller consumes. `?fps` is an
 * overlay with its own 500 ms window and its own formatting, and parsing it
 * would put a second percentile policy in front of a figure the controller
 * already has. `enableFrameAttribution("cadence")` costs one array push per
 * frame and issues no timer query.
 */
import { finite, radiiRefusal, RADII } from "./lib/planet-cost.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { GAME_TIME_S, SEED, VIEWPORT, VIEWS } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import {
	ADAPTIVE_BUDGET_MS,
	RENDER_SCALE_LADDER,
} from "../src/adaptive-resolution.ts";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/**
 * The subject, read off the canonical view rather than restated.
 *
 * `measure-planet-cost.mjs` makes the argument and this follows it: a frame is
 * a subject, a seed, a sun angle and an apparent size, and naming the view takes
 * all four from the file that owns them. Re-frame `planet-fill` and this table
 * follows it, including onto another body.
 */
const priced = VIEWS.find((v) => v.name === "planet-fill");
if (!priced || priced.shot.kind !== "body-offset")
	throw new Error(
		'the view set declares no "planet-fill" body-offset shot — this ' +
			"instrument places the camera at a body's own radii and has nothing to " +
			"point at without one",
	);
const SUBJECT = priced.shot.body;
const SUN_ANGLE_DEG = priced.shot.sunAngleDeg;
const SUBJECT_SEED = priced.shot.seed ?? SEED;
const RADII_AT = priced.shot.radii;
radiiRefusal(RADII);

/** How long to hold a rung before reading it. */
const SETTLE_MS = 2_500;
/** How long to let Auto run before reporting where it landed. */
const AUTO_MS = 25_000;

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage();
await page.setViewportSize(VIEWPORT);
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: SUBJECT_SEED }));
await bootedGame(page);
const renderer = await assertPlayersRenderer(
	page,
	"measure what each resolution rung delivers over a planet",
);

await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
await page.evaluate(
	([id, r, deg]) => window.__sunOffset(id, r, deg),
	[SUBJECT, RADII_AT, SUN_ANGLE_DEG],
);
// A placement is a layer handoff and re-bakes at the new layer's face size.
// Reading through that would price twelve bake faces as part of the frame.
await page.waitForFunction(
	() => window.__seelite.bakeQueue.length === 0,
	undefined,
	{ timeout: 60_000 },
);
// The controller's own sampler, not a second one. One push per frame, no query.
await page.evaluate(() => window.__seelite.enableFrameAttribution("cadence"));

const read = async () =>
	await page.evaluate(() => {
		const game = window.__seelite;
		const snapshot = game.attributionSnapshot();
		return {
			scale: game.effectiveRenderScale(),
			buffer: [game.renderer.domElement.width, game.renderer.domElement.height],
			pixelRatio: game.renderer.getPixelRatio(),
			cadence: snapshot?.cadence ?? null,
			diagnostics: game.adaptiveDiagnostics(),
		};
	});

const hold = async (ms) => {
	// Reprimed first, so the window that is read contains only this rung's
	// frames. Without it the median at 50% still carries the 100% frames the
	// ring was holding when the buffer was rebuilt.
	await page.evaluate(() => {
		window.__seelite.attributionSnapshot();
		window.__seelite.enableFrameAttribution("cadence");
	});
	await page.evaluate(
		(waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
		ms,
	);
};

// ── the manual ladder ───────────────────────────────────────────────────────
const rows = [];
for (const rung of RENDER_SCALE_LADDER) {
	await page.evaluate((value) => {
		const game = window.__seelite;
		game.settings.set("renderScale", value);
		// The rung change leaves the previous rung's periods in the ring.
		game.attributionSnapshot();
	}, rung);
	await hold(SETTLE_MS);
	const sample = await read();
	const median = sample.cadence?.medianMs ?? null;
	if (median === null)
		throw new Error(
			`no frame period at ${rung}: the cadence ring is empty after ` +
				`${SETTLE_MS} ms, so every figure below it would be a null printed ` +
				"as a table",
		);
	rows.push({
		rung,
		medianMs: finite(`period at ${rung}`, median),
		p95Ms: sample.cadence.p95Ms,
		minMs: sample.cadence.minPeriodMs,
		frames: sample.cadence.sampleCount,
		buffer: sample.buffer,
	});
}

const fps = (ms) => (ms === null ? "—" : (1000 / ms).toFixed(0));
const ms = (v) => (v === null ? "—" : v.toFixed(2));

console.log(`\nrenderer            ${renderer}`);
console.log(
	`subject             ${SUBJECT} at ${RADII_AT} radii, sun ${SUN_ANGLE_DEG}°, seed ${SUBJECT_SEED}`,
);
console.log(`viewport            ${VIEWPORT.width}x${VIEWPORT.height} CSS`);
console.log(
	`budget              ${ADAPTIVE_BUDGET_MS.toFixed(2)} ms (${(1000 / ADAPTIVE_BUDGET_MS).toFixed(0)} fps, declared)`,
);

console.log(
	"\nrung   buffer          period med    p95      cheapest   fps   frames",
);
for (const row of rows)
	console.log(
		`${String(row.rung).padEnd(6)} ${`${row.buffer[0]}x${row.buffer[1]}`.padEnd(15)} ` +
			`${ms(row.medianMs).padStart(9)} ${ms(row.p95Ms).padStart(8)} ` +
			`${ms(row.minMs).padStart(10)} ${fps(row.medianMs).padStart(5)} ${String(row.frames).padStart(8)}`,
	);

/**
 * Solve the controller's own curve on the two rungs furthest apart and reprint
 * the middle one beside what it measured.
 *
 * The same `t(s) = fixed + fill * s^2` the upshift gate uses, so a machine where
 * the model does not hold says so here rather than inside a decision nobody can
 * see. Printed as a residual rather than a verdict: it is one prediction from
 * two points and the middle rung is the only one it can be checked against.
 */
const low = rows[rows.length - 1];
const high = rows[0];
const fill = (high.medianMs - low.medianMs) / (high.rung ** 2 - low.rung ** 2);
const fixed = high.medianMs - fill * high.rung ** 2;
const middle = rows[1];
const predicted = fixed + fill * middle.rung ** 2;
console.log(
	`\nfit t(s) = ${fixed.toFixed(2)} + ${fill.toFixed(2)} * s^2   ` +
		`fill share ${((fill / high.medianMs) * 100).toFixed(1)}% of the top rung`,
);
console.log(
	`predicted ${middle.rung}: ${predicted.toFixed(2)} ms against ${middle.medianMs.toFixed(2)} measured ` +
		`(residual ${(predicted - middle.medianMs).toFixed(2)} ms)`,
);
console.log(
	"\nA rung whose median equals its cheapest period is pinned by the display's\n" +
		"refresh, so its true cost is at most what is printed. That is the state\n" +
		"`minPeriodMs` exists to identify and it is why the fit ignores such rungs.",
);

// ── and where Auto settles ──────────────────────────────────────────────────
const transitions = [];
await page.exposeFunction("__recordTransition", (entry) =>
	transitions.push(entry),
);
await page.evaluate(() => {
	const game = window.__seelite;
	let last = null;
	window.__adaptiveWatch = setInterval(() => {
		const d = game.adaptiveDiagnostics();
		if (!d) return;
		if (d.scale !== last) {
			last = d.scale;
			window.__recordTransition({
				scale: d.scale,
				reason: d.reason,
				gate: d.gate,
				predictedMs: d.predictedMs,
				periodMedianMs: d.periodMedianMs,
			});
		}
	}, 50);
	game.settings.set("renderScale", "auto");
});
await page.evaluate(
	(waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
	AUTO_MS,
);
await page.evaluate(() => clearInterval(window.__adaptiveWatch));
const settled = await read();

console.log(`\nAuto, after ${(AUTO_MS / 1000).toFixed(0)} s on this frame`);
if (transitions.length === 0)
	console.log("  no transition — it held the rung it started on");
for (const entry of transitions)
	console.log(
		`  → ${entry.scale}  ${ms(entry.periodMedianMs)} ms  gate ${entry.gate}` +
			`${entry.predictedMs === null ? "" : ` (predicted ${ms(entry.predictedMs)} ms)`}  ${entry.reason}`,
	);
console.log(
	`  settled at ${settled.diagnostics?.scale} — ${ms(settled.diagnostics?.periodMedianMs ?? null)} ms, ` +
		`${fps(settled.diagnostics?.periodMedianMs ?? null)} fps, reason: ${settled.diagnostics?.reason}`,
);
console.log(
	`  curve points ${JSON.stringify(settled.diagnostics?.observations ?? {})}`,
);

await browser.close();
