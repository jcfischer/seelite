/** The hull language is display geometry, so its identity and bounds are cheap
 * to prove without a browser. Browser probes own the camera/HUD experience. */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_IDS, HULL_VISUALS, buildShipMesh } from "../src/ship-mesh";

function bounds(id: (typeof HULL_IDS)[number]) {
	const root = buildShipMesh(id).root;
	root.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(root);
}

describe("procedural ship visual language", () => {
	test("each explicit visual archetype is deterministic and bounded", () => {
		for (const id of HULL_IDS) {
			const first = bounds(id);
			const second = bounds(id);
			expect(first.min.toArray()).toEqual(second.min.toArray());
			expect(first.max.toArray()).toEqual(second.max.toArray());
			const reach = Math.max(
				...first.min.toArray().map(Math.abs),
				...first.max.toArray().map(Math.abs),
			);
			expect(reach).toBeLessThanOrEqual(HULL_VISUALS[id].reachKm * 1.00001);
			expect(reach).toBeGreaterThan(HULL_VISUALS[id].reachKm * 0.5);
		}
	});

	test("roles have visibly different long-axis proportions before detail resolves", () => {
		const size = (id: (typeof HULL_IDS)[number]) =>
			bounds(id).getSize(new THREE.Vector3());
		const courier = size("courier");
		const interceptor = size("interceptor");
		const freighter = size("freighter");
		expect(courier.z / courier.x).not.toBeCloseTo(
			interceptor.z / interceptor.x,
			2,
		);
		expect(courier.y).not.toBeCloseTo(freighter.y, 3);
	});

	test("each hull has stable identity and motion-direction exhaust cues", () => {
		for (const id of HULL_IDS) {
			const root = buildShipMesh(id).root;
			expect(root.name).toBe(`hull-${id}`);
			expect(root.userData.role).toBe(HULL_VISUALS[id].role);
			expect(
				root.children.some((child) => child.name.includes("exhaust")),
			).toBe(true);
		}
	});
});
