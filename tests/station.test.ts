/**
 * Station identity: the generated fields, the geometry table, and the spin.
 *
 * The arithmetic half of node #28 — `docs/specs/docking.md` §4, §5 and §9.1.7–8,
 * and `docs/specs/station-types.md` §5.2, §7 and §8. The spatial half (three
 * silhouettes, the slot tracking the spin, the layer handoff) is
 * `scripts/probe-station.mjs`, because a silhouette is not a number.
 *
 * **What is deliberately not here.** `tests/station-orbits.test.ts` owns the
 * claim that these fields moved no station: its fixture predates them, and
 * repeating a weaker version of it here would put two guards on one property
 * and leave the reader unsure which is the evidence.
 */

import { describe, expect, test } from "bun:test";
import { DOMAIN } from "../src/domains";
import { generateGalaxy, stream } from "../src/galaxy";
import { advanceSystem, makeSystem, stationPose } from "../src/sim";
import {
	SPIN_RPM_RANGE,
	STATION_FENCE_ELIGIBLE,
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
	fenceProbability,
	slotPhaseRad,
} from "../src/station";
import { placeBodies } from "../src/system";
import { dot, length, sub } from "../src/vec3";
import baseline from "./fixtures/station-fields.json";
import {
	ALL_GALAXIES,
	fenceTally,
	forEachSystem,
	notOutpostRow,
	outpostSystems,
	sigmaOff,
	stationFieldRows,
	worldSeeds,
} from "./helpers/station-rows";

const CORIOLIS: StationType[] = ["trade", "shipyard"];

describe("the geometry table (docking.md §5)", () => {
	test("each type carries the spec's core radius", () => {
		expect(STATION_GEOMETRY.trade.coreRadiusKm).toBe(0.6);
		expect(STATION_GEOMETRY.shipyard.coreRadiusKm).toBe(0.6);
		expect(STATION_GEOMETRY.refinery.coreRadiusKm).toBe(0.4);
	});

	test("the two Coriolis types share one slot, the refinery has a pad", () => {
		// 120 × 70 m, ratified 2026-08-26 against #35's roster and no longer the
		// provisional 200 × 70 that `docking.md` §5 carried pending #26. **Only
		// the width moved**: §10 requires the slot to admit the largest hull at
		// check 4's 50° roll limit, where the binding figures are 62.8 m across
		// and 63.4 m up, so the height has almost nothing in it and a first
		// attempt at 60 m was short. `tests/aperture-fit.test.ts` holds the fit
		// half of this and prints the margins rather than restating them.
		for (const type of CORIOLIS) {
			expect(STATION_GEOMETRY[type].aperture).toEqual({
				kind: "slot",
				widthKm: 0.12,
				heightKm: 0.07,
			});
			expect(STATION_GEOMETRY[type].axis).toBe("parent");
		}
		expect(STATION_GEOMETRY.refinery.aperture).toEqual({
			kind: "pad",
			widthKm: 0.15,
			heightKm: 0.15,
		});
		// Radially outward from the star: the refinery is star-centric, so it has
		// no parent body to face.
		expect(STATION_GEOMETRY.refinery.axis).toBe("outward");
	});

	test("the aperture fits inside the face it is cut into", () => {
		// Not a restatement of the table: it is the one relation between two of its
		// rows, and a later widening (§5 calls the dimensions provisional, pending
		// #26's hull) is exactly the edit that could break it silently.
		for (const type of Object.keys(STATION_GEOMETRY) as StationType[]) {
			const g = STATION_GEOMETRY[type];
			expect(
				Math.hypot(g.aperture.widthKm, g.aperture.heightKm) / 2,
			).toBeLessThan(g.coreRadiusKm);
		}
	});

	test("the shipyard docks exactly like the trade station", () => {
		// §5: the drydock frame is silhouette, so it changes nothing about what you
		// fly into. The frame's own reach is `station-mesh.ts`'s table and
		// `tests/station-mesh.test.ts` asserts it — deliberately not reachable from
		// the record #9's checks read.
		expect(STATION_GEOMETRY.shipyard.coreRadiusKm).toBe(
			STATION_GEOMETRY.trade.coreRadiusKm,
		);
		expect(STATION_GEOMETRY.shipyard.aperture).toEqual(
			STATION_GEOMETRY.trade.aperture,
		);
	});
});

