/**
 * The keyboard's dispatch law, in the page (#377).
 *
 * `tests/key-dispatch.test.ts` holds the law itself; `main.ts` cannot load
 * headless, so this probe holds the wiring: that `onKey` acts on the law's
 * answer. Each row is one of the principal's four rulings, read off the game's
 * own state.
 *
 * **Keys go in through CDP's `Input.dispatchKeyEvent`, not `page.keyboard`.**
 * The row that matters most is a *held* chord, and Playwright's keyboard never
 * sets `repeat`, so a probe written with it could not reach the hole this node
 * closes. CDP's `autoRepeat` delivers a real repeated keydown from the browser,
 * with the modifier bits a held Alt or Ctrl would set.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const ALT = 1;
const CTRL = 2;

const settle = (page) =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
await bootedGame(page);
const cdp = await page.context().newCDPSession(page);

/** One real key event. `key`/`code` as the browser reports them. */
const keyEvent = (type, key, code, modifiers = 0, autoRepeat = false) =>
	cdp.send("Input.dispatchKeyEvent", {
		type,
		key,
		code,
		modifiers,
		autoRepeat,
		windowsVirtualKeyCode: VK[code] ?? 0,
	});
const VK = {
	AltLeft: 18,
	ControlLeft: 17,
	KeyD: 68,
	KeyJ: 74,
	ArrowRight: 39,
	F1: 112,
};

const held = (key) => page.evaluate((k) => window.__seelite.keys.has(k), key);
const state = () =>
	page.evaluate(() => ({
		head: window.__seelite.headLook,
		tab: window.__seelite.rightTab,
		throttle: window.__seelite.throttle,
		spool: window.__seelite.spoolLeftS,
		regime: window.__seelite.regime,
	}));

// ---------------------------------------------------------------------------
// A held Alt+D does not yaw the ship.
// ---------------------------------------------------------------------------
await keyEvent("rawKeyDown", "Alt", "AltLeft", ALT);
await keyEvent("rawKeyDown", "d", "KeyD", ALT);
for (let i = 0; i < 3; i++)
	await keyEvent("rawKeyDown", "d", "KeyD", ALT, true);
await settle(page);
const altD = await held("d");
await keyEvent("keyUp", "d", "KeyD", ALT);
await keyEvent("keyUp", "Alt", "AltLeft", 0);
await settle(page);
check(
	"a held Alt+D never reaches the held keys — the repeat that yawed the ship",
	altD === false,
	`keys.has("d") while held: ${altD}`,
);

// Guard the guard: the same D, with no Alt, is held. Without this row the one
// above would pass on a page whose key listener was not attached at all.
await keyEvent("rawKeyDown", "d", "KeyD", 0);
await keyEvent("rawKeyDown", "d", "KeyD", 0, true);
await settle(page);
const plainD = await held("d");
await keyEvent("keyUp", "d", "KeyD", 0);
await settle(page);
check(
	"and a held D without Alt is held, so the row above can fail",
	plainD === true && (await held("d")) === false,
	`held ${plainD}, after release ${await held("d")}`,
);

// ---------------------------------------------------------------------------
// The chord still turns the head, once.
// ---------------------------------------------------------------------------
await keyEvent("rawKeyDown", "Alt", "AltLeft", ALT);
await keyEvent("rawKeyDown", "ArrowRight", "ArrowRight", ALT);
await settle(page);
const chord = await state();
// Read while the chord is still down: after the release every key is clear,
// so a read there could never fail (sage round 1).
const arrowHeld = await held("arrowright");
await keyEvent("keyUp", "ArrowRight", "ArrowRight", ALT);
await keyEvent("keyUp", "Alt", "AltLeft", 0);
await page.keyboard.press("2");
await settle(page);
check(
	"Alt+→ turns the head to the starboard console",
	chord.head === "right",
	`head=${chord.head}`,
);
check(
	"and does not hold the arrow as yaw while the chord is down",
	arrowHeld === false,
	`keys.has("arrowright") during the chord: ${arrowHeld}`,
);

