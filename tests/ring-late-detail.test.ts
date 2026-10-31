import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { createTradeBuilder } from "../src/trade-flight";
import { updateStationVisuals } from "../src/station-mesh";
import { resourcesOf, isShared } from "../src/gpu-teardown";

const parts = (root: THREE.Object3D) => {
	const result: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh && o.name.startsWith("scale-detail"))
			result.push(o);
	});
	return result;
};

test("the Ring boot asset stays within the approved baseline byte budget", async () => {
	expect(statSync("src/models/trade-ring.glb").size).toBeLessThanOrEqual(
		5_875_120,
	);
	const base = await decodeShippedGlb("src/models/trade-ring.glb");
	expect(parts(base)).toEqual([]);
	const bytes = readFileSync("src/models/trade-ring-detail.glb");
	const json = JSON.parse(
		bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
	);
	expect(json.images ?? []).toEqual([]);
});

test("Ring detail defers its download, retries, attaches to live stations and respects their current band", async () => {
	const base = await decodeShippedGlb("src/models/trade-ring.glb");
	let requests = 0;
	let fail = true;
	let clock = 0;
	let loading: Promise<THREE.Group> | undefined;
	const build = createTradeBuilder(
		"b",
		base,
		async () => {
			requests++;
			if (fail) throw Error("offline");
			loading = decodeShippedGlb("src/models/trade-ring-detail.glb");
			return loading;
		},
		() => clock,
	);
	const far = build(7, 0x888888);
	const near = build(8, 0x888888);
	const gone = build(9, 0x888888);
	expect(far.lateDetail?.attached).toBe(false);
	expect(parts(near.root)).toEqual([]);
	updateStationVisuals(far, 0, far.silhouetteKm * 1000, "high");
	expect(requests).toBe(0);
	updateStationVisuals(near, 0, near.silhouetteKm * 200, "high");
	updateStationVisuals(near, 0, near.silhouetteKm * 200, "high");
	expect(requests).toBe(1);
	await new Promise((r) => setTimeout(r, 0));
	expect(near.lateDetail?.failure).toBeInstanceOf(Error);
	clock = 9999;
	updateStationVisuals(near, 0, near.silhouetteKm, "high");
	expect(requests).toBe(1);
	clock = 10000;
	fail = false;
	gone.dispose();
	updateStationVisuals(near, 0, near.silhouetteKm, "high");
	expect(requests).toBe(2);
	await loading;
	await new Promise((r) => setTimeout(r, 0));
	expect(near.lateDetail?.attached).toBe(true);
	expect(near.lateDetail?.failure).toBeUndefined();
	expect(parts(gone.root)).toEqual([]);
	const later = build(10, 0x888888);
	for (const station of [far, near, later]) {
		expect(parts(station.root)).toHaveLength(7);
		let triangles = 0;
		for (const part of parts(station.root)) {
			triangles +=
				(part.geometry.index?.count ??
					part.geometry.getAttribute("position").count) / 3;
			expect(part.material).toBeInstanceOf(THREE.MeshStandardMaterial);
			expect(part.visible).toBe(station.detail === "full");
			expect(station.accessories).toContain(part);
			for (const resource of resourcesOf(part))
				expect(isShared(resource)).toBe(true);
		}
		expect(triangles).toBe(383276);
	}
	const held = resourcesOf(near.root);
	let freedShared = 0;
	for (const resource of held)
		if (isShared(resource))
			resource.addEventListener("dispose", () => freedShared++);
	far.dispose();
	expect(freedShared).toBe(0);
	near.dispose();
	later.dispose();
});
