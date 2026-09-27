/**
 * What the galaxy's shape costs: crowding, connectivity and reach, swept over
 * the flattening `q`.
 *
 * `bun scripts/measure-galaxy-shape.ts [mode] [...]`
 *
 *   control            the calibration arm: the ball's crowding, and the shape
 *                      the shipped constants actually produce
 *   shipped            what `src/galaxy.ts`'s constants produce, beside the ball
 *   solve <q> [target] the radius that holds `target` systems in jump range
 *   sweep              the q table: R solved at each q, crowding at two framings
 *   pitch              crowding against the chart's pitch, at the shipped shape
 *   grid               q x pitch: the claim that the ball wins at every angle
 *   density            §3's neighbour counts, bucketed by profile radius
 *   diameter [seeds…]  the worst shortest-chain over every ordered pair, which
 *                      is what the finder's budget ceiling has to clear
 *   tanks [seeds…]     the jump graph at each purchasable hull's tank (#185,
 *                      #554): fragmentation, isolated systems, neighbours and
 *                      the diameter inside each component
 *
 * This is the instrument behind `galaxy-generation.md` §2.1's derivation and
 * `galaxy-map.md` §5.1's crowding spread. It ships because #107 chose q = 0.7
 * against a measured cost, and a figure whose instrument is gone cannot be
 * rechecked when somebody proposes q = 0.5 next year.
 *
 * ## It is comparative, and the probes are authoritative
 *
 * The **positions** are the shipped generator's: `positionForShape` is exported
 * from `src/galaxy.ts` and `systemPosition` is a call to it, so there is no
 * replica here to drift. `tests/galaxy.test.ts` gates that they are one
 * function.
 *
 * The **projection** is replicated in closed form rather than read off a
 * rendered page, and that half is not exact: the crowding figures here run
 * several points above `probe-galaxy-map.mjs`'s at the same framing — 41.4%
 * against the probe's 40.2% on the ball. So never take a banded number from
 * this file; take it from a probe run. What this is for is the *comparison*
 * between shapes, which no probe can make because only one shape is shipped.
 *
 * ## Connected layouts only
 *
 * `layoutGalaxy` rejects a fragmented draw and re-rolls, and that filter selects
 * denser layouts. #107's first solve measured first-pass draws and landed at a
 * mean of 8.76 against a target of 8.25 — and reported 1.13 isolated systems in
 * the arm that reproduces the shipped ball, which has none. Every figure below
 * is taken over layouts the game would actually ship.
 *
 * ## Every printed figure is guarded
 *
 * Per the map's constraint that a measurement instrument must fail loudly: an
 * instrument that quietly reports garbage is worse than one that dies, because
 * its numbers get transcribed into a spec.
 */

import {
	GALAXY_COUNT,
	GALAXY_FLATTENING_Q,
	GALAXY_RADIUS_LY,
	JUMP_RANGE_LY,
	MAX_LAYOUT_ATTEMPTS,
	SYSTEMS_PER_GALAXY,
	clearLayoutCache,
	isConnected,
	generateGalaxy,
	layoutGalaxy,
	meanNeighbours,
	positionForShape,
	profileRadiusLy,
	systemPosition,
	systemSeedFor,
} from "../src/galaxy";
import { FINDER_MAX_BUDGET } from "../src/galaxy-finder";
import { projectJumps } from "../src/galaxy-route";
import { HULL_SPECS, PURCHASABLE_HULL_IDS } from "../src/hull";
import type { Vec3 } from "../src/vec3";

/** Throw rather than print a non-finite figure. */
function finite(label: string, x: number): number {
	if (!Number.isFinite(x)) {
		throw new Error(`measure-galaxy-shape: ${label} is not finite (${x})`);
	}
	return x;
}

// ---- the parameterised generator ------------------------------------------

/** One connected layout at `(q, R)`, plus the re-roll count it took — the same
 *  reject-and-re-roll loop `layoutGalaxy` runs. `null` if none was found. */
function layoutAt(
	worldSeed: number,
	galaxy: number,
	q: number,
	radius: number,
): { positions: Vec3[]; attempt: number } | null {
	for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
		const positions: Vec3[] = [];
		for (let n = 0; n < SYSTEMS_PER_GALAXY; n++) {
			positions.push(
				positionForShape(
					systemSeedFor(worldSeed, galaxy, attempt, n),
					q,
					radius,
				),
			);
		}
		if (isConnected(positions)) return { positions, attempt };
	}
	return null;
}

// ---- what a layout is worth ------------------------------------------------

/** The jump-range predicate both scans below need, in one place — the distance
 *  metric was written out three times. */
const RANGE_SQ = JUMP_RANGE_LY * JUMP_RANGE_LY;
const inRange = (a: Vec3, b: Vec3): boolean => {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return dx * dx + dy * dy + dz * dz <= RANGE_SQ;
};

