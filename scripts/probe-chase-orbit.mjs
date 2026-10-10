/**
 * The chase camera's full mouse orbit, and the postcard that carries it
 * (node #691), read off a running page.
 *
 *   npm run probe:one probe-chase-orbit
 *
 * `tests/chase-orbit.test.ts` holds the rig's arithmetic and
 * `tests/postcard.test.ts` the recipe's. What only a browser can say is here:
 *
 * - **in Photo mode the pointer orbits, and only orbits** (C1, C2): a real
 *   mouse move under a real pointer lock swings the chase camera round and
 *   over the hull, the ship's attitude, rates and trigger untouched, the hull
 *   holding its place in the drawn frame. Outside Photo mode the same move
 *   steers in both views. An engaged docking computer orbited under is still
 *   engaged once Photo mode is left and the sim runs again. Neither reading
 *   detects a routing leak — frozen, `step` does not run to cancel it, and the
 *   toggle drains the pointer before it resumes — so the routing is
 *   `pointerOwner`'s headless rows. The control is the cockpit, where the same
 *   move steers and cancels it;
 * - **the pointer's owners** (C2): the cockpit gets its controls back and the
 *   chase pose is held across the toggle; a lost lock moves nothing until the
 *   next click takes it back; the settings screen and the Postcard screen take
 *   the pointer with them. The consoles and the Galaxy Map are cockpit walls,
 *   so in chase they never hold it; `probe-pointer-lock.mjs` owns their rows,
 *   and the orbit is dropped behind them by the same `contextFliesShip`;
 *   and docked, Photo mode's mouse still orbits, because the frame loop spends
 *   the delta whatever the dock phase (sage round 2 found it dead there). The
 *   ship staying docked is the freeze's doing, not the routing's;
 * - **a focused Photo button keeps its own keys** (C2, sage round 6): docked,
 *   `Space` on Exit Photo mode leaves it and `Enter` on Photo mode enters it,
 *   the ship still docked — before the fix `onKey` ate `Space` and ran
 *   `Enter` as `dock.launch`, and both rows read red with the listener off;
 * - **the postcard carries the pose** (C3): an exterior card opened from an
 *   orbited view spells its yaw and elevation, its PNG is the card shown, the
 *   viewer rebuilds the same link and the same picture, the pilot's pose and
 *   drawing size survive every capture — the failing one included — and a
 *   yaw-only schema-1 link still opens, level;
 * - `2` recentres the whole pose.
 *
 * **The lane.** It needs a view that can hold a pointer lock, so it launches
 * the way `probe-pointer-lock.mjs` does and for that file's reasons
 * (`PROBE_WINDOW_LOCKABLE`, #454). That lane renders on the hardware renderer;
 * the pixel rows here compare two cards drawn by the same browser, never a
 * card against a stored baseline.
 *
 * **The sheet** (C4): every pose's live frame, exterior card and rebuilt card
 * are written under `probe-shots/chase-orbit/`, with `index.html` beside them.
 * The probe cannot say they look right; the principal does.
 *
 * A default-layout probe (#381 D11): `v`, `2`, `6` and `z` are the shipped keys.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	PROBE_WINDOW_LOCKABLE,
	tally,
	waitForSettingsPanel,
} from "./probe-guard.mjs";
import { gameUrl, postcardUrl } from "./lib/game-url.mjs";
import { installViewFraming, setView } from "./lib/view-placement.mjs";
import {
	PANEL_CARD,
	VIEWER_CARD,
	cardPixels,
	changedCells,
	keepCard,
	setPostcardMode,
	waitViewerCard,
} from "./lib/postcard-shots.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();
const SHOTS = "probe-shots/chase-orbit";
mkdirSync(SHOTS, { recursive: true });
const VIEWPORT = { width: 1280, height: 760 };

const browser = await launchChromium({
	channel: "chromium",
	probeWindow: PROBE_WINDOW_LOCKABLE,
});
const context = await browser.newContext({
	viewport: VIEWPORT,
	acceptDownloads: true,
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
	origin: new URL(origin).origin,
});
const page = await context.newPage();
watch(page);
// `__parkInBerth`, for the docked row at the end.
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: 42, raider: "off" }), {
	waitUntil: "load",
});
await bootedGame(page);

/** Two frames, so what is read was drawn after the last write. */
const settle = (target = page) =>
	target.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

