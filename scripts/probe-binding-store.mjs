/**
 * A rebind that survives the page (#381, slice 3).
 *
 * `tests/binding-store.test.ts` owns the arithmetic — the diff, the validator,
 * the notices — against a fake `window` that is three lines long. What only a
 * page can answer is the thing the slice is *for*: that a layout written to a
 * real `localStorage` is still flying the ship after the browser has thrown
 * the game away and built it again. Nothing headless can see a page reload.
 *
 * **Every flight arm is read inside one boot.** `scripts/probe-rebind.mjs`
 * measured its band against a reference taken in the same session; this probe
 * reloads halfway through, so a post-reload reading compared with a
 * pre-reload one would be comparing two boots. The reference after the reload
 * is `w` — `fly.pitchDown`, the half of the axis the rebind never touched —
 * which is the same arm that probe already treats as the shipped rate.
 *
 * **And the first hold after a boot is discarded**, for that probe's measured
 * reason: it reads about 1.38x every arm after it, which has nothing to do
 * with any binding.
 *
 * The notice band is the second half. A rejected row is the one thing in this
 * slice a unit test cannot see the *point* of — the point is that a player
 * reads it — so the rows below open the `Controls` tab and ask whether the
 * sentence is drawn where a person would find it.
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

const SEED = 42;
/** `scripts/probe-rebind.mjs` states the reason: the shipped layout binds `0`
 *  through `3` in the digit row and nothing else, so `8` has no other command
 *  that could answer for it. */
const NEW_KEY = "8";
const HOLD_MS = 400;
/** `probe-rebind.mjs` measured twelve arms across three runs at 14.79-15.66°
 *  and took 0.8-1.2x; the same hold is being measured here, so the same band
 *  applies. */
const BAND = [0.8, 1.2];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(page);

const settle = () =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

const nose = () => page.evaluate(() => window.__seelite.nose());

const degreesBetween = (a, b) => {
	const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
	return (Math.acos(dot) * 180) / Math.PI;
};

/** Wait until the ship has stopped turning; `probe-rebind.mjs`'s header owns
 *  why an arm that measures an angle owes the state it started from, and why
 *  an exhausted wait is reported rather than thrown. */
let restFailed = false;
async function atRest() {
	let prev = await nose();
	const ticks = restFailed ? 40 : 200;
	for (let i = 0; i < ticks; i++) {
		await page.waitForTimeout(50);
		const now = await nose();
		if (degreesBetween(prev, now) < 0.02) return;
		prev = now;
	}
	restFailed = true;
}

async function turnedWhileHolding(key) {
	await atRest();
	const before = await nose();
	if (key !== null) await page.keyboard.down(key);
	await page.waitForTimeout(HOLD_MS);
	if (key !== null) await page.keyboard.up(key);
	await settle();
	return degreesBetween(before, await nose());
}

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

/**
 * The stored layout, found by shape rather than by key name.
 *
 * `CLAUDE.md`'s rule: a probe with its own copy of a constant goes falsely red
 * the day the module changes it. Asking which stored value *is* a layout also
 * happens to check the thing the key name is supposed to say — that the
 * version is inside the blob and not in the key.
 */
const storedLayout = () =>
	page.evaluate(() => {
		const found = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key === null) continue;
			let value = null;
			try {
				value = JSON.parse(localStorage.getItem(key) ?? "");
			} catch {
				continue;
			}
			if (value && typeof value === "object" && Array.isArray(value.moves))
				found.push({ key, value });
		}
		return found;
	});

/** Let the frame the rebind landed on be drawn, then read the tab. Written
 *  out three times as `settle(); waitForTimeout(120); tab()` (sage round 2). */
const settledTab = async () => {
	await settle();
	await page.waitForTimeout(120);
	return tab();
};

/** What a private window does to a write. Patched on the prototype because the
 *  game reads `window.localStorage.setItem` at call time, so the running build
 *  takes it. */
const refuseStorage = () =>
	page.evaluate(() => {
		Storage.prototype.setItem = () => {
			throw new Error("quota");
		};
	});

/** A move onto a key nothing else holds, used wherever an arm needs *a*
 *  rebind rather than a particular one. */
