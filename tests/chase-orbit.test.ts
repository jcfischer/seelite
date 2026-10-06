/**
 * The chase camera's full orbit (node #691), held headless. Every row that
 * places the camera does it off a **rotated and rolled** ship, because with the
 * ship at the identity the ship's frame and the world's are the same and a row
 * there passes on a build that confused them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CHASE_BACK_KM,
	CHASE_UP_KM,
	type ChaseOrbit,
	ELEVATION_LIMIT_RAD,
	ORBIT_ASTERN,
	ORBIT_MAX_STEP_RAD,
	ORBIT_RAD_PER_PX,
	clampElevation,
	orbitByPointer,
	orbitOffsetKm,
	orbitRotation,
	pointerOwner,
	rotate,
	wrapYaw,
} from "../src/chase-orbit";
import { DEFAULT_BINDINGS } from "../src/commands"; // glossary-ignore: Command
import { intoCameraFrame, type Quat } from "../src/hud";
import { add, length, sub, type Vec3, v3 } from "../src/vec3";

const mul = (a: Quat, b: Quat): Quat => ({
	w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
	y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
	z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const axisAngle = (axis: Vec3, rad: number): Quat => {
	const n = length(axis);
	const s = Math.sin(rad / 2) / n;
	return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(rad / 2) };
};
const near = (a: Vec3, b: Vec3, eps = 1e-12) =>
	expect(length(sub(a, b))).toBeLessThan(eps);
const finite = (v: Vec3 | Quat) =>
	Object.values(v).every((c) => Number.isFinite(c));

/** The rig in the world, as `main.ts` builds it: both halves off one rotation. */
const rig = (shipPos: Vec3, ship: Quat, orbit: ChaseOrbit) => ({
	pos: add(shipPos, rotate(orbitOffsetKm(orbit), ship)),
	rot: mul(ship, orbitRotation(orbit)),
});

/** A ship turned off every world axis, and rolled. */
const SHIPS: Quat[] = [
	mul(axisAngle(v3(0, 1, 0), 2.1), axisAngle(v3(1, 0, 0), -0.7)),
	mul(axisAngle(v3(0.3, -1, 0.5), 1.3), axisAngle(v3(0, 0, 1), 2.6)),
	axisAngle(v3(1, 1, 1), -2.9),
];
const SHIP_POS = v3(1.5e8, -2.4e3, 7.7e5);

const EPS = 1e-6;
/** Poses across the yaw wrap and both poles, and their neighbourhoods. */
const POSES: ChaseOrbit[] = [];
for (const yawRad of [
	0,
	0.7,
	-1.9,
	Math.PI / 2,
	-Math.PI / 2,
	Math.PI - EPS,
	-Math.PI,
	-Math.PI + EPS,
])
	for (const elevationRad of [
		0,
		0.4,
		-1.1,
		ELEVATION_LIMIT_RAD,
		ELEVATION_LIMIT_RAD - EPS,
		-ELEVATION_LIMIT_RAD,
		-ELEVATION_LIMIT_RAD + EPS,
	])
		POSES.push({ yawRad, elevationRad });

