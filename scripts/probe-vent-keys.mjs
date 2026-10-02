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
import { flightHarness, HOLD_MS } from "./lib/flight-harness.mjs";
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

const { settle, atRest, turnedWhileHolding, restFailed } = flightHarness(page);

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
const right = await pushedWhileHolding("ArrowRight");
check(
	"→ strafes to starboard: the velocity grows across the nose, not along it",
	right.across > 10 * floor && Math.abs(right.along) < right.across / 4,
	fmt(right),
);
const left = await pushedWhileHolding("ArrowLeft");
check(
	"← strafes to port",
	left.across < -10 * floor && Math.abs(left.along) < -left.across / 4,
	fmt(left),
);
const upward = await pushedWhileHolding("ArrowUp");
check(
	"↑ strafes up",
	upward.vertical > 10 * floor && Math.abs(upward.along) < upward.vertical / 4,
	fmt(upward),
);
const turnedOnArrow = await turnedWhileHolding("ArrowDown");
check(
	"↓ turns the nose no more than the rest gate's residual: the arrows stopped pitching",
	turnedOnArrow < 1,
	`held ${turnedOnArrow.toFixed(2)}°`,
);

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
const unbound = await pushedWhileHolding(KEY);
const unboundTurn = Math.hypot(
	unbound.after.rates.pitch,
	unbound.after.rates.yaw,
	unbound.after.rates.roll,
);
check(
	`\`${KEY}\` fires nothing before ${VENT} is bound to it`,
	Math.abs(unbound.across) < 10 * floor && unboundTurn < 0.01,
	`${fmt(unbound)}; rate ${unboundTurn.toFixed(4)} rad/s`,
);
const bound = await page.evaluate(
	([id, key]) => {
		try {
			window.__seelite.rebindCommand(
				id,
				{ kind: "unbound", hold: true },
				{ kind: "key", key, hold: true },
			);
			return "accepted";
		} catch (e) {
			return `refused: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
	[VENT, KEY],
);
check(`${VENT} binds onto \`${KEY}\``, bound === "accepted", bound);
const vent = await pushedWhileHolding(KEY);
const ventTurn = Math.hypot(
	vent.after.rates.pitch,
	vent.after.rates.yaw,
	vent.after.rates.roll,
);
// **The push is small, and it is read against the null arm rather than the
// floor.** An attitude vent is sized to turn the hull at #5's figures, not to
// move it, so its push over one hold is metres per second — about a fiftieth
// of the strafe's on the courier. The floor above is sized for the strafe;
// this arm owes the measured null instead, and a millimetre per second
// beneath it.
const pushFloor = Math.max(0.001, 10 * Math.abs(still.across));
check(
	"held, the one vent pushes the hull sideways and turns it — a lone vent does both (§3.2)",
	Math.abs(vent.across) > pushFloor && ventTurn > 0.01,
	`${fmt(vent)} against ${pushFloor.toFixed(3)}; rate ${ventTurn.toFixed(4)} rad/s`,
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
