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
import { type Ring, hullLoft } from "./loft";
import { STATION_GEOMETRY, type StationType } from "./station";
import {
	PLATE_TEXTURE_SIZE,
	STATION_VISUALS,
	type StationDetailLevel,
	type StationFixtureKind,
	fixtureIntensity,
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
	get trade() {
		return formOf("trade", SELECTED_FORM.trade).reachKm;
	},
	get shipyard() {
		return formOf("shipyard", SELECTED_FORM.shipyard).reachKm;
	},
	get refinery() {
		return formOf("refinery", SELECTED_FORM.refinery).reachKm;
	},
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
	/**
	 * The tagged accessories, collected once at build.
	 *
	 * `setStationDetail` walked the whole graph — struts, rings, panes, stacks —
	 * to flip visibility on the handful of nodes that carry a tag. The set is
	 * known at construction, so it is gathered there. The `userData` tag stays on
	 * each object as well, because that is what `probe-station-visuals.mjs`
	 * reads to hide exactly the set the bands hide; both come from `detail()`, so
	 * they cannot disagree.
	 */
	accessories: THREE.Object3D[];
}

/** One clock-driven light. `base` is its lit intensity; the waveform scales it. */
export interface StationFixture {
	material: THREE.MeshStandardMaterial;
	base: number;
	kind: StationFixtureKind;
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
	// Generated once and handed to both textures: `surfaceTexels` derives its
	// wear from the albedo, so regenerating it would run the plating loop twice
	// per role and leave two buffers that only happen to agree.
	const plate = platingTexels(type);
	const albedo = new THREE.DataTexture(
		plate,
		PLATE_TEXTURE_SIZE,
		PLATE_TEXTURE_SIZE,
		THREE.RGBAFormat,
	);
	const wear = new THREE.DataTexture(
		surfaceTexels(type, PLATE_TEXTURE_SIZE, plate),
		PLATE_TEXTURE_SIZE,
		PLATE_TEXTURE_SIZE,
		THREE.RGBAFormat,
	);
	// **sRGB on the albedo, linear on the wear map.** three.js reads a `map` as
	// sRGB-encoded and a roughness/metalness map as linear data. Left at the
	// default `NoColorSpace` the authored plate value of 196 is taken as linear
	// 0.77 rather than sRGB 0.55, and every hull renders materially darker than
	// the plating arithmetic says — a whole-pass brightness error with no symptom
	// but "the stations look dark".
	albedo.colorSpace = THREE.SRGBColorSpace;
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

/**
 * The maps for one role, built on first use and kept.
 *
 * Built eagerly for all three at module load first, which was **declined once
 * and then measured**: three plating passes and three wear passes over a 128²
 * map cost 18–22 ms, paid by every importer — including `tests/headless.test.ts`
 * and every other headless test that touches this file, none of which renders —
 * and paid for roles a given system may not hold. The guess behind the decline
 * was about a millisecond.
 *
 * A `Map` rather than a `Record`, and that does not lose the fourth-type
 * guarantee: `surfaceMaps` reads `STATION_VISUALS[type]`, which is the `Record`
 * that stops the build.
 */
const surfaceMapCache = new Map<StationType, ReturnType<typeof surfaceMaps>>();
const mapsFor = (type: StationType) => {
	const cached = surfaceMapCache.get(type);
	if (cached) return cached;
	const built = surfaceMaps(type);
	surfaceMapCache.set(type, built);
	return built;
};

/**
 * A painted hull carrying its role's plating.
 *
 * `type` decides the surface and `color` decides the paint — the two cues are
 * deliberately separate, because §7 rests identity on outline with colour as the
 * secondary cue, and a per-role *coloured* map would quietly become a third.
 */
const hullMaterial = (color: number, type: StationType) => {
	const { albedo, wear } = mapsFor(type);
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

/** What a part builder hands back: its group, and whatever clock-driven
 *  materials it created. Returned rather than pushed into an array the caller
 *  owns — an out-parameter let the return type say a builder produced no lights
 *  while it produced most of them. */
interface BuiltPart {
	group: THREE.Group;
	fixtures: StationFixture[];
	/**
	 * The part that turns, when that is not the whole body.
	 *
	 * §7's shipyard frame is explicitly non-rotating and a station that turned
	 * whole would make it a fairground ride — and would also swing the outboard
	 * structure through the view, which is measurable: `probe-station.mjs` reads
	 * the shipyard's far-range width against the trade station's, and a spinning
	 * frame makes that number a function of the clock. Omitted, the whole group
	 * spins.
	 */
	spinner?: THREE.Object3D;
}

/**
 * A lit window grid as one `InstancedMesh`, placed by the caller's rule.
 *
 * Both grids in this file — the Coriolis hull's 28 panes solved onto the face
 * plane, and the refinery's 8 ports on the drum's end face — were the same
 * fifteen lines of `Matrix4`/`Quaternion`/`compose`/`needsUpdate` around one
 * differing line. `place` is that line.
 *
 * One `InstancedMesh` rather than N `Mesh`es because this is the one place a
 * station's detail multiplies, and each `Mesh` is its own draw call. Tagged as
 * `full` detail: the grid resolves away long before the outline does, and 28
 * instances of it at scanner range is state churn for pixels nobody has.
 */
function buildWindowGrid(
	type: StationType,
	count: number,
	place: (i: number, position: THREE.Vector3, normal: THREE.Vector3) => void,
): THREE.InstancedMesh {
	const panes = new THREE.InstancedMesh(
		PANE_GEOMETRY,
		PANE_MATERIALS[type],
		count,
	);
	panes.name = "windows";
	detail(panes, "full");
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const position = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const unitZ = new THREE.Vector3(0, 0, 1);
	const one = new THREE.Vector3(1, 1, 1);
	for (let i = 0; i < count; i++) {
		place(i, position, normal);
		quaternion.setFromUnitVectors(unitZ, normal);
		panes.setMatrixAt(i, matrix.compose(position, quaternion, one));
	}
	panes.instanceMatrix.needsUpdate = true;
	return panes;
}

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
 * a fault, and §5's motion belongs to the strobes, the arc and the flare.
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

/**
 * One candidate form for a role.
 *
 * The station counterpart of `ship-mesh.ts`'s hull variants, and deliberately
 * the same shape of thing: an id, a name, a one-line thesis a reviewer can rank
 * against, and a builder. #28 gave each role exactly one outline and the
 * principal's review of #36's visuals rejected all three on form — the trade
 * station's slot sat on a vertex, and the other two read as neither machine nor
 * rock. So a role now carries several forms and the choice is a ranking rather
 * than an assertion.
 */
export interface StationForm {
	readonly id: StationFormId;
	readonly name: string;
	readonly thesis: string;
	/** How far this form's drawn object reaches, kilometres. Per *form*, not per
	 *  role: a ring station and a drum are not the same size, and
	 *  `STATION_SILHOUETTE_KM` below is the selected form's row. */
	readonly reachKm: number;
	readonly build: (color: number) => BuiltPart;
}

export type StationFormId = "a" | "b" | "c";
export const STATION_FORM_IDS: StationFormId[] = ["a", "b", "c"];

/**
 * The plated shell language every form shares.
 *
 * `hullLoft` is `ship-mesh.ts`'s primitive, moved to `loft.ts` when this node
 * gave it a second caller. Using it is the whole point of the round: the ships
 * stopped reading as an iron press when round four replaced the planform
 * extrusion with a swept superellipse, and a station built from raw
 * `BoxGeometry` and `CylinderGeometry` beside them is that same failure
 * arriving a second time.
 *
 * `segments` is the one station-specific dial. A hull wants 16 and reads
 * smooth; a station often wants 8 or 12, which reads as *plated panels of a
 * size you can judge* — the thing that tells a pilot a station is enormous
 * rather than a small object seen close.
 */
function shell(
	controls: readonly Ring[],
	material: THREE.Material,
	name: string,
	segments = 12,
	/**
	 * Shade each facet flat rather than smoothing across it.
	 *
	 * The one place a station parts company with a ship. A hull is a moulded
	 * object and reads right smooth-shaded; a station is *plated*, and a
	 * twelve-sided drum with smoothed normals reads as a sphere — measured on
	 * the first Coriolis build, which came out an untextured blue blob. Flat
	 * facets give the eye a panel whose size it can judge, which is the cue that
	 * says "this thing is a kilometre across" rather than "this is a small
	 * object seen close".
	 */
	flat = false,
) {
	const geometry = hullLoft(controls, { segments });
	// Repeat the plating over the part rather than stretching one copy across
	// it: `hullLoft` writes `u` round the section and `v` along the sweep's arc
	// length, so a scale here is a panel *count*, and a 1.5 km frame and a
	// 0.4 km drum end up with panels of a comparable size.
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) * segments * 0.5, uv.getY(i) * 6);
	uv.needsUpdate = true;
	const shaded = flat ? material.clone() : material;
	if (flat && shaded instanceof THREE.MeshStandardMaterial)
		shaded.flatShading = true;
	const mesh = new THREE.Mesh(geometry, shaded);
	mesh.name = name;
	return mesh;
}

