import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
import type { Reach } from "../../src/collision";
import { candidateRocks } from "./profiles";
import { AnchorQuery, linearAnchorQuery } from "./anchor-query";

const shapes = decodeRockHeightfields(
	new Uint8Array(readFileSync("src/models/rock-heightfields.bin")),
);
setRockShapeSource(() => shapes);
await prebuildRockPieces(async (_i, shape) => buildRockPieces(shape));
const fixtures = [173, 0].map((i) => {
	const record = generateGalaxy(0x5ee11e, 0).systems[i];
	return { record, plans: systemFields(record, generateContents(record)) };
});
const signature = (r: ReturnType<typeof linearAnchorQuery>) =>
	r.owner
		.map((owner, i) => ({
			owner,
			...r.motions[i],
			pieces: r.motions[i].pieces.pieces.length,
		}))
		.sort((a, b) => a.owner.localeCompare(b.owner));

test("continuous anchor buckets match full traversal and native baseline reach sets and motions", () => {
	let occupied = 0,
		comparisons = 0;
	for (const { record, plans } of fixtures)
		for (const candidate of ["baseline", "organic"] as const) {
			const rows = plans.map((plan) => ({
				plan,
				rocks: candidateRocks(record, plan, candidate),
			}));
			for (const width of [1.7, 4, 9]) {
				const index = new AnchorQuery(rows, width);
				for (const time of [0, 1000, 1_000_000]) {
					const clock = { fromTime: time, toTime: time + 0.1 };
					for (const { plan, rocks } of rows) {
						const world = (p: { x: number; y: number; z: number }, t: number) =>
							add(fieldCentre(plan, t), rotateByQuat(plan.rotation, p));
						const queries: Reach[] = [
							{
								start: world({ x: -80, y: 0, z: 0 }, time),
								end: world({ x: 80, y: 0, z: 0 }, time + 0.1),
								reachKm: 0.05,
							},
							{
								start: world({ x: 0, y: 0, z: 0 }, time),
								end: world({ x: 0, y: 0, z: 0 }, time + 0.1),
								reachKm: 60,
							},
						];
						for (const rock of rocks.filter(
							(_r, i) => i % Math.max(1, Math.floor(rocks.length / 12)) === 0,
						)) {
							const start = rockPose(plan, rock, time).pos,
								end = rockPose(plan, rock, time + 0.1).pos;
							queries.push(
								{ start, end, reachKm: 0.05 },
								{
									start: add(start, { x: 0, y: 0, z: 3 }),
									end: add(end, { x: 0.1, y: 0, z: 3 }),
									reachKm: 0.05,
								},
							);
						}
						for (const query of queries) {
							const full = linearAnchorQuery(rows, query, clock),
								actual = index.query(query, clock);
							occupied += Number(full.owner.length > 0);
							comparisons++;
							expect(signature(actual)).toEqual(signature(full));
							if (candidate === "baseline")
								expect(signature(actual)).toEqual(
									signature(
										fieldRockSolids(makeSystem(record, time), query, clock),
									),
								);
						}
					}
				}
			}
		}
	expect(occupied).toBeGreaterThan(100);
	expect(comparisons).toBeGreaterThan(500);
}, 120000);

test("oracle rejects an index that omits an occupied rock", () => {
	const { record, plans } = fixtures[0],
		plan = plans[0],
		rocks = candidateRocks(record, plan, "organic"),
		rock = rocks[0];
	const clock = { fromTime: 1000, toTime: 1000.1 };
	const ship = {
		start: rockPose(plan, rock, clock.fromTime).pos,
		end: rockPose(plan, rock, clock.toTime).pos,
		reachKm: 0.05,
	};
	const full = linearAnchorQuery([{ plan, rocks }], ship, clock);
	expect(full.owner.length).toBeGreaterThan(0);
	expect(
		signature(
			new AnchorQuery([{ plan, rocks: rocks.slice(1) }]).query(ship, clock),
		),
	).not.toEqual(signature(full));
});
