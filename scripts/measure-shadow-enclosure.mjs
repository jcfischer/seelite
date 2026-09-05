/**
 * What the sun's shadow is worth, as a function of **enclosure** — node #231's
 * missing measurement.
 *
 *   npm run dev                                # in one shell
 *   node scripts/measure-shadow-enclosure.mjs
 *
 * ## The claim this exists to test
 *
 * #201 shipped a fitted sun shadow map and closed with three figures: the
 * shadow darkens 0.003% of `station-flank`, 0.002% of `cockpit-arrival` and
 * 6.2% of `berth-free-look`. #231 reads that as *enclosure is the lever* — the
 * sun's intensity is a constant, so nothing about flying nearer the star
 * changes what a shadow can remove, and what differs between those three
 * frames is how much of the surrounding hemisphere is hull.
 *
 * **That is three numbers from one frame each, and it is exactly the shape that
 * turned out to be an artefact twice.** #200 published a 144/144 separation
 * that was its own arm ordering. #201 published 0.467% for `station-flank`
 * that was a relighting bug — with the shadow off, the sun's target was left at
 * the last fitted subject while its position was reset to a unit vector, so the
 * "off" arm was a differently-lit frame rather than an unshadowed one. Both
 * survived because nobody had a control.
 *
 * So this walks a **ladder** rather than sampling three points, and every rung
 * carries a control.
 *
 * ## The ladder
 *
 * Two segments of one physical journey, because enclosure has no dial:
 *
 * 1. **The approach.** Down a trade station's aperture axis at a descending
 *    range of silhouette radii. The ship is in open space and the station is
 *    ahead; nothing but the hull itself occludes anything.
 * 2. **The traversal.** Inside the bay, at fractions of the docking computer's
 *    run from the aperture plane to the berth. This is the enclosure ramp: at
 *    the end the camera is in a room.
 *
 * ## The x-axis is measured, not asserted
 *
 * The ladder's abscissa is **the journey**, and it needs no instrument: the
 * approach runs down a station's aperture axis from twenty silhouette radii to
 * 1.2, and the traversal runs from the aperture plane to a berth inside the
 * hull. That is monotonically more enclosed by construction, whatever any
 * measurement says.
 *
 * Each rung *also* reports what the ambient occlusion does to the same frame,
 * and **that column is a correlate, not a measurement of enclosure** — which is
 * the honest version of a claim this file made for a round. GTAO's radius is in
 * drawing-buffer pixels (`occlusion.ts`), so its screen coverage moves with
 * framing and with what happens to be on screen, not with blocked hemisphere
 * alone. It is worth printing because it moves with the journey and gives the
 * shadow column something to be flat against; it is not worth resting a
 * conclusion on, and none is rested on it.
 *
 * ## Every rung has a control, and it is the row to read first
 *
 * Each rung renders the baseline **twice** and differences those two frames
 * against each other. That is the noise floor: whatever the control reports is
 * what "no change at all" looks like through an eight-bit canvas readback, and
 * a shadow reading at or under it is not a reading. Without this row, 0.003% is
 * a number with no scale.
 *
 * ## Why the arms are shuffled
 *
 * Not for #200's reason — nothing here is timed, and the world does not advance
 * inside one `evaluate`, so a pixel difference is deterministic given the state.
 * The confound this shuffles out is **order-dependent renderer state**, which is
 * not hypothetical: enabling or disabling a composer pass changes how many
 * passes are enabled, and #201 measured 13.2% against a 6.6% baseline once
 * because the frame a toggle landed on composited out of the wrong buffer. If
 * an arm's reading depends on which arm preceded it, shuffling across repeats
 * makes it show up as spread instead of as a clean wrong answer.
 *
 * ## It drives the passes directly, on purpose
 *
 * `Game.setOcclusion(shadows, ao)` takes both terms explicitly, so this
 * measures the shadow whether or not the shipped gate has it on. #231 has it
 * gated off pending its own answer; that must not stop the instrument that
 * informs the answer from running.
 *
 * Gates on nothing it prints, like every other `measure-` script here (#98:
 * this game has no frame-time floor and no pixel floor either). It does refuse
 * to measure a dev server that is not this tree.
 */
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";
import { median, seededShuffler } from "./lib/measurement.mjs";
import {
	installViewFraming,
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
const STATION = "station-trade";
const BERTH = "overhead-near";

/** Repeats per rung. Five, so the spread printed beside each median is a range
 *  rather than a pair, and one bad frame cannot carry a row. */
const REPEATS = 5;

/**
 * How much the `bright` arm scales the sun by.
 *
 * Ten, which is far past anything #231 would actually ship — the point is not
 * to propose a rig but to make the question decidable. `LIGHT_RIG` gives the
 * sun 0.2 against a hemisphere of 6.85; at ten times that the sun is a quarter
 * of the scene's light instead of three percent.
 *
 * **What a zero here does and does not establish.** It is still a thresholded
 * read of an eight-bit canvas, so it cannot prove physical absence — a grazing
 * receiver taking a sliver of the sun can stay under the cut at any multiplier,
 * and saying otherwise was this file's claim for a round and was wrong twice in
 * the same shape. What it *does* establish is a bound, and the bound is tight
 * enough to decide with: a rung reading zero here has, at ten times the sun, no
 * pixel moved by more than 2/255 and a mean absolute change under half a code.
 * Whatever is there is at least fifty times smaller than the effect the node
 * wants. Report the bound; do not call it emptiness.
 */
const BRIGHT = 10;

/**
 * The rungs, outside then in.
 *
 * The approach distances are in silhouette radii and stop at 1.2 rather than at
 * the plane: `__viewAlongAxis` puts the camera on the axis at that range, and
 * inside the silhouette it would be inside the hull. The traversal fractions
 * pick up where that leaves off — `stopAtArrivalFraction` is measured over the
 * docking computer's run from the aperture plane to the berth, so 0 is the
 * mouth and 1 is parked.
 */
/**
 * **Both views at every rung, and that is not thoroughness — it is the only way
 * the exterior rows mean anything.**
 *
 * `fitShadowCamera` fits the box to the cabin alone in cockpit view and
 * excludes every station, which #201 shipped as a stated limit: the cabin is a
 * 30 m box at the camera and a station is a kilometre of structure some
 * kilometres away, and their union is the station. So a cockpit-view exterior
 * rung *cannot* show a shadow on a station however enclosed the frame is, and
 * a ladder that measured only that view would report a design decision as
 * though it were a property of enclosure. The first run of this instrument did
 * exactly that.
 */
const VIEWS = ["cockpit", "chase"];

const RUNGS = [
	{ kind: "approach", radii: 20 },
	{ kind: "approach", radii: 12 },
	{ kind: "approach", radii: 8 },
	{ kind: "approach", radii: 5 },
	{ kind: "approach", radii: 3 },
	{ kind: "approach", radii: 2 },
	{ kind: "approach", radii: 1.2 },
	{ kind: "traversal", at: 0 },
	{ kind: "traversal", at: 0.25 },
	{ kind: "traversal", at: 0.5 },
	{ kind: "traversal", at: 0.75 },
	{ kind: "traversal", at: 1 },
];

const label = (rung, view) =>
	`${
		rung.kind === "approach"
			? `approach ${String(rung.radii).padStart(4)} radii`
			: `bay traversal ${(rung.at * 100).toFixed(0).padStart(3)}%`
	} ${view.padEnd(7)}`;

/**
 * One rung's three differences, in a single evaluate.
 *
 * One evaluate because between two of them the frame loop runs, the station
 * spins and its orbit carries it — and that drift is larger than the effect
 * being measured. Everything below happens between `render` calls with nothing
 * else moving.
 *
 * The dither is switched off for the duration: it adds a per-pixel ±0.5/255 to
 * every frame, which is most of what any naive pixel comparison would find.
 */
const differences = (page, order) =>
	page.evaluate(
		([arms, bright]) => {
			const game = window.__seelite;
			// **The drawing buffer's own size, not a thumbnail.** This read into a
			// 480x300 scratch for a round, which averages four by three rendered
			// pixels into one before anything is thresholded — so a thin shadow,
			// or a grazing one, is diluted below the cut before it is counted,
			// and a zero could not distinguish "no shadow" from "a shadow this
			// readback blurred away". At native size a rendered pixel is a
			// sample.
			const source = game.renderer.domElement;
			const W = source.width;
			const H = source.height;
			// **Cached across samples.** At the drawing buffer's own size this is a
			// 1440x900 backing store, and a fresh one per sample is 120 of them per
			// run for an instrument whose whole job is to not perturb what it
			// measures. Resized only when the buffer changes.
			const held = (window.__ladderScratch ??= {});
			if (!held.canvas) held.canvas = document.createElement("canvas");
			if (held.canvas.width !== W || held.canvas.height !== H) {
				held.canvas.width = W;
				held.canvas.height = H;
				held.ctx = held.canvas.getContext("2d", { willReadFrequently: true });
			}
			const ctx = held.ctx;
			const dither = game.settings.value.dither;
			// Through the pass rather than the store: an instrument should not leave
			// a preference behind on the machine it measured.
			game.outputPass.setDither(false);
			const frame = (shadows, ao) => {
				game.setOcclusion(shadows, ao);
				// Twice. The first render after a pass is enabled or disabled is the
				// one that composites out of the previous parity's buffer, which is
				// the defect the shuffle above exists to expose rather than to hide.
				game.render(0);
				game.render(0);
				ctx.drawImage(source, 0, 0);
				const pixels = ctx.getImageData(0, 0, W, H).data;
				return pixels;
			};
			const sun = game.nearScene.getObjectByName("sun");
			const sunIntensity = sun.intensity;
			const taken = {};
			let texelKm = 0;
			for (const arm of arms) {
				if (arm === "base") taken.base = frame(false, false);
				if (arm === "control") taken.control = frame(false, false);
				if (arm === "shadow") {
					taken.shadow = frame(true, false);
					// **Read here and not at the end.** `shadowTexelKm` is whatever the
					// last fit wrote, and two of the arms below change what the box is
					// fitted to. Read after any other arm it could describe a different
					// subject from the percentage printed beside it.
					texelKm = game.shadowTexelKm;
				}
				if (arm === "ao") taken.ao = frame(false, true);
				// **#231's proposed fix, flown.** The blocker this arm answers: every
				// zero in this table comes through an 8-bit `getImageData`, so a real
				// shadow of 0.4 of a code reads as exactly nothing — and the whole
				// question is whether more light would reveal it. Rather than argue
				// about quantisation, scale the sun by `BRIGHT` and measure again. A
				// rung that lights up had a shadow under the readback all along; one
				// that does not is **bounded, not proved empty** — `BRIGHT` says
				// what the bound is worth. This comment claimed physical absence for
				// three review rounds: corrected once in the docstring and left
				// standing here and in the row note, twice over.
				if (arm === "bright") {
					sun.intensity = sunIntensity * bright;
					taken.brightBase = frame(false, false);
					taken.brightShadow = frame(true, false);
					sun.intensity = sunIntensity;
				}
			}
			game.setOcclusion();
			game.outputPass.setDither(dither === "on");

			const luma = (d, i) =>
				0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
			// **One scan, three callers.** The three delta helpers each carried
			// their own copy of the loop and the `delta < -2` cut, so a change to
			// the threshold or to what is counted had to be made three times and
			// kept aligned by hand.
			// **The base frame's luma is computed once and reused.** Three of the
			// four arms difference against the same baseline, so recomputing its
			// luma per arm evaluated it four times over 1.3 million pixels for
			// every one of 120 samples. The `bright` arm has its own baseline and
			// pays for one more.
			const lumaOf = (d) => {
				const out = new Float32Array(d.length / 4);
				for (let i = 0, j = 0; i < d.length; i += 4, j++)
					out[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
				return out;
			};
			const scanAgainst = (beforeLuma, after) => {
				if (!beforeLuma || !after)
					return { darkerPct: null, meanAbs: null, deepest: null };
				let darker = 0;
				let deepest = 0;
				let sum = 0;
				const pixels = beforeLuma.length;
				for (let i = 0, j = 0; j < pixels; i += 4, j++) {
					const delta =
						0.2126 * after[i] +
						0.7152 * after[i + 1] +
						0.0722 * after[i + 2] -
						beforeLuma[j];
					sum += Math.abs(delta);
					if (delta < -2) darker++;
					if (-delta > deepest) deepest = -delta;
				}
				return {
					darkerPct: (100 * darker) / pixels,
					meanAbs: sum / pixels,
					deepest,
				};
			};
			const baseLuma = lumaOf(taken.base);
			const scan = (before, after) =>
				before === taken.base
					? scanAgainst(baseLuma, after)
					: scanAgainst(before ? lumaOf(before) : null, after);
			const against = (later) => scan(taken.base, later);
			return {
				control: against(taken.control),
				shadow: against(taken.shadow),
				ao: against(taken.ao),
				bright: scan(taken.brightBase, taken.brightShadow),
				texelKm,
			};
		},
		[order, BRIGHT],
	);

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/occlusion.ts",
	"src/light-rig.ts",
]);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: VIEWPORT });
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
await page.evaluate((clock) => window.__startClockAt(clock), GAME_TIME_S);

