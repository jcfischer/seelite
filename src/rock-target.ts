/**
 * https://github.com/jcfischer/seelite/issues/920
 * Prototype for node #920: individual rocks as selectable targets while mining is on.
 * Rocks stay out of `Game.selectable()`, whose membership is cached per system; a
 * `rock:` id resolves here against the ship's position and the game clock instead.
 */
import {
	type FieldPlan,
	type Rock,
	rockPose,
	rockSpinAngle,
	rotateByQuat,
} from "./asteroid-field";
import type { DisplayContact } from "./display-contact";
import { spinQuat } from "./field-lod";
import { type Vec3, v3 } from "./vec3";

/** Candidate: how near a rock has to be to join the target cycle, km. */
export const ROCK_SELECT_KM = 12;
/** Candidate: how many of the nearest rocks the cycle offers. */
export const ROCK_CYCLE_MAX = 12;
/** Candidate: the aim variant's widest acceptable angle off the sightline, degrees. */
export const ROCK_AIM_DEG = 20;
/** A selected rock farther than this is dropped as a target, km. */
export const ROCK_DROP_KM = 40;

/** Candidate: the front variant's cone when the sightline meets no rock, degrees. */
export const ROCK_FRONT_DEG = 5;

export const ROCK_PICKS = ["front", "near", "aim"] as const;
export type RockPick = (typeof ROCK_PICKS)[number];

export interface FieldRocks {
	plan: FieldPlan;
	rocks: readonly Rock[];
}

export interface RockRef {
	id: string;
	plan: FieldPlan;
	rock: Rock;
	pos: Vec3;
	vel: Vec3;
	distKm: number;
}

export const rockTargetId = (plan: FieldPlan, slot: number): string =>
	`rock:${plan.id}:${slot}`;
export const isRockTargetId = (id: string | null): id is string =>
	id?.startsWith("rock:") ?? false;

const dist = (a: Vec3, b: Vec3): number =>
	Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Rocks within `maxKm` of the ship, nearest first. */
export function nearRocks(
	fields: readonly FieldRocks[],
	shipPos: Vec3,
	gameTime: number,
	maxKm: number = ROCK_SELECT_KM,
): RockRef[] {
	const out: RockRef[] = [];
	for (const { plan, rocks } of fields)
		for (const rock of rocks) {
			const pose = rockPose(plan, rock, gameTime);
			const d = dist(pose.pos, shipPos) - rock.radiusKm;
			if (d <= maxKm)
				out.push({
					id: rockTargetId(plan, rock.slot),
					plan,
					rock,
					pos: pose.pos,
					vel: pose.vel,
					distKm: Math.max(0, d),
				});
		}
	return out.sort((a, b) => a.distKm - b.distKm);
}

/** The rock nearest the sightline within `maxDeg`, or `null`. */
/** How far the sightline passes outside a rock's bounding sphere, radians; 0 when it meets it. */
export function edgeAngleOff(
	c: Pick<RockRef, "pos" | "rock">,
	shipPos: Vec3,
	aim: Vec3,
): number {
	const dx = c.pos.x - shipPos.x;
	const dy = c.pos.y - shipPos.y;
	const dz = c.pos.z - shipPos.z;
	const len = Math.hypot(dx, dy, dz);
	if (len === 0) return 0;
	const cos = (dx * aim.x + dy * aim.y + dz * aim.z) / len;
	return Math.max(
		0,
		Math.acos(Math.min(1, cos)) - Math.asin(Math.min(1, c.rock.radiusKm / len)),
	);
}

export function aimedRock(
	candidates: readonly RockRef[],
	shipPos: Vec3,
	aim: Vec3,
	maxDeg: number = ROCK_AIM_DEG,
): RockRef | null {
	let best: RockRef | null = null;
	let bestAngle = (maxDeg * Math.PI) / 180;
	for (const c of candidates) {
		const angle = edgeAngleOff(c, shipPos, aim);
		if (angle < bestAngle) {
			best = c;
			bestAngle = angle;
		}
	}
	return best;
}

