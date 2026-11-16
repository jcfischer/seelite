import { seededShuffler } from "./measurement.mjs";

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
 * The remaining columns walk in to 1.02 radii, which on `planet-5` is a **measured**
 * 109 km over a 5,473 km world: low orbit, the surface filling the frame, and
 * the worst case the near layer ever draws.
 *
 * **2 is here because it is where `planet-fill` stands**, so the sweep prices
 * the frame the canonical view set captures and a later node that makes a
 * surface cheaper has one number and one picture about the same placement.
 * **1.6 and 1.5 price station altitude**, at the close-detail band's outer edge
 * and the station orbit floor (node #720, D12).
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
/**
 * **2.5 is #208's rung and it is here because the shipped band reaches it.**
 *
 * The ladder's 2 was the closest column to where a baked planet becomes cheap,
 * and the band refuses the cube there — a 512 face is 1.14 screen pixels per
 * texel at two radii and the tolerance is one — so every figure quoted from that
 * column had to be taken with the band pinned, which is a measurement of a state
 * the game is never in (sage, PR #256, round 5). 2.5 is inside the band on the
 * larger face and outside the small one, so the column exists at all.
 */
export const RADII = Object.freeze([
	200, 30, 8, 3, 2.5, 2, 1.6, 1.5, 1.2, 1.02,
]);

/**
 * Select requested columns in table order, refusing unknown values.
 *
 * @template T
 * @param {ReadonlyArray<T>} all
 * @param {ReadonlyArray<T> | null | undefined} wanted
 * @param {string} what
 */
export function narrow(all, wanted, what) {
	if (!wanted) return all;
	const missing = wanted.filter((w) => !all.includes(w));
	if (missing.length)
		throw new Error(
			`--${what} names ${missing.join(", ")}, which the sweep does not have ` +
				`(${all.join(", ")})`,
		);
	return all.filter((a) => wanted.includes(a));
}

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
 * How far above the widest column's floor a cell has to sit to be an outlier.
 *
 * Blunt on purpose. The honest cells in that column sit within a few percent of
 * each other — the subject is a few pixels across, so no arm of the ablation
 * ladder and no class can matter there — and the ones this exists to catch run
 * seventeen times the floor. Anything at twice it is a different phenomenon
 * rather than a wide reading of the same one, and there is no value between the
 * two populations for the threshold to be sensitive to.
 */
export const FAR_COLUMN_OUTLIER_FACTOR = 2;

/**
 * Whether a run's widest column holds together, and which cells do not.
 *
 * **This is the check the endpoint drift control cannot be.** That control reads
 * one cell before the sweep and again after it, and its own docstring concedes
 * that two endpoints cannot locate an excursion that recovered. #248's first
 * decomposition runs are exactly that case: `full at 200r` read 2.5 ms at both
 * ends of a run whose intermediate cells in the same column read 44.
 *
 * So the widest column is used as an invariant instead. Every cell in it frames
 * the same few-pixel subject, so they must agree; a cell at
 * `FAR_COLUMN_OUTLIER_FACTOR` times the column's floor says the run had an
 * excursion. **It does not say where in the run** — the invariant is read at
 * one radius and detection is not location — so the verdict is the run's and
 * the console's advice to drop the far columns is the operator's reading of it,
 * not a scope this function can establish.
 *
 * **It returns a verdict rather than throwing**, and rides into the JSON rather
 * than only onto the console (sage, PR #250). A console line is a qualification
 * only the operator sees; the JSON is what a later run diffs against and what a
 * receipt quotes, and a row that was unquotable at write time reads there as
 * settled, fresh and endpoint-controlled — every qualification the format has,
 * all of them saying it is fine. Throwing is wrong for the opposite reason: the
 * near columns of such a run are the ones the sweep exists for and they are
 * unaffected, so losing them would cost more than the doubt is worth.
 *
 * Generic in the row, because it hands the offending rows straight back and a
 * caller names them by whichever field its own sweep keys on — the ablation
 * ladder's `arm`, the class sweep's `surfaceClass` and `relief`. Narrowing the
 * parameter to the two fields this reads would erase the rest from the return.
 *
 * @template {{ms: number, radii: number}} Row
 * @param {ReadonlyArray<Row>} rows one run's cells
 * @param {number} widestRadii the column that must not move
 */
export function farColumnVerdict(rows, widestRadii) {
	const column = rows.filter((r) => r.radii === widestRadii);
	if (!column.length)
		throw new Error(
			`no cells at ${widestRadii} radii — the widest column is the run's own ` +
				`invariant and a run without one has nothing to check itself against`,
		);
	const floorMs = Math.min(...column.map((r) => finite("widest cell", r.ms)));
	const outliers = column.filter(
		(r) => r.ms > FAR_COLUMN_OUTLIER_FACTOR * floorMs,
	);
	return {
		radii: widestRadii,
		cells: column.length,
		floorMs,
		factor: FAR_COLUMN_OUTLIER_FACTOR,
		outliers,
		/**
		 * **A property of the run, not of a column**, and the name says so
		 * because the first version's did not (sage, PR #250, round 3).
		 *
		 * The invariant is read at one radius, so it establishes *that* the run
		 * had an excursion and says nothing about *when*. Flagging only the
		 * column it was detected in left the 30r cell of the same run — 44.6 ms
		 * in #248's first run, beside a 2.6 ms neighbour — carrying no doubt at
		 * all, and there is no radius at which the argument for the cutoff stops
		 * being arbitrary. So the flag is the run's, and a reader decides which
		 * of its cells to trust on evidence rather than on a threshold this
		 * function has no basis for.
		 *
		 * What that evidence looks like for #248: the near columns reproduce
		 * across two runs to within 0.2 ms, and the far ones do not reproduce at
		 * all.
		 */
		excursion: outliers.length > 0,
	};
}

/**
 * Write each run's excursion verdict onto every row that run produced.
 *
 * Three lines, extracted and tested because the three lines it replaced were
 * wrong: they carried the flag onto `radii >= RADII[0]`, which is the widest
 * column and nothing else, so the 30r cell of an excursion run came out clean
 * (sage, PR #250, round 3). A loop small enough to look obviously right is
 * exactly the one nothing was watching.
 *
 * Mutates in place, because `rows` is the array the JSON is written from and a
 * copy would be a second home for the same cells.
 *
 * @template {{pixelRatio: number}} Row
 * @param {Row[]} rows every cell of every run
 * @param {Record<number, {excursion: boolean}>} verdictByRatio one per run
 * @returns {(Row & {runExcursion: boolean})[]} the same rows, flagged
 */
export function flagExcursions(rows, verdictByRatio) {
	for (const row of rows) {
		const verdict = verdictByRatio[row.pixelRatio];
		if (!verdict)
			throw new Error(
				`no verdict for pixel ratio ${row.pixelRatio} — every run is checked ` +
					`against its own widest column, so a row from a run with no verdict ` +
					`would be written out carrying no doubt at all`,
			);
		row.runExcursion = verdict.excursion;
	}
	return rows;
}

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
 * The band a display refresh interval can plausibly fall in, in milliseconds —
 * 240 Hz at the fast end, 50 Hz at the slow one.
 *
 * **A band and not a list, because the list was the third failure.** Round 3
 * of sage's review on PR #214 caught a fully quantized 100 Hz run —
 * `[10, 10, 20, 30]` — passing, because 100 was not among the rates named and
 * the check fell through to `return null`. Falling back to passing sounds like
 * the cautious direction and is not: this guard's whole job is to refuse, and
 * every version of it that has failed has failed *open*.
 *
 * A band cannot be short an entry. Rates outside 50–240 Hz are not displays
 * anyone measures this on, and a run whose floor sits outside it is not a
 * clamped one whatever else is true of it.
 */
const REFRESH_MS = Object.freeze({ fastest: 1000 / 240, slowest: 1000 / 50 });

/** How close counts as sitting on an interval, or on a multiple of one. 6% is
 *  wide enough for a compositor's jitter and narrow enough that a genuine 1.06x
 *  ratio between two cheap cells is not read as a multiple. */
const PINNED = 0.06;

/**
 * The share of a run's cells that must land on a multiple of the floor before
 * the run reads as quantized rather than as a coincidence. Not 1.0: one
 * outlying cell should not buy a clamped run a pass.
 */
const QUANTIZED_SHARE = 0.9;

/**
 * `null` if a run's readings look like a renderer, a sentence if they look like
 * a display.
 *
 * **The trap this exists for.** A headed browser composites at the panel's
 * refresh, so a meter counting `requestAnimationFrame` callbacks cannot report
 * anything the compositor did not deliver. `measure-planet-cost.mjs` launches
 * with `--disable-gpu-vsync --disable-frame-rate-limit` to lift that; a flag
 * that stops working — renamed upstream, ignored on a platform, dropped from a
 * copied invocation — produces a full, plausible table of the display's timing.
 *
 * **What a clamped run actually looks like, after two wrong answers.** The
 * first version compared the cheapest cell against a list of 60 and 120, so a
 * clamped 144 Hz run matched nothing and passed. The second called a clamp
 * *flat* and refused on `max / min` — and sage rejected that too, correctly:
 * under vsync a frame that misses its refresh takes **two** intervals, so a
 * clamped run reads 6.94, 13.89, 20.83 and spans 3x. Flatness was never the
 * property. Both versions failed open, and both had prose asserting they did
 * not.
 *
 * The property is **quantization**. A clamped run's cells are integer multiples
 * of one interval, because there is nothing else a composited frame can cost.
 * So:
 *
 * 1. Take the cheapest cell as the candidate floor. Under a clamp it is one
 *    interval; a run that is not clamped has no reason to floor there.
 * 2. If that floor is outside `REFRESH_MS`, pass. A renderer measured freely
 *    lands wherever the work lands — this game's control cell is under 2 ms,
 *    which no display refreshes at.
 * 3. If it does, ask whether the *rest* of the run is a multiple of it. A real
 *    table is not: 1.8, 1.9, 3.6, 7.2 and 11.6 against a 1.8 floor gives 1.06
 *    and 6.4, which are not integers. A clamped one is, by construction.
 *
 * Both conditions are needed. Step 2 alone is the first version's bug; step 3
 * alone would accuse a slow machine whose costs happened to fall in a tidy
 * ratio. Step 2 is a *band* rather than a list of rates because the list was
 * itself the third failure — see `REFRESH_MS`.
 *
 * @param {number[]} msPerFrame every cell's frame time from one run
 * @returns {string | null}
 */
export function vsyncRefusal(msPerFrame) {
	if (!msPerFrame.length)
		return "no readings in this run — there is nothing to check for a vsync clamp";
	const cells = msPerFrame.map((v) => finite("cell", v));
	const floor = Math.min(...cells);
	if (floor <= 0)
		return `a cell in this run reads ${floor} ms, which is not a frame cost`;
	// Outside the band no display produced this, so nothing below matters.
	if (
		floor < REFRESH_MS.fastest * (1 - PINNED) ||
		floor > REFRESH_MS.slowest * (1 + PINNED)
	)
		return null;
	const onMultiple = cells.filter((ms) => {
		const steps = ms / floor;
		return Math.abs(steps - Math.round(steps)) <= PINNED * Math.round(steps);
	});
	if (onMultiple.length < cells.length * QUANTIZED_SHARE) return null;
	return (
		`this run is quantized: its cheapest cell is ${floor.toFixed(2)} ms — ` +
		`${(1000 / floor).toFixed(0)} Hz, inside the range a display refreshes at — ` +
		`and ${onMultiple.length} of ${cells.length} cells sit on an integer ` +
		`multiple of it. A composited frame can only cost whole refresh intervals, ` +
		`so this is the display's timing and not the renderer's. Check that ` +
		`--disable-gpu-vsync and --disable-frame-rate-limit reached the browser.`
	);
}

/**
 * The apparent sizes the close-detail band is priced at (node #758): the
 * band's outer edge and the 2R fade end, the station orbit floor, and the
 * flight boundary. Each is also a rung of `RADII`.
 */
export const CLOSE_DETAIL_RADII = Object.freeze([2, 1.6, 1.5, 1.2]);

/** The extra-octave caps node #720 D10 asks the ladder to walk. */
export const CAP_LADDER = Object.freeze([0, 2, 4, 6]);

/**
 * The arms of node #720 D8, D9, D10 and D11, each a complete state.
 *
 * `interim` is the shipped frame: High quality, the cap the game writes itself,
 * the ground at half resolution inside the band, screen-space relief and the
 * clouds on their own full-resolution footprint. Every other arm moves exactly
 * one lever away from it, so a difference between two cells is one lever's.
 * `cap-6` is the same state as `interim` reached through the override, which
 * makes the pair the instrument's own noise floor and a check that the override
 * writes what the game writes.
 */
export const CLOSE_DETAIL_ARMS = Object.freeze(
	[
		{
			name: "interim",
			cap: "shipped",
			halfRes: true,
			relief: "screen-space",
			clouds: "extended",
			prices: "the shipped frame: High, the interim cap, half-res ground",
		},
		{
			name: "cap-0",
			cap: 0,
			halfRes: true,
			relief: "screen-space",
			clouds: "extended",
			prices: "the band off; interim minus this is what the band costs",
		},
		{
			name: "cap-2",
			cap: 2,
			halfRes: true,
			relief: "screen-space",
			clouds: "extended",
			prices: "the cap ladder, 2 extra octaves",
		},
		{
			name: "cap-4",
			cap: 4,
			halfRes: true,
			relief: "screen-space",
			clouds: "extended",
			prices: "the cap ladder, 4 extra octaves",
		},
		{
			name: "cap-6",
			cap: 6,
			halfRes: true,
			relief: "screen-space",
			clouds: "extended",
			prices: "the cap ladder, 6 extra octaves; the interim state by override",
		},
		{
			name: "full-res",
			cap: "shipped",
			halfRes: false,
			relief: "screen-space",
			clouds: "extended",
			prices: "the ground drawn at full resolution inside the band (D11)",
		},
		{
			name: "analytic-gradient",
			cap: "shipped",
			halfRes: true,
			relief: "analytic-gradient",
			clouds: "extended",
			prices: "the analytic relief against screen-space (D8)",
		},
		{
			name: "clouds-at-ground",
			cap: "shipped",
			halfRes: true,
			relief: "screen-space",
			clouds: "at-ground",
			prices: "the clouds on the ground's footprint, not their own (D9)",
		},
	].map((a) => Object.freeze(a)),
);

/**
 * `null` if the arms are the roster node #758 names, a sentence if not.
 *
 * Checked rather than trusted because the arm list is what the receipt claims
 * to have priced: a roster missing the full-res arm, or an arm that moves two
 * levers, prints a complete table that answers a different question.
 *
 * @param {ReadonlyArray<{name: string, cap: number | string, halfRes: boolean, relief: string, clouds: string}>} arms
 * @returns {string | null}
 */
export function closeDetailArmsRefusal(arms) {
	const names = arms.map((a) => a.name);
	const twice = names.find((n, i) => names.indexOf(n) !== i);
	if (twice) return `arm "${twice}" is listed twice`;
	const base = arms.find((a) => a.name === "interim");
	if (!base) return "no interim arm: every other arm is read against it";
	for (const cap of CAP_LADDER)
		if (!arms.some((a) => a.cap === cap))
			return `the cap ladder has no arm at cap ${cap}`;
	for (const name of ["full-res", "analytic-gradient", "clouds-at-ground"])
		if (!arms.some((a) => a.name === name))
			return `no ${name} arm: node #720 names it as a cost arm`;
	for (const arm of arms) {
		if (arm === base) continue;
		const moved = ["cap", "halfRes", "relief", "clouds"].filter(
			(k) => arm[k] !== base[k],
		);
		if (moved.length !== 1)
			return `arm "${arm.name}" moves ${moved.length} levers (${moved.join(", ") || "none"}) off interim; a delta is one lever's only if exactly one moved`;
	}
	return null;
}

/**
 * Every arm at every radius, once, in a seeded shuffled order in which no arm
 * runs twice in a row.
 *
 * A fixed nest runs the last arm on the hottest machine and a block of one arm
 * pools whatever drift happens inside it (`lib/measurement.mjs`). Shuffling
 * breaks that; refusing adjacent repeats makes the interleaving a property of
 * the order rather than a likelihood. Resampling stays deterministic because
 * the shuffler is one seeded stream.
 *
 * @param {number} seed printed by the caller
 * @param {ReadonlyArray<{name: string}>} arms
 * @param {ReadonlyArray<number>} radii
 * @returns {{arm: string, radii: number}[]}
 */
export function sweepOrder(seed, arms, radii) {
	if (!Number.isInteger(seed))
		throw new Error(`the order seed must be an integer, got ${seed}`);
	if (arms.length < 2)
		throw new Error(
			"fewer than two arms: there is nothing to interleave, and a one-arm sweep is a block",
		);
	const cells = arms.flatMap((a) =>
		radii.map((r) => ({ arm: a.name, radii: r })),
	);
	const shuffle = seededShuffler(seed);
	for (let attempt = 0; attempt < 100000; attempt++) {
		const order = shuffle(cells);
		if (order.every((c, i) => i === 0 || c.arm !== order[i - 1].arm))
			return order;
	}
	throw new Error(
		`no order of ${arms.length} arms over ${radii.length} radii avoids a repeat from seed ${seed}`,
	);
}

/**
 * `null` if the state read back from the page is the state the arm asked for,
 * a sentence naming the lever that is not.
 *
 * The page applies an arm through four doors (a cap override, the half-res
 * allowance, a pinned relief path, a cloud-footprint hook) and any of them can
 * be refused or overwritten by the frame loop without an error. A cell priced
 * on a state it is not in prints a complete row for the wrong arm, so the
 * read-back is the arm's proof.
 *
 * @param {{name: string, cap: number | string, halfRes: boolean, relief: string, clouds: string}} arm
 * @param {{quality: string, renderScale: number | string, interimCap: number, groundCap: number, cloudCap: number, halfResEngaged: boolean, surfacePath: string, hasCloudShell: boolean, cloudAngleRatio: number, halfResRatio: number}} seen
 * @returns {string | null}
 */
export function armLandedRefusal(arm, seen) {
	const who = `arm "${arm.name}"`;
	if (seen.quality !== "high")
		return `${who}: quality reads "${seen.quality}", not "high"; Low adds no octaves so no cell here prices the band`;
	if (seen.renderScale !== 1)
		return `${who}: the render scale reads ${seen.renderScale}, not 1; Auto or a reduced scale moves the buffer inside a cell`;
	const cap = arm.cap === "shipped" ? seen.interimCap : arm.cap;
	if (!(seen.groundCap === cap))
		return `${who}: the ground's cap reads ${seen.groundCap}, not ${cap}`;
	if (!seen.hasCloudShell)
		return `${who}: the subject has no cloud shell, so the cloud lever prices nothing`;
	if (!(seen.cloudCap === cap))
		return `${who}: the cloud shell's cap reads ${seen.cloudCap} while the ground's is ${cap}; cloud and ground share one cap`;
	if (arm.halfRes && !seen.halfResEngaged)
		return `${who}: the ground is not drawn at half resolution, so this is not the shipped half-res state`;
	if (!arm.halfRes && seen.halfResEngaged)
		return `${who}: the ground is still drawn at half resolution, so this is not the full-res arm`;
	if (seen.surfacePath !== arm.relief)
		return `${who}: the subject is drawn with "${seen.surfacePath}", not ${arm.relief}`;
	if (arm.clouds === "at-ground") {
		if (!seen.halfResEngaged)
			return `${who}: with the ground at full resolution its footprint is the clouds' own, so the arm is the extended arm under another name; it needs the half-res ground`;
		if (!(Math.abs(seen.cloudAngleRatio - seen.halfResRatio) < 0.05))
			return `${who}: the clouds' pixel angle is ${seen.cloudAngleRatio}x their own, not the ground's footprint (${seen.halfResRatio}x)`;
	} else if (!(Math.abs(seen.cloudAngleRatio - 1) < 0.001))
		return `${who}: the clouds read ${seen.cloudAngleRatio}x their own footprint; an extended arm leaves them at 1x`;
	return null;
}

/**
 * The lane's name, or a throw: the band is priced on the player's GPU or not at
 * all.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function laneOf(env) {
	if (env.SEELITE_PROBE_RENDERER !== "hardware")
		throw new Error(
			"the close-detail sweep runs on the GPU lane: set SEELITE_PROBE_RENDERER=hardware. CPU figures do not price this",
		);
	return "GPU lane (SEELITE_PROBE_RENDERER=hardware, headed)";
}

/**
 * The build a dev server declared, as a string a figure can carry. A dirty tree
 * is marked, since a SHA that does not describe the code is a false citation.
 *
 * @param {{head?: string, dirty?: boolean} | null | undefined} tree
 * @returns {string}
 */
export function buildShaOf(tree) {
	if (!tree?.head)
		throw new Error(
			"the server's tree declaration carries no head: a figure without a build SHA cannot be cited",
		);
	return tree.dirty ? `${tree.head}+dirty` : tree.head;
}

const IDENTITY_FIELDS = ["renderer", "pixelRatio", "buildSha", "lane"];

/**
 * Renderer, pixel ratio, build SHA and lane on one line, or a throw naming the
 * one that is missing.
 *
 * @param {{renderer?: string, pixelRatio?: number, buildSha?: string, lane?: string}} identity
 * @returns {string}
 */
export function identityLine(identity) {
	for (const field of IDENTITY_FIELDS)
		if (identity[field] === undefined || identity[field] === "")
			throw new Error(`a figure must name its ${field}; this one carries none`);
	return `${identity.renderer} | pixel ratio ${identity.pixelRatio} | build ${identity.buildSha} | ${identity.lane}`;
}

/**
 * Put the identity on every row, so a cell lifted out of the JSON still names
 * where it was read.
 *
 * @template {object} Row
 * @param {Row[]} rows
 * @param {{renderer?: string, pixelRatio?: number, buildSha?: string, lane?: string}} identity
 * @returns {(Row & {renderer: string, buildSha: string, lane: string})[]}
 */
export function stampRows(rows, identity) {
	identityLine(identity);
	return rows.map((r) => ({
		...r,
		renderer: identity.renderer,
		buildSha: identity.buildSha,
		lane: identity.lane,
	}));
}

/**
 * One arm's cell minus another's at a radius, in ms. A missing cell throws.
 *
 * @param {ReadonlyArray<{arm: string, radii: number, ms: number}>} rows
 * @param {string} arm
 * @param {string} versus
 * @param {number} radii
 * @returns {number}
 */
export function armDelta(rows, arm, versus, radii) {
	const at = (name) => {
		const row = rows.find((r) => r.arm === name && r.radii === radii);
		if (!row) throw new Error(`no ${name} cell at ${radii} radii`);
		return finite(`${name} at ${radii} radii`, row.ms);
	};
	return at(arm) - at(versus);
}

/**
 * `interim` minus `cap-6` at each radius: two cells of one state, so the gap is
 * the instrument's own disagreement and the floor under every other delta.
 *
 * @param {ReadonlyArray<{arm: string, radii: number, ms: number}>} rows
 * @param {ReadonlyArray<number>} radii
 * @returns {Record<number, number>}
 */
export function controlPairGap(rows, radii) {
	return Object.fromEntries(
		radii.map((r) => [r, armDelta(rows, "interim", "cap-6", r)]),
	);
}

/**
 * The gap between two sweeps' reading of every cell. The sweeps must hold the
 * same cells; a comparison across different rosters would pair strangers.
 *
 * @param {ReadonlyArray<{arm: string, radii: number, pixelRatio: number, ms: number}>} a
 * @param {ReadonlyArray<{arm: string, radii: number, pixelRatio: number, ms: number}>} b
 * @returns {{arm: string, radii: number, pixelRatio: number, aMs: number, bMs: number, gapMs: number}[]}
 */
export function sweepAgreement(a, b) {
	const key = (r) => `${r.pixelRatio}|${r.arm}|${r.radii}`;
	const bByKey = new Map(b.map((r) => [key(r), r]));
	if (a.length !== b.length || a.some((r) => !bByKey.has(key(r))))
		throw new Error("the two sweeps do not hold the same cells");
	return a.map((r) => {
		const other = bByKey.get(key(r));
		return {
			arm: r.arm,
			radii: r.radii,
			pixelRatio: r.pixelRatio,
			aMs: finite(key(r), r.ms),
			bMs: finite(key(r), other.ms),
			gapMs: Math.abs(r.ms - other.ms),
		};
	});
}

/**
 * How far a cell's readings moved between its first two and its last two, as a
 * fraction of the lower of the two means.
 *
 * Node #758's first sweeps showed cells whose opening readings were the
 * preceding cell's cost and whose closing readings were their own: 27.9, 27.2,
 * 22.0, 14.0, 13.9 after a 25.8 ms cell. The settle had passed on two readings
 * still at the old level. A median of five cannot recover a cell that spends
 * three readings in the previous state, so the trend is measured and the cell
 * read again.
 *
 * @param {ReadonlyArray<number>} samplesMs five readings, in the order taken
 * @returns {number}
 */
export function cellTrend(samplesMs) {
	if (samplesMs.length !== 5)
		throw new Error(
			`a cell's trend is read off five readings, got ${samplesMs.length}`,
		);
	const ms = samplesMs.map((v) => finite("trend reading", v));
	const head = (ms[0] + ms[1]) / 2;
	const tail = (ms[3] + ms[4]) / 2;
	return Math.abs(head - tail) / Math.min(head, tail);
}

/**
 * The trend past which a cell is read again. Set from the first protocol's
 * 160 cells: steady cells reached 0.25; three predecessor tails read 0.68,
 * 0.97 and 1.62. Later runs overlap this initial gap: accepted trends reach
 * 0.39, and a spike and a decay triggered re-reads at 0.46 and 0.49. This is a
 * sampling heuristic, not a classifier of predecessor tails.
 */
export const CELL_TREND_LIMIT = 0.4;
