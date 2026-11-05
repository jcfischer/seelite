import { afterAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	createAssemblyBlocks,
	assemblyInstances,
} from "../src/assembly-flight";
import { buildStationForm, installAssemblyBlocks } from "../src/station-mesh";
import { modularPlacements } from "../src/station-modular";
import { stationModel } from "../src/model-catalog";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { corridorIntrusions, crossings } from "./helpers/aperture-opening";
import { forEachWorldTriangle } from "./helpers/world-triangles";
import { resourcesOf, isShared } from "../src/gpu-teardown";
import { ASSEMBLY_SEEDS } from "./helpers/solved-forms";
import { ASSEMBLY_BLOCKS } from "../src/assembly-plan";

afterAll(() => installAssemblyBlocks(null));

test("bright navigation materials do not dim Assembly work lamps", () => {
	const kit = new THREE.Group();
	const lamp = new THREE.MeshStandardMaterial({
		emissive: 0xffaa22,
		emissiveIntensity: 4,
	});
	const navigation = new THREE.MeshStandardMaterial({
		emissive: 0xff0000,
		emissiveIntensity: 16,
	});
	navigation.name = "navigation-red";
	for (const name of ASSEMBLY_BLOCKS) {
		const block = new THREE.Group();
		block.name = name;
		block.add(
			new THREE.Mesh(new THREE.BoxGeometry(), lamp),
			new THREE.Mesh(new THREE.BoxGeometry(), navigation),
		);
		kit.add(block);
	}
	createAssemblyBlocks(kit);
	expect(lamp.emissiveIntensity).toBe(1);
	expect(navigation.emissiveIntensity).toBe(8);
});

describe("authored Assembly production blocks", () => {
	test("triangle measurements visit transformed instances rather than their source at the origin", () => {
		const geometry = new THREE.BufferGeometry().setAttribute(
			"position",
			new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
		);
		const mesh = new THREE.InstancedMesh(
			geometry,
			new THREE.MeshBasicMaterial(),
			2,
		);
		mesh.position.z = 3;
		mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 0, 0));
		mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(7, 0, 0));
		const points: number[][] = [];
		forEachWorldTriangle(mesh, (t) => points.push(t.a.toArray()));
		expect(points).toEqual([
			[2, 0, 3],
			[7, 0, 3],
		]);
	});
	test("catalog registers the Assembly exterior", () => {
		expect(stationModel({ type: "trade", formId: "d" })).toBe("trade/d");
	});
	test("every kind uses the seed's cells, with shared blocks and a separate hub", async () => {
		const kit = await decodeShippedGlb("src/models/trade-assembly.glb");
		const draw = createAssemblyBlocks(kit);
		const kinds = new Set<number>();
		for (const seed of new Set([...ASSEMBLY_SEEDS, 47, 1234, 99])) {
			installAssemblyBlocks(null);
			const fallback = buildStationForm("trade", "d", 0x888888, 7, seed);
			expect(
				fallback.root.getObjectByName("authored-exterior"),
			).toBeUndefined();
			fallback.dispose();
			const plan = modularPlacements(seed);
			installAssemblyBlocks(draw);
			const mesh = buildStationForm("trade", "d", 0x888888, 7, seed);
			const instances = assemblyInstances(plan.placements);
			for (const p of plan.placements) {
				kinds.add(p.module);
				expect(
					instances.some(
						(i) => i.dx === p.dx && i.dy === p.dy && i.module === p.module,
					),
				).toBe(true);
			}
			expect(modularPlacements(seed)).toEqual(plan);
			expect(mesh.spinner.getObjectByName("authored-HUB")).toBeDefined();
			expect(mesh.spinner.getObjectByName("authored-TUBE")).toBeUndefined();
			expect(
				mesh.spinner.getObjectByName("authored-HUB_STATIC"),
			).toBeUndefined();
			expect(mesh.root.getObjectByName("authored-HUB_STATIC")).toBeDefined();
			const staticPart = mesh.root.getObjectByName("authored-TUBE")!;
			mesh.root.updateMatrixWorld(true);
			const before = staticPart.matrixWorld.clone();
			for (const phase of [0, Math.PI / 4, Math.PI / 2]) {
				mesh.root.rotation.z = 0;
				mesh.spinner.rotation.z = phase;
				mesh.root.updateMatrixWorld(true);
				expect(staticPart.matrixWorld.equals(before)).toBe(true);
				mesh.root.rotation.z = -phase;
				expect(corridorIntrusions(mesh.root, "trade").size).toBe(0);
				expect(crossings(mesh.root, "trade", true)).toEqual([]);
				let reach = 0;
				forEachWorldTriangle(mesh.root, (t) => {
					for (const v of [t.a, t.b, t.c])
						reach = Math.max(reach, v.length() * 0.6);
				});
				expect(reach).toBeLessThanOrEqual(1);
			}
			let batches = 0;
			mesh.root.traverse((o) => {
				if (o instanceof THREE.InstancedMesh && o.userData.assemblyBlock) {
					batches++;
					expect(o.count).toBe(
						instances.filter((i) => i.block === o.userData.assemblyBlock)
							.length,
					);
					const source = kit.getObjectByName(String(o.userData.assemblyBlock))!;
					let original: THREE.Mesh | undefined;
					source.traverse((s) => {
						if (s instanceof THREE.Mesh && s.geometry === o.geometry)
							original = s;
					});
					expect(original).toBeDefined();
					for (const [n, i] of instances
						.filter((i) => i.block === o.userData.assemblyBlock)
						.entries()) {
						const actual = new THREE.Matrix4();
						o.getMatrixAt(n, actual);
						const expected = new THREE.Matrix4()
							.makeRotationZ(i.turn)
							.setPosition(i.dx * 0.2, i.dy * 0.2, 0)
							.multiply(original!.matrixWorld);
						for (let k = 0; k < 16; k++)
							expect(actual.elements[k]).toBeCloseTo(expected.elements[k], 6);
					}
				}
			});
			expect(batches).toBeGreaterThan(20);
			expect(batches).toBeLessThan(80);
			const second = buildStationForm("trade", "d", 0x888888, 9, seed);
			const held = resourcesOf(second.root);
			let disposedShared = 0,
				disposedInstances = 0,
				instanceCount = 0;
			for (const resource of held)
				if (isShared(resource))
					resource.addEventListener("dispose", () => disposedShared++);
			mesh.root.traverse((o) => {
				if (o instanceof THREE.InstancedMesh) {
					instanceCount++;
					o.addEventListener("dispose", () => disposedInstances++);
				}
			});
			mesh.dispose();
			expect(disposedShared).toBe(0);
			expect(disposedInstances).toBe(instanceCount);
			second.dispose();
		}
		expect([...kinds].sort((a, b) => a - b)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9,
		]);
	}, 120_000);
});
