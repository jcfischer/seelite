/**
 * The cruise warp treatment — spec §5, and the restraint is the specification.
 *
 * §5 is unusually specific about what this must *not* do: the background layer
 * is re-centred on the camera every frame and has no parallax, so it does not
 * move at 20 c, and **all the sense of speed comes from far-layer bodies
 * sweeping past**. A full-screen warp tunnel would hide the one thing selling
 * the speed. So this is a thin field of streaks that marks the regime and stays
 * out of the way, not an effect.
 *
 * ## Why the streaks live in the ship's frame
 *
 * §1 nose-locks velocity in cruise: the ship travels exactly where it points.
 * That makes the direction of travel the camera's own −Z, and a field animated
 * along local +Z is therefore travelling *backwards past the viewer* by
 * construction — no per-particle direction, no wrapping across an arbitrary
 * axis, and nothing to get out of step with the ship when it turns. Give the
 * object the ship's orientation and the field is correct.
 *
 * The rate is deliberately **not** the ship's speed. At 6·10⁶ km/s a particle
 * would cross the whole field in four microseconds, so a literal treatment
 * renders an empty screen. What the eye is being given is a *cue*, keyed to the
 * log of the speed so that the difference between 1 c and 20 c is visible at all
 * — which is the only property this has to have, since the honest velocity
 * readout is the HUD's job and the honest motion is the far layer's.
 */

import * as THREE from "three";

/** How many streaks. Low on purpose (§5): the field is a marker, and every one
 *  of these is something drawn in front of the bodies carrying the speed. */
const STREAK_COUNT = 320;

/** The disc the streaks are scattered in, kilometres — and the hole in the
 *  middle of it. The hole is what keeps the treatment out of the centre of the
 *  screen, where the target is. */
const FIELD_RADIUS_KM = 7;
const FIELD_HOLE_KM = 0.6;

/** How far forward and back the field extends, kilometres. Comfortably inside
 *  the near layer's reach and far outside its near plane. */
const FIELD_HALF_LENGTH_KM = 14;

/** Streak length at full intensity, kilometres. At zero intensity they are
 *  points and invisible, which is what makes the fade-in continuous. */
const STREAK_MAX_KM = 3.2;

/** How fast the field flows past at full intensity, km/s of *apparent* motion.
 *  See the module docstring: a cue, not the speed. */
const FLOW_KMS = 26;

/** Below this fraction of `v_max` the field is not drawn at all — the regime is
 *  marked by the HUD alone at a crawl, and streaks at 100 km/s would read as a
 *  bug rather than as speed. */
const INTENSITY_FLOOR = 0.02;

export interface WarpField {
	/** Add this to the near scene. It sits at the origin with the camera. */
	object: THREE.LineSegments;
	/**
	 * Advance the field.
	 *
	 * `intensity` is 0…1 — `log(v/v_min) / log(v_max/v_min)` is what the caller
	 * passes, not `v/v_max`, because a linear fraction spends the whole approach
	 * at nearly zero and then snaps on.
	 */
	update(intensity: number, orientation: THREE.Quaternion, dt: number): void;
	dispose(): void;
}

/**
 * Build the field. Deterministic in `seed`, like everything else drawn from a
 * generator here — a warp field that reshuffled on every entry would flicker
 * across a drop-out and re-entry.
 */
export function warpField(seed: number): WarpField {
	// A tiny local generator rather than `rng.ts`'s streams: this is scenery in
	// the renderer, it feeds no simulation, and giving it a domain tag in the
	// per-system stream registry would imply the world depends on it.
	let s = (seed ^ 0x5eed1e) >>> 0;
	const rand = () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x1_0000_0000;
	};

	const base = new Float32Array(STREAK_COUNT * 3);
	for (let i = 0; i < STREAK_COUNT; i++) {
		// Uniform in the annulus: the square root is what stops them piling up
		// against the hole.
		const r = Math.sqrt(
			FIELD_HOLE_KM ** 2 + rand() * (FIELD_RADIUS_KM ** 2 - FIELD_HOLE_KM ** 2),
		);
		const a = rand() * Math.PI * 2;
		base[i * 3] = Math.cos(a) * r;
		base[i * 3 + 1] = Math.sin(a) * r;
		base[i * 3 + 2] = (rand() * 2 - 1) * FIELD_HALF_LENGTH_KM;
	}

	const positions = new Float32Array(STREAK_COUNT * 6);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	// The field surrounds the camera and is rewritten every frame; a bounding
	// sphere computed from it would be recomputed for nothing.
	geometry.boundingSphere = new THREE.Sphere(
		new THREE.Vector3(),
		FIELD_HALF_LENGTH_KM * 2,
	);

	const material = new THREE.LineBasicMaterial({
		color: 0xbfe3ff,
		transparent: true,
		opacity: 0,
		// Additive, so a streak crossing a planet brightens it rather than
		// punching a hole in it — §5's "not enough to occlude the view", enforced
		// by the blend mode rather than by hoping the alpha is low enough.
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

	const object = new THREE.LineSegments(geometry, material);
	object.name = "warp";
	object.frustumCulled = false;
	object.visible = false;

	const color = new THREE.Color();
	const calm = new THREE.Color(0xbfe3ff);
	const fast = new THREE.Color(0xd9c2ff);

	return {
		object,
		update(intensity, orientation, dt) {
			const k = Math.min(1, Math.max(0, intensity));
			object.visible = k > INTENSITY_FLOOR;
			if (!object.visible) return;
			object.quaternion.copy(orientation);

			const flow = FLOW_KMS * k * dt;
			const len = STREAK_MAX_KM * k;
			for (let i = 0; i < STREAK_COUNT; i++) {
				// +Z is behind the ship — the field flows backwards past the viewer,
				// which is the whole of the animation.
				let z = base[i * 3 + 2] + flow;
				if (z > FIELD_HALF_LENGTH_KM) {
					z -= FIELD_HALF_LENGTH_KM * 2;
				}
				base[i * 3 + 2] = z;
				const x = base[i * 3];
				const y = base[i * 3 + 1];
				positions[i * 6] = x;
				positions[i * 6 + 1] = y;
				positions[i * 6 + 2] = z;
				positions[i * 6 + 3] = x;
				positions[i * 6 + 4] = y;
				positions[i * 6 + 5] = z - len;
			}
			geometry.attributes.position.needsUpdate = true;
			material.opacity = 0.55 * k;
			material.color.copy(color.copy(calm).lerp(fast, k));
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		},
	};
}
