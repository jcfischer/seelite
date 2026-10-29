import { describe, expect, test } from "bun:test";
import { debitAt } from "../src/deposit-state";
import { POLICY } from "../src/module-catalog";
import {
	CANISTER_SCOOP_CHARGE_E,
	CANISTER_SCOOP_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
	STOCK_SCOOP,
	scoops,
} from "../src/raider-wreck";
import {
	beamHit,
	beginCut,
	debitSurface,
	EXTRACTION,
	type Fragment,
	FRAGMENT_REFUSAL_NOTICE,
	firedExtraction,
	fragmentAt,
	oreShare,
	prototypeMiningLaserSlot,
	pullFragment,
	releaseFragment,
	stepCut,
	stepFragments,
} from "../src/rock-extraction";
import { SCOOP_REFUSAL_TEXT } from "../src/cargo-notice";
import { add, scale, sub, v3 } from "../src/vec3";

const cutFor = (seconds: number, rate: number, share: number, left = 1e9) => {
	let cut = beginCut();
	let ore = 0;
	let waste = 0;
	const dt = 1 / 60;
	for (let t = 0; t < seconds - 1e-9; t += dt) {
		const s = stepCut(cut, "rock:a:1", rate, share, dt, left - ore);
		cut = s.cut;
		ore += s.ore;
		waste += s.waste;
	}
	return { cut, ore, waste };
};

describe("the cut", () => {
	test("grade E is half ore, A three quarters, D less than E", () => {
		expect(oreShare("E")).toBe(0.5);
		expect(oreShare("A")).toBe(0.75);
		expect(oreShare("D")).toBeLessThan(oreShare("E"));
	});

	test("a 1E laser releases one ore tonne per twenty seconds of beam", () => {
		const { ore, waste, cut } = cutFor(60, 0.1, oreShare("E"));
		expect(ore + waste + cut.oreT + cut.wasteT).toBeCloseTo(6, 6);
		expect(ore).toBe(3);
	});

	test("no beam and no rate add nothing", () => {
		const cut = { key: "rock:a:1", oreT: 0.5, wasteT: 0.2 };
		expect(stepCut(cut, null, 0.1, 0.5, 1, 10).cut).toBe(cut);
		expect(stepCut(cut, "rock:a:1", 0, 0.5, 1, 10).ore).toBe(0);
	});

	test("moving the beam to another rock drops the progress", () => {
		const cut = { key: "rock:a:1", oreT: 0.9, wasteT: 0.9 };
		const s = stepCut(cut, "rock:a:2", 0.1, 0.5, 1, 10);
		expect(s.ore).toBe(0);
		expect(s.cut.oreT).toBeCloseTo(0.05, 9);
	});

	test("ore never exceeds the reserve left, and a depleted rock gives waste only", () => {
		expect(cutFor(600, 0.3375, 0.75, 2).ore).toBe(2);
		const s = stepCut(beginCut(), "rock:a:1", 1, 0.75, 3, 0);
		expect(s).toMatchObject({ ore: 0, waste: 3, depleted: true });
	});
});

describe("the deposit", () => {
	test("a release debits whole tonnes and rebases both debits", () => {
		const t = 7200;
		const row = debitSurface(
			{ surface: 5, deep: 3, at: 0, surveyedAt: 10 },
			t,
			1,
		);
		expect(row).toEqual({ surface: 4, deep: 1, at: t, surveyedAt: 10 });
		expect(debitAt(row.surface ?? 0, row.at ?? 0, t)).toBe(4);
	});

	test("a first release creates the row", () => {
		expect(debitSurface(undefined, 50, 1)).toEqual({ surface: 1, at: 50 });
	});
});

