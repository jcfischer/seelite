/**
 * Node #324 part (b)'s death path in the running game, by the principal's
 * ruling O5 (2026-09-14), narrowed by #654 (the principal's Q2 ruling on
 * #238, 2026-10-03): a death keeps the world and reverts only the commander.
 *
 * The headless rows in `tests/save-store.test.ts` own the store's half: the
 * world at the death beside the last dock's commander, a permadeath
 * commander refused, and a retired store writing nothing more. What only the
 * running game can answer is the wiring and the reload:
 *
 * 1. **With a save attached**, a hull at zero reverts the commander to the
 *    last dock and the page reloads into it — the leg's credits are gone and
 *    the ship is whole again, while the leg's world change (heat, written
 *    through the world's own writer) is still there.
 * 2. **Under `?no-save`**, there is nothing to restore: the ship stays
 *    destroyed, the clock holds, and the Commander overlay opens.
 * 3. **A death after a launch** (#660 D1, node #702) restores the commander
 *    as it launched — its credits — and the reload wakes docked at that
 *    station; since node #704 a death without ejecting costs the ship.
 * 4. **A death before the first dock** (#660 D10) wakes a new commander
 *    docked at the start system's trade station, in the world the death
 *    happened in.
 * 5. **An eject** (#660 D2, node #704), by the pilot's own held key with a
 *    pod fitted, wakes at the launch station with the launch hull and the
 *    other fittings, the hold empty and the pod spent; arm 3's death without
 *    ejecting, pod fitted, wakes in a stock courier with nothing (D4, D6).
 *    Both are told on the docked console what the death took.
 * 6. **The eject warning** (#660 D12) paints on the glass below the derived
 *    threshold with a pod fitted, names the key, and is said once per
 *    crossing.
 *
 * Permadeath is not flown here. Its whole difference is that the store returns
 * nothing, which the headless row proves, and the in-game branch it takes is
 * arm 2's.
 *
 * The kill is started from a timer inside the page so this script's `evaluate`
 * returns before the reload destroys the page it ran in.
 */
// A default-layout probe (#381 D11): arm 5 holds Backspace by name, as the
// shipped layout binds the eject, and a moved default turns it red for that
// reason.
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
		const ws = await import("/src/world-state.ts");
		const legal = await import("/src/legal.ts");
		// The dock checkpoint, then a leg that moved on from it — in the
		// commander (credits) and in the world (Wanted heat, #654).
		g.commander.credits = dock;
		g.saveStore.markDirty();
		g.saveFlush("dock");
		await g.saveStore.settled();
		const standingAtDock = g.legalStanding();
		g.commerceWorld = ws.setLegalHeat(
			g.commerceWorld,
			g.world.system.record.galaxy,
			(legal.WANTED_HEAT + legal.FUGITIVE_HEAT) / 2,
			g.world.gameTime,
		);
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
			standingAtDock,
			standingOnLeg: g.legalStanding(),
		};
	},
	{ dock: DOCK_CREDITS, leg: LEG_CREDITS },
);

check(
	"the fixture: a dock checkpoint behind a leg that moved on, in both halves",
	armed.store &&
		armed.lastDocked === DOCK_CREDITS &&
		armed.live === LEG_CREDITS &&
		armed.standingAtDock === "clean" &&
		armed.standingOnLeg === "wanted",
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
			standing: g.legalStanding(),
		};
	});
}
check(
	// **Which commander boots, not where the ship is.** The fixture writes the
	// dock record from flight with `saveFlush("dock")`, so the ship it restores
	// is in flight too; this row proves the reload loads `lastDocked`'s
	// commander (sage round 1 on #324). A boot parked at a station is
	// `probe-save.mjs`'s.
	"the reload boots the last dock's commander: the leg's credits are gone",
	after?.credits === DOCK_CREDITS && after?.liveCredits === DOCK_CREDITS,
	JSON.stringify(after),
);
check(
	// #654: the world half is the one the death happened in. The heat the leg
	// earned is still on the pilot after the reload, as the ruling says.
	"the world keeps the leg: the heat earned before the death stands",
	after?.standing === "wanted",
	JSON.stringify(after),
);
check(
	"the restored ship is alive and whole",
	after !== null && after.dead === false && after.whole,
	JSON.stringify(after),
);
await page.close();

