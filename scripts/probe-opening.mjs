/** Opening state contract: skip, save/resume, bypass, fallback and held repeatability.
 * Watched shots and camera geometry live in probe-opening-cinematic.mjs. */
import { bootedGame, launchChromium, tally } from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { openingFixture } from "./lib/opening-probe.mjs";
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const {
		origin,
		out,
		SEED,
		endState,
		lastDocked,
		tradeKey,
		boot,
		untilOver,
		holdToShot,
		same,
		differing,
		trade,
		skippedEnd,
		skippedRecord,
	} = await openingFixture({ browser, check, watch });
	// ---------------------------------------------------------------------------
	// Guided, skipped by the key halfway through
	// ---------------------------------------------------------------------------

	const midway = await boot({ guided: true, cinematic: 1 }, "guided midway");
	// The Enter row tests that the skip works *during* the cruise shot, not that the
	// wall clock reaches it (#882).
	const midwayShot = await holdToShot(midway.page, "cruise");
	await midway.page.keyboard.press("Enter");
	await untilOver(midway.page, 10000);
	const midwayEnd = await endState(midway.page);
	check(
		"Enter during the cruise shot skips to the same state (D2)",
		midwayShot === "cruise" && same(midwayEnd, skippedEnd),
		`held on ${midwayShot} — ${differing(midwayEnd, skippedEnd) || "identical"}`,
	);
	await midway.context.close();

	// ---------------------------------------------------------------------------
	// Guided, skipped by a click: the mouse is always available (#370)
	// ---------------------------------------------------------------------------

	const clicked = await boot({ guided: true, cinematic: 1 }, "guided clicked");
	// Held rather than waited for, and released at once: the click has to land on a
	// live frame with the pointer free, which is what #370 is about (#882).
	const clickedShot = await holdToShot(clicked.page, "flypast", 0.5);
	const hint = await clicked.page.evaluate(() => {
		const skip = document.querySelector("[data-opening-skip]");
		const box = skip?.getBoundingClientRect();
		return {
			text: skip?.textContent ?? null,
			visible: skip?.checkVisibility() ?? false,
			x: box ? box.x + box.width / 2 : 0,
			y: box ? box.y + box.height / 2 : 0,
			pointerLocked: document.pointerLockElement !== null,
			names: window.__seelite.bindings
				.filter((b) => b.command === "dock.launch")
				.map((b) => b.trigger.kind),
		};
	});
	check(
		"SKIP names every trigger the skip has, the pad's among them, and the pointer is free",
		hint.visible &&
			hint.names.includes("key") &&
			hint.names.some((k) => k !== "key") &&
			(hint.text?.split(" or ").length ?? 0) >= hint.names.length &&
			!hint.pointerLocked,
		JSON.stringify(hint),
	);
	// A real pointer event at the control's place, not a synthetic element.click(),
	// which reaches a control a locked pointer could not (#370, #371).
	await clicked.page.mouse.click(hint.x, hint.y);
	await untilOver(clicked.page, 10000);
	const clickedEnd = await endState(clicked.page);
	check(
		"a click on SKIP skips to the same state (D2)",
		clickedShot === "flypast" && same(clickedEnd, skippedEnd),
		`held on ${clickedShot} — ${differing(clickedEnd, skippedEnd) || "identical"}`,
	);
	await clicked.context.close();

	// ---------------------------------------------------------------------------
	// A quit during the opening: the rest is flown on load (the principal's
	// ruling, 2026-09-26), so a guided start still docks
	// ---------------------------------------------------------------------------

	for (const shot of ["cruise", "dock"]) {
		const quit = await boot({ guided: true, cinematic: 1 }, `quit at ${shot}`);
		// Held on the shot, and it stays held: this row quits *from* the shot, so the
		// clock has nothing to give back (#882).
		const heldShot = await holdToShot(quit.page, shot, 1, { release: false });
		const saved = await quit.page.evaluate(async () => {
			const g = window.__seelite;
			await g.saveFlush("quit");
			const b = g.save.backend;
			const live = await b.read("default", "live");
			return {
				regime: live?.commander?.flight?.regime ?? null,
				dockedAt: live?.commander?.dockedAt ?? null,
				lastDocked: (await b.read("default", "lastDocked")) !== null,
			};
		});
		// The same save, booted again: a loaded commander, not a new game.
		await quit.page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
		await bootedGame(quit.page);
		const resumed = await quit.page.evaluate(() => {
			const g = window.__seelite;
			return {
				outcome: g.openingReading().lastOutcome,
				dockPhase: g.dockPhase,
				stationId: g.dock.stationId,
				firstDay: g.firstDay,
			};
		});
		const record = await lastDocked(quit.page);
		// Which way it docks is named, not either-or (sage round 1 on #536): from
		// mid-cruise the rest is flown; on the run-in, a cruise that close is
		// refused and #530 D6's fallback places the ship.
		const expected = shot === "cruise" ? "docked" : "fallback";
		check(
			shot === "cruise"
				? "a quit in the fly-by saves in flight, and the reload flies the opening again from there and docks with lastDocked"
				: "a quit on the run-in saves in flight, and the reload falls back to the placement and docks with lastDocked",
			saved.dockedAt === null &&
				!saved.lastDocked &&
				heldShot === shot &&
				resumed.outcome === expected &&
				resumed.dockPhase === "docked" &&
				resumed.stationId === trade.id &&
				record?.dockedAt === trade.key,
			JSON.stringify({ heldShot, saved, resumed, record }),
		);
		await quit.context.close();
	}

	// ---------------------------------------------------------------------------
	// Boots that see no sequence
	// ---------------------------------------------------------------------------

	for (const [label, params] of [
		["?boot=direct", {}],
		["?system=", { system: 3 }],
	]) {
		const quiet = await boot(params, `free ${label}`);
		const r = await quiet.page.evaluate(() => {
			const g = window.__seelite;
			return {
				reading: g.openingReading(),
				gameTime: g.world.gameTime,
				speed: Math.hypot(
					g.world.ship.vel.x,
					g.world.ship.vel.y,
					g.world.ship.vel.z,
				),
			};
		});
		check(
			`a free ${label} boot has no opening and starts at rest, clock near zero`,
			r.reading.kind === null &&
				r.reading.lastOutcome === null &&
				r.gameTime < 5 &&
				r.speed < 1e-9,
			JSON.stringify({ ...r, reading: r.reading.lastOutcome }),
		);
		await quiet.context.close();
	}

	const pinned = await boot({ guided: true, system: 3 }, "guided ?system=");
	const pinnedEnd = await endState(pinned.page);
	check(
		"a guided ?system= boot flies in unseen, as ?boot=direct does",
		pinnedEnd.outcome === "docked" &&
			JSON.parse(pinnedEnd.dock).phase === "docked",
		JSON.stringify({ ...pinnedEnd, dock: undefined, orientation: undefined }),
	);
	await pinned.context.close();

	// ---------------------------------------------------------------------------
	// No interdiction, and the fallback
	// ---------------------------------------------------------------------------

	const raided = await boot({ guided: true, raider: "1" }, "guided raider");
	const raidedEnd = await raided.page.evaluate(() => {
		const g = window.__seelite;
		return {
			outcome: g.openingReading().lastOutcome,
			encounter: g.encounter?.phase ?? null,
			dockPhase: g.dockPhase,
		};
	});
	check(
		"with a raider on every leg, none interdicts the opening's cruise (D6)",
		raidedEnd.outcome === "docked" &&
			raidedEnd.encounter === null &&
			raidedEnd.dockPhase === "docked",
		JSON.stringify(raidedEnd),
	);
	await raided.context.close();

	const failing = await boot({}, "fallback");
	const fallback = await failing.page.evaluate(() => {
		const g = window.__seelite;
		// A drive that refuses every engage, as an empty tank does.
		g.engageCruise = () => {};
		g.beginOpening("guided", false);
		return {
			outcome: g.openingReading().lastOutcome,
			dockPhase: g.dockPhase,
			regime: g.regime,
			spooling: g.spoolLeftS > 0,
			computer: g.dockingComputer.engaged,
			stationId: g.dock.stationId,
		};
	});
	check(
		"a flight that cannot cruise falls back to the placement, and docks (D6)",
		fallback.outcome === "fallback" &&
			fallback.dockPhase === "docked" &&
			fallback.stationId === trade.id &&
			fallback.regime === "normal" &&
			!fallback.spooling,
		JSON.stringify(fallback),
	);
	await failing.context.close();

	// ---------------------------------------------------------------------------
	// The phase handle lands on the same step every time (the strip's premise)
	// ---------------------------------------------------------------------------

	const holds = [];
	for (let i = 0; i < 2; i++) {
		const held = await boot({ guided: true, cinematic: "held" }, `held ${i}`);
		holds.push(
			await held.page.evaluate(async () => {
				const g = window.__seelite;
				const start = g.openingReading();
				g.holdOpening("dock", 1);
				// Frames drawn while held step nothing.
				await new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				);
				const r = g.openingReading();
				const p = g.world.ship.pos;
				return {
					startHeld: start.held && start.steps === 0,
					shot: r.shot,
					steps: r.steps,
					gameTime: g.world.gameTime,
					pos: [p.x, p.y, p.z],
				};
			}),
		);
		await held.context.close();
	}
	check(
		"?cinematic=held starts held, and a hold at a shot lands on the same step twice",
		holds.every((h) => h.startHeld && h.shot === "dock") &&
			same(holds[0], holds[1]),
		JSON.stringify(holds.map((h) => ({ steps: h.steps, t: h.gameTime }))),
	);

	console.log(`captures: ${out}`);
} finally {
	await browser.close();
}
exit();
