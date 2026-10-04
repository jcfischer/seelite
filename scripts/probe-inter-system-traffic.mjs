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
		early.phase === "lane-hold" && early.contact,
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
	await page.evaluate(() => window.__haulerFixture.follow());
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
	const queued = await page.evaluate(() => {
		const g = window.__seelite,
			f = window.__haulerFixture;
		// An older, live player grant occupies the shared clearance/lane. The hauler
		// reaches the hold and queues behind it through the ordinary authority.
		const from = f.voyage.tOut;
		g.trafficPlayerTimeline.push({
			stationId: f.voyage.destinationStationId,
			kind: "lane",
			fromS: from,
			toS: from + 500,
			participant: { kind: "player" },
			movement: "arrival",
			committed: true,
		});
		return f.sample(from + 180);
	});
	check(
		"destination hold reads the shared live terminal lane",
		["arrival-queued", "clearance-queued", "holding"].includes(queued.phase) &&
			queued.contact &&
			queued.queue?.participant?.key === fixture.key,
		queued,
	);
	const spatial = await page.evaluate(async () => {
		const { AudioFX } = await import("/src/audio.ts");
		const render = async (pan) => {
			const ctx = new OfflineAudioContext(2, 48000, 48000),
				fx = new AudioFX();
			fx.attach(ctx);
			fx.play({
				kind: "witchspaceUnfold",
				seconds: 0.8,
				spatial: { pan, gain: 0.5 },
			});
			fx.play({
				kind: "witchspaceRift",
				seconds: 0.8,
				spatial: { pan, gain: 0.5 },
			});
			const b = await ctx.startRendering();
			return [0, 1].map((c) =>
				b.getChannelData(c).reduce((sum, x) => sum + x * x, 0),
			);
		};
		return { left: await render(-1), right: await render(1) };
	});
	check(
		"arrival sound arm is audible and follows the spatial pan",
		spatial.left[0] > 0.01 &&
			spatial.right[1] > 0.01 &&
			spatial.left[0] > 10 * spatial.left[1] &&
			spatial.right[1] > 10 * spatial.right[0],
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
