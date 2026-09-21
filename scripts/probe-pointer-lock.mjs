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
 * **About three words here that the alias rule in `CONTEXT.md` catches.** They are
 * ordinary English and identifiers, not synonyms for the canonical terms, and the
 * file says so itself: the game controller is the **fourth sense of "pad"** that is
 * not a berth ("a controller is what every player calls a pad", and a reviewer
 * flagging one "has found the alias rule firing on an English word"); **`Command`
 * is scoped to a player act on a carrier**, and `Game.command(key)` is named in that
 * entry's own scope note as dispatching a keypress and needing no renaming; and
 * **`Berth` is the canonical term**, used here only to say which sense of "pad" this
 * file is not. Renaming any of the three would make a canonical term mean two things.
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
	PROBE_WINDOW_LOCKABLE,
	probeLaunchOptions,
	tally,
	waitForSettingsPanel,
} from "./probe-guard.mjs";
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";
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
	// **The harness paces itself, so that the click a row makes is the click that
	// row is about.** Measured here: the fifth pointer-lock request inside about
	// 1.3 s is refused with `pointerlockerror`, one second does not clear that
	// window and 2.1 seconds does — the same limiter this change edge-triggers the
	// release against, arriving on the probe's own fast click sequence. The first
	// answer was to retry after a refusal, and Sage read what that cost, round 4: a
	// row named for *the next click* was being satisfied by a later one, which is the
	// half of the principal's ruling that row exists to hold. So the wait goes
	// **before** the click and there is exactly one click per row: the row measures
	// the click a player would make, and the harness's own speed is not allowed to
	// decide whether a premise held.
	await page.waitForTimeout(3000);
	// A lock is granted only to the focused view. A prior console interaction can
	// leave this tab behind another page of the same browser; bring this exact
	// page forward before measuring the one real click below.
	await page.bringToFront();
	await page.waitForFunction(() => document.hasFocus());
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

/** Back to forward and take the glass again, answering whether it was taken. The
 *  rows after a turn all need a locked page, and a row that starts from a state it
 *  did not establish is how a green run stops meaning anything. */
const relockForward = async (target) => {
	await target.keyboard.press("2");
	await settle(target);
	// **Read the pointer before asking for it back.** The ruling is that the next
	// click, and nothing else, restores the pointer — so a build that re-took the
	// lock on its own way home has to fail something, and without this read every
	// row here would pass on it: each premise below asks only that the glass ends up
	// locked, which an auto re-lock satisfies as well as a click does. Sage, round 5,
	// on the version that clicked straight away.
	const autoLockedOnReturn = await canvasLock(target);
	// One click, and its answer is the row's premise. `clickGlass` has already
	// waited out the browser's lock window, so this is the next click and not a
	// later one.
	await clickGlass(target);
	return {
		took: await canvasLock(target),
		autoLockedOnReturn: !!autoLockedOnReturn,
	};
};

/**
 * Turn the head by one of the doors that has a row, and read what the pointer did.
 *
 * **Every door starts from a locked glass or says it did not get one**: a turn taken
 * while the pointer is already free proves nothing about a surrender, which is
 * exactly how the first version of this file's left-turn row passed against the
 * broken build.
 */
const turnSurrenders = async (target, door, look, label) => {
	if (!(await canvasLock(target))) {
		check(label, false, "the glass was not locked before the turn");
		return;
	}
	await door(target);
	await settle(target);
	const lock = await lockHolder(target);
	const head = await headLook(target);
	check(label, lock === null && head === look, `lock=${lock} headLook=${head}`);
};

/** Press a gamepad button across a poll, which is the only way the game sees it. */
const pressPad = async (target, name) => {
	await target.evaluate((i) => window.__pad.hold(i), STANDARD_INDEX[name]);
	await settle(target);
	await target.evaluate((i) => window.__pad.release(i), STANDARD_INDEX[name]);
	await settle(target);
};

// This probe needs a view that can hold a pointer lock, and asks for that rather
// than for today's answer to it — `PROBE_WINDOW_LOCKABLE` owns the why (#454).
// Named once, because the premise row below reads the same options back to say
// what the lane made of them, and two spellings would let it reason about a
// launch that did not happen.
const LAUNCH = { channel: "chromium", probeWindow: PROBE_WINDOW_LOCKABLE };
const browser = await launchChromium(LAUNCH);

