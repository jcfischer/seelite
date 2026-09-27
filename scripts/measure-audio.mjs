/**
 * What WebAudio can carry here (#541): whether a probe can hear a cue, what a
 * voice costs, where the realtime ceiling is beside a loaded renderer, what a
 * main-thread stall does to a cue, and what latency the output adds.
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/measure-audio.mjs <mode>
 *   SEELITE_PROBE_RENDERER=hardware WINDOW=visible node scripts/measure-audio.mjs <mode>
 *   node scripts/measure-audio.mjs <mode>        # cpu lane, headless shell
 *
 * **Three lanes, and the audio differs between them.** The GPU lane's default
 * is windowless (#458), which Playwright launches headless — and a headless
 * launch gets `--mute-audio`. `WINDOW=visible` asks `probe-guard` for its
 * headed window instead, which is the only lane here whose output is not
 * muted. The line each run prints first names the lane it ran on.
 *
 * Modes: `cues`, `voices`, `convolver`, `realtime`, `clock`, `latency`,
 * `unlock`, `gpucal`. No dev server: the script serves its own page, because
 * nothing here is about the game's build — it is about the browser the game
 * runs in. It launches through `launchChromium`, and the lane it prints is
 * derived from the same two switches `probeLaunchOptions` reads.
 *
 * ## Not a probe, and not a gate
 *
 * It asserts nothing and exits 0 on a finished run. The figures are for a
 * receipt and for the sound nodes that choose machinery from them; a ceiling
 * that holds on the principal's M1 Pro says nothing about a slower machine, so
 * it would be the wrong threshold to fail on. The `measure-` prefix keeps it
 * out of `probe-all`.
 *
 * ## What each mode reads, and what it cannot
 *
 * - **`cues`** renders copies of `audio.ts`'s primitives in an
 *   `OfflineAudioContext` and prints `cueStats` (`lib/audio-stats.mjs`). The
 *   copies are copies because `AudioFX` owns one realtime context and cannot
 *   be rendered offline; a cue that changes in `audio.ts` does not change here.
 *   Noise cues draw `Math.random()`, as `audio.ts` does, so they print ranges.
 * - **`voices`** and **`convolver`** time `startRendering()` offline. That is
 *   relative cost, not realtime capacity: offline rendering has no deadline,
 *   no realtime thread, and — for the convolver — no background thread.
 * - **`realtime`** runs FM+SVF worklet voices on a live context beside a
 *   synthetic load (a full-screen shader, or a main-thread busy loop) and
 *   reads `AudioContext.playbackStats`. The master gain is 1e-4, so nothing is
 *   audible. **`underrunEvents` is read as zero against non-zero only**: at
 *   overload it stays near 730 per 4 s from 512 to 1024 voices while audio
 *   time falls from about 0.9 to 0.5 of wall time, and runs at 512 read audio
 *   time as high as 0.99 of wall time beside 600 or more events. Its amounts
 *   are not understood, so
 *   this prints them without calling them amounts. Native voices are not run
 *   in realtime.
 * - **`clock`** stalls the main thread for 150 or 300 ms, keyed on the audio
 *   clock at a seeded phase, and prints how late each beat of a 125 ms grid
 *   was scheduled — fired from the frame loop at `currentTime`, or placed by a
 *   25 ms `setInterval` with 100 or 200 ms of lookahead. It reads the time a
 *   beat was *scheduled for*, which is sample-exact on the audio thread; it
 *   does not record the output.
 * - **`unlock`** launches **without** the autoplay flag the other modes pass
 *   and reports the context state after no input, Escape, Shift, a key and a
 *   click. On Chrome 153 the context is already `running` and
 *   `userActivation.hasBeenActive` already true before any input, so this lane
 *   cannot check the gesture rule. The mode exists so that stays checkable.
 * - **`gpucal`** prints the frame period per shader iteration count, which is
 *   how `ITERS` for `realtime` is chosen (1600 gave ~33 ms frames on an M1 Pro,
 *   near `berth-free-look`'s 40 ms).
 *
 * Arms are shuffled from `SEED` (default 541). `ROUNDS`, `ITERS`, `NS` (voice
 * counts for `realtime`) and `PORT` (default 5391) are read from the
 * environment. Every line printed is JSON; the last lines of each mode are its
 * summary.
 */
