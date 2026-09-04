/**
 * What is physically inside a system: star, planets, belt, stations, and where
 * all of it is at a given moment.
 *
 * Built from `docs/specs/galaxy-generation.md` §6–§7 (node
 * [#6](https://github.com/jcfischer/seelite/issues/6)). `galaxy.ts` owns the
 * record — polity, name, position in the cluster; this owns the contents.
 *
 * ## Two decisions from the spec drive everything here
 *
 * **Systems are multi-station.** 0–3 typed stations — 0 only through the
 * undockable defect noted on `generateStations` below — and the types are not
 * interchangeable: two identical trade stations 200,000 km apart is just a
 * longer commute for the same transaction. That is what turns in-system travel
 * (#10) from a single crossing into a routing problem and obliges #7 to price
 * per station rather than per system.
 *
 * **Positions are `f(systemSeed, gameTime)`, never constants.** Orbital motion
 * is invisible within a session — Earth moves 30 km/s, so ten minutes displaces
 * it 18,000 km, which is nothing at AU scale. What it buys is that the data
 * model has a clock in it from the start, and a clock is very likely needed
 * anyway (market regeneration in #7, legal-status decay). Baking positions in
 * as constants is the cheap thing to write and the expensive thing to undo.
 *
 * Orbits are **circular**. Kepler ellipses were rejected: eccentricity adds a
 * solver for an effect nobody can perceive at these speeds.
 *
 * ## Scale
 *
 * Real distances, float64 kilometres, exactly as the scale research (#3)
 * specified and as `units.ts` is sized for. The consequence is that
 * station-to-station legs run to ~10⁸ km, which is why #10 had to deliver a
 * cruise regime. Compressing the system to something crossable would leave the
 * far layer with nothing to do and the three-layer split unjustified.
 *
 * ## What is spec'd here and what is merely plausible
 *
 * Spec'd: the class weights and luminosities, the orbit envelope, the ladder
 * and its rescale, the belt probability, the station rules, the orbit and
 * period formulas, the arrival point.
 *
 * Not spec'd, and chosen here because the renderer needs a number: body radii,
 * body colours, moon orbits. They are scenery — nothing reads them but the far
 * layer — and they are marked at each site so a later decision node can take
 * them without having to work out which constants were load-bearing.
 *
 * **The scenery constants are outside the draw contract.** Changing a radius
 * band or a colour changes what a body looks like and moves no draw: the rolls
 * are taken first and scaled afterwards. So a renderer decision may retune them
 * without touching a seed's output — which is why they can sit in this module
 * without making it the renderer's business. The one exception is the gas-giant
 * *threshold* (`a > 2·a_hab`), which is spec'd (§6.2) and does decide moons.
 */

import { moonName, planetName, starName } from "./body-name";
import { DOMAIN } from "./domains";
import { type SystemRecord, stream } from "./galaxy";
import { type Vec3, dot, lengthSq } from "./vec3";
import {
	LOCAL_CARRIER_ID,
	SPIN_RPM_RANGE,
	STATION_FENCE_ELIGIBLE,
	STATION_GEOMETRY,
	type StationType,
	fenceProbability,
} from "./station";
import { stationNames } from "./station-name";
import { AU_KM } from "./units";

/** Seconds in a Julian year, the unit Kepler III is written in below. */
const YEAR_S = 365.25 * 86400;

/** The orbit envelope, in AU (spec §6.2). Nothing generated here sits outside
 *  it, including a habitable distance that would otherwise fall short. */
export const MIN_ORBIT_AU = 0.3;
export const MAX_ORBIT_AU = 6;

/** Probability a system has an asteroid belt (spec §6.3). */
export const BELT_PROBABILITY = 0.45;

/** Where a jump drops you, and how far from a body it must be (spec §7.4). */
export const ARRIVAL_DISTANCE_AU = 1.0;
export const ARRIVAL_CLEARANCE_AU = 0.25;

/** Shipyards exist only from here up (spec §6.4) — which is what gives the
 *  radial tech gradient teeth, since tech tracks radius. */
export const SHIPYARD_MIN_TL = 10;

/** Moons per gas giant (spec §6.2), and how many draws each one costs. One
 *  constant for both the count's upper bound and the size of the roll table, so
 *  the two cannot drift apart and leave a fallback guarding nothing. */
export const MAX_MOONS = 3;

/**
 * A planet is a gas giant past this multiple of the habitable distance (§6.2).
 *
 * Exported because the renderer's surface classifier draws the same line, and a
 * second copy of the number over there would be kept honest only by a test.
 * The generator owns it; display reads it.
 */
export const GIANT_ORBIT_FACTOR = 2;