// ---------------------------------------------------------------------------
// Ctrl+J runs no command, keys pressed while braking on Ctrl still fly, and
// Ctrl alone is still the throttle (ruling 3 as refined on #377).
// ---------------------------------------------------------------------------
const beforeCtrl = await state();
await keyEvent("rawKeyDown", "Control", "ControlLeft", CTRL);
await keyEvent("rawKeyDown", "j", "KeyJ", CTRL);
await keyEvent("rawKeyDown", "d", "KeyD", CTRL);
await settle(page);
const ctrlHeld = await held("control");
const dHeld = await held("d");
const afterCtrl = await state();
await keyEvent("keyUp", "d", "KeyD", CTRL);
await keyEvent("keyUp", "j", "KeyJ", CTRL);
await keyEvent("keyUp", "Control", "ControlLeft", 0);
await settle(page);
check(
	"Ctrl+J does not start the cruise spool",
	afterCtrl.spool === beforeCtrl.spool &&
		afterCtrl.regime === beforeCtrl.regime,
	`spool ${beforeCtrl.spool} -> ${afterCtrl.spool}, regime ${afterCtrl.regime}`,
);
check(
	"and D pressed while braking on Ctrl is held, so the ship can still turn",
	dHeld === true,
	`keys.has("d") under Ctrl: ${dHeld}`,
);
check(
	"and the Control key itself is held, which is THROTTLE_DOWN",
	ctrlHeld === true,
	`keys.has("control"): ${ctrlHeld}`,
);

// Guard: J without Ctrl does start the spool, so the row above can fail.
await page.keyboard.press("j");
await settle(page);
const spooled = await state();
check(
	"and a bare J does start it, so the Ctrl row can fail",
	spooled.spool > 0 || spooled.regime === "cruise",
	`spool ${spooled.spool}, regime ${spooled.regime}`,
);
await page.keyboard.press("j");
await settle(page);

// ---------------------------------------------------------------------------
// F1 opens and closes the Controls tab, with no throttle on the way in.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
	window.__f1Prevented = null;
	window.addEventListener("keydown", (e) => {
		if (e.key === "F1") window.__f1Prevented = e.defaultPrevented;
	});
});
/**
 * A key pressed at a hand's pace: down, a beat, up. `press()` sends both in
 * one task, and a row that measures what happens *between* them — the throttle
 * — has to leave frames there (sage round 1).
 */
const pacedPress = async (key) => {
	await page.keyboard.down(key);
	await page.waitForTimeout(120);
	await page.keyboard.up(key);
	await settle(page);
};
const beforeF1 = await state();
await pacedPress("F1");
const openF1 = await state();
check(
	"F1 turns the head to starboard and selects Controls",
	openF1.head === "right" && openF1.tab === "Controls",
	JSON.stringify(openF1),
);
check(
	"and the throttle does not move on the way in",
	openF1.throttle === beforeF1.throttle,
	`${beforeF1.throttle} -> ${openF1.throttle}`,
);
check(
	"and the browser's help is kept out",
	(await page.evaluate(() => window.__f1Prevented)) === true,
	`defaultPrevented: ${await page.evaluate(() => window.__f1Prevented)}`,
);
await pacedPress("F1");
const closedF1 = await state();
check(
	"F1 again turns the head forward and gives the tab back",
	closedF1.head === "forward" && closedF1.tab === beforeF1.tab,
	`${JSON.stringify(beforeF1)} -> ${JSON.stringify(closedF1)}`,
);

// ---------------------------------------------------------------------------
// A word typed into the Navigation filter flies nothing (#380).
//
// Read off the simulation, not the field: the target the game holds, the keys
// it holds, and where the head is turned. `g` in `cargo` is `cycleTarget(-1)`,
// and `1`/`3` turn the head off the console the field is on.
// ---------------------------------------------------------------------------
await page.keyboard.press("1");
await settle(page);
const filter = page.locator("[data-live-nav-query]");
await filter.click();
const sim = () =>
	page.evaluate(() => ({
		target: window.__seelite.targetId,
		head: window.__seelite.headLook,
		keys: [...window.__seelite.keys],
	}));
