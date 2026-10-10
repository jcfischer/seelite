/**
 * The Three.js half of #201: reading a material's facts off a built subtree,
 * writing the two shadow flags onto it, and measuring the sphere the shadow
 * camera is fitted to.
 *
 * `occlusion.ts` is the pure half and owns the rule and the arithmetic. This
 * module owns exactly two things that need three in the room: **which class a
 * material is**, and **where a subtree is and how big**.
 */
import * as THREE from "three";
import {
	type ShadowSubject,
	type SurfaceFacts,
	participatesInShadow,
} from "./occlusion";

/**
 * Which material classes three actually lights.
 *
 * A list of flags rather than `instanceof`, because three's own materials carry
 * `isMeshStandardMaterial` and friends and a bundler can put two copies of the
 * class in one build. Basic, shader, depth, normal, matcap, sprite and point
 * materials are all absent from it on purpose: nothing lights them, so a
 * shadow on one is a dark patch on something that is its own light source.
 */
const LIT_FLAGS = [
	"isMeshStandardMaterial",
	"isMeshPhysicalMaterial",
	"isMeshLambertMaterial",
	"isMeshPhongMaterial",
	"isMeshToonMaterial",
] as const;

const isLit = (material: THREE.Material): boolean =>
	LIT_FLAGS.some(
		(flag) => (material as unknown as Record<string, unknown>)[flag] === true,
	);

/**
 * What `participatesInShadow` reads, extracted from a mesh.
 *
 * **Every material on the mesh, and the strictest answer wins.** Geometry
 * groups are how a plated form carries a lit sign on one of its faces, and
 * `castShadow` is a flag on the object rather than on the group — so a mesh
 * with one unlit material in it is out. Being conservative in that direction
 * costs a shadow nobody would have seen; the other direction puts a shadow on
 * a lamp.
 */
export function surfaceFactsOf(mesh: THREE.Mesh): SurfaceFacts {
	const materials = Array.isArray(mesh.material)
		? mesh.material
		: [mesh.material];
	return {
		lit: materials.length > 0 && materials.every(isLit),
		transparent: materials.some((m) => m.transparent),
		opacity: materials.reduce((least, m) => Math.min(least, m.opacity), 1),
	};
}

/** What one walk did, so a caller can refuse a walk that matched nothing. */
export type OcclusionMarking = {
	readonly participating: number;
	readonly excluded: number;
};

/**
 * Set `castShadow` and `receiveShadow` across a built subtree, by the rule.
 *
 * Called once per built thing — the hull, the cabin, each station — rather than
 * per frame: these subtrees are built once and their materials do not change
 * class afterwards.
 *
 * The counts are returned rather than logged because of the failure this walk
 * has: a rule that matches nothing leaves every flag `false`, the frame renders
 * perfectly, and the only symptom is that the feature is missing. A caller that
 * asserts on the count catches that; a caller that ignores it does not, which
 * is why `tests/occlusion-mesh.test.ts` asserts on both halves.
 */
export function markOcclusion(root: THREE.Object3D): OcclusionMarking {
	let participating = 0;
	let excluded = 0;
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		const takesPart = participatesInShadow(surfaceFactsOf(mesh));
		mesh.castShadow = takesPart;
		mesh.receiveShadow = takesPart;
		if (takesPart) participating++;
		else excluded++;
	});
	return { participating, excluded };
}

/** Where the cached local sphere is kept. Named on `userData` rather than held
 *  in a `WeakMap` here so a probe can read it off the page. */
const BOUNDS_KEY = "occlusionBounds";

/** An authored install changes the subtree measured by subjectOf. */
export function invalidateOcclusionBounds(root: THREE.Object3D): void {
	delete root.userData[BOUNDS_KEY];
}

const scratch = new THREE.Box3();

/**
 * The subtree's bounding sphere in **world** units — which in the near layer
 * are kilometres relative to the camera, so this is what `shadowFit` takes.
 *
 * **The local bounds are measured once and cached**, and everything after that
 * is a matrix applied to a sphere. A fresh `Box3.setFromObject` per frame over
 * a station of a few thousand meshes is the whole budget this node is priced
 * against; these subtrees are rigid, so measuring them again would buy nothing
 * for it. The consequence is stated rather than hidden: a subtree whose parts
 * *move* — none does today — would report the bounds it was built with.
 *
 * `Sphere.applyMatrix4` takes the largest of the matrix's three scales, so a
 * station mesh scaled by `radiusKm` at layer time reports a subject at the size
 * it is drawn, which is the unit trap `CLAUDE.md` names.
 */