describe("placeBodies reads the table, and draws nothing to do it", () => {
	test("a station's radius is its type's core radius, not the 1.2 km placeholder", () => {
		let checked = 0;
		const seen = new Set<StationType>();
		forEachSystem(worldSeeds(1)[0], [0], (_record, contents) => {
			const placed = placeBodies(contents, 0);
			for (const station of contents.stations) {
				const body = placed.find((b) => b.id === station.id);
				expect(body?.radiusKm).toBe(
					STATION_GEOMETRY[station.type].coreRadiusKm,
				);
				seen.add(station.type);
				checked++;
			}
		});
		// A corpus that happened to contain no shipyard would pass the assertion
		// above by never running it. All four since node #491 placed the outpost.
		expect(seen.size).toBe(STATION_TYPES.length);
		expect(checked).toBeGreaterThan(200);
	});
});

/**
 * The draw discipline (docking.md §5, station-types.md §5.3, §8.2).
 *
 * Written as a *reconstruction* rather than as a range check: replay each new
 * stream from the top and assert the stations' stored values are its draws, in
 * station order, one per station. That is the only form that catches the failure
 * the spec actually names — a refinery skipping its spin draw, which shifts the
 * spin of every station generated after it and which a range assertion cannot
 * see, because a shifted value is still inside the range.
 */
describe("both new fields draw once per station, from their own tags", () => {
	test("spinRpm is the STATION_SPIN stream, one draw per station in order", () => {
		let systemsWithARefinery = 0;
		forEachSystem(worldSeeds(2)[1], [0, 1], (record, contents) => {
			const rand = stream(record.seed, DOMAIN.STATION_SPIN);
			for (const station of contents.stations) {
				const draw = rand();
				const expected = STATION_GEOMETRY[station.type].spins
					? SPIN_RPM_RANGE.minRpm +
						draw * (SPIN_RPM_RANGE.maxRpm - SPIN_RPM_RANGE.minRpm)
					: 0;
				expect(station.spinRpm).toBe(expected);
			}
			if (contents.stations.some((s) => s.type === "refinery"))
				systemsWithARefinery++;
		});
		// The refinery's discarded draw is the whole point, so the corpus has to
		// contain refineries that are not the last station in their system.
		expect(systemsWithARefinery).toBeGreaterThan(50);
	});

	test("blackMarket is the STATION_FLAGS stream, one draw per station in order", () => {
		let fences = 0;
		forEachSystem(worldSeeds(2)[1], [0, 1], (record, contents) => {
			const rand = stream(record.seed, DOMAIN.STATION_FLAGS);
			for (const station of contents.stations) {
				const draw = rand();
				const expected =
					STATION_FENCE_ELIGIBLE[station.type] &&
					draw < fenceProbability(record.government);
				expect(station.blackMarket).toBe(expected);
				if (station.blackMarket) fences++;
			}
		});
		expect(fences).toBeGreaterThan(20);
	});

	test("the two tags are distinct, and neither is DOMAIN.STATIONS", () => {
		// §5.3's argument is about tag *separation*; a table that quietly gave both
		// fields the same number would satisfy every assertion above.
		const tags = [DOMAIN.STATION_FLAGS, DOMAIN.STATION_SPIN, DOMAIN.STATIONS];
		expect(new Set(tags).size).toBe(3);
	});
});

