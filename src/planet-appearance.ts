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
 * Callers get that ratio from `orbitWarmth(aAu, luminosity)` in `system.ts`
 * rather than spelling it themselves: `a_hab` is clamped into the orbit
 * envelope, and an unclamped `√L` agrees with it everywhere except at the edges
 * — which is precisely where it would misclassify with nothing to show for it.
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
	/** Linear-space RGB for that shell. Read only when `atmosphere` is above 0;
	 *  a class with no shell leaves it at 0 rather than at a colour nothing
	 *  draws. */
	atmosphereColor: number;
	/**
	 * The elevation the shader floods to, on its stretched 0..1 terrain field.
	 *
	 * **Not the ocean fraction.** `stretch()` widens a bell-shaped fBm so a
	 * threshold near the middle is a usable control, but it does not turn the
	 * mapping into a CDF. `probe-planets.mjs` sweeps it and prints the pairing;
	 * the relationship is monotonic, which is what the shader needs, and it is
	 * not an identity, which is what an `oceanFraction` name would have promised.
	 * Figures are not repeated here — a number copied out of a probe run is a
	 * number nothing keeps current.
	 *
	 * 0 means the class has no *liquid* ocean. An ice world's is frozen solid and
	 * still sets it, because the fracture pattern is drawn across the shell that
	 * froze.
	 */
	seaLevel: number;
	/** How much of the disc a separate weather shell covers. 0 draws no shell —
	 *  a venusian world's deck *is* its surface, and a gas giant's bands are
	 *  painted into it, so neither gets a second one. */
	cloudCover: number;
	/** Only gas giants carry them, and only some of those. */
	hasRings: boolean;
	seed: number;
}

import { GIANT_ORBIT_FACTOR } from "./system";

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
 * `DESERT` and `GIANT` are deliberately one number, not two that happen to
 * match: past the desert rung a body is either an ice world or a gas giant, and
 * which one is not a question of distance. Deriving one from the other keeps an
 * edit to the boundary from silently splitting the line in half.
 */
export const WARMTH = {
	/** Inside this, the crust does not stay solid. */
	LAVA: 0.45,
	/** Runaway greenhouse: the surface is never visible through the deck. */
	VENUS: 0.78,
	/** Liquid water. The band is narrow on purpose — terran worlds should feel
	 *  found, not issued. */
	TERRAN: 1.3,
	/** Cold enough that the ocean is gone. The same line as `GIANT`. */
	DESERT: GIANT_ORBIT_FACTOR,
	/** `system.ts`'s own `isGasGiant` factor, imported rather than restated.
	 *  Together with `orbitWarmth` — which owns the clamped denominator — both
	 *  halves of the comparison now come from the generator, so the parity is
	 *  structural. The generated-systems sweep in the tests still runs, because
	 *  it checks the *rule built on them* agrees per planet. */
	GIANT: GIANT_ORBIT_FACTOR,
	/** Beyond this a giant is methane-blue rather than ammonia-brown. */
	ICE_GIANT: 5.0,
} as const;

/**
 * Which rung a body sits on.
 *
 * Split out from `appearanceFor` because it is the part the parity test wants:
 * given a generated planet's orbit and the generator's own `isGasGiant`, does
 * this ladder agree about which family it belongs to?
 *
 * Overloaded for the same reason `appearanceFor` is — a planet must say which
 * family it is in, and a star or a moon must not be handed a flag that would be
 * silently ignored.
 */
export function classify(kind: "star", warmth: number): SurfaceClass;
export function classify(kind: "moon", warmth: number): SurfaceClass;
export function classify(
	kind: "planet",
	warmth: number,
	isGasGiant: boolean,
): SurfaceClass;
export function classify(
	kind: "star" | "planet" | "moon",
	warmth: number,
	isGasGiant = false,
): SurfaceClass {
	if (kind === "star") return "star";
	// A moon is airless whatever its orbit: nothing at moon mass holds a shell
	// long enough to matter. It still reads cold or scorched through its albedo,
	// which the shader takes from `warmth`.
	if (kind === "moon") return "airless";
	if (isGasGiant) return warmth > WARMTH.ICE_GIANT ? "iceGiant" : "jovian";
	if (warmth < WARMTH.LAVA) return "lava";
	if (warmth < WARMTH.VENUS) return "venusian";
	if (warmth < WARMTH.TERRAN) return "terran";
	if (warmth < WARMTH.DESERT) return "desert";
	return "ice";
}

