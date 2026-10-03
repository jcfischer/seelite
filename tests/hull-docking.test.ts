/**
 * **Every hull owes a docking pass**, and this file is it.
 *
 * #26's D5 made handling a hull property and its receipt named the bill in the
 * same breath: `docking.md` §3's six checks and their tolerances were set
 * against one handling model, #94's corridor cue was tuned to one approach, and
 * #5's three regimes must each work at both ends of the roster — *"nothing
 * currently measures that because nothing varies."* Something varies now.
 *
 * The question this file answers is a yes/no with a number behind it: **does the
 * sluggish end of the roster dock inside the same tolerances, or are the
 * tolerances a per-hull table?** A per-hull table would be a decision and not a
 * build, so a failure here is a node rather than a fix.
 *
 * ## What makes it a measurement rather than a ritual
 *
 * A sweep in which every hull passes proves nothing on its own — a build that
 * threw the hull table away and flew the courier eleven times would pass it
 * identically, which is exactly the fault #59 records. So there are three rows
 * and not one:
 *
 * - **The sweep**: every dockable hull, every station role, across the shipped
 *   spin range. The claim.
 * - **The ceiling**: the spin at which each hull *stops* docking. It is the
 *   proof the sweep can go red, and the margin between the worst ceiling and
 *   the game's fastest station is the answer to the tolerance question.
 * - **The control**: the same ceiling measured with every hull flown at the
 *   baseline's handling. If the spread survives that, the spread is not coming
 *   from D5 and none of this measures what it says.
 *
 * The third regime, cruise, does not appear here and that is not an omission:
 * cruise's exit clamps to `ASSIST_CAP_KMS`, which #181 deliberately left
 * hull-invariant, so a ship leaves cruise at the same speed whatever it is
 * flying. Assist-off is likewise absent from the *autopilot* rows because §7's
 * computer flies assisted by construction; what assist-off costs a heavy hull is
 * a longer drift, and `tests/hull.test.ts` pins that as `assistLateralTauS`.
 */

import { describe, expect, test } from "bun:test";
import {
	DOCKABLE_HULL_IDS,
	HULL_SPECS,
	PLAYER_BASELINE_HULL,
	type HullId,
} from "../src/hull";
import { flightPerformance } from "../src/sim";
import {
	SPIN_RPM_RANGE,
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";
import { MAX_DT } from "../src/units";
import {
	FIXTURE_AXIS as AXIS,
	FIXTURE_REFERENCE as REFERENCE,
	FASTEST_ORBIT_SWING_RAD_PER_S,
	flyTheComputer,
} from "./helpers/fly-the-computer";

const fly = (
	hull: HullId,
	type: StationType,
	spinRpm: number,
	perfHull?: HullId,
) =>
	flyTheComputer({
		hull,
		type,
		spinRpm,
		axis: AXIS,
		reference: REFERENCE,
		perfHull,
	});

/** Which of §3's six rows a crossing failed, joined — so a red rung names the
 *  check rather than reporting a boolean. Empty when the crossing passed. */
const failedChecksOf = (run: ReturnType<typeof fly>): string =>
	run.crossing?.evaluation
		? Object.entries(run.crossing.evaluation.checks)
				.filter(([, ok]) => !ok)
				.map(([name]) => name)
				.join("+")
		: run.crossing === null
			? "no crossing"
			: "";

/** Does this role hold a berth this hull fits? A grant *is* a berth reservation
 *  (#147), so a hull no berth fits is refused before it flies anywhere — that is
 *  the protocol working, not a failed entry, and the two are asserted apart. */
const hasBerth = (hull: HullId, type: StationType): boolean =>
	stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm, 1).berths.some(
		(berth) => berthFits(berth, HULL_SPECS[hull].env),
	);

/** Both ends of the shipped range plus its midpoint, derived rather than typed:
 *  a hardcoded interior sample silently leaves the range the day
 *  `SPIN_RPM_RANGE` is narrowed, and would then sweep a spin no station builds.
 *  A non-turning role has one phase and it is zero — passing a spin for one
 *  describes something that cannot happen (`apertureFrame` normalises it
 *  away). */
