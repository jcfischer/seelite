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
import {
	ROCK_TEXTURE_SIZE,
	rockAlbedoTexels,
	rockNormalTexels,
} from "./station-visuals";

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
 * Patch a `MeshStandardMaterial` to sample its colour and normal maps
 * **triplanar**, in object space, with no UVs at all.
 *
 * Box projection got the rock most of the way there and left one artefact it
 * cannot avoid: the projection axis is chosen per face, so wherever the
 * dominant axis flips the UV jumps and the map discontinues. On a plated hull
 * that seam falls along a facet edge and is invisible; on a rock it reads as a
 * flat shelf cut across the relief, which is worse than the smearing it
 * replaced.
 *
 * Triplanar samples all three projections and blends them by the normal, so
 * there is no seam to fall on and no unwrap to smear. It is a *patch* rather
 * than a `ShaderMaterial` on purpose: everything about how the surface is lit —
 * the scene's sun, the fill, tone mapping — stays Three's, and this branch does
 * not acquire a second lighting model that #57's planet shaders would then have
 * to be reconciled with.
 *
 * The normal blend is the "whiteout" form: each planar sample is swizzled into
 * object space and added to the geometric normal before the blend, which keeps
 * relief on faces the projection is edge-on to instead of flattening them.
 */
export function applyTriplanar(
	material: THREE.MeshStandardMaterial,
	scaleKm: number,
) {
	material.onBeforeCompile = (shader) => {
		shader.uniforms.triScale = { value: 1 / scaleKm };
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
varying vec3 vTriPos;
varying vec3 vTriNormal;`,
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
vTriPos = position;
vTriNormal = normal;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>
uniform float triScale;
// Declared here on purpose: three.js puts normalMatrix in the vertex prefix
// only, and the renderer sets it on whatever program declares it. The blend
// below has to leave object space, and this is the transform it leaves by.
uniform mat3 normalMatrix;
varying vec3 vTriPos;
varying vec3 vTriNormal;
// Raised to a high power so the blend is narrow: a wide one averages three
// samples over most of the surface and reads as a blur rather than as stone.
vec3 triWeights() {
  vec3 w = pow(abs(normalize(vTriNormal)), vec3(6.0));
  return w / (w.x + w.y + w.z);
}`,
			)
			.replace(
				"#include <map_fragment>",
				`{
  vec3 w = triWeights();
  vec2 uX = vTriPos.zy * triScale;
  vec2 uY = vTriPos.xz * triScale;
  vec2 uZ = vTriPos.xy * triScale;
  vec4 tri = texture2D(map, uX) * w.x
           + texture2D(map, uY) * w.y
           + texture2D(map, uZ) * w.z;
  diffuseColor *= tri;
}`,
			)
			.replace(
				"#include <normal_fragment_maps>",
				`{
  vec3 w = triWeights();
  vec3 gn = normalize(vTriNormal);
  vec3 nX = texture2D(normalMap, vTriPos.zy * triScale).xyz * 2.0 - 1.0;
  vec3 nY = texture2D(normalMap, vTriPos.xz * triScale).xyz * 2.0 - 1.0;
  vec3 nZ = texture2D(normalMap, vTriPos.xy * triScale).xyz * 2.0 - 1.0;
  nX.xy *= normalScale;
  nY.xy *= normalScale;
  nZ.xy *= normalScale;
  // Whiteout blend: fold the geometric normal in before swizzling, so a face
  // the projection is edge-on to keeps its relief instead of going flat.
  nX = vec3(nX.xy + gn.zy, abs(nX.z) * gn.x);
  nY = vec3(nY.xy + gn.xz, abs(nY.z) * gn.y);
  nZ = vec3(nZ.xy + gn.xy, abs(nZ.z) * gn.z);
  vec3 objN = normalize(nX.zyx * w.x + nY.xzy * w.y + nZ.xyz * w.z);
  normal = normalize(normalMatrix * objN);
}`,
			);
	};
	// Two materials with the same `onBeforeCompile` source still compile twice
	// unless they agree they are the same program.
	material.customProgramCacheKey = () => `station-triplanar-${scaleKm}`;
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
 * The rock surface maps, built once and shared by every asteroid.
 *
 * One pair for all three refinery forms: they are the same rock at the same
 * scale, and a per-form map would be three uploads of nearly identical texels.
 * What differs between the forms is the *displacement*, which is per-form and
 * seeded by tag — that is what makes them different rocks.
 */
const buildRockMaps = () => {
	const albedo = new THREE.DataTexture(
		rockAlbedoTexels("station"),
		ROCK_TEXTURE_SIZE,
		ROCK_TEXTURE_SIZE,
		THREE.RGBAFormat,
	);
	albedo.colorSpace = THREE.SRGBColorSpace;
	const normal = new THREE.DataTexture(
		rockNormalTexels("station"),
		ROCK_TEXTURE_SIZE,
		ROCK_TEXTURE_SIZE,
		THREE.RGBAFormat,
	);
	// **Linear, not sRGB.** A normal map is a vector field, not a colour: read
	// as sRGB every component is bent by the transfer curve and the lighting
	// leans in a direction nothing in the geometry points.
	for (const map of [albedo, normal]) {
		map.wrapS = THREE.RepeatWrapping;
		map.wrapT = THREE.RepeatWrapping;
		map.minFilter = THREE.LinearMipmapLinearFilter;
		map.generateMipmaps = true;
		map.needsUpdate = true;
	}
	return { albedo, normal };
};

/** Built on first use, not at import: `station-mesh.ts` is imported by the
 *  headless tier, and two 256² buffers plus their textures are a cost nothing
 *  there can use. */
let rockMapsCache: ReturnType<typeof buildRockMaps> | undefined;
const rockMaps = () => (rockMapsCache ??= buildRockMaps());

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
	// Box-projected, so the surface maps do not smear into the poles the way an
	// azimuthal unwrap does on a body this irregular. One repeat per 90 m: the
	// rock's own displacement carries everything larger, and this carries
	// everything smaller.
	const { albedo, normal } = rockMaps();
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({
			// Lighter than rock looks in a swatch, for #28's reason: the near
			// layer's only fill is a dim camera-side light, and a physically
			// plausible dark asteroid renders as a hole in the starfield.
			color: 0x9a8a72,
			map: albedo,
			normalMap: normal,
			// Strong: the map is the only thing carrying surface at the scale a
			// pilot is close enough to see, and a rock has no gloss to fight it.
			normalScale: new THREE.Vector2(1.4, 1.4),
			roughness: 0.95,
			metalness: 0.02,
			// **Smooth-shaded now.** Flat shading was doing the job the normal map
			// does, and does worse: it quantises the surface to the tessellation,
			// so a rock looked faceted at every range instead of grained close up
			// and round far off. The two fight each other — a facet's constant
			// normal flattens the map's relief across the whole triangle.
			flatShading: false,
		}),
	);
	// One repeat per 180 m. At 90 m the grain read as noise rather than as
	// stone: the features a rock shows are metres to tens of metres, and the map
	// has to be scaled so its own pits land in that range.
	applyTriplanar(mesh.material as THREE.MeshStandardMaterial, 0.18);
	mesh.name = "asteroid";
	return mesh;
}
