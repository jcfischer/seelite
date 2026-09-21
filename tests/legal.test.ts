/**
 * The player's legal heat (`civilian-combat.md` H4): what an offence
 * costs, how it decays, and which standing it reads as — and H5/H6's witness
 * list, which is the same saved row's third member.
 */
import { describe, expect, test } from "bun:test";
import {
	type CarrierKey,
	carrierKey,
	compareCarrierKeys,
} from "../src/carrier-key";
import {
	assaultCharged,
	dockingRefusedByLaw,
	FUGITIVE_HEAT,
	HEAT_CAP,
	HEAT_HALF_LIFE_S,
	heatAt,
	legalStandingAt,
	legalStandingOf,
	marginalOffenceHeat,
	markAssaultCharged,
	OFFENCE_HEAT,
	OFFENCE_LADDER,
	offenceHeat,
	offenceRank,
	settleIncident,
	stationHostile,
	WANTED_HEAT,
	withOffence,
} from "../src/legal";
import { type StationType } from "../src/station";
import { type LegalStatus, newWorld } from "../src/world-state";

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
/** An ordinary carrier, for the sustained-fire charge's own list. */
const MINER = carrierKey(3, "carrier-miner");

/** The station as the refusal predicate sees it. */
const berth = (key: CarrierKey, type: StationType) => ({ key, type });

/** Minutes until a heat decays below a threshold, from the law itself. */
const minutesAbove = (heat: number, threshold: number) => {
	let t = 0;
	while (heatAt(law(heat), t) >= threshold) t += 1;
	return t / MIN;
};

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
	test("a kill after a strike adds the difference and no more", () => {
		expect(marginalOffenceHeat("clean", "struck", null)).toBe(15);
		expect(marginalOffenceHeat("clean", "destroyed", null)).toBe(40);
		expect(marginalOffenceHeat("clean", "destroyed", "struck")).toBe(25);
		// Strike then kill is one incident at 40. Summing them — which is what a
		// write that ignores the incident does — is 55.
		expect(
			marginalOffenceHeat("clean", "struck", null) +
				marginalOffenceHeat("clean", "destroyed", "struck"),
		).toBe(40);
	});

	test("an offence already covered by the incident adds nothing", () => {
		expect(marginalOffenceHeat("clean", "struck", "struck")).toBe(0);
		// A second hit on a carrier already diverted by the first is the common
		// case, not the odd one: the pilot keeps firing at the ship running away.
		expect(marginalOffenceHeat("clean", "struck", "destroyed")).toBe(0);
		// And the new rung behaves the same way under itself: the clock is once
		// per carrier per incident, and a pilot who keeps firing after the charge
		// has landed is not billed it again every five seconds.
		expect(marginalOffenceHeat("clean", "assault", "assault")).toBe(0);
		expect(marginalOffenceHeat("clean", "assault", "struck")).toBe(0);
	});

	// **The figures are written out here, not derived from the module.** The
	// first version of this row computed the expectation with `offenceRank` —
	// the same function `marginalOffenceHeat` compares with — and so it passed
	// on any inversion of the ladder, which is precisely the mistake it is here
	// to catch. These are the numbers `civilian-combat.md` H4 prints.
	const LADDER_TOTAL_CR: Record<string, number> = {
		"assault+assault": 13,
		"assault+struck": 15,
		"assault+destroyed": 40,
		"struck+assault": 15,
		"struck+struck": 15,
		"struck+destroyed": 40,
		"destroyed+assault": 40,
		"destroyed+struck": 40,
		"destroyed+destroyed": 40,
	};

	test("every pair of rungs, in both orders, costs the larger one and no more", () => {
		// #396's lattice is three deep, and the ordering has to hold whichever
		// way round a pilot happens to do the two things. Each pair is the sum of
		// its marginals, and that sum is the larger rung's own price — never
		// their total, which is the naive write, and never the smaller one, which
		// would make a kill beside a struck hull cheaper than the strike.
		for (const a of OFFENCE_LADDER)
			for (const b of OFFENCE_LADDER) {
				const first = marginalOffenceHeat("clean", a, null);
				const second = marginalOffenceHeat("clean", b, a);
				expect(first + second).toBe(LADDER_TOTAL_CR[`${a}+${b}`]);
			}
	});

	test("an incident is never the sum of its rungs", () => {
		// The other half of the same ruling, stated as the wrong answer it
		// forbids: assault then struck is 15, not 28, and struck then destroyed
		// is 40, not 55. A write that adds the rungs — which is what a caller
		// doing `heat += offenceHeat(...)` writes — fails here and nowhere else
		// in this file, because every row above is a marginal one.
		expect(marginalOffenceHeat("clean", "struck", "assault")).toBe(2);
		expect(marginalOffenceHeat("clean", "destroyed", "struck")).toBe(25);
		expect(marginalOffenceHeat("clean", "destroyed", "assault")).toBe(27);
		expect(marginalOffenceHeat("clean", "assault", "destroyed")).toBe(0);
	});

	test("a lawful target costs nothing whatever the incident carries", () => {
		for (const standing of ["wanted", "fugitive"] as const)
			for (const offence of OFFENCE_LADDER)
				for (const already of [null, ...OFFENCE_LADDER] as const)
					expect(marginalOffenceHeat(standing, offence, already)).toBe(0);
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
		let world = newWorld(7);
		world = withOffence(world, 0, 40, 0, []);
		expect(world.galaxies[0].legalStatus).toMatchObject({
			heat: 40,
			updatedAt: 0,
		});
		world = withOffence(world, 0, 40, HEAT_HALF_LIFE_S, []);
		expect(world.galaxies[0].legalStatus.heat).toBeCloseTo(60, 9);
		expect(world.galaxies[0].legalStatus.updatedAt).toBe(HEAT_HALF_LIFE_S);
	});

	test("is capped", () => {
		let world = newWorld(7);
		for (let i = 0; i < 5; i++) world = withOffence(world, 0, 40, 0, []);
		expect(world.galaxies[0].legalStatus.heat).toBe(HEAT_CAP);
	});

	test("a lawful kill with no witness writes nothing", () => {
		const world = newWorld(7);
		expect(withOffence(world, 0, 0, 100, [])).toBe(world);
	});

	test("lands in the galaxy it happened in", () => {
		const world = withOffence(newWorld(7), 3, 40, 0, []);
		expect(world.galaxies[3].legalStatus.heat).toBe(40);
		expect(world.galaxies[0].legalStatus.heat).toBe(0);
	});

	test("leaves the witness list alone when it writes heat alone", () => {
		// The heat write and the list are one row. A `setLegalHeat` that
		// rebuilt `{ heat, updatedAt }` from nothing would silently forget every
		// station that saw an offence the moment a second offence happened.
		let world = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
		world = withOffence(world, 0, 40, 60, []);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});
});

