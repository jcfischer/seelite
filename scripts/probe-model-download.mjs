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
 * 6. **The courier downloads after boot (#831).** A held hull leaves the
 *    player and real Traffic couriers procedural; release replaces each
 *    once, while refusal warns once and never draws Retry.
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
	"interiors-full": false,
	"shipyards-full": false,
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
	const pushChanged = (list, v) => {
		if (list.at(-1) !== v) list.push(v);
	};
	const frame = () => {
		pushChanged(window.__paintedKinds, kindNow());
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
	// The bar's value under the line's state: `loading:1` is the download's
	// own 100%, which the building line's full bar (`building:1`) cannot
	// stand in for (sage round 3 on #840).
	const read = () => {
		const bar = document.querySelector("[data-model-load] progress");
		if (!bar) return "absent";
		const value = bar.hasAttribute("value")
			? Number(bar.getAttribute("value"))
			: "indeterminate";
		return `${kindNow()}:${value}`;
	};
	new MutationObserver(() => {
		pushChanged(window.__loadTrace, read());
		pushChanged(window.__loadKinds, kindNow());
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
		const full = trace.lastIndexOf("loading:1");
		const building = trace.indexOf("building:1");
		check(
			"the download's own bar reads 100% before the building line, and both go",
			full >= 0 &&
				building > full &&
				trace.at(-1) === "absent" &&
				!trace.slice(full + 1, building).some((v) => v.startsWith("loading:")),
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
	// 6. One after-boot hull is held: play starts before it succeeds or fails.
	// The courier (#831) and the tug (node #814) each, alone.
	// -----------------------------------------------------------------------
	const AFTER_BOOT = [
		{
			id: "courier",
			file: /courier-hull[^/]*\.glb/,
			frame: "courier-hull-frame",
			loft: "Kestrel",
		},
		{
			id: "tug",
			file: /bollard-tug[^/]*\.glb/,
			frame: "tug-hull-frame",
			loft: "tug loft",
		},
	];
	for (const hull of AFTER_BOOT)
		for (const outcome of ["release", "refuse"]) {
			const page = await context.newPage();
			watch(page);
			let held;
			const hullRequest = page.waitForRequest(hull.file, {
				timeout: 60000,
			});
			let requested = 0;
			const warnings = [];
			page.on("console", (message) => {
				if (
					message.type() === "warning" &&
					message.text().startsWith(`${hull.id} hull:`)
				)
					warnings.push(message.text());
			});
			await page.route(hull.file, (route) => {
				requested++;
				held = route;
			});
			await page.goto(
				gameUrl(ORIGIN, {
					seed: SEED,
					"no-save": true,
					voices: "formant",
					raider: "off",
				}),
			);
			await bootedGame(page, 30000);
			await hullRequest;
			const before = await page.evaluate((id) => {
				const g = window.__seelite;
				g.clockHeld = true;
				// Materialise the real cold roster at one of the hull's home stations.
				const actor = g.trafficActors.find((a) => a.hullId === id);
				if (!actor)
					throw new Error(`probe-model-download: fixture has no ${id}`);
				const station = g.world.system.bodies.find(
					(b) => b.id === actor.homeStationId,
				);
				g.world.ship.pos = { ...station.pos };
				g.render(0);
				const traffic = [...g.trafficMeshes.values()].filter(
					(m) => m.userData.hullId === id,
				);
				// The player flies the courier; the tug is Traffic only.
				window.__standIns = [
					...(g.shipMesh.userData.hullId === id ? [g.shipMesh] : []),
					...traffic,
				];
				window.__oldChildren = window.__standIns.map((m) => [...m.children]);
				return {
					traffic: traffic.length,
					procedural: window.__standIns.every((m) => !m.userData.authored),
					retry: !!document.querySelector("[data-model-retry]"),
				};
			}, hull.id);
			check(
				`held ${hull.id}: Game and Traffic build without awaiting the hull (${outcome})`,
				requested === 1 &&
					!!held &&
					before.traffic > 0 &&
					before.procedural &&
					!before.retry,
				JSON.stringify({ requested, ...before }),
			);
			if (!held)
				throw new Error(
					`probe-model-download: ${hull.id} request was not held`,
				);
			if (outcome === "release") {
				await held.continue();
				await page.waitForFunction(
					() => window.__standIns.every((m) => m.userData.authored),
					undefined,
					{ timeout: 30000 },
				);
				const once = await page.evaluate(async (frame) => {
					const g = window.__seelite;
					const roots = window.__standIns;
					const frames = roots.map((m) => m.getObjectByName(frame));
					await g.loadAuthoredHullsAfterBoot();
					return roots.every(
						(m, i) =>
							frames[i] &&
							m.getObjectByName(frame) === frames[i] &&
							window.__oldChildren[i].every((child) => child.parent === null),
					);
				}, hull.frame);
				check(
					`${hull.id} install replaces every existing ${hull.id} once and removes the ${hull.loft}`,
					once,
				);
			} else {
				await held.abort("failed");
				await page.evaluate(async () => {
					await window.__seelite.loadAuthoredHullsAfterBoot();
					await window.__seelite.loadAuthoredHullsAfterBoot();
				});
				const after = await page.evaluate(() => ({
					procedural: window.__standIns.every((m) => !m.userData.authored),
					retry: !!document.querySelector("[data-model-retry]"),
				}));
				check(
					`failed background ${hull.id} keeps every stand-in, warns once, and shows no Retry`,
					after.procedural &&
						!after.retry &&
						warnings.length === 1 &&
						requested === 1,
					JSON.stringify({ ...after, warnings, requested }),
				);
				const time = await page.evaluate(() => {
					const g = window.__seelite;
					g.resetFlightToStart();
					g.clockHeld = false;
					return g.world.gameTime;
				});
				check(
					`play keeps stepping after the ${hull.id} download fails`,
					await waitFor(page, (t) => window.__seelite.world.gameTime > t, time),
				);
			}
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
