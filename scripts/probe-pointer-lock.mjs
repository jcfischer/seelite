/**
 * The pointer is the glass's, and a console takes it back (#371).
 *
 * **Why this probe exists.** Mouse-look runs on pointer lock, and a locked
 * pointer sends *every* mouse event to the locked element — so while it is held,
 * a panel that paints, highlights and answers nothing is not a rendering bug but
 * the browser doing exactly what it was told. The player who turns their head to
 * read a console cannot click the console; the click lands on the canvas, which
 * takes the lock again. Nothing in the headless tier can see it (`main.ts` is not
 * loadable there), and the cockpit probes drive their panels through
 * `element.click()`, which bypasses hit-testing and lock routing entirely.
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
 * Measured on this machine on the day this probe was written; the premise is
 * asserted as its own row before anything depends on it.
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
 * Which is acceptable here for a reason worth stating rather than luck: every row
 * asks a question the rasteriser cannot answer — who holds the pointer, what the
 * hit test names, what rate the ship integrated — and no row reads a pixel. The
 * SwiftShader convention exists because a *picture* judged off a software
 * rasteriser is the wrong picture, which is why the capture tool refuses one
 * outright; it is not a claim that software rasterisation measures an event
 * better. A machine with no GPU falls back to SwiftShader and the rows still
 * stand, since the lock gate is a browser-process focus question and not a
 * rendering one — though that arm is reasoned here and measured nowhere, and is
 * named as such.
 *
 * **And why the last section uses the default launcher instead.** The lock the
 * game *asks for* can be refused on a machine that has no lockable view — which is
 * ordinary, not a defect, and must not reach the console as an unhandled
 * rejection. That is the one row here the shell binary can measure, and it is the
 * reason `probe-gun-feedback.mjs` has had to stub `requestPointerLock` out.
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

const browser = await launchChromium({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: W, height: H } });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(page);

/** Frames, not a timer: the release is reconciled against the surface the render
 *  drew, so the state read here is the one the player is looking at. */
const settle = () =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

/** Which element the browser is routing mouse events to. Read from the page, and
 *  named by tag rather than by a boolean, so a lock held by something that is not
 *  the canvas cannot read as the game's own. */
const lockHolder = () =>
	page.evaluate(() =>
		document.pointerLockElement === null
			? null
			: (document.pointerLockElement.tagName ?? "unknown"),
	);

const canvasLock = async () => (await lockHolder()) === "CANVAS";

/** The pad's own answer for who owns input, read off the page rather than
 *  restated: the rule under test is #283's predicate, so this is the column the
 *  rule is keyed on. */
const padContext = () => page.evaluate(() => window.__seelite.padContext());

/** A real click at the centre of the first element matching `selector`. Returns
 *  both what the hit test named there and the row or tab that would receive it:
 *  a settings row's own `.name` span is what the pointer touches, while the
 *  `.row` around it is what answers, and conflating the two is how a click that
 *  landed gets read as one that did not. */
const clickAt = async (selector) => {
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
			hitClass: hit?.className ?? null,
			control: hit?.closest(".row, .lc-tab")?.className ?? null,
		};
	}, selector);
	if (at) await page.mouse.click(at.x, at.y);
	await settle();
	return at;
};

/** A click on the glass with nothing drawn over it: the cockpit's panels are
 *  inset 7% top, 12% bottom and 8% to each side, so 3% in from the left edge is
 *  outside every one of them at half height. This is the click the node names —
 *  the one a player makes when they can see the canvas and reach for it. */
const clickGlass = async () => {
	const at = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		const x = Math.round(r.left + r.width * 0.03);
		const y = Math.round(r.top + r.height * 0.5);
		return {
			x,
			y,
			hit: document.elementFromPoint(x, y)?.tagName ?? null,
		};
	});
	await page.mouse.click(at.x, at.y);
	await settle();
	return at;
};

const headLook = () => page.evaluate(() => window.__seelite.headLook);

// ---------------------------------------------------------------------------
// The premise, asserted: this harness can hold a pointer lock. Every row after
// this one is a null read if it cannot, and a null read agrees with any build.
// ---------------------------------------------------------------------------
const glass = await clickAt("canvas");
const locked = await canvasLock();
check(
	"the click on the glass takes the lock, so the rows below can see it",
	glass?.hit === "CANVAS" && locked,
	`hit=${glass?.hit} lock=${await lockHolder()}`,
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
	(await padContext()) === "flight",
	await padContext(),
);

/** A real mouse move, and what the ship did about it. Locked, the deltas are
 *  relative and unbounded; that is the whole reason for the lock. */
const flyWithMouse = async () => {
	await page.evaluate(() => {
		window.__seelite.rates = { pitch: 0, yaw: 0, roll: 0 };
	});
	const box = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	for (let step = 1; step <= 8; step++) {
		await page.mouse.move(box.x + step * 26, box.y + step * 9);
	}
	await settle();
	return page.evaluate(() => ({
		yaw: window.__seelite.rates.yaw,
		pitch: window.__seelite.rates.pitch,
	}));
};