describe("H6: the station an offence happened beside is a witness", () => {
	test("an offence whose frame body was a station adds it", () => {
		const world = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});

	test("an offence beside no station adds nothing", () => {
		const world = withOffence(newWorld(7), 0, 40, 0, []);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([]);
	});

	test("a station is held once however often it saw one", () => {
		// H6's bound: the list cannot grow past one galaxy's stations because
		// re-offending beside the same berth cannot lengthen it.
		let world = newWorld(7);
		for (const at of [0, 60, 120, 180])
			world = withOffence(world, 0, 40, at, [TRADE]);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
	});

	test("two stations that each saw one are both held", () => {
		let world = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
		world = withOffence(world, 0, 40, 60, [YARD]);
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
		const laterFirst = withOffence(newWorld(7), 0, 40, 0, [OTHER]);
		const both = withOffence(laterFirst, 0, 40, 60, [TRADE]);
		expect(both.galaxies[0].legalStatus.witnesses).toEqual(
			[OTHER, TRADE].sort(compareCarrierKeys),
		);
	});

	test("witnesses land in the galaxy the offence happened in", () => {
		const world = withOffence(newWorld(7), 5, 40, 0, [TRADE]);
		expect(world.galaxies[5].legalStatus.witnesses).toEqual([TRADE]);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([]);
	});

	test("a lawful kill beside a station still writes the witness", () => {
		// A Wanted target is lawful to kill (F7), so the offence costs no heat.
		// The station saw a ship destroyed in front of it all the same, and H6's
		// hostility condition is the list plus heat, not the charge.
		const world = withOffence(newWorld(7), 0, 0, 0, [TRADE]);
		expect(world.galaxies[0].legalStatus.witnesses).toEqual([TRADE]);
		expect(world.galaxies[0].legalStatus.heat).toBe(0);
	});

	test("a witness written with no heat does not restamp the clock", () => {
		// H4 stamps a write with the offence it added. A lawful kill adds none,
		// so restamping here would decay a pilot's existing heat from *now* and
		// hold them Wanted past the duration H4 set, on an act that costs nothing.
		const written = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
		const later = withOffence(written, 0, 0, 600, [YARD]);
		expect(later.galaxies[0].legalStatus.updatedAt).toBe(0);
		expect(later.galaxies[0].legalStatus.heat).toBe(40);
		expect(later.galaxies[0].legalStatus.witnesses).toEqual(
			[TRADE, YARD].sort(compareCarrierKeys),
		);
	});
});

