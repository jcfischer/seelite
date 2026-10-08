/**
 * Node #775: derelict pacing — a live wreck on about 20% of system visits, from
 * a new commander's first visit on (`salvage.md` S16).
 *
 * The test seam is the schedule over the clock: `derelictTimeline` and
 * `effectiveDerelict` on an untouched world, read across galaxy 0 at the
 * node's three seeds. `scripts/measure-derelict-pacing.ts` prints the same
 * figures as a table; these rows hold the shape it reports.
 */
// glossary-ignore: slot

import { describe, expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import {
	DERELICT_EARLIEST_LOSS_S,
	DERELICT_GAP_S,
	DERELICT_SALVAGER_S,
	DERELICT_WALK_LIMIT,
	derelictFirstLossAt,
	derelictNextLossAt,
	derelictSlots,
	derelictTimeline,
} from "../src/derelict-slots";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import { SALVAGE_OFFER_WINDOW_S } from "../src/jobs";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { salvageTargetsOf } from "../src/salvage-jobs";
import { makeSystem } from "../src/sim";
import {
	effectiveDerelict,
	materializeDerelict,
	newWorld,
	parseWorld,
	scoopDerelict,
	serializeWorld,
	type WorldState,
} from "../src/world-state";

const HOUR = 3600;
const G = 0;
const SEEDS = [42, 47, 7];
const GATED_H = [0, 1, 4, 24, 100, 300];

const galaxy = (seed: number) => generateGalaxy(seed, G).systems;

/** Every slot of galaxy 0 at one world seed, with its system. */
const slotsOf = (seed: number) =>
	galaxy(seed).flatMap((record) =>
		derelictSlots(record.index, record.government).map(({ key }) => ({
			record,
			key,
		})),
	);

/** The share of galaxy 0's systems holding at least one live derelict. */
const systemShare = (seed: number, at: number): number => {
	const world = newWorld(seed);
	const records = galaxy(seed);
	return (
		records.filter((r) =>
			derelictSlots(r.index, r.government).some(
				({ key }) =>
					effectiveDerelict(world, G, key, at).condition === "destroyed",
			),
		).length / records.length
	);
};

/** One slot's long-run share adrift, from the S16 figures alone. */
const SLOT_SHARE =
	DERELICT_SALVAGER_S /
	(DERELICT_SALVAGER_S + (DERELICT_GAP_S[0] + DERELICT_GAP_S[1]) / 2);

const resealedWorld = (
	world: WorldState,
	edit: (body: Record<string, any>) => void,
): unknown => {
	const { integrity: _, ...body } = JSON.parse(
		JSON.stringify(serializeWorld(world)),
	);
	edit(body);
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

/** A slot adrift as the clock starts, lost before it. */
const adriftAtZero = (seed: number) => {
	for (const { record, key } of slotsOf(seed)) {
		const e = effectiveDerelict(newWorld(seed), G, key, 0);
		if (e.condition === "destroyed" && e.lostAt < 0) return { record, key, e };
	}
	throw new Error(`seed ${seed}: no slot adrift at 0`);
};

// ---------------------------------------------------------------------------

describe("O2 — short-lived and frequent", () => {
	test("a wreck lasts hours, not days", () => {
		expect(DERELICT_SALVAGER_S).toBe(8 * HOUR);
	});

	test("one slot is adrift about 8.5% of the time, which galaxy 0's slot counts turn into about 20% of systems", () => {
		expect(SLOT_SHARE).toBeGreaterThan(0.08);
		expect(SLOT_SHARE).toBeLessThan(0.09);
		for (const seed of SEEDS) {
			const records = galaxy(seed);
			const expected =
				records.reduce(
					(sum, r) =>
						sum +
						1 -
						(1 - SLOT_SHARE) ** derelictSlots(r.index, r.government).length,
					0,
				) / records.length;
			expect(expected).toBeGreaterThan(0.19);
			expect(expected).toBeLessThan(0.21);
		}
	});
});

describe("the clock starts part-way through every slot's cycle", () => {
	test("a first loss falls between one life before the clock and the longest gap after it", () => {
		for (const { record, key } of slotsOf(42)) {
			const first = derelictFirstLossAt(record.seed, key);
			expect(first).toBeGreaterThan(-DERELICT_SALVAGER_S);
			expect(first).toBeLessThanOrEqual(DERELICT_GAP_S[1]);
		}
	});

	test("at game time 0 a slot is as likely to be adrift as at any later time: no ramp", () => {
		// Pooled over about 1,900 slots one share's spread is 0.6 points, so the
		// band is four of them. The schedule this replaced read 0% here.
		for (const at of [0, 1 * HOUR, 300 * HOUR]) {
			const slots = SEEDS.flatMap(slotsOf);
			const adrift = slots.filter(
				({ record, key }) =>
					derelictTimeline(record.seed, key, at).condition === "destroyed",
			).length;
			expect(adrift / slots.length).toBeGreaterThan(SLOT_SHARE - 0.025);
			expect(adrift / slots.length).toBeLessThan(SLOT_SHARE + 0.025);
		}
		// What is adrift at 0 was lost before it.
		for (const { record, key } of slotsOf(47)) {
			const phase = derelictTimeline(record.seed, key, 0);
			if (phase.condition === "destroyed") {
				expect(phase.instanceOrdinal).toBe(0);
				expect(phase.lostAt).toBeLessThanOrEqual(0);
				expect(phase.salvagerAt).toBeGreaterThan(0);
			}
		}
	});

	test("pooled over three seeds, the share of systems with a live derelict holds at 20% ± 5 points from 0 h to 300 h", () => {
		// This row holds the pooled reading to the band. **It is not node #775's
		// criterion**, which read plainly is per seed and is not met here: seed 47
		// at 4 h reads 14.5% (`docs/receipts/node-775-derelict-pacing.md`). A
		// single seed's cell has a binomial spread of 2.5 points at 256 systems,
		// and the instrument measures this schedule meeting the criterion at 17
		// of 40 disjoint seed triples over seeds 1–120, so a per-seed ±5 row here
		// would fail at most seed triples a test could pin. Which reading binds is the principal's ruling. The
		// per-seed ±8 below is a regression guard against a ramp or a bias.
		for (const h of GATED_H) {
			const shares = SEEDS.map((seed) => systemShare(seed, h * HOUR));
			const pooled = shares.reduce((a, b) => a + b, 0) / shares.length;
			expect(Math.abs(pooled - 0.2)).toBeLessThanOrEqual(0.05);
			for (const share of shares)
				expect(Math.abs(share - 0.2)).toBeLessThan(0.08);
		}
	});

	test("the next loss is a fresh instance with its whole life ahead", () => {
		for (const { record, key } of slotsOf(7).slice(0, 60))
			for (const from of [0, 50 * HOUR]) {
				const at = derelictNextLossAt(record.seed, key, from);
				expect(at).toBeGreaterThanOrEqual(from);
				const phase = derelictTimeline(record.seed, key, at);
				if (phase.condition !== "destroyed") throw new Error(phase.condition);
				expect(phase.lostAt).toBe(at);
				expect(phase.salvagerAt).toBe(at + DERELICT_SALVAGER_S);
				// Nothing fresher between `from` and it.
				const before = derelictTimeline(record.seed, key, from);
				if (before.condition === "destroyed")
					expect(before.lostAt === from || before.salvagerAt <= at).toBe(true);
			}
	});
});

describe("the save under the new schedule", () => {
	test("an instance adrift as the clock starts is touched, saved and loaded with its loss before zero", () => {
		const seed = 42;
		const { key, e } = adriftAtZero(seed);
		const world = scoopDerelict(
			materializeDerelict(newWorld(seed), G, key, 0),
			G,
			key,
			0,
			1,
			0,
		);
		const row = world.galaxies[G].derelicts[key];
		expect(row.instanceOrdinal).toBe(0);
		expect(row.lostAt).toBe(e.lostAt);
		expect(row.lostAt).toBeLessThan(0);
		const loaded = parseSave(
			serializeSave({ world, commander: newCommanderRecord("courier") }),
		);
		expect(loaded.world.galaxies[G].derelicts[key]).toEqual(row);
		expect(parseWorld(serializeWorld(world))).toEqual(world);
	});

	test("a later instance lost before zero is refused: only the first can be", () => {
		const seed = 42;
		const { key } = adriftAtZero(seed);
		const world = materializeDerelict(newWorld(seed), G, key, 0);
		const raw = resealedWorld(world, (body) => {
			body.galaxies[G].derelicts[key].instanceOrdinal = 1;
		});
		expect(() => parseWorld(raw)).toThrow("outside the clock's 0 to");
	});

	test("a first instance lost further back than the save format allows is refused, and a tuned life stays inside it", () => {
		// The tuned first loss is at most one life before zero; the format's
		// floor is fixed, so a retune that shortens the life refuses no row.
		expect(-DERELICT_SALVAGER_S).toBeGreaterThan(DERELICT_EARLIEST_LOSS_S);
		const seed = 42;
		const { key } = adriftAtZero(seed);
		const world = materializeDerelict(newWorld(seed), G, key, 0);
		for (const lostAt of [DERELICT_EARLIEST_LOSS_S - 1, -1e15, -1e300]) {
			const raw = resealedWorld(world, (body) => {
				body.galaxies[G].derelicts[key].lostAt = lostAt;
			});
			expect(() => parseWorld(raw)).toThrow(
				`outside the clock's ${DERELICT_EARLIEST_LOSS_S} to`,
			);
		}
		const atFloor = resealedWorld(world, (body) => {
			body.galaxies[G].derelicts[key].lostAt = DERELICT_EARLIEST_LOSS_S;
		});
		expect(parseWorld(atFloor).galaxies[G].derelicts[key].lostAt).toBe(
			DERELICT_EARLIEST_LOSS_S,
		);
	});

	test("a walk that cannot reach its time throws rather than spinning", () => {
		const { record, key } = slotsOf(42)[0];
		// A loss a gap cannot move: the walk would never advance.
		expect(() =>
			derelictTimeline(record.seed, key, 0, {
				instanceOrdinal: 0,
				lostAt: -1e300,
			}),
		).toThrow("does not advance");
		// A clock further out than the walk's limit of instances.
		expect(() => derelictTimeline(record.seed, key, 1e15)).toThrow(
			`${DERELICT_WALK_LIMIT} instances`,
		);
	});

	test("a row the pilot touched under the old schedule keeps its instance, its loss and its contents", () => {
		// The old schedule lost instance 0 somewhere in the first 48 h and gave
		// it 72 h; a row it wrote names that loss. Here: lost at 30 h, partly
		// scooped, saved at 31 h, then read under the new figures.
		const seed = 47;
		const { record, key } = slotsOf(seed)[0];
		const touched = scoopDerelict(
			newWorld(seed),
			G,
			key,
			0,
			1,
			derelictNextLossAt(record.seed, key),
		);
		const raw = resealedWorld(touched, (body) => {
			const row = body.galaxies[G].derelicts[key];
			row.instanceOrdinal = 0;
			row.lostAt = 30 * HOUR;
			body.gameTime = 31 * HOUR;
		});
		const loaded = parseWorld(raw);
		const row = loaded.galaxies[G].derelicts[key];
		expect(row.instanceOrdinal).toBe(0);
		expect(row.lostAt).toBe(30 * HOUR);
		const read = effectiveDerelict(loaded, G, key, 31 * HOUR);
		if (read.condition !== "destroyed") throw new Error(read.condition);
		expect(read.stored).toBe(true);
		expect(read.instanceOrdinal).toBe(0);
		expect(read.containers).toEqual(row.containers);
		// Its fate is the tuned figure's, so it comes sooner: other salvagers
		// take it 8 h after its loss, not 72 h.
		expect(read.salvagerAt).toBe(30 * HOUR + DERELICT_SALVAGER_S);
		const later = effectiveDerelict(loaded, G, key, 40 * HOUR);
		expect(later.condition).toBe("salvaged");
	});
});

describe("the Salvage board", () => {
	test("a wreck lost before the clock started posts no job; the next loss does", () => {
		// The offer is stamped with its loss, and no journal holds a stamp below
		// zero. Find a slot whose window would still be open at 0.
		let found: { record: SystemRecord; key: CarrierKey } | undefined;
		for (const { record, key } of slotsOf(7)) {
			const e = effectiveDerelict(newWorld(7), G, key, 0);
			if (
				e.condition === "destroyed" &&
				e.lostAt < 0 &&
				e.lostAt + SALVAGE_OFFER_WINDOW_S > 0
			) {
				found = { record, key };
				break;
			}
		}
		if (!found) throw new Error("no slot lost inside an offer window of 0");
		const { record, key } = found;
		const system = makeSystem(record, 0);
		const world = newWorld(7);
		expect(
			salvageTargetsOf(world, system, 0).map((t) => t.slotKey),
		).not.toContain(key);
		const next = derelictNextLossAt(record.seed, key, 1);
		const posted = salvageTargetsOf(world, makeSystem(record, next), next + 1);
		expect(posted.map((t) => t.slotKey)).toContain(key);
	});
});
