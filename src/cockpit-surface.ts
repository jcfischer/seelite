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
 * **The scene's rig is not here.** The sun, the hemisphere, the baked
 * environment and the tone mapping stay `light-rig.ts`'s and three's — the line
 * `ship-surface.ts` and `station-surface.ts` hold, and for their reason: a
 * second lighting model would have to be reconciled with #57's planet shaders.
 *
 * **The cabin's own lights are not here either.** They were — `COCKPIT_LAMP`
 * and `COCKPIT_KEY_LIGHT`, the procedural arch's rail lamps and its key — and
 * left with the arch (#887). The authored cabin's lights are
 * `COCKPIT_MODEL_LAMPS` and the perimeter lamps in `cockpit-model.ts`: cabin
 * furniture rather than scene lighting, parented to the cockpit group. What
 * stays here is the quality gate they go through (`registerKeyLight`).
 *
 * **Their cost is per fragment of their scene, and an earlier draft of this
 * said they had none.** Three evaluates a `PointLight` for every
 * `MeshStandardMaterial` in its scene; `distance` clamps what it adds, not
 * the arithmetic that adds nothing. Until #651 that scene was `nearScene`, so
 * hulls and station plating paid for the cabin's lights, and #105's key
 * light was gated for exactly that reason. Since #651 the cabin is drawn in a
 * scene of its own (`cabin-pass.ts`) and only its fittings pay. `settings.ts`
 * carries which side of the quality gate each one is on.
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
import { EMISSIVE_CEILING } from "./light-rig";
import { chamferedBox } from "./chamfer-box";
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
 * **0.072, and the first answer was 0.024.** At 0.024 the deck carried about
 * eleven plates and the cabin was flown against the reference frames and
 * rejected: an Elite cockpit's interior is not planked at all. Its dash,
 * coaming and pillars are *mouldings* — near-black satin forms with a soft
 * mottle — and what carries their scale is the rim on every cut edge, not a
 * grid of lines. Bringing the hull's language inside was the mistake, and a
 * pressure cabin's lining is not sheet steel.
 *
 * The principal's ruling was **sparse and much larger**: a real join, but a
 * rare one, and nothing at all on the small fittings. Three times the tile puts
 * about 3.6 plates across the scanner deck, which is two genuine seams on the
 * cabin's biggest surface. The small fittings fall out of the same number
 * without a second rule — a 0.8 m bezel spans a hundredth of a 72 m tile, so it
 * sits inside one plate and shows no seam at all.
 *
 * The metres are a consequence of the cabin's hundred-fold scale (see the
 * module docstring) rather than a claim about a real spacecraft, and this is a
 * figure set by looking. `tests/cockpit-surface.test.ts` bands the plate count
 * so a retune cannot silently return the grid; it does not, and cannot, assert
 * that 3.6 is right.
 */
export const COCKPIT_PANEL_KM = 0.072;

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
 * - `variation` **3** against 6. Half the hull's spread again: a cabin lining
 *   is painted as one job in one shop, and once the seams went sparse the
 *   plate-to-plate tone was the only thing still saying "grid".
 * - `seam` **0.26** against 0.18. *More* than the hull, which looks backwards
 *   until the count is included: there are now two or three seams on the whole
 *   deck rather than eleven, and each surviving one is a real join. An interior
 *   seam is also a shadowed gap with no direct sun inside to cut it, so more of
 *   the line has to be carried by the albedo than on a hull.
 * - `weathering` **0.06**, the lowest in the game. #98 refused the grime
 *   outright and a pressurised cabin is the cleanest surface there is. Not
 *   zero, for `SHIP_PLATING`'s reason: a plate-to-plate variation that is only
 *   seams reads as a decal sheet.
 * - `seamHalfWidthPx` **1** against a 32-texel pitch — a 6% groove, the hull's
 *   figure unchanged. It is the single largest driver of the scale-like read
 *   and there is no reason for the cabin to answer it differently.
 * - `roughness` and `metalness` **1**, and that is not a placeholder. The cabin
 *   has four finishes — `COCKPIT_FINISHES` — and one shared map cannot hold
 *   four. At 1 the map is the **wear curve alone** and each material scales it
 *   by its own finish, so all four survive. Forcing them flat was #101's
 *   round-two blocker: three paints rendered as one, green in both tiers, under
 *   a docstring saying nothing was repainted.
 *
 *   1 is where the *calibration pass* starts rather than where it ends — see
 *   `cockpitMaps`. The cabin's roughest finish is 0.72 and a clean plate at
 *   profile 1 reads 0.702, so `metal`'s dial would need 1.026 and a dial cannot
 *   exceed 1. That is `station-types.md`'s clamp-bite shape (#13) one map over:
 *   the roughest material is the one whose roughness stops being expressible.
 * - `seamDepth` **0.45** against the hull's 0.55. The cabin's own light is soft
 *   and close, so a deeper groove reads as a trench rather than a line — and a
 *   rare seam is read at leisure, where a hull's is glanced at in passing.
 */
