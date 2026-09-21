/**
 * What the sky a player standing in this galaxy would actually see looks like,
 * and what it costs to draw.
 *
 * `bun scripts/measure-sky-density.ts [mode]`
 *
 *   sky     the distance and brightness-spread figures, over every system of
 *           every galaxy of `SEEDS` worlds — the numbers the derived points
 *           layer is sized from (#431), including how much of a sky each of
 *           `backdrop.ts`'s two size clamps actually catches
 *   band    the elevation histogram against a uniform sphere, and the density
 *           inside the band and outside it, beside the invented layer's
 *   core    how tightly the other systems cluster around the way to the centre
 *   grain   the invented layer's size moments before and after #431's invariant,
 *           in world units and in pixels at a stated canvas height and scale
 *   cost    what `systemField` costs on arrival, what it allocates in bytes, and
 *           the whole galaxy's worth
 *
 * ## Nothing here re-derives a bearing or a size
 *
 * The distances are `sub` over the shipped positions; the `cost` mode calls the
 * shipped `systemField` rather than a copy of it, and the clamp figures call the
 * shipped `brightSizeLy`. The elevation and core-cone angles are read in the
 * **Galactic frame** — the band is a property of where the systems are, and #430's
 * per-system rotation only turns the whole picture without changing any of these
 * angles. Which also means no row here can be evidence *about* that rotation: a
 * statistic built to be invariant to a transform cannot test it. §12 of
 * `galaxy-generation.md` says where the transform is actually held.
 *
 * ## Why an instrument rather than a figure copied from #100
 *
 * [#100](https://github.com/jcfischer/seelite/issues/100) ruled the bright layer
 * derived and cited 255 points and a spread in magnitudes. Those figures are
 * read here off the shipped generator instead, because a figure whose instrument
 * is gone cannot be rechecked when the generator moves — and the generator has
 * moved since #100 closed: `GALAXY_RADIUS_LY` is 24.53, solved in #107, and #100
 * predates that solve. It also quoted a "median 21.1 ly" beside a "mean 5.45"
 * with no statement of which distance either was, which is the reason the rows
 * below say *nearest*, *median* and *farthest* on every line.
 *
 * ## Every printed figure is guarded
 *
 * Per the map's constraint that a measurement instrument must fail loudly.
 */

import {
	BRIGHT_CEILING_LY,
	FAINT_SIZE_MIN,
	FAINT_SIZE_SPAN,
	BRIGHT_FLOOR_LY,
	BRIGHT_SIZE_K,
	BRIGHT_SIZE_MAX,
	BRIGHT_SIZE_MIN,
	FAINT_COUNT,
	brightSizeLy,
	systemField,
} from "../src/backdrop";
import {
	GALAXY_COUNT,
	SYSTEMS_PER_GALAXY,
	type SystemRecord,
	generateGalaxy,
} from "../src/galaxy";
import { GALACTIC_NORMAL } from "../src/galaxy-frame";
import { type Vec3, dot, lengthSq, normalizeOr, sub } from "../src/vec3";

/** Worlds to sweep. Eight galaxies × 256 systems × this, so 40 seeds is ~82k
 *  observers — the scale #100 quoted, chosen to be comparable rather than
 *  because it is special. */
const SEEDS = 40;

/** Whole-sphere solid angle in square degrees. */
const SPHERE_SQ_DEG = 41252.96;

/** The naked-eye count #100 compared the derived layer against. */
const EARTH_NAKEDEYE = 145;

/** Throw rather than print a non-finite figure.
 *
 * Every row in this file goes through it, or through `fig` beside. A printed
 * `NaN` reads like a result, and the map's constraint on an instrument is that it
 * fails loudly rather than printing a plausible blank.
 */
function finite(label: string, x: number): number {
	if (!Number.isFinite(x))
		throw new Error(`measure-sky-density: ${label} is not finite (${x})`);
	return x;
}

/** Throw rather than print a non-finite figure, then format it.
 *
 * One helper rather than `finite(label, x).toFixed(n)` about twenty times inside
 * template literals: the expression is the guard, and a guard typed by hand
 * twenty times is a guard missing in twenty places. A printed `NaN` reads like a
 * result; a thrown label says which quantity went non-finite.
 */
