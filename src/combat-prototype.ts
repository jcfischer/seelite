/**
 * THROWAWAY #48 combat balance model.  It has no world, renderer, persistence,
 * collision, or AI ownership: it only makes the combat numbers flyable and
 * measurable before a production combat system chooses those seams.
 */
export const COMBAT_PROTOTYPE_DEFAULTS = {
	hull: 100,
	shield: 106,
	energy: 100,
	heatLock: 100,
	pulseDamagePerSecond: 6,
	pulseEnergyPerSecond: 1,
	pulseHeatPerSecond: 1.5,
	beamDamagePerSecond: 24,
	beamEnergyPerSecond: 18,
	beamHeatPerSecond: 30,
	energyRegenPerSecond: 12,
	heatCoolPerSecond: 16,
	shieldRechargePerSecond: 6,
	enemyDamagePerSecond: 8,
	lockSeconds: 1.5,
	interdictionSeconds: 2.5,
} as const;

export type WeaponMode = "pulse" | "beam" | null;
export interface CombatPrototypeState {
	elapsed: number;
	energy: number;
	heat: number;
	heatLocked: boolean;
	firing: WeaponMode;
	foreShield: number;
	aftShield: number;
	playerHull: number;
	targetForeShield: number;
	targetAftShield: number;
	targetHull: number;
	missileLock: boolean;
	lockProgress: number;
	incomingMissile: boolean;
	interdiction: boolean;
	interdictionProgress: number;
}
export interface CombatPrototypeInput {
	dt: number;
	firing?: WeaponMode;
	targetInCone?: boolean;
	hitAft?: boolean;
	incomingMissile?: boolean;
	ecm?: boolean;
	interdicting?: boolean;
	breakAngle?: boolean;
	enemyFiring?: boolean;
	enemyHitAft?: boolean;
}

