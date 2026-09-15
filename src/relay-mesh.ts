/**
 * The pirate relay as a drawn thing (node #43): a mast, a dish, two panels
 * and a lamp, authored in **kilometres** like a hull (`hullLoft` writes UVs in
 * km, and the raider's mesh is placed in the same near-layer frame), so a
 * ship-length figure here draws a ship-length object and not a 270 m blob.
 *
 * **Every dimension is `pirate-relay.ts`'s.** The sim owns the shape and the
 * hit sphere; this module reads the figures and authors none, the way
 * `station-interior-mesh.ts` draws `station-interior.ts`'s catalogue. The form
 * is built with its **midpoint at the root**, so the position the sim places
 * it at is the hit sphere's centre; `tests/relay-mesh.test.ts` builds it and
 * holds its box inside `RELAY_HIT_RADIUS_KM`.
 *
 * Its look follows the slot's objective condition: operational is lit and
 * upright; destroyed and repairing are dark, with the dish knocked over. That
 * is #41's "the relay remains visibly changed" — the wreck is drawn until the
 * replacement completes, and the replacement is a fresh, lit relay.
 *
 * Standard materials, so `scene.environment` lights it as it does a hull.
 */
import * as THREE from "three";
import {
	RELAY_DISH_KM,
	RELAY_HEIGHT_KM,
	RELAY_MAST_KM,
	RELAY_PANEL_REACH_KM,
} from "./pirate-relay";
import type { OperationalCondition } from "./world-state";

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
	// The form, foot at y = 0, lifted so its midpoint sits on the root.
	const form = new THREE.Group();
	form.name = "relay-form";
	form.position.y = -RELAY_HEIGHT_KM / 2;
	root.add(form);

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
	form.add(mast);

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
	form.add(dish);

	// Each panel spans from the mast out to the declared reach.
	const panelWidth = RELAY_PANEL_REACH_KM - 0.01;
	for (const side of [-1, 1]) {
		const wing = new THREE.Mesh(
			new THREE.BoxGeometry(panelWidth, 0.018, 0.0015),
			panel,
		);
		wing.name = side < 0 ? "relay-panel-port" : "relay-panel-starboard";
		wing.position.set(side * (0.01 + panelWidth / 2), RELAY_MAST_KM * 0.45, 0);
		form.add(wing);
	}

	const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), lamp);
	beacon.name = "relay-lamp";
	beacon.position.y = RELAY_MAST_KM + RELAY_DISH_KM * 0.5;
	form.add(beacon);

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
