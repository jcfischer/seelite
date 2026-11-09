import { expect, test } from "bun:test";
import {
	arrangeRocks,
	FIELD_PROFILE,
	latticeRocks,
	organicBankProfile,
	systemFields,
} from "../src/asteroid-field";
import { generateGalaxy } from "../src/galaxy";
import { mix, seededRand } from "../src/rng";
import { generateContents } from "../src/system";
import { organicRocks } from "../spikes/field-shape-1043/organic";

test("the production arrangement is the approved study's, fed the study's seeds", () => {
	let compared = 0;
	for (const record of generateGalaxy(0x5ee11e, 0).systems.slice(0, 64))
		for (const plan of systemFields(record, generateContents(record))) {
			const seed = mix(mix(record.seed, plan.slot), 0x10430c1d);
			const bank = latticeRocks(
				record,
				plan,
				organicBankProfile(FIELD_PROFILE[plan.profile]),
			);
			const arranged = arrangeRocks(plan, bank, {
				lobes: seededRand(seed),
				anchor: (slot) => seededRand(mix(seed, slot)),
				keep: (slot) => seededRand(mix(seed, slot ^ 0x7f341a9))(),
			});
			expect(arranged).toEqual(
				organicRocks(record, plan, "organic", latticeRocks),
			);
			compared += arranged.length;
		}
	expect(compared).toBeGreaterThan(5_000);
});
