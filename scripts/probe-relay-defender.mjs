/**
 * Node #515's browser tier: the relay's defender (#511), flown in the frame the
 * fight is fought in.
 *
 * The headless rows own the rule — `tests/relay-defender.test.ts` (the draw,
 * the call count, no call while an encounter is live, a call that sends
 * nobody) and the defender's first duel frame in a moving frame. What only the
 * page can answer is the wiring, beside a relay on a station's orbit that moves
 * tens of kilometres a second (#104, #362, #508 F2):
 *
 * - **a system whose drawn slot is down sends none**, however long the relay
 *   is shot;
 * - **a defended relay kill**: the first hit calls a raider that appears three
 *   to five seconds later, inside beam range and moving with the relay's
 *   frame; hits during the fight call nothing; the relay dies, and the
 *   defender, killed, is the slot's world-state destruction and drops cargo;
 * - **a defended tender kill**: the same, on the repair tender (#511 D5).
 *
 * `HEADED=1` also writes 1440x900 captures under `DEFENDER_EVIDENCE` (default
 * `/tmp/seelite-515-evidence`): each fight once its target is dead, nose on
 * the defender that is still in it.
 */
import { mkdirSync } from "node:fs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const headed = process.env.HEADED === "1";
const out = process.env.DEFENDER_EVIDENCE ?? "/tmp/seelite-515-evidence";
if (headed) mkdirSync(out, { recursive: true });
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: !headed });
const { check, watch, exit } = tally();

/** `probe-relay.mjs`'s seed: ESLAIN, whose relay rolled active. Asserted
 *  below rather than assumed. */
const RELAY_SEED = 56;

/** A booted page with the helpers installed. Every helper drives the shipped
 *  game through its public handle. */
