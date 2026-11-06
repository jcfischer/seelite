import { describe, expect, test } from "bun:test";
import type { HullCutter } from "../src/hull";
import { anchorAssembly, anchorPose, MINING } from "../src/longwall-drill-rig";
import {
	ANCHOR,
	anchorAllowed,
	DRILL,
	drillContact,
	drillFaceKm,
	FINE,
	fineDemand,
	fineReadout,
	longwallFrame,
	rescaleThrottle,
	seatBlend,
	seatPose,
	shipFrameM,
	shipPointKm,
	STRUT_REACH_SHARE,
	stepDrillCut,
	stepDrillSurface,
	stepFeed,
	strutPose,
	strutReach,
	debitDeep,
	type DrillContactInput,
} from "../src/rock-drill";
import { ASSIST_CAP_KMS } from "../src/sim";
import { dot, length, v3 } from "../src/vec3";

const C: HullCutter = {
	radiusKm: 0.01,
	downKm: 0.003,
	bowKm: 0.02,
	feedTravelKm: 0.01,
};
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("stepFeed", () => {
	test("a frame moves the feed by dt over the deploy time, toward out or stowed", () => {
		near(stepFeed(0, true, 1, 1, C), 1 / DRILL.deployS);
		near(stepFeed(0.5, false, 1, 1, C), 0.5 - 1 / DRILL.deployS);
		expect(stepFeed(0.1, false, 6, 1, C)).toBe(0);
	});

	test("a negative dt moves nothing in either direction", () => {
		expect(stepFeed(0.5, true, -3, 1, C)).toBe(0.5);
		expect(stepFeed(0.5, false, -3, 1, C)).toBe(0.5);
	});

	test("room ahead limits the feed to what the margin leaves", () => {
		expect(stepFeed(0.4, true, 6, 0.0055, C)).toBeCloseTo(0.5, 9);
		expect(stepFeed(0, true, 6, 100, C)).toBe(1);
		expect(stepFeed(0, true, 6, -1, C)).toBe(0);
	});

	test("a feed already past the limit holds where it is", () => {
		expect(stepFeed(0.8, true, 1, 0.0055, C)).toBe(0.8);
	});
});

describe("drillFaceKm", () => {
	test("the face is the bow plus the fed travel along the nose, down along up", () => {
		const f = drillFaceKm(v3(1, 2, 3), v3(1, 0, 0), v3(0, 1, 0), C, 0.5);
		near(f.x, 1.025);
		near(f.y, 1.997);
		near(f.z, 3);
	});
});

