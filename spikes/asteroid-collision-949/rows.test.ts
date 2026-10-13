/**
 * Node #949: the named failure cases, as headless rows on the real
 * `sweepShip`. Run: bun test spikes/asteroid-collision-949/rows.test.ts
 *
 * The frame rows use a box stand-in for the rock proxy: the frame, the clock
 * and the closing speed do not depend on the proxy's shape, and a box makes
 * the spin matter. The surface rows (drill, laser, bound) use a real
 * archetype's heightfield from #953's in-flight GLB, so their figures are
 * provisional until that asset is final.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { hullBox, type Primitive, shipPose, sweepShip } from "../../src/collision";
import { DEFAULT_CRUISE } from "../../src/cruise";
import { HULL_SPECS } from "../../src/hull";
import { MAX_DT } from "../../src/units";
import { add, length, scale, sub, v3, type Vec3 } from "../../src/vec3";
import { cells, PROFILE, type Rock } from "../asteroid-fields-948/field-proto";
import { CUTTER, drillState, rayHitKm, type RockSurface, surfaceGapKm } from "./drill";
import { normalAt, outermostExits, radiusAt, rayFirstHit, type Heightfield, type V3 } from "./heightfield";
import { loadArchetypes, type Archetype } from "./proxy-fit";
import { candidates, type FieldFrame, rockMotion, rockPose, surfaceVelocity } from "./rock-frame";

const miner = HULL_SPECS.miner;
const shipBox = hullBox(miner.env, miner.envCentre);
const shipHalfLen = miner.env.lengthKm / 2;

/** A field on a 1 AU-ish orbit: ~30 km/s, the speed #75 warns about. */
const FIELD: FieldFrame = {
	orbit: { radiusKm: 1.496e8, periodS: 365.25 * 86400, theta0: 0.3, inclination: 0.02, node: 1.1 },
	q: [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)],
};
function makeRock(o: Partial<Rock> = {}): Rock {
	return {
		slot: 0, radiusKm: 0.025, shapeSeed: 1, periodS: 240, phase0: 0,
		local: v3(), anchor: v3(), driftKm: 0, e1: v3(1, 0, 0), e2: v3(0, 1, 0), driftPeriodS: 3600, driftPhase: 0,
		axis: v3(0, 0, 1),
		...o,
	};
}
/** A box stand-in in the rock's frame. */
const standIn = (r: Rock): Primitive[] => [
	{ kind: "box", centre: v3(), axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)], half: [r.radiusKm * 0.6, r.radiusKm * 0.45, r.radiusKm * 0.35] },
];
/** A ship `offset` from the rock's origin and moving at `rel` relative to
 *  it, both in the rock's own axes at `t`; nose along the rock's z. */
function shipNear(rock: Rock, t: number, offset: Vec3, rel: Vec3, dt = MAX_DT) {
	const a = rockPose(FIELD, rock, t), b = rockPose(FIELD, rock, t + dt);
	const w = (v: Vec3) => add(scale(a.pose.x, v.x), add(scale(a.pose.y, v.y), scale(a.pose.z, v.z)));
	const vel0 = add(a.vel, w(rel)), vel1 = add(b.vel, w(rel));
	const p0 = add(a.pose.origin, w(offset));
	const p1 = add(p0, scale(add(vel0, vel1), dt / 2));
	const nose = a.pose.z, up = a.pose.y;
	return { primitives: [shipBox], start: shipPose(p0, nose, up), end: shipPose(p1, nose, up), velStart: vel0, velEnd: vel1 };
}

