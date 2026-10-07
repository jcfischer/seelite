/**
 * The raider outpost's placement (node #491): where #490's fourth station
 * stands, which systems hold one, and what putting it there cost the rest of
 * the generator.
 *
 * What the outpost *is* is #490's and is tested where each rule lives — the
 * Wanted-only berth in `legal.test.ts`, the witness rule in `distress.test.ts`.
 * This file holds the generator's side: incidence, the Trojan placement, the
 * stream it draws on, the distance from the station the relay watches, the
 * arrival point, and the explicit absences (a closed berth, no market).
 *
 * The evidence that every *other* station is unmoved is not here: it is
 * `station-orbits.test.ts` and `station.test.ts`' committed baselines, which
 * set the outpost aside and must match row for row.
 */
import { describe, expect, test } from "bun:test";
import { COMMS_LINES, clearanceLine } from "../src/comms";
import { newDockingState, requestClearance } from "../src/docking";
import { DOMAIN } from "../src/domains";
import { stream } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { hasMarket } from "../src/market";
// Module names: a raider's and the relay's Carrier slot, not a berth.
// glossary-ignore: slot
import { RAIDER_SLOT_MAX, raiderSlotCount } from "../src/raider-slots";
import { RELAY_REGION_KM, relayPlan } from "../src/relay-slot";
import {
	LOCAL_CARRIER_ID,
	STATION_BERTHS_OPEN,
	STATION_FENCE_ELIGIBLE,
	STATION_GEOMETRY,
	STATION_TYPES,
} from "../src/station";
import { stationInterior } from "../src/station-interior";
import { stationNames } from "../src/station-name";
import {
	ARRIVAL_CLEARANCE_AU,
	RAIDER_OUTPOST_LEAD_RAD,
	type Station,
	type SystemContents,
	arrivalPoint,
	hasRaiderOutpost,
	placeBodies,
} from "../src/system";
import { AU_KM } from "../src/units";
import { length, sub } from "../src/vec3";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "./helpers/station-rows";

const WORLDS = worldSeeds(4);

const outpostOf = (contents: SystemContents): Station | undefined =>
	contents.stations.find((s) => s.type === "outpost");