const lockHolder = () =>
	page.evaluate(() => document.pointerLockElement?.tagName ?? null);

/** The pilot's state an orbit must and must not move, read in one go. */
const pilot = () =>
	page.evaluate(() => {
		const g = window.__seelite;
		const ship = g.nearScene.getObjectByName("ship");
		// Where the drawn hull sits in the drawn camera's frame, as a direction:
		// constant from every pose when position and orientation agree.
		const inCam = ship.position
			.clone()
			.applyQuaternion(g.nearCamera.quaternion.clone().invert())
			.normalize();
		return {
			view: g.view,
			photo: g.photoMode,
			time: g.world.gameTime,
			pos: { ...g.world.ship.pos },
			zoom: g.chaseOrbit.zoomScale ?? 1,
			distanceKm: ship.position.length(),
			yaw: g.chaseYaw,
			elev: g.chaseElevation,
			q: g.orientation.toArray(),
			rates: { ...g.rates },
			mouseFiring: g.mouseFiring,
			trigger: g.triggerHeld(),
			computer: g.dockingComputer.engaged,
			hullInCamera: inCam.toArray(),
			drawing: [g.renderer.domElement.width, g.renderer.domElement.height],
		};
	});

const angle = (a, b) => {
	const dot = a.reduce((s, x, i) => s + x * b[i], 0);
	return Math.acos(Math.min(1, Math.abs(dot)));
};
const zeroRates = () =>
	page.evaluate(() => {
		window.__seelite.rates = { pitch: 0, yaw: 0, roll: 0 };
	});

/** Where the cursor is: locked moves are deltas between absolute positions,
 *  so every move starts from the last one rather than from somewhere new. */
let cursor = null;
const clickGlass = async () => {
	// The browser's lock window, which `probe-pointer-lock.mjs` measured: wait
	// it out before the one click, rather than retrying after a refusal.
	await page.waitForTimeout(3000);
	await page.bringToFront();
	await page.waitForFunction(() => document.hasFocus());
	cursor = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		return {
			x: Math.round(r.left + r.width * 0.5),
			y: Math.round(r.top + r.height * 0.5),
		};
	});
	await page.mouse.click(cursor.x, cursor.y);
	await settle();
};
/** A real mouse move of `steps` steps of (`dx`, `dy`) pixels. */
const moveMouse = async (dx, dy, steps = 8) => {
	for (let i = 0; i < steps; i++) {
		cursor = { x: cursor.x + dx, y: cursor.y + dy };
		await page.mouse.move(cursor.x, cursor.y);
	}
	await settle();
};

// ---------------------------------------------------------------------------
// Into chase, with the glass locked: the premise every orbit row stands on.
// ---------------------------------------------------------------------------
await page.evaluate(async () => {
	const g = window.__seelite;
	g.resetFlightToStart();
	g.faceTarget();
	await new Promise((r) => requestAnimationFrame(() => r()));
});
await page.keyboard.press("F2");
await settle();
await clickGlass();
const premise = { view: (await pilot()).view, lock: await lockHolder() };
check(
	"in chase with the glass locked, so the pointer rows below can see anything",
	premise.view === "chase" && premise.lock === "CANVAS",
	JSON.stringify(premise),
);
const frozenStart = await pilot();
await page.mouse.down();
await page.waitForTimeout(200);
const heldClick = await pilot();
check(
	"a held mouse click in Photo mode never fires and the simulation is frozen",
	heldClick.photo &&
		!heldClick.mouseFiring &&
		!heldClick.trigger &&
		heldClick.time === frozenStart.time &&
		JSON.stringify(heldClick.pos) === JSON.stringify(frozenStart.pos),
	JSON.stringify(heldClick),
);
await page.mouse.up();
await page.mouse.wheel(0, -120);
await settle();
const zoomed = await pilot();
check(
	"scroll up zooms the Photo camera closer without moving its angles or the ship",
	zoomed.zoom < frozenStart.zoom &&
		Math.abs(
			zoomed.distanceKm / frozenStart.distanceKm -
				zoomed.zoom / frozenStart.zoom,
		) < 1e-5 &&
		zoomed.yaw === frozenStart.yaw &&
		zoomed.elev === frozenStart.elev &&
		zoomed.time === frozenStart.time,
	`zoom ${frozenStart.zoom} → ${zoomed.zoom}`,
);
await page.mouse.wheel(0, 120);
await settle();
check(
	"scroll down returns to the original distance",
	Math.abs((await pilot()).zoom - frozenStart.zoom) < 1e-12,
);
await page.keyboard.press("2");
await settle();
if (premise.lock !== "CANVAS") {
	await browser.close();
	exit();
}
const radPerPx = await page.evaluate(
	async () => (await import("/src/chase-orbit.ts")).ORBIT_RAD_PER_PX,
);

