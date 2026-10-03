/**
 * One docking computer step for `Game` and the harness (#648): `flyComputer`
 * in `src/docking-computer.ts`.
 *
 * The harness in `tests/helpers/fly-the-computer.ts` is what
 * `measure-computer-approach.ts` and the docking rows fly, and `docking.md`
 * §4/§7 quote its figures. Before #648 it repeated `Game`'s loop by hand and
 * never met a queued clearance, so those figures came from a computer the
 * game does not run. These rows hold the two halves together.
 */

import { describe, expect, test } from "bun:test";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import { type Vec3, v3 } from "../src/vec3";
import {
	type ComputerTraceStep,
	flyTheComputer,
} from "./helpers/fly-the-computer";
import { codeOf, scriptFiles, srcFiles, testFiles } from "./lib/source-scan";

const AXIS: Vec3 = v3(0, 0, 1);
const REFERENCE: Vec3 = v3(0, 1, 0);

describe("the docking computer step", () => {
	test("a queued clearance lines up and waits at the corridor, at zero speed", () => {
		// `docking.md` §13.2: a queued request is permission to line up and
		// wait, not to enter. The computer tracks the corridor as if granted
		// and holds the run-in at zero until a berth is named.
		const trace: ComputerTraceStep[] = [];
		const run = flyTheComputer({
			spinRpm: 2,
			hull: PLAYER_BASELINE_HULL,
			axis: AXIS,
			reference: REFERENCE,
			queued: true,
			limitS: 120,
			trace,
		});
		expect(run.refused).toBeNull();
		expect(run.docked).toBe(false);
		expect(run.crossing).toBeNull();
		const runIn = trace.filter((step) => step.phase === "run-in");
		// The control: a run that never lined up has nothing to hold.
		expect(runIn.length).toBeGreaterThan(0);
		expect(runIn.every((step) => step.throttle === 0)).toBe(true);
	});

	test("a live grant flies the run-in at speed, the control for the row above", () => {
		const trace: ComputerTraceStep[] = [];
		flyTheComputer({
			spinRpm: 2,
			hull: PLAYER_BASELINE_HULL,
			axis: AXIS,
			reference: REFERENCE,
			trace,
		});
		const runIn = trace.filter((step) => step.phase === "run-in");
		expect(runIn.length).toBeGreaterThan(0);
		expect(runIn.some((step) => step.throttle > 0)).toBe(true);
	});

	test("with no clearance it refuses and does not fly", () => {
		const run = flyTheComputer({
			spinRpm: 0,
			hull: PLAYER_BASELINE_HULL,
			axis: AXIS,
			reference: REFERENCE,
			granted: false,
		});
		expect(run.refused).toBe("no-clearance");
		expect(run.steps).toBe(0);
	});
});

describe("no caller flies the computer by hand (#648)", () => {
	// Before #648 `Game` and the harness each paired the controller with an
	// attitude follower and a throttle of their own. Reading the controller's
	// command alone is fine — the law's own rows and a probe that reports
	// what the computer would command do — but pairing it with a follower is
	// flying it, and that is `flyComputer`'s.
	const CONTROLLER = /\bdockingComputerStep\(/;
	const FOLLOWER = /\bAttitudeFollower\b/;
	const ALLOWED = ["src/docking-computer.ts"];
	const files = [
		...srcFiles(),
		...scriptFiles([".ts", ".mjs"]),
		...testFiles(),
	];

	test("only flyComputer pairs the controller with a follower", () => {
		const pairs = files
			.filter((f) => {
				const code = codeOf(f);
				return CONTROLLER.test(code) && FOLLOWER.test(code);
			})
			.sort();
		expect(pairs).toEqual(ALLOWED);
	});
});
