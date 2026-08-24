/**
 * Procedural ship silhouettes for the renderer.
 *
 * This module deliberately owns only display geometry. `sim.ts` continues to
 * own positions and flight, while #26 will decide which actual game ship picks
 * which one of these explicit visual identities. Nothing here creates actors,
 * changes collision volume, or supplies a fallback hull for an unknown roster
 * entry.
 *
 * Local -Z is the nose and +Z is the exhaust end. All dimensions are kilometres
 * because the player hull lives directly in the near scene; this is not a body
 * mesh and never crosses the far/near handoff.
 */

import * as THREE from "three";

export const HULL_IDS = ["courier", "interceptor", "freighter"] as const;
export type HullId = (typeof HULL_IDS)[number];

export interface HullVisual {
	/** A visual role, deliberately not a gameplay class or roster decision. */
	readonly role: "player-baseline" | "fast" | "cargo";
	/** Long-axis, beam, and height bounds in kilometres. */
	readonly lengthKm: number;
	readonly beamKm: number;
	readonly heightKm: number;
	/** Absolute local-coordinate ceiling, asserted by the headless tests. */
	readonly reachKm: number;
}

export const HULL_VISUALS: Record<HullId, HullVisual> = {
	courier: {
		role: "player-baseline",
		lengthKm: 0.034,
		beamKm: 0.024,
		heightKm: 0.012,
		reachKm: 0.025,
	},
	interceptor: {
		role: "fast",
		lengthKm: 0.03,
		beamKm: 0.032,
		heightKm: 0.007,
		reachKm: 0.026,
	},
	freighter: {
		role: "cargo",
		lengthKm: 0.044,
		beamKm: 0.028,
		heightKm: 0.018,
		reachKm: 0.025,
	},
};

export interface ShipMesh {
	root: THREE.Group;
}

const hullMaterial = (color: number) =>
	new THREE.MeshStandardMaterial({
		color,
		roughness: 0.42,
		metalness: 0.72,
	});

const trimMaterial = new THREE.MeshStandardMaterial({
	color: 0x182a34,
	roughness: 0.34,
	metalness: 0.86,
});

const exhaustMaterial = new THREE.MeshStandardMaterial({
	color: 0x142436,
	emissive: 0x58b9ff,
	emissiveIntensity: 2.4,
	roughness: 0.28,
	metalness: 0.35,
});

function add(
	root: THREE.Group,
	name: string,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	position: [number, number, number] = [0, 0, 0],
	rotation: [number, number, number] = [0, 0, 0],
) {
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = name;
	mesh.position.set(...position);
	mesh.rotation.set(...rotation);
	root.add(mesh);
	return mesh;
}

function buildCourier(root: THREE.Group) {
	const hull = hullMaterial(0x8fa7b7);
	// A faceted nose reads as a direction cue at range; the wide, low wing says
	// "courier" before the separate engine housings resolve.
	add(
		root,
		"courier-core",
		new THREE.ConeGeometry(0.011, 0.034, 4),
		hull,
		[0, 0, 0],
		[Math.PI / 2, Math.PI / 4, 0],
	);
	add(
		root,
		"courier-wing-port",
		new THREE.BoxGeometry(0.024, 0.002, 0.012),
		trimMaterial,
		[-0.012, -0.001, 0.004],
	);
	add(
		root,
		"courier-wing-starboard",
		new THREE.BoxGeometry(0.024, 0.002, 0.012),
		trimMaterial,
		[0.012, -0.001, 0.004],
	);
	for (const [side, x] of [
		["port", -0.006],
		["starboard", 0.006],
	] as const)
		add(
			root,
			`courier-exhaust-${side}`,
			new THREE.CylinderGeometry(0.0026, 0.0026, 0.002, 8),
			exhaustMaterial,
			[x, 0, 0.016],
			[Math.PI / 2, 0, 0],
		);
}

function buildInterceptor(root: THREE.Group) {
	const hull = hullMaterial(0x9a8fab);
	// Long spear, broad delta plane, and twin hot exhausts distinguish the fast
	// silhouette without assigning it a combat capability.
	add(
		root,
		"interceptor-core",
		new THREE.ConeGeometry(0.008, 0.03, 4),
		hull,
		[0, 0, 0],
		[Math.PI / 2, Math.PI / 4, 0],
	);
	add(
		root,
		"interceptor-delta",
		new THREE.ConeGeometry(0.018, 0.003, 3),
		trimMaterial,
		[0, -0.002, 0.004],
		[Math.PI / 2, Math.PI / 6, 0],
	);
	for (const [side, x] of [
		["port", -0.005],
		["starboard", 0.005],
	] as const)
		add(
			root,
			`interceptor-exhaust-${side}`,
			new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 8),
			exhaustMaterial,
			[x, 0, 0.014],
			[Math.PI / 2, 0, 0],
		);
}

function buildFreighter(root: THREE.Group) {
	const hull = hullMaterial(0x9c927e);
	// A deep central spine and two cargo pods give the broad, slow-looking form
	// its identity without turning a visual archetype into a roster entry.
	add(
		root,
		"freighter-spine",
		new THREE.BoxGeometry(0.012, 0.012, 0.044),
		hull,
	);
	for (const [side, x] of [
		["port", -0.009],
		["starboard", 0.009],
	] as const) {
		add(
			root,
			`freighter-pod-${side}`,
			new THREE.BoxGeometry(0.008, 0.01, 0.024),
			trimMaterial,
			[x, -0.001, 0.003],
		);
		add(
			root,
			`freighter-exhaust-${side}`,
			new THREE.CylinderGeometry(0.0028, 0.0028, 0.002, 8),
			exhaustMaterial,
			[x, 0, 0.022],
			[Math.PI / 2, 0, 0],
		);
	}
}

/** Build a fresh, deterministic display mesh for one explicitly selected hull. */
export function buildShipMesh(id: HullId): ShipMesh {
	const root = new THREE.Group();
	root.name = `hull-${id}`;
	root.userData.hullId = id;
	root.userData.role = HULL_VISUALS[id].role;
	if (id === "courier") buildCourier(root);
	else if (id === "interceptor") buildInterceptor(root);
	else buildFreighter(root);
	return { root };
}
