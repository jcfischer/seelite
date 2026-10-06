/**
 * The player's legal heat (`civilian-combat.md` H4): what an offence
 * costs, how it decays, and which standing it reads as — and H5/H6's witness
 * list, which is the same saved row's third member.
 *
 * **An offence is one event since #633**, `chargeOffence`, and every row about
 * what an offence costs or files is written at that event's interface: the raw
 * facts in, the next world and the heat out. The steps it is composed of — the
 * incident's arithmetic, the heat write, the mark — are the module's own and
 * are not exported, so no row here reaches past the event to them.
 */
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

/** The saved row, as `world-state.ts` holds it. */
const law = (
	heat: number,
	updatedAt = 0,
	witnesses: CarrierKey[] = [],
	assaulted: CarrierKey[] = [],
): LegalStatus => ({ heat, updatedAt, witnesses, assaulted });

/** A station's persisted key. The `3:` and `4:` are system indices. */
const TRADE = carrierKey(3, "station-trade");
const YARD = carrierKey(3, "station-shipyard");
const OTHER = carrierKey(4, "station-refinery");
/** Ordinary carriers, the ones an offence is committed against. */
const MINER = carrierKey(3, "carrier-miner");
const FREIGHTER = carrierKey(3, "carrier-freighter");

/** The station as the refusal predicate sees it. */
const berth = (key: CarrierKey, type: StationType) => ({ key, type });

/** Minutes until a heat decays below a threshold, from the law itself. */
const minutesAbove = (heat: number, threshold: number) => {
	let t = 0;
	while (heatAt(law(heat), t) >= threshold) t += 1;
	return t / MIN;
};

/** The system the carriers below fly in. Standing is derived from it, so a
 *  row picks its carrier by what that derivation answers rather than by a
 *  standing written into the fixture. */
const SEED = 0x5ee11e;

/** An instance of `key` whose true standing reads `standing` at each of the
 *  clocks given — the search is the fixture, so no row restates a draw.
 *  `skip` returns the next such instance after the first `skip` of them. */
const instanceOf = (
	key: CarrierKey,
	wanted: [Standing, number][],
	skip = 0,
): number => {
	let found = 0;
	for (let ordinal = 0; ordinal < 5000; ordinal++)
		if (
			wanted.every(
				([standing, at]) =>
					carrierStanding(SEED, key, ordinal, at) === standing,
			) &&
			found++ === skip
		)
			return ordinal;
	throw new Error(`no instance of ${key} reads ${JSON.stringify(wanted)}`);
};
/** The same search for `MINER`, which most rows fire on. */
const instanceWith = (...wanted: [Standing, number][]): number =>
	instanceOf(MINER, wanted);

/** A station inside the victim's earshot, and one outside it, with the victim
 *  at the origin. */
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

/** The facts of one act, as `Game` would hand them over. */
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
	systemSeed: SEED,
	carrier: { key, instanceOrdinal, struckAt },
	victim,
	stations,
});