import { createServer } from "node:http";
import { cueStats } from "./lib/audio-stats.mjs";
import {
	launchChromium,
	PROBE_WINDOW_VISIBLE,
	probeRendererMode,
} from "./probe-guard.mjs";

const PORT = Number(process.env.PORT ?? 5391);
const SEED = Number(process.env.SEED ?? 541);
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const ITERS = Number(process.env.ITERS ?? 1600);
const NS = (process.env.NS ?? "0,128,256,512,1024").split(",").map(Number);
const MODES = [
	"cues",
	"voices",
	"convolver",
	"realtime",
	"clock",
	"latency",
	"unlock",
	"gpucal",
];

/**
 * A synth voice native nodes cannot build: two-operator FM with per-sample
 * operator feedback, into a state-variable lowpass whose cutoff moves every
 * sample. `voices` of them summed inside one node. A string, because it runs
 * in `AudioWorkletGlobalScope`, whose names the repo's lint does not know.
 *
 * **`sampleRate` is read once, in the constructor.** `FmVoicesGlobal` is the
 * same voice reading the global in the inner loop, four times per voice per
 * sample, as a first port of this class did; the `voices` mode's
 * `worklet-global` arm runs it beside the others, so what that costs is
 * reprinted rather than remembered.
 */
/**
 * One voice class, written once and emitted twice. The two differ only in
 * `sr`, the expression every inner-loop use of the sample rate reads: a local
 * copied from the constructor, or the global. A hand-kept second copy could
 * drift from the first and skew the comparison it exists for.
 */
const voiceClass = (name, sr) => `
class ${name} extends AudioWorkletProcessor {
	constructor(opts) {
		super();
		this.n = opts.processorOptions.voices;
		this.sr = sampleRate;
		this.ph = new Float64Array(this.n); this.mph = new Float64Array(this.n);
		this.fb = new Float64Array(this.n); this.lp = new Float64Array(this.n);
		this.bp = new Float64Array(this.n); this.f = new Float64Array(this.n);
		for (let i = 0; i < this.n; i++) this.f[i] = 110 * (1 + (i % 12) / 12);
		this.t = 0;
	}
	process(_in, outs) {
		const out = outs[0][0]; const L = out.length; const n = this.n; const sr = this.sr;
		for (let s = 0; s < L; s++) {
			const time = (this.t + s) / ${sr}; let acc = 0;
			for (let v = 0; v < n; v++) {
				const f = this.f[v];
				this.mph[v] += (f * 2) / ${sr};
				const m = Math.sin(2 * Math.PI * this.mph[v] + 0.7 * this.fb[v]);
				this.fb[v] = m;
				this.ph[v] += f / ${sr};
				const c = Math.sin(2 * Math.PI * this.ph[v] + 2 * m);
				const cut = 400 + 300 * Math.sin(2 * Math.PI * 0.5 * time + v);
				const g = 2 * Math.sin((Math.PI * cut) / ${sr});
				this.lp[v] += g * this.bp[v];
				this.bp[v] += g * (c - this.lp[v] - 0.5 * this.bp[v]);
				acc += this.lp[v];
			}
			out[s] = acc * (0.5 / n);
		}
		this.t += L;
		return true;
	}
}
`;
const WORKLET = `${voiceClass("FmVoices", "sr")}
registerProcessor("fm-voices", FmVoices);
${voiceClass("FmVoicesGlobal", "sampleRate")}
registerProcessor("fm-voices-global", FmVoicesGlobal);
`;

/**
 * Everything the page runs, shipped as this function's source. It may use
 * only browser globals and `cueStats`, which the page defines first.
 */
