/**
 * Freeing a system's GPU resources when the ship jumps out of it (#187).
 *
 * ## The problem this is shaped by
 *
 * `buildBodies` ran exactly once, at construction, because there was no path
 * that changed the system a game is in. `planet-surface.ts`'s `dispose()` says
 * so in its own docstring, and adds the sentence this module exists to answer:
 * *whether it frees what it names is not asserted anywhere, because nothing
 * here reads GPU allocations back*. A jump makes the renderer build a second
 * system, and a third, and a fortieth.
 *
 * Nothing in a headless test — and nothing in a browser probe either, without
 * an extension — can ask the driver how many bytes are live. What **is**
 * checkable is the two failures that actually happen:
 *
 * 1. a resource the teardown owns is not freed, and
 * 2. a resource the teardown does **not** own is freed, out from under the
 *    system that is still using it.
 *
 * The second is the worse one and the easier one to write by accident: this
 * repo shares its expensive things deliberately — one plate texture per station
 * *type*, one hull material per (type, colour), one unit sphere for every body
 * in the game — and a teardown that walked a subtree and disposed everything it
 * found would take the trade station's plating away from the *next* system's
 * trade station. That does not throw. It renders black.
 *
 * ## So sharing is declared, not inferred
 *
 * `shared()` marks a geometry, material or texture as outliving any one system.
 * `disposeSubtree` frees everything else it can reach and **reports exactly
 * what it freed**, so `tests/gpu-teardown.test.ts` can assert the freed set is
 * disjoint from what a second, still-live subtree is holding — which is the
 * check that goes red the day a new shared resource is added without the mark.
 *
 * The mark rides in `userData`, which `BufferGeometry`, `Material` and
 * `Texture` all carry. It is a declaration by the module that built the thing,
 * at the line that built it, which is the only place that knows.
 */
import * as THREE from "three";

/** Anything with a `dispose` and a `userData` bag — the three THREE classes a
 *  scene subtree can be holding that own GPU memory. */
export type Disposable = THREE.BufferGeometry | THREE.Material | THREE.Texture;

/** The `userData` key. Spelled once. */
const SHARED = "sharedAcrossSystems";

/**
 * Declare that this resource outlives the system that is drawing with it.
 *
 * Returns its argument, so it wraps a construction expression rather than
 * needing a second statement — `const PANE = shared(new THREE.BoxGeometry(…))`.
 * A mark applied somewhere other than the construction is a mark that can be
 * missed by the next thing that constructs one.
 */
export const shared = <T extends Disposable>(resource: T): T => {
	resource.userData[SHARED] = true;
	return resource;
};

export const isShared = (resource: Disposable): boolean =>
	resource.userData?.[SHARED] === true;

/**
 * Every texture a material samples.
 *
 * By enumeration of the material's own properties rather than by a list of map
 * names, because the list of map names is long, version-dependent and exactly
 * the kind of thing that silently stops covering a map the day one is added.
 * `Material.dispose()` does **not** free its maps — `planet-surface.ts` records
 * the star's 128x128 corona as the case that taught this — so they have to be
 * reached separately.
 */
function texturesOf(material: THREE.Material): THREE.Texture[] {
	const out: THREE.Texture[] = [];
	for (const value of Object.values(
		material as unknown as Record<string, unknown>,
	)) {
		if (value instanceof THREE.Texture) out.push(value);
	}
	// A `ShaderMaterial`'s textures hang off uniforms rather than off named
	// properties — every planet surface, shell and ring in the game is one.
	const uniforms = (material as Partial<THREE.ShaderMaterial>).uniforms;
	if (uniforms) {
		for (const uniform of Object.values(uniforms)) {
			if (uniform?.value instanceof THREE.Texture) out.push(uniform.value);
		}
	}
	return out;
}

const materialsOf = (object: THREE.Object3D): THREE.Material[] => {
	const material = (object as Partial<THREE.Mesh>).material;
	if (!material) return [];
	return Array.isArray(material) ? material : [material];
};

