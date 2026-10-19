import { expect, test } from "bun:test";
import { NodeIO } from "@gltf-transform/core";
import * as THREE from "three";
import {
	STANDIN_DETAIL,
	buildStandInRocks,
	flattenAuthoredRocks,
	standInShape,
} from "../src/asteroid-model";

function sceneOf(archetypes: number, levels = 3) {
	const scene = new THREE.Group();
	const material = new THREE.MeshStandardMaterial();
	for (let a = 0; a < archetypes; a++)
		for (let l = 0; l < levels; l++) {
			const g = new THREE.IcosahedronGeometry(1, 2 - l);
			g.setAttribute("color", g.getAttribute("position").clone());
			const mesh = new THREE.Mesh(g, material);
			mesh.name = `rock_${String(a).padStart(2, "0")}_basalt_L${l}`;
			mesh.position.set(a * 3, 0, 0);
			scene.add(mesh);
		}
	return scene;
}

test("the shipped GLB names sixteen archetypes of three levels the way the loader reads them", async () => {
	const doc = await new NodeIO().read("src/models/asteroids.glb");
	const names = doc
		.getRoot()
		.listNodes()
		.map((n) => n.getName())
		.filter((n) => n.startsWith("rock_"));
	expect(names).toHaveLength(48);
	for (const name of names) expect(name).toMatch(/^rock_(\d+)_.*_L([012])$/);
	const archetypes = new Set(names.map((n) => /^rock_(\d+)/.exec(n)![1]));
	expect(archetypes.size).toBe(16);
});

test("flattening keeps position, normal and uv only, in unit-bound space, with a Lambert material", () => {
	const shapes = flattenAuthoredRocks(sceneOf(16));
	expect(shapes.levels).toHaveLength(16);
	for (const row of shapes.levels) {
		expect(row).toHaveLength(3);
		for (const g of row) {
			expect(Object.keys(g.attributes).sort()).toEqual([
				"normal",
				"position",
				"uv",
			]);
		}
	}
	expect(shapes.material.type).toBe("MeshLambertMaterial");
	// The node transform is baked in, so every level of an archetype shares a frame.
	expect(shapes.levels[3][0].boundingSphere!.center.x).toBeCloseTo(9, 6);
});

test("an incomplete asset is refused rather than drawn with holes", () => {
	expect(() => flattenAuthoredRocks(sceneOf(15))).toThrow(/Incomplete/);
	expect(() => flattenAuthoredRocks(sceneOf(16, 2))).toThrow(/Incomplete/);
	const odd = sceneOf(16);
	odd.children[0].name = "something_else";
	expect(() => flattenAuthoredRocks(odd)).toThrow(/Unrecognised/);
});

test("the stand-in is plain fill: three levels per archetype, bounded by the unit sphere", () => {
	const levels = standInShape(5);
	expect(levels).toHaveLength(3);
	const triangles = levels.map((g) => g.index!.count / 3);
	// mergeVertices keeps every face; r170's detail d gives 20 (d+1)² faces.
	expect(triangles).toEqual(STANDIN_DETAIL.map((d) => 20 * (d + 1) ** 2));
	let max = 0;
	for (const g of levels) {
		const p = g.getAttribute("position");
		for (let i = 0; i < p.count; i++)
			max = Math.max(max, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
	}
	expect(max).toBeGreaterThan(0.9999999);
	expect(max).toBeLessThanOrEqual(1.0000001);
});

test("the failed-load shapes are sixteen plain archetypes, with no rock-surface splice", () => {
	const work = buildStandInRocks();
	let slices = 0;
	let step = work.next();
	while (!step.done) {
		slices++;
		step = work.next();
	}
	expect(slices).toBe(16);
	const shapes = step.value;
	expect(shapes.levels).toHaveLength(16);
	expect(shapes.material.type).toBe("MeshStandardMaterial");
	// `applyRockSurface` replaces onBeforeCompile; a plain material keeps the default no-op.
	expect(shapes.material.onBeforeCompile.toString()).toBe(
		new THREE.MeshStandardMaterial().onBeforeCompile.toString(),
	);
	expect(shapes.textures).toEqual([]);
	// The result is memoised: a second field pays nothing.
	expect(buildStandInRocks().next().value).toBe(shapes);
});