/**
 * How high a station's orbit floor is, as a multiple of its host's radius
 * (node #32, against `in-system-travel.md` §12.2/§12.3).
 *
 * `1.5`, chosen as the knee of the measured curve. The ranking lives in
 * `galaxy-generation.md` §7.3: 26.1% of cruise legs occluded with no floor
 * (49 of 337 planet-orbiting stations inside their own host's 1.05 shell —
 * the geometry behind §12.2's "second cruise covers 1 km" figure, which
 * §12.2 itself walks back as an overclaim for the game), 14.5% at 1.5,
 * 7.4% at 2.2, 4.1% at 3 — and `measure-cruise-arrival.ts` re-derives the
 * set for whatever the constant is set to, which is how a rejected floor
 * stays recoverable without a switch. What the rejected floors were rejected
 * for is the same linear `R`: a big-giant shipyard is already ~35,000 km up
 * at 1.5, ~84,000 at 2.2, ~140,000 at 3, and the period band keeps the
 * orbital speed climbing with the altitude.
 *
 * It is a **floor**, not an orbit: the 400–2,000 km band still decides
 * whenever it lands above the floor, which it does for small hosts — a
 * 2,400 km rocky world's band tops out at 1.83 × radius, so its stations
 * keep the low band — and above a 4,000 km host (`2,000 / (1.5 − 1)`, the
 * point past which no band draw can reach the floor) the floor term is the
 * max by arithmetic and every station rides at exactly 1.5 × the host's
 * radius. The looser bound it clears by construction, the 1.05 × shell,
 * crosses the band only at 40,000 km of host radius.
 * `tests/station-orbits.test.ts` pins both regimes, and
 * `measure-station-shells.ts` sweeps the placed-geometry population at t0
 * that the floor is why `probe-arrival.mjs` no longer flies.
 */
export const STATION_ORBIT_R_OVER_R = 1.5;

/**
 * The habitable distance (§6.1): √(L/L☉) AU, clamped into the orbit envelope.
 * An M dwarf's 0.2 AU is pulled out to 0.3; an A star's 4.5 sits inside 6.
 *
 * Exported because the renderer's surface classifier keys every class on
 * `aAu / habitableDistanceAu(L)`, and **the clamp is the part that is easy to
 * get wrong**: an unclamped `sqrt(L)` agrees with this everywhere except at the
 * envelope edges, which is exactly where it would misclassify silently. Sharing
 * the factor alone left that denominator hand-copied.
 */
export const habitableDistanceAu = (luminosity: number) =>
	Math.min(MAX_ORBIT_AU, Math.max(MIN_ORBIT_AU, Math.sqrt(luminosity)));

/**
 * `a/a_hab` for one planet — the number the surface classifier switches on.
 *
 * One exported expression so display, tests and any future caller cannot each
 * spell the ratio slightly differently.
 */
export const orbitWarmth = (aAu: number, luminosity: number) =>
	aAu / habitableDistanceAu(luminosity);
const ROLLS_PER_MOON = 4;

/**
 * Body sizes and moon orbits — **scenery, not spec** (see the module docstring),
 * named rather than inline so that the one place a later decision node has to
 * look is this block, and so the two size bands cannot drift apart unnoticed.
 */
const ROCKY_RADIUS_KM = { base: 2400, span: 5600 };
const GIANT_RADIUS_KM = { base: 25000, span: 50000 };
const MOON_RADIUS_KM = { base: 800, span: 1700 };
const MOON_ORBIT_KM = { base: 5e4, span: 3.5e5 };

export type StarClass = "M" | "K" | "G" | "F" | "A";

export interface StarClassDef {
	cls: StarClass;
	/** Draw weight (spec §6.1). Weighted to the main sequence and capped at A:
	 *  O and B are short-lived and would push the habitable band past the orbit
	 *  envelope. */
	weight: number;
	/** Luminosity in solar units — the only field the habitable distance reads. */
	luminosity: number;
	/** Mass in solar units — Kepler III's denominator. */
	massSolar: number;
	/** Scenery, not spec: roughly the main-sequence radius for the class. */
	radiusKm: number;
	/** Scenery, not spec. */
	color: number;
}

export const STAR_CLASSES: readonly StarClassDef[] = [
	{
		cls: "M",
		weight: 0.6,
		luminosity: 0.04,
		massSolar: 0.4,
		radiusKm: 2.78e5,
		color: 0xffb26b,
	},
	{
		cls: "K",
		weight: 0.16,
		luminosity: 0.35,
		massSolar: 0.7,
		radiusKm: 4.87e5,
		color: 0xffd2a1,
	},
	{
		cls: "G",
		weight: 0.13,
		luminosity: 1.0,
		massSolar: 1.0,
		radiusKm: 6.96e5,
		color: 0xfff4ea,
	},
	{
		cls: "F",
		weight: 0.08,
		luminosity: 3.0,
		massSolar: 1.3,
		radiusKm: 9.05e5,
		color: 0xf8f7ff,
	},
	{
		cls: "A",
		weight: 0.03,
		luminosity: 20.0,
		massSolar: 2.0,
		radiusKm: 1.18e6,
		color: 0xcad7ff,
	},
];

