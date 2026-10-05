/**
 * The fake pad's poll counter, against a frame clock that behaves like the // glossary-ignore: pad
 * browser's (node #701).
 *
 * `probe-gamepad.mjs`'s check "the pad is read once per rendered frame" read // glossary-ignore: pad
 * `12 call(s) across 10 frames` on a loaded host, on two refs, alone and in a
 * suite. The count was taken across three `page.evaluate` round trips — reset,
 * wait for frames, read — and the game's own `rAF` keeps polling during the two
 * gaps between them. That attribution comes from a one-off measurement on
 * node #701's branch that is **not shipped**, so nothing in this repo reprints
 * it: calls attributed to where they landed, load 24 to 64 on ten cores, 140
 * samples, hardware lane, read each gap carrying 0 to 3 polls, totals of 10 to
 * 13 across 10 frames, and one poll inside each frame. Treat those figures as a
 * report, not as evidence these rows supply.
 *
 * `callsAcrossFrames` takes the baseline and the reading inside the probe's own
 * `rAF` callback, so both ends sit at the same place in the frame's callback
 * order and the gaps are outside the count. These rows hold that on a frame
 * clock the test drives: the callback list is snapshotted per frame, as the
 * HTML specification's "run the animation frame callbacks" does, so a callback
 * registered during a frame runs in the next one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakePad } from "../scripts/lib/fake-pad.mjs"; // glossary-ignore: pad

// glossary-ignore: pad
type Pad = {
	calls: number;
	resetCalls(): void;
	callsAcrossFrames(n: number): Promise<{ frames: number; calls: number }>;
};
type Page = {
	__pad: Pad; // glossary-ignore: pad
	__frames(n: number): Promise<{ frames: number }>;
};

const saved = {
	window: Object.getOwnPropertyDescriptor(globalThis, "window"),
	navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
	raf: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
};
const restore = (key: string, d: PropertyDescriptor | undefined) => {
	if (d) Object.defineProperty(globalThis, key, d);
	else delete (globalThis as Record<string, unknown>)[key];
};

let queue: (() => void)[] = [];
/** One rendered frame: the callbacks registered before it, in order. */
const frame = () => {
	const due = queue;
	queue = [];
	for (const cb of due) cb();
};
const frames = (n: number) => {
	for (let i = 0; i < n; i++) frame();
};
let page: Page;

/** The game's loop, as `Game.animate` has it: re-arm first, then poll. */
const startGame = (pollsPerFrame = 1, everyNth = 1) => {
	let k = 0;
	const animate = () => {
		requestAnimationFrame(animate);
		if (k++ % everyNth !== 0) return;
		for (let i = 0; i < pollsPerFrame; i++) navigator.getGamepads();
	};
	requestAnimationFrame(animate);
};

beforeEach(() => {
	queue = [];
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		writable: true,
		value: globalThis,
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		writable: true,
		value: {},
	});
	Object.defineProperty(globalThis, "requestAnimationFrame", {
		configurable: true,
		writable: true,
		value: (cb: () => void) => queue.push(cb),
	});
	installFakePad();
	page = globalThis as unknown as Page;
});

afterEach(() => {
	restore("window", saved.window);
	restore("navigator", saved.navigator);
	restore("requestAnimationFrame", saved.raf);
	delete (globalThis as Record<string, unknown>).__pad;
	delete (globalThis as Record<string, unknown>).__frames;
});

/**
 * Run a count, then `idleAfter` more frames before it is read. The leading gap
 * cannot be modelled from here: the count registers its callback in the same
 * call that starts it, which is the point. The trailing one can, and must
 * change nothing.
 */
const count = async (n: number, idleAfter = 0) => {
	const pending = page.__pad.callsAcrossFrames(n);
	frames(n + 1 + idleAfter);
	return pending;
};

describe("callsAcrossFrames", () => {
	test("a per-frame poll reads exactly N, however long the gaps around it", async () => {
		startGame();
		frames(7); // the game has been running before the count starts
		for (const idle of [0, 1, 2, 3, 9]) {
			const r = await count(10, idle);
			expect(r).toEqual({ frames: 10, calls: 10 });
		}
	});

	test("it reads N whichever of the two callbacks the frame runs first", async () => {
		// The probe's callback registered before the game's: the order is the
		// other way round, and it is just as stable from frame to frame.
		const pending = page.__pad.callsAcrossFrames(10);
		startGame();
		frames(15);
		expect(await pending).toEqual({ frames: 10, calls: 10 });
	});

	test("two polls a frame read 2N, so it is not a tolerance", async () => {
		startGame(2);
		frames(3);
		expect((await count(10)).calls).toBe(20);
	});

	test("a poll every other frame reads N/2", async () => {
		startGame(1, 2);
		frames(3);
		expect((await count(10)).calls).toBe(5);
	});

	test("it does not reset the counter the rAF-stubbed arm reads", async () => {
		startGame();
		frames(4);
		const before = page.__pad.calls;
		await count(10);
		expect(page.__pad.calls).toBe(before + 11);
	});
});

describe("the three-trip count it replaces", () => {
	// Reset, wait `__frames(N)`, read — each a separate round trip, with the
	// game's frames running in between. This is the arithmetic of the red, not
	// a measurement of the browser: the attribution run is in the header above.
	test("reads N plus every frame that fell into either gap", async () => {
		startGame();
		frames(3);
		for (const [lead, trail] of [
			[0, 0],
			[0, 2],
			[2, 0],
			[1, 1],
		]) {
			page.__pad.resetCalls();
			frames(lead);
			const waited = page.__frames(10);
			frames(10);
			const { frames: rendered } = await waited;
			frames(trail);
			expect(page.__pad.calls).toBe(rendered + lead + trail);
		}
	});
});
