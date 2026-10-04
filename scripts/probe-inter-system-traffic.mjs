/** Node #684: the observed hauler and the independently anchored far side. */
import { PNG } from "pngjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installHaulerFixture } from "./lib/hauler-fixture.mjs";
const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(ORIGIN, { seed: 47, system: 0 }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	await page.evaluate(() => {
		const g = window.__seelite,
			play = g.play.bind(g);
		window.__npcJumpCues = [];
		g.play = (cue) => {
			if (
				["witchspaceUnfold", "witchspaceRift"].includes(cue.kind) &&
				cue.spatial
			)
				window.__npcJumpCues.push(cue);
			play(cue);
		};
	});
	const fixture = await page.evaluate(installHaulerFixture);
	const sample = (at) =>
		page.evaluate((at) => window.__haulerFixture.sample(at), at);
	const leaving = await sample(fixture.departure + 1);
	check(
		"named hauler leaves its home Berth",
		["departing", "local-departure"].includes(leaving.phase),
		leaving,
	);
	const early = await sample(fixture.tOut - 3.1);
	check(
		"early hauler holds at the star-centric lane point",
		early.phase === "lane-point-hold" && early.contact,
		early,
	);
	const windup = await sample(fixture.tOut - 0.1);
	check(
		"three-second jump wind-up retains its contact",
		windup.phase === "jump-windup" && windup.contact,
		windup,
	);
	const departed = await sample(fixture.tOut + 0.5);
	check(
		"departure removes contact at the anchor",
		departed.phase === "hyperspace-away" &&
			!departed.contact &&
			departed.jump.atS === fixture.tOut,
		departed,
	);
	const pixels = async () => {
		const on = PNG.sync.read(await page.screenshot());
		await page.evaluate(() => {
			const g = window.__seelite;
			for (const r of g.trafficRifts.values())
				r.object.material.colorWrite = false;
			g.render(0);
		});
		const off = PNG.sync.read(await page.screenshot());
		await page.evaluate(() => {
			const g = window.__seelite;
			for (const r of g.trafficRifts.values())
				r.object.material.colorWrite = true;
			g.render(0);
		});
		let count = 0;
		for (let i = 0; i < on.data.length; i += 4)
			if (
				Math.max(
					...[0, 1, 2].map((c) => Math.abs(on.data[i + c] - off.data[i + c])),
				) > 8
			)
				count++;
		return count;
	};
	const departurePixels = await pixels();
	check("departure ring paints the frame", departurePixels > 30, {
		departurePixels,
	});
	await page.evaluate(() => {
		window.__haulerFixture.follow();
		window.__npcJumpCues.length = 0;
	});
	const arrived = await sample(fixture.tOut + 0.5);
	check(
		"following the player meets the same name and hull",
		arrived.name === fixture.name &&
			arrived.hull === fixture.hull &&
			arrived.contact &&
			arrived.jump?.kind === "arrival",
		arrived,
	);
	const arrivalPixels = await pixels();
	check("arrival ring paints the frame", arrivalPixels > 30, { arrivalPixels });
	const arrivalCues = await page.evaluate(() => {
		const g = window.__seelite,
			cues = [...window.__npcJumpCues];
		const nearby = { ...g.world.ship.pos };
		// Move out of the materialization band and return during the same ring.
		g.world.ship.pos = { x: nearby.x + 20000, y: nearby.y, z: nearby.z };
		g.updateTrafficRifts(g.world.ship.pos, g.cameraRotation());
		g.world.ship.pos = nearby;
		g.updateTrafficRifts(nearby, g.cameraRotation());
		return { cues, countAfterReentry: window.__npcJumpCues.length };
	});
	check(
		"Game emits one spatial arrival cue pair and does not replay on ring re-entry",
		arrivalCues.cues.length === 2 &&
			arrivalCues.countAfterReentry === 2 &&
			arrivalCues.cues.every(
				(cue) => Number.isFinite(cue.spatial.pan) && cue.spatial.gain > 0,
			),
		arrivalCues,
	);
	const queued = await page.evaluate(() => {
		const g = window.__seelite,
			f = window.__haulerFixture;
		// An older, live player grant occupies the shared clearance/lane. The hauler
		// reaches the hold and queues behind it through the ordinary authority.
		const from = f.voyage.tOut;
		g.clearTrafficPresentation();
		const baseline = f.sample(from + 180);
		g.clearTrafficPresentation();
		g.trafficPlayerTimeline.push({
			stationId: f.voyage.destinationStationId,
			kind: "lane",
			fromS: from,
			toS: from + 500,
			participant: { kind: "player" },
			movement: "arrival",
			committed: true,
		});
		return { baseline, held: f.sample(from + 180) };
	});
	check(
		"destination hold reads the shared live terminal lane",
		["lane-queued", "arrival-queued", "clearance-queued", "holding"].includes(
			queued.held.phase,
		) &&
			["arriving", "docked-away"].includes(queued.baseline.phase) &&
			queued.held.contact &&
			queued.held.queue?.participant?.key === fixture.key,
		queued,
	);
	const spatial = await page.evaluate(async (cues) => {
		const { AudioFX } = await import("/src/audio.ts");
		const render = async () => {
			const ctx = new OfflineAudioContext(2, 48000, 48000),
				fx = new AudioFX();
			fx.attach(ctx);
			for (const cue of cues) fx.play({ ...cue, seconds: 0.8 });
			const b = await ctx.startRendering();
			return [0, 1].map((c) =>
				b.getChannelData(c).reduce((sum, x) => sum + x * x, 0),
			);
		};
		return {
			energy: await render(),
			pan: cues[0].spatial.pan,
			gain: cues[0].spatial.gain,
		};
	}, arrivalCues.cues);
	check(
		"Game-emitted arrival cues are audible through AudioFX with spatial pan",
		spatial.energy[0] + spatial.energy[1] > 0.01 &&
			Math.abs(
				Math.sqrt(spatial.energy[0] / spatial.energy[1]) -
					Math.cos(((spatial.pan + 1) * Math.PI) / 4) /
						Math.sin(((spatial.pan + 1) * Math.PI) / 4),
			) < 0.02 &&
			spatial.gain > 0,
		JSON.stringify(spatial),
	);
	console.log(
		JSON.stringify({
			fixture,
			leaving,
			early,
			windup,
			departed,
			arrived,
			queued,
			departurePixels,
			arrivalPixels,
		}),
	);
} finally {
	await browser.close();
}
exit();
