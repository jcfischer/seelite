/**
 * A pilot with only a pilot's information, flying to a raider's cargo (#324).
 *
 * The fourth playtest could not scoop a canister: "they fly / whizz past on a
 * merge. It's not possible to line up with the vector of them and come in from
 * behind." #330's flown probe row could not see it, because it set the nose
 * each frame and steered on the canister's exact velocity. This model has what
 * a pilot has and nothing more:
 *
 * - the canister's marker: its bearing and range, not its velocity;
 * - the ship's own speed readout, through the assist's throttle;
 * - the courier's turn, through `stepAngular` at its hull's limits.
 *
 * It flies **stop, face, creep**: no throttle while the nearest canister is
 * more than 8° off the nose, and otherwise a speed that falls with range.
 *
 * **It cannot chase** (sage #346). Near a canister it creeps at under
 * 0.1 km/s, so it never catches one that keeps moving faster than that. That
 * makes it a check on the fade — a canister has to come to rest for this pilot
 * to reach it — and not evidence that no pilot can scoop a drifting canister.
 * While diagnosing, a pilot holding a closing speed off the range readout did
 * scoop some drifting canisters. `scripts/measure-canister-scoop.ts` reprints
 * this pilot with the fade and with it switched off (`drifting`).
 *
 * The scenario is the merge: the raider dies at the assist cap, fleeing in a
 * drawn direction, and the player is 1.5 km out at the cap with its nose within
 * about 20° of the wreck. Every function it steps is the game's own.
 */
import { raiderSlots } from "../../src/raider-slots";
import {
	type Canister,
	dropCanisters,
	stepCanisters,
} from "../../src/raider-wreck";
import {
	ASSIST_CAP_KMS,
	type Angular,
	flightPerformance,
	stepAngular,
	stepFlight,
} from "../../src/sim";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "../../src/vec3";

export const PILOT_DT = 1 / 60;
const COURIER = flightPerformance("courier");
/** Past this off-nose angle the pilot cuts the throttle and turns first. */
const FACE_FIRST_DEG = 8;

const unit = normalizeOr;
const rotate = (v: Vec3, axis: Vec3, angle: number) =>
	add(
		add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))),
		scale(axis, dot(axis, v) * (1 - Math.cos(angle))),
	);

/** A small deterministic generator for the scenario, apart from the game's. */
function scenarioRandom(seed: number) {
	let s = (seed * 2654435761) >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 0x1_0000_0000;
	};
}
function randomUnit(r: () => number): Vec3 {
	const z = r() * 2 - 1;
	const t = r() * Math.PI * 2;
	const q = Math.sqrt(1 - z * z);
	return v3(q * Math.cos(t), q * Math.sin(t), z);
}

export interface CargoRun {
	dropped: number;
	scooped: number;
	/** Seconds after the kill the last canister was scooped, or null. */
	allScoopedS: number | null;
}

/**
 * One kill at the cap and one pilot flying to its cargo for `limitS`.
 * `drifting` switches the fade off, for the comparison arm: each canister's
 * `restsAt` is set so far ahead that the share of its drift left each step is
 * 1 to float precision.
 */
export function flyToCargo(
	seed: number,
	limitS = 120,
	drifting = false,
): CargoRun {
	const r = scenarioRandom(seed);
	const frameVel = v3();
	const killedAt = 1000 + seed;
	let canisters: Canister[] = dropCanisters({
		systemSeed: seed,
		government: 3,
		key: raiderSlots(58, 0)[0].key,
		killedAt,
		pos: v3(),
		vel: scale(randomUnit(r), ASSIST_CAP_KMS),
		frameVel,
	});
	if (drifting)
		canisters = canisters.map((c) => ({ ...c, restsAt: Number.MAX_VALUE }));
	const dropped = canisters.length;
	const toWreck = randomUnit(r);
	const aside = randomUnit(r);
	let nose = unit(
		add(
			toWreck,
			scale(
				unit(sub(aside, scale(toWreck, dot(aside, toWreck))), aside),
				0.35 * r(),
			),
		),
		toWreck,
	);
	const upSeed = randomUnit(r);
	let up = unit(sub(upSeed, scale(nose, dot(upSeed, nose))), v3(0, 1, 0));
	const ship = { pos: scale(toWreck, -1.5), vel: scale(nose, ASSIST_CAP_KMS) };
	let rates: Angular = { pitch: 0, yaw: 0, roll: 0 };
	let scooped = 0;
	for (let t = 0; t < limitS; t += PILOT_DT) {
		const now = killedAt + t;
		const step = stepCanisters(canisters, ship, PILOT_DT, now, () => true);
		scooped += step.scoops.filter((s) => s.accepted).length;
		canisters = step.kept;
		if (scooped === dropped) return { dropped, scooped, allScoopedS: t };
		if (canisters.length === 0) break;
		// The nearest marker, by range: all a pilot reads of it.
		let target = canisters[0];
		for (const c of canisters)
			if (length(sub(c.pos, ship.pos)) < length(sub(target.pos, ship.pos)))
				target = c;
		const toTarget = sub(target.pos, ship.pos);
		const km = length(toTarget);
		const desired = unit(toTarget, nose);
		const right = cross(nose, up);
		const off = Math.acos(Math.max(-1, Math.min(1, dot(nose, desired))));
		let pitch = 0;
		let yaw = 0;
		if (off > 1e-3) {
			const arc = unit(cross(nose, desired), right);
			const stick = Math.min(
				1,
				Math.sqrt(2 * COURIER.angularAccel * off) / COURIER.angularMax.yaw,
			);
			pitch = dot(arc, right) * stick;
			yaw = dot(arc, up) * stick;
		}
		rates = stepAngular(
			rates,
			{ pitch, yaw, roll: 0 },
			{ pitch: 0, yaw: 0, roll: 0 },
			true,
			PILOT_DT,
			COURIER,
		);
		const spin = add(scale(right, rates.pitch), scale(up, rates.yaw));
		const w = length(spin);
		if (w > 0) {
			const axis = scale(spin, 1 / w);
			nose = unit(rotate(nose, axis, w * PILOT_DT), nose);
			const turnedUp = rotate(up, axis, w * PILOT_DT);
			up = unit(sub(turnedUp, scale(nose, dot(turnedUp, nose))), up);
		}
		const throttle =
			(off * 180) / Math.PI > FACE_FIRST_DEG
				? 0
				: Math.min(1, (0.5 * km + 0.05) / ASSIST_CAP_KMS);
		stepFlight(
			ship,
			{ nose, throttle, assist: true, frameVel },
			PILOT_DT,
			COURIER,
		);
	}
	return { dropped, scooped, allScoopedS: null };
}
