/**
 * How a station's surfaces are *made*, as opposed to what shape they are.
 *
 * `station-mesh.ts` authors twelve forms; this module gives them a surface.
 * The two share only `shell`'s use of a panel size, and separating them keeps a
 * 2,900-line module from being two subjects at once: UV projection, the
 * triplanar patch, normal smoothing and the asteroid all answer "how does this
 * look like a material", and none of them knows what a station is.
 *
 * **Nothing here implements lighting.** The triplanar sampler is a patch on
 * `MeshStandardMaterial` rather than a `ShaderMaterial`, so the scene's sun,
 * fill and tone mapping stay three's — and this branch does not acquire a
 * second lighting model that #57's planet shaders would then have to be
 * reconciled with.
 */

import * as THREE from "three";
import { SimplexNoise } from "./noise";
import { RELIEF } from "./planet-classes.glsl";
import { NOISE_GLSL } from "./planet-shaders";

/**
 * Give a geometry per-face box-projected UVs, in kilometres divided by `panel`.
 *
 * `PolyhedronGeometry` and `IcosahedronGeometry` both write an azimuthal
 * unwrap — longitude and latitude — which is right for a sphere and wrong for
 * anything made of flat plates or displaced into lumps: the map smears into
 * streaks towards the poles and changes scale from one triangle to the next.
 * Each face is projected onto whichever axis plane it most faces instead.
 *
 * Non-indexed geometry only, which both of those produce: each run of three
 * vertices is one face and can be given its own projection without splitting
 * anything. The cost is a seam wherever the dominant axis changes, which on a
 * rock is invisible and on a plated hull falls along a facet edge.
 */
export function boxProjectUVs(geometry: THREE.BufferGeometry, panelKm: number) {
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const edge = new THREE.Vector3();
	const normal = new THREE.Vector3();
	for (let i = 0; i < position.count; i += 3) {
		a.fromBufferAttribute(position, i);
		b.fromBufferAttribute(position, i + 1);
		c.fromBufferAttribute(position, i + 2);
		normal.copy(b).sub(a);
		edge.copy(c).sub(a);
		normal.cross(edge);
		const ax = Math.abs(normal.x);
		const ay = Math.abs(normal.y);
		const az = Math.abs(normal.z);
		const axis = ax > ay && ax > az ? 0 : ay > az ? 1 : 2;
		for (let k = 0; k < 3; k++) {
			const v = k === 0 ? a : k === 1 ? b : c;
			uv.setXY(
				i + k,
				(axis === 0 ? v.y : v.x) / panelKm,
				(axis === 2 ? v.y : v.z) / panelKm,
			);
		}
	}
	uv.needsUpdate = true;
}

/**
 * Give a rock its surface from **#57's noise, evaluated per fragment**.
 *
 * The generated-map version this replaces baked a height field into an albedo
 * and a normal map and sampled them triplanar. That worked, and every part of it
 * was a workaround for the same thing: a texture needs coordinates, and an
 * irregular body has no good ones. Box projection seamed, an azimuthal unwrap
 * smeared at the poles, triplanar blending fixed both and left a tiling scale to
 * choose. Sampling a 3D field on the object's own position has none of those
 * problems, because there is nothing to unwrap.
 *
 * `NOISE_GLSL` and `RELIEF` are **imported, not pasted**. That was the whole
 * reason #56 deferred this: #57's shader library was still being written, and
 * two copies of a library in flight is worse than a workaround.
 *
 * **Three keeps doing the lighting.** This is a patch on `MeshStandardMaterial`
 * rather than a `ShaderMaterial`, and that is not a shortcut — the plating,
 * vents and radiators bolted to the rock are lit by the scene's sun and fill,
 * and a rock with its own light model would read as a second object under a
 * second sun. #57 can afford its own because it draws whole planets and nothing
 * else.
 *
 * **What it costs.** `craters` walks a 3×3×3 neighbourhood and `reliefNormal`
 * evaluates `height` four more times, so one crater octave is 5 × 27 = 135 cell
 * tests a fragment — #57's own figure, and its own note says an implementation
 * should bake it. This does not bake it, and the reason is measured rather than
 * argued: at docking range, where the rock fills the view, a headless
 * software-rasterised frame went from 15.5 fps to the figure in this node's
 * receipt. One octave, not #57's two, and the sub-crater tier is `ridged` noise
 * rather than a second neighbourhood walk — the same trade `AIRLESS` makes and
 * for the same reason.
 */
