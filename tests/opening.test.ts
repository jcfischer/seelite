/**
 * #535: the opening's pure half — the pilot script that flies the ship, the
 * director that chooses which shot shows it, the skip, the two lengths, and
 * the fallback.
 *
 * #530 D1 makes the opening a real flight: the script flies the ship in the
 * sim, and the shots only choose what to show. D2 makes skip sub-step the same
 * script to its end, so a watched run and a skipped run end in one state. That
 * holds only if nothing the script decides reads the wall clock. These rows
 * drive the script against a small deterministic stand-in for the sim and
 * check it: a watched run at any frame cadence, a skip from any moment, and a
 * run skipped from the start take the same steps and end in the same state.
 */
import { describe, expect, test } from "bun:test";
import {
	OPENING,
	OPENING_SHOTS,
	type OpeningSim,
	OpeningRun,
	type PilotAction,
	openingAtBoot,
	openingCaption,
	openingOwedOnLoad,
	type PilotFacts,
	openingShot,
	pilotStep,
	startPilot,
} from "../src/opening";

/**
 * A stand-in for `Game`: enough of the flight for every leg of the script to
 * end, and nothing else. A cruise leg of `cruiseS`, a run-in of `approachS`, a
 * traversal that asks to be skipped. Every quantity moves only in `step`, so
 * the only way two runs differ is a different sequence of actions or steps.
 */
class FakeSim implements OpeningSim {
	t = 0;
	steps = 0;
	throttle = 0;
	regime: PilotFacts["regime"] = "normal";
	spoolLeftS = 0;
	cruiseLeftS: number;
	approachLeftS: number;
	dockPhase: PilotFacts["dockPhase"] = "flying";
	computer = false;
	grant = false;
	log: string[] = [];
	/** Refuse cruise, as an empty tank or an unavailable detour does. */
	refuseCruise = false;
	/** Drop the computer every `dropEvery` steps of the run-in. */
	dropEvery = 0;
	/** A traversal that never finishes and a run-in that never ends. */
	stuck = false;
	shotChanged?: (shot: string | null) => void;

	constructor(cruiseS = 60, approachS = 80) {
		this.cruiseLeftS = cruiseS;
		this.approachLeftS = approachS;
	}

	facts(): PilotFacts {
		return {
			regime: this.regime,
			spooling: this.spoolLeftS > 0,
			dockPhase: this.dockPhase,
			computerEngaged: this.computer,
			grantLive: this.grant,
			cruiseEtaS: this.regime === "cruise" ? this.cruiseLeftS : null,
			stationKm:
				this.regime === "cruise" ? 1e6 : Math.max(0, this.approachLeftS / 10),
			inVicinity: this.regime !== "cruise",
			runIn:
				this.regime !== "cruise" && this.computer && this.approachLeftS < 40,
		};
	}

	apply(action: PilotAction) {
		this.log.push(`${this.steps}:${action}`);
		switch (action) {
			case "throttle-burn":
				this.throttle = 1;
				return;
			case "throttle-zero":
				this.throttle = 0;
				return;
			case "engage-cruise":
				if (!this.refuseCruise) this.spoolLeftS = 3;
				return;
			case "request-clearance":
				this.grant = true;
				return;
			case "engage-computer":
				this.computer = true;
				return;
			case "skip-traversal":
				if (!this.stuck) this.dockPhase = "docked";
				return;
		}
	}

	step(dt: number) {
		this.steps++;
		this.t += dt;
		if (this.spoolLeftS > 0) {
			this.spoolLeftS -= dt;
			if (this.spoolLeftS <= 1e-9) {
				this.spoolLeftS = 0;
				this.regime = "cruise";
			}
			return;
		}
		if (this.regime === "cruise") {
			this.cruiseLeftS -= dt;
			if (this.cruiseLeftS <= 0) this.regime = "normal";
			return;
		}
		if (this.computer && this.dockPhase === "flying" && !this.stuck) {
			this.approachLeftS -= dt;
			if (this.dropEvery > 0 && this.steps % this.dropEvery === 0)
				this.computer = false;
			if (this.approachLeftS <= 0) this.dockPhase = "arriving";
		}
	}