/** Systems reachable from nothing. Zero on any layout `layoutAt` returns —
 *  printed so that a regression to measuring first-pass draws shows up as a
 *  non-zero rather than as a slightly wrong mean. */
function isolated(positions: readonly Vec3[]): number {
	let count = 0;
	for (let i = 0; i < positions.length; i++) {
		let has = false;
		for (let j = 0; j < positions.length && !has; j++) {
			if (i !== j) has = inRange(positions[i], positions[j]);
		}
		if (!has) count++;
	}
	return count;
}

// ---- the chart's projection, in closed form --------------------------------

const PICK_RADIUS_PX = 14;
const FOV_DEG = 45;

/**
 * `galaxy-map.ts`'s projection, replicated.
 *
 * The pivot rotates by `yaw` about world Y and then by `pitch` about the
 * yaw-rotated X axis, which composes to `Ry(yaw)·Rx(pitch)`. The camera sits on
 * +z looking at the origin, so a point's view depth is `distance − z`. The
 * pixel conversion is `toPixels`'s.
 */
function crowdingAt(
	positions: readonly Vec3[],
	opts: {
		width: number;
		height: number;
		distance: number;
		yaw: number;
		pitch: number;
	},
): { fraction: number; onScreen: number } {
	const { width, height, distance, yaw, pitch } = opts;
	const tan = Math.tan((FOV_DEG * Math.PI) / 180 / 2);
	const aspect = width / height;
	const cy = Math.cos(yaw);
	const sy = Math.sin(yaw);
	const cp = Math.cos(pitch);
	const sp = Math.sin(pitch);

	const points: { x: number; y: number }[] = [];
	for (const p of positions) {
		// Rx(pitch) first, then Ry(yaw).
		const y1 = p.y * cp - p.z * sp;
		const z1 = p.y * sp + p.z * cp;
		const x2 = p.x * cy + z1 * sy;
		const z2 = -p.x * sy + z1 * cy;
		const w = distance - z2;
		if (w <= 0) continue; // behind the camera
		const px = ((x2 / (w * tan * aspect) + 1) / 2) * width;
		const py = ((1 - y1 / (w * tan)) / 2) * height;
		// On screen, not merely in front — `probe-galaxy-map.mjs`'s filter, and
		// `galaxy-map.md` §5.1 reports the same quantity.
		if (px < 0 || py < 0 || px > width || py > height) continue;
		points.push({ x: px, y: py });
	}

	// Squared distance, not `Math.hypot`. This inner loop runs ~65k times per
	// framing and `grid` reaches it about 670 times; the square root is pure cost
	// against a fixed threshold.
	const pickSq = PICK_RADIUS_PX * PICK_RADIUS_PX;
	let crowded = 0;
	for (let i = 0; i < points.length; i++) {
		for (let j = 0; j < points.length; j++) {
			if (i === j) continue;
			const dx = points[i].x - points[j].x;
			const dy = points[i].y - points[j].y;
			if (dx * dx + dy * dy < pickSq) {
				crowded++;
				break;
			}
		}
	}
	if (points.length === 0) {
		// Not "100% crowded". A framing that puts nothing on screen is a broken
		// measurement, and substituting a plausible number for it is exactly the
		// quiet garbage the finite guards exist to stop.
		throw new Error(
			`measure-galaxy-shape: nothing on screen at ${width}x${height}, distance ${distance}`,
		);
	}
	return {
		fraction: finite("crowding", crowded / points.length),
		onScreen: points.length,
	};
}

// ---- framings ---------------------------------------------------------------

const DEFAULT_YAW = 0.6;
/** The shipped default framing, and the console cell the chart ships in. */
const DESKTOP = { width: 1280, height: 760 };
const CONSOLE = { width: 1011, height: 462 };
/**
 * The same cell with #115's finder open — the column the panel takes off the
 * chart, measured on the shipped console at 1280 x 760.
 *
 * It is here because the closed band cannot be assumed to carry: crowding is a
 * pixel property and #96 is the recorded case of the same figure changing under
 * a different box. What this row shows is *why* it carries here — the chart
 * holds its vertical field of view and widens `aspect` with the box, so a point's
 * horizontal pixel position works out to `worldX · height / (2 · z · tan)` plus
 * half the width, so the *spacing* between two systems does not depend on the
 * width at all. A narrower cell therefore crops rather than compresses, and
 * while the whole cluster still fits, the two spreads are the same numbers. The
 * moment the cluster stops fitting they part — so both rows print the on-screen
 * count beside the spread, because that is the precondition the equality rests
 * on and a reader comparing two identical spreads cannot otherwise see whether
 * it still holds.
 */
const CONSOLE_OPEN = { width: 743, height: 462 };
/** The shipped camera distance, expressed against the shipped radius, so a
 *  sweep over `R` frames every shape the same way and crowding is a property of
 *  the *shape* rather than of how much screen the cluster happens to fill. */
const CAMERA_PER_RADIUS = 62 / 22;

// ---- modes ------------------------------------------------------------------

