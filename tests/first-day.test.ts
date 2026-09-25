/**
 * #408: which step of the first useful day the pilot is on, derived from state.
 *
 * One ordered function. Its rows overlap on purpose — after a report the pilot
 * is docked with nothing running, which is also "take work" — so precedence is
 * the thing under test, and every row plus the in-flight hole has its own case.
 */

import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	FIRST_DAY_STEPS,
	firstDayConsoleLine,
	type FirstDayFacts,
	type FirstDayKeys,
	firstDayLogsStep,
	firstDayPrompt,
	firstDayStep,
	firstDayText,
} from "../src/first-day";

const HOME = carrierKey(3, "station-trade");
const THERE = carrierKey(3, "station-refinery");

const running = {
	reportAt: THERE,
	reportName: "ERMA REFINERY",
	reportSystemName: "ERMA",
	sameSystem: true,
};

const facts = (over: Partial<FirstDayFacts> = {}): FirstDayFacts => ({
	docked: false,
	dockedAt: null,
	running: null,
	settledAny: false,
	localRunOnBoard: false,
	// A new ship has none (#408, the principal's ruling): it is bought.
	computerFitted: false,
	...over,
});

const KEYS: FirstDayKeys = {
	starboard: "3",
	clearance: "c",
	computer: "u",
	cruise: "j",
	navigation: "1",
	forward: "2",
	face: "f",
};

describe("#408 — the first day's step", () => {
	test("docked with nothing running is take work", () => {
		expect(firstDayStep(facts({ docked: true, dockedAt: HOME }))).toBe(
			"take-work",
		);
	});

	test("docked with a job, away from its delivery station, is launch", () => {
		expect(firstDayStep(facts({ docked: true, dockedAt: HOME, running }))).toBe(
			"launch",
		);
	});

	test("anywhere but a berth with a job is fly", () => {
		expect(firstDayStep(facts({ running }))).toBe("fly");
	});

	test("docked where the job reports is report", () => {
		expect(
			firstDayStep(facts({ docked: true, dockedAt: THERE, running })),
		).toBe("report");
	});

	test("in flight with nothing running is find a station — the hole", () => {
		expect(firstDayStep(facts())).toBe("find-station");
	});

	test("a reported job ends the day, and outranks every other row", () => {
		for (const over of [
			{ docked: true, dockedAt: HOME },
			{ docked: true, dockedAt: HOME, running },
			{ running },
			{},
		])
			expect(firstDayStep(facts({ ...over, settledAny: true }))).toBe("trade");
	});

	test("every step is in the list the tab walks", () => {
		for (const f of [
			facts({ docked: true, dockedAt: HOME }),
			facts({ docked: true, dockedAt: HOME, running }),
			facts({ running }),
			facts({ docked: true, dockedAt: THERE, running }),
			facts(),
			facts({ settledAny: true }),
		])
			expect(FIRST_DAY_STEPS.map((s) => s.id)).toContain(firstDayStep(f));
	});
});

describe("#408 — what the pilot is told", () => {
	test("launch sends the pilot to the right console's button, not to a key", () => {
		// Playtest, 2026-09-25: Enter on the docked console acts on the focused
		// Requests control — it tracked the job instead of launching.
		const home = carrierKey(3, "station-trade");
		const text = firstDayText(
			facts({ docked: true, dockedAt: home, running }),
			KEYS,
		);
		expect(text).toContain("Press 3");
		expect(text).toContain("right console");
		expect(text).toContain("LAUNCH");
		expect(text).not.toContain("enter");
	});

	test("take work names the Local run only when the board has one", () => {
		const docked = { docked: true, dockedAt: HOME };
		expect(
			firstDayText(facts({ ...docked, localRunOnBoard: true }), KEYS),
		).toContain("Local run");
		expect(
			firstDayText(facts({ ...docked, localRunOnBoard: false }), KEYS),
		).not.toContain("Local run");
	});

	test("fly names the delivery station and the keys, as bound", () => {
		const text = firstDayText(facts({ running, computerFitted: true }), KEYS);
		expect(text).toContain("ERMA REFINERY");
		for (const phrase of [
			"Navigation console (1)",
			"press 2 to face forward, f to turn toward it and j to cruise",
			"clearance with c",
			"dock with u",
		])
			expect(text).toContain(phrase);
		const rebound = firstDayText(facts({ running }), { ...KEYS, cruise: "k" });
		expect(rebound).toContain("k to cruise");
	});

	test("without a docking computer the pilot is told to fly in, not to press u", () => {
		for (const f of [facts({ running }), facts()]) {
			const text = firstDayText(f, KEYS);
			expect(text).not.toContain("with u");
			expect(text).toContain("slowly");
		}
	});

	test("a delivery one jump out says which system", () => {
		const away = { ...running, sameSystem: false };
		expect(firstDayText(facts({ running: away }), KEYS)).toContain("ERMA");
	});
});