function fig(label: string, x: number, digits = 2): string {
	return finite(label, x).toFixed(digits);
}

/** A copy sorted ascending, once. Every quantile below reads this copy. */
function sortedCopy(xs: number[], label: string): number[] {
	if (xs.length === 0) throw new Error(`measure-sky-density: no ${label}`);
	return [...xs].sort((a, b) => a - b);
}

/** The median of an *already sorted* array. */
function medianOf(sorted: number[], label: string): number {
	const mid = sorted.length >> 1;
	return finite(
		label,
		sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
	);
}

function median(xs: number[], label = "median"): number {
	return medianOf(sortedCopy(xs, label), label);
}

/** min / mean / median / max as one line. */
function summarize(label: string, xs: number[], unit = ""): string {
	const s = sortedCopy(xs, label);
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return `${label.padEnd(28)} n=${String(xs.length).padStart(7)}  min ${fig(
		`${label} min`,
		s[0],
		3,
	)}  mean ${fig(`${label} mean`, mean, 3)}  median ${fig(
		`${label} median`,
		medianOf(s, `${label} median`),
		3,
	)}  max ${fig(`${label} max`, s[s.length - 1], 3)}${unit}`;
}

/** The value below which `p` of the sample lies. */
function quantile(xs: number[], p: number, label: string): number {
	const s = sortedCopy(xs, label);
	return finite(label, s[Math.min(s.length - 1, Math.floor(s.length * p))]);
}

/** Which of an observer's three readings a mode actually uses.
 *
 * The corpus is 81,920 observers × 255 points, so all three arrays at once is
 * ~63M numbers — over half a gigabyte resident — and `sky` has never read an
 * elevation nor `band` a distance. So a mode names what it reads and the rest is
 * never built.
 */
interface SkyNeeds {
	dists?: boolean;
	elevations?: boolean;
	coreCone?: boolean;
}

/** One observer's sky, reduced to what the calling mode asked for. */
interface ObserverSky {
	dists: number[];
	elevAbs: number[];
	fromCore: number[];
	observerRadiusLy: number;
}

const EMPTY: number[] = [];

function observerSky(
	systems: readonly SystemRecord[],
	observer: SystemRecord,
	needs: SkyNeeds,
): ObserverSky {
	const dists: number[] = needs.dists ? [] : EMPTY;
	const elevAbs: number[] = needs.elevations ? [] : EMPTY;
	const fromCore: number[] = needs.coreCone ? [] : EMPTY;
	// The centre is the origin (§3's density law is centred there), so the way in
	// is the negated position. An observer standing exactly at the centre has no
	// such direction; the generator ships none, and the guard below says so.
	const coreDir = normalizeOr(
		sub({ x: 0, y: 0, z: 0 }, observer.pos),
		GALACTIC_NORMAL,
	);
	if (lengthSq(observer.pos) < 1e-12)
		throw new Error("measure-sky-density: an observer sits at the centre");
	for (const other of systems) {
		// A system cannot see itself. `skyBearing` already refuses the zero
		// difference; skipping it here keeps that refusal out of the counts
		// rather than turning it into a `null` to filter.
		if (other.index === observer.index) continue;
		const delta = sub(other.pos, observer.pos);
		const d = Math.sqrt(lengthSq(delta));
		if (needs.dists) dists.push(finite("distance", d));
		const unit: Vec3 = { x: delta.x / d, y: delta.y / d, z: delta.z / d };
		if (needs.elevations) {
			// Clamped, because this is a dot product of unit vectors and a unit
			// vector computed by dividing can come back at 1+1e-16. `asin` of that
			// is NaN, and NaN is not caught by `finite`: it is simply never `<=` a
			// threshold, so the point silently leaves the count. The cone arm
			// below has always clamped; this one had not.
			const sinLat = finite("sinLat", dot(unit, GALACTIC_NORMAL));
			elevAbs.push(Math.abs(Math.asin(Math.max(-1, Math.min(1, sinLat)))));
		}
		if (needs.coreCone)
			fromCore.push(Math.acos(Math.max(-1, Math.min(1, dot(unit, coreDir)))));
	}
	return {
		dists,
		elevAbs,
		fromCore,
		observerRadiusLy: finite(
			"observer radius",
			Math.sqrt(lengthSq(observer.pos)),
		),
	};
}