// ---------------------------------------------------------------------------
// C1, C2: the pointer orbits the camera and nothing else.
// ---------------------------------------------------------------------------
await zeroRates();
await settle();
const astern = await pilot();
await moveMouse(26, -9);
const orbited = await pilot();
{
	// 208 px right and 72 px up: the camera swings to port and rises.
	const wantYaw = -208 * radPerPx;
	const wantElev = 72 * radPerPx;
	check(
		"a real push right and up swings the chase camera to port and over the hull",
		Math.abs(orbited.yaw - wantYaw) < 0.15 * Math.abs(wantYaw) &&
			Math.abs(orbited.elev - wantElev) < 0.15 * wantElev,
		`yaw ${orbited.yaw.toFixed(4)} (want ${wantYaw.toFixed(4)}), elevation ${orbited.elev.toFixed(4)} (want ${wantElev.toFixed(4)})`,
	);
}
check(
	"the orbit leaves the ship's attitude, its rates and its trigger alone",
	angle(astern.q, orbited.q) < 1e-9 &&
		orbited.rates.pitch === 0 &&
		orbited.rates.yaw === 0 &&
		orbited.rates.roll === 0 &&
		!orbited.mouseFiring &&
		!orbited.trigger,
	`attitude moved ${angle(astern.q, orbited.q).toExponential(2)} rad; rates ${JSON.stringify(orbited.rates)}; firing ${orbited.mouseFiring}/${orbited.trigger}`,
);
check(
	"the drawn hull holds its place in the drawn frame: position and orientation agree",
	angle(astern.hullInCamera, orbited.hullInCamera) < 1e-4,
	`${angle(astern.hullInCamera, orbited.hullInCamera).toExponential(2)} rad between astern and orbited`,
);

// The docking computer: engaged, then orbited under. Photo mode holds the
// world, so this row cannot see a leak — `step` never runs to cancel
// anything. The routing is held headlessly by `pointerOwner`'s rows; the
// cockpit arm below is the control.
await page.evaluate(async () => {
	const { migrateEquipment, equipmentNames } = await import("/src/loadout.ts");

	const g = window.__seelite;
	if (!g.hasDockingComputer)
		g.commander = {
			...g.commander,
			loadout: migrateEquipment(g.commander.hull, [
				...equipmentNames(g.commander.loadout ?? {}),
				g.dockingComputerName,
			]).loadout,
		};
	if (!g.dockingComputer.engaged) g.toggleDockingComputer();
});
await settle();
const engaged = await pilot();
await moveMouse(-20, 6);
const underComputer = await pilot();
check(
	"orbiting under an engaged docking computer leaves it engaged",
	engaged.computer &&
		underComputer.computer &&
		Math.abs(underComputer.yaw - engaged.yaw) > 0.3,
	`engaged ${engaged.computer} → ${underComputer.computer}; yaw ${engaged.yaw.toFixed(3)} → ${underComputer.yaw.toFixed(3)}`,
);

