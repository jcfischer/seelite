/** Node #950: the p99 rock count on the fingerprint seed, and which field holds it. bun run spikes/asteroid-lod-950/worst-case.ts */
import * as F from "../asteroid-fields-948/field-proto.ts";
const R = new URL("../..", import.meta.url).pathname;
const { forEachSystem, ALL_GALAXIES } = await import(`${R}/tests/helpers/station-rows.ts`);
const SEED = 0x5ee11e;
const rows: { n: number; g: number; s: number; id: string; profile: string; maxR: number }[] = [];
forEachSystem(SEED, ALL_GALAXIES, (record: any, c: any, g: number) => {
	for (const plan of [F.chartedField(record, c), F.rareField(record, c)]) {
		if (!plan) continue;
		const rs = F.rocks(record, plan);
		rows.push({ n: rs.length, g, s: record.index, id: plan.id, profile: plan.profile, maxR: Math.max(...rs.map((r) => r.radiusKm)) });
	}
});
rows.sort((a, b) => a.n - b.n);
const at = (p: number) => rows[Math.min(rows.length - 1, Math.floor(p * rows.length))];
console.log(`fields ${rows.length}; p50 ${at(0.5).n}; p99 ${JSON.stringify(at(0.99))}; max ${JSON.stringify(rows.at(-1))}`);
