import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
	HUB,
	NODE,
	TUBE_X,
	TUBE_Y,
	modularPlacements,
} from "../src/station-modular";
import { STATION_GEOMETRY } from "../src/station";
import { corridorIntrusions, crossings } from "./helpers/aperture-opening";
import asset from "../spikes/stations/assembly-kit/asset.json";
import {
	authorKit,
	CELL_KM,
	SPIKE_SEEDS,
} from "../spikes/stations/assembly-kit/blocks";
import { kitBinary } from "../spikes/stations/assembly-kit/prepare";
import { buildSpike } from "../spikes/stations/assembly-kit/assembly";

async function decodedKit() {
	const bytes = await kitBinary();
	const gltf = await new GLTFLoader().parseAsync(
		bytes.buffer as ArrayBuffer,
		"",
	);
	return gltf.scene;
}

describe("Assembly authored-block spike", () => {
	test("GLB roundtrip retains all three block families and 200 m tube sockets", async () => {
		const bytes = await kitBinary();
		expect(bytes.byteLength).toBe(asset.bytes);
		expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
			asset.sha256,
		);
		expect(bytes.byteLength).toBeLessThan(25_000_000);
		const kit = await decodedKit();
		expect(CELL_KM).toBe(0.2);
		for (const name of ["HUB", "NODE", "TUBE"])
			expect(kit.getObjectByName(name)).toBeDefined();
		const tube = new THREE.Box3().setFromObject(kit.getObjectByName("TUBE")!);
		expect(tube.min.x).toBeCloseTo(-0.1, 6);
		expect(tube.max.x).toBeCloseTo(0.1, 6);
		const node = new THREE.Box3().setFromObject(kit.getObjectByName("NODE")!);
		for (const axis of ["x", "y"] as const) {
			expect(node.min[axis]).toBeCloseTo(-0.1, 6);
			expect(node.max[axis]).toBeCloseTo(0.1, 6);
		}
		const source = authorKit();
		for (const name of ["HUB", "NODE", "TUBE"]) {
			const a = new THREE.Box3().setFromObject(source.getObjectByName(name)!);
			const b = new THREE.Box3().setFromObject(kit.getObjectByName(name)!);
			expect(a.min.distanceTo(b.min)).toBeLessThan(1e-7);
			expect(a.max.distanceTo(b.max)).toBeLessThan(1e-7);
		}
	});

	test("decoded tube and junction meet at the cell plane on both axes", async () => {
		const kit = await decodedKit();
		for (const turn of [0, Math.PI / 2]) {
			const pair = new THREE.Group();
			pair.add(kit.getObjectByName("NODE")!.clone());
			const tube = kit.getObjectByName("TUBE")!.clone();
			tube.rotation.z = turn;
			tube.position.set(CELL_KM * Math.cos(turn), CELL_KM * Math.sin(turn), 0);
			pair.add(tube);
			pair.updateMatrixWorld(true);
			const across = new THREE.Vector3(-Math.sin(turn), Math.cos(turn), 0);
			const along = new THREE.Vector3(Math.cos(turn), Math.sin(turn), 0);
			for (const t of [0.098, 0.1, 0.102]) {
				const origin = along
					.clone()
					.multiplyScalar(t)
					.addScaledVector(across, 0.08);
				const hits = new THREE.Raycaster(
					origin,
					across.clone().negate(),
					0,
					0.16,
				).intersectObject(pair, true);
				expect(hits.length).toBeGreaterThan(0);
			}
		}
	});

	for (const seed of SPIKE_SEEDS)
		test(`seed ${seed} keeps the plan, remaining modules, spinner and corridor`, async () => {
			const kit = await decodedKit();
			const before = modularPlacements(seed);
			const built = buildSpike(seed, kit);
			expect(built.placements).toEqual(before.placements);
			expect(modularPlacements(seed)).toEqual(before);
			for (const p of before.placements.filter((p) =>
				[TUBE_X, TUBE_Y, NODE].includes(p.module),
			)) {
				const instance = built.instances.find(
					(i) => i.module === p.module && i.dx === p.dx && i.dy === p.dy,
				);
				expect(instance).toBeDefined();
			}
			expect(built.instances.filter((p) => p.module === HUB)).toHaveLength(1);
			expect(built.mesh.spinner.getObjectByName("authored-HUB")).toBeDefined();
			expect(
				built.mesh.spinner.getObjectByName("authored-TUBE"),
			).toBeUndefined();
			expect(
				built.mesh.spinner.getObjectByName("authored-HUB_STATIC"),
			).toBeUndefined();
			expect(
				built.mesh.root.getObjectByName("authored-HUB_STATIC"),
			).toBeDefined();
			let batches = 0;
			built.mesh.root.traverse((o) => {
				if (
					o instanceof THREE.InstancedMesh &&
					/^[A-Z]+(_STATIC)?-/.test(o.name)
				)
					batches++;
			});
			expect(batches).toBe(20);
			for (const phase of [0, Math.PI / 4, Math.PI / 2]) {
				built.mesh.spinner.rotation.z = phase;
				built.mesh.root.rotation.z = -phase;
				expect(corridorIntrusions(built.mesh.root, "trade").size).toBe(0);
				expect(crossings(built.mesh.root, "trade")).toEqual([]);
			}
			built.mesh.spinner.rotation.z = 0;
			built.mesh.root.rotation.z = 0;
			built.mesh.root.updateMatrixWorld(true);
			const v = new THREE.Vector3(),
				matrix = new THREE.Matrix4();
			let reach = 0;
			built.mesh.root.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const pos = o.geometry.getAttribute("position");
				for (
					let i = 0;
					i < (o instanceof THREE.InstancedMesh ? o.count : 1);
					i++
				) {
					matrix.copy(o.matrixWorld);
					if (o instanceof THREE.InstancedMesh) {
						const instance = new THREE.Matrix4();
						o.getMatrixAt(i, instance);
						matrix.multiply(instance);
					}
					for (let j = 0; j < pos.count; j++)
						reach = Math.max(
							reach,
							v.fromBufferAttribute(pos, j).applyMatrix4(matrix).length() *
								STATION_GEOMETRY.trade.coreRadiusKm,
						);
				}
			});
			expect(reach).toBeLessThanOrEqual(1);
			expect(corridorIntrusions(built.mesh.root, "trade").size).toBe(0);
			built.mesh.dispose();
		});
});