// ---------------------------------------------------------------------------
// Arm 1b: a death with a docked `lastDocked` re-docks on reload (node #658).
// ---------------------------------------------------------------------------
// The fixture above writes the dock record from flight, so `dockedAt` is null.
// A real dock sets `dockedAt` in `commanderRecord()`, and `restoreDockedAt`
// picks it up on reload. This arm seeds a `lastDocked` with `dockedAt` set by
// modifying the record directly, then kills the ship and checks the reload
// comes back docked.

const dockPage = await browser.newPage({
	viewport: { width: 900, height: 620 },
});
watch(dockPage, "docked-death");
await dockPage.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(dockPage);

const dockArmed = await dockPage.evaluate(
	async ({ dock }) => {
		const g = window.__seelite;
		if (!g.saveStore) return { store: false };
		// Find the trade station's carrier key.
		const station = g.world.system.contents.stations.find(
			(s) => s.type === "trade",
		);
		if (!station) return { store: true, station: false };
		const key = `${g.world.system.record.index}:${station.localCarrierId}`;
		// Write a dock checkpoint with `dockedAt` set, as a real dock flush would.
		g.commander.credits = dock;
		const env = g.saveEnvelope();
		const record = { ...env.commander, dockedAt: key };
		const blob = g.save.serialize({ world: env.world, commander: record });
		await g.save.backend.write(g.save.defaultSlot, "lastDocked", blob);
		// Move credits on for the leg, then flush `live`.
		g.commander.credits = dock + 1000;
		g.saveStore.markDirty();
		g.saveFlush("jump");
		await g.saveStore.settled();
		return { store: true, station: station.id, key };
	},
	{ dock: DOCK_CREDITS },
);

check(
	"arm 1b fixture: a docked lastDocked is seeded",
	dockArmed.store && dockArmed.station,
	JSON.stringify(dockArmed),
);

if (dockArmed.store && dockArmed.station) {
	const dockReloaded = dockPage.waitForEvent("load", { timeout: 20000 });
	await dockPage.evaluate(() => {
		setTimeout(() => window.__seelite.takeDamage(1e6, "fore", "probe"), 0);
	});
	let dockReloadSeen = false;
	try {
		await dockReloaded;
		dockReloadSeen = true;
	} catch {
		dockReloadSeen = false;
	}
	check("a docked death reloads the page", dockReloadSeen);

	if (dockReloadSeen) {
		await bootedGame(dockPage);
		const dockAfter = await dockPage.evaluate(() => {
			const g = window.__seelite;
			return {
				credits: g.commander.credits,
				dockPhase: g.dock.phase,
				dockedAt: g.dockedAt,
				dead: g.dead,
				whole:
					g.condition.hull === g.condition.hullMax &&
					g.condition.fore > 0 &&
					g.condition.aft > 0,
			};
		});
		check(
			"a death with a docked lastDocked re-enters the station",
			dockAfter.dockPhase === "docked" &&
				dockAfter.dockedAt === dockArmed.station,
			JSON.stringify({
				dockPhase: dockAfter.dockPhase,
				dockedAt: dockAfter.dockedAt,
				want: dockArmed.station,
			}),
		);
		check(
			"and the restored commander has the dock's credits, not the leg's",
			dockAfter.credits === DOCK_CREDITS,
			JSON.stringify({ credits: dockAfter.credits, want: DOCK_CREDITS }),
		);
		check(
			"and the restored ship is alive",
			!dockAfter.dead && dockAfter.whole,
			JSON.stringify(dockAfter),
		);
	}
}
await dockPage.close();

/** Kills the ship from a timer, so `evaluate` returns before the reload, and
 *  reports whether the reload came. */
const killAndReload = async (p) => {
	const reloaded = p.waitForEvent("load", { timeout: 20000 });
	await p.evaluate(() => {
		setTimeout(() => window.__seelite.takeDamage(1e6, "fore", "probe"), 0);
	});
	try {
		await reloaded;
		return true;
	} catch {
		return false;
	}
};

/** A fresh page on seed 42, booted: how arms 3 and 4 open. Arms 1 and 2
 *  predate it and open theirs inline. */
const openArm = async (label) => {
	const p = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(p, label);
	await p.goto(gameUrl(origin, { seed: 42 }));
	await bootedGame(p);
	return p;
};

