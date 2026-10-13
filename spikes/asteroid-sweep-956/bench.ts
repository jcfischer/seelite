/**
 * Node #956: what the swept rock test costs per rock per tick.
 *   bun run spikes/asteroid-sweep-956/bench.ts > spikes/asteroid-sweep-956/bench-run1.txt
 *
 * Arms, interleaved call by call so drift in the machine falls on all alike:
 * - tree64: the ruled field (#949 D1) as pieces, swept best-first on the
 *   quadtree with caps square to each tile.
 * - df64: the first design — depth-first, caps cut by the cube-face plane.
 * - tree32: the same at 32 texels, cost only (D2 is not shown to hold there).
 * - point949: #949 `bench.ts`'s unculled point test (114 box samples + every
 *   texel), re-run here as the baseline. It is not a sweep.
 * - flat64: every piece advanced on its own; a few calls, for scale.
 *
 * Scenarios, each on every archetype at one fixed approach direction, the
 * miner with its cutter deployed, at MAX_DT:
 * - approach: head-on at 2 km/s, met mid-step.
 * - graze: tangent at 2 km/s, 2 m clear of the lowest clear lift.
 * - resting: 0.12 m off the surface, sliding at 1 m/s (§3.1's resting pair).
 * - near: tangent at 2 km/s, 20 m clear.
 * - assistOff: head-on at 10 km/s.
 */
import { dirOf, type Heightfield, radiusAt, texel } from "../asteroid-collision-949/heightfield";
import { cells, PROFILE } from "../asteroid-fields-948/field-proto";
import { counters } from "./gjk";
import { buildPieces, type RockPieces, setTiltedCaps } from "./pieces";
import { firstOverlap, setBestFirst, type ShipStep, sweepRock, sweepRockFlat } from "./rock-sweep";
import { add, coarseFields, cross, DT, HULL_KM, length, ruledFields, scale, shipPrims, step, sub, sweepConfig, upFor, v3 } from "./fixtures";
import type { Vec3 } from "../../src/vec3";

const unit = (a: Vec3) => scale(a, 1 / length(a));
const RS = [0.025, 0.04, 0.1, 0.4];
const REPS = Number(process.env.REPS ?? 5);

const { sha, fields: f64 } = await ruledFields();
const f32 = await coarseFields(32);
console.log(`rocks sha256 ${sha}; REPS ${REPS}; load ${(await import("node:os")).loadavg().map((x) => x.toFixed(1)).join(" ")}`);
const p64 = f64.map((h) => buildPieces(h));
const p32 = f32.map((h) => buildPieces(h));
setTiltedCaps(false);
const p64face = f64.map((h) => buildPieces(h));
setTiltedCaps(true);

/** The lowest lift along `d` whose path is clear, by bisection on the reference. */
function clearLift(rp: RockPieces, mk: (h: number) => ShipStep, R: number): number {
	let lo = 0, hi = 1.6;
	for (let i = 0; i < 24; i++) {
		const m = (lo + hi) / 2;
		if (firstOverlap(mk(m), rp, 200) === null) hi = m;
		else lo = m;
	}
	void R;
	return hi;
}

type Scenario = { name: string; make: (rp: RockPieces, h: Heightfield, k: number, R: number) => ShipStep };
const dirFor = (k: number) => unit(v3(Math.sin(k * 2.1), Math.cos(k * 1.7), Math.sin(k * 0.9 + 0.3)));
const tangentPath = (rp: RockPieces, k: number, R: number, kms: number, clearM: number) => {
	const d = dirFor(k), t = unit(cross(d, upFor(d))), travel = (kms * DT) / R;
	const prims = shipPrims(R, true);
	const mk = (h: number) => step(prims, add(scale(d, h), scale(t, -travel / 2)), add(scale(d, h), scale(t, travel / 2)), t, d);
	return mk(clearLift(rp, mk, R) + clearM / 1000 / R);
};
const headOn = (h: Heightfield, k: number, R: number, kms: number) => {
	const d = dirFor(k), r = radiusAt(h, [d.x, d.y, d.z]), travel = (kms * DT) / R, prims = shipPrims(R, true);
	const nose = scale(d, -1);
	// The cutter's face (52.8 m ahead) meets the surface half way through the step.
	const lead = (HULL_KM.half[2] + 0.0106) / R;
	return step(prims, scale(d, r + lead + travel / 2), scale(d, r + lead - travel / 2), nose, upFor(nose));
};
const SCENARIOS: Scenario[] = [
	{ name: "approach", make: (_rp, h, k, R) => headOn(h, k, R, 2) },
	{ name: "graze", make: (rp, _h, k, R) => tangentPath(rp, k, R, 2, 2) },
	{ name: "resting", make: (rp, _h, k, R) => tangentPath(rp, k, R, 0.001, 0.12) },
	{ name: "near", make: (rp, _h, k, R) => tangentPath(rp, k, R, 2, 20) },
	{ name: "assistOff", make: (_rp, h, k, R) => headOn(h, k, R, 10) },
];

