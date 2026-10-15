/**
 * Asteroid fields and rocks in the sim (node #965), held to #948 D1–D6 over
 * the corpus worlds. Headless: nothing here draws or collides.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CHARTED_LEAD_KM,
	CHARTED_OFFPLANE_KM,
	DRIFT_CAP_KMS,
	FIELD_GENERATOR_VERSION,
	FIELD_PROFILE,
	type FieldPlan,
	type FieldProfile,
	OUTER_ORBIT_FACTOR,
	RARE_BELT_MIN_PHASE,
	type Rock,
	SPIN_SURFACE_CAP_KMS,
	TROJAN_RAD,
	chartedField,
	fieldBaselineFingerprint,
	fieldCells,
	fieldCentre,
	fieldFingerprintRow,
	fieldFingerprintRows,
	fieldRocks,
	rareField,
	rareFieldPresent,
	rockDriftSpeedKms,
	rockLocal,
	rockLocalVelocity,
	rockPose,
	rockSpinSpeedKms,
	rotateByQuat,
	systemFields,
} from "../src/asteroid-field";
import { DOMAIN } from "../src/domains";
import { type SystemRecord, generateGalaxy } from "../src/galaxy";
import { RELAY_REGION_KM, relayPlan } from "../src/relay-slot";
import { fnv1a } from "../src/rng";
import {
	MAX_ORBIT_AU,
	type SystemContents,
	generateContents,
	orbitNormal,
	positionOnOrbit,
} from "../src/system";
import { AU_KM } from "../src/units";
import { type Vec3, dot, length, sub } from "../src/vec3";
import { WORLD_GENERATOR_VERSION, enumerateCarriers } from "../src/world-state";
import { ALL_GALAXIES, forEachSystem } from "./helpers/station-rows";

/** The view set's world and the fingerprint world (#948's own corpus pair). */
const WORLDS = [47, 0x5ee11e] as const;
const FINGERPRINT_WORLD = 0x5ee11e;

interface Row {
	world: number;
	galaxy: number;
	record: SystemRecord;
	contents: SystemContents;
	fields: FieldPlan[];
}

const corpus: Row[] = [];
for (const world of WORLDS)
	forEachSystem(world, ALL_GALAXIES, (record, contents, galaxy) =>
		corpus.push({
			world,
			galaxy,
			record,
			contents,
			fields: systemFields(record, contents),
		}),
	);

const TAU = Math.PI * 2;
/** An angle folded into (−π, π]. */
const wrap = (a: number): number => {
	const r = (((a + Math.PI) % TAU) + TAU) % TAU;
	return r - Math.PI;
};

/** Every eighth system's fields with their rocks: the sampled set the
 *  pairwise and motion rows walk, so the suite stays inside its budget. */
const sampled = corpus
	.filter((row) => row.record.index % 8 === 0)
	.flatMap((row) =>
		row.fields.map((plan) => ({
			row,
			plan,
			rocks: fieldRocks(row.record, plan),
		})),
	);

/**
 * One pass over every rock in the corpus, keeping the worst case of each bound
 * rather than asserting per rock: 360,000 rocks at several `expect`s each is
 * most of the file's run time for no extra evidence.
 */
const census = {
	rocks: 0,
	counts: { charted: [] as number[], rare: [] as number[] },
	belowMinKm: Number.POSITIVE_INFINITY,
	aboveMaxKm: Number.POSITIVE_INFINITY,
	cellSlackKm: Number.POSITIVE_INFINITY,
	driftKms: 0,
	spinKms: 0,
};
for (const { record, fields } of corpus)
	for (const plan of fields) {
		const p = FIELD_PROFILE[plan.profile];
		const cells = fieldCells(p);
		const rocks = fieldRocks(record, plan);
		census.counts[plan.profile].push(rocks.length);
		for (const rock of rocks) {
			census.rocks++;
			census.belowMinKm = Math.min(
				census.belowMinKm,
				rock.radiusKm - p.rockRadiusKm[0],
			);
			census.aboveMaxKm = Math.min(
				census.aboveMaxKm,
				p.rockRadiusKm[1] - rock.radiusKm,
			);
			const stray = length(sub(rock.anchor, cells[rock.slot]));
			census.cellSlackKm = Math.min(
				census.cellSlackKm,
				p.cellKm / 2 - (stray + rock.driftKm + rock.radiusKm + p.marginKm / 2),
			);
			census.driftKms = Math.max(census.driftKms, rockDriftSpeedKms(rock));
			census.spinKms = Math.max(census.spinKms, rockSpinSpeedKms(rock));
		}
	}

