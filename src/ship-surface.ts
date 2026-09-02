/**
 * How a ship hull's surfaces are *made*, as opposed to what shape they are —
 * `station-surface.ts`'s job, for the other side of #101's decision.
 *
 * The decision that node closed was **one generator, not two**: `surface.ts`
 * owns the arithmetic and stations, hulls and (when #105 lands) the cockpit
 * each hand it a profile. What is here is the Three-side half — the textures,
 * the material patch and the quality gate — and it is a separate module from
 * `ship-mesh.ts` for the reason `station-surface.ts` is separate from
 * `station-mesh.ts`: "how does this look like a material" is one subject, and
 * it does not need to know what a courier is.
 *
 * **Nothing here implements lighting.** The crease patch below writes
 * `roughnessFactor` and `diffuseColor` and leaves three.js's sun, fill,
 * environment and tone mapping exactly where they are — the same line
 * `station-surface.ts` holds, and for the same reason: a second lighting model
 * would have to be reconciled with #57's planet shaders.
 */

import * as THREE from "three";
import { scaleUVs, setUvUnits, uvUnitsOf } from "./loft";
import { type Splice, makeSplicer } from "./shader-splice";
import {
	type PlatingProfile,
	plateTexels,
	seamNormalTexels,
	wearTexels,
} from "./surface";

/**
 * How large one plate is on a hull, expressed as the world size of one whole
 * texture tile.
 *
 * `hullLoft` writes its UVs in **kilometres** — chord round the section,
 * distance along the sweep — so a consumer picks a panel *size* by dividing
 * rather than a panel *count* by multiplying. The map carries
 * `SHIP_MAP_SIZE / pitchPx` plates across and `aspect` times fewer along, so a
 * plate is `SHIP_PANEL_KM / 8` wide and four times that long: **one metre by
 * four** over an 8 m tile.
 *
 * A station's is `STATION_PANEL_KM = 0.15`, a 19 m plate. Nineteen metres on a
 * 54 m courier would put three plates on the entire ship.
 *
 * One constant is what separates the two **plate sizes**, and that is the whole
 * of what made a shared generator possible — not the whole of what separates the
 * two surfaces. A hull additionally cuts its seams into a normal map, filters
 * linearly rather than nearest, carries a crease term stations have none of, and
 * rescales four paints through one wear curve. The generator is shared; the
 * surfaces are not interchangeable.
 *
 * **One metre is a number set by looking**, and nothing in this repo can check
 * it. #104 recorded the general form of that: a figure deciding whether a frame
 * is worth looking at cannot be verified by anything that is not looking. A
 * plate is a *ruler* — it is how a pilot judges that a hull is 54 m and not
 * 540 — so retuning it means reopening the contact sheet.
 */
export const SHIP_PANEL_KM = 0.008;

/**
 * How large the hull's generated maps are, texels a side.
 *
 * Larger than the stations' 128, and the reason is the **groove**, not detail
 * in general. A seam has to be a scribed line rather than a bevel, so it wants
 * to be one or two texels; that is only a small fraction of a plate if a plate
 * is thirty-odd texels across. At 128 with eight plates across, a plate is 16
 * texels and the narrowest possible groove is still an eighth of it.
 *
 * Three buffers at 256 are 768 kB, generated once and shared by every hull in
 * the game. The stations stay at 128: their plate is nineteen metres and read
 * from kilometres away, and nothing about their seam wants to be finer.
 */
export const SHIP_MAP_SIZE = 256;

