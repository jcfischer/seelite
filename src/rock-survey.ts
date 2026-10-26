/**
 * Prototype for node #920: candidate rock contents on `ASTEROID_DEPOSIT` and the
 * Mining Laser's survey hold (#872 D5, D15; #951 D1, D3). Every figure here is a
 * provisional candidate for #922's economic measurement, not a ratified rate.
 */
import {
	FIELD_PROFILE,
	type FieldProfileName,
	type Rock,
	rockDepositStream,
} from "./asteroid-field";
import { type DepositRow, debitAt } from "./deposit-state";
import type { SlotSize } from "./hull";
import { type Grade, gradeOutputScale, POLICY } from "./module-catalog";
import type { Vec3 } from "./vec3";

/** #917 D2's five ore families, in catalogue order. */
export const ORE_FAMILIES = [
	"silicate",
	"metallic",
	"gold",
	"platinum",
	"gem",
] as const;
export type OreFamily = (typeof ORE_FAMILIES)[number];
/** #917 D1's three discrete grades. */
export const ORE_GRADES = ["poor", "standard", "rich"] as const;
export type OreGrade = (typeof ORE_GRADES)[number];

/** #917 D2's cargo names, one good per family and grade. */
export const ORE_FAMILY_NAME: Readonly<Record<OreFamily, string>> = {
	silicate: "Silicate ore",
	metallic: "Metallic ore",
	gold: "Gold-bearing ore",
	platinum: "Platinum-bearing ore",
	gem: "Gem-bearing ore",
};

/** Candidate family weights per field profile: charted is common ore, rare is richer in precious ore (#872 D6). */
export const FAMILY_WEIGHTS: Readonly<
	Record<FieldProfileName, Readonly<Record<OreFamily, number>>>
> = {
	charted: {
		silicate: 0.45,
		metallic: 0.4,
		gold: 0.08,
		platinum: 0.05,
		gem: 0.02,
	},
	rare: { silicate: 0.2, metallic: 0.3, gold: 0.2, platinum: 0.15, gem: 0.15 },
};
/** Candidate grade weights per field profile. */
export const GRADE_WEIGHTS: Readonly<
	Record<FieldProfileName, Readonly<Record<OreGrade, number>>>
> = {
	charted: { poor: 0.5, standard: 0.4, rich: 0.1 },
	rare: { poor: 0.25, standard: 0.45, rich: 0.3 },
};

/** Candidate reserve scale, whole tonnes: surface ore grows with area, a deep deposit with volume. */
export const RESERVE = {
	surfaceMinT: 2,
	surfaceAtLargestT: 150,
	deepChanceAtSmallest: 0.2,
	deepChanceAtLargest: 0.9,
	deepMinT: 30,
	deepAtLargestT: 600,
} as const;

/** What a rock holds: `f(seed)`, never saved (#951 D1). */
export interface RockContents {
	family: OreFamily;
	grade: OreGrade;
	surfaceT: number;
	deepT: number;
	/** Unit direction of the deep deposit's mouth in the rock's own (unspun) frame, or `null` with no deep deposit. */
	deepDir: Vec3 | null;
}

const pick = <K extends string>(
	weights: Readonly<Record<K, number>>,
	order: readonly K[],
	u: number,
): K => {
	const total = order.reduce((s, k) => s + weights[k], 0);
	let acc = 0;
	for (const k of order) {
		acc += weights[k] / total;
		if (u < acc) return k;
	}
	return order[order.length - 1];
};

/** Candidate contents for one rock. Every rock makes the same draws in the same order. */
export function rockContents(
	systemSeed: number,
	fieldSlot: number,
	profile: FieldProfileName,
	rock: Rock,
): RockContents {
	const rand = rockDepositStream(systemSeed, fieldSlot, rock.slot);
	const familyU = rand();
	const gradeU = rand();
	const surfaceU = rand();
	const deepChanceU = rand();
	const deepU = rand();
	const dirCos = 2 * rand() - 1;
	const dirPhi = 2 * Math.PI * rand();
	const [r0, r1] = FIELD_PROFILE[profile].rockRadiusKm;
	const s = Math.min(1, Math.max(0, (rock.radiusKm - r0) / (r1 - r0)));
	const size = rock.radiusKm / r1;
	const surfaceT = Math.max(
		RESERVE.surfaceMinT,
		Math.round(RESERVE.surfaceAtLargestT * size * size * (0.5 + surfaceU)),
	);
	const deepChance =
		RESERVE.deepChanceAtSmallest +
		(RESERVE.deepChanceAtLargest - RESERVE.deepChanceAtSmallest) * s;
	const hasDeep = deepChanceU < deepChance;
	const deepT = hasDeep
		? Math.max(
				RESERVE.deepMinT,
				Math.round(RESERVE.deepAtLargestT * size ** 3 * (0.5 + deepU)),
			)
		: 0;
	const sin = Math.sqrt(1 - dirCos * dirCos);
	return {
		family: pick(FAMILY_WEIGHTS[profile], ORE_FAMILIES, familyU),
		grade: pick(GRADE_WEIGHTS[profile], ORE_GRADES, gradeU),
		surfaceT,
		deepT,
		deepDir: hasDeep
			? { x: sin * Math.cos(dirPhi), y: sin * Math.sin(dirPhi), z: dirCos }
			: null,
	};
}

