/**
 * What the galaxy's shape costs: crowding, connectivity and reach, swept over
 * the flattening `q`.
 *
 * `bun scripts/measure-galaxy-shape.ts [mode] [...]`
 *
 *   control            reproduce the shipped generator, position for position
 *   solve <q> [target] the radius that holds `target` systems in jump range
 *   sweep              the q table: R solved at each q, crowding at two framings
 *   pitch              crowding against the chart's pitch, at the shipped shape
 *
 * This is the instrument behind `galaxy-generation.md` §2.1's derivation and
 * `galaxy-map.md` §5.1's crowding spread. It ships because #107 chose q = 0.7
 * against a measured cost, and a figure whose instrument is gone cannot be
 * rechecked when somebody proposes q = 0.5 next year.
 *
 * ## It is comparative, and the probes are authoritative
 *
 * The crowding figures here run 2-5 points above `probe-galaxy-map.mjs`'s,
 * because this replicates the projection in closed form rather than reading it
 * off a rendered page. It is validated by its **control**: at `q = 1, R = 22` it
 * must reproduce the shipped ball position for position, and its crowding must
 * bracket the 40.2% the probe measured there. Never take a banded number from
 * this file — take it from a probe run. What this is for is the *comparison*
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
	layoutGalaxy,
	stream,
	systemSeedFor,
} from "../src/galaxy";
import { DOMAIN } from "../src/domains";
import type { Vec3 } from "../src/vec3";

/** Throw rather than print a non-finite figure. */
function finite(label: string, x: number): number {
	if (!Number.isFinite(x)) {
		throw new Error(`measure-galaxy-shape: ${label} is not finite (${x})`);
	}
	return x;
}

// ---- the parameterised generator ------------------------------------------

/**
 * `systemPosition` with `q` and `R` as parameters instead of constants.
 *
 * **The same three draws in the same order** — radius, `cosθ`, `φ` — off the
 * same `POS` stream. This is a squash of the shipped draw, not a different
 * distribution: at `q = 1, R = GALAXY_RADIUS_LY` it is the shipped function, and
 * `control` asserts exactly that. Anything that reorders the draws changes every
 * galaxy for a second reason and makes the sweep a comparison of two things.
 */
function positionAt(systemSeed: number, q: number, radius: number): Vec3 {
	const coreRadius = radius / Math.SQRT2;
	const norm = radius - coreRadius * Math.atan(radius / coreRadius);
	const cdf = (x: number): number =>
		(x - coreRadius * Math.atan(x / coreRadius)) / norm;

	const rand = stream(systemSeed, DOMAIN.POS);
	// Bisection at a fixed step count, as `radiusForQuantile` does: a
	// convergence-dependent count would make the layout a function of the
	// floating-point path rather than of the seed.
	const u = rand();
	let lo = 0;
	let hi = radius;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (cdf(mid) < u) lo = mid;
		else hi = mid;
	}
	const r = (lo + hi) / 2;
	const cosTheta = 2 * rand() - 1;
	const phi = 2 * Math.PI * rand();
	const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
	return {
		x: r * sinTheta * Math.cos(phi),
		y: q * r * sinTheta * Math.sin(phi),
		z: r * cosTheta,
	};
}

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
				positionAt(systemSeedFor(worldSeed, galaxy, attempt, n), q, radius),
			);
		}
		if (isConnected(positions)) return { positions, attempt };
	}
	return null;
}

// ---- what a layout is worth ------------------------------------------------

/** Mean systems within one 7 LY tank of a system, over every system. This is
 *  the quantity `galaxy-generation.md` §2.1 holds fixed at ~8. */
function meanInRange(positions: readonly Vec3[]): number {
	const rangeSq = JUMP_RANGE_LY * JUMP_RANGE_LY;
	let total = 0;
	for (let i = 0; i < positions.length; i++) {
		for (let j = 0; j < positions.length; j++) {
			if (i === j) continue;
			const a = positions[i];
			const b = positions[j];
			const dx = a.x - b.x;
			const dy = a.y - b.y;
			const dz = a.z - b.z;
			if (dx * dx + dy * dy + dz * dz <= rangeSq) total++;
		}
	}
	return finite("meanInRange", total / positions.length);
}

/** Systems reachable from nothing. Zero on any layout `layoutAt` returns —
 *  printed so that a regression to measuring first-pass draws shows up as a
 *  non-zero rather than as a slightly wrong mean. */
