/**
 * Node #959: the deployed cutter is a second ship primitive in every sweep
 * (#949 D3, #956 Q3), and every impact names the primitive that met the
 * surface (#956 Q4).
 *
 * - **Nose-on** (#956's row C1): the cutter is met first, and before the
 *   stowed ship's hull would be — by the cutter's stand-off over the speed.
 * - **Belly-on**: the hull hangs lower than the cutter, so the hull is met.
 * - **Stowed**: the hull box alone, as every ship list was before the cutter.
 * - **A station proxy and another ship**: the cutter meets them too.
 *
 * The seam is `sweepShip` and `sweepShipPair` with the ship's primitive list
 * from `shipPrimitives`; whether the cutter is deployed is the row's input.
 */

import { describe, expect, test } from "bun:test";
import {
	IDENTITY_AXES,
	RESTING_KM,
	SEPARATION_KM,
	type Pose,
	type Primitive,
	type ShipMotion,
	type SolidMotion,
	cutterBox,
	hullBox,
	pairSeparation,
	shipPose,
	shipPrimitives,
	sweepShip,
	sweepShipPair,
} from "../src/collision";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { ASSIST_CAP_KMS } from "../src/sim";
import { proxySolids, stationProxy } from "../src/station-proxy";
import { type Vec3, add, dot, length, scale, sub, v3 } from "../src/vec3";

const dt = 0.1;
const miner = HULL_SPECS.miner;
const cutter = miner.cutter;
if (!cutter) throw new Error("the miner carries the cutter (#949 D3)");

/** How far forward of the ship's origin each part reaches. */
const HULL_FRONT_KM = miner.envCentre.foreKm + miner.env.lengthKm / 2;
const CUTTER_FRONT_KM = cutter.bowKm + cutter.feedTravelKm;

const still = (primitives: Primitive[], origin = v3()): SolidMotion => ({
	primitives,
	start: { origin, ...IDENTITY_AXES },
	end: { origin, ...IDENTITY_AXES },
	velStart: v3(),
	velEnd: v3(),
});

/** A wall 2 km square, 100 m thick, whose face toward the ship is at `face`
 *  along `out` (a world axis). */
function wall(out: Vec3, face: number): SolidMotion {
	const thick = 0.05;
	return still(
		[
			{
				kind: "box",
				centre: v3(),
				axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
				half: [
					out.x !== 0 ? thick : 1,
					out.y !== 0 ? thick : 1,
					out.z !== 0 ? thick : 1,
				],
			},
		],
		scale(out, face - thick),
	);
}

/** The miner flown straight from `from` by `step` in one tick, nose and up
 *  held. */
function flown(
	deployed: boolean,
	from: Vec3,
	step: Vec3,
	nose: Vec3,
	up: Vec3,
): ShipMotion {
	const vel = scale(step, 1 / dt);
	return {
		massT: miner.massT,
		primitives: shipPrimitives(miner, deployed),
		start: shipPose(from, nose, up),
		end: shipPose(add(from, step), nose, up),
		velStart: vel,
		velEnd: vel,
	};
}

describe("the cutter's box is the ruled geometry (#949 D3)", () => {
	test("rotor ±5.5 m across, −8.91…+2.09 m high, from the bow plane at 42.2 m to 52.8 m", () => {
		const box = cutterBox(cutter);
		if (box.kind !== "box") throw new Error("the cutter is a box");
		const span = (k: "x" | "y" | "z", i: 0 | 1 | 2) =>
			[box.centre[k] - box.half[i], box.centre[k] + box.half[i]].map(
				(km) => Math.round(km * 1e5) / 100,
			);
		expect(span("x", 0)).toEqual([-5.5, 5.5]);
		expect(span("y", 1)).toEqual([-8.91, 2.09]);
		expect(span("z", 2)).toEqual([42.2, 52.8]);
		expect(box.part).toBe("cutter");
	});

	test("only the miner carries one, and a hull without one cannot deploy it", () => {
		expect(HULL_IDS.filter((id) => HULL_SPECS[id].cutter)).toEqual(["miner"]);
		expect(() => shipPrimitives(HULL_SPECS.courier, true)).toThrow();
	});
});

