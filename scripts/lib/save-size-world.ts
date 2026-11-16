import { carrierKey } from "../../src/carrier-key";
import { generateGalaxy } from "../../src/galaxy";
import { COMMODITIES } from "../../src/market";
import {
	advanceTo,
	newWorld,
	enumerateCarriers,
	capabilityAvailability,
	GALAXY_COUNT,
	type GalaxyEnvelope,
} from "../../src/world-state";
const SEED = 1;
const GOODS = COMMODITIES.map((g) => g.name);
export interface Tier {
	name: string;
	systems: number;
	galaxies: number;

	everyCarrier: boolean;
	knowledge: boolean;
	objective: boolean;
	deficitGoods: number;

	witnesses: boolean;

	charges: boolean;
}

export function buildSaveSizeWorld(tier: Tier) {
	const baseline = advanceTo(newWorld(SEED), 123456.789);
	const world = advanceTo(newWorld(SEED), baseline.gameTime);
	let carriers = 0;
	let witnesses = 0;
	let charges = 0;
	for (let g = 0; g < tier.galaxies && g < GALAXY_COUNT; g++) {
		const galaxy = generateGalaxy(SEED, g);
		const env: GalaxyEnvelope = world.galaxies[g];
		const records = galaxy.systems.slice(0, tier.systems);
		let inGalaxy = 0;
		env.visited = records.map((_, i) => i);

		const berths: ReturnType<typeof carrierKey>[] = [];

		const flown: ReturnType<typeof carrierKey>[] = [];

		const keys: ReturnType<typeof carrierKey>[] = [];
		for (const c of enumerateCarriers(SEED, g)) {
			if (c.kind === "capability") {
				if (tier.objective && tier.everyCarrier && c.systemIndex < tier.systems)
					env.capabilityTime.anchors[c.key] = capabilityAvailability(
						baseline,
						g,
						c.key,
					).state;
				continue;
			}
			if (c.systemIndex >= tier.systems) continue;
			if (c.kind === "station") berths.push(c.key);
			else if (!tier.everyCarrier) continue;
			else if (c.kind === "traffic") flown.push(c.key);
			keys.push(c.key);
		}
		for (const key of keys) {
			carriers++;
			inGalaxy++;
			if (tier.objective) {
				env.objective[key] = {
					instanceOrdinal: 3,
					condition: "repairing",
					recovery: {
						kind: "replacement",
						processId: `${key}#e7#replacement`,
						consequenceArea: "station-services",
						startedAt: 123456.789,
						completesAt: 234567.891,
						initiatedBy: {
							causeKind: "player-attack",
							actorId: "player",
							playerRole: "direct",
						},
					},
				};
				const fact = (kind: "destroy" | "replacement-start" | "interrupt") =>
					({
						key,
						instanceOrdinal: 3,
						episodeOrdinal: 7,
						kind,
						occurredAt: 123456.789,
						cause: {
							causeKind: "player-attack",
							actorId: "player",
							playerRole: "direct",
						},
						processId: `${key}#e7#replacement`,
					}) as const;
				env.episodes[key] = {
					ordinal: 7,
					initiating: fact("destroy"),
					intervention: fact("replacement-start"),
					latest: fact("interrupt"),
					closed: false,
				};
			}
			if (tier.knowledge)
				env.knowledge[key] = {
					observedInstanceOrdinal: 1,
					observedCondition: "operational",
					observedAt: 123456.789,
					source: "system-relay",
					knownPrivateFacts: {
						blackMarket: { learnedAt: 123456.789, source: "docking" },
					},
				};
			if (tier.deficitGoods > 0) {
				const goods: Record<string, number> = {};
				for (const name of GOODS.slice(0, tier.deficitGoods))
					goods[name] = -63.4;
				env.deficits[key] = { goods, updatedAt: 123456.789 };
			}
		}

		const check = (domain: string, count: number) => {
			if (count !== inGalaxy)
				throw new Error(
					`galaxy ${g}: ${inGalaxy} carriers but ${count} ${domain} rows — colliding keys`,
				);
		};
		if (tier.objective) check("objective", Object.keys(env.objective).length);
		if (tier.knowledge) check("knowledge", Object.keys(env.knowledge).length);
		if (tier.deficitGoods > 0)
			check("deficit", Object.keys(env.deficits).length);
		if (tier.charges && new Set(flown).size !== flown.length)
			throw new Error(`galaxy ${g}: ${flown.length} carriers collide`);
		if (tier.witnesses || tier.charges) {
			env.legalStatus = {
				heat: 100,
				updatedAt: 123456.789,
				witnesses: [],
				assaulted: [],
			};
		}
		if (tier.witnesses) {
			if (new Set(berths).size !== berths.length)
				throw new Error(`galaxy ${g}: ${berths.length} berths collide`);
			env.legalStatus.witnesses = berths;
			witnesses += berths.length;
		}
		if (tier.charges) {
			env.legalStatus.assaulted = flown;
			charges += flown.length;
		}
	}
	return { world, carriers, witnesses, charges };
}
