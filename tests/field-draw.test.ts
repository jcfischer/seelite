import { expect, test } from "bun:test";
import * as THREE from "three";
import { fieldCentre, fieldRocks, systemFields } from "../src/asteroid-field";
import { FIELD_DRAW_KM, FieldDraw } from "../src/field-draw";
import { POINT_LEVEL, pxPerRadianFor } from "../src/field-lod";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import type { RockShapes } from "../src/asteroid-model";

const record = generateGalaxy(0x5ee11e, 0).systems[173];
const plan = systemFields(record, generateContents(record))[0];
const rocks = fieldRocks(record, plan);
const PX = pxPerRadianFor(1800, 60);

/** Sixteen archetypes of three levels, finest first, as unit-bound spheres. */
function shapes(): RockShapes {
	return {
		levels: Array.from({ length: 16 }, () =>
			[2, 1, 0].map((detail) => {
				const g = new THREE.IcosahedronGeometry(1, detail);
				g.deleteAttribute("uv");
				return g;
			}),
		),
		material: new THREE.MeshLambertMaterial(),
		textures: [],
	};
}
const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** The field-frame point 1.2 km into the long axis's corner, as star-centric. */
function cameraAt(local: { x: number; y: number; z: number }, t: number) {
	const centre = fieldCentre(plan, t);
	const q = plan.rotation;
	const v = new THREE.Vector3(local.x, local.y, local.z).applyQuaternion(
		new THREE.Quaternion(q.x, q.y, q.z, q.w),
	);
	return { x: centre.x + v.x, y: centre.y + v.y, z: centre.z + v.z };
}
const frame = (
	camera: { x: number; y: number; z: number },
	quality: "high" | "low" = "high",
	gameTime = 0,
) => ({
	gameTime,
	camera,
	pxPerRadian: PX,
	quality,
	shadows: quality === "high",
});

test("before shapes install the field draws points only, one draw", () => {
	const draw = new FieldDraw(plan, rocks);
	draw.update(frame(cameraAt({ x: 1.2, y: 1.2, z: 1.2 }, 0)));
	expect(draw.meshesInstalled).toBe(false);
	expect(draw.batches).toHaveLength(0);
	expect(draw.perLevel).toEqual([0, 0, 0, rocks.length]);
	const points = draw.root.getObjectByName("asteroid-points") as THREE.Points;
	expect(points.visible).toBe(true);
	expect(points.geometry.drawRange.count).toBe(rocks.length);
	expect(draw.levels.every((l) => l === POINT_LEVEL)).toBe(true);
	draw.dispose();
});

test("installed, the field is two batches and one points draw at the charted pose", async () => {
	const draw = new FieldDraw(plan, rocks);
	const warmed: THREE.BatchedMesh[] = [];
	const ok = await draw.install(
		shapes(),
		"authored",
		nextTask,
		() => true,
		async (mesh) => {
			warmed.push(mesh);
		},
	);
	expect(ok).toBe(true);
	expect(warmed).toHaveLength(2);
	expect(draw.batches).toHaveLength(2);
	expect(
		draw.root.children.filter((c) => (c as THREE.Points).isPoints),
	).toHaveLength(1);
	expect(draw.shapes).toBe("authored");

	const camera = cameraAt({ x: 1.2, y: 1.2, z: 1.2 }, 0);
	draw.update(frame(camera));
	const centre = fieldCentre(plan, 0);
	expect(draw.root.position.x).toBeCloseTo(centre.x - camera.x, 6);
	expect(draw.root.position.y).toBeCloseTo(centre.y - camera.y, 6);
	expect(draw.root.position.z).toBeCloseTo(centre.z - camera.z, 6);
	expect(draw.root.quaternion.x).toBeCloseTo(plan.rotation.x, 12);
	expect(draw.root.quaternion.w).toBeCloseTo(plan.rotation.w, 12);
	const [l0, l1, l2, pt] = draw.perLevel;
	expect(l0 + l1 + l2 + pt).toBe(rocks.length);
	expect(l0).toBeLessThanOrEqual(5);
	expect(l0 + l1 + l2).toBeGreaterThan(0);
	const [near, far] = draw.batches;
	const visible = (m: THREE.BatchedMesh) => {
		let n = 0;
		for (let i = 0; i < rocks.length; i++) if (m.getVisibleAt(i)) n++;
		return n;
	};
	expect(visible(near)).toBe(l0);
	expect(visible(far)).toBe(l1 + l2);
	draw.dispose();
});

