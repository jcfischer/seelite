/**
 * A rebind that reaches the simulation (#381, slice 2).
 *
 * This is the case no probe on `main` could produce, and the reason the
 * dispatch fold exists. `tests/dispatch.test.ts` says the registry answers a
 * layout that is not the shipped one; that is a table changing. **A table
 * changing is not a ship flying**, and every row here is written against the
 * ship's own attitude rather than against anything the binding model reports
 * about itself.
 *
 * The measurement is the angle the nose turns through while a key is held, in
 * degrees, read off `__seelite.nose()`. Three arms and they are all needed:
 * the shipped key, so the instrument is known to be able to answer; the same
 * key after the rebind, which must now do nothing; and the new key, which must
 * do what the old one did. Drop the first and a build where no key flies the
 * ship passes the second; drop the second and a build that binds the new key
 * *beside* the old one passes the third.
 *
 * A fourth arm holds the null: the same wait with nothing held. **It is a
 * residual and not a control**, and it was sold as one for a round. `atRest`
 * returns only once two samples 50 ms apart agree to within 0.02° — under
 * 0.4°/s — so a 400 ms wait after it cannot turn much more than 0.16°
 * whatever the build does. The arm reports what the rest gate leaves rather
 * than measuring what the ship does, and the row it feeds says only that the
 * held readings are orders of magnitude above that floor.
 */
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

/**
 * The key the rebind moves pitch-up onto.
 *
 * `8` on purpose: the shipped layout binds `0` through `3` and nothing else in
 * the digit row, so it is a key with no row at all. A key that merely looked
 * free — one the perf panel owns, say — would make a pass here ambiguous
 * between the rebind working and the other binding firing.
 */
const NEW_KEY = "8";
/** How long a key is held, and how long the null arm waits. */
const HOLD_MS = 400;

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
await bootedGame(page);

const settle = (p) =>
	p.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

const nose = () => page.evaluate(() => window.__seelite.nose());

/** The angle between two unit noses, in degrees. */
const degreesBetween = (a, b) => {
	const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
	return (Math.acos(dot) * 180) / Math.PI;
};

/**
 * Wait until the ship has stopped turning.
 *
 * Without this every arm reads the arm before it. A released pitch key leaves
 * the ship rotating — `stepAngular` damps it over a second or so — and the
 * first pass of this probe read 8.70° for a key that had just been unbound,
 * which is a confident red on a build that was working. An arm that measures
 * an angle owes the state it started from.
 */
let restFailed = false;
async function atRest() {
	// One read per tick: the sample that ends this iteration begins the next.
	let prev = await nose();
	for (let i = 0; i < 200; i++) {
		await page.waitForTimeout(50);
		const now = await nose();
		if (degreesBetween(prev, now) < 0.02) return true;
		prev = now;
	}
	restFailed = true;
	// **Reported, not thrown.** A throw at top level here aborts before
	// `browser.close()` and `exit()`, so a build whose damping broke would
	// crash the suite rather than name a failing row — which is the hazard
	// this file already names for `page.evaluate`.
	return false;
}

/** Hold `key` for `HOLD_MS` and report how far the nose turned. `null` holds
 *  nothing, which is the drift arm. */
async function turnedWhileHolding(key) {
	await atRest();

	const before = await nose();
	if (key !== null) await page.keyboard.down(key);
	await page.waitForTimeout(HOLD_MS);
	if (key !== null) await page.keyboard.up(key);
	await settle(page);
	return degreesBetween(before, await nose());
}

// ---------------------------------------------------------------------------
// The instrument, and the drift it is read against.
// ---------------------------------------------------------------------------
// **A discarded hold first, because the first arm is not comparable.** With
// the band in place the figures came out 20.52° for the opening arm and
// 14.77-14.89° for every one after it — a 1.38x step, repeatable, and nothing
// to do with the rebind. Whatever the page is still doing on the first hold
// after boot, an arm read there is a different measurement from the rest, and
// a control that is not in the same regime as the thing it controls for is
// the "comparisons must offer both sides the same menu" defect with the arms
// in time order rather than in argument order.
await turnedWhileHolding("s");
const shipped = await turnedWhileHolding("s");
// The null arm **after** a real one, not before it: from boot the ship is
// already still, so a drift figure read there says nothing about the state
// the other arms actually start in.
const residual = await turnedWhileHolding(null);
check(
	"the shipped `s` pitches the ship, well clear of an absolute floor and of the residual",
	// **Two terms, because the ratio alone has no floor — and the comment
	// here argued the inverse for a round.** `atRest` caps `residual` from
	// *above*, so `residual * 50` is the **largest** the threshold can be:
	// a well-settled ship reading 0.001° reduces the row to `shipped > 0.05`,
	// and the build this was meant to catch — the key reaching nothing, at
	// 0.01° — would have passed it green. The absolute term is what actually
	// holds; the ratio is kept beside it because it is the one that fails when
	// the ship is *not* settled and the reading is drift.
	shipped > 5 && shipped > residual * 50,
	`held ${shipped.toFixed(2)}°, floor 5.00°, residual ${residual.toFixed(2)}° (x50 = ${(residual * 50).toFixed(2)}°)`,
);

// ---------------------------------------------------------------------------
// The rebind, through the route the capture modal will take.
// ---------------------------------------------------------------------------
/**
 * One rebind, through the route the capture modal will take.
 *
 * Caught rather than allowed to reject: an evaluate that throws aborts the
 * probe, so a refusal would take the suite down instead of printing a red row.
 * One helper rather than three copies of the block — the third copy had
 * already drifted to a different prefix, which is what a copied block invites.
 */
