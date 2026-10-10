/**
 * #521: a wait for the Transit lane says why and how long — on the glass under
 * a live grant, and on the console under a held launch — and that at every
 * sampled start time the figure was not shorter than the wait it named. Four
 * start times at one seed are a sample, not a proof.
 *
 * Live Traffic, not a fixture. The ship is pinned on the trade station's axis
 * and hand-flown — no docking computer — and the clock runs until a carrier
 * holds the lane. Clearance is then requested, and the game itself must
 * register the pilot's arrival turn and keep its first stamp (the principal's
 * ruling on #521: a hand-flown turn is held, so later carriers queue behind
 * it). The estimate read at that instant is checked against the moment the
 * lane is actually the player's.
 * The computer then docks the ship, and the same page runs the clock until a
 * carrier holds the lane again, presses LAUNCH, and times the held launch.
 *
 * Rendered text, not a state object: the glass line is `directorRender`'s
 * `clearanceText`, the string the draw painted, and the launch notice is read
 * off the console the pilot is facing. One capture of each is written to
 * `LANE_WAIT_EVIDENCE`.
 */
import { mkdirSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin =
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173";
const out = process.env.LANE_WAIT_EVIDENCE ?? "/tmp/seelite-521-evidence";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium();
const { check, watch, exit } = tally();

// Start times spread over a Traffic cycle, so the waits found are not one.
const STARTS = [120, 700, 1_500, 2_600];
const arrivals = [];
const launches = [];

try {
	for (const startAtS of STARTS) {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 800 },
		});
		watch(page);
		await page.goto(gameUrl(origin, { seed: 54 }), { waitUntil: "load" });
		await bootedGame(page);
		const arrival = await page.evaluate(async (startAtS) => {
			const g = window.__seelite;
			cancelAnimationFrame(g.animationFrame);
			const sim = await import("/src/sim.ts");
			// Read off the page, not restated: the turn latency the figure covers.
			const { LANE_TURN_LATENCY_S } = await import("/src/docking-director.ts");
			g.clearTrafficPresentation();
			g.trafficSystemIndex = -1;
			g.trafficActors = [];
			g.world.gameTime = startAtS;
			sim.advanceSystem(g.world.system, startAtS);
			let warm = 0;
			do {
				g.trafficTick = Number.NaN;
				g.updateTrafficAuthority();
				warm++;
			} while (!g.trafficAuthorityReady() && warm < 2_000);
			const id = "station-trade";
			const pin = () => {
				const snap = g.dockingSnapshot(id);
				const body = g.world.system.byId.get(id);
				const outKm = snap.planeKm + 3.2;
				g.world.ship.pos = {
					x: body.pos.x + snap.axis.x * outKm,
					y: body.pos.y + snap.axis.y * outKm,
					z: body.pos.z + snap.axis.z * outKm,
				};
				g.world.ship.vel = { ...g.stationVelocity(id) };
				g.setAttitude(
					{ x: -snap.axis.x, y: -snap.axis.y, z: -snap.axis.z },
					snap.basis.up,
				);
			};
			g.regime = "normal";
			g.spoolLeftS = 0;
			g.resetDock();
			g.setThrottle(0);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			g.targetId = id;
			pin();
			let found = null;
			for (let i = 0; i < 12_000 && !found; i++) {
				g.step(0.1);
				pin();
				const wait = g.trafficLaneWait(id, g.world.gameTime, "arrival");
				if (wait && wait.waitS !== null) found = wait;
			}
			if (!found) return { startAtS, found: false };
			const clearance = g.requestDockingClearance().state?.clearance?.kind;
			// One step for the game to register the hand-flown turn by itself.
			g.step(0.1);
			pin();
			const turn = g.playerLaneRequests.get(id) ?? null;
			const t0 = turn?.readyAt ?? Number.NaN;
			const director = g.directorState();
			g.render(1 / 60);
			const sample = {
				startAtS,
				found: true,
				clearance,
				blocking: director?.blocking?.kind ?? null,
				text: g.directorRender?.clearanceText ?? null,
				estimateS: director?.laneWait?.waitS ?? null,
				actualS: null,
				latencyS: LANE_TURN_LATENCY_S,
				turn: turn?.movement ?? null,
				stampKept: null,
			};
			// No figure when Traffic cannot say: a warming authority cannot see
			// the lane, and the glass gives the reason alone.
			const warmIndex = g.trafficWarmIndex;
			g.trafficWarmIndex = 0;
			g.render(1 / 60);
			sample.warmingText = g.directorRender?.clearanceText ?? null;
			g.trafficWarmIndex = warmIndex;
			g.render(1 / 60);
			for (let i = 0; i < 6_000; i++) {
				g.step(0.1);
				pin();
				if (g.playerWinsTrafficLane(id, t0, "arrival")) {
					sample.actualS = g.world.gameTime - t0;
					sample.stampKept = g.playerLaneRequests.get(id)?.readyAt === t0;
					break;
				}
			}
			return sample;
		}, startAtS);
		arrivals.push(arrival);
		if (arrival.found && arrivals.filter((a) => a.found).length === 1)
			await page.screenshot({ path: `${out}/lane-wait-glass.png` });

		// The launch half, on the same page and the same Traffic: dock with the
		// computer, then wait for a carrier to hold the lane and press LAUNCH.
		const launch = arrival.found
			? await page.evaluate(async () => {
					const { migrateEquipment, equipmentNames } = await import(
						"/src/loadout.ts"
					);

					const g = window.__seelite;
					const id = "station-trade";
					if (!g.dockingComputer.engaged) {
						// A new ship has no docking computer (#408): fit the one this flies.
						if (!g.hasDockingComputer)
							g.commander = {
								...g.commander,
								loadout: migrateEquipment(g.commander.hull, [
									...equipmentNames(g.commander.loadout ?? {}),
									g.dockingComputerName,
								]).loadout,
							};
						g.toggleDockingComputer();
					}
					for (let i = 0; i < 6_000 && g.dockPhase === "flying"; i++)
						g.step(0.1);
					if (g.dockPhase === "arriving") g.skipDockTraversal();
					for (let i = 0; i < 600 && g.dockPhase !== "docked"; i++) g.step(0.1);
					if (g.dockPhase !== "docked")
						return { found: false, why: `dock ${g.dockPhase}` };
					let found = null;
					for (let i = 0; i < 12_000 && !found; i++) {
						g.step(0.1);
						const wait = g.trafficLaneWait(id, g.world.gameTime, "launch");
						if (wait && wait.waitS !== null) found = wait;
					}
					if (!found) return { found: false, why: "no wait" };
					const t0 = g.world.gameTime;
					const launched = g.launch();
					g.setHeadLook("right");
					document.querySelector('[data-live-right-tab="Flight"]')?.click();
					g.updateCockpit();
					// A frame of the docked scene, so the capture behind the console is
					// this state and not the arrival half's last frame.
					g.render(1 / 60);
					const notice =
						[...document.querySelectorAll("[data-live-launch-notice]")].find(
							(element) =>
								element instanceof HTMLElement && element.checkVisibility(),
						)?.textContent ?? null;
					return {
						found: true,
						t0,
						launched,
						notice,
						estimateS: g.launchHoldWaitS(id),
					};
				})
			: { found: false, why: "no arrival" };
		if (launch.found) {
			if (launches.filter((l) => l.found).length === 0)
				await page.screenshot({ path: `${out}/launch-hold-console.png` });
			// A held launch releases itself on the first step the lane is its own.
			launch.actualS = await page.evaluate((t0) => {
				const g = window.__seelite;
				for (let i = 0; i < 6_000; i++) {
					g.step(0.1);
					if (g.dockPhase !== "docked") return g.world.gameTime - t0;
				}
				return null;
			}, launch.t0);
		}
		launches.push({ startAtS, latencyS: arrival.latencyS, ...launch });
		await page.close();
	}

	console.log(JSON.stringify({ arrivals, launches }));
	const seen = (samples) => samples.filter((sample) => sample.found);
	// Both the raw estimate, within the page's own turn latency, and the rounded
	// figure the pilot reads, with no slack at all: that figure already carries
	// the latency (`laneWaitEstimate`).
	const shownS = (sample) =>
		Number((sample.text ?? sample.notice ?? "").match(/~(\d+)s$/)?.[1]);
	const inTime = (sample) =>
		sample.actualS !== null &&
		sample.estimateS !== null &&
		sample.actualS <= sample.estimateS + sample.latencyS &&
		sample.actualS <= shownS(sample);

	check(
		"live Traffic produced an arrival wait at two or more start times",
		seen(arrivals).length >= 2,
		`${seen(arrivals).length} of ${STARTS.length}`,
	);
	check(
		"a hand-flown ship under a live grant holds a turn the game registered, and keeps its stamp",
		seen(arrivals).length > 0 &&
			seen(arrivals).every(
				(sample) => sample.turn === "arrival" && sample.stampKept === true,
			),
		JSON.stringify(
			seen(arrivals).map(({ turn, stampKept }) => ({ turn, stampKept })),
		),
	);
	check(
		"with no figure to give, the glass gives the reason alone",
		seen(arrivals).length > 0 &&
			seen(arrivals).every(
				(sample) => sample.warmingText === "WAIT · traffic control starting up",
			),
		JSON.stringify(seen(arrivals).map((sample) => sample.warmingText)),
	);
	check(
		"the glass writes the arrival wait in the pilot's words, with its figure",
		seen(arrivals).length > 0 &&
			seen(arrivals).every(
				(sample) =>
					sample.clearance === "granted" &&
					sample.blocking === null &&
					/^WAIT · a ship is (in the lane|queued ahead) · ~\d+s$/.test(
						sample.text ?? "",
					),
			),
		JSON.stringify(seen(arrivals).map((sample) => sample.text)),
	);
	// The failure that matters is a figure shorter than the wait: the pilot was
	// told the lane would open and it did not.
	check(
		"the lane opens no later than the arrival estimate said, and it does open",
		seen(arrivals).length > 0 && seen(arrivals).every(inTime),
		JSON.stringify(
			seen(arrivals).map(({ estimateS, actualS }) => ({ estimateS, actualS })),
		),
	);
	check(
		"live Traffic held a launch at two or more start times",
		seen(launches).length >= 2,
		`${seen(launches).length} of ${STARTS.length}: ${JSON.stringify(launches.map((l) => l.why ?? "found"))}`,
	);
	check(
		"a held launch says why and how long, on the console the pilot faces",
		seen(launches).length > 0 &&
			seen(launches).every(
				(sample) =>
					sample.launched === false &&
					/^LAUNCH HELD — A SHIP IS (IN THE LANE|QUEUED AHEAD) · ~\d+s$/.test(
						sample.notice ?? "",
					),
			),
		JSON.stringify(seen(launches).map((sample) => sample.notice)),
	);
	check(
		"the held launch leaves no later than its estimate said",
		seen(launches).length > 0 && seen(launches).every(inTime),
		JSON.stringify(
			seen(launches).map(({ estimateS, actualS }) => ({ estimateS, actualS })),
		),
	);
} finally {
	await browser.close();
}
exit();
