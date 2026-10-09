/**
 * Where each hull's vent pairs sit so every line of action meets metal (#636).
 *
 *   bun scripts/measure-vent-placement.ts
 *
 * The table put every vent on its envelope's box, and no attitude vent's line
 * of action met the hull on any hull: the roll pairs passed 9 to 28 m clear of
 * the five larger ones. A pair may move in any direction that leaves it pure
 * (`flight-model.md` §3.2.1), so this searches those directions on the
 * selected variant's mesh:
 *
 * - **An attitude pair** slides along the axis its couple does not use — roll
 *   fore and aft, yaw up and down, pitch port and starboard — to wherever its
 *   arm is longest, and each end stands as far out as metal still meets the
 *   line. An arm shortens only where no slide reaches metal at the box.
 * - **A translation pair** keeps its box position where that line, and the
 *   two a step inward of it, meet metal (below), and otherwise moves in, symmetrically, as far as it must: the retro pair
 *   toward the centreline, the strafe pairs toward the centre of mass.
 *
 * A line counts as meeting metal when it and the two lines a step inward of
 * it all hit the hull, so a stored line is never a graze on one vertex.
 * Instanced greeble and the drive glow are left out: they are not what a vent
 * is mounted through. `src/hull.ts` stores the result and
 * `tests/vent-placement.test.ts` holds the two equal, so a mesh change shows
 * there as a row to re-measure — and then the shares re-solve
 * (`scripts/measure-vent-shares.ts`).
 */

import * as THREE from "three";
import {
	BOX_PLACEMENT,
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	type VentPlacement,
	coupleArms,
} from "../src/hull";
import { buildShipMesh } from "../src/ship-mesh";
// The authored Porter is `freighter/b` (node #813): measure the shipped model.
import "../tests/setup/authored-hulls";

/** Steps per half-extent: a reach is found to a quarter of a percent. */
const STEPS = 400;
/** The slide a pair may make along its free axis, in steps of a fortieth. */
const SLIDE_STEPS = 40;

type Vec = readonly [number, number, number];

/** The hull frame's lines against one built mesh: does the line through `p`
 *  along `dir` meet metal? `p` in kilometres from the envelope's centre,
 *  which is the whole root's box centre: the frame `ventThroats` draws in,
 *  and the box `tests/hull.test.ts` holds `env` to. The metal set is smaller
 *  than that box on purpose; the origin is not.
 *
 *  Every line this instrument asks about runs along a hull axis, so the
 *  question is two-dimensional: the line meets a triangle exactly when its
 *  point lies inside the triangle's projection across that axis, and the
 *  triangle faces the line's start the way `Raycaster` requires of a
 *  `FrontSide` material. That is the ray cast it replaces — from far outside,
 *  through the whole hull, any face — answered from a grid of projected
 *  triangles, because the authored Porter (node #813) is 363k triangles and a
 *  ray tested against every one of them made this a run of hours. */
function lineTester(root: THREE.Object3D) {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const centre = box.getCenter(new THREE.Vector3());
	const metal: THREE.Mesh[] = [];
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (
			mesh.isMesh &&
			!(mesh as THREE.InstancedMesh).isInstancedMesh &&
			!mesh.name.endsWith("-exhaust")
		)
			metal.push(mesh);
	});
	const grids = ([0, 1, 2] as const).map((axis) => axisGrid(metal, axis));
	return (p: Vec, dir: Vec): boolean => {
		const axis = dir.findIndex((c) => c !== 0);
		if (
			axis < 0 ||
			dir[axis] !== 1 ||
			dir.some((c, i) => i !== axis && c !== 0)
		)
			throw new Error(`lineTester: ${dir} is not a positive hull axis`);
		return grids[axis](p[0] + centre.x, p[1] + centre.y, p[2] + centre.z);
	};
}

/** Cells per side of an axis grid. */
const GRID = 256;

/**
 * Every metal triangle a line along +`axis` can meet, projected across it
 * and filed in a grid, and the exact test of one line against them.
 *
 * Kept: a triangle whose world normal faces back along the line (a
 * `FrontSide` material culls the rest, as `Raycaster` does) or any triangle
 * of a two-sided one; dropped: a triangle edge-on to the line, which a ray
 * never meets either. Inside is inclusive of the edges, as three's
 * `intersectTriangle` is.
 */
