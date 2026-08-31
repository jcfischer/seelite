/**
 * `hud-and-scanner.md` §8.6's four headless obligations — 3, 4, 6 and 8.
 *
 * Each of the four is written against a way the obvious implementation passes
 * on a broken build, and §8.5 names the three defects that ship green. They are
 * asserted here as the spec words them rather than as the easier check beside
 * each one:
 *
 * - **3** is a construction check, not an absence-of-throw check. Both the
 *   correct build and the broken one throw nothing at a fence, where every good
 *   lists, so a test that only visits a fence cannot fail.
 * - **8** asserts the universal-item *set*, not its count. §8.6 measured that a
 *   count check is blind from `displayTL` 0 through 6 — exactly the half a
 *   reader thinking about frontier stations would write against.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	COMMODITIES,
	type Commodity,
	EQUIPMENT,
	FUEL_CR_PER_LY,
	type MarketStation,
	MARKET_PERIOD_MIN,
	UNIVERSAL_GATE_CAP,
	UNIVERSAL_ITEMS,
	listsCommodity,
	marketRow,
	marketStationOf,
	shelfQuantity,
	stockResponse,
} from "../src/market";
import { TRAVERSAL_SECONDS_DEEP, TRAVERSAL_SECONDS_NEAR } from "../src/docking";
import {
	flightFloorVisible,
	requiredDisplayTL,
	signedDelta,
	stationConsoleVisible,
	stationEquipmentScreen,
	stationMarketScreen,
	universalItemsAt,
} from "../src/station-console";

const ECONOMY = 3;

const stationOf = (
	type: "trade" | "refinery" | "shipyard",
	blackMarket: boolean,
): MarketStation =>
	marketStationOf(
		{ type, localCarrierId: `station-${type}`, blackMarket },
		0x5ee1_17e,
	);

const TRADE = stationOf("trade", false);
const FENCE = stationOf("refinery", true);

const noDeficit = () => 0;

// ---------------------------------------------------------------------------
// Obligation 3 — the row builder never asks for a price it cannot have
// ---------------------------------------------------------------------------

test("obligation 3: the builder calls marketRow only where listsCommodity is true", () => {
	// By construction: the injected row function records who it was asked about,
	// so the check reads the *calls* rather than the absence of a throw.
	for (const station of [TRADE, FENCE]) {
		const asked: string[] = [];
		stationMarketScreen(
			{ station, economy: ECONOMY, gameTimeMin: 0, deficitOf: noDeficit },
			(commodity, economy, s, gameTimeMin) => {
				asked.push(commodity.name);
				return marketRow(commodity, economy, s, gameTimeMin);
			},
		);
		const listed = COMMODITIES.filter((c) => listsCommodity(c, station)).map(
			(c) => c.name,
		);
		expect(asked).toEqual(listed);
	}
});

test("obligation 3: a non-fence station is the case that separates the builds", () => {
	// The guard on the guard. If both stations listed every good, the assertion
	// above would hold on a builder that ignored `listsCommodity` entirely.
	const tradeListed = COMMODITIES.filter((c) => listsCommodity(c, TRADE));
	const fenceListed = COMMODITIES.filter((c) => listsCommodity(c, FENCE));
	expect(tradeListed.length).toBe(14);
	expect(fenceListed.length).toBe(17);
});

test("M5: seventeen rows at every station, priced iff the station lists the good", () => {
	for (const station of [TRADE, FENCE]) {
		const rows = stationMarketScreen({
			station,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: noDeficit,
		});
		expect(rows.length).toBe(COMMODITIES.length);
		expect(rows.map((r) => r.commodity.name)).toEqual(
			COMMODITIES.map((c) => c.name),
		);
		for (const row of rows) {
			// The biconditional §8.6 obligation 2 asks for, not the constant 14.
			expect(row.listed).toBe(listsCommodity(row.commodity, station));
			expect(row.priceCr !== undefined).toBe(row.listed);
			expect(row.quantity !== undefined).toBe(row.listed);
		}
	}
});

// ---------------------------------------------------------------------------
// Obligation 4 — the delta is against this epoch's base, and absent at zero
// ---------------------------------------------------------------------------

const moved = (goodName: string, units: number) => (name: string) =>
	name === goodName ? units : 0;

/** A good the trade station lists whose price the floor does not pin, so the
 *  delta the obligation is about is a real number rather than a floored zero. */