/**
 * The one plating profile every hull shares.
 *
 * One, not eleven. `ship-mesh.ts` caches a palette per hull id and shares it
 * across every mesh of that archetype; a per-archetype profile would multiply
 * the generated buffers by eleven for a difference no one can see at the range
 * a ship is seen from, and a per-*ship* one would break that cache outright.
 * Archetypes are told apart by silhouette and by livery, which is #35's answer
 * and is not being reopened here.
 *
 * The figures against a station's, and why they differ:
 *
 * - `pitchPx` 32 against a 256-texel map: **eight plates across, two rows
 *   down**, so a plate is four times longer than it is wide. The first version
 *   was an 8x8 square grid on a 128 map, and a wall of identical squares reads
 *   as *scales* — which is what it was called the first time somebody flew it.
 *   Rolled steel comes off the mill in strips and a hull is planked lengthwise.
 * - `stagger` 0.5 — a brick bond. At zero, a seam runs the entire length of the
 *   hull in both axes, and the eye names a grid before it names plating.
 * - `seamHalfWidthPx` 1 against a 32-texel plate: a **6% groove**. It was 2
 *   against a 16-texel plate, a quarter of every plate bevelled on all four
 *   sides — a 25 cm chamfer on a one-metre plate, where a real seam is
 *   millimetres. That domed every plate into a pillow, and it was the single
 *   largest reason the surface read as scales rather than as sheet.
 * - `variation` 6 against the stations' 13. Half the spread, because a hull is
 *   painted after it is planked: the plates should read as one skin with lines
 *   scribed into it, not as a patchwork of tones.
 * - `seam` 0.18 against the trade station's 0.30. The station's seam is the
 *   whole of its panel line; a hull's line is mostly **cut** rather than
 *   painted, so the albedo carries the shadow in the groove and no more.
 * - `weathering` 0.10 against 0.12–0.78. #98 refused the grime: hulls stay
 *   crisp built objects. It is not zero because a plate-to-plate variation that
 *   is *only* seams reads as a decal sheet.
 * - `roughness` and `metalness` are **1**, and that is not a placeholder. A
 *   station has one finish per role, so its profile can carry one; a hull has
 *   four — `hull`, `panel`, `trim` and `accent` are different paints — and one
 *   shared map cannot hold four. At 1 the map is the **wear curve alone**, and
 *   `plate` scales each material by its own #35 finish so all four survive.
 *
 *   Two wrong answers came before that, and both are worth keeping written
 *   down. Putting #35's 0.50 and 0.30 straight in these slots read a ceiling as
 *   a value: a clean plate came out at roughness 0.35, 30% smoother than the
 *   hull had ever been, and the star-facing nacelle in `hull-chase` clipped to
 *   white and spilled bloom under the hull. Raising them to the ceilings that
 *   put a clean plate back on 0.50/0.30 fixed the hull and silently repainted
 *   the other three: with `material.roughness` forced to 1, `panel`
 *   (0.58/0.36), `trim` (0.5/0.55) and `accent` (0.54/0.24) all rendered at the
 *   hull's 0.50/0.30, halving `trim`'s metalness. Both builds were green in
 *   both tiers, and the second one shipped a repaint under a docstring saying
 *   the fleet was not repainted.
 * - `seamDepth` 0.75 is the term the station has none of. #199's broader,
 *   lower-peak light made 0.55 move only 4.6% of hull pixels against the flat
 *   control, below the existing 5% reach gate. 0.70 landed exactly on the
 *   displayed 5.0% boundary but not above the strict gate; 0.75 clears it
 *   without widening the one-pixel groove into a trench.
 */
export const SHIP_PLATING: PlatingProfile = {
	pitchPx: 32,
	aspect: 4,
	stagger: 0.5,
	seamHalfWidthPx: 1,
	variation: 6,
	seam: 0.18,
	weathering: 0.1,
	roughness: 1,
	metalness: 1,
	seamDepth: 0.75,
};

/** What each `quality` setting gives a hull surface (#98's gate, #99's key).
 *
 *  Low drops the **seam normal map** and keeps the albedo and the wear map. It
 *  is the term with a second per-fragment texture sample and a tangent frame
 *  behind it; the other two are one sample each on a material that was already
 *  sampling. The seams do not disappear when it goes — the albedo still darkens
 *  them — they stop being lit, which is exactly the trade the setting is for. */
export const HULL_QUALITY = {
	high: { seamNormals: true },
	low: { seamNormals: false },
} as const;

export type HullQuality = keyof typeof HULL_QUALITY;

/**
 * The three generated maps, built once and shared by every hull in the game.
 *
 * Lazy for `station-mesh.ts`'s measured reason: built at module load they are
 * paid by every importer including the headless tests, none of which renders.
 * Shared, and therefore **never mutated** — the plating carries no per-ship
 * information, and a livery colour multiplies through the greyscale albedo.
 */
