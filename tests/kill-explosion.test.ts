import { expect, test } from "bun:test";
import {
	EXPLOSION_POINTS,
	type KillExplosion,
	explosionCentre,
	explosionCloudKm,
	explosionDurationS,
	explosionLive,
	explosionPoints,
} from "../src/kill-explosion";
import { HULL_REACH_KM } from "../src/ship-mesh";
import { codeOf, methodBodyOf } from "./lib/source-scan";

const kill = (over: Partial<KillExplosion> = {}): KillExplosion => ({
	key: "raider:7:0",
	at: 100,
	pos: { x: 10, y: -4, z: 2 },
	vel: { x: 0.3, y: 0, z: -0.1 },
	reachKm: HULL_REACH_KM.raider,
	...over,
});

test("every kill path in Game plays the explosion cue only with the explosion drawn", () => {
	const main = codeOf("src/main.ts");
	expect(main.match(/kind: "explosion"/g)?.length).toBe(1);
	const detonate = methodBodyOf(main, "detonate", "src/main.ts");
	expect(detonate).toContain('kind: "explosion"');
	expect(detonate).toContain("this.killExplosions.start(");
	for (const path of [
		"scrapTrafficCarrier",
		"endEncounter",
		"stepRelay",
		"stepTender",
	])
		expect(methodBodyOf(main, path, "src/main.ts")).toContain("this.detonate(");
});

test("an explosion scales with the hull: a carrier's is bigger and longer than a fighter's", () => {
	const fighter = HULL_REACH_KM.interceptor;
	const trader = HULL_REACH_KM.freighter;
	const carrier = HULL_REACH_KM.carrier;
	expect(explosionCloudKm(trader)).toBeGreaterThan(explosionCloudKm(fighter));
	expect(explosionCloudKm(carrier)).toBeGreaterThan(explosionCloudKm(trader));
	expect(explosionDurationS(trader)).toBeGreaterThan(
		explosionDurationS(fighter),
	);
	expect(explosionDurationS(carrier)).toBeGreaterThan(
		explosionDurationS(trader),
	);
	const at = (reachKm: number) =>
		Math.max(
			...explosionPoints(kill({ reachKm }), 101).map((p) =>
				Math.hypot(...p.offset),
			),
		);
	expect(at(carrier)).toBeGreaterThan(at(fighter));
});

test("the wreck's centre keeps the velocity it died with", () => {
	const e = kill();
	expect(explosionCentre(e, 100)).toEqual(e.pos);
	const later = explosionCentre(e, 102);
	expect(later.x).toBeCloseTo(10.6, 9);
	expect(later.z).toBeCloseTo(1.8, 9);
});

test("it is drawn from the kill's frame to its end, and nothing after", () => {
	const e = kill();
	const end = e.at + explosionDurationS(e.reachKm);
	expect(explosionLive(e, e.at - 0.01)).toBe(false);
	expect(explosionPoints(e, e.at)).toHaveLength(EXPLOSION_POINTS);
	expect(explosionLive(e, end - 0.01)).toBe(true);
	expect(explosionLive(e, end)).toBe(false);
	expect(explosionPoints(e, end)).toEqual([]);
});

test("the flash is brightest on the kill's frame and gone within a second", () => {
	const e = kill();
	const flash = (t: number) => explosionPoints(e, t)[0].heat[0];
	expect(flash(100)).toBeGreaterThan(flash(100.1));
	expect(flash(101)).toBe(0);
});

test("the same clock draws the same frame, and the debris cools and fades", () => {
	const e = kill();
	expect(explosionPoints(e, 101.2)).toEqual(explosionPoints(e, 101.2));
	const glow = (t: number) =>
		explosionPoints(e, t)
			.slice(1)
			.reduce((s, p) => s + p.heat[0] + p.heat[1] + p.heat[2], 0);
	expect(glow(100.2)).toBeGreaterThan(glow(101));
	expect(glow(101)).toBeGreaterThan(
		glow(e.at + explosionDurationS(e.reachKm) - 0.05),
	);
});
