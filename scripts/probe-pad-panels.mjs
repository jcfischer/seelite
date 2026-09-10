/**
 * Probe: the pad works every panel, and each one does the thing rather than
 * merely showing a ring.
 *
 * #283's second half. `tests/panel-focus.test.ts` covers the cursor's
 * arithmetic and `tests/pad-bindings.test.ts` covers what a button means; both
 * are pure, and neither can see whether the cursor is walking the rows the
 * player is looking at or whether activating one reaches a callback.
 *
 * **Every check asserts an intent, never an attribute.** A ring is not evidence:
 * a cursor walking a panel wired to nothing draws exactly the same ring as one
 * wired correctly, which is the failure #283's build contract names. So the
 * readings here are `targetId`, `creditsCr`, `settings.value`, `bloom.enabled`
 * and the chart's own `state` — the things a player would notice.
 *
 * ## Mutation-checked
 *
 * Run against this tree, each reverted afterwards, and each reddening its own
 * checks and nothing else:
 *
 *   - `LiveCockpit.activateFocus` **not dispatching** — the "wired to nothing"
 *     mutant this probe exists for — reds five: the Navigation row, the chart's
 *     mount and both checks behind it, and the station BUY. The ring still
 *     moves in every one of them, which is the point. The tab walk survives it,
 *     correctly: `stepTab` dispatches for itself.
 *   - `Game.activateChartRow` returning early reds the chart's two rows alone
 *     — which is also the evidence that a chart row really does travel a
 *     different path from a console row.
 *   - `padIntents` zeroing the `modal` branch's `valueDelta` reds the settings
 *     check alone.
 *
 * **The first mutant is why check 5 reads the way it does.** Written in the
 * obvious order it passed under that mutant, because the R1 tab check two
 * blocks earlier had already switched to Galaxy Map and mounted the chart — so
 * "Cross mounts the chart" was reading a chart somebody else had put there. The
 * tab is walked back to Navigation now.
 *
 * **And the third mutant passed the first time it was run**, because the edit
 * that was supposed to break the code missed its indentation and changed
 * nothing. A no-op mutation and a working check are the same green. It is
 * asserted to land now.
 *
 * ## What it does not cover
 *
 * The two free-text filters, because a pad cannot type and no on-screen keyboard
 * was written. What narrows those lists for a pad is the chips, and the finder's
 * economy chip is checked *through the pad* below — an earlier version narrowed
 * the panel with a direct `toggleFinderEconomy` call while this paragraph
 * claimed the chips were covered, which is a claim a broken dispatch would have
 * survived. The Navigation console's kind chips are still not exercised; they
 * take the same `handleClick` path as its rows, which is checked.
 *
 * Usage:
 *   npm run dev
 *   node scripts/probe-pad-panels.mjs [baseUrl]
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";

/** The W3C standard mapping, as literals — see `probe-gamepad.mjs` on why. */
const B = STANDARD_INDEX;

/**
 * How far the cursor may be walked looking for a row.
 *
 * A cap rather than a count: the Navigation list's length depends on the seed's
 * system, and a probe that knew it would be restating the generator. Walking
 * until a named row is focused and giving up after this many presses is the
 * honest shape — and the give-up is a red, not a skip.
 */
const WALK_CAP = 40;

await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

/**
 * The one helper only this probe needs, installed **beside** the shared fixture
 * rather than wrapping it.
 *
 * `addInitScript` serialises the function body and sends it to the page, so a
 * wrapper that called `installFakePad()` would reach for a name that does not
 * exist there. Playwright runs every registered init script, so two calls is
 * the composition.
 */
