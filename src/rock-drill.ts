/**
 * https://github.com/jcfischer/seelite/issues/920
 * Prototype for node #920, the drill half: the miner's built-in drill (#872 D3,
 * D4, D13) on Longwall B's cutter (#803, #815; `HULL_SPECS.miner.cutter`). The
 * pilot holds the cutter face on a deep deposit's mouth by flying the ship; while
 * contact holds, whole tonnes go straight into the hold and the deposit is debited
 * by exactly what the hold gains. Every figure here is a provisional candidate for
 * #922's economic measurement, not a ratified rate. The anchoring struts are not
 * used: their role is the principal's ruling.
 */
import { type DepositRow, debitAt } from "./deposit-state";
import type { HullCutter } from "./hull";
import type { LaserRates } from "./ship-condition";
import { add, dot, length, normalizeOr, scale, sub, type Vec3 } from "./vec3";

/** Candidate drill figures. Speeds km/s, distances km, times s. */
export const DRILL = {
	deployS: 6,
	spinUpS: 2,
	rotorRadPerS: 2 * Math.PI * 0.5,
	contactKm: 0.0015,
	alignDeg: 20,
	closingKms: 0.002,
	slideKms: 0.003,
	mouthDeg: 12,
	rateTPerS: 0.5,
	energyPerS: 6,
	heatPerS: 2.5,
	feedMarginKm: 0.0005,
} as const;

/** The drill as the shared bank and heat gauge see it: no damage. */
export const DRILL_RATES: LaserRates = {
	damagePerS: 0,
	energyPerS: DRILL.energyPerS,
	heatPerS: DRILL.heatPerS,
};

/** How the feed is commanded: the variants the principal flies. */
export const DRILL_DEPLOYS = ["arm", "trigger"] as const;
export type DrillDeploy = (typeof DRILL_DEPLOYS)[number];

/** The rotor face's centre in the world at `extension` of the feed, from the ship's pose. */
export function drillFaceKm(
	shipPos: Vec3,
	nose: Vec3,
	up: Vec3,
	cutter: HullCutter,
	extension: number,
): Vec3 {
	return add(
		shipPos,
		add(
			scale(nose, cutter.bowKm + cutter.feedTravelKm * extension),
			scale(up, -cutter.downKm),
		),
	);
}

/** One frame of the feed: toward full when `out`, toward stowed when not; never past `roomKm` ahead of the stowed face. */
export function stepFeed(
	extension: number,
	out: boolean,
	dt: number,
	roomKm: number,
	cutter: HullCutter,
): number {
	const step = Math.max(0, dt) / DRILL.deployS;
	if (!out) return Math.max(0, extension - step);
	const limit = Math.max(
		0,
		Math.min(1, (roomKm - DRILL.feedMarginKm) / cutter.feedTravelKm),
	);
	if (extension >= limit) return extension;
	return Math.min(limit, extension + step);
}

/** One frame of the rotor: up while powered, down when not. 0 is still, 1 full speed. */
export const stepSpin = (spin: number, powered: boolean, dt: number): number =>
	Math.min(
		1,
		Math.max(0, spin + ((powered ? 1 : -1) * Math.max(0, dt)) / DRILL.spinUpS),
	);

/** Why the drill cannot cut this frame, in the words the glass shows. */
export type DrillBlock =
	| "STOWED"
	| "DEPLOYING"
	| "NO ROCK"
	| "OUT OF REACH"
	| "ALIGN"
	| "CLOSING"
	| "SLIDING"
	| "NO DEEP DEPOSIT"
	| "OFF DEPOSIT";

/** One frame's contact facts. Velocities star-centric; `hit` is the drawn surface met along the nose from the face; `deepMouth` is the deep deposit's unit direction from the rock's centre. */
export interface DrillContactInput {
	extension: number;
	nose: Vec3;
	faceVel: Vec3;
	hit: { point: Vec3; normal: Vec3; distKm: number } | null;
	surfaceVel: Vec3;
	rockCentre: Vec3;
	deepMouth: Vec3 | null;
}

export interface DrillContact {
	block: DrillBlock | null;
	gapKm: number | null;
	alignDeg: number | null;
	closingKms: number | null;
	slideKms: number | null;
	mouthDeg: number | null;
}

const DEG = 180 / Math.PI;

