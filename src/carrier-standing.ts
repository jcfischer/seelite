/**
 * An ordinary carrier's standing (`carrier-identity.md` §2, F2, F7; built by
 * #362 under `civilian-combat.md` H0, H1 and H12).
 *
 * **Derived, never saved.** A pure function of the system seed, the carrier
 * key, the instance and the game clock, recomputed on read under its own
 * `DOMAIN` tag. The system seed is what carries the galaxy — a key alone is
 * envelope-relative (§1).
 *
 * **The clock term is a rotation, phased per instance.** The clock is cut into
 * `STANDING_ROTATION_S` periods offset by a phase the instance draws once, and
 * each period draws a standing afresh. Phasing per instance is what stops a
 * whole system flipping at one moment.
 *
 * **The period is F7's constraint in figures.** The law judges a kill on true
 * standing, so a ship scanned Wanted must still be Wanted when it dies; a
 * window from scan to kill spans a rotation boundary with probability
 * `window / STANDING_ROTATION_S`, about 0.6 % for two minutes at 6 h.
 *
 * **The shares are starting forms, not measurements** (H12).
 * `scripts/measure-carrier-standing.ts` prints what they produce across seeds
 * and galaxies, and the principal tunes them after flying.
 */
import type { CarrierKey } from "./carrier-key";
import { DOMAIN } from "./domains";
import type { Standing } from "./legal";
import { mix, seededRand } from "./rng";
import { fnv1a } from "./world-state";

export const STANDING_SHARES = { wanted: 0.12, fugitive: 0.03 } as const;
export const STANDING_ROTATION_S = 6 * 3600;

/** One carrier's seed in its system: the system seed carries the galaxy, the
 *  key the carrier. The root every per-carrier draw splits from — the hold,
 *  the standing, a kill's drop and an engagement's flight. */
export const carrierKeySeed = (systemSeed: number, key: CarrierKey): number =>
	mix(systemSeed, fnv1a(key));

/** One instance's own seed: the system, the key, the ordinal (H1). */
export const carrierInstanceSeed = (
	systemSeed: number,
	key: CarrierKey,
	instanceOrdinal: number,
	domain: number,
): number => mix(mix(carrierKeySeed(systemSeed, key), instanceOrdinal), domain);

export function carrierStanding(
	systemSeed: number,
	key: CarrierKey,
	instanceOrdinal: number,
	gameTime: number,
): Standing {
	const seed = carrierInstanceSeed(
		systemSeed,
		key,
		instanceOrdinal,
		DOMAIN.CARRIER_STANDING,
	);
	const phase = seededRand(seed)() * STANDING_ROTATION_S;
	const rotation = Math.floor((gameTime + phase) / STANDING_ROTATION_S);
	const u = seededRand(mix(seed, rotation))();
	if (u < STANDING_SHARES.fugitive) return "fugitive";
	if (u < STANDING_SHARES.fugitive + STANDING_SHARES.wanted) return "wanted";
	return "clean";
}
