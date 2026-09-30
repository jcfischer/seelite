/**
 * #584 and #583 D2, D7, D10 — which hull is flown, and where a bought one goes.
 */
import { describe, expect, test } from "bun:test";
import { bootHull, deliverHull } from "../src/flown-hull";
import {
	DOCKABLE_HULL_IDS,
	HULL_SPECS,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
} from "../src/hull";
import {
	type StationInterior,
	berthFits,
	stationInterior,
} from "../src/station-interior";
import { STATION_GEOMETRY } from "../src/station";

describe("#557 / #584 — the boot hull", () => {
	test("a fresh game flies a valid ?hull=", () => {
		expect(bootHull("freighter", null)).toEqual({
			hull: "freighter",
			warning: null,
		});
	});

	test("a fresh game with no ?hull= flies the baseline, silently", () => {
		expect(bootHull(null, null)).toEqual({
			hull: PLAYER_BASELINE_HULL,
			warning: null,
		});
	});

	test("an unknown ?hull= falls back to the baseline and says so", () => {
		const boot = bootHull("carrier", null);
		expect(boot.hull).toBe(PLAYER_BASELINE_HULL);
		expect(boot.warning).toContain("?hull=carrier");
	});

	test("a loaded save flies its own hull whatever the URL says", () => {
		// The known mismatch: an interceptor save loaded on a courier URL.
		const boot = bootHull("courier", "interceptor");
		expect(boot.hull).toBe("interceptor");
		expect(boot.warning).toContain("interceptor");
		expect(boot.warning).toContain("?hull=courier");
	});

	test("a loaded save with no ?hull= flies its hull, silently", () => {
		expect(bootHull(null, "explorer")).toEqual({
			hull: "explorer",
			warning: null,
		});
	});

	test("a URL that agrees with the save says nothing", () => {
		expect(bootHull("miner", "miner").warning).toBeNull();
	});
});

test("every purchasable hull fits every shipyard berth, over a spread of seeds", () => {
	// Why D7's re-berth and D10's delivery cannot happen in play today. If a
	// berth ever stops admitting a purchasable hull, this goes red and those
	// two arms become reachable — which is the moment to fly them.
	let pairs = 0;
	for (let seed = 0; seed < 64; seed++) {
		const yard = stationInterior(
			"shipyard",
			STATION_GEOMETRY.shipyard.aperturePlaneKm,
			seed,
		);
		for (const berth of yard.berths)
			for (const hull of PURCHASABLE_HULL_IDS) {
				expect(
					berthFits(berth, HULL_SPECS[hull].env),
					`${hull} @ ${seed}/${berth.id}`,
				).toBe(true);
				pairs += 1;
			}
	}
	expect(pairs).toBeGreaterThan(64 * PURCHASABLE_HULL_IDS.length);
});

describe("#556 D7 / D10 — where a bought hull goes", () => {
	const interior = stationInterior(
		"shipyard",
		STATION_GEOMETRY.shipyard.aperturePlaneKm,
		7,
	);
	const here = interior.berths[0];
	/** The interior with its first berth too small for anything — the one way
	 *  to reach D7 and D10, since every purchasable hull fits every berth. */
	const shrinkFirstBerth = (from: StationInterior): StationInterior => ({
		...from,
		berths: from.berths.map((berth, i) =>
			i === 0
				? {
						...berth,
						clearLengthKm: 0.001,
						clearBeamKm: 0.001,
						clearHeightKm: 0.001,
					}
				: berth,
		),
	});

	test("a hull that fits the berth it was bought in stays there", () => {
		let checked = 0;
		for (const hull of DOCKABLE_HULL_IDS) {
			const env = HULL_SPECS[hull].env;
			if (!berthFits(here, env)) continue;
			checked += 1;
			expect(
				deliverHull(interior, here.id, env, new Set([here.id])),
				hull,
			).toEqual({ kind: "berth", berthId: here.id });
		}
		// The control: a loop that fitted nothing would pass on any build.
		expect(checked).toBeGreaterThan(0);
	});

	test("otherwise it is re-berthed through chooseBerth, old berth freed", () => {
		// A berth-shaped hole: shrink the current berth so nothing fits it.
		const tiny = shrinkFirstBerth(interior);
		const env = HULL_SPECS.freighter.env;
		const occupied = new Set([tiny.berths[0].id]);
		const delivery = deliverHull(tiny, tiny.berths[0].id, env, occupied);
		expect(delivery.kind).toBe("berth");
		if (delivery.kind === "berth") {
			expect(delivery.berthId).not.toBe(tiny.berths[0].id);
			const berth = tiny.berths.find((b) => b.id === delivery.berthId);
			expect(berth && berthFits(berth, env)).toBe(true);
		}
	});

	test("with no free berth that fits, it is delivered on launch (D10)", () => {
		const env = HULL_SPECS.freighter.env;
		// Every other berth taken, and the current one too small.
		const tiny = shrinkFirstBerth(interior);
		const occupied = new Set(tiny.berths.map((b) => b.id));
		expect(deliverHull(tiny, tiny.berths[0].id, env, occupied)).toEqual({
			kind: "on-launch",
		});
	});
});
