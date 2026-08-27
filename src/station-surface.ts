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
import { CRATER_CELL, CRATER_PROFILE, NOISE_GLSL } from "./planet-shaders";

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

/** The rock's vertex-stage additions: one varying, and the object-space
 *  position everything else is a function of. Normalised in the fragment stage
 *  rather than here — interpolating a unit vector across a triangle does not
 *  give a unit vector. */
const ROCK_VERTEX_COMMON = /* glsl */ `#include <common>
varying vec3 vRockP;`;

const ROCK_VERTEX_BODY = /* glsl */ `#include <begin_vertex>
vRockP = position;`;

/** The rock's fragment-stage prelude: #57's noise, the crater walk that carries
 *  its own gradient, and the fine term. */
const ROCK_FRAGMENT_COMMON = /* glsl */ `#include <common>
uniform mat3 normalMatrix;
varying vec3 vRockP;
// NOISE_GLSL opens with its own "const float PI", and three.js has already
// #defined PI in <common> — so the declaration expands to
// "const float 3.14159... =" and the shader will not compile. Undefined around
// the include and restored after, because three's own chunks below use it.
#undef PI
${NOISE_GLSL}
#define PI 3.141592653589793

/*
 * The crater field and its gradient, from **one** walk of the neighbourhood.
 *
 * This is #57's craters() with its derivative carried alongside, and it exists
 * for one reason: reliefNormal gets its normal from four extra evaluations of
 * the height field, so a 3x3x3 walk costs five walks a fragment.
 *
 * **What that was worth**, on a GPU at docking range with the refinery filling
 * the view (the headless probe rasterises in software, so its numbers say
 * nothing about this):
 *
 *   five walks, grain differenced   25 fps, 80-90 ms worst
 *   one walk, grain differenced     40 fps, 40-50 ms worst
 *
 * One machine, one view, one term moved.
 *
 * **Neither row is what you get by running this tree.** The shipped
 * configuration cut the differenced grain as well, so it is a third
 * arrangement and has no row here — what came back for it was a rate with no
 * worst frame. ?seed=1&fps at a refinery measures *that*, which is the useful
 * number for anyone asking what the rock costs today, and is not either row
 * above.
 *
 * To reproduce the comparison itself, put back what each row names: the
 * top row is reliefNormal-style differencing of the height field, four extra
 * evaluations around every fragment; the second is this function with the
 * grain term differenced into the normal instead of folded into the albedo
 * below. Both are removals of the change this file makes, which is why the
 * figures live here rather than in a script. #63 carries the rest. The figures
 * are one machine's and are not portable; the *structure* is what carries — a
 * term inside the height field is paid five times, and a term in the albedo
 * once.
 *
 * A crater's profile is *mostly* smooth in d, so its slope comes almost free
 * in the loop that accumulates its depth. One walk, both answers.
 *
 * **Where "mostly" bites.** The profile has two breaks, and an analytic
 * gradient reports them where a finite difference smoothed them over its
 * epsilon. That difference is real and is worth writing down rather than
 * discovering later on a screenshot:
 *
 *   - inside = step(d, 1.0) cuts the bowl at the rim, so d(bowl)/dd is 2d
 *     below 1 and 0 above it: dProfile jumps by 2.0 across d = 1.
 *   - the walk is culled at d < 1.2, where the rim gaussian still has a value
 *     of about 0.009 and a slope of about -0.25. Both are dropped, not faded.
 *
 * The height itself is near-continuous at both — 0.009 x depth at the cull —
 * so the *arithmetic* says a break in the normal without a matching break in
 * the surface, which would read as a harder edge at the crater lip and a faint
 * step at the cull radius. That last sentence is a prediction, not an
 * observation: it says what a discontinuity in a normal usually looks like,
 * and nothing here has rendered the two side by side to check. The rock
 * shipped with both present, and nobody has looked for either specifically —
 * the one visual comparison on record is of the grain term at 200 m. So
 * "accepted" would be the wrong word: what happened is that neither was
 * noticed, which is weaker and is what this should say.
 *
 * The fix, if either ever reads badly, is a narrow smoothstep in place of the
 * step and a fade on the rim approaching 1.2 — but that is an edit to the
 * *shared* field, so it changes every planet #57 draws too, and it is that
 * decision rather than this one.
 *
 * There is one definition of the field, and it is #57's: CRATER_CELL and
 * CRATER_PROFILE are interpolated here and into craters() alike, so the two
 * differ only in what they accumulate. This was a copy held in step by a test
 * that matched strings — which catches a changed line but not an added one, so
 * a new term in one function would have passed green while the fields diverged.
 */
vec4 cratersAndGradient(vec3 p, float scale, float depth) {
  p *= scale;
  vec3 base = floor(p);
  float acc = 0.0;
  vec3 grad = vec3(0.0);
  for (int x = -1; x <= 1; ++x)
  for (int y = -1; y <= 1; ++y)
  for (int z = -1; z <= 1; ++z) {
${CRATER_CELL}
    if (d < 1.2) {
${CRATER_PROFILE}
      acc += (bowl + rim) * depth;
      // d(bowl)/dd is 2d inside the bowl and zero beyond it; d(rim)/dd is the
      // gaussian times its own exponent's derivative. Both read the profile's
      // own defines rather than the numbers they evaluate to: hand-expanded,
      // the sharpness would appear here as twice its square, and a change to it
      // upstream would leave this describing a different crater — silently,
      // because a wrong slope still shades plausibly.
      float dProfile = (2.0 * d * inside)
                     + rim * (-2.0 * CRATER_RIM_SHARPNESS * CRATER_RIM_SHARPNESS
                              * (d - CRATER_RIM_AT));
      // Chain rule out to p: dd/d|offset| is 1/radius, d|offset|/dp is the unit
      // offset, and the outer p *= scale contributes another factor.
      grad += dProfile * depth * scale * offset / max(dist * radius, 1e-6);
    }
  }
  return vec4(grad, acc);
}

// The fine term. It shades nothing: the normal belongs to the craters, so this
// is evaluated once for the albedo and its gradient is never wanted.
float grain(vec3 p) { return fbm4(p * 11.0) * 0.16; }`;