const WORLD_SEEDS = [1, 47, 12345];
/** The pitches `galaxy-map.md` quotes, spanning the +/-1.45 clamp. */
const PITCH_DEGREES = [12, 20, 30, 40, 55, 70, 83] as const;
/** The shapes the grid compares. The ball is pinned at its own solved radius of
 *  22 rather than re-solved, because that is the shape that actually shipped. */
const GRID_Q = [1.0, 0.7, 0.5, 0.25] as const;
/** §3's table quotes 8,192 systems, which is these four seeds x 8 galaxies x
 *  256. One more than the sweep's, so the printed `n` matches the spec's. */
const DENSITY_SEEDS = [1, 47, 12345, 20260818] as const;
/** The seeds `diameter` sweeps by default — the shipped one first, so its row
 *  is the one `galaxy-finder.test.ts` also asserts. */
const DIAMETER_SEEDS = [0x5ee11e, 42, 1, 47, 12345] as const;

const mean = (xs: number[]): number =>
	finite("mean", xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Crowding over a corpus at one framing — the whole record per layout.
 *
 * `crowdSpread` used to be the only helper and threw `onScreen` away, so
 * anything wanting the count re-ran the O(points²) sweep over the same corpus
 * at the same framing. `modeShipped` does want it: an equal spread across two
 * cells is only meaningful while both still frame the whole cluster.
 */
const crowdRecords = (
	c: { positions: Vec3[] }[],
	framing: { width: number; height: number },
	radius: number,
	pitch: number,
): { fraction: number; onScreen: number }[] =>
	c.map((l) =>
		crowdingAt(l.positions, {
			...framing,
			// **The framing convention lives here, with the yaw one.** Every
			// caller used to compute `radius * CAMERA_PER_RADIUS` itself,
			// restating "the framing scales with R" at five sites — which is
			// the rule the whole sweep rests on for its rows to be about
			// shape rather than about screen fill.
			distance: radius * CAMERA_PER_RADIUS,
			yaw: DEFAULT_YAW,
			pitch,
		}),
	);

/** Just the fractions, ascending — what every row but `shipped` wants. */
const crowdSpread = (
	c: { positions: Vec3[] }[],
	framing: { width: number; height: number },
	radius: number,
	pitch: number,
): number[] =>
	crowdRecords(c, framing, radius, pitch)
		.map((x) => x.fraction)
		.sort((a, b) => a - b);

/**
 * Raised when a shape is too sparse to lay out at all — a legitimate answer to
 * the question `solveRadius` bisects, and the *only* error it may swallow.
 *
 * A class rather than a message regex: matching on text meant a rename of the
 * message silently turned a fatal `finite()` trip into "too sparse", which is
 * the fail-loudly rule switched off exactly where a wrong number is hardest to
 * see.
 */
class NoConnectedLayout extends Error {
	constructor(q: number, radius: number) {
		super(`measure-galaxy-shape: no connected layout at q=${q} R=${radius}`);
		this.name = "NoConnectedLayout";
	}
}

/** Every connected layout at `(q, R)` over the seed set, with its re-roll count. */
function corpus(q: number, radius: number) {
	const out: {
		positions: Vec3[];
		attempt: number;
		seed: number;
		galaxy: number;
	}[] = [];
	for (const seed of WORLD_SEEDS) {
		for (let g = 0; g < GALAXY_COUNT; g++) {
			const layout = layoutAt(seed, g, q, radius);
			if (layout) out.push({ ...layout, seed, galaxy: g });
		}
	}
	if (out.length === 0) throw new NoConnectedLayout(q, radius);
	return out;
}

/**
 * The radius that holds `target` systems in range at this `q`, by bisection over
 * connected layouts. Monotonic: a bigger R is a lower density.
 *
 * **A radius with no connected layout counts as too sparse**, which is what it
 * is — past about 33 LY the 7 LY tank cannot hold 256 systems together at all,
 * and `corpus` throws rather than average an empty list. That throw is the
 * instrument's fail-loudly rule doing its job for the *display* modes; here it
 * is a legitimate answer to the question being bisected, so it is caught at
 * exactly this one call and nowhere else.
 */
const solvedRadii = new Map<string, number>();

/** `solveRadius`, memoised on `(q, target)`. `sweep` and `grid` overlap on
 *  q = 1.0, 0.7, 0.5 and 0.25, and each solve is 16 bisection steps over a
 *  24-galaxy corpus — so re-solving them was most of a `grid` run. */
function solvedRadius(q: number, target: number): number {
	const key = `${q}:${target}`;
	const hit = solvedRadii.get(key);
	if (hit !== undefined) return hit;
	const value = solveRadius(q, target);
	solvedRadii.set(key, value);
	return value;
}

function solveRadius(q: number, target: number): number {
	let lo = 8;
	let hi = 60;
	// 16 halvings of a 52 LY interval leave under 0.001 LY, which is four orders
	// below anything §2.1 quotes. It was 26, and each step rebuilds the whole
	// corpus — 24 galaxies, each re-rolling until connected — so the extra ten
	// steps were roughly 40% of a `sweep` run bought for no digit.
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) / 2;
		// **A flag, not a sentinel.** Encoding "too sparse to lay out" as a
		// measured mean of 0 works only until somebody adds a guard on the
		// measurement, at which point the solver breaks in a way that looks like
		// a data problem.
		let tooSparse = false;
		let m = 0;
		try {
			m = mean(corpus(q, mid).map((l) => meanNeighbours(l.positions)));
		} catch (error) {
			// **Only the sparsity case**, by type. A bare catch here would also
			// swallow a tripped `finite` guard, which is the file's fail-loudly
			// rule turned off exactly where a wrong number is hardest to notice.
			if (!(error instanceof NoConnectedLayout)) throw error;
			tooSparse = true;
			console.log(
				`  (q=${q}: no connected layout at R=${mid.toFixed(2)} — too sparse, bisecting down)`,
			);
		}
		if (!tooSparse && m > target) lo = mid;
		else hi = mid;
	}
	return finite("solveRadius", (lo + hi) / 2);
}

