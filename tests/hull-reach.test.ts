/**
 * #554: the flown hull's tank and charge are what the game reads (#185's
 * rulings). A hull's `tankLy` is its jump range **and** its fuel capacity, one
 * number; its `chargeAu` is its drive charge. `JUMP_RANGE_LY` stays the
 * galaxy's connectivity predicate and is nobody's jump gate.
 *
 * Two shapes of row. The **source rows** fail if a call site hands the router,
 * the gate or the tank the galaxy's constant — the compiler already refuses an
 * omitted `maxJump`, so what is left to catch is someone passing the wrong
 * one. The **behaviour rows** fly a short and a long hull through the same
 * law and demand different answers, because a row that only flies the courier
 * passes on a build that still reads the constant.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chargeAfterRegen } from "../src/cruise";
import {
	JUMP_RANGE_LY,
	distanceLy,
	generateGalaxy,
	neighbours,
	startSystem,
} from "../src/galaxy";
import {
	FINDER_NO_ROUTE,
	finderDefaultFilter,
	finderReachLabel,
	projectFinder,
} from "../src/galaxy-finder";
import { HULL_SPECS, PURCHASABLE_HULL_IDS } from "../src/hull";
import { hullReachFrom } from "../src/hull-reach";
import { planJump } from "../src/hyperspace";
import { NO_EXCLUDED_STATION, deliveryCandidates } from "../src/jobs";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { newCommander } from "../src/station-commerce";
import { generateContents } from "../src/system";
import { newWorld } from "../src/world-state";

const SRC = join(import.meta.dir, "..", "src");
/** Every module under `src/`, recursively, as a path relative to it. */
const sources = (readdirSync(SRC, { recursive: true }) as string[])
	.filter((f) => f.endsWith(".ts"))
	.map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));
/** The source with block and line comments blanked, so a docstring may name
 *  the constant and code may not. Naive about `//` or `/*` inside a string
 *  literal, which can only make the row **looser**: it blanks real code after
 *  such a string, and a reader hidden there would pass. */
const code = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const SEED = 20260902;
const GALAXY = generateGalaxy(SEED, 0);
const SYSTEMS = GALAXY.systems;

describe("#554 — no call site reads the galaxy's constant as a hull's", () => {
	test("only galaxy.ts names JUMP_RANGE_LY in code", () => {
		// Comments may name it — the docstrings that say what it now means have
		// to. Code may not, in any form: a named import, `galaxy.JUMP_RANGE_LY`
		// through a namespace import, or a re-export.
		const readers = sources
			.filter(({ file }) => file !== "galaxy.ts")
			.filter(({ text }) => /\bJUMP_RANGE_LY\b/.test(code(text)))
			.map(({ file }) => file);
		expect(readers).toEqual([]);
		// And the row reaches something: the file that owns it does name it.
		expect(
			sources.some(
				({ file, text }) =>
					file === "galaxy.ts" && /\bJUMP_RANGE_LY\b/.test(code(text)),
			),
		).toBe(true);
	});

	test("the retired single-hull tank and charge constants are gone", () => {
		// Each was a module constant, and a module constant cannot read a hull.
		for (const name of ["JUMP_TANK_LY", "FUEL_TANK_LY", "CHARGE_CAPACITY_AU"]) {
			const declares = sources
				.filter(({ text }) => new RegExp(`export const ${name}\\b`).test(text))
				.map(({ file }) => file);
			expect([name, declares]).toEqual([name, []]);
		}
	});

	test("the courier's tank is still the reach at which every galaxy connects", () => {
		// D2: the constant keeps its meaning, and the meaning is one hull's.
		expect(HULL_SPECS.courier.tankLy).toBe(JUMP_RANGE_LY);
	});
});

describe("#554 D1 — the jump gate is the flown hull's tank", () => {
	const home = startSystem(GALAXY);
	const byDistance = SYSTEMS.filter((s) => s.index !== home.index)
		.map((s) => ({ s, d: distanceLy(home.pos, s.pos) }))
		.sort((a, b) => a.d - b.d);
	const between = (lo: number, hi: number) =>
		byDistance.find(({ d }) => d > lo && d <= hi)?.s;

	test("an interceptor is refused a jump a courier may make", () => {
		const target = between(HULL_SPECS.interceptor.tankLy, JUMP_RANGE_LY);
		expect(target).toBeDefined();
		if (!target) return;
		// Both tanks brim-full, so the only difference is the gate.
		expect(
			planJump(home, target, HULL_SPECS.interceptor.tankLy, "interceptor"),
		).toEqual({ ok: false, refusal: "out-of-range" });
		expect(planJump(home, target, JUMP_RANGE_LY, "courier").ok).toBe(true);
	});

	test("an explorer may jump past the galaxy's constant", () => {
		const target = between(JUMP_RANGE_LY, HULL_SPECS.explorer.tankLy);
		expect(target).toBeDefined();
		if (!target) return;
		expect(
			planJump(home, target, HULL_SPECS.explorer.tankLy, "explorer").ok,
		).toBe(true);
		expect(planJump(home, target, JUMP_RANGE_LY, "courier")).toEqual({
			ok: false,
			refusal: "out-of-range",
		});
	});
});

