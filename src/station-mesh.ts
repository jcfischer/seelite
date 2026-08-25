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
 * **Colour is the secondary cue and this module applies it** (§7). The hull
 * material is painted from the colour the caller passes — `sim.ts`'s
 * `STATION_COLORS[type]`, reached as `body.color` — so a trade station and a
 * shipyard, which share a Coriolis outline at long range, still differ at the
 * range where colour resolves. Building both from one literal is what the first
 * version of this file did, and it removed a per-type cue that two docstrings
 * went on claiming was live.
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
import {
	PLATE_TEXTURE_SIZE,
	STATION_VISUALS,
	type StationDetailLevel,
	beaconIntensity,
	flickerIntensity,
	platingTexels,
	stationDetailLevel,
	surfaceTexels,
} from "./station-visuals";

/**
 * How far the *drawn* object reaches, kilometres — the drydock frame, the
 * captured asteroid, the flare stacks.
 *
 * Here rather than in `STATION_GEOMETRY`, and that is the point: `docking.md`
 * §5 says the frame is silhouette and not dockable geometry, and #9's checks
 * read the geometry record. An invariant enforced by a comment inside the
 * struct it forbids is one edit from being false; a separate table that docking
 * never imports cannot be read by accident.
 *
 * A **budget, not a description**: `tests/station-mesh.test.ts` asserts no
 * vertex of a built station lies outside it, so a frame or a flare stack cannot
 * quietly grow.
 *
 * The two rows are not the same kind of number, and it is worth being plain
 * about it. The shipyard's 1.5 km is `docking.md` §5's own figure, so its test
 * can fail against the spec and did — the frame reached 2.0 km and was resized.
 * The refinery's 0.9 is a **ratchet**: there is no spec figure for it, so it was
 * set from what the mesh measures (0.837 km) plus a little headroom, and on the
 * day it was written it could not have failed. It catches growth from here, and
 * nothing else. Reading it as a design constraint would be reading a
 * measurement as an intention.
 */
export const STATION_SILHOUETTE_KM: Record<StationType, number> = {
	trade: 0.6,
	shipyard: 1.5,
	refinery: 0.9,
};

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
	/** Which type built it, so `updateStationVisuals` can reach the profile and
	 *  the silhouette budget without the caller carrying either. */
	type: StationType;
	/** The detail level currently drawn. Held on the handle rather than
	 *  recomputed, because `stationDetailLevel` is directional — the previous
	 *  level is half of its input (`station-visuals.ts` §3). */
	detail: StationDetailLevel;
	/**
	 * The materials the clock drives (`station-visuals.md` §5).
	 *
	 * Per station rather than shared per type, even though every station of a
	 * type animates identically: these are the one thing here that is *mutated*
	 * after construction, and the shared parts below are documented as never
	 * being. A shared animated material would work until something wanted one
	 * station lit differently, and would then fail across the whole galaxy.
	 */
	fixtures: StationFixture[];
}

