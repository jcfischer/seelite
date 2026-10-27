import { describe, expect, test } from "bun:test";
import { debitAt } from "../src/deposit-state";
import {
	beamHit,
	beginCut,
	debitSurface,
	EXTRACTION,
	type Fragment,
	fragmentAt,
	inScoopWindow,
	oreShare,
	pullFragment,
	releaseFragment,
	stepCut,
	stepFragments,
} from "../src/rock-extraction";
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

	test("one in the window is offered and taken", () => {
		const s = stepFragments([sitting()], still, 10, rock, () => "taken");
		expect(s.taken).toHaveLength(1);
		expect(s.kept).toHaveLength(0);
	});

	test("a refused one stays and says why", () => {
		const s = stepFragments([sitting()], still, 10, rock, () => "hold-full");
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
			count,
		);
		stepFragments(
			[sitting({ offset: v3(0.06, 0, 0) })],
			still,
			10,
			rock,
			count,
		);
		stepFragments([sitting()], still, 10, () => null, count);
		expect(offered).toBe(0);
	});

	test("the window reads the fragment and the ship at the same moment", () => {
		const moving = { pos: v3(300, 0, 0), vel: v3(30, 0, 0) };
		const s = stepFragments(
			[sitting()],
			moving,
			10,
			() => moving,
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
			reached = inScoopWindow(fragmentAt(f, r, t), s);
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
