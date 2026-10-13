/** Node #948 prototype instrument. bun run measure.ts [nWorlds] */
import * as F from "./field-proto.ts";
const R = new URL("../..", import.meta.url).pathname;
const { forEachSystem, worldSeeds, ALL_GALAXIES } = await import(`${R}/tests/helpers/station-rows.ts`);
const sys = await import(`${R}/src/system.ts`);
const { relayPlan } = await import(`${R}/src/relay-slot.ts`);
const relayPosition = (p: any, c: any, t: number) => { const par = p.parentId ? c.planets.find((x: any) => x.id === p.parentId) : null; const a = par ? sys.positionOnOrbit(par.orbit, t) : { x: 0, y: 0, z: 0 }; const b = sys.positionOnOrbit(p.orbit, t); const nn = sys.orbitNormal(p.orbit); return { x: a.x + b.x + nn.x * p.offPlaneKm, y: a.y + b.y + nn.y * p.offPlaneKm, z: a.z + b.z + nn.z * p.offPlaneKm }; };

const n = Number(process.argv[2] ?? 8);
const worlds = [47, 0x5ee11e, ...worldSeeds(n)];
const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const YEAR = 365.25 * 86400;
const TIMES = Array.from({ length: 40 }, (_, i) => (i / 40) * 10 * YEAR); // 10 years

type Tally = { systems: number; refinery: number; rare: number; kinds: Record<string, number>; relayWatchesRefinery: number };
const perWorld: Tally[] = [];
const rockCounts: Record<string, number[]> = { charted: [], rare: [] };
const maxR: Record<string, number> = { charted: 0, rare: 0 };
const rockR: number[] = [];
const periods: number[] = [];
const surfaceV: number[] = [];
let minGapKm = Infinity;
const driftV: number[] = [];
let derivErr = 0;
const GAP_TIMES = Array.from({ length: 12 }, (_, i) => i * 1800 + 17); // between rock surfaces in one field
let minChartedToRefinery = Infinity, maxChartedToRefinery = 0;
let minChartedToRelay = Infinity;
let minFieldToOther = Infinity; // field centre to any station other than its host refinery, or planet surface
let minFieldToOtherWhat = "";
let minArrival = Infinity;
let trojanFlips = 0;
let outerTrojans = 0;
let gallery: Record<string, string> = {};

