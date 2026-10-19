/**
 * Node #53's prototype dogfight controller.
 *
 * The first build of this file flew a standoff orbit and was rejected on sight:
 * it crabbed sideways around the player, never pointed its nose at anything,
 * and repeated the same path in every fight. Three separate causes, and all
 * three are worth naming here because each of them is an easy mistake to make
 * again.
 *
 * 1. **The orbit plane was nailed to world horizontal.** Every lateral term
 *    came from `cross(towardPlayer, worldUp)`, which is by construction
 *    perpendicular to the world's y axis. A ship built on that vector cannot
 *    manoeuvre out of the horizontal plane no matter what else the controller
 *    decides. Here the manoeuvre direction is drawn over the *whole* circle
 *    perpendicular to the sight line — `randomPerp` — so up and down are as
 *    available as left and right.
 *
 * 2. **The commanded nose was the orbit tangent.** Being at a fighting range
 *    is not attacking; pointing is. Every offensive phase in this file
 *    commands `pursuitNose`, a lead-collision solution against the player's
 *    *predicted* position, and the guns are gated on a twelve-degree cone so
 *    that firing and pointing cannot come apart again.
 *
 * 3. **The path was four fixed-frequency sines.** A closed-form path is a
 *    canned path: the player learns it in one fight. Manoeuvre choice here is
 *    a state machine over the real geometry — range, closure, and whether the
 *    player's sight line is on the ship — and every manoeuvre's duration and
 *    direction is a draw from the fight's own seeded stream.
 *
 * What it still is not: a production combat entity. It owns no world state, no
 * renderer transform, and no scheduled damage. It moves through `stepFlight`,
 * the same assisted integrator the player flies, so its ship obeys the same
 * thrust, speed cap and lateral-damping rules — the nose can lead the velocity
 * vector, and at these turn rates it visibly does. Since #324 it also turns
 * through the player's `stepAngular`, with its hull's rate limits and angular
 * acceleration, and its assist holds speed in the frame the caller passes, the
 * player's local frame in a production duel.
 */

import { HULL_SPECS, type HullId } from "./hull";
import { PLAYER_LASER_RANGE_KM } from "./laser";
import { mix, seedFor } from "./rng";
import {
	ASSIST_CAP_KMS,
	type Angular,
	type AvoidSphere,
	flightPerformance,
	type FlightPerformance,
	type FrameMotion,
	bodySpin,
	stepHull,
	type Ship,
	speedDemand,
	type VentLevels,
} from "./sim";
import {
	add,
	cross,
	dot,
	length,
	lengthSq,
	rotateAbout,
	scale,
	sub,
	type Vec3,
	v3,
} from "./vec3";

export type EnemyFlightPhase =
	/** Closing from spawn range, nose on the lead point, guns cold. */
	| "acquire"
	/** In the envelope: lead pursuit, throttle held off the overshoot, firing. */
	| "attack"
	/** The merge is past or too close: a hard turn out of the sight line. */
	| "break"
	/** Running out to rebuild the separation an attack run needs. */
	| "extend"
	/** The player's sights are on the ship: a rolling out-of-plane spiral. */
	| "evade"
	/** Hull critical: leave. */
	| "flee";

export interface CombatEnemyState {
	ship: Ship;
	nose: Vec3;
	/**
	 * The ship's roll reference, which banks into the turn.
	 *
	 * It is state rather than a renderer convenience because the renderer used
	 * to build the attitude from a fixed world up, and a fixed world up gives
	 * a ship that yaws flat through every turn and goes degenerate the moment
	 * the nose approaches vertical — which this controller now does routinely.
	 */
	up: Vec3;
	/**
	 * The body rates, rad/s, as `stepAngular` carries the player's (#324): pitch
	 * about the right axis, yaw about `up`, roll about `nose`. State, because a
	 * turn has momentum — the nose used to reach its turn rate in one frame.
	 */
	rates: Angular;
	/**
	 * The vents this ship fired on its last step: the `HullStep`'s firing table,
	 * kept for the renderer's plumes (node #637) as the player's is (#621).
	 * Empty before the first step. Output, never read back by the controller.
	 */
	firing: VentLevels;
	phase: EnemyFlightPhase;
	phaseSeconds: number;
	/** How long the current manoeuvre holds before the machine may re-decide.
	 *  Drawn, not constant: two breaks in one fight last different times. */
	maneuverSeconds: number;
	/** The direction, perpendicular to the sight line, this manoeuvre pulls
	 *  toward. Drawn over the full circle, which is what makes the fight three
	 *  dimensional rather than a horizontal carousel. */
	pullAxis: Vec3;
	/**
	 * Seconds before being *tracked* may call off an attack again.
	 *
	 * A pilot's sight line is on the target more or less permanently, so without
	 * a lockout the tail rule fires every time a manoeuvre puts the nose off the
	 * player and the striker spends the fight breaking instead of shooting.
	 * Measured against a player who tracks it for 45 s, over eight seeds: the
	 * share of frames it is firing is **0.294–0.305** with the lockout and
	 * **0.154–0.230** without. It does **not** measurably change how far the
	 * fight ranges out — that was checked and it is the same ~8–10 km either
	 * way. Both arms re-measured on the rebase onto #181, which gave the striker
	 * the raider's own 2.690 km/s² in place of the courier's 2.000.
	 *
	 * Being *hit* runs the same lockout on a shorter clock — see
	 * `HIT_EVADE_COOLDOWN_S`, and the flown result that put it there. It did
	 * once ignore this entirely, on the argument that a player holding the sight
	 * had earned the suppression; that produced a striker which never fired
	 * back at all.
	 */
	evadeCooldown: number;
	/** The fight's own RNG stream, carried as state so the step stays pure. */
	seed: number;
	draws: number;
}

export interface EnemyFlightStep {
	state: CombatEnemyState;
	targetInCone: boolean;
	laserEndpointKm: number;
	enemyFiring: boolean;
	enemyHitAft: boolean;
	/** The solid this step's heading was bent round (node #665), or `null`. */
	avoiding: string | null;
}