describe("domain tags (#948 D1)", () => {
	test("the four asteroid tags are appended after every existing one", () => {
		// #948 numbered them 38–41; `NEBULA` (#685) took 38 first. Appending
		// after it is the only order that changes no existing tag.
		expect([
			DOMAIN.ASTEROID_FIELD_ROLL,
			DOMAIN.ASTEROID_FIELD,
			DOMAIN.ASTEROID_ROCKS,
			DOMAIN.ASTEROID_DEPOSIT,
		]).toEqual([39, 40, 41, 42]);
		expect(DOMAIN.MODULE_STOCK).toBe(37);
		expect(DOMAIN.NEBULA).toBe(38);
		const older = Object.entries(DOMAIN)
			.filter(([name]) => !name.startsWith("ASTEROID_"))
			.map(([, tag]) => tag as number);
		expect(Math.max(...older)).toBe(38);
	});
});

describe("charted fields (#948 D3)", () => {
	test("field-00 exists exactly where a refinery does", () => {
		for (const { record, contents, fields } of corpus) {
			const refinery = contents.stations.some((s) => s.type === "refinery");
			const charted = chartedField(record, contents);
			expect(charted !== null).toBe(refinery);
			expect(fields.some((f) => f.id === "field-00")).toBe(refinery);
		}
	});

	test("its centre is on the refinery's orbit, 150–300 km from it and ±30 km off the plane", () => {
		let n = 0;
		for (const { record, contents } of corpus) {
			const plan = chartedField(record, contents);
			if (!plan) continue;
			n++;
			const refinery = contents.stations.find((s) => s.type === "refinery");
			if (!refinery) throw new Error("unreachable");
			expect(plan.kind).toBe("refinery-orbit");
			expect(plan.hostId).toBe(refinery.id);
			expect(refinery.parentId).toBeNull();
			// The same orbit, phase-shifted: co-periodic, so the gap is forever.
			expect({ ...plan.orbit, theta0: 0 }).toEqual({
				...refinery.orbit,
				theta0: 0,
			});
			const leadKm =
				Math.abs(wrap(plan.orbit.theta0 - refinery.orbit.theta0)) *
				refinery.orbit.radiusKm;
			expect(leadKm).toBeGreaterThanOrEqual(CHARTED_LEAD_KM[0] - 1e-6);
			expect(leadKm).toBeLessThanOrEqual(CHARTED_LEAD_KM[1] + 1e-6);
			expect(Math.abs(plan.offPlaneKm)).toBeLessThanOrEqual(
				CHARTED_OFFPLANE_KM,
			);
			for (const t of [0, 3.7e6, 1.9e8]) {
				const gap = sub(
					fieldCentre(plan, t),
					positionOnOrbit(refinery.orbit, t),
				);
				const off = dot(gap, orbitNormal(refinery.orbit));
				expect(off).toBeCloseTo(plan.offPlaneKm, 4);
				const along = Math.sqrt(length(gap) ** 2 - off ** 2);
				// A chord of the arc: at an AU's radius it is the arc to well under
				// a metre.
				expect(along).toBeGreaterThan(CHARTED_LEAD_KM[0] - 0.01);
				expect(along).toBeLessThan(CHARTED_LEAD_KM[1] + 0.01);
			}
		}
		expect(n).toBeGreaterThan(1000);
	});

	test("the relay never watches a refinery, so no charted field sits in its region", () => {
		// #948 D3: the lead band (≥ 150 km) does not clear `RELAY_REGION_KM`, so
		// what keeps the two apart is that every system has a trade station and
		// the relay watches it first (`relay-slot.ts`'s watch order).
		expect(CHARTED_LEAD_KM[0]).toBeLessThan(RELAY_REGION_KM);
		let watchedRefinery = 0;
		for (const { record, contents } of corpus) {
			const relay = relayPlan(contents, record.seed);
			const refinery = contents.stations.find((s) => s.type === "refinery");
			if (relay && refinery && relay.watchedStationId === refinery.id)
				watchedRefinery++;
		}
		expect(watchedRefinery).toBe(0);
	});
});