function pageLib() {
	// Copies of audio.ts's primitives, on any BaseAudioContext and a start time.
	const tone = (ctx, dest, t, freq, dur, type, vol = 0.3, slideTo) => {
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t);
		if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(g);
		g.connect(dest);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	};
	const noiseBurst = (ctx, dest, t, dur, vol = 0.3, filterFreq = 800) => {
		const len = Math.floor(ctx.sampleRate * dur);
		const b = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = b.getChannelData(0);
		for (let i = 0; i < len; i++)
			d[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const src = ctx.createBufferSource();
		src.buffer = b;
		const f = ctx.createBiquadFilter();
		f.type = "lowpass";
		f.frequency.value = filterFreq;
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f);
		f.connect(g);
		g.connect(dest);
		src.start(t);
	};
	const CUES = {
		laser: (c, d, t) => {
			tone(c, d, t, 880, 0.14, "square", 0.14, 180);
			noiseBurst(c, d, t, 0.08, 0.12, 3000);
		},
		laserTone: (c, d, t) => tone(c, d, t, 880, 0.14, "square", 0.14, 180),
		explosion: (c, d, t) => {
			noiseBurst(c, d, t, 0.8, 0.5, 500);
			tone(c, d, t, 70, 0.6, "sine", 0.4, 30);
		},
		scoop: (c, d, t) => {
			tone(c, d, t, 320, 0.1, "triangle", 0.16, 720);
			tone(c, d, t, 720, 0.12, "sine", 0.1, 960);
		},
	};
	const renderCue = async (name, sr) => {
		const ctx = new OfflineAudioContext(1, Math.floor(sr * 1.5), sr);
		const m = ctx.createGain();
		m.gain.value = 0.4;
		m.connect(ctx.destination);
		CUES[name](ctx, m, 0.25);
		const t0 = performance.now();
		const buf = await ctx.startRendering();
		const renderMs = performance.now() - t0;
		return { name, sr, renderMs, ...cueStats(buf.getChannelData(0), sr) };
	};

	const cost = async (arm, n, seconds = 10, sr = 48000) => {
		const ctx = new OfflineAudioContext(1, sr * seconds, sr);
		const m = ctx.createGain();
		m.gain.value = 0.5 / n;
		m.connect(ctx.destination);
		const b0 = performance.now();
		if (arm === "native") {
			for (let v = 0; v < n; v++) {
				const o = ctx.createOscillator();
				o.type = "sawtooth";
				o.frequency.value = 110 * (1 + (v % 12) / 12);
				const f = ctx.createBiquadFilter();
				f.type = "lowpass";
				f.frequency.value = 400;
				f.Q.value = 4;
				const lfo = ctx.createOscillator();
				lfo.frequency.value = 0.5;
				const lg = ctx.createGain();
				lg.gain.value = 300;
				lfo.connect(lg);
				lg.connect(f.frequency);
				const g = ctx.createGain();
				g.gain.setValueAtTime(0, 0);
				g.gain.linearRampToValueAtTime(1, 0.01);
				g.gain.setTargetAtTime(0.6, 0.01, 0.2);
				o.connect(f);
				f.connect(g);
				g.connect(m);
				o.start(0);
				lfo.start(0);
			}
		} else if (arm === "native-churn") {
			// Every note of the run built before rendering: `buildMs` is the
			// main-thread cost of `tone()`; the render figure measures a graph
			// of that many nodes, not churn, and is not quoted.
			for (let k = 0; k < seconds * 10; k++)
				for (let v = 0; v < n; v++)
					tone(ctx, m, k * 0.1, 110 * (1 + (v % 12) / 12), 0.09, "sawtooth");
		} else if (arm.startsWith("worklet-")) {
			await ctx.audioWorklet.addModule("/worklet.js");
			const one = arm !== "worklet-each";
			const name = arm === "worklet-global" ? "fm-voices-global" : "fm-voices";
			for (let v = 0; v < (one ? 1 : n); v++)
				new AudioWorkletNode(ctx, name, {
					processorOptions: { voices: one ? n : 1 },
				}).connect(m);
		} else if (arm.startsWith("convolver:")) {
			const irS = Number(arm.slice("convolver:".length));
			const src = ctx.createBufferSource();
			const nb = ctx.createBuffer(1, sr, sr);
			const d = nb.getChannelData(0);
			for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
			src.buffer = nb;
			src.loop = true;
			if (irS > 0) {
				// Exponentially decaying noise, -60 dB at the end of the tail.
				const ir = ctx.createBuffer(2, Math.floor(sr * irS), sr);
				for (let c = 0; c < 2; c++) {
					const x = ir.getChannelData(c);
					for (let i = 0; i < x.length; i++)
						x[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / x.length);
				}
				const cv = ctx.createConvolver();
				cv.buffer = ir;
				src.connect(cv);
				cv.connect(m);
			} else src.connect(m);
			src.start(0);
		}
		const buildMs = performance.now() - b0;
		const t0 = performance.now();
		const buf = await ctx.startRendering();
		const renderMs = performance.now() - t0;
		const x = buf.getChannelData(0);
		let e = 0;
		for (let i = 0; i < x.length; i += 97) e += x[i] * x[i];
		return {
			arm,
			n,
			buildMs,
			msPerAudioSecond: renderMs / seconds,
			alive: e > 0,
		};
	};

	// The load: a full-screen shader of `iters` iterations drawn every frame
	// and fenced with a 1x1 readPixels, or a busy loop of `busyMs`.
	let gl = null;
	let prog = null;
	let iters = 0;
	let busyMs = 0;
	let rafTimes = [];
	const hooks = [];
	const initGL = () => {
		const canvas = document.createElement("canvas");
		canvas.width = 1440;
		canvas.height = 900;
		document.body.appendChild(canvas);
		gl = canvas.getContext("webgl2");
		const sh = (type, src) => {
			const s = gl.createShader(type);
			gl.shaderSource(s, src);
			gl.compileShader(s);
			// A program that fails leaves drawArrays a no-op, and a "gpu" row
			// would then report an idle renderer as loaded.
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
				throw new Error(`load shader: ${gl.getShaderInfoLog(s)}`);
			return s;
		};
		prog = gl.createProgram();
		gl.attachShader(
			prog,
			sh(
				gl.VERTEX_SHADER,
				"#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0,1);}",
			),
		);
		gl.attachShader(
			prog,
			sh(
				gl.FRAGMENT_SHADER,
				"#version 300 es\nprecision highp float;uniform int N;uniform float T;out vec4 o;" +
					"void main(){vec2 u=gl_FragCoord.xy*0.001;float a=T;" +
					"for(int i=0;i<N;i++){a=sin(a*1.01+u.x)*cos(a*0.99+u.y)+0.001*float(i);}" +
					"o=vec4(a,a*0.5,0.2,1);}",
			),
		);
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
			throw new Error(`load program: ${gl.getProgramInfoLog(prog)}`);
		gl.useProgram(prog);
		const uN = gl.getUniformLocation(prog, "N");
		const uT = gl.getUniformLocation(prog, "T");
		const pixel = new Uint8Array(4);
		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 3, -1, -1, 3]),
			gl.STATIC_DRAW,
		);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const frame = (now) => {
			rafTimes.push(now);
			if (iters > 0) {
				gl.uniform1i(uN, iters);
				gl.uniform1f(uT, now * 1e-3);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			}
			if (busyMs > 0) {
				const end = performance.now() + busyMs;
				while (performance.now() < end);
			}
			for (const h of [...hooks]) h(now);
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	};
	const framePeriod = (ms) =>
		new Promise((resolve) => {
			rafTimes = [];
			setTimeout(() => {
				const d = [];
				for (let i = 1; i < rafTimes.length; i++)
					d.push(rafTimes[i] - rafTimes[i - 1]);
				d.sort((a, b) => a - b);
				resolve({ frames: d.length, medianMs: d[d.length >> 1] });
			}, ms);
		});
	const stats = (ctx) => {
		const out = {};
		const ps = ctx.playbackStats;
		if (ps) for (const k in ps) if (typeof ps[k] !== "function") out[k] = ps[k];
		return out;
	};

	const realtime = async (n, loadIters, loadBusy, seconds = 4) => {
		const ctx = new AudioContext({ latencyHint: "interactive" });
		await ctx.resume();
		const m = ctx.createGain();
		m.gain.value = 1e-4 / Math.max(n, 1);
		m.connect(ctx.destination);
		if (n > 0) {
			await ctx.audioWorklet.addModule("/worklet.js");
			new AudioWorkletNode(ctx, "fm-voices", {
				processorOptions: { voices: n },
			}).connect(m);
		}
		iters = loadIters;
		busyMs = loadBusy;
		await new Promise((r) => setTimeout(r, 500));
		const before = stats(ctx);
		const c0 = ctx.currentTime;
		const p0 = performance.now();
		const frame = await framePeriod(seconds * 1000);
		const after = stats(ctx);
		const clockRatio =
			(ctx.currentTime - c0) / ((performance.now() - p0) / 1000);
		iters = 0;
		busyMs = 0;
		// A context that never ran reads 0 underruns, which is the figure a
		// pass would print. It happened once (#541): in one run, 8 of 9 cells
		// had a clock that stood still, 512 voices among them, and read clean.
		// That run served its page from 127.0.0.1; a later 127.0.0.1 run and
		// every localhost run did not, so the cause is not known.
		if (clockRatio < 0.05)
			throw new Error(
				`context ${ctx.state}, clock at ${clockRatio.toFixed(3)} of wall time: no row`,
			);
		const delta = {};
		for (const k of ["underrunEvents", "underrunDuration", "totalDuration"])
			if (k in after) delta[k] = after[k] - before[k];
		const res = {
			n,
			load: loadIters ? "gpu" : loadBusy ? "main" : "idle",
			frameMs: frame.medianMs,
			clockRatio,
			hasPlaybackStats: "underrunEvents" in after,
			hasRenderCapacity: "renderCapacity" in ctx,
			...delta,
		};
		await ctx.close();
		return res;
	};

	// A 125 ms grid of 32 beats and one stall of `stallMs` near beat 12, keyed
	// on the audio clock at `phase` of a beat, recorded as it actually ran.
	const clock = async (arm, lookaheadS, stallMs, phase) => {
		const ctx = new AudioContext({ latencyHint: "interactive" });
		await ctx.resume();
		const m = ctx.createGain();
		m.gain.value = 1e-4;
		m.connect(ctx.destination);
		const period = 0.125;
		const beats = 32;
		const t0 = ctx.currentTime + 0.3;
		const when = [];
		let next = 0;
		const click = (t) => {
			const o = ctx.createOscillator();
			o.connect(m);
			o.start(t);
			o.stop(t + 0.01);
			when.push(t);
		};
		const stallAt = t0 + (11 + phase) * period;
		const stall = {};
		const stallHook = () => {
			if (ctx.currentTime < stallAt) return;
			hooks.splice(hooks.indexOf(stallHook), 1);
			stall.start = ctx.currentTime;
			const end = performance.now() + stallMs;
			while (performance.now() < end);
			stall.end = ctx.currentTime;
		};
		hooks.push(stallHook);
		await new Promise((resolve) => {
			if (arm === "raf") {
				const hook = () => {
					while (next < beats && ctx.currentTime >= t0 + next * period) {
						click(ctx.currentTime);
						next++;
					}
					if (next < beats) return;
					hooks.splice(hooks.indexOf(hook), 1);
					resolve();
				};
				hooks.push(hook);
			} else {
				const timer = setInterval(() => {
					while (
						next < beats &&
						t0 + next * period < ctx.currentTime + lookaheadS
					) {
						click(Math.max(t0 + next * period, ctx.currentTime));
						next++;
					}
					if (next < beats) return;
					clearInterval(timer);
					resolve();
				}, 25);
			}
		});
		const late = when.map((t, i) => (t - (t0 + i * period)) * 1000);
		const res = {
			arm,
			lookaheadS,
			stallMs,
			stallAudioMs: (stall.end - stall.start) * 1000,
			stallAtBeat: (stall.start - t0) / period,
			maxLateMs: Math.max(...late),
			lateBeats: late.filter((x) => x > 1).length,
		};
		await ctx.close();
		return res;
	};

	const latency = async () => {
		const out = [];
		for (const hint of ["interactive", "balanced", "playback"]) {
			const c = new AudioContext({ latencyHint: hint });
			await c.resume();
			await new Promise((r) => setTimeout(r, 400));
			out.push({
				hint,
				sampleRate: c.sampleRate,
				baseLatencyMs: c.baseLatency * 1000,
				outputLatencyMs: c.outputLatency * 1000,
			});
			await c.close();
		}
		return out;
	};

	window.M = {
		renderCue,
		cost,
		initGL,
		framePeriod,
		realtime,
		clock,
		latency,
		setLoad: (i) => {
			iters = i;
		},
	};
}