// Back to the cockpit: the pointer steers again, and the chase pose is held.
await page.keyboard.press("v");
await settle();
await zeroRates();
const cockpitBefore = await pilot();
await page.waitForTimeout(200);
const resumed = await pilot();
check(
	"leaving Photo mode resumes the simulation",
	!cockpitBefore.photo && resumed.time > cockpitBefore.time,
);
// The orbit row under the computer cannot fail: `step` does not run in Photo
// mode, so nothing there can disengage it. This one runs the sim, and proves
// only that leaving Photo mode does not: `togglePhotoMode` drains any delta
// left in the pointer before the world resumes, so a delta the orbit banked
// is dropped at the toggle and is not what this row tests.
check(
	"the computer is still engaged once the simulation runs again",
	cockpitBefore.computer && resumed.computer,
	`engaged ${cockpitBefore.computer} → ${resumed.computer}`,
);
await moveMouse(14, 5);
const cockpitAfter = await pilot();
check(
	"in the cockpit the same move steers the ship and leaves the chase pose held",
	cockpitAfter.view === "cockpit" &&
		Math.abs(cockpitAfter.rates.yaw) > 1e-4 &&
		cockpitAfter.yaw === underComputer.yaw &&
		cockpitAfter.elev === underComputer.elev,
	`rates ${JSON.stringify(cockpitAfter.rates)}; pose ${cockpitAfter.yaw.toFixed(3)}, ${cockpitAfter.elev.toFixed(3)}`,
);
check(
	"control: there the move is control input, and cancels the computer",
	cockpitBefore.computer && !cockpitAfter.computer,
	`engaged ${cockpitBefore.computer} → ${cockpitAfter.computer}`,
);
await page.keyboard.press("v");
await settle();
await zeroRates();
const back = await pilot();
check(
	"returning to chase finds the pose it left",
	back.view === "chase" &&
		back.yaw === underComputer.yaw &&
		back.elev === underComputer.elev,
	`${back.yaw.toFixed(3)}, ${back.elev.toFixed(3)}`,
);
await zeroRates();
const ordinaryBefore = await pilot();
await moveMouse(10, -5);
const ordinaryAfter = await pilot();
check(
	"outside flight does not manipulate the camera until Photo mode is enabled",
	!ordinaryAfter.photo &&
		ordinaryAfter.yaw === ordinaryBefore.yaw &&
		ordinaryAfter.elev === ordinaryBefore.elev &&
		Math.abs(ordinaryAfter.rates.yaw) > 1e-4,
);
await page.keyboard.press("F2");
await settle();

// A lost lock moves nothing; the next click takes it back and orbits again.
await page.evaluate(() => document.exitPointerLock());
await settle();
const unlocked = await pilot();
await moveMouse(30, -10);
const movedUnlocked = await pilot();
check(
	"with the lock lost, the mouse orbits nothing",
	(await lockHolder()) === null &&
		movedUnlocked.yaw === unlocked.yaw &&
		movedUnlocked.elev === unlocked.elev,
	`lock ${await lockHolder()}; yaw ${unlocked.yaw.toFixed(3)} → ${movedUnlocked.yaw.toFixed(3)}`,
);
await clickGlass();
const relocked = await pilot();
await moveMouse(-12, -4);
const movedRelocked = await pilot();
check(
	"the next click takes the lock back, and the mouse orbits again",
	(await lockHolder()) === "CANVAS" &&
		Math.abs(movedRelocked.yaw - relocked.yaw) > 0.1,
	`lock ${await lockHolder()}; yaw ${relocked.yaw.toFixed(3)} → ${movedRelocked.yaw.toFixed(3)}`,
);

// A screen takes the pointer with it: the settings screen.
if (!(await waitForSettingsPanel(page)))
	check("the settings screen mounted", false);
await page.keyboard.press("z");
await settle();
const inSettings = await pilot();
await moveMouse(25, 8);
const movedInSettings = await pilot();
const settingsState = await page.evaluate(() => ({
	open: window.__seelite.settingsPanel?.isOpen() ?? false,
	context: window.__seelite.padContext(),
}));
check(
	"the settings screen takes the pointer, and a move behind it orbits nothing",
	settingsState.open &&
		(await lockHolder()) === null &&
		movedInSettings.yaw === inSettings.yaw &&
		movedInSettings.elev === inSettings.elev,
	`${JSON.stringify(settingsState)}; lock ${await lockHolder()}; yaw ${inSettings.yaw.toFixed(3)} → ${movedInSettings.yaw.toFixed(3)}`,
);
await page.keyboard.press("Escape");
await settle();
const closedSettings = await pilot();
check(
	"closing it delivers no swing built up behind it",
	closedSettings.yaw === inSettings.yaw &&
		closedSettings.elev === inSettings.elev,
	`${closedSettings.yaw.toFixed(3)}, ${closedSettings.elev.toFixed(3)}`,
);

// ---------------------------------------------------------------------------
// C3: the exterior postcard carries the pose.
// ---------------------------------------------------------------------------

const pairs = (fragment) =>
	Object.fromEntries(fragment.split("&").map((p) => p.split("=")));
