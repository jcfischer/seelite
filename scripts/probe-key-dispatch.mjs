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
	"and does not leave the arrow held as yaw",
	(await held("arrowright")) === false,
	`keys.has("arrowright"): ${await held("arrowright")}`,
);

// ---------------------------------------------------------------------------
// Ctrl+J engages nothing, and Ctrl alone is still the throttle.
// ---------------------------------------------------------------------------
const beforeCtrl = await state();
await keyEvent("rawKeyDown", "Control", "ControlLeft", CTRL);
await keyEvent("rawKeyDown", "j", "KeyJ", CTRL);
await settle(page);
const ctrlHeld = await held("control");
const jHeld = await held("j");
const afterCtrl = await state();
await keyEvent("keyUp", "j", "KeyJ", CTRL);
await keyEvent("keyUp", "Control", "ControlLeft", 0);
await settle(page);
check(
	"Ctrl+J neither holds J nor starts the cruise spool",
	jHeld === false &&
		afterCtrl.spool === beforeCtrl.spool &&
		afterCtrl.regime === beforeCtrl.regime,
	`j held ${jHeld}, spool ${beforeCtrl.spool} -> ${afterCtrl.spool}, regime ${afterCtrl.regime}`,
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
const beforeF1 = await state();
await page.keyboard.press("F1");
await settle(page);
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
await page.keyboard.press("F1");
await settle(page);
const closedF1 = await state();
check(
	"F1 again turns the head forward and gives the tab back",
	closedF1.head === "forward" && closedF1.tab === beforeF1.tab,
	`${JSON.stringify(beforeF1)} -> ${JSON.stringify(closedF1)}`,
);

await browser.close();
exit();
