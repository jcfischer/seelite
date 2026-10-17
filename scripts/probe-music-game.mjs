/** Live music integration: unlock, station/flight beds and docking waltz commands.
 * Offline synth bands remain in probe-music.mjs; no render window is shortened.
 */
import { installViewFraming } from "./lib/view-placement.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	// ── In the game: loaded on the gesture that opens the sound (D8) ───────
	{
		const game = await browser.newPage({
			viewport: { width: 900, height: 620 },
		});
		watch(game);
		// `music: "off"` keeps #548's director out: it drives the same synth,
		// and with it on the live row below read 0.0008 against its 1e-3. This
		// page is about the synth; the director has its own page after it.
		await game.goto(gameUrl(origin, { seed: 19, raider: "off", music: "off" }));
		await bootedGame(game);
		const before = await game.evaluate(() => window.__seelite.music.ready);
		// A trusted key press: the game's own unlock listener, which opens the
		// context and then attaches the synth. F8 is bound to nothing
		// (`DEFAULT_BINDINGS`), so the press does nothing else.
		await game.keyboard.press("F8");
		await game
			.waitForFunction(() => window.__seelite.music.ready, null, {
				timeout: 5000,
			})
			.catch(() => {});
		const after = await game.evaluate(() => {
			const g = window.__seelite;
			return {
				ready: g.music.ready,
				errors: g.music.errors,
				state: g.audio.context?.state,
			};
		});
		check(
			"the game loads the synth on the gesture that opens its sound",
			before === false && after.ready && after.errors.length === 0,
			`ready ${before} before the key, ${after.ready} after; context ${after.state}; errors ${after.errors.length}`,
		);
		// Realtime, once: every row above renders offline. The test march
		// through the game's own synth, read at the music bus by an analyser
		// the probe adds, then stopped. It shows the worklet sounds on a live
		// context; it does not load the page to test D4's claim that a stall
		// cannot make a note late.
		const live = await game.evaluate(async () => {
			const g = window.__seelite;
			const { TEST_MARCH } = await import("/src/music-test-score.ts");
			const ctx = g.audio.context;
			const tap = ctx.createAnalyser();
			tap.fftSize = 2048;
			g.audio.musicInput.connect(tap);
			const level = () => {
				const x = new Float32Array(tap.fftSize);
				tap.getFloatTimeDomainData(x);
				return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
			};
			const quiet = level();
			g.music.load("probe-march", TEST_MARCH);
			g.music.play("probe-march");
			let heard = 0;
			for (let i = 0; i < 20 && heard === 0; i++) {
				await new Promise((r) => setTimeout(r, 100));
				heard = level();
			}
			g.music.stop("now", 0.1);
			await new Promise((r) => setTimeout(r, 400));
			const after = level();
			g.audio.musicInput.disconnect(tap);
			return { quiet, heard, after, errors: g.music.errors };
		});
		check(
			"the synth sounds on the game's live context, and a stop silences it",
			live.quiet === 0 &&
				live.heard > 1e-3 &&
				live.after === 0 &&
				live.errors.length === 0,
			`rms at the music bus ${live.quiet} before, ${live.heard.toFixed(4)} playing, ${live.after} after the stop`,
		);
		await game.close();
	}
	// ── In the game: a docked pilot hears the station bed (#548) ────────────
	// A new pilot's first sound is docked (#408). Every docked row above is the
	// pure director's; this is the game's own berth and console, parked by
	// `__parkInBerth` as `probe-hold.mjs` does, with whatever they hold.
	{
		const game = await browser.newPage({
			viewport: { width: 900, height: 620 },
		});
		watch(game);
		await installViewPlacement(game);
		await installViewFraming(game);
		await game.goto(gameUrl(origin, { seed: 19, raider: "off" }));
		await bootedGame(game);
		await game.evaluate(async () => {
			const g = window.__seelite;
			const id = g.world.system.bodies.find((b) => b.kind === "station")?.id;
			if (!id) throw Error("no station");
			await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		});
		await game.keyboard.press("F8");
		const live = await game.evaluate(async () => {
			const g = window.__seelite;
			for (let i = 0; i < 50 && !g.music.ready; i++)
				await new Promise((r) => setTimeout(r, 100));
			const ctx = g.audio.context;
			const tap = ctx.createAnalyser();
			tap.fftSize = 2048;
			g.audio.musicInput.connect(tap);
			const level = () => {
				const x = new Float32Array(tap.fftSize);
				tap.getFloatTimeDomainData(x);
				return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
			};
			// The station bed fades in and its drone swells: the loudest of five seconds.
			let heard = 0;
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 100));
				heard = Math.max(heard, level());
			}
			g.audio.musicInput.disconnect(tap);
			return {
				phase: g.dockPhase,
				held: g.clockHeld,
				heard,
				bed: g.musicState.bed,
				errors: g.music.errors,
			};
		});
		check(
			"a docked pilot hears the station bed on the live context (#548)",
			live.phase === "docked" &&
				live.bed === "station" &&
				live.heard > 1e-3 &&
				live.errors.length === 0,
			`${live.phase}, clock ${live.held ? "held" : "running"}; bed ${live.bed}; rms at the music bus ${live.heard.toFixed(4)}; errors ${live.errors.join("; ") || 0}`,
		);
		await game.close();
	}
	// ── In the game: the director plays the system's bed (#548) ────────────
	{
		const game = await browser.newPage({
			viewport: { width: 900, height: 620 },
		});
		watch(game);
		await game.goto(gameUrl(origin, { seed: 19, raider: "off" }));
		await bootedGame(game);
		await game.keyboard.press("F8");
		const live = await game.evaluate(async () => {
			const g = window.__seelite;
			for (let i = 0; i < 50 && !g.music.ready; i++)
				await new Promise((r) => setTimeout(r, 100));
			const ctx = g.audio.context;
			const tap = ctx.createAnalyser();
			tap.fftSize = 2048;
			g.audio.musicInput.connect(tap);
			const level = () => {
				const x = new Float32Array(tap.fftSize);
				tap.getFloatTimeDomainData(x);
				return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
			};
			// The bed fades in over seconds: read the loudest of four seconds.
			let heard = 0;
			for (let i = 0; i < 40; i++) {
				await new Promise((r) => setTimeout(r, 100));
				heard = Math.max(heard, level());
			}
			g.audio.musicInput.disconnect(tap);
			return {
				heard,
				bed: g.musicState.bed,
				level: g.musicState.level,
				errors: g.music.errors,
			};
		});
		check(
			"the director plays the system's bed on the game's live context, calm at a quiet boot (#548)",
			// Calm: raiders off, a new commander, a full hull. It read combat
			// once, from a struck window wider than a fresh condition's
			// `sinceStruckS`.
			live.bed !== "none" &&
				live.level === "calm" &&
				live.heard > 1e-3 &&
				live.errors.length === 0,
			`bed ${live.bed} at ${live.level}; rms at the music bus ${live.heard.toFixed(4)}; errors ${live.errors.join("; ") || 0}`,
		);
		await game.close();
	}
	// ── In the game: the docking computer plays the waltz (#603) ────────────
	// A docking-computer run. The engage, the arrival and the cancel are on
	// the game's own frame loop, which is what steps the director; the
	// approach to the plane is sim steps, and traffic is stopped. What this can show is the **command stream** the director
	// sent, the ship bus's gain and the synth's refusals — a `resolve` with no
	// waltz playing is one. Whether it sounds right is the offline renders'
	// and the principal's ear.
	{
		const game = await browser.newPage({
			viewport: { width: 900, height: 620 },
		});
		watch(game);
		await installViewPlacement(game);
		await game.goto(gameUrl(origin, { seed: 19, raider: "off" }));
		await bootedGame(game);
		await game.keyboard.press("F8");
		const ready = await game.evaluate(async () => {
			const g = window.__seelite;
			for (let i = 0; i < 50 && !g.music.ready; i++)
				await new Promise((r) => setTimeout(r, 100));
			// Every command the director sends, with the wall time it was sent.
			window.__sent = [];
			const send = g.music.send.bind(g.music);
			g.music.send = (cmd) => {
				const { song, ...rest } = cmd;
				window.__sent.push({
					...rest,
					ms: performance.now(),
					gameS: g.world.gameTime,
				});
				send(cmd);
			};
			// The bed has started, so the waltz's `play` has a line to wait for.
			await new Promise((r) => setTimeout(r, 2000));
			return { ready: g.music.ready, bed: g.musicState.bed };
		});
		check(
			"the waltz row starts from the flight bed, on a ready synth",
			ready.ready && ready.bed === "flight",
			`ready ${ready.ready}, bed ${ready.bed}`,
		);
		// Outside §7's standoff, cleared, the computer fitted and engaged, and
		// the game's own frames left to fly it. Traffic is stopped as
		// `__parkInBerth` stops it, so the clearance is not a lane's to refuse.
		// The loudest rms at a node over `ms`, read by an analyser tapped on.
		await game.evaluate(() => {
			window.peakRms = async (node, ms) => {
				const tap = node.context.createAnalyser();
				tap.fftSize = 2048;
				node.connect(tap);
				const x = new Float32Array(tap.fftSize);
				let peak = 0;
				for (let t = 0; t < ms; t += 100) {
					await new Promise((r) => setTimeout(r, 100));
					tap.getFloatTimeDomainData(x);
					peak = Math.max(
						peak,
						Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length),
					);
				}
				node.disconnect(tap);
				return peak;
			};
		});
		const engage = async () =>
			game.evaluate(async () => {
				const { migrateEquipment, equipmentNames } = await import(
					"/src/loadout.ts"
				);

				const g = window.__seelite;
				const id = g.world.system.bodies.find((b) => b.kind === "station")?.id;
				if (!id) throw Error("no station");
				g.clearTrafficPresentation();
				g.trafficSystemIndex = g.world.system.record.index;
				g.trafficActors = [];
				// Both rosters. Authority is ready only once its warm index reaches the
				// candidate count (home plus inbound); with it stubbed, an inbound hauler
				// left here keeps it unready, and the player's lane request waits forever.
				g.trafficInbound = [];
				g.trafficTick = Math.floor(g.world.gameTime * 10);
				g.updateTrafficAuthority = () => {};
				g.updateTrafficPresentation = () => {};
				const snap = g.dockingSnapshot(id);
				await window.__viewAlongAxis(id, snap.planeKm + 4.5, {
					comoving: true,
				});
				g.targetId = id;
				const granted =
					g.requestDockingClearance().state?.clearance?.kind === "granted";
				if (!g.hasDockingComputer)
					g.commander = {
						...g.commander,
						loadout: migrateEquipment(g.commander.hull, [
							...equipmentNames(g.commander.loadout ?? {}),
							g.dockingComputerName,
						]).loadout,
					};
				const before = g.audio.buses.ship.gain.value;
				const from = window.__sent.length;
				g.toggleDockingComputer();
				await new Promise((r) => setTimeout(r, 3000));
				const heard = await window.peakRms(g.audio.musicInput, 1000);
				return {
					id,
					granted,
					engaged: g.dockingComputer.engaged,
					sent: window.__sent.slice(from),
					waltz: g.musicState.waltz,
					heard,
					before,
					ducked: g.audio.buses.ship.gain.value,
					errors: [...g.music.errors],
				};
			});
		const { DANUBE_CANCEL_FADE_S } = await game.evaluate(
			() => import("/src/music-danube.ts"),
		);
		const { WALTZ_CADENCE_S, WALTZ_DUCK_DB } = await game.evaluate(
			() => import("/src/music-director.ts"),
		);
		// In the page: a module's function does not survive the trip back
		// out of `evaluate`, only its numbers do.
		const duck = await game.evaluate(
			async (db) => (await import("/src/audio.ts")).duckGain(db),
			WALTZ_DUCK_DB,
		);
		const run = await engage();
		const types = (sent) =>
			sent
				.filter((c) => c.type !== "stem" && c.type !== "tempo")
				.map(
					(c) => `${c.type}${c.id ? ` ${c.id}` : ""}${c.to ? ` ${c.to}` : ""}`,
				);
		check(
			"engaging the docking computer plays the waltz, and the ship bus ducks (#603, #547 D5)",
			run.granted &&
				run.engaged &&
				run.waltz === "playing" &&
				types(run.sent).join(",") === "load danube,play danube" &&
				run.heard > 1e-3 &&
				Math.abs(run.ducked / run.before - duck) < 0.05 &&
				run.errors.length === 0,
			`cleared ${run.granted}, engaged ${run.engaged}; sent ${types(run.sent).join(", ")}; waltz ${run.waltz}; rms ${run.heard.toFixed(4)}; ship bus ${run.before} -> ${run.ducked.toFixed(3)} against x${duck.toFixed(3)}; errors ${run.errors.join("; ") || 0}`,
		);
		// The intro is ~19 s and every real run is longer (#547 F1): let it
		// pass before the plane, so the resolve lands in the loop as it does in
		// play. Then the rest of the run in sim steps, to the plane.
		const plane = await game.evaluate(
			async ([id]) => {
				const g = window.__seelite;
				await new Promise((r) => setTimeout(r, 17000));
				const dt = 1 / 60;
				for (let i = 0; i < 60 * 240 && g.dockPhase === "flying"; i++) {
					g.step(dt);
					if (g.dockPhase === "flying" && !g.dockingComputer.engaged)
						return { refused: g.dockingSnapshot(id).computerRefusal };
				}
				const from = window.__sent.length;
				// Game time, the clock the director's hold counts. A frame's `dt`
				// is capped at `MAX_DT`, so under load game time falls behind the
				// wall: a wall-clock wait read 7.99 s for a 6.34 s hold (#607).
				const atPlane = g.world.gameTime;
				const maxDt = g.units.MAX_DT;
				// The arrival runs on the game's own frames from here.
				await new Promise((r) => setTimeout(r, 1500));
				const resolved = window.__sent.slice(from);
				const midDuck = g.audio.buses.ship.gain.value;
				const errors = [...g.music.errors];
				for (let i = 0; i < 120 && g.musicState.bed !== "station"; i++)
					await new Promise((r) => setTimeout(r, 100));
				const station = window.__sent
					.slice(from)
					.find((c) => c.type === "crossfade" && c.to === "station");
				return {
					phase: g.dockPhase,
					resolved,
					midDuck,
					errors,
					waitS: station ? station.gameS - atPlane : null,
					maxDt,
					bed: g.musicState.bed,
					lateErrors: [...g.music.errors],
				};
			},
			[run.id],
		);
		check(
			"the plane resolves the waltz on the bar, with a waltz playing to resolve (#547 D1)",
			!plane.refused &&
				plane.resolved[0]?.type === "resolve" &&
				plane.resolved[0]?.at === "bar" &&
				plane.errors.length === 0,
			plane.refused
				? `the computer let go: ${plane.refused}`
				: `${plane.phase}; sent ${types(plane.resolved).join(", ")}; errors ${plane.errors.join("; ") || 0}`,
		);
		check(
			"the ship bus comes back at the plane, and the station bed waits for the cadence",
			plane.midDuck / run.before > 0.9 &&
				plane.bed === "station" &&
				plane.waitS !== null &&
				// Two-sided, in game time. The hold starts on the first frame after
				// the plane and adds each frame's `dt`, so the wait is the cadence
				// plus at most that first frame and the one that crosses the line.
				plane.waitS >= WALTZ_CADENCE_S - 1e-6 &&
				plane.waitS <= WALTZ_CADENCE_S + 2 * plane.maxDt + 1e-6 &&
				plane.lateErrors.length === 0,
			`ship bus x${(plane.midDuck / run.before).toFixed(3)} 1.5 s after; station bed ${plane.waitS?.toFixed(3)} game-s after the plane against a ${WALTZ_CADENCE_S.toFixed(3)} s cadence (+ at most ${(2 * plane.maxDt).toFixed(2)}); bed ${plane.bed}; errors ${plane.lateErrors.join("; ") || 0}`,
		);
		// A second run, and the pilot takes the stick: a held throttle key is
		// control input (§7), through the game's own keyboard path. This is a
		// default-layout probe (#381 D11): Shift is throttle up in the shipped
		// layout, and the row also asserts the computer let go, so a dead key
		// would fail it rather than pass.
		await game.evaluate(async () => {
			const g = window.__seelite;
			const dt = 1 / 60;
			for (let i = 0; i < 60 * 60 && g.dockPhase !== "flying"; i++) {
				if (g.dockPhase === "docked") g.launch();
				g.skipDockTraversal();
				g.step(dt);
			}
		});
		const again = await engage();
		const mark = await game.evaluate(() => window.__sent.length);
		await game.keyboard.down("Shift");
		await game.waitForTimeout(400);
		await game.keyboard.up("Shift");
		const cancel = await game.evaluate(
			async ([from]) => {
				const g = window.__seelite;
				await new Promise((r) => setTimeout(r, 3000));
				return {
					engaged: g.dockingComputer.engaged,
					sent: window.__sent.slice(from),
					waltz: g.musicState.waltz,
					bed: g.musicState.bed,
					ship: g.audio.buses.ship.gain.value,
					errors: [...g.music.errors],
				};
			},
			[mark],
		);
		const stop = cancel.sent.find((c) => c.type === "stop");
		check(
			"the pilot's stick fades the waltz over two bars, and the flight bed is back on the bar (#547 D2)",
			again.waltz === "playing" &&
				!cancel.engaged &&
				stop?.at === "now" &&
				stop?.fadeS === DANUBE_CANCEL_FADE_S &&
				types(cancel.sent)[0] === "stop" &&
				/^crossfade flight-/.test(types(cancel.sent)[1] ?? "") &&
				cancel.bed === "flight" &&
				cancel.waltz === "none" &&
				cancel.ship / run.before > 0.9 &&
				cancel.errors.length === 0,
			`second run ${again.waltz}; engaged ${cancel.engaged} after the key; sent ${types(cancel.sent).join(", ")}; stop ${stop?.at} over ${stop?.fadeS} s against ${DANUBE_CANCEL_FADE_S}; bed ${cancel.bed}; ship bus x${(cancel.ship / run.before).toFixed(3)}; errors ${cancel.errors.join("; ") || 0}`,
		);
		await game.close();
	}
} finally {
	await browser.close();
}
exit();
