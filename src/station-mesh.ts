/**
 * The three silhouettes (`station-types.md` §7), built procedurally at load.
 *
 * §7's standard is the one this module is written against: **a player tells the
 * types apart by outline, before colour and before any detail resolves.** So
 * the forms differ in gross form rather than in panelling or emissive trim,
 * which resolve at medium range and vanish at scanner range. `STATION_COLORS`
 * (`sim.ts`) stays the secondary cue.
 *
 * **Four roles, three forms each** (#56). #28 gave each role one silhouette;
 * those were reviewed in the live game and rejected on form, and the pool that
 * replaced them is built in the swept-loft language of #35's ship hulls.
 * `SELECTED_FORM` names the one the game builds for each role — one line per
 * role, so a later choice is one edit.
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
import { EMISSIVE_CEILING } from "./light-rig";
import { appendRing, cutRing, ringTriangles } from "./face-cut";
import { type ApertureCut, type Ring, boxProjectUVs, hullLoft } from "./loft";
import {
	applyRockSurface,
	buildAsteroid,
	displayRand,
} from "./station-surface";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationAperture,
	type StationType,
} from "./station";
import { type GreebleZone, buildGreebles } from "./station-greebles";
import {
	Pools,
	buildMacroFixtures,
	mast,
	radiatorArray,
	tankRack,
	truss,
} from "./station-fixtures";
import {
	DISH,
	HUB,
	MODULAR_RADIUS,
	NODE,
	type Placement,
	RADIATOR,
	TANKS,
	TRUSS_X,
	TRUSS_Y,
	TUBE_X,
	TUBE_Y,
	modularPlacements,
} from "./station-modular";
import { DIRECTIONS } from "./wfc";
import {
	STATION_QUALITY,
	STATION_VISUALS,
	type StationQuality,
	type StationDetailLevel,
	type StationFixtureKind,
	currentStationFinish,
	fixtureIntensity,
	flickerIntensity,
	platingTexels,
	seamTexels,
	stationDetailLevel,
	stationFinishId,
	stationMapSize,
	surfaceTexels,
} from "./station-visuals";
import {
	NAMEPLATE_NAME,
	buildStationInterior,
	ringAround,
} from "./station-interior-mesh";
import { stationInterior } from "./station-interior";
import { disposeSubtree, isShared, shared } from "./gpu-teardown";

/**
 * How far the *drawn* object reaches, kilometres — the selected form's own
 * declared reach: an outboard frame, a captured asteroid, a radiator wing.
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
 * **It is now an intention, and it used to be a measurement.** #28 wrote four
 * literals here and warned that reading them as design constraints would be
 * reading a measurement as an intention: the shipyard's 1.5 km came from
 * `docking.md` §5 and its test could fail against the spec, but the refinery's
 * 0.9 was a ratchet set from what the mesh happened to measure. That warning
 * does not survive #56 and has been removed rather than left to mislead.
 *
 * Every figure is now a **declared** `reachKm` on a form — a number an author
 * chose before building the shape, which the form is then measured against.
 * That is the direction a budget should run. What the test does *not* do is
 * insist the shape fills its declaration: the floor is 60% of it, which catches
 * a declaration nothing approaches without pretending the fit is tight.
 */
const reachCache: Partial<Record<StationType, number>> = {};

export const STATION_SILHOUETTE_KM: Record<StationType, number> =
	Object.defineProperties(
		{} as Record<StationType, number>,
		Object.fromEntries(
			STATION_TYPES.map((type) => [
				type,
				{
					enumerable: true,
					// A memoised getter, not a value: `SELECTED_FORM` is a module
					// constant so the lookup resolves once, but `STATION_FORMS` and
					// `formOf` are declared further down the file and evaluating
					// eagerly here reads them before initialisation. Left as a bare
					// `find` it ran on every read, and the renderer reads this per
					// station per frame.
					get: () =>
						(reachCache[type] ??= formOf(type, SELECTED_FORM[type]).reachKm),
				},
			]),
		),
	);

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
	/**
	 * E9's name shields — the mouth plate and, on a slot, the one inside the
	 * throat.
	 *
	 * Geometry only. **This module supplies no pixels** (E10): it is
	 * headless-tested with no `document` reference at all, so the renderer
	 * assigns each plate's `map` and turns its opacity up. The handle carries
	 * them for the same reason it carries `fixtures` — they are the parts that
	 * are written to after construction.
	 */
	nameplates: THREE.Mesh[];
	/**
	 * The instanced greeble meshes, so #98's quality key can reach them (#102 §5).
	 *
	 * **A second owner of `visible`, deliberately, and on a different object.**
	 * The detail band owns the greeble *group*; the quality key owns the
	 * instanced meshes inside it. Sharing one object would make one of the two
	 * settings a no-op depending on which ran last, and the symptom — clutter
	 * that comes back when you fly closer with the setting on low — would read
	 * as a band bug rather than as a gate that lost.
	 *
	 * Collected at build for `accessories`' reason: the set is known then, and
	 * walking the graph every frame to find three meshes is a graph walk per
	 * station per frame.
	 */
	greebles: THREE.InstancedMesh[];
	/**
	 * Free everything this station owns, and nothing it shares (#187).
	 *
	 * **Nothing called it until hyperspace existed**, which is the same fact
	 * `planet-surface.ts` records about its own: a `Game` built its stations
	 * once and drew them for the session. A jump builds a new system's, so the
	 * old one's per-station geometry — every form here is lofted per call — its
	 * fixture materials, its nameplate texture and its greeble instance
	 * matrices have to go.
	 *
	 * What it must **not** free is the plating maps (one pair per role), the
	 * hull materials (one per type and colour), `PANE_GEOMETRY` and
	 * `GREEBLE_PRIMITIVES`: all four are shared with every station in every
	 * system, and freeing them renders the next system's stations black rather
	 * than throwing. They are marked at construction with `shared()` and
	 * `tests/gpu-teardown.test.ts` asserts the disjointness rather than
	 * trusting the marks.
	 */
	dispose(): void;
}

/** One clock-driven light. `base` is its lit intensity; the waveform scales it. */
export interface StationFixture {
	material: THREE.MeshStandardMaterial;
	base: number;
	kind: StationFixtureKind;
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
	// The finish's size, not `PLATE_TEXTURE_SIZE`: an industrial finish doubles
	// the map with its tile so a second octave has room (#202).
	const size = stationMapSize();
	// Generated once and handed to both textures: `surfaceTexels` derives its
	// wear from the albedo, so regenerating it would run the plating loop twice
	// per role and leave two buffers that only happen to agree.
	const plate = platingTexels(type, size);
	const albedo = new THREE.DataTexture(plate, size, size, THREE.RGBAFormat);
	const wear = new THREE.DataTexture(
		surfaceTexels(type, size, plate),
		size,
		size,
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
		// Shared by every station of this role, in this system and in every
		// system after a jump — so a teardown must not free it (#187).
		shared(map);
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
	// The embossed seam, where the finish cuts one (#202). **Linear**, unlike
	// the two above: `ship-surface.ts` records that a nearest-sampled normal
	// bands in the highlight rather than stepping at a hard edge.
	const seamBytes = seamTexels(type, size);
	let seams: THREE.Texture | null = null;
	if (seamBytes) {
		seams = new THREE.DataTexture(seamBytes, size, size, THREE.RGBAFormat);
		shared(seams);
		seams.wrapS = THREE.RepeatWrapping;
		seams.wrapT = THREE.RepeatWrapping;
		seams.magFilter = THREE.LinearFilter;
		seams.minFilter = THREE.LinearMipmapLinearFilter;
		seams.generateMipmaps = true;
		seams.needsUpdate = true;
	}
	return { albedo, wear, seams };
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
const surfaceMapCache = new Map<string, ReturnType<typeof surfaceMaps>>();
const mapsFor = (type: StationType) => {
	// Keyed by the finish as well as the role, so a switch on the workbench
	// builds the other finish's maps rather than handing back the first's; the
	// game only ever fills one key per role.
	const key = `${stationFinishId()}:${type}`;
	const cached = surfaceMapCache.get(key);
	if (cached) return cached;
	const built = surfaceMaps(type);
	surfaceMapCache.set(key, built);
	return built;
};

/** The world size of one plating tile under the finish in force — the stock
 *  `STATION_PANEL_KM` times the finish's tile multiple, so a doubled map keeps
 *  the same nineteen-metre plate. */
const stationPanelKm = () => STATION_PANEL_KM * currentStationFinish().tile;

/**
 * A painted hull carrying its role's plating.
 *
 * `type` decides the surface and `color` decides the paint — the two cues are
 * deliberately separate, because §7 rests identity on outline with colour as the
 * secondary cue, and a per-role *coloured* map would quietly become a third.
 */
/**
 * One painted hull material per (type, colour), kept.
 *
 * A station used to build its own, so three trade stations in a system carried
 * three identical materials and the workbench accumulated one more on every
 * rebuild. Sharing them is safe because nothing mutates a hull material after
 * construction — the ones that *are* mutated are the fixtures, which stay per
 * station for exactly that reason and carry no textures.
 */
const hullMaterials = new Map<string, THREE.MeshStandardMaterial>();

const hullMaterial = (color: number, type: StationType) => {
	const cacheKey = `${stationFinishId()}:${type}:${color}`;
	const cached = hullMaterials.get(cacheKey);
	if (cached) return cached;
	const { albedo, wear, seams } = mapsFor(type);
	const material = new THREE.MeshStandardMaterial({
		color,
		map: albedo,
		roughnessMap: wear,
		metalnessMap: wear,
		// The cut seam, on the finishes that cut one (#202); `null` leaves the
		// stock material exactly as it was, with no tangent frame in its program.
		normalMap: seams,
		normalScale: new THREE.Vector2(1, 1),
		// Multiplied by the map's green and blue channels, so these are the
		// ceilings rather than the values. Left at 1 the map would be the whole
		// answer and the profile's figures would be decoration.
		roughness: 1,
		metalness: 1,
	});
	// Kept across systems as well as across stations — the cache is keyed on
	// (type, colour) and nothing in it is per-system, so a jump's teardown
	// leaves it alone (#187).
	shared(material);
	hullMaterials.set(cacheKey, material);
	return material;
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
 * Every station-authored emissive, as a fraction of the scene-wide ceiling.
 * Exported as the test surface; material call sites read this record rather
 * than carrying numbers the exposure budget cannot enumerate.
 */
export const STATION_EMISSIVE_INTENSITIES = {
	off: EMISSIVE_CEILING * 0,
	tradeWindow: EMISSIVE_CEILING * 1,
	shipyardWindow: EMISSIVE_CEILING * 1,
	refineryWindow: EMISSIVE_CEILING * 0.85,
	outpostWindow: EMISSIVE_CEILING * 0.85,
	aperture: EMISSIVE_CEILING * 1,
	flood: EMISSIVE_CEILING * 0.9,
	strobe: EMISSIVE_CEILING * 0.95,
	weldArc: EMISSIVE_CEILING * 1,
	refineryFlare: EMISSIVE_CEILING * 0.9,
	heatRing: EMISSIVE_CEILING * 0.65,
} as const;

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
	place: (
		i: number,
		count: number,
		position: THREE.Vector3,
		normal: THREE.Vector3,
	) => void,
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
		place(i, count, position, normal);
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
 * refinery's outermost point is a radiator wing, which is structure and is
 * therefore not tagged — its flare, which used to hold that place, is a lit
 * throat sunk into a nozzle now and carries no outline at all. `tests/station-visuals.test.ts`
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
const PANE_GEOMETRY = shared(new THREE.BoxGeometry(0.03, 0.012, 0.004));
/**
 * One pane material per role, from the profile's `windowColor` — habitation
 * light is warmer on the refinery than on the two Coriolis hulls.
 *
 * Shared across every station of a role and never mutated. The window grid is
 * the one light on a station that does *not* animate: a flashing window reads as
 * a fault, and §5's motion belongs to the strobes, the arc and the flare.
 */
const PANE_MATERIALS: Record<StationType, THREE.MeshStandardMaterial> = {
	trade: shared(
		emissiveMaterial(
			STATION_VISUALS.trade.windowColor,
			STATION_EMISSIVE_INTENSITIES.tradeWindow,
		),
	),
	shipyard: shared(
		emissiveMaterial(
			STATION_VISUALS.shipyard.windowColor,
			STATION_EMISSIVE_INTENSITIES.shipyardWindow,
		),
	),
	refinery: shared(
		emissiveMaterial(
			STATION_VISUALS.refinery.windowColor,
			STATION_EMISSIVE_INTENSITIES.refineryWindow,
		),
	),
	outpost: shared(
		emissiveMaterial(
			STATION_VISUALS.outpost.windowColor,
			STATION_EMISSIVE_INTENSITIES.outpostWindow,
		),
	),
};
const APERTURE_LIGHT_MATERIAL = shared(
	emissiveMaterial(0xffb347, STATION_EMISSIVE_INTENSITIES.aperture),
);

/**
 * The nameplate's height, as a multiple of the aperture's.
 *
 * **Two sizes, because the two plates are read from very different ranges.**
 * The mouth plate's job is legibility on approach — §12.5 says it is legible at
 * a few kilometres at best — so it is the full aperture wide. The interior one
 * is read from inside a 280 m throat, tens of metres away: at the mouth plate's
 * size it filled the canopy edge to edge and read as a billboard rather than a
 * plaque. Measured by looking at the frame, which is the only instrument for
 * this.
 */
const NAMEPLATE_HEIGHT_FACTOR = 0.4;
/** How thick a nameplate is, km — the aperture bars' own thickness, because it
 *  is mounted the same way and for the same reason. */
const NAMEPLATE_THICKNESS_KM = 0.024;

/**
 * What `main.ts` looks for when it fills the shields with pixels.
 *
 * **Re-exported from `station-interior-mesh.ts`, which owns it now**: the
 * interior plaque is built over there, on the bulkhead the mouth is cut in, and
 * the tag belongs with the module that puts it on an object. Re-exported rather
 * than moved at every call site so importers are unchanged.
 */
export { NAMEPLATE_NAME } from "./station-interior-mesh";

/**
 * One nameplate quad's material, **per plate rather than shared**.
 *
 * Every other shared material in this module is documented as never being
 * mutated. This one is written to — the renderer assigns its `map` — and a
 * shared one would give every station in the galaxy the name of whichever was
 * textured last.
 */
function nameplateMaterial(): THREE.MeshBasicMaterial {
	return new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		// Nothing until the renderer supplies one (E10). An untextured plate is
		// invisible rather than a white rectangle, so a station drawn before its
		// texture arrives shows no shield instead of a blank one.
		opacity: 0,
	});
}
/** The shipyard's cold bay floods. Steady, so shared: what moves on that
 *  station is the welding arc, and it gets its own material per station. */
const FLOOD_MATERIAL = shared(
	emissiveMaterial(
		STATION_VISUALS.shipyard.floodColor,
		STATION_EMISSIVE_INTENSITIES.flood,
	),
);

/**
 * The frame around an aperture, as four bars rather than one slab.
 *
 * **The hole has to be a hole.** Every form that framed its opening did it with
 * a box spanning the aperture, which read correctly only because a dark recess
 * was drawn in front of it — §13.1 replaced that recess with a bay, and a slab
 * across the mouth is then a lit plate where the way out should be.
 *
 * `outerScale` keeps each form's own proportions: the trade Coriolis framed its
 * slot half again its width and three times its height, and that is what the
 * silhouette was ranked with.
 */
function coamingRing(
	aperture: StationAperture,
	z: number,
	depth: number,
	outerScale = { across: 1.5, up: 3 },
): THREE.Mesh[] {
	const material = plainMaterial(0x79838f, 0.7, 0.45);
	const outer = {
		across: (aperture.widthKm * outerScale.across) / 2,
		up: (aperture.heightKm * outerScale.up) / 2,
	};
	const inner = { across: aperture.widthKm / 2, up: aperture.heightKm / 2 };
	const bars: THREE.Mesh[] = [];
	for (const [w, h, x, y] of ringAround(outer, inner)) {
		if (w <= 0 || h <= 0) continue;
		const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), material);
		bar.position.set(x, y, z);
		bar.name = "coaming";
		bars.push(bar);
	}
	return bars;
}

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
function buildAperture(
	type: StationType,
	faceZ: number,
	berthSeed: number,
): THREE.Group {
	const { aperture } = STATION_GEOMETRY[type];
	const group = new THREE.Group();
	const w = aperture.widthKm;
	const h = aperture.heightKm;
	// **Thick enough to straddle the surface it is cut into.** The frame used to
	// sit *on* the face — bars centred half a bar proud of it — so it touched
	// the hull at a plane and nowhere else. On screen that is a lit rectangle
	// floating a few metres in front of the station, and the connectivity check
	// reads it as exactly that: three forms reported all four bars adrift while
	// nothing looked obviously wrong. Half in and half out, and thick enough
	// that "half" is a real overlap rather than a rounding.
	const bar = 0.024;

	// **There is no recess any more, and no dark mouth plate.** §13.1 replaced
	// E1/E7/E8's throat-and-deck presentation with one enclosed bay for every
	// role, so what lies behind the opening is the interior below — and a solid
	// rectangle at the aperture would stand in front of it, which is exactly the
	// failure E7's own comment records.

	// Four bars around the mouth rather than a ring: the slot is a rectangle, and
	// which side is the long one is what a ship rolls to line its beam up with
	// (#157 — check 4 measures the up-vector against the *short* axis).
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
		light.position.set(x, y, faceZ);
		// Named so `probe-station-visuals.mjs` can hide the four bars and measure
		// what they contribute, without also hiding the dark mouth they surround —
		// which would change the station's brightness in the other direction and
		// net out to nothing.
		light.name = "aperture-light";
		group.add(light);
	}
	// **E11's mouth shield, and it is added before the bay** so that
	// `buildStationForm`'s traversal collects the two plates mouth-first, which
	// is the order `probe-dock-arrival.mjs` indexes into. §3.2 records that the
	// docking tolerances were set
	// wide partly because the player has no visual referent at all for checks 2
	// and 4, and a lit rectangle on the docking face says which face docks and
	// roughly how the slot is rolled. It orients; it does not measure, and #69
	// may not treat it as a cue (§12.5). The *interior* shield is the bulkhead
	// plaque `station-interior-mesh.ts` mounts, which is where a ship parked
	// nose-outward can read it.
	group.add(buildMouthNameplate(aperture, faceZ));
	// **The bay (§13), against the face this form actually cuts.** `faceZ` is
	// the only thing the renderer varies — everything else in the catalogue is
	// the sim's table — because the workbench's alternate forms cut their
	// aperture wherever their own silhouette wants, and a bay built against
	// `aperturePlaneKm` would hang in space in front of them. For a selected
	// form the two are the same number by construction, which is what keeps the
	// drawn bay and the sim's berths in step.
	group.add(
		buildStationInterior(type, stationInterior(type, faceZ, berthSeed)),
	);
	group.name = "aperture";
	return group;
}

