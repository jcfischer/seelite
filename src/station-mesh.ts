/**
 * The three silhouettes (`station-types.md` §7), built procedurally at load.
 *
 * §7's standard is the one this module is written against: **a player tells the
 * three apart by outline, before colour and before any detail resolves.** So the
 * shapes differ in gross form — an octahedron, an octahedron with a long frame
 * clamped alongside, and a squat drum in a lump of rock — rather than in
 * panelling or in emissive trim, which resolve at medium range and vanish at
 * scanner range. `STATION_COLORS` (`sim.ts`) stays the secondary cue.
 *
 * **Everything is authored in kilometres**, read from `STATION_GEOMETRY` — a
 * slot drawn at a size the docking checks do not use is invisible to every
 * headless test, so the aperture comes from the table rather than from what
 * looks right.
 *
 * The root is then divided by the core radius, so that the object it hands back
 * is **one core radius across**, exactly like the unit sphere every other body
 * is drawn with. That keeps the renderer's rule single: `mesh.scale =
 * radiusKm × layerFactor`, for every body regardless of kind. The alternative —
 * handing back kilometres and teaching the renderer a second scaling rule for
 * stations — also breaks `probe-handoff.mjs`, which measures the handoff by
 * comparing `drawnRadius / radiusKm` against the layer's factor. One rule keeps
 * that probe true; two would have made it read a station as a scale error.
 *
 * **The spinner is separated from the root** because the shipyard's drydock
 * frame does not rotate (§7). Callers rotate `spinner` by the phase sim gives
 * them and leave `root` to the aperture axis; a station that rotated whole would
 * make the frame a fairground ride.
 *
 * No downloaded assets, per the map constraint. Two features are randomised —
 * the asteroid's vertices and the window grid — and both are seeded from the
 * station **type**, not from an id: `buildStationMesh` takes a type, so every
 * trade station in the galaxy is drawn identically. That is a display decision
 * and not a generator one; per-station variation would need an id passed in and
 * would buy nothing §7 rests identity on.
 */

import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "./station";

/** What the renderer gets back: a root oriented to the aperture axis, and the
 *  part of it that spins. */
export interface StationMesh {
	/** Local **+Z is the aperture axis**, and the object is one core radius
	 *  across — the caller aims this and scales it by `radiusKm × layerFactor`,
	 *  the same way it scales the unit sphere. */
	root: THREE.Group;
	/** Rotated about local Z by the phase from `stationPose`. For the refinery
	 *  this is an empty group: the pad does not turn. */
	spinner: THREE.Object3D;
}

/**
 * A small deterministic generator for the asteroid's vertices.
 *
 * Its own, rather than one of `rng.ts`'s domain streams, and the difference is
 * the point: this feeds a *shape on screen* and nothing in the simulation, so
 * drawing it from a world stream would couple a display detail to the
 * generator's draw counts. The key is a constant string per feature, so the
 * shape is the same on every load and in every system.
 */
function displayRand(id: string): () => number {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	let state = h >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

const hullMaterial = (color: number) =>
	new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.35 });

const emissiveMaterial = (color: number, intensity: number) =>
	new THREE.MeshStandardMaterial({
		color: 0x101014,
		emissive: color,
		emissiveIntensity: intensity,
		roughness: 0.4,
	});

/**
 * The small repeated parts, built once at module load and shared by every
 * station in the game.
 *
 * A window pane is one box and one emissive material, and there are 28 of them
 * per Coriolis station — built inside the loop, that is 28 geometries and 28
 * materials *per station instance*, each its own draw call with its own uniform
 * upload every frame. Three.js batches by (geometry, material) identity, so
 * sharing them is the difference between one draw call per station's windows
 * and twenty-eight.
 *
 * Shared, so **never mutated after construction** — a caller that recoloured a
 * pane would recolour every window in the galaxy.
 */
const PANE_GEOMETRY = new THREE.BoxGeometry(0.03, 0.012, 0.004);
const PANE_MATERIAL = emissiveMaterial(0xdfe8ff, 1.4);
const APERTURE_LIGHT_MATERIAL = emissiveMaterial(0xffb347, 2.2);
const FLOOD_MATERIAL = emissiveMaterial(0xbfe4ff, 2.0);

/**
 * The aperture, drawn as a lit recess on the +Z face.
 *
 * A dark box sunk into the hull with an emissive frame around its mouth, so the
 * thing you have to fly through is the brightest feature on the station at the
 * range where you are lining up on it. Sized entirely from the table.
 *
 * The mouth sits a hair *proud* of the surface it is cut into: coplanar faces
 * z-fight, and the symptom is a slot that flickers in and out of existence as
 * the station rotates, which reads as the aperture not being there at all.
 */
