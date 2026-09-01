/**
 * How the cockpit interior's surfaces are *made* — #105, and the third
 * consumer `surface.ts` was written for.
 *
 * The decision #101 closed was **one generator, not two**, and it named this
 * module before it existed: `surface.ts:11` says "then three times, when the
 * cockpit arrives". So what is here is a profile, a panel size, the Three-side
 * textures and the quality gate — the same shape as `ship-surface.ts` — and no
 * arithmetic that module does not already own.
 *
 * **Nothing here implements lighting.** Same line `ship-surface.ts` and
 * `station-surface.ts` hold: the sun, the hemisphere, the baked environment and
 * the tone mapping stay `light-rig.ts`'s and three's.
 *
 * ## What #105 found before it changed anything
 *
 * Every readable surface in the cabin is a `MeshBasicMaterial` — the canopy
 * glass, the scanner, both instrument faces, the hologram lines. Three's
 * `scene.environment` and every light reach `MeshStandardMaterial` and nothing
 * else, so the hazard the node opened on (a reflection landing on the glass a
 * player reads velocity through) is closed by material *class*, not by an
 * exclusion list somebody has to maintain. The one standard material that is a
 * readout is the throttle fill, and it is a bar rather than text; `main.ts`
 * keeps it off `plateCockpit` deliberately.
 *
 * The other finding is a scale one and it decides the constant below. The cabin
 * is authored at roughly a hundred times life size — the canopy is 0.1 km
 * across — so that its nearest face clears the 10 m near plane and the camera
 * cannot slice it open on a head turn. A panel size therefore cannot be derived
 * from metres here the way `SHIP_PANEL_KM` was: `SHIP_PANEL_KM` would put about
 * a hundred plates across the canopy sill. It is set by *apparent* size on the
 * contact sheet, which is #104's class of number all over again.
 */

import * as THREE from "three";
import { boxProjectUVs, setUvUnits } from "./loft";
import {
	type PlatingProfile,
	plateTexels,
	seamNormalTexels,
	wearTexels,
} from "./surface";

/**
 * The world size of one whole texture tile inside the cabin, kilometres.
 *
 * At `COCKPIT_MAP_SIZE / pitchPx` = 8 plates across a tile and `aspect` = 2
 * rows fewer along, one plate is 3 m by 6 m in the cabin's own oversized
 * coordinates — which puts about **eleven plates across the scanner deck**, the
 * cabin's largest continuous surface and the one nearest the eye.
 *
 * Eleven is the number that was set by looking, and the metres are a
 * consequence of the cabin's hundred-fold scale rather than a claim about a
 * real spacecraft. `tests/cockpit-surface.test.ts` bands the plate count
 * against the deck so a retune cannot silently make the cabin a fine grid or a
 * pair of slabs; it does not, and cannot, assert that eleven is right. That is
 * the sheet's, and retuning this means reopening those PNGs.
 */
export const COCKPIT_PANEL_KM = 0.024;

/**
 * How large the cabin's generated maps are, texels a side.
 *
 * 256, the hull's figure rather than the stations' 128, and for the hull's
 * reason one step stronger: the cockpit is the **closest geometry to the camera
 * in the game** and it never leaves the frame. A seam has to be a scribed line,
 * so it wants to be one or two texels, and that is only a small fraction of a
 * plate if a plate is thirty-odd texels across.
 *
 * Three buffers at 256 are 768 kB, generated once and shared by every fitting
 * in the cabin.
 */
export const COCKPIT_MAP_SIZE = 256;