/** One clock-driven light. `base` is its lit intensity; the waveform scales it. */
export interface StationFixture {
	material: THREE.MeshStandardMaterial;
	base: number;
	kind: "beacon-port" | "beacon-starboard" | "work" | "flare";
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

/**
 * The generated surface maps, one pair per role, built once at module load.
 *
 * `DataTexture` and not `CanvasTexture`, for `station-visuals.ts`'s reason: this
 * module is imported by the headless tier, which has no `document`. The texels
 * come from arithmetic, so the same code path runs in both tiers and the buffer
 * length is a headless assertion rather than something a player notices.
 *
 * `RGBAFormat` with a `4 × w × h` buffer. A short buffer does not throw — it
 * samples past its end and draws garbage — which is why the length is asserted
 * on the generator rather than trusted here.
 *
 * Shared by every station in the galaxy, and so **never mutated**: the plating
 * carries no per-station information, and `STATION_COLORS` still multiplies
 * through because the albedo map is greyscale.
 */
const surfaceMaps = (type: StationType) => {
	const albedo = new THREE.DataTexture(
		platingTexels(type),
		PLATE_TEXTURE_SIZE,
		PLATE_TEXTURE_SIZE,
		THREE.RGBAFormat,
	);
	const wear = new THREE.DataTexture(
		surfaceTexels(type),
		PLATE_TEXTURE_SIZE,
		PLATE_TEXTURE_SIZE,
		THREE.RGBAFormat,
	);
	for (const map of [albedo, wear]) {
		map.wrapS = THREE.RepeatWrapping;
		map.wrapT = THREE.RepeatWrapping;
		// Plating is a surface language, not a photograph: nearest sampling keeps
		// the seams as seams instead of blurring them into a grey wash at the
		// range where the station is a few hundred pixels across.
		map.magFilter = THREE.NearestFilter;
		map.minFilter = THREE.LinearMipmapLinearFilter;
		map.generateMipmaps = true;
		map.needsUpdate = true;
	}
	return { albedo, wear };
};

const SURFACE_MAPS: Record<StationType, ReturnType<typeof surfaceMaps>> = {
	trade: surfaceMaps("trade"),
	shipyard: surfaceMaps("shipyard"),
	refinery: surfaceMaps("refinery"),
};

/**
 * A painted hull carrying its role's plating.
 *
 * `type` decides the surface and `color` decides the paint — the two cues are
 * deliberately separate, because §7 rests identity on outline with colour as the
 * secondary cue, and a per-role *coloured* map would quietly become a third.
 */
const hullMaterial = (color: number, type: StationType) => {
	const { albedo, wear } = SURFACE_MAPS[type];
	return new THREE.MeshStandardMaterial({
		color,
		map: albedo,
		roughnessMap: wear,
		metalnessMap: wear,
		// Multiplied by the map's green and blue channels, so these are the
		// ceilings rather than the values. Left at 1 the map would be the whole
		// answer and the profile's figures would be decoration.
		roughness: 1,
		metalness: 1,
	});
};

/** An unplated structural part — a strut, a collar, a stack. Small, and lit
 *  from every angle, so a plating map on it is texels nobody resolves. */
const plainMaterial = (color: number, roughness = 0.65, metalness = 0.35) =>
	new THREE.MeshStandardMaterial({ color, roughness, metalness });

const emissiveMaterial = (color: number, intensity: number) =>
	new THREE.MeshStandardMaterial({
		color: 0x101014,
		emissive: color,
		emissiveIntensity: intensity,
		roughness: 0.4,
	});

/**
 * Mark an object as accessory detail, drawn only from `minLevel` inward.
 *
 * The rule it serves is §2's: **a detail level may not change the outline.**
 * Nothing tagged here may be the farthest vertex of its station — the flare
 * flame is the refinery's outermost point and is therefore silhouette rather
 * than detail, and is deliberately not tagged. `tests/station-visuals.test.ts`
 * asserts the reach is identical at all three levels, which is what stops that
 * from being a rule kept by hand.
 */
function detail<T extends THREE.Object3D>(
	object: T,
	minLevel: Exclude<StationDetailLevel, "outline">,
): T {
	object.userData.minDetail = minLevel;
	return object;
}

/**
 * The small repeated parts, built once at module load and shared by every
 * station in the game.
 *
 * A window pane is one box and one emissive material, and there are 28 of them
 * per Coriolis station. Building them inside the loop gave every station its own
 * 28 geometries and 28 materials — that is buffer uploads and material state
 * changes, **not** draw calls: `WebGLRenderer` issues one draw per `Mesh`
 * whatever geometry it holds, so sharing saves GPU memory and state churn and
 * nothing else. The draw calls are dealt with separately, by drawing the panes
 * as a single `InstancedMesh`.
 *
 * Shared, so **never mutated after construction** — a caller that recoloured a
 * pane would recolour every window in the galaxy. The hull materials are the
 * exception and are built per station, because §7's colour cue is per type.
 */
const PANE_COUNT = 28;
const PANE_GEOMETRY = new THREE.BoxGeometry(0.03, 0.012, 0.004);
/**
 * One pane material per role, from the profile's `windowColor` — habitation
 * light is warmer on the refinery than on the two Coriolis hulls.
 *
 * Shared across every station of a role and never mutated. The window grid is
 * the one light on a station that does *not* animate: a flashing window reads as
 * a fault, and §5's motion belongs to the beacons, the arc and the flare.
 */
const PANE_MATERIALS: Record<StationType, THREE.MeshStandardMaterial> = {
	trade: emissiveMaterial(STATION_VISUALS.trade.windowColor, 1.4),
	shipyard: emissiveMaterial(STATION_VISUALS.shipyard.windowColor, 1.4),
	refinery: emissiveMaterial(STATION_VISUALS.refinery.windowColor, 1.2),
};
const APERTURE_LIGHT_MATERIAL = emissiveMaterial(0xffb347, 2.2);
/** The shipyard's cold bay floods. Steady, so shared: what moves on that
 *  station is the welding arc, and it gets its own material per station. */
const FLOOD_MATERIAL = emissiveMaterial(
	STATION_VISUALS.shipyard.floodColor,
	2.0,
);

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
	const bar = 0.012;

