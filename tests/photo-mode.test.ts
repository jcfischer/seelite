import { expect, test } from "bun:test";
import * as orbit from "../src/chase-orbit";
import { DEFAULT_BINDINGS, collisions, triggerKey } from "../src/commands"; // glossary-ignore: Command
import {
	decodePostcard,
	encodePostcard,
	postcardPose,
	postcardRecipe,
	POSTCARD_ZOOM_MIN,
	POSTCARD_ZOOM_MAX,
} from "../src/postcard";
import { gameMethods, mainFunction } from "./lib/game-methods";

test("wheel zoom scales the whole rig, preserves its angles, and stops at both limits", () => {
	const zoom = orbit.zoomOrbit;
	expect(typeof zoom).toBe("function");
	const start = { yawRad: 0.7, elevationRad: -0.4, zoomScale: 1 };
	const closer = zoom(start, -120);
	if (closer.zoomScale === undefined)
		throw new Error("wheel did not set a distance");
	expect(closer.zoomScale).toBeLessThan(1);
	expect(closer.yawRad).toBe(start.yawRad);
	expect(closer.elevationRad).toBe(start.elevationRad);
	const a = orbit.orbitOffsetKm(start);
	const b = orbit.orbitOffsetKm(closer);
	for (const k of ["x", "y", "z"] as const)
		expect(b[k]).toBeCloseTo(a[k] * closer.zoomScale, 12);
	let near: orbit.ChaseOrbit = start,
		far: orbit.ChaseOrbit = start;
	for (let i = 0; i < 100; i++) {
		near = zoom(near, -1000);
		far = zoom(far, 1000);
	}
	expect(near.zoomScale).toBe(orbit.ORBIT_ZOOM_MIN);
	expect(far.zoomScale).toBe(orbit.ORBIT_ZOOM_MAX);
	expect(zoom(far, -120).zoomScale).toBeLessThan(orbit.ORBIT_ZOOM_MAX);
	expect(zoom(start, Number.NaN)).toEqual(start);
	expect(orbit.orbitByPointer(closer, 10, 20).zoomScale).toBe(closer.zoomScale);
});

test("outside flight steers, Photo orbits, and the same physical gesture has disjoint mode scopes", () => {
	expect(orbit.pointerOwner("chase", false)).toBe("steer");
	expect(orbit.pointerOwner("chase", true)).toBe("orbit");
	expect(orbit.pointerOwner("cockpit", false)).toBe("steer");
	const normal = DEFAULT_BINDINGS.find(
		(b) => b.command === "fly.yawStarboard" && b.trigger.kind === "mouse-move",
	);
	const photo = DEFAULT_BINDINGS.find(
		(b) => b.command === "view.orbitPort" && b.trigger.kind === "mouse-move",
	);
	if (!normal || !photo) throw new Error("missing pointer rows");
	expect(normal.scope.views).toContain("chase");
	expect(normal.scope.photoMode).toBe(false);
	expect(photo.scope.photoMode).toBe(true);
	expect(triggerKey(normal.trigger)).toBe(triggerKey(photo.trigger));
	expect(collisions([normal, photo])).toEqual([]);
	expect(
		collisions([
			{ ...normal, scope: { ...normal.scope, photoMode: undefined } },
			photo,
		]),
	).toHaveLength(1);
});

const scene = {
	seed: 42,
	galaxy: 0,
	system: 12,
	timeS: 12,
	pos: [1, 2, 3],
	orientation: [0, 0, 0, 1],
	mode: "exterior" as const,
	yawRad: 0.7,
	elevationRad: -0.4,
	zoomScale: 0.6,
};
test("a zoomed postcard carries its distance through the link and capture pose", () => {
	const recipe = postcardRecipe(scene);
	const text = encodePostcard(recipe);
	expect(text).toContain("&zoom=0.6");
	const back = decodePostcard(text);
	expect(back).toEqual({ ok: true, recipe });
	if (!back.ok) return;
	expect(postcardPose(back.recipe).zoomScale).toBe(0.6);
	expect(
		encodePostcard(postcardRecipe({ ...scene, ...postcardPose(back.recipe) })),
	).toBe(text);
	for (const bad of ["0", "9", "NaN"])
		expect(decodePostcard(text.replace("zoom=0.6", `zoom=${bad}`)).ok).toBe(
			false,
		);
	const normal = encodePostcard(
		postcardRecipe({ ...scene, zoomScale: undefined }),
	);
	expect(normal).not.toContain("zoom=");
	expect(decodePostcard(normal).ok).toBe(true);
});

// Run Game's real methods without constructing WebGL, following display-contact.
const methods = (names: string[]) =>
	gameMethods(names, {
		orbitByPointer: orbit.orbitByPointer,
		contextFliesShip: () => true,
	});