describe("the spin range (docking.md §4)", () => {
	test("Coriolis types land inside [0.6, 3.0] and the non-spinning types are exactly 0", () => {
		let coriolis = 0;
		let refineries = 0;
		let outposts = 0;
		forEachSystem(worldSeeds(1)[0], [0, 1], (_record, contents) => {
			for (const station of contents.stations) {
				// Node #491's outpost does not spin either; read off the geometry
				// rather than off a type, so it cannot be counted as Coriolis.
				if (!STATION_GEOMETRY[station.type].spins) {
					// Exactly zero, not "small": the pad does not rotate at all, and a
					// tiny non-zero value would read as a drift rather than as a rule.
					expect(station.spinRpm).toBe(0);
					if (station.type === "refinery") refineries++;
					else outposts++;
				} else {
					expect(station.spinRpm).toBeGreaterThanOrEqual(SPIN_RPM_RANGE.minRpm);
					expect(station.spinRpm).toBeLessThan(SPIN_RPM_RANGE.maxRpm);
					coriolis++;
				}
			}
		});
		expect(coriolis).toBeGreaterThan(400);
		expect(refineries).toBeGreaterThan(100);
		expect(outposts).toBeGreaterThan(50);
	});

	/**
	 * §9.1.7's distribution claim, with the N and the bound it demands.
	 *
	 * §4 says "41.7% of Coriolis stations above 2 rpm, so the hard end is
	 * common". `uniform(0.6, 3.0)` puts P(>2) at 1/2.4 = 0.4167 exactly, and the
	 * standard error over 10,000 draws is 0.0049 — so ±0.015 is about 3σ: wide
	 * enough not to flake, narrow enough that a range typo (0.6–2.5 gives 0.263,
	 * 1.0–3.0 gives 0.5) fails it by a mile.
	 */
	test("41.7% of Coriolis stations spin above 2 rpm, over 10,000 of them", () => {
		const SAMPLE = 10_000;
		const spins: number[] = [];
		for (const world of worldSeeds(20)) {
			if (spins.length >= SAMPLE) break;
			forEachSystem(world, ALL_GALAXIES, (_record, contents) => {
				for (const station of contents.stations)
					if (STATION_GEOMETRY[station.type].spins) spins.push(station.spinRpm);
			});
		}
		expect(spins.length).toBeGreaterThanOrEqual(SAMPLE);
		const sample = spins.slice(0, SAMPLE);
		const p = sample.filter((rpm) => rpm > 2).length / SAMPLE;
		console.log(
			`spin distribution: p̂(> 2 rpm) = ${p.toFixed(4)} over ${SAMPLE} Coriolis stations`,
		);
		expect(Math.abs(p - 0.4167)).toBeLessThan(0.015);
	});
});

/**
 * The fence rate against government (station-types.md §5.2, §9.1).
 *
 * **What this can and cannot carry, measured rather than assumed.** §9.1 sizes
 * the corpus by *total* refineries — "over ≥ 20,000" — and the binding claim is
 * the rate at `government = 7`, which is the rarest bucket by two orders of
 * magnitude: over 200 worlds, 156,388 refineries held 16,647 at `g = 0` and 735
 * at `g = 7`. At §9.1's 20,000 total the `g = 7` bucket holds about 95, where
 * the standard error on a rate of 0.075 is 0.027 — wider than the half-width of the
 * [0.05, 0.11] band it asks to be inside. Asserting that band here would pass or
 * fail on the seed set, which is §9.1's own "assertion that cannot fail" defect
 * seen from the other side.
 *
 * So the split: this asserts every bucket the suite's budget populates properly,
 * against the ramp and with a binomial bound rather than a hand-picked band, and
 * `scripts/measure-fence-rate.ts` is where the sparse end is measured — 541
 * worlds, 2,000 refineries at `g = 7`, rate 0.0830, inside §5.2's band. That
 * instrument takes a quarter of a minute; this takes about a second.
 */
/**
 * The `g = 7` bucket size the gate below needs. At 400 refineries the standard
 * error on 0.075 is 0.013, so four of them is ±0.052 — wide enough not to
 * flake, and nine standard errors clear of the 0.20 a broken ramp produces.
 */
const MIN_G7 = 400;

/**
 * One sweep, both assertions.
 *
 * `worldSeeds` is a deterministic prefix, so two sweeps of 40 and 400 worlds
 * regenerate the first 40 twice — about 26 worlds of 2,048 systems built for
 * nothing, in a suite `CLAUDE.md` says is run on every edit. The deeper sweep
 * subsumes the shallower one: it passes §9.1's 20,000-refinery floor long before
 * the `g = 7` bucket fills, so the wide-bucket test reads the same corpus rather
 * than its own.
 */
const CORPUS = fenceTally(
	worldSeeds(400),
	ALL_GALAXIES,
	(t) => t.total[7] >= MIN_G7,
);

