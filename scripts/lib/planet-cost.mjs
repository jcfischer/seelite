/**
 * The half of #206's planet-cost sweep that is not a browser — its columns, the
 * way a reading is lifted out of the `?fps` readout, and the refusals.
 *
 * Separated from `scripts/measure-planet-cost.mjs` for one reason: that script
 * cannot be tested, because the thing it exists to do is drive a real GPU, and
 * every headless runner in this repo draws through SwiftShader. What *can* be
 * tested is everything between the browser and the printed table, and #7's rule
 * makes that worth doing rather than optional — **a measurement instrument must
 * fail loudly**, because an instrument that quietly reports garbage is worse
 * than one that dies: its numbers get transcribed into a spec. `tests/planet-cost.test.ts`
 * asserts every guard here from both sides.
 */

/**
 * Apparent sizes, in the subject's own radii, widest first.
 *
 * **Widest first because the first column is the control**, and the control is
 * what `vsyncRefusal` reads. A planet at 200 radii is a few pixels across and
 * costs the frame essentially nothing, so it is the cell that says what this
 * machine's floor is; if even *that* comes back at a display refresh, the run
 * measured the compositor and not the renderer.
 *
 * The other six walk in to 1.02 radii, which on `planet-5` is a **measured**
 * 109 km over a 5,473 km world: low orbit, the surface filling the frame, and
 * the worst case the near layer ever draws.
 *
 * **2 is here because it is where `planet-fill` stands**, so the sweep prices
 * the frame the canonical view set captures and a later node that makes a
 * surface cheaper has one number and one picture about the same placement.
 * **1.2 is here although nothing is framed there**: it was `planet-fill`'s
 * first placement and it captures as a featureless wash, but the *cost* does
 * not care that the picture is unreadable — the expensive readings are at the
 * close end, and dropping the column would leave the table blind between two
 * radii and the surface.
 *
 * **The closing column was 0.05 in #206's own prescription, and it measured
 * nothing.** `__sunOffset` takes its range from the body's *centre*, so 0.05
 * radii put the camera 274 km from the centre and 5,199 km **below the
 * surface**; a hull is drawn `FrontSide`, so the planet vanished and the column
 * came back at 1.9 ms — the cheapest cell in the table, level with a control
 * 200 radii out. `radiiRefusal` is what stops that shape recurring.
 */
export const RADII = Object.freeze([200, 30, 8, 3, 2, 1.2, 1.02]);

/**
 * `null` if every column stands outside the body, a sentence naming the ones
 * that do not.
 *
 * A radius of 1 is the surface and anything under it is inside the hull. Both
 * are refused, because the failure is not a bad reading but a *plausible* one:
 * a buried camera draws nothing, so the cell is fast, and fast is what the rest
 * of this table reports as good news.
 *
 * @param {ReadonlyArray<number>} radii
 * @returns {string | null}
 */
export function radiiRefusal(radii) {
	const buried = radii.filter((r) => finite("radius", r) <= 1);
	if (!buried.length) return null;
	return (
		`${buried.join(", ")} radii put the camera inside the body — ` +
		`__sunOffset ranges from the centre, so anything at or under 1 radius is ` +
		`below the surface, where a FrontSide hull draws nothing and the cell ` +
		`reads as the cheapest in the run.`
	);
}

/**
 * The two relief paths, in the order `perf-panel.ts` cycles them.
 *
 * Restated here rather than imported, and unlike `PERF_CLASSES` — which the
 * sweep dynamically imports off the served page rather than copy — this pair is
 * a *type* in `planet-shaders.ts` (`ReliefPath`) and not a value: there is no
 * array to import. A third path would be a missing column in an instrument
 * rather than anything the game renders differently, which is the same trade
 * `perf-panel.ts` documents for its own copy.
 */
export const RELIEF_PATHS = Object.freeze(["four-tap", "screen-space"]);

/**
 * A number, or a throw naming the cell it came from.
 *
 * The label is not decoration: a sweep is hundreds of cells, and "a value is NaN"
 * with no cell name behind it leaves the reader re-running the whole thing to
 * find out which one. `measure-aperture-cut.ts` and `measure-cruise-arrival.ts`
 * carry the same helper for the same reason.
 *
 * @param {string} what
 * @param {number} value
 * @returns {number}
 */
export function finite(what, value) {
	if (!Number.isFinite(value))
		throw new Error(`${what} is not finite: ${value}`);
	return value;
}

/**
 * `NNN.N fps · NN ms · worst NN ms · peak NN ms`, as numbers.
 *
 * **The frame time is derived from the rate and not read.** The meter's own
 * millisecond figure is whole milliseconds — right for a reader at 15 fps, and
 * a quarter of the reading at 400 — so `ms` here is `1000 / fps`, where the
 * decimal in the rate survives. `src/fps-meter.ts`'s `fpsReadout` is the writer
 * and the test round-trips through it, so a change to that line goes red here
 * rather than silently stopping this regex from matching.
 *
 * Three ways to refuse, all of them loud:
 *
 * - **A stalled meter.** `fps-meter.ts` replaces the whole line with `stalled ·
 *   N s` when frames stop arriving, and it carries no rate. Reading it with a
 *   rate-shaped regex matches nothing; saying so beats returning a NaN.
 * - **An unreadable line**, including the `— fps` the meter mounts with, which
 *   is what a read before the first window returns.
 * - **A zero rate**, which divides to an infinity. A window with no frames in
 *   it reports 0.0, and `Number.isFinite` is the only thing between that and a
 *   table cell reading `Infinity ms`.
 *
 * @param {string} text the readout element's `textContent`
 * @returns {{ fps: number, ms: number, worstMs: number, peakMs: number }}
 */
