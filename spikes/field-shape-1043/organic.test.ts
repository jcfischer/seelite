import { expect, test } from "bun:test";
import {
	FIELD_PROFILE,
	latticeRocks,
	rockLocal,
	systemFields,
} from "../../src/asteroid-field";
import { generateGalaxy } from "../../src/galaxy";
import { generateContents } from "../../src/system";
import { organicRocks, ORGANIC_VARIANTS } from "./organic";

const fixtures = [173, 0].map((index) => {
	const record = generateGalaxy(0x5ee11e, 0).systems[index];
	const plan = systemFields(record, generateContents(record)).find(
		(p) => p.profile === (index === 173 ? "charted" : "rare"),
	)!;
	return { record, plan };
});

test("organic anchors are deterministic slot identities with unchanged physical draws", () => {
	for (const { record, plan } of fixtures)
		for (const variant of ORGANIC_VARIANTS) {
			const base = FIELD_PROFILE[plan.profile];
			const reference = new Map(
				latticeRocks(record, plan, {
					...base,
					occupancy: 1,
					semiKm: base.semiKm.map((x) => x * 2) as [number, number, number],
				}).map((rock) => [rock.slot, rock]),
			);
			const rocks = organicRocks(record, plan, variant);
			expect(rocks.length).toBeGreaterThan(150);
			expect(organicRocks(record, plan, variant)).toEqual(rocks);
			expect(
				organicRocks(record, plan, variant, (...args) =>
					latticeRocks(...args).reverse(),
				),
			).toEqual(rocks);
			expect(new Set(rocks.map((r) => r.slot)).size).toBe(rocks.length);
			for (const rock of rocks) {
				const { anchor: _a, ...physical } = rock;
				const { anchor: _b, ...expected } = reference.get(rock.slot)!;
				expect(physical).toEqual(expected);
			}
		}
});

test("organic drift envelopes preserve the physical gap and fit outside50km arrival", () => {
	for (const { record, plan } of fixtures)
		for (const variant of ORGANIC_VARIANTS) {
			const rocks = organicRocks(record, plan, variant);
			const gap = FIELD_PROFILE[plan.profile].marginKm;
			for (let i = 0; i < rocks.length; i++) {
				const a = rocks[i];
				expect(
					Math.hypot(a.anchor.x, a.anchor.y, a.anchor.z) +
						a.driftKm +
						a.radiusKm,
				).toBeLessThan(49);
				for (let j = 0; j < i; j++) {
					const b = rocks[j];
					const minimum =
						Math.hypot(
							a.anchor.x - b.anchor.x,
							a.anchor.y - b.anchor.y,
							a.anchor.z - b.anchor.z,
						) -
						a.radiusKm -
						b.radiusKm -
						a.driftKm -
						b.driftKm;
					expect(minimum).toBeGreaterThanOrEqual(gap - 1e-10);
				}
			}
			for (const time of [0, 1000, 1_000_000])
				for (const rock of rocks) {
					const p = rockLocal(rock, time);
					expect(Math.hypot(p.x, p.y, p.z) + rock.radiusKm).toBeLessThan(49);
				}
		}
});

test("organic anchor coordinates do not retain the production cell-frequency peak", () => {
	for (const { record, plan } of fixtures)
		for (const variant of ORGANIC_VARIANTS) {
			const rocks = organicRocks(record, plan, variant);
			for (const axis of ["x", "y", "z"] as const)
				for (const harmonic of [1, 2]) {
					let c = 0,
						s = 0;
					for (const rock of rocks) {
						const phase =
							(2 * Math.PI * harmonic * rock.anchor[axis]) /
							FIELD_PROFILE[plan.profile].cellKm;
						c += Math.cos(phase);
						s += Math.sin(phase);
					}
					expect(Math.hypot(c, s) / rocks.length).toBeLessThan(0.25);
				}
		}
});