describe("node #959: a deployed cutter is a second ship primitive", () => {
	const nose = v3(1, 0, 0);
	const up = v3(0, 1, 0);
	const speed = ASSIST_CAP_KMS;

	test("nose-on, the impact names the cutter and comes before the stowed hull's (#956 C1)", () => {
		// The hull's nose 100 m from the wall, closing at the assist cap: one
		// tick's travel is 200 m, so both ships meet it inside the step.
		const face = 1;
		const from = v3(face - HULL_FRONT_KM - 0.1, 0, 0);
		const step = v3(speed * dt, 0, 0);
		const deployed = sweepShip(
			flown(true, from, step, nose, up),
			[wall(v3(-1, 0, 0), -face)],
			dt,
		);
		const stowed = sweepShip(
			flown(false, from, step, nose, up),
			[wall(v3(-1, 0, 0), -face)],
			dt,
		);
		expect(deployed.impacts.map((i) => [i.part, i.resting])).toEqual([
			["cutter", false],
		]);
		expect(stowed.impacts.map((i) => [i.part, i.resting])).toEqual([
			["hull", false],
		]);
		const [cut] = deployed.impacts;
		const [hull] = stowed.impacts;
		expect(cut.timeS).toBeLessThan(hull.timeS);
		// Earlier by the cutter's stand-off ahead of the hull, at the speed.
		expect(hull.timeS - cut.timeS).toBeCloseTo(
			(CUTTER_FRONT_KM - HULL_FRONT_KM) / speed,
			5,
		);
		// Met on the cutter's face, and the ship left short of it by the
		// cutter's reach rather than the hull's.
		expect(cut.point.x).toBeCloseTo(face, 6);
		expect(deployed.pos.x).toBeLessThan(face - CUTTER_FRONT_KM);
		expect(stowed.pos.x).toBeGreaterThan(face - CUTTER_FRONT_KM);
	});

	test("belly-on, the hull hangs lower than the cutter and the impact names the hull", () => {
		const floor = -1;
		const from = v3(0, floor + miner.env.heightKm / 2 + 0.1, 0);
		const step = v3(0, -speed * dt, 0);
		const swept = sweepShip(
			flown(true, from, step, nose, up),
			[wall(v3(0, 1, 0), floor)],
			dt,
		);
		expect(swept.impacts.map((i) => [i.part, i.resting])).toEqual([
			["hull", false],
		]);
	});

	test("a boom only the cutter's path crosses is met by the cutter swept, and missed stowed", () => {
		// A 1 m vertical boom at the cutter's station ahead of the hull's nose,
		// crossed sideways at the assist cap: 200 m a tick against a cutter
		// 11 m wide, so a point test at either end of the step sees nothing.
		const boom: Primitive = {
			kind: "capsule",
			a: v3((cutter.bowKm + CUTTER_FRONT_KM) / 2, -0.05, 0),
			b: v3((cutter.bowKm + CUTTER_FRONT_KM) / 2, 0.05, 0),
			radiusKm: 0.0005,
		};
		const starboard = v3(0, 0, 1);
		const from = scale(starboard, -0.1);
		const step = scale(starboard, speed * dt);
		const ends: Pose[] = [
			shipPose(from, nose, up),
			shipPose(add(from, step), nose, up),
		];
		const at: Pose = { origin: v3(), ...IDENTITY_AXES };
		for (const box of shipPrimitives(miner, true))
			for (const end of ends)
				expect(pairSeparation(box, end, boom, at).overlap).toBe(false);
		const deployed = sweepShip(
			flown(true, from, step, nose, up),
			[still([boom])],
			dt,
		);
		const stowed = sweepShip(
			flown(false, from, step, nose, up),
			[still([boom])],
			dt,
		);
		expect(deployed.impacts.map((i) => i.part)).toEqual(["cutter"]);
		expect(deployed.pos.z).toBeLessThan(0);
		expect(stowed.impacts).toEqual([]);
	});

	test("stowed, the ship sweeps its hull box alone, exactly as an unnamed hull list does", () => {
		expect(shipPrimitives(miner, false)).toEqual([
			hullBox(miner.env, miner.envCentre),
		]);
		// A ship list built before the part existed: the same box, unnamed.
		const { part: _, ...unnamed } = hullBox(
			miner.env,
			miner.envCentre,
		) as Primitive & { kind: "box" };
		const from = v3(1 - HULL_FRONT_KM - 0.1, 0.004, -0.003);
		const step = v3(speed * dt, 0, 0);
		const solids = [wall(v3(-1, 0, 0), -1)];
		const stowed = sweepShip(flown(false, from, step, nose, up), solids, dt);
		const before = sweepShip(
			{ ...flown(false, from, step, nose, up), primitives: [unnamed] },
			solids,
			dt,
		);
		expect(stowed).toEqual(before);
		expect(stowed.impacts.map((i) => i.part)).toEqual(["hull"]);
	});
});