/** A run of lit ports along a lofted surface, placed by the caller's rule.
 *  Sized from the station rather than from a constant, so the same call reads
 *  right on a 0.4 km drum and a 1.5 km ring. */
function portRun(
	type: StationType,
	count: number,
	place: (i: number, position: THREE.Vector3, normal: THREE.Vector3) => void,
) {
	return buildWindowGrid(type, count, place);
}

/**
 * A pair of hull strobes on a form's own beam.
 *
 * Extracted because every form wants them and each wants them somewhere
 * different: a ring puts them on the rim, a drum on its widest station. The
 * caller supplies the position; the alternation, the colour and the reason they
 * are not a port/starboard pair are `station-visuals.md` §5's.
 */
function strobePair(
	type: StationType,
	fixtures: StationFixture[],
	size: number,
	place: (side: number, position: THREE.Vector3) => void,
) {
	const group = new THREE.Group();
	const sides: [StationFixtureKind, number][] = [
		["strobe-a", -1],
		["strobe-b", 1],
	];
	for (const [kind, side] of sides) {
		const material = emissiveMaterial(STATION_VISUALS[type].strobeColor, 0);
		const lamp = new THREE.Mesh(
			new THREE.BoxGeometry(size, size, size * 0.6),
			material,
		);
		place(side, lamp.position);
		lamp.name = kind;
		detail(lamp, "reduced");
		group.add(lamp);
		fixtures.push({ material, base: 2.6, kind });
	}
	return group;
}