/** #949's unculled point test, as its bench ran it. */
function point949(h: Heightfield, s: ShipStep, surface: [number, number, number][]): number {
	const box = s.prims[0];
	let hits = 0;
	const c = s.end.origin;
	for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) for (let k = -4; k <= 4; k++) {
		if (!(Math.abs(i) === 2 || Math.abs(j) === 1 || Math.abs(k) === 4)) continue;
		const q = add(c, add(add(scale(s.end.x, (i / 2) * box.half[0]), scale(s.end.y, j * box.half[1])), scale(s.end.z, (k / 4) * box.half[2])));
		const l = length(q);
		if (l - radiusAt(h, [q.x / l, q.y / l, q.z / l]) <= 0) hits++;
	}
	for (const p of surface) {
		const q = sub(v3(p[0], p[1], p[2]), c);
		if (Math.abs(q.x) <= box.half[0] && Math.abs(q.y) <= box.half[1] && Math.abs(q.z) <= box.half[2]) hits++;
	}
	return hits;
}
const surfaceOf = (h: Heightfield) => {
	const out: [number, number, number][] = [];
	for (let f = 0; f < 6; f++) for (let j = 0; j < h.res; j++) for (let i = 0; i < h.res; i++) {
		const d = dirOf(f, ((i + 0.5) / h.res) * 2 - 1, ((j + 0.5) / h.res) * 2 - 1), r = h.r[texel(h.res, f, i, j)];
		out.push([d[0] * r, d[1] * r, d[2] * r]);
	}
	return out;
};
const surf64 = f64.map(surfaceOf);

// Build every case once (the lifts are bisected on the reference, slow, and not timed).
type Case = { scen: string; R: number; k: number; s64: ShipStep; s32: ShipStep };
const cases: Case[] = [];
for (const R of RS) for (const sc of SCENARIOS) for (let k = 0; k < p64.length; k++)
	cases.push({ scen: sc.name, R, k, s64: sc.make(p64[k], f64[k], k, R), s32: sc.make(p32[k], f32[k], k, R) });
console.log(`${cases.length} cases built`);

const arms = ["tree64", "df64", "tree32", "point949"] as const;
const times: Record<string, number[]> = {};
const work: Record<string, { gjk: number; adv: number; n: number; kinds: Record<string, number> }> = {};
const key = (arm: string, c: Case) => `${arm}|${c.scen}|${c.R}`;
// Warm the JIT on every arm before timing.
for (const c of cases.slice(0, 40)) { sweepRock(c.s64, p64[c.k], sweepConfig(c.R)); setBestFirst(false); sweepRock(c.s64, p64face[c.k], sweepConfig(c.R)); setBestFirst(true); sweepRock(c.s32, p32[c.k], sweepConfig(c.R)); point949(f64[c.k], c.s64, surf64[c.k]); }
for (let rep = 0; rep < REPS; rep++)
	for (const c of cases)
		for (const arm of arms) {
			counters.gjk = 0;
			const t0 = performance.now();
			let res = null as ReturnType<typeof sweepRock> | null;
			if (arm === "tree64") res = sweepRock(c.s64, p64[c.k], sweepConfig(c.R));
			else if (arm === "df64") { setBestFirst(false); res = sweepRock(c.s64, p64face[c.k], sweepConfig(c.R)); setBestFirst(true); }
			else if (arm === "tree32") res = sweepRock(c.s32, p32[c.k], sweepConfig(c.R));
			else point949(f64[c.k], c.s64, surf64[c.k]);
			const us = (performance.now() - t0) * 1000;
			(times[key(arm, c)] ??= []).push(us);
			if (res && rep === 0) {
				const w = (work[key(arm, c)] ??= { gjk: 0, adv: 0, n: 0, kinds: {} });
				w.gjk += counters.gjk;
				w.adv += res.advances;
				w.n++;
				w.kinds[res.kind] = (w.kinds[res.kind] ?? 0) + 1;
			}
		}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
