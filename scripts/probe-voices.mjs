/**
 * The voices (#600) in a real browser: a comms line and the music's numbers,
 * rendered offline through the engine's buses, and the game saying them.
 *
 *   npm run probe:one probe-voices
 *
 * A probe can prove a line reaches the bus it names, that the bus row is its
 * only level, that the music's voice carries an echo, that a second line
 * waits for the first, and that the game speaks on its events. It cannot
 * prove a line is *intelligible*: that is `scripts/measure-speech-contrast.ts`
 * for the minimal pairs and the principal's ear for the rest.
 *
 * What each check is evidence for:
 *
 * - **a comms line sounds on the console bus, and the console row is its only
 *   level** — `AudioFX.speak` builds its source on the bus (#542 D1): the
 *   console row Off is silence, and the music row Off leaves it alone.
 * - **the numbers station sounds on the music bus, and its echo outlasts it**
 *   — the far-off voice's room, against a control that is the same line with
 *   no room, whose tail is silent; and the music row Off is silence.
 * - **a line asked while one speaks waits for it** — two lines asked at once
 *   last as long as both, not as long as one.
 * - **the game says approach control's answer, and `?voices=nocomms` does
 *   not** — the wiring in `main.ts`, read by a spy on `audio.speak` around a
 *   clearance request beside a station.
 * - **the game says the numbers on the music bus** — the director's phrase,
 *   once the synth is ready, reaches `audio.speak` on the music bus.
 */
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
const SR = 48000;

/** Render `script` offline through a fresh engine, and return the samples'
 *  rms over windows, s: `[from, to)`. Runs in the page. */
async function renderVoices({ sampleRate, seconds, levels, lines, windows }) {
	const { AudioFX } = await import("/src/audio.ts");
	const cv = await import("/src/comms-voice.ts");
	const { numbersPhrase } = await import("/src/comms.ts");
	const ctx = new OfflineAudioContext(
		2,
		Math.round(seconds * sampleRate),
		sampleRate,
	);
	const fx = new AudioFX();
	// Before the graph, as a row read at boot is: `attach` then sets each
	// bus at once, where `setLevel` on a live graph ramps over 30 ms and a
	// line starting at 0 leaks through the ramp.
	for (const [bus, step] of Object.entries(levels ?? {}))
		fx.setLevel(bus, step);
	fx.attach(ctx);
	const lens = [];
	for (const l of lines) {
		const samples =
			l.kind === "comms"
				? cv.renderLine(l.id)
				: cv.renderNumbers(numbersPhrase(1234, 0));
		lens.push(
			fx.speak(
				samples,
				cv.SPEECH_RATE,
				l.bus,
				l.space ? cv.MUSIC_VOICE_SPACE : undefined,
			),
		);
	}
	const buf = await ctx.startRendering();
	const L = buf.getChannelData(0);
	const R = buf.getChannelData(1);
	const rms = ([a, b]) => {
		let e = 0;
		const i0 = Math.round(a * sampleRate);
		const i1 = Math.min(L.length, Math.round(b * sampleRate));
		for (let i = i0; i < i1; i++) e += L[i] * L[i] + R[i] * R[i];
		return Math.sqrt(e / Math.max(1, 2 * (i1 - i0)));
	};
	let last = 0;
	for (let i = 0; i < L.length; i++)
		if (Math.abs(L[i]) > 1e-4 || Math.abs(R[i]) > 1e-4) last = i;
	return {
		lens,
		windows: windows.map((w) => (typeof w === "number" ? w : rms(w))),
		lastS: last / sampleRate,
	};
}

