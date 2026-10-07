/**
 * The teardown a jump owes, and the two failures it can actually have (#187).
 *
 * ## Why this is not a leak test
 *
 * Nothing in this repo can read a GPU allocation back — not this tier, and not
 * the browser tier either without an extension. `planet-surface.ts`'s
 * `dispose()` said exactly that for as long as it had no caller. So this does
 * not measure bytes. It measures the two things that go wrong when a renderer
 * that built one system starts building forty:
 *
 * 1. **A resource the system owns is not freed.** Checked by listening for
 *    three.js's own `dispose` event on every resource the walker claims to have
 *    freed — a claim assembled beside the act rather than by it is the
 *    check-that-cannot-fail this repo has shipped before.
 * 2. **A resource the system does not own is freed.** Checked by disjointness
 *    against a second, still-live subtree of the same kind. This is the failure
 *    that does not throw: the shared plating maps, hull materials, greeble
 *    primitives and unit spheres are held by every station and body in the
 *    game, and taking one renders the *next* system's stations black.
 *
 * **Both were built red before they were built green**, and what was broken to
 * do it is written here rather than pointed at, because a pointer to a review
 * thread is not a record a later reader can open. Unmarking `PANE_GEOMETRY`
 * reddens the disjointness row on `trade`; deleting `texturesOf`'s
 * `ShaderMaterial` uniform pass leaves `uniformMap` unfreed; deleting the
 * texture pass and the `InstancedMesh` pass together leaves `albedo` unfreed.
 * Writing the check also found four unmarked module-level material tables and a
 * flat clone marked shared whose base was per-station, which is the class of
 * defect it exists for and not a deliberate break.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	type Disposable,
	disposeSubtree,
	isShared,
	resourcesOf,
	shared,
} from "../src/gpu-teardown";
import { generateGalaxy } from "../src/galaxy";
import { buildShipMesh } from "../src/ship-mesh";
import { type PlanetAppearance, appearanceOf } from "../src/planet-appearance";
import {
	type BodyVisual,
	buildBodyVisual,
	surfaceSphere,
} from "../src/planet-surface";

/**
 * Every cube render target a body is holding, found the way a leak would be.
 *
 * By walking the subtree for a baked material's `samplerCube` uniforms and
 * mapping each back to its target through `userData.bakeCubes` — rather than
 * by asking the handle, which would be the module reporting on itself. A target
 * the handle forgot is a target this still finds, which is the direction that
 * matters.
 */
const cubeTargetsOf = (visual: BodyVisual): THREE.WebGLCubeRenderTarget[] => {
	const out: THREE.WebGLCubeRenderTarget[] = [];
	visual.group.traverse((object) => {
		for (const pair of object.userData?.bakeCubes?.() ?? [])
			out.push(pair.albedo, pair.normal);
	});
	return out;
};
import { buildStationForm } from "../src/station-mesh";
import { FORMS_IN_PLAY } from "./helpers/forms-in-play";
import { generateContents } from "../src/system";

/**
 * The corona is the one thing in `planet-surface.ts` that needs a canvas, and
 * bun has no DOM.
 *
 * Stubbed rather than skipped, because the star is precisely the class whose
 * disposal defect the module's own docstring names — a 128x128 texture left on
 * the GPU because `Material.dispose()` does not free a map. A test that could
 * not build a star could not check the one case anybody wrote down.
 *
 * It stubs the 2D drawing surface and nothing else: `THREE.CanvasTexture` only
 * stores the element, and no assertion below reads a pixel.
 */
function withCanvasStub<T>(body: () => T): T {
	const ctx = {
		createRadialGradient: () => ({ addColorStop: () => {} }),
		fillRect: () => {},
		set fillStyle(_v: unknown) {},
	};
	const previous = (globalThis as { document?: unknown }).document;
	(globalThis as { document?: unknown }).document = {
		createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
	};
	try {
		return body();
	} finally {
		(globalThis as { document?: unknown }).document = previous;
	}
}

/** Watch three.js's own `dispose` event on a set of resources. */
function watch(resources: Iterable<Disposable>) {
	const fired = new Set<Disposable>();
	for (const resource of resources)
		resource.addEventListener("dispose", () => fired.add(resource));
	return fired;
}

const GALAXY = generateGalaxy(20260902, 0);

/** One body visual per class the generator actually produces, built from the
 *  generator's own appearances rather than from hand-written looks. */
function sampleAppearances(): Map<string, PlanetAppearance> {
	const byClass = new Map<string, PlanetAppearance>();
	for (const record of GALAXY.systems.filter((_, i) => i % 8 === 0)) {
		const contents = generateContents(record);
		const bodies: { id: string; kind: "star" | "planet" | "moon" }[] = [
			{ id: contents.star.id, kind: "star" },
			...contents.planets.map((p) => ({ id: p.id, kind: "planet" as const })),
		];
		for (const body of bodies) {
			const look = appearanceOf(body, contents);
			if (look && !byClass.has(look.surface)) byClass.set(look.surface, look);
		}
	}
	return byClass;
}

