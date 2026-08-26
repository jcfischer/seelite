/**
 * The drawn form of one celestial body: its surface, and whichever shells its
 * class earns.
 *
 * **Display only, and the boundary is the point.** Nothing here reads a
 * position back out of an `Object3D` and nothing here decides what a body *is*
 * — `planet-appearance.ts` classifies, `system.ts` generates, and this module
 * draws. It is the durable home of what `?planet-prototype` established in
 * #54: the gallery is disposable, the way a body is built is not.
 *
 * **Everything is authored on a unit sphere.** The renderer sizes a body with
 * `mesh.scale = radiusKm × layerFactor` (`units.ts`), so a shell at 1.014 radii
 * stays at 1.014 radii in the far, approach and near layers alike, and the
 * handoff is a scale assignment rather than a geometry rebuild. Hand back
 * kilometres here and every body is drawn `radiusKm` times too large.
 *
 * The one thing that is *not* scale-invariant is a position, which is why the
 * sun arrives as a **direction**: the star is 1.5·10⁸ km away in sim space and
 * 1,500 units away in the far layer, and only the unit vector between them
 * means the same thing in both.
 */

import * as THREE from "three";
import type { PlanetAppearance, SurfaceClass } from "./planet-appearance";
import {
	ATMOSPHERE_FRAGMENT,
	CLOUD_FRAGMENT,
	RING_FRAGMENT,
	RING_VERTEX,
	SURFACE_VERTEX,
	fragmentFor,
} from "./planet-shaders";

/**
 * Where the light comes from when the caller does not say.
 *
 * 51 degrees off the view axis: far enough that every body has a terminator,
 * near enough that a gallery is not half in shadow. The live renderer always
 * says, because its star has a real position; the prototype does not, because
 * it has no star.
 */
export const DEFAULT_SUN_DIRECTION = new THREE.Vector3(
	0.62,
	0.3,
	0.55,
).normalize();

export interface BodyVisualOptions {
	/** Unit vector from the body towards its star. Defaults to
	 *  `DEFAULT_SUN_DIRECTION`; the live renderer updates it every frame,
	 *  because bodies orbit. */
	sunDir?: THREE.Vector3;
	/** The star's own colour, for the light it casts on everything else. */
	sunColor?: number;
	/** The star's colour as its *own* photosphere, which is a different
	 *  question from the light it casts and is read only by the star class. */
	starTint?: number;
}

export interface BodyVisual {
	/** Add this to a layer's scene, and scale it by `radiusKm × layerFactor`. */
	group: THREE.Group;
	/** Shared by the surface and every shell, so the cloud deck, the atmosphere
	 *  and the rings all see the same sun and the same clock without any of them
	 *  being told about it separately. */
	uniforms: Record<string, THREE.IUniform>;
	surface: SurfaceClass;
	/** Unit vector from the body towards its star, in any frame — it is a
	 *  direction, so every frame agrees about it. */
	setSunDirection(direction: THREE.Vector3): void;
	/** The world clock, seconds. Drives cloud drift and stellar granulation;
	 *  every other class ignores it. */
	setTime(seconds: number): void;
	dispose(): void;
}

