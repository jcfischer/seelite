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
 * it. From the cockpit it is behind the pilot, which is what the screen-space
 * fade is for; from a chase camera, which sits behind the ship along its nose,
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

export const ARRIVAL_RIFT = Object.freeze({
	/** Radius at full strength, in the arriving hull's reach. */
	radiusReaches: 3,
	/** How far behind the ship the rift stands, in its reach. */
	standoffReaches: 2,
	/** The radius it opens from, as a fraction of the full one. */
	openFrom: 0.3,
});

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * A bright rim, a cold swirl inside it, and a clear centre so the ship coming
 * through it stays readable. Additive: it adds light and never darkens what is
 * behind it.
 */
const FRAGMENT = /* glsl */ `
uniform float uStrength;
uniform float uPhase;
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) discard;
	float a = atan(p.y, p.x);
	float rim = smoothstep(0.78, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
	float swirl = 0.5 + 0.5 * sin(a * 7.0 + r * 14.0 - uPhase * 6.0);
	float body = smoothstep(0.25, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
	vec3 rimColour = vec3(0.9, 0.95, 1.6) * rim * 3.0;
	vec3 swirlColour = vec3(0.35, 0.5, 1.4) * body * swirl * 0.9;
	gl_FragColor = vec4((rimColour + swirlColour) * uStrength, 1.0);
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
			vertexShader: VERTEX,
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
	 * One frame: the strength from `witchspaceLook`, the phase for the swirl, and
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
