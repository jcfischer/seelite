/**
 * The natural voice's question and fallback (#604) in a real browser — the
 * half that needs no model, so it gates `npm run probe` on any checkout.
 *
 *   npm run probe:one probe-neural-voice
 *
 * It serves a made-up manifest through a route and refuses every part. The
 * voice itself — Kokoro speaking, the line cache, the frame while a line
 * generates, every request it makes — needs the 280 MiB model, and is
 * `scripts/measure-neural-voice.mjs`, run by hand (the principal's ruling,
 * D5 on #606).
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
 * - **on the player's boot the question comes before the menu** — and New
 *   game reaches flight without asking again.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installSpeakSpy, waitForVoiceSize } from "./lib/voice-probe.mjs";
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
/** What the question should quote: the fixture's own sizes, summed. */
const FAKE_BYTES = [
	...FAKE.backends.wasm,
	...FAKE.voices.map((v) => `voice:${v}`),
].reduce((n, id) => n + FAKE.files[id].bytes, 0);

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
		await context.addInitScript(installSpeakSpy);
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
		await waitForVoiceSize(page);
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
		const restore = window.__spySpeak((c) => out.push(c.bus));
		g.sayComms("granted");
		restore();
		return { out, reason: g.neural.state.reason };
	});
	check(
		"Download, by pad, sets Natural; a voice that cannot load leaves the synthesised voice speaking",
		chosen.voice === "neural" &&
			chosen.neural === "failed" &&
			// Failed on the refused part — so the worker loaded and fetched.
			// A worker that cannot even load also settles `failed`, and this
			// row passed one for a round.
			/HTTP 404/.test(fallback.reason ?? "") &&
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
} finally {
	for (const context of contexts) await context.close().catch(() => {});
	await browser.close();
}
exit();