const installPlaceOnAxis = () => {
	/**
	 * Place the ship on a station's aperture axis, cleared and with §7's
	 * computer flying.
	 *
	 * Lifted from `probe-dock-arrival.mjs`, which argues it: selecting the
	 * station is part of it, because `requestDockingClearance` answers for the
	 * *selected* target and a grant that lands elsewhere makes the computer
	 * refuse with `no-clearance`.
	 */
	window.__placeOnAxis = (id, rangeKm) => {
		const g = window.__seelite;
		const snap = g.dockingSnapshot(id);
		const body = g.world.system.byId.get(id);
		const a = snap.axis;
		g.world.ship.pos = {
			x: body.pos.x + a.x * rangeKm,
			y: body.pos.y + a.y * rangeKm,
			z: body.pos.z + a.z * rangeKm,
		};
		g.world.ship.vel = { ...g.stationVelocity(id) };
		g.regime = "normal";
		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		g.setThrottle(0);
		g.setAttitude({ x: -a.x, y: -a.y, z: -a.z }, snap.basis.up);
		g.step(1 / 60);
		g.targetId = id;
		g.requestDockingClearance();
		if (!g.dockingComputerEngaged) g.toggleDockingComputer();
		return snap;
	};
};

const browser = await launchChromium();
try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 860 },
	});
	watch(page);
	await page.addInitScript(installFakePad);
	await page.addInitScript(installPlaceOnAxis);
	await page.goto(`${ORIGIN}/?seed=42`, { waitUntil: "load" });
	await bootedGame(page);

	const frames = (n) => page.evaluate((count) => window.__frames(count), n);
	const tap = async (index) => {
		await page.evaluate((i) => window.__pad.hold(i), index);
		await frames(2);
		await page.evaluate((i) => window.__pad.release(i), index);
		await frames(2);
	};
	/** What the ring is on, as the attribute the panel draws it with. */
	const focused = () =>
		page.evaluate(() => {
			const el = document.querySelector("[data-live-focus]");
			if (!el) return null;
			const d = el.dataset;
			return {
				navTarget: d.liveNavTarget ?? null,
				stationAction: d.liveStationAction ?? null,
				stationName: d.liveStationName ?? null,
				mapHaze: d.mapHaze !== undefined,
				finderEconomy: d.mapFinderEconomy ?? null,
				finderRow: d.mapFinderRow ?? null,
				text: (el.textContent ?? "").trim().slice(0, 40),
			};
		});
	/** Walk down until `want` says the ring is where the check needs it. */
	const walkTo = async (want) => {
		for (let i = 0; i < WALK_CAP; i++) {
			const at = await focused();
			if (at && want(at)) return at;
			await tap(B.down);
		}
		return null;
	};

	// --- 1. the left console: the Navigation list -------------------------

	await tap(B.left);
	{
		const headLook = await page.evaluate(() => window.__seelite.headLook);
		check(
			"d-pad left opens the port console",
			headLook === "left",
			`headLook ${headLook}`,
		);
	}

	{
		// **Past whatever is already selected.** Asserting that the target
		// *changed* is right — a check that let it stay put would pass on a pad
		// that did nothing — but the boot target is in this list, and landing the
		// ring on it would fail for a reason that is not the pad.
		const already = await page.evaluate(() => window.__seelite.targetId);
		const row = await walkTo(
			(at) => at.navTarget !== null && at.navTarget !== already,
		);
		const before = await page.evaluate(() => window.__seelite.targetId);
		if (row) await tap(B.a);
		const after = await page.evaluate(() => window.__seelite.targetId);
		check(
			"Cross on a Navigation row selects that target",
			row !== null && after === row.navTarget && after !== before,
			row
				? `ring on ${row.navTarget}; target ${before} → ${after}`
				: `no navigation row found in ${WALK_CAP} presses`,
		);
	}

	// --- 2. the left console: its tabs ------------------------------------

	{
		const before = await page.evaluate(
			() => document.querySelector("[data-live-cockpit]").dataset.liveLeftView,
		);
		await tap(B.r1);
		const after = await page.evaluate(
			() => document.querySelector("[data-live-cockpit]").dataset.liveLeftView,
		);
		check(
			"R1 changes the console's tab",
			before !== after,
			`left tab ${before} → ${after}`,
		);
		// **Back to Navigation.** This check leaves the tab on Galaxy Map, which
		// mounts the chart — and the check below, which exists to show that Cross
		// on the GALAXY MAP row mounts it, then passed against a chart this one
		// had already put there. Found by a mutation: the row's dispatch was made
		// a no-op and that check stayed green.
		await tap(B.l1);
	}

	// --- 3. the right console ---------------------------------------------

	{
		await tap(B.right);
		const heading = () =>
			page.evaluate(
				() =>
					document
						.querySelector('[data-live-panel="right"] h2')
						?.textContent?.trim() ?? null,
			);
		const before = await heading();
		await tap(B.r1);
		const after = await heading();
		check(
			"d-pad right opens the starboard console, and R1 walks its tabs",
			before !== null && after !== null && before !== after,
			`right tab ${before} → ${after}`,
		);
		await tap(B.b);
	}

	// --- 4. the galaxy chart, and the finder beside it ---------------------

	{
		// Back to the port console and onto the chart's tab. Through the same
		// callback a click uses: walk the ring to the tab and press Cross.
		await tap(B.left);
		const tab = await walkTo((at) => at.text.toUpperCase() === "GALAXY MAP");
		if (tab) await tap(B.a);
		// The chart is a dynamic import. Without this the focus list has no
		// foreign rows on it and every check below would pass vacuously.
		const mounted = await page
			.waitForFunction(() => Boolean(window.__seeliteGalaxyMap), null, {
				timeout: 30000,
			})
			.then(() => true)
			.catch(() => false);
		check(
			"Cross on the GALAXY MAP row mounts the chart",
			tab !== null && mounted,
			mounted ? "chart handle present" : "no chart after 30s",
		);
	}

	{
		const before = await page.evaluate(
			() => window.__seeliteGalaxyMap?.state.haze ?? null,
		);
		const row = await walkTo((at) => at.mapHaze);
		if (row) await tap(B.a);
		const after = await page.evaluate(
			() => window.__seeliteGalaxyMap?.state.haze ?? null,
		);
		check(
			"Cross on the chart's own button reaches the chart's own handle",
			row !== null && before !== null && after === !before,
			`haze ${before} → ${after}`,
		);
	}

	{
		// **Narrow the finder with the pad, not with a direct call.** It draws no
		// result rows until its filter says something (`finderIsNarrowed`), so a
		// walk on an unfiltered panel found nothing and reported it as a failure
		// of the pad. The first fix reached for `toggleFinderEconomy` directly —
		// which narrowed the panel and checked nothing, while the header claimed
		// the chips were covered. Sage caught the claim, round 1. Walking to a
		// chip and pressing Cross is both the narrowing *and* the check, and it
		// is #283's F7 answer: chips are what a device that cannot type has.
		const chipBefore = await page.evaluate(
			() =>
				window.__seeliteGalaxyMap?.state.finder.filter.economies?.length ?? -1,
		);
		const chip = await walkTo((at) => at.finderEconomy !== null);
		if (chip) await tap(B.a);
		const chipAfter = await page.evaluate(
			() =>
				window.__seeliteGalaxyMap?.state.finder.filter.economies?.length ?? -1,
		);
		check(
			"Cross on an economy chip narrows the finder, which is how a pad filters at all",
			chip !== null && chipAfter !== chipBefore,
			chip
				? `chip ${chip.finderEconomy}; economies ${chipBefore} → ${chipAfter}`
				: `no economy chip found in ${WALK_CAP} presses`,
		);
		await frames(2);
		const before = await page.evaluate(
			() => window.__seeliteGalaxyMap?.state.selectedIndex ?? null,
		);
		const row = await walkTo((at) => at.finderRow !== null);
		if (row) await tap(B.a);
		const after = await page.evaluate(
			() => window.__seeliteGalaxyMap?.state.selectedIndex ?? null,
		);
		check(
			"…and a finder row selects that system, which is how a pad finds one at all",
			row !== null && after === Number(row.finderRow),
			row
				? `ring on row ${row.finderRow}; selection ${before} → ${after}`
				: `no finder row found in ${WALK_CAP} presses`,
		);
	}

	await tap(B.b);

	// --- 5. the station console -------------------------------------------

	{
		// A **slot** station, and at `probe-dock-arrival`'s own standoff. The
		// first version took `stations[0]` at 12 km and never left `flying`:
		// the roster is mixed, and a pad probe is not the place to re-derive
		// what a dockable approach looks like.
		const stationId = await page.evaluate(() => {
			const g = window.__seelite;
			for (const station of g.world.system.contents.stations)
				if (g.dockingSnapshot(station.id)?.apertureKind === "slot")
					return station.id;
			return null;
		});
		const docked = await page.evaluate(async (id) => {
			const g = window.__seelite;
			window.__placeOnAxis(id, g.dockingSnapshot(id).planeKm + 4.5);
			for (let i = 0; i < 60 * 120; i++) {
				g.step(1 / 60);
				const now = g.dockingSnapshot(id);
				if (now.dockPhase === "arriving") g.skipDockTraversal();
				if (now.dockPhase === "docked") break;
			}
			g.setHeadLook("forward");
			await window.__frames(2);
			return g.dockingSnapshot(id).dockPhase;
		}, stationId);
		check("a scripted approach docks", docked === "docked", `phase ${docked}`);

		const context = await page.evaluate(() =>
			Boolean(document.querySelector("[data-live-station-console]")),
		);
		check(
			"the station console is a pad surface with the head forward, which is where it is drawn",
			context,
			`console present ${context}`,
		);

		// **The ring must not walk below the fold**, and the market is where that
		// can be shown: seventeen rows in an `overflow: auto` box. The first
		// version of this check watched the Navigation list instead and reported
		// "the list fits, so there is nothing to scroll" — a check that never
		// ran, which is worse than one that fails. Sage found the defect itself
		// in round 1, with a fixture that activated a row while `scrollTop`
		// stayed zero.
		const marketScroll = () =>
			page.evaluate(() => {
				const box = document.querySelector(".lc-station-market");
				if (!box) return null;
				return {
					top: box.scrollTop,
					overflows: box.scrollHeight > box.clientHeight + 1,
				};
			});
		// **At a narrow viewport**, because the fold has to be real. The station
		// console is `inset: 7% 8% 12%`, so at 1280x860 seventeen market rows fit
		// and the box never scrolls — the check reported "overflows false" and
		// proved nothing. `probe-station-visuals` has the same two arms for the
		// same reason.
		await page.setViewportSize({ width: 700, height: 480 });
		await frames(2);
		const scrollBefore = await marketScroll();
		for (let i = 0; i < 12; i++) await tap(B.down);
		const scrollAfter = await marketScroll();
		await page.setViewportSize({ width: 1280, height: 860 });
		await frames(2);
		check(
			"walking the market past the fold scrolls it, so the ring is never on a row nobody can see",
			scrollBefore !== null &&
				scrollAfter !== null &&
				scrollBefore.overflows &&
				scrollAfter.top > scrollBefore.top,
			scrollBefore === null || scrollAfter === null
				? "no market box on screen"
				: `overflows ${scrollBefore.overflows}; scrollTop ${scrollBefore.top} → ${scrollAfter.top}`,
		);

		const before = await page.evaluate(() => window.__seelite.creditsCr);
		const row = await walkTo((at) => at.stationAction === "buy-commodity");
		if (row) await tap(B.a);
		const after = await page.evaluate(() => window.__seelite.creditsCr);
		check(
			"Cross on a BUY row buys something",
			row !== null && after < before,
			row
				? `ring on ${row.stationName}; credits ${before} → ${after}`
				: `no BUY row found in ${WALK_CAP} presses`,
		);
	}

	// --- 6. the settings screen -------------------------------------------

	{
		// Opened from the keyboard, which is the only way in — the pad has no
		// binding for it, and that is stated rather than discovered.
		await page.keyboard.press("z");
		await frames(2);
		const open = await page.evaluate(() =>
			Boolean(document.querySelector("[data-settings-panel]")),
		);
		const before = await page.evaluate(() => ({
			...window.__seelite.settings.value,
		}));
		await tap(B.right);
		const after = await page.evaluate(() => ({
			...window.__seelite.settings.value,
		}));
		const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
		check(
			"d-pad right changes a setting, as the screen's own hint line says",
			open && changed.length === 1,
			`open ${open}; changed ${changed.join(", ") || "nothing"}`,
		);

		await tap(B.b);
		const closed = await page.evaluate(
			() => !document.querySelector("[data-settings-panel]"),
		);
		check("Circle closes it", closed, `closed ${closed}`);
	}
} finally {
	await browser.close();
}

exit();
