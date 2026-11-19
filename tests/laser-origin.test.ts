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
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import { glassTracerIndices } from "../src/laser-modules";
import { PLAYER_LASER_RANGE_KM } from "../src/laser";
import { stockLoadout } from "../src/loadout";
import { shipMuzzlesKm } from "../src/ship-mesh";
import { gameMethods } from "./lib/game-methods";
import { useShippedInterceptorHull } from "./setup/interceptor-hull";
import { useShippedSevenShips } from "./setup/seven-ships-hull";

await useShippedInterceptorHull();
await useShippedSevenShips();

const deps = {
	HULL_SPECS,
	shipMuzzlesKm,
	muzzlesWorld,
	beamSegments,
	projectSegment,
	ndcToPx,
	PLAYER_LASER_RANGE_KM,
	glassTracerIndices,
	tracerStrokes,
	TRACER_AIM,
	TRACER_HOLD_S,
	SHOT_SOUND_GAP_S,
	NO_BEAM_STROKES: [],
};

const prototype = gameMethods(
	[
		"drawCockpitBeams",
		"playerBeamPx",
		"playerBeamFrame",
		"glassFiredIndices",
		"gunTracer",
	],
	deps,
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
				...(mounts.length > 1 ? mounts.map((_, i) => [i]) : []),
				[],
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
					else drawn = subject.playerBeamPx(1, 1);
					const glass = glassTracerIndices(hull, stockLoadout(hull), selected);
					if (hull === "miner")
						expect(glass).toEqual(selected.filter((i) => i !== 1));
					expect(drawn).toHaveLength(glass.length);
					expect(subject.gunTracer.firedPorts).toEqual(
						drawn.map((beam) => beam.from),
					);
					glass.forEach((index, beam) => {
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
						const glassPort =
							view === "cockpit" && !spec.cutter
								? tracerPorts(spec.hardpoints)[index]
								: null;
						for (const [actual, expected] of [
							[drawn[beam].from, glassPort ?? framePoint(from, camera)],
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

for (const view of ["cockpit", "chase"] as const) {
	for (const selected of [[0], [1], [0, 1]]) {
		test(`${view}: culled first muzzle retains selected identity ${selected}`, () => {
			const culledPrototype = gameMethods(
				["playerBeamPx", "playerBeamFrame", "glassFiredIndices", "gunTracer"],
				{
					...deps,
					shipMuzzlesKm: () => [
						{ x: -1, y: 0, z: 1 },
						{ x: 1, y: 0, z: -1 },
					],
				},
			);
			const camera = new THREE.PerspectiveCamera(60, 1.6, NEAR_KM, 100);
			const subject = Object.assign(Object.create(culledPrototype), {
				view,
				flownHull: "interceptor",
				orientation: new THREE.Quaternion(),
				world: { ship: { pos: new THREE.Vector3() } },
				commander: { loadout: stockLoadout("interceptor") },
				firedMuzzleIndices: selected,
				nearCamera: camera,
				cameraPos: () => camera.position,
				cameraRotation: () => camera.quaternion,
				beamAim: () => new THREE.Vector3(0, 0, 1),
			});
			const visible = selected.includes(1) ? [1] : [];
			const drawn = subject.playerBeamPx(1, 1);
			expect(
				drawn.map((beam: { muzzleIndex: number }) => beam.muzzleIndex),
			).toEqual(visible);
			expect(
				subject.gunTracer.segments.map(
					(beam: { muzzleIndex: number }) => beam.muzzleIndex,
				),
			).toEqual([1]);
			expect(subject.gunTracer.firedPorts).toEqual(
				view === "cockpit"
					? visible.map((i) => tracerPorts(2)[i])
					: drawn.map((beam: BeamStroke) => beam.from),
			);
		});
	}
}