// ---------------------------------------------------------------------------
// The forms
// ---------------------------------------------------------------------------
//
// Three per role. Every one is built from `hullLoft` where it is a hull and
// from a torus where it is a ring; nothing here is a `BoxGeometry` standing in
// for a shape. Each declares its own reach, and `STATION_SILHOUETTE_KM` is the
// selected form's row rather than a number written twice.

/** Trade A — Coriolis. A twelve-sided spun drum with chamfered ends and a
 *  **flat** docking face. #28's octahedron put the slot on a vertex, which is
 *  the review's first finding: you cannot fly into a point. */
function buildTradeCoriolis(color: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const hull = shell(
		[
			{ z: -r * 0.92, w: r * 0.3, h: r * 0.3, e: 2 },
			{ z: -r * 0.72, w: r * 0.62, h: r * 0.62, e: 2, hard: true },
			{ z: -r * 0.3, w: r * 0.95, h: r * 0.95, e: 2 },
			{ z: r * 0.3, w: r * 0.95, h: r * 0.95, e: 2 },
			{ z: r * 0.72, w: r * 0.62, h: r * 0.62, e: 2, hard: true },
			{ z: r * 0.9, w: r * 0.52, h: r * 0.52, e: 2 },
		],
		hullMaterial(color, "trade"),
		"core",
		12,
		true,
	);
	group.add(hull);
	// A raised collar round the slot, so the flat face reads as a *door* rather
	// than as a panel that happens to be lit.
	const collar = shell(
		[
			{ z: r * 0.88, w: r * 0.4, h: r * 0.4, e: 2 },
			{ z: r * 0.96, w: r * 0.34, h: r * 0.34, e: 2, hard: true },
		],
		plainMaterial(0x79838f, 0.7, 0.45),
		"collar",
		12,
	);
	group.add(collar);
	group.add(buildAperture("trade", r * 0.96));
	// Ports in bands round the widest station, which is where decks would be.
	group.add(
		portRun("trade", PANE_COUNT, (i, position, normal) => {
			const theta = ((i % 14) / 14) * Math.PI * 2 + (i < 14 ? 0 : 0.22);
			const band = i < 14 ? -r * 0.14 : r * 0.14;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(r * 0.96);
			position.z = band;
		}),
	);
	group.add(
		strobePair("trade", fixtures, r * 0.07, (side, position) => {
			position.set(side * r * 0.94, 0, r * 0.32);
		}),
	);
	return { group, fixtures };
}

/** Trade B — Ring. Elite Dangerous' answer: a spun torus on a fixed hub, with
 *  the mouth on the hub's axis. The dock is a tunnel rather than a slot, and
 *  the rotation is legible from the ring itself at any range. */
function buildTradeRing(color: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const major = r * 0.92;
	const tube = r * 0.24;
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(major, tube, 8, 24),
		hullMaterial(color, "trade"),
	);
	ring.name = "core";
	group.add(ring);
	// Spokes: lofted, so they read as structure rather than as rods.
	for (let i = 0; i < 3; i++) {
		const theta = (i / 3) * Math.PI * 2;
		const spoke = shell(
			[
				{ z: 0, w: r * 0.09, h: r * 0.05, e: 3 },
				{ z: major, w: r * 0.06, h: r * 0.04, e: 3 },
			],
			plainMaterial(0x6f7d88, 0.72, 0.44),
			`spoke-${i}`,
			8,
		);
		spoke.rotation.y = Math.PI / 2;
		spoke.rotation.z = theta;
		group.add(spoke);
	}
	const hub = shell(
		[
			{ z: -r * 0.34, w: r * 0.24, h: r * 0.24, e: 3 },
			{ z: r * 0.1, w: r * 0.3, h: r * 0.3, e: 3, hard: true },
			{ z: r * 0.52, w: r * 0.26, h: r * 0.26, e: 3 },
		],
		plainMaterial(0x8b95a0, 0.6, 0.5),
		"hub",
		12,
	);
	group.add(hub);
	group.add(buildAperture("trade", r * 0.52));
	group.add(
		portRun("trade", PANE_COUNT, (i, position, normal) => {
			const theta = (i / PANE_COUNT) * Math.PI * 2;
			// On the ring's inner face, which is where a spun habitat's windows
			// would look — inward, at the ring's own floor.
			normal.set(-Math.cos(theta), -Math.sin(theta), 0);
			position.set(
				Math.cos(theta) * (major - tube * 0.95),
				Math.sin(theta) * (major - tube * 0.95),
				0,
			);
		}),
	);
	group.add(
		strobePair("trade", fixtures, r * 0.07, (side, position) => {
			position.set(0, side * (major + tube * 0.6), 0);
		}),
	);
	return { group, fixtures };
}

/** Trade C — Drum. An O'Neill cylinder end-on: a long spun barrel whose
 *  +Z cap is the dock. The one form whose length, not its width, is the cue. */