test("Photo entry and exit clear held fire and pointer state and preserve the prior view", () => {
	const proto = methods(["togglePhotoMode", "triggerHeld"]);
	const g = Object.assign(Object.create(proto), {
		photoMode: false,
		view: "cockpit",
		mouseFiring: true,
		keys: new Set([" "]),
		mouseDx: 50,
		mouseDy: 20,
		releaseHeldKeys() {
			this.keys.clear();
		},
		setHeadLook() {},
		updatePhotoNotice() {},
		takePointer() {
			this.mouseDx = this.mouseDy = 0;
		},
	});
	g.togglePhotoMode();
	expect(g.photoMode).toBe(true);
	expect(g.view).toBe("chase");
	expect(g.mouseFiring).toBe(false);
	expect(g.keys.size).toBe(0);
	expect([g.mouseDx, g.mouseDy]).toEqual([0, 0]);
	expect(g.triggerHeld()).toBe(false);
	g.togglePhotoMode();
	expect(g.photoMode).toBe(false);
	expect(g.view).toBe("cockpit");
});
test("the direct simulation step cannot advance a Photo scene", () => {
	const proto = methods(["step"]);
	const g = Object.assign(Object.create(proto), { photoMode: true });
	expect(() => g.step(0.1)).not.toThrow();
	expect(Object.keys(g)).toEqual(["photoMode"]);
});

test("Photo holds independently of a menu hold and leaves that hold untouched", () => {
	const proto = methods(["togglePhotoMode", "simulationHeld"]);
	for (const clockHeld of [false, true]) {
		const g = Object.assign(Object.create(proto), {
			clockHeld,
			photoMode: false,
			view: "chase",
			mouseFiring: false,
			releaseHeldKeys() {},
			takePointer() {},
			setHeadLook() {},
			updatePhotoNotice() {},
		});
		g.togglePhotoMode();
		expect(g.simulationHeld).toBe(true);
		expect(g.clockHeld).toBe(clockHeld);
		g.togglePhotoMode();
		expect(g.simulationHeld).toBe(clockHeld);
	}
});

test("zoom limits agree with the recipe leaf and every accepted zoom keeps its bytes", () => {
	expect(POSTCARD_ZOOM_MIN).toBe(orbit.ORBIT_ZOOM_MIN);
	expect(POSTCARD_ZOOM_MAX).toBe(orbit.ORBIT_ZOOM_MAX);
	for (const zoomScale of [POSTCARD_ZOOM_MIN, 0.6, 1, POSTCARD_ZOOM_MAX]) {
		const text = encodePostcard(postcardRecipe({ ...scene, zoomScale }));
		const back = decodePostcard(text);
		expect(back.ok).toBe(true);
		if (back.ok)
			expect(
				encodePostcard(
					postcardRecipe({ ...scene, ...postcardPose(back.recipe) }),
				),
			).toBe(text);
	}
	const text = encodePostcard(postcardRecipe(scene));
	expect(decodePostcard(text.replace(/&zoom=[^&]+$/, "")).ok).toBe(false);
	expect(decodePostcard(text.replace("postcard=3", "postcard=2")).ok).toBe(
		false,
	);
	expect(() =>
		encodePostcard({ ...postcardRecipe(scene), schema: 2 }),
	).toThrow();
});

// Sage round 6: `Enter` on a focused Photo button bubbled to `onKey` and ran
// `dock.launch` before the native click; `Space` was `preventDefault`ed there.
const photoButtonKey = mainFunction("photoButtonKey");
const keyEvent = (key: string) => {
	const e = { key, stopped: false, stopPropagation() {} };
	e.stopPropagation = () => {
		e.stopped = true;
	};
	return e;
};
test("a Photo button keeps its activation keys and lets every other key fly", () => {
	for (const key of ["Enter", " "]) {
		const e = keyEvent(key);
		photoButtonKey(e);
		expect({ key, stopped: e.stopped }).toEqual({ key, stopped: true });
	}
	for (const key of ["w", "Escape", "F2", "Tab", "1"]) {
		const e = keyEvent(key);
		photoButtonKey(e);
		expect({ key, stopped: e.stopped }).toEqual({ key, stopped: false });
	}
});

test("every Photo button, in both modes, stops its activation keydown and no keyup", () => {
	type Fake = {
		tag: string;
		listeners: Record<string, unknown[]>;
		children: Fake[];
		textContent?: string;
		type?: string;
		dataset: Record<string, string>;
		style: Record<string, string>;
		addEventListener(type: string, fn: unknown): void;
		append(...c: Fake[]): void;
		replaceChildren(): void;
	};
	const make = (tag: string): Fake => ({
		tag,
		listeners: {},
		children: [],
		dataset: {},
		style: {},
		addEventListener(type, fn) {
			this.listeners[type] ??= [];
			this.listeners[type].push(fn);
		},
		append(...c) {
			this.children.push(...c);
		},
		replaceChildren() {
			this.children = [];
		},
	});
	const document = {
		createElement: make,
		body: { append() {} },
	};
	const proto = gameMethods(["updatePhotoNotice"], {
		document,
		photoButtonKey,
	});
	for (const photoMode of [false, true]) {
		const g = Object.assign(Object.create(proto), {
			photoMode,
			photoNotice: null,
			command() {},
		});
		g.updatePhotoNotice();
		const buttons = (g.photoNotice as Fake).children.filter(
			(c) => c.tag === "button",
		);
		expect(buttons.length).toBe(photoMode ? 3 : 1);
		for (const b of buttons) {
			expect({ b: b.textContent, down: b.listeners.keydown }).toEqual({
				b: b.textContent,
				down: [photoButtonKey],
			});
			expect(b.listeners.keyup).toBeUndefined();
			expect(b.listeners.click?.length).toBe(1);
		}
	}
});
