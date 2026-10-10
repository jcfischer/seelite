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
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
	waitForSettingsPanel,
} from "./probe-guard.mjs";
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";
import { gameUrl } from "./lib/game-url.mjs";

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
const installPlaceOnAxis = async () => {
	const { migrateEquipment, equipmentNames } = await import("/src/loadout.ts");

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
		if (!g.dockingComputer.engaged) {
			// A new ship has no docking computer (#408): fit the one this flies.
			if (!g.hasDockingComputer)
				g.commander = {
					...g.commander,
					loadout: migrateEquipment(g.commander.hull, [
						...equipmentNames(g.commander.loadout ?? {}),
						g.dockingComputerName,
					]).loadout,
				};
			g.toggleDockingComputer();
		}
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
	await page.goto(gameUrl(ORIGIN, { seed: 42 }), { waitUntil: "load" });
	await bootedGame(page);
	await page.evaluate(installPlaceOnAxis);

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

	{
		// **A panel suspends the ship, and that is the principal's reversal of
		// what #283 shipped.** Deflect a stick with a console open and the ship
		// must not turn; close it and the same deflection must.
		await page.evaluate(() => window.__pad.axes(0, 0, 1, 0));
		await frames(10);
		const held = await page.evaluate(() => window.__seelite.rates.yaw);
		await page.evaluate(() => window.__pad.rest());
		await frames(6);

		// The mouse, the same way. #283 never touched it and it had the same
		// property for the same reason.
		const mouseHeld = await page.evaluate(async () => {
			const g = window.__seelite;
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			g.mouseDx = 400;
			g.mouseDy = 0;
			await window.__frames(3);
			return g.rates.yaw;
		});

		await tap(B.b); // back to the forward view
		const mouseFlying = await page.evaluate(async () => {
			const g = window.__seelite;
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			g.mouseDx = 400;
			g.mouseDy = 0;
			await window.__frames(3);
			return g.rates.yaw;
		});
		await page.evaluate(() => {
			window.__seelite.rates = { pitch: 0, yaw: 0, roll: 0 };
		});
		await frames(3);
		await page.evaluate(() => window.__pad.axes(0, 0, 1, 0));
		await frames(10);
		const flying = await page.evaluate(() => window.__seelite.rates.yaw);
		await page.evaluate(() => window.__pad.rest());
		await frames(6);
		await tap(B.left); // and back into the console for the checks below

		check(
			"a console suspends the stick, and the forward view gives it back",
			Math.abs(held) < 1e-9 && Math.abs(flying) > 1e-6,
			`yaw ${held} with the console open, ${flying.toFixed(5)} rad/s without it`,
		);
		check(
			"…and it suspends the mouse too, which #283 never touched",
			// **Both arms.** Asserting only that the pointer does nothing with a
			// console open passes just as well against a mouse path that is
			// broken outright — the same shape of hole as the stick check beside
			// it, which has had its positive arm from the start. Sage found the
			// asymmetry.
			Math.abs(mouseHeld) < 1e-9 && Math.abs(mouseFlying) > 1e-9,
			`yaw ${mouseHeld} with the console open, ${mouseFlying.toFixed(5)} rad/s without it, after a 400 px delta`,
		);
	}

	{
		// Which surface has the pad, and how to work it — the two findings that
		// were "I can't tell which panel has the pad" and "I can't tell which
		// buttons walk it".
		const marked = await page.evaluate(() => {
			const scope = document.querySelector("[data-live-pad-scope='true']");
			const hint = document.querySelector("[data-live-pad-hint]");
			return {
				scope: scope?.getAttribute("data-live-panel") ?? null,
				hintIn: hint?.parentElement?.getAttribute("data-live-panel") ?? null,
				hint: hint?.textContent ?? null,
			};
		});
		// The rail's GALAXY MAP button is not a tab and must stay in the walk —
		// dropping `data-live-left-tab` wholesale took a control out of the pad's
		// reach entirely, seen by neither the PR body nor the tab check. Sage.
		const railReached = await page.evaluate(() => {
			const rail = document.querySelector(
				'[data-live-panel][data-active="true"] [data-live-left-tab]:not(.lc-tab)',
			);
			return rail ? rail.textContent?.trim() : null;
		});
		let landedOnRail = false;
		for (let i = 0; i < WALK_CAP && railReached; i++) {
			const on = await focused();
			if (on?.text?.toUpperCase() === railReached.toUpperCase()) {
				landedOnRail = true;
				break;
			}
			await tap(B.down);
		}
		{
			// **The ring layers over the selected fill rather than replacing it.**
			// Written as a `background` the wash needed `!important` to win, and
			// winning was the defect: on a row that is both selected and ringed
			// it removed `aria-current`'s amber, which is the one row the "two
			// highlights, two questions" argument is about. Sage found it.
			//
			// **And this check was written unable to fail on that.** The first
			// version asserted only that a shadow existed and the background was
			// not transparent — which the `!important` version satisfies, since
			// it keeps the outer glow and paints its own background. It reads the
			// selected row's colour from the stylesheet's own rule now and
			// requires the ringed row to still be wearing it. It also restored
			// nothing, leaving `data-live-focus` on a live row that every later
			// check finds first with a global query.
			const layered = await page.evaluate(() => {
				const row = document.querySelector("[data-live-nav-target]");
				if (!row) return null;
				const hadCurrent = row.getAttribute("aria-current");
				const hadFocus = row.dataset.liveFocus;
				row.setAttribute("aria-current", "true");
				const selectedOnly = getComputedStyle(row).backgroundColor;
				row.dataset.liveFocus = "true";
				const style = getComputedStyle(row);
				const both = {
					background: style.backgroundColor,
					shadow: style.boxShadow,
				};
				// Put the row back exactly as it was found.
				if (hadCurrent === null) row.removeAttribute("aria-current");
				else row.setAttribute("aria-current", hadCurrent);
				if (hadFocus === undefined) delete row.dataset.liveFocus;
				else row.dataset.liveFocus = hadFocus;
				return { selectedOnly, ...both };
			});
			check(
				"the ring layers over the selected fill instead of replacing it",
				layered !== null &&
					// The fill the selected row wears is unchanged by the ring…
					layered.background === layered.selectedOnly &&
					// …and the ring is drawn as a shadow over it, inset and outer.
					layered.shadow.includes("inset"),
				layered === null
					? "no navigation row to test"
					: `selected ${layered.selectedOnly}, selected+ringed ${layered.background}; shadow ${layered.shadow.includes("inset") ? "layered" : "not inset"}`,
			);
		}

		check(
			"the rail's own button is still walkable — it is not a tab",
			railReached !== null && landedOnRail,
			railReached === null
				? "no rail button on this panel"
				: `walked to ${railReached}: ${landedOnRail}`,
		);

		{
			// **The same panel, changing what it has.** The block below turns to a
			// *different* console, so the scope element changes and the hint is
			// rebuilt for that reason alone — it passed with the text left out of
			// the identity entirely. This walks the left console's own tabs
			// instead: same `aside`, and Communications draws nothing focusable
			// where Navigation draws chips and rows.
			//
			// **What this does NOT cover, stated rather than implied.** Sage's
			// round-5 finding was that the hint goes stale while the *scope
			// element* is unchanged, and keying the early return on the text as
			// well as the element is the fix. This check cannot exercise that,
			// and neither could two earlier attempts: a tab switch replaces the
			// panel's markup, so the element changes and the guard never bites;
			// and filtering the Navigation list to no matches leaves the kind
			// chips, which are focusable, so the walk never reaches zero. No way
			// to hold one element while its walk crosses zero was found. The fix
			// is kept as cheap insurance and is **unverified by this tier** —
			// what is checked here is the weaker, real property that the hint
			// follows a surface's contents rather than its name.
			// **Every tab, counted off the page, so the walk ends back on Navigation.**
			// This was a literal 4; #408 added a fifth tab and the loop stopped on it,
			// which has nothing to walk, and the next check found no landings.
			const tabCount = await page.evaluate(
				() =>
					document.querySelectorAll('[data-live-panel="left"] .lc-tab').length,
			);
			const perTab = [];
			for (let i = 0; i < tabCount; i++) {
				// **Settled before it is read.** A tab tap repaints the panel and its
				// hint on later frames, and a read straight after the tap caught a
				// Galaxy Map with 13 targets and the previous hint under suite load
				// (#843, also once on #823). Wait for the tab, the hint and the walk
				// count to hold for three frames, not for the answer the check wants.
				await page.evaluate(
					() =>
						new Promise((resolve) => {
							const read = () =>
								JSON.stringify([
									document.querySelector("[data-live-cockpit]")?.dataset
										.liveLeftView,
									document.querySelector("[data-live-pad-hint]")?.textContent ??
										null,
									document.querySelectorAll('[data-live-panel="left"] *')
										.length,
								]);
							const until = performance.now() + 3000;
							let last = read();
							let same = 0;
							const step = () => {
								const now = read();
								same = now === last ? same + 1 : 0;
								last = now;
								if (same >= 3 || performance.now() > until) resolve();
								else requestAnimationFrame(step);
							};
							requestAnimationFrame(step);
						}),
				);
				const seen = await page.evaluate(() => ({
					tab: document.querySelector("[data-live-cockpit]").dataset
						.liveLeftView,
					hint:
						document.querySelector("[data-live-pad-hint]")?.textContent ?? null,
					// Requests always has its Current and Past tabs to walk (node
					// #690), so an empty board is no longer an empty walk.
					walkable: document.querySelectorAll(
						'[data-live-panel="left"] [data-live-request-action],' +
							'[data-live-panel="left"] [data-live-nav-target],' +
							'[data-live-panel="left"] [data-live-nav-kind],' +
							'[data-live-panel="left"] [data-live-left-tab]:not(.lc-tab),' +
							'[data-live-panel="left"] [data-map-haze],' +
							'[data-live-panel="left"] [data-map-course],' +
							'[data-live-panel="left"] [data-map-clear],' +
							'[data-live-panel="left"] [data-map-finder-economy],' +
							'[data-live-panel="left"] [data-map-finder-budget-down],' +
							'[data-live-panel="left"] [data-map-finder-budget-up],' +
							'[data-live-panel="left"] [data-map-finder-row],' +
							'[data-live-panel="left"] [data-map-finder-centre]',
					).length,
				}));
				perTab.push(seen);
				await tap(B.r1);
			}
			const empty = perTab.filter((t) => t.walkable === 0);
			const full = perTab.filter((t) => t.walkable > 0);
			check(
				"the hint names what a surface has, not what surface it is",
				empty.length > 0 &&
					full.length > 0 &&
					empty.every((t) => !(t.hint ?? "").includes("WALK")) &&
					full.every((t) => (t.hint ?? "").includes("WALK")),
				perTab
					.map(
						(t) =>
							`${t.tab}:${t.walkable}:${(t.hint ?? "").includes("WALK") ? "walk" : "no-walk"}`,
					)
					.join(" "),
			);
		}

		{
			// **A panel with nothing to walk still says it has the pad.** The
			// marker was gated on the walk being non-empty, and this branch had
			// just created the empty-walk surfaces by taking the tab rows out of
			// the cursor — so turning to starboard undocked suspended the sticks
			// and the mouse with nothing on screen saying why. Sage found it.
			await tap(B.right);
			const starboard = await page.evaluate(() => {
				const scope = document.querySelector('[data-live-pad-scope="true"]');
				const hint = document.querySelector("[data-live-pad-hint]");
				const walkable = document.querySelectorAll(
					'[data-live-panel][data-active="true"] [data-live-nav-target],' +
						'[data-live-panel][data-active="true"] [data-live-station-action],' +
						'[data-live-panel][data-active="true"] [data-live-nav-kind]',
				).length;
				return {
					marked: scope?.getAttribute("data-live-panel") ?? null,
					hint: hint?.textContent ?? null,
					walkable,
				};
			});
			await tap(B.left);
			check(
				"a panel with nothing to walk still says it holds the pad, and drops only the WALK",
				starboard.marked === "right" &&
					(starboard.walkable > 0 || !(starboard.hint ?? "").includes("WALK")),
				`marked ${starboard.marked}, ${starboard.walkable} walkable, hint: ${starboard.hint ?? "none"}`,
			);
		}

		{
			// **The settings screen holds the whole pad, so no console may claim
			// it.** The console stays visible through settings' own scrim, and
			// the marker was gated on the panel being *drawn* rather than on it
			// holding anything — so it went on saying "the d-pad walks me" while
			// `modal` had the lot. Sage called this half of the blocker, with
			// this exact repro; neither context had a probe.
			//
			// The mount is what makes the key live, so the answer is a row and the
			// press is conditional on it: driving `z` at a screen that never
			// arrived reports a console that claims the pad, which is #418's
			// misreading in this file's clothes. What the wait measures is
			// `waitForSettingsPanel`'s to say.
			const settingsMounted = await waitForSettingsPanel(page);
			check(
				"the settings screen is mounted before its key is driven",
				settingsMounted,
			);
			if (settingsMounted) {
				await page.keyboard.press("z");
			}
			await frames(3);
			const underModal = await page.evaluate(() => ({
				settings: Boolean(document.querySelector("[data-settings-panel]")),
				marked: document.querySelector('[data-live-pad-scope="true"]') !== null,
				hint: document.querySelector("[data-live-pad-hint]") !== null,
			}));
			if (underModal.settings) {
				await page.keyboard.press("z");
			}
			await frames(3);
			const afterClose = await page.evaluate(
				() => document.querySelector('[data-live-pad-scope="true"]') !== null,
			);
			check(
				"a console does not claim the pad while the settings screen holds it",
				settingsMounted &&
					underModal.settings === true &&
					underModal.marked === false &&
					underModal.hint === false &&
					afterClose === true,
				`mounted ${settingsMounted}: settings open ${underModal.settings}; marked ${underModal.marked}, hint ${underModal.hint}; marked again after closing ${afterClose}`,
			);
		}

		check(
			"the panel holding the pad says so, and carries the hint line",
			marked.scope === "left" &&
				marked.hintIn === "left" &&
				(marked.hint ?? "").includes("WALK"),
			`scope ${marked.scope}, hint in ${marked.hintIn}: ${marked.hint ?? "none"}`,
		);
	}

	{
		// **Walk it, and read what the ring lands on.** The first version of this
		// check counted DOM matches for two selectors of its own and asserted
		// both were non-zero while its message said "none of them in the walk" —
		// it never moved the cursor, restated `OWN_FOCUSABLE` in the probe, and
		// passed identically against the build where tabs *were* walked. Sage
		// found it; it was not one of the checks this branch built red-first, and
		// it was the only one covering the finding it was written for.
		const landings = [];
		for (let i = 0; i < WALK_CAP; i++) {
			await tap(B.down);
			const on = await page.evaluate(() => {
				const el = document.querySelector("[data-live-focus]");
				return el ? { tab: el.matches(".lc-tab") } : null;
			});
			if (on) landings.push(on);
			// Break on the first tab, as every other walk in this file does: the
			// property has failed by then, and forty round trips to re-confirm it
			// is forty frame waits nobody reads.
			if (on?.tab) break;
		}
		check(
			"the cursor never lands on a tab — they have the shoulders instead",
			landings.length > 0 && landings.every((on) => !on.tab),
			`${landings.length} landings over ${WALK_CAP} presses, ${landings.filter((on) => on.tab).length} of them on a tab`,
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
		// **R1, not a walk to the tab row.** The cursor no longer walks tabs —
		// they have the shoulders, and passing through them to reach a list was
		// the principal's "the cursor order is surprising". So the way onto the
		// chart is the control a player would use.
		let tab = null;
		for (let i = 0; i < 4; i++) {
			await tap(B.r1);
			const now = await page.evaluate(
				() =>
					document.querySelector("[data-live-cockpit]").dataset.liveLeftView,
			);
			if (now === "Galaxy Map") {
				tab = now;
				break;
			}
		}
		// The chart is a dynamic import. Without this the focus list has no
		// foreign rows on it and every check below would pass vacuously.
		const mounted = await page
			.waitForFunction(() => Boolean(window.__seeliteGalaxyMap), null, {
				timeout: 30000,
			})
			.then(() => true)
			.catch(() => false);
		check(
			"R1 onto the Galaxy Map tab mounts the chart",
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

		{
			// **A docked mouse must not bank its delta.** The flight tail is what
			// consumes it, and the docked path returns above that — so a pointer
			// moved at the station console accumulated for the session and landed
			// as a full kick on the first frame after launch. Sage found it, and
			// the comment claiming the delta was consumed was the giveaway.
			const banked = await page.evaluate(async () => {
				const g = window.__seelite;
				g.mouseDx = 900;
				g.mouseDy = 900;
				await window.__frames(3);
				return { dx: g.mouseDx, dy: g.mouseDy };
			});
			check(
				"a pointer moved while docked is consumed, not banked for the launch",
				banked.dx === 0 && banked.dy === 0,
				`mouseDx ${banked.dx}, mouseDy ${banked.dy} after three docked frames`,
			);
		}

		{
			// The station console is reached docked with the head forward, so it
			// has no back — `back` would turn a forward head forward. Promising
			// "B BACK" there names a button that does nothing. Sage found it.
			const hint = await page.evaluate(() => {
				const el = document.querySelector("[data-live-pad-hint]");
				const inStation = el?.closest("[data-live-station-console]") !== null;
				return { text: el?.textContent ?? null, inStation };
			});
			check(
				"the station console's hint does not promise a back it has not got",
				hint.inStation === true &&
					(hint.text ?? "").includes("WALK") &&
					!(hint.text ?? "").includes("BACK"),
				`in station ${hint.inStation}: ${hint.text ?? "none"}`,
			);
		}

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

		// **After the purchase check, not before it.** Both of the checks below
		// spend credits, and running them first left the commander too poor to
		// buy anything — so "Cross on a BUY row buys something" went red for a
		// reason that was not the pad, and the scroll check below stopped
		// exercising a rebuild at all because a refused purchase redraws nothing.
		//
		// **A mouse click must move the ring the pad walks**, even when the click
		// rebuilds the rows. Round 1 read the clicked element's identity *after*
		// dispatching, and a purchase detaches it — so the sync silently found
		// nothing and the next Cross bought the previously-ringed commodity.
		// Sage reproduced exactly that, round 2.
		const clicked = await page.evaluate(() => {
			const rows = [...document.querySelectorAll("[data-live-station-action]")];
			// Not the one under the ring, or the check cannot tell a working sync
			// from a no-op.
			const ringed = document.querySelector("[data-live-focus]");
			const pick = rows.find((el) => el !== ringed);
			if (!pick) return null;
			pick.click();
			return {
				action: pick.dataset.liveStationAction,
				name: pick.dataset.liveStationName,
			};
		});
		await frames(2);
		const ringAfterClick = await focused();
		check(
			"a mouse click moves the ring the pad walks, even when it rebuilds the rows",
			clicked !== null &&
				ringAfterClick !== null &&
				ringAfterClick.stationAction === clicked.action &&
				ringAfterClick.stationName === clicked.name,
			clicked === null
				? "no station row to click"
				: `clicked ${clicked.action} ${clicked.name}; ring on ${ringAfterClick?.stationAction} ${ringAfterClick?.stationName}`,
		);

		// **And a transaction must not leave the ring below the fold.** The
		// rebuild replaces the market element outright — measured at 700x480,
		// `scrollTop` 120 → 0 with `sameElement: false` — so a row the pad had
		// scrolled to and bought came back off screen while Cross went on buying
		// it. Sage found it, round 2.
		//
		// **Every precondition is asserted rather than assumed.** The first two
		// versions of this check passed with the fix removed: one walked twelve
		// blind presses and landed on a tab, where Cross rebuilds nothing, and
		// one landed on a `sell` row with an empty hold, where it transacts
		// nothing. So the walk requires a row that is *below the fold*, and the
		// check requires the credits to have actually moved.
		await page.setViewportSize({ width: 700, height: 480 });
		await frames(2);
		// **Keep going until one actually buys.** A BUY row below the fold is not
		// enough: the commander has 100 Cr, and with the cursor walking content
		// only it landed on Computers, whose price the wallet refused —
		// `credits 100 -> 100`, a check reporting a failure of the pad that was a
		// failure of the purse. Press, read, and walk on if nothing moved.
		let below = null;
		let creditsBefore = 0;
		let creditsAfter = 0;
		for (let i = 0; i < WALK_CAP; i++) {
			const at = await focused();
			const box = await marketScroll();
			if (at?.stationAction === "buy-commodity" && box && box.top > 0) {
				creditsBefore = await page.evaluate(() => window.__seelite.creditsCr);
				await tap(B.a);
				await frames(2);
				creditsAfter = await page.evaluate(() => window.__seelite.creditsCr);
				if (creditsAfter !== creditsBefore) {
					below = { at, box };
					break;
				}
			}
			await tap(B.down);
		}
		const afterBuy = await marketScroll();
		const ringVisible = await page.evaluate(() => {
			const box = document.querySelector(".lc-station-market");
			const el = document.querySelector("[data-live-focus]");
			if (!box || !el) return null;
			const b = box.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
		});
		await page.setViewportSize({ width: 1280, height: 860 });
		await frames(2);
		check(
			"a transaction leaves the ring on screen, not under the fold its rebuild makes",
			below !== null && creditsAfter !== creditsBefore && ringVisible === true,
			below === null
				? `no BUY row below the fold in ${WALK_CAP} presses`
				: `bought ${below.at.stationName} at scrollTop ${below.box.top} → ${afterBuy?.top}; ` +
						`credits ${creditsBefore} → ${creditsAfter}; ring inside the box ${ringVisible}`,
		);
	}

	// --- 6. the settings screen -------------------------------------------

	{
		// Opened from the keyboard. The pad has no binding for it by default;
		// its way in is the `Controls` tab's door since #381 S4, which
		// `probe-derived-names.mjs` reaches on the pad. This row is about what
		// the pad does once the screen is up.
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

		// **The screen scrolls under the cursor.** At 700x480 the last rows sit
		// below the viewport, and the pad has no other way to reach them — a
		// cursor walked onto one changed a setting the player could not see.
		// Sage found it, round 6; the keyboard had the same hole, because a
		// mouse can scroll and nobody had tried without one.
		// **A viewport the dialog does not fit.** `#seelite-settings` is the
		// scroll container and only overflows when the box is taller than the
		// window — at 700x480 all six rows and their notes fit, so the first
		// version of this check reached the last row with nothing to scroll and
		// passed with the fix removed. The overflow is asserted below rather
		// than assumed.
		await page.setViewportSize({ width: 700, height: 320 });
		await frames(2);
		const overflows = await page.evaluate(() => {
			const overlay = document.querySelector("#seelite-settings");
			return overlay ? overlay.scrollHeight > overlay.clientHeight + 1 : false;
		});
		const box = () =>
			page.evaluate(() => {
				// **Against the scroll container, not the box.** `.box` is the
				// thing that overflows, so its own rect contains every row by
				// construction and the check passed with the fix removed.
				// `#seelite-settings` is what has `overflow-y: auto`, and its
				// rect is what the player can actually see.
				const overlay = document.querySelector("#seelite-settings");
				const rows = [...document.querySelectorAll("#seelite-settings .row")];
				const at = rows.findIndex(
					(r) => r.getAttribute("aria-selected") === "true",
				);
				if (!overlay || at === -1) return null;
				const o = overlay.getBoundingClientRect();
				const r = rows[at].getBoundingClientRect();
				return {
					index: at,
					rows: rows.length,
					visible: r.top >= o.top - 1 && r.bottom <= o.bottom + 1,
				};
			});
		// Every row the walk lands on, so one that scrolled out of sight fails
		// the check rather than being averaged away by a later one that did not.
		let lowest = null;
		for (let i = 0; i < 12; i++) {
			await tap(B.down);
			const now = await box();
			if (now && (lowest === null || !now.visible)) lowest = now;
		}
		await page.setViewportSize({ width: 1280, height: 860 });
		await frames(2);
		check(
			"walking the settings screen keeps the selected row on screen",
			overflows &&
				lowest !== null &&
				lowest.index > 0 &&
				lowest.visible === true,
			lowest === null
				? "no selected row found"
				: `dialog overflows ${overflows}; reached row ${lowest.index} of ${lowest.rows}; on screen ${lowest.visible}`,
		);

		// Cross advances the focused row, which is what clicking it does on that
		// screen. The modal branch ignored `activate` entirely, so the one button
		// a pad player reaches for first did nothing. Sage found it, round 5.
		//
		// **The layout is a row too** (#639). The keyboard layout is the
		// screen's last row and is stored with the bindings, not in
		// `settings`, so a walk that lands on it changes a value this read
		// would otherwise not see — the first run of #639 read that as
		// "changed nothing".
		const rowValues = () =>
			page.evaluate(() => ({
				...window.__seelite.settings.value,
				layout: window.__seelite.layoutInForce().base,
			}));
		const beforeCross = await rowValues();
		await tap(B.a);
		const afterCross = await rowValues();
		const crossChanged = Object.keys(beforeCross).filter(
			(k) => beforeCross[k] !== afterCross[k],
		);
		check(
			"Cross advances the focused setting, as clicking the row does",
			crossChanged.length === 1,
			`changed ${crossChanged.join(", ") || "nothing"}`,
		);

		await tap(B.b);
		const closed = await page.evaluate(
			() => !document.querySelector("[data-settings-panel]"),
		);
		check("Circle closes it", closed, `closed ${closed}`);
		// Back to the shipped layout if Cross moved it, so no later page in
		// this browser flies another one.
		await page.evaluate(() => window.__seelite.selectLayout("default"));
	}
} finally {
	await browser.close();
}

exit();
