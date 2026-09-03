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
	type Settings,
	SETTING_KEYS,
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
		saveSettings({ ...DEFAULT_SETTINGS, renderScale: 0.75 });
		expect(loadSettings().renderScale).toBe(0.75);
	});

	test.each([
		["a count that is not one of the three", `{"antialias":8}`],
		["a count as a string", `{"antialias":"4"}`],
		["a toggle that is not a toggle", `{"dither":"maybe"}`],
		["a boolean where a toggle name goes", `{"vignette":true}`],
	])("%s falls back to the default", (_name, stored) => {
		// #200's three rows go through the same set-membership check as the two
		// before them, and this is what says so rather than the fact that they
		// were written in the same object literal. `antialias` is the one that
		// would hurt: it reaches `WebGLRenderTarget({ samples })`, and a stored
		// `8` on a rasteriser that caps at 4 is a target that fails to allocate.
		installStorage({ [KEY]: stored });
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	test("a legal antialias count round-trips", () => {
		saveSettings({ ...DEFAULT_SETTINGS, antialias: 4 });
		expect(loadSettings().antialias).toBe(4);
	});

	test("the game starts unantialiased", () => {
		// The default is the decision, not an omission: 4x measured six times the
		// cost of the whole rest of the frame on the machine this targets, so the
		// game a player starts is the one that runs. `settings.ts` carries why.
		expect(DEFAULT_SETTINGS.antialias).toBe(0);
		expect(DEFAULT_SETTINGS.dither).toBe("on");
		expect(DEFAULT_SETTINGS.vignette).toBe("on");
	});

	test("a round trip keeps a legal mode name", () => {
		// The second setting is a string, and the loader validates by set
		// membership rather than by `typeof` — so this is the case that would
		// have been dropped silently by the number-only check it replaced.
		saveSettings({ ...DEFAULT_SETTINGS, quality: "low" });
		expect(loadSettings().quality).toBe("low");
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

	test.each([
		["a mode name that does not exist", `{"quality":"ultra"}`],
		["a number where a mode name goes", `{"quality":0}`],
		["the right name in the wrong case", `{"quality":"HIGH"}`],
		["an object", `{"quality":{}}`],
	])("%s falls back to the default", (_name, stored) => {
		installStorage({ [KEY]: stored });
		expect(loadSettings().quality).toBe(DEFAULT_SETTINGS.quality);
	});

	test("one bad field does not take the good one with it", () => {
		// They are validated independently, so a save written by an older build
		// that never had `quality` keeps its resolution.
		installStorage({ [KEY]: `{"renderScale":0.5,"quality":"ultra"}` });
		expect(loadSettings()).toEqual({
			...DEFAULT_SETTINGS,
			renderScale: 0.5,
			quality: DEFAULT_SETTINGS.quality,
		});
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
		expect(() =>
			saveSettings({ ...DEFAULT_SETTINGS, renderScale: 0.5 }),
		).not.toThrow();
	});
});

describe("the store tells its listeners, once", () => {
	beforeEach(() => installStorage());
	afterEach(restoreWindow);

	test("a change notifies", () => {
		const store = new SettingsStore({ ...DEFAULT_SETTINGS, renderScale: 1 });
		const seen: number[] = [];
		store.subscribe((s) => seen.push(s.renderScale));
		store.set("renderScale", 0.5);
		expect(seen).toEqual([0.5]);
	});

	test("setting the value it already has notifies nobody", () => {
		// The renderer rebuilds its drawing buffer on every notification, which
		// is not a thing to do because a menu was redrawn.
		const store = new SettingsStore({ ...DEFAULT_SETTINGS, renderScale: 1 });
		let calls = 0;
		store.subscribe(() => calls++);
		store.set("renderScale", 1);
		expect(calls).toBe(0);
	});

	test("a value outside the allowed set is refused, not stored", () => {
		// The hole this closes: `loadSettings` guarded `localStorage` and nothing
		// guarded code. An instrument sweeping `antialias` over a list of its own
		// set 16, the composer allocated a 16x target, and a frame cost was
		// reported for a setting no player can reach.
		const store = new SettingsStore({ ...DEFAULT_SETTINGS });
		let calls = 0;
		store.subscribe(() => calls++);
		// The cast is the point: `Settings["antialias"]` is `0 | 2 | 4` since the
		// type was derived from the schema, so a caller writing `16` no longer
		// compiles. What still reaches this method uncast is a value out of
		// `localStorage`, and that is what the runtime check is for.
		store.set("antialias", 16 as Settings["antialias"]);
		expect(store.value.antialias).toBe(DEFAULT_SETTINGS.antialias);
		expect(calls).toBe(0);
		// And the legal one still lands, so the guard is not simply refusing.
		store.set("antialias", 4);
		expect(store.value.antialias).toBe(4);
		expect(calls).toBe(1);
	});

	test("every schema row has a default, without anyone writing one out", () => {
		// `DEFAULT_SETTINGS` is derived from the schema's fallbacks, so a row
		// added with no default is impossible rather than an `undefined` reaching
		// the renderer. The three keys `SCHEMA`, `Settings` and this object once
		// listed separately are now one list.
		const store = new SettingsStore({ ...DEFAULT_SETTINGS });
		for (const key of SETTING_KEYS) {
			expect(DEFAULT_SETTINGS[key]).toBeDefined();
			expect(store.allowed(key)).toContain(DEFAULT_SETTINGS[key]);
		}
	});

	test("the store says what each key allows", () => {
		// `.mjs` scripts read this through `window.__seelite.settings` because
		// they cannot import the schema.
		const store = new SettingsStore({ ...DEFAULT_SETTINGS });
		expect(store.allowed("antialias")).toEqual([0, 2, 4]);
		expect(store.allowed("vignette")).toEqual(["on", "off"]);
	});

	test("unsubscribing stops it", () => {
		const store = new SettingsStore({ ...DEFAULT_SETTINGS, renderScale: 1 });
		let calls = 0;
		const off = store.subscribe(() => calls++);
		off();
		store.set("renderScale", 0.75);
		expect(calls).toBe(0);
	});
});
