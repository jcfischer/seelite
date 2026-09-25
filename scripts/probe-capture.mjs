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
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { installFakePad, STANDARD_INDEX } from "./lib/fake-pad.mjs";
import { degreesBetween, flightHarness } from "./lib/flight-harness.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
	waitForSettingsPanel,
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
/**
 * The text of one part of the modal, by class.
 *
 * **Never the whole modal** (sage round 4 on #497). The rows below read
 * `/stick/i` out of it, and the *listening* stage prints "Press a key, or a
 * button, stick or trigger on the pad" — so a build where the stick never
 * reached the modal at all passed the row that says it was caught, and passed
 * the no-hash row after it. A check that cannot fail is the thing this repo
 * keeps finding, and this one was written into the probe that was supposed to
 * be the evidence.
 */
const partText = (selector) =>
	page.evaluate(
		(sel) =>
			document
				.querySelector(`[data-capture-modal] ${sel}`)
				?.textContent?.replace(/\s+/g, " ")
				.trim() ?? "",
		selector,
	);
/** What the modal says it caught, and nothing else. */
const caughtText = () => partText(".capture-caught");
/** Why it will not take it, in the player's words. */
const refusedText = () => partText(".capture-refused");
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
 * at rest and with it over.
 *
 * **And the replacement bound is measured, which the first one was not** —
 * sage round 1 on #497 pointed out that it was otherwise as underived as the
 * floor it indicts. On this build both readings are 0.00°; with `capture`
 * added to `contextFliesShip` the pushed arm reads **9.67°** over the same
 * forty frames. `max(atRest × 3, 0.2)` sits two orders of magnitude under that
 * and above any drift the rest gate leaves behind. Both readings are printed,
 * so a machine that disagrees says so on the page rather than through a
 * constant nobody can check.
 */
// **From the harness, not a third copy** (sage round 1 on #497). #381 S4
// extracted `scripts/lib/flight-harness.mjs` on the argument that this file
// would be the third copy of the angle maths — and then wrote one anyway.
const { nose } = flightHarness(page);
/** How far the nose moves over `n` frames, from wherever it is now. */
const drift = async (n) => {
	const start = await nose();
	await frames(n);
	return degreesBetween(start, await nose());
};

const WINDOW = 40;
// The control first, while the sticks are still centred.
const atRest = await drift(WINDOW);
// **Count what the modal is offered, because "caught" cannot see "caught
// forty times".** The edge was not holding in the game: `main.ts` kept the
// previous `PadFrame` and compared against an object that had changed under
// it, so a stick held over was re-offered on every frame while the row below
// — which asks only whether the modal caught *a* stick and whether the ship
// moved — stayed green, and the unit test stayed green because it passes an
// explicit rest frame. Found by a page error, not by a check.
await page.evaluate(() => {
	window.__offers = 0;
	const modal = window.__seelite.captureModal;
	const inner = modal.offer;
	modal.offer = (t) => {
		window.__offers += 1;
		return inner(t);
	};
});
await page.evaluate(() => window.__pad.axes(0, 0, 1, 0));
const turned = await drift(WINDOW);
const offers = await page.evaluate(() => window.__offers);
const caught = await caughtText();
const refused = await refusedText();

check(
	"a stick pushed while the modal is up is caught by it",
	// Out of `.capture-caught`, which only a stage that caught something
	// draws — and it names the stick rather than merely mentioning one.
	/stick/i.test(caught),
	caught || "(the modal caught nothing)",
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
	"and it is offered once, not on every frame the stick is over",
	offers === 1,
	`the modal was offered ${offers} times across ${WINDOW} frames`,
);

