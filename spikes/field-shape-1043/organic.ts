import {
	FIELD_PROFILE,
	fieldRocks,
	type FieldPlan,
	type Rock,
} from "../../src/asteroid-field";
import type { SystemRecord } from "../../src/galaxy";
import { mix, seededRand } from "../../src/rng";
import { cross, length, scale, add, type Vec3 } from "../../src/vec3";

export const ORGANIC_VARIANTS = ["organic", "braided"] as const;
export type OrganicVariant = (typeof ORGANIC_VARIANTS)[number];
interface Lobe {
	centre: Vec3;
	radius: number;
	axis: Vec3;
	across: Vec3;
	up: Vec3;
	weight: number;
	bend: number;
}
const unit = (rand: () => number): Vec3 => {
	const z = rand() * 2 - 1,
		angle = rand() * Math.PI * 2,
		r = Math.sqrt(1 - z * z);
	return { x: r * Math.cos(angle), y: r * Math.sin(angle), z };
};
const distance = (a: Vec3, b: Vec3): number =>
	Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const beta = (rand: () => number): number => {
	const a = -Math.log(Math.max(Number.MIN_VALUE, rand() * rand() * rand()));
	const b = -Math.log(Math.max(Number.MIN_VALUE, rand() * rand() * rand()));
	return a / (a + b);
};
const placementSeed = (
	record: SystemRecord,
	plan: FieldPlan,
	variant: OrganicVariant,
) =>
	mix(
		mix(record.seed, plan.slot),
		variant === "organic" ? 0x10430c1d : 0x1043b4ad,
	);

function lobesFor(
	record: SystemRecord,
	plan: FieldPlan,
	variant: OrganicVariant,
): Lobe[] {
	const rand = seededRand(placementSeed(record, plan, variant));
	const count = 5 + Math.floor(rand() * 3),
		span = plan.profile === "charted" ? 31 : 25;
	const lobes: Lobe[] = [];
	for (let i = 0; i < count; i++) {
		let centre: Vec3;
		let attempts = 0;
		do {
			const direction = unit(rand),
				r = span * Math.cbrt(rand());
			centre = {
				x: direction.x * r,
				y: direction.y * r * 0.7,
				z: direction.z * r * 0.42,
			};
			attempts++;
		} while (
			attempts < 64 &&
			lobes.some((l) => distance(l.centre, centre) < span * 0.26)
		);
		const axis = unit(rand);
		const perpendicular = cross(
			axis,
			Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 },
		);
		const across = scale(perpendicular, 1 / length(perpendicular));
		lobes.push({
			centre,
			radius: (plan.profile === "charted" ? 5.5 : 5) + rand() * 4,
			axis,
			across,
			up: cross(axis, across),
			weight: 0.3 + rand() ** 2 * 1.8,
			bend: rand() * 2 - 1,
		});
	}
	return lobes;
}

function anchorFor(
	slot: number,
	seed: number,
	lobes: readonly Lobe[],
	variant: OrganicVariant,
): Vec3 {
	const rand = seededRand(mix(seed, slot));
	let choice = rand() * lobes.reduce((sum, l) => sum + l.weight, 0),
		lobe = lobes[0];
	for (const l of lobes) {
		choice -= l.weight;
		if (choice <= 0) {
			lobe = l;
			break;
		}
	}
	if (rand() < (variant === "braided" ? 0.42 : 0.16)) {
		const other = lobes
			.filter((l) => l !== lobe)
			.sort(
				(a, b) =>
					distance(a.centre, lobe.centre) - distance(b.centre, lobe.centre),
			)[Math.floor(rand() * 2)];
		const t = beta(rand),
			ripple = Math.sin(t * Math.PI) * lobe.bend * 2.5;
		const offset = scale(
			unit(rand),
			beta(rand) * (variant === "braided" ? 1.8 : 2.7),
		);
		return add(
			add(
				add(scale(lobe.centre, 1 - t), scale(other.centre, t)),
				scale(lobe.up, ripple),
			),
			offset,
		);
	}
	const p = scale(unit(rand), beta(rand) * lobe.radius);
	const warp = ((lobe.bend * (p.y * p.y - p.z * p.z)) / lobe.radius) * 0.28;
	return add(
		lobe.centre,
		add(
			add(
				scale(lobe.axis, p.x + warp),
				scale(lobe.across, p.y * (variant === "braided" ? 0.65 : 0.9)),
			),
			scale(lobe.up, p.z * 0.65),
		),
	);
}

/** Continuous study anchors preserve production per-slot physical draws; the spatial buckets impose no placement cells. */
export function organicRocks(
	record: SystemRecord,
	plan: FieldPlan,
	variant: OrganicVariant,
	generate: typeof fieldRocks = fieldRocks,
): Rock[] {
	const base = FIELD_PROFILE[plan.profile];
	const bank = generate(record, plan, {
		...base,
		semiKm: base.semiKm.map((n) => n * 1.6) as [number, number, number],
		occupancy: 1,
	}).sort((a, b) => a.slot - b.slot);
	const seed = placementSeed(record, plan, variant),
		lobes = lobesFor(record, plan, variant);
	const width =
		2 * Math.max(...bank.map((r) => r.radiusKm + r.driftKm)) + base.marginKm;
	const buckets = new Map<string, Rock[]>(),
		out: Rock[] = [];
	const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
	for (const rock of bank) {
		if (seededRand(mix(seed, rock.slot ^ 0x7f341a9))() > 0.72) continue;
		const anchor = anchorFor(rock.slot, seed, lobes, variant);
		const cell = [anchor.x, anchor.y, anchor.z].map((n) =>
			Math.floor(n / width),
		);
		let clear = true;
		for (let i = -1; i <= 1 && clear; i++)
			for (let j = -1; j <= 1 && clear; j++)
				for (let k = -1; k <= 1 && clear; k++) {
					for (const prior of buckets.get(
						key(cell[0] + i, cell[1] + j, cell[2] + k),
					) ?? [])
						if (
							distance(anchor, prior.anchor) <
							rock.radiusKm +
								rock.driftKm +
								prior.radiusKm +
								prior.driftKm +
								base.marginKm
						) {
							clear = false;
							break;
						}
				}
		if (!clear) continue;
		const placed = { ...rock, anchor };
		out.push(placed);
		const code = key(cell[0], cell[1], cell[2]);
		const bucket = buckets.get(code);
		if (bucket) bucket.push(placed);
		else buckets.set(code, [placed]);
	}
	return out;
}
