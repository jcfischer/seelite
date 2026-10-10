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
import { gameUrl, workbenchUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
let context = null;
/** The contexts §11.4's rows open, each with its own IndexedDB — closed in the
 *  `finally` whatever row they stopped on. */
const extraContexts = [];

/**
 * The seed every arm shares.
 *
 * **The second load does not read it**, and the comment here said it did: a
 * loaded envelope builds from `save.world.seed`. What `?seed=` does on page two
 * is match the record, which is what keeps the boot from setting the save aside
 * — an explicit seed that disagrees with a save outranks it. The arm passes
 * either way; its stated mechanism has to be the real one or a later reader
 * changing this constant reasons from a wire that is not running.
 */
const SEED = 42;

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * §11.5's badge as the page draws it. `shown` needs the point at its centre to
 * be the badge, so a console or panel drawn over the corner reads as not shown.
 *
 * **Drawn, not attributed.** `checkVisibility` answers from the computed style.
 * These rows read `el.hidden` for a round, and the badge's own `display: flex`
 * outranked the browser's `[hidden]` rule: it was drawn on every page with the
 * attribute set, and every row here passed.
 */
const badgeOf = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		const el = document.querySelector("[data-save-badge]");
		const kinds = [...(g.saveStore?.faultKinds ?? [])].sort();
		if (!el)
			return { mounted: false, shown: false, kinds, fault: g.saveFaultText() };
		const drawn = el.checkVisibility();
		const r = el.getBoundingClientRect();
		const hit = drawn
			? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
			: null;
		return {
			mounted: true,
			drawn,
			shown:
				drawn &&
				r.width > 0 &&
				r.height > 0 &&
				(hit === el || el.contains(hit)),
			kinds,
			fault: g.saveFaultText(),
		};
	});

/** Resolves `true` once the badge is shown (or hidden), `false` on timeout. */
const badgeBecomes = (page, shown, timeout) =>
	page
		.waitForFunction(
			(want) => {
				const el = document.querySelector("[data-save-badge]");
				return el !== null && el.checkVisibility() === want;
			},
			shown,
			{ timeout },
		)
		.then(
			() => true,
			() => false,
		);

/** Two frames, so the loop's per-frame badge update has run. */
const twoFrames = (page) =>
	page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);

/**
 * Makes the page's own backend refuse its next `count` writes, or every write
 * for `null`. The store reads `backend.writeMany` at call time, so patching the
 * object `__seelite.save.backend` names reaches it. `restoreWrites` undoes it.
 */
const forceWriteFailures = (page, count) =>
	page.evaluate((n) => {
		const b = window.__seelite.save.backend;
		window.__probeRealWriteMany ??= b.writeMany;
		const real = window.__probeRealWriteMany;
		let left = n === null ? Number.POSITIVE_INFINITY : n;
		window.__probeForcedWrites = 0;
		b.writeMany = (...args) => {
			if (left <= 0) return real.apply(b, args);
			left--;
			window.__probeForcedWrites++;
			return Promise.reject(new Error("probe: forced write failure"));
		};
	}, count);