const beforeConsole = await flyWithMouse();
check(
	"the locked mouse flies the ship before any console is opened",
	Math.abs(beforeConsole.yaw) > 1e-4 && Math.abs(beforeConsole.pitch) > 1e-4,
	JSON.stringify(beforeConsole),
);

// ---------------------------------------------------------------------------
// The defect, and the rule that fixes it: the head turns to a console and the
// pointer comes back. Both bindings — the `1`/`3` keys and the `Alt`+arrow chord
// are separate call sites in `main.ts`, and the pad's is a third.
// ---------------------------------------------------------------------------
await clickGlass();
check(
	"the glass is locked again before the head turns",
	await canvasLock(),
	`lock=${await lockHolder()}`,
);

await page.keyboard.press("3");
await settle();
check(
	"turning the head right surrenders the lock, read off `document.pointerLockElement`",
	(await lockHolder()) === null && (await headLook()) === "right",
	`lock=${await lockHolder()} headLook=${await headLook()}`,
);

const tab = await clickAt('[data-live-right-tab="Tuning"]');
check(
	"and the real click the player aims at that console's tab lands on the tab",
	await page.evaluate(
		() =>
			document
				.querySelector('[data-live-right-tab="Tuning"]')
				?.getAttribute("aria-selected") === "true",
	),
	`hit=${tab?.hitClass} control=${tab?.control} lock=${await lockHolder()}`,
);

check(
	"a click on the glass beside that console does not take the lock back",
	(await clickGlass()) !== null && (await lockHolder()) === null,
	`lock=${await lockHolder()} context=${await padContext()}`,
);

await page.keyboard.press("2");
await settle();
await clickGlass();
check(
	"with the head back to forward the next click on the glass takes it again",
	(await canvasLock()) && (await headLook()) === "forward",
	`lock=${await lockHolder()} headLook=${await headLook()}`,
);

await page.keyboard.press("Alt+ArrowRight");
await settle();
check(
	"the `Alt`+arrow turn surrenders it too",
	(await lockHolder()) === null && (await headLook()) === "right",
	`lock=${await lockHolder()} headLook=${await headLook()}`,
);

await clickGlass();
await page.keyboard.press("1");
await settle();
check(
	"and so does the turn to the left console",
	(await lockHolder()) === null &&
		(await headLook()) === "left" &&
		(await padContext()) === "console",
	`lock=${await lockHolder()} headLook=${await headLook()} context=${await padContext()}`,
);

// ---------------------------------------------------------------------------
// The same rule one surface up. `settings` never released the lock at all, so
// the screen every player opens had the same dead rows — and the Commander
// overlay releasing its own was the only place in `src/` that did, which is the
// drift this node closes by making the rule one predicate instead of a habit.
// ---------------------------------------------------------------------------
await page.keyboard.press("2");
await settle();
await clickGlass();
await page.keyboard.press("z");
await settle();
check(
	"opening the settings screen surrenders the lock as well",
	(await lockHolder()) === null && (await padContext()) === "modal",
	`lock=${await lockHolder()} context=${await padContext()}`,
);

// The first row, which is the render scale — a real control with a value that
// changes when it is actuated, so the click's effect is read rather than
// assumed. Read *after* the screen is up: before the keystroke there is no
// screen to have rows on.
const rowBefore = await page.evaluate(
	() => document.querySelector("#seelite-settings .row")?.textContent ?? null,
);
const settingsRow = await clickAt("#seelite-settings .row");
const rowAfter = await page.evaluate(
	() => document.querySelector("#seelite-settings .row")?.textContent ?? null,
);
check(
	"and a real click on a settings row lands on it",
	settingsRow?.control === "row" &&
		rowBefore !== null &&
		rowAfter !== rowBefore,
	`hit=${settingsRow?.hitClass} control=${settingsRow?.control} "${rowBefore}" → "${rowAfter}"`,
);

await browser.close();

// ---------------------------------------------------------------------------
// The refused lock, measured on the launcher every other browser script here
// uses. The shell binary has no pointer-lockable view at all, so a refusal here
// is the ordinary case rather than a defect — and the game still has to treat it
// as one it has read. `unhandledrejection` is recorded inside the page rather
// than read off `pageerror`, because the CDP channel collapses repeats: thirty
// refused clicks on the broken build reported **one** page error, which would
// have made a row keyed on it a coin toss.
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
const framesBefore = await plain.evaluate(() => window.__seelite.frames);
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
// The frame loop still advancing is the cheap form of "nothing escaped the
// handler": a throw out of a click listener lands in this same counter's absence
// of progress, and `watch` above has already counted the error itself.
check(
	"and five refused locks leave the frame loop running",
	(await plain.evaluate(() => window.__seelite.frames)) > framesBefore,
	`frames ${framesBefore} → ${await plain.evaluate(() => window.__seelite.frames)}`,
);
await shell.close();

exit();