	const mouth = new THREE.Mesh(
		new THREE.BoxGeometry(w, h, depth),
		new THREE.MeshBasicMaterial({ color: 0x05070a }),
	);
	// Sunk *and* clear of the face: at `faceZ - depth/2` the mouth's front face is
	// exactly coplanar with the surface it is cut into, which z-fights — a slot
	// that flickers as the station turns, which reads as no slot at all.
	mouth.position.z = faceZ + bar / 2 - depth / 2;
	mouth.name = "aperture-mouth";
	group.add(mouth);

	// Four bars around the mouth rather than a ring: the slot is a rectangle, and
	// its long axis is what the roll match is matched *to*.
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
		// Named so `probe-station-visuals.mjs` can hide the four bars and measure
		// what they contribute, without also hiding the dark mouth they surround —
		// which would change the station's brightness in the other direction and
		// net out to nothing.
		light.name = "aperture-light";
		group.add(light);
	}
	group.name = "aperture";
	return group;
}

/** The Coriolis body: an octahedron whose ±Z vertices are the spin axis, so the
 *  slot sits on the axis and rotates in place (`docking.md` §4.2) rather than
 *  sweeping a circle the ship would have to intercept. */
function buildCoriolisCore(
	type: StationType,
	color: number,
	fixtures: StationFixture[],
): THREE.Group {
	const { coreRadiusKm } = STATION_GEOMETRY[type];
	const group = new THREE.Group();

	// §7's secondary cue, applied: `color` is `STATION_COLORS[type]`, so the
	// trade station and the shipyard — which share this outline at any range
	// where the drydock frame has not resolved — still read apart.
	const hull = new THREE.Mesh(
		new THREE.OctahedronGeometry(coreRadiusKm, 0),
		hullMaterial(color, type),
	);
	hull.name = "core";
	group.add(hull);

	// The slot face is the +Z vertex; flattening it gives the aperture somewhere
	// to sit that is not a point. A short cylinder does that without touching the
	// octahedron's outline, which is what the silhouette rests on.
	const flat = coreRadiusKm * 0.34;
	const collar = new THREE.Mesh(
		new THREE.CylinderGeometry(flat, flat * 1.25, coreRadiusKm * 0.22, 4),
		plainMaterial(0x79838f),
	);
	collar.rotation.x = Math.PI / 2;
	collar.rotation.y = Math.PI / 4;
	collar.position.z = coreRadiusKm * 0.72;
	group.add(collar);

	group.add(buildAperture(type, coreRadiusKm * 0.83));

	// Window grids: detail, explicitly not identity. They resolve at medium range
	// and are gone at scanner range, which is why §7 rests the identity on the
	// outline instead.
	//
	// **On the hull, not inside it.** An octahedron's surface is the plane
	// |x| + |y| + |z| = r, so a pane placed on a circle of radius 0.62r sits tens
	// of metres *behind* an opaque face at every angle — invisible, which the
	// first version was. The radius is solved from the face plane instead, and
	// nudged a hair proud.
	//
	// One `InstancedMesh` rather than 28 `Mesh`es: this is the one place a
	// station's detail multiplies, and each `Mesh` is its own draw call.
	const rand = displayRand(`${type}-windows`);
	const panes = new THREE.InstancedMesh(
		PANE_GEOMETRY,
		PANE_MATERIALS[type],
		PANE_COUNT,
	);
	panes.name = "windows";
	// Detail, and therefore tagged: the grid is gone by the range at which §7's
	// outline is doing the work, and drawing 28 instances of it out there is
	// state churn for pixels nobody has.
	detail(panes, "full");
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const position = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const unitZ = new THREE.Vector3(0, 0, 1);
	const one = new THREE.Vector3(1, 1, 1);
	for (let i = 0; i < PANE_COUNT; i++) {
		// **Kept away from the vertices**, which a uniform angle does not do.
		// `STATION_SILHOUETTE_KM.trade` is 0.6 km and the octahedron's own vertex
		// is at 0.6 km, so the budget is exactly the hull and there is nothing
		// spare (`station-visuals.md` §2.1): a pane drawn near θ = 0 lands at
		// 1.002·r and is outside it. One octant per pane, placed in the middle
		// 70% of it, bounds the worst case at 0.83·r — and spreads the grid over
		// the hull rather than clustering it wherever the stream happened to draw.
		const octant = (i % 4) * (Math.PI / 2);
		const theta = octant + (0.15 + rand() * 0.7) * (Math.PI / 2);
		const band = (rand() - 0.5) * coreRadiusKm * 0.7;
		const cos = Math.cos(theta);
		const sin = Math.sin(theta);
		// |x| + |y| = r − |z| on the face, so ρ(|cos| + |sin|) = r − |band|.
		const rho =
			((coreRadiusKm - Math.abs(band)) / (Math.abs(cos) + Math.abs(sin))) *
			1.002;
		position.set(rho * cos, rho * sin, band);
		// The face normal of the octant the pane landed in — `lookAt(0, 0, band)`
		// aimed it at the axis instead, which is not the surface it lies on.
		normal
			.set(Math.sign(position.x), Math.sign(position.y), Math.sign(band) || 1)
			.normalize();
		quaternion.setFromUnitVectors(unitZ, normal);
		panes.setMatrixAt(i, matrix.compose(position, quaternion, one));
	}
	panes.instanceMatrix.needsUpdate = true;
	group.add(panes);

	// The two navigation beacons (§5), on the spin axis' beam — port red,
	// starboard green, half a period apart so the pair reads as a direction and
	// not as one light. Sunk onto the face plane like the panes and for the same
	// budget reason: there is no room on a Coriolis hull for a mast.
	const beacons: [StationFixture["kind"], number, number][] = [
		["beacon-port", -1, STATION_VISUALS[type].beaconPortColor],
		["beacon-starboard", 1, STATION_VISUALS[type].beaconStarboardColor],
	];
	for (const [kind, side, beaconColor] of beacons) {
		const material = emissiveMaterial(beaconColor, 0);
		const lamp = new THREE.Mesh(
			new THREE.BoxGeometry(
				coreRadiusKm * 0.05,
				coreRadiusKm * 0.05,
				coreRadiusKm * 0.03,
			),
			material,
		);
		// On the face |x| + |y| + |z| = r, and **well inboard of the limb** — not
		// merely inside the vertex. The first placement sat at 0.8·r, which is
		// inside the hull geometrically and still pushed the *rendered* outline
		// 7 px wider at docking range: the bloom pass spreads an emissive halo
		// past the surface it is mounted on, and on the trade station the hull is
		// the whole silhouette. Tilted toward +Z as well, so the pair reads from
		// the aperture axis, which is the one viewpoint every type shares.
		lamp.position.set(side * coreRadiusKm * 0.55, 0, coreRadiusKm * 0.45);
		lamp.name = `beacon-${side < 0 ? "port" : "starboard"}`;
		detail(lamp, "reduced");
		group.add(lamp);
		fixtures.push({ material, base: 2.6, kind });
	}
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
function buildDrydock(fixtures: StationFixture[]): THREE.Group {
	const group = new THREE.Group();
	// Sized to fit inside the declared reach rather than by eye: the frame's far
	// end sits at `offset + length/2`, and its rings stick out sideways, so the
	// farthest vertex is the hypotenuse of the two. The first version put that at
	// 2.0 km against a declared 1.5 — a silhouette budget nothing measured, which
	// `tests/station-mesh.test.ts` now does.
	const reach = STATION_SILHOUETTE_KM.shipyard;
	const length = reach * 0.96;
	const half = 0.28;
	const strut = 0.035;
	const material = plainMaterial(0x6f7d88, 0.78, 0.42);

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
		detail(flood, "reduced");
		group.add(flood);
	}

	// The welding arc (§5): one bay under work, struck and dying at 7 Hz. It is
	// the only motion on the shipyard, which is what makes a *working* yard read
	// differently from a lit one — and it is inside the frame, so switching it
	// off at range cannot touch the 1.429 km reach the frame itself sets.
	const arcMaterial = emissiveMaterial(STATION_VISUALS.shipyard.floodColor, 0);
	const arc = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), arcMaterial);
	arc.position.set(0, -half * 0.45, length / 6);
	arc.name = "weld-arc";
	detail(arc, "reduced");
	group.add(arc);
	fixtures.push({ material: arcMaterial, base: 4.5, kind: "work" });

	// Clamped alongside and offset, not concentric: a frame centred on the core
	// would read as a bigger trade station rather than as a second object.
	group.position.set(reach * 0.42, 0, 0);
	group.rotation.y = Math.PI / 2;
	group.name = "drydock";
	return group;
}

