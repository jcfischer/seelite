import { makeWorld } from "../../src/sim";
import type { StationType } from "../../src/station";
import { ASSEMBLY_SEEDS } from "./solved-forms";

export interface StationSeeds {
	berthSeed: number;
	assemblySeed: number;
}

/** Seed-zero remains the fixed fixture for the non-seeded forms and historical
 * handling ceilings. Pad fits also cover the proxy budget's twelve-plan spread
 * and the actual station seeds in the start systems of world seeds 1–12.
 * This is a bounded corpus, not a claim about every uint32 assembly plan. */ // glossary-ignore: pad
const generated = Array.from({ length: 12 }, (_, i) =>
	makeWorld(i + 1),
).flatMap((world) => world.system.contents.stations);

export function stationPlansFor(type: StationType): StationSeeds[] {
	if (type === "trade" || type === "shipyard")
		return [{ berthSeed: 1, assemblySeed: 0 }];
	return [
		...ASSEMBLY_SEEDS.map((assemblySeed) => ({ berthSeed: 1, assemblySeed })),
		...generated
			.filter((station) => station.type === type)
			.map((station) => ({
				berthSeed: station.berthSeed,
				assemblySeed: station.assemblySeed,
			})),
	];
}

export const planLabel = (plan: StationSeeds): string =>
	`assembly ${plan.assemblySeed}, berth ${plan.berthSeed}`;
