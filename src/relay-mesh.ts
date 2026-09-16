/**
 * The pirate relay as a drawn thing (node #43): a truss mast carrying a main
 * dish, a smaller feeder dish, an antenna array and two panel wings, authored
 * in **kilometres** like a hull (`hullLoft` writes UVs in km, and the raider's
 * mesh is placed in the same near-layer frame), so a ship-length figure here
 * draws a ship-length object and not a 270 m blob.
 *
 * **Every dimension is `pirate-relay.ts`'s.** The sim owns the shape and the
 * hit sphere; this module reads the figures and authors none outside them, the
 * way `station-interior-mesh.ts` draws `station-interior.ts`'s catalogue. The
 * form is built with its **midpoint at the root**, so the position the sim
 * places it at is the hit sphere's centre; `tests/relay-mesh.test.ts` builds it
 * and holds its box inside `RELAY_HIT_RADIUS_KM`.
 *
 * The first form was a single cylinder, a cap and two boxes; the principal
 * flew to it and read it as "ok, but needs more detail". This one is a
 * three-chord lattice with rungs, a hub and equipment boxes, a stayed dish,
 * whip antennas and framed panels — detail on the silhouette, where a
 * 100 m object at a few kilometres actually shows it.
 *
 * Its look follows the slot's objective condition: operational is lit and
 * upright; destroyed and repairing are dark, with the dish knocked over and a
 * panel torn. That is #41's "the relay remains visibly changed" — the wreck is
 * drawn until the replacement completes, and the replacement is a fresh, lit
 * relay.
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
const DARK_PLATING = 0x4a4f58;
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
	const dark = new THREE.MeshStandardMaterial({
		color: DARK_PLATING,
		roughness: 0.75,
		metalness: 0.6,
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
	const tinted = [plating, dark];

	// --- The mast: three chords on a triangle, rungs every 8 m, a hub at the
	// foot and one at the top. A lattice reads as structure where a cylinder
	// reads as a pipe.
	const chordR = 0.0012;
	const triR = 0.006;
	const chordGeom = new THREE.CylinderGeometry(
		chordR,
		chordR,
		RELAY_MAST_KM,
		6,
	);
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2;
		const chord = new THREE.Mesh(chordGeom, plating);
		chord.name = `relay-chord-${i}`;
		chord.position.set(
			Math.cos(a) * triR,
			RELAY_MAST_KM / 2,
			Math.sin(a) * triR,
		);
		form.add(chord);
	}
	const rungGeom = new THREE.CylinderGeometry(0.0007, 0.0007, triR * 1.73, 4);
	const rungs = Math.floor(RELAY_MAST_KM / 0.008);
	for (let k = 1; k < rungs; k++) {
		const y = k * 0.008;
		for (let i = 0; i < 3; i++) {
			const a0 = (i / 3) * Math.PI * 2;
			const a1 = ((i + 1) / 3) * Math.PI * 2;
			const rung = new THREE.Mesh(rungGeom, dark);
			rung.position.set(
				((Math.cos(a0) + Math.cos(a1)) / 2) * triR,
				y,
				((Math.sin(a0) + Math.sin(a1)) / 2) * triR,
			);
			// Lie along the chord-to-chord edge.
			rung.rotation.set(Math.PI / 2, 0, -(a0 + a1) / 2 + Math.PI / 2);
			form.add(rung);
		}
	}
	const footHub = new THREE.Mesh(
		new THREE.CylinderGeometry(triR * 1.6, triR * 1.9, 0.006, 6),
		dark,
	);
	footHub.name = "relay-foot";
	footHub.position.y = 0.003;
	form.add(footHub);
	const topHub = new THREE.Mesh(
		new THREE.CylinderGeometry(triR * 1.4, triR * 1.4, 0.005, 6),
		plating,
	);
	topHub.name = "relay-top-hub";
	topHub.position.y = RELAY_MAST_KM - 0.0025;
	form.add(topHub);

	// --- Equipment boxes clamped to the mast at two heights, on different
	// faces, and a fuel or coolant tank on a third.
	const boxGeom = new THREE.BoxGeometry(0.009, 0.007, 0.006);
	for (const [y, a] of [
		[0.02, 0.4],
		[0.046, 2.6],
	] as const) {
		const box = new THREE.Mesh(boxGeom, dark);
		box.name = "relay-equipment";
		box.position.set(
			Math.cos(a) * (triR + 0.005),
			y,
			Math.sin(a) * (triR + 0.005),
		);
		box.rotation.y = -a;
		form.add(box);
	}
	const tank = new THREE.Mesh(
		new THREE.CapsuleGeometry(0.0035, 0.012, 4, 8),
		plating,
	);
	tank.name = "relay-tank";
	tank.position.set(
		Math.cos(4.6) * (triR + 0.006),
		0.062,
		Math.sin(4.6) * (triR + 0.006),
	);
	form.add(tank);

	// --- The main dish on top: a cap with a rim ring, a feed on three stays,
	// and a pivot yoke so it can be knocked over.
	const dish = new THREE.Group();
	dish.name = "relay-dish";
	dish.position.y = RELAY_MAST_KM;
	const yoke = new THREE.Mesh(
		new THREE.CylinderGeometry(0.002, 0.002, 0.012, 6),
		dark,
	);
	yoke.rotation.z = Math.PI / 2;
	yoke.position.y = 0.004;
	dish.add(yoke);
	const cap = new THREE.Mesh(
		new THREE.SphereGeometry(RELAY_DISH_KM, 24, 12, 0, Math.PI * 2, 0, 0.9),
		new THREE.MeshStandardMaterial({
			color: PLATING,
			roughness: 0.5,
			metalness: 0.6,
			side: THREE.DoubleSide,
		}),
	);
	cap.name = "relay-dish-cap";
	cap.position.y = -RELAY_DISH_KM * 0.6;
	dish.add(cap);
	const rimR = RELAY_DISH_KM * Math.sin(0.9);
	const rim = new THREE.Mesh(
		new THREE.TorusGeometry(rimR, 0.0008, 6, 32),
		dark,
	);
	rim.rotation.x = Math.PI / 2;
	rim.position.y = -RELAY_DISH_KM * 0.6 + RELAY_DISH_KM * Math.cos(0.9);
	dish.add(rim);
	const feed = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0015, 0.0025, 0.006, 6),
		plating,
	);
	feed.position.y = RELAY_DISH_KM * 0.12;
	dish.add(feed);
	const stayGeom = new THREE.CylinderGeometry(
		0.0004,
		0.0004,
		RELAY_DISH_KM * 0.7,
		3,
	);
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2 + 0.5;
		const stay = new THREE.Mesh(stayGeom, dark);
		stay.position.set(
			(Math.cos(a) * rimR) / 2,
			RELAY_DISH_KM * 0.12 - 0.01,
			(Math.sin(a) * rimR) / 2,
		);
		stay.lookAt(0, RELAY_DISH_KM * 0.12, 0);
		stay.rotateX(Math.PI / 2);
		dish.add(stay);
	}
	form.add(dish);

	// --- A smaller feeder dish part-way up, aimed sideways: the relay talks
	// to the raiders as well as listening.
	const small = new THREE.Group();
	small.name = "relay-feeder";
	small.position.set(-(triR + 0.004), 0.034, 0);
	const smallCap = new THREE.Mesh(
		new THREE.SphereGeometry(
			RELAY_DISH_KM * 0.4,
			16,
			8,
			0,
			Math.PI * 2,
			0,
			0.9,
		),
		plating,
	);
	smallCap.rotation.z = Math.PI / 2 + 0.4;
	small.add(smallCap);
	const smallArm = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0012, 0.0012, 0.008, 5),
		dark,
	);
	smallArm.rotation.z = Math.PI / 2;
	smallArm.position.x = 0.004;
	small.add(smallArm);
	form.add(small);

	// --- Whip antennas off the top hub, three lengths.
	const whipGeom = (h: number) =>
		new THREE.CylinderGeometry(0.0003, 0.0005, h, 3);
	for (const [a, h] of [
		[0.9, 0.012],
		[2.3, 0.009],
		[4.0, 0.015],
	] as const) {
		const whip = new THREE.Mesh(whipGeom(h), dark);
		whip.position.set(
			Math.cos(a) * triR * 1.3,
			RELAY_MAST_KM - 0.002 + h / 2,
			Math.sin(a) * triR * 1.3,
		);
		whip.rotation.z = Math.cos(a) * 0.25;
		whip.rotation.x = -Math.sin(a) * 0.25;
		form.add(whip);
	}

	// --- Panel wings: a boom from the mast, a frame, and cells in the frame.
	const panelWidth = RELAY_PANEL_REACH_KM - triR - 0.006;
	const panelH = 0.02;
	const wings: THREE.Mesh[] = [];
	for (const side of [-1, 1]) {
		const wing = new THREE.Group();
		wing.name = side < 0 ? "relay-panel-port" : "relay-panel-starboard";
		const boom = new THREE.Mesh(
			new THREE.CylinderGeometry(0.0012, 0.0012, 0.006, 5),
			dark,
		);
		boom.rotation.z = Math.PI / 2;
		boom.position.set(side * (triR + 0.003), 0, 0);
		wing.add(boom);
		const cells = new THREE.Mesh(
			new THREE.BoxGeometry(panelWidth, panelH, 0.0012),
			panel,
		);
		cells.position.set(side * (triR + 0.006 + panelWidth / 2), 0, 0);
		wing.add(cells);
		wings.push(cells);
		const frameGeom = new THREE.BoxGeometry(panelWidth + 0.002, 0.0015, 0.002);
		for (const dy of [-panelH / 2, panelH / 2]) {
			const rail = new THREE.Mesh(frameGeom, plating);
			rail.position.set(side * (triR + 0.006 + panelWidth / 2), dy, 0);
			wing.add(rail);
		}
		// Cell seams: thin dark strips across the panel.
		const seamGeom = new THREE.BoxGeometry(0.0006, panelH, 0.0014);
		for (let k = 1; k < 5; k++) {
			const seam = new THREE.Mesh(seamGeom, dark);
			seam.position.set(side * (triR + 0.006 + (panelWidth * k) / 5), 0, 0);
			wing.add(seam);
		}
		wing.position.y = RELAY_MAST_KM * 0.45;
		form.add(wing);
	}

	// --- The beacon on the dish's rim, and a second, dimmer lamp on the foot.
	const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), lamp);
	beacon.name = "relay-lamp";
	beacon.position.y = RELAY_MAST_KM + RELAY_DISH_KM * 0.5;
	form.add(beacon);
	const footLamp = new THREE.Mesh(new THREE.SphereGeometry(0.002, 8, 6), lamp);
	footLamp.name = "relay-foot-lamp";
	footLamp.position.set(triR * 1.9, 0.004, 0);
	form.add(footLamp);

	const setCondition = (condition: OperationalCondition) => {
		const up = condition === "operational";
		for (const m of tinted)
			m.color.setHex(up ? (m === dark ? DARK_PLATING : PLATING) : WRECK);
		(cap.material as THREE.MeshStandardMaterial).color.setHex(
			up ? PLATING : WRECK,
		);
		lamp.emissiveIntensity = up ? 4 : 0;
		dish.rotation.z = up ? 0 : 1.1;
		dish.position.y = up ? RELAY_MAST_KM : RELAY_MAST_KM * 0.7;
		// One wing torn: hanging down, half its reach.
		const torn = wings[1];
		torn.rotation.x = up ? 0 : 1.3;
		torn.scale.x = up ? 1 : 0.55;
		root.userData.condition = condition;
	};
	setCondition("operational");
	return { root, setCondition };
}