// ---------------------------------------------------------------------------
// Arms 3 and 5: a death restores the commander as it launched (#660 D1, node
// #702), at the cost of how it ended (#660 D2, D6, node #704).
// ---------------------------------------------------------------------------
// The game's own path for every step but the funds: a dock by the protocol,
// the pod, a docking computer and two tonnes of Food bought at that station's
// till (`transactStation`, as `probe-save.mjs` reaches it) and carried to
// `live` by the debounce, a launch by the game's own `launch`, a leg, then
// the death. The funds are a fixture — a new commander's 100 Cr does not buy
// a pod. The undock flush is what writes the checkpoint the reload boots, so
// the launch credits come back and the ship wakes at that station; what else
// comes back is the death's cause's.

const POD_FUNDS = 2777;
const FITTED = ["Docking Computer", "Escape Pod"];

/** Dock at the start trade station, buy the pod, a computer and Food, and
 *  launch: the commander a death will restore, at its cost. */
const dockBuyLaunch = async (p, label) => {
	await p.waitForFunction(() => !window.__seelite.clockHeld);
	const docked = await p.evaluate(
		async ({ funds, fitted }) => {
			const { migrateEquipment, equipmentNames } = await import(
				"/src/loadout.ts"
			);

			const g = window.__seelite;
			if (!g.saveStore) return { store: false };
			if (!g.startDockedAtHome()) return { store: true, docked: false };
			await g.saveStore.settled();
			const arrival = await g.save.backend.read(
				g.save.defaultSlot,
				"lastDocked",
			);
			// The real dock banked its station before the dock flush wrote: the
			// witness `hasDocked` reads after a reload (`death-checkpoint.ts`).
			const station = g.stationKey(
				g.world.system.contents.stations.find((s) => s.id === g.dockedAt),
			);
			const galaxy = String(g.world.system.record.galaxy);
			const visitedAtDock =
				arrival?.commander?.ladders?.visited?.[galaxy]?.stations?.includes(
					station,
				) ?? false;
			// The purchases, at the till: the till takes each price and fits it,
			// and the adopt point marks the save dirty for the debounce.
			g.commander.credits = funds;
			const bought = [
				...fitted.map((equipment) =>
					g.transactStation({ type: "buy-equipment", equipment }),
				),
				g.transactStation({
					type: "buy-commodity",
					commodity: "Food",
					quantity: 2,
				}),
			];
			const credits = g.commander.credits;
			await new Promise((resolve) =>
				setTimeout(resolve, g.save.debounceMs + 200),
			);
			await g.saveStore.settled();
			const live = await g.save.backend.read(g.save.defaultSlot, "live");
			return {
				store: true,
				docked: true,
				station: g.dockedAt,
				bought,
				credits,
				food: g.commander.cargo.Food ?? 0,
				liveCredits: live?.commander?.state?.credits ?? null,
				arrivalPod:
					equipmentNames(arrival?.commander?.state.loadout ?? {})?.includes(
						"Escape Pod",
					) ?? null,
				visitedAtDock,
			};
		},
		{ funds: POD_FUNDS, fitted: FITTED },
	);
	check(
		`${label} fixture: docked at the start trade station by the protocol`,
		docked.store && docked.docked && docked.arrivalPod === false,
		JSON.stringify(docked),
	);
	check(
		`${label}: the real dock banked its station into the record the dock flush wrote`,
		docked.visitedAtDock === true,
		JSON.stringify(docked),
	);
	check(
		`${label}: the pod, a computer and Food are bought at the till and reach live`,
		docked.bought?.every(Boolean) &&
			docked.food === 2 &&
			docked.credits < POD_FUNDS &&
			docked.liveCredits === docked.credits,
		JSON.stringify(docked),
	);
	if (!docked.docked) return null;
	// A launch the lane holds is retried, as `stepHeldLaunch` retries it.
	await p.waitForFunction(
		() => {
			const g = window.__seelite;
			return g.dockPhase !== "docked" || g.launch();
		},
		null,
		{ timeout: 20000, polling: 250 },
	);
	await p.waitForFunction(() => window.__seelite.dockPhase === "flying", null, {
		timeout: 30000,
	});
	const launched = await p.evaluate(async (leg) => {
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);

		const g = window.__seelite;
		await g.saveStore.settled();
		const record = await g.save.backend.read(g.save.defaultSlot, "lastDocked");
		g.commander.credits = leg;
		g.saveStore.markDirty();
		g.saveFlush("jump");
		await g.saveStore.settled();
		return {
			credits: record?.commander?.state?.credits ?? null,
			pod:
				equipmentNames(record?.commander?.state.loadout ?? {})?.includes(
					"Escape Pod",
				) ?? false,
			food: record?.commander?.state?.cargo?.Food ?? 0,
			dockedAt: record?.commander?.dockedAt ?? null,
		};
	}, LEG_CREDITS);
	check(
		`${label}: the undock flush writes lastDocked: the commander as it launched, at that station`,
		launched.credits === docked.credits &&
			launched.pod &&
			launched.food === 2 &&
			launched.dockedAt !== null,
		JSON.stringify(launched),
	);
	return { station: docked.station, credits: docked.credits };
};