function axisGrid(metal: readonly THREE.Mesh[], axis: 0 | 1 | 2) {
	const [ua, va] = [(axis + 1) % 3, (axis + 2) % 3];
	const tris: number[] = [];
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const n = new THREE.Vector3();
	for (const mesh of metal) {
		const geometry = mesh.geometry;
		const position = geometry.getAttribute("position");
		const index = geometry.index;
		const count = index ? index.count : position.count;
		const flip = mesh.matrixWorld.determinant() < 0 ? -1 : 1;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		const groups =
			geometry.groups.length > 0
				? geometry.groups
				: [{ start: 0, count, materialIndex: 0 }];
		for (const group of groups) {
			const material = materials[group.materialIndex ?? 0];
			if (!material) continue;
			const twoSided = material.side === THREE.DoubleSide;
			const backOnly = material.side === THREE.BackSide;
			const stop = Math.min(count, group.start + group.count);
			for (let i = group.start; i + 2 < stop; i += 3) {
				const at = (k: number) => (index ? index.getX(k) : k);
				a.fromBufferAttribute(position, at(i)).applyMatrix4(mesh.matrixWorld);
				b.fromBufferAttribute(position, at(i + 1)).applyMatrix4(
					mesh.matrixWorld,
				);
				c.fromBufferAttribute(position, at(i + 2)).applyMatrix4(
					mesh.matrixWorld,
				);
				n.subVectors(c, b).cross(a.clone().sub(b));
				const facing = -flip * n.getComponent(axis);
				if (facing === 0) continue;
				if (!twoSided && (backOnly ? facing > 0 : facing < 0)) continue;
				tris.push(
					a.getComponent(ua),
					a.getComponent(va),
					b.getComponent(ua),
					b.getComponent(va),
					c.getComponent(ua),
					c.getComponent(va),
				);
			}
		}
	}
	let minU = Infinity;
	let minV = Infinity;
	let maxU = -Infinity;
	let maxV = -Infinity;
	for (let t = 0; t < tris.length; t += 2) {
		minU = Math.min(minU, tris[t]);
		maxU = Math.max(maxU, tris[t]);
		minV = Math.min(minV, tris[t + 1]);
		maxV = Math.max(maxV, tris[t + 1]);
	}
	const du = (maxU - minU) / GRID || 1;
	const dv = (maxV - minV) / GRID || 1;
	const cell = (x: number, min: number, d: number) =>
		Math.min(GRID - 1, Math.max(0, Math.floor((x - min) / d)));
	const cells: number[][] = Array.from({ length: GRID * GRID }, () => []);
	for (let t = 0; t < tris.length; t += 6) {
		const u0 = cell(Math.min(tris[t], tris[t + 2], tris[t + 4]), minU, du);
		const u1 = cell(Math.max(tris[t], tris[t + 2], tris[t + 4]), minU, du);
		const v0 = cell(Math.min(tris[t + 1], tris[t + 3], tris[t + 5]), minV, dv);
		const v1 = cell(Math.max(tris[t + 1], tris[t + 3], tris[t + 5]), minV, dv);
		for (let u = u0; u <= u1; u++)
			for (let v = v0; v <= v1; v++) cells[u * GRID + v].push(t);
	}
	const point = [0, 0, 0];
	return (x: number, y: number, z: number): boolean => {
		point[0] = x;
		point[1] = y;
		point[2] = z;
		const pu = point[ua];
		const pv = point[va];
		if (pu < minU || pu > maxU || pv < minV || pv > maxV) return false;
		for (const t of cells[cell(pu, minU, du) * GRID + cell(pv, minV, dv)]) {
			const d1 =
				(tris[t + 2] - tris[t]) * (pv - tris[t + 1]) -
				(tris[t + 3] - tris[t + 1]) * (pu - tris[t]);
			const d2 =
				(tris[t + 4] - tris[t + 2]) * (pv - tris[t + 3]) -
				(tris[t + 5] - tris[t + 3]) * (pu - tris[t + 2]);
			const d3 =
				(tris[t] - tris[t + 4]) * (pv - tris[t + 5]) -
				(tris[t + 1] - tris[t + 5]) * (pu - tris[t + 4]);
			if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0))
				return true;
		}
		return false;
	};
}

/** The largest step `i ≤ cap` whose line, and the two a step inward, meet
 *  metal; as a fraction of the half-extent. `NaN` if none does. */
