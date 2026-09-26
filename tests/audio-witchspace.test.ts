/**
 * #532's audio half: D3's two witchspace cues and the stop that a cancelled
 * charge owes. The schedule — when each cue fires — is `witchspace.ts`'s and is
 * tested there; this file tests that the cues can be *taken back*.
 *
 * A fake `AudioContext` records the graph. Nothing here asserts on a waveform:
 * the sounds are the principal's to judge, the plumbing is not.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AudioFX } from "../src/audio";

class FakeParam {
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
}

class FakeNode {
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

class FakeGain extends FakeNode {
	readonly gain = new FakeParam();
}

class FakeContext {
	static made: FakeContext[] = [];
	currentTime = 10;
	sampleRate = 8000;
	state = "running";
	readonly destination = new FakeNode();
	readonly gains: FakeGain[] = [];
	readonly sources: FakeNode[] = [];
	constructor() {
		FakeContext.made.push(this);
	}
	createGain() {
		const g = new FakeGain();
		this.gains.push(g);
		return g;
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
		const s = Object.assign(new FakeNode(), { buffer: null, start() {} });
		this.sources.push(s);
		return s;
	}
	resume() {}
}

/** Does `node` reach `target` through the recorded graph? */
function reaches(node: FakeNode, target: FakeNode): boolean {
	if (node === target) return true;
	return node.outputs.some((o) => reaches(o, target));
}

let saved: unknown;
beforeEach(() => {
	saved = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = { AudioContext: FakeContext };
	FakeContext.made.length = 0;
});
afterEach(() => {
	(globalThis as { window?: unknown }).window = saved;
});

function unlocked() {
	const audio = new AudioFX();
	audio.ensure();
	const ctx = FakeContext.made[0];
	return { audio, ctx };
}

describe("the witchspace cues", () => {
	test("the sweep and the hum each sound through a group of their own", () => {
		const { audio, ctx } = unlocked();
		const master = ctx.gains[0];
		audio.chargeHum(1.6);
		audio.hyperspace();
		// master + hum group + hum envelope + sweep group + tone gain + noise gain
		const groups = ctx.gains.filter(
			(g) => g !== master && g.outputs.includes(master),
		);
		expect(groups.length).toBe(2);
		// Every voice reaches the master only through one of the two groups.
		for (const source of ctx.sources) {
			expect(reaches(source, master)).toBe(true);
			expect(groups.some((g) => reaches(source, g))).toBe(true);
		}
	});

	test("stop ramps both groups to silence and lets them go", () => {
		const { audio, ctx } = unlocked();
		const master = ctx.gains[0];
		audio.chargeHum(1.6);
		audio.hyperspace();
		const groups = ctx.gains.filter(
			(g) => g !== master && g.outputs.includes(master),
		);
		audio.stopWitchspace();
		for (const g of groups)
			expect(g.gain.events).toContainEqual(["target", 0, ctx.currentTime]);
	});

	test("a second stop, with nothing sounding, schedules nothing", () => {
		const { audio, ctx } = unlocked();
		audio.hyperspace();
		audio.stopWitchspace();
		const count = ctx.gains.map((g) => g.gain.events.length);
		audio.stopWitchspace();
		expect(ctx.gains.map((g) => g.gain.events.length)).toEqual(count);
	});

	test("muted, neither cue builds anything", () => {
		const { audio, ctx } = unlocked();
		audio.setMuted(true);
		const before = ctx.gains.length;
		audio.chargeHum(1.6);
		audio.hyperspace();
		expect(ctx.gains.length).toBe(before);
	});

	test("before a gesture there is no context, and every cue is a no-op", () => {
		const audio = new AudioFX();
		audio.chargeHum(1.6);
		audio.hyperspace();
		audio.stopWitchspace();
		expect(FakeContext.made.length).toBe(0);
	});
});