/** The surface itself, patched over three's `<normal_fragment_maps>` — the one
 *  chunk that runs after the geometric normal exists and before the lighting
 *  reads it, which is why both the normal and the albedo are written here. */
const ROCK_SURFACE = /* glsl */ `{
  vec3 p = normalize(vRockP);

  // Scaled for a body a kilometre across rather than a moon: at #57's 3.4 the
  // bowls came out seventy metres wide and the ground between them was glass.
  // The walk's cost, and why there is only one of it, is at
  // cratersAndGradient.
  vec4 pit = cratersAndGradient(p * 2.3, 7.0, 0.42);
  float h = pit.w + grain(p);

  // **The craters alone shape the normal.** The grain was differenced here too
  // — four extra fbm4 calls, four octaves each, so roughly 160 hash lookups a
  // fragment spent on the normal alone. It moved to the albedo below, where it
  // is evaluated once, joining the ridged tier that went there for the same
  // reason.
  //
  // What that gives up is shading relief between craters. What is known about
  // the cost of giving it up is narrow, and is worth stating at its own size
  // rather than as a conclusion: at 200 m, in two stills, on one machine, the
  // two renders could not be told apart by eye. That is the whole of it. It
  // says nothing about other ranges, nothing about the body in motion — where
  // inter-crater relief is exactly the detail that reads as a surface turns —
  // and it is a null result from one observer, which is the weakest thing a
  // comparison can return.
  //
  // The cut rests on that plus the arithmetic above, which is the solid half:
  // 160 hash lookups a fragment is a real number and the screenshots are not.
  // If the rock ever looks flat in flight, this is the first comment to come
  // back to, and the fix is four differenced samples rather than a mystery.
  vec3 slope = pit.xyz - p * dot(pit.xyz, p);

  // The same shape as planet-shaders.ts's reliefNormal ends on — lean the normal away from
  // uphill. The coefficient differs because that one folds its own 2e into the
  // differences and this gradient is analytic.
  vec3 objN = normalize(p - 0.010 * slope);
  normal = normalize(normalMatrix * objN);

  // Rock is not one colour and is not many: the range is narrow on purpose,
  // because a surface painted across its whole albedo range reads as a
  // photograph of noise. What varies is which kind of rock — dust in the
  // basins, exposed face on the rims.
  vec3 dust = vec3(0.44, 0.41, 0.36);
  vec3 face = vec3(0.60, 0.57, 0.51);
  vec3 tone = mix(dust, face, smoothstep(-0.15, 0.35, h));
  // **One noise call for the sub-crater tier, not two.** It was an fbm4 and a
  // ridged pass — two four-octave walks a fragment for colour, on top of
  // grain()'s own. ridged folds |2n-1| over the same field, so one fbm4 gives
  // both: the value tints, and its distance from the midpoint creases.
  float fine = fbm4(p * 19.0);
  tone *= 0.84 + 0.30 * fine;
  tone *= 0.92 + 0.16 * (1.0 - abs(2.0 * fine - 1.0));
  diffuseColor.rgb *= tone / 0.5;
}`;

