/**
 * The eject control, in the page (node #703, on #660 D4 and D5).
 *
 * `tests/eject.test.ts` holds the law — the binding row, the hold, the refusal
 * table. `main.ts` cannot load headless, so this holds the wiring: a real held
 * Backspace in flight fires the eject event once and no sooner than the hold,
 * a tap fires nothing, a hold with the head turned to a side console fires
 * nothing, a spent hold kept down through the Settings screen stays spent, a
 * hold cut by a lost window focus or a held clock does not finish what it
 * had, a spent hold let go under the Postcard screen is let go, and the same key on the rails of an arrival, docked and
 * on the rails of a launch is refused where a pilot in the cockpit reads it —
 * the glass on the rails, the station console's message line docked.
 *
 * **The event, not what it costs.** An eject counts itself on `ejectCount`; the
 * pod, the empty hold and the wake are node #704's, and nothing here looks for
 * them. The control is offered in a dev build only until then
 * (`EJECT_OFFERED` in `main.ts`), and a probe runs against a dev server.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
	waitForSettingsPanel,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
await bootedGame(page);

// The figures and the words off the page, never restated here.
const law = await page.evaluate(async () => {
	const eject = await import("/src/eject.ts");
	const market = await import("/src/market.ts");
	const units = await import("/src/units.ts");
	return {
		holdMs: eject.EJECT_HOLD_S * 1000,
		maxDtMs: units.MAX_DT * 1000,
		pod: market.ESCAPE_POD,
		refused: eject.EJECT_REFUSED_TEXT,
		dockedSentence: eject.EJECT_DOCKED_SENTENCE,
	};
});

const read = () =>
	page.evaluate(() => {
		const g = window.__seelite;
		return {
			phase: g.dockPhase,
			ejects: g.ejectCount,
			render: g.ejectRender,
		};
	});

/** Wait for the eject row on the glass to satisfy `test`, the key down. */
const glassSays = (text, timeout = 3000) =>
	page
		.waitForFunction(
			(want) => window.__seelite.ejectRender?.text === want,
			text,
			{ timeout },
		)
		.then(
			() => true,
			() => false,
		);

/**
 * Wait for the eject count to reach `count`, and read how long after
 * `startedAtMs` — a page clock — the last eject recorded itself. One reading
 * for every row that times a hold (sage round 6).
 */
const waitForEject = async (count, startedAtMs) => {
	const fired = await page
		.waitForFunction((want) => window.__seelite.ejectCount >= want, count, {
			timeout: law.holdMs * 6,
		})
		.then(
			() => true,
			() => false,
		);
	const elapsedMs = await page.evaluate(
		(at) => (window.__seelite.lastEject?.atMs ?? Number.NaN) - at,
		startedAtMs,
	);
	return { fired, elapsedMs };
};

const fitPod = (fitted) =>
	page.evaluate(
		({ pod, fitted }) => {
			const g = window.__seelite;
			const rest = g.commander.ownedEquipment.filter((n) => n !== pod);
			g.commander = {
				...g.commander,
				ownedEquipment: fitted ? [...rest, pod] : rest,
			};
			g.view = "cockpit";
			g.setHeadLook("forward");
		},
		{ pod: law.pod, fitted },
	);

// ---------------------------------------------------------------------------
// In flight, with no pod: refused, and said on the glass.
// ---------------------------------------------------------------------------
await fitPod(false);
const start = await read();
check("the probe starts in flight", start.phase === "flying", start.phase);
await page.keyboard.down("Backspace");
const noPodSaid = await glassSays(law.refused["no-pod"]);
if (process.env.EJECT_EVIDENCE)
	await page.screenshot({ path: `${process.env.EJECT_EVIDENCE}/refused.png` });
await page.waitForTimeout(law.holdMs * 1.5);
await page.keyboard.up("Backspace");
const noPod = await read();
check(
	"without a pod a held Backspace is refused on the glass, and fires nothing",
	noPodSaid && noPod.ejects === 0,
	`said ${noPodSaid}, ejects ${noPod.ejects}`,
);