describe("the beam", () => {
	const rocks = [
		{ id: "near", pos: v3(0, 0, -5), vel: v3(), radiusKm: 1 },
		{ id: "far", pos: v3(0, 0, -9), vel: v3(), radiusKm: 2 },
		{ id: "aside", pos: v3(3, 0, -3), vel: v3(), radiusKm: 0.5 },
	];

	test("hits the nearest surface on the line", () => {
		const hit = beamHit(v3(), v3(0, 0, -1), rocks, 12);
		expect(hit?.id).toBe("near");
		expect(hit?.distKm).toBeCloseTo(4, 9);
		expect(hit?.normal.z).toBeCloseTo(1, 9);
	});

	test("misses past its range and off the line", () => {
		expect(beamHit(v3(), v3(0, 0, -1), rocks, 3.9)).toBeNull();
		expect(beamHit(v3(), v3(0, 1, 0), rocks, 12)).toBeNull();
	});

	const swap = (v: { x: number; y: number; z: number }) => v3(v.y, v.x, v.z);
	const shaped = {
		id: "lumpy",
		pos: v3(0, 0, -5),
		vel: v3(),
		radiusKm: 1,
		shape: {
			toLocal: swap,
			toWorld: swap,
			radiusAt: (d: { x: number }) => (d.x > 0.5 ? 1 : 0.5),
		},
	};

	test("a shaped rock is hit on its drawn surface, not its bounding sphere", () => {
		const hit = beamHit(v3(), v3(0, 0, -1), [shaped], 12);
		expect(hit?.distKm).toBeCloseTo(4.5, 6);
		expect(hit?.normal.z).toBeCloseTo(1, 3);
	});

	test("a beam inside the bounding sphere but clear of the surface misses", () => {
		expect(beamHit(v3(0.7, 0, 0), v3(0, 0, -1), [shaped], 12)).toBeNull();
	});

	test("the shape is read in the rock's own frame", () => {
		const side = beamHit(v3(3, 0, -5), v3(-1, 0, 0), [shaped], 12);
		expect(side?.distKm).toBeCloseTo(2.5, 6);
		const lobe = beamHit(v3(0, 3, -5), v3(0, -1, 0), [shaped], 12);
		expect(lobe?.distKm).toBeCloseTo(2, 6);
	});
});

