import { describe, expect, test } from "bun:test";
import { fieldRocks, systemFields } from "../src/asteroid-field";
import { generateGalaxy } from "../src/galaxy";
import {
	beginSurveyHold,
	ORE_FAMILIES,
	rockContents,
	stepSurveyHold,
	surveyCompleted,
	surveyFigures,
	surveyReading,
} from "../src/rock-survey";
import { generateContents } from "../src/system";

const systems = generateGalaxy(0x5eed, 0).systems;
const fields = systems.slice(0, 64).flatMap((record) =>
	systemFields(record, generateContents(record)).map((plan) => ({
		record,
		plan,
		rocks: fieldRocks(record, plan),
	})),
);

describe("rock contents (candidate)", () => {
	test("generated fields exist to sample", () => {
		expect(fields.length).toBeGreaterThan(0);
	});

	test("contents are a pure function of the seed", () => {
		const { record, plan, rocks } = fields[0];
		const a = rocks.map((r) =>
			rockContents(record.seed, plan.slot, plan.profile, r),
		);
		const b = rocks.map((r) =>
			rockContents(record.seed, plan.slot, plan.profile, r),
		);
		expect(a).toEqual(b);
	});

	test("reserves are positive whole tonnes and a deep deposit has a unit mouth", () => {
		for (const { record, plan, rocks } of fields)
			for (const rock of rocks) {
				const c = rockContents(record.seed, plan.slot, plan.profile, rock);
				expect(Number.isSafeInteger(c.surfaceT) && c.surfaceT > 0).toBe(true);
				expect(Number.isSafeInteger(c.deepT) && c.deepT >= 0).toBe(true);
				expect(c.deepDir === null).toBe(c.deepT === 0);
				if (c.deepDir) {
					const { x, y, z } = c.deepDir;
					expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-12);
				}
			}
	});

	test("every family occurs, and precious ore is commoner in rare fields", () => {
		const share = (profile: "charted" | "rare") => {
			const counts = Object.fromEntries(ORE_FAMILIES.map((f) => [f, 0]));
			let n = 0;
			for (const { record, plan, rocks } of fields)
				if (plan.profile === profile)
					for (const rock of rocks) {
						counts[
							rockContents(record.seed, plan.slot, profile, rock).family
						]++;
						n++;
					}
			return {
				n,
				precious: (counts.gold + counts.platinum + counts.gem) / n,
				counts,
			};
		};
		const charted = share("charted");
		const rare = share("rare");
		expect(charted.n).toBeGreaterThan(500);
		expect(rare.n).toBeGreaterThan(100);
		for (const f of ORE_FAMILIES)
			expect(charted.counts[f] + rare.counts[f]).toBeGreaterThan(0);
		expect(rare.precious).toBeGreaterThan(charted.precious);
	});
});

describe("survey figures", () => {
	test("range scales by size and dwell by grade", () => {
		expect(surveyFigures(1, "E")).toEqual({ rangeKm: 4, dwellS: 4 });
		expect(surveyFigures(3, "E").rangeKm).toBe(9);
		expect(surveyFigures(1, "A").dwellS).toBeCloseTo(4 / 1.5, 12);
		expect(surveyFigures(1, "D").dwellS).toBe(5);
	});
});

describe("survey hold", () => {
	const run = (
		frames: (string | null)[],
		interrupt: "reset" | "hold" | "decay",
	) => {
		let hold = beginSurveyHold();
		let completions = 0;
		for (const held of frames) {
			const next = stepSurveyHold(hold, held, 1, 4, interrupt);
			if (surveyCompleted(hold, next, 4)) completions++;
			hold = next;
		}
		return { hold, completions };
	};

	test("four unbroken seconds on one rock complete one survey", () => {
		expect(run(["a", "a", "a", "a", "a", "a"], "reset").completions).toBe(1);
	});

	test("changing rock starts over in every variant", () => {
		for (const v of ["reset", "hold", "decay"] as const)
			expect(run(["a", "a", "a", "b", "b", "b"], v)).toEqual({
				hold: { key: "b", chargeS: 3 },
				completions: 0,
			});
	});

	test("an interruption resets, holds or decays", () => {
		const frames = ["a", "a", "a", null, "a"];
		expect(run(frames, "reset")).toEqual({
			hold: { key: "a", chargeS: 1 },
			completions: 0,
		});
		expect(run(frames, "hold").completions).toBe(1);
		expect(run(frames, "decay")).toEqual({
			hold: { key: "a", chargeS: 3 },
			completions: 0,
		});
	});

	test("a completed hold does not complete again until it breaks", () => {
		expect(
			run(["a", "a", "a", "a", "a", "a", "a", "a", "a"], "hold").completions,
		).toBe(1);
		expect(
			run(["a", "a", "a", "a", null, "a", "a", "a", "a"], "hold").completions,
		).toBe(2);
	});
});

