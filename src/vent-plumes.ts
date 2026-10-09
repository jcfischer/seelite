/**
 * The firing vents, drawn (`flight-model.md` §3.8.1, #621).
 *
 * **Drawn from the sim's firing table and from nothing else.** `update` takes
 * the step's `VentLevels` — the table `stepFlight` returns — and a game-clock
 * time, and writes the particles from those two. Nothing here reads a
 * position, a velocity or a level back out of an `Object3D`; the one thing it
 * reads off the built hull is where its metal is, once, at build, to decide
 * where a throat sits (below).
 *
 * **A plume is particles and a glow at the throat, never a cone.** The ruling
 * is `station-mesh.ts`'s `buildVentBank`: a gas vented in vacuum throws an
 * expanding cloud that thins to nothing in metres, it is not a solid, and the
 * alternative that docstring names is the one built here — an emitter on each
 * throat, drawn as additive points that expand and fade.
 *
 * **Not under the hull's root.** The plumes are a sibling the renderer moves
 * with the hull each frame. The root's box is the berth-fit envelope
 * (`tests/ship-finish.test.ts`), the shadow camera's subject and what
 * `measureMuzzles` reads, and a puff thrown past the stern would move all
 * three. The points cast no shadow and are not occluders, so #201's passes
 * neither darken the hull with them nor see them.
 *
 * **Stateless in time.** Every particle's age is a function of the game clock
 * and its index, so the same clock draws the same frame: a held clock holds
 * the plume, and a before/after pair of captures can be compared.
 */

import * as THREE from "three";
import {
	HULL_SPECS,
	type HullId,
	type VentFamily,
	type VentSlot,
} from "./hull";
import { EMISSIVE_CEILING } from "./light-rig";
import {
	type AuthoredHullBuilder,
	authoredCourierBuilder,
	exhaustRamp,
	isDriveBell,
} from "./ship-mesh";
import { isLevelStandIn } from "./ship-detail";
import { type HullFinishId, hullFinishId } from "./ship-surface";
import type { VentLevels } from "./sim";

/**
 * Where one vent is drawn, in the hull root's frame, kilometres.
 *
 * - `line` — on the vent's own line of action, where its exhaust leaves the
 *   metal. **Sliding a vent along the line its push acts on changes neither
 *   its force nor its torque**, so a throat moved there from the table's
 *   position is the same vent, physically, and not a picture of a different
 *   one. `gapKm` is how far that point is from the nearest metal: zero where
 *   the line meets the hull, more where it only passes it.
 * - `bell` — the main drive, drawn at the hull's own drive bells. The table
 *   carries one main vent on the centre line, which is the bells' resultant:
 *   symmetric bells sum to its force and to no torque.
 */
export interface Throat {
	slot: VentSlot;
	family: VentFamily;
	at: THREE.Vector3;
	/** Unit, the way the gas leaves: opposite the vent's push. */
	exhaust: THREE.Vector3;
	/** How big this throat's puff is, kilometres at full level. */
	reachKm: number;
	placed: "line" | "bell";
	gapKm: number;
}

/** A plume's length at full level, as a fraction of the hull's length. The
 *  main drive throws the longest; a translation or attitude vent a short puff,
 *  which is what reads as a thruster rather than as a second drive. */
export const PLUME_REACH: Readonly<Record<VentFamily, number>> = {
	main: 0.45,
	retro: 0.22,
	strafe: 0.2,
	pitch: 0.18,
	yaw: 0.18,
	roll: 0.18,
};

/** How long one puff lives, seconds of game clock. */
export const PLUME_LIFE_S: Readonly<Record<VentFamily, number>> = {
	main: 0.55,
	retro: 0.4,
	strafe: 0.35,
	pitch: 0.3,
	yaw: 0.3,
	roll: 0.3,
};

/** Particles per throat, the glow at the throat not counted. */
export const PLUME_PARTICLES = 10;

/** The brightest one plume point emits, against the shared exposure ceiling
 *  (#199): under it, so a lone puff is shaped by the tone map and does not
 *  halo. Overlapping puffs add, which is what makes a throat read hot. */
export const PLUME_PEAK = EMISSIVE_CEILING * 0.9;

/** A cheap, fixed hash in 0…1: the per-particle scatter is a property of the
 *  index, not a draw, so no `Math.random` reaches the frame. */
