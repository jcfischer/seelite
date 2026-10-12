/**
 * What a cruise pass past a star gives and costs, flown (#930).
 *
 *   bun scripts/measure-star-skim.ts
 *
 * #871 settled the skim's shape and left its numbers to an instrument: D1 a
 * cruise pass inside a band about the star, filling faster closer in; D3 a hull
 * temperature apart from laser heat; D4 every hull heats; D5 damage above the
 * top. The band radius, fill curve, rise, cooling, top and damage are the
 * principal's to approve, from this table — as #868 did for module prices.
 *
 * It **flies** each pass through the real `advanceCruise` at a fixed frame
 * delta, under `DEFAULT_CRUISE` and each class's `STAR_CLASSES` radius, and
 * integrates fill and heat over the segments the step reports (`onSegment`).
 * Nothing here is a closed-form estimate of the speed law: §2's law is keyed to
 * the centre distance, so the ship slows as it nears the star and the band
 * seconds are what that law makes them.
 *
 * Units, so that the candidates are dimensionless and the table re-scales:
 *
 * - **Shape** `s(r)` is 1 at the drop-out shell (1.05 R) and 0 at the band
 *   edge. A fill rate is `peak · s(r)` LY/s, so a pass's fill is
 *   `peak · ∫s dt` — the integral printed, in "seconds at peak".
 * - **Temperature** is in units of the top: ambient 0, the top 1. Heating is
 *   `rise · h(r)` per second with `h` the flux shape, so `rise` is how fast a
 *   hull heats at the drop-out shell. Cooling relaxes toward ambient with time
 *   constant `tau`: `dT/dt = rise·h(r) − T/tau`.
 *
 * Every figure goes through `fixed`, which throws on a non-finite value (#1's
 * "a measurement instrument must fail loudly").
 */

import {
	DEFAULT_CRUISE,
	type Mass,
	SURFACE_MARGIN,
	advanceCruise,
} from "../src/cruise";
import { HULL_SPECS } from "../src/hull";
import { JUMP_CHARGE_S } from "../src/hyperspace";
import { DEFINITIONS } from "../src/module-catalog";
import { STAR_CLASSES } from "../src/system";
import { MAX_DT } from "../src/units";
import { type Vec3, add, length, scale, v3 } from "../src/vec3";

function fixed(value: number, places: number): string {
	if (!Number.isFinite(value))
		throw new Error(`instrument produced a non-finite figure: ${value}`);
	return value.toFixed(places);
}

/** The game runs at display rate, capped at `MAX_DT`. 1/60 is the nominal
 *  frame; section 7 flies the approved table's inputs again at `MAX_DT` and
 *  throws if any differs by more than its tolerance. */
const DT = 1 / 60;
/** Pieces each reported segment is cut into for the integrals. */
const PIECES = 16;

/** The cruise spool, borrowed from the hyperspace wind-up as `main.ts` does. */
const SPOOL_S = JUMP_CHARGE_S;

const courierTankLy = HULL_SPECS.courier.tankLy;
const scoopRow = DEFINITIONS.find((m) => m.kind === "fuel-scoop");
const CATALOGUE_PEAK = scoopRow?.output?.fuelLyPerS;
if (CATALOGUE_PEAK === undefined || !(CATALOGUE_PEAK > 0))
	throw new Error("fuel-scoop catalogue row has no fuelLyPerS");

type Shape = (rOverR: number, bandR: number) => number;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const linear: Shape = (r, b) => clamp01((b - r) / (b - SURFACE_MARGIN));
const quadratic: Shape = (r, b) => linear(r, b) ** 2;
/** Inverse-square flux, re-based so it is 0 at the edge and 1 at the shell. */
const flux: Shape = (r, b) => {
	if (r >= b) return 0;
	const at = (x: number) => 1 / (x * x);
	return clamp01((at(r) - at(b)) / (at(SURFACE_MARGIN) - at(b)));
};
const FILL_SHAPES: [string, Shape][] = [
	["flat", (r, b) => (r < b ? 1 : 0)],
	["linear", linear],
	["quadratic", quadratic],
	["flux", flux],
];
/** Sections 2, 5 and 7 measure the linear curve by name, not by position. */
const LINEAR = FILL_SHAPES.findIndex(([n]) => n === "linear");
if (LINEAR < 0) throw new Error("no linear fill shape");
/** Heat follows the star's light. One shape, so the rise is the one dial. */
const HEAT: Shape = flux;