/** Nose onto the player and start the run from here. */
const ENGAGE_KM = 9;
/** The enemy's own pulse reach. Well inside the player's, so the fight has to
 *  be pressed rather than sniped. */
export const GUN_RANGE_KM = 6;
/** Past this the run has failed and becomes an approach again. */
const DISENGAGE_KM = 14;
/** The merge. Inside this the attacker breaks rather than flying through the
 *  player, which is the manoeuvre the previous build's five-kilometre floor
 *  existed to avoid having to write. */
export const MERGE_BREAK_KM = 1.8;
/** An extension ends here, whether or not its clock has run out. */
const EXTEND_TARGET_KM = 5;
export const FLEE_HULL_FRACTION = 0.2;
/** Twelve degrees. Firing is gated on pointing, and the attack weave below
 *  stays inside it so a weaving gun run still shoots. */
export const FIRE_COS = Math.cos((12 * Math.PI) / 180);
/** The weave's weight against a unit boresight, so `atan(0.1)` ≈ 5.7° of nose
 *  offset: enough that a gun run is not a rail, half the firing cone. */
const ATTACK_WEAVE = 0.1;
/** Lead is capped: a long extrapolation against a manoeuvring player aims at
 *  a place nobody is going. */
const LEAD_CAP_S = 5;
const EVADE_SPIRAL_RAD_S = 2.6;
/** How long a tracked-into-evade locks out the next one. */
const EVADE_COOLDOWN_S = 7;
/**
 * The same lockout for being *hit*, and shorter.
 *
 * Being hit used to ignore the lockout entirely — "a player who can hold the
 * sight on it has earned the suppression". Flown, that is not suppression, it
 * is a stalemate: measured against a pilot tracking the striker and holding the
 * trigger for thirty seconds, it fired **zero** shots back and its closest
 * approach was 5.68 km, sitting just outside its own six-kilometre gun range
 * for the whole engagement. A break is a reaction to a hit; refusing to come
 * back is not.
 */
const HIT_EVADE_COOLDOWN_S = 3.5;
/** How near the player's sight line counts as being tracked. Measured as a
 *  miss distance rather than an angle, so it means the same thing at two
 *  kilometres as at ten. */
const THREAT_MISS_KM = 1.2;
/** The ship does not read the player's mind: a tail earns a reaction only
 *  after this long in the current manoeuvre. It is the window before the
 *  *first* break and not the whole of a fight's shooting: once the striker has
 *  evaded, `EVADE_COOLDOWN_S` owes the player seven seconds before a tail may
 *  provoke it again. */
const THREAT_REACTION_S = 0.45;
/** Above this the ship is nosed at the player and the pass is a mutual merge,
 *  not a tail. A merge is jousted, not evaded — an earlier cut of this rule
 *  evaded on *any* tracking, which meant the player pointing at the target was
 *  enough to call off the attack, and the target never attacked at all. */
const MERGE_ASPECT_COS = 0.3;

/**
 * How large the prototype draws the raider it borrows from the hull roster.
 *
 * It lives here rather than in the renderer because the hit sphere below is
 * derived from it, and a scale in one file with a radius in another is two
 * numbers that have to agree and nothing that makes them.
 */
export const ENEMY_VISUAL_SCALE = 3;

/**
 * Which hull the striker is, and therefore how it flies and how big it is.
 *
 * Both answers are read off #181's roster rather than restated here: the hit
 * sphere below comes from `env.lengthKm`, and `STRIKER_PERFORMANCE` from the
 * mass and thrust beside it. `hull.ts` imports nothing, so a module the sim
 * tier owns may read it — which is the whole reason that leaf exists, and the
 * reason the length below is no longer a copied literal.
 */
export const STRIKER_HULL_ID: HullId = "raider";

/**
 * The striker's hit sphere: **the drawn hull's half-length**, not a sphere that
 * contains it.
 *
 * `HULL_SPECS.raider.env.lengthKm` is the measured box of the built `raider/a`
 * mesh (0.0635 km), drawn at `ENEMY_VISUAL_SCALE`, so half of that is the
 * radius here: 0.09525 km. It was 0.28 — nearly three drawn ship lengths —
 * which meant the beam scored on shots that visibly missed, and the one skill
 * #53 is trying to make matter is keeping a sight on a moving ship.
 *
 * **It does not contain the hull, and the honest version says so.** `raider/a`
 * runs -0.0345 to +0.0290 about its own origin, so drawn it reaches 0.1035 km
 * forward — 8 m of nose outside this sphere — and the far box corner is at
 * 0.117 km. A sphere large enough to contain the box would be 0.117 km, and
 * **90 % of it would be empty**: 0.0067 km³ of sphere around a drawn box of
 * 0.1905 x 0.1032 x 0.0327 = 0.00064 km³, beside a hull five times longer than
 * it is tall. The half-length is the figure a fixed forward gun
 * wants: generous down the axis you are aiming along, tight across it.
 *
 * The figure moved by 3.6 % under #181, which replaced a *declared* 0.066 with
 * the mesh's own box; the point of reading it rather than copying it is that
 * the next such move costs nothing. `tests/ship-mesh.test.ts` measures this
 * against the rebuilt mesh, which is the check a derivation cannot make.
 */
export const ENEMY_COLLISION_RADIUS_KM =
	(HULL_SPECS[STRIKER_HULL_ID].env.lengthKm / 2) * ENEMY_VISUAL_SCALE;

/**
 * The striker's handling, the raider's own (#181).
 *
 * `stepFlight` takes a `FlightPerformance` and refuses a default, so a
 * controller that forgot to name a hull cannot silently fly the courier. The
 * striker is an outlaw hull: 113 MN over 42 t is **2.690 km/s²** against the
 * courier's 2.000, so it reaches the shared 2 km/s assist cap in 0.74 s against
 * the courier's 1.00 — three-quarters of the time, not a third. The cap is not per hull (see
 * `FlightPerformance`), so this changes how quickly the fight closes and not
 * how fast either ship can run.
 */
