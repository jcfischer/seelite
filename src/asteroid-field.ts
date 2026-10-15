/**
 * Asteroid fields and their rocks, generated in the sim (node #965).
 *
 * The contract is #948's D1–D6, ratified on #918; the spike
 * `spikes/asteroid-fields-948/field-proto.ts` is the reference this module
 * reproduces draw for draw. Headless and Three-free: nothing here draws,
 * collides or saves.
 *
 * **Fields are not carriers (#918 Q5, #948 D2).** Nothing here enters
 * `enumerateCarriers`, `placeBodies` or the body list, so the carrier baseline
 * fingerprint and `WORLD_GENERATOR_VERSION` do not move. Fields carry their own
 * `FIELD_GENERATOR_VERSION` and a per-galaxy `fieldBaselineFingerprint`
 * instead, because a deposit row is keyed `(galaxy, system, fieldId, rockSlot)`
 * and a saved identity has one owner (#46).
 *
 * **Ids are slots, never push order (#109).** `field-00` is the charted field
 * (iff the system has a refinery), `field-01` the rare one; a later field type
 * takes a new number and never reuses one. A rock is `(fieldId, rockSlot)`,
 * where the rock slot is a lattice cell in a fixed enumeration of the field's
 * ellipsoid with its own sub-stream, so a rock is a function of its slot alone
 * and an occupancy retune adds or removes rocks without moving any.
 *
 * **Motion is closed form.** A field's centre rides a star-centric orbit; its
 * frame orientation is fixed in inertial space; each rock circles an anchor
 * inside its own cell and spins about its own axis. Position, velocity and spin
 * angle are all functions of `(seed, gameTime)` — nothing is integrated and
 * nothing is saved.
 */

import { DOMAIN } from "./domains";
import { type SystemRecord, generateGalaxy, stream } from "./galaxy";
import { fnv1a, mix } from "./rng";
import {
	MAX_ORBIT_AU,
	type Orbit,
	type Planet,
	type SystemContents,
	generateContents,
	orbitNormal,
	orbitalPeriodS,
	positionOnOrbit,
	velocityOnOrbit,
} from "./system";
import { AU_KM } from "./units";
import { type Vec3, cross } from "./vec3";

const TAU = Math.PI * 2;

/**
 * The field generator's own version (#948 D6). Bump it on any change that
 * moves, resizes or re-slots an existing rock — `fieldBaselineFingerprint`
 * goes red when one does — and owe the deposit migration #951 D5 defines.
 * Independent of `WORLD_GENERATOR_VERSION`: a carrier change rebases no
 * deposit, and a rock retune migrates no world.
 */
export const FIELD_GENERATOR_VERSION = 1;

/** Fixed field slots (#948 D2). */
export const FIELD_SLOT = { charted: 0, rare: 1 } as const;
export type FieldProfileName = keyof typeof FIELD_SLOT;

export const fieldId = (slot: number): string =>
	`field-${String(slot).padStart(2, "0")}`;

// --- placement (#948 D3, D4) -------------------------------------------------

/** A charted field's lead along its refinery's orbit, km, either side. */
export const CHARTED_LEAD_KM = [150, 300] as const;
/** A charted field's offset off its orbit's plane, ± km. */
export const CHARTED_OFFPLANE_KM = 30;
/** Chance a system has a rare field, per system (Q9). */
export const RARE_FIELD_CHANCE = 0.2;
/** A belt field's least phase from the refinery, either way: ≥ 0.5 a apart. */
export const RARE_BELT_MIN_PHASE = Math.PI / 6;
/** An outer-orbit field's radius, × the outermost planet's `aAu`. */
export const OUTER_ORBIT_FACTOR = [1.3, 1.8] as const;
/** A rare field's offset off its orbit's plane, ± km. */
export const RARE_OFFPLANE_KM = 2000;
/** An outer-orbit field's inclination ceiling, radians. */
export const RARE_MAX_INCLINATION = (3 * Math.PI) / 180;
/** L4/L5: a Trojan field's phase from its host. */
export const TROJAN_RAD = Math.PI / 3;
/** A rare field's draws, consumed whatever branch it takes (#948 D1). */
const RARE_DRAW_BUDGET = 8;

// --- rocks (#948 D5) ----------------------------------------------------------

