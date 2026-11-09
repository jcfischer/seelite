import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CHARTED_LEAD_KM,
	CHARTED_OFFPLANE_KM,
	DRIFT_CAP_KMS,
	FIELD_GENERATOR_VERSION,
	FIELD_EXTENT_KM,
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
	fieldCentre,
	fieldFingerprintRow,
	fieldFingerprintRows,
	fieldRocks,
	latticeRocks,
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
const wrap = (a: number): number => {
	const r = (((a + Math.PI) % TAU) + TAU) % TAU;
	return r - Math.PI;
};

const sampled = corpus
	.filter((row) => row.record.index % 8 === 0)
	.flatMap((row) =>
		row.fields.map((plan) => ({
			row,
			plan,
			rocks: fieldRocks(row.record, plan),
		})),
	);

const census = {
	rocks: 0,
	counts: { charted: [] as number[], rare: [] as number[] },
	belowMinKm: Number.POSITIVE_INFINITY,
	aboveMaxKm: Number.POSITIVE_INFINITY,
	extentSlackKm: Number.POSITIVE_INFINITY,
	driftKms: 0,
	spinKms: 0,
};
for (const { record, fields } of corpus.filter(
	(row) => row.record.index % 4 === 0,
))
	for (const plan of fields) {
		const p = FIELD_PROFILE[plan.profile];
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
			census.extentSlackKm = Math.min(
				census.extentSlackKm,
				FIELD_EXTENT_KM[plan.profile] -
					(length(rock.anchor) + rock.driftKm + rock.radiusKm),
			);
			census.driftKms = Math.max(census.driftKms, rockDriftSpeedKms(rock));
			census.spinKms = Math.max(census.spinKms, rockSpinSpeedKms(rock));
		}
	}