const tryRebind = (command, from, to) =>
	page.evaluate(
		([id, a, b]) => {
			try {
				window.__seelite.rebindCommand(id, a, b);
				return "accepted";
			} catch (e) {
				return `refused: ${e instanceof Error ? e.message : String(e)}`;
			}
		},
		[command, from, to],
	);

const moved = await tryRebind(
	"fly.pitchUp",
	{ kind: "key", key: "s", hold: true },
	{ kind: "key", key: NEW_KEY, hold: true },
);
check("the rebind is accepted", moved === "accepted", moved);

const oldKey = await turnedWhileHolding("s");
check(
	"the key pitch-up was moved off no longer pitches the ship",
	oldKey < 1,
	`held ${oldKey.toFixed(2)}°, against ${shipped.toFixed(2)}° before the rebind`,
);

/**
 * Parity is a band against the shipped reading in the same run, not a floor.
 *
 * `> 5` was the first threshold and it is the wrong shape: the shipped key
 * reads about 16°, so a rebind delivering a third of the rate would have
 * passed and printed as parity.
 *
 * **The band is what found the warm-up defect above**, which a floor would
 * have hidden for as long as the floor stayed low.
 *
 * Its width is measured rather than guessed, and **over three runs rather than
 * one** — a single run's spread was quoted here for a round, which is this
 * repo's own "one sample is not a measurement". Twelve measured arms across
 * three consecutive runs read 14.79° to 15.66°, so about ±3% around 15.2°;
 * 0.8-1.2x needs a 20% deviation and has room. A 400 ms hold is still not a
 * rate measurement, which is why the band is this wide and not tighter.
 */
const BAND = [0.8, 1.2];
const parity = (turned) =>
	turned > shipped * BAND[0] && turned < shipped * BAND[1];
/** The band as a red row prints it — interpolated, so the printed acceptance
 *  criterion cannot diverge from the one that ran. It did, for a round. */
const bandText = `band ${BAND[0]}-${BAND[1]}x of ${shipped.toFixed(2)}°`;
const newKey = await turnedWhileHolding(NEW_KEY);
check(
	`and \`${NEW_KEY}\` pitches it as \`s\` did — the rebind reached the simulation`,
	parity(newKey),
	`held ${newKey.toFixed(2)}° on the shipped key's ${bandText}`,
);

// ---------------------------------------------------------------------------
// Nothing else moved with it.
// ---------------------------------------------------------------------------
const otherHalf = await turnedWhileHolding("w");
check(
	"the other half of the same axis is untouched",
	parity(otherHalf),
	`held ${otherHalf.toFixed(2)}°, ${bandText}`,
);
const arrow = await turnedWhileHolding("ArrowDown");
check(
	"and so is the arrow that shared the command with the key that moved",
	parity(arrow),
	`held ${arrow.toFixed(2)}°, ${bandText}`,
);

// ---------------------------------------------------------------------------
// And a *pressed* command, which is the other path entirely.
//
// A held command is read out of the layout every frame by `isHeld`; a pressed
// one goes through `onKey` — `keyDispatch` decides `oneShot`, then `resolveKey`
// answers against the layout in force. Moving only `fly.pitchUp` left that
// second path unexercised in this tier, and the two share no code below
// `resolveKey`.
// ---------------------------------------------------------------------------
const view = () => page.evaluate(() => window.__seelite.view);
/** Press one key, let two frames pass, and read the view back. A copy of this
 *  that forgot the settle would read the frame before the press. */
const pressAndRead = async (key) => {
	await page.keyboard.press(key);
	await settle(page);
	return view();
};
const toggledOnV = await pressAndRead("v");
const backFromV = await pressAndRead("v");
check(
	"the shipped `v` toggles the view, so the arm below can fail",
	toggledOnV !== backFromV,
	`v gave ${toggledOnV}, and back to ${backFromV}`,
);
const movedPress = await tryRebind(
	"view.toggle",
	{ kind: "key", key: "v" },
	{ kind: "key", key: "7" },
);
check(
	"the pressed command's rebind is accepted",
	movedPress === "accepted",
	movedPress,
);
const before7 = await view();
const afterOldPress = await pressAndRead("v");
const afterNewPress = await pressAndRead("7");
check(
	"the key the view toggle was moved off no longer toggles it",
	afterOldPress === before7,
	`${before7} -> ${afterOldPress}`,
);
check(
	"and `7` toggles it — a pressed rebind reaches the game through onKey",
	afterNewPress !== afterOldPress,
	`${afterOldPress} -> ${afterNewPress}`,
);
await pressAndRead("7");

// ---------------------------------------------------------------------------
// A rebind that names no such binding is refused rather than ignored.
//
// In the page, not only in the unit tier: a capture modal that reported
// success and moved nothing is the defect, and it is the wiring here that
// would swallow the throw.
// ---------------------------------------------------------------------------
const refused = await tryRebind(
	"fly.pitchUp",
	{ kind: "key", key: "j" },
	{ kind: "key", key: "9", hold: true },
);
check(
	"a rebind off a trigger the command does not have is refused",
	refused.startsWith("refused:"),
	refused,
);
const afterRefusal = await turnedWhileHolding("9");
check(
	"and the refused key flies nothing",
	afterRefusal < 1,
	`held ${afterRefusal.toFixed(2)}°`,
);

check(
	"and the rest gate settled every arm rather than running out of patience",
	// **Last, after every arm.** It sat after the third of nine and the five
	// later `atRest` calls could not reach it, so an exhausted gate on a
	// parity or refusal arm failed open — the reading taken against a still
	// rotating ship, with the row named after that case already green.
	restFailed === false,
	`atRest exhausted its 200 ticks on at least one arm: ${restFailed}`,
);

await browser.close();
exit();