function buildAperture(type: StationType, faceZ: number): THREE.Group {
	const { aperture } = STATION_GEOMETRY[type];
	const group = new THREE.Group();
	const w = aperture.widthKm;
	const h = aperture.heightKm;
	const depth = Math.min(w, h) * 0.8;

	const mouth = new THREE.Mesh(
		new THREE.BoxGeometry(w, h, depth),
		new THREE.MeshBasicMaterial({ color: 0x05070a }),
	);
	mouth.position.z = faceZ - depth / 2;
	mouth.name = "aperture-mouth";
	group.add(mouth);

	// Four bars around the mouth rather than a ring: the slot is a rectangle, and
	// its long axis is what the roll match is matched *to*.
	const bar = 0.012;
	const lights: [number, number, number, number][] = [
		[w + bar * 2, bar, 0, (h + bar) / 2],
		[w + bar * 2, bar, 0, -(h + bar) / 2],
		[bar, h, (w + bar) / 2, 0],
		[bar, h, -(w + bar) / 2, 0],
	];
	for (const [bw, bh, x, y] of lights) {
		const light = new THREE.Mesh(
			new THREE.BoxGeometry(bw, bh, bar),
			APERTURE_LIGHT_MATERIAL,
		);
		light.position.set(x, y, faceZ + bar / 2);
		group.add(light);
	}
	group.name = "aperture";
	return group;
}

/** The Coriolis body: an octahedron whose ±Z vertices are the spin axis, so the
 *  slot sits on the axis and rotates in place (`docking.md` §4.2) rather than
 *  sweeping a circle the ship would have to intercept. */
function buildCoriolisCore(type: StationType): THREE.Group {
	const { coreRadiusKm } = STATION_GEOMETRY[type];
	const group = new THREE.Group();

	const hull = new THREE.Mesh(
		new THREE.OctahedronGeometry(coreRadiusKm, 0),
		hullMaterial(0x8d97a5),
	);
	hull.name = "core";
	group.add(hull);

	// The slot face is the +Z vertex; flattening it gives the aperture somewhere
	// to sit that is not a point. A short cylinder does that without touching the
	// octahedron's outline, which is what the silhouette rests on.
	const flat = coreRadiusKm * 0.34;
	const collar = new THREE.Mesh(
		new THREE.CylinderGeometry(flat, flat * 1.25, coreRadiusKm * 0.22, 4),
		hullMaterial(0x79838f),
	);
	collar.rotation.x = Math.PI / 2;
	collar.rotation.y = Math.PI / 4;
	collar.position.z = coreRadiusKm * 0.72;
	group.add(collar);

	group.add(buildAperture(type, coreRadiusKm * 0.83));

	// Window grids: detail, explicitly not identity. They resolve at medium range
	// and are gone at scanner range, which is why §7 rests the identity on the
	// outline instead.
	const rand = displayRand(`${type}-windows`);
	const windows = new THREE.Group();
	for (let i = 0; i < 28; i++) {
		const pane = new THREE.Mesh(PANE_GEOMETRY, PANE_MATERIAL);
		const theta = rand() * Math.PI * 2;
		const band = (rand() - 0.5) * coreRadiusKm * 0.7;
		const r = coreRadiusKm * 0.62 * (1 - Math.abs(band) / coreRadiusKm);
		pane.position.set(Math.cos(theta) * r, Math.sin(theta) * r, band);
		pane.lookAt(0, 0, band);
		windows.add(pane);
	}
	group.add(windows);
	return group;
}

/**
 * The shipyard's drydock frame: an open cage clamped alongside the core,
 * reaching `silhouetteRadiusKm` (`docking.md` §5 — silhouette, not dockable).
 *
 * Long, open and off-centre, because those are the three things that survive
 * being reduced to an outline: the shipyard reads as a different *object* at the
 * range where the trade station is still a lit dot.
 */
function buildDrydock(): THREE.Group {
	const group = new THREE.Group();
	// Sized to fit inside the declared reach rather than by eye: the frame's far
	// end sits at `offset + length/2`, and its rings stick out sideways, so the
	// farthest vertex is the hypotenuse of the two. The first version put that at
	// 2.0 km against a declared 1.5 — a silhouette budget nothing measured, which
	// `tests/station-mesh.test.ts` now does.
	const reach = STATION_GEOMETRY.shipyard.silhouetteRadiusKm;
	const length = reach * 0.96;
	const half = 0.28;
	const strut = 0.035;
	const material = hullMaterial(0x6f7d88);

	for (const [x, y] of [
		[half, half],
		[half, -half],
		[-half, half],
		[-half, -half],
	]) {
		const beam = new THREE.Mesh(
			new THREE.BoxGeometry(strut, strut, length),
			material,
		);
		beam.position.set(x, y, 0);
		group.add(beam);
	}
	for (const z of [-length / 2, -length / 6, length / 6, length / 2]) {
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(half * 1.35, strut * 0.8, 4, 4),
			material,
		);
		ring.rotation.z = Math.PI / 4;
		ring.position.z = z;
		group.add(ring);
	}
	// Cold floodlit bays (§7), on the frame rather than on the core so the two
	// halves of the shipyard read differently lit as well as differently shaped.
	for (const z of [-length / 3, 0, length / 3]) {
		const flood = new THREE.Mesh(
			new THREE.BoxGeometry(half * 1.6, 0.02, 0.05),
			FLOOD_MATERIAL,
		);
		flood.position.set(0, -half, z);
		group.add(flood);
	}

	// Clamped alongside and offset, not concentric: a frame centred on the core
	// would read as a bigger trade station rather than as a second object.
	group.position.set(reach * 0.42, 0, 0);
	group.rotation.y = Math.PI / 2;
	group.name = "drydock";
	return group;
}

