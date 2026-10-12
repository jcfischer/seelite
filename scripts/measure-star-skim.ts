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
 *  frame; `MAX_DT` is flown once as a check that the figures do not depend on
 *  it (the step sub-steps and sweeps, so they should not). */
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
		tempPeak: heats.map(() => 0),
	};
	const temps = heats.map(() => 0);
	const onSegment = (seg: { from: Vec3; velocity: Vec3; duration: number }) => {
		const piece = seg.duration / PIECES;
		for (let i = 0; i < PIECES; i++) {
			const mid = add(seg.from, scale(seg.velocity, (i + 0.5) * piece));
			const rr = length(mid) / radiusKm;
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
		}
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
	const onSegment = (seg: { from: Vec3; velocity: Vec3; duration: number }) => {
		const piece = seg.duration / PIECES;
		for (let i = 0; i < PIECES; i++) {
			const mid = add(seg.from, scale(seg.velocity, (i + 0.5) * piece));
			temp = heatStep(temp, HEAT(length(mid) / radiusKm, bandR), piece, k);
			peak = Math.max(peak, temp);
		}
	};
	const masses: Mass[] = [{ id: "star", kind: "star", pos: v3(), radiusKm }];
	let pos = v3(fromR * radiusKm, 0, 0);
	let t = 0;
	while (length(pos) < toR * radiusKm) {
		const step = advanceCruise({
			pos,
			nose: v3(1, 0, 0),
			throttle: 1,
			dt: DT,
			masses,
			target: null,
			params: DEFAULT_CRUISE,
			targetParentId: null,
			onSegment,
		});
		if (step.dropped) throw new Error("radial exit dropped out");
		pos = step.pos;
		t += DT;
		if (t > 600) throw new Error("radial exit never left the band");
	}
	return { seconds: t, peak };
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
		cells.push(fixed(p.bandS, 2), fixed(p.fill[1], 2));
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

// ── 5. Frame-rate check ────────────────────────────────────────────────────
let worst = 0;
for (const star of STAR_CLASSES) {
	for (const b of APPROACHES) {
		const a = flyPass(star.radiusKm, b, BAND, [], DT);
		const c = flyPass(star.radiusKm, b, BAND, [], MAX_DT);
		worst = Math.max(worst, Math.abs(a.bandS - c.bandS) / a.bandS);
	}
}
console.log(
	`\n## 5. Frame check: band seconds at ${fixed(DT, 4)} s vs MAX_DT ${MAX_DT} s differ by at most ${fixed(100 * worst, 2)}%`,
);