let maps: {
	albedo: THREE.Texture;
	wear: THREE.Texture;
	seams: THREE.Texture;
	/** What the wear map's two channels read on a clean plate — see
	 *  `cleanPlate`. */
	clean: { roughness: number; metalness: number };
} | null = null;

function hullMaps() {
	if (maps) return maps;
	// Generated once and handed to both: `wearTexels` derives its wear from the
	// albedo, so regenerating would run the plating loop twice and leave two
	// buffers that only happen to agree.
	const plate = plateTexels(SHIP_PLATING, "ship", SHIP_MAP_SIZE);
	const texture = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
		const map = new THREE.DataTexture(
			data,
			SHIP_MAP_SIZE,
			SHIP_MAP_SIZE,
			THREE.RGBAFormat,
		);
		// **sRGB on the albedo, linear on everything else.** three.js reads a
		// `map` as sRGB-encoded and a roughness, metalness or normal map as
		// linear data. Left at the default the authored plate value of 196 is
		// taken as linear 0.77 rather than sRGB 0.55 and every hull renders
		// materially darker than the arithmetic says — a whole-pass brightness
		// error whose only symptom is "the ships look dark".
		if (srgb) map.colorSpace = THREE.SRGBColorSpace;
		map.wrapS = THREE.RepeatWrapping;
		map.wrapT = THREE.RepeatWrapping;
		map.needsUpdate = true;
		return map;
	};
	const wearBytes = wearTexels(SHIP_PLATING, plate, SHIP_MAP_SIZE);
	const albedo = texture(plate, true);
	const wear = texture(wearBytes, false);
	const seams = texture(seamNormalTexels(SHIP_PLATING, SHIP_MAP_SIZE), false);
	// **Linear on the hull, nearest on the station.** A station's plating is
	// read at a few hundred pixels and its seams are meant to stay seams; a
	// hull's are a metre apart on an object the player parks next to, where
	// nearest sampling turns a groove into a staircase across the plate. The
	// normal map is the one that cannot take it at all: a quantised normal
	// shows as banding in the highlight rather than as a hard edge.
	for (const map of [albedo, wear, seams]) {
		map.magFilter = THREE.LinearFilter;
		map.minFilter = THREE.LinearMipmapLinearFilter;
		map.generateMipmaps = true;
	}
	maps = { albedo, wear, seams, clean: cleanPlate(wearBytes) };
	return maps;
}

/**
 * What the wear map's roughness and metalness channels read on a clean plate.
 *
 * **Measured off the shipped buffer, not restated from the curve.** The curve
 * is `0.55 + 0.45 × wear` and `1 − 0.8 × wear`, and a clean plate's `wear`
 * depends on the authored plate value, the panel-to-panel variation and the
 * grime — so a constant here would be a transcription of arithmetic three
 * profile fields can move, and `plate` would then scale every material by a
 * number that no longer described the map it was scaling.
 *
 * The median rather than the mean: the map is mostly clean plate with seams and
 * streaks below it, and a mean is pulled by exactly the texels this is meant to
 * exclude.
 */
function cleanPlate(wear: Uint8Array) {
	const median = (channel: number) => {
		const values: number[] = [];
		for (let i = 0; i < wear.length; i += 4) values.push(wear[i + channel]);
		values.sort((a, b) => a - b);
		return values[values.length >> 1] / 255;
	};
	return { roughness: median(1), metalness: median(2) };
}

/** The clean-plate factors, for a test that checks the finishes survive. */
export const cleanPlateFactors = () => hullMaps().clean;

/** Every hull material handed to `plate`, so the quality setting can reach them
 *  all. A `Set` and not a count: the gate has to put the map back, which means
 *  holding the materials rather than knowing how many there were.
 *
 *  **Bounded, and not by eviction.** Nothing is ever removed, and nothing needs
 *  to be: `ship-mesh.ts` caches one palette per hull id for the life of the
 *  process, so this holds four materials per archetype and cannot exceed that —
 *  44 at the eleven archetypes on the roster. A material reaches here only
 *  through `makePalette`, which is the same cache, so a scene being discarded
 *  frees no material this could drop. */
const plated = new Set<THREE.MeshStandardMaterial>();

