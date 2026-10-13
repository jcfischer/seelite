/**
 * Throwaway prototype for node #950: how an asteroid field is drawn, and what
 * it costs. Not production code.
 *
 * A rock is drawn at one of three mesh levels or as a point, picked each frame
 * from its projected radius in pixels. Every rock moves every frame (#948 D5:
 * drift inside its cell plus spin), so the per-rock matrices are recomputed in
 * `update` and that cost is inside the measured frame.
 *
 * `radiusKm` is a bounding radius (#948 D5): every level of a shape is scaled
 * by one factor so that no vertex of any level lies outside the unit sphere,
 * and the instance scale is `radiusKm`.
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SimplexNoise } from "../../src/noise";
import { applyRockSurface, buildAsteroid, displayRand } from "../../src/station-surface";
import type { Rock } from "../asteroid-fields-948/field-proto.ts";

const TAU = Math.PI * 2;

/** Icosahedron detail per level. three r170 gives 20·(d+1)² faces. */
export const LEVEL_DETAIL = [6, 3, 1] as const;

/**
 * Projected radius in physical pixels at which a rock steps down a level, per
 * quality side. Inner edge is the bound × (1 + HYSTERESIS): a rock steps up
 * only past it, so it does not flicker on a boundary.
 */
export const LEVEL_PX: Record<"high" | "low", readonly [number, number, number]> = {
	// [level 0 above, level 1 above, level 2 above]; below the last: a point.
	high: [40, 10, 1.5],
	low: [80, 20, 3],
};
export const HYSTERESIS = 0.15;

export type Arm = "inst-k" | "batch-k" | "batch-unique" | "naive" | "batch-plain";

/** The displacement `buildAsteroid` uses (copied, not imported: it is fixed at
 *  detail 4 there), on a unit sphere, without the pad cut. */
function displaced(detail: number, tag: string): THREE.BufferGeometry {
	const g0 = new THREE.IcosahedronGeometry(1, detail);
	g0.deleteAttribute("normal");
	g0.deleteAttribute("uv");
	const geometry = mergeVertices(g0);
	const noise = new SimplexNoise(
		[...tag].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193), 0x811c9dc5) >>> 0,
	);
	const rand = displayRand(`${tag}-craters`);
	const craters = Array.from({ length: 6 }, () => {
		const z = rand() * 2 - 1;
		const theta = rand() * TAU;
		const planar = Math.sqrt(Math.max(0, 1 - z * z));
		return {
			dir: new THREE.Vector3(planar * Math.cos(theta), planar * Math.sin(theta), z),
			cos: Math.cos(0.22 + rand() * 0.3),
			depth: 0.06 + rand() * 0.1,
		};
	});
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const v = new THREE.Vector3();
	for (let i = 0; i < position.count; i++) {
		v.fromBufferAttribute(position, i).normalize();
		const field = (f: number) =>
			noise.noise2D(v.x * f, v.y * f) + noise.noise2D(v.y * f, v.z * f) + noise.noise2D(v.z * f, v.x * f);
		let scale = 1 + field(1.1) * 0.085 + field(2.7) * 0.042 + field(6.3) * 0.018;
		for (const c of craters) {
			const a = v.dot(c.dir);
			if (a <= c.cos) continue;
			const t = (a - c.cos) / (1 - c.cos);
			scale -= c.depth * t * t;
		}
		v.multiplyScalar(scale);
		v.z *= 0.78;
		position.setXYZ(i, v.x, v.y, v.z);
	}
	return geometry;
}

/** A shape's three levels, scaled together so the largest vertex of any level
 *  is exactly the unit bound. */
export function shapeLevels(tag: string): THREE.BufferGeometry[] {
	const levels = LEVEL_DETAIL.map((d) => displaced(d, tag));
	let max = 0;
	for (const g of levels) {
		const p = g.getAttribute("position");
		for (let i = 0; i < p.count; i++) max = Math.max(max, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
	}
	for (const g of levels) {
		g.scale(1 / max, 1 / max, 1 / max);
		g.computeVertexNormals();
		g.computeBoundingSphere();
	}
	return levels;
}

/**
 * The rock surface, patched so its per-fragment normal turns with the
 * instance. `ROCK_SURFACE` writes `normalMatrix * objN`, and `normalMatrix` is
 * the object's, not the instance's: under instancing a spinning rock would
 * keep its shading fixed while its silhouette turned.
 */
export function fieldRockMaterial(): THREE.MeshStandardMaterial {
	const material = applyRockSurface(
		new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.95, metalness: 0.02 }),
	);
	const base = material.onBeforeCompile;
	const swap = (src: string, from: string, to: string) => {
		if (!src.includes(from)) throw new Error(`field rock splice missed: ${from}`);
		return src.replace(from, to);
	};
	material.onBeforeCompile = (shader, renderer) => {
		base.call(material, shader, renderer);
		shader.vertexShader = swap(
			swap(shader.vertexShader, "varying vec3 vRockP;", "varying vec3 vRockP;\nvarying mat3 vRockM;"),
			"vRockP = position;",
			`vRockP = position;
#if defined( USE_BATCHING )
	vRockM = mat3( batchingMatrix );
#elif defined( USE_INSTANCING )
	vRockM = mat3( instanceMatrix );
#else
	vRockM = mat3( 1.0 );
#endif`,
		);
		shader.fragmentShader = swap(
			swap(shader.fragmentShader, "varying vec3 vRockP;", "varying vec3 vRockP;\nvarying mat3 vRockM;"),
			"normal = normalize(normalMatrix * objN);",
			"normal = normalize(normalMatrix * (vRockM * objN));",
		);
	};
	material.customProgramCacheKey = () => "field-rock";
	return material;
}