describe("node #959: the deployed cutter collides with everything (#956 Q3)", () => {
	test("against a station proxy, nose-on, the impact names the cutter", () => {
		const proxy = stationProxy("trade", "a", 0, 0);
		if (!proxy) throw new Error("the trade Coriolis has a proxy");
		const station = still(proxySolids(proxy).spinning);
		const at: Pose = { origin: v3(), ...IDENTITY_AXES };
		const nose = v3(-1, 0, 0);
		const up = v3(0, 1, 0);
		// Stand the ship off along +x so the cutter's nearest gap to the proxy
		// is 50 m, then close 100 m in one tick.
		const cutterGap = (x: number) => {
			const pose = shipPose(v3(x, 0, 0), nose, up);
			let gap = Number.POSITIVE_INFINITY;
			for (const p of station.primitives) {
				const s = pairSeparation(cutterBox(cutter), pose, p, at);
				if (s.overlap) return Number.NEGATIVE_INFINITY;
				gap = Math.min(gap, s.distanceKm);
			}
			return gap;
		};
		let lo = 0;
		let hi = 10;
		for (let i = 0; i < 60; i++) {
			const mid = (lo + hi) / 2;
			if (cutterGap(mid) > 0.05) hi = mid;
			else lo = mid;
		}
		const from = v3(hi, 0, 0);
		const step = v3(-0.1, 0, 0);
		const deployed = sweepShip(
			flown(true, from, step, nose, up),
			[station],
			dt,
		);
		const stowed = sweepShip(flown(false, from, step, nose, up), [station], dt);
		expect(deployed.ghosts).toEqual([]);
		expect(deployed.impacts.map((i) => i.part)).toEqual(["cutter"]);
		expect(stowed.impacts.map((i) => i.part)).toEqual(["hull"]);
		expect(deployed.impacts[0].timeS).toBeLessThan(stowed.impacts[0].timeS);
	});

	const courier = HULL_SPECS.courier;
	const nose = v3(1, 0, 0);
	const up = v3(0, 1, 0);
	/** A courier at rest, broadside on, with its near flank at `x`. */
	const courierAt = (x: number, vel = v3()): ShipMotion => {
		// Nose +z, so its beam lies along x, and its starboard is −x.
		const origin = v3(
			x + courier.env.beamKm / 2 + courier.envCentre.rightKm,
			0,
			0,
		);
		const pose = shipPose(origin, v3(0, 0, 1), up);
		return {
			massT: courier.massT,
			primitives: shipPrimitives(courier, false),
			start: pose,
			end: { ...pose, origin: add(origin, scale(vel, dt)) },
			velStart: vel,
			velEnd: vel,
		};
	};

	for (const reversed of [false, true]) {
		const order = reversed ? "miner is B" : "miner is A";
		for (const resting of [false, true]) {
			test(`a cutter overlap preserves ${resting ? "an unbilled resting hull hold" : "a swept hull impact"} (${order})`, () => {
				const moving = flown(true, v3(), v3(0.02, 0, 0), nose, up);
				if (resting) moving.velStart = v3();
				// The flank intersects the cutter but leaves the hull clear,
				// either just resting or 4.75 m away and closing this tick.
				const other = courierAt(
					resting ? HULL_FRONT_KM + SEPARATION_KM : 0.047,
				);
				const [hull, cut] = moving.primitives;
				const surface = other.primitives[0];
				const hullStart = pairSeparation(
					hull,
					moving.start,
					surface,
					other.start,
				);
				expect(hullStart.overlap).toBe(false);
				if (hullStart.overlap) throw new Error("the hull must start clear");
				expect(hullStart.distanceKm > RESTING_KM).toBe(!resting);
				expect(
					pairSeparation(cut, moving.start, surface, other.start).overlap,
				).toBe(true);
				// Without resolution the hull penetrates, independently of the
				// cutter overlap that must remain untested.
				expect(
					pairSeparation(hull, moving.end, surface, other.end).overlap,
				).toBe(true);
				const [a, b] = reversed ? [other, moving] : [moving, other];
				const result = sweepShipPair(a, b, dt);
				expect(result.ghost).toBe(true);
				expect(result.impacts.map((i) => [i.partA, i.partB])).toEqual(
					resting ? [] : [["hull", "hull"]],
				);
				const minerEnd = reversed ? result.b : result.a;
				const courierEnd = reversed ? result.a : result.b;
				const apart = pairSeparation(
					hull,
					{ ...moving.end, origin: minerEnd.pos },
					surface,
					{ ...other.end, origin: courierEnd.pos },
				);
				expect(apart.overlap).toBe(false);
				if (apart.overlap) throw new Error("the hull must end separated");
				expect(apart.distanceKm).toBeCloseTo(SEPARATION_KM, 6);
				expect(minerEnd.pos.x).toBeLessThan(moving.end.origin.x);
				expect(courierEnd.pos.x).toBeGreaterThan(other.end.origin.x);
				const relative = dot(sub(minerEnd.vel, courierEnd.vel), v3(-1, 0, 0));
				if (resting) expect(relative).toBeCloseTo(0, 12);
				else {
					expect(result.impacts[0].resting).toBe(false);
					expect(result.impacts[0].damage).toBeGreaterThan(0);
					expect(relative).toBeGreaterThan(0);
				}
				const momentumBefore = add(
					scale(a.velEnd, a.massT),
					scale(b.velEnd, b.massT),
				);
				const momentumAfter = add(
					scale(result.a.vel, a.massT),
					scale(result.b.vel, b.massT),
				);
				expect(length(sub(momentumAfter, momentumBefore))).toBeLessThan(1e-10);
			});
		}

		test(`a cutter-only overlap leaves a departing ship unchanged (${order})`, () => {
			const moving = flown(true, v3(), v3(-0.02, 0, 0), nose, up);
			const other = courierAt(0.047);
			expect(
				pairSeparation(
					moving.primitives[1],
					moving.start,
					other.primitives[0],
					other.start,
				).overlap,
			).toBe(true);
			const [a, b] = reversed ? [other, moving] : [moving, other];
			const result = sweepShipPair(a, b, dt);
			expect(result.ghost).toBe(true);
			expect(result.impacts).toEqual([]);
			expect(result.a).toEqual({ pos: a.end.origin, vel: a.velEnd });
			expect(result.b).toEqual({ pos: b.end.origin, vel: b.velEnd });
		});
	}

	test("against another ship, the miner's deployed cutter is the part that meets it", () => {
		// The miner's cutter face 50 m from the courier's flank, closing 100 m.
		const flank = 0.5;
		const miner100 = flown(
			true,
			v3(flank - CUTTER_FRONT_KM - 0.05, 0, 0),
			v3(0.1, 0, 0),
			nose,
			up,
		);
		const pair = sweepShipPair(miner100, courierAt(flank), dt);
		expect(pair.ghost).toBe(false);
		expect(pair.impacts.map((i) => [i.partA, i.partB])).toEqual([
			["cutter", "hull"],
		]);
	});

	test("a ship flown into a parked miner's deployed cutter names it on the miner's side", () => {
		// The miner parked nose +x; a courier closes on its cutter from ahead.
		const parked = flown(true, v3(), v3(), nose, up);
		const from = CUTTER_FRONT_KM + 0.05;
		const courier100 = courierAt(from, v3(-1, 0, 0));
		const pair = sweepShipPair(courier100, parked, dt);
		expect(pair.ghost).toBe(false);
		expect(pair.impacts.map((i) => [i.partA, i.partB])).toEqual([
			["hull", "cutter"],
		]);
		// And the impact lands on the cutter's face, ahead of the hull's nose.
		expect(pair.impacts[0].point.x).toBeGreaterThan(HULL_FRONT_KM);
		expect(pair.impacts[0].point.x).toBeCloseTo(CUTTER_FRONT_KM, 6);
	});
});
