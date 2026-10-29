/**
 * `docs/specs/collision.md` §9.1, the rows node #661 owes: 9.1.1 (the law),
 * 9.1.2 rows 1–2 (the frame), 9.1.3 (the scale bounds), 9.1.4 (resting on a
 * static surface), 9.1.5 (no tunnelling, on synthetic thin primitives),
 * 9.1.10 (the box is where the ship is) and 9.1.12's first sentence (a
 * cruise keep-out contains its collision sphere, over one whole galaxy). Plus §4.3's ghost rule and
 * §4.2's earliest-first, which the resolver builds.
 *
 * The flight rows go through the real `stepWorld` on a real moon with a real
 * hull's performance, not through a harness of their own: a row that builds
 * its own integrator tests a different object from the one the game flies
 * (#25).
 */

import { useShippedInterceptorHull } from "./setup/interceptor-hull";
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	type Pose,
	type Primitive,
	IDENTITY_AXES,
	RESTITUTION,
	SEPARATION_KM,
	V_SCRAPE_KMS,
	bounce,
	closingSpeed,
	hullBox,
	impactDamage,
	pairSeparation,
	primitiveBox,
	reachKm,
	shipPose,
	sweepShip,
} from "../src/collision";
import { liveGuardRadiusKm } from "../src/cruise";
import { DOCKING_DAMAGE_SCALE, V_GATE_KMS } from "../src/docking";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import { fullCondition, headOnPool } from "../src/ship-condition";
import { buildShipMesh } from "../src/ship-mesh";
import {
	ASSIST_CAP_KMS,
	type Body,
	type HullAttitude,
	type World,
	type WorldImpact,
	bodyVelocity,
	flightPerformance,
	makeSystem,
	makeWorld,
	makeWorldAtSystem,
	speedDemand,
	stepWorld,
} from "../src/sim";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
} from "../src/vec3";

await useShippedInterceptorHull();

const unit = (a: Vec3): Vec3 => scale(a, 1 / length(a));

const solidOf = (hull: HullId): Primitive[] => {
	const spec = HULL_SPECS[hull];
	return [hullBox(spec.env, spec.envCentre)];
};

/**
 * A hull's box posed at `pos` with the nose and up given: its centre and its
 * three axes with their half-extents. Written from the hull table and the
 * attitude alone — not through the resolver's own placement — so a resolver
 * that left the box inside a surface cannot also be the thing that says it
 * did not.
 */
function posedHullBox(
	hull: HullId,
	pos: Vec3,
	nose: Vec3,
	up: Vec3,
): { centre: Vec3; axes: [Vec3, number][] } {
	const spec = HULL_SPECS[hull];
	const right = cross(nose, up);
	const c = spec.envCentre;
	return {
		centre: add(
			pos,
			add(
				add(scale(right, c.rightKm), scale(up, c.upKm)),
				scale(nose, c.foreKm),
			),
		),
		axes: [
			[right, spec.env.beamKm / 2],
			[up, spec.env.heightKm / 2],
			[nose, spec.env.lengthKm / 2],
		],
	};
}

/** The box's gap to a sphere, through `posedHullBox`. */
function boxGapToSphere(
	pos: Vec3,
	nose: Vec3,
	up: Vec3,
	hull: HullId,
	centre: Vec3,
	radiusKm: number,
): number {
	const box = posedHullBox(hull, pos, nose, up);
	const toCentre = sub(centre, box.centre);
	let nearest = box.centre;
	for (const [axis, half] of box.axes) {
		const t = Math.max(-half, Math.min(half, dot(toCentre, axis)));
		nearest = add(nearest, scale(axis, t));
	}
	return length(sub(centre, nearest)) - radiusKm;
}

/** The roster's largest angular rate on any axis, rad/s. */
const LARGEST_RATE = Math.max(
	...HULL_IDS.flatMap((id) => {
		const m = flightPerformance(id).angularMax;
		return [m.pitch, m.yaw, m.roll];
	}),
);