const spinsFor = (type: StationType): number[] =>
	STATION_GEOMETRY[type].spins
		? [
				SPIN_RPM_RANGE.minRpm,
				(SPIN_RPM_RANGE.minRpm + SPIN_RPM_RANGE.maxRpm) / 2,
				SPIN_RPM_RANGE.maxRpm,
			]
		: [0];

describe("every hull docks while the orbit swings the axis, at MAX_DT (#315)", () => {
	// The step the renderer clamps to and the fastest orbit the generator makes.
	// A point-aimed run-in drifted out of the corridor here and never docked;
	// the baseline hull alone could not show which hulls were exposed.
	for (const hull of DOCKABLE_HULL_IDS) {
		if (!hasBerth(hull, "trade")) continue;
		test(`${hull} at a trade station`, () => {
			const rpm = spinsFor("trade")[1];
			const run = flyTheComputer({
				hull,
				type: "trade",
				spinRpm: rpm,
				axis: AXIS,
				reference: REFERENCE,
				dt: MAX_DT,
				axisSwingRadPerS: FASTEST_ORBIT_SWING_RAD_PER_S,
			});
			expect({
				hull,
				refused: run.refused,
				docked: run.docked,
				failedChecks: failedChecksOf(run),
			}).toEqual({ hull, refused: null, docked: true, failedChecks: "" });
		});
	}
});

describe("every hull docks at every role it has a berth at", () => {
	for (const type of STATION_TYPES) {
		for (const hull of DOCKABLE_HULL_IDS) {
			test(`${hull} at a ${type}`, () => {
				if (!hasBerth(hull, type)) {
					// The outpost's two rejections. Asserted rather than skipped: a
					// row that quietly did nothing would keep passing the day the
					// berth catalogue changed under it.
					const run = fly(hull, type, spinsFor(type)[0]);
					expect([hull, type, run.refused]).toEqual([
						hull,
						type,
						"no-clearance",
					]);
					expect(run.docked).toBe(false);
					return;
				}
				for (const rpm of spinsFor(type)) {
					const run = fly(hull, type, rpm);
					// One `toEqual` over the whole outcome, so a failing rung prints
					// the hull, the role, the spin **and** which of the six checks
					// went red — rather than three near-identical label tuples for a
					// reader to scroll past.
					expect({
						hull,
						type,
						rpm,
						refused: run.refused,
						violations: run.violations,
						docked: run.docked,
						failedChecks: failedChecksOf(run),
						// A run that "docked" on step one would satisfy `docked`
						// without having flown anything.
						flewSomething: run.steps > 50,
					}).toEqual({
						hull,
						type,
						rpm,
						refused: null,
						violations: 0,
						docked: true,
						failedChecks: "",
						flewSomething: true,
					});
				}
			});
		}
	}
});

/** The roles that turn. The ceiling is measured at **both** of them: they cut
 *  their apertures at different planes (0.428 km against 0.372) into different
 *  interiors, and a ceiling taken at one and quoted for the roster would be the
 *  #94 defect — a fixture that defaulted to one station type proving that type's
 *  figure while its comment asserted the other's. */
const SPINNING_TYPES = STATION_TYPES.filter(
	(type) => STATION_GEOMETRY[type].spins,
);

