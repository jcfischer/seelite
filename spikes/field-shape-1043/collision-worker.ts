import { mock } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import * as field from "../../src/asteroid-field";
import { generateGalaxy, type SystemRecord } from "../../src/galaxy";
import { generateContents } from "../../src/system";
import { HULL_SPECS } from "../../src/hull";
import {
	mayMeet,
	reachKm,
	shipPrimitives,
	solidReach,
	type Reach,
} from "../../src/collision";
import { decodeRockHeightfields } from "../../src/rock-heightfields";
import { buildRockPieces } from "../../src/rock-pieces";
import { add, length, scale, type Vec3 } from "../../src/vec3";
import {
	CANDIDATES,
	candidateProfile,
	candidateRocks,
	type Candidate,
} from "./profiles";

const name = process.argv[2] as Candidate;
if (!CANDIDATES.includes(name)) throw new Error("unknown candidate");
const mode = process.argv[3];
if (mode !== "native" && mode !== "adapted") throw new Error("unknown mode");
if (mode === "native" && name !== "baseline")
	throw new Error("native means baseline");
const verifyOnly = process.argv[4] === "verify";
const drop = process.argv[5] === "drop";
const original = { ...field };
const profiles = {
	charted: candidateProfile("charted", name),
	rare: candidateProfile("rare", name),
};
const maximumSemi = {
	charted: candidateProfile("charted", "broken").semiKm[0],
	rare: candidateProfile("rare", "broken").semiKm[0],
};
const seed = 0x5ee11e;
const galaxy = generateGalaxy(seed, 0);
const fixtures = [
	{ index: 173, kind: "charted" as const },
	{ index: 0, kind: "rare" as const },
].map(({ index, kind }) => {
	const record = galaxy.systems[index];
	const contents = generateContents(record);
	const plans = original.systemFields(record, contents);
	const plan = plans.find((p) => p.profile === kind);
	if (!plan) throw new Error(`missing ${kind} fixture`);
	const rows = plans.map((plan) => ({
		plan,
		rocks: candidateRocks(record, plan, name),
	}));
	return { index, kind, record, contents, plans, plan, rows };
});

if (mode === "adapted")
	mock.module(import.meta.resolve("../../src/asteroid-field"), () => ({
		...original,
		FIELD_PROFILE: profiles,
		fieldRocks: (record: SystemRecord, plan: field.FieldPlan) => {
			const rocks = candidateRocks(record, plan, name, {
				profile: profiles[plan.profile],
				generate: original.fieldRocks,
			});
			return drop ? rocks.slice(1) : rocks;
		},
	}));

const collision = await import("../../src/field-collision");
const { makeSystem } = await import("../../src/sim");
const loadBefore = loadavg();
const bytes = readFileSync("src/models/rock-heightfields.bin");
const shapes = decodeRockHeightfields(new Uint8Array(bytes));
collision.setRockShapeSource(() => shapes);
const buildAt = performance.now();
await collision.prebuildRockPieces(async (_archetype, shape) =>
	buildRockPieces(shape),
);
const prebuildMs = performance.now() - buildAt;
const hullReach = reachKm(shipPrimitives(HULL_SPECS.miner, false));
const clock = { fromTime: 1000, toTime: 1000.1 };
const step: Vec3 = { x: 0.1, y: 0, z: 0 };
const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const summarize = (result: ReturnType<typeof collision.fieldRockSolids>) => ({
	count: result.owner.length,
	owners: [...result.owner].sort(),
	signature: hash(
		result.owner
			.map((owner, i) => ({
				owner,
				radius: result.motions[i].radiusKm,
				start: result.motions[i].start,
				end: result.motions[i].end,
				velStart: result.motions[i].velStart,
				velEnd: result.motions[i].velEnd,
				pieceCount: result.motions[i].pieces.pieces.length,
			}))
			.sort((a, b) => a.owner.localeCompare(b.owner)),
	),
});
const measurements = [];
const workloads: {
	kind: field.FieldProfileName;
	index: number;
	system: ReturnType<typeof makeSystem>;
	query: { name: string; group: string; ship: Reach };
	count: number;
}[] = [];
const verification = { fixtures: [] as unknown[] };
const blocks = 11;
const iterations = 64;