export const COCKPIT_PLATING: PlatingProfile = {
	pitchPx: 32,
	aspect: 2,
	stagger: 0.5,
	seamHalfWidthPx: 1,
	variation: 3,
	seam: 0.26,
	weathering: 0.06,
	roughness: 1,
	metalness: 1,
	seamDepth: 0.45,
};

/**
 * How far each cabin form's edges are cut back, kilometres.
 *
 * **The lever that replaced the panel grid**, and the principal's answer to
 * where a moulding's scale actually comes from. `chamfer-box.ts` carries the
 * argument; what belongs here is the figure, because it is set on the contact
 * sheet like every other number in this module.
 *
 * 0.3 m, and on most of the cabin the clamp is what binds rather than this:
 * the fittings are thin slabs — the scanner deck is 1.6 m through, a bezel
 * 0.75 m — so `chamferedBox` cuts a quarter of the smallest half-extent instead
 * and the rim is proportional to the form. That is the intent. A fixed cut
 * would put the same rim on a 32 m deck and a 0.8 m bezel, which is a moulding
 * on one and a bevelled sliver on the other.
 *
 * **0.6 m against a half-thickness clamp was flown and rejected**: at that
 * width every console edge read as polished chrome piping, because a thin slab
 * seen at a shallow angle is then more rim than face.
 */
export const COCKPIT_CHAMFER_KM = 0.0003;

/**
 * The cabin's four finishes: three structural, and #204's mid-tone.
 *
 * **Here rather than inline in `buildCockpit`**, and that is what makes the
 * calibration below possible at all: a module that does not know what the
 * roughest finish in the cabin is cannot tell whether the wear map can express
 * it. `main.ts` built the first three inline and #105 moved them, unchanged —
 * the figures are the ones the cabin has had since #35 and nothing here
 * repaints them.
 *
 * `inset` has no emissive because it is a recess. The other two carry the faint
 * self-lift they were authored with.
 */
/** Cabin-authored self-light, expressed against the shared exposure ceiling. */
export const COCKPIT_EMISSIVE_INTENSITIES = {
	metal: EMISSIVE_CEILING * 0.08,
	trim: EMISSIVE_CEILING * 0.14,
	inset: EMISSIVE_CEILING * 0,
	throttleIdle: EMISSIVE_CEILING * 0.04,
	throttleFull: EMISSIVE_CEILING * 0.32,
} as const;

export const COCKPIT_FINISHES = {
	metal: {
		color: 0x0a1114,
		roughness: 0.72,
		metalness: 0.48,
		emissive: 0x010304,
		emissiveIntensity: COCKPIT_EMISSIVE_INTENSITIES.metal,
	},
	trim: {
		color: 0x1a2c32,
		roughness: 0.46,
		metalness: 0.72,
		emissive: 0x03090b,
		emissiveIntensity: COCKPIT_EMISSIVE_INTENSITIES.trim,
	},
	inset: {
		color: 0x020607,
		roughness: 0.48,
		metalness: 0.3,
		emissive: 0x000000,
		emissiveIntensity: COCKPIT_EMISSIVE_INTENSITIES.inset,
	},
	/**
	 * **The mid-tone (#204).** The three above are all near-black, so the
	 * console tops had nothing to catch a highlight. A satin grey-blue on the
	 * faces the light falls on, with `metal` kept for the carcass round them.
	 * **Not on the scanner deck**, which #204 proposed: its top edge is the
	 * backdrop of the flight-floor strip, and on this tone the strip's dim
	 * labels all but vanished on the sheet.
	 *
	 * No emissive: a face that glows would lift the flight floor's backing,
	 * which is the legibility regression #105 was forbidden. And its roughness
	 * and metalness sit under the roughest and most metallic finishes above,
	 * so the calibration does not move and the other three are not repainted.
	 */
	face: {
		color: 0x3a4750,
		roughness: 0.5,
		metalness: 0.4,
		emissive: 0x000000,
		emissiveIntensity: 0,
	},
} as const;