describe("blackMarket frequency tracks government", () => {
	test("every populated bucket sits on §5.2's ramp", () => {
		const { total, fences, refineries, systems } = CORPUS;
		// §9.1's floor, kept: it is the corpus incidence is reported over, even
		// though it is not what sizes the assertions.
		expect(refineries).toBeGreaterThanOrEqual(20_000);

		const rate = total.map((n, g) => (n > 0 ? fences[g] / n : Number.NaN));
		// Incidence, measured and printed rather than estimated (§9.1): §5.2
		// commits to a shape — a minority of systems — and to no figure.
		console.log(
			`refinery incidence: ${((100 * refineries) / systems).toFixed(1)}% of ${systems} systems\nfence rate by government:\n${total
				.map((n, g) => `  g=${g}: ${n > 0 ? rate[g].toFixed(3) : "—"} (n=${n})`)
				.join("\n")}`,
		);
		expect(refineries / systems).toBeLessThan(0.45);

		// Four standard errors of the ramp, per bucket, and only where the bucket
		// can carry it: 500 samples put the widest bound at ±0.09, which a sign
		// flip (0.95 where 0.075 belongs) misses by ten times over.
		//
		// The count of buckets asserted is itself asserted, because a `continue` on
		// a thin bucket otherwise reduces this to whichever ones happened to fill.
		let asserted = 0;
		for (let g = 0; g < 8; g++) {
			if (total[g] < 500) continue;
			expect(
				Math.abs(sigmaOff(rate[g], fenceProbability(g), total[g])),
			).toBeLessThan(4);
			asserted++;
		}
		expect(asserted).toBeGreaterThanOrEqual(6);

		// The sparse end is not asserted here — this corpus holds about 95 of them,
		// where four standard errors is ±0.11 and every ramp shape passes. It gets
		// its own sweep below.
		expect(total[7]).toBeGreaterThan(30);
	});

	/**
	 * The `government = 7` end, gated rather than delegated.
	 *
	 * The first version of this file left §5.2's [0.05, 0.11] band to
	 * `scripts/measure-fence-rate.ts`, which nothing runs — so a ramp putting the
	 * fence rate at 0.20 would have passed `npm test` while `station-types.md`
	 * §9.1 read as a satisfied obligation. That is worse than the defect the
	 * amendment was written to fix, and it was this node that rewrote the
	 * obligation.
	 *
	 * So the bucket is swept for directly, sized to what it must catch rather
	 * than to what the spec's band needs: at 400 refineries the standard error is
	 * 0.013, so 4σ is ±0.052 — wide enough not to flake, and 9σ away from the
	 * 0.20 a broken ramp produces. §5.2's band itself still needs 2,000, which
	 * costs 541 worlds and a quarter of a minute; that stays in the instrument,
	 * and the spec now says so rather than claiming the band is checked here.
	 */
	test("the sparse government = 7 bucket sits on the ramp too", () => {
		expect(CORPUS.total[7]).toBeGreaterThanOrEqual(MIN_G7);
		const rate = CORPUS.fences[7] / CORPUS.total[7];
		const sigma = sigmaOff(rate, fenceProbability(7), CORPUS.total[7]);
		console.log(
			`g=7: ${rate.toFixed(4)} over ${CORPUS.total[7]} refineries from ` +
				`${CORPUS.worlds} worlds (${sigma >= 0 ? "+" : ""}${sigma.toFixed(2)}σ)`,
		);
		expect(Math.abs(sigma)).toBeLessThan(4);
	});

	test("the probability is the spec's ramp and needs no clamp", () => {
		expect(fenceProbability(0)).toBeCloseTo(0.95, 12);
		expect(fenceProbability(7)).toBeCloseTo(0.075, 12);
		for (let g = 0; g <= 7; g++) {
			expect(fenceProbability(g)).toBeGreaterThan(0);
			expect(fenceProbability(g)).toBeLessThan(1);
		}
	});

	test("only a refinery can be a fence", () => {
		let nonRefineries = 0;
		forEachSystem(worldSeeds(1)[0], [0, 1], (_record, contents) => {
			for (const station of contents.stations) {
				if (station.type === "refinery") continue;
				expect(station.blackMarket).toBe(false);
				nonRefineries++;
			}
		});
		expect(nonRefineries).toBeGreaterThan(400);
	});
});

