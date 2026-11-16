import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { createHash } from "node:crypto";
import { median } from "../../scripts/lib/measurement.mjs";
import {
	systemFields,
	rockPose,
	fieldCentre,
	rotateByQuat,
} from "../../src/asteroid-field";
import { generateGalaxy } from "../../src/galaxy";
import { generateContents } from "../../src/system";
import { makeSystem } from "../../src/sim";
import {
	fieldRockSolids,
	setRockShapeSource,
	prebuildRockPieces,
} from "../../src/field-collision";
import { decodeRockHeightfields } from "../../src/rock-heightfields";
import { buildRockPieces } from "../../src/rock-pieces";
import { add } from "../../src/vec3";
import { reachKm, shipPrimitives, type Reach } from "../../src/collision";
import { HULL_SPECS } from "../../src/hull";
import { candidateRocks } from "./profiles";
import { AnchorQuery, linearAnchorQuery } from "./anchor-query";

if (existsSync("/tmp/seelite-probe.lock"))
	throw Error("browser owns measurement lane");
const out =
	process.argv[2] ?? "/tmp/seelite-field-shape-1043-organic/query-cost.json";
const loadStart = loadavg(),
	clock = { fromTime: 1000, toTime: 1000.1 },
	hullReach = reachKm(shipPrimitives(HULL_SPECS.miner, false));
