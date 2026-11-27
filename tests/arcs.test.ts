import { describe, expect, test } from "bun:test";
import {
	ARC_MAX_STEPS,
	ARC_MIN_STEPS,
	type Arc,
	type ArcWorld,
	HEALING_HOME,
	nextStep,
	openArc,
	recordStep,
	refuseStep,
} from "../src/arcs";
import { carrierKey, systemIndexOfKey } from "../src/carrier-key";
import { recordTrade } from "../src/deficits";
import { distanceLy, generateGalaxy } from "../src/galaxy";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { canPostJobs } from "../src/jobs";
import { bountyTargetOf } from "../src/pirate-relay";
import { generateContents } from "../src/system";
import { newWorld } from "../src/world-state";

const SEED = 0x5ee11e;
const GALAXY = generateGalaxy(SEED, 0);
const ENV = newWorld(SEED).galaxies[0];
const MAX_JUMP = HULL_SPECS[PLAYER_BASELINE_HULL].tankLy;

const worldWith = (
	deficits: ArcWorld["deficits"],
	maxJump = MAX_JUMP,
): ArcWorld => ({
	galaxyIndex: 0,
	systems: GALAXY.systems,
	contentsOf: generateContents,
	deficits,
	gameTimeMin: 0,
	maxJump,
	holdT: HULL_SPECS[PLAYER_BASELINE_HULL].holdT,
	bountyTargetOf: (r) => bountyTargetOf(r, generateContents(r), ENV, 0),
});

const shortageAt = (index: number) => {
	const record = GALAXY.systems[index];
	const station = generateContents(record).stations.find(canPostJobs)!;
	const key = carrierKey(record.index, station.localCarrierId);
	const deficits = recordTrade({}, key, {
		goodName: "Food",
		units: 12,
		gameTimeMin: 0,
		holdT: 20,
	});
	return { record, station, key, deficits };
};

const opened = () => {
	for (let i = 0; i < GALAXY.systems.length; i++) {
		const s = shortageAt(i);
		const r = openArc(worldWith(s.deficits), s.record, s.station);
		if (r.ok) return { ...s, arc: r.arc };
	}
	throw new Error("no arc opened");
};

const play = (arc: Arc, world: ArcWorld) => {
	const offers = [];
	for (let i = 0; i < 8; i++) {
		const n = nextStep(arc, world);
		if (n.kind !== "step") return { arc, final: n, offers };
		offers.push(n.offer);
		arc = recordStep(arc, n);
	}
	throw new Error("did not terminate");
};

describe("openArc", () => {
	test("opens with a question, its requester and a 10 Cr answer bonus", () => {
		const { arc, key } = opened();
		expect(arc.question.length).toBeGreaterThan(0);
		expect(arc.requester.carrierKey).toBe(key);
		expect(arc.answerPayoutCr).toBeGreaterThan(0);
		expect(arc.answerPayoutCr % 10).toBe(0);
		expect(arc.foreseen.length).toBeGreaterThanOrEqual(ARC_MIN_STEPS);
		expect(arc.foreseen.length).toBeLessThanOrEqual(ARC_MAX_STEPS);
	});

	test("refuses with a reason where there is no question", () => {
		const record = GALAXY.systems.find((s) => s.government >= 4)!;
		const station = generateContents(record).stations.find(canPostJobs)!;
		const r = openArc(worldWith({}), record, station);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
	});

	test("refuses when the reach is too short for any route", () => {
		const s = shortageAt(0);
		const r = openArc(worldWith(s.deficits, 0.01), s.record, s.station);
		expect(r.ok).toBe(false);
	});

	test("is deterministic", () => {
		const a = opened();
		const s = shortageAt(a.record.index);
		const again = openArc(worldWith(s.deficits), s.record, s.station);
		expect(again.ok && again.arc).toEqual(a.arc);
	});
});

