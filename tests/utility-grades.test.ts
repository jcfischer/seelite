/**
 * Scanner, docking computer and escape pod grades do something (#977): the
 * identity scanner's range and charge, the long-range scanner's signal range
 * and what an eject keeps all read the fitted row. A 1E figure is the game as
 * it was before; the docking computer's grades differ in price and mass alone
 * (principal, 2026-10-14).
 */
import { describe, expect, test } from "bun:test";
import {
	SCAN_CHARGE_S,
	SCAN_RANGE_KM,
	beginScanHold,
	scanCompleted,
	scanInRange,
	scanProgress,
	scanStandoff,
	stepScanHold,
} from "../src/carrier-scan";
import {
	deathWake,
	ejectSurvivors,
	leftByEject,
	parseDeathWake,
	wakeText,
} from "../src/death-cost";
import { firstDayEjectLine } from "../src/first-day";
import { deathWreckContents } from "../src/death-wreck";
import { commanderAfterDeath } from "../src/holdings";
import {
	type FittedModule,
	fittedCapacity,
	type Loadout,
	makeModule,
	moduleRow,
	stockLoadout,
} from "../src/loadout";
import type { Grade } from "../src/module-catalog";
import { RELAY_SIGNAL_RANGE_KM, relaySignal } from "../src/pirate-relay";
import { newCommanderRecord } from "../src/save-envelope";
import type { CommanderState } from "../src/station-commerce";
import { v3 } from "../src/vec3";
import type { SlotSize } from "../src/hull";

/** A freighter: it has the size-3 slots a 3A row needs. */
const HULL = "freighter";
const slotFor = (m: FittedModule): string => {
	const key = { "identity-scanner": "u1", "long-range-scanner": "i1" }[
		m.module as string
	];
	return key ?? "i4";
};
const capacityWith = (...ms: FittedModule[]) =>
	fittedCapacity(HULL, {
		...stockLoadout(HULL),
		...Object.fromEntries(ms.map((m) => [slotFor(m), m])),
	} as Loadout);

describe("O1 identity scanner: range and charge from the fitted row", () => {
	const scanner = (size: SlotSize, grade: Grade) =>
		capacityWith(makeModule("identity-scanner", size, grade));

	test("no scanner reads no range", () => {
		expect(capacityWith().scanRangeKm).toBe(0);
	});

	test("1E is today's 400 km and 5 s", () => {
		const c = scanner(1, "E");
		expect([c.scanRangeKm, c.scanChargeS]).toEqual([
			SCAN_RANGE_KM,
			SCAN_CHARGE_S,
		]);
		expect(SCAN_RANGE_KM).toBe(400);
		expect(SCAN_CHARGE_S).toBe(5);
	});

	test("1D reaches 320 km and charges in 6.25 s; 3A 1,350 km in 3.33 s", () => {
		const d = scanner(1, "D");
		expect(d.scanRangeKm).toBeCloseTo(320, 9);
		expect(d.scanChargeS).toBeCloseTo(6.25, 9);
		const a = scanner(3, "A");
		expect(a.scanRangeKm).toBeCloseTo(1_350, 9);
		expect(a.scanChargeS).toBeCloseTo(5 / 1.5, 9);
	});

	test("the range gate and the charge read the figures passed", () => {
		expect(scanInRange(1_000, 1_350)).toBe(true);
		expect(scanInRange(1_000)).toBe(false);
		expect(scanStandoff(1_000, v3(0, 0, -1), v3(0, 0, -1), 1_350)).toBeNull();
		const key = "s1:carrier:0" as never;
		const hold = stepScanHold(
			beginScanHold(),
			{ key },
			3.4,
			{ armed: true, held: true },
			5 / 1.5,
		);
		expect(scanCompleted(beginScanHold(), hold, 5 / 1.5)).toBe(true);
		expect(scanProgress(hold, 5 / 1.5)).toBe(1);
		// The default is today's charge: 3.4 s is not a completed 5 s hold.
		const stock = stepScanHold(beginScanHold(), { key }, 3.4, {
			armed: true,
			held: true,
		});
		expect(scanCompleted(beginScanHold(), stock)).toBe(false);
	});
});