export function parseFpsReadout(text) {
	const line = String(text).trim();
	if (/stalled/i.test(line))
		throw new Error(
			`the fps meter reports stalled, not a rate: "${line}" — the page ` +
				`stopped painting, so there is no frame cost to read`,
		);
	const m = line.match(
		/^([\d.]+)\s*fps\D+([\d.]+)\s*ms\D+worst\s+([\d.]+)\s*ms\D+peak\s+([\d.]+)\s*ms$/,
	);
	if (!m)
		throw new Error(
			`could not read the fps meter: "${line}" — expected the line ` +
				`src/fps-meter.ts's fpsReadout writes`,
		);
	const fps = finite("fps", Number(m[1]));
	return {
		fps,
		ms: finite("frame time", 1000 / fps),
		worstMs: finite("worst frame", Number(m[3])),
		peakMs: finite("peak frame", Number(m[4])),
	};
}

/**
 * How much a run's most expensive cell must exceed its cheapest before the run
 * counts as measuring a renderer at all.
 *
 * A dot 200 radii away and a planet filling the frame are not the same amount
 * of work on any GPU; a run where they read alike is a run reporting something
 * other than the renderer. Measured on a good run at pixel ratio 1, the spread
 * is about 13x — so 1.5 is far below any real table and far above a clamp,
 * which pins the ratio at 1.0.
 */
const MIN_SPREAD = 1.5;

/** Refresh rates worth *naming* in the refusal when one happens to match. Not
 *  what the refusal is decided on — see `vsyncRefusal`. */
const REFRESH_HZ = Object.freeze([60, 75, 90, 120, 144]);

/** How close to a refresh rate counts as pinned to it, for the diagnosis only.
 *  4% covers a compositor's jitter. */
const PINNED = 0.04;

/**
 * `null` if a run's readings look like a renderer, a sentence if they look like
 * a display.
 *
 * **The trap this exists for.** A headed browser composites at the panel's
 * refresh, so a meter counting `requestAnimationFrame` callbacks reads the same
 * number for a 2 ms frame and a 16 ms one. `measure-planet-cost.mjs` launches
 * with `--disable-gpu-vsync --disable-frame-rate-limit` to lift that; a flag
 * that stops working — renamed upstream, ignored on a platform, dropped from a
 * copied invocation — produces a full table where every cheap column reads
 * identically. Nothing about that table looks wrong.
 *
 * **What is read is the spread, not a rate.** The first version of this
 * compared the cheapest cell against a list of refresh intervals, which sage
 * rejected on PR #214 and was right to: a fully clamped 144 Hz run reads
 * 6.94 ms in every cell and matched nothing on a list of 60 and 120, so it
 * passed as measured. Worse, this function's own test already described the
 * rule as being "about the *spread* being absent, not about one rate" — the
 * prose was right and the code was not.
 *
 * A clamp is a *flat* run, and flatness needs no list: the control column and
 * the fill column cannot cost the same. So the refusal fires on
 * `max / min`, which is rate-independent by construction and catches a panel
 * nobody thought of. The rate list survives only to *name* the interval in the
 * message when one matches, because "6.94 ms, a 144 Hz frame interval" points
 * at the cause and a bare ratio does not.
 *
 * It does not fire on a slow machine: a slow run is still 13x from dot to
 * fill, only with every figure larger.
 *
 * @param {number[]} msPerFrame every cell's frame time from one run
 * @returns {string | null}
 */
export function vsyncRefusal(msPerFrame) {
	if (!msPerFrame.length)
		return "no readings in this run — there is nothing to check for a vsync clamp";
	const cells = msPerFrame.map((v) => finite("cell", v));
	const cheapest = Math.min(...cells);
	const dearest = Math.max(...cells);
	if (cheapest <= 0)
		return `a cell in this run reads ${cheapest} ms, which is not a frame cost`;
	if (dearest / cheapest >= MIN_SPREAD) return null;
	const hz = REFRESH_HZ.find(
		(rate) => Math.abs(cheapest - 1000 / rate) <= (1000 / rate) * PINNED,
	);
	return (
		`this run is flat: ${cheapest.toFixed(2)} ms at its cheapest and ` +
		`${dearest.toFixed(2)} ms at its dearest, a spread of ` +
		`${(dearest / cheapest).toFixed(2)}x where a real table spans about 13x. ` +
		(hz ? `That cheapest figure is a ${hz} Hz frame interval. ` : "") +
		`A planet drawn as a dot and a planet filling the frame cannot cost the ` +
		`same, so this is the display's timing and not the renderer's. Check that ` +
		`--disable-gpu-vsync and --disable-frame-rate-limit reached the browser.`
	);
}
