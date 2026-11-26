import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import {
	type Holdings,
	applyHoldEvent,
	commanderAfterDeath,
} from "../src/holdings";
import { legalStandingAt } from "../src/legal";
import { emptyLadderRecord, emptyPending } from "../src/ladder";
import { npcLoadout } from "../src/npc-loadout";
import {
	awardRaiderKill,
	bankRaiderCash,
	emptyRaiderCash,
	isPaidKey,
	isRaiderSlotKey,
	paidKey,
	raiderKillPayCr,
} from "../src/raider-cash";
import { raiderDestruction } from "../src/raider-wreck";
import { RAIDER_HULL_ID } from "../src/raider-slots";
import { emptyRequests } from "../src/requests";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { newCommander } from "../src/station-commerce";
import { newWorld } from "../src/world-state";
import { impactCause } from "../src/traffic-engagement";

const KEY = carrierKey(3, "raider-00");
const SEED = 0x5ee11e;

const holdings = (): Holdings => ({
	commander: newCommander(PLAYER_BASELINE_HULL),
	requests: emptyRequests(),
	ladders: emptyLadderRecord(),
	ladderPending: emptyPending(),
});

interface KillOptions {
	world?: ReturnType<typeof newWorld>;
	seed?: number;
	at?: number;
	key?: typeof KEY;
	hull?: typeof RAIDER_HULL_ID | "patrol";
	cause?: Parameters<typeof raiderDestruction>[2];
}

const kill = (h: Holdings, o: KillOptions = {}) => {
	const hull = o.hull ?? RAIDER_HULL_ID;
	return applyHoldEvent(h, o.world ?? newWorld(SEED), {
		kind: "carrier",
		galaxyIndex: 0,
		key: o.key ?? KEY,
		transition: raiderDestruction(3, o.at ?? 5_000, o.cause),
		hull,
		targetLoadout: npcLoadout(hull, o.seed ?? 234),
	});
};

const dock = (h: Holdings, world = newWorld(SEED)) =>
	applyHoldEvent(h, world, {
		kind: "dock",
		galaxyIndex: 0,
		station: carrierKey(3, "station-trade"),
		at: 6_000,
	});

describe("raider cash bounty (node #1338)", () => {
	test("ordinary seeded fits price at 125, 295 and 426 Cr", () => {
		const price = (seed: number) =>
			raiderKillPayCr({
				hull: RAIDER_HULL_ID,
				loadout: npcLoadout(RAIDER_HULL_ID, seed),
			});
		expect([906, 98, 234].map(price)).toEqual([125, 295, 426]);
	});

	test("a slot ordinal past the roster pays nothing", () => {
		const out = kill(holdings(), { key: carrierKey(3, "raider-999") });
		expect(out.holdings.commander.raiderCash?.pendingCr ?? 0).toBe(0);
	});

	test("a kill is pending, then banks once on dock, and re-docking adds zero", () => {
		const out = kill(holdings());
		expect(out.holdings.commander.credits).toBe(holdings().commander.credits);
		expect(out.holdings.commander.raiderCash?.pendingCr).toBe(426);
		expect(out.signals.raiderCash).toEqual({ earnedCr: 426, pendingCr: 426 });
		const docked = dock(out.holdings, out.world);
		expect(docked.holdings.commander.credits).toBe(
			holdings().commander.credits + 426,
		);
		expect(docked.holdings.commander.raiderCash?.pendingCr).toBe(0);
		const again = dock(docked.holdings, docked.world);
		expect(again.holdings.commander.credits).toBe(
			docked.holdings.commander.credits,
		);
	});

	test("pilot standing, damage and trading rating do not move the price", () => {
		const base = kill(holdings(), { seed: 98 }).holdings.commander.raiderCash;
		const h = holdings();
		const variants: Holdings[] = [
			{ ...h, commander: { ...h.commander, credits: 1 } },
			{
				...h,
				ladders: {
					...h.ladders,
					rungs: { combat: 5, trade: 5, exploration: 5 },
				} as never,
			},
		];
		for (const v of variants)
			expect(kill(v, { seed: 98 }).holdings.commander.raiderCash).toEqual(base);
		const wanted = newWorld(SEED);
		wanted.galaxies[0].legalStatus = {
			...wanted.galaxies[0].legalStatus,
			heat: 30,
			updatedAt: 5_000,
		};
		expect(legalStandingAt(wanted.galaxies[0].legalStatus, 5_000)).toBe(
			"wanted",
		);
		expect(
			kill(h, { seed: 98, world: wanted }).holdings.commander.raiderCash,
		).toEqual(base);
		expect(base?.pendingCr).toBe(295);
	});

	test("the same slot in another galaxy pays its own first kill", () => {
		const first = kill(holdings());
		const second = applyHoldEvent(first.holdings, first.world, {
			kind: "carrier",
			galaxyIndex: 1,
			key: KEY,
			transition: raiderDestruction(3, 5_000),
			hull: RAIDER_HULL_ID,
			targetLoadout: npcLoadout(RAIDER_HULL_ID, 234),
		});
		expect(second.holdings.commander.raiderCash?.pendingCr).toBe(852);
	});

	test("a duplicate event pays once; a replacement in the same slot pays again", () => {
		const first = kill(holdings());
		const dup = kill(first.holdings);
		expect(dup.holdings.commander.raiderCash?.pendingCr).toBe(426);
		const ev = raiderDestruction(3, 5_000);
		const completes =
			ev.kind === "destroy" && ev.schedule ? ev.schedule.completesAt : 0;
		const later = kill(first.holdings, {
			world: first.world,
			seed: 906,
			at: completes + 10,
		});
		expect(later.holdings.commander.raiderCash?.pendingCr).toBe(426 + 125);
	});

	test("an armed trader, another actor's kill and a hull-less relay yield zero", () => {
		const trader = kill(holdings(), {
			key: carrierKey(3, "traffic-00"),
			hull: "patrol",
		});
		expect(trader.holdings.commander.raiderCash).toBeUndefined();
		const other = kill(holdings(), { cause: impactCause("station-trade") });
		expect(other.holdings.commander.raiderCash).toBeUndefined();
		const relay = applyHoldEvent(holdings(), newWorld(SEED), {
			kind: "carrier",
			galaxyIndex: 0,
			key: carrierKey(3, "relay-00"),
			transition: raiderDestruction(3, 5_000),
			hull: null,
		});
		expect(relay.holdings.commander.raiderCash).toBeUndefined();
	});

	test("the award and its pending total survive a reload and never pay twice", () => {
		const out = kill(holdings());
		const record = {
			...newCommanderRecord("courier"),
			state: out.holdings.commander,
		};
		const saved = parseSave(
			serializeSave({ world: out.world, commander: record }),
		);
		expect(saved.commander.state.raiderCash).toEqual({
			pendingCr: 426,
			awarded: { [`0/${KEY}`]: 0 },
		});
		const reloaded = { ...out.holdings, commander: saved.commander.state };
		const dup = kill(reloaded);
		expect(dup.holdings.commander.raiderCash?.pendingCr).toBe(426);
		const docked = dock(reloaded, saved.world);
		const record2 = {
			...record,
			state: docked.holdings.commander,
		};
		const again = parseSave(
			serializeSave({ world: docked.world, commander: record2 }),
		);
		const redock = dock(
			{ ...docked.holdings, commander: again.commander.state },
			again.world,
		);
		expect(redock.holdings.commander.credits).toBe(
			docked.holdings.commander.credits,
		);
	});

	test("an older save loads with nothing pending", () => {
		const record = newCommanderRecord("courier");
		const saved = parseSave(
			serializeSave({ world: newWorld(SEED), commander: record }),
		);
		expect(saved.commander.state.raiderCash).toBeUndefined();
	});

	test("death before docking forfeits the pending cash", () => {
		const dockRecord = newCommanderRecord("courier");
		const out = kill({ ...holdings(), commander: dockRecord.state });
		const dying = { ...dockRecord, state: out.holdings.commander };
		const after = commanderAfterDeath(dockRecord, dying, "destroyed");
		expect(after.state.raiderCash).toBeUndefined();
		const ejected = commanderAfterDeath(dockRecord, dying, "eject");
		expect(ejected.state.credits).toBe(dockRecord.state.credits);
		expect(ejected.state.raiderCash).toBeUndefined();
	});
});