/**
 * **E9/E10/E11: the mouth name shield**, as geometry only.
 *
 * One quad, on the docking face beside the opening. Its partner — the plaque a
 * parked ship reads — is the bulkhead shield `station-interior-mesh.ts` mounts
 * inside the bay, which is where §13.1 puts it: visible from every berth,
 * because a parked ship faces out.
 *
 * **The texture is the renderer's** (E10). This module is headless-tested and
 * contains no `document` reference at all; a `CanvasTexture` here would force
 * the `typeof document !== "undefined"` branch that `station-visuals.ts`'s
 * docstring names as the failure mode — *the branch that ships to players would
 * be the one no test ever takes*. So the geometry is arithmetic and stays here,
 * and `main.ts` fills the `map`, which it already does for the cockpit's text.
 */
function buildMouthNameplate(
	aperture: StationAperture,
	faceZ: number,
): THREE.Mesh {
	const w = aperture.widthKm;
	const h = aperture.heightKm;
	const plateH = h * NAMEPLATE_HEIGHT_FACTOR;

	const mouth = new THREE.Mesh(
		new THREE.BoxGeometry(w, plateH, NAMEPLATE_THICKNESS_KM),
		nameplateMaterial(),
	);
	// **A box straddling the face, not a plane on it** — the same construction
	// the four aperture bars use, and for the same reason their comment gives:
	// a zero-thickness quad sitting *on* the surface touches it at a plane and
	// nowhere else, which reads as a sign floating a few metres in front of the
	// station. `tests/station-mesh.test.ts`'s connectivity check reports exactly
	// that, and did, on the first version of this plate.
	//
	// **Butted onto an aperture bar, not floating beside it.** The bar spans
	// `w/2` to `w/2 + bar` and is itself bolted to the hull, so seating the
	// plate's inner edge half a bar into it gives a real overlap on all three
	// axes.
	//
	// **On local +X, turned a quarter turn.** Local X is the aperture
	// rectangle's long axis by construction — `BoxGeometry(w, h, …)` above puts
	// `w` there — and since #126 it is also the slot's phase-zero `across`. A
	// sign along the short side would read as hanging off the frame. The
	// texture's own up is local +Y, so the quarter turn is what moves it to X —
	// **negative**, because the other sign turns the text through the mirror and
	// the name reads backwards. Which way round it goes was read off a captured
	// frame.
	mouth.rotation.z = -Math.PI / 2;
	mouth.position.set(
		w / 2 + NAMEPLATE_THICKNESS_KM / 2 + plateH / 2,
		0,
		faceZ + NAMEPLATE_THICKNESS_KM / 2,
	);
	mouth.name = NAMEPLATE_NAME;
	return mouth;
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
	/** `berthSeed` is the station's own berth draw (`docking.md` §13.2), which
	 *  reaches the interior and nothing else. Every builder takes it and most
	 *  only forward it, which is the price of the alternative being a module
	 *  global that a second station would overwrite. */
	readonly build: (color: number, berthSeed: number) => BuiltPart;
}

export type StationFormId = "a" | "b" | "c" | "d";
export const STATION_FORM_IDS: StationFormId[] = ["a", "b", "c", "d"];

/** One flat-shaded clone per base material, kept. */
const flatClones = new WeakMap<THREE.Material, THREE.Material>();
function flatCloneOf(material: THREE.Material) {
	const cached = flatClones.get(material);
	if (cached) return cached;
	const clone = material.clone();
	if (clone instanceof THREE.MeshStandardMaterial) clone.flatShading = true;
	// **The clone inherits its base's sharing rather than assuming it** (#187).
	// The cache is keyed on the base and lives as long as it does, so a clone of
	// a shared material is shared and a clone of a per-station one is not —
	// marking all of them shared leaks one material per flat-shaded part per
	// station, which is what `tests/gpu-teardown.test.ts` went red on.
	if (isShared(material)) shared(clone);
	flatClones.set(material, clone);
	return clone;
}

/**
 * One texture repeat per this many kilometres of hull.
 *
 * The plating map carries about eight panels across, so a plate is roughly
 * 19 m — a size a pilot can judge a ship against, which is the whole job of
 * plating at this scale. One constant for every part of every station, because
 * a plate that changes size from one part to the next stops being a ruler.
 */
export const STATION_PANEL_KM = 0.15;

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
	/**
	 * Cut the aperture out of the last control's cap, in kilometres (#155).
	 *
	 * Passed by whichever call builds the surface the aperture bars sit on —
	 * which is a per-form fact and cannot be inferred here: a form's outermost
	 * surface across the opening is its own choice of silhouette.
	 * `scripts/measure-aperture-cut.ts` prints which one that is per form.
	 */
	aperture?: ApertureCut,
) {
	const geometry = hullLoft(controls, { segments, aperture });
	// **A panel size, not a panel count.** `hullLoft` writes its UVs in
	// kilometres — chord distance round the section and distance along the
	// sweep — so dividing by one constant gives every part of every station the
	// same ~19 m plate. Multiplying a normalised 0–1 unwrap by a fixed count,
	// which is what this did, gives a 1.5 km keel and a 0.12 km terrace six
	// bands each: one coarse, the other a smear.
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	const panelKm = stationPanelKm();
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) / panelKm, uv.getY(i) / panelKm);
	uv.needsUpdate = true;
	// Cached per source material: the forms ask for flat shading dozens of times
	// per station, and a clone each time gives one station dozens of distinct
	// materials that can never batch. One clone per base material instead.
	const shaded = flat ? flatCloneOf(material) : material;
	const mesh = new THREE.Mesh(geometry, shaded);
	mesh.name = name;
	return mesh;
}

/**
 * A run of lit ports along a lofted surface, placed by the caller's rule.
 *
 * Sized from the station rather than from a constant, so the same call reads
 * right on a 0.4 km drum and a 1.5 km ring.
 *
 * **`base` is the form's run, not the count built** (#129). The role's
 * `windowScale` multiplies it, and the built count is handed to `place` — which
 * is why every layout in this file is written against the `count` argument
 * rather than against the literal beside it. A layout that closed over the
 * literal would keep #36's spacing and stack the extra panes on top of the old
 * ones, and the symptom would be a station that got brighter without getting
 * more windows.
 */
function portRun(
	type: StationType,
	base: number,
	place: (
		i: number,
		count: number,
		position: THREE.Vector3,
		normal: THREE.Vector3,
	) => void,
) {
	const count = Math.max(
		1,
		Math.round(base * STATION_VISUALS[type].windowScale),
	);
	return buildWindowGrid(type, count, place);
}