/**
 * The one plating profile every cabin fitting shares.
 *
 * Against `SHIP_PLATING`, and why each figure differs — a pressure hull's
 * inside and outside are not the same material, which is the half of #105's
 * second question that a shared *generator* does not answer:
 *
 * - `aspect` **2** against the hull's 4. A hull is planked with rolled steel
 *   strips and wants to read that way; a cabin is *lined* with fitted panels,
 *   which are closer to square without being square. Still a brick bond at
 *   `stagger` 0.5, because 1-and-0 together is the square grid #101 shipped and
 *   the principal rejected as scales on the first frame flown.
 * - `variation` **4** against 6. A cabin lining is painted as one job in one
 *   shop; the plates should read as one skin with lines scribed into it.
 * - `seam` **0.22** against 0.18. An interior seam is a shadowed gap and there
 *   is no direct sun inside to cut it, so more of the line has to be carried by
 *   the albedo than on a hull.
 * - `weathering` **0.06**, the lowest in the game. #98 refused the grime
 *   outright and a pressurised cabin is the cleanest surface there is. Not
 *   zero, for `SHIP_PLATING`'s reason: a plate-to-plate variation that is only
 *   seams reads as a decal sheet.
 * - `seamHalfWidthPx` **1** against a 32-texel pitch — a 6% groove, the hull's
 *   figure unchanged. It is the single largest driver of the scale-like read
 *   and there is no reason for the cabin to answer it differently.
 * - `roughness` and `metalness` **1**, and that is not a placeholder. The cabin
 *   has three finishes — `COCKPIT_FINISHES` — and one shared map cannot hold
 *   three. At 1 the map is the **wear curve alone** and each material scales it
 *   by its own finish, so all three survive. Forcing them flat was #101's
 *   round-two blocker: three paints rendered as one, green in both tiers, under
 *   a docstring saying nothing was repainted.
 *
 *   1 is where the *calibration pass* starts rather than where it ends — see
 *   `cockpitMaps`. The cabin's roughest finish is 0.72 and a clean plate at
 *   profile 1 reads 0.702, so `metal`'s dial would need 1.026 and a dial cannot
 *   exceed 1. That is `station-types.md`'s clamp-bite shape (#13) one map over:
 *   the roughest material is the one whose roughness stops being expressible.
 * - `seamDepth` **0.5**, just under the hull's 0.55. The cabin's own light is
 *   soft and close, so a deeper groove reads as a trench rather than a line.
 */
export const COCKPIT_PLATING: PlatingProfile = {
	pitchPx: 32,
	aspect: 2,
	stagger: 0.5,
	seamHalfWidthPx: 1,
	variation: 4,
	seam: 0.22,
	weathering: 0.06,
	roughness: 1,
	metalness: 1,
	seamDepth: 0.5,
};

/**
 * The cabin's three structural finishes.
 *
 * **Here rather than inline in `buildCockpit`**, and that is what makes the
 * calibration below possible at all: a module that does not know what the
 * roughest finish in the cabin is cannot tell whether the wear map can express
 * it. `main.ts` built these three inline and #105 moved them, unchanged — the
 * figures are the ones the cabin has had since #35 and nothing here repaints
 * them.
 *
 * `inset` has no emissive because it is a recess. The other two carry the faint
 * self-lift they were authored with; `COCKPIT_TRIM` is a separate, brighter
 * thing and is not one of these.
 */
export const COCKPIT_FINISHES = {
	metal: {
		color: 0x0a1114,
		roughness: 0.72,
		metalness: 0.48,
		emissive: 0x010304,
		emissiveIntensity: 0.08,
	},
	trim: {
		color: 0x1a2c32,
		roughness: 0.46,
		metalness: 0.72,
		emissive: 0x03090b,
		emissiveIntensity: 0.14,
	},
	inset: {
		color: 0x020607,
		roughness: 0.48,
		metalness: 0.3,
		emissive: 0x000000,
		emissiveIntensity: 0,
	},
} as const;

export type CockpitFinish = keyof typeof COCKPIT_FINISHES;

export const COCKPIT_FINISH_IDS = Object.keys(
	COCKPIT_FINISHES,
) as CockpitFinish[];

/**
 * The emissive trim that carries the cabin's warmth — #105's first question,
 * answered emissive-led.
 *
 * The finding it answers: `cockpit-arrival` (sun ahead) and `cockpit-backlit`
 * (sun 175° beyond the station) are near-identical *inside*. The cabin is lit
 * almost entirely through the canopy, and the one interior lamp — a point light
 * at 0.35 with a 0.065 km range — moves neither frame. The reference cabins are
 * lit from inside.
 *
 * Emissive rather than more lights, for two reasons. It costs nothing
 * per-fragment where a light costs a term on every near-layer surface in the
 * frame; and it is what #98 said to take from the reference ("the emissive
 * density"), where raising a light is the move #99 listed to rule out.
 *
 * **Near-neutral on purpose.** `hud-and-scanner.md` §4 gives amber, cyan, green
 * and red meanings as *readings*. A structural strip glowing in one of them is
 * a reading the player cannot act on, so this is warmth without a signal — and
 * `tests/cockpit-surface.test.ts` fails a retune that saturates it.
 */