const restoreWrites = (page) =>
	page.evaluate(() => {
		const b = window.__seelite.save.backend;
		if (window.__probeRealWriteMany) b.writeMany = window.__probeRealWriteMany;
		delete window.__probeRealWriteMany;
	});

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
	// **Not `?no-save`.** The store has to be live: the reload arm below reads
	// back what this page wrote, and a page booted with saving off would flush
	// nothing and the arm would be inert rather than failing.
	await page.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
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
		// about bytes, so bytes are what this grows to.
		//
		// **Derived, and the first derivation was wrong.** A UTF-16 KiB is 1024
		// *bytes* at two bytes a character, so T4's 1379 KiB UTF-16 is
		// `1379 * 1024 / 2` characters — about 689 KiB of them, not 706. The
		// previous line read `706 * 1024` and overshot by 2.4%, which is small
		// and is still a number nobody could check. The tier figure itself is
		// `scripts/measure-save-size.ts`'s and is the one thing here that is a
		// transcription; it is named as such rather than read off the page,
		// because that script is not something the page runs.
		const T4_KIB_UTF16 = 1379;
		const T4_JSON_CHARS = (T4_KIB_UTF16 * 1024) / 2;
		for (let i = 0; JSON.stringify(blob).length < T4_JSON_CHARS; i++)
			for (let j = 0; j < 200; j++)
				env.deficits[`${i * 200 + j}:station-trade`] = {
					goods: { ...row.goods },
					updatedAt: 0,
				};
		const bytes = JSON.stringify(blob).length;
		// **The small blob is kept, and the two scales are interleaved.** The
		// claim that "53 KiB and 714 KiB differ by about 5 ms, so the cost here
		// is fixed overhead rather than bytes" was true and unreproducible: the
		// two points came from two probe revisions, not from one run, and that
		// conclusion is what licenses picking a window at a single byte scale.
		// The arms alternate, because a block design that always runs them in
		// the same order measures the order (`measure-light-cost.mjs` has the
		// scar).
		const small = JSON.parse(JSON.stringify(save.serialize(live)));
		const smallBytes = JSON.stringify(small).length;
		const writes = [];
		const reads = [];
		const smallWrites = [];
		// **The synchronous half, which nothing measured — and note whose save
		// it is.** A debounced write runs `serializeSave(current())` first:
		// `advanceTo` over eight galaxies, `serializeWorld`, a `JSON.stringify`
		// of the whole save and an FNV-1a pass over every character, all on the
		// main thread, where a player feels it as a dropped frame.
		//
		// This arm serializes **the live game's own save**, which is the tier
		// #89 calls T5/T6 and the one play actually writes — not the padded blob
		// the transaction arm carries. They are different subjects and the
		// output says so. Serializing at T4's scale would need a T4-scale
		// `WorldState` in the page, which is `scripts/measure-save-size.ts`'s
		// job and its bun column already prints.
		const serializes = [];
		for (let i = 0; i < 12; i++) {
			const s0 = performance.now();
			save.serialize(window.__seelite.saveEnvelope());
			serializes.push(performance.now() - s0);
			const t0 = performance.now();
			await save.backend.write("probe", "live", blob);
			const t1 = performance.now();
			await save.backend.read("probe", "live");
			reads.push(performance.now() - t1);
			writes.push(t1 - t0);
			const u0 = performance.now();
			await save.backend.write("probe-small", "live", small);
			smallWrites.push(performance.now() - u0);
		}
		const back = await save.backend.read("probe", "live");
		return {
			bytes,
			smallBytes,
			writes,
			smallWrites,
			serializes,
			reads,
			debounceMs: save.debounceMs,
			dbName: save.dbName,
			roundTripped:
				JSON.stringify(back) === JSON.stringify(blob) &&
				Object.keys(back.world.galaxies[0].deficits).length ===
					Object.keys(env.deficits).length,
		};
	});

	// What §11.4's rows at the end need from a booted game, read here while one
	// is running: every name off the page, and a record key read off a record
	// this arm just wrote rather than restated — the key's separator is a
	// detail of the backend, and a probe with its own copy of it would seed a
	// version-1 record the upgraded game cannot find, which reads as data loss.
	const saveMeta = await page.evaluate(async () => {
		const g = window.__seelite;
		const s = g.save;
		const keys = await new Promise((resolve, reject) => {
			const open = indexedDB.open(s.dbName);
			open.onerror = () => reject(new Error("keys: open failed"));
			open.onsuccess = () => {
				const db = open.result;
				const request = db
					.transaction(s.storeName, "readonly")
					.objectStore(s.storeName)
					.getAllKeys();
				request.onsuccess = () => {
					db.close();
					resolve(request.result.map(String));
				};
				request.onerror = () => reject(new Error("keys: read failed"));
			};
		});
		const written = keys.find(
			(key) => key.startsWith("probe-small") && key.endsWith("live"),
		);
		// The separator, read once off a written key: what lies between the slot
		// name and the kind.
		const separator = written
			? written.slice("probe-small".length, -"live".length)
			: null;
		const key = (slot, kind) =>
			separator === null ? null : `${slot}${separator}${kind}`;
		return {
			dbName: s.dbName,
			dbVersion: s.dbVersion,
			storeName: s.storeName,
			pointerStoreName: s.pointerStoreName,
			blockedMessage: s.blockedMessage,
			closedMessage: s.closedMessage,
			defaultSlot: s.defaultSlot,
			liveKey: key(s.defaultSlot, "live"),
			lastDockedKey: key(s.defaultSlot, "lastDocked"),
			otherKey: key("probe-v1-other", "live"),
			blob: s.serialize(g.saveEnvelope()),
		};
	});
	check(
		"the page names every §11.4 constant and a record key can be read back",
		typeof saveMeta.dbVersion === "number" &&
			typeof saveMeta.pointerStoreName === "string" &&
			typeof saveMeta.blockedMessage === "string" &&
			typeof saveMeta.closedMessage === "string" &&
			saveMeta.liveKey !== null,
		JSON.stringify({ ...saveMeta, blob: undefined }),
	);

	const writeMs = median(store.writes);
	const readMs = median(store.reads);
	const smallWriteMs = median(store.smallWrites);
	const serializeMs = median(store.serializes);
	// What the player's main thread actually spends on one save.
	const hitchMs = serializeMs;
	console.log(
		`\nIndexedDB at ${(store.bytes / 1024).toFixed(0)} KiB of JSON, ${store.writes.length} runs:`,
	);
	console.log(
		`  write median ${writeMs.toFixed(1)} ms, range ${Math.min(...store.writes).toFixed(1)}–${Math.max(...store.writes).toFixed(1)}`,
	);
	console.log(
		`  read  median ${readMs.toFixed(1)} ms, range ${Math.min(...store.reads).toFixed(1)}–${Math.max(...store.reads).toFixed(1)}`,
	);
	console.log(
		`  serialize median ${serializeMs.toFixed(1)} ms, range ${Math.min(...store.serializes).toFixed(1)}–${Math.max(...store.serializes).toFixed(1)} (synchronous, on the main thread)`,
	);
	console.log(
		`  the same run at ${(store.smallBytes / 1024).toFixed(1)} KiB: write median ${smallWriteMs.toFixed(1)} ms — ${(writeMs - smallWriteMs).toFixed(1)} ms for ${((store.bytes - store.smallBytes) / 1024).toFixed(0)} KiB more, a factor of ${(store.bytes / store.smallBytes).toFixed(0)} in size`,
	);
	console.log(`  debounce window declared: ${store.debounceMs} ms`);

	check(
		"a save at T4 byte scale survives a real IndexedDB write and read",
		store.roundTripped,
		`${(store.bytes / 1024).toFixed(0)} KiB, db ${store.dbName}`,
	);
	// **Against the median, not against the maximum.** The first version of
	// this row asserted the window cleared the worst of twelve writes, and it
	// went red at 411.8 ms on a loaded machine having read 330–345 on three
	// quiet ones — a maximum over twelve samples is not a bound, which is the
	// same mistake the repo's own constraint records about floors. What #89
	// asks for is that **the common case is one transaction rather than a
	// queue**, and the common case is the median. A write slower than the
	// window is not a fault either: `SaveStore` queues behind an in-flight
	// write rather than racing it, and `tests/save-store.test.ts` holds that.
	check(
		"the debounce window is above a whole median save, both halves",
		store.debounceMs > writeMs + serializeMs,
		`window ${store.debounceMs} ms against ${serializeMs.toFixed(1)} ms of serialize + ${writeMs.toFixed(1)} ms of transaction (worst write ${Math.max(...store.writes).toFixed(1)}, unasserted)`,
	);
	// **The transaction here is mostly not about bytes, and this is the arm
	// that says so** rather than a sentence quoting two runs. Interleaved, so
	// drift cannot be read as the difference.
	const sizeFactor = store.bytes / store.smallBytes;
	const timeFactor = writeMs / smallWriteMs;
	check(
		"the transaction is mostly not about bytes",
		timeFactor < Math.sqrt(sizeFactor),
		`a factor of ${sizeFactor.toFixed(0)} in size costs a factor of ${timeFactor.toFixed(1)} in time — ${(store.smallBytes / 1024).toFixed(1)} KiB at ${smallWriteMs.toFixed(1)} ms against ${(store.bytes / 1024).toFixed(0)} KiB at ${writeMs.toFixed(1)} ms`,
	);
	// A browser transaction can be much faster than the player-facing debounce,
	// especially on local hardware. The upper bound is therefore a product
	// decision, not a ratio to an incidental IndexedDB median.
	check(
		"and remains a bounded player-visible window",
		store.debounceMs >= 100 && store.debounceMs <= 1000,
		`window ${store.debounceMs} ms`,
	);
	// The hitch is the half a player can feel, so it is printed beside a frame
	// rather than folded into the window.
	console.log(
		`  main-thread cost of one live-scale save: ${hitchMs.toFixed(1)} ms (a 60 fps frame is 16.7)`,
	);

	// -----------------------------------------------------------------------
	// §11.5: the save-fault badge, in flight
	// -----------------------------------------------------------------------
	// Forced through the page's own backend, so the store, the frame loop and
	// the badge are the shipped ones. Constants off the page, as above.
	const limits = await page.evaluate(() => ({
		debounceMs: window.__seelite.save.debounceMs,
		retryLimit: window.__seelite.save.retryLimit,
	}));
	const badgeWaitMs = limits.debounceMs * (limits.retryLimit + 2) + 10_000;
	// Nothing has failed yet, so nothing is drawn. The badge was drawn on every
	// page for a round with its `hidden` attribute set (see `badgeOf`).
	await twoFrames(page);
	const quiet = await badgeOf(page);
	check(
		"with no save fault held, the badge is not drawn",
		quiet.mounted && !quiet.drawn && quiet.kinds.length === 0,
		JSON.stringify(quiet),
	);
	// **Watched, not sampled.** A badge raised on the first failure and cleared
	// when the retry lands would be gone again by any single read afterwards.
	// Seeded with what is drawn now, so a badge drawn from the start counts.
	await page.evaluate(() => {
		const el = document.querySelector("[data-save-badge]");
		window.__probeBadgeEverShown = el?.checkVisibility() ?? false;
		if (!el) return;
		new MutationObserver(() => {
			if (el.checkVisibility()) window.__probeBadgeEverShown = true;
		}).observe(el, { attributes: true, attributeFilter: ["hidden"] });
	});
	await forceWriteFailures(page, limits.retryLimit - 1);
	await page.evaluate(() => window.__seelite.saveStore?.markDirty());
	const belowCap = await page
		.waitForFunction(
			(n) => window.__probeForcedWrites >= n,
			limits.retryLimit - 1,
			{
				timeout: badgeWaitMs,
			},
		)
		.then(
			() => true,
			() => false,
		);
	await page.waitForTimeout(limits.debounceMs + 300);
	await page.evaluate(() => window.__seelite.saveStore?.settled());
	await twoFrames(page);
	const belowCapState = await badgeOf(page);
	const everShown = await page.evaluate(() => window.__probeBadgeEverShown);
	check(
		"a debounced write that fails fewer than SAVE_RETRY_LIMIT times in a row never shows the badge",
		belowCap &&
			belowCapState.mounted &&
			!everShown &&
			belowCapState.kinds.length === 0,
		JSON.stringify({ belowCap, everShown, ...belowCapState }),
	);

	await forceWriteFailures(page, null);
	await page.evaluate(() => window.__seelite.saveStore?.markDirty());
	const raisedInFlight = await badgeBecomes(page, true, badgeWaitMs);
	const inFlightState = await badgeOf(page);
	check(
		"in flight, a debounced write failing SAVE_RETRY_LIMIT times shows the badge, on top of the glass",
		raisedInFlight &&
			inFlightState.shown &&
			JSON.stringify(inFlightState.kinds) === '["live"]' &&
			// Raised *at* the cap: a store that raised on the first failure also
			// shows the badge here, one message earlier.
			(inFlightState.fault ?? "").includes(`(${limits.retryLimit} in a row)`),
		JSON.stringify(inFlightState),
	);

	// The badge opens the overlay, which names the fault the store holds (§11.5).
	// Checked against the words the forced failure must produce, not against
	// the page's own reader, which would compare the overlay with itself.
	const opened = await page
		.click("[data-save-badge]", { timeout: 5_000 })
		.then(() =>
			page.waitForSelector("[data-commander-fault]", { timeout: 5_000 }),
		)
		.then(
			() => true,
			() => false,
		);
	const shownFault = await page.evaluate(() => {
		const el = document.querySelector("[data-commander-fault]");
		return {
			sentence: el?.firstChild?.textContent ?? null,
			detail:
				el?.querySelector("[data-commander-fault-detail]")?.textContent ?? null,
		};
	});
	check(
		"clicking the badge opens the Commander overlay with the fault it holds, sentence then detail",
		opened &&
			shownFault.sentence ===
				`the save would not write (${limits.retryLimit} in a row).` &&
			shownFault.detail === "probe: forced write failure",
		JSON.stringify(shownFault),
	);
	// The overlay states the fault, so the badge is not drawn over or behind it
	// (the principal's call on #313's frames); it is back once the overlay closes.
	await twoFrames(page);
	const underOverlay = await badgeOf(page);
	check(
		"while the overlay is open the badge is not drawn",
		opened && underOverlay.mounted && !underOverlay.drawn,
		JSON.stringify(underOverlay),
	);
	await page.keyboard.press("Escape");
	await page
		.waitForSelector("[data-commander-overlay]", {
			state: "detached",
			timeout: 5_000,
		})
		.catch(() => {});
	check(
		"and it is drawn again once the overlay closes, with the fault still held",
		await badgeBecomes(page, true, 5_000),
		JSON.stringify(await badgeOf(page)),
	);

	await restoreWrites(page);
	await page.evaluate(() => window.__seelite.saveStore?.markDirty());
	const clearedInFlight = await badgeBecomes(page, false, badgeWaitMs);
	const clearedState = await badgeOf(page);
	check(
		"and a good debounced write clears it",
		clearedInFlight && !clearedState.shown && clearedState.kinds.length === 0,
		JSON.stringify(clearedState),
	);

	// -----------------------------------------------------------------------
	// The wire is real: a price that changed survives a reload
	// -----------------------------------------------------------------------
	const trade = await page.evaluate(
		async ([targetSeed]) => {
			const { migrateEquipment, equipmentNames } = await import(
				"/src/loadout.ts"
			);

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
			{
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
				// §5.6 left this row reading `priceCr`, which the market row no
				// longer carries: the check silently became `undefined > undefined`,
				// which is false, and a probe that fails forever is a probe that
				// proves nothing. The buy column is the figure that moved.
				before: before
					? { buyCr: before.buyCr, quantity: before.quantity }
					: null,
				after: after ? { buyCr: after.buyCr, quantity: after.quantity } : null,
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
				trade.after.buyCr > trade.before.buyCr,
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

		// **The checkpoint names the station it was taken at.** The dock flush
		// fired before `enterArrival` for a round, so both records carried
		// `dockedAt: null` and a `flight.pos` in the mouth — a death restore
		// would then have taken the in-flight arm and put the ship at the
		// aperture with no grant, which by #9's protocol is a hostile station on
		// load.
		const checkpoint = await page.evaluate(async () => {
			const g = window.__seelite;
			const raw = await g.save.backend.read(g.save.defaultSlot, "lastDocked");
			return raw ? raw.commander : null;
		});
		// **The blocker round 3 found.** `commerceWorld.gameTime` moves only
		// inside `withEnvelope`, so it is the time of the last *world* event,
		// while `flight.pos` is read now. A cruise leg with no market event
		// paired a current position with a stale clock, and `restoreWorld` then
		// places every body at that clock — an orbit out of date beside a ship
		// that is where it is. `saveEnvelope` advances the clock now.
		const clock = await page.evaluate(async () => {
			const g = window.__seelite;
			// Move the sim without touching the persistent world: no dock, no
			// trade, no jump — the shape a cruise leg has.
			const dt = g.units.MAX_DT;
			for (let i = 0; i < 300; i++) g.step(dt);
			g.saveStore.markDirty();
			const env = g.saveEnvelope();
			return { saved: env.world.gameTime, sim: g.world.gameTime };
		});
		check(
			"the saved clock is the sim's, not the last world writer's",
			Math.abs(clock.saved - clock.sim) < 1e-6,
			`saved ${clock.saved.toFixed(3)} against sim ${clock.sim.toFixed(3)}`,
		);
		// **A restored cruise leg has to still be a leg.** The load arm set
		// `regime` alone for a round, so `stepCruise` ran at the field default
		// throttle of zero and the first frame wrote the ship's velocity to a
		// stop — a save that lost the leg rather than a missing field. The
		// throttle is carried now and the leg's start time is set beside it.
		const cruise = await page.evaluate(async () => {
			const g = window.__seelite;
			const record = g.commanderRecord();
			const restored = {
				...record,
				dockedAt: null,
				flight: { ...record.flight, regime: "cruise", throttle: 1 },
			};
			const round = g.save.serialize({
				world: g.saveEnvelope().world,
				commander: restored,
			});
			// Through the parser, so a field the schema would refuse cannot pass
			// here and fail on a player's machine.
			return {
				regime: JSON.parse(JSON.stringify(round)).commander.flight.regime,
				throttle: JSON.parse(JSON.stringify(round)).commander.flight.throttle,
			};
		});
		// **This row checks the schema, not the flying.** It goes red on a build
		// whose `SavedFlight` has no throttle, and it cannot see whether the load
		// arm uses the field — `tests/world-state-wiring.test.ts` reads the arm
		// for that, because `Game` is not constructible headless.
		check(
			"a cruise save round-trips its regime and throttle",
			cruise.regime === "cruise" && cruise.throttle === 1,
			JSON.stringify(cruise),
		);
		check(
			"the lastDocked checkpoint names the station the ship docked at",
			checkpoint !== null &&
				typeof checkpoint.dockedAt === "string" &&
				checkpoint.dockedAt.includes(":"),
			JSON.stringify(checkpoint && { dockedAt: checkpoint.dockedAt }),
		);

		// -------------------------------------------------------------------
		// §11.5: the save-fault badge, while docked
		// -------------------------------------------------------------------
		// M10 hides the flight floor while docked, and the station console fills
		// the glass: the badge is in a corner so that neither hides it, and
		// `badgeOf`'s hit test is what says so.
		await forceWriteFailures(page, null);
		await page.evaluate(() => window.__seelite.saveStore?.markDirty());
		const raisedDocked = await badgeBecomes(page, true, badgeWaitMs);
		const dockedState = await badgeOf(page);
		check(
			"while docked, a debounced write failing SAVE_RETRY_LIMIT times shows the badge over the station console",
			raisedDocked &&
				dockedState.shown &&
				JSON.stringify(dockedState.kinds) === '["live"]' &&
				(dockedState.fault ?? "").includes(`(${limits.retryLimit} in a row)`),
			JSON.stringify(dockedState),
		);
		await restoreWrites(page);
		await page.evaluate(() => window.__seelite.saveStore?.markDirty());
		const clearedDocked = await badgeBecomes(page, false, badgeWaitMs);
		const clearedDockedState = await badgeOf(page);
		check(
			"and a good debounced write clears it while docked",
			clearedDocked && clearedDockedState.kinds.length === 0,
			JSON.stringify(clearedDockedState),
		);

		await forceWriteFailures(page, null);
		await page.evaluate(() => {
			const g = window.__seelite;
			g.saveStore?.markDirty();
			g.saveFlush("dock");
		});
		const raisedByDock = await badgeBecomes(page, true, badgeWaitMs);
		const dockFaultState = await badgeOf(page);
		check(
			"a failed dock flush shows the badge at once, holding both records",
			raisedByDock &&
				dockFaultState.shown &&
				JSON.stringify(dockFaultState.kinds) === '["lastDocked","live"]',
			JSON.stringify(dockFaultState),
		);
		// **One debounced failure, then its retry lands.** The overlay named that
		// write rather than the dock flush for a round, while the badge stood for
		// `lastDocked` (sage, #311 round 1).
		await forceWriteFailures(page, 1);
		await page.evaluate(() => window.__seelite.saveStore?.markDirty());
		const liveOnly = await page
			.waitForFunction(
				() =>
					JSON.stringify([
						...(window.__seelite.saveStore?.faultKinds ?? []),
					]) === '["lastDocked"]',
				null,
				{ timeout: badgeWaitMs },
			)
			.then(
				() => true,
				() => false,
			);
		await twoFrames(page);
		const afterDebounce = await badgeOf(page);
		await restoreWrites(page);
		check(
			"a debounced write that fails and then lands does not clear a dock-flush fault, nor replace its words",
			liveOnly &&
				afterDebounce.shown &&
				JSON.stringify(afterDebounce.kinds) === '["lastDocked"]' &&
				(afterDebounce.fault ?? "").startsWith("the dock save would not write"),
			JSON.stringify(afterDebounce),
		);
		await page.evaluate(() => {
			const g = window.__seelite;
			g.saveStore?.markDirty();
			g.saveFlush("dock");
		});
		const clearedByDock = await badgeBecomes(page, false, badgeWaitMs);
		const afterDock = await badgeOf(page);
		check(
			"and the next good dock flush does",
			clearedByDock && !afterDock.shown && afterDock.kinds.length === 0,
			JSON.stringify(afterDock),
		);

		// **Close the first page before opening the second.** It is a running
		// game: its rAF loop keeps drawing, and a second boot alongside it timed
		// out at 20 s. The context survives the close, which is what carries the
		// IndexedDB to the reload.
		await page.close();
		const reloaded = await context.newPage();
		watch(reloaded);
		await reloaded.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
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
					// Node #658: a docked save re-enters its station through the
					// protocol. The reload above flushed while docked, so the
					// commander has `dockedAt` set and `restoreDockedAt` runs.
					dockPhase: g.dock.phase,
					dockedAt: g.dockedAt,
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
		// Node #658: a docked save re-enters its station through the protocol,
		// so the reloaded page is docked at the same station.
		check(
			"a docked save reloads docked at the same station",
			after.dockPhase === "docked" && after.dockedAt === trade.station,
			JSON.stringify({
				dockPhase: after.dockPhase,
				dockedAt: after.dockedAt,
				want: trade.station,
			}),
		);
		// -------------------------------------------------------------------
		// The in-flight restore arm, which nothing else reaches
		// -------------------------------------------------------------------
		// The reload above flushes while docked, so page two takes the docked
		// arm every time — and the in-flight arm is where `flight.pos`, the
		// regime, the throttle and the `faceTheStar` guard all live. A record is
		// seeded directly, because getting the ship into open space on a
		// scripted flight is a cruise leg this probe has no business flying.
		const seeded = await reloaded.evaluate(() => {
			const g = window.__seelite;
			const env = g.saveEnvelope();
			const pos = { x: 1234.5, y: -678.25, z: 90.125 };
			const orientation = [0.5, 0.5, 0.5, 0.5];
			const record = {
				...env.commander,
				dockedAt: null,
				flight: {
					pos: [pos.x, pos.y, pos.z],
					vel: [0.25, -0.5, 0.75],
					orientation,
					regime: "cruise",
					throttle: 1,
					// A cruise leg is nose-locked and resumes at rest, rates and
					// all (#619): these must not come back.
					rates: [0.31, -0.42, 0.53],
				},
			};
			return {
				pos,
				orientation,
				seed: env.world.seed,
				berth: g.save.defaultSlot,
				blob: g.save.serialize({ world: env.world, commander: record }),
			};
		});
		await reloaded.close();

		// Closing a live page performs its required best-effort quit flush. Seed
		// only *after* that close, through a page deliberately booted without a
		// store, so the record below is the one the next live page reads rather
		// than a race against the former game's final write.
		const seedPage = await context.newPage();
		watch(seedPage, "in-flight seed");
		await seedPage.goto(gameUrl(ORIGIN, { "no-save": true }), {
			waitUntil: "load",
		});
		await bootedGame(seedPage);
		await seedPage.evaluate(async ({ berth, blob }) => {
			const { indexedDbSaveBackend } = await import("/src/save-store.ts");
			await indexedDbSaveBackend().write(berth, "live", blob);
		}, seeded);
		await seedPage.close();

		const third = await context.newPage();
		watch(third);
		await third.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
		await bootedGame(third);
		const inFlight = await third.evaluate(() => {
			const g = window.__seelite;
			return {
				fault: g.saveFault,
				pos: { ...g.world.ship.pos },
				vel: { ...g.world.ship.vel },
				regime: g.regime,
				throttle: g.throttle,
				rates: { ...g.rates },
				orientation: [
					g.orientation.x,
					g.orientation.y,
					g.orientation.z,
					g.orientation.w,
				],
				dockPhase: g.dock.phase,
			};
		});
		console.log(`\nin-flight restore: ${JSON.stringify(inFlight)}`);
		const near = (a, b) => Math.abs(a - b) < 1e-6;
		check(
			"an in-flight save restores the ship where it was, not at the arrival point",
			inFlight.fault === null &&
				near(inFlight.pos.x, seeded.pos.x) &&
				near(inFlight.pos.y, seeded.pos.y) &&
				near(inFlight.pos.z, seeded.pos.z),
			JSON.stringify({
				got: inFlight.pos,
				want: seeded.pos,
				fault: inFlight.fault,
			}),
		);
		// **The `faceTheStar` guard, which nothing held.** It runs
		// unconditionally at the end of the world setup, and a ship facing a
		// star looks exactly like a ship that was — so a restore that lost its
		// attitude would read as a working one.
		check(
			"and keeps the attitude it was saved with rather than facing the star",
			seeded.orientation.every((v, i) => near(inFlight.orientation[i], v)),
			JSON.stringify({ got: inFlight.orientation, want: seeded.orientation }),
		);
		// **A cruise save comes back at rest in normal flight, and that is the
		// answer rather than a gap.** This row read `regime === "cruise"` for a
		// round and went red: a leg is not a regime plus a throttle.
		// `stepCruise` reads the target, the detour and `cruiseSpeedKms`, none
		// of which the record carries, so the first frame disengaged and
		// `exitVelocity` wrote the ship to a stop — the arm was restoring
		// something that could not survive one step. The place is kept; the leg
		// is charted.
		check(
			"a cruise save comes back at rest in normal flight, keeping its place",
			inFlight.regime === "normal" &&
				inFlight.throttle === 0 &&
				inFlight.rates.pitch === 0 &&
				inFlight.rates.yaw === 0 &&
				inFlight.rates.roll === 0 &&
				near(inFlight.vel.x, 0) &&
				near(inFlight.vel.y, 0) &&
				near(inFlight.vel.z, 0),
			JSON.stringify({
				regime: inFlight.regime,
				throttle: inFlight.throttle,
				vel: inFlight.vel,
				rates: inFlight.rates,
			}),
		);

		// **A tumble survives a save (#619, `flight-model.md` §3.9).** Rates
		// are angular momentum under the vents, so a normal-flight record
		// carries them and the restore puts them back. Seeded the same way as
		// the cruise record above. The page is flying by the time it is read
		// (`bootedGame` releases the clock), and with the assist on a frame or
		// two has eased the rates: measured, 0.96 of the seed. So each axis is
		// held to its sign and to within 15% — a restore that dropped them
		// reads exactly zero, which is what a fresh page starts at.
		const tumble = [0.31, -0.42, 0.53];
		const tumbling = await third.evaluate((rates) => {
			const g = window.__seelite;
			const env = g.saveEnvelope();
			return {
				berth: g.save.defaultSlot,
				blob: g.save.serialize({
					world: env.world,
					commander: {
						...env.commander,
						dockedAt: null,
						flight: { ...env.commander.flight, regime: "normal", rates },
					},
				}),
			};
		}, tumble);
		await third.close();
		const tumbleSeed = await context.newPage();
		watch(tumbleSeed, "tumble seed");
		await tumbleSeed.goto(gameUrl(ORIGIN, { "no-save": true }), {
			waitUntil: "load",
		});
		await bootedGame(tumbleSeed);
		await tumbleSeed.evaluate(async ({ berth, blob }) => {
			const { indexedDbSaveBackend } = await import("/src/save-store.ts");
			await indexedDbSaveBackend().write(berth, "live", blob);
		}, tumbling);
		await tumbleSeed.close();
		const fourth = await context.newPage();
		watch(fourth);
		await fourth.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
		await bootedGame(fourth);
		const resumed = await fourth.evaluate(() => ({
			fault: window.__seelite.saveFault,
			held: window.__seelite.clockHeld,
			rates: { ...window.__seelite.rates },
		}));
		check(
			"a save taken tumbling resumes tumbling",
			resumed.fault === null &&
				["pitch", "yaw", "roll"].every((axis, i) => {
					const share = resumed.rates[axis] / tumble[i];
					return share > 0.85 && share <= 1 + 1e-9;
				}),
			JSON.stringify({ ...resumed, want: tumble }),
		);
		await fourth.close();
	} else {
		await page.close();
	}

	// -----------------------------------------------------------------------
	// §11.4: the pointer store, against the real IndexedDB
	// -----------------------------------------------------------------------
	// The in-memory backend keeps the pointer in its own map, so it is disjoint
	// from the slots by construction and no headless row can see the collision
	// the second object store exists to prevent. These rows can.
	//
	// **Every seeding page is a workbench route.** A game page opens the save
	// database at boot, which upgrades it — so a version-1 database seeded from
	// a game page would already be version 2 before the seed landed. The
	// workbench mounts no game and opens nothing.
	const seedV1 = async (bench, keepOpen) =>
		bench.evaluate(
			([meta, hold]) =>
				new Promise((resolve, reject) => {
					const open = indexedDB.open(meta.dbName, 1);
					open.onupgradeneeded = () =>
						open.result.createObjectStore(meta.storeName);
					open.onerror = () => reject(new Error("seed: open failed"));
					open.onsuccess = () => {
						const db = open.result;
						const tx = db.transaction(meta.storeName, "readwrite");
						// Both kinds for the default Commander and a record for a
						// second one: an upgrade that kept one record and lost the
						// others must not pass as "every record intact".
						const store = tx.objectStore(meta.storeName);
						store.put(meta.blob, meta.liveKey);
						store.put(
							{ ...meta.blob, probe: "lastDocked" },
							meta.lastDockedKey,
						);
						store.put({ ...meta.blob, probe: "other" }, meta.otherKey);
						tx.oncomplete = () => {
							// Held with **no** `versionchange` handler, which is the
							// shape of a tab still running the version-1 build.
							if (hold) window.__heldV1 = db;
							else db.close();
							resolve(db.version);
						};
					};
				}),
			[saveMeta, keepOpen],
		);

	// The version-1 database a save from before §11 left behind.
	const upgradeContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	extraContexts.push(upgradeContext);
	const bench = await upgradeContext.newPage();
	watch(bench, "upgrade bench");
	await bench.goto(workbenchUrl(ORIGIN, { "model-viewer": "ship" }), {
		waitUntil: "load",
	});
	const seededVersion = await seedV1(bench, false);
	await bench.close();
	const upgraded = await upgradeContext.newPage();
	watch(upgraded, "upgraded game");
	await upgraded.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
	await bootedGame(upgraded);
	const afterUpgrade = await upgraded.evaluate(async (meta) => {
		const g = window.__seelite;
		const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
		const b = g.save.backend;
		const live = await b.read(meta.defaultSlot, "live");
		const lastDocked = await b.read(meta.defaultSlot, "lastDocked");
		const other = await b.read("probe-v1-other", "live");
		// A pointer written, so the listing below has something to leave out.
		await b.writeMeta({ active: meta.defaultSlot });
		const slots = await b.slots();
		const shape = await new Promise((resolve) => {
			const open = indexedDB.open(meta.dbName);
			open.onsuccess = () => {
				const db = open.result;
				const out = {
					version: db.version,
					stores: [...db.objectStoreNames].sort(),
				};
				db.close();
				resolve(out);
			};
		});
		return {
			fault: g.saveFault,
			liveIntact:
				same(live, meta.blob) &&
				same(lastDocked, { ...meta.blob, probe: "lastDocked" }) &&
				same(other, { ...meta.blob, probe: "other" }),
			pointer: await g.save.backend.readMeta("active"),
			slots,
			...shape,
		};
	}, saveMeta);
	console.log(`\nversion-1 upgrade: ${JSON.stringify(afterUpgrade)}`);
	check(
		"a version-1 database already holding saves opens under version 2 with every record intact",
		seededVersion === 1 &&
			afterUpgrade.fault === null &&
			afterUpgrade.version === saveMeta.dbVersion &&
			afterUpgrade.liveIntact &&
			afterUpgrade.stores.includes(saveMeta.storeName) &&
			afterUpgrade.stores.includes(saveMeta.pointerStoreName),
		JSON.stringify({ seededVersion, ...afterUpgrade }),
	);
	check(
		"slots() lists the Commanders and not the pointer store",
		afterUpgrade.pointer === saveMeta.defaultSlot &&
			JSON.stringify([...afterUpgrade.slots].sort()) ===
				JSON.stringify([saveMeta.defaultSlot, "probe-v1-other"].sort()),
		JSON.stringify({
			slots: afterUpgrade.slots,
			pointer: afterUpgrade.pointer,
		}),
	);
	await upgraded.close();

	// A tab still open on the version-1 build: the upgrade is blocked.
	const blockedContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	extraContexts.push(blockedContext);
	const holder = await blockedContext.newPage();
	watch(holder, "version-1 holder");
	await holder.goto(workbenchUrl(ORIGIN, { "model-viewer": "ship" }), {
		waitUntil: "load",
	});
	await seedV1(holder, true);
	const blocked = await blockedContext.newPage();
	watch(blocked, "blocked game");
	await blocked.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
	// **The boot completing is half the row.** An unhandled block never boots
	// at all, so `bootedGame` timing out here is the failure this row names.
	const bootedDespiteBlock = await bootedGame(blocked)
		.then(() => true)
		.catch(() => false);
	const blockedState = bootedDespiteBlock
		? await blocked.evaluate(
				async (meta) => ({
					fault: window.__seelite.saveFault,
					store: window.__seelite.saveStore !== null,
					// A later call in the same tab. A second open queues behind the
					// first, which is still pending, and fires no `blocked` event of
					// its own, so a refusal that is not remembered hangs here.
					retry: await Promise.race([
						window.__seelite.save.backend.read(meta.defaultSlot, "live").then(
							() => "resolved",
							(error) =>
								error instanceof Error ? error.message : String(error),
						),
						new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
					]),
				}),
				saveMeta,
			)
		: null;
	check(
		"a version-1 connection left open produces the named blocked fault, a boot, and the same fault on a later call, not a hang",
		bootedDespiteBlock &&
			// The boot's fault is the overlay's words, which drop the storage
			// modules' `save: ` prefix (`messageOf`); the later call's is raw.
			blockedState.fault === saveMeta.blockedMessage.replace(/^save: /, "") &&
			blockedState.store === false &&
			blockedState.retry === saveMeta.blockedMessage,
		JSON.stringify({ bootedDespiteBlock, ...blockedState }),
	);
	await blocked.close();
	await holder.close();

	// This build's own connection meets a newer version and steps aside.
	const newerContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	extraContexts.push(newerContext);
	const running = await newerContext.newPage();
	watch(running, "running game");
	await running.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
	await bootedGame(running);
	const newer = await newerContext.newPage();
	watch(newer, "newer build");
	await newer.goto(workbenchUrl(ORIGIN, { "model-viewer": "ship" }), {
		waitUntil: "load",
	});
	// A version this build never ships stands in for the next one: the handler
	// is version-agnostic. A connection that did not step aside blocks this
	// open, which then never succeeds — hence the timeout arm.
	const newerOpened = await newer.evaluate(
		(meta) =>
			new Promise((resolve) => {
				const open = indexedDB.open(meta.dbName, meta.dbVersion + 1);
				const timer = setTimeout(() => resolve("still blocked"), 5000);
				open.onsuccess = () => {
					clearTimeout(timer);
					open.result.close();
					resolve("opened");
				};
			}),
		saveMeta,
	);
	const afterVersionChange = await running.evaluate(async (meta) => {
		const g = window.__seelite;
		try {
			await g.save.backend.write(
				meta.defaultSlot,
				"live",
				g.save.serialize(g.saveEnvelope()),
			);
			return "wrote";
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}, saveMeta);
	check(
		"a connection the game holds steps aside for a newer version, and its next write fails by name",
		newerOpened === "opened" && afterVersionChange === saveMeta.closedMessage,
		JSON.stringify({ newerOpened, afterVersionChange }),
	);
	await newer.close();
	await running.close();

	// The IndexedDB `copySlot` and `takeMeta` that ship. Every headless row runs
	// against the in-memory backend, so these two transactions are checked here
	// or nowhere. Its own context: the row above upgraded that one's database
	// past the version this build opens.
	const metaContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	extraContexts.push(metaContext);
	const metaPage = await metaContext.newPage();
	watch(metaPage, "meta game");
	await metaPage.goto(gameUrl(ORIGIN, { seed: SEED }), { waitUntil: "load" });
	await bootedGame(metaPage);
	const metaOps = await metaPage.evaluate(async () => {
		const b = window.__seelite.save.backend;
		await b.write("probe-copy-a", "live", { mark: "live" });
		await b.write("probe-copy-a", "lastDocked", { mark: "lastDocked" });
		await b.copySlot("probe-copy-a", "probe-copy-b");
		const copied = [
			(await b.read("probe-copy-b", "live"))?.mark ?? null,
			(await b.read("probe-copy-b", "lastDocked"))?.mark ?? null,
		];
		const refusal = await b
			.copySlot("probe-copy-none", "probe-copy-c")
			.then(() => "copied nothing")
			.catch((error) =>
				error instanceof Error ? error.message : String(error),
			);
		await b.deleteSlot("probe-copy-a");
		const slots = await b.slots();
		await b.writeMeta({ oneShot: "probe-copy-b" });
		// Two reads in sequence. Two concurrent readers do not test the single
		// transaction either: against a build that split the read and the delete
		// into two transactions, Chromium still handed the one-shot to only one
		// of them. That property rests on the code; this row checks the result.
		const taken = [await b.takeMeta("oneShot"), await b.takeMeta("oneShot")];
		return { copied, refusal, slots, taken };
	});
	console.log(`\npointer-store transactions: ${JSON.stringify(metaOps)}`);
	check(
		"copySlot carries both records in IndexedDB, and refuses a Commander with none",
		JSON.stringify(metaOps.copied) === JSON.stringify(["live", "lastDocked"]) &&
			/holds no record to copy/.test(metaOps.refusal) &&
			metaOps.slots.includes("probe-copy-b") &&
			!metaOps.slots.includes("probe-copy-a") &&
			!metaOps.slots.includes("probe-copy-c"),
		JSON.stringify(metaOps),
	);
	check(
		"takeMeta in IndexedDB returns the one-shot once, then nothing",
		metaOps.taken[0] === "probe-copy-b" && metaOps.taken[1] === null,
		JSON.stringify(metaOps.taken),
	);
	await metaPage.close();
} finally {
	for (const extra of extraContexts) await extra.close().catch(() => {});
	await context?.close();
	await browser.close();
}
exit();