const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const page = await browser.newPage();
	watch(page);
	await page.goto(`${origin}/__seelite/tree`);
	const render = (opts) =>
		page.evaluate(renderVoices, { sampleRate: SR, ...opts });

	// ── A comms line on the console bus ─────────────────────────────────────
	const line = { kind: "comms", id: "granted", bus: "console" };
	const whole = [[0, 3]];
	const on = await render({ seconds: 4, lines: [line], windows: whole });
	const consoleOff = await render({
		seconds: 4,
		levels: { console: 0 },
		lines: [line],
		windows: whole,
	});
	const musicOff = await render({
		seconds: 4,
		levels: { music: 0 },
		lines: [line],
		windows: whole,
	});
	check(
		"a comms line sounds on the console bus, and the console row is its only level",
		on.windows[0] > 0.01 &&
			consoleOff.windows[0] < 1e-6 &&
			Math.abs(musicOff.windows[0] - on.windows[0]) < 0.05 * on.windows[0],
		`rms ${on.windows[0].toFixed(4)}; console Off ${consoleOff.windows[0].toExponential(2)}; music Off ${musicOff.windows[0].toFixed(4)}`,
	);

	// ── The numbers station on the music bus ────────────────────────────────
	const numbers = { kind: "numbers", bus: "music", space: true };
	const dry = { kind: "numbers", bus: "music", space: false };
	const probeLen = await render({ seconds: 1, lines: [dry], windows: [] });
	const len = probeLen.lens[0];
	const tail = [[len + 0.1, len + 1.1]];
	const far = await render({
		seconds: len + 2,
		lines: [numbers],
		windows: tail,
	});
	const near = await render({ seconds: len + 2, lines: [dry], windows: tail });
	const farOff = await render({
		seconds: len + 2,
		levels: { music: 0 },
		lines: [numbers],
		windows: [[0, len + 1.1]],
	});
	check(
		"the numbers station sounds on the music bus, and its echo outlasts it",
		far.windows[0] > 1e-3 && near.windows[0] < 1e-5 && farOff.windows[0] < 1e-6,
		`line ${len.toFixed(2)} s; tail rms with the echo ${far.windows[0].toFixed(4)}, without ${near.windows[0].toExponential(2)}; music Off ${farOff.windows[0].toExponential(2)}`,
	);

	// ── A line waits for the one speaking ───────────────────────────────────
	const one = await render({ seconds: 9, lines: [line], windows: [] });
	const two = await render({ seconds: 9, lines: [line, line], windows: [] });
	check(
		"a line asked while one speaks waits for it",
		Math.abs(two.lastS - one.lastS - one.lens[0]) < 0.05,
		`one ends at ${one.lastS.toFixed(3)} s, two at ${two.lastS.toFixed(3)} s; a line is ${one.lens[0].toFixed(3)} s`,
	);
	await page.close();

	// ── The game speaks on its events ───────────────────────────────────────
	const saysOnClearance = async (voices) => {
		const game = await browser.newPage();
		watch(game);
		await game.goto(
			gameUrl(origin, voices ? { raider: "off", voices } : { raider: "off" }),
		);
		await bootedGame(game, 60000);
		const said = await game.evaluate(() => {
			const g = window.__seelite;
			const out = [];
			const speak = g.audio.speak.bind(g.audio);
			g.audio.speak = (x, rate, bus, space) => {
				out.push(bus ?? "console");
				return speak(x, rate, bus, space);
			};
			const station = g.world.system.contents.stations[0];
			const id = station.id;
			const seen = g.dockingSnapshot(id);
			const body = g.world.system.byId.get(id);
			const vel = g.stationVelocity(id);
			const k = seen.planeKm + 3;
			g.world.ship.pos = {
				x: body.pos.x + seen.axis.x * k,
				y: body.pos.y + seen.axis.y * k,
				z: body.pos.z + seen.axis.z * k,
			};
			g.world.ship.vel = { x: vel.x, y: vel.y, z: vel.z };
			g.targetId = id;
			g.resetDock();
			const answer = g.requestDockingClearance();
			return { out, kind: answer?.state?.clearance?.kind ?? null };
		});
		await game.close();
		return said;
	};
	const spoken = await saysOnClearance(null);
	const quiet = await saysOnClearance("nocomms");
	check(
		"the game says approach control's answer, and ?voices=nocomms does not",
		spoken.kind !== null &&
			spoken.kind !== "none" &&
			spoken.out.length === 1 &&
			spoken.out[0] === "console" &&
			quiet.out.length === 0,
		`answer ${spoken.kind}; said on ${spoken.out.join(", ") || "nothing"}; nocomms said ${quiet.out.length}`,
	);

	// ── The game says the numbers on the music bus ──────────────────────────
	const game = await browser.newPage();
	watch(game);
	await game.goto(gameUrl(origin, { raider: "off", music: "calm" }));
	await bootedGame(game, 60000);
	// The synth loads on the gesture that opens the game's sound (#560 D8).
	// F8 is now the E.C.M. (node #874); an unbound key unlocks audio alone.
	await game.keyboard.press("F6");
	await game.waitForFunction(() => window.__seelite.music.ready, null, {
		timeout: 20000,
	});
	const music = await game.evaluate(async () => {
		const g = window.__seelite;
		const out = [];
		const speak = g.audio.speak.bind(g.audio);
		g.audio.speak = (x, rate, bus, space) => {
			out.push({ bus: bus ?? "console", space: !!space });
			return speak(x, rate, bus, space);
		};
		const { VOICE_FIRST_S } = await import("/src/music-director.ts");
		// Just short of the first phrase, so the next frames reach it.
		g.musicState = { ...g.musicState, voiceS: VOICE_FIRST_S - 0.05 };
		for (let i = 0; i < 30 && out.length === 0; i++)
			await new Promise((r) => requestAnimationFrame(() => r()));
		return out;
	});
	await game.close();
	check(
		"the game says the numbers on the music bus",
		music.length === 1 && music[0].bus === "music" && music[0].space,
		JSON.stringify(music),
	);
} finally {
	await browser.close();
}
exit();
