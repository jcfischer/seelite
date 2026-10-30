import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CABIN_FAR_KM, CABIN_NEAR_KM } from "../src/cabin-pass";
import {
	type AuthoredCabin,
	adoptCockpitTemplate,
	buildAuthoredCabin,
	COCKPIT_MODEL_KM_PER_M,
	COCKPIT_MODEL_LAMPS,
	carriedLamp,
	COCKPIT_CREASE_DEG,
	containedFace,
	INSTRUMENT_FACE_KM,
	SCANNER_FACE_KM,
	screenFrame,
	screenMount,
	smoothCockpitNormals,
} from "../src/cockpit-model";
import { disposeSubtree } from "../src/gpu-teardown";
import { EMISSIVE_CEILING } from "../src/light-rig";
import {
	degBetween,
	type PositionCopies,
	pairCopies,
} from "../scripts/lib/cockpit-normals";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";

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
/** Rays down the centre line for the dash top: one per 0.25% of the height. */
const DASH_ROWS = 400;
/** The coverage grid over a 4:3 frame. Coarse on purpose: an unaccelerated
 *  raycast against the model costs milliseconds a ray, and 32 x 24 took nine
 *  seconds. It moved the shares by under two points against this grid. */
const SHARE_COLS = 16;
const SHARE_ROWS = 12;
/** What the row below reads (node #806): the dash top on the centre line, as
 *  a fraction of the height down from the top, and the cabin's share of a
 *  4:3 frame — 96 and 88 of the grid's 192 rays. */
const SPIKE_DASH_TOP = 0.5475;
const DASH_TOP = 0.6;
const SPIKE_CABIN_SHARE = 96 / 192;
const CABIN_SHARE = 88 / 192;