const priceyGood = (station: MarketStation): Commodity => {
	const found = COMMODITIES.find(
		(c) =>
			listsCommodity(c, station) &&
			marketRow(c, ECONOMY, station, 0).priceCr > 10 &&
			marketRow(c, ECONOMY, station, 0).quantity > 20,
	);
	if (!found) throw new Error("no priced, stocked good at this station");
	return found;
};

test("obligation 4: a non-zero deficit carries a signed delta, a zero one carries none", () => {
	const good = priceyGood(TRADE);
	const rows = stationMarketScreen({
		station: TRADE,
		economy: ECONOMY,
		gameTimeMin: 0,
		deficitOf: moved(good.name, 12),
	});
	const movedRow = rows.find((r) => r.commodity.name === good.name);
	if (!movedRow) throw new Error("the moved good is not on the screen");
	expect(movedRow.priceDeltaCr).toBeDefined();
	expect(movedRow.quantityDelta).toBeDefined();
	// The player bought: dearer, and a thinner shelf.
	expect(movedRow.priceDeltaCr as number).toBeGreaterThan(0);
	expect(movedRow.quantityDelta as number).toBeLessThan(0);

	for (const row of rows)
		if (row.commodity.name !== good.name) {
			expect(row.priceDeltaCr).toBeUndefined();
			expect(row.quantityDelta).toBeUndefined();
		}
});

test("obligation 4: the delta is measured against this epoch's base, not the last one", () => {
	const good = priceyGood(TRADE);
	// Two moments inside different epochs. The base moves between them, and the
	// delta must move with it — a delta held against a remembered price would
	// keep the old base and drift.
	const times = [0, MARKET_PERIOD_MIN * 3];
	for (const gameTimeMin of times) {
		const base = marketRow(good, ECONOMY, TRADE, gameTimeMin);
		const rows = stationMarketScreen({
			station: TRADE,
			economy: ECONOMY,
			gameTimeMin,
			deficitOf: moved(good.name, 12),
		});
		const row = rows.find((r) => r.commodity.name === good.name);
		if (!row) throw new Error("the moved good is not on the screen");
		expect(row.priceCr).toBeCloseTo(stockResponse(base.priceCr, 12), 9);
		expect(row.priceDeltaCr as number).toBeCloseTo(
			stockResponse(base.priceCr, 12) - base.priceCr,
			9,
		);
		expect(row.quantity).toBe(shelfQuantity(base.quantity, 12));
		expect(row.quantityDelta as number).toBe(
			shelfQuantity(base.quantity, 12) - base.quantity,
		);
	}
	// The guard: the two epochs must actually differ, or the loop above proves
	// nothing about which base was used.
	const bases = times.map((t) => marketRow(good, ECONOMY, TRADE, t).priceCr);
	expect(bases[0]).not.toBeCloseTo(bases[1], 6);
});

// ---------------------------------------------------------------------------
// Obligation 8 — the universal set, Fuel included, at every displayTL
// ---------------------------------------------------------------------------

/**
 * `economy-trade.md` §7's table order — **read out of the spec**, not typed here
 * and not derived from `EQUIPMENT`.
 *
 * Derived from the array under test it could not catch that array's missing
 * first element, which is the whole of §8.5.3. Typed here it is a second copy
 * of the spec's order with nothing tying it back, and the entire tech-gate
 * mapping — `requiredDisplayTL(9) === 7` — rests on that order. Parsed, a retune
 * of §7 that does not reach `UNIVERSAL_ITEMS` turns this file red.
 */
const ECONOMY_TRADE_7 = (() => {
	const spec = readFileSync(
		new URL("../docs/specs/economy-trade.md", import.meta.url),
		"utf8",
	);
	const names: string[] = [];
	for (const line of spec.split("\n")) {
		const cells = line.split("|").map((cell) => cell.trim());
		// `| Item | Price | Where |` — the universal rows of §7's table, in the
		// order they appear. `Missile (max 4)` carries a parenthetical the item
		// list does not.
		if (cells.length !== 5 || cells[3] !== "universal") continue;
		names.push(cells[1].replace(/\s*\(.*\)$/, ""));
	}
	return names;
})();