/**
 * Split an index into a **row** and a position **along** it, for a run laid out
 * on a rectangular patch.
 *
 * Extracted because five callbacks in this file had `Math.round(count / 2)` and
 * `(i % perRow) / perRow` written out, and the rule they share — how a role's
 * density scale spreads extra pieces over a face rather than off the end of it
 * — is one rule. `along` is in `[0, 1)`, so a caller multiplies by its own span
 * and never has to know how many there are.
 *
 * `Math.ceil`, not `Math.round`: with `round`, an index past `rows * perRow`
 * clamps onto a slot another index already holds, and the two pieces are drawn
 * inside each other. That is not hypothetical — it was the refinery's terrace at
 * the shipped density, where 37 pieces over 5 levels put i=35 and i=36 exactly
 * on top of i=28 and i=29.
 */
function rowsOf(i: number, count: number, rows: number) {
	const perRow = Math.max(1, Math.ceil(count / rows));
	return {
		perRow,
		row: Math.min(rows - 1, Math.floor(i / perRow)),
		along: ((i % perRow) + 0.5) / perRow,
	};
}

/**
 * Spread the i-th piece evenly round a circle, with the side it alternates onto.
 *
 * The other layout every run in this file wants, written out five times before
 * it was one function. `side` is the ±1 a zone uses when it puts alternate
 * pieces on the two faces of a band; a zone on a single face ignores it.
 *
 * `(i + 0.5)` rather than `i`, so a run of any count is centred in its own
 * sector rather than starting on the seam — which matters where a form's zone is
 * an arc with an end, and costs nothing where it is a closed ring.
 */
function ringAt(i: number, count: number) {
	return {
		theta: ((i + 0.5) / count) * Math.PI * 2,
		side: i % 2 === 0 ? 1 : -1,
	};
}

/**
 * The cuboctahedron's four equatorial faces: which face the i-th piece is on,
 * that face's outward normal, and the tangent running across it.
 *
 * Both the Coriolis' port grid and its plant bands index faces this way, and two
 * copies of it drift the moment one of them changes how many faces it uses.
 * `step` is the index *within* the face and `perFace` how many share it — the
 * two a caller hands to `rowsOf`, returned from here because the face count is
 * this function's, and dividing by it in the caller put the same constant in two
 * places per call site.
 */
function faceAt(i: number, count: number, faces = 4) {
	const angle = ((i % faces) / faces) * Math.PI * 2;
	return {
		step: Math.floor(i / faces),
		perFace: Math.max(1, Math.ceil(count / faces)),
		normal: new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0),
		tangent: new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0),
	};
}

/**
 * The mechanical clutter on a form's own surfaces (#129).
 *
 * The zones are the form's, because #102 §2 settled that regions are authored
 * and the fill is generated: a builder knows which of its faces is a flank and
 * which is a docking face, and a scatter does not. `station-greebles.ts` owns
 * everything after that.
 *
 * Tagged `full` here rather than inside the generator, for the same reason the
 * window grid is: `detail` is this module's, and the band is this module's rule.
 * `tag` keys the generator and must be unique per form — a shared one draws one
 * form's clutter onto another.
 */