describe("fragments", () => {
	const hit = { id: "r", point: v3(0, 0, 1), normal: v3(0, 0, 1), distKm: 4 };
	const ore = { family: "metallic", grade: "standard" } as const;
	const still = { pos: v3(), vel: v3() };

	test("leave the surface outward at the eject speed and ride with the rock", () => {
		const f = releaseFragment("f1", 3, ore, hit, v3(), 100);
		expect(f.rockId).toBe("r");
		expect(f.expiresAt).toBe(100 + EXTRACTION.lifetimeS);
		const at = fragmentAt(f, { pos: v3(500, 0, 0), vel: v3(30, 0, 0) }, 110);
		const rel = sub(at.vel, v3(30, 0, 0));
		expect(Math.hypot(rel.x, rel.y, rel.z)).toBeCloseTo(EXTRACTION.ejectKms, 9);
		expect(rel.z).toBeGreaterThan(0);
		const off = sub(at.pos, v3(500, 0, 1));
		expect(off.z).toBeCloseTo(rel.z * 10, 9);
	});

	test("a burst fans out", () => {
		const a = releaseFragment("a", 0, ore, hit, v3(), 0);
		const b = releaseFragment("b", 1, ore, hit, v3(), 0);
		expect(
			Math.abs(a.ejectVel.x - b.ejectVel.x) +
				Math.abs(a.ejectVel.y - b.ejectVel.y),
		).toBeGreaterThan(1e-4);
	});

	const sitting = (over: Partial<Fragment> = {}): Fragment => ({
		id: "f",
		rockId: "r",
		ore,
		offset: v3(0.01, 0, 0),
		ejectVel: v3(),
		bornAt: 0,
		expiresAt: 100,
		...over,
	});
	const rock = () => still;
	const bank = () => 100;
	const NO_SCOOP = { scoopRadiusKm: 0, scoopSpeedKms: 0 };
	const sized = (size: 1 | 2 | 3) => ({
		scoopRadiusKm: CANISTER_SCOOP_RADIUS_KM * POLICY.sizeScale[size],
		scoopSpeedKms: CANISTER_SCOOP_SPEED_KMS,
	});
	const offer = (
		gear: typeof STOCK_SCOOP,
		at: number,
		energy = 100,
		over: Partial<Fragment> = {},
	) => {
		let offered = 0;
		const s = stepFragments(
			[sitting({ offset: v3(at, 0, 0), ...over })],
			still,
			10,
			rock,
			gear,
			() => energy,
			() => {
				offered++;
				return "taken";
			},
		);
		return { s, offered };
	};

	test("one in the window is offered and taken", () => {
		const s = stepFragments(
			[sitting()],
			still,
			10,
			rock,
			STOCK_SCOOP,
			bank,
			() => "taken",
		);
		expect(s.taken).toHaveLength(1);
		expect(s.kept).toHaveLength(0);
	});

	test("a refused one stays and says why", () => {
		const s = stepFragments(
			[sitting()],
			still,
			10,
			rock,
			STOCK_SCOOP,
			bank,
			() => "hold-full",
		);
		expect(s.kept).toHaveLength(1);
		expect(s.refused[0].verdict).toBe("hold-full");
	});

	test("too fast, too far or an unresolved rock is not offered", () => {
		let offered = 0;
		const count = () => {
			offered++;
			return "taken" as const;
		};
		stepFragments(
			[sitting({ ejectVel: v3(0.3, 0, 0) })],
			still,
			0,
			rock,
			STOCK_SCOOP,
			bank,
			count,
		);
		stepFragments(
			[sitting({ offset: v3(0.06, 0, 0) })],
			still,
			10,
			rock,
			STOCK_SCOOP,
			bank,
			count,
		);
		stepFragments([sitting()], still, 10, () => null, STOCK_SCOOP, bank, count);
		expect(offered).toBe(0);
	});

	test("a ship with no scoop takes nothing and is told inside today's window", () => {
		const { s, offered } = offer(NO_SCOOP, 0.01);
		expect(offered).toBe(0);
		expect(s.taken).toHaveLength(0);
		expect(s.kept).toHaveLength(1);
		expect(s.refused[0].verdict).toBe("no-scoop");
	});

	test("a ship with no scoop is silent about a fragment outside today's window", () => {
		const { s, offered } = offer(NO_SCOOP, 0.06);
		expect(offered).toBe(0);
		expect(s.refused).toHaveLength(0);
		expect(s.kept).toHaveLength(1);
	});

	test("an unfitted ship still lets an expired fragment go, and waste stays unsaid", () => {
		const gone = offer(NO_SCOOP, 0.01, 100, { expiresAt: 5 });
		expect(gone.s.lost).toHaveLength(1);
		expect(gone.s.refused).toHaveLength(0);
		const waste = offer(NO_SCOOP, 0.01, 100, { ore: null });
		expect(waste.s.refused).toHaveLength(0);
	});

	test("the window is the fitted scoop's: a small one ends at its own radius", () => {
		const just = CANISTER_SCOOP_RADIUS_KM * POLICY.sizeScale[1];
		expect(offer(sized(1), just * 0.9).offered).toBe(1);
		expect(offer(sized(1), just * 1.1).offered).toBe(0);
	});

	test("a larger scoop takes what the stock window misses", () => {
		const big = sized(3);
		const at = CANISTER_SCOOP_RADIUS_KM * 1.2;
		expect(POLICY.sizeScale[3]).toBeGreaterThan(1.2);
		expect(offer(STOCK_SCOOP, at).offered).toBe(0);
		expect(offer(big, at).offered).toBe(1);
	});

	test("the speed tolerance is the fitted scoop's too", () => {
		const fast = { ...STOCK_SCOOP, scoopSpeedKms: 0.5 };
		const f = { ejectVel: v3(0.4, 0, 0), bornAt: 10 };
		expect(offer(STOCK_SCOOP, 0.01, 100, f).offered).toBe(0);
		expect(offer(fast, 0.01, 100, f).offered).toBe(1);
	});

	test("a bank below the pickup charge refuses it and the fragment stays", () => {
		const low = offer(STOCK_SCOOP, 0.01, CANISTER_SCOOP_CHARGE_E - 0.1);
		expect(low.offered).toBe(0);
		expect(low.s.kept).toHaveLength(1);
		expect(low.s.refused[0].verdict).toBe("low-bank");
		expect(offer(STOCK_SCOOP, 0.01, CANISTER_SCOOP_CHARGE_E).offered).toBe(1);
	});

	test("the window reads the fragment and the ship at the same moment", () => {
		const moving = { pos: v3(300, 0, 0), vel: v3(30, 0, 0) };
		const s = stepFragments(
			[sitting()],
			moving,
			10,
			() => moving,
			STOCK_SCOOP,
			bank,
			() => "taken",
		);
		expect(s.taken).toHaveLength(1);
	});

	test("waste is never offered, and an expired ore fragment is lost", () => {
		let offered = 0;
		const s = stepFragments(
			[sitting({ ore: null }), sitting({ id: "old", expiresAt: 5 })],
			still,
			10,
			rock,
			STOCK_SCOOP,
			bank,
			() => {
				offered++;
				return "taken";
			},
		);
		expect(offered).toBe(0);
		expect(s.lost.map((f) => f.id)).toEqual(["old"]);
		expect(s.kept).toHaveLength(1);
	});
});