const STRIKER_PERFORMANCE: FlightPerformance =
	flightPerformance(STRIKER_HULL_ID);

/** The fight seed a caller gets if it does not choose one. */
export const DEFAULT_ENEMY_SEED = seedFor(0, "combat");

/** A finite fixed-forward beam against the prototype enemy's sim-space hull. */
export function playerLaserHit(
	playerPos: Vec3,
	playerNose: Vec3,
	enemyPos: Vec3,
	/** The rig's drawn-3x radius by default; production combat passes the
	 *  hull's true one, so the raider is no larger to hit than it is (#324). */
	radiusKm: number = ENEMY_COLLISION_RADIUS_KM,
): { hit: boolean; distanceKm: number } {
	const toEnemy = sub(enemyPos, playerPos);
	const along = dot(toEnemy, playerNose);
	if (along < 0 || along > PLAYER_LASER_RANGE_KM)
		return { hit: false, distanceKm: PLAYER_LASER_RANGE_KM };
	const perpendicular = sub(toEnemy, scale(playerNose, along));
	const radiusSq = radiusKm ** 2;
	const perpendicularSq = lengthSq(perpendicular);
	if (perpendicularSq > radiusSq)
		return { hit: false, distanceKm: PLAYER_LASER_RANGE_KM };
	return {
		hit: true,
		distanceKm: along - Math.sqrt(radiusSq - perpendicularSq),
	};
}

const unit = (v: Vec3, fallback: Vec3) => {
	const magnitude = length(v);
	return magnitude === 0 ? fallback : scale(v, 1 / magnitude);
};

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

/**
 * One draw from a fight's stream, indexed rather than sequential.
 *
 * `mix` is the repo's existing avalanche, so this adds no second generator —
 * and indexing by a counter carried in the state keeps `stepCombatEnemy` a
 * pure function of its arguments, which is what lets a test replay a fight.
 */
const drawUnit = (seed: number, index: number) =>
	mix(seed, index) / 0x1_0000_0000;

/** Two unit vectors spanning the plane perpendicular to `dir`. */
function perpBasis(dir: Vec3): [Vec3, Vec3] {
	// The reference only has to be non-parallel; switching it near the pole is
	// what stops the cross product collapsing.
	const reference = Math.abs(dir.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0);
	const a = unit(cross(dir, reference), v3(1, 0, 0));
	return [a, cross(dir, a)];
}

/** A unit vector perpendicular to `dir` at roll angle `angle`. */
function perpAt(dir: Vec3, angle: number): Vec3 {
	const [a, b] = perpBasis(dir);
	return add(scale(a, Math.cos(angle)), scale(b, Math.sin(angle)));
}

/** Re-seat a stored direction into the plane perpendicular to `dir`, which the
 *  fight's own motion keeps moving out from under it. */
const reperp = (v: Vec3, dir: Vec3): Vec3 =>
	unit(sub(v, scale(dir, dot(v, dir))), perpBasis(dir)[0]);

/** Rates at rest: a new ship's, and the controller's mouse impulse, since it
 *  commands the stick alone. Frozen, so sharing one object is safe. */
export const NO_ROTATION: Angular = Object.freeze({
	pitch: 0,
	yaw: 0,
	roll: 0,
});

/** Closer than this the nose is on its heading and the stick is released, so
 *  the assist's damping finishes the stop rather than the command hunting. */
const SETTLED_RAD = 1e-3;
/** Below this turn rate the ship is not banking into anything. */
const TURNING_RAD_S = 0.05;

/**
 * A stick deflection, 0…1, for an error of `errorRad` on axes of rate `max`:
 * the fastest rate that can still stop at the heading under `accel`, which is
 * what brings a turn in without overshooting it.
 */
const stoppingStick = (errorRad: number, accel: number, max: number) =>
	Math.min(1, Math.sqrt(2 * accel * errorRad) / max);

/**
 * The stick that turns the ship toward `desired` (#324): the raider's pilot.
 *
 * The controller decides a heading and a bank; this turns them into a stick,
 * and the Hull step turns the hull by it — the rates, the limits and the
 * angular acceleration are the hull's, by the same step the player's ship
 * turns through (#646). Pitch and yaw take the shortest arc to the heading in
 * the body's own axes. Roll lays the up axis into the turn, which is the bank
 * the old slew drew. `STRIKER_PERFORMANCE`'s pitch and yaw limits are one
 * figure (`flightPerformance` scales both by one agility), so one stick scale
 * keeps the arc's direction.
 */
function aimStick(
	state: CombatEnemyState,
	desired: Vec3,
	perf: FlightPerformance,
): Angular {
	const { nose, up } = state;
	const right = cross(nose, up);
	const off = Math.acos(clamp(dot(nose, desired), -1, 1));
	let pitch = 0;
	let yaw = 0;
	if (off > SETTLED_RAD) {
		// Half a turn away the arc's axis vanishes and any perpendicular will do.
		const arc = unit(cross(nose, desired), perpBasis(nose)[0]);
		const stick = stoppingStick(off, perf.angularAccel, perf.angularMax.yaw);
		pitch = dot(arc, right) * stick;
		yaw = dot(arc, up) * stick;
	}
	// The way the nose is swinging now, and the up axis rolled toward it. Roll
	// spins about the nose and swings nothing, so it drops out of the cross.
	const swing = cross(bodySpin(state, state.rates), nose);
	let roll = 0;
	if (length(swing) > TURNING_RAD_S) {
		const inside = unit(swing, up);
		const bank = Math.atan2(dot(cross(up, inside), nose), dot(up, inside));
		// `bank` is a turn about the nose and a roll rate turns about aft
		// (`bodySpin`), so the stick is the bank's negative.
		if (Math.abs(bank) > SETTLED_RAD)
			roll =
				-Math.sign(bank) *
				stoppingStick(Math.abs(bank), perf.angularAccel, perf.angularMax.roll);
	}
	return { pitch, yaw, roll };
}