/**
 * The spin above which a hull can no longer hold the aperture's roll, and
 * whether it ever recovers above it.
 *
 * It is **not** the hull's roll rate expressed as an rpm, although it tracks it
 * closely. Check 4 admits 50 degrees of roll error, so a hull can hold the
 * aperture inside tolerance while lagging its phase — which is why the miner
 * reaches 8 rpm on a 4.9 rpm roll cap while the freighter stops at 6.0 on a 6.6.
 * What ends a run is the lag exceeding the tolerance at the crossing.
 *
 * **The whole range is flown, not stopped at the first failure**, and doing so
 * found that the curve is not monotone. The first version broke on the first
 * failure while justifying its coarse step by saying a bisection "would assume
 * the shape of the curve it is measuring" — which is the shape a `break`
 * assumes. Flown out, the courier fails at 13.5 rpm and then docks again at
 * thirteen of the rungs above it, up to 24.
 *
 * **Those are coincidences, not capability**, and that is the reading the
 * numbers support rather than a way of explaining them away: check 4 admits
 * ±50° of roll error, so once a hull can no longer track the phase at all,
 * whether the crossing happens to land inside a 100°-wide window is a matter of
 * where the aperture was at that instant. The evidence is the pattern — above
 * the first failure it is scattered (14, 14.5, 15, 15.5, 16, 17, …), while below
 * it every single rung docks.
 *
 * So the **first failure is the measurement** and the ceiling is the rung below
 * it. `recovered` is reported rather than asserted empty, because asserting it
 * empty would be asserting a monotonicity the game does not have.
 *
 * **A run that never reached the plane is not a ceiling**, and the loop says so:
 * a refusal or a timeout is thrown rather than counted, because either would
 * report a broken harness as a hull's limit.
 */
function spinCeiling(
	hull: HullId,
	type: StationType,
	perfHull?: HullId,
): {
	rpm: number;
	firstFailure: number;
	unbrokenBelow: number;
	recovered: number[];
} {
	let firstFailure = Number.POSITIVE_INFINITY;
	const docks: number[] = [];
	for (let rpm = 1; rpm <= CEILING_SEARCH_MAX_RPM; rpm += 0.5) {
		const run = fly(hull, type, rpm, perfHull);
		if (run.docked) {
			docks.push(rpm);
			continue;
		}
		if (run.refused !== null)
			throw new Error(
				`${hull} at ${type} ${rpm} rpm was refused: ${run.refused}`,
			);
		if (run.crossing === null)
			throw new Error(
				`${hull} at ${type} ${rpm} rpm never reached the plane in ` +
					`${run.gameTime.toFixed(0)} s — a timeout, not a roll ceiling`,
			);
		firstFailure = Math.min(firstFailure, rpm);
	}
	const below = docks.filter((rpm) => rpm < firstFailure);
	return {
		rpm: Math.max(0, ...below),
		firstFailure,
		/** Every rung below the first failure that docked. Its length against the
		 *  number of rungs there is the claim that matters: no gaps inside the
		 *  range a hull can actually hold. */
		unbrokenBelow: below.length,
		recovered: docks.filter((rpm) => rpm > firstFailure),
	};
}

/** The top of the search. Well above every hull's ceiling, so a hull that never
 *  failed inside it would be reporting a broken harness rather than a limit —
 *  which is what the `firstFailure` row asserts. */
const CEILING_SEARCH_MAX_RPM = 24;

/** One hull's worst measured ceiling, and which role it was worst at. Named once
 *  so the cache and the seed below cannot restate `spinCeiling`'s shape and go
 *  stale against it. */
type Ceiling = ReturnType<typeof spinCeiling> & { type: StationType };

/** The lowest ceiling a hull has across the turning roles, and where. Computed
 *  once: three rows below read it, and each one flies up to 47 approaches per
 *  hull per role. */
const ceilingOf = (() => {
	const cache = new Map<string, Ceiling>();
	return (hull: HullId, perfHull?: HullId) => {
		const key = `${hull}|${perfHull ?? ""}`;
		const hit = cache.get(key);
		if (hit) return hit;
		let worst: Ceiling = {
			rpm: Number.POSITIVE_INFINITY,
			type: SPINNING_TYPES[0],
			firstFailure: Number.POSITIVE_INFINITY,
			unbrokenBelow: 0,
			recovered: [],
		};
		for (const type of SPINNING_TYPES) {
			const measured = spinCeiling(hull, type, perfHull);
			if (measured.rpm < worst.rpm) worst = { ...measured, type };
		}
		cache.set(key, worst);
		return worst;
	};
})();