/** What a teardown freed, and what it deliberately left alone. */
export interface DisposalReport {
	/** Every resource `dispose()` was called on, each exactly once. */
	freed: Set<Disposable>;
	/** Every resource reached and skipped because it is `shared`. */
	kept: Set<Disposable>;
}

/**
 * Free everything under `root` that this system owns, and nothing that it
 * shares.
 *
 * Each resource is disposed **once** however many meshes reference it: a
 * geometry reached twice is in a `Set` before it is disposed, and disposing a
 * material twice is what `planet-surface.ts`'s loop comment records tripping
 * over. The object is not detached from its parent here — a caller that is
 * rebuilding removes the root, and one that is not should not have called this.
 *
 * `InstancedMesh` gets its own `dispose()` as well, which frees the instance
 * matrix attribute; the geometry it instances is shared and is skipped, so
 * without this the per-station part of a greeble field would survive the
 * teardown.
 */
export function disposeSubtree(root: THREE.Object3D): DisposalReport {
	const freed = new Set<Disposable>();
	const kept = new Set<Disposable>();
	walkResources(
		root,
		(resource) => {
			if (isShared(resource)) {
				kept.add(resource);
				return;
			}
			if (freed.has(resource)) return;
			freed.add(resource);
			resource.dispose();
		},
		// `InstancedMesh.dispose()` frees the instance matrix attribute, which is
		// per-mesh and cannot be shared — so there is nothing for the `shared`
		// rule to decide and it is not a `Disposable` in this module's sense.
		// It rides here rather than inside the walk so `resourcesOf`, which
		// reads a subtree that is still being drawn, has no side effect.
		(object) => {
			if (object instanceof THREE.InstancedMesh) object.dispose();
		},
	);
	return { freed, kept };
}

/**
 * Every GPU resource under `root`, handed to `visit` once per reference.
 *
 * **One traversal, because two would be two definitions of what a resource
 * is.** `disposeSubtree` and `resourcesOf` are a pair — one frees a subtree and
 * the other says what a second subtree is still holding — and the disjointness
 * check in `tests/gpu-teardown.test.ts` only means anything if both are reading
 * the same graph by the same rules. Written out twice that was a claim in a
 * docstring; written once it is the structure.
 *
 * Textures come before the material that samples them, which is the order they
 * have to be freed in for the reason `texturesOf` exists: `Material.dispose()`
 * does not free its maps.
 *
 * `visitObject` is what a caller with per-object work does instead of walking
 * again — `disposeSubtree`'s `InstancedMesh` pass is the one case, and keeping
 * it out of the resource visit is what lets `resourcesOf` read a subtree that
 * is still being drawn without touching it.
 */
function walkResources(
	root: THREE.Object3D,
	visit: (resource: Disposable) => void,
	visitObject?: (object: THREE.Object3D) => void,
) {
	root.traverse((object) => {
		const geometry = (object as Partial<THREE.Mesh>).geometry;
		if (geometry) visit(geometry);
		for (const material of materialsOf(object)) {
			for (const texture of texturesOf(material)) visit(texture);
			visit(material);
		}
		visitObject?.(object);
	});
}

/**
 * Every resource a live subtree is still holding — shared or not.
 *
 * The other half of the disjointness check: a teardown is correct when what it
 * freed from one subtree is disjoint from what a second, still-drawn subtree
 * reaches. It goes through the same `walkResources` as `disposeSubtree` — not
 * "the same rules" restated in a second loop, which is what this was and which
 * would have let the two drift into comparing different sets and calling them
 * one. It is side-effect free: the walk's per-object pass is a caller's, and
 * this caller supplies none.
 */
export function resourcesOf(root: THREE.Object3D): Set<Disposable> {
	const out = new Set<Disposable>();
	walkResources(root, (resource) => out.add(resource));
	return out;
}
