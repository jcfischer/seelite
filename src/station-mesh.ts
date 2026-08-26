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
import { SimplexNoise } from "./noise";
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
	get outpost() {
		return formOf("outpost", SELECTED_FORM.outpost).reachKm;
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
	outpost: emissiveMaterial(STATION_VISUALS.outpost.windowColor, 1.2),
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
 * Which ranking round the forms below belong to.
 *
 * Named for the same reason `SHIP_DESIGN_ROUND` is: the workbench labels the
 * round it is showing, and a reviewer ranking round two against round one's
 * labels is ranking the wrong pool.
 *
 * **Round one's ranking**, which produced this round: trade `A > C > B`,
 * shipyard `A > C > B`, refinery — no order, and a instruction instead. Each
 * role keeps its top two and spends its last slot, which is #35's convention;
 * the refinery is the exception and spends all three, because the review of it
 * was not a preference between the concepts offered but a rejection of two of
 * them. "Keep the asteroid, but a better asteroid with structure built into it"
 * makes rock the thesis of the whole role rather than of one concept in it.
 *
 * The other two notes were defects rather than preferences and are treated as
 * such: the ring was ranked *last* and described as good — "looks like a comic,
 * and maybe use more than one spoke" — so it is rebuilt in its slot rather than
 * dropped, and the shipyard's last slot is spent on a different silhouette
 * class rather than a fourth variation of an open frame.
 */
export const STATION_DESIGN_ROUND = 2;

/**
 * A captured asteroid, displaced and cratered.
 *
 * Round one's rock was an icosahedron with its vertices jittered by a uniform
 * random factor, which gives a *lumpy ball*: every vertex moves independently,
 * so the surface has no features larger than one face and no features smaller
 * than one either. It reads as a low-poly sphere with noise on it, which is
 * what the review said.
 *
 * This is coherent noise instead, at three octaves, so the rock has shapes at
 * three scales — a long axis, ridges, and a grain — plus craters, which are the
 * one feature that says *asteroid* rather than *potato*.
 *
 * `SimplexNoise` only offers `noise2D`, so the displacement is the sum of three
 * planar lookups on the vertex's own (x, y), (y, z) and (z, x). That is a
 * triplanar blend rather than true 3D noise: it costs one seam-free field with
 * no poles, which a spherical (θ, φ) parameterisation would not give — the
 * poles are exactly where a rock would then show a pinch.
 */
function buildAsteroid(
	radiusKm: number,
	tag: string,
	/**
	 * A keep-clear volume along +Z, carved out of the rock.
	 *
	 * Without it the displacement puts rock **in front of the pad**: measured,
	 * the Warren's surface rose to z = 0.413 km against a pad mouth at 0.282 km
	 * and the Collar's to 0.360 against 0.286, so on both a ship would have had
	 * to fly through a hill to dock. Noise does not know where the dock is, and
	 * a rock is the one body in the pool whose surface is not authored.
	 *
	 * The cut is a bench rather than a stamped hole — the ceiling eases upward
	 * towards the rim — so it reads as ground that has been machined flat for
	 * the pad, which is what it is.
	 */
	clear?: { radiusKm: number; ceilingKm: number },
): THREE.Mesh {
	const geometry = new THREE.IcosahedronGeometry(radiusKm, 3);
	const noise = new SimplexNoise(
		[...tag].reduce(
			(h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193),
			0x811c9dc5,
		) >>> 0,
	);
	const rand = displayRand(`${tag}-craters`);
	// Craters: a direction, an angular radius and a depth each. Six is enough to
	// read as cratered from any angle without turning the rock into foam.
	const craters = Array.from({ length: 6 }, () => {
		const z = rand() * 2 - 1;
		const theta = rand() * Math.PI * 2;
		const planar = Math.sqrt(Math.max(0, 1 - z * z));
		return {
			dir: new THREE.Vector3(
				planar * Math.cos(theta),
				planar * Math.sin(theta),
				z,
			),
			cos: Math.cos(0.22 + rand() * 0.3),
			depth: 0.06 + rand() * 0.1,
		};
	});
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const v = new THREE.Vector3();
	const unit = new THREE.Vector3();
	for (let i = 0; i < position.count; i++) {
		v.fromBufferAttribute(position, i);
		unit.copy(v).normalize();
		const field = (frequency: number) =>
			noise.noise2D(unit.x * frequency, unit.y * frequency) +
			noise.noise2D(unit.y * frequency, unit.z * frequency) +
			noise.noise2D(unit.z * frequency, unit.x * frequency);
		let scale =
			1 + field(1.1) * 0.085 + field(2.7) * 0.042 + field(6.3) * 0.018;
		for (const crater of craters) {
			const alignment = unit.dot(crater.dir);
			if (alignment <= crater.cos) continue;
			// A smooth bowl rather than a step: `t` is 0 at the rim and 1 at the
			// centre, and the square is what gives the floor a flat-ish middle
			// instead of a spike.
			const t = (alignment - crater.cos) / (1 - crater.cos);
			scale -= crater.depth * t * t;
		}
		// Flattened along Z, so the rock has a long axis. A sphere with noise on
		// it still reads as a sphere.
		v.copy(unit).multiplyScalar(radiusKm * scale);
		v.z *= 0.78;
		if (clear) {
			const rho = Math.hypot(v.x, v.y);
			if (rho < clear.radiusKm) {
				// Eased at the rim: a hard clamp leaves a stamped disc with a
				// vertical wall, which reads as a hole punched in the rock rather
				// than as a bench cut into it.
				const t = rho / clear.radiusKm;
				v.z = Math.min(v.z, clear.ceilingKm + clear.radiusKm * 0.55 * t * t);
			}
		}
		position.setXYZ(i, v.x, v.y, v.z);
	}
	position.needsUpdate = true;
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({
			// Lighter than rock looks in a swatch, for #28's reason: the near
			// layer's only fill is a dim camera-side light, and a physically
			// plausible dark asteroid renders as a hole in the starfield.
			color: 0x9a8a72,
			roughness: 0.95,
			metalness: 0.02,
			flatShading: true,
		}),
	);
	mesh.name = "asteroid";
	return mesh;
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
 * One texture repeat per this many kilometres of hull.
 *
 * The plating map carries about eight panels across, so a plate is roughly
 * 19 m — a size a pilot can judge a ship against, which is the whole job of
 * plating at this scale. One constant for every part of every station, because
 * a plate that changes size from one part to the next stops being a ruler.
 */
const STATION_PANEL_KM = 0.15;

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
	// **A panel size, not a panel count.** `hullLoft` writes its UVs in
	// kilometres — chord distance round the section and distance along the
	// sweep — so dividing by one constant gives every part of every station the
	// same ~19 m plate. Multiplying a normalised 0–1 unwrap by a fixed count,
	// which is what this did, gives a 1.5 km keel and a 0.12 km terrace six
	// bands each: one coarse, the other a smear.
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) / STATION_PANEL_KM, uv.getY(i) / STATION_PANEL_KM);
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

