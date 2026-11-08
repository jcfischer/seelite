import {
	fieldCentre,
	fieldCentreVelocity,
	rotateByQuat,
	type FieldPlan,
	type Rock,
} from "../../src/asteroid-field";
import {
	mayMeet,
	RESTING_KM,
	solidReach,
	type Reach,
	type RockSolid,
} from "../../src/collision";
import { rockId, rockSolid } from "../../src/field-collision";
import { length, sub, type Vec3 } from "../../src/vec3";

type Clock = { fromTime: number; toTime: number };
export type AnchorRow = { plan: FieldPlan; rocks: readonly Rock[] };
const key = (c: readonly number[]) => c.join(",");
const coords = (p: Vec3, width: number) =>
	[p.x, p.y, p.z].map((v) => Math.floor(v / width));
const local = (plan: FieldPlan, p: Vec3, time: number) =>
	rotateByQuat(
		{
			x: -plan.rotation.x,
			y: -plan.rotation.y,
			z: -plan.rotation.z,
			w: plan.rotation.w,
		},
		sub(p, fieldCentre(plan, time)),
	);
const resultFor = (rows: readonly AnchorRow[], ship: Reach, clock: Clock) => {
	const owner: string[] = [],
		motions: RockSolid[] = [];
	for (const { plan, rocks } of rows)
		for (const rock of rocks) {
			const solid = rockSolid(plan, rock, clock);
			if (
				!mayMeet(ship, {
					start: solid.start.origin,
					end: solid.end.origin,
					reachKm: solidReach(solid),
				})
			)
				continue;
			owner.push(rockId(plan, rock));
			motions.push(solid);
		}
	return { owner, motions };
};

/** Independent complete traversal oracle uses the same production reach predicate and solids. */
export const linearAnchorQuery = resultFor;

/** Study index over arbitrary anchors; buckets hold every rock and never determine placement. */
export class AnchorQuery {
	readonly rows;
	constructor(
		rows: readonly AnchorRow[],
		readonly width = 4,
	) {
		if (!(width > 0)) throw Error("positive bucket width required");
		this.rows = rows.map(({ plan, rocks }) => {
			const buckets = new Map<string, Rock[]>(),
				lo = [Infinity, Infinity, Infinity],
				hi = [-Infinity, -Infinity, -Infinity];
			let envelope = 0;
			for (const rock of rocks) {
				const c = coords(rock.anchor, width),
					code = key(c),
					bucket = buckets.get(code);
				if (bucket) bucket.push(rock);
				else buckets.set(code, [rock]);
				for (let axis = 0; axis < 3; axis++) {
					lo[axis] = Math.min(lo[axis], c[axis]);
					hi[axis] = Math.max(hi[axis], c[axis]);
				}
				envelope = Math.max(
					envelope,
					rock.driftKm +
						solidReach(rockSolid(plan, rock, { fromTime: 0, toTime: 0 })),
				);
			}
			return { plan, buckets, lo, hi, envelope };
		});
	}
	query(ship: Reach, clock: Clock) {
		const rows = this.rows.map(({ plan, buckets, lo, hi, envelope }) => {
			const a = local(plan, ship.start, clock.fromTime),
				b = local(plan, ship.end, clock.toTime);
			const bend =
				(length(
					sub(
						fieldCentreVelocity(plan, clock.toTime),
						fieldCentreVelocity(plan, clock.fromTime),
					),
				) *
					Math.abs(clock.toTime - clock.fromTime)) /
				8;
			const grow = ship.reachKm + 2 * RESTING_KM + envelope + bend;
			const av = [a.x, a.y, a.z],
				bv = [b.x, b.y, b.z];
			const low = av.map((v, i) =>
				Math.max(lo[i], Math.floor((Math.min(v, bv[i]) - grow) / this.width)),
			);
			const high = av.map((v, i) =>
				Math.min(hi[i], Math.floor((Math.max(v, bv[i]) + grow) / this.width)),
			);
			const rocks: Rock[] = [];
			for (let i = low[0]; i <= high[0]; i++)
				for (let j = low[1]; j <= high[1]; j++)
					for (let k = low[2]; k <= high[2]; k++)
						rocks.push(...(buckets.get(key([i, j, k])) ?? []));
			rocks.sort((a, b) => a.slot - b.slot);
			return { plan, rocks };
		});
		return resultFor(rows, ship, clock);
	}
}