/** What the reload woke to: where, with what, and what it was told. */
const wokeTo = (p) =>
	p.evaluate(async () => {
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);

		const g = window.__seelite;
		const hull = await import("/src/hull.ts");
		g.updateCockpit();
		const message = document.querySelector("[data-live-station-message]");
		return {
			phase: g.dockPhase,
			dockedAt: g.dockedAt,
			credits: g.commander.credits,
			hull: g.commander.hull,
			baseline: hull.PLAYER_BASELINE_HULL,
			fuelFull: g.commander.fuelLy === hull.HULL_SPECS[g.commander.hull].tankLy,
			equipment: [...equipmentNames(g.commander.loadout ?? {})].sort(),
			cargo: Object.keys(g.commander.cargo).length,
			wake: g.wakeShown,
			message: message?.textContent ?? null,
			dead: g.dead,
		};
	});

// Arm 3: a death without ejecting, a pod fitted (#660 D4, D6). The ship goes.
const launchPage = await openArm("launch-death");
const launchedForDeath = await dockBuyLaunch(launchPage, "arm 3");
if (launchedForDeath) {
	const seen = await killAndReload(launchPage);
	check("a death after the launch reloads the page", seen);
	if (seen) {
		await bootedGame(launchPage);
		const woke = await wokeTo(launchPage);
		check(
			"a death without ejecting wakes docked at the launch station with the launch credits",
			woke.phase === "docked" &&
				woke.dockedAt === launchedForDeath.station &&
				woke.credits === launchedForDeath.credits &&
				!woke.dead,
			JSON.stringify({ ...woke, want: launchedForDeath }),
		);
		check(
			"in a stock courier with a full tank: no pod, no computer, an empty hold",
			woke.hull === woke.baseline &&
				woke.fuelFull &&
				woke.equipment.length === 1 &&
				woke.equipment[0] === "Extra Pulse Laser" &&
				woke.cargo === 0,
			JSON.stringify(woke),
		);
		check(
			"and the console says the ship was lost",
			woke.wake?.cause === "destroyed" &&
				woke.message?.startsWith("Your ship was destroyed") === true,
			JSON.stringify({ wake: woke.wake, message: woke.message }),
		);
	}
}
await launchPage.close();

// Arm 5: the pod, ejected by the pilot's own held key (#660 D2, node #704).
// The hold and the pod go; the computer, the hull and the credits stay.
const ejectPage = await openArm("pod-eject");
const launchedForEject = await dockBuyLaunch(ejectPage, "arm 5");
if (launchedForEject) {
	const law = await ejectPage.evaluate(async () => {
		const eject = await import("/src/eject.ts");
		const g = window.__seelite;
		g.view = "cockpit";
		g.setHeadLook("forward");
		return { holdMs: eject.EJECT_HOLD_S * 1000 };
	});
	const reloaded = ejectPage.waitForEvent("load", { timeout: 20000 });
	await ejectPage.keyboard.down("Backspace");
	let seen = false;
	try {
		await reloaded;
		seen = true;
	} catch {
		seen = false;
	}
	await ejectPage.keyboard.up("Backspace");
	check(
		`a held Backspace with a pod in flight ejects, and the page reloads (hold ${law.holdMs} ms)`,
		seen,
	);
	if (seen) {
		await bootedGame(ejectPage);
		const woke = await wokeTo(ejectPage);
		check(
			"an eject wakes docked at the launch station with the launch credits",
			woke.phase === "docked" &&
				woke.dockedAt === launchedForEject.station &&
				woke.credits === launchedForEject.credits &&
				!woke.dead,
			JSON.stringify({ ...woke, want: launchedForEject }),
		);
		check(
			"with the launch hull and the computer kept, the pod spent and the hold empty",
			woke.hull === woke.baseline &&
				woke.equipment.join() === "Docking Computer,Extra Pulse Laser" &&
				woke.cargo === 0,
			JSON.stringify(woke),
		);
		check(
			"and the console says the pod brought them back and what it cost",
			woke.wake?.cause === "eject" &&
				woke.wake?.holdT === 2 &&
				woke.message?.startsWith("Your escape pod brought you back") === true,
			JSON.stringify({ wake: woke.wake, message: woke.message }),
		);
	}
}
await ejectPage.close();

