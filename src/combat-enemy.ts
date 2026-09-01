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
 * vector, and at these turn rates it visibly does.
 */

import type { CombatPrototypeState } from "./combat-prototype";
import { HULL_SPECS, type HullId } from "./hull";
import { mix, seedFor } from "./rng";
import {
	ASSIST_CAP_KMS,
	flightPerformance,
	type FlightPerformance,
	stepFlight,
	type Ship,
} from "./sim";
import {
	add,
	cross,
	dot,
	length,
	lengthSq,
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
	 * share of frames it is firing is 0.294–0.307 with the lockout and
	 * 0.148–0.226 without. It does **not** measurably change how far the fight
	 * ranges out — that was checked and it is the same ~8–10 km either way.
	 *
	 * Being *hit* ignores this: a player who can hold the sight on it has earned
	 * the suppression.
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
const FLEE_HULL = 20;
/** Twelve degrees. Firing is gated on pointing, and the attack weave below
 *  stays inside it so a weaving gun run still shoots. */
export const FIRE_COS = Math.cos((12 * Math.PI) / 180);
/** The weave's weight against a unit boresight, so `atan(0.1)` ≈ 5.7° of nose
 *  offset: enough that a gun run is not a rail, half the firing cone. */
const ATTACK_WEAVE = 0.1;
/** Nose slew ceiling. The velocity vector lags it by `ASSIST_LATERAL_TAU_S`,
 *  so the drawn ship visibly crabs through a hard turn. */
export const MAX_TURN_RATE_RAD_S = 1.2;
const ROLL_RATE_RAD_S = 2.6;
const BANK_MAX_RAD = (72 * Math.PI) / 180;
/** Bank angle per radian per second of turn rate. */
const BANK_GAIN = 1.1;
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
 *  after this long in the current manoeuvre. It is the whole of the window a
 *  player has to convert a tracking solution into hits. */
const THREAT_REACTION_S = 0.45;
/** Above this the ship is nosed at the player and the pass is a mutual merge,
 *  not a tail. A merge is jousted, not evaded — an earlier cut of this rule
 *  evaded on *any* tracking, which meant the player pointing at the target was
 *  enough to call off the attack, and the target never attacked at all. */
const MERGE_ASPECT_COS = 0.3;

export const PLAYER_LASER_RANGE_KM = 12;

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
 * The striker's hit sphere: the sphere that just contains the drawn hull.
 *
 * `HULL_SPECS.raider.env.lengthKm` is the **measured** box of the built
 * `raider/a` mesh (0.0635 km), drawn at `ENEMY_VISUAL_SCALE`, so half of that
 * is the radius here: 0.09525 km. It was 0.28 — nearly three drawn ship
 * lengths — which meant the beam scored on shots that visibly missed, and the
 * one skill #53 is trying to make matter is keeping a sight on a moving ship.
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
 * courier's 2.000, so it reaches the shared 2 km/s assist cap in a little over
 * a third of the time the player's ship does. The cap is not per hull (see
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
): { hit: boolean; distanceKm: number } {
	const toEnemy = sub(enemyPos, playerPos);
	const along = dot(toEnemy, playerNose);
	if (along < 0 || along > PLAYER_LASER_RANGE_KM)
		return { hit: false, distanceKm: PLAYER_LASER_RANGE_KM };
	const perpendicular = sub(toEnemy, scale(playerNose, along));
	const radiusSq = ENEMY_COLLISION_RADIUS_KM ** 2;
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

/** Rodrigues: spin `v` about a unit `axis`. */
function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return add(
		add(scale(v, c), scale(cross(axis, v), s)),
		scale(axis, dot(axis, v) * (1 - c)),
	);
}

/** Re-seat a stored direction into the plane perpendicular to `dir`, which the
 *  fight's own motion keeps moving out from under it. */
const reperp = (v: Vec3, dir: Vec3): Vec3 =>
	unit(sub(v, scale(dir, dot(v, dir))), perpBasis(dir)[0]);

/**
 * Turn `from` toward `to` by at most `maxRadians`.
 *
 * The reason the ship reads as having mass. Without it the commanded nose is
 * whatever the guidance law asks for on that frame, and a state change snaps
 * the model through ninety degrees between two frames.
 */