const mode = process.argv[2];
if (!MODES.includes(mode)) {
	console.error(`usage: node scripts/measure-audio.mjs <${MODES.join("|")}>`);
	process.exit(2);
}

/**
 * The lane, from the two switches `probeLaunchOptions` reads. It honours a
 * window only on the hardware lane, so `WINDOW=visible` without it would
 * launch the headless shell under a name that says otherwise: refused.
 */
const visible = process.env.WINDOW === PROBE_WINDOW_VISIBLE;
if (visible && !probeRendererMode()) {
	console.error("WINDOW=visible needs SEELITE_PROBE_RENDERER=hardware");
	process.exit(2);
}
const lane = !probeRendererMode()
	? "cpu-headless"
	: visible
		? "gpu-visible"
		: "gpu-windowless";

let seed = SEED;
const rnd = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (a) => {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};
const out = (x) => console.log(JSON.stringify(x));
/**
 * The one round discipline every mode uses: `rounds` passes over `cells`,
 * each pass in a fresh seeded order, every row printed as it lands.
 */
const runCells = async (rounds, cells, run) => {
	const rows = [];
	for (let r = 0; r < rounds; r++)
		for (const cell of shuffle([...cells])) {
			const row = await run(cell);
			out(row);
			rows.push(row);
		}
	return rows;
};
const span = (xs, d = 2) => {
	const lo = Math.min(...xs);
	const hi = Math.max(...xs);
	return lo === hi ? lo.toFixed(d) : `${lo.toFixed(d)}–${hi.toFixed(d)}`;
};
/** One summary line per cell: the range of every numeric field over its runs. */
const summarise = (rows, keyOf, fields) => {
	const cells = new Map();
	for (const r of rows) {
		const k = keyOf(r);
		if (!cells.has(k)) cells.set(k, []);
		cells.get(k).push(r);
	}
	for (const [k, rs] of [...cells].sort(([a], [b]) => a.localeCompare(b)))
		out({
			summary: k,
			runs: rs.length,
			...Object.fromEntries(
				fields.map(([f, d]) => [
					f,
					rs.every((r) => typeof r[f] === "number")
						? span(
								rs.map((r) => r[f]),
								d,
							)
						: [...new Set(rs.map((r) => r[f]))].join("/"),
				]),
			),
		});
};