// ---------------------------------------------------------------------------
// The moon every flight row flies at: seed 47, system 0, a 1,813 km moon
// carried at 32 km/s — "about 30 km/s", the speed the frame rows are about.
// ---------------------------------------------------------------------------

const MOON_SEED = 47;
const MOON_ID = "planet-0-moon-0";

function moonWorld(): { world: World; moon: Body } {
	const world = makeWorldAtSystem(MOON_SEED, 0);
	const moon = world.system.byId.get(MOON_ID);
	if (!moon || moon.kind !== "moon") throw new Error("fixture moon is gone");
	return { world, moon };
}

interface Flight {
	thrust?: number;
	assist?: boolean;
	turnAssist?: boolean;
}

/** One `stepWorld` with a speed demand and no stick, collision on. */
function fly(
	world: World,
	at: HullAttitude,
	hull: HullId,
	dt: number,
	flight: Flight = {},
): { at: HullAttitude; impacts: WorldImpact[] } {
	const step = stepWorld(
		world,
		at,
		{
			stick: { pitch: 0, yaw: 0, roll: 0 },
			turnAssist: flight.turnAssist ?? true,
			translation: {
				demand: speedDemand(flight.thrust ?? 0),
				assist: flight.assist ?? false,
			},
		},
		dt,
		flightPerformance(hull),
		solidOf(hull),
	);
	return {
		at: { nose: step.nose, up: step.up, rates: step.rates },
		impacts: step.impacts,
	};
}

/** An attitude with the nose on `nose` and no turn. */
function facing(nose: Vec3): HullAttitude {
	const side = cross(nose, Math.abs(nose.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0));
	return {
		nose,
		up: unit(cross(side, nose)),
		rates: { pitch: 0, yaw: 0, roll: 0 },
	};
}

/**
 * The ship placed over the moon along `outward`, nose down at it, with its
 * box `gapKm` clear of the surface and co-moving with the moon.
 */
function overMoon(
	world: World,
	moon: Body,
	hull: HullId,
	outward: Vec3,
	gapKm: number,
	at: HullAttitude = facing(scale(outward, -1)),
): HullAttitude {
	// The box's lowest point along `outward`, measured from the ship origin.
	const box = posedHullBox(hull, v3(), at.nose, at.up);
	let low = dot(box.centre, outward);
	for (const [axis, half] of box.axes)
		low -= half * Math.abs(dot(axis, outward));
	world.ship.pos = add(moon.pos, scale(outward, moon.radiusKm + gapKm - low));
	world.ship.vel = bodyVelocity(world.system, moon.id, world.gameTime);
	return at;
}

const STEPS: number[] = [1 / 144, 1 / 60, 0.1];

// ---------------------------------------------------------------------------
// 9.1.1 — the law, table-driven
// ---------------------------------------------------------------------------

describe("collision.md §9.1.1: the law", () => {
	const n = v3(0, 1, 0);
	test.each([
		["straight in", v3(0, -0.3, 0), 0.3],
		["in at an angle", v3(0.4, -0.3, 0), 0.3],
		["moving away", v3(0, 0.3, 0), 0],
		["a pure graze", v3(0.7, 0, -0.2), 0],
	])("closing speed is the normal component: %s", (_, u, expected) => {
		expect(closingSpeed(u, n)).toBeCloseTo(expected, 12);
	});

	test("damage is zero at V_SCRAPE, positive above it, continuous through it", () => {
		expect(impactDamage(0)).toBe(0);
		expect(impactDamage(V_SCRAPE_KMS * 0.5)).toBe(0);
		expect(impactDamage(V_SCRAPE_KMS)).toBe(0);
		expect(impactDamage(V_SCRAPE_KMS * 1.01)).toBeGreaterThan(0);
		// No step at the threshold: a hair above costs a hair.
		expect(impactDamage(V_SCRAPE_KMS + 1e-9)).toBeLessThan(1e-6);
		// And it is §3's formula, read off the shipped constants.
		expect(impactDamage(0.5)).toBeCloseTo(
			(DOCKING_DAMAGE_SCALE * (0.25 - V_SCRAPE_KMS ** 2)) / V_GATE_KMS ** 2,
			9,
		);
	});

	test("the bounce reverses the normal times RESTITUTION and keeps the tangential", () => {
		const out = bounce(v3(0.7, -0.4, 0.1), n);
		expect(out.x).toBeCloseTo(0.7, 12);
		expect(out.z).toBeCloseTo(0.1, 12);
		expect(out.y).toBeCloseTo(0.4 * RESTITUTION, 12);
		// A velocity already leaving is not bounced.
		expect(bounce(v3(0.7, 0.4, 0), n)).toEqual(v3(0.7, 0.4, 0));
	});

	test("RESTITUTION is docking's repel and V_SCRAPE half its gate (P2)", () => {
		expect(RESTITUTION).toBe(0.5);
		expect(V_SCRAPE_KMS).toBe(V_GATE_KMS / 2);
	});
});