export function applyRockSurface(material: THREE.MeshStandardMaterial) {
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
varying vec3 vRockP;`,
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
// Normalised in the fragment stage, not here: interpolating a unit vector
// across a triangle does not give a unit vector.
vRockP = position;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>
uniform mat3 normalMatrix;
varying vec3 vRockP;
// NOISE_GLSL opens with its own "const float PI", and three.js has already
// #defined PI in <common> — so the declaration expands to
// "const float 3.14159... =" and the shader will not compile. Undefined around
// the include and restored after, because three's own chunks below use it.
#undef PI
${NOISE_GLSL}
#define PI 3.141592653589793

// One crater octave for the relief, ridged noise for the grain beneath it.
// A second octave is what AIRLESS pays for a moon that fills the screen; a
// station is drawn in the live game beside a dozen other objects.
float height(vec3 p) {
  // Scaled for a body a kilometre across, not a moon: at #57's 3.4 the bowls
  // came out seventy metres wide and the ground between them was glass.
  //
  // **Two terms, not three.** reliefNormal evaluates this five times, so
  // anything in here is paid five times over — a third ridged octave here
  // measured 4.5 fps against 15.5 before the shader existed. The sub-crater
  // grain moved to the albedo below, which is where AIRLESS puts its own and
  // why: at that scale the pits read as texture rather than as relief.
  return craters(p * 2.3, 7.0, 0.42) + fbm4(p * 11.0) * 0.16;
}
${RELIEF}`,
			)
			.replace(
				"#include <normal_fragment_maps>",
				`{
  vec3 p = normalize(vRockP);
  // **One height evaluation for both the normal and the albedo.**
  //
  // The tint used to live in <map_fragment>, which runs earlier and so had to
  // call height() a second time — a second 27-cell crater walk per fragment for
  // a colour. Doing both here costs one walk. diffuseColor is still in scope
  // and the lighting chunks come after, so writing it from here is late but not
  // too late.
  float h = height(p);
  vec3 objN = reliefNormal(p, p, 2.8);
  normal = normalize(normalMatrix * objN);

  // Rock is not one colour and is not many: the range is narrow on purpose,
  // because a surface painted across its whole albedo range reads as a
  // photograph of noise. What varies is which kind of rock — dust in the
  // basins, exposed face on the rims.
  vec3 dust = vec3(0.44, 0.41, 0.36);
  vec3 face = vec3(0.60, 0.57, 0.51);
  vec3 tone = mix(dust, face, smoothstep(-0.15, 0.35, h));
  // The sub-crater tier, evaluated once rather than five times — which is why
  // it is here and not in height().
  tone *= 0.86 + 0.28 * fbm4(p * 19.0);
  tone *= 0.90 + 0.20 * ridged(p * 30.0);
  diffuseColor.rgb *= tone / 0.5;
}`,
			);
	};
	// Two rocks with the same patch still compile twice unless they agree they
	// are the same program.
	material.customProgramCacheKey = () => "station-rock";
	return material;
}

/**
 * Average normals across coincident vertices, in place.
 *
 * `IcosahedronGeometry` is **non-indexed**: every triangle carries its own three
 * vertices, so `computeVertexNormals` writes each triangle's face normal three
 * times and the result is flat shading whether or not the material asks for it.
 * The rock was built with `flatShading: false` and rendered faceted anyway —
 * hard-edged triangles with a step in brightness across every shared edge, which
 * no normal map can hide because the map is being applied on top of a normal
 * that is already wrong.
 *
 * Merging the vertices into an indexed geometry would also fix it, and would
 * need `BufferGeometryUtils` from three's addons. Averaging by position needs no
 * import and no new dependency, which is worth more here than the vertex count
 * the merge would save: this runs once, on at most three meshes.
 *
 * Positions are bucketed at a millimetre so float error cannot split a shared
 * vertex into two that never find each other.
 */
export function smoothVertexNormals(geometry: THREE.BufferGeometry) {
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
	const sums = new Map<string, [number, number, number]>();
	// Keys are built once and kept, not recomputed in the second pass: this runs
	// over ~7,700 non-indexed vertices and the workbench rebuilds a form on every
	// click, so the second pass was pure allocation.
	const keys = new Array<string>(position.count);
	for (let i = 0; i < position.count; i++)
		keys[i] = `${Math.round(position.getX(i) * 1e6)},${Math.round(
			position.getY(i) * 1e6,
		)},${Math.round(position.getZ(i) * 1e6)}`;
	for (let i = 0; i < position.count; i++) {
		const k = keys[i];
		const sum = sums.get(k) ?? [0, 0, 0];
		sum[0] += normal.getX(i);
		sum[1] += normal.getY(i);
		sum[2] += normal.getZ(i);
		sums.set(k, sum);
	}
	for (let i = 0; i < position.count; i++) {
		const sum = sums.get(keys[i]) as [number, number, number];
		const length = Math.hypot(sum[0], sum[1], sum[2]) || 1;
		normal.setXYZ(i, sum[0] / length, sum[1] / length, sum[2] / length);
	}
	normal.needsUpdate = true;
}

/**
 * A small deterministic generator for display-only randomness.
 *
 * Its own, rather than one of `rng.ts`'s domain streams, and the difference is
 * the point: this feeds a *shape on screen* and nothing in the simulation, so
 * drawing it from a world stream would couple a display detail to the
 * generator's draw counts. The key is a constant string per feature, so the
 * shape is the same on every load and in every system.
 */
