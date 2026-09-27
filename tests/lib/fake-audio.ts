/**
 * A fake `AudioContext` that records the graph the engine builds, for the
 * headless tier: bun has no WebAudio. Nothing that uses it asserts on a
 * waveform — the sounds are the principal's to judge and the offline probe's
 * to band. The plumbing is not.
 */
import { AudioFX } from "../../src/audio";

export class FakeParam {
	value = 0;
	readonly events: Array<[string, number, number]> = [];
	setValueAtTime(v: number, t: number) {
		this.events.push(["set", v, t]);
	}
	exponentialRampToValueAtTime(v: number, t: number) {
		this.events.push(["exp", v, t]);
	}
	setTargetAtTime(v: number, t: number) {
		this.events.push(["target", v, t]);
	}
	/** The value the last scheduled event aims at, or `value` with none. */
	get target(): number {
		const last = this.events.at(-1);
		return last ? last[1] : this.value;
	}
}

export class FakeNode {
	readonly outputs: FakeNode[] = [];
	disconnected = false;
	connect(to: FakeNode) {
		this.outputs.push(to);
		return to;
	}
	disconnect() {
		this.disconnected = true;
	}
}

export class FakeGain extends FakeNode {
	readonly gain = new FakeParam();
}

export class FakeCompressor extends FakeNode {
	readonly threshold = new FakeParam();
	readonly knee = new FakeParam();
	readonly ratio = new FakeParam();
	readonly attack = new FakeParam();
	readonly release = new FakeParam();
}

export class FakeContext {
	static made: FakeContext[] = [];
	currentTime = 10;
	sampleRate = 8000;
	state = "running";
	readonly destination = new FakeNode();
	readonly gains: FakeGain[] = [];
	readonly compressors: FakeCompressor[] = [];
	readonly sources: FakeNode[] = [];
	constructor() {
		FakeContext.made.push(this);
	}
	createGain() {
		const g = new FakeGain();
		this.gains.push(g);
		return g;
	}
	createDynamicsCompressor() {
		const c = new FakeCompressor();
		this.compressors.push(c);
		return c;
	}
	createOscillator() {
		const o = Object.assign(new FakeNode(), {
			type: "sine",
			frequency: new FakeParam(),
			start() {},
			stop() {},
		});
		this.sources.push(o);
		return o;
	}
	createBiquadFilter() {
		return Object.assign(new FakeNode(), {
			type: "lowpass",
			frequency: new FakeParam(),
			Q: new FakeParam(),
		});
	}
	createBuffer(_c: number, len: number) {
		const data = new Float32Array(len);
		return { getChannelData: () => data };
	}
	createBufferSource() {
		const s = Object.assign(new FakeNode(), {
			buffer: null,
			loop: false,
			start() {},
		});
		this.sources.push(s);
		return s;
	}
	resume() {}
}

/** Does `node` reach `target` through the recorded graph? */
export function reaches(node: FakeNode, target: FakeNode): boolean {
	if (node === target) return true;
	return node.outputs.some((o) => reaches(o, target));
}

/** Install `FakeContext` as `window.AudioContext` for the test, and restore. */
export function withFakeWindow(
	beforeEach: (fn: () => void) => void,
	afterEach: (fn: () => void) => void,
) {
	let saved: unknown;
	beforeEach(() => {
		saved = (globalThis as { window?: unknown }).window;
		(globalThis as { window?: unknown }).window = {
			AudioContext: FakeContext,
		};
		FakeContext.made.length = 0;
	});
	afterEach(() => {
		(globalThis as { window?: unknown }).window = saved;
	});
}

/**
 * An engine unlocked on a fake context, with its graph named. One copy for
 * every audio test: the buses are found by what they connect to rather than by
 * creation order, so a reorder inside `attach` moves nothing here.
 */
export function unlocked() {
	const audio = new AudioFX();
	audio.ensure();
	const ctx = FakeContext.made.at(-1) as FakeContext;
	const limiter = ctx.compressors[0];
	const master = ctx.gains.find((g) => g.outputs.includes(limiter)) as FakeGain;
	const cueBuses = ctx.gains.filter((g) => g.outputs.includes(master));
	// The four buses under master, in `BUSES` order after master — the one
	// ordering this relies on, and `audio-engine.test.ts` checks it by gain.
	const [ship, combat, console_, music] = cueBuses;
	return {
		audio,
		ctx,
		master,
		limiter,
		buses: { ship, combat, console: console_, music },
	};
}