describe("drillContact", () => {
	const input = (over: Partial<DrillContactInput> = {}): DrillContactInput => ({
		extension: 1,
		nose: v3(0, 0, -1),
		faceVel: v3(),
		hit: { point: v3(0, 0, -1), normal: v3(0, 0, 1), distKm: 0.001 },
		surfaceVel: v3(),
		rockCentre: v3(),
		deepMouth: null,
		...over,
	});
	const hit = (distKm: number) => ({
		point: v3(0, 0, -1),
		normal: v3(0, 0, 1),
		distKm,
	});

	test("a stowed or part-fed cutter reports only why, with every fact null", () => {
		const none = {
			gapKm: null,
			alignDeg: null,
			closingKms: null,
			slideKms: null,
			mouthDeg: null,
			deposit: null,
		};
		expect(drillContact(input({ extension: 0 }))).toStrictEqual({
			block: "STOWED",
			...none,
		});
		expect(drillContact(input({ extension: 0.5 }))).toStrictEqual({
			block: "DEPLOYING",
			...none,
		});
		expect(drillContact(input({ hit: null }))).toStrictEqual({
			block: "NO ROCK",
			...none,
		});
	});

	test("reach is blocked past contactKm and open at it", () => {
		expect(drillContact(input({ hit: hit(DRILL.contactKm) })).block).toBeNull();
		expect(
			drillContact(input({ hit: hit(DRILL.contactKm + 1e-9) })).block,
		).toBe("OUT OF REACH");
	});

	test("closing speed is blocked past closingKms and open at it", () => {
		const at = drillContact(input({ faceVel: v3(0, 0, -DRILL.closingKms) }));
		expect(at.closingKms).toBe(DRILL.closingKms);
		expect(at.block).toBeNull();
		expect(
			drillContact(input({ faceVel: v3(0, 0, -DRILL.closingKms - 1e-6) }))
				.block,
		).toBe("CLOSING");
	});

	test("opening away from the surface is not closing", () => {
		const c = drillContact(input({ faceVel: v3(0, 0, 0.01) }));
		expect(c.closingKms).toBe(0);
		expect(c.block).toBeNull();
	});

	test("slide speed is blocked past slideKms and open at it", () => {
		const at = drillContact(input({ faceVel: v3(DRILL.slideKms, 0, 0) }));
		expect(at.slideKms).toBe(DRILL.slideKms);
		expect(at.block).toBeNull();
		expect(
			drillContact(input({ faceVel: v3(DRILL.slideKms + 1e-6, 0, 0) })).block,
		).toBe("SLIDING");
	});

	test("the surface's own velocity is subtracted from the face's", () => {
		const c = drillContact(
			input({
				faceVel: v3(0.5, 0, -0.5),
				surfaceVel: v3(0.5, 0, -0.5 + 0.001),
			}),
		);
		near(c.closingKms as number, 0.001);
		near(c.slideKms as number, 0);
	});

	test("alignment is the angle between the nose and the surface normal", () => {
		const tilt = (deg: number) => {
			const r = (deg * Math.PI) / 180;
			return v3(Math.sin(r), 0, Math.cos(r));
		};
		const ok = drillContact(
			input({ hit: { ...hit(0.001), normal: tilt(19.9) } }),
		);
		expect(ok.alignDeg).toBeCloseTo(19.9, 6);
		expect(ok.block).toBeNull();
		expect(
			drillContact(input({ hit: { ...hit(0.001), normal: tilt(20.1) } })).block,
		).toBe("ALIGN");
	});

	test("the first failing gate names the block: reach, then align, closing, sliding", () => {
		const r = (20.1 * Math.PI) / 180;
		const slanted = v3(Math.sin(r), 0, Math.cos(r));
		const all = input({
			faceVel: v3(0.1, 0, -0.1),
			hit: { point: v3(0, 0, -1), normal: slanted, distKm: 0.1 },
		});
		expect(drillContact(all).block).toBe("OUT OF REACH");
		expect(
			drillContact({ ...all, hit: { ...all.hit!, distKm: 0.001 } }).block,
		).toBe("ALIGN");
		expect(drillContact({ ...all, hit: hit(0.001) }).block).toBe("CLOSING");
		expect(
			drillContact({ ...all, hit: hit(0.001), faceVel: v3(0.1, 0, 0) }).block,
		).toBe("SLIDING");
	});

	test("a hit within the mouth cone of a deep deposit is deep, outside it surface", () => {
		const at = (deg: number) => {
			const r = (deg * Math.PI) / 180;
			return v3(Math.sin(r), 0, Math.cos(r));
		};
		const deep = drillContact(
			input({
				deepMouth: v3(0, 0, 1),
				hit: { ...hit(0.001), point: at(11.9) },
			}),
		);
		expect(deep.deposit).toBe("deep");
		expect(deep.mouthDeg).toBeCloseTo(11.9, 6);
		const side = drillContact(
			input({
				deepMouth: v3(0, 0, 1),
				hit: { ...hit(0.001), point: at(12.1) },
			}),
		);
		expect(side.deposit).toBe("surface");
		expect(side.mouthDeg).toBeCloseTo(12.1, 6);
		expect(drillContact(input()).deposit).toBe("surface");
		expect(drillContact(input()).mouthDeg).toBeNull();
	});

	test("the mouth angle is measured from the rock's centre", () => {
		const c = drillContact(
			input({
				rockCentre: v3(10, 0, 0),
				deepMouth: v3(0, 0, 1),
				hit: { ...hit(0.001), point: v3(10, 0, 5) },
			}),
		);
		near(c.mouthDeg as number, 0);
	});
});