/** The names two fragments spell differently, for a row's detail. */
const differing = (a, b) => {
	const [pa, pb] = [pairs(a), pairs(b)];
	const names = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(
		(n) => pa[n] !== pb[n],
	);
	return names.length === 0
		? ""
		: `; differs at ${names.map((n) => `${n}: ${pa[n]} vs ${pb[n]}`).join(", ")}`;
};

/** Open the Postcard screen on this pose and read what it made. */
const openCard = async () => {
	const before = await pilot();
	await page.keyboard.press("6");
	await page.waitForFunction(
		() => window.__seelite.postcardPanel.state.fragment !== null,
		null,
		{ timeout: 30000 },
	);
	await page.waitForFunction(
		(sel) => document.querySelector(sel)?.src.startsWith("blob:"),
		PANEL_CARD,
		{ timeout: 30000 },
	);
	const state = await page.evaluate(() =>
		structuredClone(window.__seelite.postcardPanel.state),
	);
	return { before, state, after: await pilot() };
};
const closeCard = async () => {
	await page.keyboard.press("Escape");
	await settle();
	return pilot();
};

/** Open a postcard link in a fresh read-only viewer, keep its card as `shot`,
 *  and read back what it rebuilt and where its camera stands. */
const openViewer = async (fragment, label, shot) => {
	const viewer = await context.newPage();
	watch(viewer, label);
	await viewer.goto(postcardUrl(origin, fragment), { waitUntil: "load" });
	await viewer.waitForFunction(
		() =>
			window.__seelite?.postcardViewState?.card &&
			window.__seelite.postcardViewState.rebuiltFragment,
		null,
		{ timeout: 60000 },
	);
	await waitViewerCard(viewer);
	const seen = await viewer.evaluate(() => ({
		fragment: window.__seelite.postcardViewState.rebuiltFragment,
		yaw: window.__seelite.chaseYaw,
		elev: window.__seelite.chaseElevation,
		zoom: window.__seelite.chaseOrbit.zoomScale ?? 1,
		view: window.__seelite.view,
	}));
	await keepCard(viewer, VIEWER_CARD, shot);
	const grid = await cardPixels(viewer, VIEWER_CARD);
	await viewer.close();
	return { ...seen, grid };
};

/** The rows only the first, mouse-composed card runs: the pointer behind the
 *  screen, Save image, Copy postcard link, and a round trip through another
 *  composition. */
const checkFirstCardActions = async (before, state, asked) => {
	// The Postcard screen took the pointer: a move behind it orbits nothing.
	await moveMouse(22, -7);
	const behind = await pilot();
	check(
		"the Postcard screen takes the pointer, and a move behind it orbits nothing",
		(await lockHolder()) === null &&
			behind.yaw === before.yaw &&
			behind.elev === before.elev,
		`lock ${await lockHolder()}; pose ${behind.yaw}, ${behind.elev}`,
	);
	// Save image: the download is the card on the screen, byte for byte.
	await page.evaluate(() => {
		navigator.canShare = () => false;
	});
	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 20000 }),
		page.click('#seelite-postcard [data-action="save"]'),
	]);
	const file = readFileSync(await download.path());
	const shown = Buffer.from(
		await page.evaluate(async (sel) => {
			const blob = await (await fetch(document.querySelector(sel).src)).blob();
			return [...new Uint8Array(await blob.arrayBuffer())];
		}, PANEL_CARD),
	);
	const sha = (b) => createHash("sha256").update(b).digest("hex");
	check(
		"Save image exports the orbited card, byte for byte, at the canonical size",
		sha(file) === sha(shown) &&
			file.readUInt32BE(16) === 1800 &&
			file.readUInt32BE(20) === 1200,
		`${file.length} bytes, ${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`,
	);
	await page.click('#seelite-postcard [data-action="copy"]');
	await page.waitForFunction(
		() => window.__seelite.postcardPanel.state.lastCopy !== null,
	);
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	check(
		"Copy postcard link copies the link that carries the pose",
		copied === state.link && copied.endsWith(state.fragment),
		copied.slice(-60),
	);
	// Another composition and back: the exterior is the same card again.
	await setPostcardMode(page, "clear");
	await setPostcardMode(page, "exterior");
	const again = await page.evaluate(() =>
		structuredClone(window.__seelite.postcardPanel.state),
	);
	const afterModes = await pilot();
	check(
		"changing composition and back leaves the pose, and the link, as they were",
		afterModes.yaw === before.yaw &&
			afterModes.elev === before.elev &&
			pairs(again.fragment).yaw === asked.yaw &&
			pairs(again.fragment).elev === asked.elev,
		`pose ${afterModes.yaw}, ${afterModes.elev}`,
	);
};