function buildTradeDrum(color: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const body = r * 0.46;
	group.add(
		shell(
			[
				{ z: -r * 1.02, w: body * 0.5, h: body * 0.5, e: 2.6 },
				{ z: -r * 0.86, w: body, h: body, e: 2.6, hard: true },
				{ z: r * 0.72, w: body, h: body, e: 2.6, hard: true },
				{ z: r * 0.88, w: body * 0.72, h: body * 0.72, e: 2.6 },
			],
			hullMaterial(color, "trade"),
			"core",
			12,
			true,
		),
	);
	// Two stiffening bands, which are what give the barrel a readable size.
	for (const z of [-r * 0.45, r * 0.2]) {
		const band = new THREE.Mesh(
			new THREE.TorusGeometry(body * 1.06, body * 0.09, 6, 16),
			plainMaterial(0x6f7d88, 0.75, 0.4),
		);
		band.position.z = z;
		group.add(band);
	}
	group.add(buildAperture("trade", r * 0.9));
	group.add(
		portRun("trade", PANE_COUNT, (i, position, normal) => {
			const theta = (i / PANE_COUNT) * Math.PI * 2 * 3;
			const z = -r * 0.8 + (i / PANE_COUNT) * r * 1.5;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(body * 1.01);
			position.z = z;
		}),
	);
	group.add(
		strobePair("trade", fixtures, r * 0.07, (side, position) => {
			position.set(side * body * 1.02, 0, r * 0.6);
		}),
	);
	return { group, fixtures };
}

/** Shipyard A — Gantry. A command keel with two open bays of lofted ribs
 *  along it; the bays are the silhouette, and they are obviously *for* holding
 *  something the size of a ship. */
function buildShipyardGantry(color: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const reach = 2.3;
	// **The spinning part is compact, and that is a rule rather than a taste.**
	// The slot sits on the spin axis (`docking.md` §4.2), so whatever turns
	// sweeps its own outline round that axis: a 1.4 km keel spun about Z changes
	// the station's projected width completely between phases, which
	// `probe-station.mjs` reads as a far-range width that depends on the clock.
	// So the keel is structure and stays in the frame; what turns is a hub the
	// size of a Coriolis core.
	// Four segments and a high exponent: a **square** section, head-on. The
	// first hub was a twelve-sided drum like the trade station's, and
	// `probe-station.mjs` measured the two outlines at 1 − IoU 0.203 against its
	// 0.25 floor — from the one viewpoint a docking approach has, a shipyard
	// read as a trade station. §7 rests identity on outline, so the fix is the
	// outline rather than the threshold.
	const hub = shell(
		[
			{ z: -r * 0.5, w: r * 0.46, h: r * 0.46, e: 8 },
			{ z: r * 0.2, w: r * 0.54, h: r * 0.54, e: 8, hard: true },
			{ z: r * 0.62, w: r * 0.42, h: r * 0.42, e: 8 },
		],
		hullMaterial(color, "shipyard"),
		"core",
		4,
		true,
	);
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(hub);
	spun.add(buildAperture("shipyard", r * 0.62));
	group.add(spun);
	const rib = plainMaterial(0x6f7d88, 0.78, 0.42);
	// Named, because every shipyard form has one and `probe-station.mjs` reads
	// it: the check is that the *whole assembly* reparents across the layer
	// handoff, not just the painted core, and it needs one name that holds for
	// every form rather than #28's `drydock`.
	const frame = new THREE.Group();
	frame.name = "frame";
	group.add(frame);
	const keel = shell(
		[
			{ z: -reach * 0.62, w: r * 0.26, h: r * 0.2, e: 3 },
			{ z: -reach * 0.2, w: r * 0.42, h: r * 0.34, e: 3.4, hard: true },
			{ z: reach * 0.34, w: r * 0.5, h: r * 0.42, e: 3.4 },
			{ z: reach * 0.56, w: r * 0.38, h: r * 0.32, e: 3.4 },
		],
		plainMaterial(0x8b95a0, 0.7, 0.44),
		"keel",
		12,
		true,
	);
	keel.rotation.y = Math.PI / 2;
	frame.add(keel);
	for (let i = 0; i < 7; i++) {
		const x = -reach * 0.52 + (i / 6) * reach * 1.04;
		const arch = new THREE.Mesh(
			new THREE.TorusGeometry(r * 0.62, r * 0.05, 5, 12, Math.PI * 1.25),
			rib,
		);
		arch.position.set(x, 0, 0);
		arch.rotation.y = Math.PI / 2;
		arch.rotation.z = -Math.PI * 0.62;
		frame.add(arch);
	}
	for (const y of [-r * 0.58, r * 0.58]) {
		const rail = shell(
			[
				{ z: -reach * 0.56, w: r * 0.05, h: r * 0.05, e: 3 },
				{ z: reach * 0.56, w: r * 0.05, h: r * 0.05, e: 3 },
			],
			rib,
			"rail",
			6,
		);
		rail.rotation.y = Math.PI / 2;
		rail.position.y = y;
		frame.add(rail);
	}
	// Two booms carried forward past the hub, flanking the approach.
	//
	// Without them the gantry's frame lies entirely *across* the aperture axis,
	// so from the one viewpoint a docking approach has — down that axis — the
	// station is a hub with some thin structure behind it, and
	// `probe-station.mjs` measured it against the trade station at 1 − IoU 0.238
	// on a 0.25 floor. Identity is what §7 rests on and the approach view is
	// where it matters most, so the frame now reaches into that view.
	for (const y of [-r * 0.8, r * 0.8]) {
		const boom = shell(
			[
				{ z: -reach * 0.1, w: r * 0.09, h: r * 0.09, e: 3 },
				{ z: r * 1.5, w: r * 0.07, h: r * 0.07, e: 3, hard: true },
				{ z: r * 1.9, w: r * 0.16, h: r * 0.16, e: 3 },
			],
			plainMaterial(0x6f7d88, 0.78, 0.42),
			"boom",
			6,
			true,
		);
		boom.position.y = y;
		frame.add(boom);
	}
	group.add(buildBayLights(fixtures, reach, r));
	group.add(
		portRun("shipyard", 16, (i, position, normal) => {
			normal.set(0, 1, 0);
			position.set(
				reach * 0.18 + (i % 8) * r * 0.08,
				r * 0.44,
				(i < 8 ? -1 : 1) * r * 0.16,
			);
		}),
	);
	group.add(
		strobePair("shipyard", fixtures, r * 0.07, (side, position) => {
			position.set(side * reach * 0.55, 0, 0);
		}),
	);
	return { group, fixtures, spinner: spun };
}

