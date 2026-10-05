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
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { flightHarness, HOLD_MS, NEW_KEY } from "./lib/flight-harness.mjs";
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
/** `probe-rebind.mjs` measured twelve arms across three runs at 14.79-15.66°
 *  and took 0.8-1.2x; the same hold is being measured here, so the same band
 *  applies. */
const BAND = [0.8, 1.2];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(page);

/**
 * The measurement, shared with `probe-rebind.mjs` since #381 S4 —
 * `scripts/lib/flight-harness.mjs` owns `atRest`, `turnedWhileHolding` and
 * every reason the two are shaped the way they are, including the sage round
 * that proved sampling before waiting disables the rest gate. `NEW_KEY` and
 * `HOLD_MS` moved with them. This file was the second copy; the capture
 * modal's rows would have been the third.
 */
const { settle, turnedWhileHolding, restFailed } = flightHarness(page);

/**
 * Two keys held alternately, `n` times each, reported as medians.
 *
 * **One hold is not a measurement of a rate, and this probe shipped two
 * comparisons that rested on one each.** Caught by running it: a `w`/`8` pair
 * read 14.00° and 18.68° on one run out of four and 13.99°/13.88° on the
 * others, so a 1.33x hitch on a single hold failed a 0.8-1.2x band on a build
 * that was working. A 400 ms hold is a coarse instrument — `probe-rebind.mjs`
 * says so and bands rather than floors for that reason — and a coarse
 * instrument sampled once is a coin toss at the edges.
 *
 * **Interleaved, not blocked**, which is this repo's own lesson from
 * `measure-light-cost.mjs`: running all of one arm and then all of the other
 * measures the order as much as the arm.
 */