test("the §7 order this file checks against was read out of the spec", () => {
	// The guard on the parser. A selector that matched nothing would leave every
	// assertion below comparing two empty lists and agreeing.
	expect(ECONOMY_TRADE_7.length).toBe(10);
	expect(ECONOMY_TRADE_7[0]).toBe("Fuel");
	expect(ECONOMY_TRADE_7.at(-1)).toBe("Galactic Hyperdrive");
});

test("obligation 8: Fuel is the first universal item and the one absent from EQUIPMENT", () => {
	expect(UNIVERSAL_ITEMS.map((e) => e.name)).toEqual(ECONOMY_TRADE_7);
	expect(UNIVERSAL_ITEMS.length).toBe(UNIVERSAL_GATE_CAP);
	expect(EQUIPMENT.some((e) => e.name === "Fuel")).toBe(false);
	expect(EQUIPMENT.filter((e) => e.scope === "universal").length).toBe(9);
	const fuel = UNIVERSAL_ITEMS[0];
	expect(fuel.per).toBe("ly");
	expect(fuel.priceCr).toBe(FUEL_CR_PER_LY);
});

test("obligation 8: the universal set at displayTL d is §7's order truncated to min(d + 3, 10)", () => {
	for (let d = 0; d <= 12; d += 1) {
		const expected = ECONOMY_TRADE_7.slice(0, Math.min(d + 3, 10));
		expect(universalItemsAt(d).map((e) => e.name)).toEqual(expected);
		// Membership, not length: §8.6 measured that a count check is blind from
		// d = 0 to 6, which is where the frontier stations a reader has in mind
		// live.
		expect(new Set(universalItemsAt(d).map((e) => e.name))).toEqual(
			new Set(expected),
		);
	}
});

test("obligation 8: the slice off EQUIPMENT is the trap, and it differs at every d", () => {
	// The broken build §8.5.3 describes, run here so the obligation is measured
	// against a real rival rather than against a description of one.
	const universalRows = EQUIPMENT.filter((e) => e.scope === "universal");
	for (let d = 0; d <= 12; d += 1) {
		const buggy = universalRows
			.slice(0, Math.min(d + 3, 10))
			.map((e) => e.name);
		const correct = universalItemsAt(d).map((e) => e.name);
		expect(new Set(buggy)).not.toEqual(new Set(correct));
		// Fuel is hidden at every tech level …
		expect(buggy).not.toContain("Fuel");
		// … and below saturation the count agrees, which is why the set is what
		// is asserted.
		if (d <= 6) expect(buggy.length).toBe(correct.length);
		else expect(buggy.length).toBe(9);
	}
});

test("obligation 8: the gate puts the galactic hyperdrive at displayTL 7", () => {
	// §8.5.3's named consequence of the missing first element: the broken slice
	// sells it one tech level early.
	expect(requiredDisplayTL(9)).toBe(7);
	expect(universalItemsAt(6).map((e) => e.name)).not.toContain(
		"Galactic Hyperdrive",
	);
	expect(universalItemsAt(7).map((e) => e.name)).toContain(
		"Galactic Hyperdrive",
	);
});

// ---------------------------------------------------------------------------
// Obligation 6 — the equipment screen names what is missing, and why
// ---------------------------------------------------------------------------

test("obligation 6: a low-TL trade station lists what it sells and names what it does not", () => {
	const screen = stationEquipmentScreen({ type: "trade", displayTL: 4 });
	expect(screen.available.length).toBeGreaterThan(0);
	expect(screen.unavailable.length).toBeGreaterThan(0);
	for (const entry of screen.unavailable) {
		expect(entry.reason.length).toBeGreaterThan(0);
		expect(entry.name.length).toBeGreaterThan(0);
	}
	// M8's three reason shapes, all three reachable at one frontier trade station.
	const reasons = new Set(screen.unavailable.map((e) => e.reason));
	expect(reasons).toContain("requires TL 7");
	expect(reasons).toContain("refineries only");
	expect(reasons).toContain("shipyards only");
	// The two sets are disjoint and together cover the whole catalogue —
	// `station-types.md` §4's disjointness, asserted rather than assumed.
	const shown = [
		...screen.available.map((e) => e.name),
		...screen.unavailable.map((e) => e.name),
	];
	expect(new Set(shown).size).toBe(shown.length);
	expect(new Set(shown)).toEqual(
		new Set([
			...ECONOMY_TRADE_7,
			...EQUIPMENT.filter((e) => e.scope !== "universal").map((e) => e.name),
		]),
	);
});