/** Shipyard B — Cradle. Two lofted arms curved round an empty slip, with the
 *  command block above them. The negative space is the identity. */
function buildShipyardCradle(color: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const reach = 2.14;
	const block = shell(
		[
			{ z: -r * 0.5, w: r * 0.38, h: r * 0.3, e: 3.6 },
			{ z: r * 0.2, w: r * 0.5, h: r * 0.4, e: 3.6, hard: true },
			{ z: r * 0.62, w: r * 0.34, h: r * 0.28, e: 3.6 },
		],
		hullMaterial(color, "shipyard"),
		"core",
		12,
		true,
	);
	block.position.y = r * 0.72;
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(block);
	const aperture = buildAperture("shipyard", r * 0.62);
	aperture.position.y = r * 0.72;
	spun.add(aperture);
	group.add(spun);
	const frame = new THREE.Group();
	frame.name = "frame";
	group.add(frame);
	for (const side of [-1, 1]) {
		const arm = shell(
			[
				{ z: -reach * 0.6, w: r * 0.16, h: r * 0.13, y: 0, e: 3 },
				{ z: -reach * 0.2, w: r * 0.22, h: r * 0.18, y: -r * 0.5, e: 3 },
				{ z: reach * 0.2, w: r * 0.22, h: r * 0.18, y: -r * 0.5, e: 3 },
				{ z: reach * 0.6, w: r * 0.16, h: r * 0.13, y: 0, e: 3 },
			],
			plainMaterial(0x6f7d88, 0.78, 0.42),
			`arm-${side}`,
			10,
		);
		arm.rotation.y = Math.PI / 2;
		arm.position.z = side * r * 0.62;
		frame.add(arm);
	}
	group.add(buildBayLights(fixtures, reach, r));
	group.add(
		portRun("shipyard", 12, (i, position, normal) => {
			normal.set(0, 0, 1);
			position.set(
				-r * 0.3 + (i % 6) * r * 0.12,
				r * 0.72 + (i < 6 ? -r * 0.1 : r * 0.1),
				r * 0.3,
			);
		}),
	);
	group.add(
		strobePair("shipyard", fixtures, r * 0.07, (side, position) => {
			position.set(side * reach * 0.58, r * 0.1, 0);
		}),
	);
	return { group, fixtures, spinner: spun };
}

/** Shipyard C — Slipway ring. A partial ring with the gap as the slip: the
 *  one shipyard form whose outline is a broken circle, which nothing else in
 *  the pool is. */
function buildShipyardSlipway(color: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const reach = 2.07;
	const major = reach * 0.62;
	const arc = new THREE.Mesh(
		new THREE.TorusGeometry(major, r * 0.2, 8, 22, Math.PI * 1.45),
		hullMaterial(color, "shipyard"),
	);
	arc.name = "core";
	arc.rotation.z = Math.PI * 0.28;
	const frame = new THREE.Group();
	frame.name = "frame";
	frame.add(arc);
	group.add(frame);
	const spine = shell(
		[
			{ z: -r * 0.6, w: r * 0.3, h: r * 0.26, e: 3.4 },
			{ z: r * 0.24, w: r * 0.4, h: r * 0.34, e: 3.4, hard: true },
			{ z: r * 0.64, w: r * 0.3, h: r * 0.26, e: 3.4 },
		],
		plainMaterial(0x8b95a0, 0.62, 0.48),
		"hub",
		12,
	);
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(spine);
	spun.add(buildAperture("shipyard", r * 0.64));
	group.add(spun);
	for (let i = 0; i < 4; i++) {
		const theta = Math.PI * 0.28 + (i / 3) * Math.PI * 1.4;
		const strut = shell(
			[
				{ z: 0, w: r * 0.07, h: r * 0.05, e: 3 },
				{ z: major, w: r * 0.05, h: r * 0.04, e: 3 },
			],
			plainMaterial(0x6f7d88, 0.78, 0.42),
			`strut-${i}`,
			6,
		);
		strut.rotation.y = Math.PI / 2;
		strut.rotation.z = theta;
		frame.add(strut);
	}
	group.add(buildBayLights(fixtures, reach, r));
	group.add(
		portRun("shipyard", 12, (i, position, normal) => {
			const theta = Math.PI * 0.28 + ((i + 1) / 13) * Math.PI * 1.4;
			// On the ring's inner face, looking into the slip.
			normal.set(-Math.cos(theta), -Math.sin(theta), 0);
			position.set(
				Math.cos(theta) * major * 0.82,
				Math.sin(theta) * major * 0.82,
				0,
			);
		}),
	);
	group.add(
		strobePair("shipyard", fixtures, r * 0.07, (side, position) => {
			const theta = Math.PI * 0.28 + (side > 0 ? 0 : Math.PI * 1.4);
			position.set(Math.cos(theta) * major, Math.sin(theta) * major, 0);
		}),
	);
	return { group, fixtures, spinner: spun };
}

