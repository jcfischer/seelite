/**
 * The shipyards' baked work lights on the ships inside them (node #818,
 * principal 2026-10-12: a hull "looks very flat in the shipyard"). The bake
 * that lights a yard's surfaces also samples its lamps on a grid through the
 * yard, with the yard's own occlusion (`build_model.py`, `bake_probes`): per
 * point an ambient colour and one colour per axis, E(n) = a + n·(X, Y, Z).
 * A ship inside a grid reads it at its position, and its materials add it to
 * their indirect diffuse light, as the yard's lightmap adds to the yard's.
 *
 * The term is per ship, and three uploads a built-in material's uniforms only
 * when the material changes between draws — so a ship entering a grid gets its
 * own patched copies of its materials, freed with it (the copies drop the
 * `shared` mark). Each mesh sets the term before it draws (`onBeforeRender`),
 * with the grid's axes turned into view space there.
 */
import * as THREE from "three";

export interface ProbeGrid {
	/** The grid's first point and step, metres in the yard's frame. */
	origin: THREE.Vector3;
	step: number;
	size: readonly [number, number, number];
	/** Twelve floats a point: a, X, Y, Z as RGB, x fastest, then y, z. */
	data: Float32Array;
}

/** What a yard's root carries for this (`shipyard-flight.ts` sets it). */
export interface YardWorkLight {
	grid: ProbeGrid;
	/** The node whose frame the grid is stated in. */
	frame: THREE.Object3D;
	/** The gain to draw the term at, 0 when the yard is not lit by its bake. */
	gain(): number;
}

/** Twelve floats at `p` (metres, grid frame), blended between the eight
 *  nearest points; false outside the grid. */
export function sampleProbeGrid(
	grid: ProbeGrid,
	p: THREE.Vector3,
	out: Float32Array,
): boolean {
	const [nx, ny, nz] = grid.size;
	const fx = (p.x - grid.origin.x) / grid.step;
	const fy = (p.y - grid.origin.y) / grid.step;
	const fz = (p.z - grid.origin.z) / grid.step;
	if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1)
		return false;
	const i = Math.min(Math.floor(fx), nx - 2);
	const j = Math.min(Math.floor(fy), ny - 2);
	const k = Math.min(Math.floor(fz), nz - 2);
	const tx = fx - i;
	const ty = fy - j;
	const tz = fz - k;
	out.fill(0);
	for (let c = 0; c < 8; c++) {
		const di = c & 1;
		const dj = (c >> 1) & 1;
		const dk = (c >> 2) & 1;
		const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
		if (w === 0) continue;
		const base = (((k + dk) * ny + (j + dj)) * nx + (i + di)) * 12;
		for (let n = 0; n < 12; n++) out[n] += w * grid.data[base + n];
	}
	return true;
}

interface Lit {
	/** Grid frame coefficients for this ship, and the frame they are in. */
	coeffs: Float32Array;
	frame: THREE.Object3D | null;
	gain: number;
}

const patched = new WeakSet<THREE.Material>();
const uniformsOf = new WeakMap<THREE.Material, { value: THREE.Vector3[] }>();
const zero = new Float32Array(12);

function patchMaterial(m: THREE.Material): void {
	if (patched.has(m) || !(m instanceof THREE.MeshStandardMaterial)) return;
	patched.add(m);
	const uniform = {
		value: [
			new THREE.Vector3(),
			new THREE.Vector3(),
			new THREE.Vector3(),
			new THREE.Vector3(),
		],
	};
	uniformsOf.set(m, uniform);
	const previous = m.onBeforeCompile;
	const previousKey = m.customProgramCacheKey;
	m.onBeforeCompile = (shader, renderer) => {
		previous.call(m, shader, renderer);
		shader.uniforms.workLight = uniform;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform vec3 workLight[4];",
			)
			.replace(
				"#include <lights_fragment_maps>",
				"#include <lights_fragment_maps>\n" +
					"irradiance += max(vec3(0.0), workLight[0] + normal.x * workLight[1] + normal.y * workLight[2] + normal.z * workLight[3]);",
			);
	};
	m.customProgramCacheKey = () => `${previousKey.call(m)}|work-light`;
	m.needsUpdate = true;
}

const view = new THREE.Matrix4();
const basis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

