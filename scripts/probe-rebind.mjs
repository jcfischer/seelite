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
 * A fourth arm holds the null: the same wait with nothing held. Without it
 * every figure below is quoted against zero rather than against the drift the
 * ship has anyway.
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
async function atRest() {
	// One read per tick: the sample that ends this iteration begins the next.
	let prev = await nose();
	for (let i = 0; i < 200; i++) {
		await page.waitForTimeout(50);
		const now = await nose();
		if (degreesBetween(prev, now) < 0.02) return;
		prev = now;
	}
	throw new Error("the ship never stopped turning");
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
const shipped = await turnedWhileHolding("s");
// The null arm **after** a real one, not before it: from boot the ship is
// already still, so a drift figure read there says nothing about the state
// the other arms actually start in.
const drift = await turnedWhileHolding(null);
check(
	"the shipped `s` pitches the ship, well clear of the drift it is read against",
	shipped > 5 && drift < 1,
	`held ${shipped.toFixed(2)}°, drift ${drift.toFixed(2)}°`,
);

// ---------------------------------------------------------------------------
// The rebind, through the route the capture modal will take.
// ---------------------------------------------------------------------------
// Caught rather than allowed to reject: an evaluate that throws aborts the
// probe, so a refusal would take the suite down instead of printing a red row
// — and the row would have been settled by its own `return true`.
const moved = await page.evaluate((key) => {
	try {
		window.__seelite.rebindCommand(
			"fly.pitchUp",
			{ kind: "key", key: "s", hold: true },
			{ kind: "key", key, hold: true },
		);
		return "accepted";
	} catch (e) {
		return `threw: ${e instanceof Error ? e.message : String(e)}`;
	}
}, NEW_KEY);
check("the rebind is accepted", moved === "accepted", moved);

const oldKey = await turnedWhileHolding("s");
check(
	"the key pitch-up was moved off no longer pitches the ship",
	oldKey < 1,
	`held ${oldKey.toFixed(2)}°, against ${shipped.toFixed(2)}° before the rebind`,
);

/**
 * Parity is a band against the shipped reading, not a floor.
 *
 * `> 5` was the first threshold and it is the wrong shape: the shipped key
 * reads about 20°, so a rebind delivering a quarter of the rate would have
 * passed and printed as parity. The band is read against `shipped` in the same
 * run, which is the only control that carries the machine's own frame cost —
 * and it is wide because a 400 ms hold is not a rate measurement: two arms of
 * the same build have read 20.62° and 16.96°, which is 82%.
 */
const parity = (turned) => turned > shipped * 0.7 && turned < shipped * 1.3;
const newKey = await turnedWhileHolding(NEW_KEY);
check(
	`and \`${NEW_KEY}\` pitches it as \`s\` did — the rebind reached the simulation`,
	parity(newKey),
	`held ${newKey.toFixed(2)}°, against ${shipped.toFixed(2)}° on the shipped key (band 0.7-1.3x)`,
);

// ---------------------------------------------------------------------------
// Nothing else moved with it.
// ---------------------------------------------------------------------------
const otherHalf = await turnedWhileHolding("w");
check(
	"the other half of the same axis is untouched",
	parity(otherHalf),
	`held ${otherHalf.toFixed(2)}°, against ${shipped.toFixed(2)}°`,
);
const arrow = await turnedWhileHolding("ArrowDown");
check(
	"and so is the arrow that shared the command with the key that moved",
	parity(arrow),
	`held ${arrow.toFixed(2)}°, against ${shipped.toFixed(2)}°`,
);

// ---------------------------------------------------------------------------
// A rebind that names no such binding is refused rather than ignored.
//
// In the page, not only in the unit tier: a capture modal that reported
// success and moved nothing is the defect, and it is the wiring here that
// would swallow the throw.
// ---------------------------------------------------------------------------
const refused = await page.evaluate(() => {
	try {
		window.__seelite.rebindCommand(
			"fly.pitchUp",
			{ kind: "key", key: "j" },
			{ kind: "key", key: "9", hold: true },
		);
		return "accepted";
	} catch (e) {
		return `refused: ${e instanceof Error ? e.message : String(e)}`;
	}
});
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

await browser.close();
exit();
