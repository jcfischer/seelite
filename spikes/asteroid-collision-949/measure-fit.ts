/** Node #949: proxy fit per tolerance over every archetype. bun run spikes/asteroid-collision-949/measure-fit.ts */
import { writeFileSync } from "node:fs";
import { fitArchetype, loadArchetypes, measureFit } from "./proxy-fit";
const tols = (process.env.BUDGETS ?? "1,4,8,16,32").split(",").map(Number);
const keep = Number(process.env.KEEP ?? 16);
const arch = await loadArchetypes();
const kept: Record<string, unknown> = {};
for (const tol of tols) {
	const rows = arch.map((a) => {
		const t0 = performance.now();
		const fit = fitArchetype(a, tol);
		const m = measureFit(a, fit);
		if (tol === keep) kept[a.name] = { boxes: fit.boxes, norm: Math.max(1, m.reach) };
		return { a, fit, m, ms: performance.now() - t0 };
	});
	const f = (x: number) => x.toFixed(3);
	console.log(`\nbudget ${tol} boxes`);
	console.log("archetype            boxes overshoot empty%  reach  grew   ms");
	for (const { a, fit, m, ms } of rows)
		console.log(`${a.name.padEnd(20)} ${String(m.boxes).padStart(5)} ${f(m.overshoot).padStart(9)} ${(m.emptyShare * 100).toFixed(1).padStart(6)} ${f(m.reach)} ${f(fit.grewBy)} ${ms.toFixed(0).padStart(5)}${m.drawnOutside ? "  DRAWN OUTSIDE" : ""}`);
	const max = (k: (r: (typeof rows)[number]) => number) => Math.max(...rows.map(k));
	const mean = (k: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + k(r), 0) / rows.length;
	console.log(`max boxes ${max((r) => r.m.boxes)}, mean ${mean((r) => r.m.boxes).toFixed(1)}; max overshoot ${f(max((r) => r.m.overshoot))} (25 m rock: ${(max((r) => r.m.overshoot) * 25).toFixed(1)} m, 600 m rock: ${(max((r) => r.m.overshoot) * 600).toFixed(1)} m); max reach ${f(max((r) => r.m.reach))}`);
}
writeFileSync(new URL("./fitted.json", import.meta.url), JSON.stringify(kept));