const POSES = [
	{ label: "oblique-above", from: "mouse" },
	{ label: "below", yaw: 2.4, elev: -1.1 },
	{ label: "overhead", yaw: 0.3, elev: Math.PI / 2 },
];
const sheet = [];
let first = null;
// Keep an actual wheel-composed distance in every exterior preview/export/link.
await clickGlass();
await page.mouse.wheel(0, -120);
await settle();
for (const pose of POSES) {
	if (pose.from !== "mouse")
		await page.evaluate(
			([yaw, elev]) => {
				window.__seelite.chaseYaw = yaw;
				window.__seelite.chaseElevation = elev;
			},
			[pose.yaw, pose.elev],
		);
	await settle();
	await page.screenshot({ path: `${SHOTS}/${pose.label}-live.png` });
	const { before, state, after } = await openCard();
	const asked = pairs(state.fragment);
	check(
		`${pose.label}: the screen opens on the exterior, and its link spells the pose`,
		state.mode === "exterior" &&
			asked.postcard === "3" &&
			Math.abs(Number(asked.zoom) - before.zoom) <= 5e-7 &&
			Math.abs(Number(asked.yaw) - before.yaw) <= 5e-7 &&
			Math.abs(Number(asked.elev) - before.elev) <= 5e-7,
		`mode ${state.mode}; yaw=${asked.yaw} elev=${asked.elev} against ${before.yaw.toFixed(6)}, ${before.elev.toFixed(6)}`,
	);
	check(
		`${pose.label}: drawing the card puts the pilot's pose and drawing size back`,
		after.yaw === before.yaw &&
			after.zoom === before.zoom &&
			after.elev === before.elev &&
			after.view === "chase" &&
			after.drawing.join("x") === before.drawing.join("x"),
		`pose ${after.yaw}, ${after.elev}; drawing ${after.drawing.join("x")} against ${before.drawing.join("x")}`,
	);
	await keepCard(page, PANEL_CARD, `${SHOTS}/${pose.label}-card.png`);
	const card = await cardPixels(page, PANEL_CARD);

	if (pose.from === "mouse") {
		first = { pose: before, state, card };
		await checkFirstCardActions(before, state, asked);
	}
	const closed = await closeCard();
	check(
		`${pose.label}: closing the screen neither flattens nor recentres the orbit`,
		closed.yaw === before.yaw && closed.elev === before.elev,
		`${closed.yaw}, ${closed.elev}`,
	);

	// The link, opened: the same recipe and the same picture.
	const { grid: linked, ...rebuilt } = await openViewer(
		state.fragment,
		`viewer ${pose.label}`,
		`${SHOTS}/${pose.label}-linked.png`,
	);
	const moved = changedCells(linked, card);
	check(
		`${pose.label}: the link rebuilds the same recipe, standing at the same orbit`,
		rebuilt.fragment === state.fragment &&
			rebuilt.view === "chase" &&
			rebuilt.yaw === Number(asked.yaw) &&
			rebuilt.elev === Number(asked.elev) &&
			rebuilt.zoom === Number(asked.zoom),
		`${rebuilt.view} ${rebuilt.yaw}, ${rebuilt.elev}${differing(state.fragment, rebuilt.fragment)}`,
	);
	check(
		`${pose.label}: and draws the card that was sent`,
		linked.width === 1800 && linked.height === 1200 && moved < 0.01,
		`${(moved * 100).toFixed(1)}% of cells changed against the sender's`,
	);
	sheet.push({ ...pose, yaw: before.yaw, elev: before.elev, card });
}

// Control: the pose is in the picture — astern draws a different card.
await page.keyboard.press("2");
await settle();
const centred = await pilot();
check(
	"2 recentres the whole pose astern",
	centred.yaw === 0 && centred.elev === 0,
	`${centred.yaw}, ${centred.elev}`,
);
{
	await openCard();
	const asternCard = await cardPixels(page, PANEL_CARD);
	await keepCard(page, PANEL_CARD, `${SHOTS}/astern-card.png`);
	await closeCard();
	// Against the pose furthest from astern: the oblique one is a small
	// swing, and a small swing moves few cells by construction.
	const below = sheet.find((s) => s.label === "below").card;
	const moved = changedCells(below, asternCard);
	check(
		"control: the astern card differs from one taken from below, so the cards are measuring the pose",
		moved > 0.05,
		`${(moved * 100).toFixed(1)}% of cells changed`,
	);
}

