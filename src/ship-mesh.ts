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
	RING_SEGMENTS,
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
import { plate, plateUVs } from "./ship-surface";

export const SHIP_DESIGN_ROUND = 10;

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
			thesis:
				"dominant starboard cargo bank against a compact port command keel",
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
export const HULL_REACH_KM: Record<HullId, number> = {
	courier: 0.036,
	interceptor: 0.036,
	freighter: 0.04,
	miner: 0.042,
	patrol: 0.034,
	explorer: 0.044,
	raider: 0.038,
	// A capital hull is roughly seven couriers long. Nothing else in the pool
	// needs a second glance to work out which of two ships is the bigger; this
	// one has to answer that at a distance, which is why its detail is many
	// small repeated parts rather than a few large smooth ones.
	carrier: 0.2,
	tug: 0.031,
	prospector: 0.035,
	// Longer and narrower than the carrier, and it wears its armour outside.
	// Two capital classes only earn their places if they cannot be mistaken for
	// each other at the range a capital ship is first seen.
	dreadnought: 0.22,
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
};

const palettes = new Map<HullId, Palette>();

function makePalette(id: HullId): Palette {
	const cached = palettes.get(id);
	if (cached) return cached;
	const colors = liveries[id];
	const painted = (color: number, roughness: number, metalness: number) =>
		new THREE.MeshStandardMaterial({ color, roughness, metalness });
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
		panel: platedPaint(colors.panel, 0.58, 0.36),
		trim: platedPaint(0x33454d, 0.5, 0.55),
		accent: platedPaint(colors.accent, 0.54, 0.24),
		canopy: new THREE.MeshStandardMaterial({
			color: 0x173743,
			emissive: 0x061820,
			emissiveIntensity: 0.12,
			roughness: 0.2,
			metalness: 0.1,
		}),
		engine: painted(0x293b42, 0.42, 0.58),
		exhaust: new THREE.MeshStandardMaterial({
			color: 0x7fc4df,
			emissive: 0x4a9fca,
			emissiveIntensity: 0.55,
			roughness: 0.36,
			metalness: 0.08,
		}),
	};
	palettes.set(id, palette);
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
		name + "-exhaust",
		new THREE.CircleGeometry(radius * 0.55, 14),
		p.exhaust,
		[position[0], position[1], position[2] + length * 0.13],
	);
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
	const geometry = new THREE.TorusGeometry(radius, tube, 8, 22);
	scaleUVs(geometry, 2 * Math.PI * radius, 2 * Math.PI * tube);
	setUvUnits(geometry, "km");
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

