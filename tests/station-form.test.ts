/**
 * Node #717: every system draws its stations' forms from its own seed.
 *
 * The rows here are the node's headless half — the same seed gives the same
 * forms, every member of every pool is reached over a seed spread, and the
 * draw is keyed by the type slot rather than by position in a station list // glossary-ignore: slot
 * whose length varies. The rest of the obligation is carried where it was
 * already measured: the per-form rows (reach, proxy, mesh, interior, finish,
 * glow) iterate `FORMS_IN_PLAY`, so a form added to a pool is measured by
 * those. Rows that build one named form — the Works' own parts, the
 * Coriolis and the Gantry in `collision-stations`, the docking computer's
 * `HISTORICAL_FORM` — do not reach it; node #717's receipt lists the ones its
 * searches find. The station-field and orbit baselines
 * (`tests/station.test.ts`, `tests/station-orbits.test.ts`,
 * `tests/cold-rocky-moons.test.ts`) hold that no existing stream moved.
 *
 * The refinery ships four forms (node #745) and the shipyard three (node
 * #746); node #748 completes the trade pool with the Wheel.
 * Reach, uniformity and slot independence also run on stand-in pools of // glossary-ignore: slot
 * several members through the same draw.
 */

import { describe, expect, test } from "bun:test";
import { DOMAIN } from "../src/domains";
import { generateGalaxy } from "../src/galaxy";
import {
	DRAWN_STATION_TYPES,
	type DrawnStationType,
	OUTPOST_FORM,
	STATION_FORM_POOL,
	STATION_TYPES,
	type StationFormId,
	formsInPlay,
} from "../src/station";
import {
	STATION_FORM_SLOT,
	drawStationForm,
	stationForms,
} from "../src/station-form";
import {
	STATION_FORMS,
	buildStationMesh,
	stationSilhouetteKm,
	updateStationVisuals,
} from "../src/station-mesh";
import { stationProxyOf, stationProxy } from "../src/station-proxy";
import { generateContents } from "../src/system";
import { FORMS_IN_PLAY, stationInForm } from "./helpers/forms-in-play";
import { forEachSystem } from "./helpers/station-rows";

const WORLD_SEED = 1;
const GALAXIES = [0, 1] as const;
const GREY = 0x9aa6b2;

/** Every system seed in two galaxies: 512 systems, each its own draw. */
const SYSTEM_SEEDS = GALAXIES.flatMap((g) =>
	generateGalaxy(WORLD_SEED, g).systems.map((record) => record.seed),
);

/** A stand-in pool of several members, for the rows that must be able to fail
 *  on a pool of more than one. Not a proposal for any role's pool. */
const STAND_IN: Record<DrawnStationType, readonly StationFormId[]> = {
	trade: ["a", "b", "c", "d", "e"],
	shipyard: ["a", "b", "c"],
	refinery: ["a", "b", "c", "d"],
};

/** Chi-square critical values at p = 0.001, by degrees of freedom (index). */
const CHI_SQUARE_P001: readonly (number | undefined)[] = [
	undefined,
	10.828,
	13.816,
	16.266,
	18.467,
	20.515,
];

describe("the pools", () => {
	test("its tag is appended, and every drawn role owns a distinct slot", () => {
		// glossary-ignore: slot
		expect(DOMAIN.STATION_FORM).toBe(33);
		expect(STATION_FORM_SLOT).toEqual({ trade: 1, shipyard: 2, refinery: 3 });
		expect(new Set(Object.values(STATION_FORM_SLOT)).size).toBe(
			DRAWN_STATION_TYPES.length,
		);
	});

	test("every drawn role has a non-empty pool of forms the renderer builds, without repeats", () => {
		for (const type of DRAWN_STATION_TYPES) {
			const pool = STATION_FORM_POOL[type];
			expect([type, pool.length > 0]).toEqual([type, true]);
			expect([type, new Set(pool).size]).toEqual([type, pool.length]);
			for (const id of pool)
				expect([
					type,
					id,
					STATION_FORMS[type].some((f) => f.id === id),
				]).toEqual([type, id, true]);
		}
	});

	test("the outpost is not drawn: its one form is the fiction's", () => {
		expect(DRAWN_STATION_TYPES).not.toContain("outpost");
		expect(formsInPlay("outpost")).toEqual([OUTPOST_FORM]);
		expect(OUTPOST_FORM).toBe("e");
		// And the drawn roles are every other role, so no role is left with
		// no answer.
		expect([...DRAWN_STATION_TYPES, "outpost"].sort()).toEqual(
			[...STATION_TYPES].sort(),
		);
	});

	test("every drawn role holds every built form in id order", () => {
		// Pinned so that growing a pool is a deliberate edit with a red row
		// beside it, not a side effect. Node #744 ratified every built form,
		// uniformly drawn; nodes #745–#748 grow the three pools.
		expect(STATION_FORM_POOL).toEqual({
			trade: ["a", "b", "c", "d", "e"],
			shipyard: ["a", "b", "c"],
			refinery: ["a", "b", "c", "d"],
		});
	});
});