/**
 * What a controller keeps between its centre and a solid's bounding sphere
 * (node #665): **absolute, never a fraction of the solid** — the #30
 * Constraint names an NPC's avoidance, and a shell proportional to a gas
 * giant would swallow the station a duel is fought beside, which orbits at
 * no less than 1.5 host radii. It covers the largest flown hull's own reach
 * from its centre, so a centre outside the keep-out is a hull outside the
 * solid, with metres to spare (`tests/combat-enemy-avoidance.test.ts`). The
 * largest station keep-out it makes, the Gantry's 1.66 km keel plus this, is
 * well inside `GUN_RANGE_KM`, so a raider held off a station still has a gun
 * run on a pilot beside it.
 */
export const AVOID_CLEARANCE_KM = 0.5;

/**
 * How far ahead, in seconds, a controller reads a solid at closing speed
 * `closingKms` (node #665): twice the time its hull needs to turn a quarter
 * turn, take that closing speed off, and let the assist's lateral damping
 * settle. The speed it can take off is bounded: the assist holds speed in
 * the fight's frame, so nothing past twice the cap comes off relative to a
 * solid, and past that the way out is sideways and the horizon stops
 * growing. Read off the hull's own figures, so a freighter looks further
 * ahead than a raider — it needs to, at 0.45 rad/s against 1.1 — and a
 * threat beyond it leaves the heading alone, which is what keeps a duel
 * from becoming a dance around every body in the system.
 */
export function avoidanceHorizonS(
	perf: FlightPerformance,
	closingKms: number,
): number {
	return (
		2 *
		(Math.PI / 2 / perf.angularMax.yaw +
			clamp(closingKms, 0, 2 * ASSIST_CAP_KMS) / perf.thrustKms2 +
			perf.assistLateralTauS)
	);
}

/** Seconds until a point moving at `w` from the origin enters the sphere of
 *  radius `keep` at `r`, or `Infinity` if it never does. Starts outside. */
function entryS(r: Vec3, w: Vec3, keep: number): number {
	const speedSq = lengthSq(w);
	if (speedSq === 0) return Number.POSITIVE_INFINITY;
	const along = dot(r, w) / Math.sqrt(speedSq);
	if (along <= 0) return Number.POSITIVE_INFINITY;
	const missSq = lengthSq(r) - along * along;
	const keepSq = keep * keep;
	if (missSq >= keepSq) return Number.POSITIVE_INFINITY;
	return (along - Math.sqrt(keepSq - missSq)) / Math.sqrt(speedSq);
}

/** The step a deflection is searched in, and the margin it clears a cone by. */
const AVOID_STEP_RAD = (2 * Math.PI) / 180;
/** Inside the keep-out the heading must point this far past tangent, so the
 *  ship climbs out rather than skimming round at the depth it reached. */
const AVOID_OUTWARD_RAD = Math.PI / 6;
/** A run counts as at the target while the heading is within 30° of it, which
 *  the attack weave's 5.7° never leaves. */
const HOLD_OFF_AIM_COS = Math.cos(Math.PI / 6);

export interface Avoidance {
	desired: Vec3;
	/** Use lateral assist toward `desired` when no forward heading clears a
	 * fast solid; turning alone lets braking in the fight's frame win. */
	strafe: boolean;
	/**
	 * The most speed the assist may hold, km/s: `Infinity` when untouched, 0
	 * while the nose itself is still on the solid, and a figure the ship can
	 * stop from before the keep-out while it holds off a target inside it.
	 */
	maxSpeedKms: number;
	/** The solid the step was changed for — its heading bent or its speed
	 *  capped — or `null` when it was left alone. */
	avoiding: string | null;
}

/** The solid `avoidSolids` answers, and what it read of it. */
interface Threat {
	solid: AvoidSphere;
	/** The solid's centre from the ship. */
	r: Vec3;
	dist: number;
	/** The keep-out's radius: the solid's, plus `AVOID_CLEARANCE_KM`. */
	keep: number;
	/** The horizon it was read at; 0 from inside the keep-out. */
	horizon: number;
	/** The bearing to the solid. */
	toward: Vec3;
	/** The ship's present velocity relative to the solid. */
	present: Vec3;
	inside: boolean;
	/** A heading clears when its path's closing cosine is at most this. */
	cosLimit: number;
	/** Seconds until the earlier of the two paths enters the keep-out. */
	entry: number;
}

/**
 * The earliest threat among `solids` (node #665): the solid whose keep-out
 * the present path or the intended one — `frame + desired · speed` — enters
 * soonest inside the hull's horizon, both relative to the solid (#362), or
 * `null` if none does. The ship inside a keep-out is a threat at entry 0.
 */
function mostUrgentThreat(
	ship: Ship,
	desired: Vec3,
	speedKms: number,
	frameVel: Vec3,
	solids: readonly AvoidSphere[],
	perf: FlightPerformance,
): Threat | null {
	const intendedFor = (heading: Vec3, solid: AvoidSphere) =>
		sub(add(frameVel, scale(heading, speedKms)), solid.vel);
	let worst: Threat | null = null;
	for (const solid of solids) {
		const r = sub(solid.pos, ship.pos);
		const dist = length(r);
		const keep = solid.radiusKm + AVOID_CLEARANCE_KM;
		const toward = unit(r, scale(desired, -1));
		const present = sub(ship.vel, solid.vel);
		let entry: number;
		let halfAngle: number;
		let horizon = 0;
		if (dist <= keep) {
			entry = 0;
			halfAngle = Math.PI / 2 + AVOID_OUTWARD_RAD;
		} else {
			const intended = intendedFor(desired, solid);
			const closing = Math.max(dot(present, toward), dot(intended, toward));
			horizon = avoidanceHorizonS(perf, closing);
			const presentEntry = entryS(r, present, keep);
			entry = Math.min(presentEntry, entryS(r, intended, keep));
			if (entry > horizon) continue;
			const cone = Math.asin(keep / dist);
			// The velocity lags the nose by the assist's lateral settling, so
			// a heading on the cone's edge leaves a present path inside it to
			// curve in along the edge as the cone widens. Aim as far past the
			// edge as the present path is inside it, and the velocity crosses
			// the edge on its way there.
			const presentSpeed = length(present);
			const presentAngle =
				presentSpeed === 0
					? Math.PI
					: Math.acos(clamp(dot(present, toward) / presentSpeed, -1, 1));
			halfAngle = Math.min(
				Math.PI - AVOID_STEP_RAD,
				cone + Math.max(0, cone - presentAngle),
			);
		}
		if (worst && entry >= worst.entry) continue;
		worst = {
			solid,
			r,
			dist,
			keep,
			horizon,
			toward,
			present,
			inside: entry === 0,
			cosLimit: Math.cos(halfAngle + AVOID_STEP_RAD),
			entry,
		};
	}
	return worst;
}