interface Heat {
	rise: number;
	tau: number;
}

/** Exact step of `dT/dt = rise·h − T/tau` over `dt` with `h` held. */
function heatStep(t: number, h: number, dt: number, k: Heat): number {
	const eq = k.rise * h * k.tau;
	return eq + (t - eq) * Math.exp(-dt / k.tau);
}

type Segment = {
	from: Vec3;
	velocity: Vec3;
	duration: number;
	powered: boolean;
};

/**
 * An `onSegment` that cuts each reported segment into `PIECES` and hands
 * `fn` the radius (in R) at each piece's midpoint and the piece's seconds.
 */
const sampled =
	(radiusKm: number, fn: (rOverR: number, dt: number) => void) =>
	(seg: Segment) => {
		const piece = seg.duration / PIECES;
		for (let i = 0; i < PIECES; i++) {
			const mid = add(seg.from, scale(seg.velocity, (i + 0.5) * piece));
			fn(length(mid) / radiusKm, piece);
		}
	};

/**
 * Cruise from `fromR` straight out to `toR`, flown; returns the seconds to
 * the crossing, summed from the pieces inside `toR` rather than counted in
 * whole frames (a frame count read 9% long at `MAX_DT`, round 1 of #933).
 * `onPiece` sees only those pieces. A drop-out on the way is a broken
 * measurement, not a figure, so it throws.
 */
function flyRadial(
	radiusKm: number,
	fromR: number,
	toR: number,
	onPiece: (rOverR: number, dt: number) => void,
	dt = DT,
): number {
	const masses: Mass[] = [{ id: "star", kind: "star", pos: v3(), radiusKm }];
	let inside = 0;
	const onSegment = sampled(radiusKm, (rr, piece) => {
		if (rr >= toR) return;
		inside += piece;
		onPiece(rr, piece);
	});
	let pos = v3(fromR * radiusKm, 0, 0);
	let t = 0;
	while (length(pos) < toR * radiusKm) {
		const step = advanceCruise({
			pos,
			nose: v3(1, 0, 0),
			throttle: 1,
			dt,
			masses,
			target: null,
			params: DEFAULT_CRUISE,
			targetParentId: null,
			onSegment,
		});
		if (step.dropped) throw new Error("radial climb dropped out");
		pos = step.pos;
		t += dt;
		if (t > 600) throw new Error("radial climb never left the band");
	}
	return inside;
}

interface PassResult {
	dropped: boolean;
	/** r/R where the drop-out fired, if it did. */
	dropAtR: number;
	bandS: number;
	/** ∫shape dt per fill shape, seconds at peak. */
	fill: number[];
	/** Temperature at the drop-out, per heat candidate; 0 if none. */
	tempAtDrop: number[];
	/** Highest temperature on the pass, per heat candidate. */
	tempPeak: number[];
}

/**
 * One straight pass: start 4 R out on a line whose closest approach is
 * `bR` radii, nose fixed along the line, full throttle, no target — a pilot
 * skimming a star is not flying *to* it.
 */
function flyPass(
	radiusKm: number,
	bR: number,
	bandR: number,
	heats: Heat[],
	dt = DT,
	startTemps: number[] = heats.map(() => 0),
): PassResult {
	const masses: Mass[] = [{ id: "star", kind: "star", pos: v3(), radiusKm }];
	const nose = v3(1, 0, 0);
	const startX = -Math.sqrt(Math.max(0, 16 - bR * bR)) * radiusKm;
	let pos: Vec3 = v3(startX, bR * radiusKm, 0);
	const r: PassResult = {
		dropped: false,
		dropAtR: Number.NaN,
		bandS: 0,
		fill: FILL_SHAPES.map(() => 0),
		tempAtDrop: heats.map(() => 0),
		tempPeak: [...startTemps],
	};
	const temps = [...startTemps];
	const sample = sampled(radiusKm, (rr, piece) => {
		if (rr < bandR) {
			r.bandS += piece;
			FILL_SHAPES.forEach(([, s], j) => {
				r.fill[j] += s(rr, bandR) * piece;
			});
		}
		const h = HEAT(rr, bandR);
		heats.forEach((k, j) => {
			temps[j] = heatStep(temps[j], h, piece, k);
			r.tempPeak[j] = Math.max(r.tempPeak[j], temps[j]);
		});
	});
	// A drop-out reports the rest of its frame as an unpowered carry at the
	// shell. That time is the hold after the drop — the spool counts it — so
	// the pass stops at the event, or a long frame heats the hull before the
	// drop is even recorded (15% on T0 at `MAX_DT` before this, round 1 of #933).
	const onSegment = (seg: Segment) => {
		if (seg.powered) sample(seg);
	};
	for (let t = 0; t < 600; t += dt) {
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt,
			masses,
			target: null,
			params: DEFAULT_CRUISE,
			targetParentId: null,
			onSegment,
		});
		pos = step.pos;
		if (step.dropped) {
			r.dropped = true;
			r.dropAtR = length(pos) / radiusKm;
			r.tempAtDrop = [...temps];
			return r;
		}
		if (pos.x > -startX) break;
	}
	return r;
}