export const COCKPIT_TRIM = {
	color: 0xffd9a8,
	/**
	 * Low: this is a lit edge in a dark cabin, not a lamp. It is also what
	 * #103's selective bloom will pick up first, so it is set below the
	 * instrument faces rather than beside them.
	 *
	 * **0.9 was flown and rejected on the first sheet.** At that value the
	 * header and sill strips render as solid white bars, and the bloom around
	 * them lifts the coaming the flight-floor strip is read against — which is
	 * the regression this node is explicitly forbidden from causing. 0.26 is a
	 * lit edge that describes the canopy opening without competing with the
	 * instruments, which is the whole job.
	 */
	intensity: 0.26,
} as const;

/**
 * The warm key over the console — the one real light #105 adds.
 *
 * The trim above gives the cabin emissive warmth but no *gradient*: an emissive
 * strip lights itself and nothing else. This is what puts a falloff across the
 * deck and the console tops, which are the flat tones the node opened on.
 *
 * Parented to the cockpit group like the existing lamp, so it stays the pilot's
 * own light as the ship turns rather than behaving like a second sun. Warm
 * against the existing lamp's `0x9bc5dc`, which is the contrast the reference
 * cabins have and this one does not.
 */
export const COCKPIT_KEY_LIGHT = {
	color: 0xffc98a,
	/**
	 * **0.55 was flown and rejected with the trim above.** A point light at
	 * 20 m from a deck it is 12 m above washed the whole console assembly to a
	 * pale warm grey and took the flight floor's dark backing with it. The
	 * gradient is the point, not the lift: 0.18 leaves the deck reading at its
	 * own tone and falls off across it.
	 */
	intensity: 0.18,
	/** Kilometres, in the cabin's oversized frame. Short enough that it reaches
	 *  the deck and the console tops and dies before the canopy — a key that
	 *  reached the glass would light the frame the player sees space through. */
	rangeKm: 0.05,
	/**
	 * Above the scanner deck, not above the console's near lip.
	 *
	 * At z −0.03 the light sat behind the deck and its hot spot landed on the
	 * lip nearest the camera, which blew to white across the middle of the
	 * frame and bloomed — a light leak rather than a gradient. Over the deck
	 * (z −0.038) the falloff runs away from the eye instead.
	 */
	position: [0, 0.014, -0.038] as const,
} as const;

/** What each `quality` setting gives the cabin (#98's gate, #99's key).
 *
 *  Low drops the **seam normal map** and keeps the albedo and the wear map —
 *  `HULL_QUALITY`'s rule unchanged, deliberately, so there is one answer for
 *  every plated surface in the game rather than one per surface. It is also
 *  what `settings.ts` already promises the player: low "cuts the panel lines"
 *  goes, the painted seams stay, the cabin stays lit. The trim and both lights
 *  are untouched by it. */
export const COCKPIT_QUALITY = {
	high: { seamNormals: true },
	low: { seamNormals: false },
} as const;

export type CockpitQuality = keyof typeof COCKPIT_QUALITY;

/**
 * The three generated maps, built once and shared by every fitting.
 *
 * Lazy for `ship-surface.ts`'s measured reason: built at module load they are
 * paid by every importer including the headless tests, none of which renders.
 */
let maps: {
	albedo: THREE.Texture;
	wear: THREE.Texture;
	seams: THREE.Texture;
	clean: { roughness: number; metalness: number };
} | null = null;

/** One plating pass: the albedo, the wear derived from it, and what the wear
 *  reads on a clean plate. Generated together and handed to both, because
 *  `wearTexels` derives from the albedo and regenerating would leave two
 *  buffers that only happen to agree. */
function platingPass(profile: PlatingProfile) {
	const albedo = plateTexels(profile, "cockpit", COCKPIT_MAP_SIZE);
	const wear = wearTexels(profile, albedo, COCKPIT_MAP_SIZE);
	return { albedo, wear, clean: cleanPlate(wear) };
}

/**
 * Lift the profile's `roughness` and `metalness` until the cabin's strongest
 * finish has a dial of exactly 1, and no further.
 *
 * A material's dial is `finish / clean`, and `MeshStandardMaterial` has no dial
 * above 1 — so a finish rougher than a clean plate simply cannot be asked for,
 * and clamping it is a silent repaint of exactly the kind #101 shipped once.
 * The cabin's roughest finish is 0.72 against a clean plate of 0.702 at profile
 * 1, so the lift needed is about 2.6%; its most metallic is 0.72 against 0.726,
 * which needs none.
 *
 * **Measured rather than transcribed.** The factor is read off the first pass's
 * own buffer, so a change to `variation`, `seam` or `weathering` — all three
 * move the clean plate — recalibrates instead of drifting. A constant here
 * would be the transcription `cleanPlate` exists to avoid, one level up.
 *
 * The cost is that the seam and grime texels, which are the *rougher* end of
 * the curve, clip against 255 rather than running to 1.026. That is a 2.6%
 * squeeze on texels already at the ceiling, and it is the reason the lift is
 * "just enough" rather than a round number with headroom: a larger factor
 * flattens the top of the wear curve, which is the seam contrast the map is
 * for.
 */
