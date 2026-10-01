/**
 * The natural voice (#604) in a real browser: the question at boot, the
 * fallback to the synthesised voice, and Kokoro speaking the game's lines.
 *
 *   node scripts/fetch-voice-model.mjs     # once: the model, into public/
 *   npm run probe:one probe-neural-voice
 *
 * **The second half needs the model on the dev server** and fails loudly
 * without it, naming the command above: a row that skipped would read
 * exactly like one that passed. The first half serves a made-up manifest
 * through a route and needs nothing.
 *
 * What each check is evidence for:
 *
 * - **the question comes before the menu and names the download** — the
 *   overlay's voice view under `?voices=ask`, its size from the manifest.
 * - **Not now by mouse, No by keyboard, Download by pad, Esc as Not now** —
 *   each answer is the settings row's: Ask, Synthesised, Natural, Ask.
 * - **a voice that cannot load leaves the synthesised voice speaking** —
 *   every part refused, the voice settles `failed` and a comms line still
 *   reaches the console bus.
 * - **the game speaks approach control in the natural voice** — the line
 *   handed to the bus is Kokoro's, not the formant voice's.
 * - **a line said again comes from the kept lines** — the second asking
 *   is a read, far faster than the first generation.
 * - **two lines asked at once both arrive** — the worker's queue.
 * - **the median frame holds while a line generates** — the worker keeps
 *   inference off the main thread; per backend. The p95 is printed and not
 *   gated: on WebGPU the model shares the GPU with the game, and #604
 *   measured the p95 at 16 ms idle and 58 ms generating on an M1 Pro.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);

/** A manifest with the same size on both backends, so the question's
 *  figure does not depend on which one this browser would pick. */
const FAKE = {
	version: "0000000000000000",
	revision: "probe",
	partBytes: 20971520,
	backends: {
		wasm: ["model-wasm", "ort-wasm"],
		webgpu: ["model-webgpu", "ort-webgpu"],
	},
	voices: ["bm_george"],
	files: Object.fromEntries(
		[
			["model-wasm", 50_000_000],
			["ort-wasm", 11_000_000],
			["model-webgpu", 50_000_000],
			["ort-webgpu", 11_000_000],
			["voice:bm_george", 522_240],
		].map(([id, bytes]) => [
			id,
			{ name: id, bytes, sha256: "0".repeat(64), parts: [`${id}.0.part`] },
		]),
	),
};
const FAKE_BYTES = 50_000_000 + 11_000_000 + 522_240;