/**
 * Seconds of cruise from `fromR` straight out to `toR`, flown, and the peak
 * temperature on the way from `t0` — the hull keeps heating as it climbs.
 */
function radialExit(
	radiusKm: number,
	fromR: number,
	toR: number,
	t0: number,
	k: Heat,
	bandR: number,
): { seconds: number; peak: number } {
	let temp = t0;
	let peak = t0;
	const seconds = flyRadial(radiusKm, fromR, toR, (rr, piece) => {
		temp = heatStep(temp, HEAT(rr, bandR), piece, k);
		peak = Math.max(peak, temp);
	});
	return { seconds, peak };
}

/** Seconds at the shell (`h` = 1) from `t0` to the top, or Infinity. */
function secondsToTop(t0: number, k: Heat): number {
	if (t0 >= 1) return 0;
	const eq = k.rise * k.tau;
	if (eq <= 1) return Number.POSITIVE_INFINITY;
	return -k.tau * Math.log((eq - 1) / (eq - t0));
}

const pad = (s: string, n: number) => s.padStart(n);
const BAND = 2;
const APPROACHES = [1.06, 1.1, 1.2, 1.3, 1.5, 1.7, 1.9];
const HEATS: Heat[] = [
	{ rise: 0.15, tau: 20 },
	{ rise: 0.2, tau: 20 },
	{ rise: 0.3, tau: 20 },
	{ rise: 0.2, tau: 10 },
	{ rise: 0.2, tau: 40 },
];
const heatLabel = (k: Heat) => `r${k.rise}/τ${k.tau}`;

console.log("# Star skim, flown (#930)\n");
console.log(
	`cruise: DEFAULT_CRUISE, frame ${fixed(DT, 4)} s; drop-out shell ${SURFACE_MARGIN} R; spool ${SPOOL_S} s`,
);
console.log(
	`courier tank ${courierTankLy} LY; catalogue fuelLyPerS ${CATALOGUE_PEAK} (the peak used for "passes")\n`,
);

// ── 1. Band seconds and fill, per class and closest approach ────────────────
console.log(`## 1. A pass through a ${BAND} R band, fill per shape\n`);
console.log(
	"fill is ∫shape dt (s at peak); passes = empty courier tank at the catalogue peak\n",
);
const head = [
	"class",
	"b/R",
	"band s",
	...FILL_SHAPES.flatMap(([n]) => [`${n} ∫`, "passes"]),
];
console.log(head.map((h) => pad(h, 9)).join(""));
for (const star of STAR_CLASSES) {
	for (const b of APPROACHES) {
		const p = flyPass(star.radiusKm, b, BAND, HEATS);
		if (p.dropped) {
			console.log(
				`${pad(star.cls, 9)}${pad(fixed(b, 2), 9)}   dropped at ${fixed(p.dropAtR, 3)} R`,
			);
			continue;
		}
		const cells = [
			star.cls,
			fixed(b, 2),
			fixed(p.bandS, 2),
			...p.fill.flatMap((f) => [
				fixed(f, 2),
				fixed(courierTankLy / (CATALOGUE_PEAK * f), 1),
			]),
		];
		console.log(cells.map((c) => pad(c, 9)).join(""));
	}
}

// ── 2. Band radius ─────────────────────────────────────────────────────────
console.log("\n## 2. Band radius, at b = 1.2 R\n");
const BANDS = [1.5, 2, 2.5, 3];
console.log(
	["class", ...BANDS.flatMap((bd) => [`${bd}R s`, `${bd}R lin∫`])]
		.map((h) => pad(h, 10))
		.join(""),
);
for (const star of STAR_CLASSES) {
	const cells: string[] = [star.cls];
	for (const bd of BANDS) {
		const p = flyPass(star.radiusKm, 1.2, bd, []);
		cells.push(fixed(p.bandS, 2), fixed(p.fill[LINEAR], 2));
	}
	console.log(cells.map((c) => pad(c, 10)).join(""));
}