	/** Everything a run's end state is judged on. */
	state() {
		return {
			steps: this.steps,
			t: Number(this.t.toFixed(9)),
			throttle: this.throttle,
			regime: this.regime,
			dockPhase: this.dockPhase,
			log: this.log.join(" "),
		};
	}
}

/** A seeded frame cadence: wall seconds between 4 ms and 60 ms. */
function cadence(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return 0.004 + (s / 2 ** 32) * 0.056;
	};
}

/** Watch a run to its end, one frame at a time. */
function watch(run: OpeningRun, sim: FakeSim, seed: number, maxFrames = 1e6) {
	const next = cadence(seed);
	const shots: string[] = [];
	for (let i = 0; i < maxFrames && !run.done; i++) {
		run.frame(sim, next());
		const shot = run.shot ?? "cut";
		if (shots[shots.length - 1] !== shot) shots.push(shot);
	}
	return shots;
}

describe("the two lengths (#530 D3)", () => {
	test("a guided opening has four shots and a free one two", () => {
		expect(OPENING_SHOTS.guided).toEqual([
			"arrival",
			"flypast",
			"cruise",
			"dock",
		]);
		expect(OPENING_SHOTS.free).toEqual(["arrival", "flypast"]);
	});

	test("a guided run ends docked", () => {
		const sim = new FakeSim();
		const run = new OpeningRun("guided");
		run.skip(sim);
		expect(run.done).toBe(true);
		expect(run.outcome).toBe("docked");
		expect(sim.dockPhase).toBe("docked");
	});

	test("a free run ends in flight, never cruising, with the throttle back at zero", () => {
		const sim = new FakeSim();
		const run = new OpeningRun("free");
		run.skip(sim);
		expect(run.outcome).toBe("flying");
		expect(sim.regime).toBe("normal");
		expect(sim.log.some((a) => a.endsWith("engage-cruise"))).toBe(false);
		expect(sim.throttle).toBe(0);
	});

	test("a free run is arrival plus fly-past: about ten seconds of sim", () => {
		const sim = new FakeSim();
		new OpeningRun("free").skip(sim);
		expect(sim.t).toBeCloseTo(OPENING.arriveS + OPENING.burnS.free, 1);
		expect(sim.t).toBeGreaterThan(8);
		expect(sim.t).toBeLessThan(13);
	});
});

describe("the pilot script", () => {
	test("the arrival holds still, then the burn opens the throttle", () => {
		const sim = new FakeSim();
		let pilot = startPilot("guided");
		const actions: PilotAction[] = [];
		for (let i = 0; i < Math.round(OPENING.arriveS / OPENING.dtS) + 2; i++) {
			const r = pilotStep(pilot, sim.facts());
			for (const a of r.actions) {
				actions.push(a);
				sim.apply(a);
			}
			sim.step(OPENING.dtS);
			pilot = r.state;
		}
		expect(actions).toEqual(["throttle-burn"]);
		expect(pilot.leg).toBe("burn");
	});

	test("the cruise leg ends in a clearance request and the station's computer", () => {
		const sim = new FakeSim();
		new OpeningRun("guided").skip(sim);
		const order = sim.log.map((entry) => entry.split(":")[1]);
		expect(order.slice(0, 4)).toEqual([
			"throttle-burn",
			"engage-cruise",
			"request-clearance",
			"engage-computer",
		]);
		expect(order[order.length - 1]).toBe("skip-traversal");
	});

	test("a computer that drops out is put back, as startDockedAtHome does", () => {
		const sim = new FakeSim();
		sim.dropEvery = 600;
		const run = new OpeningRun("guided");
		run.skip(sim);
		expect(run.outcome).toBe("docked");
		const engages = sim.log.filter((a) => a.endsWith("engage-computer"));
		expect(engages.length).toBeGreaterThan(1);
	});

	test("a refused cruise falls back rather than waiting forever (D6)", () => {
		const sim = new FakeSim();
		sim.refuseCruise = true;
		const run = new OpeningRun("guided");
		run.skip(sim);
		expect(run.done).toBe(true);
		expect(run.outcome).toBe("fallback");
		// Not long after the spool would have ended: the refusal is noticed.
		expect(sim.t).toBeLessThan(
			OPENING.arriveS + OPENING.burnS.guided + OPENING.spoolCapS + 0.1,
		);
	});

	test("a cruise leg that never ends falls back at its cap", () => {
		const sim = new FakeSim(1e9);
		const run = new OpeningRun("guided");
		run.skip(sim);
		expect(run.outcome).toBe("fallback");
		expect(sim.t).toBeLessThan(
			OPENING.arriveS +
				OPENING.burnS.guided +
				OPENING.spoolCapS +
				OPENING.cruiseCapS +
				1,
		);
	});

	test("a run-in that never ends falls back at its cap", () => {
		const sim = new FakeSim();
		sim.stuck = true;
		const run = new OpeningRun("guided");
		run.skip(sim);
		expect(run.outcome).toBe("fallback");
	});
});

