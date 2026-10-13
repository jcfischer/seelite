/** Node #752: quality owns bloom; the perf switch is a live diagnostic. */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const context = await browser.newContext();
const t = tally();

try {
	const page = await context.newPage();
	t.watch(page);
	await page.goto(gameUrl(origin, { seed: 47 }));
	await bootedGame(page);
	t.check(
		"high boots with bloom enabled",
		await page.evaluate(() => {
			const g = window.__seelite;
			return g.settings.value.quality === "high" && g.bloom?.enabled === true;
		}),
	);

	for (const quality of ["low", "high", "low"]) {
		const state = await page.evaluate(async (quality) => {
			const g = window.__seelite;
			const frames = g.frames;
			g.settings.set("quality", quality);
			await new Promise(requestAnimationFrame);
			return { enabled: g.bloom?.enabled, advanced: g.frames > frames };
		}, quality);
		t.check(
			`switching to ${quality} applies bloom by the next frame`,
			state.advanced && state.enabled === (quality === "high"),
			JSON.stringify(state),
		);
	}

	// Mount the shipped diagnostic explicitly, without adding its query flag
	// or sending flight keys. Both the toggle and reset run its real gamepad action.
	const reset = await page.evaluate(async () => {
		const g = window.__seelite;
		const { mountPerfPanel, PERF_KEYS } = await import("/src/perf-panel.ts");
		const attribution = await g.enableFrameAttribution();
		const panel = mountPerfPanel({
			scenes: [g.nearScene, g.approachScene, g.farScene],
			bloom: g.bloom,
			bloomDefault: () => g.bloomDefault,
			attribution,
			occlusion: () => g.occlusionState,
			adaptive: () => g.adaptiveDiagnostics(),
		});
		if (!panel) throw new Error("diagnostic panel did not mount");
		try {
			panel.setFocused(true);
			panel.activate();
			await new Promise(requestAnimationFrame);
			const override = g.bloom.enabled;
			panel.moveCursor(PERF_KEYS.length);
			panel.activate();
			const low = g.bloom.enabled;
			// Quality is read at reset time, not snapshotted when mounted on Low.
			g.settings.set("quality", "high");
			panel.moveCursor(-PERF_KEYS.length);
			panel.activate();
			const highOverride = g.bloom.enabled;
			panel.moveCursor(PERF_KEYS.length);
			panel.activate();
			const high = g.bloom.enabled;
			g.settings.set("quality", "low");
			return { override, low, highOverride, high };
		} finally {
			panel.unmount();
			g.disableFrameAttribution();
		}
	});
	t.check("Low permits the live diagnostic override", reset.override === true);
	t.check("reset returns Low bloom to off", reset.low === false);
	t.check(
		"the diagnostic toggle turns High bloom off",
		reset.highOverride === false,
	);
	t.check("reset reads the current High row", reset.high === true);
	await page.close();

	// The writer above saved Low through the actual settings store. A new page
	// reads it without a switch repairing boot state. Hold only queued rAFs until
	// Game is published: its constructor still renders frame one synchronously.
	const reader = await context.newPage();
	t.watch(reader);
	await reader.addInitScript(() => {
		const raf = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (callback) => {
			const untilPublished = (time) => {
				if (!window.__seelite) return raf(untilPublished);
				callback(time);
			};
			return raf(untilPublished);
		};
		let game;
		Object.defineProperty(window, "__seelite", {
			configurable: true,
			get: () => game,
			set: (value) => {
				game = value;
				window.__bloomFirstFrame = {
					frames: value.frames,
					quality: value.settings.value.quality,
					enabled: value.bloom?.enabled,
				};
			},
		});
	});
	// No `interiors-full`, `shipyards-full` or `refineries-full` wait: the init
	// script above holds every frame until `__seelite` is published, and the
	// sliced installs yield on frames, so a boot that awaits one before
	// publishing never publishes (#843, #818, #819).
	await reader.goto(
		gameUrl(origin, {
			seed: 47,
			"interiors-full": false,
			"shipyards-full": false,
			"refineries-full": false,
		}),
	);
	await bootedGame(reader);
	const first = await reader.evaluate(() => window.__bloomFirstFrame);
	t.check(
		"saved Low disables bloom from frame one",
		first.frames === 1 && first.quality === "low" && first.enabled === false,
		JSON.stringify(first),
	);
} finally {
	await browser.close();
}
t.exit();