console.log("µs per rock per tick (median / p90 / max over 16 archetypes × REPS); work per call (GJK queries, advances); outcomes");
for (const R of RS) for (const sc of SCENARIOS) {
	const row = arms.map((arm) => {
		const t = times[`${arm}|${sc.name}|${R}`];
		const w = work[`${arm}|${sc.name}|${R}`];
		const base = `${arm} ${q(t, 0.5).toFixed(0)}/${q(t, 0.9).toFixed(0)}/${Math.max(...t).toFixed(0)}`;
		return w ? `${base} (gjk ${(w.gjk / w.n).toFixed(0)}, adv ${(w.adv / w.n).toFixed(0)}, ${Object.entries(w.kinds).map(([k, v]) => `${k} ${v}`).join(" ")})` : base;
	});
	console.log(`R ${(R * 1000).toFixed(0).padStart(3)} m ${sc.name.padEnd(9)} ${row.join(" | ")}`);
}

console.log(`load at end ${(await import("node:os")).loadavg().map((x) => x.toFixed(1)).join(" ")}`);
// flat64, a few calls for scale: the quadtree's saving.
{
	const pick = cases.filter((c) => c.R === 0.1 && (c.scen === "approach" || c.scen === "graze") && c.k < 3);
	for (const c of pick) {
		counters.gjk = 0;
		const t0 = performance.now();
		const r = sweepRockFlat(c.s64, p64[c.k], sweepConfig(c.R));
		console.log(`flat64 R 100 m ${c.scen} archetype ${c.k}: ${((performance.now() - t0) * 1000).toFixed(0)} µs, gjk ${counters.gjk}, ${r.kind}`);
	}
}

// Rocks a ship's step can reach at once: the F7 layout (#949), charted profile.
{
	const p = PROFILE.charted;
	const cl = cells(p);
	let rand = 7;
	const rnd = () => ((rand = (rand * 1103515245 + 12345) % 2147483648) / 2147483648);
	const rocks = cl.map((c, slot) => {
		const radiusKm = 0.025 + rnd() * 0.375, play = Math.max(0, p.cellKm / 2 - radiusKm - p.marginKm / 2);
		return { slot, radiusKm, anchor: add(c, v3((rnd() - 0.5) * play, (rnd() - 0.5) * play, 0)), driftKm: play * 0.3 };
	});
	const shipReach = Math.hypot(HULL_KM.half[0], HULL_KM.half[1], HULL_KM.half[2] + 0.0106);
	for (const kms of [2, 10]) {
		const hist: number[] = [];
		for (let i = 0; i < 20000; i++) {
			// Points near a rock's surface: the case that costs.
			const r = rocks[Math.floor(rnd() * rocks.length)];
			const d = unit(v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5));
			const pos = add(r.anchor, scale(d, r.radiusKm + rnd() * 0.1));
			const near = rocks.filter((o) => length(sub(o.anchor, pos)) <= shipReach + kms * DT + o.radiusKm + o.driftKm).length;
			hist[near] = (hist[near] ?? 0) + 1;
		}
		console.log(`rocks in reach of one step at ${kms} km/s, ship within 100 m of a rock: ${hist.map((n, k) => (n ? `${k}: ${n}` : "")).filter(Boolean).join(", ")} (of 20000)`);
	}
}