describe("survey reading", () => {
	const contents = {
		family: "metallic" as const,
		grade: "standard" as const,
		surfaceT: 20,
		deepT: 100,
		deepDir: { x: 0, y: 0, z: 1 },
	};

	test("no row or no survey reads nothing", () => {
		expect(surveyReading(contents, undefined, 0, 24)).toBeNull();
		expect(surveyReading(contents, { surface: 3, at: 0 }, 10, 24)).toBeNull();
	});

	test("a reading expires at its lifetime", () => {
		const row = { surveyedAt: 100 };
		expect(
			surveyReading(contents, row, 100 + 24 * 3600 - 1, 24),
		).not.toBeNull();
		expect(surveyReading(contents, row, 100 + 24 * 3600, 24)).toBeNull();
	});

	test("remaining reserve is the drawn reserve less the recovering debit", () => {
		const row = { surface: 5, deep: 30, at: 0, surveyedAt: 0 };
		const now = surveyReading(contents, row, 0, 24);
		expect(now?.surfaceLeftT).toBe(15);
		expect(now?.deepLeftT).toBe(70);
		const later = surveyReading(contents, row, 2 * 3600, 24);
		expect(later?.surfaceLeftT).toBe(17);
		expect(later?.deepLeftT).toBe(72);
	});
});

describe("rock target cycle (near variant)", () => {
	const { cycleWithRocks } =
		require("../src/rock-target") as typeof import("../src/rock-target");
	const rocks = ["rock:a:1", "rock:a:2"];
	const ordinary = ["station-trade", "planet-1"];

	test("from an ordinary target the key goes to the nearest rock", () => {
		expect(cycleWithRocks(rocks, ordinary, "station-trade", 1)).toBe(
			"rock:a:1",
		);
		expect(cycleWithRocks(rocks, ordinary, null, 1)).toBe("rock:a:1");
		expect(cycleWithRocks(rocks, ordinary, "station-trade", -1)).toBe(
			"rock:a:2",
		);
	});

	test("past the last rock the cycle continues into the ordinary list", () => {
		expect(cycleWithRocks(rocks, ordinary, "rock:a:1", 1)).toBe("rock:a:2");
		expect(cycleWithRocks(rocks, ordinary, "rock:a:2", 1)).toBe(
			"station-trade",
		);
	});

	test("a rock that left the near set restarts at the nearest", () => {
		expect(cycleWithRocks(rocks, ordinary, "rock:b:9", 1)).toBe("rock:a:1");
	});
});

describe("rock target (front variant)", () => {
	const { frontRock } =
		require("../src/rock-target") as typeof import("../src/rock-target");
	const at = (id: string, x: number, y: number, z: number, radiusKm: number) =>
		({
			id,
			pos: { x, y, z },
			vel: { x: 0, y: 0, z: 0 },
			distKm: Math.hypot(x, y, z) - radiusKm,
			rock: { radiusKm },
		}) as unknown as import("../src/rock-target").RockRef;
	const ship = { x: 0, y: 0, z: 0 };
	const ahead = { x: 0, y: 0, z: -1 };

	test("takes the nearest rock the sightline meets, not the one nearest the ship", () => {
		const big = at("big", 0, 0, -8, 1);
		const side = at("side", 1.2, 0, -1.5, 0.2);
		const behind = at("behind", 0, 0, -20, 3);
		expect(frontRock([side, big, behind], ship, ahead)?.id).toBe("big");
	});

	test("with nothing on the sightline, the rock whose edge is nearest it inside 5 degrees", () => {
		const off3 = at("off3", Math.tan((3 * Math.PI) / 180) * 5, 0, -5, 0.01);
		const off9 = at("off9", Math.tan((9 * Math.PI) / 180) * 2, 0, -2, 0.01);
		expect(frontRock([off9, off3], ship, ahead)?.id).toBe("off3");
		expect(frontRock([off9], ship, ahead)).toBeNull();
	});

	test("a rock behind the ship is not in front", () => {
		expect(frontRock([at("back", 0, 0, 5, 1)], ship, ahead)).toBeNull();
	});
});