/** The refinery: a squat drum sunk into a captured asteroid, with flare stacks
 *  (`station-types.md` §7). Nothing here rotates. */
function buildRefinery(): THREE.Group {
	const geometry = STATION_GEOMETRY.refinery;
	const group = new THREE.Group();
	const r = geometry.coreRadiusKm;

	// The asteroid: an icosahedron with its vertices pushed about, which is the
	// cheapest shape that is unmistakably not a machined hull in outline.
	const rock = new THREE.IcosahedronGeometry(r * 1.15, 1);
	const rand = displayRand("station-refinery-rock");
	const pos = rock.getAttribute("position");
	for (let i = 0; i < pos.count; i++) {
		const f = 0.7 + rand() * 0.55;
		pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f * 0.8);
	}
	rock.computeVertexNormals();
	// Rougher and less metallic than a hull, and lighter than rock looks in a
	// swatch: the near layer's only fill is a dim camera-side light, and a
	// physically plausible dark asteroid renders as a hole in the starfield with
	// two flares hanging over it. Read off a frame, not chosen from a palette.
	const asteroid = new THREE.Mesh(
		rock,
		new THREE.MeshStandardMaterial({
			color: 0x9a8a72,
			roughness: 0.95,
			metalness: 0.02,
		}),
	);
	asteroid.name = "asteroid";
	group.add(asteroid);

	// The drum, sunk in: only its lit face and the pad on it clear the rock.
	const drum = new THREE.Mesh(
		new THREE.CylinderGeometry(r * 0.62, r * 0.62, r * 0.9, 16),
		hullMaterial(0xa8895f),
	);
	drum.rotation.x = Math.PI / 2;
	drum.position.z = r * 0.45;
	drum.name = "drum";
	group.add(drum);

	group.add(buildAperture("refinery", r * 0.9));

	// Flare stacks: thin, long, and off the drum's axis, so the outline has
	// something spindly on it that neither Coriolis type has.
	for (const [x, y, tilt] of [
		[r * 0.75, r * 0.3, 0.35],
		[-r * 0.6, r * 0.65, -0.5],
	]) {
		const stack = new THREE.Group();
		const tube = new THREE.Mesh(
			new THREE.CylinderGeometry(r * 0.07, r * 0.1, r * 1.3, 8),
			hullMaterial(0x8a7a66),
		);
		tube.position.y = (r * 1.3) / 2;
		stack.add(tube);
		const flame = new THREE.Mesh(
			new THREE.ConeGeometry(r * 0.09, r * 0.35, 8),
			emissiveMaterial(0xff7a2a, 3.0),
		);
		flame.position.y = r * 1.3 + r * 0.15;
		stack.add(flame);
		stack.position.set(x, y, r * 0.2);
		stack.rotation.z = tilt;
		group.add(stack);
	}
	return group;
}

/**
 * Build one station's mesh, in kilometres, with +Z along its aperture axis.
 *
 * Keyed on a `Record<StationType, …>` for `station-types.md` §8.5's reason: a
 * fourth station type must stop the build until this file answers for it, and a
 * `switch` with a default would silently give it a trade station's outline —
 * which is precisely the identity §7 rests on.
 */
const BUILDERS: Record<StationType, () => StationMesh> = {
	trade: () => {
		const spinner = buildCoriolisCore("trade");
		return { root: normalise("trade", [spinner]), spinner };
	},
	shipyard: () => {
		const spinner = buildCoriolisCore("shipyard");
		// The frame is a sibling of the spinner, not a child: §7's drydock is
		// explicitly non-rotating, and a station that turned whole would make it a
		// fairground ride.
		return { root: normalise("shipyard", [spinner, buildDrydock()]), spinner };
	},
	refinery: () => {
		// An empty spinner rather than `null`: the caller writes a phase of 0 into
		// it every frame, and a null case in the render loop is a branch that
		// exists only to be forgotten.
		const spinner = new THREE.Group();
		return {
			root: normalise("refinery", [buildRefinery(), spinner]),
			spinner,
		};
	},
};

/**
 * Wrap the kilometre-authored parts and divide by the core radius, so the
 * object handed back is one core radius across.
 *
 * The division lives on an inner group rather than on the root, because the
 * renderer overwrites the root's scale every frame — putting it there would
 * work until the first layer change and then draw the station at kilometres
 * times the layer factor, which at `FAR_SCALE` is a station too small to have
 * any pixels and reads as one that failed to generate.
 */
function normalise(type: StationType, parts: THREE.Object3D[]): THREE.Group {
	const root = new THREE.Group();
	const inner = new THREE.Group();
	inner.scale.setScalar(1 / STATION_GEOMETRY[type].coreRadiusKm);
	inner.name = "km";
	for (const part of parts) inner.add(part);
	root.add(inner);
	return root;
}

export function buildStationMesh(type: StationType): StationMesh {
	return BUILDERS[type]();
}
