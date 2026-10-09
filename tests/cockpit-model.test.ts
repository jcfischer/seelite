import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CABIN_FAR_KM, CABIN_NEAR_KM } from "../src/cabin-pass";
import {
	type AuthoredCabin,
	adoptCockpitTemplate,
	buildAuthoredCabin,
	COCKPIT_MODEL_KM_PER_M,
	COCKPIT_MODEL_LAMPS,
	COCKPIT_SCREENS,
	carriedLamp,
	containedFace,
	INSTRUMENT_FACE_KM,
	SCANNER_FACE_KM,
	screenFrame,
	screenMount,
} from "../src/cockpit-model";
import { disposeSubtree } from "../src/gpu-teardown";
import { EMISSIVE_CEILING } from "../src/light-rig";
import { decodeShippedGlb } from "./helpers/read-coriolis-glb";

/** The label canvases need a 2D surface; no assertion reads a pixel. */
function withCanvasStub<T>(body: () => T): T {
	const ctx = { fillRect: () => {}, fillText: () => {} };
	const previous = (globalThis as { document?: unknown }).document;
	(globalThis as { document?: unknown }).document = {
		createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
	};
	try {
		return body();
	} finally {
		(globalThis as { document?: unknown }).document = previous;
	}
}

/** The game's camera: `main.ts` builds every layer's at 60° vertical. */
const FOV_Y_DEG = 60;
/** The narrowest window the cabin is checked against. */
const NARROW_ASPECT = 4 / 3;
/** A common laptop window, the wide case the node names. */
const WIDE_ASPECT = 16 / 10;
/** The screens with a live face on them; `systems` is unpowered. */
const LIVE_SCREENS = ["radar", "flight", "target"] as const;
/** How much of the frame's height a live screen keeps clear of its edge, at
 *  each end: 2% is 16 px of an 800 px window. */
const SCREEN_MARGIN = 0.02;
/** The spike's approved pilot frame, which #794 shipped and node #806 lowers:
 *  its README's eye, and the pitch its viewer looked down at. */
const SPIKE_EYE_M = [0, 0, 1.15] as const;
const SPIKE_PITCH_RAD = 0.242;
/** How much lower, as a share of the frame's height, the dash must start. */
const MIN_LOWERING = 0.04;

let template: THREE.Group;
let cabin: AuthoredCabin;
beforeAll(async () => {
	template = await decodeShippedGlb("public/models/courier-cockpit.glb");
	// Bun has no image decoder, so the helper strips the model's maps. One is
	// put back on the steel as a stand-in, so adoption's map branch runs and
	// the teardown row has a template texture to guard.
	template.traverse((o) => {
		if (
			o instanceof THREE.Mesh &&
			o.material instanceof THREE.MeshStandardMaterial &&
			o.material.name === "weathered-blue-steel"
		)
			o.material.map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
	});
	adoptCockpitTemplate(template);
	cabin = withCanvasStub(buildAuthoredCabin);
	cabin.root.updateMatrixWorld(true);
});

const vertexDistances = (root: THREE.Object3D) => {
	const out: number[] = [];
	const v = new THREE.Vector3();
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const position = o.geometry.getAttribute("position");
		for (let i = 0; i < position.count; i++)
			out.push(
				v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).length(),
			);
	});
	return out;
};