function reachOf(line: (f: number) => boolean, cap = STEPS): number {
	for (let i = cap; i >= 2; i--)
		if (line(i / STEPS) && line((i - 1) / STEPS) && line((i - 2) / STEPS))
			return i / STEPS;
	return Number.NaN;
}

/** The slide offsets, nearest the box's own first, so a tie keeps the pair
 *  where the table had it. */
const SLIDES = Array.from({ length: 2 * SLIDE_STEPS + 1 }, (_, k) => {
	const j = Math.ceil(k / 2) * (k % 2 === 0 ? 1 : -1);
	return j / SLIDE_STEPS;
});

/** The slide whose two ends reach furthest, and the two reaches. */
function bestSlide(ends: (slide: number) => readonly [number, number]): {
	slide: number;
	ends: readonly [number, number];
} {
	let best: { slide: number; ends: readonly [number, number] } | undefined;
	for (const slide of SLIDES) {
		const at = ends(slide);
		// A missed end is NaN, and a NaN arm never wins.
		if (!best || at[0] + at[1] > best.ends[0] + best.ends[1])
			if (at[0] + at[1] > 0) best = { slide, ends: at };
	}
	if (!best) throw new Error("no slide meets metal at both ends");
	return best;
}

/** The placement every line of `id`'s selected mesh meets metal at. `root` is
 *  that mesh as `buildShipMesh` returns it, untransformed. */
export function measureVentPlacement(
	id: HullId,
	root: THREE.Object3D = buildShipMesh(id, HULL_SPECS[id].variant).root,
): VentPlacement {
	const hits = lineTester(root);
	const env = HULL_SPECS[id].env;
	const hb = env.beamKm / 2;
	const hh = env.heightKm / 2;
	const hl = env.lengthKm / 2;
	const X: Vec = [1, 0, 0];
	const Y: Vec = [0, 1, 0];
	const Z: Vec = [0, 0, 1];

	const roll = bestSlide((z) => [
		reachOf((f) => hits([-f * hb, 0, z * hl], Y)),
		reachOf((f) => hits([f * hb, 0, z * hl], Y)),
	]);
	const yaw = bestSlide((y) => [
		reachOf((f) => hits([0, y * hh, -f * hl], X)),
		reachOf((f) => hits([0, y * hh, f * hl], X)),
	]);
	const pitch = bestSlide((x) => [
		reachOf((f) => hits([x * hb, 0, -f * hl], Y)),
		reachOf((f) => hits([x * hb, 0, f * hl], Y)),
	]);
	const retroX = reachOf(
		(f) => hits([-f * hb, 0, 0], Z) && hits([f * hb, 0, 0], Z),
		BOX_PLACEMENT.retroX * STEPS,
	);
	const strafeZ = reachOf(
		(f) =>
			[-f, f].every((z) => hits([0, 0, z * hl], X) && hits([0, 0, z * hl], Y)),
		BOX_PLACEMENT.strafeZ * STEPS,
	);
	for (const [name, v] of Object.entries({ retroX, strafeZ }))
		if (!Number.isFinite(v)) throw new Error(`${id}: no ${name} meets metal`);

	return {
		retroX,
		strafeZ,
		yaw: { y: yaw.slide, fore: yaw.ends[0], aft: yaw.ends[1] },
		pitch: { x: pitch.slide, fore: pitch.ends[0], aft: pitch.ends[1] },
		roll: { z: roll.slide, port: roll.ends[0], starboard: roll.ends[1] },
	};
}

if (import.meta.main) {
	const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
	const rows = HULL_IDS.map((id) => {
		const spec = HULL_SPECS[id];
		const measured = measureVentPlacement(id);
		const box = coupleArms(spec.env, BOX_PLACEMENT);
		const arms = coupleArms(spec.env, measured);
		return {
			id,
			measured,
			table: {
				id,
				"pitch arm": pct(arms.pitch / box.pitch),
				"yaw arm": pct(arms.yaw / box.yaw),
				"roll arm": pct(arms.roll / box.roll),
				retroX: measured.retroX,
				strafeZ: measured.strafeZ,
				"hull.ts":
					JSON.stringify(measured) === JSON.stringify(spec.ventPlacement)
						? "matches"
						: "re-measure",
			},
		};
	});
	console.log("each arm as a share of the box's:");
	console.table(rows.map((r) => r.table));
	console.log("\nrows for src/hull.ts:");
	for (const { id, measured } of rows)
		console.log(`${id}: ventPlacement: ${JSON.stringify(measured)},`);
}
