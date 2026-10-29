/**
 * https://github.com/jcfischer/seelite/issues/920
 * Prototype for node #920, the drill half: the miner's built-in drill (#872 D3,
 * D4, D13) on Longwall B's cutter (#803, #815; `HULL_SPECS.miner.cutter`). The
 * pilot flies the cutter face onto a rock; on a deep deposit's mouth whole tonnes
 * go straight into the hold, elsewhere the cutter takes surface ore at the laser's
 * waste share (D-D3), and each deposit is debited by exactly what the hold gains.
 * The struts unfold with the feed and, on the pilot's command, hold the ship to the
 * rock's frame once the feet touch inside the speed window (D-D1). Every figure
 * here is a provisional candidate for #922's economic measurement, not a ratified
 * rate.
 */
import { type DepositRow, debitAt } from "./deposit-state";
import {
	anchorPose,
	MINING as LONGWALL_STUDY,
} from "../spikes/longwall-miner/kinematics";
import type { HullCutter } from "./hull";
import { stepCut } from "./rock-extraction";
import { ASSIST_CAP_KMS, type LinearDemand } from "./sim";
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
	| "SLIDING";

/** What the face is on: a deep deposit's mouth, or the rock's surface ore. */
export type DrillDeposit = "deep" | "surface";

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
	deposit: DrillDeposit | null;
}

const DEG = 180 / Math.PI;

