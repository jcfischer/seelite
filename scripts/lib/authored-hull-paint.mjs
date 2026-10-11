/**
 * The authored hull paints, lifted for legibility (node #887).
 *
 * Both authored hulls — the O4 courier (#812) and the Longwall B miner (#815) —
 * carry the study's own materials, and each study was lit for its own viewer,
 * where a studio environment gives a metal something to reflect. The game gives
 * a hull the star, a hemisphere, a camera-side fill, and a baked sky applied at
 * `LIGHT_RIG.environmentIntensity` **0.15**. A paint at metalness 0.86 subtracts
 * 86% of its diffuse and gets almost nothing back, so it reads black everywhere
 * except the one angle where it mirrors the star. That is what `hull-chase`
 * measures on the shipped courier: peak **252.21**, median **37.88**, lower
 * quartile **10.16** of 255, where the procedural courier this band was written
 * on read 204.92 / 79.53 / 22.80. The peak is the mirror. The rest of the hull is
 * the space around it.
 *
 * ## Why the asset and not a load-time override
 *
 * `src/courier-hull.ts` already overrides one study material at load
 * (`COURIER_ALLOY_ROUGHNESS`, #843), and that is the right shape for a fix to a
 * symptom found in the game. This is not that. Nine paints are too dark and too
 * metallic *as authored for a viewer that is not this one*, and a second, silent
 * copy of the study's paint job in `src/` would mean the study and the shipped
 * hull no longer say the same thing anywhere a person can read. The prepare
 * script is the one place that turns an approved study into a shipped hull, so
 * the lift is one step in it and the shipped file is the record.
 *
 * ## Why a scale and a cap, not a target figure
 *
 * The two assets share paint *names* and not paint values: the courier's
 * `machined-alloy` is a mapped 0.390 at metalness 0.86, the miner's is an
 * unmapped 0.380 at 0.90, and the miner's `pale-steel-0` is a mapped **0.640**
 * that needs no lifting at all. An absolute target would repaint the bright one
 * **down**. A `tintScale` only ever raises — and only up to `TINT_LUMA_CEILING`,
 * so an already-bright paint is left where the study put it — and a
 * `metalnessCap` only ever lowers. A paint already inside both rules is returned
 * untouched, byte for byte.
 */

/**
 * The lift, per paint. `tintScale` multiplies the base colour factor's colour
 * channels; `metalnessCap` lowers the metallic factor only where it sits above
 * the cap.
 *
 * What these figures are chosen for is **diffuse** albedo, because diffuse is the
 * term that survives at every viewing angle: `factor × texture mean ×
 * (1 − metalness)`. The courier's exterior paints share one `steel-wear` map whose
 * pixels mean **0.4466 linear** (`scripts/measure-authored-hull-paint.mjs` reads
 * it), so `dark-structure` — 39.3% of the courier's triangles — goes from
 * 0.057 × 0.4466 × 0.24 = **0.006** to 0.143 × 0.4466 × 0.65 = **0.041**, and
 * `machined-alloy` (33.5%) from 0.024 to **0.081**. For comparison the procedural
 * roster's painted hull under `worn` is a 0.20 linear albedo at metalness 0.3, so
 * **0.14**. This lifts the authored hulls toward that without passing it, which is
 * the point: the fleet in Traffic must not start outshining the ship you fly.
 *
 * `machined-alloy` keeps the highest cap of the set on purpose. It is the bare
 * machined edge whose mirror *is* the band's peak, and taking its metalness as far
 * as the painted paints' would take that read away from it.
 *
 * These are a first pass, derived from the arithmetic above and settled on the
 * contact sheet, which is where every figure in this repo is finally decided.
 */
export const AUTHORED_HULL_PAINT_LIFT =
	/** @type {Readonly<Record<string, Readonly<{ tintScale: number, metalnessCap: number }>>>} */ (
		Object.freeze({
			// The darkest paint, and dark by intent: it stays the darkest thing lifted, it
			// only has to stop being a silhouette against the sky.
			"dark-structure": Object.freeze({ tintScale: 2.5, metalnessCap: 0.35 }),
			// The machined edge. Capped least: it should still mirror the star.
			"machined-alloy": Object.freeze({ tintScale: 1.3, metalnessCap: 0.6 }),
			"brushed-rail": Object.freeze({ tintScale: 1.8, metalnessCap: 0.35 }),
			"pale-steel-0": Object.freeze({ tintScale: 1.25, metalnessCap: 0.35 }),
			"pale-steel-1": Object.freeze({ tintScale: 1.25, metalnessCap: 0.35 }),
			// The four body tones, one scale so the family keeps its own steps.
			"blue-grey-0": Object.freeze({ tintScale: 2.2, metalnessCap: 0.35 }),
			"blue-grey-1": Object.freeze({ tintScale: 2.2, metalnessCap: 0.35 }),
			"blue-grey-2": Object.freeze({ tintScale: 2.2, metalnessCap: 0.35 }),
			"blue-grey-3": Object.freeze({ tintScale: 2.2, metalnessCap: 0.35 }),
		})
	);

