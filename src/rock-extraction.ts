/**
 * https://github.com/jcfischer/seelite/issues/920
 * Prototype for node #920: a Mining Laser's cut releases whole-tonne fragments that
 * drift, expire or are scooped (#872 D3, D4; #917 D8; #1095 D4–D6). A fragment's
 * tonne leaves the deposit when it is released, so a lost fragment restores nothing.
 * Every figure here is a provisional candidate for #922's economic measurement.
 */
import { type DepositRow, debitAt } from "./deposit-state";
import { type Grade, gradeOutputScale } from "./module-catalog";
import type { OreFamily, OreGrade } from "./rock-survey";
import {
	add,
	cross,
	dot,
	lengthSq,
	normalizeOr,
	scale,
	sub,
	type Vec3,
	v3,
} from "./vec3";

/** Candidate extraction and scoop figures. The scoop window and charge are #1095 D5 and D6. */
export const EXTRACTION = {
	ejectKms: 0.01,
	ejectSpread: 0.6,
	lifetimeS: 120,
	wasteLifetimeS: 20,
	driftKms: 0.03,
	driftPullKmsPerS: 0.004,
	driftRangeKm: 3,
	oreShareE: 0.5,
	scoopRadiusKm: 0.05,
	scoopSpeedKms: 0.25,
	scoopChargeE: 2,
} as const;

/** The share of removed rock that comes away as ore: grade E 0.5, D 0.4, A 0.75 (O6 of #927's review). */
export const oreShare = (grade: Grade): number =>
	Math.min(0.9, EXTRACTION.oreShareE * gradeOutputScale(grade));

/** The fired Mining Lasers' summed rate, and the grade among them with the best ore share; E when none fired. */
export function firedExtraction(
	lasers: readonly { grade: Grade; extractionTPerS: number }[],
): { rate: number; grade: Grade } {
	let rate = 0;
	let grade: Grade | null = null;
	for (const l of lasers) {
		rate += l.extractionTPerS;
		if (grade === null || oreShare(l.grade) > oreShare(grade)) grade = l.grade;
	}
	return { rate, grade: grade ?? "E" };
}

/**
 * The hardpoint `?mining=1` fits a Mining Laser on: `fitted` when one is
 * fitted already, else the first free hardpoint. With every hardpoint taken it
 * replaces the first only when `replace` (a boot that writes nothing), so a
 * saved weapon is never lost; otherwise `null`.
 */
export function prototypeMiningLaserSlot<K extends string>(
	hardpoints: readonly { key: K }[],
	loadout: Readonly<Partial<Record<K, { module: string }>>>,
	replace: boolean,
): K | "fitted" | null {
	if (
		Object.values(loadout).some(
			(m) => (m as { module: string } | undefined)?.module === "mining-laser",
		)
	)
		return "fitted";
	const free = hardpoints.find((s) => !loadout[s.key])?.key;
	return free ?? (replace ? (hardpoints[0]?.key ?? null) : null);
}

/** Sub-tonne progress of the cut on one rock. Whole tonnes leave as fragments. */
export interface Cut {
	key: string | null;
	oreT: number;
	wasteT: number;
}
export const beginCut = (): Cut => ({ key: null, oreT: 0, wasteT: 0 });

export interface CutStep {
	cut: Cut;
	ore: number;
	waste: number;
	depleted: boolean;
}

/**
 * One frame of cutting. `key` is the rock the beam hits, or `null` when it hits none;
 * progress on a rock is kept while the beam is off and dropped when it moves to
 * another rock. Ore fragments never exceed the reserve left.
 */
export function stepCut(
	cut: Cut,
	key: string | null,
	rateTPerS: number,
	share: number,
	dt: number,
	reserveLeftT: number,
): CutStep {
	if (key === null || rateTPerS <= 0)
		return { cut, ore: 0, waste: 0, depleted: false };
	const base = cut.key === key ? cut : { key, oreT: 0, wasteT: 0 };
	const removed = rateTPerS * dt;
	const depleted = reserveLeftT <= 0;
	let oreT = base.oreT + (depleted ? 0 : removed * share);
	let wasteT = base.wasteT + removed * (depleted ? 1 : 1 - share);
	let ore = Math.floor(oreT);
	if (ore > reserveLeftT) {
		ore = Math.max(0, Math.floor(reserveLeftT));
		oreT = ore;
	}
	oreT -= ore;
	const waste = Math.floor(wasteT);
	wasteT -= waste;
	return { cut: { key, oreT, wasteT }, ore, waste, depleted };
}

