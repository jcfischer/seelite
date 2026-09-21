/**
 * A carrier's standing and its manifest (`carrier-identity.md` §2–§3, with
 * `civilian-combat.md` H1, H11 and H12): pure functions of the system seed,
 * the carrier key, the instance and the clock or voyage.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { carrierManifest, MANIFEST_LINES } from "../src/carrier-manifest";
import {
	carrierStanding,
	STANDING_ROTATION_S,
	STANDING_SHARES,
} from "../src/carrier-standing";
import { COMMODITIES } from "../src/market";

const KEYS = Array.from({ length: 400 }, (_, i) =>
	carrierKey(i % 50, `station-trade/traffic-${String(i).padStart(3, "0")}`),
);
const SEED = 0x5ee11e;

describe("standing", () => {
	test("H12's starting forms", () => {
		expect(STANDING_SHARES).toEqual({ wanted: 0.12, fugitive: 0.03 });
		expect(STANDING_ROTATION_S).toBe(6 * 3600);
	});

	test("is deterministic at a clock", () => {
		for (const key of KEYS.slice(0, 20))
			expect(carrierStanding(SEED, key, 0, 12345)).toBe(
				carrierStanding(SEED, key, 0, 12345),
			);
	});

	test("reads the shares across a corpus, within sampling error", () => {
		const counts = { clean: 0, wanted: 0, fugitive: 0 };
		let n = 0;
		for (let s = 0; s < 25; s++)
			for (const key of KEYS) {
				counts[carrierStanding(SEED + s, key, 0, s * 7919)]++;
				n++;
			}
		expect(counts.fugitive / n).toBeGreaterThan(0.022);
		expect(counts.fugitive / n).toBeLessThan(0.038);
		expect(counts.wanted / n).toBeGreaterThan(0.105);
		expect(counts.wanted / n).toBeLessThan(0.135);
	});

	test("rotates, both ways", () => {
		let cleanToWanted = false;
		let wantedToClean = false;
		for (const key of KEYS) {
			const at = (t: number) => carrierStanding(SEED, key, 0, t);
			for (let t = 0; t < 10 * STANDING_ROTATION_S; t += STANDING_ROTATION_S) {
				const a = at(t);
				const b = at(t + STANDING_ROTATION_S);
				if (a === "clean" && b === "wanted") cleanToWanted = true;
				if (a === "wanted" && b === "clean") wantedToClean = true;
			}
		}
		expect(cleanToWanted).toBe(true);
		expect(wantedToClean).toBe(true);
	});

	test("holds from scan to kill: a two-minute window rarely spans a rotation (F7)", () => {
		let flips = 0;
		let n = 0;
		for (const key of KEYS)
			for (let t = 0; t < 4 * STANDING_ROTATION_S; t += 997) {
				if (
					carrierStanding(SEED, key, 0, t) !==
					carrierStanding(SEED, key, 0, t + 120)
				)
					flips++;
				n++;
			}
		// A fixed bound, not one derived from the period: a bound that scales
		// with STANDING_ROTATION_S passes at any period (sage #368). A window
		// flips at (120 s / period) × P(a redraw differs), and with 85/12/3 %
		// shares that probability is 1 − (0.85² + 0.12² + 0.03²) ≈ 0.262: about
		// 0.15 % at 6 h. The bound goes red at a period of about 2.9 h, and the
		// ~35,000 windows here put sampling noise near 0.02 %.
		expect(flips / n).toBeLessThan(0.003);
	});

	test("a replacement draws its own timeline (H1)", () => {
		let differs = 0;
		for (const key of KEYS)
			for (let t = 0; t < 20 * STANDING_ROTATION_S; t += STANDING_ROTATION_S)
				if (
					carrierStanding(SEED, key, 0, t) !== carrierStanding(SEED, key, 1, t)
				)
					differs++;
		expect(differs).toBeGreaterThan(0);
	});

	test("the rotation is phased per carrier, so a system does not flip at once", () => {
		const boundaries = new Set<number>();
		for (const key of KEYS.slice(0, 40)) {
			let prev = carrierStanding(SEED, key, 0, 0);
			for (let t = 60; t <= 3 * STANDING_ROTATION_S; t += 60) {
				const now = carrierStanding(SEED, key, 0, t);
				if (now !== prev) boundaries.add(t);
				prev = now;
			}
		}
		expect(boundaries.size).toBeGreaterThan(3);
	});

	test("the system seed carries the galaxy: one key in two systems draws independently", () => {
		let differs = 0;
		for (const key of KEYS)
			if (
				carrierStanding(SEED, key, 0, 0) !==
				carrierStanding(SEED + 1, key, 0, 0)
			)
				differs++;
		expect(differs).toBeGreaterThan(0);
	});
});

describe("the manifest", () => {
	const hold = { holdT: 60, government: 3 };

	test("is deterministic for a voyage", () => {
		for (const key of KEYS.slice(0, 20))
			expect(carrierManifest(SEED, key, 0, 4, hold)).toEqual(
				carrierManifest(SEED, key, 0, 4, hold),
			);
	});

	test("has one to four lines of distinct tonne goods, within the hold (H11)", () => {
		const seenCounts = new Set<number>();
		for (const key of KEYS)
			for (const holdT of [6, 20, 60, 400]) {
				const lines = carrierManifest(SEED, key, 0, 1, {
					holdT,
					government: 3,
				});
				seenCounts.add(lines.length);
				expect(lines.length).toBeGreaterThanOrEqual(MANIFEST_LINES.min);
				expect(lines.length).toBeLessThanOrEqual(MANIFEST_LINES.max);
				expect(new Set(lines.map((l) => l.good)).size).toBe(lines.length);
				const total = lines.reduce((sum, l) => sum + l.tonnes, 0);
				expect(total).toBeLessThanOrEqual(holdT);
				for (const line of lines) {
					expect(Number.isInteger(line.tonnes)).toBe(true);
					expect(line.tonnes).toBeGreaterThanOrEqual(1);
					const good = COMMODITIES.find((c) => c.name === line.good);
					expect(good?.unit).toBe("t");
				}
			}
		expect([...seenCounts].sort()).toEqual([1, 2, 3, 4]);
	});

	test("a hold smaller than its line count keeps every line whole", () => {
		for (const key of KEYS) {
			const lines = carrierManifest(SEED, key, 0, 1, {
				holdT: 2,
				government: 3,
			});
			expect(lines.reduce((sum, l) => sum + l.tonnes, 0)).toBeLessThanOrEqual(
				2,
			);
			expect(lines.length).toBeLessThanOrEqual(2);
		}
	});

	test("changes between voyages and between instances", () => {
		let voyage = 0;
		let instance = 0;
		for (const key of KEYS) {
			const base = JSON.stringify(carrierManifest(SEED, key, 0, 1, hold));
			if (JSON.stringify(carrierManifest(SEED, key, 0, 2, hold)) !== base)
				voyage++;
			if (JSON.stringify(carrierManifest(SEED, key, 1, 1, hold)) !== base)
				instance++;
		}
		expect(voyage).toBeGreaterThan(KEYS.length / 2);
		expect(instance).toBeGreaterThan(KEYS.length / 2);
	});

	test("reads cargoWeights: a Corporate State's traffic carries no contraband", () => {
		for (const key of KEYS)
			for (const line of carrierManifest(SEED, key, 0, 1, {
				holdT: 60,
				government: 7,
			}))
				expect(
					COMMODITIES.find((c) => c.name === line.good)?.illegal,
				).toBeFalsy();
	});

	test("an Anarchy's traffic sometimes does", () => {
		const illegal = KEYS.some((key) =>
			carrierManifest(SEED, key, 0, 1, { holdT: 60, government: 0 }).some(
				(line) => COMMODITIES.find((c) => c.name === line.good)?.illegal,
			),
		);
		expect(illegal).toBe(true);
	});
});