describe("stepDrillCut", () => {
	const run = (over: Partial<Parameters<typeof stepDrillCut>[1]> = {}) =>
		stepDrillCut(
			{ key: "r", progressT: 0 },
			{
				key: "r",
				powered: true,
				spin: 1,
				rateTPerS: 1,
				dt: 1,
				holdFreeT: 100,
				reserveLeftT: 100,
				...over,
			},
		);

	test("progress is rate times spin times dt", () => {
		const s = run({ rateTPerS: 0.6, spin: 0.5, dt: 3 });
		expect(s.tonnes).toBe(0);
		near(s.cut.progressT, 0.9);
	});

	test("spin is clamped to 0…1 and a negative rate adds nothing", () => {
		near(run({ spin: 7, rateTPerS: 0.4 }).cut.progressT, 0.4);
		near(run({ spin: -7, rateTPerS: 0.4 }).cut.progressT, 0);
		near(run({ rateTPerS: -4 }).cut.progressT, 0);
	});

	test("whole tonnes are taken and the remainder carries", () => {
		const s = run({ rateTPerS: 2.5, dt: 4 });
		expect(s.tonnes).toBe(10);
		near(s.cut.progressT, 0);
		const t = run({ rateTPerS: 0.7, dt: 4 });
		expect(t.tonnes).toBe(2);
		near(t.cut.progressT, 0.8);
	});

	test("output never passes the free hold or the reserve, in whole tonnes", () => {
		const held = run({ rateTPerS: 10, holdFreeT: 2.7, reserveLeftT: 5 });
		expect(held.tonnes).toBe(2);
		near(held.cut.progressT, 8);
		const reserve = run({ rateTPerS: 10, holdFreeT: 9, reserveLeftT: 2.7 });
		expect(reserve.tonnes).toBe(2);
		expect(run({ rateTPerS: 10, holdFreeT: 2, reserveLeftT: 5 }).tonnes).toBe(
			2,
		);
		expect(run({ rateTPerS: 10, holdFreeT: 5, reserveLeftT: 2 }).tonnes).toBe(
			2,
		);
	});

	test("no contact drops the progress; a new rock restarts it", () => {
		const lost = stepDrillCut(
			{ key: "r", progressT: 0.9 },
			{
				key: null,
				powered: true,
				spin: 1,
				rateTPerS: 1,
				dt: 1,
				holdFreeT: 9,
				reserveLeftT: 9,
			},
		);
		expect(lost).toStrictEqual({
			cut: { key: null, progressT: 0 },
			tonnes: 0,
			stop: null,
		});
		const other = stepDrillCut(
			{ key: "old", progressT: 0.9 },
			{
				key: "new",
				powered: true,
				spin: 1,
				rateTPerS: 0.5,
				dt: 1,
				holdFreeT: 9,
				reserveLeftT: 9,
			},
		);
		expect(other.cut.key).toBe("new");
		near(other.cut.progressT, 0.5);
	});

	test("stops freeze the progress and say why, in order", () => {
		const cut = { key: "r", progressT: 0.4 };
		const a = {
			key: "r",
			powered: true,
			spin: 1,
			rateTPerS: 1,
			dt: 1,
			holdFreeT: 9,
			reserveLeftT: 9,
		};
		expect(stepDrillCut(cut, { ...a, powered: false, holdFreeT: 0 })).toEqual({
			cut,
			tonnes: 0,
			stop: "NO POWER",
		});
		expect(
			stepDrillCut(cut, { ...a, holdFreeT: 0.99, reserveLeftT: 0 }),
		).toEqual({
			cut,
			tonnes: 0,
			stop: "HOLD FULL",
		});
		expect(stepDrillCut(cut, { ...a, reserveLeftT: 0.99 })).toEqual({
			cut,
			tonnes: 0,
			stop: "DEPLETED",
		});
		expect(
			stepDrillCut(cut, { ...a, holdFreeT: 1, reserveLeftT: 1 }).stop,
		).toBeNull();
	});
});