/**
 * Trade A — Coriolis. A **cuboctahedron**: eight triangular faces and six
 * square ones, with the slot cut into the square face that points at you.
 *
 * This is the third attempt and the first that is the reference shape rather
 * than an approximation of it. Round one built a twelve-sided lofted drum,
 * which projected as a circle down the aperture axis and could not be told from
 * the refinery by outline. Round two squared its *section* — four segments at
 * `e: 5` — which fixed the projection and was still a swept tube with a bulge
 * in the middle, judged ugly on review, and had nothing flat to put a light on.
 *
 * A cuboctahedron solves all three at once and needs no swept loft: its six
 * square faces are genuinely flat and axis-aligned, so the +Z one is a door and
 * the four equatorial ones are walls that a window grid and a strobe can sit
 * *on* rather than near. Every vertex is the same distance from the centre, so
 * `PolyhedronGeometry` can build it directly from twelve points, and the
 * silhouette is a twelve-sided outline that is nobody else's.
 *
 * `FACE_INSET` is where the square faces are: for a cuboctahedron of radius R
 * the square face planes sit at `R / √2`. That figure is the whole reason
 * nothing floats — the aperture, the collar, the panes and the strobes are all
 * placed from it rather than from a radius chosen by eye.
 */
const CUBOCTAHEDRON_FACE = Math.SQRT1_2;

function buildCuboctahedron(radiusKm: number, material: THREE.Material) {
	// The twelve permutations of (±1, ±1, 0). `PolyhedronGeometry` normalises
	// every vertex to the radius, which is exact here because a cuboctahedron's
	// vertices are equidistant — that is what makes it buildable this way and a
	// truncated cube, say, not.
	// The twelve permutations of (±1, ±1, 0), grouped so the index list below can
	// be read: 0–3 are the z = 0 ring, 4–7 the y = 0 ring, 8–11 the x = 0 ring.
	// `PolyhedronGeometry` normalises every vertex to the radius, which is exact
	// here because a cuboctahedron's vertices are equidistant — that is what
	// makes it buildable this way and a truncated cube, say, not.
	const vertices = [
		1, 1, 0, -1, 1, 0, -1, -1, 0, 1, -1, 0, 1, 0, 1, -1, 0, 1, -1, 0, -1, 1, 0,
		-1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0, 1, -1,
	];
	// Six squares as two triangles each, then eight triangles — one per octant.
	// Every winding is outward; the first version's list was neither a
	// cuboctahedron nor consistently wound, and rendered as two interpenetrating
	// wedges with the window grid hanging in space beside them, because the
	// faces the panes were placed against were not where the geometry put them.
	const indices = [
		// +Z, -Z
		4, 8, 5, 4, 5, 9, 7, 10, 6, 7, 6, 11,
		// +X, -X
		0, 4, 3, 0, 3, 7, 1, 6, 2, 1, 2, 5,
		// +Y, -Y
		0, 11, 1, 0, 1, 8, 3, 9, 2, 3, 2, 10,
		// the eight octant triangles
		0, 8, 4, 1, 5, 8, 2, 9, 5, 3, 4, 9, 0, 7, 11, 1, 11, 6, 2, 6, 10, 3, 10, 7,
	];
	const geometry = new THREE.PolyhedronGeometry(vertices, indices, radiusKm, 0);
	// **Box-projected UVs, per face.** `PolyhedronGeometry` writes an azimuthal
	// unwrap — longitude and latitude — which is right for a sphere and wrong
	// for a solid made of flat plates: the plating smears into streaks towards
	// the poles and changes panel size from one triangle to the next. Each face
	// is projected onto whichever axis plane it most faces instead, in
	// kilometres, so a panel is the same size everywhere on this hull and the
	// same size as on every other station.
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const edge = new THREE.Vector3();
	const normal = new THREE.Vector3();
	// One texture repeat per 150 m. The map carries about eight panels across,
	// so a plate is roughly 19 m — a size a pilot can judge a ship against,
	// which is the whole job of plating at this scale. At 60 m per repeat the
	// hull read as fine noise rather than as panels.
	const PANEL_KM = STATION_PANEL_KM;
	// Non-indexed, so each run of three vertices is one face and can be given its
	// own projection without splitting anything.
	for (let i = 0; i < position.count; i += 3) {
		a.fromBufferAttribute(position, i);
		b.fromBufferAttribute(position, i + 1);
		c.fromBufferAttribute(position, i + 2);
		normal.copy(b).sub(a);
		edge.copy(c).sub(a);
		normal.cross(edge);
		const ax = Math.abs(normal.x);
		const ay = Math.abs(normal.y);
		const az = Math.abs(normal.z);
		const axis = ax > ay && ax > az ? 0 : ay > az ? 1 : 2;
		for (let k = 0; k < 3; k++) {
			const v = k === 0 ? a : k === 1 ? b : c;
			uv.setXY(
				i + k,
				(axis === 0 ? v.y : v.x) / PANEL_KM,
				(axis === 2 ? v.y : v.z) / PANEL_KM,
			);
		}
	}
	uv.needsUpdate = true;
	const mesh = new THREE.Mesh(geometry, material);
	(material as THREE.MeshStandardMaterial).flatShading = true;
	return mesh;
}

