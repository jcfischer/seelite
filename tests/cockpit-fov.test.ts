import { afterEach, beforeEach, expect, test } from "bun:test";
import * as THREE from "three";
import {
	DEFAULT_BINDINGS,
	commandById,
	layoutOf,
	rebind,
	resolveKey,
} from "../src/commands";
import { focalPx } from "../src/relief-bands";
import { projectDirection } from "../src/hud";
import { DEFAULT_SETTINGS, loadSettings, SettingsStore } from "../src/settings";
import { gameMethods } from "./lib/game-methods";

const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
	const storage = new Map<string, string>();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
			},
		},
	});
});
afterEach(() => {
	if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
	else Reflect.deleteProperty(globalThis, "window");
});

const cameraNames = [
	"backdropCamera",
	"farCamera",
	"approachCamera",
	"nearCamera",
	"cabinCamera",
] as const;

function game() {
	const proto = gameMethods(["command", "applyViewFov", "markerNdc"], {
		PHOTO_MODE_COMMANDS: new Set(),
		focalPx,
		projectDirection,
		THREE,
	});
	const g = Object.assign(Object.create(proto), {
		settings: new SettingsStore(),
		view: "cockpit",
		renderer: { getSize: (into: THREE.Vector2) => into.set(1440, 900) },
		cameraRotation: () => new THREE.Quaternion(),
		setHeadLook() {},
	});
	for (const name of cameraNames)
		g[name] = new THREE.PerspectiveCamera(60, 1.6, 0.001, 10000);
	return g;
}

test("FOV defaults to normal, including older or invalid preferences", () => {
	expect(DEFAULT_SETTINGS.cockpitFov).toBe("normal");
	expect(loadSettings().cockpitFov).toBe("normal");
	window.localStorage.setItem("seelite:settings:v1", '{"cockpitFov":80}');
	expect(loadSettings().cockpitFov).toBe("normal");
});

test("digit 7 is a rebindable cockpit command and the real command persists both directions", () => {
	const layout = layoutOf(DEFAULT_BINDINGS);
	expect(resolveKey(layout, { key: "7", view: "cockpit" })).toEqual([
		"view.fov",
	]);
	expect(resolveKey(layout, { key: "7", view: "chase" })).toEqual([]);
	expect(commandById("view.fov").group).toBe("view");
	const moved = rebind(
		layout,
		"view.fov",
		{ kind: "key", key: "7" },
		{ kind: "key", key: "8" },
	);
	expect(resolveKey(moved, { key: "8", view: "cockpit" })).toEqual([
		"view.fov",
	]);
	const g = game();
	g.command("view.fov");
	expect(g.settings.value.cockpitFov).toBe("wide");
	expect(new SettingsStore().value.cockpitFov).toBe("wide");
	g.command("view.fov");
	expect(loadSettings().cockpitFov).toBe("normal");
	g.view = "chase";
	g.command("view.fov");
	expect(loadSettings().cockpitFov).toBe("normal");
});

test("all five cameras and the cached target sizing follow the setting; chase keeps 60", () => {
	const g = game();
	for (const mode of ["wide", "normal", "wide"] as const) {
		g.settings.set("cockpitFov", mode);
		g.applyViewFov();
		const fov = mode === "wide" ? 80 : 60;
		for (const name of cameraNames) {
			expect(g[name].fov).toBe(fov);
			expect(g[name].projectionMatrix.elements).toEqual(
				new THREE.PerspectiveCamera(fov, 1.6, 0.001, 10000).projectionMatrix
					.elements,
			);
		}
		expect(g.focalPx).toBeCloseTo(
			900 / (2 * Math.tan((fov * Math.PI) / 360)),
			10,
		);
	}
	g.view = "chase";
	g.applyViewFov();
	for (const name of cameraNames) expect(g[name].fov).toBe(60);
	expect(g.settings.value.cockpitFov).toBe("wide");
	g.view = "cockpit";
	g.applyViewFov();
	for (const name of cameraNames) expect(g[name].fov).toBe(80);
});

test("live reticle and off-axis target markers agree with the layer projection at both FOVs", () => {
	const g = game();
	for (const mode of ["normal", "wide"] as const) {
		g.settings.set("cockpitFov", mode);
		g.applyViewFov();
		for (const dir of [
			{ x: 0, y: 0, z: -1 },
			{ x: 0.3, y: 0.2, z: -1 },
			{ x: -0.5, y: -0.25, z: -1 },
		]) {
			const marker = g.markerNdc(dir);
			for (const name of cameraNames) {
				const projected = new THREE.Vector3(dir.x, dir.y, dir.z).project(
					g[name],
				);
				expect(marker.ndcX).toBeCloseTo(projected.x, 12);
				expect(marker.ndcY).toBeCloseTo(projected.y, 12);
			}
		}
	}
});

test("render updates the FOV before any scene presentation reads it", () => {
	const g = game();
	g.render = gameMethods(["render"]).render;
	g.settings.set("cockpitFov", "wide");
	const stop = new Error("stop after projection setup");
	g.openingCamera = () => {
		for (const name of cameraNames) expect(g[name].fov).toBe(80);
		throw stop;
	};
	expect(() => g.render()).toThrow(stop);
});
