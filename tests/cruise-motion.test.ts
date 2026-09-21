import { expect, test } from "bun:test";
import {
	advanceCruise,
	type CruiseParams,
	DEFAULT_CRUISE,
	MAX_SUBSTEPS,
	type Mass,
	relativeSphereEntryTime,
	sphereEntry,
} from "../src/cruise";
import { MAX_DT } from "../src/units";
import { add, length, scale, sub, type Vec3, v3 } from "../src/vec3";

const CONSTANT_CRUISE: CruiseParams = {
	...DEFAULT_CRUISE,
	vMaxKms: 100,
	vMinKms: 100,
	dRefKm: 1,
	exponent: 1,
	vicinityKm: 0,
	dropRadiusKm: 1,
	dropSpeedKms: 1_000,
};

const movingEntry = (
	over: Partial<{
		from: Vec3;
		velocity: Vec3;
		centre: Vec3;
		bodyVelocity: Vec3;
		radius: number;
		guardRadius: number;
		dt: number;
	}> = {},
) => {
	const c = {
		from: v3(-20, 10.5, 0),
		velocity: v3(400, 0, 0),
		centre: v3(),
		bodyVelocity: v3(0, 20, 0),
		radius: 10,
		guardRadius: 15,
		dt: 0.1,
		...over,
	};
	return relativeSphereEntryTime(
		c.from,
		c.velocity,
		c.dt,
		c.centre,
		c.bodyVelocity,
		c.guardRadius,
		c.radius,
	);
};

test("relative sweep catches a chord a snapshot releases", () => {
	const from = v3(-5, 10.5, 0);
	const velocity = v3(100, 0, 0);
	expect(sphereEntry(from, v3(1, 0, 0), 10, v3(), 10)).toBeNull();
	expect(movingEntry({ from, velocity })).toBe(0);
});

test("relative sweep releases an outward escape from a shell", () => {
	expect(
		movingEntry({ from: v3(0, 11, 0), velocity: v3(0, 100, 0) }),
	).toBeNull();
});

test("a receding body does not block a safe tangent", () => {
	expect(
		movingEntry({
			from: v3(-5, 10.5, 0),
			velocity: v3(100, 0, 0),
			bodyVelocity: v3(0, -20, 0),
		}),
	).toBeNull();
});

test("a stationary ship is still intersected by a moving body", () => {
	expect(movingEntry({ from: v3(0, 11, 0), velocity: v3() })).toBe(0);
});

test("event time uses relative speed and stays inside the finite step", () => {
	const c = {
		from: v3(-30, 0, 0),
		velocity: v3(100, 0, 0),
		bodyVelocity: v3(-100, 0, 0),
		dt: 0.2,
	};
	expect(movingEntry(c)).toBeCloseTo(0.075, 12);
	expect(movingEntry({ ...c, dt: 0.05 })).toBeNull();
});

test("relative events are invariant under a common frame velocity", () => {
	const c = {
		from: v3(-30, 0, 0),
		velocity: v3(100, 0, 0),
		bodyVelocity: v3(-100, 0, 0),
		dt: 0.2,
	};
	const boost = v3(10_000, -70, 123);
	expect(
		movingEntry({
			...c,
			velocity: add(c.velocity, boost),
			bodyVelocity: add(c.bodyVelocity, boost),
		}),
	).toBeCloseTo(movingEntry(c)!, 12);
});

test("body-frame carry prevents a stopped ship being overtaken", () => {
	const body: Mass = {
		id: "moving",
		pos: v3(),
		radiusKm: 10,
		vel: v3(0, 20, 0),
	};
	const step = advanceCruise({
		pos: v3(0, 10.5, 0),
		nose: v3(0, -1, 0),
		throttle: 1,
		dt: 0.1,
		masses: [body],
		target: null,
		params: CONSTANT_CRUISE,
		chargeAu: 1,
		targetParentId: null,
	});
	expect(step.exit).toBe("proximity");
	expect(step.travelledKm).toBe(0);
	expect(step.pos).toEqual(v3(0, 12.5, 0));
	const bodyEnd = add(body.pos, scale(body.vel!, 0.1));
	expect(length(sub(step.pos, bodyEnd))).toBe(10.5);
});

