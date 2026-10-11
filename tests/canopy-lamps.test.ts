import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	CANOPY_LAMP_HEAD_RADIUS_M,
	CANOPY_LAMP_SEPARATION_M,
	COCKPIT_CANOPY_LAMPS,
	COCKPIT_MODEL_EYE_M,
	COCKPIT_MODEL_LAMPS,
	cockpitLampHeadGeometry,
} from "../src/cockpit-model";

/**
 * The authored cabin's canopy-frame lamps (node #887).
 *
 * The procedural arch carried six lamps along its two side rails and went when
 * #792's authored cabin replaced the cabin those rails were bolted to. What is
 * left of its lighting is `COCKPIT_MODEL_LAMPS`: three point lights at y -1.65
 * model metres, under the console, below and behind an eye at y 0.3. Nothing is
 * on the frame beside the pilot, which is the complaint.
 *
 * These six are placed from the authored model rather than from the arch's
 * outline. The cabin GLB carries no frame geometry within ±60° of vertical —
 * the arch stood in space the authored cabin leaves open — and what it does
 * carry, and what a pilot sees at the edge of the canopy, is a mirrored pair of
 * side pillars: frame material from 0.94 to 1.66 m out, forward of the eye. Each
 * anchor sits on one, and one test below measures the gap between every anchor
 * and the nearest authored frame vertex, so an anchor that stops being on the
 * model is a red rather than a look nobody notices has gone.
 */

/** The authored materials that are frame rather than trim, panel or recess. */
const FRAME = new Set(["weathered-blue-steel", "exposed-machined-edges"]);

/** Every authored frame vertex of the shipped cabin, in model metres. */
async function authoredFrame(): Promise<THREE.Vector3[]> {
	const scene = await decodeShippedGlb("src/models/courier-cockpit.glb");
	const points: THREE.Vector3[] = [];
	scene.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		if (!materials.some((m) => FRAME.has(m?.name ?? ""))) return;
		const position = mesh.geometry.getAttribute("position");
		mesh.updateWorldMatrix(false, false);
		const v = new THREE.Vector3();
		for (let i = 0; i < position.count; i++)
			points.push(
				v
					.fromBufferAttribute(position, i)
					.applyMatrix4(mesh.matrixWorld)
					.clone(),
			);
	});
	return points;
}

const anchor = (lamp: (typeof COCKPIT_CANOPY_LAMPS)[number]) =>
	new THREE.Vector3(...lamp.positionM);