export interface FieldProfile {
	/** Ellipsoid semi-axes, km, in the field frame. */
	semiKm: readonly [number, number, number];
	/** Lattice cell edge, km. One rock slot per cell. */
	cellKm: number;
	/** Chance a cell holds a rock. */
	occupancy: number;
	/** Bounding radius range, km. */
	rockRadiusKm: readonly [number, number];
	/** Radius power law, p(r) ∝ r^−alpha. */
	alpha: number;
	/** Least surface gap between two rocks, km: each keeps half of it. */
	marginKm: number;
}

export const FIELD_PROFILE: Readonly<Record<FieldProfileName, FieldProfile>> = {
	charted: {
		semiKm: [24, 12, 6],
		cellKm: 2.4,
		occupancy: 0.35,
		rockRadiusKm: [0.025, 0.4],
		alpha: 2.4,
		marginKm: 0.2,
	},
	rare: {
		semiKm: [16, 10, 6],
		cellKm: 2.6,
		occupancy: 0.4,
		rockRadiusKm: [0.04, 0.6],
		alpha: 2.0,
		marginKm: 0.2,
	},
};

/** Spin period, log-uniform, s. */
export const SPIN_PERIOD_S = [4 * 60, 40 * 60] as const;
/** Equatorial spin speed ceiling, km/s (6 m/s): a period is lengthened to it. */
export const SPIN_SURFACE_CAP_KMS = 0.006;
/** Drift period, log-uniform, s. */
export const DRIFT_PERIOD_S = [3600, 6 * 3600] as const;
/** Drift radius, as a fraction of the cell's free play. */
export const DRIFT_FRACTION = [0.2, 0.6] as const;
/** Drift speed ceiling, km/s (2 m/s): a period is lengthened to it. */
export const DRIFT_CAP_KMS = 0.002;

// --- plans --------------------------------------------------------------------

export type PlacementKind =
	| "refinery-orbit"
	| "belt"
	| "trojan"
	| "outer-orbit"
	| "outer-trojan";