for (const fixture of fixtures) {
	const { plan, record, rows, kind, index } = fixture;
	const rocks = rows.find((r) => r.plan.id === plan.id)!.rocks;
	if (!rocks.length) throw new Error("empty candidate fixture");
	const system = makeSystem(record, clock.fromTime);
	const point = (local: Vec3, time: number) =>
		add(
			original.fieldCentre(plan, time),
			original.rotateByQuat(plan.rotation, local),
		);
	const localQuery = (a: Vec3, b: Vec3, reach = hullReach): Reach => ({
		start: point(a, clock.fromTime),
		end: point(b, clock.toTime),
		reachKm: reach,
	});
	const atRock = (rock: field.Rock): Reach => ({
		start: original.rockPose(plan, rock, clock.fromTime).pos,
		end: add(
			original.rockPose(plan, rock, clock.toTime).pos,
			original.rotateByQuat(plan.rotation, step),
		),
		reachKm: hullReach,
	});
	const baseline = original.FIELD_PROFILE[kind];
	const maximum = maximumSemi[kind];
	const edgeRock = rocks.reduce((a, b) =>
		length(b.anchor) > length(a.anchor) ? b : a,
	);
	const queries = [
		{
			name: "centre",
			group: "common",
			ship: localQuery({ x: 0, y: 0, z: 0 }, step),
		},
		{
			name: "baseline-edge",
			group: "common",
			ship: localQuery(
				{ x: baseline.semiKm[0] + baseline.cellKm, y: 0, z: 0 },
				{ x: baseline.semiKm[0] + baseline.cellKm + step.x, y: 0, z: 0 },
			),
		},
		{
			name: "far",
			group: "common",
			ship: localQuery(
				{ x: maximum * 4 + 10, y: 0, z: 0 },
				{ x: maximum * 4 + 10 + step.x, y: 0, z: 0 },
			),
		},
		{ name: "occupied", group: "candidate-targeted", ship: atRock(rocks[0]) },
		{
			name: "occupied-edge",
			group: "candidate-targeted",
			ship: atRock(edgeRock),
		},
		{
			name: "cross-field-stress",
			group: "synthetic-stress",
			ship: localQuery(
				{ x: -maximum - 10, y: 0, z: 0 },
				{ x: maximum + 10, y: 0, z: 0 },
			),
		},
		{
			name: "enclosing-stress",
			group: "synthetic-stress",
			ship: localQuery({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, maximum * 2),
		},
	];
	const verified = [];
	for (const query of queries) {
		const actual = collision.fieldRockSolids(system, query.ship, clock);
		const expected = {
			owner: [] as string[],
			motions: [] as ReturnType<typeof collision.rockSolid>[],
		};
		for (const row of rows)
			for (const rock of row.rocks) {
				const solid = collision.rockSolid(row.plan, rock, clock);
				if (
					!mayMeet(query.ship, {
						start: solid.start.origin,
						end: solid.end.origin,
						reachKm: solidReach(solid),
					})
				)
					continue;
				expected.owner.push(collision.rockId(row.plan, rock));
				expected.motions.push(solid);
			}
		const actualSummary = summarize(actual);
		if (JSON.stringify(actualSummary) !== JSON.stringify(summarize(expected)))
			throw new Error(`oracle mismatch: ${name}/${kind}/${query.name}`);
		verified.push({
			name: query.name,
			group: query.group,
			ship: query.ship,
			...actualSummary,
		});
		workloads.push({ kind, index, system, query, count: actual.owner.length });
	}
	verification.fixtures.push({
		kind,
		system: index,
		rocks: rocks.length,
		layoutHash: hash(rocks),
		queries: verified,
	});
}

if (!verifyOnly)
	for (const { kind, index, system, query, count } of workloads) {
		let coldWarmupReturned = 0;
		for (let i = 0; i < 16; i++)
			coldWarmupReturned += collision.fieldRockSolids(
				{ ...system },
				query.ship,
				clock,
			).owner.length;
		const cold = [];
		let coldReturned = 0;
		for (let i = 0; i < blocks; i++) {
			const fresh = { ...system };
			const at = performance.now();
			const result = collision.fieldRockSolids(fresh, query.ship, clock);
			cold.push(performance.now() - at);
			coldReturned += result.owner.length;
		}
		let warmupReturned = 0;
		for (let i = 0; i < 16; i++)
			warmupReturned += collision.fieldRockSolids(system, query.ship, clock)
				.owner.length;
		const warm = [];
		let warmReturned = 0;
		for (let i = 0; i < blocks; i++) {
			const at = performance.now();
			for (let n = 0; n < iterations; n++)
				warmReturned += collision.fieldRockSolids(system, query.ship, clock)
					.owner.length;
			warm.push((performance.now() - at) / iterations);
		}
		if (
			coldWarmupReturned !== count * 16 ||
			coldReturned !== count * blocks ||
			warmupReturned !== count * 16 ||
			warmReturned !== count * blocks * iterations
		)
			throw new Error("timed query count changed");
		measurements.push({
			kind,
			system: index,
			query: query.name,
			group: query.group,
			ship: query.ship,
			count,
			coldReturned,
			warmReturned,
			coldFirstQueryMs: cold,
			warmBatchMeanMs: warm,
		});
	}

console.log(
	JSON.stringify({
		candidate: name,
		mode,
		querySource: createHash("sha256")
			.update(readFileSync("src/field-collision.ts"))
			.digest("hex"),
		verification,
		...(verifyOnly
			? {}
			: {
					measurements,
					prebuildMs,
					environment: {
						bun: Bun.version,
						platform: process.platform,
						arch: process.arch,
						cpu: cpus()[0]?.model,
						loadBefore,
						loadAfter: loadavg(),
					},
					clock,
					hullReach,
					heightfieldBytes: bytes.length,
					archetypes: shapes.fields.length,
					blocks,
					iterations,
				}),
	}),
);
