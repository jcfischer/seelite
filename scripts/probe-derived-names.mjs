/**
 * Every key name the game prints, read off the screen after a rebind, and the
 * key it names pressed (#381 S5).
 *
 * #369 D11 gives every printed control name one owner, and
 * `tests/derived-names.test.ts` holds that each surface's *builder* reads the
 * layout. That is a table changing. This file asks the question a player
 * asks — **does the key the screen names do what the screen says** — because
 * S4's round 5 found `z` was never remappable while the row that should have
 * seen it read `layoutInForce()` instead of pressing the key. So every row
 * here has the same three arms:
 *
 * 1. move the command to a key the shipped layout leaves free;
 * 2. read the name **off what is drawn** — a panel's text where it is DOM, and
 *    the draw record (`cockpitPrompt`, `overlayLines`) where it is canvas —
 *    and require it to name the new key;
 * 3. press **the name it read**, not the key this file chose, and observe the
 *    effect the screen promised — and, where the old key could still be
 *    reached by accident, press that too and observe nothing.
 *
 * Arm 3 is why the pressed key is parsed out of the text rather than reused
 * from arm 1: a surface that printed the right string by coincidence — or a
 * dead string beside a live key — fails here and nowhere else.
 *
 * **What is not read here.** The jump prompt needs a set course and shares its
 * builder and its wiring with the cruise prompt read below; the save-fault
 * badge needs a forced write failure, which `probe-save.mjs` owns and a second
 * copy of would be the interference that file's timing is sensitive to. Both
 * are held headless in `tests/derived-names.test.ts`. The pad hint cannot be
 * moved by any layout — a panel intent is not offered for rebinding — so
 * `probe-pad-panels.mjs` reading it on screen is the whole of its browser
 * evidence.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
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

/**
 * The keys the shipped layout leaves free, which `tests/commands.test.ts`
 * names; one per row on a page, so no row's move collides with another's.
 */
const FREE = { commander: "4", settings: "5", cruise: "6", target: "7" };

/**
 * A page, booted, with the few readers every row uses.
 *
 * Each `browser.newPage` is its own context, so a layout one page saves to
 * storage never reaches the next.
 */