const beforeTyping = await sim();
await page.keyboard.type("cargo 13");
const typedValue = await filter.inputValue();
// A held flight key in the field, read while it is still down.
await page.keyboard.down("e");
await page.keyboard.down("e");
await settle(page);
const whileHeld = await sim();
await page.keyboard.up("e");
await settle(page);
const afterTyping = await sim();
const stillFocused = await filter.evaluate(
	(el) => el === document.activeElement,
);
check(
	"typing `cargo 13` into the Navigation filter leaves the target where it was",
	afterTyping.target === beforeTyping.target,
	`target ${beforeTyping.target} -> ${afterTyping.target}`,
);
check(
	"and the head on the port console, with the field still focused",
	afterTyping.head === "left" && stillFocused,
	`head ${afterTyping.head}, focused ${stillFocused}`,
);
check(
	"and a flight key held in the field is not held by the game",
	whileHeld.keys.length === 0 && afterTyping.keys.length === 0,
	`held while down: [${whileHeld.keys}], after: [${afterTyping.keys}]`,
);
check(
	"and the field keeps every character, Space included",
	typedValue === "cargo 13",
	`value ${JSON.stringify(typedValue)}`,
);

// Guard: the same `g` with the field blurred does cycle the target, so the
// target row above can fail.
// Cleared through the page rather than `fill`: on a build that leaks, `3`
// turned the head and the field is hidden, and `fill` would wait on it.
await filter.evaluate((el) => {
	el.value = "";
	el.dispatchEvent(new Event("input", { bubbles: true }));
	el.blur();
});
await page.keyboard.press("g");
await settle(page);
const outside = await sim();
check(
	"and a `g` outside the field does cycle the target, so the row can fail",
	outside.target !== afterTyping.target,
	`target ${afterTyping.target} -> ${outside.target}`,
);
await page.keyboard.press("2");
await settle(page);

// ---------------------------------------------------------------------------
// And the chart's FIND SYSTEM field, the second of the two (#380, sage
// round 1): the gate is `isEditable`, not a selector for one field, and this
// row is what shows it reaches the other.
// ---------------------------------------------------------------------------
const leftTab = (name) =>
	page.evaluate((tab) => {
		const el = document.querySelector(`[data-live-left-tab="${tab}"]`);
		if (!(el instanceof HTMLElement)) throw new Error(`no ${tab} tab`);
		el.click();
	}, name);
await page.keyboard.press("1");
await settle(page);
await leftTab("Galaxy Map");
await page.waitForFunction(() => Boolean(window.__seeliteGalaxyMap));
const finder = page.locator("[data-map-finder-query]");
await finder.click();
const beforeFinder = await sim();
await page.keyboard.type("g 13");
await settle(page);
const afterFinder = await sim();
const finderValue = await finder.inputValue();
check(
	"typing `g 13` into FIND SYSTEM leaves the target and the head where they were",
	afterFinder.target === beforeFinder.target &&
		afterFinder.head === "left" &&
		afterFinder.keys.length === 0,
	`target ${beforeFinder.target} -> ${afterFinder.target}, head ${afterFinder.head}, keys [${afterFinder.keys}]`,
);
check(
	"and FIND SYSTEM keeps every character",
	finderValue === "g 13",
	`value ${JSON.stringify(finderValue)}`,
);
await finder.evaluate((el) => {
	el.value = "";
	el.dispatchEvent(new Event("input", { bubbles: true }));
	el.blur();
});
await page.keyboard.press("1");
await settle(page);
await leftTab("Navigation");
await page.keyboard.press("2");
await settle(page);

// Guard: the same paced measurement does see the Shift blip on `?`, so the
// F1 throttle row above can fail. Last, because it leaves the throttle raised.
const beforeQuestion = await state();
await page.keyboard.down("Shift");
await page.waitForTimeout(120);
await page.keyboard.press("Slash");
await page.keyboard.up("Shift");
await settle(page);
const afterQuestion = await state();
check(
	"and a paced ? does move it, so the F1 throttle row can fail",
	afterQuestion.throttle > beforeQuestion.throttle,
	`${beforeQuestion.throttle} -> ${afterQuestion.throttle}`,
);

await browser.close();
exit();
