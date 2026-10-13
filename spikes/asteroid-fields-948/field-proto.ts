/**
 * Throwaway prototype for node #948: asteroid field placement, rock layout and
 * spin, on new DOMAIN tags appended after 37. Not production code.
 */
const R = new URL("../../src", import.meta.url).pathname;
const { stream } = await import(`${R}/galaxy.ts`);
const { mix } = await import(`${R}/rng.ts`);
const sys = await import(`${R}/system.ts`);
type SystemRecord = import("../../src/galaxy").SystemRecord;
type SystemContents = import("../../src/system").SystemContents;
type Orbit = import("../../src/system").Orbit;
type Vec3 = { x: number; y: number; z: number };

const TAU = Math.PI * 2;
const AU_KM = 149_597_870.7;

/** Proposed tags, appended. */
export const PROTO_DOMAIN = {
	ASTEROID_FIELD_ROLL: 38, // rare field: present or not, one draw per system
	ASTEROID_FIELD: 39, // placement, split by field slot
	ASTEROID_ROCKS: 40, // rock layout, split by field slot then rock slot
	ASTEROID_DEPOSIT: 41, // hidden contents, split like rocks (reserved; #951)
} as const;

export const FIELD_SLOT = { charted: 0, rare: 1 } as const;
export const fieldId = (slot: number) => `field-${String(slot).padStart(2, "0")}`;

// --- tunables (all proposals) ----------------------------------------------
export const CHARTED_LEAD_KM = [150, 300] as const; // along refinery orbit, either side
export const CHARTED_OFFPLANE_KM = 30; // ± uniform
export const RARE_FIELD_CHANCE = 0.2;
export const RARE_BELT_MIN_PHASE = Math.PI / 6; // from the refinery, either way
export const OUTER_ORBIT_FACTOR = [1.3, 1.8] as const; // × outermost planet aAu
export const TROJAN_RAD = Math.PI / 3;

export interface FieldProfile {
	/** Ellipsoid semi-axes km: along-orbit, radial, normal. */
	semiKm: readonly [number, number, number];
	cellKm: number;
	occupancy: number;
	rockRadiusKm: readonly [number, number];
	/** Power-law exponent for radius, p(r) ∝ r^-alpha. */
	alpha: number;
	marginKm: number;
}
export const PROFILE: Record<"charted" | "rare", FieldProfile> = {
	charted: { semiKm: [24, 12, 6], cellKm: 2.4, occupancy: 0.35, rockRadiusKm: [0.025, 0.4], alpha: 2.4, marginKm: 0.2 },
	rare: { semiKm: [16, 10, 6], cellKm: 2.6, occupancy: 0.4, rockRadiusKm: [0.04, 0.6], alpha: 2.0, marginKm: 0.2 },
};
export const SPIN_PERIOD_S = [4 * 60, 40 * 60] as const; // log-uniform
export const SPIN_SURFACE_CAP_KMS = 0.006; // equatorial speed ≤ 6 m/s
/** Drift: each rock circles a seeded anchor inside its own cell, closed form in t. */
export const DRIFT_PERIOD_S = [3600, 6 * 3600] as const; // log-uniform
export const DRIFT_FRACTION = [0.2, 0.6] as const; // of the cell's free play
export const DRIFT_CAP_KMS = 0.002; // ≤ 2 m/s

// --- placement ----------------------------------------------------------------
export type PlacementKind = "refinery-orbit" | "belt" | "trojan" | "outer-orbit" | "outer-trojan";
export interface FieldPlan {
	id: string;
	slot: number;
	profile: "charted" | "rare";
	kind: PlacementKind;
	/** Star-centric orbit the field centre rides. */
	orbit: Orbit;
	offPlaneKm: number;
	/** Field frame orientation: unit quaternion, inertial, drawn. */
	q: [number, number, number, number];
	hostId: string | null;
}

const uni = (r: () => number, a: number, b: number) => a + (b - a) * r();
const fieldStream = (seed: number, slot: number) => stream(mix(seed, slot), PROTO_DOMAIN.ASTEROID_FIELD);

function drawQuat(r: () => number): [number, number, number, number] {
	// Shoemake uniform rotation.
	const u1 = r(), u2 = r(), u3 = r();
	const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
	return [a * Math.sin(TAU * u2), a * Math.cos(TAU * u2), b * Math.sin(TAU * u3), b * Math.cos(TAU * u3)];
}