describe("frame: the rock moves, and contact is read in its frame", () => {
	test("F1 no tunnelling at the assist cap or assist-off speed through the smallest rock", () => {
		const rock = makeRock();
		for (const kms of [2, 10]) {
			// Start one step's travel short of the rock, aimed through its centre.
			const back = kms * MAX_DT * 0.6 + shipHalfLen + rock.radiusKm;
			const ship = shipNear(rock, 0, v3(0, 0, -back), v3(0, 0, kms));
			const r = sweepShip(ship, [rockMotion(FIELD, rock, standIn(rock), 0, MAX_DT)], MAX_DT);
			expect(r.impacts.length).toBe(1);
			expect(r.impacts[0].closingKms).toBeCloseTo(kms, 2);
		}
	});

	test("F2 closing speed is relative to the rock, not inertial (the field moves ~30 km/s)", () => {
		const rock = makeRock({ radiusKm: 0.2, periodS: 3000 });
		const fieldSpeed = length(rockPose(FIELD, rock, 0).vel);
		expect(fieldSpeed).toBeGreaterThan(25);
		const gap = 0.0005;
		const ship = shipNear(rock, 0, v3(0, 0, -(rock.radiusKm * 0.35 + shipHalfLen + gap)), v3(0, 0, 0.01));
		const r = sweepShip(ship, [rockMotion(FIELD, rock, standIn(rock), 0, MAX_DT)], MAX_DT);
		expect(r.impacts.length).toBe(1);
		expect(r.impacts[0].closingKms).toBeLessThan(0.02);
		expect(r.impacts[0].damage).toBe(0);
	});

	test("F3 a spinning rock turns into a parked ship: a touch, never a hit", () => {
		// Fastest spin the contract allows: equator at 6 m/s.
		const rock = makeRock({ radiusKm: 0.4, periodS: (2 * Math.PI * 0.4) / 0.006, axis: v3(0, 1, 0) });
		// Parked (co-moving with the rock's origin, not turning with it) in front of
		// the -z face, where the turn about +y swings the face's edge into it.
		const start = rockPose(FIELD, rock, 0).pose;
		const local = v3(0.5 * rock.radiusKm, 0, -(rock.radiusKm * 0.35 + shipHalfLen + 0.0002));
		const world = add(scale(start.x, local.x), add(scale(start.y, local.y), scale(start.z, local.z)));
		let met = 0;
		for (let t = 0; t < 60; t += MAX_DT) {
			const now = rockPose(FIELD, rock, t).pose;
			const back = v3(
				world.x * now.x.x + world.y * now.x.y + world.z * now.x.z,
				world.y * 0 + (world.x * now.y.x + world.y * now.y.y + world.z * now.y.z),
				world.x * now.z.x + world.y * now.z.y + world.z * now.z.z,
			);
			const s = shipNear(rock, t, back, v3());
			const r = sweepShip(s, [rockMotion(FIELD, rock, standIn(rock), t, MAX_DT)], MAX_DT);
			for (const i of r.impacts) {
				met++;
				expect(i.closingKms).toBeLessThanOrEqual(0.0061);
				expect(i.damage).toBe(0);
			}
		}
		expect(met).toBeGreaterThan(0);
	});

	test("F4 a drifting rock meets a ship holding station: closing at the drift speed, no damage", () => {
		const rock = makeRock({ radiusKm: 0.1, driftKm: 0.3, driftPeriodS: (2 * Math.PI * 0.3) / 0.002, periodS: 1e9 });
		// The ship holds the field's velocity (not the rock's), in the rock's drift path.
		const t = 0;
		const a = rockPose(FIELD, rock, t);
		const driftVel = sub(a.vel, rockPose(FIELD, makeRock({ ...rock, driftKm: 0 }), t).vel);
		const dir = scale(driftVel, 1 / length(driftVel));
		const ship = shipNear(rock, t, scale(dir, rock.radiusKm * 0.6 + shipHalfLen * 0 + miner.env.beamKm / 2 + 0.0001), scale(driftVel, -1));
		const r = sweepShip(ship, [rockMotion(FIELD, rock, standIn(rock), t, MAX_DT)], MAX_DT);
		for (const i of r.impacts) {
			expect(i.closingKms).toBeLessThanOrEqual(0.0021);
			expect(i.damage).toBe(0);
		}
	});

	test("F5 a ship placed inside a rock (spawn, restore, cruise exit) is a ghost: no damage, no push-out, flies out", () => {
		const rock = makeRock({ radiusKm: 0.3 });
		const ship = shipNear(rock, 0, v3(0, 0, 0.01), v3(0, 0, 0.05));
		const r = sweepShip(ship, [rockMotion(FIELD, rock, standIn(rock), 0, MAX_DT)], MAX_DT);
		expect(r.ghosts).toEqual([0]);
		expect(r.impacts).toEqual([]);
		expect(r.pos).toEqual(ship.end.origin);
	});

	test("F6 both ends of the step come from the clock: the end pose is the pose at t + dt (#43)", () => {
		const rock = makeRock({ driftKm: 0.2, periodS: 600 });
		const m = rockMotion(FIELD, rock, standIn(rock), 1234.5, MAX_DT);
		const later = rockPose(FIELD, rock, 1234.5 + MAX_DT).pose;
		expect(length(sub(m.end.origin, later.origin))).toBe(0);
		// And a surface point's velocity is origin + ω × r, which a stored pose would lose.
		const p = add(later.origin, v3(rock.radiusKm, 0, 0));
		expect(length(sub(surfaceVelocity(FIELD, rock, 1234.5 + MAX_DT, p), rockPose(FIELD, rock, 1234.5 + MAX_DT).vel))).toBeGreaterThan(0);
	});

	test("F7 broadphase by lattice cell finds every rock a brute-force reach test finds", () => {
		const p = PROFILE.charted;
		const cl = cells(p);
		let rand = 7;
		const rnd = () => ((rand = (rand * 1103515245 + 12345) % 2147483648) / 2147483648);
		const rocks: Rock[] = cl.slice(0, 400).map((c, slot) => {
			const radiusKm = 0.025 + rnd() * 0.375, play = Math.max(0, p.cellKm / 2 - radiusKm - p.marginKm / 2);
			return makeRock({ slot, radiusKm, anchor: add(c, v3((rnd() - 0.5) * play, (rnd() - 0.5) * play, 0)), driftKm: play * 0.3 });
		});
		const reach = Math.hypot(miner.env.lengthKm, miner.env.beamKm, miner.env.heightKm) / 2 + 2 * MAX_DT;
		for (let k = 0; k < 500; k++) {
			const q = v3((rnd() - 0.5) * 48, (rnd() - 0.5) * 24, (rnd() - 0.5) * 12);
			const brute = rocks.filter((r) => length(sub(r.anchor, q)) <= reach + r.radiusKm + r.driftKm).map((r) => r.slot);
			const found = candidates(rocks, p.cellKm, q, reach);
			for (const s of brute) expect(found).toContain(s);
		}
	});
});

