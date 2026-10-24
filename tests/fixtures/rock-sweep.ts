import { readFileSync } from "node:fs";
import {
	IDENTITY_AXES,
	SEPARATION_KM,
	shipPose,
	shipPrimitives,
	type RockSolid,
	type SolidMotion,
	type SweepDiagnostics,
	sweepShip,
} from "../../src/collision";
import { HULL_SPECS } from "../../src/hull";
import {
	decodeRockHeightfields,
	type RockHeightfield,
} from "../../src/rock-heightfields";
import { buildRockPieces, type RockPieces } from "../../src/rock-pieces";
import {
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
	type Vec3,
} from "../../src/vec3";
import {
	buildPieces,
	type RockPieces as SpikePieces,
} from "./rock-sweep-956/pieces";
import {
	type BoxPrim,
	type ShipStep,
	type SweepConfig,
	firstOverlap,
} from "./rock-sweep-956/rock-sweep";

export const DT = 0.1;
export const unit = (v: Vec3) => scale(v, 1 / length(v));
export function upFor(n: Vec3): Vec3 {
	const side = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
	return unit(sub(side, scale(n, dot(side, n))));
}
export function prims(R: number, cutter = true): BoxPrim[] {
	return shipPrimitives(HULL_SPECS.miner, cutter).map((p) => {
		if (p.kind !== "box") throw new Error("box expected");
		return {
			...p,
			centre: scale(p.centre, 1 / R),
			half: p.half.map((x) => x / R) as [number, number, number],
		};
	});
}
export const step = (
	R: number,
	a: Vec3,
	b: Vec3,
	nose: Vec3,
	up: Vec3,
	cutter = true,
): ShipStep => ({
	prims: prims(R, cutter),
	start: shipPose(a, nose, up),
	end: shipPose(b, nose, up),
});
export const config = (R: number): SweepConfig => ({
	dt: DT,
	contact: (SEPARATION_KM * 0.5) / R,
	target: (SEPARATION_KM * 0.25) / R,
	restingGap: (SEPARATION_KM * 1.5) / R,
	ghost: "piece",
	maxAdvances: 64,
	arcSagitta: 0,
});
export function motion(s: ShipStep, R: number): SolidMotion {
	const velocity = scale(sub(s.end.origin, s.start.origin), R / DT);
	return {
		primitives: s.prims.map((p) => ({
			...p,
			centre: scale(p.centre, R),
			half: p.half.map((x) => x * R) as [number, number, number],
		})),
		start: { ...s.start, origin: scale(s.start.origin, R) },
		end: { ...s.end, origin: scale(s.end.origin, R) },
		velStart: velocity,
		velEnd: velocity,
	};
}
export function solid(pieces: RockPieces, radiusKm: number): RockSolid {
	return {
		kind: "rock",
		pieces,
		radiusKm,
		start: { ...IDENTITY_AXES, origin: v3() },
		end: { ...IDENTITY_AXES, origin: v3() },
		velStart: v3(),
		velEnd: v3(),
	};
}
export function sweep(s: ShipStep, rp: RockPieces, R: number) {
	const diagnostics: SweepDiagnostics = {
		advances: 0,
		maxPairAdvances: 0,
		cappedPairs: 0,
	};
	const result = sweepShip(motion(s, R), [solid(rp, R)], DT, { diagnostics });
	return { result, diagnostics, hit: result.impacts[0] };
}
export const spikePieces = (rp: RockPieces): SpikePieces => {
	const hull = (h: RockPieces["pieces"][number]) => ({
		kind: "hull" as const,
		...h,
	});
	const node = (
		n: RockPieces["roots"][number],
	): SpikePieces["roots"][number] => ({
		...n,
		hull: hull(n.hull),
		children: n.children.map(node),
	});
	return {
		res: rp.res,
		inflate: Float32Array.from(rp.inflate),
		pieces: rp.pieces.map(hull),
		roots: rp.roots.map(node),
	};
};
export function synthetic(needle: boolean): RockPieces {
	const res = 64,
		r = new Float32Array(6 * res * res).fill(0.5);
	for (let j = 0; j < res; j++)
		if (!needle || j === 32) r[(4 * res + j) * res + 32] = 0.9;
	const rp = buildPieces({ res, r });
	return { ...rp, inflate: Float64Array.from(rp.inflate), planes: [] };
}
export function archetypes(): {
	fields: RockHeightfield[];
	rocks: RockPieces[];
} {
	const { fields } = decodeRockHeightfields(
		readFileSync("src/models/rock-heightfields.bin"),
	);
	return { fields, rocks: fields.map((h) => buildRockPieces(h)) };
}
export function clearLift(
	s: (h: number) => ShipStep,
	rp: SpikePieces,
	samples: number,
	iterations = 24,
): number {
	let lo = 0,
		hi = 1.6;
	for (let i = 0; i < iterations; i++) {
		const mid = (lo + hi) / 2;
		if (firstOverlap(s(mid), rp, samples) === null) hi = mid;
		else lo = mid;
	}
	return hi;
}
export const dirFor = (k: number) =>
	unit(v3(Math.sin(k * 2.1), Math.cos(k * 1.7), Math.sin(k * 0.9 + 0.3)));
export function tangentPath(R: number, k: number, kms: number, cutter = false) {
	const d = dirFor(k),
		t = unit(cross(d, upFor(d))),
		travel = (kms * DT) / R;
	return (h: number) =>
		step(
			R,
			add(scale(d, h), scale(t, -travel / 2)),
			add(scale(d, h), scale(t, travel / 2)),
			t,
			d,
			cutter,
		);
}
