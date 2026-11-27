import { expect, test } from "bun:test";
import * as THREE from "three";
import { buildFitting, fittingFamilies } from "../src/hardpoint-model";

test("each family has its own visible shell with a common shoe and forward exit", () => {
	const counts = new Set<number>();
	for (const family of fittingFamilies) {
		const model = buildFitting(family);
		const body = model.children.find((part) => part instanceof THREE.Mesh);
		expect(body).toBeInstanceOf(THREE.Mesh);
		if (!(body instanceof THREE.Mesh)) throw Error(family);
		counts.add(body.geometry.attributes.position.count);
		expect(model.getObjectByName("attachment")?.position.length()).toBe(0);
		const exit = model.getObjectByName(
			family === "missile-rack" ? "launch-exit" : "muzzle",
		);
		expect(exit?.position.z).toBeLessThan(0);
	}
	expect(counts.size).toBeGreaterThan(5);
	expect(fittingFamilies.length).toBe(9);
});

import { fitExterior } from "../src/hardpoint-exterior";
import { buildShipMesh, shipMuzzlesKm } from "../src/ship-mesh";
import { HULL_SPECS, HULL_IDS, type HullId } from "../src/hull";
import { stockLoadout } from "../src/loadout";
import { hardpointKeys } from "../src/laser-modules";

function checkMounts(hull: HullId) {
	const root = buildShipMesh(hull, HULL_SPECS[hull].variant).root;
	const stock = stockLoadout(hull);
	fitExterior(root, hull, stock);
	const keys = hardpointKeys(hull);
	expect(root.getObjectByName("fitted-hardpoints")?.children.length).toBe(
		keys.filter((key) => stock[key]).length,
	);
	const loadout = {
		h1: { module: "beam-laser", grade: "E", size: 1 },
		h2: { module: "missile-rack", grade: "E", size: 1 },
	} as const;
	fitExterior(root, hull, loadout);
	expect(root.getObjectByName("h1-beam-laser")).toBeDefined();
	if (keys.length > 1)
		expect(
			root
				.getObjectByName("h2-missile-rack")
				?.position.equals(root.getObjectByName("h1-beam-laser")!.position),
		).toBe(false);
	fitExterior(root, hull, {});
	expect(root.getObjectByName("fitted-hardpoints")?.children).toHaveLength(0);
}
test("equipping, swapping and clearing fittings follows each hull's slots", () => {
	for (const hull of HULL_IDS) checkMounts(hull);
});

test("Courier H1 seats each catalog fitting inside the bow, with its exit on the nose axis", () => {
	const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	const [nose] = shipMuzzlesKm("courier", HULL_SPECS.courier.variant, root);
	for (const family of [
		"pulse-laser",
		"beam-laser",
		"military-laser",
		"mining-laser",
		"missile-rack",
	] as const) {
		fitExterior(root, "courier", {
			h1: { module: family, size: 1, grade: "E" },
		});
		const mount = root.getObjectByName("h1-" + family)!;
		const port = mount
			.getObjectByName(family === "missile-rack" ? "launch-exit" : "muzzle")!
			.getWorldPosition(new THREE.Vector3());
		expect(port.x).toBeCloseTo(nose.x, 7);
		expect(port.y).toBeCloseTo(nose.y, 7);
		expect(nose.z - port.z).toBeCloseTo(0.00022, 7);

		expect(mount.position.z).toBeGreaterThan(nose.z);
	}
});
