/**
 * Baking a rocky planet's surface into two cube maps — node #208.
 *
 * ## What this buys, and what it cannot
 *
 * Nothing about a planet was cached: every fragment re-evaluated 100 to 150
 * noise calls every frame, and #248's ladder priced a filling one at 43.5 ms
 * against 15.8 for the same sphere with the surface term switched off. A cube
 * sampled by direction has no seam and no pole pinch — the two objections #59
 * declined a bake on — and two texture fetches is what the whole surface costs
 * once it is in one.
 *
 * **It cannot serve a filling planet, and that is arithmetic rather than a
 * tuning failure.** `pxPerCubeTexel` in `relief-bands.ts` carries the working:
 * a cube texel subtends a fixed angle while the visible cap of a sphere shrinks
 * as the camera approaches, so a 512 px face is already twelve screen pixels
 * per texel at 1.02 radii and it would take faces around 6,000 px to close
 * that. 512 reaches parity at about **two** radii, which is where #207's
 * four-tap band begins. So this is a band that sits under #207's rather than a
 * replacement for it, and the frame it does not touch is exactly the one #248
 * measured.
 *
 * ## What is in the two cubes
 *
 * - **A**: RGB albedo, A `specMask`.
 * - **B**: RGB the **object-space normal**, half-range encoded, A one spare
 *   scalar the class names.
 *
 * The node asked for albedo in RGB and *height* in A. Height in eight bits does
 * not survive: the four-tap difference is a small delta of a small delta and
 * the slope quantises to steps, so the terrain would come back banded. A normal
 * is what an eight-bit channel is actually good at, and baking it also takes
 * the four taps out of the draw program entirely rather than moving them into
 * texel space.
 *
 * `specPower` is a per-class literal and is compiled in, not baked
 * (`BAKE_DESCRIPTORS`).
 *
 * ## Why a quad and not a CubeCamera
 *
 * Six full-screen quads, one per face, with the direction built from the face's
 * own basis. A `CubeCamera` would need a sphere to hit, would shade its back
 * faces, and would interpolate the direction across a triangle.
 *
 * The bases start from **three's own** `CubeCamera.updateCoordinateSystem`
 * table and then **negate both in-plane axes**, because a camera's basis is not
 * a cube face's `(s, t)` — see `cubeFaceBasis`. This paragraph said the table
 * was the answer for three rounds, which is the 180° rotation the PR lists as
 * its third silent defect (sage, PR #256, round 4): every face held the right
 * hemisphere and the surface was in the wrong place on it.
 */
import * as THREE from "three";
import type { SurfaceClass } from "./planet-appearance";
import {
	BAKE_DESCRIPTORS,
	BAKE_VERTEX,
	bakeFragmentFor,
} from "./planet-shaders";

/**
 * What the cubes cost, from a census rather than an estimate.
 *
 * The sizes themselves are `BAKE_FACE_SIZES` in `relief-bands.ts`, beside the
 * band that selects them — they are a function of apparent size and belong with
 * the arithmetic that decides it, not here.
 *
 * Over 4 worlds x 8 galaxies x 256 systems — 8,192 systems — the bakeable
 * bodies per system (moons are always `airless`) run 1 to 14, mean **3.27** —
 * it was 3.40 before lava left the table. RGBA8 with mipmaps is 1.33 x 6 x size² x 4 bytes per cube,
 * so a 256 **pair** is 4.0 MB and a 512 pair 16.0 MB.
 *
 * **The census counts bodies; the megabytes are a policy** (sage, PR #256,
 * round 4). Two figures were quoted here as though both were measured: 25.1 MB
 * typical and 68.0 MB worst, both of which assume exactly one body holds the
 * large pair. Nothing enforced that — `bakeFacePxFor` hands 512 to every body
 * inside about 3.69 of its own radii, and a system can have several — so the
 * true bound was fourteen large pairs, 224 MB.
 *
 * `main.ts` enforces it now: the large pair goes to the body with the largest
 * apparent radius and every other body takes the small one, so the figures
 * above are what the schedule permits rather than what it happens to do.
 * `scripts/measure-bake-census.ts` reprints all of it.
 *
 * **Plus what a re-bake holds transiently**, which those figures exclude and
 * sage is right that they should not (PR #256, round 3). A body keeps its ready
 * pair on screen while the replacement fills — that is the no-pop guarantee — so
 * for the twelve frames of a crossing it holds both, and a body going 256 to 512
 * holds 20.0 MB rather than 16.0. One body crossing takes the fourteen-body
 * worst case to **72.0 MB**, and nothing bounds how many cross at once beyond
 * the fact that they cross at different apparent sizes.
 *
 * Mipmaps are 4/3 of the memory above and the case for them is **arithmetic and
 * not a frame**: a body at 8 radii is 0.41 screen pixels per texel on a 256 cube
 * and 0.16 at 20, which is minification by a factor of six, and unfiltered
 * minification of that order aliases. No arm with them off was run (sage,
 * PR #256, round 5), so read this as the reason they are on rather than as a
 * measurement of what happens when they are not.
 */

