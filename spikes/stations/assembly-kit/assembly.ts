import * as THREE from "three";
import { buildStationForm } from "../../../src/station-mesh";
import {
	HUB,
	NODE,
	TUBE_X,
	TUBE_Y,
	modularPlacements,
} from "../../../src/station-modular";
import { CELL_KM } from "./blocks.mjs";

export function buildSpike(seed: number, kit?: THREE.Object3D) {
	const mesh = buildStationForm("trade", "d", 0xa6adb0, 0, seed);
	const { placements } = modularPlacements(seed);
	const instances = placements
		.filter((p) => [HUB, NODE, TUBE_X, TUBE_Y].includes(p.module))
		.map((p) => ({ module: p.module, dx: p.dx, dy: p.dy }));
	if (!kit) return { mesh, placements, instances: [] };
	const group = mesh.spinner.parent!;
	const remove: THREE.Object3D[] = [];
	mesh.root.traverse((o) => {
		if (
			/^(module--?\d+--?\d+|node--?\d+--?\d+|node-stub-|collar$)/.test(
				o.name,
			) ||
			o.name === "core" ||
			(o.parent === mesh.spinner && o.name === "greebles")
		)
			remove.push(o);
	});
	for (const o of remove) o.removeFromParent();
	for (const [name, kinds] of [
		["HUB", [HUB]],
		["HUB_STATIC", [HUB]],
		["NODE", [NODE]],
		["TUBE", [TUBE_X, TUBE_Y]],
	] as const) {
		const cells = placements.filter((p) =>
			(kinds as readonly number[]).includes(p.module),
		);
		if (!cells.length) continue;
		const source = kit.getObjectByName(name);
		if (!source) throw Error(`Missing authored block ${name}`);
		const part = new THREE.Group();
		part.name = `authored-${name}`;
		(name === "HUB" ? mesh.spinner : group).add(part);
		source.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			const batch = new THREE.InstancedMesh(
				o.geometry.clone(),
				(o.material as THREE.Material).clone(),
				cells.length,
			);
			batch.name = o.name;
			for (const [index, p] of cells.entries()) {
				const q = new THREE.Quaternion().setFromAxisAngle(
					new THREE.Vector3(0, 0, 1),
					p.module === TUBE_Y ? Math.PI / 2 : 0,
				);
				batch.setMatrixAt(
					index,
					new THREE.Matrix4().compose(
						new THREE.Vector3(p.dx * CELL_KM, p.dy * CELL_KM, 0),
						q,
						new THREE.Vector3(1, 1, 1),
					),
				);
			}
			batch.instanceMatrix.needsUpdate = true;
			batch.computeBoundingSphere();
			part.add(batch);
		});
	}
	return { mesh, placements, instances };
}