// ── 3. Peak temperature on a good pass ────────────────────────────────
console.log(
	`\n## 3. Peak hull temperature on a pass through a ${BAND} R band (top = 1.00), per rise/τ\n`,
);
console.log(
	["class", "b/R", ...HEATS.map(heatLabel)].map((h) => pad(h, 11)).join(""),
);
for (const star of STAR_CLASSES) {
	for (const b of [1.06, 1.1, 1.2, 1.5]) {
		const p = flyPass(star.radiusKm, b, BAND, HEATS);
		const cells = [
			star.cls,
			fixed(b, 2),
			...p.tempPeak.map((t) => fixed(t, 2)),
		];
		console.log(cells.map((c) => pad(c, 11)).join(""));
	}
}

// ── 4. The drop-out ────────────────────────────────────────────────────────
console.log(
	"\n## 4. A pass taken too deep (b = 0.9 R): drop at the shell, spool, climb out\n",
);
console.log(
	`T0 at the drop; top s = seconds held at the shell from T0 to the top; slack = top s − ${SPOOL_S} s spool − out s;`,
);
console.log(
	`peak = highest temperature from the drop through the spool and a radial climb to the band edge (no turn, no reaction time)\n`,
);
console.log(
	["class", "out s", "rise/τ", "T0", "spool T", "peak", "top s", "slack"]
		.map((h) => pad(h, 10))
		.join(""),
);
for (const star of STAR_CLASSES) {
	const p = flyPass(star.radiusKm, 0.9, BAND, HEATS);
	if (!p.dropped) throw new Error(`${star.cls}: a 0.9 R pass did not drop`);
	HEATS.forEach((k, j) => {
		const t0 = p.tempAtDrop[j];
		const spoolT = heatStep(t0, HEAT(p.dropAtR, BAND), SPOOL_S, k);
		const out = radialExit(star.radiusKm, p.dropAtR, BAND, spoolT, k, BAND);
		const top = secondsToTop(t0, k);
		const cells = [
			star.cls,
			fixed(out.seconds, 2),
			heatLabel(k),
			fixed(t0, 2),
			fixed(spoolT, 2),
			fixed(Math.max(spoolT, out.peak), 2),
			Number.isFinite(top) ? fixed(top, 2) : "never",
			Number.isFinite(top) ? fixed(top - SPOOL_S - out.seconds, 2) : "—",
		];
		console.log(cells.map((c) => pad(c, 10)).join(""));
	});
}

// ── 5. Fitting the principal's targets ─────────────────────────────────────
//
// The principal's targets (#930, 2026-10-12): an empty courier tank fills in
// three good passes, and a drop-out at the shell leaves about six seconds to
// the top. The fill peak is solved on the G class at 1.2 R with the linear
// curve; the rise is solved, per cooling time, so a G drop-out reaches the top
// in six seconds. Each row then shows what the other classes get, and a chain
// of three passes with `GAP_S` out of the band between them — the heat a
// pilot carries from one pass into the next.
const TARGET_PASSES = 3;
const TARGET_TOP_S = 6;
const GAP_S = 15;
const REF = STAR_CLASSES.find((c) => c.cls === "G");
if (!REF) throw new Error("no G class");
const REF_KM = REF.radiusKm;
const refFill = flyPass(REF_KM, 1.2, BAND, []).fill[LINEAR];
const peak = courierTankLy / (TARGET_PASSES * refFill);
console.log(
	`\n## 5. Fitted: ${TARGET_PASSES} passes at G 1.2 R, linear → peak ${fixed(peak, 3)} LY/s; drop-out top ${TARGET_TOP_S} s at G\n`,
);
console.log(
	["class", "LY/pass", "passes", "LY@1.06", "LY@1.5"]
		.map((h) => pad(h, 10))
		.join(""),
);
for (const star of STAR_CLASSES) {
	const at = (b: number) =>
		peak * flyPass(star.radiusKm, b, BAND, []).fill[LINEAR];
	const ly = at(1.2);
	console.log(
		[
			star.cls,
			fixed(ly, 2),
			fixed(courierTankLy / ly, 1),
			fixed(at(1.06), 2),
			fixed(at(1.5), 2),
		]
			.map((c) => pad(c, 10))
			.join(""),
	);
}
const refDrop = flyPass(REF_KM, 0.9, BAND, [{ rise: 0, tau: 1 }]);
if (!refDrop.dropped) throw new Error("G 0.9 R pass did not drop");
/** The rise that puts a G drop-out `TARGET_TOP_S` from the top, by bisection. */
function fitRise(tau: number): number {
	let lo = 0.01;
	let hi = 2;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		const k = { rise: mid, tau };
		const t0 = flyPass(REF_KM, 0.9, BAND, [k]).tempAtDrop[0];
		const top = secondsToTop(t0, k);
		if (top > TARGET_TOP_S) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}