const browser = await launchChromium();
const { check, watch, exit } = tally();
const contexts = [];
try {
	/**
	 * A fresh context with the fake manifest and every part refused, on the
	 * question: under `?voices=ask` on a direct boot, or on the player's own
	 * boot, `/?boot=overlay` as the site's Play link has it.
	 */
	const askPage = async ({ pad = false, playerBoot = false } = {}) => {
		const context = await browser.newContext();
		contexts.push(context);
		await context.route("**/voice-model/manifest.json", (r) =>
			r.fulfill({
				contentType: "application/json",
				body: JSON.stringify(FAKE),
			}),
		);
		await context.route("**/voice-model/*.part", (r) =>
			r.fulfill({ status: 404, body: "" }),
		);
		const page = await context.newPage();
		watch(page);
		if (pad) await page.addInitScript(installFakePad);
		const playerUrl = gameUrl(origin, { raider: "off" }, { boot: "overlay" });
		const askUrl = gameUrl(origin, { raider: "off", voices: "ask" });
		if (playerBoot) await page.goto(playerUrl);
		else await page.goto(askUrl);
		await bootedGame(page, 60000);
		await page.waitForSelector("[data-voice-question]", { timeout: 20000 });
		// The size arrives after the view: wait for the figure.
		await page.waitForFunction(
			() =>
				/\d MB/.test(
					document.querySelector('#seelite-commander [data-row="0"]')
						?.textContent ?? "",
				),
			null,
			{ timeout: 20000 },
		);
		return page;
	};
	const state = (page) =>
		page.evaluate(() => ({
			asking: document.querySelector("[data-voice-question]") !== null,
			open: document.querySelector("#seelite-commander") !== null,
			voice: window.__seelite.settings.value.voice,
			neural: window.__seelite.neural.state.kind,
		}));

	// ── The question, by mouse: Not now ────────────────────────────────────
	const mouse = await askPage();
	const label = await mouse.$eval(
		'#seelite-commander [data-row="0"]',
		(e) => e.textContent,
	);
	const want = await mouse.evaluate(
		async (b) => (await import("/src/commander-overlay.ts")).voiceSize(b),
		FAKE_BYTES,
	);
	check(
		"the question comes before the menu and names the download",
		label.includes(want),
		`row 0 "${label}", want ${want}`,
	);
	await mouse.click('#seelite-commander [data-row="1"]');
	const later = await state(mouse);
	check(
		"Not now, by mouse, goes to the menu and leaves the row at Ask",
		!later.asking && later.open && later.voice === "ask",
		JSON.stringify(later),
	);

	// ── By keyboard: No; and Esc ───────────────────────────────────────────
	const keys = await askPage();
	await keys.keyboard.press("ArrowDown");
	await keys.keyboard.press("ArrowDown");
	await keys.keyboard.press("Enter");
	const no = await state(keys);
	const esc = await askPage();
	await esc.keyboard.press("Escape");
	const escaped = await state(esc);
	check(
		"No, by keyboard, sets Synthesised; Esc is Not now",
		!no.asking &&
			no.voice === "formant" &&
			no.neural === "off" &&
			!escaped.asking &&
			escaped.voice === "ask",
		`No ${JSON.stringify(no)}; Esc ${JSON.stringify(escaped)}`,
	);

	// ── By pad: Download, against a server that refuses every part ─────────
	const padPage = await askPage({ pad: true });
	await padPage.evaluate(async (a) => {
		window.__pad.hold(a);
		await window.__frames(3);
		window.__pad.release(a);
		await window.__frames(3);
	}, STANDARD_INDEX.a);
	await padPage.waitForFunction(
		() => window.__seelite.neural.state.kind === "failed",
		null,
		{ timeout: 30000 },
	);
	const chosen = await state(padPage);
	const fallback = await padPage.evaluate(() => {
		const g = window.__seelite;
		const out = [];
		const speak = g.audio.speak.bind(g.audio);
		g.audio.speak = (x, rate, bus, space) => {
			out.push(bus ?? "console");
			return speak(x, rate, bus, space);
		};
		g.sayComms("granted");
		return { out, reason: g.neural.state.reason };
	});
	check(
		"Download, by pad, sets Natural; a voice that cannot load leaves the synthesised voice speaking",
		chosen.voice === "neural" &&
			chosen.neural === "failed" &&
			fallback.out.length === 1 &&
			fallback.out[0] === "console",
		`${JSON.stringify(chosen)}; ${fallback.reason}; said on ${fallback.out.join(", ") || "nothing"}`,
	);

	// ── The player's boot: the question, the menu, then a new game ────────
	const boot = await askPage({ playerBoot: true });
	const asked = await state(boot);
	await boot.keyboard.press("Escape");
	const menu = await boot.evaluate(
		() =>
			document.querySelector('#seelite-commander [data-kind="new-game"]') !==
			null,
	);
	// New game is the first cursor in a browser with no Commander; its form's
	// last row, five down from the name, starts it, and the page reloads.
	await boot.keyboard.press("Enter");
	await boot.waitForSelector('[data-field="name"]', { timeout: 10000 });
	for (let i = 0; i < 5; i++) await boot.keyboard.press("ArrowDown");
	const reloaded = boot.waitForEvent("load", { timeout: 30000 });
	await boot.keyboard.press("Enter");
	await reloaded;
	await bootedGame(boot, 60000);
	const flying = {
		...(await state(boot)),
		clockHeld: await boot.evaluate(() => window.__seelite.clockHeld),
	};
	check(
		"on the player's boot the question comes before the menu, and New game reaches flight without asking again",
		asked.asking &&
			menu &&
			!flying.asking &&
			!flying.open &&
			flying.voice === "ask" &&
			!flying.clockHeld,
		`first ${JSON.stringify(asked)}; menu after Esc ${menu}; after New game ${JSON.stringify(flying)}`,
	);

	// ── The model itself ───────────────────────────────────────────────────
	const res = await fetch(`${origin}/voice-model/manifest.json`);
	const served = (res.headers.get("content-type") ?? "").includes("json");
	check(
		"the dev server has the model",
		served,
		served
			? "manifest served"
			: "no /voice-model/manifest.json: run `node scripts/fetch-voice-model.mjs`",
	);
	if (served) {
		// ── The game speaks approach control in the natural voice ───────────
		// Every request either page makes, workers' included: the voice's
		// files come from this origin and nothing else (sage round 1 on #606).
		const requests = [];
		const recorded = async () => {
			const c = await browser.newContext();
			contexts.push(c);
			c.on("request", (q) => requests.push(q.url()));
			return c;
		};
		const context = await recorded();
		const game = await context.newPage();
		watch(game);
		await game.goto(gameUrl(origin, { raider: "off", voices: "neural" }));
		await bootedGame(game, 60000);
		await game.waitForFunction(
			() => ["ready", "failed"].includes(window.__seelite.neural.state.kind),
			null,
			{ timeout: 240000, polling: 500 },
		);
		const spoken = await game.evaluate(async () => {
			const g = window.__seelite;
			const { renderLine } = await import("/src/comms-voice.ts");
			const { COMMS_LINES } = await import("/src/comms.ts");
			const { NEURAL_ROLE } = await import("/src/neural-voice.ts");
			// Kept first: a line the cache lacks is said by the formant voice.
			await g.neural.line(COMMS_LINES.granted.text, NEURAL_ROLE.approach);
			const said = new Promise((res) => {
				const speak = g.audio.speak.bind(g.audio);
				g.audio.speak = (x, rate, bus, space) => {
					res({ n: x.length, bus: bus ?? "console" });
					return speak(x, rate, bus, space);
				};
			});
			g.sayComms("granted");
			return {
				state: g.neural.state,
				said: await said,
				formant: renderLine("granted").length,
			};
		});
		check(
			"the game speaks approach control in the natural voice",
			spoken.state.kind === "ready" &&
				spoken.said.bus === "console" &&
				spoken.said.n !== spoken.formant &&
				spoken.said.n > 8000,
			`${JSON.stringify(spoken.state)}; ${spoken.said.n} samples on ${spoken.said.bus}, the formant line ${spoken.formant}`,
		);

		// ── Kept lines, the queue and the cadence, per backend ──────────────
		// `nocomms`: no prewarm running behind the measurement. Its own
		// context, so its line cache starts empty.
		const bench = await (await recorded()).newPage();
		watch(bench);
		await bench.goto(
			gameUrl(origin, { raider: "off", voices: "neural,nocomms" }),
		);
		await bootedGame(bench, 60000);
		await bench.waitForFunction(
			() => ["ready", "failed"].includes(window.__seelite.neural.state.kind),
			null,
			{ timeout: 240000, polling: 500 },
		);
		// ── A line the cache lacks: the formant voice now, Kokoro next time ──
		const miss = await bench.evaluate(async () => {
			const g = window.__seelite;
			const cv = await import("/src/comms-voice.ts");
			const { COMMS_LINES } = await import("/src/comms.ts");
			const { NEURAL_ROLE } = await import("/src/neural-voice.ts");
			const said = [];
			const speak = g.audio.speak.bind(g.audio);
			g.audio.speak = (x, rate, bus, space) => {
				said.push(x.length);
				return speak(x, rate, bus, space);
			};
			const t0 = performance.now();
			await cv.sayLine(g.audio, "granted");
			const firstMs = performance.now() - t0;
			const text = COMMS_LINES.granted.text;
			const voice = NEURAL_ROLE.approach;
			for (let i = 0; i < 600 && !(await g.neural.kept(text, voice)); i++)
				await new Promise((r) => setTimeout(r, 100));
			await cv.sayLine(g.audio, "granted");
			g.audio.speak = speak;
			return {
				state: g.neural.state.kind,
				said,
				firstMs,
				formant: cv.renderLine("granted").length,
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
				const { COMMS_LINES } = await import("/src/comms.ts");
				const texts = Object.values(COMMS_LINES).map((l) => l.text);
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

		// ── Every request the voice made stayed on this origin ─────────────
		// Not vacuous: the parts are fetched by the worker, so a recorder
		// that could not see the worker would hold no part at all.
		const foreign = requests.filter((u) => !u.startsWith(`${origin}/`));
		const parts = requests.filter((u) => /\/voice-model\/.+\.part$/.test(u));
		check(
			"every request the voice made, its worker's included, stayed on this origin",
			foreign.length === 0 && parts.length > 0,
			`${requests.length} requests, ${parts.length} model parts; off-origin: ${foreign.slice(0, 3).join(", ") || "none"}`,
		);
	}
} finally {
	for (const context of contexts) await context.close().catch(() => {});
	await browser.close();
}
exit();