const pct = (xs: number[]) =>
	`${(xs[0] * 100).toFixed(1)}%-${(xs[xs.length - 1] * 100).toFixed(1)}%`;

/** Fail the run, so a broken arm exits non-zero instead of printing a number
 *  somebody transcribes. The header calls the control the thing the instrument
 *  rests on; a control that only logs is not one. */
function assertThat(claim: string, held: boolean): void {
	console.log(`  ${held ? "ok  " : "FAIL"}  ${claim}`);
	if (!held) process.exitCode = 1;
}

function modeControl(): void {
	// **Exactness is now structural, not measured.** `systemPosition` is a call
	// to `positionForShape`, so the sweep runs the shipped draw by construction
	// and `tests/galaxy.test.ts` gates it. This arm re-checks it anyway, because
	// it costs nothing and the alternative is trusting a comment.
	let worst = 0;
	let compared = 0;
	for (const seed of WORLD_SEEDS) {
		clearLayoutCache();
		for (let g = 0; g < GALAXY_COUNT; g++) {
			const shipped = layoutGalaxy(seed, g);
			for (let n = 0; n < SYSTEMS_PER_GALAXY; n++) {
				const id = systemSeedFor(seed, g, shipped.attempt, n);
				const mine = positionForShape(
					id,
					GALAXY_FLATTENING_Q,
					GALAXY_RADIUS_LY,
				);
				const p = systemPosition(id);
				worst = Math.max(
					worst,
					Math.abs(mine.x - p.x),
					Math.abs(mine.y - p.y),
					Math.abs(mine.z - p.z),
				);
				compared++;
			}
		}
	}
	console.log(
		`shipped shape     : q = ${GALAXY_FLATTENING_Q}, R = ${GALAXY_RADIUS_LY}`,
	);
	console.log(
		`positions compared: ${compared}, worst |Δ| ${finite("control delta", worst).toExponential(2)}`,
	);
	assertThat("the sweep draws the shipped generator", worst === 0);

	// **Calibration, and a weak one — stated rather than oversold.** The ball arm
	// (`q = 1, R = 22`, the shape that shipped before #118) is where this
	// instrument's absolute figures can be held against a probe's. They do not
	// match and are not meant to: the projection here is closed-form and reads
	// about a point high.
	//
	// What is asserted is that the probe's 40.2% falls inside this arm's
	// galaxy-to-galaxy spread. That spread is ~13 points wide while the shape
	// differences read off the sweep are ~8, so this arm would **not** catch an
	// instrument biased by several points — it rules out a gross error, not a
	// small one. The narrower calibration is the mean: this arm's ball mean and
	// the probe's galaxy-0 figure are asserted within 2 points, which is the
	// scale of disagreement the closed-form projection is expected to produce.
	const ball = corpus(1, 22);
	const crowd = crowdSpread(ball, DESKTOP, 22, 0.35);
	console.log(
		`ball crowding     : ${pct(crowd)} over ${crowd.length} galaxies (probe measured 40.2%)`,
	);
	assertThat(
		"the probe's ball figure falls inside this arm's spread",
		crowd[0] <= 0.402 && crowd[crowd.length - 1] >= 0.402,
	);
	assertThat(
		`this arm's ball mean (${(mean(crowd) * 100).toFixed(1)}%) is within 2 points of the probe's 40.2%`,
		Math.abs(mean(crowd) - 0.402) < 0.02,
	);
	const isolatedTotal = ball.reduce((a, l) => a + isolated(l.positions), 0);
	console.log(`ball isolated     : ${isolatedTotal}`);
	assertThat(
		"every measured layout is one the game would ship",
		isolatedTotal === 0,
	);
}

