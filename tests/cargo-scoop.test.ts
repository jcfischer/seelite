import { describe, expect, test } from "bun:test";
import { SCOOP_REFUSAL_TEXT, scoopExit } from "../src/cargo-notice";
import { scoopWreckContainer } from "../src/derelict-salvage";
import { HULL_SPECS, PURCHASABLE_HULL_IDS } from "../src/hull";
import {
	fittedCapacity,
	makeModule,
	moduleRow,
	moduleRows,
	stockLoadout,
} from "../src/loadout";
import { DEFINITIONS, gradeOutputScale, POLICY } from "../src/module-catalog";
import {
	CANISTER_SCOOP_CHARGE_E,
	CANISTER_SCOOP_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
	type Canister,
	scoopAttempt,
	scoops,
	STOCK_SCOOP,
	stepCanisters,
} from "../src/raider-wreck";
import { newCommander } from "../src/station-commerce";
import { steadyFrame } from "../src/sim";
import { v3 } from "../src/vec3";

const NO_SCOOP = { scoopRadiusKm: 0, scoopSpeedKms: 0 };
const pose = (x: number) => ({ pos: v3(x, 0, 0), vel: v3() });
const ship = pose(0);

describe("the cargo scoop row", () => {
	test("is an internal cargo-family module at weight 1 and 1", () => {
		expect(DEFINITIONS.find((d) => d.kind === "cargo-scoop")).toMatchObject({
			slotKind: "internal",
			family: "cargo",
			priceWeight: 1,
			massWeight: 1,
		});
		expect(moduleRows().some((r) => r.kind === "cargo-scoop")).toBe(true);
	});

	test("a 1E scoop is today's window", () => {
		const o = moduleRow(makeModule("cargo-scoop", 1, "E")).output;
		expect(o.scoopRadiusKm).toBe(CANISTER_SCOOP_RADIUS_KM);
		expect(o.scoopSpeedKms).toBe(CANISTER_SCOOP_SPEED_KMS);
	});

	test("size widens the radius and grade raises the speed tolerance", () => {
		for (const size of [1, 2, 3] as const)
			for (const grade of ["E", "D", "A"] as const) {
				const o = moduleRow(makeModule("cargo-scoop", size, grade)).output;
				expect(o.scoopRadiusKm).toBeCloseTo(
					CANISTER_SCOOP_RADIUS_KM * POLICY.sizeScale[size],
					12,
				);
				expect(o.scoopSpeedKms).toBeCloseTo(
					CANISTER_SCOOP_SPEED_KMS * gradeOutputScale(grade),
					12,
				);
			}
	});
});

describe("the fitted scoop", () => {
	test("every purchasable hull carries a 1E scoop in its first cargo slot, flex empty", () => {
		for (const id of PURCHASABLE_HULL_IDS) {
			const first = HULL_SPECS[id].slots.find(
				(s) =>
					s.kind === "internal" &&
					s.accepts !== "any" &&
					s.accepts.includes("cargo"),
			);
			expect(first).toBeDefined();
			const loadout = stockLoadout(id);
			expect(loadout[first!.key]).toMatchObject({
				module: "cargo-scoop",
				size: 1,
				grade: "E",
			});
			expect(loadout.flex).toBeUndefined();
			expect(loadout.plant).toBeDefined();
			expect(loadout.h1?.module).toBe("pulse-laser");
		}
	});

	test("the capacity reads the best fitted scoop, and none reads zero", () => {
		const stock = stockLoadout("freighter");
		expect(fittedCapacity("freighter", stock)).toMatchObject(STOCK_SCOOP);
		const { i1: _scoop, ...bare } = stock;
		expect(fittedCapacity("freighter", bare)).toMatchObject(NO_SCOOP);
		const two = {
			...stock,
			i2: makeModule("cargo-scoop", 2, "A"),
		};
		expect(fittedCapacity("freighter", two)).toMatchObject({
			scoopRadiusKm: CANISTER_SCOOP_RADIUS_KM * POLICY.sizeScale[2],
			scoopSpeedKms: CANISTER_SCOOP_SPEED_KMS * gradeOutputScale("A"),
		});
	});
});