/**
 * A circular orbit, in the plane defined by an inclination and an ascending
 * node.
 *
 * `radiusKm` is a true radius rather than a semi-major axis, because the orbit
 * is a circle — there is no second axis to be major with respect to.
 */
export interface Orbit {
	radiusKm: number;
	periodS: number;
	/** Phase at `gameTime` 0. */
	theta0: number;
	/** Radians from the system's reference plane. */
	inclination: number;
	/** Longitude of the ascending node, radians. */
	node: number;
}

export interface Moon {
	id: string;
	name: string;
	radiusKm: number;
	/** Around its planet. */
	orbit: Orbit;
}

export interface Planet {
	id: string;
	name: string;
	/** Orbit radius in AU — the figure the spec's envelope and ladder talk in. */
	aAu: number;
	radiusKm: number;
	/** `a > 2·a_hab` (spec §6.2). Gas giants carry moons and can host a
	 *  shipyard. */
	isGasGiant: boolean;
	/** The one rung the ladder was rescaled onto `a_hab`. Hosts the main trade
	 *  station. */
	isPrimary: boolean;
	/** Around the star. */
	orbit: Orbit;
	moons: Moon[];
}

export interface Belt {
	/** Geometric mean of the two orbits it sits between, AU. */
	aAu: number;
	/** ±10% of `aAu` (spec §6.3). */
	halfWidthAu: number;
}

/**
 * Re-exported from `station.ts`, which owns the type and every table keyed on
 * it.
 *
 * @deprecated Import `StationType` from `./station`. This alias exists so #28
 * did not have to touch every importer in one commit; it is a migration
 * convenience, not a boundary, and two paths to one type give new code no
 * signal about which is canonical.
 */
export type { StationType };

export interface Station {
	id: string;
	/** Display-only proper name. Identity remains `id`; persistence remains
	 *  `localCarrierId`. */
	name: string;
	type: StationType;
	/**
	 * The system-local carrier-slot persistence ID
	 * (`persistent-world-state.md` §2), from `LOCAL_CARRIER_ID`.
	 *
	 * Equal to `id` in v1 and still not the same thing: `id` is a display and
	 * lookup key, this is what a save row is filed under. `economy-trade.md`
	 * §5.5 keys the stock deficit on `(systemIndex, localCarrierId)`, so a
	 * rename of `id` for the map screen must not move anybody's market memory.
	 */
	localCarrierId: string;
	/** The planet it orbits, or `null` for a star-centric orbit (the refinery,
	 *  which sits in the belt). */
	parentId: string | null;
	orbit: Orbit;
	/**
	 * Whether this station trades illegal goods (`station-types.md` §5.2). Only
	 * a refinery can be one, and only some are; it is not inferable from the
	 * galaxy map, which is the texture being bought.
	 *
	 * **The only economy field that belongs on this record, and it is here
	 * because it is generated.** It is drawn once from the seed and never
	 * changes, exactly like `type` and `orbit`. Prices, stock and the saved
	 * stock deficit (#7) are all functions of the clock or of what the player
	 * did, so they belong to the market module keyed by the composite carrier
	 * slot identity — putting them here would make a station record something
	 * that has to be saved.
	 */
	blackMarket: boolean;
	/** Rotation about the aperture axis, rpm (`docking.md` §4). 0 for the
	 *  refinery's fixed pad; [0.6, 3.0] for the two Coriolis types, where it is
	 *  the difficulty dial rather than decoration. */
	spinRpm: number;
	/**
	 * The station's own berth draw (`docking.md` §13.2).
	 *
	 * Today it decides only which side an outpost's second berth is on, which is
	 * why it is an integer rather than a berth id: the catalogue is the
	 * geometry's to build, and a generated *layout* would put a silhouette
	 * decision in the generator.
	 */
	berthSeed: number;
}

export interface SystemContents {
	star: StarClassDef & { id: string; name: string };
	/** The habitable distance, AU, clamped into the orbit envelope. */
	habitableAu: number;
	planets: Planet[];
	belt: Belt | null;
	stations: Station[];
}

/** Anything with a position, for the callers that just want to draw or measure
 *  the system. */
export interface PlacedBody {
	id: string;
	name: string;
	kind: "star" | "planet" | "moon" | "station";
	/** Present only for stations, so presentation can print `TRADE STATION`
	 *  without turning that label into identity. */
	stationType?: StationType;
	pos: Vec3;
	radiusKm: number;
}

const TAU = Math.PI * 2;
const uniform = (rand: () => number, lo: number, hi: number): number =>
	lo + rand() * (hi - lo);

/** Kepler III, in the form the spec writes it: `T = 1 yr · √(a³/M★)`. */
export const orbitalPeriodS = (aAu: number, massSolar: number): number =>
	YEAR_S * Math.sqrt((aAu * aAu * aAu) / massSolar);