describe("the director", () => {
	test("each leg has its shot, and a cruise far from its end is a cut", () => {
		const pilot = startPilot("guided");
		const facts: PilotFacts = {
			regime: "normal",
			spooling: false,
			dockPhase: "flying",
			computerEngaged: false,
			grantLive: false,
			cruiseEtaS: null,
			stationKm: 1e8,
			inVicinity: true,
			runIn: false,
		};
		expect(openingShot(pilot, facts)).toBe("arrival");
		expect(openingShot({ ...pilot, leg: "burn" }, facts)).toBe("flypast");
		expect(openingShot({ ...pilot, leg: "spool" }, facts)).toBe("flypast");
		const cruising = { ...facts, regime: "cruise" as const };
		expect(
			openingShot({ ...pilot, leg: "cruise" }, { ...cruising, cruiseEtaS: 50 }),
		).toBe(null);
		expect(
			openingShot(
				{ ...pilot, leg: "cruise" },
				{ ...cruising, cruiseEtaS: OPENING.cruiseShot.simS - 0.1 },
			),
		).toBe("cruise");
		// Past the cruise shot's tail, the approach is a cut until the run-in.
		const pastTail =
			Math.round(
				(OPENING.cruiseShot.tailS * OPENING.cruiseShot.ratio) / OPENING.dtS,
			) + 1;
		expect(
			openingShot(
				{ ...pilot, leg: "approach", legSteps: pastTail },
				{ ...facts, stationKm: 40 },
			),
		).toBe(null);
		expect(
			openingShot(
				{ ...pilot, leg: "approach", legSteps: pastTail },
				{ ...facts, stationKm: OPENING.dockShot.km - 0.1, runIn: true },
			),
		).toBe("dock");
		// A line-up that swings close past the station is not the run-in.
		expect(
			openingShot(
				{ ...pilot, leg: "approach", legSteps: pastTail },
				{ ...facts, stationKm: OPENING.dockShot.km - 0.5 },
			),
		).toBe(null);
	});

	test("a watched guided run shows every shot, in order, with cuts between", () => {
		const sim = new FakeSim();
		const run = new OpeningRun("guided");
		const shots = watch(run, sim, 1).filter((s) => s !== "cut");
		expect(shots).toEqual(["arrival", "flypast", "cruise", "dock"]);
	});

	test("a guided run shows about thirty seconds (D4)", () => {
		const sim = new FakeSim();
		const run = new OpeningRun("guided");
		watch(run, sim, 3);
		expect(run.shownS).toBeGreaterThan(24);
		expect(run.shownS).toBeLessThan(36);
	});

	test("each shot shows the same length at every frame rate", () => {
		const lengths = [1, 2, 3].map((seed) => {
			const run = new OpeningRun("guided");
			watch(run, new FakeSim(), seed);
			return run.shownBy;
		});
		// A shot ends on a sim step, and a frame runs whole steps: the lengths can
		// differ by a step shown at the slowest ratio, never by a frame.
		const step = OPENING.dtS;
		for (const shot of OPENING_SHOTS.guided)
			for (const shown of lengths)
				expect(Math.abs(shown[shot] - lengths[0][shot])).toBeLessThan(step);
		expect(lengths[0].arrival).toBeCloseTo(OPENING.arriveS, 6);
		expect(lengths[0].flypast).toBeCloseTo(OPENING.burnS.guided + 3, 1);
	});
});