/** Fields a class does not set. Spelled once rather than in every rung. */
const NO_SHELL = {
	atmosphere: 0,
	atmosphereColor: 0,
	seaLevel: 0,
	cloudCover: 0,
	hasRings: false,
} as const;

/**
 * What each class carries beyond the surface treatment itself.
 *
 * A table rather than nine object literals: `PlanetAppearance` is the part of
 * this prototype meant to outlive it, and a field added to the interface should
 * be one edit here, not nine.
 */
const CLASS_TRAITS: Record<
	SurfaceClass,
	Partial<Omit<PlanetAppearance, "surface" | "warmth" | "seed">>
> = {
	star: {},
	airless: {},
	lava: { atmosphere: 0.35, atmosphereColor: 0x8a3a1c },
	venusian: { atmosphere: 1, atmosphereColor: 0xd6bd7a },
	terran: { atmosphere: 0.8, atmosphereColor: 0x3a86d8 },
	// Thin: enough for dust haze on the limb, never enough for a cloud deck.
	desert: { atmosphere: 0.3, atmosphereColor: 0xc98a5a, cloudCover: 0.22 },
	ice: {
		atmosphere: 0.2,
		atmosphereColor: 0x9fd0e8,
		// A frozen ocean is still an ocean: the fracture pattern needs one.
		seaLevel: 0.9,
		cloudCover: 0.12,
	},
	jovian: { atmosphere: 1, atmosphereColor: 0xd8a05a },
	iceGiant: { atmosphere: 1, atmosphereColor: 0x4a86c8 },
};

/**
 * Classify one body for display.
 *
 * `warmth` is `aAu / habitableAu`. A **planet must state its `isGasGiant`** —
 * the generator always knows it, and defaulting the flag is how an earlier
 * revision made every cold rocky world render as a gas giant with no error to
 * show for it. A moon takes its *parent's* warmth, which is the right answer: a
 * moon is at its planet's distance from the star.
 */
export function appearanceFor(kind: "star", id: string): PlanetAppearance;
export function appearanceFor(
	kind: "moon",
	id: string,
	warmth: number,
): PlanetAppearance;
export function appearanceFor(
	kind: "planet",
	id: string,
	warmth: number,
	isGasGiant: boolean,
): PlanetAppearance;
export function appearanceFor(
	kind: "star" | "planet" | "moon",
	id: string,
	warmth = 0,
	isGasGiant = false,
): PlanetAppearance {
	const seed = hash(id);
	// The overloads exist for callers; inside the implementation signature `kind`
	// is the union, so this is the one place the narrowing has to be spelled.
	const surface =
		kind === "star"
			? classify("star", warmth)
			: kind === "moon"
				? classify("moon", warmth)
				: classify("planet", warmth, isGasGiant);
	const look: PlanetAppearance = {
		surface,
		warmth: kind === "star" ? 0 : warmth,
		seed,
		...NO_SHELL,
		...CLASS_TRAITS[surface],
	};

	if (surface === "terran") {
		// 0.55–0.75. `probe-planets.mjs` sweeps the band and checks both of its
		// ends for land and water, so no terran world loses the sea that makes it
		// terran or drowns entirely. Measured there: 29% ocean at 0.55, 58% at
		// 0.75.
		look.seaLevel = 0.55 + ((seed >>> 8) & 0xff) / 255 / 5;
		// Weather is the loudest thing about a terran world at a distance, and
		// the cover varies enough between them to be an identity of its own.
		look.cloudCover = 0.55 + ((seed >>> 16) & 0xff) / 255 / 2.25;
	}
	// Three giants in eight, so rings stay an event. Read off the *top* byte:
	// the hash comment above disclaims its distribution, and leaning on the low
	// bits of a value declared "not a good distribution" would be taking back
	// the disclaimer one line later.
	if (surface === "jovian" || surface === "iceGiant")
		look.hasRings = ((seed >>> 24) & 7) < 3;

	return look;
}
