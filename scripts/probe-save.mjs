/**
 * The save's browser tier (#90), which is owed for two reasons and not the
 * usual one.
 *
 * This is not visual or spatial work, so "anything rendered gets a probe" does
 * not apply. What applies is that **every figure #89 measured was taken under
 * bun**: `serializeWorld` + `JSON.stringify`, no IndexedDB, no transaction, no
 * page. Two of its decisions turn on costs only a browser has.
 *
 * 1. **D1's store.** A real write and read through `indexedDbSaveBackend`, in
 *    the page, at T4 byte scale. Nothing in #89 prices a transaction.
 * 2. **D4's debounce window.** #89 left it to the wire-in explicitly, because
 *    no bun figure can pick it. The ladder below is what turns "a few hundred
 *    milliseconds" into a number, and `SAVE_DEBOUNCE_MS` is checked against
 *    what it measures rather than against a guess.
 *
 * And one the node asked for in its own words: **the market screen showing the
 * changed price on the second visit is the check that the wire is real rather
 * than merely present.** The deficit already survives within a session on
 * `main` — #80 and #275 wired that — so a same-session check proves nothing
 * new. What is new is a **reload**: dock, trade, flush, reopen the page, and
 * read the price back. That row is red on `main` and green here.
 *
 * Every constant is read off `window.__seelite.save` rather than restated. A
 * probe carrying its own copy of the debounce goes falsely red the day the
 * module moves it.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
let context = null;

/** The seed every arm shares, so the two page loads in the reload arm are the
 *  same galaxy and the same station. */
const SEED = 42;

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