/** The shipyard's work light: cold floods along the bay and one welding arc.
 *  Shared by all three forms, because the light is what says *shipyard* once
 *  the outline has told you it is not a trade station. */
function buildBayLights(
	fixtures: StationFixture[],
	reach: number,
	r: number,
): THREE.Group {
	const group = new THREE.Group();
	for (let i = 0; i < 4; i++) {
		const flood = new THREE.Mesh(
			new THREE.BoxGeometry(r * 0.26, r * 0.03, r * 0.06),
			FLOOD_MATERIAL,
		);
		flood.position.set(-reach * 0.4 + i * reach * 0.27, -r * 0.5, 0);
		flood.name = "bay-flood";
		detail(flood, "reduced");
		group.add(flood);
	}
	const arcMaterial = emissiveMaterial(STATION_VISUALS.shipyard.floodColor, 0);
	const arc = new THREE.Mesh(
		new THREE.SphereGeometry(r * 0.05, 8, 6),
		arcMaterial,
	);
	arc.position.set(reach * 0.14, -r * 0.34, 0);
	arc.name = "weld-arc";
	detail(arc, "reduced");
	group.add(arc);
	fixtures.push({ material: arcMaterial, base: 4.5, kind: "work" });
	return group;
}

/** The refinery's heat: a flare on a boom, and the glow it throws. The flame
 *  is never tagged as detail — its tip is the form's outermost point, and
 *  `station-visuals.md` §2 forbids an accessory carrying the outline. */
function buildFlare(
	fixtures: StationFixture[],
	length: number,
	radius: number,
): THREE.Group {
	const stack = new THREE.Group();
	stack.add(
		shell(
			[
				{ z: 0, w: radius * 1.3, h: radius * 1.3, e: 3 },
				{ z: length * 0.82, w: radius * 0.8, h: radius * 0.8, e: 3 },
			],
			plainMaterial(0x8a7a66, 0.9, 0.1),
			"boom",
			8,
		),
	);
	const flameMaterial = emissiveMaterial(STATION_VISUALS.refinery.heatColor, 3);
	const flame = new THREE.Mesh(
		new THREE.ConeGeometry(radius * 0.95, length * 0.34, 8),
		flameMaterial,
	);
	flame.position.z = length * 0.99;
	flame.rotation.x = Math.PI / 2;
	flame.name = "flare";
	stack.add(flame);
	fixtures.push({ material: flameMaterial, base: 3, kind: "flare" });
	return stack;
}

/** Refinery A — Cracker. Stacked lofted tanks under a fractionating column,
 *  with the pad on the tank stack's face. Plant, not rock. */
function buildRefineryCracker(color: number): BuiltPart {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	group.add(
		shell(
			[
				{ z: -r * 1.1, w: r * 0.5, h: r * 0.5, e: 2.6 },
				{ z: -r * 0.2, w: r * 0.86, h: r * 0.86, e: 2.6, hard: true },
				{ z: r * 0.5, w: r * 0.86, h: r * 0.86, e: 2.6, hard: true },
				{ z: r * 0.9, w: r * 0.58, h: r * 0.58, e: 2.6 },
			],
			hullMaterial(color, "refinery"),
			"core",
			12,
			true,
		),
	);
	for (const [x, y] of [
		[r * 0.95, r * 0.2],
		[-r * 0.82, -r * 0.5],
	]) {
		const tank = shell(
			[
				{ z: -r * 0.62, w: r * 0.3, h: r * 0.3, e: 2.4 },
				{ z: r * 0.62, w: r * 0.3, h: r * 0.3, e: 2.4 },
			],
			plainMaterial(0xb2a894, 0.85, 0.16),
			"tank",
			10,
		);
		tank.position.set(x, y, -r * 0.2);
		group.add(tank);
	}
	group.add(buildAperture("refinery", r * 0.92));
	const flare = buildFlare(fixtures, r * 1.1, r * 0.09);
	flare.position.set(r * 0.4, r * 0.7, r * 0.1);
	flare.rotation.x = -Math.PI / 2.4;
	group.add(flare);
	group.add(buildHeatRing(fixtures, r * 0.6, r * 0.92));
	group.add(
		portRun("refinery", 10, (i, position, normal) => {
			const theta = (i / 10) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(r * 0.88);
			position.z = r * 0.15;
		}),
	);
	return { group, fixtures };
}

/** Refinery B — Rock. #28's captured asteroid kept, but the plant on it built
 *  in the same lofted language as everything else, so the contrast between
 *  machined and unmachined is the point rather than an accident. */