describe("incidence (#490 D4)", () => {
	test("exactly one outpost where raiderSlotCount is at its height, and none elsewhere", () => {
		let lawless = 0;
		let lawful = 0;
		const wrong: string[] = [];
		for (const world of WORLDS)
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				const outposts = contents.stations.filter((s) => s.type === "outpost");
				const want =
					raiderSlotCount(record.government) === RAIDER_SLOT_MAX ? 1 : 0;
				if (want) lawless++;
				else lawful++;
				if (outposts.length !== want)
					wrong.push(
						`${world}:g${g}#${record.index} gov ${record.government}: ${outposts.length}`,
					);
			});
		// Named rather than counted, so a regression says which system.
		expect(wrong).toEqual([]);
		// Both arms, or half the rule is untested.
		expect(lawless).toBeGreaterThan(1000);
		expect(lawful).toBeGreaterThan(1000);
	});

	test("the rule is the two most lawless governments, read off raiderSlotCount's ramp", () => {
		// Pinned per government so a retuned ramp is a visible change here, not
		// a silent move of every haven in the galaxy.
		expect([0, 1, 2, 3, 4, 5, 6, 7].map(hasRaiderOutpost)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	test("it carries the persistence id the table has always reserved for it", () => {
		for (const record of lawlessRecords(1)) {
			const outpost = outpostOf(record.contents);
			expect(outpost?.id).toBe("station-outpost");
			expect(outpost?.localCarrierId).toBe(LOCAL_CARRIER_ID.outpost);
		}
	});
});

/** Every lawless system of `worlds` seeds, with its contents. */
function lawlessRecords(worlds: number) {
	const out: {
		record: Parameters<Parameters<typeof forEachSystem>[2]>[0];
		contents: SystemContents;
	}[] = [];
	for (const world of worldSeeds(worlds))
		forEachSystem(world, ALL_GALAXIES, (record, contents) => {
			if (hasRaiderOutpost(record.government)) out.push({ record, contents });
		});
	return out;
}

describe("placement: a Trojan point on a planet's own orbit", () => {
	test("star-centric, sharing a planet's radius, period and plane, a sixth of a turn away", () => {
		const rows = lawlessRecords(2);
		expect(rows.length).toBeGreaterThan(1000);
		for (const { contents } of rows) {
			const outpost = outpostOf(contents);
			if (!outpost) throw new Error("lawless system without an outpost");
			expect(outpost.parentId).toBeNull();
			const host = contents.planets.find(
				(p) =>
					p.orbit.radiusKm === outpost.orbit.radiusKm &&
					p.orbit.periodS === outpost.orbit.periodS &&
					p.orbit.inclination === outpost.orbit.inclination &&
					p.orbit.node === outpost.orbit.node,
			);
			if (!host) throw new Error("no planet shares the outpost's orbit");
			expect(
				Math.abs(
					Math.abs(outpost.orbit.theta0 - host.orbit.theta0) -
						RAIDER_OUTPOST_LEAD_RAD,
				),
			).toBeLessThan(1e-12);
		}
	});

	test("it does not spin, is not a fence, and carries the name reserved for it", () => {
		expect(STATION_GEOMETRY.outpost.spins).toBe(false);
		expect(STATION_FENCE_ELIGIBLE.outpost).toBe(false);
		for (const { record, contents } of lawlessRecords(1)) {
			const outpost = outpostOf(contents);
			expect(outpost?.spinRpm).toBe(0);
			expect(outpost?.blackMarket).toBe(false);
			expect(outpost?.name).toBe(
				stationNames(record.seed, record.name).outpost,
			);
		}
	});

	test("every number it draws is a draw on its own stream, in order", () => {
		// A reconstruction rather than a range check: replay
		// `DOMAIN.RAIDER_OUTPOST` from the top and the outpost's host, side,
		// berth seed and assembly seed must be its first four draws. A draw
		// taken from a shared stream instead would fail here and, through the
		// baselines, there.
		for (const { record, contents } of lawlessRecords(1)) {
			const outpost = outpostOf(contents);
			if (!outpost) throw new Error("lawless system without an outpost");
			const rand = stream(record.seed, DOMAIN.RAIDER_OUTPOST);
			const host =
				contents.planets[Math.floor(rand() * contents.planets.length)];
			const side = rand() < 0.5 ? -1 : 1;
			expect(outpost.orbit.radiusKm).toBe(host.orbit.radiusKm);
			expect(outpost.orbit.theta0).toBe(
				host.orbit.theta0 + side * RAIDER_OUTPOST_LEAD_RAD,
			);
			expect(outpost.berthSeed).toBe(Math.floor(rand() * 0x100000000));
			expect(outpost.assemblySeed).toBe(Math.floor(rand() * 0x100000000));
		}
	});

	test("its tag is the newest, so no existing stream moved to make room", () => {
		// Appended after every tag before it: 1 to 29 are taken, and nothing it
		// shares a number with. Later tags (node #731's derelicts) sit above it.
		const tags: number[] = Object.values(DOMAIN);
		const upTo = tags
			.filter((t) => t <= DOMAIN.RAIDER_OUTPOST)
			.sort((a, b) => a - b);
		expect(upTo).toEqual(
			Array.from({ length: DOMAIN.RAIDER_OUTPOST }, (_, i) => i + 1),
		);
	});
});

describe("off the watched station (#482's ruling)", () => {
	/**
	 * **Somewhere else, measured over a year.** The relay always watches a
	 * lawful station — a trade station exists in every system — and the outpost
	 * has to read as a different place from it, not as the watched station
	 * with a warning on it. A sixth of a turn round an orbit of at least 0.3 AU
	 * puts it at least that orbit's radius from its own host planet; the
	 * minimum this corpus reaches is 0.126 AU. 0.05 AU — 7.5 million km, 7,500
	 * times the relay's search region — is the floor asserted, sampled every
	 * ten days because the outpost and the watched station orbit at different
	 * rates and pass each other.
	 */
	test("never the relay's watched station, and never within 0.05 AU of it over a year", () => {
		const FLOOR_KM = 0.05 * AU_KM;
		expect(FLOOR_KM).toBeGreaterThan(1000 * RELAY_REGION_KM);
		let checked = 0;
		for (const { record, contents } of lawlessRecords(1)) {
			const outpost = outpostOf(contents);
			const plan = relayPlan(contents, record.seed);
			if (!outpost || !plan) throw new Error("missing outpost or relay plan");
			expect(plan.watchedStationId).not.toBe(outpost.id);
			for (let t = 0; t <= 365 * 86400; t += 10 * 86400) {
				const placed = placeBodies(contents, t);
				const at = (id: string) => {
					const body = placed.find((b) => b.id === id);
					if (!body) throw new Error(`missing ${id}`);
					return body.pos;
				};
				expect(
					length(sub(at(outpost.id), at(plan.watchedStationId))),
				).toBeGreaterThan(FLOOR_KM);
			}
			checked++;
		}
		expect(checked).toBeGreaterThan(400);
	});
});

describe("the arrival point clears it", () => {
	test("a new-game arrival lands outside the outpost's clearance", () => {
		// `arrivalPoint` clears every placed body, stations included. A
		// star-centric station is not inside a planet's own interval, so this is
		// the row that holds the outpost to the same clearance as the planets.
		for (const { record, contents } of lawlessRecords(1)) {
			const at = arrivalPoint(record, contents, null, 0);
			const outpost = placeBodies(contents, 0).find(
				(b) => b.id === "station-outpost",
			);
			if (!outpost) throw new Error("missing outpost");
			expect(length(sub(at, outpost.pos))).toBeGreaterThanOrEqual(
				ARRIVAL_CLEARANCE_AU * AU_KM * (1 - 1e-9),
			);
		}
	});
});

describe("what it is not yet: the explicit absences", () => {
	test("the outpost has no market, and every other type does", () => {
		for (const type of STATION_TYPES)
			expect(hasMarket({ type })).toBe(type !== "outpost");
	});

	test("no type's berths are open without a market behind them", () => {
		// The direction that matters: a berth opened before its market docks a
		// pilot into a console that throws. The other direction — a market with
		// its berth still closed — is allowed, and is how the outpost's market
		// can land before the berth opens.
		for (const type of STATION_TYPES)
			if (STATION_BERTHS_OPEN[type]) expect(hasMarket({ type })).toBe(true);
		expect(STATION_BERTHS_OPEN.outpost).toBe(false);
	});

	test("a closed berth denies clearance with its own reason, not as hostility", () => {
		const req = {
			gameTime: 0,
			rangeKm: 1,
			interior: stationInterior(
				"outpost",
				STATION_GEOMETRY.outpost.aperturePlaneKm,
				0,
			),
			hull: HULL_SPECS.courier.env,
			occupied: new Set<string>(),
		};
		// The berth would grant a courier: the catalogue fits it, so the refusal
		// below is the closure's and not the fit's.
		expect(requestClearance(newDockingState(), req).clearance.kind).toBe(
			"granted",
		);
		const next = requestClearance(newDockingState(), { ...req, closed: true });
		expect(next.clearance).toEqual({ kind: "denied", reason: "closed" });
		// Not hostility: no cooldown is started for a pilot who did nothing.
		expect(next.hostile).toBe(false);
		// And it outranks the law, so a clean pilot is not told they are hostile.
		expect(
			requestClearance(newDockingState(), {
				...req,
				closed: true,
				refusedByLaw: true,
			}).clearance,
		).toEqual({ kind: "denied", reason: "closed" });
	});

	test("approach control says so in a line of its own", () => {
		expect(
			clearanceLine({ kind: "none" }, { kind: "denied", reason: "closed" }),
		).toBe("deniedClosed");
		expect(COMMS_LINES.deniedClosed.text).not.toContain("hostile");
	});
});