describe("the pickup gate", () => {
	test("a ship with no scoop takes nothing and is told, inside today's window", () => {
		expect(scoops(pose(0.01), ship, NO_SCOOP)).toBe(false);
		expect(scoopAttempt(pose(0.01), ship, NO_SCOOP, 100)).toBe("no-scoop");
		expect(scoopAttempt(pose(1), ship, NO_SCOOP, 100)).toBe("out");
	});

	test("a fitted scoop takes inside its window when the bank holds the charge", () => {
		expect(scoopAttempt(pose(0.01), ship, STOCK_SCOOP, 100)).toBe("take");
		expect(
			scoopAttempt(pose(0.01), ship, STOCK_SCOOP, CANISTER_SCOOP_CHARGE_E),
		).toBe("take");
		expect(
			scoopAttempt(
				pose(0.01),
				ship,
				STOCK_SCOOP,
				CANISTER_SCOOP_CHARGE_E - 0.1,
			),
		).toBe("low-bank");
	});

	test("the window is the scoop's, not the constant's", () => {
		const narrow = {
			scoopRadiusKm: CANISTER_SCOOP_RADIUS_KM / 2,
			scoopSpeedKms: CANISTER_SCOOP_SPEED_KMS,
		};
		const between = pose(CANISTER_SCOOP_RADIUS_KM * 0.75);
		expect(scoopAttempt(between, ship, narrow, 100)).toBe("out");
		expect(scoopAttempt(between, ship, STOCK_SCOOP, 100)).toBe("take");
		const slow = {
			scoopRadiusKm: CANISTER_SCOOP_RADIUS_KM,
			scoopSpeedKms: CANISTER_SCOOP_SPEED_KMS / 2,
		};
		const fast = {
			pos: v3(0.01, 0, 0),
			vel: v3(CANISTER_SCOOP_SPEED_KMS * 0.75, 0, 0),
		};
		expect(scoopAttempt(fast, ship, slow, 100)).toBe("out");
	});

	const canister: Canister = {
		id: "c",
		commodity: "Food",
		tonnes: 1,
		pos: v3(0.01, 0, 0),
		vel: v3(),
		restsAt: 0,
		expiresAt: 1000,
	} as Canister;
	const step = (gear: typeof STOCK_SCOOP, bank: number) => {
		let taken = 0;
		const out = stepCanisters(
			[canister],
			ship,
			0.1,
			10,
			(c) => {
				taken += c.tonnes;
				return c.tonnes;
			},
			() => steadyFrame(v3()),
			gear,
			() => bank,
		);
		return { out, taken };
	};

	test("an unfitted ship leaves a canister in space with a reason", () => {
		const { out, taken } = step(NO_SCOOP, 100);
		expect(taken).toBe(0);
		expect(out.kept).toHaveLength(1);
		expect(out.scoops[0]).toMatchObject({
			accepted: false,
			refusal: "no-scoop",
		});
	});

	test("a low bank leaves it in space with a reason", () => {
		const { out, taken } = step(STOCK_SCOOP, 1);
		expect(taken).toBe(0);
		expect(out.kept).toHaveLength(1);
		expect(out.scoops[0]).toMatchObject({
			accepted: false,
			refusal: "low-bank",
		});
	});

	test("a fitted ship with the charge takes it", () => {
		const { out, taken } = step(STOCK_SCOOP, 100);
		expect(taken).toBe(1);
		expect(out.kept).toHaveLength(0);
		expect(out.scoops[0]).toMatchObject({ accepted: true, tonnes: 1 });
	});

	test("the glass says which refusal it was", () => {
		expect(SCOOP_REFUSAL_TEXT["no-scoop"]).toContain("scoop");
		expect(SCOOP_REFUSAL_TEXT["low-bank"]).toContain("bank");
		expect(
			scoopExit({
				commodity: "Food",
				tonnes: 1,
				accepted: false,
				refusal: SCOOP_REFUSAL_TEXT["no-scoop"],
			} as Parameters<typeof scoopExit>[0]),
		).toContain("scoop");
	});
});

describe("a wreck container", () => {
	const row = {
		instanceOrdinal: 0,
		lostAt: 0,
		containers: [{ kind: "good" as const, id: "Food", tonnes: 8, left: 8 }],
	};
	const attempt = (gear: typeof STOCK_SCOOP, bankE: number) =>
		scoopWreckContainer(
			row,
			0,
			newCommander("courier"),
			0,
			pose(0.01),
			ship,
			gear,
			bankE,
			1,
		);

	test("is left alone by an unfitted ship, which is told why", () => {
		const r = attempt(NO_SCOOP, 100);
		expect(r.tonnes).toBe(0);
		expect(r.row).toBe(row);
		expect(r.refusal).toBe(SCOOP_REFUSAL_TEXT["no-scoop"]);
	});

	test("is left alone on a low bank", () => {
		const r = attempt(STOCK_SCOOP, 0);
		expect(r.tonnes).toBe(0);
		expect(r.refusal).toBe(SCOOP_REFUSAL_TEXT["low-bank"]);
	});

	test("is taken by a fitted ship with the charge", () => {
		const r = attempt(STOCK_SCOOP, 100);
		expect(r.tonnes).toBeGreaterThan(0);
		expect(r.refusal).toBeNull();
	});
});