function slew(from: Vec3, to: Vec3, maxRadians: number): Vec3 {
	const c = clamp(dot(from, to), -1, 1);
	const angle = Math.acos(c);
	if (!(angle > maxRadians)) return to;
	// At angle ~ pi the difference vector vanishes and any perpendicular will
	// do; `perpBasis` supplies one rather than letting the turn stall.
	const perpendicular = unit(sub(to, scale(from, c)), perpBasis(from)[0]);
	return unit(
		add(
			scale(from, Math.cos(maxRadians)),
			scale(perpendicular, Math.sin(maxRadians)),
		),
		to,
	);
}

/**
 * Roll the ship into its turn.
 *
 * `cross(previous, next)` is the turn axis and its magnitude is the sine of the
 * angle turned, so it gives both the rate and — crossed back with the nose —
 * the direction of the turn centre. The lift vector leans that way by an angle
 * proportional to the rate, which is the whole of what makes a banking turn
 * look like one.
 */
function bankedUp(
	previousNose: Vec3,
	nose: Vec3,
	previousUp: Vec3,
	dt: number,
): Vec3 {
	const level = unit(
		sub(previousUp, scale(nose, dot(previousUp, nose))),
		perpBasis(nose)[1],
	);
	const turn = cross(previousNose, nose);
	const turned = Math.asin(clamp(length(turn), 0, 1));
	const inside = unit(cross(turn, nose), v3());
	const bank = Math.min(BANK_MAX_RAD, (dt > 0 ? turned / dt : 0) * BANK_GAIN);
	const want =
		lengthSq(inside) === 0
			? level
			: unit(
					add(scale(level, Math.cos(bank)), scale(inside, Math.sin(bank))),
					level,
				);
	const rolled = slew(level, want, ROLL_RATE_RAD_S * Math.max(0, dt));
	return unit(sub(rolled, scale(nose, dot(rolled, nose))), level);
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
 * Choose an intent from the geometry, then fly it through the player's own
 * integrator. It never writes a renderer transform or a scheduled damage value.
 */
export function stepCombatEnemy(
	state: CombatEnemyState,
	player: Ship,
	playerNose: Vec3,
	combat: CombatPrototypeState,
	playerFiring: boolean,
	dt: number,
	laserOrigin: Vec3 = player.pos,
	laserNose: Vec3 = playerNose,
): EnemyFlightStep {
	const step = Math.max(0, dt);
	const toPlayer = sub(player.pos, state.ship.pos);
	const range = length(toPlayer);
	const towardPlayer = unit(toPlayer, state.nose);
	const awayFromPlayer = scale(towardPlayer, -1);
	const playerToEnemy = scale(towardPlayer, -1);
	const laser = playerLaserHit(laserOrigin, laserNose, state.ship.pos);

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

	if (combat.targetHull <= FLEE_HULL) {
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
	let lead = range / ASSIST_CAP_KMS;
	for (let i = 0; i < 2; i++) {
		const predicted = add(
			player.pos,
			scale(player.vel, Math.min(lead, LEAD_CAP_S)),
		);
		lead = length(sub(predicted, state.ship.pos)) / ASSIST_CAP_KMS;
	}
	const interceptPoint = add(
		player.pos,
		scale(player.vel, Math.min(lead, LEAD_CAP_S)),
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

	const desired =
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

	const nose = slew(state.nose, desired, MAX_TURN_RATE_RAD_S * step);
	const up = bankedUp(state.nose, nose, state.up, step);

	// Throttle is closure control in the envelope and everything elsewhere: a
	// gun run at the speed cap flies past before the guns have paid for it.
	const throttle =
		phase === "attack"
			? clamp((range - 0.8) / 4, 0.35, 1)
			: phase === "evade"
				? 0.9
				: 1;

	const ship = { pos: { ...state.ship.pos }, vel: { ...state.ship.vel } };
	stepFlight(ship, { nose, throttle, assist: true }, dt, STRIKER_PERFORMANCE);

	// Firing follows pointing, in any phase but a rout: a snapshot as the nose
	// sweeps across the player during a break is a shot a pilot would take.
	const enemyFiring =
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
		enemyHitAft: dot(playerNose, playerToEnemy) < 0,
	};
}
