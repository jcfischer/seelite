import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { carrierKey } from "../src/carrier-key";
import {
	accountOf,
	acquire,
	emptyAccount,
	withAccount,
	displayAmount,
	sell,
	migrateAccount,
	remove,
	recover,
	encodeAccount,
	parseAccount,
} from "../src/commodity-pools";
import { massFromNative, money, quoteFromNumber } from "../src/exact-amount";
import { readDeficit } from "../src/deficits";
import { deathWreckContents } from "../src/death-wreck";
import { holdSummary, pilotGoods } from "../src/hold";
import { holdBody } from "../src/hold-view";
import { TOP_RUNGS } from "../src/ladder";
import {
	COMMODITIES,
	CARGO_COMMODITIES,
	commodity,
	marketRow,
	marketRowAt,
	marketStationOf,
} from "../src/market";
import { ORE_GOODS, oreCargoName } from "../src/ore-goods";
import { cargoWeights, dropCanisters } from "../src/raider-wreck";
import { emptyRequests } from "../src/requests";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import {
	commanderHold,
	newCommander,
	scoopCargo,
	transactAtStation,
	type ConsoleInput,
} from "../src/station-commerce";
import { stationMarketScreen } from "../src/station-console";
import { newWorld, withDeathWreck } from "../src/world-state";
import { deathWreckRow } from "../src/death-wreck";
import { scoopWreckContainer } from "../src/derelict-salvage";
import { STOCK_SCOOP } from "../src/raider-wreck";
import { fnv1a } from "../src/rng";

const poor = "Metallic ore POOR";
const rich = "Metallic ore RICH";
const station = marketStationOf(
	{ type: "refinery", localCarrierId: "station-refinery", blackMarket: false },
	47,
);
const key = carrierKey(0, "station-refinery");
const input = (commander = newCommander("courier")): ConsoleInput => ({
	commander,
	station,
	stationKey: key,
	deficits: {},
	economy: 3,
	gameTimeMin: 0,
	displayTL: 8,
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 1 }),
	mining: true,
});
const screen = (i: ConsoleInput) =>
	stationMarketScreen({
		...i,
		holdT: commanderHold(i.commander, 0).capacityT,
		cargo: i.commander.cargo,
		deficitOf: (name) => readDeficit(i.deficits, key, name, i.gameTimeMin),
	});

test("fifteen whole-tonne cargo identities preserve the current Hold names and grades", () => {
	expect(ORE_GOODS).toHaveLength(15);
	expect(CARGO_COMMODITIES).toHaveLength(32);
	let commander = newCommander("courier");
	for (const [name, n] of [
		[poor, 2],
		[rich, 3],
		[poor, 1],
	] as const)
		commander = scoopCargo(commander, name, n, 0).commander;
	expect(commander.cargo).toEqual({ [poor]: 3, [rich]: 3 });
	expect(commanderHold(commander, 0).usedT).toBe(6);
	for (const n of [-1, 0.5, 1.5])
		expect(scoopCargo(commander, poor, n, 0).accepted).toBe(false);
	const hold = holdSummary(commander, emptyRequests());
	expect(pilotGoods(hold)).toEqual(commander.cargo);
	expect(holdBody(hold, new Map([[poor, 2]]))).toContain("sellable");
	expect(holdBody(hold, null)).not.toContain("no market yet");
	expect(oreCargoName("gold", "standard")).toBe("Gold-bearing ore STD");
});

test("the Longwall carries ore in its skips while ordinary ships share their hold", () => {
	let miner = scoopCargo(newCommander("miner"), poor, 3000, 0).commander;
	expect(miner.cargo[poor]).toBe(3000);
	expect(commanderHold(miner, 0).usedT).toBe(0);
	expect(scoopCargo(miner, rich, 1, 0).accepted).toBe(false);
	miner = scoopCargo(miner, "Food", 40, 0).commander;
	expect(commanderHold(miner, 0).usedT).toBe(40);
	expect(holdSummary(miner, emptyRequests()).oreBay?.usedT).toBe(3000);
	expect(scoopCargo(newCommander("courier"), poor, 21, 0).tonnes).toBe(20);
});

test("ore survives the save envelope and invalid quantities are refused without rounding", () => {
	const record = newCommanderRecord("miner");
	let state = record.state;
	for (const ore of ORE_GOODS)
		state = scoopCargo(state, ore.name, 2, 0).commander;
	const raw = serializeSave({
		world: newWorld(47),
		commander: { ...record, state },
	});
	expect(parseSave(raw).commander.state.cargo).toEqual(state.cargo);
	for (const amount of [-1, 0.5, 1.5]) {
		const bad = structuredClone(raw) as any;
		bad.commander.state.cargo[poor] = amount;
		const { integrity, ...body } = bad;
		expect(() =>
			parseSave({ ...body, integrity: fnv1a(JSON.stringify(body)) }),
		).toThrow();
	}
});

