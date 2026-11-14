import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	DRILL_CAMERA,
	type DrillCameraGateInput,
	drillCameraActive,
	drillCameraOverlay,
	drillCameraPose,
	drillCameraTimecode,
} from "../src/drill-camera";
import {
	DrillCameraFeed,
	type DrillCameraPaint,
} from "../src/drill-camera-pass";
import { HULL_SPECS } from "../src/hull";
import { shipFrameM } from "../src/rock-drill";
import { v3 } from "../src/vec3";

const cutter = HULL_SPECS.miner.cutter;
if (!cutter) throw new Error("the miner hull has no cutter");
const shipPos = v3(4000, -300, 8800);
const nose = v3(0, 0, -1);
const up = v3(0, 1, 0);

const gate = (
	over: Partial<DrillCameraGateInput> = {},
): DrillCameraGateInput => ({
	view: "cockpit",
	cabin: "miner",
	quality: "high",
	extension: 1,
	screenVisible: true,
	enabled: true,
	...over,
});

describe("when the drill camera's pass runs", () => {
	test("only from the miner's bridge, in cockpit view, with the drill out and its screen in frame", () => {
		expect(drillCameraActive(gate())).toBe(true);
		const vetoes: [string, Partial<DrillCameraGateInput>][] = [
			["view", { view: "chase" }],
			["cabin", { cabin: "courier" }],
			["quality", { quality: "low" }],
			["extension", { extension: 0.9 }],
			["screenVisible", { screenVisible: false }],
			["enabled", { enabled: false }],
		];
		for (const [name, over] of vetoes)
			expect([name, drillCameraActive(gate(over))]).toEqual([name, false]);
	});
});

describe("where the drill camera stands", () => {
	test("port of the rotor, below the keel line, aft of the bow plane", () => {
		const pose = drillCameraPose(shipPos, nose, up, cutter, 1);
		const at = shipFrameM(shipPos, nose, up, pose.eyeKm);
		expect(at.fore).toBeCloseTo(
			cutter.bowKm * 1000 + DRILL_CAMERA.foreFromBowM,
			6,
		);
		expect(at.up).toBeCloseTo(DRILL_CAMERA.upM, 6);
		expect(at.starboard).toBeCloseTo(DRILL_CAMERA.starboardM, 6);
		expect(Math.abs(at.starboard)).toBeGreaterThan(cutter.radiusKm * 1000);
	});

	test("it looks at the rotor's face, and the aim follows the feed out", () => {
		const aimAt = (extension: number) =>
			shipFrameM(
				shipPos,
				nose,
				up,
				drillCameraPose(shipPos, nose, up, cutter, extension).aimKm,
			);
		const full = aimAt(1);
		const part = aimAt(0.25);
		expect(full.fore).toBeCloseTo(
			cutter.bowKm * 1000 + cutter.feedTravelKm * 1000 + DRILL_CAMERA.aimAheadM,
			6,
		);
		expect(part.fore).toBeLessThan(full.fore);
		expect(full.up).toBeCloseTo(-cutter.downKm * 1000, 6);
		expect(full.starboard).toBeCloseTo(0, 6);
	});

	test("the eye stands between the bridge and the face, and no seat is in its way", () => {
		const pose = drillCameraPose(shipPos, nose, up, cutter, 1);
		const span = Math.hypot(
			pose.eyeKm.x - pose.aimKm.x,
			pose.eyeKm.y - pose.aimKm.y,
			pose.eyeKm.z - pose.aimKm.z,
		);
		expect(span).toBeGreaterThan(0.012);
		expect(span).toBeLessThan(0.03);
	});

	test("a rotated ship carries the mount with it, in the ship's frame", () => {
		const turned = v3(0.6, 0, -0.8);
		const turnedUp = v3(0.8, 0, 0.6);
		const pose = drillCameraPose(shipPos, turned, turnedUp, cutter, 1);
		const at = shipFrameM(shipPos, turned, turnedUp, pose.eyeKm);
		expect(at.fore).toBeCloseTo(
			cutter.bowKm * 1000 + DRILL_CAMERA.foreFromBowM,
			6,
		);
		expect(at.up).toBeCloseTo(DRILL_CAMERA.upM, 6);
		expect(at.starboard).toBeCloseTo(DRILL_CAMERA.starboardM, 6);
	});
});