const moveYaw = () =>
	tryRebind(
		"fly.yawPort",
		{ kind: "key", key: "a", hold: true },
		{ kind: "key", key: "k", hold: true },
	);

/**
 * A stored row that is shape-legal and law-illegal: `fly.rollPort` is flown by
 * holding `q`, and a `to` that drops the hold asks for more than moving a key.
 * Written out three times before it was hoisted (sage round 2).
 */
const REFUSED_ROW = {
	command: "fly.rollPort",
	from: { kind: "key", key: "q", hold: true, code: "KeyQ" },
	to: { kind: "key", key: "k" },
};

const reload = async () => {
	await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
	await bootedGame(page);
};

// ---------------------------------------------------------------------------
// Before: nothing stored, and the shipped key flies.
// ---------------------------------------------------------------------------
const cleanStart = await storedLayout();
check(
	"a first boot stores no layout at all",
	cleanStart.length === 0,
	JSON.stringify(cleanStart.map((f) => f.key)),
);

await turnedWhileHolding("s");
const shippedBefore = await turnedWhileHolding("s");
const residual = await turnedWhileHolding(null);
check(
	"the shipped `s` pitches the ship, clear of the residual",
	shippedBefore > 5 && shippedBefore > residual * 50,
	`held ${shippedBefore.toFixed(2)}°, floor 5.00°, residual ${residual.toFixed(2)}°`,
);

const moved = await tryRebind(
	"fly.pitchUp",
	{ kind: "key", key: "s", hold: true },
	{ kind: "key", key: NEW_KEY, hold: true },
);
check("the rebind is accepted", moved === "accepted", moved);

const written = await storedLayout();
check(
	"the rebind wrote exactly one layout, and the key carries no version",
	written.length === 1 && !/v\d/.test(written[0]?.key ?? "vX"),
	JSON.stringify(written.map((f) => f.key)),
);
check(
	"the blob is a diff of one row, versioned inside itself",
	written[0]?.value?.version === 1 &&
		written[0]?.value?.moves?.length === 1 &&
		written[0]?.value?.moves?.[0]?.command === "fly.pitchUp",
	JSON.stringify(written[0]?.value),
);

// ---------------------------------------------------------------------------
// The reload. This is the row nothing headless can produce.
// ---------------------------------------------------------------------------
await reload();

// The discarded first hold, and then the in-boot reference.
await turnedWhileHolding("w");
const reference = await turnedWhileHolding("w");
check(
	"after the reload the untouched half of the axis still flies",
	reference > 5,
	`held ${reference.toFixed(2)}°, floor 5.00°`,
);

const parity = (turned) =>
	turned > reference * BAND[0] && turned < reference * BAND[1];
const bandText = `band ${BAND[0]}-${BAND[1]}x of ${reference.toFixed(2)}°`;

const newAfterReload = await turnedWhileHolding(NEW_KEY);
check(
	`\`${NEW_KEY}\` pitches the ship after a reload — the stored layout reached the simulation`,
	parity(newAfterReload),
	`held ${newAfterReload.toFixed(2)}°, ${bandText}`,
);
const oldAfterReload = await turnedWhileHolding("s");
check(
	"and the key it was moved off is still not pitch-up",
	oldAfterReload < 1,
	`held ${oldAfterReload.toFixed(2)}°, against ${newAfterReload.toFixed(2)}° on the stored key`,
);

// ---------------------------------------------------------------------------
// The tab says whose layout it is printing.
// ---------------------------------------------------------------------------
/** `?` as a hand makes it — `probe-controls-reference.mjs` owns the pacing and
 *  why `press("Shift+Slash")` will not do: Shift is the throttle. */
const pressQuestion = async () => {
	await page.keyboard.down("Shift");
	await page.waitForTimeout(120);
	await page.keyboard.press("Slash");
	await page.waitForTimeout(80);
	await page.keyboard.up("Shift");
	await settle();
};

/** What the tab is drawing, read only where a player could see it — an
 *  element that is present but not rendered answers nothing (`checkVisibility`,
 *  because an id rule with `display` beats `[hidden]`). */