describe("the draw", () => {
	test("the same system seed always draws the same forms", () => {
		for (const seed of SYSTEM_SEEDS.slice(0, 64)) {
			expect(stationForms(seed)).toEqual(stationForms(seed));
			expect(stationForms(seed, STAND_IN)).toEqual(
				stationForms(seed, STAND_IN),
			);
		}
	});

	test("a generated station carries its system's draw, and the same record regenerates the same forms", () => {
		let stations = 0;
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents) => {
			const forms = stationForms(record.seed);
			const again = generateContents(record).stations.map((s) => s.formId);
			expect(contents.stations.map((s) => s.formId)).toEqual(again);
			for (const station of contents.stations) {
				stations++;
				const expected =
					station.type === "outpost" ? OUTPOST_FORM : forms[station.type];
				expect([station.id, station.formId]).toEqual([station.id, expected]);
				expect(formsInPlay(station.type)).toContain(station.formId);
			}
		});
		expect(stations).toBeGreaterThan(500);
	});

	test("every member of every pool is reached over the seed spread", () => {
		// Over the shipped pools, every generated station of every role…
		const seen = new Map<string, Set<StationFormId>>();
		forEachSystem(WORLD_SEED, GALAXIES, (_record, contents) => {
			for (const station of contents.stations) {
				const set = seen.get(station.type) ?? new Set();
				set.add(station.formId);
				seen.set(station.type, set);
			}
		});
		for (const type of STATION_TYPES)
			expect([type, [...(seen.get(type) ?? [])].sort()]).toEqual([
				type,
				[...formsInPlay(type)].sort(),
			]);
		// …and over a pool of several, which is the case that can fail.
		for (const type of DRAWN_STATION_TYPES) {
			const reached = new Set(
				SYSTEM_SEEDS.map((seed) => stationForms(seed, STAND_IN)[type]),
			);
			expect([type, [...reached].sort()]).toEqual([
				type,
				[...STAND_IN[type]].sort(),
			]);
		}
	});

	test("within a pool the draw is uniform", () => {
		// Equal shares, ratified by node #744. 512 draws a role. Two holds,
		// because one cannot carry the name: a share is held to ±40% of its expectation,
		// which a draw stuck on one member fails by far, and the counts'
		// chi-square is held under its p = 0.001 critical value, which a draw
		// leaning on one member fails where every share is still inside ±40%.
		for (const pools of [STATION_FORM_POOL, STAND_IN])
			for (const type of DRAWN_STATION_TYPES) {
				const pool = pools[type];
				const counts = new Map<StationFormId, number>();
				for (const seed of SYSTEM_SEEDS) {
					const id = stationForms(seed, pools)[type];
					counts.set(id, (counts.get(id) ?? 0) + 1);
				}
				const expected = SYSTEM_SEEDS.length / pool.length;
				const chiSquare = pool.reduce(
					(sum, id) => sum + ((counts.get(id) ?? 0) - expected) ** 2 / expected,
					0,
				);
				const critical = CHI_SQUARE_P001[pool.length - 1];
				expect([
					type,
					critical !== undefined,
					chiSquare < (critical ?? 0),
				]).toEqual([type, true, true]);
				for (const id of pool) {
					const share = (counts.get(id) ?? 0) / expected;
					expect([type, id, share > 0.6 && share < 1.4]).toEqual([
						type,
						id,
						true,
					]);
				}
			}
	});

	test("the slots are separate streams: one role's form does not decide another's", () => {
		// Three pools of three, drawn per slot. If two slots shared a stream // glossary-ignore: slot
		// they would agree on every seed; independent, they agree about one
		// time in three.
		const three: Record<DrawnStationType, readonly StationFormId[]> = {
			trade: ["a", "b", "c"],
			shipyard: ["a", "b", "c"],
			refinery: ["a", "b", "c"],
		};
		const pairs: [DrawnStationType, DrawnStationType][] = [
			["trade", "shipyard"],
			["trade", "refinery"],
			["shipyard", "refinery"],
		];
		for (const [x, y] of pairs) {
			let same = 0;
			for (const seed of SYSTEM_SEEDS) {
				const forms = stationForms(seed, three);
				if (forms[x] === forms[y]) same++;
			}
			const rate = same / SYSTEM_SEEDS.length;
			expect([x, y, rate > 0.2 && rate < 0.47]).toEqual([x, y, true]);
		}
	});

	test("a system without a refinery draws its shipyard's form as one with a refinery does", () => {
		// #109's hazard: a draw consumed in station order hands a beltless
		// system's shipyard the refinery's position. The draw is per slot and // glossary-ignore: slot
		// reads no station list, so a beltless shipyard's form is its slot's. // glossary-ignore: slot
		let checked = 0;
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents) => {
			if (contents.belt) return;
			const shipyard = contents.stations.find((s) => s.type === "shipyard");
			if (!shipyard) return;
			expect(contents.stations.some((s) => s.type === "refinery")).toBe(false);
			expect(shipyard.formId).toBe(stationForms(record.seed).shipyard);
			checked++;
		});
		expect(checked).toBeGreaterThan(0);
	});

	test("one draw from a pool, whatever its size", () => {
		for (const pool of [
			["a"],
			["a", "b"],
			["a", "b", "c", "d", "e"],
		] as const) {
			let calls = 0;
			const rand = () => {
				calls++;
				return 0.999999;
			};
			expect(drawStationForm(rand, pool)).toBe(pool[pool.length - 1]);
			expect(calls).toBe(1);
		}
		expect(() => drawStationForm(() => 0.5, [])).toThrow();
	});

	test("a pool edit re-draws its role: half the systems on an append, 2/n on a swap of two", () => {
		// `STATION_FORM_POOL`'s doc states these shares; this is what holds them.
		// `floor(roll × n)` keeps a system's member through n → n + 1 for a share
		// of Σ ((i + 1)/(n + 1) − i/n) = ½, and a swap moves exactly the two
		// members' shares. The bands are wide; the seeds are fixed.
		const movedShare = (
			before: readonly StationFormId[],
			after: readonly StationFormId[],
		) => {
			const moved = SYSTEM_SEEDS.filter(
				(seed) =>
					stationForms(seed, { ...STAND_IN, trade: before }).trade !==
					stationForms(seed, { ...STAND_IN, trade: after }).trade,
			).length;
			return moved / SYSTEM_SEEDS.length;
		};
		const pools: StationFormId[][] = [
			["a"],
			["a", "b"],
			["a", "b", "c"],
			["a", "b", "c", "d"],
			["a", "b", "c", "d", "e"],
		];
		for (let n = 1; n < pools.length; n++) {
			const share = movedShare(pools[n - 1], pools[n]);
			expect([n, share > 0.4 && share < 0.6]).toEqual([n, true]);
		}
		const swapped = movedShare(
			["a", "b", "c", "d", "e"],
			["b", "a", "c", "d", "e"],
		);
		expect(swapped > 0.3 && swapped < 0.5).toBe(true);
	});
});

