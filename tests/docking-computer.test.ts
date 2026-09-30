/**
 * The docking computer's session: whether it flies, why it last let go, and the
 * corridor phase it feeds back into its next step (#596).
 *
 * `toggleDockingComputer` cleared the last refusal when it engaged, and the
 * first-day guided start and the opening's `engage-computer` order set the
 * flag directly and did not — so `dockingSnapshot` could report a refusal
 * beside `computerEngaged: true`. The four fields now sit behind
 * `DockingComputer`, whose fields have no setter, so tsc refuses a direct write;
 * the class rows below prove the invariant and the scan proves `main.ts` has no
 * other way to engage.
 */
import { describe, expect, test } from "bun:test";
import { DockingComputer } from "../src/docking-computer";
import { codeOf } from "./lib/source-scan";

const refusedOnce = () => {
	const computer = new DockingComputer();
	computer.engage();
	computer.disengage({ refused: "no-clearance" });
	return computer;
};

describe("DockingComputer", () => {
	test("a refusal is recorded and the computer stops flying", () => {
		expect(refusedOnce().snapshot()).toEqual({
			computerEngaged: false,
			computerRefusal: "no-clearance",
		});
	});

	test("engaging after a refusal clears it", () => {
		const computer = refusedOnce();
		computer.engage();
		expect(computer.snapshot()).toEqual({
			computerEngaged: true,
			computerRefusal: null,
		});
	});

	test("a disengage that names no refusal keeps the last one", () => {
		// A dock, a bounce, control input or a reset is not the computer
		// refusing, so it must not erase why it refused before.
		const computer = refusedOnce();
		computer.engage();
		computer.disengage({ refused: "hostile" });
		computer.disengage();
		expect(computer.refusal).toBe("hostile");
	});

	test("engaging starts the corridor on the tight side", () => {
		const computer = new DockingComputer();
		computer.engage();
		computer.beginStep();
		computer.phaseAt("station-a", "idle");
		computer.recordPhase("run-in");
		computer.disengage();
		expect(computer.phase).toBe("run-in");
		computer.engage();
		expect(computer.phase).toBe("idle");
	});

	test("only an idle disengage forgets the phase", () => {
		const computer = new DockingComputer();
		computer.engage();
		computer.recordPhase("run-in");
		computer.disengage({ idle: true });
		expect(computer.phase).toBe("idle");
	});

	test("a step takes the last phase and leaves idle behind", () => {
		const computer = new DockingComputer();
		computer.recordPhase("run-in");
		expect(computer.beginStep()).toBe("run-in");
		expect(computer.phase).toBe("idle");
	});

	test("a phase belongs to one station's corridor", () => {
		const computer = new DockingComputer();
		expect(computer.phaseAt("station-a", "run-in")).toBe("idle");
		expect(computer.phaseAt("station-a", "run-in")).toBe("run-in");
		expect(computer.phaseAt("station-b", "run-in")).toBe("idle");
	});
});

describe("main.ts routes every engage through DockingComputer", () => {
	const main = codeOf("src/main.ts");

	test("no field the class owns is still written on Game", () => {
		const retired =
			/\b(dockingComputerEngaged|lastComputerRefusal|lastComputerPhase|lastComputerStationId)\b/;
		const left = main
			.split("\n")
			.flatMap((line, i) => {
				const hit = line.match(retired);
				return hit ? [`${hit[1]}:${i + 1}`] : [];
			});
		expect(left).toEqual([]);
	});

	test("every engage and disengage is a call on the one session", () => {
		// The premise, so a renamed field cannot pass by finding nothing.
		const engages = main.match(/this\.dockingComputer\.engage\(\)/g) ?? [];
		// The toggle, the guided start twice and the opening's order.
		expect(engages.length).toBe(4);
		expect(main).not.toMatch(/dockingComputer\.(?:engaged|refusal)\s*=/);
	});
});