const tab = () =>
	page.evaluate(() => {
		const body = document.querySelector("[data-live-controls-body]");
		if (!body || body.checkVisibility() !== true) return null;
		const band = body.querySelector("[data-live-controls-notices]");
		return {
			owner:
				body.querySelector("[data-live-controls-owner]")?.textContent ?? "",
			notices:
				band && band.checkVisibility() === true
					? [...band.querySelectorAll("[data-live-controls-notice]")].map(
							(li) =>
								`${li.getAttribute("data-live-controls-notice")}: ${li.textContent}`,
						)
					: [],
		};
	});

await pressQuestion();
const playerTab = await tab();
check(
	"the tab is drawn and says the layout is the player's, not the default",
	playerTab !== null &&
		playerTab.owner.includes("PLAYER LAYOUT") &&
		!playerTab.owner.includes("DEFAULT"),
	JSON.stringify(playerTab?.owner ?? null),
);
check(
	"and a layout that loaded cleanly is printed with no notice at all",
	playerTab !== null && playerTab.notices.length === 0,
	JSON.stringify(playerTab?.notices ?? null),
);

// ---------------------------------------------------------------------------
// A rejected row is a sentence on the screen, not a key that does nothing.
// ---------------------------------------------------------------------------
/** Write a blob by hand and boot on it. This is what an older build, another
 *  tab, or a person with a console open can put there. */
const bootOn = async (moves) => {
	// The key is the one the game itself wrote, so this probe still states no
	// constant of its own — and a build that stopped writing one would
	// otherwise have this helper quietly seed a key called `undefined` and
	// fail the rows below for a reason that reads like a rendering bug.
	const key = (await storedLayout())[0]?.key;
	if (typeof key !== "string")
		throw new Error("no stored layout to overwrite — nothing wrote one");
	await page.evaluate(
		([k, blob]) => localStorage.setItem(k, blob),
		[key, JSON.stringify({ version: 1, moves })],
	);
	await reload();
	await pressQuestion();
	return tab();
};

const mixed = await bootOn([
	{
		command: "fly.pitchUp",
		from: { kind: "key", key: "s", hold: true, code: "KeyS" },
		to: { kind: "key", key: NEW_KEY, hold: true, code: "Digit8" },
	},
	REFUSED_ROW,
]);
check(
	"a blob with one bad row still prints the good row's layout",
	mixed !== null && mixed.owner.includes("PLAYER LAYOUT"),
	JSON.stringify(mixed?.owner ?? null),
);
check(
	"and the band names the control that kept its default, where a player reads it",
	mixed !== null &&
		mixed.notices.length === 1 &&
		mixed.notices[0].startsWith("rejected:") &&
		/roll/i.test(mixed.notices[0]),
	JSON.stringify(mixed?.notices ?? null),
);

// ---------------------------------------------------------------------------
// A collision is allowed and said out loud (#369 D5).
// ---------------------------------------------------------------------------
const collided = await bootOn([
	{
		command: "fly.pitchUp",
		from: { kind: "key", key: "s", hold: true, code: "KeyS" },
		// `w` is `fly.pitchDown`'s held key.
		to: { kind: "key", key: "w", hold: true, code: "KeyW" },
	},
]);
check(
	"two commands on one key are both named in the band",
	collided !== null &&
		collided.notices.length === 1 &&
		collided.notices[0].startsWith("collision:") &&
		/nose up/i.test(collided.notices[0]) &&
		/nose down/i.test(collided.notices[0]),
	JSON.stringify(collided?.notices ?? null),
);

// ---------------------------------------------------------------------------
// A rebind while the tab is open, with no reload between.
//
// Every band reading above is taken after a boot, so nothing had observed
// `setControls` reaching the screen — it assigns a field, and the body is
// drawn off a structural key the catalogue is not in (sage round 1). These
// rows drive the path a player will take in S4: the tab is open, the layout
// changes, and the screen has to follow.
// ---------------------------------------------------------------------------
const rejectedStanding = await bootOn([REFUSED_ROW]);
check(
	"a boot on a blob with a refused row leaves a notice standing",
	rejectedStanding !== null && rejectedStanding.notices.length === 1,
	JSON.stringify(rejectedStanding?.notices ?? null),
);