// **Read off the scene, not off the record.** The ratio that decides what a
// shadow can remove is the one the renderer is actually using, and #201 has
// already been caught once quoting a record while the renderer did something
// else. These are the lights in the near layer.
const rig = await page.evaluate(() => {
	const near = window.__seelite.nearScene;
	return {
		sun: near.getObjectByName("sun")?.intensity ?? null,
		hemisphere: near.getObjectByName("hemisphere")?.intensity ?? null,
		fill: near.getObjectByName("fill")?.intensity ?? null,
		environment: near.environmentIntensity ?? null,
	};
});

const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20260905);
const shuffled = seededShuffler(ORDER_SEED);

console.log(`  seed ${SEED}, clock ${GAME_TIME_S}, ${STATION} / ${BERTH}`);
console.log(
	`  rig, read off the near scene: sun ${rig.sun}, hemisphere ${rig.hemisphere}, fill ${rig.fill}, environment ${rig.environment}`,
);
console.log(
	`  ${REPEATS} repeats per rung, arm order shuffled from seed ${ORDER_SEED}`,
);
console.log("");
console.log(
	"  `sun x" +
		BRIGHT +
		"` re-measures the shadow with the sun scaled — #231's own proposed fix,",
);
console.log(
	"  flown. A rung that lights up had a shadow under the eight-bit readback; one",
);
console.log(
	"  that does not is *bounded*, not proved empty — see BRIGHT's note.",
);
console.log("");
console.log(
	"  `control` is the baseline differenced against a second baseline — the noise",
);
console.log(
	"  floor. A shadow reading at or under it is not a reading. It is printed and",
);
console.log("  not merely computed, so a rerun can show the floor it cleared.");
console.log("");
console.log(
	"  `AO resp` is the ambient occlusion's own coverage on the same frame — a",
);
console.log(
	"  correlate of enclosure, not a measurement of it: GTAO's radius is in",
);
console.log(
	"  drawing-buffer pixels, so it moves with framing too. The ladder's abscissa",
);
console.log("  is the journey itself; nothing is concluded from this column.");
console.log("");
console.log(
	`  rung                            AO resp     shadow    control   mean|d|   sun x${BRIGHT}  bright|d|  box texel`,
);

