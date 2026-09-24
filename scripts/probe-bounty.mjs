/**
 * Node #508's browser tier: the Bounty family's checkpoint, flown in a normal
 * Game on a seed whose start system has an operational pirate relay.
 *
 * `tests/bounty.test.ts` owns the arithmetic — the binder, the eligibility
 * checks, the kill as evidence, the journal. What only the page can answer is
 * the wiring between them, in the checkpoint's own order:
 *
 * - docked at a lawful station, an unfitted pilot sees the Bounty **locked**,
 *   the Long-Range Scanner named on the row and no Accept (#489's ruling);
 * - fitted but Wanted, Accept is refused with its reason and nothing is taken;
 * - fitted and Clean, Accept takes it;
 * - the relay destroyed by the pulse laser readies the job — through
 *   `applyCarrierTransition`, the one writer every kill goes through;
 * - back at the same station, Report pays the pinned figure once, and a second
 *   report pays nothing;
 * - with the relay down, the board posts no Bounty.
 *
 * Seed 56 starts in ESLAIN, whose relay rolled active (`probe-relay.mjs` says
 * why that seed, and asserts it). This probe asserts it too rather than
 * assuming it.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const RELAY_SEED = 56;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: process.env.HEADED !== "1" });
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page);
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: RELAY_SEED }), { waitUntil: "load" });
await bootedGame(page);

await page.evaluate(async () => {
	const g = window.__seelite;
	// **Constants off the page**, never a copy here (`CLAUDE.md`).
	const market = await import("/src/market.ts");
	const legal = await import("/src/legal.ts");
	const ws = await import("/src/world-state.ts");
	const relay = await import("/src/pirate-relay.ts");
	const dt = g.units.MAX_DT;
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};
	window.__bountyProbe = {
		LRS: market.LONG_RANGE_SCANNER,
		RELAY_NAME: relay.RELAY_NAME,
		WANTED_HEAT: legal.WANTED_HEAT,
		frame,
		fitScanner(own) {
			g.commander = {
				...g.commander,
				ownedEquipment: own ? [market.LONG_RANGE_SCANNER] : [],
			};
			g.updateCockpit();
		},
		/** The pilot's heat, written through the world's own writer. */
		setHeat(heat) {
			g.commerceWorld = ws.setLegalHeat(
				g.commerceWorld,
				g.world.system.record.galaxy,
				heat,
				g.world.gameTime,
			);
			g.updateCockpit();
			return g.legalStanding();
		},
		bounty() {
			return g.requestsView().offers.find((o) => o.family === "bounty") ?? null;
		},
		request(id) {
			return g.commanderRecord().requests.byId[id] ?? null;
		},
		credits() {
			return g.commander.credits;
		},
		/** Leave the dock and hold beside the relay, nose on it. */
		async besideRelay(km) {
			for (let i = 0; i < 3600 && g.dockPhase !== "flying"; i++) {
				if (g.dockPhase === "docked") g.launch();
				g.skipDockTraversal();
				g.step(1 / 60);
			}
			if (g.dockPhase !== "flying")
				throw new Error(`could not leave the dock (${g.dockPhase})`);
			g.dropOut("probe");
			g.encounter = null;
			frame();
			const r = g.relayReadout();
			g.world.ship.pos = {
				x: r.view.pos.x + km,
				y: r.view.pos.y,
				z: r.view.pos.z,
			};
			g.world.ship.vel = { ...r.view.vel };
			g.throttle = 0;
			g.setAttitude({ x: -1, y: 0, z: 0 }, g.shipUp());
			g.setHeadLook("forward");
			frame();
			return g.relayReadout().view.condition;
		},
		/** The pulse laser held on the relay until it dies or `maxSteps` pass. */
		shoot(maxSteps) {
			const r0 = g.relayReadout();
			g.targetId = r0.view.key;
			g.keys.add(" ");
			let steps = 0;
			for (; steps < maxSteps; steps++) {
				const r = g.relayReadout();
				if (r.view.condition !== "operational") break;
				const p = g.world.ship.pos;
				const t = r.view.pos;
				g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
				frame();
			}
			g.keys.delete(" ");
			return {
				steps,
				condition: g.relayReadout().view.condition,
				key: r0.view.key,
			};
		},
		async dock(stationId) {
			await window.__parkInBerth(stationId, g.berthIdsOfStation(stationId)[0]);
			g.setHeadLook("forward");
			g.updateCockpit();
			return g.dockPhase;
		},
	};
});

const boot = await page.evaluate(() => {
	const g = window.__seelite;
	const trade = g.world.system.bodies.find(
		(b) => b.kind === "station" && b.stationType === "trade",
	);
	return {
		system: g.world.system.record.name,
		active: g.relayReadout().active,
		station: trade?.id ?? null,
	};
});
check(
	"the start system's relay is active, so a Bounty has a target",
	boot.active && boot.station !== null,
	`${boot.system} · station ${boot.station}`,
);

const console_ = page.locator("[data-live-station-console]");
const openRequests = async () => {
	await page.locator('[data-live-station-tab="Requests"]').click();
};
const openRow = async (id) => {
	await console_
		.locator(
			`[data-live-request-action="details"][data-live-request-id="${id}"]`,
		)
		.click();
};
const actionButton = (action, id) =>
	console_.locator(
		`[data-live-request-action="${action}"][data-live-request-id="${id}"]`,
	);