async function boot() {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(origin, { seed: RELAY_SEED }));
	await bootedGame(page);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const duel = await import("/src/duel.ts");
		const sim = await import("/src/sim.ts");
		const market = await import("/src/market.ts");
		const defender = await import("/src/relay-defender.ts");
		// The Long-Range Scanner fitted, as a Bounty pilot has it (#508): without
		// it the relay is never identified, so never selectable, and the fight is
		// flown in the station's frame rather than the relay's (#479, #508 F2).
		g.commander.ownedEquipment = [market.LONG_RANGE_SCANNER];
		const frame = () => {
			g.step(dt);
			g.render(dt);
		};
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const aimAt = (t) => {
			const p = g.world.ship.pos;
			g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
		};
		/** The target's position and velocity as the game reads it now. */
		const targetNow = (which) => {
			const r = g.relayReadout();
			return which === "tender" ? r.tender : r.view;
		};
		window.__defenderProbe = {
			beamKm: duel.RAIDER_OUT_OF_BEAM_KM,
			assistCapKms: sim.ASSIST_CAP_KMS,
			rangeKm: defender.DEFENDER_RANGE_KM,
			/** One step of the raider's own thrust at the probe's step. */
			oneStepKms: sim.flightPerformance("raider").thrustKms2 * dt,
			/** Put the ship `km` beside the target, at rest in its frame. */
			placeBeside(which, km) {
				g.dropOut("probe");
				g.encounter = null;
				const t = targetNow(which);
				g.world.ship.pos = { x: t.pos.x + km, y: t.pos.y, z: t.pos.z };
				g.world.ship.vel = { ...t.vel };
				g.throttle = 0;
				g.rates = { pitch: 0, yaw: 0, roll: 0 };
				g.setHeadLook("forward");
				frame();
			},
			/**
			 * Hold the trigger on the target until it dies or `maxSteps` pass,
			 * aiming each frame. Records the first hit, the defender as it
			 * arrives, and every frame of the defender's first five seconds.
			 */
			shootTarget(which, maxSteps) {
				const key = targetNow(which).key;
				g.targetId = key;
				// A tug's shields take a hit before its hull does, so a hit is
				// read off all three pools.
				const hullOf = () => {
					if (which !== "tender") return g.relayReadout().hull;
					const t = g.relayReadout().tender;
					return t ? t.hull + t.fore + t.aft : 0;
				};
				const alive = () =>
					which === "tender"
						? g.relayReadout().tender !== null
						: g.relayReadout().view.condition === "operational";
				const hullBefore = hullOf();
				let firstHitAt = null;
				let arrived = null;
				let encounterAtFirstHit = null;
				let sameAfterHits = true;
				let hitsDuringFight = 0;
				let maxGapKm = 0;
				let maxRelKms = 0;
				let fightFrames = 0;
				g.keys.add(" ");
				let steps = 0;
				for (; steps < maxSteps && alive(); steps++) {
					const hull = hullOf();
					aimAt(targetNow(which).pos);
					frame();
					if (firstHitAt === null && hullOf() < hull) {
						firstHitAt = g.world.gameTime;
						encounterAtFirstHit = g.encounter
							? {
									origin: g.encounter.origin,
									seed: g.encounter.seed,
									appearsAtS: g.encounter.appearsAtS,
									slot: g.encounter.slot.key,
								}
							: null;
					} else if (firstHitAt !== null && hullOf() < hull && g.encounter) {
						if (g.encounter.phase === "duel") hitsDuringFight++;
						if (
							encounterAtFirstHit &&
							g.encounter.seed !== encounterAtFirstHit.seed
						)
							sameAfterHits = false;
					}
					const e = g.encounter;
					if (e?.phase === "duel" && e.raider) {
						const raider = e.raider.flight.ship;
						// The frame the fight is flown in — the pilot's assist frame,
						// which beside a selected relay or tender is the relay's
						// (#508 F2) — and how far that is from the relay's own.
						const assist = g.assistFrame();
						const relayVel = g.relayReadout().view.vel;
						const frameVel = assist.vel;
						if (!arrived)
							arrived = {
								at: g.world.gameTime,
								gapKm: dist(raider.pos, g.world.ship.pos),
								relKms: dist(raider.vel, frameVel),
								frame: assist.label,
								frameOffRelayKms: dist(frameVel, relayVel),
								key: e.slot.key,
							};
						if (g.world.gameTime - arrived.at <= 5) {
							fightFrames++;
							maxGapKm = Math.max(maxGapKm, dist(raider.pos, g.world.ship.pos));
							maxRelKms = Math.max(maxRelKms, dist(raider.vel, frameVel));
						}
					}
				}
				g.keys.delete(" ");
				return {
					key,
					hullBefore,
					steps,
					killed: !alive(),
					killedAt: g.world.gameTime,
					firstHitAt,
					encounterAtFirstHit,
					arrived,
					sameAfterHits,
					hitsDuringFight,
					maxGapKm,
					maxRelKms,
					fightFrames,
					calls: g.relayReadout().defenderWatches[key]?.calls ?? 0,
					encounterPhase: g.encounter?.phase ?? null,
				};
			},
			/** Hold the trigger on the live defender until it is gone, and chase
			 *  it: a raider below `FLEE_HULL_FRACTION` runs, and a pilot parked
			 *  at zero throttle lets it leave the beam as fled. */
			killDefender(maxSteps) {
				const e0 = g.encounter;
				if (!e0 || e0.phase !== "duel") return { phase: e0?.phase ?? null };
				const key = e0.slot.key;
				const name = e0.name;
				const canistersBefore = g.canisters.length;
				g.targetId = key;
				g.keys.add(" ");
				let steps = 0;
				for (; steps < maxSteps && g.encounter?.phase === "duel"; steps++) {
					const r = g.encounter.raider;
					if (r) {
						aimAt(r.flight.ship.pos);
						g.throttle = dist(r.flight.ship.pos, g.world.ship.pos) > 3 ? 1 : 0;
					}
					frame();
				}
				g.keys.delete(" ");
				g.throttle = 0;
				return {
					steps,
					name,
					lastExit: g.lastExit,
					encounter: g.encounter?.phase ?? null,
					slotCondition: g.carrierCondition(key).condition,
					canistersDropped: g.canisters.length - canistersBefore,
					pilotHull: g.condition.hull,
				};
			},
			/** Nose on the live defender, drawn without a step, for a capture. */
			faceDefender() {
				const r = g.encounter?.raider;
				if (!r) return false;
				g.rates = { pitch: 0, yaw: 0, roll: 0 };
				aimAt(r.flight.ship.pos);
				g.render(0);
				return true;
			},
			frame,
		};
	});
	return page;
}