let template: THREE.Group;
let cabin: AuthoredCabin;
/** The same model as exported, never adopted: the normals Blender wrote. */
let exported: THREE.Group;
beforeAll(async () => {
	exported = await decodeShippedGlb("src/models/courier-cockpit.glb");
	template = await decodeShippedGlb("src/models/courier-cockpit.glb");
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

	test("the dash top drops on the centre line, and the cabin covers less of a 4:3 frame", () => {
		// Node #806: the principal flew the spike's frame (#794) and found the
		// cabin too high. Two readings of the same rays, both against the spike's
		// frame: how far down the centre line, where the reticle is, the first
		// fitting starts; and what share of a 4:3 frame any fitting covers, on a
		// grid of rays. `cockpit-model.ts` and `beam-glass.ts` quote both
		// figures, so both are pinned here and not only their direction.
		const halfY = Math.tan((FOV_Y_DEG * Math.PI) / 360);
		const ray = new THREE.Raycaster();
		const origin = new THREE.Vector3();
		const hits = (root: THREE.Object3D, ndcX: number, ndcY: number) => {
			ray.set(
				origin,
				new THREE.Vector3(
					ndcX * halfY * NARROW_ASPECT,
					ndcY * halfY,
					-1,
				).normalize(),
			);
			return ray.intersectObject(root, true).length > 0;
		};
		const dashTop = (root: THREE.Object3D) => {
			for (let row = DASH_ROWS / 2; row < DASH_ROWS; row++)
				if (hits(root, 0, 1 - (2 * (row + 0.5)) / DASH_ROWS))
					return row / DASH_ROWS;
			return 1;
		};
		const coverage = (root: THREE.Object3D) => {
			let n = 0;
			for (let row = 0; row < SHARE_ROWS; row++)
				for (let col = 0; col < SHARE_COLS; col++)
					if (
						hits(
							root,
							(2 * (col + 0.5)) / SHARE_COLS - 1,
							1 - (2 * (row + 0.5)) / SHARE_ROWS,
						)
					)
						n++;
			return n / (SHARE_ROWS * SHARE_COLS);
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
		spike.root.updateMatrixWorld(true);
		cabin.root.updateMatrixWorld(true);
		const was = { top: dashTop(spike.root), share: coverage(spike.root) };
		const now = { top: dashTop(cabin.root), share: coverage(cabin.root) };
		disposeSubtree(spike.root);
		// The figures the prose quotes, to the grid's resolution.
		expect(was.top).toBeCloseTo(SPIKE_DASH_TOP, 2);
		expect(now.top).toBeCloseTo(DASH_TOP, 2);
		expect(was.share).toBeCloseTo(SPIKE_CABIN_SHARE, 2);
		expect(now.share).toBeCloseTo(CABIN_SHARE, 2);
		// And the direction, with a floor: the lowering is the node.
		expect(now.top - was.top).toBeGreaterThan(MIN_LOWERING);
		expect(now.share).toBeLessThan(was.share);
	});

	test("every screen faces the eye, up the screen is up the view", () => {
		for (const name of Object.keys(cabin.screens)) {
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

describe("the cockpit's normals (node #839)", () => {
	// The canopy struts are `curve_path` tubes, 12 to 20 sides, and every quad
	// of them was exported with its own face normal: the support hoop's vertex
	// normals sat a median 9.09° off the tube's true radial and the rib's
	// 15.03°, which is half a facet each — flat shading. Lit by the sun on a
	// 0.65-metal finish, each quad caught the highlight whole or not at all,
	// and bloom drew the bright ones as rectangles.

	/** Every position's copies, exported against adopted; read once. */
	let copies: PositionCopies[];
	beforeAll(() => {
		copies = pairCopies(exported, template);
	});

	test("the crease sits in the empty band of the exported split angles", () => {
		// Tube facet steps (18°, 22.5°, 30°, 36°) are below it and the chamfers,
		// eight-sided studs (45°) and box edges (90°) above. The band is the one
		// `COCKPIT_CREASE_DEG`'s comment states, held at both ends: a re-export
		// that puts a join anywhere inside 42.46°–44.81° goes red here.
		let below = 0;
		let above = 180;
		for (const p of copies)
			for (let i = 0; i < p.before.length; i++)
				for (let j = i + 1; j < p.before.length; j++) {
					const d = degBetween(p.before[i], p.before[j]);
					if (d < COCKPIT_CREASE_DEG) below = Math.max(below, d);
					else above = Math.min(above, d);
				}
		expect(below).toBeLessThan(42.465);
		expect(above).toBeGreaterThan(44.805);
	});

	test("where every face at a position is inside the crease, all its copies share one normal", () => {
		// Red on the exported model: a tube's four quads meet at each grid
		// vertex with four different normals.
		let smoothPositions = 0;
		let split = 0;
		for (const p of copies) {
			if (p.before.length < 2) continue;
			const inside = p.before.every((a) =>
				p.before.every((b) => degBetween(a, b) < COCKPIT_CREASE_DEG),
			);
			if (!inside) continue;
			smoothPositions++;
			if (p.after.some((n) => degBetween(n, p.after[0]) > 1e-3)) split++;
		}
		expect(smoothPositions).toBeGreaterThan(5000);
		expect(split).toBe(0);
	});

	test("a copy with no other face inside the crease keeps its exported normal", () => {
		// Box edges, chamfer steps and the studs' 45° facets stay hard.
		let alone = 0;
		let worst = 0;
		for (const p of copies)
			for (let i = 0; i < p.before.length; i++) {
				const joins = p.before.some(
					(b, j) => j !== i && degBetween(p.before[i], b) < COCKPIT_CREASE_DEG,
				);
				if (joins) continue;
				alone++;
				worst = Math.max(worst, degBetween(p.after[i], p.before[i]));
			}
		expect(alone).toBeGreaterThan(10000);
		expect(worst).toBeLessThan(1e-4);
	});

	test("no normal moves by more than the crease", () => {
		let worst = 0;
		for (const p of copies)
			for (let i = 0; i < p.before.length; i++)
				worst = Math.max(worst, degBetween(p.after[i], p.before[i]));
		expect(worst).toBeGreaterThan(0);
		expect(worst).toBeLessThan(COCKPIT_CREASE_DEG);
	});

	test("a quad's corner weighs the same whichever diagonal splits it", () => {
		// A flat quad in the xz plane meets a triangle tilted 30° at the
		// origin. Weighted by area, the quad's corner there counts the quad's
		// whole area when the diagonal runs through it and half when it does
		// not, and the joined normal moves with the split. Weighted by the
		// corner's angle, both splits give the quad 90°.
		const tilt = (30 * Math.PI) / 180;
		const quad = [
			[0, 0, 0],
			[1, 0, 0],
			[1, 0, -1],
			[0, 0, -1],
		];
		const side = [
			[0, 0, 0],
			[1, -Math.sin(tilt), Math.cos(tilt)],
			[1, 0, 0],
		];
		const joined = (through: boolean) => {
			const tris = through
				? [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]
				: [quad[0], quad[1], quad[3], quad[1], quad[2], quad[3]];
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				"position",
				new THREE.Float32BufferAttribute([...tris, ...side].flat(), 3),
			);
			geometry.computeVertexNormals();
			expect(smoothCockpitNormals(geometry)).toBeGreaterThan(0);
			return new THREE.Vector3().fromBufferAttribute(
				geometry.getAttribute("normal"),
				0,
			);
		};
		const through = joined(true);
		const across = joined(false);
		// The join is real: the quad's corner leaned toward the side face.
		expect(degBetween(through, new THREE.Vector3(0, 1, 0))).toBeGreaterThan(1);
		expect(degBetween(through, across)).toBeLessThan(1e-4);
	});

	test("screens, labels and keys keep their exported vertices and normals", () => {
		const raw = new Map<string, THREE.BufferGeometry>();
		exported.traverse((o) => {
			if (o instanceof THREE.Mesh) raw.set(o.name, o.geometry);
		});
		let quads = 0;
		template.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || !/^(screen|label|key)-/.test(o.name))
				return;
			quads++;
			const was = raw.get(o.name) as THREE.BufferGeometry;
			for (const name of ["position", "normal", "uv"])
				expect(Array.from(o.geometry.getAttribute(name).array)).toEqual(
					Array.from(was.getAttribute(name).array),
				);
		});
		expect(quads).toBe(7 + 7 + 15);
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
