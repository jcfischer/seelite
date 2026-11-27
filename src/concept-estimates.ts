import { conceptFamilies } from "./fitting-families";
import { makeModule, moduleRow } from "./loadout";

type Concept = (typeof conceptFamilies)[number];
const proposals = {
	autocannon: {
		size: 2,
		peer: "beam-laser",
		shots: 6,
		hits: 1,
		damage: 5,
		spacing: 0.1,
		charge: 0,
		recovery: 1,
	},
	railgun: {
		size: 2,
		peer: "military-laser",
		shots: 1,
		hits: 1,
		damage: 80,
		spacing: 0,
		charge: 2,
		recovery: 2,
	},
	scattergun: {
		size: 1,
		peer: "pulse-laser",
		shots: 1,
		hits: 8,
		damage: 3,
		spacing: 0,
		charge: 0,
		recovery: 1.5,
	},
	"plasma-projector": {
		size: 2,
		peer: "missile-rack",
		shots: 1,
		hits: 1,
		damage: 54,
		spacing: 0,
		charge: 1,
		recovery: 2,
	},
} as const;

export function isConcept(family: string): family is Concept {
	return conceptFamilies.some((concept) => concept === family);
}

export function conceptEstimate(family: Concept) {
	const p = proposals[family];
	const cycle = p.charge + (p.shots - 1) * p.spacing + p.recovery;
	const dps = (p.shots * p.hits * p.damage) / cycle;
	const priceCr = moduleRow(makeModule(p.peer, p.size, "E")).priceCr;
	return { size: p.size, dps, priceCr, value: (dps * 1000) / priceCr };
}