describe("watched and skipped end in one state (#530 D2)", () => {
	const skipped = (kind: "guided" | "free", setup?: (s: FakeSim) => void) => {
		const sim = new FakeSim();
		setup?.(sim);
		const run = new OpeningRun(kind);
		run.skip(sim);
		return { run, sim };
	};

	for (const kind of ["guided", "free"] as const)
		test(`${kind}: every cadence watched ends where the skip ends`, () => {
			const reference = skipped(kind).sim.state();
			for (const seed of [1, 7, 42, 99]) {
				const sim = new FakeSim();
				const run = new OpeningRun(kind);
				watch(run, sim, seed);
				expect(sim.state()).toEqual(reference);
			}
		});

	test("a skip from any moment of a watched run ends where the skip ends", () => {
		const reference = skipped("guided").sim.state();
		for (const frames of [0, 1, 50, 400, 700, 2000]) {
			const sim = new FakeSim();
			const run = new OpeningRun("guided");
			const next = cadence(frames + 5);
			for (let i = 0; i < frames && !run.done; i++) run.frame(sim, next());
			run.skip(sim);
			expect(sim.state()).toEqual(reference);
		}
	});

	test("a fallback is the same fallback watched or skipped", () => {
		const reference = skipped("guided", (s) => {
			s.refuseCruise = true;
		});
		const sim = new FakeSim();
		sim.refuseCruise = true;
		const run = new OpeningRun("guided");
		watch(run, sim, 11);
		expect(run.outcome).toBe(reference.run.outcome);
		expect(sim.state()).toEqual(reference.sim.state());
	});

	test("a skip after the end does nothing", () => {
		const { run, sim } = skipped("guided");
		const before = sim.state();
		run.skip(sim);
		run.frame(sim, 0.016);
		expect(sim.state()).toEqual(before);
	});
});

describe("the phase handle", () => {
	test("holds a run at a named shot and shown time, and moves only forward", () => {
		const sim = new FakeSim();
		const run = new OpeningRun("guided");
		run.advanceTo(sim, "cruise", 2);
		expect(run.shot).toBe("cruise");
		expect(run.shownBy.cruise).toBeCloseTo(2, 1);
		const held = sim.state();
		// Held: a frame steps nothing.
		run.frame(sim, 0.5);
		expect(sim.state()).toEqual(held);
		run.advanceTo(sim, "dock", 0);
		expect(run.shot).toBe("dock");
		expect(() => run.advanceTo(sim, "arrival", 1)).toThrow();
	});

	test("a held run skipped ends where the skip ends", () => {
		const reference = new FakeSim();
		new OpeningRun("guided").skip(reference);
		const sim = new FakeSim();
		const run = new OpeningRun("guided");
		run.advanceTo(sim, "flypast", 1.5);
		run.skip(sim);
		expect(sim.state()).toEqual(reference.state());
	});

	test("a shot the kind does not have is refused", () => {
		const run = new OpeningRun("free");
		expect(() => run.advanceTo(new FakeSim(), "dock", 0)).toThrow();
	});
});

describe("who sees the opening (#530 D3, amended)", () => {
	const at = (
		firstDay: "guided" | "free",
		over: Partial<Parameters<typeof openingAtBoot>[0]> = {},
	) =>
		openingAtBoot({
			firstDay,
			direct: false,
			pinnedSystem: false,
			cinematic: false,
			...over,
		});

	test("a player's new game watches its opening, guided or free", () => {
		expect(at("guided")).toEqual({ kind: "guided", watched: true });
		expect(at("free")).toEqual({ kind: "free", watched: true });
	});

	test("?boot=direct and ?system= see no sequence", () => {
		for (const over of [{ direct: true }, { pinnedSystem: true }]) {
			// Guided still flies in: skipped, the same script to its end.
			expect(at("guided", over)).toEqual({ kind: "guided", watched: false });
			// Free steps nothing: at rest at the arrival point, clock at zero.
			expect(at("free", over)).toBe(null);
		}
	});

	test("?cinematic forces it, for the strip", () => {
		const over = { direct: true, pinnedSystem: true, cinematic: true };
		expect(at("guided", over)).toEqual({ kind: "guided", watched: true });
		expect(at("free", over)).toEqual({ kind: "free", watched: true });
	});
});