// ---------------------------------------------------------------------------
// With a pod: a tap does nothing, a hold fires once and no sooner.
// ---------------------------------------------------------------------------
await fitPod(true);
await page.keyboard.down("Backspace");
await page.waitForTimeout(Math.min(120, law.holdMs / 4));
await page.keyboard.up("Backspace");
await page.waitForTimeout(law.holdMs);
const tap = await read();
check(
	"a tap of Backspace fires no eject — the hold is the confirm",
	tap.ejects === 0,
	`ejects ${tap.ejects}`,
);

await page.keyboard.down("Backspace");
// The page's clock, read after the key is down: the eject records the same
// clock as it fires, so the interval is the page's own and no polling or
// transport delay can lengthen it — and a start read late can only shorten
// it, which errs toward red (sage round 1).
const downAtMs = await page.evaluate(() => performance.now());
const arming = await page
	.waitForFunction(
		() => window.__seelite.ejectRender?.text?.startsWith("HOLD TO EJECT"),
		null,
		{ timeout: 3000 },
	)
	.then(
		() => read(),
		() => null,
	);
// The row's look is the principal's (CLAUDE.md's third tier), so a run can
// leave a frame of it beside the prompt line for a person to read. Off by
// default: a screenshot inside the hold would slow the very window it times.
if (process.env.EJECT_EVIDENCE)
	await page.screenshot({ path: `${process.env.EJECT_EVIDENCE}/arming.png` });
const { fired, elapsedMs: firedAfterMs } = await waitForEject(1, downAtMs);
// Held on past the eject: a second one would be a held key firing per frame.
await page.waitForTimeout(law.holdMs * 1.5);
await page.keyboard.up("Backspace");
const held = await read();
check(
	"while held, the glass shows the hold filling, and nothing has fired yet",
	arming?.render?.refused === false && arming.ejects === 0,
	JSON.stringify(arming),
);
check(
	"held in flight, the eject event fires exactly once",
	fired && held.ejects === 1,
	`fired ${fired}, ejects ${held.ejects}`,
);
// **Less one step**, and that is the hold's arithmetic rather than slack: the
// first step after the keydown adds that frame's whole `dt`, part of which
// passed before the key went down, so the sim's hold may complete up to one
// step of wall time early. The frame loop clamps a step at `MAX_DT`, which is
// therefore the bound — not a frame rate guessed for a loaded machine, which
// a 20 Hz frame would have exceeded (sage round 2).
check(
	"and no sooner than the hold the page itself declares, less one step",
	firedAfterMs >= law.holdMs - law.maxDtMs,
	`${Math.round(firedAfterMs)} ms against a ${law.holdMs} ms hold, ${law.maxDtMs} ms step`,
);

// ---------------------------------------------------------------------------
// Head turned to a side console: idle, because there is no glass to show the
// hold filling on, and a hold that cannot be seen is not a confirm (sage
// round 2). The pod is still fitted, so a fire here would be a second eject.
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__seelite.setHeadLook("right"));
await page.keyboard.down("Backspace");
await page.waitForTimeout(law.holdMs * 1.5);
const turned = await read();
await page.keyboard.up("Backspace");
await page.evaluate(() => window.__seelite.setHeadLook("forward"));
// The eject count is the whole check. `ejectRender` is not in it: a turned
// head draws no glass at all, so the row reads null with the gate or without.
check(
	"with the head turned to a side console a held Backspace fires nothing",
	turned.phase === "flying" && turned.ejects === 1,
	JSON.stringify(turned),
);

// ---------------------------------------------------------------------------
// The controls help names it, so the first-day lesson and the warning can.
// ---------------------------------------------------------------------------
const row = await page.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("right");
	g.updateCockpit();
	const tab = document.querySelector('[data-live-right-tab="Controls"]');
	if (tab instanceof HTMLElement) tab.click();
	const text =
		document.querySelector('[data-live-controls-row="fly.eject"]')
			?.textContent ?? null;
	g.setHeadLook("forward");
	g.updateCockpit();
	return text;
});
check(
	"the Controls tab has an eject row naming the held key and the held pad button", // glossary-ignore: pad
	row !== null && row.includes("hold Backspace") && row.includes("hold Home"),
	`${row}`,
);