export function chartedField(record: SystemRecord, c: SystemContents): FieldPlan | null {
	const ref = c.stations.find((s) => s.type === "refinery");
	if (!ref) return null;
	const r = fieldStream(record.seed, FIELD_SLOT.charted);
	const lead = (r() < 0.5 ? -1 : 1) * uni(r, CHARTED_LEAD_KM[0], CHARTED_LEAD_KM[1]);
	const offPlaneKm = uni(r, -CHARTED_OFFPLANE_KM, CHARTED_OFFPLANE_KM);
	const q = drawQuat(r);
	return {
		id: fieldId(FIELD_SLOT.charted), slot: FIELD_SLOT.charted, profile: "charted", kind: "refinery-orbit",
		orbit: { ...ref.orbit, theta0: ref.orbit.theta0 + lead / ref.orbit.radiusKm }, offPlaneKm, q, hostId: ref.id,
	};
}

export function rareFieldPresent(record: SystemRecord): boolean {
	return stream(record.seed, PROTO_DOMAIN.ASTEROID_FIELD_ROLL)() < RARE_FIELD_CHANCE;
}

export function rareField(record: SystemRecord, c: SystemContents): FieldPlan | null {
	if (!rareFieldPresent(record)) return null;
	const r = fieldStream(record.seed, FIELD_SLOT.rare);
	// Fixed draw budget, consumed whatever branch is taken.
	const d = Array.from({ length: 8 }, () => r());
	const q = drawQuat(r);
	const base = { id: fieldId(FIELD_SLOT.rare), slot: FIELD_SLOT.rare, profile: "rare" as const, q };
	const offPlaneKm = (d[5] * 2 - 1) * 2000;
	const incl = uni(() => d[6], 0, (3 * Math.PI) / 180);
	const star = c.star.massSolar;
	const outpost = c.stations.find((s) => s.type === "outpost");
	if (c.belt) {
		const ref = c.stations.find((s) => s.type === "refinery")!;
		// The refinery's own orbit, so the phase gap never closes.
		const phase = ref.orbit.theta0 + RARE_BELT_MIN_PHASE + d[1] * (TAU - 2 * RARE_BELT_MIN_PHASE);
		return { ...base, kind: "belt", hostId: null, offPlaneKm, orbit: { ...ref.orbit, theta0: phase } };
	}
	const giants = c.planets.filter((p) => p.isGasGiant);
	const trojanOf = (host: (typeof c.planets)[number], kind: PlacementKind) => {
		let side = d[3] < 0.5 ? -1 : 1;
		const occupied = (s: number) => outpost && outpost.orbit.radiusKm === host.orbit.radiusKm &&
			Math.abs(outpost.orbit.theta0 - (host.orbit.theta0 + s * TROJAN_RAD)) < 1e-9;
		if (occupied(side)) side = -side;
		return { ...base, kind, hostId: host.id, offPlaneKm,
			orbit: { ...host.orbit, theta0: host.orbit.theta0 + side * TROJAN_RAD } };
	};
	if (giants.length > 0) return trojanOf(giants[Math.floor(d[2] * giants.length)], "trojan");
	const outer = c.planets.reduce((a, b) => (b.aAu > a.aAu ? b : a));
	const want = outer.aAu * uni(() => d[4], OUTER_ORBIT_FACTOR[0], OUTER_ORBIT_FACTOR[1]);
	if (want <= sys.MAX_ORBIT_AU) {
		return { ...base, kind: "outer-orbit", hostId: null, offPlaneKm,
			orbit: { radiusKm: want * AU_KM, periodS: sys.orbitalPeriodS(want, star), theta0: d[1] * TAU, inclination: incl, node: d[7] * TAU } };
	}
	return trojanOf(outer, "outer-trojan");
}