describe("the rig is one rotation (C1)", () => {
	test("at zero elevation it is #607's yaw-only orbit, exactly", () => {
		// The legacy postcard link's framing, and every chase probe's.
		for (const yawRad of [0, 0.7, -2.2, Math.PI - EPS, -Math.PI]) {
			const orbit = { yawRad, elevationRad: 0 };
			const yawOnly = axisAngle(v3(0, 1, 0), yawRad);
			const q = orbitRotation(orbit);
			for (const k of ["x", "y", "z", "w"] as const)
				expect(q[k]).toBeCloseTo(yawOnly[k], 14);
			near(
				orbitOffsetKm(orbit),
				rotate(v3(0, CHASE_UP_KM, CHASE_BACK_KM), yawOnly),
			);
		}
	});

	test("the hull sits at one place in every frame, off a rotated ship, through the wrap and at both poles", () => {
		const subject = v3(0, -CHASE_UP_KM, -CHASE_BACK_KM);
		for (const ship of SHIPS)
			for (const orbit of POSES) {
				const cam = rig(SHIP_POS, ship, orbit);
				const q = cam.rot;
				expect(finite(cam.pos) && finite(q)).toBe(true);
				expect(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1)).toBeLessThan(
					1e-12,
				);
				// Position and orientation agree: the ship, seen from the camera.
				// 1e-7 km is a tenth of a millimetre: float64's grain at 1 AU.
				near(intoCameraFrame(sub(SHIP_POS, cam.pos), q), subject, 1e-7);
				// And at the chase distance, whatever the pose.
				expect(length(sub(cam.pos, SHIP_POS))).toBeCloseTo(
					Math.hypot(CHASE_UP_KM, CHASE_BACK_KM),
					7,
				);
			}
	});

	test("it composes ahead, astern, port, starboard, above and below in the ship's own frame", () => {
		const ship = SHIPS[1];
		const inShip = (orbit: ChaseOrbit) =>
			intoCameraFrame(sub(rig(SHIP_POS, ship, orbit).pos, SHIP_POS), ship);
		const astern = inShip(ORBIT_ASTERN);
		const ahead = inShip({ yawRad: -Math.PI, elevationRad: 0 });
		const port = inShip({ yawRad: -Math.PI / 2, elevationRad: 0 });
		const starboard = inShip({ yawRad: Math.PI / 2, elevationRad: 0 });
		const above = inShip({ yawRad: 0, elevationRad: ELEVATION_LIMIT_RAD });
		const below = inShip({ yawRad: 0, elevationRad: -ELEVATION_LIMIT_RAD });
		// The nose is -z, starboard +x, up +y.
		expect(astern.z).toBeCloseTo(CHASE_BACK_KM, 7);
		expect(ahead.z).toBeCloseTo(-CHASE_BACK_KM, 7);
		expect(port.x).toBeCloseTo(-CHASE_BACK_KM, 7);
		expect(starboard.x).toBeCloseTo(CHASE_BACK_KM, 7);
		expect(above.y).toBeCloseTo(CHASE_BACK_KM, 7);
		expect(below.y).toBeCloseTo(-CHASE_BACK_KM, 7);
	});
});