// ---------------------------------------------------------------------------
// 9.1.3 — the scale bounds, on the exported constant (P3)
// ---------------------------------------------------------------------------

describe("collision.md §9.1.3: the scale bounds", () => {
	const pools = HULL_IDS.map((id) => headOnPool(fullCondition(id)));

	test("an impact at V_GATE costs at most a quarter of the smallest head-on pool", () => {
		expect(impactDamage(V_GATE_KMS)).toBeLessThanOrEqual(
			Math.min(...pools) / 4,
		);
	});

	test("an impact at the 2 km/s assist cap costs at least the largest head-on pool", () => {
		expect(ASSIST_CAP_KMS).toBe(2);
		expect(impactDamage(ASSIST_CAP_KMS)).toBeGreaterThanOrEqual(
			Math.max(...pools),
		);
	});
});

// ---------------------------------------------------------------------------
// 9.1.2 — the frame regression, rows 1 and 2
// ---------------------------------------------------------------------------

describe("collision.md §9.1.2: closing speed is relative to the body met", () => {
	test("a ship co-moving with a 32 km/s moon, touching at 0.03 km/s, takes no damage", () => {
		const { world, moon } = moonWorld();
		const moonSpeed = length(bodyVelocity(world.system, moon.id, 0));
		expect(moonSpeed).toBeGreaterThan(25);
		const outward = v3(0, 0, 1);
		let at = overMoon(world, moon, "courier", outward, 0.006);
		world.ship.vel = add(world.ship.vel, scale(outward, -0.03));
		const impacts: WorldImpact[] = [];
		for (let i = 0; i < 10; i++) {
			const step = fly(world, at, "courier", 0.1);
			at = step.at;
			impacts.push(...step.impacts);
		}
		const struck = impacts.filter((i) => !i.resting);
		expect(struck.length).toBe(1);
		expect(struck[0].bodyId).toBe(moon.id);
		expect(struck[0].closingKms).toBeGreaterThan(0.025);
		expect(struck[0].closingKms).toBeLessThan(0.035);
		expect(impacts.every((i) => i.damage === 0)).toBe(true);
	});

	test("a ship at rest in star coordinates is struck by the same moon at its orbital speed", () => {
		const { world, moon } = moonWorld();
		const vMoon = bodyVelocity(world.system, moon.id, world.gameTime);
		const ahead = unit(vMoon);
		const at = overMoon(world, moon, "courier", ahead, 1.0);
		world.ship.vel = v3();
		const { impacts } = fly(world, at, "courier", 0.1);
		expect(impacts.length).toBe(1);
		expect(impacts[0].closingKms / length(vMoon)).toBeCloseTo(1, 2);
		expect(impacts[0].damage).toBeGreaterThan(
			Math.max(...HULL_IDS.map((id) => headOnPool(fullCondition(id)))),
		);
	});
});

// ---------------------------------------------------------------------------
// 9.1.4 — resting on a static surface, at any dt
// ---------------------------------------------------------------------------