/**
 * The setting in force, held here rather than passed to `plate`.
 *
 * Palettes are built lazily, on the first ship of an archetype — which for the
 * model workbench and `?fleet` is long after boot and long after the player may
 * have moved the setting. A material plated with whatever the caller happened
 * to know would be the one hull in the frame carrying the wrong term, and it
 * would be invisible until someone counted highlights. One value, one writer.
 */
let hullQuality: HullQuality = "high";

/**
 * The vertex half of the crease patch: carry `loft.ts`'s per-vertex crease into
 * the fragment stage.
 *
 * Declared `attribute float crease;` rather than read from a uniform because it
 * is geometry, not a setting — and a geometry that has none (three's own
 * primitives, which two ship parts still use) leaves the attribute undefined,
 * which WebGL reads as 0. That is the right default: no crease, no wear.
 */
const CREASE_VERTEX_COMMON = /* glsl */ `#include <common>
attribute float crease;
varying float vCrease;`;

const CREASE_VERTEX_BODY = /* glsl */ `#include <begin_vertex>
vCrease = crease;`;

const CREASE_FRAGMENT_COMMON = /* glsl */ `#include <common>
varying float vCrease;`;

/**
 * Edge wear, patched over three's `<roughnessmap_fragment>`.
 *
 * #101 chose **both** wear terms: the map's streaks for plate-to-plate
 * variation, and this for the edges. They answer different questions and
 * neither substitutes — a map in UV space has never been told which plates
 * meet, and a crease term knows nothing about soot.
 *
 * Two effects, both small, and #98's "wear subtle" is the budget:
 *
 * - **Rougher.** Paint on an edge is the paint that goes first, and bare
 *   worked metal scatters. This is the term that stops a highlight sweeping
 *   cleanly across a whole plate, which is the defect the node opened on.
 * - **Lighter.** A scuffed edge catches light, and it is what makes a crease
 *   read as a crease at the range where the geometry's own shading has already
 *   been averaged into the vertex normal.
 *
 * `<roughnessmap_fragment>` runs after `roughnessFactor` has taken the map's
 * green channel, so this is the last word on it; `diffuseColor` already carries
 * the albedo and the livery by this point in the chunk order.
 */