describe("the drift toward the ship", () => {
	const ore = { family: "gold", grade: "rich" } as const;
	const rock = { pos: v3(), vel: v3(30, 0, 0) };
	const base: Fragment = {
		id: "f",
		rockId: "r",
		ore,
		offset: v3(0, 0, 0.5),
		ejectVel: v3(0, 0, 0.01),
		bornAt: 0,
		expiresAt: 120,
	};

	test("does not move the fragment where it is now", () => {
		const ship = { pos: v3(300, 1, 0.5), vel: v3(30, 0, 0) };
		const r = { pos: v3(300, 0, 0), vel: rock.vel };
		const before = fragmentAt(base, r, 10);
		const after = fragmentAt(pullFragment(base, r, ship, 10, 0.1), r, 10);
		expect(after.pos.x).toBeCloseTo(before.pos.x, 9);
		expect(after.pos.y).toBeCloseTo(before.pos.y, 9);
		expect(after.pos.z).toBeCloseTo(before.pos.z, 9);
	});

	test("brings it to a waiting ship at the drift speed", () => {
		let f = base;
		const dt = 0.1;
		let reached = false;
		for (let t = 0; t < 120 && !reached; t += dt) {
			const r = { pos: scale(rock.vel, t), vel: rock.vel };
			const s = {
				pos: add(v3(0, 1.5, 0.5), scale(rock.vel, t)),
				vel: rock.vel,
			};
			f = pullFragment(f, r, s, t, dt);
			reached = scoops(fragmentAt(f, r, t), s, STOCK_SCOOP);
		}
		expect(reached).toBe(true);
		const v = f.ejectVel;
		expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(EXTRACTION.driftKms, 6);
	});

	test("waste and far fragments are not pulled", () => {
		const ship = { pos: v3(0, 5, 0), vel: rock.vel };
		const waste = { ...base, ore: null };
		expect(pullFragment(waste, rock, ship, 1, 1)).toBe(waste);
		expect(pullFragment(base, rock, ship, 1, 1)).toBe(base);
	});
});

describe("the fired lasers", () => {
	test("a D-only group cuts at D's ore share, not E's", () => {
		const out = firedExtraction([{ grade: "D", extractionTPerS: 0.1 }]);
		expect(out.grade).toBe("D");
		expect(oreShare(out.grade)).toBeCloseTo(0.4, 9);
	});

	test("rates sum and the best ore share wins", () => {
		const out = firedExtraction([
			{ grade: "D", extractionTPerS: 0.1 },
			{ grade: "A", extractionTPerS: 0.2 },
		]);
		expect(out.rate).toBeCloseTo(0.3, 9);
		expect(out.grade).toBe("A");
	});

	test("no laser fired is a zero rate", () => {
		expect(firedExtraction([])).toEqual({ rate: 0, grade: "E" });
	});
});

describe("the prototype's Mining Laser fit", () => {
	const hardpoints = [{ key: "H1" }, { key: "H2" }];

	test("goes on the first free hardpoint", () => {
		expect(
			prototypeMiningLaserSlot(hardpoints, { H1: { module: "pulse-laser" } }),
		).toBe("H2");
	});

	test("with every hardpoint taken it takes the first", () => {
		expect(
			prototypeMiningLaserSlot(hardpoints, {
				H1: { module: "pulse-laser" },
				H2: { module: "beam-laser" },
			}),
		).toBe("H1");
	});

	test("does nothing when one is fitted", () => {
		expect(
			prototypeMiningLaserSlot(hardpoints, { H2: { module: "mining-laser" } }),
		).toBe("fitted");
	});

	test("a hull with no hardpoint gets none", () => {
		expect(prototypeMiningLaserSlot([], {})).toBeNull();
	});
});

test("Game fits the prototype laser on a new game, a boot that writes nothing, or a loaded miner (Q11)", async () => {
	const main = await Bun.file(
		new URL("../src/main.ts", import.meta.url),
	).text();
	const at = main.indexOf("\tfitPrototypeMiningLaser(newOrUnsaved: boolean) {");
	expect(at).toBeGreaterThan(0);
	expect(main.slice(at, at + 200)).toContain(
		"if (!newOrUnsaved && HULL_SPECS[this.commander.hull].cutter === undefined)",
	);
	expect(main).toContain(
		"game.fitPrototypeMiningLaser(plan.writesNothing || plan.loaded === null);",
	);
});

test("a refused fragment's notice: the canister's no-scoop words, the low-bank charge, a full hold", () => {
	expect(FRAGMENT_REFUSAL_NOTICE["no-scoop"]).toBe(
		SCOOP_REFUSAL_TEXT["no-scoop"].toUpperCase(),
	);
	expect(FRAGMENT_REFUSAL_NOTICE["low-bank"]).toBe(
		`ENERGY BELOW ${CANISTER_SCOOP_CHARGE_E} E · FRAGMENT LEFT`,
	);
	expect(FRAGMENT_REFUSAL_NOTICE["hold-full"]).toBe(
		"HOLD FULL · FRAGMENT LEFT",
	);
});
