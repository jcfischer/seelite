/**
 * Weapons and damage, by ear (#545): one step's gun, shields, hull and
 * selected target in, the combat cues and loops out.
 *
 * **Pure, and it imports only the cue vocabulary** (#542 D3), like
 * `flight-sound.ts` and `console-sound.ts`. What each cue sounds like is
 * `AudioFX`'s; whether it sounds right is the principal's ear, flown.
 *
 * **Before this node** the laser was `AudioFX.laser()`, a descending
 * 880→180 Hz square zap every `SHOT_SOUND_GAP_S` while the gun fired — the
 * *pew pew* the principal rejected — and every hit was silent: #552 emitted
 * `shieldHit` and `hullHit` from a condition delta and `Game.play` dropped
 * them, because that delta read *any* fall and a condition replaced downward
 * would have cued too. The gate it owed is here: a fall is a hit only when
 * `applyDamage` struck the ship this step (`sinceStruckS`).
 *
 * ## The arms, from `?weaponsound=`
 *
 * Comma-separated tokens, unique across arms. The first of each is the
 * default; a default is needed to play at all and is not a ruling.
 *
 * - **laser** — `crack`: each paced shot is a short discharge crack, no pitch
 *   sweep. `beam`: a sustained hum for as long as the gun actually fires, with
 *   a discharge at its onset. `pew`: the zap before #545.
 * - **heat** — `heatrise`: the beam's whine climbs with the gun's heat, so a
 *   lockout is heard coming. `heatflat`: it does not. Only the beam reads it.
 * - **lockout** — `lockclick`: a trigger pulled on a heat-locked gun is a dry
 *   click, once per pull. `nolock`: silence, as before.
 * - **pools** — `sided`: a hit on the fore shield is brighter than one on the
 *   aft. `onepool`: one shield sound whichever pool took it.
 * - **low** — `thin`: a shield hit thins and crackles as its pool nears zero.
 *   `flat`: one sound at any charge.
 * - **held** — enemy fire is continuous, a fall every frame (#552's F3).
 *   `rearm`: a shield hit every `HIT_REARM_S` per pool. `sizzle`: one impact,
 *   then a sizzle loop on the struck pool for as long as the fire holds.
 * - **hull** — `clang`: a hull hit is metal struck, with a crunch.
 *   `thud`: the dull thud `AudioFX.hit()` had.
 * - **given** — `given`: a hit the player lands on the selected target is
 *   heard, smaller and further off than one taken. `nogiven`: silent.
 *
 * `?weaponsound=legacy` is the build before #545, so the two can be flown one
 * after the other.
 */
import type {
	WeaponMix,
	Cue,
	HitPool,
	HullHitVoice,
	LaserVoice,
} from "./audio-cue";

export const WEAPON_SOUND_ARMS = {
	laser: ["crack", "beam", "pew"],
	heat: ["heatrise", "heatflat"],
	lockout: ["lockclick", "nolock"],
	pools: ["sided", "onepool"],
	low: ["thin", "flat"],
	held: ["sizzle", "rearm"],
	hull: ["clang", "thud"],
	given: ["given", "nogiven"],
} as const satisfies Record<string, readonly string[]> & {
	hull: readonly HullHitVoice[];
};

export type WeaponSoundArms = {
	-readonly [K in keyof typeof WEAPON_SOUND_ARMS]: (typeof WEAPON_SOUND_ARMS)[K][number];
};

/** The first of each arm. */
export const DEFAULT_WEAPON_ARMS: WeaponSoundArms = {
	laser: "crack",
	heat: "heatrise",
	lockout: "lockclick",
	pools: "sided",
	low: "thin",
	held: "sizzle",
	hull: "clang",
	given: "given",
};

/**
 * The arms a `?weaponsound=` value names, or `legacy`. Unknown tokens are
 * handed back so the caller can say so rather than fly a silent default.
 */
