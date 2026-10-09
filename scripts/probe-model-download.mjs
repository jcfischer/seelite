/**
 * The Commander overlay during the model download (#833), on a running page.
 *
 *   npm run probe:one probe-model-download
 *
 * Every `.glb` response is held back by `page.route` until the probe lets it
 * go, so each row reads the page while the models are still "downloading".
 * A route holds a whole body and cannot stream part of one, so the share in
 * between is `tests/model-progress.test.ts`'s; here the bar is read as a
 * trace of its values, from a `MutationObserver` installed before the page.
 *
 * What each check is evidence for:
 *
 * 1. **A player boot opens the overlay before the models are in** — the menu
 *    and its progress bar are drawn while no `Game` exists.
 * 2. **A Continue chosen then waits, and survives a failed download.** One
 *    held model is refused and the other is let through after it, so a model
 *    still downloading when another failed is in the run (sage round 1 on
 *    #840: its progress once drew over the Retry and the boot hung). The
 *    overlay keeps offering Retry, `R` retries, and the Continue is carried
 *    out on the one `Game` once the models arrive.
 * 3. **The bar reads 100% before it is removed**, and the line says "Building
 *    the world" — painted, read by a frame callback — before the `Game`
 *    build blocks the page; a direct boot paints it on the panel too.
 * 4. **New game chosen during the download reloads only once the models are
 *    in**, and boots into the new Commander.
 * 5. **A direct boot keeps the full-screen panel**, with the progress bar in
 *    place of its static text, and no overlay.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const SEED = 42;
const PLAYER_URL = gameUrl(
	ORIGIN,
	{ seed: SEED, voices: "formant", raider: "off" },
	{ boot: null },
);
const DIRECT_URL = gameUrl(ORIGIN, {
	seed: SEED,
	voices: "formant",
	raider: "off",
});

const browser = await launchChromium();
const { check, watch, exit } = tally();

/**
 * The bar's value on every change: a number, "indeterminate" or "absent";
 * the loading line's state (`data-model-load`) on every change; and that
 * state as each frame callback finds it. A frame callback runs before its
 * frame is painted, so a state in `__paintedKinds` reached the screen — the
 * "Building the world" line is set and then the `Game` build blocks the
 * page, and only a paint between the two shows it (#833).
 */