describe("the shipped cockpit model in the cabin pass", () => {
	test("every vertex lies between the cabin camera's planes, with margin at the near one", () => {
		const d = vertexDistances(cabin.root);
		expect(d.length).toBeGreaterThan(1000);
		const nearest = Math.min(...d);
		const farthest = Math.max(...d);
		// A head turns ±90°, so the nearest vertex in *any* direction counts.
		expect(nearest).toBeGreaterThan(CABIN_NEAR_KM * 10);
		expect(farthest).toBeLessThan(CABIN_FAR_KM);
	});

	test("every live screen is wholly inside the forward frame, at 4:3 and at 16:10", () => {
		// The live three only (node #806): the unpowered POWER DISTRIBUTION
		// screen has nothing on it, and the principal asked for the cabin to sit
		// lower, which takes that screen to the frame's bottom edge. The height
		// is the binding direction and both windows share it; the width binds
		// at the narrow one.
		const halfY = Math.tan((FOV_Y_DEG * Math.PI) / 360);
		for (const aspect of [NARROW_ASPECT, WIDE_ASPECT]) {
			const halfX = halfY * aspect;
			for (const name of LIVE_SCREENS) {
				const f = cabin.screens[name];
				for (const sx of [-0.5, 0.5])
					for (const sy of [-0.5, 0.5]) {
						const p = f.center
							.clone()
							.addScaledVector(f.right, sx * f.widthKm)
							.addScaledVector(f.up, sy * f.heightKm);
						expect(p.z).toBeLessThan(0);
						expect(Math.abs(p.x / -p.z)).toBeLessThan(halfX);
						// With a margin: a screen whose edge grazes the frame's
						// bottom reads as cut off, not as framed.
						expect(Math.abs(p.y / -p.z)).toBeLessThan(
							halfY * (1 - 2 * SCREEN_MARGIN),
						);
					}
			}
		}
	});

	test("the dash sits lower than the spike's frame put it, and leaves more of the view", () => {
		// Node #806: the principal flew the spike's frame (#794) and found the
		// cabin too high. The forward view is measured on the frame's centre
		// line, where the reticle is: how far down it the first fitting starts.
		const dashTop = (root: THREE.Object3D) => {
			root.updateMatrixWorld(true);
			const ray = new THREE.Raycaster();
			const halfY = Math.tan((FOV_Y_DEG * Math.PI) / 360);
			const ROWS = 400;
			for (let row = ROWS / 2; row < ROWS; row++) {
				const ndcY = 1 - (2 * (row + 0.5)) / ROWS;
				ray.set(
					new THREE.Vector3(),
					new THREE.Vector3(0, ndcY * halfY, -1).normalize(),
				);
				if (ray.intersectObject(root, true).length > 0) return row / ROWS;
			}
			return 1;
		};
		const spike = withCanvasStub(buildAuthoredCabin);
		spike.root.rotation.x = SPIKE_PITCH_RAD;
		spike.modelSpace.position.set(
			...(SPIKE_EYE_M.map((m) => -m * COCKPIT_MODEL_KM_PER_M) as [
				number,
				number,
				number,
			]),
		);
		const was = dashTop(spike.root);
		const now = dashTop(cabin.root);
		// The spike's frame put the dash top just past the centre line.
		expect(was).toBeGreaterThan(0.5);
		expect(now - was).toBeGreaterThan(MIN_LOWERING);
		disposeSubtree(spike.root);
	});

	test("every screen faces the eye, up the screen is up the view", () => {
		for (const name of COCKPIT_SCREENS) {
			const f = cabin.screens[name];
			expect(f.normal.dot(f.center.clone().negate())).toBeGreaterThan(0);
			expect(f.up.y).toBeGreaterThan(0);
			expect(f.right.x).toBeGreaterThan(0.99);
		}
	});

	test("the live faces fit their screens at their own aspect", () => {
		for (const [name, face] of [
			["radar", SCANNER_FACE_KM],
			["flight", INSTRUMENT_FACE_KM],
			["target", INSTRUMENT_FACE_KM],
		] as const) {
			const f = cabin.screens[name];
			const fit = containedFace(f, face[0] / face[1]);
			expect(fit.widthKm).toBeLessThanOrEqual(f.widthKm + 1e-12);
			expect(fit.heightKm).toBeLessThanOrEqual(f.heightKm + 1e-12);
			expect(fit.widthKm / fit.heightKm).toBeCloseTo(face[0] / face[1], 9);
			// One side binds: the face is as large as the screen allows.
			expect(
				Math.max(fit.widthKm / f.widthKm, fit.heightKm / f.heightKm),
			).toBeCloseTo(1, 9);
		}
	});

	test("no material is brighter than the emissive ceiling", () => {
		template.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			for (const m of [o.material].flat())
				if (m instanceof THREE.MeshStandardMaterial)
					expect(m.emissiveIntensity).toBeLessThanOrEqual(EMISSIVE_CEILING);
		});
	});

	test("every live screen is within half a lamp's range of a lamp, as placed", () => {
		// Placed as `main.ts` places them: in model space, so through the eye
		// offset, the scale and the pitch. Range and intensity are carried by
		// `cabinLight`, since a point light ignores its parent's scale.
		const lamps = COCKPIT_MODEL_LAMPS.map((lamp) => ({
			at: cabin.modelSpace.localToWorld(new THREE.Vector3(...lamp.positionM)),
			rangeKm: carriedLamp(lamp).distanceKm,
		}));
		for (const lamp of lamps)
			expect(lamp.at.length()).toBeLessThan(CABIN_FAR_KM);
		for (const name of ["radar", "flight", "target"] as const) {
			const centre = cabin.screens[name].center;
			const nearest = Math.min(
				...lamps.map((l) => l.at.distanceTo(centre) / l.rangeKm),
			);
			expect(nearest).toBeLessThan(0.5);
		}
	});

	test("a cabin's teardown frees its own labels and screens, never the shared model", () => {
		const shared = new Set<unknown>();
		template.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				shared.add(o.geometry);
				for (const m of [o.material].flat()) {
					shared.add(m);
					for (const value of Object.values(m))
						if (value instanceof THREE.Texture) shared.add(value);
				}
			}
		});
		expect([...shared].some((r) => r instanceof THREE.Texture)).toBe(true);
		const second = withCanvasStub(buildAuthoredCabin);
		const report = disposeSubtree(second.root);
		expect(report.freed.size).toBeGreaterThan(0);
		for (const r of report.freed) expect(shared.has(r)).toBe(false);
	});
});

