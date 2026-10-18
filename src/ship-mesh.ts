/**
 * Procedural display-only ship silhouettes.
 *
 * sim.ts remains authoritative for positions and flight, and issue #26 remains
 * the owner of any future roster-to-hull selection. These meshes create no
 * actors, collision volumes, target identity, AI, or fallback roster choice.
 *
 * Local -Z is the nose and +Z the exhaust end. Dimensions are kilometres
 * because the player hull lives directly in the near scene; this geometry never
 * crosses the far/near body handoff.
 *
 * Every primary surface is a swept superellipse loft. Rounds one to three built
 * hulls from flat polygons extruded straight down, which gives every part a
 * vertical side wall; the review of round three called the result boxy, and the
 * vertical wall is why. A loft carries its own curvature, so the one primitive
 * below replaces the plate extrusion, the lathe, and the stock cylinder.
 */
import * as THREE from "three";
import {
	AUTHORED_HULL_MODELS,
	isAuthoredHullModel as isAfterBootHull,
	type AuthoredHullModelId,
} from "./model-catalog";
import { EMISSIVE_CEILING } from "./light-rig";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mutePaint } from "./surface";

// Re-exported, not merely imported: `Ring` and `hullLoft` were this module's
// own until #56 gave them a second caller, and every existing importer and test
// reaches them through here.
export {
	type Ring,
	hullLoft,
	revolve,
	RING_SEGMENTS,
	SUBDIVISIONS,
} from "./loft";
import {
	type Ring,
	hullLoft,
	revolve,
	scaleUVs,
	setUvUnits,
	uvUnitsOf,
} from "./loft";
import {
	HULL_IDS,
	HULL_VARIANT_IDS,
	HULL_SPECS,
	type HullId,
	type HullVariantId,
} from "./hull";
import { disposeSubtree, shared } from "./gpu-teardown";
import type { Vec3 } from "./vec3";
import {
	currentHullFinish,
	hullFinishId,
	plate,
	plateUVs,
} from "./ship-surface";
export {
	HABITABLE_HULLS,
	SHIP_QUALITY,
	setShipDetail,
	updateShipVisuals,
} from "./ship-detail";
import {
	type ShipDetailPlan,
	type ShipLevels,
	type ShipSurface,
	adoptUndetailedShip,
	buildShipDetails,
} from "./ship-detail";
import { halfPixelKm, levelErrorKm, reducedLevel } from "./authored-levels";
import type { DetailLevel } from "./detail-level";

export const SHIP_DESIGN_ROUND = 11;

export interface HullVariant {
	readonly id: HullVariantId;
	readonly name: string;
	readonly thesis: string;
}

export const HULL_VARIANTS: Record<HullId, readonly HullVariant[]> = {
	courier: [
		{
			id: "a",
			name: "Kestrel",
			thesis: "rounded pressure hull with drive sponsons blended into the beam",
		},
		{
			id: "b",
			name: "Dogleg",
			thesis: "keel offset to port beside one deep starboard load bank",
		},
		{
			id: "c",
			name: "Skiff",
			thesis:
				"dorsal drive stacked over a ventral cargo pannier on a slim keel",
		},
	],
	interceptor: [
		{
			id: "a",
			name: "Lance",
			thesis:
				"bare drive spine with a forward crew bulb and a radial bell cluster",
		},
		{
			id: "b",
			name: "Yoke",
			thesis: "twin drive booms stacked above and below a braced crew spar",
		},
		{
			id: "c",
			name: "Corona",
			thesis:
				"annular drive ring carried around a central spar on short pylons",
		},
	],
	freighter: [
		{
			id: "a",
			name: "Derrick",
			thesis: "cargo drums slung beneath a gantry keel that carries the bridge",
		},
		{
			id: "b",
			name: "Porter",
			// The authored O2 (node #813): its approved geometry carries the
			// cassettes to port, where the procedural Porter had them starboard.
			thesis:
				"three freight cassettes to port of a compact starboard command keel",
		},
		{
			id: "c",
			name: "Trawler",
			thesis: "twin capsule tanks slung under a bridge mast on an open frame",
		},
	],
	miner: [
		{
			id: "a",
			name: "Adit",
			thesis: "cutter ring on the bow between two clamped ore holds",
		},
		{
			id: "b",
			name: "Longwall",
			thesis: "ore skips carried inline on the spine behind a ventral cutter",
		},
		{
			id: "c",
			name: "Pithead",
			thesis:
				"cutter slung under the keel with the refinery drum stacked above",
		},
	],
	patrol: [
		{
			id: "a",
			name: "Warden",
			thesis:
				"plated interdiction hull with dorsal hardpoints and a sensor dome",
		},
		{
			id: "b",
			name: "Marshal",
			thesis: "boarding tube carried to starboard off an offset command keel",
		},
		{
			id: "c",
			name: "Bailiff",
			thesis: "open interdiction ring carried ahead of a compact pursuit hull",
		},
	],
	explorer: [
		{
			id: "a",
			name: "Pilgrim",
			thesis: "habitat ring around the keel with the dish on an aft mast",
		},
		{
			id: "b",
			name: "Vagrant",
			thesis:
				"habitat drum to port, bunkerage and an aft-slung dish to starboard",
		},
		{
			id: "c",
			name: "Lantern",
			thesis: "dish on a mast above a habitat slung below a clear drive keel",
		},
	],
	raider: [
		{
			id: "a",
			name: "Shiv",
			thesis: "offset ram prow with unfaired weapon rails along the shoulders",
		},
		{
			id: "b",
			name: "Jackdaw",
			thesis:
				"someone else's cargo pod clamped to port against an oversized drive",
		},
		{
			id: "c",
			name: "Carrion",
			thesis: "dorsal grapple boom over a ventral snatch cradle on a low keel",
		},
	],
	carrier: [
		{
			id: "a",
			name: "Bastion",
			thesis: "full-length flight deck over a ribbed hull with a bow bay mouth",
		},
		{
			id: "b",
			name: "Colossus",
			thesis: "one vast starboard hangar block beside a port command keel",
		},
		{
			id: "c",
			name: "Anvil",
			thesis: "command tower riding a spine above a deep open hangar keel",
		},
	],
	tug: [
		{
			id: "a",
			name: "Bollard",
			thesis: "squat hull between oversized drives behind an open tow yoke",
		},
		{
			id: "b",
			name: "Grapnel",
			thesis: "port salvage crane balanced by one outsized starboard drive",
		},
		{
			id: "c",
			name: "Capstan",
			thesis: "winch gantry above and a tow hook below a stacked drive pair",
		},
	],
	prospector: [
		{
			id: "a",
			name: "Sluice",
			thesis: "slim keel over a bow sample drill between two ore panniers",
		},
		{
			id: "b",
			name: "Placer",
			thesis: "starboard drill boom worked against a port assay lab bulge",
		},
		{
			id: "c",
			name: "Cairn",
			thesis: "claim beacon on a mast above a drill slung under the keel",
		},
	],
	dreadnought: [
		{
			id: "a",
			name: "Rampart",
			thesis: "spinal gun the length of the hull between belted turret pairs",
		},
		{
			id: "b",
			name: "Aegis",
			thesis: "port armour block facing a starboard broadside of turrets",
		},
		{
			id: "c",
			name: "Bulwark",
			thesis: "gun deck riding a spine above a deep armour keel",
		},
	],
	// #331: a close homage to 2001's Discovery One. `a` is the reference; `b`
	// and `c` spend the asymmetric and stacked axes every role since round seven
	// has arrived on, so the pool is not the same ship three times.
	voyager: [
		{
			id: "a",
			name: "Odyssey",
			thesis:
				"command sphere ahead of a long vertebral spine, paired drives aft, dish array on a mast",
		},
		{
			id: "b",
			name: "Wayfarer",
			thesis:
				"command sphere and spine with a port tank bank balancing a starboard dish",
		},
		{
			id: "c",
			name: "Lodestar",
			thesis:
				"command sphere under a raised spine with its pod run hung beneath and the drives stacked",
		},
	],
};

/**
 * How far each drawn hull reaches from its own origin, kilometres — the
 * **display** figure and nothing else.
 *
 * It is what `fleetLayout` spaces a gallery by and what `tests/ship-mesh.test.ts`
 * measures the built mesh against. #28's rule, applied to ships: a station's
 * display reach and its dockable geometry are separate tables in separate
 * modules, so the box a berth has to admit is `HULL_SPECS[id].env` in
 * `hull.ts` and is not this. The two answer different questions — a reach is a
 * radius about a centre, an envelope is a box — and the day one is read for the
 * other is the day a berth is allocated by a number that describes a gallery.
 */
export const HULL_REACH_KM: Readonly<Record<HullId, number>> = {
	courier: 0.036,
	interceptor: 0.036,
	freighter: 0.04,
	miner: 0.0422,
	patrol: 0.034,
	explorer: 0.044,
	raider: 0.038,
	// A capital hull is roughly seven couriers long. Nothing else in the pool
	// needs a second glance to work out which of two ships is the bigger; this
	// one has to answer that at a distance, which is why its detail is many
	// small repeated parts rather than a few large smooth ones.
	carrier: 0.2,
	// Bollard O4 at 1:1 (node #814): its farthest vertex, 36.03 m, rounded up.
	tug: 0.0361,
	prospector: 0.035,
	// Longer and narrower than the carrier, and it wears its armour outside.
	// Two capital classes only earn their places if they cannot be mistaken for
	// each other at the range a capital ship is first seen.
	dreadnought: 0.22,
	// Half the carrier's reach and far thinner than either capital: a sphere and
	// a spine, which reads as nothing else in the pool at any range.
	voyager: 0.1,
};

export interface ShipMesh {
	root: THREE.Group;
}

type Palette = Record<
	"hull" | "panel" | "trim" | "accent" | "canopy" | "engine" | "exhaust",
	THREE.MeshStandardMaterial
>;

const liveries: Record<
	HullId,
	{ hull: number; panel: number; accent: number }
> = {
	courier: { hull: 0x8fa6ae, panel: 0x4d6a75, accent: 0xd27b42 },
	interceptor: { hull: 0x8f93a6, panel: 0x4f536a, accent: 0xc8564b },
	freighter: { hull: 0x9c9481, panel: 0x5d5748, accent: 0xd0a04f },
	miner: { hull: 0x9a7c58, panel: 0x715c46, accent: 0xe0913a },
	patrol: { hull: 0xa9b6bd, panel: 0x3f5a72, accent: 0x4fa8e0 },
	explorer: { hull: 0x93a08f, panel: 0x4e5f59, accent: 0xe5d38a },
	raider: { hull: 0x6f7468, panel: 0x3d423b, accent: 0xb2452f },
	carrier: { hull: 0x8b929a, panel: 0x474e57, accent: 0xf0a63c },
	tug: { hull: 0xb08a4a, panel: 0x5c5340, accent: 0xf2d049 },
	prospector: { hull: 0x8d9a86, panel: 0x4f5a4b, accent: 0xd8a145 },
	dreadnought: { hull: 0x7b8288, panel: 0x3c434b, accent: 0xd4553c },
	voyager: { hull: 0xd2d4ce, panel: 0xb4b8b2, accent: 0xd29a48 },
};

/** One palette per hull id **per finish**: the maps, the paint and the exhaust
 *  material all depend on the finish in force, and a switch must not hand an
 *  industrial hull the stock palette it happened to find. */
const palettes = new Map<string, Palette>();

/**
 * The exhaust bowl's glow, hot at the throat and cooling to the lip.
 *
 * A 4×64 ramp sampled along `v`, which the bowl's UVs run from throat (0) to
 * lip (1). The emissive colour is white and the *map* carries the hue, so the
 * throat is white-hot and the rim the drive's own blue — one texture for every
 * drive in the game, and `emissiveIntensity` stays the single dial the
 * throttle and the workbench already drive.
 */
let exhaustGradient: THREE.DataTexture | undefined;

/**
 * The exhaust's colour `v` of the way from the throat (0) to the lip (1),
 * sRGB, 0…1 a channel. The one ramp every drive glow reads: the bowl's map
 * below, and the vent plumes (`vent-plumes.ts`, #621), where `v` is how far a
 * puff has travelled from its throat.
 */
export function exhaustRamp(v: number): [number, number, number] {
	// Cubed, so the heat is a core rather than a wash: most of the bowl is
	// the drive's blue, and only the throat is white.
	const hot = (1 - v) ** 3;
	const fade = 0.35 + 0.65 * (1 - v) ** 1.2;
	return [
		fade * (0.3 + 0.7 * hot),
		fade * (0.62 + 0.38 * hot),
		fade * (0.9 + 0.1 * hot),
	];
}

/** The suffix every drive bell's glow mesh is named with, disc or bowl. */
const EXHAUST_SUFFIX = "-exhaust";

/** Is `object` a drive bell's glow? The one test of the naming, for
 *  `vent-plumes.ts`, which draws the main drive at the bells (#621). */
export const isDriveBell = (object: THREE.Object3D): boolean =>
	object.name.endsWith(EXHAUST_SUFFIX);

function exhaustGradientMap() {
	if (exhaustGradient) return exhaustGradient;
	const width = 4;
	const height = 64;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const [fr, fg, fb] = exhaustRamp(y / (height - 1));
		const r = Math.round(255 * fr);
		const g = Math.round(255 * fg);
		const b = Math.round(255 * fb);
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	exhaustGradient = shared(
		new THREE.DataTexture(data, width, height, THREE.RGBAFormat),
	);
	exhaustGradient.colorSpace = THREE.SRGBColorSpace;
	exhaustGradient.wrapS = THREE.ClampToEdgeWrapping;
	exhaustGradient.wrapT = THREE.ClampToEdgeWrapping;
	exhaustGradient.magFilter = THREE.LinearFilter;
	exhaustGradient.minFilter = THREE.LinearFilter;
	exhaustGradient.needsUpdate = true;
	return exhaustGradient;
}

/**
 * Lift the dark structural paints after the scene exposure comes down.
 *
 * The primary hull paint already owns the measured highlight, so raising the
 * whole renderer would put it back above white. Applying the compensation only
 * to the darker panel, trim and engine pigments opens the exterior shadows
 * without moving the hull and accent colours that identify each livery.
 */