function traceLoadBar() {
	window.__loadTrace = [];
	window.__loadKinds = [];
	window.__paintedKinds = [];
	const kindNow = () =>
		document
			.querySelector("[data-model-load]")
			?.getAttribute("data-model-load") ?? "absent";
	const frame = () => {
		const k = window.__paintedKinds;
		const kind = kindNow();
		if (k[k.length - 1] !== kind) k.push(kind);
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
	const read = () => {
		const bar = document.querySelector("[data-model-load] progress");
		if (!bar) return "absent";
		if (!bar.hasAttribute("value")) return "indeterminate";
		return Number(bar.getAttribute("value"));
	};
	new MutationObserver(() => {
		const v = read();
		const t = window.__loadTrace;
		if (t[t.length - 1] !== v) t.push(v);
		const kind = kindNow();
		const k = window.__loadKinds;
		if (k[k.length - 1] !== kind) k.push(kind);
	}).observe(document, { subtree: true, childList: true, attributes: true });
}

/**
 * Holds every model response until `release`, after which models pass at
 * once. `refuseOne` aborts the first held response and `letRest` lets the
 * others through while still holding what comes next, so a retry is held
 * again until released.
 */
const holdModels = async (page) => {
	const held = [];
	let passing = false;
	await page.route(
		(url) => new URL(url).pathname.endsWith(".glb"),
		(route) => {
			if (passing) return route.continue();
			held.push(route);
		},
	);
	const letRest = async () => {
		for (const r of held.splice(0)) await r.continue();
	};
	return {
		count: () => held.length,
		release: async () => {
			passing = true;
			await letRest();
		},
		refuseOne: async () => {
			await held.shift()?.abort("failed");
		},
		letRest,
	};
};

const waitFor = (page, predicate, arg, timeout = 15000) =>
	page
		.waitForFunction(predicate, arg, { timeout })
		.then(() => true)
		.catch(() => false);

const overlayState = (page) =>
	page.evaluate(() => {
		const box = document.querySelector("#seelite-commander .box");
		const load = document.querySelector("[data-model-load]");
		const selected = document.querySelector(
			'#seelite-commander .row[aria-selected="true"]',
		);
		return {
			game: window.__seelite !== undefined,
			overlay: box !== null,
			busy: box?.getAttribute("aria-busy") ?? null,
			load: load?.getAttribute("data-model-load") ?? null,
			bar:
				document.querySelector(
					"#seelite-commander [data-model-load] progress",
				) !== null,
			retry: document.querySelector("[data-model-retry]") !== null,
			selected: selected?.getAttribute("data-kind") ?? null,
		};
	});

const contexts = [];
try {
	const context = await browser.newContext({
		viewport: { width: 1100, height: 760 },
	});
	contexts.push(context);

	// A Commander to continue: a direct boot attaches the default one, and the
	// quit flush writes its record.
	{
		const page = await context.newPage();
		watch(page);
		await page.goto(DIRECT_URL);
		await bootedGame(page);
		const saved = await page.evaluate(async () => {
			const g = window.__seelite;
			g.saveFlush("quit");
			for (let i = 0; i < 100; i++) {
				if ((await g.save.backend.read(g.save.defaultSlot, "live")) !== null)
					return g.save.defaultSlot;
				await new Promise((r) => setTimeout(r, 100));
			}
			return null;
		});
		check(
			"a direct boot writes a Commander to continue",
			saved !== null,
			String(saved),
		);
		await page.close();
	}

	// -----------------------------------------------------------------------
	// 1–3. The overlay during the download; Continue across a failed one
	// -----------------------------------------------------------------------
	{
		const page = await context.newPage();
		watch(page);
		await page.addInitScript(traceLoadBar);
		const models = await holdModels(page);
		await page.goto(PLAYER_URL);
		const drawn = await waitFor(page, () =>
			document.querySelector("#seelite-commander [data-model-load] progress"),
		);
		let s = await overlayState(page);
		check(
			"a player boot draws the Commander overlay and its progress bar before the models are in",
			drawn && s.overlay && s.bar && !s.game && models.count() > 0,
			JSON.stringify({ ...s, held: models.count() }),
		);
		check(
			"the full-screen loading panel is gone while the overlay shows the download",
			(await page.$('section[aria-label="Loading game"]')) === null,
		);
		check(
			"Continue is offered and chosen first",
			s.selected === "continue",
			JSON.stringify(s),
		);
		await page.keyboard.press("Enter");
		await page.waitForTimeout(500);
		s = await overlayState(page);
		check(
			"Continue chosen during the download waits, the overlay busy and the bar still drawn",
			s.overlay && s.busy === "true" && s.bar && !s.game,
			JSON.stringify(s),
		);
		const heldFirst = models.count();
		await models.refuseOne();
		const failed = await waitFor(page, () =>
			document.querySelector("[data-model-retry]"),
		);
		// The other model arrives after the failure, with its progress events.
		await models.letRest();
		await page.waitForTimeout(1500);
		s = await overlayState(page);
		check(
			"one model refused while another arrives: Retry stays in the overlay, and the Continue still waits",
			heldFirst >= 2 && failed && s.retry && s.busy === "true" && !s.game,
			JSON.stringify({ ...s, heldFirst }),
		);
		await page.keyboard.press("r");
		const retried = await waitFor(page, () =>
			document.querySelector('[data-model-load="loading"]'),
		);
		await page.waitForTimeout(300);
		const heldAgain = models.count();
		await models.release();
		const continued = await waitFor(
			page,
			() => {
				const c = window.__seelite?.commanderBoot;
				return (
					c && c.attached() !== null && !c.overlay.isOpen() && !c.clockHeld()
				);
			},
			undefined,
			30000,
		);
		check(
			"R retries, and once the models arrive the Continue is carried out",
			retried && heldAgain > 0 && continued,
			JSON.stringify({ retried, heldAgain, continued }),
		);
		const trace = await page.evaluate(() => window.__loadTrace);
		const numbers = trace.filter((v) => typeof v === "number");
		check(
			"the bar reads 100% before it is removed",
			trace[trace.length - 1] === "absent" &&
				trace[trace.length - 2] === 1 &&
				numbers.includes(1),
			JSON.stringify(trace),
		);
		const kinds = await page.evaluate(() => ({
			set: window.__loadKinds,
			painted: window.__paintedKinds,
		}));
		check(
			"after the download the overlay shows Building the world, painted before the build",
			kinds.set.at(-2) === "building" &&
				kinds.set.at(-1) === "absent" &&
				kinds.painted.includes("building"),
			JSON.stringify(kinds),
		);
		await page.close();
	}

	// -----------------------------------------------------------------------
	// 4. New game during the download reloads once the models are in
	// -----------------------------------------------------------------------
	{
		const page = await context.newPage();
		watch(page);
		const models = await holdModels(page);
		await page.goto(PLAYER_URL);
		await waitFor(page, () =>
			document.querySelector('#seelite-commander [data-kind="new-game"]'),
		);
		await page.click('#seelite-commander [data-kind="new-game"]');
		await page.fill('[data-field="name"]', "Probe Download");
		for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
		let loads = 0;
		page.on("load", () => {
			loads += 1;
		});
		await page.keyboard.press("Enter");
		await page.waitForTimeout(1000);
		const s = await overlayState(page);
		check(
			"New game chosen during the download does not reload before the models are in",
			loads === 0 && s.overlay && s.busy === "true" && !s.game,
			JSON.stringify({ ...s, loads }),
		);
		const reload = page.waitForEvent("load", { timeout: 30000 });
		await models.release();
		await reload;
		await bootedGame(page, 30000);
		const attached = await page.evaluate(() =>
			window.__seelite.commanderBoot.attached(),
		);
		check(
			"then reloads into the new Commander",
			attached === "Probe Download",
			String(attached),
		);
		await page.close();
	}

	// -----------------------------------------------------------------------
	// 5. A direct boot: the panel, with the bar
	// -----------------------------------------------------------------------
	{
		const page = await context.newPage();
		watch(page);
		await page.addInitScript(traceLoadBar);
		const models = await holdModels(page);
		await page.goto(DIRECT_URL);
		const panel = await waitFor(page, () =>
			document.querySelector('section[aria-label="Loading game"] progress'),
		);
		const overlay = (await page.$("#seelite-commander")) !== null;
		check(
			"a direct boot shows the loading panel with its progress bar, and no overlay",
			panel && !overlay,
			JSON.stringify({ panel, overlay }),
		);
		await models.release();
		await bootedGame(page, 30000);
		check(
			"and boots once the models are in, the panel removed",
			(await page.$('section[aria-label="Loading game"]')) === null,
		);
		const painted = await page.evaluate(() => window.__paintedKinds);
		check(
			"the panel shows Building the world, painted before the build",
			painted.includes("building"),
			JSON.stringify(painted),
		);
		await page.close();
	}
} finally {
	for (const c of contexts) await c.close().catch(() => {});
	await browser.close();
}
exit();