describe("debitDeep", () => {
	test("a fresh deposit carries only what was taken and when", () => {
		expect(debitDeep(undefined, 100, 1)).toStrictEqual({ deep: 1, at: 100 });
	});

	test("both debits rebase to the new time, recovering an hour at a time", () => {
		const row = debitDeep({ surface: 3, deep: 1, at: 0 }, 7200, 2);
		expect(row).toStrictEqual({ surface: 1, deep: 2, at: 7200 });
	});

	test("a row with no surface debit gains none", () => {
		const row = debitDeep({ deep: 4, at: 0 }, 0, 1);
		expect(row).toStrictEqual({ deep: 5, at: 0 });
	});
});

describe("stepDrillSurface", () => {
	const fresh = { key: null, oreT: 0, wasteT: 0 };
	const a = {
		key: "r",
		powered: true,
		spin: 1,
		rateTPerS: 2,
		dt: 1,
		holdFreeT: 10,
		reserveLeftT: 10,
	};

	test("a frame cuts half ore and half waste, in whole tonnes", () => {
		expect(stepDrillSurface(fresh, a)).toStrictEqual({
			cut: { key: "r", oreT: 0, wasteT: 0 },
			ore: 1,
			waste: 1,
			stop: null,
		});
	});

	test("no power freezes the cut, ahead of every other stop", () => {
		expect(
			stepDrillSurface(fresh, { ...a, powered: false, holdFreeT: 0 }),
		).toStrictEqual({ cut: fresh, ore: 0, waste: 0, stop: "NO POWER" });
	});

	test("a hold with under a tonne free is full, and one tonne is not", () => {
		expect(stepDrillSurface(fresh, { ...a, holdFreeT: 0.9 })).toStrictEqual({
			cut: fresh,
			ore: 0,
			waste: 0,
			stop: "HOLD FULL",
		});
		expect(stepDrillSurface(fresh, { ...a, holdFreeT: 1 }).stop).toBeNull();
	});

	test("the rotor's spin scales the rate, clamped to 0…1", () => {
		expect(stepDrillSurface(fresh, { ...a, rateTPerS: 4, spin: 0.5 }).ore).toBe(
			1,
		);
		expect(stepDrillSurface(fresh, { ...a, rateTPerS: 2, spin: 9 }).ore).toBe(
			1,
		);
		expect(stepDrillSurface(fresh, { ...a, spin: -1 })).toStrictEqual({
			cut: fresh,
			ore: 0,
			waste: 0,
			stop: null,
		});
	});

	test("ore into the hold never passes its whole free tonnes", () => {
		expect(
			stepDrillSurface(fresh, { ...a, rateTPerS: 6, holdFreeT: 1.9 }).ore,
		).toBe(1);
		expect(
			stepDrillSurface(fresh, { ...a, rateTPerS: 2, holdFreeT: 5 }).ore,
		).toBe(1);
	});

	test("an empty deposit yields only waste and says it is depleted", () => {
		expect(stepDrillSurface(fresh, { ...a, reserveLeftT: 0 })).toStrictEqual({
			cut: { key: "r", oreT: 0, wasteT: 0 },
			ore: 0,
			waste: 2,
			stop: "DEPLETED",
		});
	});
});