function modeShipped(): void {
	// What the constants in `src/galaxy.ts` actually produce, and what the ball
	// they replaced produced — the two rows `galaxy-generation.md` §2.1 quotes.
	for (const [label, q, r] of [
		["ball (pre-#118)", 1, 22],
		["disc (shipped) ", GALAXY_FLATTENING_Q, GALAXY_RADIUS_LY],
	] as const) {
		const c = corpus(q, r);
		const inRange = c
			.map((l) => meanNeighbours(l.positions))
			.sort((a, b) => a - b);
		const pitch = q === 1 ? 0.35 : 0.7;
		const d = crowdSpread(c, DESKTOP, r, pitch);
		// One pass per box, both numbers off it — the count used to be a second
		// full sweep of the same corpus at the same framing.
		const consoleRows = crowdRecords(c, CONSOLE, r, pitch);
		const openRows = crowdRecords(c, CONSOLE_OPEN, r, pitch);
		const k = consoleRows.map((x) => x.fraction).sort((a, b) => a - b);
		const ko = openRows.map((x) => x.fraction).sort((a, b) => a - b);
		/** How many systems the framing actually puts on screen, as a range over
		 *  the corpus — the precondition the two cells' equal spreads rest on. */
		const seen = (rows: { onScreen: number }[]): string => {
			const low = Math.min(...rows.map((x) => x.onScreen));
			const high = Math.max(...rows.map((x) => x.onScreen));
			return low === high ? String(low) : `${low}-${high}`;
		};
		console.log(`${label} q=${q} R=${r}`);
		console.log(
			`  layouts        : ${c.length} connected, ${c.reduce((a, l) => a + isolated(l.positions), 0)} isolated systems`,
		);
		console.log(
			`  mean in range  : ${mean(inRange).toFixed(2)}  (spread ${inRange[0].toFixed(2)}-${inRange[inRange.length - 1].toFixed(2)})`,
		);
		console.log(
			`  mean re-rolls  : ${mean(c.map((l) => l.attempt)).toFixed(1)}  (ceiling ${MAX_LAYOUT_ATTEMPTS})`,
		);
		console.log(
			`  crowd desktop  : ${(mean(d) * 100).toFixed(1)}%  (spread ${pct(d)}) at pitch ${pitch}`,
		);
		console.log(
			`  crowd console  : ${(mean(k) * 100).toFixed(1)}%  (spread ${pct(k)}) over ${seen(consoleRows)} on screen at ${CONSOLE.width}x${CONSOLE.height}`,
		);
		console.log(
			`  crowd cons-open: ${(mean(ko) * 100).toFixed(1)}%  (spread ${pct(ko)}) over ${seen(openRows)} on screen at ${CONSOLE_OPEN.width}x${CONSOLE_OPEN.height}`,
		);
		/**
		 * **The equality of the two rows is entailed, so the precondition is what
		 * is asserted.**
		 *
		 * While both cells frame the whole cluster the spacings are identical by
		 * construction and the spreads cannot disagree — so printing them side by
		 * side corroborates nothing on its own. What *can* fail is the fitting: a
		 * narrower cell that stopped framing all 256 breaks the reasoning
		 * `galaxy-map.md` §5.2 rests on, and then the two rows would be about
		 * different populations while still reading alike.
		 */
		assertThat(
			`the open cell still frames every system (${seen(openRows)} of ${SYSTEMS_PER_GALAXY})`,
			openRows.every((x) => x.onScreen === SYSTEMS_PER_GALAXY) &&
				consoleRows.every((x) => x.onScreen === SYSTEMS_PER_GALAXY),
		);
	}
}

function modeSolve(): void {
	const q = Number(process.argv[3] ?? GALAXY_FLATTENING_Q);
	const target = Number(process.argv[4] ?? 8);
	if (!Number.isFinite(q) || q <= 0 || q > 1) {
		throw new Error(
			`measure-galaxy-shape: q must be in (0, 1], got "${process.argv[3]}"`,
		);
	}
	if (!Number.isFinite(target) || target <= 0) {
		throw new Error(
			`measure-galaxy-shape: target must be positive, got "${process.argv[4]}"`,
		);
	}
	const r = solvedRadius(q, target);
	const c = corpus(q, r);
	console.log(`q                : ${q}`);
	console.log(`target in range  : ${target}`);
	console.log(`R                : ${r.toFixed(2)} LY`);
	console.log(`core radius      : ${(r / Math.SQRT2).toFixed(2)} LY`);
	console.log(
		`mean in range    : ${mean(c.map((l) => meanNeighbours(l.positions))).toFixed(2)} over ${c.length} connected layouts`,
	);
	console.log(`mean re-rolls    : ${mean(c.map((l) => l.attempt)).toFixed(1)}`);
	console.log(
		`isolated systems : ${c.reduce((a, l) => a + isolated(l.positions), 0)}`,
	);
}

