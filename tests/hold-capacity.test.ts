/**
 * Every hold reader reads the capacity projection (#928, #873): NPCs pass
 * their stock loadout to `fittedCapacity`, the commander's hold delegates to
 * it, and no other source reads a bare `HULL_SPECS[...].holdT`.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import {
	fittedCapacity,
	type Loadout,
	makeModule,
	moduleRow,
	stockLoadout,
} from "../src/loadout";
import { commanderHold, newCommander } from "../src/station-commerce";

const RACK_1E = makeModule("cargo-rack", 1, "E");
const RACK_2A = makeModule("cargo-rack", 2, "A");

describe("the projection carries the hold", () => {
	test("every hull's stock loadout holds the hull's bare hold: what an NPC read before", () => {
		for (const id of HULL_IDS)
			expect(fittedCapacity(id, stockLoadout(id)).holdT).toBe(
				HULL_SPECS[id].holdT,
			);
	});

	test("a courier with a 1E rack holds 30 t; every rack's cargoT adds", () => {
		expect(HULL_SPECS.courier.holdT).toBe(20);
		expect(moduleRow(RACK_1E).output.cargoT).toBe(10);
		const fit = (extra: Record<string, typeof RACK_1E>): Loadout => ({
			...stockLoadout("courier"),
			...extra,
		});
		expect(fittedCapacity("courier", fit({ i1: RACK_1E })).holdT).toBe(30);
		expect(
			fittedCapacity("courier", fit({ i1: RACK_1E, i2: RACK_1E })).holdT,
		).toBe(40);
	});
});

describe("the commander's hold reads the projection", () => {
	/** What `holdCapacityT` summed before #928, written out as the oracle. */
	const before = (hull: (typeof HULL_IDS)[number], loadout: Loadout) =>
		HULL_SPECS[hull].holdT +
		Object.values(loadout).reduce(
			(n, m) =>
				n + (m.module === "cargo-rack" ? moduleRow(m).output.cargoT : 0),
			0,
		);

	test("a commander with racks holds today's tonnes, read from fittedCapacity", () => {
		for (const hull of ["courier", "freighter"] as const) {
			const c = newCommander(hull);
			const racked = {
				...c,
				loadout: { ...c.loadout, i1: RACK_1E, i2: RACK_2A } as Loadout,
			};
			const projected = fittedCapacity(hull, racked.loadout).holdT;
			expect(commanderHold(racked, 0).capacityT).toBe(projected);
			expect(projected).toBe(before(hull, racked.loadout));
			expect(commanderHold(c, 0).capacityT).toBe(HULL_SPECS[hull].holdT);
		}
	});
});

/** Reads a bare hull hold: an index into `HULL_SPECS` followed by `.holdT`,
 *  `holdT` destructured out of one, or a name bound to one (`const spec =
 *  HULL_SPECS[hull]`) read for `.holdT` anywhere in the file. */
const BARE_HOLD = [
	/HULL_SPECS\s*\[[^\]]*\]\s*\??\.\s*holdT\b/,
	/\{[^}]*\bholdT\b[^}]*\}\s*=\s*HULL_SPECS\s*\[/,
	/\b(?:const|let|var)\s+(\w+)\s*=\s*HULL_SPECS\s*\[[\s\S]*\b\1\s*\??\.\s*holdT\b/,
];
/** Who may read the bare hold, and why: the hull row itself; the projection;
 *  `HOLD_REFERENCE_T`, a reference constant rather than a hold. */
const ALLOWED = ["src/hull.ts", "src/loadout.ts", "src/market.ts"];

const ROOT = join(import.meta.dir, "..");
const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? sources(join(dir, e.name))
			: /\.ts$/.test(e.name)
				? [join(dir, e.name)]
				: [],
	);
const readers = sources(join(ROOT, "src"))
	.filter((f) => BARE_HOLD.some((re) => re.test(readFileSync(f, "utf8"))))
	.map((f) => relative(ROOT, f).split("\\").join("/"))
	.sort();

describe("no hold reader outside the projection reads the bare hull row", () => {
	test("the scan catches every shape", () => {
		expect(BARE_HOLD[0].test("HULL_SPECS[actor.hullId].holdT")).toBe(true);
		expect(BARE_HOLD[0].test("HULL_SPECS[\n\tid\n]?.holdT")).toBe(true);
		expect(BARE_HOLD[1].test("const { holdT } = HULL_SPECS[hull]")).toBe(true);
		expect(
			BARE_HOLD[2].test(
				"const spec = HULL_SPECS[hull];\n\tlet h = spec.holdT;",
			),
		).toBe(true);
		expect(BARE_HOLD.some((re) => re.test("fittedCapacity(h, l).holdT"))).toBe(
			false,
		);
	});

	test("only the allowlisted files read HULL_SPECS[...].holdT", () => {
		expect(readers.filter((f) => !ALLOWED.includes(f))).toEqual([]);
	});

	test("every allowlisted file still reads it: no dead entry", () => {
		expect(ALLOWED.filter((f) => !readers.includes(f))).toEqual([]);
	});
});
