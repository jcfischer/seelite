/**
 * `flight-model.md` §3.5's keys reach the hull (#620).
 *
 * `tests/vent-keys.test.ts` holds the table and `pilotDemand`; neither can see
 * `main.ts` hand them to the sim. So every row here reads the ship itself —
 * its velocity along its own axes and its rates — while a key is held, beside
 * an arm that holds nothing or holds the key before it means anything:
 *
 * - an arrow strafes: the velocity grows across the nose, not along it, and
 *   the nose does not turn;
 * - with the assist off, `shift` fires the main drive and `control` the retro
 *   vents only while held, and neither moves the speed lever;
 * - a vent slot's command fires nothing until a pilot binds it, and bound and
 *   held with the assist off it both pushes and turns the hull, because one
 *   attitude vent fired alone does both (§3.2).
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them — the arrows, Shift, Ctrl and `x` for the assist.
import {
	degreesBetween,
	flightHarness,
	HOLD_MS,
} from "./lib/flight-harness.mjs";
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
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
await bootedGame(page);

const { settle, atRest, restFailed } = flightHarness(page);

/** The ship's velocity, its three hull axes, its rates and the lever. */
const read = () =>
	page.evaluate(() => {
		const g = window.__seelite;
		const nose = g.nose();
		const up = g.shipUp();
		const right = {
			x: nose.y * up.z - nose.z * up.y,
			y: nose.z * up.x - nose.x * up.z,
			z: nose.x * up.y - nose.y * up.x,
		};
		return {
			vel: { ...g.world.ship.vel },
			nose,
			up,
			right,
			rates: { ...g.rates },
			throttle: g.throttle,
			assist: g.assist,
		};
	});

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

let coastFailed = false;

/**
 * Wait until the velocity stops changing, as `atRest` waits for the nose.
 *
 * **Without it an arm reads the arm before it.** With the assist on, a
 * released strafe is a drift the assist is still burning off, and the first
 * red run of this probe read that decay into the next arm: ← measured
 * −0.190 km/s on a build where the arrows did nothing, a tenth under the
 * threshold. A constant drift with the assist off is coasting, and passes.
 */
async function coasting() {
	let prev = (await read()).vel;
	for (let i = 0; i < 100; i++) {
		await page.waitForTimeout(50);
		const now = (await read()).vel;
		const d = sub(now, prev);
		if (Math.hypot(d.x, d.y, d.z) < 1e-3) return;
		prev = now;
	}
	coastFailed = true;
}

/** Hold `key` (or nothing) for `HOLD_MS`, and say how the velocity changed
 *  along the hull's axes as they stood when the hold began, km/s. */
async function pushedWhileHolding(key) {
	await atRest();
	await coasting();
	const before = await read();
	if (key !== null) await page.keyboard.down(key);
	await page.waitForTimeout(HOLD_MS);
	if (key !== null) await page.keyboard.up(key);
	await settle();
	const after = await read();
	const dv = sub(after.vel, before.vel);
	return {
		along: dot(dv, before.nose),
		across: dot(dv, before.right),
		vertical: dot(dv, before.up),
		turnedDeg: degreesBetween(before.nose, after.nose),
		before,
		after,
	};
}

const fmt = (p) =>
	`Δv along ${p.along.toFixed(3)}, across ${p.across.toFixed(3)}, vertical ${p.vertical.toFixed(3)} km/s`;

// ---------------------------------------------------------------------------
// The null, first: the same wait with nothing held.
// ---------------------------------------------------------------------------
await pushedWhileHolding(null);
const still = await pushedWhileHolding(null);
const floor = Math.max(
	0.02,
	Math.abs(still.along),
	Math.abs(still.across),
	Math.abs(still.vertical),
);
check(
	"the boot is assist on, and nothing held moves the ship (the floor the arms are read against)",
	still.before.assist === true &&
		Math.abs(still.across) < 0.05 &&
		Math.abs(still.vertical) < 0.05,
	`${fmt(still)}; floor ${floor.toFixed(3)} km/s`,
);

// ---------------------------------------------------------------------------
// The arrows strafe.
// ---------------------------------------------------------------------------
// Each arrow is read twice from one hold: the velocity grows along its own
// axis and not along the nose, and the nose turns no more than the rest gate's
// residual — the arrows stopped pitching and yawing (sage round 2 asked for
// both halves on every arrow, and for ↓'s strafe at all).
const ARROWS = [
	["ArrowRight", "→ strafes to starboard", (p) => p.across],
	["ArrowLeft", "← strafes to port", (p) => -p.across],
	["ArrowUp", "↑ strafes up", (p) => p.vertical],
	["ArrowDown", "↓ strafes down", (p) => -p.vertical],
];
for (const [key, name, gained] of ARROWS) {
	const p = await pushedWhileHolding(key);
	check(
		`${name}, and does not turn the nose`,
		gained(p) > 10 * floor &&
			Math.abs(p.along) < gained(p) / 4 &&
			p.turnedDeg < 1,
		`${fmt(p)}; nose turned ${p.turnedDeg.toFixed(2)}°`,
	);
}

