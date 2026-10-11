import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	CANOPY_LAMP_HEAD_RADIUS_M,
	CANOPY_LAMP_MOUNT_REACH_M,
	CANOPY_LAMP_STANDOFF_M,
	COCKPIT_CANOPY_LAMPS,
	COCKPIT_MODEL_EYE_M,
	COCKPIT_MODEL_LAMPS,
	cockpitLampHeadGeometry,
} from "../src/cockpit-model";

/**
 * The authored cabin's canopy-frame lamps (node #887).
 *
 * The procedural arch carried six lamps along its two side rails and went when
 * #792's authored cabin replaced the cabin those rails were bolted to. What is left
 * of the cabin's lighting is `COCKPIT_MODEL_LAMPS`: three point lights at y -1.65
 * model metres, under the console, below and behind an eye at y 0.3. Nothing is on
 * the frame beside the pilot, which is the complaint.
 *
 * These six are placed from the authored model, and what the model says about a
 * lamp is measured rather than asserted: a ray back out of the mount has to land on
 * a strut, and a ray toward the pilot has to find nothing. That second leg exists
 * because the first placement of these six put every anchor at the *centroid* of a
 * pillar's frame vertices — the middle of a solid tube — and the view set showed
 * `cockpit-arrival` at mean 14.23 on the base build and 14.23 on the build with six
 * lamps in it. A lamp drawn inside the strut it is meant to light is not a dim lamp;
 * it is no lamp, and no numeric row about lamp count says so.
 */

/** The authored materials that are frame rather than trim, panel or recess. */
const FRAME = new Set(["weathered-blue-steel", "exposed-machined-edges"]);

/** The authored frame meshes of the shipped cabin, in model metres. */
async function frameMeshes(): Promise<THREE.Mesh[]> {
	const scene = await decodeShippedGlb("src/models/courier-cockpit.glb");
	scene.updateMatrixWorld(true);
	const meshes: THREE.Mesh[] = [];
	scene.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		if (materials.some((m) => FRAME.has(m?.name ?? ""))) meshes.push(mesh);
	});
	return meshes;
}

const lampRays = (lamp: (typeof COCKPIT_CANOPY_LAMPS)[number]) => {
	const from = new THREE.Vector3(...lamp.positionM);
	const towardEye = new THREE.Vector3(...COCKPIT_MODEL_EYE_M)
		.sub(from)
		.normalize();
	const ray = new THREE.Raycaster();
	const cast = (direction: THREE.Vector3): number[] => {
		ray.set(from, direction);
		return ray
			.intersectObjects(frameCache ?? [], false)
			.filter((hit) => hit.distance > 1e-4 && hit.distance < 1.5)
			.map((hit) => hit.distance);
	};
	return { from, towardEye, cast };
};

let frameCache: THREE.Mesh[] | null = null;
const frames = async () => (frameCache ??= await frameMeshes());

/** How far back to a strut (`reach`) and how far to the nearest surface the pilot
 * would have to see through (`inFront`), for one lamp, in model metres. */
const mountReport = (lamp: (typeof COCKPIT_CANOPY_LAMPS)[number]) => {
	const { towardEye, cast } = lampRays(lamp);
	return {
		reach: Math.min(...cast(towardEye.clone().negate()), Infinity),
		inFront: Math.min(...cast(towardEye), Infinity),
	};
};