/** A unit quaternion. */
export interface Quat {
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface FieldPlan {
	id: string;
	slot: number;
	profile: FieldProfileName;
	kind: PlacementKind;
	/** The star-centric orbit the field centre rides. */
	orbit: Orbit;
	/** Offset along the orbit's normal, km. */
	offPlaneKm: number;
	/** The field frame's orientation, fixed in inertial space. */
	rotation: Quat;
	/** The station or planet the placement is read from, or `null`. */
	hostId: string | null;
}

const uniform = (rand: () => number, lo: number, hi: number): number =>
	lo + (hi - lo) * rand();

const fieldStream = (systemSeed: number, slot: number): (() => number) =>
	stream(mix(systemSeed, slot), DOMAIN.ASTEROID_FIELD);

/** Shoemake's uniform random rotation: three draws. */
function drawRotation(rand: () => number): Quat {
	const u1 = rand();
	const u2 = rand();
	const u3 = rand();
	const a = Math.sqrt(1 - u1);
	const b = Math.sqrt(u1);
	return {
		x: a * Math.sin(TAU * u2),
		y: a * Math.cos(TAU * u2),
		z: b * Math.sin(TAU * u3),
		w: b * Math.cos(TAU * u3),
	};
}

/** `field-00`, on the refinery's own orbit, or `null` without a refinery. */
export function chartedField(
	record: SystemRecord,
	contents: SystemContents,
): FieldPlan | null {
	const refinery = contents.stations.find((s) => s.type === "refinery");
	if (!refinery) return null;
	if (refinery.parentId !== null)
		throw new Error(`${refinery.id} is not star-centric`);
	const rand = fieldStream(record.seed, FIELD_SLOT.charted);
	const side = rand() < 0.5 ? -1 : 1;
	const leadKm = side * uniform(rand, CHARTED_LEAD_KM[0], CHARTED_LEAD_KM[1]);
	const offPlaneKm = uniform(rand, -CHARTED_OFFPLANE_KM, CHARTED_OFFPLANE_KM);
	const rotation = drawRotation(rand);
	return {
		id: fieldId(FIELD_SLOT.charted),
		slot: FIELD_SLOT.charted,
		profile: "charted",
		kind: "refinery-orbit",
		// Co-orbiting: the same period, so the gap never changes.
		orbit: {
			...refinery.orbit,
			theta0: refinery.orbit.theta0 + leadKm / refinery.orbit.radiusKm,
		},
		offPlaneKm,
		rotation,
		hostId: refinery.id,
	};
}

/** The rare field's roll: its own tag, one draw. */
export const rareFieldPresent = (record: SystemRecord): boolean =>
	stream(record.seed, DOMAIN.ASTEROID_FIELD_ROLL)() < RARE_FIELD_CHANCE;

/** `field-01`, the rare field, on #948 D4's four branches, or `null`. */
export function rareField(
	record: SystemRecord,
	contents: SystemContents,
): FieldPlan | null {
	if (!rareFieldPresent(record)) return null;
	const rand = fieldStream(record.seed, FIELD_SLOT.rare);
	const d = Array.from({ length: RARE_DRAW_BUDGET }, () => rand());
	const rotation = drawRotation(rand);
	const base = {
		id: fieldId(FIELD_SLOT.rare),
		slot: FIELD_SLOT.rare,
		profile: "rare" as const,
		rotation,
		offPlaneKm: (d[5] * 2 - 1) * RARE_OFFPLANE_KM,
	};
	if (contents.belt) {
		// The refinery's own orbit, so the phase gap never closes.
		const refinery = contents.stations.find((s) => s.type === "refinery");
		if (!refinery) throw new Error("a belt without a refinery");
		const phase =
			refinery.orbit.theta0 +
			RARE_BELT_MIN_PHASE +
			d[1] * (TAU - 2 * RARE_BELT_MIN_PHASE);
		return {
			...base,
			kind: "belt",
			hostId: null,
			orbit: { ...refinery.orbit, theta0: phase },
		};
	}
	const outpost = contents.stations.find((s) => s.type === "outpost");
	const trojanOf = (host: Planet, kind: PlacementKind): FieldPlan => {
		let side = d[3] < 0.5 ? -1 : 1;
		const held = (s: number): boolean =>
			outpost !== undefined &&
			outpost.orbit.radiusKm === host.orbit.radiusKm &&
			Math.abs(outpost.orbit.theta0 - (host.orbit.theta0 + s * TROJAN_RAD)) <
				1e-9;
		if (held(side)) side = -side;
		return {
			...base,
			kind,
			hostId: host.id,
			orbit: { ...host.orbit, theta0: host.orbit.theta0 + side * TROJAN_RAD },
		};
	};
	const giants = contents.planets.filter((p) => p.isGasGiant);
	if (giants.length > 0)
		return trojanOf(giants[Math.floor(d[2] * giants.length)], "trojan");
	const outer = contents.planets.reduce((a, b) => (b.aAu > a.aAu ? b : a));
	const aAu =
		outer.aAu *
		uniform(() => d[4], OUTER_ORBIT_FACTOR[0], OUTER_ORBIT_FACTOR[1]);
	if (aAu <= MAX_ORBIT_AU)
		return {
			...base,
			kind: "outer-orbit",
			hostId: null,
			orbit: {
				radiusKm: aAu * AU_KM,
				periodS: orbitalPeriodS(aAu, contents.star.massSolar),
				theta0: d[1] * TAU,
				inclination: uniform(() => d[6], 0, RARE_MAX_INCLINATION),
				node: d[7] * TAU,
			},
		};
	return trojanOf(outer, "outer-trojan");
}

/** Every field a system has, in slot order. */
export function systemFields(
	record: SystemRecord,
	contents: SystemContents,
): FieldPlan[] {
	const out: FieldPlan[] = [];
	const charted = chartedField(record, contents);
	if (charted) out.push(charted);
	const rare = rareField(record, contents);
	if (rare) out.push(rare);
	return out;
}

// --- rocks --------------------------------------------------------------------

export interface Rock {
	/** The lattice cell's index: the rock's identity within its field. */
	slot: number;
	/** Bounding radius, km: no drawn or collision vertex lies outside it. */
	radiusKm: number;
	shapeSeed: number;
	/** The drift circle's centre, field frame, km. */
	anchor: Vec3;
	/** The drift circle's radius, km. */
	driftKm: number;
	/** The drift circle's in-plane basis, field frame. */
	e1: Vec3;
	e2: Vec3;
	driftPeriodS: number;
	driftPhase: number;
	/** Spin axis, field frame, unit. */
	spinAxis: Vec3;
	spinPeriodS: number;
	spinPhase: number;
}

/** The lattice cell centres inside a profile's ellipsoid, in slot order. */
export function fieldCells(profile: FieldProfile): Vec3[] {
	const [a, b, c] = profile.semiKm;
	const n = (s: number): number => Math.ceil(s / profile.cellKm);
	const out: Vec3[] = [];
	for (let i = -n(a); i <= n(a); i++)
		for (let j = -n(b); j <= n(b); j++)
			for (let k = -n(c); k <= n(c); k++) {
				const x = i * profile.cellKm;
				const y = j * profile.cellKm;
				const z = k * profile.cellKm;
				if ((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2 <= 1)
					out.push({ x, y, z });
			}
	return out;
}

const onSphere = (cosA: number, phi: number): Vec3 => {
	const s = Math.sqrt(1 - cosA * cosA);
	return { x: s * Math.cos(phi), y: s * Math.sin(phi), z: cosA };
};

/** A rock slot's stream: the field slot, then the rock slot. */
const rockStream = (
	systemSeed: number,
	fieldSlot: number,
	rockSlot: number,
): (() => number) =>
	stream(mix(mix(systemSeed, fieldSlot), rockSlot), DOMAIN.ASTEROID_ROCKS);

/**
 * A rock slot's hidden-contents stream, split like its layout and on its own
 * tag (#948 D1). Reserved: nothing draws from it until #951 and #920.
 */
export const rockDepositStream = (
	systemSeed: number,
	fieldSlot: number,
	rockSlot: number,
): (() => number) =>
	stream(mix(mix(systemSeed, fieldSlot), rockSlot), DOMAIN.ASTEROID_DEPOSIT);

/**
 * A field's rocks, in slot order; `profile` defaults to the plan's own and is a
 * parameter so a retune can be measured against the shipped one.
 *
 * Every slot makes the same fifteen draws in #948 D5's order whether or not it
 * is occupied — occupancy, radius, anchor ×3, shape seed, spin axis ×2, spin
 * period, spin phase, drift fraction, drift plane ×2, drift period, drift
 * phase — and a new draw goes at the end.
 */
export function fieldRocks(
	record: SystemRecord,
	plan: FieldPlan,
	profile: FieldProfile = FIELD_PROFILE[plan.profile],
): Rock[] {
	const cells = fieldCells(profile);
	const [r0, r1] = profile.rockRadiusKm;
	const k = 1 - profile.alpha;
	const out: Rock[] = [];
	for (let slot = 0; slot < cells.length; slot++) {
		const rand = rockStream(record.seed, plan.slot, slot);
		const occupied = rand();
		const radiusU = rand();
		const jx = rand();
		const jy = rand();
		const jz = rand();
		const shapeSeed = Math.floor(rand() * 0x100000000);
		const axisCos = 2 * rand() - 1;
		const axisPhi = TAU * rand();
		const spinU = rand();
		const spinPhase = TAU * rand();
		const driftU = rand();
		const planeCos = 2 * rand() - 1;
		const planePhi = TAU * rand();
		const driftPeriodU = rand();
		const driftPhase = TAU * rand();
		if (occupied >= profile.occupancy) continue;
		// Inverse CDF of the truncated power law.
		const radiusKm = (r0 ** k + radiusU * (r1 ** k - r0 ** k)) ** (1 / k);
		// How far the centre may stray from the cell's centre and keep the rock,
		// plus half the margin, inside the cell's inscribed sphere.
		const play = Math.max(
			0,
			profile.cellKm / 2 - radiusKm - profile.marginKm / 2,
		);
		const spinPeriodS = Math.max(
			(TAU * radiusKm) / SPIN_SURFACE_CAP_KMS,
			logUniform(spinU, SPIN_PERIOD_S),
		);
		// |anchor offset| + drift radius ≤ play: the rock never leaves its cell.
		const driftKm =
			play *
			(DRIFT_FRACTION[0] + driftU * (DRIFT_FRACTION[1] - DRIFT_FRACTION[0]));
		const ball = play - driftKm;
		const dir = onSphere(2 * jx - 1, TAU * jy);
		const offset = ball * Math.cbrt(jz);
		const cell = cells[slot];
		const normal = onSphere(planeCos, planePhi);
		// Never parallel to the reference, so never zero; divided rather than
		// scaled by a reciprocal so the basis is the spike's to the last bit.
		const across = cross(
			normal,
			Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 },
		);
		const acrossLen = Math.hypot(across.x, across.y, across.z);
		const e1 = {
			x: across.x / acrossLen,
			y: across.y / acrossLen,
			z: across.z / acrossLen,
		};
		const e2 = cross(normal, e1);
		const driftPeriodS = Math.max(
			driftKm > 0 ? (TAU * driftKm) / DRIFT_CAP_KMS : 0,
			logUniform(driftPeriodU, DRIFT_PERIOD_S),
		);
		out.push({
			slot,
			radiusKm,
			shapeSeed,
			anchor: {
				x: cell.x + dir.x * offset,
				y: cell.y + dir.y * offset,
				z: cell.z + dir.z * offset,
			},
			driftKm,
			e1,
			e2,
			driftPeriodS,
			driftPhase,
			spinAxis: onSphere(axisCos, axisPhi),
			spinPeriodS,
			spinPhase,
		});
	}
	return out;
}

const logUniform = (u: number, [lo, hi]: readonly [number, number]): number =>
	Math.exp(Math.log(lo) + u * Math.log(hi / lo));

// --- motion -------------------------------------------------------------------

/** Rotate `v` by the unit quaternion `q`. */
export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
	// v' = v + 2w(u×v) + 2u×(u×v), u the vector part.
	const tx = 2 * (q.y * v.z - q.z * v.y);
	const ty = 2 * (q.z * v.x - q.x * v.z);
	const tz = 2 * (q.x * v.y - q.y * v.x);
	return {
		x: v.x + q.w * tx + (q.y * tz - q.z * ty),
		y: v.y + q.w * ty + (q.z * tx - q.x * tz),
		z: v.z + q.w * tz + (q.x * ty - q.y * tx),
	};
}

