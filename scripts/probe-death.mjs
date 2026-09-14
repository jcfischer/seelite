/**
 * Node #324 part (b)'s death path in the running game, by the principal's
 * ruling O5 (2026-09-14).
 *
 * The headless rows in `tests/save-store.test.ts` own the store's half: the
 * copy is byte for byte, a permadeath commander is refused, and a retired
 * store writes nothing more. What only the running game can answer is the
 * wiring and the reload:
 *
 * 1. **With a save attached**, a hull at zero reverts `live` to the last dock
 *    and the page reloads into it — the leg's gains are gone and the ship is
 *    whole again.
 * 2. **Under `?no-save`**, there is nothing to restore: the ship stays
 *    destroyed, the clock holds, and the Commander overlay opens.
 *
 * Permadeath is not flown here. Its whole difference is that the store returns
 * nothing, which the headless row proves, and the in-game branch it takes is
 * arm 2's.
 *
 * The kill is started from a timer inside the page so this script's `evaluate`
 * returns before the reload destroys the page it ran in.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const DOCK_CREDITS = 4242;
const LEG_CREDITS = 9999;

// ---------------------------------------------------------------------------
// Arm 1: a save attached. Death reverts to the last dock and reloads.
// ---------------------------------------------------------------------------

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

const armed = await page.evaluate(
	async ({ dock, leg }) => {
		const g = window.__seelite;
		if (!g.saveStore) return { store: false };
		// The dock checkpoint, then a leg that moved on from it.
		g.commander.credits = dock;
		g.saveStore.markDirty();
		g.saveFlush("dock");
		await g.saveStore.settled();
		g.commander.credits = leg;
		g.saveStore.markDirty();
		g.saveFlush("jump");
		await g.saveStore.settled();
		const read = async (kind) =>
			(await g.save.backend.read(g.save.defaultSlot, kind))?.commander?.state
				?.credits ?? null;
		return {
			store: true,
			live: await read("live"),
			lastDocked: await read("lastDocked"),
		};
	},
	{ dock: DOCK_CREDITS, leg: LEG_CREDITS },
);

check(
	"the fixture: a dock checkpoint behind a leg that moved on",
	armed.store &&
		armed.lastDocked === DOCK_CREDITS &&
		armed.live === LEG_CREDITS,
	JSON.stringify(armed),
);

const reloaded = page.waitForEvent("load", { timeout: 20000 });
const killed = await page.evaluate(() => {
	const g = window.__seelite;
	setTimeout(() => g.takeDamage(1e6, "fore", "probe"), 0);
	return true;
});
let reloadSeen = false;
try {
	await reloaded;
	reloadSeen = true;
} catch {
	reloadSeen = false;
}
check("a hull at zero reloads the page", killed && reloadSeen);

let after = null;
if (reloadSeen) {
	await bootedGame(page);
	after = await page.evaluate(async () => {
		const g = window.__seelite;
		const c = g.condition;
		const live = await g.save.backend.read(g.save.defaultSlot, "live");
		return {
			credits: g.commander.credits,
			dead: g.dead,
			whole: c.hull === c.hullMax && c.fore > 0 && c.aft > 0,
			liveCredits: live?.commander?.state?.credits ?? null,
		};
	});
}
check(
	"the reload boots into the last dock: the leg's credits are gone",
	after?.credits === DOCK_CREDITS && after?.liveCredits === DOCK_CREDITS,
	JSON.stringify(after),
);
check(
	"the restored ship is alive and whole",
	after !== null && after.dead === false && after.whole,
	JSON.stringify(after),
);
await page.close();

// ---------------------------------------------------------------------------
// Arm 2: ?no-save. Nothing to restore: destroyed, held, overlay open.
// ---------------------------------------------------------------------------

const bare = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(bare);
await bare.goto(gameUrl(origin, { seed: 42, "no-save": true }));
await bootedGame(bare);
const ended = await bare.evaluate(async () => {
	const g = window.__seelite;
	const before = g.commanderOverlay?.isOpen() ?? null;
	g.takeDamage(1e6, "fore", "probe");
	// `onDeath` is async; the overlay opens once its promise settles.
	await new Promise((resolve) => setTimeout(resolve, 50));
	return {
		store: g.saveStore !== null,
		overlayBefore: before,
		dead: g.dead,
		clockHeld: g.clockHeld,
		lastExit: g.lastExit,
		overlayOpen: g.commanderOverlay?.isOpen() ?? null,
	};
});
check(
	"under ?no-save a death holds the clock and says the ship is destroyed",
	!ended.store &&
		ended.dead &&
		ended.clockHeld &&
		ended.lastExit === "ship destroyed",
	JSON.stringify(ended),
);
check(
	"and the Commander overlay opens",
	ended.overlayBefore === false && ended.overlayOpen === true,
	JSON.stringify(ended),
);
await bare.close();

await browser.close();
exit();