/**
 * Bend a controller's heading round the most urgent solid on its path
 * (node #665, `collision.md` §6 item 2). The ship is collidable on the same
 * rules as the player (`combat-model.md` §1), so the avoidance is the
 * controller's, and the step it returns is still flown through the Hull step.
 *
 * **Predicted in the solid's frame (#362).** Two paths are read against each
 * solid, both as velocities relative to it: the one the ship is on, and the
 * one its assist is about to put it on — `frame + desired · speed`, since the
 * assist holds speed in the fight's frame. Beside a station that frame moves
 * ~30 km/s, and so does the station; only the difference is a path.
 *
 * A threat is a path entering the keep-out inside `avoidanceHorizonS`, and
 * only the earliest one is answered, in one of three ways:
 *
 * - **Held off**, when the ship is running at a target inside the keep-out —
 *   a pilot at the station's mouth — and the solid is at rest in the frame:
 *   the heading is kept and the speed capped at what the ship can stop from
 *   before the keep-out.
 * - **Gone round** otherwise: the heading nearest the bearing, on the side
 *   the ship leans and slides to, whose intended path clears the cone the
 *   keep-out subtends — and as far again past the cone's edge as the present
 *   path is inside it, because the velocity lags the nose. It is built in
 *   the plane of the bearing and that side, so a bent heading keeps none of
 *   the desired heading out of that plane. From inside the keep-out the
 *   cone is past tangent, and the ship climbs out. A solid no heading can
 *   clear — one closing faster than the hull can leave its path — gets the
 *   heading that closes least, with lateral assist toward it while turning.
 * - **Braked**, while going round, as long as thrust along the nose as it
 *   stands would close on the solid: speed 0 until the nose is round.
 *
 * So a raider whose run on the pilot clips a station skims it by the cone
 * and keeps its run, and nothing farther than the horizon moves the nose.
 *
 * Pure, and it draws nothing from the fight's stream, so a fight in open
 * space flies bit-identically with or without the solids beside it.
 */
export function avoidSolids(
	ship: Ship,
	nose: Vec3,
	desired: Vec3,
	speedKms: number,
	frameVel: Vec3,
	solids: readonly AvoidSphere[],
	perf: FlightPerformance,
	/** Where the ship is fighting toward: the pilot. */
	target: Vec3,
): Avoidance {
	const intendedFor = (heading: Vec3, solid: AvoidSphere) =>
		sub(add(frameVel, scale(heading, speedKms)), solid.vel);
	const worst = mostUrgentThreat(
		ship,
		desired,
		speedKms,
		frameVel,
		solids,
		perf,
	);
	if (!worst)
		return {
			desired,
			strafe: false,
			maxSpeedKms: Number.POSITIVE_INFINITY,
			avoiding: null,
		};

	const { solid, r, dist, keep, horizon, toward, present, inside, cosLimit } =
		worst;
	/** How directly the intended path closes on the solid, -1…1. No motion
	 *  relative to it is no path into it — unless the ship is already inside,
	 *  where standing still is staying there. */
	const closingCos = (heading: Vec3) => {
		const intended = intendedFor(heading, solid);
		const speed = length(intended);
		if (speed === 0) return inside ? 1 : -1;
		return dot(intended, toward) / speed;
	};
	// **A target inside the keep-out is held off, not gone round.** A pilot at
	// a station's mouth is inside its keep-out, so every run on them enters
	// it and no turn clears it; bent round, the raider kept off and all but
	// stopped firing. So while the ship is running at a target inside the
	// keep-out, the nose stays on the run and the speed is held to what the
	// assist can stop from, at half its retro, before the keep-out — which it
	// can only do where the solid is at rest in the frame, as a station is in
	// its own. The merge break takes the ship off the pilot from there.
	const toTarget = unit(sub(target, ship.pos), desired);
	if (
		!inside &&
		length(sub(target, solid.pos)) < keep &&
		dot(desired, toTarget) > HOLD_OFF_AIM_COS &&
		entryS(r, sub(frameVel, solid.vel), keep) > horizon
	) {
		const radial = dot(desired, toward);
		const stoppable = Math.sqrt(perf.retroKms2 * Math.max(0, dist - keep));
		return {
			desired,
			strafe: false,
			maxSpeedKms: radial > 0 ? stoppable / radial : Number.POSITIVE_INFINITY,
			avoiding: solid.id,
		};
	}
	// **The assist thrusts along the nose, not along the heading it is
	// turning to.** A ship whose nose is still on the solid while it turns
	// away is driven at it the whole turn, which is how a break begun nosed
	// at a station flew into it with a clear heading. So while thrust along
	// the nose as it stands would close on the solid, the throttle is cut and
	// the assist brakes in the frame until the nose is clear.
	const maxSpeedKms =
		dot(nose, toward) > 0 && closingCos(nose) > cosLimit
			? 0
			: Number.POSITIVE_INFINITY;
	if (closingCos(desired) <= cosLimit)
		return {
			desired,
			strafe: false,
			maxSpeedKms,
			avoiding: maxSpeedKms === 0 ? solid.id : null,
		};
	// Which side to pass on: the side the heading leans to, and the side the
	// ship is already sliding to, each weighed by the sine of its angle off
	// the bearing. The slide is what holds the choice: a heading nearly on
	// the bearing leans by the attack weave alone, which turns, and a side
	// read off it alone turned with it and never let the velocity commit.
	// Head-on and at rest any side will do; the basis is the same every frame.
	const lean = (v: Vec3, norm: number) =>
		norm === 0 ? v3() : scale(sub(v, scale(toward, dot(v, toward))), 1 / norm);
	const side = unit(
		add(lean(desired, 1), lean(present, length(present))),
		perpBasis(toward)[0],
	);
	// The edge of what clears, on that side, nearest the bearing: the least
	// the heading can be bent and still pass.
	let best = desired;
	let bestCos = closingCos(desired);
	for (let angle = AVOID_STEP_RAD; angle <= Math.PI; angle += AVOID_STEP_RAD) {
		const heading = add(
			scale(toward, Math.cos(angle)),
			scale(side, Math.sin(angle)),
		);
		const cos = closingCos(heading);
		if (cos <= cosLimit)
			return {
				desired: heading,
				strafe: false,
				maxSpeedKms,
				avoiding: solid.id,
			};
		if (cos < bestCos) {
			best = heading;
			bestCos = cos;
		}
	}
	// A solid closing faster than the hull can move off its path — a station
	// overtaking a ship held in another frame: the heading that closes least,
	// which is across its path rather than along it. Ask the lateral assist
	// for that direction now: braking toward the fight's frame while waiting
	// for the nose to turn can drag a co-moving ship into the solid first.
	return { desired: best, strafe: true, maxSpeedKms, avoiding: solid.id };
}