describe("the gesture (C1)", () => {
	/** Frames of a steady push from astern until the pose stops changing. */
	const push = (
		dx: number,
		dy: number,
		frames: number,
		from = ORBIT_ASTERN,
	) => {
		let orbit = from;
		for (let i = 0; i < frames; i++) orbit = orbitByPointer(orbit, dx, dy);
		return orbit;
	};
	const quarter = Math.round(Math.PI / 2 / ORBIT_RAD_PER_PX);

	test("the view goes where the pointer goes: right swings the camera to port, back lowers it", () => {
		expect(orbitByPointer(ORBIT_ASTERN, 10, 0).yawRad).toBeLessThan(0);
		expect(orbitByPointer(ORBIT_ASTERN, -10, 0).yawRad).toBeGreaterThan(0);
		expect(orbitByPointer(ORBIT_ASTERN, 0, 10).elevationRad).toBeLessThan(0);
		expect(orbitByPointer(ORBIT_ASTERN, 0, -10).elevationRad).toBeGreaterThan(
			0,
		);
	});

	test("a pointer reaches every composition, and a full sweep comes home", () => {
		expect(push(quarter / 10, 0, 10).yawRad).toBeCloseTo(-Math.PI / 2, 2);
		expect(push(-quarter / 10, 0, 10).yawRad).toBeCloseTo(Math.PI / 2, 2);
		expect(Math.abs(push(quarter / 10, 0, 20).yawRad)).toBeCloseTo(Math.PI, 2);
		expect(push(0, -quarter / 10, 12).elevationRad).toBe(ELEVATION_LIMIT_RAD);
		expect(push(0, quarter / 10, 12).elevationRad).toBe(-ELEVATION_LIMIT_RAD);
		expect(push(quarter / 10, 0, 40).yawRad).toBeCloseTo(0, 2);
	});

	test("a sweep through the yaw wrap moves the camera smoothly", () => {
		let orbit: ChaseOrbit = { yawRad: Math.PI - 0.05, elevationRad: 0.3 };
		let last = rig(SHIP_POS, SHIPS[0], orbit).pos;
		const step = 0.01;
		for (let i = 0; i < 10; i++) {
			orbit = orbitByPointer(orbit, -step / ORBIT_RAD_PER_PX, 0);
			const pos = rig(SHIP_POS, SHIPS[0], orbit).pos;
			// A chord of `step` radians on the orbit's circle, never a jump.
			expect(length(sub(pos, last))).toBeLessThan(CHASE_BACK_KM * step * 1.5);
			last = pos;
		}
		expect(orbit.yawRad).toBeLessThan(0);
	});

	test("the pole clamps rather than accumulating, so the way back answers at once", () => {
		const over = push(0, -400, 50);
		expect(over.elevationRad).toBe(ELEVATION_LIMIT_RAD);
		const back = orbitByPointer(over, 0, 5);
		expect(back.elevationRad).toBeCloseTo(
			ELEVATION_LIMIT_RAD - 5 * ORBIT_RAD_PER_PX,
			12,
		);
	});

	test("at the poles the sightline is the ship's up axis and the whole offset turns with it", () => {
		// Not over the hull's centre: the astern offset turned a quarter, so the
		// 40 m up becomes 40 m forward overhead and 40 m aft beneath.
		const over = orbitOffsetKm({
			yawRad: 0,
			elevationRad: ELEVATION_LIMIT_RAD,
		});
		const under = orbitOffsetKm({
			yawRad: 0,
			elevationRad: -ELEVATION_LIMIT_RAD,
		});
		for (const [got, want] of [
			[over, v3(0, CHASE_BACK_KM, -CHASE_UP_KM)],
			[under, v3(0, -CHASE_BACK_KM, CHASE_UP_KM)],
		] as const) {
			expect(got.x).toBeCloseTo(want.x, 12);
			expect(got.y).toBeCloseTo(want.y, 12);
			expect(got.z).toBeCloseTo(want.z, 12);
		}
		const look = (elevationRad: number) =>
			rotate(v3(0, 0, -1), orbitRotation({ yawRad: 0, elevationRad }));
		expect(look(ELEVATION_LIMIT_RAD).y).toBeCloseTo(-1, 12);
		expect(look(-ELEVATION_LIMIT_RAD).y).toBeCloseTo(1, 12);
	});

	test("at the pole a horizontal push still turns the view, with no flip", () => {
		let orbit: ChaseOrbit = { yawRad: 0, elevationRad: ELEVATION_LIMIT_RAD };
		let last = rig(SHIP_POS, SHIPS[2], orbit);
		for (let i = 0; i < 20; i++) {
			orbit = orbitByPointer(orbit, 25, 0);
			const now = rig(SHIP_POS, SHIPS[2], orbit);
			expect(finite(now.pos) && finite(now.rot)).toBe(true);
			// Consecutive orientations stay close: |dot| near one is no flip.
			const dot = Math.abs(
				now.rot.x * last.rot.x +
					now.rot.y * last.rot.y +
					now.rot.z * last.rot.z +
					now.rot.w * last.rot.w,
			);
			expect(dot).toBeGreaterThan(Math.cos(0.1 / 2) - 1e-12);
			expect(dot).toBeLessThan(1);
			last = now;
		}
	});

	test("one frame's spike is guarded, and a non-finite delta moves nothing", () => {
		const spiked = orbitByPointer(ORBIT_ASTERN, 5000, -5000);
		expect(spiked.yawRad).toBeCloseTo(-ORBIT_MAX_STEP_RAD, 12);
		expect(spiked.elevationRad).toBeCloseTo(ORBIT_MAX_STEP_RAD, 12);
		const held = { yawRad: 0.4, elevationRad: -0.2 };
		expect(orbitByPointer(held, Number.NaN, Number.POSITIVE_INFINITY)).toEqual(
			held,
		);
	});

	test("wrap and clamp hold their ranges", () => {
		for (const r of [-10, -Math.PI, 0, Math.PI, 3 * Math.PI, 17.3]) {
			const w = wrapYaw(r);
			expect(w).toBeGreaterThanOrEqual(-Math.PI);
			expect(w).toBeLessThan(Math.PI);
			expect(Math.cos(w)).toBeCloseTo(Math.cos(r), 12);
		}
		expect(clampElevation(4)).toBe(ELEVATION_LIMIT_RAD);
		expect(clampElevation(-4)).toBe(-ELEVATION_LIMIT_RAD);
		expect(clampElevation(Number.NaN)).toBe(0);
	});
});