// ---------------------------------------------------------------------------
// A system whose drawn slot is down sends none.
// ---------------------------------------------------------------------------
{
	const page = await boot();
	const down = await page.evaluate(async () => {
		const g = window.__seelite;
		const defender = await import("/src/relay-defender.ts");
		const slots = await import("/src/raider-slots.ts");
		const wreck = await import("/src/raider-wreck.ts");
		const record = g.world.system.record;
		const r = g.relayReadout();
		const instance = g.carrierCondition(r.view.key).instanceOrdinal;
		const drawn = defender.defenderDraw(
			record.seed,
			record.government,
			r.view.key,
			instance,
			0,
		);
		const all = slots.raiderSlots(record.index, record.government);
		const slot = all[drawn.slotIndex].key;
		// The drawn slot destroyed, as a kill leaves it; the others stay up.
		g.applyCarrierTransition(
			slot,
			wreck.raiderDestruction(record.index, g.world.gameTime),
		);
		window.__defenderProbe.placeBeside("relay", 2);
		const shot = window.__defenderProbe.shootTarget("relay", 400);
		// And ten seconds more beside the wreck, in case a call were late.
		for (let i = 0; i < 100; i++) window.__defenderProbe.frame();
		return {
			active: r.active,
			slots: all.length,
			slotCondition: g.carrierCondition(slot).condition,
			othersUp: all
				.filter((s) => s.key !== slot)
				.every((s) => g.carrierCondition(s.key).condition === "operational"),
			shot,
			encounterAfter: g.encounter?.phase ?? null,
		};
	});
	check(
		"seed 56's start system has an active relay",
		down.active,
		JSON.stringify({ active: down.active }),
	);
	check(
		"a system whose drawn slot is down sends none: the relay is shot dead and no raider comes",
		down.slotCondition === "destroyed" &&
			down.othersUp &&
			down.shot.killed &&
			down.shot.firstHitAt !== null &&
			down.shot.encounterAtFirstHit === null &&
			down.shot.arrived === null &&
			down.shot.calls === 1 &&
			down.encounterAfter === null,
		JSON.stringify(down),
	);
	await page.close();
}

// ---------------------------------------------------------------------------
// A defended relay kill, then a defended tender kill.
// ---------------------------------------------------------------------------
const page = await boot();
const capture = async (name) => {
	if (!headed) return;
	await page.evaluate(() => window.__defenderProbe.faceDefender());
	await page.screenshot({ path: `${out}/${name}.png` });
};
const beamKm = await page.evaluate(() => window.__defenderProbe.beamKm);
const capKms = await page.evaluate(() => window.__defenderProbe.assistCapKms);
const rangeKm = await page.evaluate(() => window.__defenderProbe.rangeKm);
const oneStepKms = await page.evaluate(() => window.__defenderProbe.oneStepKms);

/** The rows a defended kill owes, the same for the relay and the tender. */
function defendedRows(label, shot) {
	const delayS =
		shot.arrived && shot.firstHitAt !== null
			? shot.arrived.at - shot.firstHitAt
			: null;
	check(
		`${label}: the first hit calls a defender, which appears 3–5 s later`,
		shot.encounterAtFirstHit?.origin === "defender" &&
			delayS !== null &&
			// One frame of `MAX_DT` either side: the hit and the arrival are each
			// read at the end of the frame they happen in.
			delayS >= 3 - 0.1 &&
			delayS <= 5 + 0.1,
		JSON.stringify({ delayS, first: shot.encounterAtFirstHit }),
	);
	check(
		`${label}: it arrives inside beam range, at rest in the relay's frame, which is the one the pilot flies in`,
		shot.arrived !== null &&
			// The drawn range, read after the arrival frame's steps: the pilot's
			// and the raider's, a few hundred metres at most at `MAX_DT`. A
			// raider left behind by a frame's travel reads kilometres over.
			shot.arrived.gapKm >= rangeKm[0] - 0.3 &&
			shot.arrived.gapKm <= rangeKm[1] + 0.3 &&
			shot.arrived.gapKm < beamKm &&
			shot.arrived.frame === "RELAY FRAME" &&
			shot.arrived.frameOffRelayKms < 1e-6 &&
			// At rest in the frame to one step of its own thrust, flown on the
			// frame it arrives in.
			// To a metre a second, for the cap row's reason below.
			shot.arrived.relKms <= oneStepKms + 1e-3,
		JSON.stringify({ ...shot.arrived, oneStepKms }),
	);
	check(
		`${label}: for its first five seconds it keeps station in that frame — inside beam range and never faster through it than the assist cap`,
		shot.fightFrames >= 40 &&
			shot.maxGapKm < beamKm &&
			// To a metre a second: the cap is held against the frame at the
			// step's clock and read here against it at the frame's end.
			shot.maxRelKms <= capKms + 1e-3,
		JSON.stringify({
			frames: shot.fightFrames,
			maxGapKm: shot.maxGapKm,
			maxRelKms: shot.maxRelKms,
		}),
	);
	check(
		`${label}: hits during the fight call nothing — one call, one encounter`,
		shot.hitsDuringFight > 0 && shot.sameAfterHits && shot.calls === 1,
		JSON.stringify({
			hitsDuringFight: shot.hitsDuringFight,
			same: shot.sameAfterHits,
			calls: shot.calls,
		}),
	);
}