export function weaponSoundArms(value: string | null): {
	arms: WeaponSoundArms | "legacy";
	unknown: string[];
} {
	const tokens = (value ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	if (tokens.includes("legacy")) return { arms: "legacy", unknown: [] };
	const arms: WeaponSoundArms = { ...DEFAULT_WEAPON_ARMS };
	const unknown: string[] = [];
	for (const token of tokens) {
		const arm = (
			Object.keys(WEAPON_SOUND_ARMS) as (keyof WeaponSoundArms)[]
		).find((k) => (WEAPON_SOUND_ARMS[k] as readonly string[]).includes(token));
		if (arm) (arms as Record<string, string>)[arm] = token;
		else unknown.push(token);
	}
	return { arms, unknown };
}

/** The player's own shields and hull, as `ShipCondition` carries them. */
export interface OwnReading {
	readonly fore: number;
	readonly aft: number;
	readonly hull: number;
	/** A full shield pool. */
	readonly poolMax: number;
	/** Seconds since `applyDamage` last struck the ship. */
	readonly sinceStruckS: number;
}

/** The selected combat target's shields and hull (`selectedTargetCondition`),
 *  under its id, so a new selection is a new reading and not a fall. */
export interface TargetReading {
	readonly id: string;
	readonly fore: number;
	readonly aft: number;
	readonly hull: number;
}

/** What the game reads off one step for the combat sound. */
export interface WeaponReading {
	/** The gun delivered a shot this step. */
	readonly fired: boolean;
	/** `stepGunFeedback`'s pacing: a discrete shot sound is owed this step. */
	readonly shotSound: boolean;
	/** The pilot is pulling the trigger. */
	readonly trigger: boolean;
	readonly heatLocked: boolean;
	/** The gun's heat, `0`..`1`. */
	readonly heat: number;
	readonly own: OwnReading;
	readonly target: TargetReading | null;
}

type PoolTimes = { readonly fore: number; readonly aft: number };
type HitTimes = PoolTimes & { readonly hull: number };

export interface WeaponSoundState {
	/** The last own reading, or `null` before the first. */
	readonly own: OwnReading | null;
	/** Seconds since each pool last cued a hit (`rearm`, and hull on both). */
	readonly sinceCue: HitTimes;
	/** Seconds since each shield pool last fell (`sizzle`). */
	readonly sinceFall: PoolTimes;
	readonly target: TargetReading | null;
	/** Seconds since a landed hit last cued. */
	readonly sinceGiven: number;
	/** This pull on a locked gun has clicked. */
	readonly lockClicked: boolean;
}

const LONG_AGO = Number.POSITIVE_INFINITY;

/** Nothing has happened: the first hit cues at once, and the first reading
 *  of anything is not a fall. */
export const QUIET_WEAPONS: WeaponSoundState = {
	own: null,
	sinceCue: { fore: LONG_AGO, aft: LONG_AGO, hull: LONG_AGO },
	sinceFall: { fore: LONG_AGO, aft: LONG_AGO },
	target: null,
	sinceGiven: LONG_AGO,
	lockClicked: false,
};

/** Every loop silent: the clock is held, or nothing is fighting. */
export const SILENT_WEAPONS: WeaponMix = {
	beam: 0,
	heat: 0,
	sizzleFore: 0,
	sizzleAft: 0,
};

/**
 * The shortest gap between two hit cues on one pool, s (`rearm`, and the hull
 * on either arm). #552's placeholder, kept until the ear moves it.
 */
export const HIT_REARM_S = 0.25;
/** How long a pool's sizzle holds after its last fall, s: longer than a frame,
 *  so a beam read every frame is one unbroken loop. */
export const SIZZLE_HOLD_S = 0.12;
/** A fall after this long without one is a fresh volley, and an impact. */
export const SIZZLE_QUIET_S = 0.5;
/** The shortest gap between two landed-hit cues, s. */
export const GIVEN_REARM_S = 0.25;

/** One step: the next state, the combat loops' levels, and the cues owed. */
export function weaponSound(
	state: WeaponSoundState,
	reading: WeaponReading,
	arms: WeaponSoundArms | "legacy",
	dt: number,
): { state: WeaponSoundState; mix: WeaponMix; cues: Cue[] } {
	const step = Math.max(0, dt);
	if (arms === "legacy")
		return {
			state: { ...QUIET_WEAPONS, own: reading.own, target: reading.target },
			mix: SILENT_WEAPONS,
			cues: reading.shotSound ? [{ kind: "laser", voice: "pew" }] : [],
		};

	const cues: Cue[] = [];

	// The gun.
	if (arms.laser !== "beam" && reading.shotSound)
		cues.push({ kind: "laser", voice: arms.laser satisfies LaserVoice });
	const lockedPull = reading.trigger && reading.heatLocked;
	if (lockedPull && !state.lockClicked && arms.lockout === "lockclick")
		cues.push({ kind: "gunLocked" });

	// Hits taken. A fall is a hit only when the ship was struck since the last
	// reading: `applyDamage` zeroes `sinceStruckS`, and the one step that can
	// have passed since adds at most `dt`. A condition replaced downward keeps a
	// clock of seconds and is not a hit (the gate `Game.play` owed, #552).
	const own = reading.own;
	const prev = state.own;
	const struck = own.sinceStruckS <= step;
	const fell = (key: "fore" | "aft" | "hull") =>
		prev !== null && struck && own[key] < prev[key];

	const sinceCue = {
		fore: state.sinceCue.fore + step,
		aft: state.sinceCue.aft + step,
		hull: state.sinceCue.hull + step,
	};
	const sinceFall = {
		fore: state.sinceFall.fore + step,
		aft: state.sinceFall.aft + step,
	};
	for (const pool of ["fore", "aft"] as const satisfies readonly HitPool[]) {
		if (!fell(pool)) continue;
		const fresh =
			arms.held === "sizzle"
				? sinceFall[pool] >= SIZZLE_QUIET_S
				: sinceCue[pool] >= HIT_REARM_S;
		sinceFall[pool] = 0;
		if (!fresh) continue;
		sinceCue[pool] = 0;
		cues.push({
			kind: "shieldHit",
			pool,
			share:
				arms.low === "thin"
					? Math.min(1, Math.max(0, own[pool] / own.poolMax))
					: 1,
			sided: arms.pools === "sided",
		});
	}
	if (fell("hull") && sinceCue.hull >= HIT_REARM_S) {
		sinceCue.hull = 0;
		cues.push({ kind: "hullHit", voice: arms.hull });
	}

	// Hits landed, on the selected target only, and only on the target that
	// was selected last step: a new selection is a first reading.
	let sinceGiven = state.sinceGiven + step;
	const was = state.target;
	const now = reading.target;
	if (was && now && was.id === now.id && arms.given === "given") {
		const on =
			now.fore < was.fore || now.aft < was.aft
				? "shield"
				: now.hull < was.hull
					? "hull"
					: null;
		if (on && sinceGiven >= GIVEN_REARM_S) {
			sinceGiven = 0;
			cues.push({ kind: "hitLanded", on });
		}
	}

	const sizzling = (pool: HitPool) =>
		arms.held === "sizzle" && sinceFall[pool] < SIZZLE_HOLD_S ? 1 : 0;
	const beam = arms.laser === "beam" && reading.fired ? 1 : 0;
	return {
		state: {
			own,
			sinceCue,
			sinceFall,
			target: now,
			sinceGiven,
			lockClicked:
				lockedPull && (state.lockClicked || arms.lockout === "lockclick"),
		},
		mix: {
			beam,
			heat:
				beam && arms.heat === "heatrise"
					? Math.min(1, Math.max(0, reading.heat))
					: 0,
			sizzleFore: sizzling("fore"),
			sizzleAft: sizzling("aft"),
		},
		cues,
	};
}
