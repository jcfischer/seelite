/**
 * The galaxy generator's suite — property-based, because there is no oracle.
 *
 * Elite's generator has one: with Bell's 48-bit chain seed, `txtelite` output is
 * a byte-exact golden file and Lave is system 7 of galaxy 1. Dropping that chain
 * (spec §1) bought per-system independence and cost the best verification asset
 * available, so every test here asserts a *property* instead. The spec records
 * that as the known weak joint of the design; this file is what stands in for
 * it, and the list below is §9's, in order.
 *
 * The one exception is the determinism digest, which is a golden file over our
 * own output rather than someone else's — it catches drift, not incorrectness.
 */

import { describe, expect, test } from "bun:test";
import {
	CORE_RADIUS_LY,
	GALAXY_COUNT,
	GALAXY_RADIUS_LY,
	type Galaxy,
	JUMP_RANGE_LY,
	MAX_LAYOUT_ATTEMPTS,
	SYSTEMS_PER_GALAXY,
	distanceLy,
	generateGalaxy,
	isConnected,
	layoutGalaxy,
	radialCdf,
	radiusForQuantile,
	startSystem,
	systemAt,
} from "../src/galaxy";
import {
	ARRIVAL_CLEARANCE_AU,
	ARRIVAL_DISTANCE_AU,
	MAX_ORBIT_AU,
	MIN_ORBIT_AU,
	SHIPYARD_MIN_TL,
	arrivalPoint,
	generateContents,
	placeBodies,
	positionOnOrbit,
} from "../src/system";
import { mix, seededRand } from "../src/rng";
import { AU_KM } from "../src/units";

/** The world every test below reads. One seed, fixed, so a failure is
 *  reproducible without a note about which run it came from. */
const WORLD = 20260818;

/** Generated once. Eight galaxies with their resampling is the expensive part of
 *  this file, and every test after the first would otherwise pay for it again. */
const GALAXIES: Galaxy[] = Array.from({ length: GALAXY_COUNT }, (_, g) =>
	generateGalaxy(WORLD, g),
);
const ALL = GALAXIES.flatMap((g) => g.systems);

