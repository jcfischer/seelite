/**
 * The pirate relay's repair tender (#351): the recovery a pilot can meet.
 *
 * The principal's ruling on #351: during the repairing window a pirate tender
 * flies in from far out and parks at the wreck; destroying it restarts the
 * repair with a new wreck timer. It is a carrier slot of its own
 * (`relay-00/tender`), so its kill saves like any other.
 */
import { describe, expect, test } from "bun:test";
import { HULL_SPECS } from "../src/hull";
import {
	RELAY_REPAIR_S,
	RELAY_WRECK_S,
	relayDestruction,
} from "../src/pirate-relay";
import {
	RELAY_TENDER_ENTRY_KM,
	RELAY_TENDER_HIT_RADIUS_KM,
	RELAY_TENDER_INBOUND_S,
	RELAY_TENDER_INTEGRITY,
	RELAY_TENDER_PARK_KM,
	relaySetBack,
	tenderArrival,
	tenderDestruction,
	tenderEntry,
	tenderLog,
	tenderOffset,
	tenderPresentSince,
} from "../src/relay-tender";
import { relaySlot, relayTenderSlot } from "../src/relay-slot";
import { dot, length, scale, sub } from "../src/vec3";
import {
	applyTransition,
	effectiveCarrier,
	newWorld,
	type WorldState,
} from "../src/world-state";

const SYSTEM = 3;
const RELAY = relaySlot(SYSTEM).key;
const TENDER = relayTenderSlot(SYSTEM).key;
const KILL = 100;
const REPAIR_FROM = KILL + RELAY_WRECK_S;

const killedRelay = (): WorldState =>
	applyTransition(
		newWorld(1),
		0,
		RELAY,
		relayDestruction(SYSTEM, KILL, "station-trade"),
	);

const present = (w: WorldState, t: number) =>
	tenderPresentSince(
		effectiveCarrier(w.galaxies[0], RELAY, t),
		effectiveCarrier(w.galaxies[0], TENDER, t),
		t,
	);

describe("when the tender is there", () => {
	test("not while the relay is operational, nor while it is a fresh wreck", () => {
		const w = killedRelay();
		expect(present(newWorld(1), 50)).toBeNull();
		expect(present(w, KILL + 1)).toBeNull();
		expect(present(w, REPAIR_FROM - 1)).toBeNull();
	});

	test("from the start of the repair until the replacement, arriving at the start", () => {
		const w = killedRelay();
		expect(present(w, REPAIR_FROM)).toBe(REPAIR_FROM);
		expect(present(w, REPAIR_FROM + RELAY_REPAIR_S - 1)).toBe(REPAIR_FROM);
		expect(present(w, REPAIR_FROM + RELAY_REPAIR_S)).toBeNull();
	});

	test("its arrival is the repair's completion less one repair period", () => {
		// The invariant the set-back keeps: a set-back moves the completion out
		// by a wreck and a repair, so the next tender arrives one wreck later.
		expect(tenderArrival({ completesAt: REPAIR_FROM + RELAY_REPAIR_S })).toBe(
			REPAIR_FROM,
		);
	});
});

describe("its flight", () => {
	const entry = tenderEntry(12345);

	test("comes in from far out along its system's own direction", () => {
		expect(length(entry)).toBeCloseTo(1, 12);
		expect(tenderEntry(12345)).toEqual(entry);
		expect(tenderEntry(54321)).not.toEqual(entry);
		const start = tenderOffset(entry, 0);
		expect(length(start.offset)).toBeCloseTo(RELAY_TENDER_ENTRY_KM, 6);
	});

	test("parks beside the wreck and stays there", () => {
		for (const since of [
			RELAY_TENDER_INBOUND_S,
			RELAY_TENDER_INBOUND_S + 900,
		]) {
			const { offset, vel } = tenderOffset(entry, since);
			expect(length(offset)).toBeCloseTo(RELAY_TENDER_PARK_KM, 9);
			expect(length(vel)).toBe(0);
		}
	});

	test("closes monotonically, and its velocity is the offset's derivative", () => {
		let last = Number.POSITIVE_INFINITY;
		const h = 1e-3;
		for (let s = 0; s < RELAY_TENDER_INBOUND_S; s += 7) {
			const { offset, vel } = tenderOffset(entry, s);
			const km = length(offset);
			expect(km).toBeLessThanOrEqual(last);
			last = km;
			const ahead = tenderOffset(entry, s + h).offset;
			const numeric = scale(sub(ahead, offset), 1 / h);
			expect(length(sub(numeric, vel))).toBeLessThan(1e-3 * (1 + length(vel)));
			// Straight in: the velocity points back along the entry direction.
			if (length(vel) > 0) expect(dot(vel, entry)).toBeLessThan(0);
		}
	});
});

describe("the interruption", () => {
	test("a tender kill sets the relay's repair back by a wreck and a repair, in the same episode", () => {
		const t = REPAIR_FROM + 600;
		let w = killedRelay();
		const before = effectiveCarrier(w.galaxies[0], RELAY, t);
		w = applyTransition(w, 0, TENDER, tenderDestruction(SYSTEM, t));
		w = applyTransition(
			w,
			0,
			RELAY,
			relaySetBack(t, `route:${SYSTEM}:station-trade`),
		);
		const after = effectiveCarrier(w.galaxies[0], RELAY, t + 1);
		expect(after.condition).toBe("repairing");
		expect(after.recovery?.processId).toBe(before.recovery?.processId);
		expect(after.recovery?.completesAt).toBe(
			t + RELAY_WRECK_S + RELAY_REPAIR_S,
		);
		// No tender for one wreck period, then the next one flies in.
		expect(present(w, t + 1)).toBeNull();
		expect(present(w, t + RELAY_WRECK_S - 1)).toBeNull();
		expect(present(w, t + RELAY_WRECK_S)).toBe(t + RELAY_WRECK_S);
		// And the relay comes back a full repair after that tender arrives.
		expect(
			effectiveCarrier(w.galaxies[0], RELAY, t + RELAY_WRECK_S + RELAY_REPAIR_S)
				.condition,
		).toBe("operational");
	});

	test("the tender is a tug, and its hit sphere holds the hull", () => {
		expect(RELAY_TENDER_INTEGRITY).toBe(HULL_SPECS.tug.integrity);
		const { lengthKm, beamKm, heightKm } = HULL_SPECS.tug.env;
		expect(RELAY_TENDER_HIT_RADIUS_KM).toBeCloseTo(
			Math.hypot(lengthKm, beamKm, heightKm) / 2,
			12,
		);
	});
});

describe("the log", () => {
	test("names the tender's arrival and its kill on the clock", () => {
		const t = REPAIR_FROM + 600;
		let w = killedRelay();
		expect(tenderLog(w.galaxies[0], SYSTEM, REPAIR_FROM - 1)).toEqual([]);
		expect(
			tenderLog(w.galaxies[0], SYSTEM, REPAIR_FROM).map((l) => l.text),
		).toEqual(["Relay tender inbound"]);
		w = applyTransition(w, 0, TENDER, tenderDestruction(SYSTEM, t));
		w = applyTransition(
			w,
			0,
			RELAY,
			relaySetBack(t, `route:${SYSTEM}:station-trade`),
		);
		const lines = tenderLog(w.galaxies[0], SYSTEM, t + RELAY_WRECK_S);
		expect(lines.map((l) => [l.at, l.text])).toEqual([
			[t + RELAY_WRECK_S, "Relay tender inbound"],
			[t, "Relay tender destroyed · relay repair set back"],
		]);
	});
});
