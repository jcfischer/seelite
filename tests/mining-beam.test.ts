import { describe, expect, test } from "bun:test";
import {
	impactRadiusPx,
	MINING_BEAM,
	miningBeamStrokes,
	miningBeamWidthPx,
	screenShare,
} from "../src/mining-beam";

const port = { x: 0.3, y: 0.9 };
const end = { x: 0.5, y: 0.5 };

describe("the mining beam", () => {
	test("runs from the port to the end, segment to segment", () => {
		const s = miningBeamStrokes([port], end, 1, true, 0);
		expect(s).toHaveLength(MINING_BEAM.segments);
		expect(s[0].from).toEqual(port);
		expect(s.at(-1)?.to.x).toBeCloseTo(end.x, 9);
		for (let k = 1; k < s.length; k++) expect(s[k].from).toEqual(s[k - 1].to);
	});

	test("thins with distance", () => {
		const s = miningBeamStrokes([port], end, 2, true, 0);
		for (let k = 1; k < s.length; k++)
			expect(s[k].widthPx).toBeLessThan(s[k - 1].widthPx);
		expect(miningBeamWidthPx(0)).toBeCloseTo(MINING_BEAM.widthNearPx, 9);
		expect(miningBeamWidthPx(1000)).toBeLessThan(MINING_BEAM.widthFarPx + 0.01);
	});

	test("puts the far half of its length in a sliver of the frame", () => {
		expect(screenShare(0.5, 1)).toBeGreaterThan(0.99);
		expect(screenShare(MINING_BEAM.portDepthKm, 1)).toBe(0);
		expect(screenShare(1, 1)).toBeCloseTo(1, 12);
	});

	test("pulses move along the beam", () => {
		const a = miningBeamStrokes([port], end, 1, true, 0).map((s) => s.alpha);
		const b = miningBeamStrokes([port], end, 1, true, 0.1).map((s) => s.alpha);
		expect(a).not.toEqual(b);
	});

	test("a miss fades out at the far end", () => {
		const s = miningBeamStrokes([port], end, 12, false, 0);
		expect(s.at(-1)?.alpha ?? 1).toBeLessThan(0.1);
	});

	test("the impact flare grows as the rock comes closer", () => {
		expect(impactRadiusPx(0.2, 1000)).toBeGreaterThan(impactRadiusPx(2, 1000));
		expect(impactRadiusPx(0.001, 1000)).toBe(40);
		expect(impactRadiusPx(100, 1000)).toBe(3);
	});
});