/**
 * The determinism fixture (docking.md §9.1.7).
 *
 * Unlike `station-orbits.json` this one postdates the fields it pins, and that
 * is not the same kind of evidence: it cannot prove the fields changed nothing,
 * only that they do not change from here. `station-orbits.test.ts` owns the
 * first claim; this owns the second.
 */
describe("the generated fields are stable", () => {
	test("the fixture is a real corpus, not an empty pass", () => {
		expect(baseline.rows.length).toBe(baseline.stationCount);
		expect(baseline.rows.length).toBeGreaterThan(500);
	});

	test("every station's spin and flag match the fixture", () => {
		// The raider outpost (node #491) is new since the capture, so it is
		// compared on neither side; every other station must be unmoved, which
		// is the evidence its draws landed on its own stream. The count of what
		// was set aside is pinned too, so the filter cannot hide a station of
		// another type.
		const all = stationFieldRows(baseline.worldSeed, baseline.galaxies);
		const now = all.filter(notOutpostRow);
		expect(all.length - now.length).toBe(
			outpostSystems(baseline.worldSeed, baseline.galaxies),
		);
		const before = baseline.rows.filter(notOutpostRow);
		expect(now.length).toBe(before.length);
		expect(now).toEqual(before);
	});

	test("regenerating a system reproduces its stations exactly", () => {
		// The fixture pins one seed; this pins the property, so a change that
		// happened to reproduce the fixture's world by luck still fails.
		for (const world of worldSeeds(2)) {
			const first: string[] = [];
			const second: string[] = [];
			forEachSystem(world, [3], (_r, contents) => {
				for (const s of contents.stations)
					first.push(`${s.id}:${s.spinRpm}:${s.blackMarket}`);
			});
			forEachSystem(world, [3], (_r, contents) => {
				for (const s of contents.stations)
					second.push(`${s.id}:${s.spinRpm}:${s.blackMarket}`);
			});
			expect(second).toEqual(first);
		}
	});
});

/**
 * Slot phase (docking.md §4.1).
 *
 * A pure function of `(spinRpm, gameTime)` and nothing else — in particular not
 * of a frame delta, and not of anything read back off an `Object3D`. That is
 * what makes check 4 (the roll match, #9's own node) testable without a
 * renderer, and it is the reason this lives in sim rather than in `main.ts`.
 */
describe("slotPhaseRad", () => {
	test("starts at zero and advances at the station's rate", () => {
		expect(slotPhaseRad(1.5, 0)).toBe(0);
		// One revolution per minute at 1 rpm: half a minute is half a turn.
		expect(slotPhaseRad(1, 30)).toBeCloseTo(Math.PI, 12);
		expect(slotPhaseRad(3, 5)).toBeCloseTo((2 * Math.PI * 3 * 5) / 60, 12);
	});

	test("wraps into [0, 2π) rather than growing without bound", () => {
		// A game clock runs for hours; an unwrapped phase loses precision and reads
		// as a number nobody can sanity-check on a HUD.
		for (const t of [61, 3600, 86_400, 1e6]) {
			const phase = slotPhaseRad(2.4, t);
			expect(phase).toBeGreaterThanOrEqual(0);
			expect(phase).toBeLessThan(2 * Math.PI);
		}
		// One full revolution is the *same angle* as none, and the honest assertion
		// says so: `(2π · 60)/60` lands a couple of ulps below 2π, so the modulo
		// leaves it there rather than at zero. Demanding `≈ 0` would fail on a wrap
		// that is entirely correct, and get "fixed" by special-casing a float.
		const full = slotPhaseRad(1, 60);
		expect(Math.min(full, 2 * Math.PI - full)).toBeLessThan(1e-9);
	});

	test("a pad never rotates", () => {
		for (const t of [0, 1, 1000, 1e6]) expect(slotPhaseRad(0, t)).toBe(0);
	});

	test("it is a function of the clock, not of when it is called", () => {
		expect(slotPhaseRad(2.2, 1234.5)).toBe(slotPhaseRad(2.2, 1234.5));
	});
});

/**
 * The pose the renderer mirrors (docking.md §4.1, §5).
 *
 * Tested through `makeSystem`, over generated worlds rather than hand-built
 * ones: the axis is the relation between two *placed* positions, and a fixture
 * that constructed both would be asserting its own arithmetic.
 */