const liveMove = await moveYaw();
check(
	"a rebind with the tab open is accepted",
	liveMove === "accepted",
	liveMove,
);
const afterLiveMove = await settledTab();
check(
	"the notice about the old blob is gone the moment a save replaces it — no reload",
	afterLiveMove !== null && afterLiveMove.notices.length === 0,
	JSON.stringify(afterLiveMove?.notices ?? null),
);
check(
	"and the tab is still drawn, still the player's",
	afterLiveMove !== null && afterLiveMove.owner.includes("PLAYER LAYOUT"),
	JSON.stringify(afterLiveMove?.owner ?? null),
);

// The blob this boot ran on moved only `fly.rollPort`, so pitch-up is still
// on its shipped key here — reading `NEW_KEY` instead is the last boot's
// layout, which is not the one in force.
const ontoTaken = await tryRebind(
	"fly.pitchUp",
	{ kind: "key", key: "s", hold: true },
	// `w` is `fly.pitchDown`'s held key.
	{ kind: "key", key: "w", hold: true },
);
check(
	"a rebind onto a key another command already holds is accepted (#369 D5: warn and allow)",
	ontoTaken === "accepted",
	ontoTaken,
);
const afterCollide = await settledTab();
check(
	"and the collision is on the screen without a reload, naming both commands",
	afterCollide !== null &&
		afterCollide.notices.length === 1 &&
		afterCollide.notices[0].startsWith("collision:") &&
		/nose up/i.test(afterCollide.notices[0]) &&
		/nose down/i.test(afterCollide.notices[0]),
	JSON.stringify(afterCollide?.notices ?? null),
);

// ---------------------------------------------------------------------------
// And a write that does not land retires nothing.
//
// This is the whole reason `saveLayout` reports: a private window or a full
// quota leaves the old blob exactly where it is, so every notice about it is
// still true. Without this arm, "retire on a successful save" and "retire
// always" are the same build.
// ---------------------------------------------------------------------------
const stillStanding = await bootOn([REFUSED_ROW]);
check(
	"the refused row's notice is up before the store is broken",
	stillStanding !== null && stillStanding.notices.length === 1,
	JSON.stringify(stillStanding?.notices ?? null),
);
await refuseStorage();
const refusedSave = await moveYaw();
check(
	"the rebind itself still works when the store refuses it",
	refusedSave === "accepted",
	refusedSave,
);
const afterRefused = await settledTab();
check(
	"and the notice stays up, because the blob it describes is still on disk",
	afterRefused !== null &&
		afterRefused.notices.some((n) => n.startsWith("rejected:")),
	JSON.stringify(afterRefused?.notices ?? null),
);
check(
	"and the refusal itself is said beside it, not instead of it",
	afterRefused !== null &&
		afterRefused.notices.length === 2 &&
		afterRefused.notices.some((n) => n.startsWith("unsaved:")),
	JSON.stringify(afterRefused?.notices ?? null),
);

// ---------------------------------------------------------------------------
// And a refusal with nothing stored says so on its own.
//
// The arm above only shows that a *pre-existing* notice stays up. With an
// empty store there is no earlier complaint to inherit, so a build that says
// nothing here lets a player rebind in a private window, fly it, lose it on
// reload and hear about none of it — which is the silent failure this whole
// slice exists to abolish (sage round 2).
// ---------------------------------------------------------------------------
await page.evaluate(() => localStorage.clear());
await reload();
await pressQuestion();
const cleanTab = await settledTab();
check(
	"a boot with nothing stored is the default layout, with nothing to say",
	cleanTab !== null &&
		cleanTab.owner.includes("DEFAULT LAYOUT") &&
		cleanTab.notices.length === 0,
	JSON.stringify(cleanTab),
);
await refuseStorage();
const silentRisk = await moveYaw();
check(
	"a rebind a private window cannot store is still accepted",
	silentRisk === "accepted",
	silentRisk,
);
const afterSilent = await settledTab();
check(
	"and the band says it was not saved, with nothing else to have said it",
	afterSilent !== null &&
		afterSilent.notices.length === 1 &&
		afterSilent.notices[0].startsWith("unsaved:") &&
		/reload/i.test(afterSilent.notices[0]),
	JSON.stringify(afterSilent?.notices ?? null),
);

check(
	"the rest gate never ran out, so every angle above is a settled reading",
	!restFailed,
	`restFailed=${restFailed}`,
);

await browser.close();
exit();