/**
 * Spawn nosed at the player, beyond the player's beam, at a drawn bearing.
 *
 * The bearing and the range are draws rather than the previous build's fixed
 * `(3, 1.2, 0)` offset: an enemy that always appears in the same place is
 * already half-solved before it moves.
 */
export function createCombatEnemy(
	player: Ship,
	playerNose: Vec3,
	seed: number = DEFAULT_ENEMY_SEED,
): CombatEnemyState {
	const forward = unit(playerNose, v3(0, 0, -1));
	const offset = perpAt(forward, drawUnit(seed, 1) * Math.PI * 2);
	const rangeKm = 13 + drawUnit(seed, 2) * 3;
	// The bearing is drawn; the *magnitude* is not free. At thirteen kilometres a
	// four-kilometre offset is seventeen degrees off the boresight, which on this
	// canopy is behind the console — the opening of the fight would be measured
	// off the bottom of the frame. Half a kilometre to one and a half puts it in
	// the clear glass, near the sight, wherever the bearing lands.
	const pos = add(
		player.pos,
		add(scale(forward, rangeKm), scale(offset, 0.5 + drawUnit(seed, 3))),
	);
	const nose = unit(sub(player.pos, pos), scale(forward, -1));
	return {
		ship: { pos, vel: { ...player.vel } },
		nose,
		up: unit(sub(v3(0, 1, 0), scale(nose, nose.y)), perpBasis(nose)[1]),
		rates: NO_ROTATION,
		firing: {},
		phase: "acquire",
		phaseSeconds: 0,
		maneuverSeconds: 30,
		evadeCooldown: 0,
		pullAxis: perpAt(forward, drawUnit(seed, 4) * Math.PI * 2),
		seed,
		draws: 8,
	};
}

/**
 * What the controller reads of the fight's numbers: its own hull, energy and
 * heat lock, and whether the player is still alive.
 *
 * **Named in the rig's words on purpose.** In `combat-prototype.ts` the enemy
 * is the player's *target*, so its pools are `target*`; that state satisfies
 * this shape structurally and the rig passes it unchanged. Production combat
 * (#324) builds one from two `ShipCondition`s. `targetHullMax` is optional so
 * the rig, whose hulls are all 100, keeps its threshold exactly.
 */
export interface EnemyReadout {
	targetHull: number;
	targetHullMax?: number;
	targetEnergy: number;
	targetHeatLocked: boolean;
	playerHull: number;
}

/**
 * Choose an intent from the geometry, then fly it through the player's own
 * integrator. It never writes a renderer transform or a scheduled damage value.
 *
 * The striker: the raider's hull and the attacker's intent. A ship of any other
 * hull goes through `stepEnemyShip`, which takes both and defaults neither.
 */
export function stepCombatEnemy(
	state: CombatEnemyState,
	player: Ship,
	playerNose: Vec3,
	combat: EnemyReadout,
	playerFiring: boolean,
	dt: number,
	laserOrigin: Vec3 = player.pos,
	laserNose: Vec3 = playerNose,
	hitRadiusKm: number = ENEMY_COLLISION_RADIUS_KM,
	/** The frame the assist holds across this step — the player's local frame
	 *  (#324), so both ships' 2 km/s cap is the same speed. The star's frame
	 *  when omitted, as `stepFlight`'s is. */
	frame?: FrameMotion,
): EnemyFlightStep {
	return stepEnemyShip(state, player, playerNose, combat, playerFiring, dt, {
		laserOrigin,
		laserNose,
		hitRadiusKm,
		frame,
		performance: STRIKER_PERFORMANCE,
		intent: "attacker",
		// The rig fights in empty space, and has no world to read solids from.
		solids: [],
	});
}

/**
 * What a ship does with a fight (`civilian-combat.md` H3). An **attacker** is
 * #53's machine: it closes, runs, breaks and extends, and flees only when its
 * hull is critical. A **civilian** never closes and never fires: it spirals
 * out of the sight line while it is being hit and runs the rest of the time.
 * Choosing an intent is not a handling advantage (`combat-model.md` §1): both
 * fly the same integrator on their own hull's figures.
 */