export function displayRand(id: string): () => number {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	let state = h >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

/**
 * A captured asteroid, displaced and cratered.
 *
 * Round one's rock was an icosahedron with its vertices jittered by a uniform
 * random factor, which gives a *lumpy ball*: every vertex moves independently,
 * so the surface has no features larger than one face and no features smaller
 * than one either. It reads as a low-poly sphere with noise on it, which is
 * what the review said.
 *
 * This is coherent noise instead, at three octaves, so the rock has shapes at
 * three scales — a long axis, ridges, and a grain — plus craters, which are the
 * one feature that says *asteroid* rather than *potato*.
 *
 * `SimplexNoise` only offers `noise2D`, so the displacement is the sum of three
 * planar lookups on the vertex's own (x, y), (y, z) and (z, x). That is a
 * triplanar blend rather than true 3D noise: it costs one seam-free field with
 * no poles, which a spherical (θ, φ) parameterisation would not give — the
 * poles are exactly where a rock would then show a pinch.
 */
export function buildAsteroid(
	radiusKm: number,
	tag: string,
	/**
	 * A keep-clear volume along +Z, carved out of the rock.
	 *
	 * Without it the displacement puts rock **in front of the pad**: measured,
	 * the Warren's surface rose to z = 0.413 km against a pad mouth at 0.282 km
	 * and the Collar's to 0.360 against 0.286, so on both a ship would have had
	 * to fly through a hill to dock. Noise does not know where the dock is, and
	 * a rock is the one body in the pool whose surface is not authored.
	 *
	 * The cut is a bench rather than a stamped hole — the ceiling eases upward
	 * towards the rim — so it reads as ground that has been machined flat for
	 * the pad, which is what it is.
	 */
	clear?: { radiusKm: number; ceilingKm: number },
): THREE.Mesh {
	// Subdivision 4, not 3. Flat shading used to hide the tessellation by owning
	// it; smooth-shaded with a normal map, a coarse hull shows its facets as
	// shading bands across the relief instead. 5,120 triangles for at most three
	// stations in a system is not a budget worth defending.
	const geometry = new THREE.IcosahedronGeometry(radiusKm, 4);
	const noise = new SimplexNoise(
		[...tag].reduce(
			(h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193),
			0x811c9dc5,
		) >>> 0,
	);
	const rand = displayRand(`${tag}-craters`);
	// Craters: a direction, an angular radius and a depth each. Six is enough to
	// read as cratered from any angle without turning the rock into foam.
	const craters = Array.from({ length: 6 }, () => {
		const z = rand() * 2 - 1;
		const theta = rand() * Math.PI * 2;
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
	const unit = new THREE.Vector3();
	for (let i = 0; i < position.count; i++) {
		v.fromBufferAttribute(position, i);
		unit.copy(v).normalize();
		const field = (frequency: number) =>
			noise.noise2D(unit.x * frequency, unit.y * frequency) +
			noise.noise2D(unit.y * frequency, unit.z * frequency) +
			noise.noise2D(unit.z * frequency, unit.x * frequency);
		let scale =
			1 + field(1.1) * 0.085 + field(2.7) * 0.042 + field(6.3) * 0.018;
		for (const crater of craters) {
			const alignment = unit.dot(crater.dir);
			if (alignment <= crater.cos) continue;
			// A smooth bowl rather than a step: `t` is 0 at the rim and 1 at the
			// centre, and the square is what gives the floor a flat-ish middle
			// instead of a spike.
			const t = (alignment - crater.cos) / (1 - crater.cos);
			scale -= crater.depth * t * t;
		}
		// Flattened along Z, so the rock has a long axis. A sphere with noise on
		// it still reads as a sphere.
		v.copy(unit).multiplyScalar(radiusKm * scale);
		v.z *= 0.78;
		if (clear) {
			const rho = Math.hypot(v.x, v.y);
			if (rho < clear.radiusKm) {
				// Eased at the rim: a hard clamp leaves a stamped disc with a
				// vertical wall, which reads as a hole punched in the rock rather
				// than as a bench cut into it.
				const t = rho / clear.radiusKm;
				v.z = Math.min(v.z, clear.ceilingKm + clear.radiusKm * 0.55 * t * t);
			}
		}
		position.setXYZ(i, v.x, v.y, v.z);
	}
	position.needsUpdate = true;
	geometry.computeVertexNormals();
	smoothVertexNormals(geometry);
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({
			// Lighter than rock looks in a swatch, for #28's reason: the near
			// layer's only fill is a dim camera-side light, and a physically
			// plausible dark asteroid renders as a hole in the starfield. The
			// shader tints from here rather than replacing it, so this is still
			// the one place the rock's overall value is set.
			color: 0x9a8a72,
			roughness: 0.95,
			metalness: 0.02,
			// **Smooth-shaded.** Flat shading quantises the surface to the
			// tessellation, so a rock reads faceted at every range instead of
			// grained close up and round far off — and it fights the relief, whose
			// perturbation a facet's constant normal flattens across the triangle.
			flatShading: false,
		}),
	);
	applyRockSurface(mesh.material as THREE.MeshStandardMaterial);
	mesh.name = "asteroid";
	return mesh;
}
