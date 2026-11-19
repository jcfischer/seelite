/**
 * https://github.com/jcfischer/seelite/issues/1090
 *
 * The kill explosions, drawn. One `THREE.Points` per live
 * explosion under one group in the near scene, placed camera-relative each
 * frame from `explosionCentre`, and removed with its geometry disposed on the
 * frame it ends. Additive points: they cast no shadow and occlude nothing.
 */
import * as THREE from "three";
import {
	EXPLOSION_POINTS,
	type KillExplosion,
	explosionCentre,
	explosionCloudKm,
	explosionLive,
	writeExplosionPoints,
} from "./kill-explosion";
import type { Vec3 } from "./vec3";

let explosionMaterial: THREE.ShaderMaterial | undefined;

function material(): THREE.ShaderMaterial {
	if (explosionMaterial) return explosionMaterial;
	explosionMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uPixelsPerKm: { value: 1 },
			uPixelRatio: { value: 1 },
		},
		vertexShader: `
			attribute float sizeKm;
			attribute vec3 heat;
			uniform float uPixelsPerKm;
			uniform float uPixelRatio;
			varying vec3 vHeat;
			void main() {
				vHeat = heat;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				float dist = max(-mv.z, 1e-6);
				gl_PointSize = clamp(sizeKm * uPixelsPerKm / dist, 1.5 * uPixelRatio, 160.0 * uPixelRatio);
				gl_Position = projectionMatrix * mv;
			}
		`,
		fragmentShader: `
			varying vec3 vHeat;
			void main() {
				float r = min(length(gl_PointCoord - 0.5) * 2.0, 1.0);
				float soft = (1.0 - r) * (1.0 - r);
				if (soft <= 0.0 || dot(vHeat, vHeat) <= 0.0) discard;
				gl_FragColor = vec4(vHeat * soft, 1.0);
			}
		`,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	explosionMaterial.name = "kill-explosion";
	return explosionMaterial;
}

interface Live {
	explosion: KillExplosion;
	points: THREE.Points;
}

/** Every explosion the near scene is drawing, and the verbs that drive them. */
export interface KillExplosions {
	object: THREE.Group;
	start(explosion: KillExplosion): void;
	update(t: number, cameraPos: Vec3): number;
	live(): readonly KillExplosion[];
	clear(): void;
}

/** An empty set of explosions, its group named `kill-explosions`. */
export function buildKillExplosions(): KillExplosions {
	const group = new THREE.Group();
	group.name = "kill-explosions";
	let live: Live[] = [];
	const target = new THREE.Vector2();

	const drop = (entry: Live) => {
		entry.points.removeFromParent();
		entry.points.geometry.dispose();
	};

	const build = (explosion: KillExplosion): Live => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(new Float32Array(EXPLOSION_POINTS * 3), 3),
		);
		geometry.setAttribute(
			"sizeKm",
			new THREE.BufferAttribute(new Float32Array(EXPLOSION_POINTS), 1),
		);
		geometry.setAttribute(
			"heat",
			new THREE.BufferAttribute(new Float32Array(EXPLOSION_POINTS * 3), 3),
		);
		geometry.boundingSphere = new THREE.Sphere(
			new THREE.Vector3(),
			explosionCloudKm(explosion.reachKm) * 1.5,
		);
		const points = new THREE.Points(geometry, material());
		points.name = `kill-explosion-${explosion.key}`;
		points.frustumCulled = false;
		points.castShadow = false;
		points.receiveShadow = false;
		points.renderOrder = 10;
		points.onBeforeRender = (renderer, _scene, camera) => {
			const rt = renderer.getRenderTarget();
			const height = rt ? rt.height : renderer.getDrawingBufferSize(target).y;
			const m = material();
			m.uniforms.uPixelsPerKm.value =
				((camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] *
					height) /
				2;
			m.uniforms.uPixelRatio.value = renderer.getPixelRatio();
		};
		group.add(points);
		return { explosion, points };
	};

	const write = (entry: Live, t: number, cameraPos: Vec3) => {
		const { explosion, points } = entry;
		const centre = explosionCentre(explosion, t);
		points.position.set(
			centre.x - cameraPos.x,
			centre.y - cameraPos.y,
			centre.z - cameraPos.z,
		);
		const geometry = points.geometry;
		const positions = geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const sizes = geometry.getAttribute("sizeKm") as THREE.BufferAttribute;
		const heats = geometry.getAttribute("heat") as THREE.BufferAttribute;
		writeExplosionPoints(explosion, t, {
			position: positions.array as Float32Array,
			sizeKm: sizes.array as Float32Array,
			heat: heats.array as Float32Array,
		});
		positions.needsUpdate = true;
		sizes.needsUpdate = true;
		heats.needsUpdate = true;
	};

	return {
		object: group,
		start(explosion) {
			live = [...live, build(explosion)];
		},
		update(t, cameraPos) {
			for (const entry of live)
				if (!explosionLive(entry.explosion, t)) drop(entry);
			live = live.filter((e) => explosionLive(e.explosion, t));
			for (const entry of live) write(entry, t, cameraPos);
			return live.length;
		},
		live: () => live.map((e) => e.explosion),
		clear() {
			for (const entry of live) drop(entry);
			live = [];
		},
	};
}
