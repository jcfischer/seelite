/**
 * What a stored preference is allowed to do to the renderer.
 *
 * `localStorage` is a string store that anything can write — an older build of
 * this game, another tab, a person with a console open. The settings loader is
 * the boundary between that and code which sizes a drawing buffer, so what is
 * checked here is that nothing crosses it unvalidated: a `renderScale` of `0`
 * would ask for a zero-sized buffer, and `"0.5"` as a string would multiply a
 * pixel ratio into a string.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_SETTINGS,
	loadSettings,
	saveSettings,
	SettingsStore,
} from "../src/settings";

/**
 * The real global, so it can be put back.
 *
 * These tests install a fake `window`, and `bun test` shares one process
 * across files — so without restoring it, a test elsewhere that asks whether a
 * DOM exists gets this file's answer. That is exactly what happened: CI failed
 * on "no DOM is present in this runtime" while the same suite passed locally,
 * because the two ran the files in a different order.
 */
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

/** A minimal stand-in, so the tests describe the loader rather than a browser. */
function installStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	(globalThis as unknown as { window: unknown }).window = {
		localStorage: {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v),
		},
	};
	return map;
}

function restoreWindow() {
	if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
	else delete (globalThis as { window?: unknown }).window;
}

const KEY = "seelite:settings:v1";

describe("settings survive what a string store can hold", () => {
	beforeEach(() => installStorage());
	afterEach(restoreWindow);

	test("nothing stored gives the defaults", () => {
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	test("a round trip keeps a legal value", () => {
		saveSettings({ renderScale: 0.75 });
		expect(loadSettings().renderScale).toBe(0.75);
	});

	test.each([
		["not JSON at all", "{{{"],
		["JSON that is not an object", "42"],
		["a value outside the allowed set", `{"renderScale":0}`],
		["a scale that would blow up the buffer", `{"renderScale":8}`],
		["the right value as a string", `{"renderScale":"0.5"}`],
		["null", "null"],
	])("%s falls back to the default", (_name, stored) => {
		installStorage({ [KEY]: stored });
		expect(loadSettings().renderScale).toBe(DEFAULT_SETTINGS.renderScale);
	});

	test("a storage that refuses to be read does not stop the game", () => {
		(globalThis as unknown as { window: unknown }).window = {
			get localStorage(): never {
				// What a browser in private mode does.
				throw new Error("access denied");
			},
		};
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	test("a storage that refuses to be written does not throw", () => {
		(globalThis as unknown as { window: unknown }).window = {
			localStorage: {
				getItem: () => null,
				setItem: () => {
					throw new Error("quota");
				},
			},
		};
		expect(() => saveSettings({ renderScale: 0.5 })).not.toThrow();
	});
});

describe("the store tells its listeners, once", () => {
	beforeEach(() => installStorage());
	afterEach(restoreWindow);

	test("a change notifies", () => {
		const store = new SettingsStore({ renderScale: 1 });
		const seen: number[] = [];
		store.subscribe((s) => seen.push(s.renderScale));
		store.set("renderScale", 0.5);
		expect(seen).toEqual([0.5]);
	});

	test("setting the value it already has notifies nobody", () => {
		// The renderer rebuilds its drawing buffer on every notification, which
		// is not a thing to do because a menu was redrawn.
		const store = new SettingsStore({ renderScale: 1 });
		let calls = 0;
		store.subscribe(() => calls++);
		store.set("renderScale", 1);
		expect(calls).toBe(0);
	});

	test("unsubscribing stops it", () => {
		const store = new SettingsStore({ renderScale: 1 });
		let calls = 0;
		const off = store.subscribe(() => calls++);
		off();
		store.set("renderScale", 0.75);
		expect(calls).toBe(0);
	});
});
