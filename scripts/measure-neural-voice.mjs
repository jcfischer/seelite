/**
 * The natural voice itself (#604), in a real browser: Kokoro speaking the
 * game's lines, the line cache, the worker's queue, the frame while a line
 * generates, and every request the voice makes.
 *
 *   node scripts/fetch-voice-model.mjs          # once per machine
 *   npm run dev                                 # one shell
 *   PROBE_ORIGIN=http://127.0.0.1:5173 node scripts/measure-neural-voice.mjs
 *
 *   npm run build && npx vite preview --port 4173   # the built game
 *   node scripts/measure-neural-voice.mjs http://127.0.0.1:4173 --built
 *
 * **Manual, by the principal's ruling (D5 on #606)**: it needs the 280 MiB
 * model on the server, so it does not gate `npm run probe`; the model-free
 * half — the question, the fallback, the player's boot — is
 * `probe-neural-voice.mjs`, which does. Run this before a change to the voice
 * ships, and against `--built` whenever the runtime or the build changes: a
 * dev server serves `node_modules` and a build does not, which is how the
 * WASM backend was broken in every build while every dev run passed.
 *
 * It turns the voice on the way a player does — `?voices=ask`, Download — so
 * it runs against a build, where `?voices=neural` is not honoured. `--built`
 * skips the tree guard, which only a dev server can answer.
 *
 * What each check is evidence for:
 *
 * - **the game speaks approach control in the natural voice** — the line
 *   handed to the bus is Kokoro's, not the formant voice's.
 * - **two stations answer in their own voices** — D3: a station's id picks
 *   its voice, and two stations drawn apart are heard apart.
 * - **a line the cache lacks is said at once by the formant voice** — and in
 *   Kokoro once kept.
 * - **a line said again comes from the kept lines**, **two lines at once both
 *   arrive**, **the median frame holds while a line generates** — per backend.
 *   The p95 is printed, not gated: on WebGPU the model shares the GPU with
 *   the game (D4, left as it is by the principal).
 * - **every request stayed on this origin, and no runtime binary was fetched
 *   outside the parts** — the worker's requests included.
 */
import { readFileSync } from "node:fs";
import { gameUrl } from "./lib/game-url.mjs";
import { installSpeakSpy, waitForVoiceSize } from "./lib/voice-probe.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const BUILT = process.argv.includes("--built");
const given =
	process.argv.slice(2).find((a) => !a.startsWith("--")) ??
	process.env.PROBE_ORIGIN ??
	"http://127.0.0.1:5173";
const origin = BUILT ? given.replace(/\/$/, "") : await guardedOrigin(given);

const manifest = await fetch(`${origin}/voice-model/manifest.json`);
if (!(manifest.headers.get("content-type") ?? "").includes("json")) {
	console.log(
		`no /voice-model/manifest.json on ${origin}: run \`node scripts/fetch-voice-model.mjs\` (and rebuild for --built)`,
	);
	process.exit(1);
}