// --- rocks ----------------------------------------------------------------
export interface Rock {
	slot: number;
	/** Field-frame km. */
	local: Vec3;
	radiusKm: number;
	shapeSeed: number;
	axis: Vec3;
	periodS: number;
	phase0: number;
	/** Drift circle: anchor (field frame), radius, basis, period, phase. */
	anchor: Vec3;
	driftKm: number;
	e1: Vec3;
	e2: Vec3;
	driftPeriodS: number;
	driftPhase: number;
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const sphere = (ca: number, ph: number): Vec3 => { const s = Math.sqrt(1 - ca * ca); return { x: s * Math.cos(ph), y: s * Math.sin(ph), z: ca }; };

/** Field-frame position at t: anchor + drift circle. */
export function rockLocal(r: Rock, t: number): Vec3 {
	const w = (TAU * t) / r.driftPeriodS + r.driftPhase;
	const c = Math.cos(w) * r.driftKm, s = Math.sin(w) * r.driftKm;
	return { x: r.anchor.x + c * r.e1.x + s * r.e2.x, y: r.anchor.y + c * r.e1.y + s * r.e2.y, z: r.anchor.z + c * r.e1.z + s * r.e2.z };
}
/** Field-frame velocity, km/s: the exact derivative. */
export function rockLocalVel(r: Rock, t: number): Vec3 {
	const om = TAU / r.driftPeriodS, w = om * t + r.driftPhase;
	const c = -Math.sin(w) * r.driftKm * om, s = Math.cos(w) * r.driftKm * om;
	return { x: c * r.e1.x + s * r.e2.x, y: c * r.e1.y + s * r.e2.y, z: c * r.e1.z + s * r.e2.z };
}

/** Lattice cells inside the ellipsoid, in a fixed order: the slot is the cell. */
export function cells(p: FieldProfile): Vec3[] {
	const [a, b, cz] = p.semiKm;
	const out: Vec3[] = [];
	const n = (s: number) => Math.ceil(s / p.cellKm);
	for (let i = -n(a); i <= n(a); i++)
		for (let j = -n(b); j <= n(b); j++)
			for (let k = -n(cz); k <= n(cz); k++) {
				const x = i * p.cellKm, y = j * p.cellKm, z = k * p.cellKm;
				if ((x / a) ** 2 + (y / b) ** 2 + (z / cz) ** 2 <= 1) out.push({ x, y, z });
			}
	return out;
}

export function rocks(record: SystemRecord, plan: FieldPlan): Rock[] {
	const p = PROFILE[plan.profile];
	const out: Rock[] = [];
	const cl = cells(p);
	const [r0, r1] = p.rockRadiusKm;
	for (let slot = 0; slot < cl.length; slot++) {
		const r = stream(mix(mix(record.seed, plan.slot), slot), PROTO_DOMAIN.ASTEROID_ROCKS);
		// Fixed draw order per slot: occupancy, radius, jitter×3, shape, axis×2, period, phase.
		const occ = r();
		const u = r();
		const jx = r(), jy = r(), jz = r();
		const shapeSeed = Math.floor(r() * 0x100000000);
		const ca = 2 * r() - 1, ph = TAU * r();
		const pu = r(), phase0 = TAU * r();
		// Drift draws, appended to the slot's fixed order.
		const df = r(), dca = 2 * r() - 1, dph = TAU * r(), dpu = r(), dphase = TAU * r();
		if (occ >= p.occupancy) continue;
		// Inverse CDF of truncated power law.
		const k = 1 - p.alpha;
		const radiusKm = (r0 ** k + u * (r1 ** k - r0 ** k)) ** (1 / k);
		const play = Math.max(0, p.cellKm / 2 - radiusKm - p.marginKm / 2);
		const c = cl[slot];
		const s = Math.sqrt(1 - ca * ca);
		const minP = (TAU * radiusKm) / SPIN_SURFACE_CAP_KMS;
		const periodS = Math.max(minP, Math.exp(Math.log(SPIN_PERIOD_S[0]) + pu * Math.log(SPIN_PERIOD_S[1] / SPIN_PERIOD_S[0])));
		// |offset| + drift ≤ play: the rock never leaves its cell's inner cube.
		const driftKm = play * (DRIFT_FRACTION[0] + df * (DRIFT_FRACTION[1] - DRIFT_FRACTION[0]));
		const ball = play - driftKm;
		const dir = sphere(2 * jx - 1, TAU * jy);
		const rad = ball * Math.cbrt(jz);
		const anchor = { x: c.x + dir.x * rad, y: c.y + dir.y * rad, z: c.z + dir.z * rad };
		const n = sphere(dca, dph);
		const e1 = unit(cross(n, Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
		const e2 = cross(n, e1);
		const minDP = driftKm > 0 ? (TAU * driftKm) / DRIFT_CAP_KMS : 0;
		const driftPeriodS = Math.max(minDP, Math.exp(Math.log(DRIFT_PERIOD_S[0]) + dpu * Math.log(DRIFT_PERIOD_S[1] / DRIFT_PERIOD_S[0])));
		out.push({
			slot, radiusKm, shapeSeed, periodS, phase0,
			local: anchor, anchor, driftKm, e1, e2, driftPeriodS, driftPhase: dphase,
			axis: { x: s * Math.cos(ph), y: s * Math.sin(ph), z: ca },
		});
	}
	return out;
}

export function fieldCentre(plan: FieldPlan, c: SystemContents, t: number): Vec3 {
	const p = sys.positionOnOrbit(plan.orbit, t);
	const n = sys.orbitNormal(plan.orbit);
	return { x: p.x + n.x * plan.offPlaneKm, y: p.y + n.y * plan.offPlaneKm, z: p.z + n.z * plan.offPlaneKm };
}