/**
 * The unit normal of an orbital plane, from the same `inclination` and `node`
 * `positionOnOrbit` builds a position from.
 *
 * Exported so a measurement does not restate the convention: the two have to
 * agree about which way the plane tilts, and a script with its own copy of the
 * rotation is a script that can report a geometry the generator does not have.
 */
export function orbitNormal(orbit: Orbit): Vec3 {
	const sinI = Math.sin(orbit.inclination);
	return {
		x: sinI * Math.sin(orbit.node),
		y: -sinI * Math.cos(orbit.node),
		z: Math.cos(orbit.inclination),
	};
}

/**
 * Where a circular orbit is at `gameTime`, relative to whatever it orbits.
 *
 * `θ(t) = θ₀ + 2πt/T` in the orbital plane, then tilted by the inclination and
 * rotated to the ascending node. Pure in `(orbit, t)`, which is the property
 * §7.3 is really asking for — every position in the game is a function of the
 * seed and the clock, and nothing accumulates.
 */
export function positionOnOrbit(orbit: Orbit, gameTime: number): Vec3 {
	const theta = orbit.theta0 + (TAU * gameTime) / orbit.periodS;
	const x = orbit.radiusKm * Math.cos(theta);
	const y = orbit.radiusKm * Math.sin(theta);
	// Tilt about the x-axis by the inclination, then rotate about z by the node.
	const yi = y * Math.cos(orbit.inclination);
	const zi = y * Math.sin(orbit.inclination);
	const cn = Math.cos(orbit.node);
	const sn = Math.sin(orbit.node);
	return { x: x * cn - yi * sn, y: x * sn + yi * cn, z: zi };
}

/**
 * How fast a body on that orbit is moving, km/s — the exact derivative of
 * `positionOnOrbit` with respect to `gameTime`.
 *
 * Analytic rather than a finite difference of two positions, because the two
 * positions are ~10⁸ km numbers differing by a few km: the subtraction is
 * where the precision goes, and it is avoidable. Same transform as the position
 * — tilt by the inclination, rotate to the node — applied to the tangential
 * velocity instead of the radius, because both transforms are linear.
 *
 * It exists because #14 found that arrival is a *relative* problem: a station
 * on a 1 AU orbit is carried along at ~30 km/s, fifteen times #5's 2 km/s
 * assist cap. Dropping out of cruise into a frame where the target is
 * receding at 28 km/s leaves it permanently unreachable, so the drop-out and
 * the exit clamp have to be measured against this rather than against zero.
 */
export function velocityOnOrbit(orbit: Orbit, gameTime: number): Vec3 {
	const omega = TAU / orbit.periodS;
	const theta = orbit.theta0 + omega * gameTime;
	const vx = -orbit.radiusKm * omega * Math.sin(theta);
	const vy = orbit.radiusKm * omega * Math.cos(theta);
	const vyi = vy * Math.cos(orbit.inclination);
	const vzi = vy * Math.sin(orbit.inclination);
	const cn = Math.cos(orbit.node);
	const sn = Math.sin(orbit.node);
	return { x: vx * cn - vyi * sn, y: vx * sn + vyi * cn, z: vzi };
}

/**
 * Maximum acceleration contributed by one circular orbit, km/s².
 *
 * Circular motion has constant acceleration magnitude `R * omega²`.  Cruise
 * uses it to bound the departure of the exact orbit from its frame-start
 * tangent by `0.5 * a * dt²`; the bound travels with the motion snapshot so
 * the pure collision kernel never reads the world clock.
 */
export function accelerationBoundOnOrbit(orbit: Orbit): number {
	const omega = TAU / orbit.periodS;
	return orbit.radiusKm * omega * omega;
}

/** Summed once. The table is frozen, so recomputing it per system was 2048
 *  reductions over five constants. */
const STAR_WEIGHT_TOTAL = STAR_CLASSES.reduce((sum, c) => sum + c.weight, 0);

const pickWeighted = (rand: () => number): StarClassDef => {
	let u = rand() * STAR_WEIGHT_TOTAL;
	for (const c of STAR_CLASSES) {
		u -= c.weight;
		if (u <= 0) return c;
	}
	return STAR_CLASSES[STAR_CLASSES.length - 1];
};

/**
 * Generate a system's contents from its record.
 *
 * Two streams, in a fixed draw order each: `BODIES` for the star, planets, moons
 * and belt; `STATIONS` for the stations. Inserting a draw inside one of them
 * moves everything after it in that stream and nothing in the other — which is
 * the whole reason the domains exist, and the reason to add a *new* domain
 * rather than a draw when something genuinely new arrives.
 */