/**
 * Every observer of every world, handed to `consume` and then forgotten.
 *
 * Not `sweep(): ObserverSky[]`: holding the corpus was the first thing this
 * instrument did, and it cost more memory than the numbers printed were worth.
 * Each mode accumulates the handful of figures it prints as it goes, which is
 * also why no mode has to filter a 21M-element array to get a count.
 */
function sweep(
	needs: SkyNeeds,
	consume: (sky: ObserverSky, world: number, galaxy: number) => void,
): number {
	let observers = 0;
	for (let seed = 1; seed <= SEEDS; seed++)
		for (let g = 0; g < GALAXY_COUNT; g++) {
			const galaxy = generateGalaxy(seed * 7919, g);
			for (const record of galaxy.systems) {
				consume(observerSky(galaxy.systems, record, needs), seed, g);
				observers++;
			}
		}
	if (observers === 0) throw new Error("measure-sky-density: empty sweep");
	return observers;
}

/** Every observer sees every other system: the count is fixed, so the only
 *  question is whether the sweep actually swept. */
function assertPointCount(count: number, label: string): number {
	if (count !== SYSTEMS_PER_GALAXY - 1)
		throw new Error(
			`measure-sky-density: expected ${SYSTEMS_PER_GALAXY - 1} other systems in a sky, saw ${count} (${label})`,
		);
	return count;
}

/** The distance census of one observer: how many of its 255 fall inside each
 *  ring, and how many of them the shipped size law flattens at either clamp. */
interface DistanceCensus {
	rings: number[];
	atCeiling: number;
	atFloor: number;
	minDistance: number;
}

const RING_LY = [2, 5, 10, 20, 40];

function census(dists: readonly number[], into: DistanceCensus): void {
	for (const d of dists) {
		if (d < into.minDistance) into.minDistance = d;
		for (let i = 0; i < RING_LY.length; i++)
			if (d <= RING_LY[i]) into.rings[i]++;
		// Read off the shipped law rather than against the distances the clamps
		// were chosen at: a ceiling nobody reaches and a floor everybody hits are
		// both a law that is not the one being drawn.
		const size = brightSizeLy(d);
		if (size === BRIGHT_SIZE_MAX) into.atCeiling++;
		else if (size === BRIGHT_SIZE_MIN) into.atFloor++;
	}
}

function freshCensus(): DistanceCensus {
	return {
		rings: RING_LY.map(() => 0),
		atCeiling: 0,
		atFloor: 0,
		minDistance: Number.POSITIVE_INFINITY,
	};
}

