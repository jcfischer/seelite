/**
 * The HUD's arithmetic — the markers the map's constraint makes load-bearing,
 * checked without a browser.
 *
 * The constraint: cockpit is the default view, so the hull is not on screen to
 * read attitude off, and #5's model is one where the nose and the velocity
 * genuinely disagree. A velocity-vector marker and an attitude reference are
 * what make that model flyable in that view — so "the marker lands on the
 * target" is a claim worth pinning as arithmetic rather than by looking at it.
 */
import { expect, test } from "bun:test";
import {
	angleOffNose,
	directionTo,
	edgeOf,
	horizonRoll,
	intoCameraFrame,
	prograde,
	projectDirection,
} from "../src/hud";
import { type Vec3, length, scale, v3 } from "../src/vec3";

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const FOV = (60 * Math.PI) / 180;

/** A quaternion that rotates by `angle` about `axis` — the renderer builds
 *  these with Three.js; the tests need them without it. */
function quat(axis: Vec3, angle: number) {
	const s = Math.sin(angle / 2);
	const n = scale(axis, 1 / length(axis));
	return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(angle / 2) };
}

test("a direction down the nose projects to the centre of the screen", () => {
	// −Z is forward, Three.js's convention for anything looked along.
	const m = projectDirection(v3(0, 0, -1), IDENTITY, FOV, 16 / 9);
	expect(m.ndcX).toBeCloseTo(0, 12);
	expect(m.ndcY).toBeCloseTo(0, 12);
	expect(m.behind).toBe(false);
	expect(m.onScreen).toBe(true);
});

test("a direction behind the camera is flagged rather than projected", () => {
	// The failure this prevents is the classic one: the perspective divide by a
	// negative depth mirrors the point, so a target directly astern draws a
	// reticle on the *opposite* side of the screen from where it is, and the
	// player turns away from it.
	const m = projectDirection(v3(0, 0, 1), IDENTITY, FOV, 16 / 9);
	expect(m.behind).toBe(true);
	expect(m.onScreen).toBe(false);
	// Exactly abeam is the boundary case, and it belongs on the edge too.
	expect(projectDirection(v3(1, 0, 0), IDENTITY, FOV, 16 / 9).behind).toBe(
		true,
	);
});

test("the field of view is the scale, in both axes", () => {
	// Half the vertical FOV up from the nose lands exactly on the top edge; the
	// horizontal edge is that angle times the aspect ratio. An implementation
	// that forgot the aspect divide would put a marker at the side of a wide
	// screen while the body was still well inside it.
	const aspect = 16 / 9;
	const up = projectDirection(
		v3(0, Math.tan(FOV / 2), -1),
		IDENTITY,
		FOV,
		aspect,
	);
	expect(up.ndcY).toBeCloseTo(1, 9);
	const right = projectDirection(
		v3(Math.tan(FOV / 2) * aspect, 0, -1),
		IDENTITY,
		FOV,
		aspect,
	);
	expect(right.ndcX).toBeCloseTo(1, 9);
});

test("the projection follows the ship's orientation", () => {
	// Yaw the ship 90° and what was abeam is now dead ahead. This is the claim
	// that makes a marker track a body as the player turns, which is the only
	// thing the reticle is for.
	const yawed = quat(v3(0, 1, 0), Math.PI / 2);
	const m = projectDirection(v3(-1, 0, 0), yawed, FOV, 1);
	expect(m.behind).toBe(false);
	expect(m.ndcX).toBeCloseTo(0, 9);
	expect(m.ndcY).toBeCloseTo(0, 9);
});