for (const w of worlds) {
	const t: Tally = { systems: 0, refinery: 0, rare: 0, kinds: {}, relayWatchesRefinery: 0 };
	forEachSystem(w, ALL_GALAXIES, (record: any, c: any, g: number) => {
		t.systems++;
		const fields = [F.chartedField(record, c), F.rareField(record, c)].filter(Boolean) as F.FieldPlan[];
		const relay = relayPlan(c, record.seed);
		if (relay && c.stations.find((s: any) => s.id === relay.watchedStationId)?.type === "refinery") t.relayWatchesRefinery++;
		for (const f of fields) {
			t.kinds[f.kind] = (t.kinds[f.kind] ?? 0) + 1;
			if (f.profile === "charted") t.refinery++; else t.rare++;
			if (f.kind === "outer-trojan") outerTrojans++;
			const key = `${f.kind}`;
			if (!gallery[key] && (w === 47 || w === 0x5ee11e)) gallery[key] = `world ${w} galaxy ${g} system ${record.index} (${record.name}) ${f.id}`;
			const rs = F.rocks(record, f);
			rockCounts[f.profile].push(rs.length);
			for (const r of rs) {
				maxR[f.profile] = Math.max(maxR[f.profile], r.radiusKm);
				rockR.push(r.radiusKm); periods.push(r.periodS);
				surfaceV.push((2 * Math.PI * r.radiusKm * 1000) / r.periodS);
			}
			// pairwise gap in a sample of fields
			for (const r of rs) {
				driftV.push(r.driftKm * 2 * Math.PI / r.driftPeriodS * 1000);
				const h = 1, a = F.rockLocal(r, 5000 - h), b = F.rockLocal(r, 5000 + h), v = F.rockLocalVel(r, 5000);
				derivErr = Math.max(derivErr, Math.hypot((b.x - a.x) / (2 * h) - v.x, (b.y - a.y) / (2 * h) - v.y, (b.z - a.z) / (2 * h) - v.z));
			}
			if (record.index % 64 === 0)
				for (const time of GAP_TIMES) {
					const ps = rs.map((r) => F.rockLocal(r, time));
					for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++)
						minGapKm = Math.min(minGapKm, dist(ps[i], ps[j]) - rs[i].radiusKm - rs[j].radiusKm);
				}
			// separations over 10 years
			for (const time of TIMES) {
				const fc = F.fieldCentre(f, c, time);
				for (const b of sys.placeBodies(c, time)) {
					if (b.kind === "star") continue;
					const d = dist(fc, b.pos) - b.radiusKm;
					if (f.profile === "charted" && b.id === f.hostId) {
						minChartedToRefinery = Math.min(minChartedToRefinery, d);
						maxChartedToRefinery = Math.max(maxChartedToRefinery, d);
						continue;
					}
					if (d < minFieldToOther) { minFieldToOther = d; minFieldToOtherWhat = `${f.kind}→${b.kind} ${b.id}`; }
				}
				if (relay && f.profile === "charted") minChartedToRelay = Math.min(minChartedToRelay, dist(fc, relayPosition(relay, c, time)));
			}
			const arr = sys.arrivalPoint(record, c, null, 0);
			minArrival = Math.min(minArrival, dist(arr, F.fieldCentre(f, c, 0)));
		}
		// outpost-trojan clash check
		const rare = F.rareField(record, c);
		const op = c.stations.find((s: any) => s.type === "outpost");
		if (rare && op && (rare.kind === "trojan" || rare.kind === "outer-trojan")) {
			for (const time of [0, YEAR]) if (dist(F.fieldCentre(rare, c, time), sys.positionOnOrbit(op.orbit, time)) < 1e6) trojanFlips++;
		}
	});
	perWorld.push(t);
}
const spread = (f: (t: Tally) => number) => { const v = perWorld.map(f); return `${Math.min(...v).toFixed(3)}–${Math.max(...v).toFixed(3)}`; };
console.log(`worlds ${worlds.length} × 8 galaxies × 256 = ${perWorld.reduce((a, t) => a + t.systems, 0)} systems`);
console.log(`charted (refinery) share per world: ${spread((t) => t.refinery / t.systems)}`);
console.log(`rare share per world: ${spread((t) => t.rare / t.systems)}`);
const kinds = ["refinery-orbit", "belt", "trojan", "outer-orbit", "outer-trojan"];
for (const k of kinds) console.log(`  ${k}: total ${perWorld.reduce((a, t) => a + (t.kinds[k] ?? 0), 0)}  per-world ${spread((t) => t.kinds[k] ?? 0)}`);
console.log(`relay watches refinery: ${perWorld.reduce((a, t) => a + t.relayWatchesRefinery, 0)} systems`);
for (const p of ["charted", "rare"]) console.log(`rocks/${p}: min ${Math.min(...rockCounts[p])} p50 ${pct(rockCounts[p], 0.5)} max ${Math.max(...rockCounts[p])}; max radius ${maxR[p].toFixed(3)} km`);
console.log(`rock radius km p10 ${pct(rockR, 0.1).toFixed(3)} p50 ${pct(rockR, 0.5).toFixed(3)} p90 ${pct(rockR, 0.9).toFixed(3)} p99 ${pct(rockR, 0.99).toFixed(3)}`);
console.log(`spin period min p50 max: ${(pct(periods, 0) / 60).toFixed(1)} ${(pct(periods, 0.5) / 60).toFixed(1)} ${(pct(periods, 0.999) / 60).toFixed(1)} min; surface m/s p50 ${pct(surfaceV, 0.5).toFixed(2)} max ${surfaceV.reduce((a, b) => Math.max(a, b), 0).toFixed(2)}`);
console.log(`min rock surface gap (sampled fields × 12 times over 6 h): ${(minGapKm * 1000).toFixed(0)} m`);
console.log(`drift speed m/s p50 ${pct(driftV, 0.5).toFixed(3)} p90 ${pct(driftV, 0.9).toFixed(3)} max ${driftV.reduce((a, b) => Math.max(a, b), 0).toFixed(3)}; velocity vs finite difference max err ${(derivErr * 1e6).toFixed(4)} mm/s`);
console.log(`charted centre → refinery surface: ${minChartedToRefinery.toFixed(1)}–${maxChartedToRefinery.toFixed(1)} km`);
console.log(`charted centre → relay (any relay): min ${minChartedToRelay.toFixed(0)} km`);
console.log(`field centre → other body surface (10 y, 40 samples): min ${minFieldToOther.toFixed(0)} km (${minFieldToOtherWhat})`);
console.log(`new-game arrival → field centre: min ${minArrival.toFixed(0)} km`);
console.log(`rare trojan fields within 1e6 km of the outpost: ${trojanFlips}; outer-trojan fallbacks: ${outerTrojans}`);
console.log("gallery seeds:", gallery);