try {
	// -----------------------------------------------------------------------
	// D1 and D4: the store, priced in the page
	// -----------------------------------------------------------------------
	// **One context, two pages.** `browser.newPage()` makes its own context, and
	// a context has its own IndexedDB — so a reload arm written with two of them
	// reads an empty store and passes for the wrong reason on any build. This is
	// the same shape as a probe measuring its own assignment being overwritten:
	// the check would look exactly like a working one.
	context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const page = await context.newPage();
	watch(page);
	page.on("console", (m) => {
		if (m.type() === "error") console.log(`  [page] ${m.text()}`);
	});
	page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
	// **Not `?no-save`.** The store has to be live: the reload arm below reads
	// back what this page wrote, and a page booted with saving off would flush
	// nothing and the arm would be inert rather than failing.
	await page.goto(`${ORIGIN}/?seed=${SEED}`, { waitUntil: "load" });
	await bootedGame(page);

	const store = await page.evaluate(async () => {
		const save = window.__seelite.save;
		const live = window.__seelite.saveEnvelope();
		// **A T4-scale blob, built by growing the live save's own deficit map.**
		// The transaction's cost is about bytes rather than about what the bytes
		// mean, and the *parse* cost is the bun figure
		// `scripts/measure-save-size.ts` already prints — so this arm prices the
		// store and says so, rather than pretending to re-measure the model.
		const blob = JSON.parse(JSON.stringify(save.serialize(live)));
		const env = blob.world.galaxies[0];
		const row = { goods: {}, updatedAt: 0 };
		for (const name of ["Food", "Textiles", "Radioactives", "Furs", "Alloys"])
			row.goods[name] = -63.4;
		// **Grown until the bytes reach T4's, not until a row count matches
		// it.** T4 is 419 *carriers* with four saturated domains each; padding
		// 419 single-domain rows gave 53 KiB under a comment calling that
		// T4-scale, which is a figure invented in prose. The store's cost is
		// about bytes, so bytes are what this grows to: T4's 1379 KiB UTF-16 is
		// about 706 KiB of JSON characters, and the loop stops when it arrives.
		const T4_JSON_CHARS = 706 * 1024;
		for (let i = 0; JSON.stringify(blob).length < T4_JSON_CHARS; i++)
			for (let j = 0; j < 200; j++)
				env.deficits[`${i * 200 + j}:station-trade`] = {
					goods: { ...row.goods },
					updatedAt: 0,
				};
		const bytes = JSON.stringify(blob).length;
		const writes = [];
		const reads = [];
		for (let i = 0; i < 12; i++) {
			const t0 = performance.now();
			await save.backend.write("probe", "live", blob);
			const t1 = performance.now();
			await save.backend.read("probe", "live");
			reads.push(performance.now() - t1);
			writes.push(t1 - t0);
		}
		const back = await save.backend.read("probe", "live");
		return {
			bytes,
			writes,
			reads,
			debounceMs: save.debounceMs,
			dbName: save.dbName,
			roundTripped:
				JSON.stringify(back) === JSON.stringify(blob) &&
				Object.keys(back.world.galaxies[0].deficits).length ===
					Object.keys(env.deficits).length,
		};
	});

	const writeMs = median(store.writes);
	const readMs = median(store.reads);
	console.log(
		`\nIndexedDB at ${(store.bytes / 1024).toFixed(0)} KiB of JSON, ${store.writes.length} runs:`,
	);
	console.log(
		`  write median ${writeMs.toFixed(1)} ms, range ${Math.min(...store.writes).toFixed(1)}–${Math.max(...store.writes).toFixed(1)}`,
	);
	console.log(
		`  read  median ${readMs.toFixed(1)} ms, range ${Math.min(...store.reads).toFixed(1)}–${Math.max(...store.reads).toFixed(1)}`,
	);
	console.log(`  debounce window declared: ${store.debounceMs} ms`);

	check(
		"a save at T4 byte scale survives a real IndexedDB write and read",
		store.roundTripped,
		`${(store.bytes / 1024).toFixed(0)} KiB, db ${store.dbName}`,
	);
	check(
		"the debounce window is above the worst write this machine did",
		store.debounceMs > Math.max(...store.writes),
		`window ${store.debounceMs} ms against a worst write of ${Math.max(...store.writes).toFixed(1)} ms`,
	);
	// **A band, not a floor.** A window far above the write is not free either —
	// it is the bounded loss on a tab close, and #89 accepts one window of it.
	check(
		"and not more than an order of magnitude above the median",
		store.debounceMs < Math.max(20, writeMs) * 50,
		`window ${store.debounceMs} ms against a median write of ${writeMs.toFixed(1)} ms`,
	);

	// -----------------------------------------------------------------------
	// The wire is real: a price that changed survives a reload
	// -----------------------------------------------------------------------
	const trade = await page.evaluate(
		async ([targetSeed]) => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			// **The ship starts an AU from any station** — the arrival point is near
			// the star and a station orbits a planet, measured here at 171 Mkm. The
			// player crosses that in cruise (#10); a probe about the *save* has no
			// business re-flying a cruise leg, so the ship is parked within the
			// docking computer's reach the way `probe-docking.mjs` parks one, and
			// the autopilot flies the part that matters.
			const station =
				g.world.system.contents.stations.find((s) => s.spinRpm > 0) ??
				g.world.system.contents.stations[0];
			const body = g.world.system.byId.get(station.id);
			const vel = g.stationVelocity(station.id);
			g.world.ship.pos = {
				x: body.pos.x + 20,
				y: body.pos.y + 20,
				z: body.pos.z + 20,
			};
			g.world.ship.vel = { x: vel.x, y: vel.y, z: vel.z };
			g.regime = "normal";
			g.setThrottle(0);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			// **Clearance first.** #147 made a grant a berth reservation and the
			// docking computer refuses without one — it reported
			// `computerRefusal: "no-clearance"` and never engaged, which looks from
			// outside exactly like an autopilot that cannot fly.
			g.requestDockingClearance();
			g.toggleDockingComputer();
			// **Stepped, not rendered.** The docking computer is sim logic and needs
			// no frame; rendering every step put a full SwiftShader frame on each of
			// thousands of iterations and the probe simply did not finish. One frame
			// a second keeps whatever the renderer feeds back — the layer handoff,
			// the interior build — without paying for the rest.
			const perSecond = Math.max(1, Math.round(1 / dt));
			let frames = 0;
			for (let i = 0; i < perSecond * 900 && !g.dockedAt; i++) {
				g.step(dt);
				if (i % perSecond === 0) {
					g.render(dt);
					frames++;
				}
			}
			g.render(dt);
			if (!g.dockedAt)
				return {
					docked: false,
					seed: targetSeed,
					frames,
					snapshot: g.dockingSnapshot(station.id),
				};
			// `stationMarketScreen` returns the row array itself, and a row names its
			// commodity by object rather than by a `name` string. Guessed wrong once
			// — and a probe that reads `undefined` off a row reports `null → null`,
			// which looks exactly like a market that did not move.
			const priceOf = () =>
				g
					.stationConsoleState()
					?.market?.find((r) => r.commodity?.name === "Food") ?? null;
			const before = priceOf();
			// Straight at the private entry point, the way every other probe here
			// reaches `dockingStates` and `resetDock`. Routing a click through the
			// console's DOM would be testing the console, which has its own probe.
			let bought = 0;
			for (let i = 0; i < 40; i++) {
				const credits = g.commanderRecord().state.credits;
				g.transactStation({ type: "buy-commodity", commodity: "Food" });
				if (g.commanderRecord().state.credits === credits) break;
				bought++;
			}
			const after = priceOf();
			return {
				docked: true,
				frames,
				bought,
				station: g.dockedAt,
				before: before
					? { priceCr: before.priceCr, quantity: before.quantity }
					: null,
				after: after
					? { priceCr: after.priceCr, quantity: after.quantity }
					: null,
				credits: g.commanderRecord().state.credits,
				cargo: g.commanderRecord().state.cargo,
			};
		},
		[SEED],
	);

	check(
		"the docking computer reaches a berth, so there is a market to trade in",
		trade.docked,
		JSON.stringify(trade),
	);

	if (trade.docked) {
		check(
			"buying moves the price on the same visit",
			trade.before !== null &&
				trade.after !== null &&
				trade.after.priceCr > trade.before.priceCr,
			`${JSON.stringify(trade.before)} → ${JSON.stringify(trade.after)} after ${trade.bought} buys`,
		);

		// The dock flush already fired when the plane was crossed, and the trade
		// is on the debounce. Wait past the window so the live record carries it.
		await page.waitForTimeout(store.debounceMs + 200);
		// **Await the store, do not sleep at it.** The first version waited a
		// window and read: the trade's debounced write was queued behind the
		// dock flush's transaction — ~220 ms each in this browser — and the read
		// landed between them. It reported an empty deficit map, which is
		// exactly what a broken wire reports.
		//
		// That is worth more than a probe fix. `saveFlush` is fire-and-forget by
		// construction, so **the `pagehide` flush is best-effort**: a browser
		// that tears the page down before the transaction completes loses that
		// write. #89 already accepts a loss of one debounce window and states
		// that permadeath is not enforced on a tab close; this is the same class
		// of gap rather than a new one, and closing it is not possible with an
		// async store.
		const flushed = await page.evaluate(async () => {
			const g = window.__seelite;
			if (!g.saveStore) return { store: false };
			g.saveFlush("quit");
			await g.saveStore.settled();
			return { store: true };
		});
		// A missing store must read as a red row rather than as an exception:
		// the build with no store is the red case this arm exists to catch, and
		// a probe that crashes on it reports nothing a reader can act on.
		check("the page boots with a live save store", flushed.store === true);

		// **Close the first page before opening the second.** It is a running
		// game: its rAF loop keeps drawing, and a second boot alongside it timed
		// out at 20 s. The context survives the close, which is what carries the
		// IndexedDB to the reload.
		await page.close();
		const reloaded = await context.newPage();
		watch(reloaded);
		await reloaded.goto(`${ORIGIN}/?seed=${SEED}`, { waitUntil: "load" });
		await bootedGame(reloaded);
		const after = await reloaded.evaluate(
			([station]) => {
				const g = window.__seelite;
				const key = `${g.world.system.record.index}:${
					g.world.system.contents.stations.find((s) => s.id === station)
						?.localCarrierId ?? ""
				}`;
				const env =
					g.saveEnvelope().world.galaxies[g.world.system.record.galaxy];
				return {
					fault: g.saveFault,
					gameTime: g.saveEnvelope().world.gameTime,
					deficitKeys: Object.keys(env.deficits),
					food: env.deficits[key]?.goods?.Food ?? null,
					galaxy: g.world.system.record.galaxy,
					system: g.world.system.record.index,
				};
			},
			[trade.station],
		);

		console.log(`\nafter a reload: ${JSON.stringify(after)}`);
		check(
			"the reloaded page loaded the save rather than reporting a fault",
			after.fault === null,
			String(after.fault),
		);
		check(
			"the market's memory of the player survived the reload",
			after.food !== null && after.food > 0,
			`Food deficit ${after.food} over keys ${after.deficitKeys.length}`,
		);
		// **The clock came back with it, in seconds.** The defect this node
		// opened on wrote it in minutes, which nothing in a session can see.
		check(
			"and the world clock came back in seconds, not minutes",
			after.gameTime > 60,
			`clock ${after.gameTime}`,
		);
		await reloaded.close();
	} else {
		await page.close();
	}
} finally {
	await context?.close();
	await browser.close();
}
exit();
