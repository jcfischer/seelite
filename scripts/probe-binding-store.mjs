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
	// Shape-legal and law-illegal: `fly.rollPort` is not flown from a surface,
	// so `rebind` refuses the move and the row keeps its default.
	{
		command: "fly.rollPort",
		from: { kind: "key", key: "q", hold: true, code: "KeyQ" },
		to: { kind: "key", key: "k" },
	},
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

check(
	"the rest gate never ran out, so every angle above is a settled reading",
	!restFailed,
	`restFailed=${restFailed}`,
);

await browser.close();
exit();
