/**
 * #521: a wait for the Transit lane says why and how long — on the glass under
 * a live grant, and on the console under a held launch — and the figure is
 * never shorter than the wait it names.
 *
 * Live Traffic, not a fixture. The ship is pinned on the trade station's axis
 * under a live grant and the clock runs until a carrier holds the lane; the
 * player's arrival turn is then registered the way the docking computer does
 * it (`playerLaneRequests`, first stamp kept), and the estimate read at that
 * instant is checked against the moment the lane is actually the player's.
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
// One authority tick: the lane is re-decided at 10 Hz.
const TICK_SLACK_S = 0.2;
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
			const t0 = g.world.gameTime;
			g.playerLaneRequests.set(id, { readyAt: t0, movement: "arrival" });
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
			};
			for (let i = 0; i < 6_000; i++) {
				g.step(0.1);
				pin();
				if (g.playerWinsTrafficLane(id, t0, "arrival")) {
					sample.actualS = g.world.gameTime - t0;
					break;
				}
			}
			g.playerLaneRequests.delete(id);
			return sample;
		}, startAtS);
		arrivals.push(arrival);
		if (arrival.found && arrivals.filter((a) => a.found).length === 1)
			await page.screenshot({ path: `${out}/lane-wait-glass.png` });

		// The launch half, on the same page and the same Traffic: dock with the
		// computer, then wait for a carrier to hold the lane and press LAUNCH.
		const launch = arrival.found
			? await page.evaluate(() => {
					const g = window.__seelite;
					const id = "station-trade";
					if (!g.dockingComputerEngaged) g.toggleDockingComputer();
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
		launches.push({ startAtS, ...launch });
		await page.close();
	}

	console.log(JSON.stringify({ arrivals, launches }));
	const seen = (samples) => samples.filter((sample) => sample.found);
	// Both the raw estimate, within one tick, and the rounded figure the pilot
	// reads, with no slack at all: rounding up is what pays for the tick.
	const shownS = (sample) =>
		Number((sample.text ?? sample.notice ?? "").match(/~(\d+)s$/)?.[1]);
	const inTime = (sample) =>
		sample.actualS !== null &&
		sample.estimateS !== null &&
		sample.actualS <= sample.estimateS + TICK_SLACK_S &&
		sample.actualS <= shownS(sample);

	check(
		"live Traffic produced an arrival wait at two or more start times",
		seen(arrivals).length >= 2,
		`${seen(arrivals).length} of ${STARTS.length}`,
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