export function generateContents(record: SystemRecord): SystemContents {
	const bodies = stream(record.seed, DOMAIN.BODIES);
	const star = {
		id: "star",
		name: starName(record.name),
		...pickWeighted(bodies),
	};

	const habitableAu = habitableDistanceAu(star.luminosity);

	// The ladder (§6.2): Titius-Bode-like ratios, then rescaled in log space so
	// one rung lands exactly on `a_hab`. Rescaling rather than seeding a planet
	// at `a_hab` directly is what keeps the spacing statistics the same whatever
	// the star class — the ladder is generated once and slid, not rebuilt.
	const rungCount = 3 + Math.floor(bodies() * 5);
	const ladder = [1];
	for (let i = 1; i < rungCount; i++) {
		ladder.push(ladder[i - 1] * uniform(bodies, 1.4, 2.3));
	}
	const primaryRung = Math.floor(bodies() * rungCount);
	const scaleFactor = habitableAu / ladder[primaryRung];

	const planets: Planet[] = [];
	for (let i = 0; i < rungCount; i++) {
		const aAu = ladder[i] * scaleFactor;
		const isPrimary = i === primaryRung;
		// Draws happen for discarded rungs too, so that whether a rung survives
		// does not shift the parameters of the ones that do.
		const radiusRoll = bodies();
		const theta0 = bodies() * TAU;
		const inclination = uniform(bodies, 0, (3 * Math.PI) / 180);
		const node = bodies() * TAU;
		const moonCount = Math.floor(bodies() * (MAX_MOONS + 1));
		// `MAX_MOONS` rolls are drawn whether or not this rung keeps any of them,
		// for the same reason the rung's own parameters are: the draw sequence is
		// the contract, and making it conditional on `moonCount` would couple every
		// later system parameter to a moon count. Flat rather than nested arrays —
		// this runs for all 2048 systems and the nesting bought nothing.
		const moonRolls: number[] = [];
		for (let r = 0; r < MAX_MOONS * ROLLS_PER_MOON; r++)
			moonRolls.push(bodies());
		/**
		 * The primary rung is kept, and clamped rather than discarded (#23/#51).
		 *
		 * `scaleFactor` is `habitableAu / ladder[primaryRung]`, so this rung is
		 * *meant* to land exactly on the habitable distance, which is itself
		 * already clamped into the envelope. It does not: `ladder[i] *
		 * scaleFactor` is not bit-for-bit `habitableAu`, and where the habitable
		 * distance has been clamped onto a boundary the product can fall a hair
		 * outside and be discarded by the test below.
		 *
		 * That produced both of the defects this fixes — a system with no planets
		 * at all when every other rung also fell outside, and, three times as
		 * often, a system that kept planets but had none flagged primary. The
		 * second was invisible to #23's rate measurement because
		 * `generateStations` falls back to `planets[0]`, so those systems had a
		 * trade station and simply did not have it on a primary.
		 *
		 * Clamped to the boundary rather than merely exempted from the test: an
		 * exemption would let the primary sit outside the envelope the spec says
		 * nothing is generated outside, which is a different defect wearing the
		 * fix's clothes. `tests/system-reachability.test.ts` asserts both halves.
		 *
		 * No draw is added or reordered — this reads values already drawn — so
		 * every system that was valid before generates identically.
		 */
		const outside = aAu < MIN_ORBIT_AU || aAu > MAX_ORBIT_AU;
		if (outside && !isPrimary) continue;
		const orbitAu = outside
			? Math.min(MAX_ORBIT_AU, Math.max(MIN_ORBIT_AU, aAu))
			: aAu;

		const isGasGiant = orbitAu > GIANT_ORBIT_FACTOR * habitableAu;
		const size = isGasGiant ? GIANT_RADIUS_KM : ROCKY_RADIUS_KM;
		const radiusKm = size.base + radiusRoll * size.span;
		const id = `planet-${i}`;
		const name = planetName(record.name, planets.length);
		const moons = isGasGiant
			? buildMoons(id, name, radiusKm, moonCount, moonRolls, inclination, node)
			: [];
		planets.push({
			id,
			name,
			aAu: orbitAu,
			radiusKm,
			isGasGiant,
			isPrimary,
			orbit: {
				radiusKm: orbitAu * AU_KM,
				periodS: orbitalPeriodS(orbitAu, star.massSolar),
				theta0,
				inclination,
				node,
			},
			moons,
		});
	}

	// The belt (§6.3): a seeded gap between consecutive surviving orbits, at
	// their geometric mean. A system with fewer than two planets has no gap, so
	// it has no belt whatever the roll said.
	const wantsBelt = bodies() < BELT_PROBABILITY;
	const gapRoll = bodies();
	let belt: Belt | null = null;
	if (wantsBelt && planets.length >= 2) {
		const gap = Math.floor(gapRoll * (planets.length - 1));
		const aAu = Math.sqrt(planets[gap].aAu * planets[gap + 1].aAu);
		belt = { aAu, halfWidthAu: aAu * 0.1 };
	}

	const stations = generateStations(record, star, planets, belt);
	return { star, habitableAu, planets, belt, stations };
}