// ---------------------------------------------------------------------------
// Assist off: Shift and Ctrl are forces, held, and the lever stays put.
// ---------------------------------------------------------------------------
await page.keyboard.press("x");
await settle();
const off = await read();
check("x turns the assist off", off.assist === false, `assist ${off.assist}`);
const lever = off.throttle;
const fore = await pushedWhileHolding("Shift");
check(
	"assist off, held Shift fires the main drive: the ship gains speed along the nose",
	fore.along > 10 * floor,
	fmt(fore),
);
check(
	"and the speed lever did not move",
	fore.after.throttle === lever,
	`lever ${lever} -> ${fore.after.throttle}`,
);
const coast = await pushedWhileHolding(null);
check(
	"released, the drive stops: the ship coasts rather than accelerating",
	Math.abs(coast.along) < fore.along / 10,
	fmt(coast),
);
const aft = await pushedWhileHolding("Control");
check(
	"held Ctrl fires the retro vents: the ship loses speed along the nose",
	aft.along < -10 * floor,
	fmt(aft),
);

// ---------------------------------------------------------------------------
// A vent slot's command: nothing until bound, then a push and a turn at once.
// ---------------------------------------------------------------------------
const VENT = "vent.forePortLateral";
const KEY = "8";
const turnRate = (p) =>
	Math.hypot(p.after.rates.pitch, p.after.rates.yaw, p.after.rates.roll);
// **The push is small, and it is read against the null arm rather than the
// floor.** An attitude vent is sized to turn the hull at #5's figures, not to
// move it, so its push over one hold is metres per second — about a fiftieth
// of the strafe's on the courier. The floor above is sized for the strafe;
// both vent arms owe the measured null instead, and a millimetre per second
// beneath it — so the unbound arm's push half can go red too (sage round 1).
const pushFloor = Math.max(0.001, 10 * Math.abs(still.across));
const unbound = await pushedWhileHolding(KEY);
check(
	`\`${KEY}\` fires nothing before ${VENT} is bound to it`,
	Math.abs(unbound.across) < pushFloor && turnRate(unbound) < 0.01,
	`${fmt(unbound)} against ${pushFloor.toFixed(3)}; rate ${turnRate(unbound).toFixed(4)} rad/s`,
);

// **Bound the way a player binds it** (sage round 1): the Controls tab's own
// row, the capture modal listening on the placeholder, the key pressed into
// it, and the modal's confirm. `rebindCommand` would prove the registry and
// not the screen, and a screen that cannot capture onto an unbound row is a
// vent no player can reach.
const shown = (selector) =>
	page.evaluate(
		(sel) => document.querySelector(sel)?.checkVisibility() === true,
		selector,
	);
const clickIfShown = async (selector) => {
	if (!(await shown(selector))) return false;
	await page.click(selector);
	await settle();
	return true;
};
await page.keyboard.press("?");
await settle();
const rowLabel = await page.evaluate(
	(id) =>
		document
			.querySelector(`[data-live-controls-row="${id}"] .lc-controls-keys`)
			?.textContent?.trim() ?? null,
	VENT,
);
check(
	"the Controls tab draws the vent's row as unbound",
	rowLabel === "unbound",
	`row reads ${JSON.stringify(rowLabel)}`,
);
const opened = await clickIfShown(`[data-live-controls-row="${VENT}"]`);
check(
	"selecting the row opens the capture modal on it",
	opened && (await shown("[data-capture-modal]")),
	opened ? "modal drawn" : "no row to select",
);
await page.keyboard.press(KEY);
await settle();
const caught = await page.evaluate(
	() =>
		document
			.querySelector("[data-capture-modal] .capture-caught")
			?.textContent?.replace(/\s+/g, " ")
			.trim() ?? "",
);
const confirmed = await clickIfShown("[data-capture-confirm]");
const boundNow = await page.evaluate(
	([id, key]) =>
		window.__seelite
			.layoutInForce()
			.some(
				(b) =>
					b.command === id &&
					b.trigger.kind === "key" &&
					b.trigger.key === key &&
					b.trigger.hold === true,
			),
	[VENT, KEY],
);
check(
	`the modal catches \`${KEY}\` as a held key and binds ${VENT} to it`,
	confirmed && boundNow,
	`caught "${caught}"; confirmed ${confirmed}; in the layout ${boundNow}`,
);
// The tab closes the way it opened, and the head comes back forward, so the
// next arm flies rather than reads a console.
await page.keyboard.press("?");
await page.keyboard.press("2");
await settle();
const vent = await pushedWhileHolding(KEY);
check(
	"held, the one vent pushes the hull sideways and turns it — a lone vent does both (§3.2)",
	Math.abs(vent.across) > pushFloor && turnRate(vent) > 0.01,
	`${fmt(vent)} against ${pushFloor.toFixed(3)}; rate ${turnRate(vent).toFixed(4)} rad/s`,
);

// Back to the boot's state, so nothing here leaks into a rerun of the page.
await page.keyboard.press("x");
check(
	"and the rest gate settled every arm rather than running out of patience",
	restFailed() === false && coastFailed === false,
	`atRest exhausted: ${restFailed()}; the velocity never settled: ${coastFailed}`,
);

await browser.close();
exit();
