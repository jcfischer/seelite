/**
 * The drill camera's render pass, https://github.com/jcfischer/seelite/issues/1229.
 *
 * A second camera draws the near scene into a small off-screen target, and the
 * Longwall bridge's `screen-drillcam` shows that target. It is a render pass
 * rather than a canvas because the feed is the game's own world: the rock, the
 * laser strokes and the rotor as this frame poses them.
 *
 * Three decisions live here because they are the pass's, not the caller's. The
 * rotor's part (`feed`) is hidden in the cockpit by `cockpitDrillView`, since the
 * hull hides it from both seats, so the pass shows it for its own render and puts
 * it back. The shadow map is pinned for the same reason #241 pins it around the
 * GTAO override: this is a second full `WebGLRenderer.render` of the near scene,
 * and three would otherwise rebuild the whole 2048² map for a 640-texel picture.
 * And the scene is restored in a `finally`, because a paint that throws must not
 * leave the cockpit's visibility or the shadow map changed.
 */
import * as THREE from "three";
import { DRILL_CAMERA, type DrillCameraPose } from "./drill-camera";

/** The part of a renderer one feed paint needs: the call shape, not the renderer. */
export interface DrillCameraPaint {
	readonly shadowMap: { autoUpdate: boolean };
	setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
	clear(): void;
	render(scene: THREE.Object3D, camera: THREE.Camera): void;
}

const DRILL_LEVEL = "longwall-exterior";
const DRILL_FEED = "feed";

/** One camera and one target, reused every frame the gate opens. */
export class DrillCameraFeed {
	readonly target: THREE.WebGLRenderTarget;
	readonly camera: THREE.PerspectiveCamera;
	frames = 0;

	constructor(width: number, height: number, fovDeg: number) {
		this.target = new THREE.WebGLRenderTarget(width, height, {
			type: THREE.HalfFloatType,
			depthBuffer: true,
			stencilBuffer: false,
			samples: 0,
		});
		this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.camera = new THREE.PerspectiveCamera(
			fovDeg,
			width / Math.max(1, height),
			DRILL_CAMERA.nearKm,
			DRILL_CAMERA.farKm,
		);
	}

	/** Draw the near scene from `pose`, then leave the scene as it was
	 *  (https://github.com/jcfischer/seelite/issues/1229). */
	render(
		paint: DrillCameraPaint,
		scene: THREE.Object3D,
		shipRoot: THREE.Object3D,
		pose: DrillCameraPose,
	): void {
		const level = shipRoot.getObjectByName(DRILL_LEVEL);
		const feed = level?.getObjectByName(DRILL_FEED);
		const levelWas = level?.visible;
		const feedWas = feed?.visible;
		try {
			if (level) level.visible = true;
			if (feed) feed.visible = true;
			this.camera.position.set(pose.eyeKm.x, pose.eyeKm.y, pose.eyeKm.z);
			this.camera.up.set(pose.up.x, pose.up.y, pose.up.z);
			this.camera.lookAt(pose.aimKm.x, pose.aimKm.y, pose.aimKm.z);
			this.camera.updateMatrixWorld();
			const shadowWas = paint.shadowMap.autoUpdate;
			paint.shadowMap.autoUpdate = false;
			try {
				paint.setRenderTarget(this.target);
				paint.clear();
				paint.render(scene, this.camera);
			} finally {
				paint.setRenderTarget(null);
				paint.shadowMap.autoUpdate = shadowWas;
			}
			this.frames++;
		} finally {
			if (level && levelWas !== undefined) level.visible = levelWas;
			if (feed && feedWas !== undefined) feed.visible = feedWas;
		}
	}

	dispose(): void {
		this.target.dispose();
	}
}