export type CockpitFinish = keyof typeof COCKPIT_FINISHES;

export const COCKPIT_FINISH_IDS = Object.keys(
	COCKPIT_FINISHES,
) as CockpitFinish[];

/**
 * What each `quality` setting gives the cabin (#98's gate, #99's key).
 *
 * Low drops the **seam normal map** and keeps the albedo and the wear map —
 * `HULL_QUALITY`'s rule unchanged, deliberately, so there is one answer for
 * every plated surface in the game rather than one per surface.
 *
 * Low also drops **#105's key light**, which is the term this node *added*.
 * A point light is evaluated for every standard material in its scene, and the
 * cabin's scene was `nearScene` until #651, so an ungated one made every hull
 * and station fragment in the game pay for a cabin gradient; #98 requires each
 * new expensive term to declare a side, and this is that declaration. Since
 * #651 only the cabin's fittings pay, and the gate stands. Dropping it returns low to the light count that
 * shipped before this node. Since #887 the same gate also takes the six
 * perimeter-lamp casts (`buildPerimeterLamps`).
 *
 * What low does **not** drop is the pre-existing interior fill.
 * The fill is the cabin's own lighting — #105's finding is that the cabin is
 * lit almost entirely through the canopy — so removing it gives an unlit cabin
 * rather than a cheaper one, and `settings.ts` promises the player it stays.
 */
