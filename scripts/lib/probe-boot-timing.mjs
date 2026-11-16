import { performance } from "node:perf_hooks";

/** Count navigation-to-ready spans, including a death's awaited reload. */
export function bootTimings(now = () => performance.now()) {
	const pending = new WeakMap();
	const rows = [];
	return {
		rows,
		observe(browser) {
			const seen = new WeakSet();
			const observePage = (page) => {
				if (seen.has(page)) return;
				seen.add(page);
				let previousUrl = page.url();
				let routeReturn = false;
				page.on("framenavigated", (frame) => {
					if (frame !== page.mainFrame()) return;
					const currentUrl = frame.url();
					if (
						previousUrl.includes("model-viewer=") &&
						!currentUrl.includes("model-viewer=")
					) {
						pending.set(page, now());
						routeReturn = true;
					}
					previousUrl = currentUrl;
				});
				const close = page.close.bind(page);
				page.close = (...args) => {
					if (routeReturn && pending.has(page)) {
						rows.push({
							seconds: (now() - pending.get(page)) / 1000,
							url: page.url(),
							end: "close-after-route-return",
						});
						pending.delete(page);
					}
					return close(...args);
				};
				const goto = page.goto.bind(page);
				page.goto = (...args) => {
					pending.set(page, now());
					return goto(...args);
				};
				const wait = page.waitForEvent.bind(page);
				page.waitForEvent = (event, ...args) => {
					if (event === "load") pending.set(page, now());
					return wait(event, ...args);
				};
			};
			const open = browser.newPage.bind(browser);
			browser.newPage = async (...options) => {
				const page = await open(...options);
				observePage(page);
				page.context().on("page", observePage);
				return page;
			};
			if (browser.newContext) {
				const openContext = browser.newContext.bind(browser);
				browser.newContext = async (...options) => {
					const context = await openContext(...options);
					context.on("page", observePage);
					return context;
				};
			}
			return browser;
		},
		async ready(fn, page, ...args) {
			const since = pending.get(page) ?? now();
			const result = await fn(page, ...args);
			rows.push({ seconds: (now() - since) / 1000, url: page.url() });
			pending.delete(page);
			return result;
		},
	};
}

/** Instrument the guard in memory; refuse drift in either measured export. */
export function instrumentGuard(source) {
	const launch = "launchChromium";
	for (const name of [launch, "bootedGame"]) {
		const declaration = `export async function ${name}(`;
		if (source.split(declaration).length !== 2)
			throw new Error(`boot timing: unrecognised guard export ${name}`);
		source = source.replace(
			declaration,
			`async function original${name[0].toUpperCase()}${name.slice(1)}(`,
		);
	}
	return `${source}
export async function ${launch}(...args) {
	return globalThis.__bootTiming.observe(await original${launch[0].toUpperCase()}${launch.slice(1)}(...args));
}

export async function bootedGame(...args) {
	return globalThis.__bootTiming.ready(originalBootedGame, ...args);
}
`;
}

/** Refuse invalid timings rather than printing a plausible receipt. */
export function bootTimingReceipt(probe, totalSeconds, rows) {
	if (
		!Number.isFinite(totalSeconds) ||
		totalSeconds <= 0 ||
		rows.some((row) => !Number.isFinite(row.seconds) || row.seconds < 0)
	)
		throw new Error("boot timing: non-finite or negative duration");
	const bootSeconds = rows.reduce((sum, row) => sum + row.seconds, 0);
	if (!Number.isFinite(bootSeconds) || bootSeconds > totalSeconds)
		throw new Error("boot timing: boot spans exceed total duration");
	return { probe, totalSeconds, bootSeconds, boots: rows.length, rows };
}

if (
	process.env.PROBE_BOOT_TIMING === "1" &&
	/\/probe-(boot|death|docking|binding-store)\.mjs$/.test(process.argv[1] ?? "")
) {
	const { registerHooks } = await import("node:module");
	const started = performance.now();
	const timing = bootTimings();
	globalThis.__bootTiming = timing;
	registerHooks({
		load(url, context, next) {
			const result = next(url, context);
			return url.endsWith("/scripts/probe-guard.mjs")
				? { ...result, source: instrumentGuard(String(result.source)) }
				: result;
		},
	});
	process.on("exit", () => {
		console.log(
			`BOOT_TIMING ${JSON.stringify(
				bootTimingReceipt(
					process.argv[1],
					(performance.now() - started) / 1000,
					timing.rows,
				),
			)}`,
		);
	});
}
