import { describe, expect, test } from "bun:test";
import {
	HEAT_CAP,
	HEAT_HALF_LIFE_S,
	OFFENCE_HEAT,
	WANTED_HEAT,
	FUGITIVE_HEAT,
	dockingRefusedByLaw,
	heatAt,
	legalStandingAt,
	legalStandingOf,
	offenceHeat,
	offenceRank,
	OFFENCE_LADDER,
	assaultCharged,
	settleIncident,
	stationHostile,
	chargeOffence,
	type Offence,
	type OffenceFacts,
	type Standing,
} from "../src/legal";
import { STANDING_ROTATION_S, carrierStanding } from "../src/carrier-standing";
import { DISTRESS_RANGE_KM, type EarshotStation } from "../src/distress";
import { type Vec3, v3 } from "../src/vec3";
import { type WorldState, newWorld } from "../src/world-state";
import { type LegalStatus } from "../src/world-state";
import { type StationType } from "../src/station";
import {
	type CarrierKey,
	carrierKey,
	compareCarrierKeys,
} from "../src/carrier-key";

const MIN = 60;
const HOME_SYSTEM = 3;
const NEIGHBOUR_SYSTEM = 4;
const ONE_FRAME_S = 1 / 60;

const law = (
	heat: number,
	updatedAt = 0,
	witnesses: CarrierKey[] = [],
	assaulted: CarrierKey[] = [],
): LegalStatus => ({ heat, updatedAt, witnesses, assaulted });

const TRADE = carrierKey(HOME_SYSTEM, "station-trade");
const YARD = carrierKey(HOME_SYSTEM, "station-shipyard");
const OTHER = carrierKey(NEIGHBOUR_SYSTEM, "station-refinery");
const MINER = carrierKey(HOME_SYSTEM, "carrier-miner");
const FREIGHTER = carrierKey(HOME_SYSTEM, "carrier-freighter");

const berth = (key: CarrierKey, type: StationType) => ({ key, type });

const minutesAbove = (heat: number, threshold: number) => {
	let t = 0;
	while (heatAt(law(heat), t) >= threshold) t += 1;
	return t / MIN;
};

const SYSTEM_SEED = 0x5ee11e;

const instanceOf = (
	key: CarrierKey,
	wanted: [Standing, number][],
	matchIndex = 0,
): number => {
	let found = 0;
	for (let ordinal = 0; ordinal < 5000; ordinal++)
		if (
			wanted.every(
				([standing, at]) =>
					carrierStanding(SYSTEM_SEED, key, ordinal, at) === standing,
			) &&
			found++ === matchIndex
		)
			return ordinal;
	throw new Error(`no instance of ${key} reads ${JSON.stringify(wanted)}`);
};
const minerInstanceWith = (...wanted: [Standing, number][]): number =>
	instanceOf(MINER, wanted);

const near = (
	key: CarrierKey,
	type: StationType = "trade",
): EarshotStation => ({
	key,
	pos: v3(DISTRESS_RANGE_KM / 2, 0, 0),
	type,
});
const far = (key: CarrierKey): EarshotStation => ({
	key,
	pos: v3(DISTRESS_RANGE_KM * 2, 0, 0),
	type: "trade",
});

const facts = (
	offence: Offence,
	{
		now = 0,
		galaxy = 0,
		key = MINER,
		instanceOrdinal = 0,
		struckAt = null,
		victim = v3(),
		stations = [],
	}: {
		now?: number;
		galaxy?: number;
		key?: CarrierKey;
		instanceOrdinal?: number;
		struckAt?: number | null;
		victim?: Vec3;
		stations?: EarshotStation[];
	} = {},
): OffenceFacts => ({
	offence,
	galaxy,
	now,
	systemSeed: SYSTEM_SEED,
	carrier: { key, instanceOrdinal, struckAt },
	victim,
	stations,
});

const charged = (
	world: WorldState,
	...args: Parameters<typeof facts>
): WorldState => chargeOffence(world, facts(...args)).world;