export function createCombatPrototype(
	overrides: Partial<CombatPrototypeState> = {},
): CombatPrototypeState {
	return {
		elapsed: 0,
		energy: COMBAT_PROTOTYPE_DEFAULTS.energy,
		heat: 0,
		heatLocked: false,
		firing: null,
		foreShield: COMBAT_PROTOTYPE_DEFAULTS.shield,
		aftShield: COMBAT_PROTOTYPE_DEFAULTS.shield,
		playerHull: COMBAT_PROTOTYPE_DEFAULTS.hull,
		targetForeShield: COMBAT_PROTOTYPE_DEFAULTS.shield,
		targetAftShield: COMBAT_PROTOTYPE_DEFAULTS.shield,
		targetHull: COMBAT_PROTOTYPE_DEFAULTS.hull,
		missileLock: false,
		lockProgress: 0,
		incomingMissile: false,
		interdiction: false,
		interdictionProgress: 0,
		...overrides,
	};
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

/** The strafe leaves the sight line for roughly 38% of the duel: the x term
 *  fails ~16% of the time and the y term ~26%, which is the dominant driver
 *  of the 60-90 s pacing window the tests assert. */
export function duelTargetInCone(elapsed: number) {
	return (
		Math.abs(3 * Math.sin(elapsed * 0.7)) < 2.9 &&
		Math.abs(1.2 * Math.cos(elapsed * 1.1)) < 1.1
	);
}

export function stepCombatPrototype(
	state: CombatPrototypeState,
	input: CombatPrototypeInput,
): CombatPrototypeState {
	const dt = Math.max(0, input.dt);
	let next = { ...state, elapsed: state.elapsed + dt };
	const coneHeld = input.targetInCone ?? true;
	next.lockProgress = coneHeld
		? Math.min(COMBAT_PROTOTYPE_DEFAULTS.lockSeconds, next.lockProgress + dt)
		: 0;
	next.missileLock = next.lockProgress >= COMBAT_PROTOTYPE_DEFAULTS.lockSeconds;
	if (input.incomingMissile) next.incomingMissile = true;
	if (input.ecm) next.incomingMissile = false;
	next.interdictionProgress =
		input.interdicting && !input.breakAngle
			? Math.min(
					COMBAT_PROTOTYPE_DEFAULTS.interdictionSeconds,
					next.interdictionProgress + dt,
				)
			: 0;
	next.interdiction =
		next.interdictionProgress >= COMBAT_PROTOTYPE_DEFAULTS.interdictionSeconds;
	const weapon = input.firing ?? null;
	const beam = weapon === "beam";
	const energyCost =
		(beam
			? COMBAT_PROTOTYPE_DEFAULTS.beamEnergyPerSecond
			: COMBAT_PROTOTYPE_DEFAULTS.pulseEnergyPerSecond) * dt;
	const canFire =
		weapon !== null && !next.heatLocked && next.energy >= energyCost;
	next.firing = canFire ? weapon : null;
	if (canFire) {
		if (next.energy >= energyCost) {
			next.energy -= energyCost;
			next.heat = clamp(
				next.heat +
					(beam
						? COMBAT_PROTOTYPE_DEFAULTS.beamHeatPerSecond
						: COMBAT_PROTOTYPE_DEFAULTS.pulseHeatPerSecond) *
						dt,
				COMBAT_PROTOTYPE_DEFAULTS.heatLock,
			);
			// A held trigger still costs energy and adds heat when the strafe leaves
			// the sightline, but it cannot damage a target the fixed forward weapon
			// does not point at.
			if (coneHeld) {
				const damage =
					(beam
						? COMBAT_PROTOTYPE_DEFAULTS.beamDamagePerSecond
						: COMBAT_PROTOTYPE_DEFAULTS.pulseDamagePerSecond) * dt;
				const shieldKey = input.hitAft ? "targetAftShield" : "targetForeShield";
				const absorbed = Math.min(next[shieldKey], damage);
				next[shieldKey] -= absorbed;
				next.targetHull = clamp(
					next.targetHull - (damage - absorbed),
					COMBAT_PROTOTYPE_DEFAULTS.hull,
				);
			}
		}
	} else {
		next.energy = clamp(
			next.energy + COMBAT_PROTOTYPE_DEFAULTS.energyRegenPerSecond * dt,
			COMBAT_PROTOTYPE_DEFAULTS.energy,
		);
		next.heat = clamp(
			next.heat - COMBAT_PROTOTYPE_DEFAULTS.heatCoolPerSecond * dt,
			COMBAT_PROTOTYPE_DEFAULTS.heatLock,
		);
	}
	next.heatLocked =
		next.heat >= COMBAT_PROTOTYPE_DEFAULTS.heatLock ||
		(next.heatLocked && next.heat > COMBAT_PROTOTYPE_DEFAULTS.heatLock * 0.5);
	if (input.enemyFiring) {
		const damage = COMBAT_PROTOTYPE_DEFAULTS.enemyDamagePerSecond * dt;
		const shieldKey = input.enemyHitAft ? "aftShield" : "foreShield";
		const absorbed = Math.min(next[shieldKey], damage);
		next[shieldKey] -= absorbed;
		next.playerHull = clamp(
			next.playerHull - (damage - absorbed),
			COMBAT_PROTOTYPE_DEFAULTS.hull,
		);
	} else {
		const lower =
			next.foreShield <= next.aftShield ? "foreShield" : "aftShield";
		next[lower] = clamp(
			next[lower] + COMBAT_PROTOTYPE_DEFAULTS.shieldRechargePerSecond * dt,
			COMBAT_PROTOTYPE_DEFAULTS.shield,
		);
	}
	return next;
}

/** Derived rather than re-typed: these are the four `CombatPrototypeInput`
 *  fields the pilot supplies, and a copy would keep compiling against a stale
 *  shape the day one of them changes type. */
export type DuelLiveInput = Pick<
	CombatPrototypeInput,
	"incomingMissile" | "ecm" | "interdicting" | "breakAngle"
>;

/**
 * What the rig hands `stepCombatPrototype` for one frame of the scripted duel.
 *
 * **One function, because it was three.** The live rig built this object inline
 * in `Game.step`, and `tests/combat-prototype.test.ts` wrote the same
 * arithmetic out once per weapon arm — three spellings of one schedule, kept in
 * step by hand. Every retune then needed the other two mirrored onto it, which
 * is what the "match beam and pulse duel arms" and "mirror enemy aft
 * alternation in duel" commits were doing. A test that builds its own inputs is
 * pacing a different duel from the one being flown.
 *
 * The split is between what the *script* decides — the strafe, the shield-bank
 * alternation, the enemy's firing window, all functions of `elapsed` and the
 * two hulls — and what the *pilot* does, which the rig passes in as `live`.
 * The weapon is the caller's because it is the one thing the two arms differ
 * in, and `#48`'s pacing claim is exactly that they differ in nothing else.
 */
export function duelInputs(
	state: CombatPrototypeState,
	dt: number,
	firing: WeaponMode,
	live: DuelLiveInput = {},
): CombatPrototypeInput {
	const { elapsed } = state;
	return {
		dt,
		firing,
		targetInCone: duelTargetInCone(elapsed),
		// Alternate which target shield bank the fixed weapon meets, so the
		// fore/aft pools both participate in the duel pacing being measured.
		hitAft: Math.floor(elapsed / 2) % 2 === 1,
		// The enemy fires on its own schedule, not on the player's aim cone:
		// gating the enemy's damage on `targetInCone` would let the player only be
		// damaged while happening to point at the enemy. It stops once either side
		// is gone, so the duel has a terminal state.
		enemyFiring:
			state.targetHull > 0 && state.playerHull > 0 && elapsed % 4 < 2,
		enemyHitAft: Math.floor(elapsed / 3) % 2 === 1,
		...live,
	};
}