/** The kill's own wiring: `raiderDestruction`, `dropCanisters` and the exit
 *  line, the same for either target. */
function defenderKilledRow(label, result) {
	check(
		`${label}: the defender, killed, is its slot's destruction and drops its cargo`,
		result.encounter === null &&
			result.slotCondition === "destroyed" &&
			result.canistersDropped > 0 &&
			result.lastExit === `${result.name} destroyed`,
		JSON.stringify(result),
	);
}

await page.evaluate(() => window.__defenderProbe.placeBeside("relay", 2));
const relayShot = await page.evaluate(() =>
	window.__defenderProbe.shootTarget("relay", 600),
);
defendedRows("relay", relayShot);
check(
	"relay: the relay dies under fire with the defender in the fight",
	relayShot.killed && relayShot.encounterPhase === "duel",
	JSON.stringify({
		killed: relayShot.killed,
		phase: relayShot.encounterPhase,
	}),
);
await capture("01-relay-defender");
const relayDefender = await page.evaluate(() =>
	window.__defenderProbe.killDefender(1200),
);
defenderKilledRow("relay", relayDefender);

// The tender is there from the relay's repair (kill + `RELAY_WRECK_S`) until
// it completes; the killed defender's slot is back at its own kill plus
// `RAIDER_WRECK_S + RAIDER_REPAIR_S`. Past both, with the tug parked.
const tenderSetup = await page.evaluate(async (relayKilledAt) => {
	const g = window.__seelite;
	const relay = await import("/src/pirate-relay.ts");
	const tender = await import("/src/relay-tender.ts");
	const wreck = await import("/src/raider-wreck.ts");
	const t =
		Math.max(
			relayKilledAt + relay.RELAY_WRECK_S + tender.RELAY_TENDER_INBOUND_S,
			g.world.gameTime + wreck.RAIDER_WRECK_S + wreck.RAIDER_REPAIR_S,
		) + 30;
	g.world.gameTime = t;
	window.__defenderProbe.frame();
	const r = g.relayReadout();
	return {
		at: t,
		repairEndsAt: relayKilledAt + relay.RELAY_WRECK_S + relay.RELAY_REPAIR_S,
		relay: r.view.condition,
		tender: r.tender !== null,
	};
}, relayShot.killedAt);
check(
	"tender: parked at the repairing relay, before the repair completes",
	tenderSetup.relay === "repairing" &&
		tenderSetup.tender &&
		tenderSetup.at < tenderSetup.repairEndsAt,
	JSON.stringify(tenderSetup),
);
await page.evaluate(() => window.__defenderProbe.placeBeside("tender", 2));
const tenderShot = await page.evaluate(() =>
	window.__defenderProbe.shootTarget("tender", 1200),
);
defendedRows("tender", tenderShot);
check(
	"tender: the tender dies under fire",
	tenderShot.killed,
	JSON.stringify({ killed: tenderShot.killed, steps: tenderShot.steps }),
);
await capture("02-tender-defender");
const tenderDefender = await page.evaluate(() =>
	window.__defenderProbe.killDefender(1200),
);
defenderKilledRow("tender", tenderDefender);

await page.close();
await browser.close();
exit();
