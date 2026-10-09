import { describe, test, expect } from "bun:test";
import { planInterior, overlaps, THEMES } from "./layout";
describe("modular four-face interior", () => {
	test("catalogue is preserved and all fittings clear ships and lane", () => {
		for (const role of ["trade", "shipyard"] as const)
			for (const theme of THEMES)
				for (let seed = 0; seed < 32; seed++) {
					const p = planInterior(theme.id, role, seed);
					expect(p.berths.length).toBe(role === "trade" ? 8 : 6);
					for (let i = 0; i < p.fittings.length; i++)
						for (let j = i + 1; j < p.fittings.length; j++)
							expect(overlaps(p.fittings[i].bounds, p.fittings[j].bounds)).toBe(
								false,
							);
					for (const f of p.fittings) {
						expect(overlaps(f.bounds, p.lane)).toBe(false);
						for (const b of p.berths) {
							expect(overlaps(f.bounds, b.bounds)).toBe(false);
							// Conservative full roll envelope swept from axial staging to the berth.
							const r = Math.hypot(b.size[0], b.size[1]) / 2;
							const sweep = {
								min: [
									Math.min(0, b.centre[0]) - r,
									Math.min(0, b.centre[1]) - r,
									Math.min(p.stagingZ, b.centre[2]) - b.size[2] / 2,
								] as [number, number, number],
								max: [
									Math.max(0, b.centre[0]) + r,
									Math.max(0, b.centre[1]) + r,
									Math.max(p.stagingZ, b.centre[2]) + b.size[2] / 2,
								] as [number, number, number],
							};
							expect(overlaps(f.bounds, sweep)).toBe(false);
						}
						expect(
							f.bounds.min.every((v, i) => v >= p.volume.min[i] - 0.001),
						).toBe(true);
						expect(
							f.bounds.max.every((v, i) => v <= p.volume.max[i] + 0.001),
						).toBe(true);
					}
				}
	});
	test("same identity repeats, seeds change actual fitting geometry", () => {
		const a = planInterior("civic", "trade", 41),
			b = planInterior("civic", "trade", 42);
		expect(a).toEqual(planInterior("civic", "trade", 41));
		expect(a.fittings).not.toEqual(b.fittings);
		for (const type of ["command", "loading", "gangway"])
			expect(a.fittings.some((f) => f.kind === type)).toBe(true);
	});
	test("parked normal faces the lane and every nose faces the aperture", () => {
		const p = planInterior("works", "trade", 0);
		for (const b of p.berths) {
			expect(b.nose).toEqual([0, 0, 1]);
			expect(
				b.centre[0] * b.normal[0] + b.centre[1] * b.normal[1],
			).toBeLessThan(0);
		}
	});
});