describe("the scale", () => {
	test("is H4's: kill 40, strike 15, sustained fire 13, Wanted at 10, Fugitive at 60, cap 100", () => {
		expect(OFFENCE_HEAT).toEqual({ assault: 13, struck: 15, destroyed: 40 });
		expect(WANTED_HEAT).toBe(10);
		expect(FUGITIVE_HEAT).toBe(60);
		expect(HEAT_CAP).toBe(100);
		expect(HEAT_HALF_LIFE_S).toBe(30 * MIN);
	});

	test("holds the sustained-fire rung strictly above Wanted and strictly below the strike", () => {
		expect(OFFENCE_HEAT.assault).toBeGreaterThan(WANTED_HEAT);
		expect(OFFENCE_HEAT.assault).toBeLessThan(OFFENCE_HEAT.struck);
	});

	test("keeps the three rungs ordered by heat, so the ladder and the price agree", () => {
		expect(offenceRank("assault")).toBeLessThan(offenceRank("struck"));
		expect(offenceRank("struck")).toBeLessThan(offenceRank("destroyed"));
		expect(offenceHeat("clean", "assault")).toBeLessThan(
			offenceHeat("clean", "struck"),
		);
		expect(offenceHeat("clean", "struck")).toBeLessThan(
			offenceHeat("clean", "destroyed"),
		);
	});

	test("reads standing at the thresholds", () => {
		expect(legalStandingOf(0)).toBe("clean");
		expect(legalStandingOf(9.999)).toBe("clean");
		expect(legalStandingOf(10)).toBe("wanted");
		expect(legalStandingOf(59.999)).toBe("wanted");
		expect(legalStandingOf(60)).toBe("fugitive");
	});
});

describe("an offence is judged on the target's true standing (F7)", () => {
	test("a Clean target costs heat, a Wanted or Fugitive one does not", () => {
		expect(offenceHeat("clean", "destroyed")).toBe(40);
		expect(offenceHeat("clean", "struck")).toBe(15);
		for (const standing of ["wanted", "fugitive"] as const) {
			expect(offenceHeat(standing, "destroyed")).toBe(0);
			expect(offenceHeat(standing, "struck")).toBe(0);
		}
	});
});

describe("H9: one incident costs its largest offence, not their sum", () => {
	const CLEAN = minerInstanceWith(["clean", 0]);

	const chargeTwiceOnOneClock = (first: Offence, second: Offence) => {
		const one = chargeOffence(
			newWorld(7),
			facts(first, { instanceOrdinal: CLEAN }),
		);
		const two = chargeOffence(
			one.world,
			facts(second, {
				instanceOrdinal: CLEAN,
				struckAt: first === "struck" ? 0 : null,
			}),
		);
		return {
			first: one.heat,
			second: two.heat,
			total: two.world.galaxies[0].legalStatus.heat,
		};
	};

	test("an offence already covered by the incident adds nothing", () => {
		expect(chargeTwiceOnOneClock("struck", "struck").second).toBe(0);
		expect(chargeTwiceOnOneClock("assault", "assault").second).toBe(0);
		expect(chargeTwiceOnOneClock("struck", "assault").second).toBe(0);
	});

	const PAIRS_AS_H4_PRINTS_THEM: [Offence, Offence, number, number][] = [
		["assault", "assault", 0, 13],
		["assault", "struck", 2, 15],
		["assault", "destroyed", 27, 40],
		["struck", "assault", 0, 15],
		["struck", "struck", 0, 15],
		["struck", "destroyed", 25, 40],
	];

	test.each(PAIRS_AS_H4_PRINTS_THEM)(
		"%s then %s adds %d and the incident costs %d, never the sum",
		(first, second, adds, total) => {
			const paid = chargeTwiceOnOneClock(first, second);
			expect(paid.second).toBe(adds);
			expect(paid.total).toBe(total);
		},
	);

	test("the whole ladder, as the three legs a pilot actually walks", () => {
		const clean = minerInstanceWith(["clean", 0], ["clean", 10], ["clean", 20]);
		const assault = chargeOffence(
			newWorld(7),
			facts("assault", { instanceOrdinal: clean }),
		);
		const strike = chargeOffence(
			assault.world,
			facts("struck", { instanceOrdinal: clean, now: 10 }),
		);
		const kill = chargeOffence(
			strike.world,
			facts("destroyed", { instanceOrdinal: clean, now: 20, struckAt: 10 }),
		);
		expect([assault.heat, strike.heat, kill.heat]).toEqual([13, 2, 25]);
		expect(kill.world.galaxies[0].legalStatus.heat).toBeCloseTo(40, 0);
	});

	test("a lawful target costs nothing whatever the incident carries", () => {
		const later = STANDING_ROTATION_S;
		for (const standing of ["wanted", "fugitive"] as const) {
			const turned = minerInstanceWith(["clean", 0], [standing, later]);
			const marked = charged(newWorld(7), "assault", {
				instanceOrdinal: turned,
			});
			for (const offence of OFFENCE_LADDER)
				for (const [world, struckAt] of [
					[newWorld(7), null],
					[newWorld(7), 0],
					[marked, null],
				] as const)
					expect(
						chargeOffence(
							world,
							facts(offence, { instanceOrdinal: turned, now: later, struckAt }),
						).heat,
					).toBe(0);
		}
	});
});