function buildTradeCoriolis(color: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const radius = r * 0.95;
	/** Where a square face's plane sits, kilometres. Everything mounted on the
	 *  hull is placed from this — which is what stops a light hanging in space
	 *  beside the station, as the swept version's did. */
	const face = radius * CUBOCTAHEDRON_FACE;

	const hull = buildCuboctahedron(radius, hullMaterial(color, "trade"));
	hull.name = "core";
	group.add(hull);

	// A square coaming round the slot, standing proud of the +Z face by a tenth
	// of its own width — a door frame, so the face reads as a way in rather than
	// as a lit panel.
	const coaming = new THREE.Mesh(
		new THREE.BoxGeometry(face * 1.05, face * 1.05, face * 0.16),
		plainMaterial(0x79838f, 0.7, 0.45),
	);
	coaming.position.z = face + face * 0.06;
	coaming.name = "coaming";
	group.add(coaming);
	group.add(buildAperture("trade", face + face * 0.14));

	// The window grid, on the four equatorial square faces. Each pane sits on
	// its face's own plane, a hair proud, so none of them can float: the face is
	// at `face` along its axis and spans ±`face` across it.
	const PER_FACE = 7;
	group.add(
		portRun("trade", PER_FACE * 4, (i, position, normal) => {
			// Four faces, seven panes each: the face is the index modulo four and
			// the position along it is the index divided by four.
			const angle = ((i % 4) / 4) * Math.PI * 2;
			const step = Math.floor(i / 4);
			normal.set(Math.cos(angle), Math.sin(angle), 0);
			// A staggered two-row run inside the face's square, kept clear of its
			// edges so a pane cannot hang off a corner. The face plane is at
			// `face` along its normal and spans ±`face` across it.
			const across = (step / (PER_FACE - 1) - 0.5) * face * 1.1;
			const up = (step % 2 === 0 ? -1 : 1) * face * 0.32;
			position
				.copy(normal)
				.multiplyScalar(face * 1.004)
				.addScaledVector(
					new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0),
					across,
				);
			position.z = up;
		}),
	);

	// The strobes on two opposite equatorial faces, flat against them.
	group.add(
		strobePair("trade", fixtures, r * 0.07, (side, position) => {
			position.set(side * face * 1.02, 0, face * 0.5);
		}),
	);
	return { group, fixtures };
}

/**
 * Trade B — Ring. Rebuilt for round two.
 *
 * Round one ranked this last and called it good: "the ring is good, but looks
 * like a comic — and maybe use more than one spoke". That is a defect report
 * rather than a preference, so the concept keeps its slot and the execution
 * changes. Three things made it cartoonish and all three are structural:
 *
 * - **The rim was fat.** A tube a quarter of the ring's own radius has the
 *   proportions of a life-belt. It is 0.13·r now against 0.24·r, which is
 *   roughly the ratio a spun habitat actually has.
 * - **Two spokes read as a prop.** Six, and they are lofted trusses that taper
 *   into the rim rather than rods that meet it at a butt joint.
 * - **Nothing had a size.** A smooth torus gives the eye no unit to judge
 *   against, so it could be ten metres across. The rim now carries repeated
 *   modules at a fixed pitch — the same trick #35's carrier uses, and the only
 *   one that works against a starfield with no ruler in it.
 */
