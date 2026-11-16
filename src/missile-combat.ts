/** Transient combat state; Game owns damage, saved ammo, and carrier outcomes. */
import { type Loadout } from "./loadout";
import {
	type Missile,
	type MissileLock,
	type MissileTarget,
	acquireMissileLock,
	launchMissile,
	missileInCone,
	pulseEcm,
	seededRaiderLoadout,
} from "./missiles";
import { type Vec3, sub, dot, length, scale, clamp } from "./vec3";

export interface MissileSolid {
	id: string;
	pos: Vec3;
	radiusKm: number;
}
/** A sphere blocks the open segment, never merely its infinite ray. */
export function missileVisible(
	origin: Vec3,
	target: MissileTarget,
	solids: readonly MissileSolid[],
): boolean {
	const offset = sub(target.pos, origin),
		km = length(offset);
	if (!km) return true;
	const dir = scale(offset, 1 / km);
	return !solids.some((s) => {
		if (s.id === target.id) return false;
		const to = sub(s.pos, origin),
			along = clamp(dot(to, dir), 0, km);
		return length(sub(to, scale(dir, along))) < s.radiusKm;
	});
}
export class MissileCombat {
	lock: MissileLock | null = null;
	missiles: Missile[] = [];
	ecmReadyAt = 0;
	notice = "";
	noticeUntil = 0;
	enemy: {
		seed: number;
		loadout: Loadout;
		lock: MissileLock | null;
		launchAt: number;
	} | null = null;

	reset() {
		this.lock = null;
		this.missiles = [];
		this.enemy = null;
		this.ecmReadyAt = 0;
		this.notice = "";
		this.noticeUntil = 0;
	}
	acquire(
		target: MissileTarget | null,
		origin: Vec3,
		nose: Vec3,
		solids: readonly MissileSolid[],
		dt: number,
	) {
		this.lock = acquireMissileLock(
			this.lock,
			target?.id ?? null,
			!!target &&
				missileInCone(origin, nose, target) &&
				missileVisible(origin, target, solids),
			dt,
		);
	}
	launch(
		loadout: Loadout,
		target: MissileTarget | null,
		origin: Vec3,
		nose: Vec3,
		now: number,
	): Loadout | null {
		const out =
			target && launchMissile(loadout, this.lock, target, origin, nose);
		if (!out) {
			this.say("MISSILE · NEED AMMO AND LOCK", now);
			return null;
		}
		this.missiles.push(out.missile);
		this.lock = null;
		this.say("MISSILE AWAY", now);
		return out.loadout;
	}
	ecm(loadout: Loadout, energy: number, now: number, pos: Vec3): number {
		const out = pulseEcm(
			loadout,
			energy,
			this.ecmReadyAt,
			now,
			"player",
			pos,
			this.missiles,
		);
		this.missiles = [...out.missiles];
		this.ecmReadyAt = out.readyAt;
		this.say(
			out.fired ? "ECM PULSE" : "ECM · NEED MODULE, BANK AND READY",
			now,
		);
		return out.energy;
	}
	/** AI trigger discipline: one missile in flight at a time, eight seconds
	 * between launches, and the same uninterrupted cone/visibility lock. */
	launchEnemy(
		seed: number,
		origin: Vec3,
		nose: Vec3,
		target: MissileTarget,
		solids: readonly MissileSolid[],
		now: number,
		dt: number,
		loadout?: Loadout,
	) {
		if (this.enemy?.seed !== seed)
			this.enemy = {
				seed,
				loadout: loadout ?? seededRaiderLoadout(seed),
				lock: null,
				launchAt: now + 8,
			};
		const e = this.enemy!;
		e.lock = acquireMissileLock(
			e.lock,
			target.id,
			missileInCone(origin, nose, target) &&
				missileVisible(origin, target, solids),
			dt,
		);
		if (now < e.launchAt || this.missiles.some((m) => m.targetId === "player"))
			return;
		const out = launchMissile(e.loadout, e.lock, target, origin, nose);
		if (!out) return;
		e.loadout = out.loadout;
		e.lock = null;
		e.launchAt = now + 8;
		this.missiles.push(out.missile);
	}
	say(text: string, now: number) {
		this.notice = text;
		this.noticeUntil = now + 3;
	}
}
