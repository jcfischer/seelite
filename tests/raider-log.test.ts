/**
 * The Communications log's raider lines (node #324 part d): destroyed, under
 * repair, back in service, derived from world state.
 */
import { describe, expect, test } from "bun:test";
import { formatRaiderLogLine, raiderLog } from "../src/raider-log";
import { raiderSlots } from "../src/raider-slots";
import {
	RAIDER_REPAIR_S,
	RAIDER_WRECK_S,
	raiderDestruction,
} from "../src/raider-wreck";
import {
	advanceTo,
	applyTransition,
	newWorld,
	type WorldState,
} from "../src/world-state";

const SYSTEM = 9;
const GOV = 0;
const SLOT = raiderSlots(SYSTEM, GOV)[1];
const KILL = 500;
const START = KILL + RAIDER_WRECK_S;
const DONE = START + RAIDER_REPAIR_S;

const killed = (): WorldState =>
	applyTransition(
		newWorld(0x5ee11e),
		0,
		SLOT.key,
		raiderDestruction(SYSTEM, KILL),
	);

const texts = (w: WorldState, t: number) =>
	raiderLog(w.galaxies[0], SYSTEM, GOV, t).map((l) => l.text);

describe("a printed log line", () => {
	test("is the game clock as mm:ss, two spaces, then the text", () => {
		const line = { at: 612.9, key: SLOT.key, text: "Raider 02 under repair" };
		expect(formatRaiderLogLine(line)).toBe("10:12  Raider 02 under repair");
	});

	test("does not wrap the minutes at the hour", () => {
		const line = { at: 3725, key: SLOT.key, text: "x" };
		expect(formatRaiderLogLine(line)).toBe("62:05  x");
	});
});

describe("the raider log", () => {
	test("a system with no kill has no lines", () => {
		expect(texts(newWorld(0x5ee11e), 10_000)).toEqual([]);
	});

	test("destroyed, then under repair, then back in service, newest first", () => {
		const w = killed();
		expect(texts(w, KILL)).toEqual(["Raider 02 destroyed"]);
		expect(texts(w, START - 1)).toEqual(["Raider 02 destroyed"]);
		expect(texts(w, START)).toEqual([
			"Raider 02 under repair",
			"Raider 02 destroyed",
		]);
		expect(texts(w, DONE)).toEqual([
			"Raider 02 back in service",
			"Raider 02 under repair",
			"Raider 02 destroyed",
		]);
	});

	test("the lines carry the lifecycle's own times", () => {
		const lines = raiderLog(killed().galaxies[0], SYSTEM, GOV, DONE);
		expect(lines.map((l) => l.at)).toEqual([DONE, START, KILL]);
	});

	test("materializing the lazy steps does not change the lines", () => {
		for (const t of [KILL, START + 1, DONE + 50]) {
			const raw = raiderLog(killed().galaxies[0], SYSTEM, GOV, t);
			const settled = raiderLog(
				advanceTo(killed(), t).galaxies[0],
				SYSTEM,
				GOV,
				t,
			);
			expect(settled).toEqual(raw);
		}
	});

	test("another system's kill is not this system's news", () => {
		expect(
			raiderLog(killed().galaxies[0], SYSTEM + 1, GOV, DONE).map((l) => l.text),
		).toEqual([]);
	});

	test("a raider disabled rather than destroyed writes no lifecycle", () => {
		const w = applyTransition(newWorld(0x5ee11e), 0, SLOT.key, {
			kind: "disable",
			occurredAt: KILL,
			cause: { causeKind: "probe", actorId: "probe", playerRole: "direct" },
		});
		expect(texts(w, DONE)).toEqual([]);
	});
});
