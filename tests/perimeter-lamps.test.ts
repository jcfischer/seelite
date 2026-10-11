import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	buildPerimeterLamps,
	COCKPIT_MODEL_EYE_M,
	COCKPIT_MODEL_PITCH_RAD,
	COCKPIT_PERIMETER_LAMPS,
	carriedLamp,
	PERIMETER_LAMP_CAST_INTENSITY,
	PERIMETER_LAMP_CAST_RANGE_KM,
	PERIMETER_LAMP_LOOK_DEG,
	PERIMETER_LAMP_STANDOFF_M,
	perimeterLampCast,
} from "../src/cockpit-model";

/** The two materials the authored cabin builds its frame from. */
const FRAME = new Set(["weathered-blue-steel", "exposed-machined-edges"]);

/** The cabin camera looks down −Z at 60° vertical; the view set captures 16:10. */
const FOV_Y_DEG = 60;
const ASPECT = 16 / 10;
const HALF_X_DEG =
	(Math.atan(Math.tan(((FOV_Y_DEG / 2) * Math.PI) / 180) * ASPECT) * 180) /
	Math.PI;
const HALF_Y_DEG = FOV_Y_DEG / 2;

/**
 * How far a diagnostic may look for frame geometry, model metres.
 *
 * The first attempt at these lamps binned frame vertices by angle off the nose and
 * dropped every vertex beyond this distance, which found frame only 45–80° off the
 * nose and produced the conclusion that the authored cabin presented no frame inside
 * the pilot's view at all. The cabin is 4.5 m deep. The cut discarded precisely the
 * far, near-straight-ahead geometry — the geometry in view. Without it there are
 * 23,669 frame vertices inside the frustum, 3,023 within 10° of the nose. The last row
 * below re-measures that, so the histogram cannot be rebuilt with the cut in it.
 */
const INSTRUMENT_RANGE_M = 12;

const toCabinFrame = (point: THREE.Vector3) =>
	point
		.clone()
		.sub(new THREE.Vector3(...COCKPIT_MODEL_EYE_M))
		.applyAxisAngle(new THREE.Vector3(1, 0, 0), COCKPIT_MODEL_PITCH_RAD);

/** Where a point sits in the pilot's view: degrees off the nose, degrees below. */
const viewAngle = (point: THREE.Vector3) => {
	const c = toCabinFrame(point);
	return {
		horiz: (Math.atan2(Math.abs(c.x), -c.z) * 180) / Math.PI,
		vert: (Math.atan2(-c.y, Math.hypot(c.x, c.z)) * 180) / Math.PI,
		distance: c.length(),
	};
};

/** A look-direction from the eye, in model space, undoing the cabin's pitch. */
const modelLook = (offNoseDeg: number, belowDeg: number) => {
	const a = (offNoseDeg * Math.PI) / 180;
	const b = (belowDeg * Math.PI) / 180;
	return new THREE.Vector3(
		Math.sin(a) * Math.cos(b),
		-Math.sin(b),
		-Math.cos(a) * Math.cos(b),
	)
		.applyAxisAngle(new THREE.Vector3(1, 0, 0), -COCKPIT_MODEL_PITCH_RAD)
		.normalize();
};

const eye = new THREE.Vector3(...COCKPIT_MODEL_EYE_M);
let frame: THREE.Mesh[] = [];
let frameVertices = 0;

beforeAll(async () => {
	const scene = await decodeShippedGlb("src/models/courier-cockpit.glb");
	scene.updateMatrixWorld(true);
	scene.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		const materials = Array.isArray(object.material)
			? object.material
			: [object.material];
		if (!materials.some((m) => FRAME.has(m?.name ?? ""))) return;
		frame.push(object);
		frameVertices += object.geometry.getAttribute("position").count;
	});
});

const raycast = (from: THREE.Vector3, direction: THREE.Vector3) => {
	const ray = new THREE.Raycaster(
		from,
		direction.clone().normalize(),
		0.002,
		INSTRUMENT_RANGE_M,
	);
	return ray.intersectObjects(frame, false)[0];
};