/**
 * Bytes one cube **pair** holds, mipmaps included.
 *
 * Six faces, four bytes a texel, two cubes — albedo with `specMask` in alpha and
 * the object-space normal with the class's spare scalar — and 4/3 for the mip
 * chain, which is not optional here.
 *
 * Exported because `scripts/measure-bake-census.ts` and
 * `tests/planet-bake.test.ts` both quote totals derived from it, and two
 * spellings of one memory model is how the docstring above comes to disagree
 * with the script that reprints it (sage, PR #256, round 3).
 */
export const bakePairBytes = (facePx: number) =>
	(6 * facePx * facePx * 4 * 2 * 4) / 3;

/**
 * What a system of `n` bakeable bodies holds, as an upper bound.
 *
 * At most one body at a time is near enough to want the large pair; the rest
 * hold the small one. Fractional `n` is meaningful — the census quotes a mean.
 */
export const systemBakeBytes = (
	n: number,
	small: number,
	large: number,
): number => bakePairBytes(large) + Math.max(0, n - 1) * bakePairBytes(small);

/**
 * The six faces, as three's `CubeCamera` orients them for a WebGL context.
 *
 * Copied as the pair of vectors each `lookAt` is given, so the basis below is
 * built by the same `Matrix4.lookAt` a camera version would use — and then
 * corrected by `cubeFaceBasis`, because the camera convention and the sampling
 * convention differ by 180° on every face. The order is the one
 * `WebGLRenderer.setRenderTarget`'s `activeCubeFace` argument indexes: +X, -X,
 * +Y, -Y, +Z, -Z.
 */