describe("O2 long-range scanner: signal range from the fitted row", () => {
	const lrs = (size: SlotSize, grade: Grade) =>
		capacityWith(makeModule("long-range-scanner", size, grade)).signalRangeKm;

	test("none reads 0; 1E is today's 2,500 km; 3A 8,437.5 km", () => {
		expect(capacityWith().signalRangeKm).toBe(0);
		expect(lrs(1, "E")).toBe(RELAY_SIGNAL_RANGE_KM);
		expect(RELAY_SIGNAL_RANGE_KM).toBe(2_500);
		expect(lrs(1, "D")).toBeCloseTo(2_000, 9);
		expect(lrs(3, "A")).toBeCloseTo(8_437.5, 9);
	});

	test("the relay signal reads the range passed, and today's by default", () => {
		const relay = v3(0, 0, 0);
		const at = v3(5_000, 0, 0);
		expect(relaySignal(at, relay)).toBeNull();
		const far = relaySignal(at, relay, 8_437.5);
		expect(far?.km).toBe(5_000);
		expect(far?.strength).toBeGreaterThan(0);
		expect(far?.strength).toBeLessThan(1);
	});
});

describe("O3 docking computer: grades differ in price and mass alone", () => {
	test("no capacity field moves, and the dearer grade is the lighter", () => {
		const rows = (["E", "D", "A"] as const).map((g) =>
			moduleRow(makeModule("docking-computer", 1, g)),
		);
		expect(rows.map((r) => r.output)).toEqual([{}, {}, {}]);
		expect(rows[0].priceCr).toBeLessThan(rows[1].priceCr);
		expect(rows[1].priceCr).toBeLessThan(rows[2].priceCr);
		expect(rows[2].massT).toBeLessThan(rows[1].massT);
		expect(rows[1].massT).toBeLessThan(rows[0].massT);
	});
});