/** A deposit row with `n` more surface tonnes taken at `t`, both debits rebased to `t`. */
export function debitSurface(
	row: DepositRow | undefined,
	t: number,
	n: number,
): DepositRow {
	const at = row?.at ?? 0;
	const surface = debitAt(row?.surface ?? 0, at, t) + n;
	const deep = row?.deep === undefined ? undefined : debitAt(row.deep, at, t);
	return {
		...row,
		surface,
		...(deep !== undefined && { deep }),
		at: t,
	};
}

/** A rock's drawn surface: its frame's turn, and its radius along a unit direction as a share of `radiusKm`. */
export interface RockShape {
	toLocal(v: Vec3): Vec3;
	toWorld(v: Vec3): Vec3;
	radiusAt(unitDir: Vec3): number;
}
export interface BeamTarget {
	id: string;
	pos: Vec3;
	vel: Vec3;
	radiusKm: number;
	shape?: RockShape;
}

/** Samples along the beam's chord through the bounding sphere before the bisection. */
export const SURFACE_STEPS = 128;

function surfaceHit(
	origin: Vec3,
	dir: Vec3,
	r: BeamTarget & { shape: RockShape },
	t0: number,
	t1: number,
): { along: number; normal: Vec3 } | null {
	const o = scale(r.shape.toLocal(sub(origin, r.pos)), 1 / r.radiusKm);
	const d = scale(r.shape.toLocal(dir), 1 / r.radiusKm);
	const gapAt = (p: Vec3) => {
		const l = Math.hypot(p.x, p.y, p.z);
		return l < 1e-9 ? -1 : l - r.shape.radiusAt(scale(p, 1 / l));
	};
	const gap = (t: number) => gapAt(add(o, scale(d, t)));
	let a = t0;
	for (let k = 1; k <= SURFACE_STEPS; k++) {
		const b = t0 + ((t1 - t0) * k) / SURFACE_STEPS;
		if (gap(b) > 0) {
			a = b;
			continue;
		}
		let lo = a,
			hi = b;
		for (let i = 0; i < 30; i++) {
			const mid = (lo + hi) / 2;
			if (gap(mid) > 0) lo = mid;
			else hi = mid;
		}
		const p = add(o, scale(d, hi));
		const e = 1e-3;
		const grad = v3(
			gapAt(add(p, v3(e, 0, 0))) - gapAt(add(p, v3(-e, 0, 0))),
			gapAt(add(p, v3(0, e, 0))) - gapAt(add(p, v3(0, -e, 0))),
			gapAt(add(p, v3(0, 0, e))) - gapAt(add(p, v3(0, 0, -e))),
		);
		return {
			along: hi,
			normal: normalizeOr(r.shape.toWorld(grad), scale(dir, -1)),
		};
	}
	return null;
}
export interface BeamHit {
	id: string;
	point: Vec3;
	normal: Vec3;
	distKm: number;
}

/** The nearest rock surface the beam meets within `rangeKm`, or `null`. `dir` is a unit vector. */
export function beamHit(
	origin: Vec3,
	dir: Vec3,
	rocks: readonly BeamTarget[],
	rangeKm: number,
): BeamHit | null {
	let best: BeamHit | null = null;
	for (const r of rocks) {
		const oc = sub(origin, r.pos);
		const b = dot(oc, dir);
		const c = lengthSq(oc) - r.radiusKm * r.radiusKm;
		const disc = b * b - c;
		if (disc < 0) continue;
		if (r.shape) {
			const t0 = Math.max(0, -b - Math.sqrt(disc));
			const t1 = Math.min(rangeKm, -b + Math.sqrt(disc));
			if (t1 <= t0 || (best && t0 >= best.distKm)) continue;
			const met = surfaceHit(origin, dir, { ...r, shape: r.shape }, t0, t1);
			if (!met || (best && met.along >= best.distKm)) continue;
			best = {
				id: r.id,
				point: add(origin, scale(dir, met.along)),
				normal: met.normal,
				distKm: met.along,
			};
			continue;
		}
		const along = -b - Math.sqrt(disc);
		if (along < 0 || along > rangeKm) continue;
		if (best && along >= best.distKm) continue;
		const point = add(origin, scale(dir, along));
		best = {
			id: r.id,
			point,
			normal: normalizeOr(sub(point, r.pos), scale(dir, -1)),
			distKm: along,
		};
	}
	return best;
}

/**
 * A fragment rides with the rock it came from: its place is the rock's place now,
 * plus where it left the surface, plus its eject velocity times its age. So the
 * rock's orbit and the ship's frame cannot carry the two apart.
 */
export interface Fragment {
	id: string;
	rockId: string;
	ore: { family: OreFamily; grade: OreGrade } | null;
	offset: Vec3;
	ejectVel: Vec3;
	bornAt: number;
	expiresAt: number;
}

