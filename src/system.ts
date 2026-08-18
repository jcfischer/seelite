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
 * **Systems are multi-destination.** 1–3 typed stations, and the types are not
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
 */

import { DOMAIN, type SystemRecord, stream } from "./galaxy";
import type { Vec3 } from "./sim";
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
	radiusKm: number;
	/** Around its planet. */
	orbit: Orbit;
}

export interface Planet {
	id: string;
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

export type StationType = "trade" | "refinery" | "shipyard";

export interface Station {
	id: string;
	type: StationType;
	/** The planet it orbits, or `null` for a star-centric orbit (the refinery,
	 *  which sits in the belt). */
	parentId: string | null;
	orbit: Orbit;
}

export interface SystemContents {
	star: StarClassDef & { id: string };
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
	kind: "star" | "planet" | "moon" | "station";
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

const pickWeighted = (rand: () => number): StarClassDef => {
	const total = STAR_CLASSES.reduce((sum, c) => sum + c.weight, 0);
	let u = rand() * total;
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
	const star = { id: "star", ...pickWeighted(bodies) };

	// The habitable distance (§6.1): √(L/L☉) AU, clamped into the envelope. An M
	// dwarf's 0.2 AU is pulled out to 0.3; an A star's 4.5 sits inside 6.
	const habitableAu = Math.min(
		MAX_ORBIT_AU,
		Math.max(MIN_ORBIT_AU, Math.sqrt(star.luminosity)),
	);

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
		const moonCount = Math.floor(bodies() * 4);
		const moonRolls = Array.from({ length: 3 }, () => [
			bodies(),
			bodies(),
			bodies(),
			bodies(),
		]);
		if (aAu < MIN_ORBIT_AU || aAu > MAX_ORBIT_AU) continue;

		const isGasGiant = aAu > 2 * habitableAu;
		// Scenery, not spec — see the module docstring.
		const radiusKm = isGasGiant
			? 25000 + radiusRoll * 50000
			: 2400 + radiusRoll * 5600;
		const id = `planet-${i}`;
		const moons: Moon[] = [];
		if (isGasGiant) {
			for (let m = 0; m < moonCount; m++) {
				const [rRoll, oRoll, pRoll, tRoll] = moonRolls[m] ?? moonRolls[0];
				moons.push({
					id: `${id}-moon-${m}`,
					radiusKm: 800 + rRoll * 1700,
					orbit: {
						radiusKm: radiusKm + 5e4 + oRoll * 3.5e5,
						periodS: (0.5 + pRoll * 14.5) * 86400,
						theta0: tRoll * TAU,
						inclination,
						node,
					},
				});
			}
		}
		planets.push({
			id,
			aAu,
			radiusKm,
			isGasGiant,
			isPrimary,
			orbit: {
				radiusKm: aAu * AU_KM,
				periodS: orbitalPeriodS(aAu, star.massSolar),
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
 * 1–3 stations, typed (spec §6.4).
 *
 * The count keys off population and tech exactly as intended: a high-TL core
 * world plausibly supports three, a rim Anarchy one. The trade station is
 * unconditional, so a system always has somewhere to dock — a system with no
 * station would be a dead end the galaxy map has no way to warn about.
 */
function generateStations(
	record: SystemRecord,
	star: StarClassDef,
	planets: readonly Planet[],
	belt: Belt | null,
): Station[] {
	const rand = stream(record.seed, DOMAIN.STATIONS);
	const stations: Station[] = [];
	const primary = planets.find((p) => p.isPrimary) ?? planets[0];

	/** Station orbits are low and fast (§7.3): a few hundred to a couple of
	 *  thousand km up, 90–240 minutes round. Spin, which docking has to match,
	 *  belongs to #9. */
	const aroundBody = (body: Planet): Orbit => ({
		radiusKm: body.radiusKm + uniform(rand, 400, 2000),
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
			kind: "planet",
			pos,
			radiusKm: planet.radiusKm,
		});
		for (const moon of planet.moons) {
			const rel = positionOnOrbit(moon.orbit, gameTime);
			placed.push({
				id: moon.id,
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
			kind: "station",
			pos: base
				? { x: base.x + rel.x, y: base.y + rel.y, z: base.z + rel.z }
				: rel,
			// Scenery: a station is a near-layer object and its real geometry is
			// #9's business. This is only the figure the clearance check reads.
			radiusKm: 1.2,
		});
	}
	return placed;
}

const norm = (v: Vec3): Vec3 => {
	const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
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
 * The clearance walk is the spec's "push it outward until it is clear", made
 * finite: it steps rather than solving, because a body can be anywhere along the
 * ray and the ray is cheap to walk.
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
		const rand = stream(record.seed, DOMAIN.POS);
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
	const stepKm = 0.05 * AU_KM;
	// Bounded by the orbit envelope plus the clearance: past that there is
	// nothing left to be near.
	const maxKm = (MAX_ORBIT_AU + 2 * ARRIVAL_CLEARANCE_AU) * AU_KM;
	for (let d = ARRIVAL_DISTANCE_AU * AU_KM; d <= maxKm; d += stepKm) {
		const p = { x: bearing.x * d, y: bearing.y * d, z: bearing.z * d };
		const tooClose = bodies.some((b) => {
			const dx = b.pos.x - p.x;
			const dy = b.pos.y - p.y;
			const dz = b.pos.z - p.z;
			return Math.sqrt(dx * dx + dy * dy + dz * dz) < clearanceKm;
		});
		if (!tooClose) return p;
	}
	// Unreachable while the envelope holds: the last candidate is more than a
	// clearance beyond the outermost possible body. Returned rather than thrown
	// so a jump can never strand the player on an arithmetic edge case.
	return { x: bearing.x * maxKm, y: bearing.y * maxKm, z: bearing.z * maxKm };
}