function modeSky(): void {
	const nearest: number[] = [];
	const farthest: number[] = [];
	const mid: number[] = [];
	const magSpread: number[] = [];
	const censusAll = freshCensus();
	let observers = 0;
	sweep({ dists: true }, (sky) => {
		assertPointCount(sky.dists.length, "sky mode");
		nearest.push(Math.min(...sky.dists));
		farthest.push(Math.max(...sky.dists));
		mid.push(median(sky.dists, "mid"));
		// A star's flux goes as 1/d² and the magnitude scale is 2.5·log10 of a
		// flux ratio, so an inverse-square sky spans 5·log10(d_far/d_near)
		// magnitudes with no tuning dial at all.
		magSpread.push(
			finite(
				"magnitude spread",
				5 *
					Math.log10(
						Math.max(...sky.dists) / Math.max(Math.min(...sky.dists), 1e-9),
					),
			),
		);
		census(sky.dists, censusAll);
		observers++;
	});
	const points = SYSTEMS_PER_GALAXY - 1;
	const total = observers * points;

	console.log(
		`observers: ${observers} across ${SEEDS} worlds × ${GALAXY_COUNT} galaxies`,
	);
	console.log(
		`points: ${points}  (${fig(
			"density",
			(points / SPHERE_SQ_DEG) * 1000,
		)} per 1000 sq deg, against Earth's naked-eye ${fig(
			"earth density",
			(EARTH_NAKEDEYE / SPHERE_SQ_DEG) * 1000,
		)})`,
	);
	console.log(summarize("nearest other system ly", nearest));
	console.log(summarize("median separation ly", mid));
	console.log(summarize("farthest system ly", farthest));
	console.log(summarize("inverse-square spread mag", magSpread));

	// How many of the 255 a size law with a saturation ceiling would saturate.
	// A sky's *nearest* few are the ones the eye reads as bright, so a ceiling
	// that bites past them is a ceiling that flattened the picture.
	for (let i = 0; i < RING_LY.length; i++)
		console.log(
			`   within ${String(RING_LY[i]).padStart(2)} ly: ${fig(
				`within ${RING_LY[i]}`,
				censusAll.rings[i] / observers,
			)} of the 255  (${fig(
				`share ${RING_LY[i]}`,
				censusAll.rings[i] / total,
				3,
			)} of all points)`,
		);

	console.log(
		`\nthe shipped size law: ${fig(
			"ceiling share",
			censusAll.atCeiling / total,
			4,
		)} of points saturate at the ceiling (${fig(
			"ceiling per sky",
			censusAll.atCeiling / observers,
		)} of the 255), ${fig(
			"floor share",
			censusAll.atFloor / total,
			4,
		)} sit on its floor (${fig(
			"floor per sky",
			censusAll.atFloor / observers,
		)} of the 255).`,
	);
	// Printed beside the shares, because a documented distance that is only ever
	// *written down* is one that goes stale silently: #431's first round quoted
	// two of them against constants that had already moved. The last row is in
	// world units rather than pixels on purpose — a px figure would need
	// `STAR_PIXEL_SCALE` from `main.ts`, and a script reading a renderer dial
	// across the Three.js boundary is how a documented px figure goes stale.
	console.log(
		`the clamps are at ${fig(
			"ceiling ly",
			BRIGHT_CEILING_LY,
		)} ly (size ${fig("ceiling size", BRIGHT_SIZE_MAX, 4)}) and ${fig(
			"floor ly",
			BRIGHT_FLOOR_LY,
		)} ly (size ${fig("floor size", BRIGHT_SIZE_MIN, 4)}); the closest pair in ` +
			`the corpus is ${fig("min distance", censusAll.minDistance, 3)} ly, whose ` +
			`unclamped size would be ${fig(
				"unclamped size",
				BRIGHT_SIZE_K / censusAll.minDistance,
				3,
			)} — ${fig(
				"unclamped multiple",
				BRIGHT_SIZE_K / censusAll.minDistance / BRIGHT_SIZE_MAX,
				0,
			)}× the ceiling.`,
	);
	// Each quantile computed once and read twice, with a label that would name it
	// in a throw rather than "r" and "r2".
	const p01Near = quantile(nearest, 0.01, "1%ile nearest");
	const p99Far = quantile(farthest, 0.99, "99%ile farthest");
	console.log(
		`\nthe size law reads distance, so these are its inputs: 1%ile nearest ${fig(
			"1%ile nearest",
			p01Near,
		)} ly, 99%ile farthest ${fig("99%ile farthest", p99Far)} ly — a ${fig(
			"span",
			p99Far / p01Near,
			1,
		)}:1 span of 1/d, which is what the clamps are asked to cut.`,
	);
}

/** The band thresholds, in degrees, and the counts they collect. */
const BAND_DEG = [5, 10, 20, 30];

