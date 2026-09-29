/**
 * Which hull is flown, and where a bought one goes — the two decisions the
 * renderer used to make with module constants (#557, #584, #583).
 *
 * No DOM and no Three.js: `main.ts` reads both answers and does the drawing.
 */
import {
	type HullEnvelope,
	type HullId,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
	purchasableHullNamed,
} from "./hull";
import {
	type StationInterior,
	berthFits,
	chooseBerth,
} from "./station-interior";

/**
 * The hull a boot flies (#557's ruling, built by #584).
 *
 * A loaded Commander's saved hull wins, and `?hull=` never overrides or edits
 * it; on a fresh game a valid `?hull=` picks the first hull and anything else
 * flies the baseline. Either way a URL that names a hull the boot does not fly
 * is reported, so a development capture cannot judge the wrong ship silently.
 */
export function bootHull(
	/** The raw `?hull=` value, or `null` when absent. */
	asked: string | null,
	/** The loaded Commander's hull, or `null` on a fresh game. */
	saved: HullId | null,
): { hull: HullId; warning: string | null } {
	if (saved !== null)
		return {
			hull: saved,
			warning:
				asked !== null && asked !== saved
					? `[seelite] ?hull=${asked} ignored — a loaded Commander flies the saved ${saved}`
					: null,
		};
	const hull = purchasableHullNamed(asked) ?? PLAYER_BASELINE_HULL;
	return {
		hull,
		warning:
			asked !== null && asked !== hull
				? `[seelite] ?hull=${asked} is not one of ${PURCHASABLE_HULL_IDS.join(", ")} — flying the ${hull}`
				: null,
	};
}

/** Where a hull bought while docked goes (#556 D7, D10). */
export type HullDelivery =
	| { kind: "berth"; berthId: string }
	| { kind: "on-launch" };

/**
 * #556 D7 and D10: the purchase is never refused on berth.
 *
 * A hull that fits the berth it was bought in stays there — `chooseBerth`
 * with that berth freed could only rotate it to an equal one, and moving a
 * parked ship for a tie is a move nothing asked for. Otherwise it is
 * re-berthed through `chooseBerth` with the old berth freed; and with no free
 * berth that fits, it is delivered on launch: the ship keeps its old hull in
 * its old berth until undock, and the new hull takes over there.
 */
export function deliverHull(
	interior: StationInterior,
	currentBerthId: string,
	env: HullEnvelope,
	occupied: ReadonlySet<string>,
	requestTimeS = 0,
): HullDelivery {
	const current = interior.berths.find((berth) => berth.id === currentBerthId);
	if (current && berthFits(current, env))
		return { kind: "berth", berthId: current.id };
	const freed = new Set(occupied);
	freed.delete(currentBerthId);
	const berth = chooseBerth(interior, env, freed, requestTimeS);
	return berth ? { kind: "berth", berthId: berth.id } : { kind: "on-launch" };
}