describe("rare fields (#948 D4)", () => {
	test("field-01 is the roll, at about 0.20 a system", () => {
		let present = 0;
		for (const { record, contents, fields } of corpus) {
			const roll = rareFieldPresent(record);
			if (roll) present++;
			expect(rareField(record, contents) !== null).toBe(roll);
			expect(fields.some((f) => f.id === "field-01")).toBe(roll);
		}
		// 4,096 systems: one standard error is 0.006, so this band is five.
		const rate = present / corpus.length;
		expect(rate).toBeGreaterThan(0.17);
		expect(rate).toBeLessThan(0.23);
	});

	test("each branch is taken where #948 D4 says, and every branch is taken", () => {
		const seen = new Set<string>();
		for (const { record, contents } of corpus) {
			const plan = rareField(record, contents);
			if (!plan) continue;
			seen.add(plan.kind);
			const giants = contents.planets.filter((p) => p.isGasGiant);
			if (contents.belt) {
				expect(plan.kind).toBe("belt");
				const refinery = contents.stations.find((s) => s.type === "refinery");
				if (!refinery) throw new Error("a belt without a refinery");
				expect({ ...plan.orbit, theta0: 0 }).toEqual({
					...refinery.orbit,
					theta0: 0,
				});
				expect(
					Math.abs(wrap(plan.orbit.theta0 - refinery.orbit.theta0)),
				).toBeGreaterThanOrEqual(RARE_BELT_MIN_PHASE - 1e-12);
				continue;
			}
			if (plan.kind === "outer-orbit") {
				expect(giants).toHaveLength(0);
				const outer = Math.max(...contents.planets.map((p) => p.aAu));
				const aAu = plan.orbit.radiusKm / AU_KM;
				expect(aAu).toBeLessThanOrEqual(MAX_ORBIT_AU);
				expect(aAu / outer).toBeGreaterThanOrEqual(
					OUTER_ORBIT_FACTOR[0] - 1e-12,
				);
				expect(aAu / outer).toBeLessThanOrEqual(OUTER_ORBIT_FACTOR[1] + 1e-12);
				continue;
			}
			// A Trojan: a giant's where one exists, else the outermost planet's.
			expect(plan.kind).toBe(giants.length > 0 ? "trojan" : "outer-trojan");
			const host = contents.planets.find((p) => p.id === plan.hostId);
			if (!host) throw new Error(`no host ${plan.hostId}`);
			if (plan.kind === "trojan") expect(host.isGasGiant).toBe(true);
			else
				expect(host.aAu).toBe(Math.max(...contents.planets.map((p) => p.aAu)));
			expect(plan.orbit.radiusKm).toBe(host.orbit.radiusKm);
			expect(
				Math.abs(
					Math.abs(wrap(plan.orbit.theta0 - host.orbit.theta0)) - TROJAN_RAD,
				),
			).toBeLessThan(1e-9);
			// Never on the outpost's own Trojan point.
			const outpost = contents.stations.find((s) => s.type === "outpost");
			if (outpost && outpost.orbit.radiusKm === host.orbit.radiusKm)
				expect(
					Math.abs(wrap(plan.orbit.theta0 - outpost.orbit.theta0)),
				).toBeGreaterThan(1);
		}
		expect([...seen].sort()).toEqual([
			"belt",
			"outer-orbit",
			"outer-trojan",
			"trojan",
		]);
	});

	test("the draw budget is fixed: a system gaining a belt moves no other draw", () => {
		let n = 0;
		for (const { record, contents } of corpus) {
			const plan = rareField(record, contents);
			if (!plan || plan.kind !== "belt") continue;
			n++;
			const beltless = rareField(record, { ...contents, belt: null });
			if (!beltless) throw new Error("the roll moved");
			expect(beltless.kind).not.toBe("belt");
			expect(beltless.rotation).toEqual(plan.rotation);
			expect(beltless.offPlaneKm).toBe(plan.offPlaneKm);
			expect(fieldRocks(record, beltless)).toEqual(fieldRocks(record, plan));
		}
		expect(n).toBeGreaterThan(100);
	});
});

