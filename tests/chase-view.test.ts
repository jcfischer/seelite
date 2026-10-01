/**
 * Chase view's weapons and cues (#607): the arithmetic, held headless. Every
 * row orbits the chase camera off the ship's own frame. With the camera on the
 * ship's axis, the camera's frame and the ship's are the same rotation, and a
 * row there passes on the build that confused them.
 */
import { describe, expect, test } from "bun:test";
import {
	beamSegments,
	muzzlesWorld,
	projectSegment,
	shipCuesShown,
	weaponRay,
} from "../src/chase-view";
import { type Quat, projectDirection } from "../src/hud";
import { length, sub, type Vec3, v3 } from "../src/vec3";

/** A rotation of `rad` about +y (yaw), as the chase orbit turns. */
const yaw = (rad: number): Quat => ({
	x: 0,
	y: Math.sin(rad / 2),
	z: 0,
	w: Math.cos(rad / 2),
});
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const FOV = Math.PI / 3;
const near = (a: Vec3, b: Vec3, eps = 1e-9) =>
	expect(length(sub(a, b))).toBeLessThan(eps);

describe("the weapon ray (#607 D1)", () => {
	const ship = { pos: v3(10, 0, 0), nose: v3(0, 0, -1) };
	// The chase camera, orbited 45° and standing behind and above.
	const camera = {
		pos: v3(10.1, 0.04, 0.1),
		forward: v3(-Math.SQRT1_2, 0, -Math.SQRT1_2),
	};

	test("chase: from the ship, along its nose — orbiting the camera does not turn the gun", () => {
		const ray = weaponRay("chase", ship, camera);
		near(ray.origin, ship.pos);
		near(ray.aim, ship.nose);
	});

	test("cockpit: the sightline through the reticle, as before", () => {
		const ray = weaponRay("cockpit", ship, camera);
		near(ray.origin, camera.pos);
		near(ray.aim, camera.forward);
	});
});

test("the ship-fixed cues are the cockpit's alone (D2)", () => {
	expect(shipCuesShown("cockpit")).toBe(true);
	expect(shipCuesShown("chase")).toBe(false);
});

describe("the muzzles and the beam (#607 D3)", () => {
	const muzzlesKm = [v3(-0.004, 0, -0.03), v3(0.004, 0, -0.03)];

	test("a muzzle turns with the ship", () => {
		// Yawed a quarter turn to port: the nose (-z) now points to -x.
		const [a, b] = muzzlesWorld(v3(1, 2, 3), yaw(Math.PI / 2), muzzlesKm);
		near(a, v3(1 - 0.03, 2, 3 + 0.004));
		near(b, v3(1 - 0.03, 2, 3 - 0.004));
		near(muzzlesWorld(v3(0, 0, 0), IDENTITY, muzzlesKm)[0], muzzlesKm[0]);
	});

	test("each beam runs from its own muzzle, the weapon's range along the aim", () => {
		const from = muzzlesWorld(v3(0, 0, 0), IDENTITY, muzzlesKm);
		const segments = beamSegments(from, v3(0, 0, -2), 12);
		expect(segments).toHaveLength(2);
		segments.forEach(([start, end], i) => {
			near(start, from[i]);
			near(end, v3(from[i].x, 0, from[i].z - 12));
		});
	});
});

describe("a beam on the chase camera's screen (#607)", () => {
	const camPos = v3(0, 0.04, 0.14);

	test("a segment in front of the camera projects both ends as the camera sees them", () => {
		const rot = yaw(Math.PI / 4);
		const a = v3(0, 0, -0.03);
		const b = v3(0, 0, -12);
		const seg = projectSegment(a, b, camPos, rot, FOV, 1.5);
		if (!seg) throw new Error("no segment");
		const pa = projectDirection(sub(a, camPos), rot, FOV, 1.5);
		const pb = projectDirection(sub(b, camPos), rot, FOV, 1.5);
		expect(seg[0].ndcX).toBeCloseTo(pa.ndcX, 9);
		expect(seg[0].ndcY).toBeCloseTo(pa.ndcY, 9);
		expect(seg[1].ndcX).toBeCloseTo(pb.ndcX, 9);
		expect(seg[1].ndcY).toBeCloseTo(pb.ndcY, 9);
		// Orbited, the beam is not on the screen's centre line: the cue is
		// projected through the camera, not the ship.
		expect(Math.abs(seg[1].ndcX)).toBeGreaterThan(0.1);
	});

	test("a beam whose far end is behind the camera is cut at the camera, not dropped", () => {
		// The camera orbited round to the front, looking back at the ship: the
		// beam starts in view and runs past the camera.
		const front = v3(0, 0.04, -0.3);
		const rot = yaw(Math.PI);
		const seg = projectSegment(
			v3(0, 0, -0.03),
			v3(0, 0, -12),
			front,
			rot,
			FOV,
			1.5,
		);
		expect(seg).not.toBeNull();
		if (!seg) return;
		expect(Number.isFinite(seg[1].ndcX + seg[1].ndcY)).toBe(true);
	});

	test("a segment wholly behind the camera draws nothing", () => {
		expect(
			projectSegment(v3(0, 0, 1), v3(0, 0, 2), v3(0, 0, 0), IDENTITY, FOV, 1),
		).toBeNull();
	});
});