describe("#554 D1 — the tank holds the flown hull's tankLy", () => {
	test("a new commander starts brim-full for their own hull", () => {
		for (const id of PURCHASABLE_HULL_IDS)
			expect([id, newCommander(id).fuelLy]).toEqual([
				id,
				HULL_SPECS[id].tankLy,
			]);
	});

	test("a saved tank or charge above the hull's is clamped on load, not refused", () => {
		const base = newCommanderRecord("interceptor");
		const record = {
			...base,
			state: { ...base.state, fuelLy: 7 },
			chargeAu: 12,
		};
		const back = parseSave(
			serializeSave({ world: newWorld(SEED), commander: record }),
		);
		expect(back.commander.state.fuelLy).toBe(HULL_SPECS.interceptor.tankLy);
		expect(back.commander.chargeAu).toBe(HULL_SPECS.interceptor.chargeAu);
	});

	test("a saved tank inside the hull's is left alone", () => {
		const base = newCommanderRecord("explorer");
		const record = {
			...base,
			state: { ...base.state, fuelLy: 8.25 },
			chargeAu: 14.5,
		};
		const back = parseSave(
			serializeSave({ world: newWorld(SEED), commander: record }),
		);
		expect(back.commander.state.fuelLy).toBe(8.25);
		expect(back.commander.chargeAu).toBe(14.5);
	});
});

describe("#554 D6 — the drive charge is the flown hull's", () => {
	test("regeneration stops at the hull's charge, at one rate for every hull", () => {
		for (const id of ["interceptor", "explorer"] as const) {
			const cap = HULL_SPECS[id].chargeAu;
			expect([id, chargeAfterRegen(0, 3600, cap)]).toEqual([id, cap]);
		}
		// Same rate: a minute from empty is the same whatever the ceiling.
		expect(chargeAfterRegen(0, 60, HULL_SPECS.interceptor.chargeAu)).toBe(
			chargeAfterRegen(0, 60, HULL_SPECS.explorer.chargeAu),
		);
	});
});

describe("#554 D3 — the shipyard's law: a hull with no reach from here", () => {
	test("reach is the count of systems within the hull's tank", () => {
		// Against a brute-force distance filter rather than `reachable`, which
		// is what the law calls — a shared defect would pass both sides.
		const here = startSystem(GALAXY);
		const within = (tankLy: number) =>
			SYSTEMS.filter(
				(s) => s.index !== here.index && distanceLy(here.pos, s.pos) <= tankLy,
			).length;
		for (const id of PURCHASABLE_HULL_IDS) {
			const n = within(HULL_SPECS[id].tankLy);
			expect([id, hullReachFrom(SYSTEMS, here, id)]).toEqual([
				id,
				n === 0 ? { ok: false, refusal: "no-reach" } : { ok: true, systems: n },
			]);
		}
		// And the count moves with the tank, so the law reads the hull's.
		const count = (id: "interceptor" | "courier" | "explorer") => {
			const r = hullReachFrom(SYSTEMS, here, id);
			return r.ok ? r.systems : 0;
		};
		expect(count("interceptor")).toBeLessThan(count("explorer"));
		expect(count("interceptor")).toBeLessThanOrEqual(count("courier"));
		expect(count("courier")).toBeLessThanOrEqual(count("explorer"));
	});

	test("an isolated system refuses a short hull and sells a long one", () => {
		// 474 systems had no edge at 5 LY over #185's 24 galaxies; find one here.
		const isolated = SYSTEMS.find(
			(s) => neighbours(SYSTEMS, s, HULL_SPECS.interceptor.tankLy).length === 0,
		);
		expect(isolated).toBeDefined();
		if (!isolated) return;
		expect(hullReachFrom(SYSTEMS, isolated, "interceptor")).toEqual({
			ok: false,
			refusal: "no-reach",
		});
		expect(hullReachFrom(SYSTEMS, isolated, "courier").ok).toBe(true);
	});
});

describe("#554 D5 — the job board draws within the flown hull's reach", () => {
	test("no posting lies past a short tank, and a long tank reaches further", () => {
		const home = startSystem(GALAXY);
		const board = (tankLy: number) =>
			deliveryCandidates(
				SYSTEMS,
				home,
				generateContents,
				NO_EXCLUDED_STATION,
				tankLy,
			);
		const short = board(HULL_SPECS.interceptor.tankLy);
		const long = board(HULL_SPECS.explorer.tankLy);
		for (const d of short)
			expect(d.distanceLy).toBeLessThanOrEqual(HULL_SPECS.interceptor.tankLy);
		expect(long.length).toBeGreaterThan(short.length);
		expect(long.some((d) => d.distanceLy > JUMP_RANGE_LY)).toBe(true);
	});
});

describe("#554 D4 — the Navigation list marks a system this hull cannot reach", () => {
	test("a name query for a system cut off at 5 LY reads no route, and routes at 7", () => {
		const home = startSystem(GALAXY);
		const find = (tankLy: number, name: string) => {
			const r = projectFinder(
				SYSTEMS,
				home,
				{ ...finderDefaultFilter(), query: name },
				{ maxJump: tankLy },
			);
			return [...r.inBudget, ...r.beyondRange].find((row) => row.name === name);
		};
		// A system in another component from home at the interceptor's tank:
		// isolated systems are the plainest such case.
		const cutOff = SYSTEMS.find(
			(s) =>
				s.index !== home.index &&
				neighbours(SYSTEMS, s, HULL_SPECS.interceptor.tankLy).length === 0,
		);
		expect(cutOff).toBeDefined();
		if (!cutOff) return;
		const short = find(HULL_SPECS.interceptor.tankLy, cutOff.name);
		const courier = find(HULL_SPECS.courier.tankLy, cutOff.name);
		expect(short?.jumps).toBeNull();
		expect(short && finderReachLabel(short)).toBe(FINDER_NO_ROUTE);
		// The courier's reach is the galaxy's connectivity guarantee.
		expect(courier?.jumps).toBeGreaterThan(0);
		expect(courier && finderReachLabel(courier)).not.toBe(FINDER_NO_ROUTE);
	});
});
