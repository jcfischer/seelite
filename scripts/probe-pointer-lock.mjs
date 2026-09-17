/**
 * The pointer is the glass's, and a console takes it back (#371).
 *
 * **Why this probe exists.** Mouse-look runs on pointer lock, and while the lock
 * is held the browser routes every mouse event to the locked element — so a panel
 * that paints, highlights and answers nothing is not a rendering bug but the
 * browser doing what it was told. The player who turns their head cannot click the
 * console they are reading. `src/pad-bindings.ts`'s `pointerLockMove` owns why
 * that is the same rule as #283's console suspension and why the release is
 * edge-triggered; this file does not restate it, it measures it. Nothing in the
 * headless tier can: `main.ts` is not loadable there, and the cockpit probes drive
 * their panels through `element.click()`, which bypasses hit-testing and lock
 * routing — the two things that are broken.
 *
 * **Why it launches with `channel: "chromium"` and not the default launcher.**
 * Playwright's `headless: true` runs `chrome-headless-shell`, whose browser-process
 * focus gate (`RenderWidgetHostImpl::CanBePointerLocked` → `HasFocus()`, and the
 * shell never grants it) refuses every lock request with `WrongDocumentError`,
 * user activation or not — headed on macOS the same way, through
 * `RenderWidgetHostViewMac`'s extra `is_window_key_` term (playwright#20956). On
 * that binary `document.pointerLockElement` reads `null` in the broken build *and*
 * in the fixed one, so every row below would stand green over a regression. The
 * real Chrome binary in new headless grants the lock, routes a real click to the
 * locked element, and delivers `movementX` off absolute CDP moves, which is the
 * only condition under which "the panel got the click" distinguishes two builds.
 * Measured on this machine the day this probe was written, and asserted as its own
 * row before anything depends on it.
 *
 * **A deviation to read before approving: this probe does not render through
 * SwiftShader**, which every other browser script here does. The same launch
 * difference that makes the view lockable also changes what draws it. Measured,
 * two browsers, one page each, `UNMASKED_RENDERER_WEBGL`:
 *
 * | launcher | renderer |
 * | --- | --- |
 * | default | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)` |
 * | `channel: "chromium"` | `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)` |
 *
 * Acceptable for a reason worth stating rather than luck: no row reads a pixel,
 * and every row asks a question the rasteriser cannot answer — who holds the
 * pointer, what the hit test names, what rate the ship integrated. The SwiftShader
 * convention exists because a *picture* judged off a software rasteriser is the
 * wrong picture, which is why the capture tool refuses one outright; it is not a
 * claim that software rasterisation measures an event better. A machine with no
 * GPU falls back to SwiftShader and the rows stand, the lock gate being a
 * browser-process focus question and not a rendering one — though that arm is
 * reasoned here and measured nowhere, and is named as such.
 *
 * **One surface is reasoned here and not measured: the station console on the
 * forward wall while docked**, which reaches `console` through `liveCockpit`'s
 * `hasFocusScope()` with the head still forward, so it is a different path through
 * the predicate than a head turn is. Getting the ship to that state is a scripted
 * five-second arrival (`probe-docking.mjs` spends minutes on it), and the only
 * cheaper door — `?hud-gallery=docked` — renders the console in the workbench's own
 * harness, where `__seelite.frames` never advances and there is no glass to click.
 * A row there would measure a harness, so there is none; what the rows above buy
 * this one is that the *decision* is held in a function the headless tier can
 * reach, and the surface that answers for it is the one the probe already reads.
 *
 * **And why the last section uses the default launcher.** The lock the game *asks
 * for* is refused on any machine without a lockable view, which is ordinary rather
 * than a defect — and it must not reach the page as an unhandled rejection. That
 * row is measured where refusals are certain. It records `unhandledrejection`
 * inside the page rather than reading `pageerror`, because the CDP channel
 * collapses repeats: thirty refused clicks on the broken build reported **one**
 * page error, which would have made a row keyed on it a coin toss.
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

const W = 1280;
const H = 760;
const SEED = 42;

/** Frames, not a timer: the release is reconciled against the surface the render
 *  drew, so the state read here is the one the player is looking at. */
const settle = (page) =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

/** Which element the browser is routing mouse events to. Read from the page, and
 *  named by tag rather than as a boolean, so a lock held by something that is not
 *  the canvas cannot read as the game's own. */
const lockHolder = (page) =>
	page.evaluate(() =>
		document.pointerLockElement === null
			? null
			: (document.pointerLockElement.tagName ?? "unknown"),
	);

