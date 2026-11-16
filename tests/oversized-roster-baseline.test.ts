import { afterAll, describe, expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { stationTrafficRoster } from "../src/station-traffic";
import { generateContents } from "../src/system";
import { GALAXY_COUNT, carrierBaselineFingerprint } from "../src/world-state";
import { roundUp01 } from "../scripts/measure-oversized-hulls";

const SEED = 0x5ee11e;
const PILGRIM_SWEPT = { lengthKm: 0.0739, beamKm: 0.0846, heightKm: 0.0846 };
const OLD = { ...HULL_SPECS.explorer.env };
const GOLDEN = [
	3184663648, 3983124722, 918239107, 2449049888, 233068355, 396838080,
	3072036612, 2535047707,
];

const setExplorer = (env: typeof OLD) => {
	(HULL_SPECS.explorer as { env: typeof OLD }).env = { ...env };
};
afterAll(() => setExplorer(OLD));

const hulls = () => {
	const m = new Map<string, string>();
	for (let g = 0; g < GALAXY_COUNT; g++)
		for (const r of generateGalaxy(SEED, g).systems)
			for (const s of generateContents(r).stations)
				for (const a of stationTrafficRoster(r.index, s))
					m.set(`${g}:${a.key}`, a.hullId);
	return m;
};

describe("node #1239: what the swept Pilgrim does to Traffic identity", () => {
	test("rounding is up to 0.1 m and refuses non-finite input", () => {
		expect(roundUp01(0.08454516)).toBe(0.0846);
		expect(roundUp01(0.0846)).toBe(0.0846);
		expect(Number.isFinite(roundUp01(Number.NaN))).toBe(false);
	});

	test("the named base reproduces the pinned fingerprints and the explorer census", () => {
		setExplorer(OLD);
		const before = hulls();
		expect(before.size).toBe(19114);
		expect([...before.values()].filter((h) => h === "explorer").length).toBe(
			1999,
		);
		expect(
			Array.from({ length: GALAXY_COUNT }, (_, g) =>
				carrierBaselineFingerprint(SEED, g),
			),
		).toEqual(GOLDEN);
	});

	test("the frozen identity baseline keeps every hull and fingerprint when the Pilgrim's envelope grows", () => {
		setExplorer(OLD);
		const before = hulls();
		setExplorer(PILGRIM_SWEPT);
		const after = hulls();
		expect(after.size).toBe(before.size);
		let moved = 0;
		for (const [k, h] of before) if (after.get(k) !== h) moved++;
		expect(moved).toBe(0);
		expect([...after.values()].filter((h) => h === "explorer").length).toBe(
			1999,
		);
		const fp = Array.from({ length: GALAXY_COUNT }, (_, g) =>
			carrierBaselineFingerprint(SEED, g),
		);
		expect(fp).toEqual(GOLDEN);
		setExplorer(OLD);
	});
});
