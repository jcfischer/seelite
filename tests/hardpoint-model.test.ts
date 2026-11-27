import { expect, test } from "bun:test";
import * as THREE from "three";
import { buildFitting } from "../src/hardpoint-model";
import { fittingExitName, fittingFamilies } from "../src/fitting-families";

test("each family has its own visible shell with a common shoe and forward exit", () => {
	const counts = new Set<number>();
	for (const family of fittingFamilies) {
		const model = buildFitting(family);
		const body = model.children.find((part) => part instanceof THREE.Mesh);
		expect(body).toBeInstanceOf(THREE.Mesh);
		if (!(body instanceof THREE.Mesh)) throw Error(family);
		counts.add(body.geometry.attributes.position.count);
		expect(model.getObjectByName("attachment")?.position.length()).toBe(0);
		const exit = model.getObjectByName(fittingExitName(family));
		expect(exit?.position.z).toBeLessThan(0);
	}
	expect(counts.size).toBeGreaterThan(5);
	expect(fittingFamilies.length).toBe(9);
});

import { fitExterior, hardpointSeats } from "../src/hardpoint-exterior";
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
	const skin = [...root.children];
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
			.getObjectByName(fittingExitName(family))!
			.getWorldPosition(new THREE.Vector3());
		expect(port.x).toBeCloseTo(nose.x, 7);
		expect(port.y).toBeCloseTo(nose.y, 7);
		expect(nose.z - port.z).toBeCloseTo(0.00022, 7);

		const cast = new THREE.Raycaster(
			new THREE.Vector3(port.x, port.y, -1),
			new THREE.Vector3(0, 0, 1),
		);
		const bow = cast.intersectObjects(skin, true).find((hit) => hit.face);
		expect(bow).toBeDefined();
		const housing = mount.getObjectByName("housing")!;
		const box = new THREE.Box3().setFromObject(housing, true);
		expect(bow!.point.z - port.z).toBeGreaterThan(0);
		expect(bow!.point.z - port.z).toBeLessThan(0.0005);
		const rear = box.max.z - 0.00015;
		const down = new THREE.Raycaster(
			new THREE.Vector3(mount.position.x, 1, rear),
			new THREE.Vector3(0, -1, 0),
		);
		const deck = down.intersectObjects(skin, true).find((hit) => hit.face);
		const back = down.intersectObject(housing).find((hit) => hit.face);
		expect(deck).toBeDefined();
		expect(back).toBeDefined();
		expect(back!.point.y).toBeLessThan(deck!.point.y);
	}
});

test("every deck shoe crosses the hull skin at its mount", () => {
	for (const hull of HULL_IDS.filter((id) => id !== "courier")) {
		const root = buildShipMesh(hull, HULL_SPECS[hull].variant).root;
		const skin = [...root.children];
		const keys = hardpointKeys(hull);
		fitExterior(
			root,
			hull,
			Object.fromEntries(
				keys.map((key) => [
					key,
					{ module: "pulse-laser", size: 1, grade: "E" },
				]),
			),
		);
		root.updateMatrixWorld(true);
		for (const key of keys) {
			const mount = root.getObjectByName(key + "-pulse-laser")!;
			const cast = new THREE.Raycaster(
				new THREE.Vector3(mount.position.x, 1, mount.position.z),
				new THREE.Vector3(0, -1, 0),
			);
			const hit = cast
				.intersectObjects(skin, true)
				.find((h) => h.face && h.object.visible);
			expect(hit, `${hull}/${key}`).toBeDefined();
			const box = new THREE.Box3().setFromObject(mount, true);
			expect(
				hit!.point.y,
				`${hull} ${key} ${hit!.object.name}`,
			).toBeGreaterThan(box.min.y);
			expect(hit!.point.y, `${hull} ${key} ${hit!.object.name}`).toBeLessThan(
				box.max.y,
			);
		}
	}
});

test("a deck without hull metal cannot supply a seat", () => {
	const hull = "interceptor";
	shipMuzzlesKm(hull, HULL_SPECS[hull].variant);
	expect(() => hardpointSeats(new THREE.Group(), hull)).toThrow(
		/no hull surface/,
	);
});

test("a narrow deck supplies a measured seat nearer the muzzle", () => {
	const hull = "interceptor";
	const root = new THREE.Group();
	const deckHeight = 0.003;
	for (const m of shipMuzzlesKm(hull, HULL_SPECS[hull].variant)) {
		const plate = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.001, 0.0006));
		plate.position.set(m.x, deckHeight - 0.0005, m.z + 0.001);
		root.add(plate);
	}
	const points = hardpointSeats(root, hull);
	expect(points).toHaveLength(hardpointKeys(hull).length);
	for (const point of points) expect(point.y).toBeCloseTo(deckHeight, 8);
});
