/** Node 343. Normal Game + cockpit, with explicitly simulated relay facts.
 * Dock setup uses the project's shared canonical berth fixture; no relay is
 * placed or learned. Mouse, real KeyboardEvents, and fake W3C device exercise
 * the public cockpit click/focus dispatch. HEADed=1 captures the same flow.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
	guardedOrigin,
	launchChromium,
	bootedGame,
	installViewPlacement,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { installFakePad, STANDARD_INDEX as B } from "./lib/fake-pad.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5343";
const out = process.env.REQUESTS_EVIDENCE ?? "/tmp/seelite-343-evidence";
const headed = process.env.HEADED === "1";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
// Only for the shader listener: this probe keeps its own throwing `check` and
// `pageerror` handler, which is a reporting choice worth keeping, and takes
// the one thing `tally()` adds that they do not — a shader that fails to link
// is a `console.error`, not a page error, so nothing here would have seen it.
// The listener only counts; `check` below is what turns that count into a
// failure, so pass/fail is still decided in one place.
const t = tally();
const checks = [];
const check = (name, ok, detail = "") => {
	checks.push({ name, ok: !!ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
	if (!ok) throw new Error(name);
};
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watchShaders(page, "requests");
	page.on("pageerror", (e) => {
		throw e;
	});
	await page.addInitScript(installFakePad);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: 42, "requests-prototype": true }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	console.log("BOOTED");
	// Read-only snapshot: the probe never writes to the normal catalog.
	const normalBefore = await page.evaluate(async () => {
		const { indexedDbSaveBackend } = await import("/src/save-store.ts");
		const normal = indexedDbSaveBackend();
		const slots = await normal.slots();
		return JSON.stringify(
			await Promise.all(
				slots.map(async (slot) => [
					slot,
					await normal.read(slot, "live"),
					await normal.read(slot, "lastDocked"),
				]),
			),
		);
	});
	const station = await page.evaluate(async () => {
		const g = window.__seelite;
		const id =
			g.world.system.bodies.find(
				(b) => b.kind === "station" && b.stationType === "trade",
			)?.id ?? g.world.system.bodies.find((b) => b.kind === "station")?.id;
		if (!id) throw Error("no station");
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
		return id;
	});
	check(
		"normal docked Game has Requests beside Market and Equipment",
		await page.locator('[data-live-station-tab="Requests"]').isVisible(),
	);
	await page.screenshot({ path: `${out}/00-before-market.png` });
	await page.keyboard.down("ArrowUp");
	await page.locator('[data-live-station-tab="Requests"]').click();
	await page.keyboard.up("ArrowUp");
	check(
		"Requests key release clears a flight key held before opening",
		await page.evaluate(() => !window.__seelite.keys.has("arrowup")),
	);
	check(
		"unchanged dock reuses authored fixture offers",
		await page.evaluate(() => {
			const g = window.__seelite;
			return g.requestsView().offers === g.requestsView().offers;
		}),
	);
	await page.screenshot({ path: `${out}/01-selection.png` });
	const rows = page.locator(
		'[data-live-station-console] [data-live-request-action="details"]',
	);
	check("two authored fixture offers", (await rows.count()) === 2);
	const id = await rows.first().getAttribute("data-live-request-id");
	const second = await rows.nth(1).getAttribute("data-live-request-id");
	const count = () =>
		page.evaluate(
			() =>
				Object.keys(window.__seelite.commanderRecord().requests.byId).length,
		);
	await rows.first().click();
	check("mouse opens details without accepting", (await count()) === 0);
	await rows.first().focus();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Enter");
	check(
		"native Tab and Enter open the focused offer without accepting",
		(await count()) === 0 &&
			(await page.evaluate(
				(i) => window.__seelite.requestSelectedId === i,
				second,
			)),
	);
	await rows.first().click();
	check(
		"all terms visible before acceptance",
		await page
			.locator("[data-live-station-console] [data-live-request-details]")
			.evaluate((el) => {
				const visible = (field) => {
					const r = field.getBoundingClientRect();
					const style = getComputedStyle(field);
					if (
						!r.width ||
						!r.height ||
						style.display === "none" ||
						style.visibility !== "visible" ||
						r.left < 0 ||
						r.top < 0 ||
						r.right > innerWidth ||
						r.bottom > innerHeight
					)
						return false;
					for (
						let parent = field.parentElement;
						parent;
						parent = parent.parentElement
					) {
						const p = parent.getBoundingClientRect(),
							s = getComputedStyle(parent);
						if (
							s.overflowX !== "visible" &&
							(r.left < p.left || r.right > p.right)
						)
							return false;
						if (
							s.overflowY !== "visible" &&
							(r.top < p.top || r.bottom > p.bottom)
						)
							return false;
					}
					return true;
				};
				return [
					"requester",
					"purpose",
					"action",
					"intelligence",
					"danger",
					"cargo",
					"equipment",
					"payment",
					"consequence",
					"terms",
				].every((name) =>
					[...el.querySelectorAll("dt")].some(
						(dt) =>
							dt.textContent.toLowerCase() === name &&
							visible(dt) &&
							dt.nextElementSibling?.tagName === "DD" &&
							dt.nextElementSibling.textContent.trim().length > 0 &&
							visible(dt.nextElementSibling),
					),
				);
			}),
	);
	const ageBefore = await page
		.locator("[data-live-station-console] [data-live-request-age]")
		.innerText();
	await page.evaluate(() => {
		window.__seelite.step(2);
		window.__seelite.updateCockpit();
	});
	check(
		"lead age advances on the game clock without another action",
		(await page
			.locator("[data-live-station-console] [data-live-request-age]")
			.innerText()) !== ageBefore,
	);
	await page.screenshot({ path: `${out}/02-details.png` });
	const click = (action) =>
		page
			.locator(
				`[data-live-station-console] [data-live-request-action="${action}"]`,
			)
			.click();
	await click("retain");
	check("retain does not accept", (await count()) === 0);
	await page
		.locator('[data-live-station-console] [data-live-request-action="accept"]')
		.dblclick();
	check(
		"double-click acceptance cannot also select the new Track action",
		await page.evaluate(
			() =>
				window.__seelite.commanderRecord().requests.trackedRequestId === null,
		),
	);
	await click("cancel");
	await page
		.locator('[data-live-station-console] [data-live-request-action="accept"]')
		.focus();
	await page.keyboard.press("Space");
	check(
		"native Space reaccepts a focused request without changing tracking",
		await page.evaluate((i) => {
			const s = window.__seelite.commanderRecord().requests;
			return s.byId[i].status === "accepted" && s.trackedRequestId === null;
		}, id),
	);
	await click("track");
	const target = await page.evaluate(() => window.__seelite.targetId);
	await rows.nth(1).click();
	// Walk real key input to the explicit Accept action.
	const focused = () =>
		page.evaluate(
			() =>
				window.__seelite.liveCockpit.focusedElement()?.dataset
					.liveRequestAction,
		);
	const walk = async (action, press) => {
		for (let i = 0; i < 30; i++) {
			if ((await focused()) === action) return;
			await press();
		}
		throw Error(`focus never reached ${action}`);
	};
	await walk("accept", () => page.keyboard.press("ArrowDown"));
	await page.keyboard.press("Enter");
	check(
		"keyboard accepts second without changing tracking or flight target",
		await page.evaluate(
			([a, b, t]) => {
				const g = window.__seelite;
				const s = g.commanderRecord().requests;
				return (
					Object.keys(s.byId).length === 2 &&
					s.trackedRequestId === a &&
					s.byId[b].status === "accepted" &&
					g.targetId === t
				);
			},
			[id, second, target],
		),
	);
	const tap = async (index) => {
		if (!Number.isInteger(index)) throw Error("invalid W3C button index");
		await page.evaluate((i) => window.__pad.hold(i), index);
		await page.evaluate(() => window.__frames(3));
		await page.evaluate((i) => window.__pad.release(i), index);
		await page.evaluate(() => window.__frames(3));
	};
	await tap(B.r1); // Requests -> Market.
	check(
		"controller shoulder switches station tab",
		(await page
			.locator('[data-live-station-tab="Market"]')
			.getAttribute("aria-selected")) === "true",
	);
	await tap(B.l1);
	await rows.nth(1).click();
	for (let i = 0; i < 30; i++) {
		const d = await page.evaluate(
			() => window.__seelite.liveCockpit.focusedElement()?.dataset,
		);
		if (d?.liveRequestAction === "details" && d.liveRequestId === id) break;
		await tap(B.down);
	}
	await tap(B.a);
	check(
		"controller activation opens details without duplicate acceptance",
		(await count()) === 2 &&
			(await page.evaluate(
				(i) => window.__seelite.requestSelectedId === i,
				id,
			)),
	);
	// First request: ordered fixture transitions remain independent of tracking.
	await page
		.locator(
			`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${id}"]`,
		)
		.click();
	await click("untrack");
	await click("fixture-search");
	await click("fixture-identify");
	await click("fixture-disable");
	check(
		"untracked progress becomes ready to report",
		await page.evaluate(
			(i) =>
				window.__seelite.commanderRecord().requests.byId[i].status ===
				"ready-to-report",
			id,
		),
	);
	await click("track");
	await page.screenshot({ path: `${out}/03-ready-report.png` });
	// Launch through the game, then inspect actual in-flight consoles.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.launch();
		g.skipDockTraversal();
		for (let i = 0; i < 180; i++) g.step(1 / 60);
		g.setHeadLook("forward");
		g.updateCockpit();
	});
	check(
		"in-flight compact cue shows return/report",
		/Return.*Report/.test(
			await page.locator("[data-live-request-cue]").innerText(),
		),
	);
	await page.screenshot({ path: `${out}/04-active-flight.png` });
	await page.keyboard.press("Alt+ArrowLeft");
	await page.locator('[data-live-left-tab="Requests"]').click();
	check(
		"flight Requests reachable with both commitments",
		(await page
			.locator('[data-live-panel="left"] [data-live-request-action="details"]')
			.count()) === 2,
	);
	check(
		"flight has no success Report action",
		(await page
			.locator('[data-live-panel="left"] [data-live-request-action="report"]')
			.count()) === 0,
	);
	await page.screenshot({ path: `${out}/05-flight-requests.png` });
	await page
		.locator(
			`[data-live-panel="left"] [data-live-request-action="details"][data-live-request-id="${second}"]`,
		)
		.click();
	await page
		.locator('[data-live-panel="left"] [data-live-request-action="track"]')
		.click();
	await page.keyboard.press("Alt+ArrowUp");
	const cue = await page.locator("[data-live-request-cue]").innerText();
	check(
		"unconfirmed tracked lead shows region with no exact target",
		cue.includes("Search") &&
			cue.includes("search region only") &&
			!/\b\d+\.?\d* km\b/.test(cue),
	);
	// Flush the complete live envelope and boot a new Game from IndexedDB.
	await page.evaluate(async () => {
		if (!window.__seelite.saveStore) throw Error("save store not attached");
		await window.__seelite.saveStore.flush("quit");
	});
	check(
		"fixture journal and payment leave the normal Commander catalog untouched",
		await page.evaluate(async (before) => {
			const { indexedDbSaveBackend } = await import("/src/save-store.ts");
			const normal = indexedDbSaveBackend();
			const slots = await normal.slots();
			const after = JSON.stringify(
				await Promise.all(
					slots.map(async (slot) => [
						slot,
						await normal.read(slot, "live"),
						await normal.read(slot, "lastDocked"),
					]),
				),
			);
			return (
				after === before &&
				(await indexedDB.databases()).some(
					(d) => d.name === "seelite-requests-prototype-saves",
				)
			);
		}, normalBefore),
	);
	await page.goto(gameUrl(origin, { "requests-prototype": true }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	check(
		"serialized envelope restores commitments and chosen cue without payment",
		(await count()) === 2 &&
			(await page.evaluate(
				(i) =>
					window.__seelite.commanderRecord().requests.trackedRequestId === i,
				second,
			)),
	);
	await page.evaluate(async (id) => {
		const g = window.__seelite;
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
	}, station);
	await page.locator('[data-live-station-tab="Requests"]').click();
	await page
		.locator(
			`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${id}"]`,
		)
		.click();
	const credits = await page.evaluate(
		() => window.__seelite.commanderRecord().state.credits,
	);
	await click("report");
	check(
		"return Report pays pinned reward once",
		await page.evaluate(
			(c) => window.__seelite.commanderRecord().state.credits === c + 250,
			credits,
		),
	);
	check(
		"completed request has no repeat Report or Accept",
		(await page
			.locator(
				'[data-live-station-console] [data-live-request-action="report"], [data-live-station-console] [data-live-request-action="accept"]',
			)
			.count()) === 0,
	);
	await page
		.locator(
			`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${second}"]`,
		)
		.click();
	await click("fixture-unavailable");
	check(
		"first unavailability observation removes the repeat fixture action",
		(await page
			.locator(
				'[data-live-station-console] [data-live-request-action="fixture-unavailable"]',
			)
			.count()) === 0,
	);
	check(
		"observed unavailable target offers useful report and cancel",
		(await page
			.locator(
				'[data-live-station-console] [data-live-request-action="report-unavailable"]',
			)
			.count()) === 1 &&
			(await page
				.locator(
					'[data-live-station-console] [data-live-request-action="cancel"]',
				)
				.count()) === 1,
	);
	await walk("cancel", () => tap(B.down));
	await tap(B.a);
	check(
		"controller cancellation clears chosen cue and preserves first settlement",
		await page.evaluate(
			([a, b]) => {
				const s = window.__seelite.commanderRecord().requests;
				return (
					s.byId[a].status === "completed" &&
					s.byId[b].status === "cancelled" &&
					s.trackedRequestId === null
				);
			},
			[id, second],
		),
	);
	await click("accept");
	check(
		"cancelled unfinished job reaccepts same identity",
		await page.evaluate(
			(i) =>
				window.__seelite.commanderRecord().requests.byId[i]
					.acceptanceOrdinal === 2,
			second,
		),
	);
	await page.screenshot({ path: `${out}/06-unavailable.png` });
	const normalPage = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watchShaders(normalPage, "normal Game");
	await normalPage.goto(gameUrl(origin, { seed: 42, "no-save": true }), {
		waitUntil: "load",
	});
	await bootedGame(normalPage);
	check(
		"normal Game exposes no prototype Requests tabs",
		(await normalPage
			.locator(
				'[data-live-station-tab="Requests"], [data-live-left-tab="Requests"]',
			)
			.count()) === 0,
	);
	await normalPage.close();
	check("no shader failed to compile or link on either page", t.failures === 0);
	writeFileSync(
		`${out}/checks.json`,
		JSON.stringify(
			{
				headed,
				viewport: { width: 1440, height: 900 },
				fixtures:
					"Dock berth and relay objective facts simulated; no live relay or consequence. Complete IndexedDB live envelope flushed, then restored by normal direct boot into a new Game.",
				checks,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