const message = () =>
	console_.locator(".lc-request-message").first().textContent();

// ---------------------------------------------------------------------------
// Unfitted: the row lists, locked, and says why.
// ---------------------------------------------------------------------------
await page.evaluate(async (id) => {
	window.__bountyProbe.fitScanner(false);
	window.__bountyProbe.setHeat(0);
	await window.__bountyProbe.dock(id);
}, boot.station);
await openRequests();
const offer = await page.evaluate(() => window.__bountyProbe.bounty());
const probe = await page.evaluate(() => ({
	LRS: window.__bountyProbe.LRS,
	RELAY_NAME: window.__bountyProbe.RELAY_NAME,
	WANTED_HEAT: window.__bountyProbe.WANTED_HEAT,
}));
check(
	"a lawful station in a relay system posts a Bounty naming the relay",
	offer !== null &&
		offer.operand.kind === "target" &&
		offer.operand.targetName === probe.RELAY_NAME &&
		offer.reportAt.carrierKey === offer.requester.carrierKey,
	offer ? `${offer.title} · ${offer.rewardCr} Cr · ${offer.region}` : "none",
);
if (!offer) exit();

const row = console_.locator(
	`[data-live-request-action="details"][data-live-request-id="${offer.id}"]`,
);
const rowText = (await row.textContent()) ?? "";
check(
	"unfitted, the row is locked and names the Long-Range Scanner",
	(await row.getAttribute("data-live-request-locked")) !== null &&
		rowText.includes(`locked · needs ${probe.LRS}`),
	rowText,
);
await openRow(offer.id);
const details =
	(await console_.locator("[data-live-request-details]").textContent()) ?? "";
check(
	"unfitted, the details say the module is missing and draw no Accept",
	details.includes(`${probe.LRS} · not fitted`) &&
		(await actionButton("accept", offer.id).count()) === 0,
	details.slice(0, 160),
);

// ---------------------------------------------------------------------------
// Fitted but Wanted: Accept is drawn, and refused with its reason.
// ---------------------------------------------------------------------------
const wanted = await page.evaluate((heat) => {
	window.__bountyProbe.fitScanner(true);
	return window.__bountyProbe.setHeat(heat);
}, probe.WANTED_HEAT + 5);
await openRow(offer.id);
await actionButton("accept", offer.id).click();
const refused = await page.evaluate(
	(id) => window.__bountyProbe.request(id),
	offer.id,
);
const refusal = (await message()) ?? "";
check(
	"a Wanted pilot's Accept is refused with a readable reason, and nothing is taken",
	wanted === "wanted" && refused === null && /Clean/.test(refusal),
	`${wanted} · "${refusal}"`,
);

// ---------------------------------------------------------------------------
// Fitted and Clean: accepted.
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__bountyProbe.setHeat(0));
await openRow(offer.id);
await actionButton("accept", offer.id).click();
const taken = await page.evaluate(
	(id) => window.__bountyProbe.request(id),
	offer.id,
);
check(
	"a Clean, fitted pilot accepts the Bounty",
	taken?.status === "accepted",
	taken?.status ?? "no row",
);

// ---------------------------------------------------------------------------
// The kill readies it.
// ---------------------------------------------------------------------------
const before = await page.evaluate(() => window.__bountyProbe.besideRelay(1));
const shot = await page.evaluate(() => window.__bountyProbe.shoot(4000));
const ready = await page.evaluate(
	(id) => window.__bountyProbe.request(id),
	offer.id,
);
check(
	"destroying the relay readies the accepted Bounty, with the kill as its evidence",
	before === "operational" &&
		shot.condition === "destroyed" &&
		shot.key === offer.operand.carrierKey &&
		ready?.status === "ready-to-report" &&
		ready.evidence.length === 1 &&
		ready.evidence[0].source === "kill",
	`${before} → ${shot.condition} in ${shot.steps} steps · ${ready?.status}`,
);

// ---------------------------------------------------------------------------
// Report at the posting station pays once.
// ---------------------------------------------------------------------------
await page.evaluate((id) => window.__bountyProbe.dock(id), boot.station);
await openRequests();
const creditsBefore = await page.evaluate(() => window.__bountyProbe.credits());
await openRow(offer.id);
await actionButton("report", offer.id).click();
const creditsAfter = await page.evaluate(() => window.__bountyProbe.credits());
const paid = (await message()) ?? "";
check(
	"Report at the posting station pays the pinned figure and names the kill",
	creditsAfter - creditsBefore === offer.rewardCr &&
		paid.includes(`${probe.RELAY_NAME} destroyed`),
	`${creditsBefore} → ${creditsAfter} · "${paid}"`,
);

const again = await page.evaluate((id) => {
	const g = window.__seelite;
	const before = g.commander.credits;
	g.actOnRequest("report", id);
	return {
		paid: g.commander.credits - before,
		message: g.requestMessage,
		drawn: document.querySelectorAll(
			`[data-live-station-console] [data-live-request-action="report"][data-live-request-id="${id}"]`,
		).length,
	};
}, offer.id);
check(
	"a second report pays nothing, and no Report is drawn",
	again.paid === 0 && again.drawn === 0,
	`${again.paid} Cr · "${again.message}"`,
);

const after = await page.evaluate(() => window.__bountyProbe.bounty());
check(
	"with the relay down, the board posts no Bounty",
	after === null,
	after ? after.id : "none",
);

await browser.close();
exit();