function buildMinerB(root: THREE.Group, p: Palette) {
	add(
		root,
		"miner-fuselage",
		hullLoft([
			{ z: -0.0265, w: 0.0046, h: 0.0044, b: 0.0042, e: 3 },
			{ z: -0.0215, w: 0.0068, h: 0.0062, b: 0.006, e: 3.4, hard: true },
			{ z: -0.0155, w: 0.0068, h: 0.0062, b: 0.006, e: 3.4, hard: true },
			{ z: -0.0135, w: 0.0042, h: 0.004, b: 0.004, e: 3.2, hard: true },
			{ z: 0.0225, w: 0.0042, h: 0.004, b: 0.004, e: 3.2, hard: true },
			{ z: 0.026, w: 0.0094, h: 0.008, b: 0.0076, e: 4.2, hard: true },
			{ z: 0.036, w: 0.0094, h: 0.008, b: 0.0076, e: 4.2, hard: true },
			{ z: 0.038, w: 0.0082, h: 0.007, b: 0.0066, e: 3.4 },
		]),
		p.hull,
	);
	bridge(
		root,
		"miner",
		[
			{ z: -0.0245, w: 0.0044, h: 0.0022, b: 0.0024, y: 0.0044, e: 3 },
			{ z: -0.0195, w: 0.0072, h: 0.0038, b: 0.003, y: 0.0058, e: 3.4 },
			{ z: -0.0135, w: 0.0068, h: 0.0034, b: 0.003, y: 0.0064, e: 3.4 },
			{ z: -0.0095, w: 0.0048, h: 0.0022, b: 0.0024, y: 0.0058, e: 3 },
		],
		[
			{ z: -0.0235, w: 0.003, h: 0.0016, b: 0.0016, y: 0.0058, e: 2.7 },
			{ z: -0.0195, w: 0.0051, h: 0.003, b: 0.0021, y: 0.007, e: 3 },
			{ z: -0.0145, w: 0.0047, h: 0.0026, b: 0.002, y: 0.0076, e: 3 },
			{ z: -0.0115, w: 0.0033, h: 0.0016, b: 0.0016, y: 0.007, e: 2.7 },
		],
		p,
	);
	// The cutter works below the bow so the bridge keeps a clear forward cone.
	cutterHead(root, "miner-cutter", 0.0104, -0.0325, p, -0.0108);
	add(
		root,
		"miner-cutter-arm",
		strut([0, -0.0026, -0.0245], [0, -0.0108, -0.0315], 0.0034, 0.0026),
		p.trim,
	);
	// Ore rides the spine in line, one segment per pass, like a train of skips.
	for (const [tag, cz] of [
		["one", -0.0072],
		["two", 0.0055],
		["three", 0.018],
	] as const) {
		add(
			root,
			`miner-skip-${tag}`,
			revolve(drumProfile(0.0058, 0.0092)),
			p.panel,
			[0, 0, cz],
		);
		add(root, `miner-skip-band-${tag}`, hoop(0.0094, 0.0008), p.accent, [
			0,
			0,
			cz,
		]);
	}
	for (const [side, sign] of [
		["starboard", 1],
		["port", -1],
	] as const) {
		add(
			root,
			"miner-nacelle-mount-" + side,
			mirroredBlade(
				[
					{ z: 0.0068, w: 0.0028, h: 0.0068, b: 0.0064, y: 0.0265, e: 3.2 },
					{ z: 0.019, w: 0.0024, h: 0.006, b: 0.0056, y: 0.0305, e: 3 },
				],
				sign,
			),
			p.trim,
		);
		add(
			root,
			"miner-" + side + "-nacelle",
			hullLoft(pod(0.018, 0.0355, 0.0048, { x: sign * 0.0202 })),
			p.panel,
		);
		add(root, "miner-collar-" + side, hoop(0.0051, 0.0006), p.accent, [
			sign * 0.0202,
			0,
			0.031,
		]);
		engineBell(
			root,
			"miner-" + side,
			[sign * 0.0202, 0, 0.0395],
			0.0042,
			0.0044,
			p,
		);
	}
	engineBell(root, "miner-core", [0, 0, 0.04], 0.0058, 0.006, p);
	blister(root, "miner-sensor", 0.0016, [0.0032, 0.0052, -0.008], p);
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

/**
 * One entry per model.
 *
 * The chain of `if (variant === "a")` this replaces was already hard to read at
 * nine hulls; at eighteen a missing branch would fall through to some other
 * role's shape rather than failing, which is exactly the silent default the
 * spec forbids.
 */
const BUILDERS: Record<HullId, Record<HullVariantId, Builder>> = {
	courier: { a: buildCourierA, b: buildCourierB, c: buildCourierC },
	interceptor: {
		a: buildInterceptorA,
		b: buildInterceptorB,
		c: buildInterceptorC,
	},
	freighter: { a: buildFreighterA, b: buildFreighterB, c: buildFreighterC },
	miner: { a: buildMinerA, b: buildMinerB, c: buildMinerC },
	patrol: { a: buildPatrolA, b: buildPatrolB, c: buildPatrolC },
	explorer: { a: buildExplorerA, b: buildExplorerB, c: buildExplorerC },
	raider: { a: buildRaiderA, b: buildRaiderB, c: buildRaiderC },
	carrier: { a: buildCarrierA, b: buildCarrierB, c: buildCarrierC },
	tug: { a: buildTugA, b: buildTugB, c: buildTugC },
	prospector: {
		a: buildProspectorA,
		b: buildProspectorB,
		c: buildProspectorC,
	},
	dreadnought: {
		a: buildDreadnoughtA,
		b: buildDreadnoughtB,
		c: buildDreadnoughtC,
	},
};

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
	BUILDERS[id][variant](root, makePalette(id));
	return { root };
}