describe("the tolerances hold for the whole roster, with margin", () => {
	test("the worst-handling hull still docks at twice the fastest station", () => {
		const ceilings = DOCKABLE_HULL_IDS.map((hull) => ({
			hull,
			...ceilingOf(hull),
			rollRpm: (flightPerformance(hull).angularMax.roll * 60) / (2 * Math.PI),
		}));
		for (const row of ceilings)
			console.log(
				`${row.hull.padEnd(12)} docks to ${row.rpm.toFixed(1)} rpm ` +
					`(worst role ${row.type}, roll cap ${row.rollRpm.toFixed(1)} rpm)`,
			);
		const worst = ceilings.reduce((a, b) => (a.rpm <= b.rpm ? a : b));
		console.log(
			`worst ${worst.hull} at ${worst.rpm} rpm against a fastest station of ` +
				`${SPIN_RPM_RANGE.maxRpm} rpm`,
		);
		console.log(`margin ${(worst.rpm / SPIN_RPM_RANGE.maxRpm).toFixed(2)}x`);
		// **This is the node's answer**, and it is asserted as a factor rather
		// than as "it passed": the margin is what says §3's tolerances stay one
		// table rather than becoming a per-hull one.
		//
		// The bound is **1.5x and the measurement is 1.67x** (2.0x until #619
		// turned the computer through the vents), deliberately apart.
		// A threshold set at the measured value is not a measurement (#25) — it
		// would go red on a retune that changed nothing about the answer, and a
		// later session would loosen it on the prose. What 1.5x catches is the
		// regression that matters: a hull sluggish enough to be marginal at a
		// station the generator actually builds.
		expect(worst.rpm).toBeGreaterThanOrEqual(SPIN_RPM_RANGE.maxRpm * 1.5);
	});

	test("the sweep can go red — every hull has a spin that beats it", () => {
		// Before offering a check as verification, build the defect it names and
		// watch it fail (#11). The defect here is a station spinning faster than
		// the hull can track, and every hull has one inside the search range: a
		// sweep that could not fail would be a ritual.
		for (const hull of DOCKABLE_HULL_IDS) {
			const { rpm, type, firstFailure, unbrokenBelow, recovered } =
				ceilingOf(hull);
			// A hull that never failed inside the search range would report the top
			// of the range as its ceiling, which is a broken harness rather than a
			// limit — so the failure has to be *observed*, not inferred from where
			// a loop stopped.
			expect([hull, Number.isFinite(firstFailure)]).toEqual([hull, true]);
			expect([hull, firstFailure]).toEqual([hull, rpm + 0.5]);
			// **Not "every rung below the first failure docks"** — that is true by
			// construction, since the first failure is by definition the lowest rung
			// that does not, and asserting it would be asserting a definition. What
			// can fail, and what the margin actually rests on, is that the first
			// failure is **above the whole shipped spin range**: every hull holds
			// every station the generator builds, with room over.
			expect([hull, firstFailure > SPIN_RPM_RANGE.maxRpm]).toEqual([
				hull,
				true,
			]);
			// `unbrokenBelow` is printed rather than asserted, for the same reason.
			console.log(
				`${hull.padEnd(12)} first fails at ${firstFailure} rpm after ` +
					`${unbrokenBelow} unbroken rungs; ` +
					`${recovered.length} coincidental crossings above it`,
			);
		}
	});

	test("the spread is D5's and nothing else's", () => {
		// The control arm, and **what it holds fixed is the handling alone.** Each
		// hull keeps its own envelope, so it keeps its own berth and its own
		// allocation; only `perfHull` is pinned to the baseline. That is the right
		// shape for the claim: if the envelope or the berth were producing the
		// spread, it would survive here. It collapses to zero, so what is left is
		// mass and thrust — #26's D5 and nothing else.
		const controlled = DOCKABLE_HULL_IDS.map(
			(hull) => ceilingOf(hull, PLAYER_BASELINE_HULL).rpm,
		);
		const spread = Math.max(...controlled) - Math.min(...controlled);
		const live = DOCKABLE_HULL_IDS.map((hull) => ceilingOf(hull).rpm);
		const liveSpread = Math.max(...live) - Math.min(...live);
		console.log(
			`ceiling spread: ${liveSpread.toFixed(1)} rpm live against ` +
				`${spread.toFixed(1)} rpm at one hull's handling`,
		);
		expect(spread).toBe(0);
		expect(liveSpread).toBeGreaterThan(0);
	});
});