/**
 * Give a rock its surface from **#57's noise, evaluated per fragment**.
 *
 * The generated-map version this replaces baked a height field into an albedo
 * and a normal map and sampled them triplanar. That worked, and every part of it
 * was a workaround for the same thing: a texture needs coordinates, and an
 * irregular body has no good ones. Box projection seamed, an azimuthal unwrap
 * smeared at the poles, triplanar blending fixed both and left a tiling scale to
 * choose. Sampling a 3D field on the object's own *direction* has none of
 * those problems, because there is nothing to unwrap.
 *
 * Direction, not position: `ROCK_SURFACE` opens on `normalize(vRockP)`, so the
 * radius is discarded and one ray out of the centre carries a single value.
 * That is a radial projection, and it is enough here only because the body is
 * near-spherical — the deviation is the displacement itself. On a genuinely
 * elongated rock the field would smear along the long axis, and the fix would
 * be to sample the unnormalised position at a scale of its own.
 *
 * `NOISE_GLSL` is **imported, not pasted**. That was the whole reason #56
 * deferred this: #57's shader library was still being written, and two copies
 * of a library in flight is worse than a workaround. `RELIEF` is *not* used —
 * the normal comes from an analytic gradient rather than its finite
 * differences — though the tangent construction is deliberately the same shape,
 * so the two remain comparable.
 *
 * **Three keeps doing the lighting.** This is a patch on `MeshStandardMaterial`
 * rather than a `ShaderMaterial`, and that is not a shortcut — the plating,
 * vents and radiators bolted to the rock are lit by the scene's sun and fill,
 * and a rock with its own light model would read as a second object under a
 * second sun. #57 can afford its own because it draws whole planets and nothing
 * else.
 *
 * **What it costs.** `craters` walks a 3×3×3 neighbourhood, and `reliefNormal`
 * derives its normal from four more evaluations of the height field — so the
 * obvious construction pays five walks a fragment. It pays one. The figures
 * that got it there are at `cratersAndGradient`, beside the loop they justify.
 *
 * #57's own note says an implementation should bake this into a normal map at
 * generation. That remains the cheaper answer and it is not taken here, because
 * baking wants coordinates and an irregular body has none — which is the whole
 * reason the maps this replaced were a workaround.
 */
export function applyRockSurface(material: THREE.MeshStandardMaterial) {
	/**
	 * Each splice reports whether it landed.
	 *
	 * `String.replace` with a marker that is not there returns the string
	 * unchanged and says nothing — and three.js renames its chunks between
	 * versions. A no-op splice leaves a **stock** `MeshStandardMaterial` that
	 * compiles and links perfectly, under this material's own cache key, with
	 * no craters on it. Every check that exists would stay green: the refinery
	 * is on screen, it is lit, its program linked, and its program is named
	 * `station-rock` — because that name is set here rather than by the patch.
	 *
	 * So the outcome is recorded where a probe can read it. `userData` rather
	 * than a throw: a broken splice should fail a check, not take the page down
	 * in front of a player, and the console line is worded so the probes'
	 * shader listener catches it too.
	 */
	const splices: Record<string, boolean> = {};
	// Keyed by stage as well as marker: both stages patch
	// `#include <common>`, and one key for the two would let a hit in the
	// fragment stage stand in for a miss in the vertex stage.
	const splice = (
		stage: string,
		source: string,
		marker: string,
		code: string,
	) => {
		const out = source.replace(marker, code);
		splices[`${stage} ${marker}`] = out !== source;
		if (out === source)
			console.error(
				`shader splice missed: ${marker} is not in three.js's ${stage} chunk any more`,
			);
		return out;
	};
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = splice(
			"vertex",
			splice(
				"vertex",
				shader.vertexShader,
				"#include <common>",
				ROCK_VERTEX_COMMON,
			),
			"#include <begin_vertex>",
			ROCK_VERTEX_BODY,
		);
		shader.fragmentShader = splice(
			"fragment",
			splice(
				"fragment",
				shader.fragmentShader,
				"#include <common>",
				ROCK_FRAGMENT_COMMON,
			),
			"#include <normal_fragment_maps>",
			ROCK_SURFACE,
		);
		material.userData.rockSplices = splices;
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