describe("a screen's frame", () => {
	const quad = (order: number[]) => {
		const positions = [
			new THREE.Vector3(-1, 0, -2),
			new THREE.Vector3(1, 0, -2),
			new THREE.Vector3(1, 0.5, -3),
			new THREE.Vector3(-1, 0.5, -3),
		];
		const uvs = [
			new THREE.Vector2(0, 1),
			new THREE.Vector2(1, 1),
			new THREE.Vector2(1, 0),
			new THREE.Vector2(0, 0),
		];
		return [order.map((i) => positions[i]), order.map((i) => uvs[i])] as const;
	};

	test("is read from texture coordinates, so vertex order does not move it", () => {
		const a = screenFrame(...quad([0, 1, 2, 3]));
		const b = screenFrame(...quad([2, 0, 3, 1]));
		expect(b.center.distanceTo(a.center)).toBeLessThan(1e-12);
		expect(b.normal.distanceTo(a.normal)).toBeLessThan(1e-12);
		expect(a.widthKm).toBeCloseTo(2, 12);
		expect(a.heightKm).toBeCloseTo(Math.hypot(0.5, 1), 12);
	});

	test("refuses a quad with a missing corner", () => {
		const [p, uv] = quad([0, 1, 2]);
		expect(() => screenFrame(p, uv)).toThrow("no corner");
	});

	test("mounts the scanner frame: +y out of the screen, -z up it", () => {
		const f = screenFrame(...quad([0, 1, 2, 3]));
		const mount = screenMount(f);
		mount.updateMatrixWorld(true);
		const out = new THREE.Vector3(0, 1, 0).applyQuaternion(mount.quaternion);
		const up = new THREE.Vector3(0, 0, -1).applyQuaternion(mount.quaternion);
		expect(out.distanceTo(f.normal)).toBeLessThan(1e-9);
		expect(up.distanceTo(f.up)).toBeLessThan(1e-9);
	});
});