function modeBand(): void {
	console.log(
		`arm check: a two-sided band of ±30° is ${fig(
			"arm check",
			bandArm(30),
			6,
		)} of a uniform sphere`,
	);
	// Counted in one pass, in per-group buckets. `modeSky`'s own comment refuses
	// seven passes over a 21M corpus, and the first version of this mode did
	// exactly that — five passes, one of them an exact repeat of a row already
	// printed. The buckets are what make the excess *checkable* rather than
	// merely printed: pooled over 81,920 observers a share has no spread, and
	// "agrees with #100 inside seed noise" is a sentence about a spread.
	const perWorld = new Map<number, { inBand: number; total: number }>();
	let total = 0;
	let observers = 0;
	const counts = BAND_DEG.map(() => 0);
	const bandDeg = 20;
	const bandIndex = BAND_DEG.indexOf(bandDeg);
	sweep({ elevations: true }, (sky, world) => {
		assertPointCount(sky.elevAbs.length, "band mode");
		const group = perWorld.get(world) ?? { inBand: 0, total: 0 };
		for (const e of sky.elevAbs) {
			for (let i = 0; i < BAND_DEG.length; i++)
				if (e <= (BAND_DEG[i] * Math.PI) / 180) counts[i]++;
			if (e <= (bandDeg * Math.PI) / 180) group.inBand++;
		}
		group.total += sky.elevAbs.length;
		perWorld.set(world, group);
		total += sky.elevAbs.length;
		observers++;
	});
	console.log(
		`points: ${total}  (${fig("mean per observer", total / observers, 1)} each)`,
	);
	for (let i = 0; i < BAND_DEG.length; i++) {
		// A uniform sphere puts sin θ of its points inside a *two-sided* band of
		// ±θ: the zone between latitudes ±θ has area 2·sin θ·2π against the
		// sphere's 4π. A band excess of 1.00 is no band at all.
		const uniform = bandArm(BAND_DEG[i]) * total;
		console.log(
			`|elevation| <= ${String(BAND_DEG[i]).padStart(2)}°  share ${fig(
				"band share",
				counts[i] / total,
				3,
			)}  uniform ${fig("uniform share", uniform / total, 3)}  excess ×${fig(
				"band excess",
				counts[i] / uniform,
			)}`,
		);
	}

	const bandArea = bandArm(bandDeg) * SPHERE_SQ_DEG;
	const outArea = SPHERE_SQ_DEG - bandArea;
	const inBand = counts[bandIndex];
	// Once each, then read twice: the density rows and the outnumbering below are
	// the same two numbers, and computing them twice is two chances to write the
	// division out differently.
	const realIn = (inBand / observers / bandArea) * 1000;
	const realOut = ((total - inBand) / observers / outArea) * 1000;
	console.log(
		`\ndensity inside ±${bandDeg}°: ${fig("in band", realIn)} per 1000 sq deg\n` +
			`density outside it:      ${fig("out of band", realOut)} per 1000 sq deg`,
	);

	// The spread the "inside seed noise" claim needs. Each world is 8 galaxies ×
	// 256 observers, so this is the coarsest split that is still a sample of
	// *worlds* rather than of points; a claim that #100's figure and this one
	// agree has to say how far worlds move apart on their own.
	const excesses = [...perWorld.values()].map(
		(g) => g.inBand / g.total / bandArm(bandDeg),
	);
	console.log(
		`\n±${bandDeg}° excess per world (${perWorld.size} worlds): ${summarize(
			"per-world excess",
			excesses,
			"",
		)}`,
	);

	// The faint population is uniform over the sphere, so its density is the
	// same everywhere and can be compared against both rows above. This is the
	// figure that answers "does the band read as structure, or is it one more
	// uniform scatter?": inside the band the real points are outnumbered by how
	// much?
	//
	// The count is imported from the module that owns the layer, not restated
	// here — a third copy of a dial that ships somewhere else is the drift this
	// repo's own file warns about.
	const faintDensity = (FAINT_COUNT / SPHERE_SQ_DEG) * 1000;
	console.log(
		`\nfaint population at the shipped count (${FAINT_COUNT}): ${fig(
			"faint density",
			faintDensity,
		)} per 1000 sq deg\n` +
			`inside the band the invented outnumber the real ×${fig(
				"swamp ratio",
				faintDensity / realIn,
			)};  outside it ×${fig("swamp ratio out", faintDensity / realOut)}.\n` +
			`Number is not where the band survives; brightness is.`,
	);
}

/** The share of a uniform sphere inside a two-sided band of ±deg.
 *
 * The arm is checked before it is used, because the arm *is* the result. At ±30°
 * a uniform sphere has exactly **half** its points — `|sin lat| ≤ ½` is half a
 * sphere by symmetry — so an arm that does not say 0.500000 there is not a band
 * arm. This instrument first ran with the cone arm `1−cos θ` standing in this
 * place and printed ×7.68 at 20° where the honest reading is ×1.35; one line
 * catches that, and it runs at load rather than in a comment because the mistake
 * was made with a comment next to it.
 */