test("obligation 6: type exclusives are sold at their own type and named everywhere else", () => {
	const refinery = stationEquipmentScreen({ type: "refinery", displayTL: 9 });
	expect(refinery.available.map((e) => e.name)).toContain("Fuel Scoops");
	expect(refinery.available.map((e) => e.name)).toContain("Mining Laser");
	expect(refinery.unavailable.map((e) => e.reason)).toContain("shipyards only");

	const shipyard = stationEquipmentScreen({ type: "shipyard", displayTL: 11 });
	expect(shipyard.available.map((e) => e.name)).toContain("Military Laser");
	expect(shipyard.unavailable.map((e) => e.reason)).toContain(
		"refineries only",
	);
	// Saturated: every universal item is on the shelf. Asserted as the positive,
	// because the negative it replaced — no reason reads "requires TL 10" —
	// names a string `requiredDisplayTL` maxes out below and so cannot fail.
	expect(shipyard.available.map((e) => e.name)).toEqual([
		...ECONOMY_TRADE_7,
		"Extra Energy Unit",
		"Military Laser",
	]);
	expect(
		shipyard.unavailable.filter((e) => e.reason.startsWith("requires TL")),
	).toEqual([]);
});

test("§8.3: the hull section exists at a shipyard and is empty until #26", () => {
	expect(
		stationEquipmentScreen({ type: "shipyard", displayTL: 11 }).hullsSection,
	).toBe(true);
	expect(
		stationEquipmentScreen({ type: "shipyard", displayTL: 11 }).hulls,
	).toEqual([]);
	expect(
		stationEquipmentScreen({ type: "trade", displayTL: 11 }).hullsSection,
	).toBe(false);
});

// ---------------------------------------------------------------------------
// M4 and M10 — the two negatives, as laws rather than as pixels
// ---------------------------------------------------------------------------

test("M4: the console is not up during the arrival", () => {
	expect(stationConsoleVisible("arriving")).toBe(false);
	expect(stationConsoleVisible("docked")).toBe(true);
});

test("M10: the persistent flight floor is hidden the moment flight is suspended", () => {
	expect(flightFloorVisible("flying")).toBe(true);
	expect(flightFloorVisible("arriving")).toBe(false);
	expect(flightFloorVisible("docked")).toBe(false);
});

test("the traversal bounds here are the ones docking.md ratified", () => {
	// Not a tautology, and **anchored to the section rather than to the file**:
	// a whole-file `toContain` would stay green on a retune that changed the
	// bounds while any other sentence still carried the phrase.
	const prose = readFileSync(
		new URL("../docs/specs/docking.md", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	// §13.3 re-fixed E3's band, so the ratified figures are read from there.
	const start = prose.indexOf(
		"**Traversal duration scales with route length**",
	);
	const end = prose.indexOf(
		"**Both traversals are unconditionally skippable.**",
	);
	// **Both** indices guarded, not only the first. With the closing sentence
	// renamed, `indexOf` returns -1 and `slice(start, -1)` yields everything to
	// the end of the file — restoring exactly the whole-file match this slice
	// exists to close, on a green test.
	expect(start).toBeGreaterThan(0);
	expect(end).toBeGreaterThan(start);
	const e3 = prose.slice(start, end);
	expect(e3.length).toBeGreaterThan(100);
	expect(e3).toContain("about six seconds for a near");
	expect(e3).toContain("nine seconds for a deep");
	expect(TRAVERSAL_SECONDS_NEAR).toBe(6);
	expect(TRAVERSAL_SECONDS_DEEP).toBe(9);
});

test("M6: a delta that rounds to zero gets no arrow", () => {
	// **Measured on `signed` itself**, because the gallery's own moved row is
	// well above §3's floor and therefore cannot produce the case. The first
	// version of this test rendered the default view and asserted the absence of
	// "↑0.0" — which held on a build that emitted it, since no row could.
	expect(signedDelta(0.04, 1)).toBe("·0.0");
	expect(signedDelta(-0.04, 1)).toBe("·0.0");
	expect(signedDelta(0, 1)).toBe("·0.0");
	expect(signedDelta(-0, 0)).toBe("·0");
	// And the two live cases keep their arrows, or the rule above would be a
	// screen with no deltas on it at all.
	expect(signedDelta(4.83, 1)).toBe("↑4.8");
	expect(signedDelta(-12, 0)).toBe("↓12");
});
