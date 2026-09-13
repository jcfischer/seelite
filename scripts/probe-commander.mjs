/**
 * Commander probe — §11's overlay on a running page.
 *
 *   npm run dev                          # in one shell
 *   node scripts/probe-commander.mjs     # in another
 *
 * `persistent-world-state.md` §11.7's browser list, bar the save-fault badge,
 * which is #306's last part:
 *
 * 1. **A player boot opens the overlay with the clock held and no store.** The
 *    boot must not advance `gameTime` while nobody has chosen, and a store
 *    attached behind the overlay would write a Commander nobody picked on
 *    `pagehide`.
 * 2. **New game reloads straight into the new Commander**, past the overlay,
 *    and the pending record clears once its first `live` record lands.
 * 3. **Continue releases the clock** and attaches the store.
 * 4. **A second tab refuses Continue, Load, Rename and Delete** on a Commander
 *    the first tab holds, and a one-shot boot into it opens the overlay with the
 *    fault. Two pages in **one** context: a context has its own IndexedDB and
 *    its own locks, so two contexts are two browsers and every refusal would
 *    pass for the wrong reason.
 * 5. **Export hands the player a file, and Rename and Delete do not reload.**
 * 6. **Import reloads into the imported Commander** out of a game in play.
 * 7. **A boot fault shows its message and offers Export** of the Commander it
 *    concerns.
 * 8. **`?seed` without `?boot=direct` sets nothing aside** and pre-fills New
 *    game's seed.
 * 9. **The pad drives the overlay as `modal`.**
 *
 * The URLs are built with `boot: null`, which is `gameUrl`'s option for a probe
 * of the overlay itself and for nothing else.
 */
import { readFileSync } from "node:fs";
import { gameUrl } from "./lib/game-url.mjs";
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 42;
const OTHER_SEED = 777;

/** A player's boot of the default route with another seed: no `?boot=direct`. */
const OTHER_SEED_URL = gameUrl(ORIGIN, { seed: OTHER_SEED }, { boot: null });

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const contexts = [];

const newContext = async () => {
	const context = await browser.newContext({
		viewport: { width: 1100, height: 760 },
	});
	contexts.push(context);
	return context;
};

/**
 * A player's boot of the default route: no `?boot=direct`. The URL is built
 * here rather than passed in, because `tests/game-url.test.ts` accepts a
 * navigation only through a builder call or a name bound to one.
 */