// ---------------------------------------------------------------------------
// On the rails of an arrival: refused on the glass, the one line it carries.
// ---------------------------------------------------------------------------
const station = await page.evaluate(async () => {
	const g = window.__seelite;
	const id =
		g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "trade",
		)?.id ?? g.world.system.bodies.find((b) => b.kind === "station")?.id;
	if (!id) throw Error("no station");
	await window.__parkInBerth(id, g.berthIdsOfStation(id)[0], {
		stopAtArrivalFraction: 0.4,
	});
	g.view = "cockpit";
	g.setHeadLook("forward");
	return id;
});
const arriving = await read();
await page.keyboard.down("Backspace");
const arrivalSaid = await glassSays(law.refused.arriving);
await page.keyboard.up("Backspace");
check(
	"on the arrival's rails a press is refused on the glass",
	arriving.phase === "arriving" && arrivalSaid,
	`${station} · ${arriving.phase}, said ${arrivalSaid}`,
);

// ---------------------------------------------------------------------------
// Docked: refused on the station console, which is the docked glass.
// ---------------------------------------------------------------------------
const docked = await page.evaluate(() => {
	const g = window.__seelite;
	for (let i = 0; i < 60 * 60 && g.dockPhase !== "docked"; i++) {
		g.skipDockTraversal();
		g.step(1 / 60);
	}
	g.setHeadLook("forward");
	g.updateCockpit();
	return {
		phase: g.dockPhase,
		console:
			document.querySelector("[data-live-station-console]") instanceof
			HTMLElement,
	};
});
check(
	"the ship is docked with the station console up",
	docked.phase === "docked" && docked.console,
	JSON.stringify(docked),
);
await page.keyboard.down("Backspace");
const dockedSaid = await page
	.waitForFunction(
		(want) =>
			document.querySelector("[data-live-station-message]")?.textContent ===
			want,
		law.dockedSentence,
		{ timeout: 3000 },
	)
	.then(
		() => true,
		() => false,
	);
await page.waitForTimeout(law.holdMs * 1.5);
const dockedHeld = await read();
await page.keyboard.up("Backspace");
check(
	"docked, a held Backspace is refused on the station console's message line",
	dockedSaid,
	await page.evaluate(
		() =>
			document.querySelector("[data-live-station-message]")?.textContent ??
			null,
	),
);
// Not `ejectRender`: a docked cockpit facing the console renders no scene at
// all (`sceneRenderEligible`), so the record holds whatever the last drawn
// frame left and says nothing about this one.
check(
	"and fires nothing, however long it is held",
	dockedHeld.ejects === 1,
	JSON.stringify(dockedHeld),
);
// **What the glass left is under the console, not over it.** No render means
// no `clearRect` either, so the overlay keeps the last arrival frame — which
// in this run carried the arrival's refusal, pressed seconds before the dock.
// That is safe only while the console covers the whole overlay, so the probe
// asks the page where the overlay is and what is on top of it there.
const covered = await page.evaluate(() => {
	const overlay = document.getElementById("overlay")?.getBoundingClientRect();
	const panel = document
		.querySelector("[data-live-station-console]")
		?.getBoundingClientRect();
	if (!overlay || !panel) return { overlay: !!overlay, panel: !!panel };
	const spans =
		panel.left <= overlay.left &&
		panel.top <= overlay.top &&
		panel.right >= overlay.right &&
		panel.bottom >= overlay.bottom;
	// Below the middle, where the glass's notice rows are, and at the centre.
	const points = [0.5, 0.6].map((f) =>
		document
			.elementFromPoint(overlay.width / 2, overlay.height * f)
			?.closest("[data-live-station-console]"),
	);
	return { spans, onTop: points.every((p) => p != null) };
});
check(
	"and the overlay's last flight frame is under the docked console, which spans it",
	covered.spans === true && covered.onTop === true,
	JSON.stringify(covered),
);