function bandArm(deg: number): number {
	return Math.sin((deg * Math.PI) / 180);
}
if (Math.abs(bandArm(30) - 0.5) > 1e-12)
	throw new Error(
		`measure-sky-density: the band arm is not a band arm (${bandArm(30)})`,
	);

function modeCore(): void {
	// Per observer rather than per point: every observer has exactly 255 of them,
	// so a mean of per-observer shares *is* the pooled share, and it costs 82k
	// numbers instead of 21M. The radius comes from the same pass, and the thirds
	// are cut afterwards because the outer radius is not known until the sweep
	// has run.
	const rows: { radius: number; meanAngle: number; coneShare: number }[] = [];
	sweep({ coreCone: true }, (sky) => {
		assertPointCount(sky.fromCore.length, "core mode");
		let sum = 0;
		let within20 = 0;
		for (const a of sky.fromCore) {
			sum += a;
			if (a <= (20 * Math.PI) / 180) within20++;
		}
		rows.push({
			radius: sky.observerRadiusLy,
			meanAngle: sum / sky.fromCore.length,
			coneShare: within20 / sky.fromCore.length,
		});
	});
	const maxR = Math.max(...rows.map((r) => r.radius));
	if (!(maxR > 0)) throw new Error("measure-sky-density: no observer radius");
	const thirds: Record<string, typeof rows> = {
		"core third": [],
		"middle third": [],
		"rim third": [],
	};
	for (const r of rows) {
		const t = r.radius / maxR;
		const key =
			t < 1 / 3 ? "core third" : t < 2 / 3 ? "middle third" : "rim third";
		thirds[key].push(r);
	}
	for (const [key, bucket] of Object.entries(thirds)) {
		if (bucket.length === 0) throw new Error(`measure-sky-density: no ${key}`);
		const mean = (pick: (r: (typeof bucket)[0]) => number) =>
			bucket.reduce((a, r) => a + pick(r), 0) / bucket.length;
		console.log(
			`${key}  n=${bucket.length}  ` +
				summarize(
					"mean angle to centre deg",
					bucket.map((r) => (r.meanAngle * 180) / Math.PI),
				),
		);
		console.log(
			`          other systems inside a 20° cone on the centre: ${fig(
				"cone share",
				mean((r) => r.coneShare),
				3,
			)} of them  (uniform sky: ${fig(
				"uniform cone",
				(1 - Math.cos((20 * Math.PI) / 180)) / 2,
				3,
			)})`,
		);
	}
}

/**
 * The invented layer's grain, in the units it is drawn in and in the pixels a
 * sheet shows.
 *
 * `bun scripts/measure-sky-density.ts grain [canvasHeight] [pixelScale]`
 *
 * The two laws are integrated in closed form rather than sampled: for
 * `min + span·u⁶` over a uniform `u`, the mean is `min + span/7`, the median is
 * `min + span/64`, and the mean of `size²` — the light an additive disc delivers
 * — is `min² + 2·min·span/7 + span²/13`. Sampling would only add noise to three
 * expressions a reader can check by hand.
 *
 * **The pixel conversion takes its dial as an argument, deliberately.**
 * `STAR_PIXEL_SCALE` lives in `main.ts`, behind a Three.js import this headless
 * tier may not cross; a copy of it in this file would be a fourth copy of a
 * renderer dial and one that goes stale the day the renderer moves. So a px row
 * names the canvas height and the scale it was taken at, and the world-unit rows
 * beside it need neither.
 */