// A link written before node #691: schema 1, yaw alone, opens level.
{
	const modern = first.state.fragment;
	const legacy = modern
		.replace(/^postcard=3&/, "postcard=1&")
		.replace(/&zoom=[^&]+$/, "")
		.replace(/&elev=[^&]+$/, "");
	const seen = await openViewer(
		legacy,
		"viewer legacy",
		`${SHOTS}/legacy-linked.png`,
	);
	check(
		"a schema-1 exterior link opens at its own level framing, spelled back as schema 2",
		seen.elev === 0 &&
			seen.yaw === Number(pairs(legacy).yaw) &&
			seen.fragment ===
				`${legacy.replace(/^postcard=1&/, "postcard=2&")}&elev=0`,
		`${seen.yaw}, ${seen.elev}; ${seen.fragment.slice(-40)}`,
	);
	// And a schema-3 exterior missing its height is refused, not read level.
	const refusedPage = await context.newPage();
	watch(refusedPage, "refused");
	await refusedPage.goto(
		postcardUrl(origin, modern.replace(/&elev=[^&]+/, "")),
		{ waitUntil: "load" },
	);
	await refusedPage.waitForSelector("body[data-postcard-refused]", {
		timeout: 20000,
	});
	const refusal = await refusedPage.evaluate(() => ({
		reason: document.body.dataset.postcardRefused,
		game: "__seelite" in window,
	}));
	await refusedPage.close();
	check(
		"a schema-3 exterior with no elevation is refused, and boots no game",
		refusal.reason === "malformed" && !refusal.game,
		JSON.stringify(refusal),
	);
}

// The capture's two exits, called directly: both put everything back.
{
	await page.evaluate(() => {
		window.__seelite.chaseYaw = -1.3;
		window.__seelite.chaseElevation = 0.45;
	});
	await settle();
	const held = await pilot();
	const outcome = await page.evaluate(() => {
		const g = window.__seelite;
		const ok = g.capturePostcardFrame(
			{ mode: "exterior", yawRad: 2, elevationRad: -0.9 },
			1800,
			1200,
		);
		const success = { width: ok.width, height: ok.height };
		g.render = () => {
			throw new Error("probe: a capture that fails");
		};
		let threw = false;
		try {
			g.capturePostcardFrame(
				{ mode: "exterior", yawRad: 1, elevationRad: 1 },
				1800,
				1200,
			);
		} catch {
			threw = true;
		} finally {
			delete g.render;
		}
		return { success, threw };
	});
	await settle();
	const restored = await pilot();
	check(
		"a capture that succeeds and one that throws both restore the pilot's pose and drawing size",
		outcome.success.width === 1800 &&
			outcome.threw &&
			restored.view === "chase" &&
			restored.yaw === held.yaw &&
			restored.elev === held.elev &&
			restored.drawing.join("x") === held.drawing.join("x"),
		`${JSON.stringify(outcome)}; pose ${restored.yaw}, ${restored.elev}; drawing ${restored.drawing.join("x")} against ${held.drawing.join("x")}`,
	);
}

// The sheet: each pose's live frame, its card, and the card its link rebuilt.
const rows = sheet
	.map(
		(
			s,
		) => `<tr><th>${s.label}<br><small>yaw ${s.yaw.toFixed(3)} · elevation ${s.elev.toFixed(3)}</small></th>
<td><img src="${s.label}-live.png"></td><td><img src="${s.label}-card.png"></td><td><img src="${s.label}-linked.png"></td></tr>`,
	)
	.join("\n");
writeFileSync(
	`${SHOTS}/index.html`,
	`<!doctype html><meta charset="utf-8"><title>Chase orbit and postcards (node #691)</title>
<style>body{background:#111;color:#ddd;font:13px ui-monospace,monospace}img{width:420px}td,th{padding:6px;vertical-align:top}</style>
<table><tr><th></th><th>live chase view</th><th>exterior card</th><th>rebuilt from its link</th></tr>
${rows}
<tr><th>astern<br><small>after 2</small></th><td></td><td><img src="astern-card.png"></td><td></td></tr>
<tr><th>schema-1 link<br><small>yaw only, level</small></th><td></td><td></td><td><img src="legacy-linked.png"></td></tr>
</table>`,
);