/** The ship's own copy of `m`, patched; one copy per original per ship. */
function ownCopy(
	m: THREE.Material,
	copies: Map<THREE.Material, THREE.Material>,
): THREE.Material {
	if (!(m instanceof THREE.MeshStandardMaterial)) return m;
	let copy = copies.get(m);
	if (!copy) {
		copy = m.clone();
		delete copy.userData.sharedAcrossSystems;
		patchMaterial(copy);
		copies.set(m, copy);
	}
	return copy;
}

function install(
	mesh: THREE.Mesh,
	copies: Map<THREE.Material, THREE.Material>,
): void {
	if (mesh.userData.workLightInstalled) return;
	mesh.userData.workLightInstalled = true;
	mesh.material = Array.isArray(mesh.material)
		? mesh.material.map((m) => ownCopy(m, copies))
		: ownCopy(mesh.material, copies);
	const previous = mesh.onBeforeRender;
	mesh.onBeforeRender = function (
		renderer,
		scene,
		camera,
		geometry,
		material,
		group,
	) {
		previous.call(this, renderer, scene, camera, geometry, material, group);
		const uniform = uniformsOf.get(material);
		if (!uniform) return;
		const lit = findLit(this);
		const c = lit && lit.frame && lit.gain > 0 ? lit.coeffs : zero;
		const g = lit?.gain ?? 0;
		uniform.value[0].set(c[0] * g, c[1] * g, c[2] * g);
		if (lit?.frame && g > 0) {
			// Grid axes into view space: the frame's rotation, then the camera's.
			view.multiplyMatrices(camera.matrixWorldInverse, lit.frame.matrixWorld);
			view.extractBasis(basis[0], basis[1], basis[2]);
			for (const b of basis) b.normalize();
			// D_j = Σ_k M_jk C_k, M_jk the grid axis k's view component j.
			for (let j = 0; j < 3; j++) {
				const d = uniform.value[j + 1].set(0, 0, 0);
				for (let k = 0; k < 3; k++) {
					const m = basis[k].getComponent(j);
					d.x += m * c[3 + k * 3] * g;
					d.y += m * c[4 + k * 3] * g;
					d.z += m * c[5 + k * 3] * g;
				}
			}
		} else for (let j = 1; j < 4; j++) uniform.value[j].set(0, 0, 0);
	};
}

function findLit(o: THREE.Object3D | null): Lit | undefined {
	for (let p = o; p; p = p.parent)
		if (p.userData.workLit) return p.userData.workLit as Lit;
	return undefined;
}

const at = new THREE.Vector3();
const local = new THREE.Vector3();
const toFrame = new WeakMap<YardWorkLight, THREE.Matrix4>();
/**
 * Once a frame: give each ship the work light of the yard it is in, if any.
 * A ship is patched the first time it enters a grid and stays patched; one
 * outside every grid draws the term as zero.
 */
export function lightShipsByWorkLights(
	yards: readonly YardWorkLight[],
	...shipGroups: Iterable<THREE.Object3D>[]
): void {
	// Each yard's frame inverted once a frame, not once per ship.
	for (const yard of yards) {
		yard.frame.updateWorldMatrix(true, false);
		let inverse = toFrame.get(yard);
		if (!inverse) toFrame.set(yard, (inverse = new THREE.Matrix4()));
		inverse.copy(yard.frame.matrixWorld).invert();
	}
	for (const ships of shipGroups)
		for (const ship of ships) lightShip(ship, yards);
}

function lightShip(
	ship: THREE.Object3D,
	yards: readonly YardWorkLight[],
): void {
	{
		const lit: Lit = (ship.userData.workLit ??= {
			coeffs: new Float32Array(12),
			frame: null,
			gain: 0,
		});
		lit.frame = null;
		lit.gain = 0;
		ship.getWorldPosition(at);
		for (const yard of yards) {
			const inverse = toFrame.get(yard);
			if (!inverse) continue;
			local.copy(at).applyMatrix4(inverse);
			if (!sampleProbeGrid(yard.grid, local, lit.coeffs)) continue;
			lit.frame = yard.frame;
			lit.gain = yard.gain();
			const copies = (ship.userData.workLightCopies ??= new Map<
				THREE.Material,
				THREE.Material
			>());
			ship.traverse((o) => {
				if (o instanceof THREE.Mesh) install(o, copies);
			});
			break;
		}
	}
}
