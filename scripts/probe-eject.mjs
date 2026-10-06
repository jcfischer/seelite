/**
 * The eject control, in the page (node #703, on #660 D4 and D5).
 *
 * `tests/eject.test.ts` holds the law — the binding row, the hold, the refusal
 * table. `main.ts` cannot load headless, so this holds the wiring: a real held
 * Backspace in flight fires the eject event once and no sooner than the hold,
 * a tap fires nothing, and the same key on the rails of an arrival, docked and
 * on the rails of a launch is refused where a pilot in the cockpit reads it —
 * the glass on the rails, the station console's message line docked.
 *
 * **The event, not what it costs.** An eject records itself on `ejects`; the
 * pod, the empty hold and the wake are node #704's, and nothing here looks for
 * them.
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
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
	return {
		holdMs: eject.EJECT_HOLD_S * 1000,
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
			ejects: g.ejects.length,
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

const downAt = Date.now();
await page.keyboard.down("Backspace");
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
const fired = await page
	.waitForFunction(() => window.__seelite.ejects.length >= 1, null, {
		timeout: law.holdMs * 6,
	})
	.then(
		() => true,
		() => false,
	);
const firedAfterMs = Date.now() - downAt;
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
// **Less one frame**, and that is the hold's arithmetic rather than slack: the
// first frame after the keydown adds that frame's whole `dt`, part of which
// passed before the key went down, so the sim's hold may complete up to one
// frame of wall time early. A 30 Hz frame bounds it on a loaded machine.
const FRAME_MS = 1000 / 30;
check(
	"and no sooner than the hold the page itself declares, less one frame",
	firedAfterMs >= law.holdMs - FRAME_MS,
	`${firedAfterMs} ms against a ${law.holdMs} ms hold`,
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
	"the Controls tab has an eject row naming the held key and the held pad button",
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
await page.keyboard.down("Backspace");
const launchSaid = await glassSays(law.refused.launching);
await page.keyboard.up("Backspace");
const after = await read();
check(
	"on the launch's rails a press is refused on the glass",
	launching === "launching" && launchSaid,
	`${launching}, said ${launchSaid}`,
);
check(
	"and across all three refusals the one eject from flight is still the only one",
	after.ejects === 1,
	`ejects ${after.ejects}`,
);

await browser.close();
exit();