/**
 * A gas giant's moons, from rolls already drawn.
 *
 * Extracted from `generateContents` and taking **rolls, not a stream**, which is
 * the point: it cannot consume a draw, so it cannot move the draw sequence. That
 * keeps the ordering contract readable top-to-bottom in one function while the
 * moon assembly — the only genuinely nested part — lives on its own.
 *
 * Moon sizes and orbits are scenery. Far-layer only, per §6.2.
 */
function buildMoons(
	planetId: string,
	planetDisplayName: string,
	planetRadiusKm: number,
	count: number,
	rolls: readonly number[],
	inclination: number,
	node: number,
): Moon[] {
	const moons: Moon[] = [];
	for (let m = 0; m < count; m++) {
		const base = m * ROLLS_PER_MOON;
		moons.push({
			id: `${planetId}-moon-${m}`,
			name: moonName(planetDisplayName, m),
			radiusKm: MOON_RADIUS_KM.base + rolls[base] * MOON_RADIUS_KM.span,
			orbit: {
				radiusKm:
					planetRadiusKm +
					MOON_ORBIT_KM.base +
					rolls[base + 1] * MOON_ORBIT_KM.span,
				periodS: (0.5 + rolls[base + 2] * 14.5) * 86400,
				theta0: rolls[base + 3] * TAU,
				inclination,
				node,
			},
		});
	}
	return moons;
}

/**
 * 1–3 stations, typed (spec §6.4).
 *
 * **What the count actually keys off.** §6.4's prose says "population and tech";
 * the rules it then gives — and this code — read `displayTL` and whether the
 * system has a belt, and nothing reads `population` at all. The effect the spec
 * describes is real, because tech carries the radial gradient (§4.3) and a
 * high-TL core world is where both optional stations can land; the mechanism it
 * names is not. Written the way the code works, so that a later reader
 * comparing the two finds the difference here rather than in a debugger.
 *
 * **The trade station is unconditional again (#51).** It is guarded by
 * `if (primary)`, and a system could generate with no planet at all — nothing
 * to dock at, and no body for #10's arrival point either. The ladder now keeps
 * its primary rung rather than letting the envelope test discard it, so a
 * primary always exists. `docs/specs/station-types.md` §5.4 owns the
 * measurement; `tests/system-reachability.test.ts` asserts the invariant.
 *
 * **What enforces it, in four facts a reader can check.** `rungCount` is
 * `3 + floor(bodies() * 5)`, so it is 3..7. `primaryRung` is
 * `floor(bodies() * rungCount)`, so it is 0..rungCount-1. The loop runs `i`
 * over exactly that range. `isPrimary` is `i === primaryRung` — the step the
 * whole derivation turns on, which an earlier version of this comment left
 * off-page. So the envelope test, `if (outside && !isPrimary)`, cannot skip the
 * primary rung, and a primary is pushed for every system.
 *
 * What is *not* enforced is a runtime guard: nothing throws. If one of those
 * three facts were broken by a later edit, the trade station would be absent
 * rather than silently re-parented — the `?? planets[0]` fallback that used to
 * hide exactly that is gone. That is the trade this makes deliberately: a
 * visible failure the corpus test names, over a hidden one that produced a
 * dockable system on a planet the generator never flagged.
 */
/**
 * Draw a station's spin, consuming exactly one number whatever its type.
 *
 * **The refinery draws and discards** (`docking.md` §5). Skipping the draw would
 * make the draw count depend on station type, so inserting a refinery would
 * shift the spin of every station generated after it — the stream coupling the
 * per-domain tags exist to prevent, reintroduced inside a single tag. The
 * discard is therefore the point of this function, not an inefficiency in it.
 *
 * Here rather than in `station.ts` because it is *stream discipline*, and the
 * streams are this module's: what a station is stays in the table, how many
 * numbers generating one costs stays beside the generator.
 */
function drawSpinRpm(rand: () => number, type: StationType): number {
	const roll = rand();
	if (!STATION_GEOMETRY[type].spins) return 0;
	return (
		SPIN_RPM_RANGE.minRpm +
		roll * (SPIN_RPM_RANGE.maxRpm - SPIN_RPM_RANGE.minRpm)
	);
}

/** The fence flag, on the same draw-and-discard rule and for the same reason:
 *  every station consumes one number from `DOMAIN.STATION_FLAGS`. */
function drawBlackMarket(
	rand: () => number,
	type: StationType,
	government: number,
): boolean {
	const roll = rand();
	return STATION_FENCE_ELIGIBLE[type] && roll < fenceProbability(government);
}