const hash01 = (n: number): number => {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

/**
 * Particle `i` of a throat at game time `t`: its age as a fraction of its life
 * (0 at the throat), how far along the exhaust it has gone and how far across
 * it, as fractions of the throat's reach, and how strong it is at `level`.
 *
 * Every particle cycles through one life, offset by its index, so a steady
 * firing is a steady stream; `level` scales how far the stream reaches and how
 * bright it is, and at zero there is nothing to draw.
 */
export function plumeParticle(
	i: number,
	seed: number,
	t: number,
	lifeS: number,
	level: number,
): { age: number; along: number; across: [number, number]; strength: number } {
	const phase = t / lifeS + i / PLUME_PARTICLES + hash01(seed);
	const age = phase - Math.floor(phase);
	const reach = Math.sqrt(Math.max(0, Math.min(1, level)));
	const spread = 0.28 * age;
	const angle = 2 * Math.PI * hash01(seed * 31 + i);
	const radius = spread * Math.sqrt(hash01(seed * 17 + i * 3 + 1));
	return {
		age,
		along: reach * age,
		across: [radius * Math.cos(angle), radius * Math.sin(angle)],
		strength: Math.max(0, Math.min(1, level)) * (1 - age) ** 1.5,
	};
}

/**
 * Every throat of a built hull. Read off the mesh once, at build: where each
 * vent's line of action leaves the metal, or where the drive bells are.
 *
 * `root` is the hull's own root as `buildShipMesh` returned it, with no
 * transform applied. Its box centre is the hull frame's origin — the table's
 * positions are measured from the envelope's centre (`hull.ts`), and the mesh
 * origin is not that centre on every hull.
 */
export function ventThroats(root: THREE.Object3D, id: HullId): Throat[] {
	const builder = authoredCourierBuilder();
	if (id !== "courier" || root.userData.authored !== true || !builder)
		return measureThroats(root, id);
	let byFinish = authoredThroats.get(builder);
	if (!byFinish) {
		byFinish = new Map();
		authoredThroats.set(builder, byFinish);
	}
	const finish = hullFinishId();
	let known = byFinish.get(finish);
	if (!known) {
		known = measureThroats(root, id);
		byFinish.set(finish, known);
	}
	return known.map((t) => ({
		...t,
		at: t.at.clone(),
		exhaust: t.exhaust.clone(),
	}));
}

/**
 * The authored courier's throats (node #812), measured once per installed
 * model and finish. Every authored courier is the one model, so its throats
 * are one answer — and measuring it raycasts against 354k triangles, about
 * half a second, which a shipyard swap to a courier would otherwise pay on
 * the frame. Keyed on the builder, so installing another model (or none)
 * leaves the old answer unreachable; and on the finish, because a finish
 * picks the drive glow (a bowl or a disc) the main drive's plume starts at.
 */
const authoredThroats = new WeakMap<
	AuthoredHullBuilder,
	Map<HullFinishId, readonly Throat[]> // glossary-ignore: throat
>();

// glossary-ignore: throat
function measureThroats(root: THREE.Object3D, id: HullId): Throat[] {
	const spec = HULL_SPECS[id];
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const centre = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const reach = Math.max(size.x, size.y, size.z);
	const lengthKm = spec.env.lengthKm;

	const meshes: THREE.Mesh[] = [];
	const bells: THREE.Mesh[] = [];
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		// A reduced level is drawn, never measured (node #812).
		if (!mesh.isMesh || isLevelStandIn(mesh)) return;
		meshes.push(mesh);
		if (isDriveBell(mesh)) bells.push(mesh);
	});
	// The vertices, in the root's frame, for the lines that pass the hull
	// without meeting it. Instanced detail is left out: it is greeble, not the
	// metal a vent is mounted through.
	// One flat array, read only if some line misses the hull: a hull has tens
	// of thousands of vertices, and a `Vector3` each was the hull swap's cost.
	let vertices: Float64Array | null = null;
	const vertexArray = (): Float64Array => {
		if (vertices) return vertices;
		const solid = meshes.filter(
			(m) =>
				!(m as THREE.InstancedMesh).isInstancedMesh &&
				m.geometry.getAttribute("position"),
		);
		const total = solid.reduce(
			(n, m) => n + m.geometry.getAttribute("position").count,
			0,
		);
		const out = new Float64Array(total * 3);
		const q = new THREE.Vector3();
		let k = 0;
		for (const mesh of solid) {
			const position = mesh.geometry.getAttribute(
				"position",
			) as THREE.BufferAttribute;
			for (let i = 0; i < position.count; i++, k += 3) {
				q.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
				out[k] = q.x;
				out[k + 1] = q.y;
				out[k + 2] = q.z;
			}
		}
		vertices = out;
		return out;
	};

	const caster = new THREE.Raycaster();
	const throats: Throat[] = [];
	for (const vent of spec.vents) {
		const dir = new THREE.Vector3(...vent.dir);
		const exhaust = dir.clone().negate();
		const reachKm = PLUME_REACH[vent.family] * lengthKm;
		if (vent.family === "main" && bells.length > 0) {
			for (const at of bellCentres(bells))
				throats.push({
					slot: vent.slot,
					family: vent.family,
					at,
					exhaust: exhaust.clone(),
					reachKm,
					placed: "bell",
					gapKm: 0,
				});
			continue;
		}
		const table = new THREE.Vector3(...vent.posKm).add(centre);
		// From well outside on the exhaust side, inward along the push: the
		// first metal met is where the gas leaves the hull.
		caster.set(table.clone().addScaledVector(dir, -2 * reach), dir);
		const hit = caster.intersectObjects(meshes, false).find((h) => h.face);
		const { along, gapKm } = hit
			? { along: hit.point.clone().sub(table).dot(dir), gapKm: 0 }
			: closestApproach(vertexArray(), table, dir, 0.01 * reach);
		throats.push({
			slot: vent.slot,
			family: vent.family,
			at: table.addScaledVector(dir, along),
			exhaust,
			reachKm,
			placed: "line",
			gapKm,
		});
	}
	return throats;
}