const openPage = async (context, { pad = false } = {}) => {
	const page = await context.newPage();
	watch(page);
	if (pad) await page.addInitScript(installFakePad);
	await page.goto(gameUrl(ORIGIN, { seed: SEED }, { boot: null }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	return page;
};

/** What the page's boot decided and where it stands now. */
const state = (page) =>
	page.evaluate(() => {
		const c = window.__seelite.commanderBoot;
		const fault = document.querySelector("[data-commander-fault]");
		const selected = document.querySelector(
			'#seelite-commander .row[aria-selected="true"]',
		);
		return {
			mode: c.mode,
			slot: c.slot,
			attached: c.attached(),
			clockHeld: c.clockHeld(),
			open: c.overlay.isOpen(),
			drawn: Boolean(document.querySelector("[data-commander-overlay]")),
			store: window.__seelite.saveStore !== null,
			fault: fault ? fault.textContent : null,
			selected: selected
				? {
						kind: selected.getAttribute("data-kind"),
						commander: selected.getAttribute("data-commander"),
						disabled: selected.getAttribute("aria-disabled"),
					}
				: null,
		};
	});

const gameTime = (page) => page.evaluate(() => window.__seelite.world.gameTime);

/** `gameTime` across a wall-clock wait, so a held clock reads as equal. */
const clockAcross = async (page, ms = 1500) => {
	const before = await gameTime(page);
	await page.waitForTimeout(ms);
	return { before, after: await gameTime(page) };
};

const waitFor = (page, predicate, arg, timeout = 15000) =>
	page
		.waitForFunction(predicate, arg, { timeout })
		.then(() => true)
		.catch(() => false);

/** Runs `action` and waits for the reload it causes to boot. */
const reloadedBy = async (page, action) => {
	const load = page.waitForEvent("load", { timeout: 30000 });
	await action();
	await load;
	await bootedGame(page);
};

/** Removes the drawn fault, so the next one on the page is a new refusal. */
const clearFault = (page) =>
	page.evaluate(() =>
		document.querySelector("[data-commander-fault]")?.remove(),
	);

const slotsOf = (page) =>
	page.evaluate(() => window.__seelite.commanderBoot.catalog.slots());

const button = (page, n) =>
	page.locator('#seelite-commander [data-kind="button"]').nth(n);

try {
	// -----------------------------------------------------------------------
	// 1. The boot overlay: clock held, no store, New game chosen
	// -----------------------------------------------------------------------
	const origin = await newContext();
	const tabA = await openPage(origin);
	let s = await state(tabA);
	check(
		"a player boot opens the Commander overlay",
		s.mode === "overlay" && s.open && s.drawn,
		JSON.stringify(s),
	);
	const held = await clockAcross(tabA);
	check(
		"the world clock is held while the boot overlay is open",
		held.after === held.before && s.clockHeld,
		`gameTime ${held.before} → ${held.after}`,
	);
	check(
		"no store is attached before the player chooses",
		!s.store && s.attached === null,
		JSON.stringify(s),
	);
	check(
		"a fresh profile has nothing to continue, so the cursor is on New game",
		s.selected?.kind === "new-game" &&
			(await tabA.getAttribute('[data-kind="continue"]', "aria-disabled")) ===
				"true",
		JSON.stringify(s.selected),
	);
	const settingsMounted = await waitFor(
		tabA,
		() => window.__seelite.settingsPanel !== null,
	);
	await tabA.keyboard.press("z");
	await tabA.waitForTimeout(500);
	// **Read before Escape.** Escape closes a settings screen that opened over
	// the overlay, so a check after it passed on a build with no guard at all.
	const settingsOpened = Boolean(await tabA.$("[data-settings-panel]"));
	check(
		"settings' key does not open settings over the boot overlay",
		settingsMounted && !settingsOpened,
		`settings mounted ${settingsMounted}, opened ${settingsOpened}`,
	);
	await tabA.keyboard.press("Escape");
	s = await state(tabA);
	check(
		"Escape does not take the boot overlay away",
		s.open && s.drawn,
		JSON.stringify(s),
	);

	// -----------------------------------------------------------------------
	// 2. New game, by keyboard, reloads into the new Commander
	// -----------------------------------------------------------------------
	await tabA.keyboard.press("Enter");
	const seedPrefill = await tabA.inputValue('[data-field="seed"]');
	await tabA.fill('[data-field="name"]', "Probe One");
	// Name, seed, roll, permadeath: the toggle is three rows down.
	for (let i = 0; i < 3; i++) await tabA.keyboard.press("ArrowDown");
	await tabA.keyboard.press("ArrowRight");
	await tabA.keyboard.press("ArrowDown");
	await reloadedBy(tabA, () => tabA.keyboard.press("Enter"));
	s = await state(tabA);
	check(
		"New game reloads straight into the new Commander, past the overlay",
		s.mode === "continue" &&
			!s.open &&
			s.attached === "Probe One" &&
			!s.clockHeld,
		JSON.stringify(s),
	);
	const landed = await tabA.evaluate(async () => {
		const b = window.__seelite.save.backend;
		for (let i = 0; i < 100; i++) {
			if (
				(await b.readMeta("pending")) === null &&
				(await b.read("Probe One", "live")) !== null
			)
				break;
			await new Promise((r) => setTimeout(r, 100));
		}
		const env = window.__seelite.saveEnvelope();
		return {
			pending: await b.readMeta("pending"),
			live: (await b.read("Probe One", "live")) !== null,
			permadeath: env.commander.permadeath,
			seed: env.world.seed,
		};
	});
	check(
		"the new Commander's first save lands and its pending record clears",
		landed.live && landed.pending === null,
		JSON.stringify(landed),
	);
	check(
		"the new Commander has the seed and the permadeath New game chose",
		landed.permadeath === true && String(landed.seed) === seedPrefill,
		`${JSON.stringify(landed)} against seed field ${seedPrefill}`,
	);

	// -----------------------------------------------------------------------
	// 3. The player's own reload: the overlay again, Continue releases
	// -----------------------------------------------------------------------
	await tabA.reload({ waitUntil: "load" });
	await bootedGame(tabA);
	s = await state(tabA);
	check(
		"a reload the player made opens the overlay with Continue chosen",
		s.mode === "overlay" &&
			s.open &&
			s.selected?.kind === "continue" &&
			s.selected.disabled === "false",
		JSON.stringify(s),
	);
	await tabA.keyboard.press("Enter");
	const continued = await waitFor(
		tabA,
		() => window.__seelite.commanderBoot.attached() === "Probe One",
	);
	const running = await clockAcross(tabA);
	s = await state(tabA);
	check(
		"Continue attaches the store and releases the clock",
		continued && !s.open && !s.clockHeld && running.after > running.before,
		`${JSON.stringify(s)} gameTime ${running.before} → ${running.after}`,
	);

	// -----------------------------------------------------------------------
	// 4. A second tab on the same origin
	// -----------------------------------------------------------------------
	const tabB = await openPage(origin);
	await tabB.keyboard.press("Enter");
	await waitFor(tabB, () => document.querySelector("[data-commander-fault]"));
	s = await state(tabB);
	check(
		"a second tab refuses Continue into a Commander the first tab holds",
		/another tab/.test(s.fault ?? "") &&
			s.attached === null &&
			s.clockHeld &&
			s.open,
		JSON.stringify(s),
	);

	await clearFault(tabB);
	await tabB.click('[data-commander="Probe One"] [data-action="load"]');
	// **Load's own refusal, not the one left over from Continue.** Removing the
	// drawn fault does not clear the overlay's state, and the next redraw puts
	// Continue's message back; the catalog's refusal is worded differently.
	await waitFor(tabB, () =>
		/or in play here/.test(
			document.querySelector("[data-commander-fault]")?.textContent ?? "",
		),
	);
	s = await state(tabB);
	const loadOneShot = await tabB.evaluate(() =>
		window.__seelite.save.backend.readMeta("oneShot"),
	);
	check(
		"a second tab refuses Load of that Commander",
		/or in play here/.test(s.fault ?? "") &&
			s.open &&
			s.attached === null &&
			loadOneShot === null,
		`${JSON.stringify(s)} one-shot: ${loadOneShot}`,
	);

	await clearFault(tabB);
	await tabB.click('[data-commander="Probe One"] [data-action="rename"]');
	await tabB.fill('[data-field="name"]', "Probe Renamed");
	await button(tabB, 0).click();
	await waitFor(tabB, () => document.querySelector("[data-commander-fault]"));
	s = await state(tabB);
	const afterRename = await slotsOf(tabB);
	check(
		"a second tab refuses Rename of that Commander",
		/another tab/.test(s.fault ?? "") &&
			afterRename.includes("Probe One") &&
			!afterRename.includes("Probe Renamed"),
		`${s.fault} ${JSON.stringify(afterRename)}`,
	);
	await tabB.keyboard.press("Escape");

	await clearFault(tabB);
	await tabB.click('[data-commander="Probe One"] [data-action="delete"]');
	await button(tabB, 1).click();
	await waitFor(tabB, () => document.querySelector("[data-commander-fault]"));
	s = await state(tabB);
	check(
		"a second tab refuses Delete of that Commander",
		/another tab/.test(s.fault ?? "") &&
			(await slotsOf(tabB)).includes("Probe One"),
		JSON.stringify(s),
	);
	await tabB.keyboard.press("Escape");

	await tabB.evaluate(() =>
		window.__seelite.save.backend.writeMeta({
			active: "Probe One",
			oneShot: "Probe One",
		}),
	);
	await tabB.reload({ waitUntil: "load" });
	await bootedGame(tabB);
	s = await state(tabB);
	const oneShotLeft = await tabB.evaluate(() =>
		window.__seelite.save.backend.readMeta("oneShot"),
	);
	check(
		"a one-shot boot into a Commander another tab holds opens the overlay with that fault",
		// `withLockFault` turned the plan into an overlay boot; the consumed one-shot
		// and the lock fault are what show it was one.
		s.mode === "overlay" &&
			s.open &&
			s.attached === null &&
			s.clockHeld &&
			/another tab/.test(s.fault ?? "") &&
			oneShotLeft === null,
		`${JSON.stringify(s)} one-shot left: ${oneShotLeft}`,
	);

	// The first tab plays on and saves after the second tab read the record, then
	// closes. Its lock goes with its document, and the second tab's Continue
	// straight after is the release timing #309 could not test headless.
	await tabA.waitForTimeout(1500);
	const savedByA = await tabA.evaluate(async () => {
		const g = window.__seelite;
		await g.saveStore.flush("quit");
		const raw = await g.save.backend.read("Probe One", "live");
		return raw.world.gameTime;
	});
	await tabA.close();
	await reloadedBy(tabB, () => tabB.keyboard.press("Enter"));
	s = await state(tabB);
	const resumedAt = await tabB.evaluate(
		() => window.__seelite.saveEnvelope().world.gameTime,
	);
	check(
		"Continue into a Commander another tab saved since this page read it reloads into that save, not over it",
		s.mode === "continue" &&
			s.attached === "Probe One" &&
			!s.open &&
			savedByA > 0 &&
			resumedAt >= savedByA,
		`${JSON.stringify(s)} saved by the first tab at ${savedByA}, resumed at ${resumedAt}`,
	);

	// -----------------------------------------------------------------------
	// 5. In play: the key, Export, and Rename and Delete in place
	// -----------------------------------------------------------------------
	const key = await tabB.evaluate(() => window.__seelite.commanderBoot.key);
	await tabB.keyboard.press(key);
	await waitFor(tabB, () => document.querySelector("[data-commander-overlay]"));
	const inPlayActions = await tabB.evaluate(() =>
		Object.fromEntries(
			[
				...document.querySelectorAll(
					'[data-commander="Probe One"] [data-action]',
				),
			].map((el) => [
				el.getAttribute("data-action"),
				el.getAttribute("aria-disabled"),
			]),
		),
	);
	const underOverlay = await clockAcross(tabB, 1000);
	check(
		"in play the key opens the overlay over a running world, with Load, Rename and Delete refused on the Commander in play",
		inPlayActions.load === "true" &&
			inPlayActions.rename === "true" &&
			inPlayActions.delete === "true" &&
			inPlayActions.export === "false" &&
			underOverlay.after > underOverlay.before,
		`${JSON.stringify(inPlayActions)} gameTime ${underOverlay.before} → ${underOverlay.after}`,
	);

	const noDownload = tabB
		.waitForEvent("download", { timeout: 1500 })
		.then(() => true)
		.catch(() => false);
	await tabB.click('[data-commander="Probe One"] [data-action="load"]');
	const disabledClick = {
		downloaded: await noDownload,
		open: (await state(tabB)).open,
		form: Boolean(await tabB.$("[data-field]")),
	};
	check(
		"a click on a refused action does nothing",
		!disabledClick.downloaded && disabledClick.open && !disabledClick.form,
		JSON.stringify(disabledClick),
	);

	const download = tabB.waitForEvent("download", { timeout: 15000 });
	await tabB.click('[data-commander="Probe One"] [data-action="export"]');
	const file = await download.catch(() => null);
	const exported = file ? readFileSync(await file.path(), "utf8") : "";
	let exportedLive = false;
	try {
		const live = JSON.parse(exported).live;
		// A record, not merely a key: `undefined !== null` passed a file with none.
		exportedLive = typeof live === "object" && live !== null;
	} catch {}
	check(
		"Export hands the player a file holding the Commander's save",
		file !== null &&
			file.suggestedFilename() === "Probe One.seelite-save.json" &&
			exportedLive,
		`${file?.suggestedFilename()} ${exported.length} bytes`,
	);

	await tabB.evaluate(async () => {
		const g = window.__seelite;
		await g.save.backend.write(
			"Spare",
			"live",
			g.save.serialize(g.saveEnvelope()),
		);
		window.__noReload = true;
	});
	await tabB.keyboard.press("Escape");
	await tabB.keyboard.press(key);
	await waitFor(tabB, () => document.querySelector('[data-commander="Spare"]'));
	await tabB.click('[data-commander="Spare"] [data-action="rename"]');
	await tabB.fill('[data-field="name"]', "Spare Two");
	await button(tabB, 0).click();
	const renamed = await waitFor(tabB, () =>
		document.querySelector('[data-commander="Spare Two"]'),
	);
	const slotsRenamed = await slotsOf(tabB);
	check(
		"Rename updates the overlay in place, without a reload",
		renamed &&
			(await tabB.evaluate(() => window.__noReload === true)) &&
			slotsRenamed.includes("Spare Two") &&
			!slotsRenamed.includes("Spare"),
		JSON.stringify(slotsRenamed),
	);

	await tabB.click('[data-commander="Spare Two"] [data-action="delete"]');
	// Asked, not merely changed view: the confirmation is on the glass and the
	// Commander is still on disk until it is answered.
	const askedFirst =
		(await tabB.evaluate(
			() =>
				document.querySelector("[data-commander]") === null &&
				(
					document.querySelector("#seelite-commander")?.textContent ?? ""
				).includes("for good"),
		)) && (await slotsOf(tabB)).includes("Spare Two");
	await button(tabB, 1).click();
	const deleted = await waitFor(
		tabB,
		() =>
			document.querySelector("[data-commander]") !== null &&
			document.querySelector('[data-commander="Spare Two"]') === null,
	);
	check(
		"Delete asks first, then removes the Commander without a reload",
		askedFirst &&
			deleted &&
			(await tabB.evaluate(() => window.__noReload === true)) &&
			!(await slotsOf(tabB)).includes("Spare Two"),
		JSON.stringify(await slotsOf(tabB)),
	);

	// -----------------------------------------------------------------------
	// 6. Import, out of a game in play
	// -----------------------------------------------------------------------
	await tabB.setInputFiles("[data-commander-import]", {
		name: "Imported.seelite-save.json",
		mimeType: "application/json",
		buffer: Buffer.from(exported),
	});
	const importName = await tabB
		.inputValue('[data-field="name"]')
		.catch(() => null);
	await reloadedBy(tabB, () => button(tabB, 0).click());
	s = await state(tabB);
	check(
		"Import reloads out of a game in play straight into the imported Commander",
		importName === "Imported" &&
			s.mode === "continue" &&
			s.attached === "Imported" &&
			!s.open,
		`${importName} ${JSON.stringify(s)}`,
	);

	// -----------------------------------------------------------------------
	// 7 and 8. A boot fault, and `?seed` without direct
	// -----------------------------------------------------------------------
	const second = await newContext();
	const tabC = await openPage(second);
	await tabC.evaluate(() =>
		window.__seelite.save.backend.write(
			window.__seelite.save.defaultSlot,
			"live",
			{ not: "a save" },
		),
	);
	await tabC.reload({ waitUntil: "load" });
	await bootedGame(tabC);
	s = await state(tabC);
	check(
		"a refused load opens the overlay with its message, naming the Commander",
		s.open &&
			/Commander "default"/.test(s.fault ?? "") &&
			!/\bslot\b/i.test(s.fault ?? "") &&
			(await tabC.getAttribute('[data-kind="continue"]', "aria-disabled")) ===
				"true" &&
			!s.store,
		JSON.stringify(s),
	);
	const rescue = tabC.waitForEvent("download", { timeout: 15000 });
	await tabC.click('[data-kind="export-fault"]');
	const rescued = await rescue.catch(() => null);
	const rescuedText = rescued ? readFileSync(await rescued.path(), "utf8") : "";
	check(
		"the overlay offers Export of the Commander the fault concerns, as it is on disk",
		rescued !== null && rescuedText.includes('"not": "a save"'),
		`${rescued?.suggestedFilename()} ${rescuedText.slice(0, 80)}`,
	);

	await tabC.evaluate(async () => {
		const g = window.__seelite;
		await g.save.backend.write(
			g.save.defaultSlot,
			"live",
			g.save.serialize(g.saveEnvelope()),
		);
	});
	const savedSeed = await tabC.evaluate(
		() => window.__seelite.saveEnvelope().world.seed,
	);
	await tabC.goto(OTHER_SEED_URL, { waitUntil: "load" });
	await bootedGame(tabC);
	s = await state(tabC);
	const keptWorld = await tabC.evaluate(
		() => window.__seelite.saveEnvelope().world.seed,
	);
	await tabC.keyboard.press("ArrowDown");
	await tabC.keyboard.press("Enter");
	const prefill = await tabC
		.inputValue('[data-field="seed"]')
		.catch(() => null);
	check(
		"`?seed` without `?boot=direct` sets nothing aside and only pre-fills New game",
		s.fault === null &&
			s.selected?.kind === "continue" &&
			keptWorld === savedSeed &&
			savedSeed !== OTHER_SEED &&
			prefill === String(OTHER_SEED),
		`${JSON.stringify(s)} world ${keptWorld} (saved ${savedSeed}) prefill ${prefill}`,
	);
	await tabC.close();

	// -----------------------------------------------------------------------
	// 9. The pad drives it as `modal`
	// -----------------------------------------------------------------------
	const padTab = await openPage(second, { pad: true });
	const press = async (index) => {
		await padTab.evaluate((i) => window.__pad.hold(i), index);
		await padTab.evaluate(() => window.__frames(3));
		await padTab.evaluate((i) => window.__pad.release(i), index);
		await padTab.evaluate(() => window.__frames(3));
	};
	const before = (await state(padTab)).selected;
	await press(STANDARD_INDEX.down);
	const moved = (await state(padTab)).selected;
	await press(STANDARD_INDEX.a);
	const form = await padTab.$('[data-field="seed"]');
	await press(STANDARD_INDEX.b);
	const backToMenu = await padTab.$('[data-kind="new-game"]');
	check(
		"the pad walks the overlay, opens a row and backs out of it",
		before?.kind === "continue" &&
			moved?.kind === "new-game" &&
			form !== null &&
			backToMenu !== null,
		JSON.stringify({ before, moved, form: form !== null }),
	);
} finally {
	for (const context of contexts) await context.close().catch(() => {});
	await browser.close();
}
exit();
