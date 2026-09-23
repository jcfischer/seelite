/**
 * The rebind modal, in a browser (#381 slice 4, #369 D9).
 *
 * Two rows nothing headless can produce, and they are the two the node names.
 *
 * **The stick on the frame after the modal suspended it.** `capture` is a
 * context whose whole job is to admit the sticks while the ship ignores them,
 * and that only means anything in a running game: `contextFliesShip` is false
 * there, `padFlightAxes` returns nothing, and the modal still has to see the
 * push. A unit test can call both functions; it cannot show that the frame
 * loop routes one and not the other.
 *
 * **And the bootstrap.** #369 D12 makes `z` remappable, so the settings key is
 * no longer a guaranteed way in — the guarantee is that the `Controls` tab is
 * reached by a head-turn and carries a door no binding table holds. The row
 * moves every door trigger somewhere else and then reaches both anyway.
 *
 * **What it is not.** C11 was written as "unbind everything", and there is no
 * unbind: `rebind` moves and never removes, and S4 ships no verb that would.
 * So the reachable version of that question is *move* every door, which is
 * what a player can actually do. `tests/bind-time.test.ts` holds the other
 * half — that nothing can lose its last trigger.
 */
import { installFakePad, STANDARD_INDEX } from "./lib/fake-pad.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.addInitScript(installFakePad);
await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
await bootedGame(page);

const frames = (n = 3) => page.evaluate((k) => window.__frames(k), n);
const openControlsTab = async () => {
	await page.keyboard.press("?");
	await frames();
};
/**
 * Click something, and say so rather than throwing when it is not there.
 *
 * **`probe-rebind.mjs`'s rule, which this file broke on its first red build.**
 * A `page.click` on a missing element throws at top level, which aborts before
 * `browser.close()` and `exit()` — so a build that removes the thing under
 * test crashes the suite instead of naming a failing row. The red build that
 * deleted the settings door did exactly that: no verdict, just a stack. A
 * probe has to be able to report the absence of what it is about.
 */
const clickIfShown = async (selector) => {
	if (!(await shown(selector))) return false;
	await page.click(selector);
	await frames();
	return true;
};

/** Open the modal on the first trigger of `command`, through the tab's own row. */
const openModalOn = async (command) =>
	clickIfShown(`[data-live-controls-row="${command}"]`);
const modalText = () =>
	page.evaluate(
		() =>
			document
				.querySelector("[data-capture-modal]")
				?.textContent?.replace(/\s+/g, " ")
				.trim() ?? "",
	);
const view = () => page.evaluate(() => window.__seelite.view);

/**
 * Whether a selector is *drawn*, not merely present.
 *
 * **`page.$` is not this question**, and a check written with it passed on a
 * hidden element the first time this probe ran: the right console's DOM is
 * built whatever the head is doing and hidden with `display`, so the tab's
 * door resolved fine while nothing was on screen. `checkVisibility` is the
 * one that answers reachability, and every row below that says "reached" uses
 * it.
 */
const shown = (selector) =>
	page.evaluate(
		(sel) => document.querySelector(sel)?.checkVisibility() === true,
		selector,
	);

// ---------------------------------------------------------------------------
// The stick, on the frame after the modal took the pad
// ---------------------------------------------------------------------------

await openControlsTab();
// **`view.toggle`, and the row opens on its *key*.** `main.ts` opens the modal
// on the first of a command's triggers, which for this one is `v` — so the
// capture below is the cross-device move #369 D12 is about, and what it does
// is a state this page reports (`__seelite.view`) rather than a row in a
// table. A check that the table changed has not checked that the ship flew.
await openModalOn("view.toggle");

check(
	"the tab's row opens the modal",
	(await page.$("[data-capture-modal]")) !== null,
	"the modal is up",
);

/**
 * **A control, not a floor** — and the first version of this row was a floor.
 *
 * It read the nose over eight frames with the stick over and asked for under
 * half a degree. The red build that should have failed it — `capture` added to
 * `contextFliesShip` — moved the nose 0.43° and passed, because eight frames
 * is a tenth of a second and the threshold was guessed rather than measured.
 * A bound nobody derived is a bound that admits the build it was meant to
 * refuse (this repo's "a limit is the first failure", on the other axis).
 *
 * So the arm is a comparison: the same window, the same length, with the stick
 * at rest and with it over. A suspended context makes those two the same
 * reading; a context that flies makes the second one many times the first, and
 * the row prints both so the separation is on the page rather than in a
 * constant.
 */
const nose = () => page.evaluate(() => window.__seelite.nose());
const degreesBetween = (a, b) => {
	const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
	return (Math.acos(dot) * 180) / Math.PI;
};
/** How far the nose moves over `n` frames, from wherever it is now. */
const drift = async (n) => {
	const start = await nose();
	await frames(n);
	return degreesBetween(start, await nose());
};

const WINDOW = 40;
// The control first, while the sticks are still centred.
const atRest = await drift(WINDOW);
await page.evaluate(() => window.__pad.axes(0, 0, 1, 0));
const turned = await drift(WINDOW);
const caught = await modalText();

