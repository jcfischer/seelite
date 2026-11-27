/**
 * https://github.com/jcfischer/seelite/issues/1325
 *
 * A sampled docking-waltz version loads its samples when the docking computer
 * is armed, and lets them go once the run is over. `?waltz=jazz-trio`
 * (piano-grand-rich plus bass-pizz) is the version. The probe stands the ship
 * inside the approach radius and reads that nothing is held, arms the
 * computer and reads off the page when the samples are all ready against the
 * opening's length, then disarms and reads the held count back to zero once
 * the waltz has stopped.
 *
 * A default-layout probe (#381 D11): the F8 press is the trusted key that opens
 * the sound through the game's unlock listener.
 *
 * Where the browser offers no way to measure the sampler's memory, the
 * decoded recordings held are counted instead (`Music.heldSamples`).
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const SEED = 19;
const INTRO_S = 16.0;
const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installViewPlacement(page);
await page.goto(
	gameUrl(origin, { seed: SEED, raider: "off", waltz: "jazz-trio" }),
);
await bootedGame(page);
await page.keyboard.press("F8");

const run = await page.evaluate(async () => {
	const { migrateEquipment, equipmentNames } = await import("/src/loadout.ts");
	const g = window.__seelite;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const waitFor = async (done, tries = 400) => {
		for (let i = 0; i < tries && !done(); i++) await sleep(50);
		return done();
	};
	await waitFor(() => g.music.ready, 100);
	await sleep(1500);
	g.updateTrafficAuthority = () => {};
	g.updateTrafficPresentation = () => {};
	if (!g.hasDockingComputer)
		g.commander = {
			...g.commander,
			loadout: migrateEquipment(g.commander.hull, [
				...equipmentNames(g.commander.loadout ?? {}),
				g.dockingComputerName,
			]).loadout,
		};
	const station = g.world.system.contents.stations.find(
		(s) => s.type !== "outpost",
	);
	const snap = g.dockingSnapshot(station.id);
	const held = () => ({
		count: g.music.heldSamples,
		sets: [...g.music.heldSampleSets].sort(),
	});
	const out = { ready: g.music.ready };

	await window.__viewAlongAxis(station.id, snap.planeKm + 4.5, {
		comoving: true,
	});
	await sleep(1500);
	out.close = held();

	g.targetId = station.id;
	g.requestDockingClearance();
	const t0 = performance.now();
	g.toggleDockingComputer();
	out.engaged = g.dockingComputer.engaged;
	out.started = await waitFor(() => g.music.heldSampleSets.length > 0, 600);
	await g.music.samplesReady();
	out.readyMs = performance.now() - t0;
	out.armed = held();
	out.errors = g.music.errors.filter((e) => e.startsWith("sample set"));

	if (g.dockingComputer.engaged) g.toggleDockingComputer();
	out.stopped = await waitFor(() => g.musicState.waltz === "none", 800);
	await sleep(500);
	out.after = held();
	return out;
});

check("the worklet is ready", run.ready, JSON.stringify(run.close));
check(
	"inside the approach radius, unarmed, nothing is held",
	run.close.count === 0 && run.close.sets.length === 0,
	JSON.stringify(run.close),
);
check(
	"arming the docking computer loads the version's two sample sets",
	run.engaged &&
		run.started &&
		run.armed.sets.join() === "bass-pizz,piano-grand-rich" &&
		run.armed.count > 0,
	JSON.stringify({
		engaged: run.engaged,
		armed: run.armed,
		failed: run.errors.length,
	}),
);
console.log(
	`samples all ready ${(run.readyMs / 1000).toFixed(2)} s after the computer was armed, ` +
		`against an opening of ${INTRO_S.toFixed(1)} s; ${run.armed.count} decoded recordings held, ${run.errors.length} failed to load (a checkout holding Git LFS pointers cannot decode them: the parts then play their synth fallback)`,
);
check(
	"the samples are ready inside the opening",
	run.readyMs < INTRO_S * 1000,
	`${(run.readyMs / 1000).toFixed(2)} s against ${INTRO_S.toFixed(1)} s`,
);
check(
	"every failure is named and the run goes on",
	run.errors.every((e) => /did not load/.test(e)),
	JSON.stringify(run.errors.slice(0, 3)),
);
check(
	"disarming without docking releases every sample once the waltz has stopped",
	run.stopped && run.after.count === 0 && run.after.sets.length === 0,
	JSON.stringify({ stopped: run.stopped, after: run.after }),
);
await browser.close();
exit();