describe("H5: a witnessed station is hostile while the pilot is Wanted", () => {
	test("hostile at Wanted and open again once heat decays below it", () => {
		// H4's own durations: a Clean kill is 40, Wanted at 10, half-life 30 min,
		// so about 60 minutes. Derived here from the write, not quoted.
		const written = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
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
		for (const type of ["trade", "refinery", "outpost"] as const) {
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

describe("H6: the list is cleared when heat reads below Wanted", () => {
	test("a read below Wanted drops every witness", () => {
		const written = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
		const settled = settleIncident(
			written,
			0,
			minutesAbove(40, WANTED_HEAT) * MIN,
		);
		expect(settled.galaxies[0].legalStatus.witnesses).toEqual([]);
	});

	test("a read at or above Wanted keeps them", () => {
		const written = withOffence(newWorld(7), 0, 40, 0, [TRADE]);
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
		let world = withOffence(newWorld(7), 2, 40, 0, [TRADE]);
		world = withOffence(world, 3, 40, 0, [OTHER]);
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

	test("the charge is written once per carrier and read back as paid", () => {
		let world = withOffence(newWorld(7), 0, OFFENCE_HEAT.assault, 0, [TRADE]);
		expect(assaultCharged(world.galaxies[0].legalStatus, MINER)).toBe(false);
		world = markAssaultCharged(world, 0, MINER, OFFENCE_HEAT.assault, 0);
		expect(assaultCharged(world.galaxies[0].legalStatus, MINER)).toBe(true);
		// Idempotent: a second charge for the same carrier — a reload into the
		// same fight, which is the case #396 refuses by name — changes nothing.
		expect(markAssaultCharged(world, 0, MINER, OFFENCE_HEAT.assault, 60)).toBe(
			world,
		);
	});

	test("a charge that cost nothing is not recorded", () => {
		// **The mark is the record of a charge, and a lawful act is not one**
		// (F7). Recorded anyway, a five seconds spent on a target whose rotation
		// had turned it Wanted would sit in the row and cost the next strike on
		// that carrier 2 instead of 15 — a discount on a bill the pilot was never
		// presented, which is #396's ladder turned inside out. Inside the fight the
		// clock is latched by the engagement whatever the crossing cost, so
		// refusing the mark costs nothing in re-charging.
		const world = markAssaultCharged(
			withOffence(newWorld(7), 0, 0, 0, []),
			0,
			MINER,
			0,
			0,
		);
		expect(assaultCharged(world.galaxies[0].legalStatus, MINER)).toBe(false);
	});

	test("marking a charge does not restamp the heat's clock", () => {
		// Same rule as a witness filed beside a lawful kill: the stamp belongs to
		// the heat, and restamping it on a write that adds none would hold a
		// pilot Wanted past the duration their last real offence set.
		const written = withOffence(newWorld(7), 0, 40, 0, []);
		const marked = markAssaultCharged(
			written,
			0,
			MINER,
			OFFENCE_HEAT.assault,
			600,
		);
		expect(marked.galaxies[0].legalStatus.updatedAt).toBe(0);
		expect(marked.galaxies[0].legalStatus.heat).toBe(40);
	});

	test("the charge is held per carrier and per galaxy", () => {
		const world = markAssaultCharged(
			markAssaultCharged(
				withOffence(newWorld(7), 0, 13, 0, []),
				0,
				MINER,
				13,
				0,
			),
			3,
			MINER,
			13,
			0,
		);
		expect(assaultCharged(world.galaxies[0].legalStatus, MINER)).toBe(true);
		expect(assaultCharged(world.galaxies[3].legalStatus, MINER)).toBe(true);
		expect(
			assaultCharged(
				world.galaxies[0].legalStatus,
				carrierKey(3, "carrier-freighter"),
			),
		).toBe(false);
		expect(assaultCharged(world.galaxies[1].legalStatus, MINER)).toBe(false);
	});

	test("the incident ends when the heat does: one clear takes both lists", () => {
		// "Once per carrier per incident" needs an ending, and the law's only
		// ending is decay. Clearing the witnesses and not the charges would
		// pardon a carrier forever; the other way round would leave a pilot
		// re-chargeable inside an incident they are still Wanted for.
		let world = withOffence(newWorld(7), 0, OFFENCE_HEAT.assault, 0, [TRADE]);
		world = markAssaultCharged(world, 0, MINER, OFFENCE_HEAT.assault, 0);
		const still = settleIncident(world, 0, 0);
		expect(still).toBe(world);
		const settled = settleIncident(
			world,
			0,
			minutesAbove(OFFENCE_HEAT.assault, WANTED_HEAT) * MIN,
		);
		expect(settled.galaxies[0].legalStatus.witnesses).toEqual([]);
		expect(settled.galaxies[0].legalStatus.assaulted).toEqual([]);
		// **And the law stops reading the carrier as charged**, which is the same
		// emptiness from the side a caller stands on: `assaultCharged` is what
		// `chargedOffence` prices from, so a list cleared while the read still
		// answered true would go on pardoning a carrier whose heat is gone.
		expect(assaultCharged(settled.galaxies[0].legalStatus, MINER)).toBe(false);
	});
});

describe("the hearer list is computed, never assumed", () => {
	test("an empty list is an answer, and writes nothing", () => {
		const world = newWorld(7);
		expect(withOffence(world, 0, 0, 100, [])).toBe(world);
	});

	test("the argument is required, because a default would erase the difference", () => {
		// `withOffence` takes the hearer list as a **mandatory positional
		// argument**: `[]` means the caller computed the earshot and nobody was
		// in it, and there is no third spelling. An optional parameter would put
		// back the ambiguity `witnessed: CarrierKey | null` was originally
		// required to keep — "nobody heard" against "the caller never looked" —
		// and a caller that never looked fails H5 in the direction that reads as
		// the law working. `Function.length` counts declared parameters before
		// the first optional one, so this row goes red the moment the list
		// becomes optional, which is the only way the distinction can be lost.
		expect(withOffence.length).toBe(5);
	});
});
