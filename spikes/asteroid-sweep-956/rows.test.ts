/**
 * Node #956 rows: the swept hull box and solid cutter against a rock's
 * heightfield pieces. bun test spikes/asteroid-sweep-956/rows.test.ts
 *
 * Synthetic fields name the failures; the archetype rows run the ruled field
 * (#949 D1) for #953's sixteen rocks, keyed by the GLB hash the loader prints.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirOf, radiusAt, type Heightfield } from "../asteroid-collision-949/heightfield";
import { DEFAULT_ROCKS_GLB, MEASURED_ROCKS_SHA256 } from "../asteroid-collision-949/proxy-fit";
import { placeBox, separation } from "./gjk";
import { buildPieces, envelopeAt, type RockPieces } from "./pieces";
import { firstOverlap, type ShipStep, sweepRock, sweepRockFlat } from "./rock-sweep";
import { CUTTER } from "../asteroid-collision-949/drill";
import {
	add, cross, DT, HULL_KM, length, naiveRadialSweep, needleField, ridgeField, ruledFields, scale, shipPrims, step, sub, sweepConfig, upFor, v3,
} from "./fixtures";
import type { Vec3 } from "../../src/vec3";

const unit = (a: Vec3) => scale(a, 1 / length(a));

describe("synthetic: the failures the node names", () => {
	let ridge: RockPieces, needle: RockPieces, ridgeH: Heightfield, needleH: Heightfield;
	beforeAll(() => {
		ridgeH = ridgeField(64, 0.5, 0.9);
		needleH = needleField(64, 0.5, 0.9);
		ridge = buildPieces(ridgeH);
		needle = buildPieces(needleH);
	});

	test("P1 the pieces hold the bilinear surface: envelope ≥ radiusAt on a dense sample, excess stated", () => {
		for (const [h, rp] of [[ridgeH, ridge], [needleH, needle]] as const) {
			let under = 0, over = 0;
			for (let f = 0; f < 6; f++) for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) {
				const d = dirOf(f, ((i + 0.5) / 200) * 2 - 1, ((j + 0.5) / 200) * 2 - 1);
				const e = envelopeAt(rp, h, v3(d[0], d[1], d[2])) - radiusAt(h, d);
				under = Math.min(under, e);
				over = Math.max(over, e);
			}
			console.log(`P1 envelope − bilinear: min ${under.toExponential(2)}, max ${over.toFixed(4)} (unit R)`);
			expect(under).toBeGreaterThanOrEqual(-1e-9);
		}
	});

	test("R1 a thin ridge crossed at 2 km/s and assist off (10 km/s): met at the reference time; the radial-gap advance meets it late", () => {
		const R = 0.4;
		for (const kms of [2, 10]) for (const z of [0.6, 0.7, 0.8]) {
			const half = (kms * DT) / R / 2;
			const s = step(shipPrims(R, false), v3(-half, 0.011, z), v3(half, 0.011, z), v3(1, 0, 0), v3(0, 0, 1));
			const cfg = sweepConfig(R);
			const n = 20000;
			const ref = firstOverlap(s, ridge, n);
			const ours = sweepRock(s, ridge, cfg);
			const naive = naiveRadialSweep((dd) => envelopeAt(ridge, ridgeH, v3(dd[0], dd[1], dd[2])), s, cfg.contact);
			const lateM = naive.s === null ? Infinity : (naive.s - (ref ?? 0)) * 2 * half * R * 1000;
			console.log(`R1 ${kms} km/s z ${z}: ref ${ref?.toFixed(4)}, sweep ${ours.s.toFixed(4)} (${ours.advances} advances), naive ${naive.s?.toFixed(4) ?? "clear"} — ${lateM.toFixed(1)} m past first contact`);
			expect(ref).not.toBeNull();
			expect(ours.kind).toBe("impact");
			expect(ours.s).toBeLessThanOrEqual((ref as number) + 1 / n);
			expect(ours.capped).toBe(false);
		}
	});

	test("R2 a needle between the box's surface samples: the sampled point test sees nothing at the end of the step; the sweep meets it", () => {
		const R = 0.4;
		const d = dirOf(4, (32.5 / 64) * 2 - 1, (32.5 / 64) * 2 - 1);
		const top = envelopeAt(needle, needleH, v3(d[0], d[1], d[2]));
		const tip = v3(d[0] * top, d[1] * top, d[2] * top);
		const prims = shipPrims(R, false);
		const hb = prims[0].half;
		// Tip under the bottom face, midway between lattice samples along both axes.
		// Ship nose +y, up +z: the box's beam is world x, its length world y.
		const off = v3(hb[0] / 4, hb[2] / 8, 0);
		const at = (dz: number) => add(sub(tip, off), v3(0, 0, hb[1] + dz));
		const ship: ShipStep = step(prims, at(0.005 / R), at(-0.005 / R), v3(0, 1, 0), v3(0, 0, 1));
		const cfg = sweepConfig(R);
		const endBox = placeBox(prims[0], ship.end);
		let endOverlap = false;
		for (const p of needle.pieces) if (separation(endBox, p).overlap) { endOverlap = true; break; }
		const naive = naiveRadialSweep((dd) => envelopeAt(needle, needleH, v3(dd[0], dd[1], dd[2])), ship, cfg.contact);
		const ours = sweepRock(ship, needle, cfg);
		const ref = firstOverlap(ship, needle, 4000);
		console.log(`R2 end of step overlaps the needle: ${endOverlap}; naive ${naive.s?.toFixed(4) ?? "clear"}; sweep ${ours.kind} at ${ours.s.toFixed(4)}; ref ${ref?.toFixed(4)}`);
		expect(endOverlap).toBe(true);
		expect(naive.s).toBeNull();
		expect(ours.kind).toBe("impact");
		expect(ours.s).toBeLessThanOrEqual((ref as number) + 1 / 4000);
	});

	test("C1 the deployed cutter meets first nose-on and is told apart; belly-on the hull meets; stowed nose-on the hull meets later", () => {
		const R = 0.4;
		const sphere: Heightfield = { res: 64, r: new Float32Array(6 * 64 * 64).fill(0.8) };
		const rp = buildPieces(sphere);
		const cfg = sweepConfig(R);
		// Down onto the pole at 0.5 km/s (50 m a step), the origin `leadKm` + 10 m above the surface.
		const run = (cutter: boolean, nose: Vec3, up: Vec3, leadKm: number) => {
			const z = 0.8 + (leadKm + 0.01) / R;
			return sweepRock(step(shipPrims(R, cutter), v3(0, 0, z), v3(0, 0, z - (0.5 * DT) / R), nose, up), rp, cfg);
		};
		// Nose down: the cutter's face (bow + feed, 52.8 m) leads. Belly down: the hull's 9.4 m half-height.
		const cutterLead = CUTTER.bowKm + CUTTER.feedTravelKm;
		const noseOn = run(true, v3(0, 0, -1), v3(0, 1, 0), cutterLead);
		const belly = run(true, v3(1, 0, 0), v3(0, 0, 1), HULL_KM.half[1]);
		const stowed = run(false, v3(0, 0, -1), v3(0, 1, 0), cutterLead);
		console.log(`C1 nose-on: ${noseOn.kind} prim ${noseOn.prim} at ${noseOn.s.toFixed(4)}; belly: prim ${belly.prim} at ${belly.s.toFixed(4)}; stowed nose-on: prim ${stowed.prim} at ${stowed.s.toFixed(4)}`);
		expect(noseOn.prim).toBe(1);
		expect(belly.prim).toBe(0);
		expect(stowed.prim).toBe(0);
		expect(stowed.s).toBeGreaterThan(noseOn.s);
	});

	test("G1 a ship placed half inside a rock: a per-rock ghost flies out; a per-piece ghost meets the next piece's wall", () => {
		const R = 0.4;
		const sphere: Heightfield = { res: 64, r: new Float32Array(6 * 64 * 64).fill(0.8) };
		const rp = buildPieces(sphere);
		const prims = shipPrims(R, false);
		// Centre on the surface (spawn, restore, cruise exit), flying along it at 0.2 km/s.
		const a = v3(0, 0, 0.8), b = v3((0.2 * DT) / R, 0, 0.8);
		const s = step(prims, a, b, v3(1, 0, 0), v3(0, 0, 1));
		const rock = sweepRock(s, rp, sweepConfig(R, "rock"));
		const piece = sweepRock(s, rp, sweepConfig(R, "piece"));
		console.log(`G1 per rock: ${rock.kind} (${rock.ghostPieces} pieces overlapped); per piece: ${piece.kind} at ${piece.s.toFixed(4)}`);
		expect(rock.kind).toBe("ghost");
		expect(piece.kind).toBe("impact");
	});
});

describe("archetypes: the ruled field on #953's sixteen rocks", () => {
	let names: string[] = [];
	let fields: Heightfield[] = [];
	let rocks: RockPieces[] = [];
	let sha = "";
	beforeAll(async () => {
		sha = createHash("sha256").update(readFileSync(new URL(`../../${DEFAULT_ROCKS_GLB}`, import.meta.url))).digest("hex");
		const r = await ruledFields();
		names = r.names;
		fields = r.fields;
		rocks = fields.map((h) => buildPieces(h));
	}, 600_000);

	test("K1 keyed by the GLB hash", () => {
		console.log(`K1 rocks sha256 ${sha}`);
		expect(sha).toBe(MEASURED_ROCKS_SHA256);
		expect(rocks.length).toBe(16);
	});

	test("P2 every piece holds its patch: inflation stated; envelope ≥ the field on a dense sample", () => {
		let worst = 0, under = 0, over = 0;
		rocks.forEach((rp, k) => {
			worst = Math.max(worst, ...rp.inflate);
			for (let f = 0; f < 6; f++) for (let j = 0; j < 150; j++) for (let i = 0; i < 150; i++) {
				const d = dirOf(f, ((i + 0.37) / 150) * 2 - 1, ((j + 0.61) / 150) * 2 - 1);
				const e = envelopeAt(rp, fields[k], v3(d[0], d[1], d[2])) - radiusAt(fields[k], d);
				under = Math.min(under, e);
				over = Math.max(over, e);
			}
		});
		console.log(`P2 inflation max ${worst.toFixed(6)}; envelope − field: min ${under.toExponential(2)}, max ${over.toFixed(4)} R`);
		expect(under).toBeGreaterThanOrEqual(-1e-9);
	});

	test("A1 random steps at the surface, 0.2–10 km/s: no step the reference meets is missed, and none met later than one sub-step", () => {
		let seed = 956;
		const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
		const tally = { cases: 0, refHits: 0, sweepHits: 0, touchNoOverlap: 0, ghosts: 0, capped: 0, maxAdv: 0 };
		for (const R of [0.025, 0.4]) rocks.forEach((rp, k) => {
			for (let c = 0; c < 6; c++) {
				const d = unit(v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5));
				const r = radiusAt(fields[k], [d.x, d.y, d.z]);
				const kms = [0.2, 2, 10][c % 3];
				const travel = (kms * DT) / R;
				// Start 0–30 m off the surface, flying in at a random angle (graze to head-on).
				const t = unit(cross(d, upFor(d)));
				const inward = rnd();
				const dir = unit(add(scale(d, -inward), scale(t, 1 - inward)));
				const a = add(scale(d, r + (0.02 + rnd() * 0.03) / R), scale(dir, -travel / 2));
				const b = add(a, scale(dir, travel));
				const s = step(shipPrims(R, true), a, b, unit(add(dir, scale(d, -0.3))), upFor(unit(add(dir, scale(d, -0.3)))));
				const cfg = sweepConfig(R);
				const ours = sweepRock(s, rp, cfg);
				tally.cases++;
				if (ours.kind === "ghost") { tally.ghosts++; continue; }
				const n = Math.max(500, Math.ceil(travel / (0.5e-3 / R)));
				const ref = firstOverlap(s, rp, n);
				tally.maxAdv = Math.max(tally.maxAdv, ours.advances);
				if (ours.capped) tally.capped++;
				if (ref !== null) {
					tally.refHits++;
					expect(ours.kind).toBe("impact");
					expect(ours.s).toBeLessThanOrEqual(ref + 1 / n);
				}
				if (ours.kind === "impact") {
					tally.sweepHits++;
					if (ref === null) tally.touchNoOverlap++;
				}
			}
		});
		console.log(`A1 ${JSON.stringify(tally)}`);
		expect(tally.capped).toBe(0);
	}, 600_000);

	test("A2 the quadtree skips no piece: tree and flat sweeps agree on 16 steps", () => {
		const R = 0.1;
		rocks.forEach((rp, k) => {
			const d = unit(v3(Math.sin(k), Math.cos(k * 1.3), 0.4));
			const r = radiusAt(fields[k], [d.x, d.y, d.z]);
			const a = scale(d, r + 0.2), b = scale(d, r - 0.2);
			const s = step(shipPrims(R, true), a, b, scale(d, -1), upFor(scale(d, -1)));
			const cfg = sweepConfig(R);
			const tree = sweepRock(s, rp, cfg), flat = sweepRockFlat(s, rp, cfg);
			expect(tree.kind).toBe(flat.kind);
			expect(Math.abs(tree.s - flat.s)).toBeLessThan(1e-9);
			expect(tree.prim).toBe(flat.prim);
		});
	}, 600_000);

	test("A3 a graze 2 m clear of the surface at 2 and 10 km/s, assist off: no false impact; 2 m lower it is met no later than the reference", () => {
		let worst = 0, falseHits = 0, cases = 0;
		for (const R of [0.04, 0.4]) rocks.forEach((rp, k) => {
			for (const kms of [2, 10]) {
				const d = unit(v3(Math.sin(k * 2.1), Math.cos(k * 1.7), Math.sin(k * 0.9 + 0.3)));
				const t = unit(cross(d, upFor(d)));
				const travel = (kms * DT) / R;
				const prims = shipPrims(R, false);
				const path = (h: number) => step(prims, add(scale(d, h), scale(t, -travel / 2)), add(scale(d, h), scale(t, travel / 2)), t, d);
				const coarse = Math.max(200, Math.ceil(travel / (0.002 / R)));
				// The lowest lift whose whole path is clear, by bisection on the sub-step reference.
				let lo = 0, hi = 1.5;
				for (let i = 0; i < 30; i++) {
					const m = (lo + hi) / 2;
					if (firstOverlap(path(m), rp, coarse) === null) hi = m;
					else lo = m;
				}
				const fine = Math.max(500, Math.ceil(travel / (0.25e-3 / R)));
				const clear = path(hi + 0.002 / R), low = path(hi - 0.002 / R);
				const refClear = firstOverlap(clear, rp, fine), refLow = firstOverlap(low, rp, fine);
				const a = sweepRock(clear, rp, sweepConfig(R)), b = sweepRock(low, rp, sweepConfig(R));
				cases++;
				worst = Math.max(worst, a.advances, b.advances);
				if (refClear === null && a.kind === "impact") falseHits++;
				expect(refClear).toBeNull();
				expect(a.kind).toBe("clear");
				expect(a.capped || b.capped).toBe(false);
				// A lower path can start inside (the reference meets it at 0): a ghost, §4.3.
				if (refLow === 0) expect(b.kind).toBe("ghost");
				else if (refLow !== null) {
					expect(b.kind).toBe("impact");
					expect(b.s).toBeLessThanOrEqual(refLow + 1 / fine);
				}
			}
		});
		console.log(`A3 ${cases} grazes: false impacts ${falseHits}; most advances in one step ${worst}`);
	}, 900_000);
});