/** Charge one act and keep only the world, for a row that reads the row. */
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

	test("holds the sustained-fire rung inside the interval it may not leave", () => {
		// #396: the charge's whole legal life is the open interval between
		// `WANTED_HEAT` and the strike's figure, and neither end is a rounding.
		//
		// At `WANTED_HEAT` exactly the charge crosses Wanted and un-crosses it on
		// the next frame, because decay starts the instant the write is stamped:
		// the offence becomes a flash no berth and no responder can act on, which
		// is the invisibility the flight report was about. At the strike's 15 the
		// lattice ties, and two rungs the law has to order become one figure —
		// `marginalOffenceHeat` then reports a strike after an assault as costing
		// nothing, having forgotten which of the two it is looking at.
		//
		// The figure is a declared starting form and is expected to be retuned.
		// This row is what makes a retune that leaves the interval a red run
		// instead of a quiet change in what the law is.
		expect(OFFENCE_HEAT.assault).toBeGreaterThan(WANTED_HEAT);
		expect(OFFENCE_HEAT.assault).toBeLessThan(OFFENCE_HEAT.struck);
	});

	test("keeps the three rungs ordered by heat, so the ladder and the price agree", () => {
		// `marginalOffenceHeat` orders by rank, not by price — but the two must
		// still agree, or a pilot pays more for a lesser act than for a greater
		// one and the sentence stops matching the thing done.
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
	/** A Clean carrier. */
	const CLEAN = instanceWith(["clean", 0]);

	/**
	 * One act and then another against the same Clean carrier, with the facts
	 * `Game` hands over after the first: a strike leaves the carrier standing at
	 * home under the strike's clock, and an assault leaves its mark in the
	 * world. What the second act cost, and what the incident has cost in all.
	 * Both acts land on one clock, so the total is the two charges and not a
	 * decay curve between them.
	 */
	const walk = (first: Offence, second: Offence) => {
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
		// A second hit on a carrier already diverted by the first is the common
		// case, not the odd one: the pilot keeps firing at the ship running away.
		expect(walk("struck", "struck").second).toBe(0);
		// And the clock is once per carrier per incident: a pilot who keeps
		// firing after the charge has landed is not billed it again every five
		// seconds, nor for five seconds spent on a ship already struck.
		expect(walk("assault", "assault").second).toBe(0);
		expect(walk("struck", "assault").second).toBe(0);
	});

	// **The figures are written out here, not derived from the module.** The
	// first version of this row computed the expectation with `offenceRank` —
	// the same function the module compares with — and so it passed on any
	// inversion of the ladder, which is precisely the mistake it is here to
	// catch. These are the numbers `civilian-combat.md` H4 prints: what the
	// second act adds, and what the incident costs in all.
	//
	// **A kill is never the first act of a pair here, because it cannot be.**
	// The kill replaces the instance (H1), so the next act is against a new
	// ship with no strike to stand for — a new incident, not a second rung of
	// this one. The pairs a pilot can actually walk are these six.
	const LADDER: [Offence, Offence, number, number][] = [
		["assault", "assault", 0, 13],
		["assault", "struck", 2, 15],
		["assault", "destroyed", 27, 40],
		["struck", "assault", 0, 15],
		["struck", "struck", 0, 15],
		["struck", "destroyed", 25, 40],
	];

	test.each(LADDER)(
		"%s then %s adds %d and the incident costs %d, never the sum",
		(first, second, adds, total) => {
			// #396's lattice is three deep, and the ordering has to hold whichever
			// way round a pilot happens to do the two things. The incident costs
			// the larger rung's own price — never the total of the two, which is
			// what a caller doing `heat += offenceHeat(...)` writes, and never the
			// smaller one, which would make a kill beside a struck hull cheaper
			// than the strike.
			const paid = walk(first, second);
			expect(paid.second).toBe(adds);
			expect(paid.total).toBe(total);
		},
	);

	test("the whole ladder, as the three legs a pilot actually walks", () => {
		// Five seconds of fire, the strike that diverts the ship, the kill that
		// finishes it at home: 13, 2 and 25, and the incident is the kill's 40.
		const clean = instanceWith(["clean", 0], ["clean", 10], ["clean", 20]);
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
	});

	test("a lawful target costs nothing whatever the incident carries", () => {
		// The incident's premise is set on a Clean instance, and the act judged on
		// one whose rotation has turned it Wanted or Fugitive since: F7 judges the
		// act on the target's standing now, whatever was paid before.
		const later = STANDING_ROTATION_S;
		for (const standing of ["wanted", "fugitive"] as const) {
			const turned = instanceWith(["clean", 0], [standing, later]);
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
		// Three kills of three Clean ships, each its own incident.
		let world = newWorld(7);
		for (const skip of [0, 1, 2])
			world = charged(world, "destroyed", {
				instanceOrdinal: instanceOf(MINER, [["clean", 0]], skip),
			});
		expect(world.galaxies[0].legalStatus.heat).toBe(HEAT_CAP);
	});

	test("lands in the galaxy it happened in", () => {
		const world = charged(newWorld(7), "destroyed", {
			galaxy: 3,
			instanceOrdinal: instanceWith(["clean", 0]),
			stations: [near(TRADE)],
		});
		expect(world.galaxies[3].legalStatus.heat).toBe(40);
		expect(world.galaxies[3].legalStatus.witnesses).toEqual([TRADE]);
		expect(world.galaxies[0].legalStatus.heat).toBe(0);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([]);
	});

	test("leaves the witness list alone when it writes heat alone", () => {
		// The heat write and the list are one row. A `setLegalHeat` that
		// rebuilt `{ heat, updatedAt }` from nothing would silently forget every
		// station that saw an offence the moment a second offence happened.
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
	const CLEAN = instanceWith(["clean", 0], ["clean", 60]);

	test("a station inside the earshot is filed, and one outside it is not", () => {
		const world = charged(newWorld(7), "destroyed", {
			instanceOrdinal: CLEAN,
			stations: [near(TRADE), far(YARD)],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});

	test("the earshot is measured from the victim, not from the origin of anything else", () => {
		// The same two stations, with the victim moved beside the far one: the
		// one it was beside before is now out of reach. The pilot's position is
		// not a fact the event takes at all.
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
		// Canonical order, not the order the offences happened in — see the row
		// below, and `setLegalWitnesses`'s reason for it.
		expect(world.galaxies[0].legalStatus.witnesses).toEqual(
			[TRADE, YARD].sort(compareCarrierKeys),
		);
	});

	test("the list is held in canonical order, not in offence order", () => {
		// The save hashes these bytes, and the §9.6 round trip asks that a model
		// equal its own save. A row kept in the order the offences happened in
		// would be re-sorted by the canonicaliser and come back different.
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
		// H4's own durations: a Clean kill is 40, Wanted at 10, half-life 30 min,
		// so about 60 minutes. Derived here from the write, not quoted.
		const written = charged(newWorld(7), "destroyed", {
			instanceOrdinal: instanceWith(["clean", 0]),
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
		// No station saw anything here. H7's shipyard refusal is by standing
		// alone, and its exit is the same decay, so no berth is locked for good.
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
		// A shipyard's blanket refusal is by *standing*, so it does not read the
		// list; a witness does name one station. Both are keyed on the berth the
		// pilot is asking, and a check that mixed them would pass with either.
		const witnessed = law(40, 0, [TRADE]);
		expect(dockingRefusedByLaw(witnessed, berth(TRADE, "trade"), 0)).toBe(true);
		expect(dockingRefusedByLaw(witnessed, berth(OTHER, "refinery"), 0)).toBe(
			false,
		);
	});
});

describe("#490 D5: a raider outpost admits only a Wanted pilot (node #491)", () => {
	const OUTPOST = carrierKey(3, "station-outpost");

	test("refused below Wanted, admitted at it, and refused again once it decays", () => {
		// The witness rule inverted: the exit is the other direction, so the
		// same decay that reopens a shipyard closes the outpost.
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
		// D10 keeps an outpost off the list in the first place; this is that a
		// list naming one by some other road still cannot turn the key into a
		// bar, because the outpost's rule does not read the list.
		expect(
			dockingRefusedByLaw(law(40, 0, [OUTPOST]), berth(OUTPOST, "outpost"), 0),
		).toBe(false);
	});

	test("an offence beside an outpost files nothing", () => {
		const world = charged(newWorld(7), "destroyed", {
			galaxy: 0,
			instanceOrdinal: instanceWith(["clean", 0]),
			stations: [near(OUTPOST, "outpost")],
		});
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([]);
	});
});

describe("H6: the list is cleared when heat reads below Wanted", () => {
	/** A Clean kill in `galaxy`, heard by `station`. */
	const killBeside = (world: WorldState, galaxy: number, station: CarrierKey) =>
		charged(world, "destroyed", {
			galaxy,
			instanceOrdinal: instanceWith(["clean", 0]),
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
		// The clear hangs off a read the HUD makes every frame. A write that
		// copied eight envelopes on an empty list would mark the save dirty on
		// a law-abiding pilot's every frame.
		const world = newWorld(7);
		expect(settleIncident(world, 0, 1e6)).toBe(world);
	});

	test("clearing one galaxy leaves the others' witnesses alone", () => {
		const world = killBeside(killBeside(newWorld(7), 2, TRADE), 3, OTHER);
		// The clear is per galaxy, as the whole domain is: heat decaying out of
		// Wanted here says nothing about the pilot's standing somewhere else.
		const settled = settleIncident(world, 2, 61 * MIN);
		expect(settled.galaxies[2].legalStatus.witnesses).toEqual([]);
		expect(settled.galaxies[3].legalStatus.witnesses).toEqual([OTHER]);
	});
});

describe("H4's sustained-fire rung (#396)", () => {
	test("the charge crosses Wanted and stays there for the duration decay gives it", () => {
		// #396's second verification row, and the reason the rung's price is not
		// simply "a smaller strike". A charge that crossed Wanted and fell back
		// within a frame would be indistinguishable from no charge at any berth:
		// the crossing has to outlast the frame that caused it by the interval
		// the pilot can actually act on — a lap round the station, a jump spool,
		// a decision to run.
		//
		// Derived from the law's own decay, not asserted as a duration: the
		// figure below is how long `heatAt` keeps 13 above 10, and the row that
		// matters is that it is a real span rather than a boundary crossing.
		const above = minutesAbove(OFFENCE_HEAT.assault, WANTED_HEAT);
		expect(above).toBeGreaterThan(0);
		expect(legalStandingAt(law(OFFENCE_HEAT.assault), 0)).toBe("wanted");
		expect(legalStandingAt(law(OFFENCE_HEAT.assault), above * MIN * 0.99)).toBe(
			"wanted",
		);
		expect(legalStandingAt(law(OFFENCE_HEAT.assault), above * MIN * 1.01)).toBe(
			"clean",
		);
		// A frame past the write. The test that a rung "crosses Wanted" without
		// this one passes for a figure equal to the threshold, which is the case
		// the interval above exists to refuse.
		expect(heatAt(law(OFFENCE_HEAT.assault), 1 / 60)).toBeLessThan(
			OFFENCE_HEAT.assault,
		);
		expect(heatAt(law(OFFENCE_HEAT.assault), 1 / 60)).toBeGreaterThanOrEqual(
			WANTED_HEAT,
		);
	});

	test("the charge is held per carrier and per galaxy", () => {
		const clean = instanceWith(["clean", 0]);
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
		// "Once per carrier per incident" needs an ending, and the law's only
		// ending is decay. Clearing the witnesses and not the charges would
		// pardon a carrier forever; the other way round would leave a pilot
		// re-chargeable inside an incident they are still Wanted for.
		const ended = minutesAbove(OFFENCE_HEAT.assault, WANTED_HEAT) * MIN;
		const clean = instanceWith(["clean", 0], ["clean", ended]);
		const world = charged(newWorld(7), "assault", {
			instanceOrdinal: clean,
			stations: [near(TRADE)],
		});
		const still = settleIncident(world, 0, 0);
		expect(still).toBe(world);
		const settled = settleIncident(world, 0, ended);
		expect(settled.galaxies[0].legalStatus.witnesses).toEqual([]);
		expect(settled.galaxies[0].legalStatus.assaulted).toEqual([]);
		// **And the law stops reading the carrier as charged**, which is the same
		// emptiness from the side a caller stands on: the assault list is what
		// the incident is priced from, so a list cleared while the read still
		// answered true would go on pardoning a carrier whose heat is gone. The
		// next five seconds against it are a new incident, and cost.
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
		// A lawful kill in a system with no station: no heat, nobody heard, and
		// the same world back — so the caller's save sees no change.
		const world = newWorld(7);
		expect(
			chargeOffence(
				world,
				facts("destroyed", { instanceOrdinal: instanceWith(["wanted", 0]) }),
			).world,
		).toBe(world);
	});

	test("the stations are required, because a default would erase the difference", () => {
		// `OffenceFacts.stations` is **required**: `[]` means the system has no
		// station, and there is no third spelling. An optional field would put
		// back the ambiguity `witnessed: CarrierKey | null` was originally
		// required to keep — "nobody heard" against "the caller never looked" —
		// and a caller that never looked fails H5 in the direction that reads as
		// the law working. The earshot itself is computed inside the event, so
		// the list a caller hands over is every station, never a verdict.
		//
		// **The gate on this row is the typecheck, not bun**: bun strips types,
		// and `npx tsc --noEmit` covers `tests/`. The directive below is an
		// error there the moment `stations` stops being required, because it
		// would then have no error to expect. Before #633 this row read
		// `withOffence.length`, a runtime count of the write's parameters; the
		// write is the module's own step now, and the fact is the interface.
		const { stations: _, ...rest } = facts("destroyed");
		// @ts-expect-error — a charge with no stations is not a charge.
		const missing: OffenceFacts = rest;
		expect("stations" in missing).toBe(false);
	});
});

/**
 * #633: an offence is one event. `chargeOffence` takes the raw facts — the act,
 * the clock, the carrier with the clock of the strike it stands for, where the
 * victim was and where every station is — and hands back the next world and
 * what the act cost. Each row below is one rule the event owns, written at its
 * interface, and every figure is a literal for the reason the H9 rows above
 * give: an expectation derived through the module passes on its own mistake.
 */
describe("chargeOffence: one offence, priced and filed in one event", () => {
	test("15 then 25 is 40, never 55", () => {
		const clean = instanceWith(["clean", 0]);
		const strike = chargeOffence(
			newWorld(7),
			facts("struck", { instanceOrdinal: clean }),
		);
		expect(strike.heat).toBe(15);
		// The divert booked the repair in the strike's tick, so the kill is
		// judged against a carrier standing at home under a strike at 0.
		const kill = chargeOffence(
			strike.world,
			facts("destroyed", { instanceOrdinal: clean, struckAt: 0 }),
		);
		expect(kill.heat).toBe(25);
		expect(kill.world.galaxies[0].legalStatus.heat).toBe(40);
	});

	test("an assault is charged once", () => {
		const clean = instanceWith(["clean", 0], ["clean", 60]);
		const first = chargeOffence(
			newWorld(7),
			facts("assault", { instanceOrdinal: clean }),
		);
		expect(first.heat).toBe(13);
		expect(assaultCharged(first.world.galaxies[0].legalStatus, MINER)).toBe(
			true,
		);
		// A reload into the same fight, the double #396 refuses by name: nothing
		// is owed, and with nobody in earshot nothing is written — the same world
		// back, which is what keeps the save clean.
		const again = chargeOffence(
			first.world,
			facts("assault", { instanceOrdinal: clean, now: 60 }),
		);
		expect(again.heat).toBe(0);
		expect(again.world).toBe(first.world);
	});

	test("a lawful kill files a hearer at heat 0 and does not restamp", () => {
		const clean = instanceWith(["clean", 0]);
		const struck = chargeOffence(
			newWorld(7),
			facts("struck", { instanceOrdinal: clean }),
		).world;
		const wanted = instanceWith(["wanted", 600]);
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
		// A five seconds judged lawful (F7) is not a charge, and a mark left for
		// it would discount the next strike on the same carrier by 13 the pilot
		// was never billed.
		const wanted = instanceWith(["wanted", 0]);
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
		const clean = instanceWith(["clean", 0]);
		const billed = chargeOffence(
			world,
			facts("assault", { instanceOrdinal: clean }),
		);
		expect(billed.heat).toBe(13);
		expect(billed.world.galaxies[0].legalStatus.assaulted).toEqual([MINER]);
	});

	test("a repeated hearer is written once", () => {
		const clean = instanceWith(["clean", 0], ["clean", 60]);
		// Twice in one list — two bodies answering to one key — and again on a
		// second offence: one station heard, so one row says so.
		const first = chargeOffence(
			newWorld(7),
			facts("assault", {
				instanceOrdinal: clean,
				stations: [
					near(TRADE),
					{ key: TRADE, pos: v3(0, 1, 0), type: "trade" },
				],
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
		// The rotation turns between the strike and the kill. A strike on a
		// carrier that was Wanted then cost nothing, so the kill owes its whole
		// 40 — reading the strike's standing at the kill's clock would discount
		// it to 25 for a hit the pilot was never charged for.
		const later = STANDING_ROTATION_S;
		const turned = instanceWith(["wanted", 0], ["clean", later]);
		const kill = chargeOffence(
			newWorld(7),
			facts("destroyed", { instanceOrdinal: turned, now: later, struckAt: 0 }),
		);
		expect(kill.heat).toBe(40);
		// The control: Clean at both clocks, the same facts otherwise, is the
		// 25 top-up — so the 40 above is the strike's clock and not a kill that
		// ignored the strike.
		const steady = instanceWith(["clean", 0], ["clean", later]);
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