/** Resolve a `rock:` id at `gameTime`, or `null` when it names no generated rock. */
export function resolveRock(
	fields: readonly FieldRocks[],
	id: string,
	shipPos: Vec3,
	gameTime: number,
): RockRef | null {
	const m = /^rock:(.+):(\d+)$/.exec(id);
	if (!m) return null;
	const field = fields.find((f) => f.plan.id === m[1]);
	const rock = field?.rocks.find((r) => r.slot === Number(m[2]));
	if (!field || !rock) return null;
	const pose = rockPose(field.plan, rock, gameTime);
	return {
		id,
		plan: field.plan,
		rock,
		pos: pose.pos,
		vel: pose.vel,
		distKm: Math.max(0, dist(pose.pos, shipPos) - rock.radiusKm),
	};
}

/** The next target id under the `near` variant: from anything but a near rock the key goes to the nearest rock; past the rocks it continues into the ordinary list. */
export function cycleWithRocks(
	rockIds: readonly string[],
	ordinaryIds: readonly string[],
	current: string | null,
	step: number,
): string | null {
	const list = [...rockIds, ...ordinaryIds];
	if (list.length === 0) return null;
	if (rockIds.length > 0 && (current === null || !rockIds.includes(current)))
		return step >= 0 ? rockIds[0] : rockIds[rockIds.length - 1];
	const at = current === null ? -1 : list.indexOf(current);
	if (at === -1) return step >= 0 ? list[0] : list[list.length - 1];
	return list[(at + step + list.length * 2) % list.length];
}

/** A rock as a target contact. */
export function rockContact(ref: RockRef): DisplayContact {
	return {
		id: ref.id,
		name: "Rock",
		kind: "rock",
		pos: ref.pos,
		radiusKm: ref.rock.radiusKm,
		color: 0xaaa090,
		velocity: ref.vel,
		standing: null,
		scannerClass: "unknown",
	};
}

/** Where a direction in a rock's own frame points now, star-centric unit vector: field rotation over spin, as `FieldDraw` places it. */
export function rockDirectionNow(
	ref: RockRef,
	localDir: Vec3,
	gameTime: number,
): Vec3 {
	const spun = rotateByQuat(
		spinQuat(ref.rock, rockSpinAngle(ref.rock, gameTime)),
		localDir,
	);
	const out = rotateByQuat(ref.plan.rotation, spun);
	return v3(out.x, out.y, out.z);
}

/** The inverse of `rockDirectionNow`: a star-centric vector in the rock's own frame. */
export function rockLocalVector(ref: RockRef, v: Vec3, gameTime: number): Vec3 {
	const r = ref.plan.rotation;
	const field = rotateByQuat({ x: -r.x, y: -r.y, z: -r.z, w: r.w }, v);
	const q = spinQuat(ref.rock, rockSpinAngle(ref.rock, gameTime));
	const out = rotateByQuat({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, field);
	return v3(out.x, out.y, out.z);
}

/**
 * The rock in front (the principal, 2026-10-27): the nearest rock the sightline
 * meets, else the rock whose edge is nearest the sightline within `maxDeg`.
 */
export function frontRock(
	candidates: readonly RockRef[],
	shipPos: Vec3,
	aim: Vec3,
	maxDeg: number = ROCK_FRONT_DEG,
): RockRef | null {
	let hit: RockRef | null = null;
	let hitAlong = Number.POSITIVE_INFINITY;
	for (const c of candidates) {
		const ox = shipPos.x - c.pos.x;
		const oy = shipPos.y - c.pos.y;
		const oz = shipPos.z - c.pos.z;
		const b = ox * aim.x + oy * aim.y + oz * aim.z;
		const disc = b * b - (ox * ox + oy * oy + oz * oz - c.rock.radiusKm ** 2);
		if (disc < 0) continue;
		const along = Math.max(0, -b - Math.sqrt(disc));
		if (-b + Math.sqrt(disc) < 0) continue;
		if (along < hitAlong) {
			hit = c;
			hitAlong = along;
		}
	}
	return hit ?? aimedRock(candidates, shipPos, aim, maxDeg);
}