function isolated(positions: readonly Vec3[]): number {
	const rangeSq = JUMP_RANGE_LY * JUMP_RANGE_LY;
	let count = 0;
	for (let i = 0; i < positions.length; i++) {
		let has = false;
		for (let j = 0; j < positions.length && !has; j++) {
			if (i === j) continue;
			const a = positions[i];
			const b = positions[j];
			const dx = a.x - b.x;
			const dy = a.y - b.y;
			const dz = a.z - b.z;
			has = dx * dx + dy * dy + dz * dz <= rangeSq;
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

	let crowded = 0;
	for (let i = 0; i < points.length; i++) {
		for (let j = 0; j < points.length; j++) {
			if (i === j) continue;
			if (
				Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <
				PICK_RADIUS_PX
			) {
				crowded++;
				break;
			}
		}
	}
	return {
		fraction: finite(
			"crowding",
			points.length === 0 ? 1 : crowded / points.length,
		),
		onScreen: points.length,
	};
}

// ---- framings ---------------------------------------------------------------

const DEFAULT_YAW = 0.6;
/** The shipped default framing, and the console cell the chart ships in. */
const DESKTOP = { width: 1280, height: 760 };
const CONSOLE = { width: 1011, height: 462 };
/** The shipped camera distance, expressed against the shipped radius, so a
 *  sweep over `R` frames every shape the same way and crowding is a property of
 *  the *shape* rather than of how much screen the cluster happens to fill. */
const CAMERA_PER_RADIUS = 62 / 22;

// ---- modes ------------------------------------------------------------------

const WORLD_SEEDS = [1, 47, 12345];

const mean = (xs: number[]): number =>
	finite("mean", xs.reduce((a, b) => a + b, 0) / xs.length);

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
	if (out.length === 0) {
		throw new Error(
			`measure-galaxy-shape: no connected layout at q=${q} R=${radius}`,
		);
	}
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
function solveRadius(q: number, target: number): number {
	let lo = 8;
	let hi = 60;
	for (let i = 0; i < 26; i++) {
		const mid = (lo + hi) / 2;
		let m: number;
		try {
			m = mean(corpus(q, mid).map((l) => meanInRange(l.positions)));
		} catch {
			m = 0;
		}
		if (m > target) lo = mid;
		else hi = mid;
	}
	return finite("solveRadius", (lo + hi) / 2);
}

const mode = process.argv[2] ?? "sweep";

if (mode === "control") {
	// The control the whole instrument rests on, in two halves.
	//
	// **Exactness.** At the shipped `(q, R)`, `positionAt` must be
	// `systemPosition` — not close to it, the same number. If it is not, every
	// figure below is about a generator the game does not run.
	let worst = 0;
	let compared = 0;
	for (const seed of WORLD_SEEDS) {
		clearLayoutCache();
		for (let g = 0; g < GALAXY_COUNT; g++) {
			const shipped = layoutGalaxy(seed, g);
			for (let n = 0; n < SYSTEMS_PER_GALAXY; n++) {
				const mine = positionAt(
					systemSeedFor(seed, g, shipped.attempt, n),
					GALAXY_FLATTENING_Q,
					GALAXY_RADIUS_LY,
				);
				const p = shipped.positions[n];
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
		`shipped shape    : q = ${GALAXY_FLATTENING_Q}, R = ${GALAXY_RADIUS_LY}`,
	);
	console.log(`positions compared: ${compared}`);
	console.log(
		`worst |Δ|        : ${finite("control delta", worst).toExponential(2)}`,
	);

	// **Calibration.** The ball arm — `q = 1, R = 22`, the shape that shipped
	// before #118 — must bracket the 40.2% `probe-galaxy-map.mjs` measured on it.
	// That is what makes the sweep's other rows believable, and it is also the
	// reason nothing banded is taken from this file: these figures run above the
	// probe's, so what is validated is the comparison, not the absolute.
	const ball = corpus(1, 22);
	const crowd = ball
		.map(
			(l) =>
				crowdingAt(l.positions, {
					...DESKTOP,
					distance: 22 * CAMERA_PER_RADIUS,
					yaw: DEFAULT_YAW,
					pitch: 0.35,
				}).fraction,
		)
		.sort((a, b) => a - b);
	console.log(
		`ball crowding    : ${(crowd[0] * 100).toFixed(1)}%-${(crowd[crowd.length - 1] * 100).toFixed(1)}% over ${crowd.length} galaxies (probe measured 40.2% at pitch 0.35)`,
	);
	console.log(
		`ball isolated    : ${ball.reduce((a, l) => a + isolated(l.positions), 0)} (must be 0 — a non-zero means first-pass draws leaked in)`,
	);
} else if (mode === "solve") {
	const q = Number(process.argv[3] ?? GALAXY_FLATTENING_Q);
	const target = Number(process.argv[4] ?? 8);
	const r = solveRadius(q, target);
	const c = corpus(q, r);
	console.log(`q                : ${q}`);
	console.log(`target in range  : ${target}`);
	console.log(`R                : ${r.toFixed(2)} LY`);
	console.log(`core radius      : ${(r / Math.SQRT2).toFixed(2)} LY`);
	console.log(
		`mean in range    : ${mean(c.map((l) => meanInRange(l.positions))).toFixed(2)} over ${c.length} connected layouts`,
	);
	console.log(`mean re-rolls    : ${mean(c.map((l) => l.attempt)).toFixed(1)}`);
	console.log(
		`isolated systems : ${c.reduce((a, l) => a + isolated(l.positions), 0)}`,
	);
} else if (mode === "shipped") {
	// What the constants in `src/galaxy.ts` actually produce, and what the ball
	// they replaced produced — the two rows `galaxy-generation.md` §2.1 quotes.
	// Every figure the spec states about reach or connectivity comes from here.
	for (const [label, q, r] of [
		["ball (pre-#118)", 1, 22],
		["disc (shipped) ", GALAXY_FLATTENING_Q, GALAXY_RADIUS_LY],
	] as const) {
		const c = corpus(q, r);
		const inRange = c.map((l) => meanInRange(l.positions));
		inRange.sort((a, b) => a - b);
		const distance = r * CAMERA_PER_RADIUS;
		const pitch = q === 1 ? 0.35 : 0.7;
		const d = c
			.map(
				(l) =>
					crowdingAt(l.positions, {
						...DESKTOP,
						distance,
						yaw: DEFAULT_YAW,
						pitch,
					}).fraction,
			)
			.sort((a, b) => a - b);
		const k = c
			.map(
				(l) =>
					crowdingAt(l.positions, {
						...CONSOLE,
						distance,
						yaw: DEFAULT_YAW,
						pitch,
					}).fraction,
			)
			.sort((a, b) => a - b);
		const pct = (xs: number[]) =>
			`${(xs[0] * 100).toFixed(1)}%-${(xs[xs.length - 1] * 100).toFixed(1)}%`;
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
			`  crowd console  : ${(mean(k) * 100).toFixed(1)}%  (spread ${pct(k)})`,
		);
	}
} else if (mode === "pitch") {
	console.log(
		`shipped shape: q = ${GALAXY_FLATTENING_Q}, R = ${GALAXY_RADIUS_LY}, yaw ${DEFAULT_YAW}`,
	);
	console.log("  pitch      desktop      console");
	const c = corpus(GALAXY_FLATTENING_Q, GALAXY_RADIUS_LY);
	const distance = GALAXY_RADIUS_LY * CAMERA_PER_RADIUS;
	for (const deg of [12, 20, 30, 40, 55, 70, 83]) {
		const pitch = (deg * Math.PI) / 180;
		const d = mean(
			c.map(
				(l) =>
					crowdingAt(l.positions, {
						...DESKTOP,
						distance,
						yaw: DEFAULT_YAW,
						pitch,
					}).fraction,
			),
		);
		const k = mean(
			c.map(
				(l) =>
					crowdingAt(l.positions, {
						...CONSOLE,
						distance,
						yaw: DEFAULT_YAW,
						pitch,
					}).fraction,
			),
		);
		console.log(
			`  ${String(deg).padStart(3)}°    ${(d * 100).toFixed(1)}%        ${(k * 100).toFixed(1)}%`,
		);
	}
} else {
	// sweep
	console.log(
		"     q       R    core    mean  re-rolls   desktop   console   (pitch 40°, framing scales with R)",
	);
	for (const q of [1.0, 0.85, 0.7, 0.5, 0.35, 0.25, 0.15]) {
		const r = solveRadius(q, 8);
		const c = corpus(q, r);
		const distance = r * CAMERA_PER_RADIUS;
		const pitch = 0.7;
		const m = mean(c.map((l) => meanInRange(l.positions)));
		const a = mean(c.map((l) => l.attempt));
		const d = mean(
			c.map(
				(l) =>
					crowdingAt(l.positions, {
						...DESKTOP,
						distance,
						yaw: DEFAULT_YAW,
						pitch,
					}).fraction,
			),
		);
		const k = mean(
			c.map(
				(l) =>
					crowdingAt(l.positions, {
						...CONSOLE,
						distance,
						yaw: DEFAULT_YAW,
						pitch,
					}).fraction,
			),
		);
		console.log(
			`  ${q.toFixed(2)}   ${r.toFixed(1).padStart(5)}   ${(r / Math.SQRT2).toFixed(1).padStart(5)}   ${m.toFixed(2)}      ${a.toFixed(1).padStart(4)}     ${(d * 100).toFixed(1)}%     ${(k * 100).toFixed(1)}%`,
		);
	}
}