export const COCKPIT_QUALITY = {
	high: { seamNormals: true, keyLight: true },
	low: { seamNormals: false, keyLight: false },
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

/** The two wear channels a finish is expressed through. */
type WearKey = "roughness" | "metalness";

interface PlatingPass {
	// `Uint8Array<ArrayBuffer>` and not the bare alias: `THREE.DataTexture` takes
	// the narrow form, and `surface.ts` returns it, so widening here would only
	// force a cast back at the two texture sites.
	albedo: Uint8Array<ArrayBuffer>;
	wear: Uint8Array<ArrayBuffer>;
	clean: Record<WearKey, number>;
}

/** One plating pass: the albedo, the wear derived from it, and what the wear
 *  reads on a clean plate. Generated together and handed to both, because
 *  `wearTexels` derives from the albedo and regenerating would leave two
 *  buffers that only happen to agree. */
function platingPass(profile: PlatingProfile): PlatingPass {
	const albedo = plateTexels(profile, "cockpit", COCKPIT_MAP_SIZE);
	const wear = wearTexels(profile, albedo, COCKPIT_MAP_SIZE);
	return { albedo, wear, clean: cleanPlate(wear) };
}

/**
 * Lift the profile's `roughness` and `metalness` until the cabin's strongest
 * finish has a dial of at most 1 — and then check that it does.
 *
 * A material's dial is `finish / clean`, and `MeshStandardMaterial` has no dial
 * above 1: a finish rougher than a clean plate simply cannot be asked for, and
 * clamping it is a silent repaint of exactly the kind #101 shipped once. The
 * cabin's roughest finish is 0.72 against a clean plate of 0.702 at profile 1,
 * so the lift needed is about 2.6%; its most metallic is 0.72 against 0.726,
 * which needs none.
 *
 * **Measured rather than transcribed.** The factor is read off a real pass's
 * own buffer, so a change to `variation`, `seam` or `weathering` — all three
 * move the clean plate — recalibrates instead of drifting. A constant here
 * would be the transcription `cleanPlate` exists to avoid, one level up.
 *
 * **A loop rather than one shot, because the map requantises.** The first
 * version solved the lift against the *unlifted* pass and shipped the result
 * unchecked. But `wearTexels` writes bytes and `cleanPlate` reads
 * `median / 255`, so the lifted pass's clean plate is the target rounded to a
 * texel — and rounding *down* by one leaves the dial at 1.003 and
 * `cockpitMaterial("metal")` throwing inside `Game`'s constructor. A cabin that
 * cannot boot, off a quantisation of one part in 255. So each pass is measured,
 * and a pass that still falls short is lifted again by its own shortfall plus
 * one texel.
 *
 * The loop terminates because every iteration raises the target by at least
 * `1/255` against a bounded quantity; the cap is a guard on that reasoning
 * rather than an expected path, and it throws rather than shipping a profile it
 * could not verify — see `dial`'s argument for loud over clamped.
 *
 * The cost of the lift is that the seam and grime texels, which are the
 * *rougher* end of the curve, clip against 255 rather than running past 1. That
 * is a squeeze of a few percent on texels already at the ceiling, and it is the
 * reason the lift is "just enough" rather than a round number with headroom: a
 * larger factor flattens the top of the wear curve, which is the seam contrast
 * the map is for.
 */
function calibrate(): { profile: PlatingProfile; pass: PlatingPass } {
	const strongest = (key: WearKey) =>
		Math.max(...COCKPIT_FINISH_IDS.map((id) => COCKPIT_FINISHES[id][key]));
	/**
	 * A fraction of a byte of headroom — and the loop covers the rest.
	 *
	 * Added to a *ratio*, not to a byte: it lifts the target by `clean × TEXEL`,
	 * about seven tenths of a texel at the cabin's clean plate. That is enough
	 * for the case that motivated it and not a guarantee on its own, which is
	 * why the loop re-measures rather than trusting one correction.
	 */
	const TEXEL = 1 / 255;
	let profile = COCKPIT_PLATING;
	for (let attempt = 0; attempt < 8; attempt++) {
		const pass = platingPass(profile);
		const short = (key: WearKey) => strongest(key) / pass.clean[key];
		if (short("roughness") <= 1 && short("metalness") <= 1)
			return { profile, pass };
		profile = {
			...profile,
			roughness: profile.roughness * Math.max(1, short("roughness") + TEXEL),
			metalness: profile.metalness * Math.max(1, short("metalness") + TEXEL),
		};
	}
	throw new Error(
		"cockpit plating did not calibrate: no lift of the wear curve made every finish in COCKPIT_FINISHES expressible",
	);
}

/**
 * The calibration, memoised.
 *
 * Each pass generates two 256-square buffers and takes two medians, and
 * `calibrate` runs at least two of them. Without this, `cockpitMaps` paid one
 * calibration and `calibratedProfile()` paid a whole fresh one on every call.
 */
let calibrated: { profile: PlatingProfile; pass: PlatingPass } | null = null;

const calibration = () => {
	if (!calibrated) calibrated = calibrate();
	return calibrated;
};

/** The calibrated profile the shipped maps are generated from, so a test can
 *  read what the pass decided rather than restate it. */
export const calibratedProfile = () => calibration().profile;

function cockpitMaps() {
	if (maps) return maps;
	const { profile, pass } = calibration();
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
function cleanPlate(wear: Uint8Array<ArrayBuffer>): Record<WearKey, number> {
	// **Counted, not sorted.** The channel is a byte, so a 256-bin histogram
	// gives the same median in one linear scan with no allocation — against
	// building and comparator-sorting a 65,536-element array per channel, which
	// the calibration loop above would then pay for on every attempt.
	const median = (channel: number) => {
		const bins = new Uint32Array(256);
		let count = 0;
		for (let i = 0; i < wear.length; i += 4) {
			bins[wear[i + channel]] += 1;
			count += 1;
		}
		// The same element `values[count >> 1]` named: the first value at or past
		// the half-count once the bins are walked in order.
		let seen = 0;
		for (let value = 0; value < 256; value++) {
			seen += bins[value];
			if (seen > count >> 1) return value / 255;
		}
		return 1;
	};
	return { roughness: median(1), metalness: median(2) };
}

/**
 * The cabin's gated lamps, held so the quality gate can reach them.
 *
 * Registered by `buildCockpit` rather than made here: a lamp's position is a
 * fact about the cabin's geometry and belongs beside it, while *whether it is
 * on* is this module's gate. #792's cabin gates two — the warm key and the
 * centre lamp — so low keeps one point light in the cabin's scene, as the
 * procedural cabin did.
 */
let keyLights: readonly { visible: boolean }[] = [];

/** Hand the cabin's gated lamps to the quality gate, replacing any earlier
 *  cabin's, and put them in the state the current setting asks for. */
export function registerKeyLight(...lights: { visible: boolean }[]) {
	keyLights = lights;
	for (const light of lights)
		light.visible = COCKPIT_QUALITY[cockpitQuality].keyLight;
}

/** The clean-plate factors, for the test that checks the four finishes
 *  survive. */
export const cockpitCleanPlate = () => cockpitMaps().clean;

/**
 * Every cabin material plated so far, so the quality setting can reach them
 * all. A `Set` and not a count: the gate has to put the map back, which means
 * holding the materials rather than knowing how many there were.
 *
 * **Module state, and it never shrinks.** An earlier docstring here claimed it
 * "holds three" because `buildCockpit` runs once per `Game`; that is what one
 * game does, not what the set is. `cockpitMaterial` mints a fresh material on
 * every call, so the unit tests alone push it past three, and a second `Game`
 * in one page would retain the first cabin's materials for the life of the
 * process. Left as it is, matching `ship-surface.ts`: the retained objects are
 * a handful of materials with no geometry behind them, and the alternative —
 * per-cabin ownership — would put the quality gate's reach in `Game` rather
 * than in the module that knows what a cabin surface costs. Written down
 * because a bound nobody enforces should not be stated as one.
 */
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
	// The indexed source is unreferenced from here on and holds GPU-bound
	// buffers of its own. Only the branch that actually replaced it disposes —
	// disposing unconditionally would free the geometry being returned.
	if (flat !== geometry) geometry.dispose();
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
export function dial(key: WearKey, finish: number, clean: number): number {
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
 * One cabin fitting's geometry: a chamfered form with the cabin's plate
 * projection already on it.
 *
 * **The one call site `buildCockpit` should have.** The pair was written out by
 * hand at eight places, each threading `COCKPIT_CHAMFER_KM` itself, and the
 * failure that invites is silent in the worst way: a ninth fitting that forgets
 * the wrapper is drawn unplated, which — as `plateCockpitUVs` says — looks
 * exactly like the map having failed to load rather than like a missing call.
 */
export function cockpitForm(
	width: number,
	height: number,
	depth: number,
): THREE.BufferGeometry {
	return plateCockpitUVs(
		chamferedBox(width, height, depth, COCKPIT_CHAMFER_KM),
	);
}

/**
 * Give a cabin material the shared plating, its seams and its own finish back.
 *
 * **Not exported**, and that is the other half of `cockpitMaterial`'s claim to
 * be the one way to make a cabin material. While this was public, a caller
 * could hand it a `MeshStandardMaterial` carrying a finish the calibration pass
 * had never seen; any finish at or below the clean plate slips past `dial`'s
 * throw and renders at a dial the profile was not lifted for, which is the
 * call-site door `COCKPIT_FINISHES` was moved here to shut.
 *
 * Idempotent by the `plated` set. **Not for a readout**: the throttle fill is a
 * `MeshStandardMaterial` and is deliberately not passed here — plating a bar
 * whose length is the reading would put a seam across the value.
 */
function plateCockpit(material: THREE.MeshStandardMaterial) {
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
	// The key light, if the cabin has been built yet. `visible` rather than a
	// removal: three skips an invisible light entirely when it gathers the
	// scene's lights, so the per-fragment term goes with it, and the setting
	// stays live — #99's finding is that a reload puts the ship somewhere else.
	for (const light of keyLights)
		light.visible = COCKPIT_QUALITY[quality].keyLight;
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
