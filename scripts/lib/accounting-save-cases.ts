import { fnv1a } from "../../src/rng";
import { buildSaveSizeWorld, type Tier } from "./save-size-world";
import { COMMODITIES } from "../../src/market";
import {
	displayAmount,
	nativeGrams,
	emptyAccount,
	withAccount,
	acquire,
	encodeShare,
	type CommodityAccount,
} from "../../src/commodity-pools";
import {
	mass,
	money,
	signedMoney,
	massFromNative,
} from "../../src/exact-amount";
import {
	newCommanderRecord,
	type SaveEnvelope,
	serializeSave,
	parseSave,
} from "../../src/save-envelope";
import {
	newWorld,
	withDeathWreck,
	enumerateCarriers,
	type WorldState,
} from "../../src/world-state";
import { deathWreckRow } from "../../src/death-wreck";
import { sweepSources } from "../../src/system-sweep";

export function accountingSaveCases(): { name: string; save: SaveEnvelope }[] {
	const commander = newCommanderRecord("freighter");
	let account = emptyAccount(100000);
	for (const good of COMMODITIES)
		account = acquire(account, good.name, 1, money.fromNumber(0.1));
	commander.state = withAccount(commander.state, account);
	const typical = { world: newWorld(1), commander };
	const tier: Tier = {
		name: "typical",
		systems: 50,
		galaxies: 1,
		everyCarrier: false,
		knowledge: true,
		objective: false,
		deficitGoods: 4,
		witnesses: false,
		charges: false,
	};
	typical.world = buildSaveSizeWorld(tier).world;
	const saturated = { world: newWorld(1), commander: { ...commander } };
	saturated.world = buildSaveSizeWorld({
		...tier,
		name: "saturated",
		systems: 256,
		galaxies: 8,
		everyCarrier: true,
		objective: true,
		deficitGoods: 17,
		witnesses: true,
		charges: true,
	}).world;
	for (const [index, env] of saturated.world.galaxies.entries()) {
		env.fieldDiscoveries = Array.from(
			{ length: 256 },
			(_, i) => `${i}:field-01` as const,
		);
		saturated.commander.ladders = {
			...saturated.commander.ladders,
			visited: {
				...saturated.commander.ladders.visited,
				[index]: {
					systems: Array.from({ length: 256 }, (_, i) => i),
					stations: [...enumerateCarriers(1, index)]
						.filter((c) => c.kind === "station")
						.map((c) => c.key),
				},
			},
		};
	}
	saturated.commander.sweepReadings = saturated.world.galaxies.flatMap(
		(g, index) =>
			Array.from({ length: 256 }, (_, i) =>
				sweepSources(saturated.world, index, i),
			).flat(),
	);
	saturated.commander.txSeq = Number.MAX_SAFE_INTEGER - 2;
	const widest: CommodityAccount = {
		cash: signedMoney.fromTicks(money.maxTicks),
		bankedTrade: money.fromTicks(money.maxTicks),
		pools: Object.fromEntries(
			COMMODITIES.map((g) => [
				g.name,
				{
					totalMass: mass.fromTicks(mass.maxTicks),
					unknownMass: mass.fromTicks(mass.maxTicks),
					unrecoveredCost: money.fromTicks(money.maxTicks),
				},
			]),
		),
		basis: Object.fromEntries(
			COMMODITIES.map((g) => [
				g.name,
				{
					legacyCost: money.fromTicks(money.maxTicks),
					heldMass: mass.fromTicks(mass.maxTicks),
					knownMass: mass.fromTicks(mass.maxTicks),
					cost: money.fromTicks(money.maxTicks),
				},
			]),
		),
	};
	const structural: SaveEnvelope = {
		...saturated,
		world: {
			...saturated.world,
			galaxies: saturated.world.galaxies.map((g) => ({ ...g })),
		},
		commander: {
			...saturated.commander,
			state: withAccount(saturated.commander.state, widest),
		},
	};
	const death = deathWreckRow(
		{ ...structural.world, gameTime: 200000 },
		{ ...commander, state: withAccount(commander.state, account) },
		"destroyed",
	);
	if (death) {
		death.containers = COMMODITIES.map((g) => {
			const total = mass.fromTicks(mass.maxTicks);
			const amount = displayAmount(total, "mass", nativeGrams(g.name));
			return {
				kind: "good" as const,
				id: g.name,
				unit: g.unit,
				tonnes: amount,
				left: amount,
				ownedShare: encodeShare({
					totalMass: total,
					unknownMass: total,
					knownMass: mass.fromTicks(mass.maxTicks),
					cost: money.fromTicks(money.maxTicks),
				}),
			};
		});
		structural.world.gameTime = 200000;
		structural.world = withDeathWreck(structural.world, 0, death, 200000);
	}
	const legacy = serializeSave(typical) as any;
	delete legacy.commander.state.accounting;
	legacy.saveSchemaVersion = 19;
	const { integrity, ...body } = legacy;

	const migration = parseSave({
		...body,
		integrity: fnv1a(JSON.stringify(body)),
	});
	return [
		{ name: "migrated-save19", save: migration },
		{ name: "typical-50-systems", save: typical },
		{ name: "actual-generator-saturation", save: saturated },
		{ name: "structural-wide-accounting-and-recovery", save: structural },
	];
}