describe("domain tags (#948 D1)", () => {
	test("the four asteroid tags are appended after every existing one", () => {
		expect([
			DOMAIN.ASTEROID_FIELD_ROLL,
			DOMAIN.ASTEROID_FIELD,
			DOMAIN.ASTEROID_ROCKS,
			DOMAIN.ASTEROID_DEPOSIT,
		]).toEqual([39, 40, 41, 42]);
		expect(DOMAIN.MODULE_STOCK).toBe(37);
		expect(DOMAIN.NEBULA).toBe(38);
		const older = Object.values(DOMAIN).slice(
			0,
			Object.keys(DOMAIN).indexOf("ASTEROID_FIELD_ROLL"),
		);
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
				expect(along).toBeGreaterThan(CHARTED_LEAD_KM[0] - 0.01);
				expect(along).toBeLessThan(CHARTED_LEAD_KM[1] + 0.01);
			}
		}
		expect(n).toBeGreaterThan(1000);
	});

	test("the relay never watches a refinery, so no charted field sits in its region", () => {
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

describe("rocks: size, arrangement and margin (#948 D5, #1209)", () => {
	test("every radius is inside its profile's range, and every rock inside its field's extent", () => {
		expect(census.rocks).toBeGreaterThan(200_000);
		expect(census.belowMinKm).toBeGreaterThanOrEqual(-1e-12);
		expect(census.aboveMaxKm).toBeGreaterThanOrEqual(-1e-12);
		expect(census.extentSlackKm).toBeGreaterThanOrEqual(0);
	});

	test("rock counts sit in the study's spread (provisional pending #923)", () => {
		const median = (xs: number[]) =>
			[...xs].sort((a, b) => a - b)[xs.length >> 1];
		expect(median(census.counts.charted)).toBeGreaterThan(600);
		expect(median(census.counts.charted)).toBeLessThan(680);
		expect(median(census.counts.rare)).toBeGreaterThan(290);
		expect(median(census.counts.rare)).toBeLessThan(335);
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
					const exact = rockLocalVelocity(rock, t);
					const approx = fd((s) => rockLocal(rock, s), t);
					worstLocal = Math.max(worstLocal, length(sub(exact, approx)));
					const pose = rockPose(plan, rock, t);
					const world = fd((s) => rockPose(plan, rock, s).pos, t);
					worstWorld = Math.max(worstWorld, length(sub(pose.vel, world)));
				}
		expect(worstLocal).toBeLessThan(1e-9);
		expect(worstWorld).toBeLessThan(1e-6);
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

describe("slot stability of the bank (#948 D2)", () => {
	test("the lattice generator's occupancy moves no rock that was there", () => {
		for (const { row, plan } of sampled.slice(0, 16)) {
			const base = FIELD_PROFILE[plan.profile];
			const fuller: FieldProfile = { ...base, occupancy: base.occupancy + 0.1 };
			const more = new Map(
				latticeRocks(row.record, plan, fuller).map((r) => [r.slot, r]),
			);
			for (const rock of latticeRocks(row.record, plan))
				expect(more.get(rock.slot)).toEqual(rock);
		}
	});
});

describe("identity and versions (#948 D6)", () => {
	test("fields are not carriers, and the world generator is 11", () => {
		expect(WORLD_GENERATOR_VERSION).toBe(11);
		expect(FIELD_GENERATOR_VERSION).toBe(2);
		for (const c of enumerateCarriers(FINGERPRINT_WORLD, 0))
			expect(c.localCarrierId.startsWith("field-")).toBe(false);
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

	test("fingerprint floats use six decimals; ids and integers keep their representation", () => {
		const { row, plan, rocks } = sampled[0];
		const rock = rocks[0];
		const columns = fieldFingerprintRow(row.record.index, plan, rock).split(
			"|",
		);
		expect(columns.slice(0, 4)).toEqual([
			String(row.record.index),
			plan.id,
			plan.kind,
			String(rock.slot),
		]);
		expect(columns[18]).toBe(String(rock.shapeSeed));
		for (const column of [...columns.slice(4, 18), ...columns.slice(19)])
			expect(column).toMatch(/^-?\d+\.\d{6}$/);
		expect(
			fieldFingerprintRow(row.record.index, plan, {
				...rock,
				anchor: {
					...rock.anchor,
					x: rock.anchor.x + Number.EPSILON * Math.abs(rock.anchor.x),
				},
			}),
		).toBe(columns.join("|"));
	});

	test("the field fingerprint is pinned per galaxy", () => {
		expect(
			ALL_GALAXIES.map((g) => fieldBaselineFingerprint(FINGERPRINT_WORLD, g)),
		).toEqual([
			0x9d5e2621, 0xcb56a860, 0x495307ba, 0xaeb9ab1f, 0xd01dac7d, 0x8d976f87,
			0x10ff4c6a, 0x910765b4,
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
		expect(fnv1a(lines((r) => r))).toBe(pinned);
		const nudged = fnv1a(
			lines((r) => ({
				...r,
				anchor: { ...r.anchor, x: r.anchor.x + 0.000001 },
			})),
		);
		expect(nudged).not.toBe(pinned);
		const grown = fnv1a(lines((r) => ({ ...r, radiusKm: r.radiusKm + 0.001 })));
		expect(grown).not.toBe(pinned);
	});

	test("failure case: changing charted lead changes the galaxy pin with identical local rocks", () => {
		const rows: string[] = [];
		let changedLine = -1;
		let movedLine = "";
		for (const record of generateGalaxy(FINGERPRINT_WORLD, 0).systems) {
			for (const plan of systemFields(record, generateContents(record))) {
				for (const rock of fieldRocks(record, plan)) {
					if (changedLine < 0 && plan.kind === "refinery-orbit") {
						const moved: FieldPlan = {
							...plan,
							orbit: {
								...plan.orbit,
								theta0: plan.orbit.theta0 + 50 / plan.orbit.radiusKm,
							},
						};
						expect(fieldRocks(record, moved)).toEqual(fieldRocks(record, plan));
						expect(
							length(
								sub(rockPose(moved, rock, 0).pos, rockPose(plan, rock, 0).pos),
							),
						).toBeGreaterThan(49);
						changedLine = rows.length;
						movedLine = fieldFingerprintRow(record.index, moved, rock);
					}
					rows.push(fieldFingerprintRow(record.index, plan, rock));
				}
			}
		}
		expect(changedLine).toBeGreaterThanOrEqual(0);
		const pinned = fieldBaselineFingerprint(FINGERPRINT_WORLD, 0);
		expect(fnv1a(rows.join("\n"))).toBe(pinned);
		rows[changedLine] = movedLine;
		expect(fnv1a(rows.join("\n"))).not.toBe(pinned);
	});

	test("every placement, shape and motion input affects the fingerprint", () => {
		const nudge = (n: number): number =>
			n + Math.max(1e-6, Math.abs(n) * Number.EPSILON * 2);
		for (const { row, plan, rocks } of sampled.slice(0, 5)) {
			const rock = rocks[0];
			const hash = (p: FieldPlan, r: Rock): number =>
				fnv1a(fieldFingerprintRow(row.record.index, p, r));
			const baseline = hash(plan, rock);
			for (const key of [
				"radiusKm",
				"periodS",
				"theta0",
				"inclination",
				"node",
			] as const)
				expect(
					hash(
						{
							...plan,
							orbit: { ...plan.orbit, [key]: nudge(plan.orbit[key]) },
						},
						rock,
					),
				).not.toBe(baseline);
			expect(
				hash({ ...plan, offPlaneKm: nudge(plan.offPlaneKm) }, rock),
			).not.toBe(baseline);
			for (const key of ["x", "y", "z", "w"] as const)
				expect(
					hash(
						{
							...plan,
							rotation: { ...plan.rotation, [key]: nudge(plan.rotation[key]) },
						},
						rock,
					),
				).not.toBe(baseline);
			for (const key of ["slot", "shapeSeed"] as const)
				expect(hash(plan, { ...rock, [key]: rock[key] + 1 })).not.toBe(
					baseline,
				);
			for (const key of [
				"radiusKm",
				"driftKm",
				"driftPeriodS",
				"driftPhase",
				"spinPeriodS",
				"spinPhase",
			] as const)
				expect(hash(plan, { ...rock, [key]: nudge(rock[key]) })).not.toBe(
					baseline,
				);
			for (const key of ["anchor", "e1", "e2", "spinAxis"] as const)
				for (const axis of ["x", "y", "z"] as const)
					expect(
						hash(plan, {
							...rock,
							[key]: { ...rock[key], [axis]: nudge(rock[key][axis]) },
						}),
					).not.toBe(baseline);
		}
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
