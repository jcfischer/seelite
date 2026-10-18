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
	/**
	 * #1006 — the three beats, in the frames a watcher actually gets. The rows
	 * above this sample at `+0.5 s` after the instant, which is the one moment
	 * that tells them nothing: the ship is already sitting in a ring that opened
	 * after it arrived and that they never saw open.
	 *
	 * `hullThroughPlaneKm` is the hull's stand-off from the ring's plane along its
	 * nose: negative while it is still behind the plane it is coming through.
	 * That is what "came through it" and "went through it" mean here, and it is
	 * what the old law could not produce — the hull jumped from the lane point to
	 * nowhere in one step, so no frame of it was ever possible.
	 */
	const C = fixture.crossing;
	const depOpening = await sample(fixture.tOut - C.openS + 0.2);
	check(
		"the departure ring tears open while the hauler still stands on its lane point",
		depOpening.phase === "jump-windup" &&
			depOpening.contact &&
			depOpening.rift > 0 &&
			depOpening.rift < 1 &&
			Math.abs(depOpening.hullThroughPlaneKm) < 1e-6,
		depOpening,
	);
	await sample(fixture.tOut - 0.9);
	const openingPixels = await pixels();
	check("the opening paints the frame on its own", openingPixels > 30, {
		openingPixels,
	});
	const depSwallow = await sample(fixture.tOut - 0.05);
	check(
		"and the hauler goes through the ring rather than out of it",
		depSwallow.hullThroughPlaneKm > 0 && depSwallow.phase === "jump-windup",
		depSwallow,
	);
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
	// The same three beats at the arrival end, where the hauler is not in this
	// system at all during the opening: `contact` is false, so the only thing on
	// the frame is space opening. This is the row that answers "no sense of drama
	// when witchspace opens" — the ring is on screen a full `openS` before there
	// is a hull to see, and it seals again once there is.
	const arrOpening = await sample(fixture.tOut - C.openS + 0.2);
	check(
		"the arrival ring opens with the hauler still in another system",
		arrOpening.phase === "hyperspace-away" &&
			!arrOpening.contact &&
			arrOpening.jump?.kind === "arrival" &&
			arrOpening.rift > 0 &&
			arrOpening.rift < 1,
		arrOpening,
	);
	await sample(fixture.tOut - 0.9);
	const arrOpeningPixels = await pixels();
	check(
		"a ring opening over an empty lane point paints the frame",
		arrOpeningPixels > 30,
		{ arrOpeningPixels },
	);
	const arrThrough = await sample(fixture.tOut + 0.05);
	// Sampled clear of the crossing rather on it: the presentation evaluates the
	// authority at its own tick, so a frame asked for at `tOut + crossS` is served
	// from a tick a hair earlier and the last few millimetres of the ease are
	// still in it. The exactness of the law itself is asserted headlessly, at the
	// authority's own surface (`tests/inter-system-traffic.test.ts`); what belongs
	// on a browser row is that the hull is *at* the point, within a metre, once the
	// crossing is over — and that it was far behind it at the instant.
	const arrSettled = await sample(fixture.tOut + C.crossS + 0.25);
	check(
		"the arriving hull eases through the plane and settles on the lane point",
		arrThrough.hullThroughPlaneKm < -0.02 &&
			arrSettled.contact &&
			Math.abs(arrSettled.hullThroughPlaneKm) < 1e-3,
		{ arrThrough, arrSettled },
	);
	const arrSealing = await sample(fixture.tOut + C.windowEndS - 0.05);
	const arrSealed = await sample(fixture.tOut + C.windowEndS);
	check(
		"and the ring is seen to seal: collapsing, flaring as it closes, then gone",
		arrSealing.rift > 0 &&
			arrSealing.rift < 0.35 &&
			arrSealing.flare > 0.05 &&
			arrSealing.riftRadiusKm > 0 &&
			arrSealing.riftRadiusKm < arrSettled.riftRadiusKm * 0.2 &&
			arrSealed.rift === 0 &&
			arrSealed.riftRadiusKm === 0,
		{ arrSealing, arrSealed },
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
			arrivalCues,
			departurePixels,
			arrivalPixels,
			depOpening,
			openingPixels,
			depSwallow,
			arrOpening,
			arrOpeningPixels,
			arrThrough,
			arrSettled,
			arrSealing,
			arrSealed,
		}),
	);
} finally {
	await browser.close();
}
exit();
