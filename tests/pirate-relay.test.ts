/**
 * The pirate sensor relay (node #43): a carrier slot on one station's
 * approach whose capability is that the system's raiders find every ship on
 * the route to that station.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import { EQUIPMENT, LONG_RANGE_SCANNER, SCAN_MODULE } from "../src/market";
import {
	RELAY_IDENTIFY_RANGE_KM,
	RELAY_INTEGRITY,
	RELAY_REPAIR_S,
	RELAY_SIGNAL_RANGE_KM,
	RELAY_WRECK_S,
	relayDestruction,
	relayActive,
	relayActiveChance,
	relayActiveShare,
	RELAY_ACTIVE_CHANCE,
	relayDetection,
	relayLog,
	relayPosition,
	relayScannerFitted,
	relaySignal,
	relayVelocity,
} from "../src/pirate-relay";
import {
	RELAY_LOCAL_CARRIER_ID,
	RELAY_REGION_KM,
	RELAY_STANDOFF_KM,
	relayPlan,
	relaySlot,
} from "../src/relay-slot";
import { PULSE_LASER } from "../src/ship-condition";
import { generateContents, positionOnOrbit } from "../src/system";
import { makeWorld } from "../src/sim";
import { add, length, sub, v3 } from "../src/vec3";
import {
	applyTransition,
	effectiveCarrier,
	newWorld,
} from "../src/world-state";

const WORLD = 0x5ee11e;
const galaxy = generateGalaxy(WORLD, 0);

describe("the slot", () => {
	test("is one per system, keyed into the carrier namespace", () => {
		expect(RELAY_LOCAL_CARRIER_ID).toBe("relay-00");
		expect(relaySlot(12).key).toBe(carrierKey(12, "relay-00"));
		expect(relaySlot(12)).toEqual(relaySlot(12));
	});
});

describe("the plan", () => {
	test("watches the trade station where there is one, else the first station", () => {
		let trade = 0;
		let other = 0;
		let none = 0;
		for (const record of galaxy.systems) {
			const contents = generateContents(record);
			const plan = relayPlan(contents, record.seed);
			if (!plan) {
				none++;
				expect(contents.stations).toHaveLength(0);
				continue;
			}
			const station = contents.stations.find(
				(s) => s.id === plan.watchedStationId,
			);
			if (!station) throw new Error("the watched station is not in the system");
			const hasTrade = contents.stations.some((s) => s.type === "trade");
			if (hasTrade) {
				expect(station.type).toBe("trade");
				trade++;
			} else {
				expect(station.id).toBe(contents.stations[0].id);
				other++;
			}
		}
		expect(trade).toBeGreaterThan(100);
		// Every dockable system in this galaxy has a trade station (a trade
		// station needs a primary, and so does docking), so the fallback is
		// exercised on a system with its trade station taken away.
		expect(other).toBe(0);
		const record = galaxy.systems.find(
			(r) => generateContents(r).stations.length > 1,
		);
		if (!record) throw new Error("no multi-station system");
		const contents = generateContents(record);
		const without = {
			...contents,
			stations: contents.stations.filter((s) => s.type !== "trade"),
		};
		expect(without.stations.length).toBeGreaterThan(0);
		// The fallback is a role order, not list order: shipyard before
		// refinery before outpost, whatever the generator's push order was.
		const byRole = ["shipyard", "refinery", "outpost"]
			.map((type) => without.stations.find((s) => s.type === type))
			.find((s) => s !== undefined);
		expect(relayPlan(without, record.seed)?.watchedStationId).toBe(byRole?.id);
		const reversed = { ...without, stations: [...without.stations].reverse() };
		expect(relayPlan(reversed, record.seed)?.watchedStationId).toBe(byRole?.id);
		// #23's unreachable systems: no station, so no relay.
		expect(none).toBeLessThan(5);
	});

	test("is a pure function of the system", () => {
		const record = galaxy.systems[58];
		const contents = generateContents(record);
		expect(relayPlan(contents, record.seed)).toEqual(
			relayPlan(contents, record.seed),
		);
	});

	test("stands off the watched station inside the search region, and co-moves with it", () => {
		let ahead = 0;
		let behind = 0;
		for (const record of galaxy.systems.slice(0, 64)) {
			const contents = generateContents(record);
			const plan = relayPlan(contents, record.seed);
			if (!plan) continue;
			const station = contents.stations.find(
				(s) => s.id === plan.watchedStationId,
			);
			if (!station) throw new Error("no watched station");
			const parent = contents.planets.find((p) => p.id === station.parentId);
			for (const t of [0, 1_000, 50_000]) {
				const stationPos = add(
					parent ? positionOnOrbit(parent.orbit, t) : v3(),
					positionOnOrbit(station.orbit, t),
				);
				const km = length(sub(relayPosition(plan, contents, t), stationPos));
				expect(km).toBeGreaterThanOrEqual(RELAY_STANDOFF_KM[0]);
				expect(km).toBeLessThanOrEqual(RELAY_REGION_KM);
			}
			// Co-moving: the standoff does not change with the clock.
			const d = (t: number) =>
				length(
					sub(
						relayPosition(plan, contents, t),
						add(
							parent ? positionOnOrbit(parent.orbit, t) : v3(),
							positionOnOrbit(station.orbit, t),
						),
					),
				);
			expect(Math.abs(d(0) - d(3_600))).toBeLessThan(0.5);
			// And the velocity is the position's derivative.
			const dt = 0.5;
			const fd = sub(
				relayPosition(plan, contents, 1_000 + dt),
				relayPosition(plan, contents, 1_000 - dt),
			);
			const v = relayVelocity(plan, contents, 1_000);
			expect(
				length(
					sub(v, {
						x: fd.x / (2 * dt),
						y: fd.y / (2 * dt),
						z: fd.z / (2 * dt),
					}),
				),
			).toBeLessThan(0.05);
			if (plan.leadKm > 0) ahead++;
			else behind++;
		}
		expect(ahead).toBeGreaterThan(5);
		expect(behind).toBeGreaterThan(5);
	});

	test("the seed-42 fixture: RAAQU's relay watches its trade station", () => {
		const world = makeWorld(42);
		const plan = relayPlan(world.system.contents, world.system.record.seed);
		expect(plan?.watchedStationId).toBe("station-trade");
	});
});

describe("the capability", () => {
	const plan = { watchedStationId: "station-trade" };
	test("a leg to the watched station is watched while the relay is up and none while it is down", () => {
		expect(relayDetection(plan, "station-trade", true)).toBe("watched");
		expect(relayDetection(plan, "station-trade", false)).toBe("none");
	});
	test("every other leg keeps the law, whatever the relay's state", () => {
		expect(relayDetection(plan, "station-shipyard", true)).toBe("law");
		expect(relayDetection(plan, "station-shipyard", false)).toBe("law");
		expect(relayDetection(plan, null, false)).toBe("law");
		expect(relayDetection(null, "station-trade", true)).toBe("law");
	});
});

describe("the signal", () => {
	test("is silent beyond its range, and grows toward the relay", () => {
		const relay = v3(0, 0, 0);
		expect(relaySignal(v3(RELAY_SIGNAL_RANGE_KM + 1, 0, 0), relay)).toBeNull();
		const far = relaySignal(v3(RELAY_SIGNAL_RANGE_KM - 1, 0, 0), relay);
		const near = relaySignal(v3(RELAY_IDENTIFY_RANGE_KM, 0, 0), relay);
		if (!far || !near) throw new Error("silent inside range");
		expect(far.strength).toBeGreaterThanOrEqual(0);
		expect(near.strength).toBeGreaterThan(far.strength);
		expect(near.strength).toBeLessThanOrEqual(1);
		expect(near.km).toBeCloseTo(RELAY_IDENTIFY_RANGE_KM, 6);
	});
	test("identification is inside the signal's range, and the region holds both", () => {
		expect(RELAY_IDENTIFY_RANGE_KM).toBeLessThan(RELAY_SIGNAL_RANGE_KM);
		expect(RELAY_STANDOFF_KM[1]).toBeLessThan(RELAY_REGION_KM);
	});
	test("#481: reading a relay at all is the bought module's", () => {
		expect(relayScannerFitted([])).toBe(false);
		expect(relayScannerFitted([LONG_RANGE_SCANNER])).toBe(true);
		// Fitted among others, because the list is the whole of the commander's
		// equipment and an `includes` on the wrong element would pass a
		// single-item case.
		expect(relayScannerFitted(["Fuel Scoops", LONG_RANGE_SCANNER])).toBe(true);
		// The scanner that already exists is a different module, and the two are
		// one keystroke apart in every list that names them.
		expect(relayScannerFitted([SCAN_MODULE])).toBe(false);
		expect(LONG_RANGE_SCANNER).not.toBe(SCAN_MODULE);
		// The module is buyable, or the gate locks the channel permanently.
		expect(EQUIPMENT.some((e) => e.name === LONG_RANGE_SCANNER)).toBe(true);
	});
});

describe("the lifecycle", () => {
	test("ten seconds of pulse fire is the relay", () => {
		expect(RELAY_INTEGRITY / PULSE_LASER.damagePerS).toBeCloseTo(10, 6);
	});
	test("a kill is the player's destroy, scheduling a replacement twice the raider's", () => {
		const event = relayDestruction(9, 500, "station-trade");
		expect(event.kind).toBe("destroy");
		expect(event.cause.playerRole).toBe("direct");
		if (event.kind !== "destroy" || !event.schedule)
			throw new Error("no schedule");
		expect(event.schedule.startsAt).toBe(500 + RELAY_WRECK_S);
		expect(event.schedule.completesAt).toBe(
			500 + RELAY_WRECK_S + RELAY_REPAIR_S,
		);
		expect(event.schedule.consequenceArea).toBe("route:9:station-trade");
		expect(RELAY_WRECK_S + RELAY_REPAIR_S).toBe(60 * 60);
	});
	test("applied, it reads destroyed, repairing, then replaced; and the log says so", () => {
		const slot = relaySlot(9);
		const w = applyTransition(
			newWorld(WORLD),
			0,
			slot.key,
			relayDestruction(9, 500, "station-trade"),
		);
		const at = (t: number) => effectiveCarrier(w.galaxies[0], slot.key, t);
		expect(at(500).condition).toBe("destroyed");
		expect(at(500 + RELAY_WRECK_S).condition).toBe("repairing");
		expect(at(500 + RELAY_WRECK_S + RELAY_REPAIR_S).condition).toBe(
			"operational",
		);
		expect(at(500 + RELAY_WRECK_S + RELAY_REPAIR_S).instanceOrdinal).toBe(1);
		const texts = (t: number) =>
			relayLog(w.galaxies[0], 9, t).map((l) => l.text);
		expect(texts(499)).toEqual([]);
		expect(texts(500)).toEqual(["Pirate relay destroyed"]);
		expect(texts(500 + RELAY_WRECK_S)).toEqual([
			"Pirate relay under repair",
			"Pirate relay destroyed",
		]);
		expect(texts(500 + RELAY_WRECK_S + RELAY_REPAIR_S)[0]).toBe(
			"Pirate relay back in service",
		);
	});
});

describe("which systems have one (#351)", () => {
	// Every system with a station has the slot (`world-state.test.ts`); whether
	// the relay is *active* there is a seeded roll per system whose chance falls
	// with government, by the principal's ruling on #351: 80% in an Anarchy to
	// 10% in a Corporate State, linear between.
	test("the chance runs from 80% at government 0 to 10% at 7, linearly", () => {
		expect(RELAY_ACTIVE_CHANCE).toEqual({ anarchy: 0.8, corporate: 0.1 });
		expect(relayActiveChance(0)).toBeCloseTo(0.8, 12);
		expect(relayActiveChance(7)).toBeCloseTo(0.1, 12);
		for (let g = 0; g < 7; g++)
			expect(relayActiveChance(g) - relayActiveChance(g + 1)).toBeCloseTo(
				0.1,
				12,
			);
	});

	test("the roll is the system's own, and stable", () => {
		const record = galaxy.systems[9];
		expect(relayActive(record)).toBe(relayActive(record));
		// Its own stream: the placement draw is unmoved by it, so an inactive
		// relay's slot keeps the placement the fingerprint pins.
		const contents = generateContents(record);
		expect(relayPlan(contents, record.seed)).toEqual(
			relayPlan(contents, record.seed),
		);
	});

	test("the share of active relays tracks the chance in every government", () => {
		// Over all eight galaxies, per government: the observed share against
		// the ruled chance, inside four binomial standard deviations. The
		// buckets are not even — 221, 353, 437, 452, 324, 194, 60 and 7 systems
		// from Anarchy to Corporate State at this seed — so the band is per
		// bucket, and the Corporate one is wide because seven systems say little.
		const seen = relayActiveShare(WORLD);
		expect(seen.reduce((s, b) => s + b.n, 0)).toBe(8 * 256);
		for (let government = 0; government < 8; government++) {
			const { n, active } = seen[government];
			const p = relayActiveChance(government);
			expect(n).toBeGreaterThan(0);
			expect(Math.abs(active / n - p)).toBeLessThan(
				4 * Math.sqrt((p * (1 - p)) / n),
			);
		}
	});
});