/**
 * The lift never takes a paint's factor luminance above this, in working (linear)
 * space — sRGB about 0.77, well short of a white hull.
 *
 * Without it a `tintScale` chosen for a paint at 0.057 lands on the miner's
 * `pale-steel-0` at 0.640 and pushes it to 0.80, which is a white slab. With it
 * the miner's `pale-steel-0` — luminance 0.61, already over the ceiling — is not
 * tinted at all, and its metalness still comes down. A scale that cannot be
 * applied to one of the two assets without inventing a new problem is not a rule,
 * and this is the half that makes it one.
 */
export const TINT_LUMA_CEILING = 0.55;

/**
 * Paints left exactly as the study exported them, and why.
 *
 * This is not a comment. `tests/authored-hull-paint.test.ts` fails if a shipped
 * material is in neither this record nor `AUTHORED_HULL_PAINT_LIFT`, which is what
 * makes it a classification of every paint rather than a list of the ones this
 * node happened to think about.
 */
export const UNLIFTED_PAINTS = /** @type {Readonly<Record<string, string>>} */ (
	Object.freeze({
		"recess-black":
			"the dark a hull needs behind its plating to read as plating",
		"hose-rubber":
			"rubber, and the darkest thing the study intended to stay dark",
		"amber-lamp": "an emitter: its own emissive carries it, not its albedo",
		"amber-work-lights": "an emitter",
		"cyan-display": "an emitter: a screen with a live source",
		"canopy-glass": "glass at alpha 0.38, which reflects rather than diffuses",
		"service-ochre":
			"the accent stripe, already at 0.550 linear and metalness 0.37",
		"pilot-suit": "a person, not a hull",
		"pilot-helmet": "a person",
		"pilot-visor": "a person's visor",
		"pilot-harness": "a person's harness",
		"pilot-gloves-boots": "a person's gloves and boots",
		"cockpit-amber-work-lights":
			"the cabin behind the canopy, which #794's own model draws and no exterior view sees",
		"cockpit-weathered-blue-steel": "as above",
		"cockpit-graphite-housings": "as above",
		"cockpit-exposed-machined-edges": "as above",
		"cockpit-guarded-red": "as above",
		"cockpit-rubber-and-recess": "as above",
	})
);

/** The authored hulls the lift is defined over.
 *
 * `liftedPaints` names, per asset, the paints the rule is expected to find there.
 * A paint renamed by a later study is a red row in `tests/authored-hull-paint.test.ts`
 * and a failed assert in that asset's prepare script, rather than a rule that
 * quietly stops matching anything — which is how a lift becomes decoration.
 *
 * `baseColorLuma` records the mean linear luma of each of those paints' base colour
 * maps — **0.4466** for the courier's one `steel-wear`, and **1** where the Longwall B
 * carries no map at all. It is recorded rather than measured at build time because
 * the lift's brightness depends on it, and a brightness that moves because a texture
 * was re-authored is a look that changed without anyone deciding it. Each prepare
 * script measures the pixels and refuses to write the file if the measurement has
 * moved; `tests/authored-hull-paint.test.ts` needs no image decoder to know them.
 */