describe("cruise: a field is a contact, never a mass", () => {
	test("C1 the drop-out radius around a field's centre clears the whole field", () => {
		for (const prof of [PROFILE.charted, PROFILE.rare]) {
			const extent = Math.max(...prof.semiKm) + prof.cellKm * Math.sqrt(3) / 2 + prof.rockRadiusKm[1];
			expect(DEFAULT_CRUISE.dropRadiusKm).toBeGreaterThan(extent);
		}
	});
});

describe("surface: drill, laser and the bound, on a real archetype (provisional: #953 in flight)", () => {
	let arch: Archetype[] = [];
	let fields: Heightfield[] = [];
	beforeAll(async () => {
		arch = await loadArchetypes();
		fields = arch.map((a) => {
			const all = new Float32Array(a.levels.reduce((n, l) => n + l.length, 0));
			let off = 0;
			for (const l of a.levels) { all.set(l, off); off += l.length; }
			return { res: 64, r: outermostExits(all, 64) };
		});
	}, 300_000);
	const surfaceOf = (h: Heightfield, radiusKm: number, origin = v3()): RockSurface => ({
		pose: { origin, x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) },
		radiusKm,
		field: h,
		surfaceVel: () => v3(),
	});

	test("B1 no proxy point lies outside the bound radius (#948 D5)", () => {
		for (const h of fields) expect(Math.max(...h.r)).toBeLessThanOrEqual(1);
	});

	/** Square the ship to the surface along rock-frame direction `d`, cutter
	 *  axis on the local normal, then close until the drill leaves `clear`. */
	function approach(rock: RockSurface, d: V3, shipVel = v3()) {
		const r = radiusAt(rock.field, d) * rock.radiusKm;
		const nn = normalAt(rock.field, d);
		const n = v3(nn[0], nn[1], nn[2]);
		const nose = scale(n, -1);
		const side = Math.abs(nose.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
		const up0 = sub(side, scale(nose, side.x * nose.x + side.y * nose.y + side.z * nose.z));
		const up = scale(up0, 1 / length(up0));
		const surface = v3(d[0] * r, d[1] * r, d[2] * r);
		// The cutter face's centre sits bowKm + feed ahead and downKm below the origin.
		const ahead = CUTTER.bowKm + CUTTER.feedTravelKm;
		const originFor = (gapKm: number) => sub(add(surface, scale(n, gapKm)), sub(scale(nose, ahead), scale(up, CUTTER.downKm)));
		let gap = 0.01;
		let pose = shipPose(originFor(gap), nose, up);
		let state = drillState(pose, shipVel, rock);
		while (state.kind === "clear" && gap > -0.01) {
			gap -= 0.0001;
			pose = shipPose(originFor(gap), nose, up);
			state = drillState(pose, shipVel, rock);
		}
		return { pose, state };
	}
	const fibDirs = (k: number): V3[] => Array.from({ length: k }, (_, i) => { const z = 1 - (2 * (i + 0.5)) / k, rr = Math.sqrt(1 - z * z), t = i * Math.PI * (3 - Math.sqrt(5)); return [rr * Math.cos(t), rr * Math.sin(t), z]; });

	test("D1 the deployed cutter meets a face square-on while the hull box stays clear of it", () => {
		const R = 0.2;
		const tally: Record<string, number> = {};
		let clearHull = 0, contacts = 0;
		fields.forEach((h) => {
			const rock = surfaceOf(h, R);
			for (const d of fibDirs(24)) {
				const { pose, state } = approach(rock, d);
				tally[state.kind] = (tally[state.kind] ?? 0) + 1;
				if (state.kind !== "contact") continue;
				contacts++;
				// Every sampled point of the hull box is outside the surface.
				const hb = [miner.env.beamKm / 2, miner.env.heightKm / 2, miner.env.lengthKm / 2];
				let inside = false;
				for (const sx of [-1, -0.5, 0, 0.5, 1]) for (const sy of [-1, 0, 1]) for (const sz of [-1, -0.5, 0, 0.5, 1]) {
					const p = add(pose.origin, add(scale(pose.x, sx * hb[0]), add(scale(pose.y, sy * hb[1]), scale(pose.z, sz * hb[2]))));
					if (surfaceGapKm(rock, p) <= 0) inside = true;
				}
				if (!inside) clearHull++;
			}
		});
		console.log(`D1 R=200 m, 16 archetypes × 24 approaches square to the local normal: ${JSON.stringify(tally)}; hull clear at contact ${clearHull}/${contacts}`);
		expect(contacts).toBeGreaterThan(0);
		expect(clearHull).toBe(contacts);
	});

	test("D2 a slipping surface is reported, not drilled; matching it drills", () => {
		const R = 0.4;
		const slip = v3(0, 0.006, 0);
		const rock: RockSurface = { ...surfaceOf(fields[0], R), surfaceVel: () => slip };
		let checked = 0;
		for (const d of fibDirs(24)) {
			const { pose, state } = approach(rock, d);
			if (state.kind !== "slipping") continue;
			checked++;
			expect(drillState(pose, slip, rock).kind).toBe("contact");
		}
		expect(checked).toBeGreaterThan(0);
	});

	test("L1 a laser ray hits the proxy within a stated distance of the drawn L0 surface", () => {
		let worst = 0, misses = 0, n = 0;
		const errs: number[] = [];
		const R = 0.2;
		arch.forEach((a, ai) => {
			const rock = surfaceOf(fields[ai], R);
			const tris = a.levels[0];
			for (let k = 0; k < 40; k++) {
				// Rays from 2 km out, aimed at random points inside the bound.
				const u = Math.acos(1 - 2 * ((k * 0.618) % 1)), w = k * 2.399;
				const from = scale(v3(Math.sin(u) * Math.cos(w), Math.sin(u) * Math.sin(w), Math.cos(u)), 2);
				const aim = scale(v3(Math.sin(w), Math.cos(u), Math.sin(u)), 0.5 * R);
				const dir = scale(sub(aim, from), 1 / length(sub(aim, from)));
				const hit = rayHitKm(rock, from, dir, 3);
				// The drawn hit: nearest ray–triangle along the same ray, unit space.
				const nearest = rayFirstHit(tris, [from.x / R, from.y / R, from.z / R], [dir.x, dir.y, dir.z]);
				n++;
				if (hit === null || nearest === Infinity) { if ((hit === null) !== (nearest === Infinity)) misses++; continue; }
				worst = Math.max(worst, Math.abs(hit - nearest * R) / R);
				errs.push(Math.abs(hit - nearest * R) / R);
			}
		});
		errs.sort((x, y) => x - y);
		const q = (p: number) => ((errs[Math.floor(errs.length * p)] ?? 0) * 100).toFixed(2);
		console.log(`L1 rays ${n}: |proxy hit − drawn hit| in % of R: p50 ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, max ${(worst * 100).toFixed(2)}; hit/miss disagreements ${misses}`);
		expect(errs[Math.floor(errs.length * 0.9)]).toBeLessThan(0.02);
	});
});
