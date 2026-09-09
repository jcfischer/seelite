import { describe, expect, test } from "bun:test";
import { interiorOfStation } from "../src/dock-session";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { berthFits, trafficBerths } from "../src/station-interior";
import { stationTrafficRoster } from "../src/station-traffic";
import { generateContents } from "../src/system";

const WORLD = 0x5ee11e;

/**
 * #277: **a station keeps one berth for visitors**, so Traffic's roster is the
 * catalogue minus one and a player arriving at a cold station is granted rather
 * than queued.
 *
 * The failure this replaces was total: one home carrier per berth, every one of
 * them parked before its first departure, so `occupied` was the whole catalogue
 * at every station of every seed and the docking computer waited for a berth it
 * would never be offered. The arithmetic is here rather than in a browser
 * because that is what it is — `probe-dock-arrival.mjs` owns the flown half.
 */
const stations = () => {
	const galaxy = generateGalaxy(WORLD, 0);
	return galaxy.systems.flatMap((record) =>
		generateContents(record).stations.map((station) => ({ record, station })),
	);
};

describe("the visitor berth", () => {
	test("Traffic's roster is one short of the catalogue, everywhere", () => {
		const roster = stations().slice(0, 200);
		expect(roster.length).toBeGreaterThan(50);
		for (const { record, station } of roster) {
			const interior = interiorOfStation(station);
			const actors = stationTrafficRoster(record.index, station);
			expect({
				id: station.id,
				carriers: actors.length,
			}).toEqual({
				id: station.id,
				carriers: interior.berths.length - 1,
			});
		}
	});

	test("no two carriers call the same berth home, and one berth has none", () => {
		for (const { record, station } of stations().slice(0, 200)) {
			const interior = interiorOfStation(station);
			const allowed = trafficBerths(interior);
			const roster = stationTrafficRoster(record.index, station);
			const homes = new Set(
				roster.map((actor) => allowed[actor.ordinal % allowed.length].id),
			);
			// **Against the roster, not against `allowed`.** Comparing the two
			// derived-from-the-same-rule sets is a tautology: an over-sized roster
			// wraps `ordinal % allowed.length` back onto berth 0 and still fills
			// every berth, so `homes.size === allowed.length` passes on the build
			// this test exists to catch. What separates them is that two carriers
			// then share a home.
			expect(homes.size).toBe(roster.length);
			const free = interior.berths.filter((berth) => !homes.has(berth.id));
			expect(free.length).toBe(1);
		}
	});

	/**
	 * A tautology while every berth of a station has the same clear envelope —
	 * measured at 0.09 x 0.058 x 0.04 km on trade, shipyard and refinery and
	 * 0.078 x 0.054 x 0.03 on the outpost — and a tripwire for the day one does
	 * not. `chooseBerth` filters by fit, so a reserved berth that admits less
	 * than its neighbours is a queue the player never advances through, which is
	 * #277's own bug wearing a different hat.
	 */
	test("the reserved berth admits every hull the station admits", () => {
		for (const { station } of stations().slice(0, 200)) {
			const interior = interiorOfStation(station);
			const allowed = new Set(trafficBerths(interior).map((b) => b.id));
			const reserved = interior.berths.filter((b) => !allowed.has(b.id));
			expect(reserved.length).toBe(1);
			for (const hull of Object.values(HULL_SPECS)) {
				if (!interior.berths.some((berth) => berthFits(berth, hull.env)))
					continue;
				expect({
					station: station.id,
					hull: hull.variant,
					fits: berthFits(reserved[0], hull.env),
				}).toEqual({ station: station.id, hull: hull.variant, fits: true });
			}
		}
	});
});