const canvasLock = async (page) => (await lockHolder(page)) === "CANVAS";

/** Which surface the game says owns input right now — read off the page rather
 *  than restated, because that answer *is* the rule's input. */
const surface = (page) => page.evaluate(() => window.__seelite.padContext());

const headLook = (page) => page.evaluate(() => window.__seelite.headLook);

/** A real click at the centre of the first element matching `selector`. Returns
 *  both what the hit test named there and the row or tab that would receive it:
 *  a settings row's own `.name` span is what the pointer touches while the `.row`
 *  around it is what answers, and conflating the two is how a click that landed
 *  gets read as one that did not. */
const clickAt = async (page, selector) => {
	const at = await page.evaluate((css) => {
		const el = document.querySelector(css);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(x, y);
		return {
			x,
			y,
			hit: hit?.tagName ?? null,
			control: hit?.closest(".row, .lc-tab")?.className ?? null,
		};
	}, selector);
	if (at) await page.mouse.click(at.x, at.y);
	await settle(page);
	return at;
};

/** A click on the glass with nothing drawn over it: the cockpit's panels are inset
 *  7% top, 12% bottom and 8% to each side, so 3% in from the left edge is outside
 *  every one of them at half height. This is the click the node names — the one a
 *  player makes when they can see the canvas and reach for it. It answers with the
 *  hit test, so a row that needed bare glass can say so rather than assuming it. */
const clickGlass = async (page) => {
	const at = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		const x = Math.round(r.left + r.width * 0.03);
		const y = Math.round(r.top + r.height * 0.5);
		return { x, y, hit: document.elementFromPoint(x, y)?.tagName ?? null };
	});
	await page.mouse.click(at.x, at.y);
	await settle(page);
	return at;
};

/** Turn the head and read what the pointer did, on a page whose glass is locked
 *  before the turn — a turn taken while the pointer is already free proves
 *  nothing about a surrender. */
const turnSurrenders = async (page, key, look, label) => {
	if (!(await canvasLock(page))) {
		check(label, false, `the glass was not locked before ${key}`);
		return;
	}
	await page.keyboard.press(key);
	await settle(page);
	const lock = await lockHolder(page);
	const head = await headLook(page);
	check(label, lock === null && head === look, `lock=${lock} headLook=${head}`);
};

const browser = await launchChromium({ channel: "chromium" });

// ---------------------------------------------------------------------------
// The premise, asserted: this harness can hold a pointer lock. Every row after
// this one is a null read if it cannot, and a null read agrees with any build.
// ---------------------------------------------------------------------------
const page = await browser.newPage({ viewport: { width: W, height: H } });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(page);

const glass = await clickGlass(page);
const locked = await canvasLock(page);
check(
	"the click on the glass takes the lock, so the rows below can see it",
	glass.hit === "CANVAS" && locked,
	`hit=${glass.hit} lock=${await lockHolder(page)}`,
);
if (!locked) {
	console.log(
		" FAIL  the browser refused the lock, which makes every row below vacuous — this probe needs a pointer-lockable view; see the header.",
	);
	await browser.close();
	exit();
}

check(
	"a locked mouse is still a flight input in the forward view",
	(await surface(page)) === "flight",
	await surface(page),
);

/** A real mouse move, and what the ship did about it. Locked, the deltas are
 *  relative and unbounded; that is the whole reason for the lock. */
const flyWithMouse = async (target) => {
	await target.evaluate(() => {
		window.__seelite.rates = { pitch: 0, yaw: 0, roll: 0 };
	});
	const box = await target.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	for (let step = 1; step <= 8; step++)
		await target.mouse.move(box.x + step * 26, box.y + step * 9);
	await settle(target);
	return target.evaluate(() => ({
		yaw: window.__seelite.rates.yaw,
		pitch: window.__seelite.rates.pitch,
	}));
};

const beforeConsole = await flyWithMouse(page);
check(
	"the locked mouse flies the ship before any console is opened",
	Math.abs(beforeConsole.yaw) > 1e-4 && Math.abs(beforeConsole.pitch) > 1e-4,
	JSON.stringify(beforeConsole),
);

// ---------------------------------------------------------------------------
// The defect, and the rule that fixes it: the head turns to a console and the
// pointer comes back. Three call sites turn the head — the `1`/`2`/`3` keys, the
// `Alt`+arrow chord, and the gamepad's — and the release is not written at any of
// them, so all three are covered by one row apiece rather than one row total.
// ---------------------------------------------------------------------------
await clickGlass(page);
check(
	"the glass is locked again before the head turns",
	await canvasLock(page),
	`lock=${await lockHolder(page)}`,
);