export const AUTHORED_HULL_ASSETS = Object.freeze([
	Object.freeze({
		study: "spikes/courier-hull/courier-hull.glb",
		shipped: "src/models/courier-hull.glb",
		prepare: "spikes/courier-hull/prepare-game-asset.mjs",
		liftedPaints: Object.freeze([
			"dark-structure",
			"machined-alloy",
			"brushed-rail",
			"pale-steel-0",
			"pale-steel-1",
			"blue-grey-0",
			"blue-grey-1",
			"blue-grey-2",
			"blue-grey-3",
		]),
		// Every exterior paint on this hull multiplies its factor by the one
		// `steel-wear` wear map, whose pixels mean this.
		baseColorLuma: /** @type {Readonly<Record<string, number>>} */ (
			Object.freeze({
				"dark-structure": 0.4466,
				"machined-alloy": 0.4466,
				"brushed-rail": 0.4466,
				"pale-steel-0": 0.4466,
				"pale-steel-1": 0.4466,
				"blue-grey-0": 0.4466,
				"blue-grey-1": 0.4466,
				"blue-grey-2": 0.4466,
				"blue-grey-3": 0.4466,
			})
		),
	}),
	Object.freeze({
		study: "spikes/longwall-miner/longwall-miner.glb",
		shipped: "src/models/longwall-miner.glb",
		prepare: "spikes/longwall-miner/prepare-flight-asset.mjs",
		// The Longwall B carries five of the nine names — no rails, one body tone —
		// and two of them (`pale-steel-0`, `pale-steel-1`) it carries already inside
		// both bounds, so the lift leaves them byte-equal there. The record is of the
		// study's paints, not of the shipped file's: `dedup` folds the miner's two
		// identical pale steels into one before writing.
		liftedPaints: Object.freeze([
			"dark-structure",
			"machined-alloy",
			"pale-steel-0",
			"pale-steel-1",
			"blue-grey-1",
		]),
		// `1` where the export carries no base colour map for a paint at all: the
		// Longwall B's structure and machined alloy are flat, and that is why the same
		// rule lands twice as bright on this hull as on the courier's.
		baseColorLuma: /** @type {Readonly<Record<string, number>>} */ (
			Object.freeze({
				"dark-structure": 1,
				"machined-alloy": 1,
				"pale-steel-0": 0.4755,
				"pale-steel-1": 0.4755,
				"blue-grey-1": 0.4755,
			})
		),
	}),
]);

/** Rec. 709 luma of a base colour factor, in the space the factor is stored in. */
export const tintLuma = (tint) =>
	0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];

/**
 * The mean linear luma of the courier hull's `steel-wear` base colour map:
 * **0.4466**. Recorded here because every exterior paint on that hull multiplies
 * its factor by this map, so a factor's arithmetic does not reach the screen
 * without it.
 *
 * `scripts/measure-authored-hull-paint.mjs` reads it, per paint, off the shipped
 * file — run by hand, as the repo's other `measure-` scripts are. This is a figure
 * with a provenance rather than a band a suite enforces, and it says so rather than
 * pretending otherwise.
 */
export const STEEL_WEAR_MEAN_LUMA =
	AUTHORED_HULL_ASSETS[0].baseColorLuma["dark-structure"];

/**
 * The procedural roster's painted hull, as the comparison the lift is sized
 * against: `liveries.courier.hull` `0x8fa6ae` muted by the `worn` finish's paint
 * dial (saturation 0.42, value 0.8) to `0x7a8285`, plated at metalness 0.3.
 *
 * Its diffuse luma is `rosterPaintedDiffuse()`, **0.153** of full white. That is
 * the figure the fleet in Traffic already reads, which is why the ceiling below is
 * stated against it: a hull you fly must not end up painting over the hulls flying
 * past it.
 */
export const ROSTER_PAINTED_HULL = Object.freeze({
	tint: [0x7a, 0x82, 0x85],
	metalness: 0.3,
});

/** The sRGB-to-linear transfer, for a paint quoted as a hex rather than a factor. */
export const srgbToLinear = (channel) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** What the roster's painted hull returns as diffuse light. */
export const rosterPaintedDiffuse = () =>
	tintLuma(ROSTER_PAINTED_HULL.tint.map((byte) => srgbToLinear(byte / 255))) *
	(1 - ROSTER_PAINTED_HULL.metalness);