// ---------------------------------------------------------------------------
// On the rails of a launch: refused on the glass.
// ---------------------------------------------------------------------------
const launching = await page.evaluate(() => {
	const g = window.__seelite;
	g.launch();
	g.step(1 / 60);
	g.setHeadLook("forward");
	return g.dockPhase;
});
// Within the docked refusal's time on the glass, before any press here: the
// refusal belongs to the phase it was said in, so the rails carry nothing.
const railsBefore = await page.evaluate(
	() =>
		new Promise((done) =>
			requestAnimationFrame(() =>
				requestAnimationFrame(() => done(window.__seelite.ejectRender)),
			),
		),
);
check(
	"the docked refusal does not follow the ship onto the launch's rails",
	launching === "launching" && railsBefore === null,
	JSON.stringify(railsBefore),
);
await page.keyboard.down("Backspace");
const launchSaid = await glassSays(law.refused.launching);
check(
	"on the launch's rails a press is refused on the glass",
	launching === "launching" && launchSaid,
	`${launching}, said ${launchSaid}`,
);
// **Still held**, through a head turn, while the launch completes, and then
// forward again: the turn idles the control but must not un-spend the refused
// hold, or turning forward would arm it fresh in flight and eject a pilot who
// was told no. Only letting go clears it.
await page.evaluate(() => window.__seelite.setHeadLook("right"));
const clear = await page
	.waitForFunction(() => window.__seelite.dockPhase === "flying", null, {
		timeout: 60_000,
	})
	.then(
		() => true,
		() => false,
	);
await page.evaluate(() => window.__seelite.setHeadLook("forward"));
await page.waitForTimeout(law.holdMs * 1.5);
const turnedThrough = await read();
check(
	"a refused hold kept down through a head turn and the launch's end fires nothing on turning forward",
	clear && turnedThrough.phase === "flying" && turnedThrough.ejects === 1,
	`cleared ${clear}, ${JSON.stringify(turnedThrough)}`,
);
const after = await read();
check(
	"and across all three refusals the one eject from flight is still the only one",
	after.ejects === 1,
	`ejects ${after.ejects}`,
);
// The same spent hold, **let go at a side console** and pressed again there
// (sage round 3): a release is a release wherever the head is, so the fresh
// hold arms on turning forward. Keeping `spent` through a turned-head release
// left it dead until a second release made facing forward.
await page.evaluate(() => window.__seelite.setHeadLook("right"));
await page.waitForTimeout(100);
await page.keyboard.up("Backspace");
await page.waitForTimeout(100);
await page.keyboard.down("Backspace");
await page.waitForTimeout(100);
await page.evaluate(() => window.__seelite.setHeadLook("forward"));
await page.waitForTimeout(law.holdMs * 1.5);
const repressed = await read();
await page.keyboard.up("Backspace");
check(
	"a hold let go and pressed again at a side console fires on turning forward",
	repressed.phase === "flying" && repressed.ejects === 2,
	JSON.stringify(repressed),
);

// A spent hold **kept down through the Settings screen** (sage round 4): the
// screen empties the game's held keys as it opens, and that is not a release.
// The OS repeat puts the key back once the screen has closed — Playwright's
// second `down` on a held key is that repeat — and the hold must still be
// spent. The first hold completes an eject in flight, which is the simplest
// spent hold there is. The wait first: the last row let go of the key, and
// a release no frame saw is not one.
await page.waitForTimeout(100);
await page.keyboard.down("Backspace");
await page.waitForTimeout(law.holdMs * 1.5);
const spentByEject = await read();
// The screen mounts from a deferred import; long since landed by now, but a
// screen that never arrived is reported as that, not as a key that did nothing.
const settingsMounted = await waitForSettingsPanel(page);
await page.keyboard.press("z");
const settingsOpened = await page
	.waitForSelector("[data-settings-panel]", { timeout: 5000 })
	.then(
		() => true,
		() => false,
	);
