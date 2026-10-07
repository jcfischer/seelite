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
 * `STATION_FORM_POOL` names the forms a system may build each role in, and the
 * system's own seed picks one per station (node #717) — one line per role, so
 * growing a pool is one edit.
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
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	BLINKING_CORE_GAIN,
	BLINKING_HALO_GAIN,
	type GlowClass,
	glowMaterial,
	glowPoints,
	poolMaterial,
	poolMesh,
	steadyGlowMaterial,
	glowOnFitting,
} from "./station-glow";
import { mutePaint } from "./surface";
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
	type StationFormId,
	type StationPlan,
	type StationType,
} from "./station";
import { type GreebleZone, buildGreebles } from "./station-greebles";
import {
	Pools,
	SHIP_SCALE,
	buildMacroFixtures,
	mast,
	pipeRun,
	radiatorArray,
	tankRack,
	truss,
} from "./station-fixtures";
import {
	DISH,
	HUB,
	NODE,
	type Placement,
	RADIATOR,
	TANKS,
	TRUSS_X,
	TRUSS_Y,
	TUBE_X,
	TUBE_Y,
	hostDirOf,
	isHost,
	modularPlacements,
	placementsOf,
} from "./station-modular";
import {
	OUTPOST,
	OUTPOST_VOCABULARY,
	REFINERY,
	REFINERY_RADIUS,
	REFINERY_VOCABULARY,
	SALVAGE_CORE,
	WORKS_CELL_KM,
	WORKS_FLOOR_KM,
} from "./station-plant";
import { DIRECTIONS } from "./wfc";
import { mix, seededRand } from "./rng";
import {
	STATION_QUALITY,
	STATION_VISUALS,
	type StationQuality,
	type StationFixtureKind,
	currentStationFinish,
	fixtureIntensity,
	flickerIntensity,
	platingTexels,
	seamTexels,
	stationFinishId,
	stationMapSize,
	stationPlating,
	surfaceTexels,
} from "./station-visuals";
import { type DetailLevel, detailLevel } from "./detail-level";
import {
	NAMEPLATE_NAME,
	buildStationInterior,
	ringAround,
	ringInsideAperture,
} from "./station-interior-mesh";
import { stationInterior } from "./station-interior";
import { disposeSubtree, isShared, shared } from "./gpu-teardown";

/**
 * How far one form's *drawn* object reaches, kilometres — its own declared
 * reach: an outboard frame, a captured asteroid, a radiator wing.
 *
 * Here rather than in `STATION_GEOMETRY`, and that is the point: `docking.md`
 * §5 says the frame is silhouette and not dockable geometry, and #9's checks
 * read the geometry record. An invariant enforced by a comment inside the
 * struct it forbids is one edit from being false; a separate table that docking
 * never imports cannot be read by accident.
 *
 * **Per form, and so per station** (node #717). This was `STATION_SILHOUETTE_KM`,
 * a per-type table memoised on the one form each role flew. Once a system
 * picks a station's form from a pool, two stations of one type may differ in
 * reach, and a per-type memo answers for one of them. The renderer reads the
 * figure off the station's own handle (`StationMesh.silhouetteKm`), which is
 * this function evaluated once at build.
 *
 * A **budget, not a description**: `tests/station-mesh.test.ts` asserts no
 * vertex of a built station lies outside it, for every form in every pool, so
 * a frame or a flare stack cannot quietly grow.
 *
 * **It is an intention, and it used to be a measurement.** #28 wrote four
 * literals here and warned that reading them as design constraints would be
 * reading a measurement as an intention. Every figure is now a **declared**
 * `reachKm` on a form — a number an author chose before building the shape,
 * which the form is then measured against. That is the direction a budget
 * should run. What the test does *not* do is insist the shape fills its
 * declaration: the floor is 60% of it, which catches a declaration nothing
 * approaches without pretending the fit is tight.
 */
export function stationSilhouetteKm(
	type: StationType,
	formId: StationFormId,
): number {
	return formOf(type, formId).reachKm;
}

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
	/** Which type built it, so `updateStationVisuals` can reach the profile
	 *  without the caller carrying it. */
	type: StationType;
	/** Which form built it — the station's own `formId` (node #717), never a
	 *  per-type default. */
	formId: StationFormId;
	/** How far this station's drawn object reaches, kilometres:
	 *  `stationSilhouetteKm` of its own form, read once at build. The detail
	 *  band measures range in this, so two stations of one role in different
	 *  forms drop detail at their own apparent size. */
	silhouetteKm: number;
	/** The detail level currently drawn. Held on the handle rather than
	 *  recomputed, because `stationDetailLevel` is directional — the previous
	 *  level is half of its input (`station-visuals.ts` §3). */
	detail: DetailLevel;
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
	/** Where in its waveform this light sits, seconds: a chase lamp's place
	 *  round the mouth, zero for everything that flashes as its kind does. */
	offsetS: number;
	/**
	 * The glare this light is seen by at range, when it has one (#300).
	 * Written beside `material.emissiveIntensity` every frame and never brighter
	 * than it — `station-glow.ts` has why a real-sized fitting needs one, and
	 * `tests/station-glow.test.ts` holds the two equal.
	 */
	glow?: THREE.ShaderMaterial;
	/** The pool of light a surface-mounted blinking lamp lays round itself
	 *  (#300), driven beside its glow. */
	pool?: THREE.ShaderMaterial;
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
/**
 * Build every role's maps now rather than on the first station of that role.
 * A role's maps are built once per process on its first `buildStationMesh`,
 * which is inside a system's populate at a jump; under `worn` that is
 * 32-47 ms a role (sage, round 5), a hitch on a jump. `main.ts` calls this
 * at boot beside the player's hull, where a one-off cost belongs.
 */
export function warmStationMaps() {
	for (const type of STATION_TYPES) mapsFor(type);
}

