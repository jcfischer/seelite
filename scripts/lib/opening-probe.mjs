/** Shared fixture and skipped-run baseline for both opening contracts. */
import { mkdirSync } from "node:fs";
import { bootedGame, guardedOrigin } from "../probe-guard.mjs";
import { gameUrl } from "./game-url.mjs";

export async function openingFixture({ browser, check, watch }) {
	const ORIGIN =
		process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
	const out = process.env.OPENING_EVIDENCE ?? "/tmp/seelite-535-evidence";
	mkdirSync(out, { recursive: true });
	const origin = await guardedOrigin(ORIGIN);

	/** The strip's seed (#530 "How it is judged"). */
	const SEED = 47;

	/**
	 * Everything a run's end is judged on, as the game recorded it the moment the
	 * opening ended — before the clock ran on. A watched run and a skipped one owe
	 * equality on every field. (Read later, the two differ by however long each
	 * page sat docked with the clock running, which is not the opening's.)
	 */
	const endState = (page) =>
		page.evaluate(() => {
			const g = window.__seelite;
			return {
				...g.openingEnd,
				outcome: g.openingReading().lastOutcome,
				stationLog: g.firstDayLog.length,
			};
		});

	/** The `lastDocked` record's two fields this node owes, once it lands. */
	const lastDocked = (page) =>
		page.evaluate(async () => {
			const backend = window.__seelite.save.backend;
			for (let i = 0; i < 100; i++) {
				const record = await backend.read("default", "lastDocked");
				if (record)
					return {
						dockedAt: record.commander.dockedAt,
						firstDay: record.commander.firstDay,
					};
				await new Promise((r) => setTimeout(r, 100));
			}
			return null;
		});

	const tradeKey = (page) =>
		page.evaluate(() => {
			const g = window.__seelite;
			const trade = g.world.system.contents.stations.find(
				(s) => s.type === "trade",
			);
			return { id: trade.id, key: g.stationKey(trade) };
		});

	/** A fresh context per boot, so no save carries from one row to the next. */
	async function boot(params, label) {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
		});
		const page = await context.newPage();
		watch(page, label);
		await page.goto(gameUrl(origin, { seed: SEED, raider: "off", ...params }));
		// This fixture measures opening state, not the asynchronously baked sky.
		await bootedGame(page, 20000, { sky: false });
		return { context, page };
	}

	const untilOver = (page, timeout = 120000) =>
		page.waitForFunction(() => !window.__seelite.openingActive, null, {
			timeout,
			polling: 250,
		});

	/**
	 * Run the opening on to `shownS` seconds into `shot`, and stop there (#882).
	 *
	 * The game's own phase handle rather than a clock the probe made up:
	 * `holdOpening` steps the script at `OPENING.dtS` — the one step it is flown at,
	 * watched or skipped — so it arrives at a shot in milliseconds instead of the
	 * 10–37 s of wall clock a frame-driven run spends getting there. The rows that
	 * only need to *be on* a shot were paying that wait for nothing.
	 *
	 * `release` hands the frames back, so a key pressed after it still goes down on a
	 * real frame. The control on this substitution is the row's own comparison: **the
	 * Enter row and the SKIP row still compare their end state with the skipped run's**,
	 * so a hold that changed the run would surface there rather than pass quietly. The
	 * two quit rows cannot make that comparison — their claim is what a save taken
	 * mid-shot and a reload carry, so they assert the fields that say so, and each now
	 * asserts the shot the hold actually landed on.
	 *
	 * `{ release: false }` stays held, for a row that quits on the shot and never
	 * flies on from it — giving the clock back there would only drift off the shot it
	 * is naming.
	 */
	const holdToShot = (page, shot, shownS = 1, { release = true } = {}) =>
		page.evaluate(
			async ([s, at, back]) => {
				const g = window.__seelite;
				g.holdOpening(s, at);
				// Which shot the script is on after the hold. Since #882 a step can end the
				// shot before the aim is reached, and `capture-views.mjs` reads the same
				// thing back for the same reason: a row that names a shot in its title has to
				// know it got that one, because the end state it compares matches the skipped
				// run whatever shot the hold happened to reach.
				const landed = g.openingReading().shot;
				if (back) g.holdOpening(null);
				return landed;
			},
			[shot, shownS, release],
		);

	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	const differing = (a, b) =>
		Object.keys(a)
			.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
			.map((k) => `${k}: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`)
			.join("; ");

	// ---------------------------------------------------------------------------
	// Guided, skipped at boot: what every ?boot=direct probe now starts from
	// ---------------------------------------------------------------------------

	const skipped = await boot({ guided: true }, "guided skipped");
	const trade = await tradeKey(skipped.page);
	const skippedEnd = await endState(skipped.page);
	check(
		"a guided direct boot flies in and docks at the trade station, unseen",
		JSON.parse(skippedEnd.dock).phase === "docked" &&
			skippedEnd.outcome === "docked" &&
			JSON.parse(skippedEnd.dock).stationId === trade.id,
		JSON.stringify({ ...skippedEnd, dock: undefined, orientation: undefined }),
	);
	check(
		"its clock is the whole flight's, not the old placement's run-in",
		skippedEnd.gameTime > 120,
		`${skippedEnd.gameTime.toFixed(1)} s`,
	);
	const skippedRecord = await lastDocked(skipped.page);
	check(
		"that dock writes lastDocked, guided, at the trade station",
		skippedRecord?.dockedAt === trade.key &&
			skippedRecord?.firstDay === "guided",
		JSON.stringify(skippedRecord),
	);
	// The overlay is mounted only by a watched opening, so a skipped boot must
	// never have mounted it. Read after the end, a hidden overlay would pass
	// whether or not the boot was filmed (sage round 2 on #536).
	check(
		"no frame of it was shown: the opening's frame was never mounted",
		await skipped.page.evaluate(
			() => document.querySelector("[data-opening]") === null,
		),
	);
	await skipped.context.close();

	return {
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
	};
}
