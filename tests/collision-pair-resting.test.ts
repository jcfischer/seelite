import { expect, test } from "bun:test";
import {
	type ShipMotion,
	hullBox,
	pairSeparation,
	SEPARATION_KM,
	shipPose,
	sweepShip,
	sweepShipPair,
} from "../src/collision";
import { HULL_SPECS, type HullId } from "../src/hull";
import { v3 } from "../src/vec3";

const dt = 0.1;
const spec = HULL_SPECS.carrier;
const box = hullBox(spec.env, spec.envCentre);

function restingPair(
	leftTurn: number,
	rightTurn = 0,
): [ShipMotion, ShipMotion] {
	const ship = (x: number, turn: number): ShipMotion => ({
		massT: spec.massT,
		primitives: [box],
		start: shipPose(v3(x, 0, 0), v3(0, 0, 1), v3(0, 1, 0)),
		end: shipPose(
			v3(x, 0, 0),
			v3(Math.sin(turn * dt), 0, Math.cos(turn * dt)),
			v3(0, 1, 0),
		),
		velStart: v3(),
		velEnd: v3(),
	});
	const pair: [ShipMotion, ShipMotion] = [
		ship(0, leftTurn),
		ship(spec.env.beamKm + SEPARATION_KM, rightTurn),
	];
	const gap = pairSeparation(box, pair[0].start, box, pair[1].start);
	expect(gap.overlap).toBe(false);
	if (gap.overlap) throw new Error("resting fixture starts overlapped");
	expect(gap.distanceKm).toBeCloseTo(SEPARATION_KM, 12);
	return pair;
}

test("neither ship pays for its own turn in a resting pair (node #664)", () => {
	const [a, b] = restingPair(1);
	const ab = sweepShipPair(a, b, dt);
	const ba = sweepShipPair(b, a, dt);
	expect([ab.ghost, ba.ghost]).toEqual([false, false]);
	expect(ab.impacts).toEqual([]);
	expect(ba.impacts).toEqual([]);
	// Own rotation is resolved by moving the boxes apart, without imparting
	// translation in one pair order alone.
	expect(ab.a.vel).toEqual(v3());
	expect(ab.b.vel).toEqual(v3());
	expect(ba.a.vel).toEqual(v3());
	expect(ba.b.vel).toEqual(v3());
	for (const pair of [ab, { a: ba.b, b: ba.a }]) {
		const gap = pairSeparation(box, { ...a.end, origin: pair.a.pos }, box, {
			...b.end,
			origin: pair.b.pos,
		});
		expect(gap.overlap).toBe(false);
		if (!gap.overlap)
			expect(gap.distanceKm).toBeGreaterThanOrEqual(SEPARATION_KM * 0.99);
	}
});

test("resting translation still bills the same impact in either order", () => {
	const [a, b] = restingPair(1);
	a.velStart = v3(0.1, 0, 0);
	a.velEnd = a.velStart;
	a.end = { ...a.end, origin: v3(dt * a.velStart.x, 0, 0) };
	const ab = sweepShipPair(a, b, dt);
	const ba = sweepShipPair(b, a, dt);
	expect(ab.impacts).toHaveLength(1);
	expect(ba.impacts).toHaveLength(1);
	expect(ab.impacts[0].closingKms).toBeCloseTo(0.1, 10);
	expect(ab.impacts[0].damage).toBeCloseTo(30, 10);
	expect(ab.impacts[0].damage).toBeCloseTo(ba.impacts[0].damage, 10);
});

test("equal turns cancel at a resting pair's impact points (node #664)", () => {
	const [a, b] = restingPair(1, 1);
	expect(sweepShipPair(a, b, dt).impacts).toEqual([]);
	expect(sweepShipPair(b, a, dt).impacts).toEqual([]);
});

test("a ship's own resting turn against the world is still held without damage", () => {
	const [a, b] = restingPair(1);
	const held = sweepShip(a, [b], dt);
	expect(held.ghosts).toEqual([]);
	expect(held.impacts).toEqual([]);
	expect(
		pairSeparation(box, { ...a.end, origin: held.pos }, box, b.end).overlap,
	).toBe(false);
});

const hulls = ["courier", "carrier", "freighter", "patrol"] as const;
for (let i = 0; i < hulls.length; i++)
	for (let j = i; j < hulls.length; j++)
		for (const turn of [-1, 1])
			test(`resting pair order preserves damage for ${hulls[i]}/${hulls[j]} at ${turn} rad/s`, () => {
				const make = (
					hull: HullId,
					centreX: number,
					rate: number,
				): ShipMotion => {
					const s = HULL_SPECS[hull];
					const origin = v3(
						// At +z nose, shipPose's right axis is -x.
						centreX + s.envCentre.rightKm,
						-s.envCentre.upKm,
						-s.envCentre.foreKm,
					);
					return {
						massT: s.massT,
						primitives: [hullBox(s.env, s.envCentre)],
						start: shipPose(origin, v3(0, 0, 1), v3(0, 1, 0)),
						end: shipPose(
							origin,
							v3(Math.sin(rate * dt), 0, Math.cos(rate * dt)),
							v3(0, 1, 0),
						),
						velStart: v3(),
						velEnd: v3(),
					};
				};
				const a = make(hulls[i], 0, turn);
				const b = make(
					hulls[j],
					(HULL_SPECS[hulls[i]].env.beamKm + HULL_SPECS[hulls[j]].env.beamKm) /
						2 +
						SEPARATION_KM,
					0,
				);
				const gap = pairSeparation(
					a.primitives[0],
					a.start,
					b.primitives[0],
					b.start,
				);
				expect(gap.overlap).toBe(false);
				if (gap.overlap) throw new Error("resting fixture starts overlapped");
				expect(gap.distanceKm).toBeCloseTo(SEPARATION_KM, 12);
				const ab = sweepShipPair(a, b, dt);
				const ba = sweepShipPair(b, a, dt);
				expect([ab.ghost, ba.ghost]).toEqual([false, false]);
				const damage = (pair: ReturnType<typeof sweepShipPair>) =>
					pair.impacts.reduce((sum, impact) => sum + impact.damage, 0);
				expect(damage(ab)).toBeCloseTo(damage(ba), 10);
				for (const pair of [ab, ba]) {
					expect(pair.a.vel).toEqual(v3());
					expect(pair.b.vel).toEqual(v3());
				}
				for (const pair of [ab, { a: ba.b, b: ba.a }])
					expect(
						pairSeparation(
							a.primitives[0],
							{ ...a.end, origin: pair.a.pos },
							b.primitives[0],
							{ ...b.end, origin: pair.b.pos },
						).overlap,
					).toBe(false);
			});