const APPEARANCES = sampleAppearances();

describe("the fixtures cover what the teardown has to handle", () => {
	test("a star and several planet classes, from the shipped generator", () => {
		expect(APPEARANCES.has("star")).toBe(true);
		// The `>= 4` is a floor on coverage rather than a pin on the generator:
		// what matters is that the sweep below runs over several shader classes,
		// not that this seed produces exactly n of them.
		expect(APPEARANCES.size).toBeGreaterThanOrEqual(4);
	});
});

describe("disposeSubtree reaches every kind of resource a scene holds", () => {
	/**
	 * A fixture whose resources are **named by the test**, not discovered by the
	 * module under test.
	 *
	 * The first version of this check asserted that everything
	 * `disposeSubtree` *reported* freeing had dispatched `dispose` — which is
	 * the same loop reading itself, and stayed green with the shader-uniform
	 * pass deleted. What can fail is a list written here: each entry is a shape
	 * the game actually draws, and each one is a way a texture hides from a
	 * naive walker.
	 */
	function fixture() {
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1);
		const normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
		const uniformMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
		const spriteMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
		// A plated hull: two maps on one standard material, the station case.
		const plated = new THREE.MeshStandardMaterial({
			map: albedo,
			normalMap: normal,
		});
		// A planet surface: every one in the game is a `ShaderMaterial`, and a
		// texture it samples hangs off `uniforms` rather than off a property.
		const surface = new THREE.ShaderMaterial({
			uniforms: { tex: { value: uniformMap } },
		});
		// The star's corona: a `Sprite`, whose material carries a canvas texture
		// `Material.dispose()` does not free.
		const spriteMaterial = new THREE.SpriteMaterial({ map: spriteMap });
		const instanceGeometry = new THREE.BoxGeometry(1, 1, 1);
		const instanceMaterial = new THREE.MeshBasicMaterial();

		const root = new THREE.Group();
		root.add(new THREE.Mesh(geometry, plated));
		root.add(new THREE.Mesh(new THREE.SphereGeometry(1, 4, 4), surface));
		const sprite = new THREE.Sprite(spriteMaterial);
		// three.js hands every sprite in the process one module-scope quad; the
		// game marks it shared at the corona's build site, so the fixture does
		// too or this walker would take it out from under every other sprite.
		shared(sprite.geometry);
		root.add(sprite);
		// **Held rather than dropped into the tree**, so the row below can watch
		// it: `InstancedMesh.dispose()` frees the instance matrix, which is
		// per-mesh and cannot be shared, and it is the one resource this fixture
		// named only by its parts. Sage round 3 (codex) caught that removing
		// `disposeSubtree`'s `InstancedMesh` pass left every assertion here green
		// — the geometry and material are disposed either way, so they were a
		// surrogate for a thing nothing observed.
		const instanced = new THREE.InstancedMesh(
			instanceGeometry,
			instanceMaterial,
			4,
		);
		root.add(instanced);

		return {
			root,
			instanced,
			owned: {
				geometry,
				albedo,
				normal,
				uniformMap,
				spriteMap,
				plated,
				surface,
				spriteMaterial,
				instanceGeometry,
				instanceMaterial,
			},
		};
	}

	test("every named resource of a scene-shaped fixture is disposed", () => {
		const { root, owned, instanced } = fixture();
		const fired = new Set<string>();
		for (const [name, resource] of Object.entries(owned))
			(resource as Disposable).addEventListener("dispose", () =>
				fired.add(name),
			);
		// The `InstancedMesh` is an `Object3D` rather than one of this module's
		// `Disposable`s, so it is watched beside them rather than inside `owned`
		// — but it is watched, which it was not before round 3.
		instanced.addEventListener("dispose", () => fired.add("instancedMesh"));
		disposeSubtree(root);
		for (const name of [...Object.keys(owned), "instancedMesh"])
			expect([name, fired.has(name)]).toEqual([name, true]);
	});

	test("a resource referenced twice in one subtree is disposed once", () => {
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const material = new THREE.MeshBasicMaterial();
		const root = new THREE.Group();
		root.add(new THREE.Mesh(geometry, material));
		root.add(new THREE.Mesh(geometry, material));
		let disposals = 0;
		geometry.addEventListener("dispose", () => disposals++);
		const report = disposeSubtree(root);
		expect(disposals).toBe(1);
		expect(report.freed.has(geometry)).toBe(true);
	});

	test("a real body's textures are all accounted for, by the test's own rule", () => {
		// **Sage round 2 was right that the named-resource row above runs on a
		// hand-built fixture**, so for a real `BodyVisual` the only claim was
		// `freed.size > 0` — a floor, and labelled one. This is the completeness
		// claim on the real thing.
		//
		// The enumeration is written *here* rather than imported, and that is the
		// point: `resourcesOf` and `disposeSubtree` deliberately share one
		// traversal (`gpu-teardown.ts` argues why), so a cross-check built from
		// either of them is the same rule agreeing with itself. This walks with
		// three's own `traverse` and reads the two places a texture can hang —
		// a named property, and a `ShaderMaterial` uniform — which is the rule
		// `texturesOf` implements, restated by a second author.
		//
		// Red-built: deleting `texturesOf`'s uniform pass leaves every planet
		// surface's own maps unaccounted for and this goes red on all eight
		// classes, where `freed.size > 0` stayed green.
		const seen = new Map<string, number>();
		withCanvasStub(() => {
			for (const [surface, look] of APPEARANCES) {
				const visual = buildBodyVisual(look, surfaceSphere("near"), {
					sunColor: 0xfff0e0,
					starTint: 0xfff0e0,
				});
				const expected = new Set<THREE.Texture>();
				visual.group.traverse((object) => {
					const material = (object as Partial<THREE.Mesh>).material;
					for (const one of Array.isArray(material)
						? material
						: material
							? [material]
							: []) {
						for (const value of Object.values(
							one as unknown as Record<string, unknown>,
						))
							if (value instanceof THREE.Texture) expected.add(value);
						const uniforms = (one as Partial<THREE.ShaderMaterial>).uniforms;
						for (const uniform of Object.values(uniforms ?? {}))
							if (uniform?.value instanceof THREE.Texture)
								expected.add(uniform.value);
					}
				});
				const report = disposeSubtree(visual.group);
				const unaccounted = [...expected].filter(
					(texture) => !report.freed.has(texture) && !report.kept.has(texture),
				);
				expect([surface, unaccounted.length]).toEqual([surface, 0]);
				seen.set(surface, expected.size);
			}
		});
		// **The vacuity guard is on the corpus, not on each class**, because most
		// of them genuinely hold no texture: a planet surface is a
		// `ShaderMaterial` whose bands are computed rather than sampled (#59), so
		// there is nothing to enumerate and the row above is trivially true for
		// it. Asserting per-class would have failed on `terran` for being right.
		// What must not be true is that *nothing* in the corpus has one — that is
		// the state in which this whole test passes while checking nothing.
		const withTextures = [...seen].filter(([, count]) => count > 0);
		console.log(
			`textured body classes: ${withTextures.map(([s, n]) => `${s}=${n}`).join(", ") || "NONE"}`,
		);
		expect(withTextures.length).toBeGreaterThan(0);
	});

	test("every station and body actually frees something", () => {
		// The floor under the two disjointness rows below: they are vacuously
		// true against a walker that freed nothing at all.
		for (const [type, formId] of FORMS_IN_PLAY) {
			const mesh = buildStationForm(type, formId, 0x9aa6b2, 7, 7);
			expect([type, disposeSubtree(mesh.root).freed.size > 0]).toEqual([
				type,
				true,
			]);
		}
		withCanvasStub(() => {
			for (const [surface, look] of APPEARANCES) {
				const visual = buildBodyVisual(look, surfaceSphere("near"), {
					sunColor: 0xfff0e0,
					starTint: 0xfff0e0,
				});
				expect([surface, disposeSubtree(visual.group).freed.size > 0]).toEqual([
					surface,
					true,
				]);
			}
		});
	});
});