const shapes = decodeRockHeightfields(
	new Uint8Array(readFileSync("src/models/rock-heightfields.bin")),
);
setRockShapeSource(() => shapes);
await prebuildRockPieces(async (_i, shape) => buildRockPieces(shape));
const signature = (r: ReturnType<typeof linearAnchorQuery>) =>
	JSON.stringify(
		r.owner
			.map((id, i) => ({
				id,
				start: r.motions[i].start,
				end: r.motions[i].end,
				velStart: r.motions[i].velStart,
				velEnd: r.motions[i].velEnd,
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
	);
const measurements = [];
for (const [system, kind] of [
	[173, "charted"],
	[0, "rare"],
] as const) {
	const record = generateGalaxy(0x5ee11e, 0).systems[system],
		plans = systemFields(record, generateContents(record)),
		plan = plans.find((p) => p.profile === kind)!;
	const makeRows = (name: "baseline" | "organic") =>
		plans.map((plan) => ({ plan, rocks: candidateRocks(record, plan, name) }));
	const rows = { baseline: makeRows("baseline"), organic: makeRows("organic") };
	const local = (p: { x: number; y: number; z: number }, time: number) =>
		add(fieldCentre(plan, time), rotateByQuat(plan.rotation, p));
	const query = (
		a: { x: number; y: number; z: number },
		b = a,
		reach = hullReach,
	): Reach => ({
		start: local(a, clock.fromTime),
		end: local(b, clock.toTime),
		reachKm: reach,
	});
	const shared = ["baseline", "organic"].map((name) => {
		const rock = rows[name as keyof typeof rows].find(
			(r) => r.plan.id === plan.id,
		)!.rocks[0];
		return {
			label: `common-occupied-${name}`,
			ship: {
				start: rockPose(plan, rock, clock.fromTime).pos,
				end: rockPose(plan, rock, clock.toTime).pos,
				reachKm: hullReach,
			},
		};
	});
	const menus = [
		...shared,
		...shared.map(({ label, ship }) => ({
			label: label.replace("common-occupied", "common-rock-centred-crossing"),
			ship: {
				...ship,
				start: add(ship.start, { x: -80, y: 0, z: 0 }),
				end: add(ship.end, { x: 80, y: 0, z: 0 }),
			},
		})),
		{ label: "common-centre", ship: query({ x: 1.8, y: 1.8, z: 1.8 }) },
		{
			label: "synthetic-whole-field-crossing",
			ship: query({ x: -80, y: 0, z: 0 }, { x: 80, y: 0, z: 0 }),
		},
		{
			label: "synthetic-enclosing-sphere",
			ship: query({ x: 0, y: 0, z: 0 }, undefined, 60),
		},
		{ label: "common-far", ship: query({ x: 300, y: 0, z: 0 }) },
	];
	for (const { label, ship } of menus) {
		const arms = ["native", "baseline", "organic"] as const;
		const warm = Object.fromEntries(
			arms.map((arm) => {
				if (arm === "native") {
					const s = makeSystem(record, 1000);
					return [arm, () => fieldRockSolids(s, ship, clock)];
				}
				const index = new AnchorQuery(rows[arm]);
				return [arm, () => index.query(ship, clock)];
			}),
		);
		const expected = Object.fromEntries(
			arms.map((arm) => [
				arm,
				linearAnchorQuery(
					rows[arm === "native" ? "baseline" : arm],
					ship,
					clock,
				),
			]),
		);
		for (const arm of arms)
			if (signature(warm[arm]()) !== signature(expected[arm]))
				throw Error(`oracle mismatch ${arm}/${label}`);
		if (label.includes("occupied") || label.includes("rock-centred-crossing")) {
			const target = label.endsWith("organic") ? "organic" : "baseline";
			if (!expected[target].owner.length)
				throw Error("occupied menu unexpectedly empty");
		}
		const samples = Object.fromEntries(
			arms.map((arm) => [
				arm,
				{
					coldMs: [] as number[],
					warmBatchMeanMs: [] as number[],
					count: expected[arm].owner.length,
					consumed: 0,
				},
			]),
		);
		for (let block = -2; block < 6; block++)
			for (const arm of block % 2 ? [...arms].reverse() : arms) {
				const start = performance.now();
				const cold =
					arm === "native"
						? fieldRockSolids(makeSystem(record, 1000), ship, clock)
						: new AnchorQuery(makeRows(arm)).query(ship, clock);
				const coldMs = performance.now() - start;
				if (signature(cold) !== signature(expected[arm]))
					throw Error("cold output mismatch");
				let consumed = 0;
				const at = performance.now();
				for (let i = 0; i < 64; i++) consumed += warm[arm]().owner.length;
				const ms = (performance.now() - at) / 64;
				if (consumed !== expected[arm].owner.length * 64)
					throw Error("warm output count mismatch");
				if (block >= 0) {
					samples[arm].coldMs.push(coldMs);
					samples[arm].warmBatchMeanMs.push(ms);
					samples[arm].consumed += consumed;
				}
			}
		for (const arm of arms) {
			const s = samples[arm];
			measurements.push({
				system,
				kind,
				menu: label,
				arm,
				...s,
				coldMedianMs: median(s.coldMs),
				warmMedianMs: median(s.warmBatchMeanMs),
				bank:
					arm === "native"
						? null
						: rows[arm].map((r) => ({
								field: r.plan.id,
								rocks: r.rocks.length,
							})),
			});
		}
	}
}
const output = {
	head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	dirty: !!execFileSync("git", ["status", "--porcelain"], {
		encoding: "utf8",
	}).trim(),
	sources: Object.fromEntries(
		["anchor-query.ts", "anchor-measure.ts", "organic.ts", "profiles.ts"].map(
			(p) => [
				p,
				createHash("sha256")
					.update(readFileSync(`spikes/field-shape-1043/${p}`))
					.digest("hex"),
			],
		),
	),
	loadStart,
	loadEnd: loadavg(),
	cores: cpus().length,
	clock,
	hullReach,
	method:
		"Six alternating-order blocks after two unreported preconditioning blocks. Cold includes makeSystem native or all-plan generation plus generic index construction; generic eagerly indexes every field while native lazily builds only nearby fields, so cold is implementation-specific, not an isolated bucket speedup. Warm means 64-query batch mean over cached index, consumed counts inside elapsed time; complete reach/motion oracle outside. Authored collision pieces prebuilt. Fixed clock, not advancing flight/CCD/end-to-end affordability. Common occupied menus include each candidate's actual occupied point; synthetic stresses labelled.",
	measurements,
};
writeFileSync(out, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ out, rows: measurements.length, failures: 0 }));