// ---------------------------------------------------------------------------
// The premise, asserted: this harness can hold a pointer lock. Every row after
// this one is a null read if it cannot, and a null read agrees with any build.
// ---------------------------------------------------------------------------
const page = await browser.newPage({ viewport: { width: W, height: H } });
watch(page);
// Installed before the load, because the browser hides a connected controller
// until a button is pressed and the game's first poll has to find one there. The
// pad is at rest for every row but the one that turns the head with it.
await page.addInitScript(installFakePad);
// **Read the refusal back rather than guessing at it (#454).** The premise row
// below used to blame "the browser" for every unlocked page, and #441 measured
// that wrong: what refused was the *launch*. The tap hands back the browser's own
// promise untouched — the section at the foot of this file is what asserts the
// game swallows it — and only observes.
//
// Three counters, and the third is deliberately **not** a name. The asks are
// counted, because a page where the game never asked is a game-side finding and
// must not be reported as the lane's or the browser's. A name is recorded only
// where there is one — the returning form of `requestPointerLock` rejects with a
// `DOMException`, and that is the only source that carries a reason.
// `pointerlockerror`, which is how the form returning `undefined` reports,
// carries none: it is counted as an *unnamed* refusal, so the diagnosis below
// can say the cause was unobserved instead of printing the event's own name as
// though it were one. The patch goes on `Element.prototype`,
// where the method is defined, and forwards its arguments — a call made with
// `{ unadjustedMovement: true }` must reach the browser as the one the player's
// build makes.
//
// **One thing it does change, said rather than claimed away.** Attaching a
// rejection handler marks that rejection handled, so on this page a refusal the
// game failed to catch would no longer surface as an unhandled rejection. The
// row that asserts the game *does* catch it runs at the foot of this file on a
// second browser with no tap installed, which is why that row still means
// something.
await page.addInitScript(() => {
	window.__lockRefusals = [];
	window.__lockErrorEvents = 0;
	window.__lockGrants = 0;
	window.__lockAsks = 0;
	document.addEventListener("pointerlockerror", () => {
		window.__lockErrorEvents++;
	});
	// A grant that was later released is not the same as never being granted,
	// and `document.pointerLockElement` read once at the end cannot tell them
	// apart.
	document.addEventListener("pointerlockchange", () => {
		if (document.pointerLockElement) window.__lockGrants++;
	});
	const ask = Element.prototype.requestPointerLock;
	Element.prototype.requestPointerLock = function requestPointerLock(...args) {
		window.__lockAsks++;
		const asked = ask.apply(this, args);
		Promise.resolve(asked).catch((error) =>
			window.__lockRefusals.unshift(error?.name ?? String(error)),
		);
		return asked;
	};
});
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
	// **Name the cause, or say that it was not observed (#454).** Six states, and
	// they are six different findings: the observer never installed, which is the
	// harness and names nothing; no ask, which is the game; a `WrongDocumentError`,
	// which is the focus gate and so the launch (#441); any other named refusal,
	// which is the genuine article; a lock granted and since released, which is a
	// row above; and an ask refused with no name on it, which is unattributed and
	// says so. Each of the last five was reachable in a shipped build before this
	// row could tell them apart, and the first four were being printed as one.
	const { asks, refusal, events, grants } = await page.evaluate(() => ({
		asks: window.__lockAsks,
		refusal: window.__lockRefusals?.[0] ?? null,
		events: window.__lockErrorEvents ?? 0,
		grants: window.__lockGrants ?? 0,
	}));
	const headed = probeLaunchOptions(LAUNCH).headless === false;
	const diagnose = () => {
		if (asks === undefined)
			return "The observer was not installed on this page, so nothing here saw whether the game asked at all — that is a harness fault and names no cause.";
		if (asks === 0)
			return "The game never asked for the lock on this page, so neither the lane nor the browser is implicated — that is a game-side finding.";
		// **Keyed on the refusal, not on the lane.** `headed` is false in every
		// shipped configuration, this mode being what makes it so, and a lane arm
		// gated on it could only ever fire under a mutation — while a real
		// `WrongDocumentError` fell through and got read back as the browser's own
		// refusal, which is the misattribution this row exists to end. The name is
		// the focus gate's signature (#441); the launch is reported beside it
		// because a headed one says where to look first.
		if (refusal === "WrongDocumentError")
			return `The cause is the focus gate: this view is not the key one, which is what \`WrongDocumentError\` means here and never a statement about the game (#441). The launch ${headed ? "carries `headless: false`, so fix the launch and not this probe" : "carries no headless override, so the view lost focus some other way"}.`;
		if (refusal)
			return `The cause is the refusal itself — ${refusal} — in a launch carrying ${headed ? "headless: false" : "no headless override"}. This view cannot hold a lock; see the header.`;
		if (grants > 0)
			return `The lock was granted ${grants}× and is not held now, so it was taken and released rather than refused — a row above this one let go of it.`;
		if (events === 0)
			return `The ask was made ${asks}× and was neither granted nor refused — no rejection, no \`pointerlockerror\` and no \`pointerlockchange\` — so nothing here says why the lock is not held.`;
		return `The ask was made ${asks}× and refused ${events}× through \`pointerlockerror\`, which carries no reason, so the cause is unobserved here rather than known.`;
	};
	console.log(
		` FAIL  the lock was not taken, which makes every row below vacuous. ${diagnose()}`,
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
// pointer comes back. Two doors turn it — `command`'s `1`/`2`/`3` switch, which the
// gamepad's d-pad reaches through `PAD_FLIGHT_KEYS`, and the `Alt`+arrow chord that
// bypasses `command` entirely — and the release is written at neither, so the rows
// below read the doors rather than the sites that draw a console. The gamepad gets
// its own row because it is the door no other probe here pairs with a pointer.
// ---------------------------------------------------------------------------
await clickGlass(page);
check(
	"the glass is locked again before the head turns",
	await canvasLock(page),
	`lock=${await lockHolder(page)}`,
);

await turnSurrenders(
	page,
	(target) => target.keyboard.press("3"),
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

// ---------------------------------------------------------------------------
// **And the button is on the same side as the pointer (#378).** The principal's
// ruling: the mouse is the device #283 suspends, so a press held on the glass
// beside an open console does not fire. Read off the simulation — the gun's heat,
// which only a shot raises — and not off the DOM. A real press through
// `page.mouse`, never `element.click()`: #370 found a synthetic dispatch ignores
// the lock, and a click is too short to hold a trigger anyway.
// ---------------------------------------------------------------------------
const heat = (target) => target.evaluate(() => window.__seelite.condition.heat);
const trigger = (target) =>
	target.evaluate(() => window.__seelite.triggerHeld());
/** A few hundred milliseconds of frames with the button as it is, and the gun
 *  read across them: its heat before and after, and whether the trigger is held. */
const keepAndRead = async (target) => {
	const cool = await heat(target);
	await target.waitForTimeout(300);
	await settle(target);
	return { cool, trigger: await trigger(target), heat: await heat(target) };
};
/** The same, from a new press. The button stays down; the caller releases it. */
const pressAndRead = async (target) => {
	await target.mouse.down();
	return keepAndRead(target);
};
const besideAt = await page.evaluate(() => {
	const r = window.__seelite.renderer.domElement.getBoundingClientRect();
	return { x: r.left + r.width * 0.03, y: r.top + r.height * 0.5 };
});
await page.mouse.move(besideAt.x, besideAt.y);
const heldBeside = await pressAndRead(page);
const besideSurface = await surface(page);
check(
	"a press held on the glass beside that console does not fire (#378)",
	besideSurface === "console" &&
		!heldBeside.trigger &&
		heldBeside.heat <= heldBeside.cool,
	`surface=${besideSurface} trigger=${heldBeside.trigger} heat ${heldBeside.cool} -> ${heldBeside.heat}`,
);
// **And that press never becomes a trigger (sage round 1 on #378).** Still holding it,
// the head comes back to flight. A press made where the mouse is suspended is
// not a pull of the trigger, so the gun stays quiet until a new press — the
// pointer's own rule, where the next click and nothing else takes the lock.
await page.keyboard.press("2");
await settle(page);
const carried = await keepAndRead(page);
check(
	"and holding that press while the head comes forward does not fire either",
	(await headLook(page)) === "forward" &&
		!carried.trigger &&
		carried.heat <= carried.cool,
	`head=${await headLook(page)} trigger=${carried.trigger} heat ${carried.cool} -> ${carried.heat}`,
);
// The release lands on the glass in flight, and a click there asks for the
// lock. Turning back to the console gives it up again, so the row below still
// starts from a pointer nothing has taken.
await page.mouse.up();
await settle(page);
await page.keyboard.press("3");
await settle(page);

const relock = await relockForward(page);
check(
	"nothing takes the pointer back on the way home, and the click does",
	!relock.autoLockedOnReturn &&
		relock.took &&
		(await headLook(page)) === "forward",
	`auto=${relock.autoLockedOnReturn} took=${relock.took} headLook=${await headLook(page)}`,
);

await turnSurrenders(
	page,
	(target) => target.keyboard.press("Alt+ArrowRight"),
	"right",
	"the `Alt`+arrow chord surrenders it too, bypassing `command`",
);

await relockForward(page);
await turnSurrenders(
	page,
	(target) => target.keyboard.press("1"),
	"left",
	"and so does the turn to the left console",
);
check(
	"and the left console is the surface the game says it is looking at",
	(await surface(page)) === "console",
	await surface(page),
);

await relockForward(page);
await turnSurrenders(
	page,
	(target) => pressPad(target, "right"),
	"right",
	"and the d-pad's turn surrenders it from the gamepad door",
);

// ---------------------------------------------------------------------------
// **A release made while the console owns the pointer is still seen (#378).**
// The button goes down in flight, the head turns with it held, and it comes up
// over the console's tab — where the pointer now is. `pointerup` is on `window`,
// so the game has to hear it there, or the gun fires the moment the head is back.
// The first check guards the two beside-the-console rows: the same press held in
// flight does fire, so a build whose trigger never fires cannot pass them.
// ---------------------------------------------------------------------------
const homeForFire = await relockForward(page);
const heldFlight = await pressAndRead(page);
check(
	"and the same press held in flight does fire, so the beside-the-console rows can fail",
	homeForFire.took && heldFlight.trigger && heldFlight.heat > heldFlight.cool,
	`locked=${homeForFire.took} trigger=${heldFlight.trigger} heat ${heldFlight.cool} -> ${heldFlight.heat}`,
);
await page.keyboard.press("3");
await settle(page);
const tabAt = await page.evaluate(() => {
	const r = document
		.querySelector('[data-live-right-tab="Tuning"]')
		.getBoundingClientRect();
	return {
		x: r.left + r.width / 2,
		y: r.top + r.height / 2,
		lock: document.pointerLockElement?.tagName ?? null,
	};
});
await page.mouse.move(tabAt.x, tabAt.y);
await page.mouse.up();
await settle(page);
const releasedOn = await page.evaluate(
	({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".lc-tab")),
	tabAt,
);
await page.keyboard.press("2");
await settle(page);
const coolHome = await heat(page);
await page.waitForTimeout(300);
await settle(page);
const home = {
	head: await headLook(page),
	trigger: await trigger(page),
	heat: await heat(page),
};
check(
	"a release made over the console's tab is seen: back in flight the gun is quiet",
	tabAt.lock === null &&
		releasedOn &&
		home.head === "forward" &&
		!home.trigger &&
		home.heat <= coolHome,
	`lock at release=${tabAt.lock} on tab=${releasedOn} head=${home.head} trigger=${home.trigger} heat ${coolHome} -> ${home.heat}`,
);

// ---------------------------------------------------------------------------
// The same rule one surface up. The settings screen never released the lock at
// all, so the screen every player opens had the same dead rows. Why the Commander
// overlay keeps its own release is `reconcilePointerLock`'s to say; the row in
// `tests/pad-bindings.test.ts` is what keeps a third from arriving unremarked.
// ---------------------------------------------------------------------------
// The same premise as every surrender row: a screen opened on an unlocked page
// surrenders nothing, so the relock's own answer is part of the row.
const beforeSettings = (await relockForward(page)).took;
// One premise belongs to the two rows below it: a screen that is not mounted has
// no key to press. Driving `z` at nothing used to read as the game refusing to
// surrender the lock, which is #418's misreading one surface over, so the answer
// is a row and the press is conditional on it. What the wait measures is
// `waitForSettingsPanel`'s to say, and `tests/probe-settings-key.test.ts` is what
// keeps a press from arriving without it.
const settingsMounted = await waitForSettingsPanel(page);
check(
	"the settings screen is mounted before its key is driven",
	settingsMounted,
	`locked-before=${beforeSettings}`,
);
if (settingsMounted) {
	await page.keyboard.press("z");
	await settle(page);
}
check(
	"opening the settings screen surrenders the lock as well",
	settingsMounted &&
		beforeSettings &&
		(await lockHolder(page)) === null &&
		(await surface(page)) === "modal",
	`mounted=${settingsMounted} locked-before=${beforeSettings} lock=${await lockHolder(page)} surface=${await surface(page)}`,
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

// ---------------------------------------------------------------------------
// **The instrument over a console** — the case where the context says the mouse
// flies the ship and a console is drawn anyway. `readPadContext` answers
// `instrument` before it tests for a console, so this is not a hypothetical: the
// pad's `down` focuses the frame instrument and its `1`/`2`/`3` still turn the
// head. Sage, round 5, found that the shipped rule let the overlay keep a pointer
// the console behind it needed, and the principal ruled that a drawn console wins.
// On its own page with `?perf`, so the overlay touches nothing else measured here.
// ---------------------------------------------------------------------------
const inst = await browser.newPage({ viewport: { width: W, height: H } });
watch(inst, "the instrument over a console");
await inst.addInitScript(installFakePad);
await inst.goto(gameUrl(origin, { seed: SEED, perf: "1" }), {
	waitUntil: "load",
});
await bootedGame(inst);
await clickGlass(inst);
await pressPad(inst, "down");
check(
	"the d-pad's `down` puts the frame instrument in focus, which flies the ship",
	(await surface(inst)) === "instrument" && (await canvasLock(inst)),
	`ctx=${await surface(inst)} lock=${await lockHolder(inst)}`,
);
await inst.keyboard.press("3");
await settle(inst);
const over = await inst.evaluate(() => ({
	ctx: window.__seelite.padContext(),
	head: window.__seelite.headLook,
	lock: document.pointerLockElement?.tagName ?? null,
}));
check(
	"and the console drawn under that overlay still owns the pointer",
	over.lock === null && over.ctx === "instrument" && over.head === "right",
	`lock=${over.lock} ctx=${over.ctx} head=${over.head}`,
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
	// **Count the asks, and hand back the real promise.** A row that only asserts
	// "nothing leaked" passes on the game never having asked at all, which is what
	// this one did until sage, round 2. Counting is not stubbing: the call below is
	// the browser's own, so a refusal still rejects exactly as it would unobserved.
	const ask = HTMLElement.prototype.requestPointerLock;
	window.__asks = 0;
	HTMLElement.prototype.requestPointerLock = function requestPointerLock() {
		window.__asks++;
		return ask.call(this);
	};
});
await plain.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(plain);
const centre = await plain.evaluate(
	() =>
		document.elementFromPoint(
			Math.round(innerWidth * 0.5),
			Math.round(innerHeight * 0.5),
		)?.tagName ?? null,
);
// Five clicks at the default launcher, where no lock is grantable at all: the
// game asks every time and must swallow every refusal. `mouse.click` here, not
// `clickGlass` — this page is the launcher, not the glass the rows above use.
for (let click = 0; click < 5; click++) {
	await plain.mouse.click(Math.round(W * 0.5), Math.round(H * 0.5));
	await plain.waitForTimeout(120);
}
const [refusals, asks] = await plain.evaluate(() => [
	window.__refusals,
	window.__asks,
]);
check(
	"the game does ask for the lock out here, so the row below has something to refuse",
	centre === "CANVAS" && asks >= 1,
	`hit=${centre} asks=${asks}`,
);
check(
	"and a refusal is read by the game, not thrown to the page",
	asks >= 1 && refusals.length === 0,
	refusals.length ? `${refusals.length} × ${refusals[0]}` : "",
);
await shell.close();

exit();
