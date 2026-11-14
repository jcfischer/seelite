import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { tracerStrokes, type BeamStroke } from "../src/beam-glass";
import {
	beamSegments,
	muzzlesWorld,
	NEAR_KM,
	projectSegment,
} from "../src/chase-view";
import { cabinForHull, cockpitEyeKm } from "../src/cockpit-eye";
import {
	TRACER_AIM,
	TRACER_HOLD_S,
	SHOT_SOUND_GAP_S,
	tracerPorts,
} from "../src/gun-feedback";
import { ndcToPx } from "../src/hud";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { glassTracerIndices } from "../src/laser-modules";
import { PLAYER_LASER_RANGE_KM } from "../src/laser";
import { stockLoadout } from "../src/loadout";
import { shipMuzzlesKm } from "../src/ship-mesh";
import { gameMethods } from "./lib/game-methods";

const prototype = gameMethods(
	["drawCockpitBeams", "chaseBeamPx", "glassFiredIndices", "gunTracer"],
	{
		HULL_SPECS,
		shipMuzzlesKm,
		muzzlesWorld,
		beamSegments,
		projectSegment,
		ndcToPx,
		PLAYER_LASER_RANGE_KM,
		glassTracerIndices,
		tracerPorts,
		tracerStrokes,
		TRACER_AIM,
		TRACER_HOLD_S,
		SHOT_SOUND_GAP_S,
		MINING_ON: false,
		NO_BEAM_STROKES: [],
	},
);

const framePoint = (p: THREE.Vector3, camera: THREE.PerspectiveCamera) => {
	const ndc = p.clone().applyMatrix4(camera.projectionMatrix);
	return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
};

for (const hull of HULL_IDS) {
	for (const view of ["cockpit", "chase"] as const) {
		describe(`${hull} ${view}: physical laser origins`, () => {
			const spec = HULL_SPECS[hull];
			const mounts = shipMuzzlesKm(hull, spec.variant);
			const selections = [
				mounts.map((_, i) => i),
				...mounts.map((_, i) => [i]),
			];
			for (const selected of selections) {
				test(`selected mounts ${selected.join(",") || "none"}`, () => {
					const position = new THREE.Vector3(13, -4, 7);
					const rotation = new THREE.Quaternion().setFromEuler(
						new THREE.Euler(0.2, 0.7, -0.1),
					);
					const eye = cockpitEyeKm(cabinForHull(hull), "pilot");
					const offset =
						view === "cockpit"
							? new THREE.Vector3(eye.x, eye.y, eye.z)
							: new THREE.Vector3(0.05, 0.04, 0.14);
					const camera = new THREE.PerspectiveCamera(60, 1.6, NEAR_KM, 100);
					camera.position.copy(offset.applyQuaternion(rotation).add(position));
					camera.quaternion.copy(rotation);
					camera.updateMatrixWorld(true);
					let drawn: BeamStroke[] = [];
					const subject = Object.assign(Object.create(prototype), {
						view,
						flownHull: hull,
						orientation: rotation,
						world: { ship: { pos: position }, gameTime: 0 },
						commander: { loadout: stockLoadout(hull) },
						firedMuzzleIndices: selected,
						cockpitStrokes: [],
						gunFeedback: { tracerLeftS: 0.08 },
						raiderFiring: false,
						nearCamera: camera,
						overlay: { width: 1280 },
						renderer: { domElement: { width: 1280, height: 800 } },
						beamLayer: {
							draw: (strokes: BeamStroke[]) => {
								drawn = [...strokes];
							},
						},
						cameraPos: () => camera.position,
						cameraRotation: () => camera.quaternion,
						beamAim: () =>
							new THREE.Vector3(0, 0, -1).applyQuaternion(rotation),
						onFrame: () => TRACER_AIM,
						flightGlassShown: () => true,
					});
					if (view === "cockpit") subject.drawCockpitBeams(camera.position);
					else drawn = subject.chaseBeamPx(1, 1);
					expect(drawn).toHaveLength(selected.length);
					selected.forEach((index, beam) => {
						const mount = mounts[index];
						const from = new THREE.Vector3(mount.x, mount.y, mount.z);
						const to = from
							.clone()
							.add(new THREE.Vector3(0, 0, -PLAYER_LASER_RANGE_KM));
						const inCamera = (p: THREE.Vector3) =>
							p
								.applyQuaternion(rotation)
								.add(position)
								.applyMatrix4(camera.matrixWorldInverse);
						inCamera(from);
						inCamera(to);
						if (-from.z < NEAR_KM)
							from.lerp(to, (NEAR_KM + from.z) / (from.z - to.z));
						for (const [actual, expected] of [
							[drawn[beam].from, framePoint(from, camera)],
							[drawn[beam].to, framePoint(to, camera)],
						]) {
							for (const axis of ["x", "y"] as const)
								expect(
									Math.abs(actual[axis] - expected[axis]) /
										Math.max(1, Math.abs(expected[axis])),
								).toBeLessThan(1e-7);
						}
					});
				});
			}
		});
	}
}
