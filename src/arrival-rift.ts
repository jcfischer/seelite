/**
 * The arrival rift (#532): the world-anchored half of a jump's exit.
 *
 * #195's D2 ruled that the exit has a form **visible from outside the ship**,
 * not only a screen-space fade: #530's opening films an arrival from a fly-past
 * camera, and #262's NPC arrivals can reuse the same object. A screen-only exit
 * would have made both invent their own.
 *
 * ## Where it stands
 *
 * At the arrival point, `standoffReaches` of the arriving hull's reach **behind**
 * it on its nose axis, facing along the nose — the ship has just come through
 * it. From the cockpit it is behind the pilot, which is what the tunnel's
 * collapse on screen is for; from a chase camera, which sits behind the ship along its nose,
 * the camera looks through it at the ship.
 *
 * The anchor is float64 world kilometres and is never written into the scene
 * graph: `update` places the object **camera-relative**, the way every ship in
 * `main.ts` is placed, so the scene graph stays display only (`CLAUDE.md`).
 *
 * ## Which layer
 *
 * The near layer, the way a ship is — a rift is ship-scale. It is sized from the
 * hull's reach, so a carrier's is a carrier's width.
 *
 * ## What it owns
 *
 * Its geometry and its material, per instance. Nothing is `shared`: a rift is
 * rare, and a shared material between the player's and an NPC's would let one
 * teardown black out the other (`gpu-teardown.ts`).
 */
import * as THREE from "three";
import type { Vec3 } from "./vec3";
import { WITCHSPACE_MIST_GLSL, WITCHSPACE_VERTEX } from "./witchspace-mist";

export const ARRIVAL_RIFT = Object.freeze({
	/** Radius at full strength, in the arriving hull's reach. */
	// Sized so a chase camera sees the ring round the ship: at three reaches and
	// two behind, the ring overfilled the frame and only its haze showed.
	radiusReaches: 1.6,
	/** How far behind the ship the rift stands, in its reach. */
	standoffReaches: 1,
	/** The radius it opens from, as a fraction of the full one. */
	openFrom: 0.3,
});

/**
 * **The lens is the player's rift's alone.** The pass carries one lens and
 * `main.ts` feeds it from `arrivalRift`; #262's NPC arrivals can reuse this
 * object for the ring, but their sky will not bend until the pass carries more
 * than one lens.
 *
 * The ring of light a lens makes, in the tunnel's palette: space bends here,
 * it does not swirl (the principal's fourth flight). The bending itself is
 * the witchspace pass's `uLensE`, which pulls the sky behind the rift round
 * it; this draws the Einstein ring that lensing piles the light into, a faint
 * haze inside it, and nothing that turns. Additive: it adds light and never
 * darkens what is behind it. Three octaves and not the pass's four, because
 * from outside the rift is a subject in the frame rather than the whole of it;
 * it is drawn the same on both sides of #99's key.
 */
const FRAGMENT = /* glsl */ `
#define OCTAVES 3
uniform float uStrength;
uniform float uPhase;
varying vec2 vUv;
${WITCHSPACE_MIST_GLSL}
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) discard;
	// Noise over the disc as it lies, drifting only in time: it varies the
	// ring's brightness and colour and never winds it.
	vec3 q = vec3(p * 2.4, uPhase * 0.5);
	float n = witchFbm(q * 1.3 + witchFbm(q) * 1.2);
	float x = (r - 0.9) / 0.045;
	float ring = exp(-x * x);
	// The inside stays clear: from a chase camera the rift stands between the
	// camera and the ship, and light there would wash the ship out.
	float haze = (1.0 - smoothstep(0.6, 0.9, r)) * smoothstep(0.35, 0.75, r) * 0.3;
	vec3 tint = witchPalette(n * 1.4 + uPhase * 0.1);
	vec3 col = tint * (ring * (0.7 + 0.9 * n) + haze * n);
	gl_FragColor = vec4(col * uStrength, 1.0);
}
`;

export interface RiftPlacement {
	/** The arriving ship's position, world km. */
	pos: Vec3;
	/** Its nose, a unit vector. The rift faces along it. */
	nose: Vec3;
	/** The arriving hull's display reach, km (`HULL_REACH_KM`). */
	reachKm: number;
}

export class ArrivalRift {
	readonly object: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
	/** The rift's centre, world km. */
	readonly anchor: Vec3;
	private readonly fullRadiusKm: number;

	constructor({ pos, nose, reachKm }: RiftPlacement) {
		const back = ARRIVAL_RIFT.standoffReaches * reachKm;
		this.anchor = {
			x: pos.x - nose.x * back,
			y: pos.y - nose.y * back,
			z: pos.z - nose.z * back,
		};
		this.fullRadiusKm = ARRIVAL_RIFT.radiusReaches * reachKm;
		const material = new THREE.ShaderMaterial({
			uniforms: { uStrength: { value: 0 }, uPhase: { value: 0 } },
			vertexShader: WITCHSPACE_VERTEX,
			fragmentShader: FRAGMENT,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.object = new THREE.Mesh(new THREE.CircleGeometry(1, 64), material);
		this.object.name = "arrival-rift";
		// The occlusion passes see what casts a shadow; a sheet of light does not.
		this.object.castShadow = false;
		this.object.receiveShadow = false;
		this.object.frustumCulled = false;
		this.object.visible = false;
		// CircleGeometry faces +Z; turn it to face along the nose.
		this.object.quaternion.setFromUnitVectors(
			new THREE.Vector3(0, 0, 1),
			new THREE.Vector3(nose.x, nose.y, nose.z).normalize(),
		);
	}

	/** The radius currently drawn, km. */
	get radiusKm(): number {
		return this.object.scale.x;
	}

	/** What is drawn, for a probe to read by name. */
	get strength(): number {
		return this.object.material.uniforms.uStrength.value as number;
	}

	/**
	 * One frame: the strength from `witchspaceLook`, the phase for the drift, and
	 * the camera's world position for the camera-relative placement.
	 */
	update(strength: number, phase: number, cameraPos: Vec3) {
		this.object.visible = strength > 0;
		const u = this.object.material.uniforms;
		u.uStrength.value = strength;
		u.uPhase.value = phase;
		const open =
			ARRIVAL_RIFT.openFrom + (1 - ARRIVAL_RIFT.openFrom) * Math.sqrt(strength);
		this.object.scale.setScalar(this.fullRadiusKm * open);
		this.object.position.set(
			this.anchor.x - cameraPos.x,
			this.anchor.y - cameraPos.y,
			this.anchor.z - cameraPos.z,
		);
	}
}
