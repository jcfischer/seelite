/**
 * The mouse sensitivity row turns the nose further per pixel (node #640).
 *
 * `tests/pointer.test.ts` holds the arithmetic — linear, no deadzone, no curve,
 * the guard in radians, the turn per pixel at each end of the range — and
 * `tests/settings.test.ts` the row's storage. Neither can see the settings
 * screen change the value the frame flies, so this drives the row the way a
 * player does and reads the ship:
 *
 * - the row reads 100% on a fresh boot, and the game flies that;
 * - the same slow, real mouse movement, with the assist off so nothing damps
 *   it, turns the nose twice as fast after the row is stepped to 200%;
 * - the flick readout's asked turn per pixel doubles with it;
 * - the choice survives a reload, because it is saved with the other settings.
 *
 * The lock is taken by a real click on the glass, paced as
 * `probe-pointer-lock.mjs` paces it and launched the way that probe launches,
 * because without a held lock every delta is dropped and both arms read zero.
 */
// A default-layout probe (#381 D11): `z` opens the settings screen and `x`
// toggles the assist, as the shipped layout binds them.
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	PROBE_WINDOW_LOCKABLE,
	tally,
	waitForSettingsPanel,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

const W = 1280;
const H = 760;

const browser = await launchChromium({
	channel: "chromium",
	probeWindow: PROBE_WINDOW_LOCKABLE,
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
await bootedGame(page);

/** Two frames: what a key or a move asked for has been flown. */
const settle = () =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

const sensitivity = () =>
	page.evaluate(() => window.__seelite.settings.value.mouseSensitivity);

/** The settings row for mouse sensitivity, as drawn. */
const row = () =>
	page.evaluate(() => {
		const el = [...document.querySelectorAll("#seelite-settings .row")].find(
			(r) =>
				r.querySelector(".name")?.textContent?.trim() === "Mouse sensitivity",
		);
		return {
			value: el?.querySelector(".value")?.textContent?.trim() ?? null,
			selected: el?.getAttribute("aria-selected") ?? null,
		};
	});

/** A real click on the glass, after the wait `probe-pointer-lock.mjs`
 *  measured the browser's lock limiter needs. Answers whether it locked. */
async function lockGlass() {
	await page.waitForTimeout(3000);
	await page.bringToFront();
	await page.waitForFunction(() => document.hasFocus());
	const at = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		return {
			x: Math.round(r.left + r.width * 0.03),
			y: Math.round(r.top + r.height * 0.5),
		};
	});
	await page.mouse.click(at.x, at.y);
	await settle();
	return page.evaluate(
		() => document.pointerLockElement === window.__seelite.renderer.domElement,
	);
}

/** The same slow sideways movement every time: twelve 5 px steps, one a frame
 *  pair, slow enough that no hull's couple clips it at 200% (the courier's
 *  pays every pixel up to about 680 px/s there). From a still nose with the
 *  assist off, so the yaw rate it leaves is the whole of what it asked. */
const STEPS = 12;
const STEP_PX = 5;
async function sweep() {
	await page.evaluate(() => {
		window.__seelite.rates = { pitch: 0, yaw: 0, roll: 0 };
	});
	await settle();
	const start = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	// Getting the pointer to the start is a movement too, and a long one;
	// let its flick close before the one being measured begins.
	await page.mouse.move(start.x, start.y);
	await page.waitForTimeout(400);
	await page.evaluate(() => {
		window.__seelite.rates = { pitch: 0, yaw: 0, roll: 0 };
	});
	for (let i = 1; i <= STEPS; i++) {
		await page.mouse.move(start.x + i * STEP_PX, start.y);
		await settle();
	}
	// The flick closes after 0.15 s of quiet.
	await page.waitForTimeout(400);
	return page.evaluate(() => {
		const g = window.__seelite;
		return {
			yaw: g.rates.yaw,
			assist: g.assist,
			readout: g.pointerReadout,
		};
	});
}

const fmt = (s) =>
	`yaw ${s.yaw.toFixed(4)} rad/s; asked ${s.readout.lastFlick?.askedRadS ?? "none"} rad/s; row ${s.readout.mouseSensitivity}`;

// ---------------------------------------------------------------------------
// The default, as drawn and as flown.
// ---------------------------------------------------------------------------
const mounted = await waitForSettingsPanel(page);
check(
	"the settings screen has mounted, and a fresh boot flies 100%",
	mounted && (await sensitivity()) === 1,
	`mounted ${mounted}; sensitivity ${await sensitivity()}`,
);
if (!mounted) {
	await browser.close();
	exit();
}
await page.keyboard.press("z");
await settle();
// The row is the last of the settings and the layout row follows it, so ↑
// from the first row wraps onto the layout row and ↑ again lands here.
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
await settle();
const before = await row();
check(
	"the Mouse sensitivity row is on the screen, reads 100% and takes the cursor",
	before.value?.includes("100%") === true && before.selected === "true",
	JSON.stringify(before),
);
await page.keyboard.press("Escape");
await settle();

const lockedA = await lockGlass();
check(
	"a click on the glass takes the lock, so the sweeps below can move the nose",
	lockedA,
	`locked ${lockedA}`,
);
await page.keyboard.press("x");
await settle();
const atDefault = await sweep();
check(
	"assist off, the slow movement turns the nose at 100%",
	atDefault.assist === false && atDefault.yaw < -0.02,
	fmt(atDefault),
);

// ---------------------------------------------------------------------------
// Stepped to 200% on the screen, as a player steps it.
// ---------------------------------------------------------------------------
await page.keyboard.press("z");
await settle();
// The cursor is where it was left.
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await settle();
const after = await row();
check(
	"→ twice steps the row to 200%, and the store holds 2",
	after.value?.includes("200%") === true && (await sensitivity()) === 2,
	`${JSON.stringify(after)}; sensitivity ${await sensitivity()}`,
);
await page.keyboard.press("Escape");
await settle();

const lockedB = await lockGlass();
check("the glass takes the lock again", lockedB, `locked ${lockedB}`);
const atDouble = await sweep();
const rateRatio = atDouble.yaw / atDefault.yaw;
check(
	"the same movement turns the nose twice as fast at 200% — linear, so exactly the ratio of the rows",
	atDouble.assist === false && Math.abs(rateRatio - 2) < 0.2,
	`ratio ${rateRatio.toFixed(3)}; 100%: ${fmt(atDefault)}; 200%: ${fmt(atDouble)}`,
);
const askedDefault = atDefault.readout.lastFlick?.askedRadS ?? 0;
const askedDouble = atDouble.readout.lastFlick?.askedRadS ?? 0;
const askedRatio = askedDouble / askedDefault;
check(
	"and the flick readout's asked turn doubles with it",
	askedDefault > 0 &&
		Math.abs(askedRatio - 2) < 0.2 &&
		atDouble.readout.mouseSensitivity === 2,
	`asked ${askedDefault} -> ${askedDouble} rad/s (ratio ${askedRatio.toFixed(3)})`,
);
await page.keyboard.press("x");
await settle();

// ---------------------------------------------------------------------------
// Saved with the other settings.
// ---------------------------------------------------------------------------
await page.reload({ waitUntil: "load" });
await bootedGame(page);
check(
	"after a reload the row is still 200%",
	(await sensitivity()) === 2,
	`sensitivity ${await sensitivity()}`,
);

// Back to the boot's state, so nothing here leaks into a rerun.
await page.evaluate(() => window.__seelite.settings.set("mouseSensitivity", 1));
await browser.close();
exit();
