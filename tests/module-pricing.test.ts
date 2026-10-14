import { describe, expect, test } from "bun:test";
import { HULL_IDS, HULL_SPECS, POWER_PLANT_OUTPUT } from "../src/hull";
import { flightPerformance } from "../src/sim";
import {
	type ModuleKind,
	deriveProposal,
	dominates,
	fits,
	massImpact,
	referenceFit,
	summarizeFit,
	validateProposal,
} from "../scripts/lib/module-pricing";

describe("module pricing proposal", () => {
	test("covers the complete first catalogue, with every size and grade", () => {
		const rows = deriveProposal().rows;
		expect(new Set(rows.map((r) => r.kind)).size).toBe(17);
		expect([...new Set(rows.map((r) => r.kind))].sort()).toEqual(
			(
				[
					"pulse-laser",
					"beam-laser",
					"military-laser",
					"mining-laser",
					"missile-rack",
					"ecm",
					"docking-computer",
					"identity-scanner",
					"fuel-scoop",
					"long-range-scanner",
					"escape-pod",
					"extra-energy-unit",
					"cargo-rack",
					"shield-booster",
					"armour-plating",
					"fuel-tank",
					"power-plant",
				] satisfies ModuleKind[]
			).sort(),
		);
		expect(rows.length).toBe(17 * 3 * 3);
		expect(
			new Set(rows.map((r) => `${r.kind}/${r.size}/${r.grade}`)).size,
		).toBe(rows.length);
		for (const r of rows) {
			expect(r.priceCr).toBeGreaterThan(0);
			expect(r.massT).toBeGreaterThan(0);
			// The pod's E row keeps nothing but the pilot (#977): its zeros are
			// the ruling, not a missing output.
			for (const v of Object.values(r.output))
				if (r.kind === "escape-pod") expect(v).toBeGreaterThanOrEqual(0);
				else expect(v).toBeGreaterThan(0);
		}
	});
	test("all three grades are Pareto choices at each kind and size", () => {
		const rows = deriveProposal().rows;
		for (const e of rows.filter((r) => r.grade === "E")) {
			const peers = rows.filter((r) => r.kind === e.kind && r.size === e.size);
			const d = peers.find((r) => r.grade === "D")!;
			const a = peers.find((r) => r.grade === "A")!;
			expect(e.priceCr).toBeLessThan(d.priceCr);
			expect(d.priceCr).toBeLessThan(a.priceCr);
			if (e.kind === "docking-computer") {
				// Price and mass alone, the dearer the lighter (#977).
				expect(a.massT).toBeLessThan(d.massT);
				expect(d.massT).toBeLessThan(e.massT);
				expect([e.output, d.output, a.output]).toEqual([{}, {}, {}]);
			} else {
				expect(d.massT).toBeLessThan(a.massT);
				expect(a.massT).toBeLessThan(e.massT);
			}
			if (e.kind === "escape-pod") {
				// A ruled table (#977): E keeps the pilot, D a quarter of the
				// cargo, A half and the best carried module; size sets the capsule.
				expect([e.output, d.output, a.output]).toEqual([
					{ cargoShare: 0, carriedModules: 0, capsuleT: e.output.capsuleT },
					{ cargoShare: 0.25, carriedModules: 0, capsuleT: e.output.capsuleT },
					{ cargoShare: 0.5, carriedModules: 1, capsuleT: e.output.capsuleT },
				]);
				expect(e.output.capsuleT).toBe({ 1: 5, 2: 10, 3: 20 }[e.size]);
			} else
				for (const key of Object.keys(e.output)) {
					expect(d.output[key]).toBeLessThan(e.output[key]);
					expect(e.output[key]).toBeLessThan(a.output[key]);
				}
			for (const x of peers)
				for (const y of peers) expect(dominates(x, y)).toBe(false);
		}
	});
	test("mass calibration is an empty-hold loss, not a laden baseline", () => {
		const e = summarizeFit(referenceFit(deriveProposal().rows, "E"));
		expect(massImpact("freighter", e.massT).lossPct).toBeCloseTo(15, 10);
		expect(
			massImpact("freighter", e.massT, HULL_SPECS.freighter.holdT).lossPct,
		).toBeGreaterThan(15);
	});
	test("invalid arithmetic and dominated rows fail the instrument", () => {
		for (const target of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => deriveProposal(target)).toThrow();
		const rows = deriveProposal().rows;
		expect(() => validateProposal(rows)).not.toThrow();
		expect(() =>
			validateProposal([{ ...rows[0], massT: Number.NaN }, ...rows.slice(1)]),
		).toThrow();
		expect(() =>
			validateProposal([...rows, { ...rows[0], priceCr: rows[0].priceCr / 2 }]),
		).toThrow();
	});
	test("dominance detects equal-output and better-output defects", () => {
		const r = deriveProposal().rows[0];
		expect(dominates({ ...r, priceCr: r.priceCr / 2 }, r)).toBe(true);
		expect(dominates({ ...r, massT: r.massT / 2 }, r)).toBe(true);
		const pod = deriveProposal().rows.find((r) => r.kind === "escape-pod")!;
		expect(
			dominates(
				{
					...pod,
					output: { ...pod.output, cargoShare: pod.output.cargoShare + 0.1 },
				},
				pod,
			),
		).toBe(true);
	});
	test("reference fills exactly the real freighter slots plus its plant", () => {
		const p = deriveProposal();
		const fit = referenceFit(p.rows, "A");
		expect(fit.length).toBe(HULL_SPECS.freighter.slots.length + 1);
		expect(new Set(fit.map((x) => x.slot)).size).toBe(fit.length);
		for (const { slot, module } of fit) {
			if (slot === "plant")
				expect(module.size).toBe(HULL_SPECS.freighter.plantSize);
			else
				expect(
					fits(module, HULL_SPECS.freighter.slots.find((s) => s.key === slot)!),
				).toBe(true);
		}
		expect(summarizeFit(fit).priceCr).toBeGreaterThanOrEqual(150_000);
		expect(summarizeFit(fit).priceCr).toBeLessThanOrEqual(200_000);
	});
	test("target sensitivity recomputes prices without moving masses or output", () => {
		const low = deriveProposal(150_000),
			high = deriveProposal(200_000);
		expect(summarizeFit(referenceFit(low.rows, "A")).priceCr).toBeCloseTo(
			150_000,
			-3,
		);
		expect(summarizeFit(referenceFit(high.rows, "A")).priceCr).toBeCloseTo(
			200_000,
			-3,
		);
		low.rows.forEach((r, i) => {
			expect(high.rows[i].priceCr).toBeGreaterThan(r.priceCr);
			expect(high.rows[i].massT).toBe(r.massT);
			expect(high.rows[i].output).toEqual(r.output);
		});
	});
	test("stock E plants retain their shipped output at every size", () => {
		for (const r of deriveProposal().rows.filter(
			(r) => r.kind === "power-plant" && r.grade === "E",
		))
			expect(r.output).toEqual({ ...POWER_PLANT_OUTPUT.E[r.size] });
	});
	test("every module mass is read through shipped handling, on every hull", () => {
		for (const r of deriveProposal().rows)
			for (const hull of HULL_IDS) {
				const impact = massImpact(hull, r.massT);
				expect(impact.fitted).toBe(
					flightPerformance(hull, {}, HULL_SPECS[hull].massT + r.massT)
						.thrustKms2,
				);
				expect(impact.fitted / impact.bare).toBeCloseTo(
					HULL_SPECS[hull].massT / (HULL_SPECS[hull].massT + r.massT),
					10,
				);
			}
	});
	test("role family and slot size prevent false fit claims", () => {
		const rows = deriveProposal().rows;
		const fuel = rows.find((r) => r.kind === "fuel-tank" && r.size === 3)!;
		expect(
			fits(fuel, { key: "i", kind: "internal", size: 3, accepts: ["cargo"] }),
		).toBe(false);
		expect(
			fits(fuel, { key: "flex", kind: "internal", size: 2, accepts: "any" }),
		).toBe(false);
	});
});