/** The field centre at `gameTime`, star-centric km. */
export function fieldCentre(plan: FieldPlan, gameTime: number): Vec3 {
	const p = positionOnOrbit(plan.orbit, gameTime);
	const n = orbitNormal(plan.orbit);
	return {
		x: p.x + n.x * plan.offPlaneKm,
		y: p.y + n.y * plan.offPlaneKm,
		z: p.z + n.z * plan.offPlaneKm,
	};
}

/** The field centre's velocity, km/s: the offset is fixed, so it is the
 *  orbit's. */
export const fieldCentreVelocity = (plan: FieldPlan, gameTime: number): Vec3 =>
	velocityOnOrbit(plan.orbit, gameTime);

/** A rock's position in the field frame at `gameTime`: anchor + drift. */
export function rockLocal(rock: Rock, gameTime: number): Vec3 {
	const w = (TAU * gameTime) / rock.driftPeriodS + rock.driftPhase;
	const c = Math.cos(w) * rock.driftKm;
	const s = Math.sin(w) * rock.driftKm;
	return {
		x: rock.anchor.x + c * rock.e1.x + s * rock.e2.x,
		y: rock.anchor.y + c * rock.e1.y + s * rock.e2.y,
		z: rock.anchor.z + c * rock.e1.z + s * rock.e2.z,
	};
}