function modeGrain(): void {
	const canvasHeight = Number(process.argv[3] ?? 900);
	const pixelScale = Number(process.argv[4] ?? 0.35);
	if (!(canvasHeight > 0) || !(pixelScale > 0))
		throw new Error(
			`measure-sky-density: grain wants a canvas height and a pixel scale, got ${process.argv[3]} and ${process.argv[4]}`,
		);
	const toPx = (size: number) => size * canvasHeight * pixelScale;

	/** One law's three moments. `flux` is E[size²], what an additive point buys. */
	const moments = (label: string, min: number, span: number) => {
		const mean = min + span / 7;
		const median = min + span / 64;
		const flux = min * min + (2 * min * span) / 7 + (span * span) / 13;
		console.log(
			`${label.padEnd(34)} max ${fig(
				`${label} max`,
				min + span,
				5,
			)}  mean ${fig(`${label} mean`, mean, 5)}  median ${fig(
				`${label} median`,
				median,
				5,
			)}  E[size²] ${fig(`${label} flux`, flux, 7)}`,
		);
		console.log(
			`${"".padEnd(34)} on a ${canvasHeight}-px canvas at scale ${pixelScale}: ` +
				`max ${fig(`${label} px max`, toPx(min + span), 1)} px  mean ${fig(
					`${label} px mean`,
					toPx(mean),
					1,
				)} px  median ${fig(`${label} px median`, toPx(median), 1)} px`,
		);
		return flux;
	};

	console.log(
		`the shipped band (FAINT_SIZE_MIN ${FAINT_SIZE_MIN}, span ${FAINT_SIZE_SPAN})`,
	);
	const now = moments("shipped", FAINT_SIZE_MIN, FAINT_SIZE_SPAN);
	// The law this node replaced, kept here as the comparison it is: a law that
	// is no longer shipped has no module left to print it, and the sentence
	// "the grain lost most of its light" needs both sides or it is an opinion.
	const before = moments("replaced (0.006 + 0.05·u⁶)", 0.006, 0.05);
	console.log(
		`\nlight per invented point, before ÷ after: ×${fig(
			"light ratio",
			before / now,
		)}  (median point: ÷${fig(
			"median ratio",
			(0.006 + 0.05 / 64) / (FAINT_SIZE_MIN + FAINT_SIZE_SPAN / 64),
		)})\n` +
			`so the light left with the **tail**, not with the grain. Whether that is ` +
			`still a night is #433's sheet, and the ceiling of both bands is what the ` +
			`invariant row in tests/backdrop.test.ts holds.`,
	);
}

function modeCost(): void {
	const galaxy = generateGalaxy(7919, 0);
	const systems = galaxy.systems;
	// Warm whatever caches the generator keeps, then time the call the game
	// actually makes on arrival — bearings, star-class draws, and the three
	// buffers, not the bearings alone.
	for (const r of systems) systemField(galaxy, r);
	const REPETITIONS = 1000;
	const t0 = performance.now();
	for (let i = 0; i < REPETITIONS; i++)
		systemField(galaxy, systems[i % systems.length]);
	const one = (performance.now() - t0) / REPETITIONS;

	const t1 = performance.now();
	for (const r of systems) systemField(galaxy, r);
	const all = performance.now() - t1;

	// Measured off a field the shipped call returned, not off an arithmetic
	// sketch of one: this node printed two different sizes for these three
	// buffers in two files and both were wrong, which is what a byte count is an
	// instrument for.
	const field = systemField(galaxy, systems[0]);
	const bytes =
		field.positions.byteLength +
		field.colors.byteLength +
		field.sizes.byteLength;

	if (!Number.isFinite(one) || one <= 0)
		throw new Error(`measure-sky-density: the cost did not compute (${one})`);
	console.log(
		`one arrival, ${SYSTEMS_PER_GALAXY - 1} points: ${fig(
			"one",
			one,
			4,
		)} ms over ${REPETITIONS} rebuilds` +
			`   [bun, headless — CPU arithmetic; the draw is 255 points and one more call]`,
	);
	console.log(
		`all ${systems.length} observers in one sweep: ${fig("all", all)} ms`,
	);
	console.log(
		`what an arrival allocates: ${bytes} bytes — positions ${fig(
			"positions bytes",
			field.positions.byteLength,
			0,
		)}, colours ${fig("colours bytes", field.colors.byteLength, 0)}, sizes ${fig(
			"sizes bytes",
			field.sizes.byteLength,
			0,
		)} — three typed arrays handed to the GPU and the previous three dropped.`,
	);
}

const MODES: Record<string, () => void> = {
	sky: modeSky,
	band: modeBand,
	grain: modeGrain,
	core: modeCore,
	cost: modeCost,
};

const mode = process.argv[2] ?? "sky";
const run = MODES[mode];
if (!run) {
	throw new Error(
		`measure-sky-density: unknown mode "${mode}" — expected one of ${Object.keys(
			MODES,
		).join(", ")}`,
	);
}
run();
