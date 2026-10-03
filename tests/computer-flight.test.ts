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
const BASE = { hull: PLAYER_BASELINE_HULL, axis: AXIS, reference: REFERENCE };

describe("the docking computer step", () => {
	test("a queued clearance lines up and waits at the corridor, at zero speed", () => {
		// `docking.md` §13.2: a queued request is permission to line up and
		// wait, not to enter. The computer tracks the corridor as if granted
		// and holds the run-in at zero until a berth is named.
		const trace: ComputerTraceStep[] = [];
		const run = flyTheComputer({
			spinRpm: 2,
			...BASE,
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
			...BASE,
			trace,
		});
		const runIn = trace.filter((step) => step.phase === "run-in");
		expect(runIn.length).toBeGreaterThan(0);
		expect(runIn.some((step) => step.throttle > 0)).toBe(true);
	});

	test("with no clearance it refuses and does not fly", () => {
		const run = flyTheComputer({
			spinRpm: 0,
			...BASE,
			granted: false,
		});
		expect(run.refused).toBe("no-clearance");
		expect(run.steps).toBe(0);
	});
});

describe("no caller flies the computer by hand (#648)", () => {
	// Before #648 `Game` and the harness each turned the controller's command
	// into a stick and a throttle of their own. Every caller of the controller
	// is named here with its reason; flying it is `flyComputer`'s, and a new
	// caller — one with a follower, or one that makes its own throttle from
	// `speedKms` — is a red run rather than a review finding (sage round 1).
	const CONTROLLER = /\bdockingComputerStep\(/;
	const ALLOWED: Record<string, string> = {
		"src/docking.ts": "the controller's own definition",
		"src/docking-computer.ts": "flyComputer, the one place it is flown",
		"tests/docking.test.ts": "the controller law's own rows",
		"tests/roll-reference.test.ts": "the commanded roll reference, read alone",
		"scripts/probe-docking-traffic.mjs":
			"reports what the computer would command beside the game's lane state",
	};
	const files = [
		...srcFiles(),
		...scriptFiles([".ts", ".mjs"]),
		...testFiles(),
	];

	test("only the allowed files call the controller", () => {
		const callers = files.filter((f) => CONTROLLER.test(codeOf(f))).sort();
		expect(callers).toEqual(Object.keys(ALLOWED).sort());
	});
});