// ---------------------------------------------------------------------------
// Docked, the camera still answers (sage round 2). The orbit was once spent
// only in `step`'s flight tail, so docked, arriving or launching, chase
// ignored the mouse; Photo mode's orbit is spent in the frame loop. The
// docked phase holding below is the frozen world's, not evidence of routing.
// ---------------------------------------------------------------------------
// The fixture actually flies the docking computer; let it reach the berth
// before holding the resulting docked composition.
await page.evaluate(async () => {
	const g = window.__seelite;
	if (g.photoMode) g.command("view.photo");
	await window.__parkInBerth("station-trade", "overhead-near", {});
});
await setView(page, "chase");
await page.evaluate(() => {
	const g = window.__seelite;
	if (!g.photoMode) g.command("view.photo");
});
await clickGlass();
// Astern, so the pull below cannot be eaten by a pole an earlier row left.
await page.keyboard.press("2");
await settle();
const dockedBefore = await pilot();
const dockedContext = await page.evaluate(() => ({
	phase: window.__seelite.dockPhase,
	context: window.__seelite.padContext(),
}));
await moveMouse(-18, 10);
const dockedAfter = await pilot();
const dockedPhase = await page.evaluate(() => window.__seelite.dockPhase);
check(
	"docked in chase, a real mouse move orbits the camera and the ship stays docked",
	dockedContext.phase === "docked" &&
		dockedPhase === "docked" &&
		(await lockHolder()) === "CANVAS" &&
		Math.abs(dockedAfter.yaw - dockedBefore.yaw) > 0.3 &&
		Math.abs(dockedAfter.elev - dockedBefore.elev) > 0.15 &&
		// Not the attitude: a parked ship turns with the spinning station
		// every frame (§12.6 obligation 9), so only its own rates are quiet.
		dockedAfter.rates.pitch === 0 &&
		dockedAfter.rates.yaw === 0 &&
		dockedAfter.rates.roll === 0,
	`${JSON.stringify(dockedContext)} → ${dockedPhase}; lock ${await lockHolder()}; yaw ${dockedBefore.yaw.toFixed(3)} → ${dockedAfter.yaw.toFixed(3)}, elevation ${dockedBefore.elev.toFixed(3)} → ${dockedAfter.elev.toFixed(3)}; rates ${JSON.stringify(dockedAfter.rates)}`,
);

// ---------------------------------------------------------------------------
// A focused Photo button's keys are the button's (sage round 6). Docked, so a
// leaked `Enter` is `dock.launch` and shows as a phase change; `Space` was
// `preventDefault`ed by `onKey`, which cancels the native click.
// ---------------------------------------------------------------------------
const buttonPress = async (label, key) => {
	await page.evaluate(() => document.exitPointerLock());
	await page.evaluate((text) => {
		const b = [...document.querySelectorAll("[data-photo-controls] button")]
			.filter((el) => el.textContent === text)
			.at(0);
		b?.focus();
	}, label);
	const focused = await page.evaluate(
		() => document.activeElement?.textContent ?? null,
	);
	await page.keyboard.press(key);
	await settle();
	return {
		focused,
		photo: (await pilot()).photo,
		phase: await page.evaluate(() => window.__seelite.dockPhase),
	};
};
const exitBySpace = await buttonPress("Exit Photo mode", "Space");
check(
	"Space on a focused Exit Photo mode button leaves Photo mode, still docked",
	exitBySpace.focused === "Exit Photo mode" &&
		!exitBySpace.photo &&
		exitBySpace.phase === "docked",
	JSON.stringify(exitBySpace),
);
// Out of Photo mode through `view.photo`, so this row does not stand on the one above.
await page.evaluate(() => {
	const g = window.__seelite;
	if (g.photoMode) g.command("view.photo");
});
const enterByEnter = await buttonPress("Photo mode", "Enter");
check(
	"Enter on a focused Photo mode button enters Photo mode and does not launch",
	enterByEnter.focused === "Photo mode" &&
		enterByEnter.photo &&
		enterByEnter.phase === "docked",
	JSON.stringify(enterByEnter),
);

await context.close();
await browser.close();
exit();