describe("collision.md §9.1.4: thrust against a surface pays nothing and stays outside", () => {
	// The interceptor: 2.8 km/s² of drive, so one tick of its thrust at MAX_DT is
	// 0.28 km/s — a law that billed the end-of-step velocity would charge it.
	const hull: HullId = "interceptor";

	test.each(STEPS)("full thrust into a moon for ten seconds at dt %p", (dt) => {
		expect(flightPerformance(hull).thrustKms2).toBeGreaterThan(2.5);
		const { world, moon } = moonWorld();
		const outward = unit(v3(1, 2, 0.5));
		let at = overMoon(world, moon, hull, outward, SEPARATION_KM);
		let damage = 0;
		let worst = Number.POSITIVE_INFINITY;
		for (let t = 0; t < 10 - 1e-9; t += dt) {
			const step = fly(world, at, hull, dt, { thrust: 1 });
			at = step.at;
			for (const i of step.impacts) damage += i.damage;
			worst = Math.min(
				worst,
				boxGapToSphere(
					world.ship.pos,
					at.nose,
					at.up,
					hull,
					moon.pos,
					moon.radiusKm,
				),
			);
		}
		expect(damage).toBe(0);
		expect(worst).toBeGreaterThan(0);
		// And it is still there, pressed against it.
		expect(
			boxGapToSphere(
				world.ship.pos,
				at.nose,
				at.up,
				hull,
				moon.pos,
				moon.radiusKm,
			),
		).toBeLessThan(2 * SEPARATION_KM);
	});

	test.each(STEPS)(
		"resting on a moon while turning at the roster's largest rate, dt %p",
		(dt) => {
			const { world, moon } = moonWorld();
			const outward = unit(v3(-1, 0.3, 2));
			const start = facing(scale(outward, -1));
			let at: HullAttitude = overMoon(
				world,
				moon,
				hull,
				outward,
				SEPARATION_KM,
				{
					...start,
					rates: { pitch: LARGEST_RATE, yaw: LARGEST_RATE * 0.5, roll: 0 },
				},
			);
			let damage = 0;
			let worst = Number.POSITIVE_INFINITY;
			const firstNose = at.nose;
			let turned = 0;
			for (let t = 0; t < 10 - 1e-9; t += dt) {
				const step = fly(world, at, hull, dt, { turnAssist: false });
				turned = Math.max(
					turned,
					Math.acos(Math.min(1, dot(firstNose, step.at.nose))),
				);
				at = step.at;
				for (const i of step.impacts) damage += i.damage;
				worst = Math.min(
					worst,
					boxGapToSphere(
						world.ship.pos,
						at.nose,
						at.up,
						hull,
						moon.pos,
						moon.radiusKm,
					),
				);
			}
			// The hull really did turn — through more than a half turn.
			expect(turned).toBeGreaterThan(Math.PI / 2);
			expect(damage).toBe(0);
			expect(worst).toBeGreaterThan(0);
		},
	);

	/** A ram along `-outward` from 0.3 km out at 0.5 km/s: what it met, and when. */
	function ram(dt: number, thrust: number) {
		const { world, moon } = moonWorld();
		const outward = unit(v3(0.3, -1, 0.2));
		let at = overMoon(world, moon, hull, outward, 0.3);
		world.ship.vel = add(world.ship.vel, scale(outward, -0.5));
		const met: { impact: WorldImpact; atS: number }[] = [];
		for (let t = 0; t < 2 && met.length === 0; t += dt) {
			const step = fly(world, at, hull, dt, { thrust });
			at = step.at;
			for (const impact of step.impacts)
				met.push({ impact, atS: t + impact.timeS });
		}
		expect(met.length).toBe(1);
		return met[0];
	}

	test.each(STEPS)(
		"a coasting ram at 0.5 km/s costs the same at dt %p",
		(dt) => {
			// Stated tolerance: 0.1%. Coasting, nothing changes inside a step, so the
			// three agree to rounding.
			const { impact } = ram(dt, 0);
			expect(Math.abs(impact.damage / impactDamage(0.5) - 1)).toBeLessThan(
				1e-3,
			);
		},
	);

	test.each(STEPS)(
		"under thrust, the ram is billed at the speed it has when it meets the surface, dt %p",
		(dt) => {
			// The speed the flight model gives a full drive at `t` is `0.5 + a·t` at
			// every dt. Where the three dts differ is *when* they arrive: the
			// semi-implicit position step covers 0.42 km in half a second at MAX_DT
			// against 0.355 km at 1/144, so a coarse step meets the surface sooner and
			// slower. That is #5's integrator, not this law. What the law owes is to
			// read the speed at the moment of impact — not at the end of the step,
			// which at MAX_DT is up to 0.28 km/s more and would bill that every tick.
			// Stated tolerance: 0.5% of the speed.
			const a = flightPerformance(hull).thrustKms2;
			const { impact, atS } = ram(dt, 1);
			expect(Math.abs(impact.closingKms / (0.5 + a * atS) - 1)).toBeLessThan(
				5e-3,
			);
		},
	);
});