describe("the authored cabin's canopy-frame lamps", () => {
	test("there are six, three to a side, and none reuses a console lamp's name", () => {
		expect(COCKPIT_CANOPY_LAMPS).toHaveLength(6);
		const sides = COCKPIT_CANOPY_LAMPS.map((lamp) =>
			lamp.positionM[0] < 0 ? "port" : "starboard",
		);
		expect(sides.filter((side) => side === "port")).toHaveLength(3);
		expect(sides.filter((side) => side === "starboard")).toHaveLength(3);
		const consoleNames: string[] = COCKPIT_MODEL_LAMPS.map((lamp) => lamp.name);
		const frameNames: string[] = COCKPIT_CANOPY_LAMPS.map((lamp) => lamp.name);
		expect(frameNames.filter((name) => consoleNames.includes(name))).toEqual(
			[],
		);
		// Three names, six lamps: each side's three stations are its own.
		expect(frameNames.filter((name) => name.endsWith("-fore"))).toHaveLength(2);
		expect(frameNames.filter((name) => name.endsWith("-mid"))).toHaveLength(2);
		expect(frameNames.filter((name) => name.endsWith("-aft"))).toHaveLength(2);
	});

	test("each sits above the eye, forward of it, and within the frame's reach", () => {
		const [eyeX, eyeY, eyeZ] = COCKPIT_MODEL_EYE_M;
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const [x, y, z] = lamp.positionM;
			// Ahead of the eye rather than behind the headrest, and above it rather
			// than on the floor, which is where the three console lamps already are.
			expect([x, y, z, z < eyeZ && y > eyeY]).toEqual([x, y, z, true]);
			// The authored pillars run 0.94-1.66 m out. A lamp further out than
			// `CANOPY_LAMP_SEPARATION_M` allows is not on a pillar at all.
			const reach = Math.hypot(x - eyeX, y - eyeY, z - eyeZ);
			expect([x, y, z, reach > 0.9 && reach < 1.75]).toEqual([x, y, z, true]);
		}
	});

	test("every anchor is on the authored frame, not on the arch it replaces", async () => {
		const frame = await authoredFrame();
		expect(frame.length).toBeGreaterThan(1000);
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const point = anchor(lamp);
			let nearest = Infinity;
			for (const vertex of frame)
				nearest = Math.min(nearest, vertex.distanceTo(point));
			// The standoff pulls each anchor off the strut toward the eye, so the gap
			// is that standoff plus the strut's own thickness. An anchor that drifts
			// off the model fails here and nowhere else.
			expect([lamp.name, nearest <= CANOPY_LAMP_SEPARATION_M]).toEqual([
				lamp.name,
				true,
			]);
			expect([lamp.name, nearest > 0]).toEqual([lamp.name, true]);
		}
	});

	test("the pair mirrors, and each side is measured on its own", async () => {
		const frame = await authoredFrame();
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const twin = COCKPIT_CANOPY_LAMPS.find(
				(other) =>
					other.name !== lamp.name &&
					Math.abs(other.positionM[0] + lamp.positionM[0]) < 1e-9 &&
					Math.abs(other.positionM[1] - lamp.positionM[1]) < 1e-9 &&
					Math.abs(other.positionM[2] - lamp.positionM[2]) < 1e-9,
			);
			expect([lamp.name, twin !== undefined]).toEqual([lamp.name, true]);
			// Measured per side: a port anchor near a starboard strut would satisfy
			// the mirror and still be floating in the middle of the cabin.
			const point = anchor(lamp);
			const nearest = frame.reduce(
				(best, vertex) => Math.min(best, vertex.distanceTo(point)),
				Infinity,
			);
			const side = Math.sign(lamp.positionM[0]);
			const onSide = frame.some(
				(vertex) =>
					Math.sign(vertex.x) === side &&
					vertex.distanceTo(point) <= CANOPY_LAMP_SEPARATION_M,
			);
			expect([lamp.name, nearest, onSide]).toEqual([lamp.name, nearest, true]);
		}
	});

	test("every head spans a visible arc from the eye, and no head is a speck", () => {
		// The figure that decides whether a lamp is *seen* is the arc it subtends,
		// not its metres: the same disc is a fitting at 1.2 m and a speck at 6 m. Two
		// degrees is roughly the limit at which a shape reads as a shape rather than a
		// dot; the principal asked for the frame lit bigger, so every head clears five,
		// and none reaches ten, where a fitting starts to sit in front of the view.
		const eye = new THREE.Vector3(...COCKPIT_MODEL_EYE_M);
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const reach = anchor(lamp).distanceTo(eye);
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
		// A head is `MeshBasicMaterial` and costs the fragments it covers. A cast is
		// a `PointLight`, which costs every standard fragment in the cabin's own
		// scene whether it lights anything or not (`cockpit-surface.ts` on #651).
		// Six of them is the reason the dots stay and the light goes.
		expect(
			COCKPIT_CANOPY_LAMPS.filter((lamp) => lamp.gated !== true).map(
				(lamp) => lamp.name,
			),
		).toEqual([]);
	});

	test("no cast is so strong it clips the cabin's own exposure ceiling", () => {
		// Illuminance at the nearest frame vertex, against the emissive ceiling the
		// cabin's own self-light is quoted against. A lamp that saturates the strut
		// it sits on is a white blob rather than a lit frame.
		for (const lamp of COCKPIT_CANOPY_LAMPS) {
			const reach = Math.hypot(
				lamp.positionM[0] - COCKPIT_MODEL_EYE_M[0],
				lamp.positionM[1] - COCKPIT_MODEL_EYE_M[1],
				lamp.positionM[2] - COCKPIT_MODEL_EYE_M[2],
			);
			const strut = Math.max(CANOPY_LAMP_SEPARATION_M, 0.02);
			expect([lamp.name, lamp.intensity / (strut * strut) < 40_000]).toEqual([
				lamp.name,
				true,
			]);
			// And it reaches the eye's own neighbourhood: a lamp whose range stops
			// short of the console lights nothing the pilot sees.
			expect([lamp.name, lamp.rangeM > reach]).toEqual([lamp.name, true]);
		}
	});
});