async function medianPair(a, b, n = 3) {
	const runs = { [a]: [], [b]: [] };
	for (let i = 0; i < n; i++)
		for (const key of [a, b]) runs[key].push(await turnedWhileHolding(key));
	const median = (xs) =>
		[...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
	return {
		[a]: median(runs[a]),
		[b]: median(runs[b]),
		spread: Object.fromEntries(
			Object.entries(runs).map(([k, xs]) => [
				k,
				`${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)}°`,
			]),
		),
	};
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
	typeof written[0]?.value?.version === "number" &&
		written[0]?.value?.moves?.length === 1 &&
		written[0]?.value?.moves?.[0]?.command === "fly.pitchUp",
	JSON.stringify(written[0]?.value),
);

// ---------------------------------------------------------------------------
// The reload. This is the row nothing headless can produce.
// ---------------------------------------------------------------------------
await reload();

// The discarded first hold, then the reference and the moved key measured
// against each other, interleaved.
await turnedWhileHolding("w");
const reloaded = await medianPair("w", NEW_KEY);
const reference = reloaded.w;
check(
	"after the reload the untouched half of the axis still flies",
	reference > 5,
	`median ${reference.toFixed(2)}° over ${reloaded.spread.w}, floor 5.00°`,
);

const parity = (turned) =>
	turned > reference * BAND[0] && turned < reference * BAND[1];
const bandText = `band ${BAND[0]}-${BAND[1]}x of ${reference.toFixed(2)}°`;

const newAfterReload = reloaded[NEW_KEY];
check(
	`\`${NEW_KEY}\` pitches the ship after a reload — the stored layout reached the simulation`,
	parity(newAfterReload),
	`median ${newAfterReload.toFixed(2)}° over ${reloaded.spread[NEW_KEY]}, ${bandText}`,
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
			// Whose layout the characters are, and every key marked as bound on
			// another one (node #382), each as `row: key` off the drawn kbd.
			attribution:
				body
					.querySelector("[data-live-controls-attribution]")
					?.getAttribute("data-live-controls-attribution") ?? null,
			attributionText:
				body.querySelector("[data-live-controls-attribution]")?.textContent ??
				"",
			marked: [...body.querySelectorAll("[data-live-controls-off-layout]")].map(
				(m) =>
					`${m.closest("[data-live-controls-row]")?.getAttribute("data-live-controls-row")}: ${m.querySelector("kbd")?.textContent}`,
			),
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
	const stored = (await storedLayout())[0];
	const key = stored?.key;
	if (typeof key !== "string") {
		// **Reported, not thrown.** A throw at top level here escapes past
		// `browser.close()` and `exit()`, so the suite reports a crash instead
		// of a failing row and leaves a page running for the next probe to
		// boot beside (sage round 6).
		check(
			"there is a stored layout to overwrite — something wrote one",
			false,
			JSON.stringify(stored ?? null),
		);
		return null;
	}
	// **The version comes off the blob the game itself wrote**, not from a
	// literal here. A probe with its own copy of a constant goes falsely red
	// the day the module changes it — and this one would have gone falsely
	// *green*, refusing every seeded blob as a version this build does not
	// know while the rows read that as the layout not applying (sage round 4).
	const version = stored?.value?.version;
	await page.evaluate(
		([k, blob]) => localStorage.setItem(k, blob),
		[key, JSON.stringify({ version, moves })],
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

check(
	"a row rebound on a US keyboard is printed as the defaults are, unmarked",
	mixed !== null &&
		mixed.attribution === "authored" &&
		mixed.marked.length === 0,
	JSON.stringify(mixed && { a: mixed.attribution, marked: mixed.marked }),
);

// ---------------------------------------------------------------------------
// A row bound on another keyboard prints what that keyboard typed, marked, and
// the header says whose characters the rest are (node #382). `ü` is what a
// German keyboard types at BracketLeft, which a US one types as `[`.
// ---------------------------------------------------------------------------
const offLayout = await bootOn([
	{
		command: "fly.pitchUp",
		from: { kind: "key", key: "s", hold: true, code: "KeyS" },
		to: { kind: "key", key: "ü", hold: true, code: "BracketLeft" },
	},
]);
check(
	"a key bound on another layout prints its recorded character, and only it is marked",
	offLayout !== null &&
		offLayout.notices.length === 0 &&
		offLayout.marked.length === 1 &&
		offLayout.marked[0] === "fly.pitchUp: hold ü",
	JSON.stringify(offLayout && { n: offLayout.notices, m: offLayout.marked }),
);
check(
	"and the header says the rest are a US keyboard's and names the mark",
	offLayout !== null &&
		offLayout.attribution === "recorded" &&
		offLayout.attributionText.includes("US keyboard") &&
		offLayout.attributionText.includes("◆"),
	JSON.stringify(offLayout?.attributionText ?? null),
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

// ---------------------------------------------------------------------------
// "Both run" is a sentence on the screen, so it is a claim about the ship.
//
// The band tells the player that a doubled-up key runs both commands (#369
// D5's warn-and-allow, with D5's *resolution* unimplemented — #484 owns it).
// Every check on that sentence up to round 4 read the sentence.
//
// **And the first attempt to read the ship instead could not fail in the
// direction it claimed.** It collided pitch-up onto pitch-down's key and
// asserted the turn collapsed, because opposite terms cancel — but a build
// where a collided key dispatches *nothing* reads zero and passes, while the
// printed sentence is false (sage round 5). Nothing-at-all is the *plausible*
// failure here, not an exotic one: it is what an attempt at #484's resolution
// looks like if it resolves to neither.
//
// So the two commands are chosen not to cancel. Pitch and yaw are orthogonal,
// so one alone turns the nose by θ and both together by more; nothing at all
// turns it by nothing. One scalar separates all three.
// ---------------------------------------------------------------------------
await page.evaluate(() => localStorage.clear());
await reload();
// The discarded first hold, then `d` on the shipped layout, where it is yaw
// to starboard alone.
// `d` is yaw to starboard, and `s` is pitch up. The pair is measured
// interleaved *before* the rebind, so the "one command" figure is a median
// like the one it is compared with.
await turnedWhileHolding("d");
const single = await medianPair("d", "s");
check(
	"on the shipped layout `d` and `s` are one command each and both turn the ship",
	single.d > 5 && single.s > 5,
	`d ${single.d.toFixed(2)}° over ${single.spread.d}, s ${single.s.toFixed(2)}° over ${single.spread.s}`,
);
const doubled = await tryRebind(
	"fly.pitchUp",
	{ kind: "key", key: "s", hold: true },
	{ kind: "key", key: "d", hold: true },
);
check(
	"pitch-up moves onto `d`, which yaw-to-starboard holds",
	doubled === "accepted",
	doubled,
);
const after = await medianPair("d", "s");
check(
	"and `d` now turns the ship *further* than either command alone — both run",
	// Three terms and each refuses a different build. The floor refuses one
	// where a collided key reaches nothing. The ratio against `d` alone
	// refuses one where it reaches only the command that was already there.
	// And `s` reading nothing now is what says pitch-up *moved* rather than
	// being copied — without it, a build that bound pitch-up to both keys
	// passes the first two. A right angle between two equal rates gives
	// 1.41x, so 1.15 leaves room for the rates not being equal.
	after.d > 5 && after.d > single.d * 1.15 && after.s < 1,
	`d ${after.d.toFixed(2)}° over ${after.spread.d} against ${single.d.toFixed(2)}° for one command (${(after.d / single.d).toFixed(2)}x); s ${after.s.toFixed(2)}° over ${after.spread.s}`,
);

check(
	"the rest gate never ran out, so every angle above is a settled reading",
	// **`=== false`, not `!`** (#381 S4). `restFailed` is a reader now rather
	// than a module-level flag, because two probes sharing one would let the
	// first to run shorten the second's waits.
	//
	// The comment here claimed a bare `!restFailed` would have "gone on
	// passing while measuring nothing". That is backwards and sage round 2 on
	// #497 said so: `!fn` is `false`, so the row would be permanently *red*.
	// What `=== false` buys is that the mistake is a type error a reader can
	// see, rather than a row nobody can make green.
	restFailed() === false,
	`restFailed=${restFailed()}`,
);

await browser.close();
exit();