// ---------------------------------------------------------------------------
// 9.1.5 — no tunnelling, on synthetic thin primitives
// ---------------------------------------------------------------------------

describe("collision.md §9.1.5: no tunnelling", () => {
	const still = (primitives: Primitive[]) => ({
		primitives,
		start: { origin: v3(), ...IDENTITY_AXES },
		end: { origin: v3(), ...IDENTITY_AXES },
		velStart: v3(),
		velEnd: v3(),
	});
	// 1 m across: thinner than one tick's travel at every speed below.
	const thin: [string, Primitive][] = [
		[
			"a capsule boom",
			{
				kind: "capsule",
				a: v3(0, 0, -0.05),
				b: v3(0, 0, 0.05),
				radiusKm: 0.0005,
			},
		],
		[
			"a box plate",
			{
				kind: "box",
				centre: v3(),
				axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
				half: [0.0005, 0.1, 0.1],
			},
		],
	];
	const hull: HullId = "courier";
	const box = solidOf(hull)[0];

	for (const [name, primitive] of thin)
		test.each([ASSIST_CAP_KMS, 20])(
			`a box swept through ${name} at %p km/s meets it`,
			(speed) => {
				const dt = 0.1;
				const half = (speed * dt) / 2;
				const nose = v3(1, 0, 0);
				const up = v3(0, 1, 0);
				const start = shipPose(v3(-half, 0, 0), nose, up);
				const end = shipPose(v3(half, 0, 0), nose, up);
				// The red build: a point-in-volume test at either end sees nothing.
				const solidPose: Pose = { origin: v3(), ...IDENTITY_AXES };
				expect(pairSeparation(box, start, primitive, solidPose).overlap).toBe(
					false,
				);
				expect(pairSeparation(box, end, primitive, solidPose).overlap).toBe(
					false,
				);
				const swept = sweepShip(
					{
						primitives: [box],
						start,
						end,
						velStart: v3(speed, 0, 0),
						velEnd: v3(speed, 0, 0),
					},
					[still([primitive])],
					dt,
				);
				expect(swept.impacts.length).toBe(1);
				expect(swept.impacts[0].closingKms).toBeCloseTo(speed, 6);
				// Left on the near side of it, not through it.
				expect(swept.pos.x).toBeLessThan(0);
			},
		);

	test("a box turned through a thin boom in one tick, faster than any hull turns, meets it", () => {
		const dt = 0.1;
		const angle = (150 * Math.PI) / 180;
		expect(angle / dt).toBeGreaterThan(LARGEST_RATE);
		// The voyager: 191 m long, so a yaw sweeps its ends a long way.
		const voyager = solidOf("voyager")[0];
		const boom: Primitive = {
			kind: "capsule",
			a: v3(0, -0.05, 0.06),
			b: v3(0, 0.05, 0.06),
			radiusKm: 0.0005,
		};
		const up = v3(0, 1, 0);
		const startNose = v3(1, 0, 0);
		// Yaw about dorsal: nose from +x round through +z.
		const endNose = v3(Math.cos(angle), 0, -Math.sin(angle));
		const start = shipPose(v3(), startNose, up);
		const end = shipPose(v3(), endNose, up);
		const solidPose: Pose = { origin: v3(), ...IDENTITY_AXES };
		// Clear at both ends, so a point-in-volume test is the red build.
		expect(pairSeparation(voyager, start, boom, solidPose).overlap).toBe(false);
		expect(pairSeparation(voyager, end, boom, solidPose).overlap).toBe(false);
		// And the turn really passes through it: half way round it overlaps.
		const mid = shipPose(v3(), v3(0, 0, -1), up);
		const midGap = pairSeparation(voyager, mid, boom, solidPose);
		expect(midGap.overlap).toBe(true);
		const swept = sweepShip(
			{ primitives: [voyager], start, end, velStart: v3(), velEnd: v3() },
			[still([boom])],
			dt,
		);
		expect(swept.impacts.length).toBe(1);
		expect(swept.impacts[0].timeS).toBeLessThan(dt);
	});
});