function buildRefineryRock(color: number): BuiltPart {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const rock = new THREE.IcosahedronGeometry(r * 1.18, 1);
	const rand = displayRand("station-refinery-rock");
	const pos = rock.getAttribute("position");
	for (let i = 0; i < pos.count; i++) {
		const f = 0.72 + rand() * 0.5;
		pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f * 0.78);
	}
	rock.computeVertexNormals();
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
	group.add(
		shell(
			[
				{ z: r * 0.1, w: r * 0.72, h: r * 0.72, e: 3.2 },
				{ z: r * 0.66, w: r * 0.66, h: r * 0.66, e: 3.2, hard: true },
				{ z: r * 0.94, w: r * 0.5, h: r * 0.5, e: 3.2 },
			],
			hullMaterial(color, "refinery"),
			"core",
			12,
			true,
		),
	);
	group.add(buildAperture("refinery", r * 0.94));
	for (const [x, y, tilt] of [
		[r * 0.7, r * 0.3, 0.4],
		[-r * 0.55, r * 0.6, -0.5],
	]) {
		const flare = buildFlare(fixtures, r * 1.05, r * 0.08);
		flare.position.set(x, y, r * 0.2);
		flare.rotation.x = -Math.PI / 2 + tilt * 0.4;
		flare.rotation.y = tilt;
		group.add(flare);
	}
	group.add(buildHeatRing(fixtures, r * 0.56, r * 0.93));
	group.add(
		portRun("refinery", 8, (i, position, normal) => {
			const theta = (i / 8) * Math.PI * 2;
			normal.set(0, 0, 1);
			position.set(
				Math.cos(theta) * r * 0.42,
				Math.sin(theta) * r * 0.42,
				r * 0.95,
			);
		}),
	);
	return { group, fixtures };
}

/** Refinery C — Barge. A long processing hull with tank blisters down one
 *  flank and two flare booms aft: the only form of the three whose axis is
 *  longer than it is wide. */
function buildRefineryBarge(color: number): BuiltPart {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const hull = shell(
		[
			{ z: -r * 1.7, w: r * 0.3, h: r * 0.24, e: 3.2 },
			{ z: -r * 1.1, w: r * 0.52, h: r * 0.4, e: 3.4, hard: true },
			{ z: r * 0.5, w: r * 0.56, h: r * 0.44, e: 3.4 },
			{ z: r * 0.94, w: r * 0.4, h: r * 0.34, e: 3.4 },
		],
		hullMaterial(color, "refinery"),
		"core",
		12,
		true,
	);
	group.add(hull);
	for (let i = 0; i < 3; i++) {
		const blister = shell(
			[
				{ z: -r * 0.3, w: r * 0.24, h: r * 0.24, e: 2.4 },
				{ z: r * 0.3, w: r * 0.24, h: r * 0.24, e: 2.4 },
			],
			plainMaterial(0xb2a894, 0.85, 0.16),
			"blister",
			10,
		);
		blister.position.set(r * 0.62, 0, -r * 0.9 + i * r * 0.72);
		group.add(blister);
	}
	group.add(buildAperture("refinery", r * 0.96));
	for (const side of [-1, 1]) {
		const flare = buildFlare(fixtures, r * 1.0, r * 0.08);
		flare.position.set(side * r * 0.34, r * 0.34, -r * 1.3);
		flare.rotation.x = -Math.PI / 2.2;
		flare.rotation.z = side * 0.3;
		group.add(flare);
	}
	group.add(buildHeatRing(fixtures, r * 0.42, r * 0.95));
	group.add(
		portRun("refinery", 10, (i, position, normal) => {
			normal.set(-1, 0, 0);
			position.set(-r * 0.55, r * 0.1, -r * 1.0 + i * r * 0.2);
		}),
	);
	return { group, fixtures };
}

/** The heat ring round a refinery's docking face, breathing with the flare. */
function buildHeatRing(
	fixtures: StationFixture[],
	radius: number,
	z: number,
): THREE.Mesh {
	const material = emissiveMaterial(STATION_VISUALS.refinery.heatColor, 0);
	const glow = new THREE.Mesh(
		new THREE.TorusGeometry(radius, radius * 0.07, 6, 20),
		material,
	);
	glow.position.z = z;
	glow.name = "heat-glow";
	detail(glow, "reduced");
	fixtures.push({ material, base: 1.1, kind: "work" });
	return glow;
}

/**
 * Every form, by role.
 *
 * A `Record<StationType, …>` for `station-types.md` §8.5's reason, and each
 * role's list is exactly `STATION_FORM_IDS` long so the previewer's three slots
 * cannot silently hold two.
 */
export const STATION_FORMS: Record<StationType, StationForm[]> = {
	trade: [
		{
			id: "a",
			name: "Coriolis",
			thesis: "twelve-sided spun drum, flat docking face, chamfered ends",
			reachKm: 0.66,
			build: buildTradeCoriolis,
		},
		{
			id: "b",
			name: "Ring",
			thesis: "spun torus on a fixed hub; the dock is a tunnel on the axis",
			reachKm: 0.73,
			build: buildTradeRing,
		},
		{
			id: "c",
			name: "Drum",
			thesis: "O'Neill barrel end-on; length rather than width is the cue",
			reachKm: 0.66,
			build: buildTradeDrum,
		},
	],
	shipyard: [
		{
			id: "a",
			name: "Gantry",
			thesis: "command keel under open ribbed bays sized for a ship",
			reachKm: 1.5,
			build: buildShipyardGantry,
		},
		{
			id: "b",
			name: "Cradle",
			thesis: "two curved arms round an empty slip; negative space is the cue",
			reachKm: 1.5,
			build: buildShipyardCradle,
		},
		{
			id: "c",
			name: "Slipway",
			thesis: "a broken ring with the gap as the slip",
			reachKm: 1.5,
			build: buildShipyardSlipway,
		},
	],
	refinery: [
		{
			id: "a",
			name: "Cracker",
			thesis: "stacked tanks under a column; plant rather than rock",
			reachKm: 0.85,
			build: buildRefineryCracker,
		},
		{
			id: "b",
			name: "Rock",
			thesis: "#28's asteroid, with the plant on it built in the hull language",
			reachKm: 0.85,
			build: buildRefineryRock,
		},
		{
			id: "c",
			name: "Barge",
			thesis: "a long processing hull with tank blisters and two aft booms",
			reachKm: 0.8,
			build: buildRefineryBarge,
		},
	],
};