describe("what the screen says", () => {
	test("the timecode counts the frames the pass has drawn", () => {
		expect(drillCameraTimecode(0)).toBe("TCR 00:00:00:00");
		expect(drillCameraTimecode(61)).toBe("TCR 00:00:01:01");
		expect(drillCameraTimecode(60 * 60 + 60 * 23 + 59)).toBe("TCR 00:01:23:59");
		expect(drillCameraTimecode(60 * 60 * 61 + 17)).toBe("TCR 01:01:00:17");
	});

	test("a dark screen reads off; a live one carries the title and the frame clock", () => {
		expect(drillCameraOverlay(false, 400)).toEqual({
			title: "DRILL CAM",
			line: "FEED OFF",
		});
		expect(drillCameraOverlay(true, 400)).toEqual({
			title: "DRILL CAM",
			line: "TCR 00:00:06:40",
		});
	});
});

const drillScene = () => {
	const root = new THREE.Group();
	const exterior = new THREE.Group();
	exterior.name = "longwall-exterior";
	const feed = new THREE.Group();
	feed.name = "feed";
	feed.visible = false;
	feed.add(
		new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
	);
	const hull = new THREE.Mesh(
		new THREE.BoxGeometry(),
		new THREE.MeshBasicMaterial(),
	);
	hull.name = "hull";
	hull.visible = false;
	exterior.add(feed, hull);
	root.add(exterior);
	return { root, exterior, feed, hull };
};

const painter = (throwOnRender = false) => {
	const state = {
		calls: [] as string[],
		feedSeen: [] as boolean[],
		shadowSeen: [] as boolean[],
		feed: null as THREE.Object3D | null,
		detached: 0,
	};
	const paint: DrillCameraPaint = {
		shadowMap: { autoUpdate: true },
		setRenderTarget(target) {
			state.calls.push(target ? "target" : "screen");
			if (!target) state.detached++;
		},
		clear() {
			state.calls.push("clear");
		},
		render() {
			state.calls.push("render");
			state.feedSeen.push(state.feed?.visible === true);
			state.shadowSeen.push(paint.shadowMap.autoUpdate);
			if (throwOnRender) throw new Error("paint failed");
		},
	};
	return { paint, state };
};

describe("the feed's pass", () => {
	const pose = { eyeKm: v3(1, 2, 3), aimKm: v3(2, 3, 4), up: v3(0, 1, 0) };

	test("it draws once into its target with the drill shown, then puts the scene back", () => {
		const { root, exterior, feed } = drillScene();
		const { paint, state } = painter();
		state.feed = feed;
		const pass = new DrillCameraFeed(320, 154, 42);
		pass.render(paint, new THREE.Scene(), root, pose);
		expect(state.calls).toEqual(["target", "clear", "render", "screen"]);
		expect(state.feedSeen).toEqual([true]);
		expect(state.shadowSeen).toEqual([false]);
		expect(paint.shadowMap.autoUpdate).toBe(true);
		expect(feed.visible).toBe(false);
		expect(exterior.visible).toBe(true);
		expect(pass.frames).toBe(1);
		expect(pass.camera.position.toArray()).toEqual([1, 2, 3]);
		expect(pass.camera.up.toArray()).toEqual([0, 1, 0]);
		expect(pass.target.width).toBe(320);
		expect(pass.target.height).toBe(154);
		pass.dispose();
	});

	test("a paint that throws still restores the drill, the shadow map and the screen", () => {
		const { root, feed } = drillScene();
		const { paint, state } = painter(true);
		state.feed = feed;
		const pass = new DrillCameraFeed(320, 154, 42);
		expect(() => pass.render(paint, new THREE.Scene(), root, pose)).toThrow(
			"paint failed",
		);
		expect(feed.visible).toBe(false);
		expect(paint.shadowMap.autoUpdate).toBe(true);
		expect(state.detached).toBe(1);
		expect(pass.frames).toBe(0);
		pass.dispose();
	});
});