describe("raider cash keys (node #1338)", () => {
	test("a paid key is a galaxy index, a slash and a carrier key", () => {
		expect(isPaidKey(paidKey(0, KEY))).toBe(true);
		expect(isPaidKey(paidKey(12, KEY))).toBe(true);
		for (const bad of [
			`/${KEY}`,
			`x/${KEY}`,
			`1x/${KEY}`,
			`x1/${KEY}`,
			String(KEY),
			"0/raider-00",
			"0/",
			`0/${KEY}\n`,
		])
			expect(isPaidKey(bad)).toBe(false);
	});

	test("only the roster's raider slots are raider slot keys", () => {
		for (const ordinal of [0, 1, 2, 3])
			expect(isRaiderSlotKey(carrierKey(13, `raider-0${ordinal}`))).toBe(true);
		for (const bad of [
			"raider-04",
			"raider-0",
			"xraider-00",
			"raider-00x",
			"raider-00\n",
		])
			expect(isRaiderSlotKey(carrierKey(3, bad))).toBe(false);
		expect(isRaiderSlotKey("x3:raider-00" as typeof KEY)).toBe(false);
		expect(isRaiderSlotKey("raider-00" as typeof KEY)).toBe(false);
	});

	test("awarding twice for one instance changes nothing, banking nothing changes nothing", () => {
		const c = newCommander(PLAYER_BASELINE_HULL);
		const first = awardRaiderKill(c, 0, KEY, 0, 50);
		expect(first.earnedCr).toBe(50);
		const dup = awardRaiderKill(first.commander, 0, KEY, 0, 50);
		expect(dup).toEqual({ commander: first.commander, earnedCr: 0 });
		const next = awardRaiderKill(first.commander, 0, KEY, 1, 7);
		expect(next.earnedCr).toBe(7);
		expect(next.commander.raiderCash?.pendingCr).toBe(57);
		const high = awardRaiderKill(c, 0, KEY, 2, 9).commander;
		expect(awardRaiderKill(high, 0, KEY, 2, 9).earnedCr).toBe(0);
		expect(awardRaiderKill(high, 0, KEY, 1, 9).earnedCr).toBe(0);
		expect(bankRaiderCash(c)).toBe(c);
		const empty = { ...c, raiderCash: emptyRaiderCash() };
		expect(bankRaiderCash(empty)).toBe(empty);
	});
});
