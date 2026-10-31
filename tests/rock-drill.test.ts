import { describe, expect, test } from "bun:test";
import { debitAt } from "../src/deposit-state";
import { HULL_SPECS } from "../src/hull";
import {
	beginDrillCut,
	DRILL,
	DRILL_RATES,
	debitDeep,
	type DrillContactInput,
	drillContact,
	drillFaceKm,
	stepDrillCut,
	stepFeed,
	stepSpin,
} from "../src/rock-drill";
import { stepCondition } from "../src/ship-condition";
import { fullCondition } from "../src/ship-condition";
import { v3 } from "../src/vec3";

const cutter = HULL_SPECS.miner.cutter;
if (!cutter) throw new Error("the miner carries a cutter");

const nose = v3(0, 0, 1);
const up = v3(0, 1, 0);
const face = drillFaceKm(v3(), nose, up, cutter, 1);

const square = (over: Partial<DrillContactInput> = {}): DrillContactInput => {
	const gapKm = 0.0005;
	return {
		extension: 1,
		nose,
		faceVel: v3(),
		hit: {
			point: v3(face.x, face.y, face.z + gapKm),
			normal: v3(0, 0, -1),
			distKm: gapKm,
		},
		surfaceVel: v3(),
		rockCentre: v3(face.x, face.y, face.z + 0.1),
		deepMouth: v3(0, 0, -1),
		...over,
	};
};

describe("the cutter face", () => {
	test("stowed it is the bow plane, full feed is #803's 10.6 m ahead, below the axis", () => {
		const stowed = drillFaceKm(v3(), nose, up, cutter, 0);
		expect(stowed.z).toBeCloseTo(0.0422, 9);
		expect(face.z).toBeCloseTo(0.0528, 9);
		expect(face.y).toBeCloseTo(-0.00341, 9);
	});
});

describe("contact", () => {
	test("square, close, slow and on the mouth is contact", () => {
		expect(drillContact(square()).block).toBeNull();
	});

	test("a stowed or moving feed does not drill", () => {
		expect(drillContact(square({ extension: 0 })).block).toBe("STOWED");
		expect(drillContact(square({ extension: 0.5 })).block).toBe("DEPLOYING");
	});

	test("reach: a surface beyond the contact gap is out of reach", () => {
		const far = square({
			hit: {
				point: v3(face.x, face.y, face.z + DRILL.contactKm * 2),
				normal: v3(0, 0, -1),
				distKm: DRILL.contactKm * 2,
			},
		});
		expect(drillContact(far).block).toBe("OUT OF REACH");
		expect(drillContact(square({ hit: null })).block).toBe("NO ROCK");
	});

	test("alignment: the nose more than the window off the surface normal is refused", () => {
		const off = (DRILL.alignDeg + 1) * (Math.PI / 180);
		const tilted = square({
			hit: {
				point: v3(face.x, face.y, face.z + 0.0005),
				normal: v3(Math.sin(off), 0, -Math.cos(off)),
				distKm: 0.0005,
			},
		});
		expect(drillContact(tilted).block).toBe("ALIGN");
		const ok = (DRILL.alignDeg - 1) * (Math.PI / 180);
		const fine = square({
			hit: {
				point: v3(face.x, face.y, face.z + 0.0005),
				normal: v3(Math.sin(ok), 0, -Math.cos(ok)),
				distKm: 0.0005,
			},
		});
		expect(drillContact(fine).block).toBeNull();
	});

	test("closing speed: over the window is refused, at the window is contact", () => {
		expect(
			drillContact(square({ faceVel: v3(0, 0, DRILL.closingKms * 1.01) }))
				.block,
		).toBe("CLOSING");
		expect(
			drillContact(square({ faceVel: v3(0, 0, DRILL.closingKms * 0.99) }))
				.block,
		).toBeNull();
	});

	test("sliding is read against the spinning surface, not the rock's centre", () => {
		const spin = v3(DRILL.slideKms * 2, 0, 0);
		expect(drillContact(square({ surfaceVel: spin })).block).toBe("SLIDING");
		expect(
			drillContact(square({ surfaceVel: spin, faceVel: spin })).block,
		).toBeNull();
	});

	test("on the mouth the face is on the deep deposit, elsewhere on surface ore (D-D3)", () => {
		expect(drillContact(square()).deposit).toBe("deep");
		const none = drillContact(square({ deepMouth: null }));
		expect(none.block).toBeNull();
		expect(none.deposit).toBe("surface");
		const off = drillContact(square({ deepMouth: v3(1, 0, 0) }));
		expect(off.block).toBeNull();
		expect(off.deposit).toBe("surface");
	});
});

describe("the feed", () => {
	test("deploys in deployS and retracts in deployS", () => {
		let e = 0;
		for (let i = 0; i < DRILL.deployS * 60 + 1; i++)
			e = stepFeed(e, true, 1 / 60, Number.POSITIVE_INFINITY, cutter);
		expect(e).toBe(1);
		for (let i = 0; i < DRILL.deployS * 60 + 1; i++)
			e = stepFeed(e, false, 1 / 60, Number.POSITIVE_INFINITY, cutter);
		expect(e).toBe(0);
	});

	test("never extends into a rock: it stops short of the surface ahead", () => {
		const roomKm = cutter.feedTravelKm / 2;
		let e = 0;
		for (let i = 0; i < DRILL.deployS * 120; i++)
			e = stepFeed(e, true, 1 / 60, roomKm, cutter);
		expect(e * cutter.feedTravelKm).toBeLessThanOrEqual(roomKm);
		expect(e).toBeLessThan(1);
		expect(stepFeed(0.9, true, 1 / 60, roomKm, cutter)).toBe(0.9);
	});

	test("the rotor spins up only while powered", () => {
		expect(stepSpin(0, true, DRILL.spinUpS)).toBe(1);
		expect(stepSpin(1, false, DRILL.spinUpS)).toBe(0);
		expect(stepSpin(0, true, DRILL.spinUpS / 2)).toBeCloseTo(0.5, 9);
	});
});