describe("disposeSubtree keeps what the next system needs", () => {
	test("tearing down a Traffic hull frees its owned buffers and keeps shared finishes", () => {
		const leaving = buildShipMesh("courier", "a").root;
		const staying = buildShipMesh("courier", "a").root;
		const held = resourcesOf(staying);
		const report = disposeSubtree(leaving);
		expect(report.freed.size).toBeGreaterThan(0);
		expect(report.kept.size).toBeGreaterThan(0);
		for (const resource of report.freed) expect(held.has(resource)).toBe(false);
		for (const resource of report.kept) expect(held.has(resource)).toBe(true);
	});

	test("tearing one station down leaves an identical one whole", () => {
		// The failure this exists for: the plating maps are one pair per role and
		// the hull materials one per (type, colour), so a walker that disposed
		// everything it reached would take the *next* system's trade station's
		// surface with it. That does not throw. It renders black.
		for (const [type, formId] of FORMS_IN_PLAY) {
			const leaving = buildStationForm(type, formId, 0x9aa6b2, 7, 7);
			const staying = buildStationForm(type, formId, 0x9aa6b2, 7, 7);
			const held = resourcesOf(staying.root);
			const report = disposeSubtree(leaving.root);
			for (const resource of report.freed)
				expect([type, held.has(resource)]).toEqual([type, false]);
			// The premise: the two stations really do share something, so the
			// disjointness above is a constraint rather than a coincidence of two
			// disjoint object graphs.
			expect([type, report.kept.size > 0]).toEqual([type, true]);
			for (const resource of report.kept)
				expect([type, held.has(resource)]).toEqual([type, true]);
		}
	});

	test("tearing one body down leaves another of the same class whole", () => {
		withCanvasStub(() => {
			for (const [surface, look] of APPEARANCES) {
				const options = { sunColor: 0xfff0e0, starTint: 0xfff0e0 };
				const leaving = buildBodyVisual(look, surfaceSphere("near"), options);
				const staying = buildBodyVisual(look, surfaceSphere("near"), options);
				const held = resourcesOf(staying.group);
				const report = disposeSubtree(leaving.group);
				for (const resource of report.freed)
					expect([surface, held.has(resource)]).toEqual([surface, false]);
				// Every body in the game draws on the same unit sphere, so this is
				// never an empty claim.
				expect([surface, report.kept.size > 0]).toEqual([surface, true]);
			}
		});
	});

	/**
	 * **#208's cubes are freed, and nothing here can see it any other way.**
	 *
	 * A `WebGLCubeRenderTarget` is not one of this module's `Disposable`s — it
	 * has no `userData` and nothing can share it — so it is outside `freed` for
	 * exactly the reason `InstancedMesh` is, and it is watched the same way:
	 * by listening for its own `dispose` event. That is not a stand-in for the
	 * real claim, it *is* the claim, because the FBO a cube target owns is freed
	 * only by the target and `disposeSubtree` frees textures.
	 *
	 * Two cubes per bake and two bakes when one is in flight, so the count is
	 * what says all of them went rather than the one the material happened to be
	 * holding.
	 */
	test("a body's cube targets are freed when the body is", () => {
		withCanvasStub(() => {
			for (const [surface, look] of APPEARANCES) {
				const visual = buildBodyVisual(look, surfaceSphere("near"), {
					sunColor: 0xfff0e0,
					starTint: 0xfff0e0,
				});
				if (!visual.canBake()) {
					visual.dispose();
					continue;
				}
				let disposed = 0;
				const watch = (v: BodyVisual) => {
					for (const target of cubeTargetsOf(v)) {
						target.addEventListener("dispose", () => {
							disposed++;
						});
					}
				};
				// No renderer is needed to *start* a bake — the targets and the
				// materials are allocated up front and only the faces need one — so
				// this stays in the headless tier where the rest of the teardown
				// rules are.
				visual.startBake(256);
				watch(visual);
				expect([surface, disposed]).toEqual([surface, 0]);
				visual.dispose();
				expect([surface, disposed]).toEqual([surface, 2]);
			}
		});
	});

	test("a second bake started before the first landed frees the first", () => {
		// The double-buffer's own leak. `startBake` keeps the *ready* pair on
		// screen and discards any bake still filling; a version that kept both
		// would grow by 4 MB every time a body crossed two handoffs in a few
		// frames, and nothing would fail.
		withCanvasStub(() => {
			const surface = "terran";
			const look = APPEARANCES.get(surface);
			if (!look) throw new Error("the fixture no longer has a terran world");
			const visual = buildBodyVisual(look, surfaceSphere("near"), {
				sunColor: 0xfff0e0,
				starTint: 0xfff0e0,
			});
			visual.startBake(256);
			let disposed = 0;
			for (const target of cubeTargetsOf(visual))
				target.addEventListener("dispose", () => {
					disposed++;
				});
			visual.startBake(512);
			expect([surface, disposed]).toEqual([surface, 2]);
			visual.dispose();
		});
	});

	test("the shared marks are on the resources every system reuses", () => {
		// Named rather than counted: a count would go green on the wrong set.
		expect(isShared(surfaceSphere("near"))).toBe(true);
		expect(isShared(surfaceSphere("far"))).toBe(true);
		const station = buildStationForm("trade", "a", 0x9aa6b2, 7, 7);
		const report = disposeSubtree(station.root);
		for (const resource of report.kept) expect(isShared(resource)).toBe(true);
		for (const resource of report.freed) expect(isShared(resource)).toBe(false);
	});

	test("shared() marks the resource it is handed and returns it", () => {
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		expect(isShared(geometry)).toBe(false);
		expect(shared(geometry)).toBe(geometry);
		expect(isShared(geometry)).toBe(true);
		const root = new THREE.Group();
		root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
		let disposals = 0;
		geometry.addEventListener("dispose", () => disposals++);
		disposeSubtree(root);
		expect(disposals).toBe(0);
	});
});
