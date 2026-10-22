/**
 * Node #947: reduced copies of an authored shipyard, for the policy
 * measurement. Not shipped: https://github.com/jcfischer/seelite/issues/947
 * Simplifies on the unwelded index with normals, uv and uv1 as weighted
 * attributes, so a kept corner keeps its own lightmap coordinate.
 */
import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { shared } from "../../src/gpu-teardown";

/** The weights the simplifier is given for the attributes a corner carries. */
export const LEVEL_ATTRIBUTE_WEIGHTS = {
	normal: 0.5,
	uv: 1,
	uv1: 1,
} as const;

function simplifierInput(source: THREE.BufferGeometry) {
	const position = source.getAttribute("position");
	const normal = source.getAttribute("normal");
	const uv = source.getAttribute("uv");
	const uv1 = source.getAttribute("uv1");
	const stride = 3 + 2 + (uv1 ? 2 : 0);
	const positions = new Float32Array(position.count * 3);
	const attributes = new Float32Array(position.count * stride);
	for (let i = 0; i < position.count; i++) {
		positions[3 * i] = position.getX(i);
		positions[3 * i + 1] = position.getY(i);
		positions[3 * i + 2] = position.getZ(i);
		attributes[stride * i] = normal.getX(i);
		attributes[stride * i + 1] = normal.getY(i);
		attributes[stride * i + 2] = normal.getZ(i);
		attributes[stride * i + 3] = uv ? uv.getX(i) : 0;
		attributes[stride * i + 4] = uv ? uv.getY(i) : 0;
		if (uv1) {
			attributes[stride * i + 5] = uv1.getX(i);
			attributes[stride * i + 6] = uv1.getY(i);
		}
	}
	const index = source.getIndex();
	const count = index ? index.count : position.count;
	const indices = new Uint32Array(count);
	for (let i = 0; i < count; i++) indices[i] = index ? index.getX(i) : i;
	const weights = [
		LEVEL_ATTRIBUTE_WEIGHTS.normal,
		LEVEL_ATTRIBUTE_WEIGHTS.normal,
		LEVEL_ATTRIBUTE_WEIGHTS.normal,
		LEVEL_ATTRIBUTE_WEIGHTS.uv,
		LEVEL_ATTRIBUTE_WEIGHTS.uv,
		...(uv1 ? [LEVEL_ATTRIBUTE_WEIGHTS.uv1, LEVEL_ATTRIBUTE_WEIGHTS.uv1] : []),
	];
	return { positions, attributes, stride, indices, weights };
}

/** One mesh's geometry with edges collapsed while the simplifier's error
 *  stays under `errorM` (the mesh's own units). `null` when nothing survives.
 *  The vertex buffers are the model's, shared and unchanged: only the index
 *  is new, so `uv1` and the normals of a kept corner are exactly the
 *  model's. */
export function reducedYardGeometry(
	source: THREE.BufferGeometry,
	errorM: number,
): { geometry: THREE.BufferGeometry | null; errorM: number } {
	const { positions, attributes, stride, indices, weights } =
		simplifierInput(source);
	const [kept, reached] = MeshoptSimplifier.simplifyWithAttributes(
		indices,
		positions,
		3,
		attributes,
		stride,
		weights,
		null,
		0,
		errorM,
		["ErrorAbsolute", "Prune"],
	);
	if (kept.length === 0) return { geometry: null, errorM: reached };
	const reduced = new THREE.BufferGeometry();
	for (const [name, attribute] of Object.entries(source.attributes))
		reduced.setAttribute(name, attribute);
	reduced.setIndex(new THREE.BufferAttribute(kept, 1));
	return { geometry: reduced, errorM: reached };
}

/** Where a level records the largest error its meshes reached, in the units
 *  of the template (metres): the simplifier's own metric, a record of what
 *  the level was made to and not a measurement of how far it lies from the
 *  model. */
export const YARD_LEVEL_REACHED_ERROR_M = "yardLevelReachedErrorM";

/** The template reduced to `errorM` (template units, metres), one mesh per
 *  step so a background install can yield between them. A mesh with nothing
 *  left is not drawn; its children move to a bare node in its place. */
export function* reducedYardSteps(
	template: THREE.Object3D,
	errorM: number,
	name: string,
): Generator<void, THREE.Object3D> {
	const level = template.clone(true);
	level.name = name;
	level.updateMatrixWorld(true);
	const toLevel = level.matrixWorld.clone().invert();
	const meshes: THREE.Mesh[] = [];
	level.traverse((o) => {
		if (o instanceof THREE.Mesh) meshes.push(o);
	});
	let reachedM = 0;
	const scale = new THREE.Vector3();
	for (const mesh of meshes) {
		new THREE.Matrix4()
			.multiplyMatrices(toLevel, mesh.matrixWorld)
			.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
		const stretch = Math.max(
			Math.abs(scale.x),
			Math.abs(scale.y),
			Math.abs(scale.z),
		);
		const reduced = reducedYardGeometry(mesh.geometry, errorM / stretch);
		reachedM = Math.max(reachedM, reduced.errorM * stretch);
		let stand: THREE.Object3D | null = null;
		if (reduced.geometry) {
			const drawn = new THREE.Mesh(shared(reduced.geometry), mesh.material);
			drawn.castShadow = mesh.castShadow;
			drawn.receiveShadow = mesh.receiveShadow;
			stand = drawn;
		} else if (mesh.children.length > 0) stand = new THREE.Object3D();
		if (stand) {
			stand.name = mesh.name;
			stand.position.copy(mesh.position);
			stand.quaternion.copy(mesh.quaternion);
			stand.scale.copy(mesh.scale);
			stand.userData = { ...mesh.userData };
			for (const child of [...mesh.children]) stand.add(child);
			mesh.parent?.add(stand);
		}
		mesh.removeFromParent();
		yield;
	}
	level.userData[YARD_LEVEL_REACHED_ERROR_M] = reachedM;
	return level;
}

/** The template reduced to `errorM` in one task. */
export function reducedYard(
	template: THREE.Object3D,
	errorM: number,
	name: string,
): THREE.Object3D {
	const work = reducedYardSteps(template, errorM, name);
	let step = work.next();
	while (!step.done) step = work.next();
	return step.value;
}
