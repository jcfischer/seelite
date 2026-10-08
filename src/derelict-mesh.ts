import * as THREE from "three";
import { tearHull } from "./derelict-tear";
import { HULL_SPECS, type HullId } from "./hull";
import { buildShipMesh } from "./ship-mesh";
import { hullFinishId, setHullFinish } from "./ship-surface";
export function buildDerelictMesh(hull: HullId): THREE.Group {
	const previous = hullFinishId();
	let root: THREE.Group;
	try {
		setHullFinish("worn");
		root = buildShipMesh(hull, HULL_SPECS[hull].variant).root;
	} finally {
		setHullFinish(previous);
	}
	// Node #735: torn sections and an exposed frame, inside the built envelope.
	// Before the dark pass, so what the tear adds goes dark with the rest.
	const torn = tearHull(root, hull);
	const clones = new Map<THREE.Material, THREE.Material>();
	root.traverse((object) => {
		if (object.name === "nav-lights" || object instanceof THREE.Light) {
			object.visible = false;
			return;
		}
		if (!(object instanceof THREE.Mesh)) return;
		const dark = (source: THREE.Material) => {
			let material = clones.get(source);
			if (!material) {
				// The tear's own materials are already the wreck's; only the
				// roster's shared ones are cloned.
				material = source.userData.derelictOwned ? source : source.clone();
				if (material !== source) {
					material.onBeforeCompile = source.onBeforeCompile;
					material.customProgramCacheKey = source.customProgramCacheKey;
				}
				if (material instanceof THREE.MeshStandardMaterial) {
					material.color.multiplyScalar(0.28);
					material.emissive.set(0);
					material.emissiveIntensity = 0;
					material.roughness = Math.max(0.95, material.roughness);
				}
				clones.set(source, material);
			}
			return material;
		};
		object.material = Array.isArray(object.material)
			? object.material.map(dark)
			: dark(object.material);
	});
	root.userData.derelict = true;
	root.userData.finish = "worn";
	root.userData.torn = torn
		? { sites: torn.sites, frame: torn.frame.length }
		: null;
	return root;
}
/**
 * Wrecks own their cloned materials and the tear's geometries (marked
 * `derelictOwned`), while the rest of the roster's geometries and textures
 * are shared with every live ship of that hull.
 */
export function disposeDerelict(root: THREE.Group) {
	const materials = new Set<THREE.Material>();
	const geometries = new Set<THREE.BufferGeometry>();
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			materials.add(m);
		if (o.geometry.userData.derelictOwned) geometries.add(o.geometry);
	});
	root.removeFromParent();
	for (const material of materials) material.dispose();
	for (const geometry of geometries) geometry.dispose();
}

export function buildWreckContainer(offset: {
	x: number;
	y: number;
	z: number;
}): THREE.Mesh {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(0.006, 0.006, 0.01),
		new THREE.MeshStandardMaterial({ color: 0x887d64, roughness: 0.95 }),
	);
	mesh.add(
		new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(),
				new THREE.Vector3(-offset.x, -offset.y, -offset.z),
			]),
			new THREE.LineBasicMaterial({ color: 0x45443b }),
		),
	);
	return mesh;
}
export function disposeWreckContainer(mesh: THREE.Mesh) {
	mesh.removeFromParent();
	mesh.traverse((o) => {
		if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
			o.geometry.dispose();
			for (const m of Array.isArray(o.material) ? o.material : [o.material])
				m.dispose();
		}
	});
}
