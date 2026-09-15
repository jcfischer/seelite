/**
 * The pirate relay as a drawn thing (node #43): a mast, a dish, two panels
 * and a lamp, authored in **kilometres** like a hull (`hullLoft` writes UVs in
 * km, and the raider's mesh is placed in the same near-layer frame), so a
 * ship-length figure here draws a ship-length object and not a 270 m blob.
 *
 * Its look follows the slot's objective condition: operational is lit and
 * upright; destroyed and repairing are dark, with the dish knocked over. That
 * is #41's "the relay remains visibly changed" — the wreck is drawn until the
 * replacement completes, and the replacement is a fresh, lit relay.
 *
 * Standard materials, so `scene.environment` lights it as it does a hull.
 */
import * as THREE from "three";
import type { OperationalCondition } from "./world-state";

/** Mast height, km: 80 m. The hit sphere in `pirate-relay.ts` is sized to
 *  this and the dish together. */
export const RELAY_MAST_KM = 0.08;
export const RELAY_DISH_KM = 0.03;

const PLATING = 0x8a8f99;
const WRECK = 0x2f2a28;
const LAMP = 0xff3a2a;

export interface RelayMesh {
	root: THREE.Group;
	setCondition(condition: OperationalCondition): void;
}

export function buildRelayMesh(): RelayMesh {
	const root = new THREE.Group();
	root.name = "pirate-relay";
	const plating = new THREE.MeshStandardMaterial({
		color: PLATING,
		roughness: 0.6,
		metalness: 0.7,
	});
	const panel = new THREE.MeshStandardMaterial({
		color: 0x1c2a4a,
		roughness: 0.35,
		metalness: 0.4,
	});
	const lamp = new THREE.MeshStandardMaterial({
		color: 0x220000,
		emissive: LAMP,
		emissiveIntensity: 4,
	});

	const mast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.003, 0.004, RELAY_MAST_KM, 8),
		plating,
	);
	mast.name = "relay-mast";
	mast.position.y = RELAY_MAST_KM / 2;
	root.add(mast);

	const dish = new THREE.Group();
	dish.name = "relay-dish";
	dish.position.y = RELAY_MAST_KM;
	const cap = new THREE.Mesh(
		new THREE.SphereGeometry(RELAY_DISH_KM, 20, 10, 0, Math.PI * 2, 0, 0.9),
		new THREE.MeshStandardMaterial({
			color: PLATING,
			roughness: 0.5,
			metalness: 0.6,
			side: THREE.DoubleSide,
		}),
	);
	cap.position.y = -RELAY_DISH_KM * 0.6;
	dish.add(cap);
	const feed = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0015, 0.0015, RELAY_DISH_KM * 0.9, 6),
		plating,
	);
	feed.position.y = RELAY_DISH_KM * 0.1;
	dish.add(feed);
	root.add(dish);

	for (const side of [-1, 1]) {
		const wing = new THREE.Mesh(
			new THREE.BoxGeometry(0.05, 0.018, 0.0015),
			panel,
		);
		wing.name = side < 0 ? "relay-panel-port" : "relay-panel-starboard";
		wing.position.set(side * 0.035, RELAY_MAST_KM * 0.45, 0);
		root.add(wing);
	}

	const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), lamp);
	beacon.name = "relay-lamp";
	beacon.position.y = RELAY_MAST_KM + RELAY_DISH_KM * 0.5;
	root.add(beacon);

	const setCondition = (condition: OperationalCondition) => {
		const up = condition === "operational";
		plating.color.setHex(up ? PLATING : WRECK);
		(cap.material as THREE.MeshStandardMaterial).color.setHex(
			up ? PLATING : WRECK,
		);
		lamp.emissiveIntensity = up ? 4 : 0;
		dish.rotation.z = up ? 0 : 1.1;
		dish.position.y = up ? RELAY_MAST_KM : RELAY_MAST_KM * 0.7;
		root.userData.condition = condition;
	};
	setCondition("operational");
	return { root, setCondition };
}
