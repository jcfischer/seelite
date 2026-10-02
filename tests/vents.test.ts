/**
 * The vent substrate (`flight-model.md` §3, #619): one test per decision.
 *
 * Every law is swept over frame deltas — a law that only holds at one `dt` is
 * not a law — and the reproduction rows run against #5's laws as they were,
 * kept in `scripts/lib/legacy-flight.ts`, and against #181's handling law,
 * kept in `scripts/measure-vent-shares.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	VENT_SLOTS,
	type VentSlot,
} from "../src/hull";
import {
	ASSIST_CAP_KMS,
	type Angular,
	type FlightControl,
	type FlightPerformance,
	NO_ATTITUDE,
	type Ship,
	flightPerformance,
	speedDemand,
	stepAngular,
	stepFlight,
	thrustShares,
	ventLoads,
} from "../src/sim";
import { MAX_DT } from "../src/units";
import { type Vec3, cross, dot, length, scale, sub, v3 } from "../src/vec3";
import {
	easeOutCost,
	referenceHandling,
	roundShare,
	solveVentShares,
} from "../scripts/measure-vent-shares";
import { legacyAngular, legacyAssisted } from "../scripts/lib/legacy-flight";

const STEPS = [1 / 120, 1 / 60, 0.05, MAX_DT];
const COURIER = flightPerformance("courier");
const NOSE = v3(0, 0, -1);
const UP = v3(0, 1, 0);
const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };

const loadsOf = (
	levels: Partial<Record<VentSlot, number>>,
	id: HullId = "courier",
) => ventLoads(levels, HULL_SPECS[id].vents, HULL_SPECS[id].thrustMN, {});

const control = (over: Partial<FlightControl> = {}): FlightControl => ({
	nose: NOSE,
	up: UP,
	demand: speedDemand(0),
	assist: true,
	attitude: NO_ATTITUDE,
	...over,
});

const near = (v: Vec3, eps = 1e-9) => length(v) < eps;

describe("§3.3 every hull declares its vents as plain data", () => {
	test("every hull fills every slot, once", () => {
		for (const id of HULL_IDS)
			expect(HULL_SPECS[id].vents.map((v) => v.slot).sort()).toEqual(
				[...VENT_SLOTS].sort(),
			);
	});

	test("every vent sits inside its hull's envelope and pushes along a unit axis", () => {
		for (const id of HULL_IDS) {
			const { beamKm, heightKm, lengthKm } = HULL_SPECS[id].env;
			for (const vent of HULL_SPECS[id].vents) {
				const [x, y, z] = vent.posKm;
				expect(Math.abs(x)).toBeLessThanOrEqual(beamKm / 2 + 1e-12);
				expect(Math.abs(y)).toBeLessThanOrEqual(heightKm / 2 + 1e-12);
				expect(Math.abs(z)).toBeLessThanOrEqual(lengthKm / 2 + 1e-12);
				expect(Math.hypot(...vent.dir)).toBe(1);
			}
		}
	});

	test("the table survives a JSON round trip unchanged", () => {
		for (const id of HULL_IDS)
			expect(JSON.parse(JSON.stringify(HULL_SPECS[id].vents))).toEqual(
				HULL_SPECS[id].vents,
			);
	});
});

describe("§3.1 and §3.2: force and torque are sums over the vents that fire", () => {
	const PAIRS: [string, VentSlot, VentSlot][] = [
		["a translation pair", "strafe-fore-port", "strafe-aft-port"],
		[
			"a vertical translation pair",
			"strafe-fore-ventral",
			"strafe-aft-ventral",
		],
		["the retro pair", "retro-port", "retro-starboard"],
	];
	for (const [name, a, b] of PAIRS)
		test(`${name} fired the same way is force and no torque`, () => {
			const { force, torque } = loadsOf({ [a]: 1, [b]: 1 });
			expect(length(force)).toBeGreaterThan(0);
			expect(near(torque)).toBe(true);
		});

	const COUPLES: [string, VentSlot, VentSlot][] = [
		["a yaw couple", "fore-starboard-lateral", "aft-port-lateral"],
		["a pitch couple", "fore-ventral-vertical", "aft-dorsal-vertical"],
		["a roll couple", "port-dorsal-roll", "starboard-ventral-roll"],
	];
	for (const [name, a, b] of COUPLES)
		test(`${name} is torque and no force`, () => {
			const { force, torque } = loadsOf({ [a]: 1, [b]: 1 });
			expect(near(force)).toBe(true);
			expect(length(torque)).toBeGreaterThan(0);
		});

	test("one attitude vent fired alone both pushes and turns", () => {
		const { force, torque } = loadsOf({ "fore-port-lateral": 1 });
		expect(length(force)).toBeGreaterThan(0);
		expect(length(torque)).toBeGreaterThan(0);
	});

	test("opposite demands on one axis cancel exactly", () => {
		for (const axis of ["pitch", "yaw", "roll"] as const) {
			const { plus, minus } = COURIER.axisSlots[axis];
			const all = Object.fromEntries([...plus, ...minus].map((s) => [s, 1]));
			const { force, torque } = loadsOf(all);
			expect(near(force)).toBe(true);
			expect(near(torque)).toBe(true);
		}
	});

	test("every axis has a plus and a minus set on every hull", () => {
		for (const id of HULL_IDS) {
			const { axisSlots } = flightPerformance(id);
			for (const sets of Object.values(axisSlots)) {
				expect(sets.plus.length).toBeGreaterThan(0);
				expect(sets.minus.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("§3.4: the shares reproduce #181's handling on every hull", () => {
	test("the stored shares are the solver's", () => {
		for (const id of HULL_IDS) {
			const solved = solveVentShares(id);
			const stored = HULL_SPECS[id].ventShares;
			for (const key of Object.keys(solved) as (keyof typeof solved)[])
				expect(stored[key]).toBe(roundShare(solved[key]));
		}
	});

	test("every hull flies its pre-vent figures, to the stored precision", () => {
		for (const id of HULL_IDS) {
			const vents = flightPerformance(id);
			const ref = referenceHandling(id);
			const rel = (a: number, b: number) => Math.abs(a / b - 1);
			expect(rel(vents.thrustKms2, ref.thrustKms2)).toBeLessThan(1e-12);
			expect(rel(vents.retroKms2, ref.thrustKms2)).toBeLessThan(1e-12);
			expect(rel(vents.assistLateralTauS, ref.assistLateralTauS)).toBeLessThan(
				1e-12,
			);
			for (const axis of ["pitch", "yaw", "roll"] as const) {
				expect(
					rel(vents.angularAuthority[axis], ref.angularAccel),
				).toBeLessThan(1e-5);
				expect(rel(vents.angularMax[axis], ref.angularMax[axis])).toBeLessThan(
					1e-5,
				);
			}
			expect(rel(vents.angularDampTauS, ref.angularDampTauS)).toBeLessThan(
				1e-5,
			);
		}
	});

	test("the courier is #5's ship: 2 km/s², 1.2 s, 0.9/0.9/1.4 rad/s, 0.28 s", () => {
		expect(COURIER.thrustKms2).toBe(2);
		expect(COURIER.assistLateralTauS).toBe(1.2);
		expect(COURIER.angularMax).toEqual({ pitch: 0.9, yaw: 0.9, roll: 1.4 });
		expect(COURIER.angularDampTauS).toBe(0.28);
		expect(COURIER.angularAccel).toBeCloseTo(3, 5);
	});

	test("a translation pair can remove any drift inside the cap at #5's rate", () => {
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			expect(perf.strafeKms2).toBeGreaterThanOrEqual(
				ASSIST_CAP_KMS / perf.assistLateralTauS,
			);
		}
	});
});

describe("§3.6 and §3.8: the assist on is #5's law, composed into firings", () => {
	for (const dt of STEPS)
		test(`inside the cap the velocity trace is #5's, dt ${dt.toFixed(4)}`, () => {
			const ship: Ship = { pos: v3(), vel: v3(1, 0.4, 0) };
			let legacy = { ...ship.vel };
			for (let i = 0; i < 6 / dt; i++) {
				const throttle = i * dt < 3 ? 0.6 : 0.2;
				stepFlight(
					ship,
					control({ demand: speedDemand(throttle) }),
					dt,
					COURIER,
				);
				legacy = legacyAssisted(legacy, NOSE, throttle, dt, COURIER);
				expect(length(sub(ship.vel, legacy))).toBeLessThan(1e-12);
			}
		});

	for (const dt of STEPS)
		test(`a hard turn at the cap never exceeds it, dt ${dt.toFixed(4)}`, () => {
			const ship: Ship = { pos: v3(), vel: v3(ASSIST_CAP_KMS, 0, 0) };
			for (let i = 0; i < 12 / dt; i++) {
				stepFlight(ship, control({ demand: speedDemand(1) }), dt, COURIER);
				expect(length(ship.vel)).toBeLessThanOrEqual(ASSIST_CAP_KMS + 1e-12);
			}
			expect(length(sub(ship.vel, scale(NOSE, ASSIST_CAP_KMS)))).toBeLessThan(
				1e-3,
			);
		});

	for (const dt of STEPS)
		test(`above the cap the assist burns retro at the vents' authority, dt ${dt.toFixed(4)}`, () => {
			const ship: Ship = { pos: v3(), vel: scale(NOSE, 5) };
			let speed = 5;
			let saturatedSteps = 0;
			while (speed > ASSIST_CAP_KMS + 1e-9) {
				const step = stepFlight(
					ship,
					control({ demand: speedDemand(1) }),
					dt,
					COURIER,
				);
				const next = length(ship.vel);
				expect(speed - next).toBeLessThanOrEqual(
					COURIER.retroKms2 * dt + 1e-12,
				);
				if (step.saturated.surge) saturatedSteps++;
				expect(step.firing["retro-port"]).toBeGreaterThan(0);
				expect(step.firing.main ?? 0).toBe(0);
				speed = next;
			}
			expect(saturatedSteps).toBeGreaterThan(0);
			expect(speed).toBeCloseTo(ASSIST_CAP_KMS, 9);
		});

	test("drift inside the envelope never saturates the translation pairs", () => {
		const ship: Ship = { pos: v3(), vel: v3(ASSIST_CAP_KMS, 0, 0) };
		const step = stepFlight(
			ship,
			control({ demand: speedDemand(0) }),
			MAX_DT,
			COURIER,
		);
		expect(step.saturated.sway).toBe(false);
		expect(step.firing["strafe-fore-starboard"]).toBeGreaterThan(0);
	});

	test("a strafe demand with the assist on holds a velocity across the nose", () => {
		const ship: Ship = { pos: v3(), vel: v3() };
		for (let i = 0; i < 20 / 0.05; i++)
			stepFlight(
				ship,
				control({ demand: { surge: 0, sway: 0.5, heave: 0 } }),
				0.05,
				COURIER,
			);
		expect(dot(ship.vel, cross(NOSE, UP))).toBeCloseTo(0.5 * ASSIST_CAP_KMS, 6);
	});
});

describe("§3.6: with the assist off every demand is a force", () => {
	for (const dt of STEPS)
		test(`no speed cap: the main drive accelerates without limit, dt ${dt.toFixed(4)}`, () => {
			const ship: Ship = { pos: v3(), vel: v3() };
			for (let i = 0; i < 4 / dt; i++)
				stepFlight(
					ship,
					control({ assist: false, demand: speedDemand(1) }),
					dt,
					COURIER,
				);
			expect(length(ship.vel)).toBeCloseTo(
				COURIER.thrustKms2 * Math.round(4 / dt) * dt,
				9,
			);
			expect(length(ship.vel)).toBeGreaterThan(ASSIST_CAP_KMS);
		});

	test("a negative surge fires the retro pair, and a strafe is a push across the nose", () => {
		const ship: Ship = { pos: v3(), vel: v3() };
		const step = stepFlight(
			ship,
			control({ assist: false, demand: { surge: -1, sway: 1, heave: 0 } }),
			0.1,
			COURIER,
		);
		expect(step.firing["retro-starboard"]).toBe(1);
		expect(step.firing["strafe-aft-port"]).toBe(1);
		expect(dot(ship.vel, NOSE)).toBeCloseTo(-COURIER.retroKms2 * 0.1, 12);
		expect(dot(ship.vel, cross(NOSE, UP))).toBeCloseTo(
			COURIER.strafeKms2 * 0.1,
			12,
		);
	});

	test("nothing held, nothing changes", () => {
		const ship: Ship = { pos: v3(), vel: v3(3, -1, 2) };
		const step = stepFlight(ship, control({ assist: false }), 0.1, COURIER);
		expect(ship.vel).toEqual(v3(3, -1, 2));
		expect(Object.values(step.firing).every((l) => l === 0)).toBe(true);
	});
});

describe("§3.9: rotation", () => {
	for (const dt of STEPS)
		test(`assist off conserves angular momentum with nothing held, dt ${dt.toFixed(4)}`, () => {
			let rates: Angular = { pitch: 2.5, yaw: -4, roll: 7 };
			for (let i = 0; i < 3 / dt; i++)
				rates = stepAngular(rates, STILL, STILL, false, dt, COURIER).rates;
			expect(rates).toEqual({ pitch: 2.5, yaw: -4, roll: 7 });
		});

	for (const dt of STEPS)
		test(`assist off has no rate cap: a held axis accelerates at its authority, dt ${dt.toFixed(4)}`, () => {
			let rates = STILL;
			const n = Math.round(2 / dt);
			for (let i = 0; i < n; i++)
				rates = stepAngular(
					rates,
					{ pitch: 0, yaw: 1, roll: 0 },
					STILL,
					false,
					dt,
					COURIER,
				).rates;
			expect(rates.yaw).toBeCloseTo(COURIER.angularAuthority.yaw * n * dt, 9);
			expect(rates.yaw).toBeGreaterThan(COURIER.angularMax.yaw);
		});

	for (const dt of STEPS)
		test(`assist on above the cap comes down at the couple's authority, dt ${dt.toFixed(4)}`, () => {
			let rates: Angular = { pitch: 0, yaw: 0, roll: 6 };
			let previous = 6;
			while (rates.roll > COURIER.angularMax.roll + 1e-12) {
				const step = stepAngular(
					rates,
					{ pitch: 0, yaw: 0, roll: -1 },
					STILL,
					true,
					dt,
					COURIER,
				);
				expect(previous - step.rates.roll).toBeLessThanOrEqual(
					COURIER.angularAuthority.roll * dt + 1e-12,
				);
				rates = step.rates;
				previous = rates.roll;
			}
			expect(rates.roll).toBeCloseTo(COURIER.angularMax.roll, 9);
		});

	for (const dt of STEPS)
		test(`assist on easing in is #5's law exactly, dt ${dt.toFixed(4)}`, () => {
			let rates = STILL;
			let legacy = STILL;
			const stick = { pitch: 0.7, yaw: -1, roll: 0.4 };
			for (let i = 0; i < 2 / dt; i++) {
				const step = stepAngular(rates, stick, STILL, true, dt, COURIER);
				// #5 had one authority; each axis's couple is solved to it and is
				// read here at its own, which differ in the sixth figure.
				const previous = legacy;
				legacy = { ...STILL };
				for (const axis of ["pitch", "yaw", "roll"] as const)
					legacy[axis] = legacyAngular(previous, stick, STILL, true, dt, {
						...COURIER,
						angularAccel: COURIER.angularAuthority[axis],
					})[axis];
				rates = step.rates;
				for (const axis of ["pitch", "yaw", "roll"] as const)
					expect(rates[axis]).toBeCloseTo(legacy[axis], 12);
				expect(Object.values(step.saturated).some(Boolean)).toBe(false);
			}
		});

	// The principal ruled the bounded ease-out on the courier's 5.9% and
	// re-confirmed it on the roster's figures (#619, 2026-10-02): worst the
	// patrol's roll at 15.4%. The bound is 20% so a retune that only moves the
	// figures stays green; a change that makes some hull's stop markedly
	// slower, or one that stops *faster* than #5, goes red.
	for (const id of HULL_IDS)
		test(`${id}: the ease-out is #5's but for its bound, at most 20% slower`, () => {
			const cost = easeOutCost(id);
			for (const axis of ["pitch", "yaw", "roll"] as const) {
				expect(cost[axis]).toBeGreaterThanOrEqual(-1e-9);
				expect(cost[axis]).toBeLessThan(0.2);
			}
		});

	test("the bound bites where the ease-out asks more than the couple: not on the slow hulls", () => {
		expect(easeOutCost("courier").pitch).toBeLessThan(1e-9);
		expect(easeOutCost("courier").roll).toBeGreaterThan(0.03);
		for (const id of ["freighter", "miner", "explorer", "tug"] as const) {
			const cost = easeOutCost(id);
			expect(Math.max(cost.pitch, cost.yaw, cost.roll)).toBeLessThan(1e-9);
		}
	});

	test("a pointer flick is a demand: it moves a rate by at most the couple's authority", () => {
		const dt = 1 / 60;
		for (const assist of [true, false]) {
			const step = stepAngular(
				STILL,
				STILL,
				{ pitch: 0.12, yaw: -0.12, roll: 0 },
				assist,
				dt,
				COURIER,
			);
			expect(Math.abs(step.rates.pitch)).toBeLessThanOrEqual(
				COURIER.angularAuthority.pitch * dt + 1e-12,
			);
			expect(Math.abs(step.rates.yaw)).toBeLessThanOrEqual(
				COURIER.angularAuthority.yaw * dt + 1e-12,
			);
		}
	});

	test("an attitude step from whole vents puts no force on the hull", () => {
		const step = stepAngular(
			STILL,
			{ pitch: 1, yaw: -1, roll: 1 },
			STILL,
			true,
			0.05,
			COURIER,
		);
		expect(near(step.linearKms2)).toBe(true);
	});
});

describe("§3.5 and §3.7: a single vent, and a vent's health", () => {
	test("a single vent fired directly turns and pushes the hull", () => {
		const turned = stepAngular(STILL, STILL, STILL, false, 0.1, COURIER, {
			"aft-port-lateral": 1,
		});
		expect(turned.rates.yaw).not.toBe(0);
		expect(length(turned.linearKms2)).toBeGreaterThan(0);
		const ship: Ship = { pos: v3(), vel: v3() };
		stepFlight(
			ship,
			control({ assist: false, attitude: turned }),
			0.1,
			COURIER,
		);
		expect(dot(ship.vel, cross(NOSE, UP))).toBeGreaterThan(0);
	});

	test("a dead lateral vent makes a yaw pull sideways", () => {
		const whole = stepAngular(
			STILL,
			{ pitch: 0, yaw: 1, roll: 0 },
			STILL,
			false,
			0.1,
			COURIER,
		);
		const hurt = flightPerformance("courier", { "aft-port-lateral": 0 });
		const dead = stepAngular(
			STILL,
			{ pitch: 0, yaw: 1, roll: 0 },
			STILL,
			false,
			0.1,
			hurt,
		);
		expect(near(whole.linearKms2)).toBe(true);
		expect(Math.abs(dead.linearKms2.x)).toBeGreaterThan(0);
		expect(dead.rates.yaw).toBeCloseTo(whole.rates.yaw / 2, 12);
		// The assist's authority is read off a whole hull: the dead vent is a
		// demand it cannot meet, not a smaller one.
		expect(hurt.angularAuthority).toEqual(COURIER.angularAuthority);
	});

	test("a dead translation vent makes a strafe turn the hull", () => {
		const hurt = flightPerformance("courier", { "strafe-aft-port": 0 });
		const ship: Ship = { pos: v3(), vel: v3() };
		const step = stepFlight(
			ship,
			control({ assist: false, demand: { surge: 0, sway: 1, heave: 0 } }),
			0.1,
			hurt,
		);
		expect(step.rates.yaw).not.toBe(0);
	});

	test("health scales force linearly", () => {
		const half = flightPerformance("courier", { main: 0.5 });
		const ship: Ship = { pos: v3(), vel: v3() };
		stepFlight(
			ship,
			control({ assist: false, demand: speedDemand(1) }),
			0.1,
			half,
		);
		expect(length(ship.vel)).toBeCloseTo(COURIER.thrustKms2 * 0.5 * 0.1, 12);
	});
});

describe("§4: thrustShares reads the firing table", () => {
	test("a ship holding its speed fires nothing, one accelerating fires the main drive", () => {
		const holding: Ship = { pos: v3(), vel: scale(NOSE, ASSIST_CAP_KMS) };
		const held = stepFlight(
			holding,
			control({ demand: speedDemand(1) }),
			0.05,
			COURIER,
		);
		expect(thrustShares(held.firing, COURIER).main).toBe(0);
		const rest: Ship = { pos: v3(), vel: v3() };
		const burn = stepFlight(
			rest,
			control({ demand: speedDemand(1) }),
			0.05,
			COURIER,
		);
		expect(thrustShares(burn.firing, COURIER).main).toBe(1);
	});

	test("drift removal is lateral and a turn is rotation", () => {
		const drifting: Ship = { pos: v3(), vel: v3(1, 0, 0) };
		const turn = stepAngular(
			STILL,
			{ pitch: 1, yaw: 0, roll: 0 },
			STILL,
			true,
			0.05,
			COURIER,
		);
		const step = stepFlight(
			drifting,
			control({ attitude: turn }),
			0.05,
			COURIER,
		);
		const shares = thrustShares(step.firing, COURIER);
		expect(shares.lateral).toBeGreaterThan(0);
		expect(shares.rotation).toBe(1);
	});
});
