import { HULL_SPECS, type HullId } from "./hull";
import type { HoldSummary } from "./hold";

export function miningHold(
	hull: HullId,
	hold: { usedT: number; capacityT: number },
	oreT: number,
): { usedT: number; capacityT: number } {
	const dedicated = HULL_SPECS[hull].oreHoldT;
	return dedicated === undefined
		? { usedT: hold.usedT + oreT, capacityT: hold.capacityT }
		: { usedT: oreT, capacityT: dedicated };
}

export function withOre(
	hull: HullId,
	hold: HoldSummary,
	ore: Readonly<Record<string, number>>,
): HoldSummary {
	const entries = Object.entries(ore).filter(([, t]) => t > 0);
	const oreT = entries.reduce((n, [, t]) => n + t, 0);
	const dedicated = HULL_SPECS[hull].oreHoldT;
	return {
		...hold,
		usedT: hold.usedT + (dedicated === undefined ? oreT : 0),
		freeT: hold.freeT - (dedicated === undefined ? oreT : 0),
		...(dedicated === undefined
			? {}
			: {
					oreBay: {
						usedT: oreT,
						capacityT: dedicated,
						freeT: dedicated - oreT,
					},
				}),
		lines: [
			...hold.lines,
			...entries.map(([goodName, amount]) => ({
				goodName,
				amount,
				unit: "t" as const,
				owner: "pilot" as const,
				kind: "ore" as const,
			})),
		],
	};
}