const keysWhileOpen = await page.evaluate(() => window.__seelite.heldKeyCount);
await page.keyboard.press("Escape");
const settingsClosed = !(await page.$("[data-settings-panel]"));
await page.keyboard.down("Backspace");
// The repeat must have landed, or the row below passes on a key the game
// never saw again and says nothing about a release.
const repeatLanded = await page.evaluate(() => window.__seelite.heldKeyCount);
await page.waitForTimeout(law.holdMs * 1.5);
const throughSettings = await read();
await page.keyboard.up("Backspace");
check(
	"a spent hold kept down through the Settings screen fires nothing when the key repeats after it",
	spentByEject.ejects === 3 &&
		settingsMounted &&
		settingsOpened &&
		keysWhileOpen === 0 &&
		settingsClosed &&
		repeatLanded > 0 &&
		throughSettings.phase === "flying" &&
		throughSettings.ejects === 3,
	`spent ${JSON.stringify(spentByEject)}, mounted ${settingsMounted}, opened ${settingsOpened}, keys while open ${keysWhileOpen}, closed ${settingsClosed}, repeat landed ${repeatLanded}, after ${JSON.stringify(throughSettings)}`,
);

/** Wait until the glass shows a hold filling, the key down. */
const armingShown = () =>
	page
		.waitForFunction(
			() => window.__seelite.ejectRender?.text?.startsWith("HOLD TO EJECT"),
			null,
			{ timeout: 3000 },
		)
		.then(
			() => true,
			() => false,
		);

// A hold part-filled **when the window loses focus** (sage round 5). The
// window never sees a release made elsewhere, and Playwright's key stays down
// with no repeat — which is that release's shape as the game sees it: no
// further keydown, no keyup. The game must stop counting the key, or the
// fill goes on and the pod goes with nothing down.
await page.waitForTimeout(100);
await page.keyboard.down("Backspace");
const blurArming = await armingShown();
await page.waitForTimeout(law.holdMs * 0.3);
await page.evaluate(() => window.dispatchEvent(new Event("blur")));
await page.waitForTimeout(law.holdMs * 1.5);
const blurred = await read();
await page.keyboard.up("Backspace");
check(
	"a hold part-filled when the window loses focus fires nothing after it",
	blurArming && blurred.phase === "flying" && blurred.ejects === 3,
	`arming ${blurArming}, ${JSON.stringify(blurred)}`,
);

// A hold part-filled **when the clock is held** (sage round 5): the frame loop
// skips the step, which is where the control is stepped. The clock is held
// here directly, which is what the Postcard screen does as it opens; the
// screen also empties the held keys, and this leaves Backspace held so the
// row isolates the stopped step. On the clock's release the hold must start
// over and take a whole hold, not finish what it had.
await page.waitForTimeout(100);
await page.keyboard.down("Backspace");
const clockArming = await armingShown();
await page.waitForTimeout(law.holdMs * 0.6);
await page.evaluate(() => {
	window.__seelite.clockHeld = true;
});
await page.waitForTimeout(200);
const whileHeld = await read();
const resumedAtMs = await page.evaluate(() => {
	window.__seelite.clockHeld = false;
	return performance.now();
});
const { fired: firedAfterResume, elapsedMs: resumeFiredAfterMs } =
	await waitForEject(4, resumedAtMs);
await page.keyboard.up("Backspace");
check(
	"a hold part-filled when the clock is held takes a whole hold after the clock runs again",
	clockArming &&
		whileHeld.ejects === 3 &&
		firedAfterResume &&
		resumeFiredAfterMs >= law.holdMs - law.maxDtMs,
	`arming ${clockArming}, ejects while held ${whileHeld.ejects}, fired ${firedAfterResume} ${Math.round(resumeFiredAfterMs)} ms after the release against a ${law.holdMs} ms hold`,
);

