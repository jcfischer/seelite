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
 *   core    how tightly the neighbours cluster around the way to the centre
 *   cost    what `systemField` costs on arrival, and the whole galaxy's worth
 *
 * ## Nothing here re-derives a bearing or a size
 *
 * The distances are `sub` over the shipped positions; the `cost` mode calls the
 * shipped `systemField` rather than a copy of it, and the clamp figures call the
 * shipped `brightSizeLy`. The elevation and core-cone angles are read in **galaxy
 * space** — the band is a property of where the systems are, and #430's per-system
 * rotation only turns the whole picture without changing any of these angles.
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

/** Throw rather than print a non-finite figure. */
function finite(label: string, x: number): number {
	if (!Number.isFinite(x))
		throw new Error(`measure-sky-density: ${label} is not finite (${x})`);
	return x;
}

function sortedCopy(xs: number[], label: string): number[] {
	if (xs.length === 0) throw new Error(`measure-sky-density: no ${label}`);
	return [...xs].sort((a, b) => a - b);
}

function median(xs: number[], label = "median"): number {
	const s = sortedCopy(xs, label);
	const mid = s.length >> 1;
	return finite(label, s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** min / mean / median / max as one line. */
function summarize(label: string, xs: number[], unit = ""): string {
	const s = sortedCopy(xs, label);
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return `${label.padEnd(28)} n=${String(xs.length).padStart(7)}  min ${finite(
		`${label} min`,
		s[0],
	).toFixed(3)}  mean ${finite(`${label} mean`, mean).toFixed(
		3,
	)}  median ${median(xs, `${label} median`).toFixed(3)}  max ${finite(
		`${label} max`,
		s[s.length - 1],
	).toFixed(3)}${unit}`;
}

/** The value below which `p` of the sample lies. */
function quantile(xs: number[], p: number, label: string): number {
	const s = sortedCopy(xs, label);
	return finite(label, s[Math.min(s.length - 1, Math.floor(s.length * p))]);
}

/** One observer's sky, reduced to the figures every mode below reads. */
interface ObserverSky {
	/** Distance to every other system, light years. */
	dists: number[];
	/** |elevation| of every neighbour off the cluster's plane, radians. */
	elevAbs: number[];
	/** Angle of every neighbour away from the way to the cluster centre,
	 *  radians — the core cone. */
	fromCore: number[];
	/** How far the observer sits from the cluster centre, light years. */
	observerRadiusLy: number;
}

function observerSky(
	systems: readonly SystemRecord[],
	observer: SystemRecord,
): ObserverSky {
	const dists: number[] = [];
	const elevAbs: number[] = [];
	const fromCore: number[] = [];
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
		dists.push(finite("distance", d));
		const unit: Vec3 = { x: delta.x / d, y: delta.y / d, z: delta.z / d };
		const sinLat = finite("sinLat", dot(unit, GALACTIC_NORMAL));
		elevAbs.push(Math.abs(Math.asin(sinLat)));
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

function sweep(): ObserverSky[] {
	const skies: ObserverSky[] = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		for (let g = 0; g < GALAXY_COUNT; g++) {
			const galaxy = generateGalaxy(seed * 7919, g);
			for (const record of galaxy.systems)
				skies.push(observerSky(galaxy.systems, record));
		}
	}
	if (skies.length === 0) throw new Error("measure-sky-density: empty sweep");
	return skies;
}

/** Every observer sees every other system: the count is fixed, so the only
 *  question is whether the sweep actually swept. */
function assertPointCount(skies: ObserverSky[]): number {
	for (const s of skies) {
		if (s.dists.length !== SYSTEMS_PER_GALAXY - 1)
			throw new Error(
				`measure-sky-density: expected ${
					SYSTEMS_PER_GALAXY - 1
				} neighbours, saw ${s.dists.length}`,
			);
	}
	return SYSTEMS_PER_GALAXY - 1;
}

function modeSky(): void {
	const skies = sweep();
	const points = assertPointCount(skies);
	const nearest: number[] = [];
	const farthest: number[] = [];
	const mid: number[] = [];
	const magSpread: number[] = [];
	for (const s of skies) {
		const near = Math.min(...s.dists);
		const far = Math.max(...s.dists);
		nearest.push(near);
		farthest.push(far);
		mid.push(median(s.dists, "mid"));
		// A star's flux goes as 1/d² and the magnitude scale is 2.5·log10 of a
		// flux ratio, so an inverse-square sky spans 5·log10(d_far/d_near)
		// magnitudes with no tuning dial at all.
		magSpread.push(
			finite("magnitude spread", 5 * Math.log10(far / Math.max(near, 1e-9))),
		);
	}
	console.log(
		`observers: ${skies.length} across ${SEEDS} worlds × ${GALAXY_COUNT} galaxies`,
	);
	console.log(
		`points: ${points}  (${finite(
			"density",
			(points / SPHERE_SQ_DEG) * 1000,
		).toFixed(2)} per 1000 sq deg, against Earth's naked-eye ${finite(
			"earth density",
			(EARTH_NAKEDEYE / SPHERE_SQ_DEG) * 1000,
		).toFixed(2)})`,
	);
	console.log(summarize("nearest neighbour ly", nearest));
	console.log(summarize("median neighbour ly", mid));
	console.log(summarize("farthest neighbour ly", farthest));
	console.log(summarize("inverse-square spread mag", magSpread));

	// How many of the 255 a size law with a saturation ceiling would saturate.
	// A sky's *nearest* few are the ones the eye reads as bright, so a ceiling
	// that bites past them is a ceiling that flattened the picture.
	const all: number[] = [];
	for (const s of skies) all.push(...s.dists);
	for (const r of [2, 5, 10, 20, 40]) {
		const n = all.filter((d) => d <= r).length;
		console.log(
			`   within ${String(r).padStart(2)} ly: ${finite(
				`within ${r}`,
				n / skies.length,
			).toFixed(2)} of the 255  (${finite(`share ${r}`, n / all.length).toFixed(
				3,
			)} of all points)`,
		);
	}

	// What the two clamps in `backdrop.ts` actually bite, on the shipped law
	// rather than on the distances they were chosen at. A ceiling nobody reaches
	// and a floor everybody hits are both a law that is not the one being drawn.
	const atCeiling = all.filter(
		(d) => brightSizeLy(d) === BRIGHT_SIZE_MAX,
	).length;
	const atFloor = all.filter((d) => brightSizeLy(d) === BRIGHT_SIZE_MIN).length;
	const perSky = (n: number) => n / skies.length;
	console.log(
		`\nthe shipped size law: ${finite(
			"ceiling share",
			atCeiling / all.length,
		).toFixed(4)} of points saturate at the ceiling ` +
			`(${finite("ceiling per sky", perSky(atCeiling)).toFixed(2)} of the 255), ` +
			`${finite("floor share", atFloor / all.length).toFixed(4)} sit on its ` +
			`floor (${finite("floor per sky", perSky(atFloor)).toFixed(2)} of the 255).`,
	);
	console.log(
		`\nthe size law reads distance, so these are its inputs: 1%ile nearest ${quantile(
			nearest,
			0.01,
			"1%ile nearest",
		).toFixed(2)} ly, 99%ile farthest ${quantile(
			farthest,
			0.99,
			"99%ile farthest",
		).toFixed(2)} ly — a ${(
			quantile(farthest, 0.99, "r") / quantile(nearest, 0.01, "r2")
		).toFixed(1)}:1 span of 1/d, which is what the clamps are asked to cut.`,
	);
}

function modeBand(): void {
	const skies = sweep();
	assertPointCount(skies);
	const total = skies.length * (SYSTEMS_PER_GALAXY - 1);
	const within = (deg: number) => {
		const rad = (deg * Math.PI) / 180;
		let n = 0;
		for (const s of skies) for (const e of s.elevAbs) if (e <= rad) n++;
		return n;
	};
	console.log(
		`points: ${total}  (${finite(
			"mean per observer",
			total / skies.length,
		).toFixed(1)} each)`,
	);
	for (const deg of [5, 10, 20, 30]) {
		const got = within(deg);
		// A uniform sphere puts 1−cos θ of its points inside an elevation band of
		// ±θ. That is the arm: a band excess of 1.00 is no band at all.
		const uniform = (1 - Math.cos((deg * Math.PI) / 180)) * total;
		console.log(
			`|elevation| <= ${String(deg).padStart(2)}°  share ${finite(
				"band share",
				got / total,
			).toFixed(3)}  uniform ${finite("uniform share", uniform / total).toFixed(
				3,
			)}  excess ×${finite("band excess", got / uniform).toFixed(2)})`,
		);
	}
	const bandDeg = 20;
	const inBand = within(bandDeg);
	const bandArea = (1 - Math.cos((bandDeg * Math.PI) / 180)) * SPHERE_SQ_DEG;
	const outArea = SPHERE_SQ_DEG - bandArea;
	console.log(
		`\ndensity inside ±${bandDeg}°: ${finite(
			"in band",
			(inBand / skies.length / bandArea) * 1000,
		).toFixed(2)} per 1000 sq deg\n` +
			`density outside it:      ${finite(
				"out of band",
				((total - inBand) / skies.length / outArea) * 1000,
			).toFixed(2)} per 1000 sq deg`,
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
	const realIn = (inBand / skies.length / bandArea) * 1000;
	const realOut = ((total - inBand) / skies.length / outArea) * 1000;
	console.log(
		`\nfaint population at the shipped count (${FAINT_COUNT}): ${finite(
			"faint density",
			faintDensity,
		).toFixed(2)} per 1000 sq deg\n` +
			`inside the band the invented outnumber the real ×${finite(
				"swamp ratio",
				faintDensity / realIn,
			).toFixed(2)};  outside it ×${finite(
				"swamp ratio out",
				faintDensity / realOut,
			).toFixed(2)}.\n` +
			`Number is not where the band survives; brightness is.`,
	);
}

function modeCore(): void {
	const skies = sweep();
	assertPointCount(skies);
	const maxR = Math.max(...skies.map((s) => s.observerRadiusLy));
	const buckets: Record<string, number[]> = {};
	const coneShares: Record<string, number[]> = {};
	for (const s of skies) {
		const t = s.observerRadiusLy / maxR;
		const key =
			t < 1 / 3 ? "core third" : t < 2 / 3 ? "middle third" : "rim third";
		(buckets[key] ??= []).push(...s.fromCore);
		const deg = s.fromCore.map((a) => (a * 180) / Math.PI);
		(coneShares[key] ??= []).push(
			deg.filter((a) => a <= 20).length / deg.length,
		);
	}
	for (const key of ["core third", "middle third", "rim third"]) {
		const xs = buckets[key];
		if (!xs) throw new Error(`measure-sky-density: empty bucket ${key}`);
		const shares = coneShares[key] ?? [];
		console.log(
			`${key}  ${summarize(
				"angle to centre deg",
				xs.map((a) => (a * 180) / Math.PI),
			)}`,
		);
		console.log(
			`          neighbours inside a 20° cone on the centre: ${finite(
				"cone share",
				shares.reduce((a, b) => a + b, 0) / shares.length,
			).toFixed(3)} of them  (uniform sky: ${finite(
				"uniform cone",
				(1 - Math.cos((20 * Math.PI) / 180)) / 2,
			).toFixed(3)})`,
		);
	}
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

	if (!Number.isFinite(one) || one <= 0)
		throw new Error(`measure-sky-density: the cost did not compute (${one})`);
	console.log(
		`one arrival, ${SYSTEMS_PER_GALAXY - 1} points: ${finite(
			"one",
			one,
		).toFixed(4)} ms over ${REPETITIONS} rebuilds` +
			`   [bun, headless — CPU arithmetic; the draw is 255 points and one more call]`,
	);
	console.log(
		`all ${systems.length} observers in one sweep: ${finite("all", all).toFixed(
			2,
		)} ms`,
	);
}

const MODES: Record<string, () => void> = {
	sky: modeSky,
	band: modeBand,
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