/** Whether the face is in contact: deployed, in reach, square, slow against the surface and on the mouth. */
export function drillContact(i: DrillContactInput): DrillContact {
	const none: DrillContact = {
		block: null,
		gapKm: null,
		alignDeg: null,
		closingKms: null,
		slideKms: null,
		mouthDeg: null,
	};
	if (i.extension <= 0) return { ...none, block: "STOWED" };
	if (i.extension < 1) return { ...none, block: "DEPLOYING" };
	if (!i.hit) return { ...none, block: "NO ROCK" };
	const n = i.hit.normal;
	const alignDeg = Math.acos(Math.min(1, Math.max(-1, -dot(i.nose, n)))) * DEG;
	const u = sub(i.faceVel, i.surfaceVel);
	const un = dot(u, n);
	const closingKms = Math.max(0, -un);
	const slideKms = length(sub(u, scale(n, un)));
	const mouth = i.deepMouth;
	const mouthDeg = mouth
		? Math.acos(
				Math.min(
					1,
					Math.max(
						-1,
						dot(normalizeOr(sub(i.hit.point, i.rockCentre), mouth), mouth),
					),
				),
			) * DEG
		: null;
	const seen = {
		gapKm: i.hit.distKm,
		alignDeg,
		closingKms,
		slideKms,
		mouthDeg,
	};
	const block: DrillBlock | null =
		i.hit.distKm > DRILL.contactKm
			? "OUT OF REACH"
			: alignDeg > DRILL.alignDeg
				? "ALIGN"
				: closingKms > DRILL.closingKms
					? "CLOSING"
					: slideKms > DRILL.slideKms
						? "SLIDING"
						: mouthDeg === null
							? "NO DEEP DEPOSIT"
							: mouthDeg > DRILL.mouthDeg
								? "OFF DEPOSIT"
								: null;
	return { block, ...seen };
}

/** Sub-tonne progress on one rock. Dropped when contact is lost, so it is never output. */
export interface DrillCut {
	key: string | null;
	progressT: number;
}
export const beginDrillCut = (): DrillCut => ({ key: null, progressT: 0 });

export type DrillStop = "NO POWER" | "HOLD FULL" | "DEPLETED";

/**
 * One frame of drilling. `key` is the rock in contact, or `null`. Output is whole
 * tonnes, never more than the hold's free tonnes or the reserve left; with no
 * contact the progress is dropped, and with no power, a full hold or an empty
 * deposit it is frozen. So the deposit's debit is exactly the hold's gain.
 */
export function stepDrillCut(
	cut: DrillCut,
	a: {
		key: string | null;
		powered: boolean;
		spin: number;
		rateTPerS: number;
		dt: number;
		holdFreeT: number;
		reserveLeftT: number;
	},
): { cut: DrillCut; tonnes: number; stop: DrillStop | null } {
	if (a.key === null) return { cut: beginDrillCut(), tonnes: 0, stop: null };
	const base = cut.key === a.key ? cut : { key: a.key, progressT: 0 };
	if (!a.powered) return { cut: base, tonnes: 0, stop: "NO POWER" };
	if (a.holdFreeT < 1) return { cut: base, tonnes: 0, stop: "HOLD FULL" };
	if (a.reserveLeftT < 1) return { cut: base, tonnes: 0, stop: "DEPLETED" };
	const progressT =
		base.progressT +
		Math.max(0, a.rateTPerS) * Math.min(1, Math.max(0, a.spin)) * a.dt;
	const most = Math.floor(Math.min(a.holdFreeT, a.reserveLeftT));
	const tonnes = Math.min(most, Math.floor(progressT));
	return {
		cut: { key: a.key, progressT: progressT - tonnes },
		tonnes,
		stop: null,
	};
}

/** A deposit row with `n` more deep tonnes taken at `t`, both debits rebased to `t`. */
export function debitDeep(
	row: DepositRow | undefined,
	t: number,
	n: number,
): DepositRow {
	const at = row?.at ?? 0;
	const deep = debitAt(row?.deep ?? 0, at, t) + n;
	const surface =
		row?.surface === undefined ? undefined : debitAt(row.surface, at, t);
	return {
		...row,
		deep,
		...(surface !== undefined && { surface }),
		at: t,
	};
}