describe("decay", () => {
	test("halves every thirty minutes of game clock", () => {
		const status = law(80, 1000);
		expect(heatAt(status, 1000)).toBe(80);
		expect(heatAt(status, 1000 + HEAT_HALF_LIFE_S)).toBeCloseTo(40, 9);
		expect(heatAt(status, 1000 + 2 * HEAT_HALF_LIFE_S)).toBeCloseTo(20, 9);
	});

	test("never runs backwards before its stamp", () => {
		expect(heatAt(law(40, 500), 100)).toBe(40);
	});

	test("steps back through the states", () => {
		const status = law(80);
		expect(legalStandingAt(status, 0)).toBe("fugitive");
		expect(legalStandingAt(status, 20 * MIN)).toBe("wanted");
		expect(legalStandingAt(status, 100 * MIN)).toBe("clean");
	});
});

describe("what a pilot meets (H4's durations, derived rather than restated)", () => {
	test("one Clean kill is about an hour Wanted", () => {
		expect(minutesAbove(40, WANTED_HEAT)).toBeCloseTo(60, 0);
	});

	test("two in quick succession are briefly Fugitive and Clean after ninety minutes", () => {
		expect(minutesAbove(80, FUGITIVE_HEAT)).toBeGreaterThan(12);
		expect(minutesAbove(80, FUGITIVE_HEAT)).toBeLessThan(13);
		expect(minutesAbove(80, WANTED_HEAT)).toBeCloseTo(90, 0);
	});

	test("a strike alone is about seventeen minutes Wanted", () => {
		expect(minutesAbove(15, WANTED_HEAT)).toBeGreaterThan(17);
		expect(minutesAbove(15, WANTED_HEAT)).toBeLessThan(18);
	});
});

