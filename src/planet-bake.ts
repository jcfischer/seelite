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
 * faces, and would interpolate the direction across a triangle. The bases here
 * are derived from **three's own** `CubeCamera.updateCoordinateSystem` table
 * rather than transcribed from the GL cube-map sign convention, which is where
 * a bake of this shape usually goes wrong: a flipped face is a seam that only
 * shows on one edge of one body.
 */
import * as THREE from "three";
import type { SurfaceClass } from "./planet-appearance";
import {
	BAKE_DESCRIPTORS,
	BAKE_VERTEX,
	bakeFragmentFor,
} from "./planet-shaders";

/**
 * Face size per render layer, and the memory that follows from it.
 *
 * 512 for the body the ship is nearest, 256 for everything in the approach and
 * far layers, which is the node's own answer and survives the arithmetic above:
 * a 256 cube reaches one pixel per texel at about 3.4 radii, and nothing in the
 * approach layer is nearer than that in a frame worth measuring.
 *
 * **Memory, from a census rather than an estimate.** Over 4 worlds x 8 galaxies
 * x 256 systems — 8,192 systems — the bakeable bodies per system (moons are
 * always `airless`) run 1 to 14, mean 3.40, with the worst at 14. RGBA8 with
 * mipmaps is 1.33 x 6 x size² x 4 bytes per cube, so a 256 **pair** is 4.19 MB
 * and a 512 pair 16.7 MB. A typical system therefore holds about **27 MB** and
 * the worst case **71 MB**. `scripts/measure-bake-census.ts` reprints it.
 *
 * Mipmaps are not optional: a body at 8 radii is 0.41 px per texel on a 256
 * cube and 0.16 at 20 radii, which is minification by a factor of six and it
 * shimmers without them.
 */
export const BAKE_FACE_PX = {
	near: 512,
	approach: 256,
	far: 256,
} as const;

export type BakeLayer = keyof typeof BAKE_FACE_PX;

/**
 * The six faces, as three's `CubeCamera` orients them for a WebGL context.
 *
 * Copied as the pair of vectors each `lookAt` is given, so the basis below is
 * built by the same `Matrix4.lookAt` the camera version would use and the two
 * cannot disagree about a sign. The order is the one
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
	const x = new THREE.Vector3().setFromMatrixColumn(m, 0);
	const y = new THREE.Vector3().setFromMatrixColumn(m, 1);
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
	dispose(): void;
}

/**
 * Start a bake for one body.
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
export function startBodyBake(
	surface: SurfaceClass,
	uniforms: Record<string, THREE.IUniform>,
	facePx: number,
): BodyBake {
	if (!BAKE_DESCRIPTORS[surface]) {
		throw new Error(`${surface} has no bake descriptor and cannot be baked`);
	}
	const albedo = newCube(facePx);
	const normal = newCube(facePx);
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
			 * Both cubes use the alpha channel as *data* — `specMask` in A and the
			 * class's spare scalar in B — and the default `NormalBlending` reads
			 * alpha as coverage. So every texel whose data happened to be 0 was
			 * blended against the cleared target and wrote nothing at all: a
			 * desert's land, where `specMask` is 0, came back black, and the same
			 * hole ate the normals of every class whose `aux` is the constant
			 * `0.0` — which is four of the five. It renders, it is dark, and
			 * nothing errors.
			 */
			blending: THREE.NoBlending,
		});
	const materials = { albedo: material("albedo"), normal: material("normal") };
	const mesh = new THREE.Mesh(quad(), materials.albedo);
	mesh.frustumCulled = false;
	const scene = new THREE.Scene();
	scene.add(mesh);

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

			const wasTarget = renderer.getRenderTarget();
			const wasFace = renderer.getActiveCubeFace();
			const wasLevel = renderer.getActiveMipmapLevel();
			renderer.setRenderTarget(target, face);
			renderer.render(scene, BAKE_CAMERA);
			renderer.setRenderTarget(wasTarget, wasFace, wasLevel);

			drawn++;
			bake.complete = drawn >= total;
			return true;
		},
		dispose() {
			materials.albedo.dispose();
			materials.normal.dispose();
			albedo.dispose();
			normal.dispose();
		},
	};
	return bake;
}
