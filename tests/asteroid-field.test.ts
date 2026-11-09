/**
 * https://github.com/jcfischer/seelite/issues/1209 — the arrangement on a few
 * fields, fast enough for a mutant to run it hundreds of times. The whole corpus
 * is `field-generator-corpus.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import {
	FIELD_EXTENT_KM,
	FIELD_GENERATOR_VERSION,
	FIELD_PROFILE,
	type Rock,
	arrangeRocks,
	fieldFingerprintRow,
	fieldRocks,
	latticeRocks,
	organicBankProfile,
	systemFields,
} from "../src/asteroid-field";
import { generateGalaxy } from "../src/galaxy";
import { fnv1a } from "../src/rng";
import { generateContents } from "../src/system";
import { length, sub } from "../src/vec3";

const rows = generateGalaxy(0x5ee11e, 0)
	.systems.slice(0, 12)
	.flatMap((record) =>
		systemFields(record, generateContents(record)).map((plan) => ({
			record,
			plan,
			rocks: fieldRocks(record, plan),
		})),
	);

describe("the organic arrangement (#1209)", () => {
	test("the fields include both profiles", () => {
		expect(new Set(rows.map((r) => r.plan.profile))).toEqual(
			new Set(["charted", "rare"]),
		);
	});

	test("the generator is version 2, and its output is pinned", () => {
		expect(FIELD_GENERATOR_VERSION).toBe(2);
		expect(
			fnv1a(
				rows
					.flatMap(({ record, plan, rocks }) =>
						rocks.map((r) => fieldFingerprintRow(record.index, plan, r)),
					)
					.join("\n"),
			),
		).toBe(66403079);
	});

	test("the drop radius clears both extents, and every rock stays inside its own", () => {
		expect(FIELD_EXTENT_KM).toEqual({ charted: 44.26, rare: 37.72 });
		for (const { plan, rocks } of rows)
			for (const r of rocks)
				expect(length(r.anchor) + r.driftKm + r.radiusKm).toBeLessThanOrEqual(
					FIELD_EXTENT_KM[plan.profile],
				);
	});

	test("no two rocks' whole drift envelopes come within the margin", () => {
		let worst = Number.POSITIVE_INFINITY;
		for (const { plan, rocks } of rows.slice(0, 3)) {
			const { marginKm } = FIELD_PROFILE[plan.profile];
			for (let i = 0; i < rocks.length; i++)
				for (let j = i + 1; j < rocks.length; j++) {
					const a = rocks[i];
					const b = rocks[j];
					worst = Math.min(
						worst,
						length(sub(a.anchor, b.anchor)) -
							(a.radiusKm + a.driftKm + b.radiusKm + b.driftKm + marginKm),
					);
				}
		}
		expect(worst).toBeGreaterThanOrEqual(0);
	});

	test("a kept rock has its bank slot's physical draws, in slot order; only its anchor moved", () => {
		for (const { record, plan, rocks } of rows) {
			const bank = new Map(
				latticeRocks(
					record,
					plan,
					organicBankProfile(FIELD_PROFILE[plan.profile]),
				).map((r) => [r.slot, r]),
			);
			expect(rocks.map((r) => r.slot)).toEqual(
				[...rocks.map((r) => r.slot)].sort((a, b) => a - b),
			);
			for (const rock of rocks)
				expect({ ...rock, anchor: 0 }).toEqual({
					...(bank.get(rock.slot) as Rock),
					anchor: 0,
				} as never);
		}
	});

	test("a lobe that can find no clear place stops looking after 64 tries", () => {
		const { record, plan } = rows[0];
		let draws = 0;
		const arranged = arrangeRocks(plan, latticeRocks(record, plan), {
			lobes: () => {
				draws++;
				return 0.5;
			},
			anchor: () => () => 0.5,
			keep: () => 2,
		});
		expect(arranged).toEqual([]);
		const count = 1;
		const perTry = 3;
		const afterPlace = 5;
		const firstLobe = perTry + afterPlace;
		const blockedLobes = 5 * (64 * perTry + afterPlace);
		expect(draws).toBe(count + firstLobe + blockedLobes);
	});
});