export interface Anchor {
	pos: Vec3;
	vel: Vec3;
}

/** Where a fragment is at `now`, given its rock's pose at `now`. */
export const fragmentAt = (f: Fragment, rock: Anchor, now: number): Anchor => ({
	pos: add(rock.pos, add(f.offset, scale(f.ejectVel, now - f.bornAt))),
	vel: add(rock.vel, f.ejectVel),
});

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** A fragment leaving the hit point along the surface normal, fanned by `index` so a burst spreads. */
export function releaseFragment(
	id: string,
	index: number,
	ore: Fragment["ore"],
	hit: BeamHit,
	rockPos: Vec3,
	now: number,
): Fragment {
	const n = hit.normal;
	const u = normalizeOr(
		cross(n, Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)),
		v3(1, 0, 0),
	);
	const w = cross(n, u);
	const a = index * GOLDEN;
	const tilt = EXTRACTION.ejectSpread;
	const out = normalizeOr(
		add(n, add(scale(u, Math.cos(a) * tilt), scale(w, Math.sin(a) * tilt))),
		n,
	);
	return {
		id,
		rockId: hit.id,
		ore,
		offset: sub(hit.point, rockPos),
		ejectVel: scale(out, EXTRACTION.ejectKms),
		bornAt: now,
		expiresAt: now + (ore ? EXTRACTION.lifetimeS : EXTRACTION.wasteLifetimeS),
	};
}

/** What the caller's hold and bank say about one scoop attempt. */
export type ScoopVerdict = "taken" | "hold-full" | "low-energy";

export interface FragmentStep {
	kept: Fragment[];
	taken: Fragment[];
	refused: { fragment: Fragment; verdict: Exclude<ScoopVerdict, "taken"> }[];
	lost: Fragment[];
}

/** Whether the ship is inside a fragment's scoop window: close, and slow relative to it. */
export const inScoopWindow = (f: Anchor, ship: Anchor): boolean =>
	lengthSq(sub(f.pos, ship.pos)) <=
		EXTRACTION.scoopRadiusKm * EXTRACTION.scoopRadiusKm &&
	lengthSq(sub(f.vel, ship.vel)) <=
		EXTRACTION.scoopSpeedKms * EXTRACTION.scoopSpeedKms;

/**
 * One frame of fragments at `now`, with the ship where it is at `now`: expired ones
 * are lost, and ore fragments in the window are offered to `accept`, which pays the
 * charge and fills the hold. `rockOf` is `null` for a rock too far to resolve; such
 * a fragment only ages. Waste is never scooped.
 */
export function stepFragments(
	fragments: readonly Fragment[],
	ship: Anchor,
	now: number,
	rockOf: (f: Fragment) => Anchor | null,
	accept: (f: Fragment) => ScoopVerdict,
): FragmentStep {
	const out: FragmentStep = { kept: [], taken: [], refused: [], lost: [] };
	for (const f of fragments) {
		if (now >= f.expiresAt) {
			if (f.ore) out.lost.push(f);
			continue;
		}
		const rock = f.ore ? rockOf(f) : null;
		if (rock && inScoopWindow(fragmentAt(f, rock, now), ship)) {
			const verdict = accept(f);
			if (verdict === "taken") {
				out.taken.push(f);
				continue;
			}
			out.refused.push({ fragment: f, verdict });
		}
		out.kept.push(f);
	}
	return out;
}

/**
 * Ore fragments near the ship are pulled toward it (the principal, 2026-10-27):
 * the fragment's velocity relative to the ship turns toward `driftKms` along the
 * line to the ship, changing by at most `driftPullKmsPerS` a second. The offset
 * moves with the velocity change, so the fragment does not jump. Waste is not pulled.
 */
export function pullFragment(
	f: Fragment,
	rock: Anchor,
	ship: Anchor,
	now: number,
	dt: number,
): Fragment {
	if (!f.ore) return f;
	const at = fragmentAt(f, rock, now);
	const to = sub(ship.pos, at.pos);
	if (lengthSq(to) > EXTRACTION.driftRangeKm * EXTRACTION.driftRangeKm)
		return f;
	const want = add(
		sub(ship.vel, rock.vel),
		scale(normalizeOr(to, v3()), EXTRACTION.driftKms),
	);
	const dv = sub(want, f.ejectVel);
	const most = EXTRACTION.driftPullKmsPerS * dt;
	const step =
		lengthSq(dv) <= most * most ? dv : scale(normalizeOr(dv, v3()), most);
	return {
		...f,
		ejectVel: add(f.ejectVel, step),
		offset: sub(f.offset, scale(step, now - f.bornAt)),
	};
}