export type EnemyIntent = "attacker" | "civilian";

export interface EnemyShipOptions {
	laserOrigin: Vec3;
	laserNose: Vec3;
	hitRadiusKm: number;
	/** The fight's frame across this step, which both ships share — its
	 *  acceleration as well as its velocity (#529), or beside a station over a
	 *  gas giant the raider drifts off the player at the station's. */
	frame: FrameMotion | undefined;
	/** **Required**, for `FlightPerformance`'s reason: a caller that forgot to
	 *  name a hull would silently fly a freighter as a raider. */
	performance: FlightPerformance;
	intent: EnemyIntent;
	/**
	 * The solids beside the fight this step (`avoidanceSolids`), which the
	 * controller steers clear of (node #665). **Required**, for
	 * `performance`'s reason: a caller that forgot it would fly the ship blind
	 * into a station, and the two read the same in a diff. Pass `[]` to mean
	 * open space.
	 */
	solids: readonly AvoidSphere[];
}

/** `stepCombatEnemy` for any hull and either intent. */
export function stepEnemyShip(
	state: CombatEnemyState,
	player: Ship,
	playerNose: Vec3,
	combat: EnemyReadout,
	playerFiring: boolean,
	dt: number,
	options: EnemyShipOptions,
): EnemyFlightStep {
	const {
		laserOrigin,
		laserNose,
		hitRadiusKm,
		frame,
		performance,
		intent,
		solids,
	} = options;
	const step = Math.max(0, dt);
	const toPlayer = sub(player.pos, state.ship.pos);
	const range = length(toPlayer);
	const towardPlayer = unit(toPlayer, state.nose);
	const awayFromPlayer = scale(towardPlayer, -1);
	const laser = playerLaserHit(
		laserOrigin,
		laserNose,
		state.ship.pos,
		hitRadiusKm,
	);

	// How close the player's sight line passes, in kilometres. An angle would
	// have meant one thing at the merge and another at ten kilometres.
	const alongSight = dot(sub(state.ship.pos, player.pos), playerNose);
	const missKm = length(
		sub(sub(state.ship.pos, player.pos), scale(playerNose, alongSight)),
	);
	const tracked =
		alongSight > 0 &&
		alongSight <= PLAYER_LASER_RANGE_KM &&
		missKm <= THREAT_MISS_KM;
	// Tracked *and* not looking back at them: the player is on this ship's six.
	const pursued = tracked && dot(state.nose, towardPlayer) < MERGE_ASPECT_COS;
	const underFire = playerFiring && laser.hit;
	const exhausted = combat.targetEnergy < 25 || combat.targetHeatLocked;

	let phase = state.phase;
	let phaseSeconds = state.phaseSeconds + step;
	let maneuverSeconds = state.maneuverSeconds;
	let pullAxis = reperp(state.pullAxis, towardPlayer);
	let draws = state.draws;
	let evadeCooldown = Math.max(0, state.evadeCooldown - step);

	/** Enter a manoeuvre with a drawn duration and a drawn out-of-plane pull. */
	const commit = (
		next: EnemyFlightPhase,
		minSeconds: number,
		maxSeconds: number,
	) => {
		phase = next;
		phaseSeconds = 0;
		maneuverSeconds =
			minSeconds + drawUnit(state.seed, draws++) * (maxSeconds - minSeconds);
		pullAxis = perpAt(
			towardPlayer,
			drawUnit(state.seed, draws++) * Math.PI * 2,
		);
	};

	// A fraction of the ship's own hull, so a stronger hull runs later in
	// absolute terms; at the rig's hull of 100 it is the 20 it always was.
	if (intent === "civilian") {
		// Spiral out of the sight line while hit, run the rest of the time.
		if (underFire && phase !== "evade" && evadeCooldown <= 0) {
			commit("evade", 1.1, 2.1);
			evadeCooldown = HIT_EVADE_COOLDOWN_S;
		} else if (
			phase !== "flee" &&
			(phase !== "evade" || (phaseSeconds >= maneuverSeconds && !underFire))
		)
			commit("flee", 30, 30);
	} else if (
		combat.targetHull <=
		FLEE_HULL_FRACTION * (combat.targetHullMax ?? 100)
	) {
		if (phase !== "flee") commit("flee", 30, 30);
	} else if (underFire && phase !== "evade" && evadeCooldown <= 0) {
		commit("evade", 1.1, 2.1);
		evadeCooldown = HIT_EVADE_COOLDOWN_S;
	} else if (range <= MERGE_BREAK_KM && phase !== "break") {
		commit("break", 1.2, 2.2);
	} else if (
		pursued &&
		evadeCooldown <= 0 &&
		phaseSeconds >= THREAT_REACTION_S &&
		(phase === "acquire" || phase === "attack" || phase === "extend")
	) {
		commit("evade", 1, 2);
		evadeCooldown = EVADE_COOLDOWN_S;
	} else
		switch (phase) {
			case "acquire":
				if (range <= ENGAGE_KM) commit("attack", 4, 8);
				break;
			case "attack":
				// A run that has drifted out of the envelope, or a ship that has
				// spent its energy holding one, extends and comes back rather than
				// settling into a stern chase it cannot win.
				if (range > DISENGAGE_KM) commit("acquire", 30, 30);
				else if (
					exhausted ||
					(phaseSeconds >= maneuverSeconds && range > GUN_RANGE_KM)
				)
					commit("extend", 1.6, 3.2);
				break;
			case "break":
				if (phaseSeconds >= maneuverSeconds) commit("extend", 1.4, 2.8);
				break;
			case "extend":
				if (phaseSeconds >= maneuverSeconds || range >= EXTEND_TARGET_KM)
					commit("attack", 4, 8);
				break;
			case "evade":
				if (phaseSeconds >= maneuverSeconds && !underFire)
					commit("extend", 1.2, 2.4);
				break;
			case "flee":
				break;
		}

	// Lead collision: where the player will be when this ship can reach them.
	// Two fixed-point iterations is plenty at these closing speeds, and the cap
	// stops a long extrapolation aiming at a place nobody is going.
	//
	// **In the frame, not in star coordinates** (#362). Both ships' assists
	// hold them in `frame`, so the frame's own motion carries both and moves
	// neither relative to the other; only the player's velocity *relative to
	// it* is a place to lead. Beside a station the frame moves ~30 km/s (#104),
	// and leading on the absolute velocity aimed a patrol up to 150 km along
	// the orbit, which it then flew toward and away from the fight. In the star
	// frame, where every raider duel so far has been fought, the two are equal.
	// `start`, because the player's velocity was handed back against the frame
	// as it stands at the top of this step.
	const playerRelVel = frame ? sub(player.vel, frame.start) : player.vel;
	let lead = range / ASSIST_CAP_KMS;
	for (let i = 0; i < 2; i++) {
		const predicted = add(
			player.pos,
			scale(playerRelVel, Math.min(lead, LEAD_CAP_S)),
		);
		lead = length(sub(predicted, state.ship.pos)) / ASSIST_CAP_KMS;
	}
	const interceptPoint = add(
		player.pos,
		scale(playerRelVel, Math.min(lead, LEAD_CAP_S)),
	);
	const pursuitNose = unit(sub(interceptPoint, state.ship.pos), towardPlayer);

	// The gun run rolls slowly around its own boresight rather than tracking a
	// straight line in. Amplitude is below the firing cone on purpose.
	const weaveAngle =
		phaseSeconds * (1.5 + drawUnit(state.seed, 5) * 1.1) +
		drawUnit(state.seed, 6) * Math.PI * 2;
	const attackNose = unit(
		add(pursuitNose, scale(perpAt(pursuitNose, weaveAngle), ATTACK_WEAVE)),
		pursuitNose,
	);
	// The defensive spiral: the pull direction itself rotates about the sight
	// line, so the player is tracking a corkscrew and not an arc.
	const spiralAxis = rotateAbout(
		pullAxis,
		towardPlayer,
		phaseSeconds * EVADE_SPIRAL_RAD_S,
	);

	const wanted =
		phase === "flee"
			? awayFromPlayer
			: phase === "evade"
				? // A defensive break turns across the sight line rather than running:
					// running is what `extend` and `flee` are for. Measured, the weight
					// on this term barely moves how far the fight ranges out — it is a
					// claim about what the manoeuvre *is*, not a fix for anything.
					unit(add(spiralAxis, scale(awayFromPlayer, 0.12)), spiralAxis)
				: phase === "break"
					? unit(add(pullAxis, scale(awayFromPlayer, 0.5)), pullAxis)
					: phase === "extend"
						? unit(add(awayFromPlayer, scale(pullAxis, 0.3)), awayFromPlayer)
						: attackNose;

	// Throttle is closure control in the envelope and everything elsewhere: a
	// gun run at the speed cap flies past before the guns have paid for it.
	const throttle =
		phase === "attack"
			? clamp((range - 0.8) / 4, 0.35, 1)
			: phase === "evade"
				? 0.9
				: 1;

	// **Then round what is in the way** (node #665): every phase's heading, the
	// rout's and a civilian's included, is answered for the most urgent solid
	// on its path, in that solid's frame — bent round it, or held off it when
	// the pilot is inside its keep-out — and the speed is capped by what that
	// answer allows.
	const avoided = avoidSolids(
		state.ship,
		state.nose,
		wanted,
		throttle * ASSIST_CAP_KMS,
		frame ? frame.start : v3(),
		solids,
		performance,
		player.pos,
	);
	const desired = avoided.desired;
	const speed = Math.min(throttle, avoided.maxSpeedKms / ASSIST_CAP_KMS);
	// Only an escape with no clearing heading uses strafe. Ordinary gun runs and
	// mouth holds keep their forward-speed control. These are velocity demands
	// inside the same assist cap, flown by the hull's own bounded vents.
	const demand = avoided.strafe
		? {
				surge: speed * Math.max(0, dot(desired, state.nose)),
				sway: speed * dot(desired, cross(state.nose, state.up)),
				heave: speed * dot(desired, state.up),
			}
		: speedDemand(speed);

	const ship = { pos: { ...state.ship.pos }, vel: { ...state.ship.vel } };
	// `step`, not `dt`: the clamp above is what stops a negative frame delta
	// running the integrator backwards, and it has to reach the integrator too.
	// **Turned through the player's own Hull step** (#324, #646): the hull's rate
	// limits and its angular acceleration, not a slew that reached full rate in
	// one frame. The slew had first been faster than the hull allows, and the
	// first playtest found the raider unhittable.
	const flown = stepHull(
		ship,
		state,
		{
			stick: aimStick(state, desired, performance),
			turnAssist: true,
			translation: {
				demand,
				assist: true,
				frame,
			},
		},
		step,
		performance,
	);
	const { nose, up } = flown;

	// Firing follows pointing, in any phase but a rout: a snapshot as the nose
	// sweeps across the player during a break is a shot a pilot would take.
	const enemyFiring =
		intent === "attacker" &&
		phase !== "flee" &&
		range <= GUN_RANGE_KM &&
		dot(nose, towardPlayer) >= FIRE_COS &&
		combat.targetHull > 0 &&
		combat.playerHull > 0;

	return {
		state: {
			ship,
			nose,
			up,
			rates: flown.rates,
			firing: flown.firing,
			phase,
			phaseSeconds,
			maneuverSeconds,
			pullAxis,
			evadeCooldown,
			seed: state.seed,
			draws,
		},
		targetInCone: laser.hit,
		laserEndpointKm: laser.distanceKm,
		enemyFiring,
		// `awayFromPlayer` is the same vector under the name this line wants:
		// the dot is negative when the striker is *behind* the player, which is
		// the case its fire lands on the aft shield.
		enemyHitAft: dot(playerNose, awayFromPlayer) < 0,
		avoiding: avoided.avoiding,
	};
}