function buildTradeRing(color: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const major = r * 0.92;
	const tube = r * 0.13;
	const rim = new THREE.Mesh(
		// 24 segments round the ring and 8 round the tube: flat-shaded, that is a
		// rim visibly built of panels rather than a moulded doughnut.
		new THREE.TorusGeometry(major, tube, 8, 24),
		hullMaterial(color, "trade"),
	);
	(rim.material as THREE.MeshStandardMaterial).flatShading = true;
	rim.name = "core";
	group.add(rim);

	// Modules at a fixed pitch round the rim: the ruler. Alternating outboard
	// and inboard, so the ring's edge is broken rather than a clean circle.
	const MODULES = 12;
	for (let i = 0; i < MODULES; i++) {
		const theta = (i / MODULES) * Math.PI * 2;
		const outward = i % 2 === 0;
		const module = shell(
			[
				{ z: 0, w: r * 0.09, h: r * 0.07, e: 6 },
				{ z: r * 0.17, w: r * 0.07, h: r * 0.055, e: 6 },
			],
			plainMaterial(outward ? 0x8b95a0 : 0x6f7d88, 0.68, 0.46),
			`module-${i}`,
			6,
			true,
		);
		module.position.set(
			Math.cos(theta) * (major + (outward ? tube * 0.8 : -tube * 0.8)),
			Math.sin(theta) * (major + (outward ? tube * 0.8 : -tube * 0.8)),
			0,
		);
		module.rotation.y = Math.PI / 2;
		module.rotation.z = outward ? theta : theta + Math.PI;
		group.add(module);
	}

	// **A-frame trusses, not radial bars.**
	//
	// Round two's first attempt ran six single square members from the hub to
	// `major` — the rim's *centreline* — with a control station in the middle.
	// Two things came out of that and both are visible from any angle: a
	// Catmull-Rom run overshoots between control stations, so the members pushed
	// through the rim and out the far side, and a lone bar between two round
	// things reads as the spoke of a steering wheel rather than as structure.
	//
	// Each spoke is a pair now, splayed from a single root on the hub to two
	// feet on the rim, which is what a real tension member looks like and gives
	// the eye a triangle to read. Two control stations per member, so there is
	// no interior to overshoot, and they stop at the rim's **inner face** rather
	// than at its centre.
	// **Four.** Six read as a bicycle wheel — the review's word for the first
	// version was "comic", and more members did not fix that, they thickened it.
	// Four A-frames is eight members, which is enough to look carried and few
	// enough that the ring's own circle stays the shape you see.
	const SPOKES = 4;
	const foot = major - tube * 0.94;
	for (let i = 0; i < SPOKES; i++) {
		const theta = (i / SPOKES) * Math.PI * 2;
		// A group per spoke, rotated about Z, with the member turned inside it.
		// Setting both angles on one object leaves the result to `Euler`'s order
		// — the members came out clustered on one side of the ring rather than
		// spaced round it, which is what composing two axes on one Euler does
		// when you are thinking of them as applied in sequence. Nested frames
		// compose in the order they are nested and there is nothing to reason
		// about.
		const arm = new THREE.Group();
		arm.rotation.z = theta;
		arm.name = `spoke-${i}`;
		group.add(arm);
		for (const splay of [-1, 1]) {
			const member = shell(
				[
					// Rooted on the hub's own surface at this spoke's angle, not at
					// the axis: six pairs sharing one apex is a bundle of wires.
					{
						z: r * 0.14,
						w: r * 0.026,
						h: r * 0.019,
						y: splay * r * 0.04,
						e: 3,
					},
					{
						z: foot,
						w: r * 0.022,
						h: r * 0.016,
						// **`y`, not `x`.** The member is rotated `Ry(π/2)` so its own
						// +Z runs radially; that same rotation sends its local +X to
						// the station's *axis*, so an `x` offset splays the pair
						// front-to-back rather than sideways and the six of them read
						// as a cone of wires from one point. Local +Y survives the
						// rotation as the tangential direction, which is the one a
						// truss actually splays along.
						y: splay * r * 0.16,
						e: 3,
					},
				],
				plainMaterial(0x6f7d88, 0.74, 0.44),
				`member-${i}${splay < 0 ? "a" : "b"}`,
				4,
				true,
			);
			member.rotation.y = Math.PI / 2;
			arm.add(member);
		}
	}
	// A brace ring at mid-radius, tying the trusses together. It is what stops
	// the web reading as twelve unrelated sticks, and it is the third repeated
	// element at a fixed pitch — another ruler.
	const brace = new THREE.Mesh(
		new THREE.TorusGeometry(major * 0.56, r * 0.016, 4, 24),
		plainMaterial(0x5f6d78, 0.8, 0.4),
	);
	brace.name = "brace";
	group.add(brace);

	// A slender hub with a real throat, rather than the lozenge round one had:
	// the dock is a *tunnel* on the axis, so it needs visible depth.
	group.add(
		shell(
			[
				// **Small.** Round two's first hub was a lozenge as wide as it was
				// long; the second was slimmer but 0.65 km end to end against a
				// 1.1 km ring — 60% of the ring's diameter, which fills the middle
				// and hides the trusses behind it. The ring is the station and the
				// hub is the thing you dock into: it is a third of that length now
				// and a seventh of the ring's radius across.
				{ z: -r * 0.26, w: r * 0.1, h: r * 0.1, e: 6 },
				{ z: -r * 0.13, w: r * 0.14, h: r * 0.14, e: 6, hard: true },
				{ z: r * 0.12, w: r * 0.14, h: r * 0.14, e: 6, hard: true },
				{ z: r * 0.2, w: r * 0.115, h: r * 0.115, e: 6, hard: true },
				{ z: r * 0.3, w: r * 0.115, h: r * 0.115, e: 6 },
			],
			plainMaterial(0x8b95a0, 0.6, 0.5),
			"hub",
			8,
			true,
		),
	);
	group.add(buildAperture("trade", r * 0.3));
	group.add(
		portRun("trade", PANE_COUNT, (i, position, normal) => {
			const theta = (i / PANE_COUNT) * Math.PI * 2;
			// On the rim's inner face, which is where a spun habitat's windows
			// look — inward, at the ring's own floor.
			normal.set(-Math.cos(theta), -Math.sin(theta), 0);
			position.set(
				Math.cos(theta) * (major - tube * 0.98),
				Math.sin(theta) * (major - tube * 0.98),
				(i % 2 === 0 ? 1 : -1) * tube * 0.35,
			);
		}),
	);
	group.add(
		strobePair("trade", fixtures, r * 0.06, (side, position) => {
			position.set(0, side * (major + tube * 1.1), 0);
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
	// On the keel's own underside, inside its half-height and inside its length.
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, position) =>
				position.set(-reach * 0.34 + i * reach * 0.23, -r * 0.3, 0),
			new THREE.Vector3(reach * 0.14, -r * 0.24, 0),
		),
	);
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

/**
 * Shipyard B — Hangar. Round two's replacement for the Cradle.
 *
 * Round one ranked the shipyard `A > C > B` and asked for "some other designs",
 * so the last slot is not a fourth open frame. Every shipyard form so far is a
 * *skeleton* — a cage, a broken ring — and reads as scaffolding round an empty
 * volume. This one is the opposite silhouette class: a closed slab with a lit
 * mouth cut into its flank, so the ships are inside rather than clamped
 * outside. What it borrows is a carrier's bay, which is also the one shape in
 * #35's pool that answers "how big is that" at range, because you can see a
 * hole a ship fits through.
 */
function buildShipyardHangar(color: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const reach = 2.14;
	const frame = new THREE.Group();
	frame.name = "frame";
	group.add(frame);

	// The slab: long, rectangular in section, with a chamfer at each end.
	const slab = shell(
		[
			{ z: -reach * 0.56, w: r * 0.34, h: r * 0.5, e: 5 },
			{ z: -reach * 0.44, w: r * 0.5, h: r * 0.72, e: 7, hard: true },
			{ z: reach * 0.4, w: r * 0.5, h: r * 0.72, e: 7, hard: true },
			{ z: reach * 0.54, w: r * 0.32, h: r * 0.48, e: 5 },
		],
		hullMaterial(color, "shipyard"),
		"slab",
		8,
		true,
	);
	slab.rotation.y = Math.PI / 2;
	frame.add(slab);

	// The bay mouth: a recess cut into the flank, floodlit from inside. Its own
	// size is the ruler — it is obviously a hole a ship goes through.
	//
	// **It is a construction slip, not the dock**, and the shape must not be
	// allowed to imply otherwise. Measured, the mouth is 1070 × 264 × 144 m
	// against a pool whose largest ordinary hull is 74 × 54 × 47 m: fifteen of
	// them nose to tail, three or four abreast. That is deliberate — a shipyard
	// should visibly hold ships — but the *player* docks at the hub, through the
	// 200 × 70 m slot on the spin axis, because `docking.md` §4 puts the slot on
	// that axis and #28 keeps the outboard structure still. A pad in this bay
	// would be a second docking geometry the checks do not read.
	const mouth = new THREE.Mesh(
		new THREE.BoxGeometry(reach * 0.5, r * 0.44, r * 0.24),
		new THREE.MeshBasicMaterial({ color: 0x05070a }),
	);
	mouth.position.set(0, 0, r * 0.42);
	mouth.name = "bay-mouth";
	frame.add(mouth);
	for (const side of [-1, 1]) {
		const lip = shell(
			[
				{ z: -reach * 0.25, w: r * 0.06, h: r * 0.05, e: 5 },
				{ z: reach * 0.25, w: r * 0.06, h: r * 0.05, e: 5 },
			],
			plainMaterial(0x8b95a0, 0.66, 0.46),
			"lip",
			6,
			true,
		);
		lip.rotation.y = Math.PI / 2;
		lip.position.set(0, side * r * 0.26, r * 0.5);
		frame.add(lip);
	}
	// Rib frames at a fixed pitch down the flank — the second ruler, and what
	// keeps a long smooth slab from reading as a small smooth box.
	for (let i = 0; i < 9; i++) {
		const rib = new THREE.Mesh(
			new THREE.BoxGeometry(r * 0.03, r * 0.76, r * 0.54),
			plainMaterial(0x6f7d88, 0.78, 0.42),
		);
		rib.position.set(-reach * 0.42 + (i / 8) * reach * 0.84, 0, 0);
		frame.add(rib);
	}

	// The hub that turns, on the slab's spine. Compact, for the reason the
	// Gantry's is: the slot sits on the spin axis, so whatever turns sweeps its
	// own outline round it.
	const hub = shell(
		[
			{ z: -r * 0.3, w: r * 0.34, h: r * 0.34, e: 8 },
			{ z: r * 0.24, w: r * 0.42, h: r * 0.42, e: 8, hard: true },
			{ z: r * 0.6, w: r * 0.32, h: r * 0.32, e: 8 },
		],
		hullMaterial(color, "shipyard"),
		"core",
		4,
		true,
	);
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(hub);
	spun.add(buildAperture("shipyard", r * 0.6));
	group.add(spun);

	// Inside the bay mouth, which is where a bay's floods are.
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, position) =>
				position.set(-reach * 0.2 + i * reach * 0.13, r * 0.2, r * 0.4),
			new THREE.Vector3(reach * 0.1, -r * 0.18, r * 0.4),
		),
	);
	group.add(
		portRun("shipyard", 16, (i, position, normal) => {
			normal.set(0, 0, -1);
			position.set(
				-reach * 0.34 + (i % 8) * reach * 0.1,
				(i < 8 ? -1 : 1) * r * 0.24,
				-r * 0.5,
			);
		}),
	);
	group.add(
		strobePair("shipyard", fixtures, r * 0.07, (side, position) => {
			// Inside the slab's own half-length (`reach * 0.54`), not on it: at
			// 0.55 one of the pair sat clear of the hull it is mounted on.
			position.set(side * reach * 0.5, 0, r * 0.36);
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
	// On the arc's inner face, looking into the slip.
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, position) => {
				const theta = Math.PI * 0.3 + (i / 3) * Math.PI * 1.35;
				position.set(
					Math.cos(theta) * major * 0.86,
					Math.sin(theta) * major * 0.86,
					0,
				);
			},
			new THREE.Vector3(major * 0.86, 0, 0),
		),
	);
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