describe("O4 escape pod: what survives an eject", () => {
	const pod = (size: SlotSize, grade: Grade) =>
		makeModule("escape-pod", size, grade);
	const salvage = (id: string, kind: FittedModule["module"], grade: Grade) => ({
		id,
		tonnes: 1,
		module: kind,
		size: 1 as SlotSize,
		grade,
	});
	const dyingWith = (m: FittedModule): CommanderState => ({
		...newCommanderRecord(HULL).state,
		cargo: { Food: 40, Computers: 30, Gold: 12 },
		loadout: { ...stockLoadout(HULL), i4: m } as Loadout,
		recoveredFittings: [
			salvage("Fuel Scoops", "fuel-scoop", "E"),
			salvage("Military Laser", "military-laser", "A"),
		],
	});

	test("the capacity carries the pod's share, capsule and carried modules", () => {
		expect(capacityWith(pod(1, "E"))).toMatchObject({
			podCargoShare: 0,
			podCapsuleT: 0,
			podCarriedModules: 0,
		});
		expect(capacityWith(pod(2, "D"))).toMatchObject({
			podCargoShare: 0.25,
			podCapsuleT: 10,
			podCarriedModules: 0,
		});
		expect(capacityWith(pod(3, "A"))).toMatchObject({
			podCargoShare: 0.5,
			podCapsuleT: 20,
			podCarriedModules: 1,
		});
	});

	test("an E pod keeps the pilot alone: today's eject", () => {
		expect(ejectSurvivors(dyingWith(pod(1, "E")))).toEqual({
			cargo: {},
			carried: [],
		});
	});

	test("a 3D pod keeps a quarter of each good, under its 20 t", () => {
		// 10 Food + 7 Computers = 17 t, under 20; Gold is kg and takes no hold.
		expect(ejectSurvivors(dyingWith(pod(3, "D")))).toEqual({
			cargo: { Food: 10, Computers: 7, Gold: 3 },
			carried: [],
		});
	});

	test("a 1A pod keeps half, fills its 5 t dearest first, and the best carried module", () => {
		const kept = ejectSurvivors(dyingWith(pod(1, "A")));
		// Half is 20 Food and 15 Computers; 5 t takes the dearer good first.
		expect(kept.cargo).toEqual({ Computers: 5, Gold: 6 });
		expect(kept.carried.map((f) => f.id)).toEqual(["Military Laser"]);
	});

	test("the eject restores what the pod kept, and the wreck holds the rest", () => {
		const dying = dyingWith(pod(1, "A"));
		const record = { ...newCommanderRecord(HULL), state: dying };
		const after = commanderAfterDeath(record, record, "eject");
		expect(after.state.cargo).toEqual({ Computers: 5, Gold: 6 });
		expect(after.state.recoveredFittings?.map((f) => f.id)).toEqual([
			"Military Laser",
		]);
		expect(after.state.loadout.i4).toBeUndefined();
		const left = leftByEject(dying);
		expect(left.cargo).toEqual({ Food: 40, Computers: 25, Gold: 6 });
		expect(left.recoveredFittings?.map((f) => f.id)).toEqual(["Fuel Scoops"]);
		// The wreck draws from what is left: the same draw as a pod-less eject
		// of the left state, which keeps nothing back.
		const { i4: _, ...podless } = left.loadout;
		const bare = { ...left, loadout: podless as Loadout };
		expect(ejectSurvivors(bare)).toEqual({ cargo: {}, carried: [] });
		for (let at = 10; at < 40; at++)
			expect(deathWreckContents(47, at, dying, "eject")).toEqual(
				deathWreckContents(47, at, bare, "eject"),
			);
	});

	test("a destroyed ship keeps nothing, whatever the pod", () => {
		const dying = dyingWith(pod(3, "A"));
		const record = { ...newCommanderRecord(HULL), state: dying };
		expect(
			commanderAfterDeath(record, record, "destroyed").state.cargo,
		).toEqual({});
	});
});

describe("O4 the pilot is told what the pod keeps", () => {
	test("the First day line names a D or A pod's share; an E pod keeps its sentence", () => {
		const e = firstDayEjectLine(true, false, "hold X to eject", {
			podCargoShare: 0,
			podCapsuleT: 0,
			podCarriedModules: 0,
		});
		expect(e).toContain("you lose the hold and the pod and keep the ship");
		const a = firstDayEjectLine(true, false, "hold X to eject", {
			podCargoShare: 0.5,
			podCapsuleT: 20,
			podCarriedModules: 1,
		});
		expect(a).toContain(
			"the pod brings back 50% of your own cargo, up to 20 t, and your most valuable carried module",
		);
		expect(a).not.toContain("you lose the hold and");
	});

	test("the wake names what came back, and survives its own parser", () => {
		const record = newCommanderRecord(HULL);
		const wake = deathWake("s", record, "eject", false, {
			cargo: { Computers: 5, Gold: 6 },
			carried: [{ id: "Military Laser", tonnes: 1 }],
		});
		expect(wake.kept).toEqual(["5 t Computers", "6 kg Gold", "Military Laser"]);
		expect(parseDeathWake(JSON.parse(JSON.stringify(wake)))).toEqual(wake);
		expect(wakeText(wake)).toContain(
			"with 5 t Computers, 6 kg Gold and Military Laser. Lost: the rest of the hold and the pod.",
		);
		const bare = deathWake("s", record, "eject", false, {
			cargo: {},
			carried: [],
		});
		expect(bare.kept).toBeUndefined();
		expect(wakeText(bare)).toContain("Lost: an empty hold and the pod.");
		expect(parseDeathWake({ ...wake, kept: [] })).toBeNull();
		expect(parseDeathWake({ ...wake, kept: [3] })).toBeNull();
	});
});