check(
	"the stick is refused in the player's words, with no trigger hash on screen",
	// A refusal has to be *drawn*, and then it has to be English. The first
	// version read both out of the whole modal, where the listening prompt
	// satisfied the first half on its own.
	refused.length > 0 &&
		!refused.includes("::") &&
		!refused.includes("padFlightAxes"),
	refused || "(the modal drew no refusal)",
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

/** Press a pad button and let go, the way a player does. */
const tapPad = async (index) => {
	await page.evaluate((i) => window.__pad.hold(i), index);
	await frames(3);
	await page.evaluate((i) => window.__pad.release(i), index);
	await frames(3);
};

// `home` is the one standard button the shipped layout leaves free.
await tapPad(STANDARD_INDEX.home);

check(
	"a pad button is caught and offered, where the stick was refused",
	(await page.$("[data-capture-confirm]")) !== null &&
		(await refusedText()) === "",
	`caught ${await caughtText()}`,
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
await tapPad(STANDARD_INDEX.home);
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

// **Every key row of every door, not the first one** (sage round 1 on #497).
// The first version took `.find(… kind === "key")` while the prose said "every
// door trigger": `view.reference` is `?` **and** `F1`, and `view.headStarboard`
// is `3` and the `Alt+→` chord — so two of the three doors kept a keyboard way
// in, and the row could not show what it claimed.
//
// The pad rows are deliberately left where they are. The reach #369 D9 calls
// structural *is* the head-turn and the shoulder, so moving those would ask a
// different question — whether a player can shut themselves out of the
// keyboard and the pad at once — which no single layout edit does.
//
// Moved onto the characters the shipped layout leaves free, which
// `tests/commands.test.ts` names: `4`, `5`, `7`, `8` and the backslash. `6` left
// the pool when the Postcard screen took it (#406), and the three doors hold
// five key rows, so the backslash is the fifth rather than a spare.
const FREE_KEYS = ["4", "5", "7", "8", "\\"];
const DOORS = ["view.reference", "view.headStarboard", "system.settings"];
const moved = await page.evaluate(
	({ free, doors }) => {
		const out = [];
		let next = 0;
		for (const command of doors) {
			const rows = window.__seelite
				.layoutInForce()
				.filter((b) => b.command === command && b.trigger.kind === "key");
			if (rows.length === 0) {
				out.push(`${command}: no key row`);
				continue;
			}
			for (const row of rows) {
				const to = free[next++];
				if (to === undefined) {
					out.push(`${command}: ran out of free keys`);
					continue;
				}
				try {
					window.__seelite.rebindCommand(command, row.trigger, {
						kind: "key",
						key: to,
						...(row.trigger.hold ? { hold: true } : {}),
						...(row.trigger.alt ? { alt: true } : {}),
					});
					out.push(`${command}: ${row.trigger.key} -> ${to}`);
				} catch (e) {
					out.push(`${command}: ${e.message}`);
				}
			}
		}
		return out;
	},
	{ free: FREE_KEYS, doors: DOORS },
);

check(
	"every key row of every door is moved off the one it shipped on",
	moved.length >= 5 && moved.every((m) => m.includes("->")),
	moved.join(" | "),
);

check(
	"and no door keeps a key it shipped on",
	await page.evaluate(
		({ free, doors }) =>
			window.__seelite
				.layoutInForce()
				.filter((b) => doors.includes(b.command) && b.trigger.kind === "key")
				.every((b) => free.includes(b.trigger.key)),
		{ free: FREE_KEYS, doors: DOORS },
	),
	"every remaining key row of the three doors is on a key the player chose",
);

// **Back to the cockpit first.** The rows above left the view in chase — the
// capture flew, which is what they were for — and `controlsKeyMove` abstains
// outside the cockpit for the reason head-look does. `home` is the view toggle
// now, which is itself a small proof that the capture stuck.
await tapPad(STANDARD_INDEX.home);
check(
	"the captured button gets back to the cockpit",
	(await view()) === "cockpit",
	await view(),
);

// **`view.reference` is the door, and the free keys go out in order**, so it
// holds `4` (was `?`) and `5` (was `F1`). Pressing either turns the head to
// starboard *and* selects the tab, which a bare head turn does not — that
// shows whichever right tab was last picked. `2` first, so the head is forward
// and the turn is a turn.
//
// A comment here read "the head turn is what reaches the tab, and it is on `5`
// now", which stopped being true the moment this block began moving every key
// row rather than the first: `view.headStarboard` is on `6` and `7`.
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

// **And the key the player moved off is dead, pressed rather than read off
// the table** (sage round 5 on #497). The move row above is the surrogate this
// file's own header warns against: `settings-panel.ts` owns `SETTINGS_KEY` on
// a window listener in the capture phase, so "the table says `z` moved" is a
// different fact from "`z` no longer opens the panel", and the bootstrap's
// claim is about the second.
//
// **After the door has opened it once**, which is what makes the row able to
// fail in the direction it names: a build where the panel never mounts would
// satisfy "z did not open it" for the wrong reason. `waitForSettingsPanel`'s
// answer is read here for that, and the row above has already shown the panel
// on screen.
const panelMounted = await waitForSettingsPanel(page);
// **Closed from the screen itself, so the press below is measured from a
// closed state.** The first version pressed `z` while the door's panel was
// still up, where `z` is the screen's own close key — so the row named "no
// longer opens it" was reading a close (sage round 6 on #497). Escape is the
// panel's other way out and is not the key under test.
await page.keyboard.press("Escape");
await frames(3);
check(
	"the door's panel closes, so the key below is pressed from a closed screen",
	panelMounted && !(await shown("[data-settings-panel]")),
	panelMounted ? "closed" : "the settings screen never mounted",
);
await page.keyboard.press("z");
await frames(3);
check(
	"the settings key the player moved off no longer opens it",
	!(await shown("[data-settings-panel]")),
	"z is dead",
);

await browser.close();
exit();
