/**
 * The field rocks' shapes, as the browser gets them (node #968).
 *
 * Two sources of the same thing — sixteen archetypes of three levels each,
 * every level scaled so that no vertex lies outside the unit sphere (#948 D5):
 *
 * - **authored** (#953): `asteroids.glb`, fetched, hashed against the collision
 *   data's recorded source (#966), decoded, and flattened to bare geometries
 *   plus one Lambert material. Loaded after boot through the session model
 *   queue under the id `asteroids`.
 * - **stand-in** (#950's batch-k, K = 16): displaced icospheres at detail
 *   6/3/1 with a plain-fill material, drawn when the load fails. It is built
 *   only on that path, in slices, and never carries `ROCK_SURFACE` (#918 Q1).
 *
 * Nothing here touches a renderer or a scene, so the work is plain main-thread
 * CPU and runs in slices the caller yields between.
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { shared } from "./gpu-teardown";
import { ROCK_ARCHETYPES } from "./field-lod";
import type { ModelProgressListener } from "./model-progress";
import { ASTEROIDS_GLB_URL } from "./model-urls";
import { SimplexNoise } from "./noise";
import { assertRockSource } from "./rock-heightfields";
import { ROCK_ASSETS } from "./rock-assets";
import { displayRand } from "./station-surface";

const TAU = Math.PI * 2;

export interface RockShapes {
	/** `levels[archetype][level]`, level 0 the finest. */
	levels: THREE.BufferGeometry[][];
	material: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
	/** Textures the material samples, for a warm upload before first draw. */
	textures: THREE.Texture[];
}

let authored: RockShapes | undefined;
let loading: Promise<void> | undefined;

/** The installed authored shapes, or `undefined` until the load has finished. */
export const authoredRockShapes = (): RockShapes | undefined => authored;

const hex = (bytes: ArrayBuffer): string =>
	Array.from(new Uint8Array(bytes), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

/**
 * Fetch, verify, decode and flatten the authored rocks. A failure clears the
 * memo, so the Retry panel's next attempt fetches again; the queue keeps the
 * procedural stand-in meanwhile.
 */
export function prepareAsteroidModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (loading ??= (async () => {
		const bytes = await new THREE.FileLoader()
			.setResponseType("arraybuffer")
			.loadAsync(ASTEROIDS_GLB_URL, onProgress);
		// The collision heightfields were built from one exact GLB (#966);
		// hashing the received bytes before parsing makes a mismatched pair a
		// load failure rather than rocks that look right and collide wrong.
		if (globalThis.crypto?.subtle)
			assertRockSource(
				ROCK_ASSETS.heightfields,
				hex(
					await globalThis.crypto.subtle.digest(
						"SHA-256",
						bytes as ArrayBuffer,
					),
				),
			);
		const gltf = await new GLTFLoader().parseAsync(bytes as ArrayBuffer, "");
		authored = flattenAuthoredRocks(gltf.scene);
	})().catch((error) => {
		loading = undefined;
		throw error;
	}));
}

/**
 * The GLB's meshes as per-level geometries in unit-bound space, with the one
 * shared material turned to Lambert (#953: the cheaper of the two accepted
 * shadings, with the viewer's exposure, colour and normal-map settings).
 */
export function flattenAuthoredRocks(scene: THREE.Object3D): RockShapes {
	scene.updateMatrixWorld(true);
	const levels: THREE.BufferGeometry[][] = [];
	let source: THREE.MeshStandardMaterial | undefined;
	scene.traverse((o) => {
		if (!(o as THREE.Mesh).isMesh) return;
		const mesh = o as THREE.Mesh;
		const match = /^rock_(\d+)_.*_L([012])$/.exec(mesh.name);
		if (!match) throw new Error(`Unrecognised rock mesh ${mesh.name}`);
		const archetype = Number(match[1]);
		const level = Number(match[2]);
		const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
		// A BatchedMesh needs the same attribute set for every geometry.
		for (const name of Object.keys(g.attributes))
			if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
		g.computeBoundingSphere();
		(levels[archetype] ??= [])[level] = g;
		source = mesh.material as THREE.MeshStandardMaterial;
	});
	if (
		!source ||
		levels.length !== ROCK_ARCHETYPES ||
		levels.some((l) => !l || l.length !== 3 || l.some((g) => !g))
	)
		throw new Error("Incomplete rock asset");
	const colour = new THREE.Color().setRGB(2.3, 2.3, 2.3);
	if (source.map) source.map.anisotropy = 4;
	if (source.normalMap) source.normalMap.anisotropy = 4;
	const lambert = new THREE.MeshLambertMaterial({ color: colour });
	lambert.map = source.map;
	lambert.normalMap = source.normalMap;
	lambert.normalScale.set(0.55, 0.55);
	const material = shared(lambert);
	const textures = [source.map, source.normalMap].filter(
		(t): t is THREE.Texture => !!t,
	);
	for (const t of textures) shared(t);
	for (const row of levels) for (const g of row) shared(g);
	return { levels, material, textures };
}