// ---------------------------------------------------------------------------
// Arm 4: a pilot who never docked wakes as a new commander at the start
// system's trade station (#660 D10, node #702).
// ---------------------------------------------------------------------------

const firstPage = await openArm("first-death");

const flown = await firstPage.evaluate(async (leg) => {
	const g = window.__seelite;
	if (!g.saveStore) return { store: false };
	const ws = await import("/src/world-state.ts");
	const trade = g.world.system.contents.stations.find(
		(s) => s.type === "trade",
	);
	// A leg the death keeps in the world: a system marked visited that the
	// start is not.
	const galaxy = g.world.system.record.galaxy;
	const elsewhere = (g.world.system.record.index + 1) % 256;
	g.commerceWorld = ws.visit(g.commerceWorld, galaxy, elsewhere);
	g.commander.credits = leg;
	g.commander.cargo = { ...g.commander.cargo, Food: 2 };
	g.saveStore.markDirty();
	g.saveFlush("jump");
	await g.saveStore.settled();
	return {
		store: true,
		trade: trade?.id ?? null,
		// `station-trade` is every system's id; the index says which one.
		system: g.world.system.record.index,
		elsewhere,
		lastDocked:
			(await g.save.backend.read(g.save.defaultSlot, "lastDocked")) !== null,
		phase: g.dockPhase,
	};
}, LEG_CREDITS);
check(
	"arm 4 fixture: a free start in flight with no lastDocked",
	flown.store &&
		flown.trade !== null &&
		!flown.lastDocked &&
		flown.phase === "flying",
	JSON.stringify(flown),
);

if (flown.store && flown.trade) {
	const seen = await killAndReload(firstPage);
	check("a death before the first dock reloads the page", seen);
	if (seen) {
		await bootedGame(firstPage);
		const woke = {
			...(await wokeTo(firstPage)),
			...(await firstPage.evaluate(async (elsewhere) => {
				const g = window.__seelite;
				const commerce = await import("/src/station-commerce.ts");
				return {
					system: g.world.system.record.index,
					startingCredits: commerce.STARTING_CREDITS,
					visitedKept:
						g.commerceWorld.galaxies[
							g.world.system.record.galaxy
						].visited.includes(elsewhere),
					overlayOpen: g.commanderOverlay?.isOpen() ?? null,
				};
			}, flown.elsewhere)),
		};
		check(
			"the reload wakes a new commander docked at the start trade station",
			woke.phase === "docked" &&
				woke.dockedAt === flown.trade &&
				woke.system === flown.system &&
				woke.credits === woke.startingCredits &&
				woke.hull === woke.baseline &&
				woke.cargo === 0 &&
				!woke.dead &&
				woke.overlayOpen !== true,
			JSON.stringify({ ...woke, want: flown.trade, wantSystem: flown.system }),
		);
		check(
			"and the world keeps the leg flown before the death",
			woke.visitedKept,
			JSON.stringify(woke),
		);
		check(
			"and the console says a new commander woke, not that they launched",
			woke.wake?.firstLife === true &&
				woke.wake?.holdT === 2 &&
				woke.message?.includes("new commander") === true &&
				!woke.message?.includes("where you launched"),
			JSON.stringify({ wake: woke.wake, message: woke.message }),
		);
	}
}
await firstPage.close();

// ---------------------------------------------------------------------------
// Arm 6: the eject warning on the glass (#660 D12, node #704).
// ---------------------------------------------------------------------------
// Under `?no-save`, since nothing here dies. The pod and the hull are
// fixtures; what is read is the page's answer to them: the sentence the draw
// recorded, the pixels it moved against a same-page control with the hull
// whole — and a null control, two shots with nothing changed, for what the
// frame moves on its own — and how many times the voice was asked for.

