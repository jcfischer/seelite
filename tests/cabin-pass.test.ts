import { describe, expect, test } from "bun:test";
import {
	CABIN_FAR_KM,
	CABIN_NEAR_KM,
	CABIN_SCALE,
	type CabinLightState,
	cabinLight,
	cabinLightInto,
} from "../src/cabin-pass";

/**
 * Three's punctual-light attenuation, `getDistanceAttenuation` — with its
 * `max(d^decay, 0.01)` floor optional, because that floor is in *scene units*.
 * In this game's kilometre world it flattens every lamp within 100 m of what
 * it lights; in the cabin's frame it is reached only within a real metre. So
 * the world side here is the true inverse-square, and the cabin side is what
 * three draws.
 */
const received = (
	l: ReturnType<typeof cabinLight>,
	at: number[],
	floor = true,
) => {
	const d = Math.hypot(
		l.positionKm[0] - at[0],
		l.positionKm[1] - at[1],
		l.positionKm[2] - at[2],
	);
	let falloff = 1 / (floor ? Math.max(d ** l.decay, 0.01) : d ** l.decay);
	if (l.distanceKm > 0)
		falloff *= Math.max(0, Math.min(1, 1 - (d / l.distanceKm) ** 4)) ** 2;
	return l.intensity * falloff;
};

describe("the cabin camera brackets the cabin", () => {
	// Every vertex of #792's authored cabin against both planes is
	// `tests/cockpit-model.test.ts`'s row, read off the shipped model.
	// What the near plane must clear is the nearest *built* vertex, and the
	// cabin is built in `main.ts`, which a bun test cannot load — so
	// `probe-cabin-pass` measures it on the live cabin. This row holds the
	// depth ratio the two planes buy.
	test("the two planes keep the depth ratio at 200 or under", () => {
		expect(CABIN_NEAR_KM).toBeGreaterThan(0);
		expect(CABIN_FAR_KM / CABIN_NEAR_KM).toBeLessThanOrEqual(200);
	});
});

describe("a world light carried into the cabin", () => {
	const lamp = {
		positionKm: [0.012, -0.004, -0.03] as const,
		distanceKm: 0.09,
		intensity: 2,
		decay: 2,
	};

	test("stands outside the cabin, not inside it", () => {
		const mirrored = cabinLight(lamp);
		expect(Math.hypot(...mirrored.positionKm)).toBeGreaterThan(CABIN_FAR_KM);
		expect(mirrored.positionKm).toEqual([
			0.012 * CABIN_SCALE,
			-0.004 * CABIN_SCALE,
			-0.03 * CABIN_SCALE,
		]);
	});

	test("gives a cabin point what the world light gives the matching real point", () => {
		const mirrored = cabinLight(lamp);
		// A point on the dash, in the cabin's frame, and where it really is.
		for (const cabinPoint of [
			[0, -0.014, -0.038],
			[0.04, -0.019, -0.047],
			[0, 0, 0],
		]) {
			const real = cabinPoint.map((c) => c / CABIN_SCALE);
			expect(received(mirrored, cabinPoint)).toBeCloseTo(
				received(lamp, real, false),
				9,
			);
		}
	});

	test("holds for any decay, and leaves an unbounded light unbounded", () => {
		const linear = { ...lamp, decay: 1, distanceKm: 0 };
		const mirrored = cabinLight(linear);
		expect(mirrored.distanceKm).toBe(0);
		expect(received(mirrored, [0, 0, 0])).toBeCloseTo(
			received(linear, [0, 0, 0], false),
			9,
		);
	});

	test("refuses a scale that is not a scale", () => {
		for (const k of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => cabinLight(lamp, k)).toThrow();
	});
});

describe("the frame loop's form of it", () => {
	test("writes what cabinLight returns into the object it is given", () => {
		const world = {
			positionKm: [0.01, 0.02, -0.03] as const,
			distanceKm: 0.05,
			intensity: 3,
			decay: 2,
		};
		const out: CabinLightState = {
			positionKm: [9, 9, 9],
			distanceKm: 9,
			intensity: 9,
			decay: 9,
		};
		const returned = cabinLightInto(world, out);
		expect(returned).toBe(out);
		expect(out).toEqual(cabinLight(world) as CabinLightState);
	});
});