/** The refinery: a squat drum sunk into a captured asteroid, with flare stacks
 *  (`station-types.md` §7). Nothing here rotates. */
function buildRefinery(color: number, fixtures: StationFixture[]): THREE.Group {
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
		hullMaterial(color, "refinery"),
	);
	drum.rotation.x = Math.PI / 2;
	drum.position.z = r * 0.45;
	// Named `core` like the Coriolis hull, so one probe check can read every
	// type's painted surface rather than three names' worth of special case.
	drum.name = "core";
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
			plainMaterial(0x8a7a66, 0.9, 0.1),
		);
		tube.position.y = (r * 1.3) / 2;
		stack.add(tube);
		const flameMaterial = emissiveMaterial(
			STATION_VISUALS.refinery.heatColor,
			3.0,
		);
		const flame = new THREE.Mesh(
			new THREE.ConeGeometry(r * 0.09, r * 0.35, 8),
			flameMaterial,
		);
		flame.position.y = r * 1.3 + r * 0.15;
		flame.name = "flare";
		// **Not tagged as detail**, deliberately. The flame's tip is the
		// refinery's farthest vertex — it is what sets the 0.837 km reach — so
		// hiding it at range would change the outline, which is the one thing
		// §2 forbids. §7 already calls the stacks silhouette; the flame on top of
		// one is the same claim.
		stack.add(flame);
		fixtures.push({ material: flameMaterial, base: 3.0, kind: "flare" });
		stack.position.set(x, y, r * 0.2);
		stack.rotation.z = tilt;
		group.add(stack);
	}

	// A dull heat glow round the drum's base, breathing with the flare: the
	// refinery is the one station whose light is a by-product of what it does.
	const glowMaterial = emissiveMaterial(STATION_VISUALS.refinery.heatColor, 0);
	const glow = new THREE.Mesh(
		new THREE.TorusGeometry(r * 0.55, r * 0.035, 6, 20),
		glowMaterial,
	);
	// On the drum's lit face, round the pad, rather than at its base sunk in the
	// asteroid. Viewed along the aperture axis — which is how a pilot arrives —
	// a ring at the base is edge-on and contributes nothing.
	glow.position.z = r * 0.905;
	glow.name = "heat-glow";
	detail(glow, "reduced");
	group.add(glow);
	fixtures.push({ material: glowMaterial, base: 1.1, kind: "work" });

	// Lit ports round the drum. The refinery had no habitation light at all,
	// which left a crewed station reading as an unmanned tank at close range —
	// the range where §7's outline has stopped being the cue.
	const ports = new THREE.InstancedMesh(
		PANE_GEOMETRY,
		PANE_MATERIALS.refinery,
		8,
	);
	ports.name = "windows";
	detail(ports, "full");
	const portMatrix = new THREE.Matrix4();
	const portQuat = new THREE.Quaternion();
	const portPos = new THREE.Vector3();
	const portNormal = new THREE.Vector3();
	const portUnitZ = new THREE.Vector3(0, 0, 1);
	const portScale = new THREE.Vector3(1, 1, 1);
	for (let i = 0; i < 8; i++) {
		const theta = (i / 8) * Math.PI * 2;
		// On the drum's **end face**, not round its side. Side ports are edge-on
		// from the aperture axis and drew zero pixels there — measured — which
		// left the refinery reading as an unlit tank from the one direction a
		// pilot approaches it.
		portPos.set(
			Math.cos(theta) * r * 0.42,
			Math.sin(theta) * r * 0.42,
			r * 0.9,
		);
		portNormal.copy(portUnitZ);
		portQuat.setFromUnitVectors(portUnitZ, portNormal);
		ports.setMatrixAt(i, portMatrix.compose(portPos, portQuat, portScale));
	}
	ports.instanceMatrix.needsUpdate = true;
	group.add(ports);
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
const BUILDERS: Record<
	StationType,
	(
		color: number,
		fixtures: StationFixture[],
	) => Omit<StationMesh, "type" | "detail" | "fixtures">