function calibrate(): { profile: PlatingProfile; needed: number } {
	const first = platingPass(COCKPIT_PLATING);
	const strongest = (key: "roughness" | "metalness") =>
		Math.max(...COCKPIT_FINISH_IDS.map((id) => COCKPIT_FINISHES[id][key]));
	const lift = (key: "roughness" | "metalness") =>
		Math.max(1, strongest(key) / first.clean[key]);
	const needed = Math.max(lift("roughness"), lift("metalness"));
	return {
		profile: {
			...COCKPIT_PLATING,
			roughness: COCKPIT_PLATING.roughness * lift("roughness"),
			metalness: COCKPIT_PLATING.metalness * lift("metalness"),
		},
		needed,
	};
}

/** The calibrated profile the shipped maps are generated from, so a test can
 *  read what the pass decided rather than restate it. */
export const calibratedProfile = () => calibrate().profile;

function cockpitMaps() {
	if (maps) return maps;
	const { profile } = calibrate();
	const pass = platingPass(profile);
	const plate = pass.albedo;
	const texture = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
		const map = new THREE.DataTexture(
			data,
			COCKPIT_MAP_SIZE,
			COCKPIT_MAP_SIZE,
			THREE.RGBAFormat,
		);
		// **sRGB on the albedo, linear on everything else** — `ship-surface.ts`
		// carries the argument. Left at the default the authored plate value of
		// 196 is read as linear 0.77 rather than sRGB 0.55 and the whole cabin
		// renders materially darker than the arithmetic says.
		if (srgb) map.colorSpace = THREE.SRGBColorSpace;
		map.wrapS = THREE.RepeatWrapping;
		map.wrapT = THREE.RepeatWrapping;
		map.needsUpdate = true;
		return map;
	};
	const albedo = texture(plate, true);
	const wear = texture(pass.wear, false);
	const seams = texture(seamNormalTexels(profile, COCKPIT_MAP_SIZE), false);
	// Linear, like the hull and unlike the station: this is the surface the
	// player is closest to in the entire game, and nearest sampling turns a
	// groove into a staircase across the plate.
	for (const map of [albedo, wear, seams]) {
		map.magFilter = THREE.LinearFilter;
		map.minFilter = THREE.LinearMipmapLinearFilter;
		map.generateMipmaps = true;
	}
	maps = { albedo, wear, seams, clean: pass.clean };
	return maps;
}

/**
 * What the wear map's roughness and metalness channels read on a clean plate.
 *
 * **Measured off the shipped buffer, not restated from the curve** —
 * `ship-surface.ts:216` has the argument. A constant here would be a
 * transcription of arithmetic three profile fields can move, and
 * `plateCockpit` would then scale every material by a number that no longer
 * described the map it was scaling.
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

/** The clean-plate factors, for the test that checks the three finishes
 *  survive. */
export const cockpitCleanPlate = () => cockpitMaps().clean;

/** Every cabin material handed to `plateCockpit`, so the quality setting can
 *  reach them all. A `Set` and not a count: the gate has to put the map back.
 *
 *  Bounded and not by eviction — `buildCockpit` runs once per `Game` and makes
 *  three structural materials, so this holds three. */
const plated = new Set<THREE.MeshStandardMaterial>();

/**
 * The setting in force, held here rather than passed to `plateCockpit`.
 *
 * `ship-surface.ts:256`'s reason, and it applies here too: `buildCockpit` runs
 * from `Game`'s constructor while the boot-time quality pass may run either
 * side of it, and a material plated with whatever the caller happened to know
 * would be the one surface in the frame carrying the wrong term. One value, one
 * writer.
 */
let cockpitQuality: CockpitQuality = "high";

/**
 * Write a cabin fitting's UVs in kilometres, then divide them to plates.
 *
 * **Returns the geometry to use**, because `toNonIndexed()` produces a new one:
 * three's primitives are indexed and `boxProjectUVs` reads each run of three
 * vertices as a face, so handing it an indexed box writes a projection off a
 * normal computed from three vertices that are not a triangle. Ignoring the
 * return value leaves the original untouched and the fitting unplated, which
 * looks exactly like the map not having loaded.
 *
 * Idempotent by construction rather than by a guard: the projection writes UVs
 * *from the positions* rather than scaling what is there, so a second pass
 * lands the same numbers. `plateUVs` on the ship side does scale and does need
 * the guard, which is why this says so.
 */
