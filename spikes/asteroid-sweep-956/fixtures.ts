/**
 * Node #956: what the rows and the bench share — the miner's two primitives
 * in unit space, the sweep's constants scaled to a rock, the ruled field
 * (#949 D1) per archetype, two synthetic fields, and the naive arm the rows
 * name as the failure.
 */
import { type Pose, shipPose } from "../../src/collision";
import { HULL_SPECS } from "../../src/hull";
import { add, cross, dot, length, scale, sub, v3, type Vec3 } from "../../src/vec3";
import { CUTTER } from "../asteroid-collision-949/drill";
import { type Heightfield, outermostExits, radiusAt, texel } from "../asteroid-collision-949/heightfield";
import { loadArchetypes, MEASURED_ROCKS_SHA256 } from "../asteroid-collision-949/proxy-fit";
import { type BoxPrim, type ShipStep, type SweepConfig } from "./rock-sweep";

export const DT = 0.1; // MAX_DT, s
const SEPARATION_KM = 1e-4;
const AXES = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)] as const;

const env = HULL_SPECS.miner.env;
const c = HULL_SPECS.miner.envCentre;
/** Hull box (P1) and the deployed cutter (#949 D3), ship frame, km. */
export const HULL_KM: BoxPrim = { kind: "box", centre: v3(c.rightKm, c.upKm, c.foreKm), axes: AXES, half: [env.beamKm / 2, env.heightKm / 2, env.lengthKm / 2] };
/** The cutter at full feed: rotor x ±5.5 m, y −8.91…+2.09 m, from the bow plane to bow + feed travel. */
export const CUTTER_KM: BoxPrim = {
	kind: "box",
	centre: v3(0, -CUTTER.downKm, CUTTER.bowKm + CUTTER.feedTravelKm / 2),
	axes: AXES,
	half: [CUTTER.radiusKm, CUTTER.radiusKm, CUTTER.feedTravelKm / 2],
};
const scaleBox = (b: BoxPrim, R: number): BoxPrim => ({ ...b, centre: scale(b.centre, 1 / R), half: [b.half[0] / R, b.half[1] / R, b.half[2] / R] });
export const shipPrims = (R: number, cutter: boolean): BoxPrim[] => (cutter ? [scaleBox(HULL_KM, R), scaleBox(CUTTER_KM, R)] : [scaleBox(HULL_KM, R)]);

/** collision.ts's constants, in a rock's unit space. Rock spin ≥ 4 min (#948 D5): chord error at reach 2. */
export function sweepConfig(R: number, ghost: "rock" | "piece" = "rock"): SweepConfig {
	const theta = (2 * Math.PI * DT) / 240;
	return { dt: DT, contact: (0.5 * SEPARATION_KM) / R, target: (0.25 * SEPARATION_KM) / R, restingGap: (1.5 * SEPARATION_KM) / R, ghost, maxAdvances: 64, arcSagitta: 2 * (1 - Math.cos(theta / 2)) };
}

/** A straight step: origin from `a` to `b` (unit space), fixed attitude. */
export function step(prims: BoxPrim[], a: Vec3, b: Vec3, nose: Vec3, up: Vec3): ShipStep {
	const p = shipPose(a, nose, up);
	const q: Pose = { ...p, origin: b };
	return { prims, start: p, end: q };
}
/** An up vector square to `nose`. */
export function upFor(nose: Vec3): Vec3 {
	const side = Math.abs(nose.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
	const u = sub(side, scale(nose, dot(side, nose)));
	return scale(u, 1 / length(u));
}
export { add, cross, sub, scale, v3, length, dot };

/** Every archetype's ruled field: 64 texels, outermost exits over every drawn level (#949 D1). */
export async function ruledFields(): Promise<{ sha: string; names: string[]; fields: Heightfield[] }> {
	const arch = await loadArchetypes();
	const fields = arch.map((a) => {
		const all = new Float32Array(a.levels.reduce((n, l) => n + l.length, 0));
		let off = 0;
		for (const l of a.levels) { all.set(l, off); off += l.length; }
		return { res: 64, r: outermostExits(all, 64) };
	});
	return { sha: MEASURED_ROCKS_SHA256, names: arch.map((a) => a.name), fields };
}
/** The same at a coarser resolution, for the cost arm. */
export async function coarseFields(res: number): Promise<Heightfield[]> {
	const arch = await loadArchetypes();
	return arch.map((a) => {
		const all = new Float32Array(a.levels.reduce((n, l) => n + l.length, 0));
		let off = 0;
		for (const l of a.levels) { all.set(l, off); off += l.length; }
		return { res, r: outermostExits(all, res) };
	});
}

/** Synthetic: radius `base` everywhere, and on face +z one column of texels at `top` — a ridge one texel wide. */
export function ridgeField(res: number, base: number, top: number): Heightfield {
	const r = new Float32Array(6 * res * res).fill(base);
	for (let j = 0; j < res; j++) r[texel(res, 4, res / 2, j)] = top;
	return { res, r };
}
/** Synthetic: one texel on face +z at `top` — a needle. */
export function needleField(res: number, base: number, top: number, i = res / 2, j = res / 2): Heightfield {
	const r = new Float32Array(6 * res * res).fill(base);
	r[texel(res, 4, i, j)] = top;
	return { res, r };
}

/**
 * The naive arm the node names as the failure: the hull box sampled on a
 * 5×3×9 face lattice (#949 `bench.ts`), and conservative advancement on the
 * radial gap |p| − r(p̂) as if it were a distance. `radius` is the surface it reads
 * (the pieces' envelope in the rows, so both arms meet one solid). Returns the fraction met, or null.
 */
export function naiveRadialSweep(radius: (d: [number, number, number]) => number, s: ShipStep, contact: number): { s: number | null; advances: number } {
	const box = s.prims[0];
	const samples: Vec3[] = [];
	for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) for (let k = -4; k <= 4; k++)
		if (Math.abs(i) === 2 || Math.abs(j) === 1 || Math.abs(k) === 4)
			samples.push(add(box.centre, v3((i / 2) * box.half[0], j * box.half[1], (k / 4) * box.half[2])));
	const speed = length(sub(s.end.origin, s.start.origin));
	let f = 0;
	for (let n = 0; n < 64; n++) {
		const o = add(s.start.origin, scale(sub(s.end.origin, s.start.origin), f));
		let g = Infinity;
		for (const q of samples) {
			const p = add(o, add(add(scale(s.start.x, q.x), scale(s.start.y, q.y)), scale(s.start.z, q.z)));
			const l = length(p);
			g = Math.min(g, l - radius([p.x / l, p.y / l, p.z / l]));
		}
		if (g <= contact) return { s: f, advances: n + 1 };
		f += g / speed;
		if (f > 1) return { s: null, advances: n + 1 };
	}
	return { s: f, advances: 64 };
}