function generateStations(
	record: SystemRecord,
	star: StarClassDef,
	planets: readonly Planet[],
	belt: Belt | null,
): Station[] {
	const rand = stream(record.seed, DOMAIN.STATIONS);
	// Two more streams, one per new field, and never `rand` above: a draw
	// inserted into the placement stream shifts every station after it, which is
	// what `tests/station-orbits.test.ts` exists to catch (§5.3).
	const flagRand = stream(record.seed, DOMAIN.STATION_FLAGS);
	const spinRand = stream(record.seed, DOMAIN.STATION_SPIN);
	const berthRand = stream(record.seed, DOMAIN.STATION_BERTHS);
	const names = stationNames(record.seed, record.name);
	const stations: Station[] = [];
	// **No `?? planets[0]` fallback.** It used to be there, and it is what made
	// the second defect invisible: a system whose primary rung alone was
	// filtered still got a trade station, on a planet not flagged primary, so no
	// station count could see it. With the primary rung now kept unconditionally
	// (see the ladder above) this can only be undefined if that guarantee has
	// broken — and then the right behaviour is the visible one, no trade
	// station, which `tests/system-reachability.test.ts` fails on by name.
	const primary = planets.find((p) => p.isPrimary);

	/**
	 * The two seeded fields, in station order, one draw each from each stream.
	 *
	 * Every station consumes both draws whatever its type — the refinery keeps
	 * its flag and discards its spin, the other two the reverse. Drawing
	 * conditionally would make the draw count depend on type, so a system that
	 * happens to have a refinery would spin its shipyard differently from one
	 * that does not (`docking.md` §5).
	 */
	const fields = (
		type: StationType,
	): Pick<
		Station,
		"name" | "blackMarket" | "spinRpm" | "localCarrierId" | "berthSeed"
	> => ({
		name: names[type],
		blackMarket: drawBlackMarket(flagRand, type, record.government),
		spinRpm: drawSpinRpm(spinRand, type),
		// Unconditional, like the two above and for the same reason: a draw kept
		// only for the types that read it makes the draw count depend on which
		// stations a system happens to have.
		berthSeed: Math.floor(berthRand() * 0x100000000),
		// Not a draw: the persistence identity is a table lookup
		// (`station.ts`), so it consumes nothing from either stream.
		localCarrierId: LOCAL_CARRIER_ID[type],
	});

	/** Station orbits are low and fast (§7.3): a few hundred to a couple of
	 *  thousand km up, 90–240 minutes round — floored at
	 *  `STATION_ORBIT_R_OVER_R` of the host; its doc carries why the band
	 *  alone could not stand, and the instrument named there re-measures the
	 *  figures. Spin, which docking has to match, belongs to #9. */
	const aroundBody = (body: Planet): Orbit => ({
		radiusKm: Math.max(
			body.radiusKm + uniform(rand, 400, 2000),
			body.radiusKm * STATION_ORBIT_R_OVER_R,
		),
		periodS: uniform(rand, 90, 240) * 60,
		theta0: rand() * TAU,
		inclination: body.orbit.inclination,
		node: body.orbit.node,
	});

	if (primary) {
		stations.push({
			id: "station-trade",
			type: "trade",
			parentId: primary.id,
			orbit: aroundBody(primary),
			...fields("trade"),
		});
	}

	if (belt) {
		// Star-centric: the refinery sits *in* the belt rather than orbiting a
		// body, so its period is Kepler's at the belt radius.
		const aAu = belt.aAu + uniform(rand, -belt.halfWidthAu, belt.halfWidthAu);
		stations.push({
			id: "station-refinery",
			type: "refinery",
			parentId: null,
			orbit: {
				radiusKm: aAu * AU_KM,
				periodS: orbitalPeriodS(aAu, star.massSolar),
				theta0: rand() * TAU,
				inclination: uniform(rand, 0, (3 * Math.PI) / 180),
				node: rand() * TAU,
			},
			...fields("refinery"),
		});
	}

	if (record.displayTL >= SHIPYARD_MIN_TL) {
		const hosts = [
			...(primary ? [primary] : []),
			...planets.filter((p) => p.isGasGiant),
		];
		const host = hosts[Math.floor(rand() * hosts.length)];
		if (host) {
			stations.push({
				id: "station-shipyard",
				type: "shipyard",
				parentId: host.id,
				orbit: aroundBody(host),
				...fields("shipyard"),
			});
		}
	}

	return stations;
}

/** Every body in the system, positioned, at `gameTime` seconds. The star sits
 *  at the origin: system frames are star-centred and galaxy-aligned (§7.4). */
export function placeBodies(
	contents: SystemContents,
	gameTime: number,
): PlacedBody[] {
	const placed: PlacedBody[] = [
		{
			id: contents.star.id,
			name: contents.star.name,
			kind: "star",
			pos: { x: 0, y: 0, z: 0 },
			radiusKm: contents.star.radiusKm,
		},
	];
	const at = new Map<string, Vec3>();
	for (const planet of contents.planets) {
		const pos = positionOnOrbit(planet.orbit, gameTime);
		at.set(planet.id, pos);
		placed.push({
			id: planet.id,
			name: planet.name,
			kind: "planet",
			pos,
			radiusKm: planet.radiusKm,
		});
		for (const moon of planet.moons) {
			const rel = positionOnOrbit(moon.orbit, gameTime);
			placed.push({
				id: moon.id,
				name: moon.name,
				kind: "moon",
				pos: { x: pos.x + rel.x, y: pos.y + rel.y, z: pos.z + rel.z },
				radiusKm: moon.radiusKm,
			});
		}
	}
	for (const station of contents.stations) {
		const rel = positionOnOrbit(station.orbit, gameTime);
		const base = station.parentId ? at.get(station.parentId) : undefined;
		placed.push({
			id: station.id,
			name: station.name,
			kind: "station",
			stationType: station.type,
			pos: base
				? { x: base.x + rel.x, y: base.y + rel.y, z: base.z + rel.z }
				: rel,
			// The dockable core, per type (`docking.md` §5). A table read with no
			// RNG call, so adding it shifted no stream and the placement fixture
			// is byte-identical — `spinRpm` is the only field here that draws.
			radiusKm: STATION_GEOMETRY[station.type].coreRadiusKm,
		});
	}
	return placed;
}