/** A radial falloff, drawn once into a canvas. No asset, no request. */
function coronaTexture(): THREE.Texture {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d context for the corona");
	const gradient = ctx.createRadialGradient(
		size / 2,
		size / 2,
		size * 0.16,
		size / 2,
		size / 2,
		size / 2,
	);
	gradient.addColorStop(0, "rgba(255,235,200,0.95)");
	gradient.addColorStop(0.25, "rgba(255,190,120,0.30)");
	gradient.addColorStop(0.6, "rgba(255,150,80,0.06)");
	gradient.addColorStop(1, "rgba(255,140,70,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

/** The cloud shell is the same radius on every body that has one, so it is one
 *  geometry rather than one per body. The atmosphere shell's radius varies with
 *  optical depth, so that one genuinely cannot be shared. */
const CLOUD_GEOMETRY = new THREE.SphereGeometry(1.014, 128, 84);

/** The atmosphere shell is a unit sphere scaled per body, rather than one
 *  tessellation per distinct radius: the radius varies with optical depth, but
 *  a scale on the mesh expresses that without building the same ~6k vertices
 *  again for each of the ladder's five values. */
const SHELL_GEOMETRY = new THREE.SphereGeometry(1, 96, 64);

export function buildBodyVisual(
	look: PlanetAppearance,
	sphere: THREE.BufferGeometry,
	opts: BodyVisualOptions = {},
): BodyVisual {
	const uniforms: Record<string, THREE.IUniform> = {
		time: { value: 0 },
		// A direction, not a position, so it is the same vector at every render
		// scale — which is what lets one uniform serve the far, approach and near
		// layers without a per-layer copy.
		sunDir: { value: (opts.sunDir ?? DEFAULT_SUN_DIRECTION).clone() },
		sunColor: { value: new THREE.Color(opts.sunColor ?? 0xfff7eb) },
		// A thick atmosphere carries light well past the geometric terminator;
		// an airless body does not carry it at all.
		wrapAmount: { value: look.atmosphere * 0.32 },
		seedOffset: { value: (look.seed % 997) / 97 },
		warmth: { value: look.warmth },
		seaLevel: { value: look.seaLevel },
		starTint: { value: new THREE.Color(opts.starTint ?? 0xfff4ea) },
		atmoColor: { value: new THREE.Color(look.atmosphereColor) },
		atmoStrength: { value: look.atmosphere },
		cloudCover: { value: look.cloudCover },
		// Water cloud is neutral; a dust haze is the colour of the ground it
		// was lifted from.
		cloudTint: {
			value: new THREE.Color(look.surface === "desert" ? 0xb08a62 : 0xdfe8f0),
		},
		innerR: { value: 1.35 },
		outerR: { value: 2.3 },
	};

	const group = new THREE.Group();
	const planet = new THREE.Mesh(
		sphere,
		new THREE.ShaderMaterial({
			uniforms,
			vertexShader: SURFACE_VERTEX,
			fragmentShader: fragmentFor(look.surface),
		}),
	);
	group.add(planet);

	if (look.cloudCover > 0) {
		group.add(
			new THREE.Mesh(
				CLOUD_GEOMETRY,
				new THREE.ShaderMaterial({
					uniforms,
					transparent: true,
					depthWrite: false,
					vertexShader: SURFACE_VERTEX,
					fragmentShader: CLOUD_FRAGMENT,
				}),
			),
		);
	}
	if (look.atmosphere > 0) {
		// Back faces only, additively: the shell is a volume seen from outside,
		// and drawing its front faces would put a wash over the whole disc.
		const shell = new THREE.Mesh(
			SHELL_GEOMETRY,
			new THREE.ShaderMaterial({
				uniforms,
				transparent: true,
				depthWrite: false,
				side: THREE.BackSide,
				blending: THREE.AdditiveBlending,
				vertexShader: SURFACE_VERTEX,
				fragmentShader: ATMOSPHERE_FRAGMENT,
			}),
		);
		// A thicker shell stands further off the surface. On the shared unit
		// geometry that is a scale rather than its own tessellation.
		shell.scale.setScalar(1.03 + look.atmosphere * 0.025);
		group.add(shell);
	}
	if (look.hasRings) {
		const ring = new THREE.Mesh(
			new THREE.PlaneGeometry(4.8, 4.8, 1, 1),
			new THREE.ShaderMaterial({
				uniforms,
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				vertexShader: RING_VERTEX,
				fragmentShader: RING_FRAGMENT,
			}),
		);
		ring.rotation.x = Math.PI / 2 - 0.32;
		// Named so a probe can hide it: a ring crosses the disc and is lit by the
		// sun whatever the planet behind it is doing, so any measurement *of the
		// surface* has to be able to take it out of the frame.
		ring.name = "decor";
		group.add(ring);
	}
	if (look.surface === "star") {
		// A corona sprite rather than a shader shell: the glow is unbounded and
		// a sphere would cut it off at a radius the star does not have.
		const corona = new THREE.Sprite(
			new THREE.SpriteMaterial({
				color: 0xffd9a8,
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				opacity: 0.55,
				map: coronaTexture(),
			}),
		);
		corona.scale.setScalar(5.2);
		corona.name = "decor";
		group.add(corona);
	}

	// A fixed axial tilt, so a sphere lit from the side reads as a rotating
	// body rather than as a ball. Per-body tilt would be a generator question —
	// the axis decides seasons — and nothing in the sim has an axis yet.
	group.rotation.z = 0.18;

	const surfaceMaterial = planet.material as THREE.ShaderMaterial;
	return {
		group,
		uniforms,
		surface: look.surface,
		setSunDirection(direction) {
			(uniforms.sunDir.value as THREE.Vector3).copy(direction);
		},
		setTime(seconds) {
			uniforms.time.value = seconds;
		},
		dispose() {
			// The shared geometries are module constants and outlive any one body;
			// the materials are per body and do not.
			surfaceMaterial.dispose();
			for (const child of group.children)
				if (child instanceof THREE.Mesh || child instanceof THREE.Sprite)
					(child.material as THREE.Material).dispose();
		},
	};
}