async function open(query = {}) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 760 },
	});
	watch(page);
	await page.addInitScript(installFakePad);
	await page.goto(gameUrl(origin, { seed: 42, ...query }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	const frames = (n = 3) => page.evaluate((k) => window.__frames(k), n);
	/** The drawn text of `selector`, or `null` when it is not drawn. */
	const drawn = (selector) =>
		page.evaluate((sel) => {
			const el = document.querySelector(sel);
			return el?.checkVisibility() ? (el.textContent ?? "").trim() : null;
		}, selector);
	/**
	 * Move `command`'s first keyboard trigger to `to`, keeping the qualifiers
	 * that are the command's (`rebind` refuses a move that drops a `hold`).
	 */
	const move = (command, to) =>
		page.evaluate(
			({ command, to }) => {
				const row = window.__seelite
					.layoutInForce()
					.find((b) => b.command === command && b.trigger.kind === "key");
				if (!row) return `${command}: no key row`;
				const { code: _code, ...qualifiers } = row.trigger;
				window.__seelite.rebindCommand(command, row.trigger, {
					...qualifiers,
					key: to,
				});
				return null;
			},
			{ command, to },
		);
	/**
	 * A printed key name as Playwright presses it. Single characters only:
	 * every row moves its command onto one, so a longer name here is the
	 * surface printing something other than the key it was given.
	 */
	const press = async (name) => {
		if (typeof name !== "string" || [...name].length !== 1) return false;
		await page.keyboard.press(name);
		await frames();
		return true;
	};
	return { page, frames, drawn, move, press };
}

// ---------------------------------------------------------------------------
// The legend strip is gone, not hidden
// ---------------------------------------------------------------------------

const game = await open();

check(
	"the key legend along the bottom of the frame is not on the page",
	await game.page.evaluate(() => document.getElementById("keys") === null),
	"#369 D11: generated or deleted, and the principal ruled delete",
);

// ---------------------------------------------------------------------------
// The settings screen: its footer names the key that closes it
// ---------------------------------------------------------------------------

{
	const { page, drawn, move, press } = game;
	const moved = await move("system.settings", FREE.settings);
	await press("z");
	const openedByOld = (await drawn("[data-settings-panel]")) !== null;
	await press(FREE.settings);
	const footer = await drawn("[data-settings-panel] .hint");
	const named = /Esc or (\S+) to close/.exec(footer ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const closed = (await drawn("[data-settings-panel]")) === null;
	check(
		"settings: the footer names the moved key, and that key closes the screen",
		moved === null &&
			!openedByOld &&
			footer !== null &&
			named === FREE.settings &&
			pressed &&
			closed,
		`${moved ?? "moved"}; z opened it: ${openedByOld}; footer "${footer}"; named ${named}; closed after pressing it: ${closed}`,
	);
	await page.keyboard.press("Escape");
}

// ---------------------------------------------------------------------------
// The Commander overlay: the same, and the key it shipped on is dead
// ---------------------------------------------------------------------------

{
	const { page, drawn, move, press } = game;
	const moved = await move("system.commander", FREE.commander);
	await press("9");
	const openedByOld = (await drawn("[data-commander-overlay]")) !== null;
	await press(FREE.commander);
	const footer = await drawn("[data-commander-overlay] .hint");
	const named = /Esc or (\S+) to close/.exec(footer ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const closed = (await drawn("[data-commander-overlay]")) === null;
	check(
		"Commander: the footer names the moved key, and that key closes the overlay",
		moved === null &&
			!openedByOld &&
			footer !== null &&
			named === FREE.commander &&
			pressed &&
			closed,
		`${moved ?? "moved"}; 9 opened it: ${openedByOld}; footer "${footer}"; named ${named}; closed after pressing it: ${closed}`,
	);
	if (!closed) await page.keyboard.press("Escape");
}

// ---------------------------------------------------------------------------
// The Commanders door: a route to the overlay that no rebind can lock
// ---------------------------------------------------------------------------

{
	const { page, frames, drawn } = game;
	await page.keyboard.press("?");
	await frames();
	const door = '[data-live-controls-action="commander"]';
	const shown = (await drawn(door)) !== null;
	if (shown) {
		await page.click(door);
		await frames();
	}
	const opened = (await drawn("[data-commander-overlay]")) !== null;
	check(
		"Commander: the Controls tab's door opens the overlay with no key at all",
		shown && opened,
		`door drawn: ${shown}; overlay after the click: ${opened}`,
	);
	await page.keyboard.press("Escape");
	await frames();
	// Head forward again, on the key this page has not moved.
	await page.keyboard.press("2");
	await frames();
}

// ---------------------------------------------------------------------------
// The prompt line: the key it names reaches the command
// ---------------------------------------------------------------------------

{
	const { page, frames, move, press } = game;
	const prompt = () => page.evaluate(() => window.__seelite.cockpitPrompt.text);
	const spool = () =>
		page.evaluate(() => {
			const g = window.__seelite;
			return g.regime === "cruise" || g.spoolLeftS > 0;
		});
	const moved = await move("fly.cruise", FREE.cruise);
	await frames();
	await press("j");
	const byOld = await spool();
	const text = await prompt();
	const named = /press (\S+) to cruise/.exec(text ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const engaged = await spool();
	check(
		"the cruise prompt names the moved key, and that key engages cruise",
		moved === null && !byOld && named === FREE.cruise && pressed && engaged,
		`${moved ?? "moved"}; j engaged it: ${byOld}; prompt "${text}"; named ${named}; engaged after pressing it: ${engaged}`,
	);
	// Stand the drive down on the key the prompt named, so the next row reads
	// a prompt line the spool is not holding.
	if (engaged) await press(named);
}

{
	const { page, frames, move, press } = game;
	const target = () => page.evaluate(() => window.__seelite.targetId);
	const moved = await move("fight.targetNext", FREE.target);
	// **Cleared by assignment, which is setup and not the subject.** The
	// prompt asks for a target only when there is none, and this seed boots
	// with one; the row's subject is what the line then names.
	await page.evaluate(() => {
		window.__seelite.targetId = null;
	});
	await frames();
	await press("t");
	const byOld = await target();
	const text = await page.evaluate(() => window.__seelite.cockpitPrompt.text);
	const named = /^(\S+) selects a target$/.exec(text ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const chosen = await target();
	check(
		"the target prompt names the moved key, and that key selects a target",
		moved === null &&
			byOld === null &&
			named === FREE.target &&
			pressed &&
			chosen !== null,
		`${moved ?? "moved"}; t chose ${byOld}; prompt "${text}"; named ${named}; target after pressing it: ${chosen}`,
	);
}

// ---------------------------------------------------------------------------
// The pad reaches the settings door, which docs/gamepad.md now says it does
// ---------------------------------------------------------------------------

{
	const { page, frames, drawn } = game;
	const tap = async (button) => {
		await page.evaluate((i) => window.__pad.hold(i), STANDARD_INDEX[button]);
		await frames(2);
		await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX[button]);
		await frames(2);
	};
	// The press that wakes a pad is not a press (`docs/gamepad.md`), so the
	// unbound button spends it.
	await tap("home");
	await tap("right");
	let onTab = false;
	for (let i = 0; i < 8 && !onTab; i++) {
		onTab = (await drawn("[data-live-controls-body]")) !== null;
		if (!onTab) await tap("r1");
	}
	const door = () =>
		page.evaluate(
			() =>
				document.querySelector("[data-live-focus='true']")?.dataset
					.liveControlsAction ?? null,
		);
	let onDoor = false;
	for (let i = 0; i < 8 && onTab && !onDoor; i++) {
		onDoor = (await door()) === "settings";
		if (!onDoor) await tap("up");
	}
	if (onDoor) await tap("a");
	const opened = (await drawn("[data-settings-panel]")) !== null;
	check(
		"the pad turns the head, steps to the Controls tab and opens settings from its door",
		onTab && onDoor && opened,
		`on the tab: ${onTab}; ring on the settings door: ${onDoor}; settings drawn: ${opened}`,
	);
	if (opened) await tap("b");
}

await game.page.close();

// ---------------------------------------------------------------------------
// The combat rig's legend, on its own page
// ---------------------------------------------------------------------------

{
	const rig = await open({ combat: 1 });
	const { page, frames, move } = rig;
	const legend = () =>
		page.evaluate(() => window.__seelite.combatRig.overlayLines[0]?.text ?? "");
	const firing = () =>
		page.evaluate(() => window.__seelite.combatRig.state.firing);
	// `7` is free on this page: every page is its own context, and so its own
	// stored layout.
	const moved = await move("fight.fireBeam", "7");
	await frames();
	const text = await legend();
	const named = /hold (\S+) or left mouse button beam/.exec(text)?.[1] ?? null;
	let beam = null;
	if (typeof named === "string" && [...named].length === 1) {
		await page.keyboard.down(named);
		await frames(6);
		beam = await firing();
		await page.keyboard.up(named);
		await frames();
	}
	check(
		"rig: the legend names the moved beam key, and holding it fires the beam",
		moved === null && named === "7" && beam === "beam",
		`${moved ?? "moved"}; legend "${text}"; named ${named}; firing while held: ${beam}`,
	);
	await page.close();
}

// ---------------------------------------------------------------------------
// The legacy HUD's dial line
// ---------------------------------------------------------------------------

{
	const legacy = await open({ "legacy-hud": 1 });
	const { page, frames, move, press } = legacy;
	const dialLine = () =>
		page.evaluate(
			() =>
				document
					.getElementById("hud")
					.textContent.split("\n")
					.find((l) => l.startsWith("v_max")) ?? "",
		);
	const vMax = (line) => Number(/^v_max (\d+) c/.exec(line)?.[1] ?? Number.NaN);
	const moved = await move("tune.vMaxUp", "8");
	await frames(6);
	const before = await dialLine();
	const named = /^v_max \d+ c \(-\/(\S)\)/.exec(before)?.[1] ?? null;
	const pressed = await press(named);
	await frames(6);
	const after = await dialLine();
	check(
		"legacy HUD: the dial line names the moved key, and that key turns the dial up",
		moved === null && named === "8" && pressed && vMax(after) > vMax(before),
		`${moved ?? "moved"}; before "${before}"; named ${named}; after "${after}"`,
	);
	await page.close();
}

await browser.close();
exit();