export function subjectOf(root: THREE.Object3D): ShadowSubject {
	// **This object's own world matrix, brought up to date, and nothing else's.**
	// The caller is `main.ts`'s render loop, which has just written a position
	// and a quaternion onto these roots; three would not fold those into
	// `matrixWorld` until the first `RenderPass` runs, which is after the shadow
	// camera has been fitted. A subject one frame behind puts the shadow box
	// where the ship *was*, which at cruise speeds is nowhere near it.
	// `updateWorldMatrix(true, false)` walks the ancestors and stops — the
	// children are only needed on the measuring pass below, which does its own.
	root.updateWorldMatrix(true, false);
	let local = root.userData[BOUNDS_KEY] as THREE.Sphere | undefined;
	if (!local) {
		// Measured in the root's own frame: its matrix is applied below, so
		// including it here would apply it twice.
		const keptMatrix = root.matrixWorld.clone();
		root.matrixWorld.identity();
		const keptAuto = root.matrixWorldAutoUpdate;
		root.matrixWorldAutoUpdate = false;
		for (const child of root.children) child.updateMatrixWorld(true);
		scratch.setFromObject(root);
		local = scratch.isEmpty()
			? new THREE.Sphere(new THREE.Vector3(), 0)
			: scratch.getBoundingSphere(new THREE.Sphere());
		root.matrixWorld.copy(keptMatrix);
		root.matrixWorldAutoUpdate = keptAuto;
		for (const child of root.children) child.updateMatrixWorld(true);
		root.userData[BOUNDS_KEY] = local;
	}
	const world = local.clone().applyMatrix4(root.matrixWorld);
	return {
		center: [world.center.x, world.center.y, world.center.z],
		radiusKm: world.radius,
	};
}

/**
 * Hide everything the ambient-occlusion pass must not see, remembering what it
 * found — three's `GTAOPass.overrideVisibility`, with one clause added.
 *
 * **The clause is the whole point, and it is a defect that shipped for a
 * round.** `GTAOPass` renders its own normal-and-depth buffer over everything
 * visible in the scene, using `MeshNormalMaterial` — which writes depth even
 * for a material that does not. The cabin's canopy is `depthWrite: false`, so
 * it writes nothing in the beauty pass and everything in the AO buffer: it
 * covers the whole forward view, so the occlusion computed for a sheet of glass
 * was applied to the sky behind it. Measured across four framings, same build,
 * AO on against off: **2.8% of `sky-only`'s background moved, by up to 77 of
 * 255**, and 3.2% of `planet-terminator`'s — against 0.000% in both chase
 * framings, where the cabin is hidden and there is no canopy in the scene.
 *
 * The rule it adds is the shadow's own, read a second time: **a surface that
 * casts no shadow occludes nothing either.** That is one predicate serving both
 * passes rather than a second list, and it also keeps the AO off the near
 * layer's planets — which are `ShaderMaterial` and so were never marked — which
 * is what #201 asks for in as many words.
 *
 * Points and lines are hidden for three's own reason, kept here because this
 * replaces its method rather than wrapping it: neither has a surface, so
 * neither has a normal for the buffer.
 */
export function hideNonOccluders(
	scene: THREE.Object3D,
	cache: Map<THREE.Object3D, boolean>,
): void {
	scene.traverse((object) => {
		cache.set(object, object.visible);
		const drawn = object as THREE.Mesh & {
			isPoints?: boolean;
			isLine?: boolean;
		};
		if (drawn.isPoints || drawn.isLine) object.visible = false;
		else if (drawn.isMesh && !drawn.castShadow) object.visible = false;
	});
}

/** Put back exactly what `hideNonOccluders` found — including a mesh that was
 *  already hidden for its own reasons, which is every ship in cockpit view and
 *  every station accessory its detail level has switched off. */
export function restoreVisibility(cache: Map<THREE.Object3D, boolean>): void {
	for (const [object, visible] of cache) object.visible = visible;
	cache.clear();
}