test("the camera-frame rotation is the inverse of the orientation", () => {
	// Rotating a direction in and straight back out is the identity — the check
	// that the conjugate is a conjugate and not a second forward rotation, which
	// is a sign error that looks right whenever the ship is near the identity.
	const q = quat(v3(1, 2, 3), 0.7);
	const world = v3(0.3, -0.5, 0.81);
	const camera = intoCameraFrame(world, q);
	const back = intoCameraFrame(camera, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
	expect(back.x).toBeCloseTo(world.x, 9);
	expect(back.y).toBeCloseTo(world.y, 9);
	expect(back.z).toBeCloseTo(world.z, 9);
	expect(intoCameraFrame(world, IDENTITY)).toEqual(world);
});

test("an off-screen marker sits on the inset box, pointing the way to turn", () => {
	const margin = 0.08;
	const limit = 1 - margin;
	// A target to the right and behind: the arrow belongs on the right edge.
	const e = edgeOf(v3(1, 0, 0.5), IDENTITY, margin);
	expect(Math.max(Math.abs(e.ndcX), Math.abs(e.ndcY))).toBeCloseTo(limit, 9);
	expect(e.ndcX).toBeGreaterThan(0);
	// Directly astern is degenerate, and answers stably rather than flickering.
	const astern = edgeOf(v3(0, 0, 1), IDENTITY, margin);
	expect(astern.ndcY).toBeCloseTo(-limit, 9);
	expect(edgeOf(v3(0, 0, 1), IDENTITY, margin).ndcX).toBe(astern.ndcX);
});

test("the horizon rolls with the ship, and gives up where roll is undefined", () => {
	const normal = v3(0, 0, 1); // the system's reference plane, star-centred
	// Level: the ship is looking along −Z with the plane normal behind it, so the
	// projection is degenerate and there is no honest line to draw.
	expect(horizonRoll(IDENTITY, normal)).toBe(null);
	// Pitched up 90°, the normal lands on screen and the roll is defined.
	const pitched = quat(v3(1, 0, 0), Math.PI / 2);
	const roll = horizonRoll(pitched, normal);
	expect(roll).not.toBe(null);
	// Rolling the ship about its own nose turns the horizon by the same angle.
	const rolled = horizonRoll(
		mul(pitched, quat(v3(0, 0, -1), 0.4)),
		normal,
	) as number;
	expect(Math.abs(angleBetween(rolled, roll as number))).toBeCloseTo(0.4, 6);
});

test("prograde is null while the ship is barely moving", () => {
	// Below the floor the velocity is numerical noise, and a marker chasing it
	// would swing around the screen while the ship sat still.
	expect(prograde(v3(0, 0, 0), 1e-4)).toBe(null);
	expect(prograde(v3(0, 0, -1e-6), 1e-4)).toBe(null);
	const p = prograde(v3(0, 0, -2), 1e-4) as Vec3;
	expect(length(p)).toBeCloseTo(1, 12);
	expect(p.z).toBeCloseTo(-1, 12);
});

test("directionTo normalises in float64 and refuses a zero-length one", () => {
	// A station at 1 AU is a 10⁸ km number: normalising here is what keeps the
	// magnitude out of the float32 half of the renderer.
	const d = directionTo(v3(1.5e8, 0, 0), v3(1.5e8, 1e5, 0)) as Vec3;
	expect(length(d)).toBeCloseTo(1, 12);
	expect(d.y).toBeCloseTo(1, 12);
	expect(directionTo(v3(1, 2, 3), v3(1, 2, 3))).toBe(null);
});

test("angleOffNose is stable at both ends", () => {
	// `Math.acos` of a dot product that rounds to 1.0000000002 is NaN, and a NaN
	// angle silently hides every marker that depends on it.
	const nose = v3(0, 0, -1);
	expect(angleOffNose(nose, nose)).toBeCloseTo(0, 9);
	expect(angleOffNose(v3(0, 0, 1), nose)).toBeCloseTo(Math.PI, 9);
	expect(Number.isNaN(angleOffNose(scale(nose, 1.0000001), nose))).toBe(false);
});

/** Quaternion product, for the roll test — the renderer has Three.js for this;
 *  a test asserting a rotation composes needs its own six lines. */
function mul(a: typeof IDENTITY, b: typeof IDENTITY) {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	};
}

/** The signed difference between two angles, wrapped into ±π. */
function angleBetween(a: number, b: number): number {
	return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