describe("the mesh, the reach and the proxy read the one field", () => {
	test("a generated trade station still refuses a drawn form with no proxy", () => {
		// Every built trade form now has a proxy. Inject an unsupported runtime
		// form into the pool so the generator, not a hand-made station, draws it.
		const unsupported = "unsupported" as StationFormId;
		const pool = STATION_FORM_POOL.trade;
		try {
			STATION_FORM_POOL.trade = [unsupported];
			const station = generateContents(
				generateGalaxy(WORLD_SEED, 0).systems[0],
			).stations.find((s) => s.type === "trade");
			if (!station) throw new Error("system 0 generates no trade station");
			expect(station.formId).toBe(unsupported);
			expect(() => stationProxyOf(station)).toThrow(
				"trade form unsupported has no proxy",
			);
		} finally {
			STATION_FORM_POOL.trade = pool;
		}
	});
	test("a generated refinery with an unsupported form still refuses its proxy", () => {
		for (const g of GALAXIES) {
			for (const record of generateGalaxy(WORLD_SEED, g).systems) {
				const station = generateContents(record).stations.find(
					(s) => s.type === "refinery",
				);
				if (!station) continue;
				expect(() => stationProxyOf({ ...station, formId: "e" })).toThrow(
					"refinery form e has no proxy",
				);
				return;
			}
		}
		throw new Error("the corpus generates no refinery");
	});
	test("a generated shipyard with an unsupported form still refuses its proxy", () => {
		// The guard is kept, not loosened (node #746): every built shipyard form
		// is pooled, so the form here is one the role does not build.
		expect(STATION_FORMS.shipyard.map((f) => f.id)).not.toContain("d");
		for (const g of GALAXIES) {
			for (const record of generateGalaxy(WORLD_SEED, g).systems) {
				const station = generateContents(record).stations.find(
					(s) => s.type === "shipyard",
				);
				if (!station) continue;
				expect(() => stationProxyOf({ ...station, formId: "d" })).toThrow(
					"shipyard form d has no proxy",
				);
				return;
			}
		}
		throw new Error("the corpus generates no shipyard");
	});
	const first = (() => {
		const contents = generateContents(generateGalaxy(WORLD_SEED, 0).systems[0]);
		const station = contents.stations[0];
		if (!station) throw new Error("system 0 places no station");
		return station;
	})();

	test("the mesh is built in the station's own form, and carries that form's reach", () => {
		for (const [type, formId] of FORMS_IN_PLAY) {
			const mesh = buildStationMesh(stationInForm(type, formId), GREY);
			expect([type, mesh.formId]).toEqual([type, formId]);
			expect([type, mesh.silhouetteKm]).toEqual([
				type,
				stationSilhouetteKm(type, formId),
			]);
			mesh.dispose();
		}
	});

	test("the detail band measures range in the station's own reach, not its role's", () => {
		// Two handles of one role that differ only in the reach they carry must
		// drop detail at different ranges — which a per-type figure cannot do.
		const near = buildStationMesh(first, GREY);
		const far = buildStationMesh(first, GREY);
		far.silhouetteKm = near.silhouetteKm * 100;
		const rangeKm = near.silhouetteKm * 1000;
		updateStationVisuals(near, 0, rangeKm, "high");
		updateStationVisuals(far, 0, rangeKm, "high");
		expect(near.detail).toBe("outline");
		expect(far.detail).not.toBe("outline");
		near.dispose();
		far.dispose();
	});

	test("the sim's proxy is the station's own form's", () => {
		const proxy = stationProxyOf(first);
		expect(JSON.stringify(proxy)).toBe(
			JSON.stringify(
				stationProxy(
					first.type,
					first.formId,
					first.berthSeed,
					first.assemblySeed,
				),
			),
		);
	});

	test("the proxy cache is keyed on the form: a second form at the same seeds is not handed the first's", () => {
		// The Wheel must get its own proxy at the Coriolis's seeds, and an
		// unsupported form must be refused rather than given either cached one.
		const seeds = { berthSeed: 913, assemblySeed: 917 };
		const a = stationProxyOf({ type: "trade", formId: "a", ...seeds });
		const e = stationProxyOf({ type: "trade", formId: "e", ...seeds });
		expect(e).not.toBe(a);
		expect(e.spinning).not.toEqual(a.spinning);
		expect(() =>
			stationProxyOf({
				type: "trade",
				formId: "unsupported" as StationFormId,
				...seeds,
			}),
		).toThrow(/has no proxy/);
	});
});
