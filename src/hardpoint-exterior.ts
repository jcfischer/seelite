import * as THREE from "three";
import { HULL_SPECS, type HullId, type SlotSize } from "./hull";
import { shipMuzzlesKm } from "./ship-mesh";
import { hardpointKeys } from "./laser-modules";
import type { Loadout } from "./loadout";
import {
	buildFitting,
	isFittingFamily,
	type FittingFamily,
} from "./hardpoint-model";
import { disposeSubtree } from "./gpu-teardown";

export function placeFitting(
	family: FittingFamily,
	size: SlotSize,
	seat: THREE.Vector3,
	hull: HullId,
) {
	const model = buildFitting(family);
	model.scale.setScalar([0, 1.2, 1.7, 2.25][size] / 1000);
	model.position.copy(seat);
	if (hull === "courier") {
		const port = model.getObjectByName(
			family === "missile-rack" ? "launch-exit" : "muzzle",
		)!;
		model.scale.multiplyScalar(0.78);
		model.position.addScaledVector(port.position, -model.scale.z);
		model.position.z -= 0.00022;
	} else {
		model.position.y -= 0.33 * model.scale.y;
	}
	return model;
}

const seats = new WeakMap<
	THREE.Group,
	{ shape: THREE.Object3D | undefined; points: THREE.Vector3[] }
>();

export function hardpointSeats(root: THREE.Group, hull: HullId) {
	const cached = seats.get(root);
	if (cached && cached.shape === root.children[0]) return cached.points;
	const spec = HULL_SPECS[hull];
	root.updateWorldMatrix(true, true);
	const points = shipMuzzlesKm(hull, spec.variant).map((m) => {
		if (hull === "courier") return new THREE.Vector3(m.x, m.y, m.z);
		const z = m.z + Math.min(0.004, spec.env.lengthKm * 0.07);
		const from = root.localToWorld(
			new THREE.Vector3(m.x, spec.env.heightKm * 2, z),
		);
		const direction = new THREE.Vector3(0, -1, 0).transformDirection(
			root.matrixWorld,
		);
		const hits = new THREE.Raycaster(from, direction).intersectObjects(
			root.children,
			true,
		);
		const hit = hits.find(
			(h) => h.object instanceof THREE.Mesh && h.object.visible,
		);
		return hit
			? root.worldToLocal(hit.point)
			: new THREE.Vector3(m.x, m.y, m.z);
	});
	seats.set(root, { shape: root.children[0], points });
	return points;
}

export function fitExterior(root: THREE.Group, hull: HullId, loadout: Loadout) {
	const old = root.getObjectByName("fitted-hardpoints");
	if (old) {
		old.removeFromParent();
		disposeSubtree(old);
	}
	const points = hardpointSeats(root, hull);
	const fittings = new THREE.Group();
	fittings.name = "fitted-hardpoints";
	for (const [index, key] of hardpointKeys(hull).entries()) {
		const row = loadout[key];
		if (!row || !isFittingFamily(row.module)) continue;
		const model = placeFitting(row.module, row.size, points[index], hull);
		model.name = key + "-" + row.module;
		fittings.add(model);
	}
	root.add(fittings);
}