describe("the cabin's perimeter frame lamps", () => {
	test("are six, and mirrored exactly", () => {
		expect(COCKPIT_PERIMETER_LAMPS).toHaveLength(6);
		const port = COCKPIT_PERIMETER_LAMPS.filter((lamp) =>
			lamp.name.includes("-port-"),
		);
		const starboard = COCKPIT_PERIMETER_LAMPS.filter((lamp) =>
			lamp.name.includes("-starboard-"),
		);
		expect(port).toHaveLength(3);
		expect(starboard).toHaveLength(3);
		for (const left of port) {
			const station = left.name.split("-").pop() as string;
			const right = starboard.find((lamp) => lamp.name.endsWith(`-${station}`));
			const mirror = right!;
			expect(mirror.positionM[1]).toBe(left.positionM[1]);
			expect(mirror.positionM[2]).toBe(left.positionM[2]);
			expect(mirror.positionM[0]).toBeCloseTo(-left.positionM[0], 6);
		}
	});

	test("each stands on the first frame surface along its look-direction", () => {
		// The pair of stations on each side come from PERIMETER_LAMP_LOOK_DEG, so a
		// re-authored cabin can be re-anchored from the same rule rather than from
		// coordinates copied forward.
		const stations = ["fore", "mid", "aft"] as const;
		expect(PERIMETER_LAMP_LOOK_DEG).toHaveLength(stations.length);
		for (const [index, station] of stations.entries()) {
			const [offNose, below] = PERIMETER_LAMP_LOOK_DEG[index];
			for (const side of [-1, 1]) {
				const lamp = COCKPIT_PERIMETER_LAMPS.find(
					(entry) =>
						entry.name.includes(side < 0 ? "-port-" : "-starboard-") &&
						entry.name.endsWith(`-${station}`),
				);
				expect(lamp).toBeDefined();
				const direction = modelLook(side * offNose, below);
				const surface = raycast(eye.clone(), direction);
				expect(surface).toBeDefined();
				const anchor = new THREE.Vector3(
					...(lamp?.positionM as unknown as number[]),
				);
				// The anchor is that surface drawn back toward the eye by the standoff.
				expect(
					anchor
						.clone()
						.sub(
							surface.point
								.clone()
								.addScaledVector(direction, -PERIMETER_LAMP_STANDOFF_M),
						)
						.length(),
				).toBeLessThan(0.01);
			}
		}
	});

	test("nothing stands between any lamp and the pilot", () => {
		// The failure this replaces: an anchor at a tube's centroid is inside solid
		// geometry, and the procedural arch's `COCKPIT_LAMP.standoffKm` said so in
		// words before #887 removed it — "without it the lamps do not exist".
		for (const lamp of COCKPIT_PERIMETER_LAMPS) {
			const anchor = new THREE.Vector3(
				...(lamp.positionM as unknown as number[]),
			);
			const blocked = raycast(anchor, eye.clone().sub(anchor));
			expect(blocked).toBeUndefined();
		}
	});

	test("every one is inside the cabin camera's frustum", () => {
		// A lamp on geometry the camera cannot show is not a restored light. This is
		// what the previous six were: they measured 60.6°, 68.1° and 76.4° off a nose
		// that sees ±42.7°, and the captured views did not move at all.
		for (const lamp of COCKPIT_PERIMETER_LAMPS) {
			const angle = viewAngle(
				new THREE.Vector3(...(lamp.positionM as unknown as number[])),
			);
			expect(angle.horiz).toBeLessThan(HALF_X_DEG - 5);
			expect(Math.abs(angle.vert)).toBeLessThan(HALF_Y_DEG - 5);
			// Below the eye line, where `assets.md` puts the cabin's warm service
			// lights — "below window, never a huge roof bar".
			expect(angle.vert).toBeGreaterThan(0);
		}
	});

	test("their casts are quoted in cabin units, not carried like world lamps", () => {
		// `cabinLight` divides by k^decay for a lamp carried in from the world; these
		// are authored in model metres inside `modelSpace`, and the divide made them
		// contribute 0.00 to the cabin's measured level.
		const cast = perimeterLampCast();
		expect(cast.intensity).toBe(PERIMETER_LAMP_CAST_INTENSITY);
		expect(cast.distanceKm).toBe(PERIMETER_LAMP_CAST_RANGE_KM);
		expect(cast.decay).toBe(2);
		for (const group of buildPerimeterLamps()) {
			const light = group.children.find(
				(object) => object instanceof THREE.PointLight,
			) as THREE.PointLight | undefined;
			expect(light).toBeDefined();
			expect(light?.intensity).toBe(PERIMETER_LAMP_CAST_INTENSITY);
			expect(light?.distance).toBe(PERIMETER_LAMP_CAST_RANGE_KM);
			// Parented to the model space that scales by CABIN_SCALE/1000: a carried
			// lamp would divide these figures, and this is the assertion that says so.
			const [x, y, z] = COCKPIT_PERIMETER_LAMPS.find(
				(entry) => entry.name === group.name,
			)?.positionM as unknown as number[];
			expect(light?.position.toArray()).toEqual([0, 0, 0]);
			expect(group.position.toArray()).toEqual([x, y, z]);
		}
	});

	test("every cast is gated, so low quality keeps its cost off", () => {
		// A cast is a `PointLight`, and three evaluates every one of them for every
		// standard fragment in the cabin's scene whether it lights anything or not —
		// the lesson `cockpit-surface.ts` records from #651.
		for (const lamp of COCKPIT_PERIMETER_LAMPS) expect(lamp.gated).toBe(true);
		for (const group of buildPerimeterLamps()) {
			const light = group.children.find(
				(object) => object instanceof THREE.PointLight,
			) as THREE.PointLight | undefined;
			expect(light).toBeDefined();
			expect(light?.visible).toBe(true);
		}
	});

	test("there is no added head, only the cast", () => {
		// A billboarded `MeshBasicMaterial` disc 26 cm across, five metres out, is not
		// a fitting: it is a flat circle of uniform colour in front of a canopy. The
		// principal's word from the live panel was "totally unrealistic — just a bright
		// circle", and the fitting the authored cabin already carries under its window
		// sill is left to be the thing you see.
		for (const group of buildPerimeterLamps()) {
			expect(
				group.children.filter((o) => o instanceof THREE.Mesh),
			).toHaveLength(0);
			expect(group.children).toHaveLength(1);
		}
	});

	test("its figures are the ones set on the live frame", () => {
		// Not a rule about brightness — a guard that a shipped figure does not drift
		// back to something a sweep produced. Both were set by eye on the docked cabin
		// with the panel driving these exact lights.
		expect(PERIMETER_LAMP_CAST_INTENSITY).toBe(0.24);
		expect(PERIMETER_LAMP_CAST_RANGE_KM).toBe(0.22);
	});

	test("carriedLamp would have shrunken them, which is what it is for", () => {
		// Not a rule about these lamps — a guard on the misunderstanding. `cabinLight`
		// multiplies intensity by k^decay so a lamp survives the cabin's frame being k
		// times smaller than the world. Right for one carried in from outside, wrong for
		// one authored in model metres: the difference is a factor of 0.01.
		const carried = carriedLamp({
			color: 0xffc27a,
			intensity: PERIMETER_LAMP_CAST_INTENSITY,
			rangeM: PERIMETER_LAMP_CAST_RANGE_KM * 1000,
			gated: true,
			positionM: [0, 0, 0],
		} as never);
		expect(carried.intensity).toBeCloseTo(
			PERIMETER_LAMP_CAST_INTENSITY * 0.1 ** 2,
			10,
		);
	});

	test("the cabin presents frame inside the view beyond the old instrument's cut", () => {
		// The regression this node's whole second half turns on. Everything the first
		// placement knew about the cabin came from a histogram that dropped vertices
		// beyond 2.5 m, and the cabin is 4.5 m deep.
		let inside = 0;
		let insideFar = 0;
		const point = new THREE.Vector3();
		for (const mesh of frame) {
			const position = mesh.geometry.getAttribute("position");
			for (let i = 0; i < position.count; i++) {
				point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
				const angle = viewAngle(point);
				if (angle.distance > INSTRUMENT_RANGE_M || angle.horiz > HALF_X_DEG)
					continue;
				if (Math.abs(angle.vert) > HALF_Y_DEG || point.z > eye.z) continue;
				inside++;
				if (angle.distance > 2.5) insideFar++;
			}
		}
		expect(frameVertices).toBeGreaterThan(0);
		expect(inside).toBeGreaterThan(1000);
		// Every one of them was beyond the cut. If a future histogram of this cabin
		// reaches the same conclusion, it has this row to answer to.
		expect(insideFar).toBe(inside);
	});
});