/**
 * No paint **the lift brightens** may end above this multiple of the roster's painted hull.
 *
 * The second bound on the metalness cap, and the one the two assets make necessary:
 * `machined-alloy` is a mapped 0.390 on the courier and an **unmapped** 0.380 on the
 * Longwall B, so capping both at 0.60 leaves the courier at 0.63× the roster and the
 * miner at **1.31×** — one rule, twice the brightness, because one hull has a wear
 * map to multiply and the other has nothing. Where a paint would pass the ceiling,
 * the cap is lifted back toward the study's own value until it lands on it. That
 * takes metalness *up* from the cap and never above what the study wrote, so the
 * ceiling can only shrink a lift, never overshoot it.
 *
 * **It bounds the lift, not the asset.** The miner's `pale-steel-0` shipped at
 * **1.33×** the roster before this node existed — a study paint already brighter than
 * the fleet's, with a metalness of 0.30 already below what the ceiling would ask of
 * it. Nothing here takes it down, and that is not an oversight: this node lightens
 * hulls that read as silhouettes, and a paint that was already the brightest thing on
 * its hull is not the complaint. `scripts/measure-authored-hull-paint.mjs` prints it
 * so the asymmetry is on the record rather than under it.
 */
export const MAX_DIFFUSE_OF_ROSTER = 1;

/**
 * The scale the rule actually applies to one paint: no more than `tintScale`, and
 * never enough to cross `TINT_LUMA_CEILING`. Returns 1 for a paint already at or
 * over the ceiling, which leaves its factor untouched.
 */
export const appliedTintScale = ({ tint }, { tintScale }) => {
	const luma = tintLuma(tint);
	if (!(luma > 0)) return 1;
	return Math.max(1, Math.min(tintScale, TINT_LUMA_CEILING / luma));
};

/** The metallic factor the rule leaves: the cap only where it lowers. */
export const appliedMetalness = ({ metalness }, { metalnessCap }) =>
	Math.min(metalness, metalnessCap);

/**
 * The metallic factor the ceiling leaves: the cap, lifted back toward the study's
 * own value only as far as it must be to bring a lifted paint's diffuse down to
 * `ceiling`. Returns `cap` where the ceiling does not bind, and never a value above
 * what the study wrote.
 */
export const ceilingedMetalness = (
	liftedTint,
	cap,
	mapLuma,
	ceiling,
	study,
) => {
	const reach = tintLuma(liftedTint) * mapLuma;
	if (!(reach > 0)) return cap;
	const needed = 1 - ceiling / reach;
	if (!(needed > cap)) return cap;
	return Math.min(study, needed);
};

/**
 * Apply the lift to every material of a loaded glTF document, in place.
 *
 * `mapLuma` is `material name → mean linear luma of that material's base colour
 * map`, from `baseColorLumaByMaterial`; a name it does not carry is read as
 * unmapped, mean 1. Returns one row per material the rule names — `{ name, rule,
 * scale, mapLuma, ceilingBound, from, to }` — so a prepare script can print what it
 * did rather than assert that something did.
 */
export function liftAuthoredHullPaint(document, mapLuma = new Map()) {
	const ceiling = rosterPaintedDiffuse() * MAX_DIFFUSE_OF_ROSTER;
	const rows = [];
	for (const material of document.getRoot().listMaterials()) {
		const rule = AUTHORED_HULL_PAINT_LIFT[material.getName()];
		if (!rule) continue;
		const before = {
			tint: [...material.getBaseColorFactor()],
			metalness: material.getMetallicFactor(),
		};
		const scale = appliedTintScale(before, rule);
		const tint = before.tint;
		const lifted = [
			Math.min(1, tint[0] * scale),
			Math.min(1, tint[1] * scale),
			Math.min(1, tint[2] * scale),
			tint[3],
		];
		material.setBaseColorFactor(lifted);
		const cap = appliedMetalness(before, rule);
		const map = mapLuma.get(material.getName()) ?? 1;
		const metalness = ceilingedMetalness(
			lifted,
			cap,
			map,
			ceiling,
			before.metalness,
		);
		material.setMetallicFactor(metalness);
		rows.push({
			name: material.getName(),
			rule,
			scale,
			mapLuma: map,
			ceilingBound: metalness > cap,
			from: before,
			to: { tint: [...material.getBaseColorFactor()], metalness },
			fromDiffuse: tintLuma(before.tint) * map * (1 - before.metalness),
			diffuse: tintLuma(lifted) * map * (1 - metalness),
			ceiling,
		});
	}
	return rows;
}

/** The rows the ceiling should have held: those the lift made brighter. A paint
 *  that shipped above the ceiling is not a row this rule owns — see
 *  `MAX_DIFFUSE_OF_ROSTER`. */
export const ceilingFailures = (rows) =>
	rows.filter(
		(row) =>
			row.diffuse > row.ceiling + 1e-9 && row.diffuse > row.fromDiffuse + 1e-9,
	);