/** The centre of each drive bell's glow, in the root's frame. */
function bellCentres(bells: readonly THREE.Mesh[]): THREE.Vector3[] {
	return bells.map((bell) => {
		bell.geometry.computeBoundingBox();
		return (bell.geometry.boundingBox as THREE.Box3)
			.clone()
			.applyMatrix4(bell.matrixWorld)
			.getCenter(new THREE.Vector3());
	});
}

/**
 * Where a line that passes the hull comes closest to it: `gapKm` is its
 * closest approach to any vertex, and `along` — distance from `from` along
 * `dir` — is, of the vertices within `slackKm` of that, the one furthest out
 * on the exhaust side, so the gas leaves past the metal rather than through it.
 * `xyz` is a flat vertex array.
 */
function closestApproach(
	xyz: Float64Array,
	from: THREE.Vector3,
	dir: THREE.Vector3,
	slackKm: number,
): { along: number; gapKm: number } {
	const n = xyz.length / 3;
	const ts = new Float64Array(n);
	const perps = new Float64Array(n);
	let gapKm = Number.POSITIVE_INFINITY;
	for (let i = 0; i < n; i++) {
		const rx = xyz[3 * i] - from.x;
		const ry = xyz[3 * i + 1] - from.y;
		const rz = xyz[3 * i + 2] - from.z;
		const t = rx * dir.x + ry * dir.y + rz * dir.z;
		ts[i] = t;
		perps[i] = Math.hypot(rx - t * dir.x, ry - t * dir.y, rz - t * dir.z);
		gapKm = Math.min(gapKm, perps[i]);
	}
	let along = Number.POSITIVE_INFINITY;
	for (let i = 0; i < n; i++)
		if (perps[i] <= gapKm + slackKm) along = Math.min(along, ts[i]);
	return { along, gapKm };
}

/** The plume set for one hull: the object the renderer places, and the step
 *  that draws a firing table into it. */
export interface VentPlumes {
	object: THREE.Points;
	throats: readonly Throat[];
	/** Draw `firing` at game time `t`. Returns how many throats are lit. */
	update(firing: VentLevels, t: number): number;
}

/** Points per throat: its glow, then its particles. */
const PER_THROAT = 1 + PLUME_PARTICLES;

/** The throat glow's size against the throat's reach. */
const GLOW_SIZE = 0.55;
/** A puff's size at birth and at the end of its life, against the reach. */
const PUFF_SIZE_BIRTH = 0.25;
const PUFF_SIZE_DEATH = 0.7;

let plumeMaterial: THREE.ShaderMaterial | undefined;

/**
 * One shared material. A point's size is in **kilometres** — a plume scales
 * with the hull that throws it — and becomes pixels through the projection,
 * with a floor so a far hull's firing is still a spark and a ceiling so a
 * near one is not a wash. `uPixelsPerKm` is the projection's scale at unit
 * distance in the target being drawn, written in `onBeforeRender` for the
 * reason `navLightsMaterial` gives: this module has no renderer.
 */
function material(): THREE.ShaderMaterial {
	if (plumeMaterial) return plumeMaterial;
	plumeMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uPixelsPerKm: { value: 1 },
			uPixelRatio: { value: 1 },
		},
		vertexShader: `
			attribute float sizeKm;
			attribute vec3 heat;
			uniform float uPixelsPerKm;
			uniform float uPixelRatio;
			varying vec3 vHeat;
			void main() {
				vHeat = heat;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				float dist = max(-mv.z, 1e-6);
				gl_PointSize = clamp(sizeKm * uPixelsPerKm / dist, 1.5 * uPixelRatio, 96.0 * uPixelRatio);
				gl_Position = projectionMatrix * mv;
			}
		`,
		fragmentShader: `
			varying vec3 vHeat;
			void main() {
				float r = min(length(gl_PointCoord - 0.5) * 2.0, 1.0);
				float soft = (1.0 - r) * (1.0 - r);
				if (soft <= 0.0 || dot(vHeat, vHeat) <= 0.0) discard;
				gl_FragColor = vec4(vHeat * soft, 1.0);
			}
		`,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	plumeMaterial.name = "vent-plumes";
	return plumeMaterial;
}