function modePitch(): void {
	console.log(
		`shipped shape: q = ${GALAXY_FLATTENING_Q}, R = ${GALAXY_RADIUS_LY}, yaw ${DEFAULT_YAW}`,
	);
	console.log("  pitch      desktop      console");
	const c = corpus(GALAXY_FLATTENING_Q, GALAXY_RADIUS_LY);
	for (const deg of PITCH_DEGREES) {
		const pitch = (deg * Math.PI) / 180;
		console.log(
			`  ${String(deg).padStart(3)}°    ${(mean(crowdSpread(c, DESKTOP, GALAXY_RADIUS_LY, pitch)) * 100).toFixed(1)}%        ${(mean(crowdSpread(c, CONSOLE, GALAXY_RADIUS_LY, pitch)) * 100).toFixed(1)}%`,
		);
	}
}

/**
 * §3's neighbour-count table: reachable systems within one 7 LY tank, bucketed
 * by the profile radius `t`.
 *
 * It exists because that table is headed "measured on the shipped generator" and
 * had **no instrument** — it was produced by a throwaway script during #118 and
 * would have entered the spec unrepeatable, which is the exact failure §2.1's
 * "a figure whose instrument is gone cannot be rechecked" warns about. Found in
 * review, one round after the rule was written down.
 *
 * `DENSITY_SEEDS` is four world seeds rather than the sweep's three, because the
 * table quotes 8,192 systems and the count should be reproducible from the mode
 * that prints it.
 */
function modeDensity(): void {
	const buckets = [
		{ label: "Centre (t < 0.15)", lo: 0, hi: 0.15 },
		{ label: "Mean over cluster", lo: 0, hi: Number.POSITIVE_INFINITY },
		{ label: "Rim (t > 0.85)", lo: 0.85, hi: Number.POSITIVE_INFINITY },
	];
	const acc = buckets.map(() => ({ n: 0, sum: 0 }));
	let systems = 0;
	for (const world of DENSITY_SEEDS) {
		for (let g = 0; g < GALAXY_COUNT; g++) {
			const sys = generateGalaxy(world, g).systems;
			for (const a of sys) {
				let count = 0;
				for (const b of sys)
					if (a.index !== b.index && inRange(a.pos, b.pos)) count++;
				const t = profileRadiusLy(a.pos) / GALAXY_RADIUS_LY;
				buckets.forEach((bucket, i) => {
					if (t >= bucket.lo && t < bucket.hi) {
						acc[i].n++;
						acc[i].sum += count;
					}
				});
				systems++;
			}
		}
	}
	console.log(
		`over ${systems} systems (${DENSITY_SEEDS.length} world seeds x ${GALAXY_COUNT} galaxies)\n`,
	);
	console.log("| Location | Systems within 7 LY | n |");
	console.log("|---|---|---|");
	buckets.forEach((bucket, i) => {
		console.log(
			`| ${bucket.label} | ${finite(bucket.label, acc[i].sum / acc[i].n).toFixed(1)} | ${acc[i].n} |`,
		);
	});
	assertThat(
		"every system fell in the cluster-wide bucket",
		acc[1].n === systems,
	);
	assertThat(
		"the core is denser in reachable neighbours than the rim",
		acc[0].sum / acc[0].n > acc[2].sum / acc[2].n,
	);
}

function modeGrid(): void {
	/**
	 * The q x pitch grid, which is the only thing that can carry
	 * `galaxy-generation.md` §2's claim that **the ball is the least crowded
	 * shape at every viewing angle**. `sweep` varies q at one pitch and `pitch`
	 * varies pitch at one q; neither alone says anything about every angle, and
	 * the claim was written against a grid #107 measured and did not ship.
	 *
	 * Prints the desktop figure per cell, then asserts the claim so that a
	 * future q or pitch change cannot leave the spec asserting a refuted one.
	 */
	console.log(`desktop crowding, framing scaled with R, yaw ${DEFAULT_YAW}\n`);
	console.log(
		`      q  ${PITCH_DEGREES.map((d) => `${d}°`.padStart(7)).join("")}`,
	);
	const rows: { q: number; cells: number[] }[] = [];
	for (const q of GRID_Q) {
		const r = q === 1 ? 22 : solvedRadius(q, 8);
		const c = corpus(q, r);
		const cells = PITCH_DEGREES.map((deg) =>
			mean(crowdSpread(c, DESKTOP, r, (deg * Math.PI) / 180)),
		);
		rows.push({ q, cells });
		console.log(
			`  ${q.toFixed(2)}  ${cells.map((x) => `${(x * 100).toFixed(1)}%`.padStart(7)).join("")}`,
		);
	}
	const ballRow = rows.find((r) => r.q === 1);
	if (!ballRow) throw new Error("measure-galaxy-shape: grid has no ball row");
	const ballBest = Math.min(...ballRow.cells);
	const discWorstBest = rows
		.filter((r) => r.q !== 1)
		.map((r) => Math.min(...r.cells));
	console.log("");
	assertThat(
		`the ball at its best angle (${(ballBest * 100).toFixed(1)}%) beats every flattened shape at its best`,
		discWorstBest.every((x) => x > ballBest),
	);
	assertThat(
		"the ball wins cell for cell, at every pitch",
		rows
			.filter((r) => r.q !== 1)
			.every((r) => r.cells.every((x, i) => x > ballRow.cells[i])),
	);
}

