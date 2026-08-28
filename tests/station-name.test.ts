/**
 * `docs/specs/docking.md` §12.5's decision **E9** and §12.6's headless
 * obligation 10.
 *
 * The obligation is "station names are unique within a system", asserted over
 * the same corpus `tests/station-orbits.test.ts` walks — because E9 argues
 * uniqueness *by construction* (one station per type) and construction is
 * exactly what a generator change can break with no compile error.
 */

import { describe, expect, test } from "bun:test";
import {
	STATION_DESIGNATORS,
	stationName,
	stationNames,
} from "../src/station-name";
import { LOCAL_CARRIER_ID, STATION_TYPES } from "../src/station";
import { forEachSystem } from "./helpers/station-rows";

/** The same two galaxies and world seed the placement fixture was captured
 *  over, so "the same corpus" is a fact rather than a hope. */
const WORLD_SEED = 1;
const GALAXIES = [0, 1] as const;

describe("§12.5 E9 — the name is derived, not drawn", () => {
	test("it is a pure function of the system name and the type", () => {
		// Called twice with no stream between them: a generator that drew would
		// return two different names here.
		expect(stationName("LAVE", "trade")).toBe(stationName("LAVE", "trade"));
		// And it separates on both inputs.
		expect(stationName("LAVE", "trade")).not.toBe(
			stationName("LAVE", "shipyard"),
		);
		expect(stationName("LAVE", "trade")).not.toBe(stationName("DISO", "trade"));
	});

	test("the name carries the system name and a designator of its type", () => {
		for (const type of STATION_TYPES) {
			const name = stationName("LAVE", type);
			expect(name.startsWith("LAVE ")).toBe(true);
			expect(STATION_DESIGNATORS[type]).toContain(name.slice("LAVE ".length));
		}
	});

	test("the separator cannot be forged from the inputs", () => {
		// `hash(name + " " + type)` — a system called "AB" of type "trade" and one
		// called "AB trade" of a type "" would collide under bare concatenation.
		// There is no empty station type, so this asserts the property that makes
		// that impossible rather than a case that can occur: two different input
		// pairs whose concatenations differ.
		expect(stationName("LAVE ", "trade")).not.toBe(
			stationName("LAVE", "trade"),
		);
	});
});

describe("§12.5 E9 — the designators are actually used", () => {
	/**
	 * The question `#59`'s constraint asks of any identity check: **could this
	 * pass on a build that ignored the thing it is checking?** A `stationName`
	 * that returned `words[0]` for every system would satisfy every uniqueness
	 * assertion in this file — one designator per type is still one name per
	 * type per system. This is the row that fails it.
	 */
	test("every designator of every type appears across the corpus", () => {
		const used: Record<string, Set<string>> = {};
		for (const type of STATION_TYPES) used[type] = new Set();
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents) => {
			for (const s of contents.stations)
				used[s.type].add(
					stationName(record.name, s.type).slice(record.name.length + 1),
				);
		});
		for (const type of STATION_TYPES) {
			// The outpost is not placed by `system.ts` (§12.7's joint 5), so its
			// set is legitimately empty over any corpus. Asserting coverage on it
			// would be asserting a generator change nobody has made.
			if (used[type].size === 0) {
				expect(type).toBe("outpost");
				continue;
			}
			expect([...used[type]].sort()).toEqual(
				[...STATION_DESIGNATORS[type]].sort(),
			);
		}
	});
});

describe("§12.6 obligation 10 — names are unique within a system", () => {
	test("the corpus is a real one, not an empty pass", () => {
		let systems = 0;
		let stations = 0;
		forEachSystem(WORLD_SEED, GALAXIES, (_record, contents) => {
			systems++;
			stations += contents.stations.length;
		});
		// Two galaxies of 256 systems. A vacuous corpus is the failure mode a
		// walk-and-assert test is most prone to, so the count is pinned exactly
		// rather than by a threshold — `#25` records why a `>` is not a
		// measurement.
		expect(systems).toBe(512);
		expect(stations).toBeGreaterThan(500);
	});

	test("no system carries two stations of the same name", () => {
		const collisions: string[] = [];
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents, g) => {
			const names = contents.stations.map((s) =>
				stationName(record.name, s.type),
			);
			if (new Set(names).size !== names.length)
				collisions.push(`g${g} ${record.index} ${record.name}: ${names}`);
		});
		expect(collisions).toEqual([]);
	});
});

describe("§12.5 — the stated remedy ships with its detecting test", () => {
	test("a second station of one type takes a discriminator", () => {
		// Two trade stations in one system — the generator change E9 says cannot
		// be caught at compile time. Their carrier ids differ, because a shared
		// one would already have merged their market memory (§5.5) and the name
		// would be the least of it.
		const names = stationNames("LAVE", [
			{ type: "trade", localCarrierId: "station-trade" },
			{ type: "trade", localCarrierId: "station-trade-2" },
			{ type: "shipyard", localCarrierId: LOCAL_CARRIER_ID.shipyard },
		]);
		expect(new Set(names).size).toBe(3);
		// **Appended**, so an existing station's name never moves when a second
		// one appears beside it — §12.5 fixes the direction, not just the fact.
		for (const n of names.slice(0, 2))
			expect(n.startsWith(stationName("LAVE", "trade"))).toBe(true);
		expect(names[0]).toContain("station-trade");
		expect(names[1]).toContain("station-trade-2");
		// The station that was never ambiguous is untouched.
		expect(names[2]).toBe(stationName("LAVE", "shipyard"));
	});

	test("an ordinary system takes no discriminator", () => {
		const names = stationNames(
			"LAVE",
			STATION_TYPES.filter((t) => t !== "outpost").map((type) => ({
				type,
				localCarrierId: LOCAL_CARRIER_ID[type],
			})),
		);
		expect(names).toEqual([
			stationName("LAVE", "trade"),
			stationName("LAVE", "shipyard"),
			stationName("LAVE", "refinery"),
		]);
	});
});
