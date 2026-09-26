/**
 * #537: the cruise sky's light shift — the pure half.
 *
 * The star shader carries a GLSL copy of these functions, and
 * `probe-cruise-light.mjs` holds a drawn star against {@link aberrate}, so the
 * copy cannot drift from what is tested here. What is tested here is the
 * physics, checked against a form of it the module does not use: the
 * half-angle law `tan(θ'/2) = sqrt((1-β)/(1+β)) · tan(θ/2)`.
 */
import { describe, expect, test } from "bun:test";
import {
	CRUISE_LIGHT,
	LIGHT_SHIFT_VERTEX_GLSL,
	aberrate,
	aberrateCos,
	beamedSize,
	cruiseBeta,
	dopplerFactor,
	easeBeta,
	shiftTint,
} from "../src/light-shift";
import { type Vec3, dot, length, v3 } from "../src/vec3";

const unit = (a: Vec3) => {
	const l = length(a);
	return v3(a.x / l, a.y / l, a.z / l);
};
const angle = (a: Vec3, b: Vec3) =>
	Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));

describe("aberration", () => {
	test("agrees with the half-angle law it is not written in", () => {
		for (const beta of [0.2, 0.6, 0.9]) {
			const k = Math.sqrt((1 - beta) / (1 + beta));
			for (const deg of [5, 30, 60, 90, 120, 150, 175]) {
				const th = (deg * Math.PI) / 180;
				const want = 2 * Math.atan(k * Math.tan(th / 2));
				expect(Math.acos(aberrateCos(Math.cos(th), beta))).toBeCloseTo(want, 9);
			}
		}
	});

	test("a star abeam is seen at acos(beta) from the heading", () => {
		expect(aberrateCos(0, 0.6)).toBeCloseTo(0.6, 12);
	});

	test("the sky crowds forward and keeps its order", () => {
		const beta = 0.6;
		let prev = Number.POSITIVE_INFINITY;
		for (let deg = 0; deg <= 180; deg += 5) {
			const c = Math.cos((deg * Math.PI) / 180);
			const seen = aberrateCos(c, beta);
			expect(seen).toBeGreaterThanOrEqual(c - 1e-12);
			expect(seen).toBeLessThanOrEqual(prev + 1e-12);
			prev = seen;
		}
	});

	test("at rest nothing moves", () => {
		const d = unit(v3(0.3, -0.5, 0.8));
		const out = aberrate(d, v3(0, 0, -1), 0);
		expect(out.x).toBeCloseTo(d.x, 12);
		expect(out.y).toBeCloseTo(d.y, 12);
		expect(out.z).toBeCloseTo(d.z, 12);
	});

	test("a direction moves toward the heading, in the plane it shares with it", () => {
		const heading = unit(v3(1, 2, -3));
		const d = unit(v3(-2, 1, 0.5));
		const out = aberrate(d, heading, 0.6);
		expect(length(out)).toBeCloseTo(1, 12);
		expect(angle(out, heading)).toBeLessThan(angle(d, heading));
		// Coplanar: the normal of (heading, d) is perpendicular to the result.
		const n = v3(
			heading.y * d.z - heading.z * d.y,
			heading.z * d.x - heading.x * d.z,
			heading.x * d.y - heading.y * d.x,
		);
		expect(dot(n, out)).toBeCloseTo(0, 12);
		expect(Math.cos(angle(out, heading))).toBeCloseTo(
			aberrateCos(dot(d, heading), 0.6),
			12,
		);
	});

	test("the poles are fixed points, not a division by zero", () => {
		const h = v3(0, 0, -1);
		for (const d of [v3(0, 0, -1), v3(0, 0, 1)]) {
			const out = aberrate(d, h, 0.6);
			expect(out.x).toBeCloseTo(d.x, 12);
			expect(out.y).toBeCloseTo(d.y, 12);
			expect(out.z).toBeCloseTo(d.z, 12);
		}
	});
});

describe("Doppler", () => {
	test("dead ahead is sqrt((1+β)/(1−β)), dead astern its inverse", () => {
		const beta = 0.6;
		expect(dopplerFactor(1, beta)).toBeCloseTo(
			Math.sqrt((1 + beta) / (1 - beta)),
			12,
		);
		expect(dopplerFactor(-1, beta)).toBeCloseTo(
			Math.sqrt((1 - beta) / (1 + beta)),
			12,
		);
	});

	test("blue ahead, red behind, and one at rest", () => {
		expect(dopplerFactor(0.9, 0.6)).toBeGreaterThan(1);
		expect(dopplerFactor(-0.5, 0.6)).toBeLessThan(1);
		expect(dopplerFactor(0.3, 0)).toBe(1);
	});

	test("the tint is bluer ahead than astern, and white at rest", () => {
		const ahead = shiftTint(dopplerFactor(1, 0.6));
		const astern = shiftTint(dopplerFactor(-1, 0.6));
		expect(ahead[2] / ahead[0]).toBeGreaterThan(1);
		expect(astern[2] / astern[0]).toBeLessThan(1);
		expect(shiftTint(1)).toEqual([1, 1, 1]);
	});

	test("beaming is clamped both ways, so the nose is not a blaze", () => {
		expect(beamedSize(1)).toBe(1);
		expect(beamedSize(100)).toBe(CRUISE_LIGHT.sizeMax);
		expect(beamedSize(0.01)).toBe(CRUISE_LIGHT.sizeMin);
		expect(beamedSize(1.1)).toBeGreaterThan(1);
	});
});

describe("the cruise dial", () => {
	test("beta follows the streaks' intensity up to the peak, and is zero at rest", () => {
		expect(cruiseBeta(0)).toBe(0);
		expect(cruiseBeta(1)).toBe(CRUISE_LIGHT.peakBeta);
		expect(cruiseBeta(2)).toBe(CRUISE_LIGHT.peakBeta);
		expect(cruiseBeta(-1)).toBe(0);
		expect(CRUISE_LIGHT.peakBeta).toBeLessThan(1);
	});

	test("a drop-out does not snap the sky in one frame, and it does settle", () => {
		const dt = 1 / 60;
		const one = easeBeta(CRUISE_LIGHT.peakBeta, 0, dt);
		expect(one).toBeGreaterThan(0.5 * CRUISE_LIGHT.peakBeta);
		let b: number = CRUISE_LIGHT.peakBeta;
		for (let i = 0; i < 120; i++) b = easeBeta(b, 0, dt);
		expect(b).toBe(0);
	});

	test("the ease survives a stalled frame without overshooting", () => {
		expect(easeBeta(0.6, 0, 5)).toBe(0);
		expect(easeBeta(0, 0.6, 5)).toBe(0.6);
	});
});

describe("the shader copy", () => {
	test("branches on beta, so the idle sky runs the old vertex path", () => {
		expect(LIGHT_SHIFT_VERTEX_GLSL).toContain("if (uBeta > 0.0)");
	});
});