const CREASE_SURFACE = /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 1.0, vCrease * 0.45);
diffuseColor.rgb *= 1.0 + vCrease * 0.14;`;

/**
 * The four splices that carry `loft.ts`'s crease into the lighting.
 *
 * Its own function so `plate` below reads as assign the maps, patch the shader,
 * register the material — the nested `splice("vertex", splice("vertex", …))`
 * pairs have to be read inside-out, and that is one thing to read rather than a
 * third of a longer one.
 */
function patchCrease(
	shader: { vertexShader: string; fragmentShader: string },
	splice: Splice,
) {
	shader.vertexShader = splice(
		"vertex",
		splice(
			"vertex",
			shader.vertexShader,
			"#include <common>",
			CREASE_VERTEX_COMMON,
		),
		"#include <begin_vertex>",
		CREASE_VERTEX_BODY,
	);
	shader.fragmentShader = splice(
		"fragment",
		splice(
			"fragment",
			shader.fragmentShader,
			"#include <common>",
			CREASE_FRAGMENT_COMMON,
		),
		"#include <roughnessmap_fragment>",
		CREASE_SURFACE,
	);
}

/**
 * Give a hull material the shared plating, its seams and its edge wear.
 *
 * Idempotent by the `plated` set: `ship-mesh.ts` caches a palette per hull id,
 * so a material arrives here once, but a second call would otherwise install a
 * second `onBeforeCompile` and lose the first.
 */
export function plate(material: THREE.MeshStandardMaterial) {
	if (plated.has(material)) return material;
	const { albedo, wear, seams, clean } = hullMaps();
	material.map = albedo;
	material.roughnessMap = wear;
	material.metalnessMap = wear;
	/*
	 * **Each material keeps its own finish.** `MeshStandardMaterial` multiplies
	 * `roughness` by the map's green channel and `metalness` by its blue, so the
	 * scalar is a per-material dial over one shared curve — which is the only
	 * arrangement in which four paints survive one map.
	 *
	 * Forcing both to 1 was the round-two blocker: `panel` (0.58/0.36), `trim`
	 * (0.5/0.55) and `accent` (0.54/0.24) all rendered at whatever the map's
	 * clean plate happened to be, which halved `trim`'s metalness and made every
	 * paint on the hull the same material. It was a repaint of #35's livery
	 * shipped under a docstring saying the fleet was not repainted, and both
	 * test tiers were green on it.
	 *
	 * Divided by the clean-plate reading rather than used raw, so the finish the
	 * material arrives with is the finish a clean plate renders — the map is a
	 * *wear* curve and must not be a brightness offset on top of the paint.
	 * `userData.finish` records what was asked for, because after this the
	 * material no longer says.
	 */
	material.userData.finish = {
		roughness: material.roughness,
		metalness: material.metalness,
	};
	material.roughness = Math.min(1, material.roughness / clean.roughness);
	material.metalness = Math.min(1, material.metalness / clean.metalness);
	material.normalMap = HULL_QUALITY[hullQuality].seamNormals ? seams : null;
	material.normalScale = new THREE.Vector2(1, 1);
	const { log, splice } = makeSplicer("hull surface");
	// **Recorded now, not in the compile callback.** A probe that traverses for
	// this key before the first frame that draws a hull would otherwise find no
	// patched materials at all and read that as "nothing to check" rather than
	// as "not compiled yet". Empty until the program links, which is the honest
	// state and is what a probe should see.
	material.userData.hullSplices = log;
	material.onBeforeCompile = (shader) => patchCrease(shader, splice);
	// Two hulls with the same patch still compile twice unless they agree they
	// are the same program. Keyed by whether the normal map is on, because
	// three.js's own defines differ between the two and a shared key would hand
	// the second variant the first's program.
	material.customProgramCacheKey = () =>
		`ship-hull:${material.normalMap ? "seams" : "flat"}`;
	material.needsUpdate = true;
	plated.add(material);
	return material;
}

/**
 * Put the seam normal map on every hull, or take it off — #98's quality gate.
 *
 * Assignment rather than a rebuild, so the setting is **live**: #99's finding is
 * that a reload puts the ship somewhere else, and two frames from two positions
 * measure the positions as much as the term.
 */
export function applyHullQuality(quality: HullQuality) {
	hullQuality = quality;
	// **Before `hullMaps`.** This is called from `Game`'s boot-time quality pass,
	// which runs before any hull material exists, and building the three buffers
	// there would defeat the laziness the module is written for — the setting
	// would pay for maps nothing is using yet. `plate` reads `hullQuality` when
	// the first palette arrives.
	if (plated.size === 0) return;
	const { seams } = hullMaps();
	const on = HULL_QUALITY[quality].seamNormals;
	for (const material of plated) {
		const next = on ? seams : null;
		if (material.normalMap === next) continue;
		material.normalMap = next;
		// A material that gains or loses a map changes three.js's own defines,
		// so the program has to be relinked. Without this the frame keeps the
		// old shader and the setting appears to do nothing.
		material.needsUpdate = true;
	}
}

/**
 * Divide a lofted geometry's kilometre UVs down to plate coordinates.
 *
 * The three lines a station's `shell` already runs, on a hull, with the hull's
 * own panel size — which is the whole of what "reuse the station's material
 * system" turned out to mean. A *size* and not a *count*: multiplying a
 * normalised unwrap by a fixed count gives a 0.4 km dreadnought and a 0.054 km
 * tug the same number of bands, so one is coarse and the other a smear.
 */
export function plateUVs(geometry: THREE.BufferGeometry) {
	// **Idempotent, and it has to be.** `mirrorX` clones a geometry that may
	// already have been through here, and a part added twice would otherwise be
	// divided twice — plates 125 times too small on one side of the ship only,
	// which reads as a rendering fault rather than as a scale error.
	if (uvUnitsOf(geometry) !== "km") return geometry;
	if (!scaleUVs(geometry, 1 / SHIP_PANEL_KM, 1 / SHIP_PANEL_KM))
		return geometry;
	// `setUvUnits` and not an assignment: the fresh-`userData` rule that makes a
	// bare clone safe lives there, in the one place both writers reach.
	setUvUnits(geometry, "plate");
	return geometry;
}