describe("who the pointer belongs to (C2)", () => {
	test("the camera in chase, the ship in the cockpit — never both", () => {
		expect(pointerOwner("chase")).toBe("orbit");
		expect(pointerOwner("cockpit")).toBe("steer");
	});

	test("orbiting moves no part of the ship: the rig is the only output", () => {
		// The ship's orientation is an input to the rig and nothing writes it.
		const ship = { ...SHIPS[0] };
		rig(SHIP_POS, ship, orbitByPointer(ORBIT_ASTERN, 300, -120));
		expect(ship).toEqual(SHIPS[0]);
	});
});

describe("the Controls tab says what the pointer does (C2)", () => {
	// glossary-ignore: Command — `command` below is a control registry row.
	// The registry's chase movement rows are a description: `orbitChase` hands
	// the raw delta to `orbitByPointer` and reads no binding (sage round 1).
	// So each row is held to the way the orbit actually turns, by pushing the
	// pointer the way the row names and watching the pose.
	const WAY: Record<string, (o: ChaseOrbit) => boolean> = {
		"view.orbitPort": (o) => o.yawRad < 0 && o.elevationRad === 0,
		"view.orbitStarboard": (o) => o.yawRad > 0 && o.elevationRad === 0,
		"view.orbitUp": (o) => o.elevationRad > 0 && o.yawRad === 0,
		"view.orbitDown": (o) => o.elevationRad < 0 && o.yawRad === 0,
	};

	test("every chase movement row's half turns the orbit the way its name says", () => {
		const rows = DEFAULT_BINDINGS.flatMap((b) =>
			b.trigger.kind === "mouse-move" && b.scope.views.includes("chase")
				? [{ command: b.command, axis: b.trigger.axis, half: b.trigger.half }]
				: [],
		);
		expect(rows.map((r): string => r.command).sort()).toEqual(
			Object.keys(WAY).sort(),
		);
		for (const r of rows) {
			const px = r.half === "+" ? 50 : -50;
			const moved = orbitByPointer(
				ORBIT_ASTERN,
				r.axis === "x" ? px : 0,
				r.axis === "y" ? px : 0,
			);
			expect({ [r.command]: WAY[r.command](moved) }).toEqual({
				[r.command]: true,
			});
		}
	});

	test("the orbit is handed the pointer's delta unchanged", () => {
		// Read from the source rather than restated: a negation added between
		// the pointer and the orbit would flip every row above while they pass.
		const main = readFileSync("src/main.ts", "utf8");
		const body = main.slice(main.indexOf("private orbitChase()"));
		const fn = body.slice(0, body.indexOf("\n\t}\n"));
		expect(fn).toContain("const { dx, dy } = this.takePointer();");
		expect(fn).toContain(
			"this.chaseOrbit = orbitByPointer(this.chaseOrbit, dx, dy);",
		);
	});
});