test("drive travel excludes passive carry after a proximity stop", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.1,
		masses: [
			{
				id: "moving",
				pos: v3(10, 0, 0),
				radiusKm: 1,
				vel: v3(0, 1, 0),
			},
		],
		target: null,
		params: CONSTANT_CRUISE,
		chargeAu: 1,
		targetParentId: null,
	});
	expect(step.exit).toBe("proximity");
	expect(step.travelledKm).toBeCloseTo(step.pos.x, 9);
	expect(length(step.pos)).toBeGreaterThan(step.travelledKm);
});

test("post-stop carry sweeps a second body's surface", () => {
	const crossing: Mass = {
		id: "crossing",
		pos: v3(0, -30, 0),
		radiusKm: 10,
		vel: v3(0, 600, 0),
	};
	const second: Mass = {
		id: "second",
		pos: v3(0, 40.5, 0),
		radiusKm: 0.1,
	};
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 0,
		dt: 0.1,
		masses: [crossing, second],
		target: null,
		params: CONSTANT_CRUISE,
		targetParentId: null,
	});
	const crossingEnd = add(crossing.pos, scale(crossing.vel!, 0.1));
	expect(step.exit).toBe("proximity");
	expect(step.exitBodyId).toBe("second");
	expect(length(sub(step.pos, second.pos))).toBeGreaterThanOrEqual(
		second.radiusKm,
	);
	expect(length(sub(step.pos, crossingEnd))).toBeGreaterThanOrEqual(
		crossing.radiusKm,
	);
});

test("a frame-end proximity stop retains its blocker identity", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 0,
		dt: 0.02949999999,
		masses: [
			{
				id: "frame-end",
				pos: v3(4, 0, 0),
				radiusKm: 1,
				vel: v3(-100, 0, 0),
			},
		],
		target: null,
		params: CONSTANT_CRUISE,
		targetParentId: null,
	});
	expect(step.exit).toBe("proximity");
	expect(step.exitBodyId).toBe("frame-end");
});

test("simultaneous incompatible blocker carries terminate", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(0, 1, 0),
		throttle: 0,
		dt: 0.1,
		masses: [
			{ id: "left", pos: v3(-1.04, 0, 0), radiusKm: 1, vel: v3(1, 0, 0) },
			{
				id: "right",
				pos: v3(1.04, 0, 0),
				radiusKm: 1,
				vel: v3(-1, 0, 0),
			},
		],
		target: null,
		params: CONSTANT_CRUISE,
		targetParentId: null,
	});
	expect(step.exit).toBe("proximity");
	expect(Number.isFinite(step.pos.x)).toBe(true);
	expect(Math.abs(step.pos.x)).toBeLessThanOrEqual(0.05);
});

test("relative sweep catches a body crossing between both endpoint samples", () => {
	const body: Mass = {
		id: "crossing",
		pos: v3(0, -30, 0),
		radiusKm: 10,
		vel: v3(0, 600, 0),
	};
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 0,
		dt: 0.1,
		masses: [body],
		target: null,
		params: CONSTANT_CRUISE,
		targetParentId: null,
	});
	expect(length(sub(v3(), body.pos))).toBeGreaterThan(body.radiusKm);
	expect(
		length(sub(v3(), add(body.pos, scale(body.vel!, 0.1)))),
	).toBeGreaterThan(body.radiusKm);
	expect(step.exit).toBe("proximity");
	expect(step.travelledKm).toBe(0);
	expect(
		length(sub(step.pos, add(body.pos, scale(body.vel!, 0.1)))),
	).toBeCloseTo(body.radiusKm * 1.05, 8);
});

