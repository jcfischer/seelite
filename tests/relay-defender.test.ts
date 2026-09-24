/**
 * The relay's defender (#515, ruled in #511): the first hit on the pirate relay
 * or its repair tender calls a seeded raider slot, which drops in beside the
 * pilot three to five seconds later, inside beam range and moving with the
 * frame the fight is flown in.
 */
import { describe, expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import { PLAYER_LASER_RANGE_KM } from "../src/combat-enemy";
import { RAIDER_OUT_OF_BEAM_KM } from "../src/duel";
import {
	type Encounter,
	type EncounterFrame,
	defenderEncounter,
	stepEncounter,
} from "../src/encounter";
import { raiderSlotCount, raiderSlots } from "../src/raider-slots";
import {
	DEFENDER_DELAY_S,
	DEFENDER_RANGE_KM,
	type DefenderWatches,
	answerHit,
	defenderDraw,
	tenderVisitInstance,
} from "../src/relay-defender";
import { relaySlot, relayTenderSlot } from "../src/relay-slot";
import { fullCondition } from "../src/ship-condition";
import { ASSIST_CAP_KMS } from "../src/sim";
import { type Vec3, add, length, scale, sub, v3 } from "../src/vec3";

const DT = 1 / 60;
const SYSTEM = 7;
const RECORD = { seed: 0x5ee11e, government: 0 };
const RELAY = relaySlot(SYSTEM).key;
const TENDER = relayTenderSlot(SYSTEM).key;
const ALL_UP = () => true;

/** A defender with every slot up, which cannot be null. */
function called(
	target: CarrierKey = RELAY,
	instance = 0,
	ordinal = 0,
	calledAtS = 100,
): Encounter {
	const e = defenderEncounter(
		ALL_UP,
		SYSTEM,
		RECORD,
		target,
		instance,
		ordinal,
		calledAtS,
	);
	if (!e) throw new Error("every slot is up, so a defender must come");
	return e;
}

/** A pilot beside a station, at rest in its frame, which moves at 30 km/s. */
const FRAME_VEL = v3(30, 0, 0);

function frame(
	t: number,
	pos: Vec3,
	opts: { inCruise?: boolean; frameVel?: Vec3; driftKms?: Vec3 } = {},
): EncounterFrame {
	const frameVel = opts.frameVel ?? FRAME_VEL;
	const ship = { pos, vel: add(frameVel, opts.driftKms ?? v3()) };
	return {
		gameTime: t,
		dt: DT,
		inCruise: opts.inCruise ?? false,
		pilot: {
			ship,
			nose: v3(0, 0, -1),
			aimOrigin: pos,
			aimNose: v3(0, 0, -1),
			hull: fullCondition("courier").hull,
			frameVel,
		},
		shot: { fired: false, damage: 0 },
	};
}

describe("the defender's draw", () => {
	test("is a function of the system, the target instance and the call ordinal", () => {
		const a = defenderDraw(RECORD.seed, RECORD.government, RELAY, 0, 0);
		expect(defenderDraw(RECORD.seed, RECORD.government, RELAY, 0, 0)).toEqual(
			a,
		);
		// A second call is a new draw, and so is a new instance or the tender.
		const others = [
			defenderDraw(RECORD.seed, RECORD.government, RELAY, 0, 1),
			defenderDraw(RECORD.seed, RECORD.government, RELAY, 1, 0),
			defenderDraw(RECORD.seed, RECORD.government, TENDER, 0, 0),
			defenderDraw(RECORD.seed + 1, RECORD.government, RELAY, 0, 0),
		];
		for (const other of others) expect(other).not.toEqual(a);
	});

	test("arrives in three to five seconds, inside the beam's reach", () => {
		for (let ordinal = 0; ordinal < 500; ordinal++) {
			const d = defenderDraw(RECORD.seed, 3, RELAY, 0, ordinal);
			expect(d.delayS).toBeGreaterThanOrEqual(DEFENDER_DELAY_S[0]);
			expect(d.delayS).toBeLessThanOrEqual(DEFENDER_DELAY_S[1]);
			expect(d.rangeKm).toBeGreaterThanOrEqual(DEFENDER_RANGE_KM[0]);
			expect(d.rangeKm).toBeLessThanOrEqual(DEFENDER_RANGE_KM[1]);
		}
		expect(DEFENDER_DELAY_S).toEqual([3, 5]);
		expect(DEFENDER_RANGE_KM[1]).toBeLessThan(PLAYER_LASER_RANGE_KM);
	});

	test("draws over every one of the system's raider slots", () => {
		for (const government of [0, 3, 7]) {
			const seen = new Set<number>();
			for (let ordinal = 0; ordinal < 400; ordinal++)
				seen.add(
					defenderDraw(RECORD.seed, government, RELAY, 0, ordinal).slotIndex,
				);
			expect([...seen].sort()).toEqual(
				Array.from({ length: raiderSlotCount(government) }, (_, i) => i),
			);
		}
	});
});

describe("who answers", () => {
	test("the drawn slot, and nothing when that slot is destroyed or repairing", () => {
		const drawn = defenderDraw(RECORD.seed, RECORD.government, RELAY, 0, 0);
		const slots = raiderSlots(SYSTEM, RECORD.government);
		const e = called();
		expect(e.slot.key).toBe(slots[drawn.slotIndex].key);
		// The drawn slot down and every other up: the draw is not moved to
		// another slot, as `scheduleEncounter` does not move a leg's.
		const downOnly = (key: CarrierKey) => key !== slots[drawn.slotIndex].key;
		expect(
			defenderEncounter(downOnly, SYSTEM, RECORD, RELAY, 0, 0, 100),
		).toBeNull();
	});

	test("comes the delay after the call", () => {
		const drawn = defenderDraw(RECORD.seed, RECORD.government, RELAY, 0, 0);
		expect(called(RELAY, 0, 0, 100).appearsAtS).toBeCloseTo(
			100 + drawn.delayS,
			9,
		);
	});
});

describe("the call count", () => {
	/** Answer a hit: a defender when every slot is up, `null` when `up` is false. */
	const hit = (
		watches: DefenderWatches,
		target: CarrierKey,
		instance: number,
		active: boolean,
		up = true,
	) =>
		answerHit(watches, { target, instance }, active, (ordinal) =>
			up ? called(target, instance, ordinal) : null,
		);

	test("the first hit calls, and a hit during the fight calls nothing", () => {
		const first = hit({}, RELAY, 0, false);
		expect(first.encounter).not.toBeNull();
		const second = hit(first.watches, RELAY, 0, true);
		expect(second.encounter).toBeNull();
		expect(second.watches).toEqual(first.watches);
	});

	test("after the defender's encounter ends the next hit is a new draw", () => {
		const first = hit({}, RELAY, 0, false);
		const next = hit(first.watches, RELAY, 0, false);
		expect(next.encounter).not.toBeNull();
		expect(next.encounter).toEqual(called(RELAY, 0, 1));
		expect(next.encounter).not.toEqual(first.encounter);
	});

	test("no call while any encounter is active, and the attack is still owed one", () => {
		// A leg raider already in a duel is the relay's company.
		const during = hit({}, RELAY, 0, true);
		expect(during.encounter).toBeNull();
		const after = hit(during.watches, RELAY, 0, false);
		expect(after.encounter).toEqual(called(RELAY, 0, 0));
	});

	test("a call that sends nothing answers the attack: later hits call nothing", () => {
		const first = hit({}, RELAY, 0, false, false);
		expect(first.encounter).toBeNull();
		// Every slot up again on the next hit: a re-draw would find one, so a
		// row passing here is the rule and not the dice.
		for (let i = 0; i < 10; i++) {
			const again = hit(first.watches, RELAY, 0, false, true);
			expect(again.encounter).toBeNull();
		}
	});

	test("a new instance of the target is a new attack", () => {
		const spent = hit({}, RELAY, 0, false, false).watches;
		const replacement = hit(spent, RELAY, 1, false);
		expect(replacement.encounter).toEqual(called(RELAY, 1, 0));
	});

	test("a tender's next visit is a new attack, though its ordinal is kept", () => {
		const first = tenderVisitInstance(0, 1_000);
		const spent = hit({}, TENDER, first, false, false).watches;
		expect(hit(spent, TENDER, first, false).encounter).toBeNull();
		const next = tenderVisitInstance(0, 5_000);
		expect(next).not.toBe(first);
		expect(hit(spent, TENDER, next, false).encounter).not.toBeNull();
	});

	test("the relay and the tender are watched separately", () => {
		const relaySpent = hit({}, RELAY, 0, false, false).watches;
		const tender = hit(relaySpent, TENDER, 0, false);
		expect(tender.encounter).toEqual(called(TENDER, 0, 0));
	});
});

describe("the defender in flight", () => {
	const PILOT = v3(1_000_000, 0, 0);

	test("waits out its delay in normal flight rather than being missed", () => {
		const e = called();
		const step = stepEncounter(e, frame(e.appearsAtS - 0.5, PILOT));
		expect(step.encounter.phase).toBe("inbound");
		expect(step.contact).toBeNull();
	});

	test("a pilot back in cruise before it arrives has missed it", () => {
		const e = called();
		const step = stepEncounter(
			e,
			frame(e.appearsAtS - 0.5, PILOT, { inCruise: true }),
		);
		expect(step.encounter.phase).toBe("over");
		expect(step.encounter.end).toBe("missed");
	});

	test("appears straight into the duel, inside beam range, moving with the frame", () => {
		const e = called();
		// The pilot drifting through the frame, so a raider given the pilot's
		// velocity rather than the frame's reads differently here.
		const step = stepEncounter(
			e,
			frame(e.appearsAtS, PILOT, { driftKms: v3(0, 1.5, 0) }),
		);
		expect(step.encounter.phase).toBe("duel");
		expect(step.drop).toBe(false);
		if (!step.contact) throw new Error("a defender that appears is drawn");
		const gap = length(sub(step.contact.pos, PILOT));
		expect(gap).toBeCloseTo(e.rangeKm, 6);
		expect(gap).toBeLessThan(RAIDER_OUT_OF_BEAM_KM);
		expect(step.contact.vel).toEqual(FRAME_VEL);
	});

	test("keeps station in a moving frame instead of drifting off it", () => {
		// Five seconds of duel with the pilot at rest in a 30 km/s frame. A raider
		// spawned or flown in the star's frame falls 150 km behind in that time.
		let e = called();
		let t = e.appearsAtS;
		let pilot = PILOT;
		let worst = 0;
		let maxRelKms = 0;
		for (; t < e.appearsAtS + 5; t += DT) {
			const step = stepEncounter(e, frame(t, pilot));
			e = step.encounter;
			if (step.contact) {
				worst = Math.max(worst, length(sub(step.contact.pos, pilot)));
				maxRelKms = Math.max(
					maxRelKms,
					length(sub(step.contact.vel, FRAME_VEL)),
				);
			}
			pilot = add(pilot, scale(FRAME_VEL, DT));
		}
		expect(e.phase).toBe("duel");
		expect(worst).toBeLessThan(RAIDER_OUT_OF_BEAM_KM);
		expect(maxRelKms).toBeLessThanOrEqual(ASSIST_CAP_KMS + 1e-6);
	});
});
