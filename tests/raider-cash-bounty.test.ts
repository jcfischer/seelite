import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import {
	type Holdings,
	applyHoldEvent,
	commanderAfterDeath,
} from "../src/holdings";
import { emptyLadderRecord, emptyPending } from "../src/ladder";
import { npcLoadout } from "../src/npc-loadout";
import { raiderBountyCr } from "../src/raider-cash";
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
			raiderBountyCr({
				hull: RAIDER_HULL_ID,
				loadout: npcLoadout(RAIDER_HULL_ID, seed),
			});
		expect([906, 98, 234].map(price)).toEqual([125, 295, 426]);
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
		const weak = kill(holdings(), { seed: 906 });
		expect(weak.holdings.commander.raiderCash?.pendingCr).toBe(125);
		const strong = kill(holdings(), { seed: 98 });
		expect(strong.holdings.commander.raiderCash?.pendingCr).toBe(295);
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
			key: carrierKey(3, "relay"),
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
			awarded: { [KEY]: 0 },
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
