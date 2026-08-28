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
import { makeSplicer } from "./shader-splice";
import {
	PLATE_TEXTURE_SIZE,
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
 * `PLATE_TEXTURE_SIZE / pitchPx` panels across, so a plate is
 * `SHIP_PANEL_KM / that`: eight panels over 8 m of tile is a **one-metre
 * plate**.
 *
 * A station's is `STATION_PANEL_KM = 0.15`, a 19 m plate, and that is the whole
 * of the difference between the two surfaces — one constant, not one system.
 * Nineteen metres on a 54 m courier would put three plates on the entire ship.
 *
 * **One metre is a number set by looking**, and nothing in this repo can check
 * it. #104 recorded the general form of that: a figure deciding whether a frame
 * is worth looking at cannot be verified by anything that is not looking. A
 * plate is a *ruler* — it is how a pilot judges that a hull is 54 m and not
 * 540 — so retuning it means reopening the contact sheet.
 */
export const SHIP_PANEL_KM = 0.008;

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
 * - `seam` 0.18 against the trade station's 0.30. The station's seam is the
 *   whole of its panel line; a hull's line is mostly **cut** rather than
 *   painted, so the albedo carries the shadow in the groove and no more.
 * - `weathering` 0.10 against 0.12–0.78. #98 refused the grime: hulls stay
 *   crisp built objects. It is not zero because a plate-to-plate variation that
 *   is *only* seams reads as a decal sheet.
 * - `roughness` 0.72 and `metalness` 0.41 are **ceilings**, and that is the
 *   whole of why they are not #35's 0.50 and 0.30. `wearTexels` writes
 *   `roughness × (0.55 + 0.45 × wear)`, so a clean plate — `wear` 0.33 at the
 *   authored plate value of 196 — lands at `0.72 × 0.698 = 0.50` and
 *   `0.41 × 0.736 = 0.30`: #35's finish, exactly, with seams and streaks free to
 *   go rougher and less metallic from there.
 *
 *   Putting 0.50 and 0.30 in these slots was the first version, and it is the
 *   defect the contact sheet caught. A clean plate then came out at roughness
 *   0.35 — 30% smoother than the hull had ever been — and a smoother metal
 *   mirrors the baked star into a tighter lobe: the star-facing nacelle in
 *   `hull-chase` clipped to white and spilled bloom under the hull. Nothing in
 *   either test tier could see it, because both figures were exactly the
 *   numbers the spec said to use. The ceiling semantics are the thing to read
 *   twice.
 * - `seamDepth` 0.55 is the term the station has none of. Enough that a moving
 *   sun breaks across a seam, low enough that the line does not read as a
 *   trench — and, like the panel size, a number set in front of a frame.
 */
export const SHIP_PLATING: PlatingProfile = {
	pitchPx: 16,
	seam: 0.18,
	weathering: 0.1,
	roughness: 0.72,
	metalness: 0.41,
	seamDepth: 0.55,
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
} | null = null;

function hullMaps() {
	if (maps) return maps;
	// Generated once and handed to both: `wearTexels` derives its wear from the
	// albedo, so regenerating would run the plating loop twice and leave two
	// buffers that only happen to agree.
	const plate = plateTexels(SHIP_PLATING, "ship");
	const texture = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
		const map = new THREE.DataTexture(
			data,
			PLATE_TEXTURE_SIZE,
			PLATE_TEXTURE_SIZE,
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
	const albedo = texture(plate, true);
	const wear = texture(wearTexels(SHIP_PLATING, plate), false);
	const seams = texture(seamNormalTexels(SHIP_PLATING), false);
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
	maps = { albedo, wear, seams };
	return maps;
}

/** Every hull material handed to `plate`, so the quality setting can reach them
 *  all. A `Set` and not a count: the gate has to put the map back, which means
 *  holding the materials rather than knowing how many there were. */
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
 * Give a hull material the shared plating, its seams and its edge wear.
 *
 * Idempotent by the `plated` set: `ship-mesh.ts` caches a palette per hull id,
 * so a material arrives here once, but a second call would otherwise install a
 * second `onBeforeCompile` and lose the first.
 */
export function plate(material: THREE.MeshStandardMaterial) {
	if (plated.has(material)) return material;
	const { albedo, wear, seams } = hullMaps();
	material.map = albedo;
	material.roughnessMap = wear;
	material.metalnessMap = wear;
	// Multiplied by the map's green and blue channels, so these are the
	// ceilings rather than the values. Left at 1 the map would be the whole
	// answer and the profile's figures would be decoration.
	material.roughness = 1;
	material.metalness = 1;
	material.normalMap = HULL_QUALITY[hullQuality].seamNormals ? seams : null;
	material.normalScale = new THREE.Vector2(1, 1);
	const { log, splice } = makeSplicer("hull surface");
	material.onBeforeCompile = (shader) => {
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
		material.userData.hullSplices = log;
	};
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
	if (geometry.userData.platedUVs) return geometry;
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
	if (!uv) return geometry;
	geometry.userData.platedUVs = true;
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) / SHIP_PANEL_KM, uv.getY(i) / SHIP_PANEL_KM);
	uv.needsUpdate = true;
	return geometry;
}