describe("#408 — the flight prompt", () => {
	const flying = (over: Partial<FirstDayFacts> = {}) =>
		facts({ running, ...over });

	test("is silent unless the pilot is flying the day's job or looking for a station", () => {
		expect(
			firstDayPrompt(facts({ docked: true, dockedAt: HOME }), null, KEYS),
		).toBe("");
		expect(firstDayPrompt(facts({ settledAny: true }), null, KEYS)).toBe("");
	});

	test("asks for the delivery station while another target is selected", () => {
		expect(
			firstDayPrompt(
				flying(),
				{
					key: HOME,
					name: "ERMA STATION",
					inVicinity: false,
					grantLive: false,
					computerEngaged: false,
				},
				KEYS,
			),
		).toContain("ERMA REFINERY");
		expect(firstDayPrompt(flying(), null, KEYS)).toContain("ERMA REFINERY");
	});

	test("a far delivery station: turn toward it, then cruise (playtest)", () => {
		expect(
			firstDayPrompt(
				flying(),
				{
					key: THERE,
					name: "ERMA REFINERY",
					inVicinity: false,
					grantLive: false,
					computerEngaged: false,
				},
				KEYS,
			),
		).toBe("press f to face ERMA REFINERY, then j to cruise");
	});

	test("near the station: clearance, then the docking computer, then nothing", () => {
		const near = {
			key: THERE,
			name: "ERMA REFINERY",
			inVicinity: true,
			computerEngaged: false,
		};
		expect(firstDayPrompt(flying(), { ...near, grantLive: false }, KEYS)).toBe(
			"press c for clearance",
		);
		expect(
			firstDayPrompt(
				flying({ computerFitted: true }),
				{ ...near, grantLive: true },
				KEYS,
			),
		).toBe("press u to dock");
		expect(
			firstDayPrompt(
				flying(),
				{ ...near, grantLive: true, computerEngaged: true },
				KEYS,
			),
		).toBe("");
	});

	test("cleared without a docking computer: fly in slowly, until the ship is in", () => {
		const near = {
			key: THERE,
			name: "ERMA REFINERY",
			inVicinity: true,
			computerEngaged: false,
		};
		const line = firstDayPrompt(flying(), { ...near, grantLive: true }, KEYS);
		expect(line).toContain("slowly");
		expect(line).not.toContain(" u ");
	});

	test("finding a station works on whatever station is selected", () => {
		const near = {
			key: HOME,
			name: "ERMA STATION",
			inVicinity: true,
			computerEngaged: false,
		};
		expect(firstDayPrompt(facts(), { ...near, grantLive: false }, KEYS)).toBe(
			"press c for clearance",
		);
		expect(firstDayPrompt(facts(), null, KEYS)).toBe("");
	});

	test("a delivery one jump out asks for a course, not a target", () => {
		const away = { ...running, sameSystem: false };
		expect(firstDayPrompt(facts({ running: away }), null, KEYS)).toContain(
			"Galaxy Map",
		);
	});
});

describe("#408 — when station control's line is logged", () => {
	test("a step change is logged", () => {
		expect(firstDayLogsStep(null, "take-work")).toBe(true);
		expect(firstDayLogsStep("take-work", "launch")).toBe(true);
		expect(firstDayLogsStep("report", "trade")).toBe(true);
	});

	test("no change, no line", () => {
		expect(firstDayLogsStep("launch", "launch")).toBe(false);
		expect(firstDayLogsStep("trade", "trade")).toBe(false);
	});

	test("a session that opens on a finished day logs nothing", () => {
		// A finished guided commander reloads: nothing happened this session, so
		// the closing line is not said again — every session, forever.
		expect(firstDayLogsStep(null, "trade")).toBe(false);
	});
});

describe("#408 — station control on the port console", () => {
	const selected = (key: typeof HOME, name: string) => ({
		key,
		name,
		inVicinity: false,
		grantLive: false,
		computerEngaged: false,
	});

	test("asks for the delivery station until it is selected", () => {
		expect(firstDayConsoleLine(facts({ running }), null, KEYS)).toBe(
			"Select ERMA REFINERY on the Navigation list.",
		);
		expect(
			firstDayConsoleLine(
				facts({ running }),
				selected(HOME, "ERMA STATION"),
				KEYS,
			),
		).toBe("Select ERMA REFINERY on the Navigation list.");
	});

	test("once it is selected: face forward, turn toward it, cruise (playtest)", () => {
		expect(
			firstDayConsoleLine(
				facts({ running }),
				selected(THERE, "ERMA REFINERY"),
				KEYS,
			),
		).toBe(
			"ERMA REFINERY is selected. Press 2 to face forward, f to turn toward it, then j to cruise.",
		);
	});

	test("finding a station works on whatever station is selected", () => {
		expect(firstDayConsoleLine(facts(), null, KEYS)).toBe(
			"Select a station on the Navigation list.",
		);
		expect(
			firstDayConsoleLine(facts(), selected(HOME, "ERMA STATION"), KEYS),
		).toContain("ERMA STATION is selected. Press 2");
	});

	test("says nothing docked or after the day", () => {
		expect(
			firstDayConsoleLine(facts({ docked: true, dockedAt: HOME }), null, KEYS),
		).toBeNull();
		expect(
			firstDayConsoleLine(facts({ settledAny: true }), null, KEYS),
		).toBeNull();
	});
});