describe("stationPose", () => {
	/** A world with all three station types in one system, so every branch below
	 *  runs against real placement rather than against a constructed case. */
	function systemWithAllThree(): ReturnType<typeof makeSystem> {
		for (const world of worldSeeds(6)) {
			const galaxy = generateGalaxy(world, 0);
			for (const record of galaxy.systems) {
				const system = makeSystem(record, 0);
				const types = new Set(system.contents.stations.map((s) => s.type));
				// The three named, not a count: a lawless system's outpost
				// (node #491) makes three types without all of these.
				if (
					["trade", "refinery", "shipyard"].every((t) =>
						types.has(t as StationType),
					)
				)
					return system;
			}
		}
		throw new Error("no system with all three station types in six worlds");
	}

	test("a Coriolis station faces the body it orbits", () => {
		const system = systemWithAllThree();
		for (const station of system.contents.stations) {
			if (STATION_GEOMETRY[station.type].axis !== "parent") continue;
			const pose = stationPose(system, station.id, 0);
			const body = system.byId.get(station.id);
			const parent = system.byId.get(station.parentId ?? "");
			if (!body || !parent) throw new Error("placement is missing a body");
			const toParent = sub(parent.pos, body.pos);
			const cos =
				dot(pose.axis, toParent) / (length(pose.axis) * length(toParent));
			expect(cos).toBeCloseTo(1, 12);
			expect(length(pose.axis)).toBeCloseTo(1, 12);
		}
	});

	test("the refinery faces radially outward from the star", () => {
		const system = systemWithAllThree();
		const refinery = system.contents.stations.find(
			(s) => s.type === "refinery",
		);
		if (!refinery) throw new Error("no refinery");
		const pose = stationPose(system, refinery.id, 0);
		const body = system.byId.get(refinery.id);
		if (!body) throw new Error("placement is missing the refinery");
		// The star is at the origin (§7.4), so outward is the position itself.
		const cos = dot(pose.axis, body.pos) / length(body.pos);
		expect(cos).toBeCloseTo(1, 12);
	});

	test("the axis swings with the orbit rather than being frozen at t=0", () => {
		// A pose computed once at generation would pass every assertion above and
		// point at empty space a quarter of an orbit later.
		const system = systemWithAllThree();
		const station = system.contents.stations.find((s) => s.type === "trade");
		if (!station) throw new Error("no trade station");
		const t0 = stationPose(system, station.id, 0);
		const quarter = station.orbit.periodS / 4;
		advanceSystem(system, quarter);
		const t1 = stationPose(system, station.id, quarter);
		// A quarter turn of the station about its planet swings the axis by 90°;
		// the dot product goes to zero, and anything frozen stays at one.
		expect(Math.abs(dot(t0.axis, t1.axis))).toBeLessThan(0.05);
	});

	test("the phase is the station's own spin, and a pad never turns", () => {
		const system = systemWithAllThree();
		for (const station of system.contents.stations) {
			const t = 17.5;
			const pose = stationPose(system, station.id, t);
			expect(pose.phaseRad).toBe(slotPhaseRad(station.spinRpm, t));
			if (!STATION_GEOMETRY[station.type].spins) expect(pose.phaseRad).toBe(0);
			else expect(pose.phaseRad).toBeGreaterThan(0);
		}
	});

	test("a raider outpost faces radially outward from the star, like the refinery", () => {
		// Node #491 places it star-centric on a planet's orbit, and its geometry
		// declares `outward`; this is the pose reading that on a placed one.
		for (const record of generateGalaxy(worldSeeds(1)[0], 0).systems) {
			const system = makeSystem(record, 0);
			const outpost = system.contents.stations.find(
				(s) => s.type === "outpost",
			);
			if (!outpost) continue;
			const pose = stationPose(system, outpost.id, 0);
			const body = system.byId.get(outpost.id);
			if (!body) throw new Error("placement is missing the outpost");
			expect(dot(pose.axis, body.pos) / length(body.pos)).toBeCloseTo(1, 12);
			expect(pose.phaseRad).toBe(0);
			return;
		}
		throw new Error("no outpost in galaxy 0");
	});

	test("an unknown station throws rather than posing nothing", () => {
		const system = systemWithAllThree();
		expect(() => stationPose(system, "station-nowhere", 0)).toThrow();
	});
});