test("the last adaptive substep sweeps the frame remainder", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.1,
		masses: [
			{
				id: "late-crossing",
				pos: v3(0, -30, 0),
				radiusKm: 10,
				vel: v3(0, 600, 0),
			},
		],
		// Near-zero target range forces the 1 ns adaptive floor. Its arrival-speed
		// gate is closed, so only the body crossing later in the frame can end it.
		target: { pos: v3(1e-12, 0, 0), radiusKm: 0 },
		params: { ...CONSTANT_CRUISE, dropSpeedKms: 0 },
		targetParentId: null,
	});
	expect(step.substeps).toBe(MAX_SUBSTEPS);
	expect(step.exit).toBe("proximity");
	expect(step.exitBodyId).toBe("late-crossing");
});

test("charge exhaustion does not bypass a moving-body check", () => {
	const body: Mass = {
		id: "crossing",
		pos: v3(0, -30, 0),
		radiusKm: 10,
		vel: v3(0, 600, 0),
	};
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.1,
		masses: [body],
		target: null,
		params: CONSTANT_CRUISE,
		chargeAu: 0,
		targetParentId: null,
	});
	expect(step.exit).toBe("proximity");
	expect(step.starved).toBe(false);
	expect(step.travelledKm).toBe(0);
});

test("co-moving below-surface states stop while relative outward motion recovers", () => {
	expect(
		relativeSphereEntryTime(
			v3(0, 9, 0),
			v3(0, 20, 0),
			0.1,
			v3(),
			v3(0, 20, 0),
			10.5,
			10,
		),
	).toBe(0);
	expect(
		relativeSphereEntryTime(
			v3(0, 9, 0),
			v3(0, 30, 0),
			0.1,
			v3(),
			v3(0, 20, 0),
			10.5,
			10,
		),
	).toBeNull();
});

test("an idle ship does not call target recession a closest-approach arrival", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 0,
		dt: 0.1,
		masses: [],
		target: { pos: v3(500, 0, 0), radiusKm: 1, vel: v3(30, 0, 0) },
		params: DEFAULT_CRUISE,
		targetParentId: null,
	});
	expect(step.dropped).toBe(false);
	expect(step.exit).toBeNull();
	expect(step.pos).toEqual(v3());
});

test("an early arrival follows its target through the frame remainder", () => {
	const target = { pos: v3(10, 0, 0), radiusKm: 1, vel: v3(20, 0, 0) };
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.2,
		masses: [],
		target,
		params: CONSTANT_CRUISE,
		targetParentId: null,
	});
	const targetEnd = add(target.pos, scale(target.vel, 0.2));
	expect(step.exit).toBe("arrival");
	expect(length(sub(step.pos, targetEnd))).toBeCloseTo(1, 8);
});

test("a time-zero arrival carries with its target and still loses a surface tie", () => {
	const target = { pos: v3(10, 0, 0), radiusKm: 1, vel: v3(20, 0, 0) };
	const input = {
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 0,
		dt: 0.1,
		target,
		params: DEFAULT_CRUISE,
		targetParentId: null,
	};
	const arrival = advanceCruise({ ...input, masses: [] });
	expect(arrival.exit).toBe("arrival");
	expect(arrival.pos).toEqual(v3(2, 0, 0));

	const blocked = advanceCruise({
		...input,
		masses: [{ id: "surface", pos: v3(), radiusKm: 5 }],
	});
	expect(blocked.exit).toBe("proximity");
	expect(blocked.exitBodyId).toBe("surface");
});

test("a closest-approach arrival carries through the unconsumed frame", () => {
	const segments: { duration: number; powered: boolean }[] = [];
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.1,
		masses: [],
		target: { pos: v3(5, 2, 0), radiusKm: 1, vel: v3(20, 0, 0) },
		params: { ...CONSTANT_CRUISE, vicinityKm: 100, approachLeadS: 0.001 },
		targetParentId: null,
		onSegment: ({ duration, powered }) => segments.push({ duration, powered }),
	});
	expect(step.exit).toBe("arrival");
	expect(segments.at(-1)?.powered).toBe(false);
	expect(segments.at(-1)?.duration).toBeGreaterThan(0);
	expect(step.pos.x).toBeGreaterThan(step.travelledKm);
});