function greebleRun(
	type: StationType,
	tag: string,
	zones: readonly GreebleZone[],
	/** The form as built so far — what the generator snaps each piece onto.
	 *  Every caller passes its own `group`, which is why this is called last in
	 *  a builder: the structure has to exist before anything can be mounted on
	 *  it. */
	structure: THREE.Object3D,
) {
	return detail(buildGreebles(type, tag, zones, structure), "full");
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
		const material = emissiveMaterial(
			STATION_VISUALS[type].strobeColor,
			STATION_EMISSIVE_INTENSITIES.off,
		);
		const lamp = new THREE.Mesh(
			new THREE.BoxGeometry(size, size, size * 0.6),
			material,
		);
		place(side, lamp.position);
		lamp.name = kind;
		detail(lamp, "reduced");
		group.add(lamp);
		fixtures.push({
			material,
			base: STATION_EMISSIVE_INTENSITIES.strobe,
			kind,
		});
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

/**
 * The rectangle a form cuts out of its own outermost surface (#155).
 *
 * The same row the aperture bars are sized from, so the cut edge and the frame
 * round it are one number reached once. They meet exactly: the four bars lie
 * strictly *outside* the rectangle, so a cut any larger shows the bay through
 * the gap and any smaller re-closes the hole.
 */
function apertureCut(type: StationType, ends: "last" | "both" = "last") {
	const { widthKm, heightKm } = STATION_GEOMETRY[type].aperture;
	return { halfWidth: widthKm / 2, halfHeight: heightKm / 2, ends };
}

function buildCuboctahedron(
	radiusKm: number,
	material: THREE.Material,
	/**
	 * Cut the +Z square out as a ring of quads round this rectangle (#155).
	 *
	 * Half-extents in kilometres. Without it the square is the two triangles it
	 * always was, which is what a docking ship used to fly through.
	 */
	aperture?: ApertureCut,
) {
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
	// **Kept a plain literal, and formatted by hand.** Spreading a conditional
	// into this array makes it non-literal, and biome then breaks every index
	// onto a line of its own — `// the eight octant triangles` came to head a
	// 24-line run a reader has to count through. The grouping into triangles is
	// the table's meaning, and a face list read one digit at a time is where the
	// first version's mis-wound cuboctahedron came from. The +Z square is the
	// first two triangles, and it is spliced out below rather than here.
	// biome-ignore format: the grouping into triangles is the table's meaning
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
	const geometry = new THREE.PolyhedronGeometry(
		vertices,
		// The +Z square is the first two triangles; the ring below replaces it.
		aperture ? indices.slice(6) : indices,
		radiusKm,
		0,
	);
	if (aperture) {
		// **The face's own plane and its own corners**, not a box round the
		// solid: for a cuboctahedron of radius R the square face planes sit at
		// `R / √2`, and that square's corners are the four points where the
		// axes meet it. `CUBOCTAHEDRON_FACE` is the same figure every fixture on
		// this hull is placed from, so the cut and the coaming round it cannot
		// disagree about where the face is.
		const face = radiusKm * CUBOCTAHEDRON_FACE;
		const { outer, inner } = cutRing(
			[
				[face, 0],
				[0, face],
				[-face, 0],
				[0, -face],
			],
			aperture.halfWidth,
			aperture.halfHeight,
		);
		appendRing(geometry, ringTriangles(outer, inner, face), aperture);
	}
	// Box-projected UVs, per face — see `boxProjectUVs`.
	boxProjectUVs(geometry, stationPanelKm());
	// Through the clone cache, not by mutating the material it was handed: hull
	// materials are shared per (type, colour) now, so setting `flatShading` on
	// one sets it on every station of that type. It happens to be what both of
	// this file's callers want, which is exactly why it would not have been
	// noticed until a form wanted a smooth trade hull.
	return new THREE.Mesh(geometry, flatCloneOf(material));
}

function buildTradeCoriolis(color: number, berthSeed: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const radius = r * 0.95;
	/**
	 * Where a square face's plane sits, kilometres. Everything mounted on the
	 * hull is placed from this — which is what stops a light hanging in space
	 * beside the station, as the swept version's did.
	 *
	 * **The form computes this and the table declares the plane, and the two are
	 * checked against each other rather than one deriving the other** (#128).
	 * Deriving the hull from `aperturePlaneKm` was tried and withdrawn: it makes
	 * `tests/station-mesh.test.ts`'s hull-reaches-the-plane row a tautology on
	 * the one form the defect was found on — the reach becomes `plane / 1.06`
	 * for any plane, so the row cannot go red. Two paths to one number is what
	 * makes the assertion worth making; a single path is a restatement.
	 *
	 * They agree to 0.8 m today, and the frame stands 6% proud of the face,
	 * which is where the declared plane sits.
	 */
	const face = radius * CUBOCTAHEDRON_FACE;

	const hull = buildCuboctahedron(
		radius,
		hullMaterial(color, "trade"),
		apertureCut("trade"),
	);
	hull.name = "core";
	group.add(hull);

	// **A frame round the slot, not a wall over the face.**
	//
	// The first coaming was `face` square — 0.42 km on a 1.24 km station, a
	// third of its whole width — and read as a plate bolted over the docking
	// face rather than as a door in it. It is sized from the *aperture* now,
	// which is the thing it frames: half again its width and three times its
	// height, so the slot sits in a rim you can see the edges of.
	//
	// Thin in z as well, and the aperture's own bars overlap it: at the old
	// depth the frame stood a hair clear of the coaming and the two were
	// separate objects touching at a plane — which the connectivity check reads,
	// correctly, as a light hanging in front of a station.
	// **A ring, and it always claimed to be one.** It was a single box spanning
	// the aperture, which worked while the slot in front of it was a dark recess
	// drawn `BackSide`: from outside, the recess read as the hole. §13.1 replaced
	// that recess with a bay, and the slab was left standing across the mouth —
	// from inside, the way out was a lit grey plate, and no rim on the bay's own
	// bulkhead could help, because the slab was in front of it. Four bars around
	// the opening instead, which changes nothing about the silhouette and makes
	// the hole a hole.
	const slot = STATION_GEOMETRY.trade.aperture;
	for (const bar of coamingRing(slot, face + face * 0.035, face * 0.09))
		group.add(bar);
	// **The declared plane, not a depth this form picks.** `station.ts` owns
	// where the aperture is, because §3's checks are evaluated there; the number
	// happens to be this face 6% proud, and `tests/station-mesh.test.ts` asserts
	// the two agree rather than trusting the comment.
	group.add(
		buildAperture("trade", STATION_GEOMETRY.trade.aperturePlaneKm, berthSeed),
	);

	// The window grid, on the four equatorial square faces. Each pane sits on
	// its face's own plane, a hair proud, so none of them can float: the face is
	// at `face` along its axis and spans ±`face` across it.
	const PER_FACE = 7;
	/** Rows of ports across a square face, so the run stays a **grid**.
	 *
	 *  #36's seven panes fitted one staggered row. Three times that on one row
	 *  is a 30 m pane every 21 m, which is not a denser window grid — it is a
	 *  continuous strip light, and it was flown as one. Rows are what makes the
	 *  extra panes read as more windows rather than as a brighter line. */
	const PORT_ROWS = 3;
	group.add(
		portRun("trade", PER_FACE * 4, (i, count, position, normal) => {
			// Four faces, and the grid per face derived from the count rather
			// than from `PER_FACE`, so the role's scale spreads the extra panes
			// over the face instead of doubling them up on the seven positions
			// #36 had. `rowsOf` and not the same arithmetic written again: its
			// `ceil` is what stops an index past the last slot landing on one
			// another index already holds.
			const { step, perFace, normal: outward, tangent } = faceAt(i, count, 4);
			const { row, along } = rowsOf(step, perFace, PORT_ROWS);
			normal.copy(outward);
			// Inside the face's square and kept clear of its edges, so a pane
			// cannot hang off a corner. The face plane is at `face` along its
			// normal and spans ±`face` across it; the grid uses the middle band
			// and leaves the two outer ones to the plant below.
			position
				.copy(normal)
				.multiplyScalar(face * 1.004)
				.addScaledVector(tangent, (along - 0.5) * face * 1.04);
			position.z = ((row + 0.5) / PORT_ROWS - 0.5) * face * 0.62;
		}),
	);

	// The strobes on two opposite equatorial faces, flat against them.
	group.add(
		strobePair("trade", fixtures, r * 0.07, (side, position) => {
			position.set(side * face * 1.02, 0, face * 0.5);
		}),
	);
	// Plant on the four equatorial faces, in the bands above and below the
	// window run. Not on the docking face and not on the corners: a corner is
	// where the silhouette lives, and a square face is where a habitat would
	// actually bolt its machinery.
	group.add(
		greebleRun(
			"trade",
			"trade-a",
			[
				{
					// Narrow and tall rather than wide and flat. At a 40 m footprint
					// and 34 m of relief these were *tiles*: the eye reads a box on a
					// hull by its shadowed side, and a piece wider than it is high
					// has none worth seeing. Half the footprint and a third more
					// relief is the same volume standing up.
					count: 32,
					sizeKm: face * 0.05,
					reliefKm: face * 0.06,
					place: (i, count, position, normal) => {
						// Two rows per face, above and below the port grid — the band
						// the grid deliberately leaves free. Machinery round the
						// windows rather than among them: interleaved, the two read
						// as one decorated stripe, which is what the first version
						// flew as.
						const {
							step,
							perFace,
							normal: outward,
							tangent,
						} = faceAt(i, count, 4);
						const { row, along } = rowsOf(step, perFace, 2);
						normal.copy(outward);
						position
							.copy(normal)
							.multiplyScalar(face)
							.addScaledVector(tangent, (along - 0.5) * face * 1.06);
						// **The corners are the outline.** A cuboctahedron's square
						// face sits at `r/√2` and its corners at `r`, so a piece at
						// the face's own centre has √2 of headroom and one near a
						// corner has none. Measured: an earlier run at ±0.72·face
						// across ±0.6·face reached 0.577 km against the hull's 0.570
						// and took the outline off the station.
						position.z = (row === 0 ? -1 : 1) * face * 0.52;
					},
				},
			],
			group,
		),
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
 * - **Two spokes read as a prop.** They are lofted A-frame trusses now, and
 *   there are four of them — the count went to six first and read as a bicycle
 *   wheel, which is recorded at `SPOKES` below rather than here, because a
 *   number written in two places is a number that disagrees with itself.
 * - **Nothing had a size.** A smooth torus gives the eye no unit to judge
 *   against, so it could be ten metres across. The rim now carries repeated
 *   modules at a fixed pitch — the same trick #35's carrier uses, and the only
 *   one that works against a starfield with no ruler in it.
 */
function buildTradeRing(color: number, berthSeed: number): BuiltPart {
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
	rim.material = flatCloneOf(
		rim.material as THREE.Material,
	) as THREE.MeshStandardMaterial;
	rim.name = "core";
	group.add(rim);

	// **Recessed modules and slim fins, not lugs.**
	//
	// The first version alternated blocks *outward* and inward off the rim,
	// which read as bolts stuck on the outside — reviewed as "weird
	// protrusions". A spun habitat's outer face is its floor, so nothing should
	// stick out of it that does not have to; what does stick out on a real one
	// is thermal plant. So the repeated element is now a shallow panel set into
	// the rim, and the only things standing off it are four radiator fins.
	//
	// The pitch is what matters and it survives the change: twelve of anything
	// at a fixed spacing is the ruler that tells the eye how big the ring is.
	const MODULES = 12;
	for (let i = 0; i < MODULES; i++) {
		const theta = (i / MODULES) * Math.PI * 2;
		const bay = new THREE.Group();
		bay.rotation.z = theta;
		bay.name = `module-${i}`;
		group.add(bay);
		const panel = shell(
			[
				{ z: major - tube * 0.4, w: r * 0.075, h: r * 0.05, e: 6 },
				{ z: major + tube * 0.55, w: r * 0.062, h: r * 0.042, e: 6 },
			],
			plainMaterial(i % 2 === 0 ? 0x8b95a0 : 0x6f7d88, 0.68, 0.46),
			"module",
			6,
			true,
		);
		panel.rotation.y = Math.PI / 2;
		bay.add(panel);
	}
	// Four radiator fins, edge-on to the ring's plane so they read as sheets
	// rather than as more blocks.
	for (let i = 0; i < 4; i++) {
		const theta = (i / 4) * Math.PI * 2 + Math.PI / 8;
		const fin = new THREE.Group();
		fin.rotation.z = theta;
		group.add(fin);
		const plate = new THREE.Mesh(
			new THREE.BoxGeometry(r * 0.03, tube * 2.6, tube * 1.5),
			plainMaterial(0x5f6d78, 0.84, 0.34),
		);
		plate.position.set(major + tube * 0.5, 0, 0);
		fin.add(plate);
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

	// A hub with a real throat — and **wide enough for the slot it carries**.
	//
	// The previous hub was 0.17 km across against a 0.2 km slot: the opening was
	// wider than the thing it was cut into, which is why the dock read as
	// enormous. It is sized from the aperture now — the slot plus a frame either
	// side — rather than from a fraction of the ring.
	const slot = STATION_GEOMETRY.trade.aperture;
	const throat = slot.widthKm * 0.5 + r * 0.11;
	group.add(
		shell(
			[
				{ z: -r * 0.42, w: throat * 0.72, h: throat * 0.72, e: 6 },
				{ z: -r * 0.24, w: throat, h: throat, e: 6, hard: true },
				{ z: r * 0.24, w: throat, h: throat, e: 6, hard: true },
				{ z: r * 0.34, w: throat * 0.86, h: throat * 0.86, e: 6 },
			],
			plainMaterial(0x8b95a0, 0.6, 0.5),
			"hub",
			8,
			true,
			apertureCut("trade"),
		),
	);
	// **On the hub's own front cap**, at the same z its last ring sits at. Set
	// short of it the hub stood 6 m past the mouth — a station poking into the
	// corridor a ship flies down, which is the one place nothing may be.
	group.add(buildAperture("trade", r * 0.34, berthSeed));
	group.add(
		portRun("trade", PANE_COUNT, (i, count, position, normal) => {
			const theta = (i / count) * Math.PI * 2;
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
	// On the rim's two side faces, never on its outer one. #102's rule and this
	// form's own review agree here: the outer face is a spun habitat's floor and
	// the first version of the recessed modules was rejected for sticking out of
	// it. The sides are also the one surface on this ring whose radius is
	// `major`, so nothing here can approach the outline at `major + tube`.
	group.add(
		greebleRun(
			"trade",
			"trade-b",
			[
				{
					count: 24,
					sizeKm: tube * 0.42,
					reliefKm: tube * 0.34,
					place: (i, count, position, normal) => {
						const { theta, side } = ringAt(i, count);
						normal.set(0, 0, side);
						position.set(
							Math.cos(theta) * major,
							Math.sin(theta) * major,
							side * tube * 0.92,
						);
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/** Trade C — Drum. An O'Neill cylinder end-on: a long spun barrel whose
 *  +Z cap is the dock. The one form whose length, not its width, is the cue. */
function buildTradeDrum(color: number, berthSeed: number): BuiltPart {
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
			apertureCut("trade"),
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
	// At the drum's own front cap (`r * 0.88`), not 20 m in front of it.
	group.add(buildAperture("trade", r * 0.88, berthSeed));
	group.add(
		portRun("trade", PANE_COUNT, (i, count, position, normal) => {
			const theta = (i / count) * Math.PI * 2 * 3;
			const z = -r * 0.8 + (i / count) * r * 1.5;
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
	// Down the barrel, on the opposite helix to the window run so the two do not
	// sit on each other. Short of the front cap at `r * 0.88`, which is where the
	// aperture is and the one place nothing may be.
	group.add(
		greebleRun(
			"trade",
			"trade-c",
			[
				{
					count: 26,
					sizeKm: body * 0.17,
					reliefKm: body * 0.13,
					place: (i, count, position, normal) => {
						const theta = -(i / count) * Math.PI * 2 * 2 + 0.7;
						normal.set(Math.cos(theta), Math.sin(theta), 0);
						position.copy(normal).multiplyScalar(body);
						position.z = -r * 0.78 + (i / count) * r * 1.4;
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/**
 * How far aft of the pressurised hub a shipyard's static structure sits (#165).
 *
 * **A topology fix, not a placement one.** The slot is on the spin axis
 * (`docking.md` §4.2) and #28 keeps the outboard structure still, so a
 * shipyard is a *rotating* drum with a *static* spine — and both forms drew
 * the spine passing straight through the drum's interior. §13's bay merely
 * made it visible: the Gantry's keel spanned `z ±0.300` and the Hangar's slab
 * `z ±0.300` against a hub whose bay reaches back to `z = −0.045`.
 *
 * A bearing has to be on the spin axis, so static structure can meet the drum
 * only at an axial face; the forward face is the aperture, so aft is the only
 * one left. 360 m puts the Gantry's keel at `z −0.660..−0.060` and the
 * Hangar's slab at `−0.660..0.000`, both clear of the bay's back wall with
 * margin, and both still overlapping the hub's aft end — which is the mount.
 *
 * **The booms do not move.** They sit at `y = ±0.48 km`, far outside the bay's
 * swept cylinder (181 m about the aperture axis), so they never intruded — and
 * #28 added them precisely to reach into the approach view.
 *
 * It costs nothing in the view that ranked these forms: #28 rests shipyard
 * identity on the outline down the aperture axis, and a 2.7 km keel projects
 * the same silhouette from 360 m further aft.
 */
export const SHIPYARD_KEEL_AFT_KM = 0.36;

/** Shipyard A — Gantry. A bridge keel with two open bays of lofted ribs
 *  along it; the bays are the silhouette, and they are obviously *for* holding
 *  something the size of a ship. */
function buildShipyardGantry(color: number, berthSeed: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const span = 2.3;
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
		apertureCut("shipyard"),
	);
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(hub);
	spun.add(
		buildAperture(
			"shipyard",
			STATION_GEOMETRY.shipyard.aperturePlaneKm,
			berthSeed,
		),
	);
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
			{ z: -span * 0.62, w: r * 0.26, h: r * 0.2, e: 3 },
			{ z: -span * 0.2, w: r * 0.42, h: r * 0.34, e: 3.4, hard: true },
			{ z: span * 0.34, w: r * 0.5, h: r * 0.42, e: 3.4 },
			{ z: span * 0.56, w: r * 0.38, h: r * 0.32, e: 3.4 },
		],
		plainMaterial(0x8b95a0, 0.7, 0.44),
		"keel",
		12,
		true,
	);
	keel.rotation.y = Math.PI / 2;
	keel.position.z = -SHIPYARD_KEEL_AFT_KM;
	frame.add(keel);
	for (let i = 0; i < 7; i++) {
		const x = -span * 0.52 + (i / 6) * span * 1.04;
		const arch = new THREE.Mesh(
			new THREE.TorusGeometry(r * 0.62, r * 0.05, 5, 12, Math.PI * 1.25),
			rib,
		);
		arch.position.set(x, 0, -SHIPYARD_KEEL_AFT_KM);
		arch.rotation.y = Math.PI / 2;
		arch.rotation.z = -Math.PI * 0.62;
		frame.add(arch);
	}
	for (const y of [-r * 0.58, r * 0.58]) {
		const rail = shell(
			[
				{ z: -span * 0.56, w: r * 0.05, h: r * 0.05, e: 3 },
				{ z: span * 0.56, w: r * 0.05, h: r * 0.05, e: 3 },
			],
			rib,
			"rail",
			6,
		);
		rail.rotation.y = Math.PI / 2;
		rail.position.set(0, y, -SHIPYARD_KEEL_AFT_KM);
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
				{ z: -span * 0.1, w: r * 0.09, h: r * 0.09, e: 3 },
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
				position.set(
					-span * 0.34 + i * span * 0.23,
					-r * 0.3,
					-SHIPYARD_KEEL_AFT_KM,
				),
			new THREE.Vector3(span * 0.14, -r * 0.24, -SHIPYARD_KEEL_AFT_KM),
		),
	);
	group.add(
		portRun("shipyard", 16, (i, count, position, normal) => {
			// Two rows along the keel. The row length and the pitch both come
			// from the count, so a denser run covers the same stretch of keel
			// more finely rather than running off the end of it — which a fixed
			// `r * 0.08` stride does the moment the count passes eight.
			const { row, along } = rowsOf(i, count, 2);
			normal.set(0, 1, 0);
			position.set(
				span * 0.18 + along * r * 0.64,
				r * 0.44,
				(row === 0 ? -1 : 1) * r * 0.16 - SHIPYARD_KEEL_AFT_KM,
			);
		}),
	);
	group.add(
		strobePair("shipyard", fixtures, r * 0.07, (side, position) => {
			position.set(side * span * 0.55, 0, -SHIPYARD_KEEL_AFT_KM);
		}),
	);
	// Along the keel's underside, opposite the ports on its top. A yard's keel
	// is where its plant would be run — and it is the one long surface on this
	// form that is not a bay a ship has to fit into.
	group.add(
		greebleRun(
			"shipyard",
			"shipyard-a",
			[
				{
					count: 30,
					sizeKm: r * 0.075,
					reliefKm: r * 0.06,
					place: (i, count, position, normal) => {
						const { row, along } = rowsOf(i, count, 2);
						normal.set(0, -1, 0);
						position.set(
							-span * 0.42 + along * span * 0.84,
							-r * 0.42,
							(row === 0 ? -1 : 1) * r * 0.14 - SHIPYARD_KEEL_AFT_KM,
						);
					},
				},
			],
			group,
		),
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
function buildShipyardHangar(color: number, berthSeed: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const span = 2.14;
	const frame = new THREE.Group();
	frame.name = "frame";
	group.add(frame);

	// The slab: long, rectangular in section, with a chamfer at each end.
	const slab = shell(
		[
			{ z: -span * 0.56, w: r * 0.34, h: r * 0.5, e: 5 },
			{ z: -span * 0.44, w: r * 0.5, h: r * 0.72, e: 7, hard: true },
			{ z: span * 0.4, w: r * 0.5, h: r * 0.72, e: 7, hard: true },
			{ z: span * 0.54, w: r * 0.32, h: r * 0.48, e: 5 },
		],
		hullMaterial(color, "shipyard"),
		"slab",
		8,
		true,
	);
	slab.rotation.y = Math.PI / 2;
	// **The hub seats on the slab's forward end rather than inside it** (#165).
	// Shipyard B has the Gantry's fault wearing a different shape: the slab *is*
	// the station body and the rotating hub was mounted in its middle, so the
	// bay reached 60 m past the mouth and stopped against the slab's own top
	// face. `SHIPYARD_KEEL_AFT_KM` is the same figure and the same argument.
	slab.position.z = -SHIPYARD_KEEL_AFT_KM;
	frame.add(slab);

	// The bay mouth: a recess cut into the flank, floodlit from inside. Its own
	// size is the ruler — it is obviously a hole a ship goes through.
	//
	// **It is a construction slip, not the dock**, and the shape must not be
	// allowed to imply otherwise. Measured, the mouth is 1070 × 264 × 144 m
	// against a pool whose largest ordinary hull is 74 × 54 × 47 m: fifteen of
	// them nose to tail, three or four abreast. That is deliberate — a shipyard
	// should visibly hold ships — but the *player* docks at the hub, through the
	// slot `STATION_GEOMETRY.shipyard` declares, because `docking.md` §4 puts it
	// on the spin axis and #28 keeps the outboard structure still. A pad in this
	// bay would be a second docking geometry the checks do not read.
	//
	// The slot's dimensions are deliberately not repeated here. They were, and
	// they went stale the moment §5's provisional figure was resolved — which is
	// the failure `docking.md` names in the same breath as fixing it.
	const mouth = new THREE.Mesh(
		new THREE.BoxGeometry(span * 0.5, r * 0.44, r * 0.24),
		new THREE.MeshBasicMaterial({ color: 0x05070a }),
	);
	mouth.position.set(0, 0, r * 0.42 - SHIPYARD_KEEL_AFT_KM);
	mouth.name = "bay-mouth";
	frame.add(mouth);
	for (const side of [-1, 1]) {
		const lip = shell(
			[
				{ z: -span * 0.25, w: r * 0.06, h: r * 0.05, e: 5 },
				{ z: span * 0.25, w: r * 0.06, h: r * 0.05, e: 5 },
			],
			plainMaterial(0x8b95a0, 0.66, 0.46),
			"lip",
			6,
			true,
		);
		lip.rotation.y = Math.PI / 2;
		lip.position.set(0, side * r * 0.26, r * 0.5 - SHIPYARD_KEEL_AFT_KM);
		frame.add(lip);
	}
	// Rib frames at a fixed pitch down the flank — the second ruler, and what
	// keeps a long smooth slab from reading as a small smooth box.
	for (let i = 0; i < 9; i++) {
		const rib = new THREE.Mesh(
			new THREE.BoxGeometry(r * 0.03, r * 0.76, r * 0.54),
			plainMaterial(0x6f7d88, 0.78, 0.42),
		);
		rib.position.set(
			-span * 0.42 + (i / 8) * span * 0.84,
			0,
			-SHIPYARD_KEEL_AFT_KM,
		);
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
		apertureCut("shipyard"),
	);
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(hub);
	spun.add(buildAperture("shipyard", r * 0.6, berthSeed));
	group.add(spun);

	// Inside the bay mouth, which is where a bay's floods are.
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, position) =>
				position.set(
					-span * 0.2 + i * span * 0.13,
					r * 0.2,
					r * 0.4 - SHIPYARD_KEEL_AFT_KM,
				),
			new THREE.Vector3(span * 0.1, -r * 0.18, r * 0.4 - SHIPYARD_KEEL_AFT_KM),
		),
	);
	group.add(
		portRun("shipyard", 16, (i, count, position, normal) => {
			// On the slab's own back face. The slab is `r * 0.72` half-high and
			// `r * 0.5` half-wide in the rotated frame, so a run at `r * 0.5` in
			// z sat clear of the surface it was meant to be set into — the whole
			// grid came away as one loose island.
			//
			// Two rows across the **parallel** part of the back face. The slab's
			// section is constant from −0.44·span to +0.4·span and chamfers
			// outside that, so a run reaching 0.46·span put panes on the taper,
			// where the surface has already fallen away from `r * 0.46`.
			const { row, along } = rowsOf(i, count, 2);
			normal.set(0, 0, -1);
			position.set(
				-span * 0.34 + along * span * 0.68,
				(row === 0 ? -1 : 1) * r * 0.24,
				-r * 0.46 - SHIPYARD_KEEL_AFT_KM,
			);
		}),
	);
	group.add(
		strobePair("shipyard", fixtures, r * 0.07, (side, position) => {
			// Inside the slab's own half-length (`span * 0.54`), not on it: at
			// 0.55 one of the pair sat clear of the hull it is mounted on.
			position.set(side * span * 0.5, 0, r * 0.36 - SHIPYARD_KEEL_AFT_KM);
		}),
	);
	// On the slab's back face, beside the port run and set into the same
	// surface — the face that is not the bay mouth, and the one place clutter
	// cannot end up inside the volume a ship is meant to enter.
	group.add(
		greebleRun(
			"shipyard",
			"shipyard-b",
			[
				{
					count: 26,
					sizeKm: r * 0.09,
					reliefKm: r * 0.07,
					place: (i, count, position, normal) => {
						const { row, along } = rowsOf(i, count, 2);
						normal.set(0, 0, -1);
						position.set(
							// The slab's parallel section, for the port run's
							// reason twenty lines up.
							-span * 0.34 + along * span * 0.68,
							(row === 0 ? -1 : 1) * r * 0.46,
							-r * 0.46 - SHIPYARD_KEEL_AFT_KM,
						);
					},
				},
			],
			group,
		),
	);
	return { group, fixtures, spinner: spun };
}

/** Shipyard C — Slipway ring. A partial ring with the gap as the slip: the
 *  one shipyard form whose outline is a broken circle, which nothing else in
 *  the pool is. */
function buildShipyardSlipway(color: number, berthSeed: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const span = 2.07;
	const major = span * 0.62;
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
		false,
		apertureCut("shipyard"),
	);
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(spine);
	spun.add(buildAperture("shipyard", r * 0.64, berthSeed));
	group.add(spun);
	// Struts from the hub to the arc, nested a group per angle — two Euler
	// angles on one object leaves the result to `Euler`'s order, and all four
	// came out lying along one line, which is why the form read as unfinished.
	for (let i = 0; i < 4; i++) {
		const strut = shell(
			[
				{ z: r * 0.32, w: r * 0.08, h: r * 0.06, e: 4 },
				{ z: major, w: r * 0.06, h: r * 0.05, e: 4 },
			],
			plainMaterial(0x6f7d88, 0.78, 0.42),
			"strut",
			6,
			true,
		);
		radialArm(
			frame,
			Math.PI * 0.3 + (i / 3) * Math.PI * 1.35,
			`strut-${i}`,
			strut,
		);
	}
	// The two ends of the slip, capped and built up. An arc that simply stops is
	// a tube with a hole in it: these are the working faces the slip opens
	// between, so they carry the heaviest structure on the station.
	for (const [index, end] of [Math.PI * 0.28, Math.PI * 1.73].entries()) {
		const head = shell(
			[
				{ z: major - r * 0.3, w: r * 0.26, h: r * 0.3, e: 6 },
				{ z: major + r * 0.05, w: r * 0.3, h: r * 0.34, e: 7, hard: true },
				{ z: major + r * 0.26, w: r * 0.22, h: r * 0.26, e: 6 },
			],
			hullMaterial(color, "shipyard"),
			"slip-head",
			6,
			true,
		);
		radialArm(frame, end, `slip-head-${index}`, head);
	}
	// On the arc's inner face, looking into the slip.
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, position) => {
				const theta = Math.PI * 0.3 + (i / 3) * Math.PI * 1.35;
				// On the arc's inner *surface*, derived from its tube radius. At
				// `major * 0.86` they hung 60 m inside the slip — invisible to the
				// island check, whose boxes overlap because the arc's box spans the
				// whole ring, and plainly floating on screen.
				const inner = major - r * 0.18;
				position.set(Math.cos(theta) * inner, Math.sin(theta) * inner, 0);
			},
			new THREE.Vector3(major - r * 0.18, 0, 0),
		),
	);
	group.add(
		portRun("shipyard", 12, (i, count, position, normal) => {
			const theta = Math.PI * 0.28 + ((i + 1) / (count + 1)) * Math.PI * 1.4;
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
	// On the broken ring's two flat sides, along the arc the ports look out of.
	// Not on its outer face: that circle is the whole silhouette of the form,
	// and the reach here is 1.450 km against a 1.5 km budget.
	group.add(
		greebleRun(
			"shipyard",
			"shipyard-c",
			[
				{
					count: 26,
					sizeKm: r * 0.085,
					reliefKm: r * 0.07,
					place: (i, count, position, normal) => {
						// **An arc, not a ring**, which is why the angle is written
						// here rather than taken from `ringAt`: the gap in this form
						// *is* the slip, and plant wrapped round it would sit across
						// the one opening the concept is about. Only the side flip is
						// shared.
						const { side } = ringAt(i, count);
						const theta = Math.PI * 0.28 + ((i + 0.5) / count) * Math.PI * 1.4;
						normal.set(0, 0, side);
						position.set(
							Math.cos(theta) * major * 0.94,
							Math.sin(theta) * major * 0.94,
							side * r * 0.12,
						);
					},
				},
			],
			group,
		),
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
	const arcMaterial = emissiveMaterial(
		STATION_VISUALS.shipyard.floodColor,
		STATION_EMISSIVE_INTENSITIES.off,
	);
	const arc = new THREE.Mesh(
		new THREE.SphereGeometry(r * 0.05, 8, 6),
		arcMaterial,
	);
	arc.position.copy(arcAt);
	arc.name = "weld-arc";
	detail(arc, "reduced");
	group.add(arc);
	fixtures.push({
		material: arcMaterial,
		base: STATION_EMISSIVE_INTENSITIES.weldArc,
		kind: "work",
	});
	return group;
}

/**
 * The refinery's heat: a **vent bank**, and no plume.
 *
 * This shape has been wrong twice. It began as a tapered tube with an orange
 * cone on the end — a chimney with a flame drawn on it, which is what the
 * review called it, and which makes no sense in vacuum because nothing rises.
 * The second version kept a cone as a "plume thrown clear", which is the same
 * error wearing a different hat: **a steady flame needs an atmosphere to burn
 * in and something to hold its shape**. A gas vent in vacuum throws an
 * expanding cloud that thins to nothing in metres, and it is not a solid.
 *
 * So there is no plume. What remains is what a plant in vacuum would actually
 * show: a manifold lying along the hull, a row of nozzles down it, and the
 * throats glowing from the heat of what passed through them. The glow breathes
 * on the role's flicker, so the machine still reads as running.
 *
 * If a plume is ever wanted, it is a **particle system** — an emitter on each
 * nozzle, drawn as additive points that expand and fade — and it belongs with
 * the exhaust work, not here: a cone pretending to be a gas is exactly the
 * cheat this version removed.
 */
function buildVentBank(
	fixtures: StationFixture[],
	length: number,
	radius: number,
): THREE.Group {
	const stack = new THREE.Group();
	// Proportioned from its own length rather than from the old stack's tube
	// radius: a manifold `radius * 1.5` across was a rail, not a plant, and
	// disappeared into the rock it sits on.
	const across = length * 0.17;
	const manifold = shell(
		[
			{ z: -length * 0.34, w: across, h: across * 0.85, e: 5 },
			{ z: length * 0.38, w: across * 1.12, h: across * 0.95, e: 5 },
		],
		plainMaterial(0x8a7a66, 0.88, 0.14),
		"vent-manifold",
		6,
		true,
	);
	manifold.rotation.y = Math.PI / 2;
	stack.add(manifold);

	// Four nozzles down the manifold, angled outboard. Their number and spacing
	// is the same ruler the ring's modules are: repeated parts at a fixed pitch.
	const glow = emissiveMaterial(
		STATION_VISUALS.refinery.heatColor,
		STATION_EMISSIVE_INTENSITIES.off,
	);
	for (let i = 0; i < 4; i++) {
		const nozzle = shell(
			[
				{ z: 0, w: across * 0.42, h: across * 0.42, e: 4 },
				{ z: length * 0.34, w: across * 0.3, h: across * 0.3, e: 4 },
			],
			plainMaterial(0x6f665c, 0.9, 0.12),
			"vent",
			6,
			true,
		);
		nozzle.position.set(-length * 0.24 + i * length * 0.17, 0, across * 0.7);
		nozzle.rotation.x = -0.35;
		stack.add(nozzle);
		// The lit throat, sunk into the nozzle's mouth rather than standing at
		// the end of it: it is the inside of the pipe glowing, so it has to be
		// inside the pipe.
		const throat = new THREE.Mesh(
			new THREE.BoxGeometry(across * 0.5, across * 0.5, across * 0.2),
			glow,
		);
		throat.position.set(
			-length * 0.24 + i * length * 0.17,
			length * 0.3 * 0.34,
			across * 0.7 + length * 0.27,
		);
		throat.name = "flare";
		detail(throat, "reduced");
		stack.add(throat);
	}
	// One fixture for the bank, kind `flare`: it is the flare system's light,
	// and it is now the only light it has.
	fixtures.push({
		material: glow,
		base: STATION_EMISSIVE_INTENSITIES.refineryFlare,
		kind: "flare",
	});
	return stack;
}

/**
 * Nest a part in its own frame at `theta` about Z, turned to run radially.
 *
 * The five places that need this — the Ring's spoke members, the Slipway's
 * struts and slip heads, the Collar's clamps, the Derrick's legs — all want the
 * same thing and all got it wrong the same way first: setting `rotation.y` and
 * `rotation.z` on one object leaves the result to `Euler`'s order, and the
 * members come out clustered along a line instead of spaced round the axis.
 * Nested frames compose in the order they are nested and there is nothing to
 * reason about, which is worth having in one place rather than five.
 */
function radialArm(
	parent: THREE.Object3D,
	theta: number,
	name: string,
	child: THREE.Object3D,
) {
	const arm = new THREE.Group();
	arm.rotation.z = theta;
	arm.name = name;
	child.rotation.y = Math.PI / 2;
	arm.add(child);
	parent.add(arm);
	return arm;
}

/**
 * A radiator wing: a flat panel on a short stalk, standing off the rock.
 *
 * The refinery's silhouette cue, and it exists because removing the old flare
 * stacks removed one. §7 rests identity on outline and `probe-station.mjs`
 * measures it: with the stacks gone every refinery form fell to `1 − IoU`
 * 0.152, 0.174 and **0.025** against the trade station's cuboctahedron, on a
 * 0.25 floor. Head-on, a rounded rock and a rounded polyhedron are the same
 * shape however differently they are built — what separated them was always the
 * spindly things sticking out.
 *
 * So the outboard feature comes back, but as the one a plant in vacuum actually
 * needs. Nothing convects out here; heat leaves by radiating, and the area to do
 * it with is the largest thing on any real spacecraft that processes anything.
 * A flat panel is also the strongest silhouette shape available — a straight
 * edge against a lumpy rock — which is what the metric is measuring.
 */
function buildRadiator(spanKm: number, tilt: number): THREE.Group {
	const group = new THREE.Group();
	const stalk = shell(
		[
			{ z: 0, w: spanKm * 0.07, h: spanKm * 0.07, e: 4 },
			{ z: spanKm * 0.45, w: spanKm * 0.05, h: spanKm * 0.05, e: 4 },
		],
		plainMaterial(0x6f7d88, 0.8, 0.4),
		"radiator-stalk",
		4,
		true,
	);
	stalk.rotation.y = Math.PI / 2;
	group.add(stalk);
	// A spine down the panels' own axis, which is the thing that holds them.
	//
	// Without it the two outer panels touched nothing: they sit ±0.46 of a span
	// off the stalk's axis while the stalk is a fifteenth of a span thick, so
	// the wing was a stalk and three unattached plates. It passed the island
	// check on two forms only because the rock's bounding box happened to cover
	// them, which is the box proxy flattering a real defect.
	const spine = new THREE.Mesh(
		new THREE.BoxGeometry(spanKm * 0.1, spanKm * 0.06, spanKm * 1.06),
		plainMaterial(0x6f7d88, 0.8, 0.4),
	);
	spine.position.set(spanKm * 0.46, 0, 0);
	spine.name = "radiator-spine";
	group.add(spine);
	// Ribbed rather than one slab: the ribs are a fixed pitch, so the panel is
	// also a ruler for how big the station is.
	for (let i = 0; i < 3; i++) {
		const panel = new THREE.Mesh(
			new THREE.BoxGeometry(spanKm * 0.9, spanKm * 0.03, spanKm * 0.42),
			plainMaterial(0x5f6d78, 0.86, 0.3),
		);
		panel.position.set(spanKm * 0.82, 0, (i - 1) * spanKm * 0.46);
		panel.name = "radiator";
		group.add(panel);
	}
	group.rotation.z = tilt;
	return group;
}

/**
 * Refinery A — Warren. A cut face sliced into the rock, with terraced plant
 * inside it and the pad at the bottom of the cut.
 *
 * The plant is *inside* the asteroid rather than bolted onto it, which is the
 * round-one review's instruction: structure built into the rock. What the eye
 * gets is a machined notch in something that is otherwise plainly a rock.
 */
function buildRefineryWarren(color: number, berthSeed: number): BuiltPart {
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
			// **Uncut, because a refinery is a landing pad** (#165). #155 cut the
			// outermost terrace to open the bay behind it; #165 took the bay
			// away, so the hole now opens onto the plant's own inside. A pad is
			// landed *on*, and the surface a ship lands on is solid.
			undefined,
		);
		group.add(terrace);
	}
	group.add(
		buildAperture(
			"refinery",
			STATION_GEOMETRY.refinery.aperturePlaneKm,
			berthSeed,
		),
	);

	// **Stacks canted outward, not laid back.** Viewed down the aperture axis —
	// the one view a docking approach has — a rock with an inlaid cut is still a
	// rounded lump, and `probe-station.mjs` measured this against the trade
	// station's drum at 1 − IoU 0.216 on a 0.25 floor. §7 rests identity on
	// outline, so the machined half has to reach *into that view* rather than
	// sit flush in it.
	for (const [x, y, lean] of [
		[r * 0.86, r * 0.6, 0.55],
		[-r * 0.72, r * 0.78, -0.7],
	]) {
		const flare = buildVentBank(fixtures, r * 1.05, r * 0.07);
		flare.position.set(x, y, r * 0.36);
		flare.rotation.x = -Math.PI / 2.6;
		flare.rotation.y = lean;
		group.add(flare);
	}
	// **Three wings, not two.** The plume used to lend the outline a spike; with
	// it gone the Warren measured 1 − IoU 0.245 against the trade station on a
	// 0.25 floor, and identity is what §7 rests on. A third panel is also the
	// physically honest direction — radiator area is the thing a plant in vacuum
	// never has enough of — rather than a spike put back for the metric.
	for (const [tilt, at] of [
		[0.5, new THREE.Vector3(0, 0, 0)],
		[Math.PI - 0.45, new THREE.Vector3(0, 0, -r * 0.5)],
		[Math.PI * 1.42, new THREE.Vector3(0, 0, -r * 0.15)],
	] as [number, THREE.Vector3][]) {
		const wing = buildRadiator(r * 1.45, tilt);
		wing.position.copy(at);
		group.add(wing);
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
		portRun("refinery", 12, (i, count, position, normal) => {
			// Down the terraced face, so the cut reads as having levels rather
			// than as one lit slab. The terrace is six levels deep whatever the
			// count — the *steps* are the geometry — so a denser run puts more
			// ports on each level rather than more levels on the face.
			const { row, along } = rowsOf(i, count, 6);
			normal.set(0, 0, 1);
			position.set(
				(along - 0.5) * r * 1.1,
				r * 0.34 - row * r * 0.14,
				r * (0.66 + row * 0.06),
			);
		}),
	);
	// A plant is mostly plant, which is why this role carries the densest
	// figure. On the terraced face beside the ports, and on the arm — both
	// authored surfaces, both well clear of the pad's own corridor along +Z.
	group.add(
		greebleRun(
			"refinery",
			"refinery-a",
			[
				{
					count: 22,
					sizeKm: r * 0.075,
					reliefKm: r * 0.07,
					place: (i, count, position, normal) => {
						const { row, along } = rowsOf(i, count, 5);
						normal.set(0, 0, 1);
						position.set(
							(along - 0.5) * r * 1.3,
							r * 0.2 - row * r * 0.15,
							r * (0.6 + row * 0.06),
						);
					},
				},
			],
			group,
		),
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
function buildRefineryCollar(color: number, berthSeed: number): BuiltPart {
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
		radialArm(group, (i / 5) * Math.PI * 2, `clamp-${i}`, clamp);
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
			// Uncut: the pad is landed on rather than flown through (#165).
			undefined,
		),
	);
	group.add(buildAperture("refinery", r * 1.0, berthSeed));
	for (const side of [-1, 1]) {
		const flare = buildVentBank(fixtures, r * 0.9, r * 0.07);
		flare.position.set(side * major * 0.82, r * 0.42, 0);
		flare.rotation.x = -Math.PI / 2.6;
		flare.rotation.z = side * 0.35;
		group.add(flare);
	}
	for (const tilt of [Math.PI * 0.42, Math.PI * 1.1, Math.PI * 1.62]) {
		const wing = buildRadiator(r * 1.4, tilt);
		wing.position.z = -r * 0.3;
		group.add(wing);
	}
	group.add(buildHeatRing(fixtures, r * 0.44, r * 0.99));
	group.add(
		portRun("refinery", 12, (i, count, position, normal) => {
			const theta = (i / count) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			// On the band's own outer face, derived from it rather than guessed:
			// a fixed 1.22·r sat inside the rock once the band moved out.
			position.copy(normal).multiplyScalar(major + tube * 0.9);
			position.z = 0;
		}),
	);
	// Two rings of plant on the band's own faces, fore and aft of the port run.
	// The band is the machined part and the rock is not, so nothing here is
	// placed on the asteroid — noise does not know where anything is, which is
	// the same reason the pad had to be carved out of it.
	group.add(
		greebleRun(
			"refinery",
			"refinery-b",
			[
				{
					count: 20,
					sizeKm: tube * 0.4,
					reliefKm: tube * 0.36,
					place: (i, count, position, normal) => {
						const { theta, side } = ringAt(i, count);
						normal.set(Math.cos(theta), Math.sin(theta), 0);
						position.copy(normal).multiplyScalar(major + tube * 0.55);
						// 0.6 and not 0.75 of the tube: at 0.75 one piece of
						// twenty sat past the band's own cross-section and the
						// snap ray found nothing to put it on.
						position.z = side * tube * 0.6;
					},
				},
			],
			group,
		),
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
function buildRefinerySpar(color: number, berthSeed: number): BuiltPart {
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
			// Uncut: the pad is landed on rather than flown through (#165).
			undefined,
		),
	);
	group.add(buildAperture("refinery", r * 1.22, berthSeed));
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
		const flare = buildVentBank(fixtures, r * 0.85, r * 0.07);
		flare.position.set(side * r * 0.34, r * 0.3, -r * 1.5);
		flare.rotation.x = -Math.PI / 2.3;
		flare.rotation.z = side * 0.3;
		group.add(flare);
	}
	for (const tilt of [0.4, Math.PI - 0.4, Math.PI * 1.5]) {
		const wing = buildRadiator(r * 1.4, tilt);
		wing.position.z = -r * 0.75;
		group.add(wing);
	}
	group.add(buildHeatRing(fixtures, r * 0.42, r * 1.2));
	group.add(
		portRun("refinery", 10, (i, count, position, normal) => {
			const theta = (i / count) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(r * 0.32);
			position.z = -r * 1.15;
		}),
	);
	// Along the spar's shaft, on the far side of the rock from the pad. The one
	// form whose machinery pierces rather than wraps, so its clutter runs with
	// the shaft rather than round a band.
	group.add(
		greebleRun(
			"refinery",
			"refinery-c",
			[
				{
					count: 20,
					sizeKm: r * 0.09,
					reliefKm: r * 0.08,
					place: (i, count, position, normal) => {
						const theta = (i / count) * Math.PI * 2 * 2.5;
						normal.set(Math.cos(theta), Math.sin(theta), 0);
						position.copy(normal).multiplyScalar(r * 0.3);
						position.z = -r * 1.05 + (i / count) * r * 0.5;
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/** The heat ring round a refinery's docking face, breathing with the flare. */
function buildHeatRing(
	fixtures: StationFixture[],
	radius: number,
	z: number,
): THREE.Mesh {
	const material = emissiveMaterial(
		STATION_VISUALS.refinery.heatColor,
		STATION_EMISSIVE_INTENSITIES.off,
	);
	const glow = new THREE.Mesh(
		new THREE.TorusGeometry(radius, radius * 0.07, 6, 20),
		material,
	);
	glow.position.z = z;
	glow.name = "heat-glow";
	detail(glow, "reduced");
	fixtures.push({
		material,
		base: STATION_EMISSIVE_INTENSITIES.heatRing,
		kind: "work",
	});
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
	berthSeed: number,
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
		// **Uncut** (#165). #155 opened this plate on both faces so a ship could
		// fly through it into the bay behind; the principal's ruling took the
		// bay away — *"outposts don't have bays, just landing pads"* — and a
		// hole in a landing pad is a hole into the tank cluster underneath it.
		undefined,
	);
	group.add(deck);
	group.add(buildAperture("outpost", z, berthSeed));
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
function buildOutpostDerrick(color: number, berthSeed: number): BuiltPart {
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
	//
	// **The legs reach the deck they carry** (#165). They stopped at `r * 0.9`
	// and the deck's underside is at `r * 0.94`, so the pad stood 6 m clear of
	// its own tower — and `tests/station-mesh.test.ts`'s connectivity check was
	// green throughout, because §13's bay ran 234 m down through the middle of
	// the form and bridged the two. Take the bay away and the Derrick is two
	// islands, which is what a bay hiding a real defect looks like.
	for (let i = 0; i < 4; i++) {
		const theta = (i / 4) * Math.PI * 2 + Math.PI / 4;
		const leg = shell(
			[
				{ z: -r * 1.2, w: r * 0.08, h: r * 0.08, x: r * 0.46, e: 4 },
				{ z: r * 1.0, w: r * 0.06, h: r * 0.06, x: r * 0.28, e: 4 },
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
	group.add(
		buildPadDeck(
			fixtures,
			r,
			STATION_GEOMETRY.outpost.aperturePlaneKm,
			berthSeed,
		),
	);
	// Rooted **on a tank**, not beside the cluster: the tanks sit on a 0.42·r
	// circle and are 0.34·r across, so a boom starting at 0.6·r began in empty
	// space and the whole flare was a detached island.
	const flare = buildVentBank(fixtures, r * 0.9, r * 0.08);
	flare.position.set(r * 0.42, -r * 0.42, -r * 1.3);
	flare.rotation.x = -Math.PI / 2.4;
	flare.rotation.y = 0.5;
	group.add(flare);
	group.add(
		portRun("outpost", 6, (i, count, position, normal) => {
			// Two rows across the tank cluster's underside, centred on the axis
			// and spanning 0.9·r·(perRow−1)/perRow — 0.75·r at the twelve that
			// ship. Stated as it is rather than as "the same" span: the run this
			// replaces covered 0.6·r, and a comment that rounds its own
			// arithmetic is the kind that gets believed.
			const { row, along } = rowsOf(i, count, 2);
			normal.set(0, 0, 1);
			position.set(
				(along - 0.5) * r * 0.9,
				row === 0 ? r * 0.32 : -r * 0.32,
				-r * 1.09,
			);
		}),
	);
	// Sparse, and on the tank cluster rather than on the lattice: the coarse
	// plating above is there to say *small*, and clutter strung through an open
	// tower would blur the one silhouette this category has.
	group.add(
		greebleRun(
			"outpost",
			"outpost-a",
			[
				{
					count: 12,
					sizeKm: r * 0.13,
					reliefKm: r * 0.1,
					place: (i, count, position, normal) => {
						// **On a tank's own outward flank**, derived from where
						// the cluster actually is. A run round the axis at
						// 0.42·r — the tanks' *centre* circle — at z = −1.0·r
						// sat in the gap above them, where the snap ray finds
						// nothing and every piece stayed where it was written.
						// The four tanks are at 0.42·r from the axis, 0.34·r
						// half-wide, and span −1.9·r to −1.1·r.
						const tank = (Math.floor(i / 3) % 4) * (Math.PI / 2);
						normal.set(Math.cos(tank), Math.sin(tank), 0);
						position
							.copy(normal)
							.multiplyScalar(r * (0.42 + 0.34))
							.setZ(-r * 1.75 + ((i % 3) + 0.5) * r * 0.2);
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/** Outpost B — Buoy. A stubby drum wearing radiator fins, pad on the face.
 *  The category's compact end: a single machine with nothing hanging off it,
 *  which is what a relay or a survey station would actually be. */
function buildOutpostBuoy(color: number, berthSeed: number): BuiltPart {
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
	group.add(buildPadDeck(fixtures, r, r * 1.0, berthSeed));
	group.add(
		portRun("outpost", 6, (i, count, position, normal) => {
			const theta = (i / count) * Math.PI * 2;
			normal.set(Math.cos(theta), Math.sin(theta), 0);
			position.copy(normal).multiplyScalar(r * 0.88);
			position.z = -r * 0.3;
		}),
	);
	// On the drum's own waist, between the fins. Behind the pad, so nothing
	// added here can reach the deck a ship touches down on.
	group.add(
		greebleRun(
			"outpost",
			"outpost-b",
			[
				{
					count: 12,
					sizeKm: r * 0.12,
					reliefKm: r * 0.09,
					place: (i, count, position, normal) => {
						const { theta } = ringAt(i, count);
						normal.set(Math.cos(theta), Math.sin(theta), 0);
						position.copy(normal).multiplyScalar(r * 0.84);
						position.z = -r * 0.85 + (i % 3) * r * 0.3;
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/** Outpost C — Rig. An angled truss carrying a deck out over a drill head, a
 *  flare boom off the back. The one form of the three that is plainly working
 *  *on* something rather than sitting in space. */
function buildOutpostRig(color: number, berthSeed: number): BuiltPart {
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
	//
	// **Both of these were adrift.** The head hung 90 m clear of the body with
	// only a 1 m graze of bounding box between them, and the braces missed it
	// entirely on x — they ran at ±0.06·r while the head is 0.24·r wide about
	// the axis, so nothing in the assembly actually reached it. It looked
	// exactly like what it was: a cone floating under two sticks.
	//
	// The head starts inside the body's envelope now and the braces converge
	// onto it, so the three overlap rather than line up.
	const head = shell(
		[
			{ z: -r * 0.75, w: r * 0.26, h: r * 0.26, e: 4 },
			{ z: r * 0.1, w: r * 0.16, h: r * 0.16, e: 4, hard: true },
			{ z: r * 0.5, w: r * 0.05, h: r * 0.05, e: 4 },
		],
		plainMaterial(0x8b95a0, 0.7, 0.42),
		"drill",
		6,
		true,
	);
	head.rotation.x = Math.PI / 2;
	head.position.set(0, -r * 1.05, -r * 0.35);
	group.add(head);
	for (const side of [-1, 1]) {
		const brace = shell(
			[
				{ z: 0, w: r * 0.07, h: r * 0.06, e: 4 },
				// Converging: the far station carries a lateral offset back
				// towards the axis, so the brace ends *on* the head rather than
				// beside it.
				{ z: r * 0.95, w: r * 0.05, h: r * 0.04, x: side * -r * 0.28, e: 4 },
			],
			plainMaterial(0x6f7d88, 0.8, 0.4),
			"brace",
			4,
			true,
		);
		brace.rotation.x = Math.PI / 2;
		brace.position.set(side * r * 0.4, -r * 0.25, -r * 0.35);
		group.add(brace);
	}
	group.add(buildPadDeck(fixtures, r, r * 0.95, berthSeed));
	const flare = buildVentBank(fixtures, r * 1.0, r * 0.08);
	flare.position.set(-r * 0.55, r * 0.75, -r * 1.1);
	flare.rotation.x = -Math.PI / 2.2;
	flare.rotation.y = -0.5;
	group.add(flare);
	group.add(
		portRun("outpost", 6, (i, count, position, normal) => {
			// The body is pitched 0.34 rad about X and is 0.62·r half-wide, so a
			// run at 0.64·r cleared it entirely. Inside its own beam, and pitched
			// with it. The run covers 1.2·r of beam scaled by `(count − 1)/count`
			// at any count — 1.1·r at the twelve this ships; the old
			// `i * r * 0.2` stride walked off the end of it instead.
			normal.set(1, 0, 0);
			const z = -r * 0.7 + (i / count) * r * 1.2;
			position.set(r * 0.5, r * 0.2 + z * 0.34, z);
		}),
	);
	// Down the beam's other flank, mirroring the port run and pitched with the
	// body the same way — the fix that run records applies to anything else
	// mounted on it.
	group.add(
		greebleRun(
			"outpost",
			"outpost-c",
			[
				{
					count: 12,
					sizeKm: r * 0.1,
					reliefKm: r * 0.08,
					place: (i, count, position, normal) => {
						normal.set(-1, 0, 0);
						const z = -r * 0.9 + (i / count) * r * 1.4;
						position.set(-r * 0.5, r * 0.2 + z * 0.34, z);
					},
				},
			],
			group,
		),
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
/**
 * The cell pitch of the modular assembly, kilometres, and the module radii as
 * fractions of it. 0.2 km puts a 96 m habitat tube in each cell, which is
 * the ISS's proportion at the scale the other trade forms are drawn to, and
 * makes the eleven-cell diamond 1.8 km across the spine.
 */
const MODULAR_CELL_KM = 0.2;

/**
 * Trade D — Assembly. A compact hub carrying the slot, a truss spine along
 * ±Y, and modules solved onto a diamond of cells by wave function collapse
 * (`station-modular.ts`, on seekolous's solver): habitat tubes docked end to
 * end with a collar at every joint, junction drums, lattice beams, and leaves
 * hung off them — radiator banks standing out of the plane, tank racks on
 * pallets, a mast with a dish. The ISS as a grammar rather than a silhouette,
 * which is the principal's ask for this round.
 *
 * **What spins is the hub**, for the shipyard's reason (§7.2): the slot is on
 * the spin axis, and a 1.8 km assembly spun about it would change the
 * station's projected width with the clock. The bay is inside the hub, so a
 * berth turns with the slot. The hub is sized from the bay it has to hold —
 * `stationInterior("trade")` wants 0.14 × 0.115 km from z = 0.023 to the
 * mouth — and no wider, so the modules read as the station and the hub as
 * the thing they dock to.
 *
 * **The plan is the berth seed's.** `buildStationForm` carries no station
 * identity but that draw, and it is per station and deterministic, which is
 * what the plan needs: two clients at one seed build one station, and a
 * station keeps its shape across visits. A finer identity is #202's "seed by
 * station id" and lands with it.
 *
 * Every module is the hub's colour where it is a hull and unpainted grey
 * where it is structure, so §7's colour cue survives the form.
 */
function buildTradeModular(color: number, berthSeed: number): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const c = MODULAR_CELL_KM;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const { placements } = modularPlacements(berthSeed);
	const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
	const plane = STATION_GEOMETRY.trade.aperturePlaneKm;
	const structure = plainMaterial(0x6f7d88, 0.78, 0.42);

	// The hub, and it spins: a twelve-sided drum with the slot cut into its
	// +Z cap, 0.34·r across — the smallest drum the bay fits in with a wall.
	const hubR = r * 0.34;
	const spun = new THREE.Group();
	spun.name = "spun";
	spun.add(
		shell(
			[
				{ z: -r * 0.3, w: hubR * 0.78, h: hubR * 0.78, e: 2 },
				{ z: -r * 0.2, w: hubR, h: hubR, e: 2, hard: true },
				{ z: r * 0.6, w: hubR, h: hubR, e: 2, hard: true },
				{ z: plane, w: hubR * 0.92, h: hubR * 0.92, e: 2 },
			],
			hullMaterial(color, "trade"),
			"core",
			12,
			true,
			apertureCut("trade"),
		),
	);
	spun.add(buildAperture("trade", plane, berthSeed));
	group.add(spun);

	const pools = new Pools();
	const tubeR = c * 0.24;
	const tubes: Placement[] = [];
	/** The unit vector of a `DIRECTIONS` index, in the grid's plane. */
	const toward = (dir: number) => V(DIRECTIONS[dir][0], DIRECTIONS[dir][1], 0);
	/** A docking collar on a tube's or the hub's port. */
	const collar = (at: THREE.Vector3, axis: "x" | "y", radius: number) => {
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(radius * 1.02, radius * 0.12, 4, 16),
			structure,
		);
		ring.position.copy(at);
		if (axis === "x") ring.rotation.y = Math.PI / 2;
		else ring.rotation.x = Math.PI / 2;
		ring.name = "collar";
		group.add(ring);
	};
	for (const p of placements) {
		const cx = p.dx * c;
		const cy = p.dy * c;
		const centre = V(cx, cy, 0);
		switch (p.module) {
			case HUB:
				// The hub's own ports, where a tube or a truss runs into it.
				for (let dir = 0; dir < 4; dir++)
					if (p.joined[dir])
						collar(
							toward(dir).multiplyScalar(hubR * 0.96),
							dir < 2 ? "x" : "y",
							tubeR * 1.15,
						);
				break;
			case TUBE_X:
			case TUBE_Y: {
				const tube = shell(
					[
						{ z: -c * 0.5, w: tubeR * 0.8, h: tubeR * 0.8, e: 2, hard: true },
						{ z: -c * 0.42, w: tubeR, h: tubeR, e: 2, hard: true },
						{ z: c * 0.42, w: tubeR, h: tubeR, e: 2, hard: true },
						{ z: c * 0.5, w: tubeR * 0.8, h: tubeR * 0.8, e: 2 },
					],
					hullMaterial(color, "trade"),
					`module-${p.dx}-${p.dy}`,
					12,
					true,
				);
				if (p.module === TUBE_X) tube.rotation.y = Math.PI / 2;
				else tube.rotation.x = Math.PI / 2;
				tube.position.copy(centre);
				group.add(tube);
				// A collar on every docked end, along the tube's own axis only.
				const axisDirs = p.module === TUBE_X ? [0, 1] : [2, 3];
				for (const dir of axisDirs)
					if (p.joined[dir])
						collar(
							centre.clone().addScaledVector(toward(dir), c * 0.5),
							p.module === TUBE_X ? "x" : "y",
							tubeR,
						);
				tubes.push(p);
				break;
			}
			case NODE: {
				const node = shell(
					[
						{ z: -c * 0.28, w: c * 0.3, h: c * 0.3, e: 2, hard: true },
						{ z: c * 0.28, w: c * 0.3, h: c * 0.3, e: 2 },
					],
					hullMaterial(color, "trade"),
					`node-${p.dx}-${p.dy}`,
					12,
					true,
				);
				node.position.copy(centre);
				group.add(node);
				// A docking stub out to the cell's edge on every joined side, with
				// a collar: the drum is 0.3 cells across and its neighbour starts
				// at 0.5, and `tests/station-mesh.test.ts`'s island check read a
				// tip node as adrift of the tube it was meant to be docked to.
				for (let dir = 0; dir < 4; dir++) {
					if (!p.joined[dir]) continue;
					const stub = shell(
						[
							{
								z: c * 0.2,
								w: tubeR * 0.85,
								h: tubeR * 0.85,
								e: 2,
								hard: true,
							},
							{ z: c * 0.5, w: tubeR * 0.85, h: tubeR * 0.85, e: 2 },
						],
						hullMaterial(color, "trade"),
						`node-stub-${p.dx}-${p.dy}-${dir}`,
						12,
						true,
					);
					// The loft runs along +Z; turn it onto the stub's direction.
					stub.quaternion.setFromUnitVectors(
						new THREE.Vector3(0, 0, 1),
						toward(dir),
					);
					stub.position.copy(centre);
					group.add(stub);
					collar(
						centre.clone().addScaledVector(toward(dir), c * 0.5),
						dir < 2 ? "x" : "y",
						tubeR * 0.85,
					);
				}
				break;
			}
			case TRUSS_X:
			case TRUSS_Y: {
				const axis = toward(p.module === TRUSS_X ? 1 : 3);
				truss(
					pools,
					centre.clone().addScaledVector(axis, -c * 0.5),
					centre.clone().addScaledVector(axis, c * 0.5),
					c * 0.22,
					V(0, 0, 1),
				);
				break;
			}
			case RADIATOR: {
				// A spine from the host's edge across the cell, panels on it
				// standing out of the plane both ways.
				const host = p.host < 0 ? 1 : p.host;
				const away = toward(host).negate();
				const origin = centre.clone().addScaledVector(toward(host), c * 0.5);
				for (const up of [V(0, 0, 1), V(0, 0, -1)])
					radiatorArray(pools, origin, away, up, 4, c * 0.4, c * 0.4);
				break;
			}
			case TANKS: {
				const host = p.host < 0 ? 1 : p.host;
				// A stub from the host's edge to the rack.
				truss(
					pools,
					centre.clone().addScaledVector(toward(host), c * 0.5),
					centre,
					c * 0.1,
					V(0, 0, 1),
				);
				tankRack(
					pools,
					centre.clone().add(V(0, 0, -c * 0.1)),
					toward(host),
					V(0, 0, 1),
					3,
					c * 0.09,
					c * 0.7,
				);
				break;
			}
			case DISH: {
				const host = p.host < 0 ? 1 : p.host;
				truss(
					pools,
					centre.clone().addScaledVector(toward(host), c * 0.5),
					centre,
					c * 0.1,
					V(0, 0, 1),
				);
				mast(pools, group, centre, V(0, 0, 1), c * 0.6, c * 0.12);
				break;
			}
		}
	}
	pools.emit(group, "module");

	// Lit ports along the +Z face of every habitat tube: they are where the
	// crew lives, and a plan with more tubes has more windows.
	group.add(
		portRun("trade", tubes.length * 2, (i, count, position, normal) => {
			const perTube = Math.max(1, Math.ceil(count / tubes.length));
			const tube = tubes[i % tubes.length];
			const slot = (Math.floor(i / tubes.length) + 0.5) / perTube;
			// Along the tube's own axis, in its **outboard** half: the two
			// planted tubes sit against the hub, and a port on their inboard
			// half is inside 0.4 of the core radius — where
			// `tests/station-mesh.test.ts` reads a pane as buried rather than
			// out on a shell.
			const outboard = toward(
				tube.module === TUBE_X ? (tube.dx >= 0 ? 1 : 0) : tube.dy >= 0 ? 3 : 2,
			);
			normal.set(0, 0, 1);
			position
				.set(tube.dx * c, tube.dy * c, tubeR * 0.98)
				.addScaledVector(outboard, (0.25 + slot * 0.2) * c);
		}),
	);
	// The strobes on the spine's two ends, which are the assembly's beam.
	group.add(
		strobePair("trade", fixtures, r * 0.06, (side, position) => {
			position.set(0, side * (MODULAR_RADIUS * c + c * 0.5), 0);
		}),
	);
	// Clutter on the hub's own flank, between the ports of its docked tubes.
	group.add(
		greebleRun(
			"trade",
			"trade-d",
			[
				{
					count: 16,
					sizeKm: hubR * 0.09,
					reliefKm: hubR * 0.08,
					place: (i, count, position, normal) => {
						const { theta } = ringAt(i, count);
						normal.set(Math.cos(theta), Math.sin(theta), 0);
						// Two bands above the docking collars, which sit at z = 0 and
						// stand proud of the drum: a piece snapped onto a collar's
						// rim has no drum under it within its own height.
						position
							.copy(normal)
							.multiplyScalar(hubR)
							.setZ(r * 0.14 + (i % 2) * r * 0.2);
					},
				},
			],
			group,
		),
	);
	return { group, fixtures, spinner: spun };
}

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
		{
			id: "d",
			name: "Assembly",
			thesis:
				"a hub and a truss spine with modules solved onto a grid by wave function collapse",
			// The diamond's tips are 0.9 km out along the spine, and a leaf
			// beside a tip reaches 0.89; the strobes sit at 0.9. Nothing on the
			// field can pass 1.0, and `tests/station-mesh.test.ts` measures
			// every plan the tests build against it.
			reachKm: 1.0,
			build: buildTradeModular,
		},
	],
	shipyard: [
		{
			id: "a",
			name: "Gantry",
			thesis: "bridge keel under open ribbed bays sized for a ship",
			// **1.53 rather than #28's 1.5, and the 30 m is the keel's move
			// aft** (#165). The keel's far end is `hypot(1.426, 0.120, 0.156)`
			// from the centre and reached 1.479 km; carried aft by
			// `SHIPYARD_KEEL_AFT_KM` it reaches 1.516. There is no shift that
			// clears the bay inside 1.5 — the keel's forward face is already
			// 270 m proud of the axis where the bay's back wall stands — so the
			// declaration follows the decided shape rather than the shape being
			// trimmed to an old declaration. `docking.md` §5's "roughly 1.5 km"
			// is unchanged by 2%.
			reachKm: 1.53,
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
	refinery: [
		{
			id: "a",
			name: "Warren",
			thesis: "terraced plant cut into the rock; the pad is in the notch",
			reachKm: 1.2,
			build: buildRefineryWarren,
		},
		{
			id: "b",
			name: "Collar",
			thesis: "a machined band gripping the rock at its waist",
			reachKm: 1.15,
			build: buildRefineryCollar,
		},
		{
			id: "c",
			name: "Spar",
			thesis: "a processing spar run through the rock and out the far side",
			reachKm: 1.15,
			build: buildRefinerySpar,
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
	// **Placeholder, and it says so.** This role was never ranked — round one
	// sent it back with an instruction rather than an order — so `a` is first in
	// the list and nothing more.
	//
	// It used to carry a justification: the Warren was chosen because it cleared
	// the outline floor `probe-station.mjs` gated on, where the other two did
	// not. That gate was withdrawn later in the same node, so the reasoning
	// outlived the thing it reasoned about. The figures are still measured and
	// printed; they are no longer a reason to pick one form over another.
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
	// **Required, not defaulted.** A default of 0 is the mismatch this parameter
	// exists to prevent — a bay drawn at seed 0 while `interiorOfStation` reads
	// the station's own draw puts a ship on a berth with no pad — and a default
	// turns that into a silent wrong answer rather than a compile error.
	berthSeed: number,
): StationMesh {
	const form = formOf(type, formId);
	// The builder returns its own fixtures rather than filling an array handed
	// to it: with an out-parameter the return type said a builder produced no
	// lights while it in fact produced most of them, so a fourth station type
	// would have compiled with none and lit nothing.
	const built = form.build(color, berthSeed);
	// #202's macro structure, on the finishes that carry it. Added to the
	// built group after the form so the fixtures can be cast onto the structure
	// that exists, and inside it rather than beside it so a role that spins
	// whole turns its trusses with it; a shipyard's static frame is the group
	// too, and its hub spins inside.
	const finish = currentStationFinish();
	if (finish.fixtures)
		built.group.add(
			buildMacroFixtures({
				type,
				formId,
				structure: built.group,
				fixtures: built.fixtures,
				beacons:
					finish.beacons && STATION_VISUALS[type].activity.strobePeriodS > 0,
				strobeBase: STATION_EMISSIVE_INTENSITIES.strobe,
				lampBase: STATION_EMISSIVE_INTENSITIES.aperture,
			}),
		);
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
	const nameplates: THREE.Mesh[] = [];
	const greebles: THREE.InstancedMesh[] = [];
	root.traverse((object) => {
		if (object.userData.minDetail) accessories.push(object);
		if (object.name === NAMEPLATE_NAME && object instanceof THREE.Mesh)
			nameplates.push(object);
		const instanced = object as THREE.InstancedMesh;
		if (instanced.isInstancedMesh && object.name.startsWith("greebles-"))
			greebles.push(instanced);
	});
	const mesh: StationMesh = {
		root,
		spinner,
		type,
		detail: "full",
		fixtures: built.fixtures,
		accessories,
		nameplates,
		greebles,
		// One call, and the ledger of what a system owns is `shared()` at the
		// lines that build the kept things rather than a list here (#187).
		dispose: () => disposeSubtree(root),
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
	berthSeed: number,
): StationMesh {
	return buildStationForm(type, SELECTED_FORM[type], color, berthSeed);
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
	/**
	 * #98's quality key (#102 §5) — low drops the greeble geometry and keeps
	 * every emissive.
	 *
	 * Written every frame rather than on change, which is three boolean stores
	 * per station and buys the thing a registry of live meshes would have cost a
	 * leak for: the setting is live, and a station built while it was low comes
	 * up correct on its first frame without a boot-time pass of its own.
	 *
	 * **Required, not defaulted.** A default is convenient for the callers that
	 * predate the key and it is exactly what would let a second render path be
	 * added later that draws the clutter at low with nothing to say so. The
	 * pre-existing test call sites pass `"high"` explicitly instead.
	 */
	quality: StationQuality,
): void {
	const level = stationDetailLevel(
		mesh.detail,
		distanceKm / STATION_SILHOUETTE_KM[mesh.type],
	);
	if (level !== mesh.detail) setStationDetail(mesh, level);

	const drawGreebles = STATION_QUALITY[quality].greebles;
	for (const instanced of mesh.greebles) instanced.visible = drawGreebles;

	// **Every fixture, at every level.** An earlier version returned early at
	// `outline` on the reasoning that nothing clock-driven is drawn there — which
	// is false for the refinery's flare, the one fixture deliberately left
	// untagged, back when it was a flame whose tip was the station's outermost
	// point. Its intensity froze at whatever the last near-range frame wrote, so
	// a distant refinery's flare depended on that client's approach history
	// rather than on the clock, and §5.2's "two clients at one seed draw the
	// same frame" was not true of it. The flare is a tagged throat now and the
	// hidden case is ordinary, but driving every fixture regardless costs a
	// couple of float writes a frame and removes the whole class of bug.
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