// A spent hold **let go while the Postcard screen is up** (sage round 6). The
// screen stops every keyup in the capture phase, so the game's own handler
// never hears it; the release is heard in the capture phase too, or the key
// stays physically down for good and the first real hold after the screen
// closes is dead. A spent hold is the subject: an eject in flight makes one.
await page.waitForTimeout(100);
await page.keyboard.down("Backspace");
await page.waitForTimeout(law.holdMs * 1.5);
const spentBeforePostcard = await read();
await page.keyboard.press("6");
const postcardOpened = await page
	.waitForFunction(() => window.__seelite.postcardPanel.isOpen(), null, {
		timeout: 5000,
	})
	.then(
		() => true,
		() => false,
	);
await page.keyboard.up("Backspace");
await page.waitForTimeout(100);
await page.keyboard.press("Escape");
const postcardClosed = await page
	.waitForFunction(() => !window.__seelite.postcardPanel.isOpen(), null, {
		timeout: 5000,
	})
	.then(
		() => true,
		() => false,
	);
await page.waitForTimeout(100);
await page.keyboard.down("Backspace");
const freshAtMs = await page.evaluate(() => performance.now());
const fresh = await waitForEject(6, freshAtMs);
await page.keyboard.up("Backspace");
check(
	"a spent hold let go under the Postcard screen arms afresh on the next hold after it closes",
	spentBeforePostcard.ejects === 5 &&
		postcardOpened &&
		postcardClosed &&
		fresh.fired &&
		fresh.elapsedMs >= law.holdMs - law.maxDtMs,
	`spent ${JSON.stringify(spentBeforePostcard)}, opened ${postcardOpened}, closed ${postcardClosed}, fired ${fresh.fired} ${Math.round(fresh.elapsedMs)} ms after the press against a ${law.holdMs} ms hold`,
);

// The release edge itself cancels, even if a new press arrives before the
// frame loop can observe it (sage round 7). Real DOM input handlers and bounded
// Game control steps run in one browser task to guarantee that ordering. This
// checks the input edge, not wall-clock timing; the rows above hold that timing.
const interFrame = await page.evaluate((law) => {
	const g = window.__seelite;
	const holdS = law.holdMs / 1000;
	const maxStepS = law.maxDtMs / 1000;
	const key = (type) =>
		window.dispatchEvent(
			new KeyboardEvent(type, {
				key: "Backspace",
				code: "Backspace",
				bubbles: true,
				cancelable: true,
			}),
		);
	const stepFor = (seconds) => {
		let left = seconds;
		while (left > 1e-9) {
			const dt = Math.min(left, maxStepS);
			g.stepEject(dt);
			left -= dt;
		}
	};
	const before = g.ejectCount;
	key("keydown");
	stepFor(holdS * 0.95);
	key("keyup");
	key("keydown");
	stepFor(holdS * 0.1);
	const afterShort = g.ejectCount;
	const shortHeldS = g.ejectHold.heldS;
	stepFor(holdS + maxStepS);
	const afterFull = g.ejectCount;
	key("keyup");
	key("keydown");
	stepFor(holdS + maxStepS);
	const afterFresh = g.ejectCount;
	key("keyup");
	return {
		before,
		afterShort,
		shortHeldS,
		afterFull,
		afterFresh,
		phase: g.dock.phase,
	};
}, law);
check(
	"release and repress between frames starts confirmation from zero",
	interFrame.phase === "flying" &&
		interFrame.afterShort === interFrame.before &&
		Math.abs(interFrame.shortHeldS - (law.holdMs / 1000) * 0.1) < 1e-6,
	JSON.stringify(interFrame),
);
check(
	"a spent hold released and repressed between frames can fire a fresh full hold",
	interFrame.afterFull === interFrame.before + 1 &&
		interFrame.afterFresh === interFrame.before + 2,
	JSON.stringify(interFrame),
);

await browser.close();
exit();
