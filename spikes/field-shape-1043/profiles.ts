import {
	FIELD_PROFILE,
	fieldCells,
	fieldRocks,
	type FieldPlan,
	type FieldProfile,
	type FieldProfileName,
	type Rock,
} from "../../src/asteroid-field";
import type { SystemRecord } from "../../src/galaxy";
import { mix, seededRand } from "../../src/rng";
import { organicRocks, ORGANIC_VARIANTS } from "./organic";

export const LATTICE_CANDIDATES = [
	"baseline",
	"expanded",
	"clusters",
	"broken",
] as const;
export const CANDIDATES = [...LATTICE_CANDIDATES, ...ORGANIC_VARIANTS] as const;
export type Candidate = (typeof CANDIDATES)[number];

/** Study inputs only; the production profiles and generator version stay unchanged. */
export function candidateProfile(
	kind: FieldProfileName,
	name: Candidate,
): FieldProfile {
	const base = FIELD_PROFILE[kind];
	if (name === "baseline") return base;
	if (name === "organic" || name === "braided")
		return {
			...base,
			semiKm: kind === "charted" ? [48, 38, 28] : [40, 32, 24],
			occupancy: 0.72,
		};
	const scale = name === "expanded" ? 2.5 : 3;
	return {
		...base,
		semiKm: base.semiKm.map((n) => n * scale) as [number, number, number],
		cellKm: base.cellKm * 1.5,
		occupancy: name === "expanded" ? 0.12 : 0.7,
	};
}

/** Smooth clusters and voids in normalized field coordinates, not occupancy by push order. */
export function densityAt(x: number, y: number, z: number): number {
	const cluster = (cx: number, cy: number, cz: number) =>
		Math.exp(
			-((x - cx) ** 2 / 0.12 + (y - cy) ** 2 / 0.24 + (z - cz) ** 2 / 0.3),
		);
	const edge = Math.max(0, Math.min(1, (1 - Math.hypot(x, y, z)) / 0.25));
	return (
		Math.min(
			1,
			0.015 + 0.95 * (cluster(-0.48, -0.18, 0.12) + cluster(0.42, 0.25, -0.2)),
		) * edge
	);
}

/** Retune only study layouts; production shape/radius and motion draws remain slot-owned. */
export function candidateRocks(
	record: SystemRecord,
	plan: FieldPlan,
	name: Candidate,
	input: { profile: FieldProfile; generate: typeof fieldRocks } = {
		profile: candidateProfile(plan.profile, name),
		generate: fieldRocks,
	},
): Rock[] {
	if (name === "organic" || name === "braided")
		return organicRocks(record, plan, name, input.generate);
	const profile = input.profile;
	const rocks = input.generate(record, plan, profile);
	if (name === "baseline" || name === "expanded") return rocks;
	const cells = fieldCells(profile);
	return rocks
		.filter((rock) => {
			const cell = cells[rock.slot];
			const rand = seededRand(
				mix(mix(record.seed, plan.slot), rock.slot ^ 0x1043),
			);
			return (
				rand() <
				densityAt(
					cell.x / profile.semiKm[0],
					cell.y / profile.semiKm[1],
					cell.z / profile.semiKm[2],
				)
			);
		})
		.map((rock) => {
			if (name !== "broken") return rock;
			const rand = seededRand(mix(rock.shapeSeed, 0x1043));
			const cell = cells[rock.slot];
			const room = Math.max(
				0,
				profile.cellKm / 2 -
					rock.radiusKm -
					profile.marginKm / 2 -
					rock.driftKm,
			);
			return {
				...rock,
				anchor: {
					x: cell.x + (rand() * 2 - 1) * room,
					y: cell.y + (rand() * 2 - 1) * room,
					z: cell.z + (rand() * 2 - 1) * room,
				},
			};
		});
}
