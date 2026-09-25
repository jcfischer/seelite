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
	type FirstDayFacts,
	type FirstDayKeys,
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
	...over,
});

const KEYS: FirstDayKeys = {
	launch: "enter",
	clearance: "c",
	computer: "u",
	cruise: "j",
	target: "t",
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
		const text = firstDayText(facts({ running }), KEYS);
		expect(text).toContain("ERMA REFINERY");
		for (const key of ["t", "j", "c", "u"]) expect(text).toContain(key);
		const rebound = firstDayText(facts({ running }), { ...KEYS, cruise: "k" });
		expect(rebound).toContain("k");
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
					inVicinity: false,
					grantLive: false,
					computerEngaged: false,
				},
				KEYS,
			),
		).toContain("ERMA REFINERY");
		expect(firstDayPrompt(flying(), null, KEYS)).toContain("ERMA REFINERY");
	});

	test("leaves a far delivery station to the cruise prompt", () => {
		expect(
			firstDayPrompt(
				flying(),
				{
					key: THERE,
					inVicinity: false,
					grantLive: false,
					computerEngaged: false,
				},
				KEYS,
			),
		).toBe("");
	});

	test("near the station: clearance, then the docking computer, then nothing", () => {
		const near = { key: THERE, inVicinity: true, computerEngaged: false };
		expect(
			firstDayPrompt(flying(), { ...near, grantLive: false }, KEYS),
		).toContain("c");
		expect(
			firstDayPrompt(flying(), { ...near, grantLive: true }, KEYS),
		).toContain("u");
		expect(
			firstDayPrompt(
				flying(),
				{ ...near, grantLive: true, computerEngaged: true },
				KEYS,
			),
		).toBe("");
	});

	test("finding a station works on whatever station is selected", () => {
		const near = { key: HOME, inVicinity: true, computerEngaged: false };
		expect(
			firstDayPrompt(facts(), { ...near, grantLive: false }, KEYS),
		).toContain("c");
		expect(firstDayPrompt(facts(), null, KEYS)).toBe("");
	});

	test("a delivery one jump out asks for a course, not a target", () => {
		const away = { ...running, sameSystem: false };
		expect(firstDayPrompt(facts({ running: away }), null, KEYS)).toContain(
			"Galaxy Map",
		);
	});
});
