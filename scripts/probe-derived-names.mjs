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
 * **Two rows set their stage by assignment**, and it is setup, not the
 * subject: the target row clears the target so the line asks for one, and
 * the jump row commits a course and fills the tanks so the line offers a
 * jump. The save-fault badge is shown by calling its own `update(true)` —
 * forcing a real write failure is `probe-save.mjs`'s, whose timing a second
 * copy would disturb — so that row reads the words the badge paints and
 * presses them, and says nothing about when a fault raises it.
 *
 * **What is not read here.** The pad hint cannot be moved by any layout — a
 * panel intent is not offered for rebinding — so `probe-pad-panels.mjs`
 * reading it on screen is the whole of its browser evidence, and
 * `tests/derived-names.test.ts` holds that each segment is the layout's. (This
 * paragraph listed the jump prompt and the badge as well for a round; sage
 * round 1 on #498 held the PR's "every name is pressed" against it.)
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
	waitForSettingsPanel,
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
const FREE = {
	commander: "4",
	settings: "5",
	cruise: "6",
	target: "7",
	jump: "8",
};

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
// The two player screens: each footer names the key that closes it
// ---------------------------------------------------------------------------

/**
 * One screen's row: move its command, show the key it shipped on is dead,
 * open it on the moved key, and close it on the key its footer names.
 *
 * One helper for both screens (sage round 1 on #498): the two rows were the
 * same seven steps with four names changed, so a fix to the three-arm pattern
 * had to be made twice.
 */