// ---------------------------------------------------------------------------
// §4.2 and §4.3 — earliest first, and a tick that starts inside
// ---------------------------------------------------------------------------

describe("collision.md §4.2, §4.3", () => {
	const box = solidOf("courier")[0];
	const sphereAt = (x: number, radiusKm: number) => ({
		primitives: [{ kind: "sphere", centre: v3(), radiusKm } as Primitive],
		start: { origin: v3(x, 0, 0), ...IDENTITY_AXES },
		end: { origin: v3(x, 0, 0), ...IDENTITY_AXES },
		velStart: v3(),
		velEnd: v3(),
	});
	const nose = v3(1, 0, 0);
	const up = v3(0, 1, 0);

	test("of two surfaces in one tick's path, the earlier owns it", () => {
		const swept = sweepShip(
			{
				primitives: [box],
				start: shipPose(v3(), nose, up),
				end: shipPose(v3(0.4, 0, 0), nose, up),
				velStart: v3(4, 0, 0),
				velEnd: v3(4, 0, 0),
			},
			[sphereAt(0.35, 0.02), sphereAt(0.15, 0.02)],
			0.1,
		);
		expect(swept.impacts.map((i) => i.solid)).toEqual([1]);
		expect(swept.pos.x).toBeLessThan(0.15);
	});

	test("a pair that overlaps at the start is a ghost: no impact, no push-out", () => {
		const start = shipPose(v3(0.01, 0, 0), nose, up);
		const end = shipPose(v3(0.02, 0, 0), nose, up);
		const swept = sweepShip(
			{
				primitives: [box],
				start,
				end,
				velStart: v3(0.1, 0, 0),
				velEnd: v3(0.1, 0, 0),
			},
			[sphereAt(0, 0.05)],
			0.1,
		);
		expect(swept.ghosts).toEqual([0]);
		expect(swept.impacts).toEqual([]);
		expect(swept.pos).toEqual(end.origin);
		expect(swept.vel).toEqual(v3(0.1, 0, 0));
	});

	test("a ship stepped from inside a moon reports the moon, and flies as if collision were off", () => {
		const place = (world: World, moon: Body) => {
			const outward = unit(v3(0.2, -0.4, 0.9));
			world.ship.pos = add(moon.pos, scale(outward, moon.radiusKm - 0.5));
			world.ship.vel = bodyVelocity(world.system, moon.id, world.gameTime);
			return facing(outward);
		};
		const step = (solid: Primitive[] | null) => {
			const { world, moon } = moonWorld();
			const at = place(world, moon);
			const out = stepWorld(
				world,
				at,
				{
					stick: { pitch: 0, yaw: 0, roll: 0 },
					turnAssist: true,
					translation: { demand: speedDemand(0.5), assist: false },
				},
				0.1,
				flightPerformance("courier"),
				solid,
			);
			return { out, pos: { ...world.ship.pos }, vel: { ...world.ship.vel } };
		};
		const ghosted = step(solidOf("courier"));
		const unsolid = step(null);
		expect(ghosted.out.ghosts).toEqual([MOON_ID]);
		expect(ghosted.out.impacts).toEqual([]);
		expect(ghosted.pos).toEqual(unsolid.pos);
		expect(ghosted.vel).toEqual(unsolid.vel);
		expect(unsolid.out.ghosts).toEqual([]);
	});

	test("a resting and a swept impact bill the same side, measured from the ship's position (§3)", () => {
		// A box whose centre sits 10 m aft of the ship's origin, met on its
		// flank 5 m aft of the origin: aft from the origin, fore from the box
		// centre. Nose +x, so right is +z.
		const offset = hullBox(
			{ lengthKm: 0.04, beamKm: 0.02, heightKm: 0.01 },
			{ rightKm: 0, upKm: 0, foreKm: -0.01 },
		);
		const radiusKm = 0.05;
		const flankZ = 0.01 + radiusKm;
		const sphere = {
			primitives: [{ kind: "sphere", centre: v3(), radiusKm } as Primitive],
			start: { origin: v3(-0.005, 0, flankZ), ...IDENTITY_AXES },
			end: { origin: v3(-0.005, 0, flankZ), ...IDENTITY_AXES },
			velStart: v3(),
			velEnd: v3(),
		};
		const meet = (startZ: number) =>
			sweepShip(
				{
					primitives: [offset],
					start: shipPose(v3(0, 0, startZ), nose, up),
					end: shipPose(v3(0, 0, startZ + 0.02), nose, up),
					velStart: v3(0, 0, 0.2),
					velEnd: v3(0, 0, 0.2),
				},
				[sphere],
				0.1,
			).impacts;
		const resting = meet(-SEPARATION_KM);
		const swept = meet(-0.01);
		expect(resting.map((i) => [i.resting, i.side])).toEqual([[true, "aft"]]);
		expect(swept.map((i) => [i.resting, i.side])).toEqual([[false, "aft"]]);
	});
});

