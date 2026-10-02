/**
 * The natural voice on each backend (2026-10-02): the same comms line in a
 * few voices, generated on WASM and on WebGPU with nothing kept, each twice,
 * and how rough each render is.
 *
 *   node scripts/fetch-voice-model.mjs          # once per machine
 *   npm run dev                                 # one shell
 *   SEELITE_PROBE_RENDERER=hardware PROBE_ORIGIN=http://127.0.0.1:5173 \
 *     node scripts/measure-voice-backends.mjs
 *   SEELITE_PROBE_RENDERER=hardware \
 *     node scripts/measure-voice-backends.mjs https://seelite.pages.dev --built
 *
 * The hardware renderer is not optional: the default software one offers no
 * `shader-f16`, and WebGPU there fails to build its first pipeline.
 *
 * **Manual**: it needs the model on the server and a browser with WebGPU and
 * `shader-f16`, so it does not gate `npm run probe`. It is the owner of the
 * figures behind `NeuralVoice.backend()` returning WASM: the principal heard
 * the game, on WebGPU, as distorted and the lab, on WASM, as clean, and this
 * is what the two backends' renders differ by.
 *
 * Per voice and run it prints:
 * - **hf**: the energy of the sample-to-sample difference over the signal's,
 *   which weighs a render's high band. A clean line is not zero; compare
 *   backends, not a figure against a threshold.
 * - **clicks**: steps between neighbours larger than 0.5, which speech at
 *   16 kHz and these peaks does not make.
 * - **repeat**: the correlation of a backend's two runs. 1.000 says a backend
 *   is deterministic, so one run per backend is a measurement and not a draw.
 *   The two backends' renders do not correlate with each other at all, which
 *   is a different model's phase and says nothing about quality.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	PROBE_WINDOW_VISIBLE,
	tally,
} from "./probe-guard.mjs";

const BUILT = process.argv.includes("--built");
const given =
	process.argv.slice(2).find((a) => !a.startsWith("--")) ??
	process.env.PROBE_ORIGIN ??
	"http://127.0.0.1:5173";
const origin = BUILT ? given.replace(/\/$/, "") : await guardedOrigin(given);
const VOICES = ["af_heart", "bf_emma", "bm_lewis"];

// Headed, as the diagnosis ran; the windowless launch was not tried on the
// hardware renderer.
const browser = await launchChromium({
	probeWindow: PROBE_WINDOW_VISIBLE,
	args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU"],
});
const { watch, exit } = tally();
try {
	const page = await browser.newPage();
	watch(page);
	await page.goto(gameUrl(origin, { raider: "off", voices: "off" }));
	await bootedGame(page, 60000);
	const r = await page.evaluate(async (voices) => {
		const g = window.__seelite;
		const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
		const text = g.voiceKit.lines.granted.text;
		const runs = {};
		for (const run of ["wasm", "wasm#2", "webgpu", "webgpu#2"]) {
			const ep = run.split("#")[0];
			g.neural.stop();
			const st = await g.neural.start(ep);
			if (st.kind !== "ready" || st.backend !== ep) {
				runs[run] = { state: st };
				continue;
			}
			runs[run] = { lines: {} };
			for (const v of voices) {
				// A fresh render, never a kept line: `line` reads only the
				// line store, never the memo; `keep = false` stores nothing;
				// and `?voices=off` turns off the preparation that would. So
				// a `repeat` of 1.000 is two renders, not one read twice.
				const x = await g.neural
					.line(text, v, 1, true, false)
					.catch((e) => String(e));
				runs[run].lines[v] = typeof x === "string" ? x : x && Array.from(x);
			}
		}
		g.neural.stop();
		return { f16: !!adapter?.features.has("shader-f16"), text, runs };
	}, VOICES);

	const rough = (x) => {
		let e = 0;
		let hf = 0;
		let clicks = 0;
		for (let i = 0; i < x.length; i++) {
			e += x[i] * x[i];
			if (i) {
				const d = x[i] - x[i - 1];
				hf += d * d;
				if (Math.abs(d) > 0.5) clicks++;
			}
		}
		return { hf: e ? hf / e : null, clicks };
	};
	const corr = (a, b) => {
		const n = Math.min(a.length, b.length);
		let ab = 0;
		let aa = 0;
		let bb = 0;
		for (let i = 0; i < n; i++) {
			ab += a[i] * b[i];
			aa += a[i] * a[i];
			bb += b[i] * b[i];
		}
		return aa && bb ? ab / Math.sqrt(aa * bb) : null;
	};
	console.log(`line: ${JSON.stringify(r.text)}; WebGPU shader-f16: ${r.f16}`);
	for (const [run, v] of Object.entries(r.runs))
		if (v.state) console.log(`${run}: not ready, ${JSON.stringify(v.state)}`);
	for (const voice of VOICES) {
		const cells = ["wasm", "webgpu"].map((ep) => {
			const a = r.runs[ep]?.lines?.[voice];
			const b = r.runs[`${ep}#2`]?.lines?.[voice];
			if (!a || typeof a === "string") return `${ep} — ${a ?? "no line"}`;
			const s = rough(a);
			const r = b && typeof b !== "string" ? corr(a, b) : null;
			const rep = r === null ? "—" : r.toFixed(3);
			const hf = s.hf === null ? "silent" : s.hf.toFixed(3);
			return `${ep} hf ${hf} clicks ${s.clicks} repeat ${rep}`;
		});
		console.log(`${voice.padEnd(9)} ${cells.join("  |  ")}`);
	}
} finally {
	await browser.close();
}
exit();