async function footerCloses({ command, shipped, free, screen }) {
	const { drawn, move, press } = game;
	const moved = await move(command, free);
	await press(shipped);
	const openedByOld = (await drawn(screen)) !== null;
	await press(free);
	const footer = await drawn(`${screen} .hint`);
	const named = /Esc or (\S+) to close/.exec(footer ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const closed = (await drawn(screen)) === null;
	if (!closed) await game.page.keyboard.press("Escape");
	return {
		ok:
			moved === null &&
			!openedByOld &&
			footer !== null &&
			named === free &&
			pressed &&
			closed,
		detail: `${moved ?? "moved"}; ${shipped} opened it: ${openedByOld}; footer "${footer}"; named ${named}; closed after pressing it: ${closed}`,
	};
}

{
	// **Mounted first, or the dead-key arm passes on an empty page.** The
	// screen is a dynamic import that lands after boot (#423), so `z` pressed
	// before it has nothing to open whatever the layout says — and "z did not
	// open it" would be true for the wrong reason. S4's round 5 was this
	// surrogate one row over. The Commander overlay mounts with the boot.
	const mounted = await waitForSettingsPanel(game.page);
	const settings = await footerCloses({
		command: "system.settings",
		shipped: "z",
		free: FREE.settings,
		screen: "[data-settings-panel]",
	});
	check(
		"settings: the footer names the moved key, and that key closes the screen",
		mounted && settings.ok,
		`mounted before z: ${mounted}; ${settings.detail}`,
	);
	const commander = await footerCloses({
		command: "system.commander",
		shipped: "9",
		free: FREE.commander,
		screen: "[data-commander-overlay]",
	});
	check(
		"Commander: the footer names the moved key, and that key closes the overlay",
		commander.ok,
		commander.detail,
	);
}

// ---------------------------------------------------------------------------
// The save-fault badge names the key that opens the Commander
// ---------------------------------------------------------------------------

{
	const { page, frames, drawn, press } = game;
	// Shown through its own handle, and read in the same task, before the next
	// frame's `update` hides it again for want of a fault.
	const badge = await page.evaluate(() => {
		const handle = window.__seelite.saveBadge;
		if (!handle) return null;
		handle.update(true);
		const el = document.querySelector("[data-save-badge]");
		return el?.checkVisibility() ? (el.textContent ?? "").trim() : null;
	});
	const named = /^SAVE FAULT (\S+)$/.exec(badge ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const opened = (await drawn("[data-commander-overlay]")) !== null;
	check(
		"the save-fault badge names the moved Commander key, and that key opens the overlay",
		named === FREE.commander && pressed && opened,
		`badge "${badge}"; named ${named}; overlay after pressing it: ${opened}`,
	);
	if (opened) await page.keyboard.press("Escape");
	await frames();
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

/**
 * One prompt row: move the command, stage the line, show the key it shipped
 * on does nothing, read the key the line names, press it, and observe the
 * effect.
 *
 * One helper for the three prompt rows, as `footerCloses` is for the two
 * screens (sage round 2 on #498). `stage` is the row's setup — a target
 * cleared, a course committed — and returns whether it took; `effect` reads
 * the state the line promises, and must read false before the named key is
 * pressed and true after.
 */
async function promptReaches({
	command,
	shipped,
	free,
	pattern,
	stage,
	effect,
}) {
	const { page, frames, move, press } = game;
	const moved = await move(command, free);
	const staged = stage ? await stage() : true;
	await frames();
	await press(shipped);
	const byOld = await effect();
	const text = await page.evaluate(() => window.__seelite.cockpitPrompt.text);
	const named = pattern.exec(text ?? "")?.[1] ?? null;
	const pressed = await press(named);
	const happened = await effect();
	return {
		named,
		ok:
			moved === null &&
			staged === true &&
			!byOld &&
			named === free &&
			pressed &&
			happened,
		detail: `${moved ?? "moved"}; staged: ${staged}; ${shipped} did it: ${byOld}; prompt "${text}"; named ${named}; after pressing it: ${happened}`,
	};
}

{
	const cruise = await promptReaches({
		command: "fly.cruise",
		shipped: "j",
		free: FREE.cruise,
		pattern: /press (\S+) to cruise/,
		effect: () =>
			game.page.evaluate(() => {
				const g = window.__seelite;
				return g.regime === "cruise" || g.spoolLeftS > 0;
			}),
	});
	check(
		"the cruise prompt names the moved key, and that key engages cruise",
		cruise.ok,
		cruise.detail,
	);
	// Stand the drive down on the key the prompt named, so the next row reads
	// a prompt line the spool is not holding.
	if (cruise.ok) await game.press(cruise.named);
}

{
	const target = await promptReaches({
		command: "fight.targetNext",
		shipped: "t",
		free: FREE.target,
		pattern: /^(\S+) selects a target$/,
		// **Cleared by assignment, which is setup and not the subject.** The
		// prompt asks for a target only when there is none, and this seed
		// boots with one; the row's subject is what the line then names.
		stage: () =>
			game.page.evaluate(() => {
				window.__seelite.targetId = null;
				return true;
			}),
		effect: () => game.page.evaluate(() => window.__seelite.targetId !== null),
	});
	check(
		"the target prompt names the moved key, and that key selects a target",
		target.ok,
		target.detail,
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

// ---------------------------------------------------------------------------
// The jump prompt, last on this page: a charge that starts ends in a jump
// ---------------------------------------------------------------------------

{
	const jump = await promptReaches({
		command: "fly.jump",
		shipped: "`",
		free: FREE.jump,
		pattern: /^press (\S+) to jump to \S/,
		// Head forward, on a key this page has not moved — the pad row left it
		// on the right console, where the prompt line is not drawn — and a
		// course and a full tank, so the line offers the jump. Every system in
		// a galaxy is routable from every other (`galaxy-generation.md` §5),
		// which is how `probe-live-cockpit.mjs` sets one too.
		stage: async () => {
			await game.press("2");
			return game.page.evaluate(() => {
				const g = window.__seelite;
				g.fuelLy = g.fuelCapacityLy;
				const here = g.world.system.record;
				const elsewhere = g.world.galaxy.systems.find(
					(s) => s.galaxy === here.galaxy && s.index !== here.index,
				);
				return g.commitCourseTo(elsewhere.index);
			});
		},
		effect: () =>
			game.page.evaluate(() => window.__seelite.jumpCharge.toIndex !== null),
	});
	check(
		"the jump prompt names the moved key, and that key winds up the jump",
		jump.ok,
		jump.detail,
	);
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