describe("determinism (§9.1)", () => {
	/**
	 * FNV-1a over every record's **exact** fields — seeds, names, polity numbers,
	 * descriptions. All integer or string, so this is bit-identical on any
	 * platform: the LCG is integer arithmetic and the name tables are indexed by
	 * a floor.
	 *
	 * **Positions are not in it, and the first version of this file got that
	 * badly wrong.** It hashed `pos.toFixed(6)` and justified the quantisation as
	 * "~10 metres at interstellar scale, nine orders below anything the game
	 * reads". 10⁻⁶ LY is **9.5 million kilometres** — 0.063 AU, which is very
	 * much a distance the game reads — so the pin was blind to per-coordinate
	 * drift the size of an inner solar system while presenting itself as an exact
	 * regression check. Wrong by nine orders of magnitude, and the sentence
	 * asserting the care taken is what made it credible.
	 *
	 * Positions are pinned instead by `POSITION_FIXTURE` below, at a stated
	 * tolerance, which is the honest instrument for a float: the digest catches
	 * anything discrete, the fixture catches drift down to ~950 km.
	 */
	const digest = (): string => {
		let h = 0x811c9dc5;
		const eat = (s: string) => {
			for (let i = 0; i < s.length; i++) {
				h ^= s.charCodeAt(i);
				h = Math.imul(h, 0x01000193) >>> 0;
			}
		};
		for (const s of ALL) {
			eat(
				[
					s.galaxy,
					s.index,
					s.attempt,
					s.seed,
					s.name,
					s.government,
					s.economy,
					s.tech,
					s.displayTL,
					s.population,
					s.productivity,
					s.description,
				].join("|"),
			);
		}
		return h.toString(16).padStart(8, "0");
	};

	test("2048 records hash to a pinned digest", () => {
		expect(ALL.length).toBe(GALAXY_COUNT * SYSTEMS_PER_GALAXY);
		// Regenerate this ONLY when a generator change was intended. It moving is
		// the intended alarm: every seed's output changed.
		expect(digest()).toBe("42012e8f");
	});

	/**
	 * Sampled positions, full precision, from `WORLD`.
	 *
	 * Why a fixture and not more digest: a float cannot be pinned by equality
	 * across platforms — `Math.atan`'s last ulp is implementation-defined, and
	 * JavaScriptCore on two architectures may differ without either being wrong.
	 * Quantising to dodge that is what produced the 9.5-million-kilometre blind
	 * spot above. A tolerance says the same thing honestly and says how much.
	 *
	 * `toBeCloseTo(v, 9)` is ±5·10⁻¹⁰ LY ≈ **950 km** — four orders tighter than
	 * the old digest, and four orders looser than the ~10⁻¹⁴ LY of platform
	 * jitter it has to tolerate.
	 */
	const POSITION_FIXTURE: [number, number, [number, number, number]][] = [
		[0, 0, [17.10849287840576, -5.666474372158571, 9.517887922255094]],
		[0, 7, [17.28961579032331, 8.368830612005883, -0.584877307533546]],
		[0, 255, [-0.8217812695608091, -2.136663942731725, -15.365833199837596]],
		[1, 42, [12.896223202043647, -4.008713230503314, 4.015636648608916]],
		[2, 100, [0.8102223646675069, 3.6901090139375645, -15.149815994121065]],
		[2, 255, [0.6247203619016894, -0.9220166404734456, -4.27958636220147]],
		[3, 3, [9.695589703089722, 7.21798217557434, 4.580782983008728]],
		[4, 128, [-2.0458037004976357, -2.3347582160278066, 19.357383730729797]],
		[5, 200, [10.093433779899545, -12.203130792801346, 8.188472073662716]],
		[6, 17, [-5.190227898412195, 1.4869663512560247, 14.55661051494981]],
		[7, 0, [3.542105952649244, -0.9403131560370799, -3.1462409122404567]],
		[7, 254, [-8.45781701638163, 11.730339691656475, -12.75017496517518]],
	];

	test("sampled positions match a full-precision fixture", () => {
		for (const [g, n, [x, y, z]] of POSITION_FIXTURE) {
			const s = GALAXIES[g].systems[n];
			expect(s.pos.x).toBeCloseTo(x, 9);
			expect(s.pos.y).toBeCloseTo(y, 9);
			expect(s.pos.z).toBeCloseTo(z, 9);
		}
		// A fixture that emptied itself would pass vacuously, which is the one
		// failure mode a table of literals actually has.
		expect(POSITION_FIXTURE.length).toBeGreaterThanOrEqual(12);
	});

	test("a second generation of the same seed agrees exactly", () => {
		// The digest above would pass a generator that hashed a cached result. This
		// is the half that says the function is a function.
		const again = generateGalaxy(WORLD, 3);
		expect(again).toEqual(GALAXIES[3]);
	});

	test("a different world seed gives a different galaxy", () => {
		const other = generateGalaxy(WORLD + 1, 0);
		expect(other.systems[0].name).not.toBe(GALAXIES[0].systems[0].name);
	});
});

describe("per-system independence (§9.2)", () => {
	test("a system generated alone matches its entry in the full table", () => {
		// The property the hash-per-system substrate exists to provide, and the one
		// that would have failed under Bell's chain: there, system 200 could only
		// be reached by iterating 0…199 first, so generating it alone was not a
		// thing you could do at all.
		for (const n of [0, 1, 7, 42, 128, 255]) {
			expect(systemAt(WORLD, 2, n)).toEqual(GALAXIES[2].systems[n]);
		}
	});

	test("neighbouring systems are not correlated through a shared draw count", () => {
		// The failure mode this guards is subtle: a shared stream would make system
		// N's record depend on how many draws N−1 happened to take. Renaming one
		// system's stream domain must therefore move that system and nothing else.
		const alone = systemAt(WORLD, 2, 100);
		expect(alone.seed).not.toBe(GALAXIES[2].systems[99].seed);
		expect(alone).toEqual(GALAXIES[2].systems[100]);
	});
});

