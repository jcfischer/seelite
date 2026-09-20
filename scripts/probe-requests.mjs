/** Node 411. The live request board, flown end to end in a normal Game.
 *
 * It was node 343's fixture probe: two authored offers behind
 * `?requests-prototype`, with buttons that simulated each stage. There is no
 * flag and no simulated stage now — the board is bound from world state
 * (`jobs.ts`), the objective is satisfied by flying the cargo to the delivery
 * station, and the reward and the market mark land on Report.
 *
 * Dock setup uses the project's shared canonical berth fixture. Mouse, real
 * KeyboardEvents and a fake W3C device exercise the public cockpit
 * click/focus dispatch; HEADED=1 captures the same flow.
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
const out = process.env.REQUESTS_EVIDENCE ?? "/tmp/seelite-411-evidence";
const headed = process.env.HEADED === "1";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
// Only for the shader listener: this probe keeps its own throwing `check` and
// `pageerror` handler, and takes the one thing `tally()` adds that they do not
// — a shader that fails to link is a `console.error`, not a page error.
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
	// **No query flag**, because there is none left: #411 retired
	// `?requests-prototype` with the fixtures it gated. Note what this run is
	// and is not — a vite dev server, where `import.meta.env.DEV` is true. It
	// shows that the board needs no flag; the claim that a *production build*
	// reaches it rests on the flag being gone from the source, which is a grep
	// rather than a frame. #437's production arm is deleted with the flag it
	// checked for.
	await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
	await bootedGame(page);
	console.log("BOOTED");

	const dockAt = (target, stationId) =>
		target.evaluate(async (wanted) => {
			const g = window.__seelite;
			const id =
				wanted ??
				g.world.system.bodies.find(
					(b) => b.kind === "station" && b.stationType === "trade",
				)?.id ??
				g.world.system.bodies.find((b) => b.kind === "station")?.id;
			if (!id) throw Error("no station");
			await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
			g.setHeadLook("forward");
			g.updateCockpit();
			return id;
		}, stationId);

	const station = await dockAt(page);
	check(
		"a normal docked Game has Requests beside Market and Equipment",
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

	const rows = page.locator(
		'[data-live-station-console] [data-live-request-action="details"]',
	);
	check(
		"D8's courier floor means the board is not empty",
		(await rows.count()) >= 1,
		`${await rows.count()} offer(s)`,
	);
	const id = await rows.first().getAttribute("data-live-request-id");
	const offer = await page.evaluate(
		(i) => window.__seelite.requestsView().offers.find((o) => o.id === i),
		id,
	);
	check(
		"the offer carries live operands, not authored placeholders",
		typeof offer.goodName === "string" &&
			offer.goodName.length > 0 &&
			offer.tonnes > 0 &&
			offer.rewardCr > 0 &&
			offer.reportAt.carrierKey !== offer.requester.carrierKey,
		`${offer.tonnes} t ${offer.goodName} → ${offer.reportName} (${offer.distanceLy.toFixed(1)} LY)`,
	);

	const count = () =>
		page.evaluate(
			() =>
				Object.keys(window.__seelite.commanderRecord().requests.byId).length,
		);
	await rows.first().click();
	check("mouse opens details without accepting", (await count()) === 0);
	check(
		"every term is visible before acceptance",
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
					"report at",
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
	check(
		"the cargo line says whose goods these are",
		(
			await page
				.locator("[data-live-station-console] [data-live-request-details]")
				.innerText()
		).includes(offer.entrusted ? "entrusted" : "your own"),
	);
	const ageBefore = await page
		.locator("[data-live-station-console] [data-live-request-age]")
		.innerText();
	await page.evaluate(() => {
		window.__seelite.step(2);
		window.__seelite.updateCockpit();
	});
	check(
		"the offer's age advances on the game clock without another action",
		(await page
			.locator("[data-live-station-console] [data-live-request-age]")
			.innerText()) !== ageBefore,
	);
	await page.screenshot({ path: `${out}/01-details.png` });

	const click = (action) =>
		page
			.locator(
				`[data-live-station-console] [data-live-request-action="${action}"]`,
			)
			.click();
	await click("retain");
	check("retain does not accept", (await count()) === 0);

	// **Real key events, on the public dispatch.** `Enter` on a focused row
	// opens its details and nothing else; the walk below is what accepts.
	await rows.first().focus();
	await page.keyboard.press("Enter");
	check(
		"native Enter opens the focused offer without accepting",
		(await count()) === 0 &&
			(await page.evaluate(
				(i) => window.__seelite.requestSelectedId === i,
				id,
			)),
	);
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
		"the keyboard accepts, and acceptance starts no tracking",
		(await count()) === 1 &&
			(await page.evaluate(
				() =>
					window.__seelite.commanderRecord().requests.trackedRequestId === null,
			)),
	);
	await click("cancel");
	await click("return-entrusted");
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
	check(
		"an entrusted consignment is aboard, and it costs hold",
		await page.evaluate((t) => {
			const g = window.__seelite;
			const lots = Object.values(g.commanderRecord().requests.entrustedByLotId);
			return (
				lots.length === 1 &&
				lots[0].aboardT === t &&
				// It is the requester's, so it is not in the pilot's cargo.
				!(lots[0].goodName in g.commanderRecord().state.cargo)
			);
		}, offer.tonnes),
	);
	check(
		"no Deliver action at the requester — delivery is at the other end",
		(await page
			.locator(
				'[data-live-station-console] [data-live-request-action="deliver"]',
			)
			.count()) === 0,
	);

	await click("cancel");
	check(
		"cancelling keeps the obligation it created",
		await page.evaluate(
			() =>
				Object.values(
					window.__seelite.commanderRecord().requests.entrustedByLotId,
				).length === 1,
		),
	);
	await click("return-entrusted");
	check(
		"returning the consignment at the requester clears the hold",
		await page.evaluate(
			() =>
				Object.values(
					window.__seelite.commanderRecord().requests.entrustedByLotId,
				).length === 0,
		),
	);
	const ordinalBefore = await page.evaluate(
		(i) =>
			window.__seelite.commanderRecord().requests.byId[i].acceptanceOrdinal,
		id,
	);
	await page
		.locator('[data-live-station-console] [data-live-request-action="accept"]')
		.focus();
	await page.keyboard.press("Space");
	check(
		"native Space reaccepts a focused request without changing tracking",
		await page.evaluate(
			([i, was]) => {
				const s = window.__seelite.commanderRecord().requests;
				return (
					s.byId[i].status === "accepted" &&
					// The same identity, one issuance further on — not a clone.
					s.byId[i].acceptanceOrdinal === was + 1 &&
					s.trackedRequestId === null
				);
			},
			[id, ordinalBefore],
		),
	);

	const target = await page.evaluate(() => window.__seelite.targetId);
	await click("track");
	check(
		"tracking changes no flight target",
		await page.evaluate((t) => window.__seelite.targetId === t, target),
	);

	// -----------------------------------------------------------------------
	// #443 — the hold, and what the till says when it says no.
	//
	// The node was reported as a bug in the till: 228 Cr, 28 t of Food on the
	// shelf, and the console sold eleven tonnes. Every figure was right — a
	// 20 t hull, an 8 t consignment and 1 t of Radioactives — and **nothing on
	// the glass said any of it**. So these read the *rendered* text and not a
	// state object, which is #411 round 3's lesson: a probe that asks the game
	// what it would have drawn agrees with any build.
	//
	// The state is set up through `__seelite` and then restored, the way this
	// probe already parks a ship and `probe-death` already sets credits. What
	// is being measured is the screen after a real DOM click, not the setup.
	// -----------------------------------------------------------------------
	await page.locator('[data-live-station-tab="Market"]').click();
	const holdText = () => page.locator("[data-live-station-hold]").innerText();
	const messageText = () =>
		page.locator("[data-live-station-message]").innerText();

	const entrustedT = await page.evaluate(() =>
		Object.values(
			window.__seelite.commanderRecord().requests.entrustedByLotId,
		).reduce((sum, lot) => sum + lot.aboardT, 0),
	);
	// One read per check, reported with the same read. Three separate
	// `innerText()` calls let the assertion and its failure message describe
	// different frames.
	let line = await holdText();
	check(
		"the trade screen says what the hold holds, and that a job is in it",
		line.includes(`${entrustedT} t entrusted`) &&
			/HOLD \d+ \/ \d+ t · -?\d+ t free/.test(line),
		`${entrustedT} t entrusted · ${line}`,
	);
	check(
		"nothing has been refused yet, so the live region is empty",
		(await messageText()) === "",
	);
	await page.screenshot({ path: `${out}/40-hold-line.png` });

	/**
	 * Write the commander's purse and manifest, then make the console notice.
	 *
	 * The revision bump is the non-obvious step and it is here once: the
	 * console memoises on a key the *game* moves whenever it replaces the
	 * displayed state, and a probe's write is not the game. Without it the
	 * cached screen comes back and the setup measures the build's caching
	 * rather than its arithmetic, which is how the first run of this block
	 * failed.
	 */
	const setCommander = (credits, cargo) =>
		page.evaluate(
			([c, m]) => {
				const g = window.__seelite;
				g.commander.credits = c;
				g.commander.cargo = m;
				g.stationConsoleRevision += 1;
				g.updateCockpit();
			},
			[credits, cargo],
		);

	// Fill the pilot's half of the hold to the brim, leaving the consignment
	// where it is. The till buys one tonne per press, so `cargo-full` is only
	// ever reachable at zero free — which is the sentence a pilot actually
	// meets, and the one the node says must name the consignment.
	const filled = await page.evaluate(() => {
		const g = window.__seelite;
		const was = {
			credits: g.commander.credits,
			cargo: { ...g.commander.cargo },
		};
		const row = [...document.querySelectorAll("[data-live-market-row]")].find(
			(el) =>
				el.getAttribute("data-live-listed") === "true" &&
				el.querySelector('[data-live-station-action="buy-commodity"]') &&
				/^\d+\s*t\b/.test(
					el.querySelector("[data-live-shelf]")?.textContent ?? "",
				),
		);
		const good = row?.getAttribute("data-live-market-row") ?? null;
		if (!good) return { was, good: null };
		// **The free tonnage is read off the glass, and that does not make the
		// check below adversarial.** A hold line understating free by a constant
		// is filled with the understated amount and re-read through the same
		// derivation, so `0 t free` comes out on the wrong build exactly as it
		// does on the right one. The row is self-consistent by construction; the
		// arithmetic itself is `tests/hold.test.ts`'s, and what this measures is
		// that the till's refusal reaches the glass after a real click.
		const line =
			document.querySelector("[data-live-station-hold]")?.textContent ?? "";
		const freeWas = Number(/(-?\d+) t free/.exec(line)?.[1] ?? Number.NaN);
		if (!Number.isFinite(freeWas)) return { was, good: null, line };
		return {
			was,
			good,
			freeWas,
			// Top up rather than replace: the pilot may already hold this good,
			// and overwriting it would land the hold short of full and redden
			// the next check for a reason that has nothing to do with the build.
			cargo: { ...was.cargo, [good]: (was.cargo[good] ?? 0) + freeWas },
		};
	});
	check(
		"a tonne good with a shelf is on the board to fill the hold with",
		filled.good !== null,
		JSON.stringify(filled),
	);
	await setCommander(100_000, filled.cargo);
	line = await holdText();
	check(
		"a full hold reads as full before anything is pressed",
		/ 0 t free/.test(line),
		line,
	);
	await page
		.locator(
			`[data-live-station-action="buy-commodity"][data-live-station-name="${filled.good}"]`,
		)
		.click();
	const refusal = await messageText();
	check(
		"a refused purchase says so, names the room and names the consignment",
		refusal.startsWith("No room") &&
			refusal.includes(`${entrustedT} t entrusted to a job`) &&
			/0 t free of \d+/.test(refusal),
		refusal,
	);
	await page.screenshot({ path: `${out}/41-refusal.png` });
	check(
		"the refusal is visible, not merely present in the markup",
		await page.locator("[data-live-station-message]").isVisible(),
	);
	// A refusal is about the press that earned it. Leaving the tab retires it.
	await page.locator('[data-live-station-tab="Equipment"]').click();
	await page.locator('[data-live-station-tab="Market"]').click();
	check("a tab change retires the refusal", (await messageText()) === "");
	await setCommander(filled.was.credits, filled.was.cargo);
	line = await holdText();
	check(
		"the hold is back where the rest of this probe left it",
		line.includes(`${entrustedT} t entrusted`) && !/ 0 t free/.test(line),
		line,
	);
	await page.locator('[data-live-station-tab="Requests"]').click();

	// The board is a function of the world, not of how often the pilot docks.
	//
	// **Bind it again rather than reading the memo.** `requestsView` caches on
	// a key that a re-dock does not move, so comparing two reads of it compares
	// one array with itself — and an offer's id is a pure function of galaxy,
	// system, station, family and episode, so even a rerolled good, tonnage,
	// reward or destination would leave it equal. The cache key is cleared and
	// every term is compared.
	const termsOfBoard = () =>
		page.evaluate(() => {
			const g = window.__seelite;
			g.requestOffersCacheKey = null;
			return g.requestsView().offers.map((o) => ({
				id: o.id,
				goodName: o.goodName,
				tonnes: o.tonnes,
				rewardCr: o.rewardCr,
				reportAt: o.reportAt,
				episode: o.episode,
				rowId: o.rowId,
			}));
		});
	const before = await termsOfBoard();
	await page.evaluate(() => {
		const g = window.__seelite;
		g.launch();
		g.skipDockTraversal();
		for (let i = 0; i < 60; i++) g.step(1 / 60);
	});
	await dockAt(page, station);
	await page.locator('[data-live-station-tab="Requests"]').click();
	check(
		"undocking and docking again rerolls nothing",
		JSON.stringify(await termsOfBoard()) === JSON.stringify(before),
	);

	// A fake W3C device drives the same dispatch as the mouse.
	const tap = async (index) => {
		if (!Number.isInteger(index)) throw Error("invalid W3C button index");
		await page.evaluate((i) => window.__pad.hold(i), index);
		await page.evaluate(() => window.__frames(3));
		await page.evaluate((i) => window.__pad.release(i), index);
		await page.evaluate(() => window.__frames(3));
	};
	await tap(B.r1);
	check(
		"controller shoulder switches station tab",
		(await page
			.locator('[data-live-station-tab="Market"]')
			.getAttribute("aria-selected")) === "true",
	);
	await tap(B.l1);
	// The controller opens details through the same dispatch, and opening is
	// not accepting.
	const acceptedBeforePad = await count();
	for (let i = 0; i < 30; i++) {
		const data = await page.evaluate(
			() => window.__seelite.liveCockpit.focusedElement()?.dataset,
		);
		if (data?.liveRequestAction === "details" && data.liveRequestId === id)
			break;
		await tap(B.down);
	}
	await tap(B.a);
	check(
		"controller activation opens details without a second acceptance",
		(await count()) === acceptedBeforePad &&
			(await page.evaluate(
				(i) => window.__seelite.requestSelectedId === i,
				id,
			)),
	);
	await rows.first().click();

	// Fly it. The delivery station may be in this system or one jump away; the
	// binder decides, so the probe reads the offer rather than assuming.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.launch();
		g.skipDockTraversal();
		for (let i = 0; i < 180; i++) g.step(1 / 60);
		g.setHeadLook("forward");
		g.updateCockpit();
	});
	check(
		"the in-flight cue names the cargo and where it goes",
		(await page.locator("[data-live-request-cue]").innerText()).includes(
			offer.reportName,
		),
	);
	// The left console reviews commitments in flight, and cannot settle one.
	await page.keyboard.press("Alt+ArrowLeft");
	await page.locator('[data-live-left-tab="Requests"]').click();
	check(
		"the flight panel lists the commitment and offers no Report",
		(await page
			.locator('[data-live-panel="left"] [data-live-request-action="details"]')
			.count()) >= 1 &&
			(await page
				.locator('[data-live-panel="left"] [data-live-request-action="report"]')
				.count()) === 0,
	);
	await page.screenshot({ path: `${out}/02b-flight-requests.png` });
	await page.keyboard.press("Alt+ArrowUp");
	await page.screenshot({ path: `${out}/02-tracked-flight.png` });

	// One jump, used by both legs of the flight. The second copy of this block
	// had dropped the missing-system guard, which is what a copy does.
	const jumpToSystemOf = (carrierKey) =>
		page.evaluate((key) => {
			const g = window.__seelite;
			const systemIndex = Number(key.split(":")[0]);
			if (systemIndex === g.world.system.record.index) return "same system";
			const to = g.world.galaxy.systems.find((s) => s.index === systemIndex);
			if (!to) throw Error(`system ${systemIndex} is not in this galaxy`);
			// A pilot tops the tank up at the board's own station; this probe is
			// not measuring what that costs.
			g.commander = { ...g.commander, fuelLy: 7 };
			g.performJump(to);
			for (let i = 0; i < 60; i++) g.step(1 / 60);
			return g.world.system.record.index === systemIndex
				? "jumped"
				: `jump failed: ${g.jumpNotice ?? "no notice"}`;
		}, carrierKey);
	const jumped = await jumpToSystemOf(offer.reportAt.carrierKey);
	check(
		"the delivery station is reachable on one jump or already here",
		jumped === "same system" || jumped === "jumped",
		jumped,
	);

	const destination = offer.reportAt.carrierKey.split(":").slice(1).join(":");
	await dockAt(page, destination);
	await page.locator('[data-live-station-tab="Requests"]').click();
	await page
		.locator(
			`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${id}"]`,
		)
		.click();
	const creditsBefore = await page.evaluate(
		() => window.__seelite.commanderRecord().state.credits,
	);
	// **Off the glass, not off the state object.** The row is named for what a
	// pilot reads, so it reads the rendered market cell; a state read would
	// pass with the screen showing anything at all.
	const priceOnGlass = async () => {
		await page.locator('[data-live-station-tab="Market"]').click();
		const text = await page
			.locator(
				`[data-live-station-console] [data-live-market-row="${offer.goodName}"] [data-live-buy]`,
			)
			.innerText();
		const value = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
		if (!Number.isFinite(value))
			throw new Error(`no buy price on the glass for ${offer.goodName}`);
		await page.locator('[data-live-station-tab="Requests"]').click();
		return value;
	};
	const priceBefore = await priceOnGlass();
	await page
		.locator(
			`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${id}"]`,
		)
		.click();
	await click("deliver");
	check(
		"delivering at the report station satisfies the objective",
		await page.evaluate(
			(i) =>
				window.__seelite.commanderRecord().requests.byId[i].status ===
					"ready-to-report" &&
				Object.values(
					window.__seelite.commanderRecord().requests.entrustedByLotId,
				).length === 0,
			id,
		),
	);
	await click("report");
	check(
		"Report pays the pinned reward once",
		await page.evaluate(
			([c, r]) => window.__seelite.commanderRecord().state.credits === c + r,
			[creditsBefore, offer.rewardCr],
		),
		`${creditsBefore} → ${creditsBefore + offer.rewardCr} Cr`,
	);
	check(
		"a settled job offers no repeat Report or Accept",
		(await page
			.locator(
				'[data-live-station-console] [data-live-request-action="report"], [data-live-station-console] [data-live-request-action="accept"]',
			)
			.count()) === 0,
	);
	const marked = await page.evaluate((o) => {
		const g = window.__seelite;
		const gi = g.world.system.record.galaxy;
		const row = g.commerceWorld.galaxies[gi].deficits[o.reportAt.carrierKey];
		return row ? (row.goods[o.goodName] ?? 0) : 0;
	}, offer);
	check(
		"the delivery leaves a mark on the destination's market",
		marked < 0,
		`deficit ${marked.toFixed(2)} units`,
	);
	const priceAfter = await priceOnGlass();
	check(
		"and the price a pilot reads on the glass has moved with it",
		priceAfter < priceBefore,
		`${priceBefore} → ${priceAfter} Cr`,
	);
	await page.screenshot({ path: `${out}/03-delivered.png` });

	// Back to the requester: the episode counter lives on its board, and the
	// row this replaced read the pinned terms of the job just settled — which
	// cannot fail for the reason its name gives.
	const home = offer.requester.carrierKey.split(":").slice(1).join(":");
	await jumpToSystemOf(offer.requester.carrierKey);
	await dockAt(page, home);
	await page.locator('[data-live-station-tab="Requests"]').click();
	const nextEpisode = await page.evaluate(
		(o) =>
			window.__seelite
				.requestsView()
				.offers.filter((row) => row.family === "courier")
				.map((row) => ({ id: row.id, episode: row.episode }))
				.find((row) => row.id !== o.id) ?? null,
		offer,
	);
	check(
		"the settled job lets this requester post its next episode",
		nextEpisode !== null && nextEpisode.episode === 2,
		nextEpisode ? `${nextEpisode.id} · episode ${nextEpisode.episode}` : "none",
	);

	// Flush the complete live envelope and boot a new Game from IndexedDB.
	await page.evaluate(async () => {
		if (!window.__seelite.saveStore) throw Error("save store not attached");
		await window.__seelite.saveStore.flush("quit");
	});
	check(
		"the journal lands in the one Commander catalog at one schema version",
		await page.evaluate(async () => {
			const { indexedDbSaveBackend } = await import("/src/save-store.ts");
			const { SAVE_SCHEMA_VERSION } = await import("/src/save-envelope.ts");
			const normal = indexedDbSaveBackend();
			const records = await Promise.all(
				(await normal.slots()).map((slot) => normal.read(slot, "live")),
			);
			const carrying = records.filter(
				(r) => Object.keys(r?.commander?.requests?.byId ?? {}).length > 0,
			);
			const versions = new Set(carrying.map((r) => r.saveSchemaVersion));
			return (
				carrying.length > 0 &&
				versions.size === 1 &&
				versions.has(SAVE_SCHEMA_VERSION) &&
				!(await indexedDB.databases()).some(
					(d) => d.name === "seelite-requests-prototype-saves",
				)
			);
		}),
	);
	await page.goto(gameUrl(origin, {}), { waitUntil: "load" });
	await bootedGame(page);
	check(
		"a restored envelope carries the settlement rather than repaying it",
		await page.evaluate(
			([i, c, r]) => {
				const g = window.__seelite;
				const row = g.commanderRecord().requests.byId[i];
				return (
					row?.status === "completed" &&
					row.settledAt !== null &&
					g.commanderRecord().state.credits === c + r
				);
			},
			[id, creditsBefore, offer.rewardCr],
		),
	);
	check("no shader failed to compile or link", t.failures === 0);
	writeFileSync(
		`${out}/checks.json`,
		JSON.stringify(
			{
				headed,
				viewport: { width: 1440, height: 900 },
				fixtures:
					"Dock berth placement only. The offer, its operands, the delivery and the market mark are live; no stage is simulated.",
				offer: {
					id: offer.id,
					family: offer.family,
					goodName: offer.goodName,
					tonnes: offer.tonnes,
					rewardCr: offer.rewardCr,
					distanceLy: offer.distanceLy,
				},
				checks,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
