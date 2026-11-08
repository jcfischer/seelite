/**
 * https://github.com/jcfischer/seelite/issues/1209 — what the production arrangement does to population,
 * radius and reserves, against the lattice layout and the approved study.
 *
 *   bun scripts/measure-field-population.ts
 *
 * Reads three seeds over two galaxies, the corpus the mining comparison uses.
 * Counts and tonnes are arithmetic, so a re-run reproduces them exactly.
 */
import {
	type FieldPlan,
	type FieldProfileName,
	type Rock,
	fieldRocks,
	latticeRocks,
	systemFields,
} from "../src/asteroid-field";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import { rockContents } from "../src/rock-survey";
import { generateContents } from "../src/system";
import { organicRocks } from "../spikes/field-shape-1043/organic";

const SEEDS = [1, 47, 1234];
const GALAXIES = [0, 1];
const quantile = (xs: number[], q: number): number => {
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.floor(q * (sorted.length - 1))];
};
const triple = (xs: number[], digits = 0): string =>
	[0, 0.5, 0.99, 1].map((q) => quantile(xs, q).toFixed(digits)).join(" / ");

type Layout = (record: SystemRecord, plan: FieldPlan) => Rock[];
const LAYOUTS: Record<string, Layout> = {
	lattice: (record, plan) => latticeRocks(record, plan),
	study: (record, plan) => organicRocks(record, plan, "organic", latticeRocks),
	production: fieldRocks,
};

for (const profile of ["charted", "rare"] as FieldProfileName[]) {
	console.log(`\n${profile}: min / p50 / p99 / max per field`);
	for (const [name, layout] of Object.entries(LAYOUTS)) {
		const counts: number[] = [];
		const tonnes: number[] = [];
		const good: number[] = [];
		const radii: number[] = [];
		for (const seed of SEEDS)
			for (const galaxy of GALAXIES)
				for (const record of generateGalaxy(seed, galaxy).systems)
					for (const plan of systemFields(record, generateContents(record))) {
						if (plan.profile !== profile) continue;
						const rocks = layout(record, plan);
						counts.push(rocks.length);
						let total = 0;
						for (const rock of rocks) {
							radii.push(rock.radiusKm);
							const c = rockContents(record.seed, plan.slot, profile, rock);
							total += c.surfaceT + c.deepT;
						}
						tonnes.push(total);
						const largest = [...rocks]
							.sort((a, b) => b.radiusKm - a.radiusKm)
							.slice(0, Math.ceil(rocks.length / 4));
						good.push(
							largest.reduce((sum, rock) => {
								const c = rockContents(record.seed, plan.slot, profile, rock);
								return sum + c.surfaceT + c.deepT;
							}, 0),
						);
					}
		console.log(
			`  ${name.padEnd(10)} rocks ${triple(counts).padEnd(24)} reserve t ${triple(tonnes).padEnd(36)} largest quarter t ${triple(good)}`,
		);
		console.log(
			`  ${"".padEnd(10)} radius km p10 ${quantile(radii, 0.1).toFixed(3)} p50 ${quantile(radii, 0.5).toFixed(3)} p90 ${quantile(radii, 0.9).toFixed(3)} p99 ${quantile(radii, 0.99).toFixed(3)} max ${quantile(radii, 1).toFixed(3)} (${counts.length} fields, ${radii.length} rocks)`,
		);
	}
}