/** A rock's velocity in the field frame, km/s: the exact derivative. */
export function rockLocalVelocity(rock: Rock, gameTime: number): Vec3 {
	const omega = TAU / rock.driftPeriodS;
	const w = omega * gameTime + rock.driftPhase;
	const c = -Math.sin(w) * rock.driftKm * omega;
	const s = Math.cos(w) * rock.driftKm * omega;
	return {
		x: c * rock.e1.x + s * rock.e2.x,
		y: c * rock.e1.y + s * rock.e2.y,
		z: c * rock.e1.z + s * rock.e2.z,
	};
}

/** A rock's spin angle about its axis at `gameTime`, radians. */
export const rockSpinAngle = (rock: Rock, gameTime: number): number =>
	rock.spinPhase + (TAU * gameTime) / rock.spinPeriodS;

/** A rock's equatorial spin speed, km/s. */
export const rockSpinSpeedKms = (rock: Rock): number =>
	(TAU * rock.radiusKm) / rock.spinPeriodS;

/** A rock's drift speed, km/s: constant on its circle. */
export const rockDriftSpeedKms = (rock: Rock): number =>
	(TAU * rock.driftKm) / rock.driftPeriodS;

export interface RockPose {
	/** Star-centric km. */
	pos: Vec3;
	/** Km/s, the exact derivative of `pos`. */
	vel: Vec3;
	/** Spin angle about `spinAxis`, radians. */
	spinAngle: number;
	/** Spin axis, star-centric, unit. */
	spinAxis: Vec3;
}

