/**
 * Deterministic, display-only appearance classification for celestial bodies.
 *
 * **The class is read off the sim, not off a hash.** `generateContents` already
 * computes the one number that decides what a world looks like: how far it
 * orbits relative to its own star's habitable distance. That ratio is
 * insolation in disguise — `a_hab = √(L/L☉)`, so `a/a_hab` is `a/√L`, and the
 * flux a planet receives goes as `L/a²`, i.e. `1/(a/a_hab)²`. One division
 * replaces a whole second generator, and it means a hot star's third rung and a
 * cold star's third rung look different for the reason they should.
 *
 * The seed only decorates: it picks continent shapes, crater fields and storm
 * placement *within* a class. It never picks the class. Two worlds at the same
 * relative orbit are the same kind of world with different weather.
 */

/** Ordered cold-to-hot within each family; the shader switches on this. */
export type SurfaceClass =
	| "star"
	| "lava"
	| "venusian"
	| "terran"
	| "desert"
	| "ice"
	| "airless"
	| "jovian"
	| "iceGiant";

export interface PlanetAppearance {
	surface: SurfaceClass;
	/** Insolation key `a/a_hab`: <1 is inside the habitable distance. */
	warmth: number;
	/** Optical depth of the shell, 0 for an airless body. Drives limb glow and
	 *  how far light wraps past the geometric terminator. */
	atmosphere: number;
	/** Linear-space RGB for that shell. Meaningless when `atmosphere` is 0. */
	atmosphereColor: number;
	/** Fraction of the surface below sea level. 0 when the class has no ocean. */
	oceanFraction: number;
	/** How much of the disc a separate weather shell covers. 0 draws no shell —
	 *  a venusian world's deck *is* its surface, so it does not get one. */
	cloudCover: number;
	/** Only gas giants carry them, and only some of those. */
	hasRings: boolean;
	seed: number;
}

/** FNV-1a. Appearance needs a stable number per id, not a good distribution. */
const hash = (text: string) => {
	let value = 2166136261;
	for (let i = 0; i < text.length; i++)
		value = Math.imul(value ^ text.charCodeAt(i), 16777619);
	return value >>> 0;
};

/**
 * Thresholds on `a/a_hab`, in the units the generator already thinks in.
 *
 * `GIANT` is not a new rule: `system.ts` sets `isGasGiant = aAu > 2 * habitableAu`,
 * so the giant boundary and this ladder's top rung are the same line. The rest
 * subdivide the space the generator left undifferentiated.
 */
export const WARMTH = {
	/** Inside this, the crust does not stay solid. */
	LAVA: 0.45,
	/** Runaway greenhouse: the surface is never visible through the deck. */
	VENUS: 0.78,
	/** Liquid water. The band is narrow on purpose — terran worlds should feel
	 *  found, not issued. */
	TERRAN: 1.3,
	/** Cold enough that the ocean is gone, warm enough that it is not ice. */
	DESERT: 2.0,
	/** Matches `isGasGiant`. */
	GIANT: 2.0,
	/** Beyond this a giant is methane-blue rather than ammonia-brown. */
	ICE_GIANT: 5.0,
} as const;

/**
 * Classify one body for display.
 *
 * `warmth` is `aAu / habitableAu`. Callers that have neither — a moon, whose
 * orbit is around a planet — pass the *parent's* warmth, which is the right
 * answer: a moon is at its planet's distance from the star.
 */
export function appearanceFor(
	kind: "star" | "planet" | "moon",
	id: string,
	warmth: number,
	options: { isGasGiant?: boolean; radiusKm?: number } = {},
): PlanetAppearance {
	const seed = hash(id);
	if (kind === "star")
		return {
			surface: "star",
			warmth: 0,
			atmosphere: 0,
			atmosphereColor: 0,
			oceanFraction: 0,
			cloudCover: 0,
			hasRings: false,
			seed,
		};

	// A moon is airless whatever its orbit: nothing at moon mass holds a shell
	// long enough to matter. It still reads cold or scorched through its albedo,
	// which the shader takes from `warmth`.
	if (kind === "moon")
		return {
			surface: "airless",
			warmth,
			atmosphere: 0,
			atmosphereColor: 0,
			oceanFraction: 0,
			cloudCover: 0,
			hasRings: false,
			seed,
		};

	const giant = options.isGasGiant ?? warmth > WARMTH.GIANT;
	if (giant) {
		const cold = warmth > WARMTH.ICE_GIANT;
		return {
			surface: cold ? "iceGiant" : "jovian",
			warmth,
			// Thick, and the limb glow is the whole silhouette on a giant.
			atmosphere: 1,
			atmosphereColor: cold ? 0x4a86c8 : 0xd8a05a,
			oceanFraction: 0,
			// The band pattern is painted into the surface, so a second shell over
			// it would only wash out the belts it exists to show.
			cloudCover: 0,
			// Three giants in eight, so rings stay an event.
			hasRings: (seed & 7) < 3,
			seed,
		};
	}

	if (warmth < WARMTH.LAVA)
		return {
			surface: "lava",
			warmth,
			atmosphere: 0.35,
			atmosphereColor: 0x8a3a1c,
			oceanFraction: 0,
			cloudCover: 0,
			hasRings: false,
			seed,
		};
	if (warmth < WARMTH.VENUS)
		return {
			surface: "venusian",
			warmth,
			atmosphere: 1,
			atmosphereColor: 0xd6bd7a,
			oceanFraction: 0,
			cloudCover: 0,
			hasRings: false,
			seed,
		};
	if (warmth < WARMTH.TERRAN)
		return {
			surface: "terran",
			warmth,
			atmosphere: 0.8,
			atmosphereColor: 0x3a86d8,
			// 0.55–0.75, so terran worlds vary between continents and archipelagos
			// without ever losing the ocean that makes them terran.
			oceanFraction: 0.55 + ((seed >>> 8) & 0xff) / 255 / 5,
			// Weather is the loudest thing about a terran world at a distance, and
			// the cover varies enough between them to be an identity of its own.
			cloudCover: 0.55 + ((seed >>> 16) & 0xff) / 255 / 2.2,
			hasRings: false,
			seed,
		};
	if (warmth < WARMTH.DESERT)
		return {
			surface: "desert",
			warmth,
			// Thin: enough for dust haze on the limb, not enough for a cloud deck.
			atmosphere: 0.3,
			atmosphereColor: 0xc98a5a,
			oceanFraction: 0,
			// Dust, not water: enough to streak, never enough to cover.
			cloudCover: 0.22,
			hasRings: false,
			seed,
		};
	return {
		surface: "ice",
		warmth,
		atmosphere: 0.2,
		atmosphereColor: 0x9fd0e8,
		// A frozen ocean is still an ocean: the fracture pattern needs one.
		oceanFraction: 0.9,
		cloudCover: 0.12,
		hasRings: false,
		seed,
	};
}
