/**
 * The mouse-flight layout, selected on the settings screen, flies the hull
 * (#639).
 *
 * `tests/mouse-flight-layout.test.ts` holds the table, the store and the note;
 * none of them can see the settings row change the layout in force, or
 * `main.ts` hand the keys to the sim. So the layout is selected the way a
 * player selects it — the settings screen's last row, stepped — and every arm
 * after that reads the ship itself, as `probe-vent-keys.mjs` does for the
 * default layout:
 *
 * - `a`/`d` strafe and `Ctrl`/`Space` lift and drop the ship, and none of them
 *   turns the nose;
 * - the arrows turn the nose, which is pitch and yaw;
 * - with the assist off, `w` fires the main drive and `s` the retro vents only
 *   while held, and neither moves the speed lever;
 * - `w`, `d` and `Ctrl` held together push along all three axes at once,
 *   which is what the layout is for;
 * - the selection survives a reload, because it is stored with the moves.
 */
// A default-layout probe (#381 D11) until the settings row selects mouse
// flight — `z` opens the screen as the shipped layout binds it — and from then
// on it presses keys by name as the mouse-flight layout binds them.
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
	waitForSettingsPanel,
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

const base = () => page.evaluate(() => window.__seelite.layoutInForce().base);

// ---------------------------------------------------------------------------
// Selected on the settings screen, as a player selects it.
// ---------------------------------------------------------------------------
const mounted = await waitForSettingsPanel(page);
check(
	"the boot flies the default layout, and the settings screen has mounted",
	mounted && (await base()) === "default",
	`mounted ${mounted}; layout ${await base()}`,
);
if (mounted) {
	await page.keyboard.press("z");
	await settle();
	// The layout row is the last; ↑ from the first row wraps onto it.
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowRight");
	await settle();
}
const row = await page.evaluate(() => {
	const el = document.querySelector("[data-settings-layout]");
	return {
		value: el?.querySelector(".value")?.textContent?.trim() ?? null,
		selected: el?.getAttribute("aria-selected") ?? null,
		note: el?.nextElementSibling?.textContent?.trim() ?? null,
	};
});
check(
	"the settings screen's layout row steps onto Mouse flight",
	row.selected === "true" &&
		row.value?.includes("Mouse flight") === true &&
		(await base()) === "mouse-flight",
	`row ${JSON.stringify(row)}; layout ${await base()}`,
);
await page.keyboard.press("Escape");
await settle();

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
			throttle: g.throttle,
			assist: g.assist,
		};
	});

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

let coastFailed = false;

/** Wait until the velocity stops changing — `probe-vent-keys.mjs`'s reason:
 *  a released strafe is a drift the assist is still burning off, and without
 *  this an arm reads the arm before it. */
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

/** Hold `keys` together (or nothing) for `HOLD_MS`, and say how the velocity
 *  changed along the hull's axes as they stood when the hold began, km/s. */
async function pushedWhileHolding(...keys) {
	await atRest();
	await coasting();
	const before = await read();
	for (const key of keys) await page.keyboard.down(key);
	await page.waitForTimeout(HOLD_MS);
	for (const key of [...keys].reverse()) await page.keyboard.up(key);
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
await pushedWhileHolding();
const still = await pushedWhileHolding();
const floor = Math.max(
	0.02,
	Math.abs(still.along),
	Math.abs(still.across),
	Math.abs(still.vertical),
);
check(
	"assist on, and nothing held moves the ship (the floor the arms are read against)",
	still.before.assist === true &&
		Math.abs(still.across) < 0.05 &&
		Math.abs(still.vertical) < 0.05,
	`${fmt(still)}; floor ${floor.toFixed(3)} km/s`,
);

// ---------------------------------------------------------------------------
// The left hand strafes.
// ---------------------------------------------------------------------------
const STRAFES = [
	["d", "d strafes to starboard", (p) => p.across],
	["a", "a strafes to port", (p) => -p.across],
	["Control", "Ctrl strafes up", (p) => p.vertical],
	["Space", "Space strafes down", (p) => -p.vertical],
];
for (const [key, name, gained] of STRAFES) {
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
// The arrows turn the nose.
// ---------------------------------------------------------------------------
for (const key of ["ArrowUp", "ArrowLeft"]) {
	const p = await pushedWhileHolding(key);
	check(
		`${key} turns the nose, as pitch and yaw`,
		p.turnedDeg > 2,
		`nose turned ${p.turnedDeg.toFixed(2)}°`,
	);
}

// ---------------------------------------------------------------------------
// Assist off: w and s are forces, held, and the lever stays put.
// ---------------------------------------------------------------------------
// **At rest before the assist goes off.** The yaw arm above ends with the
// nose still turning, and with the assist off nothing damps it: the first run
// carried that turn through every later arm, read a lone `w` as pushing
// 0.14 km/s sideways and the burn as turning the nose 20°, and exhausted the
// rest gate.
await atRest();
await page.keyboard.press("x");
await settle();
const off = await read();
check("x turns the assist off", off.assist === false, `assist ${off.assist}`);
const lever = off.throttle;
const fore = await pushedWhileHolding("w");
check(
	"assist off, held w fires the main drive: the ship gains speed along the nose",
	fore.along > 10 * floor,
	fmt(fore),
);
check(
	"and the speed lever did not move",
	fore.after.throttle === lever,
	`lever ${lever} -> ${fore.after.throttle}`,
);
const aft = await pushedWhileHolding("s");
check(
	"held s fires the retro vents: the ship loses speed along the nose",
	aft.along < -10 * floor,
	fmt(aft),
);

// ---------------------------------------------------------------------------
// The three-axis burn: all three translations held at once.
// ---------------------------------------------------------------------------
// **What this cannot see:** Chrome's reserved Ctrl+W, which closes the tab on
// Windows and Linux before any page handler runs. Playwright's keys do not
// reach the browser's own shortcuts, and this lane runs on macOS, where the
// chord is not Chrome's. The settings row's warning is the answer to that
// platform, and `tests/mouse-flight-layout.test.ts` holds it (sage round 1).
//
// Ctrl first, as a pilot climbing presses it: `w` and `d` pressed under it are
// held and run no command (`key-dispatch.ts`), which is the rule this burn
// rests on.
const burn = await pushedWhileHolding("Control", "w", "d");
check(
	"Ctrl, w and d held together push up, forward and to starboard at once",
	burn.vertical > 10 * floor &&
		burn.along > 10 * floor &&
		burn.across > 10 * floor &&
		burn.turnedDeg < 1,
	`${fmt(burn)}; nose turned ${burn.turnedDeg.toFixed(2)}°`,
);
await page.keyboard.press("x");
await settle();

// ---------------------------------------------------------------------------
// The selection is stored with the moves, and survives a reload.
// ---------------------------------------------------------------------------
await page.reload({ waitUntil: "load" });
await bootedGame(page);
check(
	"after a reload the mouse-flight layout is still in force",
	(await base()) === "mouse-flight",
	`layout ${await base()}`,
);

// Back to the boot's state, so nothing here leaks into a rerun of the page.
await page.evaluate(() => window.__seelite.selectLayout("default"));
check(
	"and the rest gate settled every arm rather than running out of patience",
	restFailed() === false && coastFailed === false,
	`atRest exhausted: ${restFailed()}; the velocity never settled: ${coastFailed}`,
);

await browser.close();
exit();