check(
	"a stick pushed while the modal is up is caught by it",
	/stick/i.test(caught),
	caught || "(the modal said nothing)",
);

check(
	"and the ship does not answer it — the context suspended the axes",
	// Against the control and against an absolute, because either alone can be
	// satisfied by a broken instrument: a page that stopped rendering makes
	// both readings zero, and a page that is tumbling makes both large.
	turned < Math.max(atRest * 3, 0.2),
	`the nose moved ${turned.toFixed(2)}° with the stick over, against ${atRest.toFixed(2)}° at rest over the same ${WINDOW} frames`,
);

check(
	"the stick is refused in the player's words, with no trigger hash on screen",
	!caught.includes("::") && !caught.includes("padFlightAxes"),
	caught,
);

check(
	"and it is refused rather than offered — there is nothing to bind",
	(await page.$("[data-capture-confirm]")) === null,
	"no confirm control is drawn",
);

// The stick has to come back to rest before anything else is a push; the edge
// is what keeps a stick the player never let go of from binding itself.
await page.evaluate(() => window.__pad.rest());
await frames(3);

// ---------------------------------------------------------------------------
// A pad button, captured and flown
// ---------------------------------------------------------------------------

// `home` is the one standard button the shipped layout leaves free.
await page.evaluate((i) => window.__pad.hold(i), STANDARD_INDEX.home);
await frames(3);
await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.home);
await frames(2);

check(
	"a pad button is caught and offered, where the stick was refused",
	(await page.$("[data-capture-confirm]")) !== null,
	await modalText(),
);

await clickIfShown("[data-capture-confirm]");

check(
	"and the modal closes on the bind, handing the pad back",
	(await page.$("[data-capture-modal]")) === null,
	"the modal is gone",
);

// **Now fly it.** The head goes forward first, because a console claims six
// buttons and `home` is not one of them — but the context has to be `flight`
// for the press to reach the ship at all, and a row that skipped this would
// be measuring the console's suspension instead.
await page.keyboard.press("2");
await frames(3);
const wasView = await view();
await page.evaluate((i) => window.__pad.hold(i), STANDARD_INDEX.home);
await frames(3);
await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.home);
await frames(3);
const nowView = await view();

check(
	"the button the player just captured flies the command — not the table, the ship",
	nowView !== wasView,
	`${wasView} -> ${nowView}`,
);

// And the key it came off no longer does, which is the half that separates a
// move from an addition.
await page.keyboard.press("v");
await frames(3);

check(
	"and the key it was moved off no longer does",
	(await view()) === nowView,
	`v left the view at ${await view()}`,
);

// ---------------------------------------------------------------------------
// The bootstrap: move every door, and still get in
// ---------------------------------------------------------------------------

// Every keyboard trigger that stands between a player and the rebind surface:
// the reference chord and key, the head turns that reach the tab, and the
// settings key itself. Moved onto the digits the shipped layout leaves free,
// which `tests/commands.test.ts` names as `4`-`8`.
const moved = await page.evaluate(() => {
	const out = [];
	for (const [command, to] of [
		["view.reference", "4"],
		["view.headStarboard", "5"],
		["system.settings", "6"],
	]) {
		const row = window.__seelite
			.layoutInForce()
			.find((b) => b.command === command && b.trigger.kind === "key");
		if (!row) {
			out.push(`${command}: no key row`);
			continue;
		}
		try {
			window.__seelite.rebindCommand(command, row.trigger, {
				kind: "key",
				key: to,
				...(row.trigger.hold ? { hold: true } : {}),
				...(row.trigger.alt ? { alt: true } : {}),
			});
			out.push(`${command}: -> ${to}`);
		} catch (e) {
			out.push(`${command}: ${e.message}`);
		}
	}
	return out;
});

check(
	"every door's key is moved off the one it shipped on",
	moved.every((m) => m.includes("->")),
	moved.join(" | "),
);

// **Back to the cockpit first.** The rows above left the view in chase — the
// capture flew, which is what they were for — and `controlsKeyMove` abstains
// outside the cockpit for the reason head-look does. `home` is the view toggle
// now, which is itself a small proof that the capture stuck.
await page.evaluate((i) => window.__pad.hold(i), STANDARD_INDEX.home);
await frames(3);
await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.home);
await frames(3);
check(
	"the captured button gets back to the cockpit",
	(await view()) === "cockpit",
	await view(),
);

// The head turn is what reaches the tab, and it is on `5` now.
await page.keyboard.press("2");
await frames(3);
await page.keyboard.press("5");
await frames(3);

check(
	"the Controls tab is still reached, on the key the player moved it to",
	await shown("[data-live-controls-action]"),
	"the tab's door is drawn",
);

const openedSettings = await clickIfShown("[data-live-controls-action]");

check(
	"and settings opens from the tab, with no bindable key pressed at all",
	openedSettings && (await shown("[data-settings-panel]")),
	openedSettings
		? "the settings panel is drawn"
		: "the tab has no door to click",
);

await browser.close();
exit();
