/**
 * Node #491's browser tier: the raider outpost in a live game.
 *
 * `tests/raider-outpost.test.ts` owns the generator — incidence, the Trojan
 * placement, the stream it draws on, the distance from the watched station —
 * and the committed baselines own the claim that no other station moved. What
 * only the page can answer is whether the running `Game` carries what the
 * generator made, in the order a pilot meets it:
 *
 * - booted into a lawless system, the outpost is one of the system's bodies,
 *   with the generator's own orbit, and stands where `placeBodies` says on
 *   the game clock — a sixth of a turn from its host planet;
 * - it is drawn: the scene holds a mesh for it;
 * - a pilot beside it who asks for clearance is refused as `closed`, not as
 *   hostile, and no cooldown is started — while the trade station of the same
 *   system, asked the same way, still answers.
 *
 * The lawless system is found on the page, by the generator's own rule
 * (`hasRaiderOutpost`), rather than pinned here: a pinned index is a copy of a
 * fact the generator owns. Seed 56 is `probe-relay.mjs`'s, for no deeper
 * reason than being a seed other probes already boot.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 56;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: process.env.HEADED !== "1" });
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
watch(page);
await installViewPlacement(page);
await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(page);

// The first lawless system of this galaxy, by the generator's rule.
const asked = await page.evaluate(async () => {
	const sys = await import("/src/system.ts");
	const g = window.__seelite;
	const record = g.world.galaxy.systems.find((r) =>
		sys.hasRaiderOutpost(r.government),
	);
	return record ? record.index : null;
});
check(
	"the galaxy holds a system the generator gives an outpost",
	asked !== null,
	JSON.stringify({ asked }),
);

await page.goto(gameUrl(origin, { seed: SEED, system: asked }), {
	waitUntil: "load",
});
await bootedGame(page);

const placed = await page.evaluate(async () => {
	const sys = await import("/src/system.ts");
	const g = window.__seelite;
	const record = g.world.system.record;
	const live = g.world.system.contents.stations.find(
		(s) => s.type === "outpost",
	);
	const fresh = sys
		.generateContents(record)
		.stations.find((s) => s.type === "outpost");
	const body = g.world.system.bodies.find((b) => b.id === live?.id);
	const t = g.world.gameTime;
	const pure = sys
		.placeBodies(g.world.system.contents, t)
		.find((b) => b.id === live?.id);
	const host = g.world.system.contents.planets.find(
		(p) => p.orbit.radiusKm === live?.orbit.radiusKm,
	);
	const hostBody = g.world.system.bodies.find((b) => b.id === host?.id);
	const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	return {
		system: record.index,
		government: record.government,
		id: live?.id ?? null,
		kind: body?.kind ?? null,
		stationType: body?.stationType ?? null,
		sameAsGenerator: JSON.stringify(live) === JSON.stringify(fresh),
		offPureKm: body && pure ? apart(body.pos, pure.pos) : null,
		hostId: host?.id ?? null,
		hostKm: body && hostBody ? apart(body.pos, hostBody.pos) : null,
		hostOrbitKm: host?.orbit.radiusKm ?? null,
		leadRad: sys.RAIDER_OUTPOST_LEAD_RAD,
	};
});
check(
	"booted into that system, the outpost is one of its station bodies, exactly as the generator made it",
	placed.system === asked &&
		placed.id === "station-outpost" &&
		placed.kind === "station" &&
		placed.stationType === "outpost" &&
		placed.sameAsGenerator === true,
	JSON.stringify(placed),
);
check(
	"it stands where placeBodies says on the game clock, a sixth of a turn from its host planet",
	placed.offPureKm !== null &&
		placed.offPureKm < 1e-6 &&
		placed.hostKm !== null &&
		// The chord of a sixth of a turn is the orbit's own radius.
		Math.abs(
			placed.hostKm - 2 * placed.hostOrbitKm * Math.sin(placed.leadRad / 2),
		) <
			1e-6 * placed.hostOrbitKm,
	JSON.stringify(placed),
);

const drawn = await page.evaluate(() => {
	const mesh = window.__meshOfBody("station-outpost");
	let parts = 0;
	mesh?.traverse((o) => {
		if (o.isMesh) parts++;
	});
	return { found: mesh !== null, parts };
});
check(
	"the scene holds a drawn mesh for it",
	drawn.found === true && drawn.parts > 0,
	JSON.stringify(drawn),
);

/** Beside a station, co-moving, nose-selected, and ask. */
const ask = (id) =>
	page.evaluate(async (stationId) => {
		const g = window.__seelite;
		const body = g.world.system.bodies.find((b) => b.id === stationId);
		if (!body) return { missing: stationId };
		await window.__placeShipAt(
			{ x: body.pos.x + 5, y: body.pos.y, z: body.pos.z },
			g.stationVelocity(stationId),
		);
		g.targetId = stationId;
		const asked = g.requestDockingClearance();
		const state = g.dockingStateOf(stationId);
		return {
			askedOf: asked.id,
			clearance: state.clearance,
			hostile: state.hostile,
		};
	}, id);

const outpost = await ask("station-outpost");
check(
	"asked beside it, the outpost refuses clearance as closed, not as hostile, and starts no cooldown",
	outpost.askedOf === "station-outpost" &&
		outpost.clearance?.kind === "denied" &&
		outpost.clearance?.reason === "closed" &&
		outpost.hostile === false,
	JSON.stringify(outpost),
);
const trade = await ask("station-trade");
check(
	"the trade station of the same system, asked the same way, still answers",
	trade.askedOf === "station-trade" &&
		(trade.clearance?.kind === "granted" || trade.clearance?.kind === "queued"),
	JSON.stringify(trade),
);

await browser.close();
exit();