const mapsFor = (type: StationType) => {
	// Keyed by **what the maps are made from** — the role, the map size and
	// the plating profile — rather than by the finish: `plated` and
	// `industrial` share all three, and a key per finish generated the same
	// maps twice on a workbench switch (37–57 ms and 768 KiB a role, sage
	// measured) and kept both. A finish with its own profile gets its own
	// entry; the game only ever fills one key per role.
	const key = `${type}:${stationMapSize()}:${JSON.stringify(stationPlating(type))}`;
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
		// The role's paint under the finish's dial — as authored on the
		// finishes whose dial is 1 and 1, which is every finish before
		// `nostromo`.
		color: mutePaint(color, currentStationFinish().paint),
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
 * Real-size station fittings, kilometres (#300).
 *
 * **The principal's ruling on #300's first sheet**: every light was *"way too
 * big — think about how big a light would be on a station that is several km
 * big"*. They were a 42 m strobe, a 30 × 12 m pane, a 156 m flood and a 60 m
 * welding arc. These are what the real fittings are, and `station-glow.ts` is
 * how a fitting this small is seen from the approach at all.
 */
export const FITTING_KM = Object.freeze({
	/** A strobe lamp's cube edge. */
	strobe: 0.002,
	/** A window pane: width, height, depth. */
	pane: Object.freeze([0.003, 0.0015, 0.0005] as const),
	/** A floodlight: its long face, its short face, its depth. */
	flood: Object.freeze([0.004, 0.001, 0.002] as const),
	/** The welding arc's radius — the spark itself is centimetres; this is
	 *  the lit ball of plasma and spatter round it. */
	arcRadius: 0.0005,
	/** A flare throat's lit face, at most — a small bank's mouth is narrower. */
	throat: 0.008,
});

/** A driven fixture's glow: its own material, so the clock can write it. */
function drivenGlow(
	color: number,
	glowClass: GlowClass,
	core: number,
	halo: number,
) {
	return glowMaterial(
		color,
		STATION_EMISSIVE_INTENSITIES.off,
		glowClass,
		core,
		halo,
	);
}

/** A blinking light's glow: the `blink` class, its hot core and its glare. */
function blinkingGlow(color: number) {
	return drivenGlow(color, "blink", BLINKING_CORE_GAIN, BLINKING_HALO_GAIN);
}

/**
 * Lay a pool of light on the surface a lamp is mounted on, and return its
 * material for the clock to drive (#300). The lamp is centred on its surface,
 * so the pool sits a hand's breadth proud of the lamp's own origin.
 */
function withPool(
	lamp: THREE.Object3D,
	radiusKm: number,
	color: number,
): THREE.ShaderMaterial {
	const material = poolMaterial(color);
	lamp.add(poolMesh(lamp.name, radiusKm, 0.0003, material));
	return material;
}

/**
 * The radius of the pool of light a blinking lamp lays, kilometres, by the
 * surface it stands on (#300's review). A pool has to lie on that surface —
 * `tests/station-glow.test.ts` casts from its disc and fails one hanging off an
 * edge or a curve — so a broad flat face takes the widest, and a 24 m aperture
 * frame bar or a faceted tube a narrower one.
 */
const LAMP_POOL_KM = Object.freeze({ face: 0.025, bar: 0.01, tube: 0.01 });

const PLUS_Z = new THREE.Vector3(0, 0, 1);

/**
 * One blinking lamp: its housing, its glow, its pool if it stands on a face,
 * and its fixture record (#300). The mouth ring, the strobe pair and the
 * obstruction beacon were three copies of this.
 *
 * **Seated by a surface point and its outward normal**, the way `portRun`
 * places a pane. The lamp's local +Z is turned onto the normal, so its pool —
 * a disc in the lamp's own XY plane — lies on that surface; a lamp that was
 * only moved laid its pool edge-on through a curved hull. Centred on the point,
 * so it is half sunk into the face it is bolted to.
 */
function blinkingLamp(
	fixtures: StationFixture[],
	color: number,
	name: string,
	kind: StationFixtureKind,
	offsetS: number,
	at: THREE.Vector3,
	normal: THREE.Vector3,
	/** Its pool's radius, or `null` for a lamp on a tip with no face round it. */
	poolKm: number | null,
	/** The housing's depth along its normal, as a fraction of its size. */
	depth: number,
): THREE.Mesh {
	const size = FITTING_KM.strobe;
	const material = emissiveMaterial(color, STATION_EMISSIVE_INTENSITIES.off);
	const lamp = new THREE.Mesh(
		new THREE.BoxGeometry(size, size, size * depth),
		material,
	);
	lamp.position.copy(at);
	lamp.quaternion.setFromUnitVectors(PLUS_Z, normal.clone().normalize());
	lamp.name = name;
	detail(lamp, "reduced");
	const glow = blinkingGlow(color);
	glowOnFitting(lamp, size, glow);
	const pool = poolKm === null ? undefined : withPool(lamp, poolKm, color);
	fixtures.push({
		material,
		base: STATION_EMISSIVE_INTENSITIES.strobe,
		kind,
		offsetS,
		glow,
		pool,
	});
	return lamp;
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
		/**
		 * Which way the pane's own long axis runs, **optional** (#300).
		 *
		 * Left alone, the pane is turned by `setFromUnitVectors(+Z, normal)`,
		 * which is what every run in this file has always got: the roll is
		 * whatever that produces, and for a face whose normal is +Z it is none
		 * at all, so the 30 m axis lies along world X. That is fine on a
		 * rectangular face and wrong on a **ring**, where a run round a slot or
		 * a pad wants each pane laid along its own tangent or its own radius.
		 *
		 * Opt-in rather than defaulted, and deliberately: handing every caller
		 * an explicit basis would re-roll every pane on all twelve forms, which
		 * is a silent repaint of work already judged on a sheet.
		 */
		tangent: THREE.Vector3,
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
	const glowAt: THREE.Vector3[] = [];
	const tangent = new THREE.Vector3();
	const basis = new THREE.Matrix4();
	const across = new THREE.Vector3();
	const along = new THREE.Vector3();
	for (let i = 0; i < count; i++) {
		tangent.set(0, 0, 0);
		place(i, count, position, normal, tangent);
		if (tangent.lengthSq() === 0) quaternion.setFromUnitVectors(unitZ, normal);
		else {
			// Gram-Schmidt against the normal rather than trusting the caller to
			// hand back something perpendicular: a tangent taken from a radius
			// on a sloped face is not, and the result would be a sheared pane
			// rather than a rolled one.
			along.copy(tangent).addScaledVector(normal, -tangent.dot(normal));
			if (along.lengthSq() === 0) quaternion.setFromUnitVectors(unitZ, normal);
			else {
				along.normalize();
				across.crossVectors(normal, along).normalize();
				quaternion.setFromRotationMatrix(
					basis.makeBasis(along, across, normal),
				);
			}
		}
		panes.setMatrixAt(i, matrix.compose(position, quaternion, one));
		glowAt.push(position.clone());
	}
	panes.instanceMatrix.needsUpdate = true;
	// One glow point per pane, at the pane's own centre and in the grid's frame
	// — a pane is under a pixel at approach range and a grid of them is what
	// says a station is lived in (#300).
	panes.add(
		glowPoints(
			"windows",
			glowAt,
			FITTING_KM.pane[0],
			FITTING_KM.pane[0] * 0.5,
			steadyGlowMaterial(
				STATION_VISUALS[type].windowColor,
				PANE_MATERIALS[type].emissiveIntensity,
				"pane",
			),
		),
	);
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
	minLevel: Exclude<DetailLevel, "outline">,
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
const PANE_GEOMETRY = shared(new THREE.BoxGeometry(...FITTING_KM.pane));
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
/** The floods' glare: steady, so one shared material like the floods'. */
const FLOOD_GLOW = steadyGlowMaterial(
	STATION_VISUALS.shipyard.floodColor,
	STATION_EMISSIVE_INTENSITIES.flood,
	"flood",
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
	// **Stepped back from the aperture edge rather than cut to it** (#269,
	// `RIM_SEPARATION_KM`). The lit bars below own that edge; a coaming that
	// shared it put a second face on the same plane, and the two took turns
	// winning the depth test as the station turned. The step is 2 m and the bar
	// that stands in front of it is 24 m deep, so nothing here is exposed by it —
	// but it is the step that sets `RIM_SEPARATION_KM`'s ceiling, because this
	// ring is the one whose step-back can open a hole into the bay. Flown at 8 m
	// it did, and `probe-traffic-mouth.mjs` read it.
	const inner = ringInsideAperture(
		{ across: aperture.widthKm / 2, up: aperture.heightKm / 2 },
		"coaming",
	);
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
/**
 * **A ring of strobes round a slot's mouth, flashing in sequence** (#300).
 *
 * The principal's reading of #300's second sheet: on a whole trade station only
 * two strobes were visible, and a pilot expects the mouth itself to be marked by
 * strobing lights. Ten real-size lamps stand on the lit frame — the corners,
 * the side bars and a pair on each long bar — and each flashes on the role's own
 * strobe period at its own place in it, so the flash runs round the slot once a
 * period.
 *
 * **White, and they say nothing about docking state.** Red and green by
 * clearance was on the table and declined: §5.1 gives state to the HUD
 * director, which can also give the reason, and a red mark alone never carries
 * a consequence. What the chase carries is *where the mouth is*, from ranges
 * where the frame itself has not resolved.
 *
 * On the slot roles only. A pad has no frame round a hole to run round; the
 * refinery's hazard is marked by beacons instead.
 */
function mouthStrobes(
	type: StationType,
	fixtures: StationFixture[],
	w: number,
	h: number,
	bar: number,
	faceZ: number,
): THREE.Group {
	const group = new THREE.Group();
	const size = FITTING_KM.strobe;
	const period = STATION_VISUALS[type].activity.strobePeriodS;
	// **On the lit frame's front face, and only where the frame is outside the
	// corridor.** `tests/station-mesh.test.ts` forbids any vertex within the
	// slot's half-diagonal of the axis in front of the mouth, and the first ring
	// stood two lamps 61 m off the axis against a 69.5 m cylinder. The side
	// bars and the corners are outside it everywhere; the top and bottom bars
	// only once they are far enough along — so those carry a pair each, at the
	// radius where the bar leaves the cylinder, and nothing at their middle.
	// Derived from the aperture rather than written for 120 x 70, so a slot of
	// another size keeps the guarantee. `clear` is the cylinder plus a lamp's
	// own half-diagonal and a margin.
	const clear = Math.hypot(w, h) / 2 + size * 3;
	const sideX = Math.max((w + bar) / 2 + bar / 4, clear);
	const cornerX = (w + bar) / 2;
	const cornerY = (h + bar) / 2;
	const barY = (h + bar) / 2 + bar * 0.2;
	const pairX = Math.min(
		w / 2 + bar,
		Math.sqrt(Math.max(0, clear * clear - barY * barY)),
	);
	// Listed counter-clockwise from +X, so the sequence runs round rather than
	// across. A larger offset reaches the flash earlier in the period, so the
	// flash itself travels the other way — clockwise, last lamp listed first.
	const ring: [number, number][] = [
		[sideX, 0],
		[cornerX, cornerY],
		[pairX, barY],
		[-pairX, barY],
		[-cornerX, cornerY],
		[-sideX, 0],
		[-cornerX, -cornerY],
		[-pairX, -barY],
		[pairX, -barY],
		[cornerX, -cornerY],
	];
	ring.forEach(([x, y], i) =>
		group.add(
			blinkingLamp(
				fixtures,
				STATION_VISUALS[type].strobeColor,
				"mouth-strobe",
				"chase",
				(i / ring.length) * period,
				// On the frame bar's front face.
				new THREE.Vector3(x, y, faceZ + bar / 2),
				PLUS_Z,
				LAMP_POOL_KM.bar,
				0.6,
			),
		),
	);
	return group;
}

function buildAperture(
	type: StationType,
	fixtures: StationFixture[],
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
	//
	// **These are the ring that owns the aperture edge** (#269,
	// `RIM_STEPS.apertureLight` is zero). They are the docking cue, so they are
	// the one ring whose inner face is the opening rather than a step back from
	// it — and the reason the other three step back at all is that they were all
	// on this plane, taking turns to win the depth test as the station turned.
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
	if (aperture.kind === "slot")
		group.add(mouthStrobes(type, fixtures, w, h, bar, faceZ));
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
	 *  `stationSilhouetteKm` reads it for the station's own form. */
	readonly reachKm: number;
	/** `berthSeed` is the station's own berth draw (`docking.md` §13.2), which
	 *  reaches the interior and nothing else. Every builder takes it and most
	 *  only forward it, which is the price of the alternative being a module
	 *  global that a second station would overwrite. `assemblySeed` is the
	 *  station's assembly draw (§7.1), read only by a form that solves a plan;
	 *  a hand-authored form declares two parameters and ignores the third. */
	readonly build: (
		color: number,
		berthSeed: number,
		assemblySeed: number,
	) => BuiltPart;
}

export type { StationFormId };
export const STATION_FORM_IDS: StationFormId[] = ["a", "b", "c", "d", "e"];

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
 * **A panel size, not a panel count.** `hullLoft` writes its UVs in
 * kilometres — chord distance round the section and distance along the
 * sweep — so dividing by one constant gives every part of every station the
 * same ~19 m plate. Multiplying a normalised 0–1 unwrap by a fixed count,
 * which is what `shell` once did, gives a 1.5 km keel and a 0.12 km terrace
 * six bands each: one coarse, the other a smear. One function, so a loft built
 * outside `shell` (the Wheel's open rim) cannot tile by a second rule.
 */
function panelUVs(geometry: THREE.BufferGeometry) {
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	const panelKm = stationPanelKm();
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) / panelKm, uv.getY(i) / panelKm);
	uv.needsUpdate = true;
	return geometry;
}

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
	/** An uncapped tube for a vent nozzle; it does not cut the landing deck. */
	open = false,
) {
	const geometry = panelUVs(hullLoft(controls, { segments, aperture, open }));
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
		tangent: THREE.Vector3,
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
	/** Its pools' radius, from `LAMP_POOL_KM` by the surface it stands on. */
	poolKm: number,
	/**
	 * Where each lamp stands: a point **on** the surface, and that surface's
	 * outward normal, which starts as +Z. Real size since #300, so a caller
	 * no longer picks a lamp size — every caller had picked a fraction of its
	 * core radius and got a 36–42 m lamp, and three of them kept offsets
	 * written for that size, which left 2 m lamps metres off their hulls.
	 */
	place: (side: number, position: THREE.Vector3, normal: THREE.Vector3) => void,
) {
	const group = new THREE.Group();
	const sides: [StationFixtureKind, number][] = [
		["strobe-a", -1],
		["strobe-b", 1],
	];
	for (const [kind, side] of sides) {
		const position = new THREE.Vector3();
		const normal = PLUS_Z.clone();
		place(side, position, normal);
		group.add(
			blinkingLamp(
				fixtures,
				STATION_VISUALS[type].strobeColor,
				kind,
				kind,
				0,
				position,
				normal,
				poolKm,
				0.6,
			),
		);
	}
	return group;
}

// ---------------------------------------------------------------------------
// The forms
// ---------------------------------------------------------------------------
//
// Three per role. Every one is built from `hullLoft` where it is a hull and
// from a torus where it is a ring; nothing here is a `BoxGeometry` standing in
// for a shape. Each declares its own reach, and `stationSilhouetteKm` reads the
// station's own form's row rather than a number written twice.

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
		buildAperture(
			"trade",
			fixtures,
			STATION_GEOMETRY.trade.aperturePlaneKm,
			berthSeed,
		),
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

	/**
	 * **A forward run on the +Z diamond, round the slot and outside the
	 * coaming** (#300).
	 *
	 * The equatorial grid above stays — §5 asks a fixture to read *from* the
	 * axis, not only from it, and the flank is a real view — but from the axis
	 * it reads nothing at all: everything at or behind the equator is hidden,
	 * and #274 measured the whole grid at exactly 0 px from three silhouette
	 * radii while its bounding sphere spanned 209 px of the frame. The docking
	 * face is the one surface an approach looks at full-on, so the run that a
	 * pilot sees goes there.
	 *
	 * **Two concentric rings rather than one** (#36, via `rowsOf`). Seven panes
	 * on one row became a continuous strip light when tripled, and a single ring
	 * round the slot is the same figure bent into a circle — a halo, not
	 * windows. The second ring is offset half a step so the two do not line up
	 * radially.
	 *
	 * The radii are the four constraints solved at once, in fractions of the
	 * face plane's own half-diagonal so a re-sized hull carries them. Outside
	 * the coaming, whose corner stands at 0.34 of it (1.5× the slot's width and
	 * 3× its height, halved); inside the diamond, whose edge is at 1/√2 = 0.707
	 * of it at the nearest point; and clear of both by more than a pane's own
	 * half-diagonal. Well outside the 69.5 m corridor either way, and behind the
	 * declared aperture plane, which the frame stands 6% proud of.
	 */
	const FORWARD_RINGS = [0.44, 0.61];
	group.add(
		portRun("trade", 12, (i, count, position, normal) => {
			const { row, along, perRow } = rowsOf(i, count, FORWARD_RINGS.length);
			// Half a step of stagger on the outer ring, taken from `perRow`
			// rather than from a literal: the count is the role's rather than
			// this call's, so a density change must not line the rings up.
			const theta = (along + (row * 0.5) / perRow) * Math.PI * 2;
			normal.set(0, 0, 1);
			position.set(
				Math.cos(theta) * face * FORWARD_RINGS[row],
				Math.sin(theta) * face * FORWARD_RINGS[row],
				face * 1.004,
			);
		}),
	);

	/**
	 * **The strobes on the +Z diamond, at opposite corners of it** (#274, #300).
	 *
	 * They were on two opposite equatorial faces, and from the aperture axis the
	 * docking face occludes its own hull lights: the sightline from 1.86 km to a
	 * lamp at `(±face·1.02, 0, face·0.5)` crosses the face plane at 0.90·face,
	 * inside the diamond. Both read exactly 0 px. Standing one proud enough to
	 * clear that was on the table and rejected — a light on a stalk, eating the
	 * silhouette budget, and still edge-on.
	 *
	 * §5 worried that a fixture on the face plane "may read less well than one
	 * on the rim", and for this viewpoint that is **backwards**. From the axis a
	 * lamp at radius ρ on the face traces a circle in the frame once per
	 * revolution, so the rotation rate is read straight off the sweep; a rim
	 * lamp traces its own circle and is occluded at *every* phase of it at three
	 * radii, not half. §5 is corrected.
	 *
	 * **Inboard of the corners, not on them.** A diamond corner is a hull vertex
	 * at the full 0.57 km, so a lamp centred there would stand past it and
	 * become the farthest point of the station — which §2 forbids of anything
	 * tagged `detail`. At 0.62 of the half-diagonal the lamp is well inside the
	 * hull's own corners, and `tests/station-visuals.test.ts` decides that
	 * rather than this comment.
	 *
	 * **Centred on the face plane, so it is sunk into it.** Standing the lamp
	 * *on* the plane — its back face exactly at `face` — leaves two surfaces
	 * touching at a plane and nothing overlapping, which
	 * `tests/station-mesh.test.ts` reads, correctly, as a light hanging in front
	 * of a station. Half sunk, it still shows its whole lit face down the axis.
	 */
	group.add(
		strobePair("trade", fixtures, LAMP_POOL_KM.face, (side, position) => {
			position.set(side * face * 0.62, 0, face);
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
	group.add(buildAperture("trade", fixtures, r * 0.34, berthSeed));
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
		// On the rim's crown, the face of the tube that looks down the axis
		// (#300's review): the ring turns whole, so a lamp there sweeps a
		// circle in the approach's frame. It stood past the rim's outer face,
		// metres off the hull, at an offset written for a 42 m lamp.
		strobePair("trade", fixtures, LAMP_POOL_KM.tube, (side, position) => {
			position.set(0, side * major, tube);
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
	group.add(buildAperture("trade", fixtures, r * 0.88, berthSeed));
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
		// On the front cap beside the slot, where the approach looks (#300's
		// review). It stood out on the barrel's side, metres off the hull and
		// hidden from the axis by the cap.
		strobePair("trade", fixtures, LAMP_POOL_KM.face, (side, position) => {
			position.set(0, side * body * 0.5, r * 0.88);
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
/*
 * **680 m since the principal's second sheet (2026-09-06), and a spindle
 * between.** At 360 m the keel's forward face stood at z −0.06 while the
 * hub's aft face is at −0.30, so the drum's aft 240 m sat *inside* the keel:
 * a square drum embedded in a static body, which the principal read as "the
 * rotating part just sits in the main body". Sensible geometry for a thing
 * that turns against a thing that does not is a spindle through a bearing:
 * the Gantry's hub now carries a round spindle aft from its face, the keel
 * carries a bearing ring proud of its forward face, and the keel sits far
 * enough aft — 680 m, its forward face at −0.46 — that the spindle shows
 * between the two. The Hangar's slab moves with it, for the same reason.
 * The keel's far end reaches 1.65 km now, and the form's declaration says so.
 */
export const SHIPYARD_KEEL_AFT_KM = 0.68;

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
	// The spindle: round, on the axis, turning with the hub, from inside the
	// keel to inside the hub's aft face. Its own loft at twelve segments,
	// because the hub is a four-segment loft and a round ring on it would be
	// a diamond. See `SHIPYARD_KEEL_AFT_KM` for why it exists.
	spun.add(
		shell(
			[
				{ z: -r * 0.9, w: r * 0.2, h: r * 0.2, e: 2 },
				{ z: -r * 0.48, w: r * 0.2, h: r * 0.2, e: 2 },
			],
			hullMaterial(color, "shipyard"),
			"spindle",
			12,
			true,
		),
	);
	spun.add(
		buildAperture(
			"shipyard",
			fixtures,
			STATION_GEOMETRY.shipyard.aperturePlaneKm,
			berthSeed,
		),
	);
	/**
	 * **The strobes belong to the spinning member, and on this form that is the
	 * drum** (#274, #300).
	 *
	 * §5 used to give them to "the Coriolis hull ... the shipyard spins about
	 * the same axis for the same reason". The shipyard's pool is the
	 * Gantry — a keel with a drum on a bearing — so there is no shared Coriolis
	 * hull for one answer to be one answer for, and the pair had been added to
	 * `group`, the **static keel**, at `z = -SHIPYARD_KEEL_AFT_KM`. What a
	 * strobe carries is that the station turns and how fast; bolted to the part
	 * that does not turn it carries nothing, and that is a §5 violation with no
	 * pixel in it. Written against the spinning member, the rule survives the
	 * next form re-ranking; written against a form, it went stale at the last
	 * one.
	 *
	 * On the drum's forward face, flanking the slot, for the trade station's
	 * reason: from the axis a lamp there traces a circle in the frame once per
	 * revolution. At `r * 0.3` it is well outside the 69.5 m corridor and well
	 * inside the face's own 0.42·r half-width, and it stood at 3.9 px and 0 px
	 * on the keel.
	 *
	 * **Half sunk, and the half that is not stands in front of the aperture
	 * plane.** This form's hull face *is* its declared plane — the trade
	 * station's is 25 m behind its own, which is why its lamp needs no such
	 * note — so a fixture on this surface is either proud of the plane or
	 * invisible.
	 * Nothing forbids it: the corridor row owns the volume a ship descends
	 * through and a lamp at 0.18 km is far outside its 69.5 m cylinder. But
	 * `CLAUDE.md` said pad berths were the only parts of a station drawn in
	 * front of a plane, and that sentence is amended rather than quietly
	 * falsified.
	 */
	spun.add(
		strobePair("shipyard", fixtures, LAMP_POOL_KM.face, (side, position) => {
			position.set(side * r * 0.3, 0, r * 0.62);
		}),
	);
	group.add(spun);
	// **The frame is plated, since the principal's second sheet.** The keel,
	// rails, booms and struts were a plain light grey and took no finish —
	// "the shipyard barely changes between stock and worn" was the first
	// sheet's finding and "the main body still reads too clean" the second
	// — so every lofted part of the frame now carries the shipyard's own hull
	// material, seams, streaks and soot included. The arches are tori, whose
	// normalised unwrap would stretch one tile round each rib, so they stay
	// plain and go a shade darker than the plating they sit against.
	const rib = plainMaterial(0x5b6772, 0.82, 0.38);
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
		hullMaterial(color, "shipyard"),
		"keel",
		12,
		true,
	);
	keel.rotation.y = Math.PI / 2;
	keel.position.z = -SHIPYARD_KEEL_AFT_KM;
	frame.add(keel);
	// The bearing: a static ring on the keel's forward face that the spindle
	// turns in, its bore 6 m clear of the spindle. It is what makes the join
	// legible — a drum on a spindle out of a housing, not a drum in a body.
	const bearing = new THREE.Mesh(
		new THREE.TorusGeometry(r * 0.26, r * 0.05, 6, 16),
		rib,
	);
	// Proud of the keel's forward face, which at x = 0 is about 0.27 km ahead
	// of the keel's centre: the ring's body overlaps the face by a few metres
	// and the rest of it shows.
	bearing.position.z = -SHIPYARD_KEEL_AFT_KM + r * 0.49;
	bearing.name = "bearing";
	frame.add(bearing);
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
			hullMaterial(color, "shipyard"),
			"rail",
			6,
			true,
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
	//
	// **Rooted aft of the hub and carried by the frame.** The first booms
	// began at z = −0.23 km, beside the hub, and touched nothing: the principal
	// read them as arms that do not connect, and the island check could not
	// see it while an arch's box stood in for its ring. The hub spins and
	// sweeps its square section's corner — about 0.70·r — through
	// z ∈ [−0.5·r, 0.62·r], so nothing may cross to the boom inside that
	// range; the root is moved aft of it, to −0.85·r, and three struts carry
	// it there: a transverse beam from inside the keel, and a yoke of two from
	// the rail on that side, meeting at the boom.
	const strut = (from: THREE.Vector3, to: THREE.Vector3, halfKm: number) => {
		const length = from.distanceTo(to);
		const member = shell(
			[
				{ z: -length / 2, w: halfKm, h: halfKm, e: 3 },
				{ z: length / 2, w: halfKm, h: halfKm, e: 3 },
			],
			hullMaterial(color, "shipyard"),
			"boom-strut",
			4,
			true,
		);
		member.position.copy(from).add(to).multiplyScalar(0.5);
		member.quaternion.setFromUnitVectors(
			new THREE.Vector3(0, 0, 1),
			to.clone().sub(from).normalize(),
		);
		frame.add(member);
	};
	for (const y of [-r * 0.8, r * 0.8]) {
		const root = -r * 1.1;
		const boom = shell(
			[
				{ z: root, w: r * 0.09, h: r * 0.09, e: 3 },
				{ z: r * 1.5, w: r * 0.07, h: r * 0.07, e: 3, hard: true },
				{ z: r * 1.9, w: r * 0.16, h: r * 0.16, e: 3 },
			],
			hullMaterial(color, "shipyard"),
			"boom",
			6,
			true,
		);
		boom.position.y = y;
		frame.add(boom);
		const side = Math.sign(y);
		const rootAt = new THREE.Vector3(0, y, root + r * 0.08);
		strut(
			new THREE.Vector3(0, side * r * 0.3, root + r * 0.08),
			rootAt,
			r * 0.035,
		);
		for (const x of [-r * 0.45, r * 0.45])
			strut(
				new THREE.Vector3(x, side * r * 0.58, -SHIPYARD_KEEL_AFT_KM),
				rootAt.clone().setZ(root + r * 0.2),
				r * 0.03,
			);
	}
	/**
	 * **The bay is the gap between the two booms, and the work light is in it**
	 * (#300, on the principal's ruling).
	 *
	 * The floods and the arc were on the keel's underside at
	 * `z = -SHIPYARD_KEEL_AFT_KM`, which is aft of the drum and across the axis:
	 * from the one viewpoint a docking approach has, #274 measured the four
	 * floods at 3 px seen grazing and the arc at exactly 0, at a clock where its
	 * own drive is 0.98. §5 gives the yard "cold blue-white floodlit bays" and
	 * "one bay carries a welding arc", and a bay nobody arriving can see carries
	 * nothing.
	 *
	 * The booms are the answer because of what they already are: they were
	 * carried forward past the hub precisely so the frame reaches into the
	 * approach view (#28), and the volume between them is the only part of this
	 * form a ship could be held in. So the floods go on their **inboard** faces,
	 * aimed across the gap, and the arc sits on one of them — a yard working on
	 * a hull in its own arms.
	 *
	 * They stay on the static `group`, not in `spun`. §5 asks only the **strobes** to
	 * mark rotation; a work light marks work, and a welding arc that swung round
	 * the axis would be a beacon rather than a job.
	 *
	 * **On the boom tips' forward faces, because the tips hide everything behind
	 * them.** The booms run forward along the approach axis and flare to a
	 * 0.16·r half-width at their tips (z = 1.9·r), so from the axis each tip's cap
	 * covers |y| from 0.64·r to 0.96·r — which is exactly where a fitting on a
	 * boom's inboard face (0.728·r) stands. Measured there with real-size fittings
	 * and their glows, from three silhouette radii: the arc read **0 px** and the
	 * floods 2 px. The cap is the one surface of a boom that nothing stands in
	 * front of on the approach, so the work light is mounted on it: two floods on
	 * each tip's inboard half, lit faces turned 35° inboard so they read as lights
	 * aimed into the bay, and the arc between the port pair — a yard working at
	 * the end of its arm.
	 *
	 * Each fixture is centred on the cap's plane, so it is half sunk into the
	 * member carrying it rather than touching it at a face.
	 */
	const TIP_Z = r * 1.9;
	const TIP_INBOARD_Y = r * 0.72;
	const TIP_ACROSS_X = r * 0.08;
	const FLOOD_TILT = Math.PI * 0.19;
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, flood) => {
				const side = i % 2 === 0 ? -1 : 1;
				// Inboard is +Y for the port boom and −Y for the starboard one,
				// so the tilt takes the side's sign.
				flood.quaternion.setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					new THREE.Vector3(
						0,
						-side * Math.sin(FLOOD_TILT),
						Math.cos(FLOOD_TILT),
					),
				);
				flood.position.set(
					(Math.floor(i / 2) === 0 ? -1 : 1) * TIP_ACROSS_X,
					side * TIP_INBOARD_Y,
					TIP_Z,
				);
			},
			// Between the port tip's two floods, on the same cap.
			new THREE.Vector3(0, -TIP_INBOARD_Y, TIP_Z),
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
	const bearing = new THREE.Mesh(
		new THREE.TorusGeometry(r * 0.21, r * 0.045, 6, 16),
		plainMaterial(0x6f7d88, 0.78, 0.42),
	);
	bearing.position.z = -SHIPYARD_KEEL_AFT_KM + r * 0.53;
	bearing.name = "bearing";
	frame.add(bearing);
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
	// The Hangar's spindle and, below, its bearing: the slab moved aft with
	// the Gantry's keel (`SHIPYARD_KEEL_AFT_KM`) and the hub did not, so the
	// same drum-on-a-spindle join carries it.
	spun.add(
		shell(
			[
				{ z: -r * 0.75, w: r * 0.16, h: r * 0.16, e: 2 },
				{ z: -r * 0.28, w: r * 0.16, h: r * 0.16, e: 2 },
			],
			hullMaterial(color, "shipyard"),
			"spindle",
			12,
			true,
		),
	);
	spun.add(buildAperture("shipyard", fixtures, r * 0.6, berthSeed));
	// The strobe pair on the hub's forward face, above and below the slot
	// (§5, #300's review): the hub is what turns, and the slab the pair stood
	// on did not.
	spun.add(
		strobePair("shipyard", fixtures, LAMP_POOL_KM.face, (side, position) => {
			position.set(0, side * r * 0.22, r * 0.6);
		}),
	);
	group.add(spun);

	// Inside the bay mouth, which is where a bay's floods are.
	group.add(
		buildBayLights(
			fixtures,
			r,
			(i, flood) =>
				flood.position.set(
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
	spun.add(buildAperture("shipyard", fixtures, r * 0.64, berthSeed));
	// The strobe pair on the hub's forward face, above and below the slot
	// (§5, #300's review): the arc does not turn, and the pair stood on its
	// centreline, inside its own tube.
	spun.add(
		strobePair("shipyard", fixtures, LAMP_POOL_KM.face, (side, position) => {
			position.set(0, side * r * 0.18, r * 0.64);
		}),
	);
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
			(i, flood) => {
				const theta = Math.PI * 0.3 + (i / 3) * Math.PI * 1.35;
				// On the arc's inner *surface*, derived from its tube radius. At
				// `major * 0.86` they hung 60 m inside the slip — invisible to the
				// island check, whose boxes overlap because the arc's box spans the
				// whole ring, and plainly floating on screen.
				// **On** that surface, not 12 m into the tube (#300's review):
				// `r * 0.18` half-sank a 156 m flood and buried a real 4 m one.
				// The tube is flat-shaded, so its inner face between two ring
				// vertices is a chord, up to 6 m inboard of the circle through
				// them; the flood sits on the chord.
				const seg = (Math.PI * 1.45) / 22;
				const local =
					((((theta - Math.PI * 0.28) % seg) + seg) % seg) - seg / 2;
				const inner = ((major - r * 0.2) * Math.cos(seg / 2)) / Math.cos(local);
				flood.position.set(Math.cos(theta) * inner, Math.sin(theta) * inner, 0);
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
	/** The flood itself and not only its position (#300): a flood is a wide thin
	 *  bar, so a face whose normal is not the one it was drawn for needs it
	 *  turned as well as moved. The Gantry's booms are the first caller to want
	 *  that; the three that do not simply ignore the rotation. */
	place: (i: number, flood: THREE.Mesh) => void,
	arcAt: THREE.Vector3,
): THREE.Group {
	const group = new THREE.Group();
	for (let i = 0; i < 4; i++) {
		// The long face along X, as before, so every caller's orientation still
		// holds; only the size is real now (#300).
		const flood = new THREE.Mesh(
			new THREE.BoxGeometry(
				FITTING_KM.flood[0],
				FITTING_KM.flood[2],
				FITTING_KM.flood[1],
			),
			FLOOD_MATERIAL,
		);
		place(i, flood);
		flood.name = "bay-flood";
		glowOnFitting(flood, FITTING_KM.flood[0], FLOOD_GLOW);
		detail(flood, "reduced");
		group.add(flood);
	}
	const arcMaterial = emissiveMaterial(
		STATION_VISUALS.shipyard.floodColor,
		STATION_EMISSIVE_INTENSITIES.off,
	);
	const arc = new THREE.Mesh(
		new THREE.SphereGeometry(FITTING_KM.arcRadius, 8, 6),
		arcMaterial,
	);
	arc.position.copy(arcAt);
	arc.name = "weld-arc";
	detail(arc, "reduced");
	const arcGlow = drivenGlow(
		STATION_VISUALS.shipyard.floodColor,
		"point",
		0,
		0,
	);
	glowOnFitting(arc, FITTING_KM.arcRadius * 2, arcGlow);
	group.add(arc);
	fixtures.push({
		material: arcMaterial,
		base: STATION_EMISSIVE_INTENSITIES.weldArc,
		kind: "work",
		offsetS: 0,
		glow: arcGlow,
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
	/** The bank's own length. Everything else here is proportioned from it —
	 *  there used to be a second `radius` argument and nothing read it, so five
	 *  call sites were passing a dial that did nothing (#300). */
	length: number,
	/** Newly pooled forms need an open mouth and a tip beacon visible on approach. */
	approachFacing = false,
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
	const throatGlare = drivenGlow(
		STATION_VISUALS.refinery.heatColor,
		"flood",
		0,
		0,
	);
	/** How far the nozzles lean off the bank's own axis, and the direction that
	 *  makes — shared by the pipe and the glow inside it, so the two cannot
	 *  drift apart. They did: the throat's position was written out in the
	 *  bank's frame and put the plate 0.05 of a bank-length **down the bore**,
	 *  where the pipe's own wall hides it from every direction but straight
	 *  down it (#300, measured at 0 px on the selected refinery). */
	const NOZZLE_TILT = 0.35;
	const bore = new THREE.Vector3(
		0,
		Math.sin(NOZZLE_TILT),
		Math.cos(NOZZLE_TILT),
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
			undefined,
			approachFacing,
		);
		nozzle.position.set(-length * 0.24 + i * length * 0.17, 0, across * 0.7);
		nozzle.rotation.x = -NOZZLE_TILT;
		stack.add(nozzle);
		// The lit throat, in the nozzle's **mouth** — still inside the pipe, so
		// it is the inside of the pipe glowing rather than a lamp on the end of
		// one, but recessed by its own thickness instead of by a bore's width.
		// Turned with the pipe as well as placed by it: a plate lying across a
		// leaning pipe is a lid, not a throat.
		// **Real-size, and never wider than the mouth it glows in** (#300). It
		// was half the manifold's width, which on the banks the Warren, the
		// Collar and the Spar build — 0.34 to 0.42 km long — is a 29–36 m lit
		// plate; a flare throat is metres. The glow is what reads at range.
		const throatKm = Math.min(across * 0.5, FITTING_KM.throat);
		const throat = new THREE.Mesh(
			new THREE.BoxGeometry(throatKm, throatKm, throatKm * 0.4),
			glow,
		);
		throat.quaternion.copy(nozzle.quaternion);
		throat.position
			.copy(nozzle.position)
			.addScaledVector(
				bore,
				length * 0.34 - (approachFacing ? throatKm * 0.2 : across * 0.12),
			);
		throat.name = "flare";
		detail(throat, "reduced");
		glowOnFitting(throat, throatKm, throatGlare);
		stack.add(throat);
		if (approachFacing && i === 0)
			stack.add(
				obstructionBeacon(
					fixtures,
					nozzle.position.clone().addScaledVector(bore, length * 0.34),
				),
			);
	}
	// One fixture for the bank, kind `flare`: it is the flare system's light,
	// and it is now the only light it has.
	fixtures.push({
		material: glow,
		base: STATION_EMISSIVE_INTENSITIES.refineryFlare,
		kind: "flare",
		offsetS: 0,
		glow: throatGlare,
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

/** Dock-face ports between the pad's berths, on the shared aperture plane. */
function refineryDeckPorts(): THREE.Object3D {
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	return portRun("refinery", 4, (i, count, position, normal, tangent) => {
		const theta = ((i + 0.5) / count) * Math.PI * 2;
		normal.set(0, 0, 1);
		tangent.set(Math.cos(theta), Math.sin(theta), 0);
		position.set(
			Math.cos(theta) * 0.171,
			Math.sin(theta) * 0.171,
			plane + 0.004,
		);
	});
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
			fixtures,
			STATION_GEOMETRY.refinery.aperturePlaneKm,
			berthSeed,
		),
	);

	// **Vent throats face the approach.** Viewed down the aperture axis —
	// the one view a docking approach has — a rock with an inlaid cut is still a
	// rounded lump, and `probe-station.mjs` measured this against the trade
	// station's drum at 1 − IoU 0.216 on a 0.25 floor. §7 rests identity on
	// outline, so the machined half has to reach *into that view* rather than
	// sit flush in it.
	for (const [x, y] of [
		[r * 0.86, r * 0.6],
		[-r * 0.72, r * 0.78],
	]) {
		const flare = buildVentBank(fixtures, r * 1.05, true);
		flare.position.set(x, y, r * 0.36);
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
	group.add(refineryDeckPorts());
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
				{
					z: STATION_GEOMETRY.refinery.aperturePlaneKm,
					w: r * 0.5,
					h: r * 0.5,
					e: 6,
				},
			],
			hullMaterial(color, "refinery"),
			"boss",
			8,
			true,
			// Uncut: the pad is landed on rather than flown through (#165).
			undefined,
		),
	);
	group.add(
		buildAperture(
			"refinery",
			fixtures,
			STATION_GEOMETRY.refinery.aperturePlaneKm,
			berthSeed,
		),
	);
	for (const side of [-1, 1]) {
		const flare = buildVentBank(fixtures, r * 0.9, true);
		flare.position.set(side * major * 0.82, r * 0.42, 0);
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
	group.add(refineryDeckPorts());
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
				{
					z: STATION_GEOMETRY.refinery.aperturePlaneKm,
					w: r * 0.5,
					h: r * 0.5,
					e: 6,
				},
			],
			hullMaterial(color, "refinery"),
			"core",
			8,
			true,
			// Uncut: the pad is landed on rather than flown through (#165).
			undefined,
		),
	);
	group.add(
		buildAperture(
			"refinery",
			fixtures,
			STATION_GEOMETRY.refinery.aperturePlaneKm,
			berthSeed,
		),
	);
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
		const flare = buildVentBank(fixtures, r * 0.85, true);
		// On the forward rock shoulder, where the approach sees the heat and
		// hazard beacon; the aft shaft was wholly hidden behind the rock.
		flare.position.set(side * r * 0.8, r * 0.3, r * 0.6);
		group.add(flare);
	}
	for (const tilt of [0.4, Math.PI - 0.4, Math.PI * 1.5]) {
		const wing = buildRadiator(r * 1.4, tilt);
		wing.position.z = -r * 0.75;
		group.add(wing);
	}
	// Leave the dock-face ports outside the ring rather than behind its tube.
	group.add(
		buildHeatRing(
			fixtures,
			r * 0.36,
			STATION_GEOMETRY.refinery.aperturePlaneKm - 0.004,
		),
	);
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
	group.add(refineryDeckPorts());
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
		offsetS: 0,
	});
	return glow;
}

// ---------------------------------------------------------------------------
// The outposts (#56 round two)
// ---------------------------------------------------------------------------
//
// A fourth category, asked for as "smaller structures, non-rotating, look like
// industrial structures with just a landing pad". Forms A to D answer that
// brief: each is a *machine with a deck on it*, and the pad is the largest
// flat thing on them.
//
// **The role changed under them.** #490 made the outpost the raider's haven,
// and #493 found that nothing in a machine reads as a place where Wanted
// pilots sell Narcotics. E — Salvage (#518) is the role's own form, and the
// one the game builds: other ships' wreckage welded round the pad. A–D stay
// in the pool as the forms it was ranked against.
//
// None carries strobes, for the refinery's reason: nothing here turns.

/** A small floodlit pad deck on the +Z face, with its own coaming. Shared by
 *  every outpost form, because the pad is what the category *is* — the rest of
 *  each form is the machine that justifies one. */
function buildPadDeck(
	/** The role whose aperture the deck carries — the two pad roles share this
	 *  deck since #257, sized by `r` rather than by the role. */
	type: StationType,
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
	group.add(buildAperture(type, fixtures, z, berthSeed));
	// Four floods on the coaming, and one warm heat lamp that breathes: the only
	// motion an outpost has, and it says the machine is running rather than
	// anything about clearance (§5.1).
	for (let i = 0; i < 4; i++) {
		const theta = (i / 4) * Math.PI * 2 + Math.PI / 4;
		const flood = new THREE.Mesh(
			new THREE.BoxGeometry(
				FITTING_KM.flood[0],
				FITTING_KM.flood[1],
				FITTING_KM.flood[2],
			),
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
		glowOnFitting(flood, FITTING_KM.flood[0], FLOOD_GLOW);
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
			// All four plated since the principal's second sheet: three were a
			// pale matte that took no finish, so the Derrick read as clean under
			// every finish while the rest of the pool weathered.
			hullMaterial(color, "outpost"),
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
			"outpost",
			fixtures,
			r,
			STATION_GEOMETRY.outpost.aperturePlaneKm,
			berthSeed,
		),
	);
	// Rooted **on a tank**, not beside the cluster: the tanks sit on a 0.42·r
	// circle and are 0.34·r across, so a boom starting at 0.6·r began in empty
	// space and the whole flare was a detached island.
	const flare = buildVentBank(fixtures, r * 0.9);
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
	group.add(buildPadDeck("outpost", fixtures, r, r * 1.0, berthSeed));
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
	group.add(buildPadDeck("outpost", fixtures, r, r * 0.95, berthSeed));
	const flare = buildVentBank(fixtures, r * 1.0);
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
 * The cell pitch of the modular assembly, kilometres, and the module radii as
 * fractions of it. 0.2 km puts a 96 m habitat tube in each cell, which is
 * the ISS's proportion at the scale the other trade forms are drawn to, and
 * makes the eleven-cell diamond 1.8 km across the spine.
 */
const MODULAR_CELL_KM = 0.2;

/**
 * The unit step of a `DIRECTIONS` index, in the plan's plane.
 *
 * Module level rather than a closure in each builder: three of them had it,
 * and a change to how a plan's axes map onto the world would have had to be
 * made in three places. The same reason `hostDirOf` and `radiatorLeaf` are
 * shared.
 */
const towardCell = (dir: number) =>
	new THREE.Vector3(DIRECTIONS[dir][0], DIRECTIONS[dir][1], 0);

/** A cell's centre, given the vocabulary's pitch and the plane it lies in. */
const cellCentreKm = (p: Placement, cellKm: number, z: number) =>
	new THREE.Vector3(p.dx * cellKm, p.dy * cellKm, z);

/**
 * A leaf's radiator bank: panels on a spine running away from the host,
 * standing out of the plan's plane both ways. Three builders had this inline
 * — sage counted them — and they differed only in where the spine starts and
 * how many panels it carries.
 */
function radiatorLeaf(
	pools: Pools,
	origin: THREE.Vector3,
	host: THREE.Vector3,
	count: number,
	/** Which way the panels rise. Both ways by default, which is what a leaf
	 *  in open space wants; the Works passes +Z alone, because its floor is
	 *  under the bank. */
	sides: readonly THREE.Vector3[] = [
		new THREE.Vector3(0, 0, 1),
		new THREE.Vector3(0, 0, -1),
	],
) {
	const away = host.clone().negate();
	for (const up of sides)
		radiatorArray(pools, {
			origin,
			along: away,
			up,
			count,
			panelWidthKm: SHIP_SCALE.panelKm,
			panelHeightKm: SHIP_SCALE.panelHeightKm,
		});
}

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
 * **The plan is the assembly seed's** (`DOMAIN.STATION_ASSEMBLY`, #257). It
 * was the berth seed's for a round, and sage asked for the split on #255: a
 * station's shape and the side its berth is on were one number, so neither
 * could vary alone. The draw is per station and deterministic, which is what
 * the plan needs: two clients at one seed build one station, and a station
 * keeps its shape across visits.
 *
 * Every module is the hub's colour where it is a hull and unpainted grey
 * where it is structure, so §7's colour cue survives the form.
 */
function buildTradeModular(
	color: number,
	berthSeed: number,
	assemblySeed: number,
): BuiltPart {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const c = MODULAR_CELL_KM;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const { placements } = modularPlacements(assemblySeed);
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
	spun.add(buildAperture("trade", fixtures, plane, berthSeed));
	// The strobe pair on the hub's front cap, above and below the slot (§5,
	// #300's review): the hub is what turns, and the spine's longerons the
	// pair stood on do not.
	spun.add(
		strobePair("trade", fixtures, LAMP_POOL_KM.face, (side, position) => {
			position.set(0, side * hubR * 0.62, plane);
		}),
	);
	group.add(spun);

	const pools = new Pools();
	const tubeR = c * 0.24;
	const tubes: Placement[] = [];
	const toward = towardCell;
	const cellCentre = (p: Placement) => cellCentreKm(p, c, 0);
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
	/**
	 * A habitat tube: a twelve-sided drum the length of its cell, necked at
	 * both ends, with a collar on every docked end along its own axis.
	 */
	const habitatTube = (p: Placement) => {
		const centre = cellCentre(p);
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
		const axisDirs = p.module === TUBE_X ? [0, 1] : [2, 3];
		for (const dir of axisDirs)
			if (p.joined[dir])
				collar(
					centre.clone().addScaledVector(toward(dir), c * 0.5),
					p.module === TUBE_X ? "x" : "y",
					tubeR,
				);
	};
	/**
	 * A junction: a drum 0.3 cells across with a docking stub out to the
	 * cell's edge on every joined side, and a collar on each. The stubs are
	 * what `tests/station-mesh.test.ts`'s island check asked for — the drum
	 * ends at 0.3 and its neighbour starts at 0.5, and a tip node without
	 * them read as adrift of the tube it was docked to.
	 */
	const junction = (p: Placement) => {
		const centre = cellCentre(p);
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
		for (let dir = 0; dir < 4; dir++) {
			if (!p.joined[dir]) continue;
			const stub = shell(
				[
					{ z: c * 0.2, w: tubeR * 0.85, h: tubeR * 0.85, e: 2, hard: true },
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
	};
	/**
	 * A leaf's support: a strut from the **centre of every host beside it**
	 * to the leaf's own centre, and the direction its nearest host lies in.
	 *
	 * From the host's centre rather than from the cell's edge, because a
	 * truss host is 0.22 cells wide and a tube 0.48, so a stub that began at
	 * the edge left 0.39 cells of nothing between it and a truss — 59.65 m
	 * at seed zero, which sage measured member by member while the island
	 * check read a whole instanced pool as one box. And to *every* host
	 * rather than the nearest, because the plan may put a leaf between two:
	 * seed zero's dish at (2, 0) sat between the +X habitat tube and a second
	 * tube carrying a node and a tank rack, and everything behind the dish
	 * touched nothing. The leaf is the bridge. The inner part of each strut
	 * is buried in the host it comes from.
	 */
	const leafSupport = (p: Placement) => {
		const centre = cellCentre(p);
		for (let dir = 0; dir < 4; dir++)
			if (isHost(p.beside[dir]))
				truss(
					pools,
					centre.clone().addScaledVector(toward(dir), c),
					centre,
					SHIP_SCALE.strutKm,
					V(0, 0, 1),
				);
		return toward(hostDirOf(p));
	};
	for (const p of placements) {
		const centre = cellCentre(p);
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
			case TUBE_Y:
				habitatTube(p);
				tubes.push(p);
				break;
			case NODE:
				junction(p);
				break;
			case TRUSS_X:
			case TRUSS_Y: {
				const axis = toward(p.module === TRUSS_X ? 1 : 3);
				truss(
					pools,
					centre.clone().addScaledVector(axis, -c * 0.5),
					centre.clone().addScaledVector(axis, c * 0.5),
					SHIP_SCALE.trussKm,
					V(0, 0, 1),
				);
				break;
			}
			case RADIATOR: {
				// A spine from the cell's edge across the cell, panels on it
				// standing out of the plane both ways.
				const host = leafSupport(p);
				radiatorLeaf(
					pools,
					centre.clone().addScaledVector(host, c * 0.5),
					host,
					10,
				);
				break;
			}
			case TANKS: {
				const host = leafSupport(p);
				tankRack(pools, {
					origin: centre.clone().add(V(0, 0, -SHIP_SCALE.tankKm * 1.2)),
					along: host,
					up: V(0, 0, 1),
					count: 6,
					radiusKm: SHIP_SCALE.tankKm,
					lengthKm: SHIP_SCALE.tankLengthKm,
				});
				break;
			}
			case DISH:
				leafSupport(p);
				mast(pools, group, {
					base: centre,
					up: V(0, 0, 1),
					heightKm: SHIP_SCALE.mastHeightKm,
					widthKm: SHIP_SCALE.mastKm,
				});
				break;
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

/**
 * The rock's nominal radius. The cell pitch and the floor its +Z face is
 * machined to — `WORKS_CELL_KM`, `WORKS_FLOOR_KM` — are `station-plant.ts`'s,
 * because the collision proxy reads the same plan.
 *
 * **The floor is high on the rock and the plant is taller than the rim.**
 * Flown once at a 0.62 km rock cut to 0.2: the rock displaces to 0.43 km at
 * its pole, so every unit stood in a pit and the hero framing was bare rock
 * with a pad in it. The cut takes the top quarter off a 0.55 km rock — the
 * rim stands 0.07 km proud of the floor at the field's edge and falls away
 * outside it — and a column tops out at 0.5 km, above the rock's own pole.
 * What a pilot sees is a machined mesa with plant standing off it.
 */
const WORKS_ROCK_KM = 0.55;

/**
 * Refinery D — Works. **The rock is the station**, quarried flat across its
 * +Z face, with a plant solved onto that floor by wave function collapse
 * (`station-plant.ts`): a head house at the centre carrying the pad at the
 * table's plane, a pipe line running from it to a mine head over the shaft
 * at the −Y edge, and columns, crackers, pipe racks, tank farms, flare
 * stacks and radiator banks where the plan puts them. Every station of the
 * form its own plant, on the principal's steer (2026-09-06).
 *
 * **Two passes were flown and rejected before this one, and both were the
 * same mistake from opposite sides.** The first stood every unit on a plated
 * deck tile a cell wide, and the tiles were an opaque wall with the plant
 * hidden behind them. The second removed the tiles and left the units
 * hanging on 4 m pipes in open space with a 160 m pebble at one tip — the
 * principal read it as *"modules linked only by trusses, one little asteroid
 * with a ton of modules around it"*, which is the role inverted: the other
 * three refinery forms are all rock first and machine second (§7.1), and so
 * is this one now. The plant is 0.76 km across on a rock 1.24 km wide.
 *
 * **The floor is a bench, not a bowl.** `buildAsteroid`'s keep-clear volume
 * eases its ceiling up toward the rim by `rimKm`, which the other three
 * forms leave at 0.55 of the cut radius so a pad sits in a shallow dish;
 * a plant needs a flat floor, so this one asks for 0.06 km and the rock
 * rises round the field as a quarry rim rather than under it.
 *
 * A unit is sunk into the floor rather than standing on it, so the rock
 * carries every part and `tests/station-mesh.test.ts`'s island check reads
 * one body. The pipe web still runs between joined cells, on the surface,
 * because a plant's pipes are what say which unit feeds which — but nothing
 * structural hangs on them now.
 *
 * The pad is the head house's roof at the table's plane, and the corridor in
 * front of it is a cylinder about the axis that no cell but the centre
 * enters. Nothing spins (`docking.md` §4).
 */
/**
 * **A hazard beacon on a plant that does not spin** (#300).
 *
 * §5 gave the refinery no strobes, and for its own reason: a strobe carries that
 * a station turns, and this one does not. The principal's ruling on #300's
 * second sheet keeps that reason and adds a different signal — a slow blink on
 * the plant's tallest structures, which says something is there to clip rather
 * than that anything rotates. So §5's sentence becomes "no rotation marker"
 * rather than "no strobes".
 *
 * White, not an aviation red: `hud-and-scanner.md` §4 reserves red for
 * refusal, and a red light on a station would read as a denial.
 */
function obstructionBeacon(
	fixtures: StationFixture[],
	at: THREE.Vector3,
): THREE.Mesh {
	// **On a tip, so glare and no pool** — the principal's ruling on #300's
	// review. A sheave's crown is a 5 m tube and a manifold's end is not much
	// more, so a pool round either hung almost wholly in space, as a finish's
	// mast beacon would.
	return blinkingLamp(
		fixtures,
		STATION_VISUALS.refinery.strobeColor,
		"obstruction-beacon",
		"beacon",
		0,
		at,
		PLUS_Z,
		null,
		1,
	);
}

function buildRefineryWorks(
	color: number,
	berthSeed: number,
	assemblySeed: number,
): BuiltPart {
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	const c = WORKS_CELL_KM;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const { placements } = placementsOf(REFINERY_VOCABULARY, assemblySeed);
	const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
	const structure = plainMaterial(0x6f7d88, 0.78, 0.42);
	const tankSkin = plainMaterial(0xb2a894, 0.85, 0.16);
	const pools = new Pools();
	const toward = towardCell;
	/** A cell's centre, on the quarried floor. */
	const cellCentre = (p: Placement) => cellCentreKm(p, c, WORKS_FLOOR_KM);
	const S = SHIP_SCALE;
	const R = REFINERY;
	const pipeR = S.pipeKm;

	// The rock, quarried flat across the field and a cell beyond it, so the
	// rim stands outside the outermost unit rather than through it.
	group.add(
		buildAsteroid(WORKS_ROCK_KM, "refinery-works", {
			radiusKm: c * (REFINERY_RADIUS + 0.9),
			ceilingKm: WORKS_FLOOR_KM,
			rimKm: 0.05,
		}),
	);

	// The head house: a squared block from inside the rock up to the underside
	// of the pad slab, which is what carries the pad.
	const headHalf = 0.115;
	group.add(
		shell(
			[
				{
					z: WORKS_FLOOR_KM - 0.09,
					w: headHalf,
					h: headHalf,
					e: 8,
					hard: true,
				},
				{ z: plane - 0.016, w: headHalf, h: headHalf, e: 8 },
			],
			hullMaterial(color, "refinery"),
			"core",
			8,
			true,
		),
	);
	// The pad deck, sized so its slab spans the sim's berths (`stationInterior`
	// puts them at ±0.155 km on a 0.19 km half-deck) rather than the role's
	// core radius, which would cover the first ring of plant.
	group.add(buildPadDeck("refinery", fixtures, 0.222, plane, berthSeed));

	/** Three pipe lanes along the floor from one cell's centre to a neighbour's. */
	const pipesBetween = (from: THREE.Vector3, to: THREE.Vector3) => {
		const axis = to.clone().sub(from).normalize();
		const across = V(-axis.y, axis.x, 0);
		for (const lane of [-1, 0, 1]) {
			const offset = across.clone().multiplyScalar(lane * pipeR * 4);
			const a = from
				.clone()
				.add(offset)
				.setZ(WORKS_FLOOR_KM + pipeR * 2);
			const b = to
				.clone()
				.add(offset)
				.setZ(WORKS_FLOOR_KM + pipeR * 2);
			pipeRun(pools, [a, a.clone().lerp(b, 0.5), b], pipeR);
		}
	};
	/** A distillation column: a drum standing off the floor, platform rings on it. */
	const column = (p: Placement) => {
		const centre = cellCentre(p);
		// **The tallest thing on the floor**, which is what a distillation
		// column is: 0.34 km puts its head above the rock's own pole.
		const radius = 0.032;
		const height = 0.34;
		const drum = shell(
			[
				{ z: -0.05, w: radius, h: radius, e: 2, hard: true },
				{ z: height, w: radius, h: radius, e: 2, hard: true },
				{ z: height + 0.03, w: radius * 0.6, h: radius * 0.6, e: 2 },
			],
			hullMaterial(color, "refinery"),
			`column-${p.dx}-${p.dy}`,
			12,
			true,
		);
		drum.position.copy(centre);
		group.add(drum);
		for (const z of [0.08, 0.17, 0.26]) {
			const platform = new THREE.Mesh(
				new THREE.TorusGeometry(radius * 1.14, radius * 0.09, 4, 16),
				structure,
			);
			platform.position.set(centre.x, centre.y, centre.z + z);
			platform.name = "column-platform";
			group.add(platform);
		}
	};
	/** A cracker: a squat block on the floor with two stacks. */
	const cracker = (p: Placement) => {
		const centre = cellCentre(p);
		const block = shell(
			[
				{ z: -0.05, w: 0.07, h: 0.05, e: 8, hard: true },
				{ z: 0.07, w: 0.07, h: 0.05, e: 8 },
			],
			hullMaterial(color, "refinery"),
			`cracker-${p.dx}-${p.dy}`,
			8,
			true,
		);
		block.position.copy(centre);
		group.add(block);
		for (const x of [-0.036, 0.036]) {
			const stack = shell(
				[
					{ z: 0.05, w: 0.013, h: 0.013, e: 2, hard: true },
					{ z: 0.27, w: 0.01, h: 0.01, e: 2 },
				],
				structure,
				`stack-${p.dx}-${p.dy}`,
				8,
				true,
			);
			stack.position.set(centre.x + x, centre.y, centre.z);
			group.add(stack);
		}
	};
	/** A tank farm: four drums on a ring main, standing on the floor. */
	const tankFarm = (p: Placement) => {
		const centre = cellCentre(p);
		const radius = 0.026;
		const corners = [
			V(-0.036, -0.036, 0),
			V(0.036, -0.036, 0),
			V(0.036, 0.036, 0),
			V(-0.036, 0.036, 0),
		].map((v) => v.add(centre));
		for (const [i, at] of corners.entries()) {
			const drum = shell(
				[
					{ z: -0.03, w: radius, h: radius, e: 2, hard: true },
					{ z: 0.07, w: radius, h: radius, e: 2, hard: true },
					{ z: 0.09, w: radius * 0.7, h: radius * 0.7, e: 2 },
				],
				tankSkin,
				`tank-${p.dx}-${p.dy}-${i}`,
				10,
				true,
			);
			drum.position.copy(at);
			group.add(drum);
		}
		// The ring main runs through every drum and the cell's centre, which is
		// where the plant's pipes arrive.
		pipeRun(
			pools,
			[...corners, corners[0], centre, corners[2]].map((v) =>
				v.clone().setZ(WORKS_FLOOR_KM + pipeR * 2),
			),
			pipeR,
		);
	};
	for (const p of placements) {
		const centre = cellCentre(p);
		// The web: every joined pair once, from the lower-indexed side.
		for (const dir of [1, 3])
			if (p.joined[dir])
				pipesBetween(centre, centre.clone().addScaledVector(toward(dir), c));
		switch (p.module) {
			case R.PIPE_X:
			case R.PIPE_Y: {
				// A rack cell is its pipes; a valve block on the floor marks it.
				const block = shell(
					[
						{ z: -0.02, w: 0.022, h: 0.022, e: 8, hard: true },
						{ z: 0.03, w: 0.022, h: 0.022, e: 8 },
					],
					structure,
					`valves-${p.dx}-${p.dy}`,
					8,
					true,
				);
				block.position.copy(centre);
				group.add(block);
				break;
			}
			case R.COLUMN:
				column(p);
				break;
			case R.CRACKER:
				cracker(p);
				break;
			case R.SHAFT: {
				// The mine head: a headframe over the shaft the plant eats from,
				// with a hoist house beside it. The rock *is* the ore, so what
				// stands here is the way into it rather than a pile beside it.
				const house = shell(
					[
						{ z: -0.05, w: 0.05, h: 0.04, e: 8, hard: true },
						{ z: 0.05, w: 0.05, h: 0.04, e: 8 },
					],
					hullMaterial(color, "refinery"),
					"hoist-house",
					8,
					true,
				);
				house.position.copy(centre).setY(centre.y + 0.05);
				group.add(house);
				const top = centre.clone().setZ(centre.z + 0.26);
				for (const [dx, dy] of [
					[-0.045, -0.045],
					[0.045, -0.045],
					[0.045, 0.045],
					[-0.045, 0.045],
				])
					truss(
						pools,
						centre.clone().add(V(dx, dy, -0.04)),
						top,
						S.strutKm,
						V(0, 0, 1),
					);
				const sheave = new THREE.Mesh(
					new THREE.TorusGeometry(0.02, 0.005, 4, 16),
					structure,
				);
				sheave.position.copy(top);
				sheave.rotation.y = Math.PI / 2;
				sheave.name = "sheave";
				group.add(sheave);
				// On top of the sheave: the headframe is in every plan, so every
				// refinery carries at least this one (#300).
				group.add(
					// Half sunk into the sheave's crown. The ring's top is at 25 m —
					// its 20 m radius plus its 5 m tube — and at 22 m the lamp was
					// inside the tube, hidden from every direction.
					obstructionBeacon(fixtures, top.clone().setZ(top.z + 0.025)),
				);
				break;
			}
			case R.TANKS:
				tankFarm(p);
				break;
			case R.FLARE: {
				// A flare stack: a lattice mast off the floor with a vent bank at
				// its head, throats up and away from the plant.
				const top = centre.clone().setZ(centre.z + 0.32);
				truss(
					pools,
					centre.clone().setZ(centre.z - 0.04),
					top,
					S.strutKm * 1.5,
					V(1, 0, 0),
				);
				// **The bank stays the Works' size, and its throats carry the
				// light** (#300). At 0.1 km the throats were 8.5 m plates on a
				// station 1.36 km across and measured **2.9 px** at docking
				// range, and §5 says *"Its flare is its light."* Growing the
				// bank to a cell and a quarter was tried and put back: each
				// throat is a real-size lit face with its own glare now
				// (`FITTING_KM.throat`, `station-glow.ts`), which is what makes
				// it read, and `tests/station-mesh.test.ts` holds the reach and
				// the corridor the bank has to stay inside.
				const bank = buildVentBank(fixtures, 0.1);
				bank.position.copy(top).setZ(top.z + 0.02);
				group.add(bank);
				// Beyond the bank's last nozzle and above its manifold: the flare
				// stack is the tallest thing on the plant (#300).
				group.add(
					// Half sunk into the manifold's top face at its +X end, beyond
					// the last nozzle: at 0.037 it sat inside the manifold's own
					// section and no ray down the axis reached it.
					obstructionBeacon(fixtures, top.clone().add(V(0.036, 0, 0.039))),
				);
				break;
			}
			case R.RADIATOR: {
				// **A rank of fins standing on the floor**, not a wing on the
				// rock. `buildRadiator` — the Warren's, the Collar's and the
				// Spar's — reaches 1.27 of its span and spans 1.34 across, so
				// on a rock this size it is a flat plate as tall as the station
				// whichever way it is turned; it was flown outboard on the
				// flank and again rooted on the axis, and the sheet showed a
				// billboard behind a rock both times. What a plant on a rock
				// actually has is a farm laid out on the ground, and a rank of
				// 0.1 km fins reads at range without being a wall.
				//
				// Its own dimensions rather than `SHIP_SCALE`'s, and plain
				// meshes rather than the pools, because a fin sized to a
				// courier is invisible on a 1.1 km rock and a pooled one is
				// held to the fixture caps `tests/station-finish.test.ts`
				// reads. A fixture is detail on a hull; this is plant.
				const host = toward(hostDirOf(p));
				const across = V(-host.y, host.x, 0);
				const spine = centre.clone().addScaledVector(host, -c * 0.34);
				const rail = new THREE.Mesh(
					new THREE.BoxGeometry(0.012, 0.012, 0.012),
					structure,
				);
				rail.scale.set(1, 1, 1);
				rail.position.copy(spine).setZ(spine.z + 0.012);
				group.add(rail);
				for (let i = 0; i < 7; i++) {
					const fin = new THREE.Mesh(
						new THREE.BoxGeometry(0.1, 0.005, 0.075),
						plainMaterial(0x5f6d78, 0.86, 0.3),
					);
					fin.position
						.copy(spine)
						.addScaledVector(across, (i - 3) * 0.026)
						.addScaledVector(host, 0.05)
						.setZ(spine.z + 0.045);
					fin.quaternion.setFromUnitVectors(V(1, 0, 0), host);
					fin.name = "radiator";
					group.add(fin);
				}
				break;
			}
		}
	}
	pools.emit(group, "module");

	/**
	 * **Lit ports on the dock face, which is what §5 asks for** (#300).
	 *
	 * They were two rows down the head house's ±X faces — vertical walls, so
	 * from the aperture axis they are edge-on and #274 measured them at exactly
	 * 0 px while their bounding sphere spanned 85 px of the frame. §5's own
	 * sentence for this role is *"lit ports on the dock face"*, and the dock
	 * face is the pad deck.
	 *
	 * **The deck is crowded, and the gaps are what places them.** Four berths
	 * stand on it at radius 0.155 km on the ±X and ±Y axes, each 58 m across, so
	 * each occupies about ±17° of the ring; `buildPadDeck` puts four floods on
	 * the diagonals at 0.82 of its own radius. The free sectors are the eight
	 * midpoints between those, and one port sits in each — laid **radially**,
	 * which is what the tangent argument above is for. The crowding that
	 * argument was written against belonged to the old 30 m pane; the real 3 m
	 * pane (#300) fits either way.
	 *
	 * The radius is the other half of the fit: inside the deck's own 0.20 km
	 * edge and outside the heat ring's 0.148 km, with the pane inside both.
	 */
	const PAD_PORT_RADIUS_KM = 0.171;
	group.add(
		portRun("refinery", 4, (i, count, position, normal, tangent) => {
			const theta = ((i + 0.5) / count) * Math.PI * 2;
			normal.set(0, 0, 1);
			// Along the radius, so the pane's length runs outward rather than
			// round the ring.
			tangent.set(Math.cos(theta), Math.sin(theta), 0);
			position.set(
				Math.cos(theta) * PAD_PORT_RADIUS_KM,
				Math.sin(theta) * PAD_PORT_RADIUS_KM,
				plane + 0.004,
			);
		}),
	);
	// Clutter on the head house's ±Y faces, between the ports.
	group.add(
		greebleRun(
			"refinery",
			"refinery-d",
			[
				{
					count: 18,
					sizeKm: 0.028,
					reliefKm: 0.02,
					place: (i, count, position, normal) => {
						const { row, along } = rowsOf(i, count, 2);
						const side = row === 0 ? 1 : -1;
						normal.set(0, side, 0);
						// **Under the pad's own plane, with the piece's height to
						// spare.** A row at 0.055 put the top band's centre at
						// 0.385 km against a 0.396 km plane, so a 28 m piece
						// crossed it — and the head house is 0.115 km half-wide
						// against a 0.106 km corridor radius, so a piece on a ±Y
						// face reaches 0.101 km from the axis. Inside the
						// cylinder and past the plane is exactly what the
						// corridor row forbids.
						position.set(
							(along - 0.5) * headHalf * 1.6,
							side * headHalf,
							WORKS_FLOOR_KM + 0.02 + (i % 4) * 0.038,
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
 * The cell pitch of the outpost Cluster, kilometres: a 70 m can in each
 * cell at 0.32 of it, and the three-cell diamond's tips at 0.33 km, inside
 * the pool's 0.42 km reach. 0.09 was flown first and the cluster was a
 * toy under its own 0.31 km pad, which the sim's berth catalogue sizes and
 * the form cannot shrink.
 */
const CLUSTER_CELL_KM = 0.11;

/**
 * Outpost D — Cluster. The Assembly's grammar at a fifth of the size
 * (`station-plant.ts`): a core can carrying the pad on its +Z face, a truss
 * spine, habitat cans docked end to end, and tank racks, a tower and
 * radiator fins where the plan hangs them. Every leaf is strutted from the
 * centre of every host beside it, every member at `SHIP_SCALE`.
 *
 * The pad deck overhangs the first ring of cells, which is why the
 * vocabulary bars the tower from that ring; everything else in a cell is
 * shorter than the deck's underside. Nothing spins (`docking.md` §4).
 */
function buildOutpostCluster(
	color: number,
	berthSeed: number,
	assemblySeed: number,
): BuiltPart {
	const r = STATION_GEOMETRY.outpost.coreRadiusKm;
	const plane = STATION_GEOMETRY.outpost.aperturePlaneKm;
	const c = CLUSTER_CELL_KM;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const { placements } = placementsOf(OUTPOST_VOCABULARY, assemblySeed);
	const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
	const structure = plainMaterial(0x6f7d88, 0.78, 0.42);
	const pools = new Pools();
	const toward = towardCell;
	const cellCentre = (p: Placement) => cellCentreKm(p, c, 0);
	const S = SHIP_SCALE;
	const O = OUTPOST;
	const canR = c * 0.32;

	// The core can, standing along the axis under the pad and sunk 10 m into
	// the deck slab, which begins 0.16·r under the plane.
	const coreR = c * 0.5;
	group.add(
		shell(
			[
				{ z: -c * 0.7, w: coreR * 0.8, h: coreR * 0.8, e: 2 },
				{ z: -c * 0.5, w: coreR, h: coreR, e: 2, hard: true },
				{ z: plane - r * 0.16 + 0.01, w: coreR, h: coreR, e: 2 },
			],
			hullMaterial(color, "outpost"),
			"core",
			12,
			true,
		),
	);
	group.add(buildPadDeck("outpost", fixtures, r, plane, berthSeed));
	// The vent bank under the core, throats down and away from the pad: the
	// only flare an outpost has, and the role's one moving light.
	const vent = buildVentBank(fixtures, r * 0.6);
	vent.position.set(coreR * 0.3, 0, -c * 0.72);
	vent.rotation.x = Math.PI;
	group.add(vent);

	const cans: Placement[] = [];
	/** A docking collar on a can's or the core's port. */
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
	/** A habitat can the length of its cell, necked at both ends. */
	const can = (p: Placement) => {
		const centre = cellCentre(p);
		const drum = shell(
			[
				{ z: -c * 0.5, w: canR * 0.8, h: canR * 0.8, e: 2, hard: true },
				{ z: -c * 0.42, w: canR, h: canR, e: 2, hard: true },
				{ z: c * 0.42, w: canR, h: canR, e: 2, hard: true },
				{ z: c * 0.5, w: canR * 0.8, h: canR * 0.8, e: 2 },
			],
			hullMaterial(color, "outpost"),
			`can-${p.dx}-${p.dy}`,
			12,
			true,
		);
		if (p.module === O.CAN_X) drum.rotation.y = Math.PI / 2;
		else drum.rotation.x = Math.PI / 2;
		drum.position.copy(centre);
		group.add(drum);
		const axisDirs = p.module === O.CAN_X ? [0, 1] : [2, 3];
		for (const dir of axisDirs)
			if (p.joined[dir])
				collar(
					centre.clone().addScaledVector(toward(dir), c * 0.5),
					p.module === O.CAN_X ? "x" : "y",
					canR,
				);
	};
	/** A leaf's struts, from the centre of every host beside it. */
	const leafSupport = (p: Placement) => {
		const centre = cellCentre(p);
		for (let dir = 0; dir < 4; dir++)
			if (OUTPOST_VOCABULARY.hosts.has(p.beside[dir]))
				truss(
					pools,
					centre.clone().addScaledVector(toward(dir), c),
					centre,
					S.strutKm,
					V(0, 0, 1),
				);
		return toward(hostDirOf(p));
	};
	for (const p of placements) {
		const centre = cellCentre(p);
		switch (p.module) {
			case O.CORE:
				for (let dir = 0; dir < 4; dir++)
					if (p.joined[dir])
						collar(
							toward(dir).multiplyScalar(coreR * 0.96),
							dir < 2 ? "x" : "y",
							canR * 1.15,
						);
				break;
			case O.CAN_X:
			case O.CAN_Y:
				can(p);
				cans.push(p);
				break;
			case O.TRUSS_X:
			case O.TRUSS_Y: {
				const axis = toward(p.module === O.TRUSS_X ? 1 : 3);
				truss(
					pools,
					centre.clone().addScaledVector(axis, -c * 0.5),
					centre.clone().addScaledVector(axis, c * 0.5),
					S.trussKm,
					V(0, 0, 1),
				);
				break;
			}
			case O.TANKS: {
				const host = leafSupport(p);
				tankRack(pools, {
					origin: centre.clone().add(V(0, 0, -S.tankKm * 1.2)),
					along: host,
					up: V(0, 0, 1),
					count: 4,
					radiusKm: S.tankKm,
					lengthKm: S.tankLengthKm,
				});
				break;
			}
			case O.TOWER:
				leafSupport(p);
				mast(pools, group, {
					base: centre,
					up: V(0, 0, 1),
					heightKm: S.mastHeightKm,
					widthKm: S.mastKm,
				});
				break;
			case O.FINS: {
				const host = leafSupport(p);
				radiatorLeaf(
					pools,
					centre.clone().addScaledVector(host, c * 0.5),
					host,
					5,
				);
				break;
			}
		}
	}
	pools.emit(group, "module");

	// Lit ports along the +Z face of every can, in its outboard half, for
	// the Assembly's reason: the planted cans sit against the core.
	group.add(
		portRun("outpost", cans.length * 2, (i, count, position, normal) => {
			const perCan = Math.max(1, Math.ceil(count / cans.length));
			const at = cans[i % cans.length];
			const slot = (Math.floor(i / cans.length) + 0.5) / perCan;
			const outboard = toward(
				at.module === O.CAN_X ? (at.dx >= 0 ? 1 : 0) : at.dy >= 0 ? 3 : 2,
			);
			normal.set(0, 0, 1);
			position
				.set(at.dx * c, at.dy * c, canR * 0.98)
				.addScaledVector(outboard, (0.25 + slot * 0.2) * c);
		}),
	);
	// Clutter on the core can's flank **above its port collars**, under the pad
	// slab. Round the ports at z = 0 the collars cover ±40° of the flank, and
	// a piece snapped onto a collar's square-section tube is one the mounting
	// row's ray misses — three of `nostromo`'s tripled count landed there.
	group.add(
		greebleRun(
			"outpost",
			"outpost-d",
			[
				{
					count: 10,
					sizeKm: coreR * 0.12,
					reliefKm: coreR * 0.1,
					place: (i, count, position, normal) => {
						const { theta } = ringAt(i, count);
						normal.set(Math.cos(theta), Math.sin(theta), 0);
						position
							.copy(normal)
							.multiplyScalar(coreR)
							.setZ(c * 0.65 + (i % 3) * c * 0.22);
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/**
 * The salvage's own draw off the assembly seed. The outpost's forms read one
 * seed and a station is drawn in one form, so this cannot correlate with the
 * Cluster's plan — it is a salt, so that seeds 0, 1 and 2 land far apart in
 * the LCG rather than on its first few correlated steps.
 */
const SALVAGE_SALT = 0x5a1e;

/**
 * Other ships' paint, drawn per piece with repeats — six colours over the bow,
 * the sections and the plates, up to a dozen pieces — because a junk-built form
 * painted in one colour reads as a designed one. The core keeps the caller's
 * colour (§7's cue); the pods have their own freight colours below.
 */
const SALVAGE_PAINTS = [
	0x8a8f93, 0x7b6a55, 0x5f6e76, 0x8c8768, 0x9a9da0, 0x6d5f52,
] as const;
/** Cargo pods are stencilled freight colours, not hull paint. */
const POD_PAINTS = [0x9c7a3c, 0x5c7a8a, 0x7d6b45, 0xa8a090, 0x4f6a5a] as const;

/**
 * Work lamps: warm, and not the pad's cool floods. A raider haven is lit by
 * whatever lamps were to hand, clamped to the junk where the work is. Not
 * red — `hud-and-scanner.md` §4 owns red as refusal.
 */
export const WORK_LAMP_COLOR = 0xffd9a0;
const WORK_LAMP_MATERIAL = shared(
	emissiveMaterial(WORK_LAMP_COLOR, STATION_EMISSIVE_INTENSITIES.flood),
);
const WORK_LAMP_GLOW = steadyGlowMaterial(
	WORK_LAMP_COLOR,
	STATION_EMISSIVE_INTENSITIES.flood,
	"flood",
);
/** One lamp's box, kept: every work lamp on every salvage is the same fitting. */
const WORK_LAMP_GEOMETRY = shared(
	new THREE.BoxGeometry(
		FITTING_KM.flood[0],
		FITTING_KM.flood[1],
		FITTING_KM.flood[2],
	),
);
/**
 * A unit box, kept, that a torn shard or a patch plate scales to its own size:
 * a fresh `BoxGeometry` per piece was a geometry per piece to build and free.
 */
const SALVAGE_UNIT_BOX = shared(new THREE.BoxGeometry(1, 1, 1));
/** The torn edge's bare metal, kept, rather than one material per shard. */
const TORN_MATERIAL = shared(plainMaterial(0x4a4f52, 0.9, 0.5));

/** A place on a built piece where the next one can be welded. */
interface Socket {
	/** On the surface, in kilometres. */
	at: THREE.Vector3;
	/** The surface's outward normal. */
	normal: THREE.Vector3;
	/** The host's own long axis, which a pod strapped to it lies along. */
	axis: THREE.Vector3;
	/** A side socket takes a pod or a lamp; an end socket takes a section. */
	kind: "side" | "end";
}

/**
 * Outpost E — Salvage (#518). *Welded together from salvage — hull sections,
 * cargo pods and a ship's forward half bolted around the pad. Improvised,
 * asymmetric, lit by work lamps.*
 *
 * **Grown, not solved.** The Cluster collapses a grid, and a grid is exactly
 * what junk is not. This accretes instead: a salvaged freighter section stands
 * on the axis under the pad as the core, and every later piece is welded onto a
 * socket on something already built — sunk into it, so the islands row sees
 * contact rather than a strut. The plan is the assembly seed's (§7.1), and
 * every seed leans the pile toward one side of the core, because a pile that
 * balances round its axis reads as designed.
 *
 * **Every welded piece — the bow, a section, a pod — is checked on its box
 * before it is kept**: inside 0.40 km of the pool's 0.42, and behind the
 * deck's underside unless it is 0.2 km off the axis, well clear of the
 * corridor. One that fails is not placed and its socket goes back. The rest is
 * not checked here and does not need to be: plates and lamps sit on the core
 * or a checked piece, the canopy and the torn shards on the bow, and the
 * girders run from the deck's rim at 0.78·r to a socket, all behind the
 * plane. The corridor and reach rows in `tests/station-mesh.test.ts` measure
 * the whole built form over the seed spread, which is what holds all of it.
 */
function buildOutpostSalvage(
	color: number,
	berthSeed: number,
	assemblySeed: number,
): BuiltPart {
	const r = STATION_GEOMETRY.outpost.coreRadiusKm;
	const plane = STATION_GEOMETRY.outpost.aperturePlaneKm;
	/** The pad slab's underside, which `buildPadDeck` puts 0.16·r under. */
	const deckUnder = plane - r * 0.16;
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const pools = new Pools();
	const rand = seededRand(mix(assemblySeed, SALVAGE_SALT));
	const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
	const pick = <T>(xs: readonly T[]) =>
		xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
	const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
	const Z = V(0, 0, 1);
	/** How far a welded piece is sunk into its host: 3 m, five times the
	 *  islands row's overlap on this role. */
	const SINK = 0.003;
	/** The pool's 0.42 km, less what a lamp or a greeble adds. */
	const REACH = 0.4;

	// The core: a boxy freighter section standing on the axis, sunk into the
	// deck slab. It keeps the caller's colour and the name the probe reads.
	const coreW = SALVAGE_CORE.halfWidthKm;
	const coreH = SALVAGE_CORE.halfHeightKm;
	const coreBottom = SALVAGE_CORE.bottomKm;
	group.add(
		shell(
			[
				{ z: coreBottom, w: coreW * 0.9, h: coreH * 0.9, e: 4, hard: true },
				{ z: coreBottom + 0.012, w: coreW, h: coreH, e: 4, hard: true },
				{ z: -0.02, w: coreW, h: coreH, e: 4, hard: true },
				{ z: -0.012, w: coreW * 1.06, h: coreH * 1.06, e: 4, hard: true },
				{ z: -0.004, w: coreW, h: coreH, e: 4, hard: true },
				{ z: deckUnder + 0.01, w: coreW, h: coreH, e: 4 },
			],
			hullMaterial(color, "outpost"),
			"core",
			12,
			true,
		),
	);
	group.add(buildPadDeck("outpost", fixtures, r, plane, berthSeed));

	/** The direction the pile leans, and so which faces take the big pieces. */
	const leanAngle = rand() * Math.PI * 2;
	const lean = V(Math.cos(leanAngle), Math.sin(leanAngle), 0);
	const coreFaces = [
		{ normal: V(1, 0, 0), half: coreW, across: coreH },
		{ normal: V(-1, 0, 0), half: coreW, across: coreH },
		{ normal: V(0, 1, 0), half: coreH, across: coreW },
		{ normal: V(0, -1, 0), half: coreH, across: coreW },
	];
	const sockets: Socket[] = [];
	for (const face of coreFaces)
		for (const z of [-0.12, -0.06, 0.0, 0.05, 0.1]) {
			const tangent = V(-face.normal.y, face.normal.x, 0);
			sockets.push({
				at: face.normal
					.clone()
					.multiplyScalar(face.half)
					.addScaledVector(tangent, between(-0.5, 0.5) * face.across)
					.setZ(z + between(-0.01, 0.01)),
				normal: face.normal.clone(),
				axis: Z.clone(),
				kind: "side",
			});
		}

	/** Whether a box, authored along +Z from 0 to `length` and placed by
	 *  `matrix`, stays inside the reach and out of the pad's corridor. */
	const fits = (
		matrix: THREE.Matrix4,
		halfX: number,
		halfY: number,
		length: number,
	) => {
		const corner = new THREE.Vector3();
		for (const x of [-halfX, halfX])
			for (const y of [-halfY, halfY])
				for (const z of [0, length]) {
					corner.set(x, y, z).applyMatrix4(matrix);
					if (corner.length() > REACH) return false;
					// Behind the plane with room for the deck's lamps, or clear
					// of the corridor's cylinder by a wide margin.
					if (
						corner.z > deckUnder - 0.004 &&
						Math.hypot(corner.x, corner.y) < 0.2
					)
						return false;
				}
		return true;
	};

	/** A frame with +Z along `axis` and +Y as near `up` as it can be. */
	const frame = (at: THREE.Vector3, axis: THREE.Vector3, up: THREE.Vector3) => {
		const z = axis.clone().normalize();
		let x = new THREE.Vector3().crossVectors(up, z);
		if (x.lengthSq() < 1e-8)
			x = new THREE.Vector3().crossVectors(V(1, 0, 0), z);
		x.normalize();
		const y = new THREE.Vector3().crossVectors(z, x);
		return new THREE.Matrix4().makeBasis(x, y, z).setPosition(at);
	};

	/** Place a lofted piece by `matrix` and hand out its sockets. */
	const weld = (
		mesh: THREE.Mesh,
		matrix: THREE.Matrix4,
		halfX: number,
		halfY: number,
		length: number,
		ends: boolean,
	) => {
		matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
		group.add(mesh);
		const x = new THREE.Vector3();
		const y = new THREE.Vector3();
		const z = new THREE.Vector3();
		matrix.extractBasis(x, y, z);
		const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
		for (const t of [0.35, 0.7])
			for (const [normal, half] of [
				[x, halfX],
				[x.clone().negate(), halfX],
				[y, halfY],
				[y.clone().negate(), halfY],
			] as const)
				sockets.push({
					at: origin
						.clone()
						.addScaledVector(z, t * length)
						.addScaledVector(normal, half),
					normal: normal.clone(),
					axis: z.clone(),
					kind: "side",
				});
		if (ends)
			sockets.push({
				at: origin.clone().addScaledVector(z, length),
				normal: z.clone(),
				axis: z.clone(),
				kind: "end",
			});
	};

	/** Take a socket the filter accepts, at random; `undefined` when none do. */
	const take = (accept: (s: Socket) => boolean) => {
		const open = sockets.filter(accept);
		if (open.length === 0) return undefined;
		const socket = pick(open);
		sockets.splice(sockets.indexOf(socket), 1);
		return socket;
	};
	/** A big piece goes on the side the pile leans toward. */
	const leaning = (s: Socket) => s.normal.dot(lean) > 0.2;

	// **A ship's forward half**, broken off at midship and welded on by the
	// break. A capital hull's bow at real size: the carrier is 0.38 km long, so
	// half of one is what a raider would have towed in.
	for (let attempt = 0; attempt < 12; attempt++) {
		const socket = take((s) => s.kind === "side" && leaning(s));
		if (!socket) break;
		const length = between(0.17, 0.21);
		const w = between(0.045, 0.055);
		const h = w * between(0.6, 0.75);
		const tangent = new THREE.Vector3().crossVectors(Z, socket.normal);
		const dir = socket.normal
			.clone()
			.addScaledVector(tangent, between(-0.5, 0.5))
			.addScaledVector(Z, between(-0.2, 0.1))
			.normalize();
		const start = socket.at.clone().addScaledVector(dir, -SINK * 3);
		const matrix = frame(
			start,
			dir,
			V(between(-0.4, 0.4), between(-0.4, 0.4), 1),
		);
		if (!fits(matrix, w, h, length)) {
			sockets.push(socket);
			continue;
		}
		const bow = shell(
			[
				{ z: 0, w: w * 0.96, h: h * 0.96, e: 3, hard: true },
				{ z: length * 0.04, w, h, e: 3 },
				{ z: length * 0.45, w: w * 0.98, h: h * 1.02, e: 3 },
				{ z: length * 0.75, w: w * 0.72, h: h * 0.8, y: h * 0.1, e: 2.6 },
				{ z: length * 0.93, w: w * 0.3, h: h * 0.35, y: h * 0.12, e: 2.2 },
				{ z: length, w: w * 0.06, h: h * 0.08, y: h * 0.12, e: 2 },
			],
			hullMaterial(pick(SALVAGE_PAINTS), "outpost"),
			"salvage-bow",
			16,
			true,
		);
		weld(bow, matrix, w, h, length * 0.6, false);
		// The canopy blister, dark, where the bridge was.
		const canopy = shell(
			[
				{ z: length * 0.62, w: w * 0.2, h: h * 0.18, e: 2.4 },
				{ z: length * 0.72, w: w * 0.28, h: h * 0.28, e: 2.4 },
				{ z: length * 0.8, w: w * 0.12, h: h * 0.12, e: 2.4 },
			],
			plainMaterial(0x1b2227, 0.25, 0.8),
			"bow-canopy",
			10,
		);
		canopy.position.y = h * 0.95;
		bow.add(canopy);
		// The torn edge at the break: frames and plating left ragged.
		for (let i = 0; i < 7; i++) {
			const theta = (i / 7) * Math.PI * 2 + between(-0.2, 0.2);
			const depth = between(0.008, 0.022);
			const shard = new THREE.Mesh(SALVAGE_UNIT_BOX, TORN_MATERIAL);
			shard.scale.set(w * 0.35, 0.002, depth);
			shard.position.set(
				Math.cos(theta) * w * 0.94,
				Math.sin(theta) * h * 0.94,
				-depth * 0.3,
			);
			shard.rotation.z = theta + Math.PI / 2;
			shard.name = "bow-torn";
			bow.add(shard);
		}
		break;
	}

	// **Hull sections**, cut out of other wrecks: two or three, each welded to
	// the core or end to end onto the last one, and each its own paint.
	const sectionCount = 2 + Math.floor(rand() * 2);
	let placed = 0;
	for (let attempt = 0; attempt < 30 && placed < sectionCount; attempt++) {
		const chain = placed > 0 && rand() < 0.45;
		const socket = take((s) =>
			chain ? s.kind === "end" : s.kind === "side" && leaning(s),
		);
		if (!socket) continue;
		const length = between(0.08, 0.15);
		const w = between(0.028, 0.045);
		const h = w * between(0.75, 1.0);
		const e = pick([2, 2.4, 4, 6] as const);
		const tangent = new THREE.Vector3().crossVectors(Z, socket.normal);
		if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
		const dir = socket.normal
			.clone()
			.addScaledVector(tangent.normalize(), between(-0.45, 0.45))
			.addScaledVector(Z, between(-0.3, 0.12))
			.normalize();
		const start = socket.at.clone().addScaledVector(dir, -SINK * 3);
		const matrix = frame(start, dir, Z);
		if (!fits(matrix, w, h, length)) {
			sockets.push(socket);
			continue;
		}
		const section = shell(
			[
				{ z: 0, w: w * 1.08, h: h * 1.08, e, hard: true },
				{ z: 0.004, w, h, e, hard: true },
				{ z: length - 0.004, w, h, e, hard: true },
				{ z: length, w: w * 1.08, h: h * 1.08, e },
			],
			hullMaterial(pick(SALVAGE_PAINTS), "outpost"),
			`salvage-section-${placed}`,
			e > 3 ? 8 : 12,
			true,
		);
		weld(section, matrix, w, h, length, true);
		placed++;
	}

	// **Cargo pods**, strapped along whatever they were welded to, in clumps.
	const podCount = 3 + Math.floor(rand() * 4);
	let pods = 0;
	for (let attempt = 0; attempt < 40 && pods < podCount; attempt++) {
		const socket = take((s) => s.kind === "side");
		if (!socket) break;
		const length = between(0.03, 0.055);
		const half = between(0.012, 0.02);
		const start = socket.at
			.clone()
			.addScaledVector(socket.normal, half - SINK)
			.addScaledVector(socket.axis, -length / 2);
		const matrix = frame(start, socket.axis, socket.normal);
		if (!fits(matrix, half, half, length)) {
			sockets.push(socket);
			continue;
		}
		const pod = shell(
			[
				{ z: 0, w: half * 0.92, h: half * 0.92, e: 8, hard: true },
				{ z: 0.002, w: half, h: half, e: 8, hard: true },
				{ z: length - 0.002, w: half, h: half, e: 8, hard: true },
				{ z: length, w: half * 0.92, h: half * 0.92, e: 8 },
			],
			hullMaterial(pick(POD_PAINTS), "outpost"),
			`salvage-pod-${pods}`,
			4,
			true,
		);
		// Its own outward faces take the next pod, so they stack.
		weld(pod, matrix, half, half, length, false);
		pods++;
	}

	// **Patch plates**, welded over holes in other hulls' paint: the one cue
	// that says *repaired by hand* at a range where a seam does not show. Two
	// thirds sunk, so the islands row reads the weld and the face stands 1 m
	// proud.
	const plateCount = 5 + Math.floor(rand() * 4);
	for (let i = 0; i < plateCount; i++) {
		const socket = take((s) => s.kind === "side");
		if (!socket) break;
		const thick = 0.003;
		// Drawn in this order so the plan is the one the sheet was ranked on:
		// width, height, then paint.
		const across = between(0.012, 0.028);
		const along = between(0.012, 0.028);
		const plate = new THREE.Mesh(
			SALVAGE_UNIT_BOX,
			hullMaterial(pick(SALVAGE_PAINTS), "outpost"),
		);
		plate.scale.set(across, along, thick);
		plate.position
			.copy(socket.at)
			.addScaledVector(socket.normal, thick * (0.5 - 2 / 3));
		plate.quaternion.setFromUnitVectors(Z, socket.normal);
		plate.rotateZ(between(-0.4, 0.4));
		plate.name = `salvage-plate-${i}`;
		group.add(plate);
	}

	// Girders from the pad's rim down into the pile: the deck is bolted onto
	// the junk, not standing on the core alone.
	for (let i = 0; i < 3; i++) {
		const socket = take((s) => s.kind === "side" && s.at.z < deckUnder - 0.03);
		if (!socket) break;
		const toward = V(socket.at.x, socket.at.y, 0);
		if (toward.lengthSq() < 1e-8) toward.copy(lean);
		toward.normalize().multiplyScalar(r * 0.78);
		truss(
			pools,
			V(toward.x, toward.y, deckUnder + 0.004),
			socket.at.clone().addScaledVector(socket.normal, -SINK),
			SHIP_SCALE.strutKm,
			Z,
		);
	}
	pools.emit(group, "module");

	// **Work lamps**, clamped to the junk and facing out from it.
	const lampCount = 6 + Math.floor(rand() * 4);
	for (let i = 0; i < lampCount; i++) {
		const socket = take((s) => s.kind === "side");
		if (!socket) break;
		const lamp = new THREE.Mesh(WORK_LAMP_GEOMETRY, WORK_LAMP_MATERIAL);
		lamp.position.copy(socket.at);
		lamp.quaternion.setFromUnitVectors(Z, socket.normal);
		lamp.name = "bay-flood";
		detail(lamp, "reduced");
		glowOnFitting(lamp, FITTING_KM.flood[0] * 3, WORK_LAMP_GLOW);
		group.add(lamp);
	}

	// Lit ports low on the core's four faces: somebody lives in the freighter
	// section, which is the one piece that was a habitat before.
	group.add(
		portRun("outpost", 6, (i, count, position, normal) => {
			const face = coreFaces[i % 4];
			const perFace = Math.max(1, Math.ceil(count / 4));
			const along = ((Math.floor(i / 4) % perFace) + 0.5) / perFace;
			const tangent = V(-face.normal.y, face.normal.x, 0);
			normal.copy(face.normal);
			position
				.copy(face.normal)
				.multiplyScalar(face.half)
				.addScaledVector(tangent, (along - 0.5) * face.across)
				.setZ(-0.13 + (i % 3) * 0.022);
		}),
	);
	group.add(
		greebleRun(
			"outpost",
			"outpost-e",
			[
				{
					count: 10,
					sizeKm: coreW * 0.14,
					reliefKm: coreW * 0.1,
					place: (i, count, position, normal) => {
						const face = coreFaces[i % 4];
						const tangent = V(-face.normal.y, face.normal.x, 0);
						normal.copy(face.normal);
						position
							.copy(face.normal)
							.multiplyScalar(face.half)
							.addScaledVector(
								tangent,
								(((i * 7) % count) / count - 0.5) * face.across,
							)
							.setZ(0.1 + (i % 2) * 0.016);
					},
				},
			],
			group,
		),
	);
	return { group, fixtures };
}

/**
 * Trade E — Wheel (#332). Two rims on one axis, after *2001*'s Space Station V:
 * one rim finished, plated and lit, and the other still being built.
 *
 * **A box section, not the Ring's tube.** The reference's rim is flat-faced, and
 * the section is what tells the two ring forms apart once both are in the pool;
 * a second torus would be the Ring drawn twice.
 *
 * **The unfinished rim is a lattice all the way round**, with plated sections at
 * intervals. The whole Wheel spins, and a half-built *arc* would make the
 * outline depend on the clock, which `station-types.md` §7.2 forbids for a
 * spinning part. Four continuous rails carry the circle; the cross members and
 * the plates stand inside it, so every phase shows the same outline.
 *
 * **The hub is sized from the bay, not from the slot.** A face at `hubFrontKm`
 * gives §13.1's bay 0.28 x 0.23 km across and 0.405 km deep; the Ring's hub is
 * sized from the slot alone and the bay stands out of it. Here the barrel
 * contains the bay's section and its aft cap is behind the bay's back wall, so
 * the spokes, rooted just inside the bearing collars, clear the bay walls.
 *
 * **So the rims are sized from the hub.** The first sheet put 0.70 km rims on
 * that hub and it read as a drum with hoops round it — a quarter of the rim's
 * radius, where the reference's hub is nearer a sixth. The bay fixes the hub,
 * so the rims grew instead: 0.95 km puts it under a fifth, and the Assembly
 * already reaches a kilometre, so a trade form this size is not a new class.
 */
const WHEEL = Object.freeze({
	rimOuterKm: 0.95,
	rimDepthKm: 0.1,
	rimWidthKm: 0.08,
	/** Each rim's centre plane, fore at +, aft at −. */
	wheelZKm: 0.16,
	hubHalfKm: 0.175,
	collarHalfKm: 0.2,
	hubFrontKm: 0.26,
	hubAftKm: -0.24,
	/** A spoke's half-extent along the axis, and across it. */
	spokeHalfKm: 0.026,
	spokeTangentKm: 0.02,
	barHalfKm: 0.006,
	/** A multiple of four, so a cross member stands at every spoke's angle. */
	frameStations: 56,
	/** The hub barrel's superellipse exponent: round enough to read as a barrel,
	 *  square enough to hold the bay's section at `hubHalfKm`. Read by the loft
	 *  and by the greebles placed on it, so the two cannot disagree. */
	hubExponent: 3,
	/** Where the unfinished rim is plated, degrees — irregular on purpose. */
	plateDeg: [0, 50, 115, 170, 235, 290],
	plateSpanDeg: 15,
});

/** A rectangular-section rim, swept round the axis as an open loft. */
function wheelRim(
	innerKm: number,
	outerKm: number,
	z: number,
	widthKm: number,
) {
	const station = (radius: number, at: number): Ring => ({
		z: at,
		w: radius,
		h: radius,
		e: 2,
		hard: true,
	});
	const half = widthKm / 2;
	// `ship-mesh.ts`'s collar construction: out across the aft face, along the
	// outer face, in across the fore face and home along the bore, `open` so no
	// fan is drawn across either end.
	const geometry = hullLoft(
		[
			station(innerKm, z - half),
			station(outerKm, z - half),
			station(outerKm, z + half),
			station(innerKm, z + half),
			station(innerKm, z - half),
		],
		{ segments: 48, subdivisions: 1, open: true },
	);
	return panelUVs(geometry);
}

/** A thin square member between two points, for the unfinished rim's lattice. */
function frameBar(from: THREE.Vector3, to: THREE.Vector3, halfKm: number) {
	const geometry = hullLoft(
		[
			{ z: 0, w: halfKm, h: halfKm, e: 6, hard: true },
			{ z: from.distanceTo(to), w: halfKm, h: halfKm, e: 6, hard: true },
		],
		{ segments: 4, subdivisions: 1 },
	);
	const turn = new THREE.Quaternion().setFromUnitVectors(
		PLUS_Z,
		to.clone().sub(from).normalize(),
	);
	geometry.applyMatrix4(
		new THREE.Matrix4().compose(from, turn, new THREE.Vector3(1, 1, 1)),
	);
	return geometry;
}

/**
 * The unfinished rim: four continuous rails, the cross members and diagonals
 * merged into one mesh, and plated chords set inside the rails, centred on the
 * plane `z`.
 */
function wheelLattice(
	inner: number,
	outer: number,
	z: number,
	width: number,
	color: number,
) {
	const frame = new THREE.Group();
	frame.name = "rim-frame";
	const bar = WHEEL.barHalfKm;
	const depth = outer - inner;
	const centre = (inner + outer) / 2;
	const railOuter = outer - bar;
	const railInner = inner + bar;
	const railFore = z + width / 2 - bar;
	const railAft = z - width / 2 + bar;
	const frameMaterial = plainMaterial(0x8e7f72, 0.72, 0.42);
	[
		[railOuter, railFore],
		[railOuter, railAft],
		[railInner, railFore],
		[railInner, railAft],
	].forEach(([radius, at], i) => {
		const rail = new THREE.Mesh(
			new THREE.TorusGeometry(radius, bar, 6, 96),
			frameMaterial,
		);
		rail.position.z = at;
		rail.name = `rim-frame-rail-${i}`;
		frame.add(rail);
	});
	const at = (radius: number, theta: number, depthZ: number) =>
		new THREE.Vector3(
			Math.cos(theta) * radius,
			Math.sin(theta) * radius,
			depthZ,
		);
	const bars: THREE.BufferGeometry[] = [];
	const member = (from: THREE.Vector3, to: THREE.Vector3) =>
		frameBar(from, to, bar);
	for (let k = 0; k < WHEEL.frameStations; k++) {
		const theta = (k / WHEEL.frameStations) * Math.PI * 2;
		const next = ((k + 1) / WHEEL.frameStations) * Math.PI * 2;
		// One diagonal per bay on the outer face, alternating, which is what
		// makes the lattice read as a structure rather than a ladder.
		const [from, to] = k % 2 === 0 ? [railAft, railFore] : [railFore, railAft];
		bars.push(
			member(at(railOuter, theta, railAft), at(railOuter, theta, railFore)),
			member(at(railInner, theta, railAft), at(railInner, theta, railFore)),
			member(at(railInner, theta, railFore), at(railOuter, theta, railFore)),
			member(at(railInner, theta, railAft), at(railOuter, theta, railAft)),
			member(at(railOuter, theta, from), at(railOuter, next, to)),
		);
	}
	const members = new THREE.Mesh(mergeGeometries(bars), frameMaterial);
	members.name = "rim-frame-members";
	frame.add(members);
	// Each plate is a straight chord across its sector, so its corners are
	// pulled in until they sit inside the outer rail: a plate proud of the rail
	// at one phase and not another is the clock-dependent outline again.
	const plateHalf = depth * 0.37;
	const tangentHalf =
		centre * Math.sin(((WHEEL.plateSpanDeg / 2) * Math.PI) / 180);
	WHEEL.plateDeg.forEach((deg, i) => {
		const arm = new THREE.Group();
		arm.rotation.z = (deg * Math.PI) / 180;
		const plate = shell(
			[
				{ z: z - width / 2, w: plateHalf, h: tangentHalf, e: 8, hard: true },
				{ z: z + width / 2, w: plateHalf, h: tangentHalf, e: 8, hard: true },
			],
			hullMaterial(color, "trade"),
			`rim-frame-plate-${i}`,
			8,
			true,
		);
		plate.position.x = centre;
		arm.add(plate);
		frame.add(arm);
	});
	return frame;
}

function buildTradeWheel(color: number, berthSeed: number): BuiltPart {
	const group = new THREE.Group();
	const fixtures: StationFixture[] = [];
	const {
		rimOuterKm: outer,
		rimDepthKm: depth,
		rimWidthKm: width,
		wheelZKm,
	} = WHEEL;
	const inner = outer - depth;
	const centre = (inner + outer) / 2;
	const fore = wheelZKm;
	const aft = -wheelZKm;

	// The finished rim is `core`, as the Ring's rim is: the part the probes look
	// up by name, and the one the eye reads as the station.
	const rim = new THREE.Mesh(
		wheelRim(inner, outer, fore, width),
		flatCloneOf(hullMaterial(color, "trade")),
	);
	rim.name = "core";
	group.add(rim);

	group.add(wheelLattice(inner, outer, aft, width, color));
	const bar = WHEEL.barHalfKm;

	// Four spokes to each wheel, straight and single as the reference's are,
	// rooted inside the bearing collar. The far end is at `inner + 1.5 bar`:
	// inside the finished rim's box on the fore wheel, and three quarters of the
	// way through the inner axial member at the spoke's angle on the aft one —
	// which exists because `frameStations` is a multiple of four. It does not
	// reach the rails, which stand 2 m beyond the spoke's axial extent. Ending
	// at `inner + 2 bar` only touched the member's outer face (sage, #334 round
	// 1), and further out it would stand in the open lattice.
	const spokeMaterial = plainMaterial(0x8b95a0, 0.62, 0.48);
	const spokeRing = (z: number): Ring => ({
		z,
		w: WHEEL.spokeHalfKm,
		h: WHEEL.spokeTangentKm,
		e: 6,
		hard: true,
	});
	for (const [label, z] of [
		["fore", fore],
		["aft", aft],
	] as const) {
		for (let i = 0; i < 4; i++) {
			const arm = new THREE.Group();
			arm.rotation.z = (i / 4) * Math.PI * 2;
			arm.position.z = z;
			arm.name = `spoke-${label}-${i}`;
			const member = shell(
				[spokeRing(WHEEL.hubHalfKm * 0.85), spokeRing(inner + bar * 1.5)],
				spokeMaterial,
				`spoke-${label}-${i}-member`,
				8,
				true,
			);
			// Local +Z to the station's radial, as the Ring's members are turned.
			member.rotation.y = Math.PI / 2;
			arm.add(member);
			group.add(arm);
		}
	}

	// The hub: a barrel with a bearing collar at each wheel and the slot cut into
	// its front cap.
	const { hubHalfKm: hub, collarHalfKm: collar, hubExponent } = WHEEL;
	const barrel = (z: number, half: number): Ring => ({
		z,
		w: half,
		h: half,
		e: hubExponent,
		hard: true,
	});
	/** The barrel's own radius at an angle round the axis. */
	const hubRadiusAt = (theta: number) =>
		hub /
		(Math.abs(Math.cos(theta)) ** hubExponent +
			Math.abs(Math.sin(theta)) ** hubExponent) **
			(1 / hubExponent);
	const collarAt = (z: number) => [
		barrel(z - 0.04, hub),
		barrel(z - 0.02, collar),
		barrel(z + 0.02, collar),
		barrel(z + 0.04, hub),
	];
	group.add(
		shell(
			[
				barrel(WHEEL.hubAftKm, hub * 0.7),
				barrel(WHEEL.hubAftKm + 0.02, hub),
				...collarAt(aft),
				...collarAt(fore),
				// No taper at the cap: the bay runs to the mouth at full section,
				// and a cap drawn in to 0.91 let its corners out over the last 6 m
				// (sage, #334 round 1). `the hub contains the bay` holds it.
				barrel(WHEEL.hubFrontKm - 0.03, hub),
				barrel(WHEEL.hubFrontKm, hub),
			],
			plainMaterial(0x8b95a0, 0.6, 0.5),
			"hub",
			20,
			true,
			apertureCut("trade"),
		),
	);
	group.add(buildAperture("trade", fixtures, WHEEL.hubFrontKm, berthSeed));

	// Paired ports along the finished rim's fore face, the face the approach sees.
	group.add(
		portRun("trade", PANE_COUNT, (i, count, position, normal) => {
			const { theta, side } = ringAt(i, count);
			normal.set(0, 0, 1);
			const radius = centre + side * depth * 0.22;
			position.set(
				Math.cos(theta) * radius,
				Math.sin(theta) * radius,
				fore + width / 2,
			);
		}),
	);
	// On the same face, on the rim's centre line where no port stands.
	group.add(
		strobePair("trade", fixtures, LAMP_POOL_KM.face, (side, position) => {
			const theta = Math.PI / 4;
			position.set(
				side * Math.cos(theta) * centre,
				side * Math.sin(theta) * centre,
				fore + width / 2,
			);
		}),
	);
	// Clutter on the hub barrel between the collars, far inside the outline.
	group.add(
		greebleRun(
			"trade",
			"trade-e",
			[
				{
					count: 24,
					sizeKm: 0.018,
					reliefKm: 0.012,
					place: (i, count, position, normal) => {
						const { theta } = ringAt(i, count);
						const c = Math.cos(theta);
						const s = Math.sin(theta);
						// On the surface rather than inside it.
						const radius = hubRadiusAt(theta);
						normal.set(c, s, 0);
						position.set(
							c * radius,
							s * radius,
							-wheelZKm * 0.5 + ((i % 5) / 4) * wheelZKm,
						);
					},
				},
			],
			group,
		),
	);
	group.add(wheelDetail(color, inner, outer, fore, aft, width, hubRadiusAt));
	return { group, fixtures };
}

/**
 * The Wheel's detail pass (film round): what turns a drawing of two hoops into
 * a place people live in. Everything stays inside the 0.98 km reach and roots
 * in the structure it sits on.
 *
 * - **Window bands** on the finished rim's outer face and front face, laid
 *   along the ring with the game's own pane run.
 * - **Ribs**: radial bulkheads standing proud of the finished rim, so the sun
 *   draws a line of shadow at every frame and the rim reads as built.
 * - **Habitat blisters** under the finished rim between the spokes.
 * - **Transit tubes** beside each fore spoke, hub to rim.
 * - **Radiator fins** off the hub between the collars, and a mast with a dish
 *   off the aft cap.
 */
function wheelDetail(
	color: number,
	inner: number,
	outer: number,
	fore: number,
	aft: number,
	width: number,
	hubRadiusAt: (theta: number) => number,
): THREE.Group {
	const detailGroup = new THREE.Group();
	detailGroup.name = "wheel-detail";
	const depth = outer - inner;
	const ribMaterial = plainMaterial(0x6f7a85, 0.55, 0.55);
	const box = (sx: number, sy: number, sz: number, m: THREE.Matrix4) =>
		new THREE.BoxGeometry(sx, sy, sz).applyMatrix4(m);
	const at = (theta: number, radius: number, z: number) =>
		new THREE.Matrix4().compose(
			new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, z),
			new THREE.Quaternion().setFromAxisAngle(
				new THREE.Vector3(0, 0, 1),
				theta,
			),
			new THREE.Vector3(1, 1, 1),
		);

	// Ribs: on the front face (radial bars) and round the outer face (hoops).
	const ribs: THREE.BufferGeometry[] = [];
	const RIBS = 36;
	for (let k = 0; k < RIBS; k++) {
		const theta = (k / RIBS) * Math.PI * 2;
		ribs.push(
			box(
				depth * 0.96,
				0.007,
				0.006,
				at(theta, (inner + outer) / 2, fore + width / 2 + 0.002),
			),
		);
		ribs.push(box(0.008, 0.007, width * 1.02, at(theta, outer + 0.002, fore)));
		ribs.push(
			box(
				depth * 0.96,
				0.007,
				0.006,
				at(theta, (inner + outer) / 2, fore - width / 2 - 0.002),
			),
		);
	}
	const ribMesh = new THREE.Mesh(mergeGeometries(ribs), ribMaterial);
	ribMesh.name = "wheel-ribs";
	detailGroup.add(ribMesh);

	// Window bands: two along the outer face, two more round the front face.
	const PANES = 132;
	for (const zRow of [-0.22, 0.22]) {
		detailGroup.add(
			portRun("trade", PANES, (i, count, position, normal, tangent) => {
				const theta = ((i + 0.5) / count) * Math.PI * 2;
				normal.set(Math.cos(theta), Math.sin(theta), 0);
				tangent.set(-Math.sin(theta), Math.cos(theta), 0);
				position.set(
					Math.cos(theta) * (outer + 0.0006),
					Math.sin(theta) * (outer + 0.0006),
					fore + zRow * width,
				);
			}),
		);
	}
	for (const radial of [0.12, 0.88]) {
		detailGroup.add(
			portRun("trade", PANES, (i, count, position, normal, tangent) => {
				const theta = ((i + 0.25) / count) * Math.PI * 2;
				const radius = inner + depth * radial;
				normal.set(0, 0, 1);
				tangent.set(-Math.sin(theta), Math.cos(theta), 0);
				position.set(
					Math.cos(theta) * radius,
					Math.sin(theta) * radius,
					fore + width / 2 + 0.0006,
				);
			}),
		);
	}

	// Habitat blisters under the finished rim, between the spokes.
	const blisterMaterial = hullMaterial(color, "trade");
	for (let k = 0; k < 8; k++) {
		const theta = Math.PI / 8 + (k * Math.PI) / 4;
		const blister = new THREE.Mesh(
			new THREE.BoxGeometry(0.035, 0.11, width * 0.8),
			blisterMaterial,
		);
		blister.applyMatrix4(at(theta, inner - 0.0165, fore));
		blister.name = `wheel-blister-${k}`;
		detailGroup.add(blister);
	}
	detailGroup.add(
		portRun("trade", 48, (i, count, position, normal, tangent) => {
			const k = i % 8;
			const along =
				(Math.floor(i / 8) / Math.max(1, Math.ceil(count / 8) - 1) - 0.5) *
				0.08;
			const theta = Math.PI / 8 + (k * Math.PI) / 4;
			normal.set(-Math.cos(theta), -Math.sin(theta), 0);
			tangent.set(-Math.sin(theta), Math.cos(theta), 0);
			const r = inner - 0.0335;
			position.set(
				Math.cos(theta) * r - Math.sin(theta) * along,
				Math.sin(theta) * r + Math.cos(theta) * along,
				fore,
			);
		}),
	);

	// Transit tubes beside the fore spokes.
	const tubeMaterial = plainMaterial(0xa9b2bb, 0.5, 0.45);
	for (let k = 0; k < 4; k++) {
		const theta = (k * Math.PI) / 2 + 0.045;
		const from = hubRadiusAt(theta) - 0.01;
		const to = inner + 0.004;
		const tube = new THREE.Mesh(
			new THREE.CylinderGeometry(0.0075, 0.0075, to - from, 12),
			tubeMaterial,
		);
		tube.rotation.z = theta - Math.PI / 2;
		tube.position.set(
			(Math.cos(theta) * (from + to)) / 2,
			(Math.sin(theta) * (from + to)) / 2,
			fore + 0.018,
		);
		tube.name = `wheel-tube-${k}`;
		detailGroup.add(tube);
	}

	// Radiator fins off the hub, between the spokes and the collars.
	const finMaterial = plainMaterial(0xd5dbe0, 0.35, 0.2);
	for (let k = 0; k < 4; k++) {
		const theta = Math.PI / 4 + (k * Math.PI) / 2;
		const root = hubRadiusAt(theta) - 0.012;
		const fin = new THREE.Mesh(
			new THREE.BoxGeometry(0.17, 0.004, 0.18),
			finMaterial,
		);
		fin.applyMatrix4(at(theta, root + 0.085, (fore + aft) / 2));
		fin.name = `wheel-radiator-${k}`;
		detailGroup.add(fin);
	}

	// The aft mast and its dish.
	const mast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.006, 0.009, 0.22, 10),
		tubeMaterial,
	);
	mast.rotation.x = Math.PI / 2;
	mast.position.set(0, 0, WHEEL.hubAftKm - 0.1);
	mast.name = "wheel-mast";
	detailGroup.add(mast);
	const dish = new THREE.Mesh(
		new THREE.SphereGeometry(0.05, 24, 8, 0, Math.PI * 2, 0, Math.PI / 5),
		plainMaterial(0xc8ced4, 0.4, 0.3),
	);
	// apex toward the hub, seated 5 m into the mast tip; the bowl opens aft
	dish.rotation.x = Math.PI / 2;
	dish.position.set(0, 0, WHEEL.hubAftKm - 0.21 - 0.045);
	dish.name = "wheel-dish";
	detailGroup.add(dish);
	return detailGroup;
}

/**
 * Every form, by role.
 *
 * A `Record<StationType, …>` for `station-types.md` §8.5's reason. Three
 * forms a role, a solved fourth on three of them since #202 and #257, a fifth
 * on trade since #332's Wheel, and a fifth on outpost since #518's Salvage:
 * `STATION_FORM_IDS` is the union of ids a role may use and a role's list is
 * not required to fill it —
 * `buildStationForm` refuses an id its role does not carry.
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
		{
			id: "e",
			name: "Wheel",
			thesis:
				"two box-section rims on one axis — one plated and lit, one still a lattice — on a hub carrying the dock",
			// The rims' outer corners, `hypot(0.95, 0.20)` = 0.971 km: nothing on
			// the hub or the lattice passes them.
			reachKm: 0.98,
			build: buildTradeWheel,
		},
	],
	shipyard: [
		{
			id: "a",
			name: "Gantry",
			thesis: "bridge keel under open ribbed bays sized for a ship",
			// **1.66 since the keel went to 680 m aft** (the spindle, see
			// `SHIPYARD_KEEL_AFT_KM`); 1.53 before that, and #28's 1.5 before
			// the first move. The keel's far end is `hypot(1.426, 0.120, z)`
			// from the centre and its z is the keel's offset plus its end
			// section's half-height: 0.50 km reached 1.516, 0.82 reaches 1.65.
			// The declaration follows the decided shape rather than the shape
			// being trimmed to an old declaration. `docking.md` §5's "roughly
			// 1.5 km" is now 10% under.
			reachKm: 1.66,
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
		{
			id: "d",
			name: "Works",
			thesis:
				"the rock quarried flat and a plant solved onto its floor by wave function collapse; the pad on the head house, a mine head at the edge",
			// **The rock is what reaches**, and it is the same rock at every
			// seed: 0.632–0.639 km over the spread, which is a 0.55 km asteroid
			// displaced to about 1.15 of its nominal radius. Nothing the plan
			// puts on the quarried floor passes it — the tallest column tops out
			// at 0.5 km on the axis. `tests/station-mesh.test.ts` measures every
			// plan its seed spread builds against this.
			reachKm: 0.68,
			build: buildRefineryWorks,
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
		{
			id: "d",
			name: "Cluster",
			thesis:
				"the Assembly's grammar at a fifth of the size: a core can under the pad, a truss spine, cans and fins solved by wave function collapse",
			// The spine's tips are 0.27 km out; a leaf beside a tip cell reaches
			// about 0.25. The pool's figure, and the seed spread is measured
			// against it.
			reachKm: 0.42,
			build: buildOutpostCluster,
		},
		{
			id: "e",
			name: "Salvage",
			thesis:
				"welded together from salvage — hull sections, cargo pods and a ship's forward half bolted round the pad; improvised, asymmetric, lit by work lamps",
			// Grown to 0.40 km at most, each piece's box checked as it is kept;
			// the seed spread is measured against the pool's figure.
			reachKm: 0.42,
			build: buildOutpostSalvage,
		},
	],
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
	// **Also required.** The trade Assembly solved its plan from `berthSeed`
	// for a round (#255) and sage asked for the split; a default here would
	// put it back for any caller that forgot, silently, on a form whose whole
	// point is that two stations differ.
	assemblySeed: number,
): StationMesh {
	const form = formOf(type, formId);
	// The builder returns its own fixtures rather than filling an array handed
	// to it: with an out-parameter the return type said a builder produced no
	// lights while it in fact produced most of them, so a fourth station type
	// would have compiled with none and lit nothing.
	const built = form.build(color, berthSeed, assemblySeed);
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
		formId,
		silhouetteKm: stationSilhouetteKm(type, formId),
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

/**
 * Build one generated station: in its own form (`Station.formId`, node #717)
 * at its own seeds. There is no per-role form to fall back on — a system picks
 * each station's form from its role's pool — so this takes the station rather
 * than a type, and the mesh, the reach and the proxy all read the one record.
 */
export function buildStationMesh(
	station: StationPlan,
	color: number,
): StationMesh {
	return buildStationForm(
		station.type,
		station.formId,
		color,
		station.berthSeed,
		station.assemblySeed,
	);
}

/**
 * Show the accessories that belong at `level`, and hide the rest.
 *
 * Nothing here moves a vertex or rebuilds a geometry: the whole switch is
 * `visible` flags on objects tagged by `detail`, which is what makes §2's rule —
 * a detail level may not change the outline — checkable as an equality on the
 * mesh's reach rather than argued about.
 */
export function setStationDetail(mesh: StationMesh, level: DetailLevel): void {
	mesh.detail = level;
	for (const object of mesh.accessories) {
		const min = object.userData.minDetail as DetailLevel;
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
	const level = detailLevel(mesh.detail, distanceKm / mesh.silhouetteKm);
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
			fixture.base *
			fixtureIntensity(mesh.type, fixture.kind, gameTime, fixture.offsetS);
		if (fixture.glow)
			fixture.glow.uniforms.uIntensity.value =
				fixture.material.emissiveIntensity;
		if (fixture.pool)
			fixture.pool.uniforms.uIntensity.value =
				fixture.material.emissiveIntensity;
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
		formId: mesh.formId,
		silhouetteKm: mesh.silhouetteKm,
		fixtures: mesh.fixtures.map((fixture) => ({
			kind: fixture.kind,
			intensity: fixture.material.emissiveIntensity,
		})),
	};
}