describe("the write", () => {
	test("adds the offence to the decayed heat and stamps it now", () => {
		const first = instanceOf(MINER, [["clean", 0]]);
		const second = instanceOf(FREIGHTER, [["clean", HEAT_HALF_LIFE_S]]);
		let world = charged(newWorld(7), "destroyed", { instanceOrdinal: first });
		expect(world.galaxies[0].legalStatus).toMatchObject({
			heat: 40,
			updatedAt: 0,
		});
		world = charged(world, "destroyed", {
			key: FREIGHTER,
			instanceOrdinal: second,
			now: HEAT_HALF_LIFE_S,
		});
		expect(world.galaxies[0].legalStatus.heat).toBeCloseTo(60, 9);
		expect(world.galaxies[0].legalStatus.updatedAt).toBe(HEAT_HALF_LIFE_S);
	});

	test("is capped", () => {
		const threeCleanMiners = [0, 1, 2].map((matchIndex) =>
			instanceOf(MINER, [["clean", 0]], matchIndex),
		);
		let world = newWorld(7);
		for (const instanceOrdinal of threeCleanMiners)
			world = charged(world, "destroyed", { instanceOrdinal });
		expect(world.galaxies[0].legalStatus.heat).toBe(HEAT_CAP);
	});

	test("lands in the galaxy it happened in", () => {
		const world = charged(newWorld(7), "destroyed", {
			galaxy: 3,
			instanceOrdinal: minerInstanceWith(["clean", 0]),
			stations: [near(TRADE)],
		});
		expect(world.galaxies[3].legalStatus.heat).toBe(40);
		expect(world.galaxies[3].legalStatus.witnesses).toEqual([TRADE]);
		expect(world.galaxies[0].legalStatus.heat).toBe(0);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([]);
	});

	test("leaves the witness list alone when it writes heat alone", () => {
		let world = charged(newWorld(7), "destroyed", {
			instanceOrdinal: instanceOf(MINER, [["clean", 0]]),
			stations: [near(TRADE)],
		});
		world = charged(world, "destroyed", {
			key: FREIGHTER,
			instanceOrdinal: instanceOf(FREIGHTER, [["clean", 60]]),
			now: 60,
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});
});

describe("H5, as #396 amended it: a station in the victim's earshot heard it", () => {
	const CLEAN = minerInstanceWith(["clean", 0], ["clean", 60]);

	test("a station inside the earshot is filed, and one outside it is not", () => {
		const world = charged(newWorld(7), "destroyed", {
			instanceOrdinal: CLEAN,
			stations: [near(TRADE), far(YARD)],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});

	test("the earshot is measured from the victim, not from the origin of anything else", () => {
		const world = charged(newWorld(7), "destroyed", {
			instanceOrdinal: CLEAN,
			victim: v3(DISTRESS_RANGE_KM * 2, 0, 0),
			stations: [near(TRADE), far(YARD)],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([YARD]);
	});

	test("two stations that each heard one are both held", () => {
		let world = charged(newWorld(7), "assault", {
			instanceOrdinal: CLEAN,
			stations: [near(TRADE)],
		});
		world = charged(world, "struck", {
			instanceOrdinal: CLEAN,
			now: 60,
			stations: [near(YARD)],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual(
			[TRADE, YARD].sort(compareCarrierKeys),
		);
	});

	test("the list is held in canonical order, not in offence order", () => {
		let world = charged(newWorld(7), "assault", {
			instanceOrdinal: CLEAN,
			stations: [near(OTHER)],
		});
		world = charged(world, "struck", {
			instanceOrdinal: CLEAN,
			now: 60,
			stations: [near(TRADE)],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual(
			[OTHER, TRADE].sort(compareCarrierKeys),
		);
	});
});

describe("H5: a witnessed station is hostile while the pilot is Wanted", () => {
	test("hostile at Wanted and open again once heat decays below it", () => {
		const written = charged(newWorld(7), "destroyed", {
			instanceOrdinal: minerInstanceWith(["clean", 0]),
			stations: [near(TRADE)],
		});
		const status = written.galaxies[0].legalStatus;
		expect(stationHostile(status, TRADE, 0)).toBe(true);
		expect(stationHostile(status, TRADE, 59 * MIN)).toBe(true);
		expect(
			stationHostile(status, TRADE, minutesAbove(40, WANTED_HEAT) * MIN),
		).toBe(false);
	});

	test("witnessed and Clean is not hostile", () => {
		expect(stationHostile(law(0, 0, [TRADE]), TRADE, 0)).toBe(false);
	});

	test("heat alone makes no station hostile", () => {
		expect(stationHostile(law(HEAT_CAP), TRADE, 0)).toBe(false);
	});

	test("one station's witness is not another's", () => {
		const status = law(40, 0, [TRADE]);
		expect(stationHostile(status, OTHER, 0)).toBe(false);
	});
});

describe("H7: a shipyard refuses a Wanted pilot whatever it saw", () => {
	test("refused at Wanted, admitted below it, with no witness held", () => {
		const status = law(40, 0);
		expect(dockingRefusedByLaw(status, berth(YARD, "shipyard"), 0)).toBe(true);
		expect(dockingRefusedByLaw(status, berth(YARD, "shipyard"), 61 * MIN)).toBe(
			false,
		);
	});

	test("a trade station and a refinery refuse only what they saw", () => {
		const wanted = law(40, 0);
		for (const type of ["trade", "refinery"] as const) {
			expect(dockingRefusedByLaw(wanted, berth(YARD, type), 0)).toBe(false);
			expect(
				dockingRefusedByLaw(law(40, 0, [YARD]), berth(YARD, type), 0),
			).toBe(true);
		}
	});

	test("a witnessed shipyard is refused on either reason, and below Wanted on neither", () => {
		expect(
			dockingRefusedByLaw(law(40, 0, [YARD]), berth(YARD, "shipyard"), 0),
		).toBe(true);
		expect(
			dockingRefusedByLaw(
				law(40, 0, [YARD]),
				berth(YARD, "shipyard"),
				minutesAbove(40, WANTED_HEAT) * MIN,
			),
		).toBe(false);
	});

	test("the refusal is spoken for the station's own key, not any shipyard", () => {
		const witnessed = law(40, 0, [TRADE]);
		expect(dockingRefusedByLaw(witnessed, berth(TRADE, "trade"), 0)).toBe(true);
		expect(dockingRefusedByLaw(witnessed, berth(OTHER, "refinery"), 0)).toBe(
			false,
		);
	});
});

describe("#490 D5: a raider outpost admits only a Wanted pilot (node #491)", () => {
	const OUTPOST = carrierKey(HOME_SYSTEM, "station-outpost");

	test("refused below Wanted, admitted at it, and refused again once it decays", () => {
		expect(dockingRefusedByLaw(law(0), berth(OUTPOST, "outpost"), 0)).toBe(
			true,
		);
		const wanted = law(40, 0);
		expect(dockingRefusedByLaw(wanted, berth(OUTPOST, "outpost"), 0)).toBe(
			false,
		);
		expect(
			dockingRefusedByLaw(
				wanted,
				berth(OUTPOST, "outpost"),
				minutesAbove(40, WANTED_HEAT) * MIN,
			),
		).toBe(true);
	});

	test("a witness entry does not refuse a Wanted pilot there", () => {
		expect(
			dockingRefusedByLaw(law(40, 0, [OUTPOST]), berth(OUTPOST, "outpost"), 0),
		).toBe(false);
	});

	test("an offence beside an outpost files nothing", () => {
		const world = charged(newWorld(7), "destroyed", {
			galaxy: 0,
			instanceOrdinal: minerInstanceWith(["clean", 0]),
			stations: [near(OUTPOST, "outpost")],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([]);
	});
});

describe("H6: the list is cleared when heat reads below Wanted", () => {
	const killBeside = (world: WorldState, galaxy: number, station: CarrierKey) =>
		charged(world, "destroyed", {
			galaxy,
			instanceOrdinal: minerInstanceWith(["clean", 0]),
			stations: [near(station)],
		});

	test("a read below Wanted drops every witness", () => {
		const written = killBeside(newWorld(7), 0, TRADE);
		const settled = settleIncident(
			written,
			0,
			minutesAbove(40, WANTED_HEAT) * MIN,
		);
		expect(settled.galaxies[0].legalStatus.witnesses).toEqual([]);
	});

	test("a read at or above Wanted keeps them", () => {
		const written = killBeside(newWorld(7), 0, TRADE);
		const kept = settleIncident(written, 0, 0);
		expect(kept).toBe(written);
		expect(kept.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});

	test("clearing nothing returns the same world", () => {
		const world = newWorld(7);
		expect(settleIncident(world, 0, 1e6)).toBe(world);
	});

	test("clearing one galaxy leaves the others' witnesses alone", () => {
		const world = killBeside(killBeside(newWorld(7), 2, TRADE), 3, OTHER);
		const settled = settleIncident(world, 2, 61 * MIN);
		expect(settled.galaxies[2].legalStatus.witnesses).toEqual([]);
		expect(settled.galaxies[3].legalStatus.witnesses).toEqual([OTHER]);
	});
});

describe("H4's sustained-fire rung (#396)", () => {
	test("the charge crosses Wanted and stays there for the duration decay gives it", () => {
		const above = minutesAbove(OFFENCE_HEAT.assault, WANTED_HEAT);
		expect(above).toBeGreaterThan(0);
		expect(legalStandingAt(law(OFFENCE_HEAT.assault), 0)).toBe("wanted");
		expect(legalStandingAt(law(OFFENCE_HEAT.assault), above * MIN * 0.99)).toBe(
			"wanted",
		);
		expect(legalStandingAt(law(OFFENCE_HEAT.assault), above * MIN * 1.01)).toBe(
			"clean",
		);
		expect(heatAt(law(OFFENCE_HEAT.assault), ONE_FRAME_S)).toBeLessThan(
			OFFENCE_HEAT.assault,
		);
		expect(
			heatAt(law(OFFENCE_HEAT.assault), ONE_FRAME_S),
		).toBeGreaterThanOrEqual(WANTED_HEAT);
	});

	test("the charge is held per carrier and per galaxy", () => {
		const clean = minerInstanceWith(["clean", 0]);
		let world = charged(newWorld(7), "assault", { instanceOrdinal: clean });
		world = charged(world, "assault", { galaxy: 3, instanceOrdinal: clean });
		expect(assaultCharged(world.galaxies[0].legalStatus, MINER)).toBe(true);
		expect(assaultCharged(world.galaxies[3].legalStatus, MINER)).toBe(true);
		expect(assaultCharged(world.galaxies[0].legalStatus, FREIGHTER)).toBe(
			false,
		);
		expect(assaultCharged(world.galaxies[1].legalStatus, MINER)).toBe(false);
	});

	test("the incident ends when the heat does: one clear takes both lists", () => {
		const ended = minutesAbove(OFFENCE_HEAT.assault, WANTED_HEAT) * MIN;
		const clean = minerInstanceWith(["clean", 0], ["clean", ended]);
		const world = charged(newWorld(7), "assault", {
			instanceOrdinal: clean,
			stations: [near(TRADE)],
		});
		const still = settleIncident(world, 0, 0);
		expect(still).toBe(world);
		const settled = settleIncident(world, 0, ended);
		expect(settled.galaxies[0].legalStatus.witnesses).toEqual([]);
		expect(settled.galaxies[0].legalStatus.assaulted).toEqual([]);
		expect(assaultCharged(settled.galaxies[0].legalStatus, MINER)).toBe(false);
		expect(
			chargeOffence(
				settled,
				facts("assault", { instanceOrdinal: clean, now: ended }),
			).heat,
		).toBe(13);
	});
});

describe("the hearer list is computed, never assumed", () => {
	test("an empty list is an answer, and writes nothing", () => {
		const world = newWorld(7);
		expect(
			chargeOffence(
				world,
				facts("destroyed", {
					instanceOrdinal: minerInstanceWith(["wanted", 0]),
				}),
			).world,
		).toBe(world);
	});

	test("the stations are required, because a default would erase the difference", () => {
		type StationsRequired =
			{} extends Pick<OffenceFacts, "stations"> ? false : true;
		const stationsRequired: StationsRequired = true;
		expect(stationsRequired).toBe(true);
		const { stations: _, ...rest } = facts("destroyed");
		expect("stations" in rest).toBe(false);
	});
});

describe("chargeOffence: one offence, priced and filed in one event", () => {
	test("15 then 25 is 40, never 55", () => {
		const clean = minerInstanceWith(["clean", 0]);
		const strike = chargeOffence(
			newWorld(7),
			facts("struck", { instanceOrdinal: clean }),
		);
		expect(strike.heat).toBe(15);
		const kill = chargeOffence(
			strike.world,
			facts("destroyed", { instanceOrdinal: clean, struckAt: 0 }),
		);
		expect(kill.heat).toBe(25);
		expect(kill.world.galaxies[0].legalStatus.heat).toBe(40);
	});

	test("an assault is charged once", () => {
		const clean = minerInstanceWith(["clean", 0], ["clean", 60]);
		const first = chargeOffence(
			newWorld(7),
			facts("assault", { instanceOrdinal: clean }),
		);
		expect(first.heat).toBe(13);
		expect(assaultCharged(first.world.galaxies[0].legalStatus, MINER)).toBe(
			true,
		);
		const again = chargeOffence(
			first.world,
			facts("assault", { instanceOrdinal: clean, now: 60 }),
		);
		expect(again.heat).toBe(0);
		expect(again.world).toBe(first.world);
	});

	test("a lawful kill files a hearer at heat 0 and does not restamp", () => {
		const clean = minerInstanceWith(["clean", 0]);
		const struck = chargeOffence(
			newWorld(7),
			facts("struck", { instanceOrdinal: clean }),
		).world;
		const wanted = minerInstanceWith(["wanted", 600]);
		const kill = chargeOffence(
			struck,
			facts("destroyed", {
				instanceOrdinal: wanted,
				now: 600,
				stations: [near(TRADE)],
			}),
		);
		expect(kill.heat).toBe(0);
		expect(kill.world.galaxies[0].legalStatus).toMatchObject({
			heat: 15,
			updatedAt: 0,
			witnesses: [TRADE],
		});
	});

	test("a mark is written only when the charge cost heat", () => {
		const wanted = minerInstanceWith(["wanted", 0]);
		const world = newWorld(7);
		const lawful = chargeOffence(
			world,
			facts("assault", { instanceOrdinal: wanted }),
		);
		expect(lawful.heat).toBe(0);
		expect(lawful.world).toBe(world);
		expect(assaultCharged(lawful.world.galaxies[0].legalStatus, MINER)).toBe(
			false,
		);
		const clean = minerInstanceWith(["clean", 0]);
		const billed = chargeOffence(
			world,
			facts("assault", { instanceOrdinal: clean }),
		);
		expect(billed.heat).toBe(13);
		expect(billed.world.galaxies[0].legalStatus.assaulted).toEqual([MINER]);
	});

	test("a repeated hearer is written once", () => {
		const clean = minerInstanceWith(["clean", 0], ["clean", 60]);
		const tradeSecondBody: EarshotStation = {
			key: TRADE,
			pos: v3(0, 1, 0),
			type: "trade",
		};
		const first = chargeOffence(
			newWorld(7),
			facts("assault", {
				instanceOrdinal: clean,
				stations: [near(TRADE), tradeSecondBody],
			}),
		).world;
		expect(first.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
		const second = chargeOffence(
			first,
			facts("struck", {
				instanceOrdinal: clean,
				now: 60,
				stations: [near(TRADE), far(YARD)],
			}),
		).world;
		expect(second.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});

	test("the standing at the strike is read on the strike's clock", () => {
		const later = STANDING_ROTATION_S;
		const turned = minerInstanceWith(["wanted", 0], ["clean", later]);
		const kill = chargeOffence(
			newWorld(7),
			facts("destroyed", { instanceOrdinal: turned, now: later, struckAt: 0 }),
		);
		expect(kill.heat).toBe(40);
		const steady = minerInstanceWith(["clean", 0], ["clean", later]);
		expect(
			chargeOffence(
				newWorld(7),
				facts("destroyed", {
					instanceOrdinal: steady,
					now: later,
					struckAt: 0,
				}),
			).heat,
		).toBe(25);
	});
});