describe("fine control scaling", () => {
	test("demand scales each axis from the assist cap to its fine cap", () => {
		const f = fineDemand({ surge: 1, sway: -0.5, heave: 0.25 });
		near(f.surge, FINE.surgeCapKms / ASSIST_CAP_KMS);
		near(f.sway, (-0.5 * FINE.strafeCapKms) / ASSIST_CAP_KMS);
		near(f.heave, (0.25 * FINE.strafeCapKms) / ASSIST_CAP_KMS);
	});

	test("a lever asks the same speed under the other cap, kept between 0 and 1", () => {
		near(rescaleThrottle(0.5, 1, 2), 0.25);
		near(rescaleThrottle(0.5, 0.01, 2), 0.0025);
		expect(rescaleThrottle(0.5, 2, 0.01)).toBe(1);
		expect(rescaleThrottle(-0.5, 1, 1)).toBe(0);
	});

	test("the readout splits the face's relative speed along and across the nose", () => {
		const r = fineReadout(v3(0, 0, -1), v3(1, 2, -3), v3(0, 0, -1), 0.25);
		expect(r.rangeKm).toBe(0.25);
		near(r.closingKms, 2);
		near(r.slideKms, Math.sqrt(5));
		expect(fineReadout(v3(0, 0, -1), v3(), v3(), null).rangeKm).toBeNull();
	});
});

describe("frames", () => {
	test("the export's metres map to the ship frame by the cutter and back", () => {
		const frame = longwallFrame(C);
		const p = frame.toShip([1, 2, 3]);
		near(p.fore, 3 + 20 - (MINING.stowedCutterZ + MINING.toothReach));
		near(p.up, 2 - 3 - MINING.cutterY);
		near(p.starboard, -1);
		const back = frame.toExport(p);
		near(back[0], 1);
		near(back[1], 2);
		near(back[2], 3);
		const lower = longwallFrame({ ...C, downKm: 0.005 });
		near(lower.toShip([0, 0, 0]).up, -5 - MINING.cutterY);
	});

	test("a ship-frame point in metres lands in the world in km, and back", () => {
		const pos = v3(1, 1, 1);
		const nose = v3(0, 0, -1);
		const up = v3(0, 1, 0);
		const w = shipPointKm(pos, nose, up, {
			fore: 1000,
			up: 2000,
			starboard: 3000,
		});
		near(w.x, 4);
		near(w.y, 3);
		near(w.z, 0);
		const back = shipFrameM(pos, nose, up, w);
		near(back.fore, 1000);
		near(back.up, 2000);
		near(back.starboard, 3000);
	});
});

describe("struts", () => {
	const SIGN = [
		[-1, 1],
		[1, 1],
		[-1, -1],
		[1, -1],
	];

	test("each strut reaches its study foot aimed at the cutter's face plane", () => {
		SIGN.forEach(([sx, sy], i) => {
			const r = strutReach(i);
			expect(r.base).toEqual([sx * 6, sy * 2, 13]);
			expect(r.foot).toEqual([sx * 17, MINING.cutterY + sy * 14, MINING.rockZ]);
			near(
				r.reachM,
				Math.hypot(
					sx * 11,
					MINING.cutterY + sy * 14 - sy * 2,
					MINING.rockZ - 13,
				) * STRUT_REACH_SHARE,
			);
		});
	});

	test("a posed strut is the study's assembly toward the target found", () => {
		const target: [number, number, number] = [12, 3, 44];
		const p = strutPose(1, 0.5, target);
		const a = anchorAssembly(1, 0.5, target);
		expect(p).toEqual({
			deployment: 0.5,
			base: a.base,
			foot: a.foot,
			elbow: a.elbow,
		});
		expect(Object.keys(p).sort()).toEqual([
			"base",
			"deployment",
			"elbow",
			"foot",
		]);
	});

	test("deployment is clamped to 0…1, stowed ignoring the target and deployed meeting it", () => {
		const target: [number, number, number] = [12, 3, 44];
		const lo = strutPose(0, -5, target);
		expect(lo.deployment).toBe(0);
		expect(lo.foot).toEqual(anchorPose(0, 0).foot);
		const hi = strutPose(0, 5, target);
		expect(hi.deployment).toBe(1);
		expect(hi.foot).toEqual(target);
	});
});