test("a rock's instance matrix carries its drift and its spin at the clock", async () => {
	const draw = new FieldDraw(plan, rocks);
	await draw.install(
		shapes(),
		"authored",
		nextTask,
		() => true,
		async () => {},
	);
	const camera = cameraAt({ x: 1.2, y: 1.2, z: 1.2 }, 0);
	const m0 = new THREE.Matrix4();
	const m1 = new THREE.Matrix4();
	draw.update(frame(camera, "high", 0));
	const [near] = draw.batches;
	const big = rocks.findIndex((_, i) => draw.levels[i] === 0);
	expect(big).toBeGreaterThanOrEqual(0);
	near.getMatrixAt(big, m0);
	const t = 90;
	// The field rides its orbit, so the camera follows it to keep the same stand.
	draw.update(frame(cameraAt({ x: 1.2, y: 1.2, z: 1.2 }, t), "high", t));
	expect(draw.levels[big]).toBe(0);
	near.getMatrixAt(big, m1);
	// The clock moved the rock (drift) and turned it (spin).
	expect(m0.equals(m1)).toBe(false);
	const p0 = new THREE.Vector3().setFromMatrixPosition(m0);
	const p1 = new THREE.Vector3().setFromMatrixPosition(m1);
	expect(p0.distanceTo(p1)).toBeGreaterThan(0);
	const q0 = new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().extractRotation(m0),
	);
	const q1 = new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().extractRotation(m1),
	);
	expect(q0.angleTo(q1)).toBeGreaterThan(1e-4);
	// Scale is the rock's bounding radius.
	const scale = new THREE.Vector3().setFromMatrixScale(m1);
	expect(scale.x).toBeCloseTo(rocks[big].radiusKm, 6);
	draw.dispose();
});

test("only the near batch can cast, and only on high", async () => {
	const draw = new FieldDraw(plan, rocks);
	await draw.install(
		shapes(),
		"standin",
		nextTask,
		() => true,
		async () => {},
	);
	const camera = cameraAt({ x: 1.2, y: 1.2, z: 1.2 }, 0);
	const [near, far] = draw.batches;
	draw.update(frame(camera, "high"));
	expect(near.castShadow).toBe(true);
	expect(far.castShadow).toBe(false);
	draw.update(frame(camera, "low"));
	expect(near.castShadow).toBe(false);
	expect(far.castShadow).toBe(false);
	draw.dispose();
});

test("the field is hidden past the near layer's reach and shown again inside it", async () => {
	const draw = new FieldDraw(plan, rocks);
	await draw.install(
		shapes(),
		"authored",
		nextTask,
		() => true,
		async () => {},
	);
	draw.update(frame(cameraAt({ x: FIELD_DRAW_KM + 1000, y: 0, z: 0 }, 0)));
	expect(draw.root.visible).toBe(false);
	draw.update(frame(cameraAt({ x: 200, y: 0, z: 0 }, 0)));
	expect(draw.root.visible).toBe(true);
	draw.dispose();
});

test("a system left mid-install ends the install and frees the half-built batches", async () => {
	const draw = new FieldDraw(plan, rocks);
	let live = true;
	let slices = 0;
	const ok = await draw.install(
		shapes(),
		"authored",
		async () => {
			if (++slices === 3) live = false;
			await nextTask();
		},
		() => live,
		async () => {},
	);
	expect(ok).toBe(false);
	expect(draw.meshesInstalled).toBe(false);
	expect(
		draw.root.children.some((c) => (c as THREE.BatchedMesh).isBatchedMesh),
	).toBe(false);
	draw.dispose();
});

test("dispose releases the batches and later installs and updates do nothing", async () => {
	const draw = new FieldDraw(plan, rocks);
	await draw.install(
		shapes(),
		"authored",
		nextTask,
		() => true,
		async () => {},
	);
	const [near, far] = draw.batches;
	let disposed = 0;
	for (const m of [near, far])
		m.geometry.addEventListener("dispose", () => disposed++);
	const parent = new THREE.Scene();
	parent.add(draw.root);
	draw.dispose();
	expect(disposed).toBe(2);
	expect(draw.root.parent).toBeNull();
	expect(draw.meshesInstalled).toBe(false);
	draw.update(frame(cameraAt({ x: 1, y: 1, z: 1 }, 0)));
	expect(
		await draw.install(
			shapes(),
			"authored",
			nextTask,
			() => true,
			async () => {},
		),
	).toBe(false);
});

test("three's batching turns the surface normal with each instance", () => {
	// The station rock's ROCK_SURFACE does not (#950 D8); the field draws with
	// stock lit materials, which rely on this chunk for it.
	expect(THREE.ShaderChunk.defaultnormal_vertex).toContain(
		"mat3 bm = mat3( batchingMatrix )",
	);
	expect(THREE.ShaderChunk.defaultnormal_vertex).toContain(
		"transformedNormal = bm * transformedNormal",
	);
});
