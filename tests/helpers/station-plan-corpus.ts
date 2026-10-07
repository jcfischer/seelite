import { makeWorld } from "../../src/sim";
import {
	type StationPlan,
	type StationType,
	formsInPlay,
} from "../../src/station";
import { ASSEMBLY_SEEDS, isSeededForm } from "./solved-forms";

/**
 * One station plan: the form it is built in and the two seeds it is built at.
 * The form is part of the plan since node #717 — a system picks it from the
 * role's pool, and the proxy a harness flies against is that form's.
 */
export type StationSeeds = Omit<StationPlan, "type">;

/** Seed-zero remains the fixed fixture for the non-seeded forms and historical
 * handling ceilings. Pad fits also cover the proxy budget's twelve-plan spread
 * and the actual station seeds in the start systems of world seeds 1–12.
 * This is a bounded corpus, not a claim about every uint32 assembly plan.
 * **Every form in the role's pool** (node #717), each over its own spread. */ // glossary-ignore: pad
const generated = Array.from({ length: 12 }, (_, i) =>
	makeWorld(i + 1),
).flatMap((world) => world.system.contents.stations);

export function stationPlansFor(type: StationType): StationSeeds[] {
	return formsInPlay(type).flatMap((formId): StationSeeds[] => {
		if (!isSeededForm(type, formId))
			return [{ formId, berthSeed: 1, assemblySeed: 0 }];
		return [
			...ASSEMBLY_SEEDS.map((assemblySeed) => ({
				formId,
				berthSeed: 1,
				assemblySeed,
			})),
			...generated
				.filter((station) => station.type === type && station.formId === formId)
				.map((station) => ({
					formId,
					berthSeed: station.berthSeed,
					assemblySeed: station.assemblySeed,
				})),
		];
	});
}

export const planLabel = (plan: StationSeeds): string =>
	`form ${plan.formId}, assembly ${plan.assemblySeed}, berth ${plan.berthSeed}`;