const SHADOW_PAINT_LIFT = 1.3;
function scalePaint(color: number, scale: number): number {
	const channel = (shift: number) =>
		Math.min(255, Math.round(((color >> shift) & 0xff) * scale));
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Ship-authored emissives, expressed against the shared exposure ceiling. */
export const SHIP_EMISSIVE_INTENSITIES = {
	canopy: EMISSIVE_CEILING * 0.12,
	exhaust: EMISSIVE_CEILING * 0.55,
} as const;

function makePalette(id: HullId): Palette {
	const finish = currentHullFinish();
	const key = `${hullFinishId()}:${id}`;
	const cached = palettes.get(key);
	if (cached) return cached;
	const authored = liveries[id];
	// Muted per the finish; `stock` is 1/1 and leaves #35's paint untouched.
	const colors = {
		hull: mutePaint(authored.hull, finish.paint),
		panel: mutePaint(authored.panel, finish.paint),
		accent: mutePaint(authored.accent, finish.paint),
	};
	const painted = (color: number, roughness: number, metalness: number) =>
		shared(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
	/**
	 * The four structural finishes, plated (#101).
	 *
	 * Not the canopy, the engine bell or the exhaust: the first is glass, the
	 * second a nozzle whose whole surface is smaller than two plates, and the
	 * third emits rather than reflects. Plating them would be texels on a
	 * surface that never reads as plate.
	 *
	 * **The figures below are still the finish.** `plate` reads each material's
	 * `roughness` and `metalness` and rescales them against what the shared wear
	 * map reads on a clean plate, so a clean plate renders at the values written
	 * here and the map supplies the variation around them. All four paints
	 * survive one map, which is the only reason one map is enough;
	 * `tests/surface.test.ts` asserts it for each of them.
	 *
	 * The rescale is clamped at 1, so a finish above the clean-plate reading —
	 * roughness 0.70 today — would render below what is written. Nothing here is
	 * near it, and the test asserts the headroom rather than the clamp, because
	 * a clamp that starts binding is silent.
	 */
	const platedPaint = (color: number, roughness: number, metalness: number) =>
		plate(painted(color, roughness, metalness));
	const palette: Palette = {
		hull: platedPaint(colors.hull, 0.5, 0.3),
		panel: platedPaint(scalePaint(colors.panel, SHADOW_PAINT_LIFT), 0.58, 0.36),
		trim: platedPaint(scalePaint(0x33454d, SHADOW_PAINT_LIFT), 0.5, 0.55),
		accent: platedPaint(colors.accent, 0.54, 0.24),
		canopy: shared(
			new THREE.MeshStandardMaterial({
				color: 0x173743,
				emissive: 0x061820,
				emissiveIntensity: SHIP_EMISSIVE_INTENSITIES.canopy,
				roughness: 0.2,
				metalness: 0.1,
			}),
		),
		engine: painted(scalePaint(0x293b42, SHADOW_PAINT_LIFT), 0.42, 0.58),
		exhaust:
			finish.drive === "bowl"
				? // The bowl is seen from *inside*: `BackSide` draws the far wall of
					// a loft whose normals point outward, and three flips the normal
					// for lighting. The map carries the hue and the throat's heat; the
					// emissive is white so the map is the whole of the colour.
					shared(
						new THREE.MeshStandardMaterial({
							color: 0x1b2f3a,
							emissive: 0xffffff,
							emissiveMap: exhaustGradientMap(),
							emissiveIntensity: SHIP_EMISSIVE_INTENSITIES.exhaust,
							roughness: 0.5,
							metalness: 0.1,
							side: THREE.BackSide,
						}),
					)
				: shared(
						new THREE.MeshStandardMaterial({
							color: 0x7fc4df,
							emissive: 0x4a9fca,
							emissiveIntensity: SHIP_EMISSIVE_INTENSITIES.exhaust,
							roughness: 0.36,
							metalness: 0.08,
						}),
					),
	};
	palettes.set(key, palette);
	return palette;
}

function add(
	root: THREE.Group,
	name: string,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	position: [number, number, number] = [0, 0, 0],
	rotation: [number, number, number] = [0, 0, 0],
) {
	// **Every part whose UVs are in kilometres, not every plated one.** Those
	// UVs are unusable as they stand by any map; dividing here rather than at
	// the four plated materials keeps one rule, and a geometry whose material
	// has no map pays a loop over an attribute nobody samples. `uvUnits` is
	// declared by `hullLoft` and by `hoop`, so the gate reads the fact it needs
	// rather than a marker that happens to travel with it — the exhaust disc
	// declares nothing and keeps its normalised unwrap.
	if (uvUnitsOf(geometry) === "km") plateUVs(geometry);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = name;
	mesh.position.set(...position);
	mesh.rotation.set(...rotation);
	root.add(mesh);
	return mesh;
}

/**
 * Re-express a loft's own axis as the ship's +X, turning a hull sweep into a
 * span sweep: stations become span, `w` becomes thickness and `h`/`b` chord.
 * The matrix is the cyclic axis permutation, so its determinant is +1 and the
 * outward winding survives; a mirror would not, which is what `mirrorX` fixes.
 */
const SPAN_TO_X = new THREE.Matrix4().set(
	0,
	0,
	1,
	0,
	1,
	0,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	0,
	0,
	1,
);

function transform(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) {
	geometry.applyMatrix4(matrix);
	const axis = geometry.userData.axis as number[][] | undefined;
	if (axis)
		geometry.userData.axis = axis.map((point) =>
			new THREE.Vector3(point[0], point[1], point[2])
				.applyMatrix4(matrix)
				.toArray(),
		);
	return geometry;
}

/** A blade — pylon, fin, or shoulder fairing — swept out along +X. */
function blade(
	stations: ReadonlyArray<Ring>,
	options: { segments?: number; subdivisions?: number } = {},
) {
	return transform(hullLoft(stations, options), SPAN_TO_X);
}

/**
 * Mirror across the ship's centreline.
 *
 * Negating one axis inverts every triangle, so the index triples are reversed
 * in the same pass; skipping that is how a mirrored part turns into a hole.
 */
function mirrorX(geometry: THREE.BufferGeometry) {
	const mirrored = geometry.clone();
	mirrored.userData = { ...geometry.userData };
	mirrored.scale(-1, 1, 1);
	const index = mirrored.getIndex();
	if (index) {
		const array = [...index.array];
		for (let triangle = 0; triangle < array.length; triangle += 3)
			[array[triangle], array[triangle + 2]] = [
				array[triangle + 2],
				array[triangle],
			];
		mirrored.setIndex(array);
	}
	const axis = geometry.userData.axis as number[][] | undefined;
	if (axis) mirrored.userData.axis = axis.map(([x, y, z]) => [-x, y, z]);
	mirrored.computeVertexNormals();
	return mirrored;
}

/**
 * A drive bell and its glow disc.
 *
 * The disc is deliberately a fraction of the bell mouth: exhaust reads as a
 * motion cue, and once it grows past the structure around it the hull stops
 * reading as mass under thrust and starts reading as a light source.
 */
function engineBell(
	root: THREE.Group,
	name: string,
	position: [number, number, number],
	radius: number,
	length: number,
	p: Palette,
) {
	if (currentHullFinish().drive === "bowl") {
		openBell(root, name, position, radius, length, p);
		return;
	}
	add(
		root,
		name + "-bell",
		revolve([
			[radius * 0.52, -length],
			[radius * 0.44, -length * 0.55],
			[radius * 0.62, -length * 0.2],
			[radius * 0.94, 0],
			[radius * 0.88, length * 0.12],
		]),
		p.engine,
		position,
	);
	add(
		root,
		name + EXHAUST_SUFFIX,
		new THREE.CircleGeometry(radius * 0.55, 14),
		p.exhaust,
		[position[0], position[1], position[2] + length * 0.13],
	);
}

/**
 * The industrial drive: an **open** bell with a glowing bowl set into it (#203).
 *
 * #199's review read the exhaust disc as a cyan sticker, and a sticker is what
 * it is — a flat emissive circle a hair behind a closed cap. A nozzle is open:
 * you look *into* it, the wall you see is the inside of the bell, and the heat
 * is at the bottom.
 *
 * Two lofts. The bell keeps its outer profile and then **folds back at the
 * lip**: the sweep continues from the mouth inward and down to a small throat,
 * so the same loft draws the outer wall, a lip with thickness, and an inner
 * wall whose normals face the axis — `hullLoft`'s winding turns the normal
 * over when the sweep runs backwards, and the loft's rear cap lands at the
 * throat, tiny, where the bowl hides it. The bowl is a second loft from the
 * throat to just inside the lip, drawn `BackSide` so its far wall is what
 * renders; its own front cap at the throat faces the viewer and is the hot
 * core. Its UVs are rewritten to run 0 at the throat and 1 at the lip, which
 * is the axis `exhaustGradientMap` grades along.
 *
 * The `-bell` and `-exhaust` names, and the rule that the exhaust's span stays
 * under half the drive's, are the disc's and are kept: the tests read the
 * pair by name and `emissiveIntensity` is still the one dial.
 */
function openBell(
	root: THREE.Group,
	name: string,
	position: [number, number, number],
	radius: number,
	length: number,
	p: Palette,
) {
	const ring = (r: number, z: number, hard = false): Ring => ({
		z,
		w: r,
		h: r,
		e: 2,
		hard,
	});
	add(
		root,
		name + "-bell",
		hullLoft(
			[
				ring(radius * 0.52, -length),
				ring(radius * 0.44, -length * 0.55),
				ring(radius * 0.62, -length * 0.2),
				ring(radius * 0.94, 0),
				// The lip folds at the stock bell's last station and reaches the
				// stock disc's z, so the box is the stock bell's: a finish may not
				// move a hull's envelope (`tests/ship-finish.test.ts`).
				ring(radius * 0.88, length * 0.13, true),
				ring(radius * 0.82, length * 0.12, true),
				ring(radius * 0.7, -length * 0.08),
				ring(radius * 0.42, -length * 0.4),
				ring(radius * 0.2, -length * 0.58),
				ring(radius * 0.1, -length * 0.62),
			],
			{ subdivisions: 3 },
		),
		p.engine,
		position,
	);
	const throatZ = -length * 0.55;
	const lipZ = length * 0.1;
	const bowl = hullLoft(
		[
			ring(radius * 0.22, throatZ),
			ring(radius * 0.34, -length * 0.4),
			ring(radius * 0.55, -length * 0.15),
			ring(radius * 0.76, length * 0.05),
			ring(radius * 0.8, lipZ),
		],
		{ subdivisions: 2 },
	);
	// Throat to lip along `v`, `u` down the middle of the ramp. Declared in
	// plate units so `add()` leaves them alone: this map is a gradient, not a
	// plate, and dividing it by a tile size would sample one row of it.
	const positions = bowl.getAttribute("position") as THREE.BufferAttribute;
	const uv = bowl.getAttribute("uv") as THREE.BufferAttribute;
	for (let i = 0; i < uv.count; i++) {
		const t = (positions.getZ(i) - throatZ) / (lipZ - throatZ);
		uv.setXY(i, 0.5, Math.max(0, Math.min(1, t)));
	}
	uv.needsUpdate = true;
	setUvUnits(bowl, "plate");
	add(root, name + EXHAUST_SUFFIX, bowl, p.exhaust, position);
}

/**
 * A tapered tube between two points.
 *
 * A loft's stations are planes of constant local Z, so sweeping a pylon by
 * moving `x`/`y` while `z` barely advances stacks near-coplanar rings rather
 * than building a tube. Build it along its own axis and orient it instead.
 */
function strut(
	from: readonly [number, number, number],
	to: readonly [number, number, number],
	rootRadius: number,
	tipRadius: number,
) {
	const start = new THREE.Vector3(...from);
	const end = new THREE.Vector3(...to);
	const length = start.distanceTo(end);
	const middle = (rootRadius + tipRadius) / 2;
	const geometry = hullLoft(
		[
			{ z: 0, w: rootRadius, h: rootRadius, e: 2.2 },
			{ z: length * 0.5, w: middle, h: middle, e: 2.2 },
			{ z: length, w: tipRadius, h: tipRadius, e: 2.2 },
		],
		{ segments: 10, subdivisions: 2 },
	);
	const orientation = new THREE.Quaternion().setFromUnitVectors(
		new THREE.Vector3(0, 0, 1),
		end.clone().sub(start).normalize(),
	);
	// Marked rather than named. A strut is thin by construction — a pylon, a
	// stay, a boom — and the forward-view test needs to know which parts are
	// thin enough to see past without matching on a list of words that goes
	// stale the moment someone names one something new.
	geometry.userData.thin = true;
	return transform(
		geometry,
		new THREE.Matrix4().compose(start, orientation, new THREE.Vector3(1, 1, 1)),
	);
}

/** A blade for one side. The literal is written once, not once per arm. */
function mirroredBlade(
	stations: ReadonlyArray<Ring>,
	sign: 1 | -1,
	options: { segments?: number; subdivisions?: number } = {},
) {
	const geometry = blade(stations, options);
	return sign > 0 ? geometry : mirrorX(geometry);
}

/**
 * A drive pod.
 *
 * Stations that only peak in the middle give an ovoid, and a row of ovoids
 * reads as balloons rather than machinery. Hard shoulders at both ends hold the
 * barrel straight, so the pod keeps a constant section between a chamfered
 * intake and a stepped tail.
 */
function pod(
	z0: number,
	z1: number,
	radius: number,
	options: { x?: number; y?: number; e?: number } = {},
): Ring[] {
	const e = options.e ?? 3.4;
	const chamfer = Math.min((z1 - z0) * 0.14, radius * 0.9);
	const common = { x: options.x ?? 0, y: options.y ?? 0, e };
	return [
		{ z: z0, w: radius * 0.58, h: radius * 0.58, ...common, hard: true },
		{ z: z0 + chamfer, w: radius, h: radius, ...common, hard: true },
		{ z: z1 - chamfer * 0.7, w: radius, h: radius, ...common, hard: true },
		{ z: z1, w: radius * 0.88, h: radius * 0.88, ...common },
	];
}

/** A cargo drum: a straight barrel with chamfered ends, not a lozenge. */
function drumProfile(halfLength: number, radius: number) {
	const chamfer = radius * 0.28;
	return [
		[radius * 0.34, -halfLength],
		[radius, -halfLength + chamfer],
		[radius, halfLength - chamfer],
		[radius * 0.34, halfLength],
	] as ReadonlyArray<readonly [number, number]>;
}

/**
 * A structural hoop: the cheapest read for "machine" on an otherwise bare loft.
 *
 * **Its UVs are rewritten into kilometres**, because it is the one plated
 * geometry in this file that `hullLoft` did not build. `TorusGeometry` unwraps
 * 0–1 round the ring and 0–1 round the tube, so a hoop handed to `add()` as it
 * comes wraps one whole 128-texel tile round itself whatever its size: 22 plates
 * round a 27.6 m ring and the same 22 round a 3.1 m tube, against a plate that
 * is 1 m everywhere else on the hull. A plate is the ruler a pilot judges a
 * hull's size by, and a ruler that changes length per part is not one.
 *
 * Rewriting them here rather than exempting the hoop keeps `add()`'s rule
 * single — every geometry it plates carries kilometre UVs — instead of adding a
 * second scaling path for three's primitives.
 */
function hoop(radius: number, tube: number) {
	if (currentHullFinish().collar === "flange") return collar(radius, tube);
	const geometry = new THREE.TorusGeometry(radius, tube, 8, 22);
	scaleUVs(geometry, 2 * Math.PI * radius, 2 * Math.PI * tube);
	setUvUnits(geometry, "km");
	// A ring, whatever it is built from: the forward-view test skips rings
	// because their box is full and their middle is empty.
	geometry.userData.ring = true;
	return geometry;
}

/**
 * The industrial hoop: a faceted, flanged collar (#203).
 *
 * A torus is a moulded doughnut, and on a nacelle it reads as a rubber band
 * round a tube — #199's review, and the sheet agrees. A machined collar is a
 * band with a raised flange and hard edges: twelve facets, every station
 * `hard`, so `loft.ts`'s crease term lights each edge and the plating runs
 * over the band in kilometres like every other part.
 *
 * **Inside the torus's box, exactly.** The first collar reached 1.15 tubes
 * from the surface and 1.4 along the axis where the torus reaches one and
 * one, and the day the default finish flipped to it, `tests/hull.test.ts`
 * went red on eleven hulls: a hull's envelope is its built box, the envelope
 * is the berth catalogue's fit predicate, and the explorer's selected
 * variant changed. A finish is a look and must not move the sim, so the
 * flange stands one tube proud and the band one tube long — the same box
 * the torus had — and `tests/ship-finish.test.ts` holds every hull's box
 * equal under every finish.
 *
 * **Hollow, like the torus it replaces.** The first build let the loft cap it
 * into a drum on the argument that the inside is buried in the nacelle it
 * grips — which is true of a nacelle hoop and false of the two other things
 * `hoop` is asked for: carrier B's bay lip stands round the bay's mouth and
 * explorer A's habitat ring round open space, and a drum there is a wall
 * across the opening. Sage's forward ray at the carrier's mouth found the lip
 * under this finish and the mouth under stock. So the profile is a closed
 * section swept round the axis — out across the front face, over the flange,
 * back across the rear face and **home along the bore** — with `open` on the
 * loft so no fan is drawn across either end. Twelve more quads than the drum,
 * and `tests/ship-finish.test.ts` casts a ray along every ring's axis to
 * prove the middle is empty. Marked `ring` for the forward-view test's reason,
 * which is now true of it.
 */
function collar(radius: number, tube: number) {
	const ring = (r: number, z: number): Ring => ({
		z,
		w: r,
		h: r,
		e: 2,
		hard: true,
	});
	const bore = radius - tube * 0.5;
	const geometry = hullLoft(
		[
			ring(bore, -tube),
			ring(radius + tube * 0.45, -tube),
			ring(radius + tube * 0.45, -tube * 0.4),
			ring(radius + tube, -tube * 0.4),
			ring(radius + tube, tube * 0.4),
			ring(radius + tube * 0.45, tube * 0.4),
			ring(radius + tube * 0.45, tube),
			ring(bore, tube),
			// The bore, swept back to the first ring. A sweep run towards -Z
			// winds its quads the other way, which is what an inner wall needs:
			// its front faces the axis.
			ring(bore, -tube),
		],
		// **Twenty-two facets, turned a quarter, so the polygon is the torus's.**
		// A loft's ring points start at +Y and `TorusGeometry`'s at +X, and a
		// twelve-facet collar reached 1% further along one axis and 1% less
		// along the other than the twenty-two-sided hoop it replaces — 0.2 m on
		// the interceptor, which is over the 0.1 m the envelope test allows.
		// The same count turned onto the same phase has the same vertices on
		// the same rays, so the box is the torus's to the millimetre.
		{ segments: 22, subdivisions: 1, open: true },
	);
	geometry.rotateZ(-Math.PI / 2);
	geometry.userData.ring = true;
	return geometry;
}

function greebleStrip(
	root: THREE.Group,
	name: string,
	rings: ReadonlyArray<Ring>,
	p: Palette,
	position: [number, number, number] = [0, 0, 0],
) {
	add(root, name, hullLoft(rings, { segments: 10 }), p.panel, position);
}

/**
 * A hard chine along the beam.
 *
 * Curvature alone reads as inflated — a hull with no crease anywhere looks like
 * a bath toy at any size. The chine is the crease: a low superellipse exponent
 * pinches the section towards a diamond, giving one sharp edge line against
 * which the surrounding curvature is legible.
 */
function chine(
	root: THREE.Group,
	name: string,
	rings: ReadonlyArray<Ring>,
	p: Palette,
	sign: 1 | -1,
) {
	const geometry = hullLoft(
		rings.map((ring) => ({ ...ring, x: (ring.x ?? 0) * sign })),
		{ segments: 8 },
	);
	add(root, name, geometry, p.trim);
}

/** A radiator plate: thin enough to read as sheet rather than volume. */
function fin(
	root: THREE.Group,
	name: string,
	stations: ReadonlyArray<Ring>,
	p: Palette,
	sign: 1 | -1,
	position: [number, number, number] = [0, 0, 0],
) {
	const plate = blade(stations, { segments: 8, subdivisions: 2 });
	add(root, name, sign > 0 ? plate : mirrorX(plate), p.trim, position);
}

/** A sensor blister — small parts are what make a large hull read as large. */
function blister(
	root: THREE.Group,
	name: string,
	radius: number,
	position: [number, number, number],
	p: Palette,
) {
	add(
		root,
		name,
		revolve(
			[
				[radius * 0.85, -radius * 0.9],
				[radius, -radius * 0.3],
				[radius * 0.82, radius * 0.35],
				[radius * 0.4, radius * 0.8],
			],
			10,
		),
		p.trim,
		position,
	);
}

/**
 * A canopy nested into a painted fairing.
 *
 * Both are lofts and they overlap along the length on purpose: a canopy that
 * merely rests on the hull reads as a decal, and the overlap is what makes the
 * glass look set into structure.
 */
function canopy(
	root: THREE.Group,
	id: HullId,
	fairing: ReadonlyArray<Ring>,
	glass: ReadonlyArray<Ring>,
	p: Palette,
) {
	add(root, id + "-cockpit-fairing", hullLoft(fairing), p.panel);
	add(root, id + "-cockpit", hullLoft(glass), p.canopy);
}

/**
 * A bridge tower and its glass, for hulls too big for a cockpit blister.
 *
 * The sibling of `canopy()`. Fifteen builders wrote this pair out by hand, and
 * the test that checks a canopy is set into painted structure had to fall back
 * from `-cockpit-fairing` to `-bridge` on a guess. Emitting the pair from one
 * place makes that fallback a contract instead.
 */
function bridge(
	root: THREE.Group,
	id: HullId,
	tower: ReadonlyArray<Ring>,
	glass: ReadonlyArray<Ring>,
	p: Palette,
) {
	add(root, id + "-bridge", hullLoft(tower), p.panel);
	add(root, id + "-cockpit", hullLoft(glass), p.canopy);
}

function buildCourierA(root: THREE.Group, p: Palette) {
	add(
		root,
		"courier-fuselage",
		hullLoft([
			{ z: -0.0305, w: 0.001, h: 0.0007, b: 0.0007, e: 2.4 },
			{ z: -0.0255, w: 0.0038, h: 0.0016, b: 0.0018, e: 3 },
			{ z: -0.0175, w: 0.0078, h: 0.0027, b: 0.003, e: 4 },
			{ z: -0.007, w: 0.011, h: 0.0033, b: 0.0035, e: 5, hard: true },
			{ z: 0.006, w: 0.0114, h: 0.0033, b: 0.0035, e: 5.2, hard: true },
			{ z: 0.017, w: 0.0092, h: 0.0029, b: 0.0028, e: 4.2 },
			{ z: 0.0265, w: 0.0056, h: 0.0021, b: 0.0019, e: 3 },
		]),
		p.hull,
	);
	add(
		root,
		"courier-dorsal-hull",
		hullLoft([
			{ z: -0.0205, w: 0.0022, h: 0.0008, b: 0.0008, y: 0.0034, e: 3 },
			{ z: -0.005, w: 0.004, h: 0.0018, b: 0.0014, y: 0.0038, e: 3.4 },
			{ z: 0.011, w: 0.0034, h: 0.0014, b: 0.0012, y: 0.0036, e: 3.2 },
			{ z: 0.0235, w: 0.0016, h: 0.0006, b: 0.0006, y: 0.003, e: 2.6 },
		]),
		p.panel,
	);
	canopy(
		root,
		"courier",
		[
			{ z: -0.024, w: 0.0034, h: 0.0011, b: 0.0014, y: 0.0024, e: 2.8 },
			{ z: -0.018, w: 0.0058, h: 0.0021, b: 0.0018, y: 0.0031, e: 3.2 },
			{ z: -0.0105, w: 0.0056, h: 0.0019, b: 0.0018, y: 0.0035, e: 3.2 },
			{ z: -0.0055, w: 0.0038, h: 0.0012, b: 0.0014, y: 0.0036, e: 2.8 },
		],
		[
			{ z: -0.0225, w: 0.0023, h: 0.0009, b: 0.001, y: 0.0034, e: 2.6 },
			{ z: -0.0175, w: 0.0041, h: 0.0017, b: 0.0013, y: 0.0038, e: 2.9 },
			{ z: -0.0115, w: 0.0039, h: 0.0015, b: 0.0013, y: 0.0041, e: 2.9 },
			{ z: -0.008, w: 0.0026, h: 0.0009, b: 0.001, y: 0.004, e: 2.6 },
		],
		p,
	);
	const chineLine: Ring[] = [
		{ z: -0.0185, w: 0.0011, h: 0.0006, x: 0.0072, e: 1.5 },
		{ z: -0.007, w: 0.0014, h: 0.0009, x: 0.0104, e: 1.5 },
		{ z: 0.006, w: 0.0014, h: 0.0009, x: 0.0108, e: 1.5 },
		{ z: 0.017, w: 0.0011, h: 0.0007, x: 0.0087, e: 1.5 },
		{ z: 0.0255, w: 0.0007, h: 0.0004, x: 0.0055, e: 1.5 },
	];
	const sponson = blade([
		{ z: 0.0085, w: 0.0038, h: 0.0075, b: 0.0072, y: 0.002, e: 3 },
		{ z: 0.014, w: 0.0032, h: 0.0072, b: 0.0068, y: 0.0031, e: 3 },
		{ z: 0.0205, w: 0.0028, h: 0.0058, b: 0.0054, y: 0.0038, e: 2.8 },
	]);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		chine(root, "courier-chine-" + side, chineLine, p, sign);
		add(
			root,
			"courier-nacelle-mount-" + side,
			sign > 0 ? sponson : mirrorX(sponson),
			p.hull,
		);
		add(
			root,
			"courier-" + side + "-nacelle",
			hullLoft(pod(-0.0085, 0.0235, 0.0041, { x: sign * 0.0207 })),
			p.panel,
		);
		add(root, "courier-hoop-" + side, hoop(0.0044, 0.0005), p.trim, [
			sign * 0.0207,
			0,
			0.0075,
		]);
		add(root, "courier-collar-" + side, hoop(0.0042, 0.0004), p.accent, [
			sign * 0.0207,
			0,
			0.0185,
		]);
		engineBell(
			root,
			"courier-" + side,
			[sign * 0.0207, 0, 0.0265],
			0.0036,
			0.0038,
			p,
		);
		fin(
			root,
			"courier-radiator-" + side,
			[
				{ z: 0.0032, w: 0.0004, h: 0.0042, b: 0.0016, y: 0.0165, e: 2.2 },
				{ z: 0.0086, w: 0.0003, h: 0.0036, b: 0.0012, y: 0.019, e: 2.2 },
			],
			p,
			sign,
			[0, 0.0036, 0],
		);
		blister(
			root,
			"courier-sensor-" + side,
			0.0011,
			[sign * 0.0062, 0.0037, -0.0135],
			p,
		);
	}
	greebleStrip(
		root,
		"courier-spine-strip",
		[
			{ z: -0.0135, w: 0.0008, h: 0.0003, y: 0.0048, e: 2 },
			{ z: 0.008, w: 0.001, h: 0.0004, y: 0.005, e: 2 },
			{ z: 0.019, w: 0.0006, h: 0.0003, y: 0.0044, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "courier-dome", 0.0016, [0, 0.0052, 0.0005], p);
}

/**
 * Deliberate asymmetry.
 *
 * Rounds one to three carried offset keels and unequal load rails, and the
 * review missed them once round four mirrored everything. A working ship is not
 * obliged to balance: a keel that sits to port with its cargo to starboard
 * reads as a machine assembled around a job, and the offset also tells the
 * player which way up and which way round the hull is at a glance. The port and
 * starboard drives stay named and mounted, they are simply not the same drive.
 */
function buildCourierB(root: THREE.Group, p: Palette) {
	const keel = -0.0032;
	add(
		root,
		"courier-fuselage",
		hullLoft([
			{ z: -0.0295, w: 0.0009, h: 0.0008, b: 0.0008, x: keel, e: 2.4 },
			{ z: -0.0245, w: 0.0036, h: 0.0018, b: 0.002, x: keel, e: 3 },
			{ z: -0.016, w: 0.0068, h: 0.0028, b: 0.0031, x: keel, e: 4 },
			{
				z: -0.005,
				w: 0.008,
				h: 0.0032,
				b: 0.0035,
				x: keel,
				e: 4.6,
				hard: true,
			},
			{
				z: 0.008,
				w: 0.0078,
				h: 0.0031,
				b: 0.0034,
				x: keel,
				e: 4.6,
				hard: true,
			},
			{ z: 0.018, w: 0.0062, h: 0.0026, b: 0.0027, x: keel, e: 4 },
			{ z: 0.0265, w: 0.004, h: 0.0018, b: 0.0017, x: keel, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"courier",
		[
			{
				z: -0.0235,
				w: 0.0032,
				h: 0.0011,
				b: 0.0014,
				x: keel,
				y: 0.0022,
				e: 2.8,
			},
			{
				z: -0.0175,
				w: 0.0054,
				h: 0.002,
				b: 0.0017,
				x: keel,
				y: 0.0029,
				e: 3.2,
			},
			{
				z: -0.011,
				w: 0.0052,
				h: 0.0018,
				b: 0.0017,
				x: keel,
				y: 0.0033,
				e: 3.2,
			},
			{
				z: -0.0065,
				w: 0.0035,
				h: 0.0011,
				b: 0.0013,
				x: keel,
				y: 0.0034,
				e: 2.8,
			},
		],
		[
			{ z: -0.022, w: 0.0021, h: 0.0009, b: 0.001, x: keel, y: 0.0032, e: 2.6 },
			{
				z: -0.017,
				w: 0.0038,
				h: 0.0016,
				b: 0.0012,
				x: keel,
				y: 0.0036,
				e: 2.9,
			},
			{
				z: -0.012,
				w: 0.0036,
				h: 0.0014,
				b: 0.0012,
				x: keel,
				y: 0.0039,
				e: 2.9,
			},
			{ z: -0.009, w: 0.0024, h: 0.0009, b: 0.001, x: keel, y: 0.0038, e: 2.6 },
		],
		p,
	);
	// Starboard carries the load: one deep bank faired straight into the keel.
	add(
		root,
		"courier-nacelle-mount-starboard",
		blade([
			{ z: 0.001, w: 0.0072, h: 0.0092, b: 0.009, y: -0.0015, e: 4.2 },
			{ z: 0.008, w: 0.007, h: 0.0088, b: 0.0086, y: 0.0005, e: 4.4 },
			{ z: 0.0152, w: 0.006, h: 0.0072, b: 0.007, y: 0.0025, e: 4 },
		]),
		p.hull,
	);
	add(
		root,
		"courier-starboard-nacelle",
		hullLoft(pod(-0.0065, 0.0245, 0.0044, { x: 0.019 })),
		p.panel,
	);
	for (const band of [0.0, 0.0135])
		add(
			root,
			`courier-band-starboard-${band}`,
			hoop(0.0047, 0.0005),
			p.accent,
			[0.019, 0, band],
		);
	engineBell(root, "courier-starboard", [0.019, 0, 0.0275], 0.0039, 0.004, p);
	// Port carries a bare service rail and the trim drive.
	add(
		root,
		"courier-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.0085, w: 0.0013, h: 0.0032, b: 0.003, y: 0.004, e: 2.6 },
				{ z: 0.0125, w: 0.0011, h: 0.0029, b: 0.0027, y: 0.006, e: 2.6 },
			]),
		),
		p.trim,
	);
	add(
		root,
		"courier-port-nacelle",
		hullLoft(pod(0.001, 0.0215, 0.0028, { x: -0.0145 })),
		p.panel,
	);
	add(
		root,
		"courier-band-port",
		hoop(0.003, 0.0004),
		p.accent,
		[-0.0145, 0, 0.0155],
	);
	engineBell(root, "courier-port", [-0.0145, 0, 0.0245], 0.0026, 0.0028, p);
	chine(
		root,
		"courier-chine-keel",
		[
			{ z: -0.017, w: 0.001, h: 0.0006, x: keel - 0.0064, e: 1.5 },
			{ z: -0.004, w: 0.0013, h: 0.0008, x: keel - 0.0078, e: 1.5 },
			{ z: 0.009, w: 0.0012, h: 0.0007, x: keel - 0.0076, e: 1.5 },
			{ z: 0.019, w: 0.0009, h: 0.0005, x: keel - 0.006, e: 1.5 },
		],
		p,
		1,
	);
	greebleStrip(
		root,
		"courier-deck-plate",
		[
			{ z: -0.008, w: 0.0056, h: 0.0004, x: keel, y: 0.0032, e: 4 },
			{ z: 0.008, w: 0.0054, h: 0.0004, x: keel, y: 0.0031, e: 4 },
			{ z: 0.018, w: 0.0042, h: 0.0004, x: keel, y: 0.0027, e: 3.4 },
		],
		p,
	);
	greebleStrip(
		root,
		"courier-load-rail",
		[
			{ z: -0.004, w: 0.0034, h: 0.0005, x: 0.0132, y: 0.0086, e: 3.4 },
			{ z: 0.012, w: 0.003, h: 0.0005, x: 0.0142, y: 0.0092, e: 3.4 },
		],
		p,
	);
	greebleStrip(
		root,
		"courier-load-stripe",
		[
			{ z: -0.002, w: 0.0011, h: 0.0004, x: 0.0132, y: 0.0092, e: 2 },
			{ z: 0.011, w: 0.001, h: 0.0004, x: 0.0142, y: 0.0098, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "courier-sensor", 0.0012, [keel + 0.004, 0.0035, -0.0125], p);
}

/**
 * The vertical axis.
 *
 * Every hull the rankings kept spreads its mass sideways: pods to port and
 * starboard, or a bank on one beam. Stacking instead of spreading is the one
 * layout axis the pool has never used, and it changes the head-on silhouette
 * rather than only the plan view — which is the view a pilot actually gets of
 * another ship. All three of these hang their drives above or below the keel.
 */
function buildCourierC(root: THREE.Group, p: Palette) {
	add(
		root,
		"courier-fuselage",
		hullLoft([
			{ z: -0.031, w: 0.0009, h: 0.0008, b: 0.0008, e: 2.4 },
			{ z: -0.0255, w: 0.0034, h: 0.0018, b: 0.0018, e: 3 },
			{ z: -0.017, w: 0.0058, h: 0.0026, b: 0.0026, e: 3.8 },
			{ z: -0.006, w: 0.0068, h: 0.0029, b: 0.0028, e: 4.4, hard: true },
			{ z: 0.009, w: 0.0066, h: 0.0028, b: 0.0027, e: 4.4, hard: true },
			{ z: 0.019, w: 0.0052, h: 0.0023, b: 0.0022, e: 3.6 },
			{ z: 0.026, w: 0.0036, h: 0.0016, b: 0.0015, e: 3 },
		]),
		p.hull,
	);
	// The cargo rides underneath, where a keel can carry it without splitting.
	add(
		root,
		"courier-pannier",
		hullLoft([
			{ z: -0.015, w: 0.004, h: 0.002, b: 0.002, y: -0.0054, e: 3.4 },
			{
				z: -0.0095,
				w: 0.0088,
				h: 0.0036,
				b: 0.0036,
				y: -0.0062,
				e: 4.4,
				hard: true,
			},
			{
				z: 0.0105,
				w: 0.0088,
				h: 0.0036,
				b: 0.0036,
				y: -0.0062,
				e: 4.4,
				hard: true,
			},
			{ z: 0.0165, w: 0.0054, h: 0.0025, b: 0.0025, y: -0.0054, e: 3.4 },
		]),
		p.panel,
	);
	canopy(
		root,
		"courier",
		[
			{ z: -0.0255, w: 0.0032, h: 0.0011, b: 0.0014, y: 0.002, e: 2.8 },
			{ z: -0.0195, w: 0.0052, h: 0.002, b: 0.0017, y: 0.0027, e: 3.2 },
			{ z: -0.013, w: 0.005, h: 0.0018, b: 0.0017, y: 0.0031, e: 3.2 },
			{ z: -0.0085, w: 0.0034, h: 0.0011, b: 0.0013, y: 0.0031, e: 2.8 },
		],
		[
			{ z: -0.024, w: 0.0021, h: 0.0009, b: 0.001, y: 0.003, e: 2.6 },
			{ z: -0.019, w: 0.0037, h: 0.0016, b: 0.0012, y: 0.0034, e: 2.9 },
			{ z: -0.014, w: 0.0035, h: 0.0014, b: 0.0012, y: 0.0037, e: 2.9 },
			{ z: -0.011, w: 0.0023, h: 0.0009, b: 0.001, y: 0.0036, e: 2.6 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.0045],
		["aft", 0.0125],
	] as const)
		add(
			root,
			`courier-nacelle-mount-dorsal-${tag}`,
			strut([0, 0.0026, cz], [0, 0.0076, cz + 0.0015], 0.0021, 0.0017),
			p.trim,
		);
	add(
		root,
		"courier-dorsal-nacelle",
		hullLoft(pod(-0.005, 0.0245, 0.0038, { y: 0.008 })),
		p.panel,
	);
	for (const band of [0.0, 0.0145])
		add(root, `courier-band-dorsal-${band}`, hoop(0.0041, 0.0005), p.accent, [
			0,
			0.008,
			band,
		]);
	engineBell(root, "courier-dorsal", [0, 0.008, 0.0275], 0.0033, 0.0035, p);
	for (const [tag, cz] of [
		["fore", 0.0095],
		["aft", 0.0165],
	] as const)
		add(
			root,
			`courier-nacelle-mount-ventral-${tag}`,
			strut([0, -0.0058, cz], [0, -0.0076, cz + 0.0018], 0.0019, 0.0016),
			p.trim,
		);
	add(
		root,
		"courier-ventral-nacelle",
		hullLoft(pod(0.008, 0.0235, 0.0031, { y: -0.0078 })),
		p.panel,
	);
	engineBell(root, "courier-ventral", [0, -0.0078, 0.0265], 0.0027, 0.0029, p);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		chine(
			root,
			"courier-chine-" + side,
			[
				{ z: -0.014, w: 0.001, h: 0.0006, x: 0.0054, e: 1.5 },
				{ z: -0.002, w: 0.0012, h: 0.0008, x: 0.0067, e: 1.5 },
				{ z: 0.011, w: 0.0011, h: 0.0007, x: 0.0063, e: 1.5 },
				{ z: 0.02, w: 0.0008, h: 0.0005, x: 0.0049, e: 1.5 },
			],
			p,
			sign,
		);
		fin(
			root,
			"courier-stabiliser-" + side,
			[
				{ z: 0.0072, w: 0.0004, h: 0.0038, b: 0.0014, y: 0.0088, e: 2.2 },
				{ z: 0.0114, w: 0.0003, h: 0.0031, b: 0.0011, y: 0.0112, e: 2.2 },
			],
			p,
			sign,
			[0, -0.0062, 0],
		);
	}
	greebleStrip(
		root,
		"courier-pannier-rail",
		[
			{ z: -0.006, w: 0.0072, h: 0.0005, y: -0.0098, e: 4 },
			{ z: 0.008, w: 0.007, h: 0.0005, y: -0.0098, e: 4 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "courier-sensor", 0.0012, [0.0038, 0.003, -0.0055], p);
}

function buildInterceptorA(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		hullLoft([
			{ z: -0.0325, w: 0.0009, h: 0.0009, e: 2.4 },
			{ z: -0.0295, w: 0.0032, h: 0.0032, e: 2.8 },
			{ z: -0.027, w: 0.0052, h: 0.005, e: 3.4, hard: true },
			{ z: -0.0195, w: 0.0052, h: 0.005, e: 3.4, hard: true },
			{ z: -0.0175, w: 0.0026, h: 0.0026, e: 3, hard: true },
			{ z: 0.0125, w: 0.0024, h: 0.0024, e: 3, hard: true },
			{ z: 0.0155, w: 0.0046, h: 0.0046, e: 3.4, hard: true },
			{ z: 0.0265, w: 0.0046, h: 0.0046, e: 3.4, hard: true },
			{ z: 0.0285, w: 0.0038, h: 0.0038, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"interceptor",
		[
			{ z: -0.0305, w: 0.0028, h: 0.0011, b: 0.0013, y: 0.0026, e: 2.8 },
			{ z: -0.0265, w: 0.0046, h: 0.0022, b: 0.0018, y: 0.0035, e: 3.1 },
			{ z: -0.0215, w: 0.0044, h: 0.002, b: 0.0018, y: 0.0039, e: 3.1 },
			{ z: -0.0175, w: 0.003, h: 0.0011, b: 0.0013, y: 0.0035, e: 2.8 },
		],
		[
			{ z: -0.0295, w: 0.0019, h: 0.0009, b: 0.001, y: 0.0035, e: 2.6 },
			{ z: -0.026, w: 0.0033, h: 0.0018, b: 0.0013, y: 0.0041, e: 2.9 },
			{ z: -0.022, w: 0.0031, h: 0.0016, b: 0.0013, y: 0.0044, e: 2.9 },
			{ z: -0.0195, w: 0.0021, h: 0.0009, b: 0.001, y: 0.0042, e: 2.6 },
		],
		p,
	);
	for (const collar of [-0.0115, 0.0015, 0.0135]) {
		add(
			root,
			`interceptor-frame-${collar}`,
			hoop(collar < 0 ? 0.0035 : collar < 0.01 ? 0.0029 : 0.0037, 0.0007),
			p.trim,
			[0, 0, collar],
		);
	}
	for (const [name, angle] of [
		["starboard", 0],
		["port", Math.PI],
		["dorsal", Math.PI / 2],
		["ventral", -Math.PI / 2],
	] as const) {
		const cx = Math.cos(angle) * 0.0088;
		const cy = Math.sin(angle) * 0.0088;
		add(
			root,
			"interceptor-nacelle-mount-" + name,
			strut([cx * 0.22, cy * 0.22, 0.0175], [cx, cy, 0.0185], 0.0012, 0.001),
			p.trim,
		);
		add(
			root,
			"interceptor-" + name + "-nacelle",
			hullLoft(pod(0.008, 0.026, 0.0034, { x: cx, y: cy })),
			p.panel,
		);
		add(root, "interceptor-collar-" + name, hoop(0.0034, 0.0004), p.accent, [
			cx,
			cy,
			0.0215,
		]);
		engineBell(root, "interceptor-" + name, [cx, cy, 0.0295], 0.0028, 0.003, p);
	}
	add(root, "interceptor-hub-hoop", hoop(0.009, 0.0008), p.trim, [0, 0, 0.019]);
	greebleStrip(
		root,
		"interceptor-spine-rail",
		[
			{ z: -0.013, w: 0.0007, h: 0.0005, y: 0.003, e: 2 },
			{ z: 0.004, w: 0.0008, h: 0.0006, y: 0.0029, e: 2 },
			{ z: 0.015, w: 0.0006, h: 0.0005, y: 0.0038, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "interceptor-sensor", 0.0012, [0.0032, 0.0042, -0.0155], p);
}

function buildInterceptorB(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		hullLoft([
			{ z: -0.0305, w: 0.001, h: 0.001, e: 2.4 },
			{ z: -0.0275, w: 0.0034, h: 0.0033, e: 2.8 },
			{ z: -0.025, w: 0.0054, h: 0.005, e: 3.4, hard: true },
			{ z: -0.019, w: 0.0054, h: 0.005, e: 3.4, hard: true },
			{ z: -0.017, w: 0.0026, h: 0.0026, e: 3, hard: true },
			{ z: 0.016, w: 0.0026, h: 0.0026, e: 3, hard: true },
			{ z: 0.0195, w: 0.0036, h: 0.0036, e: 3.2 },
		]),
		p.hull,
	);
	canopy(
		root,
		"interceptor",
		[
			{ z: -0.0285, w: 0.003, h: 0.0013, b: 0.0015, y: 0.0028, e: 2.8 },
			{ z: -0.0245, w: 0.0048, h: 0.0024, b: 0.0018, y: 0.0038, e: 3.1 },
			{ z: -0.0195, w: 0.0046, h: 0.0022, b: 0.0018, y: 0.0042, e: 3.1 },
			{ z: -0.0155, w: 0.0032, h: 0.0013, b: 0.0015, y: 0.0038, e: 2.8 },
		],
		[
			{ z: -0.0275, w: 0.0021, h: 0.001, b: 0.0011, y: 0.0038, e: 2.6 },
			{ z: -0.024, w: 0.0035, h: 0.0019, b: 0.0013, y: 0.0044, e: 2.9 },
			{ z: -0.02, w: 0.0033, h: 0.0017, b: 0.0013, y: 0.0047, e: 2.9 },
			{ z: -0.0175, w: 0.0022, h: 0.001, b: 0.0011, y: 0.0045, e: 2.6 },
		],
		p,
	);
	for (const [name, sign] of [
		["upper", 1],
		["lower", -1],
	] as const) {
		const boom = sign * 0.0088;
		for (const [tag, cz] of [
			["fore", -0.0115],
			["aft", 0.0125],
		] as const)
			add(
				root,
				`interceptor-nacelle-mount-${name}-${tag}`,
				strut(
					[0, sign * 0.002, cz],
					[0, boom, cz + sign * 0.0004],
					0.0016,
					0.0014,
				),
				p.trim,
			);
		add(
			root,
			`interceptor-${name}-nacelle`,
			hullLoft(pod(-0.017, 0.0265, 0.0038, { y: boom })),
			p.panel,
		);
		add(root, `interceptor-band-${name}`, hoop(0.0041, 0.0005), p.accent, [
			0,
			boom,
			0.0205,
		]);
		engineBell(
			root,
			"interceptor-" + name,
			[0, boom, 0.0295],
			0.0033,
			0.0034,
			p,
		);
	}
	// The booms are tied at the bow, which is what makes the pair read as a yoke
	// rather than as two ships flying in formation.
	add(
		root,
		"interceptor-yoke-brace",
		strut([0, 0.0088, -0.0155], [0, -0.0088, -0.0155], 0.0013, 0.0013),
		p.trim,
	);
	greebleStrip(
		root,
		"interceptor-spar-rail",
		[
			{ z: -0.008, w: 0.0007, h: 0.0005, y: 0.0031, e: 2 },
			{ z: 0.012, w: 0.0008, h: 0.0006, y: 0.003, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "interceptor-sensor", 0.0012, [0.003, 0.0044, -0.0135], p);
}

function buildInterceptorC(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		hullLoft([
			{ z: -0.0315, w: 0.001, h: 0.001, e: 2.4 },
			{ z: -0.0285, w: 0.0034, h: 0.0033, e: 2.8 },
			{ z: -0.026, w: 0.0052, h: 0.0048, e: 3.4, hard: true },
			{ z: -0.0195, w: 0.0052, h: 0.0048, e: 3.4, hard: true },
			{ z: -0.0175, w: 0.0025, h: 0.0025, e: 3, hard: true },
			{ z: 0.0245, w: 0.0025, h: 0.0025, e: 3, hard: true },
			{ z: 0.0275, w: 0.0036, h: 0.0036, e: 3.2, hard: true },
			{ z: 0.0305, w: 0.0028, h: 0.0028, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"interceptor",
		[
			{ z: -0.0295, w: 0.003, h: 0.0013, b: 0.0015, y: 0.0028, e: 2.8 },
			{ z: -0.0255, w: 0.0048, h: 0.0024, b: 0.0018, y: 0.0037, e: 3.1 },
			{ z: -0.0205, w: 0.0046, h: 0.0022, b: 0.0018, y: 0.0041, e: 3.1 },
			{ z: -0.0165, w: 0.0032, h: 0.0013, b: 0.0015, y: 0.0037, e: 2.8 },
		],
		[
			{ z: -0.0285, w: 0.0021, h: 0.001, b: 0.0011, y: 0.0037, e: 2.6 },
			{ z: -0.025, w: 0.0035, h: 0.0019, b: 0.0013, y: 0.0043, e: 2.9 },
			{ z: -0.021, w: 0.0033, h: 0.0017, b: 0.0013, y: 0.0046, e: 2.9 },
			{ z: -0.0185, w: 0.0022, h: 0.001, b: 0.0011, y: 0.0044, e: 2.6 },
		],
		p,
	);
	add(
		root,
		"interceptor-drive-ring",
		hoop(0.0126, 0.0024),
		p.hull,
		[0, 0, 0.0135],
	);
	add(
		root,
		"interceptor-ring-liner",
		hoop(0.0126, 0.0013),
		p.accent,
		[0, 0, 0.0135],
	);
	for (const [name, angle] of [
		["starboard", Math.PI / 4],
		["port", (Math.PI * 3) / 4],
		["starboard-low", -Math.PI / 4],
		["port-low", (-Math.PI * 3) / 4],
	] as const) {
		const cx = Math.cos(angle);
		const cy = Math.sin(angle);
		add(
			root,
			"interceptor-nacelle-mount-" + name,
			strut(
				[cx * 0.003, cy * 0.003, 0.0135],
				[cx * 0.0125, cy * 0.0125, 0.018],
				0.0012,
				0.001,
			),
			p.trim,
		);
		add(
			root,
			"interceptor-" + name + "-nacelle",
			hullLoft(pod(0.0165, 0.0275, 0.0028, { x: cx * 0.0126, y: cy * 0.0126 })),
			p.panel,
		);
		engineBell(
			root,
			"interceptor-" + name,
			[cx * 0.0126, cy * 0.0126, 0.0305],
			0.0024,
			0.0026,
			p,
		);
	}
	for (const collar of [-0.0155, -0.005, 0.021]) {
		add(
			root,
			`interceptor-spar-frame-${collar}`,
			hoop(collar < -0.01 ? 0.0034 : collar < 0 ? 0.0028 : 0.0038, 0.0006),
			p.trim,
			[0, 0, collar],
		);
	}
	greebleStrip(
		root,
		"interceptor-spar-rail",
		[
			{ z: -0.009, w: 0.0007, h: 0.0005, y: 0.0031, e: 2 },
			{ z: 0.006, w: 0.0008, h: 0.0006, y: 0.003, e: 2 },
			{ z: 0.019, w: 0.0006, h: 0.0005, y: 0.0037, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "interceptor-sensor", 0.0012, [0.003, 0.0038, -0.0145], p);
}

function buildFreighterA(root: THREE.Group, p: Palette) {
	const deck = 0.006;
	add(
		root,
		"freighter-fuselage",
		hullLoft([
			{ z: -0.0345, w: 0.0014, h: 0.0014, b: 0.0014, y: deck, e: 2.4 },
			{ z: -0.0305, w: 0.0042, h: 0.004, b: 0.0038, y: deck, e: 3 },
			{
				z: -0.028,
				w: 0.0052,
				h: 0.0048,
				b: 0.0046,
				y: deck,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.021,
				w: 0.0052,
				h: 0.0048,
				b: 0.0046,
				y: deck,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.019,
				w: 0.004,
				h: 0.0038,
				b: 0.0038,
				y: deck,
				e: 3.2,
				hard: true,
			},
			{ z: 0.018, w: 0.004, h: 0.0038, b: 0.0038, y: deck, e: 3.2, hard: true },
			{
				z: 0.0215,
				w: 0.0086,
				h: 0.0068,
				b: 0.0064,
				y: deck,
				e: 4.2,
				hard: true,
			},
			{
				z: 0.0325,
				w: 0.0086,
				h: 0.0068,
				b: 0.0064,
				y: deck,
				e: 4.2,
				hard: true,
			},
			{ z: 0.0345, w: 0.0074, h: 0.0058, b: 0.0056, y: deck, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"freighter",
		[
			{ z: -0.0325, w: 0.004, h: 0.0018, b: 0.002, y: deck + 0.0038, e: 3 },
			{ z: -0.0275, w: 0.0065, h: 0.0033, b: 0.0026, y: deck + 0.0049, e: 3.4 },
			{ z: -0.0215, w: 0.0061, h: 0.0029, b: 0.0026, y: deck + 0.0053, e: 3.4 },
			{ z: -0.0175, w: 0.0043, h: 0.0018, b: 0.002, y: deck + 0.0049, e: 3 },
		],
		[
			{ z: -0.0315, w: 0.0027, h: 0.0013, b: 0.0014, y: deck + 0.0051, e: 2.7 },
			{ z: -0.0275, w: 0.0046, h: 0.0026, b: 0.0018, y: deck + 0.006, e: 3 },
			{ z: -0.0225, w: 0.0043, h: 0.0022, b: 0.0017, y: deck + 0.0064, e: 3 },
			{ z: -0.0195, w: 0.003, h: 0.0013, b: 0.0014, y: deck + 0.006, e: 2.7 },
		],
		p,
	);
	// Cargo hangs off the gantry instead of being wrapped in hull.
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			`freighter-drum-${side}`,
			revolve(drumProfile(0.0138, 0.0068)),
			p.panel,
			[sign * 0.0096, -0.0092, -0.0035],
		);
		for (const band of [-0.007, 0.007])
			add(
				root,
				`freighter-drum-band-${side}-${band}`,
				hoop(0.0069, 0.0006),
				p.accent,
				[sign * 0.0096, -0.0092, -0.0035 + band],
			);
		for (const [tag, cz] of [
			["fore", -0.0135],
			["aft", 0.0065],
		] as const)
			add(
				root,
				`freighter-stay-${side}-${tag}`,
				strut(
					[sign * 0.0016, deck - 0.0034, cz],
					[sign * 0.0096, -0.0064, cz],
					0.0014,
					0.0012,
				),
				p.trim,
			);
		add(
			root,
			"freighter-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0045, w: 0.0026, h: 0.0064, b: 0.006, y: 0.0225, e: 3.2 },
					{ z: 0.0132, w: 0.0022, h: 0.0056, b: 0.0052, y: 0.0262, e: 3 },
				],
				sign,
			),
			p.trim,
			[0, deck, 0],
		);
		add(
			root,
			"freighter-" + side + "-nacelle",
			hullLoft(pod(0.014, 0.0315, 0.0044, { x: sign * 0.0154, y: deck })),
			p.panel,
		);
		add(root, "freighter-collar-" + side, hoop(0.0047, 0.0005), p.accent, [
			sign * 0.0154,
			deck,
			0.0275,
		]);
		engineBell(
			root,
			"freighter-" + side,
			[sign * 0.0154, deck, 0.0355],
			0.0038,
			0.004,
			p,
		);
	}
	engineBell(root, "freighter-core", [0, deck, 0.036], 0.005, 0.0052, p);
	greebleStrip(
		root,
		"freighter-gantry-rail",
		[
			{ z: -0.016, w: 0.0009, h: 0.0005, y: deck + 0.0044, e: 2 },
			{ z: 0.004, w: 0.001, h: 0.0006, y: deck + 0.0042, e: 2 },
			{ z: 0.017, w: 0.0008, h: 0.0005, y: deck + 0.005, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "freighter-sensor", 0.0014, [0.003, deck + 0.0042, -0.0075], p);
}
function buildFreighterB(root: THREE.Group, p: Palette) {
	const keel = -0.0075;
	add(
		root,
		"freighter-fuselage",
		hullLoft([
			{ z: -0.0335, w: 0.0014, h: 0.0014, b: 0.0014, x: keel, e: 2.4 },
			{ z: -0.0295, w: 0.004, h: 0.0038, b: 0.0036, x: keel, e: 3 },
			{
				z: -0.027,
				w: 0.005,
				h: 0.0046,
				b: 0.0044,
				x: keel,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.0205,
				w: 0.005,
				h: 0.0046,
				b: 0.0044,
				x: keel,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.0185,
				w: 0.0038,
				h: 0.0035,
				b: 0.0035,
				x: keel,
				e: 3.2,
				hard: true,
			},
			{
				z: 0.016,
				w: 0.0038,
				h: 0.0035,
				b: 0.0035,
				x: keel,
				e: 3.2,
				hard: true,
			},
			{
				z: 0.0195,
				w: 0.0072,
				h: 0.006,
				b: 0.0058,
				x: keel,
				e: 4.2,
				hard: true,
			},
			{
				z: 0.0315,
				w: 0.0072,
				h: 0.006,
				b: 0.0058,
				x: keel,
				e: 4.2,
				hard: true,
			},
			{ z: 0.0335, w: 0.0062, h: 0.0052, b: 0.005, x: keel, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"freighter",
		[
			{ z: -0.0315, w: 0.004, h: 0.0018, b: 0.002, x: keel, y: 0.0038, e: 3 },
			{
				z: -0.0265,
				w: 0.0065,
				h: 0.0033,
				b: 0.0026,
				x: keel,
				y: 0.0049,
				e: 3.4,
			},
			{
				z: -0.0205,
				w: 0.0061,
				h: 0.0029,
				b: 0.0026,
				x: keel,
				y: 0.0053,
				e: 3.4,
			},
			{ z: -0.0165, w: 0.0043, h: 0.0018, b: 0.002, x: keel, y: 0.0049, e: 3 },
		],
		[
			{
				z: -0.0305,
				w: 0.0027,
				h: 0.0013,
				b: 0.0014,
				x: keel,
				y: 0.0051,
				e: 2.7,
			},
			{ z: -0.0265, w: 0.0046, h: 0.0026, b: 0.0018, x: keel, y: 0.006, e: 3 },
			{ z: -0.0215, w: 0.0043, h: 0.0022, b: 0.0017, x: keel, y: 0.0064, e: 3 },
			{ z: -0.0185, w: 0.003, h: 0.0013, b: 0.0014, x: keel, y: 0.006, e: 2.7 },
		],
		p,
	);
	// The cargo outrigger is the ship; the keel beside it is the crew's corner.
	add(
		root,
		"freighter-cargo-bank",
		blade([
			{ z: -0.0018, w: 0.0086, h: 0.0168, b: 0.0166, y: -0.0025, e: 4.4 },
			{ z: 0.006, w: 0.0084, h: 0.0166, b: 0.0164, y: -0.0015, e: 4.6 },
			{ z: 0.0132, w: 0.0072, h: 0.0142, b: 0.014, y: 0.0015, e: 4.2 },
		]),
		p.hull,
	);
	for (const [name, cz] of [
		["fore", -0.0135],
		["aft", 0.0085],
	] as const) {
		add(
			root,
			`freighter-drum-${name}`,
			revolve(drumProfile(0.0112, 0.0062)),
			p.panel,
			[0.0192, 0.0042, cz],
		);
		for (const band of [-0.005, 0.005])
			add(
				root,
				`freighter-drum-band-${name}-${band}`,
				hoop(0.0063, 0.0006),
				p.accent,
				[0.0192, 0.0042, cz + band],
			);
	}
	add(
		root,
		"freighter-nacelle-mount-starboard",
		blade([
			{ z: 0.0088, w: 0.0032, h: 0.0072, b: 0.007, y: 0.0175, e: 3.4 },
			{ z: 0.0148, w: 0.0028, h: 0.0064, b: 0.0062, y: 0.0215, e: 3.2 },
		]),
		p.trim,
	);
	add(
		root,
		"freighter-starboard-nacelle",
		hullLoft(pod(0.011, 0.0315, 0.005, { x: 0.0178 })),
		p.panel,
	);
	add(
		root,
		"freighter-collar-starboard",
		hoop(0.0053, 0.0005),
		p.accent,
		[0.0178, 0, 0.027],
	);
	engineBell(
		root,
		"freighter-starboard",
		[0.0178, 0, 0.0355],
		0.0042,
		0.0044,
		p,
	);
	// Port keeps an exposed service rail instead of a second cargo bank.
	add(
		root,
		"freighter-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.0112, w: 0.0016, h: 0.0044, b: 0.0042, y: 0.019, e: 2.8 },
				{ z: 0.0158, w: 0.0014, h: 0.0038, b: 0.0036, y: 0.0225, e: 2.8 },
			]),
		),
		p.trim,
	);
	add(
		root,
		"freighter-port-nacelle",
		hullLoft(pod(0.015, 0.0305, 0.0032, { x: -0.017 })),
		p.panel,
	);
	engineBell(root, "freighter-port", [-0.017, 0, 0.0345], 0.0028, 0.003, p);
	greebleStrip(
		root,
		"freighter-service-rail",
		[
			{ z: -0.019, w: 0.0009, h: 0.0009, x: -0.0138, e: 2.4 },
			{ z: 0.0, w: 0.001, h: 0.001, x: -0.0146, e: 2.4 },
			{ z: 0.016, w: 0.0009, h: 0.0009, x: -0.0142, e: 2.4 },
		],
		{ ...p, panel: p.trim },
	);
	for (const cz of [-0.014, 0.004])
		add(
			root,
			`freighter-rail-stay-${cz}`,
			mirrorX(
				blade([
					{ z: 0.0042, w: 0.0011, h: 0.0016, b: 0.0016, e: 2.4 },
					{ z: 0.0138, w: 0.0009, h: 0.0014, b: 0.0014, e: 2.4 },
				]),
			),
			p.trim,
			[0, 0, cz],
		);
	engineBell(root, "freighter-core", [keel, 0, 0.0355], 0.0048, 0.005, p);
	blister(
		root,
		"freighter-sensor",
		0.0014,
		[keel + 0.0028, 0.0044, -0.0105],
		p,
	);
}
function buildFreighterC(root: THREE.Group, p: Palette) {
	add(
		root,
		"freighter-fuselage",
		hullLoft([
			{ z: -0.0335, w: 0.0014, h: 0.0014, b: 0.0014, e: 2.4 },
			{ z: -0.03, w: 0.004, h: 0.0038, b: 0.0037, e: 3 },
			{ z: -0.0275, w: 0.0048, h: 0.0044, b: 0.0043, e: 3.4, hard: true },
			{ z: -0.021, w: 0.0048, h: 0.0044, b: 0.0043, e: 3.4, hard: true },
			{ z: -0.019, w: 0.0034, h: 0.0032, b: 0.0032, e: 3.2, hard: true },
			{ z: 0.0165, w: 0.0034, h: 0.0032, b: 0.0032, e: 3.2, hard: true },
			{ z: 0.0195, w: 0.007, h: 0.0058, b: 0.0056, e: 4.2, hard: true },
			{ z: 0.0315, w: 0.007, h: 0.0058, b: 0.0056, e: 4.2, hard: true },
			{ z: 0.0335, w: 0.006, h: 0.005, b: 0.0048, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"freighter",
		[
			{ z: -0.0305, w: 0.0039, h: 0.002, b: 0.0021, y: 0.0078, e: 3 },
			{ z: -0.0255, w: 0.0064, h: 0.0035, b: 0.0028, y: 0.0092, e: 3.4 },
			{ z: -0.0195, w: 0.006, h: 0.0031, b: 0.0028, y: 0.0099, e: 3.4 },
			{ z: -0.0155, w: 0.0042, h: 0.002, b: 0.0022, y: 0.0094, e: 3 },
		],
		[
			{ z: -0.0295, w: 0.0026, h: 0.0015, b: 0.0015, y: 0.0092, e: 2.7 },
			{ z: -0.0255, w: 0.0046, h: 0.0028, b: 0.002, y: 0.0104, e: 3 },
			{ z: -0.0205, w: 0.0042, h: 0.0024, b: 0.0018, y: 0.0111, e: 3 },
			{ z: -0.0175, w: 0.003, h: 0.0015, b: 0.0016, y: 0.0106, e: 2.7 },
		],
		p,
	);
	add(
		root,
		"freighter-mast",
		blade([
			{ z: 0.0, w: 0.0019, h: 0.0038, b: 0.0036, y: 0.002, e: 2.6 },
			{ z: 0.0072, w: 0.0016, h: 0.0032, b: 0.003, y: 0.005, e: 2.6 },
		]),
		p.trim,
		[0, 0, -0.0225],
		[0, 0, Math.PI / 2],
	);
	const frame = blade([
		{ z: 0.0, w: 0.0015, h: 0.0019, b: 0.0019, y: -0.0034, e: 2.4 },
		{ z: 0.0062, w: 0.0013, h: 0.0016, b: 0.0016, y: -0.005, e: 2.4 },
		{ z: 0.0118, w: 0.0012, h: 0.0015, b: 0.0015, y: -0.0062, e: 2.4 },
	]);
	const trawlerPylon = blade([
		{ z: 0.004, w: 0.0019, h: 0.0054, b: 0.005, y: 0.022, e: 3 },
		{ z: 0.0086, w: 0.0016, h: 0.0046, b: 0.0044, y: 0.0255, e: 3 },
		{ z: 0.0118, w: 0.0014, h: 0.0038, b: 0.0036, y: 0.0282, e: 2.8 },
	]);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			`freighter-tank-${side}`,
			revolve(drumProfile(0.0204, 0.0094)),
			p.panel,
			[sign * 0.015, -0.007, -0.002],
		);
		for (const band of [-0.009, 0.006])
			add(
				root,
				`freighter-tank-band-${side}-${band}`,
				hoop(0.0095, 0.0008),
				p.accent,
				[sign * 0.015, -0.007, -0.002 + band],
			);
		add(
			root,
			`freighter-frame-${side}`,
			sign > 0 ? frame : mirrorX(frame),
			p.trim,
			[0, 0, -0.008],
		);
		add(
			root,
			`freighter-frame-aft-${side}`,
			sign > 0 ? frame : mirrorX(frame),
			p.trim,
			[0, 0, 0.006],
		);
		add(
			root,
			"freighter-nacelle-mount-" + side,
			sign > 0 ? trawlerPylon : mirrorX(trawlerPylon),
			p.trim,
		);
		add(
			root,
			"freighter-" + side + "-nacelle",
			hullLoft(pod(0.013, 0.0315, 0.0042, { x: sign * 0.0126 })),
			p.panel,
		);
		add(root, "freighter-collar-" + side, hoop(0.0041, 0.0005), p.accent, [
			sign * 0.0126,
			0,
			0.0275,
		]);
		engineBell(
			root,
			"freighter-" + side,
			[sign * 0.0126, 0, 0.0355],
			0.0034,
			0.0036,
			p,
		);
	}
	engineBell(root, "freighter-core", [0, 0, 0.036], 0.0046, 0.0048, p);
	blister(root, "freighter-sensor", 0.0014, [0, 0.0044, -0.0125], p);
}

/**
 * A cutter head: the ring of teeth that says "this ship eats rock".
 *
 * The teeth are struts rather than a torus so they read as separate tools at
 * chase distance; a smooth ring reads as a docking collar instead.
 */
function cutterHead(
	root: THREE.Group,
	name: string,
	radius: number,
	z: number,
	p: Palette,
	y = 0,
) {
	add(root, name + "-ring", hoop(radius, radius * 0.16), p.trim, [0, y, z]);
	add(root, name + "-rim", hoop(radius, radius * 0.09), p.accent, [
		0,
		y,
		z - radius * 0.2,
	]);
	for (let tooth = 0; tooth < 8; tooth += 1) {
		const angle = (tooth / 8) * Math.PI * 2;
		const cx = Math.cos(angle);
		const cy = Math.sin(angle);
		add(
			root,
			`${name}-tooth-${tooth}`,
			strut(
				[cx * radius, y + cy * radius, z],
				[cx * radius * 0.94, y + cy * radius * 0.94, z - radius * 0.46],
				radius * 0.13,
				radius * 0.04,
			),
			p.engine,
		);
	}
}

/**
 * A survey dish.
 *
 * Built as a shallow closed lens rather than an open paraboloid: an open
 * surface shows its culled back face as a hole from behind, and at this scale
 * the silhouette carries the read anyway.
 */
function dish(
	root: THREE.Group,
	name: string,
	radius: number,
	position: [number, number, number],
	p: Palette,
	rotation: [number, number, number] = [0, 0, 0],
) {
	add(
		root,
		name,
		revolve(
			[
				[radius * 0.16, -radius * 0.15],
				[radius * 0.7, -radius * 0.08],
				[radius, radius * 0.01],
				[radius * 0.9, radius * 0.07],
				[radius * 0.22, radius * 0.03],
			],
			18,
		),
		p.hull,
		position,
		rotation,
	);
	add(root, name + "-feed", hoop(radius * 0.22, radius * 0.06), p.accent, [
		position[0],
		position[1],
		position[2] - radius * 0.3,
	]);
}

function buildMinerA(root: THREE.Group, p: Palette) {
	add(
		root,
		"miner-fuselage",
		hullLoft([
			{ z: -0.026, w: 0.0068, h: 0.0062, b: 0.006, e: 3.2 },
			{ z: -0.0215, w: 0.0094, h: 0.0082, b: 0.0078, e: 3.8, hard: true },
			{ z: -0.008, w: 0.0102, h: 0.0088, b: 0.0084, e: 4.4, hard: true },
			{ z: 0.014, w: 0.0098, h: 0.0084, b: 0.008, e: 4.4, hard: true },
			{ z: 0.028, w: 0.0112, h: 0.0094, b: 0.0088, e: 4.6, hard: true },
			{ z: 0.0355, w: 0.0096, h: 0.008, b: 0.0076, e: 3.6 },
		]),
		p.hull,
	);
	cutterHead(root, "miner-cutter", 0.0118, -0.0295, p, -0.0112);
	add(
		root,
		"miner-cutter-arm",
		strut([0, -0.0068, -0.0235], [0, -0.0112, -0.0295], 0.0038, 0.0028),
		p.trim,
	);
	bridge(
		root,
		"miner",
		[
			{ z: -0.0225, w: 0.0046, h: 0.0022, b: 0.0024, y: 0.0082, e: 3 },
			{ z: -0.0175, w: 0.0074, h: 0.004, b: 0.0031, y: 0.0098, e: 3.4 },
			{ z: -0.0115, w: 0.007, h: 0.0036, b: 0.0031, y: 0.0106, e: 3.4 },
			{ z: -0.0075, w: 0.0049, h: 0.0022, b: 0.0025, y: 0.01, e: 3 },
		],
		[
			{ z: -0.0215, w: 0.0031, h: 0.0016, b: 0.0017, y: 0.0098, e: 2.7 },
			{ z: -0.0175, w: 0.0053, h: 0.0032, b: 0.0022, y: 0.0114, e: 3 },
			{ z: -0.0125, w: 0.0049, h: 0.0028, b: 0.0021, y: 0.0124, e: 3 },
			{ z: -0.0095, w: 0.0034, h: 0.0016, b: 0.0017, y: 0.0118, e: 2.7 },
		],
		p,
	);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			`miner-hold-${side}`,
			revolve(drumProfile(0.0142, 0.0072)),
			p.panel,
			[sign * 0.0166, -0.0012, 0.0035],
		);
		for (const band of [-0.008, 0.008])
			add(
				root,
				`miner-hold-band-${side}-${band}`,
				hoop(0.0073, 0.0007),
				p.accent,
				[sign * 0.0166, -0.0012, 0.0035 + band],
			);
		const clamp = blade([
			{ z: 0.0072, w: 0.0018, h: 0.0042, b: 0.004, y: 0.0035, e: 2.8 },
			{ z: 0.0158, w: 0.0015, h: 0.0036, b: 0.0034, y: 0.0035, e: 2.8 },
		]);
		add(
			root,
			`miner-clamp-${side}`,
			sign > 0 ? clamp : mirrorX(clamp),
			p.trim,
			[0, -0.0012, 0],
		);
		add(
			root,
			"miner-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.009, w: 0.0028, h: 0.0068, b: 0.0064, y: 0.0245, e: 3.2 },
					{ z: 0.0162, w: 0.0024, h: 0.006, b: 0.0056, y: 0.0288, e: 3 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			"miner-" + side + "-nacelle",
			hullLoft(pod(0.016, 0.0345, 0.005, { x: sign * 0.0186 })),
			p.panel,
		);
		add(root, "miner-collar-" + side, hoop(0.0053, 0.0006), p.accent, [
			sign * 0.0186,
			0,
			0.03,
		]);
		engineBell(
			root,
			"miner-" + side,
			[sign * 0.0186, 0, 0.0385],
			0.0044,
			0.0046,
			p,
		);
	}
	engineBell(root, "miner-core", [0, 0, 0.0385], 0.0062, 0.0064, p);
	greebleStrip(
		root,
		"miner-conveyor",
		[
			{ z: -0.014, w: 0.0022, h: 0.0012, y: 0.0092, e: 2.4 },
			{ z: 0.016, w: 0.0024, h: 0.0013, y: 0.009, e: 2.4 },
			{ z: 0.028, w: 0.002, h: 0.0011, y: 0.0098, e: 2.4 },
		],
		{ ...p, panel: p.trim },
	);
	blister(root, "miner-sensor", 0.0016, [0.0048, 0.0088, -0.0055], p);
}

/**
 * Longwall B, the authored miner (#803, approved 2026-10-08; node #815).
 *
 * Node #815 asks for the approved model in the game the way #794 put the
 * cockpit there, so `miner/b` is that model rather than a loft:
 * `src/models/longwall-miner.glb`, prepared by
 * `spikes/longwall-miner/prepare-flight-asset.mjs` from the study's stowed
 * export. It is installed once (`longwall-model.ts` in the browser,
 * `tests/setup/longwall-model.ts` under bun) and every `buildShipMesh` clones
 * it, so a Traffic miner shares the template's buffers rather than decoding
 * its own. Map #1's Constraint allows the file: authored models are
 * same-origin bundle files (#830, #835, principal 2026-10-09).
 *
 * Node #838 installs this through the background queue. Before it arrives,
 * the selected miner draws miner/a as a stand-in; the authored template then
 * replaces every cached stand-in once. The envelope and vent tables in
 * HULL_SPECS stay fixed at their authored measurements. Chase muzzles follow
 * the mesh being drawn: measured on miner/a before install, then invalidated
 * and measured on Longwall B when the stand-in is rebuilt. Headless authored
 * geometry checks preload the model; the cold-install row explicitly removes
 * it to measure both sides of this transition.
 *
 * The export is model metres, +Z forward and Y up; this frame is kilometres
 * with the nose at -Z, so the exterior is turned half a turn about Y — a
 * rotation, not a mirror, so its winding survives — scaled by 0.001, and
 * moved so its box is centred on the ship's origin (`prepareLongwall`).
 *
 * It is drawn **stowed** and nothing articulates it. The cutter keeps its
 * named groups, and each anchor's part groups stay named while its metal is
 * merged (`batchLongwallAnchors`), so a later node can pose them; what mining
 * is, and the deployed envelope it would need, are not this node's.
 *
 * **Every Traffic miner is this model, so the detail band switches it**, as
 * it switches node #812's courier (`authored-levels.ts`): the model at
 * `full`, a medium copy at `reduced` and a coarse one at `outline`, all
 * three made here at install and cloned with the template. Only the player's
 * own miner draws the model: any other draws the medium copy however near it
 * is, a berth beside the player's included (`LONGWALL_NEAREST_LEVEL`).
 */
let longwallTemplate: THREE.Group | null = null;

/** The three levels' object names in a built miner: the model and its two
 *  reduced copies. One copy of the names, for the rows and instruments that
 *  pick a level out of a built miner. */
export const LONGWALL_LEVEL_NAMES = {
	full: "longwall-exterior",
	reduced: "longwall-reduced",
	outline: "longwall-outline",
} as const;

/**
 * The distance, in miner reaches, the medium level is made for: its target
 * error is half a device pixel there (`halfPixelKm`), about 0.14 m. The band
 * draws it from the player's nearest neighbour in a bay out to
 * `DETAIL_RADII.reduced`, because the principal ruled on 2026-10-09 that a
 * Traffic miner may be the medium level even inside a station; at 100 m,
 * 2.4 reaches, the same error is about 1.2 px. The model inside 40 radii was
 * 283,576 triangles per miner, every Traffic miner at a berth included (sage
 * round 9); the medium level is `tests/longwall-mesh.test.ts`'s figure.
 */
export const LONGWALL_MEDIUM_RADII = 10;

/** The most detail a miner other than the player's own is drawn at
 *  (`updateShipVisuals`'s `own`): the medium level, however near. */
export const LONGWALL_NEAREST_LEVEL = "reduced" as const;
/**
 * The drive nozzles, model metres in the export's frame: the two aft drive
 * rings stand at x = ±12.5 on the centre line's height, their lip reaches
 * z = -47 and their bore is 2.10 m in radius from the nacelle's cap at
 * z = -46.0 outward. The glow sits 0.3 m behind the cap, inside the bore.
 * `tests/longwall-mesh.test.ts` measures all of it off the shipped model.
 */
export const LONGWALL_NOZZLES_M = {
	x: 12.5,
	y: 0,
	z: -46.3,
	boreRadius: 2.1,
	glowRadius: 1.9,
} as const;

let longwallGlow: THREE.MeshStandardMaterial | undefined;
/** The drive glow: the gradient's white-hot core at the centre of the bore
 *  and the drive's blue at its rim, at the exhaust's one emissive dial. */
function longwallGlowMaterial() {
	longwallGlow ??= shared(
		new THREE.MeshStandardMaterial({
			name: "longwall-exhaust",
			color: 0x1b2f3a,
			emissive: 0xffffff,
			emissiveMap: exhaustGradientMap(),
			emissiveIntensity: SHIP_EMISSIVE_INTENSITIES.exhaust,
			roughness: 0.5,
			metalness: 0.1,
		}),
	);
	return longwallGlow;
}

function longwallGlowDisc() {
	const disc = new THREE.CircleGeometry(LONGWALL_NOZZLES_M.glowRadius, 24);
	// Radial: `v` is 0 at the centre and 1 at the rim, the axis the exhaust
	// gradient grades along.
	const position = disc.getAttribute("position") as THREE.BufferAttribute;
	const uv = disc.getAttribute("uv") as THREE.BufferAttribute;
	for (let i = 0; i < uv.count; i++)
		uv.setXY(
			i,
			0.5,
			Math.hypot(position.getX(i), position.getY(i)) /
				LONGWALL_NOZZLES_M.glowRadius,
		);
	return disc.scale(0.001, 0.001, 0.001);
}

/**
 * Install the decoded Longwall B scene (metres, as exported), or remove it.
 * Await `MeshoptSimplifier.ready` first: the two reduced levels are made
 * here, once, rather than per miner.
 */
export function installLongwallModel(scene: THREE.Group | null): void {
	// Swapped only once the prepare has returned: a prepare that throws leaves
	// the previous install whole (sage round 8).
	longwallTemplate = scene ? prepareLongwall(scene) : null;
	for (const key of muzzleCache.keys())
		if (key.startsWith("miner/")) muzzleCache.delete(key);
}

function prepareLongwall(scene: THREE.Group): THREE.Group {
	batchLongwallHull(scene);
	batchLongwallAnchors(scene);
	// The export's lamps are brighter than the game's exposure contract, as
	// the Coriolis's were: normalise once, keeping their relative strengths.
	const materials = new Set<THREE.MeshStandardMaterial>();
	scene.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh) return;
		shared(mesh.geometry);
		for (const m of materialsOf(mesh)) {
			if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
			shared(m);
			for (const value of Object.values(m))
				if (value instanceof THREE.Texture) shared(value);
		}
	});
	const divisor = Math.max(
		1,
		...[...materials].map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
	for (const m of materials) m.emissiveIntensity /= divisor;

	const template = new THREE.Group();
	template.name = "longwall-template";
	const exterior = new THREE.Group();
	exterior.name = LONGWALL_LEVEL_NAMES.full;
	exterior.rotation.y = Math.PI;
	exterior.scale.setScalar(0.001);
	exterior.add(scene);
	template.add(exterior);
	// **The ship's origin is the box's centre**, measured here rather than
	// declared. The export's own origin stands 4.8 m forward of it, and a
	// berth places a ship's origin: kept, the hull would park 2.1 m into the
	// end wall of a slot role's 90 m cell (`tests/collision-stations.test.ts`).
	template.updateMatrixWorld(true);
	const offset = new THREE.Box3()
		.setFromObject(exterior)
		.getCenter(new THREE.Vector3())
		.negate();
	exterior.position.copy(offset);
	// The levels stand where the model does, in its frame (metres), and
	// keep every lamp whole: an emissive reads at range far beyond its size.
	template.updateMatrixWorld(true);
	const rules = {
		keep: (mesh: THREE.Mesh) => materialsOf(mesh).some(isLampMaterial),
		permissive: true,
	};
	const kmPerM = 0.001;
	template.add(
		reducedLevel(
			exterior,
			halfPixelKm(LONGWALL_MEDIUM_RADII, HULL_REACH_KM.miner) / kmPerM,
			kmPerM,
			LONGWALL_LEVEL_NAMES.reduced,
			rules,
		),
		reducedLevel(
			exterior,
			levelErrorKm("outline", HULL_REACH_KM.miner) / kmPerM,
			kmPerM,
			LONGWALL_LEVEL_NAMES.outline,
			rules,
		),
	);
	// Production frame: the export's +X is port once turned about Y.
	const disc = shared(longwallGlowDisc());
	for (const [side, x] of [
		["port", -LONGWALL_NOZZLES_M.x],
		["starboard", LONGWALL_NOZZLES_M.x],
	] as const) {
		const glow = new THREE.Mesh(disc, longwallGlowMaterial());
		glow.name = `longwall-${side}${EXHAUST_SUFFIX}`;
		glow.position
			.set(
				x * 0.001,
				LONGWALL_NOZZLES_M.y * 0.001,
				-LONGWALL_NOZZLES_M.z * 0.001,
			)
			.add(offset);
		template.add(glow);
	}
	// Placed by rays against 283k triangles, so once here rather than per
	// clone: a Traffic miner arriving mid-flight must not pay for them.
	addNavLights(template);
	template.traverse((o) => {
		if (o.name === "nav-lights") shared((o as THREE.Points).geometry);
	});
	template.updateMatrixWorld(true);
	return template;
}

/** Is this a lamp — an emissive the detail band and the hull batch leave
 *  alone? One definition, read by both and by `tests/longwall-mesh.test.ts`. */
export function isLampMaterial(material: THREE.Material): boolean {
	return (
		material instanceof THREE.MeshStandardMaterial &&
		material.emissive.getHex() !== 0 &&
		material.emissiveIntensity > 0
	);
}

const materialsOf = (mesh: THREE.Mesh): THREE.Material[] =>
	Array.isArray(mesh.material) ? mesh.material : [mesh.material];

/** The hull's paint: an opaque material that is no lamp. The batches read
 *  this one rule, and so does `tests/longwall-mesh.test.ts`. */
export const isHullPaint = (material: THREE.Material): boolean =>
	!isLampMaterial(material) && !material.transparent;

/** A mesh drawn in one material, and that material the hull's paint. */
const paintedMesh = (o: THREE.Object3D): o is THREE.Mesh => {
	const mesh = o as THREE.Mesh;
	if (!mesh.isMesh) return false;
	const materials = materialsOf(mesh);
	return materials.length === 1 && isHullPaint(materials[0]);
};

/** The export's static `hull` group, which every hull rule reads. */
function longwallHullGroup(scene: THREE.Object3D): THREE.Object3D {
	const hull = scene.getObjectByName("hull");
	if (!hull) throw new Error("Longwall B: the export has no hull group");
	return hull;
}

/** The `hull` group under `root` — the export or a built clone — its
 *  painted meshes, and the transform into its frame (sage round 8). */
function hullPaintMeshes(root: THREE.Object3D): {
	hull: THREE.Object3D;
	toHull: THREE.Matrix4;
	meshes: THREE.Mesh[];
} {
	const hull = longwallHullGroup(root);
	root.updateMatrixWorld(true);
	const meshes: THREE.Mesh[] = [];
	hull.traverse((o) => {
		if (paintedMesh(o)) meshes.push(o);
	});
	return { hull, toHull: hull.matrixWorld.clone().invert(), meshes };
}

/**
 * Merge `meshes` into one mesh per material that two or more of them share,
 * each source's transform baked into its vertices against `toFrame`, so the
 * triangles are the same triangles in the same place. The sources leave their
 * parents; the batches, named `${prefix}-${material}`, are returned for the
 * caller to place in that frame. A material only one source draws is left
 * where it was.
 */
function mergeByMaterial(
	meshes: readonly THREE.Mesh[],
	toFrame: THREE.Matrix4,
	prefix: string,
): THREE.Mesh[] {
	const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
	for (const mesh of meshes) {
		const material = mesh.material as THREE.Material;
		byMaterial.set(material, [...(byMaterial.get(material) ?? []), mesh]);
	}
	const batches: THREE.Mesh[] = [];
	for (const [material, sources] of byMaterial) {
		if (sources.length < 2) continue;
		const merged = mergeGeometries(
			sources.map((mesh) =>
				mesh.geometry
					.clone()
					.applyMatrix4(
						new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld),
					),
			),
		);
		if (!merged)
			throw new Error(`Longwall B: cannot merge ${prefix}'s ${material.name}`);
		const batch = new THREE.Mesh(merged, material);
		batch.name = `${prefix}-${material.name}`;
		batch.castShadow = sources.some((m) => m.castShadow);
		batch.receiveShadow = sources.some((m) => m.receiveShadow);
		for (const mesh of sources) mesh.removeFromParent();
		batches.push(batch);
	}
	return batches;
}

/**
 * Merge the static hull's opaque, unlit meshes into one mesh per material
 * (node #815, sage round 2): the export splits the `hull` group into 19
 * meshes over 10 materials, nine of them `dark-structure`, and nothing moves
 * any of them. Lamps and the transparent glazing keep their own meshes, and
 * nothing outside `hull` is touched here; the anchors are
 * `batchLongwallAnchors`'s. Each source's transform below `hull` is baked
 * into its vertices, so the triangles are the same triangles in the same
 * place.
 */
function batchLongwallHull(scene: THREE.Group): void {
	const { hull, toHull, meshes } = hullPaintMeshes(scene);
	for (const batch of mergeByMaterial(meshes, toHull, "hull")) hull.add(batch);
}

/**
 * Merge each stowed anchor's painted meshes into one mesh per material (node
 * #815, sage round 8). The export draws an anchor as six part groups —
 * `anchor-N-body`, `-sleeve`, `-elbow`, `-lower`, `-lower-rod` and
 * `-foot` — and 19 meshes, and nothing in the game poses any of them, so an
 * anchor near a station was 72 draws in the colour pass for four static
 * shapes, and again in the shadow and AO passes. Each anchor's batches go in
 * a new group `anchor-N` at the scene's own frame, which the detail band's
 * `/^anchor-\d/` still hides at `reduced`; the six part groups stay, named
 * and in place, holding only the foot's lamp, so a node that poses the
 * anchors can split them again from the export.
 */
function batchLongwallAnchors(scene: THREE.Group): void {
	scene.updateMatrixWorld(true);
	const toScene = scene.matrixWorld.clone().invert();
	const byAnchor = new Map<string, THREE.Mesh[]>();
	for (const part of scene.children) {
		const anchor = /^(anchor-\d+)-/.exec(part.name)?.[1];
		if (!anchor) continue;
		part.traverse((o) => {
			if (paintedMesh(o))
				byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), o]);
		});
	}
	for (const [name, meshes] of byAnchor) {
		const anchor = new THREE.Group();
		anchor.name = name;
		for (const batch of mergeByMaterial(meshes, toScene, name))
			anchor.add(batch);
		scene.add(anchor);
	}
}

function buildLongwall(root: THREE.Group): ShipLevels {
	if (!longwallTemplate)
		throw new Error(
			"miner/b is the authored Longwall B: await prepareLongwallModel() " +
				"(src/longwall-model.ts) before building it",
		);
	for (const child of longwallTemplate.children) {
		const copy = child.clone(true);
		// `clone` copies no callbacks, and the nav lights' pixel ratio is one.
		if (child.name === "nav-lights") copy.onBeforeRender = child.onBeforeRender;
		root.add(copy);
	}
	const level = (name: string) =>
		root.children.find((c) => c.name === name) as THREE.Object3D;
	return {
		full: level(LONGWALL_LEVEL_NAMES.full),
		reduced: level(LONGWALL_LEVEL_NAMES.reduced),
		outline: level(LONGWALL_LEVEL_NAMES.outline),
	};
}

function buildMinerC(root: THREE.Group, p: Palette) {
	const deck = 0.0072;
	add(
		root,
		"miner-fuselage",
		hullLoft([
			{ z: -0.0275, w: 0.0046, h: 0.0044, b: 0.0042, y: deck, e: 3 },
			{
				z: -0.023,
				w: 0.0068,
				h: 0.0062,
				b: 0.006,
				y: deck,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.0155,
				w: 0.0068,
				h: 0.0062,
				b: 0.006,
				y: deck,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.0135,
				w: 0.0048,
				h: 0.0046,
				b: 0.0045,
				y: deck,
				e: 3.2,
				hard: true,
			},
			{ z: 0.02, w: 0.0048, h: 0.0046, b: 0.0045, y: deck, e: 3.2, hard: true },
			{
				z: 0.0235,
				w: 0.0092,
				h: 0.0078,
				b: 0.0074,
				y: deck,
				e: 4.2,
				hard: true,
			},
			{
				z: 0.035,
				w: 0.0092,
				h: 0.0078,
				b: 0.0074,
				y: deck,
				e: 4.2,
				hard: true,
			},
			{ z: 0.037, w: 0.008, h: 0.0068, b: 0.0064, y: deck, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"miner",
		[
			{ z: -0.025, w: 0.0044, h: 0.0022, b: 0.0024, y: deck + 0.0044, e: 3 },
			{ z: -0.02, w: 0.0072, h: 0.0038, b: 0.003, y: deck + 0.0056, e: 3.4 },
			{ z: -0.014, w: 0.0068, h: 0.0034, b: 0.003, y: deck + 0.006, e: 3.4 },
			{ z: -0.01, w: 0.0048, h: 0.0022, b: 0.0024, y: deck + 0.0056, e: 3 },
		],
		[
			{ z: -0.024, w: 0.003, h: 0.0016, b: 0.0016, y: deck + 0.0057, e: 2.7 },
			{ z: -0.02, w: 0.0051, h: 0.003, b: 0.0021, y: deck + 0.0068, e: 3 },
			{ z: -0.015, w: 0.0047, h: 0.0026, b: 0.002, y: deck + 0.0072, e: 3 },
			{ z: -0.012, w: 0.0033, h: 0.0016, b: 0.0016, y: deck + 0.0068, e: 2.7 },
		],
		p,
	);
	// The cutter works below the keel; the refinery drum rides above it.
	cutterHead(root, "miner-cutter", 0.0118, -0.0305, p, -0.0052);
	add(
		root,
		"miner-cutter-boom",
		strut([0, deck - 0.004, -0.023], [0, -0.0052, -0.029], 0.0038, 0.0028),
		p.trim,
	);
	add(root, "miner-refinery", revolve(drumProfile(0.0158, 0.0078)), p.hull, [
		0,
		deck + 0.0128,
		0.002,
	]);
	for (const band of [-0.008, 0.008])
		add(root, `miner-refinery-band-${band}`, hoop(0.008, 0.0008), p.accent, [
			0,
			deck + 0.0128,
			0.002 + band,
		]);
	for (const [tag, cz] of [
		["fore", -0.0075],
		["aft", 0.0125],
	] as const)
		add(
			root,
			`miner-stack-${tag}`,
			strut([0, deck + 0.0038, cz], [0, deck + 0.0092, cz], 0.0026, 0.0022),
			p.trim,
		);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			"miner-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0052, w: 0.0028, h: 0.007, b: 0.0066, y: 0.0255, e: 3.2 },
					{ z: 0.0138, w: 0.0024, h: 0.0062, b: 0.0058, y: 0.0295, e: 3 },
				],
				sign,
			),
			p.trim,
			[0, deck, 0],
		);
		add(
			root,
			"miner-" + side + "-nacelle",
			hullLoft(pod(0.0165, 0.0345, 0.0046, { x: sign * 0.016, y: deck })),
			p.panel,
		);
		engineBell(
			root,
			"miner-" + side,
			[sign * 0.016, deck, 0.0385],
			0.004,
			0.0042,
			p,
		);
	}
	engineBell(root, "miner-core", [0, deck, 0.039], 0.0056, 0.0058, p);
	blister(root, "miner-sensor", 0.0016, [0.0032, deck + 0.0048, -0.006], p);
}

function buildPatrolA(root: THREE.Group, p: Palette) {
	add(
		root,
		"patrol-fuselage",
		hullLoft([
			{ z: -0.0295, w: 0.001, h: 0.0009, b: 0.0009, e: 2.4 },
			{ z: -0.0245, w: 0.0038, h: 0.002, b: 0.0022, e: 3 },
			{ z: -0.0155, w: 0.0074, h: 0.0032, b: 0.0035, e: 4 },
			{ z: -0.004, w: 0.0096, h: 0.0038, b: 0.004, e: 4.8, hard: true },
			{ z: 0.008, w: 0.0094, h: 0.0037, b: 0.0039, e: 4.8, hard: true },
			{ z: 0.019, w: 0.0072, h: 0.0031, b: 0.0031, e: 3.8 },
			{ z: 0.027, w: 0.0048, h: 0.0022, b: 0.002, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"patrol",
		[
			{ z: -0.0235, w: 0.0032, h: 0.0011, b: 0.0014, y: 0.0026, e: 2.8 },
			{ z: -0.0175, w: 0.0055, h: 0.0021, b: 0.0018, y: 0.0033, e: 3.2 },
			{ z: -0.011, w: 0.0053, h: 0.0019, b: 0.0018, y: 0.0037, e: 3.2 },
			{ z: -0.0065, w: 0.0036, h: 0.0012, b: 0.0014, y: 0.0037, e: 2.8 },
		],
		[
			{ z: -0.022, w: 0.0022, h: 0.0009, b: 0.001, y: 0.0036, e: 2.6 },
			{ z: -0.017, w: 0.0039, h: 0.0017, b: 0.0013, y: 0.004, e: 2.9 },
			{ z: -0.012, w: 0.0037, h: 0.0015, b: 0.0013, y: 0.0043, e: 2.9 },
			{ z: -0.009, w: 0.0025, h: 0.0009, b: 0.001, y: 0.0042, e: 2.6 },
		],
		p,
	);
	add(
		root,
		"patrol-sensor-dome",
		revolve(
			[
				[0.0032, -0.0022],
				[0.0038, -0.0004],
				[0.0031, 0.0014],
				[0.0014, 0.0026],
			],
			14,
		),
		p.trim,
		[0, 0.0038, 0.006],
		[-Math.PI / 2, 0, 0],
	);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		chine(
			root,
			"patrol-chine-" + side,
			[
				{ z: -0.0165, w: 0.001, h: 0.0006, x: 0.007, e: 1.5 },
				{ z: -0.004, w: 0.0013, h: 0.0008, x: 0.0092, e: 1.5 },
				{ z: 0.008, w: 0.0012, h: 0.0007, x: 0.009, e: 1.5 },
				{ z: 0.019, w: 0.0009, h: 0.0005, x: 0.0069, e: 1.5 },
			],
			p,
			sign,
		);
		// The stripe is the uniform: a patrol hull has to be recognised on sight.
		greebleStrip(
			root,
			"patrol-stripe-" + side,
			[
				{ z: -0.013, w: 0.0009, h: 0.0005, x: sign * 0.0064, y: 0.0026, e: 2 },
				{ z: 0.006, w: 0.001, h: 0.0005, x: sign * 0.0082, y: 0.0026, e: 2 },
				{ z: 0.017, w: 0.0008, h: 0.0004, x: sign * 0.0064, y: 0.0024, e: 2 },
			],
			{ ...p, panel: p.accent },
		);
		add(
			root,
			"patrol-hardpoint-" + side,
			hullLoft(pod(-0.014, 0.004, 0.0016, { x: sign * 0.0058, y: 0.0044 })),
			p.trim,
		);
		add(
			root,
			"patrol-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.005, w: 0.0026, h: 0.0062, b: 0.0058, y: 0.0125, e: 3.2 },
					{ z: 0.0126, w: 0.0022, h: 0.0054, b: 0.005, y: 0.0165, e: 3 },
				],
				sign,
			),
			p.hull,
		);
		add(
			root,
			"patrol-" + side + "-nacelle",
			hullLoft(pod(-0.002, 0.024, 0.0038, { x: sign * 0.0146 })),
			p.panel,
		);
		add(root, "patrol-collar-" + side, hoop(0.0041, 0.0005), p.accent, [
			sign * 0.0146,
			0,
			0.0185,
		]);
		engineBell(
			root,
			"patrol-" + side,
			[sign * 0.0146, 0, 0.027],
			0.0033,
			0.0035,
			p,
		);
	}
	engineBell(root, "patrol-core", [0, 0, 0.0285], 0.0042, 0.0044, p);
	blister(root, "patrol-sensor", 0.0012, [0.0032, 0.0042, -0.0105], p);
}

function buildPatrolB(root: THREE.Group, p: Palette) {
	const keel = -0.0038;
	add(
		root,
		"patrol-fuselage",
		hullLoft([
			{ z: -0.0295, w: 0.001, h: 0.0009, b: 0.0009, x: keel, e: 2.4 },
			{ z: -0.0245, w: 0.0036, h: 0.002, b: 0.0022, x: keel, e: 3 },
			{ z: -0.0155, w: 0.0068, h: 0.0032, b: 0.0034, x: keel, e: 4 },
			{
				z: -0.004,
				w: 0.0084,
				h: 0.0037,
				b: 0.0039,
				x: keel,
				e: 4.8,
				hard: true,
			},
			{
				z: 0.008,
				w: 0.0082,
				h: 0.0036,
				b: 0.0038,
				x: keel,
				e: 4.8,
				hard: true,
			},
			{ z: 0.019, w: 0.0064, h: 0.003, b: 0.003, x: keel, e: 3.8 },
			{ z: 0.027, w: 0.0044, h: 0.0021, b: 0.0019, x: keel, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"patrol",
		[
			{
				z: -0.0235,
				w: 0.0032,
				h: 0.0011,
				b: 0.0014,
				x: keel,
				y: 0.0026,
				e: 2.8,
			},
			{
				z: -0.0175,
				w: 0.0055,
				h: 0.0021,
				b: 0.0018,
				x: keel,
				y: 0.0033,
				e: 3.2,
			},
			{
				z: -0.011,
				w: 0.0053,
				h: 0.0019,
				b: 0.0018,
				x: keel,
				y: 0.0037,
				e: 3.2,
			},
			{
				z: -0.0065,
				w: 0.0036,
				h: 0.0012,
				b: 0.0014,
				x: keel,
				y: 0.0037,
				e: 2.8,
			},
		],
		[
			{ z: -0.022, w: 0.0022, h: 0.0009, b: 0.001, x: keel, y: 0.0036, e: 2.6 },
			{ z: -0.017, w: 0.0039, h: 0.0017, b: 0.0013, x: keel, y: 0.004, e: 2.9 },
			{
				z: -0.012,
				w: 0.0037,
				h: 0.0015,
				b: 0.0013,
				x: keel,
				y: 0.0043,
				e: 2.9,
			},
			{ z: -0.009, w: 0.0025, h: 0.0009, b: 0.001, x: keel, y: 0.0042, e: 2.6 },
		],
		p,
	);
	// A boarding tube to starboard is what a marshal carries instead of symmetry.
	add(
		root,
		"patrol-boarding-tube",
		hullLoft(pod(-0.0195, 0.0105, 0.0042, { x: 0.0132, y: -0.0008, e: 3 })),
		p.panel,
	);
	add(
		root,
		"patrol-tube-collar",
		hoop(0.0045, 0.0008),
		p.accent,
		[0.0132, -0.0008, -0.0165],
	);
	for (const [tag, cz] of [
		["fore", -0.013],
		["aft", 0.004],
	] as const)
		add(
			root,
			`patrol-tube-stay-${tag}`,
			strut([keel + 0.005, 0, cz], [0.0132, -0.0008, cz], 0.0016, 0.0014),
			p.trim,
		);
	add(
		root,
		"patrol-nacelle-mount-starboard",
		blade([
			{ z: 0.0092, w: 0.0024, h: 0.0056, b: 0.0052, y: 0.0165, e: 3.2 },
			{ z: 0.0146, w: 0.0021, h: 0.0048, b: 0.0046, y: 0.02, e: 3 },
		]),
		p.trim,
	);
	add(
		root,
		"patrol-starboard-nacelle",
		hullLoft(pod(0.0095, 0.0245, 0.0036, { x: 0.0166 })),
		p.panel,
	);
	engineBell(root, "patrol-starboard", [0.0166, 0, 0.0275], 0.0031, 0.0033, p);
	add(
		root,
		"patrol-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.004, w: 0.0028, h: 0.0064, b: 0.006, y: 0.0115, e: 3.2 },
				{ z: 0.0112, w: 0.0024, h: 0.0056, b: 0.0052, y: 0.0155, e: 3 },
			]),
		),
		p.hull,
		[keel, 0, 0],
	);
	add(
		root,
		"patrol-port-nacelle",
		hullLoft(pod(-0.004, 0.024, 0.0042, { x: keel - 0.0104 })),
		p.panel,
	);
	add(root, "patrol-collar-port", hoop(0.0045, 0.0005), p.accent, [
		keel - 0.0104,
		0,
		0.0185,
	]);
	engineBell(root, "patrol-port", [keel - 0.0134, 0, 0.027], 0.0036, 0.0038, p);
	greebleStrip(
		root,
		"patrol-stripe",
		[
			{ z: -0.013, w: 0.0009, h: 0.0005, x: keel - 0.0058, y: 0.0026, e: 2 },
			{ z: 0.006, w: 0.001, h: 0.0005, x: keel - 0.0074, y: 0.0026, e: 2 },
			{ z: 0.017, w: 0.0008, h: 0.0004, x: keel - 0.0058, y: 0.0024, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "patrol-sensor", 0.0013, [keel + 0.0032, 0.0042, -0.0105], p);
}

function buildPatrolC(root: THREE.Group, p: Palette) {
	add(
		root,
		"patrol-fuselage",
		hullLoft([
			{ z: -0.0245, w: 0.001, h: 0.0009, b: 0.0009, e: 2.4 },
			{ z: -0.0195, w: 0.0038, h: 0.0021, b: 0.0023, e: 3 },
			{ z: -0.0115, w: 0.0074, h: 0.0034, b: 0.0037, e: 4 },
			{ z: 0.0005, w: 0.0092, h: 0.004, b: 0.0042, e: 4.8, hard: true },
			{ z: 0.0115, w: 0.009, h: 0.0039, b: 0.0041, e: 4.8, hard: true },
			{ z: 0.0215, w: 0.007, h: 0.0032, b: 0.0032, e: 3.8 },
			{ z: 0.029, w: 0.0046, h: 0.0022, b: 0.002, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"patrol",
		[
			{ z: -0.0185, w: 0.0032, h: 0.0011, b: 0.0014, y: 0.0028, e: 2.8 },
			{ z: -0.0125, w: 0.0055, h: 0.0021, b: 0.0018, y: 0.0035, e: 3.2 },
			{ z: -0.006, w: 0.0053, h: 0.0019, b: 0.0018, y: 0.0039, e: 3.2 },
			{ z: -0.0015, w: 0.0036, h: 0.0012, b: 0.0014, y: 0.0039, e: 2.8 },
		],
		[
			{ z: -0.017, w: 0.0022, h: 0.0009, b: 0.001, y: 0.0038, e: 2.6 },
			{ z: -0.012, w: 0.0039, h: 0.0017, b: 0.0013, y: 0.0042, e: 2.9 },
			{ z: -0.007, w: 0.0037, h: 0.0015, b: 0.0013, y: 0.0045, e: 2.9 },
			{ z: -0.004, w: 0.0025, h: 0.0009, b: 0.001, y: 0.0044, e: 2.6 },
		],
		p,
	);
	// An interdiction ring, carried clear of the hull on four short pylons. It
	// is open in the middle, so it frames the forward view instead of filling it.
	add(
		root,
		"patrol-interdictor",
		hoop(0.0114, 0.0018),
		p.hull,
		[0, 0, -0.0295],
	);
	add(
		root,
		"patrol-interdictor-live",
		hoop(0.0114, 0.001),
		p.accent,
		[0, 0, -0.029],
	);
	for (let pylon = 0; pylon < 4; pylon += 1) {
		const angle = Math.PI / 4 + (pylon / 4) * Math.PI * 2;
		const cx = Math.cos(angle);
		const cy = Math.sin(angle);
		add(
			root,
			`patrol-interdictor-pylon-${pylon}`,
			strut(
				[cx * 0.0028, cy * 0.0028, -0.0175],
				[cx * 0.0112, cy * 0.0112, -0.0285],
				0.0014,
				0.0011,
			),
			p.trim,
		);
	}
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		chine(
			root,
			"patrol-chine-" + side,
			[
				{ z: -0.012, w: 0.001, h: 0.0006, x: 0.0071, e: 1.5 },
				{ z: 0.0005, w: 0.0013, h: 0.0008, x: 0.0089, e: 1.5 },
				{ z: 0.0115, w: 0.0012, h: 0.0007, x: 0.0086, e: 1.5 },
				{ z: 0.0215, w: 0.0009, h: 0.0005, x: 0.0067, e: 1.5 },
			],
			p,
			sign,
		);
		greebleStrip(
			root,
			"patrol-stripe-" + side,
			[
				{ z: -0.009, w: 0.0009, h: 0.0005, x: sign * 0.0062, y: 0.0028, e: 2 },
				{ z: 0.009, w: 0.001, h: 0.0005, x: sign * 0.0078, y: 0.0028, e: 2 },
				{ z: 0.019, w: 0.0008, h: 0.0004, x: sign * 0.0062, y: 0.0026, e: 2 },
			],
			{ ...p, panel: p.accent },
		);
		add(
			root,
			"patrol-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.005, w: 0.0026, h: 0.0062, b: 0.0058, y: 0.0155, e: 3.2 },
					{ z: 0.0098, w: 0.0022, h: 0.0054, b: 0.005, y: 0.0195, e: 3 },
				],
				sign,
			),
			p.hull,
		);
		add(
			root,
			"patrol-" + side + "-nacelle",
			hullLoft(pod(0.003, 0.0265, 0.0038, { x: sign * 0.0112 })),
			p.panel,
		);
		add(root, "patrol-collar-" + side, hoop(0.0041, 0.0005), p.accent, [
			sign * 0.0112,
			0,
			0.021,
		]);
		engineBell(
			root,
			"patrol-" + side,
			[sign * 0.0112, 0, 0.0295],
			0.0033,
			0.0035,
			p,
		);
	}
	engineBell(root, "patrol-core", [0, 0, 0.0305], 0.0042, 0.0044, p);
	blister(root, "patrol-sensor", 0.0013, [0.003, 0.0044, -0.0055], p);
}

function buildExplorerA(root: THREE.Group, p: Palette) {
	add(
		root,
		"explorer-fuselage",
		hullLoft([
			{ z: -0.0325, w: 0.0028, h: 0.0026, b: 0.0026, e: 2.8 },
			{ z: -0.0275, w: 0.0054, h: 0.005, b: 0.0048, e: 3.4, hard: true },
			{ z: -0.0205, w: 0.0054, h: 0.005, b: 0.0048, e: 3.4, hard: true },
			{ z: -0.0185, w: 0.0038, h: 0.0036, b: 0.0036, e: 3.2, hard: true },
			{ z: 0.0195, w: 0.0038, h: 0.0036, b: 0.0036, e: 3.2, hard: true },
			{ z: 0.023, w: 0.0088, h: 0.0076, b: 0.0072, e: 4.2, hard: true },
			{ z: 0.036, w: 0.0088, h: 0.0076, b: 0.0072, e: 4.2, hard: true },
			{ z: 0.038, w: 0.0076, h: 0.0066, b: 0.0062, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"explorer",
		[
			{ z: -0.0295, w: 0.0042, h: 0.002, b: 0.0022, y: 0.0042, e: 3 },
			{ z: -0.0245, w: 0.0068, h: 0.0036, b: 0.0028, y: 0.0054, e: 3.4 },
			{ z: -0.0185, w: 0.0064, h: 0.0032, b: 0.0028, y: 0.006, e: 3.4 },
			{ z: -0.0145, w: 0.0045, h: 0.002, b: 0.0022, y: 0.0054, e: 3 },
		],
		[
			{ z: -0.0285, w: 0.0028, h: 0.0014, b: 0.0015, y: 0.0055, e: 2.7 },
			{ z: -0.0245, w: 0.0048, h: 0.0028, b: 0.002, y: 0.0066, e: 3 },
			{ z: -0.0195, w: 0.0045, h: 0.0024, b: 0.0018, y: 0.0072, e: 3 },
			{ z: -0.0165, w: 0.0031, h: 0.0014, b: 0.0015, y: 0.0066, e: 2.7 },
		],
		p,
	);
	// A habitat ring around the keel: months of endurance without a metre of it
	// in front of the windows.
	add(root, "explorer-hab-ring", hoop(0.0148, 0.0044), p.panel, [0, 0, -0.002]);
	add(root, "explorer-hab-rim", hoop(0.0148, 0.0021), p.accent, [0, 0, -0.002]);
	for (let spoke = 0; spoke < 4; spoke += 1) {
		const angle = Math.PI / 4 + (spoke / 4) * Math.PI * 2;
		const cx = Math.cos(angle);
		const cy = Math.sin(angle);
		add(
			root,
			`explorer-hab-spoke-${spoke}`,
			strut(
				[cx * 0.003, cy * 0.003, -0.002],
				[cx * 0.0142, cy * 0.0142, -0.002],
				0.0015,
				0.0012,
			),
			p.trim,
		);
	}
	// The dish looks back over the ring from a mast well aft of the bridge.
	add(
		root,
		"explorer-dish-mast",
		strut([0, 0.0038, 0.0135], [0, 0.0132, 0.0115], 0.0022, 0.0016),
		p.trim,
	);
	dish(root, "explorer-dish", 0.0116, [0, 0.0152, 0.0108], p, [
		-Math.PI / 2.7,
		0,
		0,
	]);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		fin(
			root,
			"explorer-radiator-" + side,
			[
				{ z: 0.0058, w: 0.0004, h: 0.0084, b: 0.0026, y: 0.0225, e: 2.2 },
				{ z: 0.0152, w: 0.0003, h: 0.007, b: 0.002, y: 0.0262, e: 2.2 },
			],
			p,
			sign,
			[0, 0.003, 0],
		);
		add(
			root,
			"explorer-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0044, w: 0.0026, h: 0.0064, b: 0.006, y: 0.0255, e: 3.2 },
					{ z: 0.0118, w: 0.0022, h: 0.0056, b: 0.0052, y: 0.0295, e: 3 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			"explorer-" + side + "-nacelle",
			hullLoft(pod(0.018, 0.036, 0.0042, { x: sign * 0.0144 })),
			p.panel,
		);
		engineBell(
			root,
			"explorer-" + side,
			[sign * 0.0144, 0, 0.04],
			0.0036,
			0.0038,
			p,
		);
	}
	engineBell(root, "explorer-core", [0, 0, 0.0405], 0.0052, 0.0054, p);
	blister(root, "explorer-sensor", 0.0014, [0.003, 0.0046, -0.0155], p);
}
function buildExplorerB(root: THREE.Group, p: Palette) {
	const keel = 0.0052;
	add(
		root,
		"explorer-fuselage",
		hullLoft([
			{ z: -0.0245, w: 0.0034, h: 0.0032, b: 0.0032, x: keel, e: 2.8 },
			{
				z: -0.0195,
				w: 0.0058,
				h: 0.0054,
				b: 0.0052,
				x: keel,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.0125,
				w: 0.0058,
				h: 0.0054,
				b: 0.0052,
				x: keel,
				e: 3.4,
				hard: true,
			},
			{
				z: -0.0105,
				w: 0.0042,
				h: 0.004,
				b: 0.004,
				x: keel,
				e: 3.2,
				hard: true,
			},
			{ z: 0.022, w: 0.0042, h: 0.004, b: 0.004, x: keel, e: 3.2, hard: true },
			{
				z: 0.0255,
				w: 0.0084,
				h: 0.0072,
				b: 0.0068,
				x: keel,
				e: 4.2,
				hard: true,
			},
			{
				z: 0.037,
				w: 0.0084,
				h: 0.0072,
				b: 0.0068,
				x: keel,
				e: 4.2,
				hard: true,
			},
			{ z: 0.039, w: 0.0072, h: 0.0062, b: 0.0058, x: keel, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"explorer",
		[
			{ z: -0.0215, w: 0.0042, h: 0.002, b: 0.0022, x: keel, y: 0.0042, e: 3 },
			{
				z: -0.0165,
				w: 0.0068,
				h: 0.0036,
				b: 0.0028,
				x: keel,
				y: 0.0054,
				e: 3.4,
			},
			{
				z: -0.0105,
				w: 0.0064,
				h: 0.0032,
				b: 0.0028,
				x: keel,
				y: 0.0058,
				e: 3.4,
			},
			{ z: -0.0065, w: 0.0045, h: 0.002, b: 0.0022, x: keel, y: 0.0054, e: 3 },
		],
		[
			{
				z: -0.0205,
				w: 0.0028,
				h: 0.0014,
				b: 0.0015,
				x: keel,
				y: 0.0055,
				e: 2.7,
			},
			{ z: -0.0165, w: 0.0048, h: 0.0028, b: 0.002, x: keel, y: 0.0066, e: 3 },
			{ z: -0.0115, w: 0.0045, h: 0.0024, b: 0.0018, x: keel, y: 0.007, e: 3 },
			{
				z: -0.0085,
				w: 0.0031,
				h: 0.0014,
				b: 0.0015,
				x: keel,
				y: 0.0066,
				e: 2.7,
			},
		],
		p,
	);
	// Habitat to port, bunkerage and the dish to starboard: a ship packed for
	// months out, not one balanced for a drawing.
	add(
		root,
		"explorer-habitat",
		revolve(drumProfile(0.0152, 0.0086)),
		p.panel,
		[-0.0128, -0.0056, -0.001],
	);
	for (const band of [-0.008, 0.008])
		add(root, `explorer-hab-band-${band}`, hoop(0.0088, 0.0009), p.accent, [
			-0.0128,
			-0.0056,
			-0.001 + band,
		]);
	for (const [tag, cz] of [
		["fore", -0.0125],
		["aft", 0.0105],
	] as const)
		add(
			root,
			`explorer-hab-stay-${tag}`,
			strut(
				[keel - 0.0028, 0.0006, cz],
				[-0.0128, -0.0056, cz],
				0.0016,
				0.0014,
			),
			p.trim,
		);
	add(
		root,
		"explorer-bunker",
		revolve(drumProfile(0.0112, 0.0056)),
		p.panel,
		[0.0148, -0.0012, 0.006],
	);
	add(
		root,
		"explorer-dish-boom",
		strut([0.0142, 0.0018, 0.0035], [0.0172, 0.0088, -0.0035], 0.0024, 0.0017),
		p.trim,
	);
	dish(root, "explorer-dish", 0.0104, [0.0208, 0.0098, -0.0058], p, [
		-Math.PI / 3,
		0.28,
		0,
	]);
	add(
		root,
		"explorer-nacelle-mount-starboard",
		blade([
			{ z: 0.0128, w: 0.0022, h: 0.005, b: 0.0048, y: 0.024, e: 3 },
			{ z: 0.0182, w: 0.0019, h: 0.0044, b: 0.0042, y: 0.0275, e: 2.8 },
		]),
		p.trim,
	);
	add(
		root,
		"explorer-starboard-nacelle",
		hullLoft(pod(0.017, 0.037, 0.0036, { x: 0.0196 })),
		p.panel,
	);
	engineBell(root, "explorer-starboard", [0.0196, 0, 0.041], 0.0031, 0.0033, p);
	add(
		root,
		"explorer-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.006, w: 0.0026, h: 0.0062, b: 0.0058, y: 0.026, e: 3.2 },
				{ z: 0.0132, w: 0.0022, h: 0.0054, b: 0.005, y: 0.03, e: 3 },
			]),
		),
		p.trim,
		[keel, 0, 0],
	);
	add(
		root,
		"explorer-port-nacelle",
		hullLoft(pod(0.0155, 0.037, 0.0044, { x: keel - 0.0156 })),
		p.panel,
	);
	engineBell(
		root,
		"explorer-port",
		[keel - 0.0156, 0, 0.041],
		0.0038,
		0.004,
		p,
	);
	engineBell(root, "explorer-core", [keel, 0, 0.0415], 0.0052, 0.0054, p);
	blister(root, "explorer-sensor", 0.0014, [keel + 0.003, 0.0046, -0.0075], p);
}

function buildExplorerC(root: THREE.Group, p: Palette) {
	add(
		root,
		"explorer-fuselage",
		hullLoft([
			{ z: -0.0285, w: 0.0032, h: 0.003, b: 0.003, e: 2.8 },
			{ z: -0.0235, w: 0.0056, h: 0.0052, b: 0.005, e: 3.4, hard: true },
			{ z: -0.0165, w: 0.0056, h: 0.0052, b: 0.005, e: 3.4, hard: true },
			{ z: -0.0145, w: 0.004, h: 0.0038, b: 0.0038, e: 3.2, hard: true },
			{ z: 0.021, w: 0.004, h: 0.0038, b: 0.0038, e: 3.2, hard: true },
			{ z: 0.0245, w: 0.0086, h: 0.0074, b: 0.007, e: 4.2, hard: true },
			{ z: 0.0365, w: 0.0086, h: 0.0074, b: 0.007, e: 4.2, hard: true },
			{ z: 0.0385, w: 0.0074, h: 0.0064, b: 0.006, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"explorer",
		[
			{ z: -0.0255, w: 0.0042, h: 0.002, b: 0.0022, y: 0.004, e: 3 },
			{ z: -0.0205, w: 0.0068, h: 0.0036, b: 0.0028, y: 0.0052, e: 3.4 },
			{ z: -0.0145, w: 0.0064, h: 0.0032, b: 0.0028, y: 0.0056, e: 3.4 },
			{ z: -0.0105, w: 0.0045, h: 0.002, b: 0.0022, y: 0.0052, e: 3 },
		],
		[
			{ z: -0.0245, w: 0.0028, h: 0.0014, b: 0.0015, y: 0.0053, e: 2.7 },
			{ z: -0.0205, w: 0.0048, h: 0.0028, b: 0.002, y: 0.0064, e: 3 },
			{ z: -0.0155, w: 0.0045, h: 0.0024, b: 0.0018, y: 0.0068, e: 3 },
			{ z: -0.0125, w: 0.0031, h: 0.0014, b: 0.0015, y: 0.0064, e: 2.7 },
		],
		p,
	);
	// The dish looks up and the habitat hangs down, so the keel between them
	// stays clear for the drives.
	add(
		root,
		"explorer-mast",
		strut([0, 0.0042, -0.0185], [0, 0.0168, -0.0205], 0.0022, 0.0016),
		p.trim,
	);
	dish(root, "explorer-dish", 0.0118, [0, 0.0192, -0.0205], p, [
		-Math.PI / 2.6,
		0,
		0,
	]);
	add(
		root,
		"explorer-habitat",
		revolve(drumProfile(0.0158, 0.0082)),
		p.panel,
		[0, -0.0124, 0.0015],
	);
	for (const band of [-0.008, 0.008])
		add(root, `explorer-hab-band-${band}`, hoop(0.0084, 0.0009), p.accent, [
			0,
			-0.0124,
			0.0015 + band,
		]);
	for (const [tag, cz] of [
		["fore", -0.0105],
		["aft", 0.0125],
	] as const)
		add(
			root,
			`explorer-hab-stay-${tag}`,
			strut([0, -0.0036, cz], [0, -0.0096, cz], 0.0018, 0.0015),
			p.trim,
		);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		fin(
			root,
			"explorer-radiator-" + side,
			[
				{ z: 0.0062, w: 0.0004, h: 0.0086, b: 0.0026, y: 0.0095, e: 2.2 },
				{ z: 0.0164, w: 0.0003, h: 0.0072, b: 0.002, y: 0.0135, e: 2.2 },
			],
			p,
			sign,
			[0, 0.0026, 0],
		);
		add(
			root,
			"explorer-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0042, w: 0.0026, h: 0.0064, b: 0.006, y: 0.0255, e: 3.2 },
					{ z: 0.0118, w: 0.0022, h: 0.0056, b: 0.0052, y: 0.0295, e: 3 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			"explorer-" + side + "-nacelle",
			hullLoft(pod(0.0175, 0.0365, 0.0042, { x: sign * 0.0142 })),
			p.panel,
		);
		engineBell(
			root,
			"explorer-" + side,
			[sign * 0.0142, 0, 0.0405],
			0.0036,
			0.0038,
			p,
		);
	}
	engineBell(root, "explorer-core", [0, 0, 0.041], 0.005, 0.0052, p);
	blister(root, "explorer-sensor", 0.0014, [0.003, 0.0044, -0.0125], p);
}

/**
 * A run of lit ports.
 *
 * Scale on a hull is read from the size of the smallest thing on it. A capital
 * ship needs something the eye already knows the size of — a window — repeated
 * often enough to divide the hull into decks.
 */
function portholes(
	root: THREE.Group,
	name: string,
	from: number,
	to: number,
	count: number,
	position: { x: number; y: number },
	radius: number,
	p: Palette,
) {
	for (let port = 0; port < count; port += 1) {
		const z = from + ((to - from) * port) / Math.max(1, count - 1);
		add(
			root,
			`${name}-${port}`,
			revolve(
				[
					[radius * 0.5, -radius * 0.5],
					[radius, -radius * 0.1],
					[radius * 0.6, radius * 0.35],
				],
				8,
			),
			p.canopy,
			[position.x, position.y, z],
			[Math.PI / 2, 0, 0],
		);
	}
}

/** Frame ribs at a regular pitch: the cheapest way to say "this thing is long". */
function ribs(
	root: THREE.Group,
	name: string,
	from: number,
	to: number,
	count: number,
	radius: number,
	tube: number,
	p: Palette,
	position: { x?: number; y?: number } = {},
) {
	for (let rib = 0; rib < count; rib += 1)
		add(root, `${name}-${rib}`, hoop(radius, tube), p.trim, [
			position.x ?? 0,
			position.y ?? 0,
			from + ((to - from) * rib) / Math.max(1, count - 1),
		]);
}

function buildRaiderA(root: THREE.Group, p: Palette) {
	add(
		root,
		"raider-fuselage",
		hullLoft([
			{ z: -0.0335, w: 0.001, h: 0.0008, b: 0.0008, e: 2.2 },
			{ z: -0.0285, w: 0.003, h: 0.0018, b: 0.002, e: 2.8 },
			{ z: -0.019, w: 0.0058, h: 0.003, b: 0.0033, e: 3.8 },
			{ z: -0.005, w: 0.0074, h: 0.0036, b: 0.0039, e: 4.6, hard: true },
			{ z: 0.008, w: 0.0072, h: 0.0035, b: 0.0038, e: 4.6, hard: true },
			{ z: 0.02, w: 0.0056, h: 0.0028, b: 0.0028, e: 3.6 },
			{ z: 0.029, w: 0.0038, h: 0.002, b: 0.0018, e: 2.8 },
		]),
		p.hull,
	);
	// A ram prow, offset: this hull was built to hit things that are not shooting
	// back, and nobody straightened it afterwards.
	add(
		root,
		"raider-ram",
		hullLoft([
			{ z: -0.0345, w: 0.0009, h: 0.0009, x: 0.0018, e: 1.6 },
			{ z: -0.0285, w: 0.0036, h: 0.0026, x: 0.0016, e: 1.8, hard: true },
			{ z: -0.019, w: 0.0044, h: 0.0031, x: 0.0012, e: 2 },
		]),
		p.trim,
	);
	canopy(
		root,
		"raider",
		[
			{ z: -0.0245, w: 0.0032, h: 0.0011, b: 0.0014, y: 0.0026, e: 2.8 },
			{ z: -0.0185, w: 0.0054, h: 0.0021, b: 0.0018, y: 0.0033, e: 3.2 },
			{ z: -0.012, w: 0.0052, h: 0.0019, b: 0.0018, y: 0.0037, e: 3.2 },
			{ z: -0.0075, w: 0.0035, h: 0.0012, b: 0.0014, y: 0.0037, e: 2.8 },
		],
		[
			{ z: -0.023, w: 0.0022, h: 0.0009, b: 0.001, y: 0.0036, e: 2.6 },
			{ z: -0.018, w: 0.0038, h: 0.0017, b: 0.0013, y: 0.004, e: 2.9 },
			{ z: -0.013, w: 0.0036, h: 0.0015, b: 0.0013, y: 0.0043, e: 2.9 },
			{ z: -0.01, w: 0.0024, h: 0.0009, b: 0.001, y: 0.0042, e: 2.6 },
		],
		p,
	);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		// Weapon rails carried outside the hull, unfaired, where they can be
		// swapped in an afternoon.
		add(
			root,
			"raider-rail-" + side,
			hullLoft(
				pod(-0.026, 0.002, 0.0015, { x: sign * 0.006, y: 0.0042, e: 2.6 }),
			),
			p.trim,
		);
		add(
			root,
			`raider-rail-brace-${side}`,
			strut(
				[sign * 0.0038, 0.0034, -0.008],
				[sign * 0.006, 0.0042, -0.0075],
				0.001,
				0.0009,
			),
			p.trim,
		);
		chine(
			root,
			"raider-chine-" + side,
			[
				{ z: -0.019, w: 0.001, h: 0.0006, x: 0.0056, e: 1.5 },
				{ z: -0.005, w: 0.0013, h: 0.0008, x: 0.0072, e: 1.5 },
				{ z: 0.008, w: 0.0012, h: 0.0007, x: 0.007, e: 1.5 },
				{ z: 0.02, w: 0.0009, h: 0.0005, x: 0.0054, e: 1.5 },
			],
			p,
			sign,
		);
		add(
			root,
			"raider-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0042, w: 0.0028, h: 0.0064, b: 0.006, y: 0.0135, e: 3.2 },
					{ z: 0.0106, w: 0.0024, h: 0.0056, b: 0.0052, y: 0.0175, e: 3 },
				],
				sign,
			),
			p.hull,
		);
		add(
			root,
			"raider-" + side + "-nacelle",
			hullLoft(pod(-0.001, 0.0255, 0.0042, { x: sign * 0.0122 })),
			p.panel,
		);
		add(root, "raider-collar-" + side, hoop(0.0045, 0.0005), p.accent, [
			sign * 0.0122,
			0,
			0.0195,
		]);
		engineBell(
			root,
			"raider-" + side,
			[sign * 0.0122, 0, 0.0285],
			0.0036,
			0.0038,
			p,
		);
	}
	greebleStrip(
		root,
		"raider-warpaint",
		[
			{ z: -0.014, w: 0.0022, h: 0.0006, y: 0.0038, e: 2.6 },
			{ z: 0.004, w: 0.0026, h: 0.0007, y: 0.0038, e: 2.6 },
			{ z: 0.016, w: 0.0018, h: 0.0005, y: 0.0034, e: 2.6 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "raider-sensor", 0.0012, [-0.0042, 0.0034, -0.0095], p);
}

function buildRaiderB(root: THREE.Group, p: Palette) {
	const keel = 0.0036;
	add(
		root,
		"raider-fuselage",
		hullLoft([
			{ z: -0.0315, w: 0.001, h: 0.0009, b: 0.0009, x: keel, e: 2.2 },
			{ z: -0.0265, w: 0.0032, h: 0.002, b: 0.0022, x: keel, e: 2.8 },
			{ z: -0.017, w: 0.0062, h: 0.0032, b: 0.0034, x: keel, e: 3.8 },
			{
				z: -0.004,
				w: 0.0078,
				h: 0.0037,
				b: 0.0039,
				x: keel,
				e: 4.6,
				hard: true,
			},
			{
				z: 0.009,
				w: 0.0076,
				h: 0.0036,
				b: 0.0038,
				x: keel,
				e: 4.6,
				hard: true,
			},
			{ z: 0.02, w: 0.0058, h: 0.0029, b: 0.0029, x: keel, e: 3.6 },
			{ z: 0.028, w: 0.004, h: 0.002, b: 0.0018, x: keel, e: 2.8 },
		]),
		p.hull,
	);
	canopy(
		root,
		"raider",
		[
			{
				z: -0.0235,
				w: 0.0032,
				h: 0.0011,
				b: 0.0014,
				x: keel,
				y: 0.0026,
				e: 2.8,
			},
			{
				z: -0.0175,
				w: 0.0054,
				h: 0.0021,
				b: 0.0018,
				x: keel,
				y: 0.0033,
				e: 3.2,
			},
			{
				z: -0.011,
				w: 0.0052,
				h: 0.0019,
				b: 0.0018,
				x: keel,
				y: 0.0037,
				e: 3.2,
			},
			{
				z: -0.0065,
				w: 0.0035,
				h: 0.0012,
				b: 0.0014,
				x: keel,
				y: 0.0037,
				e: 2.8,
			},
		],
		[
			{ z: -0.022, w: 0.0022, h: 0.0009, b: 0.001, x: keel, y: 0.0036, e: 2.6 },
			{ z: -0.017, w: 0.0038, h: 0.0017, b: 0.0013, x: keel, y: 0.004, e: 2.9 },
			{
				z: -0.012,
				w: 0.0036,
				h: 0.0015,
				b: 0.0013,
				x: keel,
				y: 0.0043,
				e: 2.9,
			},
			{ z: -0.009, w: 0.0024, h: 0.0009, b: 0.001, x: keel, y: 0.0042, e: 2.6 },
		],
		p,
	);
	// Somebody else's cargo pod, still wearing somebody else's paint, bolted to
	// port and balanced by an oversized drive to starboard.
	add(
		root,
		"raider-prize-pod",
		revolve(drumProfile(0.0138, 0.0074)),
		p.panel,
		[-0.0128, -0.0062, -0.0025],
	);
	for (const band of [-0.007, 0.007])
		add(root, `raider-prize-band-${band}`, hoop(0.0076, 0.0007), p.accent, [
			-0.0128,
			-0.0062,
			-0.0025 + band,
		]);
	for (const [tag, cz] of [
		["fore", -0.013],
		["aft", 0.008],
	] as const)
		add(
			root,
			`raider-prize-clamp-${tag}`,
			strut(
				[keel - 0.0042, -0.0012, cz],
				[-0.0128, -0.0062, cz],
				0.0015,
				0.0013,
			),
			p.trim,
		);
	add(
		root,
		"raider-nacelle-mount-starboard",
		blade([
			{ z: 0.0042, w: 0.0032, h: 0.007, b: 0.0066, y: 0.014, e: 3.2 },
			{ z: 0.0124, w: 0.0028, h: 0.0062, b: 0.0058, y: 0.0182, e: 3 },
		]),
		p.hull,
	);
	add(
		root,
		"raider-starboard-nacelle",
		hullLoft(pod(-0.005, 0.0265, 0.0052, { x: 0.0152 })),
		p.panel,
	);
	add(
		root,
		"raider-collar-starboard",
		hoop(0.0055, 0.0006),
		p.accent,
		[0.0152, 0, 0.02],
	);
	engineBell(root, "raider-starboard", [0.0152, 0, 0.0295], 0.0045, 0.0047, p);
	add(
		root,
		"raider-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.0158, w: 0.0015, h: 0.0038, b: 0.0036, y: 0.019, e: 2.8 },
				{ z: 0.0202, w: 0.0013, h: 0.0034, b: 0.0032, y: 0.0222, e: 2.8 },
			]),
		),
		p.trim,
	);
	add(
		root,
		"raider-port-nacelle",
		hullLoft(pod(0.012, 0.024, 0.0028, { x: -0.0178 })),
		p.panel,
	);
	engineBell(root, "raider-port", [-0.0178, 0, 0.0265], 0.0024, 0.0026, p);
	greebleStrip(
		root,
		"raider-warpaint",
		[
			{ z: -0.012, w: 0.002, h: 0.0006, x: keel, y: 0.0038, e: 2.6 },
			{ z: 0.006, w: 0.0024, h: 0.0007, x: keel, y: 0.0038, e: 2.6 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "raider-sensor", 0.0012, [keel + 0.0038, 0.0034, -0.0085], p);
}

function buildRaiderC(root: THREE.Group, p: Palette) {
	add(
		root,
		"raider-fuselage",
		hullLoft([
			{ z: -0.0305, w: 0.001, h: 0.0009, b: 0.0009, e: 2.2 },
			{ z: -0.0255, w: 0.0034, h: 0.0019, b: 0.0021, e: 2.8 },
			{ z: -0.016, w: 0.0072, h: 0.003, b: 0.0032, e: 3.8 },
			{ z: -0.003, w: 0.0092, h: 0.0034, b: 0.0036, e: 4.8, hard: true },
			{ z: 0.01, w: 0.009, h: 0.0033, b: 0.0035, e: 4.8, hard: true },
			{ z: 0.021, w: 0.0068, h: 0.0027, b: 0.0027, e: 3.6 },
			{ z: 0.029, w: 0.0046, h: 0.0019, b: 0.0017, e: 2.8 },
		]),
		p.hull,
	);
	canopy(
		root,
		"raider",
		[
			{ z: -0.0225, w: 0.0032, h: 0.0011, b: 0.0014, y: 0.0022, e: 2.8 },
			{ z: -0.0165, w: 0.0054, h: 0.0021, b: 0.0018, y: 0.0029, e: 3.2 },
			{ z: -0.01, w: 0.0052, h: 0.0019, b: 0.0018, y: 0.0033, e: 3.2 },
			{ z: -0.0055, w: 0.0035, h: 0.0012, b: 0.0014, y: 0.0033, e: 2.8 },
		],
		[
			{ z: -0.021, w: 0.0022, h: 0.0009, b: 0.001, y: 0.0032, e: 2.6 },
			{ z: -0.016, w: 0.0038, h: 0.0017, b: 0.0013, y: 0.0036, e: 2.9 },
			{ z: -0.011, w: 0.0036, h: 0.0015, b: 0.0013, y: 0.0039, e: 2.9 },
			{ z: -0.008, w: 0.0024, h: 0.0009, b: 0.001, y: 0.0038, e: 2.6 },
		],
		p,
	);
	// A grapple boom overhead and a snatch cradle below: this one takes the
	// cargo rather than the ship.
	add(
		root,
		"raider-grapple-boom",
		strut([0, 0.0034, -0.004], [0, 0.0104, -0.0245], 0.0022, 0.0015),
		p.trim,
	);
	add(
		root,
		"raider-grapple-ring",
		hoop(0.0046, 0.0011),
		p.accent,
		[0, 0.0112, -0.0275],
	);
	for (let claw = 0; claw < 3; claw += 1) {
		const angle = Math.PI / 2 + (claw / 3) * Math.PI * 2;
		add(
			root,
			`raider-claw-${claw}`,
			strut(
				[Math.cos(angle) * 0.0042, 0.0112 + Math.sin(angle) * 0.0042, -0.0275],
				[Math.cos(angle) * 0.0056, 0.0112 + Math.sin(angle) * 0.0056, -0.0325],
				0.0011,
				0.0006,
			),
			p.engine,
		);
	}
	add(
		root,
		"raider-snatch-cradle",
		blade([
			{ z: -0.0104, w: 0.0016, h: 0.0092, b: 0.0088, y: -0.0002, e: 3.4 },
			{ z: 0.0104, w: 0.0016, h: 0.0092, b: 0.0088, y: -0.0002, e: 3.4 },
		]),
		p.trim,
		[0, -0.0092, 0],
	);
	for (const [tag, cz] of [
		["fore", -0.008],
		["aft", 0.008],
	] as const)
		add(
			root,
			`raider-cradle-stay-${tag}`,
			strut([0, -0.0032, cz], [0, -0.0088, cz], 0.0016, 0.0013),
			p.trim,
		);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			"raider-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.005, w: 0.0028, h: 0.0064, b: 0.006, y: 0.0145, e: 3.2 },
					{ z: 0.0128, w: 0.0024, h: 0.0056, b: 0.0052, y: 0.0185, e: 3 },
				],
				sign,
			),
			p.hull,
		);
		add(
			root,
			"raider-" + side + "-nacelle",
			hullLoft(pod(0.0005, 0.0265, 0.0042, { x: sign * 0.015 })),
			p.panel,
		);
		engineBell(
			root,
			"raider-" + side,
			[sign * 0.015, 0, 0.0295],
			0.0036,
			0.0038,
			p,
		);
	}
	greebleStrip(
		root,
		"raider-warpaint",
		[
			{ z: -0.01, w: 0.0024, h: 0.0006, y: 0.0034, e: 2.6 },
			{ z: 0.008, w: 0.0028, h: 0.0007, y: 0.0034, e: 2.6 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "raider-sensor", 0.0012, [0.005, 0.003, -0.0075], p);
}

/**
 * Capital hulls.
 *
 * Size is relative, and nothing in a starfield gives the eye an absolute ruler.
 * What makes one of these read as enormous is not its numbers but the count of
 * things on it that are obviously small: rib frames at a fixed pitch, rows of
 * lit ports, a bay mouth a courier could fly into. The three concepts differ on
 * the same layout axes as the rest of the pool — paired, asymmetric, stacked —
 * so a capital ship is a class rather than a scale trick.
 */
function buildCarrierA(root: THREE.Group, p: Palette) {
	add(
		root,
		"carrier-fuselage",
		hullLoft([
			{ z: -0.185, w: 0.012, h: 0.011, b: 0.011, e: 3 },
			{ z: -0.166, w: 0.032, h: 0.026, b: 0.027, e: 3.6, hard: true },
			{ z: -0.118, w: 0.05, h: 0.036, b: 0.038, e: 4.4, hard: true },
			{ z: 0.02, w: 0.056, h: 0.039, b: 0.041, e: 4.8, hard: true },
			{ z: 0.118, w: 0.052, h: 0.037, b: 0.038, e: 4.6, hard: true },
			{ z: 0.166, w: 0.038, h: 0.03, b: 0.031, e: 3.8 },
			{ z: 0.186, w: 0.026, h: 0.022, b: 0.022, e: 3 },
		]),
		p.hull,
	);
	// The flight deck is a separate slab so its edge reads as a lip a ship lands
	// over, not as more hull.
	add(
		root,
		"carrier-flight-deck",
		hullLoft([
			{ z: -0.148, w: 0.03, h: 0.005, b: 0.004, y: 0.042, e: 4 },
			{ z: -0.108, w: 0.044, h: 0.0062, b: 0.0048, y: 0.044, e: 5, hard: true },
			{ z: 0.098, w: 0.044, h: 0.0062, b: 0.0048, y: 0.044, e: 5, hard: true },
			{ z: 0.138, w: 0.03, h: 0.005, b: 0.004, y: 0.042, e: 4 },
		]),
		p.panel,
	);
	add(
		root,
		"carrier-bay-mouth",
		hullLoft([
			{ z: -0.168, w: 0.026, h: 0.014, b: 0.014, y: -0.004, e: 4 },
			{ z: -0.132, w: 0.03, h: 0.016, b: 0.016, y: -0.004, e: 4.4 },
		]),
		p.canopy,
	);
	add(
		root,
		"carrier-bay-lip",
		hoop(0.031, 0.0035),
		p.accent,
		[0, -0.004, -0.166],
	);
	bridge(
		root,
		"carrier",
		[
			{ z: -0.09, w: 0.014, h: 0.008, b: 0.009, y: 0.062, e: 3.4 },
			{ z: -0.072, w: 0.022, h: 0.013, b: 0.011, y: 0.068, e: 4 },
			{ z: -0.048, w: 0.021, h: 0.012, b: 0.011, y: 0.07, e: 4 },
			{ z: -0.032, w: 0.015, h: 0.008, b: 0.009, y: 0.068, e: 3.4 },
		],
		[
			{ z: -0.086, w: 0.0098, h: 0.0056, b: 0.006, y: 0.0685, e: 3 },
			{ z: -0.072, w: 0.0158, h: 0.0102, b: 0.0078, y: 0.0742, e: 3.4 },
			{ z: -0.054, w: 0.0148, h: 0.009, b: 0.0072, y: 0.0764, e: 3.4 },
			{ z: -0.042, w: 0.0104, h: 0.0056, b: 0.006, y: 0.0742, e: 3 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.082],
		["aft", -0.04],
	] as const)
		add(
			root,
			`carrier-island-leg-${tag}`,
			strut([0, 0.044, cz], [0, 0.062, cz], 0.009, 0.0075),
			p.trim,
		);
	ribs(root, "carrier-rib", -0.104, 0.104, 9, 0.057, 0.0026, p);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		portholes(
			root,
			"carrier-row-" + side,
			-0.1,
			0.098,
			22,
			{ x: sign * 0.0555, y: 0.016 },
			0.0042,
			p,
		);
		portholes(
			root,
			"carrier-lower-row-" + side,
			-0.09,
			0.088,
			18,
			{ x: sign * 0.0545, y: -0.014 },
			0.0036,
			p,
		);
		add(
			root,
			"carrier-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.03, w: 0.014, h: 0.032, b: 0.03, y: 0.12, e: 3.4 },
					{ z: 0.062, w: 0.012, h: 0.028, b: 0.026, y: 0.142, e: 3.2 },
				],
				sign,
			),
			p.hull,
		);
		for (const [tier, cy] of [
			["upper", 0.016],
			["lower", -0.016],
		] as const) {
			const name =
				tier === "upper"
					? "carrier-" + side + "-nacelle"
					: `carrier-${side}-${tier}-nacelle`;
			add(
				root,
				name,
				hullLoft(pod(0.086, 0.176, 0.017, { x: sign * 0.068, y: cy })),
				p.panel,
			);
			add(
				root,
				`carrier-collar-${side}-${tier}`,
				hoop(0.018, 0.0022),
				p.accent,
				[sign * 0.068, cy, 0.15],
			);
			engineBell(
				root,
				`carrier-${side}-${tier}`,
				[sign * 0.068, cy, 0.19],
				0.0148,
				0.0155,
				p,
			);
		}
	}
	engineBell(root, "carrier-core-upper", [0, 0.016, 0.192], 0.019, 0.02, p);
	engineBell(root, "carrier-core-lower", [0, -0.016, 0.192], 0.019, 0.02, p);
	greebleStrip(
		root,
		"carrier-deck-stripe",
		[
			{ z: -0.1, w: 0.004, h: 0.0011, y: 0.0492, e: 2.4 },
			{ z: 0.09, w: 0.004, h: 0.0011, y: 0.0492, e: 2.4 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "carrier-sensor", 0.0072, [0.026, 0.0472, -0.126], p);
}

function buildCarrierB(root: THREE.Group, p: Palette) {
	const keel = -0.03;
	add(
		root,
		"carrier-fuselage",
		hullLoft([
			{ z: -0.178, w: 0.011, h: 0.011, b: 0.011, x: keel, e: 3 },
			{
				z: -0.158,
				w: 0.026,
				h: 0.024,
				b: 0.024,
				x: keel,
				e: 3.6,
				hard: true,
			},
			{
				z: -0.116,
				w: 0.032,
				h: 0.03,
				b: 0.03,
				x: keel,
				e: 4,
				hard: true,
			},
			{ z: 0.104, w: 0.032, h: 0.03, b: 0.03, x: keel, e: 4, hard: true },
			{
				z: 0.128,
				w: 0.048,
				h: 0.04,
				b: 0.04,
				x: keel,
				e: 4.6,
				hard: true,
			},
			{ z: 0.174, w: 0.048, h: 0.04, b: 0.04, x: keel, e: 4.6, hard: true },
			{ z: 0.184, w: 0.04, h: 0.034, b: 0.034, x: keel, e: 3.6 },
		]),
		p.hull,
	);
	// One vast hangar block to starboard. The command tower rides the port keel
	// beside it, which is why the ship looks like it was assembled around the bay
	// rather than around the crew.
	add(
		root,
		"carrier-hangar-block",
		blade([
			{ z: 0.004, w: 0.046, h: 0.148, b: 0.146, y: -0.012, e: 4.6 },
			{ z: 0.052, w: 0.045, h: 0.146, b: 0.144, y: -0.006, e: 4.8 },
			{ z: 0.086, w: 0.038, h: 0.126, b: 0.124, y: 0.008, e: 4.4 },
		]),
		p.hull,
	);
	add(
		root,
		"carrier-bay-mouth",
		hullLoft([
			{ z: -0.162, w: 0.03, h: 0.02, b: 0.02, x: 0.044, e: 4.2 },
			{ z: -0.126, w: 0.034, h: 0.023, b: 0.023, x: 0.044, e: 4.6 },
		]),
		p.canopy,
	);
	add(root, "carrier-bay-lip", hoop(0.035, 0.004), p.accent, [0.044, 0, -0.16]);
	bridge(
		root,
		"carrier",
		[
			{ z: -0.108, w: 0.014, h: 0.008, b: 0.009, x: keel, y: 0.046, e: 3.4 },
			{ z: -0.09, w: 0.022, h: 0.013, b: 0.011, x: keel, y: 0.052, e: 4 },
			{ z: -0.066, w: 0.021, h: 0.012, b: 0.011, x: keel, y: 0.054, e: 4 },
			{ z: -0.05, w: 0.015, h: 0.008, b: 0.009, x: keel, y: 0.052, e: 3.4 },
		],
		[
			{ z: -0.104, w: 0.0098, h: 0.0056, b: 0.006, x: keel, y: 0.0465, e: 3 },
			{ z: -0.09, w: 0.0158, h: 0.0102, b: 0.0078, x: keel, y: 0.0522, e: 3.4 },
			{ z: -0.072, w: 0.0148, h: 0.009, b: 0.0072, x: keel, y: 0.0544, e: 3.4 },
			{ z: -0.06, w: 0.0104, h: 0.0056, b: 0.006, x: keel, y: 0.0522, e: 3 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.1],
		["aft", -0.058],
	] as const)
		add(
			root,
			`carrier-tower-leg-${tag}`,
			strut([keel, 0.026, cz], [keel, 0.046, cz], 0.009, 0.0075),
			p.trim,
		);
	ribs(root, "carrier-rib", -0.096, 0.086, 8, 0.033, 0.0024, p, { x: keel });
	portholes(
		root,
		"carrier-block-row",
		-0.09,
		0.088,
		20,
		{ x: 0.09, y: 0.024 },
		0.0042,
		p,
	);
	portholes(
		root,
		"carrier-keel-row",
		-0.086,
		0.08,
		16,
		{ x: keel - 0.0325, y: 0.008 },
		0.0036,
		p,
	);
	add(
		root,
		"carrier-nacelle-mount-starboard",
		blade([
			{ z: 0.052, w: 0.014, h: 0.03, b: 0.028, y: 0.116, e: 3.4 },
			{ z: 0.082, w: 0.012, h: 0.026, b: 0.024, y: 0.138, e: 3.2 },
		]),
		p.trim,
	);
	add(
		root,
		"carrier-starboard-nacelle",
		hullLoft(pod(0.09, 0.174, 0.017, { x: 0.088 })),
		p.panel,
	);
	engineBell(root, "carrier-starboard", [0.088, 0, 0.188], 0.0148, 0.0155, p);
	add(
		root,
		"carrier-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.03, w: 0.013, h: 0.028, b: 0.026, y: 0.098, e: 3.4 },
				{ z: 0.058, w: 0.011, h: 0.024, b: 0.022, y: 0.118, e: 3.2 },
			]),
		),
		p.trim,
		[keel, 0, 0],
	);
	add(
		root,
		"carrier-port-nacelle",
		hullLoft(pod(0.086, 0.172, 0.015, { x: keel - 0.062 })),
		p.panel,
	);
	engineBell(root, "carrier-port", [keel - 0.062, 0, 0.186], 0.013, 0.0136, p);
	engineBell(root, "carrier-core", [keel, 0, 0.19], 0.021, 0.022, p);
	blister(root, "carrier-sensor", 0.0072, [keel, 0.032, -0.13], p);
}

function buildCarrierC(root: THREE.Group, p: Palette) {
	const deck = 0.028;
	add(
		root,
		"carrier-fuselage",
		hullLoft([
			{ z: -0.182, w: 0.012, h: 0.011, b: 0.011, y: deck, e: 3 },
			{
				z: -0.162,
				w: 0.028,
				h: 0.024,
				b: 0.024,
				y: deck,
				e: 3.6,
				hard: true,
			},
			{ z: -0.118, w: 0.038, h: 0.03, b: 0.03, y: deck, e: 4.2, hard: true },
			{ z: 0.108, w: 0.038, h: 0.03, b: 0.03, y: deck, e: 4.2, hard: true },
			{ z: 0.132, w: 0.054, h: 0.04, b: 0.04, y: deck, e: 4.8, hard: true },
			{ z: 0.176, w: 0.054, h: 0.04, b: 0.04, y: deck, e: 4.8, hard: true },
			{ z: 0.186, w: 0.044, h: 0.034, b: 0.034, y: deck, e: 3.6 },
		]),
		p.hull,
	);
	// The bay is a deep keel hung under the spine, open along its length, and the
	// tower sits above it where the view is clear over the bow.
	add(
		root,
		"carrier-hangar-keel",
		hullLoft([
			{ z: -0.144, w: 0.03, h: 0.024, b: 0.026, y: -0.05, e: 4 },
			{
				z: -0.108,
				w: 0.042,
				h: 0.034,
				b: 0.036,
				y: -0.054,
				e: 4.8,
				hard: true,
			},
			{
				z: 0.086,
				w: 0.042,
				h: 0.034,
				b: 0.036,
				y: -0.054,
				e: 4.8,
				hard: true,
			},
			{ z: 0.122, w: 0.03, h: 0.024, b: 0.026, y: -0.05, e: 4 },
		]),
		p.panel,
	);
	add(
		root,
		"carrier-bay-mouth",
		hullLoft([
			{ z: -0.156, w: 0.024, h: 0.018, b: 0.02, y: -0.052, e: 4.2 },
			{ z: -0.124, w: 0.028, h: 0.021, b: 0.023, y: -0.052, e: 4.6 },
		]),
		p.canopy,
	);
	add(
		root,
		"carrier-bay-lip",
		hoop(0.03, 0.0035),
		p.accent,
		[0, -0.052, -0.154],
	);
	for (const [tag, cz] of [
		["fore", -0.096],
		["mid", -0.006],
		["aft", 0.078],
	] as const)
		add(
			root,
			`carrier-keel-stay-${tag}`,
			strut([0, deck - 0.026, cz], [0, -0.026, cz], 0.011, 0.0092),
			p.trim,
		);
	bridge(
		root,
		"carrier",
		[
			{ z: -0.11, w: 0.014, h: 0.008, b: 0.009, y: deck + 0.042, e: 3.4 },
			{ z: -0.092, w: 0.022, h: 0.013, b: 0.011, y: deck + 0.048, e: 4 },
			{ z: -0.068, w: 0.021, h: 0.012, b: 0.011, y: deck + 0.05, e: 4 },
			{ z: -0.052, w: 0.015, h: 0.008, b: 0.009, y: deck + 0.048, e: 3.4 },
		],
		[
			{ z: -0.106, w: 0.0098, h: 0.0056, b: 0.006, y: deck + 0.0425, e: 3 },
			{ z: -0.092, w: 0.0158, h: 0.0102, b: 0.0078, y: deck + 0.0482, e: 3.4 },
			{ z: -0.074, w: 0.0148, h: 0.009, b: 0.0072, y: deck + 0.0504, e: 3.4 },
			{ z: -0.062, w: 0.0104, h: 0.0056, b: 0.006, y: deck + 0.0482, e: 3 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.102],
		["aft", -0.06],
	] as const)
		add(
			root,
			`carrier-tower-leg-${tag}`,
			strut([0, deck + 0.024, cz], [0, deck + 0.042, cz], 0.009, 0.0075),
			p.trim,
		);
	ribs(root, "carrier-rib", -0.1, 0.094, 9, 0.039, 0.0026, p, { y: deck });
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		portholes(
			root,
			"carrier-spine-row-" + side,
			-0.098,
			0.096,
			20,
			{ x: sign * 0.0385, y: deck + 0.012 },
			0.004,
			p,
		);
		portholes(
			root,
			"carrier-bay-row-" + side,
			-0.09,
			0.07,
			16,
			{ x: sign * 0.0425, y: -0.042 },
			0.0036,
			p,
		);
		add(
			root,
			"carrier-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.036, w: 0.014, h: 0.03, b: 0.028, y: 0.104, e: 3.4 },
					{ z: 0.066, w: 0.012, h: 0.026, b: 0.024, y: 0.126, e: 3.2 },
				],
				sign,
			),
			p.trim,
			[0, deck, 0],
		);
		add(
			root,
			"carrier-" + side + "-nacelle",
			hullLoft(pod(0.092, 0.176, 0.0165, { x: sign * 0.072, y: deck })),
			p.panel,
		);
		add(root, "carrier-collar-" + side, hoop(0.0175, 0.0022), p.accent, [
			sign * 0.072,
			deck,
			0.152,
		]);
		engineBell(
			root,
			"carrier-" + side,
			[sign * 0.072, deck, 0.19],
			0.0142,
			0.0148,
			p,
		);
	}
	engineBell(root, "carrier-core", [0, deck, 0.192], 0.022, 0.023, p);
	blister(root, "carrier-sensor", 0.0072, [0.022, deck + 0.026, -0.132], p);
}

/**
 * A gun mount: a barbette standing on the deck with barrels over the bow.
 *
 * Rows of these are what separate a battle line from a hangar ship at a glance,
 * and like the porthole rows they double as a ruler — a turret is a known size,
 * so a hull carrying eleven of them reads as eleven turrets long.
 */
function turret(
	root: THREE.Group,
	name: string,
	radius: number,
	position: [number, number, number],
	p: Palette,
	sign: 1 | -1 = 1,
) {
	add(
		root,
		name + "-barbette",
		revolve(drumProfile(radius * 0.55, radius)),
		p.panel,
		position,
		[Math.PI / 2, 0, 0],
	);
	add(root, name + "-ring", hoop(radius * 1.02, radius * 0.12), p.trim, [
		position[0],
		position[1] - radius * 0.5 * sign,
		position[2],
	]);
	for (const offset of [-radius * 0.34, radius * 0.34])
		add(
			root,
			`${name}-barrel${offset < 0 ? "-port" : "-starboard"}`,
			strut(
				[position[0] + offset, position[1] + radius * 0.35 * sign, position[2]],
				[
					position[0] + offset,
					position[1] + radius * 0.35 * sign,
					position[2] - radius * 3.2,
				],
				radius * 0.19,
				radius * 0.14,
			),
			p.trim,
		);
}

/** A tow or salvage hook on the end of a boom. */
function hook(
	root: THREE.Group,
	name: string,
	radius: number,
	position: [number, number, number],
	p: Palette,
) {
	add(root, name + "-ring", hoop(radius, radius * 0.22), p.accent, position);
	for (let claw = 0; claw < 3; claw += 1) {
		const angle = Math.PI / 2 + (claw / 3) * Math.PI * 2;
		add(
			root,
			`${name}-claw-${claw}`,
			strut(
				[
					position[0] + Math.cos(angle) * radius,
					position[1] + Math.sin(angle) * radius,
					position[2],
				],
				[
					position[0] + Math.cos(angle) * radius * 1.28,
					position[1] + Math.sin(angle) * radius * 1.28,
					position[2] - radius * 1.1,
				],
				radius * 0.22,
				radius * 0.1,
			),
			p.engine,
		);
	}
}

function buildTugA(root: THREE.Group, p: Palette) {
	add(
		root,
		"tug-fuselage",
		hullLoft([
			{ z: -0.0245, w: 0.0042, h: 0.0038, b: 0.0038, e: 3 },
			{ z: -0.0205, w: 0.0076, h: 0.0062, b: 0.0064, e: 3.6, hard: true },
			{ z: -0.008, w: 0.0092, h: 0.0074, b: 0.0076, e: 4.4, hard: true },
			{ z: 0.011, w: 0.009, h: 0.0072, b: 0.0074, e: 4.4, hard: true },
			{ z: 0.021, w: 0.0072, h: 0.006, b: 0.006, e: 3.6 },
			{ z: 0.0265, w: 0.005, h: 0.0044, b: 0.0044, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"tug",
		[
			{ z: -0.0205, w: 0.0036, h: 0.0014, b: 0.0016, y: 0.0056, e: 2.8 },
			{ z: -0.0155, w: 0.0058, h: 0.0025, b: 0.002, y: 0.0068, e: 3.2 },
			{ z: -0.0095, w: 0.0055, h: 0.0023, b: 0.002, y: 0.0074, e: 3.2 },
			{ z: -0.006, w: 0.0038, h: 0.0014, b: 0.0016, y: 0.0068, e: 2.8 },
		],
		[
			{ z: -0.019, w: 0.0025, h: 0.0011, b: 0.0012, y: 0.0068, e: 2.6 },
			{ z: -0.015, w: 0.0042, h: 0.002, b: 0.0015, y: 0.0077, e: 2.9 },
			{ z: -0.0105, w: 0.0039, h: 0.0017, b: 0.0014, y: 0.0082, e: 2.9 },
			{ z: -0.008, w: 0.0026, h: 0.0011, b: 0.0012, y: 0.008, e: 2.6 },
		],
		p,
	);
	// The yoke is the working end: an open ring the tug backs onto a hull.
	add(
		root,
		"tug-yoke-ring",
		hoop(0.0092, 0.0015),
		p.hull,
		[0, -0.0022, -0.0272],
	);
	add(
		root,
		"tug-yoke-liner",
		hoop(0.0092, 0.0009),
		p.accent,
		[0, -0.0022, -0.0268],
	);
	for (let arm = 0; arm < 4; arm += 1) {
		const angle = Math.PI / 4 + (arm / 4) * Math.PI * 2;
		add(
			root,
			`tug-yoke-arm-${arm}`,
			strut(
				[Math.cos(angle) * 0.0026, -0.0022 + Math.sin(angle) * 0.0026, -0.0185],
				[Math.cos(angle) * 0.009, -0.0022 + Math.sin(angle) * 0.009, -0.0265],
				0.0014,
				0.0011,
			),
			p.trim,
		);
	}
	add(
		root,
		"tug-winch-drum",
		revolve(drumProfile(0.0056, 0.0034)),
		p.panel,
		[0, 0.0092, 0.006],
		[0, Math.PI / 2, 0],
	);
	for (const [tag, cx] of [
		["port", -0.0048],
		["starboard", 0.0048],
	] as const)
		add(
			root,
			`tug-winch-stand-${tag}`,
			strut([cx, 0.0064, 0.006], [cx, 0.0092, 0.006], 0.0016, 0.0013),
			p.trim,
		);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		// Almost all of a tug is engine. The pods are deliberately oversized for
		// the hull they are bolted to, which is the whole read of the class.
		add(
			root,
			"tug-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0064, w: 0.0038, h: 0.0086, b: 0.0082, y: 0.004, e: 3.6 },
					{ z: 0.0112, w: 0.0034, h: 0.0078, b: 0.0074, y: 0.0062, e: 3.4 },
				],
				sign,
			),
			p.hull,
		);
		add(
			root,
			"tug-" + side + "-nacelle",
			hullLoft(pod(-0.0135, 0.0245, 0.0068, { x: sign * 0.0148 })),
			p.panel,
		);
		for (const band of [-0.006, 0.012])
			add(root, `tug-collar-${side}-${band}`, hoop(0.0072, 0.0008), p.accent, [
				sign * 0.0148,
				0,
				band,
			]);
		engineBell(
			root,
			"tug-" + side,
			[sign * 0.0148, 0, 0.029],
			0.0058,
			0.006,
			p,
		);
	}
	greebleStrip(
		root,
		"tug-hazard",
		[
			{ z: -0.012, w: 0.0028, h: 0.0007, y: 0.0074, e: 2.6 },
			{ z: 0.008, w: 0.003, h: 0.0007, y: 0.0072, e: 2.6 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "tug-sensor", 0.0016, [0.0044, 0.0068, -0.0055], p);
}

function buildTugB(root: THREE.Group, p: Palette) {
	const keel = 0.0034;
	add(
		root,
		"tug-fuselage",
		hullLoft([
			{ z: -0.0235, w: 0.004, h: 0.0036, b: 0.0036, x: keel, e: 3 },
			{
				z: -0.0195,
				w: 0.0072,
				h: 0.0058,
				b: 0.006,
				x: keel,
				e: 3.6,
				hard: true,
			},
			{
				z: -0.007,
				w: 0.0086,
				h: 0.007,
				b: 0.0072,
				x: keel,
				e: 4.4,
				hard: true,
			},
			{ z: 0.012, w: 0.0084, h: 0.0068, b: 0.007, x: keel, e: 4.4, hard: true },
			{ z: 0.022, w: 0.0068, h: 0.0056, b: 0.0056, x: keel, e: 3.6 },
			{ z: 0.0275, w: 0.0046, h: 0.0042, b: 0.0042, x: keel, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"tug",
		[
			{
				z: -0.0195,
				w: 0.0036,
				h: 0.0014,
				b: 0.0016,
				x: keel,
				y: 0.0052,
				e: 2.8,
			},
			{
				z: -0.0145,
				w: 0.0058,
				h: 0.0025,
				b: 0.002,
				x: keel,
				y: 0.0064,
				e: 3.2,
			},
			{ z: -0.0085, w: 0.0055, h: 0.0023, b: 0.002, x: keel, y: 0.007, e: 3.2 },
			{
				z: -0.005,
				w: 0.0038,
				h: 0.0014,
				b: 0.0016,
				x: keel,
				y: 0.0064,
				e: 2.8,
			},
		],
		[
			{
				z: -0.018,
				w: 0.0025,
				h: 0.0011,
				b: 0.0012,
				x: keel,
				y: 0.0064,
				e: 2.6,
			},
			{ z: -0.014, w: 0.0042, h: 0.002, b: 0.0015, x: keel, y: 0.0073, e: 2.9 },
			{
				z: -0.0095,
				w: 0.0039,
				h: 0.0017,
				b: 0.0014,
				x: keel,
				y: 0.0078,
				e: 2.9,
			},
			{
				z: -0.007,
				w: 0.0026,
				h: 0.0011,
				b: 0.0012,
				x: keel,
				y: 0.0076,
				e: 2.6,
			},
		],
		p,
	);
	// A crane arm swung out to port, and a single oversized drive to starboard
	// to carry the load it brings back.
	add(
		root,
		"tug-crane-mast",
		strut(
			[keel - 0.004, 0.0026, 0.0055],
			[-0.0086, 0.0104, 0.002],
			0.0026,
			0.002,
		),
		p.trim,
	);
	add(
		root,
		"tug-crane-jib",
		strut([-0.0086, 0.0104, 0.002], [-0.0158, 0.0092, -0.0195], 0.002, 0.0014),
		p.trim,
	);
	hook(root, "tug-grapnel", 0.0038, [-0.0158, 0.0088, -0.0225], p);
	add(
		root,
		"tug-nacelle-mount-starboard",
		blade([
			{ z: 0.0062, w: 0.004, h: 0.009, b: 0.0086, y: 0.0045, e: 3.6 },
			{ z: 0.0116, w: 0.0036, h: 0.0082, b: 0.0078, y: 0.0068, e: 3.4 },
		]),
		p.hull,
	);
	add(
		root,
		"tug-starboard-nacelle",
		hullLoft(pod(-0.0145, 0.025, 0.0072, { x: 0.0152 })),
		p.panel,
	);
	for (const band of [-0.007, 0.012])
		add(root, `tug-collar-starboard-${band}`, hoop(0.0076, 0.0008), p.accent, [
			0.0152,
			0,
			band,
		]);
	engineBell(root, "tug-starboard", [0.0152, 0, 0.0295], 0.0062, 0.0064, p);
	add(
		root,
		"tug-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.0058, w: 0.0022, h: 0.0048, b: 0.0046, y: 0.0072, e: 3 },
				{ z: 0.0098, w: 0.002, h: 0.0042, b: 0.004, y: 0.0092, e: 2.8 },
			]),
		),
		p.trim,
		[keel, 0, 0],
	);
	add(
		root,
		"tug-port-nacelle",
		hullLoft(pod(-0.0025, 0.0235, 0.0038, { x: keel - 0.0128 })),
		p.panel,
	);
	engineBell(root, "tug-port", [keel - 0.0128, 0, 0.027], 0.0033, 0.0035, p);
	greebleStrip(
		root,
		"tug-hazard",
		[
			{ z: -0.01, w: 0.0026, h: 0.0007, x: keel, y: 0.007, e: 2.6 },
			{ z: 0.01, w: 0.0028, h: 0.0007, x: keel, y: 0.0068, e: 2.6 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "tug-sensor", 0.0016, [keel + 0.004, 0.0064, -0.0045], p);
}

function buildTugC(root: THREE.Group, p: Palette) {
	const deck = 0.0042;
	add(
		root,
		"tug-fuselage",
		hullLoft([
			{ z: -0.0235, w: 0.0044, h: 0.0036, b: 0.0036, y: deck, e: 3 },
			{
				z: -0.0195,
				w: 0.0078,
				h: 0.0058,
				b: 0.006,
				y: deck,
				e: 3.6,
				hard: true,
			},
			{
				z: -0.007,
				w: 0.0092,
				h: 0.0068,
				b: 0.007,
				y: deck,
				e: 4.4,
				hard: true,
			},
			{ z: 0.012, w: 0.009, h: 0.0066, b: 0.0068, y: deck, e: 4.4, hard: true },
			{ z: 0.022, w: 0.0072, h: 0.0054, b: 0.0054, y: deck, e: 3.6 },
			{ z: 0.0275, w: 0.005, h: 0.004, b: 0.004, y: deck, e: 3 },
		]),
		p.hull,
	);
	canopy(
		root,
		"tug",
		[
			{ z: -0.0195, w: 0.0036, h: 0.0014, b: 0.0016, y: deck + 0.005, e: 2.8 },
			{ z: -0.0145, w: 0.0058, h: 0.0025, b: 0.002, y: deck + 0.0062, e: 3.2 },
			{ z: -0.0085, w: 0.0055, h: 0.0023, b: 0.002, y: deck + 0.0068, e: 3.2 },
			{ z: -0.005, w: 0.0038, h: 0.0014, b: 0.0016, y: deck + 0.0062, e: 2.8 },
		],
		[
			{ z: -0.018, w: 0.0025, h: 0.0011, b: 0.0012, y: deck + 0.0062, e: 2.6 },
			{ z: -0.014, w: 0.0042, h: 0.002, b: 0.0015, y: deck + 0.0071, e: 2.9 },
			{ z: -0.0095, w: 0.0039, h: 0.0017, b: 0.0014, y: deck + 0.0076, e: 2.9 },
			{ z: -0.007, w: 0.0026, h: 0.0011, b: 0.0012, y: deck + 0.0074, e: 2.6 },
		],
		p,
	);
	// Winch gantry over the deck, tow hook under the keel: the load passes
	// through the ship rather than beside it.
	for (const [tag, cz] of [
		["fore", -0.0075],
		["aft", 0.0105],
	] as const)
		add(
			root,
			`tug-gantry-${tag}`,
			strut([0, deck + 0.0058, cz], [0, deck + 0.0128, cz], 0.0022, 0.0018),
			p.trim,
		);
	add(
		root,
		"tug-winch-drum",
		revolve(drumProfile(0.0068, 0.0038)),
		p.panel,
		[0, deck + 0.0136, 0.0015],
		[0, Math.PI / 2, 0],
	);
	add(
		root,
		"tug-hook-boom",
		strut([0, deck - 0.0062, -0.006], [0, -0.0102, -0.019], 0.0028, 0.002),
		p.trim,
	);
	hook(root, "tug-tow", 0.0042, [0, -0.0112, -0.0215], p);
	for (const [name, sign] of [
		["upper", 1],
		["lower", -1],
	] as const) {
		const boom = deck + sign * 0.0102;
		for (const [side, sx] of [
			["starboard", 0.0092],
			["port", -0.0092],
		] as const) {
			for (const [tag, cz] of [
				["fore", -0.004],
				["aft", 0.0135],
			] as const)
				add(
					root,
					`tug-nacelle-mount-${name}-${side}-${tag}`,
					strut(
						[sx * 0.42, deck + sign * 0.003, cz],
						[sx, boom, cz],
						0.0018,
						0.0015,
					),
					p.trim,
				);
			add(
				root,
				`tug-${side}-${name}-nacelle`,
				hullLoft(pod(-0.0085, 0.0235, 0.0044, { x: sx, y: boom })),
				p.panel,
			);
			engineBell(
				root,
				`tug-${side}-${name}`,
				[sx, boom, 0.0275],
				0.0038,
				0.004,
				p,
			);
		}
	}
	greebleStrip(
		root,
		"tug-hazard",
		[
			{ z: -0.01, w: 0.0028, h: 0.0007, y: deck + 0.0068, e: 2.6 },
			{ z: 0.01, w: 0.003, h: 0.0007, y: deck + 0.0066, e: 2.6 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "tug-sensor", 0.0016, [0.0042, deck + 0.0062, -0.0045], p);
}

function buildProspectorA(root: THREE.Group, p: Palette) {
	add(
		root,
		"prospector-fuselage",
		hullLoft([
			{ z: -0.029, w: 0.0016, h: 0.0016, b: 0.0016, e: 2.6 },
			{ z: -0.0245, w: 0.0042, h: 0.004, b: 0.0039, e: 3.2, hard: true },
			{ z: -0.018, w: 0.0042, h: 0.004, b: 0.0039, e: 3.2, hard: true },
			{ z: -0.016, w: 0.003, h: 0.0029, b: 0.0029, e: 3, hard: true },
			{ z: 0.014, w: 0.003, h: 0.0029, b: 0.0029, e: 3, hard: true },
			{ z: 0.017, w: 0.0064, h: 0.0056, b: 0.0054, e: 4, hard: true },
			{ z: 0.027, w: 0.0064, h: 0.0056, b: 0.0054, e: 4, hard: true },
			{ z: 0.0295, w: 0.0054, h: 0.0048, b: 0.0046, e: 3.2 },
		]),
		p.hull,
	);
	canopy(
		root,
		"prospector",
		[
			{ z: -0.0265, w: 0.003, h: 0.0013, b: 0.0015, y: 0.0034, e: 2.8 },
			{ z: -0.0225, w: 0.005, h: 0.0025, b: 0.0019, y: 0.0044, e: 3.2 },
			{ z: -0.0175, w: 0.0047, h: 0.0022, b: 0.0019, y: 0.0049, e: 3.2 },
			{ z: -0.0145, w: 0.0032, h: 0.0013, b: 0.0015, y: 0.0044, e: 2.8 },
		],
		[
			{ z: -0.0255, w: 0.0021, h: 0.001, b: 0.0011, y: 0.0044, e: 2.6 },
			{ z: -0.022, w: 0.0036, h: 0.002, b: 0.0014, y: 0.005, e: 2.9 },
			{ z: -0.018, w: 0.0034, h: 0.0018, b: 0.0014, y: 0.0054, e: 2.9 },
			{ z: -0.0155, w: 0.0023, h: 0.001, b: 0.0011, y: 0.0052, e: 2.6 },
		],
		p,
	);
	// A sample drill under the bow, not a cutter head: this ship takes a core,
	// registers a claim, and leaves the digging to a rig.
	add(
		root,
		"prospector-drill",
		hullLoft([
			{ z: -0.0345, w: 0.0004, h: 0.0004, y: -0.0084, e: 2 },
			{ z: -0.0295, w: 0.0018, h: 0.0018, y: -0.0084, e: 2.4, hard: true },
			{ z: -0.0225, w: 0.0026, h: 0.0026, y: -0.0084, e: 2.8 },
		]),
		p.engine,
	);
	add(
		root,
		"prospector-drill-collar",
		hoop(0.0028, 0.0007),
		p.accent,
		[0, -0.0084, -0.0235],
	);
	add(
		root,
		"prospector-drill-arm",
		strut([0, -0.0026, -0.0195], [0, -0.0084, -0.0225], 0.0022, 0.0018),
		p.trim,
	);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			`prospector-pannier-${side}`,
			revolve(drumProfile(0.0086, 0.0034)),
			p.panel,
			[sign * 0.0062, -0.0012, 0.0005],
		);
		add(
			root,
			`prospector-pannier-band-${side}`,
			hoop(0.0036, 0.0005),
			p.accent,
			[sign * 0.0062, -0.0012, 0.0005],
		);
		add(
			root,
			"prospector-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0034, w: 0.0022, h: 0.005, b: 0.0048, y: 0.0195, e: 3 },
					{ z: 0.0082, w: 0.0019, h: 0.0044, b: 0.0042, y: 0.0225, e: 2.8 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			"prospector-" + side + "-nacelle",
			hullLoft(pod(0.0125, 0.0285, 0.0034, { x: sign * 0.0092 })),
			p.panel,
		);
		engineBell(
			root,
			"prospector-" + side,
			[sign * 0.0092, 0, 0.0315],
			0.003,
			0.0031,
			p,
		);
	}
	greebleStrip(
		root,
		"prospector-claim-rail",
		[
			{ z: -0.012, w: 0.0008, h: 0.0006, y: 0.0038, e: 2 },
			{ z: 0.01, w: 0.0009, h: 0.0006, y: 0.0036, e: 2 },
		],
		{ ...p, panel: p.accent },
	);
	blister(root, "prospector-sensor", 0.0013, [0, 0.0042, -0.0115], p);
}

function buildProspectorB(root: THREE.Group, p: Palette) {
	const keel = -0.0026;
	add(
		root,
		"prospector-fuselage",
		hullLoft([
			{ z: -0.0285, w: 0.0016, h: 0.0016, b: 0.0016, x: keel, e: 2.6 },
			{
				z: -0.024,
				w: 0.004,
				h: 0.0038,
				b: 0.0037,
				x: keel,
				e: 3.2,
				hard: true,
			},
			{
				z: -0.0175,
				w: 0.004,
				h: 0.0038,
				b: 0.0037,
				x: keel,
				e: 3.2,
				hard: true,
			},
			{
				z: -0.0155,
				w: 0.0028,
				h: 0.0027,
				b: 0.0027,
				x: keel,
				e: 3,
				hard: true,
			},
			{ z: 0.015, w: 0.0028, h: 0.0027, b: 0.0027, x: keel, e: 3, hard: true },
			{ z: 0.018, w: 0.006, h: 0.0052, b: 0.005, x: keel, e: 4, hard: true },
			{ z: 0.028, w: 0.006, h: 0.0052, b: 0.005, x: keel, e: 4, hard: true },
			{ z: 0.0305, w: 0.005, h: 0.0044, b: 0.0042, x: keel, e: 3.2 },
		]),
		p.hull,
	);
	canopy(
		root,
		"prospector",
		[
			{ z: -0.026, w: 0.003, h: 0.0013, b: 0.0015, x: keel, y: 0.0032, e: 2.8 },
			{ z: -0.022, w: 0.005, h: 0.0025, b: 0.0019, x: keel, y: 0.0042, e: 3.2 },
			{
				z: -0.017,
				w: 0.0047,
				h: 0.0022,
				b: 0.0019,
				x: keel,
				y: 0.0047,
				e: 3.2,
			},
			{
				z: -0.014,
				w: 0.0032,
				h: 0.0013,
				b: 0.0015,
				x: keel,
				y: 0.0042,
				e: 2.8,
			},
		],
		[
			{ z: -0.025, w: 0.0021, h: 0.001, b: 0.0011, x: keel, y: 0.0042, e: 2.6 },
			{
				z: -0.0215,
				w: 0.0036,
				h: 0.002,
				b: 0.0014,
				x: keel,
				y: 0.0048,
				e: 2.9,
			},
			{
				z: -0.0175,
				w: 0.0034,
				h: 0.0018,
				b: 0.0014,
				x: keel,
				y: 0.0052,
				e: 2.9,
			},
			{ z: -0.015, w: 0.0023, h: 0.001, b: 0.0011, x: keel, y: 0.005, e: 2.6 },
		],
		p,
	);
	// The drill swings out to starboard on its own boom; the assay lab bulges to
	// port, so the ship can core a rock and read it without turning round.
	add(
		root,
		"prospector-drill-boom",
		strut(
			[keel + 0.002, -0.0018, -0.0155],
			[0.0088, -0.0042, -0.0255],
			0.0024,
			0.0018,
		),
		p.trim,
	);
	add(
		root,
		"prospector-drill",
		hullLoft([
			{ z: -0.0345, w: 0.0004, h: 0.0004, x: 0.0088, y: -0.0044, e: 2 },
			{
				z: -0.0305,
				w: 0.0017,
				h: 0.0017,
				x: 0.0088,
				y: -0.0044,
				e: 2.4,
				hard: true,
			},
			{ z: -0.0245, w: 0.0025, h: 0.0025, x: 0.0088, y: -0.0044, e: 2.8 },
		]),
		p.engine,
	);
	add(
		root,
		"prospector-assay-lab",
		revolve(drumProfile(0.0108, 0.0042)),
		p.panel,
		[keel - 0.0074, 0.0008, -0.0005],
	);
	for (const band of [-0.005, 0.005])
		add(root, `prospector-lab-band-${band}`, hoop(0.0044, 0.0006), p.accent, [
			keel - 0.0074,
			0.0008,
			-0.0005 + band,
		]);
	add(
		root,
		"prospector-nacelle-mount-starboard",
		blade([
			{ z: 0.0058, w: 0.002, h: 0.0046, b: 0.0044, y: 0.0215, e: 3 },
			{ z: 0.0102, w: 0.0017, h: 0.004, b: 0.0038, y: 0.0242, e: 2.8 },
		]),
		p.trim,
	);
	add(
		root,
		"prospector-starboard-nacelle",
		hullLoft(pod(0.014, 0.0295, 0.003, { x: 0.0112 })),
		p.panel,
	);
	engineBell(
		root,
		"prospector-starboard",
		[0.0112, 0, 0.0325],
		0.0026,
		0.0027,
		p,
	);
	add(
		root,
		"prospector-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.0032, w: 0.0023, h: 0.0052, b: 0.005, y: 0.0195, e: 3 },
				{ z: 0.0082, w: 0.002, h: 0.0046, b: 0.0044, y: 0.0228, e: 2.8 },
			]),
		),
		p.trim,
		[keel, 0, 0],
	);
	add(
		root,
		"prospector-port-nacelle",
		hullLoft(pod(0.0125, 0.029, 0.0036, { x: keel - 0.0094 })),
		p.panel,
	);
	engineBell(
		root,
		"prospector-port",
		[keel - 0.0094, 0, 0.032],
		0.0031,
		0.0032,
		p,
	);
	blister(root, "prospector-sensor", 0.0013, [keel, 0.004, -0.0115], p);
}

function buildProspectorC(root: THREE.Group, p: Palette) {
	add(
		root,
		"prospector-fuselage",
		hullLoft([
			{ z: -0.0295, w: 0.0016, h: 0.0016, b: 0.0016, e: 2.6 },
			{ z: -0.025, w: 0.0044, h: 0.0038, b: 0.0038, e: 3.2, hard: true },
			{ z: -0.0185, w: 0.0044, h: 0.0038, b: 0.0038, e: 3.2, hard: true },
			{ z: -0.0165, w: 0.0031, h: 0.0027, b: 0.0027, e: 3, hard: true },
			{ z: 0.015, w: 0.0031, h: 0.0027, b: 0.0027, e: 3, hard: true },
			{ z: 0.018, w: 0.0066, h: 0.0052, b: 0.005, e: 4, hard: true },
			{ z: 0.028, w: 0.0066, h: 0.0052, b: 0.005, e: 4, hard: true },
			{ z: 0.0305, w: 0.0056, h: 0.0044, b: 0.0042, e: 3.2 },
		]),
		p.hull,
	);
	canopy(
		root,
		"prospector",
		[
			{ z: -0.027, w: 0.003, h: 0.0013, b: 0.0015, y: 0.003, e: 2.8 },
			{ z: -0.023, w: 0.005, h: 0.0025, b: 0.0019, y: 0.004, e: 3.2 },
			{ z: -0.018, w: 0.0047, h: 0.0022, b: 0.0019, y: 0.0045, e: 3.2 },
			{ z: -0.015, w: 0.0032, h: 0.0013, b: 0.0015, y: 0.004, e: 2.8 },
		],
		[
			{ z: -0.026, w: 0.0021, h: 0.001, b: 0.0011, y: 0.004, e: 2.6 },
			{ z: -0.0225, w: 0.0036, h: 0.002, b: 0.0014, y: 0.0046, e: 2.9 },
			{ z: -0.0185, w: 0.0034, h: 0.0018, b: 0.0014, y: 0.005, e: 2.9 },
			{ z: -0.016, w: 0.0023, h: 0.001, b: 0.0011, y: 0.0048, e: 2.6 },
		],
		p,
	);
	// Claim beacon up, drill down. Everything this ship does happens on the
	// vertical, and the keel between stays clear.
	add(
		root,
		"prospector-beacon-mast",
		strut([0, 0.0032, -0.0075], [0, 0.0128, -0.009], 0.002, 0.0014),
		p.trim,
	);
	add(
		root,
		"prospector-beacon",
		hoop(0.0034, 0.001),
		p.accent,
		[0, 0.0142, -0.0092],
	);
	add(
		root,
		"prospector-beacon-lamp",
		revolve([
			[0.0018, -0.0014],
			[0.0022, 0],
			[0.0014, 0.0016],
		]),
		p.exhaust,
		[0, 0.0142, -0.0092],
	);
	add(
		root,
		"prospector-drill-arm",
		strut([0, -0.0028, -0.0075], [0, -0.0102, -0.0125], 0.0024, 0.0018),
		p.trim,
	);
	add(
		root,
		"prospector-drill",
		hullLoft([
			{ z: -0.0325, w: 0.0004, h: 0.0004, y: -0.0108, e: 2 },
			{ z: -0.0285, w: 0.0018, h: 0.0018, y: -0.0108, e: 2.4, hard: true },
			{ z: -0.0115, w: 0.0027, h: 0.0027, y: -0.0108, e: 2.8 },
		]),
		p.engine,
	);
	add(
		root,
		"prospector-drill-collar",
		hoop(0.0029, 0.0007),
		p.accent,
		[0, -0.0108, -0.0245],
	);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			"prospector-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0032, w: 0.0022, h: 0.005, b: 0.0048, y: 0.0198, e: 3 },
					{ z: 0.008, w: 0.0019, h: 0.0044, b: 0.0042, y: 0.0228, e: 2.8 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			"prospector-" + side + "-nacelle",
			hullLoft(pod(0.0125, 0.029, 0.0034, { x: sign * 0.009 })),
			p.panel,
		);
		engineBell(
			root,
			"prospector-" + side,
			[sign * 0.009, 0, 0.032],
			0.003,
			0.0031,
			p,
		);
	}
	blister(root, "prospector-sensor", 0.0013, [0.0032, 0.0038, -0.0135], p);
}

/**
 * The battle line.
 *
 * A dreadnought is a capital hull that carries guns instead of a hangar, so it
 * is longer and narrower than the carrier and it wears its armour outside.
 * Where the carrier counts bay mouths and deck lights, this one counts turrets
 * and belt ribs — same trick for the same reason, different vocabulary.
 */
function buildDreadnoughtA(root: THREE.Group, p: Palette) {
	add(
		root,
		"dreadnought-fuselage",
		hullLoft([
			{ z: -0.198, w: 0.008, h: 0.009, b: 0.009, e: 2.8 },
			{ z: -0.176, w: 0.024, h: 0.024, b: 0.025, e: 3.4, hard: true },
			{ z: -0.126, w: 0.038, h: 0.034, b: 0.036, e: 4.2, hard: true },
			{ z: 0.03, w: 0.042, h: 0.037, b: 0.039, e: 4.6, hard: true },
			{ z: 0.126, w: 0.039, h: 0.035, b: 0.036, e: 4.4, hard: true },
			{ z: 0.174, w: 0.03, h: 0.028, b: 0.029, e: 3.6 },
			{ z: 0.196, w: 0.021, h: 0.02, b: 0.02, e: 2.8 },
		]),
		p.hull,
	);
	// The spinal gun runs most of the ship and defines which end is the bow.
	add(
		root,
		"dreadnought-spinal-gun",
		hullLoft([
			{ z: -0.204, w: 0.009, h: 0.009, y: 0.004, e: 3 },
			{ z: -0.19, w: 0.012, h: 0.012, y: 0.004, e: 3.2, hard: true },
			{ z: -0.04, w: 0.012, h: 0.012, y: 0.004, e: 3.2, hard: true },
			{ z: -0.02, w: 0.017, h: 0.016, y: 0.004, e: 3.6 },
		]),
		p.trim,
	);
	add(
		root,
		"dreadnought-muzzle",
		hoop(0.0135, 0.0026),
		p.accent,
		[0, 0.004, -0.198],
	);
	bridge(
		root,
		"dreadnought",
		[
			{ z: -0.03, w: 0.013, h: 0.008, b: 0.009, y: 0.044, e: 3.4 },
			{ z: -0.012, w: 0.021, h: 0.013, b: 0.011, y: 0.05, e: 4 },
			{ z: 0.012, w: 0.02, h: 0.012, b: 0.011, y: 0.052, e: 4 },
			{ z: 0.028, w: 0.014, h: 0.008, b: 0.009, y: 0.05, e: 3.4 },
		],
		[
			{ z: -0.026, w: 0.0092, h: 0.0056, b: 0.006, y: 0.0445, e: 3 },
			{ z: -0.012, w: 0.0148, h: 0.0102, b: 0.0078, y: 0.0502, e: 3.4 },
			{ z: 0.006, w: 0.0138, h: 0.009, b: 0.0072, y: 0.0524, e: 3.4 },
			{ z: 0.018, w: 0.0098, h: 0.0056, b: 0.006, y: 0.0502, e: 3 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.022],
		["aft", 0.02],
	] as const)
		add(
			root,
			`dreadnought-tower-leg-${tag}`,
			strut([0, 0.03, cz], [0, 0.044, cz], 0.0085, 0.007),
			p.trim,
		);
	ribs(root, "dreadnought-belt", -0.112, 0.116, 11, 0.043, 0.0028, p);
	for (const [tag, cz, sign] of [
		["bow-upper", -0.086, 1],
		["bow-lower", -0.052, -1],
		["waist-upper", 0.052, 1],
		["waist-lower", 0.086, -1],
	] as const)
		turret(
			root,
			`dreadnought-turret-${tag}`,
			0.0135,
			[0, sign * 0.038, cz],
			p,
			sign,
		);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		portholes(
			root,
			"dreadnought-row-" + side,
			-0.106,
			0.108,
			20,
			{ x: sign * 0.0415, y: 0.014 },
			0.0036,
			p,
		);
		add(
			root,
			"dreadnought-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.024, w: 0.013, h: 0.03, b: 0.028, y: 0.126, e: 3.4 },
					{ z: 0.044, w: 0.011, h: 0.026, b: 0.024, y: 0.15, e: 3.2 },
				],
				sign,
			),
			p.hull,
		);
		add(
			root,
			"dreadnought-" + side + "-nacelle",
			hullLoft(pod(0.094, 0.184, 0.0155, { x: sign * 0.048 })),
			p.panel,
		);
		add(root, "dreadnought-collar-" + side, hoop(0.0165, 0.002), p.accent, [
			sign * 0.048,
			0,
			0.158,
		]);
		engineBell(
			root,
			"dreadnought-" + side,
			[sign * 0.048, 0, 0.198],
			0.0135,
			0.014,
			p,
		);
	}
	engineBell(root, "dreadnought-core", [0, 0, 0.2], 0.019, 0.02, p);
	blister(root, "dreadnought-sensor", 0.0068, [0.02, 0.0356, -0.062], p);
}

function buildDreadnoughtB(root: THREE.Group, p: Palette) {
	const keel = -0.022;
	add(
		root,
		"dreadnought-fuselage",
		hullLoft([
			{ z: -0.194, w: 0.008, h: 0.009, b: 0.009, x: keel, e: 2.8 },
			{
				z: -0.172,
				w: 0.022,
				h: 0.023,
				b: 0.024,
				x: keel,
				e: 3.4,
				hard: true,
			},
			{ z: -0.124, w: 0.03, h: 0.031, b: 0.032, x: keel, e: 4.2, hard: true },
			{ z: 0.104, w: 0.03, h: 0.031, b: 0.032, x: keel, e: 4.2, hard: true },
			{ z: 0.13, w: 0.042, h: 0.038, b: 0.039, x: keel, e: 4.6, hard: true },
			{ z: 0.178, w: 0.042, h: 0.038, b: 0.039, x: keel, e: 4.6, hard: true },
			{ z: 0.192, w: 0.033, h: 0.031, b: 0.031, x: keel, e: 3.4 },
		]),
		p.hull,
	);
	// Armour to port where the command spaces are, guns to starboard where the
	// broadside is. The ship fights sideways and is built to say so.
	add(
		root,
		"dreadnought-armour-block",
		blade([
			{ z: -0.018, w: 0.04, h: 0.118, b: 0.116, y: -0.028, e: 4.8 },
			{ z: 0.028, w: 0.039, h: 0.116, b: 0.114, y: -0.022, e: 5 },
			{ z: 0.064, w: 0.033, h: 0.098, b: 0.096, y: -0.008, e: 4.4 },
		]),
		p.hull,
	);
	ribs(root, "dreadnought-belt", -0.104, 0.088, 9, 0.032, 0.0026, p, {
		x: keel,
	});
	for (const [tag, cz] of [
		["one", -0.096],
		["two", -0.036],
		["three", 0.024],
		["four", 0.078],
	] as const)
		turret(root, `dreadnought-turret-${tag}`, 0.0128, [0.03, 0.03, cz], p);
	bridge(
		root,
		"dreadnought",
		[
			{ z: -0.088, w: 0.013, h: 0.008, b: 0.009, x: keel, y: 0.046, e: 3.4 },
			{ z: -0.07, w: 0.021, h: 0.013, b: 0.011, x: keel, y: 0.052, e: 4 },
			{ z: -0.046, w: 0.02, h: 0.012, b: 0.011, x: keel, y: 0.054, e: 4 },
			{ z: -0.03, w: 0.014, h: 0.008, b: 0.009, x: keel, y: 0.052, e: 3.4 },
		],
		[
			{ z: -0.084, w: 0.0092, h: 0.0056, b: 0.006, x: keel, y: 0.0465, e: 3 },
			{ z: -0.07, w: 0.0148, h: 0.0102, b: 0.0078, x: keel, y: 0.0522, e: 3.4 },
			{ z: -0.052, w: 0.0138, h: 0.009, b: 0.0072, x: keel, y: 0.0544, e: 3.4 },
			{ z: -0.04, w: 0.0098, h: 0.0056, b: 0.006, x: keel, y: 0.0522, e: 3 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.08],
		["aft", -0.038],
	] as const)
		add(
			root,
			`dreadnought-tower-leg-${tag}`,
			strut([keel, 0.028, cz], [keel, 0.046, cz], 0.0085, 0.007),
			p.trim,
		);
	portholes(
		root,
		"dreadnought-keel-row",
		-0.096,
		0.086,
		18,
		{ x: keel - 0.0305, y: 0.008 },
		0.0036,
		p,
	);
	add(
		root,
		"dreadnought-nacelle-mount-starboard",
		blade([
			{ z: 0.048, w: 0.013, h: 0.028, b: 0.026, y: 0.124, e: 3.4 },
			{ z: 0.074, w: 0.011, h: 0.024, b: 0.022, y: 0.146, e: 3.2 },
		]),
		p.trim,
	);
	add(
		root,
		"dreadnought-starboard-nacelle",
		hullLoft(pod(0.096, 0.182, 0.0155, { x: 0.08 })),
		p.panel,
	);
	engineBell(root, "dreadnought-starboard", [0.08, 0, 0.196], 0.0135, 0.014, p);
	add(
		root,
		"dreadnought-nacelle-mount-port",
		mirrorX(
			blade([
				{ z: 0.026, w: 0.012, h: 0.026, b: 0.024, y: 0.104, e: 3.4 },
				{ z: 0.05, w: 0.01, h: 0.022, b: 0.02, y: 0.124, e: 3.2 },
			]),
		),
		p.trim,
		[keel, 0, 0],
	);
	add(
		root,
		"dreadnought-port-nacelle",
		hullLoft(pod(0.094, 0.18, 0.0145, { x: keel - 0.054 })),
		p.panel,
	);
	engineBell(
		root,
		"dreadnought-port",
		[keel - 0.054, 0, 0.194],
		0.0125,
		0.013,
		p,
	);
	engineBell(root, "dreadnought-core", [keel, 0, 0.198], 0.019, 0.02, p);
	blister(root, "dreadnought-sensor", 0.0068, [keel, 0.032, -0.108], p);
}

function buildDreadnoughtC(root: THREE.Group, p: Palette) {
	const deck = 0.024;
	add(
		root,
		"dreadnought-fuselage",
		hullLoft([
			{ z: -0.196, w: 0.0085, h: 0.009, b: 0.009, y: deck, e: 2.8 },
			{
				z: -0.174,
				w: 0.024,
				h: 0.023,
				b: 0.024,
				y: deck,
				e: 3.4,
				hard: true,
			},
			{ z: -0.126, w: 0.034, h: 0.028, b: 0.029, y: deck, e: 4.4, hard: true },
			{ z: 0.108, w: 0.034, h: 0.028, b: 0.029, y: deck, e: 4.4, hard: true },
			{ z: 0.134, w: 0.046, h: 0.036, b: 0.037, y: deck, e: 4.8, hard: true },
			{ z: 0.18, w: 0.046, h: 0.036, b: 0.037, y: deck, e: 4.8, hard: true },
			{ z: 0.194, w: 0.036, h: 0.03, b: 0.03, y: deck, e: 3.4 },
		]),
		p.hull,
	);
	// A gun deck above, an armour keel below, and the crew between them.
	add(
		root,
		"dreadnought-armour-keel",
		hullLoft([
			{ z: -0.15, w: 0.026, h: 0.02, b: 0.022, y: -0.046, e: 4 },
			{
				z: -0.112,
				w: 0.038,
				h: 0.03,
				b: 0.032,
				y: -0.05,
				e: 4.8,
				hard: true,
			},
			{ z: 0.09, w: 0.038, h: 0.03, b: 0.032, y: -0.05, e: 4.8, hard: true },
			{ z: 0.126, w: 0.026, h: 0.02, b: 0.022, y: -0.046, e: 4 },
		]),
		p.panel,
	);
	for (const [tag, cz] of [
		["fore", -0.1],
		["mid", -0.008],
		["aft", 0.08],
	] as const)
		add(
			root,
			`dreadnought-keel-stay-${tag}`,
			strut([0, deck - 0.024, cz], [0, -0.022, cz], 0.0105, 0.0088),
			p.trim,
		);
	for (const [tag, cz] of [
		["one", -0.104],
		["two", -0.05],
		["three", 0.008],
		["four", 0.064],
	] as const)
		turret(root, `dreadnought-turret-${tag}`, 0.0132, [0, deck + 0.032, cz], p);
	bridge(
		root,
		"dreadnought",
		[
			{ z: -0.148, w: 0.013, h: 0.008, b: 0.009, y: deck + 0.038, e: 3.4 },
			{ z: -0.13, w: 0.021, h: 0.013, b: 0.011, y: deck + 0.044, e: 4 },
			{ z: -0.106, w: 0.02, h: 0.012, b: 0.011, y: deck + 0.046, e: 4 },
			{ z: -0.09, w: 0.014, h: 0.008, b: 0.009, y: deck + 0.044, e: 3.4 },
		],
		[
			{ z: -0.144, w: 0.0092, h: 0.0056, b: 0.006, y: deck + 0.0385, e: 3 },
			{ z: -0.13, w: 0.0148, h: 0.0102, b: 0.0078, y: deck + 0.0442, e: 3.4 },
			{ z: -0.112, w: 0.0138, h: 0.009, b: 0.0072, y: deck + 0.0464, e: 3.4 },
			{ z: -0.1, w: 0.0098, h: 0.0056, b: 0.006, y: deck + 0.0442, e: 3 },
		],
		p,
	);
	for (const [tag, cz] of [
		["fore", -0.14],
		["aft", -0.098],
	] as const)
		add(
			root,
			`dreadnought-tower-leg-${tag}`,
			strut([0, deck + 0.022, cz], [0, deck + 0.038, cz], 0.0085, 0.007),
			p.trim,
		);
	ribs(root, "dreadnought-belt", -0.108, 0.096, 10, 0.035, 0.0026, p, {
		y: deck,
	});
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		portholes(
			root,
			"dreadnought-row-" + side,
			-0.104,
			0.1,
			19,
			{ x: sign * 0.0345, y: deck + 0.01 },
			0.0036,
			p,
		);
		add(
			root,
			"dreadnought-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.032, w: 0.013, h: 0.028, b: 0.026, y: 0.106, e: 3.4 },
					{ z: 0.058, w: 0.011, h: 0.024, b: 0.022, y: 0.128, e: 3.2 },
				],
				sign,
			),
			p.trim,
			[0, deck, 0],
		);
		add(
			root,
			"dreadnought-" + side + "-nacelle",
			hullLoft(pod(0.098, 0.184, 0.015, { x: sign * 0.062, y: deck })),
			p.panel,
		);
		add(root, "dreadnought-collar-" + side, hoop(0.016, 0.002), p.accent, [
			sign * 0.062,
			deck,
			0.16,
		]);
		engineBell(
			root,
			"dreadnought-" + side,
			[sign * 0.062, deck, 0.198],
			0.013,
			0.0135,
			p,
		);
	}
	engineBell(root, "dreadnought-core", [0, deck, 0.2], 0.02, 0.021, p);
	blister(root, "dreadnought-sensor", 0.0068, [0.02, deck + 0.022, -0.126], p);
}

/**
 * #331's command sphere, the part every voyager variant shares: a lofted ball
 * whose glass is set low in its bow, as Discovery's pod-bay windows are. It is
 * the `bridge` pair, so the canopy and forward-view rows read it by name.
 */
const VOYAGER_SPHERE = Object.freeze({ z: -0.084, r: 0.013 });

/** How far every voyager dish is tipped back from its mast, radians. */
const VOYAGER_DISH_PITCH = -Math.PI / 2.7;

function voyagerSphere(root: THREE.Group, p: Palette) {
	const { z, r } = VOYAGER_SPHERE;
	const tower: Ring[] = [12, 30, 50, 70, 90, 110, 130, 150, 168].map((deg) => {
		const phi = (deg * Math.PI) / 180;
		const radius = r * Math.sin(phi);
		return { z: z - r * Math.cos(phi), w: radius, h: radius, b: radius, e: 2 };
	});
	const glass: Ring[] = [
		{ z: -0.0975, w: 0.0026, h: 0.0009, b: 0.0009, y: -0.0035, e: 2.4 },
		{ z: -0.0955, w: 0.0045, h: 0.0016, b: 0.0016, y: -0.0035, e: 2.4 },
		{ z: -0.0925, w: 0.0038, h: 0.0012, b: 0.0012, y: -0.0035, e: 2.4 },
	];
	bridge(root, "voyager", tower, glass, p);
}

/** The spine and its vertebrae, carried at `y`. Its section differs per
 *  variant so the three primary masses are three silhouettes. */
function voyagerSpine(
	root: THREE.Group,
	p: Palette,
	section: { w: number; h: number },
	y = 0,
) {
	const { w, h } = section;
	add(
		root,
		"voyager-fuselage",
		hullLoft([
			{ z: -0.076, w: w * 0.8, h: h * 0.8, b: h * 0.8, y, e: 3.2 },
			{ z: -0.07, w, h, b: h, y, e: 3.2, hard: true },
			{ z: 0.05, w, h, b: h, y, e: 3.2, hard: true },
			{ z: 0.058, w: w * 0.88, h: h * 0.88, b: h * 0.88, y, e: 3.2 },
		]),
		p.hull,
	);
	// Discovery's spine is a run of identical segments, and the count at a fixed
	// pitch is what tells the eye how long it is.
	for (let i = 0; i < 8; i += 1) {
		const cz = -0.056 + i * 0.012;
		const vw = w + 0.0012;
		const vh = h + 0.0012;
		add(
			root,
			`voyager-vertebra-${i}`,
			hullLoft(
				[
					{ z: cz - 0.004, w: vw * 0.82, h: vh * 0.82, b: vh * 0.82, y, e: 5 },
					{ z: cz - 0.0034, w: vw, h: vh, b: vh, y, e: 5, hard: true },
					{ z: cz + 0.0034, w: vw, h: vh, b: vh, y, e: 5, hard: true },
					{ z: cz + 0.004, w: vw * 0.82, h: vh * 0.82, b: vh * 0.82, y, e: 5 },
				],
				{ segments: 8 },
			),
			p.panel,
		);
	}
}

/** The drive block aft, at `y`, with its core bell. */
function voyagerDriveHull(root: THREE.Group, p: Palette, y = 0) {
	add(
		root,
		"voyager-drive-hull",
		hullLoft([
			{ z: 0.054, w: 0.006, h: 0.005, b: 0.005, y, e: 4 },
			{ z: 0.058, w: 0.0085, h: 0.0068, b: 0.0068, y, e: 5, hard: true },
			{ z: 0.084, w: 0.0085, h: 0.0068, b: 0.0068, y, e: 5, hard: true },
			{ z: 0.088, w: 0.0072, h: 0.0058, b: 0.0058, y, e: 4 },
		]),
		p.hull,
	);
	engineBell(root, "voyager-core", [0, y, 0.0915], 0.0042, 0.0045, p);
}

/** Two drive pods either side of the drive block, on swept pylons. */
function voyagerPairedDrives(root: THREE.Group, p: Palette) {
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			`voyager-nacelle-mount-${side}`,
			mirroredBlade(
				[
					{ z: 0.006, w: 0.0014, h: 0.008, b: 0.008, y: 0.074, e: 3 },
					{ z: 0.0115, w: 0.0012, h: 0.007, b: 0.007, y: 0.074, e: 3 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			`voyager-${side}-nacelle`,
			hullLoft(pod(0.06, 0.09, 0.0032, { x: sign * 0.0115 })),
			p.panel,
		);
		engineBell(
			root,
			`voyager-${side}`,
			[sign * 0.0115, 0, 0.093],
			0.0028,
			0.0032,
			p,
		);
	}
}

function buildVoyagerA(root: THREE.Group, p: Palette) {
	voyagerSphere(root, p);
	voyagerSpine(root, p, { w: 0.0032, h: 0.0032 });
	voyagerDriveHull(root, p);
	voyagerPairedDrives(root, p);
	// The dish array: one large dish and two small ones on a boom, standing on a
	// mast just aft of the sphere and clear above the pilot's eye line.
	add(
		root,
		"voyager-dish-mast",
		strut([0, 0.0028, -0.056], [0, 0.0128, -0.051], 0.0012, 0.0009),
		p.trim,
	);
	dish(root, "voyager-dish", 0.0055, [0, 0.0145, -0.05], p, [
		VOYAGER_DISH_PITCH,
		0,
		0,
	]);
	add(
		root,
		"voyager-dish-boom",
		strut([-0.0078, 0.0128, -0.051], [0.0078, 0.0128, -0.051], 0.0008, 0.0008),
		p.trim,
	);
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const)
		dish(
			root,
			`voyager-dish-${side}`,
			0.0026,
			[sign * 0.0078, 0.0135, -0.0505],
			p,
			[VOYAGER_DISH_PITCH, 0, 0],
		);
}

function buildVoyagerB(root: THREE.Group, p: Palette) {
	voyagerSphere(root, p);
	voyagerSpine(root, p, { w: 0.0042, h: 0.003 });
	voyagerDriveHull(root, p);
	voyagerPairedDrives(root, p);
	// A long tank bank to port on three stays, balancing the dish to starboard.
	add(
		root,
		"voyager-tank-bank",
		hullLoft(pod(-0.05, 0.044, 0.0042, { x: -0.0115 })),
		p.panel,
	);
	[-0.035, 0, 0.03].forEach((cz, i) =>
		add(
			root,
			`voyager-tank-stay-${i}`,
			strut([-0.003, 0, cz], [-0.0085, 0, cz], 0.0009, 0.0009),
			p.trim,
		),
	);
	add(
		root,
		"voyager-dish-mast",
		strut([0.003, 0.001, -0.052], [0.0115, 0.004, -0.05], 0.0011, 0.0009),
		p.trim,
	);
	dish(root, "voyager-dish", 0.0058, [0.0145, 0.0052, -0.049], p, [
		VOYAGER_DISH_PITCH,
		0.35,
		0,
	]);
}

function buildVoyagerC(root: THREE.Group, p: Palette) {
	const spineY = 0.007;
	const driveY = 0.0035;
	voyagerSphere(root, p);
	voyagerSpine(root, p, { w: 0.0028, h: 0.004 }, spineY);
	// The pod run, hung under the raised spine on short hangers.
	for (let i = 0; i < 5; i += 1) {
		const cz = -0.045 + i * 0.02;
		add(
			root,
			`voyager-pod-${i}`,
			hullLoft(pod(cz - 0.008, cz + 0.008, 0.0036, { y: -0.004 })),
			p.panel,
		);
		add(
			root,
			`voyager-pod-hanger-${i}`,
			strut([0, spineY - 0.003, cz], [0, -0.001, cz], 0.0008, 0.0008),
			p.trim,
		);
	}
	voyagerDriveHull(root, p, driveY);
	// Drives stacked above and below the block, on vertical pylons.
	for (const [tag, sign] of [
		["dorsal", 1],
		["ventral", -1],
	] as const) {
		const ny = driveY + sign * 0.0105;
		const up = sign > 0 ? 0.0105 : 0.0005;
		const down = sign > 0 ? 0.0005 : 0.0105;
		add(
			root,
			`voyager-nacelle-mount-${tag}`,
			hullLoft([
				{ z: 0.064, w: 0.0014, h: up, b: down, y: driveY, e: 3 },
				{ z: 0.084, w: 0.0014, h: up, b: down, y: driveY, e: 3 },
			]),
			p.trim,
		);
		add(
			root,
			`voyager-${tag}-nacelle`,
			hullLoft(pod(0.06, 0.09, 0.0032, { y: ny })),
			p.panel,
		);
		engineBell(root, `voyager-${tag}`, [0, ny, 0.093], 0.0028, 0.0032, p);
	}
	add(
		root,
		"voyager-dish-mast",
		strut([0, spineY + 0.004, -0.05], [0, 0.021, -0.046], 0.0011, 0.0009),
		p.trim,
	);
	dish(root, "voyager-dish", 0.005, [0, 0.0235, -0.045], p, [
		VOYAGER_DISH_PITCH,
		0,
		0,
	]);
}

export interface FleetSlot {
	readonly id: HullId;
	readonly variant: HullVariantId;
	/** Offset from the review's anchor, in kilometres. */
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/**
 * Park every model in an avenue the player can fly down.
 *
 * Ordered by declared reach so the walk is smallest to largest, which is the
 * one arrangement that makes the size range legible: a capital hull beside a
 * courier reads as a mistake, but at the end of a line that grows towards it,
 * it reads as the point. Spacing is derived from the two hulls involved rather
 * than being one tuned number, because a gap that clears two couriers puts two
 * dreadnoughts inside each other.
 *
 * The gaps are far wider than clearance needs. Full throttle is 2 km/s, and an
 * avenue packed as tightly as the hulls allow is gone in under three seconds —
 * a flypast rather than somewhere the player has flown. These figures put it at
 * roughly twenty seconds wide open, and a couple of minutes at the throttle
 * setting anyone actually looking at the ships will be using.
 *
 * The middle variant of each row is lifted rather than left on the centre
 * line. Three hulls spread evenly about the axis puts one of them exactly
 * where the player is flying, and with no collision in the scaffold that means
 * passing straight through a ship — which reads as a rendering fault rather
 * than as a fleet. Lifting it keeps the row symmetric and leaves the lane
 * clear underneath.
 *
 * Pure arithmetic, exported so `tests/ship-mesh.test.ts` can prove the hulls do
 * not intersect without a browser. It creates no meshes, no actors, and no
 * simulation positions: `main.ts` anchors the result and #26 still owns any
 * roster meaning a hull might one day carry.
 */
export function fleetLayout(): FleetSlot[] {
	const byReach = [...HULL_IDS].sort(
		(a, b) => HULL_REACH_KM[a] - HULL_REACH_KM[b],
	);
	const slots: FleetSlot[] = [];
	let z = 0;
	let previousReach = 0;
	for (const id of byReach) {
		const reach = HULL_REACH_KM[id];
		z -= (previousReach + reach) * 12 + 0.8;
		previousReach = reach;
		const lateral = reach * 9;
		HULL_VARIANT_IDS.forEach((variant, column) => {
			const centred = column === 1;
			slots.push({
				id,
				variant,
				x: (column - 1) * lateral,
				y: centred ? lateral * 0.62 : 0,
				z,
			});
		});
	}
	return slots;
}

type Builder = (root: THREE.Group, palette: Palette) => void;
interface LoftPlan extends ShipDetailPlan {
	readonly build: Builder;
	readonly authored?: undefined;
}
/** An authored model (node #815) carries its own machinery, lamps and paint,
 *  so it declares no zones, gets no generated detail and takes no palette:
 *  every hull finish draws it the same (`tests/ship-finish.test.ts`). */
interface AuthoredPlan extends ShipDetailPlan {
	/** Draws the model into the root and returns its levels for the band. */
	readonly build: (root: THREE.Group) => ShipLevels;
	readonly authored: true;
	/** The most detail any hull but the player's own draws it at. */
	readonly nearest: DetailLevel;
}
type BuilderPlan = LoftPlan | AuthoredPlan;

/** One authored machinery patch beside each builder, never a hull-wide scatter. */
const planned = (
	build: Builder,
	part: string,
	name: string,
	surface: ShipSurface,
	count = 18,
	options: { readonly seed?: number } = {},
): BuilderPlan => ({
	build,
	zones: [
		{ name, seed: options.seed, part, surface, from: 0.38, to: 0.72, count },
	],
});

/**
 * One entry per model.
 *
 * The chain of `if (variant === "a")` this replaces was already hard to read at
 * nine hulls; at eighteen a missing branch would fall through to some other
 * role's shape rather than failing, which is exactly the silent default the
 * spec forbids.
 */
export const SHIP_DETAIL_PLANS: Record<
	HullId,
	Record<HullVariantId, BuilderPlan>
> = {
	courier: {
		a: planned(
			buildCourierA,
			"courier-dorsal-hull",
			"dorsal-service",
			"dorsal",
		),
		b: planned(buildCourierB, "courier-fuselage", "port-utility", "port"),
		c: planned(buildCourierC, "courier-fuselage", "belly-machinery", "ventral"),
	},
	interceptor: {
		a: planned(
			buildInterceptorA,
			"interceptor-fuselage",
			"spine-service",
			"dorsal",
		),
		b: planned(
			buildInterceptorB,
			"interceptor-fuselage",
			"drive-shoulder",
			"starboard",
		),
		c: planned(
			buildInterceptorC,
			"interceptor-fuselage",
			"ventral-access",
			"ventral",
		),
	},
	freighter: {
		a: planned(
			buildFreighterA,
			"freighter-fuselage",
			"gantry-spine",
			"dorsal",
			24,
		),
		b: planned(
			buildFreighterB,
			"freighter-fuselage",
			"bridge-flank",
			"starboard",
			24,
			{ seed: 140222523 },
		),
		c: planned(
			buildFreighterC,
			"freighter-fuselage",
			"keel-services",
			"ventral",
			24,
		),
	},
	miner: {
		a: planned(buildMinerA, "miner-fuselage", "ore-service", "dorsal", 22),
		b: {
			build: buildLongwall,
			zones: [],
			authored: true,
			nearest: LONGWALL_NEAREST_LEVEL,
		},
		c: planned(buildMinerC, "miner-fuselage", "refinery-spine", "dorsal", 22),
	},
	patrol: {
		a: planned(buildPatrolA, "patrol-fuselage", "sensor-spine", "dorsal"),
		b: planned(buildPatrolB, "patrol-fuselage", "boarding-flank", "starboard"),
		c: planned(buildPatrolC, "patrol-fuselage", "interdictor-keel", "ventral"),
	},
	explorer: {
		a: planned(
			buildExplorerA,
			"explorer-fuselage",
			"habitat-spine",
			"dorsal",
			22,
		),
		b: planned(
			buildExplorerB,
			"explorer-fuselage",
			"survey-flank",
			"starboard",
			22,
		),
		c: planned(
			buildExplorerC,
			"explorer-fuselage",
			"stores-keel",
			"ventral",
			22,
		),
	},
	raider: {
		a: planned(buildRaiderA, "raider-fuselage", "breach-spine", "dorsal"),
		b: planned(buildRaiderB, "raider-fuselage", "prize-flank", "starboard"),
		c: planned(buildRaiderC, "raider-fuselage", "grapple-keel", "ventral"),
	},
	carrier: {
		a: planned(
			buildCarrierA,
			"carrier-fuselage",
			"flight-services",
			"dorsal",
			36,
		),
		b: planned(
			buildCarrierB,
			"carrier-fuselage",
			"flightdeck-flank",
			"starboard",
			36,
			{ seed: 1072900095 },
		),
		c: planned(
			buildCarrierC,
			"carrier-fuselage",
			"flightdeck-keel",
			"ventral",
			36,
			{ seed: 3542260001 },
		),
	},
	tug: {
		a: planned(buildTugA, "tug-fuselage", "tractor-spine", "dorsal", 18, {
			seed: 3451922096,
		}),
		b: planned(buildTugB, "tug-fuselage", "crane-flank", "starboard"),
		c: planned(buildTugC, "tug-fuselage", "tractor-keel", "ventral", 18, {
			seed: 399698058,
		}),
	},
	prospector: {
		a: planned(
			buildProspectorA,
			"prospector-fuselage",
			"assay-spine",
			"dorsal",
		),
		b: planned(
			buildProspectorB,
			"prospector-fuselage",
			"lab-flank",
			"starboard",
		),
		c: planned(
			buildProspectorC,
			"prospector-fuselage",
			"drill-keel",
			"ventral",
		),
	},
	dreadnought: {
		a: planned(
			buildDreadnoughtA,
			"dreadnought-fuselage",
			"gun-services",
			"dorsal",
			40,
		),
		b: planned(
			buildDreadnoughtB,
			"dreadnought-fuselage",
			"armour-flank",
			"starboard",
			40,
		),
		c: planned(
			buildDreadnoughtC,
			"dreadnought-fuselage",
			"armour-keel",
			"ventral",
			40,
		),
	},
	voyager: {
		a: planned(
			buildVoyagerA,
			"voyager-fuselage",
			"spine-machinery",
			"dorsal",
			18,
		),
		b: planned(
			buildVoyagerB,
			"voyager-fuselage",
			"tank-services",
			"starboard",
			18,
		),
		c: planned(
			buildVoyagerC,
			"voyager-fuselage",
			"pod-services",
			"ventral",
			18,
		),
	},
};

/**
 * Nav lights: red to port, green to starboard, white on the spine, amber aft.
 *
 * The problem they solve is that a hull is a dark shape against a star field,
 * and at the ranges a fight happens at it is not a *shape*. The prototype
 * striker lives between half a kilometre and ten. The measured `raider/a` box
 * (#181) is 63.5 m long and **10.9 m tall**, and it is the second figure that
 * decides this: at 8 km, on the 760-pixel desktop viewport the probes use at a
 * 60-degree vertical field, the hull is 5.2 px long and **0.90 px tall** —
 * drawn at the prototype's 3x it is 15.7 px by 2.7 px. Either way it is a
 * horizontal sliver, and the one thing a pilot needs off it — which way it is
 * pointing — is carried by the axis that has fallen under three pixels.
 *
 * No amount of albedo puts aspect back into two pixels, and brightening the
 * paint to chase it is how a hull ends up measuring bloom (#36). A light
 * survives it, because it is drawn at a floor in *screen* space rather than at
 * its physical size: `NAV_LIGHT_MIN_PX` below is 4 px, wider than the hull's
 * own height at these ranges. That is also what a real nav light does — you
 * keep the light long after you have lost the aeroplane.
 *
 * The colours are the aviation convention, and that is the half that earns its
 * place. Red to port and green to starboard means two lights showing is a merge
 * or a stern chase and one light showing tells you which way it is turning:
 * **aspect, read off two dots**, at a range where the hull is a smudge.
 *
 * Positions come from the built hull's own measured box, taken from the mesh
 * in front of this code rather than read off `HULL_SPECS`. The roster's `env`
 * is one *selected* variant's box (#181) and this builder runs for all three,
 * so reading the roster would put `b` and `c`'s lights on `a`'s dimensions.
 * A new hull needs no entry here. They are inset, so the fixture never grows
 * the box that the fleet-review spacing and the proportion tests both measure.
 *
 * **They do not blink.** A strobe is the strongest "that is a ship and not a
 * star" cue there is, and it would make every captured frame a function of the
 * clock: the view set is judged by eye against a previous run, and a light on
 * in one and off in the other is a difference the reviewer has to discount by
 * hand. A strobe wants a deterministic clock first.
 */
export const NAV_LIGHTS = [
	{ role: "port", color: 0xff2f1c },
	{ role: "starboard", color: 0x24ff62 },
	{ role: "dorsal", color: 0xe8f0ff },
	{ role: "tail", color: 0xffab3d },
] as const;

/**
 * Screen size at `NAV_LIGHT_REF_KM`, and the floor it never falls below.
 *
 * The floor is the whole point: a light that attenuated all the way down would
 * vanish at exactly the range the hull already has. It is also the number that
 * does the work — across the band a duel is actually fought in, 1 to 10 km, a
 * 0.2 km reference put every light on the floor, so the reference is set out at
 * half a kilometre and the floor raised until a light reads against a star
 * field rather than merely being present in the frame.
 */
const NAV_LIGHT_NEAR_PX = 15;
const NAV_LIGHT_MIN_PX = 4;
const NAV_LIGHT_MAX_PX = 30;
const NAV_LIGHT_REF_KM = 0.5;
/** Past this a light fades out, so distant traffic does not become a second
 *  star field competing with the real one. */
const NAV_LIGHT_FADE_KM = 40;
/**
 * How far proud of the hull surface a light sits, as a fraction of the hull's
 * longest axis.
 *
 * The first cut placed each light at its axis extreme of the *bounding box*,
 * at the centre of the other two — and a bounding-box extreme at the centre of
 * the other two axes is inside the fuselage on any ship-shaped hull. Three of
 * the four were buried in the metal and drew nothing; only the dorsal one,
 * which happened to land on the spine, was ever visible. Lights are placed on
 * the surface now, found by casting a ray in from outside.
 */
export const NAV_LIGHT_PROUD = 0.006;
/** Where the surface search starts, as a fraction of the hull's longest axis
 *  beyond the box — far enough that the ray begins in clear space. */
const NAV_LIGHT_STANDOFF = 0.2;

let navLightMaterial: THREE.ShaderMaterial | undefined;

/**
 * One shared material for every hull's lights.
 *
 * `uPixelRatio` is written in `onBeforeRender` rather than at build time
 * because `gl_PointSize` is in device pixels and this module has no renderer:
 * asking the renderer at draw time is the only way the floor above means the
 * same number of *CSS* pixels on a retina panel and on a probe's viewport.
 */
function navLightsMaterial(): THREE.ShaderMaterial {
	if (navLightMaterial) return navLightMaterial;
	navLightMaterial = shared(
		new THREE.ShaderMaterial({
			uniforms: {
				uPixelRatio: { value: 1 },
				uNearPx: { value: NAV_LIGHT_NEAR_PX },
				uMinPx: { value: NAV_LIGHT_MIN_PX },
				uMaxPx: { value: NAV_LIGHT_MAX_PX },
				uRefKm: { value: NAV_LIGHT_REF_KM },
				uFadeKm: { value: NAV_LIGHT_FADE_KM },
			},
			vertexShader: `
			attribute vec3 lightColor;
			uniform float uPixelRatio;
			uniform float uNearPx;
			uniform float uMinPx;
			uniform float uMaxPx;
			uniform float uRefKm;
			uniform float uFadeKm;
			varying vec3 vColor;
			varying float vFade;
			void main() {
				vColor = lightColor;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				float dist = max(-mv.z, 1e-5);
				gl_PointSize =
					clamp(uNearPx * (uRefKm / dist), uMinPx, uMaxPx) * uPixelRatio;
				vFade = 1.0 - smoothstep(uFadeKm * 0.5, uFadeKm, dist);
				gl_Position = projectionMatrix * mv;
			}
		`,
			fragmentShader: `
			varying vec3 vColor;
			varying float vFade;
			void main() {
				float r = min(length(gl_PointCoord - 0.5) * 2.0, 1.0);
				float core = 1.0 - r;
				float hot = pow(core, 4.0);
				// A white-hot centre inside a coloured halo. The centre is what
				// crosses the bloom threshold — a saturated red never would, its
				// luminance is a third — and the halo is what says which light it is.
				vec3 lit = mix(vColor, vec3(1.0), hot * 0.85);
				float intensity = (core * 0.5 + hot * 2.4) * vFade;
				if (intensity <= 0.0) discard;
				gl_FragColor = vec4(lit * intensity, 1.0);
			}
		`,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
	);
	navLightMaterial.name = "nav-lights";
	return navLightMaterial;
}

/** Place the four lights on a built hull's own surface. */
function addNavLights(
	root: THREE.Group,
	positions: Float32Array | null = navLightPositions(root),
) {
	if (!positions) return;
	const colors = new Float32Array(NAV_LIGHTS.length * 3);
	const color = new THREE.Color();
	NAV_LIGHTS.forEach((light, i) => {
		// The shader is raw, so its colours are linear. `setHex` decodes the
		// sRGB hex into three's linear working space, and that is the only
		// decode: a second `convertSRGBToLinear` here crushed every channel that
		// is not 0 or 255 (#300's review).
		color.setHex(light.color);
		colors.set([color.r, color.g, color.b], i * 3);
	});
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("lightColor", new THREE.BufferAttribute(colors, 3));
	const points = new THREE.Points(geometry, navLightsMaterial());
	points.name = "nav-lights";
	points.userData.navLightRoles = NAV_LIGHTS.map((l) => l.role);
	points.onBeforeRender = (renderer) => {
		navLightsMaterial().uniforms.uPixelRatio.value = renderer.getPixelRatio();
	};
	root.add(points);
}

/** Where the four lights go on a built hull, `NAV_LIGHTS` order, kilometres. */
function navLightPositions(root: THREE.Group): Float32Array | null {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	if (box.isEmpty()) return null;
	const size = new THREE.Vector3();
	const centre = new THREE.Vector3();
	box.getSize(size);
	box.getCenter(centre);
	const reach = Math.max(size.x, size.y, size.z);
	const standoff = reach * NAV_LIGHT_STANDOFF;
	const proud = reach * NAV_LIGHT_PROUD;
	const caster = new THREE.Raycaster();
	/**
	 * Come in from outside along `inward` and stop on the first metal.
	 *
	 * The fallback is the box face it started from: a hull with a gap on the
	 * centre line would otherwise get no light at all, and a light a little off
	 * the surface is a far smaller error than a missing one.
	 */
	const onSurface = (from: THREE.Vector3, inward: THREE.Vector3) => {
		caster.set(from, inward);
		const hit = caster.intersectObject(root, true).find((h) => h.face);
		// Proud of the surface, then **clamped back into the hull's own box**.
		//
		// Proud on its own is not enough, and the rebase onto #181 is what
		// proved it: `hull.test.ts` measures each roster envelope against
		// `setFromObject(root)`, which includes these points, and five hulls —
		// patrol, explorer, raider, carrier, dreadnought — present their aft
		// metal *at* `box.max.z`, so a tail light `proud` beyond it grew the
		// measured box by `reach × NAV_LIGHT_PROUD` (0.38 m on the raider) and
		// put every one of those rows 0.38 m over its declared length. That box
		// is what `berthFits` reads, so a lamp would have been sizing berths.
		//
		// On a flank the surface at the centre of the other two axes is inside
		// the box, so the clamp does nothing and the light still stands off the
		// metal; where it bites, the light lands exactly on the face it would
		// otherwise have passed through, which is still in front of the hull.
		// The clamp covers the fallback too, and not only for tidiness: `from`
		// is a box face pushed out by `standoff`, so the fallback's
		// `from + inward × standoff` is that face again only to within float
		// error — on `freighter/a`, whose flanks present no metal on the centre
		// line, it landed 0.4 um (3.8e-10 km) outside and the box grew by that.
		const at = hit
			? hit.point.clone().addScaledVector(inward, -proud)
			: from.clone().addScaledVector(inward, standoff);
		return at.clamp(box.min, box.max);
	};
	// The mesh's nose is -Z (`buildShipMesh`'s callers read it back out that
	// way), so the tail light comes in from the far +Z end.
	const at: Record<(typeof NAV_LIGHTS)[number]["role"], THREE.Vector3> = {
		port: onSurface(
			new THREE.Vector3(box.min.x - standoff, centre.y, centre.z),
			new THREE.Vector3(1, 0, 0),
		),
		starboard: onSurface(
			new THREE.Vector3(box.max.x + standoff, centre.y, centre.z),
			new THREE.Vector3(-1, 0, 0),
		),
		dorsal: onSurface(
			new THREE.Vector3(centre.x, box.max.y + standoff, centre.z),
			new THREE.Vector3(0, -1, 0),
		),
		tail: onSurface(
			new THREE.Vector3(centre.x, centre.y, box.max.z + standoff),
			new THREE.Vector3(0, 0, -1),
		),
	};
	const positions = new Float32Array(NAV_LIGHTS.length * 3);
	NAV_LIGHTS.forEach((light, i) => {
		const p = at[light.role];
		positions.set([p.x, p.y, p.z], i * 3);
	});
	return positions;
}

/** A part this hull draws as a gun: a pod or a muzzle ring. */
const GUN_PART = /-(hardpoint-[a-z]+|muzzle)$/;

const muzzleCache = new Map<string, readonly Vec3[]>();

/**
 * Where a hull's guns are (#607 D3), in the mesh's own frame: kilometres,
 * forward `-z`. There is one muzzle for each declared hardpoint
 * (`HULL_SPECS[id].hardpoints`, D5). In chase view the beam is drawn from
 * these, so the world position of a muzzle is the ship's position plus its
 * orientation applied to the muzzle.
 *
 * **Measured once from the built hull and returned as data**, as the nav
 * lights are placed from it. Nothing reads a position back out of the scene
 * graph at draw time, and no child is added, so the roster's hash and the
 * berth envelope do not move.
 *
 * Two sources. A hull that **draws** its guns — named `…-hardpoint-<side>`
 * or `…-muzzle` parts, as many as it has hardpoints — fires from each part's
 * forward tip. Every other hull gets its mounts on the forward surface: in
 * line across the beam at the hull's mid-height, mirrored about the centre
 * line, each found by a ray from in front, as a nav light is.
 */
/** Measure a hull's muzzles off the mesh just built for it, before it is
 *  placed, so the first chase shot reads them from the cache rather than
 *  building a second hull mid-frame (sage rounds 1–3 on #608). */
export function measureMuzzles(
	id: HullId,
	variant: HullVariantId,
	built: THREE.Group,
): void {
	shipMuzzlesKm(id, variant, built);
}

export function shipMuzzlesKm(
	id: HullId,
	variant: HullVariantId,
	built?: THREE.Group,
): readonly Vec3[] {
	// A mesh the caller has just built is measured rather than a second one
	// (sage round 2 on #608). It must not be placed yet: the measure is in the
	// hull's own frame. Checked before the cache, so a placed mesh is refused
	// whether or not this hull was measured already.
	if (
		built &&
		(built.parent !== null ||
			built.position.lengthSq() !== 0 ||
			!built.quaternion.equals(new THREE.Quaternion()) ||
			!built.scale.equals(new THREE.Vector3(1, 1, 1)))
	)
		throw new Error(`${id}: muzzles are measured off an unplaced mesh`);
	const key = `${id}/${variant}`;
	const known = muzzleCache.get(key);
	if (known) return known;
	const root = built ?? buildShipMesh(id, variant).root;
	root.updateMatrixWorld(true);
	const count = HULL_SPECS[id].hardpoints;
	const parts: THREE.Object3D[] = [];
	root.traverse((o) => {
		if (GUN_PART.test(o.name)) parts.push(o);
	});
	let muzzles: Vec3[];
	if (parts.length === count) {
		muzzles = parts.map((part) => {
			const b = new THREE.Box3().setFromObject(part);
			const c = b.getCenter(new THREE.Vector3());
			return { x: c.x, y: c.y, z: b.min.z };
		});
	} else muzzles = raycastMuzzles(root, count, key);
	const frozen = Object.freeze(muzzles.map((m) => Object.freeze(m)));
	muzzleCache.set(key, frozen);
	return frozen;
}

/** `shipMuzzlesKm`'s mounts for a hull with no gun parts. */
function raycastMuzzles(
	root: THREE.Group,
	count: number,
	hull: string,
): Vec3[] {
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const centre = box.getCenter(new THREE.Vector3());
	const standoff = Math.max(size.x, size.y, size.z) * NAV_LIGHT_STANDOFF;
	const caster = new THREE.Raycaster();
	// Mid-height first, then out from it an eighth of the height at a time:
	// two hulls have no metal ahead at mid-height on their gun lines, and a
	// mount placed on the empty box face there floated in space (sage round
	// 2 on #608).
	const heights = [0, 1, -1, 2, -2, 3, -3].map(
		(k) => centre.y + (k * size.y) / 8,
	);
	const onMetal = (x: number): Vec3 | null => {
		for (const y of heights) {
			caster.set(
				new THREE.Vector3(x, y, box.min.z - standoff),
				new THREE.Vector3(0, 0, 1),
			);
			const hit = caster.intersectObject(root, true).find((h) => h.face);
			if (hit && hit.point.z < centre.z) return { x, y, z: hit.point.z };
		}
		return null;
	};
	const mounts = (spread: number) =>
		Array.from({ length: count }, (_, i) =>
			onMetal(
				centre.x + (count === 1 ? 0 : spread * (2 * (i / (count - 1)) - 1)),
			),
		);
	// From a quarter of the beam either side, inward by halves until every
	// mount lands on the forward half. A narrow nose ahead of swept wings
	// otherwise put a pair on the wing roots, far aft (the interceptor, the
	// raider and two capitals did).
	let spread = size.x / 4;
	let found = mounts(spread);
	for (let i = 0; i < 6 && found.some((m) => m === null); i++) {
		spread /= 2;
		found = mounts(spread);
	}
	// No metal ahead on some gun line at any height: refused, never a gun on
	// an empty box face. `tests/ship-muzzles.test.ts` builds every hull.
	if (found.some((m) => m === null))
		throw new Error(`${hull}: no metal ahead for a gun`);
	return found as Vec3[];
}

/**
 * Draws an authored hull into `root`: the model, in the mesh's frame
 * (kilometres, nose `-z`), plus its drive glows named `…-exhaust` and drawn
 * in `exhaust`, the hull's own palette material, so the throttle dial and the
 * vent plumes (`isDriveBell`) find them as they find a procedural bell's.
 * Returns the model's levels for the detail band; the glows sit outside them,
 * so there is one drive bell per nozzle at every level.
 */
export type AuthoredHullBuilder = (
	root: THREE.Group,
	exhaust: THREE.MeshStandardMaterial,
) => ShipLevels | undefined;

/**
 * The hulls whose selected variant is an authored model installed after boot
 * (node #831's path): the courier (node #812) and the tug (node #814). Each is
 * drawn as its procedural loft — the stand-in — until its builder is
 * installed. Longwall B uses its procedural miner/a until its template is
 * installed (node #838).
 */
export const AFTER_BOOT_HULL_IDS = AUTHORED_HULL_MODELS;
export type AfterBootHullId = AuthoredHullModelId;

const authoredHulls = new Map<AfterBootHullId, AuthoredHullBuilder>();
/** An authored hull's nav lights, placed once. `addNavLights` finds the
 *  metal by raycast, and against the courier's 354k triangles that is a third
 *  of a second — paid by every Traffic ship drawn, were they not kept.
 *  The points' geometry is shared by every copy. Keyed on the model they
 *  were placed on, so removing it and putting it back — as an instrument
 *  drawing a loft beside it does — keeps them. */
const authoredNavLights = new WeakMap<AuthoredHullBuilder, THREE.Points>();

/**
 * Install (or, with `undefined`, remove) an authored hull exterior
 * (`courier-hull.ts`, `tug-hull.ts`). Until it is installed `buildShipMesh`
 * draws the procedural loft, as `buildStationForm` draws the procedural
 * Coriolis until `installCoriolisBuilder` runs. Games install it after boot
 * and rebuild their cached stand-ins; headless rows measuring the authored
 * hull install the shipped file themselves. The model is the hull's
 * **selected** variant, read off `HULL_SPECS`.
 */
export function installAuthoredHull(
	id: AfterBootHullId,
	builder: AuthoredHullBuilder | undefined,
): void {
	if (builder === authoredHulls.get(id)) return;
	if (builder) authoredHulls.set(id, builder);
	else authoredHulls.delete(id);
	// The muzzles were measured off whichever hull was drawn before.
	for (const key of muzzleCache.keys())
		if (key.startsWith(`${id}/`)) muzzleCache.delete(key);
}

/** The installed authored builder for a hull, if any: what an instrument
 *  (`scripts/measure-authored-hull-cost.mjs`) puts back after drawing the
 *  procedural loft beside it on the same page. */
export const authoredHullBuilder = (
	id: HullId,
): AuthoredHullBuilder | undefined =>
	isAfterBootHull(id) ? authoredHulls.get(id) : undefined;

/** Replace a pre-install stand-in's contents once (node #831), for whichever
 *  after-boot hull `root` is. The root stays in its cache and scene, with its
 *  name, visibility and pose untouched. A caller owning a wreck supplies its
 *  builder and disposer so the replacement stays dark and its cloned
 *  resources are freed. New resources are built before any old resources are
 *  freed. */
export function rebuildAuthoredStandIn(
	root: THREE.Object3D,
	build?: (id: AfterBootHullId) => THREE.Group,
	dispose: (root: THREE.Object3D) => void = disposeSubtree,
): boolean {
	const id = root.userData.hullId;
	if (
		!isAfterBootHull(id) ||
		!(id === "miner" ? longwallTemplate : authoredHulls.has(id)) ||
		root.userData.variant !== HULL_SPECS[id].variant ||
		root.userData.authored === true
	)
		return false;
	const replacement = build
		? build(id)
		: buildShipMesh(id, HULL_SPECS[id].variant).root;
	measureMuzzles(id, HULL_SPECS[id].variant, replacement);
	const parent = root.parent;
	dispose(root);
	root.clear();
	root.add(...replacement.children);
	root.userData = replacement.userData;
	if (parent && root.parent !== parent) parent.add(root);
	return true;
}

/** An authored hull into `root`: the model, its nav lights (placed once
 *  and cloned after) and the undetailed ship's adoption. */
function buildAuthoredHull(
	root: THREE.Group,
	id: AfterBootHullId,
	builder: AuthoredHullBuilder,
): void {
	root.userData.authored = true;
	const levels = builder(root, makePalette(id).exhaust);
	// After the model, for the reason the procedural branch gives: the
	// lights are placed from the built hull's own box.
	const known = authoredNavLights.get(builder);
	if (known) {
		const lights = known.clone();
		lights.onBeforeRender = known.onBeforeRender;
		root.add(lights);
	} else {
		addNavLights(root);
		const placed = root.getObjectByName("nav-lights") as THREE.Points;
		shared(placed.geometry);
		authoredNavLights.set(builder, placed);
	}
	adoptUndetailedShip(root, HULL_REACH_KM[id], levels);
}

export function buildShipMesh(
	id: HullId,
	variant: HullVariantId = "a",
): ShipMesh {
	const root = new THREE.Group();
	root.name = "hull-" + id;
	root.userData.hullId = id;
	root.userData.role = HULL_SPECS[id].role;
	root.userData.variant = variant;
	root.userData.designRound = SHIP_DESIGN_ROUND;
	const authored = authoredHullBuilder(id);
	if (authored && isAfterBootHull(id) && variant === HULL_SPECS[id].variant) {
		buildAuthoredHull(root, id, authored);
		return { root };
	}
	const plan =
		id === "miner" && variant === HULL_SPECS.miner.variant && !longwallTemplate
			? SHIP_DETAIL_PLANS.miner.a
			: SHIP_DETAIL_PLANS[id][variant];
	if (plan.authored) {
		root.userData.authored = true;
		// Nav lights come with the template, placed once (`prepareLongwall`).
		adoptUndetailedShip(
			root,
			HULL_REACH_KM[id],
			plan.build(root),
			plan.nearest,
		);
		return { root };
	}
	plan.build(root, makePalette(id));
	// Last, and it has to be: the lights are placed from the built hull's own
	// bounding box, so they cannot be added before there is a hull to measure.
	addNavLights(root);
	buildShipDetails(root, id, variant, plan, HULL_REACH_KM[id]);
	return { root };
}

/** Install the Porter on the shared after-boot path. It keeps its approved full mesh at every range. */
export function installAuthoredPorter(model: THREE.Object3D | null): void {
	installAuthoredHull(
		"freighter",
		model
			? (root) => {
					root.add(model.clone(true));
					return undefined;
				}
			: undefined,
	);
}

let authoredExhaust: THREE.MeshStandardMaterial | undefined;

/**
 * A drive glow for an authored model's nozzle: the procedural disc's material
 * and its `-exhaust` name, which the main drive's plumes are drawn at
 * (`isDriveBell`). The disc faces +Z of the geometry it is given; the caller
 * places and turns it in the model's own frame.
 */
export function authoredDriveGlow(name: string, radius: number): THREE.Mesh {
	authoredExhaust ??= shared(
		new THREE.MeshStandardMaterial({
			color: 0x7fc4df,
			emissive: 0x4a9fca,
			emissiveIntensity: SHIP_EMISSIVE_INTENSITIES.exhaust,
			roughness: 0.36,
			metalness: 0.08,
		}),
	);
	const glow = new THREE.Mesh(
		shared(new THREE.CircleGeometry(radius, 24)),
		authoredExhaust,
	);
	glow.name = name + EXHAUST_SUFFIX;
	return glow;
}

/** Whether `installAuthoredPorter` has run on this page. */
export const authoredPorterReady = (): boolean =>
	authoredHullBuilder("freighter") !== undefined;

/**
 * Is this variant an authored model rather than a loft (node #815)? The
 * procedural visual language — lofted, capped, swept, a named fuselage and
 * canopy, generated machinery zones — is a set of rules about how this module
 * builds a hull, and an authored model was approved as it is; the rows that
 * state those rules skip it by this, and `tests/longwall-mesh.test.ts` holds
 * what the authored model owes instead.
 */
export const isAuthoredHull = (id: HullId, variant: HullVariantId): boolean =>
	(id === "freighter" && variant === "b") ||
	SHIP_DETAIL_PLANS[id][variant].authored === true;
