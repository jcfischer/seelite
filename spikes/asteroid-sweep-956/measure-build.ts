/** Node #956: what deriving the pieces from a ruled field costs, per archetype. bun run spikes/asteroid-sweep-956/measure-build.ts */
import { ruledFields } from "./fixtures";
import { buildPieces } from "./pieces";
const { fields } = await ruledFields();
for (const run of [1, 2]) {
	const ms = fields.map((h) => { const t0 = performance.now(); buildPieces(h); return performance.now() - t0; });
	ms.sort((a, b) => a - b);
	console.log(`run ${run}: build ms per archetype median ${ms[8].toFixed(0)}, max ${ms[15].toFixed(0)}, all 16 ${ms.reduce((a, b) => a + b, 0).toFixed(0)}; ${(65 * 65 * 6).toLocaleString()} pieces × 5 vertices each`);
}