const CUBE_FACES: readonly { look: THREE.Vector3; up: THREE.Vector3 }[] = [
	{ look: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
	{ look: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
	{ look: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
	{ look: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
	{ look: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
	{ look: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
];

export const CUBE_FACE_COUNT = CUBE_FACES.length;

const ORIGIN = new THREE.Vector3();

/**
 * Right, up and forward for one face, as the columns of a 3x3.
 *
 * `faceBasis * vec3(ndc, 1.0)` is then the ray through that pixel at a 90°
 * field of view, which is what a face of a cube map is. Built from
 * `Matrix4.lookAt`, whose x and y columns are the camera's right and up; the
 * forward column is the look direction itself, which is already a unit vector.
 */
export function cubeFaceBasis(face: number): THREE.Matrix3 {
	const spec = CUBE_FACES[face];
	if (!spec) throw new Error(`cube face ${face} does not exist`);
	const m = new THREE.Matrix4().lookAt(ORIGIN, spec.look, spec.up);
	/**
	 * **Both in-plane axes are negated, and that is the whole of the convention.**
	 *
	 * A camera's basis is not a cube face's `(s, t)`. GL's sampling rule (ES 3.0
	 * §8.13, table 8.19) gives `+X` the coordinates `sc = -z, tc = -y`, while the
	 * camera looking down `+X` with up `+Y` has right `+Z` and up `+Y` — so `s`
	 * runs against the camera's right, and `t` runs against its up because the
	 * framebuffer's first row is the *bottom* while a cube face's `t = 0` is the
	 * top. Both signs invert, which is a 180° rotation of every face.
	 *
	 * It is worth stating what that error *looks like*, because it very nearly
	 * shipped. Every face still holds the right hemisphere, so a read-back of the
	 * face means is perfectly symmetric — `+X` at 228/255 and `-X` at 26 — and
	 * the six forwards are still the six axes. The corner rays still land on the
	 * eight corners of a cube, three each. Nothing about the cube is wrong except
	 * where each texel is, and the planet renders as a planet: lit, seamless, the
	 * right colours, with its terrain in the wrong place. What caught it was
	 * baking the direction itself and differencing it against `normalize(vObjP)`
	 * in the draw program; `tests/planet-bake.test.ts` holds the same claim
	 * against the spec's own rule rather than against this code.
	 */
	const x = new THREE.Vector3().setFromMatrixColumn(m, 0).negate();
	const y = new THREE.Vector3().setFromMatrixColumn(m, 1).negate();
	const f = spec.look;
	// Row-major arguments, so each triple below is a *row* and each column is
	// one basis vector.
	return new THREE.Matrix3().set(x.x, y.x, f.x, x.y, y.y, f.y, x.z, y.z, f.z);
}

/** Two triangles covering clip space, shared by every bake in the game. The
 *  bake's vertex shader writes `gl_Position` from `position.xy` directly, so
 *  neither the camera nor the geometry's own transform is read. */
let quadGeometry: THREE.BufferGeometry | undefined;
const quad = () => {
	quadGeometry ??= new THREE.PlaneGeometry(2, 2);
	return quadGeometry;
};
/** `WebGLRenderer.render` requires a camera even when the shader ignores it. */
const BAKE_CAMERA = new THREE.Camera();

/**
 * Run `body` with whatever the renderer was pointed at put back afterwards.
 *
 * Three values and not one: a cube face and a mip level are part of where a
 * render lands, and restoring only the target leaves the composer drawing into
 * face 5 of somebody's cube. Spelled once because both callers here need the
 * same three and a partial restore is the kind of thing that shows up two
 * frames later somewhere else.
 */
const withTarget = (renderer: THREE.WebGLRenderer, body: () => void) => {
	const wasTarget = renderer.getRenderTarget();
	const wasFace = renderer.getActiveCubeFace();
	const wasLevel = renderer.getActiveMipmapLevel();
	body();
	renderer.setRenderTarget(wasTarget, wasFace, wasLevel);
};

const newCube = (facePx: number): THREE.WebGLCubeRenderTarget =>
	new THREE.WebGLCubeRenderTarget(facePx, {
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		// Linear in, linear out. The surfaces are authored in linear space
		// (`planet-shaders.ts`) and the encode happens once, in the output stage;
		// a cube that declared sRGB would encode here and again there.
		colorSpace: THREE.NoColorSpace,
		magFilter: THREE.LinearFilter,
		minFilter: THREE.LinearMipmapLinearFilter,
		generateMipmaps: true,
		// Nothing occludes anything in a bake: one quad, no depth.
		depthBuffer: false,
		stencilBuffer: false,
	});

/** Both cubes for one body, and the state of filling them. */
export interface BodyBake {
	albedo: THREE.WebGLCubeRenderTarget;
	normal: THREE.WebGLCubeRenderTarget;
	facePx: number;
	/** Every face of both cubes has been drawn. Until then the body is drawn
	 *  procedurally — a half-filled cube is a black hemisphere. */
	complete: boolean;
	/**
	 * Draw the next face, and say whether anything was left to draw.
	 *
	 * **One face per call, which is one face per frame**, because the node's own
	 * "do not let a bake block the first frame after a jump" is the difference
	 * between a hitch and a stall: twelve faces at 512 px on a system with
	 * fourteen bakeable bodies is 168 full-screen evaluations of the most
	 * expensive shader in the game.
	 */
	step(renderer: THREE.WebGLRenderer): boolean;
	/**
	 * Compile both bake programs against the cube target, without drawing.
	 *
	 * Otherwise the first `step` after a jump compiles them, and on a system with
	 * several bakeable classes that is a handful of synchronous shader compiles
	 * on exactly the frame the node's "do not let a bake block the first frame
	 * after a jump" is about. **Bound to the cube target**, because
	 * `outputColorSpace` is in three's program cache key and a compile with
	 * nothing bound produces a variant the bake never uses — the defect sage
	 * caught in #254's warm-up, arriving by the same door.
	 */
	prewarm(renderer: THREE.WebGLRenderer): void;
	dispose(): void;
}

/**
 * The two bake programs for one class on one body, and the quad they draw.
 *
 * **Held across cube replacements**, which is why they are separate from
 * `BodyBake` (sage, PR #256, round 2). A re-bake replaces the cube targets and
 * nothing else; a version that owned the materials disposed them on every size
 * change, and for a class only one body in the system wears that deletes the
 * last reference to a compiled program — so the replacement's first two faces
 * link inside the frame loop, which is exactly what `prewarm` exists to avoid.
 *
 * Keyed by class because the perf panel can put any class on any body, and a
 * re-bake after that needs a different pair.
 */
export interface BakePrograms {
	/** The pair for this class, built on first use and kept. */
	forClass(surface: SurfaceClass): {
		materials: Record<"albedo" | "normal", THREE.ShaderMaterial>;
		faceBasis: THREE.IUniform;
		scene: THREE.Scene;
		mesh: THREE.Mesh;
	};
	dispose(): void;
}

/**
 * Build the bake programs for one body.
 *
 * `uniforms` is the body's own record, shared rather than copied so the seed,
 * the sea level and the warmth cannot drift between the bake and the procedural
 * program it has to match. Two are deliberately **not** shared:
 *
 * - `time` is pinned to zero. It is the node's determinism requirement (step 5)
 *   and it is why `venusian` is not in the table at all: a class that reads the
 *   clock in `surface()` cannot be a pure function of its seed.
 * - `perfAblate` is pinned to zero. The ladder's arms belong to the *draw*, and
 *   `bakedFragmentFor` honours them there; baking an arm in would leave a
 *   diagnostic frozen into a texture after the arm was cleared.
 */
export function createBakePrograms(
	uniforms: Record<string, THREE.IUniform>,
): BakePrograms {
	const built = new Map<SurfaceClass, ReturnType<BakePrograms["forClass"]>>();
	return {
		forClass(surface) {
			const hit = built.get(surface);
			if (hit) return hit;
			if (!BAKE_DESCRIPTORS[surface])
				throw new Error(
					`${surface} has no bake descriptor and cannot be baked`,
				);
			const faceBasis: THREE.IUniform = { value: cubeFaceBasis(0) };
			const bakeUniforms: Record<string, THREE.IUniform> = {
				...uniforms,
				time: { value: 0 },
				perfAblate: { value: 0 },
				faceBasis,
			};
			const material = (channel: "albedo" | "normal") =>
				new THREE.ShaderMaterial({
					uniforms: bakeUniforms,
					vertexShader: BAKE_VERTEX,
					fragmentShader: bakeFragmentFor(surface, channel),
					depthTest: false,
					depthWrite: false,
					/**
					 * **`NoBlending`, and this is not a micro-optimisation.**
					 *
					 * Both cubes use the alpha channel as *data* — `specMask` in A and
					 * the class's spare scalar in B — and the default `NormalBlending`
					 * reads alpha as coverage. So every texel whose data happened to be
					 * 0 was blended against the cleared target and wrote nothing at
					 * all: a desert's land, where `specMask` is 0, came back black, and
					 * the same hole ate the normals of every class whose `aux` is the
					 * constant `0.0` — which is four of the five. It renders, it is
					 * dark, and nothing errors.
					 */
					blending: THREE.NoBlending,
				});
			const materials = {
				albedo: material("albedo"),
				normal: material("normal"),
			};
			const mesh = new THREE.Mesh(quad(), materials.albedo);
			mesh.frustumCulled = false;
			const scene = new THREE.Scene();
			scene.add(mesh);
			const made = { materials, faceBasis, scene, mesh };
			built.set(surface, made);
			return made;
		},
		dispose() {
			for (const { materials } of built.values()) {
				materials.albedo.dispose();
				materials.normal.dispose();
			}
			built.clear();
		},
	};
}

/**
 * Start a bake for one body, into a fresh pair of cubes.
 *
 * The programs are the caller's and outlive this; what a `BodyBake` owns is the
 * two render targets and the schedule.
 */
export function startBodyBake(
	surface: SurfaceClass,
	facePx: number,
	programs: BakePrograms,
): BodyBake {
	const { materials, faceBasis, scene, mesh } = programs.forClass(surface);
	const albedo = newCube(facePx);
	const normal = newCube(facePx);

	// One counter over both cubes: faces 0..5 fill A and 6..11 fill B. A single
	// number is what makes "one face per frame" a property of the caller's loop
	// rather than a schedule this has to hold.
	let drawn = 0;
	const total = CUBE_FACE_COUNT * 2;

	const bake: BodyBake = {
		albedo,
		normal,
		facePx,
		complete: false,
		step(renderer) {
			if (drawn >= total) return false;
			const face = drawn % CUBE_FACE_COUNT;
			const which = drawn < CUBE_FACE_COUNT ? "albedo" : "normal";
			const target = which === "albedo" ? albedo : normal;
			mesh.material = materials[which];
			faceBasis.value = cubeFaceBasis(face);

			// Mipmaps are generated when the render target is unbound, so letting
			// that happen on all six faces builds five chains that are thrown away.
			// The same move `CubeCamera.update` makes, and for the same reason.
			const last = face === CUBE_FACE_COUNT - 1;
			target.texture.generateMipmaps = last;

			withTarget(renderer, () => {
				renderer.setRenderTarget(target, face);
				renderer.render(scene, BAKE_CAMERA);
			});

			drawn++;
			bake.complete = drawn >= total;
			return true;
		},
		prewarm(renderer) {
			withTarget(renderer, () => {
				for (const which of ["albedo", "normal"] as const) {
					mesh.material = materials[which];
					renderer.setRenderTarget(which === "albedo" ? albedo : normal, 0);
					renderer.compile(scene, BAKE_CAMERA);
				}
			});
		},
		dispose() {
			// **The cubes only.** The programs belong to `BakePrograms` and are
			// reused by the bake that replaces this one.
			albedo.dispose();
			normal.dispose();
		},
	};
	return bake;
}