const run = (
	seconds: number,
	at: (s: number) => {
		key: string | null;
		powered?: boolean;
		holdFreeT?: number;
		reserveLeftT?: number;
	},
) => {
	let cut = beginDrillCut();
	let tonnes = 0;
	const stops = new Set<string>();
	const dt = 1 / 60;
	for (let s = 0; s < seconds - 1e-9; s += dt) {
		const a = at(s);
		const step = stepDrillCut(cut, {
			key: a.key,
			powered: a.powered ?? true,
			spin: 1,
			rateTPerS: DRILL.rateTPerS,
			dt,
			holdFreeT: (a.holdFreeT ?? 1e9) - tonnes,
			reserveLeftT: (a.reserveLeftT ?? 1e9) - tonnes,
		});
		cut = step.cut;
		tonnes += step.tonnes;
		if (step.stop) stops.add(step.stop);
	}
	return { cut, tonnes, stops };
};

describe("extraction and conservation", () => {
	test("held contact delivers whole tonnes at the rate", () => {
		const { tonnes } = run(10.1, () => ({ key: "rock:a:1" }));
		expect(tonnes).toBe(Math.floor(10 * DRILL.rateTPerS));
	});

	test("no contact, no output: and partial progress is dropped when contact is lost", () => {
		expect(run(10, () => ({ key: null })).tonnes).toBe(0);
		const burstS = 0.9 / DRILL.rateTPerS;
		const flicker = run(10 * (burstS + 1), (s) => ({
			key: s % (burstS + 1) < burstS ? "rock:a:1" : null,
		}));
		expect(flicker.tonnes).toBe(0);
		const lost = stepDrillCut(
			{ key: "rock:a:1", progressT: 0.9 },
			{
				key: null,
				powered: true,
				spin: 1,
				rateTPerS: 1,
				dt: 1,
				holdFreeT: 10,
				reserveLeftT: 10,
			},
		);
		expect(lost.tonnes).toBe(0);
		expect(lost.cut.progressT).toBe(0);
	});

	test("no power, no output", () => {
		const r = run(10, () => ({ key: "rock:a:1", powered: false }));
		expect(r.tonnes).toBe(0);
		expect(r.stops.has("NO POWER")).toBe(true);
	});

	test("a full hold stops the drill exactly at capacity", () => {
		const r = run(30, () => ({ key: "rock:a:1", holdFreeT: 3 }));
		expect(r.tonnes).toBe(3);
		expect(r.stops.has("HOLD FULL")).toBe(true);
	});

	test("a depleted deposit stops the drill at the reserve", () => {
		const r = run(30, () => ({ key: "rock:a:1", reserveLeftT: 4 }));
		expect(r.tonnes).toBe(4);
		expect(r.stops.has("DEPLETED")).toBe(true);
	});

	test("moving to another rock starts over", () => {
		const s = stepDrillCut(
			{ key: "rock:a:1", progressT: 0.9 },
			{
				key: "rock:a:2",
				powered: true,
				spin: 1,
				rateTPerS: 0.05,
				dt: 1,
				holdFreeT: 10,
				reserveLeftT: 10,
			},
		);
		expect(s.tonnes).toBe(0);
		expect(s.cut).toEqual({ key: "rock:a:2", progressT: 0.05 });
	});
});

describe("the deep debit", () => {
	test("debits deep tonnes and rebases the surface debit to now", () => {
		const row = { surface: 5, at: 0 };
		const t = 3600 * 2;
		const next = debitDeep(row, t, 7);
		expect(next.deep).toBe(7);
		expect(next.at).toBe(t);
		expect(next.surface).toBe(debitAt(5, 0, t));
		expect(debitDeep(next, t, 3).deep).toBe(10);
	});

	test("what the hold gains is what the deposit loses", () => {
		const r = run(17, () => ({ key: "rock:a:1" }));
		const row = debitDeep(undefined, 100, r.tonnes);
		expect(row.deep).toBe(r.tonnes);
	});
});

describe("energy and heat", () => {
	test("the drill draws from the shared bank and heats the shared gauge, and does no damage", () => {
		const c = fullCondition("miner");
		const s = stepCondition(c, 1, true, DRILL_RATES);
		expect(s.fired).toBe(true);
		expect(s.damage).toBe(0);
		expect(s.condition.energy).toBeCloseTo(c.energy - DRILL.energyPerS, 9);
		expect(s.condition.heat).toBeCloseTo(c.heat + DRILL.heatPerS, 9);
	});

	test("an empty bank leaves the drill unpowered", () => {
		const c = { ...fullCondition("miner"), energy: 0 };
		expect(stepCondition(c, 1, true, DRILL_RATES).fired).toBe(false);
	});
});