/**
 * The shipyard's work light: cold floods along the bay and one welding arc.
 *
 * Shared by all three forms, because the light is what says *shipyard* once the
 * outline has told you it is not a trade station — but **placed by the caller**,
 * because the three have nothing in common to hang it on. A single hard-coded
 * row put two of the Gantry's floods in empty space beside the keel and would
 * have buried the Hangar's inside a slab. A fixture's position is a property of
 * the structure it is mounted on, so the structure supplies it.
 */
function buildBayLights(
	fixtures: StationFixture[],
	r: number,
	place: (i: number, position: THREE.Vector3) => void,
	arcAt: THREE.Vector3,
): THREE.Group {
	const group = new THREE.Group();
	for (let i = 0; i < 4; i++) {
		const flood = new THREE.Mesh(
			new THREE.BoxGeometry(r * 0.26, r * 0.03, r * 0.06),
			FLOOD_MATERIAL,
		);
		place(i, flood.position);
		flood.name = "bay-flood";
		detail(flood, "reduced");
		group.add(flood);
	}
	const arcMaterial = emissiveMaterial(STATION_VISUALS.shipyard.floodColor, 0);
	const arc = new THREE.Mesh(
		new THREE.SphereGeometry(r * 0.05, 8, 6),
		arcMaterial,
	);
	arc.position.copy(arcAt);
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

/**
 * Refinery A — Warren. A cut face sliced into the rock, with terraced plant
 * inside it and the pad at the bottom of the cut.
 *
 * The plant is *inside* the asteroid rather than bolted onto it, which is the
 * round-one review's instruction: structure built into the rock. What the eye
 * gets is a machined notch in something that is otherwise plainly a rock.
 */
function buildRefineryWarren(color: number): BuiltPart {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	// The cut the terraces sit in. Its ceiling is below where the machined half
	// starts (`r * 0.5`), so the plant stands on the bench rather than in it.
	group.add(
		buildAsteroid(r * 1.24, "refinery-warren", {
			radiusKm: r * 0.95,
			ceilingKm: r * 0.42,
		}),
	);

	// The cut: three terraces stepping down toward +Z, each a flat plated slab
	// sunk into the rock face. Squared sections, so the machined half cannot be
	// mistaken for more rock.
	for (let i = 0; i < 3; i++) {
		const w = r * (0.78 - i * 0.16);
		const terrace = shell(
			[
				{ z: r * (0.5 + i * 0.16), w, h: w * 0.86, e: 8 },
				{ z: r * (0.62 + i * 0.16), w: w * 0.95, h: w * 0.82, e: 8 },
			],
			hullMaterial(color, "refinery"),
			i === 1 ? "core" : `terrace-${i}`,
			8,
			true,
		);
		group.add(terrace);
	}
	group.add(buildAperture("refinery", r * 0.99));

	// **Stacks canted outward, not laid back.** Viewed down the aperture axis —
	// the one view a docking approach has — a rock with an inlaid cut is still a
	// rounded lump, and `probe-station.mjs` measured this against the trade
	// station's drum at 1 − IoU 0.216 on a 0.25 floor. §7 rests identity on
	// outline, so the machined half has to reach *into that view* rather than
	// sit flush in it.
	for (const [x, y, lean] of [
		[r * 0.72, r * 0.5, 0.55],
		[-r * 0.6, r * 0.66, -0.7],
	]) {
		const flare = buildFlare(fixtures, r * 1.05, r * 0.07);
		flare.position.set(x, y, r * 0.36);
		flare.rotation.x = -Math.PI / 2.6;
		flare.rotation.y = lean;
		group.add(flare);
	}
	// A cantilevered loading arm off the cut, which is the other thing the
	// silhouette gains: something obviously built sticking out of something
	// obviously not.
	const arm = shell(
		[
			{ z: 0, w: r * 0.12, h: r * 0.1, e: 6 },
			{ z: r * 0.72, w: r * 0.08, h: r * 0.07, e: 6, hard: true },
			{ z: r * 0.95, w: r * 0.2, h: r * 0.08, e: 6 },
		],
		plainMaterial(0x8b95a0, 0.68, 0.44),
		"loading-arm",
		6,
		true,
	);
	arm.rotation.y = Math.PI / 2.3;
	arm.position.set(-r * 0.35, -r * 0.5, r * 0.5);
	group.add(arm);
	group.add(buildHeatRing(fixtures, r * 0.5, r * 0.98));
	group.add(
		portRun("refinery", 12, (i, position, normal) => {
			// Down the terraced face, in two columns, so the cut reads as having
			// levels rather than as one lit slab.
			normal.set(0, 0, 1);
			position.set(
				(i % 2 === 0 ? -1 : 1) * r * 0.5,
				r * 0.34 - Math.floor(i / 2) * r * 0.14,
				r * (0.66 + Math.floor(i / 2) * 0.06),
			);
		}),
	);
	return { group, fixtures };
}

/**
 * Refinery B — Collar. The rock gripped at its waist by a machined band that
 * carries the whole plant, with the pad on the band's face.
 *
 * The band is the same swept language as a hull and wraps a body that is not
 * one, which is the contrast the role is about. Unlike the Warren, the plant is
 * visible from every angle rather than only from the cut.
 */
function buildRefineryCollar(color: number): BuiltPart {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	group.add(
		buildAsteroid(r * 1.16, "refinery-collar", {
			radiusKm: r * 0.85,
			ceilingKm: r * 0.42,
		}),
	);

	// **Clear of the rock's own crests.** The displacement reaches about 1.15×
	// its nominal radius, so a band at 1.1·r with a 0.16·r tube had its inner
	// face at 0.94·r — buried for most of its circumference, with only the outer
	// rim showing through. A collar has to *grip* the rock, which means sitting
	// on the outside of it, so both radii are derived from the rock rather than
	// chosen beside it.
	const rockRadius = r * 1.16;
	const crest = rockRadius * 1.15;
	const tube = r * 0.15;
	const major = crest + tube * 0.55;
	const band = new THREE.Mesh(
		new THREE.TorusGeometry(major, tube, 6, 20),
		hullMaterial(color, "refinery"),
	);
	band.name = "core";
	group.add(band);
	// Clamps: short lofted blocks pinning the band to the rock, so the two read
	// as *held together* rather than as one shape passing through the other.
	//
	// Nested in a group per angle rather than carrying two Euler rotations, for
	// the ring spokes' reason: two angles on one object leaves the result to
	// `Euler`'s order, and the members come out clustered instead of spaced.
	for (let i = 0; i < 5; i++) {
		const arm = new THREE.Group();
		arm.rotation.z = (i / 5) * Math.PI * 2;
		arm.name = `clamp-${i}`;
		group.add(arm);
		const clamp = shell(
			[
				{ z: rockRadius * 0.8, w: r * 0.15, h: r * 0.13, e: 6 },
				{ z: major + tube * 0.4, w: r * 0.11, h: r * 0.1, e: 6 },
			],
			plainMaterial(0x8b95a0, 0.66, 0.46),
			"clamp",
			6,
			true,
		);
		clamp.rotation.y = Math.PI / 2;
		arm.add(clamp);
	}
	// The pad is on a plated boss over the rock's +Z pole, fed from the band.
	group.add(
		shell(
			[
				{ z: r * 0.5, w: r * 0.5, h: r * 0.5, e: 6 },
				{ z: r * 0.88, w: r * 0.42, h: r * 0.42, e: 6, hard: true },
				{ z: r * 1.0, w: r * 0.34, h: r * 0.34, e: 6 },
			],
			hullMaterial(color, "refinery"),
			"boss",
			8,
			true,
		),
	);
	group.add(buildAperture("refinery", r * 1.0));
	for (const side of [-1, 1]) {
		const flare = buildFlare(fixtures, r * 0.9, r * 0.07);
		flare.position.set(side * major * 0.74, r * 0.35, 0);
		flare.rotation.x = -Math.PI / 2.6;
		flare.rotation.z = side * 0.35;
		group.add(flare);
	}
	group.add(buildHeatRing(fixtures, r * 0.44, r * 0.99));
	group.add(
		portRun("refinery", 12, (i, position, normal) => {
			const theta = (i / 12) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			// On the band's own outer face, derived from it rather than guessed:
			// a fixed 1.22·r sat inside the rock once the band moved out.
			position.copy(normal).multiplyScalar(major + tube * 0.9);
			position.z = 0;
		}),
	);
	return { group, fixtures };
}

/**
 * Refinery C — Spar. The rock run through by a processing spar that comes out
 * the far side, tanks strung along it, the pad on the near end.
 *
 * The one form of the three whose axis is longer than the rock, and the only
 * one where the machinery *pierces* rather than wraps or inlays. Its silhouette
 * is a rock with a shaft through it, which nothing else in the pool is.
 */
function buildRefinerySpar(color: number): BuiltPart {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	// Carved like the other two even though the spar already clears the rock:
	// the invariant is the form's, not this build's, and a later tweak to the
	// spar's length should not be able to reintroduce rock in the corridor.
	group.add(
		buildAsteroid(r * 1.05, "refinery-spar", {
			radiusKm: r * 0.55,
			ceilingKm: r * 0.6,
		}),
	);

	group.add(
		shell(
			[
				{ z: -r * 1.7, w: r * 0.2, h: r * 0.2, e: 6 },
				{ z: -r * 1.3, w: r * 0.3, h: r * 0.3, e: 6, hard: true },
				{ z: r * 0.9, w: r * 0.3, h: r * 0.3, e: 6, hard: true },
				{ z: r * 1.22, w: r * 0.4, h: r * 0.4, e: 6 },
			],
			hullMaterial(color, "refinery"),
			"core",
			8,
			true,
		),
	);
	group.add(buildAperture("refinery", r * 1.22));
	// Tanks strung along the exposed length, off-axis so the spar does not read
	// as a smooth rod.
	for (let i = 0; i < 3; i++) {
		const tank = shell(
			[
				{ z: -r * 0.24, w: r * 0.19, h: r * 0.19, e: 2.4 },
				{ z: r * 0.24, w: r * 0.19, h: r * 0.19, e: 2.4 },
			],
			plainMaterial(0xb2a894, 0.85, 0.16),
			`tank-${i}`,
			10,
			true,
		);
		const theta = (i / 3) * Math.PI * 2;
		tank.position.set(
			Math.cos(theta) * r * 0.42,
			Math.sin(theta) * r * 0.42,
			-r * 1.42 + i * r * 0.06,
		);
		group.add(tank);
	}
	for (const side of [-1, 1]) {
		const flare = buildFlare(fixtures, r * 0.85, r * 0.07);
		flare.position.set(side * r * 0.34, r * 0.3, -r * 1.5);
		flare.rotation.x = -Math.PI / 2.3;
		flare.rotation.z = side * 0.3;
		group.add(flare);
	}
	group.add(buildHeatRing(fixtures, r * 0.42, r * 1.2));
	group.add(
		portRun("refinery", 10, (i, position, normal) => {
			const theta = (i / 10) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(r * 0.32);
			position.z = -r * 1.15;
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

// ---------------------------------------------------------------------------
// The outposts (#56 round two)
// ---------------------------------------------------------------------------
//
// A fourth category, asked for as "smaller structures, non-rotating, look like
// industrial structures with just a landing pad". All three are a *machine with
// a deck on it* rather than a place anyone lives: no spun habitat, no window
// bands, and the pad is the largest flat thing on them.
//
// They carry no strobes, for the refinery's reason: nothing here turns.

/** A small floodlit pad deck on the +Z face, with its own coaming. Shared by
 *  every outpost form, because the pad is what the category *is* — the rest of
 *  each form is the machine that justifies one. */
function buildPadDeck(
	fixtures: StationFixture[],
	r: number,
	z: number,
): THREE.Group {
	const group = new THREE.Group();
	const deck = shell(
		[
			{ z: z - r * 0.16, w: r * 0.95, h: r * 0.95, e: 8 },
			{ z, w: r * 0.9, h: r * 0.9, e: 8 },
		],
		plainMaterial(0x8b95a0, 0.7, 0.42),
		"pad-deck",
		4,
		true,
	);
	group.add(deck);
	group.add(buildAperture("outpost", z));
	// Four floods on the coaming, and one warm heat lamp that breathes: the only
	// motion an outpost has, and it says the machine is running rather than
	// anything about clearance (§5.1).
	for (let i = 0; i < 4; i++) {
		const theta = (i / 4) * Math.PI * 2 + Math.PI / 4;
		const flood = new THREE.Mesh(
			new THREE.BoxGeometry(r * 0.16, r * 0.05, r * 0.05),
			FLOOD_MATERIAL,
		);
		flood.position.set(
			Math.cos(theta) * r * 0.82,
			Math.sin(theta) * r * 0.82,
			z + r * 0.02,
		);
		flood.rotation.z = theta;
		flood.name = "bay-flood";
		detail(flood, "reduced");
		group.add(flood);
	}
	group.add(buildHeatRing(fixtures, r * 0.62, z + r * 0.03));
	return group;
}

/** Outpost A — Derrick. A lattice tower standing on a tank cluster, with the
 *  pad deck on top. The tallest thing in the category and the one whose
 *  proportions are a *tower* rather than a box. */
function buildOutpostDerrick(color: number): BuiltPart {
	const r = STATION_GEOMETRY.outpost.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	// The tank cluster at the foot.
	for (let i = 0; i < 4; i++) {
		const theta = (i / 4) * Math.PI * 2;
		const tank = shell(
			[
				{ z: -r * 1.9, w: r * 0.34, h: r * 0.34, e: 2.4 },
				{ z: -r * 1.1, w: r * 0.34, h: r * 0.34, e: 2.4 },
			],
			i === 0
				? hullMaterial(color, "outpost")
				: plainMaterial(0xb2a894, 0.88, 0.18),
			i === 0 ? "core" : `tank-${i}`,
			8,
			true,
		);
		tank.position.set(
			Math.cos(theta) * r * 0.42,
			Math.sin(theta) * r * 0.42,
			0,
		);
		group.add(tank);
	}
	// The tower: four legs and three collars, which is a lattice at this size —
	// a truss of individual members would be pixels nobody resolves.
	for (let i = 0; i < 4; i++) {
		const theta = (i / 4) * Math.PI * 2 + Math.PI / 4;
		const leg = shell(
			[
				{ z: -r * 1.2, w: r * 0.08, h: r * 0.08, x: r * 0.46, e: 4 },
				{ z: r * 0.9, w: r * 0.06, h: r * 0.06, x: r * 0.28, e: 4 },
			],
			plainMaterial(0x6f7d88, 0.8, 0.4),
			`leg-${i}`,
			4,
			true,
		);
		leg.rotation.z = theta;
		group.add(leg);
	}
	for (const z of [-r * 0.8, -r * 0.1, r * 0.6]) {
		const collar = new THREE.Mesh(
			new THREE.TorusGeometry(r * (z < 0 ? 0.46 : 0.34), r * 0.035, 4, 8),
			plainMaterial(0x6f7d88, 0.8, 0.4),
		);
		collar.position.z = z;
		group.add(collar);
	}
	group.add(buildPadDeck(fixtures, r, r * 1.1));
	// Rooted **on a tank**, not beside the cluster: the tanks sit on a 0.42·r
	// circle and are 0.34·r across, so a boom starting at 0.6·r began in empty
	// space and the whole flare was a detached island.
	const flare = buildFlare(fixtures, r * 0.9, r * 0.08);
	flare.position.set(r * 0.42, -r * 0.42, -r * 1.3);
	flare.rotation.x = -Math.PI / 2.4;
	flare.rotation.y = 0.5;
	group.add(flare);
	group.add(
		portRun("outpost", 6, (i, position, normal) => {
			normal.set(0, 0, 1);
			position.set(
				(i % 3) * r * 0.3 - r * 0.3,
				i < 3 ? r * 0.32 : -r * 0.32,
				-r * 1.09,
			);
		}),
	);
	return { group, fixtures };
}

/** Outpost B — Buoy. A stubby drum wearing radiator fins, pad on the face.
 *  The category's compact end: a single machine with nothing hanging off it,
 *  which is what a relay or a survey station would actually be. */
function buildOutpostBuoy(color: number): BuiltPart {
	const r = STATION_GEOMETRY.outpost.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	group.add(
		shell(
			[
				{ z: -r * 1.5, w: r * 0.5, h: r * 0.5, e: 6 },
				{ z: -r * 1.1, w: r * 0.86, h: r * 0.86, e: 6, hard: true },
				{ z: r * 0.5, w: r * 0.86, h: r * 0.86, e: 6, hard: true },
				{ z: r * 0.86, w: r * 0.66, h: r * 0.66, e: 6 },
			],
			hullMaterial(color, "outpost"),
			"core",
			6,
			true,
		),
	);
	// Radiator fins: flat plates, the one feature that reads as *thermal plant*
	// and the reason this is not simply a barrel.
	for (let i = 0; i < 3; i++) {
		const theta = (i / 3) * Math.PI * 2;
		const fin = new THREE.Mesh(
			new THREE.BoxGeometry(r * 1.5, r * 0.05, r * 1.1),
			plainMaterial(0x5f6d78, 0.84, 0.34),
		);
		fin.position.set(
			Math.cos(theta) * r * 1.1,
			Math.sin(theta) * r * 1.1,
			-r * 0.4,
		);
		fin.rotation.z = theta;
		fin.name = `fin-${i}`;
		group.add(fin);
	}
	group.add(buildPadDeck(fixtures, r, r * 1.0));
	group.add(
		portRun("outpost", 6, (i, position, normal) => {
			const theta = (i / 6) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(r * 0.88);
			position.z = -r * 0.3;
		}),
	);
	return { group, fixtures };
}

/** Outpost C — Rig. An angled truss carrying a deck out over a drill head, a
 *  flare boom off the back. The one form of the three that is plainly working
 *  *on* something rather than sitting in space. */
function buildOutpostRig(color: number): BuiltPart {
	const r = STATION_GEOMETRY.outpost.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const body = shell(
		[
			{ z: -r * 1.6, w: r * 0.3, h: r * 0.42, e: 6 },
			{ z: -r * 1.0, w: r * 0.62, h: r * 0.8, e: 7, hard: true },
			{ z: r * 0.4, w: r * 0.62, h: r * 0.8, e: 7, hard: true },
			{ z: r * 0.75, w: r * 0.44, h: r * 0.58, e: 6 },
		],
		hullMaterial(color, "outpost"),
		"core",
		6,
		true,
	);
	body.rotation.x = 0.34;
	group.add(body);
	// The drill head below, and the two braces that hold it out.
	const head = shell(
		[
			{ z: -r * 0.5, w: r * 0.26, h: r * 0.26, e: 4 },
			{ z: r * 0.2, w: r * 0.16, h: r * 0.16, e: 4, hard: true },
			{ z: r * 0.6, w: r * 0.05, h: r * 0.05, e: 4 },
		],
		plainMaterial(0x8b95a0, 0.7, 0.42),
		"drill",
		6,
		true,
	);
	head.rotation.x = Math.PI / 2;
	head.position.set(0, -r * 1.5, -r * 0.4);
	group.add(head);
	for (const side of [-1, 1]) {
		const brace = shell(
			[
				{ z: 0, w: r * 0.07, h: r * 0.06, e: 4 },
				{ z: r * 1.25, w: r * 0.05, h: r * 0.04, e: 4 },
			],
			plainMaterial(0x6f7d88, 0.8, 0.4),
			"brace",
			4,
			true,
		);
		brace.rotation.x = Math.PI / 2;
		brace.position.set(side * r * 0.4, -r * 0.3, -r * 0.4);
		group.add(brace);
	}
	group.add(buildPadDeck(fixtures, r, r * 0.95));
	const flare = buildFlare(fixtures, r * 1.0, r * 0.08);
	flare.position.set(-r * 0.55, r * 0.75, -r * 1.1);
	flare.rotation.x = -Math.PI / 2.2;
	flare.rotation.y = -0.5;
	group.add(flare);
	group.add(
		portRun("outpost", 6, (i, position, normal) => {
			// The body is pitched 0.34 rad about X and is 0.62·r half-wide, so a
			// run at 0.64·r cleared it entirely. Inside its own beam, and pitched
			// with it.
			normal.set(1, 0, 0);
			const z = -r * 0.7 + i * r * 0.2;
			position.set(r * 0.5, r * 0.2 + z * 0.34, z);
		}),
	);
	return { group, fixtures };
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
			thesis: "cuboctahedron — the slot is cut into a real flat square face",
			reachKm: 0.62,
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
			name: "Hangar",
			thesis:
				"a closed slab with a floodlit bay mouth; ships inside, not clamped outside",
			reachKm: 1.5,
			build: buildShipyardHangar,
		},
		{
			id: "c",
			name: "Slipway",
			thesis: "a broken ring with the gap as the slip",
			reachKm: 1.5,
			build: buildShipyardSlipway,
		},
	],
	outpost: [
		{
			id: "a",
			name: "Derrick",
			thesis: "a lattice tower on a tank cluster, pad deck on top",
			reachKm: 0.42,
			build: buildOutpostDerrick,
		},
		{
			id: "b",
			name: "Buoy",
			thesis: "a stubby drum wearing radiator fins; nothing hangs off it",
			reachKm: 0.42,
			build: buildOutpostBuoy,
		},
		{
			id: "c",
			name: "Rig",
			thesis: "an angled truss holding a deck out over a drill head",
			reachKm: 0.42,
			build: buildOutpostRig,
		},
	],
	refinery: [
		{
			id: "a",
			name: "Warren",
			thesis: "terraced plant cut into the rock; the pad is in the notch",
			reachKm: 0.92,
			build: buildRefineryWarren,
		},
		{
			id: "b",
			name: "Collar",
			thesis: "a machined band gripping the rock at its waist",
			reachKm: 0.85,
			build: buildRefineryCollar,
		},
		{
			id: "c",
			name: "Spar",
			thesis: "a processing spar run through the rock and out the far side",
			reachKm: 0.9,
			build: buildRefinerySpar,
		},
	],
};

/**
 * Which form each role is currently built with in the game.
 *
 * One line per role, so a ranking round changes three lines.
 *
 * Round one's ranking put `A` first for both trade and shipyard, so those two
 * are choices rather than placeholders. The refinery's is a placeholder and
 * says so: that role was not ranked — it was sent back with an instruction —
 * so its three forms are all round two's and none of them has been looked at
 * yet. Pretending otherwise is how a placeholder becomes the shipped answer.
 */
export const SELECTED_FORM: Record<StationType, StationFormId> = {
	trade: "a",
	shipyard: "a",
	// **Warren, and chosen by a measurement rather than by order.** The pairing
	// that matters is this form against the *trade* station, because those are
	// the two the identity floor keeps failing on, and it moved when the trade
	// station did. Against round two's swept drum the Warren measured 1 − IoU
	// 0.224 on a 0.25 floor and the Collar was picked instead; against the
	// cuboctahedron the Warren clears the floor and the Spar is the one that
	// does not, at 0.244. A selection made once and left alone would have been
	// wrong twice. Still a placeholder until the role is ranked — but a
	// placeholder that passes the gate §7 rests identity on.
	refinery: "a",
	// Unranked, like the refinery's was: three new forms and nobody has looked
	// at them. It changes nothing in a running game either way — `system.ts`
	// places no outposts, because what one sells and how often one exists are
	// #13's and #6's questions rather than this round's.
	outpost: "a",
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