/** Candidate survey figures for a size 1, grade E Mining Laser. */
export const SURVEY = {
	rangeKm: 4,
	coneDeg: 8,
	dwellS: 4,
} as const;

/** How an interrupted scan treats its progress: the variants the principal flies. */
export const SURVEY_INTERRUPTS = ["reset", "hold", "decay"] as const;
export type SurveyInterrupt = (typeof SURVEY_INTERRUPTS)[number];

/** The fitted Mining Laser's survey figures: range by size, dwell by grade, as #977 scales the identity scanner. */
export function surveyFigures(
	size: SlotSize,
	grade: Grade,
	base: { rangeKm: number; dwellS: number } = SURVEY,
): { rangeKm: number; dwellS: number } {
	return {
		rangeKm: base.rangeKm * POLICY.sizeScale[size],
		dwellS: base.dwellS / gradeOutputScale(grade),
	};
}

/** A survey in progress. Session state, never saved. */
export interface SurveyHold {
	key: string | null;
	chargeS: number;
}
export const beginSurveyHold = (): SurveyHold => ({ key: null, chargeS: 0 });

/**
 * One frame of the survey. `held` is the rock under a valid hold this frame (in range, in the cone,
 * trigger released, laser fitted), or `null`. A new rock starts over; an interrupted hold follows `interrupt`.
 */
export function stepSurveyHold(
	hold: SurveyHold,
	held: string | null,
	dt: number,
	dwellS: number,
	interrupt: SurveyInterrupt,
): SurveyHold {
	const step = Math.max(0, dt);
	if (held !== null) {
		if (held !== hold.key)
			return { key: held, chargeS: Math.min(dwellS, step) };
		const chargeS = Math.min(dwellS, hold.chargeS + step);
		return chargeS === hold.chargeS ? hold : { key: held, chargeS };
	}
	if (hold.chargeS >= dwellS || interrupt === "reset")
		return hold.key === null && hold.chargeS === 0 ? hold : beginSurveyHold();
	if (interrupt === "hold") return hold;
	const chargeS = Math.max(0, hold.chargeS - step);
	return chargeS === 0 ? beginSurveyHold() : { key: hold.key, chargeS };
}

/** Did this frame complete a survey the previous frame had not? */
export const surveyCompleted = (
	before: SurveyHold,
	after: SurveyHold,
	dwellS: number,
): boolean =>
	after.key !== null && before.chargeS < dwellS && after.chargeS >= dwellS;

/** What a live reading shows: contents with remaining reserve derived at `t` (#951 D3). */
export interface SurveyReading {
	family: OreFamily;
	grade: OreGrade;
	surfaceLeftT: number;
	deepLeftT: number;
	deepDir: Vec3 | null;
	ageS: number;
	expiresInS: number;
}

/** The reading a row supports at `t`, or `null` when there is none or it has expired. */
export function surveyReading(
	contents: RockContents,
	row: DepositRow | undefined,
	t: number,
	lifetimeH: number,
): SurveyReading | null {
	if (!row || row.surveyedAt === undefined) return null;
	if (t - row.surveyedAt >= lifetimeH * 3600) return null;
	const at = row.at ?? 0;
	const surfaceTaken =
		row.surface === undefined ? 0 : debitAt(row.surface, at, t);
	const deepTaken = row.deep === undefined ? 0 : debitAt(row.deep, at, t);
	const ageS = t - row.surveyedAt;
	return {
		family: contents.family,
		grade: contents.grade,
		surfaceLeftT: Math.max(0, contents.surfaceT - surfaceTaken),
		deepLeftT: Math.max(0, contents.deepT - deepTaken),
		deepDir: contents.deepDir,
		ageS,
		expiresInS: Math.max(0, lifetimeH * 3600 - ageS),
	};
}