describe("nextStep", () => {
	test("a procurement step at another station does not answer the shortage", () => {
		const { arc, deficits } = opened();
		const world = worldWith(deficits);
		const first = nextStep(arc, world);
		if (first.kind !== "step") throw new Error("no first step");
		const one = recordStep(arc, first);
		const other = {
			...one.taken[0],
			family: arc.answerFamily,
			requester: { ...arc.requester, carrierKey: carrierKey(999999, "x") },
		};
		const n = nextStep({ ...one, taken: [other] }, world);
		expect(n.kind).not.toBe("answer");
	});

	test("plays out to the answer over 3-6 steps, 2+ families and 2+ systems, every hop in reach", () => {
		const { arc, deficits } = opened();
		const world = worldWith(deficits);
		const { arc: done, final, offers } = play(arc, world);
		expect(final.kind).toBe("answer");
		expect(done.taken.length).toBeGreaterThanOrEqual(ARC_MIN_STEPS);
		expect(done.taken.length).toBeLessThanOrEqual(ARC_MAX_STEPS);
		expect(
			new Set(done.taken.map((s) => s.family)).size,
		).toBeGreaterThanOrEqual(2);
		const sys = systemIndexOfKey;
		const systems = new Set(
			done.taken.flatMap((s) => [
				sys(s.requester.carrierKey),
				sys(s.reportAt.carrierKey),
			]),
		);
		expect(systems.size).toBeGreaterThanOrEqual(2);
		let at = sys(arc.requester.carrierKey);
		for (const o of offers) {
			const to = sys(o.requester.carrierKey);
			expect(
				distanceLy(GALAXY.systems[at].pos, GALAXY.systems[to].pos),
			).toBeLessThanOrEqual(MAX_JUMP);
			at = sys(o.reportAt.carrierKey);
		}
	});

	test("never names a step that cannot bind, after the world drifts", () => {
		const { arc, deficits } = opened();
		const n = nextStep(arc, worldWith(deficits));
		expect(n.kind).toBe("step");
		const drifted = nextStep(arc, worldWith({}));
		if (drifted.kind === "step") {
			expect(drifted.rerouted).toBe(true);
			expect(refuseStep(drifted.offer)).toBeNull();
		} else {
			expect(drifted.kind).toBe("none");
			if (drifted.kind === "none")
				expect(drifted.reason.length).toBeGreaterThan(0);
		}
	});

	test("a bounty in a neighbouring system does not answer a raiders arc", () => {
		const { arc, deficits } = opened();
		const raiders = {
			...arc,
			kind: "raiders-on-route" as const,
			answerFamily: "bounty" as const,
		};
		const elsewhere = {
			...arc.requester,
			carrierKey: carrierKey(
				(systemIndexOfKey(arc.requester.carrierKey) + 1) % 50,
				"x",
			),
		};
		const bounty = {
			offerId: "b",
			family: "bounty" as const,
			requester: elsewhere,
			reportAt: elsewhere,
			payCr: 0,
			distanceLy: 0,
		};
		expect(
			nextStep({ ...raiders, taken: [bounty] }, worldWith(deficits)).kind,
		).not.toBe("answer");
		const home = { ...bounty, requester: arc.requester };
		expect(
			nextStep({ ...raiders, taken: [home] }, worldWith(deficits)).kind,
		).toBe("answer");
	});

	test("answers no route once the budget is spent", () => {
		const { arc, deficits } = opened();
		const spent = {
			...arc,
			taken: Array.from({ length: ARC_MAX_STEPS }, () => ({
				...arc.taken[0],
				offerId: "x",
				family: "courier" as const,
				requester: arc.requester,
				reportAt: arc.requester,
				payCr: 0,
				distanceLy: 0,
			})),
		};
		expect(nextStep(spent, worldWith(deficits)).kind).toBe("none");
	});
});

describe("D6", () => {
	test("refuses a row whose effect has no healing home", () => {
		expect(HEALING_HOME.salvage).toBe(false);
		expect(refuseStep({ family: "salvage" })).not.toBeNull();
		expect(refuseStep({ family: "courier" })).toBeNull();
	});
});