function modeSweep(): void {
	console.log(
		"     q       R    core    mean  re-rolls   desktop   console   (pitch 40°, framing scales with R)",
	);
	for (const q of [1.0, 0.85, 0.7, 0.5, 0.35, 0.25, 0.15]) {
		const r = solvedRadius(q, 8);
		const c = corpus(q, r);
		const pitch = 0.7;
		const m = mean(c.map((l) => meanNeighbours(l.positions)));
		const a = mean(c.map((l) => l.attempt));
		const d = mean(crowdSpread(c, DESKTOP, r, pitch));
		const k = mean(crowdSpread(c, CONSOLE, r, pitch));
		console.log(
			`  ${q.toFixed(2)}   ${r.toFixed(1).padStart(5)}   ${(r / Math.SQRT2).toFixed(1).padStart(5)}   ${m.toFixed(2)}      ${a.toFixed(1).padStart(4)}     ${(d * 100).toFixed(1)}%     ${(k * 100).toFixed(1)}%`,
		);
	}
}

/**
 * The galaxy's **jump diameter**: the worst shortest-chain over every ordered
 * pair, swept across world seeds.
 *
 * It exists because `galaxy-finder.ts`'s budget ceiling is a claim about this
 * number and was set without it. At 9 — the first ceiling — real pairs sat
 * permanently in the finder's dimmed "beyond range" group with no control
 * position that could promote them, which is the *filtered-out reads as absent*
 * failure the group exists to prevent. `galaxy-map.md` §5.2 quotes what this
 * prints, so the figure has an instrument that reprints it (#118's rule: a spec
 * figure stated as measured owes one).
 *
 * `galaxy-finder.test.ts` runs the shipped seed's arm of this in the suite; the
 * multi-seed sweep lives here because it is a few seconds, not a few hundred
 * milliseconds.
 */
function modeDiameter(): void {
	const seeds = process.argv
		.slice(3)
		.map(Number)
		.filter((n) => Number.isFinite(n));
	const worldSeeds = seeds.length > 0 ? seeds : DIAMETER_SEEDS;
	let overall = 0;
	console.log(
		`jump diameter over ${worldSeeds.length} world seeds x ${GALAXY_COUNT} galaxies, every system as origin`,
	);
	for (const seed of worldSeeds) {
		let worstForSeed = 0;
		let where = "";
		for (let index = 0; index < GALAXY_COUNT; index++) {
			const gx = generateGalaxy(seed, index);
			for (const from of gx.systems) {
				// The galaxy's reach — the courier's tank. `tanks` sweeps the rest.
				const reach = projectJumps(gx.systems, from, JUMP_RANGE_LY);
				for (const to of gx.systems) {
					const jumps = reach.reach(to)?.jumps;
					if (jumps !== undefined && jumps > worstForSeed) {
						worstForSeed = jumps;
						where = `g${index} ${from.name}→${to.name}`;
					}
				}
			}
		}
		overall = Math.max(overall, worstForSeed);
		console.log(
			`  seed 0x${seed.toString(16)}: ${finite("diameter", worstForSeed)} jumps  (${where})`,
		);
	}
	console.log(`worst over all seeds : ${overall} jumps`);
	console.log(`finder ceiling       : ${FINDER_MAX_BUDGET}`);
	assertThat(
		"the finder's budget ceiling covers the worst chain in the sweep",
		FINDER_MAX_BUDGET >= overall,
	);
}

/** #185's seeds, so a rerun reproduces the table its rulings were made on. */
const TANK_SEEDS = [1, 47, 1234] as const;

/**
 * The jump graph **at each purchasable hull's tank** (#185, #554).
 *
 * Reachability is a fact about the flown hull: its `tankLy` is its jump range.
 * `layoutGalaxy` guarantees connectivity only at `JUMP_RANGE_LY`, the
 * courier's tank, so a shorter tank flies a fragmented graph and a longer one a
 * denser graph. #185 ruled on a scratch script's figures and owed them this
 * mode (#118's rule: a figure stated as measured owes a shipped instrument that
 * reprints it). Nothing here is transcribed into a spec; the spec points here.
 *
 * Per tank, over the shipped layouts of every galaxy of every seed:
 * - **fragmented** — galaxies whose jump graph has more than one component;
 * - **outside main** — systems not in their galaxy's largest component;
 * - **isolated** — systems with no neighbour at all, which is where a shipyard
 *   refuses the hull (#185 D3);
 * - **neighbours** — the per-galaxy mean, as a range;
 * - **diameter** — the worst shortest chain *within* a component, against
 *   the finder's budget ceiling: a chain longer than the ceiling is a system
 *   the finder can never promote into its primary list for that hull.
 */
