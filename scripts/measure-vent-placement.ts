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
 *  **Three's own raycast, bucketed (node #815).** Every line here runs along
 *  an axis, so a triangle can only be met where its box, projected across
 *  that axis, covers the line. Each triangle is filed in a grid over the two
 *  other axes once, and a query runs `Mesh.raycast`'s own tests — the world
 *  sphere, the local box, `checkIntersection`'s sides and range — on the
 *  triangles of its cell alone. The filter is padded, so it only ever drops a
 *  triangle the raycast would also miss, and the answer is the raycaster's:
 *  every other hull's stored placement is unchanged. Without it Longwall B's
 *  283k triangles took the search past ten minutes. */
function lineTester(root: THREE.Object3D) {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const centre = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const reach = size.length();
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
	interface Tri {
		mesh: THREE.Mesh;
		material: THREE.Material;
		a: number;
		b: number;
		c: number;
		min: THREE.Vector3;
		max: THREE.Vector3;
	}
	const tris: Tri[] = [];
	const v = new THREE.Vector3();
	for (const mesh of metal) {
		const { geometry } = mesh;
		const material = mesh.material;
		const index = geometry.index;
		const position = geometry.getAttribute("position");
		if (!position) continue;
		const range = geometry.drawRange;
		const count = index ? index.count : position.count;
		const spans: { material: THREE.Material; start: number; end: number }[] =
			Array.isArray(material)
				? geometry.groups.map((g) => ({
						material: material[g.materialIndex ?? 0],
						start: Math.max(g.start, range.start),
						end: Math.min(count, g.start + g.count, range.start + range.count),
					}))
				: [
						{
							material,
							start: Math.max(0, range.start),
							end: Math.min(count, range.start + range.count),
						},
					];
		for (const span of spans) {
			if (!span.material) continue;
			for (let i = span.start; i < span.end; i += 3) {
				const ids = index
					? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
					: [i, i + 1, i + 2];
				const min = new THREE.Vector3(Infinity, Infinity, Infinity);
				const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
				for (const id of ids) {
					mesh.getVertexPosition(id, v).applyMatrix4(mesh.matrixWorld);
					min.min(v);
					max.max(v);
				}
				tris.push({
					mesh,
					material: span.material,
					a: ids[0],
					b: ids[1],
					c: ids[2],
					min,
					max,
				});
			}
		}
	}
	// A grid per axis over the other two, and a pad far above float error.
	const CELLS = 64;
	const pad = reach * 1e-6;
	const AXES = [
		[1, 2],
		[0, 2],
		[0, 1],
	] as const;
	const cellOf = (value: number, axis: number) => {
		const t = (value - box.min.getComponent(axis)) / size.getComponent(axis);
		return Math.min(CELLS - 1, Math.max(0, Math.floor(t * CELLS)));
	};
	const grids = AXES.map(([u, w]) => {
		const grid: Tri[][] = Array.from({ length: CELLS * CELLS }, () => []);
		for (const tri of tris)
			for (
				let i = cellOf(tri.min.getComponent(u) - pad, u);
				i <= cellOf(tri.max.getComponent(u) + pad, u);
				i++
			)
				for (
					let j = cellOf(tri.min.getComponent(w) - pad, w);
					j <= cellOf(tri.max.getComponent(w) + pad, w);
					j++
				)
					grid[i * CELLS + j].push(tri);
		return grid;
	});

	const caster = new THREE.Raycaster();
	const sphere = new THREE.Sphere();
	const recast = new THREE.Ray();
	const sphereHit = new THREE.Vector3();
	const inverse = new THREE.Matrix4();
	const local = new THREE.Ray();
	const pA = new THREE.Vector3();
	const pB = new THREE.Vector3();
	const pC = new THREE.Vector3();
	const point = new THREE.Vector3();
	/** `Mesh.raycast`'s culls, as three runs them before any triangle. */
	const meshPasses = (mesh: THREE.Mesh): boolean => {
		const geometry = mesh.geometry;
		if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
		sphere
			.copy(geometry.boundingSphere as THREE.Sphere)
			.applyMatrix4(mesh.matrixWorld);
		recast.copy(caster.ray).recast(caster.near);
		if (!sphere.containsPoint(recast.origin)) {
			if (recast.intersectSphere(sphere, sphereHit) === null) return false;
			if (
				recast.origin.distanceToSquared(sphereHit) >
				(caster.far - caster.near) ** 2
			)
				return false;
		}
		inverse.copy(mesh.matrixWorld).invert();
		local.copy(caster.ray).applyMatrix4(inverse);
		return !(
			geometry.boundingBox !== null &&
			!local.intersectsBox(geometry.boundingBox)
		);
	};
	return (p: Vec, dir: Vec): boolean => {
		const axis = dir.findIndex((c) => c !== 0);
		if (axis < 0 || dir.filter((c) => c !== 0).length !== 1)
			throw new Error("lineTester: lines run along an axis");
		const d = new THREE.Vector3(...dir);
		const through = new THREE.Vector3(...p).add(centre);
		caster.set(through.clone().addScaledVector(d, -2 * reach), d);
		caster.far = 4 * reach;
		const [u, w] = AXES[axis];
		const pu = through.getComponent(u);
		const pw = through.getComponent(w);
		const cell = grids[axis][cellOf(pu, u) * CELLS + cellOf(pw, w)];
		const passed = new Map<THREE.Mesh, boolean>();
		for (const tri of cell) {
			if (
				pu < tri.min.getComponent(u) - pad ||
				pu > tri.max.getComponent(u) + pad ||
				pw < tri.min.getComponent(w) - pad ||
				pw > tri.max.getComponent(w) + pad
			)
				continue;
			let ok = passed.get(tri.mesh);
			if (ok === undefined) {
				ok = meshPasses(tri.mesh);
				passed.set(tri.mesh, ok);
			}
			if (!ok) continue;
			// `meshPasses` left this mesh's local ray in `local`; recompute it, as
			// another mesh's may have replaced it since.
			inverse.copy(tri.mesh.matrixWorld).invert();
			local.copy(caster.ray).applyMatrix4(inverse);
			tri.mesh.getVertexPosition(tri.a, pA);
			tri.mesh.getVertexPosition(tri.b, pB);
			tri.mesh.getVertexPosition(tri.c, pC);
			// `checkIntersection`, sides and range as three has them.
			const hit =
				tri.material.side === THREE.BackSide
					? local.intersectTriangle(pC, pB, pA, true, point)
					: local.intersectTriangle(
							pA,
							pB,
							pC,
							tri.material.side === THREE.FrontSide,
							point,
						);
			if (hit === null) continue;
			const distance = caster.ray.origin.distanceTo(
				point.applyMatrix4(tri.mesh.matrixWorld),
			);
			if (distance < caster.near || distance > caster.far) continue;
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
	// `miner/b` is the authored Longwall B, built only once it is installed.
	await (await import("./lib/install-longwall")).installShippedLongwall();
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