> = {
	trade: (color, fixtures) => {
		const spinner = buildCoriolisCore("trade", color, fixtures);
		return { root: normalise("trade", [spinner]), spinner };
	},
	shipyard: (color, fixtures) => {
		const spinner = buildCoriolisCore("shipyard", color, fixtures);
		// The frame is a sibling of the spinner, not a child: §7's drydock is
		// explicitly non-rotating, and a station that turned whole would make it a
		// fairground ride.
		return {
			root: normalise("shipyard", [spinner, buildDrydock(fixtures)]),
			spinner,
		};
	},
	refinery: (color, fixtures) => {
		// An empty spinner rather than `null`: the caller writes a phase of 0 into
		// it every frame, and a null case in the render loop is a branch that
		// exists only to be forgotten.
		const spinner = new THREE.Group();
		return {
			root: normalise("refinery", [buildRefinery(color, fixtures), spinner]),
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

/**
 * Build one station's mesh. `color` is the type's colour from `STATION_COLORS`
 * (`sim.ts`), reached by the renderer as `body.color` — §7's secondary cue, and
 * the reason this takes an argument at all.
 */
export function buildStationMesh(
	type: StationType,
	color: number,
): StationMesh {
	const fixtures: StationFixture[] = [];
	const built = BUILDERS[type](color, fixtures);
	const mesh: StationMesh = { ...built, type, detail: "full", fixtures };
	// Built at `full` and then set, so the tagged accessories are in a state that
	// matches the field rather than merely defaulting to visible. The renderer
	// corrects it on the first frame in any case; a station that disagreed with
	// its own handle for one frame is the sort of thing that shows up as a flash.
	setStationDetail(mesh, "full");
	return mesh;
}

/**
 * Show the accessories that belong at `level`, and hide the rest.
 *
 * Nothing here moves a vertex or rebuilds a geometry: the whole switch is
 * `visible` flags on objects tagged by `detail`, which is what makes §2's rule —
 * a detail level may not change the outline — checkable as an equality on the
 * mesh's reach rather than argued about.
 */
export function setStationDetail(
	mesh: StationMesh,
	level: StationDetailLevel,
): void {
	mesh.detail = level;
	mesh.root.traverse((object) => {
		const min = object.userData.minDetail as StationDetailLevel | undefined;
		if (!min) return;
		object.visible = min === "full" ? level === "full" : level !== "outline";
	});
}

/**
 * Drive one station's detail and lights from the clock and the camera range.
 *
 * Called once per station per frame by the renderer, beside the spin phase it
 * already mirrors. `gameTime` is #6's clock — not `performance.now()` — so two
 * clients at one seed and one time draw the same frame, and a probe can sample
 * a flash by writing a clock value instead of waiting for one
 * (`station-visuals.md` §5.2).
 *
 * The band is measured in the station's own silhouette radii, so a 0.4 km
 * refinery and a 1.5 km shipyard drop detail at the apparent size rather than
 * at the same kilometre.
 */
export function updateStationVisuals(
	mesh: StationMesh,
	gameTime: number,
	distanceKm: number,
): void {
	const level = stationDetailLevel(
		mesh.detail,
		distanceKm / STATION_SILHOUETTE_KM[mesh.type],
	);
	if (level !== mesh.detail) setStationDetail(mesh, level);
	// Nothing driven by the clock is drawn at `outline`, so the waveforms are not
	// evaluated there. This is the common case — most stations in a system are
	// far away — and it is the reason the early return is worth the line.
	if (level === "outline") return;

	const { beaconPeriodS } = STATION_VISUALS[mesh.type].activity;
	const flicker = flickerIntensity(mesh.type, gameTime);
	for (const fixture of mesh.fixtures) {
		const scale =
			fixture.kind === "beacon-port"
				? beaconIntensity(mesh.type, gameTime, 0)
				: fixture.kind === "beacon-starboard"
					? beaconIntensity(mesh.type, gameTime, beaconPeriodS / 2)
					: flicker;
		fixture.material.emissiveIntensity = fixture.base * scale;
	}
}