// ---------------------------------------------------------------------------
// 9.1.10 — the box is where the ship is
// ---------------------------------------------------------------------------

describe("collision.md §9.1.10: the box is where the ship is", () => {
	/** 0.1 m, the quantum `env` is rounded to. */
	const ROUNDING_KM = 0.0001;

	/** The selected mesh's built box, in the mesh's own frame. */
	function meshBox(id: HullId): THREE.Box3 {
		const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
		root.updateMatrixWorld(true);
		return new THREE.Box3().setFromObject(root);
	}

	/** Every corner of the mesh's built box, posed as the renderer poses the
	 *  mesh — `makeBasis(right, up, −nose)` at `pos`. Containing the corners
	 *  contains the mesh. */
	function posedCorners(id: HullId, pos: Vec3, nose: Vec3, up: Vec3): Vec3[] {
		const b = meshBox(id);
		const right = cross(nose, up);
		const m = new THREE.Matrix4()
			.makeBasis(
				new THREE.Vector3(right.x, right.y, right.z),
				new THREE.Vector3(up.x, up.y, up.z),
				new THREE.Vector3(-nose.x, -nose.y, -nose.z),
			)
			.setPosition(pos.x, pos.y, pos.z);
		const out: Vec3[] = [];
		for (const x of [b.min.x, b.max.x])
			for (const y of [b.min.y, b.max.y])
				for (const z of [b.min.z, b.max.z]) {
					const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
					out.push(v3(p.x, p.y, p.z));
				}
		return out;
	}

	/** How far `p` lies outside a box primitive posed at `pose`, worst axis. */
	function outsideBy(box: Primitive, pose: Pose, p: Vec3): number {
		if (box.kind !== "box") throw new Error("not a box");
		const centre = add(
			pose.origin,
			add(
				add(scale(pose.x, box.centre.x), scale(pose.y, box.centre.y)),
				scale(pose.z, box.centre.z),
			),
		);
		const d = sub(p, centre);
		return Math.max(
			Math.abs(dot(d, pose.x)) - box.half[0],
			Math.abs(dot(d, pose.y)) - box.half[1],
			Math.abs(dot(d, pose.z)) - box.half[2],
		);
	}

	const pos = v3(123.4, -56.7, 8.9);
	const nose = unit(v3(0.3, -0.5, 0.81));
	const up = unit(cross(cross(nose, v3(0.2, 1, 0.1)), nose));

	test.each([...HULL_IDS])(
		"%s: the posed collision box holds its mesh",
		(id) => {
			const box = solidOf(id)[0];
			const pose = shipPose(pos, nose, up);
			for (const corner of posedCorners(id, pos, nose, up))
				expect(outsideBy(box, pose, corner)).toBeLessThanOrEqual(ROUNDING_KM);
		},
	);

	test("the offset is load-bearing: a box about the origin would leave hull outside it", () => {
		const unshifted = (id: HullId): Primitive =>
			hullBox(HULL_SPECS[id].env, { rightKm: 0, upKm: 0, foreKm: 0 });
		const pose = shipPose(pos, nose, up);
		const worst = Math.max(
			...HULL_IDS.flatMap((id) =>
				posedCorners(id, pos, nose, up).map((c) =>
					outsideBy(unshifted(id), pose, c),
				),
			),
		);
		expect(worst).toBeGreaterThan(0.01);
	});
});