describe("connectivity (§9.3)", () => {
	test("every galaxy is a single component under a 7 LY jump", () => {
		for (const g of GALAXIES) {
			expect(
				isConnected(
					g.systems.map((s) => s.pos),
					JUMP_RANGE_LY,
				),
			).toBe(true);
		}
	});

	test("the attempt counts are what they were", () => {
		// Pinned per the spec's instruction (§5): resampling is the connectivity
		// guarantee, and a change that quietly pushes these up is the signal that
		// the density profile or the radius needs revisiting — not that the retry
		// budget does.
		expect(GALAXIES.map((g) => g.attempt)).toEqual([4, 5, 5, 5, 19, 2, 3, 4]);
	});

	test("other world seeds also lay out well inside the ceiling", () => {
		// **What this is and is not.** Forty galaxies cannot observe a tail whose
		// p95 is 19 and whose worst case is 52 — that measurement is
		// `scripts/measure-layout-attempts.ts`, and the number it justifies is
		// recorded on `MAX_LAYOUT_ATTEMPTS`. What forty galaxies *can* do is fail
		// if the typical cost moves, on seeds other than the one pinned above.
		//
		// An earlier version of this comment claimed it "would have caught" the
		// first ceiling of 64 against a worst case of 52. It would not: the
		// assertion was relative to the ceiling, so under 64 it would have demanded
		// max < 16 and failed for a reason unrelated to the tail. The bound below
		// is absolute for that reason — it says what these seeds actually cost, and
		// changing the ceiling does not silently change what is being asserted.
		const attempts = [7, 99, 4242, 123456, 999983].flatMap((world) =>
			Array.from(
				{ length: GALAXY_COUNT },
				(_, g) => layoutGalaxy(world, g).attempt,
			),
		);
		expect(Math.max(...attempts)).toBeLessThan(40);
		expect(MAX_LAYOUT_ATTEMPTS).toBeGreaterThan(52 * 2);
	});

	test("a layout is rejected rather than repaired", () => {
		// Resampling keeps only the samples that were already good, so the accepted
		// layout must itself satisfy the predicate — no straggler was pulled in.
		const { positions, attempt } = layoutGalaxy(WORLD, 5);
		expect(isConnected(positions)).toBe(true);
		expect(attempt).toBe(GALAXIES[5].attempt);
	});
});

