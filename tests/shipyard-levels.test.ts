/**
 * Node #947: the candidate reduced shipyard levels the policy measurement
 * builds. They are not shipped; the figures quoted in the receipt
 * (docs/receipts/node-947-shipyard-lod-policy.md) are asserted here.
 * https://github.com/jcfischer/seelite/issues/947
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { stationSilhouetteKm } from "../src/station-mesh";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	levelTargetM,
	reducedYard,
	YARD_LEVEL_REACHED_ERROR_M,
	YARD_LEVELS,
} from "../scripts/lib/shipyard-levels";

await MeshoptSimplifier.ready;

const FORMS = [
	{
		form: "a",
		file: "gantry",
		full: 200_924,
		lod1: 119_193,
		lod2: 2_000,
		lodc: 31_732,
	},
	{
		form: "b",
		file: "foundry",
		full: 209_272,
		lod1: 116_954,
		lod2: 2_378,
		lodc: 10_665,
	},
	{
		form: "c",
		file: "slipway",
		full: 135_736,
		lod1: 61_844,
		lod2: 6_348,
		lodc: 9_424,
	},
] as const;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh) out.push(o);
	});
	return out;
}

function triangles(list: readonly THREE.Mesh[]): number {
	let n = 0;
	for (const mesh of list) {
		const g = mesh.geometry as THREE.BufferGeometry;
		n += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
	}
	return n;
}

function userDataValues(root: THREE.Object3D, key: string): unknown[] {
	const out: unknown[] = [];
	root.traverse((o) => {
		if (key in o.userData) out.push(o.userData[key]);
	});
	return out;
}

describe("shipyard candidate levels (#947)", () => {
	for (const row of FORMS) {
		describe(`form ${row.form}, ${row.file}`, async () => {
			const scene = await decodeShippedGlb(
				`src/models/shipyard-${row.file}.glb`,
			);
			scene.updateMatrixWorld(true);
			const full = meshes(scene);
			const silhouetteKm = stationSilhouetteKm("shipyard", row.form);
			const built = YARD_LEVELS.map((level) => {
				const errorM = levelTargetM(level, silhouetteKm);
				const root = reducedYard(scene, errorM, level.name);
				root.updateMatrixWorld(true);
				return { ...level, errorM, root, drawn: meshes(root) };
			});

			test("the model is the one the receipt counts", () => {
				expect(triangles(full)).toBe(row.full);
			});

			for (const level of built)
				describe(level.name, () => {
					test("holds the triangles the receipt quotes", () => {
						expect(triangles(level.drawn)).toBe(row[level.name]);
					});

					test("is within the error it was asked for, by the simplifier's own metric", () => {
						const reached = level.root.userData[YARD_LEVEL_REACHED_ERROR_M];
						expect(reached).toBeGreaterThan(0);
						expect(reached).toBeLessThanOrEqual(level.errorM + 1e-6);
					});

					test("draws no more meshes or triangles than the model", () => {
						expect(level.drawn.length).toBeLessThanOrEqual(full.length);
						expect(triangles(level.drawn)).toBeLessThan(triangles(full));
					});

					test("keeps uv1 as the model's own buffer, and the model's materials", () => {
						const byName = new Map(full.map((m) => [m.name, m]));
						expect(byName.size).toBe(full.length);
						for (const mesh of level.drawn) {
							const source = byName.get(mesh.name)!;
							expect(source).toBeDefined();
							const uv1 = mesh.geometry.getAttribute("uv1");
							expect(uv1).toBeDefined();
							expect(uv1).toBe(source.geometry.getAttribute("uv1"));
							expect(mesh.geometry.getAttribute("position")).toBe(
								source.geometry.getAttribute("position"),
							);
							expect(mesh.material).toBe(source.material);
							expect(mesh.geometry.getIndex()!.count % 3).toBe(0);
							for (const i of mesh.geometry.getIndex()!.array)
								expect(i).toBeLessThan(uv1.count);
						}
					});

					test("keeps the marks and the lightmap and grid figures where they were", () => {
						for (const name of ["life-capsule", "aperture-plane", "hub-face"]) {
							const a = scene.getObjectByName(name)!;
							const b = level.root.getObjectByName(name)!;
							expect(b).toBeDefined();
							expect(
								b
									.getWorldPosition(new THREE.Vector3())
									.distanceTo(a.getWorldPosition(new THREE.Vector3())),
							).toBeLessThan(1e-6);
						}
						for (const key of ["lightmap_scale", "work_light_probes"]) {
							const want = userDataValues(scene, key);
							expect(want.length).toBeGreaterThan(0);
							expect(userDataValues(level.root, key)).toEqual(want);
						}
					});
				});

			test("a coarser target leaves fewer triangles", () => {
				const count = (name: string) =>
					triangles(built.find((l) => l.name === name)!.drawn);
				expect(count("lod2")).toBeLessThan(count("lodc"));
				expect(count("lodc")).toBeLessThan(count("lod1"));
				expect(count("lod1")).toBeLessThan(triangles(full));
			});
		});
	}
});