// ---------------------------------------------------------------------------
// 9.1.12, first sentence — cruise never reaches a collision sphere
// ---------------------------------------------------------------------------

describe("collision.md §9.1.12: a cruise keep-out contains its collision sphere", () => {
	test("in every system of seed 47's first galaxy, every star and planet guard clears the largest hull's box", () => {
		// The furthest any hull's box reaches from the ship's origin: the guard
		// must hold the whole box off the sphere, not just its centre.
		const shipReach = Math.max(...HULL_IDS.map((id) => reachKm(solidOf(id))));
		expect(shipReach).toBeGreaterThan(0.2);
		const galaxy = makeWorld(MOON_SEED).galaxy;
		let checked = 0;
		let tightest = Number.POSITIVE_INFINITY;
		for (const record of galaxy.systems) {
			for (const body of makeSystem(record, 0).bodies) {
				// Cruise's masses are its stars and planets (`in-system-travel.md`
				// §2.1); a moon has no keep-out of its own to contain anything.
				if (body.kind !== "star" && body.kind !== "planet") continue;
				const mass = {
					id: body.id,
					kind: body.kind,
					pos: body.pos,
					radiusKm: body.radiusKm,
				};
				for (const parent of [body.id, null]) {
					const guard = liveGuardRadiusKm(mass, parent);
					tightest = Math.min(tightest, guard - body.radiusKm - shipReach);
					checked++;
				}
			}
		}
		// One galaxy of one seed, all of it: a sample of the generator, not
		// every galaxy it can make.
		expect(galaxy.systems.length).toBe(256);
		expect(checked).toBeGreaterThan(2000);
		expect(tightest).toBeGreaterThan(0);
	});
});

describe("primitiveBox: the bounds the collision grid indexes (node #1118)", () => {
	test("a sphere's bounds are its centre plus and minus its radius", () => {
		expect(
			primitiveBox({
				kind: "sphere",
				centre: { x: 1, y: -2, z: 3 },
				radiusKm: 0.5,
			}),
		).toEqual({
			minX: 0.5,
			minY: -2.5,
			minZ: 2.5,
			maxX: 1.5,
			maxY: -1.5,
			maxZ: 3.5,
		});
	});

	test("a capsule's bounds span both ends, each grown by its radius", () => {
		expect(
			primitiveBox({
				kind: "capsule",
				a: { x: 1, y: 4, z: -1 },
				b: { x: -3, y: 2, z: 5 },
				radiusKm: 0.25,
			}),
		).toEqual({
			minX: -3.25,
			minY: 1.75,
			minZ: -1.25,
			maxX: 1.25,
			maxY: 4.25,
			maxZ: 5.25,
		});
	});
});
