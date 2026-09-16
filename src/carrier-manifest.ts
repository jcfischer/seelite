/**
 * An ordinary carrier's hold (`carrier-identity.md` §3, F6, F11; built by #362
 * under `civilian-combat.md` H0, H1 and H11).
 *
 * **Derived, never saved**, under its own `DOMAIN` tag, and fixed for one
 * voyage. The caller passes the voyage the carrier is **flying**
 * (`flownVoyageOrdinal`: its route's visit, the schedule's ordinal only without
 * a route), and a fight fixes it on the engagement when it starts, so a hold
 * cannot change between a scan and a kill. The schedule's own ordinal is not
 * enough: a return running late is still the previous visit (sage #368).
 *
 * **What a scan shows is what drops** (F6). A kill drops one canister per line
 * here, each holding its line's tonnes (H11), so this function is the whole of
 * both answers and nothing draws the hold a second time.
 *
 * **The contraband weighting is `cargoWeights`**, the raider's, as §3 asked,
 * rather than a second weighting: illegal goods weigh `(7 − government) / 7`.
 */
import type { CarrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { DOMAIN } from "./domains";
import { cargoWeights, pickWeightedIndex } from "./raider-wreck";
import { mix, seededRand } from "./rng";

export const MANIFEST_LINES = { min: 1, max: 4 } as const;
/** The share of the hold a voyage fills, drawn per voyage in this range. */
export const MANIFEST_FILL = { min: 0.4, max: 1 } as const;

export interface ManifestLine {
	good: string;
	tonnes: number;
}

export function carrierManifest(
	systemSeed: number,
	key: CarrierKey,
	instanceOrdinal: number,
	voyageOrdinal: number,
	hold: { holdT: number; government: number },
): readonly ManifestLine[] {
	const rand = seededRand(
		mix(
			carrierInstanceSeed(
				systemSeed,
				key,
				instanceOrdinal,
				DOMAIN.CARRIER_MANIFEST,
			),
			voyageOrdinal,
		),
	);
	const holdT = Math.max(0, Math.floor(hold.holdT));
	const fill =
		MANIFEST_FILL.min + rand() * (MANIFEST_FILL.max - MANIFEST_FILL.min);
	const tonnes = Math.max(1, Math.min(holdT, Math.round(holdT * fill)));
	const span = MANIFEST_LINES.max - MANIFEST_LINES.min + 1;
	const drawn =
		MANIFEST_LINES.min + Math.min(span - 1, Math.floor(rand() * span));
	// A line is at least a tonne, so a hold smaller than the draw has fewer.
	const count = Math.min(drawn, tonnes);

	// Distinct goods, weighted, without replacement.
	const pool = cargoWeights(hold.government).filter((w) => w.weight > 0);
	const goods: string[] = [];
	for (let i = 0; i < count && pool.length > 0; i++) {
		const at = pickWeightedIndex(pool, rand);
		goods.push(pool[at].good.name);
		pool.splice(at, 1);
	}

	// Split the tonnage: a tonne each, the rest by drawn shares.
	const shares = goods.map(() => rand() + 0.05);
	const shareTotal = shares.reduce((sum, s) => sum + s, 0);
	const spare = tonnes - goods.length;
	const split = shares.map((s) => 1 + Math.floor((spare * s) / shareTotal));
	split[0] += tonnes - split.reduce((sum, t) => sum + t, 0);
	return goods.map((good, i) => ({ good, tonnes: split[i] }));
}