console.log(
	`\nper cooling time: the fitted rise; per class the drop-out's top s and slack (− spool − climb), one pass's peak at 1.2 R, and three passes at 1.2 R with ${GAP_S} s gaps\n`,
);
console.log(
	["τ s", "rise/s", "class", "top s", "slack", "1 pass", "3 passes", "3 @1.06"]
		.map((h) => pad(h, 10))
		.join(""),
);
for (const tau of [10, 15, 20, 30]) {
	const k = { rise: fitRise(tau), tau };
	for (const star of STAR_CLASSES) {
		const drop = flyPass(star.radiusKm, 0.9, BAND, [k]);
		const spoolT = heatStep(drop.tempAtDrop[0], 1, SPOOL_S, k);
		const out = radialExit(star.radiusKm, drop.dropAtR, BAND, spoolT, k, BAND);
		const top = secondsToTop(drop.tempAtDrop[0], k);
		const chain = (b: number) => {
			let t = 0;
			let worst = 0;
			for (let i = 0; i < TARGET_PASSES; i++) {
				const p = flyPass(star.radiusKm, b, BAND, [k], DT, [t]);
				worst = Math.max(worst, p.tempPeak[0]);
				// The pass ends 4 R out; cool across the gap from the peak — an
				// upper bound, since the exit leg already cooled it a little.
				t = heatStep(p.tempPeak[0], 0, GAP_S, k);
			}
			return worst;
		};
		console.log(
			[
				fixed(tau, 0),
				fixed(k.rise, 3),
				star.cls,
				fixed(top, 2),
				fixed(top - SPOOL_S - out.seconds, 2),
				fixed(flyPass(star.radiusKm, 1.2, BAND, [k]).tempPeak[0], 2),
				fixed(chain(1.2), 2),
				fixed(chain(1.06), 2),
			]
				.map((c) => pad(c, 10))
				.join(""),
		);
	}
}

// ── 6. Damage above the top ────────────────────────────────────────────────
//
// The principal's ruling on D5's rate (#930, 2026-10-12): damage grows with the
// excess — `k · (T − 1)` of the hull's integrity per second above the top,
// a share so it means the same on an 81-point courier and a 2,635-point
// capital. Flown on the G class with the approved heat (rise 0.185/s, τ 15 s):
// a drop-out at the shell, the spool, `late` seconds more at the shell before
// cruise is asked for again, then the radial climb out of the band.
const APPROVED: Heat = { rise: 0.185, tau: 15 };
const LATE_S = [0, 1, 2, 3, 5, 8, 12];
const KS = [0.1, 0.2, 0.3];
/** Integrity share lost: integrate `k·max(0, T − 1)` over a held phase. */
function heldDamage(
	t0: number,
	h: number,
	seconds: number,
	k: number,
): { t: number; lost: number } {
	const steps = Math.max(1, Math.ceil(seconds / 0.01));
	const dt = seconds / steps;
	let t = t0;
	let lost = 0;
	for (let i = 0; i < steps; i++) {
		const next = heatStep(t, h, dt, APPROVED);
		lost += k * Math.max(0, (t + next) / 2 - 1) * dt;
		t = next;
	}
	return { t, lost };
}
function climbDamage(t0: number, k: number): number {
	let t = t0;
	let lost = 0;
	flyRadial(REF_KM, refDropR, BAND, (rr, piece) => {
		const next = heatStep(t, HEAT(rr, BAND), piece, APPROVED);
		lost += k * Math.max(0, (t + next) / 2 - 1) * piece;
		t = next;
	});
	return lost;
}
const approvedDrop = flyPass(REF_KM, 0.9, BAND, [APPROVED]);
const refDropR = approvedDrop.dropAtR;
console.log(
	`\n## 6. Damage above the top, k·(T−1) of integrity per second — G, rise ${APPROVED.rise}, τ ${APPROVED.tau}\n`,
);
console.log(
	"late s = seconds at the shell after the spool before cruise is asked for; % = integrity lost\n",
);
console.log(
	["late s", "T at exit", ...KS.map((k) => `k ${k}`)]
		.map((h) => pad(h, 10))
		.join(""),
);
for (const late of LATE_S) {
	const cells = [fixed(late, 0)];
	let peakT = 0;
	const lost = KS.map((k) => {
		const held = heldDamage(
			approvedDrop.tempAtDrop[0],
			HEAT(refDropR, BAND),
			SPOOL_S + late,
			k,
		);
		peakT = held.t;
		return held.lost + climbDamage(held.t, k);
	});
	cells.push(fixed(peakT, 2), ...lost.map((l) => `${fixed(100 * l, 1)}%`));
	console.log(cells.map((c) => pad(c, 10)).join(""));
}