const warnPage = await browser.newPage({
	viewport: { width: 1280, height: 760 },
});
watch(warnPage, "eject-warning");
await warnPage.goto(gameUrl(origin, { seed: 42, "no-save": true }));
await bootedGame(warnPage);
await warnPage.waitForFunction(() => !window.__seelite.clockHeld);
const warned = await warnPage.evaluate(async () => {
	const { migrateEquipment, equipmentNames } = await import("/src/loadout.ts");

	const g = window.__seelite;
	const cost = await import("/src/death-cost.ts");
	const names = await import("/src/key-names.ts");
	const market = await import("/src/market.ts");
	g.view = "cockpit";
	g.setHeadLook("forward");
	const overlay = document.getElementById("overlay");
	const c2d = overlay.getContext("2d", { willReadFrequently: true });
	const frames = (n) =>
		new Promise((resolve) => {
			let k = 0;
			const tick = () => (++k >= n ? resolve() : requestAnimationFrame(tick));
			requestAnimationFrame(tick);
		});
	const shot = () => c2d.getImageData(0, 0, overlay.width, overlay.height).data;
	// Moved pixels, and the mean colour of what moved in the second shot.
	const diff = (before, after) => {
		let moved = 0;
		let r = 0;
		let gr = 0;
		let b = 0;
		for (let i = 0; i < before.length; i += 4) {
			const d =
				Math.abs(after[i] - before[i]) +
				Math.abs(after[i + 1] - before[i + 1]) +
				Math.abs(after[i + 2] - before[i + 2]) +
				Math.abs(after[i + 3] - before[i + 3]);
			if (d < 24) continue;
			moved += 1;
			r += after[i];
			gr += after[i + 1];
			b += after[i + 2];
		}
		return moved === 0
			? { moved, r: 0, g: 0, b: 0 }
			: { moved, r: r / moved, g: gr / moved, b: b / moved };
	};
	const setHull = (hull) => {
		g.condition = { ...g.condition, hull };
	};
	const fit = (on) => {
		g.commander = {
			...g.commander,
			loadout: migrateEquipment(g.commander.hull, on ? [market.ESCAPE_POD] : [])
				.loadout,
		};
	};
	const full = g.condition.hullMax;
	fit(true);
	setHull(full);
	await frames(4);
	const control = shot();
	await frames(1);
	const jitter = diff(control, shot());
	const saidBefore = g.ejectWarningsSaid;
	setHull(cost.EJECT_WARNING_HULL - 1);
	await frames(4);
	const painted = diff(control, shot());
	const render = g.ejectWarningRender ? { ...g.ejectWarningRender } : null;
	const saidOnce = g.ejectWarningsSaid - saidBefore;
	await frames(10);
	const saidStill = g.ejectWarningsSaid - saidBefore;
	fit(false);
	await frames(4);
	const noPod = { due: g.ejectWarningDue, render: g.ejectWarningRender };
	fit(true);
	await frames(4);
	const saidAgain = g.ejectWarningsSaid - saidBefore;
	setHull(full);
	await frames(4);
	const healed = { due: g.ejectWarningDue, render: g.ejectWarningRender };
	return {
		want: cost.ejectWarningText(names.ejectPrompt(g.layoutInForce())),
		threshold: cost.EJECT_WARNING_HULL,
		render,
		jitter,
		painted,
		saidOnce,
		saidStill,
		noPod,
		saidAgain,
		healed,
	};
});
check(
	"below the threshold with a pod, the glass says to eject and names the key",
	warned.render?.text === warned.want && warned.want.includes("BACKSPACE"),
	JSON.stringify({ render: warned.render, want: warned.want }),
);
check(
	"and the sentence is painted: amber pixels move against the whole-hull control",
	warned.painted.moved > Math.max(200, warned.jitter.moved * 4) &&
		warned.painted.r > warned.painted.b + 60,
	JSON.stringify({ painted: warned.painted, jitter: warned.jitter }),
);
check(
	"the voice says it once per crossing, and again after the warning lapsed",
	warned.saidOnce === 1 && warned.saidStill === 1 && warned.saidAgain === 2,
	JSON.stringify(warned),
);
check(
	"no pod, no warning; a whole hull, no warning",
	warned.noPod.due === false &&
		warned.noPod.render === null &&
		warned.healed.due === false &&
		warned.healed.render === null,
	JSON.stringify({ noPod: warned.noPod, healed: warned.healed }),
);
await warnPage.close();

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
