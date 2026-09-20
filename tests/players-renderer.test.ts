import { expect, test } from "bun:test";
import {
	assertHardwareRenderer,
	SOFTWARE,
} from "../scripts/lib/players-renderer.mjs";
import {
	HARDWARE_RENDERER,
	OFFSCREEN_WINDOW_POSITION,
	OFFSCREEN_WINDOW_RUNTIME_FLAGS,
	PROBE_WINDOW_VISIBLE,
	probeLaunchOptions,
	probeRendererMode,
	PROBE_RENDERER_ENV,
} from "../scripts/probe-guard.mjs";

test("hardware renderer identity requires an unmasked non-software name", () => {
	expect(
		assertHardwareRenderer(
			{
				unmasked: "ANGLE Metal Renderer: Apple M1 Pro",
				generic: "WebKit WebGL",
			},
			"test",
		),
	).toBe("ANGLE Metal Renderer: Apple M1 Pro");
	expect(() =>
		assertHardwareRenderer(
			{ unmasked: "ANGLE Vulkan SwiftShader", generic: "WebKit WebGL" },
			"test",
		),
	).toThrow("software rasteriser");
	expect(() =>
		assertHardwareRenderer({ unmasked: null, generic: "WebKit WebGL" }, "test"),
	).toThrow("cannot read the real renderer");
	expect(SOFTWARE.test("SwiftShader")).toBe(true);
});

test("the hardware mode is opt-in and forces headed Chromium", () => {
	expect(probeRendererMode({})).toBeNull();
	expect(probeRendererMode({ [PROBE_RENDERER_ENV]: HARDWARE_RENDERER })).toBe(
		HARDWARE_RENDERER,
	);
	expect(() => probeRendererMode({ [PROBE_RENDERER_ENV]: "cpu" })).toThrow(
		`${PROBE_RENDERER_ENV} must be "${HARDWARE_RENDERER}" or unset`,
	);

	const defaults = { args: ["--example"] };
	expect(probeLaunchOptions(defaults, null)).toBe(defaults);
	expect(probeLaunchOptions({ headless: true }, HARDWARE_RENDERER)).toEqual({
		headless: false,
		args: [OFFSCREEN_WINDOW_POSITION, ...OFFSCREEN_WINDOW_RUNTIME_FLAGS],
	});
	expect(
		probeLaunchOptions({ args: ["--example"] }, HARDWARE_RENDERER).args,
	).toEqual([
		"--example",
		OFFSCREEN_WINDOW_POSITION,
		...OFFSCREEN_WINDOW_RUNTIME_FLAGS,
	]);
	expect(
		probeLaunchOptions(
			{ args: ["--example"], probeWindow: PROBE_WINDOW_VISIBLE },
			HARDWARE_RENDERER,
		),
	).toEqual({ headless: false, args: ["--example"] });
});