/** Icosahedron detail per stand-in level: 980 / 320 / 80 triangles. */
export const STANDIN_DETAIL = [6, 3, 1] as const;

/** The station asteroid's displacement on a unit sphere (`buildAsteroid`'s
 *  recipe, which is fixed at detail 4 there), without the docking pad cut. */
function displaced(detail: number, tag: string): THREE.BufferGeometry {
	const g0 = new THREE.IcosahedronGeometry(1, detail);
	g0.deleteAttribute("normal");
	g0.deleteAttribute("uv");
	const geometry = mergeVertices(g0);
	const noise = new SimplexNoise(
		[...tag].reduce(
			(h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193),
			0x811c9dc5,
		) >>> 0,
	);
	const rand = displayRand(`${tag}-craters`);
	const craters = Array.from({ length: 6 }, () => {
		const z = rand() * 2 - 1;
		const theta = rand() * TAU;
		const planar = Math.sqrt(Math.max(0, 1 - z * z));
		return {
			dir: new THREE.Vector3(
				planar * Math.cos(theta),
				planar * Math.sin(theta),
				z,
			),
			cos: Math.cos(0.22 + rand() * 0.3),
			depth: 0.06 + rand() * 0.1,
		};
	});
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const v = new THREE.Vector3();
	for (let i = 0; i < position.count; i++) {
		v.fromBufferAttribute(position, i).normalize();
		const field = (f: number) =>
			noise.noise2D(v.x * f, v.y * f) +
			noise.noise2D(v.y * f, v.z * f) +
			noise.noise2D(v.z * f, v.x * f);
		let scale =
			1 + field(1.1) * 0.085 + field(2.7) * 0.042 + field(6.3) * 0.018;
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

/** One archetype's three levels, scaled together so the largest vertex of any
 *  level is exactly the unit bound (#950 D8: the station rock overshoots). */
export function standInShape(archetype: number): THREE.BufferGeometry[] {
	const levels = STANDIN_DETAIL.map((d) => displaced(d, `arch-${archetype}`));
	let max = 0;
	for (const g of levels) {
		const p = g.getAttribute("position");
		for (let i = 0; i < p.count; i++)
			max = Math.max(max, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
	}
	for (const g of levels) {
		g.scale(1 / max, 1 / max, 1 / max);
		g.computeVertexNormals();
		g.computeBoundingSphere();
		shared(g);
	}
	return levels;
}

let standIn: RockShapes | undefined;
export const standInRockShapes = (): RockShapes | undefined => standIn;

/**
 * The failed-load stand-in: K = 16 plain-fill rocks, one archetype per slice
 * so the caller can yield between them. Resolves to the memoised result when
 * a field built earlier already paid for it.
 */
export function* buildStandInRocks(): Generator<void, RockShapes> {
	if (standIn) return standIn;
	const levels: THREE.BufferGeometry[][] = [];
	for (let a = 0; a < ROCK_ARCHETYPES; a++) {
		levels.push(standInShape(a));
		yield;
	}
	standIn = {
		levels,
		material: shared(
			new THREE.MeshStandardMaterial({
				color: 0x9a8a72,
				roughness: 0.95,
				metalness: 0.02,
			}),
		),
		textures: [],
	};
	return standIn;
}