await turnSurrenders(
	page,
	"3",
	"right",
	"turning the head right surrenders the lock, read off `document.pointerLockElement`",
);

const tab = await clickAt(page, '[data-live-right-tab="Tuning"]');
check(
	"and the real click the player aims at that console's tab lands on the tab",
	await page.evaluate(
		() =>
			document
				.querySelector('[data-live-right-tab="Tuning"]')
				?.getAttribute("aria-selected") === "true",
	),
	`hit=${tab?.hit} control=${tab?.control} lock=${await lockHolder(page)}`,
);

// While the console is up the pointer is not the canvas's, which is the whole of
// why the panel above answers: the click below reaches the glass and stops there,
// and on the broken build it was the glass that kept it.
const beside = await clickGlass(page);
check(
	"a click on the glass beside that console leaves the pointer where the console can use it",
	beside.hit === "CANVAS" && (await lockHolder(page)) === null,
	`hit=${beside.hit} lock=${await lockHolder(page)} surface=${await surface(page)}`,
);

await page.keyboard.press("2");
await settle(page);
await clickGlass(page);
check(
	"with the head back to forward the next click on the glass takes it again",
	(await canvasLock(page)) && (await headLook(page)) === "forward",
	`lock=${await lockHolder(page)} headLook=${await headLook(page)}`,
);

await turnSurrenders(
	page,
	"Alt+ArrowRight",
	"right",
	"the `Alt`+arrow turn surrenders it too",
);

await page.keyboard.press("2");
await settle(page);
await clickGlass(page);
await turnSurrenders(
	page,
	"1",
	"left",
	"and so does the turn to the left console",
);
check(
	"and the left console is the surface the game says it is looking at",
	(await surface(page)) === "console",
	await surface(page),
);

// ---------------------------------------------------------------------------
// The same rule one surface up. The settings screen never released the lock at
// all, so the screen every player opens had the same dead rows. The Commander
// overlay keeps its own release: it opens on a keystroke and does not wait for a
// frame, and `padContext`'s own comment records that a probe can cancel the loop —
// on that path the frame's reconciliation never runs. `tests/pad-bindings.test.ts`
// pins both release sites by name so a third cannot arrive unremarked.
// ---------------------------------------------------------------------------
await page.keyboard.press("2");
await settle(page);
await clickGlass(page);
await page.keyboard.press("z");
await settle(page);
check(
	"opening the settings screen surrenders the lock as well",
	(await lockHolder(page)) === null && (await surface(page)) === "modal",
	`lock=${await lockHolder(page)} surface=${await surface(page)}`,
);

// The first row, which is the render scale — a real control whose value changes
// when it is actuated, so the click's effect is read rather than assumed. Read
// *after* the screen is up: before the keystroke there is no screen to have rows.
const rowBefore = await page.evaluate(
	() => document.querySelector("#seelite-settings .row")?.textContent ?? null,
);
const settingsRow = await clickAt(page, "#seelite-settings .row");
const rowAfter = await page.evaluate(
	() => document.querySelector("#seelite-settings .row")?.textContent ?? null,
);
check(
	"and a real click on a settings row lands on it",
	settingsRow?.control === "row" &&
		rowBefore !== null &&
		rowAfter !== rowBefore,
	`hit=${settingsRow?.hit} control=${settingsRow?.control} "${rowBefore}" → "${rowAfter}"`,
);

await browser.close();

// ---------------------------------------------------------------------------
// A refusal, measured where refusals are certain: the shell binary has no
// pointer-lockable view, which is what a player on an unfocused window or a
// second Safari tab gets. The game has to treat that as a case it has read.
// ---------------------------------------------------------------------------
const shell = await launchChromium();
const plain = await shell.newPage({ viewport: { width: W, height: H } });
watch(plain, "refused lock");
await plain.addInitScript(() => {
	window.__refusals = [];
	window.addEventListener("unhandledrejection", (event) =>
		window.__refusals.push(String(event.reason?.name ?? event.reason)),
	);
});
await plain.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(plain);
for (let click = 0; click < 5; click++) {
	await plain.mouse.click(Math.round(W * 0.5), Math.round(H * 0.5));
	await plain.waitForTimeout(120);
}
const refusals = await plain.evaluate(() => window.__refusals);
check(
	"a lock the browser refuses is read by the game, not thrown to the page",
	refusals.length === 0,
	refusals.length ? `${refusals.length} × ${refusals[0]}` : "",
);
await shell.close();

exit();