describe("rocks: size, cell and margin (#948 D5)", () => {
	test("the largest rock fits its cell", () => {
		for (const p of Object.values(FIELD_PROFILE))
			expect(p.rockRadiusKm[1]).toBeLessThanOrEqual(
				p.cellKm / 2 - p.marginKm / 2,
			);
	});

	test("every radius is inside its profile's range, and the rock with its half-margin stays inside its cell", () => {
		expect(census.rocks).toBeGreaterThan(300_000);
		// Worst signed slack, km: negative is a rock outside its bound.
		expect(census.belowMinKm).toBeGreaterThanOrEqual(-1e-12);
		expect(census.aboveMaxKm).toBeGreaterThanOrEqual(-1e-12);
		expect(census.cellSlackKm).toBeGreaterThanOrEqual(-1e-9);
	});

	test("rock counts sit in #948 D5's spread", () => {
		const median = (xs: number[]) =>
			[...xs].sort((a, b) => a - b)[xs.length >> 1];
		expect(median(census.counts.charted)).toBeGreaterThan(170);
		expect(median(census.counts.charted)).toBeLessThan(200);
		expect(median(census.counts.rare)).toBeGreaterThan(80);
		expect(median(census.counts.rare)).toBeLessThan(100);
	});

	test("no two rocks of a field come closer than the margin, at sampled times", () => {
		let pairs = 0;
		let worst = Number.POSITIVE_INFINITY;
		for (const { plan, rocks } of sampled) {
			const p = FIELD_PROFILE[plan.profile];
			for (const t of [0, 5_400, 1.3e7]) {
				const at = rocks.map((r) => rockLocal(r, t));
				for (let i = 0; i < rocks.length; i++)
					for (let j = i + 1; j < rocks.length; j++) {
						const d = length(sub(at[i], at[j]));
						if (d > 2 * p.cellKm) continue;
						pairs++;
						worst = Math.min(
							worst,
							d - rocks[i].radiusKm - rocks[j].radiusKm - p.marginKm,
						);
					}
			}
		}
		expect(pairs).toBeGreaterThan(100_000);
		// The least surface gap over the margin, km.
		expect(worst).toBeGreaterThanOrEqual(-1e-9);
	});
});

describe("rocks: closed-form motion (#948 D5)", () => {
	test("drift ≤ 2 m/s and equatorial spin ≤ 6 m/s, on every rock", () => {
		expect(census.driftKms).toBeLessThanOrEqual(DRIFT_CAP_KMS * (1 + 1e-12));
		expect(census.spinKms).toBeLessThanOrEqual(
			SPIN_SURFACE_CAP_KMS * (1 + 1e-12),
		);
	});

	test("position is centre(t) + R·(anchor + drift(t))", () => {
		for (const { plan, rocks } of sampled.slice(0, 40))
			for (const rock of rocks.slice(0, 20))
				for (const t of [0, 777.7, 4.4e7]) {
					const centre = fieldCentre(plan, t);
					const local = rotateByQuat(plan.rotation, rockLocal(rock, t));
					const { pos } = rockPose(plan, rock, t);
					expect(pos.x).toBe(centre.x + local.x);
					expect(pos.y).toBe(centre.y + local.y);
					expect(pos.z).toBe(centre.z + local.z);
				}
	});

	test("the field rotation is a rotation: unit, and length-preserving", () => {
		for (const { plan } of sampled) {
			const q = plan.rotation;
			expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
			const v = { x: 1.5, y: -2, z: 0.25 };
			expect(length(rotateByQuat(q, v))).toBeCloseTo(length(v), 12);
		}
	});

	test("velocity is the exact derivative, against a finite difference", () => {
		const h = 0.5;
		const fd = (f: (t: number) => Vec3, t: number): Vec3 => {
			const a = f(t - h);
			const b = f(t + h);
			return {
				x: (b.x - a.x) / (2 * h),
				y: (b.y - a.y) / (2 * h),
				z: (b.z - a.z) / (2 * h),
			};
		};
		let worstLocal = 0;
		let worstWorld = 0;
		for (const { plan, rocks } of sampled.slice(0, 60))
			for (const rock of rocks.slice(0, 10))
				for (const t of [100, 9_999, 3.3e6]) {
					// Field frame: small numbers, so the difference is sharp.
					const exact = rockLocalVelocity(rock, t);
					const approx = fd((s) => rockLocal(rock, s), t);
					worstLocal = Math.max(worstLocal, length(sub(exact, approx)));
					// Star-centric: ~10⁸ km positions, so rounding sets the floor.
					const pose = rockPose(plan, rock, t);
					const world = fd((s) => rockPose(plan, rock, s).pos, t);
					worstWorld = Math.max(worstWorld, length(sub(pose.vel, world)));
				}
		// km/s: 1 µm/s, three orders under the 2 m/s cap; the floor is the
		// phase argument's rounding at large t, not the derivative.
		expect(worstLocal).toBeLessThan(1e-9);
		expect(worstWorld).toBeLessThan(1e-6); // km/s: 1 mm/s
	});

	test("nothing is integrated: a pose is the same whatever was asked before it", () => {
		const { plan, rocks } = sampled[0];
		const rock = rocks[0];
		const late = rockPose(plan, rock, 8.8e6);
		rockPose(plan, rock, 1);
		rockPose(plan, rock, 1e9);
		expect(rockPose(plan, rock, 8.8e6)).toEqual(late);
	});
});

