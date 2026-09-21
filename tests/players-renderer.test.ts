import { expect, test } from "bun:test";
import {
	assertHardwareRenderer,
	SOFTWARE,
} from "../scripts/lib/players-renderer.mjs";
import {
	HARDWARE_CHANNEL,
	HARDWARE_RENDERER,
	PROBE_WINDOW_LOCKABLE,
	PROBE_WINDOW_VISIBLE,
	PROBE_WINDOWS,
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

test("the hardware mode is opt-in and each window mode asks for its own view", () => {
	expect(probeRendererMode({})).toBeNull();
	expect(probeRendererMode({ [PROBE_RENDERER_ENV]: HARDWARE_RENDERER })).toBe(
		HARDWARE_RENDERER,
	);
	expect(() => probeRendererMode({ [PROBE_RENDERER_ENV]: "cpu" })).toThrow(
		`${PROBE_RENDERER_ENV} must be "${HARDWARE_RENDERER}" or unset`,
	);

	const defaults = { args: ["--example"] };
	expect(probeLaunchOptions(defaults, null)).toBe(defaults);

	// The default is windowless: the channel that carries the GPU in new
	// headless, and nothing else. No `headless: false`, no window to position,
	// and so none of the flags that existed to stop one being backgrounded.
	expect(probeLaunchOptions({}, HARDWARE_RENDERER)).toEqual({
		channel: HARDWARE_CHANNEL,
	});
	const defaulted = probeLaunchOptions(
		{ args: ["--example"] },
		HARDWARE_RENDERER,
	);
	expect(defaulted).toEqual({
		channel: HARDWARE_CHANNEL,
		args: ["--example"],
	});
	expect("headless" in defaulted).toBe(false);

	// A caller that names its own channel keeps it: the guard supplies the one
	// that is known to carry the GPU here, it does not overrule a probe that has
	// a reason for another.
	expect(probeLaunchOptions({ channel: "chrome" }, HARDWARE_RENDERER)).toEqual({
		channel: "chrome",
	});

	expect(
		probeLaunchOptions(
			{ args: ["--example"], probeWindow: PROBE_WINDOW_VISIBLE },
			HARDWARE_RENDERER,
		),
	).toEqual({ headless: false, args: ["--example"] });
});

test("a lockable view is neither headed nor positioned off screen", () => {
	// #454. `PROBE_WINDOW_LOCKABLE` owns why the mode carries neither
	// `headless: false` nor the offscreen flags; this pins that it does not.
	const lockable = probeLaunchOptions(
		{ channel: "chromium", probeWindow: PROBE_WINDOW_LOCKABLE },
		HARDWARE_RENDERER,
	);
	expect(lockable).toEqual({ channel: "chromium" });
	// And it resolves to the same launch as the default, which is the whole of
	// what it now asks for — one expression, so the two cannot drift apart.
	expect(lockable).toEqual(probeLaunchOptions({}, HARDWARE_RENDERER));
	expect("headless" in lockable).toBe(false);
	expect("probeWindow" in lockable).toBe(false);

	// Exactly the caller's own args, and an exact match is what says so — a
	// `not.toContain` beside it could not fail independently of this.
	const withArgs = probeLaunchOptions(
		{
			channel: "chromium",
			args: ["--example"],
			probeWindow: PROBE_WINDOW_LOCKABLE,
		},
		HARDWARE_RENDERER,
	);
	expect(withArgs.args).toEqual(["--example"]);

	// Still a no-op off the hardware lane: the caller's own options, unchanged.
	const defaults = { channel: "chromium", probeWindow: PROBE_WINDOW_LOCKABLE };
	expect(probeLaunchOptions(defaults, null)).toBe(defaults);
});

test("a window mode nobody declared is refused, not quietly made headed", () => {
	// The modes are picked by equality, so a misspelling used to fall through to
	// the offscreen default — `headless: false`, the launch #441 measured as
	// losing the lock. On both lanes, because a typo is a typo either way.
	for (const mode of [HARDWARE_RENDERER, null])
		expect(() =>
			probeLaunchOptions(
				{ channel: "chromium", probeWindow: "lockible" },
				mode,
			),
		).toThrow('probeWindow must be "visible", "lockable" or unset');
	// And the other half of the same rule: declaring a mode is not handling one,
	// so every member of the list must reach a branch. A mode declared without
	// one would otherwise land in the headed default it was declared to avoid.
	for (const mode of PROBE_WINDOWS)
		expect(() =>
			probeLaunchOptions({ probeWindow: mode }, HARDWARE_RENDERER),
		).not.toThrow();
});