describe("the authored cabin's canopy-frame lamps", () => {
	test("there are six, three to a side, and none reuses a console lamp's name", () => {
		expect(COCKPIT_CANOPY_LAMPS).toHaveLength(6);
		const frameNames: string[] = COCKPIT_CANOPY_LAMPS.map((lamp) => lamp.name);
		const consoleNames: string[] = COCKPIT_MODEL_LAMPS.map((lamp) => lamp.name);
		expect(frameNames.filter((name) => consoleNames.includes(name))).toEqual(
			[],
		);
		expect(frameNames.filter((name) => name.endsWith("-fore"))).toHaveLength(2);
		expect(frameNames.filter((name) => name.endsWith("-mid"))).toHaveLength(2);
		expect(frameNames.filter((name) => name.endsWith("-aft"))).toHaveLength(2);
	});

	test("each sits above the eye, forward of it, and within the frame's reach", () => {
		const [eyeX, eyeY, eyeZ] = COCKPIT_MODEL_EYE_M;
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const [x, y, z] = lamp.positionM;
			expect([x, y, z, z < eyeZ && y > eyeY]).toEqual([x, y, z, true]);
			const reach = Math.hypot(x - eyeX, y - eyeY, z - eyeZ);
			expect([x, y, z, reach > 0.9 && reach < 1.75]).toEqual([x, y, z, true]);
		}
	});

	test("every lamp is mounted on an authored strut", async () => {
		await frames();
		expect((frameCache ?? []).length).toBeGreaterThan(0);
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const { reach } = mountReport(lamp);
			expect([lamp.name, reach <= CANOPY_LAMP_MOUNT_REACH_M]).toEqual([
				lamp.name,
				true,
			]);
		}
	});

	test("no lamp is drawn inside the strut it is meant to light", async () => {
		await frames();
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const { inFront } = mountReport(lamp);
			// The head's own radius is the floor: half of it may sit in the housing,
			// which is what makes it a fitting rather than a tile stuck on. Anything
			// nearer than that and the strut is in front of the lamp.
			expect([lamp.name, inFront >= CANOPY_LAMP_HEAD_RADIUS_M / 2]).toEqual([
				lamp.name,
				true,
			]);
			expect([lamp.name, inFront >= CANOPY_LAMP_STANDOFF_M]).toEqual([
				lamp.name,
				true,
			]);
		}
	});

	test("the pair mirrors, and each side is mounted on its own strut", async () => {
		const meshes = await frames();
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const twin = COCKPIT_CANOPY_LAMPS.find(
				(other) =>
					other.name !== lamp.name &&
					Math.abs(other.positionM[0] + lamp.positionM[0]) < 1e-9 &&
					Math.abs(other.positionM[1] - lamp.positionM[1]) < 1e-9 &&
					Math.abs(other.positionM[2] - lamp.positionM[2]) < 1e-9,
			);
			expect([lamp.name, twin !== undefined]).toEqual([lamp.name, true]);
			// A port lamp mounted on a starboard strut would satisfy the mirror and
			// still be floating across the cabin.
			const { from, towardEye } = lampRays(lamp);
			const ray = new THREE.Raycaster();
			ray.set(from, towardEye.clone().negate());
			const onSide = ray
				.intersectObjects(meshes, false)
				.some((hit) => Math.sign(hit.point.x) === Math.sign(lamp.positionM[0]));
			expect([lamp.name, onSide]).toEqual([lamp.name, true]);
		}
	});

	test("every head spans a visible arc from the eye, and no head is a speck", () => {
		// What decides whether a lamp is *seen* is the arc it subtends, not its
		// metres: the same disc is a fitting at 1.2 m and a speck at 6 m. Two degrees
		// is roughly where a shape stops reading as a shape; the ask was bigger, so
		// every head clears five, and none reaches ten, where a fitting starts to sit
		// in front of the outside view.
		const eye = new THREE.Vector3(...COCKPIT_MODEL_EYE_M);
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const reach = new THREE.Vector3(...lamp.positionM).distanceTo(eye);
			const arcDeg =
				(2 * Math.atan(CANOPY_LAMP_HEAD_RADIUS_M / reach) * 180) / Math.PI;
			expect([lamp.name, arcDeg > 5 && arcDeg < 10]).toEqual([lamp.name, true]);
		}
		const geometry = cockpitLampHeadGeometry();
		expect(geometry.type).toBe("CircleGeometry");
		expect((geometry as THREE.CircleGeometry).parameters.radius).toBe(
			CANOPY_LAMP_HEAD_RADIUS_M,
		);
	});

	test("every one is gated, so low quality keeps the head and drops the cast", () => {
		// A head is `MeshBasicMaterial` and costs the fragments it covers. A cast is a
		// `PointLight`, which costs every standard fragment in the cabin's own scene
		// whether it lights anything or not (`cockpit-surface.ts` on #651). Six casts
		// is why the dots stay at low and the light is what the gate takes away.
		expect(
			COCKPIT_CANOPY_LAMPS.filter((lamp) => lamp.gated !== true).map(
				(lamp) => lamp.name,
			),
		).toEqual([]);
	});
});