describe("distribution (§9.4)", () => {
	const neighbourCounts = (g: Galaxy): number[] =>
		g.systems.map(
			(s) =>
				g.systems.filter(
					(o) =>
						o.index !== s.index && distanceLy(s.pos, o.pos) <= JUMP_RANGE_LY,
				).length,
		);

	test("a typical system has about 8 neighbours in range", () => {
		// The design constant the 22 LY radius was derived from (§2.1): enough
		// choice to plan a route, few enough that a distant system is a project.
		// If this drifts, the radius is what moved.
		const counts = GALAXIES.flatMap(neighbourCounts);
		const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
		expect(mean).toBeGreaterThan(7.3);
		expect(mean).toBeLessThan(9.3);
	});

	test("radii follow the specified profile (Kolmogorov-Smirnov)", () => {
		// Stronger than the two-shell ratio below and the reason it can stay loose:
		// this compares the whole empirical radial distribution against F(x), so a
		// sampler that got the concentration right in aggregate but wrong in shape
		// still fails.
		const radii = ALL.map((s) => s.radiusLy).sort((a, b) => a - b);
		let d = 0;
		for (let i = 0; i < radii.length; i++) {
			const f = radialCdf(radii[i]);
			d = Math.max(
				d,
				Math.abs(f - i / radii.length),
				Math.abs((i + 1) / radii.length - f),
			);
		}
		// n = 2048, so the 95% critical value is 1.36/√n = 0.030. 0.05 leaves room
		// for the run-to-run variation a fixed seed does not have but a changed one
		// would.
		expect(d).toBeLessThan(0.05);
	});

	test("the cluster is centrally concentrated, core to rim", () => {
		// The spec quotes ρ(0)/ρ(R) = 3.0, which is an identity of the profile
		// rather than something a finite sample measures: no system sits at r = 0.
		// What is measurable is the ratio between two shells, and the analytic
		// value for *those* shells is computed here rather than quoted, so the
		// assertion cannot drift away from the profile it is checking.
		const shellDensity = (lo: number, hi: number): number => {
			const count = ALL.filter(
				(s) => s.radiusLy >= lo && s.radiusLy < hi,
			).length;
			const volume = (4 / 3) * Math.PI * (hi ** 3 - lo ** 3);
			return count / volume;
		};
		/** r²-weighted mean of ρ ∝ 1/(1+(r/r_c)²) over a shell, by quadrature. */
		const analyticDensity = (lo: number, hi: number): number => {
			let num = 0;
			let den = 0;
			const steps = 512;
			for (let i = 0; i < steps; i++) {
				const r = lo + ((i + 0.5) * (hi - lo)) / steps;
				const w = r * r;
				num += w / (1 + (r / CORE_RADIUS_LY) ** 2);
				den += w;
			}
			return num / den;
		};
		// Half and half, rather than a thin core shell against a thin rim one. The
		// thin version reads closer to the ρ(0)/ρ(R) the spec quotes and is mostly
		// counting noise: a 5.5 LY core sphere holds ~49 of 2048 systems, so its
		// density carries ±14% before anything is wrong. Measured across four world
		// seeds, these shells land within 0.09 of the analytic value and the thin
		// ones scatter by 0.47.
		const inner = [0, 0.5 * GALAXY_RADIUS_LY] as const;
		const outer = [0.5 * GALAXY_RADIUS_LY, GALAXY_RADIUS_LY] as const;
		const measured = shellDensity(...inner) / shellDensity(...outer);
		const expected = analyticDensity(...inner) / analyticDensity(...outer);
		expect(Math.abs(measured - expected)).toBeLessThan(0.2);
		// And the profile is genuinely concentrated rather than flat — the thing
		// the whole exploration gradient rests on.
		expect(measured).toBeGreaterThan(1.5);
	});

	test("the radial inverse is the inverse of the CDF", () => {
		for (const u of [0.001, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
			expect(radialCdf(radiusForQuantile(u))).toBeCloseTo(u, 8);
		}
	});
});

describe("start system (§9.5)", () => {
	const start = startSystem(GALAXIES[0]);

	test("it exists and satisfies its predicate", () => {
		expect(start.displayTL).toBeGreaterThanOrEqual(8);
		expect(start.government).toBeGreaterThanOrEqual(5);
	});

	test("it is the most central system that qualifies", () => {
		const qualifying = GALAXIES[0].systems.filter(
			(s) => s.displayTL >= 8 && s.government >= 5,
		);
		const closest = Math.min(...qualifying.map((s) => s.radiusLy));
		expect(start.radiusLy).toBeCloseTo(closest, 9);
	});

	test("it is reachable from the whole galaxy", () => {
		// Implied by single-component connectivity, asserted separately because
		// this is the one that makes a save winnable: a start system in a stranded
		// pocket is the failure the resampling exists to prevent.
		expect(isConnected(GALAXIES[0].systems.map((s) => s.pos))).toBe(true);
		expect(GALAXIES[0].systems).toContain(start);
	});
});

describe("names and descriptions (§9.6)", () => {
	test("every name is 2-8 characters of A-Z", () => {
		for (const s of ALL) expect(s.name).toMatch(/^[A-Z]{2,8}$/);
	});

	test("the degenerate-name rate is what the redraw loop was sized against", () => {
		// `names.ts` justifies its redraw loop with a rate, and that paragraph was
		// wrong twice — once too high, once too low. So the rate is **enumerated
		// here and measured here**, and the two are checked against each other: a
		// derivation nobody re-derives is how it went wrong both times.
		//
		// Each pair adds 0 characters (`..`, 1 of 32), 1 (`A.`, index 15, 1 of 32)
		// or 2 (the other 30). The guard fires on a total under 2 — so the short
		// cases are every combination summing below two, not only the all-`..` one.
		const shortRate = (pairs: number): number => {
			// P(total 0), P(total 1), P(total >= 2)
			let d = [1, 0, 0];
			for (let i = 0; i < pairs; i++) {
				const next = [0, 0, 0];
				for (let len = 0; len < 3; len++) {
					if (d[len] === 0) continue;
					for (const [add, p] of [
						[0, 1 / 32],
						[1, 1 / 32],
						[2, 30 / 32],
					] as const) {
						next[Math.min(2, len + add)] += d[len] * p;
					}
				}
				d = next;
			}
			return d[0] + d[1];
		};
		// The closed forms the docstring quotes, asserted rather than trusted.
		expect(shortRate(3)).toBeCloseTo(4 / 32 ** 3, 12);
		expect(shortRate(4)).toBeCloseTo(5 / 32 ** 4, 14);
		const analytic = 0.5 * shortRate(3) + 0.5 * shortRate(4);
		expect(analytic * 2048).toBeCloseTo(0.13, 2);

		// Measured on the *unguarded* rule — the guarded one emits none by
		// construction, so it could not tell a right derivation from a wrong one.
		let short = 0;
		const trials = 2_000_000;
		for (let i = 0; i < trials; i++) {
			const rand = seededRand(mix(0x5ee11e, i));
			const pairs = rand() < 0.5 ? 3 : 4;
			let len = 0;
			for (let p = 0; p < pairs; p++) {
				const draw = Math.floor(rand() * 32);
				len += draw === 0 ? 0 : draw === 15 ? 1 : 2;
			}
			if (len < 2) short++;
		}
		// Two-sided, at ±4σ of the expected Poisson count (~127 at 2M trials). The
		// first version asserted only an upper bound, which passed just as happily
		// at four times the derived rate — that is, at exactly the error it existed
		// to catch.
		const expected = analytic * trials;
		const sigma = Math.sqrt(expected);
		expect(short).toBeGreaterThan(expected - 4 * sigma);
		expect(short).toBeLessThan(expected + 4 * sigma);
	});

	test("the duplicate rate is recorded, not asserted away", () => {
		// Bell's table has 32 digrams and names are 3–4 pairs, so collisions are
		// expected and are not a defect — Elite shipped with them. What matters is
		// that the figure is visible when it moves.
		const unique = new Set(ALL.map((s) => s.name)).size;
		const duplicateRate = 1 - unique / ALL.length;
		expect(duplicateRate).toBeLessThan(0.05);
	});

	test("every description reads as a sentence, with no unexpanded tokens", () => {
		for (const s of ALL) {
			expect(s.description.length).toBeGreaterThan(10);
			expect(s.description.endsWith(".")).toBe(true);
			// A token that fell through the grammar would survive as a control
			// character, which is the failure mode a port of this data actually has.
			expect(s.description).toMatch(/^[\x20-\x7e]+$/);
		}
	});

	test("a description names its own planet", () => {
		const s = GALAXIES[0].systems[7];
		const titled = s.name[0] + s.name.slice(1).toLowerCase();
		// Every root expansion begins with a planet-name token in one of its five
		// forms, three of which print the name outright and two of which say "This
		// planet"/"This world".
		expect(
			s.description.includes(titled) || s.description.startsWith("This "),
		).toBe(true);
	});
});

describe("system contents", () => {
	/** Contents for every system is the expensive sweep in this file; a fixed
	 *  sample of 200 spread across all eight galaxies is enough for the rules
	 *  below, which are per-system invariants rather than distributions. */
	const SAMPLE = ALL.filter((_, i) => i % 10 === 0);
	/** Generated once for the whole block. `generateContents` is deterministic in
	 *  its record, so five tests calling it on the same sample were five identical
	 *  sweeps — and a test that regenerates is also a test that could quietly be
	 *  asserting against a *different* system than the one it names. */
	const CONTENTS = new Map(
		SAMPLE.map((s) => [s, generateContents(s)] as const),
	);
	const contentsOf = (s: (typeof SAMPLE)[number]) => {
		const c = CONTENTS.get(s);
		if (!c) throw new Error(`no contents for ${s.galaxy}:${s.index}`);
		return c;
	};

	test("stations: 1-3, and typed by the rules that gate them (§9.7)", () => {
		for (const s of SAMPLE) {
			const c = contentsOf(s);
			expect(c.stations.length).toBeGreaterThanOrEqual(1);
			expect(c.stations.length).toBeLessThanOrEqual(3);
			const types = c.stations.map((st) => st.type);
			expect(types).toContain("trade");
			if (types.includes("shipyard")) {
				expect(s.displayTL).toBeGreaterThanOrEqual(SHIPYARD_MIN_TL);
			}
			if (types.includes("refinery")) expect(c.belt).not.toBeNull();
			if (c.belt === null) expect(types).not.toContain("refinery");
		}
	});

	test("shipyards are pulled inward, which is what gives tech its teeth", () => {
		// §6.4 says shipyards "generate only in the core". Taken as a hard bound
		// that is not what the formulas do, and the formulas are the decision: at
		// t = 0.83 a system with `economy = 0` and `gov = 4` still reaches
		// displayTL 11. What the radial bias buys is a *distribution*, and the mean
		// is where it shows — measured, TL ≥ 10 systems average t = 0.52 against
		// 0.70 for the cluster as a whole.
		//
		// Asserted as the gap rather than as a ceiling, because a ceiling here would
		// be a test asserting the prose over the arithmetic it summarises.
		const withShipyard = SAMPLE.filter((s) =>
			contentsOf(s).stations.some((st) => st.type === "shipyard"),
		);
		expect(withShipyard.length).toBeGreaterThan(0);
		const meanT = (xs: typeof SAMPLE) =>
			xs.reduce((a, s) => a + s.t, 0) / xs.length;
		expect(meanT(withShipyard)).toBeLessThan(meanT(SAMPLE) - 0.1);
	});

	test("scale: every body sits inside the orbit envelope (§9.8)", () => {
		for (const s of SAMPLE) {
			const c = contentsOf(s);
			expect(c.planets.length).toBeGreaterThan(0);
			for (const p of c.planets) {
				expect(p.aAu).toBeGreaterThanOrEqual(MIN_ORBIT_AU - 1e-9);
				expect(p.aAu).toBeLessThanOrEqual(MAX_ORBIT_AU + 1e-9);
			}
			// The ladder is rescaled so exactly one rung lands on the habitable
			// distance, and that rung is the primary.
			const primary = c.planets.filter((p) => p.isPrimary);
			expect(primary.length).toBe(1);
			expect(primary[0].aAu).toBeCloseTo(c.habitableAu, 9);
		}
	});

	test("the arrival point clears every body, at every clock value (§9.8)", () => {
		// **Four clock values, not one.** Bodies move, so a clearance that holds at
		// `gameTime` 0 says nothing about the arrival a player actually makes.
		// Testing only t = 0 was the hole that let `arrivalPoint`'s first version
		// carry an unchecked "this cannot happen" claim; the times below span a
		// third of a year, several inner-planet periods, and a station orbit.
		const CLOCKS = [0, 3_600, 5_184_000, 10_000_000];
		for (const s of SAMPLE) {
			const c = contentsOf(s);
			// Both bearings the spec defines: a jump from a neighbour, and a new
			// game with no origin.
			const origin =
				GALAXIES[s.galaxy].systems[(s.index + 1) % SYSTEMS_PER_GALAXY];
			for (const t of CLOCKS) {
				// Depends on (contents, clock) alone, so it is hoisted out of the
				// bearing loop rather than rebuilt for each of the two.
				const bodies = placeBodies(c, t);
				for (const from of [origin.pos, null]) {
					const p = arrivalPoint(s, c, from, t);
					for (const b of bodies) {
						const d = Math.sqrt(
							(b.pos.x - p.x) ** 2 +
								(b.pos.y - p.y) ** 2 +
								(b.pos.z - p.z) ** 2,
						);
						// Relative slack: the clearance is solved in float64 at ~10⁸ km,
						// so an exact `>=` would be asserting the last ulp of a square
						// root rather than the geometry.
						expect(d).toBeGreaterThanOrEqual(
							ARRIVAL_CLEARANCE_AU * AU_KM * (1 - 1e-12),
						);
					}
				}
			}
		}
	});

	test("the arrival point is never further out than it needs to be", () => {
		// The other half of the clearance property, and the one a "push it further"
		// bug passes silently: the point must sit at 1 AU unless something was in
		// the way, and even then only far enough to clear it.
		let atExactly1Au = 0;
		for (const s of SAMPLE) {
			const c = contentsOf(s);
			const p = arrivalPoint(s, c, null, 0);
			const d = Math.hypot(p.x, p.y, p.z);
			expect(d).toBeGreaterThanOrEqual(
				ARRIVAL_DISTANCE_AU * AU_KM * (1 - 1e-12),
			);
			// Past the orbit envelope plus a clearance there is nothing left to be
			// pushed by, so no arrival can be beyond it.
			expect(d).toBeLessThanOrEqual(
				(MAX_ORBIT_AU + 2 * ARRIVAL_CLEARANCE_AU) * AU_KM,
			);
			if (d < ARRIVAL_DISTANCE_AU * AU_KM * 1.000001) atExactly1Au++;
		}
		// Most arrivals hit clear space immediately — if this collapsed, the
		// exclusion intervals would be swallowing the whole ray.
		expect(atExactly1Au / SAMPLE.length).toBeGreaterThan(0.5);
	});

	test("the new-game bearing is not correlated with the system's position", () => {
		// The defect this pins was invisible to every other test here: the fallback
		// bearing was drawn from the `POS` stream, which `systemPosition` has
		// already consumed, so `cosθ_arrival` was `2·u_radius − 1` — a rim system
		// always arriving near +z, azimuth locked to its polar angle. Every
		// clearance assertion still passed, because a correlated bearing clears
		// bodies just as well as an uncorrelated one.
		//
		// Measured as the correlation between the bearing's z and the system's own
		// normalised z. Under the bug it was ~1 by construction.
		const sample = ALL.filter((_, i) => i % 7 === 0);
		const pairs = sample.map((s) => {
			const p = arrivalPoint(s, generateContents(s), null, 0);
			const len = Math.hypot(p.x, p.y, p.z);
			return [s.pos.z / s.radiusLy, p.z / len] as const;
		});
		const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		const ax = pairs.map(([a]) => a);
		const ay = pairs.map(([, b]) => b);
		const mx = meanOf(ax);
		const my = meanOf(ay);
		const cov = meanOf(pairs.map(([a, b]) => (a - mx) * (b - my)));
		const sx = Math.sqrt(meanOf(ax.map((a) => (a - mx) ** 2)));
		const sy = Math.sqrt(meanOf(ay.map((b) => (b - my) ** 2)));
		expect(Math.abs(cov / (sx * sy))).toBeLessThan(0.15);
	});

	test("the arrival point is on the inbound bearing", () => {
		// What makes a system look different depending on the route in, and the
		// reason a fixed witchpoint was rejected.
		const here = GALAXIES[0].systems[10];
		const c = generateContents(here);
		const a = arrivalPoint(here, c, GALAXIES[0].systems[11].pos, 0);
		const b = arrivalPoint(here, c, GALAXIES[0].systems[12].pos, 0);
		const cos =
			(a.x * b.x + a.y * b.y + a.z * b.z) /
			(Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
		expect(cos).toBeLessThan(0.999);
	});
});

describe("orbits (§9.9)", () => {
	const contents = generateContents(GALAXIES[0].systems[3]);

	test("a body returns to where it started after one period", () => {
		for (const p of contents.planets) {
			const a = positionOnOrbit(p.orbit, 0);
			const b = positionOnOrbit(p.orbit, p.orbit.periodS);
			// Relative tolerance: an orbit at 6 AU is 9·10⁸ km around, so an absolute
			// metre-scale tolerance would be asserting something about float64 rather
			// than about the orbit.
			const err =
				Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / p.orbit.radiusKm;
			expect(err).toBeLessThan(1e-9);
		}
	});

	test("position is continuous across the period boundary", () => {
		const p = contents.planets[0];
		const dt = p.orbit.periodS * 1e-6;
		const before = positionOnOrbit(p.orbit, p.orbit.periodS - dt);
		const after = positionOnOrbit(p.orbit, p.orbit.periodS + dt);
		const step = Math.hypot(
			after.x - before.x,
			after.y - before.y,
			after.z - before.z,
		);
		// Two microperiods apart is 2·10⁻⁶ of a circumference; anything larger
		// means the phase wrapped through a discontinuity.
		expect(step / p.orbit.radiusKm).toBeLessThan(1e-4);
	});

	test("positions are a function of the clock and nothing else", () => {
		// The claim §7.3 actually makes, and the one that keeps the save honest:
		// nothing integrates, so re-reading a time gives the same answer whatever
		// happened in between.
		const t = 1234567;
		const first = placeBodies(contents, t);
		placeBodies(contents, t + 999);
		expect(placeBodies(contents, t)).toEqual(first);
	});

	test("periods follow Kepler's third law", () => {
		const [a, b] = contents.planets;
		if (!b) return;
		const ratio = (b.orbit.periodS / a.orbit.periodS) ** 2;
		expect(ratio).toBeCloseTo((b.aAu / a.aAu) ** 3, 6);
	});
});
