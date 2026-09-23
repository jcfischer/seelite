/** Draw costly planet surfaces into one half-size buffer, then put their colour
 * back on full-size spheres. The second draw writes the sphere's real depth and
 * silhouette; clouds, atmosphere and rings remain in the ordinary approach
 * pass. The target is shared by all selected surfaces in that pass. */
import * as THREE from "three";
import type { SurfaceClass } from "./planet-appearance";

/** CSS-pixel radius: at 900 px height, a disc this wide covers two thirds of
 * the image. Smaller discs keep their surface pixels on the high setting. */
export const HALF_RES_RADIUS_PX = 300;

export function useHalfResolution(
	layer: "near" | "approach" | "far",
	surface: SurfaceClass,
	quality: "high" | "low",
	radiusPx: number,
): boolean {
	return (
		layer === "approach" &&
		surface !== "star" &&
		(quality === "low" || radiusPx >= HALF_RES_RADIUS_PX)
	);
}

export function halfTargetSize(width: number, height: number) {
	return {
		width: Math.max(1, Math.ceil(width / 2)),
		height: Math.max(1, Math.ceil(height / 2)),
	};
}

type SurfaceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

export class PlanetHalfResolution {
	private target: THREE.WebGLRenderTarget | null = null;
	private readonly fullSize = new THREE.Vector2(1, 1);
	private readonly composite = new THREE.ShaderMaterial({
		uniforms: {
			lowRes: { value: null as THREE.Texture | null },
			invFullSize: { value: new THREE.Vector2(1, 1) },
		},
		vertexShader: /* glsl */ `
			void main() {
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform sampler2D lowRes;
			uniform vec2 invFullSize;
			void main() {
				vec4 colour = texture2D(lowRes, gl_FragCoord.xy * invFullSize);
				// The clear is transparent black. Undo bilinear dilution at the edge;
				// this full-size sphere supplies the coverage and depth itself.
				gl_FragColor = vec4(colour.rgb / max(colour.a, 0.001), 1.0);
			}
		`,
		depthWrite: true,
		depthTest: true,
	});
	private engaged = false;
	private allowed = true;

	/** Probe/control arm: compare the same frame against the full-size surface. */
	setAllowed(allowed: boolean) {
		this.allowed = allowed;
	}

	private ensureTarget(width: number, height: number) {
		if (!this.target) {
			this.target = new THREE.WebGLRenderTarget(width, height, {
				type: THREE.HalfFloatType,
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				depthBuffer: true,
			});
			this.target.texture.name = "planet-surface-half-res";
		} else if (this.target.width !== width || this.target.height !== height) {
			this.target.setSize(width, height);
		}
		return this.target;
	}

	/** Compile the same surface programs against the half target that a later
	 * prepass will use. A target's output colour space is a program key. */
	prewarmSurfaces(
		renderer: THREE.WebGLRenderer,
		camera: THREE.PerspectiveCamera,
		surfaces: readonly SurfaceMesh[],
	) {
		const scene = new THREE.Scene();
		const geometry = new THREE.SphereGeometry(1, 8, 6);
		for (const surface of surfaces) {
			const mesh = new THREE.Mesh(geometry, surface.material);
			mesh.position.z = -5;
			scene.add(mesh);
		}
		const was = renderer.getRenderTarget();
		renderer.setRenderTarget(this.ensureTarget(1, 1));
		try {
			renderer.compile(scene, camera);
		} finally {
			renderer.setRenderTarget(was);
			geometry.dispose();
		}
	}

	/** Compile the full-size blit before the first close approach. */
	prewarmComposite(
		renderer: THREE.WebGLRenderer,
		camera: THREE.PerspectiveCamera,
		composerTarget: THREE.WebGLRenderTarget,
	) {
		const scene = new THREE.Scene();
		const geometry = new THREE.PlaneGeometry(1, 1);
		const mesh = new THREE.Mesh(geometry, this.composite);
		mesh.position.z = -5;
		scene.add(mesh);
		// The real approach pass has one sun and one hemisphere. ShaderMaterial
		// still includes their counts in its program key, even when it reads no
		// light uniforms of its own.
		scene.add(new THREE.DirectionalLight(), new THREE.HemisphereLight());
		const was = renderer.getRenderTarget();
		renderer.setRenderTarget(composerTarget);
		try {
			renderer.compile(scene, camera);
		} finally {
			renderer.setRenderTarget(was);
			geometry.dispose();
		}
	}

	/** Run the surface-only draw, attach the full-size composite material, and
	 * return a restoration callback for the composer call's finally block. */
	begin(
		renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.PerspectiveCamera,
		surfaces: readonly SurfaceMesh[],
	): () => void {
		this.engaged = this.allowed && surfaces.length > 0;
		if (!this.engaged) return () => {};
		renderer.getDrawingBufferSize(this.fullSize);
		const size = halfTargetSize(this.fullSize.x, this.fullSize.y);
		const target = this.ensureTarget(size.width, size.height);
		this.composite.uniforms.lowRes.value = target.texture;
		(this.composite.uniforms.invFullSize.value as THREE.Vector2).set(
			1 / this.fullSize.x,
			1 / this.fullSize.y,
		);
		const beforeTarget = renderer.getRenderTarget();
		const beforeLayerMask = camera.layers.mask;
		const beforeClearColor = renderer.getClearColor(new THREE.Color()).clone();
		const beforeClearAlpha = renderer.getClearAlpha();
		const originals = surfaces.map((surface) => surface.material);
		try {
			for (const surface of surfaces) surface.layers.enable(1);
			camera.layers.set(1);
			renderer.setRenderTarget(target);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
			renderer.render(scene, camera);
		} finally {
			camera.layers.mask = beforeLayerMask;
			for (const surface of surfaces) surface.layers.disable(1);
			renderer.setRenderTarget(beforeTarget);
			renderer.setClearColor(beforeClearColor, beforeClearAlpha);
		}
		for (const surface of surfaces) surface.material = this.composite;
		return () => {
			for (let i = 0; i < surfaces.length; i++) {
				const surface = surfaces[i];
				const material = originals[i];
				if (surface && material) surface.material = material;
			}
		};
	}

	snapshot() {
		return {
			engaged: this.engaged,
			fullWidth: this.fullSize.x,
			fullHeight: this.fullSize.y,
			targetWidth: this.target?.width ?? 0,
			targetHeight: this.target?.height ?? 0,
		};
	}

	dispose() {
		this.target?.dispose();
		this.composite.dispose();
	}
}