test("a surface crossing during closest-approach carry overrides arrival", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.1,
		masses: [{ id: "carry-blocker", pos: v3(6.9, 0, 0), radiusKm: 0.2 }],
		target: { pos: v3(5, 2, 0), radiusKm: 1, vel: v3(20, 0, 0) },
		params: { ...CONSTANT_CRUISE, vicinityKm: 100, approachLeadS: 0.001 },
		targetParentId: null,
	});
	expect(step.exit).toBe("proximity");
	expect(step.exitBodyId).toBe("carry-blocker");
	expect(step.pos.x).toBeCloseTo(6.9 - 0.2 * 1.05, 8);
});

test("the earliest blocker wins independent of mass order", () => {
	const near: Mass = { id: "near", pos: v3(10, 0, 0), radiusKm: 1 };
	const far: Mass = { id: "far", pos: v3(20, 0, 0), radiusKm: 1 };
	const fly = (masses: Mass[]) =>
		advanceCruise({
			pos: v3(),
			nose: v3(1, 0, 0),
			throttle: 1,
			dt: 0.2,
			masses,
			target: null,
			params: CONSTANT_CRUISE,
			targetParentId: null,
		});
	for (const masses of [
		[far, near],
		[near, far],
	]) {
		const step = fly(masses);
		expect(step.exitBodyId).toBe("near");
		expect(step.pos.x).toBeCloseTo(8.95, 8);
	}
});

test("a blocker before the station wins the event ordering", () => {
	const step = advanceCruise({
		pos: v3(),
		nose: v3(1, 0, 0),
		throttle: 1,
		dt: 0.2,
		masses: [{ id: "host", pos: v3(10, 0, 0), radiusKm: 1 }],
		target: { pos: v3(20, 0, 0), radiusKm: 1 },
		params: CONSTANT_CRUISE,
		targetParentId: "host",
	});
	expect(step.exit).toBe("proximity");
	expect(step.exitBodyId).toBe("host");
});

test("the acceleration bound conservatively catches curved near-tangencies", () => {
	const common = {
		id: "curve",
		pos: v3(0, 10.6, 0),
		radiusKm: 10,
		vel: v3(),
	};
	const fly = (mass: Mass) =>
		advanceCruise({
			pos: v3(-20, 0, 0),
			nose: v3(1, 0, 0),
			throttle: 1,
			dt: 0.1,
			masses: [mass],
			target: null,
			params: { ...CONSTANT_CRUISE, vMaxKms: 400, vMinKms: 400 },
			targetParentId: null,
		});
	expect(fly(common).exit).toBeNull();
	expect(fly({ ...common, accelerationBoundKms2: 100 }).exit).toBe("proximity");
});

test("moving-body stop geometry is stable at 30, 60, 120 Hz and MAX_DT", () => {
	const run = (dt: number) => {
		let pos = v3(-100, 0, 0);
		let centre = v3(0, -2, 0);
		const vel = v3(0, 5, 0);
		for (let i = 0; i < 10 / dt; i++) {
			const step = advanceCruise({
				pos,
				nose: v3(1, 0, 0),
				throttle: 1,
				dt,
				masses: [{ id: "body", pos: centre, radiusKm: 10, vel }],
				target: null,
				params: CONSTANT_CRUISE,
				targetParentId: null,
			});
			pos = step.pos;
			centre = add(centre, scale(vel, dt));
			if (step.dropped)
				return {
					clearance: length(sub(pos, centre)) - 10,
					travelled: step.travelledKm,
				};
		}
		throw new Error("body was not reached");
	};
	for (const dt of [1 / 30, 1 / 60, 1 / 120, MAX_DT]) {
		const result = run(dt);
		expect(result.clearance).toBeGreaterThanOrEqual(0.5 - 1e-8);
		expect(result.travelled).toBeGreaterThanOrEqual(0);
	}
});