// ── 7. Frame-rate check ────────────────────────────────────────────────────
//
// Every figure the approved table rests on, flown at the nominal frame and at
// `MAX_DT`: band seconds, linear fill and peak temperature on every pass, the
// drop-out's temperature, and the climb's seconds. Band seconds and fill are
// compared relative (1%); temperatures absolute, in units of the top (0.01,
// the table's precision); the climb absolute, in seconds (0.05 s against the
// 6 s target). Two gaps are the step's own frame dependence — it holds speed
// over a sub-step, and from the shell a sub-step is the whole frame — and 128
// pieces a segment leave both unchanged, so neither is sampling: the drop's T0
// (~0.12) differs by ~0.002, 1.4% relative, and the ~1 s climb by ~0.02 s,
// 1.9% relative. A relative limit on either measures the game at 10 fps.
const SECONDS_TOLERANCE = 0.01;
const TEMP_TOLERANCE = 0.01;
const CLIMB_TOLERANCE_S = 0.05;
const rel = (x: number, y: number) =>
	Math.abs(x - y) / Math.max(Math.abs(x), 1e-9);
const abs = (x: number, y: number) => Math.abs(x - y);
const frameGaps: Record<string, { gap: number; limit: number; unit: string }> =
	{
		"band s": { gap: 0, limit: SECONDS_TOLERANCE, unit: "rel" },
		"linear fill": { gap: 0, limit: SECONDS_TOLERANCE, unit: "rel" },
		"climb s": { gap: 0, limit: CLIMB_TOLERANCE_S, unit: "s" },
		"peak T": { gap: 0, limit: TEMP_TOLERANCE, unit: "top" },
		"drop T0": { gap: 0, limit: TEMP_TOLERANCE, unit: "top" },
	};
const widen = (key: string, gap: number) => {
	frameGaps[key].gap = Math.max(frameGaps[key].gap, gap);
};
for (const star of STAR_CLASSES) {
	for (const b of APPROACHES) {
		const x = flyPass(star.radiusKm, b, BAND, [APPROVED], DT);
		const y = flyPass(star.radiusKm, b, BAND, [APPROVED], MAX_DT);
		widen("band s", rel(x.bandS, y.bandS));
		widen("linear fill", rel(x.fill[LINEAR], y.fill[LINEAR]));
		widen("peak T", abs(x.tempPeak[0], y.tempPeak[0]));
	}
	const x = flyPass(star.radiusKm, 0.9, BAND, [APPROVED], DT);
	const y = flyPass(star.radiusKm, 0.9, BAND, [APPROVED], MAX_DT);
	widen("drop T0", abs(x.tempAtDrop[0], y.tempAtDrop[0]));
	const none = () => {};
	widen(
		"climb s",
		abs(
			flyRadial(star.radiusKm, x.dropAtR, BAND, none, DT),
			flyRadial(star.radiusKm, y.dropAtR, BAND, none, MAX_DT),
		),
	);
}
console.log(
	`\n## 7. Frame check, ${fixed(DT, 4)} s against MAX_DT ${MAX_DT} s (largest gap)\n`,
);
for (const [key, { gap, limit, unit }] of Object.entries(frameGaps)) {
	const shown =
		unit === "rel"
			? `${fixed(100 * gap, 2)}% (limit ${fixed(100 * limit, 0)}%)`
			: unit === "s"
				? `${fixed(gap, 3)} s (limit ${fixed(limit, 2)} s)`
				: `${fixed(gap, 4)} of the top (limit ${fixed(limit, 2)})`;
	console.log(`${pad(key, 12)}  ${shown}`);
	if (gap > limit) throw new Error(`${key} depends on the frame: ${shown}`);
}