const rows = [];
for (const rung of RUNGS) {
	if (rung.kind === "approach") {
		await page.evaluate(
			([id, radii]) =>
				window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
					comoving: true,
				}),
			[STATION, rung.radii],
		);
	} else {
		await page.evaluate(
			([id, berth, at]) =>
				window.__parkInBerth(id, berth, { stopAtArrivalFraction: at }),
			[STATION, BERTH, rung.at],
		);
	}
	await settleFrames(page);

	for (const view of VIEWS) {
		await setView(page, view);
		await settleFrames(page);
		const samples = [];
		for (let i = 0; i < REPEATS; i++) {
			// **`base` is always drawn first and the rest are shuffled after it.**
			// Everything is differenced against the baseline, so the baseline cannot
			// be one of the things whose order varies without changing what every
			// other arm means.
			samples.push(
				await differences(page, [
					"base",
					...shuffled(["control", "shadow", "ao", "bright"]),
				]),
			);
		}
		const of = (arm, field) => samples.map((s) => s[arm][field]);
		const row = {
			label: label(rung, view),
			ao: median(of("ao", "darkerPct")),
			shadow: median(of("shadow", "darkerPct")),
			control: median(of("control", "darkerPct")),
			shadowDeepest: median(of("shadow", "deepest")),
			bright: median(of("bright", "darkerPct")),
			brightMean: median(of("bright", "meanAbs")),
			// **Mean absolute change, which has no threshold, and it is the
			// number #231 actually needs.** A pixel counts as "darker" above
			// 2/255, and the sun is about 3% of the light — so a fully shadowed
			// surface at luma 60 moves 1.8 codes and is invisible to the
			// percentage columns while being perfectly real. A row reading
			// 0.000% with a non-zero mean is a shadow that more light would
			// reveal. A row where both are zero is **bounded and not empty**: this
			// cut ignores positive deltas and applies no threshold to the mean, so
			// it excludes a visible shadow and not a physical one.
			shadowMean: median(samples.map((x) => x.shadow.meanAbs)),
			// What the box was fitted to on the frame just drawn. The
			// non-monotone rows are not explicable without it: a shadow appears
			// when the box happens to hold a caster and a lit receiver, and
			// `shadowBox`'s admission rule decides that per frame.
			texelKm: median(samples.map((x) => x.texelKm)),
			shadowSpread: of("shadow", "darkerPct"),
		};
		rows.push(row);
		const pct = (v) =>
			v === null ? "     -  " : `${v.toFixed(3).padStart(7)}%`;
		console.log(
			`  ${row.label.padEnd(32)} ${row.ao.toFixed(2).padStart(7)}%  ${pct(
				row.shadow,
			)}  ${pct(row.control)}  ${row.shadowMean.toFixed(4).padStart(7)}  ${pct(
				row.bright,
			)}  ${row.brightMean.toFixed(4).padStart(8)}  ${(row.texelKm * 1000)
				.toFixed(1)
				.padStart(6)} m`,
		);
	}
}

console.log("");
console.log("  spreads, one line per rung (shadow % across the repeats):");
for (const row of rows)
	console.log(
		`  ${row.label.padEnd(32)} ${row.shadowSpread.map((x) => x.toFixed(3)).join(" ")}`,
	);
console.log("");
console.log("  deepest pixel the shadow moves, of 255:");
for (const row of rows)
	console.log(
		`  ${row.label.padEnd(32)} ${row.shadowDeepest.toFixed(1).padStart(6)}`,
	);

await browser.close();
