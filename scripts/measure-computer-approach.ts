/**
 * The docking computer's approach over the orbit it has to track (#315).
 *
 * `docking.md` §7 states how many approaches fail, the worst dock time and the
 * most corridor exits for the shipped run-in law. This flies that sweep and
 * prints those figures, so they stay a measurement of the build that is
 * checked out rather than a number copied into a spec:
 *
 * - every hull with a berth at a trade station (a hull no berth fits is
 *   refused clearance, which is the protocol working, and is counted apart);
 * - steps 1/60 s, 0.05 s and `MAX_DT`, the step the renderer clamps to;
 * - spins 0.6, 1.14, 2 and 3 rpm;
 * - the docking axis fixed, and swinging at a 240, 90 and 45 min orbit.
 *
 * The fixture axis is `tests/docking.test.ts`'s, so a sign error in the frame
 * cannot hide behind world coordinates.
 *
 *   bun scripts/measure-computer-approach.ts
 */

import { HULL_SPECS, type HullId } from "../src/hull";
import { STATION_GEOMETRY } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";
import { MAX_DT } from "../src/units";
import {
	type ComputerTraceStep,
	FASTEST_ORBIT_SWING_RAD_PER_S,
	FIXTURE_AXIS as AXIS,
	FIXTURE_REFERENCE as REFERENCE,
	flyTheComputer,
} from "../tests/helpers/fly-the-computer";

const STEPS = [1 / 60, 0.05, MAX_DT];
const SPINS = [0.6, 1.14, 2, 3];
const ORBITS: [string, number][] = [
	["fixed", 0],
	["240 min", (2 * Math.PI) / (240 * 60)],
	["90 min", FASTEST_ORBIT_SWING_RAD_PER_S],
	["45 min", (2 * Math.PI) / (45 * 60)],
];

const interior = stationInterior(
	"trade",
	STATION_GEOMETRY.trade.aperturePlaneKm,
	1,
);
const allHulls = Object.keys(HULL_SPECS) as HullId[];
const hulls = allHulls.filter((hull) =>
	interior.berths.some((berth) => berthFits(berth, HULL_SPECS[hull].env)),
);

let runs = 0;
let failed = 0;
let worstDockS = 0;
let mostExits = 0;
let widestRunIn = 0;
let widestAt = "";
let worstNoseDeg = 0;
let worstRollDeg = 0;
const failures: string[] = [];
const byOrbit = new Map<string, { runs: number; failed: number }>();

for (const hull of hulls)
	for (const dt of STEPS)
		for (const spinRpm of SPINS)
			for (const [orbit, swing] of ORBITS) {
				const trace: ComputerTraceStep[] = [];
				const run = flyTheComputer({
					spinRpm,
					hull,
					axis: AXIS,
					reference: REFERENCE,
					dt,
					axisSwingRadPerS: swing,
					trace,
				});
				runs++;
				const row = byOrbit.get(orbit) ?? { runs: 0, failed: 0 };
				row.runs++;
				byOrbit.set(orbit, row);
				let exits = 0;
				for (let i = 1; i < trace.length; i++) {
					if (trace[i - 1].phase === "run-in" && trace[i].phase === "line-up")
						exits++;
					const ratio = trace[i].offAxisKm / trace[i].corridorKm;
					if (trace[i].phase === "run-in" && ratio > widestRunIn) {
						widestRunIn = ratio;
						widestAt = `${hull}, step ${dt.toFixed(3)} s, ${spinRpm} rpm, ${orbit} orbit`;
					}
				}
				mostExits = Math.max(mostExits, exits);
				if (!run.docked || run.violations > 0) {
					failed++;
					row.failed++;
					failures.push(
						`${hull} step ${dt.toFixed(3)} s, ${spinRpm} rpm, ${orbit}: ${run.refused ?? "not docked"} at ${run.gameTime.toFixed(0)} s`,
					);
					continue;
				}
				worstDockS = Math.max(worstDockS, run.gameTime);
				const evaluation = run.crossing?.evaluation;
				if (evaluation) {
					worstNoseDeg = Math.max(worstNoseDeg, evaluation.noseAngleDeg);
					if (!Number.isNaN(evaluation.rollAngleDeg))
						worstRollDeg = Math.max(worstRollDeg, evaluation.rollAngleDeg);
				}
			}

console.log(
	`hulls with a trade berth: ${hulls.length} of ${allHulls.length} (${allHulls.filter((h) => !hulls.includes(h)).join(", ")} refused)`,
);
console.log(`approaches: ${runs}`);
console.log(`failed to dock: ${failed} of ${runs}`);
console.log(`worst dock: ${worstDockS.toFixed(0)} s`);
console.log(`most corridor exits in one run: ${mostExits}`);
console.log(
	`widest run-in: ${widestRunIn.toFixed(2)} of the corridor half-width (${widestAt})`,
);
console.log(
	`worst at the crossing: nose ${worstNoseDeg.toFixed(1)}°, roll ${worstRollDeg.toFixed(1)}°`,
);
for (const [orbit, row] of byOrbit)
	console.log(`  ${orbit}: ${row.failed} of ${row.runs} failed`);
for (const line of failures.slice(0, 20)) console.log(`  ${line}`);