function modeTanks(): void {
	const seeds = process.argv
		.slice(3)
		.map(Number)
		.filter((n) => Number.isFinite(n));
	const worldSeeds = seeds.length > 0 ? seeds : TANK_SEEDS;
	const tanks = [
		...new Set(PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].tankLy)),
	].sort((a, b) => a - b);
	const galaxies = worldSeeds.length * GALAXY_COUNT;
	console.log(
		`jump graph per hull tank over ${worldSeeds.length} world seeds (${worldSeeds.join(", ")}) x ${GALAXY_COUNT} galaxies = ${galaxies} galaxies of ${SYSTEMS_PER_GALAXY}`,
	);
	console.log(
		"  tank  hulls                          fragmented  outside main  isolated  neighbours     diameter",
	);
	let connectedAtRange = true;
	let worstDiameter = 0;
	for (const tank of tanks) {
		const hulls = PURCHASABLE_HULL_IDS.filter(
			(id) => HULL_SPECS[id].tankLy === tank,
		);
		const tankSq = tank * tank;
		let fragmented = 0;
		let outside = 0;
		let isolatedCount = 0;
		let diameter = 0;
		const means: number[] = [];
		for (const seed of worldSeeds) {
			for (let index = 0; index < GALAXY_COUNT; index++) {
				const gx = generateGalaxy(seed, index);
				const pos = gx.systems.map((s) => s.pos);
				const n = pos.length;
				const adj: number[][] = pos.map(() => []);
				for (let i = 0; i < n; i++)
					for (let j = i + 1; j < n; j++) {
						const dx = pos[i].x - pos[j].x;
						const dy = pos[i].y - pos[j].y;
						const dz = pos[i].z - pos[j].z;
						if (dx * dx + dy * dy + dz * dz <= tankSq) {
							adj[i].push(j);
							adj[j].push(i);
						}
					}
				means.push(mean(adj.map((a) => a.length)));
				isolatedCount += adj.filter((a) => a.length === 0).length;
				const comp = new Int32Array(n).fill(-1);
				const sizes: number[] = [];
				for (let i = 0; i < n; i++) {
					if (comp[i] !== -1) continue;
					const c = sizes.length;
					let size = 0;
					const queue = [i];
					comp[i] = c;
					while (queue.length > 0) {
						const at = queue.pop() as number;
						size++;
						for (const k of adj[at])
							if (comp[k] === -1) {
								comp[k] = c;
								queue.push(k);
							}
					}
					sizes.push(size);
				}
				if (sizes.length > 1) fragmented++;
				outside += n - Math.max(...sizes);
				for (const from of gx.systems) {
					const reach = projectJumps(gx.systems, from, tank);
					for (const to of gx.systems) {
						const jumps = reach.reach(to)?.jumps;
						if (jumps !== undefined && jumps > diameter) diameter = jumps;
					}
				}
			}
		}
		if (tank >= JUMP_RANGE_LY && fragmented > 0) connectedAtRange = false;
		worstDiameter = Math.max(worstDiameter, diameter);
		const sorted = [...means].sort((a, b) => a - b);
		console.log(
			`  ${String(tank).padStart(4)}  ${hulls.join(", ").padEnd(30)} ${`${fragmented}/${galaxies}`.padStart(10)}  ${`${finite("outside", (100 * outside) / (galaxies * SYSTEMS_PER_GALAXY)).toFixed(1)}%`.padStart(12)}  ${String(isolatedCount).padStart(8)}  ${`${sorted[0].toFixed(2)}-${sorted[sorted.length - 1].toFixed(2)}`.padEnd(13)}  ${finite("diameter", diameter)} jumps`,
		);
	}
	console.log(`finder ceiling : ${FINDER_MAX_BUDGET} jumps`);
	assertThat(
		`every galaxy is connected at every tank of at least JUMP_RANGE_LY (${JUMP_RANGE_LY} LY)`,
		connectedAtRange,
	);
	assertThat(
		`the finder's budget ceiling covers the worst chain at every tank (${worstDiameter} jumps)`,
		FINDER_MAX_BUDGET >= worstDiameter,
	);
}

/**
 * The modes, as a table.
 *
 * A table rather than an `if`/`else if` chain over six ~30-line bodies: an
 * unknown mode is a lookup miss instead of a branch somebody has to remember to
 * add, and adding a mode is one entry rather than an edit to a chain. The chain
 * had already silently lost its `solve` arm once during a refactor in this same
 * PR, which is the argument.
 */
const MODES: Record<string, () => void> = {
	control: modeControl,
	shipped: modeShipped,
	solve: modeSolve,
	sweep: modeSweep,
	pitch: modePitch,
	grid: modeGrid,
	density: modeDensity,
	diameter: modeDiameter,
	tanks: modeTanks,
};

const mode = process.argv[2] ?? "sweep";
const run = MODES[mode];
if (!run) {
	throw new Error(
		`measure-galaxy-shape: unknown mode "${mode}" — expected one of ${Object.keys(MODES).join(", ")}`,
	);
}
run();