test("raw markets use the table, grade-specific stock memory, shelf cap and the printed price", () => {
	let i = input();
	const rows = screen(i).filter((r) => r.commodity.name.includes("ore"));
	expect(rows).toHaveLength(15);
	for (const ore of ORE_GOODS) {
		const row = marketRow(commodity(ore.name), 3, station, 0);
		const product = commodity(ore.product);
		const native = { t: 1e6, kg: 1000, g: 1 }[product.unit];
		expect(row.priceCr).toBeCloseTo(
			((marketRow(product, 3, station, 0).priceCr * ore.yieldGPerT) / native) *
				0.35,
			12,
		);
		expect(row.quantity).toBeGreaterThanOrEqual(8);
		expect(row.quantity).toBeLessThanOrEqual(63);
	}
	const buy = screen(i).find((r) => r.commodity.name === poor)!;
	if (!buy.listed) throw Error("ore not listed");
	const bought = transactAtStation({
		...i,
		action: { type: "buy-commodity", commodity: poor, quantity: 2 },
	});
	expect(bought.accepted).toBe(true);
	expect(bought.commander.credits).toBeCloseTo(
		i.commander.credits - buy.buyCr! * 2,
		10,
	);
	expect(readDeficit(bought.deficits, key, poor, 0)).toBe(2);
	expect(readDeficit(bought.deficits, key, rich, 0)).toBe(0);
	i = { ...i, commander: bought.commander, deficits: bought.deficits };
	const bid = screen(i).find((r) => r.commodity.name === poor)!;
	if (!bid.listed) throw Error("ore not listed");
	const sold = transactAtStation({
		...i,
		action: { type: "sell-commodity", commodity: poor, quantity: 2 },
	});
	expect(sold.accepted).toBe(true);
	expect(sold.commander.credits - i.commander.credits).toBeCloseTo(
		bid.sellCr! * 2,
		10,
	);
	expect(readDeficit(sold.deficits, key, poor, 0)).toBe(0);
	const mined = scoopCargo(newCommander("miner"), poor, 3000, 0).commander;
	const bulk = transactAtStation({
		...input(mined),
		action: { type: "sell-commodity", commodity: poor, quantity: 3000 },
	});
	expect(bulk.accepted).toBe(true);
	expect(
		screen({ ...input(bulk.commander), deficits: bulk.deficits }).find(
			(r) => r.commodity.name === poor,
		),
	).toMatchObject({ quantity: 63 });
	const off = { ...input(mined), mining: false };
	expect(screen(off)).toHaveLength(17);
	expect(off.commander.cargo[poor]).toBe(3000);
	expect(
		transactAtStation({
			...off,
			action: { type: "sell-commodity", commodity: poor },
		}).reason,
	).toBe("commodity-unavailable");
});

test("mined ore has known zero cost and raw sales recover the shared product debt", () => {
	const start = acquire(emptyAccount(100), "Alloys", 1, money.fromNumber(10));
	const commander = scoopCargo(
		withAccount(newCommander("courier"), start),
		rich,
		2,
		0,
	).commander;
	const a = accountOf(commander);
	expect(a.pools.Alloys.totalMass).toBe(massFromNative(2600000, 1));
	expect(a.pools.Alloys.unknownMass === 0n).toBe(true);
	expect(a.basis[rich].knownMass).toBe(massFromNative(2, 1000000));
	const sold = sell(a, rich, 2, quoteFromNumber(20));
	expect(displayAmount(sold.bankedTrade)).toBe(30);
	expect(displayAmount(sold.pools.Alloys.unrecoveredCost)).toBe(0);
	expect(sold.pools.Alloys.totalMass).toBe(massFromNative(1, 1000000));
	expect(
		parseSave(
			serializeSave({
				world: newWorld(47),
				commander: { ...newCommanderRecord("courier"), state: commander },
			}),
		).commander.state.cargo,
	).toEqual(commander.cargo);
});

test("death wrecks retain the actual ore identities and quantities", () => {
	let dying = newCommander("miner");
	for (const ore of ORE_GOODS)
		dying = scoopCargo(dying, ore.name, 7, 0).commander;
	const seen = new Set<string>();
	for (let at = 0; at < 100; at++)
		for (const c of deathWreckContents(47, at, dying, "destroyed")) {
			expect(c.tonnes).toBe(7);
			expect(c.left).toBe(7);
			expect(c.unit).toBe("t");
			seen.add(c.id);
		}
	expect(seen.size).toBe(15);
});