/**
 * Which form each role is currently built with in the game.
 *
 * One line, so a ranking round changes one line. Until #56's review picks, this
 * is the first concept of each role rather than a default that means nothing:
 * an unranked pool has no winner, and pretending otherwise is how a placeholder
 * becomes the shipped answer.
 */
export const SELECTED_FORM: Record<StationType, StationFormId> = {
	trade: "a",
	shipyard: "a",
	refinery: "b",
};

const formOf = (type: StationType, id: StationFormId) => {
	const form = STATION_FORMS[type].find((candidate) => candidate.id === id);
	if (!form) throw new Error(`no form ${id} for ${type}`);
	return form;
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
 * Build one station in a named form.
 *
 * The form is a parameter because `?model-viewer=station` builds every
 * candidate side by side, and because a ranking round has to change one line
 * rather than nine builders. `buildStationMesh` below is this with the game's
 * current choice supplied.
 *
 * `color` is the type's colour from `STATION_COLORS` (`sim.ts`), reached by the
 * renderer as `body.color` — §7's secondary cue, and the reason this takes an
 * argument at all.
 */
export function buildStationForm(
	type: StationType,
	formId: StationFormId,
	color: number,
): StationMesh {
	const form = formOf(type, formId);
	// The builder returns its own fixtures rather than filling an array handed
	// to it: with an out-parameter the return type said a builder produced no
	// lights while it in fact produced most of them, so a fourth station type
	// would have compiled with none and lit nothing.
	const built = form.build(color);
	// The spinner is the form's own declared part where it names one, the whole
	// body where it does not, and an empty group for a role whose pad does not
	// turn at all (`docking.md` §4). The empty one is a *sibling* added here;
	// a declared one is already inside `built.group` and must not be re-added,
	// which would lift it out of the body it belongs to.
	const parts: THREE.Object3D[] = [built.group];
	let spinner: THREE.Object3D;
	if (STATION_GEOMETRY[type].spins) {
		spinner = built.spinner ?? built.group;
	} else {
		spinner = new THREE.Group();
		parts.push(spinner);
	}
	const root = normalise(type, parts);
	const accessories: THREE.Object3D[] = [];
	root.traverse((object) => {
		if (object.userData.minDetail) accessories.push(object);
	});
	const mesh: StationMesh = {
		root,
		spinner,
		type,
		detail: "full",
		fixtures: built.fixtures,
		accessories,
	};
	// Built at `full` and then set, so the tagged accessories are in a state that
	// matches the field rather than merely defaulting to visible. The renderer
	// corrects it on the first frame in any case; a station that disagreed with
	// its own handle for one frame is the sort of thing that shows up as a flash.
	setStationDetail(mesh, "full");
	return mesh;
}

/** Build one station in the form the game currently uses for its role. */
export function buildStationMesh(
	type: StationType,
	color: number,
): StationMesh {
	return buildStationForm(type, SELECTED_FORM[type], color);
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
	for (const object of mesh.accessories) {
		const min = object.userData.minDetail as StationDetailLevel;
		object.visible = min === "full" ? level === "full" : level !== "outline";
	}
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

	// **Every fixture, at every level.** An earlier version returned early at
	// `outline` on the reasoning that nothing clock-driven is drawn there — which
	// is false for the refinery's flare, the one fixture deliberately left
	// untagged because its tip is the station's outermost point. Its intensity
	// froze at whatever the last near-range frame wrote, so a distant refinery's
	// flare depended on that client's approach history rather than on the clock,
	// and §5.2's "two clients at one seed draw the same frame" was not true of
	// it. Driving the hidden ones too costs a couple of float writes a frame.
	// The kind → waveform mapping is `station-visuals.ts`'s, which owns the one
	// signature and the one motion a role carries. This module only multiplies
	// by the fixture's own lit intensity.
	for (const fixture of mesh.fixtures) {
		fixture.material.emissiveIntensity =
			fixture.base * fixtureIntensity(mesh.type, fixture.kind, gameTime);
	}
}

/**
 * A plain snapshot of what one station is currently drawing.
 *
 * Here rather than assembled in `main.ts`, which was reading
 * `fixture.material.emissiveIntensity` directly: that made the game shell
 * depend on how a fixture happens to *store* its drive, so changing a fixture
 * to a `Light` or to a non-emissive channel would break the renderer and the
 * probe together. This module owns the representation, so it owns the readout.
 */
export function stationVisualSnapshot(mesh: StationMesh) {
	return {
		type: mesh.type,
		detail: mesh.detail,
		silhouetteKm: STATION_SILHOUETTE_KM[mesh.type],
		fixtures: mesh.fixtures.map((fixture) => ({
			kind: fixture.kind,
			intensity: fixture.material.emissiveIntensity,
		})),
	};
}