describe("the captions", () => {
	const names = { system: "Lave", station: "Lave Orbital" };
	test("the arrival names the system, the cruise the station", () => {
		expect(openingCaption("arrival", names)).toContain("LAVE");
		expect(openingCaption("cruise", names)).toContain("LAVE ORBITAL");
	});
	test("the dock shot says station control brings the ship in (D7)", () => {
		const line = openingCaption("dock", names);
		expect(line.startsWith("STATION CONTROL")).toBe(true);
		expect(line).toContain("bringing you in");
		// It must not teach that a ship docks itself.
		expect(line.toLowerCase()).not.toContain("computer");
	});
});

describe("a shot starts on a step", () => {
	test("the sim hears each shot change on the step it happens, watched or held", () => {
		const heard = (drive: (run: OpeningRun, sim: FakeSim) => void) => {
			const sim = new FakeSim();
			const changes: string[] = [];
			sim.shotChanged = (shot) => changes.push(`${sim.steps}:${shot ?? "cut"}`);
			drive(new OpeningRun("guided"), sim);
			return changes;
		};
		const skippedChanges = heard((run, sim) => run.skip(sim));
		expect(
			skippedChanges
				.filter((c) => !c.endsWith("cut"))
				.map((c) => c.split(":")[1]),
		).toEqual(["flypast", "cruise", "dock"]);
		// A fly-past framed from a later step would stand the camera somewhere
		// else: the change is heard on the same step however the run is driven.
		expect(heard((run, sim) => watch(run, sim, 5))).toEqual(skippedChanges);
		expect(
			heard((run, sim) => {
				run.advanceTo(sim, "flypast", 2.5);
				run.skip(sim);
			}),
		).toEqual(skippedChanges);
	});
});

describe("an opening a quit interrupted (the principal's ruling, 2026-09-26)", () => {
	test("a guided commander loaded in flight with no lastDocked flies the rest, skipped", () => {
		expect(
			openingOwedOnLoad({
				firstDay: "guided",
				docked: false,
				hasLastDocked: false,
			}),
		).toBe(true);
	});
	test("nothing else is owed one", () => {
		for (const over of [
			{ firstDay: "free" as const },
			{ docked: true },
			{ hasLastDocked: true },
		])
			expect(
				openingOwedOnLoad({
					firstDay: "guided",
					docked: false,
					hasLastDocked: false,
					...over,
				}),
			).toBe(false);
	});
});

describe("the cruise shot holds past the drop-out (the principal's second flight)", () => {
	// The station only reads in the leg's last seconds, and the shot cut on the
	// drop-out 2-3 s before it could be recognised.
	const facts: PilotFacts = {
		regime: "normal",
		spooling: false,
		dockPhase: "flying",
		computerEngaged: true,
		grantLive: true,
		cruiseEtaS: null,
		stationKm: 50,
		inVicinity: true,
		runIn: false,
	};
	test("the first seconds of the approach are still the cruise shot, then a cut", () => {
		const tail = Math.round(
			(OPENING.cruiseShot.tailS * OPENING.cruiseShot.ratio) / OPENING.dtS,
		);
		const approach = { ...startPilot("guided"), leg: "approach" as const };
		expect(openingShot({ ...approach, legSteps: 1 }, facts)).toBe("cruise");
		expect(openingShot({ ...approach, legSteps: tail }, facts)).toBe("cruise");
		expect(openingShot({ ...approach, legSteps: tail + 1 }, facts)).toBe(null);
	});
	test("a watched run shows the tail as part of the cruise shot", () => {
		const run = new OpeningRun("guided");
		watch(run, new FakeSim(), 4);
		expect(run.shownBy.cruise).toBeGreaterThan(
			OPENING.cruiseShot.simS / OPENING.cruiseShot.ratio +
				OPENING.cruiseShot.tailS -
				0.1,
		);
	});
});
