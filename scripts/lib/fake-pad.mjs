/**
 * One synthetic controller, for the three probes that drive a pad (#283).
 *
 * It was three copies until sage asked why, round 1. The copies were already
 * diverging — one counted `getGamepads` calls and two did not, one could move
 * the sticks and one could not — and a fixture that *is* the contract the code
 * is written against is the last thing that should drift between the files
 * checking it.
 *
 * **What it establishes and what it cannot.** Every check in those probes runs
 * against this object: a plain pad reporting `mapping: "standard"` with
 * seventeen buttons and four axes. That is the contract, and the whole of what
 * is verified. It says nothing about whether any physical controller satisfies
 * it — `docs/gamepad.md` says so at more length, and #283 does not close on a
 * green probe for that reason.
 */

/**
 * The W3C standard mapping, as literals.
 *
 * **Deliberately not imported from `src/gamepad.ts`.** A fixture built from the
 * module's own list agrees with it by construction and could not report that
 * either of them had drifted from the specification.
 *
 * **Where the drift *is* caught is `tests/pad-bindings.test.ts`**, which
 * compares `STANDARD_BUTTONS` against the seventeen names as literals. An
 * earlier version of this paragraph said `probe-gamepad.mjs` asserted it, and
 * that was false: the probe carried such a check before the three fixtures were
 * merged into this one, and the check went with them. Sage read the claim
 * against the code, round 5.
 */
export const STANDARD_INDEX = {
	a: 0,
	b: 1,
	x: 2,
	y: 3,
	l1: 4,
	r1: 5,
	l2: 6,
	r2: 7,
	select: 8,
	start: 9,
	l3: 10,
	r3: 11,
	up: 12,
	down: 13,
	left: 14,
	right: 15,
	home: 16,
};

/**
 * An init script that installs the fake pad, a frame clock and a driver.
 *
 * Pass it to `page.addInitScript` **before** `goto`: the browser hides a pad
 * until a button is pressed, and the module's first poll has to find one there.
 *
 * It installs three globals. `window.__pad` drives the device — `hold`,
 * `release`, `axes`, `rest`, `unplug`, and a `calls` count of how many times
 * `getGamepads` has been asked. `window.__frames(n)` resolves after `n`
 * rendered frames, and lives in the page because half of each probe waits for
 * frames from inside an `evaluate` and half from outside — a frame under
 * SwiftShader is a large fraction of a second, so how many a check waits for is
 * worth having in one place.
 */
export const installFakePad = () => {
	const pad = {
		id: "Fake DualSense (STANDARD GAMEPAD)",
		mapping: "standard",
		index: 0,
		connected: true,
		axes: [0, 0, 0, 0],
		buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
	};
	let unplugged = false;
	let calls = 0;
	// `defineProperty` rather than assignment: `getGamepads` lives on
	// `Navigator.prototype` and is not writable through the instance, so a plain
	// `navigator.getGamepads = …` is a silent no-op — the failure that would make
	// every check pass for the wrong reason.
	Object.defineProperty(navigator, "getGamepads", {
		configurable: true,
		value: () => {
			calls += 1;
			return unplugged ? [] : [pad];
		},
	});
	window.__frames = (n) =>
		new Promise((res) => {
			let seen = 0;
			const tick = () => {
				if (++seen >= n) res({ frames: seen });
				else requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
	window.__pad = {
		raw: pad,
		get calls() {
			return calls;
		},
		resetCalls() {
			calls = 0;
		},
		axes(lx, ly, rx, ry) {
			pad.axes = [lx, ly, rx, ry];
		},
		hold(i, value = 1) {
			pad.buttons[i] = { pressed: value >= 0.5, value };
		},
		release(i) {
			pad.buttons[i] = { pressed: false, value: 0 };
		},
		rest() {
			pad.axes = [0, 0, 0, 0];
			pad.buttons = pad.buttons.map(() => ({ pressed: false, value: 0 }));
		},
		unplug() {
			unplugged = true;
		},
	};
};