describe("anchorAllowed", () => {
	const ok = { extension: 1, faceGapKm: 0.01, feetOnRock: 0, relKms: 0.01 };

	test("a part-fed cutter cannot anchor, whatever else is true", () => {
		expect(anchorAllowed({ ...ok, extension: 0.99, relKms: 9 })).toBe(
			"DEPLOYING",
		);
		expect(anchorAllowed(ok)).toBe("OK");
	});

	test("with no foot on rock the face must be within reach, inclusive", () => {
		expect(anchorAllowed({ ...ok, faceGapKm: null })).toBe("NO ROCK IN REACH");
		expect(anchorAllowed({ ...ok, faceGapKm: ANCHOR.reachKm })).toBe("OK");
		expect(anchorAllowed({ ...ok, faceGapKm: ANCHOR.reachKm + 1e-6 })).toBe(
			"NO ROCK IN REACH",
		);
	});

	test("a foot on rock anchors with the face far or unseen", () => {
		expect(anchorAllowed({ ...ok, feetOnRock: 1, faceGapKm: null })).toBe("OK");
		expect(anchorAllowed({ ...ok, feetOnRock: 2, faceGapKm: 9 })).toBe("OK");
	});

	test("rock out of reach is reported ahead of speed; speed is inclusive at the limit", () => {
		expect(anchorAllowed({ ...ok, faceGapKm: null, relKms: 9 })).toBe(
			"NO ROCK IN REACH",
		);
		expect(anchorAllowed({ ...ok, relKms: ANCHOR.maxKms })).toBe("OK");
		expect(anchorAllowed({ ...ok, relKms: ANCHOR.maxKms + 1e-6 })).toBe(
			"TOO FAST",
		);
	});
});

describe("seatPose", () => {
	test("the ship sits nose into the surface with the cutter face a gap off it", () => {
		const s = seatPose(v3(0, 0, 10), v3(0, 0, 1), v3(0, 1, 0), C);
		near(s.nose.z, -1);
		near(s.up.y, 1);
		near(s.pos.x, 0);
		near(s.pos.y, C.downKm);
		near(s.pos.z, 10 + ANCHOR.gapKm + C.bowKm + C.feedTravelKm);
	});

	test("up is kept as near as it can be, square to the nose", () => {
		const s = seatPose(v3(), v3(0, 0, 1), v3(0, 1, 1), C);
		near(dot(s.up, s.nose), 0);
		near(length(s.up), 1);
		near(s.up.y, 1);
	});

	test("an up along the nose falls back to a world axis", () => {
		const flat = seatPose(v3(), v3(0, 0, 1), v3(0, 0, 1), C);
		near(flat.up.y, 1);
		near(flat.up.x, 0);
		const vertical = seatPose(v3(), v3(0, 1, 0), v3(0, 1, 0), C);
		near(vertical.up.x, 1);
		near(vertical.up.y, 0);
	});

	test("a nose just off vertical still falls back to the world's up", () => {
		const n = v3(0, 0.8, 0.6);
		const s = seatPose(v3(), n, n, C);
		near(s.up.y, 0.6);
		near(dot(s.up, s.nose), 0);
	});
});

describe("seatBlend", () => {
	test("eases in and out over 0…1 and clamps outside it", () => {
		expect(seatBlend(0)).toBe(0);
		expect(seatBlend(1)).toBe(1);
		near(seatBlend(0.5), 0.5);
		near(seatBlend(0.25), 0.15625);
		near(seatBlend(0.75), 0.84375);
		expect(seatBlend(-3)).toBe(0);
		expect(seatBlend(3)).toBe(1);
	});
});