const norm = (v: Vec3): Vec3 => {
	const len = Math.sqrt(lengthSq(v));
	return len === 0
		? { x: 1, y: 0, z: 0 }
		: { x: v.x / len, y: v.y / len, z: v.z / len };
};

/**
 * Where a jump into this system puts you (spec §7.4).
 *
 * 1 AU out, on the **inbound bearing** — `normalize(p_origin − p_this)` in
 * galaxy coordinates, which maps straight in because system frames are
 * galaxy-aligned. That means the system genuinely looks different depending on
 * your route, and the crossing to a given station varies from ~0.2 to ~3 AU. A
 * fixed witchpoint would throw that away for no saving.
 *
 * `originPos` is `null` on a new game, where there is no previous system; the
 * bearing then comes from the system's own stream so it is still deterministic.
 *
 * §7.4's "push it outward until it is clear" is **solved rather than stepped**.
 * The point rides a ray, so each body's exclusion sphere cuts it in exactly one
 * interval, whose ends are the roots of `d² − 2td + (|b|² − c²)` with
 * `t = b·bearing`. Pushing to the far root of whichever interval still contains
 * the point terminates in at most one pass per body — each push leaves that
 * body's interval for good, and `d` only increases.
 *
 * A first version walked outward in 0.05 AU steps and returned a bounded
 * fallback if it ran out of room, with a comment asserting the fallback was
 * unreachable. That assertion was probably true and was not *checked* anywhere —
 * the bound it rested on ignored moon offsets, and the clearance test only
 * sampled `gameTime` 0. Solving removes both the claim and the fallback: the
 * returned point clears every body by construction, at every clock value.
 */
export function arrivalPoint(
	record: SystemRecord,
	contents: SystemContents,
	originPos: Vec3 | null,
	gameTime: number,
): Vec3 {
	let bearing: Vec3;
	if (originPos) {
		bearing = norm({
			x: originPos.x - record.pos.x,
			y: originPos.y - record.pos.y,
			z: originPos.z - record.pos.z,
		});
	} else {
		// `ARRIVAL`, not `POS`. Drawing this from `POS` replays the stream
		// `systemPosition` already consumed, so `cosTheta` becomes `2·u_radius − 1`
		// and `phi` becomes the position's own polar draw: a rim system (u → 1)
		// would always arrive within a few degrees of +z, with its azimuth locked
		// to its polar angle. Deterministic and wrong, and the clearance tests
		// cannot see it because a correlated bearing still clears every body.
		const rand = stream(record.seed, DOMAIN.ARRIVAL);
		// Same construction as a system's own direction draw: uniform on the
		// sphere, not uniform in the angles.
		const cosTheta = 2 * rand() - 1;
		const phi = TAU * rand();
		const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
		bearing = {
			x: sinTheta * Math.cos(phi),
			y: sinTheta * Math.sin(phi),
			z: cosTheta,
		};
	}

	const bodies = placeBodies(contents, gameTime);
	const clearanceKm = ARRIVAL_CLEARANCE_AU * AU_KM;
	const clearanceSq = clearanceKm * clearanceKm;

	// Each body's interval, computed once. `perpSq` past the clearance means the
	// ray misses that body's sphere entirely, which is the common case — most of
	// a system is nowhere near any one bearing.
	const intervals: { lo: number; hi: number }[] = [];
	for (const b of bodies) {
		const t = dot(b.pos, bearing);
		const half = clearanceSq - (lengthSq(b.pos) - t * t);
		if (half <= 0) continue;
		const root = Math.sqrt(half);
		intervals.push({ lo: t - root, hi: t + root });
	}

	let d = ARRIVAL_DISTANCE_AU * AU_KM;
	// At most one push per interval, plus one pass to confirm none is left.
	for (let pass = 0; pass <= intervals.length; pass++) {
		let pushed = false;
		for (const { lo, hi } of intervals) {
			if (d > lo && d < hi) {
				d = hi;
				pushed = true;
			}
		}
		if (!pushed) break;
	}
	return { x: bearing.x * d, y: bearing.y * d, z: bearing.z * d };
}