const page = `<!doctype html><meta charset="utf-8"><title>measure-audio</title>
<body style="margin:0;background:#000"><script src="/lib.js"></script></body>`;
const lib = `window.cueStats = ${cueStats};\n(${pageLib})();`;
const ROUTES = new Map([
	["/", ["text/html", page]],
	["/lib.js", ["text/javascript", lib]],
	["/worklet.js", ["text/javascript", WORKLET]],
]);
const server = createServer((req, res) => {
	const body = ROUTES.get(req.url);
	if (!body) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { "content-type": body[0] });
	res.end(body[1]);
}).listen(PORT, "localhost");

// Every mode but `unlock` lifts the autoplay rule, so a context can start
// without scripting a gesture; `unlock` is the mode that asks about the rule.
const browser = await launchChromium({
	...(visible ? { probeWindow: PROBE_WINDOW_VISIBLE } : {}),
	args: mode === "unlock" ? [] : ["--autoplay-policy=no-user-gesture-required"],
});
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const newPage = async () => {
		const p = await context.newPage();
		await p.goto(`http://localhost:${PORT}/`);
		return p;
	};
	const p = await newPage();
	out({
		lane,
		ua: await p.evaluate(() => navigator.userAgent),
		seed: SEED,
		mode,
	});

	if (mode === "cues") {
		const rows = await runCells(
			5,
			["laser", "laserTone", "explosion", "scoop"],
			(c) => p.evaluate((c) => window.M.renderCue(c, 48000), c),
		);
		const at44 = await p.evaluate(() => window.M.renderCue("laserTone", 44100));
		out(at44);
		rows.push(at44);
		summarise(rows, (r) => `${r.name}@${r.sr}`, [
			["rms", 5],
			["peak", 4],
			["onsetSample", 0],
			["centroidHz", 0],
			["fnv"],
			["renderMs", 1],
		]);
	} else if (mode === "voices" || mode === "convolver") {
		const cells =
			mode === "voices"
				? [
						"native",
						"native-churn",
						"worklet-one",
						"worklet-each",
						"worklet-global",
					].flatMap((a) => [8, 32, 128].map((n) => [a, n]))
				: [0, 0.5, 2, 5].map((s) => [`convolver:${s}`, 1]);
		const rows = await runCells(ROUNDS, cells, (c) =>
			p.evaluate(([a, n]) => window.M.cost(a, n), c),
		);
		summarise(rows, (r) => `${r.arm} n=${String(r.n).padStart(3)}`, [
			["msPerAudioSecond", 1],
			["buildMs", 1],
			["alive"],
		]);
	} else if (mode === "realtime") {
		await p.evaluate(() => window.M.initGL());
		const cells = NS.flatMap((n) =>
			[
				[0, 0],
				[ITERS, 0],
				[0, 30],
			].map(([i, b]) => [n, i, b]),
		);
		const rows = await runCells(ROUNDS, cells, (c) =>
			p.evaluate(([n, i, b]) => window.M.realtime(n, i, b), c),
		);
		summarise(rows, (r) => `n=${String(r.n).padStart(4)} ${r.load}`, [
			["frameMs", 1],
			["clockRatio", 3],
			["underrunEvents", 0],
			["hasPlaybackStats"],
			["hasRenderCapacity"],
		]);
	} else if (mode === "clock") {
		await p.evaluate(() => window.M.initGL());
		const cells = [150, 300].flatMap((s) =>
			[
				["raf", 0],
				["lookahead", 0.1],
				["lookahead", 0.2],
			].map(([a, l]) => [a, l, s]),
		);
		const rows = await runCells(4, cells, ([a, l, s]) =>
			p.evaluate(
				([a, l, s, ph]) => window.M.clock(a, l, s, ph),
				[a, l, s, Math.round(rnd() * 100) / 100],
			),
		);
		summarise(rows, (r) => `stall ${r.stallMs} ${r.arm} ${r.lookaheadS}`, [
			["maxLateMs", 1],
			["lateBeats", 0],
			["stallAudioMs", 0],
		]);
	} else if (mode === "latency") {
		for (const row of await p.evaluate(() => window.M.latency())) out(row);
	} else if (mode === "unlock") {
		for (const act of ["none", "Escape", "Shift", "KeyA", "click"]) {
			const q = await newPage();
			await q.evaluate(() => {
				window.__ac = new AudioContext();
				window.__s0 = window.__ac.state;
				const resume = () => window.__ac.resume();
				addEventListener("keydown", resume);
				addEventListener("pointerdown", resume);
			});
			if (act === "click") await q.mouse.click(200, 200);
			else if (act !== "none") await q.keyboard.press(act);
			await q.waitForTimeout(400);
			out({
				act,
				...(await q.evaluate(() => ({
					before: window.__s0,
					after: window.__ac.state,
					hasBeenActive: navigator.userActivation?.hasBeenActive,
				}))),
			});
			await q.close();
		}
	} else if (mode === "gpucal") {
		await p.evaluate(() => window.M.initGL());
		for (const i of [0, 400, 800, 1600, 3200]) {
			await p.evaluate((i) => window.M.setLoad(i), i);
			out({
				iters: i,
				...(await p.evaluate(() => window.M.framePeriod(1500))),
			});
		}
	}
} finally {
	await browser.close();
	server.close();
}