/** Whether the face is in contact: deployed, in reach, square and slow against the surface; and what it is on. */
export function drillContact(i: DrillContactInput): DrillContact {
	const none: DrillContact = {
		block: null,
		gapKm: null,
		alignDeg: null,
		closingKms: null,
		slideKms: null,
		mouthDeg: null,
		deposit: null,
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
		deposit:
			mouthDeg !== null && mouthDeg <= DRILL.mouthDeg
				? ("deep" as const)
				: ("surface" as const),
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

/** The drill's surface ore share (D-D3): the Mining Laser's grade-E share, the rest waste. */
export const DRILL_SURFACE_SHARE = 0.5;

/**
 * One frame of surface drilling (D-D3), gated like `stepDrillCut`: whole ore
 * tonnes into the hold, never more than its free tonnes; waste tonnes leave as
 * waste; the cut's progress is kept per rock while it holds and is the
 * caller's to drop on lost contact.
 */
export function stepDrillSurface(
	cut: { key: string | null; oreT: number; wasteT: number },
	a: {
		key: string;
		powered: boolean;
		spin: number;
		rateTPerS: number;
		dt: number;
		holdFreeT: number;
		reserveLeftT: number;
	},
): {
	cut: { key: string | null; oreT: number; wasteT: number };
	ore: number;
	waste: number;
	stop: DrillStop | null;
} {
	if (!a.powered) return { cut, ore: 0, waste: 0, stop: "NO POWER" };
	if (a.holdFreeT < 1) return { cut, ore: 0, waste: 0, stop: "HOLD FULL" };
	const step = stepCut(
		cut,
		a.key,
		a.rateTPerS * Math.min(1, Math.max(0, a.spin)),
		DRILL_SURFACE_SHARE,
		a.dt,
		Math.max(0, a.reserveLeftT),
	);
	return {
		cut: step.cut,
		ore: Math.min(step.ore, Math.floor(a.holdFreeT)),
		waste: step.waste,
		stop: step.depleted ? "DEPLETED" : null,
	};
}

/**
 * Fine control for the approach (#920 flight, 2026-10-28): the assist holds a
 * rock's frame and the demand is scaled from `ASSIST_CAP_KMS` down to
 * centimetres a second. `surface` holds the surface under the face, spin
 * included; `rock` holds the rock's centre and leaves the spin to the pilot;
 * `off` flies as before.
 */
export const DRILL_FINES = ["surface", "rock", "off"] as const;
export type DrillFine = (typeof DRILL_FINES)[number];

/** Candidate fine-control figures, km/s and km. */
export const FINE = {
	rangeKm: 0.5,
	surgeCapKms: 0.01,
	strafeCapKms: 0.002,
} as const;

/** The pilot's demand under fine control: a full lever is `surgeCapKms`, a strafe key `strafeCapKms`. */
export const fineDemand = (d: LinearDemand): LinearDemand => ({
	surge: (d.surge * FINE.surgeCapKms) / ASSIST_CAP_KMS,
	sway: (d.sway * FINE.strafeCapKms) / ASSIST_CAP_KMS,
	heave: (d.heave * FINE.strafeCapKms) / ASSIST_CAP_KMS,
});

/** The lever that asks the same speed under the other cap, clamped to 0…1. */
export const rescaleThrottle = (
	throttle: number,
	fromCapKms: number,
	toCapKms: number,
): number => Math.min(1, Math.max(0, (throttle * fromCapKms) / toCapKms));

/** The fine readout: range ahead to the surface and the face's speed against it, along and across the nose. */
export function fineReadout(
	nose: Vec3,
	shipVel: Vec3,
	frameVel: Vec3,
	rangeKm: number | null,
): { rangeKm: number | null; closingKms: number; slideKms: number } {
	const u = sub(shipVel, frameVel);
	const along = dot(u, nose);
	return {
		rangeKm,
		closingKms: along,
		slideKms: length(sub(u, scale(nose, along))),
	};
}

/**
 * The Longwall export's metres (+Z forward, Y up, its own origin) to the
 * ship's frame in metres (fore, up, starboard), from the shipped cutter: the
 * stowed rotor face is the bow plane and its axis is `downKm` below the
 * ship's axis (`HULL_SPECS.miner.cutter`, the study's `MINING`).
 */
export function longwallFrame(cutter: HullCutter) {
	const foreM =
		cutter.bowKm * 1000 -
		(LONGWALL_STUDY.stowedCutterZ + LONGWALL_STUDY.toothReach);
	const upM = -cutter.downKm * 1000 - LONGWALL_STUDY.cutterY;
	return {
		toShip: ([x, y, z]: readonly number[]) => ({
			fore: z + foreM,
			up: y + upM,
			starboard: -x,
		}),
		toExport: (p: { fore: number; up: number; starboard: number }) =>
			[-p.starboard, p.up - upM, p.fore - foreM] as [number, number, number],
	};
}

/** A ship-frame point in metres to the world in km, from the ship's pose. Starboard is `nose × up`. */
export const shipPointKm = (
	pos: Vec3,
	nose: Vec3,
	up: Vec3,
	p: { fore: number; up: number; starboard: number },
): Vec3 => {
	const starboard = {
		x: nose.y * up.z - nose.z * up.y,
		y: nose.z * up.x - nose.x * up.z,
		z: nose.x * up.y - nose.y * up.x,
	};
	return add(
		pos,
		add(
			scale(nose, p.fore / 1000),
			add(scale(up, p.up / 1000), scale(starboard, p.starboard / 1000)),
		),
	);
};

type M3 = [number, number, number];

/** How far past the study's deployed foot a strut may reach to find rock, as a share of its deployed length. */
export const STRUT_REACH_SHARE = 1.4;

/**
 * One strut's reach in the export's metres: its base, its deployed foot and
 * the longest reach. The study's feet stand on an inclined fixture facet
 * (`rockContactZ`), which leaves the starboard pair 25 m short of the port
 * pair; here every foot aims at the cutter's face plane (`MINING.rockZ`).
 */
export function strutReach(index: number) {
	const deployed = anchorPose(index, 1);
	const foot: M3 = [deployed.foot[0], deployed.foot[1], LONGWALL_STUDY.rockZ];
	const base = deployed.base as M3;
	const reachM =
		Math.hypot(foot[0] - base[0], foot[1] - base[1], foot[2] - base[2]) *
		STRUT_REACH_SHARE;
	return { base, foot, reachM };
}

/**
 * A strut posed toward `target` (export metres) at `deployment` 0…1: the
 * study's blend of direction and length from stowed to deployed
 * (`anchorPose`), and its elbow (`anchorAssembly`), with the deployed foot
 * moved to where it found rock.
 */
export function strutPose(index: number, deployment: number, target: M3) {
	const t = Math.min(1, Math.max(0, deployment));
	const stowed = anchorPose(index, 0);
	const base = stowed.base as M3;
	const a = stowed.foot.map((n, i) => n - base[i]);
	const b = target.map((n, i) => n - base[i]);
	const la = Math.hypot(...a);
	const lb = Math.hypot(...b);
	const raw = a.map((n, i) => (n / la) * (1 - t) + (b[i] / lb) * t);
	const norm = Math.hypot(...raw);
	const length = la + (lb - la) * t;
	const foot =
		t === 1 ? target : (base.map((n, i) => n + (raw[i] / norm) * length) as M3);
	const elbow = base.map((v, i) => v + (foot[i] - v) * 0.48) as M3;
	elbow[0] += (index % 2 === 0 ? -1 : 1) * 5 * t;
	elbow[1] += (index < 2 ? 1 : -1) * 3 * t;
	return { deployment: t, base, foot, elbow };
}

/**
 * The anchor (D-D1, refined after the second flight): key 4 anchors the ship
 * once the cutter or a strut's foot has rock in reach, at any relative speed a
 * strike would not damage (`V_SCRAPE_KMS`, 50 m/s). `seat` then draws the ship
 * onto the rock over `seatS`, squared to the surface with the cutter face
 * `gapKm` off it; `hold` locks it where it is. A rock no larger than
 * `gripRadiusKm` is gripped: the feet close around it (O3).
 */
export const ANCHOR = {
	maxKms: 0.05,
	reachKm: 0.03,
	seatS: 4,
	gapKm: 0.0003,
	gripRadiusKm: 0.06,
} as const;

export const STRUT_ANCHORS = ["seat", "hold"] as const;
export type StrutAnchor = (typeof STRUT_ANCHORS)[number];

/** Whether key 4 may anchor now, or the word the glass shows instead. */
export function anchorAllowed(a: {
	extension: number;
	faceGapKm: number | null;
	feetOnRock: number;
	relKms: number;
}): "OK" | "DEPLOYING" | "NO ROCK IN REACH" | "TOO FAST" {
	if (a.extension < 1) return "DEPLOYING";
	if (
		a.feetOnRock === 0 &&
		(a.faceGapKm === null || a.faceGapKm > ANCHOR.reachKm)
	)
		return "NO ROCK IN REACH";
	if (a.relKms > ANCHOR.maxKms) return "TOO FAST";
	return "OK";
}

/** The seated ship: nose into the surface at `point`, cutter face `gapKm` off it, up kept as near as it can be. */
export function seatPose(
	point: Vec3,
	normal: Vec3,
	up: Vec3,
	cutter: HullCutter,
): { pos: Vec3; nose: Vec3; up: Vec3 } {
	const nose = scale(normal, -1);
	const across = sub(up, scale(nose, dot(up, nose)));
	const seatedUp = normalizeOr(
		across,
		Math.abs(nose.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 },
	);
	const upOut = normalizeOr(
		sub(seatedUp, scale(nose, dot(seatedUp, nose))),
		seatedUp,
	);
	const face = add(point, scale(normal, ANCHOR.gapKm));
	return {
		pos: add(
			face,
			add(
				scale(nose, -(cutter.bowKm + cutter.feedTravelKm)),
				scale(upOut, cutter.downKm),
			),
		),
		nose,
		up: upOut,
	};
}

/** The seat's progress at `s` of 0…1: eased in and out. */
export const seatBlend = (s: number): number => {
	const t = Math.min(1, Math.max(0, s));
	return t * t * (3 - 2 * t);
};

/** Fine control's share of the stick: the turn keys and the mouse turn at this share of their rate. */
export const FINE_STICK = 0.05;

/** A world point in km to the ship's frame in metres (fore, up, starboard). */
export const shipFrameM = (
	pos: Vec3,
	nose: Vec3,
	up: Vec3,
	p: Vec3,
): { fore: number; up: number; starboard: number } => {
	const d = sub(p, pos);
	const starboard = {
		x: nose.y * up.z - nose.z * up.y,
		y: nose.z * up.x - nose.x * up.z,
		z: nose.x * up.y - nose.y * up.x,
	};
	return {
		fore: dot(d, nose) * 1000,
		up: dot(d, up) * 1000,
		starboard: dot(d, starboard) * 1000,
	};
};

/** A loadout as the prototype writes it to a save: without `h2` and `h3`, which no save loads without `?mining=1` (Q12). */
export function withoutPrototypeSlot<L extends Record<string, unknown>>(
	loadout: L,
): L {
	if (!("h2" in loadout) && !("h3" in loadout)) return loadout;
	const { h2: _port, h3: _starboard, ...rest } = loadout;
	return rest as L;
}

/** A mount's muzzle from the study's export metres to the ship mesh's frame in km (starboard +x, up +y, nose −z). */
export function mountMuzzleKm(
	exportM: readonly number[],
	cutter: HullCutter,
): Vec3 {
	const p = longwallFrame(cutter).toShip(exportM);
	return { x: p.starboard / 1000, y: p.up / 1000, z: -p.fore / 1000 };
}

/**
 * Whether a beam from `muzzleKm` (ship mesh frame) along the nose stays clear
 * of the deployed cutter's box (`HullCutter`), as D-D11 requires: a beam that
 * starts on the bow centre runs through the drill.
 */
export function beamClearsCutter(muzzleKm: Vec3, cutter: HullCutter): boolean {
	const inBeam = Math.abs(muzzleKm.x) <= cutter.radiusKm;
	const inHeight =
		muzzleKm.y >= -cutter.downKm - cutter.radiusKm &&
		muzzleKm.y <= -cutter.downKm + cutter.radiusKm;
	const ahead = -muzzleKm.z <= cutter.bowKm + cutter.feedTravelKm;
	return !(inBeam && inHeight && ahead);
}

/** The Mining Laser beams of a fired group: one per fitted mining laser, from its own slot's muzzle, along the nose (D-D11). */
export function miningBeamRays<T>(
	lasers: readonly (T & { muzzleIndex: number })[],
	muzzlesWorld: readonly Vec3[],
	nose: Vec3,
): (T & { origin: Vec3; aim: Vec3 })[] {
	return lasers.flatMap((laser) => {
		const origin = muzzlesWorld[laser.muzzleIndex];
		return origin ? [{ ...laser, origin, aim: nose }] : [];
	});
}