export function plateCockpitUVs(
	geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
	const flat = geometry.index ? geometry.toNonIndexed() : geometry;
	boxProjectUVs(flat, COCKPIT_PANEL_KM);
	setUvUnits(flat, "plate");
	return flat;
}

/**
 * One material's dial over the shared wear curve, or a refusal.
 *
 * **Loud rather than clamped**, which is the map's own rule for an instrument
 * (#7: a measurement that quietly reports garbage is worse than one that dies).
 * A clamp here is a repaint — the material renders at the clean plate's finish
 * instead of its own — and it is invisible in both test tiers, which is exactly
 * how #101 shipped one. `calibrate` guarantees every declared cabin finish is
 * expressible, so reaching this throw means a finish was added or a profile
 * field moved without the calibration seeing it.
 */
function dial(key: string, finish: number, clean: number): number {
	const value = finish / clean;
	if (value > 1)
		throw new Error(
			`cockpit ${key} ${finish} needs a dial of ${value.toFixed(3)} over a clean plate of ${clean.toFixed(3)}; MeshStandardMaterial has none above 1`,
		);
	return value;
}

/**
 * A cabin material, plated, with its finish intact.
 *
 * The one way to make one: `buildCockpit` used to construct three
 * `MeshStandardMaterial`s inline, and a finish declared at the call site is a
 * finish the calibration pass cannot see.
 */
export function cockpitMaterial(finish: CockpitFinish) {
	const spec = COCKPIT_FINISHES[finish];
	const material = new THREE.MeshStandardMaterial({
		color: spec.color,
		roughness: spec.roughness,
		metalness: spec.metalness,
		emissive: spec.emissive,
		emissiveIntensity: spec.emissiveIntensity,
	});
	material.name = `cockpit-${finish}`;
	return plateCockpit(material);
}

/**
 * Give a cabin material the shared plating, its seams and its own finish back.
 *
 * Idempotent by the `plated` set. **Not for a readout**: the throttle fill is a
 * `MeshStandardMaterial` and is deliberately not passed here — plating a bar
 * whose length is the reading would put a seam across the value.
 */
export function plateCockpit(material: THREE.MeshStandardMaterial) {
	if (plated.has(material)) return material;
	const { albedo, wear, seams, clean } = cockpitMaps();
	material.map = albedo;
	material.roughnessMap = wear;
	material.metalnessMap = wear;
	/*
	 * **Each material keeps its own finish**, which is the whole of what stops
	 * `metal`, `trim` and `inset` becoming one material. `MeshStandardMaterial`
	 * multiplies `roughness` by the map's green channel and `metalness` by its
	 * blue, so the scalar is a per-material dial over one shared curve.
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
	material.roughness = dial("roughness", material.roughness, clean.roughness);
	material.metalness = dial("metalness", material.metalness, clean.metalness);
	material.normalMap = COCKPIT_QUALITY[cockpitQuality].seamNormals
		? seams
		: null;
	material.normalScale = new THREE.Vector2(1, 1);
	// Keyed by whether the normal map is on, for `ship-surface.ts`'s reason:
	// three's own defines differ between the two variants and a shared key would
	// hand the second one the first's program.
	material.customProgramCacheKey = () =>
		`cockpit-surface:${material.normalMap ? "seams" : "flat"}`;
	material.needsUpdate = true;
	plated.add(material);
	return material;
}

/**
 * Put the seam normal map on every cabin fitting, or take it off — #98's gate.
 *
 * Assignment rather than a rebuild, so the setting is **live**: #99's finding is
 * that a reload puts the ship somewhere else, and two frames from two positions
 * measure the positions as much as the term.
 */
export function applyCockpitQuality(quality: CockpitQuality) {
	cockpitQuality = quality;
	// **Before `cockpitMaps`**, so a boot-time quality pass that runs ahead of
	// `buildCockpit` does not pay for three buffers nothing is using yet.
	if (plated.size === 0) return;
	const { seams } = cockpitMaps();
	const on = COCKPIT_QUALITY[quality].seamNormals;
	for (const material of plated) {
		const next = on ? seams : null;
		if (material.normalMap === next) continue;
		material.normalMap = next;
		// A material that gains or loses a map changes three's own defines, so
		// the program has to be relinked. Without this the frame keeps the old
		// shader and the setting appears to do nothing.
		material.needsUpdate = true;
	}
}