describe("slot stability (#948 D2)", () => {
	test("raising the occupancy by 0.1 moves no rock that was there", () => {
		let before = 0;
		let after = 0;
		for (const { row, plan, rocks } of sampled) {
			const base = FIELD_PROFILE[plan.profile];
			const fuller: FieldProfile = { ...base, occupancy: base.occupancy + 0.1 };
			const more = new Map(
				fieldRocks(row.record, plan, fuller).map((r) => [r.slot, r]),
			);
			before += rocks.length;
			after += more.size;
			for (const rock of rocks) expect(more.get(rock.slot)).toEqual(rock);
		}
		expect(after).toBeGreaterThan(before * 1.2);
	});
});

describe("identity and versions (#948 D6)", () => {
	test("fields are not carriers, and the world generator stays at 10", () => {
		expect(WORLD_GENERATOR_VERSION).toBe(10);
		expect(FIELD_GENERATOR_VERSION).toBe(1);
		for (const c of enumerateCarriers(FINGERPRINT_WORLD, 0))
			expect(c.localCarrierId.startsWith("field-")).toBe(false);
		// Nothing the carrier roster or the body list is built from reads the
		// field module.
		for (const file of ["src/system.ts", "src/world-state.ts", "src/sim.ts"])
			expect(readFileSync(file, "utf8")).not.toContain("asteroid-field");
	});

	test("the module is headless: it imports no renderer and nothing that saves", () => {
		const src = readFileSync("src/asteroid-field.ts", "utf8");
		const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
		expect(imports.sort()).toEqual([
			"./domains",
			"./galaxy",
			"./rng",
			"./system",
			"./units",
			"./vec3",
		]);
	});

	test("the field fingerprint is pinned per galaxy", () => {
		// A change that moves, resizes or re-slots any rock turns this red; it
		// owes a FIELD_GENERATOR_VERSION bump and #951's deposit migration.
		expect(
			ALL_GALAXIES.map((g) => fieldBaselineFingerprint(FINGERPRINT_WORLD, g)),
		).toEqual([
			0xa39e51cc, 0xdb6e00e4, 0xef5a4868, 0x858546ef, 0x5cc3d712, 0xd77c9822,
			0xe0e1cd4b, 0x65f648c9,
		]);
	});

	test("failure case: one rock moved a millimetre turns its galaxy's pin red", () => {
		const pinned = fieldBaselineFingerprint(FINGERPRINT_WORLD, 0);
		const rows: string[] = [];
		const lines = (moved: (r: Rock) => Rock): string => {
			rows.length = 0;
			let first = true;
			for (const record of generateGalaxy(FINGERPRINT_WORLD, 0).systems) {
				const contents = generateContents(record);
				for (const plan of systemFields(record, contents))
					for (const rock of fieldRocks(record, plan)) {
						rows.push(
							fieldFingerprintRow(
								record.index,
								plan,
								first ? moved(rock) : rock,
							),
						);
						first = false;
					}
			}
			return rows.join("\n");
		};
		// The unmoved rows are the pin, so the row builder is the one the pin uses.
		expect(fnv1a(lines((r) => r))).toBe(pinned);
		const nudged = fnv1a(
			lines((r) => ({ ...r, anchor: { ...r.anchor, x: r.anchor.x + 0.001 } })),
		);
		expect(nudged).not.toBe(pinned);
		const grown = fnv1a(lines((r) => ({ ...r, radiusKm: r.radiusKm + 0.001 })));
		expect(grown).not.toBe(pinned);
	});

	test("a system's rows are its fields' rocks, in slot order", () => {
		const { record, contents, fields } = sampled[0].row;
		const rows = fieldFingerprintRows(record, contents);
		expect(rows.length).toBe(
			fields.reduce((n, plan) => n + fieldRocks(record, plan).length, 0),
		);
		expect(rows[0].startsWith(`${record.index}|${fields[0].id}|`)).toBe(true);
	});
});