const browser = await launchChromium();
const { check, watch, exit } = tally();
const contexts = [];
const requests = [];
try {
	/** A fresh context whose voice the player has just said yes to. */
	const voicedPage = async (voices) => {
		const context = await browser.newContext();
		contexts.push(context);
		await context.addInitScript(installSpeakSpy);
		context.on("request", (q) => requests.push(q.url()));
		const page = await context.newPage();
		watch(page);
		await page.goto(gameUrl(origin, { raider: "off", voices }));
		await bootedGame(page, 60000);
		await waitForVoiceSize(page);
		await page.click('#seelite-commander [data-row="0"]');
		await page.waitForFunction(
			() => ["ready", "failed"].includes(window.__seelite.neural.state.kind),
			null,
			{ timeout: 240000, polling: 500 },
		);
		return page;
	};

	// ── Approach control, and two stations in their own voices ─────────────
	const game = await voicedPage("ask");
	const spoken = await game.evaluate(async () => {
		const g = window.__seelite;
		const kit = g.voiceKit;
		const text = kit.lines.granted.text;
		/** Say a line and return what reached the bus. */
		const say = async (speaker) => {
			let restore = () => {};
			const said = new Promise((res) => {
				restore = window.__spySpeak(res);
			});
			g.sayComms("granted", speaker);
			const line = await said;
			restore();
			return line;
		};
		// Kept first: a line the cache lacks is said by the formant voice.
		// Urgent: the background preparation runs behind these on this page.
		await g.neural.line(text, kit.role.approach, 1, true);
		const approach = await say();
		// Two stations whose ids draw different voices.
		const a = "probe-station-a";
		let b = "probe-station-b";
		for (
			let i = 0;
			kit.speakerVoice("approach", b) === kit.speakerVoice("approach", a);
			i++
		)
			b = `probe-station-b${i}`;
		const voices = [
			kit.speakerVoice("approach", a),
			kit.speakerVoice("approach", b),
		];
		for (const v of voices) await g.neural.line(text, v, 1, true);
		const lines = [await say(a), await say(b)];
		return {
			state: g.neural.state,
			approach,
			formant: kit.renderLine("granted").length,
			voices,
			lines,
		};
	});
	check(
		"the game speaks approach control in the natural voice",
		spoken.state.kind === "ready" &&
			spoken.approach.bus === "console" &&
			spoken.approach.n !== spoken.formant &&
			spoken.approach.n > 8000,
		`${JSON.stringify(spoken.state)}; ${spoken.approach.n} samples on ${spoken.approach.bus}, the formant line ${spoken.formant}`,
	);
	check(
		"two stations answer in their own voices (D3)",
		spoken.voices[0] !== spoken.voices[1] &&
			spoken.lines.every((l) => l.n > 8000 && l.n !== spoken.formant) &&
			spoken.lines[0].n !== spoken.lines[1].n,
		`${spoken.voices.join(" and ")}: ${spoken.lines.map((l) => l.n).join(" and ")} samples`,
	);

	// ── The bench: its own context, no background preparation behind it ────
	const bench = await voicedPage("ask,nocomms");
	const miss = await bench.evaluate(async () => {
		const g = window.__seelite;
		const kit = g.voiceKit;
		const said = [];
		const restore = window.__spySpeak((c) => said.push(c.n));
		const t0 = performance.now();
		await kit.sayLine(g.audio, "granted");
		const firstMs = performance.now() - t0;
		const text = kit.lines.granted.text;
		for (
			let i = 0;
			i < 600 && !(await g.neural.kept(text, kit.role.approach));
			i++
		)
			await new Promise((r) => setTimeout(r, 100));
		await kit.sayLine(g.audio, "granted");
		restore();
		return {
			state: g.neural.state.kind,
			said,
			firstMs,
			formant: kit.renderLine("granted").length,
		};
	});
	check(
		"a comms line the cache lacks is said at once by the formant voice, and in Kokoro once kept",
		miss.state === "ready" &&
			miss.said.length === 2 &&
			miss.said[0] === miss.formant &&
			miss.firstMs < 250 &&
			miss.said[1] !== miss.formant &&
			miss.said[1] > 8000,
		`said ${miss.said.join(" then ")} samples (the formant line ${miss.formant}); the first after ${miss.firstMs.toFixed(0)} ms`,
	);

	const first = await bench.evaluate(
		() => window.__seelite.neural.state.backend,
	);
	const backends = first === "webgpu" ? ["webgpu", "wasm"] : [first];
	for (const backend of backends) {
		const r = await bench.evaluate(async (backend) => {
			const g = window.__seelite;
			if (g.neural.state.backend !== backend) {
				g.neural.stop();
				await g.neural.start(backend);
			}
			if (g.neural.state.kind !== "ready") return { state: g.neural.state };
			const texts = Object.values(g.voiceKit.lines).map((l) => l.text);
			const long = texts.join(" ");
			// A speed no other row uses, so nothing is kept from before.
			const speed = 0.93 + Math.random() * 0.01;
			const frames = (until) =>
				new Promise((res) => {
					const dt = [];
					let last = performance.now();
					const tick = (t) => {
						dt.push(t - last);
						last = t;
						if (until()) res(dt);
						else requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				});
			const stats = (dt) => {
				const s = [...dt].sort((a, b) => a - b);
				const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
				return { n: s.length, median: q(0.5), p95: q(0.95) };
			};
			const t0 = performance.now();
			const idle = stats(await frames(() => performance.now() - t0 > 2000));
			let done = false;
			const g0 = performance.now();
			const line = g.neural.line(long, "bm_george", speed).finally(() => {
				done = true;
			});
			const busy = stats(await frames(() => done));
			const samples = await line;
			const genMs = performance.now() - g0;
			const k0 = performance.now();
			const again = await g.neural.line(long, "bm_george", speed);
			const keptMs = performance.now() - k0;
			const pair = await Promise.all([
				g.neural.line(texts[0], "af_bella", speed, true),
				g.neural.line(texts[1], "am_michael", speed),
			]);
			return {
				state: g.neural.state,
				seconds: (samples?.length ?? 0) / 16000,
				genMs,
				keptMs,
				same: again?.length === samples?.length,
				pair: pair.map((p) => p?.length ?? 0),
				idle,
				busy,
			};
		}, backend);
		if (r.state.kind !== "ready") {
			check(`${backend}: the voice is ready`, false, JSON.stringify(r.state));
			continue;
		}
		check(
			`${backend}: a line said again comes from the kept lines`,
			r.same && r.keptMs < r.genMs / 5,
			`${r.seconds.toFixed(1)} s of speech generated in ${r.genMs.toFixed(0)} ms, read back in ${r.keptMs.toFixed(0)} ms`,
		);
		check(
			`${backend}: two lines asked at once both arrive`,
			r.pair.every((n) => n > 8000),
			`${r.pair.join(", ")} samples`,
		);
		check(
			`${backend}: the median frame holds while a line generates`,
			r.busy.median <= r.idle.median * 1.25 + 1,
			`idle median ${r.idle.median.toFixed(1)} ms p95 ${r.idle.p95.toFixed(1)} (${r.idle.n}); generating median ${r.busy.median.toFixed(1)} p95 ${r.busy.p95.toFixed(1)} (${r.busy.n})`,
		);
	}

	// ── Every request the voice made stayed on this origin ─────────────────
	// Not vacuous: the parts are fetched by the worker, so a recorder that
	// could not see the worker would hold no part at all.
	// The visit counter (#569) is the page's one allowed request off this
	// origin, and a build loads it; it is not the voice's. Read from its
	// module rather than restated, so a moved counter is not a red run here.
	const counter = /COUNTER_ORIGIN =\s*"([^"]+)"/.exec(
		readFileSync(new URL("../src/visit-count.ts", import.meta.url), "utf8"),
	)?.[1];
	if (!counter) throw new Error("no COUNTER_ORIGIN in src/visit-count.ts");
	const foreign = requests.filter(
		(u) => !u.startsWith(`${origin}/`) && !u.startsWith(`${counter}/`),
	);
	// And the runtime fetched no binary of its own: every `.wasm` came through
	// the parts. Its JavaScript, the WASM loader included, is a module of the
	// game like any other.
	const ownWasm = requests.filter(
		(u) => /\.wasm(\?|$)/.test(u) && !u.includes("/voice-model/"),
	);
	const parts = requests.filter((u) => /\/voice-model\/.+\.part$/.test(u));
	check(
		"every request the voice made, its worker's included, stayed on this origin, and no runtime binary was fetched outside the parts",
		foreign.length === 0 && ownWasm.length === 0 && parts.length > 0,
		`${requests.length} requests, ${parts.length} model parts; off-origin: ${foreign.slice(0, 3).join(", ") || "none"}; a runtime .wasm of its own: ${ownWasm.slice(0, 3).join(", ") || "none"}`,
	);
} finally {
	for (const context of contexts) await context.close().catch(() => {});
	await browser.close();
}
exit();