test("all ore grades use unknown-first product eligibility and exact partitioned raw proceeds", () => {
	for (const ore of ORE_GOODS) {
		const a = acquire(
			migrateAccount(100, 0, { [ore.product]: 0.125 }, {}),
			ore.name,
			10,
			money.fromNumber(13),
		);
		const bulk = sell(a, ore.name, 10, quoteFromNumber(3.7));
		let split = a;
		for (let i = 0; i < 10; i++)
			split = sell(split, ore.name, 1, quoteFromNumber(3.7));
		expect(split.cash).toBe(bulk.cash);
		expect(split.bankedTrade).toBe(bulk.bankedTrade);
		expect(split.pools).toEqual(bulk.pools);
		const lost = remove(a, ore.name, 3);
		const partial = recover(lost.account, ore.name, lost.share, 1);
		const restored = recover(
			partial.account,
			ore.name,
			partial.remaining,
			2,
		).account;
		expect(restored).toEqual(a);
		expect(parseAccount(encodeAccount(restored))).toEqual(a);
	}
});

test("an owned ore death wreck reloads and partially recovers into the dedicated bay", () => {
	const record = newCommanderRecord("miner");
	const dying = {
		...record,
		state: scoopCargo(record.state, rich, 7, 0).commander,
	};
	let world = newWorld(47);
	let wreck;
	for (let at = 1; at < 100; at++) {
		world = { ...world, gameTime: at };
		wreck = deathWreckRow(world, dying, "destroyed");
		if (wreck) break;
	}
	if (!wreck) throw Error("no surviving ore fixture");
	const emptied = withAccount(
		dying.state,
		remove(accountOf(dying.state), rich, 7).account,
	);
	const full = scoopCargo(emptied, poor, 2998, 0).commander;
	const loaded = parseSave(
		serializeSave({
			world: withDeathWreck(world, 0, wreck, world.gameTime),
			commander: { ...record, state: full },
		}),
	);
	const row = loaded.world.galaxies[0].deathWreck!;
	const pos = { x: 0, y: 0, z: 0 };
	const taken = scoopWreckContainer({
		row,
		index: 0,
		commander: loaded.commander.state,
		entrustedT: 0,
		container: { pos, vel: pos },
		ship: { pos, vel: pos },
		gear: STOCK_SCOOP,
		bankE: 10,
		at: world.gameTime,
	});
	expect(taken.tonnes).toBe(2);
	expect(taken.row.containers[0]).toMatchObject({
		id: rich,
		tonnes: 7,
		left: 5,
		unit: "t",
	});
	expect(taken.commander.cargo).toEqual({ [poor]: 2998, [rich]: 2 });
	expect(accountOf(taken.commander).pools.Alloys.unknownMass === 0n).toBe(true);
	expect(
		parseSave(
			serializeSave({
				world: withDeathWreck(
					world,
					0,
					{ ...row, ...taken.row },
					world.gameTime,
				),
				commander: { ...record, state: taken.commander },
			}),
		).commander.state.cargo,
	).toEqual(taken.commander.cargo);
});

test("schema20 remains readable and cannot claim schema21 ore", () => {
	const raw = serializeSave({
		world: newWorld(47),
		commander: newCommanderRecord("courier"),
	});
	const legacy = { ...raw, saveSchemaVersion: 20 };
	const { integrity, ...body } = legacy;
	expect(
		parseSave({ ...body, integrity: fnv1a(JSON.stringify(body)) }).commander
			.state.cargo,
	).toEqual({});
	const withOre = serializeSave({
		world: newWorld(47),
		commander: {
			...newCommanderRecord("courier"),
			state: scoopCargo(newCommander("courier"), poor, 1, 0).commander,
		},
	});
	const { integrity: previous, ...oreBody } = {
		...withOre,
		saveSchemaVersion: 20,
	};
	expect(() =>
		parseSave({ ...oreBody, integrity: fnv1a(JSON.stringify(oreBody)) }),
	).toThrow("schema 21");
});

test("base 6398a3ab commodity and seeded market/raider fingerprint is unchanged", () => {
	const hash = createHash("sha256");
	const add = (v: unknown) => hash.update(JSON.stringify(v));
	add(COMMODITIES);
	for (const good of COMMODITIES)
		for (let e = 0; e < 8; e++)
			for (let f = 0; f < 256; f++)
				for (const s of ["trade", "refinery", "shipyard"] as const)
					add(marketRowAt(good, e, f, s));
	for (let g = 0; g < 8; g++) {
		add(cargoWeights(g));
		for (let seed = 0; seed < 128; seed++)
			add(
				dropCanisters({
					systemSeed: seed,
					government: g,
					key: carrierKey(0, "raider-0"),
					killedAt: 100,
					pos: { x: 0, y: 0, z: 0 },
					vel: { x: 1, y: 2, z: 3 },
					frameVel: { x: 0, y: 0, z: 0 },
					frameBodyId: null,
				}),
			);
	}
	expect(hash.digest("hex")).toBe(
		"1eba4db853d94252c2857af49edfab6a4108a14a00e925c9ca94e872563922fb",
	);
	for (let g = 0; g < 8; g++)
		expect(cargoWeights(g).some(({ good }) => good.name.includes("ore"))).toBe(
			false,
		);
});