export interface FieldRendererOptions {
	arm: Arm;
	/** Archetype count for the `-k` arms. */
	k: number;
	quality: "high" | "low";
	/** Near-level rocks cast into the shadow map (principal: high only). */
	shadows: boolean;
}

export interface FieldStats {
	perLevel: [number, number, number, number];
	buildMs: number;
	uniqueShapes: number;
	geometryVertices: number;
	geometryTriangles: number;
}

/**
 * Build the field's drawn form. `root` is in field-frame kilometres; the
 * caller places and orients it. `update(t, cameraLocal)` moves every rock to
 * game time `t` and picks each one's level from the camera's position in the
 * same frame.
 */
export function buildFieldRenderer(
	rocks: readonly Rock[],
	opts: FieldRendererOptions,
	pxPerRadian: number,
) {
	const started = performance.now();
	const root = new THREE.Group();
	root.name = "asteroid-field";
	// `batch-plain`: batch-k with no rock surface patch, to price the shader apart from plain fill.
	const material =
		opts.arm === "batch-plain"
			? new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.95, metalness: 0.02 })
			: fieldRockMaterial();
	const shapeOf = (rock: Rock) =>
		opts.arm === "batch-unique" || opts.arm === "naive" ? rock.slot : rock.shapeSeed % opts.k;
	const shapeTags = [...new Set(rocks.map(shapeOf))];
	let vertices = 0;
	let triangles = 0;
	const count = (g: THREE.BufferGeometry) => {
		vertices += g.getAttribute("position").count;
		triangles += (g.index?.count ?? 0) / 3;
	};

	// Points: every rock below level 2, one draw.
	const pointPos = new Float32Array(rocks.length * 3);
	const pointGeom = new THREE.BufferGeometry();
	pointGeom.setAttribute("position", new THREE.BufferAttribute(pointPos, 3));
	const points = new THREE.Points(
		pointGeom,
		new THREE.PointsMaterial({ color: 0x8a7e6c, size: 1.5, sizeAttenuation: false }),
	);
	points.frustumCulled = false;
	root.add(points);

	// Per-arm level sinks: each returns `place(rockIndex, level, matrix)` and `flush()`.
	let place: (i: number, level: number, m: THREE.Matrix4) => void;
	let begin: () => void;
	let flush: () => void;

	if (opts.arm === "naive") {
		// One mesh per rock at level 0, no LOD: the reference a plain
		// `buildAsteroid` per rock would give.
		// The game's own `buildAsteroid` at unit radius, scaled per rock:
		// detail 4 and its own material, as the station rocks are drawn today.
		const meshes = rocks.map((rock) => {
			const m = buildAsteroid(1, `rock-${rock.slot}`);
			count(m.geometry);
			m.matrixAutoUpdate = false;
			m.castShadow = opts.shadows;
			root.add(m);
			return m;
		});
		begin = () => {};
		place = (i, _l, m) => meshes[i].matrix.copy(m);
		flush = () => {};
	} else if (opts.arm === "inst-k") {
		const shapes = shapeTags.map((s) => shapeLevels(`arch-${s}`));
		const meshes = shapes.map((levels) =>
			levels.map((g, level) => {
				count(g);
				const m = new THREE.InstancedMesh(g, material, rocks.length);
				m.frustumCulled = false;
				m.castShadow = opts.shadows && level === 0;
				m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
				root.add(m);
				return m;
			}),
		);
		const index = new Map(shapeTags.map((s, i) => [s, i]));
		begin = () => {
			for (const ls of meshes) for (const m of ls) m.count = 0;
		};
		place = (i, level, m) => {
			const mesh = meshes[index.get(shapeOf(rocks[i]))!][level];
			mesh.setMatrixAt(mesh.count++, m);
		};
		flush = () => {
			for (const ls of meshes)
				for (const m of ls) {
					m.visible = m.count > 0;
					m.instanceMatrix.needsUpdate = true;
				}
		};
	} else {
		// BatchedMesh: one for level 0 (it may cast), one for levels 1–2.
		const shapes = shapeTags.map((s) => shapeLevels(opts.arm !== "batch-unique" ? `arch-${s}` : `rock-${s}`));
		const size = (ls: number[]) => {
			let v = 0;
			let ix = 0;
			for (const levels of shapes)
				for (const l of ls) {
					v += levels[l].getAttribute("position").count;
					ix += levels[l].index!.count;
				}
			return [v, ix] as const;
		};
		const make = (ls: number[], cast: boolean) => {
			const [v, ix] = size(ls);
			const b = new THREE.BatchedMesh(rocks.length, v, ix, material);
			b.frustumCulled = false;
			b.perObjectFrustumCulled = true;
			b.sortObjects = false;
			b.castShadow = cast;
			const ids = shapes.map((levels) =>
				ls.map((l) => {
					count(levels[l]);
					return b.addGeometry(levels[l]);
				}),
			);
			// One instance per rock, hidden until placed.
			const inst = rocks.map(() => {
				const id = b.addInstance(ids[0][0]);
				b.setVisibleAt(id, false);
				return id;
			});
			root.add(b);
			return { b, ids, inst };
		};
		const near = make([0], opts.shadows);
		const far = make([1, 2], false);
		const index = new Map(shapeTags.map((s, i) => [s, i]));
		begin = () => {
			for (let i = 0; i < rocks.length; i++) {
				near.b.setVisibleAt(near.inst[i], false);
				far.b.setVisibleAt(far.inst[i], false);
			}
		};
		place = (i, level, m) => {
			const s = index.get(shapeOf(rocks[i]))!;
			const sink = level === 0 ? near : far;
			const id = sink.inst[i];
			sink.b.setGeometryIdAt(id, sink.ids[s][level === 0 ? 0 : level - 1]);
			sink.b.setMatrixAt(id, m);
			sink.b.setVisibleAt(id, true);
		};
		flush = () => {
			near.b.visible = true;
			far.b.visible = true;
		};
	}

	const levelOf = new Int8Array(rocks.length).fill(3);
	const perLevel: [number, number, number, number] = [0, 0, 0, 0];
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const axis = new THREE.Vector3();
	const pos = new THREE.Vector3();
	const s = new THREE.Vector3();
	const bounds = LEVEL_PX[opts.quality];

	function update(t: number, cameraLocal: THREE.Vector3) {
		begin();
		perLevel.fill(0);
		let np = 0;
		for (let i = 0; i < rocks.length; i++) {
			const r = rocks[i];
			const w = (TAU * t) / r.driftPeriodS + r.driftPhase;
			const c = Math.cos(w) * r.driftKm;
			const sn = Math.sin(w) * r.driftKm;
			pos.set(
				r.anchor.x + c * r.e1.x + sn * r.e2.x,
				r.anchor.y + c * r.e1.y + sn * r.e2.y,
				r.anchor.z + c * r.e1.z + sn * r.e2.z,
			);
			const px = (r.radiusKm / Math.max(1e-6, pos.distanceTo(cameraLocal))) * pxPerRadian;
			// Step up only past the inner edge of the band above.
			let level = 3;
			for (let l = 0; l < 3; l++) {
				const edge = bounds[l] * (levelOf[i] > l ? 1 + HYSTERESIS : 1);
				if (px > edge) {
					level = l;
					break;
				}
			}
			if (opts.arm === "naive") level = 0;
			levelOf[i] = level;
			perLevel[level]++;
			if (level === 3) {
				pointPos[np * 3] = pos.x;
				pointPos[np * 3 + 1] = pos.y;
				pointPos[np * 3 + 2] = pos.z;
				np++;
				continue;
			}
			axis.set(r.axis.x, r.axis.y, r.axis.z);
			q.setFromAxisAngle(axis, (TAU * t) / r.periodS + r.phase0);
			s.setScalar(r.radiusKm);
			m.compose(pos, q, s);
			place(i, level, m);
		}
		flush();
		pointGeom.setDrawRange(0, np);
		(pointGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
		points.visible = np > 0;
	}

	const buildMs = performance.now() - started;
	const stats = (): FieldStats => ({
		perLevel: [...perLevel] as FieldStats["perLevel"],
		buildMs,
		uniqueShapes: shapeTags.length,
		geometryVertices: vertices,
		geometryTriangles: triangles,
	});
	return { root, update, stats, material };
}

/** The page's own three, for an instrument evaluating in the page. */
export { THREE };
