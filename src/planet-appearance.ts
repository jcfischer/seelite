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

/**
 * The classes that can carry rings, as data rather than as a condition.
 *
 * Read by the draw below and by `planet-shaders.ts`, which compiles #210's ring
 * shadow into these two programs and no others. That is what makes it one list:
 * a class added here and not there would draw a ring with nothing under it, and
 * the shadow term costs every fragment of every class it is compiled into, so
 * it cannot simply go in all of them.
 *
 * It is also the anti-criterion `tests/planet-surfaces.test.ts` holds. A baked
 * body is drawn from a cube whose lighting is applied afterwards, and the ring
 * shadow lives in the *procedural* program — so a class that gained a bake
 * descriptor while being ringable would lose its shadow with nothing going red.
 */
export const RINGED_CLASSES = Object.freeze([
	"jovian",
	"iceGiant",
]) as readonly SurfaceClass[];

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

import {
	GIANT_ORBIT_FACTOR,
	type PlacedBody,
	type Planet,
	type SystemContents,
	orbitWarmth,
} from "./system";

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
	/** `system.ts`'s outer-orbit factor, imported rather than restated.
	 *  Beyond it formation mass decides giant or rocky; this line alone no
	 *  longer predicts the family. */
	GIANT: GIANT_ORBIT_FACTOR,
	/** Beyond this a giant is methane-blue rather than ammonia-brown. */
	ICE_GIANT: 5.0,
} as const;

/**
 * Which rung a body sits on.
 *
 * Split out from `appearanceFor` so generated planets can pass their explicit
 * family alongside orbit warmth. The appearance test checks reachability of
 * every rung, including cold rocky ice worlds.
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
	/*
	 * **The giants are no longer at the maximum, and that is what the orange
	 * halo was (#209).**
	 *
	 * `atmosphere` reaches the shell twice over in `planet-surface.ts`: as
	 * `atmoStrength`, the alpha the shell contributes, and through
	 * `shellScale = 1.06 + atmosphere * 0.05`, how far it stands off the
	 * surface. At 1 the giants carried the thickest and strongest shell in the
	 * game — thicker than Venus needs a reason to be — and `ATMOSPHERE_FRAGMENT`
	 * did the rest correctly: a wide annulus of saturated `atmoColor` around a
	 * disc whose own colours it then dominated.
	 *
	 * `gallery-jovian` read that as "a uniform orange ring", and the term the
	 * node asked for as its replacement — limb darkening — was already in
	 * `shade()` for every class and had been since #59. Nothing needed adding.
	 * What was wrong was this row: 0.55 puts the jovian's shell at 1.088 radii
	 * rather than 1.11 and halves what it contributes, so the limb reads as air
	 * over a surface instead of as a painted ring, and the surface's own
	 * darkening at the edge is no longer buried under it.
	 *
	 * The colour moves with it. 0xd8a05a is the mid-band gold, which is why the
	 * ring looked like a wider band: an atmosphere seen edge-on is *not* the
	 * deck's colour, it is what the deck's colour becomes after a long path
	 * through haze. Warmer and paler, and the sunset term in the shell shader
	 * grades it further at the grazing end.
	 *
	 * The ice giant keeps a thicker shell than the jovian at 0.7: methane haze
	 * burying the banding is the whole read of that class
	 * (`planet-classes.glsl.ts`), so its limb is meant to be soft. It was never
	 * the subject of the complaint.
	 */
	jovian: { atmosphere: 0.55, atmosphereColor: 0xe8be8a },
	iceGiant: { atmosphere: 0.7, atmosphereColor: 0x6fa4d8 },
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
	if (RINGED_CLASSES.includes(surface)) look.hasRings = ((seed >>> 24) & 7) < 3;

	return look;
}

/**
 * The appearance of one placed body, read off the contents it came from.
 *
 * The renderer's job is to draw what the generator made, and every number that
 * decides how a body looks is already in `SystemContents`: the planet's `aAu`,
 * its `isGasGiant`, and the star's luminosity. This is the one place that join
 * is spelled, so no caller re-derives a warmth of its own — a second derivation
 * agreeing today is a second derivation, and `orbitWarmth` owns the clamped
 * denominator that makes the two disagree at the envelope's edges.
 *
 * The same stance as `colorFor` in `sim.ts` on a body that is not in the
 * contents: it **throws**. A placed body the contents does not know about is
 * the two halves of the generator disagreeing about what is in the system, not
 * a display question with a sensible default.
 *
 * A station returns `undefined` rather than a class. It is the one body that is
 * not a sphere — `station-mesh.ts` draws it — and handing it a surface class
 * would be a value nothing reads.
 */
export function appearanceOf(
	body: Pick<PlacedBody, "id" | "kind">,
	contents: SystemContents,
): PlanetAppearance | undefined {
	if (body.kind === "station") return undefined;
	if (body.kind === "star") return appearanceFor("star", body.id);

	const warmthOf = (planet: Planet) =>
		orbitWarmth(planet.aAu, contents.star.luminosity);

	if (body.kind === "planet") {
		const planet = contents.planets.find((p) => p.id === body.id);
		if (!planet) throw new Error(`planet ${body.id} is not in the contents`);
		return appearanceFor(
			"planet",
			planet.id,
			warmthOf(planet),
			planet.isGasGiant,
		);
	}

	// A moon takes its *parent's* warmth: it is at the planet's distance from
	// the star, and a moon warmth of its own would be a different number for no
	// physical reason. Found by searching the moon lists rather than by parsing
	// `${planetId}-moon-${n}` out of the id — the id format is the generator's
	// business, and a reader that knows it is a second place to edit.
	const host = contents.planets.find((p) =>
		p.moons.some((m) => m.id === body.id),
	);
	if (!host) throw new Error(`moon ${body.id} is not in the contents`);
	return appearanceFor("moon", body.id, warmthOf(host));
}
