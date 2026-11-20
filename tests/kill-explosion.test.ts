import { describe, expect, test } from "bun:test";
import {
	EXPLOSION_BASE_REACH_KM,
	EXPLOSION_FIREBALL,
	EXPLOSION_PARTICLES,
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

describe("the shape of every point, through its life", () => {
	const e = kill({ reachKm: 0.05 });
	const duration = explosionDurationS(e.reachKm);
	const cloud = explosionCloudKm(e.reachKm);
	const ages = [0, 0.1, 0.3, 0.7, 1.4, duration * 0.6, duration * 0.95];
	const at = (age: number) => explosionPoints(e, e.at + age);
	const radius = (p: { offset: [number, number, number] }) =>
		Math.hypot(...p.offset);
	const fireball = (age: number) => at(age).slice(1, 1 + EXPLOSION_FIREBALL);
	const debris = (age: number) => at(age).slice(1 + EXPLOSION_FIREBALL);

	test("a fighter's lasts three seconds, a hull four times its reach 4.2, and none past six", () => {
		expect(explosionDurationS(EXPLOSION_BASE_REACH_KM)).toBeCloseTo(3, 9);
		expect(explosionDurationS(4 * EXPLOSION_BASE_REACH_KM)).toBeCloseTo(4.2, 9);
		expect(explosionDurationS(100)).toBe(6);
		expect(explosionDurationS(0)).toBeGreaterThan(1.8);
		expect(explosionCloudKm(0.05)).toBeCloseTo(0.3, 12);
	});

	test("the flash is eight reaches wide at the kill, two once it has gone, at the centre", () => {
		const flash = (age: number) => at(age)[0];
		expect(flash(0).offset).toEqual([0, 0, 0]);
		expect(flash(0).sizeKm).toBeCloseTo(8 * e.reachKm, 6);
		expect(flash(0.15).sizeKm).toBeCloseTo(5 * e.reachKm, 6);
		expect(flash(0.3).sizeKm).toBeCloseTo(2 * e.reachKm, 6);
		expect(flash(1).sizeKm).toBeCloseTo(2 * e.reachKm, 6);
		expect(flash(0).heat[0]).toBeCloseTo(1.4, 6);
		expect(flash(0.15).heat[0]).toBeCloseTo(1.4 * 0.5 ** 1.5, 6);
		expect(flash(0).heat[1]).toBeCloseTo(1.4, 6);
		expect(flash(0).heat[2]).toBeCloseTo(1.4 * 0.85, 6);
	});

	test("the fireball grows to 1.2 reaches by a third of the life and its points swell with it", () => {
		const grown = 0.35 * duration;
		for (const age of ages) {
			const ball = Math.min(1, age / grown);
			const points = fireball(age);
			expect(points).toHaveLength(EXPLOSION_FIREBALL);
			for (const p of points) {
				expect(radius(p)).toBeLessThanOrEqual(1.2 * e.reachKm * ball + 1e-9);
				expect(p.sizeKm).toBeCloseTo(e.reachKm * (1.2 + 2.4 * ball), 6);
			}
			if (ball > 0)
				expect(Math.max(...points.map(radius))).toBeGreaterThan(
					0.7 * 1.2 * e.reachKm * ball,
				);
		}
	});

	test("the debris flies out to the cloud's radius, each point between three tenths and all of it", () => {
		for (const age of ages) {
			const spread = 1 - (1 - age / duration) ** 3;
			const points = debris(age);
			expect(points).toHaveLength(EXPLOSION_PARTICLES);
			for (const p of points) {
				expect(radius(p)).toBeGreaterThanOrEqual(0.3 * cloud * spread - 1e-6);
				expect(radius(p)).toBeLessThanOrEqual(cloud * spread + 1e-6);
				expect(p.sizeKm).toBeGreaterThanOrEqual(0.35 * e.reachKm - 1e-9);
				expect(p.sizeKm).toBeLessThanOrEqual(0.6 * e.reachKm + 1e-9);
			}
			if (age > 0) {
				const r = points.map(radius);
				expect(Math.max(...r)).toBeGreaterThan(0.9 * cloud * spread);
				expect(Math.min(...r)).toBeLessThan(0.4 * cloud * spread);
			}
		}
		const sizes = debris(1).map((p) => p.sizeKm);
		expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(
			0.2 * e.reachKm,
		);
	});

	test("the points leave in every direction, not along one axis", () => {
		const points = debris(1.4);
		for (const axis of [0, 1, 2]) {
			const values = points.map((p) => p.offset[axis] / radius(p));
			expect(Math.min(...values)).toBeLessThan(-0.8);
			expect(Math.max(...values)).toBeGreaterThan(0.8);
			const mean = values.reduce((s, v) => s + v, 0) / values.length;
			expect(Math.abs(mean)).toBeLessThan(0.25);
		}
	});

	test("a point cools from white through yellow to red, and fades", () => {
		for (const age of ages)
			for (const p of at(age).slice(1)) {
				const [r, g, b] = p.heat;
				expect(r).toBeGreaterThanOrEqual(g - 1e-9);
				expect(g).toBeGreaterThanOrEqual(b - 1e-9);
				expect(b).toBeGreaterThanOrEqual(0);
			}
		const first = debris(0)[0].heat;
		expect(first[0]).toBeCloseTo(1 - 0.35 * 0.15, 6);
		expect(first[1]).toBeCloseTo((1 - 0.55 * 0.15) ** 1.6, 6);
		expect(first[2]).toBeCloseTo(0.85 * 0.85 ** 3, 6);
		const ball = fireball(0)[0].heat;
		expect(ball[0]).toBeCloseTo(1 - 0.35 * 0.2, 6);
		const mid = fireball(duration / 2)[0].heat;
		expect(mid[0]).toBeCloseTo(0.5 ** 1.4 * (1 - 0.35 * 0.6), 6);
		expect(mid[2]).toBeCloseTo(0.5 ** 1.4 * 0.4 ** 3 * 0.85, 6);
		const late = debris(duration * 0.95)[0].heat;
		expect(late[0]).toBeLessThan(0.01);
		expect(late[2]).toBeCloseTo(0, 6);
	});

	test("two kills with different keys scatter their debris differently", () => {
		const other = explosionPoints(
			kill({ reachKm: 0.05, key: "other" }),
			e.at + 1,
		);
		expect(other.slice(1).map((p) => p.offset)).not.toEqual(
			at(1)
				.slice(1)
				.map((p) => p.offset),
		);
	});
});