/** Build the plume set for a hull whose root `buildShipMesh` just returned. */
export function buildVentPlumes(root: THREE.Object3D, id: HullId): VentPlumes {
	const throats = ventThroats(root, id);
	const count = throats.length * PER_THROAT;
	const positions = new Float32Array(count * 3);
	const sizes = new Float32Array(count);
	const heats = new Float32Array(count * 3);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("sizeKm", new THREE.BufferAttribute(sizes, 1));
	geometry.setAttribute("heat", new THREE.BufferAttribute(heats, 3));
	// The points move every frame; a stale sphere would cull a lit plume.
	geometry.boundingSphere = new THREE.Sphere(
		new THREE.Vector3(),
		HULL_SPECS[id].env.lengthKm * 2,
	);
	const points = new THREE.Points(geometry, material());
	points.name = "vent-plumes";
	points.frustumCulled = false;
	points.castShadow = false;
	points.receiveShadow = false;
	points.userData.plumesOf = id;
	const target = new THREE.Vector2();
	points.onBeforeRender = (renderer, _scene, camera) => {
		const rt = renderer.getRenderTarget();
		const height = rt ? rt.height : renderer.getDrawingBufferSize(target).y;
		const m = material();
		m.uniforms.uPixelsPerKm.value =
			((camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] *
				height) /
			2;
		m.uniforms.uPixelRatio.value = renderer.getPixelRatio();
	};

	// A basis across each exhaust, once.
	const across = throats.map((throat) => {
		const helper =
			Math.abs(throat.exhaust.y) < 0.9
				? new THREE.Vector3(0, 1, 0)
				: new THREE.Vector3(1, 0, 0);
		const u = new THREE.Vector3()
			.crossVectors(throat.exhaust, helper)
			.normalize();
		const w = new THREE.Vector3().crossVectors(throat.exhaust, u).normalize();
		return [u, w] as const;
	});
	const colour = new THREE.Color();
	/** The ramp at `v`, linear and scaled by `k`, written into `heats` at `i`. */
	const writeHeat = (i: number, v: number, k: number) => {
		const [r, g, b] = exhaustRamp(v);
		colour.setRGB(r, g, b, THREE.SRGBColorSpace);
		heats[i] = colour.r * k;
		heats[i + 1] = colour.g * k;
		heats[i + 2] = colour.b * k;
	};
	const at = new THREE.Vector3();
	let litBefore = -1;

	const update = (firing: VentLevels, t: number): number => {
		const lit = throats.filter((th) => (firing[th.slot] ?? 0) > 0).length;
		// Nothing firing now or last time: the buffers already say so.
		if (lit === 0 && litBefore === 0) return 0;
		litBefore = lit;
		throats.forEach((throat, n) => {
			const level = Math.max(0, Math.min(1, firing[throat.slot] ?? 0));
			const base = n * PER_THROAT;
			const [u, w] = across[n];
			// The glow at the throat: the vent's own heat, steady while it fires.
			throat.at.toArray(positions, base * 3);
			sizes[base] = GLOW_SIZE * throat.reachKm * Math.sqrt(level);
			writeHeat(base * 3, 0, PLUME_PEAK * level);
			for (let i = 0; i < PLUME_PARTICLES; i++) {
				const p = plumeParticle(
					i,
					n + 1,
					t,
					PLUME_LIFE_S[throat.family],
					level,
				);
				const k = (base + 1 + i) * 3;
				at.copy(throat.at)
					.addScaledVector(throat.exhaust, throat.reachKm * p.along)
					.addScaledVector(u, throat.reachKm * p.across[0])
					.addScaledVector(w, throat.reachKm * p.across[1])
					.toArray(positions, k);
				sizes[base + 1 + i] =
					throat.reachKm *
					(PUFF_SIZE_BIRTH + (PUFF_SIZE_DEATH - PUFF_SIZE_BIRTH) * p.age);
				writeHeat(k, p.age, PLUME_PEAK * p.strength);
			}
		});
		for (const name of ["position", "sizeKm", "heat"])
			(geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
		points.userData.lit = lit;
		return lit;
	};
	update({}, 0);
	return { object: points, throats, update };
}