/** A rock at `gameTime`: `centre(t) + R·(anchor + drift(t))`, and its derivative. */
export function rockPose(
	plan: FieldPlan,
	rock: Rock,
	gameTime: number,
): RockPose {
	const centre = fieldCentre(plan, gameTime);
	const local = rotateByQuat(plan.rotation, rockLocal(rock, gameTime));
	const centreVel = fieldCentreVelocity(plan, gameTime);
	const localVel = rotateByQuat(
		plan.rotation,
		rockLocalVelocity(rock, gameTime),
	);
	return {
		pos: {
			x: centre.x + local.x,
			y: centre.y + local.y,
			z: centre.z + local.z,
		},
		vel: {
			x: centreVel.x + localVel.x,
			y: centreVel.y + localVel.y,
			z: centreVel.z + localVel.z,
		},
		spinAngle: rockSpinAngle(rock, gameTime),
		spinAxis: rotateByQuat(plan.rotation, rock.spinAxis),
	};
}

// --- identity -----------------------------------------------------------------

/**
 * One rock's identity, shape and complete closed-form pose inputs. Include the
 * field placement as well as the local anchor: an unchanged anchor can ride a
 * changed orbit or frame. Numbers retain their round-trip precision; rounding
 * angles to six places can hide metres of motion at orbital distances.
 */
export const fieldFingerprintRow = (
	systemIndex: number,
	plan: FieldPlan,
	rock: Rock,
): string =>
	[
		systemIndex,
		plan.id,
		plan.kind,
		rock.slot,
		rock.radiusKm,
		rock.anchor.x,
		rock.anchor.y,
		rock.anchor.z,
		plan.orbit.radiusKm,
		plan.orbit.periodS,
		plan.orbit.theta0,
		plan.orbit.inclination,
		plan.orbit.node,
		plan.offPlaneKm,
		plan.rotation.x,
		plan.rotation.y,
		plan.rotation.z,
		plan.rotation.w,
		rock.shapeSeed,
		rock.driftKm,
		rock.e1.x,
		rock.e1.y,
		rock.e1.z,
		rock.e2.x,
		rock.e2.y,
		rock.e2.z,
		rock.driftPeriodS,
		rock.driftPhase,
		rock.spinAxis.x,
		rock.spinAxis.y,
		rock.spinAxis.z,
		rock.spinPeriodS,
		rock.spinPhase,
	].join("|");

/** Every rock's fingerprint line in one system, fields in slot order. */
export function fieldFingerprintRows(
	record: SystemRecord,
	contents: SystemContents,
): string[] {
	const rows: string[] = [];
	for (const plan of systemFields(record, contents))
		for (const rock of fieldRocks(record, plan))
			rows.push(fieldFingerprintRow(record.index, plan, rock));
	return rows;
}

/**
 * The per-galaxy field fingerprint (#948 D6): every rock's identity, size and
 * shape and full placement/motion inputs, hashed. It is brittle on purpose — a
 * change to those generated inputs turns its pin red, and a change that moves,
 * resizes or re-slots an existing rock owes a
 * `FIELD_GENERATOR_VERSION` bump and #951's deposit migration.
 */
export function fieldBaselineFingerprint(
	worldSeed: number,
	galaxyIndex: number,
): number {
	const rows: string[] = [];
	for (const record of generateGalaxy(worldSeed, galaxyIndex).systems)
		rows.push(...fieldFingerprintRows(record, generateContents(record)));
	return fnv1a(rows.join("\n"));
}
